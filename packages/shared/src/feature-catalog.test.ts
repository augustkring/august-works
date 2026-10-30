import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FEATURE_TIERS,
  INSTANCE_FEATURE_CATALOG,
  INSTANCE_FEATURE_KEYS,
  applyCapabilityLifecycleAvailability,
  buildFeatureCatalogArtifact,
  buildFeatureCatalogArtifactV2,
  capabilityEnablementIssues,
  capabilityGaAdmissionIssues,
  capabilityLifecyclePolicyIssues,
  featureCatalogArtifactSchema,
  isCapabilityAdvertisedForNewUse,
  isCapabilityMaturityAdvertisedForNewUse,
  renderFeatureCatalogArtifact,
} from "./feature-catalog.js";
import { instanceExperimentalSettingsSchema } from "./validators/instance.js";
import { v9FeatureEnabled } from "./v9-feature-flags.js";

function schemaBooleanFlagKeys(): string[] {
  return Object.entries(instanceExperimentalSettingsSchema.shape)
    .filter(([, fieldSchema]) => {
      let current: z.ZodTypeAny = fieldSchema as z.ZodTypeAny;
      for (;;) {
        if (current instanceof z.ZodDefault) {
          current = current._def.innerType as z.ZodTypeAny;
        } else if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
          current = current.unwrap() as z.ZodTypeAny;
        } else {
          break;
        }
      }
      return current instanceof z.ZodBoolean;
    })
    .map(([key]) => key)
    .sort();
}

