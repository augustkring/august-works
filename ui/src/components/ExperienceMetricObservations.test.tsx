// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { ExperienceMetricObservations } from "./ExperienceMetricObservations";
import { readInsightMetricObservations } from "../api/insight-metric-observations";
vi.mock("../api/insight-metric-observations", () => ({ readInsightMetricObservations: vi.fn() }));
const live = vi.hoisted(() => ({ handler: null as null | ((event: any) => void) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (handler: (event: any) => void) => { live.handler = handler; } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const read = vi.mocked(readInsightMetricObservations);
let host: HTMLDivElement, root: Root, client: QueryClient;
const companyId = "10000000-0000-4000-8000-000000000001";
function result(status = "observed", value: number | null = 0, expiresAt = new Date(Date.now() + 60000).toISOString()) {
  return { boundedPage: true, hasMoreMetrics: true, items: [{ metricId: "10000000-0000-4000-8000-000000000002", name: "PRIVATE current measurement",
    definition: { businessQuestion: "How many tasks?", populationDescription: "Created tasks in their current state", timeSemantics: "created_in_window_current_state", authorityMode: "aw_native", timezone: "UTC", unit: "objects", calculation: { kind: "native_count", population: { entity: "issue" } } },
    hasMoreObservations: true, observations: [{ id: "10000000-0000-4000-8000-000000000004", from: "2026-10-01T00:00:00Z", until: "2026-10-14T00:00:00Z", asOf: "2026-10-14T00:00:00Z", expiresAt, status, value }],
  }] } as never;
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function render(company = companyId, user = "manager-a") {
  await act(async () => root.render(<QueryClientProvider client={client}><ExperienceMetricObservations key={`${company}:${user}`} companyId={company} userId={user} scope={`${company}:${user}:0`} /></QueryClientProvider>));
  await flush();
}
beforeEach(() => {
  vi.resetAllMocks(); read.mockResolvedValue(result());
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await act(async () => { await i18n.changeLanguage("en"); }); });

it("displays an observed zero with its recorded window, current-state semantics and bounded coverage", async () => {
  await render();
  expect(host.textContent).toContain("0 tasks");
  expect(host.textContent).toContain("not a reconstruction of historical state");
  expect(host.textContent).toContain("end excluded");
  expect(host.textContent).toContain("not a latest-result ranking");
  expect(host.textContent).toContain("More metrics may exist");
  expect(read).toHaveBeenCalledWith(companyId, "manager-a", expect.any(AbortSignal));
});
it("does not turn an undefined or expired result into zero", async () => {
  read.mockResolvedValueOnce(result("undefined", null));
  await render(); expect(host.textContent).toContain("do not interpret it as zero"); expect(host.textContent).not.toContain("0 tasks");
  read.mockResolvedValue(result("observed", 123, new Date(Date.now() - 1000).toISOString()));
  await act(async () => { await client.invalidateQueries({ queryKey: ["experience-insights-metric-observations"] }); });
  await flush(); expect(host.textContent).toContain("observation expired"); expect(host.textContent).not.toContain("123 tasks");
});
it("keeps unused definitions in the inspection view instead of repeating empty result blocks", async () => {
  const empty = result() as any; empty.items[0].observations = [];
  read.mockResolvedValue(empty); await render();
  expect(host.textContent).toContain("No saved measurements are available in this selection."); expect(host.textContent).not.toContain("PRIVATE");
});
it("withholds private results while the actual current-authority request is unsettled", async () => {
  await render();
  let release: ((value: never) => void) | undefined;
  read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { void client.invalidateQueries({ queryKey: ["experience-insights-metric-observations"] }); });
  await flush(); expect(host.textContent).not.toContain("PRIVATE");
  await act(async () => { release!({ items: [], boundedPage: true, hasMoreMetrics: false } as never); });
  await flush(); expect(host.textContent).not.toContain("PRIVATE");
});
it("withdraws the old metric revision immediately on its Native activity event", async () => {
  await render();
  read.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => { live.handler!({ companyId, type: "activity.logged", payload: { entityType: "business_metric", action: "business_metric.published" } }); });
  await flush(); expect(host.textContent).not.toContain("PRIVATE");
});
it("cannot restore an earlier account's result after switching the company and principal", async () => {
  let release: ((value: never) => void) | undefined;
  read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await render();
  read.mockResolvedValue({ items: [], boundedPage: true, hasMoreMetrics: false });
  await render("10000000-0000-4000-8000-000000000099", "manager-b");
  await act(async () => { release!(result()); });
  await flush(); expect(host.textContent).not.toContain("PRIVATE");
});
it("localizes the read-only explanation and hides a private Source error", async () => {
  await act(async () => { await i18n.changeLanguage("da"); });
  read.mockRejectedValue(new Error("PRIVATE Source query and tenant facts"));
  await render();
  expect(host.textContent).toContain("Gemte målinger");
  expect(host.textContent).toContain("kunne ikke læses");
  expect(host.textContent).not.toContain("PRIVATE");
});
