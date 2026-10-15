// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ConversationAuthoringView } from "@paperclipai/shared";
import { ConversationAuthoringProposals } from "./ConversationAuthoringProposals";
import * as authoring from "../api/conversation-authoring";
import { authApi } from "../api/auth";
import { i18n } from "../i18n";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { queryKeys } from "../lib/queryKeys";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const account = vi.hoisted(() => ({ principal: "author", company: "10000000-0000-4000-8000-000000000001" }));
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: account.principal, settled: true, localImplicit: false }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: account.company }) }));
let live: (event: { companyId: string; type: string; payload: Record<string, unknown> }) => void;
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (listener: typeof live) => { live = listener; } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const data: ConversationAuthoringView = { companyId: id(1), conversationId: id(2), agentId: id(3), generation: 0,
  observedAt: "2026-10-13T00:00:00Z", hasMore: false, modelCalled: false, proposals: [{ kind: "workflow", id: id(4), name: "Saved review draft",
    authoredRevisionId: id(5), authoredRevisionNumber: 2, currentDraftRevisionId: id(6), currentPublishedRevisionId: null,
    state: "changed", stepCount: 2, triggerCount: 1, href: `/workflows/${id(4)}` }] };
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); account.principal = "author";
  account.company = id(1); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>
  <ConversationAuthoringProposals company={id(1)} principal={account.principal} conversation={id(2)} agent={id(3)} generation={0} />
</MemoryRouter></QueryClientProvider>)); }
async function mount() {
  vi.spyOn(authApi, "getSession").mockImplementation(async () => v9SessionFixture(account.principal));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture(account.principal));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
}
it("previews saved version counts and current draft drift with only the validated domain link", async () => {
  const get = vi.spyOn(authoring, "getConversationAuthoring").mockResolvedValue(data);
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Saved review draft"));
  expect(container.textContent).toContain("Proposed version 2 · 2 steps · 1 triggers");
  expect(container.textContent).toContain("changed since this proposed version");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(`/workflows/${id(4)}`);
  expect(container.querySelectorAll("button")).toHaveLength(0);
  await act(async () => { await i18n.changeLanguage("da"); });
  expect(container.textContent).toContain("Foreslået version 2"); expect(get).toHaveBeenCalledTimes(1);
});
it("shows actual saved flow declarations and a current-version structural comparison", async () => {
  vi.spyOn(authoring, "getConversationAuthoring").mockResolvedValue({ ...data, proposals: [{ ...data.proposals[0]!, stepCount: 1, triggerCount: 0,
    preview: { id: id(5), version: 2, coverage: "complete", steps: [{ number: 1, name: "Ask before outreach", operation: "Approval",
      effect: "pure", testMode: "safe", approval: "checkpoint", retry: "none", next: [] }] },
    comparison: { state: "available", steps: [{ number: 1, change: "changed" }], removedSteps: 1,
      connectionsChanged: true, dataDefinitionChanged: false, settingsChanged: false } }] });
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Ask before outreach"));
  expect(container.textContent).toContain("No approval decision is confirmed");
  expect(container.textContent).toContain("0 added · 1 changed · 1 removed");
  expect(container.querySelectorAll("button")).toHaveLength(0);
});
it("suppresses prior proposal names and links during source withdrawal and ignores a late result for another account", async () => {
  const get = vi.spyOn(authoring, "getConversationAuthoring").mockResolvedValue(data);
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Saved review draft"));
  let release!: (value: ConversationAuthoringView) => void;
  get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => live({ companyId: id(1), type: "activity.logged", payload: { entityType: "company_membership", action: "permission.revoked" } }));
  expect(container.textContent).not.toContain("Saved review draft"); expect(container.querySelectorAll("a")).toHaveLength(0);
  account.principal = "another-account"; get.mockResolvedValue({ ...data, proposals: [] }); await render();
  await act(async () => release(data));
  await vi.waitFor(() => expect(container.textContent).not.toContain("Saved review draft"));
});
it("shows Agent setup as an owned draft reference without claiming present runtime or authority state", async () => {
  const get = vi.spyOn(authoring, "getConversationAuthoring").mockResolvedValue({ ...data, proposals: [], savedAgentDrafts: [
    { kind: "agent_setup", id: id(13), setupKind: "hire", version: 2, status: "draft", href: `/agents/hire/drafts/${id(13)}` },
  ] });
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Saved Agent setup proposals"));
  expect(container.textContent).toContain("Current saved version 2");
  expect(container.textContent).toContain("installed no package");
  expect(container.textContent).not.toContain("No saved workflow");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(`/agents/hire/drafts/${id(13)}`);
  expect(container.querySelectorAll("button")).toHaveLength(0);
  await act(async () => { await i18n.changeLanguage("da"); });
  expect(container.textContent).toContain("Aktuel gemt version 2");
  let release!: (value: ConversationAuthoringView) => void;
  get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => live({ companyId: id(1), type: "activity.logged", payload: { entityType: "agent_configuration_draft", action: "agent_configuration.draft_discarded" } }));
  expect(container.querySelectorAll("a")).toHaveLength(0);
  await act(async () => release({ ...data, proposals: [], savedAgentDrafts: [] }));
  await vi.waitFor(() => expect(container.textContent).not.toContain("Aktuel gemt version 2"));
});
it("reports an empty recorded set without treating a model's suggested link as a saved proposal", async () => {
  vi.spyOn(authoring, "getConversationAuthoring").mockResolvedValue({ ...data, proposals: [] });
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("suggested link alone"));
  expect(container.querySelectorAll("a")).toHaveLength(0);
});

