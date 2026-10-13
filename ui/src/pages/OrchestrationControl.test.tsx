// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrchestrationControl } from "./OrchestrationControl";
import { orchestrationControlApi } from "../api/orchestration-control";
import { authApi } from "../api/auth";
import { i18n } from "../i18n";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { queryKeys } from "../lib/queryKeys";
import { pendingOrchestrationControl } from "../lib/pending-orchestration-controls";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const account = vi.hoisted(() => ({ principal: "controller", company: "10000000-0000-4000-8000-000000000001" }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: account.principal, settled: true, localImplicit: false }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: account.company }) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const view = { companyId: id(1), planId: id(2), taskId: id(3), version: 1, status: "draft" as const, canPause: true, canStop: true };
const receipt = (requestId: string) => ({ companyId: id(1), planId: id(2), requestId, action: "cancel" as const,
  resultingVersion: 2, disposition: "control_requested" as const, propagation: "pending_verification" as const });
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(async () => { account.principal = "controller"; account.company = id(1); window.sessionStorage.clear(); await i18n.changeLanguage("en"); });
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); vi.restoreAllMocks(); });
async function mount(strict = false) {
  vi.spyOn(authApi, "getSession").mockImplementation(async () => v9SessionFixture(account.principal));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(account.principal));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const surface = <QueryClientProvider client={client}><MemoryRouter>
    <OrchestrationControl company={id(1)} principal="controller" plan={id(2)} />
  </MemoryRouter></QueryClientProvider>;
  await act(async () => root.render(strict ? <StrictMode>{surface}</StrictMode> : surface));
}
it("establishes the lifecycle fence before current private reads during StrictMode effect remount", async () => {
  vi.spyOn(orchestrationControlApi, "get").mockResolvedValue(view);
  await mount(true);
  await vi.waitFor(() => expect(container.querySelector("textarea")).toBeTruthy());
  expect(container.textContent).not.toContain("We couldn’t read the current work controls");
});
async function fill() {
  await vi.waitFor(() => expect(container.querySelector("textarea")).toBeTruthy());
  const input = container.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "PRIVATE reviewed stop rationale");
    input.dispatchEvent(new Event("input", { bubbles: true })); container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
}
async function click(label: string) {
  await vi.waitFor(() => expect([...container.querySelectorAll("button")].some(element => element.textContent === label)).toBe(true));
  const button = [...container.querySelectorAll("button")].find(element => element.textContent === label); expect(button).toBeTruthy();
  await act(async () => button!.click());
}
it("records one explicit acknowledged control and distinguishes durable admission from physical Stop", async () => {
  const get = vi.spyOn(orchestrationControlApi, "get").mockResolvedValue(view);
  const request = vi.spyOn(orchestrationControlApi, "request").mockImplementation(async (_company, _principal, _plan, input) => {
    get.mockResolvedValue({ ...view, version: 2, status: "cancelled", canPause: false, canStop: false }); return receipt(input.requestId);
  });
  await mount(); await fill(); await click("Request Stop");
  await vi.waitFor(() => expect(container.textContent).toContain("Control request recorded"));
  expect(container.textContent).toContain("does not prove that every running worker has stopped");
  expect(request).toHaveBeenCalledTimes(1); expect(container.querySelector("h1")).toBe(document.activeElement);
  expect(pendingOrchestrationControl(id(1), "controller", id(2))).toBeNull();
});
it("retains only a locator after a lost acknowledgement and recovers by Original GET after reload", async () => {
  const get = vi.spyOn(orchestrationControlApi, "get").mockResolvedValue(view);
  const request = vi.spyOn(orchestrationControlApi, "request").mockRejectedValue(new Error("PRIVATE lost response"));
  const recover = vi.spyOn(orchestrationControlApi, "receipt").mockImplementation(async (_company, _principal, _plan, requestId) => {
    get.mockResolvedValue({ ...view, version: 2, status: "cancelled", canPause: false, canStop: false }); return receipt(requestId);
  });
  await mount(); await fill(); await click("Request Stop");
  await vi.waitFor(() => expect(container.textContent).toContain("This request is unconfirmed"));
  const requestId = pendingOrchestrationControl(id(1), "controller", id(2))!;
  expect(window.sessionStorage.getItem("aw.v9.pending-orchestration-control-receipts")).not.toMatch(/PRIVATE|rationale|cancel/);
  await act(async () => root.unmount()); client.clear(); container.remove(); vi.mocked(authApi.getSession).mockRestore();
  await mount(); await click("Check original request"); await vi.waitFor(() => expect(container.textContent).toContain("Control request recorded"));
  expect(request).toHaveBeenCalledTimes(1); expect(recover).toHaveBeenCalledExactlyOnceWith(id(1), "controller", id(2), requestId);
});
it("keeps missing receipts unconfirmed and never submits another action", async () => {
  vi.spyOn(orchestrationControlApi, "get").mockResolvedValue(view);
  const request = vi.spyOn(orchestrationControlApi, "request").mockRejectedValue(new Error("lost"));
  vi.spyOn(orchestrationControlApi, "receipt").mockRejectedValue(new Error("PRIVATE missing"));
  await mount(); await fill(); await click("Request Stop"); await click("Check original request");
  await vi.waitFor(() => expect(container.textContent).toContain("does not prove that no request was saved"));
  expect(pendingOrchestrationControl(id(1), "controller", id(2))).not.toBeNull(); expect(request).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("PRIVATE missing"); expect(container.querySelector("form")).toBeNull();
});
it("blocks a new request when recovery storage is corrupted", async () => {
  window.sessionStorage.setItem("aw.v9.pending-orchestration-control-receipts", "{broken");
  vi.spyOn(orchestrationControlApi, "get").mockResolvedValue(view); const request = vi.spyOn(orchestrationControlApi, "request");
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Recovery storage is unavailable"));
  expect(container.querySelector("form")).toBeNull(); expect(request).not.toHaveBeenCalled();
});
it("withholds a late admission after account withdrawal while retaining its Original request locator", async () => {
  vi.spyOn(orchestrationControlApi, "get").mockResolvedValue(view);
  let finish!: (value: ReturnType<typeof receipt>) => void;
  vi.spyOn(orchestrationControlApi, "request").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await fill(); await click("Request Stop");
  const requestId = pendingOrchestrationControl(id(1), "controller", id(2))!;
  account.principal = "another-account";
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture(account.principal)); finish(receipt(requestId)); });
  await vi.waitFor(() => expect(container.textContent).not.toContain("Control request recorded"));
  expect(container.querySelector("textarea")).toBeNull();
  expect(pendingOrchestrationControl(id(1), "controller", id(2))).toBe(requestId);
});
it("preserves the consequence and explicit acknowledgement in Danish", async () => {
  await i18n.changeLanguage("da"); vi.spyOn(orchestrationControlApi, "get").mockResolvedValue(view);
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Anmod om Stop"));
  expect(container.textContent).toContain("Det kan ikke omgøre udførte handlinger");
  expect(container.querySelector("label")?.getAttribute("for")).toBe("orchestration-control-action");
});
