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
