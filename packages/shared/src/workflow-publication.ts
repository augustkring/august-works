import { z } from "zod";
export const workflowPublicationCommandSchema = z.strictObject({
  requestId: z.uuid(),
  expectedWorkflowId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime(),
  expectedDraftRevisionId: z.uuid(),
  expectedPublishedRevisionId: z.uuid().nullable(),
  expectedTestRunId: z.uuid(),
  acknowledgeInternalPublication: z.literal(true),
});
export const workflowPublicationReceiptSchema = z.strictObject({
  companyId: z.uuid(),
  workflowId: z.uuid(),
  requestId: z.uuid(),
  revisionId: z.uuid(),
  testRunId: z.uuid(),
  disposition: z.literal("published"),
});
export const workflowPublicationReviewSchema = z
  .strictObject({
    companyId: z.uuid(),
    workflowId: z.uuid(),
    updatedAt: z.iso.datetime(),
    draftRevisionId: z.uuid().nullable(),
    publishedRevisionId: z.uuid().nullable(),
    draftVersion: z.number().int().positive().nullable(),
    testedRunId: z.uuid().nullable(),
    availability: z.enum([
      "internal_ready",
      "test_required",
      "review_required",
      "no_draft",
      "not_active",
    ]),
    receipt: workflowPublicationReceiptSchema.nullable(),
  })
  .superRefine((view, ctx) => {
    if (
      view.availability === "internal_ready" &&
      (!view.draftRevisionId || !view.draftVersion || !view.testedRunId)
    )
      ctx.addIssue({
        code: "custom",
        message: "Ready publication source bindings are missing",
      });
    if (
      view.receipt &&
      (view.receipt.companyId !== view.companyId ||
        view.receipt.workflowId !== view.workflowId)
    )
      ctx.addIssue({
        code: "custom",
        message: "Publication receipt context changed",
      });
  });
export type WorkflowPublicationCommand = z.infer<
  typeof workflowPublicationCommandSchema
>;
export type WorkflowPublicationReceipt = z.infer<
  typeof workflowPublicationReceiptSchema
>;
export type WorkflowPublicationReview = z.infer<
  typeof workflowPublicationReviewSchema
>;
