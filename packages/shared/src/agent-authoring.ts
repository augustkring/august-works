import { z } from "zod";
import { READINESS_ACTIONS } from "./readiness.js";

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
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (value) => !/[\u0000\uD800-\uDFFF]/u.test(value),
      "Remove null or malformed Unicode characters",
    );
// Leave room for JSONB formatting beneath the native 64 KiB storage limit.
export const AGENT_DRAFT_CONTENT_MAX_BYTES = 62 * 1024;
const distinctIds = z
  .array(z.uuid())
  .max(30)
  .refine((ids) => new Set(ids).size === ids.length, "Choose each source once");
const storedAgentAuthoringContentSchema = z
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
export const agentAuthoringContentSchema =
  storedAgentAuthoringContentSchema.superRefine((value, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(value)).length >
      AGENT_DRAFT_CONTENT_MAX_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message:
          "The complete draft is too large. Shorten instructions or scenarios.",
      });
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
  // Earlier accepted drafts remain readable; new writes use the tighter byte budget.
  content: storedAgentAuthoringContentSchema.nullable(),
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
export const agentAuthoringDraftSummarySchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  agentId: z.uuid().nullable(),
  version: z.number().int().positive(),
  name: text(200),
  step: customAgentStepSchema,
  updatedAt: z.string().datetime(),
});
export const agentAuthoringDraftListSchema = z
  .array(agentAuthoringDraftSummarySchema)
  .max(25);
export const agentAuthoringDraftPageSchema = z.strictObject({
  items: agentAuthoringDraftListSchema,
  nextCursor: z.uuid().nullable(),
});
export type AgentDraftSave = z.infer<typeof agentDraftSaveSchema>;
export const hireAgentCapabilitySchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/),
  versionId: z.uuid(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: text(200),
  category: text(100),
  outcome: text(2000),
  requiredKnowledge: z.array(text(120)).max(30),
  requiredConnections: z.array(text(120)).max(20),
  limits: z.array(text(1000)).max(30),
  actionClasses: z.array(z.enum(READINESS_ACTIONS)).max(7),
});
export const hireAgentCatalogSchema = z
  .array(hireAgentCapabilitySchema)
  .max(50);
export type HireAgentCapability = z.infer<typeof hireAgentCapabilitySchema>;
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
