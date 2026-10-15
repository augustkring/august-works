import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { activityLog, authUsers, workflows, type Db } from "@paperclipai/db";
import {
  workflowIntentDraftCommandSchema, workflowIntentDraftReceiptSchema,
  workflowExperienceIndexSchema, v9FeatureEnabled,
  type WorkflowIntentDraftCommand, type WorkflowIntentDraftReceipt,
} from "@paperclipai/shared";
import { HttpError, conflict, forbidden, notFound } from "../../errors.js";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { workflowService } from "../workflows/workflow-service.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { withExperienceAdmission } from "./admission.js";
import { ExperienceOverloadError } from "./projection.js";

const action = "workflow.experience_draft_created";
function identity(companyId: string, userId: string, requestId: string) {
  const hex = createHash("sha256").update(JSON.stringify([action, companyId, userId, requestId])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function description(input: WorkflowIntentDraftCommand) {
  const labels = input.locale === "da"
    ? ["Ønsket resultat", "Start eller gentagelse", "Datagrundlag", "Betingelser", "Tilsigtet slutresultat", "Menneskelig vurdering"]
    : ["Desired outcome", "Trigger or cadence", "Source objects", "Conditions", "Intended final effect", "Human judgment"];
  return [
    [labels[0], input.outcome], [labels[1], input.trigger],
    [labels[2], input.sources], [labels[3], input.conditions],
    [labels[4], input.finalEffect], [labels[5], input.humanJudgment],
  ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n\n");
}

/** Compose the Original workflow and Activity owners in one transaction.
 * Described intent never creates a schedule, graph, grant or model dispatch. */
export function workflowDraftIntentService(db: Db) {
  async function account(tx: Db, actor: AuthorizationActor, companyId: string, write = false) {
    const userId = v5HumanActorId(actor);
    if (actor.source === "local_implicit") throw forbidden("A verified current account is required");
    const currentActor = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false };
    await assertV5Authorization(tx, currentActor, companyId, "company_scope:read");
    await assertV5Authorization(tx, currentActor, companyId, "workflows:read");
    const query = tx.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, userId));
    const [user] = write ? await query.for("share") : await query;
    if (!user?.verified) throw forbidden("A verified current account is required");
    if (write) await assertV5Authorization(tx, currentActor, companyId, "workflows:edit");
    return { userId, currentActor };
  }
  async function enabled(tx: Db) {
    const flags = await instanceSettingsService(tx).getExperimental();
    if (flags.enableWorkflowsV1 !== true || !v9FeatureEnabled(flags, "progressive_shell_v9"))
      throw notFound("The customer workflow experience is not enabled");
  }
  async function original(tx: Db, actor: AuthorizationActor, companyId: string, requestId: string) {
    const { userId, currentActor } = await account(tx, actor, companyId);
    const workflowId = identity(companyId, userId, requestId);
    const rows = await tx.select({ details: activityLog.details }).from(activityLog).where(and(
      eq(activityLog.companyId, companyId), eq(activityLog.action, action),
      eq(activityLog.entityType, "workflow"), eq(activityLog.entityId, workflowId),
      eq(activityLog.actorType, "user"), eq(activityLog.actorId, userId),
    )).limit(2);
    if (!rows.length) throw notFound("The original draft request is unconfirmed");
    if (rows.length !== 1) throw conflict("The original draft request is inconsistent");
    const receipt = workflowIntentDraftReceiptSchema.parse(rows[0]!.details?.receipt);
    if (receipt.companyId !== companyId || receipt.workflowId !== workflowId || receipt.requestId !== requestId)
      throw conflict("The original draft receipt changed");
    const detail = await workflowService(tx).getDetail(companyId, workflowId, currentActor);
    if (!detail || detail.createdByUserId !== userId) throw notFound("The original workflow is unavailable");
    const revision = await workflowService(tx).getRevision(companyId, workflowId, receipt.draftRevisionId, currentActor);
    if (!revision || revision.createdByUserId !== userId) throw notFound("The original draft revision is unavailable");
    await account(tx, actor, companyId);
    return { receipt, requestHash: rows[0]!.details?.requestHash };
  }
  return {
    receipt: (actor: AuthorizationActor, companyId: string, requestId: string) =>
      db.transaction(async raw => {
        const tx = raw as unknown as Db;
        await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        return (await original(tx, actor, companyId, requestId)).receipt;
      }),
    create: async (actor: AuthorizationActor, companyId: string, raw: unknown) => {
      const input = workflowIntentDraftCommandSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const { userId, currentActor } = await account(tx, actor, companyId);
        const workflowId = identity(companyId, userId, input.requestId), requestHash = nativeSha256(input);
        const [existing] = await tx.select({ id: workflows.id }).from(workflows).where(and(
          eq(workflows.companyId, companyId), eq(workflows.id, workflowId),
        ));
        if (existing) {
          const retained = await original(tx, actor, companyId, input.requestId);
          if (retained.requestHash !== requestHash) throw conflict("The original draft request has different content");
          return retained.receipt;
        }
        // A surviving journal without its Native row must never authorize recreation.
        const [retained] = await tx.select({ id: activityLog.id }).from(activityLog).where(and(
          eq(activityLog.companyId, companyId), eq(activityLog.action, action), eq(activityLog.entityId, workflowId),
        )).limit(1);
        if (retained) throw conflict("The original workflow is unavailable; do not replace the request");
        await enabled(tx); await account(tx, actor, companyId, true);
        const created = await workflowService(tx).create(companyId, {
          name: input.name, description: description(input), projectId: null,
        }, { principal: { type: "user", userId }, runId: null }, { workflowId });
        const receipt: WorkflowIntentDraftReceipt = workflowIntentDraftReceiptSchema.parse({
          companyId, workflowId, requestId: input.requestId, draftRevisionId: created.draftRevisionId,
          createdAt: created.createdAt.toISOString(), executionStarted: false, published: false,
        });
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action,
          entityType: "workflow", entityId: workflowId, details: { requestHash, receipt } }, publications);
        await workflowService(tx).getDetail(companyId, workflowId, currentActor);
        await enabled(tx); await account(tx, actor, companyId, true);
        return receipt;
      });
    },
    index: (actor: AuthorizationActor, companyId: string) => withExperienceAdmission(signal => db.transaction(async raw => {
      const tx = raw as unknown as Db;
      await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
      signal.throwIfAborted();
      const { currentActor } = await account(tx, actor, companyId); await enabled(tx);
      const candidates = await tx.select({ id: workflows.id }).from(workflows)
        .where(eq(workflows.companyId, companyId)).orderBy(desc(workflows.updatedAt), desc(workflows.id)).limit(20);
      const visible = [];
      for (const candidate of candidates) {
        signal.throwIfAborted();
        try {
          const detail = await workflowService(tx).getDetail(companyId, candidate.id, currentActor);
          if (detail) visible.push({ id: detail.id, name: detail.name.slice(0, 200), description: detail.description?.slice(0, 600) ?? null,
            status: detail.status === "active" && !detail.publishedRevisionId ? "draft" as const : detail.status,
            updatedAt: detail.updatedAt.toISOString() });
        } catch (error) {
          // Current hidden source is omitted; unexpected failures remain failures.
          if (!(error instanceof HttpError) || ![403, 404].includes(error.status)) throw error;
        }
      }
      const canCreateDraft = (await authorizationService(tx).decide({ actor: currentActor,
        action: "workflows:edit", resource: { type: "company", companyId } })).allowed;
      await enabled(tx); await account(tx, actor, companyId);
      signal.throwIfAborted();
      return workflowExperienceIndexSchema.parse({ companyId, canCreateDraft, coverage: "bounded", workflows: visible });
    })).catch(error => {
      if (error instanceof ExperienceOverloadError) throw new HttpError(503, "The current workflow view is unavailable; try again");
      throw error;
    }),
  };
}
