import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  companyMemberships,
  createDb,
  principalPermissionGrants,
  workflowRevisions,
  workflowRuns,
  workflowStepRuns,
  workflows,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { workflowService } from "./workflow-service.js";
import { workflowExecutorService } from "./workflow-executor.js";

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
    await db.delete(workflowStepRuns);
    await db.delete(workflowRuns);
    await db.delete(workflowRevisions);
    await db.delete(workflows);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
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

  async function seedPublishedGraph(
    graph: Parameters<ReturnType<typeof workflowService>["updateDraft"]>[2]["graph"],
  ) {
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

});
