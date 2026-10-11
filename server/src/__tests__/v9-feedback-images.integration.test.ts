import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { hashPassword } from "better-auth/crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companies, companyMemberships, authUsers, createDb, closeRegisteredClients, customerFeedback,
  customerFeedbackImages, feedbackImageDeletions, customerFeedbackRetention, customerFeedbackRetentionChanges,
  customerFeedbackAccess, authAccounts, accountDeletionOperations, activityLog, authRateLimits } from "@paperclipai/db";
import { customerFeedbackService } from "../services/customer-feedback.js";
import { customerFeedbackImageService, processFeedbackImageDeletion } from "../services/customer-feedback-images.js";
import { configuredFeedbackImageScanner } from "../services/feedback-image-intake.js";
import { createStorageService } from "../storage/service.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { customerFeedbackRetentionService } from "../services/customer-feedback-retention.js";
import { accountDeletionService, eraseAccountAccess } from "../services/saas/account-deletion.js";
import { customerFeedbackRoutes } from "../routes/customer-feedback.js";
import { errorHandler } from "../middleware/error-handler.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("native selected feedback images with owned scanner-wire and filesystem fixtures", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let companyId: string, userId: string, otherUser: string, feedbackId: string, directory: string,
    server: Server, scanner: NonNullable<ReturnType<typeof configuredFeedbackImageScanner>>,
    storage: ReturnType<typeof createStorageService>, service: ReturnType<typeof customerFeedbackImageService>;
  let scanned: Buffer[], sockets: Set<Socket>, alwaysClean: boolean;
  beforeAll(async () => {
    expect((await getEmbeddedPostgresTestSupport()).supported, "Actual migrated PostgreSQL is required; no silent skip").toBe(true);
    database = await startEmbeddedPostgresTestDatabase("aw-v9-feedback-images-"); db = createDb(database.connectionString);
  }, 60000);
  afterAll(async () => { if (database) { await closeRegisteredClients(database.connectionString); await database.cleanup(); } }, 30000);
  const actor = (principal = userId) => ({ type: "board" as const, source: "session" as const,
    userId: principal, companyIds: [companyId] });
  beforeEach(async () => {
    companyId = randomUUID(); userId = randomUUID(); otherUser = randomUUID(); scanned = []; sockets = new Set(); alwaysClean = false;
    await db.insert(companies).values({ id: companyId, name: "Owned image fixture", issuePrefix: `I${companyId.slice(0, 7)}` });
    for (const id of [userId, otherUser]) {
      await db.insert(authUsers).values({ id, name: "Owned test member", email: `${id}@example.test`, emailVerified: true,
        createdAt: new Date(), updatedAt: new Date() });
      await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: id, status: "active", membershipRole: "viewer" });
    }
    await instanceSettingsService(db).updateExperimental({ customer_feedback_v9: true });
    const receipt = await customerFeedbackService(db).create(actor(), companyId, { idempotencyKey: randomUUID(), category: "BUG",
      body: "Owned feedback fixture", omitName: true, context: { surfaceKey: "home", locale: "en", timezone: "UTC", viewportClass: "wide" } });
    feedbackId = receipt.id;
    directory = await mkdtemp(join(tmpdir(), "aw-feedback-images-owned-")); await chmod(directory, 0o700);
    const path = join(directory, "scanner.sock");
    const definitionPublishedAt = new Date().toUTCString();
    // Deliberately synthetic daemon answers over actual Unix IPC. This tests
    // the original byte pipeline/authority, not deployed antivirus coverage.
    server = createServer(socket => {
      sockets.add(socket); socket.once("close", () => sockets.delete(socket)); let input = Buffer.alloc(0);
      socket.on("data", chunk => {
        input = Buffer.concat([input, chunk]);
        if (input.equals(Buffer.from("zVERSION\0"))) { socket.end(`ClamAV 1.4.3/100/${definitionPublishedAt}\0`); return; }
        const prefix = Buffer.from("zINSTREAM\0");
        if (input.length < prefix.length || !input.subarray(0, prefix.length).equals(prefix)) return;
        const parts: Buffer[] = []; let cursor = prefix.length;
        while (cursor + 4 <= input.length) {
          const size = input.readUInt32BE(cursor); cursor += 4;
          if (!size) {
            const body = Buffer.concat(parts); scanned.push(body);
            socket.end(!alwaysClean && body.includes(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) ? "stream: FixtureControl FOUND\0" : "stream: OK\0"); return;
          }
          if (cursor + size > input.length) return;
          parts.push(input.subarray(cursor, cursor + size)); cursor += size;
        }
      });
    });
    await new Promise<void>(resolve => server.listen(path, resolve)); await chmod(path, 0o600);
    scanner = configuredFeedbackImageScanner({ AW_FEEDBACK_CLAMD_SOCKET: path, AW_FEEDBACK_CLAMD_UID: String(process.getuid?.()) })!;
    storage = createStorageService(createLocalDiskStorageProvider(join(directory, "objects")));
    service = customerFeedbackImageService(db, storage, { scanner });
  });
  afterEach(async () => {
    for (const socket of sockets ?? []) socket.destroy();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const bytes = async () => sharp({ create: { width: 5, height: 4, channels: 3, background: "blue" } }).png().toBuffer();
  const upload = async (requestKey = randomUUID(), body?: Buffer) => service.upload(actor(), companyId, feedbackId, requestKey, body ?? await bytes(), "image/png");
  const rows = () => db.select().from(customerFeedbackImages).where(eq(customerFeedbackImages.companyId, companyId));

  it("scans and stores actual normalized bytes, keeps filenames/identity out of the receipt and replays the same request without another scan/write", async () => {
    const key = randomUUID(), body = await bytes(), first = await upload(key, body), count = scanned.length;
    expect(first).toMatchObject({ companyId, feedbackId, status: "ready", mediaType: "image/png" });
    for (const privateKey of ["originalFilename", "objectKey", "submittedByUserId", "scannerToken", "sha256"])
      expect(first).not.toHaveProperty(privateKey);
    expect(await upload(key, body)).toEqual(first); expect(scanned).toHaveLength(count);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]!.objectKey!.endsWith("-image.png")).toBe(true);
    const result = await service.read(actor(), companyId, feedbackId, first.id);
    expect((await sharp(result.body).metadata()).format).toBe("png");
    expect((await rows())[0]!.transportSettledAt).not.toBeNull();
    await expect(upload(key, Buffer.concat([body, Buffer.from("different-owned-payload")]))).rejects.toMatchObject({ status: 409 });
  });
  it("serializes four real reservations to at most three admitted images", async () => {
    const body = await bytes(), outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => upload(randomUUID(), body)));
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(3);
    expect(outcomes.filter(item => item.status === "rejected")).toEqual([expect.objectContaining({ reason: expect.objectContaining({ status: 409 }) })]);
    expect(await rows()).toHaveLength(3); expect(await service.list(actor(), companyId, feedbackId)).toHaveLength(3);
  });
  it("refuses another member and withdrawn native membership before returning protected bytes", async () => {
    const image = await upload();
    await expect(service.read(actor(otherUser), companyId, feedbackId, image.id)).rejects.toMatchObject({ status: 404 });
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    await expect(service.read(actor(), companyId, feedbackId, image.id)).rejects.toMatchObject({ status: 403 });
    await expect(service.remove(actor(), companyId, feedbackId, image.id)).rejects.toMatchObject({ status: 403 });
    expect((await rows())[0]!.status).toBe("ready");
  });
  it("does not expose a newly stored image after authority withdrawal, and retains only its exact owned cleanup candidate", async () => {
    const provider = createLocalDiskStorageProvider(join(directory, "objects"));
    const fenced = createStorageService({ ...provider, async putObject(input) {
      await provider.putObject(input);
      await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    } });
    const owner = customerFeedbackImageService(db, fenced, { scanner });
    await expect(owner.upload(actor(), companyId, feedbackId, randomUUID(), await bytes(), "image/png")).rejects.toMatchObject({ status: 403 });
    const [row] = await rows(); expect(row!.status).toBe("deleting");
    const pending = await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.companyId, companyId));
    expect(pending).toHaveLength(1); expect(pending[0]!.objectKey).toBe(row!.objectKey);
    expect(await processFeedbackImageDeletion(db, storage)).toBe(true);
    expect(await storage.headObject(companyId, row!.objectKey!)).toEqual({ exists: false });
    expect((await rows())[0]!.status).toBe("deleted");
  });
  it("retains the original allocated key after a real write loses its accounting acknowledgement and never performs an automatic second upload", async () => {
    const provider = createLocalDiskStorageProvider(join(directory, "objects")); let writes = 0;
    const uncertain = createStorageService({ ...provider, async putObject(input) { writes++; await provider.putObject(input); } }, {
      reserve: async () => {}, stored: async () => { throw new Error("owned-acknowledgement-lost"); }, deleting: async () => {}, deleted: async () => {},
    });
    const owner = customerFeedbackImageService(db, uncertain, { scanner }), key = randomUUID(), body = await bytes();
    await expect(owner.upload(actor(), companyId, feedbackId, key, body, "image/png")).rejects.toThrow("owned-acknowledgement-lost");
    const [row] = await rows(); expect(row!).toMatchObject({ status: "storing", objectKey: expect.any(String), transportSettledAt: null });
    expect((await uncertain.headObject(companyId, row!.objectKey!)).exists).toBe(true);
    expect(await owner.request(actor(), companyId, feedbackId, key)).toMatchObject({ id: row!.id, status: "storing" });
    await expect(owner.upload(actor(), companyId, feedbackId, key, body, "image/png")).rejects.toMatchObject({ status: 409 });
    expect(writes).toBe(1); expect(await processFeedbackImageDeletion(db, storage)).toBe(false);
  });
  it("preserves native allocation in the durable erasure owner when the original account path deletes feedback during an actual storage write", async () => {
    const provider = createLocalDiskStorageProvider(join(directory, "objects"));
    const erased = createStorageService({ ...provider, async putObject(input) {
      await provider.putObject(input); await db.transaction(tx => eraseAccountAccess(tx, userId));
    } });
    const owner = customerFeedbackImageService(db, erased, { scanner });
    await expect(owner.upload(actor(), companyId, feedbackId, randomUUID(), await bytes(), "image/png")).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(customerFeedback).where(eq(customerFeedback.id, feedbackId))).toEqual([]);
    expect(await rows()).toEqual([]);
    const pending = await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.companyId, companyId));
    expect(pending).toHaveLength(1); expect(pending[0]!.transportSettledAt).not.toBeNull();
    expect(await processFeedbackImageDeletion(db, storage)).toBe(true);
    expect(await storage.headObject(companyId, pending[0]!.objectKey)).toEqual({ exists: false });
  });
  it("does not label provider deletion as confirmed while the original protected object still exists", async () => {
    const image = await upload(), [row] = await rows(), provider = createLocalDiskStorageProvider(join(directory, "objects"));
    const ambiguous = customerFeedbackImageService(db, createStorageService({ ...provider, deleteObject: async () => {} }), { scanner });
    await expect(ambiguous.remove(actor(), companyId, feedbackId, image.id)).rejects.toMatchObject({ status: 409 });
    expect((await rows())[0]!).toMatchObject({ status: "deleting", deletedAt: null });
    expect((await storage.headObject(companyId, row!.objectKey!)).exists).toBe(true);
    const removed = await service.remove(actor(), companyId, feedbackId, image.id);
    expect(removed).toMatchObject({ status: "deleted", deletedAt: expect.any(String) });
    expect(await service.remove(actor(), companyId, feedbackId, image.id)).toEqual(removed);
    expect(await service.list(actor(), companyId, feedbackId)).toEqual([]);
  });
  it("rejects an unqualified scanner before allocation and frees only its failed native reservation", async () => {
    alwaysClean = true;
    await expect(upload()).rejects.toMatchObject({ status: 422 });
    const [row] = await rows(); expect(row!).toMatchObject({ status: "failed", objectKey: null });
    expect(await service.list(actor(), companyId, feedbackId)).toEqual([]);
  });
  it("requires the original verified operator, keeps immutable receipts, and rejects stale or changed commands", async () => {
    const controls = customerFeedbackRetentionService(db, { operatorUserIds: [otherUser] });
    const input = { requestKey: randomUUID(), expectedVersion: 0, confirmRetentionChange: true as const,
      legalHold: { active: true, releaseAt: null, reason: "Owned incident fixture" }, extensionUntil: null, extensionReason: "" };
    await expect(controls.change(actor(), companyId, feedbackId, input)).rejects.toMatchObject({ status: 403 });
    await expect(controls.change({ ...actor(otherUser), source: "local_implicit" }, companyId, feedbackId, input)).rejects.toMatchObject({ status: 403 });
    const first = await controls.change(actor(otherUser), companyId, feedbackId, input);
    expect(first).toMatchObject({ version: 1, legalHold: input.legalHold });
    expect(await controls.change(actor(otherUser), companyId, feedbackId, input)).toEqual(first);
    await expect(controls.change(actor(otherUser), companyId, feedbackId, { ...input, legalHold: { ...input.legalHold, reason: "Changed reason" } })).rejects.toMatchObject({ status: 409 });
    await expect(controls.change(actor(otherUser), companyId, feedbackId, { ...input, requestKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
    await expect(db.delete(customerFeedbackRetention).where(eq(customerFeedbackRetention.feedbackId, feedbackId))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.delete(customerFeedbackRetentionChanges).where(eq(customerFeedbackRetentionChanges.feedbackId, feedbackId))).rejects.toMatchObject({ cause: { code: "23514" } });
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.action, "customer_feedback.retention_changed")));
    expect(audit).toHaveLength(1); expect(audit[0]!.details).toBeNull(); expect(audit[0]!.entityId).not.toBe(feedbackId);
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, otherUser));
    await expect(controls.get(actor(otherUser), companyId, feedbackId)).rejects.toMatchObject({ status: 403 });
  });
  it("preserves held content during explicit account erasure and completes only after release and actual object removal", async () => {
    feedbackId = (await customerFeedbackService(db).create(actor(), companyId, { idempotencyKey: randomUUID(), category: "BUG",
      body: "Named held fixture", omitName: false, context: { surfaceKey: "home", locale: "en", timezone: "UTC", viewportClass: "wide" } })).id;
    const image = await upload(), [row] = await rows();
    const controls = customerFeedbackRetentionService(db, { operatorUserIds: [otherUser] });
    const held = await controls.change(actor(otherUser), companyId, feedbackId, {
      requestKey: randomUUID(), expectedVersion: 0, confirmRetentionChange: true,
      legalHold: { active: true, releaseAt: null, reason: "Owned legal hold fixture" }, extensionUntil: null, extensionReason: "",
    });
    expect((await controls.plan(actor(otherUser), companyId, feedbackId)).held).toBe(true);
    await expect(service.remove(actor(), companyId, feedbackId, image.id)).rejects.toMatchObject({ status: 409 });
    await expect(db.delete(customerFeedback).where(eq(customerFeedback.id, feedbackId))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.delete(customerFeedbackImages).where(eq(customerFeedbackImages.id, image.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    const password = "Owned fixture password 2026!", now = new Date();
    await db.insert(authAccounts).values({ id: randomUUID(), issuer: "local:credential", accountId: userId,
      providerId: "credential", userId, password: await hashPassword(password), createdAt: now, updatedAt: now });
    const account = accountDeletionService(db, { removeSecret: async () => {}, cancelRun: async () => {} });
    const operation = await account.request(userId, { confirmation: "DELETE MY ACCOUNT", password, acknowledgeExport: true, idempotencyKey: randomUUID() });
    expect(await db.select().from(customerFeedbackAccess).where(eq(customerFeedbackAccess.feedbackId, feedbackId))).toHaveLength(1);
    const [preserved] = await db.select().from(customerFeedback).where(eq(customerFeedback.id, feedbackId));
    expect(preserved).toMatchObject({ body: "Named held fixture", submittedByUserId: null, omitName: false });
    await expect(service.read(actor(), companyId, feedbackId, image.id)).rejects.toMatchObject({ status: 403 });
    await account.processOne(new Date(Date.now() + 1000));
    const state = async () => (await db.select().from(accountDeletionOperations).where(eq(accountDeletionOperations.id, operation.id)))[0]!;
    expect(await state()).toMatchObject({ status: "processing", errorCode: "account_erasure_pending", completedAt: null });
    // The original private operator can release a hold even after archiving;
    // revoked member authority is never recreated to make DSR proceed.
    await db.update(companies).set({ status: "archived" }).where(eq(companies.id, companyId));
    await controls.change(actor(otherUser), companyId, feedbackId, { requestKey: randomUUID(), expectedVersion: held.version,
      confirmRetentionChange: true, legalHold: { active: false, releaseAt: null, reason: "" }, extensionUntil: null, extensionReason: "" });
    await account.processOne(new Date(Date.now() + 60000));
    expect(await state()).toMatchObject({ status: "processing", errorCode: "account_erasure_pending", completedAt: null });
    expect(await rows()).toEqual([]);
    const pending = await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.accountDeletionId, operation.id));
    expect(pending).toHaveLength(1); expect(pending[0]!.deletedAt).toBeNull();
    expect(await processFeedbackImageDeletion(db, storage, operation.id)).toBe(true);
    expect(await storage.headObject(companyId, row!.objectKey!)).toEqual({ exists: false });
    await account.processOne(new Date(Date.now() + 120000));
    expect(await state()).toMatchObject({ status: "completed", errorCode: null, completedAt: expect.any(Date) });
    expect(await db.select().from(authUsers).where(eq(authUsers.id, userId))).toEqual([]);
  });
  it("blocks new holds while the original image operation is unconfirmed", async () => {
    const provider = createLocalDiskStorageProvider(join(directory, "objects"));
    const uncertain = customerFeedbackImageService(db, createStorageService(provider, {
      reserve: async () => {}, stored: async () => { throw Error("owned-ack-lost"); }, deleting: async () => {}, deleted: async () => {},
    }), { scanner });
    await expect(uncertain.upload(actor(), companyId, feedbackId, randomUUID(), await bytes(), "image/png")).rejects.toThrow("owned-ack-lost");
    const controls = customerFeedbackRetentionService(db, { operatorUserIds: [otherUser] });
    await expect(controls.change(actor(otherUser), companyId, feedbackId, { requestKey: randomUUID(), expectedVersion: 0,
      confirmRetentionChange: true, legalHold: { active: true, releaseAt: null, reason: "Owned hold" }, extensionUntil: null, extensionReason: "" })).rejects.toMatchObject({ status: 409 });
    expect(await controls.get(actor(otherUser), companyId, feedbackId)).toMatchObject({ version: 0 });
  });
  it("charges actual scanner attempts against the original budget and keeps receipt replay free", async () => {
    const body = await bytes(), requestKey = randomUUID(), first = await upload(requestKey, body), count = scanned.length;
    const digest = (value: string) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const key = `customer-feedback:${digest(userId)}:${digest(companyId)}`;
    await db.update(authRateLimits).set({ count: 20 }).where(eq(authRateLimits.key, key));
    expect(await upload(requestKey, body)).toEqual(first); expect(scanned).toHaveLength(count);
    await expect(upload(randomUUID(), body)).rejects.toMatchObject({ status: 429 });
    expect(scanned).toHaveLength(count); expect(await rows()).toHaveLength(1);
  });
  it("records closure from the native clock, preserves it on repeat closure, and clears it on reopening", async () => {
    const owner = customerFeedbackService(db, { operatorUserIds: [otherUser] });
    const original = (await db.select().from(customerFeedback).where(eq(customerFeedback.id, feedbackId)))[0]!;
    expect(original.closedAt).toBeNull();
    await owner.triage(actor(otherUser), companyId, feedbackId, { idempotencyKey: randomUUID(), expectedVersion: original.version, internalState: "RESOLVED_FIXED" });
    const closed = (await db.select().from(customerFeedback).where(eq(customerFeedback.id, feedbackId)))[0]!;
    expect(closed.closedAt).toBeInstanceOf(Date); expect(closed.closedAt!.getTime()).toBeGreaterThanOrEqual(original.createdAt.getTime());
    await owner.triage(actor(otherUser), companyId, feedbackId, { idempotencyKey: randomUUID(), expectedVersion: closed.version, internalState: "CLOSED_NO_ACTION" });
    const again = (await db.select().from(customerFeedback).where(eq(customerFeedback.id, feedbackId)))[0]!;
    expect(again.closedAt).toEqual(closed.closedAt);
    await owner.triage(actor(otherUser), companyId, feedbackId, { idempotencyKey: randomUUID(), expectedVersion: again.version, internalState: "UNDER_REVIEW" });
    expect((await db.select().from(customerFeedback).where(eq(customerFeedback.id, feedbackId)))[0]!.closedAt).toBeNull();
    await expect(db.update(customerFeedback).set({ body: "Cannot replace original content", version: again.version + 2 }).where(eq(customerFeedback.id, feedbackId)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("preserves company/request/content ownership under direct native writes and refuses premature erasure-receipt deletion", async () => {
    const image = await upload(), [row] = await rows();
    await expect(db.update(customerFeedbackImages).set({ sha256: "a".repeat(64) }).where(eq(customerFeedbackImages.id, image.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(customerFeedbackImages).set({ companyId: randomUUID() }).where(eq(customerFeedbackImages.id, image.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
    await db.delete(customerFeedback).where(eq(customerFeedback.id, feedbackId));
    const [pending] = await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.imageId, row!.id));
    expect(pending!.objectKey).toBe(row!.objectKey);
    await expect(db.delete(feedbackImageDeletions).where(eq(feedbackImageDeletions.id, pending!.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("returns protected no-store responses and does not open the original closed intake policy during source construction", async () => {
    const image = await upload(), application = express(); application.use(express.json());
    application.use((req, _res, next) => { req.actor = actor(); next(); });
    application.use("/api", customerFeedbackRoutes(db, { storage, runtimeEnv: {} })); application.use(errorHandler);
    const base = `/api/companies/${companyId}/customer-feedback/${feedbackId}/images`;
    const response = await request(application).get(base + "/" + image.id).expect(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-type"]).toContain("image/png");
    const changed = await request(application).get(base + "/" + image.id + "?expectedUserId=other").expect(409);
    expect(changed.headers["cache-control"]).toBe("private, no-store");
    await request(application).post(base).attach("file", await bytes(), "not-persisted-private-name.png").expect(422);
    expect(await rows()).toHaveLength(1);
    expect((await request(application).get("/api/customer-feedback/policy")).body.attachments.enabled).toBe(false);
  });
});
