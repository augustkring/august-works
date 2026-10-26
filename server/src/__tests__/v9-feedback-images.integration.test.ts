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
  customerFeedbackAccess, authAccounts, authSessions, accountDeletionOperations, activityLog, authRateLimits,
  billingAccounts, billingAccountCompanies,
  companyDeletionOperations } from "@paperclipai/db";
import { customerFeedbackService } from "../services/customer-feedback.js";
import { companyService } from "../services/companies.js";
import { customerFeedbackImageService, processFeedbackImageDeletion } from "../services/customer-feedback-images.js";
import { configuredFeedbackImageScanner } from "../services/feedback-image-intake.js";
import { createStorageService } from "../storage/service.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { saasOffboardingService } from "../services/saas/offboarding.js";
import { runtimeControlService } from "../services/runtime/control.js";
import type { companyObjectErasure } from "../services/saas/object-erasure.js";
import { billingService } from "../services/billing/billing.js";
import { paddleProvider } from "../services/billing/paddle-provider.js";
import { customerFeedbackRetentionService } from "../services/customer-feedback-retention.js";
import { accountDeletionService, eraseAccountAccess } from "../services/saas/account-deletion.js";
import { customerFeedbackRoutes } from "../routes/customer-feedback.js";
import { errorHandler } from "../middleware/error-handler.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";

