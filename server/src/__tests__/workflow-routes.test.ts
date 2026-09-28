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
    await db.delete(workflowStepRuns);
    await db.delete(workflowRuns);
    await db.delete(workflowRevisions);
    await db.delete(workflows);
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
        expect(response.body.code).toBe("permission_denied");
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
      runId: "workflow-agent-run",
    }))
      .get(`/api/companies/${company.id}/workflows/capabilities`)
      .expect(200);

    expect(response.body).toEqual({
      read: true,
      edit: false,
      publish: false,
      run: false,
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

  it("does not advertise run capability before the durable executor exists", async () => {
    const company = await seedCompany();
    await enableWorkflows();

    const response = await request(app(localBoard))
      .get(`/api/companies/${company.id}/workflows/capabilities`)
      .expect(200);

    expect(response.body).toMatchObject({
      read: true,
      edit: true,
      publish: true,
      run: false,
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
  });

});
