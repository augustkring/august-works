import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, toolCatalogEntries, toolInvocations,
  toolProfileEntries, toolProfiles } from "@paperclipai/db";
import { createApp } from "../../app.js";
import { errorHandler } from "../../middleware/index.js";
import { toolAccessRoutes } from "../../routes/tool-access.js";
import { createStorageService } from "../../storage/service.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { assignedMcpToolAlias, buildAssignedMcpSearchResult, createAssignedMcpTools, getAssignedMcpGateway,
  registerAssignedMcpGateway } from "../../services/native-runtime/assigned-mcp-tools.js";
import { runnerCodexDynamicToolsFit } from "../../vendor/paperclip-runner/index.js";
import { createToolGatewayService } from "../../services/tool-gateway.js";
import { toolAccessService } from "../../services/tool-access.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./embedded-postgres.js";
import { prepareConnectionIntentRailwayFixture } from "./connection-intent-railway-fixture.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe : describe.skip;

describePg("ConnectionIntent fixed non-model Railway fixture", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("connection-intent-railway-");
    db = createDb(database.connectionString);
  }, 20_000);
  afterAll(async () => { await database?.cleanup(); });

  it("uses canonical catalog/credential owners for real fixed GraphQL output and denies a rebranded opaque connection before effects", async () => {
    const companyId = randomUUID(), userId = randomUUID(), agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Railway continuation fixture",
      issuePrefix: `T${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}` });
    await db.insert(authUsers).values({ id: userId, name: "Fixture owner", email: `${userId}@example.test`,
      createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "owner", status: "active" });
    // Selected Test-tab identity only. This test never invokes its adapter.
    await db.insert(agents).values({ id: agentId, companyId, name: "Existing Railway holder", role: "engineer",
      status: "idle", adapterType: "process", adapterConfig: {}, runtimeConfig: {} });
    const fixture = await prepareConnectionIntentRailwayFixture({ db, companyId, userId, holderAgentId: agentId });
    expect(fixture.captures().map(row => row.purpose)).toEqual(["catalog", "workspace_probe", "projects_probe"]);
    expect(fixture.connection.config.railwayApiStatus).toBe("available");
    expect(fixture.tool).toMatchObject({ toolName: "paperclip-railway-list-projects", status: "active", riskLevel: "read" });
    const gateway = createToolGatewayService(db, { remoteHttpRequest: fixture.request });
    const call = { companyId, userId, agentId, connectionId: fixture.connection.id,
      toolName: fixture.tool.toolName, parameters: { workspaceId: fixture.workspaceId } };
    const result = await gateway.executeTestCall(call);
    expect(result).toMatchObject({ decision: "allowed", result: expect.anything() });
    expect(JSON.stringify(result)).toContain("Fixture project inventory");
    expect(fixture.captures().filter(row => row.purpose === "projects_call")).toHaveLength(1);
    const invocations = await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, companyId));
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ actorType: "user", actorId: userId, agentId, runId: null, status: "succeeded" });

    await expect(fixture.request("https://unexpected.example.test/graphql", { method: "POST" }))
      .rejects.toThrow("railway_fixture_destination_not_fixed");
    await toolAccessService(db, { remoteHttpEndpointLookup: fixture.endpointLookup,
      remoteHttpRequest: fixture.request }).updateConnection(fixture.connection.id, {
      config: { ...fixture.connection.config, sourceTemplateKey: "notion" },
    });
    await expect(gateway.executeTestCall(call)).rejects.toMatchObject({
      status: 409, reasonCode: "tool_model_effect_unqualified",
    });
    expect(fixture.captures().filter(row => row.purpose === "projects_call")).toHaveLength(1);
    expect(await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, companyId))).toHaveLength(1);
  });

  it("quarantines tools the provider adds after setup until the responsible Human reviews them through the app finish owner", async () => {
    const companyId = randomUUID(), userId = randomUUID(), agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Railway later tools fixture",
      issuePrefix: `L${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}` });
    await db.insert(authUsers).values({ id: userId, name: "Fixture owner", email: `${userId}@example.test`,
      createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "owner", status: "active" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Existing Railway holder", role: "engineer",
      status: "idle", adapterType: "process", adapterConfig: {}, runtimeConfig: {} });
    const fixture = await prepareConnectionIntentRailwayFixture({ db, companyId, userId, holderAgentId: agentId, reviewJourney: "always" });
    const access = toolAccessService(db, { remoteHttpEndpointLookup: fixture.endpointLookup, remoteHttpRequest: fixture.request });
    const later = ["fixture-large", "fixture-ballast-1", "fixture-ballast-2", "fixture-ballast-3"];
    const entries = async () => (await db.select().from(toolCatalogEntries).where(and(
      eq(toolCatalogEntries.companyId, companyId), inArray(toolCatalogEntries.toolName, later))));
    // Removal check: a review that never reaches the finish owner leaves them quarantined.
    await expect(fixture.enableLargeSchemaTool(async () => undefined)).rejects.toThrow("railway_fixture_large_schema_review_failed");
    const pending = await entries();
    expect(pending).toHaveLength(4);
    expect(pending.every(entry => entry.status === "quarantined" && entry.quarantineReason === "pending_review" &&
      entry.riskLevel === "write")).toBe(true);
    const bodies: unknown[] = [];
    await fixture.enableLargeSchemaTool(async body => {
      bodies.push(body);
      await access.finishGalleryAppConnection(companyId, fixture.connection.id, body,
        { actorType: "user", actorId: userId, userId });
    });
    expect(bodies).toEqual([expect.objectContaining({ access: "all_agents", askFirstCatalogEntryIds: [],
      reviewedCatalogEntryIds: expect.arrayContaining(pending.map(entry => entry.id)),
      enabledCatalogEntryIds: expect.arrayContaining([fixture.tool.id, ...pending.map(entry => entry.id)]) })]);
    const reviewed = await entries();
    expect(reviewed.every(entry => entry.status === "active" && entry.reviewedByUserId === userId)).toBe(true);
    expect(await db.select().from(toolCatalogEntries).where(and(eq(toolCatalogEntries.companyId, companyId),
      eq(toolCatalogEntries.status, "quarantined")))).toEqual([]);
  });

  // APR-E2E-28 (a). Relocated from the managed Always-allow e2e: discovery of
  // tools the provider adds after setup, the responsible Human's review
  // through the real app finish route, the compact assigned-tool catalog and
  // the chunked schema fetch of the large-schema tool. None of this needs a
  // managed invocation of an external MCP tool, which the gateway refuses in
  // every session until a qualified admission owner exists (APR-E2E-28b).
  it("keeps a reviewed large-schema tool discoverable through compact search and chunked schema fetch, and still refuses invoking it", async () => {
    const companyId = randomUUID(), userId = randomUUID(), agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Railway large schema fixture",
      issuePrefix: `S${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}` });
    await db.insert(authUsers).values({ id: userId, name: "Fixture owner", email: `${userId}@example.test`,
      createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "owner", status: "active" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Existing Railway holder", role: "engineer",
      status: "idle", adapterType: "process", adapterConfig: {}, runtimeConfig: {} });
    const fixture = await prepareConnectionIntentRailwayFixture({ db, companyId, userId, holderAgentId: agentId, reviewJourney: "always" });
    const gateway = createToolGatewayService(db, { remoteHttpRequest: fixture.request });
    const [gatewayProfile] = await db.insert(toolProfiles).values({ companyId, profileKey: `large-schema-${randomUUID()}`,
      name: `Large schema ${randomUUID()}`, defaultAction: "deny" }).returning();
    await db.insert(toolProfileEntries).values({ companyId, profileId: gatewayProfile!.id,
      selectorType: "connection", effect: "include", connectionId: fixture.connection.id });
    const namedGateway = await gateway.createNamedGateway({ companyId,
      body: { name: `Large schema ${randomUUID()}`, profileId: gatewayProfile!.id, agentId }, actor: { userId } });
    const token = await gateway.createNamedGatewayToken({ companyId, gatewayId: namedGateway.id,
      body: { name: "Large schema discovery", allowedActions: ["tools/list", "tools/call"] }, actor: { userId } });
    const listed = async () => (await gateway.listToolsForNamedGateway({ gatewayPublicId: namedGateway.gatewayPublicId,
      bearerToken: token.token })).filter(tool => tool.connectionId === fixture.connection.id);
    const later = ["fixture-large", "fixture-ballast-1", "fixture-ballast-2", "fixture-ballast-3"];
    expect((await listed()).map(tool => tool.upstreamToolName)).toContain("paperclip-railway-list-projects");

    // Tools added after setup stay quarantined and invisible until the Human reviews them.
    const pendingIds = await fixture.addLargeSchemaToolsPendingReview();
    expect(pendingIds).toHaveLength(4);
    expect((await listed()).some(tool => later.includes(String(tool.upstreamToolName)))).toBe(false);

    // The responsible Human reviews them through the real finish route (the Review tab's request).
    const routeApp = express();
    routeApp.use(express.json());
    routeApp.use((req, _res, next) => {
      req.actor = { type: "board", userId, sessionId: `session-${randomUUID()}`, userName: "Fixture owner", userEmail: null,
        isInstanceAdmin: false, source: "session", companyIds: [companyId],
        memberships: [{ companyId, membershipRole: "owner", status: "active" }] };
      next();
    });
    routeApp.use("/api", toolAccessRoutes(db, { toolGateway: gateway, remoteHttpEndpointLookup: fixture.endpointLookup,
      remoteHttpRequest: fixture.request }));
    routeApp.use(errorHandler);
    await fixture.enableLargeSchemaTool(async body => {
      const finished = await request(routeApp).post(`/api/companies/${companyId}/tools/apps/${fixture.connection.id}/finish`).send(body);
      expect(finished.status, JSON.stringify(finished.body)).toBe(200);
    });
    const reviewed = await listed();
    for (const name of later) expect(reviewed.filter(tool => tool.upstreamToolName === name)).toHaveLength(1);
    const large = reviewed.find(tool => tool.upstreamToolName === "fixture-large")!;

    // The direct catalog exceeds the signed Runnerd envelope, so the Run gets
    // the two compact wrappers, never the oversized schemas.
    const assigned = await createAssignedMcpTools({ db, companyId, issueId: randomUUID(), runId: randomUUID(), agentId,
      responsibleUserId: userId, gateway, gatewayPublicId: namedGateway.gatewayPublicId, bearerToken: token.token });
    expect(assigned.directDefinitions(runnerCodexDynamicToolsFit)).toEqual([]);
    const compact = assigned.definitions(runnerCodexDynamicToolsFit);
    expect(compact.map(tool => tool.name)).toEqual(["paperclip_search_assigned_tools", "paperclip_call_assigned_tool"]);
    expect(Buffer.byteLength(JSON.stringify(compact), "utf8")).toBeLessThanOrEqual(64_000);

    // The search projection (the same pure owner that source validation
    // replays) finds the large tool by name and points to its schema chunks.
    const entries = reviewed.map(descriptor => ({ alias: assignedMcpToolAlias(descriptor.name), descriptor }));
    const alias = assignedMcpToolAlias(large.name);
    const page = buildAssignedMcpSearchResult({ query: "fixture-large", limit: 10 }, entries, "standard") as
      { tools: Array<Record<string, unknown>>; nextOffset: number | null };
    expect(page.tools).toEqual([expect.objectContaining({ name: alias, inputSchemaRef: alias })]);
    expect(Buffer.byteLength(JSON.stringify(page.tools), "utf8")).toBeLessThanOrEqual(8 * 1024);
    let schemaJson = "", schemaOffset = 0, chunks = 0;
    for (;;) {
      const chunk = buildAssignedMcpSearchResult({ query: "", schemaTool: alias, schemaOffset }, entries, "standard") as
        { name: string; schemaJson: string; nextSchemaOffset: number | null };
      expect(chunk.name).toBe(alias);
      expect(Buffer.byteLength(JSON.stringify(chunk), "utf8")).toBeLessThanOrEqual(64_000);
      schemaJson += chunk.schemaJson; chunks++;
      if (chunk.nextSchemaOffset === null) break;
      schemaOffset = chunk.nextSchemaOffset;
    }
    expect(chunks).toBeGreaterThanOrEqual(2);
    const reconstructed = JSON.parse(schemaJson) as { properties: Record<string, unknown> };
    expect(Object.keys(reconstructed.properties)).toHaveLength(80);
    expect(Object.hasOwn(reconstructed.properties, "field_0000")).toBe(true);
    expect(Object.hasOwn(reconstructed.properties, "field_0079")).toBe(true);
    expect(reconstructed).toEqual(large.parametersSchema);

    // APR-E2E-28b: invoking the external MCP tool is still refused before any provider effect.
    const invocationsBefore = await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, companyId));
    await expect(gateway.executeTestCall({ companyId, userId, agentId, connectionId: fixture.connection.id,
      toolName: "fixture-large", parameters: { field_0000: "schema-chunk-proof" } })).rejects.toMatchObject({
      status: 409, reasonCode: "tool_model_effect_unqualified",
    });
    await expect(assigned.execute({ tool: "paperclip_search_assigned_tools", callId: "large-schema-search",
      arguments: { query: "fixture-large", limit: 10 } })).rejects.toMatchObject({
      status: 409, reasonCode: "tool_model_effect_unqualified",
    });
    expect(fixture.captures().filter(capture => capture.purpose === "large_tool_call")).toHaveLength(0);
    expect((await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, companyId)))
      .filter(row => row.status === "succeeded" && row.toolName === large.name)).toEqual([]);
    expect(invocationsBefore.filter(row => row.toolName === large.name)).toEqual([]);
  });

  it("composes the already installed gateway without replacing its transaction factory and rejects another instance", async () => {
    const gateway = createToolGatewayService(db);
    let scopedReads = 0;
    registerAssignedMcpGateway(db, gateway, scopedDb => {
      scopedReads++;
      return createToolGatewayService(scopedDb);
    });
    const home = await mkdtemp(join(tmpdir(), "railway-app-owner-"));
    const options: Parameters<typeof createApp>[1] = {
      assignedToolGateway: gateway, uiMode: "none", serverPort: 0,
      storageService: createStorageService(createLocalDiskStorageProvider(home)),
      deploymentMode: "authenticated", deploymentExposure: "private",
      allowedHostnames: ["127.0.0.1"], bindHost: "127.0.0.1", authReady: true,
      companyDeletionEnabled: false, managedPluginAutoInstall: [],
      decisionServiceOptions: { wakeOriginAgent: async () => undefined },
    };
    try {
      await expect(createApp(db, { ...options, assignedToolGateway: createToolGatewayService(db) }))
        .rejects.toThrow("already registered Tool Gateway owner");
      const app = await createApp(db, options);
      try {
        expect(app.locals.toolGateway).toBe(gateway);
        expect(getAssignedMcpGateway(db)).toBe(gateway);
        await db.transaction(async tx => {
          // The registration API names this scoped handle Db; this is the real
          // transaction passed by the existing metadata/currentness owners.
          getAssignedMcpGateway(db, tx as unknown as typeof db);
        });
        expect(scopedReads).toBe(1);
      } finally {
        const shutdown: unknown = app.locals.paperclipShutdown;
        if (typeof shutdown !== "function") throw new Error("app_shutdown_owner_missing");
        await shutdown();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

});
