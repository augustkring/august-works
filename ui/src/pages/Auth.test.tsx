// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { act as reactAct } from "react";
import { CliAuthPage } from "./CliAuth";
import { ApiError } from "../api/client";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../lib/queryKeys";
import { AuthPage } from "./Auth";
import { i18n } from "../i18n";
import { saasApi } from "../api/saas";

const getSessionMock = vi.hoisted(() => vi.fn());
const signInEmailMock = vi.hoisted(() => vi.fn());
const signUpEmailMock = vi.hoisted(() => vi.fn());
const verifyTotpMock = vi.hoisted(() => vi.fn());
const verifyBackupCodeMock = vi.hoisted(() => vi.fn());

vi.mock("../api/auth", () => ({
  authApi: {
    getSession: () => getSessionMock(),
    signInEmail: (input: unknown) => signInEmailMock(input),
    signUpEmail: (input: unknown) => signUpEmailMock(input),
    verifyTotp: (code: string) => verifyTotpMock(code),
    verifyBackupCode: (code: string) => verifyBackupCodeMock(code),
  },
  parseTwoFactorSignInChallenge: (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const candidate = value as { twoFactorRedirect?: unknown; twoFactorMethods?: unknown };
    return candidate.twoFactorRedirect === true && Array.isArray(candidate.twoFactorMethods) && candidate.twoFactorMethods.every(method => typeof method === "string")
      ? candidate
      : null;
  },
}));

// The ASCII art animation drives a canvas/requestAnimationFrame loop that adds
// nothing to these assertions, so stub it out.
vi.mock("@/components/AsciiArtAnimation", () => ({
  AsciiArtAnimation: () => null,
}));

// The auth page renders a ThemeToggle, which reads ThemeContext. The provider
// lives in main.tsx (above the router), so mock the hook here the same way
// SidebarAccountMenu.test.tsx does.
vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

// The router's navigate wrapper reads the active company prefix from context.
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: null,
    selectedCompanyId: null,
    companies: [],
    selectionSource: "manual",
    loading: false,
    error: null,
    setSelectedCompanyId: vi.fn(),
    reloadCompanies: vi.fn(),
    createCompany: vi.fn(),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  flushSync(() => {});
}

function renderAuthPage(container: HTMLElement) {
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return { root, queryClient };
}

