import { describe, expect, it } from "vitest";
import { memoryReviewInputSchema, memoryReviewReasonSchema } from "./validators/memory.js";

describe("Private Memory publication consent", () => {
  it("keeps ordinary verification distinct from explicit publication", () => {
    expect(memoryReviewInputSchema.parse({ decision: "accept" }).publishPrivateShare).toBeUndefined();
    expect(memoryReviewReasonSchema.parse({})).toEqual({});
    expect(memoryReviewInputSchema.parse({ decision: "accept", publishPrivateShare: true }).publishPrivateShare).toBe(true);
    expect(memoryReviewReasonSchema.parse({ publishPrivateShare: true })).toEqual({ publishPrivateShare: true });
  });
  it("refuses ambiguous flags, rejection with publication, and caller-owned authority claims", () => {
    for (const publishPrivateShare of [false, "true", 1, null])
      expect(memoryReviewInputSchema.safeParse({ decision: "accept", publishPrivateShare }).success).toBe(false);
    expect(memoryReviewInputSchema.safeParse({ decision: "reject", reason: "Keep it private", publishPrivateShare: true }).success).toBe(false);
    for (const claim of [{ authorizationActor: { type: "board" } }, { privateShareReview: { state: "published" } }, { sourceOwnerUserId: "other" }]) {
      expect(memoryReviewReasonSchema.safeParse({ publishPrivateShare: true, ...claim }).success).toBe(false);
      expect(memoryReviewInputSchema.safeParse({ decision: "accept", publishPrivateShare: true, ...claim }).success).toBe(false);
    }
  });
});
