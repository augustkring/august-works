import { describe, expect, it } from "vitest";
import { instanceExperimentalSettingsSchema } from "./validators/instance.js";
import {
  AUGUST_WORKS_AUDIT_ACTIONS,
  AUGUST_WORKS_PLATFORM_FEATURE_FLAGS,
  AUGUST_WORKS_PLATFORM_FEATURE_KEYS,
  executionPrincipalSchema,
  executionPrincipalToActivityActor,
  type AugustWorksPlatformFeatureKey,
} from "./august-works-platform.js";

describe("August Works V4 platform feature flags", () => {
  it("keeps every V4 capability disabled by default", () => {
    const defaults = instanceExperimentalSettingsSchema.parse({});
    for (const key of AUGUST_WORKS_PLATFORM_FEATURE_KEYS) {
      expect(defaults[key], key).toBe(false);
      expect(AUGUST_WORKS_PLATFORM_FEATURE_FLAGS[key].default, key).toBe(false);
    }
  });

  it("declares valid acyclic dependencies", () => {
    const keys = new Set<AugustWorksPlatformFeatureKey>(AUGUST_WORKS_PLATFORM_FEATURE_KEYS);
    const visited = new Set<AugustWorksPlatformFeatureKey>();

    const visit = (
      key: AugustWorksPlatformFeatureKey,
      visiting: Set<AugustWorksPlatformFeatureKey>,
    ): void => {
      if (visited.has(key)) return;
      expect(visiting.has(key), `dependency cycle at ${key}`).toBe(false);
      visiting.add(key);
      for (const dependency of AUGUST_WORKS_PLATFORM_FEATURE_FLAGS[key].dependencies) {
        expect(keys.has(dependency), `${key} -> ${dependency}`).toBe(true);
        visit(dependency, visiting);
      }
      visiting.delete(key);
      visited.add(key);
    };

    for (const key of AUGUST_WORKS_PLATFORM_FEATURE_KEYS) visit(key, new Set());
  });

  it("keeps rollout metadata complete", () => {
    for (const key of AUGUST_WORKS_PLATFORM_FEATURE_KEYS) {
      const contract = AUGUST_WORKS_PLATFORM_FEATURE_FLAGS[key];
      expect(contract.owner).toBe("August Works Platform");
      expect(contract.scope).toBe("instance");
      expect(contract.rollbackBehavior.trim().length, key).toBeGreaterThan(0);
      expect(contract.reviewDate, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(contract.cleanupCondition.trim().length, key).toBeGreaterThan(0);
    }
  });
});

describe("executionPrincipalSchema", () => {
  it("maps explicit user, agent, and system principals to activity actors", () => {
    expect(executionPrincipalToActivityActor(
      executionPrincipalSchema.parse({ type: "user", userId: "user-1" }),
    )).toEqual({ actorType: "user", actorId: "user-1", responsibleUserId: "user-1" });

    expect(executionPrincipalToActivityActor(
      executionPrincipalSchema.parse({ type: "agent", agentId: "agent-1", responsibleUserId: "user-1" }),
    )).toEqual({ actorType: "agent", actorId: "agent-1", responsibleUserId: "user-1" });

    expect(executionPrincipalToActivityActor(
      executionPrincipalSchema.parse({ type: "system", service: "workflow-executor" }),
    )).toEqual({ actorType: "system", actorId: "workflow-executor", responsibleUserId: null });

    expect(executionPrincipalSchema.safeParse({ type: "plugin", pluginId: "plugin-1" }).success).toBe(false);
  });
});

describe("AUGUST_WORKS_AUDIT_ACTIONS", () => {
  it("reserves unique stable dot-namespaced actions", () => {
    expect(new Set(AUGUST_WORKS_AUDIT_ACTIONS).size).toBe(AUGUST_WORKS_AUDIT_ACTIONS.length);
    for (const action of AUGUST_WORKS_AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    }
  });
});
