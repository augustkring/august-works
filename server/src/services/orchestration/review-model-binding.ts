import {
  reviewModelBindingKind,
  reviewModelBindingSchema,
  type NativePayloadSourceInput,
  type ReviewModelBinding,
} from "@paperclipai/shared";
import type { orchestrationModelReservations } from "@paperclipai/db";

/** MS1f decision 4. One place that maps a `review_model` binding of either
 * kind (completion: names its review interaction; execution stage: names its
 * stage) to its dispatch marker, its reservation columns and its reservation
 * idempotency subject, so every reader compares the same fields. */
type ReviewMarker = Extract<NativePayloadSourceInput, { kind: "review_model_dispatch" }>;
type Reservation = typeof orchestrationModelReservations.$inferSelect;

export { reviewModelBindingKind };

/** The kind-specific subject fields of a review dispatch marker. */
function markerSubject(binding: ReviewModelBinding) {
  return reviewModelBindingKind(binding) === "execution_stage"
    ? { reviewKind: "execution_stage" as const, stageId: (binding as { stageId: string }).stageId }
    : { interactionId: (binding as { interactionId: string }).interactionId };
}

/** The exact `review_model_dispatch` marker of one settled review call. */
export function reviewModelDispatchMarker(binding: ReviewModelBinding, dispatch: { runId: string; reservationId: string;
  callId: string; requestHash: string; wireBodyHash: string; responseHash: string }): ReviewMarker {
  return { kind: "review_model_dispatch", runId: dispatch.runId, reservationId: dispatch.reservationId,
    planId: binding.planId, issueId: binding.issueId, ...markerSubject(binding),
    decisionId: binding.decisionId, sourceRunId: binding.sourceRunId,
    sourceWorkerId: binding.sourceWorkerId, sourceAgentId: binding.sourceAgentId,
    sourceResultId: binding.sourceResultId, sourceAttemptId: binding.sourceAttemptId,
    sourceReceiptDigest: binding.sourceReceiptDigest, sourceResultCanonicalSha256: binding.sourceResultCanonicalSha256,
    reviewerAgentId: binding.reviewerAgentId, executionManifestId: binding.executionManifestId,
    expectedPlanVersion: binding.expectedPlanVersion, callId: dispatch.callId, requestHash: dispatch.requestHash,
    wireBodyHash: dispatch.wireBodyHash, responseHash: dispatch.responseHash };
}

/** The binding a review dispatch marker names (the reviewer Run is the
 * marker's Run). Throws when the marker names no single review subject. */
export function reviewModelBindingFromMarker(marker: ReviewMarker): ReviewModelBinding {
  const subject = marker.interactionId !== undefined
    ? { interactionId: marker.interactionId }
    : { kind: marker.reviewKind, stageId: marker.stageId };
  return reviewModelBindingSchema.parse({ ...subject, planId: marker.planId, issueId: marker.issueId,
    decisionId: marker.decisionId, sourceRunId: marker.sourceRunId,
    sourceWorkerId: marker.sourceWorkerId, sourceAgentId: marker.sourceAgentId, sourceAttemptId: marker.sourceAttemptId,
    sourceResultId: marker.sourceResultId, sourceReceiptDigest: marker.sourceReceiptDigest,
    sourceResultCanonicalSha256: marker.sourceResultCanonicalSha256, reviewerAgentId: marker.reviewerAgentId,
    reviewerRunId: marker.runId, executionManifestId: marker.executionManifestId,
    expectedPlanVersion: marker.expectedPlanVersion });
}

/** The reservation columns a review binding writes (both subject columns are
 * always written; the other kind's column is null). */
