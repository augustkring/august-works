import { Type } from "typebox";
import { jsonResult } from "openclaw/plugin-sdk/channel-actions";
import crypto from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

const PROTOCOL_VERSION = 1;
const MAX_BINDINGS = 256;
const MAX_BODY_BYTES = 1_048_576;
const MAX_TOOLS = 500;
const MAX_BIND_TTL_MS = 60 * 60 * 1000;
const TOOL_LIST = "blentera_platform_list_tools";
const TOOL_CALL = "blentera_platform_call_tool";
type JsonRecord = Record<string, any>;
type Admission = JsonRecord & { companyId: string; agentId: string; paperclipRunId: string; runtimeAdapter: string;
  runtimeCapabilitySnapshotHash: string | null; operationManifestHash: string; toolCatalogContractHash: string;
  assignmentDigest: string; platformSkill: { key: string; version: string; digest: string; sourceSha: string } };
type BridgeBinding = { endpoint: string; token: string; expiresAt: number; agentId: string; sessionKey: string;
  providerRunId: string; paperclipRunId: string; expected: Admission; toolsHash?: string; toolCount?: number; tools?: Set<string> };
const bindingKey = (agentId: string, sessionKey: string, runId: string) => `${agentId}\0${sessionKey}\0${runId}`;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value);
}

function strictEndpoint(value: unknown, origins: Set<string>): string {
  let endpoint;
  try { endpoint = new URL(value); } catch { throw new Error("The Paperclip MCP endpoint is invalid"); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !/^\/mcp\/gateways\/gw_[A-Za-z0-9_-]{1,128}$/.test(endpoint.pathname) ||
      !origins.has(endpoint.origin)) {
    throw new Error("The Paperclip MCP endpoint is outside the configured trusted HTTPS origins");
  }
  return endpoint.toString();
}

function parseAdmission(value: unknown): Admission {
  const admission = record(value);
  const skill = record(admission?.platformSkill);
  if (!admission || admission.protocolVersion !== PROTOCOL_VERSION ||
      !validId(admission.companyId) || !validId(admission.agentId) ||
      !validId(admission.paperclipRunId) ||
      !validId(admission.runtimeAdapter) ||
      admission.runtimeCapabilitySnapshotHash !== null && !validId(admission.runtimeCapabilitySnapshotHash) ||
      !validId(admission.operationManifestHash) || !validId(admission.toolCatalogContractHash) ||
      admission.runtimeCapabilitySnapshotHash !== null && !/^[a-f0-9]{64}$/.test(admission.runtimeCapabilitySnapshotHash) ||
      !/^[a-f0-9]{64}$/.test(admission.operationManifestHash) ||
      !/^[a-f0-9]{64}$/.test(admission.toolCatalogContractHash) ||
      !/^[a-f0-9]{64}$/.test(admission.assignmentDigest) ||
      !skill || skill.key !== "blentera-platform" || !validId(skill.version) ||
      !/^sha256:[a-f0-9]{64}$/.test(skill.digest) || !/^[a-f0-9]{40}$/.test(skill.sourceSha)) {
    throw new Error("The Paperclip run admission is incomplete or invalid");
  }
  return admission;
}

async function mcpRequest(binding: BridgeBinding, method: string, params: Record<string, unknown> = {}): Promise<any> {
  if (Date.now() >= binding.expiresAt) throw new Error("The Paperclip tool binding expired");
  const body = JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params });
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) throw new Error("The Paperclip MCP request exceeded its size limit");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(binding.endpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { authorization: `Bearer ${binding.token}`, "content-type": "application/json", accept: "application/json" },
      body,
    });
    if (method === "notifications/initialized" && response.status === 202) return null;
    if (!response.ok || response.status > 299) throw new Error(`The Paperclip MCP Gateway rejected the request (HTTP ${response.status})`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The Paperclip MCP Gateway returned an empty response");
    const chunks = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("The Paperclip MCP response exceeded its size limit");
      }
      chunks.push(next.value);
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    const envelope = record(JSON.parse(text));
    if (!envelope || envelope.jsonrpc !== "2.0" || envelope.error) throw new Error("The Paperclip MCP Gateway rejected the request");
    if (!Object.hasOwn(envelope, "result")) throw new Error("The Paperclip MCP response is incomplete");
    return envelope.result;
  } finally {
    clearTimeout(timeout);
  }
}

