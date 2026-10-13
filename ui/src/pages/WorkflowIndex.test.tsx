// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowIndex } from "./WorkflowIndex";
import { workflowAuthoringExperienceApi } from "../api/workflow-authoring-experience";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { queryKeys } from "../lib/queryKeys";
import "../i18n";
const state = vi.hoisted(() => ({ company: "10000000-0000-4000-8000-000000000001", ready: true, epoch: 0 }));
vi.mock("../hooks/useV9CurrentAccount", async importOriginal => ({ ...await importOriginal<typeof import("../hooks/useV9CurrentAccount")>(),
  useV9CurrentAccount: () => ({ userId: "owner", sessionId: "session-owner", localImplicit: false, settled: state.ready, failed: false, authorityEpoch: state.epoch }) }));
vi.mock("../hooks/useV9FeatureEnabled", () => ({ useV9FeatureEnabled: () => ({ enabled: true, query: { isSuccess: true, isFetching: false } }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.company, selectedCompany: { issuePrefix: "AW" } }) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: () => {} }));
vi.mock("./Workflows", () => ({ Workflows: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement, client: QueryClient;
const index = { companyId: state.company, canCreateDraft: true, coverage: "bounded" as const, workflows: [{
  id: "10000000-0000-4000-8000-000000000002", name: "Private workflow", description: "<img src=x onerror=alert(1)> Private intent",
  status: "draft" as const, updatedAt: "2026-10-13T18:00:00.000Z",
}] };
beforeEach(() => { state.ready = true; state.epoch = 0; });
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><WorkflowIndex company={state.company} principal="owner" /></MemoryRouter></QueryClientProvider>)); }
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); client.setQueryData(queryKeys.auth.session, v9SessionFixture("owner"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
}
it("shows truthful bounded Draft metadata and explicit creation navigation without writes", async () => {
  vi.spyOn(workflowAuthoringExperienceApi, "index").mockResolvedValue(index);
  const create = vi.spyOn(workflowAuthoringExperienceApi, "create"); await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("Private workflow"));
  expect(container.textContent).toContain("Draft"); expect(container.textContent).toContain("Older work may not appear");
  expect(container.querySelector('a[href$="/workflows/new"]')).not.toBeNull(); expect(container.querySelector("img")).toBeNull(); expect(create).not.toHaveBeenCalled();
});
it("withdraws cached private rows during account rechecks and rejects the old query epoch", async () => {
  const get = vi.spyOn(workflowAuthoringExperienceApi, "index").mockResolvedValue(index); await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("Private workflow"));
  state.ready = false; state.epoch++; await render(); expect(container.textContent).not.toContain("Private workflow");
  get.mockResolvedValue({ ...index, workflows: [], canCreateDraft: false }); state.ready = true; state.epoch++; await render();
  await vi.waitFor(() => expect(container.textContent).toContain("no workflows in this current view"));
  expect(container.querySelector('a[href$="/workflows/new"]')).toBeNull(); expect(container.textContent).not.toContain("Private intent");
});
