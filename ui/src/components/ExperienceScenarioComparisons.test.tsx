// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { ExperienceScenarioComparisons } from "./ExperienceScenarioComparisons";
import { readInsightScenarioComparisons } from "../api/insight-scenario-comparisons";
vi.mock("../api/insight-scenario-comparisons", () => ({ readInsightScenarioComparisons: vi.fn() }));
const live = vi.hoisted(() => ({ handler: null as null | ((event: any) => void) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (handler: any) => { live.handler = handler; } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const read = vi.mocked(readInsightScenarioComparisons), companyId = "10000000-0000-4000-8000-000000000001";
let host: HTMLDivElement, root: Root, client: QueryClient;
function result(qualification = "current", status = "calculated", expiresAt = new Date(Date.now() + 60000).toISOString()) {
  return { boundedPage: true, hasMoreScenarios: true, items: [{ scenarioId: "scenario-a", expiresAt, currentQualification: qualification, hasMoreRuns: true,
    definition: { name: "PRIVATE conditional model", objective: "Compare declared assumptions", decisionUse: "Inform a human review", outputs: [{ key: "capacity", name: "Conditional capacity" }],
      cases: [{ key: "base", changes: [] }], assumptions: [{ key: "factor", name: "Human coefficient", nominal: 2, unit: {}, range: { minimum: 1, maximum: 3 }, confidence: "human_asserted", uncertaintyRationale: "No causal calibration" }], nonModeledEffects: ["Demand changes are unmodeled"] },
    run: { currentQualification: qualification, expiresAt, createdAt: "2026-10-01T00:00:00Z", result: { status, limitations: ["Not a commitment"], cases: [{ key: "base", name: "Base case", kind: "base", outputs: [{ key: "capacity", unit: {}, nominal: 12345, differenceFromBase: 0, constraint: "not_declared" }] }] } } }] } as never;
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function render(user = "manager-a") { await act(async () => root.render(<QueryClientProvider client={client}><ExperienceScenarioComparisons key={user} companyId={companyId} userId={user} scope={`${companyId}:${user}`} /></QueryClientProvider>)); await flush(); }
beforeEach(() => { vi.resetAllMocks(); read.mockResolvedValue(result()); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await act(async () => i18n.changeLanguage("en")); });
it("presents conditional values with assumptions, units, declared constraints and limited coverage", async () => {
  await render(); expect(host.textContent).toContain("12,345 without unit"); expect(host.textContent).toContain("does not prove its assumptions");
  expect(host.querySelector("details")?.textContent).toContain("Human-declared assumption"); expect(host.textContent).toContain("Declared range: 1 to 3");
  expect(host.textContent).toContain("not ordered by recency"); expect(host.textContent).toContain("No constraint declared");
});
it.each(["needs_revalidation", "inconclusive", "data_not_ready", "expired"])("withholds the number for %s", async condition => {
  read.mockResolvedValue(condition === "needs_revalidation" ? result(condition) : condition === "expired" ? result("current", "calculated", new Date(Date.now() - 1000).toISOString()) : result("current", condition));
  await render(); expect(host.textContent).not.toContain("12,345");
});
it("withdraws the old comparison on a Native scenario revision", async () => {
  await render(); read.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => live.handler!({ companyId, type: "activity.logged", payload: { entityType: "business_scenario", action: "business_scenario.published" } })); await flush(); expect(host.textContent).not.toContain("PRIVATE"); expect(host.textContent).not.toContain("12,345");
});
it("cannot restore a late earlier-account result", async () => {
  let release!: (value: never) => void; read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await render();
  read.mockResolvedValue({ items: [], boundedPage: true, hasMoreScenarios: false }); await render("manager-b"); await act(async () => release(result())); await flush(); expect(host.textContent).not.toContain("PRIVATE");
});
it("localizes safe recovery without private Source errors", async () => {
  await act(async () => i18n.changeLanguage("da")); read.mockRejectedValue(new Error("PRIVATE Source failure")); await render();
  expect(host.textContent).toContain("Gemte scenariesammenligninger"); expect(host.textContent).toContain("kunne ikke læses"); expect(host.textContent).not.toContain("PRIVATE");
});
