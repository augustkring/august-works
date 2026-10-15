import { expect, it, vi, afterEach } from "vitest";
import { getOrchestrationExperience } from "./orchestration-experience";
import { api } from "./client";
const company = "10000000-0000-4000-8000-000000000001";
const data = { companyId: company, observedAt: "2026-10-13T19:00:00.000Z", modelCalled: false, coverage: "bounded", hasMore: false, canInspect: false, rows: [] };
afterEach(() => vi.restoreAllMocks());
it("performs one current-account GET without caching or mutation", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(data), post = vi.spyOn(api, "post");
  expect(await getOrchestrationExperience(company, "own account")).toEqual(data);
  expect(get).toHaveBeenCalledExactlyOnceWith(`/companies/${company}/experience/orchestration?expectedUserId=own+account`, { signal: undefined, cache: "no-store" });
  expect(post).not.toHaveBeenCalled();
});
it("refuses a foreign company, hidden payload and a late aborted response", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ ...data, companyId: "10000000-0000-4000-8000-000000000009" });
  await expect(getOrchestrationExperience(company, "owner")).rejects.toThrow();
  get.mockResolvedValue({ ...data, prompt: "PRIVATE" }); await expect(getOrchestrationExperience(company, "owner")).rejects.toThrow();
  const controller = new AbortController(); get.mockImplementation(async () => { controller.abort(); return data; });
  await expect(getOrchestrationExperience(company, "owner", controller.signal)).rejects.toThrow();
});
