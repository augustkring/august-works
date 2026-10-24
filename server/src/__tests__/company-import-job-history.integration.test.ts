import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { authSessions, authUsers, companies, companyMemberships, createDb,
  customerOperations, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
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

  async function admitNewCompany(authority: Awaited<ReturnType<typeof seedUser>>, key: string) {
    return companyImportJobService(db).admit({ actorKey: authority.actorKey, userId: authority.userId,
      actorKind: "board", inputHash: createHash("sha256").update(key).digest("hex"), scopeKey: "new_company",
      companyId: null, idempotencyKey: key }, authority.actor).then(result => result.job);
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
    await companyImportJobService(db).fail(aliceThird, false);
    // PostgreSQL timestamps retain microseconds while ordinary JS Date
    // decoding does not. Put three real owner rows inside one millisecond.
    for (const [job, micros] of [[aliceFirst, "000001"], [aliceSecond, "000002"], [aliceThird, "000003"]] as const) {
      await db.execute(sql`update customer_operations set created_at=
        ('2026-01-01T00:00:00.' || ${micros} || 'Z')::timestamptz where id=${job.id}`);
    }
    const aliceForeign = await admit(alice, otherCompanyId, "alice-foreign-company");
    await companyImportJobService(db).fail(aliceForeign, false);
    const bobJob = await admit(bob, companyId, "bob-only");
    const aliceNew = await admitNewCompany(alice, "alice-new-company-unknown");

    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    await db.insert(customerOperations).values([
      { id: `import-${randomUUID()}`, operationType: "company_import", domain: "company_portability",
        requesterKeyHash: digest(alice.actorKey), requestedByUserId: alice.userId, scopeKey: `company:${companyId}`,
        idempotencyKey: digest("malformed-unbound-existing-key"), inputHash: digest("malformed-unbound-existing-input"),
        companyId: null, status: "needs_reconciliation", progressStage: "needs_reconciliation" },
      { id: `import-${randomUUID()}`, operationType: "company_import", domain: "company_portability",
        requesterKeyHash: digest(alice.actorKey), requestedByUserId: bob.userId, scopeKey: "new_company",
        idempotencyKey: digest("wrong-user-unbound-key"), inputHash: digest("wrong-user-unbound-input"),
        companyId: null, status: "needs_reconciliation", progressStage: "needs_reconciliation" },
    ]);

    const first = await request(app(alice.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: alice.userId, limit: 1 }).expect(200);
    expect(first.body.jobs).toHaveLength(1);
    expect(first.body.jobs[0].job.id).toBe(aliceNew.id);
    expect(first.body.jobs[0]).toMatchObject({ job: { status: "running",
      target: { mode: "new_company", result: "not_confirmed" } }, operation: {
      id: first.body.jobs[0].job.id, operationType: "company_import", domain: "company_portability", attempt: 1,
    } });
    expect(first.body.jobs[0].job).not.toHaveProperty("result");
    expect(first.body.jobs[0].job).not.toHaveProperty("fullResult");
    expect(first.body.jobs[0].job).not.toHaveProperty("companyId");
    await companyImportJobService(db).fail(aliceNew, true);
    const unknown = await request(app(alice.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: alice.userId, limit: 1 }).expect(200);
    expect(unknown.body.jobs[0].job).toMatchObject({ id: aliceNew.id, status: "needs_reconciliation",
      target: { mode: "new_company", result: "not_confirmed" } });
    expect(unknown.body.jobs[0].job).not.toHaveProperty("result");
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await request(app(alice.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: alice.userId, limit: 1, cursor: first.body.nextCursor }).expect(200);
    expect(second.body.jobs).toHaveLength(1);
    expect(second.body.jobs[0].job.id).toBe(aliceThird.id);
    expect(second.body.jobs[0].job.id).not.toBe(first.body.jobs[0].job.id);
    expect(second.body.nextCursor).toEqual(expect.any(String));
    const third = await request(app(alice.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: alice.userId, limit: 1, cursor: second.body.nextCursor }).expect(200);
    expect(third.body.jobs.map((entry: { job: { id: string } }) => entry.job.id)).toEqual([aliceSecond.id]);
    expect(third.body.nextCursor).toEqual(expect.any(String));
    const fourth = await request(app(alice.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: alice.userId, limit: 1, cursor: third.body.nextCursor }).expect(200);
    expect(fourth.body.jobs.map((entry: { job: { id: string } }) => entry.job.id)).toEqual([aliceFirst.id]);
    expect(fourth.body.nextCursor).toBeNull();
    expect([first.body.jobs[0].job.id, second.body.jobs[0].job.id,
      ...third.body.jobs.map((entry: { job: { id: string } }) => entry.job.id),
      ...fourth.body.jobs.map((entry: { job: { id: string } }) => entry.job.id)])
      .toEqual([aliceNew.id, aliceThird.id, aliceSecond.id, aliceFirst.id]);
    const alicePayload = JSON.stringify([first.body, second.body, third.body, fourth.body]);
    for (const secret of ["inputHash", "idempotencyKey", "attemptId", "requesterKeyHash", "scopeKey"])
      expect(alicePayload).not.toContain(secret);
    expect(alicePayload).not.toContain("alice-first");
    expect(alicePayload).not.toContain(aliceForeign.id);
    expect(alicePayload).not.toContain(otherCompanyId);

    const bobList = await request(app(bob.actor)).get(`/api/companies/${companyId}/import/jobs`)
      .query({ expectedUserId: bob.userId }).expect(200);
    expect(bobList.body.jobs.map((entry: { job: { id: string } }) => entry.job.id)).toEqual([bobJob.id]);
    expect(JSON.stringify(bobList.body)).not.toContain(aliceNew.id);
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
