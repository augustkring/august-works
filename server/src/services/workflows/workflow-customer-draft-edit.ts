import { and, eq, sql } from "drizzle-orm";
import { activityLog, authUsers, workflows, type Db } from "@paperclipai/db";
import { workflowDraftStepCommandSchema, workflowDraftStepReceiptSchema, workflowDraftStepReviewSchema,
  workflowEditableNodeIdSchema, workflowStepConfigurationChangeSchema, type WorkflowDraftStepCommand } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import { workflowService } from "./workflow-service.js";
import { lockCustomerWorkflowControlAuthority, lockCustomerWorkflowReceiptAuthority } from "./workflow-customer-authority.js";
import { v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import type { AuthorizationActor } from "../authorization.js";

const action = "workflow.customer_draft_step_saved";
/** Compose Original revision and Activity owners; no graph, runtime or grant
 * store is introduced. Commands edit one selected current draft node only. */
export function workflowCustomerDraftEdit(db: Db) {
  async function authority(tx: Db, rawActor: AuthorizationActor, companyId: string, historical = false) {
    const actor = { ...rawActor, isInstanceAdmin: false }, userId = v5HumanActorId(actor);
    if (actor.source === "local_implicit") throw forbidden("A current verified account is required");
    await (historical ? lockCustomerWorkflowReceiptAuthority : lockCustomerWorkflowControlAuthority)(tx, companyId, actor, ["workflows:read", "workflows:edit"]);
    const [user] = await tx.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, userId)).for("share");
    if (!user?.verified) throw forbidden("A current verified account is required");
    if (!historical && !(await instanceSettingsService(tx).getExperimental()).enableWorkflowBuilderV1) throw notFound("Workflow draft editing is not enabled");
    return { actor, userId };
  }
  async function prior(tx: Db, companyId: string, workflowId: string, requestId: string, actor: AuthorizationActor) {
    const { actor: current, userId } = await authority(tx, actor, companyId, true);
    const rows = await tx.select({ details: activityLog.details }).from(activityLog).where(and(eq(activityLog.companyId, companyId),
      eq(activityLog.entityType, "workflow"), eq(activityLog.entityId, workflowId), eq(activityLog.action, action),
      eq(activityLog.actorType, "user"), eq(activityLog.actorId, userId), sql`${activityLog.details}->>'requestId'=${requestId}`)).limit(2);
    if (!rows.length) return null;
    if (rows.length !== 1) throw conflict("The Original draft request is inconsistent");
    const receipt = workflowDraftStepReceiptSchema.parse(rows[0].details?.receipt);
    if (receipt.companyId !== companyId || receipt.workflowId !== workflowId || receipt.requestId !== requestId) throw conflict("The Original draft request identity changed");
    const owner = workflowService(tx);
    const before = await owner.getRevision(companyId, workflowId, receipt.previousRevisionId, current);
    const after = await owner.getRevision(companyId, workflowId, receipt.draftRevisionId, current);
    if (!before || !after || after.revisionNumber !== receipt.version || receipt.changed && after.createdByUserId !== userId)
      throw notFound("The Original draft request source is unavailable");
    await authority(tx, actor, companyId, true);
    return { receipt, hash: rows[0].details?.requestHash };
  }
  return {
    receipt: (companyId: string, workflowId: string, requestId: string, actor: AuthorizationActor) => db.transaction(async raw => {
      const value = await prior(raw as unknown as Db, companyId, workflowId, workflowDraftStepCommandSchema.shape.requestId.parse(requestId), actor);
      if (!value) throw notFound("The Original draft request is unconfirmed"); return value.receipt;
    }),
    review: (companyId: string, workflowId: string, rawNodeId: string, actor: AuthorizationActor) => db.transaction(async raw => {
      const tx = raw as unknown as Db, nodeId = workflowEditableNodeIdSchema.parse(rawNodeId), current = await authority(tx, actor, companyId);
      await tx.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId))).for("share");
      const detail = await workflowService(tx).getDetail(companyId, workflowId, current.actor), draft = detail?.draftRevision;
      if (!detail || detail.status === "archived" || !draft || draft.state !== "draft" || draft.graph.nodes.length > 100 || draft.graph.edges.length > 200)
        throw notFound("The current draft step is unavailable");
      const nodes = draft.graph.nodes.filter(node => node.id === nodeId);
      if (nodes.length !== 1) throw notFound("The current draft step is unavailable");
      const node = nodes[0], config = node.config && typeof node.config === "object" && !Array.isArray(node.config) ? node.config : {};
      const parsed = workflowStepConfigurationChangeSchema.safeParse({ kind: node.type === "core.wait" ? "wait" : node.type === "human.approval" ? "approval" : "advanced", ...config });
      const configuration = parsed.success && parsed.data.kind !== "keep" ? parsed.data : { kind: "advanced" as const };
      await authority(tx, actor, companyId);
      return workflowDraftStepReviewSchema.parse({ companyId, workflowId, draftRevisionId: draft.id, publishedRevisionId: detail.publishedRevisionId,
        updatedAt: detail.updatedAt.toISOString(), version: draft.revisionNumber, nodeId, nodeType: node.type, name: node.name, configuration });
    }),
    save: (companyId: string, workflowId: string, rawCommand: WorkflowDraftStepCommand, actor: AuthorizationActor) => withV7ActivityTransaction(db, async (tx, publications) => {
      const command = workflowDraftStepCommandSchema.parse(rawCommand), requestHash = nativeSha256(command);
      const retained = await prior(tx, companyId, workflowId, command.requestId, actor);
      if (retained) {
        if (retained.hash !== requestHash) throw conflict("The Original draft request has different content", { code: "workflow_draft_request_conflict" });
        return retained.receipt;
      }
      const current = await authority(tx, actor, companyId);
      await tx.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId))).for("update");
      const owner = workflowService(tx), detail = await owner.getDetail(companyId, workflowId, current.actor), draft = detail?.draftRevision;
      if (!detail || detail.status === "archived" || !draft || draft.state !== "draft" || command.expectedWorkflowId !== workflowId ||
        command.expectedDraftRevisionId !== draft.id || command.expectedPublishedRevisionId !== detail.publishedRevisionId || command.expectedUpdatedAt !== detail.updatedAt.toISOString())
        throw conflict("The draft changed; review its current step", { code: "workflow_draft_step_conflict" });
      const nodes = draft.graph.nodes.filter(node => node.id === command.expectedNodeId);
      if (nodes.length !== 1 || nodes[0].type !== command.expectedNodeType || draft.graph.nodes.length > 100 || draft.graph.edges.length > 200)
        throw conflict("The draft step changed; review its current owner", { code: "workflow_draft_step_conflict" });
      const node = nodes[0], change = command.configuration;
      if (change.kind !== "keep" && node.type !== (change.kind === "wait" ? "core.wait" : "human.approval"))
        throw conflict("The draft step configuration changed", { code: "workflow_draft_step_conflict" });
      // Name-only edits preserve every original config, input, retry and branch.
      // Guided config edits refuse a shape that the review cannot fully expose.
      if (change.kind !== "keep") {
        const config = node.config && typeof node.config === "object" && !Array.isArray(node.config) ? node.config : {};
        if (!workflowStepConfigurationChangeSchema.safeParse({ kind: change.kind, ...config }).success)
          throw conflict("This configuration needs its current Advanced editor", { code: "workflow_draft_step_conflict" });
      }
      const configuration = change.kind === "keep" ? node.config : change.kind === "wait" ? { durationSeconds: change.durationSeconds } : { summary: change.summary, consequence: change.consequence };
      const saved = await owner.updateDraft(companyId, workflowId, { expectedRevisionId: draft.id,
        graph: { ...draft.graph, nodes: draft.graph.nodes.map(value => value.id === node.id ? { ...value, name: command.name, config: configuration } : value) },
      }, { principal: { type: "user", userId: current.userId } });
      const receipt = workflowDraftStepReceiptSchema.parse({ companyId, workflowId, requestId: command.requestId,
        previousRevisionId: draft.id, draftRevisionId: saved.draftRevisionId, version: saved.draftRevision!.revisionNumber,
        changed: saved.draftRevisionId !== draft.id, recordedAt: new Date().toISOString(), published: false, executionStarted: false });
      await logActivity(tx, { companyId, actorType: "user", actorId: current.userId, action, entityType: "workflow", entityId: workflowId,
        details: { requestId: command.requestId, requestHash, receipt } }, publications);
      await owner.getDetail(companyId, workflowId, current.actor); await authority(tx, actor, companyId);
      return receipt;
    }),
  };
}
