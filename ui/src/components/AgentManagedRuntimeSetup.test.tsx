// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { V5_FEATURE_KEYS, instanceExperimentalSettingsWithManagedSchema, agentAuthoringContentSchema, type AgentAuthoringDraftView } from "@paperclipai/shared";
import { AgentManagedRuntimeSetup } from "./AgentManagedRuntimeSetup";
import { agentAuthoringApi } from "../api/agent-authoring";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = vi.hoisted(() => ({ ready: true, selectionReady: true, principal: "author" }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: id(1), companies: [{ id: id(1), name: "Home" }] }) }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: scope.principal, settled: true, localImplicit: false }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const draft: AgentAuthoringDraftView = { id: id(2), companyId: id(1), createdByUserId: "author", agentId: id(3), version: 2,
  status: "draft", step: "hire_test", baselineHash: "a".repeat(64), kind: "custom", package: null,
  content: agentAuthoringContentSchema.parse({ name: "Saved inactive agent", ownerUserId: "author" }), preparation: null,
  createdAt: "2026-10-13T00:00:00Z", updatedAt: "2026-10-13T00:00:00Z" };
const imageDigest = `fixture.invalid/runtime@sha256:${"a".repeat(64)}`;
const catalog = { companyId: id(1), draftId: id(2), agentId: id(3), version: 2, capacity: [{ key: "private-capacity", product: "runtime_standard" as const, availableCells: 1 }],
  versions: [{ imageDigest, providerVersion: "private-version" }], changesLiveConfiguration: false as const };
const receipt = { companyId: id(1), draftId: id(2), agentId: id(3), requestId: id(4), cellId: id(5), operationId: id(6),
  recordedAt: "2026-10-13T00:00:00Z", operationStatus: "REQUESTED" as const, runtimeStatus: "REQUESTED", modelConfigured: false,
  activatesAgent: false as const, grantsAuthority: false as const, runtimeQualified: false as const };
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear();
  scope.ready = true; scope.selectionReady = true; scope.principal = "author"; vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><AgentManagedRuntimeSetup
  company={id(1)} principal={scope.principal} draft={draft} enabled={scope.ready} selectionEnabled={scope.selectionReady} canUseAuthority={() => scope.ready} /></MemoryRouter></QueryClientProvider>)); }
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture("author"));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue(instanceExperimentalSettingsWithManagedSchema.parse({
    ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])), enableFoundationV1: true, enableContextEngineV1: true,
    saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true, hire_agent_v9: true }));
  vi.spyOn(agentAuthoringApi, "latestManagedRuntimeReceipt").mockResolvedValue(null);
  vi.spyOn(agentAuthoringApi, "managedRuntimeCatalog").mockResolvedValue(catalog);
  vi.spyOn(agentAuthoringApi, "managedRuntimeReview").mockResolvedValue({ companyId: id(1), draftId: id(2), agentId: id(3), version: 2,
    reviewHash: "b".repeat(64), canProvision: true, blockers: [], usesIncludedCapacity: true, modelCalled: false, activatesAgent: false, grantsAuthority: false, createsRuntime: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
}
async function click(label: string) { const button = [...container.querySelectorAll("button")].find(value => value.textContent === label)!;
  expect(button).toBeDefined(); await vi.waitFor(() => expect(button.disabled).toBe(false)); await act(async () => button.click()); }
async function authorize() {
  // A newly rendered review still has a consent-reset effect to commit. Retry
  // only these local selections until both confirmations enable the action.
  await vi.waitFor(async () => {
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(2); expect(boxes.every(box => !box.disabled)).toBe(true);
    await act(async () => { for (const box of boxes) if (!box.checked) box.click(); });
    expect(boxes.every(box => box.checked)).toBe(true);
    expect([...container.querySelectorAll("button")].find(button => button.textContent === "Request managed runtime")!.disabled).toBe(false);
  });
}
it("requires both reviewed confirmations and recovers an unknown request only through its Original receipt", async () => {
  const post = vi.spyOn(agentAuthoringApi, "confirmManagedRuntime").mockRejectedValue(new Error("PRIVATE backend response"));
  const get = vi.spyOn(agentAuthoringApi, "managedRuntimeReceipt").mockImplementation(async (_company, _principal, _draft, requestId) => ({ ...receipt, requestId }));
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Request managed runtime"));
  expect([...container.querySelectorAll("button")].find(button => button.textContent === "Request managed runtime")!.disabled).toBe(true);
  await authorize(); await click("Request managed runtime");
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(container.textContent).toContain("could not be confirmed"));
  expect(container.textContent).not.toContain("PRIVATE");
  await click("Check provisioning status");
  expect(get).toHaveBeenCalledWith(id(1), "author", id(2), post.mock.calls[0]![3].requestId);
  expect(post).toHaveBeenCalledTimes(1); expect(container.textContent).toContain("provisioning is requested");
});
it("resumes an owned provisioning receipt on reload without a new capacity request", async () => {
  await mount(); vi.mocked(agentAuthoringApi.latestManagedRuntimeReceipt).mockResolvedValue(receipt);
  await act(async () => { await client.invalidateQueries({ queryKey: ["agent-managed-runtime-original"] }); });
  await vi.waitFor(() => expect(container.textContent).toContain("provisioning is requested"));
  expect(container.textContent).not.toContain("Request managed runtime");
  expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
});
it("preserves the immutable request through withdrawal and suppresses its late acknowledgement", async () => {
  let release: (value: typeof receipt) => void;
  const post = vi.spyOn(agentAuthoringApi, "confirmManagedRuntime").mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const get = vi.spyOn(agentAuthoringApi, "managedRuntimeReceipt").mockImplementation(async (_company, _principal, _draft, requestId) => ({ ...receipt, requestId }));
  await mount(); await authorize(); await click("Request managed runtime");
  scope.ready = false; await render(); expect(container.textContent).toBe("");
  await act(async () => release!({ ...receipt, requestId: post.mock.calls[0]![3].requestId }));
  expect(container.textContent).toBe(""); scope.ready = true; await render();
  await click("Check provisioning status");
  expect(get).toHaveBeenCalledWith(id(1), "author", id(2), post.mock.calls[0]![3].requestId); expect(post).toHaveBeenCalledTimes(1);
});
it("withdraws provisioning consent for unsaved changes while preserving Original receipt recovery", async () => {
  const post = vi.spyOn(agentAuthoringApi, "confirmManagedRuntime").mockRejectedValue(new Error("Lost acknowledgement"));
  const get = vi.spyOn(agentAuthoringApi, "managedRuntimeReceipt").mockImplementation(async (_company, _principal, _draft, requestId) => ({ ...receipt, requestId }));
  await mount(); await authorize(); scope.selectionReady = false; await render();
  expect(container.textContent).toContain("Save the current agent changes");
  expect([...container.querySelectorAll("button")].find(button => button.textContent === "Request managed runtime")!.disabled).toBe(true);
  expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(box => !box.checked && box.disabled)).toBe(true);
  scope.selectionReady = true; await render(); await authorize(); await click("Request managed runtime");
  scope.selectionReady = false; await render(); await click("Check provisioning status");
  expect(get).toHaveBeenCalledWith(id(1), "author", id(2), post.mock.calls[0]![3].requestId); expect(post).toHaveBeenCalledTimes(1);
});
