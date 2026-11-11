import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDb, agents, heartbeatRuns, nativeRunFinalizations } from "@paperclipai/db";
import { issueService } from "../services/issues.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { withManagedNativeHeartbeatFixture } from "./helpers/managed-native-heartbeat-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>, root: string;
let completed = 0;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "managed-native-selection-fence-"));
  vi.stubEnv("PAPERCLIP_HOME", root);
  database = await startEmbeddedPostgresTestDatabase("managed-native-selection-fence-", {
    preserveDataOnFailure: () => completed !== 2,
  });
  // Holder + Stop + actual selection + observer need independent connections.
  db = createDb(database.connectionString, { maxConnections: 5, connectTimeoutSeconds: 5 });
}, 60_000);
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (root && completed === 2) {
    await makeFixtureTreeWritable(root);
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

async function bounded<T>(promise: Promise<T>, label: string, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`native_selection_fence_deadline_${label}`)), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
function observed<T>(promise: Promise<T>) {
  return promise.then(value => ({ value, error: undefined as unknown }),
    error => ({ value: undefined, error }));
}

it.each(["single Stop", "agent pause"] as const)(
  "fences actual Native selection behind an earlier no-owner %s without starting a provider",
  async operation => {
    let reportSelection!: (runId: string) => void;
    const selectionReady = new Promise<string>(resolve => { reportSelection = resolve; });
    let releaseSelection!: () => void;
    const selectionGate = new Promise<void>(resolve => { releaseSelection = resolve; });
    let selectedRunId: string | undefined;
    let selectionEntered = false;
    await withManagedNativeHeartbeatFixture({ db, root, opencodeBinary: qualifiedOpenCodeBinary(),
      timeoutSec: 300, schedulerMode: "serial",
      providerReply: () => { throw new Error("native_selection_fence_provider_must_not_start"); },
      beforeNativeRuntimeSelection: async runId => {
        if (selectedRunId) throw new Error("native_selection_fence_unrequested_second_selection");
        selectedRunId = runId;
        reportSelection(runId);
        await bounded(selectionGate, "selection_release", 45_000);
        selectionEntered = true;
      },
      driveScheduler: async ({ actor, companyId, agentId, heartbeat, facts }) => {
        if (!actor.userId) throw new Error("native_selection_fence_current_human_missing");
        await db.update(agents).set({ runtimeConfig: { timeoutSec: 300,
          heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).where(eq(agents.id, agentId));
        const task = await issueService(db).create(companyId, {
          title: `Native startup fenced by ${operation}`,
          description: "Do not start the qualified Native worker after this Human cancels its preparation.",
          status: "todo", responsibleUserId: actor.userId, createdByUserId: actor.userId, assigneeAgentId: agentId,
        }, db, undefined, { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
        const plans = orchestrationService(db);
        const plan = await plans.create(actor, companyId, { issueId: task.id,
          expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
          completionContract: { objective: "Respect cancellation before Native startup",
            requiredOutputs: [{ kind: "task_document", key: "result" }],
            businessInvariants: ["No model dispatch after Stop"] },
          budgets: { maxModelCostMinor: 10, maxToolActions: 3 }, workers: [{ key: "writer", issueId: task.id }] });
        await plans.decide(actor, companyId, plan.id, { expectedVersion: plan.version, action: "start",
          rationale: "Current Human admits one bounded Native startup cancellation race" });
        const wake = observed(heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system",
          reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: actor.userId,
          payload: { issueId: task.id }, contextSnapshot: { issueId: task.id, wakeReason: "issue_assigned" } }));
        let releaseRow: () => void = () => {};
        let holder: Promise<unknown> | undefined;
        let stopping: Promise<{ value: Awaited<ReturnType<typeof heartbeat.getRun>> | undefined; error: unknown }> | undefined;
        let runToStop: string | undefined;
        try {
          const wakeFailed = wake.then(result => {
            if (result.error) throw result.error;
            return new Promise<never>(() => {});
          });
          const runId = await bounded(Promise.race([selectionReady, wakeFailed]), "genuine_preparation", 120_000);
          runToStop = runId;
          expect(await heartbeat.getRun(runId)).toMatchObject({ companyId, agentId, status: "running", processPid: null });
          const coordinators = () => db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, runId));
          expect(await coordinators()).toEqual([]);
          expect(facts().providerCallCount).toBe(0);
          let reportRow!: (pid: number) => void;
          const rowReady = new Promise<number>(resolve => { reportRow = resolve; });
          const rowGate = new Promise<void>(resolve => { releaseRow = resolve; });
          holder = db.transaction(async tx => {
            // Bound every held-row failure path; no fixture error can hold it forever.
            await tx.execute(sql`set local statement_timeout = '30s'`);
            await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
              .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId))).for("update");
            const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
            reportRow(backend!.pid);
            await bounded(rowGate, "row_release", 25_000);
          });
          // Observe rejection immediately, while retaining the original holder promise.
          void holder.catch(() => undefined);
          const holderPid = await bounded(rowReady, "row_acquired");
          let stopReturned = false;
          const stop = operation === "single Stop" ? heartbeat.cancelRun(runId)
            : heartbeat.cancelActiveForAgent(agentId).then(() => heartbeat.getRun(runId));
          stopping = observed(stop.then(value => { stopReturned = true; return value; }, error => {
            stopReturned = true; throw error;
          }));
          const blockedDescendants = async () => {
            // Follow the actual lock chain: selection can wait on the Task lock
            // held by Stop while Stop itself waits on our exact Run row.
            const [row] = await db.execute<{ count: number }>(sql`
              with recursive waiting(pid) as (
                select pid from pg_stat_activity where datname = current_database()
                  and ${holderPid} = any(pg_blocking_pids(pid))
                union
                select activity.pid from pg_stat_activity activity join waiting
                  on waiting.pid = any(pg_blocking_pids(activity.pid))
                  where activity.datname = current_database()
              ) select count(*)::int as count from waiting
            `);
            return row?.count ?? 0;
          };
          await expect.poll(blockedDescendants, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
          releaseSelection();
          await expect.poll(async () => selectionEntered, { timeout: 5_000 }).toBe(true);
          await expect.poll(blockedDescendants, { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
          expect(stopReturned).toBe(false);
          expect(facts().providerCallCount).toBe(0);
          expect(await coordinators()).toEqual([]);
          releaseRow();
          await bounded(holder, "holder_settlement");
          const stopped = await bounded(stopping, "stop_settlement");
          if (stopped.error) throw stopped.error;
          expect(stopped.value).toMatchObject({ id: runId, status: "cancelled" });
          const terminal = stopped.value!;
          const wakeResult = await bounded(wake, "wake_settlement", 60_000);
          if (wakeResult.error) throw wakeResult.error;
          await bounded(heartbeat.drainActiveRunExecutions(), "executor_settlement", 60_000);
          const settled = await heartbeat.getRun(runId);
          expect({ status: settled?.status, errorCode: settled?.errorCode,
            error: settled?.error, finishedAt: settled?.finishedAt }).toEqual({
            status: terminal.status, errorCode: terminal.errorCode,
            error: terminal.error, finishedAt: terminal.finishedAt });
          // Native preparation records one explicit cleanup receipt in finally.
          // Preserve every original cancellation field; no other late mutation.
          const finalResult = { ...settled?.resultJson };
          const initialResult = { ...terminal.resultJson };
          const cleanupAt = finalResult.startupPreparationSettledAt;
          if (!("startupPreparationSettledAt" in initialResult) && "startupPreparationSettledAt" in finalResult) {
            expect(cleanupAt).toEqual(expect.any(String));
            expect(Number.isFinite(Date.parse(String(cleanupAt)))).toBe(true);
            delete finalResult.startupPreparationSettledAt;
          }
          expect(finalResult).toEqual(initialResult);
          expect(settled?.processPid).toBeNull();
          expect(await coordinators()).toEqual([]);
          expect(facts().providerCallCount).toBe(0);
        } finally {
          releaseRow();
          try {
            if (holder) await bounded(holder, "final_holder");
            // Close the actual preparation before releasing an unconsumed hook
            // on assertion failure; this is canonical Stop, not an abort flag.
            if (runToStop) await bounded(heartbeat.cancelRun(runToStop), "final_cancel", 60_000);
          } finally {
            releaseSelection();
            if (stopping) await bounded(stopping, "final_stop", 60_000);
            await bounded(wake, "final_wake", 60_000);
            await bounded(heartbeat.drainActiveRunExecutions(), "final_executor", 60_000);
          }
        }
      },
    });
    completed += 1;
  }, 300_000,
);
