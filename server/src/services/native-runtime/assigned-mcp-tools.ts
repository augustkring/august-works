import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { toolCatalogEntries, toolInvocations, toolMcpGateways, type Db } from "@paperclipai/db";
import { nativeAssignedMcpDescriptorProjection, ToolGatewayHttpError, type ToolGatewayDescriptor, type ToolGatewayService } from "../tool-gateway.js";
import { nativeSha256 } from "./canonical.js";
import { validateToolContent } from "../tool-content-guards.js";

type WorkMode = "standard" | "planning" | "ask";
type ToolDefinition = Record<string, unknown>;

export type AssignedMcpInvocationWitness = {
  providerToolName: string; mappedToolAlias: string; gatewayToolName: string; gatewayId: string; gatewayPublicId: string;
  gatewayProfileId: string; descriptorHash: string; invocationId: string; idempotencyKey: string;
  credentialSnapshotHash: string;
  argumentsHash: string; resultHash: string; connectionId: string | null; catalogEntryId: string | null;
  catalogSchemaHash: string | null; parametersSchemaHash: string; providerType: string; risk: string;
  upstreamToolName: string | null; providerDefinitionHash: string;
  selectorName: string | null; providerArgumentsHash: string; argumentsProjection: Record<string, unknown>; workMode: WorkMode;
};

export type AssignedMcpPendingWitness = {
  providerToolName: string; mappedToolAlias: string; gatewayToolName: string; gatewayId: string; gatewayPublicId: string; gatewayProfileId: string;
  descriptorHash: string; credentialSnapshotHash: string; invocationId: string; actionRequestId: string; interactionId: string; sourceRunId: string;
  idempotencyKey: string; argumentsHash: string; connectionId: string | null; catalogEntryId: string | null;
  catalogSchemaHash: string | null; parametersSchemaHash: string; providerType: string; risk: string;
  upstreamToolName: string | null; providerDefinitionHash: string;
  selectorName: string | null; providerArgumentsHash: string; argumentsProjection: Record<string, unknown>;
  errorMessage: string; errorDigest: string; workMode: WorkMode;
};
export type AssignedMcpSearchWitness = {
  providerToolName: string; mappedToolAlias: string; gatewayId: string; gatewayPublicId: string; gatewayProfileId: string; workMode: WorkMode;
  sourceRunId: string; argumentsHash: string; resultHash: string; providerDefinitionHash: string;
  argumentsProjection: Record<string, unknown>; descriptorProjections: Array<{ name: string; descriptorHash: string;
    parametersSchemaHash: string; providerType: string; risk: string; connectionId: string | null;
    catalogEntryId: string | null; catalogSchemaHash: string | null; upstreamToolName: string | null;
    credentialSnapshotHash: string }>;
};

const SEARCH_TOOL = "paperclip_search_assigned_tools";
const CALL_TOOL = "paperclip_call_assigned_tool";
// Keep search pages compact so larger valid schemas travel through the
// reauthorized 64 KiB schema-chunk route instead of consuming a full turn.
const SEARCH_PAGE_BYTES = 8 * 1024;
const SCHEMA_CHUNK_CHARACTERS = 8 * 1024;
const ON_DEMAND_TOOLS: ToolDefinition[] = [
  {
    name: SEARCH_TOOL,
    description: "Search your assigned app tools by name or description and read their input schemas. Use an empty query to browse. Pass nextOffset to fetch the next page. A large definition returns inputSchemaRef: set schemaTool to that name with an empty query, then pass nextSchemaOffset until null. Concatenate schemaJson chunks and parse JSON. Use paperclip_call_assigned_tool with a returned name and arguments matching its inputSchema.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        query: { type: "string", maxLength: 200 },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 20 },
        schemaTool: { type: "string", description: "Exact inputSchemaRef from a search result." },
        schemaOffset: { type: "integer", minimum: 0 },
      },
      required: ["query"],
    },
  },
  {
    name: CALL_TOOL,
    description: "Call an assigned app tool discovered with paperclip_search_assigned_tools. Use its exact returned name and arguments matching its inputSchema. The same permissions, approvals, and audit rules apply as for direct app tools.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { name: { type: "string" }, arguments: { type: "object", additionalProperties: true } },
      required: ["name", "arguments"],
    },
  },
];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("assigned_mcp_tool_invalid_arguments");
  }
  return value as Record<string, unknown>;
}

