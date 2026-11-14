import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, agentApiKeys, authSessions, authUsers, companies, companyMemberships, companyTransferRuns, createDb } from "@paperclipai/db";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { companyRoutes } from "../routes/companies.js";
import { companyExportTransferService, drainCompanyExportWorkers } from "../services/company-export-transfers.js";
import { companyPortabilityService } from "../services/company-portability.js";
import { agentService } from "../services/agents.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { createStorageService } from "../storage/service.js";
import type { StorageProvider } from "../storage/types.js";
import { seedNativePasskeyActor } from "./helpers/native-authentication-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;

describePostgres("original credential-bound durable company export", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("company-export-authority-"); db = createDb(database.connectionString); });
  afterAll(async () => { if (db) { await drainCompanyExportWorkers(db); await db.$client.end({ timeout: 5 }); } await database?.cleanup(); });

  it("keeps one private artifact, original deadlines and current-source download authority through actual HTTP routes", async () => {
    const companyId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID();
    const name = "Original export source";
    await db.insert(companies).values({ id: companyId, name, issuePrefix: `EX${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}` });
    await db.insert(authUsers).values([userId, otherUserId].map(id => ({ id, name: "Export requester", email: `${id}@test.invalid`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([userId, otherUserId].map(principalId => ({ companyId, principalId, principalType: "user", membershipRole: "owner", status: "active" })));
    const actor = await seedNativePasskeyActor(db, userId, [companyId]);
    const otherActor = await seedNativePasskeyActor(db, otherUserId, [companyId]);
    const cookieFor = async (sessionId: string) => {
      const [session] = await db.select().from(authSessions).where(eq(authSessions.id, sessionId));
      return `session_token=${encodeURIComponent(session!.token)}`;
    };
    const cookie = await cookieFor(actor.sessionId), otherCookie = await cookieFor(otherActor.sessionId);
    const objects = new Map<string, Buffer>();
    let puts = 0, readMode: "normal" | "oversized" | "truncated" = "normal";
    let lastRead: Readable | undefined;
    const provider: StorageProvider = {
      id: "local_disk", scopeId: "b".repeat(64),
      async putObject(input) { puts++; objects.set(input.objectKey, Buffer.from(input.body as Buffer)); },
      async getObject({ objectKey }) {
        const bytes = objects.get(objectKey)!;
        lastRead = Readable.from(readMode === "oversized" ? [bytes, Buffer.from("extra")]
          : [readMode === "truncated" ? bytes.subarray(0, bytes.length - 1) : bytes]);
        return { stream: lastRead };
      },
      async headObject({ objectKey }) { return { exists: objects.has(objectKey), contentLength: objects.get(objectKey)?.length }; },
      async deleteObject({ objectKey }) { objects.delete(objectKey); },
      async eraseObject({ objectKey }) { objects.delete(objectKey); },
    };
    const storage = createStorageService(provider);
    const transfers = companyExportTransferService(db, storage, companyPortabilityService(db, storage));
    // Resolve an opaque fixture cookie against the real current DB session.
    // This is routing/domain assurance evidence, not a real sign-in ceremony.
    const app = express(); app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async req => {
      const token = (req.header("cookie") ?? "").split(";").map(s => s.trim()).find(s => s.startsWith("session_token="))?.slice("session_token=".length);
      if (!token) return null;
      const [session] = await db.select().from(authSessions).where(and(eq(authSessions.token, decodeURIComponent(token)), sql`${authSessions.expiresAt} > clock_timestamp()`));
      if (!session) return null;
      const [user] = await db.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email }).from(authUsers).where(eq(authUsers.id, session.userId));
      return user ? { session: { id: session.id, userId: session.userId, expiresAt: session.expiresAt }, user } : null;
    } }));
    app.use("/api/companies", companyRoutes(db, storage)); app.use(errorHandler);
    const path = `/api/companies/${companyId}/exports/transfers`, requestId = randomUUID();
    const selection = { include: { company: true, agents: false, skills: false, projects: false, issues: false, supportCases: false } };
    const unqualifiedStorage = createStorageService({ ...provider, eraseObject: undefined });
    await expect(companyExportTransferService(db, unqualifiedStorage, companyPortabilityService(db, unqualifiedStorage)).admit({
      companyId, requestId: randomUUID(), actorKey: `board:${userId}`, actor, request: selection,
    })).rejects.toMatchObject({ status: 409, details: { code: "company_export_storage_erasure_unqualified" } });
    expect((await request(app).post(`/api/companies/${companyId}/exports`).set("Cookie", cookie).send(selection)).status).toBe(200);
    expect(puts).toBe(0);
    const missingRequestId = await request(app).post(path).set("Cookie", cookie).send(selection);
    expect(missingRequestId.status).toBe(400);
    expect(missingRequestId.headers["cache-control"]).toBe("private, no-store");
    const accepted = await request(app).post(path).set("Cookie", cookie).set("Idempotency-Key", requestId).send(selection);
    expect(accepted.status).toBe(202); expect(accepted.headers["cache-control"]).toBe("private, no-store");
    const id = accepted.body.transferId as string;
    expect(id).toBeTruthy();
    await vi.waitFor(async () => {
      const row = await request(app).get(`${path}/${id}`).set("Cookie", cookie);
      expect(row.status).toBe(200); expect(row.body.status).toBe("completed");
      expect(row.body.artifact.availability).toBe("ready");
    }, { timeout: 10_000, interval: 20 });
    const [stored] = await db.select().from(companyTransferRuns).where(eq(companyTransferRuns.id, id));
    const snapshot = stored!.manifest as { authority: { credentialExpiresAt: number | null }; artifactExpiresAt: string };
    const originalCeiling = snapshot.authority.credentialExpiresAt;
    const originalArtifactExpiry = snapshot.artifactExpiresAt;
    expect(puts).toBe(1); expect(objects.size).toBe(1);
    const status = await request(app).get(`${path}/${id}`).set("Cookie", cookie);
    expect(status.headers["cache-control"]).toBe("private, no-store");
    expect(status.body).not.toHaveProperty("objectKey"); expect(status.body).not.toHaveProperty("authority");
    const downloaded = await request(app).get(`${path}/${id}/download`).set("Cookie", cookie);
    expect(downloaded.status).toBe(200); expect(downloaded.body.manifest.company.name).toBe(name);
    expect(downloaded.headers["cache-control"]).toBe("private, no-store");
    expect(downloaded.headers.etag).toBe(`"${status.body.artifact.sha256}"`);
    expect(downloaded.headers["content-disposition"]).toContain(`company-export-${id}.json`);
    const otherNamespace = companyExportTransferService(db,
      createStorageService({ ...provider, scopeId: "d".repeat(64) }), companyPortabilityService(db, storage));
    await expect(otherNamespace.download(companyId, id, stored!.actorKey, actor)).rejects.toMatchObject({ status: 409,
      details: { code: "company_export_storage_scope_changed" } });
    expect(objects.size).toBe(1);

    await db.update(authSessions).set({ expiresAt: new Date(Date.now() + 7_200_000) }).where(eq(authSessions.id, actor.sessionId));
    const replay = await request(app).post(path).set("Cookie", cookie).set("Idempotency-Key", requestId).send(selection);
    expect(replay.status).toBe(202); expect(replay.body).toMatchObject({ transferId: id, alreadyCompleted: true });
    const [replayed] = await db.select().from(companyTransferRuns).where(eq(companyTransferRuns.id, id));
    expect((replayed!.manifest as typeof snapshot).authority.credentialExpiresAt).toBe(originalCeiling);
    expect((replayed!.manifest as typeof snapshot).artifactExpiresAt).toBe(originalArtifactExpiry);
    expect(puts).toBe(1);
    expect((await request(app).post(path).set("Cookie", cookie).set("Idempotency-Key", requestId).send({ include: { company: false } })).status).toBe(409);
    expect((await request(app).get(`${path}/${id}`).set("Cookie", otherCookie)).status).toBe(404);
    expect((await request(app).get(`${path}/${id}/download`).set("Cookie", otherCookie)).status).toBe(404);
    const [originalSession] = await db.select().from(authSessions).where(eq(authSessions.id, actor.sessionId));
    const parallelSessionId = randomUUID();
    await db.insert(authSessions).values({ ...originalSession!, id: parallelSessionId, token: randomUUID() });
    expect((await request(app).get(`${path}/${id}/download`).set("Cookie", await cookieFor(parallelSessionId))).status).toBe(404);

    await db.update(companies).set({ name: "Changed authorized source" }).where(eq(companies.id, companyId));
    expect((await request(app).get(`${path}/${id}/download`).set("Cookie", cookie)).status).toBe(404);
    await db.update(companies).set({ name }).where(eq(companies.id, companyId));
    readMode = "oversized";
    expect((await request(app).get(`${path}/${id}/download`).set("Cookie", cookie)).status).toBe(409);
    expect(lastRead?.destroyed).toBe(true);
    readMode = "truncated";
    expect((await request(app).get(`${path}/${id}/download`).set("Cookie", cookie)).status).toBe(409);
    readMode = "normal";

    const expiredAt = new Date(Date.now() - 1000).toISOString();
    await db.execute(sql`update company_transfer_runs set container_ref=jsonb_set(container_ref,'{artifact,expiresAt}',${JSON.stringify(expiredAt)}::jsonb)
      where id=${id}::uuid`);
    await otherNamespace.recoverBatch(20);
    expect(objects.size).toBe(1);
    expect((await request(app).get(`${path}/${id}/download`).set("Cookie", cookie)).status).toBe(410);
    expect(objects.size).toBe(0);
    expect((await request(app).post(path).set("Cookie", cookie).set("Idempotency-Key", requestId).send(selection)).body.transferId).toBe(id);
    expect(puts).toBe(1);
    await db.delete(authSessions).where(eq(authSessions.id, actor.sessionId));
    await expect(transfers.getForActor(companyId, id, stored!.actorKey, actor)).rejects.toMatchObject({ status: 403 });
    expect((await request(app).get(`${path}/${id}/download`).set("Cookie", cookie)).status).not.toBe(200);
  });

  it("rechecks the exact CEO Agent key, responsible Human and current role without admitting Human-only selections", async () => {
    const companyId = randomUUID(), userId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Agent export scope", issuePrefix: `AK${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}` });
    await db.insert(authUsers).values({ id: userId, name: "Responsible export Human", email: `${userId}@test.invalid`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalId: userId, principalType: "user", membershipRole: "owner", status: "active" });
    const [agent] = await db.insert(agents).values({ companyId, name: "Export CEO", role: "ceo", status: "idle", adapterType: "process", adapterConfig: {} }).returning();
    const key = await agentService(db).createApiKey(agent!.id, "Original export key", { kind: "standard" }, { responsibleUserId: userId });
    const anotherKey = await agentService(db).createApiKey(agent!.id, "Other export key", { kind: "standard" }, { responsibleUserId: userId });
    const objects = new Map<string, Buffer>(); let puts = 0;
    let releaseKeyLock!: () => void, keyLockStarted!: () => void;
    const release = new Promise<void>(done => { releaseKeyLock = done; });
    const locked = new Promise<void>(done => { keyLockStarted = done; });
    let keyLock: Promise<void> | undefined;
    const storage = createStorageService({ id: "local_disk", scopeId: "c".repeat(64),
      async putObject(input) {
        puts++; objects.set(input.objectKey, Buffer.from(input.body as Buffer));
        keyLock = db.transaction(async tx => {
          await tx.select({ id: agentApiKeys.id }).from(agentApiKeys).where(eq(agentApiKeys.id, key.id)).for("update");
          keyLockStarted(); await release;
        });
        await locked;
      },
      async getObject({ objectKey }) { return { stream: Readable.from(objects.get(objectKey)!) }; },
      async headObject({ objectKey }) { return { exists: objects.has(objectKey) }; },
      async deleteObject({ objectKey }) { objects.delete(objectKey); },
      async eraseObject({ objectKey }) { objects.delete(objectKey); },
    });
    const app = express(); app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async () => null }));
    let originalActor: AuthorizationActor | undefined;
    app.use((req, _res, next) => { if (req.actor.type === "agent" && req.actor.keyId === key.id) originalActor = { ...req.actor }; next(); });
    app.use("/api/companies", companyRoutes(db, storage)); app.use(errorHandler);
    const path = `/api/companies/${companyId}/exports/transfers`, authorization = `Bearer ${key.token}`;
    expect((await request(app).post(path).set("Authorization", authorization).set("Idempotency-Key", randomUUID())
      .send({ include: { supportCases: true } })).status).toBe(403);
    expect((await request(app).post(path).set("Authorization", authorization).set("Idempotency-Key", randomUUID())
      .send({ includeV7State: true, expectedUserId: userId })).status).toBe(403);
    const accepted = await request(app).post(path).set("Authorization", authorization).set("Idempotency-Key", randomUUID())
      .send({ include: { company: true, agents: false, skills: false, projects: false, issues: false } });
    expect(accepted.status).toBe(202);
    const id = accepted.body.transferId as string;
    try {
      await vi.waitFor(async () => {
        const [deferred] = await db.select().from(companyTransferRuns).where(eq(companyTransferRuns.id, id));
        expect(deferred).toMatchObject({ status: "pending", error: "native_source_authority_busy" });
        expect(deferred!.containerRef).toMatchObject({ artifact: { state: "stored" } });
      }, { timeout: 5000, interval: 20 });
    } finally { releaseKeyLock(); await keyLock; }
    await vi.waitFor(async () => expect((await request(app).get(`${path}/${id}`).set("Authorization", authorization)).body.status).toBe("completed"), { timeout: 10_000, interval: 20 });
    expect((await request(app).get(`${path}/${id}/download`).set("Authorization", authorization)).status).toBe(200);
    expect((await request(app).get(`${path}/${id}/download`).set("Authorization", `Bearer ${anotherKey.token}`)).status).toBe(404);
    await db.update(agents).set({ role: "engineer" }).where(eq(agents.id, agent!.id));
    expect((await request(app).get(`${path}/${id}/download`).set("Authorization", authorization)).status).toBe(403);
    await db.update(agents).set({ role: "ceo" }).where(eq(agents.id, agent!.id));
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    expect((await request(app).get(`${path}/${id}/download`).set("Authorization", authorization)).status).toBe(403);
    await db.update(companyMemberships).set({ status: "active" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    const [stored] = await db.select().from(companyTransferRuns).where(eq(companyTransferRuns.id, id));
    expect(originalActor?.keyId).toBe(key.id);
    await db.update(agentApiKeys).set({ revokedAt: new Date() }).where(eq(agentApiKeys.id, key.id));
    expect([401, 403]).toContain((await request(app).get(`${path}/${id}/download`).set("Authorization", authorization)).status);
    const transfers = companyExportTransferService(db, storage, companyPortabilityService(db, storage));
    await expect(transfers.getForActor(companyId, id, stored!.actorKey, originalActor!)).rejects.toMatchObject({ status: 403 });
    expect(puts).toBe(1);
  });
});
