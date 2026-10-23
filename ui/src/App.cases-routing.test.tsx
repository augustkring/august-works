// @vitest-environment jsdom

// Regression guard for PAP-13002: the experimental Cases UI emits *unprefixed*
// links (`/cases`, `/cases/:id`) — the same global-unprefixed pattern Pipelines
// uses. Those only resolve if `cases` and `cases/:caseIdentifier` are registered
// as reserved unprefixed redirect routes in <App>; otherwise the first path
// segment is parsed as a company prefix ("CASES") and the page 404s with
// "No company matches prefix". This drives the real <App> route table so a
// future removal of those redirect routes fails loudly.

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const routingIdentity = vi.hoisted(() => ({
  account: { userId: "routing-user", sessionId: "routing-session", localImplicit: false, settled: true },
  company: {
    id: "company-1", name: "Paperclip", issuePrefix: "PAP", status: "active",
  },
  companies: [{ id: "company-1", name: "Paperclip", issuePrefix: "PAP", status: "active" }],
}));

vi.mock("./hooks/useStreamlinedUiEnabled", () => ({
  useStreamlinedUiEnabled: () => ({ enabled: true, loaded: true }),
}));
vi.mock("./hooks/useV9CurrentAccount", () => ({
  useV9CurrentAccount: () => routingIdentity.account,
}));

// jsdom's CSS parser rejects the custom-property marker rule stitches inserts
// (`--sxs{--sxs:N}`), pulled into <App>'s eager import graph transitively via
// @codesandbox/sandpack-react. Substitute a benign, valid rule on parse failure
// so stitches' index bookkeeping stays intact and the module graph evaluates.
// (sandpack itself is never exercised by the routing under test.)
vi.hoisted(() => {
  const sheetProto = window.CSSStyleSheet.prototype as unknown as {
    insertRule: (rule: string, index?: number) => number;
    __pap13002Patched?: boolean;
  };
  if (!sheetProto.__pap13002Patched) {
    const original = sheetProto.insertRule;
    sheetProto.insertRule = function patched(this: CSSStyleSheet, rule: string, index?: number) {
      try {
        return original.call(this, rule, index);
      } catch {
        try {
          return original.call(this, ".pap13002-noop{}", index);
        } catch {
          return this.cssRules?.length ?? 0;
        }
      }
    };
    sheetProto.__pap13002Patched = true;
  }
});

// Real Layout renders the full authenticated shell (sidebar, data queries) and
// owns the "No company matches prefix" NotFound. For routing we only need it to
// resolve the :companyPrefix segment and render its nested routes.
vi.mock("./components/Layout", async () => {
  const { Outlet } = await import("react-router-dom");
  const { ExperienceUtilities } = await import("./components/ExperienceUtilities");
  return { Layout: () => <><ExperienceUtilities /><Outlet /></> };
});

vi.mock("./components/AccountExperienceLanguageSelect", () => ({
  AccountExperienceLanguageSelect: () => <span>Language</span>,
}));
vi.mock("./components/CustomerFeedbackDialog", () => ({ CustomerFeedbackDialog: () => null }));
vi.mock("./context/SidebarContext", () => ({
  useSidebar: () => ({ sidebarOpen: false, setSidebarOpen: vi.fn() }),
}));
vi.mock("./hooks/useV9FeatureEnabled", () => ({
  useV9FeatureEnabled: () => ({ enabled: true, query: { isSuccess: true } }),
}));

