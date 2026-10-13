import { z } from "zod";
import { workflowExperienceSchema, workflowExperienceRevisionSchema } from "./workflow-experience.js";
import { ISSUE_STATUSES } from "./constants.js";

export const conversationSavedTaskSchema = z.strictObject({
  kind: z.literal("task"), id: z.uuid(), title: z.string().min(1).max(400), titleTruncated: z.boolean(),
  status: z.enum(ISSUE_STATUSES), statusVersion: z.number().int().nonnegative(),
  // Current owner state, never a model's assertion that work finished.
  executionStarted: z.boolean(), href: z.string(),
}).superRefine((value, ctx) => {
  if (value.href !== `/issues/${value.id}`)
    ctx.addIssue({ code: "custom", path: ["href"], message: "Use the Original task reference" });
});

/** Body-free references to drafts actually saved by the conversation's
 * Original authoring tools. A model's claimed link is never a receipt. */
export const conversationAuthoringViewSchema = z.strictObject({
  companyId: z.uuid(), conversationId: z.uuid(), agentId: z.uuid(), generation: z.number().int().nonnegative(),
  observedAt: z.iso.datetime(), hasMore: z.boolean(), modelCalled: z.literal(false),
  // Optional permits older servers during rollout. Absence is unavailable,
  // rather than proof that no tasks were saved.
  savedTasks: z.array(conversationSavedTaskSchema).max(10).optional(),
  hasMoreTasks: z.boolean().optional(),
  proposals: z.array(z.strictObject({
    kind: z.literal("workflow"), id: z.uuid(), name: z.string().min(1).max(200),
    authoredRevisionId: z.uuid(), authoredRevisionNumber: z.number().int().positive(),
    currentDraftRevisionId: z.uuid().nullable(), currentPublishedRevisionId: z.uuid().nullable(),
    state: z.enum(["draft", "changed", "published", "superseded"]),
    stepCount: z.number().int().nonnegative(), triggerCount: z.number().int().nonnegative(),
    href: z.string(),
    // Optional admits an older readonly owner response during rollout; absence
    // is never treated as a complete flow or an unchanged comparison.
    preview: workflowExperienceRevisionSchema.omit({ state: true }).optional(),
    comparison: workflowExperienceSchema.shape.comparison.optional(),
  }).superRefine((value, ctx) => {
    if (value.preview && (value.preview.id !== value.authoredRevisionId || value.preview.version !== value.authoredRevisionNumber))
      ctx.addIssue({ code: "custom", path: ["preview"], message: "Preview the exact authored revision" });
    const flow = value.preview;
    if (flow) {
      const numbers = new Set(flow.steps.map(step => step.number));
      if (flow.coverage === "complete" && (flow.steps.length !== value.stepCount + value.triggerCount ||
        numbers.size !== flow.steps.length || flow.steps.some((step, i) => step.number !== i + 1 || step.next.some(next => !numbers.has(next.number)))) ||
        flow.coverage === "flow_unavailable" && flow.steps.length !== 0)
        ctx.addIssue({ code: "custom", path: ["preview"], message: "Only a complete bounded declaration is an available flow" });
    }
    if (value.href !== `/workflows/${value.id}`) ctx.addIssue({ code: "custom", path: ["href"], message: "Use the Original workflow reference" });
  })).max(10),
}).superRefine((value, ctx) => {
  if (new Set(value.proposals.map(p => p.id)).size !== value.proposals.length)
    ctx.addIssue({ code: "custom", path: ["proposals"], message: "Return distinct Original workflows" });
  if (value.savedTasks && new Set(value.savedTasks.map(p => p.id)).size !== value.savedTasks.length)
    ctx.addIssue({ code: "custom", path: ["savedTasks"], message: "Return distinct Original tasks" });
  if ((value.savedTasks === undefined) !== (value.hasMoreTasks === undefined))
    ctx.addIssue({ code: "custom", path: ["savedTasks"], message: "Task coverage requires the actual bounded owner result" });
});
export type ConversationAuthoringView = z.infer<typeof conversationAuthoringViewSchema>;
