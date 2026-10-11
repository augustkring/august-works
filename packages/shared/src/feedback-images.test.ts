import { describe, expect, it } from "vitest";
import { feedbackImageSchema, feedbackImagesSchema } from "./feedback-images.js";
import { customerFeedbackPolicySchema } from "./feedback-data-processing.js";
import { FEEDBACK_CONTACTS } from "./customer-feedback.js";
const image = { id: "10000000-0000-4000-8000-000000000001", companyId: "10000000-0000-4000-8000-000000000002",
  feedbackId: "10000000-0000-4000-8000-000000000003", status: "ready", mediaType: "image/png", byteSize: 100,
  createdAt: "2026-10-11T12:00:00.000Z", deletedAt: null };
describe("private original feedback image receipts", () => {
  it("admits only fixed image metadata and rejects private storage, identity and original-name fields", () => {
    expect(feedbackImageSchema.parse(image)).toEqual(image);
    for (const key of ["objectKey", "storageScopeId", "originalFilename", "scannerOutput", "submittedByUserId", "body"])
      expect(feedbackImageSchema.safeParse({ ...image, [key]: "private-canary" }).success).toBe(false);
  });
  it("does not treat missing byte size or an unconfirmed deletion as a ready/deleted receipt", () => {
    for (const patch of [{ byteSize: null }, { status: "deleted" }, { deletedAt: image.createdAt }, { byteSize: 10485761 }, { mediaType: "image/svg+xml" }])
      expect(feedbackImageSchema.safeParse({ ...image, ...patch }).success).toBe(false);
    expect(feedbackImageSchema.safeParse({ ...image, status: "scanning", byteSize: null }).success).toBe(true);
    expect(feedbackImageSchema.safeParse({ ...image, status: "deleted", deletedAt: image.createdAt }).success).toBe(true);
  });
  it("bounds active lists and refuses duplicates, foreign owners and tombstones", () => {
    expect(feedbackImagesSchema.parse([])).toEqual([]);
    expect(feedbackImagesSchema.safeParse([image]).success).toBe(true);
    for (const rows of [[image, image], [image, { ...image, id: "10000000-0000-4000-8000-000000000004", companyId: image.feedbackId }],
      [{ ...image, status: "deleted", deletedAt: image.createdAt }],
      Array.from({ length: 4 }, (_, index) => ({ ...image, id: `10000000-0000-4000-8000-00000000000${index + 1}` }))])
      expect(feedbackImagesSchema.safeParse(rows).success).toBe(false);
  });
  it("keeps storage-unqualified image intake disabled without exposing private namespace metadata", () => {
    const policy = { contacts: FEEDBACK_CONTACTS, attachments: { enabled: false, reason: "storage_qualification_required",
      types: ["image/png", "image/jpeg", "image/webp"], maxFiles: 3, maxBytes: 10485760 },
      retention: { status: "owner_decision_required" }, ga: { allowed: false, reason: "data_processing_qualification_required" } };
    expect(customerFeedbackPolicySchema.parse(policy)).toEqual(policy);
    expect(customerFeedbackPolicySchema.safeParse({ ...policy, attachments: { ...policy.attachments, enabled: true } }).success).toBe(false);
    expect(customerFeedbackPolicySchema.safeParse({ ...policy, attachments: { ...policy.attachments, storageScopeId: "a".repeat(64) } }).success).toBe(false);
  });
});