it("shows current saved task state in both languages and suppresses it immediately on task changes", async () => {
  const get = vi.spyOn(authoring, "getConversationAuthoring").mockResolvedValue({ ...data, proposals: [], hasMoreTasks: false,
    savedTasks: [{ kind: "task", id: id(7), title: "Saved for later research", titleTruncated: false,
      status: "backlog", statusVersion: 1, executionStarted: false, href: `/issues/${id(7)}` }] });
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Saved for later research"));
  expect(container.textContent).toContain("no recorded execution start");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(`/issues/${id(7)}`);
  expect(container.querySelectorAll("button")).toHaveLength(0);
  await act(async () => { await i18n.changeLanguage("da"); });
  expect(container.textContent).toContain("ikke registreret en kørselsstart");
  let release!: (value: ConversationAuthoringView) => void;
  get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => live({ companyId: id(1), type: "activity.logged", payload: { entityType: "issue", entityId: id(7), action: "issue.updated" } }));
  expect(container.textContent).not.toContain("Saved for later research");
  expect(container.querySelectorAll("a")).toHaveLength(0);
  await act(async () => release({ ...data, proposals: [], savedTasks: [], hasMoreTasks: false }));
});
it("shows an unconfigured routine and a Human revision without declaring a run or permission grant", async () => {
  vi.spyOn(authoring, "getConversationAuthoring").mockResolvedValue({ ...data, proposals: [], savedTasks: [], hasMoreTasks: false,
    savedRoutines: [{ kind: "routine", id: id(8), title: "Saved weekly routine", authoredRevisionId: id(9), authoredRevisionNumber: 1,
      currentRevisionId: id(10), currentRevisionNumber: 2, status: "paused", executionConfigured: false, triggerCount: 0,
      enabledTriggerCount: 0, href: `/routines/${id(8)}` }], hasMoreRoutines: false });
  await mount(); await vi.waitFor(() => expect(container.textContent).toContain("Saved weekly routine"));
  expect(container.textContent).toContain("no execution target is configured");
  expect(container.textContent).toContain("changed since this conversation draft");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(`/routines/${id(8)}`);
  expect(container.querySelectorAll("button")).toHaveLength(0);
  await act(async () => { await i18n.changeLanguage("da"); });
  expect(container.textContent).toContain("Der er ikke valgt et kørselsmål");
});

it("shows pending Foundation review in English and Danish and hides it on source changes",async()=>{
  const snapshot:ConversationAuthoringView={...data,proposals:[],savedTasks:[],hasMoreTasks:false,savedRoutines:[],hasMoreRoutines:false,
    savedFoundationProposals:[{kind:"foundation_proposal",id:id(11),foundationDocumentId:id(12),title:"Saved policy proposal",
      baseRevisionId:id(13),currentRevisionId:id(14),status:"pending",href:`/foundation/${id(12)}`}],hasMoreFoundationProposals:false};
  const get=vi.spyOn(authoring,"getConversationAuthoring").mockResolvedValue(snapshot);
  await mount();await vi.waitFor(()=>expect(container.textContent).toContain("Saved policy proposal"));
  expect(container.textContent).toContain("awaits Human review");expect(container.textContent).toContain("revision has changed");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(`/foundation/${id(12)}`);
  expect(container.querySelectorAll("button")).toHaveLength(0);
  await act(async()=>{await i18n.changeLanguage("da");});
  expect(container.textContent).toContain("afventer gennemgang");
  let release!:(value:ConversationAuthoringView)=>void;get.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  await act(async()=>live({companyId:id(1),type:"activity.logged",payload:{entityType:"foundation_change_proposal",entityId:id(11),action:"foundation.proposal_rejected"}}));
  expect(container.textContent).not.toContain("Saved policy proposal");expect(container.querySelectorAll("a")).toHaveLength(0);
  await act(async()=>release({...snapshot,savedFoundationProposals:[]}));
});
