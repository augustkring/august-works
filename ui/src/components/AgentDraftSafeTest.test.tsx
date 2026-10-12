// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, agentDraftTestPacketSchema, type AgentAuthoringDraftView, type AgentDraftTestReview, type AgentDraftTestView } from "@paperclipai/shared";
import { AgentDraftSafeTest } from "./AgentDraftSafeTest";
import { agentAuthoringApi } from "../api/agent-authoring";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const context = vi.hoisted(() => ({ company: "10000000-0000-4000-8000-000000000001", principal: "author", ready: true }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: context.company }) }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: context.principal, settled: true, localImplicit: false }) }));
const draft: AgentAuthoringDraftView = { id: "10000000-0000-4000-8000-000000000002", companyId: context.company, createdByUserId: "author",
  agentId: "10000000-0000-4000-8000-000000000003", version: 2, status: "draft", step: "test", baselineHash: "a".repeat(64), preparation: null,
  content: agentAuthoringContentSchema.parse({ name: "Saved specialist", ownerUserId: "author", scenarios: ["Write an internal welcome"] }),
  createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z" };
const review: AgentDraftTestReview = { companyId: draft.companyId, draftId: draft.id, version: draft.version, agentId: draft.agentId!, scenarioIndex: 0,
  scenario: draft.content!.scenarios[0]!, runtimeBindingId: "10000000-0000-4000-8000-000000000004", configurationHash: "a".repeat(64), candidateHash: "b".repeat(64),
  procedureSnapshotHash: "d".repeat(64), requiredProcedures: [{ skillId: "10000000-0000-4000-8000-000000000009",
    versionId: "10000000-0000-4000-8000-000000000010", name: "Required security procedure", bodyHash: "e".repeat(64) }],
  requiredPlaybooks: [{ playbookId: "10000000-0000-4000-8000-000000000011", revisionId: "10000000-0000-4000-8000-000000000012",
    name: "Approved welcome procedure", bodyHash: "f".repeat(64) }],
  maximumCostMinor: 3, currency: "USD", provider: "anthropic", model: "fixture-draft-model", transport: "server-text-only-v1", toolsGranted: false, activatesAgent: false, companyVisibleResult: true, reviewHash: "c".repeat(64) };
const result: AgentDraftTestView = { id: "10000000-0000-4000-8000-000000000005", companyId: draft.companyId, draftId: draft.id, version: draft.version,
  requestId: "10000000-0000-4000-8000-000000000006", scenarioIndex: 0, scenario: review.scenario, agentId: draft.agentId!, runId: "10000000-0000-4000-8000-000000000007",
  planId: "10000000-0000-4000-8000-000000000008", candidateCurrent: true, runtimeCurrent: true, resultCurrent: true, execution: "succeeded",
  verification: "not_reviewed", testQualified: false, toolsGranted: false, activatesAgent: false, result: "Actual internal welcome draft", maximumCostMinor: 3,
  currency: "USD", createdAt: "2026-10-12T00:00:00.000Z" };
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); sessionStorage.clear();
  context.ready = true; context.principal = "author"; vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
async function render() { await act(async () => root.render(<StrictMode><QueryClientProvider client={client}>
  <AgentDraftSafeTest company={context.company} principal={context.principal} draft={draft} enabled={context.ready} canUseAuthority={() => context.ready} />
</QueryClientProvider></StrictMode>)); }
async function mount(history: AgentDraftTestView[] = []) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(context.principal));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])), enableFoundationV1: true,
    enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true, hire_agent_v9: true } as never);
  vi.spyOn(agentAuthoringApi, "testReview").mockResolvedValue(review); vi.spyOn(agentAuthoringApi, "tests").mockResolvedValue(history);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
  await vi.waitFor(() => expect(container.textContent).toContain("Review Safe Test"));
}
function button(text: string) { const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === text);
  expect(found).toBeDefined(); return found!; }
async function click(text: string) { await act(async () => button(text).click()); }
async function consent() { await click("Review Safe Test"); await vi.waitFor(() => expect(document.body.textContent).toContain("0.03 USD"));
  const checkbox = document.querySelector<HTMLInputElement>('[role="alertdialog"] input[type="checkbox"]')!; await act(async () => checkbox.click()); }
