import { z } from "zod";

const id = z.string().uuid();
const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const prose = z.string().trim().min(10).max(2000);
const finite = z.number().finite();
/** Explicit dimensions, including separate currencies. An owner must derive
 * observed units from the pinned metric definition, never from this declaration. */
export const businessScenarioUnitSchema = z.record(
  z.string().regex(/^(issue|project|person|customer|second|currency_[A-Z]{3})$/),
  z.number().int().min(-6).max(6),
).refine(value => Object.keys(value).length <= 8, "At most eight unit dimensions")
  .transform(value => Object.fromEntries(Object.entries(value).filter(([, exponent]) => exponent !== 0).sort(([a], [b]) => a.localeCompare(b))));
export type BusinessScenarioUnit = z.infer<typeof businessScenarioUnitSchema>;

export const businessScenarioDistributionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("uniform"), minimum: finite, maximum: finite, rationale: prose }).strict(),
  z.object({ kind: z.literal("triangular"), minimum: finite, mode: finite, maximum: finite, rationale: prose }).strict(),
  z.object({ kind: z.literal("discrete"), outcomes: z.array(z.object({ value: finite, probability: finite.positive().max(1) }).strict()).min(2).max(32), rationale: prose }).strict(),
]).superRefine((value, ctx) => {
  const reject = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.kind === "discrete") {
    if (Math.abs(value.outcomes.reduce((sum, item) => sum + item.probability, 0) - 1) > 1e-12) reject("Declared probabilities must sum to one");
    if (new Set(value.outcomes.map(item => item.value)).size !== value.outcomes.length) reject("Discrete outcomes cannot repeat");
  } else {
    if (!(value.minimum < value.maximum)) reject("A distribution requires a nonempty range");
    if (value.kind === "triangular" && (value.mode < value.minimum || value.mode > value.maximum)) reject("Mode must be inside the declared range");
  }
});
export const businessScenarioAssumptionSchema = z.object({
  key, name: z.string().trim().min(2).max(160), type: z.literal("numeric"), unit: businessScenarioUnitSchema,
  nominal: finite, range: z.object({ minimum: finite, maximum: finite }).strict(),
  evidence: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("source_input"), inputKey: key }).strict(),
    z.object({ kind: z.literal("human_statement"), rationale: prose }).strict(),
  ])).min(1).max(16),
  confidence: z.enum(["human_asserted", "evidence_supported"]), uncertaintyRationale: prose,
  ownerUserId: z.string().trim().min(1).max(200), controllable: z.boolean(),
  distribution: businessScenarioDistributionSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  const reject = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.range.minimum > value.nominal || value.nominal > value.range.maximum) reject("Nominal value must be inside the declared range");
  if (value.confidence === "evidence_supported" && !value.evidence.some(item => item.kind === "source_input")) reject("Evidence-supported assumptions require an actual input pin");
  const distribution = value.distribution;
  const values = !distribution ? [] : distribution.kind === "discrete" ? distribution.outcomes.map(item => item.value) : [distribution.minimum, distribution.maximum];
  if (values.some(item => item < value.range.minimum || item > value.range.maximum)) reject("Distribution support must remain inside the declared assumption range");
});

export const businessScenarioSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("metric_observation"), key, metricId: id, metricVersionId: id, observationId: id, unit: businessScenarioUnitSchema }).strict(),
  z.object({ kind: z.literal("forecast_point"), key, specId: id, versionId: id, runId: id, pointIndex: z.number().int().min(0).max(59), unit: businessScenarioUnitSchema }).strict(),
]);
export const businessScenarioFormulaNodeSchema = z.discriminatedUnion("operation", [
  z.object({ key, operation: z.literal("input"), inputKey: key }).strict(),
  z.object({ key, operation: z.literal("negate"), argument: key }).strict(),
  z.object({ key, operation: z.enum(["add", "subtract", "multiply", "divide", "minimum", "maximum"]), left: key, right: key }).strict(),
]);
export type BusinessScenarioFormulaNode = z.infer<typeof businessScenarioFormulaNodeSchema>;
export function normalizeBusinessScenarioUnit(unit: BusinessScenarioUnit): BusinessScenarioUnit {
  return Object.fromEntries(Object.entries(unit).filter(([, exponent]) => exponent !== 0).sort(([a], [b]) => a.localeCompare(b)));
}
export function sameBusinessScenarioUnit(a: BusinessScenarioUnit, b: BusinessScenarioUnit): boolean {
  return JSON.stringify(normalizeBusinessScenarioUnit(a)) === JSON.stringify(normalizeBusinessScenarioUnit(b));
}
/** Match an explicit immutable artifact schema unit contract, without claiming
 * that those human-declared units prove model validity or calibration. */
