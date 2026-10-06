import { describe, expect, it } from "vitest";
import { INSTANCE_FEATURE_CATALOG } from "./feature-catalog.js";
import { instanceExperimentalSettingsSchema, patchInstanceExperimentalSettingsSchema } from "./validators/instance.js";
import { V8_FEATURE_KEYS, V8_FEATURE_DEPENDENCIES, v8FeatureEnabled, v8FeatureFlagsSchema, assertV8FeatureDependencies, V8FeatureDependencyError } from "./v8-feature-flags.js";

const complete = () => instanceExperimentalSettingsSchema.parse({
  ...Object.fromEntries(V8_FEATURE_KEYS.map((key) => [key, true])),
  enableFoundationV1: true, enableContextEngineV1: true, enableDecisions: true, ai_use_cases_v7: true,
});

describe("V8 configuration admission", () => {
  it("keeps legacy and cloud deployments off without resetting unrelated flags", () => {
    const legacy = instanceExperimentalSettingsSchema.parse({ enableNativeRunner: false });
    expect(legacy.enableNativeRunner).toBe(false);
    for (const key of V8_FEATURE_KEYS) {
      expect(legacy[key]).toBe(false);
      expect(INSTANCE_FEATURE_CATALOG[key]).toMatchObject({ cloudDefault: false, selfHostedDefault: false });
    }
    expect(patchInstanceExperimentalSettingsSchema.parse({ process_intelligence_v8: false })).toEqual({ process_intelligence_v8: false });
    expect(() => patchInstanceExperimentalSettingsSchema.parse({ process_intelligence_v8: "true" })).toThrow();
  });

  it("fails closed when a process, forecast or provider prerequisite is lost", () => {
    const flags = complete();
    expect(() => assertV8FeatureDependencies(flags)).not.toThrow();
    for (const key of V8_FEATURE_KEYS) {
      expect(v8FeatureEnabled(flags, key)).toBe(true);
      for (const required of V8_FEATURE_DEPENDENCIES[key]) {
        const revoked = { ...flags, [required]: false };
        expect(v8FeatureEnabled(revoked, key), `${key} after ${required}`).toBe(false);
        expect(() => assertV8FeatureDependencies(revoked)).toThrow(V8FeatureDependencyError);
      }
    }
    expect(v8FeatureEnabled({ ...flags, analytical_lineage_v8: false }, "forecast_provider_statsforecast_v8")).toBe(false);
    expect(v8FeatureEnabled({ ...flags, enableFoundationV1: false }, "planning_provider_ortools_v8")).toBe(false);
  });

  it("allows rollback while retaining predecessor state", () => {
    const rollback = { ...complete(), ...v8FeatureFlagsSchema.parse({}) };
    expect(() => assertV8FeatureDependencies(rollback)).not.toThrow();
    expect(rollback.enableFoundationV1).toBe(true);
    expect(rollback.enableDecisions).toBe(true);
  });
});
