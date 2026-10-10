import { z } from "zod";

export const workflowLaunchCommandSchema = z.strictObject({
  requestId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime(),
  expectedPublishedRevisionId: z.uuid(),
  expectedDraftRevisionId: z.uuid().nullable(),
  acknowledgeInternalExecution: z.literal(true),
});
/** A durable native admission receipt, not execution or business verification. */
export const workflowLaunchReceiptSchema = z.strictObject({
  companyId: z.uuid(),
  workflowId: z.uuid(),
  requestId: z.uuid(),
  runId: z.uuid(),
  revisionId: z.uuid(),
  disposition: z.literal("admitted"),
});
export type WorkflowLaunchCommand = z.infer<typeof workflowLaunchCommandSchema>;
