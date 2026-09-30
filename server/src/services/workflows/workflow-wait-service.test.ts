import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  companyMemberships,
  createDb,
  workflowRevisions,
  workflowRuns,
  workflowWaits,
  workflows,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { workflowService } from "./workflow-service.js";
import {
  createWorkflowWaitSignalToken,
  workflowWaitService,
} from "./workflow-wait-service.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

describePg("Workflow wait service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-workflow-waits-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(workflowWaits);
    await db.delete(workflowRuns);
    // Workflow owns immutable revision history; deleting the owner is the
    // supported lifecycle path and cascades its revisions.
    await db.delete(workflows);
    await db.delete(workflowRevisions);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedRun() {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Wait Co",
      issuePrefix: `WT${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    const actor = { principal: { type: "user" as const, userId } };
    const svc = workflowService(db);
    const created = await svc.create(companyId, { name: "Wait workflow" }, actor);
    const updated = await svc.updateDraft(
      companyId,
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
      actor,
    );
    const published = await svc.publish(
      companyId,
      created.id,
      {
        expectedDraftRevisionId: updated.draftRevisionId!,
        expectedPublishedRevisionId: null,
        approvalId: null,
      },
      actor,
    );
    const [run] = await db.insert(workflowRuns).values({
      companyId,
      workflowId: published.id,
      workflowRevisionId: published.publishedRevisionId!,
      status: "waiting",
      source: "manual",
      triggerPayload: {},
      correlationId: randomUUID(),
    }).returning();
    return { companyId, run: run! };
  }

  it("creates one active wait idempotently for the same logical wait", async () => {
    const seeded = await seedRun();
    const svc = workflowWaitService(db);
    const wakeAt = new Date("2026-09-29T10:00:00.000Z");
    const input = {
      companyId: seeded.companyId,
      workflowRunId: seeded.run.id,
      nodeId: "delay",
      waitKey: "primary",
      kind: "delay" as const,
      wakeAt,
    };

    const first = await svc.createActive(input);
    const second = await svc.createActive(input);

    expect(second.id).toBe(first.id);
    expect(await db.select().from(workflowWaits)).toHaveLength(1);
  });

  it("fails closed when the same active wait key is reused with different semantics", async () => {
    const seeded = await seedRun();
    const svc = workflowWaitService(db);
    await svc.createActive({
      companyId: seeded.companyId,
      workflowRunId: seeded.run.id,
      nodeId: "delay",
      waitKey: "primary",
      kind: "delay",
      wakeAt: new Date("2026-09-29T10:00:00.000Z"),
    });

    await expect(
      svc.createActive({
        companyId: seeded.companyId,
        workflowRunId: seeded.run.id,
        nodeId: "delay",
        waitKey: "primary",
        kind: "delay",
        wakeAt: new Date("2026-09-29T11:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: "workflow_wait_key_conflict" }),
    });
  });

  it("resolves an active wait with compare-and-set semantics exactly once", async () => {
    const seeded = await seedRun();
    const svc = workflowWaitService(db);
    const wait = await svc.createActive({
      companyId: seeded.companyId,
      workflowRunId: seeded.run.id,
      nodeId: "delay",
      waitKey: "primary",
      kind: "delay",
      wakeAt: new Date("2026-09-29T10:00:00.000Z"),
    });

    const first = await svc.resolveActive(seeded.companyId, wait.id, {
      status: "resolved",
      resolutionJson: { reason: "done" },
      resolvedByType: "system",
      resolvedById: "test",
      resolvedAt: new Date("2026-09-29T10:00:01.000Z"),
    });
    const duplicate = await svc.resolveActive(seeded.companyId, wait.id, {
      status: "cancelled",
      resolutionJson: { reason: "late-duplicate" },
      resolvedByType: "system",
      resolvedById: "other",
      resolvedAt: new Date("2026-09-29T10:00:02.000Z"),
    });

    expect(first.changed).toBe(true);
    expect(first.wait.status).toBe("resolved");
    expect(duplicate.changed).toBe(false);
    expect(duplicate.wait).toMatchObject({
      status: "resolved",
      resolutionJson: { reason: "done" },
      resolvedById: "test",
    });
  });

  it("stores only a hash for callback signal tokens", async () => {
    const seeded = await seedRun();
    const svc = workflowWaitService(db);
    const { token, tokenHash } = createWorkflowWaitSignalToken();
    const wait = await svc.createActive({
      companyId: seeded.companyId,
      workflowRunId: seeded.run.id,
      nodeId: "callback",
      waitKey: "primary",
      kind: "external_callback",
      signalTokenHash: tokenHash,
    });

    expect(wait.signalTokenHash).toBe(tokenHash);
    expect(wait.signalTokenHash).not.toBe(token);
    expect((await svc.findBySignalToken(token))?.id).toBe(wait.id);
  });
});
