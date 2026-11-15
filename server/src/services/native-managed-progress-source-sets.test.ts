import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { unionNativePayloadSourceInputs, type NativePayloadSourceInput } from "@paperclipai/shared";
import { nativeManagedProgressCommentSourceSet, nativeManagedProgressReceiptSourceSet } from "./native-direct-input.js";
import type { NativeModelOutputCapture } from "./native-runtime/native-execution-input.js";

const hash = (value: string) => value.repeat(64).slice(0, 64);

function fixture() {
  const runId = randomUUID(), issueId = randomUUID(), agentId = randomUUID(), earlierRunId = randomUUID();
  const task: NativePayloadSourceInput = { kind: "task", issueId, sourceVersion: "1", contentHash: hash("a") };
  const comment: NativePayloadSourceInput = { kind: "comment", issueId, commentId: randomUUID(), sourceVersion: "1",
    contentHash: hash("b") };
  const dispatch = { kind: "conversation_model_dispatch" as const, runId, agentId, issueId, conversationSessionGeneration: 0,
    executionManifestId: randomUUID(), executionManifestHash: hash("c"), reservationId: randomUUID(), callId: "messages:1",
    requestHash: hash("d"), wireBodyHash: hash("e"), responseHash: hash("f") };
  const capture: NativeModelOutputCapture = { runId, dispatch,
    sourceSet: { policy: { issueIds: [issueId], projectIds: [], runIds: [earlierRunId], memoryIds: [], foundationRevisionIds: [] },
      inputs: [task, comment] },
    managedOpenCodeToolUse: { callId: "progress-1", toolName: "report_progress", argumentsHash: hash("1"), responseContentHash: hash("2") } };
  const source = { kind: "tool_result" as const, runId, callId: "progress-1", toolName: "report_progress",
    invocationId: null, contentHash: hash("3") };
  return { capture, source, runId, earlierRunId, task, comment, dispatch };
}

describe("managed progress source sets", () => {
  it("records the Run receipt entry with the consumed policy, not the comment snapshot policy", () => {
    const f = fixture();
    const receiptSet = nativeManagedProgressReceiptSourceSet(f.capture, f.source);
    // Exactly what the executor appends to the Run receipt for this result.
    expect(receiptSet).toEqual({ policy: f.capture.sourceSet.policy,
      inputs: unionNativePayloadSourceInputs([[f.source], [f.capture.dispatch], f.capture.sourceSet.inputs]) });
    expect(receiptSet.inputs).toEqual([f.source, f.dispatch, f.task, f.comment]);
    // The producing Run is provenance for its own result. It must not widen the
    // receipt entry's Run IDs, which the gateway compares exactly.
    expect(receiptSet.policy.runIds).toEqual([f.earlierRunId]);
    expect(receiptSet.policy.runIds).not.toContain(f.runId);
  });

  it("keeps the dispatch Run only in the sealed comment snapshot", () => {
    const f = fixture();
    const commentSet = nativeManagedProgressCommentSourceSet(f.capture);
    const receiptSet = nativeManagedProgressReceiptSourceSet(f.capture, f.source);
    expect(commentSet.policy.runIds).toEqual([f.earlierRunId, f.runId].sort());
    expect(commentSet.inputs).toEqual([f.dispatch, f.task, f.comment]);
    // The two owners differ only by the dispatch Run in the policy and the
    // tool_result marker in the inputs; neither can stand in for the other.
    expect(receiptSet.policy).not.toEqual(commentSet.policy);
    expect(receiptSet.inputs).toEqual(unionNativePayloadSourceInputs([[f.source], commentSet.inputs]));
  });

  it("does not deduplicate a different tool_result for the same call into the receipt entry", () => {
    const f = fixture();
    const stale = { ...f.source, contentHash: hash("4") };
    const capture = { ...f.capture, sourceSet: { ...f.capture.sourceSet, inputs: [...f.capture.sourceSet.inputs, stale] } };
    const receiptSet = nativeManagedProgressReceiptSourceSet(capture, f.source);
    // Both remain visible so the gateway's single-copy and conflict checks reject it.
    expect(receiptSet.inputs.filter(value => value.kind === "tool_result")).toEqual([f.source, stale]);
  });

  it("refuses a capture whose consumed inputs already contain its own dispatch", () => {
    const f = fixture();
    const capture = { ...f.capture, sourceSet: { ...f.capture.sourceSet, inputs: [...f.capture.sourceSet.inputs, f.dispatch] } };
    expect(() => nativeManagedProgressCommentSourceSet(capture)).toThrow(/does not separate its registered dispatch/);
  });
});
