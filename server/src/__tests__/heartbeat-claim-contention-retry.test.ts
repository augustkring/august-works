import { mockedCodexAdapterConfig } from "./helpers/mocked-codex-config.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { admitMockedLegacyDispatch, resetMockedLegacyDispatch } from "./helpers/mocked-legacy-paid-dispatch.js";
import {
  agents,
  agentWakeupRequests,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  QUEUED_CLAIM_CONTENTION_RETRY_DELAYS_MS,
  heartbeatService,
} from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";
import { installHeartbeatApiUrlFixture, seedHeartbeatResponsibleHuman } from "./helpers/heartbeat-runtime-fixtures.js";

// F5: a claim deferred by NOWAIT contention at the chat-control recovery gate
// must not wait for the 30 s resumeQueuedRuns sweep. These tests never call the
// sweep after the first attempt, so any later claim comes from the bounded retry.

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Claim contention retry test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

// Mocked legacy dispatch: see helpers/mocked-legacy-paid-dispatch.ts.
vi.mock("../services/native-runtime/paid-transport-admission.js", async (importOriginal) =>
  (await import("./helpers/mocked-legacy-paid-dispatch.js")).withMockedLegacyDispatchAdmission(await importOriginal()));
beforeEach(() => admitMockedLegacyDispatch());
afterEach(() => resetMockedLegacyDispatch());

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres claim contention retry tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRY_WINDOW_MS = QUEUED_CLAIM_CONTENTION_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);

async function waitForCondition(fn: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(25);
  }
  return fn();
}

