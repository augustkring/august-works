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

type Capture = { purpose: "catalog" | "workspace_probe" | "projects_probe" | "projects_call" | "target_validation" | "deployment_validation" | "restart" | "large_tool_call" };

/** Only the HTTP boundary is controlled. Discovery, schema/version hashing,
 * vault bindings, grants, profiles and invocation authority use real owners.
 * This is software evidence for the fixed Railway GraphQL bridge, not MCP
 * model-effect qualification or a live Railway/provider connection. */
export async function prepareConnectionIntentRailwayFixture(input: {
  db: Db;
  companyId: string;
  userId: string;
  holderAgentId: string;
  reviewJourney?: "approve" | "decline" | "always" | "failure";
}) {
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const environmentId = randomUUID();
  const serviceId = randomUUID();
  const deploymentId = randomUUID();
  const deploymentInstanceId = randomUUID();
  const credentialValue = randomUUID();
  let largeSchemaEnabled = false;
  const largeToolProperties = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`field_${String(index).padStart(4, "0")}`, {
    type: "string", description: `Fixed fixture schema field ${index}: a bounded value used to prove large assigned schemas are fetched in authenticated chunks.`,
  }]));
  const largeToolSchema = { type: "object", additionalProperties: false, properties: largeToolProperties,
    required: ["field_0000"] };
  // Three valid but unused assigned schemas push the total direct-definition
  // catalog past its signed Runnerd envelope while each descriptor remains
  // below the normal per-schema limit. This makes the fixture exercise the
  // real compact search/chunk fallback without relaxing any production cap.
  const ballastTools = Array.from({ length: 3 }, (_, toolIndex) => ({
    name: `fixture-ballast-${toolIndex + 1}`,
    description: `Fixed bounded catalog ballast ${toolIndex + 1}.`,
    inputSchema: { type: "object", additionalProperties: false, properties: Object.fromEntries(
      Array.from({ length: 20 }, (_, fieldIndex) => [`field_${String(fieldIndex).padStart(2, "0")}`, {
        type: "string", description: `Bounded catalog-only field ${toolIndex + 1}-${fieldIndex}: ${"x".repeat(13_500)}`,
      }])) },
    annotations: { readOnlyHint: true },
  }));
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
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: largeSchemaEnabled ? [
          { name: "fixture-large", description: "Read the fixed large-schema fixture result.", inputSchema: largeToolSchema,
            annotations: { readOnlyHint: true } },
          ...ballastTools,
        ] : [] } });
      }
      const params = object(body.params);
      if (body.method === "tools/call" && params.name === "fixture-large") {
        const args = object(params.arguments);
        if (Object.keys(args).length !== 1 || args.field_0000 !== "schema-chunk-proof")
          throw new Error("railway_fixture_large_tool_arguments_not_fixed");
        captures.push({ purpose: "large_tool_call" });
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text",
          text: JSON.stringify({ ok: true, marker: "large-schema-result", value: args.field_0000 }) }] } });
      }
      if (body.method !== "tools/call" || params.name !== "list-workspaces" ||
          Object.keys(object(params.arguments)).length !== 0)
        throw new Error("railway_fixture_mcp_operation_not_fixed");
      captures.push({ purpose: "workspace_probe" });
      return Response.json({ jsonrpc: "2.0", id: body.id, result: {
        content: [{ type: "text", text: JSON.stringify({ workspaces: [{ id: workspaceId, name: "Fixture workspace" }] }) }],
      } });
    }
    const variables = object(body.variables);
    if (body.query === RAILWAY_QUERIES.projects && variables.workspaceId === workspaceId &&
        (variables.first === 1 || variables.first === 25 || (input.reviewJourney === "always" && variables.first === 2)) &&
        Object.keys(variables).every(key => ["workspaceId", "first", "after"].includes(key)) &&
        (variables.after === undefined || variables.after === null)) {
      captures.push({ purpose: variables.first === 1 ? "projects_probe" : "projects_call" });
      if (input.reviewJourney === "failure" && variables.first !== 1)
        return Response.json({ errors: [{ message: "Fixture provider unavailable" }] }, { status: 502 });
      return Response.json({ data: { projects: { edges: [{ node: {
        id: projectId, name: input.reviewJourney ? "Roadmap" : "Fixture project inventory", workspaceId,
      } }], pageInfo: { hasNextPage: false, endCursor: null } } } });
    }
    if (body.query === RAILWAY_QUERIES.target && variables.projectId === projectId &&
        variables.environmentId === environmentId && variables.serviceId === serviceId &&
        Object.keys(variables).length === 3) {
      captures.push({ purpose: "target_validation" });
      return Response.json({ data: {
        project: { id: projectId },
        environment: { id: environmentId, projectId },
        service: { id: serviceId, projectId },
        serviceInstance: { id: randomUUID(), environmentId, serviceId, serviceName: "Fixture service",
          source: { repo: null }, latestDeployment: { id: deploymentId, status: "SUCCESS" },
          activeDeployments: [{ id: deploymentId, status: "SUCCESS" }] },
      } });
    }
    if (body.query === RAILWAY_QUERIES.deployment && variables.deploymentId === deploymentId &&
        Object.keys(variables).length === 1) {
      captures.push({ purpose: "deployment_validation" });
      return Response.json({ data: { deployment: { id: deploymentId, projectId, environmentId, serviceId,
        status: "SUCCESS", createdAt: new Date(0).toISOString(), url: null, canRedeploy: true,
        canRollback: true, instances: [{ id: deploymentInstanceId }] } } });
    }
    if (body.query === RAILWAY_QUERIES.restart && variables.deploymentId === deploymentId &&
        Object.keys(variables).length === 1) {
      captures.push({ purpose: "restart" });
      return Response.json({ data: { deploymentRestart: true } });
    }
    throw new Error("railway_fixture_graphql_contract_not_fixed");
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
    name: "Read fixture Railway projects", policyType: input.reviewJourney ? "require_approval" : "allow", priority: 200, enabled: true,
    selectors: { connectionId: connection.id, toolName: tool.toolName },
  }, { userId: input.userId });
  await access.putConnectionInstalls(connection.id, {
    installs: [{ targetType: "agent", targetId: input.holderAgentId }],
  }, actor);
  const enableLargeSchemaTool = async () => {
    largeSchemaEnabled = true;
    const updated = await access.refreshCatalog(connection.id, actor, { restoreDraftDefaults: true });
    const largeTool = updated.catalog.find(entry => entry.toolName === "fixture-large");
    if (!largeTool || largeTool.status !== "active" || !largeTool.schemaHash || !largeTool.versionHash)
      throw new Error("railway_fixture_large_schema_discovery_failed");
    await toolAccessPolicyService(input.db).createPolicy(input.companyId, {
      name: "Read the large fixture tool", policyType: "allow", priority: 200, enabled: true,
      selectors: { connectionId: connection.id, toolName: "fixture-large" },
    }, { userId: input.userId });
    for (const filler of ballastTools) {
      const entry = updated.catalog.find(candidate => candidate.toolName === filler.name);
      if (!entry || entry.status !== "active" || !entry.schemaHash || !entry.versionHash)
        throw new Error("railway_fixture_catalog_ballast_discovery_failed");
      await toolAccessPolicyService(input.db).createPolicy(input.companyId, {
        name: `Read ${filler.name}`, policyType: "allow", priority: 200, enabled: true,
        selectors: { connectionId: connection.id, toolName: filler.name },
      }, { userId: input.userId });
    }
  };
  return {
    connection: refreshed.connection, tool, workspaceId, projectId,
    deploymentTarget: { projectId, environmentId, serviceId, deploymentId }, deploymentInstanceId, request, endpointLookup,
    enableLargeSchemaTool, captures: () => captures.map(capture => ({ ...capture })),
  };
}
