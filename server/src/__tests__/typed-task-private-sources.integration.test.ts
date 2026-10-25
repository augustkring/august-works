import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authUsers,
  authSessions,
  agents,
  companyMemberships,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns,
  issuePrivacySources,
  issueRelations,
  issues,
  memoryDeletionMarkers,
  principalPermissionGrants,
  routineRuns,
  routines,
  routineTriggers,
} from "@paperclipai/db";
import { authorizationService, canActorReadIssuePrivacy, issueReadSqlCondition } from "../services/authorization.js";
import { canActorReadTypedTaskSourcePrivacy } from "../services/authorization.js";
import { issueService } from "../services/issues.js";
import { issueRoutes } from "../routes/issues.js";
import { projectRoutes } from "../routes/projects.js";
import { errorHandler } from "../middleware/error-handler.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../services/memory/memory-privacy.js";
import { routineAuthoringToolsService } from "../services/routine-authoring-tools.js";
import { routineService } from "../services/routines.js";
import { workflowAuthoringToolsService } from "../services/workflows/workflow-authoring-tools.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { workflowExecutorService } from "../services/workflows/workflow-executor.js";
import { withWorkflowAuthoringSourceReview } from "../services/workflows/workflow-authoring-sources.js";
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

  async function createTypedTask(
    source: Awaited<ReturnType<typeof createRoutineAndRun>>,
    options: { projectId?: string; status?: string; assigneeAgentId?: string } = {},
  ) {
    return issueService(db).create(f.home, { title: "PRIVATE copied execution Task", description: "PRIVATE execution detail",
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.assigneeAgentId ? { assigneeAgentId: options.assigneeAgentId } : {}),
      originKind: "routine_execution", originId: source.routineId, originRunId: source.run.id,
      createdByUserId: f.userId, responsibleUserId: f.userId, actorResponsibleUserId: f.userId,
      trustExplicitResponsibleUserId: true }, db, undefined, { privacyActor: ownerActor() });
  }

  async function createWorkflowTask(userId: string, sourceRunId: string, title: string, projectId: string) {
    const actor = { principal: { type: "user" as const, userId } };
    const created = await workflowAuthoringToolsService(db).create(
      { companyId: f.home, agentId: f.presence.id, runId: sourceRunId },
      { name: `${title} workflow`, idempotencyKey: randomUUID() },
    );
    const owner = workflowService(db);
    const changed = await owner.updateDraft(f.home, created.workflow.id, {
      expectedRevisionId: created.workflow.draftRevisionId!,
      graph: {
        version: 1,
        nodes: [
          { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
          { id: "task", type: "work.create_task", name: title, position: { x: 0, y: 1 }, config: {
            title, description: `${title} private detail`, projectId, assigneeAgentId: null,
            assigneeUserId: userId, waitForCompletion: false,
          } },
        ],
        edges: [{ id: "to-task", source: "start", target: "task" }],
        variables: [],
        settings: { totalDeadlineSeconds: 60 },
      },
    }, actor);
    const published = await owner.publish(f.home, changed.id, {
      expectedDraftRevisionId: changed.draftRevisionId!, expectedPublishedRevisionId: null,
    }, actor);
    const execution = await workflowExecutorService(db).startManualRun(
      f.home, published.id, { input: {} }, actor, randomUUID(),
    );
    const [task] = await db.select().from(issues).where(and(
      eq(issues.companyId, f.home), eq(issues.originKind, "workflow_task"), eq(issues.originRunId, execution.run.id),
    ));
    if (!task) throw new Error("Canonical Workflow execution did not create its configured Task");
    return { task, workflowId: created.workflow.id, runId: execution.run.id };
  }

  const ownerActor = () => f.actor;
  const bobActor = () => ({ type: "board" as const, source: "session" as const, userId: bobId, sessionId: bobSessionId, companyIds: [f.home] });

  function appFor(actor: Express.Request["actor"]) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.actor = actor; next(); });
    app.use("/api", issueRoutes(db, {} as never));
    app.use("/api", projectRoutes(db));
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

  it("filters mixed private Workflow Tasks for each current source owner before list, count, Find, and project metrics", async () => {
    await instanceSettingsService(db).updateExperimental({
      enableWorkflowsV1: true, enableWorkflowBuilderV1: true, enableAiWorkflowAuthoring: true, enableAgentChat: true,
    });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id,
      status: "active" }).onConflictDoNothing();
    const workflowPermissions = ["workflows:read", "workflows:edit", "workflows:publish", "workflows:run"];
    await db.insert(principalPermissionGrants).values([
      ...workflowPermissions.map(permissionKey => ({ companyId: f.home, principalType: "agent" as const,
        principalId: f.presence.id, permissionKey })),
      ...[f.userId, bobId].flatMap(userId => workflowPermissions.map(permissionKey => ({ companyId: f.home,
        principalType: "user" as const, principalId: userId, permissionKey }))),
    ]).onConflictDoNothing();

    const ownerHttp = appFor(ownerActor());
    const bobHttp = appFor(bobActor());
    const projectResponse = await ownerHttp.post(`/api/companies/${f.home}/projects`)
      .send({ name: "Mixed Workflow source boundary" }).expect(201);
    const projectId = projectResponse.body.id as string;

    const bobConversation = await issueService(db).create(f.home, {
      title: "Private Bob Workflow source conversation", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: bobId, conversationState: "active",
      status: "in_progress", createdByUserId: bobId, responsibleUserId: bobId,
    }, db, undefined, { privacyActor: bobActor() });
    const [bobAuthoringRun] = await db.insert(heartbeatRuns).values({ companyId: f.home,
      agentId: f.presence.id, responsibleUserId: bobId, nativeIssueId: bobConversation.id, runtimeMode: "native",
      status: "running", contextSnapshot: { conversationSessionGeneration: 0 } }).returning();
    await db.update(issues).set({ executionRunId: bobAuthoringRun!.id }).where(eq(issues.id, bobConversation.id));

    const ownerTask = await createWorkflowTask(f.userId, authoringRunId, "Owner private Workflow Task", projectId);
    const bobTask = await createWorkflowTask(bobId, bobAuthoringRun!.id, "Bob private Workflow Task", projectId);
    for (const task of [ownerTask.task, bobTask.task]) {
      expect(await db.select().from(issuePrivacySources).where(and(eq(issuePrivacySources.issueId, task.id),
        eq(issuePrivacySources.sourceKind, "workflow_run"), eq(issuePrivacySources.sourceId, task.originRunId!)))).toHaveLength(1);
      await db.update(issues).set({ status: "blocked" }).where(eq(issues.id, task.id));
    }
    const routineSource = await createRoutineAndRun("workflow-mixed-routine-source");
    const ownerRoutineTask = await createTypedTask(routineSource, { projectId, status: "blocked" });
    expect(await canActorReadTypedTaskSourcePrivacy(db, ownerActor(), {
      sourceKind: "workflow_run", id: ownerTask.runId, companyId: f.home,
    })).toBe(true);
    await expect(canActorReadTypedTaskSourcePrivacy(db, ownerActor(), {
      sourceKind: "workflow_run", id: bobTask.runId, companyId: f.home,
    })).rejects.toMatchObject({ status: 403 });
    expect(await canActorReadTypedTaskSourcePrivacy(db, bobActor(), {
      sourceKind: "workflow_run", id: bobTask.runId, companyId: f.home,
    })).toBe(true);
    await expect(canActorReadTypedTaskSourcePrivacy(db, bobActor(), {
      sourceKind: "workflow_run", id: ownerTask.runId, companyId: f.home,
    })).rejects.toMatchObject({ status: 403 });

    // The inaccessible row is first in storage order for the other reader.
    // Correct SQL-before-limit filtering must still return the sole readable Task.
    const baseTime = Date.now();
    await db.update(issues).set({ updatedAt: new Date(baseTime + 5_000) }).where(eq(issues.id, bobTask.task.id));
    await db.update(issues).set({ updatedAt: new Date(baseTime + 4_000) }).where(eq(issues.id, ownerTask.task.id));
    const listQuery = { projectId, originKind: "workflow_task", sortField: "updated", sortDir: "desc", limit: 1 };
    const ownerList = await ownerHttp.get(`/api/companies/${f.home}/issues`).query(listQuery).expect(200);
    const bobList = await bobHttp.get(`/api/companies/${f.home}/issues`).query(listQuery).expect(200);
    expect(ownerList.body.map((row: { id: string }) => row.id)).toEqual([ownerTask.task.id]);
    expect(bobList.body.map((row: { id: string }) => row.id)).toEqual([bobTask.task.id]);

    const ownerCount = await ownerHttp.get(`/api/companies/${f.home}/issues/count`)
      .query({ attention: "blocked", projectId, originKind: "workflow_task" }).expect(200);
    const bobCount = await bobHttp.get(`/api/companies/${f.home}/issues/count`)
      .query({ attention: "blocked", projectId, originKind: "workflow_task" }).expect(200);
    expect(ownerCount.body.count).toBe(1);
    expect(bobCount.body.count).toBe(1);

    const ownerSearch = await ownerHttp.get(`/api/companies/${f.home}/search`)
      .query({ q: "private Workflow Task", scope: "issues" }).expect(200);
    const bobSearch = await bobHttp.get(`/api/companies/${f.home}/search`)
      .query({ q: "private Workflow Task", scope: "issues" }).expect(200);
    const ownerExtract = await ownerHttp.get(`/api/companies/${f.home}/search/extract`)
      .query({ contains: "private Workflow Task", scope: "issues" }).expect(200);
    const bobExtract = await bobHttp.get(`/api/companies/${f.home}/search/extract`)
      .query({ contains: "private Workflow Task", scope: "issues" }).expect(200);
    expect(JSON.stringify(ownerSearch.body.results)).toContain("Owner private Workflow Task");
    expect(JSON.stringify(ownerSearch.body.results)).not.toContain("Bob private Workflow Task");
    expect(JSON.stringify(bobSearch.body.results)).toContain("Bob private Workflow Task");
    expect(JSON.stringify(bobSearch.body.results)).not.toContain("Owner private Workflow Task");
    expect(ownerSearch.body.countsByType.issue).toBe(1);
    expect(bobSearch.body.countsByType.issue).toBe(1);
    expect(JSON.stringify(ownerExtract.body.results)).toContain("Owner private Workflow Task");
    expect(JSON.stringify(ownerExtract.body.results)).not.toContain("Bob private Workflow Task");
    expect(JSON.stringify(bobExtract.body.results)).toContain("Bob private Workflow Task");
    expect(JSON.stringify(bobExtract.body.results)).not.toContain("Owner private Workflow Task");

    const ownerProject = (await ownerHttp.get(`/api/companies/${f.home}/projects`).expect(200)).body
      .find((row: { id: string }) => row.id === projectId);
    const bobProject = (await bobHttp.get(`/api/companies/${f.home}/projects`).expect(200)).body
      .find((row: { id: string }) => row.id === projectId);
    expect(ownerProject?.taskCount).toBe(2);
    expect(bobProject?.taskCount).toBe(1);

    let taskQueryEntered = false;
    await expect(db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      return withWorkflowAuthoringSourceReview(async () => {
        await new Promise(resolve => setTimeout(resolve, 8_100));
        return authorizationService(tx).withReadWorkflowTaskCandidates(f.home, ownerActor(), [ownerTask.runId], async () => {
          taskQueryEntered = true;
          return true;
        });
      });
    })).rejects.toMatchObject({ status: 403, details: { code: "workflow_source_review_budget_exceeded" } });
    expect(taskQueryEntered).toBe(false);
  }, 180_000);

  it("keeps assigned narrow Agent Task reads available while withholding private Routine-backed rows", async () => {
    const ownerHttp = appFor(ownerActor());
    const project = await ownerHttp.post(`/api/companies/${f.home}/projects`)
      .send({ name: "Low-trust Routine boundary" }).expect(201);
    const source = await createRoutineAndRun();
    const privateTask = await createTypedTask(source, { assigneeAgentId: f.presence.id, projectId: project.body.id });
    const assignedTask = await issueService(db).create(f.home, {
      title: "Assigned Agent public Task control",
      assigneeAgentId: f.presence.id,
      projectId: project.body.id,
      createdByUserId: f.userId,
      responsibleUserId: f.userId,
    });
    await db.update(issues).set({ updatedAt: new Date(Date.now() + 2_000) }).where(eq(issues.id, privateTask.id));
    await db.update(agents).set({ permissions: {
      trustPreset: "low_trust_review",
      authorizationPolicy: {
        managedBy: "core-trust-preset",
        trustBoundary: { mode: "low_trust_review", companyId: f.home, projectIds: [project.body.id] },
      },
    } }).where(eq(agents.id, f.presence.id));
    const narrowAgent = {
      type: "agent" as const,
      source: "agent_jwt" as const,
      companyId: f.home,
      agentId: f.presence.id,
      runId: authoringRunId,
    };
    expect((await authorizationService(db).decide({
      actor: narrowAgent,
      action: "company_scope:read",
      resource: { type: "company", companyId: f.home },
    })).allowed).toBe(false);

    const response = await appFor(narrowAgent)
      .get(`/api/companies/${f.home}/issues?limit=1&projectId=${project.body.id}`)
      .expect(200);
    expect(response.body.map((row: { id: string }) => row.id)).toContain(assignedTask.id);
    expect(response.body.map((row: { id: string }) => row.id)).not.toContain(privateTask.id);
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE execution detail");
  }, 90_000);

  it("withholds a due private Routine after its current Human source grant is withdrawn", async () => {
    const saved = await routineAuthoringToolsService(db).create(authoringContext(),
      routineInput("private-routine-scheduled-source-withdrawal"));
    const source = { routineId: saved.routineId, revisionId: saved.currentRevisionId! };
    const wakeup = vi.fn(async () => ({ status: "queued" }));
    const owner = routineService(db, { sourceActor: ownerActor(), heartbeat: { wakeup } });

    // A private conversation draft remains inactive until the current Human
    // explicitly configures its target and enables the schedule.
    const configured = await owner.update(source.routineId, {
      baseRevisionId: source.revisionId,
      status: "active",
      executionTarget: { kind: "agent_task", agentId: f.presence.id },
    }, { userId: f.userId });
    expect(configured).toMatchObject({ status: "active", executionTargetKind: "agent_task", executionTargetRef: f.presence.id });
    const { trigger } = await owner.createTrigger(source.routineId, {
      kind: "schedule", enabled: true, cronExpression: "* * * * *", timezone: "UTC",
    }, { userId: f.userId });
    const [scheduledRoutine] = await db.select({ latestRevisionId: routines.latestRevisionId })
      .from(routines).where(eq(routines.id, source.routineId));

    const dueAt = new Date(Date.now() - 1_000);
    await db.update(routineTriggers).set({ nextRunAt: dueAt }).where(eq(routineTriggers.id, trigger.id));
    const runsBefore = await db.select({ id: routineRuns.id }).from(routineRuns).where(eq(routineRuns.routineId, source.routineId));
    const childTasksBefore = await db.select({ id: issues.id }).from(issues).where(and(
      eq(issues.originKind, "routine_execution"), eq(issues.originId, source.routineId),
    ));
    const queuedRunsBefore = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.status, "queued"),
    ));

    // This is the actual authoring Human membership used by the immutable
    // conversation source. Its revocation must invalidate the scheduled read.
    await db.update(companyMemberships).set({ status: "inactive" }).where(and(
      eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, f.userId),
    ));
    const independentOwner = routineService(db, { sourceActor: ownerActor(), heartbeat: { wakeup } });
    const deniedTicks = await Promise.allSettled([
      owner.tickScheduledTriggers(new Date()),
      independentOwner.tickScheduledTriggers(new Date()),
    ]);
    expect(deniedTicks).toHaveLength(2);
    expect(deniedTicks.some(result => result.status === "rejected"
      && (result.reason as { status?: number })?.status === 403)).toBe(true);

    const [storedTrigger] = await db.select().from(routineTriggers).where(eq(routineTriggers.id, trigger.id));
    expect(storedTrigger?.nextRunAt).toBeInstanceOf(Date);
    expect(storedTrigger!.nextRunAt!.getTime()).toBeGreaterThan(dueAt.getTime());
    const runsAfter = await db.select().from(routineRuns).where(eq(routineRuns.routineId, source.routineId));
    expect(runsAfter).toHaveLength(runsBefore.length + 1);
    expect(runsAfter.filter(run => run.status !== "skipped")).toHaveLength(runsBefore.length);
    expect(runsAfter.at(-1)).toMatchObject({
      companyId: f.home, routineId: source.routineId, routineRevisionId: scheduledRoutine!.latestRevisionId,
      source: "schedule", status: "skipped", failureReason: "source_access_withdrawn", triggerId: trigger.id,
      idempotencyKey: `scheduled-source-denial:v1:${trigger.id}:${dueAt.toISOString()}`,
      triggerPayload: { reasonCode: "routine_source_access_withdrawn" }, linkedIssueId: null,
    });
    expect(await db.select({ id: issues.id }).from(issues).where(and(
      eq(issues.originKind, "routine_execution"), eq(issues.originId, source.routineId),
    ))).toEqual(childTasksBefore);
    expect(await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.status, "queued"),
    ))).toEqual(queuedRunsBefore);
    expect(wakeup).not.toHaveBeenCalled();
  }, 90_000);

  it("filters Routine-backed Tasks before issue list limits, blocked counts, and project metrics", async () => {
    const ownerHttp = appFor(ownerActor());
    const projectResponse = await ownerHttp
      .post(`/api/companies/${f.home}/projects`)
      .send({ name: "Routine private task metrics" })
      .expect(201);
    const projectId = projectResponse.body.id as string;
    const source = await createRoutineAndRun();
    const privateTask = await createTypedTask(source, {
      projectId,
      status: "blocked",
    });
    const privateBlocker = await issueService(db).create(
      f.home,
      {
        title: "Private Task's unassigned blocker",
        status: "todo",
        projectId,
        createdByUserId: f.userId,
        responsibleUserId: f.userId,
      },
      db,
      undefined,
      { privacyActor: ownerActor() },
    );
    const publicTask = await issueService(db).create(
      f.home,
      {
        title: "Public blocked control",
        status: "blocked",
        projectId,
        createdByUserId: f.userId,
        responsibleUserId: f.userId,
      },
      db,
      undefined,
      { privacyActor: ownerActor() },
    );
    const publicBlocker = await issueService(db).create(
      f.home,
      {
        title: "Public unassigned blocker",
        status: "todo",
        projectId,
        createdByUserId: f.userId,
        responsibleUserId: f.userId,
      },
      db,
      undefined,
      { privacyActor: ownerActor() },
    );
    await db.insert(issueRelations).values([
      {
        companyId: f.home,
        issueId: privateBlocker.id,
        relatedIssueId: privateTask.id,
        type: "blocks",
      },
      {
        companyId: f.home,
        issueId: publicBlocker.id,
        relatedIssueId: publicTask.id,
        type: "blocks",
      },
    ]);
    const listSortBase = Date.now();
    await db
      .update(issues)
      .set({ updatedAt: new Date(listSortBase + 5_000) })
      .where(eq(issues.id, privateTask.id));
    await db
      .update(issues)
      .set({ updatedAt: new Date(listSortBase + 4_000) })
      .where(eq(issues.id, publicTask.id));

    const taskListPath = `/api/companies/${f.home}/issues?projectId=${projectId}&limit=1`;
    const ownerList = await ownerHttp.get(taskListPath).expect(200);
    expect(ownerList.body[0]?.id).toBe(privateTask.id);

    const bobHttp = appFor(bobActor());
    const bobList = await bobHttp.get(taskListPath).expect(200);
    expect(bobList.body).toHaveLength(1);
    expect(bobList.body[0]?.id).toBe(publicTask.id);
    expect(JSON.stringify(bobList.body)).not.toContain("PRIVATE execution detail");

    const ownerCount = await ownerHttp
      .get(`/api/companies/${f.home}/issues/count`)
      .query({ attention: "blocked", projectId })
      .expect(200);
    const bobCount = await bobHttp
      .get(`/api/companies/${f.home}/issues/count`)
      .query({ attention: "blocked", projectId })
      .expect(200);
    expect(ownerCount.body.count).toBe(2);
    expect(bobCount.body.count).toBe(1);

    const ownerProject = (await ownerHttp
      .get(`/api/companies/${f.home}/projects`)
      .expect(200)).body.find((row: { id: string }) => row.id === projectId);
    const bobProject = (await bobHttp
      .get(`/api/companies/${f.home}/projects`)
      .expect(200)).body.find((row: { id: string }) => row.id === projectId);
    expect(ownerProject?.taskCount).toBe(4);
    expect(bobProject?.taskCount).toBe(3);
  }, 90_000);

  it("rejects Task and Project list/count reads after the original Human session expires", async () => {
    const ownerHttp = appFor(ownerActor());
    const projectResponse = await ownerHttp
      .post(`/api/companies/${f.home}/projects`)
      .send({ name: "Expired Routine reader" })
      .expect(201);
    const source = await createRoutineAndRun();
    await createTypedTask(source, {
      projectId: projectResponse.body.id as string,
      status: "blocked",
    });
    await db
      .update(authSessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(authSessions.id, ownerActor().sessionId!));

    const list = await ownerHttp
      .get(`/api/companies/${f.home}/issues?attention=blocked`)
      .expect(403);
    const count = await ownerHttp
      .get(`/api/companies/${f.home}/issues/count?attention=blocked`)
      .expect(403);
    const projects = await ownerHttp
      .get(`/api/companies/${f.home}/projects`)
      .expect(403);
    for (const response of [list, count, projects]) {
      expect(JSON.stringify(response.body)).not.toContain("PRIVATE execution detail");
    }
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
