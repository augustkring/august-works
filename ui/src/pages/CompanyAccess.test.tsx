// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { v9SessionFixture } from "@/hooks/v9-session.test-support";
import { CompanyAccess, CompanyAccessLegacyRoute } from "./CompanyAccess";

const pushToastMock = vi.hoisted(() => vi.fn());
const approveJoinRequestMock = vi.hoisted(() => vi.fn());
const rejectJoinRequestMock = vi.hoisted(() => vi.fn());
const companyState = vi.hoisted(() => ({ id: "company-1" }));

vi.mock("@/api/auth", () => ({ authApi: { getSession: async () => v9SessionFixture("user-1") } }));

beforeEach(() => {
  companyState.id = "company-1";
  approveJoinRequestMock.mockResolvedValue({});
  rejectJoinRequestMock.mockResolvedValue({});
});

const listMembersMock = vi.hoisted(() => vi.fn());
const listWorkflowCoveragesMock = vi.hoisted(() => vi.fn());
const listJoinRequestsMock = vi.hoisted(() => vi.fn());
const updateMemberMock = vi.hoisted(() => vi.fn());
const archiveMemberMock = vi.hoisted(() => vi.fn());
const securitySuspendMemberMock = vi.hoisted(() => vi.fn());
const listAgentsMock = vi.hoisted(() => vi.fn());
const listIssuesMock = vi.hoisted(() => vi.fn());
const listRoutinesMock = vi.hoisted(() => vi.fn());
const mockUsePluginSlots = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const listInvitesMock = vi.hoisted(() => vi.fn());
const listCloudStacksMock = vi.hoisted(() => vi.fn());
const mockSearchParamsState = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock("@/api/cloud", () => ({
  cloudApi: { listStacks: listCloudStacksMock },
}));

vi.mock("@/api/access", () => ({
  accessApi: {
    listWorkflowCoverages: (...args: unknown[]) => listWorkflowCoveragesMock(...args),
    listMembers: (companyId: string) => listMembersMock(companyId),
    listJoinRequests: (companyId: string, status: string) => listJoinRequestsMock(companyId, status),
    updateMember: (companyId: string, memberId: string, input: unknown) =>
      updateMemberMock(companyId, memberId, input),
    updateMemberPermissions: vi.fn(),
    updateMemberAccess: vi.fn(),
    archiveMember: (companyId: string, memberId: string, input: unknown) =>
      archiveMemberMock(companyId, memberId, input),
    securitySuspendMember: (companyId: string, memberId: string, input: unknown, expectedUserId: string, expectedSessionId: string) =>
      securitySuspendMemberMock(companyId, memberId, input, expectedUserId, expectedSessionId),
    approveJoinRequest: approveJoinRequestMock,
    rejectJoinRequest: rejectJoinRequestMock,
    listInvites: (companyId: string, options: unknown) => listInvitesMock(companyId, options),
    createCompanyInvite: vi.fn(),
    revokeInvite: vi.fn(),
  },
}));

vi.mock("@/api/workflows", () => ({
  workflowsApi: { list: vi.fn(async () => []) },
}));

vi.mock("@/api/agents", () => ({
  agentsApi: {
    list: (companyId: string) => listAgentsMock(companyId),
  },
}));

vi.mock("@/api/issues", () => ({
  issuesApi: {
    list: (companyId: string, filters: unknown) => listIssuesMock(companyId, filters),
  },
}));

vi.mock("@/api/routines", () => ({
  routinesApi: { list: (companyId: string) => listRoutinesMock(companyId) },
}));

vi.mock("@/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => {
    mockNavigate(to, replace);
    return <div data-testid="navigate">{to}</div>;
  },
  useSearchParams: () => [
    mockSearchParamsState.current,
    (
      updater:
        | URLSearchParams
        | ((prev: URLSearchParams) => URLSearchParams),
    ) => {
      mockSearchParamsState.current =
        typeof updater === "function"
          ? updater(mockSearchParamsState.current)
          : new URLSearchParams(updater);
    },
  ],
}));

