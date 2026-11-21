import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput } from "@paperclipai/shared";
import { nativeReviewMarkerRecordedOnce } from "./native-direct-input.js";

// MS1h19. Each later dispatch receipt of a Reviewer Run carries its earlier
// review markers forward; the gateway appends the response's own marker last.
type ReviewMarker = Extract<NativePayloadSourceInput, { kind: "review_model_dispatch" }>;
type Dispatch = { executionInputDigest: string; inputs: NativePayloadSourceInput[] };

const digest = "a".repeat(64);
const hex = (seed: string) => seed.repeat(64).slice(0, 64);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const marker = (n: number): ReviewMarker => ({
  kind: "review_model_dispatch", runId: id(1), reservationId: id(100 + n), callId: `messages:${hex(String(n))}`,
  planId: id(2), issueId: id(3), interactionId: id(4), decisionId: id(5), sourceRunId: id(6), sourceWorkerId: id(7),
  sourceAgentId: id(8), sourceResultId: id(9), sourceAttemptId: id(10), expectedPlanVersion: 2,
  sourceReceiptDigest: hex("b"), sourceResultCanonicalSha256: `sha256:${hex("c")}`, reviewerAgentId: id(11),
  executionManifestId: id(12), requestHash: hex(String(n)), wireBodyHash: hex("d"), responseHash: hex("e"),
});
const base = [{ kind: "task", issueId: id(3) }, { kind: "completion_contract", issueId: id(3) }] as unknown as NativePayloadSourceInput[];
const toolResult = { kind: "tool_result", callId: "resolve" } as unknown as NativePayloadSourceInput;
/** Receipts are JSON: every copy is its own object. */
const dispatch = (...inputs: NativePayloadSourceInput[]): Dispatch =>
  ({ executionInputDigest: digest, inputs: structuredClone([...base, ...inputs]) });
const copies = (dispatches: Dispatch[], value: ReviewMarker) =>
  dispatches.flatMap(entry => entry.inputs).filter(input => JSON.stringify(input) === JSON.stringify(value)).length;
const m1 = marker(1), m2 = marker(2), m3 = marker(3);
/** Bootstrap, then one dispatch per Reviewer model call, each carrying the earlier markers. */
const calls = (count: number) => [dispatch(), ...[m1, m2, m3].slice(0, count).map((_marker, index, all) =>
  dispatch(...all.slice(0, index + 1).flatMap((value, at) => at < index ? [value, toolResult] : [value])))];

describe("nativeReviewMarkerRecordedOnce (MS1h19)", () => {
  it("admits the marker of a single review call", () => {
    expect(nativeReviewMarkerRecordedOnce(calls(1), m1, digest)).toBe(true);
  });

  it("admits a marker carried forward into a second review call (2 identical copies)", () => {
    const dispatches = calls(2);
    expect(copies(dispatches, m1)).toBe(2);
    expect(nativeReviewMarkerRecordedOnce(dispatches, m1, digest)).toBe(true);
    expect(nativeReviewMarkerRecordedOnce(dispatches, m2, digest)).toBe(true);
  });

  it("admits markers carried into a third review call (3 and 2 identical copies)", () => {
    const dispatches = calls(3);
    expect([copies(dispatches, m1), copies(dispatches, m2), copies(dispatches, m3)]).toEqual([3, 2, 1]);
    expect(nativeReviewMarkerRecordedOnce(dispatches, m1, digest)).toBe(true);
    expect(nativeReviewMarkerRecordedOnce(dispatches, m2, digest)).toBe(true);
    expect(nativeReviewMarkerRecordedOnce(dispatches, m3, digest)).toBe(true);
    // The third call's own source check runs before its dispatch is recorded.
    expect(nativeReviewMarkerRecordedOnce(calls(2), m1, digest)).toBe(true);
  });

  it("refuses a conflicting carried copy", () => {
    const dispatches = calls(3);
    dispatches[3] = dispatch({ ...m1, responseHash: hex("f") }, toolResult, m2, toolResult, m3);
    expect(nativeReviewMarkerRecordedOnce(dispatches, m1, digest)).toBe(false);
    expect(nativeReviewMarkerRecordedOnce(dispatches, m2, digest)).toBe(true);
  });

  it("refuses two dispatches that each end with the marker", () => {
    expect(nativeReviewMarkerRecordedOnce([dispatch(), dispatch(m1), dispatch(m1)], m1, digest)).toBe(false);
    expect(nativeReviewMarkerRecordedOnce([dispatch(), dispatch(m1), dispatch(toolResult, m1)], m1, digest)).toBe(false);
  });

  it("refuses a copy with another reservation or another call", () => {
    const dispatches = calls(2);
    dispatches[2] = dispatch({ ...m1, reservationId: id(999) }, toolResult, m2);
    expect(nativeReviewMarkerRecordedOnce(dispatches, m1, digest)).toBe(false);
    dispatches[2] = dispatch({ ...m1, callId: `messages:${hex("9")}` }, toolResult, m2);
    expect(nativeReviewMarkerRecordedOnce(dispatches, m1, digest)).toBe(false);
  });

  it("refuses a dispatch ending with a conflicting copy as a second recording", () => {
    expect(nativeReviewMarkerRecordedOnce([dispatch(), dispatch(m1), dispatch(m1, toolResult, { ...m1, requestHash: hex("7") })],
      m1, digest)).toBe(false);
  });

  it("refuses a copy in a dispatch of another execution input, and another source digest", () => {
    const dispatches = calls(2);
    dispatches[2] = { ...dispatches[2]!, executionInputDigest: hex("1") };
    expect(nativeReviewMarkerRecordedOnce(dispatches, m1, digest)).toBe(false);
    expect(nativeReviewMarkerRecordedOnce(calls(1), m1, hex("1"))).toBe(false);
    expect(nativeReviewMarkerRecordedOnce(calls(1), m1, undefined)).toBe(false);
  });

  it("refuses a marker no dispatch recorded, or one that differs from the recorded marker", () => {
    expect(nativeReviewMarkerRecordedOnce([dispatch(), dispatch(m1, toolResult)], m1, digest)).toBe(false);
    expect(nativeReviewMarkerRecordedOnce(calls(1), { ...m1, wireBodyHash: hex("8") }, digest)).toBe(false);
    expect(nativeReviewMarkerRecordedOnce([dispatch()], m1, digest)).toBe(false);
  });
});
