import { z } from "zod";
import { activationWebsiteSchema } from "./activation.js";
export const runtimeBackupPolicySchema = z
  .object({
    enabled: z.boolean(),
    allowBriefPause: z.boolean(),
    intervalHours: z.number().int().min(24).max(168),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
import { ENTITLEMENT_KEYS } from "./billing/catalog.js";

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
export const createSaasCompanySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    idempotencyKey: idempotencyKeySchema,
    activation: z.strictObject({version:z.literal(9), website:activationWebsiteSchema.default("")}).optional(),
  })
  .strict();
export const onboardingStageSchema = z.enum([
  "organization",
  "plan",
  "runtime",
  "model_provider",
  "agent",
  "first_task",
  "complete",
]);
export const updateOnboardingSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    stage: onboardingStageSchema,
    answers: z
      .object({
        mission: z.string().max(2000).optional(),
        runtimeChoice: z.enum(["byo", "hosted", "skip"]).optional(),
        providerSecretId: z.string().uuid().optional(),
        rolePackId: z.string().uuid().optional(),
        agentId: z.string().uuid().optional(),
        firstTaskId: z.string().uuid().optional(),
      })
      .strict(),
  })
  .strict();
export const checkoutSchema = z
  .object({
    productKey: z.string().min(1).max(80),
    priceKey: z.string().min(1).max(80),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const runtimeCellCreateSchema = z
  .object({
    isolationMode: z.enum([
      "company_cell",
      "dedicated_agent_gateway",
      "dedicated_vm",
    ]),
    capacityProfile: z.string().min(1).max(80),
    imageDigest: z.string().regex(/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/),
    dedicatedAgentId: z.string().uuid().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .refine(
    (v) =>
      v.isolationMode !== "dedicated_agent_gateway" ||
      Boolean(v.dedicatedAgentId),
    "Dedicated Gateway requires an agent",
  );
export const runtimeOperationSchema = z
  .object({
    action: z.enum([
      "start",
      "stop",
      "delete",
      "backup",
      "restore",
      "upgrade",
      "migrate",
      "rotate_gateway",
    ]),
    imageDigest: z
      .string()
      .regex(/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/)
      .optional(),
    backupId: z.string().uuid().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const supportSessionSchema = z
  .object({
    companyId: z.string().uuid(),
    reason: z.string().min(10).max(500),
    operatorUserId: z.string().min(1).max(200),
    scopes: z
      .array(
        z.enum([
          "status:read",
          "runtime:manage",
          "billing:override",
          "backup:restore",
        ]),
      )
      .min(1)
      .max(4),
    expiresInMinutes: z.number().int().min(1).max(60),
  })
  .strict();
export const entitlementOverrideSchema = z
  .object({
    companyId: z.string().uuid(),
    key: z.enum(ENTITLEMENT_KEYS),
    value: z.union([z.boolean(), z.string().regex(/^\d+$/)]),
    reason: z.string().min(10).max(500),
    expiresAt: z.iso.datetime(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const inviteSaasUserSchema = z
  .object({
    email: z.string().email().max(254),
    role: z.enum(["owner", "admin", "member", "viewer"]),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const runtimeCellBindingSchema = z
  .object({ agentId: z.string().uuid() })
  .strict();
export const companyDeletionRequestSchema = z
  .object({
    confirmation: z.string().trim().min(1).max(200),
    acknowledgeExport: z.literal(true),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const accountDeletionRequestSchema = z
  .object({
    confirmation: z.literal("DELETE MY ACCOUNT"),
    password: z.string().min(1).max(128),
    acknowledgeExport: z.literal(true),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const runtimeModelProviderSchema = z
  .object({
    provider: z.enum(["openai", "anthropic", "openrouter"]),
    modelId: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
    secretId: z.string().uuid(),
  })
  .strict();

const runtimeDigest = z.string().regex(/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
const qualificationEvidence = z
  .object({
    reportUri: z.string().url().max(2048),
    reportSha256: z.string().regex(/^[a-f0-9]{64}$/),
    qualifiedAt: z.iso.datetime(),
    qualificationSourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  })
  .strict();
export const runtimeVersionCandidateSchema = z
  .object({
    imageDigest: runtimeDigest,
    providerVersion: z.string().min(1).max(100),
    stateFormat: z.string().min(1).max(100),
    hostAgentMinimumVersion: z
      .string()
      .max(64)
      .regex(/^\d+\.\d+\.\d+$/),
    conformance: qualificationEvidence
      .extend({
        checks: z
          .object({
            gateway: z.literal(true),
            identity: z.literal(true),
            taskExecution: z.literal(true),
            runAccounting: z.literal(true),
            tenantIsolation: z.literal(true),
            egressIsolation: z.literal(true),
            resourceLimits: z.literal(true),
            restartRecovery: z.literal(true),
            backupRestore: z.literal(true),
            credentialStripping: z.literal(true),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export const runtimeVersionTransitionSchema = z
  .object({
    imageDigest: runtimeDigest,
    expectedStatus: z.enum([
      "candidate",
      "canary",
      "approved",
      "halted",
      "retired",
    ]),
    status: z.enum(["canary", "approved", "halted", "retired"]),
    reason: z.string().min(10).max(500),
  })
  .strict();
export const runtimeCapacityQualificationSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9._-]+$/),
    commercialProductKey: z.enum([
      "runtime_standard",
      "runtime_performance",
      "runtime_dedicated_gateway",
      "runtime_dedicated_vm",
    ]),
    cpuMillis: z.number().int().min(100).max(256000),
    memoryBytes: z.string().regex(/^[1-9]\d{0,12}$/),
    diskBytes: z.string().regex(/^[1-9]\d{0,13}$/),
    pidsLimit: z.number().int().min(16).max(65535),
    benchmarkEvidence: qualificationEvidence
      .extend({
        hostPlan: z.string().min(1).max(100),
        hostCpuMillis: z.number().int().min(100).max(256000),
        hostMemoryBytes: z.string().regex(/^[1-9]\d{0,12}$/),
        hostDiskBytes: z.string().regex(/^[1-9]\d{0,13}$/),
        isolationPassed: z.literal(true),
        quotaEnforcementPassed: z.literal(true),
        cpuStressPassed: z.literal(true),
        memoryStressPassed: z.literal(true),
        diskStressPassed: z.literal(true),
      })
      .strict(),
  })
  .strict();

export type RuntimeVersionCandidate = z.infer<
  typeof runtimeVersionCandidateSchema
>;
export type RuntimeVersionTransition = z.infer<
  typeof runtimeVersionTransitionSchema
>;
export type RuntimeCapacityQualification = z.infer<
  typeof runtimeCapacityQualificationSchema
>;
