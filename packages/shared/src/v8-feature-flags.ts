import { z } from "zod";
import { V7_FEATURES, v7FeatureEnabled, type V7FeatureKey, type V7FeatureSettings } from "./v7-feature-flags.js";

// Rollout configuration only; implementation, provider qualification and authority are separate gates.
export const V8_FEATURES = {
  business_events_v8: ["Business events", "Source-linked analytical projections of canonical business facts."],
  business_metrics_v8: ["Business metrics", "Governed definitions, observations and targets with explicit authority."],
  semantic_provider_metricflow_v8: ["MetricFlow", "Optional qualified customer semantic provider."],
  semantic_provider_cube_v8: ["Cube", "Optional qualified customer semantic provider."],
  analytical_lineage_v8: ["Analytical lineage", "Versioned input and transformation provenance; never an access grant."],
  strategy_execution_v8: ["Strategy and execution", "Typed links between existing Foundation, Goals and Work."],
  process_intelligence_v8: ["Process intelligence", "Evidence-backed process findings after process-data readiness."],
  process_ocel_export_v8: ["Object-centric export", "Portable governed process events and object relationships."],
  process_provider_external_v8: ["Process provider", "Optional qualified read-only analytical worker."],
  decision_intelligence_v8: ["Decision intelligence", "Context and outcome reviews around canonical Decisions."],
  business_forecasting_v8: ["Business forecasts", "Versioned forecasts with time-safe baseline backtests."],
  forecast_provider_statsforecast_v8: ["StatsForecast", "Optional qualified statistical forecasting worker."],
  scenario_planning_v8: ["Scenarios", "Conditional calculations with explicit assumptions, without commitments."],
  business_experiments_v8: ["Business experiments", "Governed protocols, assignment and trustworthy results."],
  causal_claims_v8: ["Causal evidence", "Explicit identification, assumptions, robustness and abstention."],
  causal_provider_dowhy_v8: ["DoWhy", "Optional qualified causal analysis worker."],
  adaptive_planning_v8: ["Adaptive planning", "Evidence-backed proposals applied by existing authority owners."],
  planning_optimizer_v8: ["Planning constraints", "Bounded deterministic feasibility and allocation proposals."],
  planning_provider_ortools_v8: ["OR-Tools", "Optional qualified mathematical planning worker."],
  management_reviews_v8: ["Management reviews", "Concise historical review snapshots with evidence-linked claims."],
  management_chat_tools_v8: ["Management tools", "Bounded management evidence through existing authorized channels."],
} as const;

export type V8FeatureKey = keyof typeof V8_FEATURES;
export const V8_FEATURE_KEYS = Object.keys(V8_FEATURES) as V8FeatureKey[];
export const v8FeatureFlagShape = Object.fromEntries(V8_FEATURE_KEYS.map((key) => [key, z.boolean().default(false)])) as Record<V8FeatureKey, z.ZodDefault<z.ZodBoolean>>;
export const v8FeatureFlagsSchema = z.object(v8FeatureFlagShape);
export type V8FeatureFlags = z.infer<typeof v8FeatureFlagsSchema>;
export type V8FeatureSettings = V7FeatureSettings & Partial<V8FeatureFlags> & Partial<Record<V7FeatureKey | "enableDecisions", boolean>>;
type Prerequisite = V8FeatureKey | V7FeatureKey | "enableFoundationV1" | "enableContextEngineV1" | "enableDecisions";

export const V8_FEATURE_DEPENDENCIES: Record<V8FeatureKey, readonly Prerequisite[]> = {
  business_events_v8: [],
  business_metrics_v8: ["analytical_lineage_v8"],
  semantic_provider_metricflow_v8: ["business_metrics_v8"],
  semantic_provider_cube_v8: ["business_metrics_v8"],
  analytical_lineage_v8: [],
  strategy_execution_v8: ["business_metrics_v8", "enableFoundationV1"],
  process_intelligence_v8: ["business_events_v8", "analytical_lineage_v8"],
  process_ocel_export_v8: ["business_events_v8"],
  process_provider_external_v8: ["process_intelligence_v8"],
  decision_intelligence_v8: ["business_metrics_v8", "enableDecisions"],
  business_forecasting_v8: ["business_metrics_v8"],
  forecast_provider_statsforecast_v8: ["business_forecasting_v8"],
  scenario_planning_v8: ["business_metrics_v8"],
  business_experiments_v8: ["business_metrics_v8", "ai_use_cases_v7"],
  causal_claims_v8: ["business_experiments_v8"],
  causal_provider_dowhy_v8: ["causal_claims_v8"],
  adaptive_planning_v8: ["strategy_execution_v8", "business_metrics_v8"],
  planning_optimizer_v8: ["adaptive_planning_v8"],
  planning_provider_ortools_v8: ["planning_optimizer_v8"],
  management_reviews_v8: ["business_metrics_v8"],
  management_chat_tools_v8: ["management_reviews_v8", "enableContextEngineV1"],
};

function prerequisiteEnabled(flags: V8FeatureSettings, key: Prerequisite): boolean {
  if (Object.hasOwn(V8_FEATURES, key)) return v8FeatureEnabled(flags, key as V8FeatureKey);
  if (Object.hasOwn(V7_FEATURES, key)) return v7FeatureEnabled(flags, key as V7FeatureKey);
  return flags[key] === true;
}

export function v8FeatureEnabled(flags: V8FeatureSettings, key: V8FeatureKey): boolean {
  return flags[key] === true && V8_FEATURE_DEPENDENCIES[key].every((required) => prerequisiteEnabled(flags, required));
}

export function v8FeatureDependencyIssues(flags: V8FeatureSettings) {
  return V8_FEATURE_KEYS.flatMap((feature) => flags[feature] !== true ? [] : V8_FEATURE_DEPENDENCIES[feature]
    .filter((required) => !prerequisiteEnabled(flags, required)).map((required) => ({ feature, required })));
}

export class V8FeatureDependencyError extends Error {
  constructor(public readonly issues: ReturnType<typeof v8FeatureDependencyIssues>) {
    super(`Invalid V8 feature dependencies: ${issues.map(({ feature, required }) => `${feature} requires ${required}`).join("; ")}`);
    this.name = "V8FeatureDependencyError";
  }
}

export function assertV8FeatureDependencies(flags: V8FeatureSettings): void {
  const issues = v8FeatureDependencyIssues(flags);
  if (issues.length) throw new V8FeatureDependencyError(issues);
}

export const V8_ROLLOUT = Object.fromEntries(V8_FEATURE_KEYS.map((key) => [key, {
  owner: "August Works platform operator", defaultEnabled: false, scope: "instance",
  dependencies: V8_FEATURE_DEPENDENCIES[key],
  rollback: `Disable ${key} and its dependents; stop new operations, preserve historical evidence and canonical state.`,
}])) as Record<V8FeatureKey, { owner: string; defaultEnabled: false; scope: "instance"; dependencies: readonly Prerequisite[]; rollback: string }>;
