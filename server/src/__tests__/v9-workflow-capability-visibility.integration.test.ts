import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authUsers, companies, companyMemberships, createDb, principalPermissionGrants, toolApplications, toolConnections, toolCatalogEntries } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { workflowRoutes } from "../routes/workflows.js";
import { errorHandler } from "../middleware/error-handler.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { readWorkflowCapabilityCatalog } from "../services/workflows/workflow-capability-visibility.js";
import { workflowCapabilityResolverService } from "../services/workflows/workflow-capability-resolver.js";

describe.sequential("Current Native workflow capability visibility", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v9-capability-read-"); db = createDb(database.connectionString); }, 120000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  async function fixture() {
    const companyId = randomUUID(), userId = randomUUID(), creatorId = randomUUID(), now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Catalog read", issuePrefix: randomUUID() });
    await db.insert(authUsers).values([userId, creatorId].map(id => ({ id, name: "Catalog user", email: `${id}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now })));
    await db.insert(companyMemberships).values([userId, creatorId].map(principalId => ({ companyId, principalType: "user", principalId, membershipRole: "viewer", status: "active" })));
    await db.insert(principalPermissionGrants).values([userId, creatorId].map(principalId => ({ companyId, principalType: "user", principalId, permissionKey: "workflows:read" })));
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true });
    const [application] = await db.insert(toolApplications).values({ companyId, name: "Metadata fixture", type: "mcp_http" }).returning();
    const [connection] = await db.insert(toolConnections).values({ companyId, applicationId: application.id, name: "PRIVATE draft connection",
      uid: randomUUID(), transport: "mcp_remote", status: "draft", createdByUserId: creatorId, config: { privateToken: "PRIVATE credential" },
      transportConfig: { url: "https://uncontacted.test.invalid" } }).returning();
    const [entry] = await db.insert(toolCatalogEntries).values({ companyId, applicationId: application.id, connectionId: connection.id,
      name: "private.lookup", toolName: "private.lookup", title: "PRIVATE draft operation", description: "PRIVATE draft description",
      inputSchema: { type: "object", properties: { "PRIVATE field": { type: "string" } } }, versionHash: "v1", schemaHash: "s1" }).returning();
    const actor = { type: "board" as const, source: "session" as const, userId, companyIds: [companyId] };
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.actor = { ...actor, isInstanceAdmin: true }; next(); });
    app.use("/api", workflowRoutes(db)); app.use(errorHandler);
    return { companyId, userId, creatorId, connection, entry, actor, app };
  }
  it("filters another creator's draft before ranking/disclosure despite claimed administrator context, retaining actual creator/manager access", async () => {
    const f = await fixture(), query = { q: "PRIVATE", limit: 10, kind: "connected_tool" as const };
    const inventory = await workflowCapabilityResolverService(db).search(f.companyId, query);
    expect(inventory.candidates).toHaveLength(1);
    const response = await request(f.app).get(`/api/companies/${f.companyId}/workflows/capability-search`).query(query).expect(200);
    expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.body.candidates).toEqual([]);
    expect(JSON.stringify(response.body)).not.toMatch(/draft connection|draft operation|PRIVATE field|PRIVATE credential/);
    expect((await readWorkflowCapabilityCatalog(db, f.companyId, { ...f.actor, userId: f.creatorId }, query)).candidates.map(row => row.id)).toEqual([`tool:${f.entry.id}`]);
    await db.insert(principalPermissionGrants).values({ companyId: f.companyId, principalType: "user", principalId: f.userId, permissionKey: "tools:manage_connections" });
    expect((await readWorkflowCapabilityCatalog(db, f.companyId, f.actor, query)).candidates).toHaveLength(1);
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.companyId), eq(principalPermissionGrants.principalId, f.userId), eq(principalPermissionGrants.permissionKey, "tools:manage_connections")));
    expect((await readWorkflowCapabilityCatalog(db, f.companyId, f.actor, query)).candidates).toEqual([]);
    await db.update(toolConnections).set({ status: "active" }).where(eq(toolConnections.id, f.connection.id));
    expect((await readWorkflowCapabilityCatalog(db, f.companyId, f.actor, query)).candidates).toHaveLength(1);
  });
  it("keeps static definitions readable and refuses current membership loss or cross-company catalog reads", async () => {
    const f = await fixture(), query = { q: "condition", limit: 10, kind: "core_node" as const };
    expect((await readWorkflowCapabilityCatalog(db, f.companyId, f.actor, query)).candidates.map(row => row.id)).toContain("core:core.condition");
    await expect(readWorkflowCapabilityCatalog(db, randomUUID(), f.actor, query)).rejects.toMatchObject({ status: 403 });
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, f.companyId), eq(companyMemberships.principalId, f.userId)));
    await request(f.app).get(`/api/companies/${f.companyId}/workflows/capability-search`).query(query).expect(403);
  });
});
