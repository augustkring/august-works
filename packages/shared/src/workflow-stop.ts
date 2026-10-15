import { z } from "zod";

export const workflowStopCommandSchema = z.strictObject({
  requestId: z.uuid(),
  expectedWorkflowId: z.uuid(),
  expectedRevisionId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime(),
  acknowledgeCompletedEffectsRemain: z.literal(true),
});
/** Admission to native cancellation, not proof that all work has stopped. */
export const workflowStopReceiptSchema = z.strictObject({
  companyId: z.uuid(),
  workflowId: z.uuid(),
  runId: z.uuid(),
  revisionId: z.uuid(),
  requestId: z.uuid(),
  disposition: z.literal("cancellation_requested"),
});
export type WorkflowStopCommand = z.infer<typeof workflowStopCommandSchema>;
export type WorkflowStopReceipt = z.infer<typeof workflowStopReceiptSchema>;

/** Minimal retained safety state. No graph, prompts, output or private Source
 * payload is restored by control admission. */
export const workflowRunControlSchema = z.strictObject({ companyId: z.uuid(), workflowId: z.uuid(), runId: z.uuid(), revisionId: z.uuid(),
  updatedAt: z.iso.datetime(), status: z.enum(["queued", "running", "waiting", "recovering", "cancelling", "succeeded", "failed", "cancelled"]),
  purpose: z.enum(["test", "live"]), canRequestStop: z.boolean() });
export type WorkflowRunControl = z.infer<typeof workflowRunControlSchema>;
export const pendingWorkflowStopLocatorsSchema = z.array(z.strictObject({ companyId: z.uuid(), workflowId: z.uuid(), runId: z.uuid(),
  principal: z.string().min(1).max(300), requestId: z.uuid() })).max(32).superRefine((rows, ctx) => {
  if (new Set(rows.map(row => JSON.stringify([row.companyId, row.principal, row.runId]))).size !== rows.length)
    ctx.addIssue({ code: "custom", message: "Each retained run keeps only its original unconfirmed Stop" });
});
