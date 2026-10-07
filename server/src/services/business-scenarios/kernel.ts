import {
  businessScenarioDefinitionSchema, businessScenarioUnitSchema, normalizeBusinessScenarioUnit, sameBusinessScenarioUnit,
  type BusinessScenarioCapturedInput, type BusinessScenarioDefinition, type BusinessScenarioDistribution,
  type NativeBusinessScenarioResult,
} from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";

const VERSION = "aw-native-business-scenario-v1" as const;
function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error("non_finite_scenario_arithmetic");
  return value;
}
/** The counter and assumption identity make each draw independent of case
 * order. Zero is a valid seed. No ambient random, clock, I/O or execution exists. */
function uniform(seed: number, draw: number, assumptionKey: string): number {
  const hash = nativeSha256({ domain: "aw-scenario-sha256-counter-48-v1", seed, draw, assumptionKey });
  return (Number.parseInt(hash.slice(0, 12), 16) + 0.5) / 281_474_976_710_656;
}
function sample(distribution: BusinessScenarioDistribution, u: number): number {
  if (distribution.kind === "discrete") {
    let cumulative = 0;
    for (const outcome of distribution.outcomes) {
      cumulative += outcome.probability;
      if (u < cumulative) return outcome.value;
    }
    return distribution.outcomes[distribution.outcomes.length - 1].value;
  }
  if (distribution.kind === "uniform") return finite(distribution.minimum * (1 - u) + distribution.maximum * u);
  const width = finite(distribution.maximum - distribution.minimum);
  const proportion = finite((distribution.mode - distribution.minimum) / width);
  return finite(u < proportion
    ? distribution.minimum + width * Math.sqrt(u * proportion)
    : distribution.maximum - width * Math.sqrt((1 - u) * (1 - proportion)));
}
function calculate(definition: BusinessScenarioDefinition, values: Map<string, number>): number[] {
  const nodes = new Map<string, number>();
  for (const node of definition.formula) {
    let value: number;
    if (node.operation === "input") {
      if (!values.has(node.inputKey)) throw new Error("missing_scenario_input");
      value = values.get(node.inputKey)!;
    } else if (node.operation === "negate") value = -nodes.get(node.argument)!;
    else {
      const left = nodes.get(node.left)!, right = nodes.get(node.right)!;
      switch (node.operation) {
        case "add": value = left + right; break;
        case "subtract": value = left - right; break;
        case "multiply": value = left * right; break;
        case "divide":
          if (right === 0) throw new Error("scenario_zero_denominator");
          value = left / right; break;
        case "minimum": value = Math.min(left, right); break;
        case "maximum": value = Math.max(left, right); break;
      }
    }
    nodes.set(node.key, finite(value));
  }
  return definition.outputs.map(output => nodes.get(output.nodeKey)!);
}
function withinConstraint(value: number, output: BusinessScenarioDefinition["outputs"][number]): boolean {
  return !output.constraints || ((output.constraints.minimum === null || value >= output.constraints.minimum)
    && (output.constraints.maximum === null || value <= output.constraints.maximum));
}
/** Linear empirical quantiles; these are conditional model samples, never a
 * calibrated confidence or prediction interval. */
function quantile(sorted: number[], probability: number): number {
  const index = (sorted.length - 1) * probability, lower = Math.floor(index), upper = Math.ceil(index), fraction = index - lower;
  return finite(sorted[lower] * (1 - fraction) + sorted[upper] * fraction);
}

/** Pure numerical boundary only. The native owner must authorize each exact
 * source/version, purpose, retention and unit before supplying internal capture. */
