import { describe, expect, it } from "vitest";
import type { NativeTaskContinuationCapture } from "../execution-continuation.js";
import { assertNativeResolutionRunFreshSession, nativeToolActionResolutionRun } from "./native-resolution-session.js";

// APR-E2E-20/21 (option B): only a governed tool-action resolution Run starts
// a fresh provider session; other continuations keep their resume path.
const interactionId = "11111111-1111-4111-8111-111111111111";
const resolution = () => ({
  wake: { requestedByActorType: "user", requestedByActorId: "human", reason: "issue_commented", originCommentIds: [],
    interaction: { interactionId, interactionKind: "request_confirmation", interactionStatus: "accepted", sourceRunId: "run" } },
  governedInteractions: [{ projection: { interactionId } }],
  delivery: { projection: { interactionId } },
}) as unknown as NativeTaskContinuationCapture;

describe("nativeToolActionResolutionRun", () => {
  it("identifies only a wake whose card has its governed decision and delivery", () => {
    expect(nativeToolActionResolutionRun(resolution())).toBe(true);
    const noDelivery = resolution(); delete noDelivery.delivery;
    expect(nativeToolActionResolutionRun(noDelivery)).toBe(false);
    const noDecision = resolution(); delete noDecision.governedInteractions;
    expect(nativeToolActionResolutionRun(noDecision)).toBe(false);
    const otherCard = resolution(); otherCard.delivery!.projection.interactionId = "22222222-2222-4222-8222-222222222222";
    expect(nativeToolActionResolutionRun(otherCard)).toBe(false);
    const noWakeCard = resolution(); delete noWakeCard.wake.interaction;
    expect(nativeToolActionResolutionRun(noWakeCard)).toBe(false);
    expect(nativeToolActionResolutionRun(null)).toBe(false);
  });
});

describe("assertNativeResolutionRunFreshSession", () => {
  const none = { previousRunId: null, checkpointPresent: false, retainedWitnessPresent: false };
  it("refuses a resolution Run that would resume an earlier session", () => {
    expect(() => assertNativeResolutionRunFreshSession({ resolution: true, ...none, previousRunId: "requesting-run" }))
      .toThrow("native_tool_action_resolution_resume_refused");
    expect(() => assertNativeResolutionRunFreshSession({ resolution: true, ...none, checkpointPresent: true }))
      .toThrow("native_tool_action_resolution_resume_refused");
    expect(() => assertNativeResolutionRunFreshSession({ resolution: true, ...none, retainedWitnessPresent: true }))
      .toThrow("native_tool_action_resolution_resume_refused");
    expect(() => assertNativeResolutionRunFreshSession({ resolution: true, ...none })).not.toThrow();
  });
  it("leaves every other continuation's resume alone", () => {
    expect(() => assertNativeResolutionRunFreshSession({ resolution: false, previousRunId: "earlier-run",
      checkpointPresent: true, retainedWitnessPresent: true })).not.toThrow();
  });
});
