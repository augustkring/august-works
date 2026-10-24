import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { authSessions, authUsers, companies, companyMemberships, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import type { AuthorizationActor } from "../services/authorization.js";
import * as authorization from "../services/authorization.js";
import { companyImportJobService } from "../services/company-import-jobs.js";
import { companyRoutes } from "../routes/companies.js";
import { errorHandler } from "../middleware/error-handler.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("company import job history route", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("company-import-job-history-");
    db = createDb(database.connectionString, { maxConnections: 6 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function seedUser(companyId: string, membershipRole = "owner") {
    const userId = `history-${randomUUID()}`, sessionId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Import history user", email: `${userId}@test.invalid`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole, status: "active" });
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60_000) });
    const actor: AuthorizationActor = { type: "board", source: "session", userId, sessionId,
      companyIds: [companyId], memberships: [{ companyId, membershipRole, status: "active" }], isInstanceAdmin: false };
    return { userId, sessionId, actor, actorKey: `board:${userId}` };
  }

  function app(actor: AuthorizationActor) {
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => { req.actor = actor; next(); });
    server.use("/api/companies", companyRoutes(db));
    server.use(errorHandler);
    return server;
  }

  async function admit(authority: Awaited<ReturnType<typeof seedUser>>, companyId: string, key: string) {
    return companyImportJobService(db).admit({ actorKey: authority.actorKey, userId: authority.userId,
      actorKind: "board", inputHash: createHash("sha256").update(key).digest("hex"), scopeKey: `company:${companyId}`,
      companyId, idempotencyKey: key }, authority.actor).then(result => result.job);
  }

  it("lists only the current original requester’s bounded company receipts and rechecks access", async () => {
    const companyId = randomUUID(), otherCompanyId = randomUUID();
    await db.insert(companies).values([
      { id: companyId, name: "History company", issuePrefix: `HI${companyId.slice(0, 6)}` },
      { id: otherCompanyId, name: "Other company", issuePrefix: `HO${otherCompanyId.slice(0, 6)}` },
    ]);
    const alice = await seedUser(companyId), bob = await seedUser(companyId);
    const aliceFirst = await admit(alice, companyId, "alice-first");
    await companyImportJobService(db).fail(aliceFirst, false);
    const aliceSecond = await admit(alice, companyId, "alice-second");
    await companyImportJobService(db).fail(aliceSecond, false);
    const aliceThird = await admit(alice, companyId, "alice-third");
    // PostgreSQL timestamps retain microseconds while ordinary JS Date
    // decoding does not. Put three real owner rows inside one millisecond.
    for (const [job, micros] of [[aliceFirst, "000001"], [aliceSecond, "000002"], [aliceThird, "000003"]] as const) {
      await db.execute(sql`update customer_operations set created_at=
        ('2026-01-01T00:00:00.' || ${micros} || 'Z')::timestamptz where id=${job.id}`);
    }
    const bobJob = await admit(bob, companyId, "bob-only");

    const first = await request(app(alice.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: alice.userId, limit: 1 }).expect(200);
    expect(first.body.jobs).toHaveLength(1);
    expect(first.body.jobs[0].job.id).toBe(aliceThird.id);
    expect(first.body.jobs[0]).toMatchObject({ job: { status: "running" }, operation: {
      id: first.body.jobs[0].job.id, operationType: "company_import", domain: "company_portability", attempt: 1,
    } });
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await request(app(alice.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: alice.userId, limit: 1, cursor: first.body.nextCursor }).expect(200);
    expect(second.body.jobs).toHaveLength(1);
    expect(second.body.jobs[0].job.id).toBe(aliceSecond.id);
    expect(second.body.jobs[0].job.id).not.toBe(first.body.jobs[0].job.id);
    expect(second.body.nextCursor).toEqual(expect.any(String));
    const third = await request(app(alice.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: alice.userId, limit: 1, cursor: second.body.nextCursor }).expect(200);
    expect(third.body.jobs.map((entry: { job: { id: string } }) => entry.job.id)).toEqual([aliceFirst.id]);
    expect(third.body.nextCursor).toBeNull();
    expect([first.body.jobs[0].job.id, second.body.jobs[0].job.id,
      ...third.body.jobs.map((entry: { job: { id: string } }) => entry.job.id)])
      .toEqual([aliceThird.id, aliceSecond.id, aliceFirst.id]);
    const alicePayload = JSON.stringify([first.body, second.body, third.body]);
    for (const secret of ["inputHash", "idempotencyKey", "attemptId", "requesterKeyHash", "scopeKey"])
      expect(alicePayload).not.toContain(secret);
    expect(alicePayload).not.toContain("alice-first");

    const bobList = await request(app(bob.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: bob.userId }).expect(200);
    expect(bobList.body.jobs.map((entry: { job: { id: string } }) => entry.job.id)).toEqual([bobJob.id]);
    await request(app(bob.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: bob.userId, cursor: first.body.nextCursor }).expect(200)
      .expect(response => expect(response.body.jobs.map((entry: { job: { id: string } }) => entry.job.id)).toEqual([]));
    await request(app(alice.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: alice.userId, cursor: Buffer.from(JSON.stringify({ createdAt: "2026-01-01T00:00:00.000001Z",
        id: "forged-cursor-id" })).toString("base64url") }).expect(400);
    await request(app(bob.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: alice.userId }).expect(409)
      .expect(response => expect(response.body.code).toBe("ACCOUNT_CHANGED"));
    await request(app(alice.actor)).get(`/api/companies/${otherCompanyId}/import/jobs`)
      .query({ expectedUserId: alice.userId }).expect(403);

    const realAuthorizationService = authorization.authorizationService;
    let companyChecks = 0;
    const withdrawalSpy = vi.spyOn(authorization, "authorizationService").mockImplementation(connection => {
      const native = realAuthorizationService(connection);
      return { ...native, decide: async input => {
        if (input.action === "company_scope:read" && ++companyChecks === 2) {
          await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, bob.userId)));
        }
        return native.decide(input);
      } };
    });
    try {
      await request(app(bob.actor)).get(`/api/companies/${companyId}/import/jobs`)
        .query({ expectedUserId: bob.userId }).expect(403);
      expect(companyChecks).toBe(2);
    } finally { withdrawalSpy.mockRestore(); }

    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, alice.userId)));
    await request(app(alice.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: alice.userId }).expect(403);
  }, 90_000);
});