function hashTools(tools: JsonRecord[]): string {
  const canonical = JSON.stringify(tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema,
  })));
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function prune(bindings: Map<string, BridgeBinding>): void {
  const now = Date.now();
  for (const [key, binding] of bindings) if (binding.expiresAt <= now) bindings.delete(key);
}

function assertDedicatedToolBoundary(configValue: unknown, agentId: string): void {
  const config = record(configValue);
  const agents = record(config?.agents);
  const entries = record(agents?.entries);
  const listed = Array.isArray(agents?.list)
    ? agents.list.find((candidate) => record(candidate)?.id === agentId)
    : null;
  const agent = record(entries?.[agentId]) ?? record(listed);
  const expected = [TOOL_CALL, TOOL_LIST].sort();
  const policies = [record(config?.tools), record(record(agents?.defaults)?.tools), record(agent?.tools)].filter(Boolean);
  if (!agent || !policies.length) throw new Error("The OpenClaw agent must have a dedicated Blentera-only tool allowlist");
  for (const policy of policies as JsonRecord[]) {
    const allow = Array.isArray(policy.allow) ? policy.allow.filter((value: unknown): value is string => typeof value === "string").sort() : null;
    const alsoAllow = Array.isArray(policy.alsoAllow) ? policy.alsoAllow : [];
    if (!allow || JSON.stringify(allow) !== JSON.stringify(expected) || alsoAllow.length > 0 ||
        (Array.isArray(policy.deny) && policy.deny.some((name: unknown) => expected.includes(String(name))))) {
      throw new Error("The OpenClaw agent tool policy must allow only the two Blentera bridge tools");
    }
  }
}

