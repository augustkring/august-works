import { z } from "zod";

export const V5_FEATURES = {
  agent_identities_v5: ["Agent identities", "Stable logical agent identities and home organizations."],
  agent_multi_company_presence_v5: ["Company presences", "Independent local agent authority in multiple companies."],
  agent_provider_bindings_v5: ["Provider bindings", "Scoped provider profiles, sessions and capability contracts."],
  cross_company_execution_v5: ["Cross-company execution", "Explicit delegated scopes with local authorization and provenance."],
  shared_trusted_runtime_v5: ["Shared trusted runtime", "Explicitly acknowledged reduced isolation in provider-local state."],
  company_relationships_v5: ["Company relationships", "Accepted company relationships that confer no access."],
  org_units_v5: ["Organization units", "Local organization units with human and agent memberships."],
  agent_runtime_fabric_v5: ["Agent runtime fabric", "Server-built immutable execution manifests."],
  role_packs_v5: ["Role Packs", "Versioned role requirements that never grant permissions."],
  skill_resolver_v5: ["Skill resolver", "Deterministic authorized Skill selection and context budgets."],
  skill_lifecycle_v5: ["Skill lifecycle", "Immutable active Skills, challengers, evaluations and revalidation."],
  skill_autonomous_proposals_v5: ["Autonomous Skill proposals", "Policy-bound private/proposed Skill candidates."],
  skill_autonomous_promotion_v5: ["Autonomous Skill promotion", "Explicitly governed promotion after all evaluation gates."],
  playbooks_v5: ["Playbooks", "Reviewed canonical procedures with immutable revisions."],
  playbook_skill_projection_v5: ["Playbook projection", "Candidate-only Playbook-to-Skill projection and reviewed feedback."],
  portfolio_skill_sharing_v5: ["Portfolio capability sharing", "Pinned publish, install, subscribe and fork with local governance."],
  project_roadmap_v5: ["Project Roadmap", "Canonical task planning, milestones and explicit baselines."],
  project_forecast_v5: ["Project forecast", "Separate forecasts and optimistic planning proposals."],
  project_plan_vs_actual_v5: ["Plan versus actual", "Baseline comparisons using observed execution facts."],
  portfolio_view_v5: ["Portfolio view", "Per-company authorized aggregation for Portfolio and August OS."],
} as const;

export type V5FeatureKey = keyof typeof V5_FEATURES;
export const V5_FEATURE_KEYS = Object.keys(V5_FEATURES) as V5FeatureKey[];
export const v5FeatureFlagShape = Object.fromEntries(
  V5_FEATURE_KEYS.map((key) => [key, z.boolean().default(false)]),
) as Record<V5FeatureKey, z.ZodDefault<z.ZodBoolean>>;
export const v5FeatureFlagsSchema = z.object(v5FeatureFlagShape);
export type V5FeatureFlags = z.infer<typeof v5FeatureFlagsSchema>;

export const V5_FEATURE_DEPENDENCIES: Partial<Record<V5FeatureKey, readonly V5FeatureKey[]>> = {
  agent_multi_company_presence_v5: ["agent_identities_v5"],
  agent_provider_bindings_v5: ["agent_identities_v5"],
  cross_company_execution_v5: ["agent_multi_company_presence_v5", "agent_provider_bindings_v5"],
  shared_trusted_runtime_v5: ["agent_provider_bindings_v5"],
  org_units_v5: ["agent_identities_v5"],
  agent_runtime_fabric_v5: ["agent_identities_v5", "agent_provider_bindings_v5"],
  role_packs_v5: ["agent_runtime_fabric_v5"],
  skill_resolver_v5: ["agent_runtime_fabric_v5", "role_packs_v5"],
  skill_autonomous_proposals_v5: ["skill_lifecycle_v5"],
  skill_autonomous_promotion_v5: ["skill_autonomous_proposals_v5"],
  playbook_skill_projection_v5: ["playbooks_v5", "skill_lifecycle_v5"],
  portfolio_skill_sharing_v5: ["skill_lifecycle_v5", "company_relationships_v5"],
  project_forecast_v5: ["project_roadmap_v5"],
  project_plan_vs_actual_v5: ["project_roadmap_v5"],
};

export const V5_BASE_FEATURE_REQUIREMENTS: Partial<Record<V5FeatureKey, readonly ("enableFoundationV1" | "enableContextEngineV1")[]>> = {
  agent_runtime_fabric_v5: ["enableFoundationV1", "enableContextEngineV1"],
  cross_company_execution_v5: ["enableFoundationV1", "enableContextEngineV1"],
};
export const V5_ROLLOUT = Object.fromEntries(V5_FEATURE_KEYS.map((key) => [key, {
  owner: "Instance administrator", defaultEnabled: false, reviewRequiredBeforeEnable: true,
  rollback: `Disable ${key} and dependent features; retain schemas, immutable versions and audit data.`,
}])) as Record<V5FeatureKey, { owner: string; defaultEnabled: false; reviewRequiredBeforeEnable: true; rollback: string }>;

export function v5FeatureEnabled(flags: Partial<V5FeatureFlags> & { enableFoundationV1?: boolean; enableContextEngineV1?: boolean }, key: V5FeatureKey): boolean {
  return flags[key] === true && (V5_BASE_FEATURE_REQUIREMENTS[key] ?? []).every((required) => flags[required] === true) && (V5_FEATURE_DEPENDENCIES[key] ?? []).every(
    (dependency) => v5FeatureEnabled(flags, dependency),
  );
}
