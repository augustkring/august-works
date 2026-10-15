import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { approvalsApi } from "./approvals";
import { agentAuthoringApi } from "./agent-authoring";
import { createWorkflowsApi } from "./workflows";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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

// Same account, same URL, two source generations. The second private read must
// not inherit the transport started before the new authority/source check.
it.each(["tool", "checkpoint"] as const)("starts a fresh %s transport even while an older read is pending", async kind => {
  const values = [{ generation: "old" }, { generation: "current" }];
  const fetch = vi.fn().mockImplementationOnce(async () => new Response(JSON.stringify(values[0]), { status: 200 }))
    .mockImplementationOnce(async () => new Response(JSON.stringify(values[1]), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const read = () => kind === "tool" ? createWorkflowsApi().toolReviews("fresh-company", "fresh-run", "same-user")
    : approvalsApi.get("fresh-approval", "same-user");
  const older = read(), current = read();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await older).toEqual(values[0]); expect(await current).toEqual(values[1]);
});

it("starts a fresh Native Agent admission transport after a new decision boundary", async () => {
  const companyId = "10000000-0000-4000-8000-000000000001", agentId = "10000000-0000-4000-8000-000000000002";
  const value = { companyId, agentId, canCreateDraft: true };
  const fetch = vi.fn(async () => new Response(JSON.stringify(value), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const older = agentAuthoringApi.admission(companyId, "same-user", agentId);
  const current = agentAuthoringApi.admission(companyId, "same-user", agentId);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await older).toEqual(value); expect(await current).toEqual(value);
});