vi.mock("@/plugins/slots", () => ({
  usePluginSlots: mockUsePluginSlots,
}));

vi.mock("@/context/SidebarContext", () => ({
  useSidebar: () => ({
    isMobile: false,
  }),
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: companyState.id,
    selectedCompany: { id: companyState.id, name: "Paperclip" },
  }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ pushToast: pushToastMock }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("CompanyAccess", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockSearchParamsState.current = new URLSearchParams();
    listInvitesMock.mockResolvedValue({ invites: [], nextOffset: null });
    listWorkflowCoveragesMock.mockResolvedValue({ coverages: [] });
    listRoutinesMock.mockResolvedValue([]);
    listMembersMock.mockResolvedValue({
      members: [
        {
          id: "member-1",
          companyId: "company-1",
          principalType: "user",
          principalId: "user-1",
          status: "active",
          membershipRole: "owner",
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z",
          user: {
            id: "user-1",
            email: "codexcoder@paperclip.local",
            name: "Codex Coder",
            image: "/api/assets/avatar-1/content",
          },
          grants: [],
        },
        {
          id: "member-2",
          companyId: "company-1",
          principalType: "user",
          principalId: "user-2",
          status: "active",
          membershipRole: "operator",
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z",
          user: {
            id: "user-2",
            email: "board@paperclip.local",
            name: "Board User",
            image: null,
          },
          grants: [],
        },
      ],
      access: {
        currentUserRole: "owner",
        canManageMembers: true,
        canInviteUsers: true,
        canApproveJoinRequests: true,
      },
    });
    listJoinRequestsMock.mockResolvedValue([
      {
        id: "join-1",
        requestType: "human",
        createdAt: "2026-04-10T00:00:00.000Z",
        requesterUser: {
          id: "user-2",
          email: "board@paperclip.local",
          name: "Board User",
          image: null,
        },
        requestEmailSnapshot: "board@paperclip.local",
        requestingUserId: "user-2",
        invite: {
          allowedJoinTypes: "human",
          humanRole: "operator",
        },
      },
      {
        id: "join-2",
        requestType: "agent",
        createdAt: "2026-04-10T00:00:00.000Z",
        agentName: "Codex Worker",
        adapterType: "codex_local",
        capabilities: "Implements code changes",
        invite: {
          allowedJoinTypes: "agent",
          humanRole: null,
        },
      },
    ]);
    updateMemberMock.mockResolvedValue({});
    archiveMemberMock.mockResolvedValue({ reassignedIssueCount: 1 });
    securitySuspendMemberMock.mockResolvedValue({ ownerRecoveryRequired: true, member: { id: "member-1", status: "suspended" } });
    listAgentsMock.mockResolvedValue([
      {
        id: "agent-1",
        name: "Codex Worker",
        role: "engineer",
        status: "active",
      },
    ]);
    listIssuesMock.mockResolvedValue([
      {
        id: "issue-1",
        identifier: "PAP-1",
        title: "Assigned to removed user",
        status: "todo",
      },
    ]);
    mockUsePluginSlots.mockReturnValue({
      slots: [],
      isLoading: false,
      errorMessage: null,
    });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders a compact member table without redundant explanatory copy", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyAccess />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).not.toContain("Manage the people who can work in Paperclip");
    expect(container.textContent).not.toContain("Members can collaborate across the company by default");
    expect(container.textContent).not.toContain("Core keeps this page focused on membership");
    expect(container.textContent).not.toContain("Manage human company memberships and status here");
    expect(container.textContent).toContain("Pending human joins");
    expect(container.textContent).toContain("Name");
    expect(container.textContent).toContain("Email");
    expect(container.querySelector('[data-slot="avatar"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Grants");
    expect(container.textContent).not.toContain("explicit grants");
    expect(container.textContent).not.toContain("Assign scoped tasks");
    expect(container.textContent).not.toContain("Agents");
    expect(container.textContent).not.toContain("Pending agent joins");
    expect(container.textContent).not.toContain("Open join request queue");
    expect(container.textContent).not.toContain("Manage invites");
    expect(container.textContent).not.toContain("Active user accounts");
    expect(container.textContent).not.toContain("Suspended user accounts");
    expect(container.textContent).not.toContain("Pending user joins");

    const editButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Edit",
    );
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(document.body.textContent).toContain("Update organization role and membership status");
    expect(document.body.textContent).not.toContain("Implicit grants from role");
    expect(document.body.textContent).not.toContain("permissionKey");

    await act(async () => {
      root.unmount();
    });
  });

  it("hides a late coverage response after the Human session changes and labels each party correctly", async () => {
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("user-1"));
    let release!: (value: { coverages: Array<Record<string, unknown>> }) => void;
    listWorkflowCoveragesMock.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    await act(async () => { root.render(<QueryClientProvider client={client}><CompanyAccess /></QueryClientProvider>); });
    await flushReact();

    const renewed = v9SessionFixture("user-1");
    client.setQueryData(queryKeys.auth.session, { ...renewed, session: { ...renewed.session, id: "renewed-user-1" } });
    await flushReact();
    await act(async () => {
      release({ coverages: [{
        id: "coverage-secret", companyId: "company-1", principalUserId: "user-1", delegateeUserId: "user-2",
        actionKey: "workflows:run", workflowId: "workflow-1", workflowRevisionId: "revision-1", scopeType: "manual",
        taskId: null, startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + 60_000),
        reason: "PRIVATE OLD SESSION REASON", revokedAt: null, revokedByUserId: null, createdAt: new Date(),
      }] });
    });
    await flushReact();
    expect(container.textContent).not.toContain("PRIVATE OLD SESSION REASON");
    expect(container.textContent).not.toContain("Covered by Board User");
    listWorkflowCoveragesMock.mockResolvedValueOnce({ coverages: [{
      id: "coverage-current", companyId: "company-1", principalUserId: "user-1", delegateeUserId: "user-2",
      actionKey: "workflows:run", workflowId: "workflow-1", workflowRevisionId: "revision-1", scopeType: "manual",
      taskId: null, startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + 60_000),
      reason: "Current coverage", revokedAt: null, revokedByUserId: null, createdAt: new Date(),
    }] });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["access", "workflow-coverages", "company-1", "user-1"] });
    });
    await flushReact();
    expect(container.textContent).toContain("Covered by Board User");
    await act(async () => { root.unmount(); });
    client.clear();
  });

  it("saves member role and status without touching grants", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyAccess />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const editButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Edit",
    );
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    const saveButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Save member",
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(updateMemberMock).toHaveBeenCalledWith("company-1", "member-1", {
      membershipRole: "owner",
      status: "active",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("security-suspends the last owner through the reasoned endpoint and reports owner recovery", async () => {
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const session = v9SessionFixture("user-1");
    client.setQueryData(queryKeys.auth.session, session);
    await act(async () => { root.render(<QueryClientProvider client={client}><CompanyAccess /></QueryClientProvider>); });
    await flushReact();
    await flushReact();

    const action = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Suspend for security"));
    expect(action).toBeTruthy();
    await act(async () => { action!.click(); });
    await flushReact();
    expect(document.body.textContent).toContain("This can leave the company with no active owner");
    expect(document.body.textContent).toContain("authenticated within the last 5 minutes");

    const reason = [...document.body.querySelectorAll("select")].find(select => select.getAttribute("aria-label") === "Reason for suspension");
    expect(reason).toBeTruthy();
    await act(async () => {
      reason!.value = "suspected_compromise";
      reason!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReact();
    const confirm = [...document.body.querySelectorAll("button")].find(button => button.textContent === "Suspend access");
    expect(confirm).toBeTruthy();
    await act(async () => { confirm!.click(); });
    await flushReact();

    expect(securitySuspendMemberMock).toHaveBeenCalledWith(
      "company-1", "member-1", { reasonCode: "suspected_compromise" }, "user-1", session.session.id,
    );
    expect(archiveMemberMock).not.toHaveBeenCalled();
    expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Membership suspended for security",
      body: "No active company owner remains. An authorized person must restore ownership before owner-only work can continue.",
    }));
    await act(async () => { root.unmount(); });
    client.clear();
  });

  it("does not dispatch security suspension after the Human session is renewed", async () => {
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("user-1"));
    await act(async () => { root.render(<QueryClientProvider client={client}><CompanyAccess /></QueryClientProvider>); });
    await flushReact();
    await flushReact();
    const action = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Suspend for security"));
    await act(async () => { action!.click(); });
    await flushReact();
    const reason = [...document.body.querySelectorAll("select")].find(select => select.getAttribute("aria-label") === "Reason for suspension");
    await act(async () => {
      reason!.value = "reported_loss";
      reason!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReact();
    const confirm = [...document.body.querySelectorAll("button")].find(button => button.textContent === "Suspend access");
    await act(async () => {
      confirm!.click();
      const session = v9SessionFixture("user-1");
      client.setQueryData(queryKeys.auth.session, { ...session, session: { ...session.session, id: "renewed-user-1" } });
    });
    await flushReact();
    expect(securitySuspendMemberMock).not.toHaveBeenCalled();
    expect(pushToastMock).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
    client.clear();
  });

  it("does not show a committed security result after the initiating Human session changes", async () => {
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const session = v9SessionFixture("user-1");
    client.setQueryData(queryKeys.auth.session, session);
    let resolveSuspension!: (value: { ownerRecoveryRequired: boolean; member: { id: string; status: string } }) => void;
    securitySuspendMemberMock.mockReturnValueOnce(new Promise((resolve) => { resolveSuspension = resolve; }));
    await act(async () => { root.render(<QueryClientProvider client={client}><CompanyAccess /></QueryClientProvider>); });
    await flushReact();
    await flushReact();

    const action = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Suspend for security"));
    await act(async () => { action!.click(); });
    await flushReact();
    const reason = [...document.body.querySelectorAll("select")].find(select => select.getAttribute("aria-label") === "Reason for suspension");
    await act(async () => {
      reason!.value = "reported_loss";
      reason!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReact();
    const confirm = [...document.body.querySelectorAll("button")].find(button => button.textContent === "Suspend access");
    await act(async () => { confirm!.click(); });
    expect(securitySuspendMemberMock).toHaveBeenCalledWith(
      "company-1", "member-1", { reasonCode: "reported_loss" }, "user-1", session.session.id,
    );

    const renewed = v9SessionFixture("user-1");
    await act(async () => {
      client.setQueryData(queryKeys.auth.session, { ...renewed, session: { ...renewed.session, id: "renewed-user-1" } });
    });
    await flushReact();
    expect(document.body.textContent).not.toContain("Reason for suspension");
    await act(async () => {
      resolveSuspension({ ownerRecoveryRequired: true, member: { id: "member-1", status: "suspended" } });
    });
    await flushReact();
    expect(pushToastMock).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
    client.clear();
  });

  it("keeps the owner-recovery acknowledgement when the original session is temporarily unresolved", async () => {
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const session = v9SessionFixture("user-1");
    client.setQueryData(queryKeys.auth.session, session);
    let resolveSuspension!: (value: { ownerRecoveryRequired: boolean; member: { id: string; status: string } }) => void;
    securitySuspendMemberMock.mockReturnValueOnce(new Promise((resolve) => { resolveSuspension = resolve; }));
    await act(async () => { root.render(<QueryClientProvider client={client}><CompanyAccess /></QueryClientProvider>); });
    await flushReact();
    await flushReact();

    const action = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Suspend for security"));
    await act(async () => { action!.click(); });
    await flushReact();
    const reason = [...document.body.querySelectorAll("select")].find(select => select.getAttribute("aria-label") === "Reason for suspension");
    await act(async () => {
      reason!.value = "reported_loss";
      reason!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReact();
    const confirm = [...document.body.querySelectorAll("button")].find(button => button.textContent === "Suspend access");
    await act(async () => { confirm!.click(); });
    expect(securitySuspendMemberMock).toHaveBeenCalledWith(
      "company-1", "member-1", { reasonCode: "reported_loss" }, "user-1", session.session.id,
    );

    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.auth.session, exact: true, refetchType: "none" });
    });
    await flushReact();
    await act(async () => {
      resolveSuspension({ ownerRecoveryRequired: true, member: { id: "member-1", status: "suspended" } });
    });
    await flushReact();
    expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Membership suspended for security",
      body: "No active company owner remains. An authorized person must restore ownership before owner-only work can continue.",
    }));
    await act(async () => { root.unmount(); });
    client.clear();
  });

  it("clears stale access rows but keeps owner-recovery acknowledgement when refresh is forbidden", async () => {
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("user-1"));
    await act(async () => { root.render(<QueryClientProvider client={client}><CompanyAccess /></QueryClientProvider>); });
    await flushReact();
    await flushReact();
    listMembersMock.mockRejectedValue(new Error("Membership access was revoked"));

    const action = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Suspend for security"));
    await act(async () => { action!.click(); });
    await flushReact();
    const reason = [...document.body.querySelectorAll("select")].find(select => select.getAttribute("aria-label") === "Reason for suspension");
    await act(async () => {
      reason!.value = "suspected_compromise";
      reason!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReact();
    const confirm = [...document.body.querySelectorAll("button")].find(button => button.textContent === "Suspend access");
    await act(async () => { confirm!.click(); });
    await flushReact();

    expect(securitySuspendMemberMock).toHaveBeenCalledWith(
      "company-1", "member-1", { reasonCode: "suspected_compromise" }, "user-1", v9SessionFixture("user-1").session.id,
    );
    expect(container.textContent).toContain("Membership access was revoked");
    expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Membership suspended for security",
      body: "No active company owner remains. An authorized person must restore ownership before owner-only work can continue.",
    }));
    await act(async () => { root.unmount(); });
    client.clear();
  });

  it("removes a member with an issue reassignment target", async () => {
    listRoutinesMock.mockResolvedValue([
      { id: "routine-1", title: "Owned routine", status: "active", responsibleUserId: "user-1" },
    ]);
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyAccess />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const removeButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.includes("Remove"),
    );
    expect(removeButtons.length).toBeGreaterThan(0);

    await act(async () => {
      removeButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(document.body.textContent).toContain("Remove member");
    expect(document.body.textContent).toContain("Assigned to removed user");

    const reassignmentSelects = Array.from(document.body.querySelectorAll("select")).filter((select) =>
      select.querySelector('option[value="__unassigned"]'),
    );
    expect(reassignmentSelects).toHaveLength(2);
    await act(async () => {
      reassignmentSelects[0]!.value = "user:user-2";
      reassignmentSelects[0]!.dispatchEvent(new Event("change", { bubbles: true }));
      reassignmentSelects[1]!.value = "user:user-2";
      reassignmentSelects[1]!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const confirmButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "Remove member",
    );
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(archiveMemberMock).toHaveBeenCalledWith("company-1", "member-1", {
      reassignment: { assigneeAgentId: null, assigneeUserId: "user-2" },
      routineResponsibleUserId: "user-2",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it.each(["account", "renewed session", "withdraw and restore", "company", "unmount", "unchanged", "local trusted unchanged"])(
    "fences a removal count after held access refresh: %s", async (change) => {
      const root = createRoot(container);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(queryKeys.auth.session, v9SessionFixture("user-1", change === "local trusted unchanged"));
      const render = () => root.render(<QueryClientProvider client={client}><CompanyAccess /></QueryClientProvider>);
      await act(async () => { render(); });
      await flushReact();
      await flushReact();
      const remove = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Remove"));
      await act(async () => { remove!.click(); });
      await flushReact();
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const invalidate = vi.spyOn(client, "invalidateQueries").mockImplementationOnce(() => held);
      const confirm = [...document.body.querySelectorAll("button")].find(button => button.textContent === "Remove member");
      await act(async () => { confirm!.click(); });
      await flushReact();
      expect(archiveMemberMock).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(pushToastMock).not.toHaveBeenCalled();

      if (change === "account") client.setQueryData(queryKeys.auth.session, v9SessionFixture("user-2"));
      if (change === "renewed session") {
        const session = v9SessionFixture("user-1");
        client.setQueryData(queryKeys.auth.session, { ...session, session: { ...session.session, id: "renewed-user-1" } });
      }
      if (change === "withdraw and restore") {
        await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.auth.session, refetchType: "none" }); });
        await flushReact();
        await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("user-1")); });
      }
      if (change === "company") {
        companyState.id = "company-2";
        await act(async () => { render(); });
      }
      if (change === "unmount") await act(async () => { root.unmount(); });
      await flushReact();
      await act(async () => { release(); });
      await flushReact();
      if (change === "unchanged" || change === "local trusted unchanged") {
        expect(pushToastMock).toHaveBeenCalledWith({ title: "Member removed", body: "1 assigned task cleaned up.", tone: "success" });
      } else {
        expect(pushToastMock).not.toHaveBeenCalled();
        expect(invalidate.mock.calls).toHaveLength(change === "withdraw and restore" ? 2 : 1);
      }
      if (change !== "unmount") await act(async () => { root.unmount(); });
      client.clear();
    },
  );

  it("denies dispatch when the same Human's session changes after clicking", async () => {
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("user-1"));
    await act(async () => { root.render(<QueryClientProvider client={client}><CompanyAccess /></QueryClientProvider>); });
    await flushReact();
    await flushReact();
    const remove = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Remove"));
    await act(async () => { remove!.click(); });
    await flushReact();
    const confirm = [...document.body.querySelectorAll("button")].find(button => button.textContent === "Remove member");
    await act(async () => {
      confirm!.click();
      const session = v9SessionFixture("user-1");
      client.setQueryData(queryKeys.auth.session, { ...session, session: { ...session.session, id: "renewed-user-1" } });
    });
    await flushReact();
    expect(archiveMemberMock).not.toHaveBeenCalled();
    expect(pushToastMock).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
    client.clear();
  });

  it.each(["success", "error"])("suppresses a late removal %s before refresh begins", async (outcome) => {
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("user-1"));
    await act(async () => { root.render(<QueryClientProvider client={client}><CompanyAccess /></QueryClientProvider>); });
    await flushReact();
    await flushReact();
    const remove = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Remove"));
    await act(async () => { remove!.click(); });
    await flushReact();
    let finish!: () => void;
    archiveMemberMock.mockReturnValueOnce(new Promise((resolve, reject) => {
      finish = () => outcome === "success" ? resolve({ reassignedIssueCount: 719 }) : reject(new Error("Private old account error"));
    }));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const confirm = [...document.body.querySelectorAll("button")].find(button => button.textContent === "Remove member");
    await act(async () => { confirm!.click(); });
    await flushReact();
    // No React render is required for the canonical cache check to reject the old session.
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("user-2"));
    await act(async () => { finish(); });
    await flushReact();
    expect(pushToastMock).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
    client.clear();
  });

  it.each(["Approve human", "Reject human"])("suppresses %s acknowledgement after a held refresh and session renewal", async (label) => {
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("user-1"));
    await act(async () => { root.render(<QueryClientProvider client={client}><CompanyAccess /></QueryClientProvider>); });
    await flushReact();
    await flushReact();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(client, "invalidateQueries").mockImplementationOnce(() => held);
    const action = [...container.querySelectorAll("button")].find(button => button.textContent === label);
    await act(async () => { action!.click(); });
    await flushReact();
    expect(label === "Approve human" ? approveJoinRequestMock : rejectJoinRequestMock).toHaveBeenCalledWith("company-1", "join-1");
    const session = v9SessionFixture("user-1");
    client.setQueryData(queryKeys.auth.session, { ...session, session: { ...session.session, id: "renewed-user-1" } });
    await act(async () => { release(); });
    await flushReact();
    expect(pushToastMock).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
    client.clear();
  });

  it("shows protected member removal reasons from the API", async () => {
    listMembersMock.mockResolvedValueOnce({
      members: [
        {
          id: "member-admin",
          companyId: "company-1",
          principalType: "user",
          principalId: "admin-user",
          status: "active",
          membershipRole: "admin",
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z",
          user: {
            id: "admin-user",
            email: "admin@paperclip.local",
            name: "Admin User",
            image: null,
          },
          grants: [],
          removal: {
            canArchive: false,
            reason: "Company admins cannot be removed from company access.",
          },
        },
      ],
      access: {
        currentUserRole: "owner",
        canManageMembers: true,
        canInviteUsers: true,
        canApproveJoinRequests: false,
      },
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyAccess />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).not.toContain("Company admins cannot be removed from company access.");
    const removeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Remove"),
    );
    expect(removeButton).toBeTruthy();
    expect(removeButton).toHaveProperty("disabled", true);
    expect(removeButton?.getAttribute("title")).toBe("Company admins cannot be removed from company access.");

    await act(async () => {
      root.unmount();
    });
  });

  it("redirects legacy access deep links to the permissions extension route when installed", async () => {
    mockUsePluginSlots.mockReturnValue({
      slots: [
        {
          type: "companySettingsPage",
          id: "permissions",
          displayName: "Permissions",
          routePath: "permissions",
          pluginKey: "permissions-extension",
        },
      ],
      isLoading: false,
      errorMessage: null,
    });
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyAccessLegacyRoute />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(mockNavigate).toHaveBeenCalledWith("/company/settings/permissions", true);
    expect(container.textContent).toContain("/company/settings/permissions");

    await act(async () => {
      root.unmount();
    });
  });

  it("shows a read-only unavailable fallback for legacy access deep links", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CompanyAccessLegacyRoute />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(container.textContent).toContain("Advanced Permissions");
    expect(container.textContent).toContain("Advanced permissions unavailable");
    expect(container.textContent).toContain("Open Members");
    expect(container.textContent).toContain("Open Invites");

    await act(async () => {
      root.unmount();
    });
  });
});

