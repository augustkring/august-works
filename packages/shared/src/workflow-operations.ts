import { z } from "zod";
import { WORKFLOW_RUN_STATUSES } from "./types/workflow.js";

const run = z.strictObject({
  id: z.uuid(),
  revisionId: z.uuid(),
  status: z.enum(WORKFLOW_RUN_STATUSES),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
/** Status metadata is not an independently verified business outcome. */
export const workflowOperationsSchema = z
  .strictObject({
    companyId: z.uuid(),
    workflowId: z.uuid(),
    updatedAt: z.iso.datetime(),
    publishedRevisionId: z.uuid().nullable(),
    status: z.enum(["draft", "active", "paused", "archived"]),
    nextTrigger: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("scheduled"), at: z.iso.datetime() }),
      z.strictObject({ state: z.literal("request_or_event") }),
      z.strictObject({ state: z.literal("stopped") }),
      z.strictObject({ state: z.literal("not_published") }),
    ]),
    recent: z.strictObject({
      runs: z.array(run).max(10),
      hasMore: z.boolean(),
    }),
    blockers: z.strictObject({
      runs: z
        .array(run.extend({ status: z.enum(["waiting", "recovering"]) }))
        .max(5),
      hasMore: z.boolean(),
    }),
  })
  .superRefine((value, context) => {
    const expected =
      value.status === "draft"
        ? "not_published"
        : value.status === "active"
          ? null
          : "stopped";
    if (
      (expected && value.nextTrigger.state !== expected) ||
      (!expected &&
        !["scheduled", "request_or_event"].includes(value.nextTrigger.state)) ||
      (value.status === "active" && !value.publishedRevisionId)
    )
      context.addIssue({
        code: "custom",
        message: "Workflow trigger observation is inconsistent",
        path: ["nextTrigger"],
      });
    for (const [name, list] of [
      ["recent", value.recent],
      ["blockers", value.blockers],
    ] as const) {
      if (new Set(list.runs.map((run) => run.id)).size !== list.runs.length)
        context.addIssue({
          code: "custom",
          message: "Duplicate workflow run observation",
          path: [name, "runs"],
        });
    }
  });
export type WorkflowOperations = z.infer<typeof workflowOperationsSchema>;
