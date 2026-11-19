import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nativePayloadSourceInputSchema } from "@paperclipai/shared";
import { reviewModelBindingFromMarker, reviewModelBindingFromReservation, reviewModelDispatchMarker,
  reviewModelIdempotencySubject, reviewModelReservationColumns, reviewModelReservationMatches } from "./review-model-binding.js";

// MS1f decision 4. One mapping of a review_model binding of either kind to its
// dispatch marker, reservation columns and reservation idempotency subject.
function source() {
  return { planId: randomUUID(), issueId: randomUUID(), decisionId: randomUUID(), sourceRunId: randomUUID(),
    sourceWorkerId: randomUUID(), sourceAgentId: randomUUID(), sourceAttemptId: randomUUID(), sourceResultId: randomUUID(),
    sourceReceiptDigest: "a".repeat(64), sourceResultCanonicalSha256: "b".repeat(64), reviewerAgentId: randomUUID(),
    reviewerRunId: randomUUID(), executionManifestId: randomUUID(), expectedPlanVersion: 2 };
}
const completion = () => ({ ...source(), interactionId: randomUUID() });
const stage = () => ({ kind: "execution_stage" as const, ...source(), stageId: randomUUID() });
const dispatch = (runId: string) => ({ runId, reservationId: randomUUID(), callId: "messages:x", requestHash: "c".repeat(64),
  wireBodyHash: "d".repeat(64), responseHash: "e".repeat(64) });

describe("review model binding mapping", () => {
  it("keeps the completion marker's exact keys (no stage keys) and round-trips both kinds", () => {
    const c = completion();
    const marker = reviewModelDispatchMarker(c, dispatch(c.reviewerRunId));
    expect(Object.keys(marker)).not.toContain("reviewKind");
    expect(Object.keys(marker)).not.toContain("stageId");
    expect(marker.interactionId).toBe(c.interactionId);
    expect(nativePayloadSourceInputSchema.parse(marker)).toEqual(marker);
    expect(reviewModelBindingFromMarker(marker)).toEqual(c);
    const s = stage();
    const stageMarker = reviewModelDispatchMarker(s, dispatch(s.reviewerRunId));
    expect(stageMarker).toMatchObject({ reviewKind: "execution_stage", stageId: s.stageId });
    expect(Object.keys(stageMarker)).not.toContain("interactionId");
    expect(nativePayloadSourceInputSchema.parse(stageMarker)).toEqual(stageMarker);
    expect(reviewModelBindingFromMarker(stageMarker)).toEqual(s);
  });

  it("writes the subject column of its kind and a null other subject, and matches only those columns", () => {
    for (const binding of [completion(), stage()]) {
      const columns = reviewModelReservationColumns(binding);
      const row = { planId: binding.planId, ...columns };
      expect(reviewModelReservationMatches(row, binding)).toBe(true);
      expect(reviewModelBindingFromReservation(row)).toEqual({ success: true, data: binding });
      for (const key of Object.keys(columns) as Array<keyof typeof columns>) {
        const changed = { ...row, [key]: key === "reviewPlanVersion" ? 3 : randomUUID() };
        expect([key, reviewModelReservationMatches(changed, binding)]).toEqual([key, false]);
      }
      expect(reviewModelReservationMatches({ ...row, planId: randomUUID() }, binding)).toBe(false);
    }
    const s = stage();
    expect(reviewModelReservationColumns(s)).toMatchObject({ reviewInteractionId: null, reviewStageId: s.stageId });
    const c = completion();
    expect(reviewModelReservationColumns(c)).toMatchObject({ reviewInteractionId: c.interactionId, reviewStageId: null });
    // A reservation naming both subjects is not a binding.
    expect(reviewModelBindingFromReservation({ planId: s.planId, ...reviewModelReservationColumns(s),
      reviewInteractionId: randomUUID() }).success).toBe(false);
  });

  it("keys a completion review by its interaction and a stage review by the stage-pending decision", () => {
    const c = completion(), s = stage();
    expect(reviewModelIdempotencySubject(c)).toBe(c.interactionId);
    expect(reviewModelIdempotencySubject(s)).toBe(`stage:${s.decisionId}`);
  });
});
