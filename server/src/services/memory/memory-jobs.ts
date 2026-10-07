import { assertSaasDomainAdmission } from "../saas/domain-admission.js";
import { randomUUID } from "node:crypto";
import { providerTraceStore } from "../provider-trace-store.js";
import { getRunLogStore, type RunLogStore } from "../run-log-store.js";
import { isDeepStrictEqual } from "node:util";
import { executeMemoryMaintenance, memoryMaintenanceInputSchema, memoryMaintenanceSources } from "./memory-maintenance.js";
import { executeModelRebuild } from "./derived-memory.js";
import { memoryService, type MemoryMutationActor } from "./memory-service.js";
import { conflict, unprocessable } from "../../errors.js";
import { publishActivity } from "../activity-log.js";
import {
  and,
  asc,
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
  memoryJobs,
  memoryRecords,
  memoryRetentionPolicies,
  memoryDeletionMarkers,
} from "@paperclipai/db";
import type { MemoryJobOperationType } from "@paperclipai/shared";
import { isUniqueViolation } from "../../db-errors.js";
import { logger } from "../../middleware/logger.js";
import { instanceSettingsService } from "../instance-settings.js";
import { memoryPostRunExtractionService } from "./memory-post-run-extraction.js";
import { expireMemoryPayloads, lockMemoryPrivacy, reapplyMemoryDeletionMarkers } from "./memory-privacy.js";

const MEMORY_JOB_VERSION = "v1";
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TICK_LIMIT = 10;
const BACKSTOP_RUN_SCAN_LIMIT = 100;
const RETENTION_COMPANY_LIMIT = 50;

type MemoryJob = typeof memoryJobs.$inferSelect;
type HeartbeatRun = typeof heartbeatRuns.$inferSelect;

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
  const extraction = memoryPostRunExtractionService(db);

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

  async function executeCapture(job: MemoryJob) {
    if (!job.sourceHeartbeatRunId) {
      throw new Error("memory_capture_source_run_missing");
    }
    const run = await db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.id, job.sourceHeartbeatRunId),
          eq(heartbeatRuns.companyId, job.companyId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!run) throw new Error("memory_capture_source_run_unavailable");
    const result = await extraction.extract(run);
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

  async function executeClaimed(job: MemoryJob): Promise<void> {
    const now = new Date();
    try {
      if(job.operationType!=="retention")await assertSaasDomainAdmission(db,job.companyId,"memory.use");
      if (["dedupe", "compaction", "reflection", "index_refresh", "model_rebuild"].includes(job.operationType)) {
        if (!(await settings.getExperimental()).enableCollectiveMemoryV1) throw conflict("Memory maintenance is disabled");
        const publication = await db.transaction(async (tx) => {
          await lockMemoryPrivacy(tx as unknown as Db, job.companyId);
          const [owned] = await tx.select().from(memoryJobs).where(and(eq(memoryJobs.id, job.id), eq(memoryJobs.companyId, job.companyId),
            eq(memoryJobs.status, "running"), eq(memoryJobs.executionOwnerId, ownerId))).for("update");
          if (!owned?.leaseExpiresAt || owned.leaseExpiresAt <= new Date()) throw conflict("Memory job lease was lost");
          await tx.execute(sql`set local statement_timeout = '5000'`);
          const output = owned.operationType === "model_rebuild" ? await executeModelRebuild(tx as unknown as Db, owned) : await executeMemoryMaintenance(tx as unknown as Db, owned);
          if (owned.leaseExpiresAt <= new Date()) throw conflict("Memory job lease expired during maintenance");
          await settle(owned, { status: "succeeded", resultSummary: "Native Memory maintenance completed.", resultJson: output.result }, tx as unknown as Db);
          return output.publication;
        });
        publishActivity(publication);
        return;
      }
      if (job.operationType === "capture") {
        const output = await executeCapture(job);
        await settle(job, {
          status: "succeeded",
          resultSummary: output.summary,
          resultJson: output.result,
          now: new Date(),
        });
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

        await tx
          .update(memoryJobs)
          .set({
            status: "failed",
            executionOwnerId: null,
            leaseExpiresAt: null,
            finishedAt: now,
            errorCode: "worker_lost",
            error: "Memory job lease expired before terminal completion.",
            updatedAt: now,
          })
          .where(eq(memoryJobs.id, locked.id));

        if (locked.attemptNumber >= maxAttempts) {
          return { recovered: true, retried: false };
        }

        const nextAttempt = locked.attemptNumber + 1;
        await tx
          .insert(memoryJobs)
          .values({
            companyId: locked.companyId,
            operationType: locked.operationType,
            status: "queued",
            jobKey: locked.jobKey,
            attemptNumber: nextAttempt,
            retryOfJobId: locked.id,
            sourceHeartbeatRunId: locked.sourceHeartbeatRunId,
            sourceMemoryRecordId: locked.sourceMemoryRecordId,
            sourceRefJson: locked.sourceRefJson,
            submittedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        return { recovered: true, retried: true };
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
        sql`(${memoryJobs.sourceRefJson}->>'kind' in ('provider_trace_erasure','run_log_erasure','learning_analytical_erasure') or (${memoryJobs.sourceRefJson}->>'kind'='retention_sweep' and ${memoryJobs.jobKey} like 'analytical-context-erasure:v1:%'))`));
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
