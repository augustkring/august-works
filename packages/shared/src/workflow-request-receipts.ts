import { z } from "zod";
import { workflowTestReceiptSchema } from "./workflow-test.js";
import { workflowPublicationReceiptSchema } from "./workflow-publication.js";
import { workflowLaunchReceiptSchema } from "./workflow-launch.js";
import { workflowLifecycleReceiptSchema } from "./workflow-lifecycle.js";
import { workflowDraftStepReceiptSchema } from "./workflow-draft-edit.js";

export const workflowRequestKindSchema = z.enum(["test", "publication", "launch", "lifecycle", "draft_edit"]);
export type WorkflowRequestKind = z.infer<typeof workflowRequestKindSchema>;
/** Historical Original admission only. There is no claim of current state,
 * completed execution, physical propagation or independent verification. */
export const workflowRequestReceiptSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("test"), receipt: workflowTestReceiptSchema }),
  z.strictObject({ kind: z.literal("publication"), receipt: workflowPublicationReceiptSchema }),
  z.strictObject({ kind: z.literal("launch"), receipt: workflowLaunchReceiptSchema }),
  z.strictObject({ kind: z.literal("lifecycle"), receipt: workflowLifecycleReceiptSchema }),
  z.strictObject({ kind: z.literal("draft_edit"), receipt: workflowDraftStepReceiptSchema }),
]);
export type WorkflowRequestReceipt = z.infer<typeof workflowRequestReceiptSchema>;
export const workflowRequestLocatorSchema = z.strictObject({ companyId: z.uuid(), workflowId: z.uuid(),
  principal: z.string().min(1).max(300), kind: workflowRequestKindSchema, requestId: z.uuid() });
export const pendingWorkflowRequestLocatorsSchema = z.array(workflowRequestLocatorSchema).max(32).superRefine((rows, ctx) => {
  if (new Set(rows.map(row => JSON.stringify([row.companyId, row.workflowId, row.principal, row.kind]))).size !== rows.length)
    ctx.addIssue({ code: "custom", message: "Each workflow operation retains only its original unconfirmed request" });
});
export type WorkflowRequestLocator = z.infer<typeof workflowRequestLocatorSchema>;
