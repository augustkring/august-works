import { describe, expect, it } from "vitest";
import { isNativeHumanReviewWithdrawalCandidate } from "./native-interaction-bridge.js";

describe("Human review withdrawal candidates (APR-E2E-13)", () => {
  it("keeps rejected confirmations and cancelled questions as withdrawal candidates", () => {
    expect(isNativeHumanReviewWithdrawalCandidate({ kind: "request_confirmation", status: "rejected", payload: { version: 1, prompt: "Plan?" } })).toBe(true);
    expect(isNativeHumanReviewWithdrawalCandidate({ kind: "request_checkbox_confirmation", status: "rejected", payload: {} })).toBe(true);
    expect(isNativeHumanReviewWithdrawalCandidate({ kind: "ask_user_questions", status: "cancelled", payload: {} })).toBe(true);
  });

  it("never treats a declined tool-action card as a Human review withdrawal", () => {
    expect(isNativeHumanReviewWithdrawalCandidate({ kind: "request_confirmation", status: "rejected",
      payload: { version: 1, prompt: "Approve?", toolAction: { version: 1, actionRequestId: "request-1" } } })).toBe(false);
  });

  it("ignores accepted, pending and unrelated interactions", () => {
    expect(isNativeHumanReviewWithdrawalCandidate({ kind: "request_confirmation", status: "accepted", payload: {} })).toBe(false);
    expect(isNativeHumanReviewWithdrawalCandidate({ kind: "request_confirmation", status: "pending", payload: {} })).toBe(false);
    expect(isNativeHumanReviewWithdrawalCandidate({ kind: "suggest_tasks", status: "rejected", payload: {} })).toBe(false);
    expect(isNativeHumanReviewWithdrawalCandidate(null)).toBe(false);
  });
});
