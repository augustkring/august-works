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
  principalPermissionGrants,
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

    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "agent",
      principalId: agent!.id,
      status: "active",
      membershipRole: "member",
    });
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "agent",
      principalId: agent!.id,
      permissionKey: "foundation:propose",
      scope: null,
    });

    const agentActor: Express.Request["actor"] = {
      type: "agent",
      agentId: agent!.id,
      companyId: company.id,
      source: "agent_key",
      keyId: "test-key",
      runId: randomUUID(),
    };
    const agentHttp = request(app(agentActor));

    await agentHttp
      .get(`/api/companies/${company.id}/foundation`)
      .expect(403)
      .expect((response) => {
        expect(response.body.code).toBe("permission_denied");
      });

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
  it("rejects agent proposals without an explicit Foundation grant", async () => {
    const company = await seedCompany();
    await enableFoundation();
    const board = request(app(boardActor));
    const created = await board
      .post(`/api/companies/${company.id}/foundation`)
      .send({
        foundationKey: "operating-model",
        category: "operating_model",
        documentType: "operating_model",
        body: "Current model",
      })
      .expect(201);

    const [agent] = await db
      .insert(agents)
      .values({
        companyId: company.id,
        name: "Unprivileged Agent",
        role: "analyst",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      })
      .returning();
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "agent",
      principalId: agent!.id,
      status: "active",
      membershipRole: "member",
    });

    const response = await request(app({
      type: "agent",
      agentId: agent!.id,
      companyId: company.id,
      source: "agent_key",
      keyId: "test-key",
      runId: randomUUID(),
    }))
      .post(`/api/companies/${company.id}/foundation/${created.body.id}/proposals`)
      .send({ sourceType: "agent_run", proposedBody: "Unauthorized proposal" })
      .expect(403);

    expect(response.body.code).toBe("permission_denied");
    expect(await db.select().from(foundationChangeProposals)).toHaveLength(0);
  });

  it("lists Foundation revision history and accepts a current proposal into draft", async () => {
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
    const proposal = await board
      .post(`/api/companies/${company.id}/foundation/${created.body.id}/proposals`)
      .send({ sourceType: "user", proposedBody: "Next strategy" })
      .expect(201);

    const accepted = await board
      .post(`/api/companies/${company.id}/foundation/${created.body.id}/proposals/${proposal.body.id}/accept`)
      .send({})
      .expect(200);
    expect(accepted.body.foundation).toMatchObject({
      status: "draft",
      body: "Next strategy",
      latestRevisionNumber: 2,
    });

    const revisions = await board
      .get(`/api/companies/${company.id}/foundation/${created.body.id}/revisions`)
      .expect(200);
    expect(revisions.body.map((item: { revisionNumber: number }) => item.revisionNumber)).toEqual([2, 1]);
  });

  it("requires an explicit Foundation read grant for normal session users", async () => {
    const company = await seedCompany();
    await enableFoundation();
    const userId = "session-user";
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "viewer",
    });
    const sessionActor: Express.Request["actor"] = {
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [company.id],
      memberships: [{ companyId: company.id, membershipRole: "viewer", status: "active" }],
    };

    await request(app(sessionActor))
      .get(`/api/companies/${company.id}/foundation`)
      .expect(403)
      .expect((response) => {
        expect(response.body.code).toBe("permission_denied");
      });

    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: userId,
      permissionKey: "foundation:read",
      scope: null,
    });

    await request(app(sessionActor))
      .get(`/api/companies/${company.id}/foundation`)
      .expect(200);
  });

  it("returns only approved canonical Foundation content to an agent with read access", async () => {
    const company = await seedCompany();
    await enableFoundation();
    const board = request(app(boardActor));

    const governed = await board
      .post(`/api/companies/${company.id}/foundation`)
      .send({
        foundationKey: "governed-strategy",
        category: "strategy",
        documentType: "strategy",
        body: "Approved strategy",
        sensitivity: "internal",
      })
      .expect(201);
    const submitted = await board
      .post(`/api/companies/${company.id}/foundation/${governed.body.id}/submit`)
      .send({ expectedRevisionId: governed.body.latestRevisionId })
      .expect(200);
    const approved = await board
      .post(`/api/companies/${company.id}/foundation/${governed.body.id}/approve`)
      .send({ expectedRevisionId: submitted.body.latestRevisionId })
      .expect(200);

    await board
      .patch(`/api/companies/${company.id}/foundation/${governed.body.id}/draft`)
      .send({
        baseRevisionId: approved.body.latestRevisionId,
        body: "Unapproved future strategy",
        sensitivity: "restricted",
      })
      .expect(200);

    await board
      .post(`/api/companies/${company.id}/foundation`)
      .send({
        foundationKey: "never-approved",
        category: "strategy",
        documentType: "strategy",
        body: "Draft only",
      })
      .expect(201);

    const [agent] = await db
      .insert(agents)
      .values({
        companyId: company.id,
        name: "Reader Agent",
        role: "analyst",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      })
      .returning();
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "agent",
      principalId: agent!.id,
      status: "active",
      membershipRole: "member",
    });
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "agent",
      principalId: agent!.id,
      permissionKey: "foundation:read",
      scope: null,
    });

    const agentHttp = request(app({
      type: "agent",
      agentId: agent!.id,
      companyId: company.id,
      source: "agent_key",
      keyId: "read-key",
      runId: randomUUID(),
    }));

    const list = await agentHttp
      .get(`/api/companies/${company.id}/foundation`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: governed.body.id,
      body: "Approved strategy",
      sensitivity: "internal",
      status: "approved",
      latestRevisionId: approved.body.approvedRevisionId,
    });

    const detail = await agentHttp
      .get(`/api/companies/${company.id}/foundation/${governed.body.id}`)
      .expect(200);
    expect(detail.body).toMatchObject({
      body: "Approved strategy",
      sensitivity: "internal",
      status: "approved",
    });

    const draftOnly = await db
      .select({ id: foundationDocuments.id })
      .from(foundationDocuments)
      .where(eq(foundationDocuments.foundationKey, "never-approved"))
      .then((rows) => rows[0]!);
    await agentHttp
      .get(`/api/companies/${company.id}/foundation/${draftOnly.id}`)
      .expect(404);
  });

  it("blocks agents from working-scope search, revision history, and proposal review data", async () => {
    const company = await seedCompany();
    await enableFoundation();
    const board = request(app(boardActor));
    const created = await board
      .post(`/api/companies/${company.id}/foundation`)
      .send({
        foundationKey: "agent-boundary",
        category: "company",
        documentType: "company_profile",
        body: "Canonical candidate",
      })
      .expect(201);

    const [agent] = await db
      .insert(agents)
      .values({
        companyId: company.id,
        name: "Scoped Reader",
        role: "analyst",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      })
      .returning();
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "agent",
      principalId: agent!.id,
      status: "active",
      membershipRole: "member",
    });
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "agent",
      principalId: agent!.id,
      permissionKey: "foundation:read",
      scope: null,
    });
    const agentHttp = request(app({
      type: "agent",
      agentId: agent!.id,
      companyId: company.id,
      source: "agent_key",
      keyId: "read-key",
      runId: randomUUID(),
    }));

    await agentHttp
      .get(`/api/companies/${company.id}/foundation/search`)
      .query({ q: "Canonical", scope: "working" })
      .expect(403)
      .expect((response) => {
        expect(response.body.code).toBe("permission_denied");
      });

    await agentHttp
      .get(`/api/companies/${company.id}/foundation/${created.body.id}/revisions`)
      .expect(403);

    await agentHttp
      .get(`/api/companies/${company.id}/foundation/${created.body.id}/proposals`)
      .expect(403);
  });

  it("reports effective Foundation capabilities for a scoped session user", async () => {
    const company = await seedCompany();
    await enableFoundation();
    const userId = "capability-viewer";
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
      permissionKey: "foundation:read",
      scope: null,
    });

    const response = await request(app({
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [company.id],
      memberships: [{ companyId: company.id, membershipRole: "viewer", status: "active" }],
    }))
      .get(`/api/companies/${company.id}/foundation/capabilities`)
      .expect(200);

    expect(response.body).toEqual({
      read: true,
      propose: false,
      edit: false,
      approve: false,
    });
  });

});
