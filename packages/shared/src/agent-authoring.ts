import { z } from "zod";

export const CUSTOM_AGENT_STEPS = [
  "outcome",
  "identity",
  "instructions",
  "knowledge",
  "tools",
  "authority",
  "memory",
  "collaboration",
  "runtime",
  "test",
  "review",
  "publish",
  "monitor",
] as const;
export const customAgentStepSchema = z.enum(CUSTOM_AGENT_STEPS);
const text = (max: number) => z.string().max(max);
const distinctIds = z
  .array(z.uuid())
  .max(30)
  .refine((ids) => new Set(ids).size === ids.length, "Choose each source once");
export const agentAuthoringContentSchema = z
  .strictObject({
    outcome: text(2000).default(""),
    ownerUserId: text(200).default(""),
    name: text(200).default(""),
    description: text(1000).default(""),
    internalDescription: text(2000).default(""),
    instructions: z
      .strictObject({
        purpose: text(2000).default(""),
        responsibilities: text(6000).default(""),
        prohibited: text(3000).default(""),
        missingInformation: text(2000).default(""),
        escalation: text(2000).default(""),
        communication: text(1000).default(""),
      })
      .default({
        purpose: "",
        responsibilities: "",
        prohibited: "",
        missingInformation: "",
        escalation: "",
        communication: "",
      }),
    knowledgeDocumentIds: distinctIds.default([]),
    capabilities: z
      .array(
        z.strictObject({
          operation: z.enum([
            "read_approved_knowledge",
            "create_internal_draft",
            "create_task",
            "external_send",
            "spend",
            "change_permissions",
          ]),
          autonomy: z.enum(["automatic", "ask_first", "not_allowed"]),
        }),
      )
      .max(6)
      .refine(
        (items) =>
          new Set(items.map((item) => item.operation)).size === items.length,
        "Choose each capability once",
      )
      .default([]),
    memory: z
      .enum(["none", "approved_work_preferences", "approved_company_knowledge"])
      .default("none"),
    // Delegation requires an independently qualified bounded policy; no draft boolean can grant it.
    collaboration: z.literal("none").default("none"),
    runtimeBindingId: z.uuid().nullable().default(null),
    scenarios: z.array(text(2000)).max(10).default([]),
    channel: z.literal("in_app").default("in_app"),
  })
  .superRefine((value, ctx) => {
    for (const capability of value.capabilities) {
      if (
        capability.operation === "change_permissions" &&
        capability.autonomy !== "not_allowed"
      )
        ctx.addIssue({
          code: "custom",
          path: ["capabilities"],
          message: "An agent cannot grant permissions",
        });
      if (
        ["external_send", "spend"].includes(capability.operation) &&
        capability.autonomy === "automatic"
      )
        ctx.addIssue({
          code: "custom",
          path: ["capabilities"],
          message: "Consequential actions require human approval",
        });
    }
  });
export type AgentAuthoringContent = z.infer<typeof agentAuthoringContentSchema>;
export const agentDraftCreateSchema = z.strictObject({
  requestId: z.uuid(),
  agentId: z.uuid().nullable().default(null),
});
export const agentDraftSaveSchema = z.strictObject({
  requestId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  step: customAgentStepSchema,
  content: agentAuthoringContentSchema,
});
export const agentDraftDiscardSchema = z.strictObject({
  requestId: z.uuid(),
  expectedVersion: z.number().int().positive(),
});
export const agentAuthoringDraftViewSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  agentId: z.uuid().nullable(),
  createdByUserId: z.string(),
  version: z.number().int().positive(),
  status: z.enum(["draft", "discarded"]),
  step: customAgentStepSchema,
  content: agentAuthoringContentSchema.nullable(),
  baselineHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentAuthoringDraftView = z.infer<
  typeof agentAuthoringDraftViewSchema
>;
export const agentAuthoringDraftListSchema = z
  .array(agentAuthoringDraftViewSchema)
  .max(25);
export const agentAuthoringDraftPageSchema = z.strictObject({
  items: agentAuthoringDraftListSchema,
  nextCursor: z.uuid().nullable(),
});
export type AgentDraftSave = z.infer<typeof agentDraftSaveSchema>;
export interface AgentAuthoringReview {
  draftId: string;
  version: number;
  productionChanged: false;
  baselineCurrent: boolean;
  blockers: Array<{
    code: string;
    message: string;
    step: (typeof CUSTOM_AGENT_STEPS)[number];
  }>;
  test: { status: "unqualified"; message: string };
  publishAllowed: false;
}
