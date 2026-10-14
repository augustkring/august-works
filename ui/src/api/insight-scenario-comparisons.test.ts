import { afterEach, expect, it, vi } from "vitest";
import { readInsightScenarioComparisons } from "./insight-scenario-comparisons";
const companyId = "10000000-0000-4000-8000-000000000001", scenarioId = "10000000-0000-4000-8000-000000000002", versionId = "10000000-0000-4000-8000-000000000003", runId = "10000000-0000-4000-8000-000000000004";
const definition = { name: "PRIVATE conditional capacity", objective: "Compare human-declared conditional assumptions", decisionUse: "Inform review without approving any commitment", ownerUserId: "manager-a", scope: { type: "company", id: null },
  calculationType: "formula", inputs: [], assumptions: [{ key: "factor", name: "Human coefficient", type: "numeric", unit: {}, nominal: 2, range: { minimum: 1, maximum: 3 }, evidence: [{ kind: "human_statement", rationale: "A hypothetical assumption without empirical calibration" }], confidence: "human_asserted", uncertaintyRationale: "No observed causal effect is established", ownerUserId: "manager-a", controllable: true, distribution: null }],
  formula: [{ key: "scaled", operation: "input", inputKey: "factor" }], outputs: [{ key: "capacity", name: "Conditional capacity", nodeKey: "scaled", unit: {}, constraints: null }],
  cases: [{ key: "base", name: "Base case", kind: "base", changes: [] }, { key: "option", name: "Human option", kind: "option", changes: [{ kind: "intervention", assumptionKey: "factor", value: 3, rationale: "The human proposes this as a conditional intervention only" }] }],
  uncertaintyPolicy: { kind: "deterministic", rationale: "Nominal conditional arithmetic without claimed intervals" }, nonModeledEffects: ["External demand changes are unmodeled"], sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [companyId], retentionDays: 30 };
const scenario = { id: scenarioId, companyId, status: "published", publishedVersionId: versionId };
const version = { id: versionId, companyId, scenarioId, definition, contentHash: "a".repeat(64), inputHash: "b".repeat(64), expiresAt: "2026-11-01T00:00:00Z", currentQualification: "current" };
const run = { id: runId, companyId, scenarioId, versionId, createdAt: "2026-10-01T00:00:00Z", expiresAt: version.expiresAt, currentQualification: "current",
  result: { status: "calculated", definitionHash: version.contentHash, inputHash: version.inputHash, limitations: ["Conditional arithmetic does not establish causality"],
    cases: definition.cases.map((value, index) => ({ ...value, outputs: [{ key: "capacity", unit: {}, nominal: index ? 3 : 2, differenceFromBase: index ? 1 : 0, constraint: "not_declared" }] })) } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function transport(change?: (path: string, data: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (raw: string, input: RequestInit) => {
    const url = new URL(raw, "http://local.test"); expect(url.searchParams.get("expectedUserId")).toBe("manager-a"); expect(input.method ?? "GET").toBe("GET"); expect(input.signal).toBeTruthy();
    const data = url.pathname.endsWith("/runs") ? { items: [run], nextCursor: null, coverage: "bounded_current_authorized_page" }
      : url.pathname.endsWith(`/${scenarioId}`) ? { scenario, versions: [version] }
      : { items: [{ scenario, version }], nextCursor: null, coverage: "bounded_current_authorized_page" };
    return new Response(JSON.stringify(change ? change(url.pathname, structuredClone(data)) : data), { status: 200, headers: { "content-type": "application/json" } });
  }));
}
it("reads the retained exact published model and conditional comparisons without executing it", async () => {
  transport(); const read = await readInsightScenarioComparisons(companyId, "manager-a", new AbortController().signal);
  expect(read).toMatchObject({ boundedPage: true, items: [{ scenarioId, run: { result: { cases: [{ outputs: [{ nominal: 2, differenceFromBase: 0 }] }, { outputs: [{ nominal: 3, differenceFromBase: 1 }] }] } } }] }); expect(fetch).toHaveBeenCalledTimes(3);
});
it.each(["foreign_company", "changed_publication", "missing_definition", "changed_definition", "changed_input", "duplicate_run", "unknown_case", "changed_unit", "missing_output", "duplicate_case"])("refuses %s without private excerpts", async failure => {
  transport((path, data) => {
    if (path.endsWith(`/${scenarioId}`)) {
      if (failure === "changed_publication") data.scenario.publishedVersionId = runId;
      if (failure === "missing_definition") data.versions = [];
    }
    if (path.endsWith("/runs")) {
      if (failure === "foreign_company") data.items[0].companyId = runId;
      if (failure === "changed_definition") data.items[0].result.definitionHash = "c".repeat(64);
      if (failure === "changed_input") data.items[0].result.inputHash = "c".repeat(64);
      if (failure === "duplicate_run") data.items.push(data.items[0]);
      if (failure === "unknown_case") data.items[0].result.cases[0].key = "unknown";
      if (failure === "changed_unit") data.items[0].result.cases[0].outputs[0].unit = { issue: 1 };
      if (failure === "missing_output") data.items[0].result.cases[0].outputs = [];
      if (failure === "duplicate_case") data.items[0].result.cases.push(data.items[0].result.cases[0]);
    }
    return data;
  });
  await expect(readInsightScenarioComparisons(companyId, "manager-a", new AbortController().signal)).rejects.toThrow("insight_scenario_comparison_unavailable");
});
it("selects the published model even when the Native list displays a later proposed revision", async () => {
  transport((path, data) => { if (path.endsWith("business-scenarios")) { data.items[0].version.id = runId; data.items[0].version.definition.name = "PRIVATE unapproved proposed model"; } return data; });
  const read = await readInsightScenarioComparisons(companyId, "manager-a", new AbortController().signal); expect(read.items[0].definition.name).toBe(definition.name);
});
