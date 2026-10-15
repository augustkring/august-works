import { expect, it, vi } from "vitest";
import { api } from "./client";
import { experienceMeasuresApi } from "./experience-measures";
it("binds content-free measures to the current company/account, disables caching and forwards cancellation", async () => {
  const company = "11111111-1111-4111-8111-111111111111";
  const view = { companyId: company, observedAt: "2026-10-11T00:00:00Z", contractId: "aw.activation-owner-measures.v1",
    status: "not_recorded", creationToVerificationBucket: null, recordedSetupChangesBucket: null, setupWindow: "not_applicable", usableBaseline: "unavailable" };
  const get = vi.spyOn(api, "get").mockResolvedValue(view), signal = new AbortController().signal;
  try {
    expect(await experienceMeasuresApi.get(company, "owner + account", signal)).toEqual(view);
    expect(get).toHaveBeenCalledWith(`/companies/${company}/experience/analytics?expectedUserId=owner%20%2B%20account`, { signal, cache: "no-store" });
    get.mockResolvedValue({ ...view, companyId: "22222222-2222-4222-8222-222222222222" });
    await expect(experienceMeasuresApi.get(company, "owner")).rejects.toThrow("Experience measurement context changed");
    get.mockResolvedValue({ ...view, output: "PRIVATE" });
    await expect(experienceMeasuresApi.get(company, "owner")).rejects.toThrow();
  } finally { get.mockRestore(); }
});
