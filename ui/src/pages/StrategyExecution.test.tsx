// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { strategyExecutionLinkDefinitionSchema, type StrategyExecutionLinkDetail, type StrategyExecutionLinkList } from "@paperclipai/shared";
import { StrategyExecution } from "./StrategyExecution";
import { strategyExecutionApi } from "@/api/strategy-execution";
const fixture = vi.hoisted(() => ({ companyId: "00000000-0000-4000-8000-000000000001", userId: "account-one", settled: true, failed: false, breadcrumbs: vi.fn() }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: fixture.companyId }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: fixture.breadcrumbs }) }));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => ({ userId: fixture.userId, settled: fixture.settled, failed: fixture.failed }) }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("@/components/StrategySourceReference", () => ({ StrategySourceReference: () => <span>Native source reference</span> }));
vi.mock("@/api/strategy-execution", () => ({ strategyExecutionApi: { list: vi.fn(), detail: vi.fn(), create: vi.fn(), revise: vi.fn(), approve: vi.fn(), retire: vi.fn() } }));
vi.mock("@/api/goals", () => ({ goalsApi: { list: vi.fn(async () => [{ id: "00000000-0000-4000-8000-000000000002", companyId: fixture.companyId, title: "Improve delivery" }]) } }));
vi.mock("@/api/projects", () => ({ projectsApi: { list: vi.fn(async () => [{ id: "00000000-0000-4000-8000-000000000003", companyId: fixture.companyId, name: "Evidence review" }]) } }));
vi.mock("@/api/ai-governance", () => ({ aiGovernanceApi: { obligations: vi.fn(async () => [{ id: "00000000-0000-4000-8000-000000000004", obligation: { framework: "company_policy", citation: "Approved strategy use", analyticalPurpose: { status: "approved", capabilities: ["strategy"] } } }]) } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function detail(status: "proposed" | "active" | "needs_review" = "active", expiresAt = "2099-01-01T00:00:00Z"): StrategyExecutionLinkDetail {
  const definition = strategyExecutionLinkDefinitionSchema.parse({ from: { type: "goal", id: id(2) }, to: { type: "project", id: id(3) }, relationship: "supports", rationale: "Private reviewed rationale from the current account", contribution: null, ownerUserId: fixture.userId, reviewFrequencyDays: 30, retentionDays: 30, sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [id(4)] });
  const version = { id: id(6), companyId: fixture.companyId, linkId: id(5), revision: 1, definition, contentHash: "a".repeat(64), createdAt: "2026-10-06T00:00:00Z", nextReviewAt: "2098-01-01T00:00:00Z", expiresAt };
  return { link: { id: id(5), companyId: fixture.companyId, revision: status === "proposed" ? 1 : 2, status, approvedVersionId: status === "proposed" ? null : id(6), createdAt: version.createdAt, updatedAt: version.createdAt }, effectiveVersion: version, versions: [version], hasMoreVersions: false, reviewReason: status === "needs_review" ? "Approved Foundation strategy changed" : null };
}
function page(value: StrategyExecutionLinkDetail | null): StrategyExecutionLinkList { return { items: value ? [{ ...value.link, definition: value.effectiveVersion.definition, reviewReason: value.reviewReason, nextReviewAt: value.effectiveVersion.nextReviewAt, expiresAt: value.effectiveVersion.expiresAt }] : [], nextCursor: null, coverage: "bounded_current_authorized_page" }; }
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve,30)); }); };
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const render = async () => { await act(async () => root.render(<QueryClientProvider client={client}><StrategyExecution /></QueryClientProvider>)); await flush(); };
  await render();
  return { container, render, cleanup: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); } };
}
async function click(container: HTMLElement, label: string) { await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click()); await flush(); }
async function select(container: HTMLElement, label: string, value: string) { await act(async () => { const element = container.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement; element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); }); await flush(); }
async function text(element: HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(element,value); element.dispatchEvent(new Event("input", { bubbles: true })); }); await flush(); }
beforeEach(() => {
  vi.clearAllMocks(); fixture.companyId = id(1); fixture.userId = "account-one"; fixture.settled = true; fixture.failed = false;
  vi.mocked(strategyExecutionApi.list).mockResolvedValue(page(null)); vi.mocked(strategyExecutionApi.detail).mockResolvedValue(detail());
});
describe("strategy operator authority and human approval", () => {
  it("saves an explicit proposal and requires a separate human review before approval", async () => {
    const proposed = detail("proposed");
    vi.mocked(strategyExecutionApi.create).mockImplementation(async (_companyId,input) => {
      proposed.effectiveVersion.definition = input.definition; proposed.versions[0].definition = input.definition;
      vi.mocked(strategyExecutionApi.list).mockResolvedValue(page(proposed)); vi.mocked(strategyExecutionApi.detail).mockResolvedValue(proposed);
      return { link: proposed.link, version: proposed.effectiveVersion };
    });
    vi.mocked(strategyExecutionApi.approve).mockResolvedValue({ ...proposed.link, status: "active", revision: 2, approvedVersionId: id(6) });
    const app = await mount();
    try {
      await click(app.container,"Propose a relationship");
      await select(app.container,"From native source",JSON.stringify({ type: "goal", id: id(2) }));
      await select(app.container,"To source kind","project");
      await select(app.container,"To native source",JSON.stringify({ type: "project", id: id(3) }));
      await text(app.container.querySelector('form textarea')!,"A reviewed rationale connecting existing native work");
      await select(app.container,"Approved strategy purpose",id(4));
      await click(app.container,"Save proposal");
      expect(strategyExecutionApi.create).toHaveBeenCalledWith(id(1), { definition: expect.objectContaining({ from: { type: "goal", id: id(2) }, to: { type: "project", id: id(3) }, governanceObligationRefs: [id(4)], ownerUserId: "account-one" }) }, "account-one");
      expect(strategyExecutionApi.approve).not.toHaveBeenCalled();
      const button = [...app.container.querySelectorAll("button")].find(button => button.textContent === "Approve selected version")!;
      expect(button.disabled).toBe(true);
      await text(app.container.querySelector('[aria-label="Human strategy review rationale"]')!,"Human review accepts the pinned relationship");
      await click(app.container,"Approve selected version");
      expect(strategyExecutionApi.approve).toHaveBeenCalledWith(id(1),id(5), { expectedRevision: 1, versionId: id(6), rationale: "Human review accepts the pinned relationship" },"account-one");
    } finally { await app.cleanup(); }
  });
  it("does not expose a late old-account detail after the company and account change", async () => {
    const previous = detail(); vi.mocked(strategyExecutionApi.list).mockImplementation(async companyId => page(companyId === id(1) ? previous : null));
    let resolve!: (value: StrategyExecutionLinkDetail) => void;
    vi.mocked(strategyExecutionApi.detail).mockImplementation(() => new Promise(r => { resolve = r; }));
    const app = await mount();
    try {
      await click(app.container,"Inspect relationship"); fixture.companyId = id(8); fixture.userId = "account-two"; await app.render();
      await act(async () => resolve(previous)); await flush();
      expect(app.container.textContent).not.toContain(previous.effectiveVersion.definition.rationale);
      expect(app.container.querySelector('[aria-label="Inspect strategic relationship"]')).toBeNull();
      expect(strategyExecutionApi.approve).not.toHaveBeenCalled();
    } finally { await app.cleanup(); }
  });
  it("hides retained cached rationale when current list admission fails", async () => {
    const value = detail(); vi.mocked(strategyExecutionApi.list).mockResolvedValue(page(value)); const app = await mount();
    try {
      expect(app.container.textContent).toContain(value.effectiveVersion.definition.rationale);
      vi.mocked(strategyExecutionApi.list).mockRejectedValue(new Error("Current account authority was withdrawn"));
      await click(app.container,"Refresh relationships");
      expect(app.container.textContent).not.toContain(value.effectiveVersion.definition.rationale);
      expect(app.container.querySelector('[role="alert"]')?.textContent).toContain("authority was withdrawn");
    } finally { await app.cleanup(); }
  });
  it("masks a retained relationship when its browser-visible retention expires", async () => {
    const value = detail("active",new Date(Date.now()+600).toISOString()); vi.mocked(strategyExecutionApi.list).mockResolvedValue(page(value)); const app = await mount();
    try { expect(app.container.textContent).toContain(value.effectiveVersion.definition.rationale); await act(async () => { await new Promise(resolve => setTimeout(resolve,650)); }); expect(app.container.textContent).not.toContain(value.effectiveVersion.definition.rationale); }
    finally { await app.cleanup(); }
  });
  it("holds native reads until current account verification succeeds", async () => {
    fixture.failed = true; fixture.settled = false; const app = await mount();
    try { expect(app.container.textContent).toContain("account could not be verified"); expect(strategyExecutionApi.list).not.toHaveBeenCalled(); }
    finally { await app.cleanup(); }
  });
});
