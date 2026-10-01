import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  companyMemberships,
  createDb,
  instanceSettings,
  issues,
  principalPermissionGrants,
  workflowRevisions,
  workflowRuns,
  workflowStepRuns,
  workflows,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/error-handler.js";
import { workflowRoutes } from "../routes/workflows.js";
import { instanceSettingsService } from "../services/instance-settings.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

describePg("Workflow routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-workflow-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(workflowStepRuns);
    await db.delete(workflowRuns);
    // Workflow is the lifecycle owner. Deleting it is the supported path that
    // cascades immutable revision history through the DB guard.
    await db.delete(workflows);
    await db.delete(workflowRevisions);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(instanceSettings);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function app(actor: Express.Request["actor"]) {
    const instance = express();
    instance.use(express.json());
    instance.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    instance.use("/api", workflowRoutes(db));
    instance.use(errorHandler);
    return instance;
  }

  async function seedCompany(name = "Workflow Co") {
    const [company] = await db.insert(companies).values({
      name,
      issuePrefix: `W${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    }).returning();
    return company!;
  }

  async function enableWorkflows() {
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true });
  }

  const localBoard: Express.Request["actor"] = {
    type: "board",
    userId: "board",
    source: "local_implicit",
    isInstanceAdmin: true,
  };

  it("fails closed while Workflows V1 is disabled", async () => {
    const company = await seedCompany();
    await request(app(localBoard))
      .get(`/api/companies/${company.id}/workflows`)
      .expect(404)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: "Workflows are not enabled",
          details: { code: "workflows_disabled" },
        });
      });
  });

  it("creates, reads, updates, publishes, and audits a valid manual workflow", async () => {
    const company = await seedCompany();
    await enableWorkflows();
    const http = request(app(localBoard));

    const created = await http
      .post(`/api/companies/${company.id}/workflows`)
      .send({ name: "Lead qualification", description: "Qualify leads" })
      .expect(201);

    const updated = await http
      .patch(`/api/companies/${company.id}/workflows/${created.body.id}/draft`)
      .send({
        expectedRevisionId: created.body.draftRevisionId,
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
          variables: [{ name: "leadId" }],
          settings: {},
        },
        changeSummary: "Add manual trigger and lead variable",
      })
      .expect(200);

    const published = await http
      .post(`/api/companies/${company.id}/workflows/${created.body.id}/publish`)
      .send({
        expectedDraftRevisionId: updated.body.draftRevisionId,
        expectedPublishedRevisionId: null,
        approvalId: null,
      })
      .expect(200);

    expect(published.body.publishedRevision).toMatchObject({ state: "published" });
    expect(published.body.draftRevision).toMatchObject({ state: "draft" });

    const revisions = await http
      .get(`/api/companies/${company.id}/workflows/${created.body.id}/revisions`)
      .expect(200);
    expect(revisions.body.map((item: { state: string }) => item.state))
      .toEqual(["draft", "published", "discarded"]);

    const actions = (await db.select().from(activityLog)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining([
      "workflow.created",
      "workflow.draft_updated",
      "workflow.revision_published",
    ]));
  });

  it("uses effective permissions for normal session users", async () => {
    const company = await seedCompany();
    await enableWorkflows();
    const userId = "viewer-user";
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "viewer",
    });
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      permissionKey: "workflows:read",
      scope: null,
    });
    const actor: Express.Request["actor"] = {
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [company.id],
      memberships: [{ companyId: company.id, membershipRole: "viewer", status: "active" }],
    };
    const http = request(app(actor));

    await http.get(`/api/companies/${company.id}/workflows`).expect(200);
    const capabilities = await http
      .get(`/api/companies/${company.id}/workflows/capabilities`)
      .expect(200);
    expect(capabilities.body).toEqual({
      read: true,
      edit: false,
      publish: false,
      run: false,
    });

    await http
      .post(`/api/companies/${company.id}/workflows`)
      .send({ name: "Denied create" })
      .expect(403)
      .expect((response) => {
        expect(response.body).toEqual({
          error: "Viewer access is read-only",
        });
      });
  });

  it("does not expose a workflow through another company route", async () => {
    const alpha = await seedCompany("Alpha");
    const beta = await seedCompany("Beta");
    await enableWorkflows();
    const http = request(app(localBoard));
    const created = await http
      .post(`/api/companies/${alpha.id}/workflows`)
      .send({ name: "Alpha workflow" })
      .expect(201);

    await http
      .get(`/api/companies/${beta.id}/workflows/${created.body.id}`)
      .expect(404);
  });
  it("does not advertise human-only Workflow mutations to agents", async () => {
    const company = await seedCompany();
    await enableWorkflows();
    const [agent] = await db.insert(agents).values({
      companyId: company.id,
      name: "Workflow Agent",
      role: "analyst",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "agent",
      principalId: agent!.id,
      status: "active",
      membershipRole: "member",
    });
    await db.insert(principalPermissionGrants).values([
      {
        companyId: company.id,
        principalType: "agent",
        principalId: agent!.id,
        permissionKey: "workflows:read",
        scope: null,
      },
      {
        companyId: company.id,
        principalType: "agent",
        principalId: agent!.id,
        permissionKey: "workflows:edit",
        scope: null,
      },
      {
        companyId: company.id,
        principalType: "agent",
        principalId: agent!.id,
        permissionKey: "workflows:publish",
        scope: null,
      },
      {
        companyId: company.id,
        principalType: "agent",
        principalId: agent!.id,
        permissionKey: "workflows:run",
        scope: null,
      },
    ]);

    const response = await request(app({
      type: "agent",
      agentId: agent!.id,
      companyId: company.id,
      source: "agent_key",
      keyId: "workflow-agent-key",
    }))
      .get(`/api/companies/${company.id}/workflows/capabilities`)
      .expect(200);

    expect(response.body).toEqual({
      read: true,
      edit: false,
      publish: false,
      run: true,
    });
  });

  it("keeps optimizer suggestions read-only and feature-gated", async () => {
    const company = await seedCompany();
    await enableWorkflows();
    const workflow = await request(app(localBoard))
      .post(`/api/companies/${company.id}/workflows`)
      .send({ name: "Optimizer evidence workflow" })
      .expect(201);

    await request(app(localBoard))
      .get(
        `/api/companies/${company.id}/workflows/${workflow.body.id}/optimizer-suggestions`,
      )
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          state: "disabled",
          workflowId: workflow.body.id,
          terminalRunCount: 0,
          suggestions: [],
        });
      });

    await instanceSettingsService(db).updateExperimental({
      enableWorkflowOptimizerSuggestions: true,
    });

    await request(app(localBoard))
      .get(
        `/api/companies/${company.id}/workflows/${workflow.body.id}/optimizer-suggestions`,
      )
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          state: "no_published_revision",
          workflowId: workflow.body.id,
          terminalRunCount: 0,
          suggestions: [],
        });
      });
  });

  it("exposes the typed Node Registry to authorized readers", async () => {
    const company = await seedCompany();
    await enableWorkflows();

    const response = await request(app(localBoard))
      .get(`/api/companies/${company.id}/workflows/node-registry`)
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "core.manual_trigger",
          sideEffectClass: "pure",
          publishState: "ready",
        }),
        expect.objectContaining({
          type: "connector.action",
          publishState: "draft_only",
        }),
      ]),
    );
  });

  it("searches deterministic Workflow capabilities for authorized readers", async () => {
    const company = await seedCompany();
    await enableWorkflows();

    const response = await request(app(localBoard))
      .get(`/api/companies/${company.id}/workflows/capability-search`)
      .query({ q: "condition", limit: 10 })
      .expect(200);

    expect(response.body).toMatchObject({
      query: "condition",
      candidates: [
        expect.objectContaining({
          id: "core:core.condition",
          kind: "core_node",
          nodeType: "core.condition",
          executionMode: "deterministic",
          availability: { status: "available", reason: null },
        }),
      ],
    });
  });

  it("advertises run capability once the manual durable executor exists", async () => {
    const company = await seedCompany();
    await enableWorkflows();

    const response = await request(app(localBoard))
      .get(`/api/companies/${company.id}/workflows/capabilities`)
      .expect(200);

    expect(response.body).toMatchObject({
      read: true,
      edit: true,
      publish: true,
      run: true,
    });
  });

  it("builds a deterministic Data Selector model for the current unsaved graph", async () => {
    const company = await seedCompany();
    await enableWorkflows();

    const response = await request(app(localBoard))
      .post(`/api/companies/${company.id}/workflows/data-selector`)
      .send({
        graph: {
          version: 1,
          nodes: [
            {
              id: "start",
              type: "core.manual_trigger",
              name: "Manual start",
              position: { x: 0, y: 0 },
              config: {},
            },
            {
              id: "target",
              type: "core.condition",
              name: "Check",
              position: { x: 100, y: 0 },
              config: { expression: "true" },
            },
          ],
          edges: [{ id: "edge", source: "start", target: "target" }],
          variables: [{ name: "threshold", required: true, defaultValue: 10 }],
          settings: {},
        },
        targetNodeId: "target",
        inputSchema: {
          type: "object",
          properties: { leadId: { type: "string" } },
        },
      })
      .expect(200);

    expect(response.body.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "variables",
          fields: [
            expect.objectContaining({ expression: "{{variables.threshold}}" }),
          ],
        }),
        expect.objectContaining({
          id: "trigger:start",
          fields: [
            expect.objectContaining({ expression: "{{trigger.leadId}}" }),
          ],
        }),
      ]),
    );
  });

  it("starts an idempotent manual Workflow run only from a published revision", async () => {
    const company = await seedCompany();
    await enableWorkflows();
    const http = request(app(localBoard));
    const created = await http
      .post(`/api/companies/${company.id}/workflows`)
      .send({ name: "Runnable" })
      .expect(201);
    const updated = await http
      .patch(`/api/companies/${company.id}/workflows/${created.body.id}/draft`)
      .send({
        expectedRevisionId: created.body.draftRevisionId,
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
      })
      .expect(200);
    await http
      .post(`/api/companies/${company.id}/workflows/${created.body.id}/publish`)
      .send({
        expectedDraftRevisionId: updated.body.draftRevisionId,
        expectedPublishedRevisionId: null,
        approvalId: null,
      })
      .expect(200);

    const first = await http
      .post(`/api/companies/${company.id}/workflows/${created.body.id}/run`)
      .set("Idempotency-Key", "route-manual-1")
      .send({ input: { customerId: "c-1" } })
      .expect(201);
    expect(first.body.run.status).toBe("succeeded");
    expect(first.body.steps).toHaveLength(1);

    const repeated = await http
      .post(`/api/companies/${company.id}/workflows/${created.body.id}/run`)
      .set("Idempotency-Key", "route-manual-1")
      .send({ input: { customerId: "c-1" } })
      .expect(201);
    expect(repeated.body.run.id).toBe(first.body.run.id);

    await http
      .get(`/api/companies/${company.id}/workflow-runs/${first.body.run.id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.run.workflowId).toBe(created.body.id);
      });

    await http
      .get(`/api/companies/${company.id}/workflows/${created.body.id}/runs?limit=20`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(1);
        expect(response.body[0]).toMatchObject({
          id: first.body.run.id,
          workflowId: created.body.id,
          status: "succeeded",
          source: "manual",
        });
      });
  });

  it("retries a failed Workflow run through HTTP with immutable lineage and request idempotency", async () => {
    const company = await seedCompany();
    await enableWorkflows();
    const http = request(app(localBoard));

    const created = await http
      .post(`/api/companies/${company.id}/workflows`)
      .send({ name: "Retryable route workflow" })
      .expect(201);
    const updated = await http
      .patch(`/api/companies/${company.id}/workflows/${created.body.id}/draft`)
      .send({
        expectedRevisionId: created.body.draftRevisionId,
        graph: {
          version: 1,
          nodes: [
            {
              id: "start",
              type: "core.manual_trigger",
              name: "Manual start",
              position: { x: 0, y: 0 },
              config: {},
            },
            {
              id: "fail",
              type: "core.condition",
              name: "Missing input",
              position: { x: 180, y: 0 },
              config: { expression: "{{trigger.missing}}" },
            },
          ],
          edges: [{ id: "e1", source: "start", target: "fail" }],
          variables: [],
          settings: {},
        },
      })
      .expect(200);
    await http
      .post(`/api/companies/${company.id}/workflows/${created.body.id}/publish`)
      .send({
        expectedDraftRevisionId: updated.body.draftRevisionId,
        expectedPublishedRevisionId: null,
        approvalId: null,
      })
      .expect(200);

    const failed = await http
      .post(`/api/companies/${company.id}/workflows/${created.body.id}/run`)
      .set("Idempotency-Key", "route-retry-source")
      .send({ input: { accountId: "acme" } })
      .expect(201);
    expect(failed.body.run.status).toBe("failed");

    await http
      .post(
        `/api/companies/${company.id}/workflow-runs/${failed.body.run.id}/retry`,
      )
      .send({ reason: "Retry exact historical run" })
      .expect(422)
      .expect((response) => {
        expect(response.body.details?.code ?? response.body.code).toBe(
          "idempotency_key_required",
        );
      });

    const retried = await http
      .post(
        `/api/companies/${company.id}/workflow-runs/${failed.body.run.id}/retry`,
      )
      .set("Idempotency-Key", "route-retry-request")
      .send({ reason: "Retry exact historical run" })
      .expect(201);

    expect(retried.body.run.id).not.toBe(failed.body.run.id);
    expect(retried.body.run).toMatchObject({
      status: "failed",
      workflowRevisionId: failed.body.run.workflowRevisionId,
      triggerPayload: failed.body.run.triggerPayload,
      retryOfRunId: failed.body.run.id,
      idempotencyRootRunId: failed.body.run.id,
      source: "manual",
    });

    const replay = await http
      .post(
        `/api/companies/${company.id}/workflow-runs/${failed.body.run.id}/retry`,
      )
      .set("Idempotency-Key", "route-retry-request")
      .send({ reason: "Retry exact historical run" })
      .expect(201);
    expect(replay.body.run.id).toBe(retried.body.run.id);

    const actions = (await db.select().from(activityLog)).map(
      (row) => row.action,
    );
    expect(
      actions.filter((action) => action === "workflow.run_retry_created"),
    ).toHaveLength(1);
  });

  it("invokes a published Workflow from an active task with authoritative task context and idempotency", async () => {
    const company = await seedCompany();
    await enableWorkflows();
    const http = request(app(localBoard));
    const created = await http
      .post(`/api/companies/${company.id}/workflows`)
      .send({ name: "Task helper" })
      .expect(201);
    const updated = await http
      .patch(`/api/companies/${company.id}/workflows/${created.body.id}/draft`)
      .send({
        expectedRevisionId: created.body.draftRevisionId,
        graph: {
          version: 1,
          nodes: [{
            id: "start",
            type: "core.manual_trigger",
            name: "Task start",
            position: { x: 0, y: 0 },
            config: {},
          }],
          edges: [],
          variables: [],
          settings: {},
        },
      })
      .expect(200);
    await http
      .post(`/api/companies/${company.id}/workflows/${created.body.id}/publish`)
      .send({
        expectedDraftRevisionId: updated.body.draftRevisionId,
        expectedPublishedRevisionId: null,
        approvalId: null,
      })
      .expect(200);

    const [task] = await db.insert(issues).values({
      companyId: company.id,
      title: "Prepare onboarding",
      status: "todo",
      assigneeUserId: "board",
      responsibleUserId: "board",
    }).returning();

    const first = await http
      .post(
        `/api/companies/${company.id}/issues/${task!.id}/workflows/${created.body.id}/run`,
      )
      .set("Idempotency-Key", "task-workflow-route-1")
      .send({
        input: {
          customerId: "customer-1",
          task: { id: "spoofed", title: "Spoofed task" },
        },
      })
      .expect(201);

    expect(first.body.run).toMatchObject({
      workflowId: created.body.id,
      source: "task",
      status: "succeeded",
    });
    expect(first.body.run.triggerPayload).toMatchObject({
      customerId: "customer-1",
      task: {
        id: task!.id,
        title: "Prepare onboarding",
        status: "todo",
        assigneeUserId: "board",
      },
    });
    expect(first.body.run.triggerPayload.task.id).not.toBe("spoofed");

    const replay = await http
      .post(
        `/api/companies/${company.id}/issues/${task!.id}/workflows/${created.body.id}/run`,
      )
      .set("Idempotency-Key", "task-workflow-route-1")
      .send({
        input: {
          customerId: "customer-1",
          task: { id: "different-spoof" },
        },
      })
      .expect(201);
    expect(replay.body.run.id).toBe(first.body.run.id);

    const actions = (await db.select().from(activityLog)).map((row) => row.action);
    expect(actions).toContain("workflow.task_invoked");
  });

  it("does not invoke a Workflow through a task from another company", async () => {
    const alpha = await seedCompany("Task Alpha");
    const beta = await seedCompany("Task Beta");
    await enableWorkflows();
    const http = request(app(localBoard));
    const workflow = await http
      .post(`/api/companies/${beta.id}/workflows`)
      .send({ name: "Beta workflow" })
      .expect(201);
    const [foreignTask] = await db.insert(issues).values({
      companyId: alpha.id,
      title: "Alpha task",
      status: "todo",
    }).returning();

    await http
      .post(
        `/api/companies/${beta.id}/issues/${foreignTask!.id}/workflows/${workflow.body.id}/run`,
      )
      .send({ input: {} })
      .expect(404);
  });

  it("requires task mutation access before using a task to invoke a Workflow", async () => {
    const company = await seedCompany();
    await enableWorkflows();
    const workflow = await request(app(localBoard))
      .post(`/api/companies/${company.id}/workflows`)
      .send({ name: "Restricted task workflow" })
      .expect(201);

    const userId = "task-viewer";
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "viewer",
    });
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      permissionKey: "workflows:run",
      scope: null,
    });
    const [task] = await db.insert(issues).values({
      companyId: company.id,
      title: "Visible but not mutable",
      status: "todo",
    }).returning();
    const actor: Express.Request["actor"] = {
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [company.id],
      memberships: [{
        companyId: company.id,
        membershipRole: "viewer",
        status: "active",
      }],
    };

    await request(app(actor))
      .post(
        `/api/companies/${company.id}/issues/${task!.id}/workflows/${workflow.body.id}/run`,
      )
      .send({ input: {} })
      .expect(403)
      .expect((response) => {
        expect(response.body).toEqual({
          error: "Viewer access is read-only",
        });
      });
  });

  it("refuses Task to Workflow invocation after the task is terminal", async () => {
    const company = await seedCompany();
    await enableWorkflows();
    const workflow = await request(app(localBoard))
      .post(`/api/companies/${company.id}/workflows`)
      .send({ name: "Terminal task workflow" })
      .expect(201);
    const [task] = await db.insert(issues).values({
      companyId: company.id,
      title: "Already done",
      status: "done",
      completedAt: new Date(),
    }).returning();

    await request(app(localBoard))
      .post(
        `/api/companies/${company.id}/issues/${task!.id}/workflows/${workflow.body.id}/run`,
      )
      .send({ input: {} })
      .expect(422)
      .expect((response) => {
        expect(response.body.code).toBe("workflow_task_not_active");
      });
  });

});
