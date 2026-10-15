// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { ExperienceExperimentResults } from "./ExperienceExperimentResults";
import { readInsightExperimentResults } from "../api/insight-experiment-results";
vi.mock("../api/insight-experiment-results", () => ({ readInsightExperimentResults: vi.fn() }));
const live = vi.hoisted(() => ({ handler: null as null | ((event: any) => void) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (handler: any) => { live.handler = handler; } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const read = vi.mocked(readInsightExperimentResults), companyId = "10000000-0000-4000-8000-000000000001";
let host: HTMLDivElement, root: Root, client: QueryClient;
function result() {
  return { boundedPage: true, hasMoreExperiments: true, items: [{ experimentId: "experiment-a", state: "decided", currentQualification: "current", expiresAt: new Date(Date.now() + 60000).toISOString(),
    definition: { name: "PRIVATE registered experiment", hypothesis: "Compare a registered process change", decisionQuestion: "Should this inform a later decision?", sampleOrDurationPlan: { from: "2026-10-01T00:00:00Z", until: "2026-10-02T00:00:00Z" }, primaryMetric: { key: "primary", name: "Primary success" }, guardrailMetrics: [], secondaryMetrics: [], population: { externalValidityLimits: "Does not establish general applicability" } },
    summary: { currentQualification: "current", analysis: { currentQualification: "current", causalAuthority: "conditional_on_registered_randomization_and_human_attestations", analyzedAt: "2026-10-03T00:00:00Z",
      qualityGates: { assignmentReceipts: true, exposureReports: true, finalOutcomeCapture: "complete", identityJoins: true, baselineBalance: true, concurrentReviewAdmitted: true },
      result: { status: "pass", numericallyQualified: true, metrics: [{ key: "primary", role: "primary", control: { units: 20, successes: 0, rate: 0 }, treatment: { units: 20, successes: 10, rate: 0.5 }, effect: 0.5,
        interval: { lower: 0.1, upper: 0.8, familywiseCoverage: 0.95 }, interpretation: "threshold_met" }], limitations: ["Conditional on human exposure attestations"] } },
      interpretation: { conclusion: "ship_candidate", rationale: "PRIVATE human review rationale; advisory only" } } }] } as any;
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function render(user = "manager-a") { await act(async () => root.render(<QueryClientProvider client={client}><ExperienceExperimentResults key={user} companyId={companyId} userId={user} scope={`${companyId}:${user}`} /></QueryClientProvider>)); await flush(); }
beforeEach(() => { vi.resetAllMocks(); read.mockResolvedValue(result()); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await act(async () => i18n.changeLanguage("en")); });
it("distinguishes percentage points from rates and keeps the recorded human conclusion advisory", async () => {
  await render(); expect(host.textContent).toContain("Control: 0 of 20 (0%)"); expect(host.textContent).toContain("Treatment: 10 of 20 (50%)");
  expect(host.textContent).toContain("Difference: 50 percentage points"); expect(host.textContent).toContain("10 to 80 percentage points");
  expect(host.textContent).toContain("familywise coverage 95%"); expect(host.textContent).toContain("Candidate for rollout review"); expect(host.textContent).toContain("separate authorized decision");
});
it.each(["version", "summary", "analysis", "causal", "quality", "invalid", "inconclusive", "numerical"])("withholds numbers after %s qualification fails", async failure => {
  const data = result(), item = data.items[0], analysis = item.summary.analysis;
  if (failure === "version") item.currentQualification = "needs_revalidation";
  if (failure === "summary") item.summary.currentQualification = "needs_revalidation";
  if (failure === "analysis") analysis.currentQualification = "needs_revalidation";
  if (failure === "causal") analysis.causalAuthority = "withheld";
  if (failure === "quality") analysis.qualityGates.identityJoins = false;
  if (["invalid", "inconclusive"].includes(failure)) analysis.result.status = failure;
  if (failure === "inconclusive") { analysis.result.numericallyQualified = false; analysis.causalAuthority = "withheld"; }
  if (failure === "numerical") analysis.result.numericallyQualified = false;
  read.mockResolvedValue(data); await render(); expect(host.textContent).not.toContain("Difference: 50");
  if (["version", "summary", "analysis"].includes(failure)) expect(host.textContent).not.toContain("PRIVATE human review");
});
it("shows a qualified interval without turning an inconclusive comparison into a successful experiment", async () => {
  const data = result(); data.items[0].summary.analysis.result.status = "inconclusive"; read.mockResolvedValue(data);
  await render(); expect(host.textContent).toContain("The analysis is inconclusive."); expect(host.textContent).toContain("10 to 80 percentage points");
});
it("withdraws private results on Native experiment activity and cannot restore a late prior account", async () => {
  await render(); let release!: (value: never) => void; read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => live.handler!({ companyId, type: "activity.logged", payload: { entityType: "business_experiment", action: "business_experiment.interpreted" } }));
  await flush(); expect(host.textContent).not.toContain("PRIVATE");
  read.mockResolvedValue({ items: [], boundedPage: true, hasMoreExperiments: false }); await render("manager-b");
  await act(async () => release(result() as never)); await flush(); expect(host.textContent).not.toContain("PRIVATE");
});
it("withholds expired content and localizes safe Source error recovery", async () => {
  const data = result(); data.items[0].expiresAt = new Date(Date.now() - 1000).toISOString(); read.mockResolvedValue(data); await render(); expect(host.textContent).not.toContain("PRIVATE");
  await act(async () => i18n.changeLanguage("da")); read.mockRejectedValueOnce(new Error("PRIVATE assignment records"));
  await act(async () => { await client.invalidateQueries({ queryKey: ["experience-insights-experiment-results"] }); }); await flush();
  expect(host.textContent).toContain("Gemte forsøgsresultater"); expect(host.textContent).toContain("kunne ikke læses"); expect(host.textContent).not.toContain("PRIVATE");
});
