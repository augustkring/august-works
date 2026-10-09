import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  companyMemberships,
  createDb,
  instanceSettings,
  pipelineStages,
  pipelines,
  principalPermissionGrants,
  routines,
  routineTriggers,
  toolInvocations,
  workflowRevisions,
  workflowRuns,
  workflowStepRuns,
  workflowWaits,
  workflows,
} from "@paperclipai/db";
import type {
  WorkflowDetail,
  WorkflowLifecycleCommand,
  WorkflowLaunchCommand,
} from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { enqueueWorkflowRunInTransaction } from "../services/workflows/workflow-executor.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { workflowRoutes } from "../routes/workflows.js";
import { errorHandler } from "../middleware/error-handler.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;
describePg("V9 native workflow lifecycle", () => {
  let db!: ReturnType<typeof createDb>;
  let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const local: Express.Request["actor"] = {
    type: "board",
    source: "local_implicit",
    userId: "board",
    isInstanceAdmin: true,
  };
  const native = {
    principal: { type: "system" as const, service: "local-board" },
  };
  beforeAll(async () => {
    fixture = await startEmbeddedPostgresTestDatabase(
      "aw-v9-workflow-lifecycle-",
    );
    db = createDb(fixture.connectionString);
  }, 20_000);
  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(routines);
    await db.delete(pipelines);
    await db.delete(toolInvocations);
    await db.delete(workflowWaits);
    await db.delete(workflowStepRuns);
    await db.delete(workflowRuns);
    await db.delete(workflows);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
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
    app.use(errorHandler);
    return request(app);
  }
  async function seed(
    settings: { totalDeadlineSeconds?: number } = { totalDeadlineSeconds: 60 },
  ) {
    const [company] = await db
      .insert(companies)
      .values({
        name: "Lifecycle",
        issuePrefix: `L${randomUUID().slice(0, 6)}`,
      })
      .returning();
    await instanceSettingsService(db).updateExperimental({
      enableWorkflowsV1: true,
      experience_projection_v9: true,
      progressive_shell_v9: true,
    });
    const svc = workflowService(db);
    const draft = await svc.create(
      company!.id,
      { name: "Review process" },
      native,
    );
    const saved = await svc.updateDraft(
      company!.id,
      draft.id,
      {
        expectedRevisionId: draft.draftRevisionId!,
        graph: {
          version: 1,
          nodes: [
            {
              id: "start",
              name: "Start",
              type: "core.manual_trigger",
              config: {},
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
          variables: [],
          settings,
        },
      },
      native,
    );
    return svc.publish(
      company!.id,
      draft.id,
      {
        expectedDraftRevisionId: saved.draftRevisionId!,
        expectedPublishedRevisionId: null,
      },
      native,
    );
  }
  function command(
    detail: WorkflowDetail,
    action: WorkflowLifecycleCommand["action"],
  ): WorkflowLifecycleCommand {
    return {
      requestId: randomUUID(),
      action,
      expectedStatus: detail.status as "active" | "paused",
      expectedUpdatedAt: detail.updatedAt.toISOString(),
      expectedPublishedRevisionId: detail.publishedRevisionId,
      expectedDraftRevisionId: detail.draftRevisionId,
      workPolicy: "finish_existing",
    };
  }
  const path = (detail: WorkflowDetail, principal = "local-board") =>
    `/api/companies/${detail.companyId}/workflows/${detail.id}/experience/lifecycle?expectedUserId=${principal}`;
  async function current(detail: WorkflowDetail) {
    return (await workflowService(db).getDetail(
      detail.companyId,
      detail.id,
      local,
    ))!;
  }

  function launchCommand(detail: WorkflowDetail): WorkflowLaunchCommand {
    return {
      requestId: randomUUID(),
      expectedUpdatedAt: detail.updatedAt.toISOString(),
      expectedPublishedRevisionId: detail.publishedRevisionId!,
      expectedDraftRevisionId: detail.draftRevisionId,
      acknowledgeInternalExecution: true,
    };
  }
  const launchPath = (detail: WorkflowDetail, principal = "local-board") =>
    `/api/companies/${detail.companyId}/workflows/${detail.id}/experience/launch?expectedUserId=${principal}`;
  it("admits one immutable native run and reconciles its original receipt after Pause", async () => {
    const detail = await seed(),
      input = launchCommand(detail);
    const revisionBefore = await db
      .select()
      .from(workflowRevisions)
      .where(eq(workflowRevisions.workflowId, detail.id));
    const responses = await Promise.all([
      http().post(launchPath(detail)).send(input),
      http().post(launchPath(detail)).send(input),
    ]);
    for (const response of responses) expect(response.status).toBe(200);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(responses[0].body).toMatchObject({
      disposition: "admitted",
      revisionId: detail.publishedRevisionId,
      requestId: input.requestId,
    });
    const runs = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, detail.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("succeeded");
    expect(
      await db
        .select()
        .from(workflowRevisions)
        .where(eq(workflowRevisions.workflowId, detail.id)),
    ).toEqual(revisionBefore);
    await http().post(path(detail)).send(command(detail, "pause")).expect(200);
    const replay = await http()
      .post(launchPath(detail))
      .send(input)
      .expect(200);
    expect(replay.body).toEqual(responses[0].body);
    await http()
      .post(launchPath(detail))
      .send(launchCommand(await current(detail)))
      .expect(409);
    expect(
      await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, detail.id)),
    ).toHaveLength(1);
  });
  it("refuses changed and stale commands without admitting additional work", async () => {
    const detail = await seed(),
      input = launchCommand(detail);
    await http()
      .post(launchPath(detail))
      .send({ ...input, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" })
      .expect(409);
    expect(await db.select().from(workflowRuns)).toHaveLength(0);
    await http().post(launchPath(detail)).send(input).expect(200);
    const changed = await http()
      .post(launchPath(detail))
      .send({ ...input, expectedDraftRevisionId: randomUUID() })
      .expect(409);
    expect(changed.body.details.code).toBe("workflow_launch_request_conflict");
    expect(await db.select().from(workflowRuns)).toHaveLength(1);
  });
  it("requires bounded execution settings and explicit internal acknowledgement", async () => {
    const detail = await seed({}),
      input = launchCommand(detail);
    await http()
      .post(launchPath(detail))
      .send({ ...input, acknowledgeInternalExecution: false })
      .expect(400);
    await http()
      .post(launchPath(detail))
      .send({ ...input, input: { private: "SECRET" } })
      .expect(400);
    const rejected = await http()
      .post(launchPath(detail))
      .send(input)
      .expect(409);
    expect(rejected.body.details.code).toBe("workflow_launch_review_required");
    expect(await db.select().from(workflowRuns)).toHaveLength(0);
  });
  it("rechecks current native run authority, account and rollout before admitting a run", async () => {
    const detail = await seed(),
      input = launchCommand(detail);
    await http()
      .post(launchPath(detail, "other-account"))
      .send(input)
      .expect(409);
    const userId = randomUUID();
    await db.insert(companyMemberships).values({
      companyId: detail.companyId,
      principalType: "user",
      principalId: userId,
      membershipRole: "viewer",
      status: "active",
    });
    await db.insert(principalPermissionGrants).values({
      companyId: detail.companyId,
      principalType: "user",
      principalId: userId,
      permissionKey: "workflows:read",
    });
    const actor: Express.Request["actor"] = {
      type: "board",
      source: "session",
      userId,
      isInstanceAdmin: false,
    };
    await http(actor).post(launchPath(detail, userId)).send(input).expect(403);
    await instanceSettingsService(db).updateExperimental({
      progressive_shell_v9: false,
    });
    await http().post(launchPath(detail)).send(input).expect(404);
    expect(await db.select().from(workflowRuns)).toHaveLength(0);
  });

  it("denies original run reconciliation after effective run-grant revocation", async () => {
    const detail = await seed(),
      userId = "run-operator",
      input = launchCommand(detail);
    await db
      .insert(companyMemberships)
      .values({
        companyId: detail.companyId,
        principalType: "user",
        principalId: userId,
        membershipRole: "viewer",
        status: "active",
      });
    await db
      .insert(principalPermissionGrants)
      .values(
        ["workflows:read", "workflows:run"].map((permissionKey) => ({
          companyId: detail.companyId,
          principalType: "user",
          principalId: userId,
          permissionKey,
        })),
      );
    const actor: Express.Request["actor"] = {
      type: "board",
      source: "session",
      userId,
      companyIds: [detail.companyId],
      memberships: [
        {
          companyId: detail.companyId,
          membershipRole: "viewer",
          status: "active",
        },
      ],
      isInstanceAdmin: false,
    };
    const original = await http(actor)
      .post(launchPath(detail, userId))
      .send(input)
      .expect(200);
    await db
      .delete(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.principalId, userId),
          eq(principalPermissionGrants.permissionKey, "workflows:run"),
        ),
      );
    await http(actor).post(launchPath(detail, userId)).send(input).expect(403);
    const runs = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, detail.id));
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(original.body.runId);
  });

  it("reads bounded native run status and blockers without exposing copied payloads or errors", async () => {
    const detail = await seed();
    const sibling = await seed();
    const base = new Date("2026-10-09T12:00:00Z");
    await db.insert(workflowRuns).values(
      Array.from({ length: 12 }, (_, index) => ({
        companyId: detail.companyId,
        workflowId: detail.id,
        workflowRevisionId: detail.publishedRevisionId!,
        source: "manual",
        status: index < 7 ? "waiting" : "succeeded",
        triggerPayload: { secret: "PRIVATE-TRIGGER" },
        failureMessage: "PRIVATE-ERROR",
        createdAt: new Date(base.getTime() + index * 1000),
        finishedAt: index < 7 ? null : base,
      })),
    );
    await db.insert(workflowRuns).values({
      companyId: sibling.companyId,
      workflowId: sibling.id,
      workflowRevisionId: sibling.publishedRevisionId!,
      source: "manual",
      status: "recovering",
    });
    const response = await http()
      .get(
        `/api/companies/${detail.companyId}/workflows/${detail.id}/experience/operations?expectedUserId=local-board`,
      )
      .expect(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toMatchObject({
      companyId: detail.companyId,
      workflowId: detail.id,
      nextTrigger: { state: "request_or_event" },
      recent: { hasMore: true },
      blockers: { hasMore: true },
    });
    expect(response.body.recent.runs).toHaveLength(10);
    expect(response.body.blockers.runs).toHaveLength(5);
    expect(
      response.body.blockers.runs.every(
        (run: { status: string }) => run.status === "waiting",
      ),
    ).toBe(true);
    expect(response.body.recent.runs[0].createdAt).toBe(
      new Date(base.getTime() + 11_000).toISOString(),
    );
    const encoded = JSON.stringify(response.body);
    expect(encoded).not.toContain("PRIVATE-");
    expect(encoded).not.toContain("triggerPayload");
    expect(encoded).not.toContain("failureMessage");
    expect(encoded).not.toContain(sibling.id);
  });

  it("shows the earliest configured native schedule and stops new triggers after Pause", async () => {
    const detail = await seed();
    const [routine] = await db
      .insert(routines)
      .values({
        companyId: detail.companyId,
        title: "PRIVATE-ROUTINE",
        executionTargetKind: "workflow",
        executionTargetRef: detail.id,
        status: "active",
      })
      .returning();
    const first = new Date("2026-10-10T08:00:00Z");
    await db.insert(routineTriggers).values([
      {
        companyId: detail.companyId,
        routineId: routine!.id,
        kind: "schedule",
        nextRunAt: first,
      },
      {
        companyId: detail.companyId,
        routineId: routine!.id,
        kind: "schedule",
        nextRunAt: new Date("2026-10-10T09:00:00Z"),
      },
      {
        companyId: detail.companyId,
        routineId: routine!.id,
        kind: "schedule",
        enabled: false,
        nextRunAt: new Date("2026-10-10T06:00:00Z"),
      },
      {
        companyId: detail.companyId,
        routineId: routine!.id,
        kind: "schedule",
        setupPending: true,
        nextRunAt: new Date("2026-10-10T07:00:00Z"),
      },
    ]);
    const url = `/api/companies/${detail.companyId}/workflows/${detail.id}/experience/operations?expectedUserId=local-board`;
    const before = await http().get(url).expect(200);
    expect(before.body.nextTrigger).toEqual({
      state: "scheduled",
      at: first.toISOString(),
    });
    expect(JSON.stringify(before.body)).not.toContain("PRIVATE-ROUTINE");
    await http().post(path(detail)).send(command(detail, "pause")).expect(200);
    expect((await http().get(url).expect(200)).body.nextTrigger).toEqual({
      state: "stopped",
    });
  });

  it("does not present an unpublished workflow as live or invent execution receipts from a read", async () => {
    await seed();
    const [company] = await db.select().from(companies);
    const draft = await workflowService(db).create(
      company!.id,
      { name: "Unpublished" },
      native,
    );
    const before = await db.select().from(activityLog);
    const view = await http()
      .get(
        `/api/companies/${company!.id}/workflows/${draft.id}/experience/operations?expectedUserId=local-board`,
      )
      .expect(200);
    expect(view.body).toMatchObject({
      status: "draft",
      publishedRevisionId: null,
      nextTrigger: { state: "not_published" },
      recent: { runs: [], hasMore: false },
      blockers: { runs: [], hasMore: false },
    });
    expect(await db.select().from(activityLog)).toEqual(before);
  });

  it("binds operation reads to the current account, company and enabled native rollout", async () => {
    const detail = await seed();
    const root = `/api/companies/${detail.companyId}/workflows/${detail.id}/experience/operations`;
    await http().get(`${root}?expectedUserId=another-user`).expect(409);
    await http({ type: "agent", source: "agent_key", agentId: randomUUID() })
      .get(`${root}?expectedUserId=local-board`)
      .expect(403);
    await http({
      type: "board",
      source: "session",
      userId: "stranger",
      companyIds: [],
    })
      .get(`${root}?expectedUserId=stranger`)
      .expect(403);
    await instanceSettingsService(db).updateExperimental({
      progressive_shell_v9: false,
    });
    await http().get(`${root}?expectedUserId=local-board`).expect(404);
  });

  it("refuses a foreign historical revision instead of returning a partial healthy overview", async () => {
    const detail = await seed(),
      sibling = await seed();
    await db.insert(workflowRuns).values({
      companyId: detail.companyId,
      workflowId: detail.id,
      workflowRevisionId: sibling.publishedRevisionId!,
      source: "manual",
      status: "queued",
      triggerPayload: { secret: "PRIVATE-FOREIGN" },
    });
    const response = await http()
      .get(
        `/api/companies/${detail.companyId}/workflows/${detail.id}/experience/operations?expectedUserId=local-board`,
      )
      .expect(404);
    expect(response.body.recent).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE-FOREIGN");
  });

  it("rejects an operation read after current membership is revoked despite a stale actor snapshot", async () => {
    const detail = await seed(),
      userId = "overview-viewer";
    await db.insert(companyMemberships).values({
      companyId: detail.companyId,
      principalType: "user",
      principalId: userId,
      membershipRole: "viewer",
      status: "active",
    });
    await db.insert(principalPermissionGrants).values({
      companyId: detail.companyId,
      principalType: "user",
      principalId: userId,
      permissionKey: "workflows:read",
    });
    const actor: Express.Request["actor"] = {
      type: "board",
      source: "session",
      userId,
      companyIds: [detail.companyId],
      memberships: [
        {
          companyId: detail.companyId,
          membershipRole: "viewer",
          status: "active",
        },
      ],
    };
    const url = `/api/companies/${detail.companyId}/workflows/${detail.id}/experience/operations?expectedUserId=${userId}`;
    await http(actor).get(url).expect(200);
    await db
      .update(companyMemberships)
      .set({ status: "inactive" })
      .where(eq(companyMemberships.principalId, userId));
    await http(actor).get(url).expect(403);
  });

  it("confirms pause/resume without changing immutable revisions, and replays the original receipt after later changes", async () => {
    const detail = await seed();
    const before = await db.select().from(workflowRevisions);
    const original = command(detail, "pause");
    const paused = await http().post(path(detail)).send(original).expect(200);
    expect(paused.headers["cache-control"]).toBe("private, no-store");
    expect(paused.body.status).toBe("paused");
    await http()
      .post(path(detail))
      .send(command(await current(detail), "resume"))
      .expect(200);
    const replay = await http().post(path(detail)).send(original).expect(200);
    expect(replay.body).toEqual(paused.body);
    expect((await current(detail)).status).toBe("active");
    expect(await db.select().from(workflowRevisions)).toEqual(before);
    expect(
      (await db.select().from(activityLog)).filter(
        (row) => row.action === "workflow.lifecycle_changed",
      ),
    ).toHaveLength(2);
    await http()
      .post(path(detail))
      .send({ ...original, action: "retire" })
      .expect(409);
  });
  it("permits exactly one concurrent original change and rejects stale versions and silent resume", async () => {
    const detail = await seed();
    const results = await Promise.all([
      http().post(path(detail)).send(command(detail, "pause")),
      http().post(path(detail)).send(command(detail, "pause")),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    await http().post(path(detail)).send(command(detail, "resume")).expect(409);
    expect((await current(detail)).status).toBe("paused");
  });
  it.each(["manual", "routine", "pipeline", "api", "task"] as const)(
    "fences a prepared %s admission after native pause",
    async (source) => {
      const detail = await seed();
      await http()
        .post(path(detail))
        .send(command(detail, "pause"))
        .expect(200);
      await expect(
        db.transaction((tx) =>
          enqueueWorkflowRunInTransaction(tx as unknown as typeof db, {
            companyId: detail.companyId,
            workflowId: detail.id,
            revisionId: detail.publishedRevisionId!,
            nodeId: "start",
            source,
            triggerPayload: {},
            responsibleUserId: null,
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
            actor: native,
          }),
        ),
      ).rejects.toMatchObject({
        status: 409,
        details: { code: "workflow_invalid_transition", status: "paused" },
      });
      expect(await db.select().from(workflowRuns)).toHaveLength(0);
    },
  );
  it("keeps admitted work intact and refuses retirement until it finishes; then retains history and discards the draft", async () => {
    const detail = await seed();
    const queued = await db.transaction((tx) =>
      enqueueWorkflowRunInTransaction(tx as unknown as typeof db, {
        companyId: detail.companyId,
        workflowId: detail.id,
        revisionId: detail.publishedRevisionId!,
        nodeId: "start",
        source: "manual",
        triggerPayload: {},
        responsibleUserId: null,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        actor: native,
      }),
    );
    await http().post(path(detail)).send(command(detail, "pause")).expect(200);
    expect((await db.select().from(workflowRuns))[0]!.status).toBe("queued");
    const retirement = command(await current(detail), "retire");
    await http()
      .post(path(detail))
      .send(retirement)
      .expect(409)
      .expect((response) =>
        expect(response.body.details.code).toBe("workflow_work_pending"),
      );
    await db
      .update(workflowRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(workflowRuns.id, queued.run.id));
    await db
      .update(workflowStepRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(workflowStepRuns.workflowRunId, queued.run.id));
    const retired = await http()
      .post(path(detail))
      .send(retirement)
      .expect(200);
    expect(retired.body).toMatchObject({
      status: "archived",
      draftRevisionId: null,
      publishedRevisionId: detail.publishedRevisionId,
    });
    expect((await db.select().from(workflowRuns))[0]!.id).toBe(queued.run.id);
    expect(
      await workflowService(db).getRevision(
        detail.companyId,
        detail.id,
        detail.draftRevisionId!,
        local,
      ),
    ).toMatchObject({ state: "discarded" });
    expect(
      (await http().post(path(detail)).send(retirement).expect(200)).body,
    ).toEqual(retired.body);
    await http()
      .post(path(detail))
      .send(command({ ...(await current(detail)), status: "paused" }, "resume"))
      .expect(409);
  });
  it.each(["routine", "pipeline"])(
    "requires explicit removal of a linked %s before retirement",
    async (kind) => {
      const detail = await seed();
      if (kind === "routine")
        await db.insert(routines).values({
          companyId: detail.companyId,
          title: "Linked routine",
          executionTargetKind: "workflow",
          executionTargetRef: detail.id,
        });
      else {
        const [pipeline] = await db
          .insert(pipelines)
          .values({
            companyId: detail.companyId,
            key: "linked",
            name: "Linked",
          })
          .returning();
        await db.insert(pipelineStages).values({
          pipelineId: pipeline!.id,
          key: "work",
          name: "Work",
          kind: "working",
          position: 1,
          config: {
            automation: { targetKind: "workflow", workflowId: detail.id },
          },
        });
      }
      await http()
        .post(path(detail))
        .send(command(detail, "pause"))
        .expect(200);
      await http()
        .post(path(detail))
        .send(command(await current(detail), "retire"))
        .expect(409)
        .expect((response) =>
          expect(response.body.details.code).toBe("workflow_bindings_present"),
        );
      expect((await current(detail)).status).toBe("paused");
    },
  );
  it("does not mistake a terminal workflow status for a reconciled external tool", async () => {
    const detail = await seed();
    const queued = await db.transaction((tx) =>
      enqueueWorkflowRunInTransaction(tx as unknown as typeof db, {
        companyId: detail.companyId,
        workflowId: detail.id,
        revisionId: detail.publishedRevisionId!,
        nodeId: "start",
        source: "manual",
        triggerPayload: {},
        responsibleUserId: null,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        actor: native,
      }),
    );
    await db
      .update(workflowRuns)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(workflowRuns.id, queued.run.id));
    await db
      .update(workflowStepRuns)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(workflowStepRuns.workflowRunId, queued.run.id));
    await db.insert(toolInvocations).values({
      companyId: detail.companyId,
      workflowRunId: queued.run.id,
      toolName: "PRIVATE-TOOL",
      status: "timed_out",
    });
    await http().post(path(detail)).send(command(detail, "pause")).expect(200);
    await http()
      .post(path(detail))
      .send(command(await current(detail), "retire"))
      .expect(409)
      .expect((response) => {
        expect(response.body.details.code).toBe("workflow_work_pending");
        expect(JSON.stringify(response.body)).not.toContain("PRIVATE-TOOL");
      });
  });
  it("preserves an already admitted native enqueue receipt after pause without adding work", async () => {
    const detail = await seed();
    const input = {
      companyId: detail.companyId,
      workflowId: detail.id,
      revisionId: detail.publishedRevisionId!,
      nodeId: "start",
      source: "manual" as const,
      triggerPayload: {},
      responsibleUserId: null,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      actor: native,
    };
    const queued = await db.transaction((tx) =>
      enqueueWorkflowRunInTransaction(tx as unknown as typeof db, input),
    );
    await http().post(path(detail)).send(command(detail, "pause")).expect(200);
    const replay = await db.transaction((tx) =>
      enqueueWorkflowRunInTransaction(tx as unknown as typeof db, input),
    );
    expect(replay.created).toBe(false);
    expect(replay.run.id).toBe(queued.run.id);
    expect(await db.select().from(workflowRuns)).toHaveLength(1);
  });
  it("requires deliberate removal of parent workflow draft references before retirement", async () => {
    const detail = await seed();
    const svc = workflowService(db);
    const parent = await svc.create(
      detail.companyId,
      { name: "Parent" },
      native,
    );
    await svc.updateDraft(
      detail.companyId,
      parent.id,
      {
        expectedRevisionId: parent.draftRevisionId!,
        graph: {
          version: 1,
          nodes: [
            {
              id: "child",
              name: "Child",
              type: "core.subworkflow",
              config: {
                workflowId: detail.id,
                revisionId: detail.publishedRevisionId,
              },
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
          variables: [],
          settings: {},
        },
      },
      native,
    );
    await http().post(path(detail)).send(command(detail, "pause")).expect(200);
    await http()
      .post(path(detail))
      .send(command(await current(detail), "retire"))
      .expect(409)
      .expect((response) =>
        expect(response.body.details.code).toBe("workflow_bindings_present"),
      );
  });
  it("rejects account/company/agent mismatches and feature rollback without applying a change", async () => {
    const detail = await seed();
    const input = command(detail, "pause");
    await http().post(path(detail, "another-user")).send(input).expect(409);
    await http()
      .post(path({ ...detail, companyId: randomUUID() }))
      .send(input)
      .expect(404);
    await http({
      type: "agent",
      companyId: detail.companyId,
      agentId: randomUUID(),
      source: "agent_key",
    })
      .post(path(detail))
      .send(input)
      .expect(403);
    await instanceSettingsService(db).updateExperimental({
      progressive_shell_v9: false,
    });
    await http().post(path(detail)).send(input).expect(404);
    expect((await current(detail)).status).toBe("active");
  });
  it("rechecks current native publication grants on mutation and on replay", async () => {
    const detail = await seed();
    const userId = "current-operator";
    await db.insert(companyMemberships).values({
      companyId: detail.companyId,
      principalType: "user",
      principalId: userId,
      membershipRole: "viewer",
      status: "active",
    });
    const user: Express.Request["actor"] = {
      type: "board",
      source: "session",
      userId,
      companyIds: [detail.companyId],
      memberships: [
        {
          companyId: detail.companyId,
          membershipRole: "viewer",
          status: "active",
        },
      ],
      isInstanceAdmin: false,
    };
    const input = command(detail, "pause");
    await http(user).post(path(detail, userId)).send(input).expect(403);
    await db.insert(principalPermissionGrants).values(
      ["workflows:read", "workflows:publish"].map((permissionKey) => ({
        companyId: detail.companyId,
        principalType: "user",
        principalId: userId,
        permissionKey,
      })),
    );
    await http(user).post(path(detail, userId)).send(input).expect(200);
    await db
      .delete(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.principalId, userId),
          eq(principalPermissionGrants.permissionKey, "workflows:publish"),
        ),
      );
    await http(user).post(path(detail, userId)).send(input).expect(403);
    expect((await current(detail)).status).toBe("paused");
  });
});
