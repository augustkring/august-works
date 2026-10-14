import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, principalPermissionGrants,
  toolApplications, toolConnections, toolCatalogEntries, toolInvocations, workflowRuns } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { readWorkflowStepActors, readWorkflowStepContext } from "../services/experience/workflow-step-actors.js";

describe.sequential("Current Native workflow step assignments", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v9-step-actors-"); db = createDb(database.connectionString); }, 120000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  async function fixture() {
    const companyId = randomUUID(), userId = randomUUID(), agentId = randomUUID(), now = new Date();
    const actor = { type: "board" as const, source: "session" as const, userId };
    await db.insert(companies).values({ id: companyId, name: "Step actors", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Reader", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "viewer", status: "active" });
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: userId, permissionKey: "workflows:read" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Selected analyst", adapterType: "process", status: "idle" });
    const owner = workflowService(db), human = { principal: { type: "user" as const, userId } };
    const workflow = await owner.create(companyId, { name: "Review" }, human);
    await owner.updateDraft(companyId, workflow.id, { expectedRevisionId: workflow.draftRevisionId!, graph: {
      version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "agent", type: "agent.task", name: "Analyze", position: { x: 0, y: 1 }, config: { agentId, objective: "PRIVATE objective" } }],
      edges: [{ id: "next", source: "start", target: "agent" }], variables: [], settings: {},
    } }, human);
    const detail = (await owner.getDetail(companyId, workflow.id, actor))!;
    return { companyId, userId, agentId, actor, detail, owner, human, key: `${detail.draftRevisionId}:agent` };
  }
  it("shows the exact selected Agent under current Native read authority without copying the brief or Agent config", async () => {
    const f = await fixture(), result = await readWorkflowStepActors(db, f.detail, f.actor);
    expect(result.get(f.key)).toEqual({ state: "current", name: "Selected analyst" });
    expect(JSON.stringify([...result])).not.toMatch(/PRIVATE|objective|adapterType/);
    await db.update(agents).set({ name: "Renamed analyst" }).where(eq(agents.id, f.agentId));
    expect((await readWorkflowStepActors(db, f.detail, f.actor)).get(f.key)?.name).toBe("Renamed analyst");
  });
  it("refuses stale revision, revoked membership and unverified account despite a claimed administrator", async () => {
    const f = await fixture();
    const graph = structuredClone(f.detail.draftRevision!.graph); graph.nodes[1].name = "Changed step";
    await f.owner.updateDraft(f.companyId, f.detail.id, { expectedRevisionId: f.detail.draftRevisionId!, graph }, f.human);
    await expect(readWorkflowStepActors(db, f.detail, f.actor)).rejects.toMatchObject({ status: 409 });
    f.detail = (await f.owner.getDetail(f.companyId, f.detail.id, f.actor))!;
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(readWorkflowStepActors(db, f.detail, { ...f.actor, isInstanceAdmin: true })).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, f.userId));
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, f.companyId), eq(companyMemberships.principalId, f.userId)));
    await expect(readWorkflowStepActors(db, f.detail, { ...f.actor, isInstanceAdmin: true })).rejects.toMatchObject({ status: 403 });
  });
  it("does not borrow local fixture identity for selected Agent metadata", async () => {
    const f = await fixture();
    expect((await readWorkflowStepActors(db, f.detail, { type: "board", source: "local_implicit" })).get(f.key)).toEqual({ state: "unavailable", name: null });
  });
  it("requires current verified reader authority for closed input review even when no Agent or connection metadata is requested", async () => {
    const f = await fixture(), graph = structuredClone(f.detail.draftRevision!.graph);
    graph.nodes = [graph.nodes[0]]; graph.edges = [];
    await f.owner.updateDraft(f.companyId, f.detail.id, { expectedRevisionId: f.detail.draftRevisionId!, graph }, f.human);
    f.detail = (await f.owner.getDetail(f.companyId, f.detail.id, f.actor))!;
    expect((await readWorkflowStepContext(db, f.detail, f.actor)).assignments.size).toBe(0);
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(readWorkflowStepContext(db, f.detail, f.actor)).rejects.toMatchObject({ status: 403 });
  });
  it("withholds an actual removed Agent instead of preserving its old name or substituting another assignment", async () => {
    const f = await fixture();
    await db.delete(agents).where(eq(agents.id, f.agentId));
    expect((await readWorkflowStepActors(db, f.detail, f.actor)).get(f.key)).toEqual({ state: "unavailable", name: null });
  });
  async function toolFixture() {
    const f = await fixture(), applicationId = randomUUID(), connectionId = randomUUID(), entryId = randomUUID();
    await db.insert(toolApplications).values({ id: applicationId, companyId: f.companyId, name: "Contacts", type: "mcp_http" });
    await db.insert(toolConnections).values({ id: connectionId, companyId: f.companyId, applicationId, name: "Contact system", uid: randomUUID(),
      transport: "mcp_remote", status: "active", enabled: true, createdByUserId: "another-user",
      config: { privateToken: "PRIVATE credential" }, transportConfig: { url: "https://private-endpoint.invalid" } });
    await db.insert(toolCatalogEntries).values({ id: entryId, companyId: f.companyId, applicationId, connectionId,
      name: "contacts.lookup", toolName: "contacts.lookup", title: "Find contacts", versionHash: "version-a", schemaHash: "schema-a",
      inputSchema: { type: "object", properties: { privateField: { type: "string", default: "PRIVATE schema" } } } });
    const graph = structuredClone(f.detail.draftRevision!.graph);
    graph.nodes[1] = { id: "tool", type: "connector.action", name: "Find contacts", position: { x: 0, y: 1 },
      config: { connectionId, toolCatalogEntryId: entryId, catalogVersionHash: "version-a", catalogSchemaHash: "schema-a", input: { token: "PRIVATE input" } } };
    graph.edges[0].target = "tool";
    await f.owner.updateDraft(f.companyId, f.detail.id, { expectedRevisionId: f.detail.draftRevisionId!, graph }, f.human);
    f.detail = (await f.owner.getDetail(f.companyId, f.detail.id, f.actor))!;
    return { ...f, applicationId, connectionId, entryId, key: `${f.detail.draftRevisionId}:tool` };
  }
  it("shows the exact selected connection and Native permission link, distinguishing current company permission from execution authority", async () => {
    const f = await toolFixture();
    const read = async () => (await readWorkflowStepContext(db, f.detail, f.actor)).toolAccess.get(f.key);
    expect(await read()).toEqual({ state: "permission_required", connectionName: "Contact system", operationName: "Find contacts",
      previewHref: `/apps/${f.connectionId}/permissions` });
    await db.insert(principalPermissionGrants).values({ companyId: f.companyId, principalType: "user", principalId: f.userId, permissionKey: "tools:use" });
    expect(await read()).toMatchObject({ state: "execution_check" });
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.companyId), eq(principalPermissionGrants.permissionKey, "tools:use")));
    expect(await read()).toMatchObject({ state: "permission_required" });
    expect(JSON.stringify(await read())).not.toMatch(/PRIVATE|private-endpoint|privateField|token/);
    expect(await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, f.companyId))).toEqual([]);
    expect(await db.select().from(workflowRuns).where(eq(workflowRuns.companyId, f.companyId))).toEqual([]);
  });
  it("reviews exact saved scalar inputs only under the current connection and effective definition, withholding stale/private/complex values", async () => {
    const f = await toolFixture(), schema = { type: "object", properties: { query: { type: "string", title: "Search" }, enabled: { type: "boolean" }, count: { type: "integer" } }, required: ["query"], additionalProperties: false };
    await db.update(toolCatalogEntries).set({ inputSchema: schema }).where(eq(toolCatalogEntries.id, f.entryId));
    async function save(config: Record<string, unknown>) {
      const graph = structuredClone(f.detail.draftRevision!.graph); graph.nodes[1].config = config;
      await f.owner.updateDraft(f.companyId, f.detail.id, { expectedRevisionId: f.detail.draftRevisionId!, graph }, f.human);
      f.detail = (await f.owner.getDetail(f.companyId, f.detail.id, f.actor))!; f.key = `${f.detail.draftRevisionId}:tool`;
    }
    const config = { connectionId: f.connectionId, toolCatalogEntryId: f.entryId, catalogVersionHash: "version-a", catalogSchemaHash: "schema-a",
      projectedInputSchemaHash: nativeSha256(schema), input: { query: " PRIVATE literal ", enabled: false } };
    await save(config);
    const read = () => readWorkflowStepContext(db, f.detail, { ...f.actor, isInstanceAdmin: true });
    const current = await read();
    expect(current.toolInputs.get(f.key)).toMatchObject({ kind: "connected_tool", values: { query: " PRIVATE literal ", enabled: false } });
    expect(current.toolAccess.get(f.key)?.state).toBe("permission_required"); // review does not borrow tools:use
    expect(JSON.stringify([...current.toolInputs])).not.toMatch(/credential|private-endpoint/);
    expect(current.toolInputs.get(f.key)).toHaveProperty("fields", expect.arrayContaining([expect.objectContaining({ name: "count", required: false })]));
    const single = structuredClone(f.detail.draftRevision!.graph), many = structuredClone(single);
    many.nodes = [single.nodes[0], ...Array.from({ length: 20 }, (_, index) => ({ ...single.nodes[1], id: `tool-${index}`, config: { ...config, input: { query: "x".repeat(4000) } } }))];
    many.edges = many.nodes.slice(1).map((node, index) => ({ id: `edge-${index}`, source: many.nodes[index].id, target: node.id }));
    await f.owner.updateDraft(f.companyId, f.detail.id, { expectedRevisionId: f.detail.draftRevisionId!, graph: many }, f.human);
    f.detail = (await f.owner.getDetail(f.companyId, f.detail.id, f.actor))!;
    await expect(read()).rejects.toThrow("Complete connected input review exceeds the read budget");
    await f.owner.updateDraft(f.companyId, f.detail.id, { expectedRevisionId: f.detail.draftRevisionId!, graph: single }, f.human);
    f.detail = (await f.owner.getDetail(f.companyId, f.detail.id, f.actor))!; f.key = `${f.detail.draftRevisionId}:tool`;
    await db.update(toolCatalogEntries).set({ inputSchema: { ...schema, properties: { query: { type: "string", minLength: 3 } } } }).where(eq(toolCatalogEntries.id, f.entryId));
    const drift = await read(); expect(drift.toolInputs.get(f.key)).toEqual({ kind: "advanced" }); expect(drift.toolAccess.get(f.key)?.state).toBe("catalog_changed");
    await db.update(toolCatalogEntries).set({ inputSchema: schema }).where(eq(toolCatalogEntries.id, f.entryId));
    await db.update(toolConnections).set({ status: "draft" }).where(eq(toolConnections.id, f.connectionId));
    expect((await read()).toolInputs.get(f.key)).toEqual({ kind: "advanced" });
    await db.update(toolConnections).set({ status: "active" }).where(eq(toolConnections.id, f.connectionId));
    await save({ ...config, inputMapping: { query: "{{trigger.private}}" } });
    expect((await read()).toolInputs.get(f.key)).toEqual({ kind: "advanced" });
    await save({ ...config, projectedInputSchemaHash: undefined });
    expect((await read()).toolInputs.get(f.key)).toEqual({ kind: "advanced" });
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(read()).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, f.companyId))).toEqual([]);
    expect(await db.select().from(workflowRuns).where(eq(workflowRuns.companyId, f.companyId))).toEqual([]);
  });
  it("keeps disabled, changed, missing and foreign-private-draft connection states distinct without revealing hidden identity", async () => {
    const f = await toolFixture();
    const read = async () => (await readWorkflowStepContext(db, f.detail, { ...f.actor, isInstanceAdmin: true })).toolAccess.get(f.key);
    await db.update(toolConnections).set({ enabled: false }).where(eq(toolConnections.id, f.connectionId));
    expect(await read()).toMatchObject({ state: "connection_disabled" });
    await db.update(toolConnections).set({ enabled: true }).where(eq(toolConnections.id, f.connectionId));
    await db.update(toolCatalogEntries).set({ versionHash: "version-b" }).where(eq(toolCatalogEntries.id, f.entryId));
    expect(await read()).toMatchObject({ state: "catalog_changed" });
    await db.update(toolConnections).set({ status: "draft" }).where(eq(toolConnections.id, f.connectionId));
    expect(await read()).toEqual({ state: "unavailable", connectionName: null, operationName: null, previewHref: null });
    await db.update(toolConnections).set({ createdByUserId: f.userId }).where(eq(toolConnections.id, f.connectionId));
    expect(await read()).toMatchObject({ state: "connection_disabled", connectionName: "Contact system" });
    await db.update(toolConnections).set({ createdByUserId: "another-user" }).where(eq(toolConnections.id, f.connectionId));
    await db.insert(principalPermissionGrants).values({ companyId: f.companyId, principalType: "user", principalId: f.userId, permissionKey: "tools:manage_connections" });
    expect(await read()).toMatchObject({ state: "connection_disabled", connectionName: "Contact system" });
    await db.delete(toolConnections).where(eq(toolConnections.id, f.connectionId));
    expect(await read()).toEqual({ state: "unavailable", connectionName: null, operationName: null, previewHref: null });
  });
});
