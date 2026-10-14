// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowAuthoringHandoff } from "./WorkflowAuthoringHandoff";
import { workflowAuthoringExperienceApi } from "../api/workflow-authoring-experience";
import { api } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import i18n from "i18next";
import "../i18n";
const state = vi.hoisted(() => ({ company: "10000000-0000-4000-8000-000000000001", principal: "author-owner", ready: true, epoch: 0, enabled: true, localImplicit: false }));
vi.mock("../hooks/useV9CurrentAccount", async original => ({ ...await original<typeof import("../hooks/useV9CurrentAccount")>(),
  useV9CurrentAccount: () => ({ settled: state.ready, failed: false, userId: state.principal, localImplicit: state.localImplicit,
    authorityEpoch: state.epoch, sessionId: `session-${state.principal}` }) }));
vi.mock("../hooks/useV9FeatureEnabled", () => ({ useV9FeatureEnabled: () => ({ enabled: state.enabled, query: { isFetching: false } }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.company, selectedCompany: { issuePrefix: "AW" } }) }));
let live: (event: { companyId: string; type: string; payload: Record<string, unknown> }) => void;
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (listener: typeof live) => { live = listener; } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const workflow = "10000000-0000-4000-8000-000000000002", revision = "10000000-0000-4000-8000-000000000003", agent = "10000000-0000-4000-8000-000000000004";
const view = () => ({ companyId: state.company, workflowId: workflow, draftRevisionId: revision, publishedRevisionId: null,
  observedAt: "2026-10-14T12:00:00Z", coverage: "bounded" as const, enabled: true, choices: [{ agentId: agent, name: "PRIVATE Agent name" }] });
