// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { Companies } from "./Companies";
import { i18n } from "../i18n";

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

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
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

  async function typeConfirmName(dialog: HTMLElement, value: string) {
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flushReact();
  }

  async function openDeleteConfirmation() {
    const pointerClick = (el: Element) => {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0 }));
      (el as HTMLElement).click();
    };
    const trigger = container.querySelector("[aria-haspopup='menu']");
    act(() => pointerClick(trigger!));
    await flushReact();
    const menuItem = [...document.querySelectorAll("[role='menuitem']")].at(-1);
    act(() => pointerClick(menuItem!));
    await flushReact();
    return container.querySelector<HTMLElement>("[role='alertdialog']");
  }

  it("asks before deleting, names archive as the keep-the-data path and offers export (EXIT-R1)", async () => {
    const root = await renderPage();
    // A labelled region with its own controls, not a button wrapping buttons.
    expect(container.querySelector("[role='button'][tabindex]")).toBeNull();
    const article = container.querySelector("[role='article']");
    expect(document.getElementById(article!.getAttribute("aria-labelledby")!)?.textContent).toBe("Acme Labs");
    expect(container.querySelector("[aria-haspopup='menu']")?.getAttribute("aria-label")).toBe("Actions for Acme Labs");
    expect(container.querySelector("button[aria-label='Rename Acme Labs']")).not.toBeNull();
    const status = [...article!.querySelectorAll("span")].find((element) => element.textContent === "active");
    expect(status?.className).toContain("text-green-700");
    expect(status?.className).not.toContain("text-green-600");

    const dialog = await openDeleteConfirmation();
    expect(dialog).not.toBeNull();
    expect(document.getElementById(dialog!.getAttribute("aria-labelledby")!)?.textContent)
      .toBe("Delete this organization and all its data? This cannot be undone.");
    expect(document.getElementById(dialog!.getAttribute("aria-labelledby")!)?.className).not.toContain("text-destructive");
    expect(document.getElementById(dialog!.getAttribute("aria-describedby")!)?.textContent)
      .toContain("archive it in Company settings instead");
    expect(dialog!.querySelector("a")?.getAttribute("href")).toBe("/PAP/company/export");
    expect(mockCompaniesApi.remove).not.toHaveBeenCalled();

    // Delete stays disabled until the exact name is typed (EXIT-AUTH1).
    const input = dialog!.querySelector<HTMLInputElement>("input")!;
    expect(document.querySelector(`label[for='${input.id}']`)?.textContent).toContain("Type Acme Labs to confirm");
    const deleteButton = () => [...dialog!.querySelectorAll("button")].find((button) => button.textContent === "Delete")!;
    expect(deleteButton().disabled).toBe(true);
    await typeConfirmName(dialog!, "acme labs");
    expect(deleteButton().disabled).toBe(true);
    await typeConfirmName(dialog!, "Acme Labs");
    expect(deleteButton().disabled).toBe(false);
    expect(dialog!.textContent).toContain("sign-in within the last 5 minutes");

    const cancel = [...dialog!.querySelectorAll("button")].find((button) => button.textContent === "Cancel");
    act(() => cancel!.click());
    await flushReact();
    expect(container.querySelector("[role='alertdialog']")).toBeNull();
    expect(mockCompaniesApi.remove).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("renders the deletion confirmation in Danish", async () => {
    await i18n.changeLanguage("da");
    try {
      const root = await renderPage();
      expect(container.textContent).toContain("Ny organisation");
      expect(container.querySelector("[aria-haspopup='menu']")?.getAttribute("aria-label")).toBe("Handlinger for Acme Labs");
      const dialog = await openDeleteConfirmation();
      expect(dialog?.textContent).toContain("Slet denne organisation og alle dens data? Det kan ikke fortrydes.");
      expect(dialog?.textContent).toContain("Eksportér en kopi først");
      expect(dialog?.textContent).toContain("Skriv Acme Labs for at bekræfte");
      const labels = [...dialog!.querySelectorAll("button")].map((button) => button.textContent);
      expect(labels).toEqual(["Annuller", "Slet"]);
      expect(dialog?.textContent).not.toMatch(/Delete|Cancel|Export/);
      act(() => {
        root.unmount();
      });
    } finally {
      await i18n.changeLanguage("en");
    }
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
    await typeConfirmName(container.querySelector<HTMLElement>("[role='alertdialog']")!, "Acme Labs");
    const confirm = [...container.querySelectorAll("button")].find((button) => button.textContent === "Delete");
    expect(confirm).toBeDefined();
    act(() => (confirm as HTMLButtonElement).click());
    await flushReact();
    await flushReact();

    expect(mockCompaniesApi.remove).toHaveBeenCalledWith("company-1", "Acme Labs");
    expect(container.querySelector("[role='alert']")?.textContent).toBe(refusal);
    expect(container.textContent).toContain("Delete this organization and all its data?");

    act(() => {
      root.unmount();
    });
  });
});
