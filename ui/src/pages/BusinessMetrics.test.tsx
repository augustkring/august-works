// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { businessMetricDefinitionSchema, type BusinessMetricResult } from "@paperclipai/shared";
import { BusinessMetrics } from "./BusinessMetrics";
import { businessMetricTargetsApi } from "@/api/business-metric-targets";
import { businessMetricsApi } from "@/api/business-metrics";
const fixture = vi.hoisted(() => ({ companyId: "11111111-1111-4111-8111-111111111111", userId: "account-one", settled: true, failed: false, breadcrumbs: vi.fn() }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: fixture.companyId }) }));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => ({ userId: fixture.userId, settled: fixture.settled, failed: fixture.failed }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: fixture.breadcrumbs }) }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("@/api/business-metrics", () => ({ businessMetricsApi: { list: vi.fn(), detail: vi.fn(), query: vi.fn(), create: vi.fn(), createVersion: vi.fn(), publish: vi.fn(), transition: vi.fn() } }));
vi.mock("@/api/business-metric-targets", () => ({ businessMetricTargetsApi: { list: vi.fn(async () => ({ items: [], nextCursor: null })), detail: vi.fn(), compare: vi.fn(), approve: vi.fn(), retire: vi.fn(), create: vi.fn(), revise: vi.fn() } }));
vi.mock("@/api/ai-governance", () => ({ aiGovernanceApi: { obligations: vi.fn(async () => []) } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const metricId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const definition = businessMetricDefinitionSchema.parse({ name: "Task completion", description: "Current completion of created tasks", businessQuestion: "How much is currently complete?", decisionUse: "Review backlog", populationDescription: "Tasks created in the chosen window", inclusions: ["Created in window"], exclusions: [], authorityMode: "aw_native", valueType: "ratio", unit: "ratio", currency: null, grain: "issue", timeGrain: "window", timezone: "UTC", timeSemantics: "created_in_window_current_state", dimensions: [], calculation: { kind: "native_ratio", numerator: { entity: "issue", statuses: ["done"], projectId: null }, denominator: { entity: "issue", statuses: ["todo", "done"], projectId: null } }, ownerUserId: "account-one", reviewFrequencyDays: 30, freshnessSeconds: 3600, missingPolicy: "explicit_unknown", goodhartRisk: "Completion does not establish outcomes", purpose: "management_intelligence", sensitivity: "internal", governanceObligationRefs: [metricId], retentionDays: 30 });
function result(): BusinessMetricResult { return { id: metricId, companyId: fixture.companyId, metricId, versionId, from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", asOf: "2026-10-06T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", status: "undefined", value: null, reason: "empty_denominator", groups: [], inputHash: "a".repeat(64), definitionHash: "b".repeat(64), engineVersion: "test", lineageManifestId: metricId, sourceWatermark: "empty_population" }; }
beforeEach(() => {
  fixture.companyId = "11111111-1111-4111-8111-111111111111"; fixture.userId = "account-one"; fixture.settled = true; fixture.failed = false;
  vi.mocked(businessMetricsApi.list).mockImplementation(async companyId => ({ items: [{ id: metricId, companyId, key: "completion", revision: 2, status: "published", publishedVersionId: versionId, createdAt: "2026-10-06T00:00:00Z", updatedAt: "2026-10-06T00:00:00Z" }], nextCursor: null }));
  vi.mocked(businessMetricsApi.detail).mockImplementation(async companyId => ({ metric: { id: metricId, companyId, key: "completion", revision: 2, status: "published", publishedVersionId: versionId, createdAt: "2026-10-06T00:00:00Z", updatedAt: "2026-10-06T00:00:00Z" }, versions: [{ id: versionId, companyId, metricId, revision: 1, definition, contentHash: "b".repeat(64), createdAt: "2026-10-06T00:00:00Z" }] }));
  vi.mocked(businessMetricTargetsApi.list).mockResolvedValue({ items: [], nextCursor: null });
  vi.mocked(businessMetricsApi.query).mockImplementation(async () => result());
});
afterEach(() => vi.clearAllMocks());
async function mount() {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const render = async () => { await act(async () => root.render(<QueryClientProvider client={client}><BusinessMetrics /></QueryClientProvider>)); await flush(); };
  await render();
  return { container, render, cleanup: async () => { await act(async () => root.unmount()); container.remove(); client.clear(); } };
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function selectMetric(container: HTMLElement) {
  await act(async () => { const select = container.querySelector("select")!; select.value = metricId; select.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
}
async function observe(container: HTMLElement) { await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Observe selected population")!.click()); await flush(); }
describe("business metrics operator boundary", () => {
  it("pins reads and observation to the current account and displays a missing denominator as unknown", async () => {
    const app = await mount();
    try {
      await selectMetric(app.container); await observe(app.container);
      expect(businessMetricsApi.list).toHaveBeenCalledWith(fixture.companyId, undefined, "account-one");
      expect(businessMetricsApi.detail).toHaveBeenCalledWith(fixture.companyId, metricId, "account-one");
      expect(businessMetricsApi.query).toHaveBeenCalledWith(fixture.companyId, expect.objectContaining({ metricId, versionId }), "account-one");
      const panel = app.container.querySelector('[aria-label="Metric observation"]');
      expect(panel?.textContent).toContain("Unknown"); expect(panel?.textContent).toContain("A ratio cannot be calculated");
      expect(panel?.textContent).toContain("does not reconstruct past task");
    } finally { await app.cleanup(); }
  });
  it("does not display a late result after switching company and account", async () => {
    let resolve!: (value: BusinessMetricResult) => void;
    vi.mocked(businessMetricsApi.query).mockImplementation(() => new Promise(r => { resolve = r; }));
    const app = await mount();
    try {
      await selectMetric(app.container); await observe(app.container);
      const oldResult = result();
      fixture.companyId = "44444444-4444-4444-8444-444444444444"; fixture.userId = "account-two";
      await app.render(); await act(async () => resolve(oldResult)); await flush();
      expect(app.container.querySelector('[aria-label="Metric observation"]')).toBeNull();
      expect(businessMetricsApi.list).toHaveBeenLastCalledWith(fixture.companyId, undefined, "account-two");
      expect(businessMetricsApi.query).toHaveBeenCalledTimes(1);
    } finally { await app.cleanup(); }
  });
  it("does not return a late commitment comparison into a different company/account workspace", async () => {
    const targetId = "55555555-5555-4555-8555-555555555555";
    const pinId = "66666666-6666-4666-8666-666666666666";
    const target = { id: targetId, companyId: fixture.companyId, metricId, key: "completion_target", revision: 2, status: "approved" as const, approvedVersionId: pinId, createdAt: "2026-10-06T00:00:00Z", updatedAt: "2026-10-06T00:00:00Z" };
    vi.mocked(businessMetricTargetsApi.list).mockResolvedValue({ items: [target], nextCursor: null });
    vi.mocked(businessMetricTargetsApi.detail).mockResolvedValue({ target, reviewReason: null, versions: [{ id: pinId, companyId: fixture.companyId, targetId, revision: 1, contentHash: "c".repeat(64), createdAt: target.createdAt, definition: { metricId, metricVersionId: versionId, scope: { type: "company" }, periodStart: result().from, periodEnd: result().until, criterion: { kind: "at_least", value: 0.8 }, rationale: "Reviewed native commitment", assumptions: ["Completion does not measure outcomes"], ownerUserId: "account-one" } }] });
    let resolve!: (value: Awaited<ReturnType<typeof businessMetricTargetsApi.compare>>) => void;
    vi.mocked(businessMetricTargetsApi.compare).mockImplementation(() => new Promise(r => { resolve = r; }));
    const app = await mount();
    try {
      await selectMetric(app.container);
      await act(async () => { const select = app.container.querySelector('[aria-label="Metric commitments"] select') as HTMLSelectElement; select.value = targetId; select.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
      await act(async () => [...app.container.querySelectorAll("button")].find(button => button.textContent === "Observe and compare approved commitment")!.click()); await flush();
      expect(businessMetricTargetsApi.compare).toHaveBeenCalledWith(fixture.companyId, targetId, "account-one");
      fixture.companyId = "44444444-4444-4444-8444-444444444444"; fixture.userId = "account-two";
      await app.render(); await act(async () => resolve({ observation: result(), comparison: { targetId, targetVersionId: pinId, observationId: metricId, status: "unknown", value: null, reason: "empty_denominator", asOf: result().asOf } })); await flush();
      expect(app.container.querySelector('[aria-label="Commitment comparison"]')).toBeNull();
      expect(businessMetricTargetsApi.approve).not.toHaveBeenCalled();
    } finally { await app.cleanup(); }
  });
  it("holds all company reads while current account verification has not succeeded", async () => {
    fixture.settled = false; fixture.failed = true; const app = await mount();
    try { expect(app.container.textContent).toContain("account could not be verified"); expect(businessMetricsApi.list).not.toHaveBeenCalled(); }
    finally { await app.cleanup(); }
  });
});
