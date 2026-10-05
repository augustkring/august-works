import { z } from "zod";

export const V6_FEATURES = {
  saas_deployment_profile_v6: ["SaaS deployment", "Pooled service with company membership authority."],
  saas_self_signup_v6: ["SaaS sign-up", "Public account registration after auth and email qualification."],
  email_verification_required_v6: ["Verified email", "Require verified email for new SaaS customers."],
  server_onboarding_v6: ["Durable onboarding", "Server-authoritative resumable company onboarding."],
  transactional_email_v6: ["Transactional email", "Durable Mailgun EU delivery and suppression handling."],
  billing_v6: ["Billing", "Local billing accounts and normalized provider evidence."],
  billing_checkout_v6: ["Checkout", "Idempotent Paddle checkout intents."],
  billing_entitlements_v6: ["Entitlements", "Commercial capability decisions separate from permissions."],
  billing_usage_v6: ["Usage", "Exact, deduplicated storage and runtime metering."],
  hosted_openclaw_v6: ["Hosted OpenClaw", "Company-isolated cells using V5 provider bindings."],
  runtime_host_agent_v6: ["Runtime host agent", "Outbound host control with scoped credentials and fencing."],
  runtime_dedicated_gateway_v6: ["Dedicated Gateway", "Isolated Gateway and state with possible shared host."],
  runtime_dedicated_vm_v6: ["Dedicated VM", "Provider VM reserved for one hosted runtime."],
  runtime_auto_host_scale_v6: ["Runtime scaling", "Bounded host provisioning with spend and ownership guards."],
  admin_support_v6: ["Support access", "Attributed, expiring support sessions without secret display."],
  company_deletion_v6: ["SaaS offboarding", "Resumable data lifecycle and deletion evidence."],
  domain_dual_origin_v6: ["Dual origin", "Controlled old/new origin serving with host-only cookies."],
  domain_new_primary_v6: ["New primary origin", "Configuration-driven origin migration after rehearsal."],
} as const;

export type V6FeatureKey = keyof typeof V6_FEATURES;
export const V6_FEATURE_KEYS = Object.keys(V6_FEATURES) as V6FeatureKey[];
export const v6FeatureFlagShape = Object.fromEntries(
  V6_FEATURE_KEYS.map((key) => [key, z.boolean().default(false)]),
) as Record<V6FeatureKey, z.ZodDefault<z.ZodBoolean>>;
export const v6FeatureFlagsSchema = z.object(v6FeatureFlagShape);
export type V6FeatureFlags = z.infer<typeof v6FeatureFlagsSchema>;

export const V6_FEATURE_DEPENDENCIES: Record<V6FeatureKey, readonly V6FeatureKey[]> = {
  saas_deployment_profile_v6: [],
  saas_self_signup_v6: ["email_verification_required_v6"],
  email_verification_required_v6: ["transactional_email_v6"],
  server_onboarding_v6: ["email_verification_required_v6", "billing_entitlements_v6"],
  transactional_email_v6: ["saas_deployment_profile_v6"],
  billing_v6: ["saas_deployment_profile_v6"],
  billing_checkout_v6: ["billing_entitlements_v6"],
  billing_entitlements_v6: ["billing_v6"],
  billing_usage_v6: ["billing_entitlements_v6"],
  hosted_openclaw_v6: ["runtime_host_agent_v6", "billing_entitlements_v6", "billing_usage_v6"],
  runtime_host_agent_v6: ["saas_deployment_profile_v6"],
  runtime_dedicated_gateway_v6: ["hosted_openclaw_v6"],
  runtime_dedicated_vm_v6: ["runtime_dedicated_gateway_v6"],
  runtime_auto_host_scale_v6: ["hosted_openclaw_v6"],
  admin_support_v6: ["saas_deployment_profile_v6"],
  company_deletion_v6: ["server_onboarding_v6"],
  domain_dual_origin_v6: ["saas_deployment_profile_v6"],
  domain_new_primary_v6: ["domain_dual_origin_v6"],
};

export const V6_ROLLOUT = Object.fromEntries(V6_FEATURE_KEYS.map((key) => [key, {
  owner: "August Works platform operator",
  defaultEnabled: false,
  scope: "instance",
  dependencies: V6_FEATURE_DEPENDENCIES[key],
  rollback: key === "saas_deployment_profile_v6"
    ? "Stop SaaS admission on restart; do not fall back to local implicit authority. Retain tenant data."
    : `Disable ${key} and dependent admission paths; retain durable operations, evidence and tenant data.`,
  removalCondition: "Remove only after target-environment qualification and a reviewed migration of persisted settings.",
  reviewDate: "2026-11-04",
}])) as Record<V6FeatureKey, {
  owner: string; defaultEnabled: false; scope: "instance";
  dependencies: readonly V6FeatureKey[]; rollback: string;
  removalCondition: string; reviewDate: string;
}>;

export function v6FeatureEnabled(flags: Partial<V6FeatureFlags>, key: V6FeatureKey): boolean {
  return flags[key] === true && V6_FEATURE_DEPENDENCIES[key].every((required) => v6FeatureEnabled(flags, required));
}