function definition(name: string, tool: ToolGatewayDescriptor): ToolDefinition {
  return { name, description: `${tool.displayName}: ${tool.description}`, inputSchema: structuredClone(tool.parametersSchema) };
}

function exposedProviderToolName(name: string): string {
  for (const prefix of ["paperclip__", "paperclip_", "paperclip."]) if (name.startsWith(prefix)) return name.slice(prefix.length);
  return name;
}
function onDemandProviderDefinition(name: string): ToolDefinition | undefined {
  const value = ON_DEMAND_TOOLS.find(tool => tool.name === name);
  return value ? { ...structuredClone(value), name: exposedProviderToolName(name) } : undefined;
}

export function assignedMcpSearchToolDefinition(): ToolDefinition {
  const definition = onDemandProviderDefinition(SEARCH_TOOL);
  if (!definition) throw new Error("assigned_mcp_search_definition_missing");
  return definition;
}
export function assignedMcpCallToolDefinition(): ToolDefinition {
  const definition = onDemandProviderDefinition(CALL_TOOL);
  if (!definition) throw new Error("assigned_mcp_call_definition_missing");
  return definition;
}

/** Pure replay of the bounded on-demand search projection. Source validation
 * uses the same function over freshly reauthorized descriptors. */
export function buildAssignedMcpSearchResult(
  argumentsValue: unknown,
  entries: Array<{ alias: string; descriptor: ToolGatewayDescriptor }>,
  mode: WorkMode,
): unknown {
  const args = object(argumentsValue);
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 5;
  const schemaOffset = args.schemaOffset ?? 0;
  if (typeof args.query !== "string" || args.query.length > 200 ||
    typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 ||
    typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 20 ||
    (args.schemaTool !== undefined && typeof args.schemaTool !== "string") ||
    typeof schemaOffset !== "number" || !Number.isSafeInteger(schemaOffset) || schemaOffset < 0 ||
    (args.schemaOffset !== undefined && args.schemaTool === undefined))
    throw new Error("assigned_mcp_tool_invalid_arguments");
  const eligible = entries.filter(({ descriptor }) => mode === "standard" || descriptor.risk === "read");
  if (typeof args.schemaTool === "string") {
    const selected = eligible.find(({ alias }) => alias === args.schemaTool);
    if (!selected) throw new Error("assigned_mcp_tool_unknown");
    const schema = JSON.stringify(selected.descriptor.parametersSchema);
    const end = schemaOffset + SCHEMA_CHUNK_CHARACTERS;
    return { name: selected.alias, schemaJson: schema.slice(schemaOffset, end),
      nextSchemaOffset: end < schema.length ? end : null };
  }
  const terms = args.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = eligible.filter(({ alias, descriptor }) =>
    terms.every(term => `${alias} ${descriptor.displayName} ${descriptor.description}`.toLowerCase().includes(term)))
    .sort((a, b) => a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0);
  const page: ToolDefinition[] = [];
  for (const { alias, descriptor } of matches.slice(offset, offset + limit)) {
    let next = definition(alias, descriptor);
    if (Buffer.byteLength(JSON.stringify([next]), "utf8") > SEARCH_PAGE_BYTES)
      next = { name: alias, description: String(next.description).slice(0, 2000), inputSchemaRef: alias };
    if (Buffer.byteLength(JSON.stringify([...page, next]), "utf8") > SEARCH_PAGE_BYTES) break;
    page.push(next);
  }
  return { tools: page, nextOffset: offset + page.length < matches.length ? offset + page.length : null };
}


// Execution must use the app's configured gateway, including deployment
// restrictions, OAuth refresh, and approval delivery. Never fall back to an
// isolated gateway whose defaults differ from the running instance.
type AssignedMcpGatewayRegistration = {
  gateway: ToolGatewayService;
  forDatabase?: (db: Db) => ToolGatewayService;
};
const assignedMcpGateways = new WeakMap<Db, AssignedMcpGatewayRegistration>();

export function registerAssignedMcpGateway(
  db: Db,
  gateway: ToolGatewayService,
  forDatabase?: (db: Db) => ToolGatewayService,
): void {
  assignedMcpGateways.set(db, { gateway, forDatabase });
}

