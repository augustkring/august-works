import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { assertSaasDomainAdmission } from "../saas/domain-admission.js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { cognitiveMemoryActor } from "./cognitive-memory.js";
import { assertAnalyticalContextPayloadAccess } from "../analytical-context-authority.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { providerTraceStore } from "../provider-trace-store.js";
import { getRunLogStore, type RunLogStore } from "../run-log-store.js";
import { isDeepStrictEqual } from "node:util";
import { executeMemoryMaintenance, memoryMaintenanceInputSchema, memoryMaintenanceSources } from "./memory-maintenance.js";
import { executeModelRebuild } from "./derived-memory.js";
import { memoryService, type MemoryMutationActor } from "./memory-service.js";
import { conflict, HttpError, unprocessable } from "../../errors.js";
import { publishActivity, type ActivityPublication } from "../activity-log.js";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  heartbeatRuns,
  activityLog,
  memoryModels,
  memoryObservations,
  memoryJobs,
  memoryRecords,
  memoryRetentionPolicies,
  memoryDeletionMarkers,
} from "@paperclipai/db";
import type { MemoryJobOperationType } from "@paperclipai/shared";
import { executionPrincipalSchema, type MemoryScope } from "@paperclipai/shared";
import { isUniqueViolation } from "../../db-errors.js";
import { logger } from "../../middleware/logger.js";
import { instanceSettingsService } from "../instance-settings.js";
import { memoryPostRunExtractionService } from "./memory-post-run-extraction.js";
import { canActorReadMemorySources, expireMemoryPayloads, lockMemoryPrivacy, reapplyMemoryDeletionMarkers, type NativeMemoryCaptureReceipt } from "./memory-privacy.js";

const MEMORY_JOB_VERSION = "v1";
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TICK_LIMIT = 10;
const BACKSTOP_RUN_SCAN_LIMIT = 100;
const RETENTION_COMPANY_LIMIT = 50;

type MemoryJob = typeof memoryJobs.$inferSelect;
type HeartbeatRun = typeof heartbeatRuns.$inferSelect;

const jobRecordIds = z.array(z.uuid()).min(1).max(64).refine(ids => new Set(ids).size === ids.length);
const jobOptionalIds = z.array(z.uuid()).max(64).refine(ids => new Set(ids).size === ids.length);
const jobRequester = executionPrincipalSchema.refine(value => value.type === "user" || value.type === "system" && value.service === "local-board");
const maintenanceReadSource = z.strictObject({ recordIds: jobRecordIds, requester: jobRequester,
  proposedLesson: memoryMaintenanceInputSchema.shape.proposedLesson, recordVersions: z.record(z.string(), z.iso.datetime()) });
const indexReadResult = z.strictObject({ indexedRecordCount: z.number().int().min(1).max(64), provider: z.literal("native_postgres"), nativeIndexCurrent: z.literal(true) });
const modelReadSource = z.strictObject({ modelId: z.uuid(), expectedVersion: z.number().int().positive(),
  memoryRecordIds: jobOptionalIds, observationIds: jobOptionalIds,
  recordIds: jobRecordIds, sourceWatermark: z.string().regex(/^[a-f0-9]{64}$/), requester: jobRequester });

async function assertMemoryJobReader(db: Db, companyId: string, actor: AuthorizationActor | undefined, deadline: number) {
  assertMemoryJobReadBudget(deadline);
  if (!actor) throw new HttpError(403, "A current Memory operator is required");
  v5HumanActorId(actor);
  await assertV5Authorization(db, { ...actor, isInstanceAdmin: false, ignoreInstanceAdmin: true }, companyId, "company_scope:read");
  assertMemoryJobReadBudget(deadline);
  if (!(await memoryService(db).getRetentionPolicy(companyId, cognitiveMemoryActor(actor))).canManage)
    throw new HttpError(403, "A current Memory administrator is required");
  assertMemoryJobReadBudget(deadline);
}

function assertMemoryJobReadBudget(deadline: number) {
  if (performance.now() > deadline) throw conflict("Memory job source review exceeded its budget");
}

