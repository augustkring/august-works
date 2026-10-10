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
