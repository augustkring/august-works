import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDb, chatConversations, heartbeatRuns, issues } from "@paperclipai/db";
import { getServerAdapter, runningProcesses } from "../adapters/index.js";
import * as nativeExecutor from "../services/native-runtime/native-session-executor.js";
import * as admissionRetry from "../services/chat-control-admission-retry.js";
import { CHAT_CONTROL_RECOVERY_STOP_CODE, CHAT_CONTROL_RECOVERY_UNRESOLVED_CODE } from "../services/chat-control-recovery-stop.js";
import { withManagedChannelCloseSource } from "./helpers/managed-channel-close-source-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>, root: string;
let completed = 0;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "managed-chat-dispatch-boundaries-"));
  vi.stubEnv("PAPERCLIP_HOME", root);
  vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
  database = await startEmbeddedPostgresTestDatabase("managed-chat-dispatch-boundaries-", { preserveDataOnFailure: () => completed !== 4 });
  db = createDb(database.connectionString, { maxConnections: 3 });
}, 60_000);
afterAll(async () => {
  await database?.cleanup(); vi.unstubAllEnvs();
  if (root && completed === 4) { await makeFixtureTreeWritable(root); await rm(root, { recursive: true, force: true }); }
}, 30_000);

// The spy calls the original executor unchanged: predecessor authority comes
// from the real SDK producer; the automatic child must never invoke it.
async function withSource(drive: Parameters<typeof withManagedChannelCloseSource>[0]["drive"]) {
  const executor = vi.spyOn(nativeExecutor, "executePaperclipNativeSession");
  const legacyExecute = vi.spyOn(getServerAdapter("paperclip_runner"), "execute");
  try {
    await withManagedChannelCloseSource({ db, root, opencodeBinary: qualifiedOpenCodeBinary(), drive: async context => {
      expect(executor.mock.calls.some(([input]) => input.execution.binding.runId === context.sourceRun.id)).toBe(true);
      await drive(context);
      const sourceIds = new Set(executor.mock.calls.map(([input]) => input.execution.binding.runId));
      expect([...sourceIds]).toEqual([context.sourceRun.id]);
      expect(legacyExecute).not.toHaveBeenCalled();
    } });
  } finally { executor.mockRestore(); legacyExecute.mockRestore(); }
}

function automaticWake(source: { issueId: string; sourceRun: typeof heartbeatRuns.$inferSelect }) {
  return { source: "automation" as const, triggerDetail: "system" as const, reason: "issue_continuation_needed",
    requestedByActorType: "system" as const, requestedByActorId: null, allowRunCoalescing: false,
    payload: { issueId: source.issueId }, contextSnapshot: { issueId: source.issueId, taskId: source.issueId,
      retryOfRunId: source.sourceRun.id, source: "issue.productive_terminal_continuation_recovery" } };
}

it("honors close committed at the dispatch boundary without a provider call", async () => {
  await withSource(async source => {
    let checked = false;
    source.setObserver(async ({ stage, runId }) => {
      if (stage !== "dispatch" || runId === source.sourceRun.id || checked) return;
      checked = true;
      const child = await source.heartbeat.getRun(runId);
      expect(child?.retryOfRunId).toBe(source.sourceRun.id);
      await source.publishClose();
    });
    const run = await source.heartbeat.wakeup(source.agentId, automaticWake(source));
    expect(run).not.toBeNull();
    await source.heartbeat.drainActiveRunExecutions();
    expect(checked).toBe(true);
    expect(await source.heartbeat.getRun(run!.id)).toMatchObject({ status: "cancelled", errorCode: CHAT_CONTROL_RECOVERY_STOP_CODE });
    expect(source.providerCalls()).toBe(source.sourceProviderCalls);
    expect((await db.select().from(issues).where(eq(issues.id, source.issueId)))[0])
      .toMatchObject({ status: "in_progress", executionRunId: null });
  });
  completed++;
}, 900_000);

