import { createHmac, timingSafeEqual } from "node:crypto";
import { resolvePaperclipInstanceId } from "./home-paths.js";
import { conversationModelBindingSchema, workerModelBindingSchema, reviewModelBindingSchema,
  type ConversationModelBinding, type WorkerModelBinding, type ReviewModelBinding } from "@paperclipai/shared";
import { parseProviderConformanceRuntimeToolsBinding, providerConformanceTokenExpiry,
  type ProviderConformanceRuntimeToolsBinding } from "./provider-conformance-runtime-tools-claim.js";

export interface RuntimeToolsTokenClaims {
  sub: string;
  company_id: string;
  run_id: string;
  responsible_user_id: string;
  scope: "connection_intents" | "github_credentials" | "worker_model" | "review_model" | "conversation_model" | "provider_conformance";
  worker_model?: WorkerModelBinding;
  review_model?: ReviewModelBinding;
  conversation_model?: ConversationModelBinding;
  provider_conformance?: ProviderConformanceRuntimeToolsBinding;
  iat: number;
  exp: number;
  instance_id: string;
}

const TOKEN_TTL_SECONDS = 60 * 60;

function secret() {
  return process.env.PAPERCLIP_AGENT_JWT_SECRET?.trim()
    || process.env.BETTER_AUTH_SECRET?.trim()
    || null;
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(value: string, companyId: string, instanceId: string) {
  const master = secret();
  if (!master) return null;
  const key = createHmac("sha256", master)
    .update(`runtime-tools:${instanceId}:${companyId}`)
    .digest();
  return createHmac("sha256", key).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createRuntimeToolsToken(input: {
  agentId: string;
  companyId: string;
  runId: string;
  responsibleUserId: string;
  scope?: RuntimeToolsTokenClaims["scope"];
  workerModelBinding?: WorkerModelBinding;
  reviewModelBinding?: ReviewModelBinding;
  conversationModelBinding?: ConversationModelBinding;
  providerConformanceBinding?: ProviderConformanceRuntimeToolsBinding;
  /** Derived from current Sandbox policy, model session, and environment lease. */
  providerConformanceDeadlineAt?: Date;
}) {
  if (!secret()) return null;
  const binding = workerModelBindingSchema.safeParse(input.workerModelBinding);
  const conversationBinding = conversationModelBindingSchema.safeParse(input.conversationModelBinding);
  const reviewBinding = reviewModelBindingSchema.safeParse(input.reviewModelBinding);
  const providerConformanceBinding = parseProviderConformanceRuntimeToolsBinding(input.providerConformanceBinding);
  if (input.scope === "worker_model" && !binding.success) return null;
  if (input.scope === "conversation_model" && !conversationBinding.success) return null;
  if (input.scope === "review_model" && (!reviewBinding.success || reviewBinding.data.reviewerRunId !== input.runId || reviewBinding.data.reviewerAgentId !== input.agentId)) return null;
  if (input.scope === "provider_conformance" && (!providerConformanceBinding ||
    providerConformanceBinding.probeRunId !== input.runId)) return null;
  const now = Math.floor(Date.now() / 1000);
  const instanceId = resolvePaperclipInstanceId();
  const providerConformanceExpiry = input.scope === "provider_conformance" && providerConformanceBinding &&
    input.providerConformanceDeadlineAt instanceof Date && Number.isFinite(input.providerConformanceDeadlineAt.getTime())
    ? providerConformanceTokenExpiry(now, Math.floor(input.providerConformanceDeadlineAt.getTime() / 1000)) : null;
  if (input.scope === "provider_conformance" && !providerConformanceExpiry) return null;
  const claims: RuntimeToolsTokenClaims = {
    sub: input.agentId,
    company_id: input.companyId,
    run_id: input.runId,
    responsible_user_id: input.responsibleUserId,
    scope: input.scope ?? "connection_intents",
    ...(input.scope === "worker_model" && binding.success ? { worker_model: binding.data } : {}),
    ...(input.scope === "conversation_model" && conversationBinding.success
      ? { conversation_model: conversationBinding.data } : {}),
    ...(input.scope === "review_model" && reviewBinding.success ? { review_model: reviewBinding.data } : {}),
    ...(input.scope === "provider_conformance" && providerConformanceBinding
      ? { provider_conformance: providerConformanceBinding } : {}),
    iat: now,
    // Broker tokens remain scoped to a live run, which is rechecked on every use.
    exp: input.scope === "provider_conformance" ? providerConformanceExpiry! :
      now + (input.scope === "worker_model" || input.scope === "review_model" || input.scope === "conversation_model" ? 300 :
      input.scope === "github_credentials" ? 30 * 24 * 60 * 60 : TOKEN_TTL_SECONDS),
    instance_id: instanceId,
  };
  const signingInput = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;
  const signature = sign(signingInput, input.companyId, instanceId);
  return signature
    ? { token: `${signingInput}.${signature}`, expiresAt: new Date(claims.exp * 1000).toISOString() }
    : null;
}

export function verifyRuntimeToolsToken(token: string, scope: RuntimeToolsTokenClaims["scope"] = "connection_intents"): RuntimeToolsTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;
  const companyId = typeof claims.company_id === "string" ? claims.company_id : null;
  const instanceId = typeof claims.instance_id === "string" ? claims.instance_id : null;
  if (!companyId || !instanceId || instanceId !== resolvePaperclipInstanceId()) return null;
  const expected = sign(`${parts[0]}.${parts[1]}`, companyId, instanceId);
  if (!expected || !safeEqual(parts[2]!, expected)) return null;
  if (
    typeof claims.sub !== "string"
    || typeof claims.run_id !== "string"
    || typeof claims.responsible_user_id !== "string"
    || claims.scope !== scope
    || typeof claims.iat !== "number"
    || typeof claims.exp !== "number"
    || claims.exp <= Math.floor(Date.now() / 1000)
  ) return null;
  if (scope === "worker_model" && (
    !workerModelBindingSchema.safeParse(claims.worker_model).success
    || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
    || (claims.iat as number) > Math.floor(Date.now() / 1000)
    || (claims.exp as number) <= (claims.iat as number)
    || (claims.exp as number) - (claims.iat as number) > 300
  )) return null;
  if (scope === "review_model" && (
    !reviewModelBindingSchema.safeParse(claims.review_model).success
    || (claims.review_model as ReviewModelBinding).reviewerRunId !== claims.run_id
    || (claims.review_model as ReviewModelBinding).reviewerAgentId !== claims.sub
    || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
    || (claims.iat as number) > Math.floor(Date.now() / 1000)
    || (claims.exp as number) <= (claims.iat as number)
    || (claims.exp as number) - (claims.iat as number) > 300
  )) return null;
  if (scope === "conversation_model" && (
    !conversationModelBindingSchema.safeParse(claims.conversation_model).success
    || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
    || (claims.iat as number) > Math.floor(Date.now() / 1000)
    || (claims.exp as number) <= (claims.iat as number)
    || (claims.exp as number) - (claims.iat as number) > 300
  )) return null;
  if (scope === "provider_conformance") {
    const binding = parseProviderConformanceRuntimeToolsBinding(claims.provider_conformance);
    if (!binding || binding.probeRunId !== claims.run_id ||
      !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
      (claims.iat as number) > Math.floor(Date.now() / 1000) ||
      (claims.exp as number) <= (claims.iat as number) ||
      (claims.exp as number) - (claims.iat as number) > 60) return null;
  }
  return claims as unknown as RuntimeToolsTokenClaims;
}
