import { z } from "zod";
import { workflowStopReceiptSchema } from "./workflow-stop.js";
import {
  WORKFLOW_REVISION_STATES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STEP_RUN_STATUSES,
  WORKFLOW_WAIT_KINDS,
} from "./types/workflow.js";

export const workflowRunExperienceSchema = z
  .strictObject({
    companyId: z.uuid(),
    id: z.uuid(),
    workflowId: z.uuid(),
    revisionId: z.uuid(),
    revisionNumber: z.number().int().positive(),
    revisionState: z.enum(WORKFLOW_REVISION_STATES),
    status: z.enum(WORKFLOW_RUN_STATUSES),
    updatedAt: z.iso.datetime(),
    canRequestStop: z.boolean(),
    stopReceipt: workflowStopReceiptSchema.nullable(),
    trace: z.discriminatedUnion("state", [
      z.strictObject({
        state: z.literal("available"),
        attempts: z
          .array(
            z.strictObject({
              id: z.uuid(),
              name: z.string().max(160),
              operation: z.string().max(160),
              attempt: z.number().int().positive(),
              status: z.enum(WORKFLOW_STEP_RUN_STATUSES),
              execution: z.enum(["agent", "tool", "not_recorded"]),
              approvalCheckpoint: z.boolean(),
              payloadUnavailable: z.boolean(),
              branchChoice: z.discriminatedUnion("state", [
                z.strictObject({ state: z.literal("not_applicable") }),
                z.strictObject({ state: z.literal("not_recorded") }),
                z.strictObject({
                  state: z.literal("selected"),
                  nextStep: z.string().max(160),
                }),
              ]),
              waitingFor: z
                .array(z.enum(WORKFLOW_WAIT_KINDS))
                .max(WORKFLOW_WAIT_KINDS.length),
            }),
          )
          .max(500),
      }),
      z.strictObject({ state: z.literal("unavailable") }),
    ]),
  })
  .superRefine((view, ctx) => {
    const receipt = view.stopReceipt;
    if (
      receipt &&
      (!view.canRequestStop ||
        receipt.companyId !== view.companyId ||
        receipt.workflowId !== view.workflowId ||
        receipt.runId !== view.id ||
        receipt.revisionId !== view.revisionId)
    )
      ctx.addIssue({
        code: "custom",
        path: ["stopReceipt"],
        message: "Workflow stop receipt context changed",
      });
  });
export type WorkflowRunExperience = z.infer<typeof workflowRunExperienceSchema>;
