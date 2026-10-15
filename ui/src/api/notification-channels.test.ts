import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { saasApi } from "./saas";
const companyId = "10000000-0000-4000-8000-000000000001", requestId = "10000000-0000-4000-8000-000000000002";
const input = { requestId, deliveryLocale: "da" as const, expectedVersion: 0, expectedBaselineHash: "a".repeat(64), choice: { channel: "default" as const } };
const receipt = { companyId, userId: "owner", category: "work_update", requestId, version: 1, channel: "default",
  preferenceApplied: true, messageSent: false, authorityGranted: false, executionStarted: false };
const view = { companyId, userId: "owner", category: "work_update", version: 0, channel: "default", deliveryLocale: "en", availability: "default",
  baselineHash: "a".repeat(64), target: null, targets: [], targetsLimited: false };
afterEach(() => vi.restoreAllMocks());
it("reads only the explicit own-company category without caching private targets or receipts", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValueOnce(view).mockResolvedValueOnce(receipt), signal = new AbortController().signal;
  await saasApi.notificationChannelPreference(companyId, "owner", "work_update", signal);
  await saasApi.notificationChannelReceipt(companyId, "owner", "work_update", requestId, signal);
  for (const [url, options] of get.mock.calls) {
    const path = new URL(url, "https://fixture.invalid"); expect(path.pathname).toContain(`/companies/${companyId}/notifications/channel-preferences/work_update`);
    expect(path.searchParams.get("expectedUserId")).toBe("owner"); expect(options).toEqual({ signal, cache: "no-store" });
  }
});
it("rejects a foreign or inconsistent private preference before displaying it", async () => {
  const get = vi.spyOn(api, "get");
  for (const changed of [{ userId: "other" }, { companyId: requestId }, { category: "approval" }, { channel: "slack" }]) {
    get.mockResolvedValueOnce({ ...view, ...changed });
    await expect(saasApi.notificationChannelPreference(companyId, "owner", "work_update")).rejects.toBeTruthy();
  }
});
it("accepts only the exact Original command receipt with its next version and selected channel", async () => {
  const post = vi.spyOn(api, "post");
  for (const changed of [{ userId: "other" }, { requestId: companyId }, { version: 2 }, { channel: "slack" }, { messageSent: true }]) {
    post.mockResolvedValueOnce({ ...receipt, ...changed });
    await expect(saasApi.updateNotificationChannel(companyId, "owner", "work_update", input)).rejects.toBeTruthy();
  }
  post.mockResolvedValueOnce(receipt);
  expect(await saasApi.updateNotificationChannel(companyId, "owner", "work_update", input)).toEqual(receipt);
  expect(post.mock.calls.at(-1)![1]).toEqual(input);
});
it("accepts an absent receipt as unresolved and refuses another request or actor", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValueOnce(null);
  expect(await saasApi.notificationChannelReceipt(companyId, "owner", "work_update", requestId)).toBeNull();
  for (const changed of [{ userId: "other" }, { requestId: companyId }]) {
    get.mockResolvedValueOnce({ ...receipt, ...changed });
    await expect(saasApi.notificationChannelReceipt(companyId, "owner", "work_update", requestId)).rejects.toBeTruthy();
  }
});
