// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowDraftFlow, WorkflowDraftFlowEntry } from "./WorkflowDraftFlow";
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
async function mount(entry = false) { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/workflows/${workflow}/draft/flow`]}>
  {entry ? <Routes><Route path="/workflows/:workflowId/draft/flow" element={<WorkflowDraftFlowEntry />} /></Routes>
    : <WorkflowDraftFlow company={company} principal={principal} workflow={workflow} />}
</MemoryRouter></QueryClientProvider>)); await flush(); }
async function click(label: string) { const button = [...container.querySelectorAll("button")].find(button => button.textContent === label)!; expect(button).toBeTruthy(); await act(async () => button.click()); await flush(); }
async function field(id: string, value: string) { const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#draft-flow-${id}`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function choose(label: string, value: string) {
  const parent = [...container.querySelectorAll("label")].find(item => item.querySelector("span")?.textContent === label)!, select = parent.querySelector("select")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); });
}
it("retains an unsent flow step through the real entry's session and private-review recheck", async () => {
  vi.mocked(workflowDraftFlowApi.review).mockResolvedValue(linear);
  await mount(true); await field("name", "PRIVATE unsent flow step");
  let finishSession!: (value: ReturnType<typeof v9SessionFixture>) => void;
  let finishReview!: (value: typeof linear) => void;
  vi.mocked(authApi.getSession).mockImplementationOnce(() => new Promise(resolve => { finishSession = resolve; }));
  vi.mocked(workflowDraftFlowApi.review).mockImplementationOnce(() => new Promise(resolve => { finishReview = resolve; }));
  await act(async () => { void client.refetchQueries({ queryKey: queryKeys.auth.session, exact: true }); });
  expect(container.querySelector("form")).toBeNull(); expect(container.textContent).not.toContain("PRIVATE");
  await act(async () => finishSession(v9SessionFixture(principal)));
  await vi.waitFor(() => expect(finishReview).toBeTypeOf("function"));
  expect(container.querySelector("form")).toBeNull();
  await act(async () => finishReview(linear));
  await vi.waitFor(() => expect(container.querySelector<HTMLInputElement>("#draft-flow-name")?.value).toBe("PRIVATE unsent flow step"));
  expect(workflowDraftFlowApi.save).not.toHaveBeenCalled();
  expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([]);
});
it("saves only an explicit manual start, retaining one original nonce through unknown response and reload", async () => {
  await mount(); await field("deadline", "30"); await click("Add a manual start"); expect(workflowDraftFlowApi.save).toHaveBeenCalledOnce();
  expect(workflowDraftFlowApi.save).toHaveBeenCalledWith(company, workflow, principal, expect.objectContaining({ expectedLastNodeId: null, operation: { kind: "start_manual", deadlineSeconds: 30, name: "Start when I run the workflow" } }));
  const [pending] = pendingWorkflowRequests(company, principal, workflow); expect(pending.kind).toBe("draft_build");
  expect(sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")).not.toContain("Start when I run");
  expect(container.querySelector(`a[href$="/requests/draft_build/${pending.requestId}"]`)).toBeTruthy();
  await act(async () => root.unmount()); root = createRoot(container); await mount(); await click("Add a manual start");
  expect(workflowDraftFlowApi.save).toHaveBeenCalledOnce();
});
it("validates both branch outcomes and binds a chosen earlier step without exposing IDs as a field-entry requirement", async () => {
  vi.mocked(workflowDraftFlowApi.review).mockResolvedValue(linear); await mount();
  await choose("What should happen next?", "append_condition"); await field("name", "Compare amount");
  await choose("Read the value from", "steps"); await click("Add a step");
  expect(workflowDraftFlowApi.save).not.toHaveBeenCalled(); expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([]);
  expect(container.querySelector("#draft-flow-earlierNode")?.getAttribute("aria-invalid")).toBe("true");
  expect(container.querySelector("#draft-flow-trueName")?.getAttribute("aria-invalid")).toBe("true");
  await choose("Earlier step", "start"); await field("path", "amount"); await choose("Comparison", ">=");
  await choose("Type of comparison value", "number"); await field("value", "10000");
  await field("trueName", "PRIVATE matching branch"); await field("trueDuration", "1");
  await field("falseName", "PRIVATE other branch"); await field("falseDuration", "1"); await click("Add a step");
  expect(workflowDraftFlowApi.save).toHaveBeenCalledOnce();
  expect(workflowDraftFlowApi.save).toHaveBeenCalledWith(company, workflow, principal, expect.objectContaining({ expectedLastNodeId: "start",
    operation: { kind: "append_condition", name: "Compare amount", condition: { kind: "condition", source: "steps", path: ["start", "amount"], operator: ">=", value: 10000 },
      whenTrue: { name: "PRIVATE matching branch", durationSeconds: 1 }, whenFalse: { name: "PRIVATE other branch", durationSeconds: 1 } } }));
  const stored = sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")!;
  expect(stored).not.toMatch(/PRIVATE|amount|whenTrue|condition|durationSeconds/);
  expect(Object.keys(JSON.parse(stored)[0]).sort()).toEqual(["companyId", "kind", "principal", "requestId", "workflowId"]);
  await click("Add a step"); expect(workflowDraftFlowApi.save).toHaveBeenCalledOnce();
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
it("withdraws private flow names while the original conversation issue is rechecked", async () => {
  vi.mocked(workflowDraftFlowApi.review).mockResolvedValue({ ...linear, steps: [{ ...linear.steps[0], name: "PRIVATE Source step" }] });
  await mount(); expect(container.textContent).toContain("PRIVATE Source step");
  vi.mocked(workflowDraftFlowApi.review).mockImplementation(() => new Promise(() => {}));
  await act(async () => live({ companyId: company, type: "activity.logged", payload: { action: "issue.updated", entityType: "issue" } }));
  expect(container.textContent).not.toContain("PRIVATE Source step"); expect(container.querySelector("form")).toBeNull();
  expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([]);
});
it("adds an explicit named Agent task, discloses test/access limits and keeps its material out of pending storage", async () => {
  const agentId = "10000000-0000-4000-8000-000000000008";
  vi.mocked(workflowDraftFlowApi.review).mockResolvedValue({ ...linear, agentSelection: {
    coverage: "bounded", selectedName: null, choices: [{ agentId, name: "Readable task Agent" }],
  } });
  await mount(); await choose("What should happen next?", "append_agent_task"); await click("Add a step");
  expect(container.querySelector("#draft-flow-name")?.getAttribute("aria-invalid")).toBe("true");
  expect(container.querySelector("#draft-flow-agentId")?.getAttribute("aria-invalid")).toBe("true");
  expect(container.querySelector("#draft-flow-objective")?.getAttribute("aria-invalid")).toBe("true");
  expect(workflowDraftFlowApi.save).not.toHaveBeenCalled(); expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([]);
  expect(container.textContent).toContain("the internal wait/condition test cannot run them");
  await field("name", "PRIVATE Agent task"); await field("objective", "PRIVATE task brief"); await choose("Agent for this step", agentId); await click("Add a step");
  expect(workflowDraftFlowApi.save).toHaveBeenCalledOnce();
  expect(workflowDraftFlowApi.save).toHaveBeenCalledWith(company, workflow, principal, expect.objectContaining({ operation: {
    kind: "append_agent_task", name: "PRIVATE Agent task", agentId, objective: "PRIVATE task brief",
  } }));
  expect(sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")).not.toMatch(/PRIVATE|agentId|Readable task Agent|objective/);
});
it("collects explicit typed tool inputs without JSON, preserving spaces and omitting optional fields from one pending command", async () => {
  const entryId = "10000000-0000-4000-8000-000000000008", connectionId = "10000000-0000-4000-8000-000000000009";
  vi.mocked(workflowDraftFlowApi.review).mockResolvedValue({ ...linear, toolSelection: { coverage: "bounded", choices: [{ entryId, connectionId,
    connectionName: "Contacts", name: "Find contacts", versionHash: "v1", schemaHash: "s1", inputSchemaHash: "a".repeat(64), effect: "read", access: "permission_required",
    fields: [{ name: "query", label: "Search text", help: null, type: "string", required: true, options: null, minLength: 1, maxLength: null, minimum: null, maximum: null },
      { name: "count", label: "Maximum results", help: null, type: "integer", required: false, options: null, minLength: null, maxLength: null, minimum: 1, maximum: 10 }],
  }] } });
  await mount(); await choose("What should happen next?", "append_tool"); await field("name", "PRIVATE connected step"); await choose("Connection and operation", entryId);
  await click("Add a step"); expect(workflowDraftFlowApi.save).not.toHaveBeenCalled();
  expect(container.querySelector("#draft-flow-tool_query")?.getAttribute("aria-invalid")).toBe("true");
  expect(container.querySelector("#draft-flow-tool_count")?.hasAttribute("disabled")).toBe(true);
  await field("tool_query", " PRIVATE query "); await click("Add a step");
  expect(workflowDraftFlowApi.save).toHaveBeenCalledOnce();
  expect(workflowDraftFlowApi.save).toHaveBeenCalledWith(company, workflow, principal, expect.objectContaining({ operation: {
    kind: "append_tool", name: "PRIVATE connected step", entryId, connectionId, versionHash: "v1", schemaHash: "s1", inputSchemaHash: "a".repeat(64), input: { query: " PRIVATE query " },
  } }));
  expect(container.textContent).toContain("invokes no tool and grants no access");
  expect(sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")).not.toMatch(/PRIVATE|query|connectionId|schemaHash/);
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
