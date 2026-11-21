import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  instanceSettings,
  instanceUserRoles,
  principalPermissionGrants,
  workflowRuns,
  workflowStepRuns,
  workflows,
} from "@paperclipai/db";
import type { WorkflowDetail, WorkflowTestCommand } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import {
  workflowExecutorService,
  enqueueWorkflowRunInTransaction,
} from "../services/workflows/workflow-executor.js";
import { admitCustomerWorkflowTest } from "../services/workflows/workflow-customer-test.js";
import { optimizerTraceService } from "../services/optimizer/optimizer-trace.js";
import { optimizerSuggestionService } from "../services/optimizer/optimizer-suggestions.js";
import { reviewWorkflowRun } from "../services/optimizer/optimizer-run-review.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { workflowRoutes } from "../routes/workflows.js";
import { errorHandler } from "../middleware/error-handler.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;
describePg("V9 actual unpublished native workflow tests", () => {
  let db!: ReturnType<typeof createDb>;
  let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const routeErrors: Array<{ name: string; message: string; top: string[] }> = [];
  const local: Express.Request["actor"] = {
    type: "board",
    source: "local_implicit",
  };
  const native = {
    principal: { type: "system" as const, service: "local-board" },
  };
  beforeAll(async () => {
    fixture = await startEmbeddedPostgresTestDatabase(
      "aw-v9-unpublished-tests-",
    );
    db = createDb(fixture.connectionString);
  }, 20_000);
  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(workflowStepRuns);
    await db.delete(workflowRuns);
    await db.delete(workflows);
    await db.delete(principalPermissionGrants);
    await db.delete(instanceUserRoles);
    await db.delete(companyMemberships);
    await db.delete(authUsers);
    await db.delete(companies);
    await db.delete(instanceSettings);
  });
  afterAll(async () => {
    await fixture?.cleanup();
  });
  function http(actor = local) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    app.use("/api", workflowRoutes(db));
    app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (err instanceof Error) routeErrors.push({
        name: err.name,
        message: err.message,
        top: (err.stack ?? "").split("\n").slice(0, 7),
      });
      errorHandler(err, req, res, next);
    });
    app.use(errorHandler);
    return request(app);
  }
  async function seed() {
    const [company] = await db
      .insert(companies)
      .values({
        name: "Internal tests",
        issuePrefix: `T${randomUUID().slice(0, 6)}`,
      })
      .returning();
    await instanceSettingsService(db).updateExperimental({
      enableWorkflowsV1: true,
      progressive_shell_v9: true,
      experience_projection_v9: true,
    });
    const svc = workflowService(db);
    const draft = await svc.create(
      company!.id,
      { name: "Unpublished process" },
      native,
    );
    return svc.updateDraft(
      company!.id,
      draft.id,
      {
        expectedRevisionId: draft.draftRevisionId!,
        graph: {
          version: 1,
          nodes: [
            {
              id: "start",
              type: "core.manual_trigger",
              name: "Internal start",
              config: {},
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
          variables: [],
          settings: { totalDeadlineSeconds: 60 },
        },
      },
      native,
    );
  }
  function command(detail: WorkflowDetail): WorkflowTestCommand {
    return {
      requestId: randomUUID(),
      expectedWorkflowId: detail.id,
      expectedUpdatedAt: detail.updatedAt.toISOString(),
      expectedDraftRevisionId: detail.draftRevisionId!,
      expectedRunStatus: "succeeded",
      acknowledgeInternalTest: true,
    };
  }
  const path = (detail: WorkflowDetail, principal = "local-board") =>
    `/api/companies/${detail.companyId}/workflows/${detail.id}/experience/test?expectedUserId=${principal}`;
  const reviewPath = (detail: WorkflowDetail, principal = "local-board") =>
    `/api/companies/${detail.companyId}/workflows/${detail.id}/experience?expectedUserId=${principal}`;
  async function current(detail: WorkflowDetail) {
    return (await workflowService(db).getDetail(
      detail.companyId,
      detail.id,
      local,
    ))!;
  }
  function changedGraph(detail: WorkflowDetail) {
    const graph = structuredClone(detail.draftRevision!.graph);
    graph.nodes[0].name = "Revised internal start";
    return graph;
  }
  async function runs() {
    return db.select().from(workflowRuns);
  }
  async function events() {
    return db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "workflow.customer_test_admitted"));
  }
  async function member(
    detail: WorkflowDetail,
    role: "owner" | "operator" | "viewer" = "owner",
  ) {
    const userId = `test-${randomUUID()}`;
    const now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Test requester", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({
      companyId: detail.companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: role,
    });
    await db.insert(principalPermissionGrants).values(
      ["workflows:read", "workflows:edit", "workflows:run"].map(
        (permissionKey) => ({
          companyId: detail.companyId,
          principalType: "user" as const,
          principalId: userId,
          permissionKey,
          scope: null,
        }),
      ),
    );
    return {
      type: "board" as const,
      source: "session" as const,
      userId,
      companyIds: [detail.companyId],
      memberships: [
        {
          companyId: detail.companyId,
          membershipRole: role,
          status: "active" as const,
        },
      ],
      isInstanceAdmin: false,
    };
  }
  it("executes the actual immutable draft as test without publishing, cloning or admitting live work", async () => {
    const detail = await seed(),
      input = command(detail);
    const before = await current(detail);
    const reply = await http().post(path(detail)).send(input);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      companyId: detail.companyId,
      workflowId: detail.id,
      requestId: input.requestId,
      runId: expect.any(String),
      revisionId: detail.draftRevisionId,
      purpose: "test",
      disposition: "admitted",
    });
    const [run] = await runs();
    expect(run).toMatchObject({
      id: reply.body.runId,
      source: "test",
      status: "succeeded",
      workflowRevisionId: detail.draftRevisionId,
      triggerPayload: {},
      executionPrincipal: native.principal,
    });
    expect(await current(detail)).toEqual(before);
    expect(await events()).toHaveLength(1);
    const steps = await db.select().from(workflowStepRuns);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      workflowRunId: run!.id,
      status: "succeeded",
    });
    const review = await http().get(reviewPath(detail));
    expect(review.status).toBe(200);
    expect(review.body).toMatchObject({
      status: "draft",
      canRequestTest: true,
      testAvailability: "internal_ready",
      testDeadlineSeconds: 60,
      testReceipt: reply.body,
    });
    const observed = await http().get(
      `/api/companies/${detail.companyId}/workflow-runs/${run!.id}/experience?expectedUserId=local-board`,
    );
    expect(observed.status).toBe(200);
    expect(observed.body).toMatchObject({
      purpose: "test",
      status: "succeeded",
      revisionState: "draft",
    });
    const overview = await http().get(
      `/api/companies/${detail.companyId}/workflows/${detail.id}/experience/operations?expectedUserId=local-board`,
    );
    expect(overview.body.recent.runs[0]).toMatchObject({
      id: run!.id,
      purpose: "test",
    });
  });
  it("serializes identical original requests and recovers one receipt after draft replacement and publication", async () => {
    routeErrors.length = 0;
    const detail = await seed(),
      input = command(detail);
    const [first, second] = await Promise.all([
      http().post(path(detail)).send(input),
      http().post(path(detail)).send(input),
    ]);
    expect(
      [first.status, second.status],
      JSON.stringify({ bodies: [first.body, second.body], routeErrors }),
    ).toEqual([200, 200]);
    expect(first.body).toEqual(second.body);
    const changed = await workflowService(db).updateDraft(
      detail.companyId,
      detail.id,
      {
        expectedRevisionId: detail.draftRevisionId!,
        graph: changedGraph(detail),
        changeSummary: "New review",
      },
      native,
    );
    await workflowService(db).publish(
      detail.companyId,
      detail.id,
      {
        expectedDraftRevisionId: changed.draftRevisionId!,
        expectedPublishedRevisionId: null,
      },
      native,
    );
    const replay = await http().post(path(detail)).send(input);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await runs()).toHaveLength(1);
    expect(await events()).toHaveLength(1);
    const recovered = await http().get(reviewPath(detail));
    expect(recovered.body.testReceipt).toEqual(first.body);
    expect(recovered.body.active.id).not.toBe(input.expectedDraftRevisionId);
  });
  it("retains queued test recovery on the original revision after draft replacement", async () => {
    const detail = await seed();
    const receipt = await admitCustomerWorkflowTest(
      db,
      detail.companyId,
      detail.id,
      command(detail),
      local,
    );
    const changed = await workflowService(db).updateDraft(
      detail.companyId,
      detail.id,
      {
        expectedRevisionId: detail.draftRevisionId!,
        graph: changedGraph(detail),
        changeSummary: "Different draft",
      },
      native,
    );
    expect(changed.draftRevisionId).not.toBe(receipt.revisionId);
    await workflowExecutorService(db).executeQueuedRun(
      detail.companyId,
      receipt.runId,
      native,
    );
    const [run] = await runs();
    expect(run).toMatchObject({
      status: "succeeded",
      source: "test",
      workflowRevisionId: receipt.revisionId,
    });
  });
  it.each([
    "stale",
    "revision",
    "workflow",
    "false_ack",
    "production_input",
    "wrong_expected_result",
  ])("rejects %s before native admission", async (scenario) => {
    const detail = await seed();
    const input: Record<string, unknown> = { ...command(detail) };
    if (scenario === "stale")
      input.expectedUpdatedAt = "2020-01-01T00:00:00.000Z";
    if (scenario === "revision") input.expectedDraftRevisionId = randomUUID();
    if (scenario === "workflow") input.expectedWorkflowId = randomUUID();
    if (scenario === "false_ack") input.acknowledgeInternalTest = false;
    if (scenario === "production_input") input.input = { customer: "PRIVATE" };
    if (scenario === "wrong_expected_result")
      input.expectedRunStatus = "running";
    expect(
      (await http().post(path(detail)).send(input)).status,
    ).toBeGreaterThanOrEqual(400);
    expect(await runs()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
  });
  it("does not allow retry or optimizer correction/trace to convert a test to live evidence", async () => {
    const detail = await seed(),
      reply = await http().post(path(detail)).send(command(detail));
    expect(reply.status).toBe(200);
    await expect(
      optimizerTraceService(db).normalizeWorkflowRun(
        detail.companyId,
        reply.body.runId,
      ),
    ).rejects.toMatchObject({ details: { code: "optimizer_trace_test_run" } });
    await expect(
      reviewWorkflowRun(
        db,
        detail.companyId,
        reply.body.runId,
        { humanCorrection: false, correctedOutputs: {}, reason: "test" },
        native,
      ),
    ).rejects.toMatchObject({
      details: { code: "workflow_test_not_production_evidence" },
    });
    await expect(
      workflowExecutorService(db).retryRun(
        detail.companyId,
        reply.body.runId,
        {},
        native,
        randomUUID(),
      ),
    ).rejects.toMatchObject({
      details: { code: "workflow_test_retry_requires_review" },
    });
    expect(await runs()).toHaveLength(1);
    await workflowService(db).publish(
      detail.companyId,
      detail.id,
      {
        expectedDraftRevisionId: detail.draftRevisionId!,
        expectedPublishedRevisionId: null,
      },
      native,
    );
    expect(
      await optimizerSuggestionService(db).forWorkflow(
        detail.companyId,
        detail.id,
      ),
    ).toMatchObject({
      state: "insufficient_runs",
      terminalRunCount: 0,
      correctionEvidenceCount: 0,
    });
  });
  it("rechecks the initiating human's current role during queued recovery", async () => {
    const detail = await seed(),
      actor = await member(detail);
    const receipt = await admitCustomerWorkflowTest(
      db,
      detail.companyId,
      detail.id,
      command(detail),
      actor,
    );
    await db
      .update(companyMemberships)
      .set({ membershipRole: "viewer" })
      .where(eq(companyMemberships.principalId, actor.userId));
    await workflowExecutorService(db).executeQueuedRun(
      detail.companyId,
      receipt.runId,
      native,
    );
    const [run] = await runs();
    expect(run!.status).not.toBe("succeeded");
    expect(
      await db
        .select()
        .from(workflowStepRuns)
        .where(eq(workflowStepRuns.status, "succeeded")),
    ).toHaveLength(0);
    const review = await http(actor).get(reviewPath(detail, actor.userId));
    expect(review.status).toBe(200);
    expect(review.body).toMatchObject({
      canRequestTest: false,
      testReceipt: null,
    });
    expect(
      (
        await http(actor)
          .post(path(detail, actor.userId))
          .send(command(await current(detail)))
      ).status,
    ).toBe(403);
  });
  it.each(["workflows:read", "workflows:edit", "workflows:run"])(
    "revokes original test receipt and queued execution after actual %s grant loss",
    async (permissionKey) => {
      const detail = await seed(),
        actor = await member(detail),
        input = command(detail);
      const receipt = await admitCustomerWorkflowTest(
        db,
        detail.companyId,
        detail.id,
        input,
        actor,
      );
      await db
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.principalId, actor.userId),
            eq(principalPermissionGrants.permissionKey, permissionKey),
          ),
        );
      expect(
        (await http(actor).post(path(detail, actor.userId)).send(input)).status,
      ).toBe(403);
      const review = await http(actor).get(reviewPath(detail, actor.userId));
      if (permissionKey === "workflows:read") expect(review.status).toBe(403);
      else {
        expect(review.status).toBe(200);
        expect(review.body).toMatchObject({
          canRequestTest: false,
          testReceipt: null,
        });
      }
      await workflowExecutorService(db).executeQueuedRun(
        detail.companyId,
        receipt.runId,
        native,
      );
      expect((await runs())[0]!.status).not.toBe("succeeded");
      expect(
        await db
          .select()
          .from(workflowStepRuns)
          .where(eq(workflowStepRuns.status, "succeeded")),
      ).toHaveLength(0);
      expect(await runs()).toHaveLength(1);
      expect(await events()).toHaveLength(1);
    },
  );
  it.each(["long_deadline", "input_contract", "variables"])(
    "refuses a native draft requiring %s before any test run",
    async (scenario) => {
      const detail = await seed(),
        graph = structuredClone(detail.draftRevision!.graph);
      if (scenario === "long_deadline")
        graph.settings.totalDeadlineSeconds = 61;
      if (scenario === "variables")
        graph.variables = [{ name: "private", defaultValue: "CANARY" }];
      const changed = await workflowService(db).updateDraft(
        detail.companyId,
        detail.id,
        {
          expectedRevisionId: detail.draftRevisionId!,
          graph,
          ...(scenario === "input_contract"
            ? { inputSchema: { type: "object" } }
            : {}),
        },
        native,
      );
      const reply = await http().post(path(detail)).send(command(changed));
      expect(reply.status).toBe(409);
      expect(reply.body.details.code).toBe("workflow_test_review_required");
      expect(await runs()).toHaveLength(0);
      expect(await events()).toHaveLength(0);
    },
  );
  it("keeps another human's original receipt private and rejects reused UUID with changed command", async () => {
    const detail = await seed(),
      first = await member(detail),
      other = await member(detail),
      input = command(detail);
    const reply = await http(first)
      .post(path(detail, first.userId))
      .send(input);
    expect(reply.status).toBe(200);
    const review = await http(other).get(reviewPath(detail, other.userId));
    expect(review.status).toBe(200);
    expect(review.body.testReceipt).toBeNull();
    expect(
      (await http(other).post(path(detail, other.userId)).send(input)).status,
    ).toBe(409);
    expect(
      (
        await http(first)
          .post(path(detail, first.userId))
          .send({ ...input, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" })
      ).status,
    ).toBe(409);
    expect(await runs()).toHaveLength(1);
  });
  it("rejects altered retained receipt bindings instead of displaying a different run", async () => {
    const detail = await seed(),
      reply = await http().post(path(detail)).send(command(detail));
    expect(reply.status).toBe(200);
    const [event] = await events();
    await db
      .update(activityLog)
      .set({
        details: {
          ...event!.details,
          receipt: { ...reply.body, revisionId: randomUUID() },
        },
      })
      .where(eq(activityLog.id, event!.id));
    expect((await http().get(reviewPath(detail))).status).toBe(404);
    expect(await runs()).toHaveLength(1);
  });
  it("keeps legacy manual admission from choosing an unpublished test source", async () => {
    const detail = await seed();
    const reply = await http()
      .post(`/api/companies/${detail.companyId}/workflows/${detail.id}/run`)
      .send({ input: {}, source: "test", revisionId: detail.draftRevisionId });
    expect(reply.status).toBe(400);
    expect(await runs()).toHaveLength(0);
  });
  it("enforces rollout at the native enqueue owner as well as the customer route", async () => {
    const detail = await seed(),
      input = command(detail);
    await instanceSettingsService(db).updateExperimental({
      progressive_shell_v9: false,
    });
    await expect(
      db.transaction((tx) =>
        enqueueWorkflowRunInTransaction(tx as unknown as typeof db, {
          companyId: detail.companyId,
          workflowId: detail.id,
          revisionId: detail.draftRevisionId!,
          nodeId: "start",
          source: "test",
          customerTestCommand: input,
          triggerPayload: {},
          responsibleUserId: null,
          correlationId: input.requestId,
          idempotencyKey: randomUUID(),
          actor: native,
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(await runs()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
  });
  it("blocks fresh admission on Pause and rollout rollback while preserving the native run", async () => {
    const detail = await seed(),
      input = command(detail);
    const receipt = await admitCustomerWorkflowTest(
      db,
      detail.companyId,
      detail.id,
      input,
      local,
    );
    await db
      .update(workflows)
      .set({ status: "paused" })
      .where(eq(workflows.id, detail.id));
    expect(
      (
        await http()
          .post(path(detail))
          .send({ ...input, requestId: randomUUID() })
      ).status,
    ).toBe(409);
    expect((await http().post(path(detail)).send(input)).body).toEqual(receipt);
    await instanceSettingsService(db).updateExperimental({
      progressive_shell_v9: false,
    });
    expect((await http().post(path(detail)).send(input)).status).toBe(404);
    expect(await runs()).toHaveLength(1);
  });
});
