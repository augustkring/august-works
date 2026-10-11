import { z } from "zod";

/** House defaults selected by the product owner. These are configurable
 * lifecycle limits, not a statement that every jurisdiction requires them. */
export const FEEDBACK_RETENTION_DEFAULTS = Object.freeze({
  closedFeedbackDays: 90,
  imageDays: 30,
  openFeedbackMonths: 12,
});
export const feedbackRetentionConfigurationSchema = z.strictObject({
  closedFeedbackDays: z.number().int().min(1).max(3650),
  imageDays: z.number().int().min(1).max(3650),
  openFeedbackMonths: z.number().int().min(1).max(120),
});
export type FeedbackRetentionConfiguration = z.infer<typeof feedbackRetentionConfigurationSchema>;
