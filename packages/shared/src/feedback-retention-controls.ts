import { z } from "zod";

const reason = z.string().trim().max(1000);
const controls = {
  legalHold: z.strictObject({ active: z.boolean(), releaseAt: z.iso.datetime().nullable(), reason }),
  extensionUntil: z.iso.datetime().nullable(),
  extensionReason: reason,
};
export const feedbackRetentionCommandSchema = z.strictObject({
  requestKey: z.uuid().toLowerCase(), expectedVersion: z.number().int().min(0),
  confirmRetentionChange: z.literal(true), ...controls,
}).superRefine((value, context) => {
  if ((value.legalHold.active && !value.legalHold.reason) ||
    (!value.legalHold.active && (value.legalHold.reason || value.legalHold.releaseAt)) ||
    (value.extensionUntil !== null && !value.extensionReason) ||
    (value.extensionUntil === null && value.extensionReason))
    context.addIssue({ code: "custom", message: "Retention exceptions require their explicit native reason" });
});
export const feedbackRetentionViewSchema = z.strictObject({
  companyId: z.uuid(), feedbackId: z.uuid(), version: z.number().int().min(0),
  ...controls, updatedAt: z.iso.datetime().nullable(),
}).superRefine((value, context) => {
  if ((value.legalHold.active && !value.legalHold.reason) ||
    (!value.legalHold.active && (value.legalHold.reason || value.legalHold.releaseAt)) ||
    (value.extensionUntil !== null && !value.extensionReason) ||
    (value.extensionUntil === null && value.extensionReason) ||
    (value.version === 0 && (value.updatedAt !== null || value.legalHold.active || value.extensionUntil !== null)) ||
    (value.version > 0 && value.updatedAt === null))
    context.addIssue({ code: "custom", message: "Retention controls require a consistent native version" });
});
export type FeedbackRetentionCommand = z.infer<typeof feedbackRetentionCommandSchema>;
export type FeedbackRetentionView = z.infer<typeof feedbackRetentionViewSchema>;
