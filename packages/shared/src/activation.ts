import { z } from "zod";
import { issueDocumentKeySchema } from "./validators/issue.js";

export const ACTIVATION_STEPS = [
  "intent",
  "discovery_permission",
  "discovery_progress",
  "material_facts",
  "capability",
  "access",
  "review",
  "running",
  "result",
  "activated",
] as const;
export const activationWebsiteSchema = z
  .string()
  .trim()
  .max(253)
  .refine(
    (value) =>
      !value ||
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
        value,
      ),
    "Enter a domain such as example.com, without a path or credentials",
  );
// References to original owners only. This receipt never authorizes execution.
export const activationFirstValueReceiptSchema = z.strictObject({
  installationId: z.uuid(),
  verificationRunId: z.uuid(),
  issueId: z.uuid(),
  runId: z.uuid(),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/),
});
// References to the original Task and plan; they confer no execution authority.
export const activationFirstTaskReferenceSchema = z.strictObject({
  installationId: z.uuid(),
  installationHash: z.string().regex(/^[a-f0-9]{64}$/),
  planId: z.uuid(),
  issueId: z.uuid(),
});
export const activationFirstTaskCandidateSchema = activationFirstTaskReferenceSchema.extend({
  planVersion: z.number().int().positive(),
  title: z.string().max(500),
  maximumModelCostMinor: z.literal(0),
  currency: z.literal("USD"),
});
export const activationFirstTaskPreparationSchema = z.strictObject({
  installationId: z.uuid(), installationVersion: z.number().int().positive(),
  installationHash: z.string().regex(/^[a-f0-9]{64}$/), agentName: z.string().max(200),
  useCaseVersion: z.number().int().positive(), purposeVersion: z.number().int().positive(),
  intendedPurpose: z.string().max(4000), maximumModelCostMinor: z.literal(0),
});
export const activationFirstTaskViewSchema = z.strictObject({
  candidates: z.array(activationFirstTaskCandidateSchema).max(5),
  preparationOptions: z.array(activationFirstTaskPreparationSchema).max(5).default([]),
  hasMore: z.boolean(),
  current: activationFirstTaskReferenceSchema.extend({
    planVersion: z.number().int().positive(),
    status: z.enum(["running", "paused", "completed", "cancelled", "failed", "withdrawn"]),
    dispatched: z.boolean(),
  }).nullable(),
});
export const activationFirstValueResultSchema =
  activationFirstValueReceiptSchema.extend({
    title: z.string().max(500),
    verifiedAt: z.iso.datetime(),
    artifacts: z
      .array(
        z.strictObject({
          documentId: z.uuid(),
          documentKey: issueDocumentKeySchema.optional(),
          revisionId: z.uuid(),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .min(1)
      .max(16),
  });
export const activationFirstValueViewSchema = z
  .strictObject({
    status: z.enum(["not_recorded", "verified", "withdrawn"]),
    result: activationFirstValueResultSchema.nullable(),
    candidates: z.array(activationFirstValueResultSchema).max(5),
    hasMore: z.boolean(),
  })
  .refine(
    (value) =>
      (value.status === "verified") === (value.result !== null) &&
      (value.status === "not_recorded" ||
        (!value.candidates.length && !value.hasMore)) &&
      (!value.hasMore || value.candidates.length === 5),
    "First-result status requires matching current evidence",
  );
// A preparation reference to the original paused agent. It never grants access
// or certifies a provider, representative test, package activation or Free Core.
export const activationFirstAgentReferenceSchema = z.strictObject({
  agentId: z.uuid(), packageVersionId: z.uuid(), packageContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/), approvalId: z.uuid().nullable(),
});
export const activationFirstAgentViewSchema = z.strictObject({
  status: z.enum(["not_created", "prepared", "pending_approval", "needs_review", "unavailable"]),
  agentId: z.uuid().nullable(), name: z.string().min(1).max(200).nullable(), canPrepare: z.boolean(),
}).superRefine((view, ctx) => {
  const available = ["prepared", "pending_approval", "needs_review"].includes(view.status);
  if (available !== (view.agentId !== null && view.name !== null) ||
      (!available && (view.agentId !== null || view.name !== null)) ||
      (view.status !== "not_created" && view.canPrepare))
    ctx.addIssue({ code: "custom", message: "Inconsistent original first-agent preparation view" });
});
export const activationStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  step: z.enum(ACTIVATION_STEPS),
  website: activationWebsiteSchema,
  intent: z.string().trim().max(4000),
  discovery: z.enum(["not_requested", "customer_context"]),
  companyPurpose: z.string().trim().max(2000),
  missionFoundationId: z.uuid().nullable(),
  packageVersionId: z.uuid().nullable(),
  firstValueAt: z.iso.datetime().nullable(),
  firstValueReceipt: activationFirstValueReceiptSchema.optional(),
  firstTask: activationFirstTaskReferenceSchema.optional(),
  firstAgent: activationFirstAgentReferenceSchema.optional(),
  preparedFirstTask: activationFirstTaskReferenceSchema.optional(),
  receipts: z
    .array(
      z.strictObject({
        requestId: z.uuid(),
        requestHash: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(32),
});
export type ActivationState = z.infer<typeof activationStateSchema>;
export function initialActivationState(website = ""): ActivationState {
  return activationStateSchema.parse({
    schemaVersion: 1,
    step: "intent",
    website,
    intent: "",
    discovery: "not_requested",
    companyPurpose: "",
    missionFoundationId: null,
    packageVersionId: null,
    firstValueAt: null,
    receipts: [],
  });
}
const envelope = {
  requestId: z.uuid(),
  expectedVersion: z.number().int().positive(),
};
export const activationCommandSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...envelope,
    operation: z.literal("save_draft"),
    intent: z.string().trim().max(4000).optional(),
    companyPurpose: z.string().trim().max(2000).optional(),
  }),
  z.strictObject({
    ...envelope,
    operation: z.literal("save_intent"),
    intent: z.string().trim().min(1).max(4000),
  }),
  z.strictObject({ ...envelope, operation: z.literal("build_customer_draft") }),
  z.strictObject({ ...envelope, operation: z.literal("continue_discovery") }),
  z.strictObject({
    ...envelope,
    operation: z.literal("confirm_material_facts"),
    companyPurpose: z.string().trim().min(1).max(2000),
  }),
  z.strictObject({
    ...envelope,
    operation: z.literal("select_capability"),
    packageVersionId: z.uuid(),
  }),
  z.strictObject({ ...envelope, operation: z.literal("continue_access") }),
  z.strictObject({ ...envelope, operation: z.literal("reselect_capability") }),
  z.strictObject({ ...envelope, operation: z.literal("change_setup") }),
  z.strictObject({ ...envelope, operation: z.literal("prepare_first_agent"), confirmPausedPreparation: z.literal(true) }),
  z.strictObject({
    ...envelope, operation: z.literal("prepare_first_task"),
    installationId: z.uuid(), expectedInstallationVersion: z.number().int().positive(),
    expectedInstallationHash: z.string().regex(/^[a-f0-9]{64}$/),
    expectedUseCaseVersion: z.number().int().positive(), expectedPurposeVersion: z.number().int().positive(),
    confirmCurrentPurpose: z.literal(true),
  }),
  z.strictObject({
    ...envelope, operation: z.literal("start_first_task"),
    installationId: z.uuid(), planId: z.uuid(),
    expectedInstallationHash: z.string().regex(/^[a-f0-9]{64}$/),
    expectedPlanVersion: z.number().int().positive(),
    expectedMaximumModelCostMinor: z.literal(0),
  }),
  z.strictObject({ ...envelope, operation: z.literal("continue_first_task") }),
  z.strictObject({ ...envelope, operation: z.literal("stop_first_task"), expectedPlanVersion: z.number().int().positive() }),
  z.strictObject({
    ...envelope,
    operation: z.literal("record_verified_result"),
    installationId: z.uuid(),
    verificationRunId: z.uuid(),
  }),
  z.strictObject({ ...envelope, operation: z.literal("complete_activation") }),
]);
export type ActivationCommand = z.infer<typeof activationCommandSchema>;
export const activationRequiredAccessSchema = z.strictObject({
  key: z.string().min(1).max(120),
  status: z.enum(["recorded", "not_connected", "needs_review", "unavailable"]),
  checkedAt: z.iso.datetime().nullable(),
}).refine(value => value.status !== "recorded" || value.checkedAt !== null, "Recorded access requires an original observation");
export type ActivationRequiredAccess = z.infer<typeof activationRequiredAccessSchema>;
export const activationViewSchema = z.strictObject({
  runId: z.uuid(),
  companyId: z.uuid(),
  companyName: z.string(),
  version: z.number().int().positive(),
  status: z.enum(["in_progress", "completed", "abandoned"]),
  state: activationStateSchema.omit({ receipts: true, firstAgent: true }),
  firstAgent: activationFirstAgentViewSchema.optional(),
  firstValue: activationFirstValueViewSchema.optional(),
  firstTask: activationFirstTaskViewSchema.optional(),
  requiredAccess: z.array(activationRequiredAccessSchema).max(20).refine(rows => new Set(rows.map(row => row.key)).size === rows.length).optional(),
  sources: z
    .array(
      z.strictObject({
        id: z.enum(["customer_context", "website", "connections"]),
        status: z.enum(["available", "not_requested", "not_connected"]),
      }),
    )
    .max(3),
  capabilities: z
    .array(
      z.strictObject({
        versionId: z.uuid(),
        name: z.string().max(200),
        purpose: z.string().max(2000),
        requiredConnections: z.array(z.string().max(120)).max(20),
        knownLimitations: z.array(z.string().max(1000)).max(30),
      }),
    )
    .max(20),
  blockers: z
    .array(
      z.enum([
        "no_qualified_capability",
        "required_access_pending",
        "safe_execution_unqualified",
      ]),
    )
    .max(3),
});
export type ActivationView = z.infer<typeof activationViewSchema>;
