import { z } from "zod";
import { feedbackRetentionConfigurationSchema } from "./feedback-retention.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const feedbackRetentionErasureTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("case") }),
  z.strictObject({ kind: z.literal("image"), imageId: z.uuid().toLowerCase() }),
]);
export const feedbackRetentionErasureCommandSchema = z.strictObject({
  requestKey: z.uuid().toLowerCase(), confirmErasure: z.literal(true),
  expectedReviewHash: digest, target: feedbackRetentionErasureTargetSchema,
});
export const feedbackRetentionErasureReviewSchema = z.strictObject({
  companyId: z.uuid(), feedbackId: z.uuid(), reviewHash: digest,
  caseVersion: z.number().int().min(0), retentionVersion: z.number().int().min(0),
  configuration: feedbackRetentionConfigurationSchema,
  held: z.boolean(), caseDueAt: z.iso.datetime(), caseEligible: z.boolean(), caseCanErase: z.boolean(),
  images: z.array(z.strictObject({ id: z.uuid(), dueAt: z.iso.datetime(), eligible: z.boolean(), canErase: z.boolean(),
    status: z.enum(["scanning", "storing", "ready", "deleting", "deleted", "failed"]) })).max(3),
});
export const feedbackRetentionErasureReceiptSchema = z.strictObject({
  id: z.uuid(), companyId: z.uuid(), feedbackId: z.uuid(), target: feedbackRetentionErasureTargetSchema,
  status: z.enum(["pending", "completed"]), requestedAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable(),
}).superRefine((value, context) => {
  if ((value.status === "completed") !== (value.completedAt !== null))
    context.addIssue({ code: "custom", message: "Erasure completion requires its native receipt" });
});
export type FeedbackRetentionErasureCommand = z.infer<typeof feedbackRetentionErasureCommandSchema>;
export type FeedbackRetentionErasureReview = z.infer<typeof feedbackRetentionErasureReviewSchema>;
export type FeedbackRetentionErasureReceipt = z.infer<typeof feedbackRetentionErasureReceiptSchema>;
export const feedbackRetentionErasureHistorySchema = z.array(z.strictObject({
  receipt: feedbackRetentionErasureReceiptSchema, command: feedbackRetentionErasureCommandSchema,
})).max(25).superRefine((items, context) => {
  if (new Set(items.map(item => item.receipt.id)).size !== items.length || items.some(item =>
    JSON.stringify(item.receipt.target) !== JSON.stringify(item.command.target)))
    context.addIssue({ code: "custom", message: "Erasure history requires exact original receipts" });
});
export type FeedbackRetentionErasureHistory = z.infer<typeof feedbackRetentionErasureHistorySchema>;
