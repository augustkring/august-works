import { z } from "zod";
import { V7_FEATURES, v7FeatureEnabled } from "./v7-feature-flags.js";
import { type V8FeatureSettings } from "./v8-feature-flags.js";
import { v6FeatureEnabled, type V6FeatureKey } from "./v6-feature-flags.js";

/** Rollout admission only. Enabling a flag never grants authority or certifies readiness. */
export const V9_FEATURES = {
  experience_projection_v9: [
    "Experience projections",
    "Current-authority, source-linked customer read models.",
  ],
  progressive_shell_v9: [
    "Customer navigation",
    "Role-aware Home, Needs You, Work, Agents, Apps and Company.",
  ],
  home_v9: [
    "Home",
    "Meaningful work, outcomes and attention over canonical domains.",
  ],
  ambient_commands_v9: [
    "Ask August",
    "Deterministic commands and governed draft authoring.",
  ],
  activation_v9: [
    "Intent-first activation",
    "Resumable onboarding and verified first value.",
  ],
  hire_agent_v9: [
    "Hire Agent",
    "Capability, access, authority, safe test and activation receipt.",
  ],
  action_cards_v9: [
    "Customer action cards",
    "Bounded typed UI; canonical authorization at execution time.",
  ],
  maintenance_autopilot_v9: [
    "Maintenance Autopilot",
    "Policy-bounded native maintenance with verified outcomes.",
  ],
  notification_policy_v9: [
    "Interruption policy",
    "Canonical notifications with dedupe and quiet hours.",
  ],
  customer_feedback_v9: [
    "Customer Feedback",
    "Native company-scoped product feedback with safe-context defaults.",
  ],
  experience_analytics_v9: [
    "Experience analytics",
    "Purpose-bound, content-free customer experience measurements.",
  ],
  ag_ui_v9: [
    "AG-UI adapter",
    "Optional qualified protocol projection; no new authority.",
  ],
  a2ui_v9: ["A2UI adapter", "Optional bounded catalog compatibility."],
  mcp_apps_v9: [
    "MCP Apps",
    "Optional sandboxed Tool Gateway host; qualification required.",
  ],
} as const;
export type V9FeatureKey = keyof typeof V9_FEATURES;
export const V9_FEATURE_KEYS = Object.keys(V9_FEATURES) as V9FeatureKey[];
export const v9FeatureFlagShape = Object.fromEntries(
  V9_FEATURE_KEYS.map((key) => [key, z.boolean().default(false)]),
) as Record<V9FeatureKey, z.ZodDefault<z.ZodBoolean>>;
export const v9FeatureFlagsSchema = z.object(v9FeatureFlagShape);
export type V9FeatureFlags = z.infer<typeof v9FeatureFlagsSchema>;
export type V9FeatureSettings = V8FeatureSettings & Partial<V9FeatureFlags>;
type Prerequisite =
  | V9FeatureKey
  | "agent_packages_v7"
  | "core_stewards_v7"
  | "free_core_commercial_v7"
  | "server_onboarding_v6";
export const V9_FEATURE_DEPENDENCIES: Record<
  V9FeatureKey,
  readonly Prerequisite[]
> = {
  experience_projection_v9: [],
  progressive_shell_v9: ["experience_projection_v9"],
  home_v9: ["experience_projection_v9"],
  ambient_commands_v9: ["experience_projection_v9"],
  activation_v9: ["server_onboarding_v6", "free_core_commercial_v7"],
  hire_agent_v9: ["agent_packages_v7"],
  action_cards_v9: ["experience_projection_v9"],
  maintenance_autopilot_v9: ["experience_projection_v9", "core_stewards_v7"],
  notification_policy_v9: [],
  customer_feedback_v9: [],
  experience_analytics_v9: [],
  ag_ui_v9: ["action_cards_v9"],
  a2ui_v9: ["action_cards_v9"],
  mcp_apps_v9: ["action_cards_v9"],
};
function prerequisiteEnabled(
  flags: V9FeatureSettings,
  key: Prerequisite,
): boolean {
  if (Object.hasOwn(V9_FEATURES, key))
    return v9FeatureEnabled(flags, key as V9FeatureKey);
  if (Object.hasOwn(V7_FEATURES, key))
    return v7FeatureEnabled(flags, key as keyof typeof V7_FEATURES);
  return v6FeatureEnabled(flags, key as V6FeatureKey);
}
export function v9FeatureEnabled(
  flags: V9FeatureSettings,
  key: V9FeatureKey,
): boolean {
  return (
    flags[key] === true &&
    V9_FEATURE_DEPENDENCIES[key].every((required) =>
      prerequisiteEnabled(flags, required),
    )
  );
}
export function v9FeatureDependencyIssues(flags: V9FeatureSettings) {
  return V9_FEATURE_KEYS.flatMap((feature) =>
    flags[feature] !== true
      ? []
      : V9_FEATURE_DEPENDENCIES[feature]
          .filter((required) => !prerequisiteEnabled(flags, required))
          .map((required) => ({ feature, required })),
  );
}
export class V9FeatureDependencyError extends Error {
  constructor(
    public readonly issues: ReturnType<typeof v9FeatureDependencyIssues>,
  ) {
    super(
      `Invalid V9 feature dependencies: ${issues.map(({ feature, required }) => `${feature} requires ${required}`).join("; ")}`,
    );
    this.name = "V9FeatureDependencyError";
  }
}
export function assertV9FeatureDependencies(flags: V9FeatureSettings): void {
  const issues = v9FeatureDependencyIssues(flags);
  if (issues.length) throw new V9FeatureDependencyError(issues);
}
export const V9_ROLLOUT = Object.fromEntries(
  V9_FEATURE_KEYS.map((key) => [
    key,
    {
      owner: "August Works platform operator",
      defaultEnabled: false,
      scope: "instance",
      dependencies: V9_FEATURE_DEPENDENCIES[key],
      rollback: `Disable ${key} and dependents atomically; preserve canonical state and recovery/privacy obligations.`,
    },
  ]),
) as Record<
  V9FeatureKey,
  {
    owner: string;
    defaultEnabled: false;
    scope: "instance";
    dependencies: readonly Prerequisite[];
    rollback: string;
  }
>;
