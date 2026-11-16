import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeExecutionInput, NativeSession, NativeSessionBackend, PersistedNativeSession } from "../vendor/paperclip-runner/index.js";

// CONF15-P2 (d). After a cold lease handoff the recovered runner is already
// bound to the probe Run. The probe adopts that Run without `run.attach` only
// when the runner-confirmed binding on the recover result equals exactly what
// the server sent for this Run (Run, session, runner instance, lease); any
// missing or different binding refuses and neither adopts nor attaches.
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

import { nativeOpenCodeConformanceRecoveredBindingMatches, runManagedOpenCodeProbe } from "./native-opencode-conformance.js";

const previousIdentity = { runId: "run-1", sessionId: "session-1", companyId: "company-1", issueId: "task-1", agentId: "agent-1" };
const identity = { ...previousIdentity, runId: "run-2" };
const runnerInstanceId = "runner-conformance-1";
const environmentLeaseId = "lease-run-2";
const expected = { runId: identity.runId, normalizedSessionId: identity.sessionId, runnerInstanceId, environmentLeaseId };
const previous = { backendKind: "runner", sessionId: "driver-1", identity: previousIdentity,
  providerSessionId: "provider-session-1" } as unknown as PersistedNativeSession;
// What an implementation would produce by copying the server's snapshot.
const copiedFromSnapshot = { runId: previous.identity.runId, normalizedSessionId: previous.identity.sessionId,
  runnerInstanceId, environmentLeaseId };

const refusals: Array<[string, unknown]> = [
  ["a binding for another Run", { ...expected, runId: "run-3" }],
  ["a binding for another session", { ...expected, normalizedSessionId: "session-2" }],
  ["a binding for another runner instance", { ...expected, runnerInstanceId: "runner-other" }],
  ["a binding for another lease", { ...expected, environmentLeaseId: "lease-run-1" }],
  ["a missing binding", undefined],
  ["a null binding", null],
  ["a binding copied from the server snapshot", copiedFromSnapshot],
  ["a binding with an extra field", { ...expected, companyId: "company-1" }],
  ["a binding without its lease", { runId: expected.runId, normalizedSessionId: expected.normalizedSessionId, runnerInstanceId }],
];

describe("nativeOpenCodeConformanceRecoveredBindingMatches (CONF15-P2)", () => {
  it("accepts only the exact server-sent binding", () => {
    expect(nativeOpenCodeConformanceRecoveredBindingMatches({ ...expected }, expected)).toBe(true);
  });

  it.each(refusals)("refuses %s", (_name, binding) => {
    expect(nativeOpenCodeConformanceRecoveredBindingMatches(binding, expected)).toBe(false);
  });

  it("refuses when the server has no lease to compare, even if the binding's lease is also absent", () => {
    const binding = { ...expected, environmentLeaseId: undefined };
    expect(nativeOpenCodeConformanceRecoveredBindingMatches(binding,
      { ...expected, environmentLeaseId: undefined as unknown as string })).toBe(false);
    expect(nativeOpenCodeConformanceRecoveredBindingMatches({ ...expected, environmentLeaseId: "" },
      { ...expected, environmentLeaseId: "" })).toBe(false);
  });
});

