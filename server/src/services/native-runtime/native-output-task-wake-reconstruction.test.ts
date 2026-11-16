import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput, NativeRunInputSourceReceipt } from "@paperclipai/shared";
import { nativeOutputTaskWakeReconstructionInputs } from "../native-direct-input.js";

// CONF15-W10. A same-Task Run that resumes a retained Run consumes, in a model
// output's source set, its own wake and Task input and the retained Run's
// provenance wake and sealed Task input (carried in by the plan revision that
// Run wrote). The recurring model-output reader reconstructs each wake against
// its own Task input only, under the CONF15-W9 / W4 / W5 rule: the current wake
// with the producing Run's own (current) Task version, and at most one other
// wake, the single retained Run's, bound to its sealed bootstrap wake and Task
// input. Anything else refuses.

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
const comment = { kind: "comment", issueId: issue, commentId: "00000000-0000-4000-8000-0000000000f1",
  contentHash: hash("7") } as unknown as NativePayloadSourceInput;

const currentTask = task("2.000000", hash("b"));
const retainedTask = task("1.000000", hash("c"));
const currentWake = wake(currentRunId, "2.000000");
const retainedWake = wake(retainedRunId, "1.000000");
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
// The producing Run's own sealed bootstrap: its own Task input first, then the
// retained Run's sealed one carried in by the plan revision (CONF15-W5).
const ownBootstrap = [currentTask, currentWake, retainedTask, retainedWake, retainedSource()];
// The consumed set as the model output carries it: the order is not trusted.
const consumed = (extra: NativePayloadSourceInput[] = []): NativePayloadSourceInput[] =>
  [retainedTask, currentTask, retainedWake, comment, currentWake, retainedSource(), ...extra];

type ReconstructionInput = Parameters<typeof nativeOutputTaskWakeReconstructionInputs>[0];
const reconstruct = (overrides: Partial<ReconstructionInput> = {}) => nativeOutputTaskWakeReconstructionInputs({
  companyId: company, run, source: currentWake, inputs: consumed(), policy: { runIds: [retainedRunId] },
  bootstrapInputs: ownBootstrap, retainedRun: retainedRun(), retainedReceipt: receipt([retainedTask, retainedWake]),
  ...overrides,
});

