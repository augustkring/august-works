import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, principalPermissionGrants } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { readWorkflowStepActors } from "../services/experience/workflow-step-actors.js";

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
  it("withholds an actual removed Agent instead of preserving its old name or substituting another assignment", async () => {
    const f = await fixture();
    await db.delete(agents).where(eq(agents.id, f.agentId));
    expect((await readWorkflowStepActors(db, f.detail, f.actor)).get(f.key)).toEqual({ state: "unavailable", name: null });
  });
});
