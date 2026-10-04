import { z } from "zod";
import type { AdapterEnvironmentTestContext, ServerAdapterModule } from "@paperclipai/adapter-utils";
import { PROVIDER_CAPABILITY_FEATURES } from "@paperclipai/shared";
import { guardedHttpAdapterFetch } from "../adapters/http/remote-fetch.js";

const endpoint = z.string().url().max(2000).refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
}, "Agent Card interfaces must contain credential-free HTTP endpoints");
const cardSchema = z.object({
  name: z.string().min(1).max(200), version: z.string().min(1).max(200), protocolVersion: z.string().max(100).optional(),
  provider: z.object({ organization: z.string().max(200) }).passthrough().optional(),
  url: endpoint.optional(), preferredTransport: z.string().min(1).max(100).optional(),
  supportedInterfaces: z.array(z.object({ url: endpoint, protocolBinding: z.string().min(1).max(100) }).passthrough()).max(16).optional(),
  additionalInterfaces: z.array(z.object({ url: endpoint, transport: z.string().min(1).max(100) }).passthrough()).max(16).optional(),
  capabilities: z.object({ streaming: z.boolean().optional() }).passthrough(),
  defaultOutputModes: z.array(z.string().max(100)).max(32).optional(),
  security: z.array(z.record(z.string().min(1).max(100), z.array(z.string().max(200)).max(32))).max(16).optional(),
  securityRequirements: z.array(z.record(z.string().min(1).max(100), z.array(z.string().max(200)).max(32))).max(16).optional(),
  skills: z.array(z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), description: z.string().max(2000).default("") }).passthrough()).max(500),
}).passthrough();

export function mapA2AAgentCard(raw: unknown) {
  const card = cardSchema.parse(raw);
  const interfaces = card.supportedInterfaces?.map((item) => ({ protocol: item.protocolBinding, url: item.url })) ?? [
    ...(card.url ? [{ protocol: card.preferredTransport ?? "JSONRPC", url: card.url }] : []),
    ...(card.additionalInterfaces ?? []).map((item) => ({ protocol: item.transport, url: item.url })),
  ];
  if (!interfaces.length || interfaces.length > 16) throw new Error("An Agent Card must advertise bounded transport interfaces");
  // Agent Card advertisements describe the remote service. They do not grant
  // AW authority or prove sessions, cancellation, physical isolation or sync.
  const features = Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map((key) => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>;
  features.skillsDiscovery = true;
  features.structuredOutput = card.defaultOutputModes?.includes("application/json") ?? false;
  // A supported transport declares operations, never passing conformance.
  if (card.protocolVersion === "0.3.0" && interfaces.some(item => item.protocol.toUpperCase() === "JSONRPC")) {
    features.sessions = true;
    features.cancellation = true;
  }
  return { provider: "a2a", streaming: card.capabilities.streaming ?? false, providerAgentRef: card.name, version: card.version, protocolVersion: card.protocolVersion ?? null, providerOrganization: card.provider?.organization ?? null, interfaces, securityRequirements: card.securityRequirements ?? card.security ?? [], features, skills: card.skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, version: card.version })), tools: [], discoveredAt: new Date().toISOString() };
}

export const discoverA2ACapabilities: NonNullable<ServerAdapterModule["discoverCapabilities"]> = async (ctx: AdapterEnvironmentTestContext) => {
  const configured = ctx.config.agentCardUrl;
  const base = typeof ctx.config.url === "string" ? new URL(ctx.config.url) : null;
  const url = endpoint.parse(typeof configured === "string" ? configured : base ? new URL("/.well-known/agent-card.json", base).toString() : "");
  if (base && new URL(url).origin !== base.origin) throw new Error("Agent Card must use the configured provider origin");
  const headers = z.record(z.string(), z.string()).parse(ctx.config.headers ?? {});
  const response = await guardedHttpAdapterFetch(url, { method: "GET", headers: { ...headers, Accept: "application/json" }, signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Agent Card is unavailable"); }
  return mapA2AAgentCard(await readA2AJsonResponse(response));
};

export async function readA2AJsonResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty Agent Card response");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) { await reader.cancel(); throw new Error("Agent Card exceeds the metadata limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