export function reviewModelReservationColumns(binding: ReviewModelBinding) {
  const stage = reviewModelBindingKind(binding) === "execution_stage";
  return { reviewIssueId: binding.issueId,
    reviewInteractionId: stage ? null : (binding as { interactionId: string }).interactionId,
    reviewStageId: stage ? (binding as { stageId: string }).stageId : null,
    reviewDecisionId: binding.decisionId, reviewSourceRunId: binding.sourceRunId, reviewSourceResultId: binding.sourceResultId,
    reviewSourceWorkerId: binding.sourceWorkerId, reviewSourceAgentId: binding.sourceAgentId,
    reviewSourceAttemptId: binding.sourceAttemptId, reviewSourceReceiptDigest: binding.sourceReceiptDigest,
    reviewSourceResultCanonicalSha256: binding.sourceResultCanonicalSha256,
    reviewAgentId: binding.reviewerAgentId, reviewRunId: binding.reviewerRunId,
    reviewExecutionManifestId: binding.executionManifestId, reviewPlanVersion: binding.expectedPlanVersion };
}

/** True only when a reservation's plan and every review column equal the
 * binding's (the review subject of its kind, and a null other subject). */
export function reviewModelReservationMatches(reservation: Pick<Reservation, "planId" | "reviewIssueId" |
  "reviewInteractionId" | "reviewStageId" | "reviewDecisionId" | "reviewSourceRunId" | "reviewSourceResultId" |
  "reviewSourceWorkerId" | "reviewSourceAgentId" | "reviewSourceAttemptId" | "reviewSourceReceiptDigest" |
  "reviewSourceResultCanonicalSha256" | "reviewAgentId" | "reviewRunId" | "reviewExecutionManifestId" |
  "reviewPlanVersion">, binding: ReviewModelBinding): boolean {
  const expected = reviewModelReservationColumns(binding);
  return reservation.planId === binding.planId &&
    (Object.keys(expected) as Array<keyof typeof expected>).every(key => reservation[key] === expected[key]);
}

/** The reservation idempotency subject: the review interaction, or the
 * executor's stage-pending decision of an execution-stage review. */
export function reviewModelIdempotencySubject(binding: ReviewModelBinding): string {
  return reviewModelBindingKind(binding) === "execution_stage"
    ? `stage:${binding.decisionId}` : (binding as { interactionId: string }).interactionId;
}

/** The binding a persisted `review_model` reservation names. */
export function reviewModelBindingFromReservation(row: Pick<Reservation, "planId" | "reviewIssueId" |
  "reviewInteractionId" | "reviewStageId" | "reviewDecisionId" | "reviewSourceRunId" | "reviewSourceResultId" |
  "reviewSourceWorkerId" | "reviewSourceAgentId" | "reviewSourceAttemptId" | "reviewSourceReceiptDigest" |
  "reviewSourceResultCanonicalSha256" | "reviewAgentId" | "reviewRunId" | "reviewExecutionManifestId" |
  "reviewPlanVersion">) {
  // Exactly one review subject (the 0585 scope CHECK); both is no binding.
  if (row.reviewStageId !== null && row.reviewInteractionId !== null) return reviewModelBindingSchema.safeParse(null);
  const subject = row.reviewStageId !== null
    ? { kind: "execution_stage", stageId: row.reviewStageId }
    : { interactionId: row.reviewInteractionId };
  return reviewModelBindingSchema.safeParse({ ...subject, planId: row.planId, issueId: row.reviewIssueId,
    decisionId: row.reviewDecisionId, sourceRunId: row.reviewSourceRunId, sourceResultId: row.reviewSourceResultId,
    sourceWorkerId: row.reviewSourceWorkerId, sourceAgentId: row.reviewSourceAgentId, sourceAttemptId: row.reviewSourceAttemptId,
    sourceReceiptDigest: row.reviewSourceReceiptDigest, sourceResultCanonicalSha256: row.reviewSourceResultCanonicalSha256,
    reviewerAgentId: row.reviewAgentId, reviewerRunId: row.reviewRunId,
    executionManifestId: row.reviewExecutionManifestId, expectedPlanVersion: row.reviewPlanVersion });
}
