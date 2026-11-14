import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { execute } from "../adapters/process/execute.js";
import type { AdapterExecutionResult } from "../adapters/types.js";
import type { AdapterSpawnInfo } from "@paperclipai/adapter-utils";
import { runningProcesses } from "../adapters/utils.js";
import { terminateLocalService } from "./local-service-supervisor.js";
import {
  classifyAdapterExecutionOutcome,
  createAdapterExecutionControl,
  failedProcessRunCancellations,
  processRunCancellationSettlements,
  joinProcessRunCancellation,
  registerProcessRunCancellation,
  settleProcessRunCancellation,
  finishProcessRunCancellationExecution,
  type RunSessionOutcome,
} from "./adapter-execution-control.js";

// Real utility/process-owner components, not model admission or durable Run tests.
// Original16 heartbeat/DB assertions stay until genuine Native pairing passes.
const terminal = (status: string | null | undefined): status is RunSessionOutcome =>
  status === "succeeded" || status === "interrupted" || status === "failed" ||
  status === "cancelled" || status === "timed_out";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const scenarios = [
  { mode: "signal", graceful: false, failure: null },
  { mode: "graceful exit", graceful: true, failure: null },
  { mode: "adapter exception", graceful: false, failure: null },
  { mode: "termination completion error", graceful: false, failure: "termination" },
  { mode: "cancellation writer error", graceful: false, failure: "write" },
  { mode: "graceful termination completion error", graceful: true, failure: "termination" },
  { mode: "graceful cancellation writer error", graceful: true, failure: "write" },
  { mode: "late graceful cancellation writer error", graceful: true, failure: "write" },
] as const;

