// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { OrchestrationExperience as View } from "@paperclipai/shared";
import { OrchestrationExperience } from "./OrchestrationExperience";
import * as api from "../api/orchestration-experience";
import { authApi } from "../api/auth";
import { i18n } from "../i18n";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { queryKeys } from "../lib/queryKeys";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const account = vi.hoisted(() => ({ principal: "coordinator", company: "10000000-0000-4000-8000-000000000001" }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: account.principal, settled: true, localImplicit: false }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: account.company }) }));
vi.mock("./Orchestration", () => ({ Orchestration: () => <p>Original Native controls</p> }));
let live: (event: { companyId: string; type: string; payload: Record<string, unknown> }) => void;
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (listener: typeof live) => { live = listener; } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const view: View = { companyId: id(1), observedAt: "2026-10-13T19:00:00.000Z", modelCalled: false, coverage: "bounded", hasMore: false,
  canInspect: false, rows: [{ id: id(2), taskId: id(3), taskTitle: "PRIVATE authorized work", taskTitleTruncated: false, version: 1,
    status: "running", owner: { id: id(4), name: "Growth specialist" }, helpers: [], assignmentsUnavailable: false,
    taskHref: `/issues/${id(3)}`, inspection: null }] };
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); account.principal = "coordinator";
  account.company = id(1); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
async function mount(path = "/orchestration") {
  vi.spyOn(authApi, "getSession").mockImplementation(async () => v9SessionFixture(account.principal));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(account.principal));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <OrchestrationExperience company={id(1)} principal="coordinator" />
  </MemoryRouter></QueryClientProvider>));
}
it("shows the recorded task outcome/ownership without topology, controls or an output-verification claim for a member", async () => {
  vi.spyOn(api, "getOrchestrationExperience").mockResolvedValue(view); await mount("/orchestration?view=advanced");
  await vi.waitFor(() => expect(container.textContent).toContain("PRIVATE authorized work"));
  expect(container.textContent).toContain("does not verify its output"); expect(container.textContent).toContain("Growth specialist");
  expect(container.textContent).not.toContain("Original Native controls"); expect(container.querySelectorAll("button[aria-controls]")).toHaveLength(0);
  expect(container.querySelector("a")?.getAttribute("href")).toBe(`/issues/${id(3)}`);
  await act(async () => { await i18n.changeLanguage("da"); }); expect(container.textContent).toContain("Arbejdet er i gang");
});
it("opens only server-admitted bounded inspection and keeps joins, budget caps and Native controls separate", async () => {
  vi.spyOn(api, "getOrchestrationExperience").mockResolvedValue({ ...view, canInspect: true, rows: [{ ...view.rows[0]!, inspection: {
    mode: "single_worker", budgets: { maxWorkers: 1, maxParallel: 1, maxDepth: 0, maxSeconds: 900, maxRetries: 1,
      maxToolActions: 100, modelCostCapConfigured: false }, workers: [{ number: 1, taskId: id(3), agent: view.rows[0]!.owner,
      status: "running", dependsOn: [], attemptsRecorded: 1 }], controlHref: "/orchestration?view=advanced" } }] });
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("PRIVATE authorized work"));
  expect(container.querySelector<HTMLElement>(`#inspect-${id(2)}`)?.hidden).toBe(true);
  await act(async () => container.querySelector<HTMLButtonElement>("button[aria-controls]")!.click());
  expect(container.querySelector("button[aria-controls]")?.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("Single specialist"); expect(container.textContent).toContain("No model-cost cap is recorded");
  expect(container.textContent).toContain("original controls own explicit Pause, Stop");
});
it("hides private status immediately on a source change and discards its late response", async () => {
  const get = vi.spyOn(api, "getOrchestrationExperience").mockResolvedValue(view); await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("PRIVATE authorized work"));
  let release!: (value: View) => void; get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => live({ companyId: id(1), type: "activity.logged", payload: { entityType: "company_membership", action: "role.revoked" } }));
  expect(container.textContent).not.toContain("PRIVATE authorized work"); expect(container.querySelectorAll("a")).toHaveLength(0);
  account.company = id(9);
  await act(async () => release(view));
  await vi.waitFor(() => expect(container.textContent).not.toContain("PRIVATE authorized work"));
});
it("describes an empty bounded read without claiming that all work is absent", async () => {
  vi.spyOn(api, "getOrchestrationExperience").mockResolvedValue({ ...view, rows: [] }); await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("No authorized work status"));
  expect(container.textContent).toContain("not a complete inventory"); expect(container.querySelectorAll("a")).toHaveLength(0);
});