export default function register(api: OpenClawPluginApi): void {
  const origins = new Set((api.pluginConfig?.paperclipApiOrigins ?? []).map((entry) => {
    const url = new URL(entry);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Blentera bridge origins must be HTTPS origins without path, query, or credentials");
    }
    return url.origin;
  }));
  if (!origins.size) throw new Error("Configure at least one trusted Paperclip HTTPS API origin");

  const bindings = new Map();
  const assertCurrent = ({ signal, hasCurrentClientAuthority }: { signal?: AbortSignal; hasCurrentClientAuthority?: () => boolean }) => {
    signal?.throwIfAborted();
    if (hasCurrentClientAuthority?.() === false) throw new Error("OpenClaw Gateway authority ended; reconnect and retry");
  };

  api.registerGatewayMethod("blentera.platform.bind.v1", async ({ params, respond, signal, hasCurrentClientAuthority }) => {
    assertCurrent({ signal, hasCurrentClientAuthority });
    const p = record(params);
    const allowed = ["agentId", "sessionKey", "providerRunId", "paperclipRunId", "endpoint", "token", "admission"];
    if (!p || Object.keys(p).some((key) => !allowed.includes(key)) ||
        !validId(p.agentId) || !validId(p.sessionKey) || !validId(p.providerRunId) ||
        !validId(p.paperclipRunId) || typeof p.token !== "string" || p.token.length < 24 || p.token.length > 2048) {
      throw new Error("Invalid Blentera run binding request");
    }
    assertDedicatedToolBoundary(api.runtime.config.current(), p.agentId);
    const endpoint = strictEndpoint(p.endpoint, origins);
    const expected = parseAdmission(p.admission);
    if (expected.paperclipRunId !== p.paperclipRunId) throw new Error("Run binding identity does not match the server admission");
    const key = bindingKey(p.agentId, p.sessionKey, p.providerRunId);
    const expiresAt = Date.now() + MAX_BIND_TTL_MS;

    const candidate: BridgeBinding = { endpoint, token: p.token, expiresAt, agentId: p.agentId, sessionKey: p.sessionKey,
      providerRunId: p.providerRunId, paperclipRunId: p.paperclipRunId, expected };
    const initialized = record(await mcpRequest(candidate, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "blentera-openclaw-bridge", version: "1.0.0" } }));
    const serverInfo = record(initialized?.serverInfo);
    const meta = record(initialized?._meta);
    const attestation = record(meta?.["blentera/governed-run-binding.v1"]);
    if (serverInfo?.name !== "blentera-mcp-gateway" || serverInfo.version !== "2.0.0" ||
        !attestation || attestation.protocolVersion !== PROTOCOL_VERSION ||
        attestation.companyId !== expected.companyId || attestation.agentId !== expected.agentId ||
        attestation.paperclipRunId !== expected.paperclipRunId ||
        !validId(attestation.responsibleUserId) ||
        attestation.runtimeAdapter !== expected.runtimeAdapter ||
        attestation.runtimeCapabilitySnapshotHash !== expected.runtimeCapabilitySnapshotHash ||
        attestation.operationManifestHash !== expected.operationManifestHash ||
        attestation.toolCatalogContractHash !== expected.toolCatalogContractHash ||
        attestation.assignmentDigest !== expected.assignmentDigest ||
        record(attestation.platformSkill)?.key !== expected.platformSkill.key ||
        record(attestation.platformSkill)?.version !== expected.platformSkill.version ||
        record(attestation.platformSkill)?.digest !== expected.platformSkill.digest ||
        record(attestation.platformSkill)?.sourceSha !== expected.platformSkill.sourceSha ||
        !Number.isFinite(Date.parse(attestation.tokenExpiresAt)) || Date.parse(attestation.tokenExpiresAt) <= Date.now() ||
        !validId(attestation.gatewayId) || !validId(attestation.gatewayProfileId) ||
        !validId(attestation.gatewayPublicId) || !new URL(endpoint).pathname.endsWith(`/${attestation.gatewayPublicId}`)) {
      throw new Error("The Paperclip MCP Gateway did not attest the exact current run admission");
    }
    candidate.expiresAt = Math.min(expiresAt, Date.parse(attestation.tokenExpiresAt));
    await mcpRequest(candidate, "notifications/initialized");
    const result = record(await mcpRequest(candidate, "tools/list"));
    const tools = Array.isArray(result?.tools) ? result.tools as JsonRecord[] : null;
    if (!tools || tools.length > MAX_TOOLS || tools.some((tool) => !record(tool) || !validId(tool.name) || !record(tool.inputSchema))) {
      throw new Error("The Paperclip MCP tool catalog is invalid or exceeds its limit");
    }
    candidate.toolsHash = hashTools(tools);
    candidate.toolCount = tools.length;
    candidate.tools = new Set(tools.map((tool) => tool.name));
    assertCurrent({ signal, hasCurrentClientAuthority });
    prune(bindings);
    if (bindings.size >= MAX_BINDINGS && !bindings.has(key)) throw new Error("The OpenClaw Blentera bridge is at its active binding limit");
    const prior = bindings.get(key);
    if (prior && (prior.token !== candidate.token || prior.toolsHash !== candidate.toolsHash || prior.paperclipRunId !== candidate.paperclipRunId)) {
      bindings.delete(key);
      throw new Error("A different Paperclip binding already owns this OpenClaw run");
    }
    bindings.set(key, candidate);
    respond(true, { protocolVersion: PROTOCOL_VERSION, pluginVersion: "1.0.0", toolCount: tools.length, toolsHash: candidate.toolsHash });
  }, { scope: "operator.write", sessionAccess: { mode: "write" } });

  api.registerGatewayMethod("blentera.platform.status.v1", async ({ params, respond, signal, hasCurrentClientAuthority }) => {
    assertCurrent({ signal, hasCurrentClientAuthority });
    const p = record(params);
    if (!p || !validId(p.agentId) || !validId(p.sessionKey) || !validId(p.providerRunId)) throw new Error("Invalid Blentera status request");
    prune(bindings);
    const binding = bindings.get(bindingKey(p.agentId, p.sessionKey, p.providerRunId));
    respond(true, binding ? { protocolVersion: PROTOCOL_VERSION, pluginVersion: "1.0.0", ready: true,
      toolCount: binding.toolCount, toolsHash: binding.toolsHash, paperclipRunId: binding.paperclipRunId,
      expiresAt: new Date(binding.expiresAt).toISOString() } : { protocolVersion: PROTOCOL_VERSION, pluginVersion: "1.0.0", ready: false });
  }, { scope: "operator.read", sessionAccess: { mode: "write" } });

  api.registerGatewayMethod("blentera.platform.unbind.v1", async ({ params, respond, signal, hasCurrentClientAuthority }) => {
    assertCurrent({ signal, hasCurrentClientAuthority });
    const p = record(params);
    if (!p || !validId(p.agentId) || !validId(p.sessionKey) || !validId(p.providerRunId)) throw new Error("Invalid Blentera unbind request");
    bindings.delete(bindingKey(p.agentId, p.sessionKey, p.providerRunId));
    respond(true, { protocolVersion: PROTOCOL_VERSION, removed: true });
  }, { scope: "operator.write", sessionAccess: { mode: "write" } });

  api.registerTool({ contextVersion: 2, create: (ctx) => {
    const agentId = ctx.agentId;
    const sessionKey = ctx.sessionKey;
    const providerRunId = ctx.runId;
    const key = agentId && sessionKey && providerRunId ? bindingKey(agentId, sessionKey, providerRunId) : "";
    const getBinding = () => {
      ctx.assertInvocationCurrent();
      if (!key) throw new Error("Blentera governed tools require a host-owned active agent/session/run context");
      assertDedicatedToolBoundary(api.runtime.config.current(), agentId);
      const binding = bindings.get(key);
      if (!binding || binding.expiresAt <= Date.now()) {
        bindings.delete(key);
        throw new Error("The exact Paperclip run binding is not active; tool use is denied until the adapter completes the bind handshake");
      }
      return binding;
    };
    return [
      {
        name: TOOL_LIST,
        label: "List approved Blentera tools",
        description: "List tools available to this exact Paperclip run under current company policy.",
        parameters: Type.Object({}, { additionalProperties: false }),
        execute: async () => {
          const binding = getBinding();
          const result = record(await mcpRequest(binding, "tools/list"));
          const tools: JsonRecord[] = Array.isArray(result?.tools) ? result.tools : [];
          return jsonResult({ tools: tools.map((tool) => ({ name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema })) });
        },
      },
      {
        name: TOOL_CALL,
        label: "Use an approved Blentera tool",
        description: "Call one tool from the current Paperclip Gateway catalog. The Gateway rechecks permission and run authority on every call.",
        parameters: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 300 }),
          arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        }, { additionalProperties: false }),
        execute: async (_id: string, args: Record<string, unknown>) => {
          const binding = getBinding();
          const name = args?.name;
          if (typeof name !== "string" || !binding.tools.has(name)) throw new Error("The requested tool is not in this run's current Paperclip catalog");
          const fresh = record(await mcpRequest(binding, "tools/list"));
          const tools: JsonRecord[] = Array.isArray(fresh?.tools) ? fresh.tools : [];
          binding.tools = new Set(tools.map((tool) => tool?.name).filter((item) => typeof item === "string"));
          if (!binding.tools.has(name)) throw new Error("The requested tool is no longer available under current Paperclip policy");
          const result = await mcpRequest(binding, "tools/call", { name, arguments: record(args?.arguments) ?? {} });
          return jsonResult(result);
        },
      },
    ];
  } }, { names: [TOOL_LIST, TOOL_CALL], workspaceAccess: false });
}
