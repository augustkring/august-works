import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  issueComments,
  issues,
  principalPermissionGrants,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { __clearIssueListResponseCacheForTests, issueRoutes } from "../routes/issues.js";
import { publishLiveEvent } from "../services/live-events.js";
import { ensureHumanRoleDefaultGrants } from "../services/principal-access-compatibility.js";
import { safeGetCacheWriteInvalidation } from "../services/safe-get-cache-generation.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue list cache tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// CACHE-STALE1: the compact Tasks list is served from a short in-process cache
// and answers If-None-Match with 304. A committed write must invalidate that
// cache before its response returns, or the writer's next list read is stale.
describeEmbeddedPostgres("issue list cache read-your-writes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-list-cache-");
    db = createDb(tempDb.connectionString, { maxConnections: 10 });
  }, 20_000);

  afterEach(async () => {
    __clearIssueListResponseCacheForTests();
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(companies);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp(companyId: string, opts: Parameters<typeof issueRoutes>[2] = {}) {
    const app = express();
    // Same order as app.ts: the invalidation hook runs before every router.
    app.use(safeGetCacheWriteInvalidation());
    app.use(express.json());
    app.use((req, _res, next) => {
      const userId = req.header("x-test-user-id") ?? "cloud-user-1";
      (req as any).actor = {
        type: "board",
        userId,
        companyIds: [companyId],
        memberships: [{ companyId, membershipRole: "owner", status: "active", principalId: userId }],
        source: "cloud_tenant",
        isInstanceAdmin: false,
      };
      next();
    });
    app.use("/api", issueRoutes(db, {} as any, opts));
    app.use(errorHandler);
    return app;
  }

  async function seedCompany() {
    const companyId = randomUUID();
    const userId = "cloud-user-1";
    await db.insert(companies).values({
      id: companyId,
      name: "Read your writes",
      issuePrefix: `R${randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(authUsers).values({
      id: userId,
      name: "Owner",
      email: `${randomUUID()}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
      updatedAt: new Date(),
    });
    await ensureHumanRoleDefaultGrants(db, {
      companyId,
      principalId: userId,
      membershipRole: "owner",
      grantedByUserId: null,
    });
    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId, title: "Existing task", status: "todo", priority: "medium" });
    return { companyId, userId, issueId };
  }

  // The query the Tasks screen sends.
  const listQuery = { view: "compact", sortField: "updated", sortDir: "desc", limit: "50" };

  async function warmList(app: express.Express, companyId: string) {
    const first = await request(app).get(`/api/companies/${companyId}/issues`).query(listQuery);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.headers.etag).toBeTruthy();
    // Prove the next identical read would be served from the warm cache.
    const warm = await request(app).get(`/api/companies/${companyId}/issues`).query(listQuery)
      .set("If-None-Match", first.headers.etag);
    expect(warm.status).toBe(304);
    expect(warm.headers["x-paperclip-request-cache"]).toBe("hit");
    return first;
  }

  async function revalidate(app: express.Express, companyId: string, etag: string) {
    return request(app).get(`/api/companies/${companyId}/issues`).query(listQuery).set("If-None-Match", etag);
  }

  it("shows a newly created Task on the next list read instead of a cached 304", async () => {
    const { companyId } = await seedCompany();
    const app = createApp(companyId);
    const first = await warmList(app, companyId);

    const created = await request(app).post(`/api/companies/${companyId}/issues`)
      .send({ title: "Fresh task from the dialog", status: "todo", priority: "medium" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const after = await revalidate(app, companyId, first.headers.etag);
    expect(after.status).toBe(200);
    expect(after.headers["x-paperclip-request-cache"]).toBe("miss");
    expect(after.headers.etag).not.toBe(first.headers.etag);
    expect(after.body.map((row: { id: string }) => row.id)).toContain(created.body.id);
  });

  it("shows a Task update and assignment on the next list read", async () => {
    const { companyId, userId, issueId } = await seedCompany();
    const app = createApp(companyId);
    const first = await warmList(app, companyId);

    const updated = await request(app).patch(`/api/issues/${issueId}`)
      .send({ title: "Renamed task", assigneeUserId: userId });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);

    const after = await revalidate(app, companyId, first.headers.etag);
    expect(after.status).toBe(200);
    const row = after.body.find((item: { id: string }) => item.id === issueId);
    expect(row).toMatchObject({ title: "Renamed task", assigneeUserId: userId });
  });

  it("refreshes the list after a comment instead of a cached 304", async () => {
    const { companyId, issueId } = await seedCompany();
    const app = createApp(companyId);
    const first = await warmList(app, companyId);

    const comment = await request(app).post(`/api/issues/${issueId}/comments`).send({ body: "A new comment" });
    expect(comment.status, JSON.stringify(comment.body)).toBe(201);

    const after = await revalidate(app, companyId, first.headers.etag);
    expect(after.status).toBe(200);
    expect(after.headers["x-paperclip-request-cache"]).toBe("miss");
  });

  it("does not let a read that started after a write join an in-flight read from before it", async () => {
    const { companyId } = await seedCompany();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let computeCount = 0;
    const app = createApp(companyId, {
      issueListDiagnostics: {
        async onComputeStart() {
          computeCount += 1;
          if (computeCount === 1) await firstGate;
        },
      },
    });

    const slowRead = request(app).get(`/api/companies/${companyId}/issues`).query(listQuery).then((res) => res);
    while (computeCount === 0) await new Promise((resolve) => setTimeout(resolve, 5));

    const created = await request(app).post(`/api/companies/${companyId}/issues`)
      .send({ title: "Created during a slow read", status: "todo", priority: "medium" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const laterRead = request(app).get(`/api/companies/${companyId}/issues`).query(listQuery).then((res) => res);
    // With the guard the later read starts its own computation. Without it, it
    // joins the gated one; release the gate after a deadline so that case
    // fails on the assertions below instead of hanging.
    const deadline = Date.now() + 3_000;
    while (computeCount < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    releaseFirst();
    const [, later] = await Promise.all([slowRead, laterRead]);

    expect(later.status).toBe(200);
    expect(later.headers["x-paperclip-request-cache"]).toBe("miss");
    expect(later.body.map((row: { id: string }) => row.id)).toContain(created.body.id);
  });

  it("drops the cached list when a company live event announces a background change", async () => {
    const { companyId } = await seedCompany();
    const app = createApp(companyId);
    const first = await warmList(app, companyId);
    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId, title: "Written by a heartbeat", status: "todo", priority: "medium" });
    publishLiveEvent({ companyId, type: "activity.logged", payload: { entityType: "issue", entityId: issueId } });

    const after = await revalidate(app, companyId, first.headers.etag);
    expect(after.status).toBe(200);
    expect(after.body.map((row: { id: string }) => row.id)).toContain(issueId);
  });

  it("keeps serving identical reads from the cache while nothing is written", async () => {
    const { companyId } = await seedCompany();
    const app = createApp(companyId);
    const first = await warmList(app, companyId);
    const again = await revalidate(app, companyId, first.headers.etag);
    expect(again.status).toBe(304);
    expect(again.headers["x-paperclip-request-cache"]).toBe("hit");
  });
});
