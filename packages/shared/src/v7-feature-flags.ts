import { z } from "zod";
import { V5_FEATURES, v5FeatureEnabled, type V5FeatureFlags, type V5FeatureKey } from "./v5-feature-flags.js";
import { V6_FEATURES, v6FeatureEnabled, type V6FeatureFlags, type V6FeatureKey } from "./v6-feature-flags.js";

// Reserve admission gates only. A flag is neither implementation evidence nor authorization.
export const V7_FEATURES = {
  readiness_engine_v7: ["Readiness engine", "Action-specific knowledge requirements and quality findings."],
  foundation_bootstrap_v7: ["Foundation bootstrap", "Evidence-based Foundation proposals subject to existing review."],
  cognitive_memory_v7: ["Cognitive memory", "Derived cognitive projections with August Works Memory as authority."],
  hindsight_provider_v7: ["Hindsight provider", "Optional qualified provider for governed cognitive projections."],
  memory_observations_v7: ["Memory observations", "Evidence-rooted observations with correction and invalidation."],
  memory_models_v7: ["Memory models", "Derived models over eligible observations with retained lineage."],
  learning_engine_v7: ["Learning engine", "Evaluated hypotheses and governed change proposals."],
  orchestration_v7: ["Orchestration", "Bounded plans extending canonical Tasks and Workflows."],
  supervision_v7: ["Supervision", "Deterministic intervention over durable worker attempts."],
  verifier_v7: ["Verifier", "Risk-proportionate independent evidence and postcondition checks."],
  work_signals_v7: ["Work signals", "Authorized source events produce reviewable work candidates."],
  proactive_followup_v7: ["Proactive follow-up", "Bounded follow-up using existing Routines and notifications."],
  sandbox_abstraction_v7: ["Sandbox abstraction", "Explicit filesystem, process, network, secret and resource policy."],
  openshell_v7: ["OpenShell", "Qualified sandbox enforcement below managed runtime cells."],
  ai_use_cases_v7: ["AI use cases", "Versioned intended purpose and operator-role governance."],
  governance_evidence_v7: ["Governance evidence", "Claims linked to controls, evidence and revalidation owners."],
  free_core_commercial_v7: ["Free Core", "Permanent free baseline through existing billing and capacity contracts."],
  agent_packages_v7: ["Agent packages", "Immutable evaluated packages of existing Role Packs, Skills and Playbooks."],
  core_stewards_v7: ["Core stewards", "Event-driven stewardship through governed domain jobs."],
  enterprise_identity_v7: ["Enterprise identity", "Contracted enterprise identity with current membership authority."],
} as const;

export type V7FeatureKey = keyof typeof V7_FEATURES;
export const V7_FEATURE_KEYS = Object.keys(V7_FEATURES) as V7FeatureKey[];
export const v7FeatureFlagShape = Object.fromEntries(
  V7_FEATURE_KEYS.map((key) => [key, z.boolean().default(false)]),
) as Record<V7FeatureKey, z.ZodDefault<z.ZodBoolean>>;
export const v7FeatureFlagsSchema = z.object(v7FeatureFlagShape);
export type V7FeatureFlags = z.infer<typeof v7FeatureFlagsSchema>;

export const V7_FEATURE_DEPENDENCIES: Record<V7FeatureKey, readonly V7FeatureKey[]> = {
  readiness_engine_v7: [],
  foundation_bootstrap_v7: ["readiness_engine_v7"],
  cognitive_memory_v7: [],
  hindsight_provider_v7: ["cognitive_memory_v7"],
  memory_observations_v7: ["cognitive_memory_v7"],
  memory_models_v7: ["cognitive_memory_v7", "memory_observations_v7"],
  learning_engine_v7: ["memory_observations_v7"],
  orchestration_v7: ["readiness_engine_v7"],
  supervision_v7: ["orchestration_v7"],
  verifier_v7: ["supervision_v7"],
  work_signals_v7: [],
  proactive_followup_v7: ["work_signals_v7"],
  sandbox_abstraction_v7: [],
  openshell_v7: ["sandbox_abstraction_v7"],
  ai_use_cases_v7: [],
  governance_evidence_v7: ["ai_use_cases_v7"],
  free_core_commercial_v7: [],
  agent_packages_v7: [],
  core_stewards_v7: ["readiness_engine_v7", "learning_engine_v7", "governance_evidence_v7"],
  enterprise_identity_v7: ["governance_evidence_v7"],
};

export type V7BaseFeatureKey =
  | "enableFoundationV1"
  | "enableContextEngineV1"
  | "enableCollectiveMemoryV1"
  | "enableWorkflowsV1"
  | "enableChatConnectors"
  | V5FeatureKey
  | V6FeatureKey;
