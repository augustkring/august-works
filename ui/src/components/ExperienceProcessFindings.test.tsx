// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { ExperienceProcessFindings } from "./ExperienceProcessFindings";
import { readInsightProcessFindings } from "../api/insight-process-findings";
vi.mock("../api/insight-process-findings", () => ({ readInsightProcessFindings: vi.fn() }));
const live = vi.hoisted(() => ({ handler: null as null | ((event: any) => void) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (handler: any) => { live.handler = handler; } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const read = vi.mocked(readInsightProcessFindings), companyId = "10000000-0000-4000-8000-000000000001";
let host: HTMLDivElement, root: Root, client: QueryClient;
function result(expiresAt = new Date(Date.now() + 60000).toISOString()) {
  return { boundedPage: true, hasMoreDefinitions: true, items: [{ definitionId: "definition-a", name: "PRIVATE process", businessQuestion: "Which paths need investigation?", expiresAt,
    run: { from: "2026-10-01T00:00:00Z", until: "2026-10-02T00:00:00Z", createdAt: "2026-10-03T00:00:00Z", expiresAt }, hasMoreEvidence: true,
    findings: [{ id: "finding-a", summary: "Recorded reopening", status: "OPEN", severity: "medium", interpretation: "PRIVATE human interpretation", expiresAt,
      facts: { observed: { reopenCount: 0, unknownPeriod: null }, limitations: ["No causal effect is established"] } }] }] } as never;
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function render(user = "manager-a") {
  await act(async () => root.render(<QueryClientProvider client={client}><ExperienceProcessFindings key={user} companyId={companyId} userId={user} scope={`${companyId}:${user}`} /></QueryClientProvider>)); await flush();
}
beforeEach(() => { vi.resetAllMocks(); read.mockResolvedValue(result()); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await act(async () => i18n.changeLanguage("en")); });
it("separates human interpretation from facts, preserves unknown and makes evidence inspectable", async () => {
  await render(); expect(host.textContent).toContain("Human interpretation"); expect(host.textContent).toContain("Unknown");
  expect(host.querySelector("dd")?.textContent).toBe("0"); expect(host.querySelector("details")?.textContent).toContain("No causal effect");
  expect(host.textContent).toContain("end excluded"); expect(host.textContent).toContain("not ordered by recency");
});
it("withdraws private findings while rechecking current authority", async () => {
  await render(); let release!: (value: never) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { void client.invalidateQueries({ queryKey: ["experience-insights-process-findings"] }); }); await flush(); expect(host.textContent).not.toContain("PRIVATE");
  await act(async () => release({ items: [], boundedPage: true, hasMoreDefinitions: false } as never)); await flush(); expect(host.textContent).not.toContain("PRIVATE");
});
it("withdraws the old finding immediately on Native finding or definition activity", async () => {
  await render(); read.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => live.handler!({ companyId, type: "activity.logged", payload: { entityType: "process_analysis_definition", action: "process_finding.transitioned" } }));
  await flush(); expect(host.textContent).not.toContain("PRIVATE");
});
it("cannot restore a late result from an earlier account", async () => {
  let release!: (value: never) => void; read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await render(); read.mockResolvedValue({ items: [], boundedPage: true, hasMoreDefinitions: false }); await render("manager-b");
  await act(async () => release(result())); await flush(); expect(host.textContent).not.toContain("PRIVATE");
});
it("withholds expired definitions and localizes fixed errors without Source excerpts", async () => {
  read.mockResolvedValue(result(new Date(Date.now() - 1000).toISOString())); await render(); expect(host.textContent).not.toContain("PRIVATE"); expect(host.textContent).toContain("expired");
  await act(async () => i18n.changeLanguage("da")); read.mockRejectedValueOnce(new Error("PRIVATE SOURCE ERROR"));
  await act(async () => { await client.invalidateQueries({ queryKey: ["experience-insights-process-findings"] }); }); await flush();
  expect(host.textContent).toContain("Gemte procesfund"); expect(host.textContent).toContain("kunne ikke læses"); expect(host.textContent).not.toContain("PRIVATE");
});
