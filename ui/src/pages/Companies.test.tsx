// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { Companies } from "./Companies";

const mockCompaniesApi = vi.hoisted(() => ({
  stats: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
const mockOpenOnboarding = vi.hoisted(() => vi.fn());

vi.mock("../api/companies", () => ({
  companiesApi: mockCompaniesApi,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [
      {
        id: "company-1",
        issuePrefix: "PAP",
        name: "Acme Labs",
        status: "active",
        budgetMonthlyCents: 0,
        spentMonthlyCents: 0,
      },
    ],
    selectedCompanyId: "company-1",
    setSelectedCompanyId: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({ openOnboarding: mockOpenOnboarding }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function act(callback: () => void) {
  flushSync(callback);
}

async function flushReact() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

const CLOUD_HEALTH = {
  status: "ok" as const,
  cloud: {
    managed: true as const,
    managedBy: "paperclip-cloud" as const,
    stackSlug: "acme-labs",
    cloudBaseUrl: "https://cloud.example.test",
  },
};

describe("Companies page", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockCompaniesApi.stats.mockResolvedValue({});
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function renderPage({ cloud }: { cloud?: boolean } = {}) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    if (cloud) queryClient.setQueryData(queryKeys.health, CLOUD_HEALTH);
    const root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Companies />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
    return root;
  }

  it("offers the company wizard when self-hosted", async () => {
    const root = await renderPage();

    expect(container.textContent).toContain("New Organization");

    act(() => {
      root.unmount();
    });
  });

  it("hides the company wizard on a cloud-managed instance", async () => {
    const root = await renderPage({ cloud: true });

    // Cloud stacks hold exactly one company and POST /companies is a 403 floor,
    // so the entry point must not be offered at all.
    expect(container.textContent).not.toContain("New Organization");
    expect(container.textContent).toContain("Acme Labs");
    expect(mockOpenOnboarding).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("shows why a refused organization removal deleted nothing", async () => {
    // PRIV-R7: the legacy removal refuses (409) while a run is active or its
    // runtime files cannot be erased yet. The confirmation must say so.
    const refusal = "The company's saved runtime files could not be erased yet, so nothing was deleted.";
    mockCompaniesApi.remove.mockRejectedValue(new Error(refusal));
    const root = await renderPage();
    const pointerClick = (el: Element) => {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0 }));
      (el as HTMLElement).click();
    };

    const trigger = container.querySelector("[aria-haspopup='menu']");
    expect(trigger).not.toBeNull();
    act(() => pointerClick(trigger!));
    await flushReact();
    const menuItem = [...document.querySelectorAll("[role='menuitem']")]
      .find((item) => item.textContent?.includes("Delete Organization"));
    expect(menuItem).toBeDefined();
    act(() => pointerClick(menuItem!));
    await flushReact();
    const confirm = [...container.querySelectorAll("button")].find((button) => button.textContent === "Delete");
    expect(confirm).toBeDefined();
    act(() => (confirm as HTMLButtonElement).click());
    await flushReact();
    await flushReact();

    expect(mockCompaniesApi.remove).toHaveBeenCalledWith("company-1");
    expect(container.querySelector("[role='alert']")?.textContent).toBe(refusal);
    expect(container.textContent).toContain("Delete this organization and all its data?");

    act(() => {
      root.unmount();
    });
  });
});
