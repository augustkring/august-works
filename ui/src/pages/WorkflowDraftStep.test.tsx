// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowDraftStep, WorkflowDraftStepEntry } from "./WorkflowDraftStep";
import { workflowDraftEditApi } from "../api/workflow-draft-edit";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { pendingWorkflowRequests } from "../lib/pending-workflow-requests";
import { i18n } from "../i18n";

const company = "10000000-0000-4000-8000-000000000001", workflow = "10000000-0000-4000-8000-000000000002", principal = "editor";
const review = { companyId: company, workflowId: workflow, draftRevisionId: "10000000-0000-4000-8000-000000000003",
  publishedRevisionId: "10000000-0000-4000-8000-000000000004", updatedAt: "2026-10-14T00:00:00.000Z", version: 3,
  nodeId: "wait", nodeType: "core.wait", name: "Wait for review", configuration: { kind: "wait" as const, durationSeconds: 3 } };
let listeners: Array<(event: { companyId: string; type: string; payload: Record<string, unknown> }) => void>;
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (listener: typeof listeners[number]) => { listeners.push(listener); } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "10000000-0000-4000-8000-000000000001", selectedCompany: { issuePrefix: "AW" } }) }));
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(async () => {
  listeners = []; vi.restoreAllMocks(); sessionStorage.clear();
  await i18n.changeLanguage("en");
  vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture(principal));
  vi.spyOn(workflowDraftEditApi, "review").mockResolvedValue(review);
  vi.spyOn(workflowDraftEditApi, "save").mockRejectedValue(new Error("Lost acknowledgement"));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture(principal));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); sessionStorage.clear(); vi.restoreAllMocks(); });
