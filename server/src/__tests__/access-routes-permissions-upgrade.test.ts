import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  authSessions,
  authUsers,
  agents,
  companies,
  companyMemberships,
  heartbeatRuns,
  connectionGrantDelegations,
  connectionGrants,
  createDb,
  principalPermissionGrants,
  toolApplications,
  toolConnections,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { seedCurrentHumanMembership } from "./helpers/current-human-membership-fixture.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";

vi.hoisted(() => {
  process.env.PAPERCLIP_HOME = "/tmp/paperclip-test-home";
  process.env.PAPERCLIP_INSTANCE_ID = "vitest";
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

type Db = ReturnType<typeof createDb>;

async function createApp(db: Db, companyId: string, userId: string, sessionId?: string) {
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
  const { accessRoutes } = await import("../routes/access.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = {
      type: "board",
      userId,
      source: sessionId ? "session" : "local_implicit",
      ...(sessionId ? { sessionId } : {}),
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "owner", status: "active" }],
      isInstanceAdmin: true,
    };
    next();
  });
  app.use("/api", accessRoutes(db, {
    deploymentMode: "authenticated",
    deploymentExposure: "private",
    bindHost: "127.0.0.1",
    allowedHostnames: [],
  }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error" });
  });
  return app;
}

async function createCompanyWithOwner(db: Db) {
  const company = await db
    .insert(companies)
    .values({
      name: `Access Routes ${randomUUID()}`,
      issuePrefix: `AR${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
  const owner = await db
    .insert(companyMemberships)
    .values({
      companyId: company.id,
      principalType: "user",
      principalId: `owner-${randomUUID()}`,
      status: "active",
      membershipRole: "owner",
    })
    .returning()
    .then((rows) => rows[0]!);
  return { company, owner };
}

describeEmbeddedPostgres("access routes permissions upgrade compatibility", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // Load the large router graph during setup so a cold CI transform does not
  // consume the first permission assertion's timeout budget.
  beforeAll(async () => {
    await import("../routes/access.js");
  }, 30_000);

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-access-routes-permissions-upgrade-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(connectionGrantDelegations);
    await db.delete(connectionGrants);
    await db.delete(toolConnections);
    await db.delete(toolApplications);
    await db.delete(heartbeatRuns);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("rejects owner self-lockout through the member route after the permissions upgrade", async () => {
    const { company, owner } = await createCompanyWithOwner(db);

    const res = await request(await createApp(db, company.id, owner.principalId))
      .patch(`/api/companies/${company.id}/members/${owner.id}`)
      .send({ membershipRole: "admin" });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toContain("You cannot remove yourself");

    const unchanged = await db
      .select()
      .from(companyMemberships)
      .where(eq(companyMemberships.id, owner.id))
      .then((rows) => rows[0]!);
    expect(unchanged.membershipRole).toBe("owner");
  }, 10_000);

  it("allows an explicitly authorized recent Human to security-suspend the last owner and records owner recovery", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const actorId = `continuity-admin-${randomUUID()}`;
    await seedCurrentHumanMembership(db, company.id, actorId, "admin");
    await db.insert(principalPermissionGrants).values({
      companyId: company.id, principalType: "user", principalId: actorId,
      permissionKey: "users:manage_permissions", scope: null,
    });
    const actorSessionId = await seedNativePasskeySession(db, actorId);
    await db.insert(authUsers).values({
      id: owner.principalId, name: "Last owner", email: `${owner.principalId}@fixture.invalid`,
      emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
    });
    const agent = await db.insert(agents).values({
      companyId: company.id, name: "Owner work", role: "worker", adapterType: "process", adapterConfig: {},
    }).returning().then((rows) => rows[0]!);
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: company.id, agentId: agent.id, status: "running", startedAt: new Date(),
      runtimeMode: "legacy", responsibleUserId: owner.principalId,
    }).returning();
    await db.update(companies).set({ defaultResponsibleUserId: owner.principalId }).where(eq(companies.id, company.id));

    const response = await request(await createApp(db, company.id, actorId, actorSessionId))
      .post(`/api/companies/${company.id}/members/${owner.id}/security-suspend`)
      .send({ reasonCode: "suspected_compromise" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ ownerRecoveryRequired: true, member: { id: owner.id, status: "suspended" } });
    expect(await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id)))
      .toEqual([{ status: "cancelled" }]);
    expect(await db.select({ defaultResponsibleUserId: companies.defaultResponsibleUserId }).from(companies).where(eq(companies.id, company.id)))
      .toEqual([{ defaultResponsibleUserId: null }]);
    expect(await db.select({ action: activityLog.action }).from(activityLog).where(and(
      eq(activityLog.companyId, company.id), eq(activityLog.action, "company.owner_recovery_required"),
    ))).toHaveLength(1);

    const localAttempt = await request(await createApp(db, company.id, actorId))
      .post(`/api/companies/${company.id}/members/${owner.id}/security-suspend`)
      .send({ reasonCode: "other" });
    expect(localAttempt.status).toBe(403);
    const accountChangedAttempt = await request(await createApp(db, company.id, actorId, actor.sessionId!))
      .post(`/api/companies/${company.id}/members/${owner.id}/security-suspend`)
      .set("X-Blentera-Expected-User", actorId)
      .set("X-Blentera-Expected-Session", randomUUID())
      .send({ reasonCode: "other" });
    expect(accountChangedAttempt.status).toBe(409);
    await db.update(authSessions).set({ authenticatedAt: new Date(Date.now() - 301_000) })
      .where(eq(authSessions.id, actorSessionId));
    const staleAttempt = await request(await createApp(db, company.id, actorId, actorSessionId))
      .post(`/api/companies/${company.id}/members/${owner.id}/security-suspend`)
      .send({ reasonCode: "other" });
    expect(staleAttempt.status).toBe(403);
  }, 20_000);

  it("does not let local implicit administrator access read, create, or revoke Human workflow coverage", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const http = request(await createApp(db, company.id, owner.principalId));
    await http.get(`/api/companies/${company.id}/workflow-coverages`).expect(403).expect((response) => {
      expect(response.body.error).toMatch(/current Human session is required/i);
    });
    await http.post(`/api/companies/${company.id}/workflow-coverages`).send({
      requestId: randomUUID(), delegateeUserId: `delegatee-${randomUUID()}`,
      workflowId: randomUUID(), workflowRevisionId: randomUUID(), scopeType: "manual", taskId: null,
      startsAt: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 3_600_000), reason: "Human session required",
    }).expect(403).expect((response) => {
      expect(response.body.error).toMatch(/current Human session is required/i);
    });
    await http.delete(`/api/companies/${company.id}/workflow-coverages/${randomUUID()}`).expect(403).expect((response) => {
      expect(response.body.error).toMatch(/current Human session is required/i);
    });
  });

  it("keeps custom grants when the role-only member route changes a member role", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const member = await db
      .insert(companyMemberships)
      .values({
        companyId: company.id,
        principalType: "user",
        principalId: `admin-${randomUUID()}`,
        status: "active",
        membershipRole: "admin",
      })
      .returning()
      .then((rows) => rows[0]!);
    const customScope = { projectIds: ["project-1"] };
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: member.principalId,
      permissionKey: "tasks:assign_scope",
      scope: customScope,
      grantedByUserId: owner.principalId,
    });

    const res = await request(await createApp(db, company.id, owner.principalId))
      .patch(`/api/companies/${company.id}/members/${member.id}`)
      .send({ membershipRole: "operator" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.membershipRole).toBe("operator");

    const grants = await db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, company.id),
          eq(principalPermissionGrants.principalType, "user"),
          eq(principalPermissionGrants.principalId, member.principalId),
        ),
      );
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      permissionKey: "tasks:assign_scope",
      scope: customScope,
      grantedByUserId: owner.principalId,
    });
  });

  it("sweeps personal connection access when the member route suspends a user", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const member = await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const agent = await db.insert(agents).values({
      companyId: company.id,
      name: "Delegated route agent",
      role: "worker",
      adapterType: "process",
      adapterConfig: {},
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      companyId: company.id,
      applicationKey: `route-app-${randomUUID()}`,
      name: "Route personal app",
      type: "mcp",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const connection = await db.insert(toolConnections).values({
      companyId: company.id,
      applicationId: application.id,
      name: "Route personal connection",
      uid: `route-connection-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "oauth",
      credentialPolicy: "per_user",
      status: "active",
      enabled: true,
    }).returning().then((rows) => rows[0]!);
    const grant = await db.insert(connectionGrants).values({
      companyId: company.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: member.principalId,
      status: "active",
    }).returning().then((rows) => rows[0]!);
    await db.insert(connectionGrantDelegations).values({
      companyId: company.id,
      grantId: grant.id,
      agentId: agent.id,
      createdByUserId: member.principalId,
    });

    const res = await request(await createApp(db, company.id, owner.principalId))
      .patch(`/api/companies/${company.id}/members/${member.id}`)
      .send({ status: "suspended" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("suspended");
    expect(await db.select().from(connectionGrantDelegations)).toHaveLength(0);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant.id)))
      .toEqual([expect.objectContaining({ status: "revoked" })]);

    await request(await createApp(db, company.id, owner.principalId))
      .patch(`/api/companies/${company.id}/members/${member.id}/role-and-grants`)
      .send({ status: "active", grants: [] })
      .expect(200);
    await db.update(connectionGrants).set({ status: "active" }).where(eq(connectionGrants.id, grant.id));
    await db.insert(connectionGrantDelegations).values({
      companyId: company.id,
      grantId: grant.id,
      agentId: agent.id,
      createdByUserId: member.principalId,
    });

    const permissionsRoute = await request(await createApp(db, company.id, owner.principalId))
      .patch(`/api/companies/${company.id}/members/${member.id}/role-and-grants`)
      .send({ status: "suspended", grants: [] });
    expect(permissionsRoute.status, JSON.stringify(permissionsRoute.body)).toBe(200);
    expect(await db.select().from(connectionGrantDelegations)).toHaveLength(0);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant.id)))
      .toEqual([expect.objectContaining({ status: "revoked" })]);
  });
});