describe("INSTANCE_FEATURE_CATALOG", () => {
  it("covers exactly the boolean flag keys of the experimental settings schema", () => {
    expect([...INSTANCE_FEATURE_KEYS]).toEqual(schemaBooleanFlagKeys());
  });

  it("keeps selfHostedDefault in sync with the schema defaults", () => {
    const schemaDefaults = instanceExperimentalSettingsSchema.parse({});
    for (const key of INSTANCE_FEATURE_KEYS) {
      expect(INSTANCE_FEATURE_CATALOG[key].selfHostedDefault, key).toBe(schemaDefaults[key]);
    }
  });

  it("has a non-empty title, description, and valid tier for every flag", () => {
    for (const key of INSTANCE_FEATURE_KEYS) {
      const entry = INSTANCE_FEATURE_CATALOG[key];
      expect(entry.title.trim().length, key).toBeGreaterThan(0);
      expect(entry.description.trim().length, key).toBeGreaterThan(0);
      expect(FEATURE_TIERS, key).toContain(entry.tier);
      expect(entry.lifecycle.capabilityKey).toBe(key);
      expect(entry.lifecycle.customerName.trim()).not.toBe("");
      expect(entry.lifecycle.maturity).toBe(
        key === "enableApps" || key === "enableMcpAggregators"
          ? "deprecated"
          : key === "enablePipelines" || key === "enableAiWorkflowAuthoring"
            ? "preview"
              : "experimental",
      );
      expect(entry.lifecycle.supportLevel).toBe(
        key === "enableApps" || key === "enableMcpAggregators" ? "unqualified" : "no_compatibility_guarantee",
      );
      expect(entry.lifecycle.releaseEvidenceRefs).toEqual([]);
    }
    expect(INSTANCE_FEATURE_CATALOG.skill_lifecycle_v5.lifecycle.owner).toBe("Instance administrator");
    expect(INSTANCE_FEATURE_CATALOG.hire_agent_v9.lifecycle.owner).toBe("August Works platform operator");
    expect(INSTANCE_FEATURE_CATALOG.enablePipelines.lifecycle).toMatchObject({
      owner: "augustkring/august-works",
      maturity: "preview",
      docsRef: "docs/help/workflows-preview.md",
      customerSurfaces: ["WORKFLOW", "WORKFLOW-DESCRIBE", "WORKFLOW-REVIEW", "WORKFLOW-TEST", "WORKFLOW-PUBLISH", "WORKFLOW-RECOVER"],
      dataCategories: ["Workflow definitions", "Step inputs", "Run history"],
      supportPathRef: "/company/help",
    });
    expect(INSTANCE_FEATURE_CATALOG.company_deletion_v6.lifecycle).toMatchObject({
      docsRef: "docs/help/export-and-delete.md",
      customerSurfaces: ["SETTINGS-DATA-PRIVACY", "SETTINGS-PEOPLE-ACCESS"],
      dataCategories: ["Company export package", "Membership and account access", "Deletion and retention state"],
      serviceDependencies: [
        "server/src/services/saas/account-deletion.ts",
        "server/src/services/saas/offboarding.ts",
        "server/src/services/saas/company-purge.ts",
      ],
    });
  });

  it("keeps compatibility keys deprecated and does not advertise retired/internal capabilities", () => {
    expect(INSTANCE_FEATURE_CATALOG.enableApps.lifecycle.maturity).toBe("deprecated");
    expect(INSTANCE_FEATURE_CATALOG.enableMcpAggregators.lifecycle.maturity).toBe("deprecated");
    expect(isCapabilityAdvertisedForNewUse("enableApps")).toBe(true);
    expect(isCapabilityAdvertisedForNewUse("enableAgentChat")).toBe(true);
    expect(isCapabilityMaturityAdvertisedForNewUse("internal")).toBe(false);
    expect(isCapabilityMaturityAdvertisedForNewUse("retired")).toBe(false);
  });

  it("withdraws a retired admission flag from the effective view without changing its stored value", () => {
    const stored = { experience_projection_v9: true, progressive_shell_v9: true };
    const retiredCatalog = {
      progressive_shell_v9: {
        lifecycle: { ...INSTANCE_FEATURE_CATALOG.progressive_shell_v9.lifecycle, maturity: "retired" as const },
      },
    };

    const effective = applyCapabilityLifecycleAvailability(stored, retiredCatalog);

    expect(stored.progressive_shell_v9).toBe(true);
    expect(effective.progressive_shell_v9).toBe(false);
    expect(v9FeatureEnabled(effective, "progressive_shell_v9")).toBe(false);
    expect(effective.experience_projection_v9).toBe(true);
  });

  it("requires recorded owner, docs, support, evidence, and review before GA", () => {
    const entry = INSTANCE_FEATURE_CATALOG.enableAgentChat.lifecycle;
    expect(capabilityGaAdmissionIssues(entry)).toEqual([
      "owner", "docs/help", "support path", "release evidence", "review date",
      "securityPrivacy", "accessibility", "operability", "migrationPlan", "criticalityEvidence",
    ]);
    expect(capabilityGaAdmissionIssues({
      ...entry,
      owner: "Product",
      docsRef: "docs/help/article.md",
      supportLevel: "standard",
      releaseEvidenceRefs: ["evidence/checkpoint.json"],
      lastReviewedAt: "2026-10-28",
      gaReadiness: {
        securityPrivacy: "qualified",
        accessibility: "qualified",
        operability: "qualified",
        migrationPlan: "not_applicable",
        criticalityEvidence: "qualified",
      },
    })).toEqual([]);
  });

  it("requires a named migration path for configured deprecation and sunset dates", () => {
    const lifecycle = INSTANCE_FEATURE_CATALOG.enableAgentChat.lifecycle;
    const planned = {
      ...lifecycle,
      maturity: "deprecated" as const,
      deprecationAt: null,
      sunsetAt: "2027-06-01",
    };
    const issues = capabilityLifecyclePolicyIssues(planned);
    expect(issues).toContain("replacement capability");
    expect(issues).toContain("migration guide");
    expect(issues).toContain("deprecation date before sunset");
    expect(isCapabilityMaturityAdvertisedForNewUse(planned.maturity)).toBe(true);
    expect(isCapabilityMaturityAdvertisedForNewUse("retired")).toBe(false);
  });

  it("blocks enabling internal or retired records while preserving other maturity states", () => {
    const catalog = {
      ...INSTANCE_FEATURE_CATALOG,
      enableAgentChat: {
        ...INSTANCE_FEATURE_CATALOG.enableAgentChat,
        lifecycle: { ...INSTANCE_FEATURE_CATALOG.enableAgentChat.lifecycle, maturity: "retired" as const },
      },
      enableChatConnectors: {
        ...INSTANCE_FEATURE_CATALOG.enableChatConnectors,
        lifecycle: { ...INSTANCE_FEATURE_CATALOG.enableChatConnectors.lifecycle, maturity: "internal" as const },
      },
    };
    expect(capabilityEnablementIssues({ enableAgentChat: true, enableChatConnectors: true }, catalog)).toEqual([
      { capabilityKey: "enableAgentChat", maturity: "retired" },
      { capabilityKey: "enableChatConnectors", maturity: "internal" },
    ]);
    expect(capabilityEnablementIssues({ enablePipelines: true }, catalog)).toEqual([]);
    expect(capabilityEnablementIssues({ enableAgentChat: false }, catalog)).toEqual([]);
  });
});

