import type { NativeTaskContinuationCapture } from "../execution-continuation.js";

/**
 * APR-E2E-20/21 (option B). A Run is a governed tool-action resolution Run
 * when its closed continuation capture holds the governed decision of the
 * card its wake names and the exact delivery rendition of that decision.
 * Such a Run starts a fresh provider session; every other Run keeps its
 * existing resume policy.
 */
export function nativeToolActionResolutionRun(capture: NativeTaskContinuationCapture | null | undefined): boolean {
  const interactionId = capture?.wake?.interaction?.interactionId;
  return Boolean(capture?.delivery && interactionId && capture.delivery.projection?.interactionId === interactionId &&
    capture.governedInteractions?.some(value => value.projection.interactionId === interactionId));
}

/** Refuse a resolution Run that would resume an earlier provider session. */
export function assertNativeResolutionRunFreshSession(input: {
  resolution: boolean; previousRunId: string | null; checkpointPresent: boolean; retainedWitnessPresent: boolean;
}): void {
  if (input.resolution && (input.previousRunId !== null || input.checkpointPresent || input.retainedWitnessPresent))
    throw new Error("native_tool_action_resolution_resume_refused");
}
