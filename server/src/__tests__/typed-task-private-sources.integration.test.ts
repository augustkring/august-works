import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authUsers,
  authSessions,
  companyMemberships,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns,
  issuePrivacySources,
  issues,
  memoryDeletionMarkers,
  principalPermissionGrants,
  routineRuns,
} from "@paperclipai/db";
import { authorizationService, canActorReadIssuePrivacy, issueReadSqlCondition } from "../services/authorization.js";
import { canActorReadTypedTaskSourcePrivacy } from "../services/authorization.js";
import { issueService } from "../services/issues.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/error-handler.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../services/memory/memory-privacy.js";
import { routineAuthoringToolsService } from "../services/routine-authoring-tools.js";
import { grantsForHumanRole } from "../services/company-member-roles.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";

describe("typed routine Task private source graph", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>;
  let bobId: string;
  let bobSessionId: string;
  let conversationId: string;
  let authoringRunId: string;

  const routineInput = (idempotencyKey = "private-typed-task-source") => ({ idempotencyKey, title: "Private saved routine", description: "PRIVATE routine body", priority: "medium" });
  const authoringContext = () => ({ companyId: f.home, agentId: f.presence.id, runId: authoringRunId });
  async function createSession(userId: string) {
    const now = new Date();
    const [session] = await db.insert(authSessions).values({ id: randomUUID(), userId, token: randomUUID(),
      createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60 * 60_000) }).returning();
    return session!;
  }

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("typed-task-private-sources-");
    db = createDb(database.connectionString, { maxConnections: 8 });
    await enableV5ForTest(db);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ experience_projection_v9: true, ambient_commands_v9: true });
    f = await seedV5Presences(db);
    const ownerSession = await createSession(f.userId);
    f = { ...f, actor: { ...f.actor, sessionId: ownerSession.id } };
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id,
      permissionKey: "tasks:assign" }).onConflictDoNothing();
    const bob = `user-${randomUUID()}`;
    const now = new Date();
    await db.insert(authUsers).values({ id: bob, name: "Second routine reader", email: `${bob}@test.invalid`,
      emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "user", principalId: bob,
      membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({ companyId: f.home,
      principalType: "user" as const, principalId: bob, ...grant })));
    bobId = bob;
    bobSessionId = (await createSession(bobId)).id;

    const conversation = await issueService(db).create(f.home, { title: "Private routine authoring conversation",
      assigneeAgentId: f.presence.id, conversationAgentId: f.presence.id, conversationUserId: f.userId,
      conversationState: "active", status: "in_progress", createdByUserId: f.userId });
    conversationId = conversation.id;
    const [authoringRun] = await db.insert(heartbeatRuns).values({ companyId: f.home,
      agentId: f.presence.id, responsibleUserId: f.userId, nativeIssueId: conversationId, runtimeMode: "native",
      status: "running", contextSnapshot: { conversationSessionGeneration: 0 } }).returning();
    authoringRunId = authoringRun!.id;
    await db.update(issues).set({ executionRunId: authoringRunId }).where(eq(issues.id, conversationId));
  });

  async function createRoutineAndRun(idempotencyKey?: string) {
    const created = await routineAuthoringToolsService(db).create(authoringContext(), routineInput(idempotencyKey));
    const [run] = await db.insert(routineRuns).values({ companyId: f.home, routineId: created.routineId,
      routineRevisionId: created.currentRevisionId!, source: "api", status: "received", responsibleUserId: f.userId }).returning();
    return { routineId: created.routineId, revisionId: created.currentRevisionId!, run: run! };
  }

  async function createTypedTask(source: Awaited<ReturnType<typeof createRoutineAndRun>>) {
    return issueService(db).create(f.home, { title: "PRIVATE copied execution Task", description: "PRIVATE execution detail",
      originKind: "routine_execution", originId: source.routineId, originRunId: source.run.id,
      createdByUserId: f.userId, responsibleUserId: f.userId, actorResponsibleUserId: f.userId,
      trustExplicitResponsibleUserId: true }, db, undefined, { privacyActor: ownerActor() });
  }

  const ownerActor = () => f.actor;
  const bobActor = () => ({ type: "board" as const, source: "session" as const, userId: bobId, sessionId: bobSessionId, companyIds: [f.home] });

  function appFor(actor: Express.Request["actor"]) {
    const app = express();
    app.use((req, _res, next) => { req.actor = actor; next(); });
    app.use("/api", issueRoutes(db, {} as never));
    app.use(errorHandler);
    return request(app);
  }

  it("retains the exact typed RoutineRun edge and limits its private Task to the actual routine owner", async () => {
    const source = await createRoutineAndRun();
    const task = await createTypedTask(source);
    expect(task.visibility).toBe("private");
    expect(await db.select().from(issuePrivacySources).where(and(eq(issuePrivacySources.issueId, task.id),
      eq(issuePrivacySources.sourceKind, "routine_run"), eq(issuePrivacySources.sourceId, source.run.id)))).toHaveLength(1);
    expect(await canActorReadIssuePrivacy(db, ownerActor(), task)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, bobActor(), task)).toBe(false);
  }, 90_000);

  it("withdraws the copied Task for both readers when its actual authoring source is erased", async () => {
    const source = await createRoutineAndRun();
    const task = await createTypedTask(source);
    expect(await canActorReadIssuePrivacy(db, ownerActor(), task)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, bobActor(), task)).toBe(false);
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      await lockMemoryPrivacy(tx, f.home);
      await tx.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source",
        key: `memory-run-source-erasure:v1:${authoringRunId}` });
      await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), {
        workflowRevisionIds: [], artifactVersionIds: [], runIds: [authoringRunId],
      });
    });
    const [stored] = await db.select().from(issues).where(eq(issues.id, task.id));
    expect(await canActorReadIssuePrivacy(db, ownerActor(), stored!)).toBe(false);
    expect(await canActorReadIssuePrivacy(db, bobActor(), stored!)).toBe(false);
  }, 90_000);

  it("denies a second company owner a structurally stored open Task from the private typed source", async () => {
    const source = await createRoutineAndRun();
    const [task] = await db.insert(issues).values({ companyId: f.home, title: "Private source stored as open",
      visibility: "open", originKind: "routine_execution", originId: source.routineId, originRunId: source.run.id,
      createdByUserId: f.userId, responsibleUserId: f.userId }).returning();
    expect(await canActorReadIssuePrivacy(db, bobActor(), task!)).toBe(false);
  }, 90_000);

  it("keeps an unrelated public manual Task readable by both company owners", async () => {
    const task = await issueService(db).create(f.home, { title: "Public manual control", visibility: "open",
      createdByUserId: f.userId, responsibleUserId: f.userId });
    expect(await canActorReadIssuePrivacy(db, ownerActor(), task)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, bobActor(), task)).toBe(true);
  }, 90_000);

  it("filters Routine-backed private Tasks before interactive search and extraction", async () => {
    const source = await createRoutineAndRun();
    await createTypedTask(source);
    const ownerHttp = appFor(ownerActor());
    const bobHttp = appFor(bobActor());
    const search = await ownerHttp.get(`/api/companies/${f.home}/search`).query({ q: "PRIVATE copied execution Task", scope: "issues" }).expect(200);
    expect(JSON.stringify(search.body.results)).toContain("PRIVATE copied execution Task");
    const extraction = await ownerHttp.get(`/api/companies/${f.home}/search/extract`)
      .query({ contains: "PRIVATE copied execution Task", scope: "issues" }).expect(200);
    expect(JSON.stringify(extraction.body.results)).toContain("PRIVATE copied execution Task");

    const bobSearch = await bobHttp.get(`/api/companies/${f.home}/search`)
      .query({ q: "PRIVATE copied execution Task", scope: "issues" }).expect(200);
    const bobExtraction = await bobHttp.get(`/api/companies/${f.home}/search/extract`)
      .query({ contains: "PRIVATE copied execution Task", scope: "issues" }).expect(200);
    expect(JSON.stringify(bobSearch.body.results)).not.toContain("PRIVATE copied execution Task");
    expect(JSON.stringify(bobExtraction.body.results)).not.toContain("PRIVATE copied execution Task");
    expect(bobSearch.body.countsByType.issue).toBe(0);
    expect(bobExtraction.body.results).toHaveLength(0);

    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      await authorizationService(tx).withReadRoutineSources(f.guest, ownerActor(), [source.run.id], async () => {
        expect(await canActorReadTypedTaskSourcePrivacy(tx, ownerActor(), {
          sourceKind: "routine_run", id: source.run.id, companyId: f.guest,
        })).toBe(false);
      });
    });
  }, 90_000);

  it("keeps public local search usable without granting private Routine authority", async () => {
    const source = await createRoutineAndRun();
    await createTypedTask(source);
    const task = await issueService(db).create(f.home, { title: "Public search control", visibility: "open",
      createdByUserId: f.userId, responsibleUserId: f.userId });
    const http = appFor({ type: "board", source: "local_implicit", isInstanceAdmin: true });
    const visible = await http.get(`/api/companies/${f.home}/search`).query({ q: "Public search control", scope: "issues" }).expect(200);
    expect(visible.body.results.some((row: { id: string }) => row.id === task.id)).toBe(true);
    const hidden = await http.get(`/api/companies/${f.home}/search`).query({ q: "PRIVATE copied execution Task", scope: "issues" }).expect(200);
    expect(hidden.body.countsByType.issue).toBe(0);
    expect(hidden.body.results).toHaveLength(0);
    const extraction = await http.get(`/api/companies/${f.home}/search/extract`)
      .query({ contains: "PRIVATE copied execution Task", scope: "issues" }).expect(200);
    expect(extraction.body.results).toHaveLength(0);
  }, 90_000);

  it("removes Routine-backed private Tasks from search after source conversation retirement", async () => {
    const source = await createRoutineAndRun();
    await createTypedTask(source);
    const http = appFor(ownerActor());
    const initial = await http.get(`/api/companies/${f.home}/search`).query({ q: "PRIVATE copied execution Task", scope: "issues" }).expect(200);
    expect(JSON.stringify(initial.body.results)).toContain("PRIVATE copied execution Task");

    await db.update(issues).set({ conversationRetiredAt: new Date(), hiddenAt: new Date(), status: "cancelled",
      assigneeAgentId: null, assigneeUserId: null, executionRunId: null, conversationAgentId: null,
      conversationUserId: null, conversationState: null }).where(eq(issues.id, conversationId));
    const afterRetirement = await http.get(`/api/companies/${f.home}/search`)
      .query({ q: "PRIVATE copied execution Task", scope: "issues" }).expect(200);
    expect(JSON.stringify(afterRetirement.body.results)).not.toContain("PRIVATE copied execution Task");
    const afterRetirementExtraction = await http.get(`/api/companies/${f.home}/search/extract`)
      .query({ contains: "PRIVATE copied execution Task", scope: "issues" }).expect(200);
    expect(JSON.stringify(afterRetirementExtraction.body.results)).not.toContain("PRIVATE copied execution Task");
  }, 90_000);

  it("rejects search and extraction after the original Human session expires", async () => {
    const source = await createRoutineAndRun();
    await createTypedTask(source);
    const sessionId = ownerActor().sessionId!;
    await db.update(authSessions).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(authSessions.id, sessionId));
    const http = appFor(ownerActor());
    const search = await http.get(`/api/companies/${f.home}/search`).query({ q: "PRIVATE copied execution Task", scope: "issues" }).expect(403);
    const extraction = await http.get(`/api/companies/${f.home}/search/extract`)
      .query({ contains: "PRIVATE copied execution Task", scope: "issues" }).expect(403);
    expect(JSON.stringify(search.body)).not.toContain("PRIVATE copied execution Task");
    expect(JSON.stringify(extraction.body)).not.toContain("PRIVATE copied execution Task");
  }, 90_000);

  it("fails closed when the company search source candidate set exceeds its 256 run bound", async () => {
    const source = await createRoutineAndRun();
    const task = await createTypedTask(source);
    const extraRuns = await db.insert(routineRuns).values(Array.from({ length: 256 }, () => ({ companyId: f.home,
      routineId: source.routineId, routineRevisionId: source.revisionId, source: "api", status: "received",
      responsibleUserId: f.userId }))).returning({ id: routineRuns.id });
    await db.insert(issuePrivacySources).values(extraRuns.map(run => ({ companyId: f.home, issueId: task.id,
      sourceKind: "routine_run" as const, sourceId: run.id })));
    const response = await appFor(ownerActor()).get(`/api/companies/${f.home}/search`)
      .query({ q: "PRIVATE copied execution Task", scope: "issues" }).expect(403);
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE copied execution Task");
    const help = await appFor(ownerActor()).get(`/api/companies/${f.home}/search`)
      .query({ q: "Recover interrupted work", scope: "help" }).expect(200);
    expect(JSON.stringify(help.body.results)).toContain("recovering-work");
  }, 90_000);

  it("expires the exact Routine source capability when its native callback returns", async () => {
    const source = await createRoutineAndRun();
    const task = await createTypedTask(source);
    const secondSource = await createRoutineAndRun(`private-typed-task-source-${randomUUID()}`);
    const secondTask = await createTypedTask(secondSource);
    let invokeAfter: (() => Promise<string[]>) | undefined;
    let escapedCondition: Awaited<ReturnType<typeof issueReadSqlCondition>> | undefined;
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      await authorizationService(tx).withReadRoutineSources(f.home, ownerActor(), [source.run.id], async owner => {
        invokeAfter = () => owner.readRoutineSources!([source.run.id], ownerActor());
        escapedCondition = await issueReadSqlCondition(tx, ownerActor());
        expect(await canActorReadIssuePrivacy(tx, ownerActor(), task)).toBe(true);
      });
      const staleRows = await tx.select({ id: issues.id }).from(issues).where(and(eq(issues.id, task.id), escapedCondition!));
      expect(staleRows).toHaveLength(0);
      await authorizationService(tx).withReadRoutineSources(f.home, ownerActor(), [secondSource.run.id], async () => {
        const staleRowsInNextScope = await tx.select({ id: issues.id }).from(issues)
          .where(and(eq(issues.id, task.id), escapedCondition!));
        expect(staleRowsInNextScope).toHaveLength(0);
        expect(await canActorReadIssuePrivacy(tx, ownerActor(), secondTask)).toBe(true);
      });
    });
    await expect(invokeAfter!()).rejects.toThrow("original native source scope");
  }, 90_000);

  it("holds the original Human credential and source conversation through the native callback", async () => {
    const source = await createRoutineAndRun();
    const task = await createTypedTask(source);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const scopedRead = db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      return authorizationService(tx).withReadRoutineSources(f.home, ownerActor(), [source.run.id], async () => {
        expect(await canActorReadIssuePrivacy(tx, ownerActor(), task)).toBe(true);
        enter();
        await gate;
      });
    });
    await entered;
    let sessionUpdateFinished = false;
    let conversationUpdateFinished = false;
    const sessionUpdate = db.update(authSessions).set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(authSessions.id, ownerActor().sessionId!)).then(() => { sessionUpdateFinished = true; });
    const conversationUpdate = db.update(issues).set({ conversationRetiredAt: new Date(), hiddenAt: new Date(), status: "cancelled",
      assigneeAgentId: null, assigneeUserId: null, executionRunId: null, conversationAgentId: null,
      conversationUserId: null, conversationState: null })
      .where(eq(issues.id, conversationId)).then(() => { conversationUpdateFinished = true; });
    await new Promise(resolve => setTimeout(resolve, 75));
    expect(sessionUpdateFinished).toBe(false);
    expect(conversationUpdateFinished).toBe(false);
    release();
    await scopedRead;
    await Promise.all([sessionUpdate, conversationUpdate]);
    expect(sessionUpdateFinished).toBe(true);
    expect(conversationUpdateFinished).toBe(true);
  }, 90_000);

  it("refuses the native read when the original authenticated session deadline passes during the callback", async () => {
    const source = await createRoutineAndRun();
    const task = await createTypedTask(source);
    const expiresAt = new Date(Date.now() + 1_200);
    await db.update(authSessions).set({ expiresAt }).where(eq(authSessions.id, ownerActor().sessionId!));
    const expiringActor = { ...ownerActor(), authenticatedCredentialExpiresAt: expiresAt.getTime() };
    await expect(db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      return authorizationService(tx).withReadRoutineSources(f.home, expiringActor, [source.run.id], async () => {
        expect(await canActorReadIssuePrivacy(tx, expiringActor, task)).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 1_500));
        return true;
      });
    })).rejects.toMatchObject({ status: 403 });
  }, 90_000);
});
