import { and, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { workflows, type Db } from "@paperclipai/db";
import { workflowDraftStepCommandSchema, workflowDraftStepReceiptSchema, workflowDraftStepReviewSchema,
  workflowEditableNodeIdSchema, workflowToolArgumentErrors, type WorkflowDraftStepCommand } from "@paperclipai/shared";
import { conflict, notFound } from "../../errors.js";
import { workflowService } from "./workflow-service.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import type { AuthorizationActor } from "../authorization.js";
import { lockWorkflowDraftAccount, originalWorkflowDraftReceipt } from "./workflow-draft-authority.js";
import { guidedConditionExpression, reviewGuidedCondition } from "./workflow-guided-condition.js";
import { reviewWorkflowStepInput } from "./workflow-step-input-review.js";
import { assertDraftAgentSelection, reviewDraftAgentSelection } from "./workflow-draft-agents.js";
import { z } from "zod";
import { readWorkflowStepContext, type WorkflowStepReadAdmission } from "../experience/workflow-step-actors.js";
import { validateWorkflowOutput } from "./workflow-output-schema.js";

const action = "workflow.customer_draft_step_saved";
/** Compose Original revision and Activity owners; no graph, runtime or grant
 * store is introduced. Commands edit one selected current draft node only. */
export function workflowCustomerDraftEdit(db: Db) {
  const prior = (tx: Db, company: string, workflow: string, request: string, actor: AuthorizationActor) => originalWorkflowDraftReceipt(tx, company, workflow, request, actor, action);
  return {
    receipt: (companyId: string, workflowId: string, requestId: string, actor: AuthorizationActor) => db.transaction(async raw => {
      const value = await prior(raw as unknown as Db, companyId, workflowId, workflowDraftStepCommandSchema.shape.requestId.parse(requestId), actor);
      if (!value) throw notFound("The Original draft request is unconfirmed"); return value.receipt;
    }),
    review: (companyId: string, workflowId: string, rawNodeId: string, actor: AuthorizationActor, admission?: WorkflowStepReadAdmission) => db.transaction(async raw => {
      const tx = raw as unknown as Db, nodeId = workflowEditableNodeIdSchema.parse(rawNodeId), current = await lockWorkflowDraftAccount(tx, actor, companyId);
      await tx.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId))).for("share");
      const detail = await workflowService(tx).getDetail(companyId, workflowId, current.actor), draft = detail?.draftRevision;
      if (!detail || detail.status === "archived" || !draft || draft.state !== "draft" || draft.graph.nodes.length > 100 || draft.graph.edges.length > 200)
        throw notFound("The current draft step is unavailable");
      const nodes = draft.graph.nodes.filter(node => node.id === nodeId);
      if (nodes.length !== 1) throw notFound("The current draft step is unavailable");
      const node = nodes[0];
      const toolContext = node.type === "connector.action" ? await readWorkflowStepContext(tx, detail, current.actor, { revisionId: draft.id, nodeId: node.id }, admission) : null;
      const configuration = toolContext ? toolContext.toolInputs.get(`${draft.id}:${node.id}`) ?? { kind: "advanced" as const } : reviewWorkflowStepInput(node);
      const toolAccess = toolContext?.toolAccess.get(`${draft.id}:${node.id}`);
      const agentSelection = configuration.kind === "agent_task" ? await reviewDraftAgentSelection(tx, companyId, current.actor,
        z.uuid().parse((node.config as Record<string, unknown>).agentId)) : null;
      await lockWorkflowDraftAccount(tx, actor, companyId);
      admission?.signal.throwIfAborted();
      return workflowDraftStepReviewSchema.parse({ companyId, workflowId, draftRevisionId: draft.id, publishedRevisionId: detail.publishedRevisionId,
        updatedAt: detail.updatedAt.toISOString(), version: draft.revisionNumber, nodeId, nodeType: node.type, name: node.name, configuration,
        ...(agentSelection ? { agentSelection } : {}), ...(toolAccess ? { toolAccess } : {}) });
    }),
    save: (companyId: string, workflowId: string, rawCommand: WorkflowDraftStepCommand, actor: AuthorizationActor) => withV7ActivityTransaction(db, async (tx, publications) => {
      const command = workflowDraftStepCommandSchema.parse(rawCommand), requestHash = nativeSha256(command);
      const retained = await prior(tx, companyId, workflowId, command.requestId, actor);
      if (retained) {
        if (retained.hash !== requestHash) throw conflict("The Original draft request has different content", { code: "workflow_draft_request_conflict" });
        return retained.receipt;
      }
      const current = await lockWorkflowDraftAccount(tx, actor, companyId);
      await tx.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId))).for("update");
      const owner = workflowService(tx), detail = await owner.getDetail(companyId, workflowId, current.actor), draft = detail?.draftRevision;
      if (!detail || detail.status === "archived" || !draft || draft.state !== "draft" || command.expectedWorkflowId !== workflowId ||
        command.expectedDraftRevisionId !== draft.id || command.expectedPublishedRevisionId !== detail.publishedRevisionId || command.expectedUpdatedAt !== detail.updatedAt.toISOString())
        throw conflict("The draft changed; review its current step", { code: "workflow_draft_step_conflict" });
      const nodes = draft.graph.nodes.filter(node => node.id === command.expectedNodeId);
      if (nodes.length !== 1 || nodes[0].type !== command.expectedNodeType || draft.graph.nodes.length > 100 || draft.graph.edges.length > 200)
        throw conflict("The draft step changed; review its current owner", { code: "workflow_draft_step_conflict" });
      const node = nodes[0], change = command.configuration;
      if (change.kind !== "keep" && node.type !== (change.kind === "wait" ? "core.wait" : change.kind === "condition" ? "core.condition" : change.kind === "agent_task" ? "agent.task" : change.kind === "connected_tool" ? "connector.action" : "human.approval"))
        throw conflict("The draft step configuration changed", { code: "workflow_draft_step_conflict" });
      // Name-only edits preserve every original config, input, retry and branch.
      // Guided config edits refuse a shape that the review cannot fully expose.
      if (change.kind !== "keep" && change.kind !== "connected_tool") {
        if (reviewWorkflowStepInput(node).kind !== change.kind)
          throw conflict("This configuration needs its current Advanced editor", { code: "workflow_draft_step_conflict" });
      }
      if (change.kind === "connected_tool") {
        const context = await readWorkflowStepContext(tx, detail, current.actor, { revisionId: draft.id, nodeId: node.id }), key = `${draft.id}:${node.id}`;
        const review = context.toolInputs.get(key), schema = context.toolInputSchemas.get(key);
        if (review?.kind !== "connected_tool" || review.inputSchemaHash !== change.inputSchemaHash || !schema || workflowToolArgumentErrors(review.fields, change.input).length)
          throw conflict("The connected input definition changed; review the current step", { code: "workflow_draft_step_conflict" });
        try { validateWorkflowOutput(schema, change.input); }
        catch { throw conflict("The values do not match this operation's current inputs", { code: "workflow_draft_step_conflict" }); }
      }
      if (change.kind === "agent_task" && change.agentId) {
        await assertDraftAgentSelection(tx, companyId, current.actor, change.agentId,
          () => conflict("The selected Agent is unavailable; review the current choice", { code: "workflow_draft_step_conflict" }));
      }
      const configuration = change.kind === "keep" ? node.config : change.kind === "connected_tool" ? { ...(node.config as Record<string, unknown>), input: change.input } : change.kind === "wait" ? { durationSeconds: change.durationSeconds }
        : change.kind === "agent_task" ? { ...(node.config as Record<string, unknown>), objective: change.objective, ...(change.agentId ? { agentId: change.agentId } : {}) }
        : change.kind === "condition" ? isDeepStrictEqual(change, reviewGuidedCondition(node.config)) ? node.config : { expression: guidedConditionExpression(change) }
        : { summary: change.summary, consequence: change.consequence };
      const saved = await owner.updateDraft(companyId, workflowId, { expectedRevisionId: draft.id,
        graph: { ...draft.graph, nodes: draft.graph.nodes.map(value => value.id === node.id ? { ...value, name: command.name, config: configuration } : value) },
      }, { principal: { type: "user", userId: current.userId } });
      const receipt = workflowDraftStepReceiptSchema.parse({ companyId, workflowId, requestId: command.requestId,
        previousRevisionId: draft.id, draftRevisionId: saved.draftRevisionId, version: saved.draftRevision!.revisionNumber,
        changed: saved.draftRevisionId !== draft.id, recordedAt: new Date().toISOString(), published: false, executionStarted: false });
      await logActivity(tx, { companyId, actorType: "user", actorId: current.userId, action, entityType: "workflow", entityId: workflowId,
        details: { requestId: command.requestId, requestHash, receipt } }, publications);
      await owner.getDetail(companyId, workflowId, current.actor); await lockWorkflowDraftAccount(tx, actor, companyId);
      return receipt;
    }),
  };
}