async function mount(entry = false) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/workflows/${workflow}/draft/steps/wait`]}>
    {entry ? <Routes><Route path="/workflows/:workflowId/draft/steps/:nodeId" element={<WorkflowDraftStepEntry />} /></Routes>
      : <WorkflowDraftStep company={company} principal={principal} workflow={workflow} node="wait" />}
  </MemoryRouter></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function field(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#draft-step-${id}`)!;
  const proto = input.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("preserves an unsent step name through entry-level session and private-source rechecks", async () => {
  await mount(true); await field("name", "PRIVATE revised step");
  let finishSession!: (value: ReturnType<typeof v9SessionFixture>) => void;
  let finishRead!: (value: typeof review) => void;
  vi.mocked(authApi.getSession).mockImplementationOnce(() => new Promise(resolve => { finishSession = resolve; }));
  vi.mocked(workflowDraftEditApi.review).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  await act(async () => { void client.refetchQueries({ queryKey: queryKeys.auth.session, exact: true }); });
  expect(container.querySelector("form")).toBeNull(); expect(container.textContent).not.toContain("PRIVATE");
  await act(async () => finishSession(v9SessionFixture(principal)));
  await vi.waitFor(() => expect(finishRead).toBeTypeOf("function"));
  expect(container.querySelector("form")).toBeNull();
  await act(async () => finishRead(review));
  await vi.waitFor(() => expect(container.querySelector<HTMLInputElement>("#draft-step-name")?.value).toBe("PRIVATE revised step"));
  await field("duration", "7"); await submit();
  expect(workflowDraftEditApi.save).toHaveBeenCalledExactlyOnceWith(company, workflow, principal,
    expect.objectContaining({ name: "PRIVATE revised step", configuration: { kind: "wait", durationSeconds: 7 } }));
});
it("requires explicit review when the Native revision changes during a same-person recheck", async () => {
  await mount(true); await field("name", "PRIVATE revised step");
  vi.mocked(workflowDraftEditApi.review).mockResolvedValueOnce({ ...review,
    draftRevisionId: "10000000-0000-4000-8000-000000000005", version: 4 });
  await act(async () => { await client.refetchQueries({ queryKey: queryKeys.auth.session, exact: true }); });
  await vi.waitFor(() => expect(container.querySelector("fieldset")?.disabled).toBe(true));
  expect(container.querySelector<HTMLInputElement>("#draft-step-name")?.value).toBe("PRIVATE revised step");
  expect(workflowDraftEditApi.save).not.toHaveBeenCalled();
  const reviewLatest = [...container.querySelectorAll("button")].find(button => button.textContent === i18n.t("experience:workflowDraftStep.reviewLatest"));
  expect(reviewLatest).toBeTruthy(); await act(async () => reviewLatest!.click());
  expect(container.querySelector<HTMLInputElement>("#draft-step-name")?.value).toBe(review.name);
  expect(container.querySelector("fieldset")?.disabled).toBe(false);
});
it("recovers a hidden unsent step through the original session owner after a failed account read", async () => {
  await mount(true); await field("name", "PRIVATE revised step");
  vi.mocked(authApi.getSession).mockRejectedValueOnce(new Error("PRIVATE account failure"));
  await act(async () => { await client.refetchQueries({ queryKey: queryKeys.auth.session, exact: true }); });
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
  expect(container.querySelector("form")).toBeNull(); expect(container.textContent).not.toContain("PRIVATE");
  const retry = [...container.querySelectorAll("button")].find(button => button.textContent === "Try again");
  expect(retry).toBeTruthy(); await act(async () => retry!.click());
  await vi.waitFor(() => expect(container.querySelector<HTMLInputElement>("#draft-step-name")?.value).toBe("PRIVATE revised step"));
  expect(workflowDraftEditApi.review).toHaveBeenCalledTimes(2);
  expect(workflowDraftEditApi.save).not.toHaveBeenCalled();
});
it("discards the previous principal's unsent step when another account becomes current", async () => {
  await mount(true); await field("name", "PRIVATE revised step");
  await act(async () => client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-editor")));
  await vi.waitFor(() => expect(container.querySelector<HTMLInputElement>("#draft-step-name")?.value).toBe(review.name));
  expect(workflowDraftEditApi.review).toHaveBeenCalledWith(company, workflow, "other-editor", "wait", expect.any(AbortSignal));
  expect(workflowDraftEditApi.save).not.toHaveBeenCalled();
});

it("retains the exact scoped locator before one POST and recovers lost acknowledgement without another write after reload", async () => {
  const save = vi.mocked(workflowDraftEditApi.save);
  save.mockImplementation(async (_company, _workflow, _principal, command) => {
    expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([expect.objectContaining({ requestId: command.requestId, kind: "draft_edit" })]);
    throw new Error("Lost acknowledgement");
  });
  await mount(); await submit();
  expect(save).toHaveBeenCalledTimes(1);
  const [pending] = pendingWorkflowRequests(company, principal, workflow);
  expect(container.textContent).toContain("Check the original saved request");
  expect(container.querySelector(`a[href$="/requests/draft_edit/${pending.requestId}"]`)).not.toBeNull();
  expect(sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")).not.toContain("Wait for review");
  await act(async () => root.unmount()); root = createRoot(container); await mount();
  expect(save).toHaveBeenCalledTimes(1); expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  await submit(); expect(save).toHaveBeenCalledTimes(1);
});
it("saves a canonical separate draft receipt and reads the new version before presenting it", async () => {
  vi.mocked(workflowDraftEditApi.save).mockImplementation(async (_company, _workflow, _principal, command) => {
    vi.mocked(workflowDraftEditApi.review).mockResolvedValue({ ...review, draftRevisionId: "10000000-0000-4000-8000-000000000005", version: 4 });
    return { companyId: company, workflowId: workflow, requestId: command.requestId, previousRevisionId: command.expectedDraftRevisionId,
      draftRevisionId: "10000000-0000-4000-8000-000000000005", version: 4, changed: true, recordedAt: "2026-10-14T00:00:01.000Z", published: false, executionStarted: false };
  });
  await mount(); await submit();
  expect(container.textContent).toContain("Your changes were saved in draft version 4");
  expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([]);
  expect(workflowDraftEditApi.review).toHaveBeenCalledTimes(2);
});
it("withholds private step fields during account cache invalidation", async () => {
  await mount(); expect(container.querySelector("form")).not.toBeNull();
  vi.mocked(authApi.getSession).mockImplementation(() => new Promise(() => {}));
  await act(async () => { void client.invalidateQueries({ queryKey: queryKeys.auth.session }); });
  expect(container.querySelector("form")).toBeNull(); expect(container.textContent).not.toContain("Wait for review");
});
it("does not accept a late save acknowledgement after its account is invalidated", async () => {
  let finish!: (value: Awaited<ReturnType<typeof workflowDraftEditApi.save>>) => void;
  vi.mocked(workflowDraftEditApi.save).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await submit();
  const [pending] = pendingWorkflowRequests(company, principal, workflow);
  vi.mocked(authApi.getSession).mockImplementation(() => new Promise(() => {}));
  await act(async () => { void client.invalidateQueries({ queryKey: queryKeys.auth.session }); });
  await act(async () => finish({ companyId: company, workflowId: workflow, requestId: pending.requestId,
    previousRevisionId: review.draftRevisionId, draftRevisionId: "10000000-0000-4000-8000-000000000005", version: 4,
    changed: true, recordedAt: "2026-10-14T00:00:01.000Z", published: false, executionStarted: false }));
  expect(container.textContent).not.toContain("Your changes were saved");
  expect(container.querySelector("form")).toBeNull();
  expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([pending]);
});
it("retains its exact pending save when the Native source changes before React commits the new read epoch", async () => {
  let finish!: (value: Awaited<ReturnType<typeof workflowDraftEditApi.save>>) => void;
  vi.mocked(workflowDraftEditApi.save).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await submit(); const [pending] = pendingWorkflowRequests(company, principal, workflow);
  vi.mocked(workflowDraftEditApi.review).mockImplementation(() => new Promise(() => {}));
  await act(async () => {
    listeners.at(-1)!({ companyId: company, type: "analytical.context.access_lost", payload: {} });
    finish({ companyId: company, workflowId: workflow, requestId: pending.requestId, previousRevisionId: review.draftRevisionId,
      draftRevisionId: "10000000-0000-4000-8000-000000000005", version: 4, changed: true, recordedAt: review.updatedAt, published: false, executionStarted: false });
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([pending]);
  expect(container.textContent).not.toContain("Your changes were saved");
});
it("uses Danish labels and keeps edit settings separate from active publication", async () => {
  await i18n.changeLanguage("da"); await mount();
  expect(container.textContent).toContain("Rediger et kladdetrin"); expect(container.textContent).toContain("Ventetid (sekunder)");
  expect(container.textContent).toContain("Den aktive version beholder sine eksisterende trin");
  expect(container.querySelectorAll('h1')).toHaveLength(1);
});
it("associates invalid fields before creating a request locator, preserves valid input and focuses the summary", async () => {
  await mount(); await field("duration", "0"); await submit();
  expect(container.querySelector("#draft-step-duration")?.getAttribute("aria-invalid")).toBe("true");
  expect(container.querySelector("#draft-step-duration")?.getAttribute("aria-describedby")).toBe("draft-step-duration-error");
  expect(container.querySelector("#draft-step-duration-error")?.textContent).toContain("1 to 604800");
  expect(document.activeElement?.getAttribute("role")).toBe("alert");
  expect((container.querySelector("#draft-step-name") as HTMLInputElement).value).toBe(review.name);
  expect(workflowDraftEditApi.save).not.toHaveBeenCalled(); expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([]);
  const link = container.querySelector<HTMLAnchorElement>('a[href="#draft-step-duration"]')!;
  await act(async () => link.click()); expect(document.activeElement?.id).toBe("draft-step-duration");
  await field("duration", "7"); await submit();
  expect(workflowDraftEditApi.save).toHaveBeenCalledOnce();
});
it("presents a guided typed comparison, preserving literal whitespace and refusing a nonnumeric ordered value", async () => {
  vi.mocked(workflowDraftEditApi.review).mockResolvedValue({ ...review, nodeType: "core.condition", configuration: {
    kind: "condition", source: "trigger", path: ["amount"], operator: ">=", value: 50000,
  } });
  await mount();
  expect(container.textContent).toContain("The branches and their steps stay the same");
  await field("value", ""); await submit();
  expect(workflowDraftEditApi.save).not.toHaveBeenCalled(); expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([]);
  expect(container.querySelector("#draft-step-value")?.getAttribute("aria-invalid")).toBe("true");
  await field("value", "10000"); await submit();
  expect(workflowDraftEditApi.save).toHaveBeenCalledWith(company, workflow, principal, expect.objectContaining({ configuration: {
    kind: "condition", source: "trigger", path: ["amount"], operator: ">=", value: 10000,
  } }));
});
it("keeps exact text comparison spaces and exposes no expression field", async () => {
  vi.mocked(workflowDraftEditApi.review).mockResolvedValue({ ...review, nodeType: "core.condition", configuration: {
    kind: "condition", source: "variables", path: ["status"], operator: "===", value: " ready ",
  } });
  await mount(); expect(container.querySelector('[name="expression"]')).toBeNull(); await submit();
  expect(workflowDraftEditApi.save).toHaveBeenCalledWith(company, workflow, principal, expect.objectContaining({ configuration: {
    kind: "condition", source: "variables", path: ["status"], operator: "===", value: " ready ",
  } }));
});
it("edits only the Agent objective, validates before POST and keeps task material out of request storage", async () => {
  vi.mocked(workflowDraftEditApi.review).mockResolvedValue({ ...review, nodeType: "agent.task", configuration: {
    kind: "agent_task", objective: "PRIVATE task brief", waitForCompletion: false,
  } });
  await mount();
  expect(container.textContent).toContain("does not wait for the result");
  expect(container.textContent).toContain("Saving does not run the Agent or change its access");
  await field("objective", " "); await submit();
  expect(workflowDraftEditApi.save).not.toHaveBeenCalled(); expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([]);
  expect(container.querySelector("#draft-step-objective")?.getAttribute("aria-invalid")).toBe("true");
  await field("objective", "PRIVATE revised task\nUse approved data"); await submit();
  expect(workflowDraftEditApi.save).toHaveBeenCalledOnce();
  expect(vi.mocked(workflowDraftEditApi.save).mock.calls[0][3].configuration).toEqual({ kind: "agent_task", objective: "PRIVATE revised task\nUse approved data" });
  expect(sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")).not.toMatch(/PRIVATE|objective|approved data/);
});
it("uses current named Agent choices and sends an explicit assignment change without persisting names or task material", async () => {
  const agentId = "10000000-0000-4000-8000-000000000008";
  vi.mocked(workflowDraftEditApi.review).mockResolvedValue({ ...review, nodeType: "agent.task", configuration: {
    kind: "agent_task", objective: "PRIVATE task brief", waitForCompletion: true,
  }, agentSelection: { coverage: "bounded", selectedName: "Current analyst", choices: [{ agentId, name: "Chosen analyst" }] } });
  await mount(); expect(container.textContent).toContain("Keep Current analyst");
  const select = container.querySelector<HTMLSelectElement>("#draft-step-agentId")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, agentId); select.dispatchEvent(new Event("change", { bubbles: true })); });
  await submit();
  expect(vi.mocked(workflowDraftEditApi.save).mock.calls[0][3].configuration).toEqual({ kind: "agent_task", objective: "PRIVATE task brief", agentId });
  expect(sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")).not.toMatch(/PRIVATE|Chosen analyst|Current analyst|agentId/);
});
it("withdraws a previously selected Agent on Native invalidation and refuses it before a request locator or POST", async () => {
  const agentId = "10000000-0000-4000-8000-000000000008";
  const taskReview = { ...review, nodeType: "agent.task", configuration: { kind: "agent_task" as const, objective: "PRIVATE task", waitForCompletion: true },
    agentSelection: { coverage: "bounded" as const, selectedName: "Current analyst", choices: [{ agentId, name: "Withdrawn analyst" }] } };
  vi.mocked(workflowDraftEditApi.review).mockResolvedValue(taskReview);
  await mount(); const select = container.querySelector<HTMLSelectElement>("#draft-step-agentId")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, agentId); select.dispatchEvent(new Event("change", { bubbles: true })); });
  vi.mocked(workflowDraftEditApi.review).mockResolvedValue({ ...taskReview, agentSelection: { ...taskReview.agentSelection, choices: [] } });
  await act(async () => listeners.at(-1)!({ companyId: company, type: "activity.logged", payload: { entityType: "agent", action: "agent.updated" } }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(container.textContent).not.toContain("Withdrawn analyst");
  await submit(); expect(workflowDraftEditApi.save).not.toHaveBeenCalled(); expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([]);
  expect(container.querySelector("#draft-step-agentId")?.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement?.getAttribute("role")).toBe("alert");
});
it("withholds retained private step material while its original conversation issue is rechecked", async () => {
  await mount(); expect(container.querySelector("form")).not.toBeNull();
  vi.mocked(workflowDraftEditApi.review).mockImplementation(() => new Promise(() => {}));
  await act(async () => listeners.at(-1)!({ companyId: company, type: "activity.logged", payload: { action: "issue.updated", entityType: "issue" } }));
  expect(container.querySelector("form")).toBeNull();
  expect(workflowDraftEditApi.save).not.toHaveBeenCalled(); expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([]);
});

it("edits current scalar operation values, validates before POST, preserves false and omits an unchecked value without retaining bodies", async () => {
  const fieldDefinition = (name: string, type: "string" | "boolean" | "integer", required = false) => ({ name, label: name, help: null, type, required,
    options: null, minLength: name === "query" ? 1 : null, maxLength: null, minimum: type === "integer" ? 1 : null, maximum: type === "integer" ? 10 : null });
  vi.mocked(workflowDraftEditApi.review).mockResolvedValue({ ...review, nodeType: "connector.action", toolAccess: { state: "permission_required", connectionName: "Contact system", operationName: "Find contacts", previewHref: "/apps/10000000-0000-4000-8000-000000000001/permissions" }, configuration: { kind: "connected_tool", inputSchemaHash: "a".repeat(64),
    fields: [fieldDefinition("query", "string", true), fieldDefinition("enabled", "boolean"), fieldDefinition("count", "integer")], values: { query: "PRIVATE before", enabled: false } } });
  await mount(); expect((container.querySelector("#draft-step-tool_enabled") as HTMLSelectElement).value).toBe("false");
  expect((container.querySelector("#draft-step-tool_count") as HTMLInputElement).disabled).toBe(true);
  const includeCount = [...container.querySelectorAll("label")].find(label => label.textContent === "Include count")!.querySelector("input")!;
  await act(async () => includeCount.click()); await field("tool_count", "11"); await submit();
  expect(container.querySelector("#draft-step-tool_count")?.getAttribute("aria-invalid")).toBe("true");
  await act(async () => includeCount.click());
  expect(container.querySelector("#draft-step-tool_count-error")).toBeNull(); expect(container.textContent).not.toContain("Enter a valid value for count");
  await field("tool_query", ""); await submit();
  expect(workflowDraftEditApi.save).not.toHaveBeenCalled(); expect(pendingWorkflowRequests(company, principal, workflow)).toEqual([]);
  expect(container.querySelector("#draft-step-tool_query")?.getAttribute("aria-invalid")).toBe("true");
  await field("tool_query", " PRIVATE after "); await submit();
  expect(vi.mocked(workflowDraftEditApi.save).mock.calls[0][3].configuration).toEqual({ kind: "connected_tool", inputSchemaHash: "a".repeat(64), input: { query: " PRIVATE after ", enabled: false } });
  expect(sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")).not.toMatch(/PRIVATE|inputSchemaHash|query|enabled/);
});
