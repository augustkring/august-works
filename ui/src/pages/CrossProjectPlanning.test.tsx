// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { instanceExperimentalSettingsSchema } from "@paperclipai/shared";
import { CrossProjectPlanning } from "./CrossProjectPlanning";
import { crossProjectPlanningApi } from "@/api/cross-project-planning";
import { adaptivePlanningApi } from "@/api/adaptive-planning";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { aiGovernanceApi } from "@/api/ai-governance";
import { initiativePlanningFixture } from "../../storybook/stories/initiative-planning-fixtures";
import { jointPlanningFixture } from "../../storybook/stories/cross-project-planning-fixtures";
const identity = vi.hoisted(() => ({ userId: "human", settled: true, failed: false }));
const company = vi.hoisted(() => ({ selectedCompanyId: "company" }));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => identity }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => company }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: () => {} }) }));
vi.mock("@/api/cross-project-planning", () => ({ crossProjectPlanningApi: { sourceOptions: vi.fn(), preview: vi.fn(), previewInitiatives: vi.fn(), proposeInitiatives: vi.fn(), initiativeControls: vi.fn(), initiativeDetail: vi.fn(), reviewInitiatives: vi.fn(), propose: vi.fn(), controls: vi.fn(), detail: vi.fn(), review: vi.fn() } }));
vi.mock("@/api/adaptive-planning", () => ({ adaptivePlanningApi: { source: vi.fn() } }));
vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: { getExperimental: vi.fn() } }));
vi.mock("@/api/ai-governance", () => ({ aiGovernanceApi: { obligations: vi.fn() } }));
vi.mock("@/lib/router", () => ({ Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => <a href={to} {...props}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };
async function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }), container = document.createElement("div"); document.body.append(container); const root = createRoot(container), render = async () => { await act(async () => root.render(<QueryClientProvider client={client}><CrossProjectPlanning /></QueryClientProvider>)); await flush(); }; await render(); return { client, container, render, cleanup: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); } }; }
const button = (node: HTMLElement, label: string) => [...node.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)!;
async function click(node: HTMLElement, label: string) { for (let i = 0; i < 25 && (!button(node, label) || button(node, label).disabled); i++) await flush(); expect(button(node, label), label).toBeDefined(); expect(button(node, label).disabled, label).toBe(false); await act(async () => button(node, label).click()); await flush(); }
async function field(node: HTMLElement, label: string, value: string) { await act(async () => { const input = node.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!; expect(input, label).toBeDefined(); if (input instanceof HTMLSelectElement) { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); } else { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); } }); await flush(); }
async function declarations(node: HTMLElement) { const f = jointPlanningFixture(); await act(async () => { for (const input of node.querySelectorAll<HTMLInputElement>('[aria-label="Native joint planning project choices"] input[type="checkbox"]')) input.click(); }); await flush(); await click(node, "Declare shared project constraints"); for (const source of f.sources) { const title = `${source.projectName} · ${source.tasks[0].title}`; await field(node, `Demand for ${title}`, "120"); await field(node, `Declaration rationale for ${title}`, "Human explicitly supplies joint native assumptions and uncertainty"); } await field(node, "Approved planning purpose", f.policy.id); }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(crossProjectPlanningApi.initiativeControls).mockResolvedValue({ items: [], nextCursor: null, coverage: "bounded_native_initiative_proposal_metadata" }); const f = jointPlanningFixture(); identity.userId = f.userId; identity.settled = true; identity.failed = false; company.selectedCompanyId = f.companyId; vi.mocked(instanceSettingsApi.getExperimental).mockResolvedValue(f.flags); vi.mocked(aiGovernanceApi.obligations).mockResolvedValue([f.policy]); vi.mocked(crossProjectPlanningApi.sourceOptions).mockResolvedValue(f.options); vi.mocked(adaptivePlanningApi.source).mockImplementation(async (_company, project) => f.sources.find(source => source.projectId === project)!); vi.mocked(crossProjectPlanningApi.controls).mockResolvedValue(f.controls); vi.mocked(crossProjectPlanningApi.detail).mockResolvedValue(f.detail); vi.mocked(crossProjectPlanningApi.preview).mockResolvedValue(f.response); vi.mocked(crossProjectPlanningApi.propose).mockResolvedValue(f.detail); vi.mocked(crossProjectPlanningApi.review).mockResolvedValue({ id: f.id, companyId: f.companyId, status: "under_review", revision: 2, appliedRoadmapRefs: [] }); });
describe("Native joint planning operator admission", () => {
  it("preserves unknown Human initiative dimensions and costs and removes advisory facts on amendment", async () => {
    const f = jointPlanningFixture();
    vi.mocked(crossProjectPlanningApi.previewInitiatives).mockResolvedValue({ snapshotHash: "3".repeat(64), capturedAt: f.detail.context.capturedAt, expiresAt: f.response.expiresAt, authority: "human_initiative_review_required", currentSources: { projects: [], budgets: [] }, result: { provider: { key: "aw_native_constraints", version: "1" }, optimality: "not_proven", candidates: f.sources.map(source => ({ projectId: source.projectId, disposition: "investigate", reasons: ["unknown_declared_dimension_or_cost"] })), selectedProjectIds: [], schedule: null, resultHash: "4".repeat(64), authority: "human_initiative_review_required", limitations: ["Explicit software presentation fixture"] } });
    const app = await mount();
    try {
      await declarations(app.container); await click(app.container, "Inspect constraints and proposed schedule");
      for (const source of f.sources) await field(app.container, `Initiative rationale for ${source.projectName}`, "Human retains unknown initiative dimensions and costs");
      await click(app.container, "Inspect initiative priorities");
      const profile = vi.mocked(crossProjectPlanningApi.previewInitiatives).mock.calls[0][1];
      expect(profile.tasks).toEqual(vi.mocked(crossProjectPlanningApi.preview).mock.calls[0][1].tasks);
      expect(profile.initiatives.every(item => item.estimatedBilledCostCents === null && Object.values(item.dimensions).every(value => value === null))).toBe(true);
      expect(crossProjectPlanningApi.previewInitiatives).toHaveBeenCalledWith(f.companyId, profile, f.userId);
      expect(app.container.querySelector('[aria-label="Advisory initiative priority result"]')).not.toBeNull();
      expect(crossProjectPlanningApi.propose).not.toHaveBeenCalled(); expect(crossProjectPlanningApi.review).not.toHaveBeenCalled();
      await field(app.container, `Strategic alignment for ${f.sources[0].projectName}`, "9");
      expect(app.container.querySelector('[aria-label="Advisory initiative priority result"]')).toBeNull();
    } finally { await app.cleanup(); }
  });
  it("removes pending initiative declarations on Memory withdrawal and refuses a denied preview", async () => {
    const f = jointPlanningFixture(), app = await mount();
    try {
      await declarations(app.container); await click(app.container, "Inspect constraints and proposed schedule");
      for (const source of f.sources) await field(app.container, `Initiative rationale for ${source.projectName}`, "Human private initiative assumptions and uncertainty");
      vi.mocked(crossProjectPlanningApi.previewInitiatives).mockRejectedValue(new Error("Current Goal source denied"));
      await click(app.container, "Inspect initiative priorities");
      expect(app.container.querySelector('[aria-label="Declared initiative prioritization"]')).toBeNull();
      expect(app.container.textContent).not.toContain("Human private initiative assumptions");
      expect(crossProjectPlanningApi.propose).not.toHaveBeenCalled();
      await act(async () => window.dispatchEvent(new Event("memory-access-changed")));
      expect(app.client.getQueriesData({ queryKey: ["cross-project-planning", f.companyId, f.userId, "source"] })).toHaveLength(0);
    } finally { await app.cleanup(); }
  });
  it("uses complete original Roadmap populations and preserves unknown durations and shared capacity", async () => { const f = jointPlanningFixture(); vi.mocked(crossProjectPlanningApi.preview).mockResolvedValue({ ...f.response, result: { ...f.result, status: "inconclusive", schedule: [], criticalPath: null, diagnostics: [{ code: "unknown_duration", taskKeys: [f.taskId], poolKeys: [] }] } }); const app = await mount(); try { await declarations(app.container); await click(app.container, "Inspect constraints and proposed schedule"); const profile = vi.mocked(crossProjectPlanningApi.preview).mock.calls[0][1]; expect(profile.projects).toEqual(f.profile.projects); expect(profile.tasks).toHaveLength(2); expect(profile.tasks.every(task => task.durationDays === null)).toBe(true); expect(profile.pools[0].days.every(day => day.availableMinutes === null && day.committedMinutes === null)).toBe(true); expect(crossProjectPlanningApi.preview).toHaveBeenCalledWith(f.companyId, profile, f.userId); expect(crossProjectPlanningApi.propose).not.toHaveBeenCalled(); expect(crossProjectPlanningApi.review).not.toHaveBeenCalled(); } finally { await app.cleanup(); } });
  it("invalidates a joint preview on Human amendment and proposes only the exact inspected profile", async () => { const f = jointPlanningFixture(), app = await mount(); try { await declarations(app.container); await click(app.container, "Inspect constraints and proposed schedule"); await field(app.container, "Duration for First project · Prepare source evidence", "3"); expect(app.container.querySelector('[aria-label="Declared planning constraint result"]')).toBeNull(); await click(app.container, "Inspect constraints and proposed schedule"); await field(app.container, "Joint planning proposal reason", "Human proposes this exact joint profile for independent review"); await click(app.container, "Create joint planning proposal"); const profile = vi.mocked(crossProjectPlanningApi.preview).mock.calls.at(-1)![1]; expect(crossProjectPlanningApi.propose).toHaveBeenCalledWith(f.companyId, profile, f.response.snapshotHash, expect.any(String), f.userId); expect(crossProjectPlanningApi.review).not.toHaveBeenCalled(); } finally { await app.cleanup(); } });
  it("requires separate exact acknowledgement to begin review and keeps acceptance as another native command", async () => { const f = jointPlanningFixture(), app = await mount(); try { await field(app.container, "Joint proposal reference", f.id); await field(app.container, "Joint planning review rationale", "Human independently reviews the complete Source and joint dates"); expect(button(app.container, "Begin separate joint review").disabled).toBe(true); await act(async () => app.container.querySelector<HTMLInputElement>('[aria-label="Separate Human joint review"] input[type="checkbox"]')!.click()); await click(app.container, "Begin separate joint review"); expect(crossProjectPlanningApi.review).toHaveBeenCalledWith(f.companyId, f.id, 1, "begin_review", expect.any(String), f.userId); expect(vi.mocked(crossProjectPlanningApi.review).mock.calls.some(call => call[3] === "accept")).toBe(false); } finally { await app.cleanup(); } });
  it("retains original stale facts while withholding joint application", async () => { const f = jointPlanningFixture(true); vi.mocked(crossProjectPlanningApi.detail).mockResolvedValue(f.detail); const app = await mount(); try { await field(app.container, "Joint proposal reference", f.id); expect(app.container.textContent).toContain("Retained feasible calculation"); expect(app.container.textContent).toContain("2099-10-12"); expect(button(app.container, "Begin separate joint review").disabled).toBe(true); } finally { await app.cleanup(); } });
  it("permits metadata-only cancellation with rollout disabled without reading any Source", async () => { const f = jointPlanningFixture(); vi.mocked(instanceSettingsApi.getExperimental).mockResolvedValue(instanceExperimentalSettingsSchema.parse({})); const app = await mount(); try { await field(app.container, "Joint proposal reference", f.id); await field(app.container, "Joint planning review rationale", "Human cancels this proposal while the feature is disabled"); await click(app.container, "Cancel joint proposal"); expect(crossProjectPlanningApi.review).toHaveBeenCalledWith(f.companyId, f.id, 1, "cancel", expect.any(String), f.userId); expect(crossProjectPlanningApi.detail).not.toHaveBeenCalled(); expect(crossProjectPlanningApi.sourceOptions).not.toHaveBeenCalled(); expect(adaptivePlanningApi.source).not.toHaveBeenCalled(); } finally { await app.cleanup(); } });
  it("removes private joint declarations and evidence caches on Memory access withdrawal", async () => { const f = jointPlanningFixture(), app = await mount(); try { await declarations(app.container); await field(app.container, "Declaration rationale for First project · Prepare source evidence", "Private joint rationale must disappear after Source withdrawal"); app.client.setQueryData(["decision-evidence", f.companyId, f.userId, "private"], { text: "private" }); await act(async () => window.dispatchEvent(new Event("memory-access-changed"))); await flush(); expect(app.container.querySelector('[aria-label="Declared project planning assumptions"]')).toBeNull(); expect(app.container.textContent).not.toContain("First project"); expect(app.client.getQueriesData({ queryKey: ["decision-evidence", f.companyId, f.userId] })).toHaveLength(0); } finally { await app.cleanup(); } });
  it("withholds the old account proposal on verified account changes and denied Source rechecks", async () => { const f = jointPlanningFixture(), app = await mount(); try { await field(app.container, "Joint proposal reference", f.id); identity.userId = "different-human"; vi.mocked(crossProjectPlanningApi.controls).mockRejectedValue(new Error("Current account denied")); vi.mocked(crossProjectPlanningApi.sourceOptions).mockRejectedValue(new Error("Current account denied")); await app.render(); await flush(); expect(app.client.getQueriesData({ queryKey: ["cross-project-planning", f.companyId, f.userId, "detail"] })).toHaveLength(0); expect(app.container.textContent).not.toContain(f.detail.reason); expect(app.container.querySelector('[aria-label="Declared planning constraint result"]')).toBeNull(); } finally { await app.cleanup(); } });
  it("withholds retained facts while their current Source request is denied", async () => { const f = jointPlanningFixture(), app = await mount(); try { await field(app.container, "Joint proposal reference", f.id); expect(app.container.textContent).toContain(f.detail.reason); vi.mocked(crossProjectPlanningApi.detail).mockRejectedValue(new Error("Source permission withdrawn")); await act(async () => { await app.client.invalidateQueries({ queryKey: ["cross-project-planning", f.companyId, f.userId, "detail"] }); }); await flush(); expect(app.container.textContent).not.toContain(f.detail.reason); expect(app.container.querySelector('[aria-label="Declared planning constraint result"]')).toBeNull(); expect(crossProjectPlanningApi.review).not.toHaveBeenCalled(); } finally { await app.cleanup(); } });

  it("proposes only the exact inspected initiative profile and leaves approval as a separate command", async () => {
    const f = initiativePlanningFixture();
    vi.mocked(crossProjectPlanningApi.previewInitiatives).mockResolvedValue(f.response);
    vi.mocked(crossProjectPlanningApi.proposeInitiatives).mockResolvedValue(f.detail);
    vi.mocked(crossProjectPlanningApi.initiativeControls).mockResolvedValue(f.controls);
    vi.mocked(crossProjectPlanningApi.initiativeDetail).mockResolvedValue(f.detail);
    const app = await mount();
    try {
      await declarations(app.container); await click(app.container, "Inspect constraints and proposed schedule");
      for (const source of f.sources) { await field(app.container, `Strategic alignment for ${source.projectName}`, "8"); await field(app.container, `Estimated billed runtime cost in cents for ${source.projectName}`, "40"); await field(app.container, `Initiative rationale for ${source.projectName}`, "Human explicitly declares uncertain initiative assumptions"); }
      await click(app.container, "Inspect initiative priorities");
      await field(app.container, "Initiative proposal reason", "Human proposes these exact initiative inputs for independent review");
      await click(app.container, "Create initiative proposal");
      expect(crossProjectPlanningApi.proposeInitiatives).toHaveBeenCalledWith(f.companyId, vi.mocked(crossProjectPlanningApi.previewInitiatives).mock.calls[0][1], f.response.snapshotHash, expect.any(String), f.userId);
      expect(crossProjectPlanningApi.reviewInitiatives).not.toHaveBeenCalled();
      expect(crossProjectPlanningApi.propose).not.toHaveBeenCalled();
      expect(app.container.querySelector('[aria-label="Declared initiative prioritization"]')).toBeNull();
    } finally { await app.cleanup(); }
  });
  it("loads original names on reopen and requires a new acknowledgement after beginning separate initiative review", async () => {
    const f = initiativePlanningFixture();
    vi.mocked(crossProjectPlanningApi.initiativeControls).mockResolvedValue(f.controls);
    vi.mocked(crossProjectPlanningApi.initiativeDetail).mockResolvedValue(f.detail);
    vi.mocked(crossProjectPlanningApi.reviewInitiatives).mockImplementation(async (_company, _id, _revision, action) => {
      f.detail.status = action === "begin_review" ? "under_review" : "accepted"; f.detail.revision++;
      f.controls.items[0] = { id: f.id, status: f.detail.status, revision: f.detail.revision };
      return { id: f.id, companyId: f.companyId, status: f.detail.status, revision: f.detail.revision, appliedProjectRefs: [] };
    });
    const app = await mount();
    try {
      await field(app.container, "Initiative proposal reference", f.id); await flush();
      expect(app.container.querySelector('[aria-label="Advisory initiative priority result"]')!.textContent).toContain("First project · start");
      expect(app.container.textContent).toContain("Mandatory commitments considered first");
      expect(app.container.textContent).toContain("strategic alignment (maximize)");
      await field(app.container, "Initiative review rationale", "Human independently reviews exact initiative sources and changes");
      expect(button(app.container, "Begin separate initiative review").disabled).toBe(true);
      await act(async () => app.container.querySelector<HTMLInputElement>('[aria-label="Separate Human initiative review"] input')!.click());
      await click(app.container, "Begin separate initiative review");
      expect(crossProjectPlanningApi.reviewInitiatives).toHaveBeenLastCalledWith(f.companyId, f.id, 1, "begin_review", expect.any(String), f.userId);
      await field(app.container, "Initiative proposal reference", f.id);
      await field(app.container, "Initiative review rationale", "Human explicitly approves the exact reviewed native project changes");
      expect(button(app.container, "Approve initiative project changes").disabled).toBe(true);
      await act(async () => app.container.querySelector<HTMLInputElement>('[aria-label="Separate Human initiative review"] input')!.click());
      await click(app.container, "Approve initiative project changes");
      expect(crossProjectPlanningApi.reviewInitiatives).toHaveBeenLastCalledWith(f.companyId, f.id, 2, "accept", expect.any(String), f.userId);
      expect(crossProjectPlanningApi.review).not.toHaveBeenCalled();
    } finally { await app.cleanup(); }
  });
  it("withholds initiative approval when preserved Source facts require revalidation", async () => {
    const f = initiativePlanningFixture(true);
    vi.mocked(crossProjectPlanningApi.initiativeControls).mockResolvedValue(f.controls);
    vi.mocked(crossProjectPlanningApi.initiativeDetail).mockResolvedValue(f.detail);
    const app = await mount();
    try {
      await field(app.container, "Initiative proposal reference", f.id);
      await field(app.container, "Initiative review rationale", "Human reads retained facts while current source has changed");
      await act(async () => app.container.querySelector<HTMLInputElement>('[aria-label="Separate Human initiative review"] input')!.click());
      expect(app.container.textContent).toContain("Retained initiative calculation: current Sources require reinspection");
      expect(button(app.container, "Begin separate initiative review").disabled).toBe(true);
      expect(crossProjectPlanningApi.reviewInitiatives).not.toHaveBeenCalled();
    } finally { await app.cleanup(); }
  });
  it("cancels initiative metadata with rollout disabled without reading proposal or project Sources", async () => {
    const f = initiativePlanningFixture();
    vi.mocked(instanceSettingsApi.getExperimental).mockResolvedValue(instanceExperimentalSettingsSchema.parse({}));
    vi.mocked(crossProjectPlanningApi.initiativeControls).mockResolvedValue(f.controls);
    vi.mocked(crossProjectPlanningApi.reviewInitiatives).mockResolvedValue({ id: f.id, companyId: f.companyId, status: "cancelled", revision: 2, appliedProjectRefs: [] });
    const app = await mount();
    try {
      await field(app.container, "Initiative proposal reference", f.id);
      await field(app.container, "Initiative review rationale", "Human cancels an initiative while rollout is disabled");
      await click(app.container, "Cancel initiative proposal");
      expect(crossProjectPlanningApi.reviewInitiatives).toHaveBeenCalledWith(f.companyId, f.id, 1, "cancel", expect.any(String), f.userId);
      expect(crossProjectPlanningApi.initiativeDetail).not.toHaveBeenCalled();
      expect(adaptivePlanningApi.source).not.toHaveBeenCalled();
      expect(crossProjectPlanningApi.sourceOptions).not.toHaveBeenCalled();
    } finally { await app.cleanup(); }
  });
  it("purges private initiative facts on Memory withdrawal and current-account changes", async () => {
    const f = initiativePlanningFixture();
    vi.mocked(crossProjectPlanningApi.initiativeControls).mockResolvedValue(f.controls);
    vi.mocked(crossProjectPlanningApi.initiativeDetail).mockResolvedValue(f.detail);
    const app = await mount();
    try {
      await field(app.container, "Initiative proposal reference", f.id);
      expect(app.container.textContent).toContain(f.detail.reason);
      await act(async () => window.dispatchEvent(new Event("memory-access-changed"))); await flush();
      expect(app.container.textContent).not.toContain(f.detail.reason);
      expect(app.client.getQueriesData({ queryKey: ["cross-project-planning", f.companyId, f.userId, "initiative-detail"] }).every(([, data]) => data === undefined)).toBe(true);
      await click(app.container, "Refresh joint planning authority"); await field(app.container, "Initiative proposal reference", f.id);
      identity.userId = "different-human"; vi.mocked(crossProjectPlanningApi.initiativeControls).mockRejectedValue(new Error("Current account denied")); await app.render(); await flush();
      expect(app.client.getQueriesData({ queryKey: ["cross-project-planning", f.companyId, f.userId, "initiative-detail"] })).toHaveLength(0);
      expect(app.container.textContent).not.toContain(f.detail.reason);
    } finally { await app.cleanup(); }
  });
  it("removes retained initiative facts when a fresh Source request is denied", async () => {
    const f = initiativePlanningFixture();
    vi.mocked(crossProjectPlanningApi.initiativeControls).mockResolvedValue(f.controls);
    vi.mocked(crossProjectPlanningApi.initiativeDetail).mockResolvedValue(f.detail);
    const app = await mount();
    try {
      await field(app.container, "Initiative proposal reference", f.id);
      vi.mocked(crossProjectPlanningApi.initiativeDetail).mockRejectedValue(new Error("Current Goal authority withdrawn"));
      await act(async () => { await app.client.invalidateQueries({ queryKey: ["cross-project-planning", f.companyId, f.userId, "initiative-detail"] }); }); await flush();
      expect(app.container.textContent).not.toContain(f.detail.reason);
      expect(app.container.querySelector('[aria-label="Advisory initiative priority result"]')).toBeNull();
      expect(crossProjectPlanningApi.reviewInitiatives).not.toHaveBeenCalled();
    } finally { await app.cleanup(); }
  });

  it("keeps the Human review rationale entered during a pending Source recheck but requires a fresh acknowledgement", async () => {
    const f = initiativePlanningFixture();
    vi.mocked(crossProjectPlanningApi.initiativeControls).mockResolvedValue(f.controls);
    let resolve!: (detail: typeof f.detail) => void;
    vi.mocked(crossProjectPlanningApi.initiativeDetail).mockReturnValue(new Promise(done => { resolve = done; }));
    const app = await mount();
    try {
      await field(app.container, "Initiative proposal reference", f.id);
      const text = "Human explicitly reviews the exact assumptions while Source is being rechecked";
      await field(app.container, "Initiative review rationale", text);
      await act(async () => resolve(f.detail)); await flush();
      expect(app.container.querySelector<HTMLTextAreaElement>('[aria-label="Initiative review rationale"]')!.value).toBe(text);
      expect(button(app.container, "Begin separate initiative review").disabled).toBe(true);
      expect(crossProjectPlanningApi.reviewInitiatives).not.toHaveBeenCalled();
    } finally { await app.cleanup(); }
  });

});
