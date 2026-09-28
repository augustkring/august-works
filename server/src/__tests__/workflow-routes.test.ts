import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  companyMemberships,
  createDb,
  instanceSettings,
  principalPermissionGrants,
  workflowRevisions,
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
    await db.delete(workflowRevisions);
    await db.delete(workflows);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
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

  it("creates, reads, updates, publishes, and audits an empty workflow", async () => {
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
          nodes: [],
          edges: [],
          variables: [{ name: "leadId" }],
          settings: {},
        },
        changeSummary: "Add lead variable",
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
});