it("rechecks close after a real dispatch admission lock retry without a provider call", async () => {
  const lockDb = createDb(database.connectionString, { maxConnections: 1 });
  const originalRetry = admissionRetry.retryChatControlAdmission;
  const retrySpy = vi.spyOn(admissionRetry, "retryChatControlAdmission");
  let observedNowaitContention = false;
  retrySpy.mockImplementation(async attempt => originalRetry(async () => {
    try { return await attempt(); }
    catch (error) {
      let current: unknown = error;
      for (let depth = 0; depth < 4 && current; depth += 1) {
        const value = current as { code?: unknown; cause?: unknown };
        if (value.code === "55P03") { observedNowaitContention = true; break; }
        current = value.cause;
      }
      throw error;
    }
  }));
  let releaseIssueLock!: () => void;
  let markIssueLocked!: () => void;
  const release = new Promise<void>(resolve => { releaseIssueLock = resolve; });
  const issueLocked = new Promise<void>(resolve => { markIssueLocked = resolve; });
  let lockTransaction: Promise<unknown> | undefined;
  try {
    await withSource(async source => {
      let checked = false;
      source.setObserver(async ({ stage, runId }) => {
        if (stage !== "dispatch" || runId === source.sourceRun.id || checked) return;
        checked = true;
        const child = await source.heartbeat.getRun(runId);
        expect(child?.retryOfRunId).toBe(source.sourceRun.id);
        lockTransaction = lockDb.transaction(async tx => {
          await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, source.issueId)).for("update");
          markIssueLocked();
          await release;
        });
        await Promise.race([issueLocked, lockTransaction.then(() => {
          throw new Error("dispatch issue-lock transaction ended before lock readiness");
        })]);
      });
      try {
        const run = await source.heartbeat.wakeup(source.agentId, automaticWake(source));
        expect(run).not.toBeNull();
        await vi.waitFor(() => expect(observedNowaitContention).toBe(true), { timeout: 20_000, interval: 25 });
        // This signal comes only from the unchanged retry loop catching the
        // actual PostgreSQL NOWAIT error while the independent pool holds issue.
        await source.publishClose();
        expect((await db.select({ state: chatConversations.state }).from(chatConversations).where(eq(chatConversations.issueId, source.issueId)))
          .some(conversation => conversation.state === "completed")).toBe(true);
        releaseIssueLock();
        await lockTransaction;
        await source.heartbeat.drainActiveRunExecutions();
        expect(checked).toBe(true);
        expect(await source.heartbeat.getRun(run!.id)).toMatchObject({ status: "cancelled", errorCode: CHAT_CONTROL_RECOVERY_STOP_CODE });
        expect(source.providerCalls()).toBe(source.sourceProviderCalls);
        expect((await db.select({ status: issues.status, executionRunId: issues.executionRunId }).from(issues)
          .where(eq(issues.id, source.issueId)))[0]).toMatchObject({ status: "in_progress", executionRunId: null });
      } finally {
        releaseIssueLock();
        await lockTransaction;
      }
    });
  } finally {
    releaseIssueLock();
    await lockTransaction?.catch(() => undefined);
    retrySpy.mockRestore();
    await lockDb.$client.end();
  }
  completed++;
}, 900_000);

it("defers unresolved automatic ancestry at claim and records a distinct nonretrying failure after claim", async () => {
  await withSource(async source => {
    let childId: string | undefined;
    source.setObserver(async ({ stage, runId }) => {
      if (stage !== "claim" || runId === source.sourceRun.id || childId) return;
      childId = runId;
      // Adverse mutation of a genuinely born queued row, before its original
      // claim gate. No raw Native Run/attempt/Source is inserted by this test.
      await db.update(heartbeatRuns).set({ retryOfRunId: runId }).where(eq(heartbeatRuns.id, runId));
    });
    const child = await source.heartbeat.wakeup(source.agentId, automaticWake(source));
    expect(child).not.toBeNull(); expect(child?.id).toBe(childId);
    await source.heartbeat.resumeQueuedRuns();
    expect(await source.heartbeat.getRun(child!.id)).toMatchObject({ status: "queued", startedAt: null });
    expect(source.providerCalls()).toBe(source.sourceProviderCalls);
    await db.update(heartbeatRuns).set({ retryOfRunId: source.sourceRun.id }).where(eq(heartbeatRuns.id, child!.id));
    source.setObserver(async ({ stage, runId }) => {
      if (stage === "dispatch" && runId === child!.id)
        await db.update(heartbeatRuns).set({ retryOfRunId: runId }).where(eq(heartbeatRuns.id, runId));
    });
    await source.heartbeat.resumeQueuedRuns(); await source.heartbeat.drainActiveRunExecutions();
    expect(await source.heartbeat.getRun(child!.id)).toMatchObject({ status: "failed", errorCode: CHAT_CONTROL_RECOVERY_UNRESOLVED_CODE });
    expect((await source.heartbeat.reconcileStrandedAssignedIssues()).continuationRequeued).toBe(0);
    expect(source.providerCalls()).toBe(source.sourceProviderCalls);
  });
  completed++;
}, 900_000);

it("does not confuse inherited warm-runner metadata with dispatch of the new child", async () => {
  await withSource(async source => {
    let checked = false;
    source.setObserver(async ({ stage, runId }) => {
      if (stage !== "dispatch" || runId === source.sourceRun.id || checked) return;
      checked = true;
      await db.update(heartbeatRuns).set({ processPid: 2_000_000_000, processGroupId: 2_000_000_000,
        processStartedAt: source.sourceRun.finishedAt }).where(eq(heartbeatRuns.id, runId));
      await source.publishClose();
    });
    const child = await source.heartbeat.wakeup(source.agentId, automaticWake(source));
    expect(child).not.toBeNull();
    await source.heartbeat.drainActiveRunExecutions();
    expect(checked).toBe(true);
    expect(await source.heartbeat.getRun(child!.id)).toMatchObject({ status: "cancelled", errorCode: CHAT_CONTROL_RECOVERY_STOP_CODE });
    expect(source.providerCalls()).toBe(source.sourceProviderCalls);
    expect(runningProcesses.size).toBe(0);
  });
  completed++;
}, 900_000);
