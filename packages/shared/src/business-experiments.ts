import { z } from "zod";

const id = z.string().uuid(), prose = z.string().trim().min(10).max(2000);
const metric = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), name: z.string().trim().min(3).max(160),
  metricId: id, metricVersionId: id, outcome: z.literal("binary"),
  successDefinition: prose,
}).strict();

/** A deliberately bounded, individual two-arm binary experiment protocol.
 * Other designs/methods require a separately qualified provider; no generic
 * numerical JSON or manually pasted result is a public analysis input. */
export const businessExperimentDefinitionSchema = z.object({
  name: z.string().trim().min(3).max(160), hypothesis: prose, decisionQuestion: prose,
  decisionId: id.nullable(), ownerUserId: z.string().trim().min(1).max(200),
  scope: z.discriminatedUnion("type", [z.object({ type: z.literal("company"), id: z.null() }).strict(), z.object({ type: z.literal("project"), id }).strict()]),
  design: z.literal("individual_randomized_two_arm_binary"),
  population: z.object({ randomizationUnit: z.enum(["issue", "project"]), eligibility: prose, trigger: prose, externalValidityLimits: prose }).strict(),
  treatment: prose, control: prose,
  assignment: z.object({ method: z.literal("hmac_sha256_48_v1"), treatmentProbability: z.number().finite().min(0.1).max(0.9) }).strict(),
  primaryMetric: metric.extend({ beneficialDirection: z.enum(["increase", "decrease"]), minimumMeaningfulEffect: z.number().finite().positive().max(1) }).strict(),
  secondaryMetrics: z.array(metric).max(8),
  guardrailMetrics: z.array(metric.extend({ harmfulDirection: z.enum(["increase", "decrease"]), maximumAcceptableHarm: z.number().finite().min(0).max(1) }).strict()).min(1).max(8),
  diagnostics: z.object({ srmAlpha: z.number().finite().min(0.0001).max(0.05), invariantMetricRefs: z.array(id).min(1).max(8), concurrentExperimentAndInterferencePlan: prose, telemetryAndJoinPlan: prose }).strict(),
  analysisPlan: z.object({ method: z.literal("bonferroni_clopper_pearson_difference_v1"), familywiseAlpha: z.number().finite().min(0.001).max(0.2), estimand: z.literal("intention_to_treat"), missingOutcomes: z.literal("invalidate"), multipleComparisonPolicy: z.literal("primary_and_guardrails_familywise_secondary_exploratory"), noveltySeasonalityCarryoverLimits: prose }).strict(),
  sampleOrDurationPlan: z.object({ kind: z.literal("fixed_horizon"), from: z.iso.datetime(), until: z.iso.datetime(), minimumAssignedUnits: z.number().int().min(4).max(4000), maximumAssignedUnits: z.number().int().min(4).max(4000), minimumUnitsPerArm: z.number().int().min(2).max(2000), minimumDetectableEffect: z.number().finite().positive().max(1), powerRationale: prose }).strict(),
  stopRules: z.object({ efficacyLooks: z.literal("one_after_fixed_horizon"), emergencySafetyStop: prose, shipPolicy: prose, rollbackPolicy: prose }).strict(),
  ethics: z.object({ affectedPopulation: prose, personImpact: z.enum(["none", "customers"]), legalBasisRationale: prose, requiresConsent: z.boolean(), consentGovernanceObligationRef: id.nullable(), darkPatterns: z.literal(false), hiddenEmploymentManipulation: z.literal(false), changesMaterialAiDecisions: z.boolean(), aiUseCaseId: id.nullable(), fairnessConstraints: prose }).strict(),
  sensitivity: z.enum(["internal", "confidential"]), purpose: z.literal("management_intelligence"),
  governanceObligationRefs: z.array(id).min(1).max(16), retentionDays: z.number().int().min(1).max(3650),
}).strict().superRefine((value, ctx) => {
  const reject = (message: string) => ctx.addIssue({ code: "custom", message });
  const metrics = [value.primaryMetric, ...value.secondaryMetrics, ...value.guardrailMetrics];
  if (new Set(metrics.map(item => item.key)).size !== metrics.length || new Set(metrics.map(item => item.metricId)).size !== metrics.length) reject("Experiment metric roles require distinct keys and pinned native metrics");
  if (new Set(value.governanceObligationRefs).size !== value.governanceObligationRefs.length || new Set(value.diagnostics.invariantMetricRefs).size !== value.diagnostics.invariantMetricRefs.length) reject("Governance/diagnostic pins cannot repeat");
  if (value.diagnostics.invariantMetricRefs.some(ref => metrics.some(item => item.metricId === ref))) reject("An outcome metric cannot also be a pretreatment invariant");
  if (metrics.some(item => /^invariant_[1-8]$/.test(item.key))) reject("Invariant receipt keys are reserved");
  const plan = value.sampleOrDurationPlan;
  if (Date.parse(plan.from) >= Date.parse(plan.until) || Date.parse(plan.until) - Date.parse(plan.from) > 365 * 86400000) reject("Fixed horizon must be ordered and at most one year");
  if (plan.minimumAssignedUnits > plan.maximumAssignedUnits || plan.minimumUnitsPerArm * 2 > plan.minimumAssignedUnits) reject("Sample policy must support both arms within the bounded plan");
  if (value.ethics.requiresConsent && !value.ethics.consentGovernanceObligationRef) reject("Required consent must bind reviewed native governance evidence");
  if (value.ethics.changesMaterialAiDecisions && !value.ethics.aiUseCaseId) reject("Material AI changes require the existing governed AI use case");
  if (!value.ethics.requiresConsent && value.ethics.consentGovernanceObligationRef !== null || !value.ethics.changesMaterialAiDecisions && value.ethics.aiUseCaseId !== null) reject("Unused consent/AI governance pins must be null");
});
export type BusinessExperimentDefinition = z.infer<typeof businessExperimentDefinitionSchema>;
export const BUSINESS_EXPERIMENT_STATES = ["draft", "in_review", "ready", "running", "paused", "completed", "analyzing", "decided", "inconclusive", "invalid", "cancelled"] as const;
export type BusinessExperimentState = typeof BUSINESS_EXPERIMENT_STATES[number];
export const BUSINESS_EXPERIMENT_TRANSITIONS: Record<BusinessExperimentState, readonly BusinessExperimentState[]> = {
  draft: ["in_review", "cancelled"], in_review: ["draft", "ready", "cancelled"], ready: ["in_review", "running", "cancelled"],
  running: ["paused", "completed", "cancelled"], paused: ["running", "completed", "cancelled"], completed: ["analyzing"],
  analyzing: ["decided", "inconclusive", "invalid"], decided: [], inconclusive: [], invalid: [], cancelled: [],
};
export const createBusinessExperimentSchema = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/), definition: businessExperimentDefinitionSchema }).strict();
export const amendBusinessExperimentSchema = z.object({ expectedRevision: z.number().int().positive(), definition: businessExperimentDefinitionSchema, reason: prose }).strict();
export const transitionBusinessExperimentSchema = z.object({ expectedRevision: z.number().int().positive(), versionId: id, state: z.enum(BUSINESS_EXPERIMENT_STATES), rationale: prose }).strict();
export const analyzeBusinessExperimentSchema = z.object({ expectedRevision: z.number().int().positive(), versionId: id }).strict();

