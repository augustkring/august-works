import { adapterNetworkFetch } from "@paperclipai/adapter-utils/network-policy";
import type { ServerAdapterModule } from "@paperclipai/adapter-utils";
import { allowsInsecureRemoteHttp, isRemotePlainHttp, remotePlainHttpDeniedMessage } from "./transport-security.js";
import { normalizeBaseUrl } from "./execute.js";

const FEATURES = ["sessions", "cancellation", "steering", "structuredOutput", "skillsDiscovery", "skillsSync", "toolDiscovery", "memoryScoping"] as const;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Hermes capability metadata");
  return value as Record<string, unknown>;
}

function inventory(value: unknown) {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Invalid Hermes capability inventory");
  return value.map((entry) => {
    const item = object(entry);
    if (typeof item.id !== "string" || !item.id || item.id.length > 200 || typeof item.name !== "string" || !item.name || item.name.length > 200) throw new Error("Invalid Hermes capability descriptor");
    if (item.description !== undefined && (typeof item.description !== "string" || item.description.length > 2000)) throw new Error("Invalid Hermes capability description");
    if (item.version !== undefined && item.version !== null && (typeof item.version !== "string" || item.version.length > 200)) throw new Error("Invalid Hermes capability version");
    return { id: item.id, name: item.name, description: typeof item.description === "string" ? item.description : "", version: typeof item.version === "string" ? item.version : null };
  });
}

export const discoverCapabilities: NonNullable<ServerAdapterModule["discoverCapabilities"]> = async (ctx) => {
  const base = normalizeBaseUrl(String(ctx.config.apiBaseUrl ?? ctx.config.url ?? ""));
  if (!base) throw new Error("A valid Hermes API URL is required");
  if (isRemotePlainHttp(base) && !allowsInsecureRemoteHttp(ctx.config)) throw new Error(remotePlainHttpDeniedMessage(base.hostname));
  const apiKey = ctx.config.apiKey ?? ctx.config.token;
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("A Hermes API credential is required");
  const signal = AbortSignal.timeout(10_000);
  async function get(path: string) {
    const response = await adapterNetworkFetch(`${base!.toString().replace(/\/$/, "")}${path}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }, signal, redirect: "error" });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Hermes metadata unavailable (${response.status})`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Hermes metadata response is empty");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("Hermes metadata response exceeds its limit"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  }
  const metadata = object(await get("/v1/capabilities")), declared = object(metadata.features);
  const features = Object.fromEntries(FEATURES.map((key) => {
    if (declared[key] !== undefined && typeof declared[key] !== "boolean") throw new Error("Invalid Hermes capability feature");
    return [key, declared[key] === true];
  })) as Record<(typeof FEATURES)[number], boolean>;
  if (metadata.version !== null && (typeof metadata.version !== "string" || metadata.version.length > 200)) throw new Error("Invalid Hermes provider version");
  const skills = features.skillsDiscovery ? inventory(object(await get("/v1/skills")).skills) : [];
  const tools = features.toolDiscovery ? inventory(object(await get("/v1/toolsets")).tools) : [];
  return { provider: "hermes", version: metadata.version as string | null, features, skills, tools, discoveredAt: new Date().toISOString() };
};
