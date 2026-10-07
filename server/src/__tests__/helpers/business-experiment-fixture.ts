import { businessExperimentDefinitionSchema } from "@paperclipai/shared";
export function experimentDefinition(policyId: string, metrics: { id: string; versionId: string }[]) {
  const prose = "Explicit human synthetic fixture for native source-owner software qualification only.";
  const metric = (key: string, index: number) => ({ key, name: `${key} binary outcome`, metricId: metrics[index].id, metricVersionId: metrics[index].versionId, outcome: "binary", successDefinition: prose });
  return businessExperimentDefinitionSchema.parse({
    name: "Native business-object process experiment", hypothesis: prose, decisionQuestion: prose, decisionId: null, ownerUserId: "local-board",
    scope: { type: "company", id: null }, design: "individual_randomized_two_arm_binary", population: { randomizationUnit: "issue", eligibility: prose, trigger: prose, externalValidityLimits: prose },
    treatment: prose, control: prose, assignment: { method: "hmac_sha256_48_v1", treatmentProbability: 0.5 },
    primaryMetric: { ...metric("primary", 0), beneficialDirection: "increase", minimumMeaningfulEffect: 0.1 }, secondaryMetrics: [],
    guardrailMetrics: [{ ...metric("harm", 1), harmfulDirection: "increase", maximumAcceptableHarm: 0.1 }],
    diagnostics: { srmAlpha: 0.001, invariantMetricRefs: [metrics[2].id], concurrentExperimentAndInterferencePlan: prose, telemetryAndJoinPlan: prose },
    analysisPlan: { method: "bonferroni_clopper_pearson_difference_v1", familywiseAlpha: 0.05, estimand: "intention_to_treat", missingOutcomes: "invalidate", multipleComparisonPolicy: "primary_and_guardrails_familywise_secondary_exploratory", noveltySeasonalityCarryoverLimits: prose },
    sampleOrDurationPlan: { kind: "fixed_horizon", from: new Date(Date.now() + 86400000).toISOString(), until: new Date(Date.now() + 2 * 86400000).toISOString(), minimumAssignedUnits: 20, maximumAssignedUnits: 100, minimumUnitsPerArm: 2, minimumDetectableEffect: 0.1, powerRationale: prose },
    stopRules: { efficacyLooks: "one_after_fixed_horizon", emergencySafetyStop: prose, shipPolicy: prose, rollbackPolicy: prose },
    ethics: { affectedPopulation: prose, personImpact: "none", legalBasisRationale: prose, requiresConsent: false, consentGovernanceObligationRef: null, darkPatterns: false, hiddenEmploymentManipulation: false, changesMaterialAiDecisions: false, aiUseCaseId: null, fairnessConstraints: prose },
    sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [policyId], retentionDays: 30,
  });
}
