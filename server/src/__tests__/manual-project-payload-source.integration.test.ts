import { randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog, authSessions, authUsers, companies, companyMemberships, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, projects,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/error-handler.js";
import { projectRoutes } from "../routes/projects.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { projectService } from "../services/projects.js";
import { lockIssuePrivacyTree } from "../services/issues.js";

describe("manual Human Project payload source capture", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("manual-project-payload-source-");
    db = createDb(database.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function seed(role: "admin" | "member" | "viewer" = "member", membership = true) {
    const companyId = randomUUID(), userId = randomUUID(), sessionId = randomUUID(), now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Manual Project source company",
      issuePrefix: `MP${companyId.slice(0, 5)}` });
    await db.insert(authUsers).values({ id: userId, name: "Native test Human", email: `${userId}@example.test`,
      createdAt: now, updatedAt: now });
    if (membership) await db.insert(companyMemberships).values({ companyId, principalType: "user",
      principalId: userId, membershipRole: role, status: "active" });
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 60 * 60_000) });
    const actor: AuthorizationActor = { type: "board", source: "session", userId, sessionId,
      companyIds: [companyId], memberships: membership ? [{ companyId, membershipRole: role, status: "active" }] : [] };
    return { companyId, userId, sessionId, actor };
  }

  async function addOtherSession(companyId: string) {
    const userId = randomUUID(), sessionId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Different Human", email: `${userId}@example.test`,
      createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "member", status: "active" });
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 60 * 60_000) });
    return { userId, sessionId };
  }

  function appFor(actor: AuthorizationActor) {
    const app = express();
    app.use(express.json());
    // Structural carrier for the original HTTP owner; user, membership and
    // session are native DB rows. This does not qualify a cookie/WebAuthn flow.
    app.use(((req, _res, next) => {
      (req as typeof req & { actor: AuthorizationActor }).actor = actor;
      next();
    }) as RequestHandler);
    app.use("/api", projectRoutes(db));
    app.use(errorHandler);
    return app;
  }

  async function readOwner(projectId: string) {
    const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
    const [proof] = await db.execute<{ bodyHash: string; digestValid: boolean }>(sql`
      select public.aw_native_payload_body_hash('project',to_jsonb(p)) as "bodyHash",
        (p.payload_source_snapshot->>'digest')=encode(sha256(convert_to((p.payload_source_snapshot-'digest')::text,'UTF8')),'hex') as "digestValid"
      from projects p where p.id=${projectId}::uuid
    `);
    return { row: row!, proof: proof! };
  }

  function simpleBody(name: string) {
    return { name, description: "Direct Human project description", color: "#2457A7", icon: "folder" };
  }

  it("captures the stored direct Project body and keeps the receipt private", async () => {
    const f = await seed("admin");
    const response = await request(appFor(f.actor)).post(`/api/companies/${f.companyId}/projects`)
      .send(simpleBody("Human project input")).expect(201);
    for (const field of ["payloadSourceProtocolVersion", "payloadSourceSnapshot", "payloadSourceSnapshotInvalidated"])
      expect(response.body).not.toHaveProperty(field);
    const { row, proof } = await readOwner(response.body.id);
    expect(row.payloadSourceProtocolVersion).toBe(1);
    expect(row.payloadSourceSnapshotInvalidated).toBe(false);
    expect(row.payloadSourceSnapshot).toMatchObject({
      version: 1,
      owner: { kind: "project", companyId: f.companyId, id: row.id, contentHash: proof.bodyHash },
      policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] },
      inputs: [],
    });
    expect(proof.digestValid).toBe(true);
    const audit = await db.select().from(activityLog).where(and(
      eq(activityLog.companyId, f.companyId), eq(activityLog.entityId, row.id),
      eq(activityLog.action, "project.payload_source_captured"),
    ));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: "user", actorId: f.userId, entityType: "project", entityId: row.id });
    expect(JSON.stringify(audit[0]!.details)).not.toContain("Direct Human project description");
  });

  it("preserves the capture for operational edits and irreversibly invalidates a changed body", async () => {
    const f = await seed("admin"), http = request(appFor(f.actor));
    const created = await http.post(`/api/companies/${f.companyId}/projects`)
      .send(simpleBody("Project body lifecycle")).expect(201);
    const original = await readOwner(created.body.id);
    const operational = await http.patch(`/api/projects/${created.body.id}`).send({ status: "planned" }).expect(200);
    for (const field of ["payloadSourceProtocolVersion", "payloadSourceSnapshot", "payloadSourceSnapshotInvalidated"])
      expect(operational.body).not.toHaveProperty(field);
    expect((await readOwner(created.body.id)).row.payloadSourceSnapshot).toEqual(original.row.payloadSourceSnapshot);
    const edited = await http.patch(`/api/projects/${created.body.id}`)
      .send({ description: "Edited after creation" }).expect(200);
    for (const field of ["payloadSourceProtocolVersion", "payloadSourceSnapshot", "payloadSourceSnapshotInvalidated"])
      expect(edited.body).not.toHaveProperty(field);
    const changed = await readOwner(created.body.id);
    expect(changed.row.payloadSourceSnapshot).toBeNull();
    expect(changed.row.payloadSourceSnapshotInvalidated).toBe(true);
  });

  it("does not infer source capture from service-only Human attribution", async () => {
    const f = await seed("admin");
    const project = await projectService(db).create(f.companyId, {
      name: "Service-created with actor", privacyOwnerUserId: f.userId,
      sourceProvenanceQualified: true, sourceIssueIds: [], sourceProjectIds: [],
    }, undefined, f.actor);
    const { row } = await readOwner(project.id);
    expect(row.privacyOwnerUserId).toBe(f.userId);
    expect(row.sourceProvenanceQualified).toBe(true);
    expect(row.payloadSourceProtocolVersion).toBe(0);
    expect(row.payloadSourceSnapshot).toBeNull();
  });

  it.each([
    { name: "Board key source", change: (actor: AuthorizationActor): AuthorizationActor => ({ ...actor, source: "board_key", sessionId: null }) },
    { name: "session without ID", change: (actor: AuthorizationActor): AuthorizationActor => ({ ...actor, sessionId: null }) },
  ])("keeps $name Projects unknown when legacy route access permits the write", async ({ change }) => {
    const f = await seed("admin"), actor = change(f.actor), name = `Unqualified ${randomUUID()}`;
    const response = await request(appFor(actor)).post(`/api/companies/${f.companyId}/projects`)
      .send(simpleBody(name));
    expect([201, 403]).toContain(response.status);
    if (response.status === 201) {
      const { row } = await readOwner(response.body.id);
      expect(row.payloadSourceProtocolVersion).toBe(0);
      expect(row.payloadSourceSnapshot).toBeNull();
    }
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId),
      eq(activityLog.action, "project.payload_source_captured"))))
      .toHaveLength(0);
  });

  it("leaves a project carrying an environment policy unknown, including its idempotent replay", async () => {
    const f = await seed("admin"), idempotencyKey = randomUUID();
    const body = { ...simpleBody("Environment-bound project"), env: { RETAINED_LABEL: "plain-binding" }, idempotencyKey };
    const http = request(appFor(f.actor));
    const first = await http.post(`/api/companies/${f.companyId}/projects`).send(body).expect(201);
    const replay = await http.post(`/api/companies/${f.companyId}/projects`).send(body).expect(200);
    expect(replay.body.id).toBe(first.body.id);
    const { row } = await readOwner(first.body.id);
    expect(row.payloadSourceProtocolVersion).toBe(0);
    expect(row.payloadSourceSnapshot).toBeNull();
    expect(await db.select().from(activityLog).where(and(
      eq(activityLog.companyId, f.companyId), eq(activityLog.entityId, row.id),
      eq(activityLog.action, "project.payload_source_captured"),
    ))).toHaveLength(0);
  });

  it.each([
    { name: "stale session", setup: async (f: Awaited<ReturnType<typeof seed>>) => {
      await db.execute(sql`update "session" set expires_at=clock_timestamp()-interval '1 second' where id=${f.sessionId}`);
      return f.actor;
    } },
    { name: "deleted session", setup: async (f: Awaited<ReturnType<typeof seed>>) => {
      await db.delete(authSessions).where(eq(authSessions.id, f.sessionId));
      return f.actor;
    } },
    { name: "session owned by another user", setup: async (f: Awaited<ReturnType<typeof seed>>) => {
      const other = await addOtherSession(f.companyId);
      return { ...f.actor, sessionId: other.sessionId };
    } },
    { name: "viewer membership", setup: async (f: Awaited<ReturnType<typeof seed>>) => {
      await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(
        eq(companyMemberships.companyId, f.companyId), eq(companyMemberships.principalId, f.userId),
      ));
      return { ...f.actor, memberships: [{ companyId: f.companyId, membershipRole: "viewer" as const, status: "active" as const }] };
    } },
    { name: "missing membership", setup: async (f: Awaited<ReturnType<typeof seed>>) => {
      await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.companyId),
        eq(companyMemberships.principalId, f.userId)));
      return { ...f.actor, memberships: [] };
    } },
  ])("rejects capture with $name", async ({ setup }) => {
    const f = await seed("admin"), actor = await setup(f), title = `Rejected ${randomUUID()}`;
    const response = await request(appFor(actor)).post(`/api/companies/${f.companyId}/projects`)
      .send(simpleBody(title));
    expect(response.status).toBe(403);
    expect(await db.select().from(projects).where(and(eq(projects.companyId, f.companyId), eq(projects.name, title))))
      .toHaveLength(0);
  });

  it("does not commit a Project when its capture audit cannot be written", async () => {
    const f = await seed("admin"), name = `Audit rollback ${randomUUID()}`;
    const triggerName = `reject_project_capture_${f.companyId.replaceAll("-", "")}`;
    await db.execute(sql`create function public.${sql.identifier(triggerName)}() returns trigger language plpgsql as $function$
      begin
        if new.company_id = ${sql.raw(`'${f.companyId}'::uuid`)} and new.action = 'project.payload_source_captured' then
          raise exception 'fixture project capture audit failure';
        end if;
        return new;
      end
    $function$`);
    await db.execute(sql`create trigger ${sql.identifier(triggerName)} before insert on activity_log
      for each row execute function public.${sql.identifier(triggerName)}()`);
    try {
      const response = await request(appFor(f.actor)).post(`/api/companies/${f.companyId}/projects`)
        .send(simpleBody(name));
      expect(response.status).toBe(500);
      expect(await db.select().from(projects).where(and(eq(projects.companyId, f.companyId), eq(projects.name, name))))
        .toHaveLength(0);
      expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId),
        eq(activityLog.action, "project.payload_source_captured")))).toHaveLength(0);
    } finally {
      await db.execute(sql`drop trigger if exists ${sql.identifier(triggerName)} on activity_log`);
      await db.execute(sql`drop function if exists public.${sql.identifier(triggerName)}()`);
    }
  });

  it("rechecks the native session after waiting on the Project privacy-tree lock", async () => {
    const f = await seed("admin");
    await db.execute(sql`update "session" set expires_at=clock_timestamp()+interval '1500 milliseconds' where id=${f.sessionId}`);
    const [liveAtStart] = await db.execute<{ live: boolean }>(sql`
      select expires_at>clock_timestamp() as live from "session" where id=${f.sessionId}`);
    expect(liveAtStart?.live).toBe(true);

    let release!: () => void, locked!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const lockReady = new Promise<void>(resolve => { locked = resolve; });
    const holder = db.transaction(async tx => {
      await lockIssuePrivacyTree(tx, f.companyId);
      locked();
      await released;
    });
    await lockReady;
    const name = `Expiry during Project lock ${randomUUID()}`;
    const creating = request(appFor(f.actor)).post(`/api/companies/${f.companyId}/projects`)
      .send(simpleBody(name)).then(response => response);
    try {
      const deadline = Date.now() + 10_000;
      let blocked = false;
      while (Date.now() < deadline) {
        const [waiter] = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity
          where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock'
            and query ilike '%pg_advisory_xact_lock%'`);
        if ((waiter?.count ?? 0) >= 1) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      await db.execute(sql`select pg_sleep(1.8)`);
    } finally {
      release();
    }
    await holder;
    const response = await creating;
    expect(response.status).toBe(403);
    expect(await db.select().from(projects).where(and(eq(projects.companyId, f.companyId), eq(projects.name, name))))
      .toHaveLength(0);
  });
});
