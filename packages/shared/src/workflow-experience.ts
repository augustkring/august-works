import { z } from "zod";
import { workflowTestReceiptSchema } from "./workflow-test.js";
import { WORKFLOW_NODE_IDEMPOTENCY_STRATEGIES } from "./types/workflow.js";

/** Declared Native step semantics; these facts never grant execution access. */
export const workflowStepSemanticsSchema = z.strictObject({
  actor: z.enum(["workflow", "human", "selected_agent", "connected_tool", "unknown"]),
  input: z.enum(["start_data", "mapped_data", "condition_data", "delay", "approval_material", "task_brief", "tool_arguments", "child_workflow_data", "native_query", "http_request", "advanced"]),
  durationSeconds: z.number().int().min(1).max(604800).nullable(),
  approvalPolicy: z.enum(["human_checkpoint", "no_checkpoint", "execution_review", "unavailable"]),
  access: z.enum(["no_step_grant", "execution_check", "unavailable"]),
  maxAttempts: z.number().int().min(1).max(20).nullable(),
  idempotency: z.enum([...WORKFLOW_NODE_IDEMPOTENCY_STRATEGIES, "unknown"]),
});
export type WorkflowStepSemantics = z.infer<typeof workflowStepSemanticsSchema>;

const stepSchema = z.strictObject({
  nodeId: z.string().min(1).max(160).optional(),
  number: z.number().int().min(1).max(100),
  name: z.string().max(160),
  operation: z.string().max(160),
  semantics: workflowStepSemanticsSchema.optional(),
  assignment: z.strictObject({
    state: z.enum(["current", "unavailable"]),
    name: z.string().min(1).max(200).nullable(),
  }).superRefine((value, ctx) => {
    if ((value.state === "current") !== (value.name !== null))
      ctx.addIssue({ code: "custom", message: "Assignment visibility is inconsistent" });
  }).optional(),
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
