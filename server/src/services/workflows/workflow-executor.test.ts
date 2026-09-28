import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  approvals,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  issues,
  principalPermissionGrants,
  workflowRevisions,
  workflowRuns,
  workflowStepRuns,
  workflows,
} from "@paperclipai/db";
import type { WorkflowGraphV1 } from "@paperclipai/shared";
import type { IssueAssignmentWakeupDeps } from "../issue-assignment-wakeup.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { approvalService } from "../approvals.js";
import { issueService } from "../issues.js";
import { workflowStepIdempotencyKey } from "./workflow-execution-policy.js";
import { workflowService } from "./workflow-service.js";
import {
  scheduleWorkflowStepRetry,
  WorkflowRetryableNodeError,
  workflowExecutorService,
} from "./workflow-executor.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

describePg("Workflow executor V1", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-workflow-executor-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(approvals);
    await db.delete(issues);
    await db.delete(workflowStepRuns);
    await db.delete(heartbeatRuns);
    await db.delete(workflowRuns);
    await db.delete(workflowRevisions);
    await db.delete(workflows);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedPublishedManualWorkflow() {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Executor Co",
      issuePrefix: `E${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    const actor = { principal: { type: "user" as const, userId } };
    const svc = workflowService(db);
    const created = await svc.create(companyId, { name: "Manual workflow" }, actor);
    const updated = await svc.updateDraft(
      companyId,
      created.id,
      {
        expectedRevisionId: created.draftRevisionId!,
        graph: {
          version: 1,
          nodes: [{
            id: "start",
            type: "core.manual_trigger",
            name: "Manual start",
            position: { x: 0, y: 0 },
            config: {},
          }],
          edges: [],
          variables: [],
          settings: {},
        },
      },
      actor,
    );
    const published = await svc.publish(
      companyId,
      created.id,
      {
        expectedDraftRevisionId: updated.draftRevisionId!,
        expectedPublishedRevisionId: null,
        approvalId: null,
      },
      actor,
    );
    return { companyId, userId, workflow: published };
  }

  async function seedPublishedAgentTaskWorkflow(input: {
    waitForCompletion: boolean;
    expectedOutputSchema?: Record<string, unknown> | null;
  }) {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Agent Task Co",
      issuePrefix: `A${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Research Agent",
      role: "research",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const actor = { principal: { type: "user" as const, userId } };
    const svc = workflowService(db);
    const created = await svc.create(
      companyId,
      { name: "Agent delegation workflow" },
      actor,
    );
    const graph: WorkflowGraphV1 = {
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "delegate",
          type: "agent.task",
          name: "Delegate research",
          position: { x: 180, y: 0 },
          config: {
            agentId,
            objective: "Research the account and produce the accountable task outcome.",
            waitForCompletion: input.waitForCompletion,
            expectedOutputSchema: input.expectedOutputSchema ?? null,
          },
        },
        ...(input.waitForCompletion
          ? [
              {
                id: "after",
                type: "core.condition",
                name: "Continue",
                position: { x: 360, y: 0 },
                config: { expression: "true" },
              },
            ]
          : []),
      ],
      edges: input.waitForCompletion
        ? [
            { id: "e1", source: "start", target: "delegate" },
            { id: "e2", source: "delegate", target: "after" },
          ]
        : [{ id: "e1", source: "start", target: "delegate" }],
      variables: [],
      settings: {},
    };
    const updated = await svc.updateDraft(
      companyId,
      created.id,
      {
        expectedRevisionId: created.draftRevisionId!,
        graph,
      },
      actor,
    );
    const published = await svc.publish(
      companyId,
      created.id,
      {
        expectedDraftRevisionId: updated.draftRevisionId!,
        expectedPublishedRevisionId: null,
        approvalId: null,
      },
      actor,
    );
    return {
      companyId,
      userId,
      agentId,
      workflow: published,
    };
  }

  function fakeHeartbeat(input: {
    companyId: string;
    agentId: string;
    runId?: string;
    fail?: boolean;
  }): IssueAssignmentWakeupDeps {
    const runId = input.runId ?? randomUUID();
    return {
      wakeup: vi.fn(async (agentId, options) => {
        if (input.fail) throw new Error("heartbeat transport unavailable");
        await db
          .insert(heartbeatRuns)
          .values({
            id: runId,
            companyId: input.companyId,
            agentId,
            invocationSource: options.source ?? "assignment",
            triggerDetail: options.triggerDetail ?? "system",
            status: "queued",
            responsibleUserId: null,
            contextSnapshot: options.contextSnapshot ?? {},
          })
          .onConflictDoNothing();
        const issueId =
          typeof options.contextSnapshot?.issueId === "string"
            ? options.contextSnapshot.issueId
            : null;
        return {
          status: "skipped",
          reason: "already_queued",
          message: null,
          issueId,
          executionRunId: runId,
          executionAgentId: input.agentId,
          executionAgentName: "Research Agent",
        };
      }),
    };
  }

  async function seedPublishedGraph(graph: WorkflowGraphV1) {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Branch Executor Co",
      issuePrefix: `B${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    const actor = { principal: { type: "user" as const, userId } };
    const svc = workflowService(db);
    const created = await svc.create(companyId, { name: "Branch workflow" }, actor);
    const updated = await svc.updateDraft(
      companyId,
      created.id,
      {
        expectedRevisionId: created.draftRevisionId!,
        graph,
      },
      actor,
    );
    const published = await svc.publish(
      companyId,
      created.id,
      {
        expectedDraftRevisionId: updated.draftRevisionId!,
        expectedPublishedRevisionId: null,
        approvalId: null,
      },
      actor,
    );
    return { companyId, userId, workflow: published };
  }

  it("persists a manual run and its trigger step before returning success", async () => {
    const seeded = await seedPublishedManualWorkflow();
    const result = await workflowExecutorService(db).startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: { leadId: "lead-1" } },
      { principal: { type: "user", userId: seeded.userId } },
      "manual-run-1",
    );

    expect(result.run).toMatchObject({
      companyId: seeded.companyId,
      workflowId: seeded.workflow.id,
      workflowRevisionId: seeded.workflow.publishedRevisionId,
      status: "succeeded",
      source: "manual",
      triggerPayload: { leadId: "lead-1" },
      idempotencyKey: "manual-run-1",
      executionOwnerId: null,
    });
    expect(result.steps).toEqual([
      expect.objectContaining({
        nodeId: "start",
        attempt: 1,
        status: "succeeded",
        inputJson: { leadId: "lead-1" },
        outputJson: { leadId: "lead-1" },
      }),
    ]);

    const actions = (await db.select().from(activityLog)).map((row) => row.action);
    expect(actions).toEqual([
      "workflow.run_queued",
      "workflow.run_started",
      "workflow.step_started",
      "workflow.step_completed",
      "workflow.run_completed",
    ]);
  });

  it("returns the same durable run for a repeated idempotency key", async () => {
    const seeded = await seedPublishedManualWorkflow();
    const executor = workflowExecutorService(db);
    const first = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: { value: 1 } },
      { principal: { type: "user", userId: seeded.userId } },
      "same-request",
    );
    const second = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: { value: 1 } },
      { principal: { type: "user", userId: seeded.userId } },
      "same-request",
    );
    expect(second.run.id).toBe(first.run.id);
    expect(await db.select().from(workflowRuns)).toHaveLength(1);
    expect(await db.select().from(workflowStepRuns)).toHaveLength(1);
  });

  it("rejects reusing an idempotency key for different input", async () => {
    const seeded = await seedPublishedManualWorkflow();
    const executor = workflowExecutorService(db);
    await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: { value: 1 } },
      { principal: { type: "user", userId: seeded.userId } },
      "collision",
    );
    await expect(
      executor.startManualRun(
        seeded.companyId,
        seeded.workflow.id,
        { input: { value: 2 } },
        { principal: { type: "user", userId: seeded.userId } },
        "collision",
      ),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: "idempotency_key_reused" }),
    });
  });

  it("binds each run permanently to the published revision selected at creation", async () => {
    const seeded = await seedPublishedManualWorkflow();
    const originalPublished = seeded.workflow.publishedRevisionId!;
    const result = await workflowExecutorService(db).startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      { principal: { type: "user", userId: seeded.userId } },
      null,
    );
    expect(result.run.workflowRevisionId).toBe(originalPublished);
  });

  it("fails closed when no published revision exists", async () => {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Draft Co",
      issuePrefix: "DRFT",
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    const draft = await workflowService(db).create(
      companyId,
      { name: "Draft only" },
      { principal: { type: "user", userId } },
    );
    await expect(
      workflowExecutorService(db).startManualRun(
        companyId,
        draft.id,
        { input: {} },
        { principal: { type: "user", userId } },
        null,
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({ code: "workflow_revision_not_published" }),
    });
  });

  it("enforces durable run and step status constraints in Postgres", async () => {
    const seeded = await seedPublishedManualWorkflow();
    await expect(
      db.insert(workflowRuns).values({
        companyId: seeded.companyId,
        workflowId: seeded.workflow.id,
        workflowRevisionId: seeded.workflow.publishedRevisionId!,
        status: "not_real",
        source: "manual",
        triggerPayload: {},
      }),
    ).rejects.toBeTruthy();
  });
  it("keeps idempotency bound to the original run after a later publish", async () => {
    const seeded = await seedPublishedManualWorkflow();
    const executor = workflowExecutorService(db);
    const first = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: { value: "original" } },
      { principal: { type: "user", userId: seeded.userId } },
      "stable-key",
    );

    const svc = workflowService(db);
    const current = await svc.getDetail(seeded.companyId, seeded.workflow.id);
    const changed = await svc.updateDraft(
      seeded.companyId,
      seeded.workflow.id,
      {
        expectedRevisionId: current!.draftRevisionId!,
        graph: {
          version: 1,
          nodes: [{
            id: "start",
            type: "core.manual_trigger",
            name: "Manual start v2",
            position: { x: 0, y: 0 },
            config: {},
          }],
          edges: [],
          variables: [],
          settings: {},
        },
      },
      { principal: { type: "user", userId: seeded.userId } },
    );
    const republished = await svc.publish(
      seeded.companyId,
      seeded.workflow.id,
      {
        expectedDraftRevisionId: changed.draftRevisionId!,
        expectedPublishedRevisionId: current!.publishedRevisionId,
        approvalId: null,
      },
      { principal: { type: "user", userId: seeded.userId } },
    );
    expect(republished.publishedRevisionId).not.toBe(first.run.workflowRevisionId);

    const replay = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: { value: "original" } },
      { principal: { type: "user", userId: seeded.userId } },
      "stable-key",
    );
    expect(replay.run.id).toBe(first.run.id);
    expect(replay.run.workflowRevisionId).toBe(first.run.workflowRevisionId);
    expect(await db.select().from(workflowRuns)).toHaveLength(1);
  });

  it("executes only the selected condition branch and records the other branch as skipped", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "branch",
          type: "core.condition",
          name: "Large deal?",
          position: { x: 180, y: 0 },
          config: { expression: "{{trigger.amount}} >= 50000" },
        },
        {
          id: "true-leaf",
          type: "core.condition",
          name: "True leaf",
          position: { x: 360, y: -80 },
          config: { expression: "true" },
        },
        {
          id: "false-leaf",
          type: "core.condition",
          name: "False leaf",
          position: { x: 360, y: 80 },
          config: { expression: "false" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "branch" },
        {
          id: "e2",
          source: "branch",
          target: "true-leaf",
          sourceHandle: "true",
          label: "true",
        },
        {
          id: "e3",
          source: "branch",
          target: "false-leaf",
          sourceHandle: "false",
          label: "false",
        },
      ],
      variables: [],
      settings: {},
    });

    const result = await workflowExecutorService(db).startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: { amount: 75_000 } },
      { principal: { type: "user", userId: seeded.userId } },
      "branch-true",
    );

    expect(result.run.status).toBe("succeeded");
    const byNode = new Map(result.steps.map((step) => [step.nodeId, step]));
    expect(byNode.get("start")).toMatchObject({ status: "succeeded" });
    expect(byNode.get("branch")).toMatchObject({
      status: "succeeded",
      outputJson: { result: true },
    });
    expect(byNode.get("true-leaf")).toMatchObject({
      status: "succeeded",
      outputJson: { result: true },
    });
    expect(byNode.get("false-leaf")).toMatchObject({ status: "skipped" });

    const actions = (await db.select().from(activityLog)).map((row) => row.action);
    expect(actions).toContain("workflow.step_skipped");
  });

  it("fails the durable run when a condition reference cannot be resolved", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "branch",
          type: "core.condition",
          name: "Missing value",
          position: { x: 180, y: 0 },
          config: { expression: "{{trigger.missing}}" },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "branch" }],
      variables: [],
      settings: {},
    });

    const result = await workflowExecutorService(db).startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      { principal: { type: "user", userId: seeded.userId } },
      "branch-failure",
    );

    expect(result.run).toMatchObject({
      status: "failed",
      failureCode: "workflow_condition_reference_missing",
      executionOwnerId: null,
      leaseExpiresAt: null,
    });
    expect(result.steps.find((step) => step.nodeId === "branch")).toMatchObject({
      status: "failed",
      errorCode: "workflow_condition_reference_missing",
    });
  });

  it("recovers an expired run from the last succeeded checkpoint without replaying it", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "condition",
          type: "core.condition",
          name: "Continue",
          position: { x: 180, y: 0 },
          config: { expression: "{{trigger.enabled}}" },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "condition" }],
      variables: [],
      settings: {},
    });
    const now = new Date("2026-09-28T15:00:00.000Z");
    const old = new Date(now.getTime() - 120_000);
    const [run] = await db.insert(workflowRuns).values({
      companyId: seeded.companyId,
      workflowId: seeded.workflow.id,
      workflowRevisionId: seeded.workflow.publishedRevisionId!,
      status: "running",
      source: "manual",
      triggerPayload: { enabled: true },
      correlationId: randomUUID(),
      executionOwnerId: "dead-worker",
      leaseExpiresAt: new Date(now.getTime() - 60_000),
      ownerHeartbeatAt: old,
      startedAt: old,
      createdAt: old,
      updatedAt: old,
    }).returning();

    await db.insert(workflowStepRuns).values([
      {
        companyId: seeded.companyId,
        workflowRunId: run!.id,
        nodeId: "start",
        attempt: 1,
        status: "succeeded",
        inputJson: { enabled: true },
        outputJson: { enabled: true },
        startedAt: old,
        finishedAt: new Date(old.getTime() + 10),
        durationMs: 10,
        createdAt: old,
        updatedAt: old,
      },
      {
        companyId: seeded.companyId,
        workflowRunId: run!.id,
        nodeId: "condition",
        attempt: 1,
        status: "pending",
        inputJson: { expression: "{{trigger.enabled}}" },
        createdAt: old,
        updatedAt: old,
      },
    ]);

    const recovery = await workflowExecutorService(db).recoverExpiredRuns(10, now);
    expect(recovery).toMatchObject({
      checked: 1,
      recovered: 1,
      raced: 0,
      failedRunIds: [],
    });

    const detail = await workflowExecutorService(db).getRun(seeded.companyId, run!.id);
    expect(detail?.run).toMatchObject({
      status: "succeeded",
      executionOwnerId: null,
      leaseExpiresAt: null,
    });
    expect(detail?.steps.filter((step) => step.nodeId === "start")).toHaveLength(1);
    expect(detail?.steps.find((step) => step.nodeId === "condition")).toMatchObject({
      attempt: 1,
      status: "succeeded",
      outputJson: { result: true },
    });

    const actions = (await db.select().from(activityLog)).map((row) => row.action);
    expect(actions).toContain("workflow.run_recovery_started");
    expect(actions).toContain("workflow.run_recovered");
    expect(
      actions.filter((action) => action === "workflow.step_completed"),
    ).toHaveLength(1);
  });

  it("preserves an interrupted attempt and resumes the node as attempt n+1", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "condition",
          type: "core.condition",
          name: "Continue",
          position: { x: 180, y: 0 },
          config: { expression: "true" },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "condition" }],
      variables: [],
      settings: {},
    });
    const now = new Date("2026-09-28T15:10:00.000Z");
    const old = new Date(now.getTime() - 120_000);
    const [run] = await db.insert(workflowRuns).values({
      companyId: seeded.companyId,
      workflowId: seeded.workflow.id,
      workflowRevisionId: seeded.workflow.publishedRevisionId!,
      status: "running",
      source: "manual",
      triggerPayload: {},
      correlationId: randomUUID(),
      executionOwnerId: "dead-worker",
      leaseExpiresAt: new Date(now.getTime() - 60_000),
      ownerHeartbeatAt: old,
      startedAt: old,
      createdAt: old,
      updatedAt: old,
    }).returning();

    await db.insert(workflowStepRuns).values([
      {
        companyId: seeded.companyId,
        workflowRunId: run!.id,
        nodeId: "start",
        attempt: 1,
        status: "succeeded",
        inputJson: {},
        outputJson: {},
        startedAt: old,
        finishedAt: new Date(old.getTime() + 10),
        durationMs: 10,
        createdAt: old,
        updatedAt: old,
      },
      {
        companyId: seeded.companyId,
        workflowRunId: run!.id,
        nodeId: "condition",
        attempt: 1,
        status: "running",
        inputJson: { expression: "true" },
        startedAt: new Date(old.getTime() + 20),
        createdAt: new Date(old.getTime() + 20),
        updatedAt: new Date(old.getTime() + 20),
      },
    ]);

    const recovery = await workflowExecutorService(db).recoverExpiredRuns(10, now);
    expect(recovery.recovered).toBe(1);

    const detail = await workflowExecutorService(db).getRun(seeded.companyId, run!.id);
    const conditionAttempts = detail!.steps
      .filter((step) => step.nodeId === "condition")
      .sort((left, right) => left.attempt - right.attempt);
    expect(conditionAttempts).toHaveLength(2);
    expect(conditionAttempts[0]).toMatchObject({
      attempt: 1,
      status: "failed",
      errorCode: "workflow_execution_interrupted",
    });
    expect(conditionAttempts[1]).toMatchObject({
      attempt: 2,
      status: "succeeded",
      outputJson: { result: true },
    });
    expect(detail?.run.status).toBe("succeeded");
  });

  it("claims an abandoned queued run after the recovery grace period", async () => {
    const seeded = await seedPublishedManualWorkflow();
    const now = new Date("2026-09-28T15:20:00.000Z");
    const old = new Date(now.getTime() - 120_000);
    const [run] = await db.insert(workflowRuns).values({
      companyId: seeded.companyId,
      workflowId: seeded.workflow.id,
      workflowRevisionId: seeded.workflow.publishedRevisionId!,
      status: "queued",
      source: "manual",
      triggerPayload: { source: "recovery" },
      correlationId: randomUUID(),
      createdAt: old,
      updatedAt: old,
    }).returning();
    await db.insert(workflowStepRuns).values({
      companyId: seeded.companyId,
      workflowRunId: run!.id,
      nodeId: "start",
      attempt: 1,
      status: "pending",
      inputJson: { source: "recovery" },
      createdAt: old,
      updatedAt: old,
    });

    const recovery = await workflowExecutorService(db).recoverExpiredRuns(10, now);
    expect(recovery.recovered).toBe(1);
    const detail = await workflowExecutorService(db).getRun(seeded.companyId, run!.id);
    expect(detail?.run.status).toBe("succeeded");
    expect(detail?.steps).toEqual([
      expect.objectContaining({
        nodeId: "start",
        attempt: 1,
        status: "succeeded",
        outputJson: { source: "recovery" },
      }),
    ]);
  });

  it("does not steal a run while its execution lease is still valid", async () => {
    const seeded = await seedPublishedManualWorkflow();
    const now = new Date("2026-09-28T15:30:00.000Z");
    const old = new Date(now.getTime() - 10_000);
    const [run] = await db.insert(workflowRuns).values({
      companyId: seeded.companyId,
      workflowId: seeded.workflow.id,
      workflowRevisionId: seeded.workflow.publishedRevisionId!,
      status: "running",
      source: "manual",
      triggerPayload: {},
      correlationId: randomUUID(),
      executionOwnerId: "healthy-worker",
      leaseExpiresAt: new Date(now.getTime() + 20_000),
      ownerHeartbeatAt: old,
      startedAt: old,
      createdAt: old,
      updatedAt: old,
    }).returning();
    await db.insert(workflowStepRuns).values({
      companyId: seeded.companyId,
      workflowRunId: run!.id,
      nodeId: "start",
      attempt: 1,
      status: "pending",
      inputJson: {},
      createdAt: old,
      updatedAt: old,
    });

    const recovery = await workflowExecutorService(db).recoverExpiredRuns(10, now);
    expect(recovery).toMatchObject({
      checked: 0,
      recovered: 0,
      raced: 0,
      failedRunIds: [],
    });
    const stored = await workflowExecutorService(db).getRun(seeded.companyId, run!.id);
    expect(stored?.run).toMatchObject({
      status: "running",
      executionOwnerId: "healthy-worker",
    });
  });

  it("persists retry backoff durably and resumes as a new attempt after the delay", async () => {
    const graph: WorkflowGraphV1 = {
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "condition",
          type: "core.condition",
          name: "Retryable step",
          position: { x: 180, y: 0 },
          config: { expression: "true" },
          retryPolicy: {
            mode: "fixed",
            maxAttempts: 3,
            initialDelayMs: 1_000,
            maxDelayMs: 1_000,
          },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "condition" }],
      variables: [],
      settings: {},
    };
    const seeded = await seedPublishedGraph(graph);
    const actor = { principal: { type: "user" as const, userId: seeded.userId } };
    const startedAt = new Date("2026-09-28T15:40:00.000Z");
    const [run] = await db.insert(workflowRuns).values({
      companyId: seeded.companyId,
      workflowId: seeded.workflow.id,
      workflowRevisionId: seeded.workflow.publishedRevisionId!,
      status: "running",
      source: "manual",
      triggerPayload: {},
      correlationId: randomUUID(),
      executionOwnerId: "inline:test-retry",
      leaseExpiresAt: new Date(startedAt.getTime() + 30_000),
      ownerHeartbeatAt: startedAt,
      startedAt,
      createdAt: startedAt,
      updatedAt: startedAt,
    }).returning();

    await db.insert(workflowStepRuns).values({
      companyId: seeded.companyId,
      workflowRunId: run!.id,
      nodeId: "start",
      attempt: 1,
      status: "succeeded",
      inputJson: {},
      outputJson: {},
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 5),
      durationMs: 5,
      createdAt: startedAt,
      updatedAt: startedAt,
    });
    const [runningStep] = await db.insert(workflowStepRuns).values({
      companyId: seeded.companyId,
      workflowRunId: run!.id,
      nodeId: "condition",
      attempt: 1,
      status: "running",
      inputJson: { expression: "true" },
      startedAt: new Date(startedAt.getTime() + 10),
      createdAt: new Date(startedAt.getTime() + 10),
      updatedAt: new Date(startedAt.getTime() + 10),
    }).returning();

    const scheduled = await scheduleWorkflowStepRetry(
      db,
      run!,
      graph,
      graph.nodes[1]!,
      runningStep!,
      actor,
      new WorkflowRetryableNodeError({
        code: "upstream_temporarily_unavailable",
        message: "Temporary upstream failure",
        sideEffectSafeToRepeat: true,
        providerAllowsRetry: true,
      }),
    );
    expect(scheduled).toBe(true);

    const waiting = await workflowExecutorService(db).getRun(seeded.companyId, run!.id);
    expect(waiting?.run).toMatchObject({
      status: "waiting",
      executionOwnerId: null,
      leaseExpiresAt: null,
    });
    expect(waiting?.steps.find((step) => step.nodeId === "condition")).toMatchObject({
      attempt: 1,
      status: "retry_scheduled",
      errorCode: "upstream_temporarily_unavailable",
    });

    const scheduledAttempt = waiting!.steps.find(
      (step) => step.nodeId === "condition" && step.attempt === 1,
    )!;
    const scheduledAt = scheduledAttempt.finishedAt!;
    const beforeDue = new Date(new Date(scheduledAt).getTime() + 500);
    const before = await workflowExecutorService(db).recoverExpiredRuns(10, beforeDue);
    expect(before).toMatchObject({
      recovered: 0,
      deferred: 1,
      failedRunIds: [],
    });

    const afterDue = new Date(new Date(scheduledAt).getTime() + 1_100);
    const after = await workflowExecutorService(db).recoverExpiredRuns(10, afterDue);
    expect(after).toMatchObject({
      recovered: 1,
      deferred: 0,
      failedRunIds: [],
    });

    const completed = await workflowExecutorService(db).getRun(seeded.companyId, run!.id);
    expect(completed?.run.status).toBe("succeeded");
    const conditionAttempts = completed!.steps
      .filter((step) => step.nodeId === "condition")
      .sort((left, right) => left.attempt - right.attempt);
    expect(conditionAttempts).toHaveLength(2);
    expect(conditionAttempts[0]).toMatchObject({
      attempt: 1,
      status: "retried",
      errorCode: "upstream_temporarily_unavailable",
    });
    expect(conditionAttempts[1]).toMatchObject({
      attempt: 2,
      status: "succeeded",
      outputJson: { result: true },
    });

    const actions = (await db.select().from(activityLog)).map((row) => row.action);
    expect(actions).toContain("workflow.step_retry_scheduled");
    expect(actions).toContain("workflow.run_waiting");
    expect(actions).toContain("workflow.step_retried");
    expect(actions).toContain("workflow.run_resumed");
  });

  it("checkpoints a delay wait, releases execution, and resumes only after wakeAt", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "delay",
          type: "core.wait",
          name: "Wait briefly",
          position: { x: 180, y: 0 },
          config: { durationSeconds: 1 },
        },
        {
          id: "after",
          type: "core.condition",
          name: "Continue",
          position: { x: 360, y: 0 },
          config: { expression: "true" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "delay" },
        { id: "e2", source: "delay", target: "after" },
      ],
      variables: [],
      settings: {},
    });

    const executor = workflowExecutorService(db);
    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: { source: "delay-test" } },
      { principal: { type: "user", userId: seeded.userId } },
      "delay-run",
    );

    expect(waiting.run).toMatchObject({
      status: "waiting",
      executionOwnerId: null,
      leaseExpiresAt: null,
    });
    expect(waiting.steps.find((step) => step.nodeId === "start")).toMatchObject({
      status: "succeeded",
    });
    expect(waiting.steps.find((step) => step.nodeId === "delay")).toMatchObject({
      attempt: 1,
      status: "waiting",
    });
    expect(waiting.steps.find((step) => step.nodeId === "after")).toBeUndefined();
    expect(waiting.waits).toHaveLength(1);
    expect(waiting.waits[0]).toMatchObject({
      nodeId: "delay",
      waitKey: "primary",
      kind: "delay",
      status: "active",
    });

    const wakeAt = waiting.waits[0]!.wakeAt!;
    const before = await executor.recoverExpiredRuns(
      10,
      new Date(new Date(wakeAt).getTime() - 100),
    );
    expect(before).toMatchObject({
      recovered: 0,
      deferred: 1,
      failedRunIds: [],
    });

    const after = await executor.recoverExpiredRuns(
      10,
      new Date(new Date(wakeAt).getTime() + 100),
    );
    expect(after).toMatchObject({
      recovered: 1,
      deferred: 0,
      failedRunIds: [],
    });

    const completed = await executor.getRun(seeded.companyId, waiting.run.id);
    expect(completed?.run.status).toBe("succeeded");
    expect(completed?.waits).toEqual([
      expect.objectContaining({
        nodeId: "delay",
        kind: "delay",
        status: "resolved",
        resolutionJson: expect.objectContaining({ reason: "delay_elapsed" }),
      }),
    ]);
    expect(completed?.steps.find((step) => step.nodeId === "delay")).toMatchObject({
      status: "succeeded",
      outputJson: expect.objectContaining({ reason: "delay_elapsed" }),
    });
    expect(completed?.steps.find((step) => step.nodeId === "after")).toMatchObject({
      status: "succeeded",
      outputJson: { result: true },
    });

    const actions = (await db.select().from(activityLog)).map((row) => row.action);
    expect(actions).toContain("workflow.wait_created");
    expect(actions).toContain("workflow.step_waiting");
    expect(actions).toContain("workflow.wait_resolved");
    expect(actions).toContain("workflow.run_resumed");
  });

  it("parks on the existing approval system and resumes after human approval", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "approval",
          type: "human.approval",
          name: "Approve customer send",
          position: { x: 180, y: 0 },
          config: {
            summary: "Approve the customer-facing send",
            consequence: "The workflow may continue to the customer communication step.",
          },
        },
        {
          id: "after",
          type: "core.condition",
          name: "Continue",
          position: { x: 360, y: 0 },
          config: { expression: "true" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "approval" },
        { id: "e2", source: "approval", target: "after" },
      ],
      variables: [],
      settings: {},
    });

    const executor = workflowExecutorService(db);
    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      { principal: { type: "user", userId: seeded.userId } },
      "approval-run",
    );

    expect(waiting.run.status).toBe("waiting");
    expect(waiting.waits).toHaveLength(1);
    const wait = waiting.waits[0]!;
    expect(wait).toMatchObject({
      nodeId: "approval",
      kind: "human_interaction",
      status: "active",
      referenceType: "approval",
    });
    expect(wait.referenceId).toEqual(expect.any(String));

    const storedApproval = await approvalService(db).getById(wait.referenceId!);
    expect(storedApproval).toMatchObject({
      companyId: seeded.companyId,
      type: "workflow_step_approval",
      status: "pending",
      requestedByAgentId: null,
      requestedByUserId: seeded.userId,
    });
    expect(storedApproval?.payload).toMatchObject({
      summary: "Approve the customer-facing send",
      consequence: "The workflow may continue to the customer communication step.",
      workflowRunId: waiting.run.id,
      workflowNodeId: "approval",
      riskLevel: "C3",
    });

    await approvalService(db).approve(
      wait.referenceId!,
      seeded.userId,
      "Approved in test",
    );
    const recovery = await executor.recoverExpiredRuns(10, new Date());
    expect(recovery).toMatchObject({
      recovered: 1,
      failedRunIds: [],
    });

    const completed = await executor.getRun(seeded.companyId, waiting.run.id);
    expect(completed?.run.status).toBe("succeeded");
    expect(completed?.waits[0]).toMatchObject({
      status: "resolved",
      resolutionJson: expect.objectContaining({
        decision: "approved",
        approvalId: wait.referenceId,
      }),
    });
    expect(completed?.steps.find((step) => step.nodeId === "approval")).toMatchObject({
      status: "succeeded",
      outputJson: expect.objectContaining({ decision: "approved" }),
    });
    expect(completed?.steps.find((step) => step.nodeId === "after")).toMatchObject({
      status: "succeeded",
    });
  });

  it("fails the workflow explicitly when its existing approval is rejected", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "approval",
          type: "human.approval",
          name: "Approve",
          position: { x: 180, y: 0 },
          config: {
            summary: "Approve the consequential step",
            consequence: "The workflow would continue.",
          },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "approval" }],
      variables: [],
      settings: {},
    });

    const executor = workflowExecutorService(db);
    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      { principal: { type: "user", userId: seeded.userId } },
      "approval-reject-run",
    );
    const wait = waiting.waits[0]!;
    await approvalService(db).reject(
      wait.referenceId!,
      seeded.userId,
      "Not approved",
    );

    const recovery = await executor.recoverExpiredRuns(10, new Date());
    expect(recovery.recovered).toBe(1);

    const failed = await executor.getRun(seeded.companyId, waiting.run.id);
    expect(failed?.run).toMatchObject({
      status: "failed",
      failureCode: "workflow_human_approval_rejected",
    });
    expect(failed?.waits[0]).toMatchObject({
      status: "resolved",
      resolutionJson: expect.objectContaining({ decision: "rejected" }),
    });
    expect(failed?.steps.find((step) => step.nodeId === "approval")).toMatchObject({
      status: "failed",
      errorCode: "workflow_human_approval_rejected",
    });
  });

  it("creates one existing task idempotently from a Create Task node", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "task",
          type: "work.create_task",
          name: "Create accountable task",
          position: { x: 180, y: 0 },
          config: {
            title: "Review onboarding package",
            description: "Confirm the package is complete.",
            projectId: null,
            assigneeAgentId: null,
            assigneeUserId: null,
            waitForCompletion: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "task" }],
      variables: [],
      settings: {},
    });
    const executor = workflowExecutorService(db);
    const actor = {
      principal: { type: "user" as const, userId: seeded.userId },
      responsibleUserId: seeded.userId,
    };

    const first = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      actor,
      "task-create-idempotency",
    );
    const replay = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      actor,
      "task-create-idempotency",
    );

    expect(first.run.status).toBe("succeeded");
    expect(replay.run.id).toBe(first.run.id);
    const createdTasks = await db
      .select()
      .from(issues)
      .where(eq(issues.originRunId, first.run.id));
    expect(createdTasks).toHaveLength(1);
    expect(createdTasks[0]).toMatchObject({
      companyId: seeded.companyId,
      title: "Review onboarding package",
      status: "backlog",
      originKind: "workflow_task",
      originId: seeded.workflow.id,
      originRunId: first.run.id,
    });
    expect(
      first.steps.find((step) => step.nodeId === "task"),
    ).toMatchObject({
      status: "succeeded",
      outputJson: expect.objectContaining({
        issueId: createdTasks[0]!.id,
        status: "backlog",
      }),
    });
  });

  it("waits durably for task completion and resumes from the task checkpoint", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "task",
          type: "work.create_task",
          name: "Create and wait",
          position: { x: 180, y: 0 },
          config: {
            title: "Human follow-up",
            description: null,
            projectId: null,
            assigneeAgentId: null,
            assigneeUserId: null,
            waitForCompletion: true,
          },
        },
        {
          id: "after",
          type: "core.condition",
          name: "Continue",
          position: { x: 360, y: 0 },
          config: { expression: "true" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "task" },
        { id: "e2", source: "task", target: "after" },
      ],
      variables: [],
      settings: {},
    });
    const executor = workflowExecutorService(db);
    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      {
        principal: { type: "user", userId: seeded.userId },
        responsibleUserId: seeded.userId,
      },
      "task-wait",
    );

    expect(waiting.run).toMatchObject({
      status: "waiting",
      executionOwnerId: null,
      leaseExpiresAt: null,
    });
    expect(waiting.waits).toEqual([
      expect.objectContaining({
        nodeId: "task",
        kind: "task_completion",
        status: "active",
        referenceType: "issue",
      }),
    ]);
    const issueId = waiting.waits[0]!.referenceId!;
    expect(
      waiting.steps.find((step) => step.nodeId === "task"),
    ).toMatchObject({
      status: "waiting",
      outputJson: expect.objectContaining({ issueId }),
    });
    expect(
      waiting.steps.find((step) => step.nodeId === "after"),
    ).toBeUndefined();

    const completedAt = new Date();
    await db
      .update(issues)
      .set({ status: "done", completedAt, updatedAt: completedAt })
      .where(eq(issues.id, issueId));

    const recovery = await executor.recoverExpiredRuns(
      10,
      new Date(completedAt.getTime() + 1),
    );
    expect(recovery).toMatchObject({
      recovered: 1,
      failedRunIds: [],
    });

    const completed = await executor.getRun(
      seeded.companyId,
      waiting.run.id,
    );
    expect(completed?.run.status).toBe("succeeded");
    expect(completed?.waits[0]).toMatchObject({
      status: "resolved",
      resolutionJson: expect.objectContaining({
        issueId,
        status: "done",
      }),
    });
    expect(
      completed?.steps.find((step) => step.nodeId === "task"),
    ).toMatchObject({
      status: "succeeded",
      outputJson: expect.objectContaining({
        issueId,
        status: "done",
      }),
    });
    expect(
      completed?.steps.find((step) => step.nodeId === "after"),
    ).toMatchObject({ status: "succeeded" });
  });

  it("fails a waiting workflow when its created task is cancelled", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "task",
          type: "work.create_task",
          name: "Create and wait",
          position: { x: 180, y: 0 },
          config: {
            title: "Cancelable task",
            projectId: null,
            assigneeAgentId: null,
            assigneeUserId: null,
            waitForCompletion: true,
          },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "task" }],
      variables: [],
      settings: {},
    });
    const executor = workflowExecutorService(db);
    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      {
        principal: { type: "user", userId: seeded.userId },
        responsibleUserId: seeded.userId,
      },
      "task-cancel",
    );
    const issueId = waiting.waits[0]!.referenceId!;
    const cancelledAt = new Date();
    await db
      .update(issues)
      .set({
        status: "cancelled",
        cancelledAt,
        updatedAt: cancelledAt,
      })
      .where(eq(issues.id, issueId));

    const recovery = await executor.recoverExpiredRuns(
      10,
      new Date(cancelledAt.getTime() + 1),
    );
    expect(recovery.recovered).toBe(1);

    const failed = await executor.getRun(
      seeded.companyId,
      waiting.run.id,
    );
    expect(failed?.run).toMatchObject({
      status: "failed",
      failureCode: "workflow_task_cancelled",
    });
    expect(failed?.waits[0]).toMatchObject({
      status: "cancelled",
    });
    expect(
      failed?.steps.find((step) => step.nodeId === "task"),
    ).toMatchObject({
      status: "failed",
      errorCode: "workflow_task_cancelled",
    });
  });

  it("does not duplicate a Create Task side effect after executor crash recovery", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "task",
          type: "work.create_task",
          name: "Create once",
          position: { x: 180, y: 0 },
          config: {
            title: "Crash-safe task",
            description: null,
            projectId: null,
            assigneeAgentId: null,
            assigneeUserId: null,
            waitForCompletion: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "task" }],
      variables: [],
      settings: {},
    });
    const now = new Date("2026-09-28T20:30:00.000Z");
    const old = new Date(now.getTime() - 120_000);
    const [run] = await db.insert(workflowRuns).values({
      companyId: seeded.companyId,
      workflowId: seeded.workflow.id,
      workflowRevisionId: seeded.workflow.publishedRevisionId!,
      status: "running",
      source: "manual",
      triggerPayload: {},
      responsibleUserId: seeded.userId,
      correlationId: randomUUID(),
      executionOwnerId: "dead-worker",
      leaseExpiresAt: new Date(now.getTime() - 60_000),
      ownerHeartbeatAt: old,
      startedAt: old,
      createdAt: old,
      updatedAt: old,
    }).returning();

    await db.insert(workflowStepRuns).values([
      {
        companyId: seeded.companyId,
        workflowRunId: run!.id,
        nodeId: "start",
        attempt: 1,
        status: "succeeded",
        inputJson: {},
        outputJson: {},
        startedAt: old,
        finishedAt: new Date(old.getTime() + 10),
        durationMs: 10,
        createdAt: old,
        updatedAt: old,
      },
      {
        companyId: seeded.companyId,
        workflowRunId: run!.id,
        nodeId: "task",
        attempt: 1,
        status: "running",
        inputJson: {
          title: "Crash-safe task",
          description: null,
          projectId: null,
          assigneeAgentId: null,
          assigneeUserId: null,
          waitForCompletion: false,
        },
        startedAt: new Date(old.getTime() + 20),
        createdAt: new Date(old.getTime() + 20),
        updatedAt: new Date(old.getTime() + 20),
      },
    ]);

    const idempotencyKey = workflowStepIdempotencyKey(run!.id, "task");
    const existingTask = await issueService(db).create(seeded.companyId, {
      title: "Crash-safe task",
      description: null,
      status: "backlog",
      originKind: "workflow_task",
      originId: seeded.workflow.id,
      originRunId: run!.id,
      originFingerprint: idempotencyKey,
      responsibleUserId: seeded.userId,
      createdByUserId: seeded.userId,
      idempotencyKey,
      allowDuplicate: true,
      actorResponsibleUserId: seeded.userId,
      trustExplicitResponsibleUserId: true,
    });

    const recovery = await workflowExecutorService(db).recoverExpiredRuns(
      10,
      now,
    );
    expect(recovery).toMatchObject({
      recovered: 1,
      failedRunIds: [],
    });

    const completed = await workflowExecutorService(db).getRun(
      seeded.companyId,
      run!.id,
    );
    expect(completed?.run.status).toBe("succeeded");
    const taskAttempts = completed!.steps
      .filter((step) => step.nodeId === "task")
      .sort((left, right) => left.attempt - right.attempt);
    expect(taskAttempts).toHaveLength(2);
    expect(taskAttempts[0]).toMatchObject({
      attempt: 1,
      status: "failed",
      errorCode: "workflow_execution_interrupted",
    });
    expect(taskAttempts[1]).toMatchObject({
      attempt: 2,
      status: "succeeded",
      outputJson: expect.objectContaining({
        issueId: existingTask.id,
      }),
    });

    const tasks = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, seeded.companyId),
          eq(issues.originRunId, run!.id),
        ),
      );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe(existingTask.id);
  });

  it("resumes a task-completion wait from the committed task terminal event", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "task",
          type: "work.create_task",
          name: "Create and wait",
          position: { x: 180, y: 0 },
          config: {
            title: "Event-driven completion",
            description: null,
            projectId: null,
            assigneeAgentId: null,
            assigneeUserId: null,
            waitForCompletion: true,
          },
        },
        {
          id: "after",
          type: "core.condition",
          name: "Continue",
          position: { x: 360, y: 0 },
          config: { expression: "true" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "task" },
        { id: "e2", source: "task", target: "after" },
      ],
      variables: [],
      settings: {},
    });
    const executor = workflowExecutorService(db);
    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      {
        principal: { type: "user", userId: seeded.userId },
        responsibleUserId: seeded.userId,
      },
      "task-event-wait",
    );
    expect(waiting.run.status).toBe("waiting");
    const issueId = waiting.waits[0]!.referenceId!;

    await issueService(db).update(issueId, { status: "done" });

    const completed = await executor.getRun(
      seeded.companyId,
      waiting.run.id,
    );
    expect(completed?.run.status).toBe("succeeded");
    expect(completed?.waits[0]).toMatchObject({
      kind: "task_completion",
      status: "resolved",
      resolutionJson: expect.objectContaining({
        issueId,
        status: "done",
      }),
    });
    expect(
      completed?.steps.find((step) => step.nodeId === "after"),
    ).toMatchObject({
      status: "succeeded",
      outputJson: { result: true },
    });
  });

  it("fails Create Task at execution time when task assignment is not authorized", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "task",
          type: "work.create_task",
          name: "Restricted task",
          position: { x: 180, y: 0 },
          config: {
            title: "Restricted task",
            projectId: null,
            assigneeAgentId: null,
            assigneeUserId: null,
            waitForCompletion: false,
          },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "task" }],
      variables: [],
      settings: {},
    });
    await db
      .update(companyMemberships)
      .set({ membershipRole: "viewer" })
      .where(
        and(
          eq(companyMemberships.companyId, seeded.companyId),
          eq(companyMemberships.principalId, seeded.userId),
        ),
      );

    const result = await workflowExecutorService(db).startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      {
        principal: { type: "user", userId: seeded.userId },
        responsibleUserId: seeded.userId,
      },
      "task-auth-denied",
    );

    expect(result.run).toMatchObject({
      status: "failed",
      failureCode: "workflow_task_permission_denied",
    });
    expect(
      result.steps.find((step) => step.nodeId === "task"),
    ).toMatchObject({
      status: "failed",
      errorCode: "workflow_task_permission_denied",
    });
    expect(
      await db.select().from(issues).where(eq(issues.companyId, seeded.companyId)),
    ).toHaveLength(0);
  });

  it("fails Agent Task publish when structured output has no authoritative task result channel", async () => {
    await expect(
      seedPublishedAgentTaskWorkflow({
        waitForCompletion: true,
        expectedOutputSchema: {
          type: "object",
          properties: {
            score: { type: "number" },
          },
          required: ["score"],
        },
      }),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "workflow_node_invalid",
        reason: "workflow_agent_task_structured_output_not_ready",
        nodeType: "agent.task",
      }),
    });
  });

  it("delegates Agent Task through the existing task and heartbeat runtime", async () => {
    const seeded = await seedPublishedAgentTaskWorkflow({
      waitForCompletion: false,
    });
    const heartbeatRunId = randomUUID();
    const heartbeat = fakeHeartbeat({
      companyId: seeded.companyId,
      agentId: seeded.agentId,
      runId: heartbeatRunId,
    });

    const result = await workflowExecutorService(db, { heartbeat }).startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      {
        principal: { type: "user", userId: seeded.userId },
        responsibleUserId: seeded.userId,
      },
      "agent-task-nowait",
    );

    expect(result.run.status).toBe("succeeded");
    const delegate = result.steps.find((step) => step.nodeId === "delegate");
    expect(delegate).toMatchObject({
      status: "succeeded",
      agentId: seeded.agentId,
      heartbeatRunId,
      outputJson: expect.objectContaining({
        agentId: seeded.agentId,
        heartbeatRunId,
        status: "todo",
      }),
    });

    const delegatedTasks = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, seeded.companyId),
          eq(issues.originRunId, result.run.id),
        ),
      );
    expect(delegatedTasks).toHaveLength(1);
    expect(delegatedTasks[0]).toMatchObject({
      assigneeAgentId: seeded.agentId,
      status: "todo",
      originKind: "workflow_task",
    });
    expect(heartbeat.wakeup).toHaveBeenCalledTimes(1);
    expect(heartbeat.wakeup).toHaveBeenCalledWith(
      seeded.agentId,
      expect.objectContaining({
        source: "assignment",
        reason: "workflow_agent_task",
        allowRunCoalescing: false,
        idempotencyKey: expect.stringContaining("workflow-agent-task:"),
        contextSnapshot: expect.objectContaining({
          issueId: delegatedTasks[0]!.id,
          source: "workflow.agent_task",
        }),
      }),
    );

    const storedHeartbeat = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, heartbeatRunId))
      .then((rows) => rows[0] ?? null);
    expect(storedHeartbeat).toMatchObject({
      companyId: seeded.companyId,
      agentId: seeded.agentId,
      status: "queued",
    });
  });

  it("waits on Agent Task completion and resumes from the task terminal event", async () => {
    const seeded = await seedPublishedAgentTaskWorkflow({
      waitForCompletion: true,
    });
    const heartbeatRunId = randomUUID();
    const heartbeat = fakeHeartbeat({
      companyId: seeded.companyId,
      agentId: seeded.agentId,
      runId: heartbeatRunId,
    });
    const executor = workflowExecutorService(db, { heartbeat });

    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      {
        principal: { type: "user", userId: seeded.userId },
        responsibleUserId: seeded.userId,
      },
      "agent-task-wait",
    );

    expect(waiting.run.status).toBe("waiting");
    expect(waiting.waits).toHaveLength(1);
    expect(waiting.waits[0]).toMatchObject({
      nodeId: "delegate",
      kind: "task_completion",
      status: "active",
      referenceType: "issue",
    });
    expect(
      waiting.steps.find((step) => step.nodeId === "delegate"),
    ).toMatchObject({
      status: "waiting",
      agentId: seeded.agentId,
      heartbeatRunId,
    });

    const issueId = waiting.waits[0]!.referenceId!;
    await issueService(db).update(issueId, { status: "done" });

    const completed = await executor.getRun(
      seeded.companyId,
      waiting.run.id,
    );
    expect(completed?.run.status).toBe("succeeded");
    expect(completed?.waits[0]).toMatchObject({
      status: "resolved",
      resolutionJson: expect.objectContaining({
        issueId,
        status: "done",
      }),
    });
    expect(
      completed?.steps.find((step) => step.nodeId === "delegate"),
    ).toMatchObject({
      status: "succeeded",
      agentId: seeded.agentId,
      heartbeatRunId,
      outputJson: expect.objectContaining({
        issueId,
        status: "done",
        agentId: seeded.agentId,
        heartbeatRunId,
      }),
    });
    expect(
      completed?.steps.find((step) => step.nodeId === "after"),
    ).toMatchObject({
      status: "succeeded",
      outputJson: { result: true },
    });
  });

  it("retries Agent Task wakeup without duplicating the accountable task", async () => {
    const seeded = await seedPublishedAgentTaskWorkflow({
      waitForCompletion: false,
    });
    const heartbeatRunId = randomUUID();
    let wakeAttempt = 0;
    const heartbeat: IssueAssignmentWakeupDeps = {
      wakeup: vi.fn(async (agentId, options) => {
        wakeAttempt += 1;
        if (wakeAttempt === 1) {
          throw new Error("temporary heartbeat transport failure");
        }
        await db.insert(heartbeatRuns).values({
          id: heartbeatRunId,
          companyId: seeded.companyId,
          agentId,
          invocationSource: options.source ?? "assignment",
          triggerDetail: options.triggerDetail ?? "system",
          status: "queued",
          contextSnapshot: options.contextSnapshot ?? {},
        });
        return {
          status: "skipped",
          reason: "already_queued",
          message: null,
          issueId:
            typeof options.contextSnapshot?.issueId === "string"
              ? options.contextSnapshot.issueId
              : null,
          executionRunId: heartbeatRunId,
          executionAgentId: agentId,
          executionAgentName: "Research Agent",
        };
      }),
    };
    const executor = workflowExecutorService(db, { heartbeat });

    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      {
        principal: { type: "user", userId: seeded.userId },
        responsibleUserId: seeded.userId,
      },
      "agent-task-retry",
    );

    expect(waiting.run.status).toBe("waiting");
    const firstAttempt = waiting.steps.find(
      (step) => step.nodeId === "delegate" && step.attempt === 1,
    );
    expect(firstAttempt).toMatchObject({
      status: "retry_scheduled",
      errorCode: "workflow_agent_wakeup_failed",
    });
    const tasksAfterFirstAttempt = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, seeded.companyId),
          eq(issues.originRunId, waiting.run.id),
        ),
      );
    expect(tasksAfterFirstAttempt).toHaveLength(1);

    const scheduledAt = firstAttempt!.finishedAt!;
    const recovery = await executor.recoverExpiredRuns(
      10,
      new Date(new Date(scheduledAt).getTime() + 1_100),
    );
    expect(recovery).toMatchObject({
      recovered: 1,
      failedRunIds: [],
    });

    const completed = await executor.getRun(
      seeded.companyId,
      waiting.run.id,
    );
    expect(completed?.run.status).toBe("succeeded");
    const delegateAttempts = completed!.steps
      .filter((step) => step.nodeId === "delegate")
      .sort((left, right) => left.attempt - right.attempt);
    expect(delegateAttempts).toHaveLength(2);
    expect(delegateAttempts[0]).toMatchObject({
      attempt: 1,
      status: "retried",
      errorCode: "workflow_agent_wakeup_failed",
    });
    expect(delegateAttempts[1]).toMatchObject({
      attempt: 2,
      status: "succeeded",
      agentId: seeded.agentId,
      heartbeatRunId,
    });
    const tasksAfterRetry = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, seeded.companyId),
          eq(issues.originRunId, waiting.run.id),
        ),
      );
    expect(tasksAfterRetry).toHaveLength(1);
    expect(tasksAfterRetry[0]!.id).toBe(tasksAfterFirstAttempt[0]!.id);
    expect(heartbeat.wakeup).toHaveBeenCalledTimes(2);
  });

});