describe("CompanyAccess invites tab", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockSearchParamsState.current = new URLSearchParams();
    listInvitesMock.mockResolvedValue({ invites: [], nextOffset: null });
    listCloudStacksMock.mockResolvedValue({ stacks: [] });
    listMembersMock.mockResolvedValue({
      members: [],
      access: { currentUserRole: "owner", canApproveJoinRequests: false },
    });
    listAgentsMock.mockResolvedValue([]);
    listJoinRequestsMock.mockResolvedValue([]);
    mockUsePluginSlots.mockReturnValue([]);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function renderPage(queryClient?: QueryClient) {
    const root = createRoot(container);
    const client =
      queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <CompanyAccess />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
    return root;
  }

  it("shows Members and Invites tabs with Members active by default", async () => {
    const root = await renderPage();

    const tabLabels = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabLabels).toEqual(["Members", "Invites"]);
    expect(container.textContent).toContain("Organization Members");
    expect(container.textContent).not.toContain("Invite a person");
    expect(container.textContent).not.toContain("Invite people");
    expect(listCloudStacksMock).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("opens the Invites tab from a ?tab=invites deep link", async () => {
    mockSearchParamsState.current = new URLSearchParams("tab=invites");
    const root = await renderPage();

    expect(container.textContent).toContain("Invite a person");
    expect(container.textContent).toContain("Invite history");

    await act(async () => {
      root.unmount();
    });
  });

  it("hides the Invites tab when the operator hides company.invites", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["health"], { hiddenSettings: ["company.invites"] } as never);
    mockSearchParamsState.current = new URLSearchParams("tab=invites");
    const root = await renderPage(client);

    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(container.textContent).not.toContain("Invite a person");
    expect(container.textContent).toContain("Organization Members");
    expect(listInvitesMock).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  function cloudClient(cloudBaseUrl: string | null = "https://cloud.example.test") {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["health"], {
      hiddenSettings: ["company.invites"],
      cloud: { managed: true, managedBy: "paperclip-cloud", cloudBaseUrl, stackSlug: "old-slug" },
    });
    return client;
  }

  function cloudStack(role: string, isCurrent = true) {
    return { stackSlug: isCurrent ? "current-team" : "other-team", role, isCurrent,
      displayName: "Team", primaryHost: null, lifecycleState: "active", sleepState: "awake" };
  }

  it.each(["owner", "admin"])("offers Cloud invitations to the current stack's %s even with local invites hidden", async (role) => {
    listCloudStacksMock.mockResolvedValue({ stacks: [cloudStack("owner", false), cloudStack(role)] });
    const root = await renderPage(cloudClient());

    const invite = [...container.querySelectorAll("a")].find((link) => link.textContent === "Invite people");
    expect(invite?.getAttribute("href")).toBe("https://cloud.example.test/workspaces/current-team/settings?section=people");
    expect(invite?.getAttribute("target")).toBeNull();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(listInvitesMock).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it.each(["member", "support", "unknown"])("does not expose Cloud invitations to a %s who owns another stack", async (role) => {
    listCloudStacksMock.mockResolvedValue({ stacks: [cloudStack("owner", false), cloudStack(role)] });
    const root = await renderPage(cloudClient());
    expect(container.textContent).not.toContain("Invite people");
    await act(async () => root.unmount());
  });

  it("waits for the Cloud role before showing the invitation action", async () => {
    let resolveStacks!: (value: { stacks: ReturnType<typeof cloudStack>[] }) => void;
    listCloudStacksMock.mockReturnValue(new Promise((resolve) => { resolveStacks = resolve; }));
    const root = await renderPage(cloudClient());
    expect(container.textContent).not.toContain("Invite people");
    await act(async () => resolveStacks({ stacks: [cloudStack("admin")] }));
    await flushReact();
    expect(container.textContent).toContain("Invite people");
    await act(async () => root.unmount());
  });

  it("hides a cached invitation action when the Cloud role refresh fails", async () => {
    const client = cloudClient();
    client.setQueryData(["cloud", "stacks"], { stacks: [cloudStack("owner")] });
    const root = await renderPage(client);
    expect(container.textContent).toContain("Invite people");
    listCloudStacksMock.mockRejectedValue(new Error("Portfolio unavailable"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["cloud", "stacks"] }); });
    await flushReact();
    expect(container.textContent).not.toContain("Invite people");
    await act(async () => root.unmount());
  });

  it("requires an identified current stack and a configured Cloud destination", async () => {
    listCloudStacksMock.mockResolvedValue({ stacks: [cloudStack("owner", false)] });
    const root = await renderPage(cloudClient());
    expect(container.textContent).not.toContain("Invite people");
    await act(async () => root.unmount());

    listCloudStacksMock.mockResolvedValue({ stacks: [cloudStack("owner")] });
    const secondRoot = await renderPage(cloudClient(null));
    expect(container.textContent).not.toContain("Invite people");
    await act(async () => secondRoot.unmount());
  });
});
