import { and, eq } from "drizzle-orm";
import { workflows, type Db } from "@paperclipai/db";
import { workflowDraftFlowCommandSchema, workflowDraftFlowReviewSchema, workflowDraftStepReceiptSchema,
  type WorkflowDraftFlowCommand, type WorkflowGraphV1 } from "@paperclipai/shared";
import { conflict, notFound } from "../../errors.js";
import { workflowService } from "./workflow-service.js";
import { lockWorkflowDraftAccount, originalWorkflowDraftReceipt } from "./workflow-draft-authority.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import type { AuthorizationActor } from "../authorization.js";
import { guidedConditionExpression } from "./workflow-guided-condition.js";
import { assertDraftAgentSelection, reviewDraftAgentSelection } from "./workflow-draft-agents.js";
import { assertDraftToolSelection, reviewDraftToolSelection } from "./workflow-draft-tools.js";

const action = "workflow.customer_draft_flow_saved";
/** A complete single Native path, never a flattened or truncated branch view.
 * Unavailable shapes keep their Original Advanced editing owner. */
export function linearDraftNodes(graph: WorkflowGraphV1) {
  if (graph.nodes.length > 100 || graph.edges.length > 99) return null;
  if (graph.nodes.some(node => ["core.condition", "core.switch", "core.parallel"].includes(node.type)) ||
    graph.nodes.filter(node => node.type === "core.manual_trigger").length > 1) return null;
  if (!graph.nodes.length) return graph.edges.length ? null : [];
  if (graph.edges.length !== graph.nodes.length - 1 || new Set(graph.nodes.map(node => node.id)).size !== graph.nodes.length) return null;
  const nodes = new Map(graph.nodes.map(node => [node.id, node])), incoming = new Map<string, number>(), outgoing = new Map<string, string>();
  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target) || outgoing.has(edge.source) || incoming.has(edge.target) ||
      edge.sourceHandle || edge.targetHandle) return null;
    incoming.set(edge.target, 1); outgoing.set(edge.source, edge.target);
  }
  const roots = graph.nodes.filter(node => !incoming.has(node.id));
  if (roots.length !== 1 || roots[0].type !== "core.manual_trigger") return null;
  const ordered: WorkflowGraphV1["nodes"] = [], seen = new Set<string>();
  let id: string | undefined = roots[0].id;
  while (id) {
    if (seen.has(id)) return null;
    seen.add(id); ordered.push(nodes.get(id)!); id = outgoing.get(id);
  }
  return ordered.length === graph.nodes.length ? ordered : null;
}

