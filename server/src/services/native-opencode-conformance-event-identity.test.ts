import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeExecutionInput, NativeSession, NativeSessionBackend, PersistedNativeSession } from "../vendor/paperclip-runner/index.js";

// CONF6. runnerd forwards a harness diagnostic emitted while turn.start is
// pending with the transport's provisional requested turn identity
// (turn_lab_ + 32 hex), not the provider turn identity startTurn acknowledged.
// The probe compared every event's turn id with the acknowledged one, so the
// first probe stopped before any model call. Only harness.diagnostic is exempt
// from turn-id equality, and a diagnostic never counts as output, stream or
// lifecycle evidence.
const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  dispatchIntent: vi.fn(),
  dispatchAcknowledgement: vi.fn(),
  appendEvent: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("./native-runtime/native-session-executor.js", () => ({
  claimNativeExecutionCoordinator: mocks.claim,
  releaseNativeOpenCodeConformanceCoordinator: vi.fn(),
  failUnclaimedNativeOpenCodeConformanceRun: vi.fn(),
  recordNativeModelInputDispatchIntent: mocks.dispatchIntent,
  recordNativeModelInputDispatchAcknowledgement: mocks.dispatchAcknowledgement,
  createNativeOpenCodeConformanceProbeBackend: vi.fn(),
}));
vi.mock("./heartbeat-run-events.js", () => ({ appendHeartbeatRunEvent: mocks.appendEvent }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { runManagedOpenCodeProbe } from "./native-opencode-conformance.js";

type ScriptedEvent = { eventType: string; runId?: string; normalizedSessionId?: string; turnId?: string;
  payload?: Record<string, unknown> };

describe("Native OpenCode conformance probe event identity (CONF6)", () => {
  const identity = { runId: "run-1", sessionId: "session-1", companyId: "company-1", issueId: "task-1", agentId: "agent-1" };
  const acknowledgedTurnId = "turn-0123456789abcdef01234567";
  const provisionalTurnId = "turn_lab_0123456789abcdef0123456789abcdef";
  const marker = "AW_PROBE_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({ leaseOwner: "owner", attempt: 1, controller: {} });
    mocks.appendEvent.mockResolvedValue({ row: { seq: 7 } });
    mocks.dispatchIntent.mockResolvedValue("dispatch-1");
    mocks.dispatchAcknowledgement.mockResolvedValue(undefined);
  });

  const event = (value: ScriptedEvent) => ({ runId: identity.runId, normalizedSessionId: identity.sessionId,
    turnId: acknowledgedTurnId, payload: {}, ...value });

  async function probe(events: ReturnType<typeof event>[], expectedOutput?: string) {
    const snapshot = { identity: {}, providerSessionId: "provider-session-1" } as unknown as PersistedNativeSession;
    const session = {
      identity: () => identity,
      snapshot: vi.fn(async () => snapshot),
      startTurn: vi.fn(async () => ({ turnId: acknowledgedTurnId })),
      events: async function* () { for (const item of events) yield item; },
      close: vi.fn(async () => undefined),
    } as unknown as NativeSession;
    const backend = { openSession: vi.fn(async () => session) } as unknown as NativeSessionBackend;
    // Only bindOpenCodeProbeTurnId opens a transaction here: the sealed source
    // receipt names the recorded dispatch.
    const run = { id: identity.runId, runnerProfileJson: { nativeOpenCodeConformanceSourceAuthority: { dispatchId: "dispatch-1" } } };
    const chain = () => {
      const query: Record<string, unknown> = {};
      for (const method of ["from", "where", "for", "limit", "set"]) query[method] = () => query;
      query.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve([run]).then(resolve);
      return query;
    };
    const db = { transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ select: chain, update: chain }) };
    const result = await runManagedOpenCodeProbe({
      db: db as never, createBackend: async () => backend,
      execution: { binding: { companyId: identity.companyId, runId: identity.runId, issueId: identity.issueId,
        agentId: identity.agentId } } as NativeExecutionInput,
      runnerInstanceId: "runner-1", responsibleUserId: "user-1", groupId: "group-1", planId: "plan-1", profileId: "profile-1",
      probe: { identity, workingDirectory: "/probe", prompt: "fixed synthetic prompt", signal: AbortSignal.timeout(5_000),
        ...(expectedOutput !== undefined ? { expectedOutput } : {}),
        source: { qualificationGroupId: "group-1", probeId: "probe-1", dispatchNonce: "nonce-1", planId: "plan-1",
          profileId: "profile-1", probeKind: "start", marker, historyPrefix: [] } },
    });
    const failure = mocks.warn.mock.calls.map(call => call[0] as Record<string, unknown>)
      .find(fields => fields.stage === "turn");
    return { result, failureCode: failure?.errorCode ?? null };
  }

  it("accepts a diagnostic stamped with the provisional turn id and completes on the acknowledged turn", async () => {
    // Before the fix the provisional turn id refused the probe here.
    const { result, failureCode } = await probe([
      event({ eventType: "harness.diagnostic", turnId: provisionalTurnId, payload: { message: "provider starting" } }),
      event({ eventType: "item.completed", payload: { kind: "agentMessage", text: marker } }),
      event({ eventType: "turn.completed" }),
    ], marker);
    expect(failureCode).toBeNull();
    expect(result).toMatchObject({ state: "completed", output: marker, streamObserved: true, localSessionClosed: true });
  });

  it("never takes output, stream or lifecycle evidence from a diagnostic", async () => {
    // An agentMessage-shaped diagnostic on either turn id is ignored.
    for (const turnId of [provisionalTurnId, acknowledgedTurnId]) {
      mocks.warn.mockClear();
      const { result } = await probe([
        event({ eventType: "harness.diagnostic", turnId, payload: { kind: "agentMessage", text: "INJECTED" } }),
      ]);
      expect(result.output).toBe("");
      expect(result.streamObserved).toBe(false);
      expect(result.state).toBe("failed");
    }
    const { result } = await probe([
      event({ eventType: "harness.diagnostic", turnId: provisionalTurnId, payload: { kind: "agentMessage", text: "INJECTED" } }),
      event({ eventType: "turn.completed" }),
    ], marker);
    expect(result.output).toBe("");
    expect(result.state).toBe("failed");
  });

  it("still refuses another turn id on every other event and another Run or session on a diagnostic", async () => {
    for (const eventType of ["item.delta", "item.completed", "turn.completed", "turn.failed", "provider.notice.recorded"]) {
      mocks.warn.mockClear();
      const { result, failureCode } = await probe([
        event({ eventType, turnId: provisionalTurnId, payload: { kind: "agentMessage", text: marker } }),
        event({ eventType: "turn.completed" }),
      ], marker);
      expect(failureCode, eventType).toBe("managed_opencode_event_identity_changed");
      expect(result.state).toBe("failed");
      expect(result.output).toBe("");
    }
    for (const changed of [{ runId: "run-2" }, { normalizedSessionId: "session-2" }]) {
      mocks.warn.mockClear();
      const { result, failureCode } = await probe([
        event({ eventType: "harness.diagnostic", turnId: provisionalTurnId, ...changed }),
        event({ eventType: "item.completed", payload: { kind: "agentMessage", text: marker } }),
        event({ eventType: "turn.completed" }),
      ], marker);
      expect(failureCode).toBe("managed_opencode_event_identity_changed");
      expect(result.state).toBe("failed");
    }
  });
});