export function matchesBusinessScenarioArtifactSchema(schema: Record<string, unknown>, units: Record<string, BusinessScenarioUnit>): boolean {
  const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const properties = record(schema.properties), declared = record(schema["x-aw-scenario-units"]), required = schema.required, keys = Object.keys(units);
  return schema.type === "object" && schema.additionalProperties === false && !!properties && !!declared && Array.isArray(required)
    && required.length === keys.length && new Set(required).size === keys.length
    && Object.keys(properties).length === keys.length && Object.keys(declared).length === keys.length
    && keys.every(key => {
      const unit = businessScenarioUnitSchema.safeParse(declared[key]);
      return required.includes(key) && Object.hasOwn(properties, key) && record(properties[key])?.type === "number"
        && Object.hasOwn(declared, key) && unit.success && sameBusinessScenarioUnit(unit.data, units[key]);
    });
}
/** Unit inference is shared by proposal admission and runtime execution. Only
 * references to earlier nodes exist, so a program cannot recurse or loop. */
export function inferBusinessScenarioFormulaUnits(
  nodes: BusinessScenarioFormulaNode[], inputs: Record<string, BusinessScenarioUnit>,
): Map<string, BusinessScenarioUnit> {
  const units = new Map<string, BusinessScenarioUnit>();
  for (const node of nodes) {
    if (units.has(node.key)) throw new Error("duplicate_formula_node");
    let unit: BusinessScenarioUnit;
    if (node.operation === "input") {
      if (!Object.hasOwn(inputs, node.inputKey)) throw new Error("unknown_formula_input");
      unit = normalizeBusinessScenarioUnit(inputs[node.inputKey]);
    } else if (node.operation === "negate") {
      const argument = units.get(node.argument);
      if (!argument) throw new Error("formula_requires_prior_node");
      unit = argument;
    } else {
      const left = units.get(node.left), right = units.get(node.right);
      if (!left || !right) throw new Error("formula_requires_prior_node");
      if (["add", "subtract", "minimum", "maximum"].includes(node.operation)) {
        if (!sameBusinessScenarioUnit(left, right)) throw new Error("formula_unit_mismatch");
        unit = left;
      } else {
        const dimensions = new Set([...Object.keys(left), ...Object.keys(right)]);
        unit = normalizeBusinessScenarioUnit(Object.fromEntries([...dimensions].map(dimension => [dimension, (left[dimension] ?? 0) + (node.operation === "divide" ? -1 : 1) * (right[dimension] ?? 0)])));
        if (!businessScenarioUnitSchema.safeParse(unit).success) throw new Error("formula_unit_budget_exceeded");
      }
    }
    units.set(node.key, unit);
  }
  return units;
}

