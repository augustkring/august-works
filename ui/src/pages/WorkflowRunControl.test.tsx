// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowRunControl } from "./WorkflowRunControl";
import { workflowRunControlApi } from "../api/workflow-run-control";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { pendingWorkflowStop } from "../lib/pending-workflow-stops";
import { i18n } from "../i18n";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const view = { companyId: id(1), workflowId: id(2), runId: id(3), revisionId: id(4), updatedAt: "2026-10-13T22:00:00.000Z",
  status: "queued" as const, purpose: "live" as const, canRequestStop: true };
const receipt = (requestId: string) => ({ companyId: id(1), workflowId: id(2), runId: id(3), revisionId: id(4), requestId, disposition: "cancellation_requested" as const });
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: id(1), selectedCompany: { issuePrefix: "AW" } }) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(async () => { window.sessionStorage.clear(); await i18n.changeLanguage("en"); });
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); vi.restoreAllMocks(); });
async function mount(strict = false) {
  vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture("controller"));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture("controller"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const surface = <QueryClientProvider client={client}><MemoryRouter><WorkflowRunControl company={id(1)} principal="controller" workflow={id(2)} run={id(3)} /></MemoryRouter></QueryClientProvider>;
  await act(async () => root.render(strict ? <StrictMode>{surface}</StrictMode> : surface));
}
async function requestStop() {
  await vi.waitFor(() => expect(container.querySelector('input[type="checkbox"]')).not.toBeNull());
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Request Stop")!.click());
}
async function recover() {
  await vi.waitFor(() => expect([...container.querySelectorAll("button")].some(button => button.textContent === "Check original Stop request")).toBe(true));
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Check original Stop request")!.click());
}
it("keeps StrictMode current reads available and records one explicitly acknowledged Native Stop", async () => {
  const get = vi.spyOn(workflowRunControlApi, "get").mockResolvedValue(view);
  const stop = vi.spyOn(workflowRunControlApi, "stop").mockImplementation(async (_c, _p, _w, _r, input) => {
    get.mockResolvedValue({ ...view, status: "cancelled", canRequestStop: false }); return receipt(input.requestId);
  });
  await mount(true); await requestStop(); await vi.waitFor(() => expect(container.textContent).toContain("Stop request recorded"));
  expect(stop).toHaveBeenCalledOnce(); expect(container.textContent).toContain("does not prove that every child task or running process has stopped");
  expect(pendingWorkflowStop(id(1), "controller", id(2), id(3))).toBeNull(); expect(document.activeElement).toBe(container.querySelector("h1"));
});
it("retains a content-free locator after a lost reply and recovers by Original GET after reload", async () => {
  const get = vi.spyOn(workflowRunControlApi, "get").mockResolvedValue(view);
  const stop = vi.spyOn(workflowRunControlApi, "stop").mockRejectedValue(new Error("PRIVATE lost reply"));
  const read = vi.spyOn(workflowRunControlApi, "receipt").mockImplementation(async (_c, _p, _w, _r, requestId) => {
    get.mockResolvedValue({ ...view, status: "cancelled", canRequestStop: false }); return receipt(requestId);
  });
  await mount(); await requestStop(); await vi.waitFor(() => expect(container.textContent).toContain("This Stop request is unconfirmed"));
  const requestId = pendingWorkflowStop(id(1), "controller", id(2), id(3))!;
  expect(window.sessionStorage.getItem("aw.v9.pending-workflow-run-stop-receipts")).not.toMatch(/PRIVATE|expectedUpdatedAt|acknowledge|triggerPayload/);
  await act(async () => root.unmount()); client.clear(); container.remove(); vi.mocked(authApi.getSession).mockRestore();
  await mount(); await recover(); await vi.waitFor(() => expect(container.textContent).toContain("Stop request recorded"));
  expect(stop).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledExactlyOnceWith(id(1), "controller", id(2), id(3), requestId);
});
it("keeps a missing original Stop unconfirmed without another POST", async () => {
  vi.spyOn(workflowRunControlApi, "get").mockResolvedValue(view); const stop = vi.spyOn(workflowRunControlApi, "stop").mockRejectedValue(new Error("lost"));
  vi.spyOn(workflowRunControlApi, "receipt").mockRejectedValue(new Error("PRIVATE missing"));
  await mount(); await requestStop(); await recover();
  await vi.waitFor(() => expect(container.textContent).toContain("does not prove that no request was saved"));
  expect(pendingWorkflowStop(id(1), "controller", id(2), id(3))).not.toBeNull(); expect(stop).toHaveBeenCalledOnce(); expect(container.textContent).not.toContain("PRIVATE");
});
it("refuses new Stop when request recovery storage is corrupt", async () => {
  window.sessionStorage.setItem("aw.v9.pending-workflow-run-stop-receipts", "{corrupt");
  vi.spyOn(workflowRunControlApi, "get").mockResolvedValue(view); const stop = vi.spyOn(workflowRunControlApi, "stop");
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Request recovery is unavailable"));
  expect(container.querySelector("form")).toBeNull(); expect(stop).not.toHaveBeenCalled();
});
it("withholds a late Stop acknowledgement after account change and retains its exact locator", async () => {
  vi.spyOn(workflowRunControlApi, "get").mockResolvedValue(view); let finish!: (value: ReturnType<typeof receipt>) => void;
  vi.spyOn(workflowRunControlApi, "stop").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await requestStop(); const requestId = pendingWorkflowStop(id(1), "controller", id(2), id(3))!;
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("another-account")); finish(receipt(requestId)); });
  expect(container.textContent).not.toContain("Stop request recorded"); expect(pendingWorkflowStop(id(1), "controller", id(2), id(3))).toBe(requestId);
});
it("keeps the exact-run and completed-effect consequence in Danish", async () => {
  await i18n.changeLanguage("da"); vi.spyOn(workflowRunControlApi, "get").mockResolvedValue(view); await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("Anmod om Stop"));
  expect(container.textContent).toContain("Det pauser ikke fremtidige workflowtriggere");
});