it.each(scenarios.flatMap((scenario) =>
  (["process", "codex_local"] as const).map((signalPolicy) => ({ ...scenario, signalPolicy })),
))("settles the actual process owner for $signalPolicy and $mode", async ({ mode, graceful, failure, signalPolicy }) => {
  const runId = randomUUID(), ready = deferred(), terminated = deferred(), terminationRelease = deferred(), resultRelease = deferred();
  const signal = signalPolicy === "codex_local" ? "SIGINT" : "SIGTERM";
  const control = createAdapterExecutionControl();
  const injected = new Error(failure === "termination" ? "owned termination unconfirmed" : "owned cancellation write unavailable");
  const adapterException = new Error("process adapter reported its signal as an exception");
  let spawned: AdapterSpawnInfo | undefined;
  let rawResult: AdapterExecutionResult | undefined;
  let current: { status: string } | null = null;
  let readySeen = false, terminationSeen = false, executionActive = true;
  let completed = false, firstSettled = false, duplicateSettled = false, terminationCalls = 0;
  let child: NonNullable<ReturnType<typeof runningProcesses.get>> | undefined;
  let owner: ReturnType<typeof registerProcessRunCancellation> | undefined;
  let stopping: Promise<{ value: { status: string } | null; error: unknown }> | undefined;
  let duplicate: Promise<{ value: { status: string } | null; error: unknown }> | undefined;
  const executionResult = execute({
    runId,
    agent: { id: randomUUID(), companyId: randomUUID(), name: "Controlled utility", adapterType: "process", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { command: process.execPath, args: ["-e", `${graceful ? `process.on('${signal}', () => process.exit(0));` : ""}console.log('owned ready');setInterval(() => {}, 1000)`], timeoutSec: 5, graceSec: 1 },
    context: {},
    onSpawn: async identity => { spawned = identity; },
    onLog: async (_stream, text) => { if (text.includes("owned ready")) { readySeen = true; ready.resolve(); } },
  }).then(result => ({ result, error: null }), error => ({ result: null, error }));
  const completion = executionResult.then(async observed => {
    if (observed.error) throw observed.error;
    if (!observed.result) throw new Error("Actual process result missing");
    rawResult = observed.result;
    if (mode === "late graceful cancellation writer error") await resultRelease.promise;
    if (mode === "adapter exception") {
      await processRunCancellationSettlements.get(runId)?.settled;
      throw adapterException;
    }
    const selected = processRunCancellationSettlements.get(runId) ?? failedProcessRunCancellations.get(runId);
    await selected?.settled;
    return classifyAdapterExecutionOutcome(current, control, observed.result, selected, terminal);
  }).then(outcome => ({ outcome, error: null }), error => ({ outcome: null, error })).finally(() => {
    completed = true;
    executionActive = false;
    finishProcessRunCancellationExecution(runId);
  });
  try {
    await Promise.race([ready.promise, executionResult.then(() => { if (!readySeen) throw new Error("Bounded child ended before readiness"); })]);
    child = runningProcesses.get(runId);
    if (!child?.child.pid || !spawned) throw new Error("Actual utility identity missing");
    expect(spawned.pid).toBe(child.child.pid);
    expect(spawned.processGroupId).toBe(child.processGroupId);
    expect(Number.isFinite(Date.parse(spawned.startedAt))).toBe(true);
    // No await between absent lookup and actual owner registration.
    expect(joinProcessRunCancellation(runId)).toBeUndefined();
    owner = registerProcessRunCancellation(runId);
    const actualChild = child;
    const pid = child.child.pid;
    // Writer fault is thrown by the callback that the production owner runs;
    // this is an in-memory boundary writer, not an accepted/durable Run row.
    const writeCancellation = async () => {
      if (failure === "write") throw injected;
      current = { status: "cancelled" };
      return current;
    };
    stopping = settleProcessRunCancellation(runId, owner, async () => {
      terminationCalls++;
      await terminateLocalService({ pid, processGroupId: actualChild.processGroupId }, { signal, forceAfterMs: 1000, verifyAfterMs: 1000 });
      terminationSeen = true; terminated.resolve();
      await terminationRelease.promise;
      if (failure === "termination") throw injected;
      return writeCancellation();
    }, () => executionActive).then(value => { firstSettled = true; return { value, error: null }; }, error => { firstSettled = true; return { value: null, error }; });
    await Promise.race([terminated.promise, stopping.then(() => { if (!terminationSeen) throw new Error("Actual termination failed before its barrier"); })]);
    await expect(executionResult).resolves.toMatchObject({ error: null, result: graceful ? { exitCode: 0, signal: null } : { exitCode: null, signal } });
    expect(rawResult).toMatchObject(graceful ? { exitCode: 0, signal: null } : { exitCode: null, signal });
    expect(runningProcesses.has(runId)).toBe(false);
    const join = joinProcessRunCancellation(runId);
    if (!join) throw new Error("Actual cancellation owner was lost after child exit");
    duplicate = join.then(() => { duplicateSettled = true; return { value: current, error: null }; }, error => { duplicateSettled = true; return { value: null, error }; });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(firstSettled).toBe(false);
    expect(duplicateSettled).toBe(false);
    expect(completed).toBe(false);
    expect(current).toBeNull();
    terminationRelease.resolve();
    const [first, second] = await Promise.all([stopping, duplicate]);
    if (failure) {
      expect(first.error).toBe(injected);
      expect(second.error).toBe(first.error);
      if (mode === "late graceful cancellation writer error") expect(failedProcessRunCancellations.get(runId)).toBe(owner.settlement);
    } else {
      expect(first.error).toBeNull(); expect(second.error).toBeNull();
      expect(first.value).toEqual({ status: "cancelled" }); expect(second.value).toBe(first.value);
    }
    resultRelease.resolve();
    const result = await completion;
    if (mode === "adapter exception") {
      expect(result.error).toBe(adapterException);
      expect(current).toEqual({ status: "cancelled" });
    } else {
      expect(result.error).toBeNull(); expect(result.outcome).toBe(failure ? "failed" : "cancelled");
    }
    expect(joinProcessRunCancellation(runId)).toBeUndefined();
    expect(failedProcessRunCancellations.has(runId)).toBe(false);
    expect(terminationCalls).toBe(1);
  } finally {
    terminationRelease.resolve(); resultRelease.resolve(); ready.resolve();
    try {
      const remaining = runningProcesses.get(runId);
      if (remaining && child && remaining !== child) throw new Error("Utility owner changed during cleanup");
      if (remaining?.child.pid) await terminateLocalService({ pid: remaining.child.pid, processGroupId: remaining.processGroupId }, { signal: "SIGKILL", forceAfterMs: 100, verifyAfterMs: 1000 });
    } finally {
      await executionResult; await completion; await stopping; await duplicate;
      finishProcessRunCancellationExecution(runId);
      expect(processRunCancellationSettlements.has(runId)).toBe(false);
      expect(failedProcessRunCancellations.has(runId)).toBe(false);
      expect(runningProcesses.has(runId)).toBe(false);
    }
  }
}, 10000);

it.each([
  { mode: "clean exit", script: "console.log('complete')", outcome: "succeeded", exitCode: 0, signal: null },
  { mode: "unrequested signal", script: "process.kill(process.pid, 'SIGTERM')", outcome: "failed", exitCode: null, signal: "SIGTERM" },
] as const)("keeps real independent $mode distinct from Stop", async ({ script, outcome, exitCode, signal }) => {
  const runId = randomUUID();
  try {
    const result = await execute({ runId,
      agent: { id: randomUUID(), companyId: randomUUID(), name: "Independent utility", adapterType: "process", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: process.execPath, args: ["-e", script], timeoutSec: 5, graceSec: 1 }, context: {}, onLog: async () => {},
    });
    expect(result).toMatchObject({ exitCode, signal });
    expect(joinProcessRunCancellation(runId)).toBeUndefined();
    expect(classifyAdapterExecutionOutcome(null, createAdapterExecutionControl(), result, undefined, terminal)).toBe(outcome);
  } finally {
    const remaining = runningProcesses.get(runId);
    if (remaining?.child.pid) await terminateLocalService({ pid: remaining.child.pid, processGroupId: remaining.processGroupId }, { signal: "SIGKILL", forceAfterMs: 100, verifyAfterMs: 1000 });
    finishProcessRunCancellationExecution(runId);
    expect(runningProcesses.has(runId)).toBe(false);
  }
}, 10000);
