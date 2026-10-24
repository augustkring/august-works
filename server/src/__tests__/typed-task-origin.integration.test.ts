import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents, authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns, issues, routineRevisions, routineRuns, routines, workflowRevisions, workflowRuns, workflows,
} from "@paperclipai/db";
import { routineRevisionSnapshotV1Schema } from "@paperclipai/shared";
import { canActorReadIssuePrivacy } from "../services/authorization.js";
import { issueService } from "../services/issues.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("typed workflow and routine Task origins", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-typed-task-origin-");
    db = createDb(database.connectionString, { maxConnections: 3 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30000);

  async function seedCompany(name: string) {
    const companyId = randomUUID(), userId = randomUUID();
    await db.insert(companies).values({ id: companyId, name, issuePrefix: `TO${companyId.slice(0, 6)}` });
    await db.insert(authUsers).values({ id: userId, name: "Typed origin reader", email: `${userId}@example.test`,
      createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "admin" });
    return { companyId, userId, actor: { type: "board" as const, source: "session" as const, userId } };
  }

  async function seedWorkflow(companyId: string, userId: string, ids: { workflowId?: string; runId?: string } = {}) {
    const workflowId = ids.workflowId ?? randomUUID(), runId = ids.runId ?? randomUUID();
    const revisionId = randomUUID();
    return db.transaction(async tx => {
      const [workflow] = await tx.insert(workflows).values({ id: workflowId, companyId,
        name: "Manually authored workflow", createdByUserId: userId, publishedRevisionId: revisionId }).returning();
      const [revision] = await tx.insert(workflowRevisions).values({ id: revisionId, companyId,
        workflowId, revisionNumber: 1, state: "published", graph: { version: 1, nodes: [], edges: [] },
        createdByUserId: userId }).returning();
      const [run] = await tx.insert(workflowRuns).values({ id: runId, companyId, workflowId,
        workflowRevisionId: revision!.id, status: "succeeded", source: "manual", responsibleUserId: userId,
        finishedAt: new Date(), authoringSourceWorkflowIds: [], memoryRecordIds: [] }).returning();
      return { workflow: workflow!, revision: revision!, run: run! };
    });
  }

  async function createTask(companyId: string, userId: string, fields: {
    originKind: "workflow_task" | "routine_execution";
    originId: string;
    originRunId: string;
  }) {
    return issueService(db).create(companyId, { title: "Typed-origin Task", visibility: "open",
      createdByUserId: userId, responsibleUserId: userId, actorResponsibleUserId: userId,
      originKind: fields.originKind, originId: fields.originId, originRunId: fields.originRunId });
  }

  async function seedHistoricalTask(companyId: string, fields: {
    originKind: "workflow_task" | "routine_execution";
    originId: string;
    originRunId: string;
  }) {
    const [task] = await db.insert(issues).values({ companyId, title: "Historical malformed typed-origin Task",
      visibility: "open", originKind: fields.originKind, originId: fields.originId,
      originRunId: fields.originRunId }).returning();
    return task!;
  }

  it("creates and reads a Task from its exact same-company Workflow and WorkflowRun, without heartbeat ownership", async () => {
    const home = await seedCompany("Workflow origin home");
    const valid = await seedWorkflow(home.companyId, home.userId);
    const validTask = await createTask(home.companyId, home.userId, { originKind: "workflow_task", originId: valid.workflow.id,
      originRunId: valid.run.id });
    // The actual issueService.create path records the Task. The source owner
    // is the typed WorkflowRun, with no heartbeat row sharing its identifier.
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, valid.run.id)))).toHaveLength(0);
    expect(await canActorReadIssuePrivacy(db, home.actor, validTask)).toBe(true);
  });

  it("denies a workflow run attached to the wrong Workflow parent", async () => {
    const home = await seedCompany("Workflow wrong parent");
    const valid = await seedWorkflow(home.companyId, home.userId);
    const wrongParent = { originKind: "workflow_task" as const, originId: randomUUID(), originRunId: valid.run.id };
    await expect(createTask(home.companyId, home.userId, wrongParent)).rejects.toBeDefined();
    const wrongParentTask = await seedHistoricalTask(home.companyId, wrongParent);
    expect(await canActorReadIssuePrivacy(db, home.actor, wrongParentTask)).toBe(false);
  });

  it("denies a workflow origin owned by another company", async () => {
    const home = await seedCompany("Workflow origin home"), foreign = await seedCompany("Workflow origin foreign");
    const foreignOwner = await seedWorkflow(foreign.companyId, foreign.userId);
    const crossCompany = { originKind: "workflow_task" as const, originId: foreignOwner.workflow.id,
      originRunId: foreignOwner.run.id };
    await expect(createTask(home.companyId, home.userId, crossCompany)).rejects.toBeDefined();
    const crossCompanyTask = await seedHistoricalTask(home.companyId, crossCompany);
    expect(await canActorReadIssuePrivacy(db, home.actor, crossCompanyTask)).toBe(false);
  });

  it("does not substitute a same-ID heartbeat when the typed WorkflowRun is missing", async () => {
    const home = await seedCompany("Missing typed workflow owner");
    const absentTypedRunId = randomUUID(), fallbackWorkflow = await seedWorkflow(home.companyId, home.userId);
    // A heartbeat with the same UUID and a matching Task pointer is not a
    // substitute for the absent workflow_runs owner row.
    const [agent] = await db.insert(agents).values({ companyId: home.companyId,
      name: "Unrelated typed-origin test agent", adapterType: "paperclip_runner" }).returning();
    await db.insert(heartbeatRuns).values({ id: absentTypedRunId, companyId: home.companyId,
      agentId: agent!.id, scopeKind: "company", status: "running" });
    const absentTypedOwner = { originKind: "workflow_task" as const, originId: fallbackWorkflow.workflow.id,
      originRunId: absentTypedRunId };
    await expect(createTask(home.companyId, home.userId, absentTypedOwner)).rejects.toBeDefined();
    const fallbackTask = await seedHistoricalTask(home.companyId, absentTypedOwner);
    expect(await canActorReadIssuePrivacy(db, home.actor, fallbackTask)).toBe(false);
  });

  it("creates and reads a routine-origin Task using the run's retained revision", async () => {
    const home = await seedCompany("Routine origin home");
    const { routineId, revisionId, runId } = await seedRoutineRun(home.companyId, home.userId);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId))).toHaveLength(0);
    const task = await createTask(home.companyId, home.userId, { originKind: "routine_execution", originId: routineId,
      originRunId: runId });
    expect(await canActorReadIssuePrivacy(db, home.actor, task)).toBe(true);
    const [storedRun] = await db.select().from(routineRuns).where(eq(routineRuns.id, runId));
    expect(storedRun?.routineRevisionId).toBe(revisionId);
  });

  it("denies a routine run attached to the wrong Routine parent", async () => {
    const home = await seedCompany("Routine wrong parent");
    const { runId } = await seedRoutineRun(home.companyId, home.userId);
    const wrongRoutine = { originKind: "routine_execution" as const, originId: randomUUID(), originRunId: runId };
    await expect(createTask(home.companyId, home.userId, wrongRoutine)).rejects.toBeDefined();
    const wrongRoutineTask = await seedHistoricalTask(home.companyId, wrongRoutine);
    expect(await canActorReadIssuePrivacy(db, home.actor, wrongRoutineTask)).toBe(false);
  });

  it("denies routine-origin Tasks whose run has no retained revision", async () => {
    const home = await seedCompany("Routine missing revision");
    const { routineId } = await seedRoutineRun(home.companyId, home.userId);
    const missingRevisionRunId = randomUUID();
    await db.insert(routineRuns).values({ id: missingRevisionRunId, companyId: home.companyId,
      routineId, routineRevisionId: null, source: "manual", status: "succeeded", responsibleUserId: home.userId });
    const missingRevision = { originKind: "routine_execution" as const, originId: routineId,
      originRunId: missingRevisionRunId };
    await expect(createTask(home.companyId, home.userId, missingRevision)).rejects.toBeDefined();
    const missingRevisionTask = await seedHistoricalTask(home.companyId, missingRevision);
    expect(await canActorReadIssuePrivacy(db, home.actor, missingRevisionTask)).toBe(false);
  });

  async function seedRoutineRun(companyId: string, userId: string) {
    const routineId = randomUUID(), runId = randomUUID(), revisionId = randomUUID();
    const [routine] = await db.insert(routines).values({ id: routineId, companyId,
      title: "Manually authored routine", createdByUserId: userId, responsibleUserId: userId }).returning();
    const snapshot = routineRevisionSnapshotV1Schema.parse({ version: 1, routine: {
      id: routineId, companyId, projectId: null, folderId: null, goalId: null, parentIssueId: null,
      title: routine!.title, description: null, assigneeAgentId: null, priority: "medium", status: "active",
      concurrencyPolicy: "coalesce_if_active", catchUpPolicy: "skip_missed", activityGatePolicy: "always",
      activityGateScope: "company", variables: [], env: null, responsibleUserId: userId,
    }, triggers: [] });
    const [revision] = await db.insert(routineRevisions).values({ id: revisionId, companyId,
      routineId, revisionNumber: 1, title: routine!.title, snapshot, createdByUserId: userId,
      responsibleUserId: userId }).returning();
    const [run] = await db.insert(routineRuns).values({ id: runId, companyId,
      routineId, routineRevisionId: revision!.id, source: "manual", status: "succeeded",
      responsibleUserId: userId }).returning();
    // Advance the routine pointer after the run. The run must retain the
    // original revision it actually executed, independent of the new draft.
    const [newerRevision] = await db.insert(routineRevisions).values({ companyId, routineId,
      revisionNumber: 2, title: routine!.title, snapshot, createdByUserId: userId,
      responsibleUserId: userId }).returning();
    await db.update(routines).set({ latestRevisionId: newerRevision!.id, latestRevisionNumber: 2 })
      .where(eq(routines.id, routineId));
    return { routineId, runId, revisionId: revision!.id, run: run! };
  }
});