export type V7FeatureSettings = Partial<V7FeatureFlags & V5FeatureFlags & V6FeatureFlags>
  & Partial<Record<V7BaseFeatureKey, boolean>>;

// Check predecessor features through their effective gates, including transitive dependencies.
export const V7_BASE_FEATURE_REQUIREMENTS: Record<V7FeatureKey, readonly V7BaseFeatureKey[]> = {
  readiness_engine_v7: ["enableFoundationV1", "enableContextEngineV1"],
  foundation_bootstrap_v7: ["enableFoundationV1"],
  cognitive_memory_v7: ["enableCollectiveMemoryV1", "enableContextEngineV1"],
  hindsight_provider_v7: [],
  memory_observations_v7: [],
  memory_models_v7: [],
  learning_engine_v7: ["skill_lifecycle_v5", "playbooks_v5"],
  orchestration_v7: ["enableWorkflowsV1", "agent_runtime_fabric_v5"],
  supervision_v7: ["agent_runtime_fabric_v5"],
  verifier_v7: [],
  work_signals_v7: ["enableChatConnectors"],
  proactive_followup_v7: [],
  sandbox_abstraction_v7: [],
  openshell_v7: ["hosted_openclaw_v6"],
  ai_use_cases_v7: [],
  governance_evidence_v7: [],
  free_core_commercial_v7: ["billing_entitlements_v6", "billing_usage_v6"],
  agent_packages_v7: ["role_packs_v5", "skill_resolver_v5", "skill_lifecycle_v5", "playbooks_v5", "billing_v6"],
  core_stewards_v7: [],
  enterprise_identity_v7: ["saas_deployment_profile_v6"],
};

function prerequisiteEnabled(flags: V7FeatureSettings, key: V7BaseFeatureKey): boolean {
  if (Object.hasOwn(V5_FEATURES, key)) return v5FeatureEnabled(flags, key as V5FeatureKey);
  if (Object.hasOwn(V6_FEATURES, key)) return v6FeatureEnabled(flags, key as V6FeatureKey);
  return flags[key] === true;
}

export function v7FeatureEnabled(flags: V7FeatureSettings, key: V7FeatureKey): boolean {
  return flags[key] === true
    && V7_BASE_FEATURE_REQUIREMENTS[key].every((required) => prerequisiteEnabled(flags, required))
    && V7_FEATURE_DEPENDENCIES[key].every((required) => v7FeatureEnabled(flags, required));
}

export interface V7FeatureDependencyIssue {
  feature: V7FeatureKey;
  required: V7FeatureKey | V7BaseFeatureKey;
}

export function v7FeatureDependencyIssues(flags: V7FeatureSettings): V7FeatureDependencyIssue[] {
  return V7_FEATURE_KEYS.flatMap((feature) => flags[feature] !== true ? [] : [
    ...V7_FEATURE_DEPENDENCIES[feature]
      .filter((required) => !v7FeatureEnabled(flags, required))
      .map((required) => ({ feature, required })),
    ...V7_BASE_FEATURE_REQUIREMENTS[feature]
      .filter((required) => !prerequisiteEnabled(flags, required))
      .map((required) => ({ feature, required })),
  ]);
}

export class V7FeatureDependencyError extends Error {
  constructor(public readonly issues: readonly V7FeatureDependencyIssue[]) {
    super(`Invalid V7 feature dependencies: ${issues.map(({ feature, required }) => `${feature} requires ${required}`).join("; ")}`);
    this.name = "V7FeatureDependencyError";
  }
}

export function assertV7FeatureDependencies(flags: V7FeatureSettings): void {
  const issues = v7FeatureDependencyIssues(flags);
  if (issues.length) throw new V7FeatureDependencyError(issues);
}

export const V7_ROLLOUT = Object.fromEntries(V7_FEATURE_KEYS.map((key) => [key, {
  owner: "August Works platform operator",
  defaultEnabled: false,
  reviewRequiredBeforeEnable: true,
  scope: "instance",
  dependencies: V7_FEATURE_DEPENDENCIES[key],
  prerequisites: V7_BASE_FEATURE_REQUIREMENTS[key],
  rollback: key === "openshell_v7"
    ? "Stop workloads requiring OpenShell assurance; never fall back to unsandboxed execution. Retain evidence."
    : `Disable ${key} with its dependents; retain canonical state, immutable versions and evidence.`,
}])) as Record<V7FeatureKey, {
  owner: string; defaultEnabled: false; reviewRequiredBeforeEnable: true; scope: "instance";
  dependencies: readonly V7FeatureKey[]; prerequisites: readonly V7BaseFeatureKey[]; rollback: string;
}>;
