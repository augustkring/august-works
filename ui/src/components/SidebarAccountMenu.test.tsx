// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../lib/queryKeys";
import { i18n } from "../i18n";
import { SidebarAccountMenu } from "./SidebarAccountMenu";
import { SidebarAccountMenu as ProductionSidebarAccountMenu } from "./SidebarAccountMenu.production";
import { CustomerFeedbackDialog } from "./CustomerFeedbackDialog";
import { api } from "../api/client";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { TooltipProvider } from "@/components/ui/tooltip";

const mockAuthApi = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  signOut: vi.fn(),
}));
const mockInstanceSettingsApi = vi.hoisted(() => ({
  getExperimental: vi.fn(),
}));
const mockToggleTheme = vi.hoisted(() => vi.fn());
const mockSetSidebarOpen = vi.hoisted(() => vi.fn());
const mockNavigateTopLevel = vi.hoisted(() => vi.fn());

vi.mock("@/api/auth", () => ({
  authApi: mockAuthApi,
}));
vi.mock("../api/auth", () => ({
  authApi: mockAuthApi,
}));

vi.mock("@/lib/browserNavigation", () => ({
  navigateTopLevel: mockNavigateTopLevel,
}));

vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/PAP/dashboard" }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1", selectedCompany: { issuePrefix: "PAP" } }),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({
    isMobile: false,
    setSidebarOpen: mockSetSidebarOpen,
  }),
}));

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    toggleTheme: mockToggleTheme,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  await callback();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("SidebarAccountMenu", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockAuthApi.getSession.mockResolvedValue({
      session: { id: "session-1", userId: "user-1" },
      user: {
        id: "user-1",
        name: "Jane Example",
        email: "jane@example.com",
        image: "https://example.com/jane.png",
      },
    });
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
    });
    mockAuthApi.signOut.mockResolvedValue({ success: true, redirectTo: "/cloud/logout" });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("shares the nav background without separator borders", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <SidebarAccountMenu deploymentMode="local_trusted" />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();

    const accountSurface = container.firstElementChild;
    expect(accountSurface?.className).toContain("bg-border/50");
    expect(accountSurface?.className).toContain("dark:bg-muted");
    expect(accountSurface?.className).not.toContain("border-t");
    expect(accountSurface?.className).not.toContain("border-r");
    expect(accountSurface?.className).not.toContain("border-border");
    const accountTrigger = container.querySelector('button[aria-label="Open account menu"]');
    expect(accountTrigger?.classList).toContain("rounded-lg");
    expect(accountTrigger?.classList).toContain("hover:bg-sidebar-accent");
    expect(accountTrigger?.classList).toContain("hover:text-sidebar-accent-foreground");
    expect(accountTrigger?.classList).not.toContain("hover:bg-background");

    expect(container.querySelector('a[aria-label="Share feedback"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Share feedback"]')).toBeNull();
    expect(container.querySelector('a[href="https://paperclip.ing/feedback"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("hides feedback when first-party feedback is disabled instead of linking upstream", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <ProductionSidebarAccountMenu deploymentMode="local_trusted" />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();

    const accountTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open account menu"]',
    );
    expect(accountTrigger?.classList).toContain("rounded-lg");
    expect(accountTrigger?.classList).toContain("hover:bg-accent/50");

    expect(container.querySelector('button[aria-label="Share feedback"]')).toBeNull();
    expect(container.querySelector('a[aria-label="Share feedback"]')).toBeNull();
    expect(container.querySelector('a[href="https://paperclip.ing/feedback"]')).toBeNull();

    await act(async () => {
      accountTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    const popover = document.body.querySelector('[data-slot="popover-content"]');
    expect(popover?.textContent).not.toContain("Feedback");
    expect(popover?.querySelector('a[href="https://paperclip.ing/feedback"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it.each([["production", ProductionSidebarAccountMenu, "Share feedback"], ["standard", SidebarAccountMenu, "Feedback"]] as const)("opens the mounted first-party feedback composer from the %s account menu", async (_variant, Menu, label) => {
    await i18n.changeLanguage("en");
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ customer_feedback_v9: true });
    mockAuthApi.getSession.mockResolvedValue(v9SessionFixture("user-1"));
    vi.spyOn(api, "get").mockResolvedValue({
      contacts: {
        support: "mailto:support@blentera.com",
        security: "mailto:security@blentera.com",
        privacy: "mailto:privacy@blentera.com",
      },
      attachments: {
        enabled: true,
        reason: "validation_required",
        types: ["image/png", "image/jpeg", "image/webp"],
        maxFiles: 3,
        maxBytes: 10485760,
      },
    });
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Menu deploymentMode="authenticated" />
            <CustomerFeedbackDialog />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();

    const feedbackButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    expect(feedbackButton).not.toBeNull();
    expect(container.querySelector('a[href="https://paperclip.ing/feedback"]')).toBeNull();
    await act(async () => feedbackButton?.click());
    await flushReact();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Share feedback");
    await act(async () => root.unmount());
  });

  it("keeps authenticated self-hosted sign-out on the local auth flow", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(queryKeys.health, {
      status: "ok",
      deploymentMode: "authenticated",
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <SidebarAccountMenu deploymentMode="authenticated" />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.querySelector('a[aria-label="Share feedback"]')).toBeNull();
    expect(container.querySelector('a[href="https://paperclip.ing/feedback"]')).toBeNull();
    expect(container.textContent).toContain("Jane Example");
    expect(container.textContent).not.toContain("jane@example.com");

    const trigger = container.querySelector('button[aria-label="Open account menu"]');
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(document.body.textContent).toContain("Edit profile");
    expect(document.body.textContent).toContain("Settings");
    expect(document.body.textContent).not.toContain("Instance settings");
    expect(document.body.textContent).toContain("Documentation");

    const popover = document.body.querySelector('[data-slot="popover-content"]');
    expect(popover?.textContent).not.toContain("Feedback");
    expect(popover?.querySelector('a[href="https://paperclip.ing/feedback"]')).toBeNull();

    // Documentation still appears before the theme toggle.
    const menuText = popover?.textContent ?? "";
    const docsPos = menuText.indexOf("Documentation");
    const themePos = menuText.indexOf("Switch to");
    expect(docsPos).toBeLessThan(themePos);

    // The popover header stays down to name + email: no "Account" badge, no version line.
    expect(popover?.textContent).not.toContain("Account");
    expect(popover?.textContent).not.toContain("Paperclip v");
    expect(document.body.textContent).toContain("jane@example.com");
    expect(document.body.querySelector('[data-slot="popover-content"]')?.className)
      .toContain("w-(--profile-popover-width)");
    expect(document.body.querySelector('[data-slot="popover-content"]')?.className)
      .toContain("rounded-xl");
    expect(document.body.querySelector('[data-slot="popover-content"]')?.className)
      .toContain("min-h-(--profile-popover-min-height)");
    expect(document.body.querySelector('a[href="/company/settings"]')?.className)
      .not.toContain("bg-muted");
    expect(document.body.textContent).not.toContain("Manage company and instance settings.");
    expect(document.body.textContent).not.toContain("Open your activity, task, and usage ledger.");
    expect(document.body.querySelector('a[href="/company/settings/instance/profile"]')).not.toBeNull();
    expect(document.body.querySelector('a[href="/company/settings"]')).not.toBeNull();

    const signOutButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Sign out"),
    );
    await act(async () => {
      signOutButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(mockAuthApi.signOut).toHaveBeenCalledOnce();
    expect(mockNavigateTopLevel).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(queryKeys.health)?.isInvalidated).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it.each([SidebarAccountMenu, ProductionSidebarAccountMenu])("hides cloud feedback and signs out through the harness (%#)", async (AccountMenu) => {
    const root = createRoot(container);
    const onOpenChange = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(queryKeys.health, {
      status: "ok",
      deploymentMode: "authenticated",
      cloud: {
        managed: true,
        managedBy: "paperclip-cloud",
        stackSlug: "acme-labs",
        cloudBaseUrl: "https://cloud.example.test",
      },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AccountMenu
              deploymentMode="authenticated"
              open
              onOpenChange={onOpenChange}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(container.querySelector('a[aria-label="Share feedback"]')).toBeNull();

    const signOutButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Sign out"),
    );
    await act(async () => {
      signOutButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(mockAuthApi.signOut).not.toHaveBeenCalled();
    expect(mockNavigateTopLevel).toHaveBeenCalledOnce();
    expect(mockNavigateTopLevel).toHaveBeenCalledWith("/cloud/logout");
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps sign-out hidden outside authenticated deployment mode", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <SidebarAccountMenu deploymentMode="local_trusted" open />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(document.body.textContent).not.toContain("Sign out");

    await act(async () => {
      root.unmount();
    });
  });

});
