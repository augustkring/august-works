import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTenantSessionRecoveryCoordinator,
  tenantSessionRecovery,
} from "@/lib/tenant-session-recovery";
import { authApi } from "./auth";
import { i18n } from "@/i18n";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("authApi.getSession", () => {
  it("returns null for an ordinary local 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(authApi.getSession()).resolves.toBeNull();
  });

  it("initiates recovery and stays pending for a Cloud tenant-session 401", async () => {
    const reload = vi.fn();
    const recovery = createTenantSessionRecoveryCoordinator(reload);
    vi.spyOn(tenantSessionRecovery, "recoverIfNeeded").mockImplementation(recovery.recoverIfNeeded);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "tenant_session_required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = authApi.getSession();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    let settled = false;
    void request.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
  });
});

describe("authApi.signOut", () => {
  it("returns the managed deployment redirect from the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, redirectTo: "/cloud/logout" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(authApi.signOut()).resolves.toEqual({
      success: true,
      redirectTo: "/cloud/logout",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Blentera-Locale": "en" },
      body: "{}",
    });
  });

  it("sends the currently selected Danish locale with native auth requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await i18n.changeLanguage("da");
    try {
      await authApi.signUpEmail({ name: "Test", email: "test@example.test", password: "long-enough-password" });
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-up/email", expect.objectContaining({
        headers: { "Content-Type": "application/json", "X-Blentera-Locale": "da" },
      }));
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("authApi two-factor sign-in", () => {
  it("leaves the ordinary sign-in response on its existing success path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "native-token", user: { id: "human" } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    })));
    await expect(authApi.signInEmail({ email: "person@example.test", password: "secret" })).resolves.toBeNull();
  });

  it("preserves the native challenge response and posts the exact TOTP and recovery-code bodies", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ userId: "human", twoFactorRedirect: true, twoFactorMethods: ["totp"] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "native-token", sessionId: "session-human" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "native-token", sessionId: "session-human" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authApi.signInEmail({ email: "person@example.test", password: "secret" })).resolves.toEqual({
      userId: "human",
      twoFactorRedirect: true,
      twoFactorMethods: ["totp"],
    });
    await authApi.verifyTotp("123456", "human");
    await authApi.verifyBackupCode("ABCD-EFGH", "human");

    for (const [, init] of fetchMock.mock.calls.slice(1)) {
      expect(init?.headers).toMatchObject({ "X-Blentera-Expected-User": "human" });
    }
    expect(fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))])).toEqual([
      ["/api/auth/sign-in/email", { email: "person@example.test", password: "secret" }],
      ["/api/auth/two-factor/verify-totp", { code: "123456" }],
      ["/api/auth/two-factor/verify-backup-code", { code: "ABCD-EFGH" }],
    ]);
  });

  it("keeps native verification error codes available to callers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "INVALID_TOTP", message: "invalid" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    })));
    await expect(authApi.verifyTotp("000000")).rejects.toMatchObject({ status: 400, code: "INVALID_TOTP" });
  });

  it("rejects a malformed native challenge instead of treating it as ordinary sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ twoFactorRedirect: true, twoFactorMethods: [] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    })));
    await expect(authApi.signInEmail({ email: "person@example.test", password: "secret" }))
      .rejects.toThrow("Invalid native two-factor challenge response");
  });
});

describe("authApi password confirmation receipt", () => {
  it("requires the native response to name the replacement session", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessionId: "session-human" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(authApi.reauthenticatePassword("secret", "human", "before-human"))
      .resolves.toEqual({ sessionId: "session-human" });
    expect(fetchMock.mock.calls[0]).toMatchObject(["/api/auth/reauthenticate/password", expect.objectContaining({
      headers: expect.objectContaining({
        "X-Blentera-Expected-User": "human",
        "X-Blentera-Expected-Session": "before-human",
      }),
    })]);
    await expect(authApi.reauthenticatePassword("secret", "human", "before-human")).rejects.toThrow();
  });
});

describe("native security account binding", () => {
  it("reads uncached status with cancellation and refuses another principal in its response", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ userId: "other", hasPassword: true,
      twoFactorEnabled: false, phishingResistantRequired: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(authApi.securityStatus("human", controller.signal)).rejects.toMatchObject({ status: 409, code: "ACCOUNT_CHANGED" });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/security", expect.objectContaining({ cache: "no-store", signal: controller.signal,
      headers: { Accept: "application/json", "X-Blentera-Expected-User": "human" } }));
  });
});

describe("authentication diagnostics", () => {
  it("keeps network diagnostics without logging invitation paths or arbitrary error content", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", { location: new URL("https://app.example.test/invite/invitation-path-secret-canary?token=query-secret-canary") });
    const failure = Object.assign(new TypeError("network-error-secret-canary"), { context: { token: "error-object-secret-canary" } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));

    await expect(authApi.signInEmail({ email: "account-secret-canary@example.test", password: "password-secret-canary" })).rejects.toBe(failure);
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(diagnostic.mock.calls[0]![1]).toMatchObject({ method: "POST", requestUrl: new URL("/api/auth/sign-in/email", window.location.origin).href,
      pageOrigin: window.location.origin, credentials: "include" });
    const logged = JSON.stringify(diagnostic.mock.calls);
    for (const secret of ["network-error-secret-canary", "error-object-secret-canary", "invitation-path-secret-canary", "query-secret-canary", "account-secret-canary", "password-secret-canary"])
      expect(logged).not.toContain(secret);

  });

  it("retains the native auth error contract without logging response bodies or status text", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD",
      message: "response-message-secret-canary", token: "response-token-secret-canary", otp: "response-otp-secret-canary" }), {
      status: 401, statusText: "status-text-secret-canary", headers: { "Content-Type": "application/json" },
    })));
    await expect(authApi.signInEmail({ email: "account@example.test", password: "password-secret-canary" }))
      .rejects.toMatchObject({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" });
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(diagnostic.mock.calls[0]![1]).toMatchObject({ method: "POST", status: 401 });
    const logged = JSON.stringify(diagnostic.mock.calls);
    for (const secret of ["response-message-secret-canary", "response-token-secret-canary", "response-otp-secret-canary", "status-text-secret-canary", "password-secret-canary"])
      expect(logged).not.toContain(secret);
  });
});