export const businessScenarioDefinitionSchema = z.object({
  name: z.string().trim().min(3).max(160), objective: prose, decisionUse: prose,
  ownerUserId: z.string().trim().min(1).max(200),
  scope: z.discriminatedUnion("type", [z.object({ type: z.literal("company"), id: z.null() }).strict(), z.object({ type: z.literal("project"), id }).strict()]),
  calculationType: z.enum(["formula", "validated_automation_artifact", "forecast_composition", "bounded_monte_carlo"]),
  calculationRef: z.object({ artifactId: id, versionId: id, contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  inputs: z.array(businessScenarioSourceSchema).max(32), assumptions: z.array(businessScenarioAssumptionSchema).min(1).max(32),
  formula: z.array(businessScenarioFormulaNodeSchema).max(96),
  outputs: z.array(z.object({ key, name: z.string().trim().min(2).max(160), nodeKey: key, unit: businessScenarioUnitSchema,
    constraints: z.object({ minimum: finite.nullable(), maximum: finite.nullable(), rationale: prose }).strict().nullable(),
  }).strict()).min(1).max(16),
  cases: z.array(z.object({ key, name: z.string().trim().min(2).max(160), kind: z.enum(["base", "option", "stress"]),
    changes: z.array(z.object({ kind: z.enum(["intervention", "hypothetical_condition"]), assumptionKey: key, value: finite, rationale: prose }).strict()).max(32),
  }).strict()).min(1).max(8),
  uncertaintyPolicy: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("deterministic"), rationale: prose }).strict(),
    z.object({ kind: z.literal("bounded_monte_carlo"), samples: z.number().int().min(1000).max(10_000), independenceRationale: prose,
      stabilityAbsoluteTolerance: z.record(key, finite.positive()),
    }).strict(),
  ]),
  nonModeledEffects: z.array(prose).min(1).max(16), sensitivity: z.enum(["internal", "confidential"]),
  purpose: z.literal("management_intelligence"), governanceObligationRefs: z.array(id).min(1).max(16), retentionDays: z.number().int().min(1).max(3650),
}).strict().superRefine((value, ctx) => {
  const reject = (message: string) => ctx.addIssue({ code: "custom", message });
  for (const collection of [value.inputs, value.assumptions, value.outputs, value.cases]) {
    if (new Set(collection.map(item => item.key)).size !== collection.length) reject("Keys must be unique within each collection");
  }
  const inputKeys = new Set(value.inputs.map(item => item.key));
  const assumptions = new Map(value.assumptions.map(item => [item.key, item]));
  if (value.assumptions.some(item => inputKeys.has(item.key))) reject("Assumptions cannot overwrite observed inputs");
  for (const assumption of value.assumptions) for (const evidence of assumption.evidence) {
    if (evidence.kind === "source_input" && !inputKeys.has(evidence.inputKey)) reject("Assumption evidence must refer to a declared source input");
  }
  if (new Set(value.governanceObligationRefs).size !== value.governanceObligationRefs.length) reject("Purpose references cannot repeat");
  if (value.cases.filter(item => item.kind === "base").length !== 1) reject("Exactly one explicit base case is required");
  for (const scenarioCase of value.cases) {
    if (scenarioCase.kind === "base" && scenarioCase.changes.length) reject("Base case must preserve the declared assumptions");
    if (new Set(scenarioCase.changes.map(item => item.assumptionKey)).size !== scenarioCase.changes.length) reject("Case changes cannot repeat");
    for (const change of scenarioCase.changes) {
      const assumption = assumptions.get(change.assumptionKey);
      if (!assumption || (change.kind === "intervention" && !assumption.controllable) || change.value < assumption.range.minimum || change.value > assumption.range.maximum) reject("Changes require a declared assumption/range; interventions also require controllability");
    }
  }
  for (const output of value.outputs) if (output.constraints && output.constraints.minimum !== null && output.constraints.maximum !== null && output.constraints.minimum > output.constraints.maximum) reject("Output constraint range must be ordered");
  const artifact = value.calculationType === "validated_automation_artifact";
  if (artifact) {
    if (!value.calculationRef || value.formula.length || value.outputs.some(output => output.nodeKey !== output.key)) reject("Artifact calculations require an exact binding and named artifact outputs without a fallback formula");
  } else if (value.calculationRef || !value.formula.length) reject("Native formula calculations require a formula and cannot carry an artifact binding");
  if (!artifact) try {
    const units = inferBusinessScenarioFormulaUnits(value.formula, Object.fromEntries([...value.inputs, ...value.assumptions].map(item => [item.key, item.unit])));
    for (const output of value.outputs) {
      const unit = units.get(output.nodeKey);
      if (!unit || !sameBusinessScenarioUnit(unit, output.unit)) reject("Output unit must equal the inferred formula unit");
    }
  } catch (error) { reject(error instanceof Error ? error.message : "invalid_formula"); }
  const monteCarlo = value.uncertaintyPolicy.kind === "bounded_monte_carlo";
  if ((value.calculationType === "bounded_monte_carlo") !== monteCarlo) reject("Calculation type and uncertainty policy must agree");
  if (value.calculationType === "forecast_composition" && !value.inputs.some(item => item.kind === "forecast_point")) reject("Forecast composition requires an exact native forecast point pin");
  if (value.calculationType === "formula" && value.inputs.some(item => item.kind === "forecast_point")) reject("Forecast inputs require explicit forecast composition or Monte Carlo");
  if (monteCarlo && value.uncertaintyPolicy.kind === "bounded_monte_carlo") {
    const policy = value.uncertaintyPolicy;
    if (!value.assumptions.some(item => item.distribution)) reject("Monte Carlo requires an explicitly justified distribution");
    const toleranceKeys = Object.keys(policy.stabilityAbsoluteTolerance);
    if (toleranceKeys.length !== value.outputs.length || value.outputs.some(item => !Object.hasOwn(policy.stabilityAbsoluteTolerance, item.key))) reject("Each output requires its own unit-specific stability tolerance");
    if (policy.samples * value.cases.length * value.formula.length > 2_000_000) reject("Monte Carlo formula evaluation exceeds the native work budget");
  } else if (value.assumptions.some(item => item.distribution)) reject("Distributions require explicit Monte Carlo calculation");
});
export type BusinessScenarioDefinition = z.infer<typeof businessScenarioDefinitionSchema>;
export type BusinessScenarioDistribution = z.infer<typeof businessScenarioDistributionSchema>;
export const createBusinessScenarioSchema = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/), definition: businessScenarioDefinitionSchema }).strict();
export const reviseBusinessScenarioSchema = z.object({ expectedRevision: z.number().int().positive(), definition: businessScenarioDefinitionSchema }).strict();
export const publishBusinessScenarioSchema = z.object({ expectedRevision: z.number().int().positive(), versionId: id, rationale: prose }).strict();
export const runBusinessScenarioSchema = z.object({ expectedRevision: z.number().int().positive(), versionId: id, seed: z.number().int().min(0).max(0xffffffff).nullable() }).strict();
export const retireBusinessScenarioSchema = z.object({ expectedRevision: z.number().int().positive(), rationale: prose }).strict();
export type CreateBusinessScenario = z.infer<typeof createBusinessScenarioSchema>;
export type ReviseBusinessScenario = z.infer<typeof reviseBusinessScenarioSchema>;
export type PublishBusinessScenario = z.infer<typeof publishBusinessScenarioSchema>;
export type RunBusinessScenario = z.infer<typeof runBusinessScenarioSchema>;
export type RetireBusinessScenario = z.infer<typeof retireBusinessScenarioSchema>;
export interface BusinessScenarioView {
  id: string; companyId: string; key: string; revision: number; status: "draft" | "published" | "retired";
  publishedVersionId: string | null; createdAt: string; updatedAt: string;
}
export interface BusinessScenarioVersionView {
  id: string; companyId: string; scenarioId: string; revision: number; definition: BusinessScenarioDefinition;
  contentHash: string; inputHash: string; inputs: BusinessScenarioCapturedInput[]; createdAt: string; expiresAt: string;
  currentQualification: "current" | "needs_revalidation";
}
export interface BusinessScenarioRunView {
  id: string; companyId: string; scenarioId: string; versionId: string; result: NativeBusinessScenarioResult;
  contentHash: string; createdAt: string; expiresAt: string; currentQualification: "current" | "needs_revalidation";
}
/** Internal source-owner capture; public runs cannot send values or hashes. */
export interface BusinessScenarioCapturedInput {
  key: string; kind: "metric_observation" | "forecast_point"; sourceId: string; versionId: string;
  value: number; unit: BusinessScenarioUnit; contentHash: string; pointIndex: number | null;
}
export interface NativeBusinessScenarioResult {
  engineVersion: "aw-native-business-scenario-v1"; status: "calculated" | "inconclusive" | "data_not_ready";
  definitionHash: string; inputHash: string; seed: number | null; reasons: string[];
  calculationArtifact?: { artifactId: string; versionId: string; contentHash: string; runtime: "aw-native-automation-artifact-v1" };
  cases: Array<{ key: string; name: string; kind: "base" | "option" | "stress";
    changes: Array<{ kind: "intervention" | "hypothetical_condition"; assumptionKey: string; value: number; rationale: string }>;
    outputs: Array<{ key: string; unit: BusinessScenarioUnit; nominal: number;
      differenceFromBase: number; constraint: "satisfied" | "violated" | "not_declared";
      simulation: null | { samples: number; minimum: number; p10: number; median: number; p90: number; maximum: number;
        constraintViolations: number | null; halfSampleMaximumDifference: number; stabilityAbsoluteTolerance: number };
    }>;
  }>;
  uncertainty: { method: "deterministic" | "independent_assumption_monte_carlo"; seedAlgorithm: "sha256-counter-48-v1" | null;
    coverageLevel: null; qualification: "not_assessed" | "stable_for_declared_tolerance" | "unstable";
    unstableOutputs: Array<{ caseKey: string; outputKey: string; maximumDifference: number; tolerance: number }>;
  };
  limitations: string[];
}
