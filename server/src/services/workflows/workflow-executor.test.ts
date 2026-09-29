import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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

  async function seedPublishedExternalAgentWorkflow(input: {
    expectedOutputSchema?: Record<string, unknown> | null;
    timeoutSeconds?: number;
  } = {}) {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "External Agent Co",
      issuePrefix: `X${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
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
      name: "OpenClaw Research",
      role: "research",
      status: "idle",
      adapterType: "openclaw_gateway",
      adapterConfig: {
        url: "ws://127.0.0.1:18789",
      },
      runtimeConfig: {},
      permissions: {},
    });

    const [workflow] = await db.insert(workflows).values({
      companyId,
      name: "External agent workflow",
      status: "active",
      createdByUserId: userId,
    }).returning();

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
          id: "external",
          type: "agent.external",
          name: "External research",
          position: { x: 180, y: 0 },
          config: {
            agentId,
            objective: "Research the account and return the requested structured result.",
            structuredInput: {
              accountId: "account-1",
              requestedFields: ["score"],
            },
            expectedOutputSchema: input.expectedOutputSchema ?? null,
            timeoutSeconds: input.timeoutSeconds ?? 120,
            allowedCapabilityScope: "binding_grants",
            fallbackPolicy: "fail",
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
        { id: "e1", source: "start", target: "external" },
        { id: "e2", source: "external", target: "after" },
      ],
      variables: [],
      settings: {},
    };
    const [revision] = await db.insert(workflowRevisions).values({
      companyId,
      workflowId: workflow!.id,
      revisionNumber: 1,
      state: "published",
      graph,
      createdByUserId: userId,
    }).returning();
    await db
      .update(workflows)
      .set({
        publishedRevisionId: revision!.id,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, workflow!.id));

    return {
      companyId,
      userId,
      agentId,
      workflow: {
        ...workflow!,
        publishedRevisionId: revision!.id,
      },
      revision: revision!,
    };
  }

  function fakeExternalHeartbeat(input: {
    companyId: string;
    agentId: string;
    runId?: string;
    confirmCancellation?: boolean;
  }) {
    const runId = input.runId ?? randomUUID();
    return {
      wakeup: vi.fn(async (
        agentId: string,
        options: Parameters<IssueAssignmentWakeupDeps["wakeup"]>[1],
      ) => {
        await db
          .insert(heartbeatRuns)
          .values({
            id: runId,
            companyId: input.companyId,
            agentId,
            invocationSource: options.source ?? "automation",
            triggerDetail: options.triggerDetail ?? "system",
            status: "queued",
            responsibleUserId: null,
            contextSnapshot: options.contextSnapshot ?? {},
          })
          .onConflictDoNothing();
        return {
          status: "skipped" as const,
          reason: "already_queued",
          message: null,
          issueId:
            typeof options.contextSnapshot?.issueId === "string"
              ? options.contextSnapshot.issueId
              : null,
          executionRunId: runId,
          executionAgentId: input.agentId,
          executionAgentName: "OpenClaw Research",
        };
      }),
      cancelRun: vi.fn(async (
        heartbeatRunId: string,
        reason?: string,
        options?: { errorCode?: string },
      ) => {
        if (input.confirmCancellation) {
          await db
            .update(heartbeatRuns)
            .set({
              status: "cancelled",
              finishedAt: new Date(),
              error: reason ?? "cancelled",
              errorCode: options?.errorCode ?? "cancelled",
              updatedAt: new Date(),
            })
            .where(eq(heartbeatRuns.id, heartbeatRunId));
        }
        return null;
      }),
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
          status: "skipped" as const,
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

  it("executes Transform deterministically with typed upstream, trigger, variables and prior-step context", async () => {
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
          id: "transform",
          type: "core.transform",
          name: "Map lead",
          position: { x: 200, y: 0 },
          config: {
            mapping: {
              amount: "{{input.value}}",
              account: "{{trigger.label}}",
              region: "{{variables.region}}",
              priorAmount: "{{steps.start.value}}",
              summary: "{{trigger.label}} / {{variables.region}}",
              payload: "{{input.payload}}",
              literal: "fixed",
            },
          },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "transform" }],
      variables: [{ name: "region", defaultValue: "DK" }],
      settings: {},
    });

    const result = await workflowExecutorService(db).startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      {
        input: {
          value: 42,
          label: "Acme",
          payload: { id: "lead-1", tags: ["priority"] },
        },
      },
      { principal: { type: "user", userId: seeded.userId } },
      "transform-run-1",
    );

    expect(result.run.status).toBe("succeeded");
    expect(result.steps).toHaveLength(2);
    expect(
      result.steps.find((step) => step.nodeId === "transform"),
    ).toMatchObject({
      status: "succeeded",
      outputJson: {
        amount: 42,
        account: "Acme",
        region: "DK",
        priorAmount: 42,
        summary: "Acme / DK",
        payload: { id: "lead-1", tags: ["priority"] },
        literal: "fixed",
      },
    });
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

  it("recovers after a real worker SIGKILL without duplicating an Agent Task side effect", async () => {
    if (process.platform === "win32") return;

    const seeded = await seedPublishedAgentTaskWorkflow({
      waitForCompletion: false,
    });
    const fixturePath = fileURLToPath(
      new URL(
        "../../__tests__/fixtures/workflow-process-kill-worker.ts",
        import.meta.url,
      ),
    );
    const child = spawn(
      process.execPath,
      ["--import", "tsx", fixturePath],
      {
        env: {
          ...process.env,
          WORKFLOW_PROCESS_KILL_DATABASE_URL: tempDb!.connectionString,
          WORKFLOW_PROCESS_KILL_COMPANY_ID: seeded.companyId,
          WORKFLOW_PROCESS_KILL_WORKFLOW_ID: seeded.workflow.id,
          WORKFLOW_PROCESS_KILL_USER_ID: seeded.userId,
          WORKFLOW_PROCESS_KILL_IDEMPOTENCY_KEY: "process-kill-run",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.setEncoding("utf8");

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `workflow process-kill fixture did not reach its kill point: ${stderr}`,
          ),
        );
      }, 15_000);
      timer.unref?.();

      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (!stdout.includes("WORKFLOW_PROCESS_KILL_READY")) return;
        clearTimeout(timer);
        resolve();
      });
      child.once("exit", (code, signal) => {
        if (stdout.includes("WORKFLOW_PROCESS_KILL_READY")) return;
        clearTimeout(timer);
        reject(
          new Error(
            `workflow process-kill fixture exited before kill point (code=${code}, signal=${signal}): ${stderr}`,
          ),
        );
      });
    });

    try {
      await ready;

      const runBeforeKill = await db
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.companyId, seeded.companyId),
            eq(workflowRuns.idempotencyKey, "process-kill-run"),
          ),
        )
        .then((rows) => rows[0] ?? null);
      expect(runBeforeKill).toMatchObject({
        status: "running",
      });

      const tasksBeforeKill = await db
        .select()
        .from(issues)
        .where(
          and(
            eq(issues.companyId, seeded.companyId),
            eq(issues.originKind, "workflow_task"),
            eq(issues.originRunId, runBeforeKill!.id),
          ),
        );
      expect(tasksBeforeKill).toHaveLength(1);

      const exitPromise = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      expect(child.kill("SIGKILL")).toBe(true);
      const exit = await exitPromise;
      expect(exit.signal).toBe("SIGKILL");

      // Advance only the durable lease clock so this test does not sleep for the
      // full production lease. The process death itself above is real.
      const recoveryNow = new Date();
      const expiredAt = new Date(recoveryNow.getTime() - 1_000);
      await db
        .update(workflowRuns)
        .set({
          leaseExpiresAt: expiredAt,
          ownerHeartbeatAt: expiredAt,
          updatedAt: expiredAt,
        })
        .where(eq(workflowRuns.id, runBeforeKill!.id));

      const heartbeat = fakeHeartbeat({
        companyId: seeded.companyId,
        agentId: seeded.agentId,
      });
      const recovery = await workflowExecutorService(db, {
        heartbeat,
      }).recoverExpiredRuns(20, recoveryNow);

      expect(recovery).toMatchObject({
        recovered: 1,
        failedRunIds: [],
      });

      const recovered = await workflowExecutorService(db).getRun(
        seeded.companyId,
        runBeforeKill!.id,
      );
      expect(recovered?.run.status).toBe("succeeded");

      const delegateAttempts = recovered!.steps
        .filter((step) => step.nodeId === "delegate")
        .sort((left, right) => left.attempt - right.attempt);
      expect(delegateAttempts).toHaveLength(2);
      expect(delegateAttempts[0]).toMatchObject({
        attempt: 1,
        status: "failed",
        errorCode: "workflow_execution_interrupted",
      });
      expect(delegateAttempts[1]).toMatchObject({
        attempt: 2,
        status: "succeeded",
      });

      const tasksAfterRecovery = await db
        .select()
        .from(issues)
        .where(
          and(
            eq(issues.companyId, seeded.companyId),
            eq(issues.originKind, "workflow_task"),
            eq(issues.originRunId, runBeforeKill!.id),
          ),
        );
      expect(tasksAfterRecovery).toHaveLength(1);
      expect(heartbeat.wakeup).toHaveBeenCalledTimes(1);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  }, 30_000);

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
    const actions = (await db.select().from(activityLog)).map(
      (row) => row.action,
    );
    expect(actions).toContain("workflow.agent_task_created");
    expect(actions).toContain("workflow.agent_task_delegated");
    expect(actions).toContain("workflow.agent_task_completed");
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
          status: "skipped" as const,
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

  it("executes External Agent with scoped OpenClaw context and validates its structured result", async () => {
    const expectedOutputSchema = {
      type: "object",
      required: ["score"],
      properties: {
        score: { type: "number" },
      },
      additionalProperties: false,
    };
    const seeded = await seedPublishedExternalAgentWorkflow({
      expectedOutputSchema,
    });
    const heartbeatRunId = randomUUID();
    const heartbeat = fakeExternalHeartbeat({
      companyId: seeded.companyId,
      agentId: seeded.agentId,
      runId: heartbeatRunId,
    });
    const executor = workflowExecutorService(db, { heartbeat });

    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: { requestedBy: "test" } },
      {
        principal: { type: "user", userId: seeded.userId },
        responsibleUserId: seeded.userId,
      },
      "external-agent-success",
    );

    expect(waiting.run.status).toBe("waiting");
    expect(waiting.waits).toEqual([
      expect.objectContaining({
        nodeId: "external",
        kind: "external_agent_run",
        status: "active",
        referenceType: "issue",
      }),
    ]);
    expect(
      waiting.steps.find((step) => step.nodeId === "external"),
    ).toMatchObject({
      status: "waiting",
      agentId: seeded.agentId,
      heartbeatRunId,
    });

    const wakeCall = heartbeat.wakeup.mock.calls[0];
    expect(wakeCall?.[0]).toBe(seeded.agentId);
    expect(wakeCall?.[1]).toMatchObject({
      source: "automation",
      triggerDetail: "system",
      reason: "workflow_external_agent",
      allowRunCoalescing: false,
      idempotencyKey: expect.stringMatching(
        /^workflow-external-agent:workflow-step:/,
      ),
    });
    const wakeContext = wakeCall?.[1].contextSnapshot ?? {};
    expect(wakeContext).toMatchObject({
      source: "workflow.external_agent",
      workflowExternalAgent: {
        companyId: seeded.companyId,
        externalAgentBindingId: seeded.agentId,
        objective: "Research the account and return the requested structured result.",
        structuredInput: {
          accountId: "account-1",
          requestedFields: ["score"],
        },
        expectedOutputSchema,
        timeoutSeconds: 120,
        allowedCapabilityScope: "binding_grants",
        workflowRunId: waiting.run.id,
        workflowNodeId: "external",
      },
    });
    const externalContract =
      wakeContext.workflowExternalAgent as Record<string, unknown>;
    expect(Object.keys(externalContract).sort()).toEqual([
      "allowedCapabilityScope",
      "companyId",
      "correlationId",
      "expectedOutputSchema",
      "externalAgentBindingId",
      "objective",
      "responsibleUser",
      "structuredInput",
      "timeoutSeconds",
      "workflowNodeId",
      "workflowRunId",
    ].sort());
    expect(externalContract).not.toHaveProperty("foundation");
    expect(externalContract).not.toHaveProperty("memory");
    expect(externalContract).not.toHaveProperty("credentials");
    expect(externalContract).not.toHaveProperty("taskHistory");

    const accountableTasks = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, seeded.companyId),
          eq(issues.originRunId, waiting.run.id),
        ),
      );
    expect(accountableTasks).toHaveLength(1);
    expect(accountableTasks[0]).toMatchObject({
      assigneeAgentId: seeded.agentId,
      originKind: "workflow_task",
      originId: seeded.workflow.id,
    });

    const completedAt = new Date();
    await db
      .update(heartbeatRuns)
      .set({
        status: "succeeded",
        finishedAt: completedAt,
        resultJson: {
          status: "ok",
          runId: "remote-run-1",
          result: {
            output: { score: 91 },
            artifacts: [{ id: "artifact-1", type: "research_report" }],
          },
        },
        usageJson: {
          inputTokens: 120,
          outputTokens: 42,
        },
        updatedAt: completedAt,
      })
      .where(eq(heartbeatRuns.id, heartbeatRunId));

    const recovery = await executor.recoverExpiredRuns(
      20,
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
        status: "succeeded",
        output: { score: 91 },
        externalRunId: "remote-run-1",
        issueId: accountableTasks[0]!.id,
        agentId: seeded.agentId,
        heartbeatRunId,
      }),
    });
    expect(
      completed?.steps.find((step) => step.nodeId === "external"),
    ).toMatchObject({
      status: "succeeded",
      agentId: seeded.agentId,
      heartbeatRunId,
      outputJson: expect.objectContaining({
        status: "succeeded",
        output: { score: 91 },
        artifacts: [{ id: "artifact-1", type: "research_report" }],
        usage: {
          inputTokens: 120,
          outputTokens: 42,
        },
        externalRunId: "remote-run-1",
      }),
    });
    expect(
      completed?.steps.find((step) => step.nodeId === "after"),
    ).toMatchObject({
      status: "succeeded",
      outputJson: { result: true },
    });

    const actions = (await db.select().from(activityLog)).map(
      (row) => row.action,
    );
    expect(actions).toContain("workflow.external_agent_requested");
    expect(actions).toContain("workflow.external_agent_dispatched");
    expect(actions).toContain("workflow.external_agent_completed");
  });

  it("fails External Agent output that does not match the declared schema", async () => {
    const seeded = await seedPublishedExternalAgentWorkflow({
      expectedOutputSchema: {
        type: "object",
        required: ["score"],
        properties: {
          score: { type: "number" },
        },
        additionalProperties: false,
      },
    });
    const heartbeatRunId = randomUUID();
    const heartbeat = fakeExternalHeartbeat({
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
      "external-agent-schema-mismatch",
    );

    const completedAt = new Date();
    await db
      .update(heartbeatRuns)
      .set({
        status: "succeeded",
        finishedAt: completedAt,
        resultJson: {
          status: "ok",
          runId: "remote-run-bad-output",
          result: {
            output: { score: "not-a-number" },
          },
        },
        updatedAt: completedAt,
      })
      .where(eq(heartbeatRuns.id, heartbeatRunId));

    await executor.recoverExpiredRuns(
      20,
      new Date(completedAt.getTime() + 1),
    );

    const failed = await executor.getRun(
      seeded.companyId,
      waiting.run.id,
    );
    expect(failed?.run).toMatchObject({
      status: "failed",
      failureCode: "workflow_output_schema_mismatch",
    });
    expect(
      failed?.steps.find((step) => step.nodeId === "external"),
    ).toMatchObject({
      status: "failed",
      errorCode: "workflow_output_schema_mismatch",
    });
  });

  it("times out External Agent work and records unconfirmed remote cancellation truthfully", async () => {
    const seeded = await seedPublishedExternalAgentWorkflow({
      timeoutSeconds: 1,
    });
    const heartbeatRunId = randomUUID();
    const heartbeat = fakeExternalHeartbeat({
      companyId: seeded.companyId,
      agentId: seeded.agentId,
      runId: heartbeatRunId,
      confirmCancellation: false,
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
      "external-agent-timeout",
    );

    await db
      .update(heartbeatRuns)
      .set({
        status: "running",
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, heartbeatRunId));

    const timeoutAt = waiting.waits[0]!.timeoutAt!;
    await executor.recoverExpiredRuns(
      20,
      new Date(new Date(timeoutAt).getTime() + 10),
    );

    expect(heartbeat.cancelRun).toHaveBeenCalledWith(
      heartbeatRunId,
      "External Agent workflow step exceeded its timeout",
      { errorCode: "workflow_external_agent_timeout" },
    );
    const failed = await executor.getRun(
      seeded.companyId,
      waiting.run.id,
    );
    expect(failed?.run).toMatchObject({
      status: "failed",
      failureCode: "workflow_external_agent_timeout",
    });
    expect(failed?.waits[0]).toMatchObject({
      status: "timed_out",
      resolutionJson: expect.objectContaining({
        cancellationRequested: true,
        cancellationConfirmed: false,
        heartbeatRunId,
      }),
    });
    const remoteRun = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, heartbeatRunId))
      .then((rows) => rows[0]);
    expect(remoteRun?.status).toBe("running");
  });

  it("fails closed when External Agent binding is not an OpenClaw gateway agent", async () => {
    const seeded = await seedPublishedExternalAgentWorkflow();
    await db
      .update(agents)
      .set({
        adapterType: "process",
        updatedAt: new Date(),
      })
      .where(eq(agents.id, seeded.agentId));
    const heartbeat = fakeExternalHeartbeat({
      companyId: seeded.companyId,
      agentId: seeded.agentId,
    });
    const executor = workflowExecutorService(db, { heartbeat });

    const failed = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      {
        principal: { type: "user", userId: seeded.userId },
        responsibleUserId: seeded.userId,
      },
      "external-agent-invalid-binding",
    );

    expect(failed.run).toMatchObject({
      status: "failed",
      failureCode: "workflow_external_agent_binding_invalid",
    });
    expect(failed.waits).toHaveLength(0);
    expect(heartbeat.wakeup).not.toHaveBeenCalled();
  });

  it("replays External Agent dispatch with the same idempotency key after runtime binding loss", async () => {
    const seeded = await seedPublishedExternalAgentWorkflow();
    const heartbeatRunId = randomUUID();
    const heartbeat = fakeExternalHeartbeat({
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
      "external-agent-replay",
    );
    const externalStep = waiting.steps.find(
      (step) => step.nodeId === "external",
    )!;
    await db
      .update(workflowStepRuns)
      .set({
        heartbeatRunId: null,
        updatedAt: new Date(),
      })
      .where(eq(workflowStepRuns.id, externalStep.id));
    await db
      .delete(heartbeatRuns)
      .where(eq(heartbeatRuns.id, heartbeatRunId));

    const recovery = await executor.recoverExpiredRuns(20, new Date());
    expect(recovery).toMatchObject({
      recovered: 0,
      deferred: 1,
      failedRunIds: [],
    });
    expect(heartbeat.wakeup).toHaveBeenCalledTimes(2);
    const firstKey = heartbeat.wakeup.mock.calls[0]?.[1].idempotencyKey;
    const replayKey = heartbeat.wakeup.mock.calls[1]?.[1].idempotencyKey;
    expect(replayKey).toBe(firstKey);

    const accountableTasks = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, seeded.companyId),
          eq(issues.originRunId, waiting.run.id),
        ),
      );
    expect(accountableTasks).toHaveLength(1);

    const rebound = await executor.getRun(
      seeded.companyId,
      waiting.run.id,
    );
    expect(
      rebound?.steps.find((step) => step.nodeId === "external"),
    ).toMatchObject({
      status: "waiting",
      heartbeatRunId,
      agentId: seeded.agentId,
    });
  });

  it("cancels a durable wait and preserves the cancellation as terminal audit state", async () => {
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
          name: "Wait",
          position: { x: 180, y: 0 },
          config: { durationSeconds: 3600 },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "delay" }],
      variables: [],
      settings: {},
    });
    const executor = workflowExecutorService(db);
    const actor = {
      principal: { type: "user" as const, userId: seeded.userId },
      responsibleUserId: seeded.userId,
    };

    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      actor,
      "cancel-delay-run",
    );
    expect(waiting.run.status).toBe("waiting");

    const cancelled = await executor.cancelRun(
      seeded.companyId,
      waiting.run.id,
      { reason: "Operator stopped the workflow" },
      actor,
    );

    expect(cancelled.run.status).toBe("cancelled");
    expect(cancelled.waits).toEqual([
      expect.objectContaining({
        nodeId: "delay",
        status: "cancelled",
        resolutionJson: expect.objectContaining({
          parentCancellation: true,
          errorCode: "workflow_parent_cancelled",
          reason: "Operator stopped the workflow",
        }),
      }),
    ]);
    expect(
      cancelled.steps.find((step) => step.nodeId === "delay"),
    ).toMatchObject({
      status: "cancelled",
      errorCode: "workflow_parent_cancelled",
    });

    const actions = (await db.select().from(activityLog)).map((row) => row.action);
    expect(actions).toContain("workflow.run_cancel_requested");
    expect(actions).toContain("workflow.wait_cancelled");
    expect(actions).toContain("workflow.step_cancelled");
    expect(actions).toContain("workflow.run_cancelled");
  });

  it("cancels a pending Human Approval when its parent workflow is cancelled", async () => {
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
            summary: "Approve the consequential action",
            consequence: "The workflow continues after approval.",
          },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "approval" }],
      variables: [],
      settings: {},
    });
    const executor = workflowExecutorService(db);
    const actor = {
      principal: { type: "user" as const, userId: seeded.userId },
      responsibleUserId: seeded.userId,
    };

    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      actor,
      "cancel-approval-run",
    );
    const approvalId = waiting.waits[0]!.referenceId!;
    expect((await approvalService(db).getById(approvalId))?.status).toBe("pending");

    const cancelled = await executor.cancelRun(
      seeded.companyId,
      waiting.run.id,
      { reason: "No longer required" },
      actor,
    );

    expect(cancelled.run.status).toBe("cancelled");
    expect((await approvalService(db).getById(approvalId))).toMatchObject({
      status: "cancelled",
      decisionNote: "Workflow run cancelled: No longer required",
      decidedByUserId: seeded.userId,
    });
    expect(cancelled.waits[0]).toMatchObject({
      status: "cancelled",
      referenceType: "approval",
      referenceId: approvalId,
    });
  });

  it("propagates parent cancellation to External Agent work before finalizing the run", async () => {
    const seeded = await seedPublishedExternalAgentWorkflow();
    const heartbeatRunId = randomUUID();
    const heartbeat = fakeExternalHeartbeat({
      companyId: seeded.companyId,
      agentId: seeded.agentId,
      runId: heartbeatRunId,
      confirmCancellation: true,
    });
    const executor = workflowExecutorService(db, { heartbeat });
    const actor = {
      principal: { type: "user" as const, userId: seeded.userId },
      responsibleUserId: seeded.userId,
    };

    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      actor,
      "cancel-external-agent-run",
    );
    const childIssueId = waiting.waits[0]!.referenceId!;

    const cancelled = await executor.cancelRun(
      seeded.companyId,
      waiting.run.id,
      { reason: "Operator cancelled external work" },
      actor,
    );

    expect(heartbeat.cancelRun).toHaveBeenCalledWith(
      heartbeatRunId,
      "Operator cancelled external work",
      { errorCode: "workflow_parent_cancelled" },
    );
    expect(cancelled.run.status).toBe("cancelled");
    expect(
      cancelled.steps.find((step) => step.nodeId === "external"),
    ).toMatchObject({
      status: "cancelled",
      heartbeatRunId,
      errorCode: "workflow_parent_cancelled",
    });
    expect(cancelled.waits[0]).toMatchObject({
      status: "cancelled",
      referenceType: "issue",
      referenceId: childIssueId,
    });

    const childIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, childIssueId))
      .then((rows) => rows[0]);
    expect(childIssue?.status).toBe("cancelled");

    const childHeartbeat = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, heartbeatRunId))
      .then((rows) => rows[0]);
    expect(childHeartbeat?.status).toBe("cancelled");
  });

  it("keeps a run cancelling until External Agent cancellation is confirmed, then recovery finalizes it", async () => {
    const seeded = await seedPublishedExternalAgentWorkflow();
    const heartbeatRunId = randomUUID();
    const heartbeat = fakeExternalHeartbeat({
      companyId: seeded.companyId,
      agentId: seeded.agentId,
      runId: heartbeatRunId,
      confirmCancellation: false,
    });
    const executor = workflowExecutorService(db, { heartbeat });
    const actor = {
      principal: { type: "user" as const, userId: seeded.userId },
      responsibleUserId: seeded.userId,
    };

    const waiting = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: {} },
      actor,
      "cancel-external-agent-unconfirmed",
    );

    const cancelling = await executor.cancelRun(
      seeded.companyId,
      waiting.run.id,
      { reason: "Stop remote work" },
      actor,
    );

    expect(cancelling.run.status).toBe("cancelling");
    expect(
      cancelling.steps.find((step) => step.nodeId === "external"),
    ).toMatchObject({
      status: "cancelling",
      heartbeatRunId,
    });
    expect(cancelling.waits[0]?.status).toBe("cancelled");

    await db
      .update(heartbeatRuns)
      .set({
        status: "cancelled",
        finishedAt: new Date(),
        errorCode: "workflow_parent_cancelled",
        updatedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, heartbeatRunId));

    const recovery = await executor.recoverExpiredRuns(20, new Date());
    expect(recovery).toMatchObject({
      recovered: 1,
      failedRunIds: [],
    });

    const cancelled = await executor.getRun(
      seeded.companyId,
      waiting.run.id,
    );
    expect(cancelled?.run.status).toBe("cancelled");
    expect(
      cancelled?.steps.find((step) => step.nodeId === "external"),
    ).toMatchObject({
      status: "cancelled",
      errorCode: "workflow_parent_cancelled",
    });
  });


  it("retries a failed run as a new immutable run while reusing completed task side effects", async () => {
    const seeded = await seedPublishedGraph({
      version: 1,
      nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        {
          id: "task",
          type: "work.create_task",
          name: "Create review task",
          position: { x: 180, y: 0 },
          config: {
            title: "Review the account",
            description: "Review the account once.",
            projectId: null,
            assigneeAgentId: null,
            assigneeUserId: null,
            waitForCompletion: false,
          },
        },
        {
          id: "fail",
          type: "core.condition",
          name: "Missing input",
          position: { x: 360, y: 0 },
          config: { expression: "{{trigger.missing}}" },
        },
      ],
      edges: [
        { id: "e1", source: "start", target: "task" },
        { id: "e2", source: "task", target: "fail" },
      ],
      variables: [],
      settings: {},
    });
    const executor = workflowExecutorService(db);
    const actor = {
      principal: { type: "user" as const, userId: seeded.userId },
      responsibleUserId: seeded.userId,
    };
    const failed = await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      { input: { accountId: "acme" } },
      actor,
      "retry-root-run",
    );
    expect(failed.run.status).toBe("failed");
    expect(
      await db.select().from(issues).where(
        and(
          eq(issues.companyId, seeded.companyId),
          eq(issues.originKind, "workflow_task"),
        ),
      ),
    ).toHaveLength(1);

    const retried = await executor.retryRun(
      seeded.companyId,
      failed.run.id,
      { reason: "Retry after correcting the dependency" },
      actor,
      "retry-request-1",
    );
    expect(retried.run.id).not.toBe(failed.run.id);
    expect(retried.run).toMatchObject({
      status: "failed",
      workflowRevisionId: failed.run.workflowRevisionId,
      triggerPayload: failed.run.triggerPayload,
      retryOfRunId: failed.run.id,
      idempotencyRootRunId: failed.run.id,
    });
    expect(
      await db.select().from(issues).where(
        and(
          eq(issues.companyId, seeded.companyId),
          eq(issues.originKind, "workflow_task"),
        ),
      ),
    ).toHaveLength(1);

    const replay = await executor.retryRun(
      seeded.companyId,
      failed.run.id,
      { reason: "Retry after correcting the dependency" },
      actor,
      "retry-request-1",
    );
    expect(replay.run.id).toBe(retried.run.id);
    expect(await db.select().from(workflowRuns)).toHaveLength(2);
    const actions=(await db.select().from(activityLog)).map((row)=>row.action);
    expect(actions.filter((action)=>action==="workflow.run_retry_created")).toHaveLength(1);
  });

  it("rejects whole-run retry for a successful run", async () => {
    const seeded=await seedPublishedManualWorkflow();
    const executor=workflowExecutorService(db);
    const actor={principal:{type:"user" as const,userId:seeded.userId}};
    const completed=await executor.startManualRun(
      seeded.companyId,
      seeded.workflow.id,
      {input:{}},
      actor,
      "successful-run",
    );
    expect(completed.run.status).toBe("succeeded");
    await expect(
      executor.retryRun(
        seeded.companyId,
        completed.run.id,
        {},
        actor,
        "retry-successful-run",
      ),
    ).rejects.toMatchObject({
      status:409,
      details:expect.objectContaining({
        code:"workflow_run_not_retryable",
        status:"succeeded",
      }),
    });
  });


});
