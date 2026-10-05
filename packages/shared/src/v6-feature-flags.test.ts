import { describe, expect, it } from "vitest";
import { instanceExperimentalSettingsSchema, patchInstanceExperimentalSettingsSchema } from "./validators/instance.js";
import { v6FeatureEnabled, V6_FEATURE_KEYS, v6FeatureFlagsSchema } from "./v6-feature-flags.js";

describe("V6 admission gates", () => {
  it("does not activate SaaS paths when historical settings are loaded", () => {
    const old = instanceExperimentalSettingsSchema.parse({ enableApps: true });
    for (const key of V6_FEATURE_KEYS) expect(v6FeatureEnabled(old, key)).toBe(false);
    expect(patchInstanceExperimentalSettingsSchema.parse({ billing_v6: true })).toEqual({ billing_v6: true });
  });

  it("closes dependent admission when billing, email, or runtime control is disabled", () => {
    const flags = v6FeatureFlagsSchema.parse(Object.fromEntries(V6_FEATURE_KEYS.map((key) => [key, true])));
    expect(v6FeatureEnabled(flags, "runtime_dedicated_vm_v6")).toBe(true);
    expect(v6FeatureEnabled({ ...flags, billing_entitlements_v6: false }, "hosted_openclaw_v6")).toBe(false);
    expect(v6FeatureEnabled({ ...flags, transactional_email_v6: false }, "saas_self_signup_v6")).toBe(false);
    expect(v6FeatureEnabled({ ...flags, runtime_host_agent_v6: false }, "runtime_dedicated_vm_v6")).toBe(false);
    expect(v6FeatureEnabled({ ...flags, saas_deployment_profile_v6: false }, "domain_new_primary_v6")).toBe(false);
  });
});
