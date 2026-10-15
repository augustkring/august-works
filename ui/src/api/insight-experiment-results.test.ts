import { afterEach, expect, it, vi } from "vitest";
import { readInsightExperimentResults } from "./insight-experiment-results";
const companyId = "10000000-0000-4000-8000-000000000001", experimentId = "10000000-0000-4000-8000-000000000002", versionId = "10000000-0000-4000-8000-000000000003", analysisId = "10000000-0000-4000-8000-000000000004";
const prose = "Explicit synthetic software fixture without a collected human trial.";
const metric = (key: string, id: string) => ({ key, name: `${key} binary outcome`, metricId: id, metricVersionId: versionId, outcome: "binary", successDefinition: prose });
const definition = { name: "PRIVATE registered experiment", hypothesis: prose, decisionQuestion: prose, decisionId: null, ownerUserId: "manager-a", scope: { type: "company", id: null }, design: "individual_randomized_two_arm_binary",
  population: { randomizationUnit: "issue", eligibility: prose, trigger: prose, externalValidityLimits: prose }, treatment: prose, control: prose,
  executionPlan: { mode: "recording_only_human_attested_native_process", exposureProvenance: "human_attestation", exposureTimeSemantics: "human_asserted_event_time", outcomeTimeSemantics: "created_in_window_current_state_at_common_final_capture" }, assignment: { method: "hmac_sha256_48_v1", treatmentProbability: 0.5 },
  primaryMetric: { ...metric("primary", companyId), beneficialDirection: "increase", minimumMeaningfulEffect: 0.1 }, secondaryMetrics: [], guardrailMetrics: [{ ...metric("harm", experimentId), harmfulDirection: "increase", maximumAcceptableHarm: 0.1 }],
  diagnostics: { invariantBalance: { method: "exact_fisher_probability_ordering_v1", familywiseAlpha: 0.001 }, srmAlpha: 0.001, invariantMetricRefs: [analysisId], concurrentExperimentAndInterferencePlan: prose, telemetryAndJoinPlan: prose },
  analysisPlan: { finalCaptureMaxDelaySeconds: 86400, method: "bonferroni_clopper_pearson_difference_v1", familywiseAlpha: 0.05, estimand: "intention_to_treat", missingOutcomes: "invalidate", multipleComparisonPolicy: "primary_and_guardrails_familywise_secondary_exploratory", noveltySeasonalityCarryoverLimits: prose },
  sampleOrDurationPlan: { kind: "fixed_horizon", from: "2026-10-01T00:00:00Z", until: "2026-10-02T00:00:00Z", minimumAssignedUnits: 4, maximumAssignedUnits: 100, minimumUnitsPerArm: 2, minimumDetectableEffect: 0.1, powerRationale: prose },
  stopRules: { efficacyLooks: "one_after_fixed_horizon", emergencySafetyStop: prose, shipPolicy: prose, rollbackPolicy: prose },
  ethics: { affectedPopulation: prose, personImpact: "none", legalBasisRationale: prose, requiresConsent: false, consentGovernanceObligationRef: null, darkPatterns: false, hiddenEmploymentManipulation: false, changesMaterialAiDecisions: false, aiUseCaseId: null, fairnessConstraints: prose },
  sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [companyId], retentionDays: 30 };
