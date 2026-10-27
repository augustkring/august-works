import { afterEach, describe, expect, it, vi } from "vitest";
import register from "./index.js";

const identity = {
  protocolVersion: 1,
  companyId: "company-1",
  agentId: "paperclip-agent-1",
  paperclipRunId: "paperclip-run-1",
  runtimeAdapter: "openclaw_gateway",
  runtimeCapabilitySnapshotHash: "provider-snapshot-1",
  operationManifestHash: "a".repeat(64),
  toolCatalogContractHash: "b".repeat(64),
  assignmentDigest: "e".repeat(64),
  platformSkill: { key: "blentera-platform", version: "1", digest: `sha256:${"c".repeat(64)}`, sourceSha: "d".repeat(40) },
};

function harness(fetchImpl: typeof fetch, allow = ["blentera_platform_list_tools", "blentera_platform_call_tool"]) {
  vi.stubGlobal("fetch", fetchImpl);
  const methods = new Map<string, Function>();
  let toolFactory: Function | { create: Function } | undefined;
  register({
    pluginConfig: { paperclipApiOrigins: ["https://paperclip.example"] },
    runtime: { config: { current: () => ({
      tools: { allow },
      agents: { entries: {
        "openclaw-agent-1": { tools: { allow } },
        "other-agent": { tools: { allow: ["blentera_platform_list_tools", "blentera_platform_call_tool"] } },
      } },
    }) } },
    registerGatewayMethod: (name: string, handler: Function) => methods.set(name, handler),
    registerTool: (factory: Function | { create: Function }) => { toolFactory = factory; },
  } as never);
  return { methods, makeTools: (ctx: unknown) => {
    const factory = toolFactory as unknown as Function | { create: Function };
    return (typeof factory === "function" ? factory(ctx) : factory?.create(ctx)) as Array<Record<string, any>>;
  } };
}

function mcpResponse(body: unknown, status = 200) {
  return new Response(status === 202 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function bindingFetch(options: { expired?: boolean; denyCall?: boolean; wrongRun?: boolean; mutateAttestation?: Record<string, unknown> } = {}): typeof fetch {
  return vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { method: string };
    if (request.method === "initialize") return mcpResponse({ jsonrpc: "2.0", id: "1", result: {
      serverInfo: { name: "blentera-mcp-gateway", version: "2.0.0" },
      _meta: { "blentera/governed-run-binding.v1": {
        ...identity,
        ...(options.wrongRun ? { paperclipRunId: "other-run" } : {}),
        ...options.mutateAttestation,
        responsibleUserId: "human-1",
        gatewayPublicId: "gw_abc",
        assignmentDigest: identity.assignmentDigest,
        tokenExpiresAt: new Date(Date.now() + (options.expired ? -1_000 : 30_000)).toISOString(),
      } },
    } });
    if (request.method === "notifications/initialized") return mcpResponse(null, 202);
    if (request.method === "tools/list") return mcpResponse({ jsonrpc: "2.0", id: "2", result: { tools: [
      { name: "paperclip_self_list_my_issues", description: "List assigned work", inputSchema: { type: "object", properties: {} } },
    ] } });
    if (request.method === "tools/call" && options.denyCall) return mcpResponse({ jsonrpc: "2.0", error: { code: -32000 } }, 403);
    return mcpResponse({ jsonrpc: "2.0", id: "3", result: { content: [{ type: "text", text: "ok" }] } });
  }) as typeof fetch;
}

function invokeHandler(handler: Function, params: unknown) {
  let result: unknown;
  return handler({ params, respond: (_ok: boolean, value: unknown) => { result = value; }, signal: new AbortController().signal,
    hasCurrentClientAuthority: () => true }).then(() => result);
}

const bindParams = {
  agentId: "openclaw-agent-1",
  sessionKey: "agent:openclaw-agent-1:paperclip:run:paperclip-run-1",
  providerRunId: "openclaw-run-1",
  paperclipRunId: identity.paperclipRunId,
  endpoint: "https://paperclip.example/mcp/gateways/gw_abc",
  token: "pcgw_secret_run_token_not_in_prompt",
  admission: identity,
};

