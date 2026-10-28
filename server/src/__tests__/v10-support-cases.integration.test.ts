import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountDeletionOperations, authRateLimits, authUsers, boardApiKeys, companies, companyMemberships, agents, agentApiKeys, supportCaseDeletionMarkers,
  supportCaseEvents, supportCases, supportCaseIssueLinks, issues, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
} from "@paperclipai/db";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { customerSupportRoutes } from "../routes/customer-support.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { eraseAccountAccess } from "../services/saas/account-deletion.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { companyPortabilityService } from "../services/company-portability.js";
import { customerSupportCaseService, eraseExpiredSupportCases } from "../services/experience/support-cases.js";
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
  let policyRevision: string;
  const failureCodes: string[][] = [];
  const path = (companyId: string) => `/api/companies/${companyId}/support`;
  const auth = (name: string) => ({ Authorization: `Bearer ${tokens[name]}` });
  const create = (companyId: string, name: string, description: string, key = randomUUID()) => request(app)
    .post(`${path(companyId)}/cases`).set(auth(name)).send({ expectedPolicyRevision: policyRevision, idempotencyKey: key, expectedUserId: users[name], description });
  const list = (companyId: string, name: string) => request(app).get(`${path(companyId)}/cases`)
    .set(auth(name)).query({ expectedUserId: users[name] });
  const detail = (companyId: string, name: string, id: string) => request(app).get(`${path(companyId)}/cases/${id}`)
    .set(auth(name)).query({ expectedUserId: users[name] });
  const closeCase = (companyId: string, name: string, id: string, key = randomUUID()) => request(app)
    .post(`${path(companyId)}/cases/${id}/close`).set(auth(name)).send({ idempotencyKey: key, expectedUserId: users[name] });

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
    app.use((error: unknown, _req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const codes: string[] = [];
      for (let depth = 0, cause = error; depth < 8 && cause && typeof cause === "object"; depth++, cause = (cause as { cause?: unknown }).cause) {
        const code = (cause as { code?: unknown }).code;
        if (typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code)) codes.push(code);
        const constraint = (cause as { constraint_name?: unknown; constraint?: unknown }).constraint_name ?? (cause as { constraint?: unknown }).constraint;
        if (typeof constraint === "string" && ["auth_rate_limits_pkey", "support_case_events_pkey", "support_case_events_request_idx", "support_cases_pkey"].includes(constraint)) codes.push(constraint);
      }
      failureCodes.push(codes);
      next(error);
    });
    app.use(errorHandler);
    const disclosure = await request(app).get(`${path(companyA)}/policy`).set(auth("opener"))
      .query({ expectedUserId: users.opener }).expect(200);
    policyRevision = disclosure.body.revision;
    expect(policyRevision).toMatch(/^[a-f0-9]{64}$/);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  beforeEach(async () => { failureCodes.length = 0; await db.delete(authRateLimits); });
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

  it.each([
    { recipientName: "A different support recipient" },
    { privacyNoticeUrl: "https://example.test/new-privacy" },
    { retentionDays: 60 },
    { processingRegion: "another-region" },
  ])("requires a fresh disclosure after processing changes, even with the same version: %j", async (change) => {
    const changedApp = express(); changedApp.use(express.json());
    changedApp.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    changedApp.use("/api", customerSupportRoutes(db, { runtimeEnv: {
      AW_SUPPORT_CASE_DATA_POLICY_JSON: JSON.stringify({ ...policy, ...change }),
    } }));
    changedApp.use(errorHandler);
    const key = randomUUID(), command = { expectedUserId: users.opener, expectedPolicyRevision: policyRevision,
      idempotencyKey: key, description: "Do not silently change my support processing" };
    const original = await request(app).post(`${path(companyA)}/cases`).set(auth("opener")).send(command).expect(201);
    // A durable receipt remains recoverable; configuration changes do not
    // reinterpret the immutable original request or send it to another recipient.
    const repeated = await request(changedApp).post(`${path(companyA)}/cases`).set(auth("opener")).send(command).expect(201);
    expect(repeated.body.id).toBe(original.body.id);
    const newKey = randomUUID();
    const stale = await request(changedApp).post(`${path(companyA)}/cases`).set(auth("opener"))
      .send({ ...command, idempotencyKey: newKey }).expect(409);
    expect(stale.body.details.code).toBe("SUPPORT_POLICY_CHANGED");
    expect(await db.select().from(supportCaseEvents).where(eq(supportCaseEvents.requestKey, newKey))).toEqual([]);
    const disclosed = await request(changedApp).get(`${path(companyA)}/policy`).set(auth("opener"))
      .query({ expectedUserId: users.opener }).expect(200);
    expect(disclosed.body.revision).not.toBe(policyRevision);
    const accepted = await request(changedApp).post(`${path(companyA)}/cases`).set(auth("opener"))
      .send({ ...command, idempotencyKey: newKey, expectedPolicyRevision: disclosed.body.revision }).expect(201);
    const [stored] = await db.select().from(supportCases).where(eq(supportCases.id, accepted.body.id));
    expect(stored!.dataPolicy).toEqual({ ...policy, ...change });
    const replyKey = randomUUID(), reply = { expectedUserId: users.opener, idempotencyKey: replyKey, body: "Keep this reply under its disclosed policy" };
    const staleReply = await request(changedApp).post(`${path(companyA)}/cases/${original.body.id}/replies`).set(auth("opener"))
      .send({ ...reply, expectedPolicyRevision: policyRevision }).expect(409);
    expect(staleReply.body.details.code).toBe("SUPPORT_POLICY_CHANGED");
    const changedCase = await request(changedApp).post(`${path(companyA)}/cases/${original.body.id}/replies`).set(auth("opener"))
      .send({ ...reply, expectedPolicyRevision: disclosed.body.revision }).expect(409);
    expect(changedCase.body.details.code).toBe("SUPPORT_CASE_POLICY_CHANGED");
    expect(await db.select().from(supportCaseEvents).where(eq(supportCaseEvents.requestKey, replyKey))).toEqual([]);
    expect((await detail(companyA, "opener", original.body.id)).body.timeline).toHaveLength(1);
  });

  it("exports only current visible cases with every timeline page and no private operation facts", async () => {
    const own = await create(companyA, "opener", "Export-visible customer canary");
    const other = await create(companyA, "member", "Other-member export canary");
    const foreign = await create(companyB, "foreign", "Foreign-company export canary");
    for (const response of [own, other, foreign]) expect(response.status, JSON.stringify(response.body)).toBe(201);
    const exportIssueId = randomUUID();
    await db.insert(issues).values({ id: exportIssueId, companyId: companyA, title: "Export-safe issue reference",
      identifier: "SUPA01-44", visibility: "open" });
    await request(app).post(`${path(companyA)}/cases/${own.body.id}/issue-links`).set(auth("opener"))
      .send({ expectedUserId: users.opener, issueRef: "SUPA01-44" }).expect(201);
    await db.insert(supportCaseEvents).values(Array.from({ length: 55 }, (_, index) => ({
      companyId: companyA, caseId: own.body.id, authorUserId: users.opener!, kind: "customer_reply" as const,
      body: `Historical response ${index}`, customerStatus: "RECEIVED" as const,
      requestKey: randomUUID(), requestHash: createHash("sha256").update(`fixture-${index}`).digest("hex"),
      createdAt: new Date(Date.now() + index),
    })));
    await db.update(supportCases).set({ legalHold: true, holdReason: "Private hold canary", providerCaseRef: "Private provider canary" })
      .where(eq(supportCases.id, own.body.id));
    const actor = async (name: string) => {
      const [key] = await db.select().from(boardApiKeys).where(eq(boardApiKeys.userId, users[name]!));
      return { type: "board" as const, source: "board_key" as const, userId: users[name]!, keyId: key!.id, authenticatedKeyHash: key!.keyHash };
    };
    const service = customerSupportCaseService(db, { dataPolicy: null });
    const exportEvents: { payload: Record<string, unknown> }[] = [];
    const unsubscribe = subscribeCompanyLiveEvents(companyA, event => exportEvents.push(event));
    const mine = await service.withExport(await actor("opener"), companyA, users.opener!, async (tx, archive) => {
      const [physical] = await tx.execute<{ id: number; transaction: string }>(sql`select pg_backend_pid() as id,pg_current_xact_id()::text as transaction`);
      expect(physical?.id).toBeGreaterThan(0);
      expect(physical?.transaction).toMatch(/^\d+$/);
      await expect(db.transaction(async otherTx => {
        await otherTx.execute(sql`select id from companies where id=${companyA}::uuid for update nowait`);
      })).rejects.toBeTruthy();
      return archive;
    }).finally(unsubscribe);
    expect(exportEvents).toEqual([expect.objectContaining({ payload: expect.objectContaining({
      action: "support.cases_exported", entityType: "company", entityId: companyA, details: null,
    }) })]);
    expect(mine.cases.map(row => row.id)).toContain(own.body.id);
    expect(mine.cases.map(row => row.id)).not.toContain(other.body.id);
    expect(mine.cases.find(row => row.id === own.body.id)?.timeline).toHaveLength(56);
    expect(mine.cases.find(row => row.id === own.body.id)?.nextCursor).toBeNull();
    expect(mine.contentSha256).toBe(createHash("sha256").update(JSON.stringify(mine.cases)).digest("hex"));
    for (const canary of ["Private hold canary", "Private provider canary", "requestHash", "dataPolicy", "deliveryAttemptId", "Foreign-company export canary", "Other-member export canary"])
      expect(JSON.stringify(mine)).not.toContain(canary);
    const input = { include: { company: false, agents: false, projects: false, issues: false, skills: false }, expectedUserId: users.owner! };
    const portability = companyPortabilityService(db);
    const ordinary = await portability.exportBundle(companyA, input, { actor: await actor("owner") });
    expect(ordinary.files).not.toHaveProperty("blentera-support-cases-v1.json");
    const exported = await portability.exportBundle(companyA, { ...input, include: { ...input.include, supportCases: true } }, { actor: await actor("owner") });
    expect(exported.manifest.includes.supportCases).toBe(true);
    const archive = JSON.parse(exported.files["blentera-support-cases-v1.json"] as string);
    expect(archive.cases.map((row: { id: string }) => row.id)).toEqual(expect.arrayContaining([own.body.id, other.body.id]));
    expect(archive.cases.find((row: { id: string }) => row.id === own.body.id).relatedIssue)
      .toEqual({ id: exportIssueId, identifier: "SUPA01-44" });
    expect(JSON.stringify(archive)).not.toContain("Foreign-company export canary");
    const deselected = await portability.exportBundle(companyA, { ...input, include: { ...input.include, supportCases: true }, selectedFiles: [] }, { actor: await actor("owner") });
    expect(deselected.files).not.toHaveProperty("blentera-support-cases-v1.json");
    expect(deselected.manifest.includes.supportCases).toBe(false);
  });

  it("rechecks support expiry after export construction instead of returning a stale archive", async () => {
    const created = await create(companyA, "opener", "Expires while another export domain is assembled");
    expect(created.status).toBe(201);
    const [key] = await db.select().from(boardApiKeys).where(eq(boardApiKeys.userId, users.opener!));
    const actor = { type: "board" as const, source: "board_key" as const, userId: users.opener!, keyId: key!.id, authenticatedKeyHash: key!.keyHash };
    await db.update(supportCases).set({ expiresAt: new Date(Date.now() + 2000) }).where(eq(supportCases.id, created.body.id));
    await expect(customerSupportCaseService(db, { dataPolicy: null }).withExport(actor, companyA, users.opener!, async (tx, archive) => {
      expect(archive.cases.map(row => row.id)).toContain(created.body.id);
      await tx.execute(sql`select pg_sleep(2.1)`);
      return archive;
    })).rejects.toMatchObject({ status: 404 });
  });

  it.each(Array.from({ length: 32 }, (_, index) => index))("serializes concurrent create retries to one effect and rejects changed content on the same key (%i)", async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([create(companyA, "opener", "One request", key), create(companyA, "opener", "One request", key.toUpperCase())]);
    expect([a.status, b.status], JSON.stringify(failureCodes)).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await db.select().from(supportCases).where(eq(supportCases.id, a.body.id))).toHaveLength(1);
    expect(await db.select().from(supportCaseEvents).where(and(eq(supportCaseEvents.caseId, a.body.id), eq(supportCaseEvents.requestKey, key)))).toHaveLength(1);
    expect((await create(companyA, "opener", "Changed request", key)).status).toBe(409);
    const budgets = await db.select().from(authRateLimits);
    expect(budgets).toHaveLength(1);
    expect(budgets[0]!.count).toBe(3);
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

  it("links a visible support case to a current readable Issue without copying private text", async () => {
    const privateText = "Private support body stays in the support owner";
    const created = await create(companyA, "opener", privateText);
    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId: companyA, title: "Investigate sign-in failures",
      identifier: "SUPA01-42", visibility: "open", description: "Human-authored investigation and root-cause notes" });
    const link = await request(app).post(`${path(companyA)}/cases/${created.body.id}/issue-links`).set(auth("opener"))
      .send({ expectedUserId: users.opener, issueRef: "SUPA01-42" });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    expect(link.body).toEqual({ companyId: companyA, caseId: created.body.id,
      issue: { id: issueId, identifier: "SUPA01-42" } });
    const linkedCase = await detail(companyA, "opener", created.body.id);
    expect(linkedCase.body.relatedIssue).toEqual({ id: issueId, identifier: "SUPA01-42" });

    const secondPrivateText = "A separate customer report of the same sign-in failure";
    const secondCase = await create(companyA, "member", secondPrivateText);
    const secondLink = await request(app).post(`${path(companyA)}/cases/${secondCase.body.id}/issue-links`).set(auth("member"))
      .send({ expectedUserId: users.member, issueRef: "SUPA01-42" });
    expect(secondLink.status, JSON.stringify(secondLink.body)).toBe(201);
    expect(secondLink.body).toMatchObject({ caseId: secondCase.body.id, issue: { id: issueId, identifier: "SUPA01-42" } });
    expect((await detail(companyA, "member", secondCase.body.id)).body.relatedIssue).toEqual({ id: issueId, identifier: "SUPA01-42" });

    const groupedCases = await db.select().from(supportCaseIssueLinks).where(eq(supportCaseIssueLinks.issueId, issueId));
    expect(groupedCases.map(row => row.caseId).sort()).toEqual([created.body.id, secondCase.body.id].sort());
    expect(JSON.stringify(groupedCases)).not.toContain(privateText);
    expect(JSON.stringify(groupedCases)).not.toContain(secondPrivateText);
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue!.description).toBe("Human-authored investigation and root-cause notes");
    expect((await request(app).post(`${path(companyA)}/cases/${created.body.id}/issue-links`).set(auth("member"))
      .send({ expectedUserId: users.member, issueRef: "SUPA01-42" })).status).toBe(404);
    expect((await request(app).post(`${path(companyA)}/cases/${created.body.id}/issue-links`).set(auth("opener"))
      .send({ expectedUserId: users.opener, issueRef: "SUPB01-999" })).status).toBe(404);
    const [caseBeforeExpiry] = await db.select({ lastMessageAt: supportCases.lastMessageAt }).from(supportCases)
      .where(eq(supportCases.id, created.body.id));
    await db.update(supportCases).set({ expiresAt: new Date(caseBeforeExpiry!.lastMessageAt.getTime() + 100) })
      .where(eq(supportCases.id, created.body.id));
    await db.execute(sql`select pg_sleep(0.15)`);
    await eraseExpiredSupportCases(db);
    expect(await db.select().from(supportCases).where(eq(supportCases.id, created.body.id))).toEqual([]);
    expect(await db.select().from(supportCaseIssueLinks).where(eq(supportCaseIssueLinks.caseId, created.body.id))).toEqual([]);
  });

  it("turns a reply to RESOLVED into an investigation on the same case", async () => {
    const created = await create(companyA, "opener", "Still need help");
    await db.update(supportCases).set({ customerStatus: "RESOLVED", resolvedAt: new Date(), version: 1 }).where(eq(supportCases.id, created.body.id));
    const key = randomUUID();
    const reply = await request(app).post(`${path(companyA)}/cases/${created.body.id}/replies`).set(auth("opener"))
      .send({ expectedPolicyRevision: policyRevision, idempotencyKey: key, expectedUserId: users.opener, body: "The issue is still happening." });
    expect(reply.status).toBe(201);
    expect(reply.body.id).toBe(created.body.id);
    expect(reply.body.status).toBe("INVESTIGATING");
    expect(reply.body.timeline.at(-1)).toMatchObject({ kind: "customer_reply", body: "The issue is still happening.", status: "INVESTIGATING" });
  });

  it("closes through an idempotent customer command and preserves the closed message", async () => {
    const created = await create(companyA, "opener", "Please close this case when resolved.");
    expect(created.status).toBe(201);
    expect((await closeCase(companyA, "member", created.body.id)).status).toBe(404);
    const foreign = await create(companyB, "foreign", "Foreign case");
    expect(foreign.status).toBe(201);
    expect((await closeCase(companyA, "owner", foreign.body.id)).status).toBe(404);

    const key = randomUUID();
    const [first, repeated] = await Promise.all([
      closeCase(companyA, "owner", created.body.id, key), closeCase(companyA, "owner", created.body.id, key),
    ]);
    expect(first.status).toBe(200); expect(repeated.status).toBe(200);
    expect(first.body.id).toBe(created.body.id); expect(repeated.body.id).toBe(created.body.id);
    expect(first.body.status).toBe("CLOSED");
    const [before] = await db.select().from(supportCases).where(eq(supportCases.id, created.body.id));
    const anotherClose = await closeCase(companyA, "owner", created.body.id);
    expect(anotherClose.status).toBe(200);
    const [after] = await db.select().from(supportCases).where(eq(supportCases.id, created.body.id));
    expect(after!.version).toBe(before!.version);
    expect(after!.expiresAt).toEqual(before!.expiresAt);
    expect(anotherClose.body.timeline).toHaveLength(first.body.timeline.length);
    expect(first.body.timeline.at(-1)).toMatchObject({ kind: "customer_reply", body: "I asked to close this support case.", status: "CLOSED", author: "customer", delivery: "pending" });
    expect(await db.select().from(supportCaseEvents).where(and(
      eq(supportCaseEvents.caseId, created.body.id), eq(supportCaseEvents.requestKey, key),
    ))).toHaveLength(1);
  });

  it("keeps closed history and routes a later customer reply to a linked follow-up", async () => {
    const created = await create(companyA, "opener", "Original case history stays intact.");
    await db.update(authUsers).set({ locale: "da" }).where(eq(authUsers.id, users.opener));
    const closed = await closeCase(companyA, "opener", created.body.id);
    await db.update(authUsers).set({ locale: null }).where(eq(authUsers.id, users.opener));
    expect(closed.status).toBe(200);
    const replyKey = randomUUID(), body = "This is a new problem after closure.";
    const response = await request(app).post(`${path(companyA)}/cases/${created.body.id}/replies`).set(auth("opener"))
      .send({ expectedPolicyRevision: policyRevision, idempotencyKey: replyKey, expectedUserId: users.opener, body });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ followUpOfId: created.body.id, subject: body, description: body, status: "RECEIVED" });
    const original = await detail(companyA, "opener", created.body.id);
    expect(original.status).toBe(200);
    expect(original.body.status).toBe("CLOSED");
    expect(original.body.timeline.map((event: { body: string }) => event.body)).toContain("Jeg har bedt om at få denne supportsag afsluttet.");
    expect(await db.select().from(supportCaseEvents).where(and(
      eq(supportCaseEvents.caseId, created.body.id), eq(supportCaseEvents.requestKey, replyKey),
    ))).toEqual([]);
  });

  it("permits local closure under its original policy while new intake is unavailable", async () => {
    const created = await create(companyA, "opener", "Close without changing the original recipient.");
    const unavailable = express(); unavailable.use(express.json());
    unavailable.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    unavailable.use("/api", customerSupportRoutes(db, { runtimeEnv: {} }));
    unavailable.use(errorHandler);
    const response = await request(unavailable).post(`${path(companyA)}/cases/${created.body.id}/close`).set(auth("opener"))
      .send({ expectedUserId: users.opener, idempotencyKey: randomUUID() });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("CLOSED");
    const [row] = await db.select().from(supportCases).where(eq(supportCases.id, created.body.id));
    expect(row!.dataPolicy).toEqual(policy);
  });

  it("shares the actual database request budget across route reconstruction", async () => {
    const key = randomUUID(), description = "A repeated command still consumes the actual budget.";
    const created = await create(companyA, "opener", description, key);
    expect(created.status).toBe(201);
    for (let index = 1; index < 20; index++) expect((await create(companyA, "opener", description, key)).status).toBe(201);
    const restarted = express(); restarted.use(express.json());
    restarted.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    restarted.use("/api", customerSupportRoutes(db, { runtimeEnv: { AW_SUPPORT_CASE_DATA_POLICY_JSON: JSON.stringify(policy) } }));
    restarted.use(errorHandler);
    const retry = () => request(restarted).post(`${path(companyA)}/cases`).set(auth("opener"))
      .send({ expectedPolicyRevision: policyRevision, expectedUserId: users.opener, idempotencyKey: key, description });
    expect((await retry()).status).toBe(429);
    expect((await detail(companyA, "opener", created.body.id)).status).toBe(200);
    await db.update(authRateLimits).set({ lastRequest: Date.now() - 600001 });
    expect((await retry()).status).toBe(201);
    expect(await db.select().from(supportCaseEvents).where(eq(supportCaseEvents.requestKey, key))).toHaveLength(1);
  });

  it("retains one quota window when another application clock is an hour ahead", async () => {
    const key = randomUUID(), body = "The original request keeps its database quota window";
    expect((await create(companyA, "opener", body, key)).status).toBe(201);
    const at = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(at + 3600000);
    try {
      expect((await create(companyA, "opener", body, key)).status).toBe(201);
    } finally { clock.mockRestore(); }
    const rows = await db.select().from(authRateLimits);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(2);
    expect(rows[0]!.lastRequest).toBeLessThan(at + 60000);
  });

  it("starts a reply-derived follow-up from CLOSED and makes repeated replies idempotent", async () => {
    const created = await create(companyA, "opener", "First problem");
    await db.update(supportCases).set({ customerStatus: "CLOSED", closedAt: new Date(), version: 1 }).where(eq(supportCases.id, created.body.id));
    const key = randomUUID(), body = "A new issue started after the previous case closed.";
    const send = () => request(app).post(`${path(companyA)}/cases/${created.body.id}/replies`).set(auth("opener"))
      .send({ expectedPolicyRevision: policyRevision, idempotencyKey: key, expectedUserId: users.opener, body });
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
      .send({ expectedPolicyRevision: policyRevision, idempotencyKey: randomUUID(), expectedUserId: users.opener, description: "I need help" });
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
    const linkedIssueId = randomUUID();
    await db.insert(issues).values({ id: linkedIssueId, companyId: companyA, title: "Review deletion-hold support case",
      identifier: "SUPA01-43", visibility: "open" });
    const linkedPending = await request(app).post(`${path(companyA)}/cases/${pending.body.id}/issue-links`).set(auth("member"))
      .send({ expectedUserId: users.member, issueRef: "SUPA01-43" });
    expect(linkedPending.status, JSON.stringify(linkedPending.body)).toBe(201);
    const prefix = "support-case:" + createHash("sha256").update(JSON.stringify(users.member)).digest("hex") + ":";
    expect((await db.select().from(authRateLimits)).some(row => row.key.startsWith(prefix))).toBe(true);
    await db.update(supportCases).set({ legalHold: true, holdReason: "Account erasure fixture hold" }).where(eq(supportCases.id, pending.body.id));
    await db.insert(accountDeletionOperations).values({ userId: users.member!, idempotencyKey: randomUUID() });
    await db.transaction(tx => eraseAccountAccess(tx, users.member!));
    expect(await db.select().from(supportCaseIssueLinks).where(eq(supportCaseIssueLinks.caseId, pending.body.id)))
      .toMatchObject([{ companyId: companyA, caseId: pending.body.id, issueId: linkedIssueId, linkedByUserId: null }]);
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
  it("turns expired delivery leases into unknown without retrying or changing other delivery states", async () => {
    const expired = await create(companyA, "opener", "Lease expired during provider handoff");
    const future = await create(companyA, "opener", "Provider attempt still holds its lease");
    const delivered = await create(companyA, "opener", "Provider delivery is recorded");
    const pending = await create(companyA, "opener", "No provider attempt has started");
    for (const response of [expired, future, delivered, pending]) expect(response.status).toBe(201);
    const expiredAttempt = randomUUID(), futureAttempt = randomUUID(), deliveredAttempt = randomUUID();
    await db.execute(sql`update support_case_events set delivery_state='sending', delivery_attempt_id=${expiredAttempt}::uuid,
      delivery_provider_key='test-provider', delivery_started_at=clock_timestamp(),
      delivery_lease_until=clock_timestamp()-interval '1 second' where case_id=${expired.body.id}::uuid`);
    await db.execute(sql`update support_case_events set delivery_state='sending', delivery_attempt_id=${futureAttempt}::uuid,
      delivery_provider_key='test-provider', delivery_started_at=clock_timestamp(),
      delivery_lease_until=clock_timestamp()+interval '1 hour' where case_id=${future.body.id}::uuid`);
    await db.execute(sql`update support_case_events set delivery_state='delivered', delivery_attempt_id=${deliveredAttempt}::uuid,
      delivery_provider_key='test-provider', provider_message_ref='test-message', delivery_started_at=clock_timestamp(),
      delivered_at=clock_timestamp() where case_id=${delivered.body.id}::uuid`);

    const sweep = await eraseExpiredSupportCases(db);
    expect(sweep.expiredAttempts).toBe(1);
    const readEvent = async (caseId: string) => {
      const [event] = await db.select().from(supportCaseEvents).where(eq(supportCaseEvents.caseId, caseId));
      return event!;
    };
    const [expiredEvent, futureEvent, deliveredEvent, pendingEvent] = await Promise.all([
      readEvent(expired.body.id), readEvent(future.body.id), readEvent(delivered.body.id), readEvent(pending.body.id),
    ]);
    expect(expiredEvent).toMatchObject({ deliveryState: "unknown", deliveryAttemptId: expiredAttempt,
      deliveryProviderKey: "test-provider", deliveryLeaseUntil: null, deliveredAt: null, providerMessageRef: null });
    expect(futureEvent).toMatchObject({ deliveryState: "sending", deliveryAttemptId: futureAttempt,
      deliveryProviderKey: "test-provider" });
    expect(futureEvent.deliveryLeaseUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(deliveredEvent).toMatchObject({ deliveryState: "delivered", deliveryAttemptId: deliveredAttempt,
      deliveryProviderKey: "test-provider", providerMessageRef: "test-message" });
    expect(pendingEvent).toMatchObject({ deliveryState: "pending", deliveryAttemptId: null, deliveryProviderKey: null });
    expect((await detail(companyA, "opener", expired.body.id)).body.delivery).toBe("unknown");
    expect((await detail(companyA, "opener", future.body.id)).body.delivery).toBe("pending");
    expect((await detail(companyA, "opener", delivered.body.id)).body.delivery).toBe("delivered");
    expect((await detail(companyA, "opener", pending.body.id)).body.delivery).toBe("pending");
    // Running maintenance again neither retries the expired attempt nor
    // changes its recorded uncertainty.
    expect((await eraseExpiredSupportCases(db)).expiredAttempts).toBe(0);
    expect(await readEvent(expired.body.id)).toMatchObject({ deliveryState: "unknown", deliveryAttemptId: expiredAttempt });
  });
  it("skips a locked company root or case and transitions the expired lease after release", async () => {
    const expired = await create(companyA, "opener", "Lease waits for maintenance after root release");
    expect(expired.status).toBe(201);
    const attempt = randomUUID();
    await db.execute(sql`update support_case_events set delivery_state='sending', delivery_attempt_id=${attempt}::uuid,
      delivery_provider_key='test-provider', delivery_started_at=clock_timestamp(),
      delivery_lease_until=clock_timestamp()-interval '1 second' where case_id=${expired.body.id}::uuid`);

    await db.transaction(async tx => {
      await tx.execute(sql`select id from companies where id=${companyA}::uuid for update`);
      await tx.execute(sql`select id from support_cases where id=${expired.body.id}::uuid for update`);
      const [held] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      const [other] = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      expect(other!.pid).not.toBe(held!.pid);
      expect((await eraseExpiredSupportCases(db)).expiredAttempts).toBe(0);
      const [stillSending] = await tx.select().from(supportCaseEvents).where(eq(supportCaseEvents.caseId, expired.body.id));
      expect(stillSending!.deliveryState).toBe("sending");
    });

    // With only the child locked, the sweep acquires the company first, skips
    // the case, and releases the root without waiting on the busy case.
    await db.transaction(async tx => {
      await tx.execute(sql`select id from support_cases where id=${expired.body.id}::uuid for update`);
      expect((await eraseExpiredSupportCases(db)).expiredAttempts).toBe(0);
    });
    expect((await eraseExpiredSupportCases(db)).expiredAttempts).toBe(1);
    const [event] = await db.select().from(supportCaseEvents).where(eq(supportCaseEvents.caseId, expired.body.id));
    expect(event).toMatchObject({ deliveryState: "unknown", deliveryAttemptId: attempt, deliveryLeaseUntil: null });
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
      .send({ expectedPolicyRevision: policyRevision, idempotencyKey: randomUUID(), expectedUserId: users.opener, body: "private-canary-reply\u0000tail" });
    expect(invalidReply.status).toBe(400);
    expect(JSON.stringify(invalidReply.body)).not.toContain("private-canary");
    expect(await db.select().from(supportCaseEvents).where(eq(supportCaseEvents.caseId, valid.body.id))).toHaveLength(1);
  });

});
