import { describe, expect, it } from "vitest";
import type { BusinessMetricResult, BusinessMetricTargetDefinition } from "@paperclipai/shared";
import { compareMetricTarget } from "../services/business-metrics/target-comparison.js";
const definition: BusinessMetricTargetDefinition = { metricId: "metric", metricVersionId: "version", scope: { type: "company" }, periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-02-01T00:00:00Z", criterion: { kind: "at_least", value: 0.8 }, ownerUserId: "board", rationale: "A human commitment", assumptions: ["A reversible ratio"] };
const observed: BusinessMetricResult = { id: "observation", companyId: "company", metricId: "metric", versionId: "version", from: definition.periodStart, until: definition.periodEnd, asOf: "2026-02-01T01:00:00Z", expiresAt: "2026-02-01T02:00:00Z", status: "observed", value: 0.9, reason: null, groups: [], inputHash: "a".repeat(64), definitionHash: "b".repeat(64), engineVersion: "native/v1", lineageManifestId: "lineage", sourceWatermark: "2026-01-31T00:00:00Z" };
const now = new Date("2026-02-01T01:30:00Z");
const compare = (result: BusinessMetricResult, target = definition) => compareMetricTarget("target", "targetVersion", target, result, now);
describe("target commitments and observation boundaries", () => {
  it("does not turn an open or not-yet-started period into success, failure or a forecast", () => {
    for (const periodEnd of ["2026-02-02T00:00:00Z", "2026-03-01T00:00:00Z"]) expect(compare({ ...observed, until: periodEnd }, { ...definition, periodEnd })).toMatchObject({ status: "period_in_progress", value: 0.9, reason: "current_observation_is_not_a_forecast" });
  });
  it("does not compare mismatched, expired, future, invalid or undefined observations", () => {
    for (const result of [{ ...observed, versionId: "other" }, { ...observed, until: "2026-02-02T00:00:00Z" }, { ...observed, expiresAt: now.toISOString() }, { ...observed, expiresAt: "invalid" }, { ...observed, asOf: "2026-02-02T00:00:00Z" }, { ...observed, status: "undefined" as const, value: null, reason: "empty_denominator" }, { ...observed, value: NaN }]) expect(compare(result)).toMatchObject({ status: "unknown", value: null });
  });
  it("treats zero as observed and includes both interval boundaries without implying causal impact", () => {
    expect(compare({ ...observed, value: 0 })).toMatchObject({ status: "not_met", value: 0 });
    for (const value of [0, 1]) expect(compare({ ...observed, value }, { ...definition, criterion: { kind: "between", lower: 0, upper: 1 } })).toMatchObject({ status: "met", value });
  });
});
