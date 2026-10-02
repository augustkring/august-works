import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, companyMemberships, createDb, principalPermissionGrants } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { workflowDelegationForActor } from "./workflow-delegation.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;
suite("Server-assigned workflow delegation", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { temp = await startEmbeddedPostgresTestDatabase("paperclip-delegation-"); db = createDb(temp.connectionString); }, 30_000);
  afterAll(async () => temp?.cleanup());
  async function company() { return (await db.insert(companies).values({ name: "Delegation", issuePrefix: `G${randomUUID().slice(0, 6).toUpperCase()}` }).returning())[0]!; }
  it("uses the configuring member and revokes delegation when membership or permission changes", async () => {
    const tenant = await company(), other = await company(), userId = randomUUID();
    const [membership] = await db.insert(companyMemberships).values({ companyId: tenant.id, principalType: "user", principalId: userId, membershipRole: "member", status: "active" }).returning();
    const [grant] = await db.insert(principalPermissionGrants).values({ companyId: tenant.id, principalType: "user", principalId: userId, permissionKey: "workflows:run", scope: {} }).returning();
    expect(await workflowDelegationForActor(db, tenant.id, { userId })).toEqual({ type: "user", userId });
    await expect(workflowDelegationForActor(db, other.id, { userId })).rejects.toMatchObject({ status: 403 });
    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.id, grant!.id));
    await expect(workflowDelegationForActor(db, tenant.id, { userId })).rejects.toMatchObject({ status: 403 });
    await db.insert(principalPermissionGrants).values({ companyId: tenant.id, principalType: "user", principalId: userId, permissionKey: "workflows:run", scope: {} });
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.id, membership!.id));
    await expect(workflowDelegationForActor(db, tenant.id, { userId })).rejects.toMatchObject({ status: 403 });
  });
  it("requires a currently available, permitted company agent", async () => {
    const tenant = await company();
    const [agent] = await db.insert(agents).values({ companyId: tenant.id, name: "Delegating agent", status: "idle", adapterType: "process", role: "engineer" }).returning();
    await db.insert(companyMemberships).values({ companyId: tenant.id, principalType: "agent", principalId: agent!.id, membershipRole: "member", status: "active" });
    await db.insert(principalPermissionGrants).values({ companyId: tenant.id, principalType: "agent", principalId: agent!.id, permissionKey: "workflows:run", scope: {} });
    expect(await workflowDelegationForActor(db, tenant.id, { agentId: agent!.id })).toEqual({ type: "agent", agentId: agent!.id });
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, agent!.id));
    await expect(workflowDelegationForActor(db, tenant.id, { agentId: agent!.id })).rejects.toMatchObject({ status: 403 });
  });
  it("does not borrow a responsible owner's identity for anonymous configuration", async () => {
    const tenant = await company();
    expect(await workflowDelegationForActor(db, tenant.id, {})).toBeNull();
  });
});
