import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value) &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value), "Use valid readable text");
export const workflowEditableNodeIdSchema = text(160);
export const workflowStepConfigurationChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("keep") }),
  z.strictObject({ kind: z.literal("wait"), durationSeconds: z.number().int().min(1).max(604800) }),
  z.strictObject({ kind: z.literal("approval"), summary: text(1000), consequence: text(2000) }),
]);
export const workflowDraftStepReviewSchema = z.strictObject({
  companyId: z.uuid(), workflowId: z.uuid(), draftRevisionId: z.uuid(), publishedRevisionId: z.uuid().nullable(),
  updatedAt: z.iso.datetime(), version: z.number().int().positive(), nodeId: workflowEditableNodeIdSchema,
  nodeType: text(160), name: text(200), configuration: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("advanced") }),
    z.strictObject({ kind: z.literal("wait"), durationSeconds: z.number().int().min(1).max(604800) }),
    z.strictObject({ kind: z.literal("approval"), summary: text(1000), consequence: text(2000) }),
  ]),
});
export const workflowDraftStepCommandSchema = z.strictObject({
  requestId: z.uuid(), expectedWorkflowId: z.uuid(), expectedDraftRevisionId: z.uuid(), expectedPublishedRevisionId: z.uuid().nullable(),
  expectedUpdatedAt: z.iso.datetime(), expectedNodeId: workflowEditableNodeIdSchema, expectedNodeType: text(160),
  name: text(200), configuration: workflowStepConfigurationChangeSchema,
});
export const workflowDraftStepReceiptSchema = z.strictObject({
  companyId: z.uuid(), workflowId: z.uuid(), requestId: z.uuid(), previousRevisionId: z.uuid(), draftRevisionId: z.uuid(),
  version: z.number().int().positive(), changed: z.boolean(), recordedAt: z.iso.datetime(),
  published: z.literal(false), executionStarted: z.literal(false),
});
export type WorkflowDraftStepReview = z.infer<typeof workflowDraftStepReviewSchema>;
export type WorkflowDraftStepCommand = z.infer<typeof workflowDraftStepCommandSchema>;
export type WorkflowDraftStepReceipt = z.infer<typeof workflowDraftStepReceiptSchema>;
