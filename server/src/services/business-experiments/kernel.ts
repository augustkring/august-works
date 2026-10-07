import { createHmac } from "node:crypto";
import { businessExperimentDefinitionSchema, type BusinessExperimentDefinition, type NativeBusinessExperimentCapture, type NativeBusinessExperimentMetricResult, type NativeBusinessExperimentResult } from "@paperclipai/shared";
import { nativeSha256, canonicalNativeJson } from "../native-runtime/canonical.js";

/** A label only, never exposure/dispatch authority. The canonical owner must
 * retain its secret key and an immutable receipt before admitting a subject. */
export function assignNativeBusinessExperimentUnit(
  assignmentKey: Uint8Array, companyId: string, versionId: string, unitId: string, treatmentProbability: number,
): "control" | "treatment" {
  if (assignmentKey.byteLength < 32 || assignmentKey.byteLength > 64 || ![companyId, versionId, unitId].every(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    || !Number.isFinite(treatmentProbability) || treatmentProbability < 0.1 || treatmentProbability > 0.9) throw new Error("invalid_experiment_assignment_identity");
  const digest = createHmac("sha256", assignmentKey).update(canonicalNativeJson({ domain: "aw-business-experiment-assignment-48-v1", companyId, versionId, unitId })).digest("hex");
  return (Number.parseInt(digest.slice(0, 12), 16) + 0.5) / 281474976710656 < treatmentProbability ? "treatment" : "control";
}

/** Mode-centered recurrence avoids catastrophic underflow at n=4000 and
 * p near a boundary. Normalizing mathematical probability weights is distinct
 * from changing an observed allocation or filling missing telemetry. */
function binomialWeights(n: number, p: number): { weights: Float64Array; sum: number } {
  if (!Number.isInteger(n) || n < 0 || n > 4000 || !Number.isFinite(p) || p < 0 || p > 1) throw new Error("invalid_binomial_parameters");
  const weights = new Float64Array(n + 1);
  if (p === 0 || p === 1) { weights[p === 0 ? 0 : n] = 1; return { weights, sum: 1 }; }
  const mode = Math.min(n, Math.floor((n + 1) * p));
  weights[mode] = 1;
  for (let k = mode; k > 0; k--) weights[k - 1] = weights[k] * k / (n - k + 1) * (1 - p) / p;
  for (let k = mode; k < n; k++) weights[k + 1] = weights[k] * (n - k) / (k + 1) * p / (1 - p);
  let sum = 0;
  for (const weight of weights) sum += weight;
  if (!Number.isFinite(sum) || sum <= 0) throw new Error("unsafe_binomial_arithmetic");
  return { weights, sum };
}
function binomialTail(n: number, successes: number, p: number, upper: boolean): number {
  const { weights, sum } = binomialWeights(n, p);
  let selected = 0;
  for (let k = upper ? successes : 0; k <= (upper ? n : successes); k++) selected += weights[k];
  return Math.min(1, Math.max(0, selected / sum));
}
/** Two-sided exact binomial test: sum outcomes at least as unlikely as the
 * observed allocation, rather than applying a chi-square approximation. */
export function exactExperimentSrm(n: number, treatment: number, expectedProbability: number): number {
  if (!Number.isInteger(treatment) || treatment < 0 || treatment > n) throw new Error("invalid_srm_count");
  const { weights, sum } = binomialWeights(n, expectedProbability);
  const boundary = weights[treatment] * (1 + 1e-12);
  let selected = 0;
  for (const weight of weights) if (weight <= boundary) selected += weight;
  return Math.min(1, Math.max(0, selected / sum));
}
/** Clopper-Pearson endpoints invert exact binomial tails. Numerical bisection
 * is bounded at 64 iterations; individual zero/all-success bounds stay honest. */
export function experimentBinomialInterval(n: number, successes: number, tailAlpha: number): { lower: number; upper: number } {
  if (!Number.isInteger(n) || n < 1 || n > 4000 || !Number.isInteger(successes) || successes < 0 || successes > n || !Number.isFinite(tailAlpha) || tailAlpha <= 0 || tailAlpha >= 0.5) throw new Error("invalid_binomial_interval");
  const root = (upper: boolean) => {
    let low = 0, high = 1;
    for (let iteration = 0; iteration < 64; iteration++) {
      const middle = (low + high) / 2, probability = binomialTail(n, successes, middle, upper);
      if (upper ? probability < tailAlpha : probability > tailAlpha) low = middle; else high = middle;
    }
    return (low + high) / 2;
  };
  return { lower: successes === 0 ? 0 : root(true), upper: successes === n ? 1 : root(false) };
}
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const instant = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;

/** Internal deterministic numerical qualification only. Current purpose,
 * immutable preregistration, actual source receipts, privacy and exposure
 * authority must be independently established by the native owner. */
export function evaluateNativeBusinessExperiment(raw: BusinessExperimentDefinition, capture: NativeBusinessExperimentCapture): NativeBusinessExperimentResult {
  const definition = businessExperimentDefinitionSchema.parse(raw), plan = definition.sampleOrDurationPlan;
  const result: NativeBusinessExperimentResult = {
    engineVersion: "aw-native-business-experiment-v1", definitionHash: nativeSha256(definition), inputHash: nativeSha256(capture),
    status: "invalid", numericallyQualified: false, reasons: [],
    diagnostics: { assigned: capture.units.length, control: 0, treatment: 0, exposed: 0, srm: null }, metrics: [],
    limitations: [
      "Numerical validity does not authorize sources, expose people, execute a decision or promote policy.",
      "Inference is conditional on the registered individual randomization, complete intention-to-treat outcomes, no interference and valid native receipt provenance.",
      "Primary and guardrail intervals use a conservative Bonferroni family of exact binomial arm bounds; secondary metrics are exploratory and cannot establish confirmatory success.",
      "A single fixed-horizon analysis does not support repeated p-value peeking, efficacy stopping, cluster/switchback designs or retrospective primary-metric changes.",
      definition.population.externalValidityLimits, definition.analysisPlan.noveltySeasonalityCarryoverLimits,
    ],
  };
  const reject = (reason: string) => { result.reasons.push(reason); result.metrics = []; return result; };
  const registered = instant(capture.registeredAt), reviewed = instant(capture.reviewedAt), completed = instant(capture.completedAt), analyzed = instant(capture.analyzedAt), from = instant(plan.from), until = instant(plan.until);
  if (!uuid(capture.versionId) || capture.definitionHash !== result.definitionHash || ![registered, reviewed, completed, analyzed].every(Number.isFinite) || registered > reviewed || reviewed > from || completed > analyzed) return reject("experiment_preregistration_or_chronology_unavailable");
  const integrityKeys: (keyof NativeBusinessExperimentCapture["integrity"])[] = ["assignmentLogComplete", "exposureLogComplete", "telemetryComplete", "joinIntegrity", "invariantsPassed", "interferenceAdmitted"];
  if (integrityKeys.some(key => capture.integrity[key] !== true)) return reject("experiment_assignment_exposure_telemetry_or_interference_untrusted");
  if (capture.units.length > plan.maximumAssignedUnits || new Set(capture.units.map(unit => unit.unitId)).size !== capture.units.length) return reject("experiment_population_budget_or_independence_invalid");
  const metricDefinitions = [definition.primaryMetric, ...definition.guardrailMetrics, ...definition.secondaryMetrics];
  const assignmentHashes = new Set<string>(), exposureHashes = new Set<string>(), observationIds = new Set<string>();
  for (const unit of capture.units) {
    const assigned = instant(unit.assignedAt);
    if (!uuid(unit.unitId) || !hash(unit.unitSourceHash) || !hash(unit.assignmentReceiptHash) || assignmentHashes.has(unit.assignmentReceiptHash) || !["control", "treatment"].includes(unit.arm) || !Number.isFinite(assigned) || assigned < from || assigned >= until || assigned > completed) return reject("experiment_assignment_receipts_invalid");
    assignmentHashes.add(unit.assignmentReceiptHash);
    result.diagnostics[unit.arm]++;
    if (unit.exposure) {
      const exposed = instant(unit.exposure.exposedAt);
      if (unit.exposure.arm !== unit.arm || !hash(unit.exposure.receiptHash) || exposureHashes.has(unit.exposure.receiptHash) || !Number.isFinite(exposed) || exposed < assigned || exposed >= until || exposed > completed) return reject("experiment_exposure_receipts_invalid");
      exposureHashes.add(unit.exposure.receiptHash); result.diagnostics.exposed++;
    }
  }
  if (capture.completionReason !== "fixed_horizon") {
    if (!["emergency_safety_stop", "cancelled"].includes(capture.completionReason) || completed < from) return reject("experiment_completion_reason_invalid");
    result.status = "inconclusive";
    return reject("experiment_safety_stop_or_cancellation_withholds_confirmatory_inference");
  }
  if (completed < until || analyzed < until) return reject("experiment_fixed_horizon_not_elapsed");
  if (capture.units.length) {
    const pValue = exactExperimentSrm(capture.units.length, result.diagnostics.treatment, definition.assignment.treatmentProbability);
    result.diagnostics.srm = { method: "exact_binomial_probability_ordering_v1", expectedTreatmentProbability: definition.assignment.treatmentProbability, pValue, threshold: definition.diagnostics.srmAlpha, mismatch: pValue < definition.diagnostics.srmAlpha };
    if (result.diagnostics.srm.mismatch) return reject("experiment_sample_ratio_mismatch_untrusted");
  }
  if (capture.units.length < plan.minimumAssignedUnits || Math.min(result.diagnostics.control, result.diagnostics.treatment) < plan.minimumUnitsPerArm) { result.status = "inconclusive"; return reject("experiment_prespecified_sample_policy_not_met"); }
  // Intention-to-treat includes every assigned unit, including unexposed units.
  // A dropped or missing outcome invalidates the whole confirmatory result.
  const counts = new Map(metricDefinitions.map(metric => [metric.key, { control: 0, treatment: 0 }]));
  for (const unit of capture.units) {
    if (unit.outcomes.length !== metricDefinitions.length || new Set(unit.outcomes.map(item => item.key)).size !== metricDefinitions.length) return reject("experiment_intention_to_treat_outcomes_incomplete");
    for (const metric of metricDefinitions) {
      const outcome = unit.outcomes.find(item => item.key === metric.key), observed = instant(outcome?.observedAt);
      if (!outcome || outcome.metricId !== metric.metricId || outcome.metricVersionId !== metric.metricVersionId || !uuid(outcome.observationId) || observationIds.has(outcome.observationId) || !hash(outcome.sourceHash) || (outcome.value !== 0 && outcome.value !== 1) || instant(outcome.from) !== from || instant(outcome.until) !== until || !Number.isFinite(observed) || observed < until || observed > analyzed) return reject("experiment_exact_outcome_receipts_or_horizon_invalid");
      observationIds.add(outcome.observationId); counts.get(metric.key)![unit.arm] += outcome.value;
    }
  }
  const familySize = 1 + definition.guardrailMetrics.length, tailAlpha = definition.analysisPlan.familywiseAlpha / (4 * familySize);
  for (const metric of metricDefinitions) {
    const successes = counts.get(metric.key)!, control = { units: result.diagnostics.control, successes: successes.control, rate: successes.control / result.diagnostics.control }, treatment = { units: result.diagnostics.treatment, successes: successes.treatment, rate: successes.treatment / result.diagnostics.treatment };
    const role = metric.key === definition.primaryMetric.key ? "primary" : definition.guardrailMetrics.some(item => item.key === metric.key) ? "guardrail" : "exploratory";
    const entry: NativeBusinessExperimentMetricResult = { key: metric.key, role, control, treatment, effect: treatment.rate - control.rate, interval: null, interpretation: "exploratory" };
    if (role !== "exploratory") {
      const c = experimentBinomialInterval(control.units, control.successes, tailAlpha), t = experimentBinomialInterval(treatment.units, treatment.successes, tailAlpha);
      entry.interval = { lower: t.lower - c.upper, upper: t.upper - c.lower, method: definition.analysisPlan.method, familywiseCoverage: 1 - definition.analysisPlan.familywiseAlpha };
      if (role === "primary") {
        const primary = definition.primaryMetric, lower = primary.beneficialDirection === "increase" ? entry.interval.lower : -entry.interval.upper, upper = primary.beneficialDirection === "increase" ? entry.interval.upper : -entry.interval.lower;
        entry.interpretation = lower >= primary.minimumMeaningfulEffect ? "threshold_met" : upper < primary.minimumMeaningfulEffect ? "threshold_not_met" : "uncertain";
      } else {
        const guardrail = definition.guardrailMetrics.find(item => item.key === metric.key)!, lower = guardrail.harmfulDirection === "increase" ? entry.interval.lower : -entry.interval.upper, upper = guardrail.harmfulDirection === "increase" ? entry.interval.upper : -entry.interval.lower;
        entry.interpretation = upper <= guardrail.maximumAcceptableHarm ? "harm_excluded" : lower > guardrail.maximumAcceptableHarm ? "harm_detected" : "uncertain";
      }
    }
    result.metrics.push(entry);
  }
  const primary = result.metrics.find(item => item.role === "primary")!, guardrails = result.metrics.filter(item => item.role === "guardrail");
  result.status = primary.interpretation === "threshold_not_met" || guardrails.some(item => item.interpretation === "harm_detected") ? "fail"
    : primary.interpretation === "threshold_met" && guardrails.every(item => item.interpretation === "harm_excluded") ? "pass" : "inconclusive";
  result.numericallyQualified = true;
  result.reasons = [result.status === "pass" ? "registered_primary_and_all_guardrails_met" : result.status === "fail" ? "registered_primary_not_met_or_guardrail_harm_detected" : "registered_effect_or_guardrail_bounds_inconclusive"];
  return result;
}
