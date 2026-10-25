import { z } from "zod";
import {
  runtimeGenerationSchema,
  runtimeHostProofSchema,
} from "./runtime-host-contracts.js";
const channelId = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/i);
const sandboxExecRequest = z.object({
  requestId: z.string().uuid(),
  bindingId: z.string().uuid(),
  hostEpoch: z.number().int().positive(),
  runId: z.string().uuid(),
  attemptId: z.string().uuid().nullable(),
  attempt: z.number().int().positive(),
  manifestId: z.string().uuid(),
  manifestHash: digest,
  policySnapshotId: z.string().uuid(),
  policyHash: digest,
  commandDigest: digest,
  deadlineAt: z.iso.datetime(),
  sandboxRef: z.string().regex(/^aw-v7-[a-f0-9-]{36}$/i),
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/i),
  argv: z.array(z.string().min(1).max(8192)).min(1).max(64),
  cwd: z.string().min(1).max(4096),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/), z.string().max(8192)).refine(value => Object.keys(value).length <= 64),
  stdinBase64: z.string().max(512 * 1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict().superRefine((value, ctx) => {
  const commandBytes = new TextEncoder().encode(JSON.stringify(value.argv)).byteLength + new TextEncoder().encode(JSON.stringify(value.env)).byteLength + value.stdinBase64.length;
  if (commandBytes > 768 * 1024) ctx.addIssue({ code: "custom", message: "exec_request_too_large" });
  if (!value.cwd.startsWith("/")) ctx.addIssue({ code: "custom", message: "exec_workdir_must_be_absolute" });
  if (Object.keys(value.env).some(key => /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|AUTHORIZATION)/i.test(key)))
    ctx.addIssue({ code: "custom", message: "raw_managed_credentials_are_not_supported" });
});
export const runtimeSandboxExecRelayRequestSchema = sandboxExecRequest;
export type RuntimeSandboxExecRelayRequest = z.infer<typeof sandboxExecRequest>;
export const runtimeRelayMessageSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("hello"), proof: runtimeHostProofSchema })
    .strict(),
  z
    .object({
      type: z.literal("open"),
      channelId,
      cellId: z.string().uuid(),
      companyId: z.string().uuid(),
      generation: runtimeGenerationSchema,
    })
    .strict(),
  z.object({ type: z.literal("opened"), channelId }).strict(),
  z
    .object({
      type: z.literal("data"),
      channelId,
      text: z.string().max(1024 * 1024),
    })
    .strict(),
  z.object({ type: z.literal("close"), channelId }).strict(),
  z.object({
    type: z.literal("exec_open"), channelId,
    cellId: z.string().uuid(), companyId: z.string().uuid(), generation: runtimeGenerationSchema,
    capabilityToken: z.string().min(1).max(16_384), request: sandboxExecRequest,
  }).strict(),
  z.object({
    type: z.literal("exec_output"), channelId,
    stream: z.enum(["stdout", "stderr"]), base64: z.string().min(1).max(128 * 1024),
  }).strict(),
  z.object({ type: z.literal("exec_exit"), channelId, exitCode: z.number().int().min(-255).max(255), timedOut: z.boolean() }).strict(),
  z.object({ type: z.literal("exec_error"), channelId, code: z.enum(["runtime_unavailable", "policy_changed", "exec_unknown", "exec_rejected", "exec_timeout"]) }).strict(),
]);
