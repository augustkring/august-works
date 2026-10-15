// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { ExperienceManagementReviews } from "./ExperienceManagementReviews";
import { readInsightManagementReviewSummaries } from "../api/insight-management-review-summaries";
vi.mock("../api/insight-management-review-summaries", () => ({ readInsightManagementReviewSummaries: vi.fn() }));
const live = vi.hoisted(() => ({ handler: null as null | ((event: any) => void) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (handler: any) => { live.handler = handler; } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const read = vi.mocked(readInsightManagementReviewSummaries), companyId = "10000000-0000-4000-8000-000000000001";
let host: HTMLDivElement, root: Root, client: QueryClient;
function result(qualification = "current", expiresAt = new Date(Date.now() + 60000).toISOString()) {
  return { boundedPage: true, hasMoreReviews: true, items: [{ id: "review-a", name: "PRIVATE historical review", reviewType: "weekly_leadership", expiresAt, currentQualification: qualification,
    packet: { asOf: "2026-10-01T00:00:00Z", period: { from: "2026-09-30T00:00:00Z", until: "2026-10-01T00:00:00Z" }, limitations: ["Selected sources only"],
      agenda: [{ key: "decide", category: "DECISION_REQUIRED", sourceKeys: ["goal"], dueAt: "2026-11-01T00:00:00Z", nextAction: "PRIVATE next action", hypothesis: "PRIVATE human hypothesis" }],
      claims: [{ key: "claim_goal", sourceKeys: ["goal"], grade: "native_current_state", facts: { count: 0, target: null, complete: false }, limitations: ["No historical reconstruction"] }] } }] } as any;
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function render(user = "manager-a") { await act(async () => root.render(<QueryClientProvider client={client}><ExperienceManagementReviews key={user} companyId={companyId} userId={user} scope={`${companyId}:${user}`} /></QueryClientProvider>)); await flush(); }
beforeEach(() => { vi.resetAllMocks(); read.mockResolvedValue(result()); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await act(async () => i18n.changeLanguage("en")); });
it("keeps Human agenda/causal hypotheses and citations distinct from decisions, unknown and zero", async () => {
  await render(); expect(host.textContent).toContain("not completed decisions or approvals"); expect(host.textContent).toContain("Human hypothesis; not an established cause");
  expect(host.querySelector("details")?.textContent).toContain("Cited sources: goal"); expect(host.querySelector("dd")?.textContent).toBe("0"); expect(host.textContent).toContain("Unknown");
});
it("withholds the retained agenda and evidence after current sources require revalidation", async () => {
  read.mockResolvedValue(result("needs_revalidation")); await render(); expect(host.textContent).not.toContain("PRIVATE next action"); expect(host.querySelector("details")).toBeNull(); expect(host.textContent).toContain("require revalidation");
});
it("withdraws the old review on Native management activity and cannot restore a late account result", async () => {
  await render(); let release!: (value: never) => void; read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => live.handler!({ companyId, type: "activity.logged", payload: { entityType: "management_review", action: "management_review.published" } })); await flush(); expect(host.textContent).not.toContain("PRIVATE");
  read.mockResolvedValue({ items: [], boundedPage: true, hasMoreReviews: false }); await render("manager-b"); await act(async () => release(result() as never)); await flush(); expect(host.textContent).not.toContain("PRIVATE");
});
it("hides expired private content and localizes fixed recovery without raw Source errors", async () => {
  read.mockResolvedValue(result("current", new Date(Date.now() - 1000).toISOString())); await render(); expect(host.textContent).not.toContain("PRIVATE");
  await act(async () => i18n.changeLanguage("da")); read.mockRejectedValueOnce(new Error("PRIVATE Source exception"));
  await act(async () => { await client.invalidateQueries({ queryKey: ["experience-insights-management-review-summaries"] }); }); await flush(); expect(host.textContent).toContain("Udgivne ledelsesgennemgange"); expect(host.textContent).not.toContain("PRIVATE");
});
