import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, toolInvocations } from "@paperclipai/db";
import { createApp } from "../../app.js";
import { createStorageService } from "../../storage/service.js";
import { createLocalDiskStorageProvider } from "../../storage/local-disk-provider.js";
import { getAssignedMcpGateway, registerAssignedMcpGateway } from "../../services/native-runtime/assigned-mcp-tools.js";
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
