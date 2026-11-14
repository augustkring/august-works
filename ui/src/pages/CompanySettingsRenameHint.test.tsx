// @vitest-environment jsdom

import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryKeys } from "@/lib/queryKeys";
import { v9SessionFixture } from "@/hooks/v9-session.test-support";
import { CompanySettings } from "./CompanySettings";

const mockAuthState = vi.hoisted(() => ({ userId: "user-1", sessionId: "session-user-1", localImplicit: false }));
const mockCompanyState = vi.hoisted(() => ({ id: "company-1" }));
const mockCompaniesApi = vi.hoisted(() => ({
  update: vi.fn(),
  archive: vi.fn(),
  responsibilityContacts: vi.fn(),
  updateResponsibilityContacts: vi.fn(),
}));

vi.mock("../api/auth", () => ({
  authApi: {
    getSession: async () => v9SessionFixture(mockAuthState.userId, mockAuthState.localImplicit),
  },
}));

const mockAssetsApi = vi.hoisted(() => ({
  uploadCompanyLogo: vi.fn(),
}));

const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockSetSelectedCompanyId = vi.hoisted(() => vi.fn());

const SELECTED_COMPANY = {
  id: "company-1",
  name: "Acme Robotics",
  description: null,
  status: "active",
  issuePrefix: "ACM",
  brandColor: null,
  logoUrl: null,
  attachmentMaxBytes: null,
  requireBoardApprovalForNewAgents: false,
  interactionResolverGovernance: {},
};

vi.mock("../api/companies", () => ({ companiesApi: mockCompaniesApi }));
vi.mock("../api/assets", () => ({ assetsApi: mockAssetsApi }));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [{ ...SELECTED_COMPANY, id: mockCompanyState.id }],
    selectedCompany: { ...SELECTED_COMPANY, id: mockCompanyState.id },
    selectedCompanyId: mockCompanyState.id,
    setSelectedCompanyId: mockSetSelectedCompanyId,
  }),
}));

// Both panels below the name field own their own queries and are not part of
// what this test covers.
vi.mock("../components/InteractionGovernancePanel", () => ({
  InteractionGovernancePanel: () => null,
  applyGovernanceChange: (governance: unknown) => governance,
}));

