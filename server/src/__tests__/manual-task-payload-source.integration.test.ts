import { randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  authSessions,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  documents,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  issueDocuments,
  issues,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/error-handler.js";
import { issueRoutes } from "../routes/issues.js";
import { projectRoutes } from "../routes/projects.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { issueService } from "../services/issues.js";
import { assertNativeTaskSourceOwnerCurrent } from "../services/native-direct-input.js";

describe("manual Human Task payload source capture", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("manual-task-payload-source-");
    db = createDb(database.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function seed(role: "admin" | "member" | "viewer" = "member", membership = true) {
    const companyId = randomUUID();
    const userId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Manual source company", issuePrefix: `M${companyId.slice(0, 5)}` });
    await db.insert(authUsers).values({ id: userId, name: "Native test Human", email: `${userId}@example.test`, createdAt: now, updatedAt: now });
    if (membership) {
      await db.insert(companyMemberships).values({
        companyId,
        principalType: "user",
        principalId: userId,
        membershipRole: role,
        status: "active",
      });
    }
    await db.insert(authSessions).values({
      id: sessionId,
      userId,
      token: randomUUID(),
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    });
    const actor: AuthorizationActor = {
      type: "board",
      source: "session",
      userId,
      sessionId,
      companyIds: [companyId],
      memberships: membership ? [{ companyId, membershipRole: role, status: "active" }] : [],
    };
    return { companyId, userId, sessionId, actor };
  }

  function appFor(actor: AuthorizationActor) {
    const app = express();
    app.use(express.json());
    // Structural HTTP actor carrier for the original route. The native user
    // and session rows are real DB rows; this is not cookie/WebAuthn proof.
    app.use(((req, _res, next) => {
      (req as typeof req & { actor: AuthorizationActor }).actor = actor;
      next();
    }) as RequestHandler);
    app.use("/api", issueRoutes(db, {} as never));
    app.use("/api", projectRoutes(db));
    app.use(errorHandler);
    return app;
  }

  async function readOwner(issueId: string) {
    const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
    const [proof] = await db.execute<{ bodyHash: string; digestValid: boolean }>(sql`
      select public.aw_native_payload_body_hash('issue',to_jsonb(i)) as "bodyHash",
        (i.payload_source_snapshot->>'digest')=encode(sha256(convert_to((i.payload_source_snapshot-'digest')::text,'UTF8')),'hex') as "digestValid"
      from issues i where i.id=${issueId}::uuid
    `);
    return { row: row!, proof: proof! };
  }

  function manualActorOptions(actor: AuthorizationActor) {
    return { manualInputActor: actor };
  }

  it("captures only the actual stored body for a current Human root-task request", async () => {
    const f = await seed("admin");
    const response = await request(appFor(f.actor))
      .post(`/api/companies/${f.companyId}/issues`)
      .send({ title: "Human root request", description: "A direct request body." })
      .expect(201);
    for (const field of ["payloadSourceProtocolVersion", "payloadSourceSnapshot", "payloadSourceSnapshotInvalidated"])
      expect(response.body).not.toHaveProperty(field);
    const { row, proof } = await readOwner(response.body.id);
    expect(row.payloadSourceProtocolVersion).toBe(1);
    expect(row.payloadSourceSnapshotInvalidated).toBe(false);
    expect(row.payloadSourceSnapshot).toMatchObject({
      version: 1,
      owner: { kind: "issue", companyId: f.companyId, id: row.id, contentHash: proof.bodyHash },
      policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] },
      inputs: [],
    });
    expect(proof.digestValid).toBe(true);
    const audit = await db.select().from(activityLog).where(and(
      eq(activityLog.companyId, f.companyId), eq(activityLog.entityId, row.id),
      eq(activityLog.action, "issue.payload_source_captured"),
    ));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: "user", actorId: f.userId, entityType: "issue", entityId: row.id });
    expect(JSON.stringify(audit[0]!.details)).not.toContain("A direct request body.");
  });

  it("captures an independent private manual Task with optional same-company Agent assignment", async () => {
    const f = await seed();
    const [agent] = await db.insert(agents).values({ companyId: f.companyId, name: "Private task worker",
      adapterType: "paperclip_runner", status: "active" }).returning();
    const createPrivate = (title: string, assigneeAgentId?: string) => issueService(db).create(f.companyId, {
      title, description: `Bound body for ${title}.`, visibility: "private", status: "todo",
      ...(assigneeAgentId ? { assigneeAgentId } : {}), responsibleUserId: f.userId, createdByUserId: f.userId,
    }, db, undefined, manualActorOptions(f.actor));
    const unassigned = await createPrivate("Private Human draft");
    const assigned = await createPrivate("Private Agent task", agent!.id);
    for (const created of [unassigned, assigned]) {
      const { row, proof } = await readOwner(created.id);
      expect(row).toMatchObject({ visibility: "private", responsibleUserId: f.userId,
        assigneeAgentId: created.id === assigned.id ? agent!.id : null,
        payloadSourceProtocolVersion: 1, payloadSourceSnapshotInvalidated: false });
      expect(row.payloadSourceSnapshot).toMatchObject({ version: 1,
        owner: { kind: "issue", companyId: f.companyId, id: row.id, contentHash: proof.bodyHash },
        policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [] });
      expect(proof.digestValid).toBe(true);
      const audit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId),
        eq(activityLog.entityId, row.id), eq(activityLog.action, "issue.payload_source_captured")));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actorType: "user", actorId: f.userId });
      expect(JSON.stringify(audit[0]!.details)).not.toContain(`Bound body for ${created.title}.`);
    }

    const bob = await seed();
    // Place Bob in the same company while keeping his own independent session.
    await db.insert(companyMemberships).values({ companyId: f.companyId, principalType: "user", principalId: bob.userId,
      membershipRole: "member", status: "active" });
    const bobActor = { ...bob.actor, companyIds: [f.companyId], memberships: [{ companyId: f.companyId,
      membershipRole: "member" as const, status: "active" as const }] };
    for (const created of [unassigned, assigned]) {
      const bobRead = await request(appFor(bobActor)).get(`/api/issues/${created.id}`);
      expect([403, 404]).toContain(bobRead.status);
      expect(JSON.stringify(bobRead.body)).not.toContain(`Bound body for ${created.title}.`);
    }

    const publicRoute = await request(appFor(f.actor)).post(`/api/companies/${f.companyId}/issues`).send({
      title: "Private route remains closed", description: "Route admission is not expanded.", visibility: "private",
      status: "todo", assigneeAgentId: agent!.id, responsibleUserId: f.userId,
    });
    expect(publicRoute.status).toBe(422);
  });

  it("refuses a private source when responsibility belongs to another Human or Agent crosses company scope", async () => {
    const f = await seed();
    const otherHuman = await seed();
    const [sameCompanyAgent] = await db.insert(agents).values({ companyId: f.companyId, name: "Same company worker",
      adapterType: "paperclip_runner", status: "active" }).returning();
    const [foreignCompanyAgent] = await db.insert(agents).values({ companyId: otherHuman.companyId, name: "Foreign worker",
      adapterType: "paperclip_runner", status: "active" }).returning();
    const wrongHumanTitle = "Wrong Human private source";
    await expect(issueService(db).create(f.companyId, { title: wrongHumanTitle, visibility: "private", status: "todo",
      assigneeAgentId: sameCompanyAgent!.id, responsibleUserId: otherHuman.userId, createdByUserId: f.userId },
    db, undefined, manualActorOptions(f.actor))).rejects.toMatchObject({ status: 403 });
    const foreignAgentTitle = "Foreign Agent private source";
    await expect(issueService(db).create(f.companyId, { title: foreignAgentTitle, visibility: "private", status: "todo",
      assigneeAgentId: foreignCompanyAgent!.id, responsibleUserId: f.userId, createdByUserId: f.userId },
    db, undefined, manualActorOptions(f.actor))).rejects.toMatchObject({ status: 422 });
    for (const title of [wrongHumanTitle, foreignAgentTitle])
      expect(await db.select().from(issues).where(and(eq(issues.companyId, f.companyId), eq(issues.title, title)))).toHaveLength(0);
  });

  it("preserves an operational edit, invalidates changed content and keeps both write responses private", async () => {
    const f = await seed("admin"), http = request(appFor(f.actor));
    const created = await http.post(`/api/companies/${f.companyId}/issues`)
      .send({ title: "Manual body lifecycle", description: "Original input" }).expect(201);
    const original = await readOwner(created.body.id);
    const operational = await http.patch(`/api/issues/${created.body.id}`).send({ priority: "high" }).expect(200);
    for (const field of ["payloadSourceProtocolVersion", "payloadSourceSnapshot", "payloadSourceSnapshotInvalidated"])
      expect(operational.body).not.toHaveProperty(field);
    expect((await readOwner(created.body.id)).row.payloadSourceSnapshot).toEqual(original.row.payloadSourceSnapshot);
    const edited = await http.patch(`/api/issues/${created.body.id}`)
      .send({ description: "Changed input", comment: "Human edit explanation" }).expect(200);
    for (const field of ["payloadSourceProtocolVersion", "payloadSourceSnapshot", "payloadSourceSnapshotInvalidated"]) {
      expect(edited.body).not.toHaveProperty(field);
      expect(edited.body.comment).not.toHaveProperty(field);
    }
    const changed = await readOwner(created.body.id);
    expect(changed.row.payloadSourceSnapshot).toBeNull();
    expect(changed.row.payloadSourceSnapshotInvalidated).toBe(true);
  });

  it("does not infer capture from creator attribution without the explicit native actor", async () => {
    const f = await seed();
    const created = await issueService(db).create(f.companyId, {
      title: "Attribution alone is not capture",
      description: "Legacy service call.",
      createdByUserId: f.userId,
    });
    const { row } = await readOwner(created.id);
    expect(row.createdByUserId).toBe(f.userId);
    expect(row.payloadSourceProtocolVersion).toBe(0);
    expect(row.payloadSourceSnapshot).toBeNull();
  });

  it.each([
    { name: "Board key", actor: (base: AuthorizationActor) => ({ ...base, source: "board_key" as const }), creator: (userId: string) => userId },
    { name: "missing session id", actor: (base: AuthorizationActor) => ({ ...base, sessionId: null }), creator: (userId: string) => userId },
    { name: "creator mismatch", actor: (base: AuthorizationActor) => base, creator: (_userId: string) => randomUUID() },
  ])("rejects the explicit constructor for $name", async ({ actor: actorFor, creator: creatorFor }) => {
    const f = await seed();
    const actor = actorFor(f.actor);
    const createdByUserId = creatorFor(f.userId);
    const title = `Rejected ${randomUUID()}`;
    await expect(issueService(db).create(f.companyId, {
      title,
      createdByUserId,
    }, db, undefined, manualActorOptions(actor))).rejects.toBeDefined();
    const rows = await db.select().from(issues).where(and(eq(issues.companyId, f.companyId), eq(issues.title, title)));
    expect(rows).toHaveLength(0);
  });

  it.each([
    { name: "viewer", role: "viewer" as const, membership: true },
    { name: "nonmember", role: "member" as const, membership: false },
  ])("requires current non-viewer company membership for a $name", async ({ role, membership }) => {
    const f = await seed(role, membership);
    const title = `Denied ${randomUUID()}`;
    await expect(issueService(db).create(f.companyId, {
      title,
      createdByUserId: f.userId,
    }, db, undefined, manualActorOptions(f.actor))).rejects.toBeDefined();
    expect(await db.select().from(issues).where(and(eq(issues.companyId, f.companyId), eq(issues.title, title)))).toHaveLength(0);
  });

  it("rejects an actor whose persisted session was deleted before create", async () => {
    const f = await seed();
    await db.delete(authSessions).where(eq(authSessions.id, f.sessionId));
    const title = `Deleted session ${randomUUID()}`;
    await expect(issueService(db).create(f.companyId, {
      title,
      createdByUserId: f.userId,
    }, db, undefined, manualActorOptions(f.actor))).rejects.toBeDefined();
    expect(await db.select().from(issues).where(and(eq(issues.companyId, f.companyId), eq(issues.title, title)))).toHaveLength(0);
  });

  it("leaves server-derived initial-plan tasks unknown", async () => {
    const f = await seed("admin");
    const response = await request(appFor(f.actor))
      .post(`/api/companies/${f.companyId}/issues`)
      .send({ title: "Task with separate plan", description: "Human body", initialPlan: "Server-stored separate document." })
      .expect(201);
    const { row } = await readOwner(response.body.id);
    expect(row.payloadSourceProtocolVersion).toBe(0);
    expect(row.payloadSourceSnapshot).toBeNull();
    const plan = await db.select({ body: documents.latestBody }).from(issueDocuments)
      .innerJoin(documents, eq(documents.id, issueDocuments.documentId))
      .where(and(eq(issueDocuments.issueId, row.id), eq(issueDocuments.key, "plan")));
    expect(plan).toHaveLength(1);
    expect(plan[0]!.body).toContain("Server-stored separate document.");
  });

  it("captures only new literal child bytes while retaining an unknown parent's privacy dependency", async () => {
    const f = await seed();
    const parent = await issueService(db).create(f.companyId, {
      title: "Existing related parent", description: "Unknown parent source.", createdByUserId: f.userId,
    });
    const child = await issueService(db).create(f.companyId, {
      title: "Related Human child", description: "Independent literal text.", parentId: parent.id,
      responsibleUserId: f.userId, createdByUserId: f.userId,
    }, db, undefined, manualActorOptions(f.actor));
    const { row, proof } = await readOwner(child.id);
    expect((await readOwner(parent.id)).row).toMatchObject({ payloadSourceProtocolVersion: 0, payloadSourceSnapshot: null });
    expect(row.payloadSourceSnapshot).toMatchObject({ inputs: [], policy: {
      issueIds: [parent.id], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [],
    } });
    await assertNativeTaskSourceOwnerCurrent(db, { companyId: f.companyId, actor: f.actor,
      source: { kind: "task", issueId: row.id, sourceVersion: "snapshot-owner-current", contentHash: proof.bodyHash } });
  });

  it.each(["owner", "foreign", "revoked", "changed_parent"] as const)(
    "admits only current literal Human child sources: %s", async mode => {
    const f = await seed();
    const parent = await issueService(db).create(f.companyId, { title: "Private current parent",
      description: "Parent content is not the child input.", visibility: "private", responsibleUserId: f.userId,
      createdByUserId: f.userId }, db, undefined, manualActorOptions(f.actor));
    let actor = f.actor;
    if (mode === "foreign") {
      const other = await seed();
      await db.insert(companyMemberships).values({ companyId: f.companyId, principalType: "user",
        principalId: other.userId, membershipRole: "member", status: "active" });
      actor = { ...other.actor, companyIds: [f.companyId], memberships: [{ companyId: f.companyId,
        membershipRole: "member", status: "active" }] };
    }
    if (mode === "revoked") await db.update(companyMemberships).set({ status: "inactive" }).where(and(
      eq(companyMemberships.companyId, f.companyId), eq(companyMemberships.principalId, f.userId)));
    if (mode === "changed_parent") await issueService(db).update(parent.id, {
      description: "Authoritatively changed source", actorUserId: f.userId, privacyActor: f.actor,
    });
    const response = await request(appFor(actor)).post(`/api/companies/${f.companyId}/issues`).send({
      title: "Literal child request", description: "Only this new Human text.", parentId: parent.id,
    });
    if (mode !== "owner") {
      expect([403, 404]).toContain(response.status);
      expect(await db.select().from(issues).where(and(eq(issues.companyId, f.companyId),
        eq(issues.parentId, parent.id)))).toHaveLength(0);
      return;
    }
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const { row, proof } = await readOwner(response.body.id);
    expect(row).toMatchObject({ parentId: parent.id, visibility: "private", responsibleUserId: f.userId,
      description: "Only this new Human text.", payloadSourceProtocolVersion: 1 });
    expect(row.payloadSourceSnapshot).toMatchObject({ owner: { contentHash: proof.bodyHash },
      policy: { issueIds: [parent.id], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [] });
    expect(proof.digestValid).toBe(true);
    await assertNativeTaskSourceOwnerCurrent(db, { companyId: f.companyId, actor: f.actor,
      source: { kind: "task", issueId: row.id, sourceVersion: "snapshot-owner-current", contentHash: proof.bodyHash } });
    expect(JSON.stringify(row.payloadSourceSnapshot)).not.toContain("Parent content");
    await request(appFor(f.actor)).get(`/api/issues/${row.id}`).expect(200);
    const [audit] = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId),
      eq(activityLog.entityId, row.id), eq(activityLog.action, "issue.payload_source_captured")));
    expect(audit!.details).toMatchObject({ producer: "direct_manual_related_input", parentId: parent.id,
      digest: row.payloadSourceSnapshot!.digest });
  });

  it.each(["project", "parent_project", "wrong_project", "foreign_project", "changed_project"] as const)(
    "captures literal Human Project-task privacy dependencies: %s", async mode => {
    const f = await seed("admin"), http = request(appFor(f.actor));
    const created = await http.post(`/api/companies/${f.companyId}/projects`).send({
      name: "Human selected Project", description: "Project content stays separate", color: "#2457A7", icon: "folder",
    }).expect(201);
    const projectId = created.body.id as string;
    const parent = mode === "parent_project" || mode === "wrong_project" ? await issueService(db).create(f.companyId, {
      title: "Literal Project parent", projectId, createdByUserId: f.userId,
    }, db, undefined, manualActorOptions(f.actor)) : null;
    let selectedProjectId = projectId;
    if (mode === "wrong_project") {
      const other = await http.post(`/api/companies/${f.companyId}/projects`).send({ name: "Different selected Project" }).expect(201);
      selectedProjectId = other.body.id;
    }
    if (mode === "foreign_project") {
      const other = await seed("admin");
      const foreign = await request(appFor(other.actor)).post(`/api/companies/${other.companyId}/projects`)
        .send({ name: "Foreign Project" }).expect(201);
      selectedProjectId = foreign.body.id;
    }
    if (mode === "changed_project") await http.patch(`/api/projects/${projectId}`)
      .send({ description: "Current authoritative Project edit" }).expect(200);
    const response = await http.post(`/api/companies/${f.companyId}/issues`).send({
      title: "Literal Project task", description: "Only this Human Task text", projectId: selectedProjectId,
      ...(parent ? { parentId: parent.id } : {}),
    });
    if (mode !== "project" && mode !== "parent_project") {
      expect([403, 404]).toContain(response.status);
      expect(await db.select().from(issues).where(and(eq(issues.companyId, f.companyId),
        eq(issues.title, "Literal Project task")))).toHaveLength(0);
      return;
    }
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const { row, proof } = await readOwner(response.body.id);
    expect(row.payloadSourceSnapshot).toMatchObject({ owner: { contentHash: proof.bodyHash }, inputs: [],
      policy: { issueIds: parent ? [parent.id] : [], projectIds: [projectId], runIds: [], memoryIds: [], foundationRevisionIds: [] } });
    await assertNativeTaskSourceOwnerCurrent(db, { companyId: f.companyId, actor: f.actor,
      source: { kind: "task", issueId: row.id, sourceVersion: "snapshot-owner-current", contentHash: proof.bodyHash } });
    await http.get(`/api/issues/${row.id}`).expect(200);
  });

  it("does not upgrade an unqualified deduplication replay", async () => {
    const f = await seed("admin");
    const title = `Existing unqualified ${randomUUID()}`;
    const original = await issueService(db).create(f.companyId, { title, createdByUserId: f.userId });
    const response = await request(appFor(f.actor))
      .post(`/api/companies/${f.companyId}/issues`)
      .send({ title })
      .expect(200);
    expect(response.body.id).toBe(original.id);
    for (const field of ["payloadSourceProtocolVersion", "payloadSourceSnapshot", "payloadSourceSnapshotInvalidated"])
      expect(response.body).not.toHaveProperty(field);
    const { row } = await readOwner(original.id);
    expect(row.payloadSourceProtocolVersion).toBe(0);
    expect(row.payloadSourceSnapshot).toBeNull();
    expect(await db.select().from(activityLog).where(and(
      eq(activityLog.entityId, original.id), eq(activityLog.action, "issue.payload_source_captured"),
    ))).toHaveLength(0);
  });

  it("rolls back Task insertion when the source-capture audit cannot be stored", async () => {
    const f = await seed("admin");
    const title = `Audit rollback ${randomUUID()}`;
    const triggerName = `reject_manual_capture_${f.companyId.replaceAll("-", "")}`;
    const functionName = triggerName;
    await db.execute(sql`create function public.${sql.identifier(functionName)}() returns trigger language plpgsql as $function$
      begin
        if new.company_id = ${sql.raw(`'${f.companyId}'::uuid`)} and new.action = 'issue.payload_source_captured' then
          raise exception 'fixture capture audit failure';
        end if;
        return new;
      end
    $function$`);
    await db.execute(sql`create trigger ${sql.identifier(triggerName)} before insert on activity_log
      for each row execute function public.${sql.identifier(functionName)}()`);
    try {
      await expect(request(appFor(f.actor))
        .post(`/api/companies/${f.companyId}/issues`)
        .send({ title, description: "must roll back" })
        .then(response => response.status)).resolves.toBe(500);
      expect(await db.select().from(issues).where(and(eq(issues.companyId, f.companyId), eq(issues.title, title)))).toHaveLength(0);
      expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId), eq(activityLog.action, "issue.payload_source_captured")))).toHaveLength(0);
    } finally {
      await db.execute(sql`drop trigger if exists ${sql.identifier(triggerName)} on activity_log`);
      await db.execute(sql`drop function if exists public.${sql.identifier(functionName)}()`);
    }
  });

  it.each(["root", "child", "project"] as const)("rechecks a session after a real company-counter lock wait: %s", async kind => {
    const f = await seed("admin");
    const parent = kind === "child" ? await issueService(db).create(f.companyId, {
      title: "Current parent before wait", createdByUserId: f.userId,
    }, db, undefined, manualActorOptions(f.actor)) : null;
    const project = kind === "project" ? await request(appFor(f.actor)).post(`/api/companies/${f.companyId}/projects`)
      .send({ name: "Current Project before wait" }).expect(201) : null;
    await db.execute(sql`update "session" set expires_at=clock_timestamp()+interval '1500 milliseconds' where id=${f.sessionId}`);
    const [liveAtStart] = await db.execute<{ live: boolean }>(sql`select expires_at>clock_timestamp() as live from "session" where id=${f.sessionId}`);
    expect(liveAtStart!.live).toBe(true);

    let release!: () => void;
    let locked!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const lockReady = new Promise<void>(resolve => { locked = resolve; });
    const holder = db.transaction(async tx => {
      await tx.execute(sql`select id from companies where id=${f.companyId}::uuid for update`);
      locked();
      await released;
    });
    await lockReady;
    const title = `Expiry after company lock ${randomUUID()}`;
    const creating = issueService(db).create(f.companyId, {
      title,
      description: "expires while waiting",
      ...(parent ? { parentId: parent.id } : {}),
      createdByUserId: f.userId,
    }, db, undefined, manualActorOptions(f.actor));
    try {
      const deadline = Date.now() + 10_000;
      let blocked = false;
      while (Date.now() < deadline) {
        const [waiter] = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity
          where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query ilike '%companies%'`);
        if ((waiter?.count ?? 0) >= 1) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      await db.execute(sql`select pg_sleep(1.8)`);
    } finally {
      release();
    }
    await holder;
    await expect(creating).rejects.toBeDefined();
    expect(await db.select().from(issues).where(and(eq(issues.companyId, f.companyId), eq(issues.title, title)))).toHaveLength(0);
  });
});
