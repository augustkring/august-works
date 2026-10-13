import { afterEach, expect, it, vi } from "vitest";
import { orchestrationControlApi } from "./orchestration-control";
import { api } from "./client";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const receipt = { companyId: id(1), planId: id(2), requestId: id(3), action: "cancel", resultingVersion: 2,
  disposition: "control_requested", propagation: "pending_verification" };
afterEach(() => vi.restoreAllMocks());
it("recovers by a single no-store scoped GET without retrying a decision", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(receipt), post = vi.spyOn(api, "post");
  expect(await orchestrationControlApi.receipt(id(1), "controller", id(2), id(3))).toEqual(receipt);
  expect(get).toHaveBeenCalledExactlyOnceWith(`/companies/${id(1)}/experience/orchestration/${id(2)}/control-requests/${id(3)}?expectedUserId=controller`, { signal: undefined, cache: "no-store" });
  expect(post).not.toHaveBeenCalled();
});
it("rejects foreign identities and forged delivery claims", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ ...receipt, planId: id(9) });
  await expect(orchestrationControlApi.receipt(id(1), "controller", id(2), id(3))).rejects.toThrow();
  get.mockResolvedValue({ ...receipt, propagation: "all_workers_stopped" });
  await expect(orchestrationControlApi.receipt(id(1), "controller", id(2), id(3))).rejects.toThrow();
});