vi.mock("./InstanceGeneralSettings", () => ({
  InstanceGeneralSettings: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CLOUD_HEALTH = {
  status: "ok" as const,
  cloud: {
    managed: true as const,
    managedBy: "paperclip-cloud" as const,
    stackSlug: "acme-labs",
    cloudBaseUrl: "https://cloud.example.test",
  },
};

const SELF_HOSTED_HEALTH = { status: "ok" as const, cloud: null };

const RENAME_HINT =
  "Renaming can change this company's task ID prefix. Existing task IDs are renumbered and old task links stop resolving.";

describe("CompanySettings rename hint", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockAuthState.userId = "user-1";
    mockAuthState.sessionId = "session-user-1";
    mockAuthState.localImplicit = false;
    mockCompanyState.id = "company-1";
    mockCompaniesApi.responsibilityContacts.mockReset().mockResolvedValue({ securityContactUserId: null, supportIncidentContactUserId: null, eligibleUsers: [] });
    mockCompaniesApi.updateResponsibilityContacts.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  function renderWithClient(health: unknown, queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })) {
    // CloudAccessGate owns the health fetch in the app; seeding the cache is how
    // useCloudInstance sees a managed instance under test.
    queryClient.setQueryData(queryKeys.health, health);
    queryClient.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity, refetchOnMount: false });
    queryClient.setQueryData(queryKeys.auth.session, v9SessionFixture(mockAuthState.userId, mockAuthState.localImplicit));
    const root = createRoot(container);
    const renderTree = () => (
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <MemoryRouter>
              <CompanySettings />
            </MemoryRouter>
          </TooltipProvider>
        </QueryClientProvider>
      );
    flushSync(() => root.render(renderTree()));
    return { root, queryClient, rerender: () => flushSync(() => root.render(renderTree())) };
  }

  function render(health: unknown) {
    return renderWithClient(health).root;
  }

  function hintText() {
    return Array.from(container.querySelectorAll("p")).find(
      (element) => element.textContent?.trim() === RENAME_HINT,
    );
  }

  it("warns that a rename re-keys task IDs on a managed instance", () => {
    const root = render(CLOUD_HEALTH);
    expect(hintText()).toBeDefined();
    flushSync(() => root.unmount());
  });

  it("stays silent on a self-hosted instance, where a rename keeps the prefix", () => {
    const root = render(SELF_HOSTED_HEALTH);
    expect(hintText()).toBeUndefined();
    flushSync(() => root.unmount());
  });

  it("offers only server-validated contacts and lets the owner clear an ineligible saved contact", async () => {
    mockCompaniesApi.responsibilityContacts.mockResolvedValue({ securityContactUserId: "inactive-human",
      supportIncidentContactUserId: null, eligibleUsers: [{ id: "eligible-human", name: "Current Human", email: null }] });
    const root = render(SELF_HOSTED_HEALTH);
    await vi.waitFor(() => expect(mockCompaniesApi.responsibilityContacts).toHaveBeenCalledWith(
      "company-1", "user-1", "session-user-1", expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    await vi.waitFor(() => {
      const select = container.querySelector<HTMLSelectElement>("[data-testid='security-contact-select']")!;
      expect(Array.from(select.options).map(option => option.value)).toEqual(["", "inactive-human", "eligible-human"]);
    });
    const select = container.querySelector<HTMLSelectElement>("[data-testid='security-contact-select']")!;
    expect(select.options[1]?.textContent).toContain("no longer eligible");
    expect(select.value).toBe("inactive-human");
    await act(async () => {
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(Array.from(container.querySelectorAll("button")).some(button => button.textContent?.includes("Save contacts"))).toBe(true);
    flushSync(() => root.unmount());
  });

  it("drops the saved roster and save action when a same-session refresh is denied", async () => {
    let denyRefresh!: (error: Error) => void;
    mockCompaniesApi.responsibilityContacts
      .mockResolvedValueOnce({ securityContactUserId: "private-contact-user", supportIncidentContactUserId: null,
        eligibleUsers: [{ id: "private-contact-user", name: "CURRENT PRIVATE CONTACT", email: "private-contact@example.test" }] })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { denyRefresh = reject; }));
    const { root, queryClient } = renderWithClient(SELF_HOSTED_HEALTH);
    await vi.waitFor(() => expect(container.querySelector<HTMLSelectElement>("[data-testid='security-contact-select']")?.value)
      .toBe("private-contact-user"));
    const contactKey = queryClient.getQueryCache().findAll({ queryKey: ["company-responsibility-contacts"] })[0]?.queryKey;
    if (!contactKey) throw new Error("Responsibility contact query was not registered");
    await act(async () => { void queryClient.invalidateQueries({ queryKey: contactKey, exact: true }); });
    await vi.waitFor(() => expect(mockCompaniesApi.responsibilityContacts).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("CURRENT PRIVATE CONTACT");
      expect(container.querySelector<HTMLSelectElement>("[data-testid='security-contact-select']")?.value).toBe("");
      expect(Array.from(container.querySelectorAll("button")).some(button => button.textContent?.includes("Save contacts"))).toBe(false);
    });
    await act(async () => { denyRefresh(new Error("Forbidden")); });
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
    expect(container.textContent).not.toContain("CURRENT PRIVATE CONTACT");
    expect(container.textContent).not.toContain("private-contact-user");
    expect(Array.from(container.querySelectorAll("button")).some(button => button.textContent?.includes("Save contacts"))).toBe(false);
    flushSync(() => root.unmount());
  });

  it("hides a late contact roster after the Human session changes", async () => {
    let resolvePrevious!: (value: unknown) => void;
    mockCompaniesApi.responsibilityContacts
      .mockImplementationOnce(() => new Promise(resolve => { resolvePrevious = resolve; }))
      .mockImplementation(() => new Promise(() => {}));
    const { root, queryClient } = renderWithClient(SELF_HOSTED_HEALTH);
    await vi.waitFor(() => expect(mockCompaniesApi.responsibilityContacts).toHaveBeenCalledTimes(1));
    expect(mockCompaniesApi.responsibilityContacts.mock.calls[0]).toMatchObject([
      "company-1", "user-1", "session-user-1", expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ]);

    await act(async () => {
      mockAuthState.userId = "user-2";
      mockAuthState.sessionId = "session-user-2";
      queryClient.setQueryData(queryKeys.auth.session, v9SessionFixture("user-2"));
    });
    await vi.waitFor(() => expect(mockCompaniesApi.responsibilityContacts).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolvePrevious({ securityContactUserId: "private-roster-user-41", supportIncidentContactUserId: null,
        eligibleUsers: [{ id: "private-roster-user-41", name: "PRIVATE PREVIOUS HUMAN", email: "private@example.test" }] });
    });
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
    expect(container.textContent).not.toContain("PRIVATE PREVIOUS HUMAN");
    expect(container.textContent).not.toContain("private@example.test");
    expect(container.textContent).not.toContain("private-roster-user-41");
    flushSync(() => root.unmount());
  });

  it("hides a held roster after same-session authority withdrawal and restoration", async () => {
    let resolvePrevious!: (value: unknown) => void;
    mockCompaniesApi.responsibilityContacts
      .mockImplementationOnce(() => new Promise(resolve => { resolvePrevious = resolve; }))
      .mockImplementation(() => new Promise(() => {}));
    const { root, queryClient } = renderWithClient(SELF_HOSTED_HEALTH);
    await vi.waitFor(() => expect(mockCompaniesApi.responsibilityContacts).toHaveBeenCalledTimes(1));
    const originalSession = v9SessionFixture("user-1");
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session, exact: true, refetchType: "none" });
    });
    await act(async () => { queryClient.setQueryData(queryKeys.auth.session, originalSession); });
    await vi.waitFor(() => expect(mockCompaniesApi.responsibilityContacts).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolvePrevious({ securityContactUserId: "withdrawn-roster-user", supportIncidentContactUserId: null,
        eligibleUsers: [{ id: "withdrawn-roster-user", name: "WITHDRAWN SESSION ROSTER", email: "withdrawn@example.test" }] });
    });
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
    expect(container.textContent).not.toContain("WITHDRAWN SESSION ROSTER");
    expect(container.textContent).not.toContain("withdrawn-roster-user");
    flushSync(() => root.unmount());
  });

  it("hides a held roster when the company leaves and returns before the read resolves", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    mockCompaniesApi.responsibilityContacts.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));
    const { root, queryClient, rerender } = renderWithClient(SELF_HOSTED_HEALTH);
    await vi.waitFor(() => expect(mockCompaniesApi.responsibilityContacts).toHaveBeenCalledTimes(1));
    await act(async () => { mockCompanyState.id = "company-2"; rerender(); });
    await vi.waitFor(() => expect(mockCompaniesApi.responsibilityContacts).toHaveBeenCalledTimes(2));
    await act(async () => { mockCompanyState.id = "company-1"; rerender(); });
    await vi.waitFor(() => expect(mockCompaniesApi.responsibilityContacts).toHaveBeenCalledTimes(3));
    await act(async () => {
      resolvers[0]!({ securityContactUserId: "old-company-contact", supportIncidentContactUserId: null,
        eligibleUsers: [{ id: "old-company-contact", name: "PREVIOUS COMPANY ROSTER", email: "old-company@example.test" }] });
    });
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
    expect(container.textContent).not.toContain("PREVIOUS COMPANY ROSTER");
    expect(container.textContent).not.toContain("old-company-contact");
    flushSync(() => root.unmount());
  });

  it("keeps the existing local trusted contact path bound to local-board", async () => {
    mockAuthState.localImplicit = true;
    const root = render(SELF_HOSTED_HEALTH);
    await vi.waitFor(() => expect(mockCompaniesApi.responsibilityContacts).toHaveBeenCalledWith(
      "company-1", "local-board", null, expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    flushSync(() => root.unmount());
  });

  it("does not apply a held contact mutation after the Human session changes", async () => {
    mockCompaniesApi.responsibilityContacts.mockResolvedValue({ securityContactUserId: null,
      supportIncidentContactUserId: null, eligibleUsers: [{ id: "human-1", name: "Current Human", email: null }] });
    let resolveSave!: (value: unknown) => void;
    mockCompaniesApi.updateResponsibilityContacts.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
    const { root, queryClient } = renderWithClient(SELF_HOSTED_HEALTH);
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid='security-contact-select'] option").length).toBe(2));
    const select = container.querySelector<HTMLSelectElement>("[data-testid='security-contact-select']")!;
    await act(async () => {
      select.value = "human-1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Save contacts"))!;
    await act(async () => { save.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await vi.waitFor(() => expect(mockCompaniesApi.updateResponsibilityContacts).toHaveBeenCalledTimes(1));
    expect(mockCompaniesApi.updateResponsibilityContacts.mock.calls[0]).toMatchObject([
      "company-1", { securityContactUserId: "human-1", supportIncidentContactUserId: null },
      "user-1", "session-user-1",
    ]);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      mockAuthState.userId = "user-2";
      mockAuthState.sessionId = "session-user-2";
      queryClient.setQueryData(queryKeys.auth.session, v9SessionFixture("user-2"));
    });
    await act(async () => { resolveSave({ ok: true }); });
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
    expect(invalidateSpy.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey ?? []).includes("company-responsibility-contacts"))).toBe(false);
    expect(container.querySelector<HTMLSelectElement>("[data-testid='security-contact-select']")?.value).toBe("");
    flushSync(() => root.unmount());
  });

  it("does not acknowledge a held mutation after same-session authority withdrawal and restoration", async () => {
    mockCompaniesApi.responsibilityContacts.mockResolvedValue({ securityContactUserId: null,
      supportIncidentContactUserId: null, eligibleUsers: [{ id: "human-1", name: "Current Human", email: null }] });
    let resolveSave!: (value: unknown) => void;
    mockCompaniesApi.updateResponsibilityContacts.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
    const { root, queryClient } = renderWithClient(SELF_HOSTED_HEALTH);
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid='security-contact-select'] option").length).toBe(2));
    const select = container.querySelector<HTMLSelectElement>("[data-testid='security-contact-select']")!;
    await act(async () => {
      select.value = "human-1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Save contacts"))!;
    await act(async () => { save.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await vi.waitFor(() => expect(mockCompaniesApi.updateResponsibilityContacts).toHaveBeenCalledTimes(1));
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const originalSession = v9SessionFixture("user-1");
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session, exact: true, refetchType: "none" });
    });
    await act(async () => { queryClient.setQueryData(queryKeys.auth.session, originalSession); });
    await act(async () => { resolveSave({ ok: true }); });
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
    expect(invalidateSpy.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey ?? []).includes("company-responsibility-contacts"))).toBe(false);
    flushSync(() => root.unmount());
  });
});
