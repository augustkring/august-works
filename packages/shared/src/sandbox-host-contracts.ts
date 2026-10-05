import { z } from "zod";
import { sandboxCapabilitySnapshotSchema } from "./execution-sandbox.js";
import { runtimeGenerationSchema } from "./runtime-host-contracts.js";

export const SANDBOX_HOST_COMMAND = "v7_openshell_rpc";
export const sandboxHostScopeSchema = z
  .object({
    companyId: z.string().uuid(),
    bindingId: z.string().uuid(),
    cellId: z.string().uuid(),
    cellGeneration: runtimeGenerationSchema,
    sandboxRef: z.string().regex(/^aw-v7-[a-f0-9-]{36}$/),
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
      "probe",
      "revoke_providers",
      "stop",
      "destroy",
    ]),
    probe: z
      .object({
        caseId: z.string().regex(/^[a-z_]{1,100}$/),
        control: z.string().regex(/^[a-zA-Z]{1,100}$/),
        expected: z.enum(["allow", "deny", "observe"]),
      })
      .strict()
      .optional(),
    hostEpoch: z.number().int().positive(),
    imageDigest: z.string().regex(/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/),
    requesterUserId: z.string().min(1).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.scope.sandboxRef !== `aw-v7-${value.scope.bindingId}` ||
      (value.action === "probe") !== Boolean(value.probe)
    )
      ctx.addIssue({
        code: "custom",
        message: "Immutable sandbox scope and probe arguments required",
      });
  });
const digest = z.string().regex(/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
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
  // Effective-policy JSON is validated against the adapter's supported authored
  // representation before it reaches the prover; no arbitrary host payloads.
  z
    .object({
      action: z.literal("effective_policy"),
      document: openShellObservedDocumentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("probe"),
      verdict: z.enum(["pass", "fail", "unsupported"]),
      observationHash: hash.nullable(),
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