describe("buildFeatureCatalogArtifact", () => {
  it("preserves the existing tier-only release contract by default", () => {
    const artifact = buildFeatureCatalogArtifact("2026.720.0");
    expect(artifact.catalogVersion).toBe("2026.720.0");
    expect(Object.keys(artifact.features)).toEqual([...INSTANCE_FEATURE_KEYS]);
    for (const key of INSTANCE_FEATURE_KEYS) {
      expect(artifact.features[key]).toEqual({ tier: INSTANCE_FEATURE_CATALOG[key].tier });
    }
  });

  it("emits lifecycle metadata only for explicit schema v2 generation", () => {
    const artifact = buildFeatureCatalogArtifactV2("2026.720.0");
    expect(artifact.schemaVersion).toBe(2);
    expect(artifact.catalogVersion).toBe("2026.720.0");
    expect(Object.keys(artifact.features)).toEqual([...INSTANCE_FEATURE_KEYS]);
    for (const key of INSTANCE_FEATURE_KEYS) {
      expect(artifact.features[key]).toEqual({
        title: INSTANCE_FEATURE_CATALOG[key].title,
        description: INSTANCE_FEATURE_CATALOG[key].description,
        tier: INSTANCE_FEATURE_CATALOG[key].tier,
        lifecycle: INSTANCE_FEATURE_CATALOG[key].lifecycle,
      });
    }
  });

  it("produces output that validates against featureCatalogArtifactSchema", () => {
    const artifact = buildFeatureCatalogArtifact("2026.720.0");
    expect(featureCatalogArtifactSchema.parse(artifact)).toEqual(artifact);
  });

  it("rejects an empty catalogVersion", () => {
    expect(() => buildFeatureCatalogArtifact("")).toThrow(/catalogVersion/);
    expect(() => buildFeatureCatalogArtifact("   ")).toThrow(/catalogVersion/);
  });
});

describe("featureCatalogArtifactSchema", () => {
  it("continues to accept already-published v1 artifacts", () => {
    expect(featureCatalogArtifactSchema.parse({
      catalogVersion: "2026.720.0",
      features: { enableApps: { tier: "managed" } },
    })).toEqual({ catalogVersion: "2026.720.0", features: { enableApps: { tier: "managed" } } });
  });

  it("rejects unknown top-level or per-feature properties", () => {
    const valid = buildFeatureCatalogArtifact("2026.720.0");
    expect(
      featureCatalogArtifactSchema.safeParse({ ...valid, extra: true }).success,
    ).toBe(false);
    expect(
      featureCatalogArtifactSchema.safeParse({
        schemaVersion: 2,
        catalogVersion: "2026.720.0",
        features: { enableApps: { tier: "managed", lifecycle: INSTANCE_FEATURE_CATALOG.enableApps.lifecycle, extra: true } },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown tiers and a missing catalogVersion", () => {
    expect(
      featureCatalogArtifactSchema.safeParse({
        schemaVersion: 2,
        catalogVersion: "2026.720.0",
        features: { enableApps: { tier: "mystery", lifecycle: INSTANCE_FEATURE_CATALOG.enableApps.lifecycle } },
      }).success,
    ).toBe(false);
    expect(
      featureCatalogArtifactSchema.safeParse({ schemaVersion: 2, features: {} }).success,
    ).toBe(false);
  });
});

describe("renderFeatureCatalogArtifact", () => {
  it("defaults to deterministic, sorted, newline-terminated schema v1", () => {
    const rendered = renderFeatureCatalogArtifact("2026.720.0");
    expect(rendered).toBe(renderFeatureCatalogArtifact("2026.720.0"));
    expect(rendered.endsWith("\n")).toBe(true);
    const parsed = featureCatalogArtifactSchema.parse(JSON.parse(rendered));
    expect(Object.keys(parsed.features)).toEqual([...Object.keys(parsed.features)].sort());
    expect(parsed).toEqual(buildFeatureCatalogArtifact("2026.720.0"));
  });

  it("renders v2 only when explicitly requested", () => {
    const parsed = featureCatalogArtifactSchema.parse(JSON.parse(renderFeatureCatalogArtifact("2026.720.0", 2)));
    expect(parsed).toEqual(buildFeatureCatalogArtifactV2("2026.720.0"));
    expect(parsed).toHaveProperty("schemaVersion", 2);
  });
});
