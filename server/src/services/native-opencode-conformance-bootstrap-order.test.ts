import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeExecutionInput, NativeSession, NativeSessionBackend, PersistedNativeSession } from "../vendor/paperclip-runner/index.js";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  release: vi.fn(),
  failUnclaimed: vi.fn(),
  dispatchIntent: vi.fn(),
  dispatchAcknowledgement: vi.fn(),
  appendEvent: vi.fn(),
}));

vi.mock("./native-runtime/native-session-executor.js", () => ({
  claimNativeExecutionCoordinator: mocks.claim,
  releaseNativeOpenCodeConformanceCoordinator: mocks.release,
  failUnclaimedNativeOpenCodeConformanceRun: mocks.failUnclaimed,
  recordNativeModelInputDispatchIntent: mocks.dispatchIntent,
  recordNativeModelInputDispatchAcknowledgement: mocks.dispatchAcknowledgement,
  createNativeOpenCodeConformanceProbeBackend: vi.fn(),
}));
vi.mock("./heartbeat-run-events.js", () => ({ appendHeartbeatRunEvent: mocks.appendEvent }));

import { runManagedOpenCodeProbe } from "./native-opencode-conformance.js";

describe("Native OpenCode conformance issuer tuple ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({ leaseOwner: "owner", attempt: 1, controller: {} });
    mocks.appendEvent.mockResolvedValue({ row: { seq: 7 } });
    mocks.dispatchIntent.mockImplementation(async () => { order.push("dispatchIntent"); return "dispatch-1"; });
    mocks.dispatchAcknowledgement.mockResolvedValue(undefined);
  });

  let order: string[];
  function setup(dbTransaction: () => Promise<never>) {
    order = [];
    const identity = { runId: "run-1", sessionId: "session-1", companyId: "company-1", issueId: "task-1", agentId: "agent-1" };
    const snapshot = { identity: {}, providerSessionId: "provider-session-1" } as unknown as PersistedNativeSession;
    const session = {
      identity: () => identity,
      snapshot: vi.fn(async () => { order.push("snapshot"); return snapshot; }),
      startTurn: vi.fn(async () => { order.push("startTurn"); return { turnId: "turn-1" }; }),
      close: vi.fn(async () => { order.push("close"); }),
    } as unknown as NativeSession;
    const backend = { openSession: vi.fn(async () => { order.push("openSession"); return session; }) } as unknown as NativeSessionBackend;
    const db = { transaction: vi.fn(dbTransaction) } as unknown as Parameters<typeof runManagedOpenCodeProbe>[0]["db"];
    const execution = { binding: { companyId: "company-1", runId: "run-1", issueId: "task-1", agentId: "agent-1" } } as NativeExecutionInput;
    return { identity, session, backend, db, execution };
  }

  it("reads the issuer tuple only after actual session open and snapshot, before recording an input intent", async () => {
    const state = setup(async () => { order.push("persistSourceReceipt"); throw new Error("controlled_source_persist_sentinel"); });
    const result = await runManagedOpenCodeProbe({
      db: state.db, createBackend: async () => state.backend, execution: state.execution,
      runnerInstanceId: "runner-1", responsibleUserId: "user-1", groupId: "group-1", planId: "plan-1", profileId: "profile-1",
      probe: {
        identity: state.identity, workingDirectory: "/probe", prompt: "fixed synthetic prompt", signal: AbortSignal.timeout(5_000),
        resolveSource: async () => { order.push("resolveIssuerTuple"); return {
          qualificationGroupId: "group-1", probeId: "probe-1", dispatchNonce: "runtimecontrol-issued",
          planId: "plan-1", profileId: "profile-1", probeKind: "start", marker: "AW_PROBE_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", historyPrefix: [],
        }; },
      },
    });
    expect(result.state).toBe("failed");
    expect(order).toEqual(["openSession", "snapshot", "resolveIssuerTuple", "dispatchIntent", "persistSourceReceipt", "close"]);
    expect(state.session.startTurn).not.toHaveBeenCalled();
  });

  it("refuses a missing post-start tuple before input intent, source receipt, or provider turn", async () => {
    const state = setup(async () => { order.push("unexpectedPersist"); throw new Error("persistence_must_not_run"); });
    const result = await runManagedOpenCodeProbe({
      db: state.db, createBackend: async () => state.backend, execution: state.execution,
      runnerInstanceId: "runner-1", responsibleUserId: "user-1", groupId: "group-1", planId: "plan-1", profileId: "profile-1",
      probe: {
        identity: state.identity, workingDirectory: "/probe", prompt: "fixed synthetic prompt", signal: AbortSignal.timeout(5_000),
        resolveSource: async () => { order.push("resolveIssuerTuple"); throw new Error("issuer_tuple_missing"); },
      },
    });
    expect(result.state).toBe("failed");
    expect(order).toEqual(["openSession", "snapshot", "resolveIssuerTuple", "close"]);
    expect(mocks.dispatchIntent).not.toHaveBeenCalled();
    expect(state.session.startTurn).not.toHaveBeenCalled();
  });
});
