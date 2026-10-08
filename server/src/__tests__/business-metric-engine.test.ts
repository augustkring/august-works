import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { businessMetricDefinitionSchema, queryBusinessMetricSchema } from "@paperclipai/shared";
import { calculateNativeMetric, prepareNativeMetric, type NativeMetricInput } from "../services/business-metrics/native-engine.js";
import { metricDefinition } from "./helpers/business-metric-fixture.js";
const definition = metricDefinition(randomUUID());
const query = queryBusinessMetricSchema.parse({ metricId: randomUUID(), versionId: randomUUID(), from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", dimensions: ["project"] });
function row(status: string, projectId: string | null = null): NativeMetricInput {
  return { id: randomUUID(), entity: "issue", status, projectId, createdAt: "2026-01-01T12:00:00.000Z", updatedAt: "2026-01-01T13:00:00.000Z" };
}
describe("native metric known-answer engine", () => {
  it("computes ratios per actual population with null project as a distinct group and order-independent lineage", () => {
    const projectId = randomUUID(); const inputs = [row("done"), row("todo"), row("done", projectId), row("todo", projectId), row("todo", projectId)];
    const result = calculateNativeMetric(definition, query, inputs);
    expect(result.value).toBe(2 / 5);
    expect(result.groups).toEqual(expect.arrayContaining([
      { dimensions: { project: null }, value: 1 / 2, numerator: 1, denominator: 2 },
      { dimensions: { project: projectId }, value: 1 / 3, numerator: 1, denominator: 3 },
    ]));
    expect(calculateNativeMetric(definition, query, [...inputs].reverse())).toEqual(result);
  });
  it("preserves the difference between an empty count and an undefined ratio", () => {
    expect(calculateNativeMetric(definition, query, [])).toMatchObject({ status: "undefined", value: null, reason: "empty_denominator", groups: [] });
    const count = businessMetricDefinitionSchema.parse({ ...definition, valueType: "count", unit: "objects", calculation: { kind: "native_count", population: { entity: "issue", statuses: ["todo", "done"], projectId: null } } });
    expect(calculateNativeMetric(count, query, [])).toMatchObject({ status: "observed", value: 0, reason: null });
  });
  it("rejects duplicates, partial budgets and inputs outside half-open time or declared populations", () => {
    const input = row("done");
    for (const inputs of [[input, input], [{ ...input, createdAt: query.until }], [{ ...input, status: "blocked" }], [{ ...input, entity: "project" as const }], [{ ...input, updatedAt: "unknown" }]])
      expect(() => calculateNativeMetric(definition, query, inputs)).toThrow();
    expect(() => calculateNativeMetric(definition, { ...query, maxRows: 1 }, [input, row("todo")])).toThrow(/budget/);
  });
  it("keeps a prepared definition/query snapshot while independently validating and hashing each later input", () => {
    const rawDefinition=businessMetricDefinitionSchema.parse(definition),rawQuery=queryBusinessMetricSchema.parse(query),until=rawQuery.until;
    const calculate=prepareNativeMetric(rawDefinition,rawQuery),done=row("done"),todo=row("todo");
    rawDefinition.valueType="count";rawDefinition.calculation={kind:"native_count",population:{entity:"issue",statuses:["done"],projectId:null}};
    rawQuery.from="2026-02-01T00:00:00Z";rawQuery.dimensions=["status"];
    const first=calculate([done,todo]);expect(first).toMatchObject({value:0.5,groups:[{dimensions:{project:null},value:0.5,numerator:1,denominator:2}]});
    const second=calculate([{...done,status:"todo"},todo]);expect(second.value).toBe(0);expect(second.inputHash).not.toBe(first.inputHash);expect(second.definitionHash).toBe(first.definitionHash);
    expect(()=>calculate([{...done,createdAt:until}])).toThrow(/outside/);
    expect(()=>calculate([done,done])).toThrow(/Duplicate/);
  });
  it("changes input lineage when current state changes and never substitutes a native result for external authority", () => {
    const input = row("todo"); const before = calculateNativeMetric(definition, query, [input]);
    const after = calculateNativeMetric(definition, query, [{ ...input, status: "done" }]);
    expect(before.value).toBe(0); expect(after.value).toBe(1); expect(before.inputHash).not.toBe(after.inputHash);
    const external = businessMetricDefinitionSchema.parse({ ...definition, authorityMode: "external_authoritative", grain: "external_entity", timeSemantics: "external_provider_defined",
      calculation: { kind: "external_metric", providerKey: "metricflow", connectionId: randomUUID(), providerMetricRef: "revenue", providerVersion: "test/v1", definitionHash: "a".repeat(64), qualificationHash: "b".repeat(64) } });
    expect(() => calculateNativeMetric(external, query, [])).toThrow(/qualified provider/);
  });
});
