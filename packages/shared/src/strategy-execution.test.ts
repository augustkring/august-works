import { describe, expect, it } from "vitest";
import { strategyExecutionLinkDefinitionSchema } from "./strategy-execution.js";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const definition = { from: { type: "foundation_section", foundationDocumentId: id, approvedRevisionId: other, sectionId: other, headingPath: ["Company strategy"], contentHash: "a".repeat(64) }, to: { type: "goal", id }, relationship: "supports", rationale: "Explicitly reviewed strategic rationale", ownerUserId: "reviewer", reviewFrequencyDays: 30, retentionDays: 30, sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [id], contribution: null };
describe("native strategy reference contracts", () => {
  it("requires approved Foundation identity, section and hash without accepting copied truth", () => {
    expect(strategyExecutionLinkDefinitionSchema.safeParse(definition).success).toBe(true);
    for (const from of [{ ...definition.from, approvedRevisionId: undefined }, { ...definition.from, sectionId: "heading" }, { ...definition.from, contentHash: "invalid" }, { ...definition.from, body: "Copied strategy is not a version pin" }]) expect(strategyExecutionLinkDefinitionSchema.safeParse({ ...definition, from }).success).toBe(false);
  });
  it("requires explicit purpose, ownership, retention and current obligation references", () => {
    for (const value of [{ ...definition, ownerUserId: "" }, { ...definition, governanceObligationRefs: [] }, { ...definition, retentionDays: 0 }, { ...definition, purpose: "employee_ranking" }, { ...definition, sensitivity: "restricted" }]) expect(strategyExecutionLinkDefinitionSchema.safeParse(value).success).toBe(false);
  });
  it("rejects self-dependencies, unpinned measures and invented canonical execution directions", () => {
    for (const value of [{ ...definition, from: { type: "goal", id }, relationship: "depends_on" }, { ...definition, relationship: "measures" }, { ...definition, from: { type: "metric", id }, relationship: "measures" }, { ...definition, from: { type: "issue", id: other }, relationship: "advanced_by" }, { ...definition, contribution: { kind: "causal_effect", value: 0.9 } }, { ...definition, contribution: { kind: "relative_priority", weight: Infinity, rationale: "Unbounded allocation" } }]) expect(strategyExecutionLinkDefinitionSchema.safeParse(value).success).toBe(false);
    expect(strategyExecutionLinkDefinitionSchema.safeParse({ ...definition, from: { type: "metric_target", id, versionId: other }, relationship: "measures" }).success).toBe(true);
  });
});