describeEmbeddedPostgres("queued run claim retry after chat-control gate lock contention", () => {
  let db!: ReturnType<typeof createDb>;
  let lockDb!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const previousPaperclipHome = process.env.PAPERCLIP_HOME;
  let fixtureHome: string | undefined;
  let restoreApiUrl: (() => void) | null = null;
  let onClaimCheck: ((input: { runId: string; issueId: string }) => Promise<void>) | null = null;
  let releaseLock: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    restoreApiUrl = installHeartbeatApiUrlFixture();
    fixtureHome = await mkdtemp(path.join(os.tmpdir(), "paperclip-claim-contention-home-"));
    process.env.PAPERCLIP_HOME = fixtureHome;
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-claim-contention-");
    db = createDb(tempDb.connectionString);
    lockDb = createDb(tempDb.connectionString, { maxConnections: 1 });
    heartbeat = heartbeatService(db, {
      runtimeEnv: { ...process.env, PAPERCLIP_IN_WORKTREE: "false" },
      beforeChatControlRecoveryCheck: async ({ stage, runId, issueId }) => {
        if (stage === "claim") await onClaimCheck?.({ runId, issueId });
      },
    });
  }, 30_000);

  afterEach(async () => {
    onClaimCheck = null;
    await releaseLock?.();
    releaseLock = null;
    await heartbeat.drainActiveRunExecutions();
    mockAdapterExecute.mockClear();
    runningProcesses.clear();
    await db.execute(sql.raw(`
      TRUNCATE TABLE "issue_comments", "issues", "heartbeat_run_events", "cost_events", "activity_log",
        "heartbeat_runs", "agent_wakeup_requests", "agent_runtime_state", "agents", "companies"
      RESTART IDENTITY CASCADE
    `));
  });

  afterAll(async () => {
    try {
      await heartbeat?.drainActiveRunExecutions();
      await lockDb?.$client.end({ timeout: 5 });
      await db?.$client.end({ timeout: 5 });
      await tempDb?.cleanup();
    } finally {
      if (previousPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
      else process.env.PAPERCLIP_HOME = previousPaperclipHome;
      if (fixtureHome) await rm(fixtureHome, { recursive: true, force: true });
      restoreApiUrl?.();
    }
  }, 30_000);

  async function seedQueuedAutomationRun(wake: {
    reason: string;
    requestedByActorType?: "system" | "user" | null;
  }) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: "responsible-user",
      requireBoardApprovalForNewAgents: false,
    });
    await seedHeartbeatResponsibleHuman(db, companyId, "responsible-user", "owner");
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "ClaudeCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: mockedCodexAdapterConfig,
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Claim contention fixture",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    const wakeupRequestId = randomUUID();
    const runId = randomUUID();
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId,
      agentId,
      source: "automation",
      triggerDetail: "system",
      reason: wake.reason,
      payload: { issueId },
      status: "queued",
      requestedByActorType: wake.requestedByActorType ?? null,
      requestedByActorId: null,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "automation",
      triggerDetail: "system",
      status: "queued",
      wakeupRequestId,
      contextSnapshot: { issueId, wakeReason: wake.reason },
    });
    await db.update(agentWakeupRequests).set({ runId }).where(eq(agentWakeupRequests.id, wakeupRequestId));
    return { companyId, agentId, issueId, runId };
  }

  /** Take the issue row in another connection; resolve once it is held. */
  async function lockIssueRow(issueId: string) {
    let acquired!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const transaction = lockDb.transaction(async (tx) => {
      await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, issueId)).for("update");
      acquired();
      await held;
    });
    await ready;
    return async () => { release(); await transaction; };
  }

  /**
   * Make the claim gate meet NOWAIT contention. The seam runs after the claim
   * path's earlier blocking issue lock and immediately before the gate, so the
   * lock is taken there. "until-released" holds it from the first check until
   * the test releases it; "every-check" takes it at each check and releases it
   * 50 ms later, well before the shortest retry delay.
   */
  function contendAtClaimGate(targetRunId: string, mode: "until-released" | "every-check") {
    const checks: number[] = [];
    const releases: Promise<void>[] = [];
    let held: (() => Promise<void>) | null = null;
    releaseLock = async () => {
      await held?.();
      held = null;
      await Promise.all(releases);
    };
    onClaimCheck = async ({ runId, issueId }) => {
      if (runId !== targetRunId) return;
      checks.push(Date.now());
      if (mode === "until-released") {
        if (checks.length === 1) held = await lockIssueRow(issueId);
        return;
      }
      const release = await lockIssueRow(issueId);
      releases.push(sleep(50).then(release));
    };
    return { checks, release: () => releaseLock!() };
  }

  const runStatus = async (runId: string) =>
    (await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0]?.status;

  it("claims a contention-deferred queued run promptly once the issue row lock is released", async () => {
    const { runId } = await seedQueuedAutomationRun({ reason: "issue_commented" });
    const { checks, release } = contendAtClaimGate(runId, "until-released");

    await heartbeat.resumeQueuedRuns();
    expect(checks).toHaveLength(1);
    expect(await runStatus(runId)).toBe("queued");

    await release();
    const releasedAt = Date.now();
    const claimed = await waitForCondition(async () => (await runStatus(runId)) !== "queued", 2_000);
    const latencyMs = Date.now() - releasedAt;
    expect(claimed, `queued run still queued ${latencyMs} ms after the lock was released`).toBe(true);
    expect(latencyMs).toBeLessThan(2_000);
    expect(checks.length).toBeGreaterThanOrEqual(2);
    await waitForCondition(async () => mockAdapterExecute.mock.calls.length > 0, 5_000);
    expect(mockAdapterExecute).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("stops after the bounded number of retries while every claim meets contention", async () => {
    const { runId } = await seedQueuedAutomationRun({ reason: "issue_commented" });
    const { checks } = contendAtClaimGate(runId, "every-check");

    await heartbeat.resumeQueuedRuns();
    expect(checks).toHaveLength(1);
    await sleep(RETRY_WINDOW_MS + 1_000);
    expect(checks).toHaveLength(1 + QUEUED_CLAIM_CONTENTION_RETRY_DELAYS_MS.length);
    const gaps = checks.slice(1).map((at, index) => at - checks[index]!);
    QUEUED_CLAIM_CONTENTION_RETRY_DELAYS_MS.forEach((delay, index) => {
      expect(gaps[index]).toBeGreaterThanOrEqual(delay - 20);
    });

    await sleep(1_500);
    expect(checks).toHaveLength(1 + QUEUED_CLAIM_CONTENTION_RETRY_DELAYS_MS.length);
    // Exhaustion leaves the run queued for the ordinary scheduler sweep.
    expect(await runStatus(runId)).toBe("queued");
    expect(mockAdapterExecute).not.toHaveBeenCalled();
  }, 30_000);

  it("keeps one retry chain per Agent for concurrent contention deferrals", async () => {
    const { runId } = await seedQueuedAutomationRun({ reason: "issue_commented" });
    const { checks } = contendAtClaimGate(runId, "every-check");

    await Promise.all([
      heartbeat.resumeQueuedRuns(),
      heartbeat.resumeQueuedRuns(),
      heartbeat.resumeQueuedRuns(),
    ]);
    await sleep(RETRY_WINDOW_MS + 1_500);
    // Three deferrals share one chain: three initial checks plus one bounded
    // chain. Separate chains per deferral would add three retries each.
    expect(checks).toHaveLength(3 + QUEUED_CLAIM_CONTENTION_RETRY_DELAYS_MS.length);
    expect(await runStatus(runId)).toBe("queued");
    expect(mockAdapterExecute).not.toHaveBeenCalled();
  }, 30_000);

  it("does not retry a claim the gate refuses without lock contention", async () => {
    // A system continuation receipt with no retry ancestry is unresolved
    // source authority: the claim gate returns null without any lock conflict.
    const { runId } = await seedQueuedAutomationRun({
      reason: "issue_continuation_needed",
      requestedByActorType: "system",
    });
    const checks: number[] = [];
    onClaimCheck = async ({ runId: checkedRunId }) => {
      if (checkedRunId === runId) checks.push(Date.now());
    };

    await heartbeat.resumeQueuedRuns();
    expect(checks).toHaveLength(1);
    await sleep(RETRY_WINDOW_MS + 500);
    expect(checks).toHaveLength(1);
    expect(await runStatus(runId)).toBe("queued");
    expect(mockAdapterExecute).not.toHaveBeenCalled();
  }, 30_000);

  it("cancels pending retries when executions are drained for shutdown", async () => {
    const { runId } = await seedQueuedAutomationRun({ reason: "issue_commented" });
    const { checks, release } = contendAtClaimGate(runId, "until-released");

    await heartbeat.resumeQueuedRuns();
    expect(checks).toHaveLength(1);
    await heartbeat.drainActiveRunExecutions();
    await release();

    await sleep(RETRY_WINDOW_MS + 500);
    expect(checks).toHaveLength(1);
    expect(await runStatus(runId)).toBe("queued");
  }, 30_000);
});
