import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { businessExperimentDefinitionSchema, type BusinessExperimentDefinition, type NativeBusinessExperimentCapture } from "@paperclipai/shared";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { assignNativeBusinessExperimentUnit, evaluateNativeBusinessExperiment, exactExperimentSrm, experimentBinomialInterval, exactExperimentInvariantBalance } from "../services/business-experiments/kernel.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const statement = "Explicit synthetic human declaration for numerical software qualification only.";
function definition(): BusinessExperimentDefinition {
  const metric = (key: string, n: number) => ({ key, name: `${key} outcome`, metricId: id(n), metricVersionId: id(n + 1), outcome: "binary" as const, successDefinition: statement });
  return businessExperimentDefinitionSchema.parse({
    name: "Synthetic two-arm process comparison", hypothesis: statement, decisionQuestion: statement, decisionId: null, ownerUserId: "reviewer",
    scope: { type: "company", id: null }, design: "individual_randomized_two_arm_binary",
    population: { randomizationUnit: "issue", eligibility: statement, trigger: statement, externalValidityLimits: statement }, treatment: statement, control: statement,
    executionPlan: { mode: "recording_only_human_attested_native_process", exposureProvenance: "human_attestation", exposureTimeSemantics: "human_asserted_event_time", outcomeTimeSemantics: "created_in_window_current_state_at_common_final_capture" },
    assignment: { method: "hmac_sha256_48_v1", treatmentProbability: 0.5 },
    primaryMetric: { ...metric("primary", 10), beneficialDirection: "increase", minimumMeaningfulEffect: 0.1 },
    secondaryMetrics: [metric("secondary", 20)], guardrailMetrics: [{ ...metric("guardrail", 30), harmfulDirection: "increase", maximumAcceptableHarm: 0.15 }],
    diagnostics: { invariantBalance: { method: "exact_fisher_probability_ordering_v1", familywiseAlpha: 0.001 }, srmAlpha: 0.001, invariantMetricRefs: [id(40)], concurrentExperimentAndInterferencePlan: statement, telemetryAndJoinPlan: statement },
    analysisPlan: { method: "bonferroni_clopper_pearson_difference_v1", familywiseAlpha: 0.05, estimand: "intention_to_treat", missingOutcomes: "invalidate", multipleComparisonPolicy: "primary_and_guardrails_familywise_secondary_exploratory", noveltySeasonalityCarryoverLimits: statement },
    sampleOrDurationPlan: { kind: "fixed_horizon", from: "2026-01-01T00:00:00Z", until: "2026-02-01T00:00:00Z", minimumAssignedUnits: 20, maximumAssignedUnits: 4000, minimumUnitsPerArm: 2, minimumDetectableEffect: 0.1, powerRationale: statement },
    stopRules: { efficacyLooks: "one_after_fixed_horizon", emergencySafetyStop: statement, shipPolicy: statement, rollbackPolicy: statement },
    ethics: { affectedPopulation: statement, personImpact: "none", legalBasisRationale: statement, requiresConsent: false, consentGovernanceObligationRef: null, darkPatterns: false, hiddenEmploymentManipulation: false, changesMaterialAiDecisions: false, aiUseCaseId: null, fairnessConstraints: statement },
    sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [id(50)], retentionDays: 30,
  });
}
/** Synthetic receipts exercise arithmetic only, never native ownership. */
function capture(d: BusinessExperimentDefinition, perArm = 500): NativeBusinessExperimentCapture {
  const observedAt = "2026-02-01T01:00:00Z";
  return {
    versionId: id(100), definitionHash: nativeSha256(d), registeredAt: "2025-12-01T00:00:00Z", reviewedAt: "2025-12-02T00:00:00Z",
    completedAt: d.sampleOrDurationPlan.until, analyzedAt: "2026-02-01T02:00:00Z", completionReason: "fixed_horizon",
    integrity: { assignmentLogComplete: true, exposureLogComplete: true, telemetryComplete: true, joinIntegrity: true, invariantsPassed: true, interferenceAdmitted: true },
    units: Array.from({ length: perArm * 2 }, (_, i) => {
      const arm = i < perArm ? "control" as const : "treatment" as const, position = i % perArm;
      return { unitId: id(1000 + i), unitSourceHash: nativeSha256({ syntheticUnit: i }), arm, assignedAt: "2026-01-01T01:00:00Z", assignmentReceiptHash: nativeSha256({ syntheticAssignment: i }),
        exposure: { arm, exposedAt: "2026-01-01T02:00:00Z", receiptHash: nativeSha256({ syntheticExposure: i }) },
        outcomes: [d.primaryMetric, ...d.guardrailMetrics, ...d.secondaryMetrics].map((metric, j) => ({ key: metric.key, metricId: metric.metricId, metricVersionId: metric.metricVersionId, observationId: id(100000 + i * 10 + j), sourceHash: nativeSha256({ syntheticOutcome: i, metric: j }), from: d.sampleOrDurationPlan.from, until: d.sampleOrDurationPlan.until, observedAt,
          value: (metric.key === "primary" ? Number(position < perArm * (arm === "control" ? 0.2 : 0.8)) : metric.key === "guardrail" ? 0 : position % 2) as 0 | 1 })),
      };
    }),
  };
}
describe("native experiment exact arithmetic", () => {
  it("matches independent Fisher exact pretreatment balance diagnostics including degenerate and n=4000 tables", () => {
    const { vectors } = JSON.parse(readFileSync(new URL("./fixtures/business-experiment-invariant-reference.json", import.meta.url), "utf8")) as { vectors: { controlUnits: number; controlSuccesses: number; treatmentUnits: number; treatmentSuccesses: number; pValue: number }[] };
    for (const item of vectors) {
      const value = exactExperimentInvariantBalance(item.controlUnits, item.controlSuccesses, item.treatmentUnits, item.treatmentSuccesses);
      expect(Math.abs(value - item.pValue)).toBeLessThan(2e-10);
      expect(exactExperimentInvariantBalance(item.treatmentUnits, item.treatmentSuccesses, item.controlUnits, item.controlSuccesses)).toBeCloseTo(value, 12);
    }
    expect(() => exactExperimentInvariantBalance(2, 3, 2, 1)).toThrow();
    expect(() => exactExperimentInvariantBalance(2000, 1, 2001, 1)).toThrow();
  });
  it("matches independent SciPy exact SRM and Clopper-Pearson vectors including n=4000 and boundaries", () => {
    const vectors = JSON.parse(readFileSync(new URL("./fixtures/business-experiment-binomial-reference.json", import.meta.url), "utf8")) as {
      srm: { n: number; treatment: number; probability: number; pValue: number }[];
      interval: { n: number; successes: number; tailAlpha: number; lower: number; upper: number }[];
      assignment: { keyHex: string; companyId: string; versionId: string; probability: number; units: { unitId: string; arm: "control" | "treatment" }[] };
    };
    for (const v of vectors.srm) expect(Math.abs(exactExperimentSrm(v.n, v.treatment, v.probability) - v.pValue)).toBeLessThan(2e-10);
    for (const v of vectors.interval) {
      const actual = experimentBinomialInterval(v.n, v.successes, v.tailAlpha);
      expect(Math.abs(actual.lower - v.lower)).toBeLessThan(2e-10); expect(Math.abs(actual.upper - v.upper)).toBeLessThan(2e-10);
    }
    const assignment = vectors.assignment;
    for (const unit of assignment.units) expect(assignNativeBusinessExperimentUnit(Buffer.from(assignment.keyHex, "hex"), assignment.companyId, assignment.versionId, unit.unitId, assignment.probability)).toBe(unit.arm);
  });
  it("keeps assignment deterministic, company/version scoped and independent of retry/order", () => {
    const secret = new Uint8Array(32).fill(123), units = Array.from({ length: 100 }, (_, i) => id(i + 1000));
    const assign = (company = id(1), version = id(2)) => units.map(unit => assignNativeBusinessExperimentUnit(secret, company, version, unit, 0.5));
    expect(assign()).toEqual(assign());
    expect(units.toReversed().map(unit => assignNativeBusinessExperimentUnit(secret, id(1), id(2), unit, 0.5)).reverse()).toEqual(assign());
    expect(assign(id(3))).not.toEqual(assign()); expect(assign(id(1), id(4))).not.toEqual(assign());
    expect(() => assignNativeBusinessExperimentUnit(new Uint8Array(31), id(1), id(2), id(3), 0.5)).toThrow();
    expect(() => assignNativeBusinessExperimentUnit(secret, id(1), id(2), id(3), NaN)).toThrow();
  });
  it("requires primary benefit and all guardrails, preserves exploratory distinction and deterministic replay", () => {
    const d = definition(), c = capture(d), actual = evaluateNativeBusinessExperiment(d, c);
    expect(actual.status).toBe("pass"); expect(actual.numericallyQualified).toBe(true);
    expect(actual.metrics[0].effect).toBeCloseTo(0.6); expect(actual.metrics[0].interval!.lower).toBeGreaterThan(0.1);
    expect(actual.metrics.find(metric => metric.role === "guardrail")!.interpretation).toBe("harm_excluded");
    expect(actual.metrics.find(metric => metric.role === "exploratory")).toMatchObject({ interval: null, interpretation: "exploratory" });
    expect(evaluateNativeBusinessExperiment(d, c)).toEqual(actual);
    c.units.reverse(); const reordered = evaluateNativeBusinessExperiment(d, c);
    expect(reordered.metrics).toEqual(actual.metrics); expect(reordered.inputHash).not.toBe(actual.inputHash);
  });
  it("rejects material sample-ratio mismatch before returning seemingly positive effects", () => {
    const d = definition(), c = capture(d);
    c.units = c.units.filter((unit, i) => unit.arm === "treatment" || i < 10);
    const actual = evaluateNativeBusinessExperiment(d, c);
    expect(actual.status).toBe("invalid"); expect(actual.numericallyQualified).toBe(false); expect(actual.metrics).toEqual([]);
    expect(actual.diagnostics.srm?.mismatch).toBe(true); expect(actual.reasons).toContain("experiment_sample_ratio_mismatch_untrusted");
    const short = capture(d, 11); short.units = short.units.filter(unit => unit.arm === "treatment");
    expect(evaluateNativeBusinessExperiment(d, short)).toMatchObject({ status: "invalid", numericallyQualified: false, diagnostics: { srm: { mismatch: true } } });
  });
  it("does not call primary improvement success when harm is detected or cannot be excluded", () => {
    const d = definition(), harmed = capture(d);
    for (const unit of harmed.units) unit.outcomes.find(item => item.key === "guardrail")!.value = unit.arm === "treatment" ? 1 : 0;
    const harm = evaluateNativeBusinessExperiment(d, harmed); expect(harm.status).toBe("fail"); expect(harm.metrics.find(item => item.role === "guardrail")!.interpretation).toBe("harm_detected");
    const uncertain = capture(d, 10), result = evaluateNativeBusinessExperiment(d, uncertain);
    expect(result.status).toBe("inconclusive"); expect(result.numericallyQualified).toBe(true);
  });
  it("distinguishes a failed primary threshold from absence of evidence", () => {
    const d = definition(), c = capture(d);
    for (const unit of c.units) unit.outcomes.find(item => item.key === "primary")!.value = unit.arm === "treatment" ? 0 : 1;
    expect(evaluateNativeBusinessExperiment(d, c).status).toBe("fail");
    const empty = capture(d, 0); expect(evaluateNativeBusinessExperiment(d, empty)).toMatchObject({ status: "inconclusive", numericallyQualified: false, metrics: [] });
  });
  it("uses intention-to-treat rather than dropping unexposed subjects and invalidates missing outcomes", () => {
    const d = definition(), c = capture(d);
    c.units[0].exposure = null;
    expect(evaluateNativeBusinessExperiment(d, c)).toMatchObject({ status: "pass", diagnostics: { assigned: 1000, exposed: 999 } });
    c.units[0].outcomes.pop(); expect(evaluateNativeBusinessExperiment(d, c)).toMatchObject({ status: "invalid", numericallyQualified: false, metrics: [] });
  });
  it("withholds inference for failed logs, foreign pins, repeated outcomes and contaminated assignment/exposure", () => {
    const d = definition(), seed = capture(d, 10);
    const invalid = (change: (c: NativeBusinessExperimentCapture) => void) => { const c = structuredClone(seed); change(c); expect(evaluateNativeBusinessExperiment(d, c)).toMatchObject({ status: "invalid", numericallyQualified: false, metrics: [] }); };
    for (const key of Object.keys(seed.integrity) as (keyof typeof seed.integrity)[]) invalid(c => { c.integrity[key] = false; });
    invalid(c => { c.units[0].unitId = c.units[1].unitId; });
    invalid(c => { c.units[0].assignmentReceiptHash = c.units[1].assignmentReceiptHash; });
    invalid(c => { c.units[0].exposure!.arm = "treatment"; });
    invalid(c => { c.units[0].exposure!.receiptHash = c.units[1].exposure!.receiptHash; });
    invalid(c => { c.units[0].outcomes[0].metricVersionId = id(900); });
    invalid(c => { c.units[0].outcomes[0].observationId = c.units[1].outcomes[0].observationId; });
    invalid(c => { c.units[0].outcomes[0].value = NaN as 0; });
    invalid(c => { c.units[0].outcomes[0].until = "2026-02-02T00:00:00Z"; });
  });
  it("rejects retrospective registration, early efficacy analysis and outcomes outside the exact horizon", () => {
    const d = definition(), seed = capture(d, 10);
    const invalid = (change: (c: NativeBusinessExperimentCapture) => void) => { const c = structuredClone(seed); change(c); expect(evaluateNativeBusinessExperiment(d, c)).toMatchObject({ status: "invalid", numericallyQualified: false, metrics: [] }); };
    invalid(c => { c.registeredAt = "2026-01-02T00:00:00Z"; });
    invalid(c => { c.reviewedAt = "2026-01-01T02:00:00Z"; });
    invalid(c => { c.completedAt = "2026-01-31T00:00:00Z"; });
    invalid(c => { c.units[0].assignedAt = "2025-12-31T00:00:00Z"; });
    invalid(c => { c.units[0].exposure!.exposedAt = "2026-01-01T00:00:00Z"; });
    invalid(c => { c.units[0].outcomes[0].observedAt = "2026-01-31T00:00:00Z"; });
    invalid(c => { c.units[0].outcomes[0].observedAt = "2026-02-02T00:00:00Z"; });
    invalid(c => { c.definitionHash = "a".repeat(64); });
  });
  it("does not reinterpret emergency/cancelled stopping as confirmatory evidence", () => {
    const d = definition(), c = capture(d, 10);
    for (const reason of ["emergency_safety_stop", "cancelled"] as const) {
      c.completionReason = reason; c.completedAt = "2026-01-02T00:00:00Z";
      expect(evaluateNativeBusinessExperiment(d, c)).toMatchObject({ status: "inconclusive", numericallyQualified: false, metrics: [] });
    }
  });
  it("supports declared decreasing benefits and decreasing guardrail harm without changing the primary after analysis", () => {
    const d = definition(); d.primaryMetric.beneficialDirection = "decrease"; d.guardrailMetrics[0].harmfulDirection = "decrease";
    const c = capture(d);
    for (const unit of c.units) {
      unit.outcomes.find(item => item.key === "primary")!.value = (1 - unit.outcomes.find(item => item.key === "primary")!.value) as 0 | 1;
      unit.outcomes.find(item => item.key === "guardrail")!.value = 1;
    }
    expect(evaluateNativeBusinessExperiment(d, c).status).toBe("pass");
    d.primaryMetric.beneficialDirection = "increase";
    expect(evaluateNativeBusinessExperiment(d, c)).toMatchObject({ status: "invalid", numericallyQualified: false, metrics: [] });
  });
});
