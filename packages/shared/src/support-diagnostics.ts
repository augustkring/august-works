import { z } from "zod";
import { workflowRunExperienceSchema } from "./workflow-run-experience.js";
import {
  WORKFLOW_REVISION_STATES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STEP_RUN_STATUSES,
} from "./types/workflow.js";

const traceSummarySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unavailable") }),
  z.strictObject({
    state: z.literal("available"),
    totalAttempts: z.number().int().min(0).max(500),
    attemptStatuses: z
      .array(
        z.strictObject({
          status: z.enum(WORKFLOW_STEP_RUN_STATUSES),
          count: z.number().int().min(1).max(500),
        }),
      )
      .max(WORKFLOW_STEP_RUN_STATUSES.length),
    payloadUnavailableCount: z.number().int().min(0).max(500),
  }),
]);

/** Customer-reviewed local export. No automatic support delivery or telemetry.
 * UUIDs are resource references, not a grant to read the referenced resources. */
export const workflowSupportDiagnosticSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    surface: z.literal("workflow_run"),
    companyId: z.uuid(),
    workflowId: z.uuid(),
    runId: z.uuid(),
    revisionId: z.uuid(),
    revisionNumber: z.number().int().positive(),
    revisionState: z.enum(WORKFLOW_REVISION_STATES),
    sourceUpdatedAt: z.iso.datetime(),
    runStatus: z.enum(WORKFLOW_RUN_STATUSES),
    purpose: z.enum(["test", "live"]),
    verification: z.literal("recorded_execution_only"),
    traceSummary: traceSummarySchema,
  })
  .superRefine((report, ctx) => {
    const trace = report.traceSummary;
    if (trace.state !== "available") return;
    if (
      new Set(trace.attemptStatuses.map((item) => item.status)).size !==
        trace.attemptStatuses.length ||
      trace.attemptStatuses.reduce((total, item) => total + item.count, 0) !==
        trace.totalAttempts ||
      trace.payloadUnavailableCount > trace.totalAttempts
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["traceSummary"],
        message: "Diagnostic trace counts are inconsistent",
      });
    }
  });
export type WorkflowSupportDiagnostic = z.infer<
  typeof workflowSupportDiagnosticSchema
>;

/** Project only an exact bound, current-authorized native view. Do not spread
 * the source: step names and selected branch names can contain customer text. */
export function workflowSupportDiagnostic(
  rawView: unknown,
  context: { companyId: string; workflowId: string; runId: string },
): WorkflowSupportDiagnostic | null {
  const parsed = workflowRunExperienceSchema.safeParse(rawView);
  if (!parsed.success) return null;
  const view = parsed.data;
  if (
    view.companyId !== context.companyId ||
    view.workflowId !== context.workflowId ||
    view.id !== context.runId
  )
    return null;
  const attempts =
    view.trace.state === "available" ? view.trace.attempts : null;
  // Duplicate native attempt IDs are not useful diagnostic evidence.
  if (
    attempts &&
    new Set(attempts.map((attempt) => attempt.id)).size !== attempts.length
  )
    return null;
  return workflowSupportDiagnosticSchema.parse({
    schemaVersion: 1,
    surface: "workflow_run",
    companyId: view.companyId,
    workflowId: view.workflowId,
    runId: view.id,
    revisionId: view.revisionId,
    revisionNumber: view.revisionNumber,
    revisionState: view.revisionState,
    sourceUpdatedAt: view.updatedAt,
    runStatus: view.status,
    purpose: view.purpose,
    verification: "recorded_execution_only",
    traceSummary: attempts
      ? {
          state: "available",
          totalAttempts: attempts.length,
          attemptStatuses: WORKFLOW_STEP_RUN_STATUSES.flatMap((status) => {
            const count = attempts.filter(
              (attempt) => attempt.status === status,
            ).length;
            return count ? [{ status, count }] : [];
          }),
          payloadUnavailableCount: attempts.filter(
            (attempt) => attempt.payloadUnavailable,
          ).length,
        }
      : { state: "unavailable" },
  });
}