describe("AuthPage", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(saasApi, "capabilities").mockResolvedValue(null);
    getSessionMock.mockResolvedValue(null);
    signInEmailMock.mockResolvedValue(undefined);
    signUpEmailMock.mockResolvedValue(undefined);
    verifyTotpMock.mockResolvedValue(undefined);
    verifyBackupCodeMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
    vi.restoreAllMocks();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function mount(initialEntry: string | { pathname: string; search?: string; state?: unknown } = "/auth") {
    const { root, queryClient } = renderAuthPage(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/private" element={<p>Private destination</p>} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await flushReact();
    await flushReact();
    return { root, queryClient };
  }

  it("exposes password-manager metadata and a11y attributes on the sign-in form", async () => {
    const { root } = await mount();

    const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;

    expect(emailInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();

    // 1Password / password-manager recognition: identifier field is "username".
    expect(emailInput.getAttribute("autocomplete")).toBe("username");
    expect(emailInput.getAttribute("type")).toBe("email");
    expect(passwordInput.getAttribute("autocomplete")).toBe("current-password");

    // Stable ids/names for both inputs.
    expect(emailInput.id).toBe("email");
    expect(passwordInput.id).toBe("password");

    // Required + programmatic required state.
    expect(emailInput.required).toBe(true);
    expect(emailInput.getAttribute("aria-required")).toBe("true");
    expect(passwordInput.required).toBe(true);
    expect(passwordInput.getAttribute("aria-required")).toBe("true");

    // Programmatic labels.
    expect(container.querySelector('label[for="email"]')).not.toBeNull();
    expect(container.querySelector('label[for="password"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("uses new-password autocomplete in sign-up mode", async () => {
    const { root } = await mount();

    const createOne = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Create one",
    );
    expect(createOne).not.toBeNull();

    await act(async () => {
      createOne?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    const nameInput = container.querySelector('input[name="name"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.getAttribute("autocomplete")).toBe("name");
    expect(nameInput.required).toBe(true);
    expect(passwordInput.getAttribute("autocomplete")).toBe("new-password");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders auth errors in an assertive alert region referenced by the inputs", async () => {
    const { root } = await mount();

    const inputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;

    await act(async () => {
      inputValueSetter!.call(emailInput, "jane@example.com");
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
      inputValueSetter!.call(passwordInput, "wrongpass");
      passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    signInEmailMock.mockRejectedValueOnce(new Error("Invalid email or password"));

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact();
    await flushReact();

    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(alert.hasAttribute("aria-live")).toBe(false);
    expect(alert.textContent).toContain("Invalid email or password");

    const errorId = alert.id;
    expect(errorId.length).toBeGreaterThan(0);
    expect(emailInput.getAttribute("aria-describedby")).toBe(errorId);
    expect(emailInput.getAttribute("aria-invalid")).toBe("true");
    expect(passwordInput.getAttribute("aria-describedby")).toBe(errorId);
    expect(passwordInput.getAttribute("aria-invalid")).toBe("true");

    await act(async () => {
      root.unmount();
    });
  });

  it("invalidates anonymous health metadata after sign-in", async () => {
    const { root, queryClient } = await mount();
    queryClient.setQueryData(queryKeys.health, {
      status: "ok",
      deploymentMode: "authenticated",
    });

    const inputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;

    await act(async () => {
      inputValueSetter!.call(emailInput, "jane@example.com");
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
      inputValueSetter!.call(passwordInput, "supersecret");
      passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact();
    await flushReact();

    expect(signInEmailMock).toHaveBeenCalledWith({
      email: "jane@example.com",
      password: "supersecret",
    });
    expect(queryClient.getQueryState(queryKeys.health)?.isInvalidated).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps a native two-factor challenge pending until the server confirms a session", async () => {
    const { root, queryClient } = await mount("/auth?next=%2Fprivate");
    queryClient.setQueryData(queryKeys.health, { status: "ok", deploymentMode: "authenticated" });
    signInEmailMock.mockResolvedValueOnce({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    const password = container.querySelector('input[name="password"]') as HTMLInputElement;
    await act(async () => {
      setter.call(email, "jane@example.com"); email.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(password, "original-secret"); password.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact(); await flushReact();

    expect(container.querySelector("h1")?.textContent).toBe("Verify it’s you");
    expect(container.querySelector('input[name="password"]')).toBeNull();
    expect(container.querySelector('input[name="code"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Private destination");
    expect(queryClient.getQueryState(queryKeys.health)?.isInvalidated).toBe(false);
    expect(signInEmailMock).toHaveBeenCalledTimes(1);
    expect(verifyTotpMock).not.toHaveBeenCalled();

    const recoveryChoice = [...container.querySelectorAll("button")].find(button => button.textContent === "Recovery code");
    await act(async () => { recoveryChoice!.click(); });
    const code = container.querySelector('input[name="code"]') as HTMLInputElement;
    await act(async () => {
      setter.call(code, "ABCD-EFGH"); code.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact();
    expect(verifyBackupCodeMock).toHaveBeenCalledWith("ABCD-EFGH");
    expect(container.textContent).not.toContain("Private destination");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Your sign-in could not be confirmed");

    getSessionMock.mockResolvedValue(v9SessionFixture("jane"));
    // Re-submit a fresh challenge code after the first verification mock succeeds.
    // The challenge remains until a canonical Better Auth session read confirms it.
    verifyBackupCodeMock.mockImplementationOnce(async () => {
      getSessionMock.mockResolvedValue(v9SessionFixture("jane"));
    });
    await act(async () => {
      setter.call(code, "IJKL-MNOP"); code.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact(); await flushReact();
    expect(verifyBackupCodeMock).toHaveBeenLastCalledWith("IJKL-MNOP");
    expect(container.textContent).toContain("Private destination");
    await act(async () => { root.unmount(); });
  });

  it("hydrates only the native challenge view from router state and can return to sign-in", async () => {
    const { root } = await mount({ pathname: "/auth", search: "?next=%2Fprivate", state: {
      twoFactorChallenge: { twoFactorRedirect: true, twoFactorMethods: ["totp"] },
    } });
    expect(container.querySelector("h1")?.textContent).toBe("Verify it’s you");
    expect(container.querySelector('input[name="password"]')).toBeNull();

    const back = [...container.querySelectorAll("button")].find(button => button.textContent === "Back to sign in");
    await act(async () => { back!.click(); });
    await flushReact();
    expect(container.querySelector("h1")?.textContent).toBe("Sign in to Blentera");
    expect(container.querySelector('input[name="password"]')).not.toBeNull();
    expect(verifyTotpMock).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });
  it("validates new passwords by Unicode code points while keeping the exact submitted value", async () => {
    const { root } = await mount();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const createLink = [...container.querySelectorAll("button")].find(button => button.textContent === "Create one");
    await act(async () => { createLink!.click(); });
    await flushReact();
    const name = container.querySelector('input[name="name"]') as HTMLInputElement;
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    const password = container.querySelector('input[name="password"]') as HTMLInputElement;
    expect(password.minLength).toBe(15);
    expect(password.maxLength).toBe(256);
    await act(async () => {
      setter.call(name, "Jane"); name.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(email, "jane@example.com"); email.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(password, "😀".repeat(8)); password.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("at least 15 characters");
    await act(async () => {
      setter.call(password, "😀".repeat(15)); password.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact(); await flushReact();
    expect(signUpEmailMock).toHaveBeenCalledWith({ name: "Jane", email: "jane@example.com", password: "😀".repeat(15) });
    await act(async () => { root.unmount(); });
  });

  it("changes authentication language without submitting credentials and translates a refused request while preserving email", async () => {
    vi.mocked(saasApi.capabilities).mockResolvedValue({ profile: "saas", signup: true, emailVerification: true,
      enterpriseSso: false, onboarding: true, billing: false, checkout: false, runtime: false,
      usage: false, support: false, deletion: false, notifications: false });
    const { root } = await mount();
    const email = container.querySelector('input[name="email"]') as HTMLInputElement;
    const password = container.querySelector('input[name="password"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(email, "person@example.test");email.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(password, "private-software-fixture");password.dispatchEvent(new Event("input", { bubbles: true }));
      await i18n.changeLanguage("da");
    });
    await flushReact();
    expect(container.querySelector("h1")?.textContent).toBe("Log ind på Blentera");
    expect(container.querySelector('label[for="email"]')?.textContent).toBe("E-mail");
    expect(email.value).toBe("person@example.test");expect(password.value).toBe("private-software-fixture");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
    expect(signInEmailMock).not.toHaveBeenCalled();expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("company SSO");
    signInEmailMock.mockRejectedValueOnce(new Error("Invalid email or password"));
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flushReact();await flushReact();
    const summary = container.querySelector('[role="alert"]')!;
    expect(summary.textContent).toBe("Ugyldig e-mail eller adgangskode");
    expect(document.activeElement).toBe(summary);expect(email.getAttribute("aria-describedby")).toBe(summary.id);
    expect(email.value).toBe("person@example.test");expect(signInEmailMock).toHaveBeenCalledTimes(1);
    await act(async () => { await i18n.changeLanguage("en"); });await flushReact();
    expect(summary.textContent).toBe("Invalid email or password");expect(signInEmailMock).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });

});

describe("CliAuthPage rate-limit recovery", () => {
  const challengeId = "00000000-0000-4000-8000-000000000429";
  const challengeToken = "synthetic-cli-approval-fixture-token";
  const challengePath = `/api/cli-auth/challenges/${challengeId}?token=${challengeToken}`;
  const challengeQueryKey = ["cli-auth-challenge", challengeId, challengeToken, "operator", "session-operator", 0];
  const fetchCli = vi.fn<typeof fetch>();
  let cliContainer: HTMLDivElement;
  let cliRoot: ReturnType<typeof createRoot> | undefined;
  let cliClient: QueryClient | undefined;

  function response(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  function pending(expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()) {
    return { id: challengeId, status: "pending", command: "paperclipai auth login", clientName: "paperclipai cli",
      requestedAccess: "board", requestedCompanyId: null, requestedCompanyName: null, approvedAt: null,
      cancelledAt: null, expiresAt, approvedByUser: null, requiresSignIn: false, canApprove: true, currentUserId: "operator" };
  }

  async function advance(milliseconds: number) {
    await reactAct(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
    await reactAct(async () => { await vi.advanceTimersByTimeAsync(0); });
  }

  async function mountCli(knownSession = true) {
    cliClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnMount: false } } });
    if (knownSession) cliClient.setQueryData(queryKeys.auth.session, v9SessionFixture("operator"));
    cliRoot = createRoot(cliContainer);
    await reactAct(async () => {
      cliRoot!.render(<MemoryRouter initialEntries={[`/cli-auth/${challengeId}?token=${challengeToken}`]}>
        <QueryClientProvider client={cliClient!}><Routes>
          <Route path="/cli-auth/:id" element={<CliAuthPage />} />
        </Routes></QueryClientProvider>
      </MemoryRouter>);
    });
    await advance(0);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T20:00:00Z"));
    fetchCli.mockReset();
    vi.stubGlobal("fetch", fetchCli);
    getSessionMock.mockResolvedValue(v9SessionFixture("operator"));
    void i18n.changeLanguage("en");
    cliContainer = document.createElement("div");
    document.body.appendChild(cliContainer);
  });

  afterEach(async () => {
    await reactAct(async () => { cliRoot?.unmount(); });
    cliClient?.clear();
    cliRoot = undefined;
    cliClient = undefined;
    cliContainer.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("waits for the real API retry hint and recovers approval without a reload or automatic mutation", async () => {
    fetchCli.mockResolvedValueOnce(response({ error: "Too many CLI auth requests", details: { retryAfterSeconds: 2 } }, 429))
      .mockResolvedValueOnce(response(pending()));
    await mountCli();
    expect(fetchCli).toHaveBeenCalledTimes(1);
    expect(cliContainer.textContent).toContain("Retrying shortly");
    expect(cliContainer.textContent).not.toContain("CLI auth challenge unavailable");
    await advance(1999);
    expect(fetchCli).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchCli).toHaveBeenCalledTimes(2);
    expect(cliClient!.getQueryState(challengeQueryKey)).toMatchObject({ status: "success", fetchStatus: "idle", data: { status: "pending" } });
    await advance(1);
    expect(cliContainer.textContent).toContain("Approve Blentera CLI access");
    expect(fetchCli.mock.calls.map(([url, init]) => [String(url), init?.method]))
      .toEqual([[challengePath, "GET"], [challengePath, "GET"]]);
  });

  it.each([400, 401, 403, 404, 410, 500])("does not retry an ordinary approval GET failure with HTTP%s", async status => {
    fetchCli.mockImplementation(async () => response({ error: "Challenge unavailable" }, status));
    await mountCli();
    expect(cliContainer.textContent).toContain("CLI auth challenge unavailable");
    expect(cliClient!.getQueryState(challengeQueryKey)?.error).toBeInstanceOf(ApiError);
    await advance(10 * 60_000);
    expect(fetchCli).toHaveBeenCalledTimes(1);
  });

  it("uses a nonzero fallback and stops after three retries when the actual challenge expiry is unknown", async () => {
    fetchCli.mockImplementation(async () => response({ error: "Too many CLI auth requests" }, 429));
    await mountCli();
    expect(cliClient!.getQueryData(challengeQueryKey)).toBeUndefined();
    await advance(59_999);
    expect(fetchCli).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchCli).toHaveBeenCalledTimes(2);
    await advance(60_000);
    expect(fetchCli).toHaveBeenCalledTimes(3);
    await advance(60_000);
    expect(fetchCli).toHaveBeenCalledTimes(4);
    expect(cliClient!.getQueryState(challengeQueryKey)).toMatchObject({ status: "error", fetchStatus: "idle", error: { status: 429 } });
    await advance(1);
    expect(cliContainer.textContent).toContain("CLI auth challenge unavailable");
    await advance(10 * 60_000);
    expect(fetchCli).toHaveBeenCalledTimes(4);
  });

  it("does not schedule a hinted retry beyond the actual expiry from an earlier successful read", async () => {
    fetchCli.mockResolvedValueOnce(response(pending(new Date(Date.now() + 1500).toISOString())))
      .mockImplementation(async () => response({ error: "Too many CLI auth requests", details: { retryAfterSeconds: 2 } }, 429));
    await mountCli();
    expect(cliContainer.textContent).toContain("Approve Blentera CLI access");
    await reactAct(async () => { void cliClient!.invalidateQueries({ queryKey: challengeQueryKey }); });
    await advance(0);
    expect(fetchCli).toHaveBeenCalledTimes(2);
    expect(cliContainer.textContent).toContain("CLI auth challenge unavailable");
    await advance(10 * 60_000);
    expect(fetchCli).toHaveBeenCalledTimes(2);
  });

  it("does not shorten a hint that falls outside the finite page retry window", async () => {
    fetchCli.mockImplementation(async () => response({ error: "Too many CLI auth requests", details: { retryAfterSeconds: 600 } }, 429));
    await mountCli();
    expect(cliContainer.textContent).toContain("CLI auth challenge unavailable");
    await advance(20 * 60_000);
    expect(fetchCli).toHaveBeenCalledTimes(1);
  });

  it("retries only the rate-limited read after one operator approval, without resubmitting it", async () => {
    let reads = 0;
    fetchCli.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") return response({ approved: true, status: "approved" });
      reads += 1;
      if (reads === 2) return response({ error: "Too many CLI auth requests", details: { retryAfterSeconds: 2 } }, 429);
      return response({ ...pending(), status: reads > 2 ? "approved" : "pending" });
    });
    await mountCli();
    const approve = [...cliContainer.querySelectorAll("button")].find(button => button.textContent === "Approve CLI access");
    expect(approve).toBeDefined();
    await reactAct(async () => { approve!.click(); });
    await advance(0);
    expect(fetchCli.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(reads).toBe(2);
    await advance(2000);
    expect(reads).toBe(3);
    expect(cliClient!.getQueryState(challengeQueryKey)).toMatchObject({ status: "success", fetchStatus: "idle", data: { status: "approved" } });
    await advance(1);
    expect(cliContainer.textContent).toContain("CLI access approved");
    expect(fetchCli.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => String(url)))
      .toEqual([`/api/cli-auth/challenges/${challengeId}/approve`]);
  });

  it("waits for an authoritative session before reading viewer-specific challenge details", async () => {
    let resolveSession!: (session: ReturnType<typeof v9SessionFixture>) => void;
    getSessionMock.mockReturnValueOnce(new Promise(resolve => { resolveSession = resolve; }));
    fetchCli.mockResolvedValue(response(pending()));
    await mountCli(false);
    expect(fetchCli).not.toHaveBeenCalled();
    resolveSession(v9SessionFixture("operator"));
    await advance(2);
    expect(fetchCli).toHaveBeenCalledTimes(1);
    expect(cliContainer.textContent).toContain("Approve Blentera CLI access");
  });

  it("recovers a failed session read without submitting consent", async () => {
    getSessionMock.mockRejectedValueOnce(new Error("Session unavailable"));
    fetchCli.mockResolvedValue(response(pending()));
    await mountCli(false);
    await advance(2);
    expect(cliContainer.textContent).toContain("Your sign-in could not be checked");
    expect(fetchCli).not.toHaveBeenCalled();
    getSessionMock.mockResolvedValue(v9SessionFixture("operator"));
    const retry = [...cliContainer.querySelectorAll("button")].find(button => button.textContent === "Check sign-in again");
    await reactAct(async () => { retry!.click(); });
    await advance(2);
    expect(cliContainer.textContent).toContain("Approve Blentera CLI access");
    expect(fetchCli.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("denies consent dispatch after a same-Human session renewal in the click boundary", async () => {
    fetchCli.mockResolvedValue(response(pending()));
    await mountCli();
    const approve = [...cliContainer.querySelectorAll("button")].find(button => button.textContent === "Approve CLI access");
    await reactAct(async () => {
      approve!.click();
      const session = v9SessionFixture("operator");
      cliClient!.setQueryData(queryKeys.auth.session, { ...session, session: { ...session.session, id: "renewed-session" } });
    });
    await advance(2);
    expect(fetchCli.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(cliContainer.textContent).not.toContain("Current account access changed");
  });

  it.each(["success", "failure"])("suppresses late consent %s after the current Human changes", async outcome => {
    let finish!: () => void;
    fetchCli.mockImplementation(async (_url, init) => init?.method === "POST"
      ? new Promise((resolve, reject) => { finish = () => outcome === "success" ? resolve(response({ approved: true })) : reject(new Error("Private old Human error")); })
      : response(pending()));
    await mountCli();
    const approve = [...cliContainer.querySelectorAll("button")].find(button => button.textContent === "Approve CLI access");
    await reactAct(async () => { approve!.click(); });
    await advance(0);
    cliClient!.setQueryData(queryKeys.auth.session, v9SessionFixture("other-human"));
    await advance(2);
    const reads = fetchCli.mock.calls.filter(([, init]) => init?.method === "GET").length;
    await reactAct(async () => { finish(); });
    await advance(2);
    expect(fetchCli.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(reads);
    expect(fetchCli.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(cliContainer.textContent).not.toContain("CLI access approved");
    expect(cliContainer.textContent).not.toContain("Private old Human error");
  });

  it("does not reuse a prior Human's cached organization name for the same challenge capability", async () => {
    fetchCli.mockResolvedValueOnce(response({ ...pending(), requestedCompanyName: "Private previous organization" }));
    await mountCli();
    expect(cliContainer.textContent).toContain("Private previous organization");
    let release!: () => void;
    fetchCli.mockImplementation(() => new Promise(resolve => { release = () => resolve(response(pending())); }));
    cliClient!.setQueryData(queryKeys.auth.session, v9SessionFixture("other-human"));
    await advance(2);
    expect(cliContainer.textContent).not.toContain("Private previous organization");
    expect(fetchCli).toHaveBeenCalledTimes(2);
    await reactAct(async () => { release(); });
    await advance(2);
    expect(cliContainer.textContent).not.toContain("Private previous organization");
  });

  it("explains full cross-organization developer authority, expiry and Co-worker exclusion in Danish", async () => {
    await i18n.changeLanguage("da");
    fetchCli.mockResolvedValue(response(pending()));
    await mountCli();
    expect(cliContainer.textContent).toContain("Godkend CLI-adgang til Blentera");
    expect(cliContainer.textContent).toContain("fuld Board-adgang til de organisationer");
    expect(cliContainer.textContent).toContain("aldrig til en Co-worker");
    expect(cliContainer.textContent).toContain("30 dage");
    expect(cliContainer.textContent).toContain("Godkendelsesanmodningen udløber");
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute("content")).toBe("no-referrer");
    expect(fetchCli.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
});
