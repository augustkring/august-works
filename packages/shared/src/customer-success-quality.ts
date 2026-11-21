import { z } from "zod";
import { supportCaseCategorySchema, supportCaseImpactSchema, supportCaseStatusSchema } from "./customer-support.js";
import { customerFeedbackQualitySummarySchema, customerFeedbackStoredExperienceMeasureSchema, feedbackCategorySchema, feedbackEffortRatingSchema, feedbackInternalStateSchema, feedbackSatisfactionRatingSchema } from "./customer-feedback.js";
import { CUSTOMER_PROBLEM_AREAS, CUSTOMER_PROBLEM_EVIDENCE_SOURCES, CUSTOMER_PROBLEM_IMPACTS, customerProblemEvidenceProjectionBaseSchema } from "./customer-problem-evidence.js";

/** Shared classification for evidence linked to a customer problem. The
 * canonical feedback/support records remain with their existing owners. */
export { CUSTOMER_PROBLEM_AREAS, CUSTOMER_PROBLEM_EVIDENCE_SOURCES, CUSTOMER_PROBLEM_IMPACTS } from "./customer-problem-evidence.js";

/** A content-free pointer. Source IDs are only useful inside their company;
 * this contract grants no access to the source or target Issue. */
export const customerProblemEvidencePointerSchema = z.strictObject({
  companyId: z.uuid(),
  source: z.enum(CUSTOMER_PROBLEM_EVIDENCE_SOURCES),
  sourceId: z.uuid(),
  issueId: z.uuid(),
});

/** Authorized source-owner detail projections. Feedback classification is an
 * explicit Human triage field; other sources stay unknown until their owners classify them. */
export const productFeedbackProblemEvidenceSchema = customerProblemEvidenceProjectionBaseSchema.extend({
  source: z.literal("product_feedback"), nativeCategory: feedbackCategorySchema,
  nativeLifecycle: feedbackInternalStateSchema, reportedImpact: z.enum(CUSTOMER_PROBLEM_IMPACTS),
  triageImpact: z.enum(CUSTOMER_PROBLEM_IMPACTS).optional(),
  linkCoverage: z.enum(["complete", "current_page", "unavailable"]),
});
export const supportCaseProblemEvidenceSchema = customerProblemEvidenceProjectionBaseSchema.extend({
  source: z.literal("support_case"), classification: z.literal("unknown"), nativeCategory: supportCaseCategorySchema,
  nativeLifecycle: supportCaseStatusSchema, reportedImpact: z.enum(CUSTOMER_PROBLEM_IMPACTS),
  linkedIssueIds: z.array(z.uuid()).max(1), linkCoverage: z.enum(["complete", "unavailable"]),
});
export const customerProblemEvidenceProjectionSchema = z.discriminatedUnion("source", [
  productFeedbackProblemEvidenceSchema,
  supportCaseProblemEvidenceSchema,
]);
export type CustomerProblemEvidenceProjection = z.infer<typeof customerProblemEvidenceProjectionSchema>;

export function projectFeedbackProblemEvidence(input: {
  companyId: string; sourceId: string; category: z.infer<typeof feedbackCategorySchema>;
  internalState: z.infer<typeof feedbackInternalStateSchema>; blocksWork: boolean;
  classification?: (typeof CUSTOMER_PROBLEM_AREAS)[number]; triageImpact?: (typeof CUSTOMER_PROBLEM_IMPACTS)[number];
  linkedIssueIds: string[]; linkCoverage: "complete" | "current_page" | "unavailable";
}): CustomerProblemEvidenceProjection {
  return customerProblemEvidenceProjectionSchema.parse({
    companyId: input.companyId, source: "product_feedback", sourceId: input.sourceId,
    nativeCategory: input.category, nativeLifecycle: input.internalState,
    reportedImpact: input.blocksWork ? "blocked" : "unknown", classification: input.classification ?? "unknown",
    ...(input.triageImpact ? { triageImpact: input.triageImpact } : {}),
    linkedIssueIds: input.linkedIssueIds, linkCoverage: input.linkCoverage,
  });
}

export function projectSupportProblemEvidence(input: {
  companyId: string; sourceId: string; category: z.infer<typeof supportCaseCategorySchema>;
  status: z.infer<typeof supportCaseStatusSchema>; impact: z.infer<typeof supportCaseImpactSchema> | null;
  linkedIssueId: string | null; linkCoverage: "complete" | "unavailable";
}): CustomerProblemEvidenceProjection {
  return customerProblemEvidenceProjectionSchema.parse({
    companyId: input.companyId, source: "support_case", sourceId: input.sourceId,
    nativeCategory: input.category, nativeLifecycle: input.status,
    reportedImpact: input.impact ?? "unknown", classification: "unknown",
    linkedIssueIds: input.linkedIssueId ? [input.linkedIssueId] : [], linkCoverage: input.linkCoverage,
  });
}

