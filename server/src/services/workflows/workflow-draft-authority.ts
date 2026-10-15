import { and, eq, sql } from "drizzle-orm";
import { activityLog, authUsers, type Db } from "@paperclipai/db";
import { workflowDraftStepReceiptSchema } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import { workflowService } from "./workflow-service.js";
import { lockCustomerWorkflowControlAuthority, lockCustomerWorkflowReceiptAuthority } from "./workflow-customer-authority.js";
import { v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import type { AuthorizationActor } from "../authorization.js";

/** Shared current-account and retained-receipt composition for Original draft
 * mutations. Native membership, grants, source and revision owners remain final. */
export async function lockWorkflowDraftAccount(tx: Db, rawActor: AuthorizationActor, companyId: string, historical = false) {
  const actor = { ...rawActor, isInstanceAdmin: false }, userId = v5HumanActorId(actor);
  if (actor.source === "local_implicit") throw forbidden("A current verified account is required");
  await (historical ? lockCustomerWorkflowReceiptAuthority : lockCustomerWorkflowControlAuthority)(tx, companyId, actor, ["workflows:read", "workflows:edit"]);
  const [user] = await tx.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, userId)).for("share");
  if (!user?.verified) throw forbidden("A current verified account is required");
  if (!historical && !(await instanceSettingsService(tx).getExperimental()).enableWorkflowBuilderV1) throw notFound("Workflow draft editing is not enabled");
  return { actor, userId };
}
export async function originalWorkflowDraftReceipt(tx: Db, companyId: string, workflowId: string, requestId: string, actor: AuthorizationActor, action: string) {
  const { actor: current, userId } = await lockWorkflowDraftAccount(tx, actor, companyId, true);
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
  await lockWorkflowDraftAccount(tx, actor, companyId, true);
  return { receipt, hash: rows[0].details?.requestHash };
}
