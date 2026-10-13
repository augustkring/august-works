import { and, eq, sql } from "drizzle-orm";
import { activityLog, authUsers, companyMemberships, type Db } from "@paperclipai/db";
import { orchestrationControlCommandSchema, orchestrationControlReceiptSchema, orchestrationControlViewSchema } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { v7HumanActorId } from "../v7-authorization.js";
import { orchestrationService } from "../orchestration/orchestration-service.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { conflict, forbidden, notFound } from "../../errors.js";

/** Safety survives experience/runtime rollout and Source payload withdrawal.
 * Original plan CAS, administrative control and durable Stop outbox remain
 * the owners. The Activity receipt is content-free and cannot qualify delivery. */
export function orchestrationControlExperienceService(db: Db) {
  async function lock(tx: Db, companyId: string) {
    await tx.execute(sql`select set_config('statement_timeout','5000ms',true),set_config('lock_timeout','1000ms',true)`);
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
  }
  async function account(tx: Db, actor: AuthorizationActor, companyId: string) {
    const userId = v7HumanActorId(actor);
    if (actor.source === "local_implicit") throw forbidden("A verified account is required for customer work controls");
    const [user] = await tx.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, userId)).for("share");
    const [member] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"))).for("share");
    if (!user?.verified || !member) throw forbidden("Current verified company membership is required");
    return { userId, current: { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false } };
  }
  async function recorded(tx: Db, companyId: string, userId: string, planId: string, requestId: string) {
    const rows = await tx.select({ details: activityLog.details }).from(activityLog).where(and(eq(activityLog.companyId, companyId),
      eq(activityLog.actorType, "user"), eq(activityLog.actorId, userId), eq(activityLog.entityType, "orchestration_plan"),
      eq(activityLog.entityId, planId), eq(activityLog.action, "orchestration.experience_control_requested"),
      sql`${activityLog.details}->'receipt'->>'requestId'=${requestId}`)).limit(2);
    if (rows.length > 1) throw conflict("The Original control receipt is ambiguous");
    if (!rows.length) return null;
    const receipt = orchestrationControlReceiptSchema.parse(rows[0]!.details?.receipt);
    if (receipt.companyId !== companyId || receipt.planId !== planId || receipt.requestId !== requestId)
      throw conflict("The Original control receipt identity changed");
    return { receipt, hash: rows[0]!.details?.requestHash };
  }
  return {
    get: (actor: AuthorizationActor, companyId: string, planId: string) => db.transaction(async raw => {
      const tx = raw as unknown as Db; await lock(tx, companyId);
      const owner = await account(tx, actor, companyId);
      const view = orchestrationControlViewSchema.parse(await orchestrationService(tx).controlSummary(owner.current, companyId, planId));
      await account(tx, actor, companyId); return view;
    }),
    receipt: (actor: AuthorizationActor, companyId: string, planId: string, requestId: string) => db.transaction(async raw => {
      const tx = raw as unknown as Db; await lock(tx, companyId);
      const owner = await account(tx, actor, companyId);
      await orchestrationService(tx).controlSummary(owner.current, companyId, planId);
      const saved = await recorded(tx, companyId, owner.userId, planId, requestId);
      if (!saved) throw notFound("The Original control request is unconfirmed");
      await account(tx, actor, companyId); return saved.receipt;
    }),
    request: (actor: AuthorizationActor, companyId: string, planId: string, raw: unknown) => {
      const input = orchestrationControlCommandSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lock(tx, companyId);
        const owner = await account(tx, actor, companyId), native = orchestrationService(tx);
        const view = orchestrationControlViewSchema.parse(await native.controlSummary(owner.current, companyId, planId));
        const hash = nativeSha256(input), previous = await recorded(tx, companyId, owner.userId, planId, input.requestId);
        if (previous) {
          if (previous.hash !== hash) throw conflict("This control request identity has different content");
          return previous.receipt;
        }
        if (view.version !== input.expectedVersion || !(input.action === "pause" ? view.canPause : view.canStop))
          throw conflict("The current plan needs a fresh control review");
        const changed = await native.decideWithinTransaction(tx, publications, owner.current, companyId, planId,
          { expectedVersion: input.expectedVersion, action: input.action, rationale: input.rationale });
        const receipt = orchestrationControlReceiptSchema.parse({ companyId, planId, requestId: input.requestId,
          action: input.action, resultingVersion: changed.version, disposition: "control_requested", propagation: "pending_verification" });
        await logActivity(tx, { companyId, actorType: "user", actorId: owner.userId, action: "orchestration.experience_control_requested",
          entityType: "orchestration_plan", entityId: planId, details: { requestHash: hash, receipt } }, publications);
        await account(tx, actor, companyId);
        await native.controlSummary(owner.current, companyId, planId);
        return receipt;
      });
    },
  };
}
