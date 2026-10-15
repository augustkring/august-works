// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, type AgentAuthoringDraftView, type AgentPackageSetupReview, type AgentPackageSetupReceipt } from "@paperclipai/shared";
import { AgentDraftPackageSetup } from "./AgentDraftPackageSetup";
import { agentAuthoringApi } from "../api/agent-authoring";
import { ApiError } from "../api/client";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const context = vi.hoisted(() => ({ company: "10000000-0000-4000-8000-000000000001", principal: "author", ready: true }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: context.company }) }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: context.principal, settled: true, localImplicit: false }) }));
const agentId = "10000000-0000-4000-8000-000000000003", purposeId = "10000000-0000-4000-8000-000000000004";
const draft: AgentAuthoringDraftView = { id: "10000000-0000-4000-8000-000000000002", companyId: context.company,
  createdByUserId: "author", agentId: null, kind: "hire", version: 1, status: "draft", step: "hire_review", baselineHash: "a".repeat(64),
  preparation: { agentId, name: "Prepared specialist", status: "prepared", approvalId: null, runtimeQualified: false, authorityGranted: false, executionStarted: false },
  content: agentAuthoringContentSchema.parse({ name: "Prepared specialist", ownerUserId: "author" }),
  createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z" };
const review: AgentPackageSetupReview = { companyId: draft.companyId, draftId: draft.id, version: 1, agentId,
  installationId: "10000000-0000-4000-8000-000000000005", installationVersion: 1, packageName: "Welcome package", packageVersion: "1.0.0",
  intendedPurpose: "Produce an internal welcome draft", purposes: [{ id: purposeId, version: 4, purposeVersion: 1, name: "Approved internal welcome" }],
  selectedPurposeId: purposeId, packageCurrent: false, canConfirm: true, blockers: [], reviewHash: "b".repeat(64),
  modelCalled: false, authorityGranted: false, executionStarted: false };
const receipt: AgentPackageSetupReceipt = { companyId: draft.companyId, draftId: draft.id,
  requestId: "10000000-0000-4000-8000-000000000006", agentId, installationId: review.installationId,
  installationVersion: 3, purposeId, purposeVersion: 1, activatedAtConfirmation: true, authorityGranted: false, executionStarted: false };
let root: Root, container: HTMLDivElement, client: QueryClient;
const confirmed = vi.fn();
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); sessionStorage.clear();
  context.ready = true; context.principal = "author"; confirmed.mockReset(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
async function render() { await act(async () => root.render(<StrictMode><MemoryRouter><QueryClientProvider client={client}>
  <AgentDraftPackageSetup company={context.company} principal={context.principal} draft={draft} enabled={context.ready}
    canUseAuthority={() => context.ready} onConfirmed={confirmed} />
</QueryClientProvider></MemoryRouter></StrictMode>)); }
async function mount(value = review) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(context.principal));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])), enableFoundationV1: true,
    enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true, hire_agent_v9: true } as never);
  vi.spyOn(agentAuthoringApi, "packageSetupReview").mockResolvedValue(value);
  vi.spyOn(agentAuthoringApi, "get").mockResolvedValue({ ...draft, version: 2 });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
  await vi.waitFor(() => expect(container.textContent).toContain(value.packageCurrent ? "ready for publication" : "Review package setup"));
}
function button(text: string) { const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === text); expect(found).toBeDefined(); return found!; }
async function click(text: string) { await act(async () => button(text).click()); }
async function consent() { await click("Review package setup");
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('[role="alertdialog"] input[type="checkbox"]')) await act(async () => checkbox.click()); }
it("requires separate current purpose and activation consent before refreshing the Original saved draft", async () => {
  const post = vi.spyOn(agentAuthoringApi, "confirmPackageSetup").mockImplementation(async (_c, _p, _id, command) => ({ ...receipt, requestId: command.requestId }));
  await mount(); await click("Review package setup");
  expect(document.body.textContent).toContain("Approved internal welcome"); expect(button("Confirm package setup").disabled).toBe(true);
  expect(post).not.toHaveBeenCalled();
  const checkboxes = [...document.querySelectorAll<HTMLInputElement>('[role="alertdialog"] input[type="checkbox"]')];
  await act(async () => checkboxes[0]!.click()); expect(button("Confirm package setup").disabled).toBe(true);
  await act(async () => checkboxes[1]!.click()); await click("Confirm package setup");
  await vi.waitFor(() => expect(confirmed).toHaveBeenCalledWith({ ...draft, version: 2 }));
  expect(post).toHaveBeenCalledTimes(1); expect(post.mock.calls[0]![3]).toEqual({ requestId: expect.any(String), expectedVersion: 1,
    expectedReviewHash: review.reviewHash, purposeId, confirmIntendedPurpose: true, confirmPackageActivation: true });
});
it("reconciles an original setup after reload without repeating its confirmation", async () => {
  const post = vi.spyOn(agentAuthoringApi, "confirmPackageSetup").mockRejectedValue(new Error("Lost reply"));
  const get = vi.spyOn(agentAuthoringApi, "packageSetupReceipt").mockResolvedValue(null);
  await mount(); await consent(); await click("Confirm package setup");
  await vi.waitFor(() => expect(container.textContent).toContain("Check original setup"));
  const original = post.mock.calls[0]![3]; await act(async () => root.unmount()); root = createRoot(container); await render();
  await vi.waitFor(() => expect(container.textContent).toContain("Check original setup"));
  expect(post).toHaveBeenCalledTimes(1); get.mockResolvedValue({ ...receipt, requestId: original.requestId });
  await click("Check original setup"); await vi.waitFor(() => expect(confirmed).toHaveBeenCalledTimes(1));
  expect(get).toHaveBeenCalledWith(draft.companyId, "author", draft.id, original.requestId); expect(post).toHaveBeenCalledTimes(1);
});
it("ignores a late confirmation after current authoring access is lost", async () => {
  let resolve!: (value: AgentPackageSetupReceipt) => void;
  const post = vi.spyOn(agentAuthoringApi, "confirmPackageSetup").mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); await consent(); await click("Confirm package setup"); await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  context.ready = false; await render(); await act(async () => resolve({ ...receipt, requestId: post.mock.calls[0]![3].requestId }));
  expect(confirmed).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("Approved internal welcome");
});
it("returns an explicitly rejected setup to current review without treating it as an unknown admission", async () => {
  const post = vi.spyOn(agentAuthoringApi, "confirmPackageSetup").mockRejectedValue(new ApiError("Setup changed", 409, {}));
  await mount(); await consent(); await click("Confirm package setup");
  await vi.waitFor(() => expect(container.textContent).toContain("The setup or your access changed"));
  expect(container.textContent).not.toContain("Check original setup"); expect(post).toHaveBeenCalledTimes(1);
  expect(confirmed).not.toHaveBeenCalled();
});
it.each(["refused", "unchanged"])("withdraws the open setup dialog and its consent during a %s source recheck", async outcome => {
  const post = vi.spyOn(agentAuthoringApi, "confirmPackageSetup");
  await mount(); await consent();
  let resolve!: (value: AgentPackageSetupReview) => void, reject!: (reason: Error) => void;
  vi.mocked(agentAuthoringApi.packageSetupReview).mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  let refresh!: Promise<void>;
  await act(async () => { refresh = client.invalidateQueries({ queryKey: ["agent-package-setup"] }); });
  await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
  expect(document.body.textContent).not.toContain("Approved internal welcome");
  await act(async () => { if (outcome === "refused") reject(new ApiError("Current source refused", 403, {})); else resolve(review); await refresh; });
  expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(post).not.toHaveBeenCalled();
  if (outcome === "unchanged") {
    await vi.waitFor(() => expect(button("Review package setup").disabled).toBe(false));
    await click("Review package setup"); expect(button("Confirm package setup").disabled).toBe(true);
    expect([...document.querySelectorAll<HTMLInputElement>('[role="alertdialog"] input[type="checkbox"]')].every(input => !input.checked)).toBe(true);
  }
});
