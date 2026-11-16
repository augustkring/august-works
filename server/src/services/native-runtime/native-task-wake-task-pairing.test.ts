import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput, NativeRunInputSourceReceipt } from "@paperclipai/shared";
import { nativeTaskWakeTaskInputForSource } from "../native-direct-input.js";

// CONF15-W4. A same-Task Run that resumes a retained Run carries the retained
// Run's wake and that Run's own Task input (at the wake's version) beside the
// current Task input. Each wake is version-checked against the Task input of
// its own Run: the current wake against the current Task input, the admitted
// retained wake only against the retained Run's sealed Task input in the same
// set. A retained wake never pairs with the current Task version.

type Wake = Extract<NativePayloadSourceInput, { kind: "native_task_wake" }>;
type Task = Extract<NativePayloadSourceInput, { kind: "task" }>;

const company = "00000000-0000-4000-8000-0000000000c1";
const otherCompany = "00000000-0000-4000-8000-0000000000c2";
const agent = "00000000-0000-4000-8000-0000000000a1";
const otherAgent = "00000000-0000-4000-8000-0000000000a2";
const issue = "00000000-0000-4000-8000-0000000000e1";
const otherIssue = "00000000-0000-4000-8000-0000000000e2";
const currentRunId = "00000000-0000-4000-8000-000000000102";
const retainedRunId = "00000000-0000-4000-8000-000000000101";
const strangerRunId = "00000000-0000-4000-8000-000000000103";
const session = "session-a";
const hash = (c: string) => c.repeat(64);

const task = (sourceVersion: string, contentHash = hash("b"), issueId = issue): Task =>
  ({ kind: "task", issueId, sourceVersion, contentHash });
const wake = (runId: string, sourceVersion: string, overrides: Partial<Wake> = {}): Wake =>
  ({ kind: "native_task_wake", runId, issueId: issue, sourceVersion, contentHash: hash("a"), ...overrides }) as Wake;
const retainedSource = (runId = retainedRunId) =>
  ({ kind: "retained_run", runId, inputDigest: hash("d"), dispatchDigest: hash("e") }) as NativePayloadSourceInput;

const currentTask = task("v-2", hash("b"));
const retainedTask = task("v-1", hash("c"));
const currentWake = wake(currentRunId, "v-2");
const retainedWake = wake(retainedRunId, "v-1");
const run = { id: currentRunId, agentId: agent, nativeIssueId: issue, nativeSessionId: session };
const sourceRun = (overrides: Record<string, unknown> = {}) =>
  ({ id: retainedRunId, agentId: agent, nativeIssueId: issue, nativeSessionId: session, ...overrides }) as typeof run;
const receipt = (bootstrapInputs: NativePayloadSourceInput[], binding: Partial<Record<string, string>> = {}) => ({
  version: 1,
  binding: { companyId: company, runId: retainedRunId, agentId: agent, responsibleUserId: "user-1", issueId: issue, ...binding },
  bootstrap: { executionInputDigest: hash("f"), policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [],
    foundationRevisionIds: [] }, inputs: bootstrapInputs },
  dispatches: [],
  additionalInputs: [],
  digest: hash("0"),
}) as unknown as NativeRunInputSourceReceipt;
const resumeInputs = (extra: NativePayloadSourceInput[] = []): NativePayloadSourceInput[] =>
  [currentTask, currentWake, retainedTask, retainedWake, retainedSource(), ...extra];

type PairingInput = Parameters<typeof nativeTaskWakeTaskInputForSource>[0];
const pair = (overrides: Partial<PairingInput> = {}) => nativeTaskWakeTaskInputForSource({
  companyId: company, run, source: retainedWake, inputs: resumeInputs(), policy: { runIds: [retainedRunId] },
  sourceRun: sourceRun(), sourceReceipt: receipt([retainedTask, retainedWake]), ...overrides,
});

