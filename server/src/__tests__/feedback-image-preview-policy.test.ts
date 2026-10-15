import { describe, expect, it } from "vitest";
import { customerFeedbackPolicySchema, FEEDBACK_CONTACTS } from "@paperclipai/shared";
const policy = { contacts: FEEDBACK_CONTACTS, attachments: {
  enabled: false, reason: "scanner_qualification_required", types: ["image/png", "image/jpeg", "image/webp"], maxFiles: 3, maxBytes: 10485760,
}, retention: { status: "owner_decision_required" }, ga: { allowed: false, reason: "data_processing_qualification_required" } };
describe("preview image policy is distinct from GA admission", () => {
  it("admits configured preview validation without opening GA", () => {
    expect(customerFeedbackPolicySchema.parse(policy)).toEqual(policy);
    const configured = { ...policy, attachments: { ...policy.attachments, enabled: true, reason: "validation_required" } };
    expect(customerFeedbackPolicySchema.parse(configured)).toEqual(configured);
    expect(customerFeedbackPolicySchema.safeParse({ ...configured, ga: { ...policy.ga, allowed: true } }).success).toBe(false);
  });
  it("refuses inconsistent and exaggerated availability or changed size/type limits", () => {
    for (const patch of [{ enabled: true }, { reason: "validation_required" }, { maxFiles: 4 }, { maxBytes: 10485761 }, { types: ["image/svg+xml"] }])
      expect(customerFeedbackPolicySchema.safeParse({ ...policy, attachments: { ...policy.attachments, ...patch } }).success).toBe(false);
  });
});
