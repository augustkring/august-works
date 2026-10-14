// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowDraftFlow } from "./WorkflowDraftFlow";
import { workflowDraftFlowApi } from "../api/workflow-draft-flow";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { pendingWorkflowRequests, retainWorkflowRequest } from "../lib/pending-workflow-requests";
import { i18n } from "../i18n";
const company = "10000000-0000-4000-8000-000000000001", workflow = "10000000-0000-4000-8000-000000000002", principal = "editor";
const review = { companyId: company, workflowId: workflow, draftRevisionId: "10000000-0000-4000-8000-000000000003",
  publishedRevisionId: null, updatedAt: "2026-10-14T00:00:00.000Z", version: 1, deadlineSeconds: null, availability: "empty" as const, steps: [] };
const linear = { ...review, availability: "linear" as const, steps: [{ nodeId: "start", type: "core.manual_trigger", name: "Start manually" }] };
let live: (event: { companyId: string; type: string; payload: Record<string, unknown> }) => void;
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (listener: typeof live) => { live = listener; } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "10000000-0000-4000-8000-000000000001", selectedCompany: { issuePrefix: "AW" } }) }));
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(async () => {
  vi.restoreAllMocks(); sessionStorage.clear(); await i18n.changeLanguage("en");
  vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture(principal));
  vi.spyOn(workflowDraftFlowApi, "review").mockResolvedValue(review);
  vi.spyOn(workflowDraftFlowApi, "save").mockRejectedValue(new Error("Lost acknowledgement"));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(principal));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); sessionStorage.clear(); vi.restoreAllMocks(); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><WorkflowDraftFlow company={company} principal={principal} workflow={workflow} /></MemoryRouter></QueryClientProvider>)); await flush(); }