// The experimental gate would otherwise hide the page behind a feature flag.
vi.mock("./components/CasesExperimentalGate", () => ({
  CasesExperimentalGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Rendered by <App> outside <Routes> and needs DialogProvider; irrelevant here.
vi.mock("./components/OnboardingWizardVariant", () => ({
  OnboardingWizardVariant: () => null,
}));

// Sentinel pages so we can assert *which* route resolved.
vi.mock("./pages/Cases", () => ({ Cases: () => <div>CASES_LIST_PAGE</div> }));
vi.mock("./pages/CaseDetail", () => ({ CaseDetail: () => <div>CASE_DETAIL_PAGE</div> }));

// Cloud access is unrelated to the route-table regression. Let it fall through
// synchronously so this test does not poll its three query transitions.
vi.mock("./components/CloudAccessGate", async () => {
  const { Outlet } = await import("react-router-dom");
  return { CloudAccessGate: () => <Outlet /> };
});

// The prefix resolver + redirect logic both read the active company.
vi.mock("./context/CompanyContext", () => ({
  useCompany: () => ({
    companies: routingIdentity.companies,
    selectedCompanyId: routingIdentity.company.id,
    selectedCompany: routingIdentity.company,
    loading: false,
  }),
  CompanyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./pages/ExperienceWork", async () => {
  const React = await import("react");
  const { useLocation } = await import("react-router-dom");
  return {
    WorkEntry: () => {
      const [draft, setDraft] = React.useState("");
      const location = useLocation();
      return <><output data-testid="work-location">{location.pathname}{location.search}{location.hash}</output>
        <label>Unsent work<textarea aria-label="Unsent work" value={draft} onChange={event => setDraft(event.target.value)} /></label></>;
    },
  };
});

vi.mock("./pages/CustomerSupportCases", () => ({
  CustomerSupportCases: ({ onReturn }: { onReturn?: () => void }) => (
    <div data-testid="support-page"><p>Support overlay content</p>
      {onReturn && <button type="button" onClick={onReturn}>Return from support</button>}
    </div>
  ),
}));

async function renderAppAt(container: HTMLElement, path: string) {
  const root = createRoot(container);
  mountedRoot = root;
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
  });
  return root;
}

let mountedRoot: ReturnType<typeof createRoot> | null = null;
function unmountApp(root: ReturnType<typeof createRoot>) {
  flushSync(() => root.unmount());
  if (mountedRoot === root) mountedRoot = null;
}

/**
 * Waits on the condition, not on a fixed number of turns. The previous version
 * yielded at most three macrotasks before asserting, which is ample on an idle
 * machine and not when the suite is running many workers in parallel — the
 * container was still empty and the assertion failed on a route that resolves
 * perfectly well. `vi.waitFor` retries against a time budget instead, so a
 * loaded worker gets more turns rather than a failure.
 *
 * The same fix #11499 applied to the sibling `App.activity-routing.test.tsx`,
 * which had the identical loop with five turns instead of three.
 */
async function waitForRoute(container: HTMLElement, text: string) {
  await vi.waitFor(() => expect(container.textContent).toContain(text));
}
async function waitForPortal(text: string) {
  await vi.waitFor(() => expect(document.body.textContent).toContain(text));
}

describe("App Cases routing (PAP-13002)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    routingIdentity.account.userId = "routing-user";
    routingIdentity.account.sessionId = "routing-session";
    routingIdentity.account.localImplicit = false;
    routingIdentity.account.settled = true;
    routingIdentity.company = { id: "company-1", name: "Paperclip", issuePrefix: "PAP", status: "active" };
    routingIdentity.companies = [routingIdentity.company];
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (mountedRoot) unmountApp(mountedRoot);
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("redirects unprefixed /cases to the company-prefixed list page", async () => {
    const root = await renderAppAt(container, "/cases");
    await waitForRoute(container, "CASES_LIST_PAGE");
    expect(container.textContent).not.toContain("No organization matches prefix");
    unmountApp(root);
  });

  it("redirects unprefixed /cases/:id to the company-prefixed detail page", async () => {
    const root = await renderAppAt(container, "/cases/PAP-C5");
    await waitForRoute(container, "CASE_DETAIL_PAGE");
    expect(container.textContent).not.toContain("No organization matches prefix");
    unmountApp(root);
  });

  it("keeps the real work surface mounted behind Help and returns to the same draft", async () => {
    const root = await renderAppAt(container, "/PAP/work?view=assigned#today");
    await waitForRoute(container, "Language");
    await vi.waitFor(() => expect(container.querySelector('textarea[aria-label="Unsent work"]')).toBeTruthy());
    const draft = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Unsent work"]')!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(draft, "Private unsent work");
      draft.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Use the actual ExperienceUtilities Link and router path, not a fabricated
    // support navigation state.
    const help = container.querySelector<HTMLAnchorElement>('a[href="/PAP/company/support"]');
    expect(help).toBeTruthy();
    flushSync(() => help!.click());
    await waitForPortal("Support overlay content");
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Language");
    expect(container.querySelector('textarea[aria-label="Unsent work"]')).toBe(draft);
    expect(draft.value).toBe("Private unsent work");
    expect(container.querySelector('[data-testid="work-location"]')?.textContent).toBe("/PAP/work?view=assigned#today");
    flushSync(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Return from support")?.click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(container.querySelector('textarea[aria-label="Unsent work"]')).toBe(draft);
    expect(draft.value).toBe("Private unsent work");
    await vi.waitFor(() => expect(document.activeElement).toBe(container.querySelector('a[data-support-help-entry]')));
    unmountApp(root);
  });

  it("keeps same-session Help over an unsettled account recheck, then drops old work when session changes", async () => {
    const root = await renderAppAt(container, "/PAP/work");
    await vi.waitFor(() => expect(container.querySelector('textarea[aria-label="Unsent work"]')).toBeTruthy());
    const draft = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Unsent work"]')!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(draft, "Account-private draft");
      draft.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => container.querySelector<HTMLAnchorElement>('a[href="/PAP/company/support"]')!.click());
    await waitForPortal("Support overlay content");

    routingIdentity.account.settled = false;
    flushSync(() => root.render(<MemoryRouter initialEntries={["/PAP/work"]}><App /></MemoryRouter>));
    expect(container.querySelector('textarea[aria-label="Unsent work"]')).toBe(draft);
    expect(draft.closest(".hidden")).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();

    routingIdentity.account.settled = true;
    routingIdentity.account.sessionId = "replacement-session";
    flushSync(() => root.render(<MemoryRouter initialEntries={["/PAP/work"]}><App /></MemoryRouter>));
    expect(container.querySelector('textarea[aria-label="Unsent work"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    unmountApp(root);
  });

  it("keeps a direct support deep link standalone without a background dialog", async () => {
    const root = await renderAppAt(container, "/PAP/company/support");
    await waitForRoute(container, "Support overlay content");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    unmountApp(root);
  });

  it("drops a background page when the selected company no longer matches it", async () => {
    const root = await renderAppAt(container, "/PAP/work");
    await vi.waitFor(() => expect(container.querySelector('textarea[aria-label="Unsent work"]')).toBeTruthy());
    flushSync(() => container.querySelector<HTMLAnchorElement>('a[href="/PAP/company/support"]')!.click());
    await waitForPortal("Support overlay content");
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();

    routingIdentity.company = { id: "company-2", name: "Other", issuePrefix: "OTH", status: "active" };
    routingIdentity.companies = [routingIdentity.company];
    flushSync(() => root.render(<MemoryRouter initialEntries={["/PAP/work"]}><App /></MemoryRouter>));
    expect(container.querySelector('textarea[aria-label="Unsent work"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    unmountApp(root);
  });
});
