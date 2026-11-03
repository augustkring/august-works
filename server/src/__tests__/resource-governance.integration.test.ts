import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, companies, createDb, environmentLeases, environments, heartbeatRunEvents, heartbeatRuns,
  instanceSettings, issues, memoryJobs, nativeRunFinalizations, workflowRevisions, workflowRuns, workflows } from "@paperclipai/db";
import type { ResourceGovernancePolicy, WorkflowGraphV1 } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
import { instanceSettingsRoutes } from "../routes/instance-settings.js";
import { errorHandler } from "../middleware/error-handler.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { memoryJobService } from "../services/memory/memory-jobs.js";
import { workflowExecutorService } from "../services/workflows/workflow-executor.js";
import { admitAnalyticalRequest, isResourceAdmissionDeferred } from "../services/resource-governance.js";
import { hasPendingRunCleanup } from "../services/execution-blocker.js";

describe("configured original-owner resource admission", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let a: string, b: string, agentA: string;
  const empty: ResourceGovernancePolicy = { version: 1, pools: [], rates: [] };
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("v10-resource-admission-"); db = createDb(database.connectionString); }, 60000);
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    await db.execute(sql`truncate companies cascade`);
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: false });
    await instanceSettingsService(db).updateGeneral({ resourceGovernance: empty });
    a = randomUUID(); b = randomUUID(); agentA = randomUUID();
    await db.insert(companies).values([{ id: a, name: "Bursty tenant", issuePrefix: "RA" }, { id: b, name: "Peer tenant", issuePrefix: "RB" }]);
    await db.insert(agents).values({ id: agentA, companyId: a, name: "Original run owner", adapterType: "paperclip_runner", status: "active" });
  });
  async function configure(resource: "durable_execution" | "analytical_request", hardLimit: number, companyLimit = 1) {
    const policy: ResourceGovernancePolicy = { version: 1, rates: [], pools: [{ resource,
      unit: resource === "durable_execution" ? "active_work_item" : "admitted_request", hardLimit,
      onSoftLimit: "observe", onHardLimit: resource === "durable_execution" ? "defer" : "reject", exceptionOwner: "Measured fixture operator",
      companies: [a,b].map(companyId => ({ companyId, hardLimit: companyLimit, fairnessClass: "shared", priority: 2 })) }] };
    await instanceSettingsService(db).updateGeneral({ resourceGovernance: policy });
    return policy;
  }
  // Skeletal rows test admission/claim custody only, never successful private
  // Memory computation. The original worker must still refuse their sources.
  async function queue(companyId: string, operationType: "dedupe" | "retention" = "dedupe", submittedAt = new Date()) {
    return (await db.insert(memoryJobs).values({ companyId, operationType, jobKey: randomUUID(), sourceRefJson: {}, submittedAt }).returning())[0]!;
  }
  async function pending(id: string) { return (await db.select().from(memoryJobs).where(eq(memoryJobs.id, id)))[0]!; }

  it("has no invented capacity when the operator configured none", async () => {
    const one = await queue(a), two = await queue(a);
    const worker = memoryJobService(db);
    expect((await worker.claimNext())?.id).toBe(one.id);
    expect((await worker.claimNext())?.id).toBe(two.id);
  });

  it("serializes competing original heartbeat and Memory positive claims across real database sessions", async () => {
    await configure("durable_execution", 1);
    const runId = randomUUID(), job = await queue(b);
    await db.insert(heartbeatRuns).values({ id: runId, companyId: a, agentId: agentA, status: "queued" });
    const { workflow, revision } = await db.transaction(async tx => {
      const [workflow] = await tx.insert(workflows).values({ companyId: a, name: `Resource gate ${randomUUID()}` }).returning();
      const [revision] = await tx.insert(workflowRevisions).values({ companyId: a, workflowId: workflow!.id,
        revisionNumber: 1, state: "published", graph: { version: 1, nodes: [], edges: [] } }).returning();
      await tx.update(workflows).set({ publishedRevisionId: revision!.id }).where(eq(workflows.id, workflow!.id));
      return { workflow: workflow!, revision: revision! };
    });
    const [workflowRun] = await db.insert(workflowRuns).values({ companyId: a, workflowId: workflow.id,
      workflowRevisionId: revision.id, status: "queued" }).returning();
    const other = createDb(database.connectionString);
    const results = await Promise.all([
      db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, runId)).returning()
        .then(rows => rows.length, error => { expect(isResourceAdmissionDeferred(error)).toBe(true); return 0; }),
      memoryJobService(other).claimNext().then(row => row ? 1 : 0),
      db.update(workflowRuns).set({ status: "running" }).where(eq(workflowRuns.id, workflowRun!.id)).returning()
        .then(rows => rows.length, error => { expect(isResourceAdmissionDeferred(error)).toBe(true); return 0; }),
    ]);
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(1);
    const [count] = await db.execute<{ count: string }>(sql`select public.aw_v10_resource_durable_occupancy(null)::text as count`);
    expect(count.count).toBe("1");
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    const [workflowState] = await db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, workflowRun!.id));
    expect([run.status, (await pending(job.id)).status, workflowState!.status].sort()).toEqual(["queued", "queued", "running"]);
  });

  it("counts uncertain native execution conservatively, excludes provably never-started queues, and uses the liability index", async () => {
    const oldNeverStarted = Array.from({ length: 1400 }, () => ({ companyId: a, agentId: agentA,
      status: "queued", runtimeMode: "native" }));
    const historicalRuns = await db.insert(heartbeatRuns).values(oldNeverStarted).returning({ id: heartbeatRuns.id });
    await db.insert(heartbeatRunEvents).values(historicalRuns.map(run => ({ companyId: a, agentId: agentA,
      runId: run.id, seq: 1, eventType: "lifecycle", payload: {} })));
    const [startedQueue, unknownTerminal, eventOwned] = await db.insert(heartbeatRuns).values([
      { companyId: a, agentId: agentA, status: "queued", runtimeMode: "native", startedAt: new Date() },
      { companyId: a, agentId: agentA, status: "failed", runtimeMode: "native", finishedAt: new Date() },
      { companyId: a, agentId: agentA, status: "queued", runtimeMode: "native" },
    ]).returning();
    expect(startedQueue && unknownTerminal && eventOwned).toBeTruthy();
    const occupancy = async () => {
      const [row] = await db.execute<{ count: string }>(sql`select public.aw_v10_resource_durable_occupancy(${a}::uuid)::text as count`);
      return row!.count;
    };
    expect(await occupancy()).toBe("2");
    await db.transaction(async tx => tx.transaction(async savepoint => {
      await savepoint.insert(heartbeatRunEvents).values({ companyId: a, agentId: agentA, runId: eventOwned!.id,
        seq: 1, eventType: "native.process_start_requested", payload: {} });
      expect((await savepoint.select({ pending: heartbeatRuns.nativeProcessCleanupPending }).from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, eventOwned!.id)))[0]!.pending).toBe(true);
      await savepoint.insert(heartbeatRunEvents).values({ companyId: a, agentId: agentA, runId: eventOwned!.id,
        seq: 2, eventType: "native.local_process_stopped", payload: {} });
      expect((await savepoint.select({ pending: heartbeatRuns.nativeProcessCleanupPending }).from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, eventOwned!.id)))[0]!.pending).toBe(false);
    }));
    expect(await occupancy()).toBe("2");
    await expect(db.update(heartbeatRuns).set({ nativeProcessCleanupPending: true }).where(eq(heartbeatRuns.id, eventOwned!.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });

    await db.execute(sql`analyze heartbeat_runs`);
    await db.execute(sql`analyze heartbeat_run_events`);
    const eventPlan = await db.execute(sql`explain (format json) select id,event_type from heartbeat_run_events
      where company_id=${a}::uuid and run_id=${eventOwned!.id}::uuid and agent_id=${agentA}::uuid
        and source_event_id is null and event_type in ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped')
      order by seq desc limit 1`);
    expect(JSON.stringify(eventPlan)).toContain("heartbeat_run_events_company_run_idx");
    expect(JSON.stringify(eventPlan)).not.toContain("Seq Scan");
    const plan = await db.execute(sql`explain (format json) select company_id,id from heartbeat_runs
      where company_id=${a}::uuid and (native_process_cleanup_pending is true or
        (native_process_cleanup_pending is null and runtime_mode='native' and
          (status<>'queued' or started_at is not null or process_started_at is not null or process_pid is not null
            or process_group_id is not null or native_phase is not null or session_id_after is not null)))`);
    expect(JSON.stringify(plan)).toContain("heartbeat_runs_resource_local_cleanup_idx");
    expect(JSON.stringify(plan)).not.toContain("Seq Scan");
    expect(startedQueue!.nativeProcessCleanupPending).toBeNull();
  });

  it("backfills legacy cleanup projection from the latest original native process event", async () => {
    let projected: Array<{ id: string; pending: boolean | null }> = [];
    await expect(db.transaction(async tx => {
      const runs = await tx.insert(heartbeatRuns).values([
        { companyId: a, agentId: agentA, status: "failed", runtimeMode: "native", finishedAt: new Date() },
        { companyId: a, agentId: agentA, status: "failed", runtimeMode: "native", finishedAt: new Date() },
      ]).returning({ id: heartbeatRuns.id });
      await tx.execute(sql`drop trigger aw_v10_native_process_cleanup_projection on heartbeat_runs`);
      await tx.execute(sql`drop trigger aw_v10_append_native_process_cleanup_projection on heartbeat_run_events`);
      await tx.insert(heartbeatRunEvents).values([
        { companyId: a, agentId: agentA, runId: runs[0]!.id, seq: 1,
          eventType: "native.process_start_requested", payload: {} },
        { companyId: a, agentId: agentA, runId: runs[1]!.id, seq: 1,
          eventType: "native.process_start_requested", payload: {} },
        { companyId: a, agentId: agentA, runId: runs[1]!.id, seq: 2,
          eventType: "native.local_process_stopped", payload: {} },
      ]);
      projected = await tx.execute(sql`with latest as (
        select distinct on (run_id) run_id,company_id,agent_id,event_type from heartbeat_run_events
        where source_event_id is null and event_type in ('native.process_start_requested','native.process_identity_recorded','native.local_process_stopped')
        order by run_id,seq desc
      ) update heartbeat_runs h set native_process_cleanup_pending=(e.event_type<>'native.local_process_stopped')
        from latest e where h.id=e.run_id and h.company_id=e.company_id and h.agent_id=e.agent_id
        returning h.id,h.native_process_cleanup_pending as pending`);
      throw new Error("Rollback legacy projection fixture");
    })).rejects.toThrow("Rollback legacy projection fixture");
    expect(projected).toHaveLength(2);
    expect(projected.map(row => row.pending).sort()).toEqual([false, true]);
  });

  it("keeps native finalization and environment cleanup liabilities occupied until their original owners settle", async () => {
    const [issue] = await db.insert(issues).values({ companyId: a, title: "cleanup owner", status: "in_progress" }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: a, agentId: agentA, nativeIssueId: issue!.id,
      status: "succeeded", runtimeMode: "native", startedAt: new Date(), finishedAt: new Date() }).returning();
    await db.insert(heartbeatRunEvents).values([
      { companyId: a, agentId: agentA, runId: run!.id, seq: 1, eventType: "native.process_start_requested", payload: {} },
      { companyId: a, agentId: agentA, runId: run!.id, seq: 2, eventType: "native.local_process_stopped", payload: {} },
    ]);
    await db.insert(nativeRunFinalizations).values({ companyId: a, issueId: issue!.id, runId: run!.id, phase: "workspace_finalizing" });
    const [environment] = await db.insert(environments).values({ name: `resource-cleanup-${randomUUID()}`, driver: "sandbox" }).returning();
    const [lease] = await db.insert(environmentLeases).values({ companyId: a, environmentId: environment!.id,
      heartbeatRunId: run!.id, issueId: issue!.id, provider: "daytona", providerLeaseId: "sandbox-owned",
      status: "pending_cleanup", leasePolicy: "ephemeral" }).returning();
    const occupancy = async () => {
      const [row] = await db.execute<{ count: string }>(sql`select public.aw_v10_resource_durable_occupancy(${a}::uuid)::text as count`);
      return row!.count;
    };
    expect(await occupancy()).toBe("1");
    expect(await hasPendingRunCleanup(db, a, run!.id)).toBe(true);
    await db.update(nativeRunFinalizations).set({ phase: "committed" }).where(eq(nativeRunFinalizations.runId, run!.id));
    expect(await occupancy()).toBe("1");
    expect(await hasPendingRunCleanup(db, a, run!.id)).toBe(true);
    await db.update(environmentLeases).set({ status: "released", releasedAt: new Date(), cleanupStatus: "success" })
      .where(eq(environmentLeases.id, lease!.id));
    expect(await occupancy()).toBe("0");
    expect(await hasPendingRunCleanup(db, a, run!.id)).toBe(false);
  });

  it("rolls back admission with its owner claim and defers immediately when the shared fence is busy", async () => {
    await configure("durable_execution", 1);
    const [first, second] = await db.insert(heartbeatRuns).values([
      { companyId: a, agentId: agentA, status: "queued" }, { companyId: a, agentId: agentA, status: "queued" },
    ]).returning();
    await expect(db.transaction(async tx => {
      await tx.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, first!.id));
      throw new Error("owner transaction rollback");
    })).rejects.toThrow("owner transaction rollback");
    await db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, second!.id));
    expect((await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, first!.id)))[0]!.status).toBe("queued");

    const other = createDb(database.connectionString);
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const lockOwner = other.transaction(async tx => { await tx.execute(sql`select pg_advisory_xact_lock(740020,1)`); entered(); await held; });
    await ready;
    try {
      const admission = db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, first!.id))
        .then(() => "admitted", error => isResourceAdmissionDeferred(error) ? "deferred" : "error");
      const result = await Promise.race([admission, new Promise<"blocked">(resolve => setTimeout(() => resolve("blocked"), 250))]);
      expect(result).toBe("deferred");
    } finally { release(); await lockOwner; }
  });

  it("aborts a cutover when an event FK writer is in flight, then retries without a journal gap", async () => {
    const [run] = await db.insert(heartbeatRuns).values({ companyId: a, agentId: agentA, status: "running", runtimeMode: "native" }).returning();
    const writer = createDb(database.connectionString);
    const [journal] = await db.execute<{ tableSchema: string }>(sql`select table_schema as "tableSchema"
      from information_schema.tables where table_name='__drizzle_migrations' order by (table_schema='drizzle') desc limit 1`);
    expect(journal).toBeTruthy();
    const journalTable = sql.raw(`"${journal!.tableSchema.replaceAll('"', '""')}"."__drizzle_migrations"`);
    const journalColumns = await db.execute<{ columnName: string }>(sql`select column_name as "columnName"
      from information_schema.columns where table_schema=${journal!.tableSchema} and table_name='__drizzle_migrations'`);
    const hasHash = journalColumns.some(column => column.columnName === "hash");
    const hasName = journalColumns.some(column => column.columnName === "name");
    const hasCreatedAt = journalColumns.some(column => column.columnName === "created_at");
    const marker = `resource-cutover-${randomUUID()}`;
    const insertJournalMarker = async (executor: typeof db) => {
      if (hasHash && hasName && hasCreatedAt) await executor.execute(sql`insert into ${journalTable} (hash,name,created_at) values (${marker},${marker},${Date.now()})`);
      else if (hasHash && hasName) await executor.execute(sql`insert into ${journalTable} (hash,name) values (${marker},${marker})`);
      else if (hasHash && hasCreatedAt) await executor.execute(sql`insert into ${journalTable} (hash,created_at) values (${marker},${Date.now()})`);
      else if (hasHash) await executor.execute(sql`insert into ${journalTable} (hash) values (${marker})`);
      else if (hasName && hasCreatedAt) await executor.execute(sql`insert into ${journalTable} (name,created_at) values (${marker},${Date.now()})`);
      else await executor.execute(sql`insert into ${journalTable} (name) values (${marker})`);
    };
    const markerCount = async () => {
      const [row] = hasHash
        ? await db.execute<{ count: string }>(sql`select count(*)::text as count from ${journalTable} where hash=${marker}`)
        : await db.execute<{ count: string }>(sql`select count(*)::text as count from ${journalTable} where name=${marker}`);
      return row!.count;
    };

    let markHeartbeatLock!: () => void, releaseFailedCutover!: () => void;
    const heartbeatLock = new Promise<void>(resolve => { markHeartbeatLock = resolve; });
    const holdFailedCutover = new Promise<void>(resolve => { releaseFailedCutover = resolve; });
    const failedCutover = db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout='100ms'`);
      await tx.execute(sql`set local statement_timeout='3s'`);
      await tx.execute(sql`lock table heartbeat_runs in access exclusive mode`);
      markHeartbeatLock(); await holdFailedCutover;
      await tx.execute(sql`lock table heartbeat_run_events in share row exclusive mode nowait`);
      await tx.execute(sql`alter table heartbeat_runs add column resource_admission_probe integer`);
      await insertJournalMarker(tx as unknown as typeof db);
    });
    await heartbeatLock;
    let blockedEventFinished = false;
    // This insert takes the event table write lock, then waits for its heartbeat
    // FK behind the cutover. NOWAIT must make migration roll back before it
    // requests an event-table lock, letting this writer finish cleanly.
    const blockedEvent = writer.transaction(async tx => {
      await tx.insert(heartbeatRunEvents).values({ companyId: a, agentId: agentA, runId: run!.id, seq: 1,
        eventType: "native.process_start_requested", payload: {} });
      blockedEventFinished = true;
    });
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(blockedEventFinished).toBe(false);
    } finally { releaseFailedCutover(); }
    await expect(failedCutover).rejects.toMatchObject({ cause: { code: "55P03" } });
    await blockedEvent;
    expect(blockedEventFinished).toBe(true);
    expect(await markerCount()).toBe("0");
    expect((await db.select({ pending: heartbeatRuns.nativeProcessCleanupPending }).from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, run!.id)))[0]!.pending).toBe(true);

    let markRetryReady!: () => void, releaseRetry!: () => void;
    const retryReady = new Promise<void>(resolve => { markRetryReady = resolve; });
    const retryHold = new Promise<void>(resolve => { releaseRetry = resolve; });
    const retry = db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout='5s'`);
      await tx.execute(sql`set local statement_timeout='3s'`);
      await tx.execute(sql`lock table heartbeat_runs in access exclusive mode`);
      await tx.execute(sql`lock table heartbeat_run_events in share row exclusive mode nowait`);
      await tx.execute(sql`alter table heartbeat_runs add column resource_admission_probe integer`);
      await tx.execute(sql`create trigger resource_admission_cutover_probe after insert on heartbeat_run_events
        for each row execute function public.aw_v10_append_native_process_cleanup_projection()`);
      await insertJournalMarker(tx as unknown as typeof db);
      markRetryReady(); await retryHold;
    });
    await retryReady;
    let retryEventFinished = false;
    const retryEvent = writer.transaction(async tx => {
      await tx.insert(heartbeatRunEvents).values({ companyId: a, agentId: agentA, runId: run!.id, seq: 2,
        eventType: "native.process_identity_recorded", payload: {} });
      retryEventFinished = true;
    });
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(retryEventFinished).toBe(false);
    } finally { releaseRetry(); }
    await retry; await retryEvent;
    expect(retryEventFinished).toBe(true);
    expect(await markerCount()).toBe("1");
    expect((await db.select({ pending: heartbeatRuns.nativeProcessCleanupPending }).from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, run!.id)))[0]!.pending).toBe(true);
    if (hasHash) await db.execute(sql`delete from ${journalTable} where hash=${marker}`);
    else await db.execute(sql`delete from ${journalTable} where name=${marker}`);
    await db.execute(sql`drop trigger resource_admission_cutover_probe on heartbeat_run_events`);
    await db.execute(sql`alter table heartbeat_runs drop column resource_admission_probe`);
  });

  it("skips a saturated company while preserving its pending work and a peer's slot", async () => {
    await configure("durable_execution", 2);
    const worker = memoryJobService(db), first = await queue(a);
    expect((await worker.claimNext())?.id).toBe(first.id);
    const backlog = await queue(a), peer = await queue(b);
    expect((await worker.claimNext())?.id).toBe(peer.id);
    expect((await pending(backlog.id)).status).toBe("queued");
    expect(await worker.claimNext()).toBeNull();
  });

  it("serves an eligible peer ahead of an older tenant burst without reversing company FIFO", async () => {
    await configure("durable_execution", 1);
    const worker = memoryJobService(db), old = new Date(Date.now() - 60000);
    const first = await queue(a, "dedupe", old), second = await queue(a, "dedupe", new Date(old.getTime() + 1));
    await queue(a, "dedupe", new Date(old.getTime() + 2));
    const peer = await queue(b);
    const admitted = await worker.claimNext(); expect(admitted?.id).toBe(first.id);
    await worker.executeClaimed(admitted!);
    expect((await pending(first.id)).status).toBe("failed"); // Original Source/feature refusal, never seeded success.
    const next = await worker.claimNext(); expect(next?.id).toBe(peer.id);
    expect((await pending(second.id)).status).toBe("queued");
    await worker.executeClaimed(next!);
    expect((await worker.claimNext())?.id).toBe(second.id);
  });

  it("reads Memory fairness progress through a bounded company index with representative completed history", async () => {
    const timestamp = new Date("2026-10-01T00:00:00Z");
    await db.insert(memoryJobs).values(Array.from({ length: 1400 }, (_, index) => ({
      companyId: index % 2 ? b : a, operationType: "dedupe" as const, status: "succeeded" as const, jobKey: randomUUID(),
      sourceRefJson: {}, submittedAt: timestamp, startedAt: new Date(timestamp.getTime() + index),
      finishedAt: new Date(timestamp.getTime() + index + 1), createdAt: timestamp,
      updatedAt: new Date(timestamp.getTime() + index + 2),
    })));
    // The fair-progress index is useful at scale; enough closed non-progress
    // rows make the planner choose it naturally without planner settings.
    const failedHistory = Array.from({ length: 14000 }, () => ({
      companyId: a, operationType: "dedupe" as const, status: "failed" as const, jobKey: randomUUID(),
      sourceRefJson: {}, submittedAt: timestamp, finishedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    }));
    for (let index = 0; index < failedHistory.length; index += 1000) {
      await db.insert(memoryJobs).values(failedHistory.slice(index, index + 1000));
    }
    await queue(a); await queue(b);
    await db.execute(sql`analyze memory_jobs`);
    const plan = await db.execute(sql`explain (format json) select h.updated_at from memory_jobs h
      where h.company_id=${a}::uuid and h.started_at is not null
      order by h.updated_at desc nulls last,h.id desc nulls last limit 1`);
    expect(JSON.stringify(plan)).toContain("memory_jobs_resource_progress_idx");
    expect(JSON.stringify(plan)).not.toContain('"Node Type":"Sort"');
    const queuePlan = await db.execute(sql`explain (format json) select queued.id,queued.company_id,queued.submitted_at,queued.created_at
      from memory_jobs queued where queued.company_id=${a}::uuid and queued.status='queued'
      order by queued.submitted_at,queued.created_at,queued.id limit 1`);
    expect(JSON.stringify(queuePlan)).toContain("memory_jobs_resource_queued_idx");
    expect(JSON.stringify(queuePlan)).not.toContain("Seq Scan");
    const companiesPlan = await db.execute(sql`explain (format json) select distinct company_id from memory_jobs where status='queued'`);
    expect(JSON.stringify(companiesPlan)).toContain("memory_jobs_queue_idx");
    expect(JSON.stringify(companiesPlan)).not.toContain("Seq Scan");
    await configure("durable_execution", 1);
    const next = await memoryJobService(db).claimNext();
    expect(next?.companyId).toBe(a);
  });

  it("gives an eligible company workflow progress ahead of an older stale burst without changing its queue owner", async () => {
    const seedWorkflow = async (companyId: string) => db.transaction(async tx => {
      const [workflow] = await tx.insert(workflows).values({ companyId, name: `Workflow fairness ${randomUUID()}` }).returning();
      const [revision] = await tx.insert(workflowRevisions).values({ companyId, workflowId: workflow!.id, revisionNumber: 1,
        state: "published", graph: { version: 1, nodes: [{ id: "start", name: "Start", type: "core.manual_trigger",
          config: {}, position: { x: 0, y: 0 } }], edges: [], variables: [], settings: {} } }).returning();
      await tx.update(workflows).set({ publishedRevisionId: revision!.id }).where(eq(workflows.id, workflow!.id));
      return { workflow: workflow!, revision: revision! };
    });
    const left = await seedWorkflow(a), right = await seedWorkflow(b);
    const otherTenants = Array.from({ length: 18 }, () => ({
      id: randomUUID(), name: `Workflow history ${randomUUID()}`, issuePrefix: `R${randomUUID().slice(0, 5).toUpperCase()}`,
    }));
    await db.insert(companies).values(otherTenants);
    const tenantWorkflows = new Map<string, Awaited<ReturnType<typeof seedWorkflow>>>([[a, left], [b, right]]);
    for (const tenant of otherTenants) tenantWorkflows.set(tenant.id, await seedWorkflow(tenant.id));
    const old = new Date("2026-10-01T00:00:00Z");
    const historyTenants = [...tenantWorkflows.keys()];
    const completedHistory = Array.from({ length: 14000 }, (_, index) => {
      const companyId = historyTenants[index % historyTenants.length]!;
      const source = tenantWorkflows.get(companyId)!;
      const progress = companyId === a ? new Date("2026-10-20T00:00:00Z")
        : companyId === b ? new Date("2026-10-10T00:00:00Z") : new Date("2026-10-15T00:00:00Z");
      return { companyId, workflowId: source.workflow.id, workflowRevisionId: source.revision.id,
        status: "succeeded" as const, startedAt: new Date(progress.getTime() - index), finishedAt: progress,
        createdAt: old, updatedAt: progress };
    });
    for (let index = 0; index < completedHistory.length; index += 1000) {
      await db.insert(workflowRuns).values(completedHistory.slice(index, index + 1000));
    }
    const [oldestBurst] = await db.insert(workflowRuns).values({ companyId: a, workflowId: left.workflow.id,
      workflowRevisionId: left.revision.id, status: "queued", createdAt: old, updatedAt: old }).returning();
    const [peer] = await db.insert(workflowRuns).values({ companyId: b, workflowId: right.workflow.id,
      workflowRevisionId: right.revision.id, status: "queued", createdAt: new Date(old.getTime() + 1000),
      updatedAt: new Date(old.getTime() + 1000) }).returning();
    await db.execute(sql`analyze workflow_runs`);
    const plan = await db.execute(sql`explain (format json) select h.updated_at from workflow_runs h
      where h.company_id=${a}::uuid and h.started_at is not null
      order by h.updated_at desc nulls last,h.id desc nulls last limit 1`);
    expect(JSON.stringify(plan)).toContain("workflow_runs_resource_progress_idx");
    expect(JSON.stringify(plan)).not.toContain('"Node Type":"Sort"');
    const queuePlan = await db.execute(sql`explain (format json) select queued.id,queued.company_id,queued.updated_at
      from workflow_runs queued where queued.company_id=${a}::uuid and queued.status='queued'
        and queued.updated_at<'2026-10-29T00:00:00Z' order by queued.updated_at,queued.id limit 1`);
    expect(JSON.stringify(queuePlan)).toContain("workflow_runs_resource_queued_idx");
    expect(JSON.stringify(queuePlan)).not.toContain("Seq Scan");
    const companiesPlan = await db.execute(sql`explain (format json) select distinct company_id from workflow_runs
      where status='queued' and updated_at<'2026-10-29T00:00:00Z'`);
    expect(JSON.stringify(companiesPlan)).toContain("workflow_runs_resource_queued_idx");
    expect(JSON.stringify(companiesPlan)).not.toContain("Seq Scan");
    await configure("durable_execution", 1);
    const now = new Date("2026-10-29T00:00:00Z");
    const result = await workflowExecutorService(db).recoverExpiredRuns(1, now);
    expect(result.recovered).toBe(1);
    const [aRun] = await db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, oldestBurst!.id));
    const [bRun] = await db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, peer!.id));
    expect(aRun!.status).toBe("queued");
    expect(bRun!.status).toBe("succeeded");
  });

  it("keeps cancellation recovery progressing under a stale queued-run backlog", async () => {
    const old = new Date("2026-10-01T00:00:00Z");
    const createPublished = async (companyId: string) => db.transaction(async tx => {
      const [workflow] = await tx.insert(workflows).values({ companyId, name: `Recovery fairness ${randomUUID()}` }).returning();
      const [revision] = await tx.insert(workflowRevisions).values({ companyId, workflowId: workflow!.id,
        revisionNumber: 1, state: "published", graph: { version: 1,
          nodes: [{ id: "start", name: "Start", type: "core.manual_trigger", config: {}, position: { x: 0, y: 0 } }],
          edges: [], variables: [], settings: {} } }).returning();
      await tx.update(workflows).set({ publishedRevisionId: revision!.id }).where(eq(workflows.id, workflow!.id));
      return { workflow: workflow!, revision: revision! };
    });
    const left = await createPublished(a), right = await createPublished(b);
    const queued = await db.insert(workflowRuns).values([
      ...Array.from({ length: 3 }, () => ({ companyId: a, workflowId: left.workflow.id,
        workflowRevisionId: left.revision.id, status: "queued" as const, createdAt: old, updatedAt: old })),
      ...Array.from({ length: 3 }, () => ({ companyId: b, workflowId: right.workflow.id,
        workflowRevisionId: right.revision.id, status: "queued" as const, createdAt: old, updatedAt: old })),
    ]).returning();
    const [cancelling] = await db.insert(workflowRuns).values({ companyId: a, workflowId: left.workflow.id,
      workflowRevisionId: left.revision.id, status: "cancelling", createdAt: old, updatedAt: old }).returning();
    await configure("durable_execution", 100, 100);

    const result = await workflowExecutorService(db).recoverExpiredRuns(2, new Date("2026-10-29T00:00:00Z"));

    expect(result).toMatchObject({ checked: 3, recovered: 3, failedRunIds: [] });
    expect((await db.select({ status: workflowRuns.status }).from(workflowRuns)
      .where(eq(workflowRuns.id, cancelling!.id)))[0]!.status).toBe("cancelled");
    const queuedStatuses = await db.select({ status: workflowRuns.status }).from(workflowRuns)
      .where(inArray(workflowRuns.id, queued.map(run => run.id)));
    expect(queuedStatuses.filter(run => run.status === "succeeded")).toHaveLength(2);
    expect(queuedStatuses.filter(run => run.status === "queued")).toHaveLength(4);
  });

  it("yields a parent workflow slot before admitting its original subworkflow child", async () => {
    const createPublished = async (companyId: string, name: string, graph: WorkflowGraphV1) => db.transaction(async tx => {
      const [workflow] = await tx.insert(workflows).values({ companyId, name: `${name} ${randomUUID()}` }).returning();
      const [revision] = await tx.insert(workflowRevisions).values({ companyId, workflowId: workflow!.id,
        revisionNumber: 1, state: "published", graph }).returning();
      await tx.update(workflows).set({ publishedRevisionId: revision!.id }).where(eq(workflows.id, workflow!.id));
      return { workflow: workflow!, revision: revision! };
    });
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: true });
    const start = { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} };
    const recall = { id: "recall", type: "native.memory_recall", name: "Recall Memory", position: { x: 0, y: 1 },
      config: { query: "resource admission", limit: 1 } };
    const child = await createPublished(a, "Child workflow", { version: 1, nodes: [start, recall],
      edges: [{ id: "start-recall", source: "start", target: "recall" }], variables: [], settings: {} });
    const parent = await createPublished(a, "Parent workflow", { version: 1,
      nodes: [start, { id: "child", type: "core.subworkflow", name: "Run child", position: { x: 0, y: 1 },
        config: { workflowId: child.workflow.id, revisionId: child.revision.id, inputMapping: {}, timeoutSeconds: 60, cancellationPolicy: "propagate" } }],
      edges: [{ id: "start-child", source: "start", target: "child" }], variables: [], settings: {} });
    const peer = await createPublished(b, "Peer workflow", { version: 1, nodes: [start], edges: [], variables: [], settings: {} });
    const old = new Date("2026-10-01T00:00:00Z");
    const [queued] = await db.insert(workflowRuns).values({ companyId: a, workflowId: parent.workflow.id,
      workflowRevisionId: parent.revision.id, status: "queued", executionPrincipal: { type: "system", service: "local-board" },
      createdAt: old, updatedAt: old }).returning();
    const [peerQueued] = await db.insert(workflowRuns).values({ companyId: b, workflowId: peer.workflow.id,
      workflowRevisionId: peer.revision.id, status: "queued", createdAt: new Date(old.getTime() + 1000),
      updatedAt: new Date(old.getTime() + 1000) }).returning();
    await configure("durable_execution", 1);
    const executor = workflowExecutorService(db), now = new Date("2026-10-29T00:00:00Z");
    const result = await executor.recoverExpiredRuns(1, now);
    expect(result.recovered).toBe(1);
    const [parentRun] = await db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, queued!.id));
    const [childRun] = await db.select({ status: workflowRuns.status }).from(workflowRuns)
      .where(eq(workflowRuns.parentWorkflowRunId, queued!.id));
    expect(parentRun!.status).toBe("succeeded");
    expect(childRun!.status).toBe("succeeded");
    expect((await db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, peerQueued!.id)))[0]!.status).toBe("queued");
    const [occupancy] = await db.execute<{ count: string }>(sql`select public.aw_v10_resource_durable_occupancy(null)::text as count`);
    expect(occupancy!.count).toBe("0");
    expect((await executor.recoverExpiredRuns(1, now)).recovered).toBe(1);
    expect((await db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, peerQueued!.id)))[0]!.status).toBe("succeeded");
  });

  it("does not free original claim capacity from an expired lease clock alone", async () => {
    await configure("durable_execution", 1);
    const worker = memoryJobService(db), first = await queue(a), second = await queue(b);
    const admitted = await worker.claimNext(); expect(admitted?.id).toBe(first.id);
    await db.update(memoryJobs).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(memoryJobs.id, first.id));
    expect(await worker.claimNext()).toBeNull();
    expect((await pending(second.id)).status).toBe("queued");
    await worker.recoverExpiredLeases(new Date());
    expect((await pending(first.id)).status).toBe("failed");
    expect(await worker.claimNext()).not.toBeNull();
  });

  it("admits original retention cleanup and renewal while positive capacity is occupied", async () => {
    await configure("durable_execution", 1);
    const worker = memoryJobService(db); await queue(a);
    const admitted = await worker.claimNext(); expect(admitted).not.toBeNull();
    const cleanup = await queue(b, "retention");
    expect((await worker.claimNext())?.id).toBe(cleanup.id);
    await db.update(memoryJobs).set({ leaseExpiresAt: new Date(Date.now() + 60000) }).where(eq(memoryJobs.id, admitted!.id));
    expect((await pending(admitted!.id)).status).toBe("running");
    expect((await pending(cleanup.id)).status).toBe("running");
  });

  it("finds eligible retention behind an older ordinary job for the same tenant", async () => {
    await configure("durable_execution", 1);
    const worker = memoryJobService(db);
    const active = await queue(a);
    expect((await worker.claimNext())?.id).toBe(active.id);
    const old = new Date("2026-10-01T00:00:00Z");
    const blocked = await queue(a, "dedupe", old);
    const retention = await queue(a, "retention", new Date(old.getTime() + 1000));

    expect((await worker.claimNext())?.id).toBe(retention.id);
    expect((await pending(blocked.id)).status).toBe("queued");
    expect((await pending(retention.id)).status).toBe("running");
  });

  it("holds configured analytical request slots until the actual request transaction settles", async () => {
    await configure("analytical_request", 2);
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const active = db.transaction(async raw => { await admitAnalyticalRequest(raw as unknown as typeof db, a); entered(); await held; });
    await ready;
    try {
      await expect(db.transaction(tx => admitAnalyticalRequest(tx as unknown as typeof db, a))).rejects.toMatchObject({ status: 429 });
      await db.transaction(tx => admitAnalyticalRequest(tx as unknown as typeof db, b));
    } finally { release(); await active; }
    await db.transaction(tx => admitAnalyticalRequest(tx as unknown as typeof db, a));
    await expect(db.transaction(async tx => { await admitAnalyticalRequest(tx as unknown as typeof db, a); throw new Error("Original request rollback"); })).rejects.toThrow("Original request rollback");
    await db.transaction(tx => admitAnalyticalRequest(tx as unknown as typeof db, a));
  });

  it("requires actual current operator admission and withholds peer policy from ordinary readers", async () => {
    const human = await seedCurrentHumanSourceActor(db, [a], randomUUID());
    const peer = await seedCurrentHumanSourceActor(db, [b], randomUUID());
    const policy = await configure("durable_execution", 2);
    const app = (actor: typeof human) => {
      const server = express(); server.use(express.json()); server.use((req, _res, next) => { req.actor = actor; next(); });
      server.use("/api", instanceSettingsRoutes(db, { deploymentProfile: "saas", operatorUserIds: [human.userId!] }));
      server.use(errorHandler); return server;
    };
    const denied = await request(app(peer)).patch("/api/instance/settings/general").send({ resourceGovernance: empty });
    expect(denied.status).toBe(403);
    expect((await request(app(peer)).get("/api/instance/settings/general")).body).not.toHaveProperty("resourceGovernance");
    expect((await request(app(peer)).get("/api/instance/settings")).body.general).not.toHaveProperty("resourceGovernance");
    expect((await request(app(human)).get("/api/instance/settings/general")).body.resourceGovernance).toEqual(policy);
    const saved = await request(app(human)).patch("/api/instance/settings/general").send({ resourceGovernance: policy });
    expect(saved.status).toBe(200);
    const stale = { ...human, sessionId: randomUUID() };
    expect((await request(app(stale)).patch("/api/instance/settings/general").send({ resourceGovernance: empty })).status).toBe(403);
    expect((await instanceSettingsService(db).getGeneral()).resourceGovernance).toEqual(policy);
  });

  it("preserves a valid resource policy when repairing unrelated restored settings", async () => {
    const policy = await configure("durable_execution", 1);
    await db.insert(heartbeatRuns).values({ companyId: a, agentId: agentA, status: "running" });
    await db.execute(sql`update instance_settings set general=jsonb_set(general,'{censorUsernameInLogs}','"invalid"',true)
      where singleton_key='default'`);
    await instanceSettingsService(db).updateGeneral({ keyboardShortcuts: true });

    expect((await instanceSettingsService(db).getGeneral()).resourceGovernance).toEqual(policy);
    const blocked = await queue(b);
    expect(await memoryJobService(db).claimNext()).toBeNull();
    expect((await pending(blocked.id)).status).toBe("queued");
  });

  it("fails closed on restored malformed operator policy instead of admitting work", async () => {
    const policy = await configure("durable_execution", 1);
    const invalid = { ...policy, pools: [{ ...policy.pools[0], hardLimit: "1", paidBypass: true }] };
    await db.update(instanceSettings).set({ general: { resourceGovernance: invalid } }).where(eq(instanceSettings.singletonKey, "default"));
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: runId, companyId: a, agentId: agentA, status: "queued" });
    await expect(db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, runId))).rejects.toMatchObject({ cause: { code: "23514" } });
    expect((await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.status, "queued"))))).toHaveLength(1);
  });
});
