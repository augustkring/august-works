import { describe, expect, it } from "vitest";
import { businessScenarioDefinitionSchema, type BusinessScenarioCapturedInput, type BusinessScenarioDefinition } from "@paperclipai/shared";
import { evaluateNativeBusinessScenario } from "../services/business-scenarios/kernel.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const definition = (): BusinessScenarioDefinition => businessScenarioDefinitionSchema.parse({
  name: "Conditional native object capacity", objective: "Compare the explicit hypothetical unit economics", decisionUse: "Inform a human-owned review without approving expenditure", ownerUserId: "local-board",
  scope: { type: "company", id: null }, calculationType: "formula",
  inputs: [{ kind: "metric_observation", key: "objects", metricId: id(1), metricVersionId: id(2), observationId: id(3), unit: { issue: 1 } }],
  assumptions: [
    { key: "price", name: "Hypothetical value per issue", type: "numeric", unit: { currency_USD: 1, issue: -1 }, nominal: 100, range: { minimum: 80, maximum: 140 },
      evidence: [{ kind: "human_statement", rationale: "Human-declared conditional coefficient, not an observed invoice" }], confidence: "human_asserted", uncertaintyRationale: "No empirical calibration has been performed for this hypothetical coefficient", ownerUserId: "local-board", controllable: true, distribution: null },
    { key: "cost", name: "Hypothetical fixed cost", type: "numeric", unit: { currency_USD: 1 }, nominal: 1000, range: { minimum: 800, maximum: 1200 },
      evidence: [{ kind: "human_statement", rationale: "Human-declared cost for a conditional model only" }], confidence: "human_asserted", uncertaintyRationale: "Other cost changes are not represented by this nominal value", ownerUserId: "local-board", controllable: false, distribution: null },
  ],
  formula: [{ key: "n", operation: "input", inputKey: "objects" }, { key: "p", operation: "input", inputKey: "price" }, { key: "c", operation: "input", inputKey: "cost" },
    { key: "revenue", operation: "multiply", left: "n", right: "p" }, { key: "profit", operation: "subtract", left: "revenue", right: "c" }],
  outputs: [{ key: "profit", name: "Conditional model margin", nodeKey: "profit", unit: { currency_USD: 1 }, constraints: { minimum: 900, maximum: null, rationale: "Human-declared minimum conditional margin for review" } }],
  cases: [{ key: "base", name: "Base case", kind: "base", changes: [] },
    { key: "option", name: "Price option", kind: "option", changes: [{ kind: "intervention", assumptionKey: "price", value: 120, rationale: "Human proposes this price as a conditional intervention" }] },
    { key: "stress", name: "External cost stress", kind: "stress", changes: [{ kind: "hypothetical_condition", assumptionKey: "cost", value: 1200, rationale: "Consider the external cost reaching the declared upper bound" }] }],
  uncertaintyPolicy: { kind: "deterministic", rationale: "This first comparison uses nominal assumptions only" },
  nonModeledEffects: ["Demand responses and actual revenue collection are not modeled"], sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [id(4)], retentionDays: 30,
});
const capture = (): BusinessScenarioCapturedInput[] => [{ key: "objects", kind: "metric_observation", sourceId: id(3), versionId: id(2), pointIndex: null, value: 20, unit: { issue: 1 }, contentHash: "a".repeat(64) }];
function monteCarlo(): BusinessScenarioDefinition {
  const value = definition();
  value.calculationType = "bounded_monte_carlo";
  value.assumptions[0].distribution = { kind: "uniform", minimum: 80, maximum: 140, rationale: "Human proposes equal conditional likelihood over this illustrative range" };
  value.uncertaintyPolicy = { kind: "bounded_monte_carlo", samples: 5000, independenceRationale: "One uncertain coefficient only; no empirical correlation structure is asserted", stabilityAbsoluteTolerance: { profit: 80 } };
  return businessScenarioDefinitionSchema.parse(value);
}

