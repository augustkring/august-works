import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { workflowAuthoringExperienceApi } from "./workflow-authoring-experience";
const company = "10000000-0000-4000-8000-000000000001", requestId = "10000000-0000-4000-8000-000000000002";
const command = { requestId, locale: "en" as const, name: "Review", outcome: "A draft", trigger: "", sources: "", conditions: "", finalEffect: "", humanJudgment: "" };
const receipt = { companyId: company, workflowId: "10000000-0000-4000-8000-000000000003", requestId,
  draftRevisionId: "10000000-0000-4000-8000-000000000004", createdAt: "2026-10-13T18:00:00.000Z", executionStarted: false, published: false };
afterEach(() => vi.restoreAllMocks());
it("reads exact own-account receipts without caching or write replay", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(receipt), post = vi.spyOn(api, "post");
  expect(await workflowAuthoringExperienceApi.receipt(company, "owner&other", requestId)).toEqual(receipt);
  expect(new URL(get.mock.calls[0]![0], "https://fixture.invalid").searchParams.get("expectedUserId")).toBe("owner&other");
  expect(get.mock.calls[0]![1]).toMatchObject({ cache: "no-store" }); expect(post).not.toHaveBeenCalled();
});
it("refuses foreign scope, different request identities and invented success fields", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ ...receipt, companyId: receipt.workflowId });
  await expect(workflowAuthoringExperienceApi.receipt(company, "owner", requestId)).rejects.toThrow();
  get.mockResolvedValue({ ...receipt, requestId: receipt.workflowId });
  await expect(workflowAuthoringExperienceApi.receipt(company, "owner", requestId)).rejects.toThrow();
  get.mockResolvedValue({ ...receipt, executionStarted: true });
  await expect(workflowAuthoringExperienceApi.receipt(company, "owner", requestId)).rejects.toThrow();
  get.mockResolvedValue({ ...receipt, sourceRunId: receipt.workflowId });
  await expect(workflowAuthoringExperienceApi.receipt(company, "owner", requestId)).rejects.toThrow();
});
it("sends one strict creation body and treats a foreign acknowledgement as uncertain", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue({ ...receipt, requestId: receipt.workflowId });
  await expect(workflowAuthoringExperienceApi.create(company, "owner", command)).rejects.toThrow();
  expect(post).toHaveBeenCalledTimes(1); expect(post.mock.calls[0]![1]).toEqual(command);
});
it("refuses an index for another company and a late aborted read", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ companyId: receipt.workflowId, canCreateDraft: true, coverage: "bounded", workflows: [] });
  await expect(workflowAuthoringExperienceApi.index(company, "owner")).rejects.toThrow();
  get.mockResolvedValue({ companyId: company, canCreateDraft: false, coverage: "bounded", workflows: [] });
  const controller = new AbortController(); controller.abort();
  await expect(workflowAuthoringExperienceApi.index(company, "owner", controller.signal)).rejects.toThrow();
});
it("binds author choices to the current company and workflow and rejects extra authority fields", async () => {
  const view = { companyId: company, workflowId: receipt.workflowId, draftRevisionId: receipt.draftRevisionId,
    publishedRevisionId: null, observedAt: receipt.createdAt, enabled: true, coverage: "bounded", choices: [] };
  const get = vi.spyOn(api, "get").mockResolvedValue(view), post = vi.spyOn(api, "post");
  expect(await workflowAuthoringExperienceApi.authors(company, receipt.workflowId, "owner&other")).toEqual(view);
  expect(new URL(get.mock.calls[0]![0], "https://fixture.invalid").searchParams.get("expectedUserId")).toBe("owner&other");
  expect(get.mock.calls[0]![1]).toMatchObject({ cache: "no-store" }); expect(post).not.toHaveBeenCalled();
  get.mockResolvedValue({ ...view, workflowId: requestId });
  await expect(workflowAuthoringExperienceApi.authors(company, receipt.workflowId, "owner")).rejects.toThrow();
  get.mockResolvedValue({ ...view, grants: [] });
  await expect(workflowAuthoringExperienceApi.authors(company, receipt.workflowId, "owner")).rejects.toThrow();
});