export function workflowCustomerDraftFlow(db: Db) {
  const prior = (tx: Db, company: string, workflow: string, request: string, actor: AuthorizationActor) => originalWorkflowDraftReceipt(tx, company, workflow, request, actor, action);
  return {
    receipt: (companyId: string, workflowId: string, requestId: string, actor: AuthorizationActor) => db.transaction(async raw => {
      const value = await prior(raw as unknown as Db, companyId, workflowId, workflowDraftFlowCommandSchema.shape.requestId.parse(requestId), actor);
      if (!value) throw notFound("The Original flow request is unconfirmed"); return value.receipt;
    }),
    review: (companyId: string, workflowId: string, actor: AuthorizationActor) => db.transaction(async raw => {
      const tx = raw as unknown as Db, current = await lockWorkflowDraftAccount(tx, actor, companyId);
      await tx.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId))).for("share");
      const detail = await workflowService(tx).getDetail(companyId, workflowId, current.actor), draft = detail?.draftRevision;
      if (!detail || detail.status === "archived" || !draft || draft.state !== "draft") throw notFound("The current draft flow is unavailable");
      const ordered = linearDraftNodes(draft.graph);
      const view = workflowDraftFlowReviewSchema.parse({ companyId, workflowId, draftRevisionId: draft.id, publishedRevisionId: detail.publishedRevisionId,
        updatedAt: detail.updatedAt.toISOString(), version: draft.revisionNumber, availability: ordered ? ordered.length ? "linear" : "empty" : "advanced",
        deadlineSeconds: draft.graph.settings.totalDeadlineSeconds ?? null,
        ...(ordered?.length ? { agentSelection: await reviewDraftAgentSelection(tx, companyId, current.actor) } : {}),
        ...(ordered?.length ? { toolSelection: await reviewDraftToolSelection(tx, companyId, current.actor) } : {}),
        steps: ordered?.map(node => ({ nodeId: node.id, name: node.name, type: node.type })) ?? [] });
      await lockWorkflowDraftAccount(tx, actor, companyId); return view;
    }),
    save: (companyId: string, workflowId: string, rawCommand: WorkflowDraftFlowCommand, actor: AuthorizationActor) => withV7ActivityTransaction(db, async (tx, publications) => {
      const command = workflowDraftFlowCommandSchema.parse(rawCommand), hash = nativeSha256(command), retained = await prior(tx, companyId, workflowId, command.requestId, actor);
      if (retained) {
        if (retained.hash !== hash) throw conflict("The Original flow request has different content", { code: "workflow_draft_request_conflict" });
        return retained.receipt;
      }
      const current = await lockWorkflowDraftAccount(tx, actor, companyId);
      await tx.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId))).for("update");
      const owner = workflowService(tx), detail = await owner.getDetail(companyId, workflowId, current.actor), draft = detail?.draftRevision;
      const refuse = () => conflict("The draft flow changed; review it before editing", { code: "workflow_draft_flow_conflict" });
      if (!detail || detail.status === "archived" || !draft || draft.state !== "draft" || command.expectedWorkflowId !== workflowId ||
        command.expectedDraftRevisionId !== draft.id || command.expectedPublishedRevisionId !== detail.publishedRevisionId || command.expectedUpdatedAt !== detail.updatedAt.toISOString()) throw refuse();
      const ordered = linearDraftNodes(draft.graph), operation = command.operation;
      if (!ordered || (ordered.at(-1)?.id ?? null) !== command.expectedLastNodeId) throw refuse();
      let graph: WorkflowGraphV1;
      if (operation.kind === "remove_last") {
        if (ordered.length < 2) throw refuse();
        const last = ordered.at(-1)!;
        graph = { ...draft.graph, nodes: draft.graph.nodes.filter(node => node.id !== last.id),
          edges: draft.graph.edges.filter(edge => edge.target !== last.id && edge.source !== last.id) };
      } else if (operation.kind === "append_condition") {
        if (!ordered.length || ordered.length > 97) throw refuse();
        if (operation.condition.source === "steps" && !ordered.some(node => node.id === operation.condition.path[0])) throw refuse();
        const id = `step-${command.requestId}`, trueId = `${id}-true`, falseId = `${id}-false`;
        if (draft.graph.nodes.some(node => [id, trueId, falseId].includes(node.id))) throw refuse();
        graph = { ...draft.graph, nodes: [...draft.graph.nodes,
          { id, type: "core.condition", name: operation.name, position: { x: 0, y: ordered.length * 160 }, config: { expression: guidedConditionExpression(operation.condition) } },
          { id: trueId, type: "core.wait", name: operation.whenTrue.name, position: { x: 160, y: (ordered.length + 1) * 160 }, config: { durationSeconds: operation.whenTrue.durationSeconds } },
          { id: falseId, type: "core.wait", name: operation.whenFalse.name, position: { x: -160, y: (ordered.length + 1) * 160 }, config: { durationSeconds: operation.whenFalse.durationSeconds } },
        ], edges: [...draft.graph.edges,
          { id: `edge-${command.requestId}`, source: ordered.at(-1)!.id, target: id },
          { id: `edge-${command.requestId}-true`, source: id, target: trueId, sourceHandle: "true" },
          { id: `edge-${command.requestId}-false`, source: id, target: falseId, sourceHandle: "false" },
        ] };
      } else {
        if (operation.kind === "start_manual" ? ordered.length !== 0 : ordered.length === 0 || ordered.length >= 100) throw refuse();
        if (operation.kind === "append_agent_task") await assertDraftAgentSelection(tx, companyId, current.actor, operation.agentId, refuse);
        if (operation.kind === "append_tool") await assertDraftToolSelection(tx, companyId, current.actor, operation, refuse);
        const node = { id: `step-${command.requestId}`, type: operation.kind === "start_manual" ? "core.manual_trigger" : operation.kind === "append_wait" ? "core.wait" : operation.kind === "append_agent_task" ? "agent.task" : operation.kind === "append_tool" ? "connector.action" : "human.approval",
          name: operation.name, position: { x: 0, y: ordered.length * 160 },
          config: operation.kind === "start_manual" ? {} : operation.kind === "append_wait" ? { durationSeconds: operation.durationSeconds }
            : operation.kind === "append_agent_task" ? { agentId: operation.agentId, objective: operation.objective, waitForCompletion: true }
              : operation.kind === "append_tool" ? { toolCatalogEntryId: operation.entryId, connectionId: operation.connectionId, catalogVersionHash: operation.versionHash,
                catalogSchemaHash: operation.schemaHash, projectedInputSchemaHash: operation.inputSchemaHash, input: operation.input }
              : { summary: operation.summary, consequence: operation.consequence } };
        if (draft.graph.nodes.some(existing => existing.id === node.id)) throw refuse();
        graph = { ...draft.graph, nodes: [...draft.graph.nodes, node], edges: ordered.length ? [...draft.graph.edges,
          { id: `edge-${command.requestId}`, source: ordered.at(-1)!.id, target: node.id }] : draft.graph.edges };
        if (operation.kind === "start_manual") graph.settings = { ...draft.graph.settings, totalDeadlineSeconds: operation.deadlineSeconds };
      }
      const saved = await owner.updateDraft(companyId, workflowId, { expectedRevisionId: draft.id, graph }, { principal: { type: "user", userId: current.userId } });
      const receipt = workflowDraftStepReceiptSchema.parse({ companyId, workflowId, requestId: command.requestId, previousRevisionId: draft.id,
        draftRevisionId: saved.draftRevisionId, version: saved.draftRevision!.revisionNumber, changed: saved.draftRevisionId !== draft.id,
        recordedAt: new Date().toISOString(), published: false, executionStarted: false });
      await logActivity(tx, { companyId, actorType: "user", actorId: current.userId, action, entityType: "workflow", entityId: workflowId,
        details: { requestId: command.requestId, requestHash: hash, receipt } }, publications);
      await owner.getDetail(companyId, workflowId, current.actor); await lockWorkflowDraftAccount(tx, actor, companyId); return receipt;
    }),
  };
}
