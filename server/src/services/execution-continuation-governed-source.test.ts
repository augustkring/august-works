import { describe, expect, it } from "vitest";
import { governedDecisionSourceRunId } from "./execution-continuation.js";

const decision = (sourceRunId: string | null) => ({ projection: { owner: { sourceRunId } } });
const RUN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("governed decision source Run (APR-E2E-14)", () => {
  it("names the requesting Run when every decision comes from the wake's trigger Run", () => {
    expect(governedDecisionSourceRunId({ governedInteractions: [decision(RUN), decision(RUN)],
      humanReviewWithdrawalCount: 0, triggerSourceRunId: RUN })).toBe(RUN);
  });

  it.each([
    ["no decisions", [], 0, RUN],
    ["a withdrawal mixed in", [decision(RUN)], 1, RUN],
    ["decisions from two Runs", [decision(RUN), decision(OTHER)], 0, RUN],
    ["a decision without a source Run", [decision(null)], 0, RUN],
    ["a trigger from another Run", [decision(RUN)], 0, OTHER],
    ["no trigger Run", [decision(RUN)], 0, null],
  ] as const)("names no Run with %s", (_label, governedInteractions, humanReviewWithdrawalCount, triggerSourceRunId) => {
    expect(governedDecisionSourceRunId({ governedInteractions: [...governedInteractions], humanReviewWithdrawalCount,
      triggerSourceRunId })).toBeNull();
  });
});
