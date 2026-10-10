import { expect, it, vi } from "vitest";
import { api } from "./client";
import { maintenanceHistoryApi } from "./maintenance-history";
const company = "11111111-1111-4111-8111-111111111111",
  installation = "22222222-2222-4222-8222-222222222222";
const view = {
  companyId: company,
  installationId: installation,
  agentId: "33333333-3333-4333-8333-333333333333",
  installationVersion: 1,
  installationStatus: "configuring",
  observedAt: "2026-10-10T00:00:00Z",
  entries: [],
  hasMore: false,
};
it("binds private reads to the current principal, company and installation and forwards cancellation", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(view),
    signal = new AbortController().signal;
  try {
    expect(
      await maintenanceHistoryApi.get(
        company,
        "owner + account",
        installation,
        signal,
      ),
    ).toEqual(view);
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining("expectedUserId=owner%20%2B%20account"),
      { signal, cache: "no-store" },
    );
    get.mockResolvedValue({ ...view, companyId: installation });
    await expect(
      maintenanceHistoryApi.get(company, "owner", installation),
    ).rejects.toThrow("Maintenance context changed");
    get.mockResolvedValue({ ...view, rawDetails: "private-source" });
    await expect(
      maintenanceHistoryApi.get(company, "owner", installation),
    ).rejects.toThrow();
    get.mockResolvedValue({
      ...view,
      entries: [
        {
          receiptId: company,
          recordedAt: view.observedAt,
          maintenanceClass: "M2",
          outcome: "configured_activation_required",
        },
        {
          receiptId: company,
          recordedAt: view.observedAt,
          maintenanceClass: "M2",
          outcome: "configured_activation_required",
        },
      ],
    });
    await expect(
      maintenanceHistoryApi.get(company, "owner", installation),
    ).rejects.toThrow("Duplicate maintenance receipt");
  } finally {
    get.mockRestore();
  }
});
