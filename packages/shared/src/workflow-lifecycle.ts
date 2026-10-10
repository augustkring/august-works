import { z } from "zod";

export const workflowLifecycleCommandSchema = z.strictObject({
  requestId: z.uuid(),
  action: z.enum(["pause", "resume", "retire"]),
  expectedStatus: z.enum(["active", "paused"]),
  expectedUpdatedAt: z.iso.datetime(),
  expectedPublishedRevisionId: z.uuid().nullable(),
  expectedDraftRevisionId: z.uuid().nullable(),
  // Pause admits no new work; already admitted work keeps its native recovery/approval policy.
  workPolicy: z.literal("finish_existing"),
});
export type WorkflowLifecycleCommand = z.infer<
  typeof workflowLifecycleCommandSchema
>;
export const workflowLifecycleReceiptSchema = z
  .strictObject({
    requestId: z.uuid(),
    companyId: z.uuid(),
    workflowId: z.uuid(),
    action: z.enum(["pause", "resume", "retire"]),
    status: z.enum(["active", "paused", "archived"]),
    updatedAt: z.iso.datetime(),
    publishedRevisionId: z.uuid().nullable(),
    draftRevisionId: z.uuid().nullable(),
    workPolicy: z.literal("finish_existing"),
  })
  .superRefine((receipt, context) => {
    const expected = {
      pause: "paused",
      resume: "active",
      retire: "archived",
    } as const;
    if (
      receipt.status !== expected[receipt.action] ||
      (receipt.action === "retire" && receipt.draftRevisionId !== null)
    )
      context.addIssue({
        code: "custom",
        message: "Workflow receipt does not match its action",
      });
  });
export type WorkflowLifecycleReceipt = z.infer<
  typeof workflowLifecycleReceiptSchema
>;
