// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { Orchestration } from "./Orchestration";
import { orchestrationApi } from "@/api/orchestration";
const fixture = vi.hoisted(() => ({ company: "11111111-1111-4111-8111-111111111111", task: "22222222-2222-4222-8222-222222222222", breadcrumbs: vi.fn() }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: fixture.company }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: fixture.breadcrumbs }) }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("@/api/orchestration", () => ({ orchestrationApi: { list: vi.fn(async () => []), get: vi.fn(), supervision: vi.fn(async () => ({ sessions: [], signals: [], interventions: [] })), intervene: vi.fn(), create: vi.fn(), decide: vi.fn() } }));
vi.mock("@/api/issues", () => ({ issuesApi: { list: vi.fn(async () => [{ id: fixture.task, title: "Prepare the launch draft", identifier: "T-1", updatedAt: "2026-10-05T00:00:00.000Z" }]), listAcceptedPlanDecompositions: vi.fn(async () => []) } }));
vi.mock("@/api/workflows", () => ({ workflowsApi: { list: vi.fn(async () => []) } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.clearAllMocks(); });
async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["orchestration-plans", fixture.company], []);
  client.setQueryData(["orchestration-tasks", fixture.company], [{ id: fixture.task, title: "Prepare the launch draft", identifier: "T-1", updatedAt: "2026-10-05T00:00:00.000Z" }]);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<QueryClientProvider client={client}><Orchestration /></QueryClientProvider>));
}
async function setField(label: string, value: string) {
  const element = Array.from(container!.querySelectorAll("label")).find(row => row.textContent?.startsWith(label))!.querySelector("input,select")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!;
    setter.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
it("keeps a simple internal draft single-worker and preserves the selected canonical Task version", async () => {
  await render();
  await setField("Task", fixture.task); await setField("Objective", "Prepare the retained launch analysis draft"); await setField("Business invariant", "All market claims cite retained evidence");
  await setField("Independent assessment call limit", "2");
  vi.mocked(orchestrationApi.create).mockRejectedValue(new Error("Server fixture stops before dispatch"));
  await act(async () => Array.from(container!.querySelectorAll("button")).find(button => button.textContent === "Save plan")!.click());
  expect(orchestrationApi.create).toHaveBeenCalledWith(fixture.company, expect.objectContaining({ issueId: fixture.task, expectedIssueUpdatedAt: "2026-10-05T00:00:00.000Z", workload: "semantic", riskClass: "C0", budgets: expect.objectContaining({ maxWorkerCount: 1, maxParallelWorkers: 1 }), workers: [{ key: "worker", issueId: fixture.task }] }));
  expect(orchestrationApi.create).toHaveBeenCalledWith(fixture.company, expect.objectContaining({ supervisionPolicy: expect.objectContaining({ maxVerifierCalls: 2 }) }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(container!.textContent).toContain("Server fixture stops before dispatch");
});
it("raises material assurance and binds an external action to its approved exact arguments", async () => {
  await render(); await setField("Task", fixture.task); await setField("Intended action", "external_communication");
  await setField("Objective", "Send the separately approved launch announcement"); await setField("Business invariant", "Use only the explicitly approved recipient and message"); await setField("Approved action name", "send_email"); await setField("Approved arguments fingerprint", "a".repeat(64));
  vi.mocked(orchestrationApi.create).mockRejectedValue(new Error("Server fixture stops before dispatch"));
  await act(async () => Array.from(container!.querySelectorAll("button")).find(button => button.textContent === "Save plan")!.click());
  expect(orchestrationApi.create).toHaveBeenCalledWith(fixture.company, expect.objectContaining({ actionClass: "external_communication", riskClass: "C2", completionContract: expect.objectContaining({ requiredPostconditions: [{ kind: "tool_receipt", toolName: "send_email", argumentsHash: "a".repeat(64), requireApproval: true }] }) }));
});
