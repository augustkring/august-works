import { describe, expect, it, vi } from "vitest";
import { toolCatalogEntries, toolInvocations, toolMcpGateways, type Db } from "@paperclipai/db";
import { validateToolContent } from "../tool-content-guards.js";
import { ToolGatewayHttpError, type ToolGatewayDescriptor, type ToolGatewayService } from "../tool-gateway.js";
import { createAssignedMcpTools, getAssignedMcpGateway, registerAssignedMcpGateway } from "./assigned-mcp-tools.js";

function descriptor(name: string, risk: ToolGatewayDescriptor["risk"] = "read"): ToolGatewayDescriptor {
  return { name, displayName: name, description: `Use ${name}`, parametersSchema: { type: "object", properties: { query: { type: "string" } } }, pluginId: "fixture", providerType: "mcp_remote_http", risk, catalogEntryId: "catalog-fixture" };
}

function fixture(tools: ToolGatewayDescriptor[]) {
  const listToolsForNamedGateway = vi.fn().mockResolvedValue(tools);
  let lastCall: Record<string, unknown> | null = null;
  let response: Record<string, unknown> = { status: "completed", invocationId: "invocation-fixture", result: { content: [{ type: "text", text: "memory found" }] } };
  let pendingMode = false;
  const executeTool = vi.fn(async (call: Record<string, unknown>) => { lastCall = call; return response; });
  const gateway = {
    listToolsForNamedGateway,
    executeTool,
    assertNativeAssignedMcpDescriptorCurrent: vi.fn().mockResolvedValue(true),
    getNativeAssignedMcpCredentialSnapshot: vi.fn().mockResolvedValue({ versionId: "credential-version-fixture", scope: "fixture" }),
  } as unknown as ToolGatewayService;
  const tableRows = async (table: unknown): Promise<unknown[]> => {
    if (table === toolMcpGateways) return [{ id: "gateway-row-fixture", profileId: "profile-fixture" }];
    if (table === toolCatalogEntries) return [{ schemaHash: "schema-fixture" }];
    if (table === toolInvocations) {
      const call = (executeTool.mock.calls.at(-1)?.[0] ?? lastCall) as { tool?: string; parameters?: unknown; idempotencyKey?: string } | null;
      const selected = tools.find(tool => tool.name === call?.tool);
      if (!call || !selected || !call.parameters || typeof call.idempotencyKey !== "string") return [];
      const result = pendingMode ? undefined : (((await executeTool.mock.results.at(-1)?.value) as { result?: unknown } | undefined)?.result ?? (response as { result?: unknown }).result);
      const argumentsHash = validateToolContent({ value: call.parameters, direction: "arguments", sensitiveMode: "block", promptInjectionMode: "ignore" }).summary.sha256;
      const resultHash = pendingMode ? null : validateToolContent({ value: result, direction: "result", sensitiveMode: "redact", promptInjectionMode: "block" }).summary.sha256;
      return [{ id: "invocation-fixture", companyId: "company-fixture", agentId: "agent-fixture", issueId: "issue-fixture", runId: "run-fixture",
        gatewayId: "gateway-row-fixture", gatewayPublicId: "gateway-fixture", connectionId: selected.connectionId ?? null,
        catalogEntryId: selected.catalogEntryId ?? null, catalogSchemaHash: "schema-fixture", toolName: selected.name,
        status: pendingMode ? "awaiting_approval" : "succeeded", approvalState: pendingMode ? "pending" : undefined,
        idempotencyKey: call.idempotencyKey, argumentsHash, resultHash: pendingMode ? null : resultHash,
        argumentsSummary: {}, workflowResultJson: pendingMode ? null : result, credentialScopeSummary: { versionId: "credential-version-fixture" } }];
    }
    return [];
  };
  const db = { select: () => {
    let table: unknown;
    const rows = () => tableRows(table);
    const query: any = {
      from(value: unknown) { table = value; return this; },
      where() { return this; },
      limit() { return rows(); },
      then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) { return rows().then(resolve, reject); },
    };
    return query;
  } } as unknown as Db;
  return { gateway, db, listToolsForNamedGateway, executeTool, gatewayPublicId: "gateway-fixture", bearerToken: "private-run-token-never-project",
    setResponse(value: Record<string, unknown>) { response = value; }, setPendingMode(value: boolean) { pendingMode = value; } };
}

