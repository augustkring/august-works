// @vitest-environment jsdom

import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryKeys } from "@/lib/queryKeys";
import { CompanySettings } from "./CompanySettings";

const mockCompaniesApi = vi.hoisted(() => ({
  update: vi.fn(),
  archive: vi.fn(),
  responsibilityContacts: vi.fn(),
  updateResponsibilityContacts: vi.fn(),
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
    companies: [SELECTED_COMPANY],
    selectedCompany: SELECTED_COMPANY,
    selectedCompanyId: SELECTED_COMPANY.id,
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
    mockCompaniesApi.responsibilityContacts.mockResolvedValue({ securityContactUserId: null, supportIncidentContactUserId: null, eligibleUsers: [] });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  function render(health: unknown) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // CloudAccessGate owns the health fetch in the app; seeding the cache is how
    // useCloudInstance sees a managed instance under test.
    queryClient.setQueryData(queryKeys.health, health);
    const root = createRoot(container);
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <MemoryRouter>
              <CompanySettings />
            </MemoryRouter>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    return root;
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
    await vi.waitFor(() => expect(mockCompaniesApi.responsibilityContacts).toHaveBeenCalledWith("company-1"));
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
});
