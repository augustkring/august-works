import { describe, expect, it, vi } from "vitest";

import type { HarnessConfirmedRunBinding, HarnessDriver, HarnessSession, PersistedHarnessSession } from "../contracts/harness-driver.js";
import type { PersistedNativeSession } from "../contracts/native-session-backend.js";
import { HarnessDriverBackend } from "./harness-driver-backend.js";

// CONF15-P2 (d). The backend carries only the driver's runner-confirmed
// binding on the recover result (never one built from the snapshot it was
// given), and adopts a Run only for that exact binding.
const previousIdentity = { runId: "run-1", sessionId: "session-1", companyId: "company-1", issueId: "task-1", agentId: "agent-1" };
const identity = { ...previousIdentity, runId: "run-2" };
const binding: HarnessConfirmedRunBinding = {
  runId: "run-2", normalizedSessionId: "session-1", runnerInstanceId: "runner-1", environmentLeaseId: "lease-2",
};
const snapshot: PersistedNativeSession = {
  backendKind: "runner", driverKind: "fake", sessionId: "driver-1", providerSessionId: "provider-1",
  identity: previousIdentity, cursor: null, activeTurnId: null, terminalTurns: [],
  terminal: { schema: "paperclip.prp.terminal.v1", turnTerminalState: "completed", runTerminalState: "succeeded",
    reportedWorkDisposition: "done" },
};

function harnessSession(adopt?: (input: { runId: string }) => void): HarnessSession {
  return {
    ids: () => ({ driverSessionId: "driver-1", providerSessionId: "provider-1" }),
    async *events() {},
    startTurn: async () => ({ turnId: "turn-1" }),
    snapshot: async (): Promise<PersistedHarnessSession> => ({ driverKind: "fake", driverSessionId: "driver-1",
      providerSessionId: "provider-1" }),
    close: async () => undefined,
    attachRun: vi.fn(async () => { throw new Error("run.attach must not be sent"); }),
    ...(adopt ? { adoptConfirmedRun: adopt } : {}),
  };
}

function backend(session: HarnessSession, recoveredBinding?: unknown) {
  const driver: HarnessDriver = {
    descriptor: async () => ({ kind: "fake", displayName: "Fake", version: "1", capabilities: {
      resume: true, typedEvents: true, steering: false, interruption: false, structuredResult: true } }),
    openSession: async () => session,
    recoverSession: async () => ({ recovered: true, session,
      ...(recoveredBinding === undefined ? {} : { binding: recoveredBinding as HarnessConfirmedRunBinding }) }),
  };
  return new HarnessDriverBackend(driver);
}

async function recover(recoveredBinding?: unknown, adopt = vi.fn()) {
  const session = harnessSession(adopt);
  const result = await backend(session, recoveredBinding).recoverSession(structuredClone(snapshot),
    { signal: new AbortController().signal });
  return { result, adopt, harness: session };
}