afterEach(() => vi.unstubAllGlobals());

describe("Blentera OpenClaw governed bridge protocol v1", () => {
  it("binds only after authenticated exact-run metadata, then lists and calls through MCP", async () => {
    const api = harness(bindingFetch());
    const bound = await invokeHandler(api.methods.get("blentera.platform.bind.v1")!, bindParams) as Record<string, unknown>;
    expect(bound).toMatchObject({ protocolVersion: 1, pluginVersion: "1.0.0", toolCount: 1 });
    const [listTool, callTool] = api.makeTools({ agentId: bindParams.agentId, sessionKey: bindParams.sessionKey,
      runId: bindParams.providerRunId, assertInvocationCurrent: () => {} });
    expect((await listTool.execute("id", {})).content[0].text).toContain("paperclip_self_list_my_issues");
    expect((await callTool.execute("id", { name: "paperclip_self_list_my_issues", arguments: {} })).content[0].text).toContain("ok");
    await invokeHandler(api.methods.get("blentera.platform.unbind.v1")!, bindParams);
    await expect(listTool.execute("id", {})).rejects.toThrow("binding is not active");
  });

  it("rejects wrong run attestations and untrusted origins before exposing tools", async () => {
    const wrongRun = harness(bindingFetch({ wrongRun: true }));
    await expect(invokeHandler(wrongRun.methods.get("blentera.platform.bind.v1")!, bindParams)).rejects.toThrow("did not attest");
    const untrusted = harness(bindingFetch());
    await expect(invokeHandler(untrusted.methods.get("blentera.platform.bind.v1")!, {
      ...bindParams, endpoint: "https://attacker.example/mcp/gateways/gw_abc",
    })).rejects.toThrow("trusted HTTPS origins");
    const broadPolicyFetch = bindingFetch();
    const broadPolicy = harness(broadPolicyFetch, ["group:fs", "blentera_platform_list_tools", "blentera_platform_call_tool"]);
    await expect(invokeHandler(broadPolicy.methods.get("blentera.platform.bind.v1")!, bindParams)).rejects.toThrow("allow only the two Blentera");
    expect(broadPolicyFetch).not.toHaveBeenCalled();
  });

  it("rejects stale contract, assignment, capability, or Skill pins before tool discovery", async () => {
    const staleClaims = [
      { operationManifestHash: "0".repeat(64) },
      { toolCatalogContractHash: "0".repeat(64) },
      { assignmentDigest: "0".repeat(64) },
      { runtimeCapabilitySnapshotHash: "f".repeat(64) },
      { platformSkill: { ...identity.platformSkill, digest: `sha256:${"0".repeat(64)}` } },
    ];
    for (const mutateAttestation of staleClaims) {
      const fetchImpl = bindingFetch({ mutateAttestation });
      const api = harness(fetchImpl);
      await expect(invokeHandler(api.methods.get("blentera.platform.bind.v1")!, bindParams)).rejects.toThrow("did not attest");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects expired run tokens, current-policy revocation, and invocation context substitution", async () => {
    const expired = harness(bindingFetch({ expired: true }));
    await expect(invokeHandler(expired.methods.get("blentera.platform.bind.v1")!, bindParams)).rejects.toThrow("did not attest");

    const revoked = harness(bindingFetch({ denyCall: true }));
    await invokeHandler(revoked.methods.get("blentera.platform.bind.v1")!, bindParams);
    const [listTool, callTool] = revoked.makeTools({ agentId: bindParams.agentId, sessionKey: bindParams.sessionKey,
      runId: bindParams.providerRunId, assertInvocationCurrent: () => {} });
    await expect(callTool.execute("id", { name: "paperclip_self_list_my_issues", arguments: {} })).rejects.toThrow("rejected");
    const substituted = revoked.makeTools({ agentId: "other-agent", sessionKey: bindParams.sessionKey,
      runId: bindParams.providerRunId, assertInvocationCurrent: () => {} })[0];
    await expect(substituted.execute("id", {})).rejects.toThrow("binding is not active");
    expect(listTool).toBeTruthy();
  });
});
