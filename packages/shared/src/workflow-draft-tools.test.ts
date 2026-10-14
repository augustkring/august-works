import { expect, it } from "vitest";
import { workflowToolFields, workflowToolArgumentErrors, workflowToolArgumentsSchema } from "./workflow-draft-tools.js";

const schema = { type: "object", properties: { query: { type: "string", title: "Search", minLength: 1 },
  count: { type: "integer", minimum: 1, maximum: 10 }, enabled: { type: "boolean" }, category: { type: "string", enum: ["one", "two"] } }, required: ["query"], additionalProperties: false };
it("represents exact primitive fields without defaults or optional-value invention", () => {
  const fields = workflowToolFields(schema)!;
  expect(fields.map(field => [field.name, field.required])).toEqual([["query", true], ["count", false], ["enabled", false], ["category", false]]);
  expect(workflowToolArgumentErrors(fields, { query: " preserved ", enabled: false, count: 10 })).toEqual([]);
  expect(workflowToolArgumentErrors(fields, { query: "", count: 0, enabled: "false", category: "three", grant: true }).sort()).toEqual(["category", "count", "enabled", "grant", "query"]);
  expect(workflowToolArgumentErrors(fields, { query: "Text", count: Number.MAX_SAFE_INTEGER + 1 })).toEqual(["count"]);
});
it("keeps conditional, nested, remote, credential, hidden-default and prototype-shaped inputs Advanced", () => {
  for (const properties of [{ data: { type: "object" } }, { token: { type: "string" } }, { query: { type: "string", default: "PRIVATE" } },
    { query: { type: "string", pattern: "dangerous" } }, { query: { $ref: "https://uncontacted.invalid/schema" } },
    Object.fromEntries([["__proto__", { type: "string" }]]), { count: { type: "number", minimum: 2, maximum: 1 } }])
    expect(workflowToolFields({ type: "object", properties })).toBeNull();
  expect(workflowToolFields({ ...schema, oneOf: [{ required: ["query"] }] })).toBeNull();
  expect(workflowToolFields({ ...schema, required: ["missing"] })).toBeNull();
});
it("bounds typed arguments and preserves explicit false, whitespace and omission", () => {
  const values = { query: " text ", enabled: false };
  expect(workflowToolArgumentsSchema.parse(values)).toEqual(values);
  expect(workflowToolArgumentsSchema.safeParse({ query: "x".repeat(4001) }).success).toBe(false);
  const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`field${i}`, "x"]));
  expect(workflowToolArgumentsSchema.safeParse(tooMany).success).toBe(false);
  expect(workflowToolArgumentsSchema.safeParse({ first: "€".repeat(3000) }).success).toBe(false);
});