/** Resolve the app-configured Gateway owner for root DB operations, or a
 * transaction-bound instance from that same registration for atomic metadata
 * checks. Callers must pass both handles explicitly inside a transaction. */
export function getAssignedMcpGateway(rootDb: Db, scopedDb: Db = rootDb): ToolGatewayService {
  const registration = assignedMcpGateways.get(rootDb);
  if (!registration) throw new Error("assigned_mcp_gateway_unavailable");
  if (scopedDb === rootDb) return registration.gateway;
  if (!registration.forDatabase) throw new Error("assigned_mcp_gateway_transaction_unavailable");
  return registration.forDatabase(scopedDb);
}

function assignedToolName(name: string): string {
  const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  const separator = name.lastIndexOf(":");
  const readable = separator >= 0
    ? `${sanitize(name.slice(0, separator)).slice(0, 20) || "tool"}_${sanitize(name.slice(separator + 1)).slice(-26) || "action"}`
    : sanitize(name).slice(0, 47) || "tool";
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 12);
  return `app_${readable}_${digest}`;
}

export function assignedMcpToolAlias(name: string): string { return assignedToolName(name); }

/** Server-owned MCP bindings projected into the runner's existing tool channel. */
export async function createAssignedMcpTools(input: {
  db: Db;
  companyId: string;
  issueId: string;
  runId: string;
  agentId: string;
  responsibleUserId: string;
  gateway: ToolGatewayService;
  gatewayPublicId: string;
  bearerToken: string;
  workMode?: WorkMode;
}) {
  const listed = await input.gateway.listToolsForNamedGateway({
    gatewayPublicId: input.gatewayPublicId,
    bearerToken: input.bearerToken,
  });
  const gatewayRows = await input.db.select({ id: toolMcpGateways.id, profileId: toolMcpGateways.profileId })
    .from(toolMcpGateways).where(and(eq(toolMcpGateways.companyId, input.companyId),
      eq(toolMcpGateways.gatewayPublicId, input.gatewayPublicId), eq(toolMcpGateways.status, "active"),
      isNull(toolMcpGateways.archivedAt))).limit(2);
  if (gatewayRows.length !== 1) throw new Error("assigned_mcp_gateway_binding_invalid");
  const { id: assignedGatewayId, profileId: assignedGatewayProfileId } = gatewayRows[0]!;
  const tools = new Map<string, ToolGatewayDescriptor>();
  for (const descriptor of listed) {
    const name = assignedToolName(descriptor.name);
    if (tools.has(name)) throw new Error("assigned_mcp_tool_name_collision");
    tools.set(name, descriptor);
  }
  const permits = (tool: ToolGatewayDescriptor, mode: WorkMode = input.workMode ?? "standard") => mode === "standard" || tool.risk === "read";
  const descriptorProjection = nativeAssignedMcpDescriptorProjection;
  const descriptorHash = (tool: ToolGatewayDescriptor) => nativeSha256(descriptorProjection(tool));

  async function search(argumentsValue: unknown, currentWorkMode?: WorkMode) {
    const args = object(argumentsValue);
    // Intersect fresh grants with this session's pinned catalog. Revocations
    // take effect immediately; newly assigned tools require a new session.
    const current = new Map((await input.gateway.listToolsForNamedGateway({
      gatewayPublicId: input.gatewayPublicId, bearerToken: input.bearerToken,
    })).map(tool => [tool.name, tool]));
    const authorized = [...tools].filter(([, tool]) => {
      const fresh = current.get(tool.name);
      return fresh && descriptorHash(fresh) === descriptorHash(tool) && permits(tool) && permits(tool, currentWorkMode) &&
        permits(fresh) && permits(fresh, currentWorkMode);
    });
    return buildAssignedMcpSearchResult(argumentsValue, authorized.map(([alias, descriptor]) => ({ alias, descriptor })),
      currentWorkMode ?? input.workMode ?? "standard");
  }

  return {
    directDefinitions(fits?: (definitions: ToolDefinition[]) => boolean): ToolDefinition[] {
      const direct = [...tools].filter(([, tool]) => permits(tool)).map(([name, tool]) => definition(name, tool));
      return !fits || fits(direct) ? direct : [];
    },
    definitions(fits?: (definitions: ToolDefinition[]) => boolean): ToolDefinition[] {
      const direct = [...tools].filter(([, tool]) => permits(tool)).map(([name, tool]) => definition(name, tool));
      if (!fits || fits(direct)) return direct;
      const compact = structuredClone(ON_DEMAND_TOOLS);
      if (!fits(compact)) throw new Error("assigned_mcp_tool_catalog_capacity_exceeded");
      return compact;
    },
    has(name: string): boolean {
      const exposed = exposedProviderToolName(name);
      return tools.has(name) || tools.has(exposed) || exposed === exposedProviderToolName(SEARCH_TOOL) ||
        exposed === exposedProviderToolName(CALL_TOOL);
    },
    isSearch(name: string): boolean {
      return exposedProviderToolName(name) === exposedProviderToolName(SEARCH_TOOL);
    },
    async execute(call: { tool: string; callId: string; arguments: unknown }, currentWorkMode?: WorkMode,
      onInvocation?: (witness: AssignedMcpInvocationWitness) => Promise<void>,
      onPending?: (witness: AssignedMcpPendingWitness) => Promise<void>,
      onSearch?: (witness: AssignedMcpSearchWitness) => Promise<void>): Promise<unknown> {
      const isSearch = exposedProviderToolName(call.tool) === exposedProviderToolName(SEARCH_TOOL);
      const isCall = exposedProviderToolName(call.tool) === exposedProviderToolName(CALL_TOOL);
      if (isSearch) {
        const result = await search(call.arguments, currentWorkMode);
        const resultRecord = object(result);
        const returnedNames = Array.isArray(resultRecord.tools)
          ? resultRecord.tools.map(value => object(value).name).filter((value): value is string => typeof value === "string")
          : typeof resultRecord.name === "string" ? [resultRecord.name] : [];
        const descriptorProjections = await Promise.all([...new Set(returnedNames)].map(async alias => {
          const returned = tools.get(alias);
          if (!returned) throw new Error("assigned_mcp_search_result_owner_invalid");
          const projection = descriptorProjection(returned);
          if (!returned.catalogEntryId) throw new Error("assigned_mcp_search_result_owner_invalid");
          const [catalog] = await input.db.select({ schemaHash: toolCatalogEntries.schemaHash }).from(toolCatalogEntries)
            .where(and(eq(toolCatalogEntries.companyId, input.companyId), eq(toolCatalogEntries.id, returned.catalogEntryId),
              eq(toolCatalogEntries.status, "active"), isNull(toolCatalogEntries.quarantinedAt))).limit(1);
          if (!catalog) throw new Error("assigned_mcp_search_result_owner_invalid");
          const credentialSnapshot = await input.gateway.getNativeAssignedMcpCredentialSnapshot({
            gatewayPublicId: input.gatewayPublicId, bearerToken: input.bearerToken, toolName: returned.name,
          });
          if (!credentialSnapshot) throw new Error("assigned_mcp_search_result_owner_invalid");
          return { name: returned.name, descriptorHash: nativeSha256(projection),
            parametersSchemaHash: nativeSha256(returned.parametersSchema), providerType: returned.providerType,
            risk: returned.risk, connectionId: returned.connectionId ?? null, catalogEntryId: returned.catalogEntryId,
            catalogSchemaHash: catalog.schemaHash ?? null, upstreamToolName: returned.upstreamToolName ?? null,
            credentialSnapshotHash: nativeSha256(credentialSnapshot) };
        }));
        if (descriptorProjections.length > 20 || Buffer.byteLength(JSON.stringify(descriptorProjections)) > 32 * 1024)
          throw new Error("assigned_mcp_search_result_too_large");
        const searchArgs = validateToolContent({ value: call.arguments, direction: "arguments", sensitiveMode: "block",
          promptInjectionMode: "ignore" });
        if (searchArgs.summary.sizeBytes > 4 * 1024 || searchArgs.summary.redactedFields.length)
          throw new Error("assigned_mcp_search_arguments_not_retention_safe");
        await onSearch?.({ providerToolName: call.tool, mappedToolAlias: exposedProviderToolName(call.tool), gatewayId: assignedGatewayId,
          gatewayPublicId: input.gatewayPublicId, gatewayProfileId: assignedGatewayProfileId,
          workMode: currentWorkMode ?? input.workMode ?? "standard", sourceRunId: input.runId,
          argumentsHash: nativeSha256(searchArgs.value), argumentsProjection: object(searchArgs.value), resultHash: nativeSha256(result),
          providerDefinitionHash: nativeSha256(onDemandProviderDefinition(SEARCH_TOOL)), descriptorProjections });
        return result;
      }
      let name = call.tool;
      let parameters = call.arguments;
      if (isCall) {
        const args = object(parameters);
        if (typeof args.name !== "string") throw new Error("assigned_mcp_tool_invalid_arguments");
        name = args.name;
        parameters = object(args.arguments);
      }
      const descriptor = tools.get(name);
      if (!descriptor) throw new Error("assigned_mcp_tool_unknown");
      if (!permits(descriptor) || !permits(descriptor, currentWorkMode)) throw new Error("paperclip_runner_tool_mode_denied");
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(call.callId))
        throw new Error("assigned_mcp_tool_call_binding_invalid");
      const providerDefinition = isCall ? onDemandProviderDefinition(CALL_TOOL) : definition(call.tool, descriptor);
      // The immutable capture carries bounded descriptor/schema hashes and
      // refs, never a duplicate full schema. Large valid schemas stay usable
      // through on-demand chunking and the argument/call owner remains bounded.
      if (Buffer.byteLength(JSON.stringify(descriptor.parametersSchema)) > 512 * 1024)
        throw new Error("assigned_mcp_tool_definition_too_large");
      const current = (await input.gateway.listToolsForNamedGateway({ gatewayPublicId: input.gatewayPublicId,
        bearerToken: input.bearerToken })).find(tool => tool.name === descriptor.name);
      if (!current || descriptorHash(current) !== descriptorHash(descriptor) || !permits(current, currentWorkMode))
        throw new Error("assigned_mcp_tool_descriptor_changed");
      const argumentValidation = validateToolContent({ value: parameters, direction: "arguments", sensitiveMode: "block",
        promptInjectionMode: "ignore" });
      const providerArgumentValidation = validateToolContent({ value: call.arguments, direction: "arguments", sensitiveMode: "block",
        promptInjectionMode: "ignore" });
      if (argumentValidation.summary.redactedFields.length || argumentValidation.summary.sizeBytes > 64 * 1024 ||
        providerArgumentValidation.summary.redactedFields.length || providerArgumentValidation.summary.sizeBytes > 64 * 1024)
        throw new Error("assigned_mcp_arguments_not_retention_safe");
      const argumentsHash = argumentValidation.summary.sha256;
      const argumentsProjection = object(argumentValidation.value);
      const providerArgumentsHash = nativeSha256(providerArgumentValidation.value);
      const [currentCatalog] = await input.db.select({ schemaHash: toolCatalogEntries.schemaHash }).from(toolCatalogEntries)
        .where(and(eq(toolCatalogEntries.companyId, input.companyId), eq(toolCatalogEntries.id, descriptor.catalogEntryId ?? ""),
          eq(toolCatalogEntries.status, "active"), isNull(toolCatalogEntries.quarantinedAt))).limit(1);
      if (!currentCatalog || !await input.gateway.assertNativeAssignedMcpDescriptorCurrent({ companyId: input.companyId,
        issueId: input.issueId, runId: input.runId, agentId: input.agentId, responsibleUserId: input.responsibleUserId,
        gatewayId: assignedGatewayId, gatewayPublicId: input.gatewayPublicId, gatewayProfileId: assignedGatewayProfileId,
        descriptorProjection: descriptorProjection(descriptor), catalogSchemaHash: currentCatalog.schemaHash ?? null,
        workMode: currentWorkMode ?? input.workMode ?? "standard",
        arguments: argumentsProjection }))
        throw new Error("assigned_mcp_current_authority_changed");
      const idempotencyKey = `aw-native-tool:${input.runId}:${call.callId}`;
      // Reauthorize through the existing gateway on every call. Discovery is
      // not a grant: revocation, policy, approval, and audit remain server-owned.
      let result: Awaited<ReturnType<ToolGatewayService["executeTool"]>>;
      try {
        result = await input.gateway.executeTool({
          gatewayPublicId: input.gatewayPublicId,
          sessionToken: input.bearerToken,
          tool: descriptor.name,
          parameters,
          idempotencyKey,
        });
      } catch (error) {
        if (!(error instanceof ToolGatewayHttpError) || error.reasonCode !== "approval_required") throw error;
        const details = error.details;
        const keys = Object.keys(details).sort().join(",");
        const interactionId = typeof details.interactionId === "string" ? details.interactionId : null;
        const actionRequestId = typeof details.actionRequestId === "string" ? details.actionRequestId : null;
        const invocationId = typeof details.invocationId === "string" ? details.invocationId : null;
        const instructions = typeof details.instructions === "string" ? details.instructions : null;
        if (keys !== "actionRequestId,argumentsHash,instructions,interactionId,invocationId,issueId,tool" ||
          details.issueId !== input.issueId || details.tool !== descriptor.name || details.argumentsHash !== argumentsHash ||
          !interactionId || !actionRequestId || !invocationId || !instructions || !onPending)
          throw new Error("assigned_mcp_tool_pending_owner_invalid");
        const [pending] = await input.db.select({ id: toolInvocations.id, companyId: toolInvocations.companyId,
          agentId: toolInvocations.agentId, issueId: toolInvocations.issueId, runId: toolInvocations.runId,
          gatewayId: toolInvocations.gatewayId, gatewayPublicId: toolInvocations.gatewayPublicId,
          connectionId: toolInvocations.connectionId, catalogEntryId: toolInvocations.catalogEntryId,
          catalogSchemaHash: toolInvocations.catalogSchemaHash, toolName: toolInvocations.toolName,
          argumentsSummary: toolInvocations.argumentsSummary,
          status: toolInvocations.status, approvalState: toolInvocations.approvalState,
          idempotencyKey: toolInvocations.idempotencyKey, argumentsHash: toolInvocations.argumentsHash,
          resultHash: toolInvocations.resultHash,
        }).from(toolInvocations).where(and(eq(toolInvocations.companyId, input.companyId),
          eq(toolInvocations.id, invocationId), eq(toolInvocations.agentId, input.agentId),
          eq(toolInvocations.issueId, input.issueId), eq(toolInvocations.runId, input.runId),
          eq(toolInvocations.toolName, descriptor.name), eq(toolInvocations.status, "awaiting_approval"),
          eq(toolInvocations.approvalState, "pending"), eq(toolInvocations.idempotencyKey, idempotencyKey),
          eq(toolInvocations.argumentsHash, argumentsHash)));
        if (!pending || !pending.gatewayId || pending.gatewayPublicId !== input.gatewayPublicId ||
          pending.connectionId !== (descriptor.connectionId ?? null) || pending.catalogEntryId !== (descriptor.catalogEntryId ?? null) ||
          pending.resultHash !== null) throw new Error("assigned_mcp_tool_pending_owner_invalid");
        const pendingCredentialSnapshot = await input.gateway.getNativeAssignedMcpCredentialSnapshot({
          gatewayPublicId: input.gatewayPublicId, bearerToken: input.bearerToken, toolName: descriptor.name,
        });
        if (!pendingCredentialSnapshot) throw new Error("assigned_mcp_tool_pending_owner_invalid");
        const errorDigest = nativeSha256({ type: "tool_result", tool_use_id: call.callId,
          is_error: true, content: instructions });
        await onPending({ providerToolName: call.tool, mappedToolAlias: name, gatewayToolName: descriptor.name,
          gatewayId: assignedGatewayId, gatewayPublicId: input.gatewayPublicId, gatewayProfileId: assignedGatewayProfileId,
          descriptorHash: descriptorHash(descriptor), credentialSnapshotHash: nativeSha256(pendingCredentialSnapshot),
          invocationId, actionRequestId, interactionId, sourceRunId: input.runId, idempotencyKey,
          argumentsHash, workMode: currentWorkMode ?? input.workMode ?? "standard",
          connectionId: pending.connectionId ?? null, catalogEntryId: pending.catalogEntryId ?? null,
          catalogSchemaHash: pending.catalogSchemaHash ?? null, parametersSchemaHash: nativeSha256(descriptor.parametersSchema),
          providerType: descriptor.providerType, risk: descriptor.risk, upstreamToolName: descriptor.upstreamToolName ?? null,
          providerDefinitionHash: nativeSha256(isCall ? onDemandProviderDefinition(CALL_TOOL) : definition(call.tool, descriptor)),
          selectorName: isCall ? name : null, providerArgumentsHash, argumentsProjection,
          errorMessage: instructions, errorDigest });
        throw new ToolGatewayHttpError(error.status, instructions, error.reasonCode, details);
      }
      if (result.status !== "completed" && result.status !== "replayed") {
        throw new Error("assigned_mcp_tool_execution_incomplete");
      }
      // The gateway normally throws provider errors. Keep a malformed or older
      // provider response from being reported as successful through PRP.
      if (result.result && typeof result.result === "object" && "isError" in result.result && result.result.isError === true) {
        throw new ToolGatewayHttpError(502, "The assigned tool returned an error.", "tool_error");
      }
      const resultHash = validateToolContent({ value: result.result, direction: "result", sensitiveMode: "redact",
        promptInjectionMode: "block" }).summary.sha256;
      if (!resultHash || !argumentsHash || typeof result.invocationId !== "string")
        throw new Error("assigned_mcp_tool_invocation_unavailable");
      const [invocation] = await input.db.select({ id: toolInvocations.id, companyId: toolInvocations.companyId,
        agentId: toolInvocations.agentId, issueId: toolInvocations.issueId, runId: toolInvocations.runId,
        gatewayId: toolInvocations.gatewayId, gatewayPublicId: toolInvocations.gatewayPublicId,
        connectionId: toolInvocations.connectionId, catalogEntryId: toolInvocations.catalogEntryId,
        catalogSchemaHash: toolInvocations.catalogSchemaHash,
        toolName: toolInvocations.toolName, status: toolInvocations.status, idempotencyKey: toolInvocations.idempotencyKey,
        argumentsHash: toolInvocations.argumentsHash, resultHash: toolInvocations.resultHash,
        argumentsSummary: toolInvocations.argumentsSummary,
        workflowResultJson: toolInvocations.workflowResultJson,
        credentialScopeSummary: toolInvocations.credentialScopeSummary,
      }).from(toolInvocations).where(and(eq(toolInvocations.companyId, input.companyId),
        eq(toolInvocations.id, result.invocationId), eq(toolInvocations.agentId, input.agentId),
        eq(toolInvocations.issueId, input.issueId), eq(toolInvocations.runId, input.runId),
        eq(toolInvocations.toolName, descriptor.name), eq(toolInvocations.status, "succeeded"),
        eq(toolInvocations.idempotencyKey, idempotencyKey)));
      if (!invocation || invocation.argumentsHash !== argumentsHash || invocation.resultHash !== resultHash ||
        !invocation.gatewayId || invocation.gatewayPublicId !== input.gatewayPublicId ||
        invocation.connectionId !== (descriptor.connectionId ?? null) || invocation.catalogEntryId !== (descriptor.catalogEntryId ?? null) ||
        !invocation.credentialScopeSummary ||
        validateToolContent({ value: invocation.workflowResultJson, direction: "result", sensitiveMode: "redact",
          promptInjectionMode: "block" }).summary.sha256 !== resultHash)
        throw new Error("assigned_mcp_tool_invocation_binding_invalid");
      await onInvocation?.({ providerToolName: call.tool, mappedToolAlias: name,
        gatewayToolName: descriptor.name, gatewayId: invocation.gatewayId, gatewayPublicId: input.gatewayPublicId,
        gatewayProfileId: assignedGatewayProfileId,
        descriptorHash: descriptorHash(descriptor), credentialSnapshotHash: nativeSha256(invocation.credentialScopeSummary),
        invocationId: invocation.id, idempotencyKey,
        argumentsHash, resultHash, connectionId: invocation.connectionId ?? null,
        catalogEntryId: invocation.catalogEntryId ?? null, catalogSchemaHash: invocation.catalogSchemaHash ?? null,
        parametersSchemaHash: nativeSha256(descriptor.parametersSchema), providerType: descriptor.providerType,
        risk: descriptor.risk, upstreamToolName: descriptor.upstreamToolName ?? null,
        providerDefinitionHash: nativeSha256(isCall
          ? onDemandProviderDefinition(CALL_TOOL)
          : definition(call.tool, descriptor)), selectorName: isCall ? name : null,
        providerArgumentsHash, argumentsProjection, workMode: currentWorkMode ?? input.workMode ?? "standard" });
      return result.result;
    },
  };
}
