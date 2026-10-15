import { z } from "zod";
import { ACTIVATION_STEPS } from "./activation.js";

export const EXPERIENCE_OBSERVATION_RETENTION_DAYS = 35;
export const EXPERIENCE_OBSERVATION_DAILY_LIMIT = 128;
export const EXPERIENCE_OBSERVATION_CONTRACT_ID = "aw.local-experience-observations.v1";
/** Processing-purpose metadata shipped with the strict executable schemas.
 * This is separate from first-party outbound Paperclip telemetry. */
export const EXPERIENCE_OBSERVATION_PROCESSING = Object.freeze({
  contractId: EXPERIENCE_OBSERVATION_CONTRACT_ID,
  purpose: "Optional personal UI observations for local experience review",
  storage: "instance_database",
  recipients: "current_person_only",
  transfer: "none",
  consent: "explicit_per_person_per_company",
  retentionDays: EXPERIENCE_OBSERVATION_RETENTION_DAYS,
  commandReceiptRetentionDays: 1,
  dailyLimit: EXPERIENCE_OBSERVATION_DAILY_LIMIT,
  internalOwnershipKeys: ["company_id", "user_id"],
  deletion: "withdrawal_transaction_or_account_company_cascade_or_expiry_sweep",
  excluded: ["content", "names", "email", "urls", "resource_ids", "free_properties", "session_replay"],
  interpretation: "UI observations only; missing data does not establish non-use, Human effort or successful outcomes",
  eventFamily: "surface_opened / activation_step_opened / active_view_interval",
  owner: "server/src/services/experience/observations.ts",
  allowedFields: ["kind", "surface", "variant", "step", "durationBucket", "requestId", "preferenceVersion"],
  identityGranularity: "Personal per-company preference; internal ownership keys are pseudonymous, not anonymous",
  tenantCompanyScope: "Exactly one current company and person; no cross-person or cross-company aggregation",
  dataClassification: "Company-confidential metadata",
  collectionSource: "Explicitly opted-in built UI; visible-view intervals do not establish Human effort",
  processorOrSink: "Existing instance PostgreSQL only; no analytics provider or Paperclip telemetry endpoint",
  processingRegion: "Existing deployment; no additional region or residency claim",
  accessPolicy: "Current verified active company member reads own aggregates; authenticated person can inspect/withdraw own choice after company access loss",
  sampling: "At most 128 retained new observations per person/company rolling day; duplicates free; failure drops sample without retry",
  retentionTrigger: "Server receipt timestamp",
  retentionRule: "35-day observations, 1-day immutable command receipts; expired reads suppressed and bounded background deletion independent of rollout",
  deletionAndRightsBehavior: "Withdrawal transaction deletes own observations; Original account/company final deletion cascades; own summary provides access without content or other principals",
  backupOrExportBehavior: "No new export or backup sink; deployment backup and restore policy remains the Original operator responsibility",
  redactionOrHashing: "Strict finite allowlist and coarse buckets; requestHash binds only validated allowed metadata; privacy-purpose HTTP logging hides bodies and identifiers",
  tests: ["packages/shared/src/experience-observations.test.ts", "server/src/__tests__/experience-observations.integration.test.ts",
    "server/src/__tests__/v9-private-http-logging.test.ts", "ui/src/components/ExperienceObservationSettings.test.tsx",
    "ui/src/components/ExperienceObservationCollector.test.tsx", "tests/e2e/aw-v9-local-observations.spec.ts"],
  reviewTriggers: ["new field or family", "new sink or export", "identity or access change", "retention or sampling change", "session replay", "outcome or Human effort interpretation"],
} as const);
export const EXPERIENCE_OBSERVATION_KINDS = ["surface_opened", "activation_step_opened", "active_view_interval"] as const;
export const EXPERIENCE_OBSERVATION_SURFACES = ["home", "needs_you", "activation", "agents", "workflow", "maintenance_history", "support", "other"] as const;
export const experienceObservationDurationSchema = z.enum(["under_minute", "one_to_five_minutes", "five_to_fifteen_minutes", "fifteen_to_thirty_minutes", "over_thirty_minutes"]);
const observationDataSchema = z.strictObject({
  kind: z.enum(EXPERIENCE_OBSERVATION_KINDS),
  surface: z.enum(EXPERIENCE_OBSERVATION_SURFACES),
  variant: z.enum(["streamlined", "classic"]),
  step: z.enum(ACTIVATION_STEPS).nullable(),
  durationBucket: experienceObservationDurationSchema.nullable(),
});
function consistentObservation(value: z.infer<typeof observationDataSchema>, ctx: z.RefinementCtx) {
  if ((value.kind === "activation_step_opened") !== (value.step !== null) ||
    (value.step !== null && value.surface !== "activation") ||
    (value.kind === "active_view_interval") !== (value.durationBucket !== null))
    ctx.addIssue({ code: "custom", message: "Inconsistent experience observation" });
}
export const experienceObservationSchema = observationDataSchema.extend({ requestId: z.uuid(),
  preferenceVersion: z.number().int().positive().max(2147483647),
}).superRefine(consistentObservation);
export type ExperienceObservation = z.infer<typeof experienceObservationSchema>;
export function experienceObservationDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("Invalid observation interval");
  return experienceObservationDurationSchema.parse(milliseconds < 60000 ? "under_minute" : milliseconds < 300000
    ? "one_to_five_minutes" : milliseconds < 900000 ? "five_to_fifteen_minutes" : milliseconds < 1800000 ? "fifteen_to_thirty_minutes" : "over_thirty_minutes");
}
export const experienceObservationPreferenceCommandSchema = z.strictObject({
  requestId: z.uuid(), enabled: z.boolean(), expectedVersion: z.number().int().min(0).max(2147483646).nullable(),
}).superRefine((value, ctx) => {
  if (value.enabled && value.expectedVersion === null)
    ctx.addIssue({ code: "custom", message: "Enabling observations requires the current preference version" });
});
export type ExperienceObservationPreferenceCommand = z.infer<typeof experienceObservationPreferenceCommandSchema>;
export const experienceObservationPreferenceSchema = z.strictObject({
  companyId: z.uuid(), contractId: z.literal(EXPERIENCE_OBSERVATION_CONTRACT_ID),
  enabled: z.boolean(), version: z.number().int().min(0), collectionAvailable: z.boolean(),
  retentionDays: z.literal(EXPERIENCE_OBSERVATION_RETENTION_DAYS),
  dailyLimit: z.literal(EXPERIENCE_OBSERVATION_DAILY_LIMIT), lastRequestId: z.uuid().nullable(),
});
export type ExperienceObservationPreference = z.infer<typeof experienceObservationPreferenceSchema>;
export const experienceObservationPreferenceReceiptSchema = z.strictObject({
  companyId: z.uuid(), requestId: z.uuid(), enabled: z.boolean(), version: z.number().int().positive(), observationsErased: z.boolean(),
}).refine(value => value.observationsErased === !value.enabled, "Inconsistent observation preference receipt");
export type ExperienceObservationPreferenceReceipt = z.infer<typeof experienceObservationPreferenceReceiptSchema>;
export const experienceObservationReceiptSchema = z.strictObject({ requestId: z.uuid(), status: z.enum(["recorded", "duplicate"]) });
export const experienceObservationSummarySchema = z.strictObject({
  companyId: z.uuid(), contractId: z.literal(EXPERIENCE_OBSERVATION_CONTRACT_ID), observedAt: z.iso.datetime(),
  coverage: z.literal("opt_in_observations_only"), retentionDays: z.literal(EXPERIENCE_OBSERVATION_RETENTION_DAYS),
  counts: z.array(observationDataSchema.extend({ count: z.number().int().positive() }).superRefine(consistentObservation)).max(2000),
});
