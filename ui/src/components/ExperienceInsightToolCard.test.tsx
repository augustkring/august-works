// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExperienceToolCard } from "./ExperienceToolCard";
import { experienceApi } from "../api/experience";
import { i18n } from "../i18n";
const companyId = "10000000-0000-4000-8000-000000000001", resourceId = "review:10000000-0000-4000-8000-000000000002";
const f = vi.hoisted(() => ({ profile: "manager", userId: "manager-a", loading: false, enabled: true, handler: null as null | ((event: any) => void) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: companyId }) }));
vi.mock("../hooks/useV9FeatureEnabled", () => ({ useV9FeatureEnabled: () => ({ enabled: f.enabled, query: { isPending: false, isFetching: false, isError: false } }) }));
vi.mock("../hooks/useExperience", () => ({ useExperience: () => ({ loading: f.loading, query: { isError: false, data: { profile: f.profile } },
  identity: { localImplicit: false, userId: f.userId, authorityEpoch: 0 }, scope: `${companyId}:${f.userId}` }) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (handler: any) => { f.handler = handler; } }));
vi.mock("../api/experience", () => ({ experienceApi: { insightCard: vi.fn() } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const source = { companyId, domain: "insight" as const, resourceId, version: "a".repeat(64), observedAt: "2026-10-01T00:00:00Z" };
const wire = { schemaVersion: 1, component: "ResultCard", companyId, cardId: `insight:${resourceId}`, source: { companyId, domain: "insight", resourceId, version: source.version } };
const card = { id: wire.cardId, kind: "result", source, freshness: "fresh", title: "PRIVATE current Native review", whyYou: null, consequence: "Native read-only evidence",
  evidence: ["native_historical_review", "human_agenda_not_decision_or_approval"], actions: [{ id: "inspect", label: "Inspect", operation: "open", href: "/management-reviews", criticality: "C2", source, requiresCurrentAuthorization: true }] } as any;
let host: HTMLDivElement, root: Root, client: QueryClient;
const read = vi.mocked(experienceApi.insightCard);
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><ExperienceToolCard wire={wire} state="ready" /></QueryClientProvider>)); await flush(); }
beforeEach(() => { vi.resetAllMocks(); f.userId = "manager-a"; f.profile = "manager"; f.loading = false; f.enabled = true; read.mockResolvedValue(card);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await act(async () => i18n.changeLanguage("en")); });
it("renders only the current Native read with localized read-only authority and exact references", async () => {
  await render(); expect(host.textContent).toContain(card.title); expect(host.textContent).toContain("Published historical review");
  expect(host.textContent).toContain("not a decision or approval"); expect(host.querySelector("a")?.getAttribute("href")).toBe("/management-reviews");
  expect(read).toHaveBeenCalledWith(wire, "manager-a", expect.any(AbortSignal));
});
it("does not fetch or disclose the card in the member experience", async () => {
  f.profile = "member"; await render(); expect(read).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("PRIVATE"); expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
it("withdraws a retained Native card during current Source activity", async () => {
  await render(); read.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => f.handler!({ companyId, type: "activity.logged", payload: { entityType: "management_review", action: "management_review.published" } }));
  await flush(); expect(host.textContent).not.toContain("PRIVATE");
});
it("cannot restore a late card from an earlier account", async () => {
  let release!: (value: any) => void; read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); await render();
  f.userId = "manager-b"; read.mockRejectedValueOnce(new Error("PRIVATE Source error")); await render();
  await act(async () => release(card)); await flush(); expect(host.textContent).not.toContain("PRIVATE");
});
it("refuses a substituted Native source or executable action and preserves fixed localized recovery", async () => {
  read.mockResolvedValueOnce({ ...card, source: { ...source, version: "b".repeat(64) } }); await render(); expect(host.textContent).not.toContain("PRIVATE");
  await act(async () => i18n.changeLanguage("da")); read.mockResolvedValueOnce({ ...card, actions: [{ ...card.actions[0], operation: "accept" }] });
  await act(async () => { await client.invalidateQueries({ queryKey: ["experience-insight-tool-card"] }); }); await flush(); expect(host.textContent).not.toContain("PRIVATE"); expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
