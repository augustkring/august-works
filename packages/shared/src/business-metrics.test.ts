import { describe, expect, it } from "vitest";
import { businessMetricDefinitionSchema, queryBusinessMetricSchema } from "./business-metrics.js";

const definition = {
  name: "Created issue completion", description: "Share of issues created in the window currently done",
  businessQuestion: "How many created issues are currently complete?", decisionUse: "Review the work backlog",
  populationDescription: "Authorized issues created in the selected window", inclusions: ["created issues"], exclusions: [],
  authorityMode: "aw_native", valueType: "ratio", unit: "ratio", currency: null,
  grain: "issue", timeGrain: "window", timezone: "UTC", timeSemantics: "created_in_window_current_state", dimensions: ["status", "project"],
  calculation: { kind: "native_ratio", numerator: { entity: "issue", statuses: ["done"], projectId: null },
    denominator: { entity: "issue", statuses: ["todo", "in_progress", "done"], projectId: null } },
  ownerUserId: "owner", reviewFrequencyDays: 30, freshnessSeconds: 3600, missingPolicy: "explicit_unknown",
  goodhartRisk: "Completion status alone does not establish valuable outcomes", purpose: "management_intelligence", sensitivity: "internal",
  governanceObligationRefs: ["d56c195e-0dda-4d91-bd59-ae3f77a2d208"], retentionDays: 30,
};

describe("governed business metric semantic boundaries", () => {
  it("accepts an explicitly scoped native ratio without fabricating historical state", () => {
    expect(businessMetricDefinitionSchema.parse(definition).calculation.kind).toBe("native_ratio");
    for (const change of [{ timezone: "Europe/Copenhagen" }, { timeSemantics: "historical_state" }, { grain: "project" },
      { valueType: "currency", currency: "EUR" }, { unit: "percent" }, { dimensions: ["employee"] }, { rawSql: "select * from issues" }])
      expect(businessMetricDefinitionSchema.safeParse({ ...definition, ...change }).success).toBe(false);
  });

  it("rejects ratios mixing entities, project populations or non-subset statuses", () => {
    for (const numerator of [{ entity: "project", statuses: ["completed"] },
      { entity: "issue", statuses: ["done"], projectId: "d56c195e-0dda-4d91-bd59-ae3f77a2d208" },
      { entity: "issue", statuses: ["blocked"], projectId: null }, { entity: "issue", statuses: ["done", "done"], projectId: null }])
      expect(businessMetricDefinitionSchema.safeParse({ ...definition, calculation: { ...definition.calculation, numerator } }).success).toBe(false);
  });

  it("requires external version and qualification pins and rejects external fallback into native authority", () => {
    const external = { ...definition, authorityMode: "external_authoritative", grain: "external_entity", timezone: "Europe/Copenhagen",
      timeSemantics: "external_provider_defined", valueType: "currency", unit: "EUR", currency: "EUR",
      calculation: { kind: "external_metric", providerKey: "metricflow", connectionId: definition.governanceObligationRefs[0],
        providerMetricRef: "revenue", providerVersion: "qualified-version", definitionHash: "a".repeat(64), qualificationHash: "b".repeat(64) } };
    expect(businessMetricDefinitionSchema.safeParse(external).success).toBe(true);
    expect(businessMetricDefinitionSchema.safeParse({ ...external, authorityMode: "aw_native" }).success).toBe(false);
    expect(businessMetricDefinitionSchema.safeParse({ ...external, calculation: { ...external.calculation, qualificationHash: "" } }).success).toBe(false);
    expect(businessMetricDefinitionSchema.safeParse({ ...external, calculation: { ...external.calculation, token: "secret" } }).success).toBe(false);
  });

  it("bounds half-open query windows and rejects duplicate or sensitive dimensions", () => {
    const query = { metricId: definition.governanceObligationRefs[0], versionId: definition.governanceObligationRefs[0],
      from: "2026-01-01T00:00:00Z", until: "2026-01-01T00:00:00.100Z" };
    expect(queryBusinessMetricSchema.parse(query).maxRows).toBe(5000);
    for (const change of [{ until: query.from }, { until: "2028-01-01T00:00:00Z" }, { maxRows: 10001 },
      { dimensions: ["status", "status"] }, { dimensions: ["employee"] }])
      expect(queryBusinessMetricSchema.safeParse({ ...query, ...change }).success).toBe(false);
  });
});
