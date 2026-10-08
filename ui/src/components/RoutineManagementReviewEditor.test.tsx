// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoutineManagementReviewEditor } from "./RoutineManagementReviewEditor";
import { routinesApi } from "@/api/routines";
import { managementReviewsApi } from "@/api/management-reviews";
import { aiGovernanceApi } from "@/api/ai-governance";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { routineReviewFixture } from "../../storybook/stories/management-review-fixtures";
const identity = vi.hoisted(() => ({ userId: "", settled: true, failed: false }));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => identity }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: null }) }));
vi.mock("@/api/routines", () => ({ routinesApi: { update: vi.fn() } }));
vi.mock("@/api/management-reviews", () => ({ managementReviewsApi: { sourceOptions: vi.fn(), create: vi.fn(), publish: vi.fn() } }));
vi.mock("@/api/ai-governance", () => ({ aiGovernanceApi: { obligations: vi.fn() } }));
vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: { getExperimental: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); };
async function mount(template = false, workflow = true) {
  const f = routineReviewFixture(), routine = { ...f.routine, managementReviewTemplate: template ? f.template : null, executionTargetKind: workflow ? "workflow" as const : "agent_task" as const }, client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }), container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const render = async () => { await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><RoutineManagementReviewEditor routine={routine} /></QueryClientProvider></MemoryRouter>)); await flush(); await flush(); }; await render();
  return { f, client, container, render, cleanup: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); } };
}
const button = (node: HTMLElement, label: string) => [...node.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)!;
async function click(node: HTMLElement, label: string) { for (let i = 0; i < 20 && (!button(node, label) || button(node, label).disabled); i++) await flush(); expect(button(node, label), label).toBeDefined(); expect(button(node, label).disabled).toBe(false); await act(async () => button(node, label).click()); await flush(); }
async function field(node: HTMLElement, label: string, value: string) { await act(async () => { const input = node.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!; expect(input, label).toBeDefined(); if (input instanceof HTMLSelectElement) { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); } else { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); } }); await flush(); }
async function metric(node: HTMLElement) { const f = routineReviewFixture(); await field(node, "Source 1 canonical source kind", "metric"); await field(node, "Source 1 canonical native source", JSON.stringify(f.metricSource.reference)); }
beforeEach(() => {
  vi.resetAllMocks(); const f = routineReviewFixture(); identity.userId = f.userId; identity.settled = true; identity.failed = false;
  vi.mocked(instanceSettingsApi.getExperimental).mockResolvedValue(f.flags); vi.mocked(aiGovernanceApi.obligations).mockResolvedValue([f.policy]); vi.mocked(routinesApi.update).mockResolvedValue(f.routine);
  vi.mocked(managementReviewsApi.sourceOptions).mockImplementation(async (_company, query) => ({ items: [{ source: query.kind === "metric" ? f.metricSource : f.definition.sources[0].source, title: query.kind === "metric" ? "Current native metric" : f.goal.title }], coverage: "bounded_authorized_native_choices" }));
});
describe("Human native Routine review configuration", () => {
  it("saves only a strict fresh selector template to the current native revision and account", async () => {
    const app = await mount(); try {
      await click(app.container, "Configure recurring review drafts"); await field(app.container, "Review name", "Human recurring review"); await field(app.container, "Review type", "weekly_leadership"); await metric(app.container); await field(app.container, "Approved review purpose", app.f.policy.id); await field(app.container, "Agenda 1 proposed next action", "Human checks the fresh cited metric before proposing a canonical change");
      expect(app.container.querySelector('[type="datetime-local"]')).toBeNull(); const types = [...app.container.querySelectorAll<HTMLOptionElement>('[aria-label="Source 1 canonical source kind"] option')].map(item => item.value); expect(types).not.toContain("metric_observation"); expect(types).not.toContain("foundation_section");
      await click(app.container, "Save Routine review template"); expect(routinesApi.update).toHaveBeenCalledWith(app.f.routine.id, { baseRevisionId: app.f.routine.latestRevisionId, managementReviewTemplate: expect.objectContaining({ periodDays: 7, sources: [{ key: "source_1", selector: { kind: "metric_query", metricId: app.f.metricId, offsetDays: 0, dimensions: [], maxRows: 5000 } }], agenda: [expect.objectContaining({ ownerUserId: app.f.userId, dueAfterDays: 1, sourceKeys: ["source_1"] })] }) }, app.f.userId);
      expect(managementReviewsApi.create).not.toHaveBeenCalled(); expect(managementReviewsApi.publish).not.toHaveBeenCalled();
    } finally { await app.cleanup(); }
  });
  it("requires a current metric selection when editing and preserves relative window and deadline declarations", async () => {
    const app = await mount(true); try { await click(app.container, "Edit recurring review template"); expect(button(app.container, "Save Routine review template").disabled).toBe(true); await metric(app.container); await field(app.container, "Source 1 metric window offset (days)", "7"); await field(app.container, "Agenda 1 due after capture (days)", "2"); await click(app.container, "Save Routine review template"); expect(vi.mocked(routinesApi.update).mock.calls[0]![1]).toMatchObject({ managementReviewTemplate: { sources: [{ key: "source_1", selector: { offsetDays: 7 } }], agenda: [{ dueAfterDays: 2 }] } }); } finally { await app.cleanup(); }
  });
  it("removes private Human drafts and Source caches when access is withdrawn", async () => {
    const app = await mount(true); try { await click(app.container, "Edit recurring review template"); await field(app.container, "Agenda 1 human hypothesis", "Private recurring hypothesis must disappear after access loss"); app.client.setQueryData(["decision-evidence", app.f.companyId, app.f.userId, "private"], { text: "private source" }); await act(async () => window.dispatchEvent(new Event("memory-access-changed"))); await flush(); expect(app.container.querySelector('[aria-label="Routine review template"]')).toBeNull(); expect(app.container.textContent).not.toContain("Private recurring hypothesis"); expect(app.client.getQueriesData({ queryKey: ["decision-evidence", app.f.companyId, app.f.userId] })).toHaveLength(0); expect(routinesApi.update).not.toHaveBeenCalled(); } finally { await app.cleanup(); }
  });
  it("unmounts the previous account form and refuses to configure an Agent execution target", async () => {
    const app = await mount(true); try { await click(app.container, "Edit recurring review template"); await field(app.container, "Agenda 1 human hypothesis", "Previous account private recurring hypothesis"); identity.userId = "another-current-human"; await app.render(); expect(app.container.querySelector('[aria-label="Routine review template"]')).toBeNull(); expect(app.container.textContent).not.toContain("Previous account"); } finally { await app.cleanup(); }
    const agent = await mount(false, false); try { expect(button(agent.container, "Configure recurring review drafts").disabled).toBe(true); expect(agent.container.querySelector('[aria-label="Routine review template"]')).toBeNull(); expect(routinesApi.update).not.toHaveBeenCalled(); } finally { await agent.cleanup(); }
  });
  it("removes drafting through an explicit current-revision command without changing its scheduler", async () => { const app = await mount(true); try { await click(app.container, "Remove recurring review template"); expect(routinesApi.update).toHaveBeenCalledWith(app.f.routine.id, { baseRevisionId: app.f.routine.latestRevisionId, managementReviewTemplate: null }, app.f.userId); } finally { await app.cleanup(); } });
  it("withholds the current form when the original Source menu loses admission", async () => {
    const app = await mount(true); try { await click(app.container, "Edit recurring review template"); await metric(app.container); vi.mocked(managementReviewsApi.sourceOptions).mockRejectedValue(new Error("Current native Source permission denied")); await act(async () => { await app.client.invalidateQueries({ queryKey: ["management-definition-sources", app.f.companyId, app.f.userId, "options"] }); }); await flush(); expect(app.container.querySelector('[aria-label="Routine review template"]')).toBeNull(); expect(routinesApi.update).not.toHaveBeenCalled(); } finally { await app.cleanup(); }
  });
  it("removes a rejected current-revision command's form and cached Source contents", async () => {
    const app = await mount(true); try { await click(app.container, "Edit recurring review template"); await metric(app.container); app.client.setQueryData(["decision-evidence", app.f.companyId, app.f.userId, "private"], { text: "private" }); vi.mocked(routinesApi.update).mockRejectedValue(new Error("Account or native revision changed; reload")); await click(app.container, "Save Routine review template"); expect(app.container.querySelector('[aria-label="Routine review template"]')).toBeNull(); expect(app.client.getQueriesData({ queryKey: ["decision-evidence", app.f.companyId, app.f.userId] })).toHaveLength(0); expect(app.container.textContent).toContain("Account or native revision changed"); } finally { await app.cleanup(); }
  });
  it("reads no Source choices under an unsettled account", async () => { identity.settled = false; const app = await mount(true); try { expect(managementReviewsApi.sourceOptions).not.toHaveBeenCalled(); expect(aiGovernanceApi.obligations).not.toHaveBeenCalled(); expect(app.container.querySelector('[aria-label="Routine review template"]')).toBeNull(); expect(routinesApi.update).not.toHaveBeenCalled(); } finally { await app.cleanup(); } });

});
