import {
  feedbackDataProcessingConfigurationSchema,
  type FeedbackDataProcessingConfiguration,
} from "@paperclipai/shared";
import { loadFeedbackRetentionConfiguration } from "./feedback-retention.js";

export interface FeedbackDataProcessingAdmission {
  configuration: Readonly<FeedbackDataProcessingConfiguration> | null;
  retentionStatus:
    | "owner_decision_required"
    | "configured_execution_unqualified";
  gaAllowed: false;
  retention: ReturnType<typeof loadFeedbackRetentionConfiguration>;
}

/** Startup-owned configuration. Customer requests never provide policy keys.
 * Declared keys do not qualify retention execution, legal holds, erasure,
 * protected attachments or anonymous learning. GA must remain closed until
 * those native behaviors and exact-artifact evidence are implemented. */
export function loadFeedbackDataProcessingAdmission(
  env: Readonly<Record<string, string | undefined>> = process.env,
): FeedbackDataProcessingAdmission {
  const channel = env.AW_CUSTOMER_FEEDBACK_CHANNEL ?? "preview";
  if (channel !== "preview" && channel !== "ga")
    throw new Error("Invalid customer feedback release channel");
  const raw = env.AW_FEEDBACK_DATA_PROCESSING_JSON;
  let configuration: Readonly<FeedbackDataProcessingConfiguration> | null =
    null;
  if (raw !== undefined) {
    if (Buffer.byteLength(raw, "utf8") > 16384)
      throw new Error("Invalid feedback data processing configuration");
    try {
      const parsed = feedbackDataProcessingConfigurationSchema.parse(
        JSON.parse(raw),
      );
      configuration = Object.freeze({
        ...parsed,
        policies: Object.freeze(parsed.policies),
      });
    } catch {
      // Never include private policy/owner values or parser excerpts in startup logs.
      throw new Error("Invalid feedback data processing configuration");
    }
  }
  if (channel === "ga")
    throw new Error(
      configuration
        ? "Feedback GA requires qualified native data processing behavior and release evidence"
        : "Feedback GA requires all six Privacy-owned configured policy keys",
    );
  return Object.freeze({
    configuration,
    retentionStatus: configuration
      ? "configured_execution_unqualified"
      : "owner_decision_required",
    gaAllowed: false,
    retention: loadFeedbackRetentionConfiguration(env),
  });
}
