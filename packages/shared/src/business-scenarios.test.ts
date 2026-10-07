import { describe, expect, it } from "vitest";
import { businessScenarioDefinitionSchema, businessScenarioDistributionSchema, createBusinessScenarioSchema, runBusinessScenarioSchema, inferBusinessScenarioFormulaUnits } from "./business-scenarios.js";
const id = "00000000-0000-4000-8000-000000000001";
const definition = () => ({
  name: "Conditional scalar comparison", objective: "Compare explicit human assumptions", decisionUse: "Prepare evidence for a human-owned review", ownerUserId: "local-board", scope: { type: "company", id: null }, calculationType: "formula", inputs: [],
  assumptions: [{ key: "capacity", name: "Declared conditional capacity", type: "numeric", unit: {}, nominal: 10, range: { minimum: 0, maximum: 20 }, evidence: [{ kind: "human_statement", rationale: "Human-declared assumption without observed source claims" }], confidence: "human_asserted", uncertaintyRationale: "No quantitative uncertainty has been empirically calibrated", ownerUserId: "local-board", controllable: false, distribution: null }],
  formula: [{ key: "value", operation: "input", inputKey: "capacity" }], outputs: [{ key: "capacity", name: "Conditional capacity", nodeKey: "value", unit: {}, constraints: null }],
  cases: [{ key: "base", name: "Base case", kind: "base", changes: [] }], uncertaintyPolicy: { kind: "deterministic", rationale: "Nominal arithmetic only; no propagation of ranges" },
  nonModeledEffects: ["External constraints and demand responses are unmodeled"], sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [id], retentionDays: 30,
});
describe("Strict public business scenario contracts", () => {
  it("admits conditional definitions and identity-only runs without accepting copied facts or claimed execution authority", () => {
    expect(createBusinessScenarioSchema.safeParse({ key: "conditional_capacity", definition: definition() }).success).toBe(true);
    expect(runBusinessScenarioSchema.parse({ expectedRevision: 1, versionId: id, seed: 0 }).seed).toBe(0);
    for (const extra of [{ inputs: [{ value: 100 }] }, { result: { status: "calculated" } }, { contentHash: "a".repeat(64) }, { execute: true }, { provider: "llm_simulator" }]) {
      expect(runBusinessScenarioSchema.safeParse({ expectedRevision: 1, versionId: id, seed: null, ...extra }).success).toBe(false);
    }
    expect(businessScenarioDefinitionSchema.safeParse({ ...definition(), calculationType: "causal_model" }).success).toBe(false);
    expect(businessScenarioDefinitionSchema.safeParse({ ...definition(), calculationType: "validated_automation_artifact" }).success).toBe(false);
  });
  it("requires one exact validated artifact binding without fallback formulas or copied output facts", () => {
    const raw = { ...definition(), calculationType: "validated_automation_artifact", calculationRef: { artifactId: id, versionId: id, contentHash: "a".repeat(64) }, formula: [], outputs: [{ ...definition().outputs[0], nodeKey: "capacity" }] };
    expect(businessScenarioDefinitionSchema.safeParse(raw).success).toBe(true);
    for (const value of [{ ...raw, calculationRef: undefined }, { ...raw, formula: definition().formula }, { ...raw, calculationRef: { ...raw.calculationRef, validated: true } }, { ...raw, calculationType: "formula" }, { ...raw, seed: 0 }, { ...raw, outputs: [{ ...raw.outputs[0], value: 100 }] }]) expect(businessScenarioDefinitionSchema.safeParse(value).success).toBe(false);
    expect(businessScenarioDefinitionSchema.parse(definition())).not.toHaveProperty("calculationRef");
  });
  it("distinguishes hypothetical external conditions from controllable interventions and requires honest evidence", () => {
    const raw = businessScenarioDefinitionSchema.parse(definition());
    raw.cases.push({ key: "stress", name: "External stress", kind: "stress", changes: [{ kind: "hypothetical_condition", assumptionKey: "capacity", value: 5, rationale: "Consider a hypothetical external reduction in available capacity" }] });
    expect(businessScenarioDefinitionSchema.safeParse(raw).success).toBe(true);
    raw.cases[1].changes[0].kind = "intervention";
    expect(businessScenarioDefinitionSchema.safeParse(raw).success).toBe(false);
    const unsupported = businessScenarioDefinitionSchema.parse(definition()); unsupported.assumptions[0].confidence = "evidence_supported";
    expect(businessScenarioDefinitionSchema.safeParse(unsupported).success).toBe(false);
  });
  it("requires one unchanged base, distinct inputs/assumptions, real evidence references and declared output units", () => {
    const original = businessScenarioDefinitionSchema.parse(definition());
    const noBase = structuredClone(original); noBase.cases[0].kind = "option";
    const twoBases = structuredClone(original); twoBases.cases.push({ ...twoBases.cases[0], key: "other_base" });
    const unknownEvidence = structuredClone(original); unknownEvidence.assumptions[0].evidence = [{ kind: "source_input", inputKey: "missing" }];
    const collision = structuredClone(original); collision.inputs.push({ kind: "metric_observation", key: "capacity", metricId: id, metricVersionId: id, observationId: id, unit: {} });
    const wrongUnit = structuredClone(original); wrongUnit.outputs[0].unit = { second: 1 };
    for (const value of [noBase, twoBases, unknownEvidence, collision, wrongUnit]) expect(businessScenarioDefinitionSchema.safeParse(value).success).toBe(false);
    expect(() => inferBusinessScenarioFormulaUnits([{ key: "self", operation: "negate", argument: "self" }], {})).toThrow("formula_requires_prior_node");
  });
  it("rejects unnamed distributions, invalid support/probabilities, missing tolerance and silent range propagation", () => {
    for (const distribution of [
      { kind: "normal", mean: 1, sd: 2, rationale: "An unsupported unbounded distribution declaration" },
      { kind: "uniform", minimum: 10, maximum: 0, rationale: "An unordered distribution support declaration" },
      { kind: "triangular", minimum: 0, mode: 11, maximum: 10, rationale: "Mode outside the declared support is invalid" },
      { kind: "discrete", outcomes: [{ value: 1, probability: 0.8 }, { value: 2, probability: 0.8 }], rationale: "The declared masses cannot silently normalize" },
    ]) expect(businessScenarioDistributionSchema.safeParse(distribution).success).toBe(false);
    const raw = businessScenarioDefinitionSchema.parse(definition());
    raw.assumptions[0].distribution = { kind: "uniform", minimum: 0, maximum: 20, rationale: "Explicit conditional range for a human-defined distribution" };
    expect(businessScenarioDefinitionSchema.safeParse(raw).success).toBe(false);
    raw.calculationType = "bounded_monte_carlo"; raw.uncertaintyPolicy = { kind: "bounded_monte_carlo", samples: 1000, independenceRationale: "No correlations are inferred for this single assumption", stabilityAbsoluteTolerance: {} };
    expect(businessScenarioDefinitionSchema.safeParse(raw).success).toBe(false);
    raw.uncertaintyPolicy.stabilityAbsoluteTolerance = { capacity: 1 };
    expect(businessScenarioDefinitionSchema.safeParse(raw).success).toBe(true);
    raw.assumptions[0].distribution.maximum = 21;
    expect(businessScenarioDefinitionSchema.safeParse(raw).success).toBe(false);
  });
});