describe("model-output task wake reconstruction inputs (CONF15-W10)", () => {
  it("leaves a set with one Task input for the Task unchanged", () => {
    const inputs = [currentTask, currentWake, task("9.000000", hash("9"), otherIssue)];
    expect(reconstruct({ inputs, retainedRun: null, retainedReceipt: null })).toEqual(inputs);
    expect(reconstruct({ inputs: [currentWake], retainedRun: null, retainedReceipt: null })).toEqual([currentWake]);
  });

  it("reconstructs the current wake against its own current Task version only, whatever the set's order", () => {
    expect(reconstruct()).toEqual([currentTask, retainedWake, comment, currentWake, retainedSource()]);
    const ordered = [currentTask, currentWake, retainedTask, retainedWake, retainedSource()];
    expect(reconstruct({ inputs: ordered })).toEqual([currentTask, currentWake, retainedWake, retainedSource()]);
  });

  it("reconstructs the retained Run's provenance wake against that Run's sealed Task input only", () => {
    expect(reconstruct({ source: retainedWake })).toEqual([retainedTask, retainedWake, comment, currentWake, retainedSource()]);
  });

  it("refuses two provenance wakes", () => {
    const strangerWake = wake(strangerRunId, "1.000000");
    expect(reconstruct({ inputs: consumed([strangerWake]), policy: { runIds: [retainedRunId, strangerRunId] } })).toBeNull();
    expect(reconstruct({ source: retainedWake, inputs: consumed([strangerWake]),
      policy: { runIds: [retainedRunId, strangerRunId] } })).toBeNull();
    // Two wakes of the retained Run (one of them not its sealed one).
    const secondRetainedWake = wake(retainedRunId, "1.000000", { contentHash: hash("8") });
    expect(reconstruct({ inputs: consumed([secondRetainedWake]) })).toBeNull();
  });

  it("refuses a provenance wake from a Run that is not the retained one", () => {
    const strangerTask = task("1.000000", hash("9"));
    const strangerWake = wake(strangerRunId, "1.000000");
    const inputs = [strangerTask, currentTask, strangerWake, currentWake, retainedSource()];
    // Even with that Run's own row and sealed receipt and the policy naming it.
    expect(reconstruct({ inputs, bootstrapInputs: [currentTask, currentWake, strangerTask, strangerWake, retainedSource()],
      policy: { runIds: [retainedRunId, strangerRunId] }, retainedRun: retainedRun({ id: strangerRunId }),
      retainedReceipt: receipt([strangerTask, strangerWake], { runId: strangerRunId }) })).toBeNull();
    expect(reconstruct({ source: strangerWake, inputs, policy: { runIds: [retainedRunId, strangerRunId] },
      retainedRun: retainedRun({ id: strangerRunId }),
      retainedReceipt: receipt([strangerTask, strangerWake], { runId: strangerRunId }) })).toBeNull();
    // The retained-run source naming the producing Run itself.
    expect(reconstruct({ inputs: [retainedTask, currentTask, retainedWake, currentWake, retainedSource(currentRunId)] })).toBeNull();
    // A retained Run the policy does not name, or a row or receipt that is not the retained Run's.
    expect(reconstruct({ policy: { runIds: [] } })).toBeNull();
    expect(reconstruct({ retainedRun: null })).toBeNull();
    expect(reconstruct({ retainedRun: retainedRun({ id: strangerRunId }) })).toBeNull();
    expect(reconstruct({ retainedRun: retainedRun({ agentId: otherAgent }) })).toBeNull();
    expect(reconstruct({ retainedRun: retainedRun({ nativeIssueId: otherIssue }) })).toBeNull();
    expect(reconstruct({ retainedRun: retainedRun({ nativeSessionId: "session-b" }) })).toBeNull();
    expect(reconstruct({ retainedReceipt: null })).toBeNull();
    expect(reconstruct({ retainedReceipt: receipt([retainedTask, retainedWake], { companyId: otherCompany }) })).toBeNull();
    expect(reconstruct({ retainedReceipt: receipt([retainedTask, retainedWake], { runId: strangerRunId }) })).toBeNull();
    expect(reconstruct({ companyId: otherCompany })).toBeNull();
    // A provenance wake that differs from the retained Run's sealed bootstrap wake.
    expect(reconstruct({ retainedReceipt: receipt([retainedTask, wake(retainedRunId, "1.000000", { contentHash: hash("8") })]) }))
      .toBeNull();
  });

  it("refuses a provenance Task version that does not match the retained Run's sealed input", () => {
    const altered = task("1.000000", hash("9"));
    expect(reconstruct({ inputs: [altered, currentTask, retainedWake, currentWake, retainedSource()],
      bootstrapInputs: [currentTask, currentWake, altered, retainedWake, retainedSource()] })).toBeNull();
    expect(reconstruct({ source: retainedWake, inputs: [altered, currentTask, retainedWake, currentWake, retainedSource()] }))
      .toBeNull();
    // The sealed input at another version than the provenance wake, or not exactly one sealed Task input.
    expect(reconstruct({ retainedReceipt: receipt([task("0.500000", hash("c")), retainedWake]) })).toBeNull();
    expect(reconstruct({ retainedReceipt: receipt([retainedTask, task("0.500000", hash("9")), retainedWake]) })).toBeNull();
    expect(reconstruct({ retainedReceipt: receipt([retainedWake]) })).toBeNull();
  });

  it("refuses a current wake paired with the old Task version", () => {
    // The current wake at the retained version: its own Task input is not at its version.
    const staleCurrentWake = wake(currentRunId, "1.000000");
    expect(reconstruct({ source: staleCurrentWake, inputs: [retainedTask, currentTask, retainedWake, staleCurrentWake, retainedSource()],
      bootstrapInputs: [currentTask, staleCurrentWake, retainedTask, retainedWake, retainedSource()] })).toBeNull();
    // The producing Run's own (first) bootstrap Task input is the retained Run's old version.
    expect(reconstruct({ bootstrapInputs: [retainedTask, currentWake, currentTask, retainedWake, retainedSource()] })).toBeNull();
    // The current Task input is not the producing Run's own sealed one.
    expect(reconstruct({ bootstrapInputs: [task("2.000000", hash("9")), currentWake, retainedTask, retainedWake, retainedSource()] }))
      .toBeNull();
    expect(reconstruct({ bootstrapInputs: [currentWake, retainedWake, retainedSource()] })).toBeNull();
    // Both Task inputs are the retained Run's sealed one.
    expect(reconstruct({ inputs: [retainedTask, { ...retainedTask }, retainedWake, currentWake, retainedSource()] })).toBeNull();
  });

  it("refuses a non-retained execution that carries two Task versions", () => {
    const strangerTask = task("1.000000", hash("9"));
    const strangerWake = wake(strangerRunId, "1.000000");
    // No retained-run source at all, with or without another Run's wake.
    expect(reconstruct({ inputs: [strangerTask, currentTask, strangerWake, currentWake], retainedRun: null, retainedReceipt: null,
      bootstrapInputs: [currentTask, currentWake, strangerTask, strangerWake], policy: { runIds: [strangerRunId] } })).toBeNull();
    expect(reconstruct({ inputs: [strangerTask, currentTask, currentWake], retainedRun: null, retainedReceipt: null,
      bootstrapInputs: [currentTask, currentWake, strangerTask] })).toBeNull();
    expect(reconstruct({ inputs: [retainedTask, currentTask, retainedWake, currentWake] })).toBeNull();
    // Two retained-run sources.
    expect(reconstruct({ inputs: consumed([retainedSource(strangerRunId)]) })).toBeNull();
    // The retained Run's sealed Task input with no provenance wake beside it.
    expect(reconstruct({ inputs: [retainedTask, currentTask, currentWake, retainedSource()] })).toBeNull();
  });

  it("refuses any other wake or Task shape", () => {
    // No current wake, or two.
    expect(reconstruct({ source: retainedWake, inputs: [retainedTask, currentTask, retainedWake, retainedSource()] })).toBeNull();
    expect(reconstruct({ inputs: consumed([wake(currentRunId, "2.000000", { contentHash: hash("8") })]) })).toBeNull();
    // A third Task input for the Task.
    expect(reconstruct({ inputs: consumed([task("0.500000", hash("9"))]) })).toBeNull();
    // The current wake on another Task than the reconstructed one.
    const otherTaskWake = wake(currentRunId, "2.000000", { issueId: otherIssue });
    expect(reconstruct({ inputs: [retainedTask, currentTask, retainedWake, otherTaskWake, retainedSource()] })).toBeNull();
    expect(reconstruct({ source: retainedWake, inputs: [retainedTask, currentTask, retainedWake, otherTaskWake, retainedSource()] }))
      .toBeNull();
    // A wake that is neither the current nor the provenance wake.
    expect(reconstruct({ source: wake(currentRunId, "2.000000", { contentHash: hash("8") }) })).toBeNull();
    expect(reconstruct({ source: wake(retainedRunId, "1.000000", { contentHash: hash("8") }) })).toBeNull();
  });
});