async function click(label: string) { const button = [...container.querySelectorAll("button")].find(button => button.textContent === label)!; expect(button).toBeTruthy(); await act(async () => button.click()); await flush(); }
async function field(id: string, value: string) { const input = container.querySelector<HTMLInputElement>(`#draft-flow-${id}`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
it("saves only an explicit manual start, retaining one original nonce through unknown response and reload", async () => {
  await mount(); await field("deadline", "30"); await click("Add a manual start"); expect(workflowDraftFlowApi.save).toHaveBeenCalledOnce();
  expect(workflowDraftFlowApi.save).toHaveBeenCalledWith(company, workflow, principal, expect.objectContaining({ expectedLastNodeId: null, operation: { kind: "start_manual", deadlineSeconds: 30, name: "Start when I run the workflow" } }));
  const [pending] = pendingWorkflowRequests(company, principal, workflow); expect(pending.kind).toBe("draft_build");
  expect(sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")).not.toContain("Start when I run");
  expect(container.querySelector(`a[href$="/requests/draft_build/${pending.requestId}"]`)).toBeTruthy();
  await act(async () => root.unmount()); root = createRoot(container); await mount(); await click("Add a manual start");
  expect(workflowDraftFlowApi.save).toHaveBeenCalledOnce();
});
it("rejects invalid visible fields before any request and saves the explicitly reviewed last node", async () => {
  vi.mocked(workflowDraftFlowApi.review).mockResolvedValue(linear); await mount(); await field("name", "PRIVATE wait"); await field("duration", "0"); await click("Add a step");
  expect(workflowDraftFlowApi.save).not.toHaveBeenCalled(); expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([]);
  expect(container.querySelector("#draft-flow-duration")?.getAttribute("aria-describedby")).toBe("draft-flow-duration-error");
  expect(document.activeElement?.getAttribute("role")).toBe("alert"); await field("duration", "7"); await click("Add a step");
  expect(workflowDraftFlowApi.save).toHaveBeenCalledWith(company, workflow, principal, expect.objectContaining({ expectedLastNodeId: "start", operation: { kind: "append_wait", name: "PRIVATE wait", durationSeconds: 7 } }));
});
it("keeps branched flows in Advanced rather than rendering or editing a flattened path", async () => {
  vi.mocked(workflowDraftFlowApi.review).mockResolvedValue({ ...review, availability: "advanced" }); await mount();
  expect(container.textContent).toContain("preserve its branches"); expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector(`a[href$="/workflows/${workflow}/advanced"]`)).toBeTruthy(); expect(workflowDraftFlowApi.save).not.toHaveBeenCalled();
});
it("blocks composition while a selected-step save remains unknown, even if its kind is different", async () => {
  const requestId = "10000000-0000-4000-8000-000000000009";
  retainWorkflowRequest({ companyId: company, workflowId: workflow, principal, kind: "draft_edit", requestId });
  await mount(); expect(container.querySelector(`a[href$="/requests/draft_edit/${requestId}"]`)).toBeTruthy(); await click("Add a manual start");
  expect(workflowDraftFlowApi.save).not.toHaveBeenCalled();
  expect(() => retainWorkflowRequest({ companyId: company, workflowId: workflow, principal, kind: "draft_build", requestId })).toThrow();
  expect(pendingWorkflowRequests(company, principal, workflow)).toHaveLength(1);
});
it("hides private draft names during account rechecks and rejects a late acknowledgement", async () => {
  vi.mocked(workflowDraftFlowApi.review).mockResolvedValue(linear);
  let finish!: (receipt: Awaited<ReturnType<typeof workflowDraftFlowApi.save>>) => void;
  vi.mocked(workflowDraftFlowApi.save).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await field("name", "PRIVATE wait"); await field("duration", "7"); await click("Add a step");
  const [pending] = pendingWorkflowRequests(company, principal, workflow);
  vi.mocked(authApi.getSession).mockImplementation(() => new Promise(() => {})); await act(async () => { void client.invalidateQueries({ queryKey: queryKeys.auth.session }); });
  await act(async () => finish({ companyId: company, workflowId: workflow, requestId: pending.requestId, previousRevisionId: review.draftRevisionId,
    draftRevisionId: "10000000-0000-4000-8000-000000000006", version: 2, changed: true, recordedAt: review.updatedAt, published: false, executionStarted: false }));
  expect(container.querySelector("form")).toBeNull(); expect(container.textContent).not.toContain("Start manually"); expect(container.textContent).not.toContain("changes were saved");
  expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([pending]);
});
it("offers Danish manual-start controls without claiming generated steps or publication", async () => {
  await i18n.changeLanguage("da"); await mount(); expect(container.textContent).toContain("Opbyg kladdens flow");
  expect(container.textContent).toContain("Tilføj en manuel start"); expect(container.textContent).toContain("Den aktive version beholder");
  expect(workflowDraftFlowApi.save).not.toHaveBeenCalled();
});
it("keeps the pending flow request across a Source change and same-turn late acknowledgement", async () => {
  vi.mocked(workflowDraftFlowApi.review).mockResolvedValue(linear);
  let finish!: (value: Awaited<ReturnType<typeof workflowDraftFlowApi.save>>) => void;
  vi.mocked(workflowDraftFlowApi.save).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await field("name", "Wait"); await field("duration", "7"); await click("Add a step");
  const [pending] = pendingWorkflowRequests(company, principal, workflow);
  vi.mocked(workflowDraftFlowApi.review).mockImplementation(() => new Promise(() => {}));
  await act(async () => {
    live({ companyId: company, type: "analytical.context.access_lost", payload: {} });
    finish({ companyId: company, workflowId: workflow, requestId: pending.requestId, previousRevisionId: review.draftRevisionId,
      draftRevisionId: "10000000-0000-4000-8000-000000000006", version: 2, changed: true, recordedAt: review.updatedAt, published: false, executionStarted: false });
  }); await flush();
  expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([pending]);
  expect(container.textContent).not.toContain("Your changes were saved");
});