describe("native selected feedback images with owned scanner-wire and filesystem fixtures", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let companyId: string, userId: string, otherUser: string, otherUserSessionId: string, feedbackId: string, directory: string,
    server: Server, scanner: NonNullable<ReturnType<typeof configuredFeedbackImageScanner>>,
    storage: ReturnType<typeof createStorageService>, service: ReturnType<typeof customerFeedbackImageService>;
  let scanned: Buffer[], sockets: Set<Socket>, alwaysClean: boolean;
  beforeAll(async () => {
    expect((await getEmbeddedPostgresTestSupport()).supported, "Actual migrated PostgreSQL is required; no silent skip").toBe(true);
    database = await startEmbeddedPostgresTestDatabase("aw-v9-feedback-images-"); db = createDb(database.connectionString);
  }, 60000);
  afterAll(async () => { if (database) { await closeRegisteredClients(database.connectionString); await database.cleanup(); } }, 30000);
  const actor = (principal = userId, includeOperatorSession = true) => ({ type: "board" as const, source: "session" as const,
    userId: principal, ...(principal === otherUser && includeOperatorSession ? { sessionId: otherUserSessionId } : {}), companyIds: [companyId] });
  beforeEach(async () => {
    companyId = randomUUID(); userId = randomUUID(); otherUser = randomUUID(); scanned = []; sockets = new Set(); alwaysClean = false;
    await db.insert(companies).values({ id: companyId, name: "Owned image fixture", issuePrefix: `I${companyId.slice(0, 7)}` });
    for (const id of [userId, otherUser]) {
      await db.insert(authUsers).values({ id, name: "Owned test member", email: `${id}@example.test`, emailVerified: true,
        createdAt: new Date(), updatedAt: new Date() });
      await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: id, status: "active", membershipRole: "viewer" });
    }
    const [billingAccount] = await db.insert(billingAccounts).values({ displayName: "Owned image fixture", payerUserId: userId }).returning({ id: billingAccounts.id });
    await db.insert(billingAccountCompanies).values({ billingAccountId: billingAccount!.id, companyId });
    otherUserSessionId = await seedNativePasskeySession(db, otherUser);
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
  it("reconciles a protected allocation when Storage admission refuses before any provider PUT", async () => {
    const provider = createLocalDiskStorageProvider(join(directory, "admission-refused"));
    let puts = 0, stored = 0;
    const deniedStorage = createStorageService({ ...provider, async putObject(input) { puts++; return provider.putObject(input); } }, {
      reserve: async () => { throw Error("owned-storage-admission-refused"); }, stored: async () => { stored++; },
      deleting: async () => {}, deleted: async () => {},
    });
    const denied = customerFeedbackImageService(db, deniedStorage, { scanner });
    await expect(denied.upload(actor(), companyId, feedbackId, randomUUID(), await bytes(), "image/png"))
      .rejects.toThrow("owned-storage-admission-refused");
    const [row] = await rows();
    expect(row).toMatchObject({ status: "deleting", objectKey: expect.any(String), transportSettledAt: expect.any(Date) });
    expect(puts).toBe(0); expect(stored).toBe(0);
    expect(await deniedStorage.headObject(companyId, row!.objectKey!)).toEqual({ exists: false });
    expect(await processFeedbackImageDeletion(db, deniedStorage, undefined, companyId, row!.id)).toBe(true);
    expect((await rows())[0]).toMatchObject({ status: "deleted", deletedAt: expect.any(Date) });
    const [receipt] = await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.imageId, row!.id));
    expect(receipt).toMatchObject({ transportSettledAt: expect.any(Date), deletedAt: expect.any(Date) });
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
    const uncertain = createStorageService({ ...provider, async putObject(input) {
      writes++; await provider.putObject(input); throw new Error("owned-acknowledgement-lost");
    } });
    const owner = customerFeedbackImageService(db, uncertain, { scanner }), key = randomUUID(), body = await bytes();
    await expect(owner.upload(actor(), companyId, feedbackId, key, body, "image/png")).rejects.toThrow("owned-acknowledgement-lost");
    const [row] = await rows(); expect(row!).toMatchObject({ status: "storing", objectKey: expect.any(String), transportSettledAt: null });
    expect((await uncertain.headObject(companyId, row!.objectKey!)).exists).toBe(true);
    expect(await owner.request(actor(), companyId, feedbackId, key)).toMatchObject({ id: row!.id, status: "storing" });
    await expect(owner.upload(actor(), companyId, feedbackId, key, body, "image/png")).rejects.toMatchObject({ status: 409 });
    expect(writes).toBe(1); expect(await processFeedbackImageDeletion(db, storage)).toBe(false);
  });
  it("uses the original fulfilled provider receipt to clean a failed accounting acknowledgement without another PUT", async () => {
    const provider = createLocalDiskStorageProvider(join(directory, "objects")); let writes = 0;
    const accountLost = createStorageService({ ...provider, async putObject(input) { writes++; await provider.putObject(input); } }, {
      reserve: async () => {}, stored: async () => { throw Error("owned-accounting-ack-lost"); }, deleting: async () => {}, deleted: async () => {},
    });
    const owner = customerFeedbackImageService(db, accountLost, { scanner }), key = randomUUID(), body = await bytes();
    await expect(owner.upload(actor(), companyId, feedbackId, key, body, "image/png")).rejects.toThrow("owned-accounting-ack-lost");
    const [row] = await rows(); expect(row).toMatchObject({ status: "deleting", objectKey: expect.any(String), transportSettledAt: expect.any(Date) });
    await expect(owner.upload(actor(), companyId, feedbackId, key, body, "image/png")).rejects.toMatchObject({ status: 409 });
    expect(writes).toBe(1);
    expect(await processFeedbackImageDeletion(db, accountLost)).toBe(true);
    expect(await accountLost.headObject(companyId, row!.objectKey!)).toEqual({ exists: false });
    expect(await owner.request(actor(), companyId, feedbackId, key)).toMatchObject({ id: row!.id, status: "deleted" });
    expect(writes).toBe(1);
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
  it("confirms the exact durable cleanup receipt when the submitter removes a failed accounting candidate", async () => {
    const provider = createLocalDiskStorageProvider(join(directory, "objects"));
    const accountLost = createStorageService(provider, {
      reserve: async () => {}, stored: async () => { throw Error("owned-accounting-ack-lost"); }, deleting: async () => {}, deleted: async () => {},
    });
    const owner = customerFeedbackImageService(db, accountLost, { scanner });
    await expect(owner.upload(actor(), companyId, feedbackId, randomUUID(), await bytes(), "image/png")).rejects.toThrow("owned-accounting-ack-lost");
    const [row] = await rows();
    expect(row!.status).toBe("deleting");
    const removed = await owner.remove(actor(), companyId, feedbackId, row!.id);
    expect(removed).toMatchObject({ status: "deleted", deletedAt: expect.any(String) });
    const [receipt] = await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.imageId, row!.id));
    expect(receipt).toMatchObject({ companyId, objectKey: row!.objectKey, transportSettledAt: expect.any(Date), deletedAt: expect.any(Date) });
    expect(await accountLost.headObject(companyId, row!.objectKey!)).toEqual({ exists: false });
    expect(await owner.remove(actor(), companyId, feedbackId, row!.id)).toEqual(removed);
    expect(await processFeedbackImageDeletion(db, accountLost, undefined, companyId)).toBe(false);
    const [unchanged] = await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.imageId, row!.id));
    expect(unchanged).toEqual(receipt);
  });
  it("cancels an unallocated reservation and refuses the late original allocation without writing any object", async () => {
    let enter!: () => void, release!: () => void, writes = 0;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const provider = createLocalDiskStorageProvider(join(directory, "objects"));
    const transport = createStorageService({ ...provider, async putObject(input) { writes++; await provider.putObject(input); } });
    const delayed = { ...transport, async putFile(input: Parameters<typeof transport.putFile>[0]) {
      enter(); await gate; return transport.putFile(input);
    } };
    const owner = customerFeedbackImageService(db, delayed, { scanner }), key = randomUUID();
    const pending = owner.upload(actor(), companyId, feedbackId, key, await bytes(), "image/png")
      .then(value => ({ value }), error => ({ error }));
    try {
      await entered;
      const [row] = await rows(); expect(row).toMatchObject({ status: "scanning", objectKey: null });
      const removed = await owner.remove(actor(), companyId, feedbackId, row!.id);
      expect(removed).toMatchObject({ status: "deleted", byteSize: null, deletedAt: expect.any(String) });
      release();
      expect(await pending).toMatchObject({ error: { status: 409 } });
      expect(await owner.request(actor(), companyId, feedbackId, key)).toEqual(removed);
      expect(await owner.remove(actor(), companyId, feedbackId, row!.id)).toEqual(removed);
      expect(writes).toBe(0); expect(await owner.list(actor(), companyId, feedbackId)).toEqual([]);
      expect(await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.companyId, companyId))).toEqual([]);
    } finally { release(); await pending; }
  });
  it("keeps a storing reservation pending while its actual provider PUT is still in flight", async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const provider = createLocalDiskStorageProvider(join(directory, "objects"));
    const delayed = createStorageService({ ...provider, async putObject(input) {
      enter(); await gate; await provider.putObject(input);
    } });
    const owner = customerFeedbackImageService(db, delayed, { scanner });
    const pending = owner.upload(actor(), companyId, feedbackId, randomUUID(), await bytes(), "image/png")
      .then(value => ({ value }), error => ({ error }));
    try {
      await entered;
      const [row] = await rows(); expect(row).toMatchObject({ status: "storing", objectKey: expect.any(String), transportSettledAt: null });
      await expect(owner.remove(actor(), companyId, feedbackId, row!.id)).rejects.toMatchObject({ status: 409 });
      expect((await rows())[0]!.deletedAt).toBeNull();
      release(); expect(await pending).toMatchObject({ value: { status: "ready" } });
      expect(await owner.remove(actor(), companyId, feedbackId, row!.id)).toMatchObject({ status: "deleted" });
      expect(await delayed.headObject(companyId, row!.objectKey!)).toEqual({ exists: false });
    } finally { release(); await pending; }
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
    // Structural native session admission plus the maintained password verifier;
    // this fixture does not claim an HTTP sign-in ceremony.
    const sessionId = randomUUID();
    const [nativeUser] = await db.select({ version: authUsers.authenticatorVersion }).from(authUsers).where(eq(authUsers.id, userId));
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 3600000), authenticationMethod: "password", authenticatedAt: now,
      authenticatorVersion: nativeUser!.version });
    const operation = await account.request(userId, { confirmation: "DELETE MY ACCOUNT", password, acknowledgeExport: true, idempotencyKey: randomUUID() },
      now, { ...actor(), sessionId });
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
  it("blocks company object erasure on a native hold and waits for exact protected-image cleanup before company completion", async () => {
    const image = await upload(), [row] = await rows();
    const controls = customerFeedbackRetentionService(db, { operatorUserIds: [otherUser] });
    const held = await controls.change(actor(otherUser), companyId, feedbackId, { requestKey: randomUUID(), expectedVersion: 0,
      confirmRetentionChange: true, legalHold: { active: true, releaseAt: null, reason: "Owned company hold" }, extensionUntil: null, extensionReason: "" });
    await db.update(companyMemberships).set({ membershipRole: "owner" }).where(and(
      eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    // Explicit software bulk-object transport; actual owned image removal
    // below uses the original local filesystem Storage, not a fake HEAD.
    let bulkCalls = 0;
    const objects = { targets: () => ({ application: { bucket: "owned-transport-fixture", prefix: companyId + "/" } }),
      erase: async () => { bulkCalls++; return {}; } } as unknown as ReturnType<typeof companyObjectErasure>;
    const billing = billingService(db, { environment: "sandbox", payloadKey: "a".repeat(64), payloadKeyId: "fixture",
      previousKeys: {}, graceDays: 7 }, paddleProvider({ environment: "sandbox", apiKey: "not-used" }, async () => {
      throw new Error("billing provider must not be contacted without subscriptions");
    }));
    const owner = saasOffboardingService(db, billing, runtimeControlService(db), objects);
    await owner.request(companyId, userId, { confirmation: "Owned image fixture", acknowledgeExport: true, idempotencyKey: randomUUID() });
    const now = Date.now();
    // Drive the original revoke/runtime/billing/retention stages. The legal
    // hold is checked only when real purge reaches source-authorized admission.
    for (const seconds of [1, 2, 3, 4, 5]) await owner.processOne(new Date(now + seconds * 1000));
    const admittedOperation = await db.select({ stage: companyDeletionOperations.stage, status: companyDeletionOperations.status,
      errorCode: companyDeletionOperations.errorCode }).from(companyDeletionOperations).where(eq(companyDeletionOperations.companyId, companyId));
    expect(admittedOperation).toMatchObject([{ stage: "purge", status: "processing", errorCode: "offboarding_reconciliation_pending" }]);
    expect(bulkCalls).toBe(0); expect((await storage.headObject(companyId, row!.objectKey!)).exists).toBe(true);
    expect(await owner.get(companyId)).toMatchObject({ status: "processing", completedAt: null });
    await controls.change(actor(otherUser), companyId, feedbackId, { requestKey: randomUUID(), expectedVersion: held.version,
      confirmRetentionChange: true, legalHold: { active: false, releaseAt: null, reason: "" }, extensionUntil: null, extensionReason: "" });
    await expect(controls.change(actor(otherUser), companyId, feedbackId, { requestKey: randomUUID(), expectedVersion: held.version + 1,
      confirmRetentionChange: true, legalHold: { active: true, releaseAt: null, reason: "Too late to undo approved erasure" }, extensionUntil: null, extensionReason: "" }))
      .rejects.toMatchObject({ status: 409 });
    await owner.processOne(new Date(Date.now() + 120000));
    const retryState = await owner.get(companyId);
    expect(retryState).toMatchObject({ status: "processing", errorCode: null });
    expect(bulkCalls).toBe(1); expect(await rows()).toEqual([]);
    expect(retryState).toMatchObject({ status: "processing", completedAt: null });
    const pending = await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.companyId, companyId));
    expect(pending).toHaveLength(1); expect(pending[0]!.imageId).toBe(image.id); expect(pending[0]!.deletedAt).toBeNull();
    expect(await processFeedbackImageDeletion(db, storage, undefined, companyId)).toBe(true);
    expect(await storage.headObject(companyId, row!.objectKey!)).toEqual({ exists: false });
    await owner.processOne(new Date(Date.now() + 240000));
    expect(await owner.get(companyId)).toMatchObject({ status: "completed", completedAt: expect.any(Date) });
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
  function imageApplication(principal = userId, scan = true, selectedStorage = storage, includeOperatorSession = true) {
    const application = express(); application.use(express.json());
    application.use((req, _res, next) => { req.actor = actor(principal, includeOperatorSession); next(); });
    application.use("/api", customerFeedbackRoutes(db, { storage: selectedStorage, operatorUserIds: [otherUser], runtimeEnv: scan ? {
      AW_FEEDBACK_CLAMD_SOCKET: join(directory, "scanner.sock"), AW_FEEDBACK_CLAMD_UID: String(process.getuid?.()),
    } : {} })); application.use(errorHandler); return application;
  }
  const imageBase = () => `/api/companies/${companyId}/customer-feedback/${feedbackId}/images`;
  it("reports namespace-unknown storage unavailable and refuses intake before multipart parsing, scanning or provider work", async () => {
    let providerCalls = 0;
    const unknown = { ...storage, scopeId: undefined, async putFile() { providerCalls++; throw Error("Owned provider must not run"); } };
    const application = imageApplication(userId, true, unknown);
    const policy = await request(application).get("/api/customer-feedback/policy").expect(200);
    expect(policy.body.attachments).toMatchObject({ enabled: false, reason: "storage_qualification_required" });
    expect(policy.headers["cache-control"]).toBe("private, no-store"); expect(policy.body.ga.allowed).toBe(false);
    expect(JSON.stringify(policy.body)).not.toContain(directory); expect(policy.body.attachments).not.toHaveProperty("scopeId");
    await request(application).post(imageBase()).set("X-AW-Feedback-Request-Key", randomUUID())
      .set("Content-Type", "multipart/form-data; boundary=owned-invalid-envelope").send("invalid-envelope").expect(422);
    expect(providerCalls).toBe(0); expect(scanned).toEqual([]); expect(await rows()).toEqual([]);
    const digest = (value: string) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const budgetKey = `customer-feedback:${digest(userId)}:${digest(companyId)}`;
    const budgets = await db.select().from(authRateLimits).where(eq(authRateLimits.key, budgetKey));
    expect(budgets).toHaveLength(1); expect(budgets[0]!.count).toBe(1);
  });
  it("accepts one explicitly selected HTTP image through native pre-body admission and charges the original budget once", async () => {
    const application = imageApplication(), key = randomUUID(), body = await bytes();
    const policy = await request(application).get("/api/customer-feedback/policy").expect(200);
    expect(policy.body.attachments).toMatchObject({ enabled: true, reason: "validation_required", maxFiles: 3, maxBytes: 10485760 });
    expect(policy.body.ga.allowed).toBe(false);
    const response = await request(application).post(imageBase()).set("X-AW-Feedback-Request-Key", key)
      .attach("file", body, "private-local-name-never-persist.png").expect(201);
    expect(response.body).toMatchObject({ status: "ready", companyId, feedbackId });
    const [row] = await rows(); expect(row!.objectKey).not.toContain("private-local-name");
    const digest = (value: string) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const budgetKey = `customer-feedback:${digest(userId)}:${digest(companyId)}`;
    const [budget] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, budgetKey));
    expect(budget!.count).toBe(2); // Original feedback creation plus one HTTP byte intake.
    const result = await request(application).get(imageBase() + "/" + response.body.id).expect(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    expect((await sharp(result.body).metadata()).format).toBe("png");
    const replay = await request(application).post(imageBase()).set("X-AW-Feedback-Request-Key", key)
      .attach("file", body, "another-local-name.png").expect(201);
    expect(replay.body).toEqual(response.body); expect(await rows()).toHaveLength(1);
  });
  it("refuses exhausted native budget and a failed actual scanner control before parsing an invalid multipart body", async () => {
    const digest = (value: string) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const budgetKey = `customer-feedback:${digest(userId)}:${digest(companyId)}`;
    await db.update(authRateLimits).set({ count: 20 }).where(eq(authRateLimits.key, budgetKey));
    await request(imageApplication()).post(imageBase()).set("X-AW-Feedback-Request-Key", randomUUID())
      .set("Content-Type", "multipart/form-data; boundary=owned-invalid-envelope").send("invalid-envelope").expect(429);
    expect(scanned).toEqual([]); expect(await rows()).toEqual([]);
    await db.update(authRateLimits).set({ count: 1 }).where(eq(authRateLimits.key, budgetKey)); alwaysClean = true;
    await request(imageApplication()).post(imageBase()).set("X-AW-Feedback-Request-Key", randomUUID())
      .set("Content-Type", "multipart/form-data; boundary=owned-invalid-envelope").send("invalid-envelope").expect(422);
    expect(scanned.length).toBeGreaterThan(0); expect(await rows()).toEqual([]);
  });
  it("bounds the HTTP envelope, refuses extra files and fields, and validates actual image content", async () => {
    const application = imageApplication(), body = await bytes();
    await request(application).post(imageBase()).set("X-AW-Feedback-Request-Key", randomUUID())
      .attach("file", body, "one.png").attach("file", body, "two.png").expect(422);
    await request(application).post(imageBase()).set("X-AW-Feedback-Request-Key", randomUUID())
      .field("private-extra-field", "not-accepted").attach("file", body, "one.png").expect(422);
    await request(application).post(imageBase()).set("X-AW-Feedback-Request-Key", randomUUID())
      .attach("file", Buffer.alloc(10485761), "too-large.png").expect(422);
    expect(await rows()).toEqual([]);
    await request(application).post(imageBase()).set("X-AW-Feedback-Request-Key", randomUUID())
      .attach("file", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "mislabelled.png").expect(422);
    const [failed] = await rows(); expect(failed).toMatchObject({ status: "failed", objectKey: null });
  });
  it("keeps HTTP ingress admission server-local, scoped to the original principal and single-use", async () => {
    const body = await bytes(), key = randomUUID();
    await expect(service.upload(actor(), companyId, feedbackId, key, body, "image/png", { admitted: true })).rejects.toMatchObject({ status: 409 });
    expect(await rows()).toEqual([]);
    const admission = await service.admitUpload(actor(), companyId, feedbackId, key);
    const image = await service.upload(actor(), companyId, feedbackId, key, body, "image/png", admission);
    expect(image.status).toBe("ready");
    await expect(service.upload(actor(), companyId, feedbackId, key, body, "image/png", admission)).rejects.toMatchObject({ status: 409 });
    expect(await rows()).toHaveLength(1);
  });
  it("uses separate current internal operator authority for protected image views and rechecks it after object I/O", async () => {
    const image = await upload();
    await request(imageApplication(otherUser)).get(imageBase() + "/" + image.id).expect(404);
    const internal = `/api/internal/customer-feedback/${companyId}/${feedbackId}/images`;
    await request(imageApplication(otherUser, true, storage, false)).get(internal).expect(403);
    await request(imageApplication(userId)).get(internal).expect(403);
    const listed = await request(imageApplication(otherUser)).get(internal).expect(200);
    expect(listed.body).toEqual([image]);
    const read = await request(imageApplication(otherUser)).get(internal + "/" + image.id).expect(200);
    expect(read.headers["cache-control"]).toBe("private, no-store");
    expect(read.headers["x-content-type-options"]).toBe("nosniff");
    const changed = { ...storage, async getObject(company: string, key: string) {
      const object = await storage.getObject(company, key);
      await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, otherUser));
      return object;
    } };
    const owner = customerFeedbackImageService(db, changed, { scanner, operatorUserIds: [otherUser] });
    await expect(owner.internalRead(actor(otherUser), companyId, feedbackId, image.id)).rejects.toMatchObject({ status: 403 });
  });
  it("retains an explicit removal receipt when account authority changes after actual provider deletion", async () => {
    const image = await upload(), [row] = await rows();
    const changed = { ...storage, async deleteObject(company: string, key: string) {
      await storage.deleteObject(company, key);
      await db.update(companyMemberships).set({ status: "inactive" }).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    } };
    const owner = customerFeedbackImageService(db, changed, { scanner });
    await expect(owner.remove(actor(), companyId, feedbackId, image.id)).rejects.toMatchObject({ status: 403 });
    expect((await rows())[0]).toMatchObject({ status: "deleting", deletedAt: null });
    const [pending] = await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.imageId, image.id));
    expect(pending).toMatchObject({ companyId, objectKey: row!.objectKey, transportSettledAt: expect.any(Date), deletedAt: null });
    expect(await storage.headObject(companyId, row!.objectKey!)).toEqual({ exists: false });
    expect(await processFeedbackImageDeletion(db, storage, undefined, companyId)).toBe(true);
    expect((await rows())[0]).toMatchObject({ status: "deleted", deletedAt: expect.any(Date) });
  });
  it("bounds concurrent HTTP scanner/buffer/storage work and admits new input after the original transports settle", async () => {
    const ids = [feedbackId];
    for (let index = 0; index < 3; index++) ids.push((await customerFeedbackService(db).create(actor(), companyId, {
      idempotencyKey: randomUUID(), category: "BUG", body: "Owned concurrent image case", omitName: true,
      context: { surfaceKey: "home", locale: "en", timezone: "UTC", viewportClass: "wide" },
    })).id);
    let enter!: () => void, release!: () => void, writes = 0;
    const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const provider = createLocalDiskStorageProvider(join(directory, "objects"));
    const bounded = createStorageService({ ...provider, async putObject(input) {
      writes++; if (writes === 4) enter(); await gate; await provider.putObject(input);
    } });
    const application = imageApplication(userId, true, bounded), body = await bytes();
    const pending = ids.map(id => request(application).post(`/api/companies/${companyId}/customer-feedback/${id}/images`)
      .set("X-AW-Feedback-Request-Key", randomUUID()).attach("file", body, "owned.png")
      .then(value => ({ value }), error => ({ error })));
    try {
      await Promise.race([entered, ...pending.map(async result => {
        await result; throw Error("An owned HTTP request settled before all four original PUTs were in flight");
      })]);
      const count = scanned.length;
      await request(application).post(imageBase()).set("X-AW-Feedback-Request-Key", randomUUID())
        .set("Content-Type", "multipart/form-data; boundary=owned-invalid-envelope").send("invalid-envelope").expect(429);
      expect(scanned).toHaveLength(count); expect(writes).toBe(4);
      release();
      for (const result of await Promise.all(pending)) expect(result).toMatchObject({ value: { status: 201, body: { status: "ready" } } });
      await request(application).post(imageBase()).set("X-AW-Feedback-Request-Key", randomUUID()).attach("file", body, "next.png").expect(201);
      expect(writes).toBe(5);
    } finally { release(); await Promise.all(pending); }
  });
  it("refuses a same-company foreign-case object key under the actual native reservation fence", async () => {
    const [row] = await db.insert(customerFeedbackImages).values({ companyId, feedbackId, requestKey: randomUUID(),
      requestHash: "a".repeat(64), mediaType: "image/png", leaseToken: randomUUID(), leaseExpiresAt: sql`clock_timestamp()+interval '120 seconds'`,
    }).returning();
    await expect(db.update(customerFeedbackImages).set({ status: "storing", objectKey: `${companyId}/feedback-images/${randomUUID()}/${row!.id}/owned.png`,
      byteSize: 3, sha256: "a".repeat(64), scannerToken: "b".repeat(64), scanCheckedAt: new Date(),
    }).where(eq(customerFeedbackImages.id, row!.id))).rejects.toMatchObject({ cause: { code: "23514", message: "Protected image path requires its exact original owner" } });
    expect((await rows())[0]).toMatchObject({ status: "scanning", objectKey: null });
  });
  it("blocks legacy local company completion until the original protected objects and erasure receipts are confirmed", async () => {
    const image = await upload(), [row] = await rows(), local = companyService(db);
    await expect(local.remove(companyId)).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(companies).where(eq(companies.id, companyId))).toHaveLength(1);
    expect(await db.select().from(customerFeedback).where(eq(customerFeedback.id, feedbackId))).toHaveLength(1);
    expect((await storage.headObject(companyId, row!.objectKey!)).exists).toBe(true);
    expect(await service.remove(actor(), companyId, feedbackId, image.id)).toMatchObject({ status: "deleted" });
    expect(await local.remove(companyId)).toMatchObject({ id: companyId });
    expect(await db.select().from(companies).where(eq(companies.id, companyId))).toEqual([]);
    expect(await storage.headObject(companyId, row!.objectKey!)).toEqual({ exists: false });
    expect(await db.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.companyId, companyId)))
      .toEqual([expect.objectContaining({ deletedAt: expect.any(Date) })]);
  });
});
