import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issues, type Db } from "@paperclipai/db";
import type { NativeExecutionInputV1 } from "@paperclipai/paperclip-runner";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { releaseRunClaimedJustBeforeSuppression } from "../services/heartbeat.js";
import { nativeSessionScopeSha256, verifyWarmTransitionRestart } from "../services/native-runtime/native-session-executor.js";
import { createPostgresWatchdogAdapter } from "../modules/active-run-watchdog/adapters/postgres.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

/*
 * D5d. Writers that lock a run and its Task without company locks must take
 * the Task first (run-identity.ts lock-order table), like the sandbox exec
 * checks (company shared > Task FOR SHARE > run FOR SHARE; that order is
 * pinned against the real assertTaskExecutionContext by the D5c test in
 * v7-sandbox-host-bridge.integration.test.ts). Each case queues the exec order
 * and then the writer behind a holder of the Task row, then releases it: a
 * run-first writer would hold the run while the exec check holds the Task,
 * and PostgreSQL would abort one side with deadlock_detected (40P01).
 */
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("run and Task lock order (D5d)", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-run-task-lock-order-");
    db = createDb(database.connectionString);
  }, 30_000);
  afterAll(async () => { await database?.cleanup(); }, 60_000);

  async function seed(issueStatus: string) {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Lock order", issuePrefix: companyId.slice(0, 8) });
    await db.insert(agents).values({ id: agentId, companyId, name: "Worker", role: "engineer", adapterType: "codex_local", status: "running" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Task", status: issueStatus });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", startedAt: new Date(),
      contextSnapshot: { issueId }, nativeIssueId: issueId });
    await db.update(issues).set({ executionRunId: runId, executionLockedAt: new Date() }).where(eq(issues.id, issueId));
    return { companyId, agentId, issueId, runId };
  }

  const codeOf = (error: any): string | undefined => error?.code ?? error?.cause?.code;
  const settle = <T>(promise: Promise<T>) => promise.then(
    value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error, code: codeOf(error) }));

  async function lockWaiters() {
    const [row] = await db.execute(sql`select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`) as unknown as Array<{ n: number }>;
    return Number(row.n);
  }
  async function untilLockWaiters(n: number) {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      if (await lockWaiters() >= n) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`fewer than ${n} backends waited on a lock`);
  }

  /** The exec checks' order on these rows. */
  const execOrder = (input: { companyId: string; issueId: string; runId: string }) => db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    await lockAnalyticalCompany(tx, input.companyId, "read");
    await lockMemoryPrivacy(tx, input.companyId, "read");
    await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, input.issueId)).for("share");
    await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.id, input.runId)).for("share");
  });

  async function raceWithExecOrder<T>(input: { companyId: string; issueId: string; runId: string }, writer: () => Promise<T>) {
    let release!: () => void;
    let markHeld!: () => void;
    const held = new Promise<void>(resolve => { markHeld = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const holder = db.transaction(async (tx) => {
      await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, input.issueId)).for("update");
      markHeld();
      await released;
    });
    await held;
    const exec = settle(execOrder(input));
    await untilLockWaiters(1);
    const written = settle(writer());
    await untilLockWaiters(2);
    release();
    await holder;
    const [execResult, writerResult] = await Promise.all([exec, written]);
    expect([execResult.ok ? null : execResult.code, writerResult.ok ? null : writerResult.code],
      "neither side may be aborted as a deadlock").not.toContain("40P01");
    expect(execResult.ok).toBe(true);
    return writerResult;
  }

  it("watchdog fold locks the source Task before the run", async () => {
    const input = await seed("done");
    const now = new Date();
    const result = await raceWithExecOrder(input, () => createPostgresWatchdogAdapter(db).foldSourceResolvedRun(input.companyId, {
      run: { id: input.runId, companyId: input.companyId, agentId: input.agentId, status: "running", lastOutputAt: null,
        lastOutputSeq: null, lastOutputStream: null, processStartedAt: null, startedAt: now, createdAt: now,
        sourceIssueId: input.issueId, resultJson: null, wakeupRequestId: null, processPid: null, processGroupId: null },
      sourceIssue: { id: input.issueId, identifier: null, status: "done", originKind: null, isRecoveryOriginKind: false },
      evidence: { kind: "activity", id: randomUUID(), createdAt: now, action: "issue.updated" },
      existingEvaluation: null, silenceStartedAt: null, silenceAgeMs: null,
      cleanup: { attempted: false, outcome: "no_process_metadata", adapterType: "codex_local" }, now,
    }));
    expect(result).toMatchObject({ ok: true, value: { kind: "folded" } });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, input.runId));
    const [task] = await db.select().from(issues).where(eq(issues.id, input.issueId));
    expect(run.status).toBe("succeeded");
    expect(task.executionRunId).toBeNull();
  });

  it("claim release locks the run's Task before the run", async () => {
    const input = await seed("in_progress");
    const result = await raceWithExecOrder(input, () => releaseRunClaimedJustBeforeSuppression(db, input.runId));
    expect(result.ok).toBe(true);
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, input.runId));
    const [task] = await db.select().from(issues).where(eq(issues.id, input.issueId));
    expect(run).toMatchObject({ status: "queued", startedAt: null });
    expect(task.executionRunId).toBeNull();
  });

  it("claim release retries when the run names another Task after the lock, with the same outcome as before", async () => {
    const input = await seed("in_progress");
    const otherIssueId = randomUUID();
    await db.insert(issues).values({ id: otherIssueId, companyId: input.companyId, title: "Other", status: "in_progress",
      executionRunId: input.runId });
    // The release reads the run (Task A) unlocked, locks Task A, and waits on
    // the run held here; the run's context then names Task B. The release
    // rolls back, retries in Task B > run order, and clears Task B, exactly
    // what the run-first release cleared (the Task its updated run names).
    let release!: () => void;
    let markHeld!: () => void;
    const held = new Promise<void>(resolve => { markHeld = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const holder = db.transaction(async (tx) => {
      await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.id, input.runId)).for("update");
      markHeld();
      await released;
      await tx.update(heartbeatRuns).set({ contextSnapshot: { issueId: otherIssueId } }).where(eq(heartbeatRuns.id, input.runId));
    });
    await held;
    const result = settle(releaseRunClaimedJustBeforeSuppression(db, input.runId));
    await untilLockWaiters(1);
    release();
    await holder;
    expect(await result).toMatchObject({ ok: true });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, input.runId));
    const [other] = await db.select().from(issues).where(eq(issues.id, otherIssueId));
    const [task] = await db.select().from(issues).where(eq(issues.id, input.issueId));
    expect(run.status).toBe("queued");
    expect(other.executionRunId).toBeNull();
    expect(task.executionRunId).toBe(input.runId);
  });

  it("warm restart verification locks the binding's Task before the run", async () => {
    const input = await seed("in_progress");
    const execution: NativeExecutionInputV1 = {
      schema: "paperclip.native-execution-input.v1",
      provider: { kind: "codex", model: null },
      binding: { companyId: input.companyId, agentId: input.agentId, issueId: input.issueId, runId: input.runId,
        executionWorkspaceId: input.runId },
      task: { identifier: "LOCK-1", title: "Task", description: null, prompt: "Task", workMode: "standard" },
      workspace: { cwd: tmpdir(), repoUrl: null, repoRef: null, branchName: null },
      session: { normalizedSessionId: `session-${input.runId}`, driverKind: "codex_app_server", protocolVersion: 1,
        lifecyclePolicy: { mode: "warm", idleTimeoutMs: 60_000 } },
      completionContract: { id: randomUUID(), sha256: "fixture", schemaVersion: "paperclip.completion-contract.v1",
        contract: { revision: "1", objective: "Task", criteria: [{ id: "objective", requirement: "Do it" }] } },
      interactionResponses: [],
      credentialBindings: [],
    };
    // Just enough state on disk for the verifier to reach its transaction;
    // it then denies (no retained transition), after taking its locks.
    const stateBase = await mkdtemp(join(tmpdir(), "paperclip-lock-order-runnerd-"));
    const root = join(stateBase, nativeSessionScopeSha256(execution as any));
    await mkdir(join(root, "control-plane"), { recursive: true });
    await mkdir(join(root, "runner"), { recursive: true });
    await writeFile(join(root, "control-plane", "control-plane-state.json"), "{}");
    await writeFile(join(root, "runner", "runner-state.json"), "{}");
    const previous = { state: process.env.PAPERCLIP_RUNNER_STATE_DIR, binary: process.env.PAPERCLIP_RUNNER_BINARY };
    process.env.PAPERCLIP_RUNNER_STATE_DIR = stateBase;
    process.env.PAPERCLIP_RUNNER_BINARY = process.execPath;
    try {
      const result = await raceWithExecOrder(input, () => verifyWarmTransitionRestart({
        db, execution: execution as any, runnerExecutionTarget: null,
        restartRecovery: { kind: "resume_dead_runner", runId: input.runId, leaseOwner: "lock-order-test",
          controllerGeneration: 1, providerAttempt: 1, restartKind: "hard", recoveryRequestId: null },
      }));
      expect(result.ok).toBe(false);
      expect(String((result as { error: unknown }).error)).toContain("native_runner_warm_transition_recovery_unproven");
    } finally {
      if (previous.state === undefined) delete process.env.PAPERCLIP_RUNNER_STATE_DIR;
      else process.env.PAPERCLIP_RUNNER_STATE_DIR = previous.state;
      if (previous.binary === undefined) delete process.env.PAPERCLIP_RUNNER_BINARY;
      else process.env.PAPERCLIP_RUNNER_BINARY = previous.binary;
      await rm(stateBase, { recursive: true, force: true });
    }
  });
});