export function evaluateNativeBusinessScenario(
  raw: BusinessScenarioDefinition, captured: BusinessScenarioCapturedInput[], seed: number | null,
): NativeBusinessScenarioResult {
  const definition = businessScenarioDefinitionSchema.parse(raw), monteCarlo = definition.uncertaintyPolicy.kind === "bounded_monte_carlo";
  const result: NativeBusinessScenarioResult = {
    engineVersion: VERSION, status: "data_not_ready", definitionHash: nativeSha256(definition), inputHash: nativeSha256(captured), seed,
    reasons: [], cases: [],
    uncertainty: { method: monteCarlo ? "independent_assumption_monte_carlo" : "deterministic", seedAlgorithm: monteCarlo ? "sha256-counter-48-v1" : null,
      coverageLevel: null, qualification: "not_assessed", unstableOutputs: [] },
    limitations: [
      "All results are conditional model implications, not promises, causal effects or execution authority.",
      "Changes are explicit interventions on controllable assumptions or hypothetical conditions; observed metrics and native forecasts remain unchanged.",
      "Source-owner capture must separately prove current authorization, exact semantics, retention and integrity.",
      "Constraint satisfaction here covers only the human-declared numerical bounds, not complete organizational feasibility.",
      ...(monteCarlo ? [
        "Named assumption distributions are human-declared; neither empirical calibration nor correlations are inferred.",
        "Independent assumption draws are shared across cases for comparison; changed assumptions are fixed interventions.",
        "Reported empirical p10/median/p90 are conditional sample quantiles, not calibrated prediction or confidence intervals.",
        "Half-sample stability is a declared tolerance diagnostic, not proof that the model describes the business.",
      ] : ["Deterministic nominal values do not propagate the declared ranges; no uncertainty interval is available."]),
      ...definition.nonModeledEffects,
    ],
  };
  const reject = (reason: string) => { result.reasons.push(reason); result.cases = []; return result; };
  if (monteCarlo ? seed === null || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff : seed !== null) return reject("scenario_seed_policy_mismatch");
  if (captured.length !== definition.inputs.length || new Set(captured.map(item => item.key)).size !== captured.length) return reject("scenario_input_pin_coverage_mismatch");
  const captures = new Map(captured.map(item => [item.key, item]));
  const observed = new Map<string, number>();
  for (const input of definition.inputs) {
    const capture = captures.get(input.key);
    const sourceId = input.kind === "metric_observation" ? input.observationId : input.runId;
    const versionId = input.kind === "metric_observation" ? input.metricVersionId : input.versionId;
    if (!capture || capture.kind !== input.kind || capture.sourceId !== sourceId || capture.versionId !== versionId || capture.pointIndex !== (input.kind === "forecast_point" ? input.pointIndex : null)
      || !businessScenarioUnitSchema.safeParse(capture.unit).success || !sameBusinessScenarioUnit(capture.unit, input.unit)
      || !/^[a-f0-9]{64}$/.test(capture.contentHash) || !Number.isFinite(capture.value)) return reject("scenario_input_integrity_or_unit_mismatch");
    observed.set(input.key, capture.value);
  }
  try {
    const nominal = new Map([...observed, ...definition.assumptions.map(item => [item.key, item.nominal] as const)]);
    const base = calculate(definition, nominal);
    result.cases = definition.cases.map(scenarioCase => {
      const values = new Map(nominal);
      for (const change of scenarioCase.changes) values.set(change.assumptionKey, change.value);
      const outputs = calculate(definition, values);
      return { key: scenarioCase.key, name: scenarioCase.name, kind: scenarioCase.kind, changes: scenarioCase.changes,
        outputs: definition.outputs.map((output, index) => ({ key: output.key, unit: normalizeBusinessScenarioUnit(output.unit), nominal: outputs[index],
          differenceFromBase: finite(outputs[index] - base[index]), constraint: !output.constraints ? "not_declared" : withinConstraint(outputs[index], output) ? "satisfied" : "violated", simulation: null })) };
    });
    const policy = definition.uncertaintyPolicy;
    if (policy.kind === "bounded_monte_carlo") {
      const samples = definition.cases.map(() => definition.outputs.map(() => [] as number[]));
      const changes = definition.cases.map(item => new Map(item.changes.map(change => [change.assumptionKey, change.value])));
      for (let draw = 0; draw < policy.samples; draw++) {
        const values = new Map(observed);
        for (const assumption of definition.assumptions) values.set(assumption.key, assumption.distribution
          ? sample(assumption.distribution, uniform(seed!, draw, assumption.key)) : assumption.nominal);
        for (let caseIndex = 0; caseIndex < definition.cases.length; caseIndex++) {
          const caseValues = new Map(values);
          for (const [key, value] of changes[caseIndex]) caseValues.set(key, value);
          const outputs = calculate(definition, caseValues);
          outputs.forEach((value, index) => samples[caseIndex][index].push(value));
        }
      }
      for (let caseIndex = 0; caseIndex < samples.length; caseIndex++) for (let outputIndex = 0; outputIndex < samples[caseIndex].length; outputIndex++) {
        const values = samples[caseIndex][outputIndex], halfway = Math.floor(values.length / 2);
        const first = values.slice(0, halfway).sort((a, b) => a - b), second = values.slice(halfway).sort((a, b) => a - b);
        const maximumDifference = Math.max(...[0.1, 0.5, 0.9].map(probability => finite(Math.abs(quantile(first, probability) - quantile(second, probability)))));
        const output = definition.outputs[outputIndex], tolerance = policy.stabilityAbsoluteTolerance[output.key];
        if (maximumDifference > tolerance) result.uncertainty.unstableOutputs.push({ caseKey: definition.cases[caseIndex].key, outputKey: output.key, maximumDifference, tolerance });
        values.sort((a, b) => a - b);
        result.cases[caseIndex].outputs[outputIndex].simulation = { samples: policy.samples, minimum: values[0], p10: quantile(values, 0.1), median: quantile(values, 0.5), p90: quantile(values, 0.9), maximum: values[values.length - 1],
          constraintViolations: output.constraints ? values.filter(value => !withinConstraint(value, output)).length : null,
          halfSampleMaximumDifference: maximumDifference, stabilityAbsoluteTolerance: tolerance };
      }
      if (result.uncertainty.unstableOutputs.length) {
        result.status = "inconclusive"; result.reasons.push("scenario_declared_sample_stability_not_met");
        result.uncertainty.qualification = "unstable";
        // Preserve nominal arithmetic and diagnostics, but withhold all ranges
        // rather than presenting unstable outputs as usable comparative evidence.
        for (const scenarioCase of result.cases) for (const output of scenarioCase.outputs) output.simulation = null;
        return result;
      }
      result.uncertainty.qualification = "stable_for_declared_tolerance";
    }
    result.status = "calculated";
    return result;
  } catch (error) {
    if (error instanceof Error && ["non_finite_scenario_arithmetic", "scenario_zero_denominator", "missing_scenario_input"].includes(error.message)) return reject(error.message);
    throw error;
  }
}