describe("HarnessDriverBackend runner-confirmed binding (CONF15-P2)", () => {
  it("passes the driver's binding through unchanged", async () => {
    const { result } = await recover({ ...binding });
    expect(result.binding).toEqual(binding);
  });

  it("never synthesizes a binding from the snapshot when the driver reports none", async () => {
    const { result } = await recover(undefined);
    expect(result.recovered).toBe(true);
    expect(result.binding).toBeUndefined();
  });

  it.each([
    ["an extra field", { ...binding, companyId: "company-1" }],
    ["an empty field", { ...binding, environmentLeaseId: "" }],
    ["a missing field", { runId: "run-2", normalizedSessionId: "session-1", runnerInstanceId: "runner-1" }],
    ["a non-object", "run-2"],
  ])("drops a malformed binding with %s", async (_name, malformed) => {
    const { result } = await recover(malformed);
    expect(result.binding).toBeUndefined();
    await expect(Promise.resolve().then(() => result.session!.adoptConfirmedRun!({ identity, binding })))
      .rejects.toThrow("native_session_adopt_binding_mismatch");
  });

  it("adopts the confirmed Run without run.attach and clears the recovered terminal", async () => {
    const { result, adopt, harness } = await recover({ ...binding });
    const session = result.session!;
    expect(session.identity().runId).toBe("run-1");
    session.adoptConfirmedRun!({ identity, binding: { ...binding } });
    expect(adopt).toHaveBeenCalledWith({ runId: "run-2" });
    expect(harness.attachRun).not.toHaveBeenCalled();
    expect(session.identity()).toEqual(identity);
    // The recovered terminal no longer blocks the adopted Run's turn.
    expect((await session.snapshot()).terminal).toBeNull();
  });

  it.each([
    ["the passed binding names another Run", { identity, binding: { ...binding, runId: "run-3" } }],
    ["the passed binding names another session", { identity, binding: { ...binding, normalizedSessionId: "session-2" } }],
    ["the passed binding names another runner instance", { identity, binding: { ...binding, runnerInstanceId: "runner-2" } }],
    ["the passed binding names another lease", { identity, binding: { ...binding, environmentLeaseId: "lease-1" } }],
    ["the passed binding is malformed", { identity, binding: { ...binding, extra: "x" } as HarnessConfirmedRunBinding }],
    ["the identity names another Run than the binding", { identity: { ...identity, runId: "run-3" }, binding }],
    ["the identity names another session than the binding", { identity: { ...identity, sessionId: "session-2" }, binding }],
    ["the identity changes company", { identity: { ...identity, companyId: "company-2" }, binding }],
    ["the identity changes Task", { identity: { ...identity, issueId: "task-2" }, binding }],
    ["the identity changes Agent", { identity: { ...identity, agentId: "agent-2" }, binding }],
  ])("refuses to adopt when %s", async (_name, input) => {
    const { result, adopt } = await recover({ ...binding });
    expect(() => result.session!.adoptConfirmedRun!(input)).toThrow("native_session_adopt_binding_mismatch");
    expect(adopt).not.toHaveBeenCalled();
    expect(result.session!.identity()).toEqual(previousIdentity);
  });

  it("refuses to adopt when the runner confirmed another session than the recovered one", async () => {
    const other = { ...binding, normalizedSessionId: "session-2" };
    // The identity follows the runner's session: the recovered session differs.
    const first = await recover({ ...other });
    expect(() => first.result.session!.adoptConfirmedRun!({ identity: { ...identity, sessionId: "session-2" },
      binding: other })).toThrow("native_session_adopt_binding_mismatch");
    expect(first.adopt).not.toHaveBeenCalled();
    // The identity keeps the recovered session: the runner's session differs.
    const second = await recover({ ...other });
    expect(() => second.result.session!.adoptConfirmedRun!({ identity, binding: other }))
      .toThrow("native_session_adopt_binding_mismatch");
    expect(second.adopt).not.toHaveBeenCalled();
  });

  it("refuses without a driver adopt step and allows only one adoption", async () => {
    const session = harnessSession();
    const result = await backend(session, { ...binding }).recoverSession(structuredClone(snapshot),
      { signal: new AbortController().signal });
    expect(() => result.session!.adoptConfirmedRun!({ identity, binding })).toThrow("native_session_adopt_unavailable");
    const second = await recover({ ...binding });
    second.result.session!.adoptConfirmedRun!({ identity, binding });
    expect(() => second.result.session!.adoptConfirmedRun!({ identity, binding }))
      .toThrow("native_session_adopt_binding_mismatch");
    expect(second.adopt).toHaveBeenCalledTimes(1);
  });

  it("propagates a driver adopt refusal and keeps the previous identity", async () => {
    const { result } = await recover({ ...binding }, vi.fn(() => { throw new Error("codex_run_adopt_unconfirmed"); }));
    expect(() => result.session!.adoptConfirmedRun!({ identity, binding })).toThrow("codex_run_adopt_unconfirmed");
    expect(result.session!.identity()).toEqual(previousIdentity);
  });
});
