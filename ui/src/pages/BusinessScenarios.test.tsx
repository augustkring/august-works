// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessScenarios } from "./BusinessScenarios";
import { businessScenariosApi } from "@/api/business-scenarios";
import { businessMetricsApi } from "@/api/business-metrics";
import { scenarioFixture } from "../../storybook/stories/business-scenario-fixtures";
const identity = vi.hoisted(() => ({ companyId: "00000000-0000-4000-8000-000000000001", userId: "reviewer", settled: true, failed: false, breadcrumbs: vi.fn() }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: identity.companyId }) }));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => identity }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: identity.breadcrumbs }) }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: { getExperimental: vi.fn(async () => ({ analytical_lineage_v8: true, business_metrics_v8: true, scenario_planning_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true })) } }));
vi.mock("@/api/business-scenarios", () => ({ businessScenariosApi: { list: vi.fn(), detail: vi.fn(), create: vi.fn(), revise: vi.fn(), publish: vi.fn(), run: vi.fn(), retire: vi.fn(), runs: vi.fn(), result: vi.fn() } }));
vi.mock("@/api/business-metrics", () => ({ businessMetricsApi: { list: vi.fn(), detail: vi.fn(), observations: vi.fn() } }));
vi.mock("@/api/ai-governance", () => ({ aiGovernanceApi: { obligations: vi.fn(async () => [scenarioFixture().policy]) } }));
vi.mock("@/api/projects", () => ({ projectsApi: { list: vi.fn(async () => []) } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };
async function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }), container = document.createElement("div"); document.body.append(container); const root = createRoot(container); const render = async () => { await act(async () => root.render(<QueryClientProvider client={client}><BusinessScenarios /></QueryClientProvider>)); await flush(); }; await render(); return { client, container, render, cleanup: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); } }; }
async function click(container: HTMLElement, label: string) { const find = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === label); for (let i = 0; i < 20 && (!find() || find()!.disabled); i++) await flush(); expect(find(), label).toBeDefined(); expect(find()!.disabled, label).toBe(false); await act(async () => find()!.click()); await flush(); }
async function select(container: HTMLElement, label: string, value: string) { await act(async () => { const input = container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!; input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); }); await flush(); }
async function text(container: HTMLElement, label: string, value: string) { await act(async () => { const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!; Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); await flush(); }
function responses(published = false, monteCarlo = false) { const f = scenarioFixture(published, monteCarlo); vi.mocked(businessScenariosApi.list).mockResolvedValue({ items: [{ scenario: f.scenario, version: f.version }], nextCursor: null, coverage: "bounded_current_authorized_page" }); vi.mocked(businessScenariosApi.detail).mockResolvedValue({ scenario: f.scenario, versions: [f.version] }); vi.mocked(businessScenariosApi.runs).mockResolvedValue({ items: [f.run], nextCursor: null, coverage: "bounded_current_authorized_page" }); vi.mocked(businessScenariosApi.result).mockResolvedValue(f.run); return f; }
beforeEach(() => { vi.clearAllMocks(); const f = responses(); identity.companyId = f.companyId; identity.userId = f.userId; identity.settled = true; identity.failed = false; vi.mocked(businessMetricsApi.list).mockResolvedValue({ items: [f.metric], nextCursor: null }); vi.mocked(businessMetricsApi.detail).mockResolvedValue({ metric: f.metric, versions: [f.metricVersion] }); vi.mocked(businessMetricsApi.observations).mockResolvedValue({ items: f.observations, nextCursor: null, coverage: "bounded_current_authorized_page" }); });
describe("Native conditional scenario operator boundaries", () => {
  it("records an explicit human-only model proposal without implicitly publishing or running", async () => {
    const f = scenarioFixture(); vi.mocked(businessScenariosApi.create).mockResolvedValue({ scenario: f.scenario, version: f.version }); const app = await mount();
    try { await click(app.container, "Define a scenario"); await text(app.container, "Scenario key", "capacity_conditions"); await text(app.container, "Scenario name", "Conditional capacity review"); await text(app.container, "Scenario objective", "Compare explicit human capacity conditions for review"); await text(app.container, "Decision use", "Prepare a separate human capacity decision with no execution effects"); await select(app.container, "Approved scenario purpose", f.policy.id); await text(app.container, "Assumption 1 human name", "Human conditional capacity factor"); await text(app.container, "Assumption 1 human evidence", "Human-declared capacity factor without empirical calibration"); await text(app.container, "Assumption 1 uncertainty rationale", "Demand changes and operational response are unmodeled"); await text(app.container, "Output 1 human name", "Nominal conditional capacity"); await text(app.container, "Nominal calculation limits", "This model propagates nominal values only, without uncertainty ranges"); await text(app.container, "Non-modeled effects (one per line)", "Demand response and execution fidelity are not modeled"); await click(app.container, "Save scenario proposal"); expect(businessScenariosApi.create).toHaveBeenCalledWith(f.companyId, { key: "capacity_conditions", definition: expect.objectContaining({ inputs: [], ownerUserId: f.userId, purpose: "management_intelligence", governanceObligationRefs: [f.policy.id], calculationType: "formula" }) }, f.userId); expect(businessScenariosApi.publish).not.toHaveBeenCalled(); expect(businessScenariosApi.run).not.toHaveBeenCalled(); } finally { await app.cleanup(); }
  });
  it("revises with exact native identity/unit pins and expected revision without accepting copied captured facts", async () => {
    const f = scenarioFixture(); vi.mocked(businessScenariosApi.revise).mockResolvedValue({ scenario: f.scenario, version: f.version }); const app = await mount();
    try { await select(app.container, "Scenario", f.scenario.id); await click(app.container, "Propose a scenario revision"); await text(app.container, "Scenario objective", "Human revision of the conditional model under retained native authority"); await click(app.container, "Save scenario proposal"); const call = vi.mocked(businessScenariosApi.revise).mock.calls[0]; expect(call).toEqual([f.companyId, f.scenario.id, { expectedRevision: 1, definition: expect.objectContaining({ inputs: [{ kind: "metric_observation", key: "objects", metricId: f.metric.id, metricVersionId: f.metricVersion.id, observationId: f.observations[0].id, unit: { issue: 1 } }] }) }, f.userId]); expect(call[2].definition).not.toHaveProperty("inputHash"); expect(call[2].definition.inputs[0]).not.toHaveProperty("value"); expect(businessScenariosApi.publish).not.toHaveBeenCalled(); expect(businessScenariosApi.run).not.toHaveBeenCalled(); } finally { await app.cleanup(); }
  });
  it("does not silently rebind a removed assumption to a new draft assumption", async () => {
    const f = scenarioFixture(); const app = await mount();
    try {
      await select(app.container, "Scenario", f.scenario.id);
      await click(app.container, "Propose a scenario revision");
      await text(app.container, "Assumption 1 reference name", "assumption_1");
      await select(app.container, "Calculation 2 declared input", "assumption_1");
      await click(app.container, "Remove assumption 1");
      await click(app.container, "Add human assumption");
      expect(app.container.querySelector<HTMLInputElement>('[aria-label="Assumption 1 reference name"]')!.value).toBe("assumption_2");
      await text(app.container, "Assumption 1 human name", "A separately reviewed replacement assumption");
      await text(app.container, "Assumption 1 human evidence", "A new human declaration with no inherited references");
      await text(app.container, "Assumption 1 uncertainty rationale", "This new condition has not been empirically calibrated");
      const save = [...app.container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Save scenario proposal")!;
      expect(save.disabled).toBe(true);
      expect(businessScenariosApi.revise).not.toHaveBeenCalled();
    } finally { await app.cleanup(); }
  });
  it("requires separate human publication of the exact current proposed version", async () => {
    const f = scenarioFixture(); vi.mocked(businessScenariosApi.publish).mockResolvedValue(scenarioFixture(true).scenario); const app = await mount();
    try { await select(app.container, "Scenario", f.scenario.id); await text(app.container, "Human scenario review rationale", "Human review of the exact conditional assumptions and source pins"); await click(app.container, "Publish this scenario version"); expect(businessScenariosApi.publish).toHaveBeenCalledWith(f.companyId, f.scenario.id, { expectedRevision: 1, versionId: f.version.id, rationale: "Human review of the exact conditional assumptions and source pins" }, f.userId); expect(businessScenariosApi.run).not.toHaveBeenCalled(); } finally { await app.cleanup(); }
  });
  it("runs a human-published Monte Carlo version with the legitimate seed zero and no copied inputs", async () => {
    const f = responses(true, true); vi.mocked(businessScenariosApi.run).mockResolvedValue(f.run); const app = await mount();
    try { await select(app.container, "Scenario", f.scenario.id); await text(app.container, "Reproducible run seed", "0"); await click(app.container, "Run this conditional scenario"); expect(businessScenariosApi.run).toHaveBeenCalledWith(f.companyId, f.scenario.id, { expectedRevision: 2, versionId: f.version.id, seed: 0 }, f.userId); expect(businessScenariosApi.publish).not.toHaveBeenCalled(); } finally { await app.cleanup(); }
  });
  it("shows historical conditional math while refusing publication/run of stale source pins", async () => {
    const f = scenarioFixture(true); vi.mocked(businessScenariosApi.detail).mockResolvedValue({ scenario: f.scenario, versions: [{ ...f.version, currentQualification: "needs_revalidation" }] }); vi.mocked(businessScenariosApi.result).mockResolvedValue({ ...f.run, currentQualification: "needs_revalidation" }); const app = await mount();
    try { await select(app.container, "Scenario", f.scenario.id); await select(app.container, "Retained scenario run", f.run.id); await text(app.container, "Human scenario review rationale", "Human review cannot upgrade a corrected historical source pin"); expect([...app.container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Publish this scenario version")!.disabled).toBe(true); expect([...app.container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Run this conditional scenario")!.disabled).toBe(true); expect(app.container.textContent).toContain("Retained arithmetic is historical"); expect(app.container.textContent).toContain("Declared ranges have not been propagated"); } finally { await app.cleanup(); }
  });
  it("hides retained facts while current result authority is pending or denied", async () => {
    const f = scenarioFixture(); const app = await mount(); try { await select(app.container, "Scenario", f.scenario.id); await select(app.container, "Retained scenario run", f.run.id); expect(app.container.textContent).toContain("Conditional scenario comparison"); let reject!: (error: Error) => void; vi.mocked(businessScenariosApi.result).mockImplementation(() => new Promise((_resolve, denied) => { reject = denied; })); let pending!: Promise<unknown>; await act(async () => { pending = app.client.refetchQueries({ queryKey: ["business-scenarios", f.companyId, f.userId, "run", f.scenario.id, f.run.id] }); }); await flush(); expect(app.container.textContent).not.toContain("Conditional scenario comparison"); await act(async () => { reject(new Error("Current source access denied")); await pending; }); await flush(); expect(app.container.textContent).not.toContain("Conditional scenario comparison"); expect(app.container.textContent).toContain("Current source access denied"); } finally { await app.cleanup(); }
  });
  it("clears unsaved private proposals on native Memory events and account changes", async () => {
    const f = scenarioFixture(); const app = await mount(); try { await select(app.container, "Scenario", f.scenario.id); await click(app.container, "Propose a scenario revision"); await text(app.container, "Scenario objective", "Unsaved private scenario question for this account"); await act(async () => window.dispatchEvent(new Event("memory-access-changed"))); await flush(); expect(app.container.querySelector('form[aria-label="Scenario definition proposal"]')).toBeNull(); vi.mocked(businessScenariosApi.list).mockResolvedValue({ items: [], nextCursor: null, coverage: "bounded_current_authorized_page" }); identity.userId = "other-account"; await app.render(); expect(app.container.textContent).not.toContain(f.version.definition.name); expect(businessScenariosApi.list).toHaveBeenLastCalledWith(f.companyId, undefined, "other-account"); } finally { await app.cleanup(); }
  });
});
