import { afterEach, expect, it, vi } from "vitest";
import { memoryMaintenanceHistoryApi } from "./memory-maintenance-history";
import { api } from "./client";

const companyId = "33333333-3333-4333-8333-333333333333", jobId = "11111111-1111-4111-8111-111111111111";
const view = { companyId, observedAt: "2026-10-11T00:00:05Z", hasMore: false, entries: [{
  jobId, maintenanceClass: "M1", attemptNumber: 1, submittedAt: "2026-10-11T00:00:00Z", startedAt: "2026-10-11T00:00:01Z",
  finishedAt: null, leaseExpiresAt: "2026-10-11T00:00:04Z", outcome: "unconfirmed", receiptId: null, indexedRecordCount: null,
}] };
afterEach(() => vi.restoreAllMocks());
it("reads the exact original job with the expected account and no-store", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(view), signal = new AbortController().signal;
  expect(await memoryMaintenanceHistoryApi.get(companyId, "owner", signal, jobId)).toEqual(view);
  expect(get).toHaveBeenCalledWith(`/companies/${companyId}/memory/experience/maintenance?expectedUserId=owner&jobId=${jobId}`,
    { signal, cache: "no-store" });
});
it("refuses a substituted job or tenant and permits an absent exact observation", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValueOnce({ ...view, entries: [{ ...view.entries[0], jobId: companyId }] })
    .mockResolvedValueOnce({ ...view, companyId: jobId }).mockResolvedValueOnce({ ...view, entries: [] });
  await expect(memoryMaintenanceHistoryApi.get(companyId, "owner", undefined, jobId)).rejects.toThrow("context changed");
  await expect(memoryMaintenanceHistoryApi.get(companyId, "owner", undefined, jobId)).rejects.toThrow("context changed");
  expect((await memoryMaintenanceHistoryApi.get(companyId, "owner", undefined, jobId)).entries).toEqual([]);
  expect(get).toHaveBeenCalledTimes(3);
});
it("refuses a malformed job reference before any private read", async () => {
  const get = vi.spyOn(api, "get");
  await expect(memoryMaintenanceHistoryApi.get(companyId, "owner", undefined, "../foreign?PRIVATE=VALUE")).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});

it("binds minimized private history to the company and account and forwards cancellation", async () => {
  const company = "11111111-1111-4111-8111-111111111111";
  const view = { companyId: company, observedAt: "2026-10-11T00:00:00Z", entries: [], hasMore: false };
  const get = vi.spyOn(api, "get").mockResolvedValue(view);
  const signal = new AbortController().signal;
  try {
    expect(await memoryMaintenanceHistoryApi.get(company, "owner + account", signal)).toEqual(view);
    expect(get).toHaveBeenCalledWith(`/companies/${company}/memory/experience/maintenance?expectedUserId=owner%20%2B%20account`, { signal, cache: "no-store" });
    get.mockResolvedValue({ ...view, companyId: "22222222-2222-4222-8222-222222222222" });
    await expect(memoryMaintenanceHistoryApi.get(company, "owner")).rejects.toThrow("Memory maintenance context changed");
    get.mockResolvedValue({ ...view, requester: "private-account" });
    await expect(memoryMaintenanceHistoryApi.get(company, "owner")).rejects.toThrow();
  } finally { get.mockRestore(); }
});
