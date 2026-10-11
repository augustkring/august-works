import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { createDb, closeRegisteredClients, companies, authUsers, customerFeedback, customerFeedbackAccess,
  customerFeedbackEvents, customerFeedbackImages, feedbackRetentionErasures, feedbackImageDeletions, activityLog } from "@paperclipai/db";
import { customerFeedbackRetentionErasureService, processApprovedFeedbackRetentionErasure } from "../services/customer-feedback-retention-erasure.js";
import express from "express";
import request from "supertest";
import { customerFeedbackRoutes } from "../routes/customer-feedback.js";
import { errorHandler } from "../middleware/error-handler.js";
import { customerFeedbackRetentionService } from "../services/customer-feedback-retention.js";
import { createStorageService } from "../storage/service.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import type { StorageService } from "../storage/types.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// Owned historical INSERTs, original native clock and actual disk provider.
// These fixtures represent already-normalized historical objects; they do not
// claim malware scanning or restore qualification for a lost erasure ledger.
describe("native explicit feedback retention erasure", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let companyId: string, operatorId: string, directory: string, storage: StorageService;
  const actor = () => ({ type: "board" as const, source: "session" as const, userId: operatorId, companyIds: [companyId] });
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
    await db.insert(companies).values({ id: companyId, name: "Owned historical retention fixture", issuePrefix: `E${companyId.slice(0, 7)}` });
    await db.insert(authUsers).values({ id: operatorId, name: "Owned original operator", email: `${operatorId}@example.test`,
      emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
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
        await db.update(customerFeedbackImages).set({ status: "storing", objectKey, byteSize: body.length,
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
  it("makes the original immutable command discoverable only in its verified operator's company history", async () => {
    const id = await historicalCase(), input = await command(id), result = await owner().execute(actor(), companyId, id, input);
    expect(await owner().history(actor(), companyId)).toEqual([{ receipt: result, command: input }]);
    const other = randomUUID();
    await db.insert(authUsers).values({ id: other, name: "Owned second operator", email: `${other}@example.test`,
      emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    const second = customerFeedbackRetentionErasureService(db, storage, { operatorUserIds: [operatorId, other] });
    expect(await second.history({ ...actor(), userId: other }, companyId)).toEqual([]);
    await expect(second.getRequest({ ...actor(), userId: other }, companyId, id, input.requestKey)).rejects.toMatchObject({ status: 404 });
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
});
