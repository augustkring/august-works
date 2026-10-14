import { z } from "zod";
import { workflowTestReceiptSchema } from "./workflow-test.js";

const stepSchema = z.strictObject({
  nodeId: z.string().min(1).max(160).optional(),
  number: z.number().int().min(1).max(100),
  name: z.string().max(160),
  operation: z.string().max(160),
  effect: z.enum([
    "pure",
    "read",
    "write",
    "destructive",
    "external_communication",
    "financial",
    "privileged",
    "unknown",
  ]),
  testMode: z.enum(["safe", "dry_run", "sandbox", "live_only", "unavailable"]),
  approval: z.enum(["checkpoint", "not_verified"]),
  retry: z.enum(["none", "declared", "unknown"]),
  next: z
    .array(
      z.strictObject({
        number: z.number().int().min(1).max(100),
        label: z.string().max(160).nullable(),
        output: z.string().max(160).nullable(),
      }),
    )
    .max(200),
});
export const workflowExperienceRevisionSchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
  state: z.enum(["draft", "published"]),
  coverage: z.enum(["complete", "flow_unavailable"]),
  steps: z.array(stepSchema).max(100),
});
export const workflowExperienceSchema = z
  .strictObject({
    companyId: z.uuid(),
    id: z.uuid(),
    name: z.string().max(160),
    description: z.string().max(600).nullable(),
    status: z.enum(["draft", "active", "paused", "archived"]),
    canEdit: z.boolean(),
    canOperate: z.boolean(),
    canRequestRun: z.boolean(),
    canRequestTest: z.boolean(),
    testAvailability: z.enum([
      "internal_ready",
      "review_required",
      "not_active",
      "no_draft",
    ]),
    testDeadlineSeconds: z.number().int().min(1).max(60).nullable(),
    testReceipt: workflowTestReceiptSchema.nullable(),
    runAvailability: z.enum([
      "internal_ready",
      "review_required",
      "not_active",
    ]),
    updatedAt: z.iso.datetime(),
    draft: workflowExperienceRevisionSchema.nullable(),
    active: workflowExperienceRevisionSchema.nullable(),
    comparison: z
      .discriminatedUnion("state", [
        z.strictObject({
          state: z.literal("available"),
          steps: z
            .array(
              z.strictObject({
                number: z.number().int().min(1).max(100),
                change: z.enum(["added", "changed"]),
              }),
            )
            .max(100),
          removedSteps: z.number().int().min(0).max(100),
          connectionsChanged: z.boolean(),
          dataDefinitionChanged: z.boolean(),
          settingsChanged: z.boolean(),
        }),
        z.strictObject({ state: z.literal("unavailable") }),
      ])
      .nullable(),
  })
  .superRefine((view, ctx) => {
    if (
      view.testReceipt &&
      (!view.canRequestTest ||
        view.testReceipt.companyId !== view.companyId ||
        view.testReceipt.workflowId !== view.id)
    )
      ctx.addIssue({
        code: "custom",
        path: ["testReceipt"],
        message: "Workflow test receipt context changed",
      });
    if (
      (view.testAvailability === "internal_ready") !==
      (view.testDeadlineSeconds !== null)
    )
      ctx.addIssue({
        code: "custom",
        path: ["testDeadlineSeconds"],
        message: "Workflow test deadline is inconsistent",
      });
  });
export type WorkflowExperience = z.infer<typeof workflowExperienceSchema>;
export type WorkflowExperienceRevision = z.infer<
  typeof workflowExperienceRevisionSchema
>;