let root: Root, host: HTMLDivElement, client: QueryClient;
type Options = Partial<Parameters<typeof WorkflowAuthoringHandoff>[0]>;
async function render(options: Options = {}) { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>
  <WorkflowAuthoringHandoff company={state.company} principal="author-owner" workflow={workflow} {...options} />
</MemoryRouter></QueryClientProvider>)); }
async function mount(options: Options = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(state.principal));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); await render(options);
}
async function click(text: string) { const button = [...host.querySelectorAll("button")].find(item => item.textContent === text); expect(button).toBeTruthy(); await act(async () => button!.click()); }
beforeEach(async () => { state.ready = true; state.epoch = 0; state.enabled = true; state.localImplicit = false; state.principal = "author-owner"; await i18n.changeLanguage("en"); });
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); client?.clear(); vi.restoreAllMocks(); });
it("opens only the selected current Agent conversation using body-free exact draft locators", async () => {
  vi.spyOn(workflowAuthoringExperienceApi, "authors").mockResolvedValue(view()); const post = vi.spyOn(api, "post");
  await mount(); await vi.waitFor(() => expect(host.querySelector("select")).not.toBeNull());
  expect(host.querySelector('a[href*="/chats/"]')).toBeNull();
  await act(async () => { const select = host.querySelector("select")!; select.value = agent; select.dispatchEvent(new Event("change", { bubbles: true })); });
  const link = host.querySelector<HTMLAnchorElement>('a[href*="/chats/"]')!;
  expect(link.getAttribute("href")).toBe(`/AW/chats/${agent}?workflowDraft=${workflow}&draftRevision=${revision}`);
  expect(link.href).not.toContain("PRIVATE"); expect(post).not.toHaveBeenCalled();
});
it("prepares an explicit Danish request without dispatch, names or copied private workflow content", async () => {
  await i18n.changeLanguage("da"); vi.spyOn(workflowAuthoringExperienceApi, "authors").mockResolvedValue(view());
  const insert = vi.fn().mockReturnValue(true), post = vi.spyOn(api, "post");
  await mount({ agent, expectedRevision: revision, onInsert: insert });
  await vi.waitFor(() => expect(host.textContent).toContain("Forbered anmodning")); expect(insert).not.toHaveBeenCalled();
  await click("Forbered anmodning"); expect(insert).toHaveBeenCalledTimes(1);
  const message = insert.mock.calls[0]![0] as string;
  expect(message).toContain(`/AW/workflows/${workflow}?revision=draft&expectedDraftRevisionId=${revision}`);
  expect(message).toContain("gemte workflow-udkast"); expect(message).not.toMatch(/PRIVATE|grant|sourceActor|adapter/);
  expect(host.textContent).toContain("Anmodningen blev lagt i beskedfeltet"); expect(post).not.toHaveBeenCalled();
  expect(host.querySelector("button")!.disabled).toBe(true);
});
it("keeps a changed draft and a withdrawn Agent unavailable instead of preparing a different request", async () => {
  const read = vi.spyOn(workflowAuthoringExperienceApi, "authors").mockResolvedValue(view()), insert = vi.fn();
  await mount({ agent, expectedRevision: agent, onInsert: insert });
  await vi.waitFor(() => expect(host.textContent).toContain("This draft has changed")); expect(host.querySelector("button")).toBeNull();
  read.mockResolvedValue({ ...view(), choices: [] });
  await act(async () => live({ companyId: state.company, type: "activity.logged", payload: { action: "permission.revoked", entityType: "agent" } }));
  await render({ agent, expectedRevision: revision, onInsert: insert });
  await vi.waitFor(() => expect(host.textContent).toContain("No Agent is offered here")); expect(insert).not.toHaveBeenCalled();
});
it("rejects late author metadata after a private Source change", async () => {
  let resolve!: (value: ReturnType<typeof view>) => void;
  vi.spyOn(workflowAuthoringExperienceApi, "authors").mockImplementationOnce(() => new Promise(done => { resolve = done; }))
    .mockResolvedValue({ ...view(), choices: [] });
  await mount(); await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  await act(async () => live({ companyId: state.company, type: "activity.logged", payload: { action: "conversation.hidden", entityType: "issue" } }));
  await act(async () => resolve(view()));
  await vi.waitFor(() => expect(host.textContent).toContain("No Agent is offered here"));
  expect(host.textContent).not.toContain("PRIVATE Agent name"); expect(host.querySelector("select")).toBeNull();
});
it("withdraws cached names and actions during a same-account authority recheck", async () => {
  vi.spyOn(workflowAuthoringExperienceApi, "authors").mockResolvedValue(view()); await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("PRIVATE Agent name"));
  state.ready = false; state.epoch++; await render();
  expect(host.textContent).not.toContain("PRIVATE Agent name"); expect(host.querySelector("select")).toBeNull();
});
it("does not announce an inserted request when the Native composer is unavailable", async () => {
  vi.spyOn(workflowAuthoringExperienceApi, "authors").mockResolvedValue(view()); const insert = vi.fn().mockReturnValue(false);
  await mount({ agent, expectedRevision: revision, onInsert: insert }); await vi.waitFor(() => expect(host.textContent).toContain("Prepare request"));
  await click("Prepare request"); expect(host.textContent).toContain("The message field is not ready");
  expect(host.textContent).not.toContain("The request was added to the message field");
});
it("keeps the handoff absent when its rollout is disabled and requires a verified account", async () => {
  const read = vi.spyOn(workflowAuthoringExperienceApi, "authors"); state.enabled = false; await mount();
  expect(host.textContent).toBe(""); expect(read).not.toHaveBeenCalled();
  state.enabled = true; state.localImplicit = true; await render();
  expect(host.textContent).toContain("account"); expect(host.querySelector("select")).toBeNull(); expect(read).not.toHaveBeenCalled();
});
it("keeps a mounted surface's own read when another same-draft surface unmounts", async () => {
  const pending: Array<(value: ReturnType<typeof view>) => void> = [];
  vi.spyOn(workflowAuthoringExperienceApi, "authors").mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); client.setQueryData(queryKeys.auth.session, v9SessionFixture(state.principal));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const draw = async (first: boolean) => act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>
    {first && <WorkflowAuthoringHandoff key="first" company={state.company} principal={state.principal} workflow={workflow} />}
    <WorkflowAuthoringHandoff key="second" company={state.company} principal={state.principal} workflow={workflow} />
  </MemoryRouter></QueryClientProvider>));
  await draw(true); await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
  await draw(false); await act(async () => { for (const resolve of pending) resolve(view()); });
  await vi.waitFor(() => expect(host.querySelectorAll("select")).toHaveLength(1));
  expect(host.textContent).toContain("PRIVATE Agent name"); expect(host.textContent).not.toContain("Could not check");
});
