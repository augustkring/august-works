import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { createToolConnectionSchema } from "@paperclipai/shared";
import { secretService } from "../../services/secrets.js";
import { toolAccessService } from "../../services/tool-access.js";
import { toolAccessPolicyService } from "../../services/tool-access-policy.js";
import { RAILWAY_API_URL, RAILWAY_MCP_URL, RAILWAY_QUERIES } from "../../services/railway.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("railway_fixture_object_required");
  return value as Record<string, unknown>;
}

type Capture = { purpose: "catalog" | "workspace_probe" | "projects_probe" | "projects_call" };

/** Only the HTTP boundary is controlled. Discovery, schema/version hashing,
 * vault bindings, grants, profiles and invocation authority use real owners.
 * This is software evidence for the fixed Railway GraphQL bridge, not MCP
 * model-effect qualification or a live Railway/provider connection. */
export async function prepareConnectionIntentRailwayFixture(input: {
  db: Db;
  companyId: string;
  userId: string;
  holderAgentId: string;
}) {
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const credentialValue = randomUUID();
  const captures: Capture[] = [];
  const endpointLookup: NonNullable<Parameters<typeof toolAccessService>[1]>["remoteHttpEndpointLookup"] = async hostname => {
    if (hostname !== new URL(RAILWAY_MCP_URL).hostname && hostname !== new URL(RAILWAY_API_URL).hostname)
      throw new Error("railway_fixture_hostname_not_fixed");
    return [{ address: "8.8.8.8", family: 4 }];
  };
  const request = async (url: string, init: RequestInit): Promise<Response> => {
    const mcpEndpoint = url === RAILWAY_MCP_URL || url === `${RAILWAY_MCP_URL}/`;
    if (!mcpEndpoint && url !== RAILWAY_API_URL)
      throw new Error("railway_fixture_destination_not_fixed");
    if (init.method !== "POST" || new Headers(init.headers).get("authorization") !== `Bearer ${credentialValue}`)
      throw new Error("railway_fixture_current_credential_required");
    if (typeof init.body !== "string") throw new Error("railway_fixture_json_required");
    const body = object(JSON.parse(init.body));
    if (mcpEndpoint) {
      if (body.method === "tools/list") {
        captures.push({ purpose: "catalog" });
        // Never advertise a reserved paperclip-railway-* descriptor. The real
        // refresh owner adds its own fixed contracts after the API probe.
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
      }
      const params = object(body.params);
      if (body.method !== "tools/call" || params.name !== "list-workspaces" ||
          Object.keys(object(params.arguments)).length !== 0)
        throw new Error("railway_fixture_mcp_operation_not_fixed");
      captures.push({ purpose: "workspace_probe" });
      return Response.json({ jsonrpc: "2.0", id: body.id, result: {
        content: [{ type: "text", text: JSON.stringify({ workspaces: [{ id: workspaceId, name: "Fixture workspace" }] }) }],
      } });
    }
    const variables = object(body.variables);
    if (body.query !== RAILWAY_QUERIES.projects || variables.workspaceId !== workspaceId ||
        (variables.first !== 1 && variables.first !== 25) ||
        Object.keys(variables).some(key => !["workspaceId", "first", "after"].includes(key)) ||
        (variables.after !== undefined && variables.after !== null))
      throw new Error("railway_fixture_graphql_contract_not_fixed");
    captures.push({ purpose: variables.first === 1 ? "projects_probe" : "projects_call" });
    return Response.json({ data: { projects: { edges: [{ node: {
      id: projectId, name: "Fixture project inventory", workspaceId,
    } }], pageInfo: { hasNextPage: false, endCursor: null } } } });
  };
  const actor = { actorType: "user" as const, actorId: input.userId, userId: input.userId };
  const secret = await secretService(input.db).create(input.companyId, {
    provider: "local_encrypted", name: `Railway fixture ${randomUUID()}`, value: credentialValue,
  }, { userId: input.userId });
  const access = toolAccessService(input.db, {
    remoteHttpEndpointLookup: endpointLookup,
    remoteHttpRequest: request,
  });
  const connection = await access.createConnection(input.companyId, createToolConnectionSchema.parse({
    name: "Railway fixture", applicationName: "Railway", transport: "mcp_remote",
    authKind: "oauth", credentialPolicy: "shared", enabled: true, status: "active",
    config: { url: RAILWAY_MCP_URL, sourceTemplateKey: "railway", connectionMethodKey: "mcp-oauth", safeDefault: true },
    credentialSecretRefs: [{ configPath: "oauth.access_token", secretId: secret.id,
      versionSelector: "latest", required: true }],
  }), actor);
  const refreshed = await access.refreshCatalog(connection.id, actor, { restoreDraftDefaults: true });
  const tool = refreshed.catalog.find(entry => entry.toolName === "paperclip-railway-list-projects");
  if (refreshed.connection.config.railwayApiStatus !== "available" || !tool || tool.status !== "active" ||
      typeof tool.schemaHash !== "string" || !/^[a-f0-9]{64}$/.test(tool.schemaHash) ||
      typeof tool.versionHash !== "string" || !/^[a-f0-9]{64}$/.test(tool.versionHash))
    throw new Error("railway_fixture_canonical_discovery_failed");
  await toolAccessPolicyService(input.db).createPolicy(input.companyId, {
    name: "Read fixture Railway projects", policyType: "allow", priority: 200, enabled: true,
    selectors: { connectionId: connection.id, toolName: tool.toolName },
  }, { userId: input.userId });
  await access.putConnectionInstalls(connection.id, {
    installs: [{ targetType: "agent", targetId: input.holderAgentId }],
  }, actor);
  return {
    connection: refreshed.connection, tool, workspaceId, projectId, request, endpointLookup,
    captures: () => captures.map(capture => ({ ...capture })),
  };
}
