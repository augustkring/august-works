import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  createDb,
  workflowOptimizerSuggestions,
  workflowRevisions,
  workflowRuns,
  workflows,
} from "@paperclipai/db";
import type { OptimizerTrace } from "@paperclipai/shared";

import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { optimizerSuggestionService } from "./optimizer-suggestions.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

describePg("optimizer suggestion projection", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase(
      "paperclip-optimizer-suggestions-",
    );
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(workflowOptimizerSuggestions);
    await db.delete(workflowRuns);
    await db.delete(workflows);
    await db.delete(workflowRevisions);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedWorkflow(input: {
    published: boolean;
    runCount?: number;
  }) {
    const [company] = await db
      .insert(companies)
      .values({
        name: "Optimizer UI Co",
        issuePrefix: `O${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      })
      .returning();
    const workflowId = randomUUID();
    const revisionId = randomUUID();

    if (input.published) {
      await db.transaction(async (tx) => {
        await tx.insert(workflows).values({
          id: workflowId,
          companyId: company!.id,
          name: "Stable workflow",
          status: "active",
          publishedRevisionId: revisionId,
        });
        await tx.insert(workflowRevisions).values({
          id: revisionId,
          companyId: company!.id,
          workflowId,
          revisionNumber: 1,
          state: "published",
          graph: {
            version: 1,
            nodes: [],
            edges: [],
            variables: [],
            settings: {},
          },
        });
      });
    } else {
      await db.insert(workflows).values({
        id: workflowId,
        companyId: company!.id,
        name: "Draft only workflow",
        status: "active",
      });
    }

    const now = new Date("2026-10-01T06:00:00.000Z");
    const runs =
      input.published && (input.runCount ?? 0) > 0
        ? await db
            .insert(workflowRuns)
            .values(
              Array.from({ length: input.runCount ?? 0 }, (_, index) => ({
                companyId: company!.id,
                workflowId,
                workflowRevisionId: revisionId,
                status: "succeeded",
                source: "manual",
                triggerPayload: {},
                startedAt: new Date(now.getTime() + index * 100),
                finishedAt: new Date(now.getTime() + index * 100 + 25),
              })),
            )
            .returning()
        : [];

    return { company: company!, workflowId, revisionId, runs };
  }

  function trace(
    companyId: string,
    workflowId: string,
    revisionId: string,
    runId: string,
    humanCorrection?: boolean,
  ): OptimizerTrace {
    return {
      companyId,
      workflowId,
      workflowRevisionId: revisionId,
      taskId: null,
      routineId: null,
      runId,
      executorType: "workflow",
      steps: [
        {
          ordinal: 1,
          operationType: "core.transform",
          capabilityRef: null,
          inputShapeHash: "a".repeat(64),
          outputShapeHash: "b".repeat(64),
          sideEffectClass: "pure",
          durationMs: 100,
          cost: 2,
          outcome: "success",
        },
      ],
      finalOutcome: "succeeded",
      ...(humanCorrection === undefined ? {} : { humanCorrection }),
      createdAt: "2026-10-01T06:00:00.000Z",
    };
  }

  it("returns null across a workflow/tenant boundary", async () => {
    const seeded = await seedWorkflow({ published: true });
    const result = await optimizerSuggestionService(db).forWorkflow(
      randomUUID(),
      seeded.workflowId,
    );
    expect(result).toBeNull();
  });

  it("distinguishes no published revision from insufficient run evidence", async () => {
    const draft = await seedWorkflow({ published: false });
    expect(
      await optimizerSuggestionService(db).forWorkflow(
        draft.company.id,
        draft.workflowId,
      ),
    ).toMatchObject({
      state: "no_published_revision",
      terminalRunCount: 0,
      suggestions: [],
    });

    await db.delete(workflows);
    await db.delete(companies);

    const published = await seedWorkflow({ published: true, runCount: 2 });
    expect(
      await optimizerSuggestionService(db).forWorkflow(
        published.company.id,
        published.workflowId,
      ),
    ).toMatchObject({
      state: "insufficient_runs",
      terminalRunCount: 2,
      minimumObservationCount: 3,
      suggestions: [],
    });
  });

  it("surfaces low-risk suggestions without fabricating correction evidence", async () => {
    const seeded = await seedWorkflow({ published: true, runCount: 3 });
    const service = optimizerSuggestionService(db, {
      traceNormalizer: {
        normalizeWorkflowRun: async (companyId, runId) =>
          trace(
            companyId,
            seeded.workflowId,
            seeded.revisionId,
            runId,
          ),
      },
    });

    const result = await service.forWorkflow(
      seeded.company.id,
      seeded.workflowId,
    );
    expect(result).toMatchObject({
      state: "ready",
      terminalRunCount: 3,
      correctionEvidenceCount: 0,
    });
    expect(result?.suggestions).toHaveLength(1);
    expect(result?.suggestions[0]).toMatchObject({
      candidateType: "transform",
      sideEffectRisk: "low",
      humanCorrectionRate: null,
      humanCorrectionEvidenceCount: 0,
      humanCorrectionEvidenceCoverage: 0,
    });
  });

  it("materializes each detected signature once and reuses its durable identity", async () => {
    const seeded = await seedWorkflow({ published: true, runCount: 3 });
    const service = optimizerSuggestionService(db, {
      traceNormalizer: {
        normalizeWorkflowRun: async (companyId, runId) =>
          trace(
            companyId,
            seeded.workflowId,
            seeded.revisionId,
            runId,
          ),
      },
    });

    const first = await service.forWorkflow(
      seeded.company.id,
      seeded.workflowId,
    );
    const second = await service.forWorkflow(
      seeded.company.id,
      seeded.workflowId,
    );

    expect(first?.suggestions).toHaveLength(1);
    expect(second?.suggestions).toHaveLength(1);
    expect(second?.suggestions[0]?.id).toBe(first?.suggestions[0]?.id);
    expect(second?.suggestions[0]?.status).toBe("detected");

    const rows = await db.select().from(workflowOptimizerSuggestions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: seeded.company.id,
      workflowId: seeded.workflowId,
      workflowRevisionId: seeded.revisionId,
      status: "detected",
      humanCorrectionRate: null,
      humanCorrectionEvidenceCount: 0,
      humanCorrectionEvidenceCoverage: 0,
    });

    const auditRows = await db.select().from(activityLog);
    expect(
      auditRows.filter(
        (row) => row.action === "optimizer.candidate_detected",
      ),
    ).toHaveLength(1);
  });

  it("returns suggestion-only candidates when all evidence gates are satisfied", async () => {
    const seeded = await seedWorkflow({ published: true, runCount: 3 });
    const service = optimizerSuggestionService(db, {
      traceNormalizer: {
        normalizeWorkflowRun: async (companyId, runId) =>
          trace(
            companyId,
            seeded.workflowId,
            seeded.revisionId,
            runId,
            false,
          ),
      },
    });

    const result = await service.forWorkflow(
      seeded.company.id,
      seeded.workflowId,
    );

    expect(result).toMatchObject({
      state: "ready",
      workflowId: seeded.workflowId,
      workflowRevisionId: seeded.revisionId,
      terminalRunCount: 3,
      correctionEvidenceCount: 3,
    });
    expect(result?.suggestions).toHaveLength(1);
    expect(result?.suggestions[0]).toMatchObject({
      candidateType: "transform",
      sideEffectRisk: "low",
      observationCount: 3,
      successRate: 1,
      humanCorrectionRate: 0,
      humanCorrectionEvidenceCount: 3,
      humanCorrectionEvidenceCoverage: 1,
    });
  });
});
