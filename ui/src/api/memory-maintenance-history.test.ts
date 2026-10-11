import { expect, it, vi } from "vitest";
import { api } from "./client";
import { memoryMaintenanceHistoryApi } from "./memory-maintenance-history";
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
