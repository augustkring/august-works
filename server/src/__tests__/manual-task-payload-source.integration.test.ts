import { randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentIdentities, agentProviderBindings, agentPresenceRuntimeBindings, billingAccounts, billingAccountCompanies,
  runtimeCapacityProfiles, runtimeVersionCatalog, runtimeCells,
  agents,
  authSessions,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  documents,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  environmentLeases,
  executionWorkspaces,
  heartbeatRuns,
  issueDocuments,
  issues,
  projects,
  projectWorkspaces,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/error-handler.js";
import { issueRoutes } from "../routes/issues.js";
import { projectRoutes } from "../routes/projects.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { issueService, isManualRelatedPayloadInput } from "../services/issues.js";
import { environmentService } from "../services/environments.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { assertWorkspacePreparationBindingOwned, legacyControllerBootId } from "../services/legacy-controller-lease.js";
import { assertNativeTaskSourceOwnerCurrent } from "../services/native-direct-input.js";

describe("manual Human Task payload source capture", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("manual-task-payload-source-");
    db = createDb(database.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  it("admits only literal workspace mode selection for original manual related text", () => {
    const base = { title: "Literal Human task", projectId: randomUUID() };
    for (const mode of ["isolated_workspace", "shared_workspace"]) {
      expect(isManualRelatedPayloadInput({ ...base, executionWorkspaceSettings: { mode } })).toBe(true);
      expect(isManualRelatedPayloadInput({ ...base, executionWorkspaceSettings: { mode }, executionWorkspaceId: randomUUID() })).toBe(false);
      expect(isManualRelatedPayloadInput({ ...base, executionWorkspaceSettings: { mode }, executionWorkspacePreference: "reuse_existing" })).toBe(false);
      expect(isManualRelatedPayloadInput({ ...base, executionWorkspaceSettings: { mode, workspaceStrategy: { type: "project_primary" } } })).toBe(false);
      expect(isManualRelatedPayloadInput({ ...base, executionWorkspaceSettings: { mode, env: { TOKEN: "private-fixture-only" } } })).toBe(false);
    }
    expect(isManualRelatedPayloadInput(base)).toBe(true);
    expect(isManualRelatedPayloadInput({ ...base, executionWorkspaceSettings: { mode: "unknown" } })).toBe(false);
  });

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
  it.each(["explicit", "default_primary"] as const)("captures the actual resolved Project workspace selector: %s", async mode => {
    const f = await seed("admin"), http = request(appFor(f.actor));
    const created = await http.post(`/api/companies/${f.companyId}/projects`).send({
      name: "Current selected Project", workspace: { name: "Primary repository",
        repoUrl: "https://example.test/current-project.git", isPrimary: true },
    }).expect(201);
    const [workspace] = await db.select().from(projectWorkspaces).where(and(
      eq(projectWorkspaces.companyId, f.companyId), eq(projectWorkspaces.projectId, created.body.id)));
    expect(workspace).toBeDefined();
    const response = await http.post(`/api/companies/${f.companyId}/issues`).send({
      title: `Literal workspace request ${mode}`, description: "Only the Human's literal request, not copied repository bytes.",
      projectId: created.body.id, ...(mode === "explicit" ? { projectWorkspaceId: workspace!.id } : {}),
    }).expect(201);
    const { row, proof } = await readOwner(response.body.id);
    expect(row.projectWorkspaceId).toBe(workspace!.id);
    expect(row.payloadSourceProtocolVersion).toBe(1);
    expect(row.payloadSourceSnapshotInvalidated).toBe(false);
    expect(proof.digestValid).toBe(true);
    expect(row.payloadSourceSnapshot).toMatchObject({ owner: { kind: "issue", companyId: f.companyId, id: row.id,
      contentHash: proof.bodyHash }, policy: { issueIds: [], projectIds: [created.body.id], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [] });
    await expect(assertNativeTaskSourceOwnerCurrent(db, { companyId: f.companyId, actor: f.actor,
      source: { kind: "task", issueId: row.id, sourceVersion: "snapshot-owner-current", contentHash: proof.bodyHash } })).resolves.toBeUndefined();
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId),
      eq(activityLog.entityId, row.id), eq(activityLog.action, "issue.payload_source_captured")));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ producer: "direct_manual_related_input", projectId: created.body.id,
      projectWorkspaceId: workspace!.id, digest: row.payloadSourceSnapshot!.digest });
  });

  it.each(["wrong_project", "foreign_company", "missing_workspace", "source_access_revoked"] as const)(
    "denies an unauthorized explicit Project workspace before Task persistence: %s", async mode => {
    const f = await seed("admin"), http = request(appFor(f.actor));
    const selected = await http.post(`/api/companies/${f.companyId}/projects`).send({
      name: "Selected Project", workspace: { name: "Selected workspace", repoUrl: "https://example.test/selected.git" },
    }).expect(201);
    const [primary] = await db.select().from(projectWorkspaces).where(and(eq(projectWorkspaces.companyId, f.companyId),
      eq(projectWorkspaces.projectId, selected.body.id)));
    let workspaceId = primary!.id;
    if (mode === "wrong_project" || mode === "foreign_company") {
      const other = mode === "foreign_company" ? await seed("admin") : f;
      const created = await request(appFor(other.actor)).post(`/api/companies/${other.companyId}/projects`).send({
        name: "Unselected Project", workspace: { name: "Unselected workspace", repoUrl: "https://example.test/unselected.git" },
      }).expect(201);
      const [workspace] = await db.select().from(projectWorkspaces).where(eq(projectWorkspaces.projectId, created.body.id));
      workspaceId = workspace!.id;
    }
    if (mode === "missing_workspace") workspaceId = randomUUID();
    if (mode === "source_access_revoked") await db.delete(companyMemberships).where(and(
      eq(companyMemberships.companyId, f.companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, f.userId)));
    const title = `Rejected selector ${randomUUID()}`;
    const response = await http.post(`/api/companies/${f.companyId}/issues`).send({ title, projectId: selected.body.id,
      projectWorkspaceId: workspaceId });
    expect([403, 404, 422]).toContain(response.status);
    expect(await db.select().from(issues).where(and(eq(issues.companyId, f.companyId), eq(issues.title, title)))).toHaveLength(0);
  });

  it("keeps workspace-only inference outside the authenticated manual related Source domain", async () => {
    const f = await seed("admin"), http = request(appFor(f.actor));
    const created = await http.post(`/api/companies/${f.companyId}/projects`).send({ name: "Inferred Project",
      workspace: { name: "Existing workspace", repoUrl: "https://example.test/inferred.git" } }).expect(201);
    const [workspace] = await db.select().from(projectWorkspaces).where(eq(projectWorkspaces.projectId, created.body.id));
    const response = await http.post(`/api/companies/${f.companyId}/issues`).send({ title: "Unknown workspace-only source",
      projectWorkspaceId: workspace!.id }).expect(201);
    const { row } = await readOwner(response.body.id);
    expect(row.projectId).toBe(created.body.id);
    expect(row.payloadSourceProtocolVersion).toBe(0);
    expect(row.payloadSourceSnapshot).toBeNull();
  });

  it.each(["workspace_project_changed", "project_invalidated"] as const)(
    "rechecks the original workspace and Project privacy owner on recurring Task reads: %s", async mode => {
    const f = await seed("admin"), http = request(appFor(f.actor));
    const created = await http.post(`/api/companies/${f.companyId}/projects`).send({ name: "Captured Project",
      workspace: { name: "Captured workspace", repoUrl: "https://example.test/captured.git" } }).expect(201);
    const [workspace] = await db.select().from(projectWorkspaces).where(eq(projectWorkspaces.projectId, created.body.id));
    const response = await http.post(`/api/companies/${f.companyId}/issues`).send({ title: "Recurring selected workspace",
      projectId: created.body.id, projectWorkspaceId: workspace!.id }).expect(201);
    const { row, proof } = await readOwner(response.body.id);
    await assertNativeTaskSourceOwnerCurrent(db, { companyId: f.companyId, actor: f.actor,
      source: { kind: "task", issueId: row.id, sourceVersion: "snapshot-owner-current", contentHash: proof.bodyHash } });
    if (mode === "workspace_project_changed") {
      const other = await http.post(`/api/companies/${f.companyId}/projects`).send({ name: "Different current Project" }).expect(201);
      await db.update(projectWorkspaces).set({ projectId: other.body.id }).where(eq(projectWorkspaces.id, workspace!.id));
    } else {
      const [invalidated] = await db.update(projects).set({ payloadSourceSnapshot: null })
        .where(eq(projects.id, created.body.id)).returning();
      expect(invalidated).toMatchObject({ payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: true });
    }
    await expect(assertNativeTaskSourceOwnerCurrent(db, { companyId: f.companyId, actor: f.actor,
      source: { kind: "task", issueId: row.id, sourceVersion: "snapshot-owner-current", contentHash: proof.bodyHash } })).rejects.toBeDefined();
  });

  it("binds the original same-Project workspace selector in the capture audit independently of the body hash", async () => {
    const f = await seed("admin"), http = request(appFor(f.actor));
    const created = await http.post(`/api/companies/${f.companyId}/projects`).send({ name: "Selector audit Project",
      workspace: { name: "Original primary", repoUrl: "https://example.test/original.git" } }).expect(201);
    const [original] = await db.select().from(projectWorkspaces).where(eq(projectWorkspaces.projectId, created.body.id));
    const secondary = await http.post(`/api/projects/${created.body.id}/workspaces`).send({
      name: "Different same-Project workspace", repoUrl: "https://example.test/secondary.git" }).expect(201);
    const response = await http.post(`/api/companies/${f.companyId}/issues`).send({ title: "Original explicit selector",
      projectId: created.body.id, projectWorkspaceId: original!.id }).expect(201);
    const before = await readOwner(response.body.id);
    await assertNativeTaskSourceOwnerCurrent(db, { companyId: f.companyId, actor: f.actor,
      source: { kind: "task", issueId: before.row.id, sourceVersion: "snapshot-owner-current", contentHash: before.proof.bodyHash } });
    await db.update(issues).set({ projectWorkspaceId: secondary.body.id }).where(eq(issues.id, before.row.id));
    const after = await readOwner(before.row.id);
    expect(after.row.projectWorkspaceId).toBe(secondary.body.id);
    expect(after.proof.bodyHash).toBe(before.proof.bodyHash);
    expect(after.row.payloadSourceSnapshot).toEqual(before.row.payloadSourceSnapshot);
    await expect(assertNativeTaskSourceOwnerCurrent(db, { companyId: f.companyId, actor: f.actor,
      source: { kind: "task", issueId: after.row.id, sourceVersion: "snapshot-owner-current", contentHash: after.proof.bodyHash } })).rejects.toBeDefined();
  });

  it.each(["native", "preparing"] as const)("retains an originally null workspace across two real %s bindings and keeps purge fail-closed", async (ownerMode) => {
    const f = await seed("admin"), http = request(appFor(f.actor));
    const preparationIdentity = ownerMode === "preparing"
      ? (await db.insert(agentIdentities).values({ name: "Preparation binder", homeCompanyId: f.companyId }).returning())[0]
      : null;
    const [agent] = await db.insert(agents).values({ companyId: f.companyId, name: "Workspace binder",
      agentIdentityId: preparationIdentity?.id ?? null,
      adapterType: "paperclip_runner", status: "active" }).returning();
    const projectResponse = await http.post(`/api/companies/${f.companyId}/projects`).send({
      name: "Source transform Project",
    }).expect(201);
    const projectId = projectResponse.body.id as string;
    // Capture the genuine Human root before the Project has any workspace.
    // Later bindings must retain this NULL selector, not coalesce it to the current binding.
    const task = await issueService(db).create(f.companyId, {
      title: `Private related Task ${randomUUID()}`, description: "Literal Human source remains unchanged.",
      projectId, visibility: "private",
      responsibleUserId: f.userId, createdByUserId: f.userId, assigneeAgentId: agent!.id,
    }, db, undefined, manualActorOptions(f.actor));
    const original = await readOwner(task.id);
    expect(original.row.projectWorkspaceId).toBeNull();
    await http.post(`/api/projects/${projectId}/workspaces`).send({
      name: "Initial Project workspace", repoUrl: "https://example.test/source-transform.git", isPrimary: true,
    }).expect(201);
    const [firstProjectWorkspace] = await db.select().from(projectWorkspaces)
      .where(and(eq(projectWorkspaces.companyId, f.companyId), eq(projectWorkspaces.projectId, projectId)));
    const secondWorkspaceResponse = await http.post(`/api/projects/${projectId}/workspaces`).send({
      name: "Second Project workspace", repoUrl: "https://example.test/source-transform-second.git",
    }).expect(201);
    const secondProjectWorkspaceId = secondWorkspaceResponse.body.id as string;
    const [secondProjectWorkspace] = await db.select().from(projectWorkspaces)
      .where(eq(projectWorkspaces.id, secondProjectWorkspaceId));
    expect(firstProjectWorkspace).toBeDefined();
    expect(secondProjectWorkspace).toBeDefined();

    const neighbor = await issueService(db).create(f.companyId, {
      title: `Neighbor source ${randomUUID()}`, description: "Independent Human source.", projectId,
      responsibleUserId: f.userId, createdByUserId: f.userId,
    }, db, undefined, manualActorOptions(f.actor));
    const neighborBefore = await readOwner(neighbor.id);
    expect(original.row.visibility).toBe("private");
    expect(original.row.createdByUserId).toBe(f.userId);
    expect(original.row.payloadSourceSnapshot).toMatchObject({ version: 1, inputs: [],
      owner: { kind: "issue", companyId: f.companyId, id: task.id, contentHash: original.proof.bodyHash },
      policy: { issueIds: [], projectIds: [projectId], runIds: [], memoryIds: [], foundationRevisionIds: [] } });
    expect(neighborBefore.row.payloadSourceSnapshot).not.toBeNull();

    const environment = await environmentService(db).ensureLocalEnvironment();
    const preparingRunId = ownerMode === "preparing" ? randomUUID() : undefined;
    if (ownerMode === "preparing") {
      // Migration 0326 creates the provider and presence rows from the Agent
      // insert. Reuse those unqualified rows; the STOPPED cell below is only
      // commercial fixture state and grants no runtime or paid-capacity proof.
      const identity = preparationIdentity;
      if (!identity) throw new Error("preparation_identity_fixture_missing");
      const [provider] = await db.select().from(agentProviderBindings).where(and(
        eq(agentProviderBindings.id, agent!.id), eq(agentProviderBindings.agentIdentityId, identity.id)));
      const [presence] = await db.select().from(agentPresenceRuntimeBindings).where(and(
        eq(agentPresenceRuntimeBindings.companyId, f.companyId), eq(agentPresenceRuntimeBindings.agentId, agent!.id)));
      expect(provider).toMatchObject({ id: agent!.id, agentIdentityId: identity.id, status: "unqualified" });
      expect(presence).toMatchObject({ agentIdentityId: identity.id, providerBindingId: provider!.id });
      const [account] = await db.insert(billingAccounts).values({displayName:"Workspace policy fixture",payerUserId:f.userId}).returning();
      await db.insert(billingAccountCompanies).values({billingAccountId:account!.id,companyId:f.companyId});
      const capacity=`preparing-${randomUUID()}`,image=`fixture.invalid/preparing-${randomUUID()}@sha256:${"a".repeat(64)}`;
      await db.insert(runtimeCapacityProfiles).values({key:capacity,cpuMillis:100,memoryBytes:16777216n,diskBytes:1048576n,pidsLimit:16});
      await db.insert(runtimeVersionCatalog).values({imageDigest:image,providerVersion:"fixture",stateFormat:"fixture",hostAgentMinimumVersion:"fixture",conformance:{}});
      const [cell] = await db.insert(runtimeCells).values({companyId:f.companyId,billingAccountId:account!.id,
        providerBindingId:provider!.id,runtimeProvider:"paperclip_runner",capacityProfile:capacity,
        isolationMode:"company_cell",status:"STOPPED",desiredImageDigest:image}).returning();
      // Set the commercial profile before the heartbeat Run exists. Its
      // namespace is predictable because the Run ID was allocated above.
      await db.update(agentPresenceRuntimeBindings).set({
        providerProfileRef:`aw:cell:${cell!.id}:generation:${cell!.generation}`,
        providerSessionNamespace:`preparing-${preparingRunId}`,
      }).where(eq(agentPresenceRuntimeBindings.id, presence!.id));
      const [preparedPresence] = await db.select().from(agentPresenceRuntimeBindings)
        .where(eq(agentPresenceRuntimeBindings.id, presence!.id));
      expect(preparedPresence).toMatchObject({ providerBindingId: provider!.id,
        providerProfileRef: `aw:cell:${cell!.id}:generation:${cell!.generation}`,
        providerSessionNamespace: `preparing-${preparingRunId}` });
    }
    const [run] = await db.insert(heartbeatRuns).values({
      ...(preparingRunId ? { id: preparingRunId } : {}),
      companyId: f.companyId, agentId: agent!.id,
      ...(ownerMode === "native" ? {scopeKind:"issue" as const,issueId:task.id,nativeIssueId:task.id} : {}),
      responsibleUserId: f.userId, status: "running", runtimeMode: ownerMode === "native" ? "native" : "legacy",
      runtimeModeResolvedAt: ownerMode === "native" ? new Date() : null,
      ...(ownerMode === "preparing" ? {controllerBootId: legacyControllerBootId,
        controllerLeaseExpiresAt: sql`clock_timestamp()+interval '1 hour'`, executionStage: "preparing",
        runnerProfileJson: {adapterDispatch:{adapterType:"paperclip_runner"}}} : {}),
      startedAt: new Date(), contextSnapshot: { issueId: task.id },
    }).returning();
    if (ownerMode === "preparing") {
      // Match the real heartbeat insert: context only; 0503 derives scope/issue.
      expect(run).toMatchObject({scopeKind:"issue",issueId:task.id,nativeIssueId:null});
      await db.update(issues).set({executionRunId:run!.id}).where(eq(issues.id,task.id));
      // STOPPED must still deny ordinary writes. The preceding metadata update
      // was not runtime-start or paid-capacity authority.
      await expect(issueService(db).update(task.id,{priority:"high",actorAgentId:agent!.id,actorRunId:run!.id}))
        .rejects.toMatchObject({status:403});
    }

    async function createExecutionWorkspace(projectWorkspaceId: string, name: string) {
      const [workspace] = await db.insert(executionWorkspaces).values({
        companyId: f.companyId, projectId, projectWorkspaceId, sourceIssueId: task.id,
        mode: "shared_workspace", strategyType: "project_primary", name, status: "active",
        cwd: `/tmp/${randomUUID()}`, repoUrl: "https://example.test/source-transform.git", providerType: "local_fs",
        metadata: { config: { environmentId: environment!.id, runtimeProvisionCommand: "node --version" } },
      }).returning();
      await db.insert(environmentLeases).values({
        companyId: f.companyId, environmentId: environment!.id, executionWorkspaceId: workspace!.id,
        issueId: task.id, heartbeatRunId: run!.id, status: "active", leasePolicy: "ephemeral",
        provider: "local", expiresAt: new Date(Date.now() + 60 * 60_000),
      });
      return workspace!;
    }
    const firstExecutionWorkspace = await createExecutionWorkspace(firstProjectWorkspace!.id, "First bound workspace");
    const secondExecutionWorkspace = await createExecutionWorkspace(secondProjectWorkspace!.id, "Second bound workspace");

    async function bind(workspaceId: string, projectWorkspaceId: string) {
      const [workspaceBefore] = await db.select().from(executionWorkspaces).where(and(
        eq(executionWorkspaces.companyId, f.companyId), eq(executionWorkspaces.id, workspaceId)));
      const before = await readOwner(task.id);
      const snapshot = before.row.payloadSourceSnapshot!;
      await issueService(db).update(task.id, {
        actorAgentId: agent!.id, actorRunId: run!.id,
        executionWorkspaceId: workspaceId, projectWorkspaceId,
        executionWorkspacePreference: "reuse_existing", executionWorkspaceSettings: { mode: "shared_workspace" },
      }, db, undefined, undefined, {
        bindRuntimeSharedWorkspace: true,
        workspaceBindingSourceTransform: { agentId: agent!.id, runId: run!.id, workspaceId,
          expectedPreviousSnapshotDigest: snapshot.digest,
          ...(ownerMode === "preparing" ? {preparingControllerBootId:legacyControllerBootId} : {}) },
      });
      const [workspaceAfter] = await db.select().from(executionWorkspaces).where(and(
        eq(executionWorkspaces.companyId, f.companyId), eq(executionWorkspaces.id, workspaceId)));
      expect(workspaceAfter!.metadata).toEqual(workspaceBefore!.metadata);
      expect(workspaceAfter!.updatedAt).toEqual(workspaceBefore!.updatedAt);
      const after = await readOwner(task.id);
      expect(after.proof.digestValid).toBe(true);
      expect(after.row.payloadSourceSnapshot?.owner.contentHash).toBe(after.proof.bodyHash);
      expect(after.row.payloadSourceSnapshot?.policy).toEqual(snapshot.policy);
      expect(after.row.payloadSourceSnapshot?.inputs).toEqual(snapshot.inputs);
      await expect(assertNativeTaskSourceOwnerCurrent(db, { companyId: f.companyId, actor: f.actor,
        source: { kind: "task", issueId: task.id, sourceVersion: "snapshot-owner-current", contentHash: after.proof.bodyHash } })).resolves.toBeUndefined();
      return after;
    }

    if (ownerMode === "preparing") {
      const proofInput={companyId:f.companyId,issueId:task.id,agentId:agent!.id,runId:run!.id,
        workspaceId:firstExecutionWorkspace.id,controllerBootId:legacyControllerBootId};
      await expect(assertWorkspacePreparationBindingOwned(db,proofInput)).resolves.toMatchObject(proofInput);
      await expect(assertWorkspacePreparationBindingOwned(db,{...proofInput,controllerBootId:randomUUID()})).rejects.toBeDefined();
      await expect(assertWorkspacePreparationBindingOwned(db,{...proofInput,agentId:randomUUID()})).rejects.toBeDefined();
      const rollback=new Error("preparing-owner-negative-rollback");
      for (const negative of ["expired_controller","foreign_controller","no_active_lease","cancel_requested","native_effect","foreign_task","reassigned","hidden","manual_done","context_changed"] as const) {
        await expect(db.transaction(async tx=>{
          if(negative==="expired_controller") await tx.update(heartbeatRuns).set({controllerLeaseExpiresAt:sql`clock_timestamp()-interval '1 second'`}).where(eq(heartbeatRuns.id,run!.id));
          if(negative==="foreign_controller") await tx.update(heartbeatRuns).set({controllerBootId:randomUUID()}).where(eq(heartbeatRuns.id,run!.id));
          if(negative==="no_active_lease") await tx.update(environmentLeases).set({expiresAt:sql`clock_timestamp()-interval '1 second'`}).where(eq(environmentLeases.heartbeatRunId,run!.id));
          if(negative==="cancel_requested") await tx.update(heartbeatRuns).set({resultJson:{executionCancellation:{state:"requested"}}}).where(eq(heartbeatRuns.id,run!.id));
          if(negative==="native_effect") await tx.update(heartbeatRuns).set({runnerProfileJson:{adapterDispatch:{adapterType:"paperclip_runner"},nativeToolCallDispatchAssociations:[{callId:"already-dispatched"}]}}).where(eq(heartbeatRuns.id,run!.id));
          if(negative==="foreign_task") await tx.update(issues).set({executionRunId:null}).where(eq(issues.id,task.id));
          if(negative==="reassigned") await tx.update(issues).set({assigneeAgentId:null}).where(eq(issues.id,task.id));
          if(negative==="hidden") await tx.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,task.id));
          if(negative==="manual_done") await tx.update(issues).set({status:"done"}).where(eq(issues.id,task.id));
          if(negative==="context_changed") await tx.update(heartbeatRuns).set({contextSnapshot:{issueId:task.id,taskId:neighbor.id}}).where(eq(heartbeatRuns.id,run!.id));
          // Even a preceding same-transaction GUC cannot substitute for ownership.
          await tx.execute(sql`select set_config('paperclip.workspace_preparation_controller_boot_id',${legacyControllerBootId},true)`);
          await expect(assertWorkspacePreparationBindingOwned(tx as unknown as typeof db,proofInput)).rejects.toBeDefined();
          throw rollback;
        })).rejects.toBe(rollback);
      }
      await expect(db.transaction(async tx=>{
        // Native issue provenance can be seeded before Native selection by the
        // governance owner. This field alone is not a Native effect or grant.
        await tx.update(heartbeatRuns).set({nativeIssueId:task.id}).where(eq(heartbeatRuns.id,run!.id));
        await expect(assertWorkspacePreparationBindingOwned(tx as unknown as typeof db,proofInput)).resolves.toMatchObject(proofInput);
        throw rollback;
      })).rejects.toBe(rollback);
      await expect(issueService(db).update(task.id,{status:"done",actorAgentId:agent!.id,actorRunId:run!.id,
        executionWorkspaceId:firstExecutionWorkspace.id},db,undefined,undefined,
        {workspaceBindingSourceTransform:{agentId:agent!.id,runId:run!.id,workspaceId:firstExecutionWorkspace.id,
          expectedPreviousSnapshotDigest:original.row.payloadSourceSnapshot!.digest,preparingControllerBootId:legacyControllerBootId}}))
        .rejects.toMatchObject({status:422});
      await expect(issueService(db).update(task.id,{title:"Unrelated literal mutation",actorAgentId:agent!.id,actorRunId:run!.id,
        executionWorkspaceId:firstExecutionWorkspace.id,projectWorkspaceId:firstProjectWorkspace!.id,
        executionWorkspacePreference:"reuse_existing",executionWorkspaceSettings:{mode:"shared_workspace"}},db,undefined,undefined,
        {workspaceBindingSourceTransform:{agentId:agent!.id,runId:run!.id,workspaceId:firstExecutionWorkspace.id,
          expectedPreviousSnapshotDigest:original.row.payloadSourceSnapshot!.digest,preparingControllerBootId:legacyControllerBootId}})).rejects.toBeDefined();
      expect((await readOwner(task.id)).row.payloadSourceSnapshot).toEqual(original.row.payloadSourceSnapshot);
    }

    const afterFirstBinding = await bind(firstExecutionWorkspace.id, firstProjectWorkspace!.id);
    expect(afterFirstBinding.row.payloadSourceSnapshot?.transforms).toHaveLength(1);
    expect(afterFirstBinding.row.payloadSourceSnapshot?.transforms?.[0]).toMatchObject({
      kind: "workspace_binding", beforeProjectWorkspaceId: null, afterProjectWorkspaceId: firstProjectWorkspace!.id });
    const afterSecondBinding = await bind(secondExecutionWorkspace.id, secondProjectWorkspace!.id);
    expect(afterSecondBinding.row.executionWorkspaceId).toBe(secondExecutionWorkspace.id);
    expect(afterSecondBinding.row.projectWorkspaceId).toBe(secondProjectWorkspace!.id);
    expect(afterSecondBinding.row.payloadSourceSnapshot?.transforms).toHaveLength(2);
    const captureAudits = await db.select().from(activityLog).where(and(
      eq(activityLog.companyId, f.companyId), eq(activityLog.entityType, "issue"), eq(activityLog.entityId, task.id),
      eq(activityLog.action, "issue.payload_source_captured"),
    ));
    expect(captureAudits).toHaveLength(1);
    expect(captureAudits[0]).toMatchObject({ actorType: "user", actorId: f.userId });
    const bindingAudits = await db.select().from(activityLog).where(and(
      eq(activityLog.companyId, f.companyId), eq(activityLog.entityType, "issue"), eq(activityLog.entityId, task.id),
      eq(activityLog.action, "issue.payload_source_workspace_bound"),
    ));
    expect(bindingAudits).toHaveLength(2);
    expect(bindingAudits.map(row => row.runId)).toEqual([run!.id, run!.id]);

    const fakeActivityId = randomUUID();
    let forgedWriteCause: { code?: string; message?: string } | undefined;
    try {
      await db.execute(sql`WITH changed AS (
        SELECT jsonb_set(payload_source_snapshot-'digest', '{transforms,0,activityId}', to_jsonb(${fakeActivityId}::text)) AS body
        FROM issues WHERE company_id=${f.companyId}::uuid AND id=${task.id}::uuid
      ), forged AS (
        SELECT body || jsonb_build_object('digest', encode(sha256(convert_to(body::text,'UTF8')),'hex')) AS snapshot
        FROM changed
      ) UPDATE issues AS target SET payload_source_snapshot=forged.snapshot FROM forged
        WHERE target.company_id=${f.companyId}::uuid AND target.id=${task.id}::uuid`);
    } catch (error) {
      forgedWriteCause = (error as { cause?: { code?: string; message?: string } }).cause;
    }
    expect(forgedWriteCause?.code).toBe("23514");
    expect(forgedWriteCause?.message).toContain("Workspace source transform must append one exact Task binding transition");
    const afterForgery = await readOwner(task.id);
    expect(afterForgery.row.payloadSourceSnapshot).toEqual(afterSecondBinding.row.payloadSourceSnapshot);
    await expect(assertNativeTaskSourceOwnerCurrent(db, { companyId: f.companyId, actor: f.actor,
      source: { kind: "task", issueId: task.id, sourceVersion: "snapshot-owner-current", contentHash: afterForgery.proof.bodyHash } })).resolves.toBeUndefined();

    const erased = await db.delete(activityLog).where(and(
      eq(activityLog.companyId, f.companyId), eq(activityLog.entityType, "issue"), eq(activityLog.entityId, task.id),
      inArray(activityLog.action, ["issue.payload_source_captured", "issue.payload_source_workspace_bound"]),
    )).returning({ id: activityLog.id });
    expect(erased).toHaveLength(3);
    await expect(assertNativeTaskSourceOwnerCurrent(db, { companyId: f.companyId, actor: f.actor,
      source: { kind: "task", issueId: task.id, sourceVersion: "snapshot-owner-current", contentHash: afterForgery.proof.bodyHash } })).rejects.toBeDefined();
    const neighborAfter = await readOwner(neighbor.id);
    expect(neighborAfter.row.payloadSourceSnapshot).toEqual(neighborBefore.row.payloadSourceSnapshot);
    await expect(assertNativeTaskSourceOwnerCurrent(db, { companyId: f.companyId, actor: f.actor,
      source: { kind: "task", issueId: neighbor.id, sourceVersion: "snapshot-owner-current", contentHash: neighborAfter.proof.bodyHash } })).resolves.toBeUndefined();
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.companyId),
      eq(activityLog.entityId, neighbor.id), eq(activityLog.action, "issue.payload_source_captured")))).toHaveLength(1);
    const settings = instanceSettingsService(db);
    const previousExperimental = await settings.getExperimental();
    try {
      await settings.updateExperimental({ enableIsolatedWorkspaces: true });
      const [beforeExplicitEdit] = await db.select().from(executionWorkspaces)
        .where(eq(executionWorkspaces.id, secondExecutionWorkspace.id));
      await issueService(db).update(task.id, { actorUserId: f.userId, privacyActor: f.actor,
        executionWorkspaceSettings: { mode: "shared_workspace",
          workspaceStrategy: { type: "project_primary", runtimeProvisionCommand: "node --help" } } });
      const [afterExplicitEdit] = await db.select().from(executionWorkspaces)
        .where(eq(executionWorkspaces.id, secondExecutionWorkspace.id));
      expect(afterExplicitEdit!.metadata?.config).toMatchObject({ environmentId: null,
        runtimeProvisionCommand: "node --help" });
      expect(afterExplicitEdit!.updatedAt.getTime()).toBeGreaterThan(beforeExplicitEdit!.updatedAt.getTime());
    } finally {
      await settings.updateExperimental({ enableIsolatedWorkspaces: previousExperimental.enableIsolatedWorkspaces });
    }
  });

});
