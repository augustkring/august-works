import { afterEach, expect, it, vi } from "vitest";
import { workflowRunControlApi } from "./workflow-run-control";
import { api } from "./client";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const view = { companyId: id(1), workflowId: id(2), runId: id(3), revisionId: id(4), updatedAt: "2026-10-13T22:00:00.000Z", status: "queued", purpose: "live", canRequestStop: true };
const receipt = { companyId: id(1), workflowId: id(2), runId: id(3), revisionId: id(4), requestId: id(5), disposition: "cancellation_requested" };
afterEach(() => vi.restoreAllMocks());
it("uses exact no-store current control/receipt GETs without a write or private Source body", async () => {
  const controller = new AbortController(), get = vi.spyOn(api, "get").mockResolvedValueOnce(view).mockResolvedValueOnce(receipt), post = vi.spyOn(api, "post");
  expect(await workflowRunControlApi.get(id(1), "controller", id(2), id(3), controller.signal)).toEqual(view);
  expect(await workflowRunControlApi.receipt(id(1), "controller", id(2), id(3), id(5), controller.signal)).toEqual(receipt);
  expect(get.mock.calls.map(call => call[1])).toEqual([{ signal: controller.signal, cache: "no-store" }, { signal: controller.signal, cache: "no-store" }]);
  expect(post).not.toHaveBeenCalled();
});
it.each(["companyId", "workflowId", "runId"] as const)("rejects a foreign %s control and receipt", async field => {
  vi.spyOn(api, "get").mockResolvedValueOnce({ ...view, [field]: id(9) }).mockResolvedValueOnce({ ...receipt, [field]: id(9) });
  await expect(workflowRunControlApi.get(id(1), "controller", id(2), id(3))).rejects.toThrow("scope changed");
  await expect(workflowRunControlApi.receipt(id(1), "controller", id(2), id(3), id(5))).rejects.toThrow("scope changed");
});
it("rejects an aborted current response and a different reviewed revision acknowledgement", async () => {
  const controller = new AbortController(); vi.spyOn(api, "get").mockImplementation(async () => { controller.abort(); return view; });
  await expect(workflowRunControlApi.get(id(1), "controller", id(2), id(3), controller.signal)).rejects.toThrow();
  vi.spyOn(api, "post").mockResolvedValue({ ...receipt, revisionId: id(9) });
  await expect(workflowRunControlApi.stop(id(1), "controller", id(2), id(3), { requestId: id(5), expectedWorkflowId: id(2), expectedRevisionId: id(4),
    expectedUpdatedAt: view.updatedAt, acknowledgeCompletedEffectsRemain: true })).rejects.toThrow("revision changed");
});
