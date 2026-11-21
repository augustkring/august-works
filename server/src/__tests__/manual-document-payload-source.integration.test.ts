import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, authSessions, authUsers, companies, companyMemberships, createDb, documentRevisions,
  documents, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, issueDocuments, issues } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/error-handler.js";
import { documentService, type DocumentRevisionSourceCapture } from "../services/documents.js";
import { issueService, lockIssuePrivacyTree } from "../services/issues.js";
import type { AuthorizationActor } from "../services/authorization.js";

describe("fresh direct Human document revision sources", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("manual-document-payload-source-");
    db = createDb(database.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30_000);
  async function seed() {
    const companyId = randomUUID(), userId = randomUUID(), sessionId = randomUUID(), now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Direct document input", issuePrefix: `MD${companyId.slice(0, 5)}` });
    await db.insert(authUsers).values({ id: userId, name: "Document Human", email: `${userId}@test.invalid`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "member" });
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 3600000) });
    const actor: AuthorizationActor = { type: "board", source: "session", userId, sessionId, companyIds: [companyId] };
    const issue = await issueService(db).create(companyId, { title: "Native document parent", createdByUserId: userId });
    return { companyId, userId, sessionId, actor, issue };
  }
  function appFor(actor: AuthorizationActor) {
    const app = express(); app.use(express.json());
    // Structural HTTP carrier; native User/session/membership rows are real.
    app.use((req, _res, next) => { req.actor = actor as typeof req.actor; next(); });
    app.use("/api", issueRoutes(db)); app.use(errorHandler);
    return app;
  }
  const body = { title: "Direct notes", format: "markdown", body: "# Direct Human document\nOriginal typed input", changeSummary: "Initial direct note" };
  const hidden = ["payloadSourceProtocolVersion", "payloadSourceSnapshot", "payloadSourceSnapshotInvalidated"];
  async function revision(id: string) {
    const [row] = await db.select().from(documentRevisions).where(eq(documentRevisions.id, id));
    const [proof] = await db.execute<{ hash: string; valid: boolean }>(sql`select
      public.aw_native_payload_body_hash('document_revision',to_jsonb(r)) as hash,
      (r.payload_source_snapshot->>'digest')=encode(sha256(convert_to((r.payload_source_snapshot-'digest')::text,'UTF8')),'hex') as valid
      from document_revisions r where r.id=${id}::uuid`);
    return { row: row!, proof: proof! };
  }
  it("captures a new manual Task before rechecking its ordinary current write authority", async () => {
    const f = await seed();
    const created = await issueService(db).create(f.companyId, {
      title: "Current Human Task", description: "Exact text supplied by the authenticated Human.",
      createdByUserId: f.userId, responsibleUserId: f.userId,
    }, db, undefined, { manualInputActor: f.actor });
    const [row] = await db.select().from(issues).where(eq(issues.id, created.id));
    const [proof] = await db.execute<{ hash: string; valid: boolean }>(sql`select
      public.aw_native_payload_body_hash('issue',to_jsonb(i)) as hash,
      (i.payload_source_snapshot->>'digest')=encode(sha256(convert_to((i.payload_source_snapshot-'digest')::text,'UTF8')),'hex') as valid
      from issues i where i.id=${created.id}::uuid`);
    expect(row).toMatchObject({ payloadSourceProtocolVersion: 1, payloadSourceSnapshotInvalidated: false,
      payloadSourceSnapshot: { version: 1, owner: { kind: "issue", companyId: f.companyId, id: created.id } } });
    expect(row!.payloadSourceSnapshot.owner.contentHash).toBe(proof!.hash);
    expect(proof!.valid).toBe(true);
  });
  it("captures only the first stored native revision and exposes no proof through document DTOs", async () => {
    const f = await seed(), http = request(appFor(f.actor));
    const created = await http.put(`/api/issues/${f.issue.id}/documents/notes`).send(body).expect(201);
    for (const field of hidden) expect(created.body).not.toHaveProperty(field);
    const { row, proof } = await revision(created.body.latestRevisionId);
    expect(row.payloadSourceProtocolVersion).toBe(1); expect(proof.valid).toBe(true);
    expect(row.payloadSourceSnapshot).toMatchObject({ version: 1,
      owner: { kind: "document_revision", companyId: f.companyId, id: row.id, contentHash: proof.hash },
      policy: { issueIds: [f.issue.id], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [] });
    let captured: DocumentRevisionSourceCapture | null = null;
    await documentService(db).getIssueDocumentByKey(f.issue.id, "notes", { onSourceCapture: value => { captured = value; } });
    expect(captured).toMatchObject({ input: { revisionId: row.id, issueId: f.issue.id }, payloadSourceSnapshot: row.payloadSourceSnapshot });
    const listed = await http.get(`/api/issues/${f.issue.id}/documents/notes/revisions`).expect(200);
    for (const entry of listed.body) for (const field of hidden) expect(entry).not.toHaveProperty(field);
    await http.put(`/api/issues/${f.issue.id}/documents/notes`).send(body).expect(409);
    expect(await db.select().from(documentRevisions).where(eq(documentRevisions.documentId, created.body.id))).toHaveLength(1);
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId),
      eq(activityLog.action, "document_revision.payload_source_captured")));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: "user", actorId: f.userId, entityType: "issue", entityId: f.issue.id,
      details: { documentId: created.body.id, revisionId: row.id, contentHash: proof.hash } });
    expect(JSON.stringify(audit[0]!.details)).not.toContain(body.body);
  });
  it("does not manufacture known inputs for edits or restoration of an old revision", async () => {
    const f = await seed(), http = request(appFor(f.actor));
    const first = await http.put(`/api/issues/${f.issue.id}/documents/notes`).send(body).expect(201);
    const original = await revision(first.body.latestRevisionId);
    const edited = await http.put(`/api/issues/${f.issue.id}/documents/notes`)
      .send({ ...body, body: "A later edit", baseRevisionId: first.body.latestRevisionId }).expect(200);
    expect((await revision(edited.body.latestRevisionId)).row).toMatchObject({ payloadSourceProtocolVersion: 0, payloadSourceSnapshot: null });
    const restored = await http.post(`/api/issues/${f.issue.id}/documents/notes/revisions/${first.body.latestRevisionId}/restore`).send({}).expect(200);
    expect((await revision(restored.body.latestRevisionId)).row).toMatchObject({ payloadSourceProtocolVersion: 0, payloadSourceSnapshot: null });
    expect((await revision(original.row.id)).row.payloadSourceSnapshot).toEqual(original.row.payloadSourceSnapshot);
  });
  it.each(["attribution", "board_key"] as const)("keeps %s constructor history unknown", async kind => {
    const f = await seed();
    const result = await documentService(db).upsertIssueDocument({ issueId: f.issue.id, key: "notes", ...body,
      createdByUserId: f.userId, ...(kind === "board_key" ? { manualInputActor: { ...f.actor, source: "board_key", sessionId: null } } : {}) });
    expect((await revision(result.document.latestRevisionId)).row).toMatchObject({ payloadSourceProtocolVersion: 0, payloadSourceSnapshot: null });
  });
  it.each(["expired", "different_user", "viewer"] as const)("rejects a fresh source with %s authority", async kind => {
    const f = await seed();
    if (kind === "expired") await db.execute(sql`update "session" set expires_at=clock_timestamp()-interval '1 second' where id=${f.sessionId}`);
    else if (kind === "different_user") f.actor.sessionId = (await seed()).sessionId;
    else await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, f.companyId),
      eq(companyMemberships.principalId, f.userId)));
    await expect(documentService(db).upsertIssueDocument({ issueId: f.issue.id, key: "notes", ...body,
      createdByUserId: f.userId, manualInputActor: f.actor })).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(documents).where(eq(documents.companyId, f.companyId))).toHaveLength(0);
  });
  it("rolls back document, revision and link when the capture audit fails", async () => {
    const f = await seed(), fn = `reject_doc_source_${f.companyId.replaceAll("-", "")}`;
    await db.execute(sql`create function public.${sql.identifier(fn)}() returns trigger language plpgsql as $function$
      begin if new.company_id=${sql.raw(`'${f.companyId}'::uuid`)} and new.action='document_revision.payload_source_captured'
        then raise exception 'scoped document source audit failure'; end if; return new; end $function$`);
    await db.execute(sql`create trigger ${sql.identifier(fn)} before insert on activity_log for each row execute function public.${sql.identifier(fn)}()`);
    try {
      await expect(documentService(db).upsertIssueDocument({ issueId: f.issue.id, key: "notes", ...body,
        createdByUserId: f.userId, manualInputActor: f.actor })).rejects.toBeDefined();
      for (const table of [documents, documentRevisions, issueDocuments])
        expect(await db.select({ id: table.id }).from(table).where(eq(table.companyId, f.companyId))).toHaveLength(0);
    } finally {
      await db.execute(sql`drop trigger if exists ${sql.identifier(fn)} on activity_log`);
      await db.execute(sql`drop function if exists public.${sql.identifier(fn)}()`);
    }
  });
  it("denies expired source authority after an actual observed privacy lock wait", async () => {
    const f = await seed();
    await db.execute(sql`update "session" set expires_at=clock_timestamp()+interval '1500 milliseconds' where id=${f.sessionId}`);
    let release!: () => void, ready!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; }), locked = new Promise<void>(resolve => { ready = resolve; });
    const holder = db.transaction(async tx => { await lockIssuePrivacyTree(tx, f.companyId); ready(); await released; });
    await locked;
    const creating = documentService(db).upsertIssueDocument({ issueId: f.issue.id, key: "notes", ...body,
      createdByUserId: f.userId, manualInputActor: f.actor });
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
    await expect(creating).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(documents).where(eq(documents.companyId, f.companyId))).toHaveLength(0);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
