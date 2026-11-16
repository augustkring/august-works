import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput, NativeRunInputSourceReceipt } from "@paperclipai/shared";
import { nativeCurrentTaskWakeReconstructionInputs } from "../native-direct-input.js";

// CONF15-W5. A same-Task Run that resumes a retained Run holds two Task inputs
// for the Task: its own (first) and the retained Run's sealed one, carried in by
// the plan revision. The current Run's own wake is reconstructed against its own
// Task input only, and only when the single other Task input is exactly the
// sealed Task input of the retained Run that CONF15-W3/W4 admit. Anything else
// refuses.

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
const retainedRun = (overrides: Record<string, unknown> = {}) =>
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

type ReconstructionInput = Parameters<typeof nativeCurrentTaskWakeReconstructionInputs>[0];
const reconstruct = (overrides: Partial<ReconstructionInput> = {}) => nativeCurrentTaskWakeReconstructionInputs({
  companyId: company, run, source: currentWake, inputs: resumeInputs(), policy: { runIds: [retainedRunId] },
  retainedRun: retainedRun(), retainedReceipt: receipt([retainedTask, retainedWake]), ...overrides,
});

describe("current task wake reconstruction inputs (CONF15-W5)", () => {
  it("leaves a set with one Task input for the Task unchanged", () => {
    const inputs = [currentTask, currentWake, task("v-9", hash("9"), otherIssue)];
    expect(reconstruct({ inputs, retainedRun: null, retainedReceipt: null })).toEqual(inputs);
    expect(reconstruct({ inputs: [currentWake], retainedRun: null, retainedReceipt: null })).toEqual([currentWake]);
  });

  it("gives the current wake only its own Task input beside the admitted retained Run's sealed one", () => {
    expect(reconstruct()).toEqual([currentTask, currentWake, retainedWake, retainedSource()]);
  });

  it("applies only to the current Run's own wake", () => {
    expect(reconstruct({ source: retainedWake })).toBeNull();
  });

  it("refuses an extra Task input from a non-retained Run", () => {
    const strangerTask = task("v-1", hash("9"));
    const strangerWake = wake(strangerRunId, "v-1");
    expect(reconstruct({ inputs: [currentTask, currentWake, strangerTask, strangerWake, retainedSource()],
      policy: { runIds: [retainedRunId, strangerRunId] } })).toBeNull();
    // Even when the stranger Run's wake and Task input are at the current version.
    const strangerAtCurrent = task("v-2", hash("9"));
    expect(reconstruct({ inputs: [currentTask, currentWake, strangerAtCurrent, wake(strangerRunId, "v-2"), retainedSource()],
      policy: { runIds: [retainedRunId, strangerRunId] } })).toBeNull();
    // Even with that Run's own row and sealed receipt: the retained-run source names another Run.
    expect(reconstruct({ inputs: [currentTask, currentWake, strangerTask, strangerWake, retainedSource()],
      policy: { runIds: [retainedRunId, strangerRunId] }, retainedRun: retainedRun({ id: strangerRunId }),
      retainedReceipt: receipt([strangerTask, strangerWake], { runId: strangerRunId }) })).toBeNull();
    // A retained Run the policy does not name.
    expect(reconstruct({ policy: { runIds: [] } })).toBeNull();
    // Beside the admitted retained wake, a Task input that is not its sealed one.
    expect(reconstruct({ inputs: [currentTask, currentWake, strangerTask, retainedWake, retainedSource()] })).toBeNull();
    // A second Task input with no other Run's wake at all.
    expect(reconstruct({ inputs: [currentTask, currentWake, strangerTask, retainedSource()] })).toBeNull();
  });

  it("refuses an extra Task input from another Task or company", () => {
    expect(reconstruct({ retainedRun: retainedRun({ nativeIssueId: otherIssue }) })).toBeNull();
    expect(reconstruct({ retainedReceipt: receipt([retainedTask, retainedWake], { issueId: otherIssue }) })).toBeNull();
    expect(reconstruct({ retainedReceipt: receipt([retainedTask, retainedWake], { companyId: otherCompany }) })).toBeNull();
    expect(reconstruct({ companyId: otherCompany })).toBeNull();
    // The current wake is on another Task than the retained Run's sealed Task input.
    const otherCurrent = task("v-2", hash("b"), otherIssue);
    const otherExtra = task("v-1", hash("c"), otherIssue);
    const otherWake = wake(currentRunId, "v-2", { issueId: otherIssue });
    expect(reconstruct({ source: otherWake,
      inputs: [otherCurrent, otherWake, otherExtra, retainedTask, retainedWake, retainedSource()] })).toBeNull();
  });

  it("refuses two extra Task inputs", () => {
    expect(reconstruct({ inputs: resumeInputs([task("v-0", hash("9"))]) })).toBeNull();
    expect(reconstruct({ inputs: resumeInputs([task("v-1", hash("c"), issue), task("v-0", hash("9"))]) })).toBeNull();
  });

  it("refuses a retained Task input that differs from its sealed receipt", () => {
    const altered = task("v-1", hash("9"));
    expect(reconstruct({ inputs: [currentTask, currentWake, altered, retainedWake, retainedSource()] })).toBeNull();
    expect(reconstruct({ retainedReceipt: receipt([task("v-1", hash("9")), retainedWake]) })).toBeNull();
    expect(reconstruct({ retainedReceipt: receipt([retainedTask, wake(retainedRunId, "v-0")]) })).toBeNull();
    expect(reconstruct({ retainedReceipt: null })).toBeNull();
  });

  it("refuses without a retained_run input, or with two", () => {
    expect(reconstruct({ inputs: [currentTask, currentWake, retainedTask, retainedWake] })).toBeNull();
    expect(reconstruct({ inputs: resumeInputs([retainedSource(strangerRunId)]) })).toBeNull();
    expect(reconstruct({ retainedRun: null })).toBeNull();
    expect(reconstruct({ retainedRun: retainedRun({ id: strangerRunId }) })).toBeNull();
    expect(reconstruct({ retainedRun: retainedRun({ agentId: otherAgent }) })).toBeNull();
    expect(reconstruct({ retainedRun: retainedRun({ nativeSessionId: "session-b" }) })).toBeNull();
  });

  it("never drops the current Task input in favour of the retained one", () => {
    // The retained Task input first, or duplicated, never qualifies.
    expect(reconstruct({ inputs: [retainedTask, currentWake, currentTask, retainedWake, retainedSource()] })).toBeNull();
    expect(reconstruct({ inputs: [retainedTask, currentWake, retainedTask, retainedWake, retainedSource()] })).toBeNull();
  });
});