const experiment = { id: experimentId, companyId, revision: 6, state: "analyzing", currentVersionId: versionId };
const version = { id: versionId, companyId, experimentId, definition, contentHash: "a".repeat(64), expiresAt: "2026-11-01T00:00:00Z", currentQualification: "current" };
const summary = { companyId, experimentId, versionId, definitionHash: version.contentHash, expiresAt: version.expiresAt, currentQualification: "current", interpretation: null,
  analysis: { id: analysisId, companyId, experimentId, versionId, definitionHash: version.contentHash, currentQualification: "current", analyzedAt: "2026-10-03T00:00:00Z", receiptHash: "c".repeat(64), causalAuthority: "conditional_on_registered_randomization_and_human_attestations", exposureProvenance: "human_attestation", outcomeTimeSemantics: "created_in_window_current_state_at_common_final_capture",
    qualityGates: { assignmentReceipts: true, exposureReports: true, finalOutcomeCapture: "complete", identityJoins: true, baselineBalance: true, concurrentReviewAdmitted: true },
    result: { engineVersion: "aw-native-business-experiment-v1", definitionHash: version.contentHash, inputHash: "b".repeat(64), status: "inconclusive", numericallyQualified: true, reasons: [], limitations: [prose], diagnostics: { assigned: 4, control: 2, treatment: 2, exposed: 4 },
      metrics: ["primary", "harm"].map((key, index) => ({ key, role: index ? "guardrail" : "primary", control: { units: 2, successes: 0, rate: 0 }, treatment: { units: 2, successes: 1, rate: 0.5 }, effect: 0.5,
        interval: { lower: -0.9, upper: 1, method: "bonferroni_clopper_pearson_difference_v1", familywiseCoverage: 0.95 }, interpretation: "uncertain" })) } } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function transport(change?: (path: string, data: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (raw: string, input: RequestInit) => {
    const url = new URL(raw, "http://local.test"); expect(url.searchParams.get("expectedUserId")).toBe("manager-a"); expect(input.method ?? "GET").toBe("GET"); expect(input.signal).toBeTruthy(); expect(url.pathname).not.toMatch(/\/(receipts|assignments|exposures)$/);
    const data = url.pathname.endsWith("analysis-summary") ? summary : url.pathname.endsWith(`/${experimentId}`) ? { experiment, versions: [version], coverage: "bounded_recent_versions_and_transitions" }
      : { items: [{ experiment, version }], nextCursor: null, coverage: "bounded_current_authorized_page" };
    return new Response(JSON.stringify(change ? change(url.pathname, structuredClone(data)) : data), { status: 200, headers: { "content-type": "application/json" } });
  }));
}
it("reads only the narrowed Native projection and preserves inconclusive evidence without calculating anything", async () => {
  transport(); const read = await readInsightExperimentResults(companyId, "manager-a", new AbortController().signal); expect(read.items[0].summary.analysis?.result.status).toBe("inconclusive"); expect(fetch).toHaveBeenCalledTimes(3);
});
it("preserves an invalid early integrity rejection without claiming that its partial arm counts are qualified zeros", async () => {
  transport((path, data) => {
    if (path.endsWith("analysis-summary")) {
      data.analysis.result.status = "invalid"; data.analysis.result.numericallyQualified = false; data.analysis.causalAuthority = "withheld";
      data.analysis.result.metrics = []; data.analysis.result.diagnostics = { assigned: 4, control: 0, treatment: 0, exposed: 0 };
    }
    return data;
  });
  const read = await readInsightExperimentResults(companyId, "manager-a", new AbortController().signal);
  expect(read.items[0].summary.analysis?.result).toMatchObject({ status: "invalid", numericallyQualified: false, metrics: [] });
});
it.each(["changed_revision", "foreign_summary", "changed_definition", "foreign_analysis", "wrong_result_hash", "unknown_metric", "duplicate_metric", "missing_guardrail", "inconsistent_population", "wrong_interpretation"])("refuses %s without private excerpts", async failure => {
  transport((path, data) => {
    if (path.endsWith(`/${experimentId}`) && failure === "changed_revision") data.experiment.revision++;
    if (path.endsWith("analysis-summary")) {
      if (failure === "foreign_summary") data.companyId = analysisId;
      if (failure === "changed_definition") data.definitionHash = "d".repeat(64);
      if (failure === "foreign_analysis") data.analysis.experimentId = analysisId;
      if (failure === "wrong_result_hash") data.analysis.result.definitionHash = "d".repeat(64);
      if (failure === "unknown_metric") data.analysis.result.metrics[0].key = "unknown";
      if (failure === "duplicate_metric") data.analysis.result.metrics.push(data.analysis.result.metrics[0]);
      if (failure === "missing_guardrail") data.analysis.result.metrics.pop();
      if (failure === "inconsistent_population") data.analysis.result.diagnostics.control++;
      if (failure === "wrong_interpretation") data.interpretation = { analysisId: versionId, conclusion: "abstain", rationale: prose, executionAuthority: "advisory_only", interpretedAt: "2026-10-03T00:00:00Z", receiptHash: "e".repeat(64) };
    }
    return data;
  });
  await expect(readInsightExperimentResults(companyId, "manager-a", new AbortController().signal)).rejects.toThrow("insight_experiment_results_unavailable");
});
