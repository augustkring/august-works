import { describe, expect, it } from "vitest";
import { feedbackRetentionErasureCommandSchema, feedbackRetentionErasureReceiptSchema } from "./feedback-retention-erasure.js";
const id = "10000000-0000-4000-8000-000000000001";
describe("explicit retention erasure contracts", () => {
  it("requires C3, exact target and a native review hash, refusing arbitrary deadlines and object keys", () => {
    const input = { requestKey: id, confirmErasure: true, expectedReviewHash: "a".repeat(64), target: { kind: "case" } };
    expect(feedbackRetentionErasureCommandSchema.safeParse(input).success).toBe(true);
    for (const invalid of [{ ...input, confirmErasure: false }, { ...input, objectKey: "private-object" },
      { ...input, expectedReviewHash: "unknown" }, { ...input, target: { kind: "case", imageId: id } },
      { ...input, target: { kind: "image" } }, { ...input, dueAt: "2000-01-01T00:00:00Z" }])
      expect(feedbackRetentionErasureCommandSchema.safeParse(invalid).success).toBe(false);
  });
  it("refuses a fabricated completion without its native timestamp or a pending completion timestamp", () => {
    const input = { id, companyId: id, feedbackId: id, target: { kind: "case" }, status: "pending",
      requestedAt: "2026-10-11T00:00:00Z", completedAt: null };
    expect(feedbackRetentionErasureReceiptSchema.safeParse(input).success).toBe(true);
    expect(feedbackRetentionErasureReceiptSchema.safeParse({ ...input, status: "completed" }).success).toBe(false);
    expect(feedbackRetentionErasureReceiptSchema.safeParse({ ...input, completedAt: input.requestedAt }).success).toBe(false);
  });
});