async function memoryJobSourcesReadable(db: Db, companyId: string, actor: AuthorizationActor, job: MemoryJob, deadline: number): Promise<boolean> {
  assertMemoryJobReadBudget(deadline);
  if (job.sourceMemoryRecordId && !await canActorReadMemorySources(db, companyId, actor, job.sourceMemoryRecordId)) return false;
  assertMemoryJobReadBudget(deadline);
  if (job.sourceHeartbeatRunId) await assertAnalyticalContextPayloadAccess(db, companyId, actor, { runId: job.sourceHeartbeatRunId });
  assertMemoryJobReadBudget(deadline);
  if (job.operationType === "capture") {
    const source = z.strictObject({ kind: z.literal("heartbeat_run"), runId: z.uuid(), extractionEnabledAtAdmission: z.boolean() }).safeParse(job.sourceRefJson);
    if (!source.success || source.data.runId !== job.sourceHeartbeatRunId || job.sourceMemoryRecordId || job.jobKey !== captureJobKey(source.data.runId)) return false;
    const [run] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, source.data.runId), eq(heartbeatRuns.status, "succeeded")));
    assertMemoryJobReadBudget(deadline);
    if (!run) return false;
    if (job.status !== "succeeded") return job.resultJson === null;
    const count = z.number().int().min(0).max(10000);
    const result = z.strictObject({ runId: z.uuid(), proposed: count, persisted: count, duplicates: count,
      corroborations: count, updates: count, contradictions: count, skipped: count,
      skipReasons: z.record(z.string().max(100), count).refine(value => Object.keys(value).length <= 32) }).safeParse(job.resultJson);
    return result.success && result.data.runId === run.id;
  }
  if (job.sourceHeartbeatRunId || job.sourceMemoryRecordId) return false;
  if (job.operationType === "model_rebuild") {
    const parsed = modelReadSource.safeParse(job.sourceRefJson); if (!parsed.success) return false;
    const source = parsed.data;
    if (job.jobKey !== `model-rebuild:${source.modelId}:${source.expectedVersion}:${source.sourceWatermark}`) return false;
    const [model] = await db.select().from(memoryModels).where(and(eq(memoryModels.companyId, companyId), eq(memoryModels.id, source.modelId)));
    assertMemoryJobReadBudget(deadline);
    if (!model || model.erasedAt || model.status === "revoked") return false;
    const { derivedRoots, observationLineage, modelLineage } = await import("./derived-memory.js");
    assertMemoryJobReadBudget(deadline);
    const roots = await derivedRoots(db, actor, companyId, { type: model.scopeType as MemoryScope["type"], id: model.scopeId }, model.purpose, source.recordIds, undefined, () => assertMemoryJobReadBudget(deadline));
    assertMemoryJobReadBudget(deadline);
    const observations = [];
    const complete = new Set(source.memoryRecordIds);
    for (const id of source.observationIds) {
      assertMemoryJobReadBudget(deadline);
      const [row] = await db.select().from(memoryObservations).where(and(eq(memoryObservations.companyId, companyId), eq(memoryObservations.id, id)));
      assertMemoryJobReadBudget(deadline);
      if (!row || row.status !== "accepted" || row.erasedAt || row.scopeType !== model.scopeType || row.scopeId !== model.scopeId || row.purpose !== model.purpose) return false;
      const lineage = await observationLineage(db, actor, row, () => assertMemoryJobReadBudget(deadline));
      assertMemoryJobReadBudget(deadline);
      lineage.roots.forEach(root => complete.add(root.id)); observations.push(row);
    }
    if (JSON.stringify([...complete].sort()) !== JSON.stringify([...source.recordIds].sort())) return false;
    const watermark = nativeSha256({ roots: roots.map(root => ({ id: root.id, version: root.updatedAt.toISOString() })),
      observations: observations.map(row => ({ id: row.id, version: row.version })).sort((a, b) => a.id.localeCompare(b.id)) });
    if (watermark !== source.sourceWatermark) return false;
    if (job.status === "succeeded") {
      const result = z.strictObject({ modelId: z.uuid(), version: z.number().int().positive(), status: z.literal("candidate"), sourceWatermark: z.string() }).safeParse(job.resultJson);
      if (!result.success || result.data.modelId !== model.id || result.data.version !== source.expectedVersion + 1 || model.version !== result.data.version || result.data.sourceWatermark !== watermark) return false;
      await modelLineage(db, actor, model, () => assertMemoryJobReadBudget(deadline));
      assertMemoryJobReadBudget(deadline);
    } else if (model.version !== source.expectedVersion || job.resultJson !== null) return false;
    return true;
  }
  if (!["dedupe", "compaction", "reflection", "index_refresh"].includes(job.operationType) || !job.jobKey.startsWith("maintenance:v1:")) return false;
  const parsed = maintenanceReadSource.safeParse(job.sourceRefJson); if (!parsed.success) return false;
  const source = parsed.data;
  if ((job.operationType === "reflection") !== !!source.proposedLesson || Object.keys(source.recordVersions).length !== source.recordIds.length) return false;
  for (const id of source.recordIds) {
    assertMemoryJobReadBudget(deadline);
    const [row] = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, id)));
    assertMemoryJobReadBudget(deadline);
    if (!row || source.recordVersions[id] !== row.updatedAt.toISOString() || !await canActorReadMemorySources(db, companyId, actor, id)) return false;
    assertMemoryJobReadBudget(deadline);
  }
  if (job.status !== "succeeded") return job.resultJson === null;
  if (job.operationType === "index_refresh") {
    const result = indexReadResult.safeParse(job.resultJson);
    return result.success && result.data.indexedRecordCount === source.recordIds.length;
  }
  if (job.operationType === "dedupe") {
    // Dedupe can itself change source versions. Do not fabricate a post-effect
    // receipt by ignoring the original exact versions checked above.
    const result = z.strictObject({ scannedRecordCount: z.number().int().min(1).max(64), supersededCount: z.number().int().min(0).max(64), canonicalRecordCount: z.number().int().min(1).max(64) }).safeParse(job.resultJson);
    return result.success && result.data.scannedRecordCount === source.recordIds.length && result.data.supersededCount + result.data.canonicalRecordCount === result.data.scannedRecordCount;
  }
  const result = z.strictObject({ proposedRecordId: z.uuid(), reviewState: z.enum(["pending", "accepted", "rejected"]), sourceRecordCount: z.number().int().min(1).max(64) }).safeParse(job.resultJson);
  return result.success && result.data.sourceRecordCount === source.recordIds.length && await canActorReadMemorySources(db, companyId, actor, result.data.proposedRecordId);
}

/** Actual persisted job sources, never event details or a historical requester grant. */
export async function canActorReadMemoryJob(db: Db, companyId: string, actor: AuthorizationActor | undefined, jobId: string): Promise<boolean> {
  return readMemoryJobBeforeDeadline(db, companyId, actor, jobId, performance.now() + 5000);
}
async function readMemoryJobBeforeDeadline(db: Db, companyId: string, actor: AuthorizationActor | undefined, jobId: string, deadline: number): Promise<boolean> {
  if (!z.uuid().safeParse(jobId).success || !z.uuid().safeParse(companyId).success) return false;
  try {
    return await db.transaction(async tx => {
      assertMemoryJobReadBudget(deadline);
      await tx.execute(sql`set local statement_timeout='5s'`);
      assertMemoryJobReadBudget(deadline);
      await lockAnalyticalCompany(tx, companyId);
      assertMemoryJobReadBudget(deadline);
      await lockMemoryPrivacy(tx, companyId);
      assertMemoryJobReadBudget(deadline);
      await assertMemoryJobReader(tx, companyId, actor, deadline);
      assertMemoryJobReadBudget(deadline);
      const [job] = await tx.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.id, jobId))).for("share");
      assertMemoryJobReadBudget(deadline);
      if (!job || !await memoryJobSourcesReadable(tx, companyId, actor!, job, deadline)) return false;
      assertMemoryJobReadBudget(deadline);
      await assertMemoryJobReader(tx, companyId, actor, deadline);
      assertMemoryJobReadBudget(deadline);
      return true;
    });
  } catch (error) {
    if (error instanceof HttpError && [403, 404, 409, 422].includes(error.status)) return false;
    throw error;
  }
}

