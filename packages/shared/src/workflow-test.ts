import { z } from "zod";

/** This closed command admits native internal C0 testing, never publication. */
export const workflowTestCommandSchema = z.strictObject({
  requestId: z.uuid(),
  expectedWorkflowId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime(),
  expectedDraftRevisionId: z.uuid(),
  expectedRunStatus: z.literal("succeeded"),
  acknowledgeInternalTest: z.literal(true),
});
export const workflowTestReceiptSchema = z.strictObject({
  companyId: z.uuid(),
  workflowId: z.uuid(),
  requestId: z.uuid(),
  runId: z.uuid(),
  revisionId: z.uuid(),
  purpose: z.literal("test"),
  disposition: z.literal("admitted"),
});
export type WorkflowTestCommand = z.infer<typeof workflowTestCommandSchema>;
export type WorkflowTestReceipt = z.infer<typeof workflowTestReceiptSchema>;
