import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authUsers, companies, accountDeletionOperations, companyDeletionOperations, createDb, applyPendingMigrations, supportCases, supportCaseEvents, supportCaseDeletionMarkers,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import type { SupportCaseDataPolicy } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { prepareRestoredQuarantine, assertDatabaseRestoreAdmission } from "../services/saas/quarantine.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";

// Explicit test policy, never a default or deployed retention qualification.
const dataPolicy: SupportCaseDataPolicy = {
  schemaVersion: 1, policyVersion: "test.support.v1", recipientName: "Test support operator",
  privacyNoticeUrl: "https://example.test/privacy", processingRegion: "test region",
  retentionTrigger: "after_last_customer_or_support_message", retentionDays: 30,
  backupMaxDays: 7, restoreLagDays: 2, deletionMarkerDays: 10, legalHoldPolicyId: "test.support.hold.v1",
};
describe("native support case storage and erasure boundaries", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-support-case-storage-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  async function seed() {
    const companyId = randomUUID(), userId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Actual support company", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Actual customer", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    const [row] = await db.insert(supportCases).values({ companyId, openedByUserId: userId, subject: "Cannot continue",
      description: "My work will not open", dataPolicy, expiresAt: new Date(Date.now() + 30 * 86400000) }).returning();
    return { companyId, userId, row: row! };
  }
  const event = (s: Awaited<ReturnType<typeof seed>>) => ({ companyId: s.companyId, caseId: s.row.id,
    authorUserId: s.userId, kind: "request" as const, body: s.row.description,
    customerStatus: "RECEIVED" as const, requestKey: randomUUID(), requestHash: "a".repeat(64) });

  it("keeps a durable local request pending without inventing external delivery", async () => {
    const s = await seed();
    const [receipt] = await db.insert(supportCaseEvents).values(event(s)).returning();
    expect(s.row.impact).toBeNull();
    expect(s.row.category).toBe("other");
    expect(receipt!.deliveryState).toBe("pending");
    expect(receipt!.deliveredAt).toBeNull();
    expect(receipt!.providerMessageRef).toBeNull();
    await expect(db.update(supportCaseEvents).set({ deliveryState: "delivered" }).where(eq(supportCaseEvents.id, receipt!.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("binds event and follow-up references to the same company", async () => {
    const a = await seed(), b = await seed();
    await expect(db.insert(supportCaseEvents).values({ ...event(a), caseId: b.row.id }))
      .rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(db.insert(supportCases).values({ ...a.row, id: randomUUID(), followUpOfId: b.row.id }))
      .rejects.toMatchObject({ cause: { code: "23503" } });
  });
  it("binds duplicate request keys to company and authenticated author", async () => {
    const s = await seed(), input = event(s);
    await db.insert(supportCaseEvents).values(input);
    await expect(db.insert(supportCaseEvents).values(input)).rejects.toMatchObject({ cause: { code: "23505" } });
    const other = await seed();
    await expect(db.insert(supportCaseEvents).values({ ...event(other), requestKey: input.requestKey })).resolves.toBeDefined();
  });
  it("requires the actual response requested when waiting for the customer", async () => {
    const s = await seed();
    await expect(db.update(supportCases).set({ customerStatus: "WAITING_FOR_YOU" }).where(eq(supportCases.id, s.row.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("requires a reason for a legal hold", async () => {
    const s = await seed();
    await expect(db.update(supportCases).set({ legalHold: true }).where(eq(supportCases.id, s.row.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("retains content-free erasure identities for the case and its events", async () => {
    const s = await seed(), [message] = await db.insert(supportCaseEvents).values(event(s)).returning();
    await db.delete(supportCases).where(eq(supportCases.id, s.row.id));
    expect(await db.select().from(supportCaseEvents).where(eq(supportCaseEvents.caseId, s.row.id))).toEqual([]);
    const markers = await db.select().from(supportCaseDeletionMarkers).where(eq(supportCaseDeletionMarkers.caseId, s.row.id));
    expect(markers.map(m => m.subjectId).sort()).toEqual([s.row.id, message!.id].sort());
    for (const marker of markers) {
      expect(marker.companyId).toBe(s.companyId);
      expect(marker.retainUntil.getTime()).toBeGreaterThan(marker.erasedAt.getTime());
      expect(Object.keys(marker).sort()).toEqual(["subjectId", "companyId", "caseId", "targetKind", "erasedAt", "retainUntil"].sort());
    }
    await expect(db.insert(supportCases).values({ ...s.row })).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("refuses content erasure while the original case has an active legal hold", async () => {
    const s = await seed(), [message] = await db.insert(supportCaseEvents).values(event(s)).returning();
    await db.update(supportCases).set({ legalHold: true, holdReason: "Actual test hold" }).where(eq(supportCases.id, s.row.id));
    await expect(db.delete(supportCases).where(eq(supportCases.id, s.row.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.delete(supportCaseEvents).where(eq(supportCaseEvents.id, message!.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    expect(await db.select().from(supportCaseDeletionMarkers).where(and(eq(supportCaseDeletionMarkers.companyId, s.companyId), eq(supportCaseDeletionMarkers.caseId, s.row.id)))).toEqual([]);
  });
  it("retains erasure markers when the original company purge removes support content", async () => {
    const s = await seed(), [message] = await db.insert(supportCaseEvents).values(event(s)).returning();
    await purgeCompanyContent(db, s.companyId);
    expect(await db.select().from(supportCases).where(eq(supportCases.companyId, s.companyId))).toEqual([]);
    expect((await db.select().from(supportCaseDeletionMarkers).where(eq(supportCaseDeletionMarkers.companyId, s.companyId)))
      .map(m => m.subjectId).sort()).toEqual([s.row.id, message!.id].sort());
  });
  it("refuses old-reader company erasure completion while support content still exists", async () => {
    const s = await seed();
    await expect(db.update(companies).set({ contentErasureTransactionId: sql`pg_current_xact_id()::text` })
      .where(eq(companies.id, s.companyId))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.insert(companyDeletionOperations).values({ companyId: s.companyId, requestedByUserId: s.userId,
      idempotencyKey: "b".repeat(64), status: "completed", completedAt: new Date() }))
      .rejects.toMatchObject({ cause: { code: "23514" } });
    expect((await db.select().from(supportCases).where(eq(supportCases.id, s.row.id)))).toHaveLength(1);
    expect((await db.select().from(companies).where(eq(companies.id, s.companyId)))[0]!.contentErasureTransactionId).toBeNull();
  });
  it("preserves indeterminate provider facts instead of claiming physical erasure", async () => {
    const s = await seed(), [message] = await db.insert(supportCaseEvents).values(event(s)).returning();
    // A simulated unknown transport proves only conservative storage behavior;
    // no request is sent and no provider delivery is qualified by this test.
    await db.update(supportCaseEvents).set({ deliveryState: "unknown", deliveryAttemptId: randomUUID(),
      deliveryProviderKey: "fixture-unknown-route", deliveryStartedAt: new Date() }).where(eq(supportCaseEvents.id, message!.id));
    await expect(db.delete(supportCaseEvents).where(eq(supportCaseEvents.id, message!.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.delete(supportCases).where(eq(supportCases.id, s.row.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(supportCaseEvents).set({ deliveryAttemptId: null }).where(eq(supportCaseEvents.id, message!.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
    expect(await db.select().from(supportCaseDeletionMarkers).where(eq(supportCaseDeletionMarkers.caseId, s.row.id))).toEqual([]);
  });
  it("refuses new content after the native account or company erasure request exists", async () => {
    const user = await seed(), company = await seed();
    await db.insert(accountDeletionOperations).values({ userId: user.userId, idempotencyKey: "c".repeat(64) });
    await db.insert(companyDeletionOperations).values({ companyId: company.companyId, requestedByUserId: company.userId, idempotencyKey: "d".repeat(64) });
    for (const s of [user, company]) {
      await expect(db.insert(supportCases).values({ ...s.row, id: randomUUID() })).rejects.toMatchObject({ cause: { code: "23514" } });
      await expect(db.insert(supportCaseEvents).values(event(s))).rejects.toMatchObject({ cause: { code: "23514" } });
    }
  });
  it("keeps erasure identities immutable through their configured restore horizon", async () => {
    const s = await seed();
    await db.delete(supportCases).where(eq(supportCases.id, s.row.id));
    const [marker] = await db.select().from(supportCaseDeletionMarkers).where(eq(supportCaseDeletionMarkers.subjectId, s.row.id));
    await expect(db.delete(supportCaseDeletionMarkers).where(eq(supportCaseDeletionMarkers.subjectId, s.row.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(supportCaseDeletionMarkers).set({ companyId: randomUUID() }).where(eq(supportCaseDeletionMarkers.subjectId, s.row.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(supportCaseDeletionMarkers).set({ retainUntil: new Date(marker!.erasedAt.getTime() + 1000) })
      .where(eq(supportCaseDeletionMarkers.subjectId, s.row.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("refuses missing policy and cross-kind identity collisions at the original database owner", async () => {
    const s = await seed();
    await expect(db.insert(supportCases).values({ ...s.row, id: randomUUID(), dataPolicy: {} as never }))
      .rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.insert(supportCaseEvents).values({ ...event(s), id: s.row.id })).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("reapplies actual current erasures to an earlier isolated snapshot without reviving a stale hold", async () => {
    const s = await seed(), retained = await seed();
    const [message] = await db.insert(supportCaseEvents).values(event(s)).returning();
    const [earlierCase] = await db.update(supportCases).set({ legalHold: true, holdReason: "Earlier actual hold" })
      .where(eq(supportCases.id, s.row.id)).returning();
    const earlierCompanies = await db.select().from(companies).where(inArray(companies.id, [s.companyId, retained.companyId]));
    const earlierUsers = await db.select().from(authUsers).where(inArray(authUsers.id, [s.userId, retained.userId]));
    // Release in the current source, then erase through the actual original
    // owner. The isolated target below keeps the exact earlier held snapshot.
    await db.update(supportCases).set({ legalHold: false, holdReason: null }).where(eq(supportCases.id, s.row.id));
    await db.delete(supportCases).where(eq(supportCases.id, s.row.id));
    const actualMarkers = await db.select().from(supportCaseDeletionMarkers).where(eq(supportCaseDeletionMarkers.caseId, s.row.id));
    const supportCasesLedger = actualMarkers.map(m => ({ subject_id: m.subjectId, company_id: m.companyId, case_id: m.caseId,
      target_kind: m.targetKind, erased_at: m.erasedAt.toISOString(), retain_until: m.retainUntil.toISOString() }));
    const ledger = { companies: [], memory: [], businessEvents: [], analyticalSources: [], feedback: [], supportCases: supportCasesLedger };
    const name = `aw_restore_${randomUUID().replaceAll("-", "")}`, target = new URL(database.connectionString);
    target.pathname = `/${name}`;
    await db.execute(sql`create database ${sql.identifier(name)}`);
    const restored = createDb(target.toString());
    try {
      await applyPendingMigrations(target.toString());
      await restored.insert(companies).values(earlierCompanies);
      await restored.insert(authUsers).values(earlierUsers);
      await restored.insert(supportCases).values([earlierCase!, retained.row]);
      await restored.insert(supportCaseEvents).values(message!);
      const { supportCases: _support, ...oldLedger } = ledger;
      await expect(prepareRestoredQuarantine(restored, target.toString(), oldLedger as never)).rejects.toThrow("V10-aware support case deletion ledger required");
      await prepareRestoredQuarantine(restored, target.toString(), ledger);
      await prepareRestoredQuarantine(restored, target.toString(), ledger);
      await expect(assertDatabaseRestoreAdmission(restored)).rejects.toThrow("remains quarantined");
      expect((await restored.select().from(supportCases)).map(c => c.id)).toEqual([retained.row.id]);
      expect(await restored.select().from(supportCaseEvents)).toEqual([]);
      expect((await restored.select().from(supportCaseDeletionMarkers)).map(m => m.subjectId).sort())
        .toEqual([s.row.id, message!.id].sort());
      await expect(restored.insert(supportCases).values(earlierCase!)).rejects.toMatchObject({ cause: { code: "23514" } });
      await expect(prepareRestoredQuarantine(restored, target.toString(), { ...ledger,
        supportCases: supportCasesLedger.map(m => ({ ...m, company_id: retained.companyId })) }))
        .rejects.toThrow("Conflicting support erasure identity");
    } finally {
      await restored.$client.end({ timeout: 1 });
      await db.execute(sql`drop database ${sql.identifier(name)} with (force)`);
    }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  it("replays account erasure without restoring access or falsely completing held support content", async () => {
    const s = await seed();
    const [message] = await db.insert(supportCaseEvents).values(event(s)).returning();
    const [held] = await db.update(supportCases).set({ legalHold: true, holdReason: "Actual retained support hold" })
      .where(eq(supportCases.id, s.row.id)).returning();
    const [company] = await db.select().from(companies).where(eq(companies.id, s.companyId));
    const [profile] = await db.select().from(authUsers).where(eq(authUsers.id, s.userId));
    const name = `aw_restore_${randomUUID().replaceAll("-", "")}`, target = new URL(database.connectionString);
    target.pathname = `/${name}`;
    await db.execute(sql`create database ${sql.identifier(name)}`);
    const restored = createDb(target.toString());
    const ledger = { companies: [], memory: [], businessEvents: [], analyticalSources: [], feedback: [], supportCases: [],
      users: [{ id: randomUUID(), user_id: s.userId, created_at: new Date().toISOString() }] };
    try {
      await applyPendingMigrations(target.toString());
      await restored.insert(companies).values(company!);
      await restored.insert(authUsers).values({ ...profile!, locale: "da" });
      await restored.insert(supportCases).values(held!);
      await restored.insert(supportCaseEvents).values(message!);
      for (let attempt = 0; attempt < 2; attempt++) {
        await prepareRestoredQuarantine(restored, target.toString(), ledger);
        const [scrubbed] = await restored.select().from(authUsers).where(eq(authUsers.id, s.userId));
        expect(scrubbed).toMatchObject({ name: "Deleted account", emailVerified: false, image: null, locale: null });
        expect(scrubbed!.email).not.toBe(profile!.email);
        const [operation] = await restored.select().from(accountDeletionOperations).where(eq(accountDeletionOperations.userId, s.userId));
        expect(operation).toMatchObject({ status: "requested", errorCode: "account_erasure_pending", completedAt: null });
        expect(await restored.select().from(supportCases)).toHaveLength(1);
        expect(await restored.select().from(supportCaseEvents)).toHaveLength(1);
        await expect(assertDatabaseRestoreAdmission(restored)).rejects.toThrow();
      }
      await restored.update(supportCases).set({ legalHold: false, holdReason: null }).where(eq(supportCases.id, s.row.id));
      await prepareRestoredQuarantine(restored, target.toString(), ledger);
      expect(await restored.select().from(authUsers)).toEqual([]);
      expect(await restored.select().from(supportCases)).toEqual([]);
      expect((await restored.select().from(supportCaseDeletionMarkers)).map(m => m.subjectId).sort())
        .toEqual([s.row.id, message!.id].sort());
      await expect(assertDatabaseRestoreAdmission(restored)).rejects.toThrow();
    } finally {
      await restored.$client.end({ timeout: 1 });
      await db.execute(sql`drop database ${sql.identifier(name)} with (force)`);
    }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

});
