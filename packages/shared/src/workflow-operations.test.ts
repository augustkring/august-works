import { expect, it } from "vitest";
import { workflowOperationsSchema } from "./workflow-operations.js";

const id = "10000000-0000-4000-8000-000000000001";
const observed = "2026-10-09T10:00:00.000Z";
const run: {
  id: string;
  revisionId: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  outputJson?: unknown;
} = {
  id,
  revisionId: id,
  status: "waiting",
  createdAt: observed,
  finishedAt: null,
};
const view = {
  companyId: id,
  workflowId: id,
  updatedAt: observed,
  publishedRevisionId: id as string | null,
  status: "active",
  nextTrigger: { state: "request_or_event" } as { state: string; at?: string },
  recent: { runs: [run], hasMore: false },
  blockers: { runs: [run], hasMore: false },
};
it.each([
  "private_payload",
  "unpublished_active",
  "paused_schedule",
  "duplicate_run",
  "too_many_recent",
  "terminal_blocker",
])(
  "refuses a misleading or disclosing workflow operation response: %s",
  (scenario) => {
    const source = structuredClone(view);
    if (scenario === "private_payload")
      source.recent.runs[0].outputJson = { private: "CANARY" };
    if (scenario === "unpublished_active") source.publishedRevisionId = null;
    if (scenario === "paused_schedule") {
      source.status = "paused";
      source.nextTrigger = { state: "scheduled", at: observed };
    }
    if (scenario === "duplicate_run") source.recent.runs.push(run);
    if (scenario === "too_many_recent")
      source.recent.runs = Array.from({ length: 11 }, () => run);
    if (scenario === "terminal_blocker")
      source.blockers.runs[0].status = "succeeded";
    expect(workflowOperationsSchema.safeParse(source).success).toBe(false);
  },
);
it("allows recorded completion without inventing an independent verification field", () => {
  const source = structuredClone(view);
  source.recent.runs[0] = { ...run, status: "succeeded", finishedAt: observed };
  expect(workflowOperationsSchema.parse(source).recent.runs[0].status).toBe(
    "succeeded",
  );
  expect(
    workflowOperationsSchema.safeParse({
      ...source,
      independentlyVerified: true,
    }).success,
  ).toBe(false);
});
