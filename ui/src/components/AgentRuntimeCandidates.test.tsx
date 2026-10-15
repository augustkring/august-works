// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { V5_FEATURE_KEYS, instanceExperimentalSettingsWithManagedSchema, agentAuthoringContentSchema, type AgentAuthoringDraftView } from "@paperclipai/shared";
import { AgentRuntimeCandidates } from "./AgentRuntimeCandidates";
import { agentAuthoringApi } from "../api/agent-authoring";
import { instanceSettingsApi } from "../api/instanceSettings";
import { v5Api } from "../api/v5";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = vi.hoisted(() => ({ ready: true, principal: "author" }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: id(1), companies: [{ id: id(1), name: "Home" }, { id: id(5), name: "Peer" }] }) }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: scope.principal, settled: true, localImplicit: false }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const draft: AgentAuthoringDraftView = { id: id(2), companyId: id(1), createdByUserId: "author", agentId: id(3), version: 2,
  status: "draft", step: "runtime", baselineHash: "a".repeat(64), kind: "custom", package: null,
  content: agentAuthoringContentSchema.parse({ name: "Saved draft", ownerUserId: "author" }), preparation: null,
  createdAt: "2026-10-13T00:00:00Z", updatedAt: "2026-10-13T00:00:00Z" };
const catalog = { companyId: id(1), draftId: id(2), version: 2, agentId: id(3), identityId: id(9), choices: [{ modelProfileId: id(4),
  model: "qualified-fixture-model", configurationHash: "b".repeat(64), maxOutputTokens: 256, maximumMinorPerCall: 3,
  currency: "USD" as const, requiresConformance: true as const, changesLive: false as const }] };
const candidate = { id: id(6), companyId: id(1), draftId: id(2), agentId: id(3), modelProfileId: id(4), configurationHash: "b".repeat(64),
  recordedStatus: "draft" as const, qualificationRequestId: null, qualificationCurrent: false, createdAt: "2026-10-13T00:00:00Z", changesLive: false as const };
let root: Root, container: HTMLDivElement, client: QueryClient, renderedDraft = draft, selected: string | null = null;
const choose = vi.fn();
afterEach(async () => {
  if (root) await act(async () => root.unmount()); client?.clear(); container?.remove();
  scope.ready = true; scope.principal = "author"; renderedDraft = draft; selected = null; choose.mockReset(); vi.restoreAllMocks(); await i18n.changeLanguage("en");
});
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><AgentRuntimeCandidates company={id(1)} principal={scope.principal}
    draft={renderedDraft} enabled={scope.ready} selectionEnabled={true} canUseAuthority={() => scope.ready} selectedId={selected} onSelect={choose} /></QueryClientProvider>));
}
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture("author"));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue(instanceExperimentalSettingsWithManagedSchema.parse({ ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])),
    enableFoundationV1: true, enableContextEngineV1: true,
    saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true, hire_agent_v9: true }));
  vi.spyOn(agentAuthoringApi, "runtimeCandidateCatalog").mockResolvedValue(catalog);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
}
async function expand() {
  await vi.waitFor(() => expect(container.querySelector("details")).not.toBeNull());
  await act(async () => { const details = container.querySelector("details")!; details.open = true; details.dispatchEvent(new Event("toggle")); });
  await vi.waitFor(() => expect(container.textContent).toContain("Installed model profile"));
  await vi.waitFor(() => expect(container.querySelector("select option[value='" + id(4) + "']")).not.toBeNull());
}
async function select(value: string, index = 0) { await act(async () => {
  const element = container.querySelectorAll("select")[index]!; element.value = value; element.dispatchEvent(new Event("change", { bubbles: true }));
}); }
async function click(label: string) { const button = [...container.querySelectorAll("button")].find(value => value.textContent === label)!;
  expect(button).toBeDefined(); await act(async () => button.click()); }
