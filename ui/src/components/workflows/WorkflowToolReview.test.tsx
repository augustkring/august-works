// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { Approval, LiveEvent, WorkflowRunDetail } from "@paperclipai/shared";
import { WorkflowToolReview } from "./WorkflowToolReview";
import { workflowsApi } from "../../api/workflows";
import { approvalsApi } from "../../api/approvals";
import { ApiError } from "../../api/client";
import { queryKeys } from "../../lib/queryKeys";
import { v9SessionFixture } from "../../hooks/v9-session.test-support";
import { i18n } from "../../i18n";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const context = vi.hoisted(() => ({ principal: "reviewer", company: "company", live: null as null | ((event: LiveEvent) => void) }));
vi.mock("../../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: context.principal, settled: true, localImplicit: false }) }));
vi.mock("../../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: context.company, selectedCompany: { issuePrefix: "AW" } }) }));
vi.mock("../../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (f: (event: LiveEvent) => void) => { context.live = f; } }));
const result = { canReview: true, reviews: [{ id: "request", nodeId: "step", toolName: "PRIVATE Current action", status: "pending", risk: "write", preview: "PRIVATE exact arguments", argumentsSummary: null, approvalId: null, expiresAt: null }] };
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove(); client?.clear(); context.principal = "reviewer"; context.company = "company"; context.live = null;
  window.sessionStorage.clear();
  await i18n.changeLanguage("en"); vi.restoreAllMocks();
});
async function render(checkpoint?: { approvalId: string; nodeId: string; workflowId: string; revisionId: string }) {
  if (!container?.isConnected) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity });
    client.setQueryData(queryKeys.auth.session, v9SessionFixture(context.principal));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  }
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><WorkflowToolReview companyId="company" runId="run" attemptId="attempt" nodeId={checkpoint ? `approval:${checkpoint.approvalId}` : "step"} checkpoint={checkpoint} /></MemoryRouter></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
function button(label: string) { return [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label)!; }
it("binds reads and an explicit one-time decision to the displayed account", async () => {
  const read = vi.spyOn(workflowsApi, "toolReviews").mockResolvedValue(result);
  const write = vi.spyOn(workflowsApi, "resolveToolReview").mockResolvedValue({} as WorkflowRunDetail);
  await render(); expect(container.textContent).toContain("PRIVATE Current action");
  const currentKey = ["workflow-run-experience", "company", "reviewer", "workflow", "run"];
  const otherKey = ["workflow-run-experience", "company", "other", "workflow", "run"];
  client.setQueryDefaults(currentKey, { gcTime: Infinity }); client.setQueryDefaults(otherKey, { gcTime: Infinity });
  client.setQueryData(currentKey, {}); client.setQueryData(otherKey, {});
  expect(read).toHaveBeenCalledWith("company", "run", "reviewer", expect.any(AbortSignal));
  await act(async () => button("Approve action").click());
  expect(write).toHaveBeenCalledExactlyOnceWith("company", "run", "request", "approve", "reviewer");
  expect(client.getQueryState(currentKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
});
it("keeps an unknown decision locked through status reads and never exposes raw errors", async () => {
  vi.spyOn(workflowsApi, "toolReviews").mockResolvedValue(result);
  const write = vi.spyOn(workflowsApi, "resolveToolReview").mockRejectedValue(new Error("SECRET provider response"));
  await render(); await act(async () => button("Approve action").click());
  expect(container.textContent).toContain("Your decision is unconfirmed"); expect(container.textContent).not.toContain("SECRET");
  expect(button("Approve action").disabled).toBe(true); expect(button("Reject action").disabled).toBe(true);
  await act(async () => button("Check current status").click());
  expect(button("Approve action").disabled).toBe(true); expect(write).toHaveBeenCalledTimes(1);
});
it("hides retained private arguments while the session is unresolved", async () => {
  vi.spyOn(workflowsApi, "toolReviews").mockResolvedValue(result);
  const write = vi.spyOn(workflowsApi, "resolveToolReview");
  await render(); const approve = button("Approve action");
  await act(async () => { client.invalidateQueries({ queryKey: queryKeys.auth.session, exact: true, refetchType: "none" }); approve.click(); });
  expect(container.textContent).not.toContain("PRIVATE"); expect(write).not.toHaveBeenCalled();
});
it("rejects a late old-account read after an account change", async () => {
  let resolve!: (value: typeof result) => void;
  vi.spyOn(workflowsApi, "toolReviews").mockImplementation(() => new Promise(r => { resolve = r; }));
  await render(); const oldResolve = resolve;
  context.principal = "different";
  await act(async () => client.setQueryData(queryKeys.auth.session, v9SessionFixture("different")));
  await render(); await act(async () => oldResolve(result));
  expect(container.textContent).not.toContain("PRIVATE");
});
it.each(["permission.revoked", "approval.approved"])("withdraws private content immediately on a Native %s event", async action => {
  let resolve!: (value: typeof result) => void;
  vi.spyOn(workflowsApi, "toolReviews").mockResolvedValueOnce(result).mockImplementation(() => new Promise(r => { resolve = r; }));
  await render();
  await act(async () => context.live!({ id: 1, createdAt: "2026-10-15T00:00:00Z", type: "activity.logged", companyId: "company", payload: { action, entityType: action.startsWith("approval") ? "approval" : "agent" } } as LiveEvent));
  expect(container.textContent).not.toContain("PRIVATE");
  await act(async () => resolve({ canReview: false, reviews: [] }));
  expect(button("Approve action")).toBeUndefined();
});
it("renders Danish controls and does not equate an absent request with success", async () => {
  await i18n.changeLanguage("da"); vi.spyOn(workflowsApi, "toolReviews").mockResolvedValue({ canReview: false, reviews: [] });
  await render(); expect(button("Kontrollér aktuel status")).toBeDefined();
  expect(container.textContent).toContain("Se kørslen for resultatet"); expect(button("Godkend handling")).toBeUndefined();
});

it("retains an unknown Original decision across the customer run surface remount", async () => {
  vi.spyOn(workflowsApi, "toolReviews").mockResolvedValue(result);
  const write = vi.spyOn(workflowsApi, "resolveToolReview").mockRejectedValue(new Error("Lost reply"));
  await render(); await act(async () => button("Approve action").click());
  await act(async () => root.unmount()); container.remove(); client.clear();
  await render();
  expect(container.textContent).toContain("Your decision is unconfirmed");
  expect(button("Approve action").disabled).toBe(true);
  expect(button("Reject action").disabled).toBe(true);
  await act(async () => button("Check current status").click());
  expect(write).toHaveBeenCalledTimes(1);
});
it("refuses dispatch when an unknown-outcome locator cannot be retained", async () => {
  vi.spyOn(workflowsApi, "toolReviews").mockResolvedValue(result);
  const write = vi.spyOn(workflowsApi, "resolveToolReview");
  await render();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  await act(async () => button("Approve action").click());
  expect(write).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Storage unavailable");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

it("reconciles only an observed Original state and restores focus after a readonly status check", async () => {
  const read = vi.spyOn(workflowsApi, "toolReviews").mockResolvedValue(result);
  const write = vi.spyOn(workflowsApi, "resolveToolReview").mockRejectedValue(new Error("Lost reply"));
  await render(); await act(async () => button("Approve action").click());
  read.mockResolvedValue({ ...result, reviews: [{ ...result.reviews[0], status: "approved" }] });
  await act(async () => button("Check current status").click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(container.textContent).toContain("Approved; execution is not yet confirmed");
  expect(container.textContent).not.toContain("Your decision is unconfirmed");
  expect(button("Approve action")).toBeUndefined();
  expect(document.activeElement).toBe(button("Check current status"));
  expect(write).toHaveBeenCalledTimes(1);
});

const checkpoint = { nodeId: "checkpoint-step", approvalId: "10000000-0000-4000-8000-000000000010", workflowId: "workflow", revisionId: "revision" };
function approval(): Approval { return { id: checkpoint.approvalId, companyId: "company", type: "workflow_step_approval", status: "pending", reviewHash: "a".repeat(64),
  requestedByAgentId: null, requestedByUserId: "reviewer", decisionNote: null, decidedByUserId: null, decidedAt: null, createdAt: new Date(), updatedAt: new Date(),
  payload: { workflowNodeId: "checkpoint-step", workflowId: "workflow", workflowRevisionId: "revision", workflowRunId: "run", summary: "Exact Native checkpoint", consequence: "Continue the reviewed revision", privateKey: "SECRET excluded material" } }; }
it("settles a Human checkpoint through its Original owner with exact account and revision binding", async () => {
  const original = approval();
  const read = vi.spyOn(approvalsApi, "get").mockResolvedValue(original);
  const approve = vi.spyOn(approvalsApi, "approve").mockImplementation(async () => { const value = { ...original, status: "approved" as const }; read.mockResolvedValue(value); return value; });
  const tools = vi.spyOn(workflowsApi, "resolveToolReview");
  await render(checkpoint);
  expect(container.textContent).toContain("Exact Native checkpoint"); expect(container.textContent).not.toContain("SECRET");
  await act(async () => button("Approve step").click());
  expect(approve).toHaveBeenCalledExactlyOnceWith(checkpoint.approvalId, undefined, "reviewer", "a".repeat(64)); expect(tools).not.toHaveBeenCalled();
});
it.each(["workflowId", "workflowRunId", "workflowRevisionId", "workflowNodeId"])("refuses an approval with mismatched %s before offering a decision", async field => {
  const value = approval(); value.payload[field] = "another-source";
  vi.spyOn(approvalsApi, "get").mockResolvedValue(value);
  const approve = vi.spyOn(approvalsApi, "approve");
  await render(checkpoint);
  expect(container.textContent).not.toContain("Exact Native checkpoint"); expect(button("Approve step")).toBeUndefined(); expect(approve).not.toHaveBeenCalled();
});
it("keeps a lost Human approval reply locked while inspecting the Original pending state", async () => {
  vi.spyOn(approvalsApi, "get").mockResolvedValue(approval());
  const approve = vi.spyOn(approvalsApi, "approve").mockRejectedValue(new Error("SECRET unknown reply"));
  await render(checkpoint); await act(async () => button("Approve step").click());
  await act(async () => button("Check current status").click());
  expect(button("Approve step").disabled).toBe(true); expect(button("Reject step").disabled).toBe(true);
  expect(container.textContent).not.toContain("SECRET"); expect(approve).toHaveBeenCalledTimes(1);
});

it("refreshes an explicitly refused changed checkpoint without replaying its decision", async () => {
  const value = approval();
  vi.spyOn(approvalsApi, "get").mockResolvedValue(value);
  const write = vi.spyOn(approvalsApi, "approve").mockRejectedValue(new ApiError("Changed review", 409, { details: { code: "approval_review_changed" } }));
  await render(checkpoint); await act(async () => button("Approve step").click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(container.textContent).toContain("The approval changed");
  expect(button("Approve step").disabled).toBe(false);
  expect(write).toHaveBeenCalledTimes(1);
});

it.each([false, true])("withdraws private review data on an explicit Native account refusal (checkpoint=%s)", async human => {
  const refusal = new ApiError("Account changed", 409, { details: { code: "ACCOUNT_CHANGED" } });
  if (human) {
    vi.spyOn(approvalsApi, "get").mockResolvedValue(approval());
    vi.spyOn(approvalsApi, "approve").mockRejectedValue(refusal);
  } else {
    vi.spyOn(workflowsApi, "toolReviews").mockResolvedValue(result);
    vi.spyOn(workflowsApi, "resolveToolReview").mockRejectedValue(refusal);
  }
  await render(human ? checkpoint : undefined);
  await act(async () => button(human ? "Approve step" : "Approve action").click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(container.textContent).not.toContain(human ? "Exact Native checkpoint" : "PRIVATE Current action");
  expect(client.getQueryState(queryKeys.auth.session)?.isInvalidated).toBe(true);
  expect(Object.keys(sessionStorage).some(key => key.startsWith("aw.v9.workflow-tool-decision:"))).toBe(false);
});