async function ownIndexTombstoneReadable(db: Db, actor: AuthorizationActor | undefined, job: MemoryJob) {
  if (actor?.type !== "board" || actor.source !== "session" || !actor.userId || job.operationType !== "index_refresh"
    || !job.jobKey.startsWith("maintenance:v1:") || Object.keys(job.sourceRefJson).length || job.resultJson !== null
    || job.status !== "succeeded" || !job.startedAt || !job.finishedAt || job.leaseExpiresAt) return false;
  const receipts = await db.select().from(activityLog).where(and(eq(activityLog.companyId, job.companyId), eq(activityLog.entityType, "memory_job"),
    eq(activityLog.entityId, job.id), eq(activityLog.action, "memory.index_refresh_completed"))).limit(2).for("share");
  const receipt = receipts[0];
  // The original executor checked the requesting Human and every source before
  // atomically recording this exact postcondition. An actorId alone is not proof.
  return receipts.length === 1 && receipt!.actorType === "user" && receipt!.actorId === actor.userId
    && receipt!.createdAt >= job.startedAt && receipt!.createdAt <= job.finishedAt && indexReadResult.safeParse(receipt!.details).success;
}

/** Filtering precedes the output limit. The fixed scan/time ceilings can omit
 * older history; they never promote hidden sources or disclose hidden counts. */
