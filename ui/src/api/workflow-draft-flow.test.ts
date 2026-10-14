import { afterEach, expect, it, vi } from "vitest";
import { workflowDraftFlowApi } from "./workflow-draft-flow";
import { api } from "./client";
const company = "10000000-0000-4000-8000-000000000001", workflow = "10000000-0000-4000-8000-000000000002", revision = "10000000-0000-4000-8000-000000000003";
const view = { companyId: company, workflowId: workflow, draftRevisionId: revision, publishedRevisionId: null,
  updatedAt: "2026-10-14T00:00:00.000Z", version: 1, deadlineSeconds: null, availability: "empty", steps: [] };
afterEach(() => vi.restoreAllMocks());
it("reads current exact Native flow with no-store and rejects foreign or aborted responses", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(view), controller = new AbortController();
  expect(await workflowDraftFlowApi.review(company, workflow, "editor", controller.signal)).toEqual(view);
  expect(get).toHaveBeenCalledWith(expect.stringContaining("expectedUserId=editor"), { cache: "no-store", signal: controller.signal });
  get.mockResolvedValue({ ...view, companyId: workflow }); await expect(workflowDraftFlowApi.review(company, workflow, "editor")).rejects.toThrow();
  get.mockImplementation(async () => { controller.abort(); return view; }); await expect(workflowDraftFlowApi.review(company, workflow, "editor", controller.signal)).rejects.toThrow();
});
it("rejects hidden graph/grant authority and wrong workflow binding before POST", async () => {
  const post = vi.spyOn(api, "post"), command = { requestId: revision, expectedWorkflowId: workflow, expectedDraftRevisionId: revision,
    expectedPublishedRevisionId: null, expectedUpdatedAt: view.updatedAt, expectedLastNodeId: null, operation: { kind: "start_manual" as const, deadlineSeconds: 30, name: "Start", grant: true } };
  await expect(workflowDraftFlowApi.save(company, workflow, "editor", command)).rejects.toThrow();
  await expect(workflowDraftFlowApi.save(company, revision, "editor", { ...command, operation: { kind: "start_manual", deadlineSeconds: 30, name: "Start" } })).rejects.toThrow();
  expect(post).not.toHaveBeenCalled();
});
