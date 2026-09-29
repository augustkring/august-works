import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
    // Workflow deletion is the explicit lifecycle owner and cascades revision
    // history. Direct revision deletion is intentionally guarded.
    await db.delete(workflows);
    await db.delete(workflowRevisions);
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

  it("publishes an immutable valid revision and creates a separate next draft", async () => {
    const company = await seedCompany("Alpha");
    const svc = workflowService(db);
    const created = await createWorkflow(company.id, company.userId);
    const publishable = await svc.updateDraft(
      company.id,
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
      actor(company.userId),
    );
    const firstPublishableDraftId = publishable.draftRevisionId!;

    const published = await svc.publish(
      company.id,
      created.id,
      {
        expectedDraftRevisionId: firstPublishableDraftId,
        expectedPublishedRevisionId: null,
        approvalId: null,
      },
      actor(company.userId),
    );

    expect(published.publishedRevision).toMatchObject({
      id: firstPublishableDraftId,
      revisionNumber: 2,
      state: "published",
    });
    expect(published.draftRevision).toMatchObject({
      revisionNumber: 3,
      state: "draft",
    });
    expect(published.draftRevisionId).not.toBe(firstPublishableDraftId);

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
          variables: [{ name: "futureValue" }],
          settings: {},
        },
      },
      actor(company.userId),
    );

    expect(updated.publishedRevision?.graph).toEqual({
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
    });
  });

  it("allows exactly one concurrent publisher for the same expected pointers", async () => {
    const company = await seedCompany("Alpha");
    const svc = workflowService(db);
    const created = await createWorkflow(company.id, company.userId);
    const publishable = await svc.updateDraft(
      company.id,
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
      actor(company.userId),
    );
    const input = {
      expectedDraftRevisionId: publishable.draftRevisionId!,
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

  it("publishes a registered deterministic Transform node through the service", async () => {
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
              name: "Transform",
              position: { x: 180, y: 0 },
              config: { mapping: { normalized: "{{trigger.value}}" } },
            },
          ],
          edges: [{ id: "e1", source: "start", target: "transform" }],
          variables: [],
          settings: {},
        },
      },
      actor(company.userId),
    );

    const published = await svc.publish(
      company.id,
      created.id,
      {
        expectedDraftRevisionId: updated.draftRevisionId!,
        expectedPublishedRevisionId: null,
        approvalId: null,
      },
      actor(company.userId),
    );

    expect(published.publishedRevisionId).toBe(updated.draftRevisionId);
    expect(published.publishedRevision?.graph.nodes).toEqual([
      expect.objectContaining({ id: "start", type: "core.manual_trigger" }),
      expect.objectContaining({ id: "transform", type: "core.transform" }),
    ]);
  });

  it("rejects direct mutation of an immutable workflow revision snapshot", async () => {
    const company = await seedCompany("Alpha");
    const created = await createWorkflow(company.id, company.userId);

    await expect(
      db
        .update(workflowRevisions)
        .set({
          graph: {
            version: 1,
            nodes: [{
              id: "illegal",
              type: "core.manual_trigger",
              name: "Illegal in-place edit",
              position: { x: 0, y: 0 },
              config: {},
            }],
            edges: [],
            variables: [],
            settings: {},
          },
        })
        .where(eq(workflowRevisions.id, created.draftRevisionId!)),
    ).rejects.toBeTruthy();

    const stored = await workflowService(db).getDetail(company.id, created.id);
    expect(stored?.draftRevision?.graph).toEqual({
      version: 1,
      nodes: [],
      edges: [],
      variables: [],
      settings: {},
    });
  });

  it("rejects direct deletion of active and published workflow revisions while allowing owner cascade", async () => {
    const company = await seedCompany("Alpha");
    const svc = workflowService(db);
    const created = await createWorkflow(company.id, company.userId);

    await expect(
      db.delete(workflowRevisions).where(eq(workflowRevisions.id, created.draftRevisionId!)),
    ).rejects.toBeTruthy();

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
            name: "Manual start",
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
    const published = await svc.publish(
      company.id,
      created.id,
      {
        expectedDraftRevisionId: updated.draftRevisionId!,
        expectedPublishedRevisionId: null,
        approvalId: null,
      },
      actor(company.userId),
    );

    await expect(
      db.delete(workflowRevisions).where(
        eq(workflowRevisions.id, published.publishedRevisionId!),
      ),
    ).rejects.toBeTruthy();

    // The workflow owns its revision history. Explicit deletion of that owner
    // still performs the declared cascade instead of trapping the company.
    await expect(
      db.delete(workflows).where(eq(workflows.id, created.id)),
    ).resolves.toBeTruthy();

    expect(
      await db.select().from(workflowRevisions)
        .where(eq(workflowRevisions.workflowId, created.id)),
    ).toHaveLength(0);
  });

  it("rejects a workflow pointer to a revision owned by another workflow", async () => {
    const company = await seedCompany("Alpha");
    const first = await createWorkflow(company.id, company.userId);
    const second = await workflowService(db).create(
      company.id,
      { name: "Second workflow", description: null, projectId: null },
      actor(company.userId),
    );

    await expect(
      db
        .update(workflows)
        .set({ draftRevisionId: second.draftRevisionId })
        .where(eq(workflows.id, first.id)),
    ).rejects.toBeTruthy();

    const stored = await workflowService(db).getDetail(company.id, first.id);
    expect(stored?.draftRevisionId).toBe(first.draftRevisionId);
  });

  it("rejects a revision state change that is not reflected by the workflow pointer", async () => {
    const company = await seedCompany("Alpha");
    const created = await createWorkflow(company.id, company.userId);

    await expect(
      db
        .update(workflowRevisions)
        .set({ state: "published" })
        .where(eq(workflowRevisions.id, created.draftRevisionId!)),
    ).rejects.toBeTruthy();

    const stored = await workflowService(db).getDetail(company.id, created.id);
    expect(stored?.draftRevision).toMatchObject({
      id: created.draftRevisionId,
      state: "draft",
    });
    expect(stored?.publishedRevisionId).toBeNull();
  });

  it("publishes a registered publish-ready Manual Trigger node", async () => {
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
            name: "Manual start",
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

    const published = await svc.publish(
      company.id,
      created.id,
      {
        expectedDraftRevisionId: updated.draftRevisionId!,
        expectedPublishedRevisionId: null,
        approvalId: null,
      },
      actor(company.userId),
    );

    expect(published.publishedRevision?.graph.nodes).toEqual([
      expect.objectContaining({ id: "start", type: "core.manual_trigger" }),
    ]);
  });

  it("rejects unregistered node types during draft validation", async () => {
    const company = await seedCompany("Alpha");
    const svc = workflowService(db);
    const created = await createWorkflow(company.id, company.userId);

    await expect(
      svc.updateDraft(
        company.id,
        created.id,
        {
          expectedRevisionId: created.draftRevisionId!,
          graph: {
            version: 1,
            nodes: [{
              id: "mystery",
              type: "custom.unknown",
              name: "Unknown",
              position: { x: 0, y: 0 },
              config: {},
            }],
            edges: [],
            variables: [],
            settings: {},
          },
        },
        actor(company.userId),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "workflow_node_invalid",
        reason: "node_type_unregistered",
        nodeType: "custom.unknown",
      }),
    });
  });

  it("rejects cross-company agent references inside draft node config", async () => {
    const alpha = await seedCompany("Alpha");
    const beta = await seedCompany("Beta");
    const [betaAgent] = await db.insert(agents).values({
      companyId: beta.id,
      name: "Beta agent",
      role: "analyst",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const svc = workflowService(db);
    const created = await createWorkflow(alpha.id, alpha.userId);

    await expect(
      svc.updateDraft(
        alpha.id,
        created.id,
        {
          expectedRevisionId: created.draftRevisionId!,
          graph: {
            version: 1,
            nodes: [{
              id: "agent-step",
              type: "agent.task",
              name: "Delegate",
              position: { x: 0, y: 0 },
              config: {
                agentId: betaAgent!.id,
                objective: "Do work",
              },
            }],
            edges: [],
            variables: [],
            settings: {},
          },
        },
        actor(alpha.userId),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "workflow_node_invalid",
        reason: "cross_company_reference",
        referenceType: "agent",
      }),
    });
  });

});
