// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowDraftStep } from "./WorkflowDraftStep";
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
async function mount() {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><WorkflowDraftStep company={company} principal={principal} workflow={workflow} node="wait" /></MemoryRouter></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function field(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#draft-step-${id}`)!;
  const proto = input.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

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
