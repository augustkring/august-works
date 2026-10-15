import { performance } from "node:perf_hooks";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { authUsers, companies, companyMemberships, memoryJobs, type Db } from "@paperclipai/db";
import { v9FeatureEnabled, type ExperienceCard } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { memoryService } from "../memory/memory-service.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { conflict, forbidden, notFound } from "../../errors.js";

/** M1 observation of an unsettled Original index job. Lease expiry is an
 * unconfirmed outcome, never termination, failure, a retry or repair authority.
 * Historical failures and completed jobs do not create current incidents. */
export async function readMemoryMaintenanceAttention(db: Db, actor: AuthorizationActor, companyId: string, signal: AbortSignal): Promise<{
  needsYou: ExperienceCard[]; coverage?: { state: "partial"; reason: "more_items_available" };
}> {
  const userId = v5HumanActorId(actor);
  if (actor.source === "local_implicit") throw forbidden("A verified current Memory manager is required");
  const current = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false }, started = performance.now();
  const budget = () => {
    signal.throwIfAborted();
    if (performance.now() - started > 1500) throw conflict("Memory maintenance source review expired");
  };
  return db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await tx.execute(sql`set local statement_timeout='1500ms'`);
    await tx.execute(sql`set local lock_timeout='250ms'`);
    await lockMemoryPrivacy(tx, companyId);
    async function access() {
      budget();
      const flags = await instanceSettingsService(tx).getExperimental();
      if (!v9FeatureEnabled(flags, "maintenance_autopilot_v9") || !flags.enableCollectiveMemoryV1)
        throw notFound("Memory maintenance attention is unavailable");
      await assertV5Authorization(tx, current, companyId, "company_scope:read");
      const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("share");
      const [member] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"))).for("share");
      const [user] = await tx.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, userId)).for("share");
      if (!company || company.status === "archived" || !member || !user?.verified ||
        !(await memoryService(tx).getRetentionPolicy(companyId, { principal: { type: "user", userId } })).canManage)
        throw forbidden("Current verified Memory management authority is required");
      budget();
    }
    await access();
    // Select metadata only. Private source references, result/error prose,
    // record bodies and credentials never enter the experience projection.
    const jobs = await tx.select({ id: memoryJobs.id, attemptNumber: memoryJobs.attemptNumber,
      startedAt: memoryJobs.startedAt, leaseExpiresAt: memoryJobs.leaseExpiresAt, updatedAt: memoryJobs.updatedAt })
      .from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.operationType, "index_refresh"),
        eq(memoryJobs.status, "running"), sql`${memoryJobs.jobKey} like 'maintenance:v1:%'`,
        or(isNull(memoryJobs.leaseExpiresAt), sql`${memoryJobs.leaseExpiresAt} <= clock_timestamp()`)))
      .orderBy(desc(memoryJobs.submittedAt), desc(memoryJobs.id)).limit(11).for("share");
    const needsYou: ExperienceCard[] = jobs.slice(0, 10).map(job => {
      budget();
      const source = { domain: "memory_job" as const, companyId, resourceId: job.id,
        version: nativeSha256({ userId, ...job, startedAt: job.startedAt?.toISOString() ?? null,
          leaseExpiresAt: job.leaseExpiresAt?.toISOString() ?? null, updatedAt: job.updatedAt.toISOString() }),
        observedAt: new Date().toISOString() };
      return { id: `memory-maintenance:${job.id}`, kind: "maintenance", source, freshness: "fresh",
        title: "Review an unconfirmed knowledge index check", whyYou: "You manage this company's approved memory.",
        consequence: "The original index job has no current execution lease. Review its original state before another attempt.",
        evidence: ["memory_index_outcome_unconfirmed"], actions: [{ id: "review-memory-index", label: "Review index history",
          labelKey: "review", operation: "open", href: `/memory/maintenance?jobId=${job.id}`, criticality: "C2", source,
          requiresCurrentAuthorization: true }] };
    });
    await access();
    return { needsYou, ...(jobs.length > 10 ? { coverage: { state: "partial" as const, reason: "more_items_available" as const } } : {}) };
  });
}
