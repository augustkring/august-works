import { z } from "zod";

/** A separate local read purpose. No generic telemetry event or provider export
 * is emitted by this contract; original canonical retention still applies. */
export const ACTIVATION_MEASUREMENT_CONTRACT = Object.freeze({
  id: "aw.activation-owner-measures.v1",
  eventFamily: "activation_first_value_metadata",
  owner: "August Works product and privacy",
  decisionOrProductPurpose: "Inspect the current onboarding owner's recorded setup transitions and time to independently verified output.",
  allowedFields: Object.freeze(["companyId", "observedAt", "contractId", "status", "creationToVerificationBucket", "recordedSetupChangesBucket", "setupWindow", "usableBaseline"]),
  prohibitedFields: Object.freeze(["User identity", "Task/run/result/receipt IDs", "Names", "Prompts", "Model output", "Documents", "Secrets", "Credentials", "Private error prose", "Arbitrary properties"]),
  identityGranularity: "Current original onboarding owner; identity is not included in the payload.",
  tenantCompanyScope: "One currently authorized company; no cross-company aggregate.",
  dataClassification: "Company-confidential metadata",
  collectionSource: "Current original onboarding, independent verification and bounded native Activity Log receipts",
  processorOrSink: "Native private read response only; no new stored analytics dataset or provider export",
  processingRegion: "The existing deployment; no additional region or residency claim",
  accessPolicy: "Original verified account/onboarding owner plus current native source and company authority",
  sampling: "Explicit current-owner read; no automatic event collection or session replay",
  retentionTrigger: "Response lifetime",
  retentionRule: "Projection is not stored; original source owners retain their existing rules",
  deletionAndRightsBehavior: "Current source erasure, access loss and withdrawal suppress prior measures; no separate dataset needs erasure",
  backupOrExportBehavior: "No new analytics backup or export; canonical source backups retain their original governed behavior",
  redactionOrHashing: "Allow-list and bucketization; no raw source content or pseudonymous user identifier",
  tests: Object.freeze(["Strict shared allow-list and bucket bounds", "Native owner/current verification and source withdrawal", "Company/account cancellation fence", "Private HTTP log minimization", "Localized UI source/session refresh"]),
  reviewTriggers: Object.freeze(["New field or family", "Collection or retention", "Provider/sink/export", "Identity/scope/access change", "Session replay", "Usable-account baseline definition"]),
});
export const experienceDurationBucketSchema = z.enum(["under_minute", "one_to_five_minutes", "five_to_thirty_minutes", "thirty_minutes_to_two_hours", "two_hours_to_day", "over_day"]);
export const experienceSetupBucketSchema = z.enum(["none", "one", "two_to_five", "six_to_ten", "eleven_to_thirty", "over_thirty"]);

/** Quantization thresholds describe the measurement; they are not UX targets. */
export function experienceDurationBucket(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("Invalid native measurement duration");
  if (milliseconds < 60000) return "under_minute" as const;
  if (milliseconds < 300000) return "one_to_five_minutes" as const;
  if (milliseconds < 1800000) return "five_to_thirty_minutes" as const;
  if (milliseconds < 7200000) return "thirty_minutes_to_two_hours" as const;
  if (milliseconds < 86400000) return "two_hours_to_day" as const;
  return "over_day" as const;
}
export function experienceSetupBucket(count: number) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 128) throw new Error("Invalid native measurement count");
  if (!count) return "none" as const;
  if (count === 1) return "one" as const;
  if (count <= 5) return "two_to_five" as const;
  if (count <= 10) return "six_to_ten" as const;
  if (count <= 30) return "eleven_to_thirty" as const;
  return "over_thirty" as const;
}
export const experienceMeasuresSchema = z.strictObject({
  companyId: z.uuid(),
  observedAt: z.iso.datetime(),
  contractId: z.literal(ACTIVATION_MEASUREMENT_CONTRACT.id),
  status: z.enum(["verified", "not_recorded", "withdrawn"]),
  creationToVerificationBucket: experienceDurationBucketSchema.nullable(),
  recordedSetupChangesBucket: experienceSetupBucketSchema.nullable(),
  setupWindow: z.enum(["complete", "bounded", "not_applicable"]),
  // Company creation does not prove the commercial/runtime usable-account baseline.
  usableBaseline: z.literal("unavailable"),
}).superRefine((view, ctx) => {
  if ((view.status === "verified") !== (view.creationToVerificationBucket !== null) ||
    (view.status !== "verified" && (view.recordedSetupChangesBucket !== null || view.setupWindow !== "not_applicable")) ||
    (view.status === "verified" && view.setupWindow === "not_applicable") ||
    (view.setupWindow === "complete" && view.recordedSetupChangesBucket === null) ||
    (view.setupWindow === "bounded" && view.recordedSetupChangesBucket !== null))
    ctx.addIssue({ code: "custom", message: "Inconsistent native experience measurement" });
});
export type ExperienceMeasures = z.infer<typeof experienceMeasuresSchema>;
