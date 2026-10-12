// @vitest-environment jsdom
import { MemoryRouter } from "react-router-dom";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, type AgentAuthoringDraftView, type AgentDraftPublicationReview, type AgentDraftPublicationReceipt } from "@paperclipai/shared";
import { AgentDraftPublication } from "./AgentDraftPublication";
import { agentAuthoringApi } from "../api/agent-authoring";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const context = vi.hoisted(() => ({ company: "10000000-0000-4000-8000-000000000001", principal: "author", ready: true, receiptOnly: false }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: context.company }) }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: context.principal, settled: true, localImplicit: false }) }));
const draft: AgentAuthoringDraftView = { id: "10000000-0000-4000-8000-000000000002", companyId: context.company, createdByUserId: "author",
  agentId: "10000000-0000-4000-8000-000000000003", version: 2, status: "draft", step: "test", baselineHash: "a".repeat(64), preparation: null,
  content: agentAuthoringContentSchema.parse({ name: "Saved specialist", capabilities: [{ operation: "create_internal_draft", autonomy: "automatic" }], ownerUserId: "author", scenarios: ["Write an internal welcome"] }),
  createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z" };
const review: AgentDraftPublicationReview = { companyId: draft.companyId, draftId: draft.id, version: draft.version, agentId: draft.agentId!,
  previousVersion: 1, nextVersion: 2, before: { ...draft.content!, outcome: "Old published responsibility" }, after: draft.content!,
  activate: true, canPublish: true, blockers: [], requiredProcedures: [{ skillId: "10000000-0000-4000-8000-000000000009", versionId: "10000000-0000-4000-8000-000000000010", name: "Required security procedure" }],
  requiredPlaybooks: [{ playbookId: "10000000-0000-4000-8000-000000000011", revisionId: "10000000-0000-4000-8000-000000000012",
    name: "Approved welcome procedure", bodyHash: "f".repeat(64) }],
  maximumPerModelCallMinor: 3, currency: "USD", provider: "anthropic", model: "fixture-draft-model", runtimeBindingId: null, reviewHash: "c".repeat(64), modelCalled: false, authorityGranted: false, executionStarted: false };
const result: AgentDraftPublicationReceipt = { companyId: draft.companyId, draftId: draft.id, requestId: "10000000-0000-4000-8000-000000000006", agentId: draft.agentId!,
  revisionId: "10000000-0000-4000-8000-000000000006", publishedContent: draft.content!, publishedVersion: 2, publishedAt: "2026-10-12T00:00:00.000Z", activatedAtPublication: true, authorityGranted: false, executionStarted: false };
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); sessionStorage.clear();
  context.ready = true; context.principal = "author"; context.receiptOnly = false; vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
