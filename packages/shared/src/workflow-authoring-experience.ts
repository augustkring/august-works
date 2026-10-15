import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).refine(
  value => !/[\u0000\uD800-\uDFFF]/u.test(value), "Remove invalid text characters",
);
/** Describe intent in customer language. This is neither a graph nor authority. */
export const workflowIntentDraftCommandSchema = z.strictObject({
  requestId: z.uuid(),
  locale: z.enum(["en", "da"]).default("en"),
  name: text(200).pipe(z.string().min(1)),
  outcome: text(400).pipe(z.string().min(1)),
  trigger: text(200),
  sources: text(200),
  conditions: text(200),
  finalEffect: text(300),
  humanJudgment: text(200),
});
export const workflowIntentDraftReceiptSchema = z.strictObject({
  companyId: z.uuid(), workflowId: z.uuid(), requestId: z.uuid(),
  draftRevisionId: z.uuid(), createdAt: z.iso.datetime(),
  executionStarted: z.literal(false), published: z.literal(false),
});
export const workflowExperienceIndexSchema = z.strictObject({
  companyId: z.uuid(), canCreateDraft: z.boolean(), coverage: z.literal("bounded"),
  workflows: z.array(z.strictObject({
    id: z.uuid(), name: z.string().max(200), description: z.string().max(600).nullable(),
    status: z.enum(["draft", "active", "paused", "archived"]), updatedAt: z.iso.datetime(),
  })).max(20),
});
export type WorkflowIntentDraftCommand = z.infer<typeof workflowIntentDraftCommandSchema>;
export type WorkflowIntentDraftReceipt = z.infer<typeof workflowIntentDraftReceiptSchema>;
export type WorkflowExperienceIndex = z.infer<typeof workflowExperienceIndexSchema>;
/** Current policy discovery, never an execution grant or runtime qualification. */
export const workflowDraftAuthorsSchema = z.strictObject({
  companyId: z.uuid(), workflowId: z.uuid(), draftRevisionId: z.uuid(), publishedRevisionId: z.uuid().nullable(),
  observedAt: z.iso.datetime(), coverage: z.literal("bounded"), enabled: z.boolean(),
  choices: z.array(z.strictObject({ agentId: z.uuid(), name: z.string().min(1).max(200) })).max(32),
}).superRefine((view, ctx) => {
  if (!view.enabled && view.choices.length || new Set(view.choices.map(choice => choice.agentId)).size !== view.choices.length)
    ctx.addIssue({ code: "custom", message: "Current workflow author choices changed" });
});
export const workflowDraftAuthorLocatorSchema = z.strictObject({ workflowId: z.uuid(), draftRevisionId: z.uuid() });
export type WorkflowDraftAuthors = z.infer<typeof workflowDraftAuthorsSchema>;
export type WorkflowDraftAuthorLocator = z.infer<typeof workflowDraftAuthorLocatorSchema>;
export const pendingWorkflowReceiptSchema = z.strictObject({
  companyId: z.uuid(), principal: z.string().min(1).max(300), requestId: z.uuid(),
});
export const pendingWorkflowReceiptInventorySchema = z.array(pendingWorkflowReceiptSchema).max(32).refine(values =>
  new Set(values.map(value => JSON.stringify([value.companyId, value.principal]))).size === values.length,
);