describe("task wake version pairing (CONF15-W4)", () => {
  it("pairs the current wake with the current Task input, unchanged", () => {
    expect(pair({ source: currentWake, sourceRun: run, sourceReceipt: null })).toEqual(currentTask);
    expect(pair({ source: currentWake, inputs: [currentTask, currentWake], sourceRun: run, sourceReceipt: null }))
      .toEqual(currentTask);
  });

  it("pairs the admitted retained wake with that Run's own sealed Task input in the same set", () => {
    expect(pair()).toEqual(retainedTask);
  });

  it("never pairs the current wake with a stale version, even if the retained Run's Task input matches it", () => {
    const staleCurrent = wake(currentRunId, "v-1");
    expect(pair({ source: staleCurrent, inputs: [currentTask, staleCurrent, retainedTask, retainedWake, retainedSource()],
      sourceRun: run, sourceReceipt: null })).toBeNull();
  });

  it("refuses when the retained Run's Task input is missing from the set", () => {
    // The current Task input is at the wake's version here, so a fallback to
    // the current Task input would wrongly succeed.
    const sameVersionCurrent = task("v-1", hash("b"));
    expect(pair({ inputs: [sameVersionCurrent, wake(currentRunId, "v-1"), retainedWake, retainedSource()] })).toBeNull();
    expect(pair({ inputs: [currentTask, currentWake, retainedWake, retainedSource()] })).toBeNull();
  });

  it("refuses a Task input from another Task, company or Run", () => {
    // Another Task: the retained Run's sealed Task input names another Task.
    const otherTaskInput = task("v-1", hash("c"), otherIssue);
    expect(pair({ inputs: resumeInputs([otherTaskInput]), sourceReceipt: receipt([otherTaskInput, retainedWake]) })).toBeNull();
    // The set's Task input at the wake version is another Run's capture, not the sealed one.
    const thirdRunTask = task("v-1", hash("9"));
    expect(pair({ inputs: [currentTask, currentWake, thirdRunTask, retainedWake, retainedSource()] })).toBeNull();
    // The retained Run's receipt is bound to another company or Run.
    expect(pair({ sourceReceipt: receipt([retainedTask, retainedWake], { companyId: otherCompany }) })).toBeNull();
    expect(pair({ sourceReceipt: receipt([retainedTask, retainedWake], { runId: strangerRunId }) })).toBeNull();
    expect(pair({ sourceRun: sourceRun({ id: strangerRunId }) })).toBeNull();
  });

  it("refuses a tampered version", () => {
    const tampered = task("v-1-tampered", hash("c"));
    expect(pair({ inputs: [currentTask, currentWake, tampered, retainedWake, retainedSource()] })).toBeNull();
    // The sealed Task input is in the set but not at the wake's version.
    const olderSealed = task("v-0", hash("c"));
    expect(pair({ inputs: resumeInputs([olderSealed]), sourceReceipt: receipt([olderSealed, retainedWake]) })).toBeNull();
    // The wake differs from the one sealed in the retained Run's receipt.
    expect(pair({ sourceReceipt: receipt([retainedTask, wake(retainedRunId, "v-0")]) })).toBeNull();
  });

  it("refuses a sealed receipt with no, or two, own Task inputs or own wakes", () => {
    expect(pair({ sourceReceipt: receipt([retainedWake]) })).toBeNull();
    expect(pair({ sourceReceipt: receipt([retainedTask, task("v-1", hash("8")), retainedWake]) })).toBeNull();
    expect(pair({ sourceReceipt: receipt([retainedTask, retainedWake, wake(retainedRunId, "v-1", { contentHash: hash("7") })]) }))
      .toBeNull();
    expect(pair({ sourceReceipt: null })).toBeNull();
  });

  it("keeps a non-retained Run's wake on the current Task input, never its own", () => {
    const strangerWake = wake(strangerRunId, "v-1");
    const strangerTask = task("v-1", hash("c"));
    expect(pair({ source: strangerWake, inputs: [currentTask, currentWake, strangerTask, strangerWake, retainedSource()],
      policy: { runIds: [retainedRunId, strangerRunId] }, sourceRun: sourceRun({ id: strangerRunId }),
      sourceReceipt: receipt([strangerTask, strangerWake], { runId: strangerRunId }) })).toBeNull();
  });

  it("admits the retained wake only as CONF15-W3 admits it", () => {
    expect(pair({ inputs: resumeInputs([retainedSource(strangerRunId)]) })).toBeNull();
    expect(pair({ inputs: resumeInputs([wake(strangerRunId, "v-1")]) })).toBeNull();
    expect(pair({ inputs: [currentTask, retainedTask, retainedWake, retainedSource()] })).toBeNull();
    expect(pair({ inputs: resumeInputs([wake(currentRunId, "v-2", { contentHash: hash("6") })]) })).toBeNull();
    expect(pair({ source: wake(retainedRunId, "v-1", { issueId: otherIssue }),
      inputs: [currentTask, currentWake, retainedTask, wake(retainedRunId, "v-1", { issueId: otherIssue }), retainedSource()] }))
      .toBeNull();
    // A wake on another Task, even with a receipt and Task input sealed for that Task.
    const otherTaskWake = wake(retainedRunId, "v-1", { issueId: otherIssue });
    const otherTaskInput = task("v-1", hash("c"), otherIssue);
    expect(pair({ source: otherTaskWake, inputs: [currentTask, currentWake, otherTaskInput, otherTaskWake, retainedSource()],
      sourceReceipt: receipt([otherTaskInput, otherTaskWake], { issueId: otherIssue }) })).toBeNull();
    expect(pair({ policy: { runIds: [] } })).toBeNull();
    expect(pair({ sourceRun: null })).toBeNull();
    expect(pair({ sourceRun: sourceRun({ agentId: otherAgent }) })).toBeNull();
    expect(pair({ sourceRun: sourceRun({ nativeIssueId: otherIssue }) })).toBeNull();
    expect(pair({ sourceRun: sourceRun({ nativeSessionId: "session-b" }) })).toBeNull();
    expect(pair({ run: { ...run, nativeSessionId: null }, sourceRun: sourceRun({ nativeSessionId: null }) })).toBeNull();
    expect(pair({ sourceReceipt: receipt([retainedTask, retainedWake], { agentId: otherAgent }) })).toBeNull();
    expect(pair({ sourceReceipt: receipt([retainedTask, retainedWake], { issueId: otherIssue }) })).toBeNull();
    expect(pair({ companyId: otherCompany })).toBeNull();
  });
});
