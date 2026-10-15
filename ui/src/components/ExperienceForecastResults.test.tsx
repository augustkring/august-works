// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { ExperienceForecastResults } from "./ExperienceForecastResults";
import { readInsightForecastResults } from "../api/insight-forecast-results";
vi.mock("../api/insight-forecast-results", () => ({ readInsightForecastResults: vi.fn() }));
const live = vi.hoisted(() => ({ handler: null as null | ((event: any) => void) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (handler: any) => { live.handler = handler; } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const read = vi.mocked(readInsightForecastResults), companyId = "10000000-0000-4000-8000-000000000001";
let host: HTMLDivElement, root: Root, client: QueryClient;
function result(qualification = "qualified", expiresAt = new Date(Date.now() + 60000).toISOString()) {
  return { boundedPage: true, hasMoreForecasts: true, items: [{ specId: "forecast-a", expiresAt, hasMoreRuns: true, definition: { name: "PRIVATE model", businessQuestion: "What does this model estimate?", decisionUse: "Review only", provider: "aw_native", knownFailureModes: ["External changes are unmodeled"] },
    artifact: { expiresAt, cutoff: "2026-10-02T00:00:00Z", createdAt: "2026-10-03T00:00:00Z", currentQualification: qualification,
      result: { status: "qualified", unit: "objects", points: [{ from: "2026-10-01T00:00:00Z", until: "2026-10-02T00:00:00Z", value: 0, interval: null }], limitations: ["No guaranteed accuracy"] } } }] } as any;
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function render(user = "manager-a") { await act(async () => root.render(<QueryClientProvider client={client}><ExperienceForecastResults key={user} companyId={companyId} userId={user} scope={`${companyId}:${user}`} /></QueryClientProvider>)); await flush(); }
beforeEach(() => { vi.resetAllMocks(); read.mockResolvedValue(result()); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await act(async () => i18n.changeLanguage("en")); });
it("keeps a zero estimate, missing interval, cutoff and past-period limits explicit", async () => {
  await render(); expect(host.textContent).toContain("Estimate: 0 (objects)"); expect(host.textContent).toContain("No prediction interval is available");
  expect(host.textContent).toContain("does not establish future accuracy"); expect(host.textContent).toContain("Do not treat this as a forecast made before those periods");
});
it.each(["needs_revalidation", "inconclusive", "expired"])("withholds numbers for %s", async qualification => {
  read.mockResolvedValue(qualification === "expired" ? result("qualified", new Date(Date.now() - 1000).toISOString()) : result(qualification));
  await render(); expect(host.textContent).not.toContain("Estimate: 0");
});
it("labels model intervals without claiming empirical coverage", async () => {
  const data = result(); data.items[0].definition.provider = "statsforecast"; data.items[0].artifact.result.points[0].interval = { lower: -2, upper: 2, level80: { lower: -1, upper: 1 } };
  read.mockResolvedValue(data); await render(); expect(host.textContent).toContain("95% model interval"); expect(host.textContent).toContain("80% model interval"); expect(host.textContent).toContain("do not prove empirical coverage");
});
it("withdraws old forecast data on the actual Native forecast_spec activity event", async () => {
  await render(); read.mockImplementationOnce(() => new Promise(() => {})); await act(async () => live.handler!({ companyId, type: "activity.logged", payload: { entityType: "forecast_spec", action: "business_forecast.published" } })); await flush(); expect(host.textContent).not.toContain("PRIVATE");
});
it("cannot restore a late earlier-account result and uses localized fixed recovery", async () => {
  let release!: (value: never) => void; read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await render();
  read.mockResolvedValue({ items: [], boundedPage: true, hasMoreForecasts: false }); await render("manager-b"); await act(async () => release(result() as never)); await flush(); expect(host.textContent).not.toContain("PRIVATE");
  await act(async () => i18n.changeLanguage("da")); read.mockRejectedValueOnce(new Error("PRIVATE SOURCE ERROR"));
  await act(async () => { await client.invalidateQueries({ queryKey: ["experience-insights-forecast-results"] }); }); await flush(); expect(host.textContent).toContain("Gemte prognoser"); expect(host.textContent).not.toContain("PRIVATE");
});
