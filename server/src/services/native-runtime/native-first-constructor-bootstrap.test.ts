import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput } from "@paperclipai/shared";
import { nativeSha256 } from "./canonical.js";
import { nativeFirstConstructorBootstrapInputs } from "./native-first-constructor-bootstrap.js";

// APR-E2E-16. The running v0 Run's prepared launch closure stands in for its
// not-yet-sealed receipt, for the exact same inputs only.
const companyId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const agentId = "33333333-3333-4333-8333-333333333333";
const issueId = "44444444-4444-4444-8444-444444444444";
const inputs: NativePayloadSourceInput[] = [
  { kind: "task", issueId, sourceVersion: "1.0", contentHash: "a".repeat(64) },
  { kind: "interaction", issueId, interactionId: "55555555-5555-4555-8555-555555555555", sourceVersion: "2.0", contentHash: "b".repeat(64) },
] as NativePayloadSourceInput[];
const turnContext = { kind: "context", manifestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", queryHash: "1".repeat(64),
  policySnapshotHash: "2".repeat(64), contentHash: "3".repeat(64) } as NativePayloadSourceInput;
const executionInput = { binding: { companyId, runId, agentId, issueId }, task: { title: "Task" } };

function run(overrides: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) {
  return {
    id: runId, companyId, agentId, status: "running", runtimeMode: "native", nativeIssueId: issueId,
    nativeInputSourceProtocolVersion: 0,
    runnerProfileJson: {
      nativeExecutionInput: executionInput,
      nativePreparedBootstrapSourceClosure: { version: 1, binding: { companyId, runId, agentId, issueId, executionWorkspaceId: "w" },
        executionInputHash: nativeSha256(executionInput), closure: { sourceSet: { policy: {}, inputs }, taskEnvelopeDigest: "c".repeat(64) } },
      ...profile,
    },
    ...overrides,
  } as Parameters<typeof nativeFirstConstructorBootstrapInputs>[0];
}
const read = (row: Parameters<typeof nativeFirstConstructorBootstrapInputs>[0], candidate: readonly NativePayloadSourceInput[] | undefined = inputs,
  scope: Partial<{ companyId: string; issueId: string; agentId: string }> = {}) =>
  nativeFirstConstructorBootstrapInputs(row, { companyId, issueId, agentId, candidate, ...scope });

describe("nativeFirstConstructorBootstrapInputs", () => {
  it("returns the exact prepared launch inputs of the running v0 Run without effects", () => {
    expect(read(run())).toEqual({ inputs, turnContextInputs: [] });
    expect(read(run({}, { nativeModelInputDispatchIntents: [], nativeToolCallDispatchAssociations: [], nativeToolResultSourceCaptures: [] })))
      .toEqual({ inputs, turnContextInputs: [] });
  });

  it("separates the turn's Context inputs from the prepared inputs for the caller to prove", () => {
    expect(read(run(), [...inputs, turnContext])).toEqual({ inputs, turnContextInputs: [turnContext] });
    expect(read(run(), [inputs[0]!, turnContext, inputs[1]!])).toEqual({ inputs, turnContextInputs: [turnContext] });
    expect(read(run(), [...inputs, turnContext, turnContext])).toBeNull();
  });

  it("refuses a Run with a sealed receipt or with prior Native effects", () => {
    expect(read(run({}, { nativeInputSourceReceipt: { version: 1 } }))).toBeNull();
    expect(read(run({}, { nativeModelInputDispatchIntents: [{ id: "intent" }] }))).toBeNull();
    expect(read(run({}, { nativeToolCallDispatchAssociations: [{ id: "association" }] }))).toBeNull();
    expect(read(run({}, { nativeToolResultSourceCaptures: [{ id: "capture" }] }))).toBeNull();
    expect(read(run({ nativeInputSourceProtocolVersion: 1 }))).toBeNull();
  });

  it("refuses a changed, extra, missing or reordered input", () => {
    expect(read(run(), [inputs[0]!, { ...inputs[1]!, contentHash: "d".repeat(64) } as NativePayloadSourceInput])).toBeNull();
    expect(read(run(), [...inputs, { kind: "task", issueId, sourceVersion: "3.0", contentHash: "e".repeat(64) } as NativePayloadSourceInput])).toBeNull();
    expect(read(run(), [inputs[0]!])).toBeNull();
    expect(read(run(), [inputs[1]!, inputs[0]!])).toBeNull();
    expect(nativeFirstConstructorBootstrapInputs(run(), { companyId, issueId, agentId, candidate: undefined })).toBeNull();
  });

  it("refuses a Run of a different Task, Agent or company, and a Run that is not running", () => {
    expect(read(run(), inputs, { issueId: "66666666-6666-4666-8666-666666666666" })).toBeNull();
    expect(read(run(), inputs, { agentId: "77777777-7777-4777-8777-777777777777" })).toBeNull();
    expect(read(run(), inputs, { companyId: "88888888-8888-4888-8888-888888888888" })).toBeNull();
    for (const status of ["queued", "succeeded", "failed", "cancelled"]) expect(read(run({ status }))).toBeNull();
    expect(read(run({ runtimeMode: "legacy" }))).toBeNull();
    expect(read(null)).toBeNull();
  });

  it("refuses a prepared closure bound to another Run or execution input, or without an execution input", () => {
    const prepared = (run()!.runnerProfileJson as Record<string, Record<string, unknown>>).nativePreparedBootstrapSourceClosure!;
    expect(read(run({}, { nativePreparedBootstrapSourceClosure: { ...prepared,
      binding: { ...(prepared.binding as object), runId: "99999999-9999-4999-8999-999999999999" } } }))).toBeNull();
    expect(read(run({}, { nativePreparedBootstrapSourceClosure: { ...prepared, executionInputHash: "f".repeat(64) } }))).toBeNull();
    expect(read(run({}, { nativeExecutionInput: { ...executionInput, task: { title: "Changed" } } }))).toBeNull();
    expect(read(run({}, { nativeExecutionInput: undefined }))).toBeNull();
    expect(read(run({}, { nativePreparedBootstrapSourceClosure: { ...prepared, version: 2 } }))).toBeNull();
    expect(read(run({}, { nativePreparedBootstrapSourceClosure: undefined }))).toBeNull();
  });
});
