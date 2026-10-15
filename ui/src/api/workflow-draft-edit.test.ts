import { afterEach, expect, it, vi } from "vitest";
import { workflowDraftEditApi } from "./workflow-draft-edit";
import { api } from "./client";
const company = "10000000-0000-4000-8000-000000000001", workflow = "10000000-0000-4000-8000-000000000002";
const revision = "10000000-0000-4000-8000-000000000003", request = "10000000-0000-4000-8000-000000000004";
const review = { companyId: company, workflowId: workflow, draftRevisionId: revision, publishedRevisionId: null,
  updatedAt: "2026-10-14T00:00:00.000Z", version: 3, nodeId: "wait/private", nodeType: "core.wait", name: "Wait", configuration: { kind: "wait", durationSeconds: 3 } };
const command = { requestId: request, expectedWorkflowId: workflow, expectedDraftRevisionId: revision, expectedPublishedRevisionId: null,
  expectedUpdatedAt: review.updatedAt, expectedNodeId: review.nodeId, expectedNodeType: review.nodeType, name: "Wait",
  configuration: { kind: "wait" as const, durationSeconds: 7 } };
afterEach(() => vi.restoreAllMocks());
it("encodes the exact Native node and reads with no-store and the current abort signal", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(review), controller = new AbortController();
  expect(await workflowDraftEditApi.review(company, workflow, "reader", review.nodeId, controller.signal)).toEqual(review);
  expect(get).toHaveBeenCalledWith(expect.stringContaining("wait%2Fprivate"), { signal: controller.signal, cache: "no-store" });
});
it("refuses a foreign draft/node response and an acknowledgement delivered after abort", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ ...review, nodeId: "different" });
  await expect(workflowDraftEditApi.review(company, workflow, "reader", review.nodeId)).rejects.toThrow();
  const controller = new AbortController();
  vi.mocked(api.get).mockImplementation(async () => { controller.abort(); return review; });
  await expect(workflowDraftEditApi.review(company, workflow, "reader", review.nodeId, controller.signal)).rejects.toThrow();
});
it("rejects extra config authority and foreign workflow binding before POST", async () => {
  const post = vi.spyOn(api, "post");
  await expect(workflowDraftEditApi.save(company, workflow, "reader", { ...command, configuration: { ...command.configuration, grant: true } } as never)).rejects.toThrow();
  await expect(workflowDraftEditApi.save(company, request, "reader", command)).rejects.toThrow();
  expect(post).not.toHaveBeenCalled();
});
it("refuses a receipt for another request or reviewed revision after the single command", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue({ companyId: company, workflowId: workflow, requestId: request,
    previousRevisionId: request, draftRevisionId: revision, version: 4, changed: true, recordedAt: review.updatedAt, published: false, executionStarted: false });
  await expect(workflowDraftEditApi.save(company, workflow, "reader", command)).rejects.toThrow();
  expect(post).toHaveBeenCalledTimes(1);
});