describe("Native OpenCode conformance resume adopts only a runner-confirmed binding (CONF15-P2)", () => {
  const acknowledgedTurnId = "turn-0123456789abcdef01234567";
  const marker = "AW_PROBE_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({ leaseOwner: "owner", attempt: 1, controller: {} });
    mocks.appendEvent.mockResolvedValue({ row: { seq: 7 } });
    mocks.dispatchIntent.mockResolvedValue("dispatch-1");
    mocks.dispatchAcknowledgement.mockResolvedValue(undefined);
  });

  async function resume(binding: unknown, options: { withAdopt?: boolean; serverLease?: string } = {}) {
    let current = { ...previousIdentity };
    const adoptConfirmedRun = vi.fn((input: { identity: typeof identity }) => { current = { ...input.identity }; });
    const attachRun = vi.fn(async () => { throw new Error("run.attach must not be sent"); });
    const session = {
      identity: () => current,
      snapshot: vi.fn(async () => ({ identity: current, providerSessionId: "provider-session-1" })),
      startTurn: vi.fn(async () => ({ turnId: acknowledgedTurnId })),
      events: async function* () {
        yield { eventType: "item.completed", runId: current.runId, normalizedSessionId: current.sessionId,
          turnId: acknowledgedTurnId, payload: { kind: "agentMessage", text: marker } };
        yield { eventType: "turn.completed", runId: current.runId, normalizedSessionId: current.sessionId,
          turnId: acknowledgedTurnId, payload: {} };
      },
      close: vi.fn(async () => undefined),
      attachRun,
      ...(options.withAdopt === false ? {} : { adoptConfirmedRun }),
    } as unknown as NativeSession;
    const recoverSession = vi.fn(async () => ({ recovered: true, session,
      ...(binding === undefined ? {} : { binding }) }));
    const backend = { openSession: vi.fn(), recoverSession } as unknown as NativeSessionBackend;
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
      runnerInstanceId, environmentLeaseId: options.serverLease ?? environmentLeaseId, responsibleUserId: "user-1",
      groupId: "group-1", planId: "plan-1", profileId: "profile-1",
      probe: { identity, workingDirectory: "/probe", prompt: "fixed synthetic prompt", signal: AbortSignal.timeout(5_000),
        expectedOutput: marker, previous,
        source: { qualificationGroupId: "group-1", probeId: "probe-2", dispatchNonce: "nonce-2", planId: "plan-1",
          profileId: "profile-1", probeKind: "resume", marker, historyPrefix: [] } },
    });
    const failure = mocks.warn.mock.calls.map(call => call[0] as Record<string, unknown>)
      .find(fields => fields.stage === "turn");
    return { result, failureCode: failure?.errorCode ?? null, failureStep: failure?.step ?? null, adoptConfirmedRun,
      attachRun, startTurn: session.startTurn as ReturnType<typeof vi.fn>, close: session.close as ReturnType<typeof vi.fn>,
      recoverSession };
  }

  it("adopts the probe Run on an exact binding and never sends run.attach", async () => {
    const outcome = await resume({ ...expected });
    expect(outcome.failureCode).toBeNull();
    expect(outcome.result).toMatchObject({ state: "completed", output: marker, localSessionClosed: true });
    expect(outcome.recoverSession).toHaveBeenCalledWith(previous, expect.anything());
    expect(outcome.adoptConfirmedRun).toHaveBeenCalledTimes(1);
    expect(outcome.adoptConfirmedRun).toHaveBeenCalledWith({ identity, binding: expected });
    expect(outcome.attachRun).not.toHaveBeenCalled();
  });

  it.each(refusals)("refuses %s without adopting or attaching", async (_name, binding) => {
    const outcome = await resume(binding);
    expect(outcome.failureCode).toBe("managed_opencode_resume_binding_unconfirmed");
    expect(outcome.failureStep).toBe("session");
    expect(outcome.result.state).toBe("failed");
    expect(outcome.adoptConfirmedRun).not.toHaveBeenCalled();
    expect(outcome.attachRun).not.toHaveBeenCalled();
    expect(outcome.startTurn).not.toHaveBeenCalled();
    // The recovered session is still closed.
    expect(outcome.close).toHaveBeenCalledTimes(1);
  });

  it("refuses a binding for a lease other than this Run's own, even when the runner reports it consistently", async () => {
    const outcome = await resume({ ...expected }, { serverLease: "lease-run-1" });
    expect(outcome.failureCode).toBe("managed_opencode_resume_binding_unconfirmed");
    expect(outcome.adoptConfirmedRun).not.toHaveBeenCalled();
    expect(outcome.attachRun).not.toHaveBeenCalled();
  });

  it("refuses when the recovered session has no adopt step instead of falling back to attach", async () => {
    const outcome = await resume({ ...expected }, { withAdopt: false });
    expect(outcome.failureCode).toBe("managed_opencode_resume_adopt_unavailable");
    expect(outcome.attachRun).not.toHaveBeenCalled();
    expect(outcome.startTurn).not.toHaveBeenCalled();
  });
});
