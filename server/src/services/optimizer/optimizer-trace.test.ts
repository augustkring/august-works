import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  workflowRevisions,
  workflowRuns,
  workflowStepRuns,
  workflows,
} from "@paperclipai/db";

import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import {
  optimizerExecutorTypeForNodeType,
  optimizerShapeHash,
  optimizerTraceService,
} from "./optimizer-trace.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

describe("optimizer shape hashing", () => {
  it("hashes structure without retaining raw values", () => {
    const left = optimizerShapeHash({
      email: "secret-a@example.com",
      profile: { age: 42, enabled: true },
    });
    const right = optimizerShapeHash({
      email: "different-secret@example.com",
      profile: { age: 7, enabled: false },
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });

  it("classifies observable executor types without hidden reasoning", () => {
    expect(optimizerExecutorTypeForNodeType("agent.task")).toBe("agent");
    expect(optimizerExecutorTypeForNodeType("connector.action")).toBe("tool");
    expect(optimizerExecutorTypeForNodeType("human.approval")).toBe("human");
    expect(optimizerExecutorTypeForNodeType("core.transform")).toBe("workflow");
  });
});

describePg("optimizer workflow trace normalization", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase(
      "paperclip-optimizer-trace-",
    );
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(workflowStepRuns);
    await db.delete(workflowRuns);
    await db.delete(workflows);
    await db.delete(workflowRevisions);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedTraceRun(status: "succeeded" | "running" = "succeeded") {
    const [company] = await db
      .insert(companies)
      .values({
        name: "Optimizer Co",
        issuePrefix: `O${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      })
      .returning();
    const workflowId = randomUUID();
    const revisionId = randomUUID();
    const { workflow, revision } = await db.transaction(async (tx) => {
      const [workflowRow] = await tx
        .insert(workflows)
        .values({
          id: workflowId,
          companyId: company!.id,
          name: "Normalize lead",
          status: "active",
          publishedRevisionId: revisionId,
        })
        .returning();
      const [revisionRow] = await tx
        .insert(workflowRevisions)
        .values({
          id: revisionId,
          companyId: company!.id,
          workflowId,
          revisionNumber: 1,
          state: "published",
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
                id: "normalize",
                type: "core.transform",
                name: "Normalize",
                position: { x: 200, y: 0 },
                config: { mapping: { email: "lower(trim(input.email))" } },
              },
            ],
            edges: [{ id: "edge", source: "start", target: "normalize" }],
            variables: [],
            settings: {},
          },
        })
        .returning();
      return { workflow: workflowRow!, revision: revisionRow! };
    });
    const now = new Date("2026-09-30T20:00:00.000Z");
    const [run] = await db
      .insert(workflowRuns)
      .values({
        companyId: company!.id,
        workflowId: workflow.id,
        workflowRevisionId: revision.id,
        status,
        source: "task",
        triggerPayload: {
          issueId: randomUUID(),
          routineId: "raw-trigger-secret-must-not-be-provenance",
          untrustedSecret: "must-never-enter-trace",
        },
        startedAt: now,
        finishedAt: status === "succeeded"
          ? new Date(now.getTime() + 25)
          : null,
      })
      .returning();

    await db.insert(workflowStepRuns).values([
      {
        companyId: company!.id,
        workflowRunId: run!.id,
        nodeId: "start",
        attempt: 1,
        status: "succeeded",
        inputJson: { email: "secret@example.com" },
        outputJson: { email: "secret@example.com" },
        startedAt: now,
        finishedAt: new Date(now.getTime() + 5),
        durationMs: 5,
      },
      {
        companyId: company!.id,
        workflowRunId: run!.id,
        nodeId: "normalize",
        attempt: 1,
        status: "succeeded",
        inputJson: { email: "secret@example.com" },
        outputJson: { email: "secret@example.com" },
        startedAt: new Date(now.getTime() + 5),
        finishedAt: new Date(now.getTime() + 25),
        durationMs: 20,
      },
    ]);

    return { company: company!, run: run! };
  }

  it("normalizes a terminal run without copying raw input or output values", async () => {
    const seeded = await seedTraceRun();
    const trace = await optimizerTraceService(db).normalizeWorkflowRun(
      seeded.company.id,
      seeded.run.id,
    );

    expect(trace).toMatchObject({
      companyId: seeded.company.id,
      workflowId: seeded.run.workflowId,
      workflowRevisionId: seeded.run.workflowRevisionId,
      runId: seeded.run.id,
      executorType: "workflow",
      finalOutcome: "succeeded",
    });
    expect(trace).not.toHaveProperty("humanCorrection");
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[1]).toMatchObject({
      ordinal: 2,
      operationType: "core.transform",
      sideEffectClass: "pure",
      durationMs: 20,
      outcome: "success",
    });
    expect(trace.steps[1]!.inputShapeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(trace.steps[1]!.outputShapeHash).toMatch(/^[0-9a-f]{64}$/);

    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain("secret@example.com");
    expect(serialized).not.toContain("must-never-enter-trace");
    expect(serialized).not.toContain("raw-trigger-secret-must-not-be-provenance");
    expect(trace.routineId).toBeNull();
  });

  it("fails closed for non-terminal runs and cross-company lookups", async () => {
    const seeded = await seedTraceRun("running");
    const otherCompanyId = randomUUID();

    await expect(
      optimizerTraceService(db).normalizeWorkflowRun(
        seeded.company.id,
        seeded.run.id,
      ),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({
        code: "optimizer_trace_run_not_terminal",
      }),
    });

    await expect(
      optimizerTraceService(db).normalizeWorkflowRun(
        otherCompanyId,
        seeded.run.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
