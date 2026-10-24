import { randomUUID, createHash } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { createDb, closeRegisteredClients, companies, authUsers, authSessions, customerFeedback, customerFeedbackAccess,
  customerFeedbackEvents, customerFeedbackImages, feedbackRetentionErasures, feedbackImageDeletions, activityLog, companyMemberships,
  customerFeedbackDeletionMarkers, applyPendingMigrations } from "@paperclipai/db";
import { prepareRestoredQuarantine, assertDatabaseRestoreAdmission } from "../services/saas/quarantine.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
import { customerFeedbackRetentionErasureService, processApprovedFeedbackRetentionErasure } from "../services/customer-feedback-retention-erasure.js";
import express from "express";
import request from "supertest";
import { customerFeedbackRoutes } from "../routes/customer-feedback.js";
import { errorHandler } from "../middleware/error-handler.js";
import { customerFeedbackRetentionService } from "../services/customer-feedback-retention.js";
import { customerFeedbackImageService, processFeedbackImageDeletion } from "../services/customer-feedback-images.js";
import { createStorageService } from "../storage/service.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import type { StorageService } from "../storage/types.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";

// Owned historical INSERTs, original native clock and actual disk provider.
// These fixtures represent already-normalized historical objects; they do not
// claim malware scanning or qualification of the hosted archive transport.
describe("native explicit feedback retention erasure", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let companyId: string, operatorId: string, operatorSessionId: string, directory: string, storage: StorageService;
  const operatorSessions = new Map<string, string>();
  const actor = (principal = operatorId, includeSession = true) => ({ type: "board" as const, source: "session" as const,
    userId: principal, ...(includeSession ? { sessionId: operatorSessions.get(principal) } : {}), companyIds: [companyId] });
  const options = () => ({ operatorUserIds: [operatorId] });
  const owner = (provider = storage) => customerFeedbackRetentionErasureService(db, provider, options());
  const old = (days: number) => new Date(Date.now() - days * 86400000);
  const hash = (body: Buffer | string) => createHash("sha256").update(body).digest("hex");
  beforeAll(async () => {
    expect((await getEmbeddedPostgresTestSupport()).supported, "Actual migrated PostgreSQL required").toBe(true);
    database = await startEmbeddedPostgresTestDatabase("aw-v9-retention-erasure-"); db = createDb(database.connectionString);
  }, 60000);
  afterAll(async () => { if (database) { await closeRegisteredClients(database.connectionString); await database.cleanup(); } }, 30000);
  beforeEach(async () => {
    companyId = randomUUID(); operatorId = randomUUID(); directory = await mkdtemp(join(tmpdir(), "aw-retention-owned-"));
    operatorSessions.clear();
    await db.insert(companies).values({ id: companyId, name: "Owned historical retention fixture", issuePrefix: `E${companyId.slice(0, 7)}` });
    await db.insert(authUsers).values({ id: operatorId, name: "Owned original operator", email: `${operatorId}@example.test`,
      emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    operatorSessionId = await seedNativePasskeySession(db, operatorId);
    operatorSessions.set(operatorId, operatorSessionId);
    storage = createStorageService(createLocalDiskStorageProvider(directory));
  });
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
  async function historicalCase(createdDays = 150, closedDays: number | null = 100) {
    const id = randomUUID();
    await db.insert(customerFeedback).values({ id, companyId, category: "BUG", body: "OWNED-PRIVATE-HISTORICAL-FEEDBACK",
      omitName: true, status: closedDays === null ? "RECEIVED" : "CLOSED", createdAt: old(createdDays),
      closedAt: closedDays === null ? null : old(closedDays), context: { surfaceKey: "home", locale: "en", timezone: "UTC", viewportClass: "wide" } });
    await db.insert(customerFeedbackAccess).values({ companyId, feedbackId: id, userId: operatorId, requestKey: randomUUID(), requestHash: hash("owned") });
    return id;
  }
  async function historicalImage(feedbackId: string, days = 35, settled = true) {
    const id = randomUUID(), body = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAIAAADJUWIXAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWNgYPiPikjjAwBp8hPtBUNYegAAAABJRU5ErkJggg==", "base64");
    await db.insert(customerFeedbackImages).values({ id, companyId, feedbackId, requestKey: randomUUID(), requestHash: hash(body),
      mediaType: "image/png", leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 120000), createdAt: old(days) });
    const result = await storage.putFile({ companyId, namespace: `feedback-images/${feedbackId}/${id}`, originalFilename: "image.png",
      contentType: "image/png", body, onAllocated: async objectKey => {
        await db.update(customerFeedbackImages).set({ status: "storing", objectKey, storageScopeId: storage.scopeId, byteSize: body.length,
          sha256: hash(body), scannerToken: hash("owned historical normalized fixture"), scanCheckedAt: sql`clock_timestamp()` })
          .where(eq(customerFeedbackImages.id, id));
      }, onTransportSettled: settled ? async () => {
        await db.update(customerFeedbackImages).set({ transportSettledAt: sql`clock_timestamp()` }).where(eq(customerFeedbackImages.id, id));
      } : undefined });
    if (settled) await db.update(customerFeedbackImages).set({ status: "ready" }).where(eq(customerFeedbackImages.id, id));
    return { id, objectKey: result.objectKey };
  }
  async function command(feedbackId: string, target: { kind: "case" } | { kind: "image"; imageId: string } = { kind: "case" }) {
    const review = await owner().review(actor(), companyId, feedbackId);
    return { requestKey: randomUUID(), confirmErasure: true as const, expectedReviewHash: review.reviewHash, target };
  }
  const records = () => db.select().from(feedbackRetentionErasures).where(eq(feedbackRetentionErasures.companyId, companyId));

  it("does not erase on review, refuses missing C3 confirmation and refuses current unexpired content", async () => {
    const id = await historicalCase(10, null), review = await owner().review(actor(), companyId, id), input = await command(id);
    expect(review).toMatchObject({ caseEligible: false, caseCanErase: false, configuration: { closedFeedbackDays: 90, imageDays: 30, openFeedbackMonths: 12 } });
    await expect(owner().execute(actor(), companyId, id, { ...input, confirmErasure: false })).rejects.toThrow();
    await expect(owner().execute(actor(), companyId, id, input)).rejects.toMatchObject({ status: 409 });
    expect(await records()).toEqual([]); expect(await db.select().from(customerFeedback).where(eq(customerFeedback.id, id))).toHaveLength(1);
  });
  it("refuses a legacy closed case whose actual closure date is unavailable", async () => {
    const id = randomUUID();
    await db.insert(customerFeedback).values({ id, companyId, category: "BUG", body: "Owned legacy closure fixture",
      omitName: true, status: "CLOSED", createdAt: old(150), closedAt: null,
      context: { surfaceKey: "home", locale: "en", timezone: "UTC", viewportClass: "wide" } });
    await expect(owner().review(actor(), companyId, id)).rejects.toMatchObject({ status: 409 });
    await expect(owner().execute(actor(), companyId, id, { requestKey: randomUUID(), confirmErasure: true,
      expectedReviewHash: "a".repeat(64), target: { kind: "case" } })).rejects.toMatchObject({ status: 409 });
    expect(await records()).toEqual([]);
  });
  it("erases expired closed text, replies and private access together, retaining one minimal replayable receipt", async () => {
    const id = await historicalCase();
    await db.insert(customerFeedbackEvents).values({ companyId, feedbackId: id, kind: "customer_follow_up", body: "OWNED-PRIVATE-REPLY",
      customerVisible: true, requestKey: randomUUID(), requestHash: hash("reply") });
    const input = await command(id), result = await owner().execute(actor(), companyId, id, input);
    expect(result.status).toBe("completed"); expect(result.completedAt).not.toBeNull();
    for (const table of [customerFeedbackAccess, customerFeedbackEvents])
      expect(await db.select().from(table).where(eq(table.feedbackId, id))).toEqual([]);
    expect(await db.select().from(customerFeedback).where(eq(customerFeedback.id, id))).toEqual([]);
    expect(await owner().execute(actor(), companyId, id, input)).toEqual(result);
    expect(await owner().get(actor(), companyId, id, result.id)).toEqual(result); expect(await records()).toHaveLength(1);
    expect(await owner().getRequest(actor(), companyId, id, input.requestKey)).toEqual(result);
    await expect(owner().getRequest(actor(), companyId, id, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(owner().execute(actor(), companyId, id, { ...input, expectedReviewHash: hash("different") })).rejects.toMatchObject({ status: 409 });
    expect(JSON.stringify(await records())).not.toContain("OWNED-PRIVATE");
    const audit = await db.select().from(activityLog).where(eq(activityLog.companyId, companyId));
    expect(audit).toHaveLength(1); expect(audit[0]!.details).toBeNull(); expect(audit[0]!.entityId).not.toBe(id);
  });
  it("requires recent proof for retention changes and erasure while preserving current private review", async () => {
    const id = await historicalCase(), input = await command(id);
    await db.update(authSessions).set({ authenticatedAt: new Date(Date.now() - 301000) })
      .where(eq(authSessions.id, operatorSessionId));
    expect((await owner().review(actor(), companyId, id)).caseCanErase).toBe(true);
    await expect(owner().execute(actor(), companyId, id, input)).rejects.toMatchObject({ status: 403 });
    const controls = customerFeedbackRetentionService(db, options());
    await expect(controls.change(actor(), companyId, id, { requestKey: randomUUID(), expectedVersion: 0,
      confirmRetentionChange: true, legalHold: { active: true, releaseAt: null, reason: "Owned hold fixture" },
      extensionUntil: null, extensionReason: "" })).rejects.toMatchObject({ status: 403 });
    expect(await records()).toEqual([]);
    expect((await controls.get(actor(), companyId, id)).version).toBe(0);
    expect(await db.select().from(customerFeedback).where(eq(customerFeedback.id, id))).toHaveLength(1);
  });
  it("uses actual open-case age and current extensions, holds and native versions", async () => {
    const id = await historicalCase(400, null), input = await command(id);
    expect((await owner().review(actor(), companyId, id)).caseCanErase).toBe(true);
    const controls = customerFeedbackRetentionService(db, options());
    await controls.change(actor(), companyId, id, { requestKey: randomUUID(), expectedVersion: 0, confirmRetentionChange: true,
      legalHold: { active: true, releaseAt: null, reason: "Owned current hold" }, extensionUntil: null, extensionReason: "" });
    expect((await owner().review(actor(), companyId, id)).held).toBe(true);
    await expect(owner().execute(actor(), companyId, id, input)).rejects.toMatchObject({ status: 409 });
    await controls.change(actor(), companyId, id, { requestKey: randomUUID(), expectedVersion: 1, confirmRetentionChange: true,
      legalHold: { active: false, releaseAt: null, reason: "" }, extensionUntil: new Date(Date.now() + 86400000).toISOString(), extensionReason: "Owned extension" });
    expect((await owner().review(actor(), companyId, id)).caseCanErase).toBe(false);
    await controls.change(actor(), companyId, id, { requestKey: randomUUID(), expectedVersion: 2, confirmRetentionChange: true,
      legalHold: { active: false, releaseAt: null, reason: "" }, extensionUntil: null, extensionReason: "" });
    await expect(owner().execute(actor(), companyId, id, input)).rejects.toMatchObject({ status: 409 });
    expect((await owner().execute(actor(), companyId, id, await command(id))).status).toBe("completed");
  });
  it("erases only the exact expired image on real disk and keeps younger images and case text", async () => {
    const id = await historicalCase(50, null), image = await historicalImage(id), younger = await historicalImage(id, 2);
    expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(true);
    const result = await owner().execute(actor(), companyId, id, await command(id, { kind: "image", imageId: image.id }));
    expect(result.status).toBe("completed"); expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(false);
    expect((await storage.headObject(companyId, younger.objectKey)).exists).toBe(true);
    expect(await db.select().from(customerFeedback).where(eq(customerFeedback.id, id))).toHaveLength(1);
    expect((await db.select().from(customerFeedbackImages).where(eq(customerFeedbackImages.id, image.id)))[0]!.status).toBe("deleted");
  });
  it("keeps physical deletion with unknown acknowledgement pending and resumes the exact durable request after parent erasure", async () => {
    const id = await historicalCase(), image = await historicalImage(id), input = await command(id);
    let deletes = 0;
    const uncertain = { ...storage, async deleteObject(company: string, key: string) { deletes++; await storage.deleteObject(company, key); throw new Error("OWNED-PRIVATE-DELETE-ACK"); } };
    const pending = await owner(uncertain).execute(actor(), companyId, id, input);
    expect(pending.status).toBe("pending"); expect(pending.completedAt).toBeNull(); expect(deletes).toBe(1);
    expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(false);
    expect(await db.select().from(customerFeedback).where(eq(customerFeedback.id, id))).toEqual([]);
    await expect(db.update(feedbackRetentionErasures).set({ status: "completed", completedAt: new Date() }).where(eq(feedbackRetentionErasures.id, pending.id)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    const done = await owner().execute(actor(), companyId, id, input);
    expect(done).toMatchObject({ id: pending.id, status: "completed" }); expect(await records()).toHaveLength(1);
    expect((await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.imageId, image.id)))[0]!.deletedAt).not.toBeNull();
  });
  it("does not infer transport settlement from age or actual object presence", async () => {
    const id = await historicalCase(), image = await historicalImage(id, 35, false), review = await owner().review(actor(), companyId, id);
    expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(true);
    expect(review).toMatchObject({ caseEligible: true, caseCanErase: false, images: [{ eligible: true, canErase: false }] });
    await expect(owner().execute(actor(), companyId, id, await command(id))).rejects.toMatchObject({ status: 409 });
    await expect(owner().execute(actor(), companyId, id, await command(id, { kind: "image", imageId: image.id }))).rejects.toMatchObject({ status: 409 });
    expect(await records()).toEqual([]); expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(true);
  });
  it("uses the original verified operator, including after storage I/O and on a replay", async () => {
    const id = await historicalCase(), image = await historicalImage(id), input = await command(id);
    await expect(owner().review(actor(operatorId, false), companyId, id)).rejects.toMatchObject({ status: 403 });
    await expect(owner().execute(actor(operatorId, false), companyId, id, input)).rejects.toMatchObject({ status: 403 });
    expect(await records()).toEqual([]);
    await expect(owner().review({ ...actor(), userId: "unconfigured-member" }, companyId, id)).rejects.toMatchObject({ status: 403 });
    await expect(owner().execute({ ...actor(), source: "local_implicit" }, companyId, id, input)).rejects.toMatchObject({ status: 403 });
    const withdraw = { ...storage, async deleteObject(company: string, key: string) {
      await storage.deleteObject(company, key); await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, operatorId));
    } };
    await expect(owner(withdraw).execute(actor(), companyId, id, input)).rejects.toMatchObject({ status: 403 });
    expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(false); expect((await records())[0]!.status).toBe("pending");
    await expect(owner().execute(actor(), companyId, id, input)).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, operatorId));
    expect((await owner().execute(actor(), companyId, id, input)).status).toBe("completed"); expect(await records()).toHaveLength(1);
  });
  it("binds configuration to the native review instead of accepting client deadlines", async () => {
    const id = await historicalCase(), input = await command(id);
    const changed = customerFeedbackRetentionErasureService(db, storage, { ...options(), runtimeEnv: {
      AW_FEEDBACK_RETENTION_JSON: JSON.stringify({ closedFeedbackDays: 91, imageDays: 30, openFeedbackMonths: 12 }),
    } });
    await expect(changed.execute(actor(), companyId, id, input)).rejects.toMatchObject({ status: 409 });
    await expect(owner().execute(actor(), companyId, id, { ...input, deadline: old(1).toISOString() })).rejects.toThrow();
    expect(await records()).toEqual([]);
  });
  it("keeps immutable native receipts and blocks ordinary re-insertion while the ledger is retained", async () => {
    const id = await historicalCase(), image = await historicalImage(id), [original] = await db.select().from(customerFeedback).where(eq(customerFeedback.id, id));
    const result = await owner().execute(actor(), companyId, id, await command(id));
    await expect(db.update(feedbackRetentionErasures).set({ requestHash: hash("different") }).where(eq(feedbackRetentionErasures.id, result.id)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    await expect(db.delete(feedbackRetentionErasures).where(eq(feedbackRetentionErasures.id, result.id)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    await expect(db.insert(customerFeedback).values(original!)).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    const other = await historicalCase();
    await expect(db.insert(customerFeedbackImages).values({ id: image.id, companyId, feedbackId: other, requestKey: randomUUID(),
      requestHash: hash("restore"), mediaType: "image/png", leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 120000) }))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
  });
  it("reapplies a fresh feedback ledger to an older isolated database without the newer request receipts", async () => {
    const erasedCase = await historicalCase(), imageCase = await historicalCase(), retainedCase = await historicalCase(), unsettledCase = await historicalCase();
    const erasedCaseImage = await historicalImage(erasedCase), erasedImage = await historicalImage(imageCase), retainedImage = await historicalImage(retainedCase);
    const unsettledImage = await historicalImage(unsettledCase, 35, false);
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    const cases = await db.select().from(customerFeedback).where(eq(customerFeedback.companyId, companyId));
    const images = await db.select().from(customerFeedbackImages).where(eq(customerFeedbackImages.companyId, companyId));
    // The actual fixture PUT fulfilled, but this earlier snapshot lacks its
    // native acknowledgement. Record the observed completion only in the
    // current source before its later approved erasure, never in the archive.
    await db.update(customerFeedbackImages).set({ transportSettledAt: sql`clock_timestamp()` })
      .where(eq(customerFeedbackImages.id, unsettledImage.id));
    await db.update(customerFeedbackImages).set({ status: "ready" }).where(eq(customerFeedbackImages.id, unsettledImage.id));
    await owner().execute(actor(), companyId, erasedCase, await command(erasedCase));
    await owner().execute(actor(), companyId, imageCase, await command(imageCase, { kind: "image", imageId: erasedImage.id }));
    await owner().execute(actor(), companyId, unsettledCase, await command(unsettledCase, { kind: "image", imageId: unsettledImage.id }));
    const markers = await db.select().from(customerFeedbackDeletionMarkers).where(eq(customerFeedbackDeletionMarkers.companyId, companyId));
    expect(markers.map(row => row.subjectId).sort()).toEqual([erasedCase, erasedCaseImage.id, erasedImage.id, unsettledImage.id].sort());
    const feedback = markers.map(row => ({ subject_id: row.subjectId, company_id: row.companyId, feedback_id: row.feedbackId,
      target_kind: row.targetKind, erased_at: row.erasedAt.toISOString() }));
    expect(JSON.stringify(feedback)).not.toContain("OWNED-PRIVATE-HISTORICAL-FEEDBACK");
    const name = `aw_restore_${randomUUID().replaceAll("-", "")}`, target = new URL(database.connectionString);
    target.pathname = `/${name}`;
    await db.execute(sql`create database ${sql.identifier(name)}`);
    const restored = createDb(target.toString());
    try {
      await applyPendingMigrations(target.toString());
      await restored.insert(companies).values(company!);
      await restored.insert(customerFeedback).values(cases);
      // Hydrate an exact earlier native snapshot before any application starts,
      // as archive restoration does. This isolated fixture tests the quarantine
      // owner and current guard, not the independently qualified dump transport.
      await restored.execute(sql`alter table customer_feedback_images disable trigger user`);
      try { await restored.insert(customerFeedbackImages).values(images); }
      finally { await restored.execute(sql`alter table customer_feedback_images enable trigger user`); }
      expect(await restored.select().from(feedbackRetentionErasures)).toEqual([]);
      const ledger = { companies: [], memory: [], businessEvents: [], analyticalSources: [], feedback, supportCases: [] };
      await prepareRestoredQuarantine(restored, target.toString(), ledger);
      await prepareRestoredQuarantine(restored, target.toString(), ledger);
      await expect(assertDatabaseRestoreAdmission(restored)).rejects.toThrow("remains quarantined");
      expect((await restored.select().from(customerFeedback)).map(row => row.id).sort()).toEqual([imageCase, retainedCase, unsettledCase].sort());
      expect((await restored.select().from(customerFeedbackImages)).map(row => ({ id: row.id, status: row.status })))
        .toEqual(expect.arrayContaining([{ id: erasedImage.id, status: "deleting" }, { id: retainedImage.id, status: "ready" },
          { id: unsettledImage.id, status: "deleting" }]));
      expect(await restored.select().from(customerFeedbackImages)).toHaveLength(3);
      await processFeedbackImageDeletion(restored, storage, undefined, companyId, erasedImage.id);
      expect((await restored.select().from(customerFeedbackImages).where(eq(customerFeedbackImages.id, erasedImage.id)))[0]!.status).toBe("deleted");
      expect(await processFeedbackImageDeletion(restored, storage, undefined, companyId, unsettledImage.id)).toBe(false);
      const [unsettledReceipt] = await restored.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.imageId, unsettledImage.id));
      expect(unsettledReceipt!.transportSettledAt).toBeNull();
      expect(unsettledReceipt!.deletedAt).toBeNull();
      expect((await restored.select().from(customerFeedbackDeletionMarkers))).toHaveLength(4);
      await expect(restored.insert(customerFeedback).values(cases.find(row => row.id === erasedCase)!))
        .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
      const [otherCompany] = await restored.insert(companies).values({ name: "Owned independent restore tenant", issuePrefix: `R${randomUUID().slice(0, 6)}` }).returning();
      await expect(restored.insert(customerFeedback).values({ ...cases.find(row => row.id === erasedCase)!, companyId: otherCompany!.id }))
        .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
      await expect(restored.insert(customerFeedbackImages).values({ id: erasedImage.id, companyId, feedbackId: retainedCase,
        requestKey: randomUUID(), requestHash: hash("owned restore reuse"), mediaType: "image/png", leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 120000) })).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
      await expect(restored.update(customerFeedbackDeletionMarkers).set({ feedbackId: retainedCase })
        .where(eq(customerFeedbackDeletionMarkers.subjectId, erasedImage.id)))
        .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
      await expect(restored.delete(customerFeedbackDeletionMarkers).where(eq(customerFeedbackDeletionMarkers.subjectId, erasedImage.id)))
        .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
      expect(await storage.headObject(companyId, erasedCaseImage.objectKey)).toEqual({ exists: false });
      expect(await storage.headObject(companyId, erasedImage.objectKey)).toEqual({ exists: false });
      expect(await storage.headObject(companyId, retainedImage.objectKey)).toMatchObject({ exists: true });
    } finally {
      await restored.$client.end({ timeout: 1 });
      await db.execute(sql`drop database ${sql.identifier(name)} with (force)`);
    }
  });
  it("retains minimal original erasure identities and request receipts during company content purge", async () => {
    const id = await historicalCase(), image = await historicalImage(id);
    const receipt = await owner().execute(actor(), companyId, id, await command(id));
    const another = await historicalCase();
    await purgeCompanyContent(db, companyId);
    expect(await db.select().from(customerFeedback).where(eq(customerFeedback.companyId, companyId))).toEqual([]);
    expect((await records()).map(row => row.id)).toEqual([receipt.id]);
    const markers = await db.select().from(customerFeedbackDeletionMarkers).where(eq(customerFeedbackDeletionMarkers.companyId, companyId));
    expect(markers.map(row => row.subjectId).sort()).toEqual([id, image.id, another].sort());
    expect(JSON.stringify(markers)).not.toContain("OWNED-PRIVATE-HISTORICAL-FEEDBACK");
  });
  it("makes the original immutable command discoverable only in its verified operator's company history", async () => {
    const id = await historicalCase(), input = await command(id), result = await owner().execute(actor(), companyId, id, input);
    expect(await owner().history(actor(), companyId)).toEqual([{ receipt: result, command: input }]);
    const other = randomUUID();
    await db.insert(authUsers).values({ id: other, name: "Owned second operator", email: `${other}@example.test`,
      emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    const otherSessionId = await seedNativePasskeySession(db, other);
    operatorSessions.set(other, otherSessionId);
    const second = customerFeedbackRetentionErasureService(db, storage, { operatorUserIds: [operatorId, other] });
    expect(await second.history(actor(other), companyId)).toEqual([]);
    await expect(second.getRequest(actor(other), companyId, id, input.requestKey)).rejects.toMatchObject({ status: 404 });
  });
  it("finishes only durably approved exact objects without impersonating an erased operator or choosing new expired content", async () => {
    const untouched = await historicalCase(), unapproved = await historicalImage(untouched);
    expect(await processApprovedFeedbackRetentionErasure(db, storage)).toBe(false);
    expect((await storage.headObject(companyId, unapproved.objectKey)).exists).toBe(true);
    const id = await historicalCase(), image = await historicalImage(id), input = await command(id);
    const uncertain = { ...storage, async deleteObject() { throw new Error("Owned missing deletion acknowledgement"); } };
    const pending = await owner(uncertain).execute(actor(), companyId, id, input);
    expect(pending.status).toBe("pending"); expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(true);
    await db.delete(authUsers).where(eq(authUsers.id, operatorId));
    expect(await processApprovedFeedbackRetentionErasure(db, storage)).toBe(true);
    expect((await records()).find(row => row.id === pending.id)!.status).toBe("completed");
    expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(false);
    expect((await storage.headObject(companyId, unapproved.objectKey)).exists).toBe(true);
    expect(await processApprovedFeedbackRetentionErasure(db, storage)).toBe(false);
  });
  it("returns protected Native HTTP review, history and request-key status after parent erasure with no private storage or text fields", async () => {
    const application = express(); application.use(express.json());
    // Owned request-context fixture; service admission still requires the
    // actual verified Native operator. This is not deployed session proof.
    application.use((req, _res, next) => { req.actor = actor(); next(); });
    application.use("/api", customerFeedbackRoutes(db, { ...options(), storage })); application.use(errorHandler);
    const id = await historicalCase(), base = `/api/internal/customer-feedback/${companyId}/${id}/retention-erasures`;
    const nativeReview = await request(application).get(base + `/review?expectedUserId=${operatorId}`);
    expect(nativeReview.status).toBe(200); expect(nativeReview.headers["cache-control"]).toBe("private, no-store");
    const input = { requestKey: randomUUID(), confirmErasure: true, expectedReviewHash: nativeReview.body.reviewHash, target: { kind: "case" } };
    const result = await request(application).post(base + `?expectedUserId=${operatorId}`).send(input);
    expect(result.status).toBe(200); expect(result.body.status).toBe("completed");
    const status = await request(application).get(base + `/requests/${input.requestKey}?expectedUserId=${operatorId}`);
    expect(status.status).toBe(200); expect(status.body).toEqual(result.body); expect(status.headers["cache-control"]).toBe("private, no-store");
    expect(JSON.stringify(status.body)).not.toContain("OWNED-PRIVATE"); expect(status.body).not.toHaveProperty("objectKey");
    const history = await request(application).get(`/api/internal/customer-feedback/${companyId}/retention-erasures?expectedUserId=${operatorId}`);
    expect(history.status).toBe(200); expect(history.body).toEqual([{ receipt: result.body, command: input }]);
    const changed = await request(application).get(base + `/requests/${input.requestKey}?expectedUserId=different-account`);
    expect(changed.status).toBe(409);
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, operatorId));
    expect((await request(application).get(base + `/requests/${input.requestKey}?expectedUserId=${operatorId}`)).status).toBe(403);
  });
  it("refuses protected reads, removal and stale retention consent against another disk root before provider I/O", async () => {
    const id = await historicalCase(), image = await historicalImage(id), input = await command(id);
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: operatorId, membershipRole: "viewer", status: "active" });
    const other = createStorageService(createLocalDiskStorageProvider(join(directory, "another-root")));
    let reads = 0, deletes = 0, heads = 0;
    const changed = { ...other, async getObject(company: string, key: string) { reads++; return other.getObject(company, key); },
      async deleteObject(company: string, key: string) { deletes++; return other.deleteObject(company, key); },
      async headObject(company: string, key: string) { heads++; return other.headObject(company, key); } };
    const images = customerFeedbackImageService(db, changed, { ...options(), scanner: null });
    await expect(images.internalRead(actor(), companyId, id, image.id)).rejects.toMatchObject({ status: 404 });
    await expect(images.remove(actor(), companyId, id, image.id)).rejects.toMatchObject({ status: 409 });
    const review = await owner(changed).review(actor(), companyId, id);
    expect(review.caseEligible).toBe(true); expect(review.caseCanErase).toBe(false);
    expect(review.images[0]!.canErase).toBe(false); expect(review.reviewHash).not.toBe(input.expectedReviewHash);
    await expect(owner(changed).execute(actor(), companyId, id, input)).rejects.toMatchObject({ status: 409 });
    expect([reads, deletes, heads]).toEqual([0, 0, 0]); expect(await records()).toEqual([]);
    expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(true);
    expect(review).not.toHaveProperty("storageScopeId"); expect(JSON.stringify(review)).not.toContain(directory);
    expect((await images.internalList(actor(), companyId, id))[0]).not.toHaveProperty("storageScopeId");
  });
  it("keeps approved parent erasure pending across a namespace change and finishes the same receipt only with original storage", async () => {
    const id = await historicalCase(), image = await historicalImage(id), input = await command(id);
    const uncertain = { ...storage, async deleteObject() { throw Error("Owned deletion acknowledgement unavailable"); } };
    const pending = await owner(uncertain).execute(actor(), companyId, id, input);
    expect(pending.status).toBe("pending");
    const outbox = (await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.imageId, image.id)))[0]!;
    expect(outbox.storageScopeId).toBe(storage.scopeId);
    const other = createStorageService(createLocalDiskStorageProvider(join(directory, "another-root")));
    let calls = 0;
    const changed = { ...other, async deleteObject() { calls++; }, async headObject() { calls++; return { exists: false }; } };
    expect(await processFeedbackImageDeletion(db, changed, undefined, companyId, image.id)).toBe(false);
    expect(await processApprovedFeedbackRetentionErasure(db, changed)).toBe(false);
    expect((await owner(changed).execute(actor(), companyId, id, input)).status).toBe("pending");
    expect(calls).toBe(0); expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(true);
    expect(await records()).toHaveLength(1);
    const restored = createStorageService(createLocalDiskStorageProvider(directory));
    const done = await owner(restored).execute(actor(), companyId, id, input);
    expect(done.id).toBe(pending.id); expect(done.status).toBe("completed");
    expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(false); expect(await records()).toHaveLength(1);
  });
  it("keeps namespace-unknown providers behind a pending receipt without trusting absence in the current provider", async () => {
    const id = await historicalCase(), image = await historicalImage(id), input = await command(id);
    const pending = await owner({ ...storage, async deleteObject() { throw Error("Owned missing acknowledgement"); } }).execute(actor(), companyId, id, input);
    let calls = 0;
    const unknown = { ...storage, scopeId: undefined, async deleteObject() { calls++; }, async headObject() { calls++; return { exists: false }; } };
    expect(await processApprovedFeedbackRetentionErasure(db, unknown)).toBe(false);
    expect((await owner(unknown).execute(actor(), companyId, id, input)).status).toBe("pending"); expect(calls).toBe(0);
    expect((await records())[0]!.id).toBe(pending.id);
    expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(true);
  });
  it("uses Native immutable allocation and outbox scope, refusing rebinding or a namespace-free new allocation", async () => {
    const id = await historicalCase(), image = await historicalImage(id);
    await expect(db.update(customerFeedbackImages).set({ storageScopeId: "b".repeat(64) }).where(eq(customerFeedbackImages.id, image.id)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    await owner({ ...storage, async deleteObject() { throw Error("Owned missing acknowledgement"); } }).execute(actor(), companyId, id, await command(id));
    await expect(db.update(feedbackImageDeletions).set({ storageScopeId: "b".repeat(64) }).where(eq(feedbackImageDeletions.imageId, image.id)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    const open = await historicalCase(10, null), imageId = randomUUID();
    await db.insert(customerFeedbackImages).values({ id: imageId, companyId, feedbackId: open, requestKey: randomUUID(), requestHash: hash("owned"),
      mediaType: "image/png", leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 120000) });
    await expect(db.update(customerFeedbackImages).set({ status: "storing", objectKey: `${companyId}/feedback-images/${open}/${imageId}/owned.png`,
      byteSize: 1, sha256: hash("owned"), scannerToken: hash("owned"), scanCheckedAt: new Date() }).where(eq(customerFeedbackImages.id, imageId)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
  });
  it("does not confirm physical erasure when the original disk becomes inaccessible", async () => {
    const id = await historicalCase(), image = await historicalImage(id), input = await command(id);
    await chmod(directory, 0o000);
    try {
      await expect(storage.headObject(companyId, image.objectKey)).rejects.toMatchObject({ code: "EACCES" });
      const pending = await owner().execute(actor(), companyId, id, input);
      expect(pending.status).toBe("pending"); expect(pending.completedAt).toBeNull();
      expect((await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.imageId, image.id)))[0]!.deletedAt).toBeNull();
    } finally { await chmod(directory, 0o700); }
    expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(true);
    expect((await owner().execute(actor(), companyId, id, input)).status).toBe("completed");
    expect((await storage.headObject(companyId, image.objectKey)).exists).toBe(false);
  });
});
