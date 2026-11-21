// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { SidebarAgentChats } from "./SidebarAgentChats";
import { queryKeys } from "@/lib/queryKeys";

const state = vi.hoisted(() => ({ companyId: "company-a", navigate: vi.fn(), closeSidebar: vi.fn(), list: vi.fn(), getPreferred: vi.fn(), setPreferred: vi.fn() }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId }) }));
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: true, setSidebarOpen: state.closeSidebar }) }));
vi.mock("@/lib/router", () => ({ useLocation: () => ({ pathname: "/A/dashboard" }), useNavigate: () => state.navigate }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: state.list } }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: () => ({ user: { id: "user-a" } }) } }));
vi.mock("@/api/sidebarPreferences", () => ({ sidebarPreferencesApi: {
  getPreferredCoworker: state.getPreferred,
  updatePreferredCoworker: state.setPreferred,
} }));
vi.mock("@/hooks/useResourceMemberships", () => ({
  useResourceMemberships: () => ({ data: { starredAgentIds: [] } }),
  useResourceMembershipMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock("./AgentChatSidebar", () => ({ AgentChatSidebar: ({ onOpenChat }: { onOpenChat: () => void }) => <button onClick={onOpenChat}>Chat with an agent</button> }));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const agent = (id: string, companyId: string) => ({ id, companyId, name: id, urlKey: id, role: "engineer", title: "Engineer", icon: null, status: "idle" } as Agent);
async function render(enabled = true) {
  await act(async () => { root.render(<QueryClientProvider client={client}><SidebarAgentChats enabled={enabled} /></QueryClientProvider>); });
}
async function openPicker() {
  await act(async () => container.querySelector("button")!.click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  state.companyId = "company-a";
  state.navigate.mockClear();
  state.closeSidebar.mockClear();
  state.list.mockImplementation(async (companyId: string) => companyId === "company-a"
    ? [agent("alice", "company-a"), agent("never-visited", "company-a")]
    : [agent("bob", "company-b")]);
  state.getPreferred.mockResolvedValue({ agentId: null, updatedAt: null });
  state.setPreferred.mockImplementation(async (_company: string, input: { agentId: string | null }) => ({ agentId: input.agentId, updatedAt: null }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.auth.session, { user: { id: "user-a" } });
  client.setQueryData(queryKeys.agents.list("company-a"), [agent("alice", "company-a"), agent("never-visited", "company-a")]);
  client.setQueryData(queryKeys.agents.list("company-b"), [agent("bob", "company-b")]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

describe("SidebarAgentChats", () => {
  it("opens an unvisited agent from the full roster and closes the mobile sidebar", async () => {
    await render();
    await openPicker();
    const options = [...document.querySelectorAll<HTMLElement>("[role=option]")];
    expect(options).toHaveLength(2);
    await act(async () => options.find((item) => item.textContent?.includes("never-visited"))!.click());
    expect(state.navigate).toHaveBeenCalledWith("/chats/never-visited");
    expect(state.closeSidebar).toHaveBeenCalledWith(false);
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("drops the open picker across company and user changes", async () => {
    await render();
    await openPicker();
    state.companyId = "company-b";
    await render();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await openPicker();
    const options = [...document.querySelectorAll("[role=option]")];
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("bob");
    await act(async () => {
      client.setQueryData(queryKeys.auth.session, { user: { id: "user-b" } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector("[role=dialog]")).toBeNull();
    state.companyId = "company-a";
    await render();
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("saves a company-specific preferred Co-worker and routes Ask Blentera to it", async () => {
    await render();
    await openPicker();
    const preference = document.querySelector<HTMLSelectElement>("#preferred-coworker")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(preference, "alice");
      preference.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(state.setPreferred).toHaveBeenCalledWith("company-a", { agentId: "alice" });
    state.getPreferred.mockResolvedValue({ agentId: "alice", updatedAt: null });
    await act(async () => {
      document.dispatchEvent(new Event("paperclip:ask-generalist"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(state.navigate).toHaveBeenCalledWith("/chats/alice");
  });

  it("opens the Co-worker chooser for Ask Blentera when no preference is saved", async () => {
    await render();
    await act(async () => document.dispatchEvent(new Event("paperclip:ask-generalist")));
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
  });

  it("keeps chat feature gating in place and falls back to the command palette", async () => {
    const openCommand = vi.fn();
    document.addEventListener("paperclip:open-command", openCommand);
    state.list.mockClear();
    await render(false);
    await act(async () => document.dispatchEvent(new Event("paperclip:ask-generalist")));
    expect(openCommand).toHaveBeenCalledOnce();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.list).not.toHaveBeenCalled();
    document.removeEventListener("paperclip:open-command", openCommand);
  });
});
