import { describe, expect, it } from "vitest";
import { businessExperimentDefinitionSchema, analyzeBusinessExperimentSchema, amendBusinessExperimentSchema, transitionBusinessExperimentSchema, BUSINESS_EXPERIMENT_TRANSITIONS } from "./business-experiments.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const prose = "An explicit human test declaration with no operational calibration claim.";
function protocol() {
  const metric = (key: string, n: number) => ({ key, name: "Observed binary outcome", metricId: id(n), metricVersionId: id(n + 1), outcome: "binary", successDefinition: prose });
  return {
    name: "Human controlled business experiment", hypothesis: prose, decisionQuestion: prose, decisionId: null, ownerUserId: "human",
    scope: { type: "company", id: null }, design: "individual_randomized_two_arm_binary", population: { randomizationUnit: "issue", eligibility: prose, trigger: prose, externalValidityLimits: prose },
    treatment: prose, control: prose, assignment: { method: "hmac_sha256_48_v1", treatmentProbability: 0.5 },
    primaryMetric: { ...metric("primary", 10), beneficialDirection: "increase", minimumMeaningfulEffect: 0.1 }, secondaryMetrics: [],
    guardrailMetrics: [{ ...metric("harm", 20), harmfulDirection: "increase", maximumAcceptableHarm: 0.1 }],
    diagnostics: { srmAlpha: 0.001, invariantMetricRefs: [id(30)], concurrentExperimentAndInterferencePlan: prose, telemetryAndJoinPlan: prose },
    analysisPlan: { method: "bonferroni_clopper_pearson_difference_v1", familywiseAlpha: 0.05, estimand: "intention_to_treat", missingOutcomes: "invalidate", multipleComparisonPolicy: "primary_and_guardrails_familywise_secondary_exploratory", noveltySeasonalityCarryoverLimits: prose },
    sampleOrDurationPlan: { kind: "fixed_horizon", from: "2026-01-01T00:00:00Z", until: "2026-02-01T00:00:00Z", minimumAssignedUnits: 20, maximumAssignedUnits: 100, minimumUnitsPerArm: 2, minimumDetectableEffect: 0.1, powerRationale: prose },
    stopRules: { efficacyLooks: "one_after_fixed_horizon", emergencySafetyStop: prose, shipPolicy: prose, rollbackPolicy: prose },
    ethics: { affectedPopulation: prose, personImpact: "none", legalBasisRationale: prose, requiresConsent: false, consentGovernanceObligationRef: null, darkPatterns: false, hiddenEmploymentManipulation: false, changesMaterialAiDecisions: false, aiUseCaseId: null, fairnessConstraints: prose },
    sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [id(40)], retentionDays: 30,
  };
}
describe("strict business experiment protocol", () => {
  it("admits explicit supported pre-registration and rejects unqualified designs, peeking or copied authority", () => {
    const d = protocol(); expect(businessExperimentDefinitionSchema.safeParse(d).success).toBe(true);
    for (const alternative of [{ ...d, design: "switchback" }, { ...d, approved: true }, { ...d, result: "pass" }, { ...d, assignment: { ...d.assignment, seed: 123 } }, { ...d, stopRules: { ...d.stopRules, efficacyLooks: "every_day" } }, { ...d, analysisPlan: { ...d.analysisPlan, missingOutcomes: "drop" } }]) expect(businessExperimentDefinitionSchema.safeParse(alternative).success).toBe(false);
  });
  it("requires reviewed consent/material AI pins and rejects hidden manipulation or dark patterns", () => {
    const d = protocol();
    for (const ethics of [{ ...d.ethics, darkPatterns: true }, { ...d.ethics, hiddenEmploymentManipulation: true }, { ...d.ethics, requiresConsent: true }, { ...d.ethics, changesMaterialAiDecisions: true }, { ...d.ethics, personImpact: "workers" }]) expect(businessExperimentDefinitionSchema.safeParse({ ...d, ethics }).success).toBe(false);
    expect(businessExperimentDefinitionSchema.safeParse({ ...d, ethics: { ...d.ethics, requiresConsent: true, consentGovernanceObligationRef: id(41), changesMaterialAiDecisions: true, aiUseCaseId: id(42) } }).success).toBe(true);
  });
  it("pins distinct primary/guardrail roles, bounded sample/horizon and complete required safeguards", () => {
    const d = protocol();
    for (const value of [{ ...d, guardrailMetrics: [] }, { ...d, guardrailMetrics: [{ ...d.guardrailMetrics[0], metricId: d.primaryMetric.metricId }] }, { ...d, governanceObligationRefs: [id(40), id(40)] }, { ...d, diagnostics: { ...d.diagnostics, invariantMetricRefs: [] } }, { ...d, assignment: { ...d.assignment, treatmentProbability: 1 } }, { ...d, sampleOrDurationPlan: { ...d.sampleOrDurationPlan, until: d.sampleOrDurationPlan.from } }, { ...d, sampleOrDurationPlan: { ...d.sampleOrDurationPlan, minimumUnitsPerArm: 11 } }, { ...d, sampleOrDurationPlan: { ...d.sampleOrDurationPlan, maximumAssignedUnits: 4001 } }]) expect(businessExperimentDefinitionSchema.safeParse(value).success).toBe(false);
  });
  it("separates pretreatment invariants and rejects unused or ambiguous governance identities", () => {
    const d = protocol();
    for (const value of [
      { ...d, diagnostics: { ...d.diagnostics, invariantMetricRefs: [d.primaryMetric.metricId] } },
      { ...d, primaryMetric: { ...d.primaryMetric, key: "invariant_1" } },
      { ...d, ethics: { ...d.ethics, consentGovernanceObligationRef: id(41) } },
      { ...d, ethics: { ...d.ethics, aiUseCaseId: id(42) } },
    ]) expect(businessExperimentDefinitionSchema.safeParse(value).success).toBe(false);
  });
  it("keeps public analysis and lifecycle commands free of pasted facts, approvals or result JSON", () => {
    const command = { expectedRevision: 1, versionId: id(50) }; expect(analyzeBusinessExperimentSchema.safeParse(command).success).toBe(true);
    for (const field of ["units", "integrity", "results", "assignmentKey", "primaryMetric", "numericallyQualified"]) expect(analyzeBusinessExperimentSchema.safeParse({ ...command, [field]: [] }).success).toBe(false);
    expect(amendBusinessExperimentSchema.safeParse({ expectedRevision: 1, definition: protocol(), reason: prose }).success).toBe(true);
    expect(amendBusinessExperimentSchema.safeParse({ expectedRevision: 1, definition: protocol() }).success).toBe(false);
    expect(transitionBusinessExperimentSchema.safeParse({ ...command, state: "running", rationale: prose }).success).toBe(true);
    expect(BUSINESS_EXPERIMENT_TRANSITIONS.draft).not.toContain("running"); expect(BUSINESS_EXPERIMENT_TRANSITIONS.ready).toContain("running");
    expect(BUSINESS_EXPERIMENT_TRANSITIONS.decided).toEqual([]); expect(BUSINESS_EXPERIMENT_TRANSITIONS.paused).toContain("cancelled");
  });
});
