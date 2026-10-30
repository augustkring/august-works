import { z } from "zod";
import { sandboxCapabilitySnapshotSchema, sandboxPolicySchema } from "./execution-sandbox.js";
import { runtimeGenerationSchema } from "./runtime-host-contracts.js";

export const SANDBOX_HOST_COMMAND = "v7_openshell_rpc";
const digest = z.string().regex(/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const sandboxHostScopeSchema = z
  .object({
    companyId: z.string().uuid(),
    bindingId: z.string().uuid(),
    cellId: z.string().uuid(),
    cellGeneration: runtimeGenerationSchema,
    sandboxRef: z.string().regex(/^aw-v7-[a-f0-9-]{36}$/),
  })
  .strict();

// This is the exact OpenShell v0.1.2 policy shape emitted by `policy get
// --full --output json` for the subset the AW projection can currently use.
// Shared policy units and limits are the source of truth; disk and wall-clock
// are deliberately absent until this host has an enforcing/observable owner.
const sandboxDockerResourceLimitsSchema = sandboxPolicySchema.shape.resources.pick({
  cpuMillis: true,
  memoryBytes: true,
  pidsLimit: true,
}).strict();
const openShellObservedDocumentSchema = z
  .object({
    version: z.literal(1),
    filesystem_policy: z
      .object({
        include_workdir: z.literal(false),
        read_only: z.array(z.string().max(1000)).max(64),
        read_write: z.array(z.string().max(1000)).max(32),
      })
      .strict(),
    landlock: z
      .object({ compatibility: z.literal("hard_requirement") })
      .strict(),
    process: z
      .object({
        run_as_user: z.string().regex(/^\d+$/),
        run_as_group: z.string().regex(/^\d+$/),
      })
      .strict(),
    network_policies: z
      .record(
        z.string().max(100),
        z
          .object({
            name: z.string().max(100),
            binaries: z
              .array(z.object({ path: z.string().max(1000) }).strict())
              .max(32),
            endpoints: z
              .array(
                z
                  .object({
                    host: z.string().max(253),
                    port: z.number().int().min(1).max(65535),
                    protocol: z.literal("rest"),
                    enforcement: z.literal("enforce"),
                    rules: z
                      .array(
                        z
                          .object({
                            allow: z
                              .object({
                                method: z.string().max(10),
                                path: z.string().max(1100),
                              })
                              .strict(),
                          })
                          .strict(),
                      )
                      .max(224),
                  })
                  .strict(),
              )
              .max(64),
          })
          .strict(),
      )
      .refine((v) => Object.keys(v).length <= 64),
  })
  .strict();

export const sandboxHostRequestSchema = z
  .object({
    version: z.literal(1),
    scope: sandboxHostScopeSchema,
    action: z.enum([
      "capabilities",
      "prepare",
      "inspect",
      "effective_policy",
      "apply",
      "start",
      "probe",
      "revoke_providers",
      "stop",
      "destroy",
    ]),
    probe: z
      .object({
        caseId: z.string().regex(/^[a-z0-9_]{1,100}$/),
        control: z.string().regex(/^[a-zA-Z0-9]{1,100}$/),
        expected: z.enum(["allow", "deny", "observe"]),
        contractHash: hash,
      })
      .strict()
      .optional(),
    admission: z
      .object({
        policyHash: hash,
        expiresAt: z.iso.datetime(),
        idempotencyKey: z.string().min(1).max(200),
        document: openShellObservedDocumentSchema,
        resourceLimits: sandboxDockerResourceLimitsSchema,
        credentialProviderProfile: z.object({
          id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
          hash,
          binaries: z.array(z.string().min(1).max(1000).refine(value => value.startsWith('/') && !value.includes('\\') && !value.includes('\0') && !value.split('/').some(part => part === '.' || part === '..') && !/[\r\n*?]/.test(value) && !value.includes('//') && (value === '/' || !value.endsWith('/')))).max(32),
        }).strict().optional(),
      })
      .strict()
      .optional(),
    start: z
      .object({
        policyHash: hash,
        expiresAt: z.iso.datetime(),
        idempotencyKey: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
    /** Server-owned cleanup-only refresh. This is never accepted by the
     * operator bridge; the host may only return its protected report or one
     * controller-selected fixed boundary probe for the active erasure job. */
    cleanupAttestation: z
      .object({
        version: z.literal(1),
        jobId: z.string().uuid(),
        jobKey: z.string().min(1).max(300),
        attemptNumber: z.number().int().positive(),
        executionOwnerId: z.string().min(1).max(300),
        locatorDigest: hash,
        companyPurgeOperationId: z.string().uuid().nullable(),
        startBindingDigest: hash,
      })
      .strict()
      .optional(),
    hostEpoch: z.number().int().positive(),
    imageDigest: digest,
    requesterUserId: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.scope.sandboxRef !== `aw-v7-${value.scope.bindingId}` ||
      (value.action === "probe") !== Boolean(value.probe) ||
      (value.action === "apply") !== Boolean(value.admission) ||
      (value.action === "start") !== Boolean(value.start) ||
      (Boolean(value.cleanupAttestation) &&
        (!['capabilities', 'probe'].includes(value.action) || value.requesterUserId !== undefined)) ||
      (!value.cleanupAttestation && !value.requesterUserId)
    )
      ctx.addIssue({
        code: "custom",
        message: "Immutable sandbox scope and action arguments required",
      });
  });

export const sandboxHostReplySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("capabilities"),
      capabilities: sandboxCapabilitySnapshotSchema.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("prepare"),
      backendVersion: z.literal("0.1.2"),
      imageDigest: digest,
    })
    .strict(),
  z
    .object({
      action: z.literal("inspect"),
      state: z.enum(["ready", "running", "stopped", "failed", "unknown"]),
      policyHash: hash.nullable(),
      imageDigest: digest.nullable(),
      generation: runtimeGenerationSchema,
      controlsHealthy: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("effective_policy"),
      document: openShellObservedDocumentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("apply"),
      applied: z.boolean(),
      policyHash: hash.nullable(),
      requiresRecreate: z.boolean(),
      effectivePolicyHash: hash.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("start"),
      started: z.literal(true),
      operationId: z.string().min(1).max(200),
      sandboxId: z.string().uuid(),
      containerId: z.string().regex(/^[a-f0-9]{64}$/),
      imageDigest: digest,
      policyHash: hash,
      effectivePolicyHash: hash,
    })
    .strict(),
  z
    .object({
      action: z.literal("probe"),
      verdict: z.enum(["pass", "fail", "unsupported"]),
      observationHash: hash.nullable(),
      contractHash: hash,
      targetQualificationHash: hash.optional(),
    })
    .strict(),
  z
    .object({ action: z.literal("revoke_providers"), revoked: z.literal(true) })
    .strict(),
  z.object({ action: z.literal("stop"), stopped: z.literal(true) }).strict(),
  z
    .object({ action: z.literal("destroy"), destroyed: z.literal(true) })
    .strict(),
]);

export const sandboxHostCompletionSchema = z
  .object({
    claimToken: z.string().min(40).max(128),
    generation: runtimeGenerationSchema,
    success: z.boolean(),
    reply: sandboxHostReplySchema.nullable(),
    errorCode: z
      .enum([
        "sandbox_host_unavailable",
        "sandbox_scope_changed",
        "sandbox_operation_unsupported",
        "sandbox_observation_unavailable",
      ])
      .nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.success !== Boolean(v.reply) || v.success === Boolean(v.errorCode))
      ctx.addIssue({ code: "custom", message: "Consistent result required" });
  });
export type SandboxHostRequest = z.infer<typeof sandboxHostRequestSchema>;
export type SandboxHostReply = z.infer<typeof sandboxHostReplySchema>;
