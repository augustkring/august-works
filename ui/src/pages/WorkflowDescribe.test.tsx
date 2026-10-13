// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowDescribe } from "./WorkflowDescribe";
import { workflowAuthoringExperienceApi } from "../api/workflow-authoring-experience";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { readPendingWorkflowReceipt, retainPendingWorkflowReceipt } from "../lib/pending-workflow-receipts";
import i18n from "i18next";
import "../i18n";
const state = vi.hoisted(() => ({ company: "10000000-0000-4000-8000-000000000001", principal: "workflow-owner", ready: true, epoch: 0, enabled: true }));
vi.mock("../hooks/useV9CurrentAccount", async importOriginal => ({
  ...await importOriginal<typeof import("../hooks/useV9CurrentAccount")>(),
  useV9CurrentAccount: () => ({ settled: state.ready, failed: false, userId: state.principal, localImplicit: false,
    authorityEpoch: state.epoch, sessionId: `session-${state.principal}` }),
}));
vi.mock("../hooks/useV9FeatureEnabled", () => ({ useV9FeatureEnabled: () => ({ enabled: state.enabled, query: { isSuccess: true, isFetching: false } }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.company, selectedCompany: { issuePrefix: "AW" } }) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement, client: QueryClient;
const workflowId = "10000000-0000-4000-8000-000000000002", revisionId = "10000000-0000-4000-8000-000000000003";
function receipt(requestId: string) { return { companyId: state.company, workflowId, draftRevisionId: revisionId, requestId,
  createdAt: "2026-10-13T18:00:00.000Z", executionStarted: false as const, published: false as const }; }
beforeEach(async () => { state.ready = true; state.epoch = 0; state.enabled = true; state.principal = "workflow-owner"; window.sessionStorage.clear(); await i18n.changeLanguage("en"); });
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); container?.remove(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>
  <WorkflowDescribe company={state.company} principal="workflow-owner" />
</MemoryRouter></QueryClientProvider>)); }
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture(state.principal));
  client.setQueryData(queryKeys.instance.experimentalSettings, { enableWorkflowsV1: true, experience_projection_v9: true, progressive_shell_v9: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
}
async function field(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#workflow-intent-${id}`)!;
  const proto = input.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function click(name: string) {
  const button = [...container.querySelectorAll("button")].find(value => value.textContent === name);
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
it("associates invalid private intent with its field before persisting or submitting anything", async () => {
  const create = vi.spyOn(workflowAuthoringExperienceApi, "create");
  await mount(); await field("name", "Review enquiries"); await field("outcome", "PRIVATE\u0000intent"); await click("Save draft");
  await vi.waitFor(() => expect(container.querySelector("#workflow-intent-outcome")?.getAttribute("aria-invalid")).toBe("true"));
  expect(container.querySelector("#workflow-intent-outcome")?.getAttribute("aria-describedby")).toBe("workflow-intent-outcome-error");
  expect(container.querySelector("#workflow-intent-outcome-error")?.textContent).toContain("Remove unsupported control characters");
  expect(create).not.toHaveBeenCalled(); expect(readPendingWorkflowReceipt(state.company, state.principal)).toBeNull();
  await field("outcome", "Prepare a summary");
  expect(container.querySelector("#workflow-intent-outcome")?.hasAttribute("aria-invalid")).toBe(false);
});
it("saves only an explicit described draft and focuses the Original receipt", async () => {
  const create = vi.spyOn(workflowAuthoringExperienceApi, "create").mockImplementation(async (_company, _user, input) => receipt(input.requestId));
  await mount(); await field("name", "Review enquiries"); await field("outcome", "Prepare a summary"); await click("Save draft");
  await vi.waitFor(() => expect(container.textContent).toContain("Workflow draft saved"));
  expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0]![2]).toMatchObject({ name: "Review enquiries", outcome: "Prepare a summary", trigger: "", sources: "" });
  expect(document.activeElement).toBe(container.querySelector("h1"));
  expect(container.querySelector('a[href$="/workflows/' + workflowId + '"]')).not.toBeNull();
  expect(readPendingWorkflowReceipt(state.company, state.principal)).toBeNull();
});
it("recovers a lost acknowledgement across reload using one POST and Original reads only", async () => {
  const create = vi.spyOn(workflowAuthoringExperienceApi, "create").mockRejectedValue(new Error("PRIVATE-RAW-ERROR"));
  const get = vi.spyOn(workflowAuthoringExperienceApi, "receipt").mockImplementation(async (_company, _user, id) => receipt(id));
  await mount(); await field("name", "Private description"); await field("outcome", "<img src=x onerror=alert(1)> Private result"); await click("Save draft");
  await vi.waitFor(() => expect(container.textContent).toContain("draft request is unconfirmed"));
  const requestId = readPendingWorkflowReceipt(state.company, state.principal)!;
  expect(requestId).toMatch(/^[a-f0-9-]{36}$/); expect(container.querySelector("textarea")).toBeNull();
  expect(window.sessionStorage.getItem("aw.v9.pending-workflow-draft-receipts")).not.toContain("Private result");
  expect(container.textContent).not.toContain("PRIVATE-RAW-ERROR"); expect(get).not.toHaveBeenCalled();
  await act(async () => root.unmount()); root = createRoot(container); await render();
  await click("Check original request"); await vi.waitFor(() => expect(container.textContent).toContain("Workflow draft saved"));
  expect(create).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledExactlyOnceWith(state.company, state.principal, requestId);
});
it("preserves uncertainty on a missing receipt and allows recovery after rollout withdrawal", async () => {
  const requestId = crypto.randomUUID(); retainPendingWorkflowReceipt(state.company, state.principal, requestId);
  state.enabled = false;
  const get = vi.spyOn(workflowAuthoringExperienceApi, "receipt").mockRejectedValue(new Error("NOT_FOUND_PRIVATE"));
  const create = vi.spyOn(workflowAuthoringExperienceApi, "create");
  await mount(); await click("Check original request");
  await vi.waitFor(() => expect(container.textContent).toContain("does not prove that the draft was not saved"));
  expect(readPendingWorkflowReceipt(state.company, state.principal)).toBe(requestId);
  expect(container.textContent).not.toContain("NOT_FOUND_PRIVATE"); expect(create).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledTimes(1);
});
it("hides an unsent private draft during same-person account rechecks and restores it without writing", async () => {
  const create = vi.spyOn(workflowAuthoringExperienceApi, "create");
  await mount(); await field("name", "Private name"); await field("outcome", "Private intent");
  state.ready = false; state.epoch++; await render();
  expect(container.querySelector("input")).toBeNull(); expect(container.textContent).not.toContain("Private intent");
  state.ready = true; state.epoch++; await render();
  expect(container.querySelector<HTMLTextAreaElement>("#workflow-intent-outcome")?.value).toBe("Private intent");
  expect(create).not.toHaveBeenCalled();
});
it("rejects a late success across account authority loss and retains the exact request", async () => {
  let resolve!: (value: ReturnType<typeof receipt>) => void;
  const create = vi.spyOn(workflowAuthoringExperienceApi, "create").mockImplementation(() => new Promise(value => { resolve = value; }));
  await mount(); await field("name", "Late draft"); await field("outcome", "Saved outcome"); await click("Save draft");
  const requestId = readPendingWorkflowReceipt(state.company, state.principal)!;
  state.ready = false; state.epoch++; await render();
  await act(async () => resolve(receipt(requestId)));
  expect(container.textContent).not.toContain("Workflow draft saved"); expect(readPendingWorkflowReceipt(state.company, state.principal)).toBe(requestId);
  state.ready = true; state.epoch++; await render();
  await vi.waitFor(() => expect(container.textContent).toContain("draft request is unconfirmed")); expect(create).toHaveBeenCalledTimes(1);
});
it("refuses creation when content-free recovery storage is corrupt", async () => {
  window.sessionStorage.setItem("aw.v9.pending-workflow-draft-receipts", '{"outcome":"PRIVATE"}');
  const create = vi.spyOn(workflowAuthoringExperienceApi, "create"); await mount();
  expect(container.textContent).toContain("No new draft will be sent"); expect(container.textContent).not.toContain("PRIVATE");
  expect(create).not.toHaveBeenCalled(); expect(container.querySelector("form")).toBeNull();
});
it("keeps Danish fields and actions understandable without inventing a schedule", async () => {
  await i18n.changeLanguage("da"); await mount();
  expect(container.textContent).toContain("Beskriv en arbejdsgang");
  expect(container.querySelector('label[for="workflow-intent-outcome"]')?.textContent).toBe("Hvad skal den opnå?");
  expect(container.textContent).toContain("Ingen trin køres"); expect(container.textContent).toContain("Gem udkast");
});