const fixtureOwner = { companyId: "company-fixture", issueId: "issue-fixture", runId: "run-fixture", agentId: "agent-fixture", responsibleUserId: "human-fixture" };
function createForFixture(f: ReturnType<typeof fixture>, workMode?: "standard" | "planning" | "ask") {
  return createAssignedMcpTools({ db: f.db, ...fixtureOwner, gateway: f.gateway, gatewayPublicId: f.gatewayPublicId, bearerToken: f.bearerToken, workMode });
}
let callSequence = 0;
function executeForFixture(assigned: Awaited<ReturnType<typeof createAssignedMcpTools>>, call: { tool: string; arguments: unknown }, mode?: "standard" | "planning" | "ask", onInvocation?: Parameters<typeof assigned.execute>[2], onPending?: Parameters<typeof assigned.execute>[3], onSearch?: Parameters<typeof assigned.execute>[4]) {
  return assigned.execute({ ...call, callId: `unit-call-${++callSequence}` }, mode, onInvocation, onPending, onSearch);
}

describe("assigned MCP runner tools", () => {
  const searchName = "paperclip_search_assigned_tools";
  const callName = "paperclip_call_assigned_tool";

  it("pages through an oversized catalog and calls every tool through the original gateway", async () => {
    const f = fixture(Array.from({ length: 224 }, (_, i) => descriptor(`app.action_${i}`)));
    const assigned = await createForFixture(f);
    const direct = assigned.definitions();
    const compact = assigned.definitions(tools => tools.length <= 200);
    expect(compact.map(tool => tool.name)).toEqual([searchName, callName]);
    expect(assigned.definitions(tools => tools.length <= 224)).toEqual(direct);
    expect(() => assigned.definitions(() => false)).toThrow("assigned_mcp_tool_catalog_capacity_exceeded");
    const seen: string[] = [];
    let offset: number | null = 0;
    do {
      const page = await executeForFixture(assigned, { tool: searchName, arguments: { query: "", offset, limit: 20 } }) as {
        tools: Array<{ name: string; inputSchema: unknown }>; nextOffset: number | null;
      };
      expect(page.tools.length).toBeLessThanOrEqual(20);
      for (const tool of page.tools) {
        seen.push(tool.name);
        expect(tool.inputSchema).toEqual(descriptor("any").parametersSchema);
        await executeForFixture(assigned, { tool: callName, arguments: { name: tool.name, arguments: { query: "fixture" } } });
      }
      offset = page.nextOffset;
    } while (offset !== null);
    expect(seen).toEqual(direct.map(tool => tool.name).sort());
    expect(f.executeTool).toHaveBeenCalledTimes(224);
    expect((f.gateway.assertNativeAssignedMcpDescriptorCurrent as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(224);
    expect((f.gateway.assertNativeAssignedMcpDescriptorCurrent as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({ ...fixtureOwner, gatewayId: "gateway-row-fixture", gatewayPublicId: f.gatewayPublicId, workMode: "standard" });
    expect(new Set(f.executeTool.mock.calls.map(([call]) => call.tool)).size).toBe(224);
    for (const [call] of f.executeTool.mock.calls) {
      expect(call).toMatchObject({ gatewayPublicId: f.gatewayPublicId, sessionToken: f.bearerToken, parameters: { query: "fixture" } });
      expect(call).not.toHaveProperty("approvedActionRequestId");
    }
  });

  it("searches only pinned tools still granted by fresh discovery without projecting metadata", async () => {
    const f = fixture([descriptor("calendar.search"), descriptor("mail.search"), descriptor("calendar.remove", "write")]);
    const assigned = await createForFixture(f);
    f.listToolsForNamedGateway.mockResolvedValue([
      { ...descriptor("calendar.search"), providerMetadata: { token: "secret-provider-token" } },
      descriptor("calendar.remove", "write"), descriptor("calendar.new_grant"),
    ]);
    const result = await executeForFixture(assigned, { tool: searchName, arguments: { query: "calendar" } }, "planning");
    expect(result).toEqual({ tools: [assigned.definitions()[0]], nextOffset: null });
    expect(JSON.stringify(result)).not.toMatch(/private-|secret-provider|gateway-fixture|new_grant/);
    f.listToolsForNamedGateway.mockRejectedValue(new Error("gateway_token_revoked"));
    await expect(executeForFixture(assigned, { tool: searchName, arguments: { query: "" } })).rejects.toThrow("gateway_token_revoked");
  });

  it.each(["planning", "ask"] as const)("preserves pinned and fresh %s restrictions through the call wrapper", async mode => {
    const f = fixture([descriptor("read"), descriptor("write", "write")]);
    const assigned = await createForFixture(f);
    const restricted = await createForFixture(f, mode);
    const call = { tool: callName, arguments: { name: assigned.definitions()[1]!.name, arguments: {} } };
    await expect(executeForFixture(assigned, call, mode)).rejects.toThrow("paperclip_runner_tool_mode_denied");
    await expect(executeForFixture(restricted, call, "standard")).rejects.toThrow("paperclip_runner_tool_mode_denied");
    expect(f.executeTool).not.toHaveBeenCalled();
    const discovery = await executeForFixture(restricted, { tool: searchName, arguments: { query: "" } }, "standard");
    expect(discovery).toEqual({ tools: [assigned.definitions()[0]], nextOffset: null });
  });

  it.each(["connection_revoked", "tool_error"])("preserves %s through the call wrapper", async reason => {
    const f = fixture([descriptor("write", "write")]);
    const assigned = await createForFixture(f);
    const error = new ToolGatewayHttpError(403, "Denied", reason);
    f.executeTool.mockRejectedValue(error);
    await expect(executeForFixture(assigned, { tool: callName, arguments: { name: assigned.definitions()[0]!.name, arguments: {} } })).rejects.toBe(error);
  });

  it("bounds search pages by bytes and rejects invalid wrapper arguments and unassigned targets", async () => {
    const f = fixture(Array.from({ length: 4 }, (_, i) => ({
      ...descriptor(`large_${i}`),
      parametersSchema: { type: "object", description: "x".repeat(250 * 1024) },
    })));
    const assigned = await createForFixture(f);
    const page = await executeForFixture(assigned, { tool: searchName, arguments: { query: "", limit: 20 } }) as { tools: unknown[]; nextOffset: number };
    expect(page.tools).toHaveLength(4);
    expect(page.nextOffset).toBeNull();
    expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThanOrEqual(8 * 1024);
    for (const args of [null, [], { query: "x".repeat(201) }, { query: "", offset: -1 }, { query: "", limit: 21 }, { query: "", offset: 0.5 }]) {
      await expect(executeForFixture(assigned, { tool: searchName, arguments: args })).rejects.toThrow("assigned_mcp_tool_invalid_arguments");
    }
    for (const name of ["unassigned", searchName, callName]) {
      await expect(executeForFixture(assigned, { tool: callName, arguments: { name, arguments: {} } })).rejects.toThrow("assigned_mcp_tool_unknown");
    }
    await expect(executeForFixture(assigned, { tool: callName, arguments: { name: "unassigned", arguments: [] } })).rejects.toThrow("assigned_mcp_tool_invalid_arguments");
    expect(f.executeTool).not.toHaveBeenCalled();
  });

  it("keeps individually oversized schemas and later tools discoverable with bounded schema chunks", async () => {
    const schema = { type: "object", description: "\u0000🙂".repeat(45_000), properties: {} };
    expect(Buffer.byteLength(JSON.stringify(schema), "utf8")).toBeLessThanOrEqual(512 * 1024);
    const f = fixture([{ ...descriptor("a_large"), parametersSchema: schema }, descriptor("z_small")]);
    const assigned = await createForFixture(f);
    const large = assigned.definitions()[0]!.name as string;
    const page = await executeForFixture(assigned, { tool: searchName, arguments: { query: "", limit: 1 } }) as {
      tools: Array<Record<string, unknown>>; nextOffset: number;
    };
    expect(page.tools).toEqual([{ name: large, description: "a_large: Use a_large", inputSchemaRef: large }]);
    expect(page.nextOffset).toBe(1);
    await expect(executeForFixture(assigned, { tool: searchName, arguments: { query: "", offset: page.nextOffset } }))
      .resolves.toEqual({ tools: [assigned.definitions()[1]], nextOffset: null });
    let schemaOffset: number | null = 0;
    let serialized = "";
    do {
      const chunk = await executeForFixture(assigned, { tool: searchName, arguments: { query: "", schemaTool: large, schemaOffset } }) as {
        schemaJson: string; nextSchemaOffset: number | null;
      };
      expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThanOrEqual(512 * 1024);
      serialized += chunk.schemaJson;
      schemaOffset = chunk.nextSchemaOffset;
    } while (schemaOffset !== null);
    expect(JSON.parse(serialized)).toEqual(schema);
    await executeForFixture(assigned, { tool: callName, arguments: { name: large, arguments: {} } });
    expect(f.executeTool).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tool: "a_large" }));
    f.listToolsForNamedGateway.mockResolvedValue([descriptor("z_small")]);
    await expect(executeForFixture(assigned, { tool: searchName, arguments: { query: "", schemaTool: large } })).rejects.toThrow("assigned_mcp_tool_unknown");
    await expect(executeForFixture(assigned, { tool: searchName, arguments: { query: "", schemaOffset: 1 } })).rejects.toThrow("assigned_mcp_tool_invalid_arguments");
  });

  it("requires a configured gateway registered for the exact database instance", () => {
    const firstDb = {} as Db;
    const secondDb = {} as Db;
    const first = fixture([]).gateway;
    const second = fixture([]).gateway;
    expect(() => getAssignedMcpGateway(firstDb)).toThrow("assigned_mcp_gateway_unavailable");
    registerAssignedMcpGateway(firstDb, first);
    expect(getAssignedMcpGateway(firstDb)).toBe(first);
    expect(() => getAssignedMcpGateway(secondDb)).toThrow("assigned_mcp_gateway_unavailable");
    registerAssignedMcpGateway(secondDb, second);
    expect(getAssignedMcpGateway(secondDb)).toBe(second);
    expect(getAssignedMcpGateway(firstDb)).toBe(first);
    registerAssignedMcpGateway(firstDb, second);
    expect(getAssignedMcpGateway(firstDb)).toBe(second);
  });

  it("projects only authorized gateway tools with stable bounded collision-resistant names", async () => {
    const names = ["memory.search", "memory-search", "x".repeat(120), "🧠"];
    const f = fixture(names.map(name => descriptor(name)));
    const first = await createForFixture(f);
    const reversed = await createForFixture({ ...f, gateway: fixture([...names].reverse().map(name => descriptor(name))).gateway });
    const projected = first.definitions().map(tool => tool.name as string);
    expect(new Set(projected).size).toBe(names.length);
    for (const name of projected) {
      expect(name).toMatch(/^app_[a-zA-Z0-9_]+_[a-f0-9]{12}$/);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(first.has(name)).toBe(true);
    }
    expect(reversed.definitions().map(tool => tool.name)).toEqual([...projected].reverse());
    expect(f.listToolsForNamedGateway).toHaveBeenCalledWith({ gatewayPublicId: f.gatewayPublicId, bearerToken: f.bearerToken });
  });

  it("keeps the provider and action readable for fully namespaced gateway tools", async () => {
    const prefix = "mcp.app-gallery-mem0-60062edb-c211-4aae-a787-b4fa12a5ea24-f4ece062";
    const tools = ["add-memory", "search-memories", "delete-memory"].map(action => ({
      ...descriptor(`${prefix}:${action}`), displayName: `Mem0 ${action}`,
    }));
    const assigned = await createForFixture(fixture(tools));
    for (const [index, definition] of assigned.definitions().entries()) {
      const name = definition.name as string;
      expect(name).toContain("mem0");
      expect(name).toContain(tools[index]!.name.split(":").at(-1)!.replaceAll("-", "_"));
      expect(name.length).toBeLessThanOrEqual(64);
      expect(definition.description).toBe(`${tools[index]!.displayName}: ${tools[index]!.description}`);
    }
    const long = await createForFixture(fixture([descriptor(`${prefix}:${"long-action-".repeat(10)}`)]));
    expect((long.definitions()[0]!.name as string).length).toBeLessThanOrEqual(64);
  });

  it("does not project gateway secrets, URLs, or provider metadata and returns only the tool result", async () => {
    const tool = { ...descriptor("recall"), providerMetadata: { token: "private-provider-token", url: "https://private-gateway.example" } };
    const f = fixture([tool]);
    f.executeTool.mockResolvedValue({ status: "completed", invocationId: "internal", result: { memories: [] } });
    const assigned = await createForFixture(f);
    const definitions = assigned.definitions();
    expect(Object.keys(definitions[0]!)).toEqual(["name", "description", "inputSchema"]);
    expect(JSON.stringify(definitions)).not.toMatch(/private-|gateway-fixture|https:/);
    const args = { query: "synthetic memory" };
    expect(await executeForFixture(assigned, { tool: definitions[0]!.name as string, arguments: args })).toEqual({ memories: [] });
    expect(f.executeTool).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ gatewayPublicId: f.gatewayPublicId, sessionToken: f.bearerToken, tool: "recall", parameters: args, idempotencyKey: expect.stringMatching(/^aw-native-tool:run-fixture:unit-call-/) }));
    (definitions[0]!.inputSchema as Record<string, unknown>).type = "string";
    expect(assigned.definitions()[0]!.inputSchema).toEqual(tool.parametersSchema);
  });

  it("rejects a stale current-owner oracle before executing a gateway effect", async () => {
    const f = fixture([descriptor("recall")]);
    (f.gateway.assertNativeAssignedMcpDescriptorCurrent as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const assigned = await createForFixture(f);
    const call = { tool: assigned.definitions()[0]!.name as string, arguments: { query: "fixture" } };
    await expect(executeForFixture(assigned, call)).rejects.toThrow("assigned_mcp_current_authority_changed");
    expect(f.gateway.assertNativeAssignedMcpDescriptorCurrent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      ...fixtureOwner, gatewayId: "gateway-row-fixture", gatewayPublicId: f.gatewayPublicId,
      arguments: { query: "fixture" }, workMode: "standard",
    }));
    expect(f.executeTool).not.toHaveBeenCalled();
  });

  it("rejects unknown names without invoking the gateway", async () => {
    const f = fixture([descriptor("recall")]);
    const assigned = await createForFixture(f);
    expect(assigned.has("unassigned")).toBe(false);
    await expect(executeForFixture(assigned, { tool: "unassigned", arguments: {} })).rejects.toThrow("assigned_mcp_tool_unknown");
    expect(f.executeTool).not.toHaveBeenCalled();
  });

  it.each(["planning", "ask"] as const)("exposes and permits only read tools in %s mode", async workMode => {
    const f = fixture([descriptor("read"), descriptor("remember", "write"), descriptor("forget", "destructive")]);
    const standard = await createForFixture(f);
    const restricted = await createForFixture(f, workMode);
    expect(restricted.definitions()).toEqual([standard.definitions()[0]]);
    for (const tool of standard.definitions().slice(1)) {
      await expect(executeForFixture(restricted, { tool: tool.name as string, arguments: {} })).rejects.toThrow("paperclip_runner_tool_mode_denied");
    }
    expect(f.executeTool).not.toHaveBeenCalled();
    await executeForFixture(restricted, { tool: restricted.definitions()[0]!.name as string, arguments: {} });
    expect(f.executeTool).toHaveBeenCalledOnce();
  });

  it("uses the gateway for write and destructive tools under standard mode without approval overrides", async () => {
    const f = fixture([descriptor("remember", "write"), descriptor("forget", "destructive")]);
    const assigned = await createForFixture(f);
    for (const tool of assigned.definitions()) await executeForFixture(assigned, { tool: tool.name as string, arguments: {} });
    expect(f.executeTool).toHaveBeenCalledTimes(2);
    for (const [call] of f.executeTool.mock.calls) expect(call).not.toHaveProperty("approvedActionRequestId");
  });

  it.each(["planning", "ask"] as const)("enforces fresh %s mode without relaxing the pinned mode", async currentMode => {
    const f = fixture([descriptor("read"), descriptor("remember", "write")]);
    const standard = await createForFixture(f);
    const restricted = await createForFixture(f, currentMode);
    const write = { tool: standard.definitions()[1]!.name as string, arguments: {} };
    await expect(executeForFixture(standard, write, currentMode)).rejects.toThrow("paperclip_runner_tool_mode_denied");
    await expect(executeForFixture(restricted, write, "standard")).rejects.toThrow("paperclip_runner_tool_mode_denied");
    expect(f.executeTool).not.toHaveBeenCalled();
    await executeForFixture(standard, { tool: standard.definitions()[0]!.name as string, arguments: {} }, currentMode);
    expect(f.executeTool).toHaveBeenCalledOnce();
  });

  it.each(["tool_error", "connection_revoked"])("propagates %s without converting it to success", async reason => {
    const f = fixture([descriptor("recall")]);
    const error = new ToolGatewayHttpError(403, "Gateway refused execution", reason);
    f.executeTool.mockRejectedValue(error);
    const assigned = await createForFixture(f);
    await expect(executeForFixture(assigned, { tool: assigned.definitions()[0]!.name as string, arguments: {} })).rejects.toBe(error);
  });

  it("binds approval-required pending receipts to the current invocation owner", async () => {
    const tool = descriptor("recall");
    const f = fixture([tool]);
    const argumentsHash = validateToolContent({ value: {}, direction: "arguments", sensitiveMode: "block", promptInjectionMode: "ignore" }).summary.sha256;
    const error = new ToolGatewayHttpError(403, "Human approval required", "approval_required", {
      actionRequestId: "action-fixture", argumentsHash, instructions: "Review this action", interactionId: "interaction-fixture",
      invocationId: "invocation-fixture", issueId: fixtureOwner.issueId, tool: tool.name,
    });
    f.setPendingMode(true);
    f.executeTool.mockRejectedValue(error);
    const assigned = await createForFixture(f);
    const witnesses: unknown[] = [];
    const call = { tool: assigned.definitions()[0]!.name as string, arguments: {} };
    await expect(executeForFixture(assigned, call, undefined, undefined, witness => { witnesses.push(witness); return Promise.resolve(); }))
      .rejects.toMatchObject({ reasonCode: "approval_required" });
    expect(witnesses).toHaveLength(1);
    expect(witnesses[0]).toMatchObject({ invocationId: "invocation-fixture", actionRequestId: "action-fixture", interactionId: "interaction-fixture",
      sourceRunId: fixtureOwner.runId, gatewayPublicId: f.gatewayPublicId, gatewayId: "gateway-row-fixture", workMode: "standard" });
  });

  it("propagates discovery denial", async () => {
    const f = fixture([]);
    const error = new Error("gateway_token_revoked");
    f.listToolsForNamedGateway.mockRejectedValue(error);
    await expect(createForFixture(f)).rejects.toBe(error);
  });

  it("rejects error payloads and incomplete outcomes, and accepts successful replay", async () => {
    const f = fixture([descriptor("recall")]);
    const assigned = await createForFixture(f);
    const call = { tool: assigned.definitions()[0]!.name as string, arguments: {} };
    f.executeTool.mockResolvedValueOnce({ status: "completed", result: { isError: true, content: [] } });
    await expect(executeForFixture(assigned, call)).rejects.toMatchObject({ reasonCode: "tool_error" });
    f.executeTool.mockResolvedValueOnce({ status: "pending", result: {} });
    await expect(executeForFixture(assigned, call)).rejects.toThrow("assigned_mcp_tool_execution_incomplete");
    f.executeTool.mockResolvedValueOnce({ status: "replayed", invocationId: "invocation-fixture", result: { memory: "synthetic" } });
    await expect(executeForFixture(assigned, call)).resolves.toEqual({ memory: "synthetic" });
  });
});
