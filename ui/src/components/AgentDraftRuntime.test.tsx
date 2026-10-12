// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, type AgentAuthoringDraftView, type AgentDraftRuntimeView } from "@paperclipai/shared";
import { AgentDraftRuntime } from "./AgentDraftRuntime";
import { agentAuthoringApi } from "../api/agent-authoring";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const context = vi.hoisted(() => ({ company: "10000000-0000-4000-8000-000000000001", principal: "author", ready: true }));
const selectedRuntime = vi.fn();
let selectable = false, selectedBinding: string | null = null;
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: context.company, selectedCompany: { issuePrefix: "AW" } }) }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: context.principal, settled: true, localImplicit: false }) }));
const draft: AgentAuthoringDraftView = { id: "10000000-0000-4000-8000-000000000002", companyId: context.company,
  createdByUserId: "author", agentId: null, version: 2, status: "draft", step: "runtime", baselineHash: null,
  content: agentAuthoringContentSchema.parse({ name: "Saved specialist", ownerUserId: "author" }),
  preparation: { agentId: "10000000-0000-4000-8000-000000000003", name: "Saved specialist", approvalId: null, status: "prepared",
    runtimeQualified: false, authorityGranted: false, executionStarted: false },
  createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z" };
const observed: AgentDraftRuntimeView = { draftId: draft.id, companyId: draft.companyId, version: draft.version, agentId: draft.preparation!.agentId,
  runtimeBindingId: "10000000-0000-4000-8000-000000000004", configurationHash: "a".repeat(64), status: "qualified", runtimeQualified: true,
  safeTestQualified: false, executionStarted: false };
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount()); container?.remove(); client?.clear();
  context.ready = true; context.principal = "author"; selectable = false; selectedBinding = null; selectedRuntime.mockReset();
  vi.restoreAllMocks(); await i18n.changeLanguage("en");
});
async function render() {
  await act(async () => root.render(<StrictMode><QueryClientProvider client={client}><MemoryRouter initialEntries={["/AW/agents/custom"]}>
    <AgentDraftRuntime company={context.company} principal={context.principal} draft={draft} enabled={context.ready} canUseAuthority={() => context.ready}
      selectedRuntimeBindingId={selectedBinding} selectionEnabled={selectable} onSelectRuntime={selectable ? selectedRuntime : undefined} />
  </MemoryRouter></QueryClientProvider></StrictMode>));
}
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(context.principal));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])),
    enableFoundationV1: true, enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true, hire_agent_v9: true } as never);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
}
it("shows current runtime validation separately from Safe Test and links only the actual prepared Agent's Original configuration", async () => {
  const read = vi.spyOn(agentAuthoringApi, "runtime").mockResolvedValue(observed), prepare = vi.spyOn(agentAuthoringApi, "prepare"), save = vi.spyOn(agentAuthoringApi, "save");
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("A representative Safe Test is still required"));
  expect(container.querySelector("a")?.getAttribute("href")).toBe(`/AW/agents/${draft.preparation!.agentId}/configuration`);
  expect(read).toHaveBeenCalledWith(draft.companyId, "author", draft.id, expect.any(AbortSignal));
  expect(prepare).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});
it("rejects a different Agent's runtime proof instead of presenting its qualification", async () => {
  vi.spyOn(agentAuthoringApi, "runtime").mockResolvedValue({ ...observed, agentId: "10000000-0000-4000-8000-000000000099" });
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Current execution setup is unavailable"));
  expect(container.textContent).not.toContain("has current validation"); expect(container.querySelector("a")).toBeNull();
});
it("hides metadata during a parent authority recheck and rejects the late read after an account switch", async () => {
  let resolve!: (value: AgentDraftRuntimeView) => void;
  const read = vi.spyOn(agentAuthoringApi, "runtime").mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); await vi.waitFor(() => expect(read).toHaveBeenCalled());
  context.ready = false; await render();
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("other")); resolve(observed); });
  expect(container.textContent).not.toContain("has current validation"); expect(container.querySelector("a")).toBeNull();
});
it.each(["en", "da"])("selects only the fresh actual Agent binding into the local candidate in %s", async language => {
  selectable = true; await i18n.changeLanguage(language);
  vi.spyOn(agentAuthoringApi, "runtime").mockResolvedValue(observed);
  const save = vi.spyOn(agentAuthoringApi, "save"), prepare = vi.spyOn(agentAuthoringApi, "prepare");
  await mount();
  const label = language === "en" ? "Use this agent’s validated runtime" : "Brug denne agents validerede runtime";
  await vi.waitFor(() => expect([...container.querySelectorAll("button")].some(button => button.textContent === label)).toBe(true));
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click());
  expect(selectedRuntime).toHaveBeenCalledExactlyOnceWith(observed.runtimeBindingId);
  selectedBinding = observed.runtimeBindingId; await render();
  expect(container.textContent).toContain(language === "en" ? "Save the candidate before Safe Test" : "Gem kandidaten før Safe Test");
  expect(save).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
});
it("withdraws the selection during a runtime recheck, refuses cached proof after failure and recovers by an explicit read", async () => {
  selectable = true;
  const read = vi.spyOn(agentAuthoringApi, "runtime").mockResolvedValue(observed);
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("Use this agent’s validated runtime"));
  let refuse!: (error: Error) => void;
  read.mockImplementationOnce(() => new Promise((_, reject) => { refuse = reject; }));
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Recheck execution setup")!.click());
  await vi.waitFor(() => expect(container.textContent).toContain("Checking this agent"));
  expect(container.querySelector("a")).toBeNull(); expect(container.textContent).not.toContain("validated runtime");
  await act(async () => refuse(new Error("Source unavailable")));
  await vi.waitFor(() => expect(container.textContent).toContain("Current execution setup is unavailable"));
  expect(selectedRuntime).not.toHaveBeenCalled();
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Recheck execution setup")!.click());
  await vi.waitFor(() => expect(container.textContent).toContain("Use this agent’s validated runtime"));
  expect(selectedRuntime).not.toHaveBeenCalled();
});
it("refuses a selection immediately when the session cache changes before React observes it", async () => {
  selectable = true; vi.spyOn(agentAuthoringApi, "runtime").mockResolvedValue(observed);
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Use this agent’s validated runtime"));
  const button = [...container.querySelectorAll("button")].find(button => button.textContent === "Use this agent’s validated runtime")!;
  await act(async () => {
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("other"));
    button.click();
  });
  expect(selectedRuntime).not.toHaveBeenCalled();
});
