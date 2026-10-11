import { z } from "zod";
import { FEEDBACK_CONTACTS } from "./customer-feedback.js";

/** References to Privacy-owned policies, never retention periods chosen by UI. */
export const FEEDBACK_REQUIRED_POLICY_KEYS = [
  "submissionRetention",
  "attachmentRetention",
  "followUpRetention",
  "deletionDsr",
  "incidentLegalHold",
  "aggregateLearningRetention",
] as const;
const policyKey = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
export const feedbackDataProcessingConfigurationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  policyVersion: policyKey,
  privacyOwner: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^\r\n\x00-\x1f]+$/),
  policies: z.strictObject({
    submissionRetention: policyKey,
    attachmentRetention: policyKey,
    followUpRetention: policyKey,
    deletionDsr: policyKey,
    incidentLegalHold: policyKey,
    aggregateLearningRetention: policyKey,
  }),
});
export type FeedbackDataProcessingConfiguration = z.infer<
  typeof feedbackDataProcessingConfigurationSchema
>;

/** Public state contains no owner identity, policy references or legal periods. */
export const customerFeedbackPolicySchema = z.strictObject({
  contacts: z.strictObject({
    support: z.literal(FEEDBACK_CONTACTS.support),
    security: z.literal(FEEDBACK_CONTACTS.security),
    privacy: z.literal(FEEDBACK_CONTACTS.privacy),
  }),
  attachments: z.strictObject({
    enabled: z.boolean(),
    reason: z.enum(["scanner_qualification_required", "storage_qualification_required", "validation_required"]),
    types: z.tuple([
      z.literal("image/png"),
      z.literal("image/jpeg"),
      z.literal("image/webp"),
    ]),
    maxFiles: z.literal(3),
    maxBytes: z.literal(10485760),
  }).superRefine((value, context) => {
    if (value.enabled !== (value.reason === "validation_required"))
      context.addIssue({ code: "custom", message: "Image intake availability must match its validation state" });
  }),
  retention: z.strictObject({
    status: z.enum([
      "owner_decision_required",
      "configured_execution_unqualified",
    ]),
  }),
  ga: z.strictObject({
    allowed: z.literal(false),
    reason: z.literal("data_processing_qualification_required"),
  }),
});
