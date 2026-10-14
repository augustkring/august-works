import { z } from "zod";
import { workflowStepNameSchema, workflowEditableNodeIdSchema, workflowWaitSecondsSchema, workflowApprovalSummarySchema, workflowApprovalConsequenceSchema } from "./workflow-draft-edit.js";

const name = workflowStepNameSchema;
export const workflowDraftFlowOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("start_manual"), name, deadlineSeconds: z.number().int().min(1).max(60) }),
  z.strictObject({ kind: z.literal("append_wait"), name, durationSeconds: workflowWaitSecondsSchema }),
  z.strictObject({ kind: z.literal("append_approval"), name, summary: workflowApprovalSummarySchema, consequence: workflowApprovalConsequenceSchema }),
  z.strictObject({ kind: z.literal("remove_last") }),
]);
export const workflowDraftFlowCommandSchema = z.strictObject({
  requestId: z.uuid(), expectedWorkflowId: z.uuid(), expectedDraftRevisionId: z.uuid(), expectedPublishedRevisionId: z.uuid().nullable(),
  expectedUpdatedAt: z.iso.datetime(), expectedLastNodeId: workflowEditableNodeIdSchema.nullable(), operation: workflowDraftFlowOperationSchema,
});
export const workflowDraftFlowReviewSchema = z.strictObject({
  companyId: z.uuid(), workflowId: z.uuid(), draftRevisionId: z.uuid(), publishedRevisionId: z.uuid().nullable(),
  updatedAt: z.iso.datetime(), version: z.number().int().positive(), availability: z.enum(["empty", "linear", "advanced"]),
  deadlineSeconds: z.number().int().min(1).max(604800).nullable(),
  steps: z.array(z.strictObject({ nodeId: workflowEditableNodeIdSchema, name, type: z.string().min(1).max(160) })).max(100),
}).superRefine((view, ctx) => {
  if ((view.availability === "linear") !== (view.steps.length > 0)) ctx.addIssue({ code: "custom", path: ["steps"], message: "The current flow shape changed" });
  if (view.steps.length && (view.steps[0].type !== "core.manual_trigger" || new Set(view.steps.map(step => step.nodeId)).size !== view.steps.length))
    ctx.addIssue({ code: "custom", path: ["steps"], message: "The current flow identity changed" });
});
export type WorkflowDraftFlowReview = z.infer<typeof workflowDraftFlowReviewSchema>;
export type WorkflowDraftFlowCommand = z.infer<typeof workflowDraftFlowCommandSchema>;
export type WorkflowDraftFlowOperation = z.infer<typeof workflowDraftFlowOperationSchema>;
