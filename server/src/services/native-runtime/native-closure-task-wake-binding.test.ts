import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput } from "@paperclipai/shared";
import { nativeClosureRetainedWakeRunId, nativeClosureTaskWakeBinding } from "./native-session-executor.js";

// CONF15-W3. A same-Task Run that resumes a retained Run reads the plan
// document the retained Run wrote. That revision's payload source snapshot
// carries the retained Run's own task wake, so the bootstrap closure holds two
// wakes. Only the current Run's wake counts as the task wake; the retained
// Run's wake is admitted only as provenance of the single retained-run source.

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

const wake = (runId: string, overrides: Partial<Extract<NativePayloadSourceInput, { kind: "native_task_wake" }>> = {}) =>
  ({ kind: "native_task_wake", runId, issueId: issue, sourceVersion: `v-${runId.slice(-3)}`, contentHash: hash("a"),
    ...overrides }) as Extract<NativePayloadSourceInput, { kind: "native_task_wake" }>;
const retainedSource = (runId = retainedRunId) =>
  ({ kind: "retained_run", runId, inputDigest: hash("d"), dispatchDigest: hash("e") }) as NativePayloadSourceInput;
const task = { kind: "task", issueId: issue, sourceVersion: "v-102", contentHash: hash("b") } as NativePayloadSourceInput;

const run = { id: currentRunId, companyId: company, agentId: agent, nativeIssueId: issue, nativeSessionId: session };
const receipt = (bootstrapInputs: NativePayloadSourceInput[], binding: Partial<Record<string, string>> = {}) => ({
  version: 1,
  binding: { companyId: company, runId: retainedRunId, agentId: agent, responsibleUserId: "user-1", issueId: issue, ...binding },
  bootstrap: { executionInputDigest: hash("f"), policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [],
    foundationRevisionIds: [] }, inputs: bootstrapInputs },
  dispatches: [],
  additionalInputs: [],
  digest: hash("0"),
});
const retainedRun = (overrides: Record<string, unknown> = {}) => ({
  id: retainedRunId, companyId: company, agentId: agent, nativeIssueId: issue, nativeSessionId: session,
  runnerProfileJson: { nativeInputSourceReceipt: receipt([task, wake(retainedRunId)]) }, ...overrides,
});
const resumeInputs = (extra: NativePayloadSourceInput[] = []) =>
  [task, wake(currentRunId), wake(retainedRunId), retainedSource(), ...extra];