it("does not read private alternative profiles until Advanced is opened", async () => {
  await mount(); expect(agentAuthoringApi.runtimeCandidateCatalog).not.toHaveBeenCalled();
  await expand(); expect(agentAuthoringApi.runtimeCandidateCatalog).toHaveBeenCalledTimes(1);
});
it("keeps an unknown creation immutable and recovers by original read without creating twice", async () => {
  const create = vi.spyOn(agentAuthoringApi, "createRuntimeCandidate").mockRejectedValue(new Error("PRIVATE-ERROR"));
  const lookup = vi.spyOn(agentAuthoringApi, "runtimeCandidateCreationReceipt").mockResolvedValue(candidate);
  await mount(); await expand(); await select(id(4)); await click("Save runtime proposal");
  await vi.waitFor(() => expect(container.textContent).toContain("could not be confirmed"));
  expect(container.textContent).not.toContain("PRIVATE-ERROR"); expect(container.querySelector("select")?.disabled).toBe(true);
  await click("Check original proposal receipt");
  expect(lookup).toHaveBeenCalledWith(id(1), "author", id(2), create.mock.calls[0]![3].requestId);
  expect(create).toHaveBeenCalledTimes(1); expect(choose).toHaveBeenCalledWith(id(6));
});
it("withholds a late creation across the private source check and retains its original key for recovery", async () => {
  let resolve!: (value: typeof candidate) => void;
  const create = vi.spyOn(agentAuthoringApi, "createRuntimeCandidate").mockImplementation(() => new Promise(done => { resolve = done; }));
  const lookup = vi.spyOn(agentAuthoringApi, "runtimeCandidateCreationReceipt").mockResolvedValue(candidate);
  await mount(); await expand(); await select(id(4)); await click("Save runtime proposal");
  await act(async () => { scope.ready = false; }); await render(); expect(container.querySelector("select")).toBeNull();
  await act(async () => resolve(candidate)); expect(choose).not.toHaveBeenCalled();
  scope.ready = true; await render(); await vi.waitFor(() => expect(container.textContent).toContain("Check original proposal receipt"));
  await click("Check original proposal receipt");
  expect(lookup.mock.calls[0]![3]).toBe(create.mock.calls[0]![3].requestId); expect(choose).toHaveBeenCalledOnce();
});
it("recovers the original qualification after draft version and selected candidate change without another model dispatch", async () => {
  const saved = { ...draft, content: { ...draft.content!, runtimeCandidateId: candidate.id } }; renderedDraft = saved; selected = candidate.id;
  vi.spyOn(v5Api, "identities").mockResolvedValue([{ id: id(9), agentId: id(7) }] as Awaited<ReturnType<typeof v5Api.identities>>);
  vi.spyOn(agentAuthoringApi, "runtimeCandidateConformanceReview").mockResolvedValue({ companyId: id(1), draftId: id(2), candidateId: id(6),
    version: 2, reviewHash: "c".repeat(64), canTest: true, blockers: [], maximumMinor: 12, currency: "USD", probeCount: 4,
    toolsGranted: false, changesLiveConfiguration: false, providerComputeStopConfirmed: false });
  const start = vi.spyOn(agentAuthoringApi, "startRuntimeCandidateConformance").mockRejectedValue(new Error("PRIVATE-UNKNOWN"));
  const get = vi.spyOn(agentAuthoringApi, "runtimeCandidateConformanceReceipt").mockImplementation(async (_company, _principal, _draft, originalCandidate, request) => ({
    companyId: id(1), draftId: id(2), candidateId: originalCandidate, requestId: request, status: "pending", createdAt: "2026-10-13T00:00:00Z",
    finishedAt: null, runIds: [], reservationIds: [], reservedMinor: 0, unknownCharges: 0, changesLiveConfiguration: false, providerComputeStopConfirmed: false }));
  await mount(); await expand(); await select(id(5), 1);
  await vi.waitFor(() => expect(container.textContent).toContain("USD 0.12"));
  await act(async () => { for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) checkbox.click(); });
  await click("Run four qualification probes"); await vi.waitFor(() => expect(container.textContent).toContain("could not be confirmed"));
  renderedDraft = { ...saved, version: 3, content: { ...saved.content, runtimeCandidateId: id(8) } }; selected = id(8);
  await render(); await click("Check original qualification receipt");
  expect(get.mock.calls[0]!.slice(0, 4)).toEqual([id(1), "author", id(2), id(6)]);
  expect(get.mock.calls[0]![4]).toBe(start.mock.calls[0]![4].requestId);
  expect(start).toHaveBeenCalledTimes(1); expect(container.textContent).not.toContain("PRIVATE-UNKNOWN");
});
