import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  agents,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  instanceSettings,
  issues,
  principalPermissionGrants,
  workflowRevisions,
  workflows,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { workflowAuthoringToolsService } from "../services/workflows/workflow-authoring-tools.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

describePg("Workflow AI authoring tools", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase(
      "paperclip-workflow-authoring-",
    );
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(workflows);
    await db.delete(workflowRevisions);
    await db.delete(principalPermissionGrants);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(instanceSettings);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const [company] = await db
      .insert(companies)
      .values({
        name: `Authoring ${randomUUID()}`,
        issuePrefix: `WA${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      })
      .returning();
    const [agent] = await db
      .insert(agents)
      .values({
        companyId: company!.id,
        name: "Workflow Author",
        role: "operator",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      })
      .returning();
    await db.insert(companyMemberships).values({
      companyId: company!.id,
      principalType: "agent",
      principalId: agent!.id,
      status: "active",
      membershipRole: "member",
    });
    await db.insert(principalPermissionGrants).values([
      {
        companyId: company!.id,
        principalType: "agent",
        principalId: agent!.id,
        permissionKey: "workflows:edit",
        scope: null,
      },
      {
        companyId: company!.id,
        principalType: "agent",
        principalId: agent!.id,
        permissionKey: "workflows:publish",
        scope: null,
      },
    ]);
    const [issue] = await db
      .insert(issues)
      .values({
        companyId: company!.id,
        title: "Author a workflow",
        status: "in_progress",
        assigneeAgentId: agent!.id,
      })
      .returning();
    const [run] = await db
      .insert(heartbeatRuns)
      .values({
        companyId: company!.id,
        agentId: agent!.id,
        invocationSource: "assignment",
        status: "running",
        contextSnapshot: { issueId: issue!.id },
      })
      .returning();

    return {
      company: company!,
      agent: agent!,
      issue: issue!,
      run: run!,
      context: {
        companyId: company!.id,
        agentId: agent!.id,
        runId: run!.id,
        projectId: null,
      },
    };
  }

  async function enable() {
    await instanceSettingsService(db).updateExperimental({
      enableWorkflowsV1: true,
      enableWorkflowBuilderV1: true,
      enableAiWorkflowAuthoring: true,
    });
  }

  it("fails closed while AI workflow authoring is disabled", async () => {
    const seeded = await seed();
    await expect(
      workflowAuthoringToolsService(db).create(seeded.context, {
        name: "Disabled workflow",
        description: null,
        idempotencyKey: "disabled-create",
      }),
    ).rejects.toMatchObject({
      status: 404,
      details: expect.objectContaining({
        code: "workflow_authoring_disabled",
      }),
    });
  });

  it("creates one idempotent draft and never duplicates a retried create", async () => {
    const seeded = await seed();
    await enable();
    const service = workflowAuthoringToolsService(db);
    const input = {
      name: "Lead intake",
      description: "Governed lead qualification",
      idempotencyKey: "lead-intake-v1",
    };

    const first = await service.create(seeded.context, input);
    const replay = await service.create(seeded.context, input);

    expect(first.status).toBe("created");
    expect(replay).toMatchObject({
      status: "replayed",
      workflow: { id: first.workflow.id },
    });
    expect(await db.select().from(workflows)).toHaveLength(1);
    expect(first.workflow).toMatchObject({
      publishedRevisionId: null,
      draftRevision: {
        state: "draft",
        graph: { nodes: [], edges: [] },
      },
    });

    const [retryRun] = await db
      .insert(heartbeatRuns)
      .values({
        companyId: seeded.company.id,
        agentId: seeded.agent.id,
        invocationSource: "retry",
        status: "running",
        contextSnapshot: { issueId: seeded.issue.id },
      })
      .returning();
    const crossRunReplay = await service.create(
      { ...seeded.context, runId: retryRun!.id },
      input,
    );
    expect(crossRunReplay).toMatchObject({
      status: "replayed",
      workflow: { id: first.workflow.id },
    });
    expect(await db.select().from(workflows)).toHaveLength(1);
  });

  it("edits only draft revisions with retry-safe node and edge mutations", async () => {
    const seeded = await seed();
    await enable();
    const service = workflowAuthoringToolsService(db);
    const created = await service.create(seeded.context, {
      name: "Onboarding",
      idempotencyKey: "onboarding",
    });
    const revision1 = created.workflow.draftRevisionId!;

    const trigger = {
      id: "start",
      type: "core.manual_trigger",
      name: "Start",
      position: { x: 0, y: 0 },
      config: {},
    };
    const withTrigger = await service.addTrigger(seeded.context, {
      workflowId: created.workflow.id,
      expectedRevisionId: revision1,
      node: trigger,
    });
    expect(withTrigger.status).toBe("updated");

    const triggerReplay = await service.addTrigger(seeded.context, {
      workflowId: created.workflow.id,
      expectedRevisionId: revision1,
      node: trigger,
    });
    expect(triggerReplay.status).toBe("replayed");

    await expect(
      service.addStep(seeded.context, {
        workflowId: created.workflow.id,
        expectedRevisionId: withTrigger.workflow.draftRevisionId!,
        node: {
          ...trigger,
          id: "second-trigger",
        },
      }),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "workflow_authoring_category_mismatch",
      }),
    });

    const withWait = await service.addStep(seeded.context, {
      workflowId: created.workflow.id,
      expectedRevisionId: withTrigger.workflow.draftRevisionId!,
      node: {
        id: "wait",
        type: "core.wait",
        name: "Wait briefly",
        position: { x: 220, y: 0 },
        config: { durationSeconds: 1 },
      },
    });
    const withEdge = await service.connectSteps(seeded.context, {
      workflowId: created.workflow.id,
      expectedRevisionId: withWait.workflow.draftRevisionId!,
      edge: {
        id: "start-wait",
        source: "start",
        target: "wait",
      },
    });

    const tested = await service.testStep(seeded.context, {
      workflowId: created.workflow.id,
      nodeId: "wait",
    });
    expect(tested).toMatchObject({
      status: "validated",
      validationPassed: true,
      executionPerformed: false,
      nodeType: "core.wait",
      testMode: "safe",
    });

    const updated = await service.updateStep(seeded.context, {
      workflowId: created.workflow.id,
      expectedRevisionId: withEdge.workflow.draftRevisionId!,
      nodeId: "wait",
      updates: {
        name: "Wait two seconds",
        config: { durationSeconds: 2 },
      },
    });
    expect(updated.workflow.draftRevision?.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wait",
          name: "Wait two seconds",
          config: { durationSeconds: 2 },
        }),
      ]),
    );
    expect(updated.workflow.publishedRevisionId).toBeNull();

    const removed = await service.removeStep(seeded.context, {
      workflowId: created.workflow.id,
      expectedRevisionId: updated.workflow.draftRevisionId!,
      nodeId: "wait",
    });
    expect(removed.workflow.draftRevision?.graph.nodes).toHaveLength(1);
    expect(removed.workflow.draftRevision?.graph.edges).toHaveLength(0);
  });

  it("validates publication but leaves the human publish boundary authoritative", async () => {
    const seeded = await seed();
    await enable();
    const service = workflowAuthoringToolsService(db);
    const created = await service.create(seeded.context, {
      name: "Publish handoff",
      idempotencyKey: "publish-handoff",
    });
    const trigger = await service.addTrigger(seeded.context, {
      workflowId: created.workflow.id,
      expectedRevisionId: created.workflow.draftRevisionId!,
      node: {
        id: "start",
        type: "core.manual_trigger",
        name: "Start",
        position: { x: 0, y: 0 },
        config: {},
      },
    });

    const readiness = await service.preparePublish(seeded.context, {
      workflowId: created.workflow.id,
      expectedDraftRevisionId: trigger.workflow.draftRevisionId!,
      expectedPublishedRevisionId: null,
    });

    expect(readiness).toMatchObject({
      status: "ready_for_human_publish",
      workflowId: created.workflow.id,
      publishReady: true,
      requiresHumanPublish: true,
      publishedRevisionId: null,
    });
    const [stored] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, created.workflow.id));
    expect(stored).toMatchObject({
      publishedRevisionId: null,
      draftRevisionId: trigger.workflow.draftRevisionId,
    });
    expect(
      (await db.select().from(workflowRevisions)).filter(
        (revision) => revision.state === "published",
      ),
    ).toHaveLength(0);
  });
});
