import { z } from "zod";
import { supportCaseCategorySchema, supportCaseImpactSchema, supportCaseStatusSchema } from "./customer-support.js";
import { feedbackCategorySchema, feedbackInternalStateSchema } from "./customer-feedback.js";
import { CUSTOMER_PROBLEM_EVIDENCE_SOURCES, customerProblemEvidenceProjectionBaseSchema } from "./customer-problem-evidence.js";

/** Shared classification for evidence linked to a customer problem. The
 * canonical feedback/support records remain with their existing owners. */
export const CUSTOMER_PROBLEM_AREAS = [
  "task_completion",
  "activation_first_value",
  "reliability_recovery",
  "connections_maintenance",
  "access_security_privacy",
  "support_resolution",
  "accessibility",
  "billing_procurement",
  "product_outcome",
  "other",
] as const;
export const CUSTOMER_PROBLEM_IMPACTS = ["blocked", "limited", "question", "unknown"] as const;
export { CUSTOMER_PROBLEM_EVIDENCE_SOURCES } from "./customer-problem-evidence.js";

/** A content-free pointer. Source IDs are only useful inside their company;
 * this contract grants no access to the source or target Issue. */
export const customerProblemEvidencePointerSchema = z.strictObject({
  companyId: z.uuid(),
  source: z.enum(CUSTOMER_PROBLEM_EVIDENCE_SOURCES),
  sourceId: z.uuid(),
  issueId: z.uuid(),
});

/** Authorized source-owner detail projections. Classification stays explicitly
 * unknown until a Human records it in an existing work/decision artifact. */
export const productFeedbackProblemEvidenceSchema = customerProblemEvidenceProjectionBaseSchema.extend({
  source: z.literal("product_feedback"), nativeCategory: feedbackCategorySchema,
  nativeLifecycle: feedbackInternalStateSchema, reportedImpact: z.enum(CUSTOMER_PROBLEM_IMPACTS),
  linkCoverage: z.enum(["complete", "current_page", "unavailable"]),
});
export const supportCaseProblemEvidenceSchema = customerProblemEvidenceProjectionBaseSchema.extend({
  source: z.literal("support_case"), nativeCategory: supportCaseCategorySchema,
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
  linkedIssueIds: string[]; linkCoverage: "complete" | "current_page" | "unavailable";
}): CustomerProblemEvidenceProjection {
  return customerProblemEvidenceProjectionSchema.parse({
    companyId: input.companyId, source: "product_feedback", sourceId: input.sourceId,
    nativeCategory: input.category, nativeLifecycle: input.internalState,
    reportedImpact: input.blocksWork ? "blocked" : "unknown", classification: "unknown",
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
  collection: "No new collection, survey, telemetry, or stored analytics dataset is enabled by this contract.",
  dimensions: Object.freeze({
    satisfaction: "Customer-reported or research evidence about satisfaction in a stated task and context; never inferred from activity volume or a resolved status alone.",
    effort: "Customer-reported or representative observed effort in a stated task and context; never inferred from visible time, clicks, activation setup buckets, or missing observations.",
  }),
  currentAvailability: Object.freeze({
    satisfaction: "No structured satisfaction rating is currently recorded; optional feedback and support resolution are qualitative/process proxies only.",
    effort: "No direct customer-effort measure is currently recorded by the application; activation and UI-observation buckets do not qualify as Human effort.",
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
      purpose: "Voluntary qualitative post-task evidence, not a satisfaction rating.",
      population: "Feedback voluntarily submitted under the existing product-feedback policy.",
      denominator: "Submissions only; the eligible task/invitation denominator is unavailable, so response coverage is unknown.",
      coverage: "Report source category and native triage state; no score or non-response inference.",
      consentAndAccess: "Existing feedback submission, diagnostics consent, access, retention, and erasure controls.",
      limits: "Optional feedback does not represent all customers or establish satisfaction or effort.",
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
