// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowRequestReceipt } from "./WorkflowRequestReceipt";
import { workflowsApi } from "../api/workflows";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { pendingWorkflowRequests, retainWorkflowRequest } from "../lib/pending-workflow-requests";
import { i18n } from "../i18n";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const locator = { companyId: id(1), workflowId: id(2), principal: "reader", kind: "test" as const, requestId: id(3) };
const receipt = { kind: "test" as const, receipt: { companyId: id(1), workflowId: id(2), requestId: id(3), runId: id(4), revisionId: id(5), purpose: "test" as const, disposition: "admitted" as const } };
let live: (event: { companyId: string; type: string; payload: Record<string, unknown> }) => void;
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: id(1), selectedCompany: { issuePrefix: "AW" } }) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (listener: typeof live) => { live = listener; } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(async () => { window.sessionStorage.clear(); retainWorkflowRequest(locator); await i18n.changeLanguage("en"); });
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); vi.restoreAllMocks(); });
async function mount(strict = false) {
  vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture("reader"));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture("reader"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const surface = <QueryClientProvider client={client}><MemoryRouter>
    <WorkflowRequestReceipt company={id(1)} principal="reader" workflow={id(2)} kind="test" requestId={id(3)} />
  </MemoryRouter></QueryClientProvider>;
  await act(async () => root.render(strict ? <StrictMode>{surface}</StrictMode> : surface));
}
it("reads the exact original request, focuses its confirmation and clears only its locator without a POST", async () => {
  vi.spyOn(workflowsApi, "requestReceipt").mockResolvedValue(receipt);
  const post = vi.spyOn(workflowsApi, "test"); await mount(true);
  await vi.waitFor(() => expect(container.textContent).toContain("Workflow request confirmed"));
  expect(container.textContent).toContain("does not describe the workflow’s current state");
  expect(document.activeElement).toBe(container.querySelector("h1"));
  expect(pendingWorkflowRequests(id(1), "reader", id(2))).toEqual([]); expect(post).not.toHaveBeenCalled();
  expect(container.querySelector('a[href$="/runs/' + id(4) + '"]')).not.toBeNull();
});
it("keeps a missing original receipt unconfirmed through explicit GET retries", async () => {
  const get = vi.spyOn(workflowsApi, "requestReceipt").mockRejectedValue(new Error("PRIVATE unavailable receipt"));
  const post = vi.spyOn(workflowsApi, "test"); await mount();
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
  await act(async () => container.querySelector("button")!.click());
  await vi.waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1));
  expect(pendingWorkflowRequests(id(1), "reader", id(2))).toEqual([locator]);
  expect(container.textContent).not.toContain("PRIVATE"); expect(post).not.toHaveBeenCalled();
});
it("withholds an old private receipt after Source withdrawal and retains its locator", async () => {
  let finish!: (value: typeof receipt) => void;
  const get = vi.spyOn(workflowsApi, "requestReceipt").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockRejectedValue(new Error("PRIVATE source lost"));
  await mount(); await vi.waitFor(() => expect(get).toHaveBeenCalled());
  await act(async () => { live({ companyId: id(1), type: "analytical.context.access_lost", payload: {} }); finish(receipt); });
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
  expect(container.textContent).not.toContain("Workflow request confirmed");
  expect(pendingWorkflowRequests(id(1), "reader", id(2))).toEqual([locator]);
});
it("does not accept an acknowledgement after the current account changes", async () => {
  let finish!: (value: typeof receipt) => void;
  vi.spyOn(workflowsApi, "requestReceipt").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("another-account")); finish(receipt); });
  expect(container.textContent).not.toContain("Workflow request confirmed");
  expect(pendingWorkflowRequests(id(1), "reader", id(2))).toEqual([locator]);
});
it("preserves admission rather than execution success in Danish", async () => {
  await i18n.changeLanguage("da"); vi.spyOn(workflowsApi, "requestReceipt").mockResolvedValue(receipt); await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("En testanmodning blev accepteret"));
  expect(container.textContent).toContain("bekræfter ikke en vellykket kørsel");
});