export async function listReadableMemoryJobs(db: Db, companyId: string, actor: AuthorizationActor | undefined,
  options: { indexHistory?: boolean; jobId?: string; limit?: number } = {}): Promise<MemoryJob[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 50)), deadline = performance.now() + 5000;
  return db.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout='5s'`);
    await lockAnalyticalCompany(tx, companyId);
    assertMemoryJobReadBudget(deadline);
    await lockMemoryPrivacy(tx, companyId);
    assertMemoryJobReadBudget(deadline);
    await assertMemoryJobReader(tx, companyId, actor, deadline);
    const rows: MemoryJob[] = []; let cursor: MemoryJob | undefined;
    for (let scanned = 0; scanned < 256 && rows.length < limit;) {
      assertMemoryJobReadBudget(deadline);
      const candidates = await tx.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId),
        options.indexHistory ? and(eq(memoryJobs.operationType, "index_refresh"), sql`${memoryJobs.jobKey} like 'maintenance:v1:%'`) : undefined,
        options.jobId ? eq(memoryJobs.id, options.jobId) : undefined,
        cursor ? sql`(${memoryJobs.submittedAt},${memoryJobs.id}) < (select submitted_at,id from memory_jobs job_cursor
          where job_cursor.company_id=${companyId}::uuid and job_cursor.id=${cursor.id}::uuid)` : undefined,
      )).orderBy(desc(memoryJobs.submittedAt), desc(memoryJobs.id)).limit(Math.min(50, 256 - scanned)).for("share");
      assertMemoryJobReadBudget(deadline);
      if (!candidates.length) break;
      for (const job of candidates) {
        assertMemoryJobReadBudget(deadline);
        scanned++; cursor = job;
        let readable = await readMemoryJobBeforeDeadline(tx, companyId, actor, job.id, deadline);
        assertMemoryJobReadBudget(deadline);
        if (!readable && options.indexHistory) readable = await ownIndexTombstoneReadable(tx, actor, job);
        assertMemoryJobReadBudget(deadline);
        if (readable) rows.push(job);
        if (rows.length >= limit) break;
      }
    }
    for (const job of rows) {
      assertMemoryJobReadBudget(deadline);
      let readable = await readMemoryJobBeforeDeadline(tx, companyId, actor, job.id, deadline);
      assertMemoryJobReadBudget(deadline);
      if (!readable && options.indexHistory) readable = await ownIndexTombstoneReadable(tx, actor, job);
      assertMemoryJobReadBudget(deadline);
      if (!readable) throw conflict("Memory job sources changed");
    }
    await assertMemoryJobReader(tx, companyId, actor, deadline);
    assertMemoryJobReadBudget(deadline);
    return rows;
  });
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function semanticResultCandidates(resultJson: unknown) {
  const root = record(resultJson);
  return [
    record(root.nativeResult),
    record(root.acceptedResult),
    record(record(root.semanticResult).result),
  ];
}

function hasMemoryCandidates(run: HeartbeatRun): boolean {
  return semanticResultCandidates(run.resultJson).some(
    (candidate) =>
      candidate.schema === "paperclip.run_result.v1" &&
      Array.isArray(candidate.memoryCandidates) &&
      candidate.memoryCandidates.length > 0,
  );
}

function captureJobKey(runId: string) {
  return `post-run-capture:${MEMORY_JOB_VERSION}:${runId}`;
}

function retentionJobKey(companyId: string, now: Date) {
  const minute = now.toISOString().slice(0, 16);
  return `retention:${MEMORY_JOB_VERSION}:${companyId}:${minute}`;
}

export interface MemoryJobServiceOptions {
  runLogStore?: Pick<RunLogStore, "erase">;
  ownerId?: string;
  leaseMs?: number;
  maxAttempts?: number;
}

export function memoryJobService(
  db: Db,
  options: MemoryJobServiceOptions = {},
) {
  const ownerId = options.ownerId ?? `memory-job-worker:${randomUUID()}`;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const settings = instanceSettingsService(db);

  async function enqueue(input: {
    companyId: string;
    operationType: MemoryJobOperationType;
    jobKey: string;
    attemptNumber?: number;
    retryOfJobId?: string | null;
    sourceHeartbeatRunId?: string | null;
    sourceMemoryRecordId?: string | null;
    sourceRefJson?: Record<string, unknown>;
    status?: "queued" | "cancelled";
    errorCode?: string | null;
    error?: string | null;
    resultSummary?: string | null;
    now?: Date;
  }): Promise<MemoryJob> {
    const now = input.now ?? new Date();
    const attemptNumber = input.attemptNumber ?? 1;
    const status = input.status ?? "queued";
    try {
      const [created] = await db
        .insert(memoryJobs)
        .values({
          companyId: input.companyId,
          operationType: input.operationType,
          status,
          jobKey: input.jobKey,
          attemptNumber,
          retryOfJobId: input.retryOfJobId ?? null,
          sourceHeartbeatRunId: input.sourceHeartbeatRunId ?? null,
          sourceMemoryRecordId: input.sourceMemoryRecordId ?? null,
          sourceRefJson: input.sourceRefJson ?? {},
          submittedAt: now,
          finishedAt: status === "cancelled" ? now : null,
          resultSummary: input.resultSummary ?? null,
          errorCode: input.errorCode ?? null,
          error: input.error ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error("Memory job insert returned no row");
      return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await db
        .select()
        .from(memoryJobs)
        .where(
          and(
            eq(memoryJobs.companyId, input.companyId),
            eq(memoryJobs.jobKey, input.jobKey),
            eq(memoryJobs.attemptNumber, attemptNumber),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (!existing) throw error;
      return existing;
    }
  }

  async function extractionEnabled(): Promise<boolean> {
    const experimental = await settings.getExperimental();
    return (
      experimental.enableCollectiveMemoryV1 === true &&
      experimental.enableMemoryPostRunExtractionV1 === true
    );
  }

  async function enqueuePostRunCapture(
    run: HeartbeatRun,
  ): Promise<MemoryJob | null> {
    if (run.status !== "succeeded" || !hasMemoryCandidates(run)) return null;
    const enabled = await extractionEnabled();
    return enqueue({
      companyId: run.companyId,
      operationType: "capture",
      jobKey: captureJobKey(run.id),
      sourceHeartbeatRunId: run.id,
      sourceRefJson: {
        kind: "heartbeat_run",
        runId: run.id,
        extractionEnabledAtAdmission: enabled,
      },
      ...(enabled
        ? {}
        : {
            status: "cancelled" as const,
            errorCode: "feature_disabled_at_admission",
            error:
              "Post-run Memory extraction was disabled when this run was admitted.",
            resultSummary:
              "Post-run Memory capture was not admitted because extraction was disabled.",
          }),
    });
  }

  async function enqueueMissingPostRunCaptures(
    limit = BACKSTOP_RUN_SCAN_LIMIT,
  ): Promise<number> {
    const rows = await db
      .select({ run: heartbeatRuns })
      .from(heartbeatRuns)
      .leftJoin(
        memoryJobs,
        and(
          eq(memoryJobs.companyId, heartbeatRuns.companyId),
          eq(memoryJobs.sourceHeartbeatRunId, heartbeatRuns.id),
          eq(memoryJobs.operationType, "capture"),
          eq(memoryJobs.attemptNumber, 1),
        ),
      )
      .where(
        and(
          eq(heartbeatRuns.status, "succeeded"),
          isNull(memoryJobs.id),
          sql`${heartbeatRuns.resultJson}::text like '%"memoryCandidates"%'`,
        ),
      )
      .orderBy(sql`${heartbeatRuns.finishedAt} desc nulls last`)
      .limit(Math.max(1, Math.min(limit, BACKSTOP_RUN_SCAN_LIMIT)));

    let enqueued = 0;
    for (const { run } of rows) {
      if (!hasMemoryCandidates(run)) continue;
      const job = await enqueuePostRunCapture(run);
      if (job?.status === "queued") enqueued += 1;
    }
    return enqueued;
  }

  async function enqueueDueRetentionJobs(
    now = new Date(),
  ): Promise<number> {
    const experimental = await settings.getExperimental();
    if (
      experimental.enableCollectiveMemoryV1 !== true &&
      experimental.enablePrivateAgentMemoryV1 !== true
    ) {
      return 0;
    }

    const companies = await db
      .selectDistinct({ companyId: memoryRecords.companyId })
      .from(memoryRecords)
      .where(
        or(and(eq(memoryRecords.retentionState, "active"), isNotNull(memoryRecords.expiresAt), lte(memoryRecords.expiresAt, now)),
          sql`exists (select 1 from ${memoryDeletionMarkers}
            where ${memoryDeletionMarkers.companyId} = ${memoryRecords.companyId}
            and ${memoryDeletionMarkers.recordId} = ${memoryRecords.id}
            and ${memoryRecords.deletedAt} is null)`),
      )
      .limit(RETENTION_COMPANY_LIMIT);

    const configured = await db.select({ companyId: memoryRetentionPolicies.companyId }).from(memoryRetentionPolicies)
      .where(and(isNotNull(memoryRetentionPolicies.maxAgeDays), sql`exists (
        select 1 from ${memoryRecords} where ${memoryRecords.companyId} = ${memoryRetentionPolicies.companyId}
        and ${memoryRecords.deletedAt} is null
        and ${memoryRecords.observedAt} <= ${now.toISOString()}::timestamptz - (${memoryRetentionPolicies.maxAgeDays} * interval '1 day')
      )`)).limit(RETENTION_COMPANY_LIMIT);
    for (const row of configured) {
      if (!companies.some((candidate) => candidate.companyId === row.companyId)) companies.push(row);
    }
    let enqueued = 0;
    for (const { companyId } of companies) {
      const key = retentionJobKey(companyId, now);
      const existing = await db
        .select({ id: memoryJobs.id })
        .from(memoryJobs)
        .where(
          and(
            eq(memoryJobs.companyId, companyId),
            eq(memoryJobs.jobKey, key),
            eq(memoryJobs.attemptNumber, 1),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (existing) continue;
      await enqueue({
        companyId,
        operationType: "retention",
        jobKey: key,
        sourceRefJson: { kind: "retention_sweep", asOf: now.toISOString() },
        now,
      });
      enqueued += 1;
    }
    return enqueued;
  }

  async function claimNext(now = new Date()): Promise<MemoryJob | null> {
    return db.transaction(async (tx) => {
      const candidate = await tx
        .select()
        .from(memoryJobs)
        .where(eq(memoryJobs.status, "queued"))
        .orderBy(asc(memoryJobs.submittedAt), asc(memoryJobs.createdAt))
        .limit(1)
        .for("update", { skipLocked: true })
        .then((rows) => rows[0] ?? null);
      if (!candidate) return null;
      const [claimed] = await tx
        .update(memoryJobs)
        .set({
          status: "running",
          executionOwnerId: ownerId,
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
          startedAt: candidate.startedAt ?? now,
          updatedAt: now,
        })
        .where(
          and(
            eq(memoryJobs.id, candidate.id),
            eq(memoryJobs.status, "queued"),
          ),
        )
        .returning();
      return claimed ?? null;
    });
  }

  async function settle(
    job: MemoryJob,
    input: {
      status: "succeeded" | "failed";
      resultSummary?: string | null;
      resultJson?: Record<string, unknown> | null;
      errorCode?: string | null;
      error?: string | null;
      now?: Date;
    },
    targetDb: Db = db,
  ): Promise<void> {
    const now = input.now ?? new Date();
    await targetDb
      .update(memoryJobs)
      .set({
        status: input.status,
        executionOwnerId: null,
        leaseExpiresAt: null,
        finishedAt: now,
        resultSummary: input.resultSummary ?? null,
        resultJson: input.resultJson ?? null,
        errorCode: input.errorCode ?? null,
        error: input.error ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(memoryJobs.id, job.id),
          eq(memoryJobs.status, "running"),
          eq(memoryJobs.executionOwnerId, ownerId),
        ),
      );
  }

  async function executeCapture(tx: Db, job: MemoryJob, receipt: NativeMemoryCaptureReceipt, publications: ActivityPublication[]) {
    if (!job.sourceHeartbeatRunId) {
      throw new Error("memory_capture_source_run_missing");
    }
    const run = await tx
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.id, job.sourceHeartbeatRunId),
          eq(heartbeatRuns.companyId, job.companyId),
        ),
      )
      .limit(1)
      .for("share")
      .then((rows) => rows[0] ?? null);
    if (!run || run.status !== "succeeded") throw new Error("memory_capture_source_run_unavailable");
    const result = await memoryPostRunExtractionService(tx, {
      nativeCaptureReceipt: receipt, postCommitPublications: publications,
    }).extract(run);
    return {
      summary:
        `Capture proposed ${result.proposed}, persisted ${result.persisted}, duplicates ${result.duplicates}, corroborations ${result.corroborations}, updates ${result.updates}, contradictions ${result.contradictions}, skipped ${result.skipped}.`,
      result: {
        runId: result.runId,
        proposed: result.proposed,
        persisted: result.persisted,
        duplicates: result.duplicates,
        corroborations: result.corroborations,
        updates: result.updates,
        contradictions: result.contradictions,
        skipped: result.skipped,
        skipReasons: result.skipReasons,
      },
    };
  }

  function retentionCutoff(job: MemoryJob, fallback: Date): Date {
    const raw = record(job.sourceRefJson).asOf;
    if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }

  async function executeRetention(job: MemoryJob, now: Date) {
    const source = record(job.sourceRefJson);
    if (source.kind === "workflow_artifact_source_erasure") {
      if (typeof source.versionId !== "string" || !/^[a-f0-9-]{36}$/i.test(source.versionId) ||
        job.jobKey !== `workflow-artifact-source-erasure:v1:${source.versionId}`) throw unprocessable("Invalid native Workflow Artifact erasure binding");
      const { lockAnalyticalCompany } = await import("../analytical-privacy.js");
      const { lockMemoryPrivacy, purgeDerivedWorkflowMemory } = await import("./memory-privacy.js");
      await db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db;
        await lockAnalyticalCompany(tx, job.companyId); await lockMemoryPrivacy(tx, job.companyId);
        const [receipt] = await tx.execute<{ erased: boolean }>(sql`select aw_artifact_version_source_erased(${job.companyId}::uuid,${source.versionId as string}::uuid) as erased`);
        if (!receipt?.erased) throw unprocessable("Native Workflow Artifact has no Source erasure receipt");
        await purgeDerivedWorkflowMemory(tx, job.companyId, [], now, { workflowRevisionIds: [], artifactVersionIds: [source.versionId as string] });
      });
      return { summary: "Erased the native Artifact's Workflow copies.", result: { processedVersionCount: 1 } };
    }
    if (source.kind === "artifact_workspace_erasure") {
      if (typeof source.versionId !== "string" || job.jobKey !== `artifact-workspace-erasure:v1:${source.versionId}`) {
        throw unprocessable("Invalid native Artifact workspace erasure binding");
      }
      const { eraseArtifactWorkspace } = await import("../automation-artifacts/automation-artifact-workspace.js");
      await eraseArtifactWorkspace(db, { companyId: job.companyId, versionId: source.versionId });
      return { summary: "Erased the native Artifact version's sandbox workspace.", result: { processedVersionCount: 1 } };
    }
    if (source.kind === "authored_definition_source_erasure") {
      if (typeof source.runId !== "string" || typeof source.revisionId !== "string" ||
        job.jobKey !== `authored-definition-source-erasure:v1:${source.runId}:${source.revisionId}`) throw unprocessable("Invalid authored definition erasure binding");
      const { eraseAuthoredDefinitionRuntimeCopies } = await import("../agents/authored-definition-erasure.js");
      await eraseAuthoredDefinitionRuntimeCopies(db, job.companyId, source.runId, source.revisionId);
      return { summary: "Erased the deleted authored definition's actual runtime copies.", result: { processedRunCount: 1 } };
    }
    if (source.kind === "runtime_skill_source_erasure" || source.kind === "runtime_playbook_source_erasure" || source.kind === "runtime_knowledge_source_erasure") {
      const prefix = source.kind === "runtime_skill_source_erasure" ? "runtime-skill-source-erasure" : source.kind === "runtime_knowledge_source_erasure" ? "runtime-knowledge-source-erasure" : "runtime-playbook-source-erasure";
      if (typeof source.runId !== "string" || typeof source.versionId !== "string" ||
        job.jobKey !== `${prefix}:v1:${source.runId}:${source.versionId}`) throw unprocessable("Invalid native procedure runtime erasure binding");
      const { eraseSkillRuntimeCopies } = await import("../learning/skill-file-erasure.js");
      await eraseSkillRuntimeCopies(db, job.companyId, source.runId, source.versionId);
      return { summary: "Erased the deleted procedure version's actual runtime copies.", result: { processedRunCount: 1 } };
    }
    if (source.kind === "runtime_asset_erasure") {
      if (typeof source.runId !== "string" || !Array.isArray(source.legacyDigests) || source.legacyDigests.some(value => typeof value !== "string")) throw unprocessable("Invalid native runtime asset erasure binding");
      const digests = source.legacyDigests as string[];
      const suffix = digests.length ? `:${createHash("sha256").update([...new Set(digests)].sort().join(",")).digest("hex")}` : "";
      if (job.jobKey !== `runtime-asset-erasure:v1:${source.runId}${suffix}`) throw unprocessable("Invalid native runtime asset erasure binding");
      const { eraseNativeRuntimeAssets } = await import("../native-runtime/runtime-asset-retention.js");
      await eraseNativeRuntimeAssets(db, { companyId: job.companyId, runId: source.runId }, source.legacyDigests as string[]);
      return { summary: "Erased the native run's generated runtime assets.", result: { processedRunCount: 1 } };
    }
    if (source.kind === "skill_version_file_erasure") {
      if (typeof source.skillId !== "string" || typeof source.versionId !== "string" ||
        job.jobKey !== `skill-version-file-erasure:v1:${source.versionId}`) throw unprocessable("Invalid native Skill file erasure binding");
      const { eraseSkillVersionFiles } = await import("../learning/skill-file-erasure.js");
      await eraseSkillVersionFiles(db, job.companyId, source.skillId, source.versionId);
      return { summary: "Erased the native Skill version snapshot.", result: { processedVersionCount: 1 } };
    }
    if(source.kind === "learning_analytical_erasure") {
      if(typeof source.cycleId!=="string"||!/^[a-f0-9-]{36}$/i.test(source.cycleId)||job.jobKey!==`learning-analytical-erasure:v1:${source.cycleId}`)throw unprocessable("Invalid native Learning erasure binding");
      const {lockAnalyticalCompany}=await import("../analytical-privacy.js"),{lockMemoryPrivacy}=await import("./memory-privacy.js"),{invalidateLearningCycles}=await import("../learning/learning-privacy.js");
      await db.transaction(async rawTx=>{
        const tx=rawTx as unknown as Db;await lockAnalyticalCompany(tx,job.companyId);await lockMemoryPrivacy(tx,job.companyId);
        const {learningCycles}=await import("@paperclipai/db");
        const [cycle]=await tx.select().from(learningCycles).where(and(eq(learningCycles.companyId,job.companyId),eq(learningCycles.id,source.cycleId as string))).for("update");
        if(cycle?.erasedAt)await invalidateLearningCycles(tx,job.companyId,[cycle.id],true);
      });
      return {summary:"Erased the native Learning cycle's retained analytical derivatives.",result:{processedCycleCount:1}};
    }
    if (source.kind === "provider_trace_erasure") {
      if (typeof source.traceId !== "string" || !/^[a-f0-9-]{36}$/i.test(source.traceId) ||
        typeof source.runId !== "string" || !/^[a-f0-9-]{36}$/i.test(source.runId) ||
        typeof source.traceRef !== "string" || !/^[a-f0-9-]{36}\.ndjson$/.test(source.traceRef) ||
        job.jobKey !== `provider-trace-erasure:v1:${source.traceId}`) {
        throw unprocessable("Invalid provider trace erasure binding", {code:"memory_trace_erasure_binding_invalid"});
      }
      await providerTraceStore(db).eraseSourceFiles(source.traceRef);
      return {summary:"Erased the application-owned provider trace sidecars.",result:{erasedTraceCount:1}};
    }
    if (source.kind === "run_log_erasure") {
      if (typeof source.runId !== "string" || typeof source.agentId !== "string" ||
        source.logRef !== `${job.companyId}/${source.agentId}/${source.runId}.ndjson` ||
        !/^[a-f0-9-]{36}$/i.test(source.runId) || !/^[a-f0-9-]{36}$/i.test(source.agentId)) {
        throw unprocessable("Invalid log erasure binding", { code: "memory_log_erasure_binding_invalid" });
      }
      const store = options.runLogStore ?? getRunLogStore();
      if (!store.erase) throw new Error("Run log store does not support erasure");
      await store.erase({ store: "local_file", logRef: source.logRef as string });
      return { summary: "Erased the application-owned workflow run log.", result: { erasedLogCount: 1 } };
    }
    // Restored erased payloads must be removed even with Memory switched off.
    const restored = await reapplyMemoryDeletionMarkers(db, job.companyId);
    const experimental = await settings.getExperimental();
    if (
      experimental.enableCollectiveMemoryV1 !== true &&
      experimental.enablePrivateAgentMemoryV1 !== true
    ) {
      return {
        summary: "Retention skipped because Memory is disabled.",
        result: { expiredRecordCount: 0, asOf: now.toISOString(), disabled: true },
      };
    }
    const expired = await expireMemoryPayloads(db, job.companyId, now);
    const deletedRecordCount = restored.deletedRecordCount + expired.deletedRecordCount;
    return {
      summary: `Deleted ${deletedRecordCount} expired or previously erased Memory payload(s).`,
      result: { expiredRecordCount: deletedRecordCount, asOf: now.toISOString() },
    };
  }

  async function failAndRetry(tx: Db, job: MemoryJob, now: Date, errorCode: string, message: string): Promise<boolean> {
    await tx
      .update(memoryJobs)
      .set({
        status: "failed",
        executionOwnerId: null,
        leaseExpiresAt: null,
        finishedAt: now,
        errorCode,
        error: message,
        updatedAt: now,
      })
      .where(eq(memoryJobs.id, job.id));

    if (job.attemptNumber >= maxAttempts) {
      return false;
    }

    const nextAttempt = job.attemptNumber + 1;
    await tx
      .insert(memoryJobs)
      .values({
        companyId: job.companyId,
        operationType: job.operationType,
        status: "queued",
        jobKey: job.jobKey,
        attemptNumber: nextAttempt,
        retryOfJobId: job.id,
        sourceHeartbeatRunId: job.sourceHeartbeatRunId,
        sourceMemoryRecordId: job.sourceMemoryRecordId,
        sourceRefJson: job.sourceRefJson,
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    return true;
  }


  async function executeClaimed(job: MemoryJob): Promise<void> {
    const now = new Date();
    try {
      if(job.operationType!=="retention")await assertSaasDomainAdmission(db,job.companyId,"memory.use");
      if (["dedupe", "compaction", "reflection", "index_refresh", "model_rebuild"].includes(job.operationType)) {
        if (!(await settings.getExperimental()).enableCollectiveMemoryV1) throw conflict("Memory maintenance is disabled");
        const publications = await db.transaction(async (tx) => {
          const deferred: ActivityPublication[] = [];
          await lockAnalyticalCompany(tx as unknown as Db,job.companyId);
          await lockMemoryPrivacy(tx as unknown as Db, job.companyId);
          const [owned] = await tx.select().from(memoryJobs).where(and(eq(memoryJobs.id, job.id), eq(memoryJobs.companyId, job.companyId),
            eq(memoryJobs.status, "running"), eq(memoryJobs.executionOwnerId, ownerId))).for("update");
          if (!owned?.leaseExpiresAt || owned.leaseExpiresAt <= new Date()) throw conflict("Memory job lease was lost");
          await tx.execute(sql`set local statement_timeout = '5000'`);
          const output = owned.operationType === "model_rebuild" ? await executeModelRebuild(tx as unknown as Db, owned) : await executeMemoryMaintenance(tx as unknown as Db, owned, deferred);
          if (owned.leaseExpiresAt <= new Date()) throw conflict("Memory job lease expired during maintenance");
          await settle(owned, { status: "succeeded", resultSummary: "Native Memory maintenance completed.", resultJson: output.result }, tx as unknown as Db);
          deferred.push(output.publication);
          return deferred;
        });
        publications.forEach(publishActivity);
        return;
      }
      if (job.operationType === "capture") {
        const publications: ActivityPublication[] = [];
        await db.transaction(async (tx) => {
          await lockAnalyticalCompany(tx, job.companyId);
          await lockMemoryPrivacy(tx, job.companyId);
          const [owned] = await tx.select().from(memoryJobs).where(and(
            eq(memoryJobs.id, job.id), eq(memoryJobs.companyId, job.companyId),
            eq(memoryJobs.operationType, "capture"), eq(memoryJobs.status, "running"),
            eq(memoryJobs.executionOwnerId, ownerId),
            sql`${memoryJobs.leaseExpiresAt} > clock_timestamp()`,
          )).for("update");
          if (!owned) throw conflict("Memory capture job lease was lost");
          await tx.execute(sql`set local statement_timeout = '5000'`);
          await assertSaasDomainAdmission(tx, owned.companyId, "memory.use");
          const [identity] = await tx.execute<{ backendPid: number; transactionId: string }>(
            sql`select pg_backend_pid() as "backendPid", pg_current_xact_id()::text as "transactionId"`,
          );
          if (!identity) throw new Error("Memory capture transaction identity unavailable");
          const output = await executeCapture(tx, owned, {
            jobId: owned.id, executionOwnerId: ownerId, ...identity,
          }, publications);
          const [current] = await tx.select({ id: memoryJobs.id }).from(memoryJobs).where(and(
            eq(memoryJobs.id, owned.id), eq(memoryJobs.companyId, owned.companyId),
            eq(memoryJobs.operationType, "capture"), eq(memoryJobs.status, "running"),
            eq(memoryJobs.executionOwnerId, ownerId),
            sql`${memoryJobs.leaseExpiresAt} > clock_timestamp()`,
          ));
          if (!current) throw conflict("Memory capture job lease expired during capture");
          await settle(owned, {
            status: "succeeded", resultSummary: output.summary, resultJson: output.result,
          }, tx);
        });
        publications.forEach(publishActivity);
        return;
      }
      if (job.operationType === "retention") {
        const cutoff = retentionCutoff(job, now);
        const output = await executeRetention(job, cutoff);
        await settle(job, {
          status: "succeeded",
          resultSummary: output.summary,
          resultJson: output.result,
          now: new Date(),
        });
        return;
      }
      await settle(job, {
        status: "failed",
        errorCode: "memory_job_handler_unavailable",
        error: `No Memory job handler is available for ${job.operationType}.`,
        now: new Date(),
      });
    } catch (error) {
      if(job.operationType==="capture" && error instanceof HttpError && error.status===409
        && record(error.details).code==="memory_capture_source_busy"){
        // Keep immutable failed history and use the existing bounded retry
        // attempt, without treating a busy source lock as an authority grant.
        await db.transaction(async tx=>{
          const [owned]=await tx.select().from(memoryJobs).where(and(
            eq(memoryJobs.id,job.id),eq(memoryJobs.companyId,job.companyId),eq(memoryJobs.operationType,"capture"),
            eq(memoryJobs.status,"running"),eq(memoryJobs.executionOwnerId,ownerId),
            sql`${memoryJobs.leaseExpiresAt}>clock_timestamp()`,
          )).for("update");
          if(owned)await failAndRetry(tx,owned,new Date(),"memory_capture_source_busy","Native capture source authority is busy; retry is bounded by the job attempt limit.");
        });
        logger.info({jobId:job.id},"Memory capture source lock is busy");
        return;
      }

      await settle(job, {
        status: "failed",
        errorCode: "memory_job_handler_failed",
        error: "Memory job handler failed. Inspect server diagnostics for the classified failure.",
        now: new Date(),
      });
      logger.warn(
        { err: error, jobId: job.id, operationType: job.operationType },
        "Memory job failed",
      );
    }
  }

  async function recoverExpiredLeases(
    now = new Date(),
    limit = 50,
  ): Promise<{ recovered: number; retried: number }> {
    const expired = await db
      .select()
      .from(memoryJobs)
      .where(
        and(
          eq(memoryJobs.status, "running"),
          isNotNull(memoryJobs.leaseExpiresAt),
          lte(memoryJobs.leaseExpiresAt, now),
        ),
      )
      .orderBy(asc(memoryJobs.leaseExpiresAt))
      .limit(Math.max(1, Math.min(limit, 100)));

    let recovered = 0;
    let retried = 0;
    for (const stale of expired) {
      const outcome = await db.transaction(async (tx) => {
        const locked = await tx
          .select()
          .from(memoryJobs)
          .where(
            and(
              eq(memoryJobs.id, stale.id),
              eq(memoryJobs.status, "running"),
              isNotNull(memoryJobs.leaseExpiresAt),
              lte(memoryJobs.leaseExpiresAt, now),
            ),
          )
          .limit(1)
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!locked) return { recovered: false, retried: false };

        const retried=await failAndRetry(tx,locked,now,"worker_lost","Memory job lease expired before terminal completion.");
        return {recovered:true,retried};
      });
      if (outcome.recovered) recovered += 1;
      if (outcome.retried) retried += 1;
    }
    return { recovered, retried };
  }

  async function tick(
    input: { now?: Date; limit?: number } = {},
  ): Promise<{
    recovered: number;
    retried: number;
    backfilled: number;
    retentionQueued: number;
    processed: number;
  }> {
    const now = input.now ?? new Date();
    // Privacy cleanup survives disabled features, archived tenants and a failed
    // filesystem attempt. The existing reconciliation tick supplies the retry.
    await db.update(memoryJobs).set({status:"queued",finishedAt:null,error:null,errorCode:null,updatedAt:now})
      .where(and(eq(memoryJobs.operationType,"retention"),eq(memoryJobs.status,"failed"),
        lte(memoryJobs.updatedAt,new Date(now.getTime()-60000)),
        sql`(${memoryJobs.sourceRefJson}->>'kind' in ('provider_trace_erasure','run_log_erasure','learning_analytical_erasure','skill_version_file_erasure','runtime_asset_erasure','runtime_skill_source_erasure','runtime_playbook_source_erasure','runtime_knowledge_source_erasure','authored_definition_source_erasure','artifact_workspace_erasure','workflow_artifact_source_erasure') or (${memoryJobs.sourceRefJson}->>'kind'='retention_sweep' and ${memoryJobs.jobKey} like 'analytical-context-erasure:v1:%'))`));
    const recovered = await recoverExpiredLeases(now);
    const [backfilled, retentionQueued] = await Promise.all([
      enqueueMissingPostRunCaptures(),
      enqueueDueRetentionJobs(now),
    ]);
    const limit = Math.max(
      1,
      Math.min(input.limit ?? DEFAULT_TICK_LIMIT, DEFAULT_TICK_LIMIT),
    );
    let processed = 0;
    for (let index = 0; index < limit; index += 1) {
      const job = await claimNext(new Date());
      if (!job) break;
      await executeClaimed(job);
      processed += 1;
    }
    return {
      ...recovered,
      backfilled,
      retentionQueued,
      processed,
    };
  }

  return {
    enqueueMaintenance: async (companyId: string, rawInput: unknown, actor: MemoryMutationActor, idempotencyKey: string) => {
      const input = memoryMaintenanceInputSchema.parse(rawInput);
      if (!idempotencyKey.trim() || idempotencyKey.length > 160) throw unprocessable("A bounded Idempotency-Key is required");
      if (!(await memoryService(db).getRetentionPolicy(companyId, actor)).canManage) throw conflict("Memory maintenance permission was revoked");
      const jobKey = `maintenance:v1:${idempotencyKey}`;
      const [existing] = await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.jobKey, jobKey), eq(memoryJobs.attemptNumber, 1)));
      const sameRequest = (job: MemoryJob) => job.operationType === input.operationType &&
        isDeepStrictEqual(job.sourceRefJson.recordIds, [...input.recordIds].sort()) && isDeepStrictEqual(job.sourceRefJson.requester, actor.principal) &&
        isDeepStrictEqual(job.sourceRefJson.proposedLesson, input.proposedLesson);
      if (existing) {
        if (!sameRequest(existing)) throw conflict("Idempotency key is already bound to a different or erased request");
        return existing;
      }
      const sources = await memoryMaintenanceSources(db, companyId, input.recordIds, actor);
      const sourceRefJson = { recordIds: [...input.recordIds].sort(), requester: actor.principal,
        ...(input.proposedLesson ? { proposedLesson: input.proposedLesson } : {}),
        recordVersions: Object.fromEntries(sources.map((row) => [row.id, row.updatedAt.toISOString()])) };
      const job = await enqueue({ companyId, operationType: input.operationType, jobKey, sourceRefJson });
      if (!sameRequest(job)) throw conflict("Idempotency key is already bound to a different maintenance request");
      return job;
    },
    enqueuePostRunCapture,
    enqueueMissingPostRunCaptures,
    enqueueDueRetentionJobs,
    claimNext,
    executeClaimed,
    recoverExpiredLeases,
    tick,
  };
}
