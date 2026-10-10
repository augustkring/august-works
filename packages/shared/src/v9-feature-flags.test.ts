import { describe, expect, it } from "vitest";
import {
  v9FeatureFlagsSchema,
  v9FeatureEnabled,
  assertV9FeatureDependencies,
  V9FeatureDependencyError,
} from "./v9-feature-flags.js";
import { instanceExperimentalSettingsSchema } from "./validators/instance.js";

describe("V9 admission", () => {
  it("keeps predecessor settings compatible and every new capability off", () => {
    const settings = instanceExperimentalSettingsSchema.parse({});
    expect(
      Object.values(v9FeatureFlagsSchema.parse(settings)).every((v) => !v),
    ).toBe(true);
    expect(settings.enableStreamlinedUi).toBe(true);
  });
  it("rejects dependent activation and permits atomic rollback", () => {
    expect(v9FeatureEnabled({ home_v9: true }, "home_v9")).toBe(false);
    expect(() => assertV9FeatureDependencies({ home_v9: true })).toThrow(
      V9FeatureDependencyError,
    );
    expect(() =>
      assertV9FeatureDependencies({
        home_v9: true,
        experience_projection_v9: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertV9FeatureDependencies({
        home_v9: false,
        experience_projection_v9: false,
      }),
    ).not.toThrow();
  });
  it("does not mistake a configured native prerequisite for its effective enabled state", () => {
    expect(
      v9FeatureEnabled(
        { activation_v9: true, server_onboarding_v6: true },
        "activation_v9",
      ),
    ).toBe(false);
    expect(
      v9FeatureEnabled(
        { hire_agent_v9: true, agent_packages_v7: true },
        "hire_agent_v9",
      ),
    ).toBe(false);
  });
});
