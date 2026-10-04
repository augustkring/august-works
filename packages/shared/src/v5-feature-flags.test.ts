import { describe, expect, it } from "vitest";
import { instanceExperimentalSettingsSchema } from "./validators/instance.js";
import { INSTANCE_FEATURE_CATALOG } from "./feature-catalog.js";
import { V5_FEATURE_KEYS, v5FeatureEnabled, v5FeatureFlagsSchema } from "./v5-feature-flags.js";

describe("V5 rollout", () => {
  it("leaves all V5 paths off for existing instance settings", () => {
    const settings = instanceExperimentalSettingsSchema.parse({ enableWorkflowsV1: true });
    expect(settings.enableWorkflowsV1).toBe(true);
    for (const key of V5_FEATURE_KEYS) {
      expect(settings[key]).toBe(false);
      expect(INSTANCE_FEATURE_CATALOG[key].cloudDefault).toBe(false);
    }
  });
  it("cannot enable delegation or autonomous promotion through an incomplete flag set", () => {
    expect(v5FeatureEnabled({ cross_company_execution_v5: true }, "cross_company_execution_v5")).toBe(false);
    expect(v5FeatureEnabled({ skill_autonomous_promotion_v5: true }, "skill_autonomous_promotion_v5")).toBe(false);
    const all = Object.fromEntries(V5_FEATURE_KEYS.map((key) => [key, true]));
    const flags = v5FeatureFlagsSchema.parse(all);
    for (const key of V5_FEATURE_KEYS) expect(v5FeatureEnabled({ ...flags, enableFoundationV1: true, enableContextEngineV1: true }, key)).toBe(true);
    expect(v5FeatureEnabled(flags, "agent_runtime_fabric_v5")).toBe(false);
    expect(v5FeatureEnabled({ ...flags, agent_identities_v5: false }, "cross_company_execution_v5")).toBe(false);
  });
});
