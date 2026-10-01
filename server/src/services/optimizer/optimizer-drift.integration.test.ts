import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLog,
  automationArtifacts,
  companies,
  createDb,
  workflowOptimizerSuggestions,
  workflowRevisions,
  workflows,
} from "@paperclipai/db";
import type { OptimizerDriftPolicy, OptimizerDriftWindow } from "@paperclipai/shared";

import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { optimizerDriftService } from "./optimizer-drift.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

const policy: OptimizerDriftPolicy = {
  minimumExecutions: 10,
  degradedFailureRate: 0.05,
  reviewFailureRate: 0.2,
  degradedFallbackRate: 0.1,
  reviewFallbackRate: 0.3,
  degradedHumanOverrideRate: 0.05,
  reviewHumanOverrideRate: 0.2,
  degradedNewInputShapeRate: 0.1,
  reviewNewInputShapeRate: 0.4,
};

function window(
  overrides: Partial<OptimizerDriftWindow> = {},
): OptimizerDriftWindow {
  return {
    totalExecutions: 100,
    candidateFailures: 0,
    fallbacks: 0,
    newInputShapes: 0,
    humanOverrides: 0,
    invariantFailures: 0,
    connectorOrToolChanged: false,
    workflowChanged: false,
    foundationOrPolicyChanged: false,
    ...overrides,
  };
}

describePg("optimizer drift quarantine", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase(
      "paperclip-optimizer-drift-",
    );
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const [company] = await db
      .insert(companies)
      .values({
        name: "Drift Co",
        issuePrefix: `D${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      })
      .returning();
    const workflowId = randomUUID();
    const revisionId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(workflows).values({
        id: workflowId,
        companyId: company!.id,
        name: "Promoted workflow",
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

    const [suggestion] = await db
      .insert(workflowOptimizerSuggestions)
      .values({
        companyId: company!.id,
        workflowId,
        workflowRevisionId: revisionId,
        signatureHash: "d".repeat(64),
        status: "promoted",
        candidateType: "transform",
        stepOrdinals: [1],
        operationTypes: ["core.transform"],
        capabilityRefs: [null],
        sideEffectRisk: "low",
        observationCount: 3,
        successRate: 1,
        humanCorrectionRate: 0,
        humanCorrectionEvidenceCount: 3,
        humanCorrectionEvidenceCoverage: 1,
        inputShapeStability: 1,
        outputShapeStability: 1,
        averageDurationMs: 10,
        averageCost: 1,
        estimatedLatencySavingsMs: 10,
        estimatedCostSavings: 1,
        observedRunIds: ["run-1", "run-2", "run-3"],
      })
      .returning();

    const [artifact] = await db
      .insert(automationArtifacts)
      .values({
        companyId: company!.id,
        name: "Active deterministic path",
        description: "Drift fixture",
        kind: "transform",
        language: null,
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        riskClass: "C1",
        sideEffectClass: "pure",
        status: "active",
        createdByOptimizerSuggestionId: suggestion!.id,
        originWorkflowId: workflowId,
        originNodeId: null,
      })
      .returning();

    return {
      company: company!,
      workflowId,
      revisionId,
      suggestion: suggestion!,
      artifact: artifact!,
    };
  }

  const actor = {
    principal: { type: "system" as const, service: "optimizer-drift-test" },
  };

  it("keeps healthy and degraded signals non-destructive while auditing degradation", async () => {
    const seeded = await seed();
    const service = optimizerDriftService(db);

    expect(
      await service.evaluateAndApply({
        companyId: seeded.company.id,
        suggestionId: seeded.suggestion.id,
        artifactId: seeded.artifact.id,
        window: window(),
        policy,
        actor,
      }),
    ).toMatchObject({ status: "healthy" });

    expect(
      await service.evaluateAndApply({
        companyId: seeded.company.id,
        suggestionId: seeded.suggestion.id,
        artifactId: seeded.artifact.id,
        window: window({ candidateFailures: 6 }),
        policy,
        actor,
      }),
    ).toMatchObject({ status: "degraded" });

    const [artifact] = await db.select().from(automationArtifacts);
    const [suggestion] = await db
      .select()
      .from(workflowOptimizerSuggestions);
    expect(artifact?.status).toBe("active");
    expect(suggestion?.status).toBe("promoted");

    const activities = await db.select().from(activityLog);
    expect(
      activities.some((row) => row.action === "optimizer.drift_detected"),
    ).toBe(true);
  });

  it("quarantines review-required drift atomically and remains idempotent", async () => {
    const seeded = await seed();
    const service = optimizerDriftService(db);
    const input = {
      companyId: seeded.company.id,
      suggestionId: seeded.suggestion.id,
      artifactId: seeded.artifact.id,
      window: window({ invariantFailures: 1 }),
      policy,
      actor,
    };

    expect(await service.evaluateAndApply(input)).toMatchObject({
      status: "review_required",
      reasonCodes: expect.arrayContaining([
        "optimizer_drift_invariant_failure",
      ]),
    });
    expect(await service.evaluateAndApply(input)).toMatchObject({
      status: "review_required",
    });

    const [artifact] = await db.select().from(automationArtifacts);
    const [suggestion] = await db
      .select()
      .from(workflowOptimizerSuggestions);
    expect(artifact?.status).toBe("failed");
    expect(suggestion?.status).toBe("needs_revision");

    const activities = await db.select().from(activityLog);
    expect(
      activities.some((row) => row.action === "optimizer.drift_quarantined"),
    ).toBe(true);
  });

  it("treats a newer published workflow revision as immediate drift", async () => {
    const seeded = await seed();
    const nextRevisionId = randomUUID();
    await db.transaction(async (tx) => {
      await tx
        .update(workflowRevisions)
        .set({ state: "superseded" })
        .where(eq(workflowRevisions.id, seeded.revisionId));
      await tx.insert(workflowRevisions).values({
        id: nextRevisionId,
        companyId: seeded.company.id,
        workflowId: seeded.workflowId,
        revisionNumber: 2,
        state: "published",
        graph: {
          version: 1,
          nodes: [],
          edges: [],
          variables: [],
          settings: {},
        },
      });
      await tx
        .update(workflows)
        .set({ publishedRevisionId: nextRevisionId })
        .where(eq(workflows.id, seeded.workflowId));
    });

    const result = await optimizerDriftService(db).evaluateAndApply({
      companyId: seeded.company.id,
      suggestionId: seeded.suggestion.id,
      artifactId: seeded.artifact.id,
      window: window(),
      policy,
      actor,
    });

    expect(result).toMatchObject({
      status: "review_required",
      reasonCodes: expect.arrayContaining([
        "optimizer_drift_workflow_changed",
      ]),
    });
    const [artifact] = await db.select().from(automationArtifacts);
    expect(artifact?.status).toBe("failed");
  });
});
