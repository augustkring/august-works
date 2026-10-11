import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { activityLog, memoryJobs, type Db } from "@paperclipai/db";
import { executionPrincipalSchema, memoryMaintenanceHistorySchema, v9FeatureEnabled } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { memoryService, type MemoryMutationActor } from "../memory/memory-service.js";
import { memoryMaintenanceInputSchema } from "../memory/memory-maintenance.js";

const sourceSchema = z.strictObject({
  recordIds: memoryMaintenanceInputSchema.shape.recordIds,
  requester: executionPrincipalSchema,
  recordVersions: z.record(z.string(), z.iso.datetime()),
});
const resultSchema = z.strictObject({
  indexedRecordCount: z.number().int().min(1).max(64),
  provider: z.literal("native_postgres"),
  nativeIndexCurrent: z.literal(true),
});

/** Projection over original jobs and their atomic Activity Log postconditions.
 * No new ledger, executor, repair, permission, or claim of current readiness. */
export async function readMemoryMaintenanceHistory(db: Db, actor: AuthorizationActor, companyId: string) {
  const human = v5HumanActorId(actor);
  const current = { ...actor, isInstanceAdmin: false, ignoreInstanceAdmin: true };
  const memoryActor: MemoryMutationActor = { principal: actor.source === "local_implicit"
    ? { type: "system", service: "local-board" } : { type: "user", userId: human } };
  const started = performance.now();
  function budget() {
    if (performance.now() - started > 5000)
      throw conflict("Memory maintenance state changed; reload", { code: "memory_maintenance_history_stale" });
  }
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    await tx.execute(sql`set local statement_timeout='5s'`);
    await lockMemoryPrivacy(tx, companyId);
    async function access() {
      budget();
      const flags = await instanceSettingsService(tx).getExperimental();
      if (!v9FeatureEnabled(flags, "maintenance_autopilot_v9") || !flags.enableCollectiveMemoryV1)
        throw notFound("Memory maintenance history is unavailable");
      await assertV5Authorization(tx, current, companyId, "company_scope:read");
      if (!(await memoryService(tx).getRetentionPolicy(companyId, memoryActor)).canManage)
        throw forbidden("Memory maintenance history requires a current owner or administrator");
      budget();
    }
    await access();
    const jobs = await tx.select().from(memoryJobs).where(and(
      eq(memoryJobs.companyId, companyId), eq(memoryJobs.operationType, "index_refresh"),
      sql`${memoryJobs.jobKey} like 'maintenance:v1:%'`,
    )).orderBy(desc(memoryJobs.submittedAt), desc(memoryJobs.id)).limit(11).for("share");
    const ids = jobs.slice(0, 10).map((job) => job.id);
    // Eleven jobs and at most two receipts per job; duplicate bindings fail closed.
    const receipts = ids.length ? await tx.select().from(activityLog).where(and(
      eq(activityLog.companyId, companyId), eq(activityLog.entityType, "memory_job"),
      eq(activityLog.action, "memory.index_refresh_completed"), inArray(activityLog.entityId, ids),
    )).limit(21).for("share") : [];
    if (receipts.length > 20) throw notFound("Native Memory receipt bindings are unavailable");
    const [clock] = await tx.execute<{ observed_at: Date }>(sql`select clock_timestamp() as observed_at`);
    if (!clock) throw notFound("Memory maintenance observation is unavailable");
    const observedAt = new Date(clock.observed_at);
    const entries = jobs.slice(0, 10).map((job) => {
      budget();
      const source = sourceSchema.safeParse(job.sourceRefJson);
      let outcome: "queued" | "running" | "unconfirmed" | "review_required" |
        "verified_index_check" | "verification_unavailable" | "source_unavailable" = "source_unavailable";
      let receiptId: string | null = null, indexedRecordCount: number | null = null;
      if (source.success) {
        const actorId = source.data.requester.type === "user" ? source.data.requester.userId :
          source.data.requester.type === "system" && source.data.requester.service === "local-board" ? "local-board" : null;
        const original = receipts.filter((row) => row.entityId === job.id);
        const receipt = original[0];
        const result = resultSchema.safeParse(job.resultJson);
        const recorded = resultSchema.safeParse(receipt?.details);
        const sourceBound = actorId !== null &&
          source.data.recordIds.every((id) => source.data.recordVersions[id]) &&
          Object.keys(source.data.recordVersions).length === source.data.recordIds.length;
        if (!sourceBound) outcome = "source_unavailable";
        else if (job.status === "succeeded") {
          outcome = "verification_unavailable";
          if (job.startedAt && job.finishedAt && !job.leaseExpiresAt && original.length === 1 &&
            receipt!.actorType === source.data.requester.type && receipt!.actorId === actorId &&
            receipt!.createdAt >= job.startedAt && receipt!.createdAt <= job.finishedAt &&
            result.success && recorded.success && isDeepStrictEqual(result.data, recorded.data) &&
            result.data.indexedRecordCount === source.data.recordIds.length) {
            outcome = "verified_index_check";
            receiptId = receipt!.id;
            indexedRecordCount = result.data.indexedRecordCount;
          }
        } else if (job.status === "queued") outcome = "queued";
        else if (job.status === "running") outcome = job.leaseExpiresAt && job.leaseExpiresAt > observedAt ? "running" : "unconfirmed";
        else outcome = "review_required";
      }
      return { jobId: job.id, maintenanceClass: "M1" as const, attemptNumber: job.attemptNumber,
        submittedAt: job.submittedAt.toISOString(), startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null, leaseExpiresAt: job.leaseExpiresAt?.toISOString() ?? null,
        outcome, receiptId, indexedRecordCount };
    });
    await access();
    return memoryMaintenanceHistorySchema.parse({ companyId, observedAt: observedAt.toISOString(), hasMore: jobs.length > 10, entries });
  });
}