describe("bootstrap closure task wake binding (CONF15-W3)", () => {
  it("keeps the single current wake when there is no other Run's wake", () => {
    expect(nativeClosureTaskWakeBinding({ run, inputs: [task, wake(currentRunId)], retainedRun: null }))
      .toEqual({ currentWakes: [wake(currentRunId)] });
    expect(nativeClosureTaskWakeBinding({ run, inputs: [task], retainedRun: null })).toEqual({ currentWakes: [] });
    expect(nativeClosureRetainedWakeRunId(run, [task, wake(currentRunId), retainedSource()])).toBeNull();
  });

  it("admits the retained Run's wake only as provenance of the one retained-run source", () => {
    expect(nativeClosureRetainedWakeRunId(run, resumeInputs())).toBe(retainedRunId);
    expect(nativeClosureTaskWakeBinding({ run, inputs: resumeInputs(), retainedRun: retainedRun() }))
      .toEqual({ currentWakes: [wake(currentRunId)] });
  });

  it.each([
    ["two current wakes", () => ({ inputs: [task, wake(currentRunId), wake(currentRunId, { sourceVersion: "v-x" })] })],
    ["a current wake for another Task", () => ({ inputs: [task, wake(currentRunId, { issueId: otherIssue })] })],
    // Even with a row and sealed receipt that match the stranger's wake, it is
    // not the Run the retained-run source names.
    ["a wake from a non-retained Run", () => ({ inputs: [task, wake(currentRunId), wake(strangerRunId), retainedSource()],
      retainedRun: retainedRun({ id: strangerRunId, runnerProfileJson: { nativeInputSourceReceipt:
        receipt([task, wake(strangerRunId)], { runId: strangerRunId }) } }) })],
    ["a non-retained Run's wake with no retained-run source", () => ({ inputs: [task, wake(currentRunId), wake(strangerRunId)] })],
    ["a retained wake without a retained_run input", () => ({ inputs: [task, wake(currentRunId), wake(retainedRunId)],
      retainedRun: retainedRun() })],
    ["two retained-run inputs", () => ({ inputs: resumeInputs([retainedSource(strangerRunId)]), retainedRun: retainedRun() })],
    ["two retained wakes", () => ({ inputs: resumeInputs([wake(retainedRunId, { sourceVersion: "v-older" })]),
      retainedRun: retainedRun() })],
    ["a retained wake beside a wake from a non-retained Run", () => ({ inputs: resumeInputs([wake(strangerRunId)]),
      retainedRun: retainedRun() })],
    ["a missing current wake", () => ({ inputs: [task, wake(retainedRunId), retainedSource()], retainedRun: retainedRun() })],
    ["a retained wake for another Task", () => ({ inputs: [task, wake(currentRunId), wake(retainedRunId, { issueId: otherIssue }),
      retainedSource()], retainedRun: retainedRun({ runnerProfileJson: { nativeInputSourceReceipt:
        receipt([task, wake(retainedRunId, { issueId: otherIssue })]) } }) })],
    ["an unknown retained Run", () => ({ inputs: resumeInputs(), retainedRun: null })],
    ["a retained Run row for another Run", () => ({ inputs: resumeInputs(), retainedRun: retainedRun({ id: strangerRunId }) })],
    ["a retained Run that is the current Run", () => ({ inputs: [task, wake(currentRunId), wake(retainedRunId),
      retainedSource(currentRunId)], retainedRun: retainedRun({ id: currentRunId }) })],
    ["a retained Run of another company", () => ({ inputs: resumeInputs(), retainedRun: retainedRun({ companyId: otherCompany }) })],
    ["a retained Run of another Agent", () => ({ inputs: resumeInputs(), retainedRun: retainedRun({ agentId: otherAgent }) })],
    ["a retained Run of another Task", () => ({ inputs: resumeInputs(), retainedRun: retainedRun({ nativeIssueId: otherIssue }) })],
    ["a retained Run of another session", () => ({ inputs: resumeInputs(), retainedRun: retainedRun({ nativeSessionId: "session-b" }) })],
    ["a current Run without a Native session", () => ({ run: { ...run, nativeSessionId: null }, inputs: resumeInputs(),
      retainedRun: retainedRun({ nativeSessionId: null }) })],
    ["a current Run without a Task", () => ({ run: { ...run, nativeIssueId: null }, inputs: [wake(currentRunId, { issueId: issue }),
      wake(retainedRunId), retainedSource()], retainedRun: retainedRun() })],
    ["a retained Run without a source receipt", () => ({ inputs: resumeInputs(), retainedRun: retainedRun({ runnerProfileJson: {} }) })],
    ["a retained receipt bound to another company", () => ({ inputs: resumeInputs(), retainedRun: retainedRun({
      runnerProfileJson: { nativeInputSourceReceipt: receipt([task, wake(retainedRunId)], { companyId: otherCompany }) } }) })],
    ["a retained receipt bound to another Run", () => ({ inputs: resumeInputs(), retainedRun: retainedRun({
      runnerProfileJson: { nativeInputSourceReceipt: receipt([task, wake(retainedRunId)], { runId: strangerRunId }) } }) })],
    ["a retained receipt bound to another Agent", () => ({ inputs: resumeInputs(), retainedRun: retainedRun({
      runnerProfileJson: { nativeInputSourceReceipt: receipt([task, wake(retainedRunId)], { agentId: otherAgent }) } }) })],
    ["a retained receipt bound to another Task", () => ({ inputs: resumeInputs(), retainedRun: retainedRun({
      runnerProfileJson: { nativeInputSourceReceipt: receipt([task, wake(retainedRunId)], { issueId: otherIssue }) } }) })],
    ["a retained wake that differs from the retained Run's sealed wake", () => ({
      inputs: [task, wake(currentRunId), wake(retainedRunId, { contentHash: hash("c") }), retainedSource()], retainedRun: retainedRun() })],
    ["a retained receipt with no wake of its own", () => ({ inputs: resumeInputs(), retainedRun: retainedRun({
      runnerProfileJson: { nativeInputSourceReceipt: receipt([task]) } }) })],
    ["a retained receipt with two wakes of its own", () => ({ inputs: resumeInputs(), retainedRun: retainedRun({
      runnerProfileJson: { nativeInputSourceReceipt: receipt([task, wake(retainedRunId), wake(retainedRunId, { sourceVersion: "v-y" })]) } }) })],
  ] as Array<[string, () => { run?: typeof run | Record<string, unknown>; inputs: NativePayloadSourceInput[];
    retainedRun?: ReturnType<typeof retainedRun> | null }]>)("refuses %s", (_name, build) => {
    const value = build();
    expect(nativeClosureTaskWakeBinding({ run: (value.run ?? run) as typeof run, inputs: value.inputs,
      retainedRun: value.retainedRun ?? null })).toBeNull();
  });

  it("names a retained Run to look up only for one retained-run source beside another Run's wake", () => {
    expect(nativeClosureRetainedWakeRunId(run, [task, wake(currentRunId), wake(retainedRunId)])).toBeNull();
    expect(nativeClosureRetainedWakeRunId(run, resumeInputs([retainedSource(strangerRunId)]))).toBeNull();
    expect(nativeClosureRetainedWakeRunId(run, [task, wake(currentRunId), wake(strangerRunId), retainedSource()])).toBe(retainedRunId);
  });
});
