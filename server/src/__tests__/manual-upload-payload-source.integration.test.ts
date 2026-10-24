import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, assets, authSessions, authUsers, companies, companyMemberships, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, issueAttachments } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { createStorageService } from "../storage/service.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/error-handler.js";
import { issueService, lockIssuePrivacyTree } from "../services/issues.js";
import type { AuthorizationActor } from "../services/authorization.js";

describe("original literal Human upload source capture", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let root: string, storage: ReturnType<typeof createStorageService>;
  const bytes = Buffer.from("Actual literal Human upload bytes.\n", "utf8");
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("manual-upload-payload-source-");
    db = createDb(database.connectionString, { maxConnections: 8 });
    root = await mkdtemp(path.join(tmpdir(), "manual-upload-bytes-"));
    storage = createStorageService(createLocalDiskStorageProvider(root));
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); if (root) await rm(root, { recursive: true, force: true }); }, 30_000);
  async function seed() {
    const companyId = randomUUID(), userId = randomUUID(), sessionId = randomUUID(), now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Direct upload source", issuePrefix: `MU${companyId.slice(0, 5)}` });
    await db.insert(authUsers).values({ id: userId, name: "Upload Human", email: `${userId}@test.invalid`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "member" });
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 3600000) });
    const actor: AuthorizationActor = { type: "board", source: "session", userId, sessionId, companyIds: [companyId] };
    const issue = await issueService(db).create(companyId, { title: "Literal upload parent", createdByUserId: userId });
    return { companyId, userId, sessionId, actor, issue };
  }
  function appFor(actor: AuthorizationActor) {
    const app = express(); app.use(express.json());
    // Structural HTTP identity, real native DB authority and actual disk bytes.
    app.use((req, _res, next) => { req.actor = actor as typeof req.actor; next(); });
    app.use("/api", issueRoutes(db, storage)); app.use(errorHandler); return app;
  }
  async function stored(f: Awaited<ReturnType<typeof seed>>) {
    const file = await storage.putFile({ companyId: f.companyId, namespace: `issues/${f.issue.id}`,
      originalFilename: "literal.txt", contentType: "text/plain", body: bytes });
    return { issueId: f.issue.id, ...file, createdByUserId: f.userId };
  }
  async function owner(id: string) {
    const [row] = await db.select().from(issueAttachments).where(eq(issueAttachments.id, id));
    const [proof] = await db.execute<{ hash: string; valid: boolean }>(sql`select
      public.aw_native_payload_body_hash('attachment',to_jsonb(a)) as hash,
      (a.payload_source_snapshot->>'digest')=encode(sha256(convert_to((a.payload_source_snapshot-'digest')::text,'UTF8')),'hex') as valid
      from issue_attachments a where a.id=${id}::uuid`);
    return { row: row!, proof: proof! };
  }
  it("binds the actual multipart bytes/asset and preserves protected public DTOs", async () => {
    const f = await seed(), http = request(appFor(f.actor));
    const result = await http.post(`/api/companies/${f.companyId}/issues/${f.issue.id}/attachments`)
      .attach("file", bytes, { filename: "literal.txt", contentType: "text/plain" }).expect(201);
    for (const field of ["payloadSourceProtocolVersion", "payloadSourceSnapshot", "payloadSourceSnapshotInvalidated"])
      expect(result.body).not.toHaveProperty(field);
    expect(result.body.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    const { row, proof } = await owner(result.body.id);
    expect(row.payloadSourceProtocolVersion).toBe(1); expect(proof.valid).toBe(true);
    expect(row.payloadSourceSnapshot).toMatchObject({ version: 1,
      owner: { kind: "attachment", companyId: f.companyId, id: row.id, contentHash: proof.hash },
      policy: { issueIds: [f.issue.id], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [] });
    const download = await http.get(result.body.contentPath).expect(200);
    expect(download.text).toBe(bytes.toString("utf8"));
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId),
      eq(activityLog.action, "attachment.payload_source_captured")));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: "user", actorId: f.userId, entityType: "issue", entityId: f.issue.id,
      details: { attachmentId: row.id, assetId: row.assetId, contentHash: proof.hash } });
    expect(JSON.stringify(audit[0]!.details)).not.toContain(bytes.toString());
    await db.update(assets).set({ originalFilename: "renamed.txt" }).where(eq(assets.id, row.assetId));
    expect((await owner(row.id)).row).toMatchObject({ payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: true });
  });
  it("does not infer literal input from attribution or a stored descriptor alone", async () => {
    const f = await seed(), input = await stored(f);
    const result = await issueService(db).createAttachment(input);
    expect((await owner(result.id)).row).toMatchObject({ payloadSourceProtocolVersion: 0, payloadSourceSnapshot: null });
  });
  it.each(["hash", "length"] as const)("rejects a %s descriptor mismatch without storing asset/attachment rows", async kind => {
    const f = await seed(), input = await stored(f);
    await expect(issueService(db).createAttachment({ ...input,
      ...(kind === "hash" ? { sha256: "0".repeat(64) } : { byteSize: bytes.length + 1 }),
    }, { actor: f.actor, bytes })).rejects.toMatchObject({ status: 422 });
    for (const table of [assets, issueAttachments])
      expect(await db.select({ id: table.id }).from(table).where(eq(table.companyId, f.companyId))).toHaveLength(0);
  });
  it.each(["expired", "different_user", "viewer"] as const)("rejects %s original source authority", async kind => {
    const f = await seed(), input = await stored(f);
    if (kind === "expired") await db.execute(sql`update "session" set expires_at=clock_timestamp()-interval '1 second' where id=${f.sessionId}`);
    else if (kind === "different_user") f.actor.sessionId = (await seed()).sessionId;
    else await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, f.companyId),
      eq(companyMemberships.principalId, f.userId)));
    await expect(issueService(db).createAttachment(input, { actor: f.actor, bytes })).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(issueAttachments).where(eq(issueAttachments.companyId, f.companyId))).toHaveLength(0);
  });
  it("rolls back asset/attachment registration if its source audit cannot commit", async () => {
    const f = await seed(), input = await stored(f), fn = `reject_upload_source_${f.companyId.replaceAll("-", "")}`;
    await db.execute(sql`create function public.${sql.identifier(fn)}() returns trigger language plpgsql as $function$
      begin if new.company_id=${sql.raw(`'${f.companyId}'::uuid`)} and new.action='attachment.payload_source_captured'
        then raise exception 'scoped upload source audit failure'; end if; return new; end $function$`);
    await db.execute(sql`create trigger ${sql.identifier(fn)} before insert on activity_log for each row execute function public.${sql.identifier(fn)}()`);
    try {
      await expect(issueService(db).createAttachment(input, { actor: f.actor, bytes })).rejects.toBeDefined();
      for (const table of [assets, issueAttachments])
        expect(await db.select({ id: table.id }).from(table).where(eq(table.companyId, f.companyId))).toHaveLength(0);
    } finally {
      await db.execute(sql`drop trigger if exists ${sql.identifier(fn)} on activity_log`);
      await db.execute(sql`drop function if exists public.${sql.identifier(fn)}()`);
    }
  });
  it("checks original session expiry after an observed real registration privacy wait", async () => {
    const f = await seed(), input = await stored(f);
    await db.execute(sql`update "session" set expires_at=clock_timestamp()+interval '1500 milliseconds' where id=${f.sessionId}`);
    let release!: () => void, ready!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; }), locked = new Promise<void>(resolve => { ready = resolve; });
    const holder = db.transaction(async tx => { await lockIssuePrivacyTree(tx, f.companyId); ready(); await released; });
    await locked;
    const registering = issueService(db).createAttachment(input, { actor: f.actor, bytes });
    let blocked = false;
    try {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const [waiting] = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity
          where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query ilike '%pg_advisory_xact_lock%'`);
        if ((waiting?.count ?? 0) > 0) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (blocked) await db.execute(sql`select pg_sleep(1.8)`);
    } finally { release(); }
    await holder; expect(blocked).toBe(true);
    await expect(registering).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(issueAttachments).where(eq(issueAttachments.companyId, f.companyId))).toHaveLength(0);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
