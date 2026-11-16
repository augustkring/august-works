import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput } from "@paperclipai/shared";
import type { NativePayloadSourceSet } from "./native-runtime/native-execution-input.js";
import { nativeOutputRetainedRunSourceBound } from "./native-direct-input.js";

// CONF15-W8. A model output produced in a Run that resumes a retained provider
// session carries that Run's `retained_run` bootstrap input; the output-capture
// family loop now admits it only through this binding.
const producerRunId = "11111111-1111-4111-8111-111111111111";
const retainedRunId = "22222222-2222-4222-8222-222222222222";
const otherRunId = "33333333-3333-4333-8333-333333333333";
const issueId = "44444444-4444-4444-8444-444444444444";
const hash = (digit: string) => digit.repeat(64);
const retained: Extract<NativePayloadSourceInput, { kind: "retained_run" }> =
  { kind: "retained_run", runId: retainedRunId, inputDigest: hash("a"), dispatchDigest: hash("b") };
const task: NativePayloadSourceInput = { kind: "task", issueId, sourceVersion: "1", contentHash: hash("c") };
const policy = (runIds: string[]) => ({ issueIds: [issueId], projectIds: [], runIds, memoryIds: [], foundationRevisionIds: [] });
const bootstrap: NativePayloadSourceSet = { policy: policy([producerRunId, retainedRunId]), inputs: [task, retained] };
const sourceSet: NativePayloadSourceSet = { policy: policy([producerRunId, retainedRunId]), inputs: [task, retained] };
const bound = (overrides: Partial<Parameters<typeof nativeOutputRetainedRunSourceBound>[0]> = {}) =>
  nativeOutputRetainedRunSourceBound({ source: retained, producerRunId, sourceSet, bootstrap, ...overrides });

describe("nativeOutputRetainedRunSourceBound", () => {
  it("admits the producer Run's own single bootstrap retained Run", () => {
    expect(bound()).toBe(true);
  });
  it("refuses a retained Run that is not this Run's bootstrap input", () => {
    // Introduced only by a dispatch or additional input.
    expect(bound({ bootstrap: { ...bootstrap, inputs: [task] } })).toBe(false);
    // A different digest of the same Run.
    expect(bound({ bootstrap: { ...bootstrap, inputs: [task, { ...retained, dispatchDigest: hash("d") }] } })).toBe(false);
    expect(bound({ source: { ...retained, inputDigest: hash("e") } })).toBe(false);
    // Not in the output's own source set.
    expect(bound({ sourceSet: { ...sourceSet, inputs: [task] } })).toBe(false);
    expect(bound({ sourceSet: { ...sourceSet, inputs: [task, { ...retained, inputDigest: hash("f") }] } })).toBe(false);
  });
  it("refuses a retained Run outside either policy", () => {
    expect(bound({ sourceSet: { ...sourceSet, policy: policy([producerRunId]) } })).toBe(false);
    expect(bound({ bootstrap: { ...bootstrap, policy: policy([producerRunId]) } })).toBe(false);
  });
  it("refuses the producer Run itself and a second retained Run", () => {
    expect(bound({ producerRunId: retainedRunId })).toBe(false);
    const second = { ...retained, runId: otherRunId };
    expect(bound({ sourceSet: { policy: policy([producerRunId, retainedRunId, otherRunId]), inputs: [task, retained, second] } })).toBe(false);
    expect(bound({ bootstrap: { policy: policy([producerRunId, retainedRunId, otherRunId]), inputs: [task, retained, second] } })).toBe(false);
  });
});
