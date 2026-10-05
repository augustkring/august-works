import { z } from "zod";
const id = z.string().uuid();
export const runtimeGenerationSchema = z.string().regex(/^[1-9][0-9]{0,18}$/);
export const runtimeEnrollmentSchema = z
  .object({
    token: z.string().min(40).max(128),
    hostId: id,
    providerResourceId: id,
    region: z.literal("dk-cph1"),
    publicKeyPem: z.string().min(300).max(4096),
    agentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  })
  .strict();
export const runtimeHostProofSchema = z
  .object({
    hostId: id,
    epoch: z.coerce.number().int().positive(),
    timestamp: z.string().regex(/^[0-9]{13}$/),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{32,80}$/),
    signature: z.string().regex(/^[A-Za-z0-9_-]{100,1024}$/),
  })
  .strict();
export const runtimeInventoryCellSchema = z
  .object({
    cellId: id,
    companyId: id,
    generation: runtimeGenerationSchema,
    imageDigest: z.string().regex(/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/),
    status: z.enum(["healthy", "stopped", "starting", "failed", "fenced"]),
    cpuMillis: z.number().int().nonnegative(),
    memoryBytes: z.string().regex(/^\d+$/),
    diskBytes: z.string().regex(/^\d+$/),
  })
  .strict();
export const runtimeHeartbeatSchema = z
  .object({
    agentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    cells: z.array(runtimeInventoryCellSchema).max(1000),
  })
  .strict();
export const runtimeCommandResultSchema = z
  .object({
    claimToken: z.string().min(40).max(128),
    generation: runtimeGenerationSchema,
    success: z.boolean(),
    state: z.enum([
      "healthy",
      "stopped",
      "deleted",
      "backed_up",
      "restored",
      "failed",
    ]),
    errorCode: z
      .string()
      .regex(/^[a-z0-9_]{1,100}$/)
      .optional(),
    evidence: z
      .object({
        imageDigest: z.string().max(300).optional(),
        gatewayHandshake: z.boolean().optional(),
        volumeMounted: z.boolean().optional(),
        stateFormat: z.string().max(100).optional(),
        quarantined: z.boolean().optional(),
        credentialsRemoved: z.boolean().optional(),
        backupSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        backupBytes: z.string().regex(/^\d+$/).optional(),
      })
      .strict(),
  })
  .strict();
export { runtimeRequestSigningInput } from "./runtime-signing.js";
