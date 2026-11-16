import type { HarnessConfirmedRunBinding } from "../../contracts/harness-driver.js";
import {
  FakeCodexTransport,
  WORKSPACE,
  describe,
  expect,
  it,
  makeDriver,
  type PrpEvent,
} from "./codex-app-server-driver.test-support.js";

// CONF15-P2 (d). The Codex-compatible driver reports on its recover result
// only the binding its transport's authenticated runner confirmed, and its
// session adopts a Run without `run.attach` only when that live binding names
// exactly this Run and session.
class ConfirmedBindingTransport extends FakeCodexTransport {
  binding: HarnessConfirmedRunBinding | null = null;
  readonly attachments: Array<{ runId: string }> = [];
  bindingReads = 0;

  confirmedRunBinding(): HarnessConfirmedRunBinding | null {
    this.bindingReads += 1;
    return this.binding === null ? null : structuredClone(this.binding);
  }

  async attachRun(input: { runId: string; turnId: string; itemId: string }): Promise<void> {
    this.attachments.push({ runId: input.runId });
  }
}

const confirmed: HarnessConfirmedRunBinding = {
  runId: "run-second", normalizedSessionId: "normalized-adopt", runnerInstanceId: "runner-1", environmentLeaseId: "lease-2",
};

async function recovered(binding: HarnessConfirmedRunBinding | null) {
  const first = new FakeCodexTransport();
  const second = new ConfirmedBindingTransport();
  second.binding = binding;
  const driver = makeDriver([first, second]);
  const original = await driver.openSession({ runId: "run-first", normalizedSessionId: "normalized-adopt",
    workingDirectory: WORKSPACE });
  const snapshot = await original.snapshot();
  await original.close({ reason: "probe settled" });
  const recovery = await driver.recoverSession!(snapshot);
  return { recovery, transport: second, snapshot };
}

describe("Codex driver runner-confirmed binding (CONF15-P2)", () => {
  it("reports the transport's confirmed binding on the recover result", async () => {
    const { recovery, transport } = await recovered({ ...confirmed });
    expect(recovery).toMatchObject({ recovered: true, binding: confirmed });
    expect(transport.bindingReads).toBeGreaterThan(0);
    await recovery.session!.close({ reason: "test complete" });
  });

  it("reports no binding when the transport confirms none, never one from the snapshot", async () => {
    const { recovery, snapshot } = await recovered(null);
    expect(recovery.recovered).toBe(true);
    expect(snapshot.runId).toBe("run-first");
    expect(recovery.binding).toBeUndefined();
    await recovery.session!.close({ reason: "test complete" });
  });

  it("adopts the confirmed Run without run.attach and labels later events with it", async () => {
    const { recovery, transport } = await recovered({ ...confirmed });
    const session = recovery.session!;
    session.adoptConfirmedRun!({ runId: "run-second" });
    expect(transport.attachments).toEqual([]);
    await session.startTurn({ message: { role: "user", text: "second probe" } });
    const iterator = session.events()[Symbol.asyncIterator]();
    const first = (await iterator.next()).value as PrpEvent;
    // Reconstruction events labelled with the snapshot's Run were dropped.
    expect(first.runId).toBe("run-second");
    await session.close({ reason: "test complete" });
  });

  it.each([
    ["no confirmed binding", null],
    ["a binding for another Run", { ...confirmed, runId: "run-third" }],
    ["a binding for another session", { ...confirmed, normalizedSessionId: "normalized-other" }],
  ])("refuses to adopt with %s", async (_name, binding) => {
    const { recovery, transport } = await recovered({ ...confirmed });
    transport.binding = binding;
    const session = recovery.session!;
    expect(() => session.adoptConfirmedRun!({ runId: "run-second" })).toThrow("codex_run_adopt_unconfirmed");
    expect((await session.snapshot()).runId).toBe("run-first");
    expect(transport.attachments).toEqual([]);
    await session.close({ reason: "test complete" });
  });

  it("refuses to adopt while a turn is active", async () => {
    const { recovery } = await recovered({ ...confirmed, runId: "run-first" });
    const session = recovery.session!;
    await session.startTurn({ message: { role: "user", text: "still running" } });
    expect(() => session.adoptConfirmedRun!({ runId: "run-first" })).toThrow("codex_run_adopt_busy");
    await session.close({ reason: "test complete" });
  });
});
