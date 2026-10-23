import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accountDeletionOperations, authRateLimits, authUsers, boardApiKeys, companies, companyMemberships, agents, agentApiKeys, supportCaseDeletionMarkers,
  supportCaseEvents, supportCases, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
} from "@paperclipai/db";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { customerSupportRoutes } from "../routes/customer-support.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { eraseAccountAccess } from "../services/saas/account-deletion.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { eraseExpiredSupportCases } from "../services/experience/support-cases.js";
import { startEmbeddedPostgresTestDatabase, getEmbeddedPostgresTestSupport } from "./helpers/embedded-postgres.js";

const embedded = await getEmbeddedPostgresTestSupport();
const policy = {
  schemaVersion: 1 as const, policyVersion: "support-test-v1", recipientName: "Blentera Support",
  privacyNoticeUrl: "https://example.test/privacy", processingRegion: "eu",
  retentionTrigger: "after_last_customer_or_support_message" as const, retentionDays: 30,
  backupMaxDays: 7, restoreLagDays: 1, deletionMarkerDays: 30, legalHoldPolicyId: "support-test-v1",
};

(embedded.supported ? describe.sequential : describe.skip)("V10 authenticated support cases", () => {
  let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyA: string, companyB: string;
  const users = Object.fromEntries(["opener", "member", "owner", "admin", "foreign"].map(name => [name, randomUUID()])) as Record<string, string>;
  const tokens = Object.fromEntries(Object.keys(users).map(name => [name, `support-${randomUUID()}`])) as Record<string, string>;
  let app: express.Express;
  const path = (companyId: string) => `/api/companies/${companyId}/support`;
  const auth = (name: string) => ({ Authorization: `Bearer ${tokens[name]}` });
  const create = (companyId: string, name: string, description: string, key = randomUUID()) => request(app)
    .post(`${path(companyId)}/cases`).set(auth(name)).send({ idempotencyKey: key, expectedUserId: users[name], description });
  const list = (companyId: string, name: string) => request(app).get(`${path(companyId)}/cases`)
    .set(auth(name)).query({ expectedUserId: users[name] });
  const detail = (companyId: string, name: string, id: string) => request(app).get(`${path(companyId)}/cases/${id}`)
    .set(auth(name)).query({ expectedUserId: users[name] });

  beforeAll(async () => {
    fixture = await startEmbeddedPostgresTestDatabase("v10-support-cases-");
    db = createDb(fixture.connectionString, { maxConnections: 8 });
    await db.insert(authUsers).values(Object.entries(users).map(([name, id]) => ({
      id, name, email: `${name}-${id}@support.example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
    })));
    companyA = randomUUID(); companyB = randomUUID();
    await db.insert(companies).values([
      { id: companyA, name: "Support case company A", issuePrefix: "SUPA01" },
      { id: companyB, name: "Support case company B", issuePrefix: "SUPB01" },
    ]);
    await db.insert(companyMemberships).values([
      ...(["opener", "member", "owner", "admin"] as const).map(name => ({ companyId: companyA, principalType: "user" as const, principalId: users[name], status: "active", membershipRole: name === "owner" ? "owner" : name === "admin" ? "admin" : "member" })),
      { companyId: companyB, principalType: "user", principalId: users.foreign, status: "active", membershipRole: "member" },
    ]);
    await db.insert(boardApiKeys).values(Object.entries(users).map(([name, userId]) => ({
      id: randomUUID(), userId, name: "Native support test credential", keyHash: createHash("sha256").update(tokens[name]!).digest("hex"),
    })));
    await instanceSettingsService(db).updateExperimental({
      experience_projection_v9: true, progressive_shell_v9: true,
      saas_deployment_profile_v6: true, admin_support_v6: true,
    });
    app = express(); app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    app.use("/api", customerSupportRoutes(db, { runtimeEnv: { AW_SUPPORT_CASE_DATA_POLICY_JSON: JSON.stringify(policy) } }));
    app.use(errorHandler);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await fixture?.cleanup(); }, 30000);

  it("creates a local receipt with defaults and only the public customer projection", async () => {
    const live: { companyId: string; payload: Record<string, unknown> }[] = [];
    const unsubscribe = subscribeCompanyLiveEvents(companyA, event => { live.push(event); });
    let response: request.Response;
    try { response = await create(companyA, "opener", "Sign-in fails after I changed my email.\nMore detail."); }
    finally { unsubscribe(); }
    expect(live).toEqual([expect.objectContaining({ companyId: companyA,
      payload: expect.objectContaining({ action: "support.case_created", entityId: response.body.id }) })]);
    expect(JSON.stringify(live)).not.toContain("Sign-in fails");
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ companyId: companyA, openedByUserId: users.opener, category: "other", impact: null,
      subject: "Sign-in fails after I changed my email.", description: "Sign-in fails after I changed my email.\nMore detail.",
      status: "RECEIVED", delivery: "pending", timeline: [{ kind: "request", body: "Sign-in fails after I changed my email.\nMore detail.", delivery: "pending" }] });
    for (const privateField of ["dataPolicy", "legalHold", "holdReason", "providerCaseRef", "requestHash", "deliveryAttemptId", "deliveryProviderKey", "deliveryLeaseUntil"])
      expect(JSON.stringify(response.body)).not.toContain(privateField);
  });

  it("serializes concurrent create retries to one effect and rejects changed content on the same key", async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([create(companyA, "opener", "One request", key), create(companyA, "opener", "One request", key.toUpperCase())]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await db.select().from(supportCases).where(eq(supportCases.id, a.body.id))).toHaveLength(1);
    expect(await db.select().from(supportCaseEvents).where(and(eq(supportCaseEvents.caseId, a.body.id), eq(supportCaseEvents.requestKey, key)))).toHaveLength(1);
    expect((await create(companyA, "opener", "Changed request", key)).status).toBe(409);
  });

  it("limits member visibility to their own cases while current owner and admin can read company cases", async () => {
    const created = await create(companyA, "opener", "Private to opener");
    expect(created.status).toBe(201);
    expect((await detail(companyA, "opener", created.body.id)).status).toBe(200);
    expect((await list(companyA, "opener")).body.entries.map((row: { id: string }) => row.id)).toContain(created.body.id);
    expect((await list(companyA, "member")).body.entries.map((row: { id: string }) => row.id)).not.toContain(created.body.id);
    expect((await detail(companyA, "member", created.body.id)).status).toBe(404);
    expect((await detail(companyA, "owner", created.body.id)).status).toBe(200);
    expect((await detail(companyA, "admin", created.body.id)).status).toBe(200);
    const foreignCase = await create(companyB, "foreign", "Other company case");
    expect(foreignCase.status).toBe(201);
    expect((await detail(companyA, "owner", foreignCase.body.id)).status).toBe(404);
    expect((await detail(companyB, "foreign", foreignCase.body.id)).status).toBe(200);
    await db.update(companyMemberships).set({ membershipRole: "member" }).where(and(
      eq(companyMemberships.companyId, companyA), eq(companyMemberships.principalId, users.admin!),
    ));
    expect((await detail(companyA, "admin", created.body.id)).status).toBe(404);
  });

  it("turns a reply to RESOLVED into an investigation on the same case", async () => {
    const created = await create(companyA, "opener", "Still need help");
    await db.update(supportCases).set({ customerStatus: "RESOLVED", resolvedAt: new Date(), version: 1 }).where(eq(supportCases.id, created.body.id));
    const key = randomUUID();
    const reply = await request(app).post(`${path(companyA)}/cases/${created.body.id}/replies`).set(auth("opener"))
      .send({ idempotencyKey: key, expectedUserId: users.opener, body: "The issue is still happening." });
    expect(reply.status).toBe(201);
    expect(reply.body.id).toBe(created.body.id);
    expect(reply.body.status).toBe("INVESTIGATING");
    expect(reply.body.timeline.at(-1)).toMatchObject({ kind: "customer_reply", body: "The issue is still happening.", status: "INVESTIGATING" });
  });

  it("starts a reply-derived follow-up from CLOSED and makes repeated replies idempotent", async () => {
    const created = await create(companyA, "opener", "First problem");
    await db.update(supportCases).set({ customerStatus: "CLOSED", closedAt: new Date(), version: 1 }).where(eq(supportCases.id, created.body.id));
    const key = randomUUID(), body = "A new issue started after the previous case closed.";
    const send = () => request(app).post(`${path(companyA)}/cases/${created.body.id}/replies`).set(auth("opener"))
      .send({ idempotencyKey: key, expectedUserId: users.opener, body });
    const first = await send(), repeated = await send();
    expect(first.status).toBe(201); expect(repeated.status).toBe(201);
    expect(first.body.id).not.toBe(created.body.id);
    expect(repeated.body.id).toBe(first.body.id);
    expect(first.body).toMatchObject({ followUpOfId: created.body.id, subject: body, description: body, status: "RECEIVED" });
    expect(await db.select().from(supportCases).where(eq(supportCases.followUpOfId, created.body.id))).toHaveLength(1);
  });

  it("blocks new intake without operator policy while preserving receipts and separately gated approval history", async () => {
    const noPolicy = express(); noPolicy.use(express.json()); noPolicy.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    let historyError: unknown;
    noPolicy.use("/api", customerSupportRoutes(db, { runtimeEnv: {} }));
    noPolicy.use((error: unknown, req: express.Request, _res: express.Response, next: express.NextFunction) => {
      if (req.path.includes("/experience/support-access")) historyError = error;
      next(error);
    });
    noPolicy.use(errorHandler);
    const policyResponse = await request(noPolicy).get(`${path(companyA)}/policy`).set(auth("opener")).query({ expectedUserId: users.opener });
    expect(policyResponse.body).toEqual({ available: false });
    const denied = await request(noPolicy).post(`${path(companyA)}/cases`).set(auth("opener"))
      .send({ idempotencyKey: randomUUID(), expectedUserId: users.opener, description: "I need help" });
    expect(denied.status).toBe(422);
    expect(denied.body.details).toMatchObject({ code: "SUPPORT_INTAKE_UNAVAILABLE" });
    const key = randomUUID(), receipt = await create(companyA, "opener", "Recover my already committed request", key);
    expect(receipt.status).toBe(201);
    const recovered = await request(noPolicy).get(`${path(companyA)}/cases/requests/${key}`).set(auth("opener"))
      .query({ expectedUserId: users.opener });
    expect(recovered.status).toBe(200);
    expect(recovered.body.id).toBe(receipt.body.id);
    // Original V6 approval history retains its own actual feature/owner gates;
    // this is not a human-contact or privileged-access grant.
    const history = await request(noPolicy).get(`/api/companies/${companyA}/experience/support-access`).set(auth("owner"))
      .query({ expectedUserId: users.owner });
    expect(history.status, String((historyError as { cause?: unknown } | undefined)?.cause ?? historyError)).toBe(200);
  });

  it("hides pending-deletion principals and expired content from ordinary reads", async () => {
    const pending = await create(companyA, "member", "Account is being erased");
    const prefix = "support-case:" + createHash("sha256").update(JSON.stringify(users.member)).digest("hex") + ":";
    expect((await db.select().from(authRateLimits)).some(row => row.key.startsWith(prefix))).toBe(true);
    await db.update(supportCases).set({ legalHold: true, holdReason: "Account erasure fixture hold" }).where(eq(supportCases.id, pending.body.id));
    await db.insert(accountDeletionOperations).values({ userId: users.member!, idempotencyKey: randomUUID() });
    await db.transaction(tx => eraseAccountAccess(tx, users.member!));
    expect((await db.select().from(authRateLimits)).some(row => row.key.startsWith(prefix))).toBe(false);
    expect(await db.select().from(supportCases).where(eq(supportCases.id, pending.body.id))).toHaveLength(1);
    expect((await list(companyA, "owner")).body.entries.map((row: { id: string }) => row.id)).not.toContain(pending.body.id);
    expect((await detail(companyA, "owner", pending.body.id)).status).toBe(404);
    expect((await list(companyA, "member")).status).toBe(401);

    const expired = await create(companyA, "opener", "Expired support content");
    expect(expired.status).toBe(201);
    const expiredId = expired.body.id;
    await db.update(supportCases).set({ expiresAt: new Date(Date.now() + 100) }).where(eq(supportCases.id, expiredId));
    await db.execute(sql`select pg_sleep(0.15)`);
    expect((await list(companyA, "owner")).body.entries.map((row: { id: string }) => row.id)).not.toContain(expiredId);
    expect((await detail(companyA, "owner", expiredId)).status).toBe(404);
  });
  it("refuses actual Agent and local implicit authority and stale account targets", async () => {
    const agentId = randomUUID(), token = randomUUID();
    await db.insert(agents).values({ id: agentId, companyId: companyA, name: "Support fixture Agent", role: "engineer", status: "idle", adapterType: "process" });
    await db.insert(agentApiKeys).values({ companyId: companyA, agentId, name: "Actual Agent key", responsibleUserId: users.opener,
      keyHash: createHash("sha256").update(token).digest("hex") });
    expect((await request(app).get(`${path(companyA)}/cases`).set("Authorization", `Bearer ${token}`)
      .query({ expectedUserId: users.opener })).status).toBe(403);
    const local = express(); local.use(actorMiddleware(db, { deploymentMode: "local_trusted" }));
    local.use("/api", customerSupportRoutes(db, { runtimeEnv: {} })); local.use(errorHandler);
    expect((await request(local).get(`${path(companyA)}/cases`).query({ expectedUserId: users.opener })).status).toBe(403);
    expect((await request(app).get(`${path(companyA)}/cases`).set(auth("opener"))
      .query({ expectedUserId: users.owner })).status).toBe(409);
  });
  it("erases expired local content but preserves held and uncertain delivery without false completion", async () => {
    const clean = await create(companyA, "opener", "Remove this expired local case");
    const held = await create(companyA, "opener", "Keep this held case");
    const unknown = await create(companyB, "foreign", "Keep this uncertain provider case");
    for (const response of [clean, held, unknown]) expect(response.status).toBe(201);
    await db.update(supportCases).set({ legalHold: true, holdReason: "Native test hold" }).where(eq(supportCases.id, held.body.id));
    // Simulated transport uncertainty exercises erasure fencing only; no
    // provider request is sent and no delivery qualification follows.
    await db.update(supportCaseEvents).set({ deliveryState: "unknown" }).where(eq(supportCaseEvents.caseId, unknown.body.id));
    for (const response of [clean, held, unknown]) await db.update(supportCases).set({ expiresAt: new Date(Date.now() + 100) })
      .where(eq(supportCases.id, response.body.id));
    await db.execute(sql`select pg_sleep(0.15)`);
    const result = await eraseExpiredSupportCases(db);
    expect(result.erasedCases).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(supportCases).where(eq(supportCases.id, clean.body.id))).toEqual([]);
    expect(await db.select().from(supportCaseDeletionMarkers).where(eq(supportCaseDeletionMarkers.caseId, clean.body.id))).toHaveLength(2);
    for (const id of [held.body.id, unknown.body.id]) {
      expect(await db.select().from(supportCases).where(eq(supportCases.id, id))).toHaveLength(1);
      expect(await db.select().from(supportCaseDeletionMarkers).where(eq(supportCaseDeletionMarkers.caseId, id))).toEqual([]);
    }
  });

  it("fences replay of an erased native request without blacklisting another person's scoped key", async () => {
    const key = randomUUID(), created = await create(companyA, "opener", "Erase this canonical receipt", key);
    expect(created.status).toBe(201);
    await db.update(supportCases).set({ expiresAt: new Date(Date.now() + 100) }).where(eq(supportCases.id, created.body.id));
    await db.execute(sql`select pg_sleep(0.15)`);
    await eraseExpiredSupportCases(db);
    expect(await db.select().from(supportCases).where(eq(supportCases.id, created.body.id))).toEqual([]);
    const replay = await create(companyA, "opener", "Erase this canonical receipt", key);
    expect(replay.status).toBe(404);
    expect(replay.body.details).toMatchObject({ code: "SUPPORT_REQUEST_ERASED" });
    expect(await db.select().from(supportCaseEvents).where(and(eq(supportCaseEvents.companyId, companyA),
      eq(supportCaseEvents.authorUserId, users.opener!), eq(supportCaseEvents.requestKey, key)))).toEqual([]);
    const separate = await create(companyA, "owner", "A different person's explicit request", key);
    expect(separate.status).toBe(201);
    expect(separate.body.id).not.toBe(created.body.id);
  });

  it("refuses unstoreable private text before driver errors and accepts complete Unicode characters", async () => {
    for (const value of ["private-canary-zero\u0000tail", "private-canary-surrogate\uD800tail"]) {
      const response = await create(companyA, "opener", value);
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain("private-canary");
    }
    const valid = await create(companyA, "opener", "Valid Unicode 😀");
    expect(valid.status).toBe(201);
    const invalidReply = await request(app).post(`${path(companyA)}/cases/${valid.body.id}/replies`).set(auth("opener"))
      .send({ idempotencyKey: randomUUID(), expectedUserId: users.opener, body: "private-canary-reply\u0000tail" });
    expect(invalidReply.status).toBe(400);
    expect(JSON.stringify(invalidReply.body)).not.toContain("private-canary");
    expect(await db.select().from(supportCaseEvents).where(eq(supportCaseEvents.caseId, valid.body.id))).toHaveLength(1);
  });

});