async function render() { await act(async () => root.render(<StrictMode><MemoryRouter><QueryClientProvider client={client}>
  <AgentDraftPublication company={context.company} principal={context.principal} draft={draft} receiptOnly={context.receiptOnly} enabled={context.ready} canUseAuthority={() => context.ready}
    options={{ owners: [{ id: "author", name: "Responsible author" }], knowledge: [], runtimes: [] }} />
</QueryClientProvider></MemoryRouter></StrictMode>)); }
async function mount(value = review, rollout = true) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(context.principal));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])), enableFoundationV1: true,
    enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true, hire_agent_v9: rollout } as never);
  vi.spyOn(agentAuthoringApi, "publicationReview").mockResolvedValue(value);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
  await vi.waitFor(() => expect(container.textContent).toContain(context.receiptOnly ? "Version 2 was published and activated" : "Review publication and activation"));
}
function button(text: string) { const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === text); expect(found).toBeDefined(); return found!; }
async function click(text: string) { await act(async () => button(text).click()); }
async function consent() {
  await click("Review publication and activation"); await vi.waitFor(() => expect(document.body.textContent).toContain("0.03 USD"));
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('[role="alertdialog"] input[type="checkbox"]')) await act(async () => checkbox.click());
}
it("requires separate publication and activation consent against the saved version and current exact review", async () => {
  const publish = vi.spyOn(agentAuthoringApi, "publish").mockImplementation(async (_c, _p, _id, input) => ({ ...result, requestId: input.requestId, revisionId: input.requestId }));
  await mount(); await click("Review publication and activation"); expect(button("Publish and activate").disabled).toBe(true);
  expect(document.body.textContent).toContain("Approved welcome procedure");
  expect(publish).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Old published responsibility"); expect(document.body.textContent).toContain("Responsible author");
  expect(document.body.textContent).toContain("Required security procedure"); expect(document.body.textContent).not.toContain(review.requiredProcedures[0]!.versionId);
  const checkboxes = document.querySelectorAll<HTMLInputElement>('[role="alertdialog"] input[type="checkbox"]');
  expect(checkboxes).toHaveLength(2); await act(async () => checkboxes[0]!.click()); expect(button("Publish and activate").disabled).toBe(true);
  await act(async () => checkboxes[1]!.click()); await click("Publish and activate");
  await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  expect(publish.mock.calls[0]!.slice(0, 3)).toEqual([draft.companyId, "author", draft.id]);
  expect(publish.mock.calls[0]![3]).toEqual({ requestId: expect.any(String), expectedVersion: 2, expectedReviewHash: review.reviewHash, activate: true, confirmPublication: true, confirmActivation: true });
  await vi.waitFor(() => expect(container.textContent).toContain("Version 2 was published and activated"));
});
it("recovers a lost publication response by reading the Original receipt without resending", async () => {
  const publish = vi.spyOn(agentAuthoringApi, "publish").mockRejectedValue(new Error("Lost response"));
  const receipt = vi.spyOn(agentAuthoringApi, "publicationReceipt").mockResolvedValue(null);
  await mount(); await consent(); await click("Publish and activate"); await vi.waitFor(() => expect(container.textContent).toContain("Check original publication"));
  const original = publish.mock.calls[0]![3]; await act(async () => root.unmount()); root = createRoot(container); await render();
  await vi.waitFor(() => expect(container.textContent).toContain("Check original publication")); await click("Check original publication");
  await vi.waitFor(() => expect(receipt).toHaveBeenCalledWith(draft.companyId, "author", draft.id, original.requestId));
  expect(publish).toHaveBeenCalledTimes(1); expect(container.textContent).not.toContain("Review publication and activation");
  receipt.mockResolvedValue({ ...result, requestId: original.requestId, revisionId: original.requestId }); await click("Check original publication");
  await vi.waitFor(() => expect(container.textContent).toContain("Version 2 was published and activated")); expect(publish).toHaveBeenCalledTimes(1);
});
it("refuses a late publication acknowledgement after account authority changes", async () => {
  let resolve!: (value: AgentDraftPublicationReceipt) => void;
  const publish = vi.spyOn(agentAuthoringApi, "publish").mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); await consent(); await click("Publish and activate"); await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  context.ready = false; await render();
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("other")); resolve({ ...result, requestId: publish.mock.calls[0]![3].requestId }); });
  expect(container.textContent).not.toContain("Version 2 was published and activated");
});
it("withdraws publication when current work blocks a version replacement", async () => {
  const publish = vi.spyOn(agentAuthoringApi, "publish");
  await mount({ ...review, canPublish: false, blockers: [{ code: "publication_work_in_flight", message: "Fixture raw server message" }] });
  expect(button("Review publication and activation").disabled).toBe(true); expect(container.textContent).toContain("Wait for the agent’s current work");
  expect(container.textContent).not.toContain("Fixture raw server message"); expect(publish).not.toHaveBeenCalled();
});
it("reads a previously confirmed publication again after reload instead of creating another command", async () => {
  const publish = vi.spyOn(agentAuthoringApi, "publish").mockImplementation(async (_c, _p, _id, input) => ({ ...result, requestId: input.requestId, revisionId: input.requestId }));
  const receipt = vi.spyOn(agentAuthoringApi, "publicationReceipt");
  await mount(); await consent(); await click("Publish and activate"); await vi.waitFor(() => expect(container.textContent).toContain("Version 2 was published and activated"));
  const original = publish.mock.calls[0]![3]; receipt.mockResolvedValue({ ...result, requestId: original.requestId, revisionId: original.requestId });
  await act(async () => root.unmount()); root = createRoot(container); await render();
  await vi.waitFor(() => expect(container.textContent).toContain("Check original publication")); await click("Check original publication");
  await vi.waitFor(() => expect(container.textContent).toContain("Version 2 was published and activated"));
  expect(receipt).toHaveBeenCalledWith(draft.companyId, "author", draft.id, original.requestId); expect(publish).toHaveBeenCalledTimes(1);
});
it("reads the immutable Original receipt after rollout withdrawal without using edited draft text", async () => {
  context.receiptOnly = true;
  const old = { ...result, publishedContent: { ...result.publishedContent, name: "Published specialist", outcome: "Earlier immutable responsibility" },
    packageInstallation: { installationId: "10000000-0000-4000-8000-000000000011", versionId: "10000000-0000-4000-8000-000000000012",
      key: "welcome", version: "1.0.0", contentHash: "d".repeat(64) } };
  const receipt = vi.spyOn(agentAuthoringApi, "publicationReceipt").mockResolvedValue(old), publish = vi.spyOn(agentAuthoringApi, "publish");
  await mount(review, false);
  expect(container.textContent).toContain("Published specialist"); expect(container.textContent).toContain("Earlier immutable responsibility");
  expect(container.textContent).toContain("1.0.0");
  expect(container.textContent).not.toContain("Review publication and activation");
  expect(receipt).toHaveBeenCalledWith(draft.companyId, "author", draft.id, undefined, expect.any(AbortSignal)); expect(publish).not.toHaveBeenCalled();
});
it("keeps a known receipt identity during refetch and never substitutes a later publication after Source withdrawal", async () => {
  context.receiptOnly = true;
  const get = vi.spyOn(agentAuthoringApi, "publicationReceipt").mockResolvedValue(result);
  const publish = vi.spyOn(agentAuthoringApi, "publish");
  await mount(review, false);
  await vi.waitFor(() => expect(get).toHaveBeenCalledWith(draft.companyId, "author", draft.id, result.requestId, expect.any(AbortSignal)));
  const before = get.mock.calls.length;
  get.mockImplementation(async (_company, _principal, _draft, id) => id === result.requestId ? null : {
    ...result, requestId: "10000000-0000-4000-8000-000000000013", publishedVersion: 3,
    publishedContent: { ...result.publishedContent, name: "Later different publication" },
  });
  await act(async () => { await client.invalidateQueries({ queryKey: ["agent-draft-publication-receipt"] }); });
  await vi.waitFor(() => expect(container.textContent).not.toContain("Version 2 was published and activated"));
  expect(container.textContent).not.toContain("Later different publication");
  expect(get.mock.calls.slice(before).length).toBeGreaterThan(0);
  expect(get.mock.calls.slice(before).every(call => call[3] === result.requestId)).toBe(true);
  expect(publish).not.toHaveBeenCalled();
});
