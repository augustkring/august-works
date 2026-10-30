import { afterEach, expect, it, vi } from "vitest";
import { AuthApiError } from "./auth";
import { saasAuthAction } from "./saas";
import { i18n } from "@/i18n";

afterEach(() => vi.unstubAllGlobals());

it("preserves the native password error code for safe localized handling", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    code: "PASSWORD_TOO_COMMON",
    message: "PRIVATE-NATIVE-DETAIL",
  }), { status: 400, headers: { "Content-Type": "application/json" } })));

  let caught: unknown;
  try {
    await saasAuthAction("reset-password", { token: "reset-token", newPassword: "valid-length-password" });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AuthApiError);
  expect(caught).toMatchObject({ status: 400, code: "PASSWORD_TOO_COMMON" });
  expect((caught as Error).message).toBe("PRIVATE-NATIVE-DETAIL");
});

it("sends the currently selected Danish locale with reset requests", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await i18n.changeLanguage("da");
  try {
    await saasAuthAction("request-password-reset", { email: "person@example.test" });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/request-password-reset", expect.objectContaining({
      headers: { "Content-Type": "application/json", "X-Blentera-Locale": "da" },
    }));
  } finally {
    await i18n.changeLanguage("en");
  }
});
