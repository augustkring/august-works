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
  imageDigest: z.string().regex(/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/i),
  argv: z.array(z.string().min(1).max(8192)).min(1).max(64),
  cwd: z.string().min(1).max(4096),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/), z.string().max(8192)).refine(value => Object.keys(value).length <= 64),
  brokerCredential: z.object({
    capabilityToken: z.string().min(1).max(16_384),
    profileId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
    profileHash: digest,
    expiresAt: z.iso.datetime(),
  }).strict().optional(),
  modelBrokerCredential: z.object({
    capabilityToken: z.string().min(1).max(16_384),
    profileId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
    profileHash: digest,
    expiresAt: z.iso.datetime(),
    inputTokensUpperBound: z.number().int().min(1).max(2_000_000),
    maxOutputTokens: z.number().int().min(256).max(8192),
  }).strict().optional(),
  // Pipe the bounded string schema into the regex validator so Zod never
  // evaluates the expression against an over-limit attacker-controlled body.
  stdinBase64: z.string().max(512 * 1024).pipe(z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)),
}).strict().superRefine((value, ctx) => {
  const commandBytes = new TextEncoder().encode(JSON.stringify(value.argv)).byteLength + new TextEncoder().encode(JSON.stringify(value.env)).byteLength + (value.brokerCredential?.capabilityToken.length ?? 0) + (value.modelBrokerCredential?.capabilityToken.length ?? 0) + value.stdinBase64.length;
  if (commandBytes > 768 * 1024) ctx.addIssue({ code: "custom", message: "exec_request_too_large" });
  if (!value.cwd.startsWith("/")) ctx.addIssue({ code: "custom", message: "exec_workdir_must_be_absolute" });
  // These are public numeric limits, admitted only when they duplicate the
  // typed credential exactly; they never carry a credential value.
  const managedModelBoundNames = new Set([
    "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND",
    "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS",
  ]);
  if (Object.keys(value.env).some(key =>
    /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|AUTHORIZATION)/i.test(key) &&
    !managedModelBoundNames.has(key)))
    ctx.addIssue({ code: "custom", message: "raw_managed_credentials_are_not_supported" });
  const inputBound = value.env.PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND;
  const outputBound = value.env.PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS;
  if (value.modelBrokerCredential) {
    if (inputBound !== String(value.modelBrokerCredential.inputTokensUpperBound) ||
      outputBound !== String(value.modelBrokerCredential.maxOutputTokens))
      ctx.addIssue({ code: "custom", message: "managed_model_bounds_do_not_match_typed_credential" });
  } else if (inputBound !== undefined || outputBound !== undefined) {
    ctx.addIssue({ code: "custom", message: "managed_model_bounds_require_typed_credential" });
  }
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
