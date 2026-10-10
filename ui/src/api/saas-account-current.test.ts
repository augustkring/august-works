import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { saasApi } from "./saas";
afterEach(() => vi.restoreAllMocks());
it.each([
  ["/saas/account/sessions", saasApi.sessions],
  ["/saas/account/notification-preferences", saasApi.notificationPreferences],
  ["/saas/account/deletion-receipts", saasApi.deletionReceipts],
] as const)("binds %s to the explicit account with an uncached abortable Original GET", async (path, read) => {
  const get = vi.spyOn(api, "get").mockResolvedValue([]);
  const signal = new AbortController().signal;
  await read("private owner", signal);
  const url = new URL(get.mock.calls[0]![0], "https://fixture.invalid");
  expect(url.pathname).toBe(path); expect(url.searchParams.get("expectedUserId")).toBe("private owner");
  expect(get.mock.calls[0]![1]).toEqual({ signal, cache: "no-store" });
});
