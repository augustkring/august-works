// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, type AgentAuthoringDraftView, type AgentDraftPreparationReview } from "@paperclipai/shared";
import { AgentDraftPreparation } from "./AgentDraftPreparation";
import { agentAuthoringApi } from "../api/agent-authoring";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const context = vi.hoisted(() => ({ company: "10000000-0000-4000-8000-000000000001", principal: "author", enabled: true }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: context.company }) }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: context.principal, settled: true, localImplicit: false }) }));
const draft: AgentAuthoringDraftView = {
  id: "10000000-0000-4000-8000-000000000002", companyId: context.company, createdByUserId: "author", agentId: null,
  version: 2, status: "draft", step: "runtime", baselineHash: null,
  content: agentAuthoringContentSchema.parse({ name: "Saved specialist", outcome: "Prepare internal drafts", ownerUserId: "author" }),
  createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z",
};
const review: AgentDraftPreparationReview = {
  draftId: draft.id, companyId: draft.companyId, version: draft.version, name: "Saved specialist", outcome: "Prepare internal drafts",
  accountableOwner: { userId: "author", name: "Current accountable owner" }, requiresBoardApproval: true,
  createsInactiveAgent: true, runtimeQualified: false, authorityGranted: false, executionStarted: false, reviewHash: "a".repeat(64),
};
const prepared: AgentAuthoringDraftView = { ...draft, version: 3, preparation: { agentId: "10000000-0000-4000-8000-000000000003",
  name: "Saved specialist", approvalId: "10000000-0000-4000-8000-000000000004", status: "pending_approval",
  runtimeQualified: false, authorityGranted: false, executionStarted: false } };
let root: Root, container: HTMLDivElement, client: QueryClient;
const confirmed = vi.fn();
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove(); client?.clear(); sessionStorage.clear(); context.enabled = true; context.principal = "author";
  confirmed.mockReset(); vi.restoreAllMocks(); await i18n.changeLanguage("en");
});
async function render() {
  await act(async () => root.render(<StrictMode><QueryClientProvider client={client}>
    <AgentDraftPreparation company={context.company} principal={context.principal} draft={draft} enabled={context.enabled}
      canUseAuthority={() => true} onConfirmed={confirmed} />
  </QueryClientProvider></StrictMode>));
}
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture(context.principal));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])),
    enableFoundationV1: true, enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true, hire_agent_v9: true } as never);
  vi.spyOn(agentAuthoringApi, "preparationReview").mockResolvedValue(review);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(value => value.textContent === label);
  expect(button).toBeDefined(); await act(async () => button!.click());
}
async function approve() {
  await vi.waitFor(() => expect(container.textContent).toContain("Current accountable owner"));
  await click("Review inactive agent preparation");
  const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
  expect(checkbox).toBeTruthy();
  const submit = [...document.querySelectorAll("button")].find(button => button.textContent === "Prepare inactive agent")!;
  expect(submit.disabled).toBe(true);
  await act(async () => checkbox!.click());
  await click("Prepare inactive agent");
}
it("requires separate explicit C3, shows the accountable owner and board gate, and accepts only the actual inactive receipt", async () => {
  const post = vi.spyOn(agentAuthoringApi, "prepare").mockResolvedValue(prepared);
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("requires board approval"));
  expect(post).not.toHaveBeenCalled();
  await approve();
  await vi.waitFor(() => expect(confirmed).toHaveBeenCalledWith(prepared));
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith(draft.companyId, "author", draft.id, expect.objectContaining({ expectedVersion: 2, expectedReviewHash: review.reviewHash, confirmInactiveAgentPreparation: true }));
  expect(sessionStorage.length).toBe(0);
});
it("retains only command identity after an unknown reply and uses a read on reload without automatic replay", async () => {
  const post = vi.spyOn(agentAuthoringApi, "prepare").mockRejectedValue(new Error("Lost response"));
  const get = vi.spyOn(agentAuthoringApi, "get").mockResolvedValue(prepared);
  await mount(); await approve();
  await vi.waitFor(() => expect(container.textContent).toContain("response is unknown"));
  const stored = sessionStorage.getItem(sessionStorage.key(0)!)!;
  expect(stored).toContain(review.reviewHash); expect(stored).not.toContain("Prepare internal drafts"); expect(stored).not.toContain("Current accountable owner");
  await act(async () => root.unmount()); root = createRoot(container); await render();
  await vi.waitFor(() => expect(container.textContent).toContain("Check original draft"));
  expect(post).toHaveBeenCalledTimes(1); expect(get).not.toHaveBeenCalled();
  await click("Check original draft");
  await vi.waitFor(() => expect(confirmed).toHaveBeenCalledWith(prepared));
  expect(post).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1);
});
it("rejects a late creation response after the current account changes", async () => {
  let resolve!: (value: AgentAuthoringDraftView) => void;
  vi.spyOn(agentAuthoringApi, "prepare").mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); await approve();
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-account")); });
  await act(async () => resolve(prepared));
  expect(confirmed).not.toHaveBeenCalled();
});
it("does not review or prepare unsaved draft changes", async () => {
  context.enabled = false;
  const post = vi.spyOn(agentAuthoringApi, "prepare");
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("Save your draft changes"));
  expect(agentAuthoringApi.preparationReview).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
