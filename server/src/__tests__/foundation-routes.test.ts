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
  documentRevisions,
  documents,
  foundationChangeProposals,
  foundationDocuments,
  foundationSections,
  instanceSettings,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/error-handler.js";
import { foundationRoutes } from "../routes/foundation.js";
import { instanceSettingsService } from "../services/instance-settings.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;

describeEmbeddedPostgres("Foundation routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-foundation-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(foundationChangeProposals);
    await db.delete(foundationSections);
    await db.delete(foundationDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
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
    instance.use("/api", foundationRoutes(db));
    instance.use(errorHandler);
    return instance;
  }

  async function seedCompany(name = "Foundation Co") {
    const [company] = await db
      .insert(companies)
      .values({
        name,
        issuePrefix: `F${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      })
      .returning();
    return company!;
  }

  async function enableFoundation() {
    await instanceSettingsService(db).updateExperimental({ enableFoundationV1: true });
  }

  const boardActor: Express.Request["actor"] = {
    type: "board",
    userId: "board-user",
    source: "local_implicit",
    isInstanceAdmin: true,
  };

  it("fails closed while the Foundation feature flag is disabled", async () => {
    const company = await seedCompany();
    await request(app(boardActor))
      .get(`/api/companies/${company.id}/foundation`)
      .expect(404)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: "Foundation is not enabled",
          details: { code: "foundation_disabled" },
        });
      });
  });

  it("supports the governed draft-review-approval API and audit trail", async () => {
    const company = await seedCompany();
    await enableFoundation();
    const http = request(app(boardActor));

    const created = await http
      .post(`/api/companies/${company.id}/foundation`)
      .send({
        foundationKey: "company-profile",
        category: "company",
        documentType: "company_profile",
        title: "Company profile",
        body: "Initial company truth",
      })
      .expect(201);

    await http.get(`/api/companies/${company.id}/foundation`).expect(200);
    await http
      .get(`/api/companies/${company.id}/foundation/${created.body.id}`)
      .expect(200);

    const edited = await http
      .patch(`/api/companies/${company.id}/foundation/${created.body.id}/draft`)
      .send({
        baseRevisionId: created.body.latestRevisionId,
        body: "Reviewed company truth",
        sensitivity: "confidential",
      })
      .expect(200);

    const submitted = await http
      .post(`/api/companies/${company.id}/foundation/${created.body.id}/submit`)
      .send({ expectedRevisionId: edited.body.latestRevisionId })
      .expect(200);
    expect(submitted.body.status).toBe("in_review");

    const approved = await http
      .post(`/api/companies/${company.id}/foundation/${created.body.id}/approve`)
      .send({ expectedRevisionId: submitted.body.latestRevisionId })
      .expect(200);
    expect(approved.body.status).toBe("approved");
    expect(approved.body.canonicalRevision.body).toBe("Reviewed company truth");
    expect(approved.body.canonicalGovernance.sensitivity).toBe("confidential");

    const actions = (await db.select().from(activityLog)).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "foundation.document_created",
        "foundation.draft_updated",
        "foundation.revision_proposed",
        "foundation.revision_approved",
      ]),
    );
  });

  it("allows agents to propose changes but not access Foundation drafts directly", async () => {
    const company = await seedCompany();
    await enableFoundation();
    const board = request(app(boardActor));
    const created = await board
      .post(`/api/companies/${company.id}/foundation`)
      .send({
        foundationKey: "strategy",
        category: "strategy",
        documentType: "strategy",
        body: "Current strategy",
      })
      .expect(201);

    const [agent] = await db
      .insert(agents)
      .values({
        companyId: company.id,
        name: "Strategy Agent",
        role: "analyst",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      })
      .returning();

    const agentActor: Express.Request["actor"] = {
      type: "agent",
      agentId: agent!.id,
      companyId: company.id,
      source: "agent_key",
      keyId: "test-key",
      runId: "test-run",
    };
    const agentHttp = request(app(agentActor));

    await agentHttp
      .get(`/api/companies/${company.id}/foundation`)
      .expect(403);

    const proposal = await agentHttp
      .post(`/api/companies/${company.id}/foundation/${created.body.id}/proposals`)
      .send({
        sourceType: "agent_run",
        proposedBody: "Proposed strategy",
        reason: "New evidence",
      })
      .expect(201);
    expect(proposal.body).toMatchObject({
      foundationDocumentId: created.body.id,
      proposedByAgentId: agent!.id,
      status: "pending",
    });

    const unchanged = await board
      .get(`/api/companies/${company.id}/foundation/${created.body.id}`)
      .expect(200);
    expect(unchanged.body.body).toBe("Current strategy");
  });

  it("does not expose one company's Foundation through another company scope", async () => {
    const alpha = await seedCompany("Alpha");
    const beta = await seedCompany("Beta");
    await enableFoundation();
    const board = request(app(boardActor));

    const created = await board
      .post(`/api/companies/${alpha.id}/foundation`)
      .send({
        foundationKey: "company-profile",
        category: "company",
        documentType: "company_profile",
        body: "Alpha truth",
      })
      .expect(201);

    await board
      .get(`/api/companies/${beta.id}/foundation/${created.body.id}`)
      .expect(404);
  });
});
