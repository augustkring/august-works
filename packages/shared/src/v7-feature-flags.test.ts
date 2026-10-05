import { describe, expect, it } from "vitest";
import { INSTANCE_FEATURE_CATALOG } from "./feature-catalog.js";
import { instanceExperimentalSettingsSchema, patchInstanceExperimentalSettingsSchema } from "./validators/instance.js";
import { V5_FEATURE_KEYS } from "./v5-feature-flags.js";
import { V6_FEATURE_KEYS } from "./v6-feature-flags.js";
import {
  assertV7FeatureDependencies, V7_FEATURE_KEYS, V7_FEATURE_DEPENDENCIES,
  V7_BASE_FEATURE_REQUIREMENTS, V7_ROLLOUT, V7FeatureDependencyError,
  v7FeatureEnabled, v7FeatureDependencyIssues, v7FeatureFlagsSchema,
} from "./v7-feature-flags.js";

function completeSettings() {
  return instanceExperimentalSettingsSchema.parse({
    ...Object.fromEntries([...V5_FEATURE_KEYS, ...V6_FEATURE_KEYS, ...V7_FEATURE_KEYS].map((key) => [key, true])),
    enableFoundationV1: true, enableContextEngineV1: true,
    enableCollectiveMemoryV1: true, enableWorkflowsV1: true, enableChatConnectors: true,
  });
}

describe("V7 admission contract", () => {
  it("keeps every reserved gate off on legacy settings and both deployment catalogs", () => {
    const legacy = instanceExperimentalSettingsSchema.parse({ enableNativeRunner: false, enableWorkflowsV1: true });
    expect(V7_FEATURE_KEYS).toHaveLength(20);
    expect(v7FeatureFlagsSchema.parse({})).toEqual(Object.fromEntries(V7_FEATURE_KEYS.map((key) => [key, false])));
    for (const key of V7_FEATURE_KEYS) {
      expect(legacy[key]).toBe(false);
      expect(v7FeatureEnabled(legacy, key)).toBe(false);
      expect(INSTANCE_FEATURE_CATALOG[key]).toMatchObject({ cloudDefault: false, selfHostedDefault: false, tier: "managed" });
      expect(V7_ROLLOUT[key]).toMatchObject({ defaultEnabled: false, reviewRequiredBeforeEnable: true });
    }
    expect(legacy.enableNativeRunner).toBe(false);
    expect(legacy.enableWorkflowsV1).toBe(true);
    expect(() => assertV7FeatureDependencies(legacy)).not.toThrow();
  });

  it("does not fill unrelated defaults into a partial administrative patch", () => {
    expect(patchInstanceExperimentalSettingsSchema.parse({ hindsight_provider_v7: false }))
      .toEqual({ hindsight_provider_v7: false });
    expect(patchInstanceExperimentalSettingsSchema.parse({})).toEqual({});
    expect(() => patchInstanceExperimentalSettingsSchema.parse({ openshell_v7: "true" })).toThrow();
  });

  it("rejects provider, learning and supervision admission without their effective prerequisites", () => {
    expect(v7FeatureDependencyIssues({ hindsight_provider_v7: true }))
      .toContainEqual({ feature: "hindsight_provider_v7", required: "cognitive_memory_v7" });
    expect(v7FeatureEnabled({ supervision_v7: true, orchestration_v7: true, agent_runtime_fabric_v5: true }, "supervision_v7"))
      .toBe(false);
    expect(v7FeatureEnabled({ learning_engine_v7: true, memory_observations_v7: true, skill_lifecycle_v5: true, playbooks_v5: true }, "learning_engine_v7"))
      .toBe(false);
    expect(() => assertV7FeatureDependencies({ hindsight_provider_v7: true })).toThrow(V7FeatureDependencyError);
  });

  it("validates a complete acyclic rollout and closes each dependent on prerequisite loss", () => {
    const flags = completeSettings();
    expect(() => assertV7FeatureDependencies(flags)).not.toThrow();
    for (const key of V7_FEATURE_KEYS) {
      expect(v7FeatureEnabled(flags, key)).toBe(true);
      for (const required of [...V7_FEATURE_DEPENDENCIES[key], ...V7_BASE_FEATURE_REQUIREMENTS[key]]) {
        const revoked = { ...flags, [required]: false };
        expect(v7FeatureEnabled(revoked, key), `${key} after ${required} is disabled`).toBe(false);
        expect(() => assertV7FeatureDependencies(revoked)).toThrow(V7FeatureDependencyError);
      }
    }
  });

  it("checks transitive V5 authority and V6 runtime gates instead of raw true values", () => {
    const flags = completeSettings();
    expect(v7FeatureEnabled({ ...flags, agent_identities_v5: false }, "supervision_v7")).toBe(false);
    expect(v7FeatureEnabled({ ...flags, role_packs_v5: false }, "agent_packages_v7")).toBe(false);
    expect(v7FeatureEnabled({ ...flags, runtime_host_agent_v6: false }, "openshell_v7")).toBe(false);
    expect(v7FeatureEnabled({ ...flags, billing_v6: false }, "free_core_commercial_v7")).toBe(false);
    expect(v7FeatureEnabled({ ...flags, enableCollectiveMemoryV1: false }, "memory_models_v7")).toBe(false);
  });

  it("allows an atomic rollback without requiring deleted or reset predecessor state", () => {
    const flags = completeSettings();
    const rollback = { ...flags, ...v7FeatureFlagsSchema.parse({}) };
    expect(() => assertV7FeatureDependencies(rollback)).not.toThrow();
    expect(rollback.hosted_openclaw_v6).toBe(true);
    expect(rollback.playbooks_v5).toBe(true);
    expect(rollback.enableCollectiveMemoryV1).toBe(true);
    expect(V7_ROLLOUT.openshell_v7.rollback).toContain("never fall back to unsandboxed");
  });
});
