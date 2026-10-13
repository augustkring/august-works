import { z } from "zod";

/** Body-free references to drafts actually saved by the conversation's
 * Original authoring tools. A model's claimed link is never a receipt. */
export const conversationAuthoringViewSchema = z.strictObject({
  companyId: z.uuid(), conversationId: z.uuid(), agentId: z.uuid(), generation: z.number().int().nonnegative(),
  observedAt: z.iso.datetime(), hasMore: z.boolean(), modelCalled: z.literal(false),
  proposals: z.array(z.strictObject({
    kind: z.literal("workflow"), id: z.uuid(), name: z.string().min(1).max(200),
    authoredRevisionId: z.uuid(), authoredRevisionNumber: z.number().int().positive(),
    currentDraftRevisionId: z.uuid().nullable(), currentPublishedRevisionId: z.uuid().nullable(),
    state: z.enum(["draft", "changed", "published", "superseded"]),
    stepCount: z.number().int().nonnegative(), triggerCount: z.number().int().nonnegative(),
    href: z.string(),
  }).superRefine((value, ctx) => {
    if (value.href !== `/workflows/${value.id}`) ctx.addIssue({ code: "custom", path: ["href"], message: "Use the Original workflow reference" });
  })).max(10),
}).superRefine((value, ctx) => {
  if (new Set(value.proposals.map(p => p.id)).size !== value.proposals.length)
    ctx.addIssue({ code: "custom", path: ["proposals"], message: "Return distinct Original workflows" });
});
export type ConversationAuthoringView = z.infer<typeof conversationAuthoringViewSchema>;