export interface BusinessExperimentMetricPin {
  key: string; role: "primary" | "guardrail" | "exploratory" | "invariant";
  metricId: string; metricVersionId: string; contentHash: string;
}
export interface BusinessExperimentView {
  id: string; companyId: string; key: string; revision: number;
  state: BusinessExperimentState; currentVersionId: string | null;
  createdBy: string; createdAt: string; updatedAt: string;
}
export interface BusinessExperimentVersionView {
  id: string; companyId: string; experimentId: string; revision: number;
  definition: BusinessExperimentDefinition; contentHash: string;
  metricPins: BusinessExperimentMetricPin[]; amendmentReason: string;
  createdBy: string; createdAt: string; expiresAt: string;
  currentQualification: "current" | "needs_revalidation";
}
export interface BusinessExperimentTransitionView {
  id: string; companyId: string; experimentId: string; versionId: string;
  revision: number; fromState: BusinessExperimentState; toState: BusinessExperimentState;
  rationale: string; createdBy: string; createdAt: string;
}

/** INTERNAL capture only. The native owner must prove registration, source
 * authority, immutable assignment/exposure/outcome receipts and complete logs.
 * These structures never constitute a public permission/telemetry claim. */
export interface NativeBusinessExperimentCapture {
  versionId: string; definitionHash: string; registeredAt: string; reviewedAt: string;
  completedAt: string; analyzedAt: string; completionReason: "fixed_horizon" | "emergency_safety_stop" | "cancelled";
  integrity: { assignmentLogComplete: boolean; exposureLogComplete: boolean; telemetryComplete: boolean; joinIntegrity: boolean; invariantsPassed: boolean; interferenceAdmitted: boolean };
  units: {
    unitId: string; unitSourceHash: string; arm: "control" | "treatment"; assignedAt: string; assignmentReceiptHash: string;
    exposure: { arm: "control" | "treatment"; exposedAt: string; receiptHash: string } | null;
    outcomes: { key: string; metricId: string; metricVersionId: string; observationId: string; sourceHash: string; from: string; until: string; observedAt: string; value: 0 | 1 }[];
  }[];
}
export interface NativeBusinessExperimentMetricResult {
  key: string; role: "primary" | "guardrail" | "exploratory";
  control: { units: number; successes: number; rate: number };
  treatment: { units: number; successes: number; rate: number };
  effect: number;
  interval: { lower: number; upper: number; method: "bonferroni_clopper_pearson_difference_v1"; familywiseCoverage: number } | null;
  interpretation: "threshold_met" | "threshold_not_met" | "harm_excluded" | "harm_detected" | "uncertain" | "exploratory";
}
export interface NativeBusinessExperimentResult {
  engineVersion: "aw-native-business-experiment-v1"; definitionHash: string; inputHash: string;
  status: "pass" | "fail" | "inconclusive" | "invalid"; numericallyQualified: boolean;
  reasons: string[];
  diagnostics: { assigned: number; control: number; treatment: number; exposed: number; srm: { method: "exact_binomial_probability_ordering_v1"; expectedTreatmentProbability: number; pValue: number; threshold: number; mismatch: boolean } | null };
  metrics: NativeBusinessExperimentMetricResult[]; limitations: string[];
}