describe("Conditional native business scenario arithmetic", () => {
  it("preserves observed facts and compares explicit nominal interventions and external stress", () => {
    const source = capture(), raw = definition(), before = structuredClone({ source, raw });
    const result = evaluateNativeBusinessScenario(raw, source, null);
    expect(result.status).toBe("calculated");
    expect(result.cases.map(item => item.outputs[0])).toMatchObject([
      { nominal: 1000, differenceFromBase: 0, constraint: "satisfied", simulation: null, unit: { currency_USD: 1 } },
      { nominal: 1400, differenceFromBase: 400, constraint: "satisfied", simulation: null },
      { nominal: 800, differenceFromBase: -200, constraint: "violated", simulation: null },
    ]);
    expect(result.uncertainty).toMatchObject({ method: "deterministic", coverageLevel: null, qualification: "not_assessed" });
    expect({ source, raw }).toEqual(before);
  });
  it("rejects incompatible currency/object arithmetic, output units, forward references and recursive programs", () => {
    const raw = definition();
    const wrongCurrency = structuredClone(raw); wrongCurrency.assumptions[1].unit = { currency_EUR: 1 };
    const wrongGrain = structuredClone(raw); wrongGrain.inputs[0].unit = { project: 1 };
    const wrongOutput = structuredClone(raw); wrongOutput.outputs[0].unit = { issue: 1 };
    const recursive = structuredClone(raw); recursive.formula[0] = { key: "n", operation: "negate", argument: "n" };
    const forward = structuredClone(raw); forward.formula[0] = { key: "n", operation: "negate", argument: "profit" };
    for (const value of [wrongCurrency, wrongGrain, wrongOutput, recursive, forward]) expect(businessScenarioDefinitionSchema.safeParse(value).success).toBe(false);
  });
  it("requires exact capture coverage, version, kind, selected forecast point, unit, integrity hash and finite value", () => {
    const raw = definition(), source = capture()[0];
    for (const inputs of [[], [source, source], [{ ...source, versionId: id(9) }], [{ ...source, kind: "forecast_point" as const }], [{ ...source, pointIndex: 0 }], [{ ...source, unit: { project: 1 } }], [{ ...source, contentHash: "copied" }], [{ ...source, value: Infinity }]]) {
      expect(evaluateNativeBusinessScenario(raw, inputs, null)).toMatchObject({ status: "data_not_ready", cases: [] });
    }
    const forecast = definition(); forecast.calculationType = "forecast_composition";
    forecast.inputs[0] = { kind: "forecast_point", key: "objects", specId: id(1), versionId: id(2), runId: id(3), pointIndex: 1, unit: { issue: 1 } };
    expect(evaluateNativeBusinessScenario(forecast, [{ ...source, kind: "forecast_point", pointIndex: 0 }], null).status).toBe("data_not_ready");
    expect(evaluateNativeBusinessScenario(forecast, [{ ...source, kind: "forecast_point", pointIndex: 1 }], null).status).toBe("calculated");
  });
  it("retains zero as a legitimate observation and seed, with no fabricated ranges for nominal arithmetic", () => {
    expect(evaluateNativeBusinessScenario(definition(), [{ ...capture()[0], value: 0 }], null).cases[0].outputs[0]).toMatchObject({ nominal: -1000, constraint: "violated", simulation: null });
    const first = evaluateNativeBusinessScenario(monteCarlo(), capture(), 0), repeat = evaluateNativeBusinessScenario(monteCarlo(), capture(), 0);
    expect(first.status).toBe("calculated"); expect(first).toEqual(repeat); expect(first.seed).toBe(0);
    expect(first.uncertainty).toMatchObject({ seedAlgorithm: "sha256-counter-48-v1", coverageLevel: null, qualification: "stable_for_declared_tolerance" });
    expect(first.cases[0].outputs[0].simulation).toMatchObject({ samples: 5000 });
    expect(first.cases[0].outputs[0].simulation!.p10).toBeGreaterThan(660);
    expect(first.cases[0].outputs[0].simulation!.p10).toBeLessThan(780);
    expect(first.cases[0].outputs[0].simulation!.median).toBeGreaterThan(1140);
    expect(first.cases[0].outputs[0].simulation!.median).toBeLessThan(1260);
    expect(first.cases[0].outputs[0].simulation!.p90).toBeGreaterThan(1620);
    expect(first.cases[0].outputs[0].simulation!.p90).toBeLessThan(1740);
  });
  it("shares uncertainty draws across cases, fixes interventions, and preserves results under case reordering", () => {
    const raw = monteCarlo(), first = evaluateNativeBusinessScenario(raw, capture(), 77);
    expect(first.status).toBe("calculated");
    const base = first.cases[0].outputs[0].simulation!, stress = first.cases[2].outputs[0].simulation!, option = first.cases[1].outputs[0].simulation!;
    expect(stress.median).toBeCloseTo(base.median - 200, 8);
    expect(option).toMatchObject({ minimum: 1400, median: 1400, maximum: 1400, constraintViolations: 0, halfSampleMaximumDifference: 0 });
    raw.cases.reverse(); const reordered = evaluateNativeBusinessScenario(raw, capture(), 77);
    expect(reordered.cases.slice().reverse()).toEqual(first.cases);
    expect(evaluateNativeBusinessScenario(monteCarlo(), capture(), 78).cases[0].outputs[0].simulation!.median).not.toBe(base.median);
  });
  it("samples explicitly justified triangular and discrete distributions without invented calibration", () => {
    const triangular = monteCarlo(); triangular.assumptions[0].distribution = { kind: "triangular", minimum: 80, mode: 100, maximum: 140, rationale: "Explicit human conditional distribution with declared mode" };
    const result = evaluateNativeBusinessScenario(triangular, capture(), 10);
    expect(result.status).toBe("calculated"); expect(result.cases[0].outputs[0].simulation!.median).toBeGreaterThan(1000); expect(result.cases[0].outputs[0].simulation!.median).toBeLessThan(1200);
    const discrete = monteCarlo(); discrete.assumptions[0].distribution = { kind: "discrete", outcomes: [{ value: 80, probability: 0.25 }, { value: 100, probability: 0.5 }, { value: 140, probability: 0.25 }], rationale: "Explicit conditional probabilities, not measured frequencies" };
    expect(evaluateNativeBusinessScenario(discrete, capture(), 10).cases[0].outputs[0].simulation).toMatchObject({ minimum: 600, median: 1000, maximum: 1800 });
  });
  it("withholds every simulated range if any reported quantile fails its human-declared stability tolerance", () => {
    const raw = monteCarlo(); raw.uncertaintyPolicy = { ...raw.uncertaintyPolicy as Extract<BusinessScenarioDefinition["uncertaintyPolicy"], { kind: "bounded_monte_carlo" }>, stabilityAbsoluteTolerance: { profit: 1e-12 } };
    const result = evaluateNativeBusinessScenario(raw, capture(), 1);
    expect(result).toMatchObject({ status: "inconclusive", reasons: ["scenario_declared_sample_stability_not_met"], uncertainty: { qualification: "unstable" } });
    expect(result.uncertainty.unstableOutputs.length).toBeGreaterThan(0);
    expect(result.cases.every(item => item.outputs.every(output => output.simulation === null))).toBe(true);
    expect(result.cases[0].outputs[0].nominal).toBe(1000);
  });
  it("abstains for nominal division by zero, overflow and any unsafe simulated draw without dropping failed samples", () => {
    const raw = definition(); raw.inputs = []; raw.assumptions = [raw.assumptions[0]];
    raw.assumptions[0].key = "denominator"; raw.assumptions[0].unit = {}; raw.assumptions[0].nominal = 0; raw.assumptions[0].range = { minimum: -1, maximum: 1 };
    raw.formula = [{ key: "v", operation: "input", inputKey: "denominator" }, { key: "ratio", operation: "divide", left: "v", right: "v" }];
    raw.outputs = [{ key: "ratio", name: "Self-normalized assumption", nodeKey: "ratio", unit: {}, constraints: null }]; raw.cases = [raw.cases[0]];
    expect(evaluateNativeBusinessScenario(raw, [], null)).toMatchObject({ status: "data_not_ready", reasons: ["scenario_zero_denominator"], cases: [] });
    raw.assumptions[0].nominal = 1; raw.assumptions[0].distribution = { kind: "discrete", outcomes: [{ value: 0, probability: 0.5 }, { value: 1, probability: 0.5 }], rationale: "A failed denominator remains a failed scenario draw" };
    raw.calculationType = "bounded_monte_carlo"; raw.uncertaintyPolicy = { kind: "bounded_monte_carlo", samples: 1000, independenceRationale: "Only one uncertain variable, sampled without correlations", stabilityAbsoluteTolerance: { ratio: 1 } };
    expect(evaluateNativeBusinessScenario(raw, [], 0)).toMatchObject({ status: "data_not_ready", reasons: ["scenario_zero_denominator"], cases: [] });
    const overflow = definition(); overflow.assumptions[0].nominal = 1e308; overflow.assumptions[0].range = { minimum: 1e308, maximum: 1e308 }; overflow.cases = [overflow.cases[0]];
    expect(evaluateNativeBusinessScenario(overflow, capture(), null)).toMatchObject({ status: "data_not_ready", reasons: ["non_finite_scenario_arithmetic"], cases: [] });
  });
  it("rejects ambient/missing/out-of-range seeds and unbounded numerical work", () => {
    expect(evaluateNativeBusinessScenario(definition(), capture(), 1).status).toBe("data_not_ready");
    for (const seed of [null, -1, 0x100000000, 1.5, NaN]) expect(evaluateNativeBusinessScenario(monteCarlo(), capture(), seed).status).toBe("data_not_ready");
    const raw = monteCarlo();
    if (raw.uncertaintyPolicy.kind === "bounded_monte_carlo") raw.uncertaintyPolicy.samples = 10_000;
    for (let index = 0; index < 90; index++) raw.formula.push({ key: `extra_${index}`, operation: "input", inputKey: "price" });
    expect(businessScenarioDefinitionSchema.safeParse(raw).success).toBe(false);
  });
});