it("requires current C3 cost and sharing consent before submitting only the saved candidate identity", async () => {
  const start = vi.spyOn(agentAuthoringApi, "startTest").mockImplementation(async (_c, _p, _id, input) => ({ ...result, requestId: input.requestId }));
  await mount(); await click("Review Safe Test"); expect(button("Run this test").disabled).toBe(true);
  expect(document.body.textContent).toContain("Required security procedure");
  expect(document.body.textContent).toContain("Approved welcome procedure");
  expect(document.body.textContent).not.toContain(review.requiredProcedures![0]!.versionId);
  expect(document.body.textContent).toContain("authorized company members"); expect(start).not.toHaveBeenCalled();
  const checkbox = document.querySelector<HTMLInputElement>('[role="alertdialog"] input[type="checkbox"]')!; await act(async () => checkbox.click()); await click("Run this test");
  await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start.mock.calls[0]!.slice(0, 3)).toEqual([draft.companyId, "author", draft.id]);
  expect(start.mock.calls[0]![3]).toEqual({ requestId: expect.any(String), expectedVersion: 2, scenarioIndex: 0, expectedReviewHash: review.reviewHash,
    confirmRepresentativeTest: true, confirmCompanyVisibleResult: true });
  await vi.waitFor(() => expect(container.textContent).toContain("Actual internal welcome draft")); expect(container.textContent).toContain("Not reviewed");
});
it("reconciles the original unknown request on reload without repeating its model dispatch", async () => {
  const start = vi.spyOn(agentAuthoringApi, "startTest").mockRejectedValue(new Error("Lost response"));
  const receipt = vi.spyOn(agentAuthoringApi, "testReceipt").mockResolvedValue(null);
  await mount(); await consent(); await click("Run this test"); await vi.waitFor(() => expect(container.textContent).toContain("Check original test"));
  const original = start.mock.calls[0]![3]; await act(async () => root.unmount()); root = createRoot(container); await render();
  await vi.waitFor(() => expect(container.textContent).toContain("Check original test")); await click("Check original test");
  await vi.waitFor(() => expect(receipt).toHaveBeenCalledWith(draft.companyId, "author", draft.id, original.requestId));
  expect(start).toHaveBeenCalledTimes(1); expect(container.textContent).not.toContain("Review Safe Test");
  receipt.mockResolvedValue({ ...result, requestId: original.requestId }); await click("Check original test");
  await vi.waitFor(() => expect(container.textContent).toContain("Actual internal welcome draft")); expect(start).toHaveBeenCalledTimes(1);
});
it("rejects a late test acknowledgement when current account authority changes", async () => {
  let resolve!: (value: AgentDraftTestView) => void;
  const start = vi.spyOn(agentAuthoringApi, "startTest").mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); await consent(); await click("Run this test"); await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  context.ready = false; await render();
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("other")); resolve({ ...result, requestId: start.mock.calls[0]![3].requestId }); });
  expect(container.textContent).not.toContain("Actual internal welcome draft"); expect(container.textContent).not.toContain("passed human verification");
});
it("requires explicit human criterion judgements and a rationale against the exact packet", async () => {
  const packet = agentDraftTestPacketSchema.parse({ planId: result.planId, planVersion: 1, workerId: null, issueId: "10000000-0000-4000-8000-000000000009",
    contractId: "10000000-0000-4000-8000-000000000010", contractHash: "d".repeat(64), resultHash: "e".repeat(64),
    contract: { objective: review.scenario, requiredOutputs: [{ key: "representative-draft", jsonSchema: null }], requiredPostconditions: [],
      businessInvariants: ["Welcome is concise"], evidenceRequirements: ["Compare scenario"], prohibitedOutcomes: ["External send"] },
    evidence: [{ ref: "document:actual:revision", type: "task_document", sourceId: "10000000-0000-4000-8000-000000000011", sourceVersion: "10000000-0000-4000-8000-000000000012", hash: "f".repeat(64) }],
    deterministicFailures: [], liveAttempts: 0, riskClass: "C0", policy: { independentRequired: true, humanRequired: true, workerSelfCertification: false } });
  vi.spyOn(agentAuthoringApi, "testVerificationPacket").mockResolvedValue(packet); const verify = vi.spyOn(agentAuthoringApi, "verifyTest").mockResolvedValue({ ...result, verification: "pass", testQualified: true });
  await mount([result]); await vi.waitFor(() => expect(container.textContent).toContain("Actual internal welcome draft")); await click("Review actual result");
  await vi.waitFor(() => expect(container.textContent).toContain("Separate human verification"));
  expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(input => !input.checked)).toBe(true);
  expect(button("Record human review").disabled).toBe(true); expect(verify).not.toHaveBeenCalled();
  await act(async () => { for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) checkbox.click();
    const select = [...container.querySelectorAll<HTMLSelectElement>("select")].find(value => [...value.options].some(option => option.value === "pass"))!;
    select.value = "pass"; select.dispatchEvent(new Event("change", { bubbles: true }));
    const textarea = container.querySelector("textarea")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "I checked the actual draft against the scenario and each criterion."); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  await click("Record human review"); await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
  expect(verify.mock.calls[0]![4]).toMatchObject({ expectedPlanVersion: 1, expectedResultHash: packet.resultHash, result: "pass", objectiveSatisfied: true, explicitHighImpactApproval: true,
    businessInvariants: [{ index: 0, satisfied: true, evidenceRefs: ["document:actual:revision"] }] });
});
it("withdraws test actions and result content while the parent saved state is unresolved", async () => {
  await mount([result]); await vi.waitFor(() => expect(container.textContent).toContain("Actual internal welcome draft"));
  context.ready = false; await render(); expect(container.textContent).toContain("Save the candidate");
  expect(container.textContent).not.toContain("Actual internal welcome draft"); expect(container.querySelector("button")).toBeNull();
});
