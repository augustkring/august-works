import { z } from "zod";

// A delivery preference is not a grant, approval, message or business receipt.
export const notificationChannelCategorySchema = z.enum(["billing", "runtime", "approval", "work_update"]);
export const notificationBoundProviderSchema = z.enum(["slack", "microsoft-teams"]);
const account = z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const ownReference = z.strictObject({
  identityLinkId: z.uuid(),
  conversationId: z.uuid(),
  expectedTargetHash: digest,
});
export const notificationChannelChoiceSchema = z.discriminatedUnion("channel", [
  z.strictObject({ channel: z.literal("default") }),
  ownReference.extend({ channel: z.literal("slack") }),
  ownReference.extend({ channel: z.literal("microsoft-teams") }),
]);
export const notificationChannelUpdateSchema = z.strictObject({
  requestId: z.uuid().refine(value => value === value.toLowerCase(), "Use the canonical request identity"),
  expectedVersion: z.number().int().nonnegative(),
  expectedBaselineHash: digest,
  deliveryLocale: z.enum(["en", "da"]),
  choice: notificationChannelChoiceSchema,
});
export const notificationChannelTargetSchema = z.strictObject({
  identityLinkId: z.uuid(),
  conversationId: z.uuid(),
  provider: notificationBoundProviderSchema,
  label: z.string().trim().min(1).max(400),
  targetHash: digest,
});
export const notificationChannelPreferenceViewSchema = z.strictObject({
  companyId: z.uuid(),
  userId: account,
  category: notificationChannelCategorySchema,
  version: z.number().int().nonnegative(),
  channel: z.enum(["default", "slack", "microsoft-teams"]),
  availability: z.enum(["default", "available", "unavailable"]),
  deliveryLocale: z.enum(["en", "da"]),
  target: notificationChannelTargetSchema.nullable(),
  baselineHash: digest,
  targets: z.array(notificationChannelTargetSchema).max(30),
  targetsLimited: z.boolean(),
}).superRefine((value, context) => {
  if (value.channel === "default" ? value.availability !== "default" || value.target !== null
    : value.availability === "default" || (value.availability === "available") !== (value.target !== null)
      || value.target !== null && value.target.provider !== value.channel)
    context.addIssue({ code: "custom", message: "Use the current Original channel preference and destination" });
});
export const notificationChannelPreferenceReceiptSchema = z.strictObject({
  companyId: z.uuid(),
  userId: account,
  category: notificationChannelCategorySchema,
  requestId: z.uuid(),
  version: z.number().int().positive(),
  channel: z.enum(["default", "slack", "microsoft-teams"]),
  preferenceApplied: z.literal(true),
  authorityGranted: z.literal(false),
  messageSent: z.literal(false),
  executionStarted: z.literal(false),
});
export type NotificationChannelCategory = z.infer<typeof notificationChannelCategorySchema>;
export type NotificationChannelUpdate = z.infer<typeof notificationChannelUpdateSchema>;
export type NotificationChannelTarget = z.infer<typeof notificationChannelTargetSchema>;
export type NotificationChannelPreferenceView = z.infer<typeof notificationChannelPreferenceViewSchema>;
export type NotificationChannelPreferenceReceipt = z.infer<typeof notificationChannelPreferenceReceiptSchema>;
