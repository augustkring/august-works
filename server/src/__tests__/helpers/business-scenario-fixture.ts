import { businessScenarioDefinitionSchema, type BusinessScenarioDefinition } from "@paperclipai/shared";
export function scenarioDefinition(policyId: string, input: BusinessScenarioDefinition["inputs"][number] | null = null) {
  const unit = input?.unit ?? {};
  return businessScenarioDefinitionSchema.parse({
    name: "Conditional native capacity model", objective: "Compare explicitly human-declared capacity assumptions", decisionUse: "Inform a human review without approving any organizational commitment", ownerUserId: "local-board", scope: { type: "company", id: null },
    calculationType: input?.kind === "forecast_point" ? "forecast_composition" : "formula", inputs: input ? [input] : [],
    assumptions: [{ key: "factor", name: "Human conditional capacity coefficient", type: "numeric", unit: {}, nominal: 2, range: { minimum: 1, maximum: 3 },
      evidence: [{ kind: "human_statement", rationale: "Synthetic human assumption for a conditional model; no empirical calibration" }], confidence: "human_asserted", uncertaintyRationale: "This coefficient is a hypothetical assumption rather than an observed causal effect", ownerUserId: "local-board", controllable: true, distribution: null }],
    formula: input ? [{ key: "source", operation: "input", inputKey: input.key }, { key: "factor", operation: "input", inputKey: "factor" }, { key: "scaled", operation: "multiply", left: "source", right: "factor" }] : [{ key: "scaled", operation: "input", inputKey: "factor" }],
    outputs: [{ key: "capacity", name: "Conditional modeled capacity", nodeKey: "scaled", unit, constraints: null }],
    cases: [{ key: "base", name: "Base case", kind: "base", changes: [] }, { key: "option", name: "Human option", kind: "option", changes: [{ kind: "intervention", assumptionKey: "factor", value: 3, rationale: "Human proposes this coefficient as a conditional intervention only" }] }],
    uncertaintyPolicy: { kind: "deterministic", rationale: "Nominal conditional arithmetic only; no interval is claimed" }, nonModeledEffects: ["External changes, demand responses and execution are unmodeled"],
    sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [policyId], retentionDays: 30,
  });
}
