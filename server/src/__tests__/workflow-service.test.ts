import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  projects,
  workflowRevisions,
  workflows,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { workflowService } from "../services/workflows/workflow-service.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

describePg("Workflow service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-workflow-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(workflowRevisions);
    await db.delete(workflows);
    await db.delete(projects);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name: string) {
    const id = randomUUID();
    const userId = `user-${id}`;
    await db.insert(companies).values({
      id,
      name,
      issuePrefix: `W${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: userId,
    });
    await db.insert(companyMemberships).values({
      companyId: id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    return { id, userId };
  }

  function actor(userId: string) {
    return { principal: { type: "user" as const, userId } };
  }

  async function createWorkflow(companyId: string, userId: string, projectId?: string | null) {
    return workflowService(db).create(
      companyId,
      {
        name: "Lead qualification",
        description: "Qualify inbound leads",
        projectId: projectId ?? null,
      },
      actor(userId),
    );
  }

  it("creates one tenant-scoped immutable draft snapshot", async () => {
    const company = await seedCompany("Alpha");
    const created = await createWorkflow(company.id, company.userId);

    expect(created).toMatchObject({
      companyId: company.id,
      name: "Lead qualification",
      status: "active",
      publishedRevisionId: null,
    });
    expect(created.draftRevision).toMatchObject({
      revisionNumber: 1,
      state: "draft",
      graph: { version: 1, nodes: [], edges: [], variables: [], settings: {} },
    });
    expect(await db.select().from(workflowRevisions)).toHaveLength(1);
  });

  it("rejects cross-company project references", async () => {
    const alpha = await seedCompany("Alpha");
    const beta = await seedCompany("Beta");
    const [project] = await db.insert(projects).values({
      companyId: beta.id,
      name: "Beta project",
    }).returning();

    await expect(
      createWorkflow(alpha.id, alpha.userId, project!.id),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({ code: "cross_company_reference" }),
    });
  });

  it("creates a new draft snapshot and discards the previous draft", async () => {
    const company = await seedCompany("Alpha");
    const svc = workflowService(db);
    const created = await createWorkflow(company.id, company.userId);

    const updated = await svc.updateDraft(
      company.id,
      created.id,
      {
        expectedRevisionId: created.draftRevisionId!,
        graph: {
          version: 1,
          nodes: [{
            id: "start",
            type: "core.manual_trigger",
            name: "Start",
            position: { x: 0, y: 0 },
            config: {},
          }],
          edges: [],
          variables: [],
          settings: {},
        },
        changeSummary: "Add manual trigger",
      },
      actor(company.userId),
    );

    expect(updated.draftRevision).toMatchObject({ revisionNumber: 2, state: "draft" });
    expect(await svc.listRevisions(company.id, created.id)).toEqual([
      expect.objectContaining({ revisionNumber: 2, state: "draft" }),
      expect.objectContaining({ revisionNumber: 1, state: "discarded" }),
    ]);
  });

  it("allows exactly one concurrent writer for one expected draft revision", async () => {
    const company = await seedCompany("Alpha");
    const svc = workflowService(db);
    const created = await createWorkflow(company.id, company.userId);
    const baseRevisionId = created.draftRevisionId!;

    const patch = (name: string) => ({
      expectedRevisionId: baseRevisionId,
      graph: {
        version: 1 as const,
        nodes: [{
          id: "start",
          type: "core.manual_trigger",
          name,
          position: { x: 0, y: 0 },
          config: {},
        }],
        edges: [],
        variables: [],
        settings: {},
      },
    });

    const settled = await Promise.allSettled([
      svc.updateDraft(company.id, created.id, patch("Writer A"), actor(company.userId)),
      svc.updateDraft(company.id, created.id, patch("Writer B"), actor(company.userId)),
    ]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        status: 409,
        details: expect.objectContaining({ code: "revision_conflict" }),
      }),
    });
  });

  it("publishes an immutable empty revision and creates a separate next draft", async () => {
    const company = await seedCompany("Alpha");
    const svc = workflowService(db);
    const created = await createWorkflow(company.id, company.userId);
    const firstDraftId = created.draftRevisionId!;

    const published = await svc.publish(
      company.id,
      created.id,
      {
        expectedDraftRevisionId: firstDraftId,
        expectedPublishedRevisionId: null,
        approvalId: null,
      },
      actor(company.userId),
    );

    expect(published.publishedRevision).toMatchObject({
      id: firstDraftId,
      revisionNumber: 1,
      state: "published",
    });
    expect(published.draftRevision).toMatchObject({
      revisionNumber: 2,
      state: "draft",
    });
    expect(published.draftRevisionId).not.toBe(firstDraftId);

    const updated = await svc.updateDraft(
      company.id,
      created.id,
      {
        expectedRevisionId: published.draftRevisionId!,
        graph: {
          version: 1,
          nodes: [{
            id: "start",
            type: "core.manual_trigger",
            name: "Future draft",
            position: { x: 0, y: 0 },
            config: {},
          }],
          edges: [],
          variables: [],
          settings: {},
        },
      },
      actor(company.userId),
    );

    expect(updated.publishedRevision?.graph).toEqual({
      version: 1,
      nodes: [],
      edges: [],
      variables: [],
      settings: {},
    });
  });

  it("allows exactly one concurrent publisher for the same expected pointers", async () => {
    const company = await seedCompany("Alpha");
    const svc = workflowService(db);
    const created = await createWorkflow(company.id, company.userId);
    const input = {
      expectedDraftRevisionId: created.draftRevisionId!,
      expectedPublishedRevisionId: null,
      approvalId: null,
    };

    const settled = await Promise.allSettled([
      svc.publish(company.id, created.id, input, actor(company.userId)),
      svc.publish(company.id, created.id, input, actor(company.userId)),
    ]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        status: 409,
        details: expect.objectContaining({ code: "revision_conflict" }),
      }),
    });
  });

  it("fails closed on non-empty publish until the Node Registry validates capabilities", async () => {
    const company = await seedCompany("Alpha");
    const svc = workflowService(db);
    const created = await createWorkflow(company.id, company.userId);
    const updated = await svc.updateDraft(
      company.id,
      created.id,
      {
        expectedRevisionId: created.draftRevisionId!,
        graph: {
          version: 1,
          nodes: [{
            id: "start",
            type: "core.manual_trigger",
            name: "Start",
            position: { x: 0, y: 0 },
            config: {},
          }],
          edges: [],
          variables: [],
          settings: {},
        },
      },
      actor(company.userId),
    );

    await expect(
      svc.publish(
        company.id,
        created.id,
        {
          expectedDraftRevisionId: updated.draftRevisionId!,
          expectedPublishedRevisionId: null,
          approvalId: null,
        },
        actor(company.userId),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "workflow_node_invalid",
        reason: "node_registry_not_ready",
      }),
    });
  });
});