export const CUSTOMER_SUCCESS_MEASUREMENT_PACK = Object.freeze({
  id: "aw.customer-success-quality.v1",
  owner: "August Works product and privacy; each canonical source retains its existing owner",
  collection: "Optional satisfaction and effort ratings are collected only in the existing Feedback flow after explicit consent; this pack enables no passive telemetry or separate analytics dataset.",
  dimensions: Object.freeze({
    satisfaction: "Customer-reported or research evidence about satisfaction in a stated task and context; never inferred from activity volume or a resolved status alone.",
    effort: "Customer-reported or representative observed effort in a stated task and context; never inferred from visible time, clicks, activation setup buckets, or missing observations.",
  }),
  currentAvailability: Object.freeze({
    satisfaction: "Optional product-feedback respondents can report a structured task satisfaction rating after explicit consent; support has no post-resolution rating yet.",
    effort: "Optional product-feedback respondents can report a structured task effort rating after explicit consent; activation and UI-observation buckets are not Human effort.",
  }),
  proxies: Object.freeze([
    Object.freeze({
      id: "activation_first_value",
      source: "packages/shared/src/experience-measures.ts",
      purpose: "First-value outcome context; not satisfaction or Human effort.",
      population: "Current original onboarding owner with current company/source authority.",
      denominator: "Owners with an eligible activation-source read; report verified, not_recorded, and withdrawn states separately.",
      coverage: "Read coverage only; no response rate or cross-company aggregate is available.",
      consentAndAccess: "Existing original-owner source authorization; current withdrawal and erasure behavior suppresses measures.",
      limits: "The usable-account baseline is unavailable; setup buckets are not Human effort.",
    }),
    Object.freeze({
      id: "optional_product_feedback",
      source: "packages/shared/src/customer-feedback.ts",
      purpose: "Voluntary qualitative evidence with optional direct satisfaction and effort ratings.",
      population: "Feedback voluntarily submitted under the existing product-feedback policy.",
      denominator: "Current submissions carrying the optional-question offer marker; count consented, withdrawn and unconsented submissions separately. No task/invitation denominator exists.",
      coverage: "Report offered submissions and consented response counts separately from satisfaction and effort distributions; withdrawn ratings are removed.",
      consentAndAccess: "Ratings require separate explicit consent; the submitter can withdraw them in My feedback. Existing source access, retention, and erasure controls apply.",
      limits: "Feedback respondents are self-selected and do not represent all customers or tasks; no population response rate is available.",
    }),
    Object.freeze({
      id: "support_case_resolution",
      source: "packages/shared/src/customer-support.ts",
      purpose: "Support process outcome and unresolved need context, not product satisfaction.",
      population: "Cases opened under the existing support disclosure and data policy.",
      denominator: "Cases in the reviewed period; distinguish resolved, closed, open, and unavailable source coverage.",
      coverage: "Case lifecycle coverage only; no post-resolution rating or customer-effort value is currently recorded.",
      consentAndAccess: "Existing support-case visibility, disclosure, retention, erasure, and company scope.",
      limits: "Resolution status alone is not satisfaction; no support minutes are inferred.",
    }),
  ]),
  additionalEvidence: Object.freeze([
    "Representative research and task-success findings may be used only with their study context, participant/coverage denominator, and existing research governance.",
    "Connection/maintenance failures, incidents, accessibility findings, procurement friction, churn reasons, and business outcomes stay with their source owners; unavailable sources remain unavailable.",
  ]),
  interpretation: Object.freeze([
    "Keep satisfaction, effort, task success, activation, support resolution, and optional feedback as separate evidence dimensions.",
    "Show period, population, denominator, observed coverage, source and missing/withdrawn/unavailable states with each measure.",
    "Do not compute a composite customer-quality score, infer silence as satisfaction, or treat message volume or employee behavior as quality.",
    "A complaint remains a complaint through classification and Issue/Decision/Learning handoff; acknowledge, retain the customer need, investigate, communicate, resolve/close, and review recurrence under existing owners.",
  ]),
} as const);

export type CustomerProblemEvidencePointer = z.infer<typeof customerProblemEvidencePointerSchema>;

/** Counts only explicitly offered submissions; dimensions retain separate
 * denominators and distributions. No composite score or missingness inference. */
export function summarizeCustomerFeedbackMeasures(input: {
  from: string; to: string;
  submissions: readonly { experienceMeasure?: z.infer<typeof customerFeedbackStoredExperienceMeasureSchema> }[];
}) {
  const satisfaction = Object.fromEntries(feedbackSatisfactionRatingSchema.options.map(value => [value, 0])) as Record<z.infer<typeof feedbackSatisfactionRatingSchema>, number>;
  const effort = Object.fromEntries(feedbackEffortRatingSchema.options.map(value => [value, 0])) as Record<z.infer<typeof feedbackEffortRatingSchema>, number>;
  let offeredFeedbackSubmissions = 0, consentedResponses = 0, withdrawnResponses = 0, unavailableResponses = 0;
  for (const { experienceMeasure } of input.submissions) {
    if (!experienceMeasure?.offered) continue;
    offeredFeedbackSubmissions++;
    if (experienceMeasure.availability === "withdrawn") { withdrawnResponses++; continue; }
    if (experienceMeasure.availability === "unavailable") { unavailableResponses++; continue; }
    if (experienceMeasure.consent !== "granted") continue;
    consentedResponses++;
    if (experienceMeasure.satisfaction) satisfaction[experienceMeasure.satisfaction]++;
    if (experienceMeasure.effort) effort[experienceMeasure.effort]++;
  }
  const result = customerFeedbackQualitySummarySchema.parse({
    period: { from: input.from, to: input.to }, source: "product_feedback",
    denominator: { offeredFeedbackSubmissions, consentedResponses, withdrawnResponses, unconsentedSubmissions: offeredFeedbackSubmissions - consentedResponses - withdrawnResponses - unavailableResponses, unavailableResponses },
    satisfaction: { count: Object.values(satisfaction).reduce((a, b) => a + b, 0), distribution: satisfaction },
    effort: { count: Object.values(effort).reduce((a, b) => a + b, 0), distribution: effort },
  });
  return result;
}
