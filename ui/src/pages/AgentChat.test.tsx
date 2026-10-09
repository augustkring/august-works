// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentChat } from "./AgentChat";
import { queryKeys } from "@/lib/queryKeys";

const state = vi.hoisted(() => ({
  companyId: "company", agentId: "agent", ensure: vi.fn(),
}));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId }) }));
vi.mock("@/hooks/useAgentChatEnabled", () => ({ useAgentChatEnabled: () => ({ enabled: true, loaded: true }) }));
vi.mock("@/lib/router", () => ({ useParams: () => ({ agentRef: state.agentId }) }));
vi.mock("@/lib/recent-agent-chats", () => ({ recordAgentChatVisit: vi.fn() }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: vi.fn() } }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: vi.fn() } }));
vi.mock("@/api/agentChats", () => ({ agentChatsApi: { get: vi.fn(), ensure: state.ensure, restart: vi.fn() } }));
// Exercise the page's real query and component lifetime. The native composer
// and source-authority behavior have separate browser/PostgreSQL coverage.
vi.mock("./IssueDetail", async () => {
  const { useState } = await import("react");
  return { TaskDetailSurface: ({ conversation }: { conversation: { issue: { id: string } | null; ensureIssue: () => Promise<unknown> } }) => {
    const [draft, setDraft] = useState("");
    return <>
      <textarea aria-label="Unsent draft" value={draft} onChange={event => setDraft(event.target.value)} />
      <button onClick={() => { void conversation.ensureIssue(); }}>Create conversation</button>
      <output>{conversation.issue?.id ?? "draft"}</output>
    </>;
  } };
});

let client: QueryClient, root: Root, container: HTMLDivElement;
const chatKey = () => queryKeys.agentChats.detail(state.companyId, "user", state.agentId);
beforeEach(() => {
  state.companyId = "company"; state.agentId = "agent";
  state.ensure.mockReset().mockResolvedValue({ id: "conversation-a" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.agents.list(state.companyId), [{ id: state.agentId, companyId: state.companyId }]);
  client.setQueryData(queryKeys.auth.session, { user: { id: "user" } });
  client.setQueryData(chatKey(), null);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><AgentChat /></QueryClientProvider>));
}
async function draft(value: string) {
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("preserves the unsent draft when its first lazy conversation is created", async () => {
  await render(); await draft("Unsent first attachment notes");
  await act(async () => container.querySelector("button")!.click());
  await vi.waitFor(() => expect(container.querySelector("output")!.textContent).toBe("conversation-a"));
  expect(container.querySelector("textarea")!.value).toBe("Unsent first attachment notes");
});
it("clears an unsent draft when the canonical conversation is replaced without an intervening error", async () => {
  client.setQueryData(chatKey(), { id: "conversation-a" });
  await render(); await draft("Private draft from retired conversation");
  await act(async () => { client.setQueryData(chatKey(), { id: "conversation-b" }); });
  await vi.waitFor(() => expect(container.querySelector("output")!.textContent).toBe("conversation-b"));
  expect(container.querySelector("textarea")!.value).toBe("");
});
it("clears an unsent draft on account change", async () => {
  client.setQueryData(chatKey(), { id: "conversation-a" });
  await render(); await draft("Private account draft");
  await act(async () => {
    client.setQueryData(queryKeys.agentChats.detail(state.companyId, "other-user", state.agentId), { id: "conversation-b" });
    client.setQueryData(queryKeys.auth.session, { user: { id: "other-user" } });
  });
  await vi.waitFor(() => expect(container.querySelector("output")!.textContent).toBe("conversation-b"));
  expect(container.querySelector("textarea")!.value).toBe("");
});
