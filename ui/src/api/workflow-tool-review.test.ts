import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { createWorkflowsApi } from "./workflows";
afterEach(() => vi.restoreAllMocks());
it("carries current account binding and cancellation on a private review read", async () => {
  const read = vi.spyOn(api, "get").mockResolvedValue({ canReview: false, reviews: [] });
  const signal = new AbortController().signal;
  await createWorkflowsApi().toolReviews("company", "run", "user & account", signal);
  expect(read).toHaveBeenCalledExactlyOnceWith("/companies/company/workflow-runs/run/tool-reviews?expectedUserId=user+%26+account", { signal, cache: "no-store" });
});
it("rejects a decision acknowledgement for a different company or run", async () => {
  const post = vi.spyOn(api, "post");
  for (const run of [{ companyId: "other", id: "run" }, { companyId: "company", id: "other" }]) {
    post.mockResolvedValue({ run });
    await expect(createWorkflowsApi().resolveToolReview("company", "run", "request", "approve", "reviewer")).rejects.toThrow("changed scope");
  }
  expect(post).toHaveBeenLastCalledWith("/companies/company/workflow-runs/run/tool-reviews/request/approve?expectedUserId=reviewer", {});
});
