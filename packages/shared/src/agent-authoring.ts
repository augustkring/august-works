import { z } from "zod";
import { READINESS_ACTIONS } from "./readiness.js";
import type { PackageRelease } from "./agent-packages.js";

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
export const HIRE_AGENT_STEPS = [
  "hire_access",
  "hire_authority",
  "hire_test",
  "hire_review",
  "hire_receipt",
] as const;
export const hireAgentStepSchema = z.enum(HIRE_AGENT_STEPS);
export const agentDraftStepSchema = z.enum([
  ...CUSTOM_AGENT_STEPS,
  ...HIRE_AGENT_STEPS,
]);
const packagePinSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/),
  versionId: z.uuid(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
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
  packageVersionId: z.uuid().nullable().default(null),
});
export const agentDraftAdmissionSchema = z.strictObject({
  companyId: z.uuid(),
  agentId: z.uuid().nullable(),
  canCreateDraft: z.literal(true),
});
export const agentDraftSaveSchema = z.strictObject({
  requestId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  step: agentDraftStepSchema,
  content: agentAuthoringContentSchema,
});
export const agentDraftDiscardSchema = z.strictObject({
  requestId: z.uuid(),
  expectedVersion: z.number().int().positive(),
});
export const agentDraftPreparationReviewSchema = z.strictObject({
  draftId: z.uuid(), companyId: z.uuid(), version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200), outcome: z.string().trim().min(1).max(2000),
  accountableOwner: z.strictObject({ userId: z.string().min(1).max(200), name: z.string().min(1).max(200) }),
  requiresBoardApproval: z.boolean(), createsInactiveAgent: z.literal(true),
  runtimeQualified: z.literal(false), authorityGranted: z.literal(false),
  executionStarted: z.literal(false), reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const agentDraftPrepareSchema = z.strictObject({
  requestId: z.uuid().refine(value => value === value.toLowerCase(), "Use the canonical request identity"), expectedVersion: z.number().int().positive(),
  expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/), confirmInactiveAgentPreparation: z.literal(true),
});
export type AgentDraftPrepare = z.infer<typeof agentDraftPrepareSchema>;
export type AgentDraftPreparationReview = z.infer<typeof agentDraftPreparationReviewSchema>;
export const agentAuthoringDraftViewSchema = z.strictObject({
  id: z.uuid(),
  companyId: z.uuid(),
  agentId: z.uuid().nullable(),
  createdByUserId: z.string(),
  preparation: z.strictObject({ agentId: z.uuid(), name: z.string().min(1).max(200), approvalId: z.uuid().nullable(),
    status: z.enum(["prepared", "pending_approval", "needs_review", "unavailable"]),
    runtimeQualified: z.literal(false), authorityGranted: z.literal(false), executionStarted: z.literal(false),
  }).nullable().optional(),
  version: z.number().int().positive(),
  status: z.enum(["draft", "discarded"]),
  kind: z.enum(["custom", "hire"]).optional(),
  package: packagePinSchema.nullable().optional(),
  step: agentDraftStepSchema,
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
  kind: z.enum(["custom", "hire"]).optional(),
  step: agentDraftStepSchema,
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
/** Native package declarations; no effective permissions or qualification. */
export const hireAgentDeclaredAccessSchema = z.strictObject({
  maximumRisk: z.enum(["C1", "C2", "C3"]),
  optionalConnections: z.array(text(120)).max(20),
  memoryPolicy: z.enum(["source_governed", "no_persistent_memory"]),
  humanApproval: z.literal("before_material_action"),
  supervision: z.literal("bounded_native"),
  verification: z.literal("independent_native"),
  sandboxAssurance: z.enum([
    "byo_customer_responsibility",
    "qualified_managed",
  ]),
  runtimeProviders: z
    .array(z.enum(["paperclip_native", "hermes", "openclaw"]))
    .min(1)
    .max(3),
  scopeAssessment: z.literal("unavailable"),
  authorityEffect: z.literal("none"),
});
export function projectHireDeclaredAccess(
  manifest: PackageRelease["manifest"],
) {
  return hireAgentDeclaredAccessSchema.parse({
    maximumRisk: manifest.maximumRisk,
    optionalConnections: manifest.optionalConnections,
    memoryPolicy: manifest.memoryPolicy,
    humanApproval: manifest.humanApproval,
    supervision: manifest.supervision,
    verification: manifest.verification,
    sandboxAssurance: manifest.sandboxAssurance,
    runtimeProviders: manifest.runtimeProviders,
    scopeAssessment: "unavailable",
    authorityEffect: "none",
  });
}
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
  // Older read owners omit this; absence means unavailable, not zero access.
  declaredAccess: hireAgentDeclaredAccessSchema.optional(),
});
export const hireAgentCatalogSchema = z
  .array(hireAgentCapabilitySchema)
  .max(50);
export type HireAgentCapability = z.infer<typeof hireAgentCapabilitySchema>;
export const hireAgentCapabilityStatusSchema = hireAgentCapabilitySchema.extend(
  { available: z.boolean() },
);
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
