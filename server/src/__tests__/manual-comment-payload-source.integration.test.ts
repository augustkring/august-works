import { randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, authSessions, authUsers, companies, companyMemberships, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, issueComments } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/error-handler.js";
import { issueService, lockIssuePrivacyTree } from "../services/issues.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { analyticalLiveEventForReader } from "../services/analytical-live-events.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";

describe("direct Human comment payload source capture", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("manual-comment-payload-source-");
    db = createDb(database.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function seed() {
    const companyId = randomUUID(), userId = randomUUID(), sessionId = randomUUID(), now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Direct comment source", issuePrefix: `MC${companyId.slice(0, 5)}` });
    await db.insert(authUsers).values({ id: userId, name: "Comment Human", email: `${userId}@test.invalid`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "member", status: "active" });
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 3600000) });
    const actor: AuthorizationActor = { type: "board", source: "session", userId, sessionId, companyIds: [companyId] };
    const issue = await issueService(db).create(companyId, { title: "Native comment target", createdByUserId: userId });
    return { companyId, userId, sessionId, actor, issue };
  }
  function appFor(actor: AuthorizationActor) {
    const app = express(); app.use(express.json());
    // Real native DB authority with a structural HTTP carrier, not a cookie ceremony.
    app.use(((req, _res, next) => { req.actor = actor as typeof req.actor; next(); }) as RequestHandler);
    app.use("/api", issueRoutes(db)); app.use(errorHandler);
    return app;
  }
  async function readOwner(id: string) {
    const [row] = await db.select().from(issueComments).where(eq(issueComments.id, id));
    const [proof] = await db.execute<{ hash: string; valid: boolean }>(sql`select
      public.aw_native_payload_body_hash('comment',to_jsonb(c)) as hash,
      (c.payload_source_snapshot->>'digest')=encode(sha256(convert_to((c.payload_source_snapshot-'digest')::text,'UTF8')),'hex') as valid
      from issue_comments c where c.id=${id}::uuid`);
    return { row: row!, proof: proof! };
  }
  const hidden = ["payloadSourceProtocolVersion", "payloadSourceSnapshot", "payloadSourceSnapshotInvalidated"];

  it("binds the actual stored HTTP comment and its current Task policy anchor with one Human audit", async () => {
    const f = await seed(), http = request(appFor(f.actor)), clientRequestId = randomUUID();
    const command = { body: "Direct Human comment body", clientRequestId };
    const created = await http.post(`/api/issues/${f.issue.id}/comments`).send(command).expect(201);
    for (const field of hidden) expect(created.body).not.toHaveProperty(field);
    const { row, proof } = await readOwner(created.body.id);
    expect(row.payloadSourceProtocolVersion).toBe(1);
    expect(row.payloadSourceSnapshot).toMatchObject({ version: 1,
      owner: { kind: "comment", companyId: f.companyId, id: row.id, contentHash: proof.hash },
      policy: { issueIds: [f.issue.id], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [] });
    expect(proof.valid).toBe(true);
    const retry = await http.post(`/api/issues/${f.issue.id}/comments`).send(command).expect(201);
    expect(retry.body.id).toBe(row.id);
    expect((await readOwner(row.id)).row.payloadSourceSnapshot).toEqual(row.payloadSourceSnapshot);
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId),
      eq(activityLog.entityId, f.issue.id), eq(activityLog.action, "comment.payload_source_captured")));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: "user", actorId: f.userId, entityType: "issue", details: { commentId: row.id } });
    expect(JSON.stringify(audit[0]!.details)).not.toContain(command.body);
    await issueService(db).tombstoneComment(row.id, { actorType: "user", userId: f.userId });
    expect((await readOwner(row.id)).row).toMatchObject({ payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: true });
  });

  it.each([0, 1] as const)("does not upgrade an old unknown protocol %i comment on HTTP replay", async protocol => {
    const f = await seed(), clientRequestId = randomUUID(), body = "Existing unknown Human input";
    // Explicitly unknown history; protocol 1 alone supplies no source proof.
    const [old] = await db.insert(issueComments).values({ companyId: f.companyId, issueId: f.issue.id,
      authorUserId: f.userId, authorType: "user", body, clientRequestId, payloadSourceProtocolVersion: protocol }).returning();
    expect((await readOwner(old!.id)).row.payloadSourceSnapshot).toBeNull();
    const replay = await request(appFor(f.actor)).post(`/api/issues/${f.issue.id}/comments`).send({ body, clientRequestId }).expect(201);
    expect(replay.body.id).toBe(old!.id);
    expect((await readOwner(old!.id)).row).toMatchObject({ payloadSourceProtocolVersion: protocol, payloadSourceSnapshot: null });
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId),
      eq(activityLog.action, "comment.payload_source_captured")))).toHaveLength(0);
  });

  it("keeps structured or service-attributed comments unknown", async () => {
    const f = await seed(), svc = issueService(db);
    const attributed = await svc.addComment(f.issue.id, "Service-only author", { userId: f.userId });
    const structured = await svc.addComment(f.issue.id, "Structured input", { userId: f.userId }, {
      metadata: { version: 1, sections: [{ rows: [{ type: "text", text: "Structured source content" }] }] }, manualInputActor: f.actor,
    });
    for (const comment of [attributed, structured]) expect((await readOwner(comment.id)).row)
      .toMatchObject({ payloadSourceProtocolVersion: 0, payloadSourceSnapshot: null });
  });

  it("routes the source audit through the Task owner so another member cannot receive its private live event", async () => {
    const f = await seed(), other = await seed();
    await db.insert(companyMemberships).values({ companyId: f.companyId, principalType: "user",
      principalId: other.userId, membershipRole: "member", status: "active" });
    const privateTask = await issueService(db).create(f.companyId, { title: "Private comment audit parent",
      visibility: "private", createdByUserId: f.userId, responsibleUserId: f.userId, actorResponsibleUserId: f.userId });
    let sourceEvent: Parameters<typeof analyticalLiveEventForReader>[1] | undefined;
    const unsubscribe = subscribeCompanyLiveEvents(f.companyId, event => {
      if (event.type === "activity.logged" && event.payload.action === "comment.payload_source_captured") sourceEvent = event;
    });
    try {
      await request(appFor(f.actor)).post(`/api/issues/${privateTask.id}/comments`)
        .send({ body: "Private direct input", clientRequestId: randomUUID() }).expect(422);
      // The product's private-work admission stays closed. Exercise the native
      // owner directly to qualify its event narrowing, not HTTP private work.
      await issueService(db).addComment(privateTask.id, "Private direct input", { userId: f.userId }, {
        clientRequestId: randomUUID(), manualInputActor: f.actor,
      });
      expect(sourceEvent).toBeDefined();
      expect(sourceEvent!.payload).toMatchObject({ entityType: "issue", entityId: privateTask.id });
      expect(await analyticalLiveEventForReader(db, sourceEvent!, f.actor)).not.toBeNull();
      expect(await analyticalLiveEventForReader(db, sourceEvent!, {
        ...other.actor, companyIds: [f.companyId, other.companyId],
      })).toBeNull();
    } finally { unsubscribe(); }
  });

  it.each(["expired", "different_user"] as const)("rejects %s native source sessions", async kind => {
    const f = await seed();
    if (kind === "expired") await db.execute(sql`update "session" set expires_at=clock_timestamp()-interval '1 second' where id=${f.sessionId}`);
    else f.actor.sessionId = (await seed()).sessionId;
    await expect(issueService(db).addComment(f.issue.id, "Rejected source", { userId: f.userId }, {
      manualInputActor: f.actor,
    })).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId, f.issue.id))).toHaveLength(0);
  });

  it("rolls back the new comment when its original source audit fails", async () => {
    const f = await seed(), fn = `reject_comment_source_${f.companyId.replaceAll("-", "")}`;
    await db.execute(sql`create function public.${sql.identifier(fn)}() returns trigger language plpgsql as $function$
      begin if new.company_id=${sql.raw(`'${f.companyId}'::uuid`)} and new.action='comment.payload_source_captured'
        then raise exception 'scoped comment source audit failure'; end if; return new; end $function$`);
    await db.execute(sql`create trigger ${sql.identifier(fn)} before insert on activity_log for each row execute function public.${sql.identifier(fn)}()`);
    try {
      await expect(issueService(db).addComment(f.issue.id, "Audit rollback input", { userId: f.userId }, {
        manualInputActor: f.actor,
      })).rejects.toBeDefined();
      expect(await db.select().from(issueComments).where(eq(issueComments.issueId, f.issue.id))).toHaveLength(0);
    } finally {
      await db.execute(sql`drop trigger if exists ${sql.identifier(fn)} on activity_log`);
      await db.execute(sql`drop function if exists public.${sql.identifier(fn)}()`);
    }
  });

  it("checks the original session deadline on old replay after an observed native privacy-lock wait", async () => {
    const f = await seed(), clientRequestId = randomUUID(), body = "Old source remains unknown";
    const old = await issueService(db).addComment(f.issue.id, body, { userId: f.userId }, { clientRequestId });
    await db.execute(sql`update "session" set expires_at=clock_timestamp()+interval '1500 milliseconds' where id=${f.sessionId}`);
    let release!: () => void, ready!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const holder = db.transaction(async tx => { await lockIssuePrivacyTree(tx, f.companyId); ready(); await released; });
    await locked;
    const replay = issueService(db).addComment(f.issue.id, body, { userId: f.userId }, { clientRequestId, manualInputActor: f.actor });
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
    await holder;
    expect(blocked).toBe(true);
    await expect(replay).rejects.toMatchObject({ status: 403 });
    expect((await readOwner(old.id)).row).toMatchObject({ payloadSourceProtocolVersion: 0, payloadSourceSnapshot: null });
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId, f.issue.id))).toHaveLength(1);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
