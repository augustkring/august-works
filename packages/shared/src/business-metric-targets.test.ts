import { describe, expect, it } from "vitest";
import { businessMetricTargetDefinitionSchema, businessMetricTargetScopeSchema } from "./business-metric-targets.js";
const id = "11111111-1111-4111-8111-111111111111";
const definition = { metricId: id, metricVersionId: id, scope: { type: "goal", goalId: id }, periodStart: "2026-10-01T00:00:00Z", periodEnd: "2026-11-01T00:00:00Z", criterion: { kind: "at_least", value: 10 }, rationale: "Commit to a reviewed business outcome", assumptions: ["The pinned population remains appropriate"], ownerUserId: "owner" };
describe("native metric commitment contract", () => {
  it("pins meaning and native scope while keeping a future commitment separate from an observation", () => {
    expect(businessMetricTargetDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(businessMetricTargetScopeSchema.safeParse({ type: "portfolio", mode: "company_unit" }).success).toBe(true);
    for (const scope of [{ type: "goal", goalId: "unscoped" }, { type: "employee", employeeId: id }, { type: "portfolio", companyIds: [id], sumCurrencies: true }])
      expect(businessMetricTargetScopeSchema.safeParse(scope).success).toBe(false);
  });
  it("rejects undefined quantities, reversed ranges, ambiguous windows and fields that try to convert a forecast into authority", () => {
    for (const change of [{ criterion: { kind: "at_least", value: NaN } }, { criterion: { kind: "at_most", value: Infinity } }, { criterion: { kind: "between", lower: 11, upper: 10 } }, { periodEnd: definition.periodStart }, { periodEnd: "2029-01-01T00:00:00Z" }, { periodEnd: "2026-11-01T00:00:00.000001Z" }, { observedValue: 10 }, { autoApproveForecast: true }, { assumptions: [] }])
      expect(businessMetricTargetDefinitionSchema.safeParse({ ...definition, ...change }).success).toBe(false);
  });
});
