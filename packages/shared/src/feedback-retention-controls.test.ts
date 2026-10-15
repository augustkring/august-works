import { describe, expect, it } from "vitest";
import { feedbackRetentionCommandSchema, feedbackRetentionViewSchema } from "./feedback-retention-controls.js";
const input = { requestKey: "10000000-0000-4000-8000-000000000001", expectedVersion: 0, confirmRetentionChange: true,
  legalHold: { active: true, releaseAt: null, reason: "Owned incident fixture" }, extensionUntil: null, extensionReason: "" };
describe("explicit private feedback retention controls", () => {
  it("refuses a forged empty owner or an inconsistent private hold receipt", () => {
    const view = { companyId: input.requestKey, feedbackId: input.requestKey, version: 0,
      legalHold: { active: false, releaseAt: null, reason: "" }, extensionUntil: null, extensionReason: "", updatedAt: null };
    expect(feedbackRetentionViewSchema.safeParse(view).success).toBe(true);
    for (const patch of [{ version: 1 }, { updatedAt: "2026-10-11T00:00:00Z" },
      { legalHold: input.legalHold }, { legalHold: { ...view.legalHold, reason: "orphan reason" } }])
      expect(feedbackRetentionViewSchema.safeParse({ ...view, ...patch }).success).toBe(false);
    expect(feedbackRetentionViewSchema.safeParse({ ...view, version: 1, legalHold: input.legalHold,
      updatedAt: "2026-10-11T00:00:00Z" }).success).toBe(true);
  });
  it("requires review, an incident reason and exact native request/version fields", () => {
    expect(feedbackRetentionCommandSchema.parse(input)).toEqual(input);
    for (const patch of [{ confirmRetentionChange: false }, { expectedVersion: -1 }, { automaticDeletion: true },
      { legalHold: { ...input.legalHold, reason: "" } }, { legalHold: { ...input.legalHold, originalFilename: "private" } },
      { closedFeedbackDays: 1 }]) expect(feedbackRetentionCommandSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it("requires a reason for extension and clears hold/extension details together", () => {
    expect(feedbackRetentionCommandSchema.safeParse({ ...input, extensionUntil: "2027-10-11T12:00:00.000Z", extensionReason: "Owned unresolved case" }).success).toBe(true);
    for (const patch of [{ extensionUntil: "2027-10-11T12:00:00.000Z" }, { extensionReason: "orphan reason" },
      { legalHold: { active: false, releaseAt: null, reason: "orphan reason" } },
      { legalHold: { active: false, releaseAt: "2027-10-11T12:00:00.000Z", reason: "" } }])
      expect(feedbackRetentionCommandSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    expect(feedbackRetentionCommandSchema.safeParse({ ...input, legalHold: { active: false, releaseAt: null, reason: "" } }).success).toBe(true);
  });
});
