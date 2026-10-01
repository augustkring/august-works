import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLog,
  automationArtifacts,
  automationArtifactVersions,
  companies,
  createDb,
  instanceSettings,
  workflowOptimizerSuggestions,
  workflowRevisions,
  workflows,
} from "@paperclipai/db";
import type {
  OptimizerPromotionEvidence,
  OptimizerPromotionPolicy,
} from "@paperclipai/shared";

import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { instanceSettingsService } from "../instance-settings.js";
import { optimizerPromotionService } from "./optimizer-promotion.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

const policy: OptimizerPromotionPolicy = {
  allowLowRiskAutoPromotion: true,
  fallbackKind: "agent",
};

function evidence(
  overrides: Partial<OptimizerPromotionEvidence> = {},
): OptimizerPromotionEvidence {
  return {
    replayEvaluation: {
      status: "passed",
      reasonCode: "optimizer_replay_passed",
      criticalInvariantFailure: false,
      requiredCategories: ["representative", "boundary", "shape_variant"],
      missingCategories: [],
      caseResults: [],
      passedCaseCount: 3,
      failedCaseCount: 0,
      unsupportedCaseCount: 0,
      totalDurationMs: 3,
      totalCostEstimate: 0,
    },
    shadowEvaluation: {
      status: "passed",
      reasonCode: "optimizer_shadow_passed",
      trustedPathAuthoritative: true,
      criticalInvariantFailure: false,
      observationResults: [],
      passedObservationCount: 3,
      failedObservationCount: 0,
      unsupportedObservationCount: 0,
      totalCandidateDurationMs: 3,
      totalCandidateCostEstimate: 0,
    },
    rollbackAvailable: true,
    driftGuardAvailable: true,
    humanApproved: false,
    canaryPassed: false,
    ...overrides,
  };
}

describePg("optimizer promotion service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase(
      "paperclip-optimizer-promotion-",
    );
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
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
        name: "Promotion Co",
        issuePrefix: `P${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      })
      .returning();
    const workflowId = randomUUID();
    const revisionId = randomUUID();

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

    const [suggestion] = await db
      .insert(workflowOptimizerSuggestions)
      .values({
        companyId: company!.id,
        workflowId,
        workflowRevisionId: revisionId,
        signatureHash: "a".repeat(64),
        status: "detected",
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

    const artifactId = randomUUID();
    const versionId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(automationArtifacts).values({
        id: artifactId,
        companyId: company!.id,
        name: "Compiled transform",
        description: "Promotion fixture",
        kind: "transform",
        language: null,
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        riskClass: "C1",
        sideEffectClass: "pure",
        status: "shadow",
        createdByOptimizerSuggestionId: suggestion!.id,
        originWorkflowId: workflowId,
        originNodeId: null,
        latestVersionId: versionId,
      });
      await tx.insert(automationArtifactVersions).values({
        id: versionId,
        companyId: company!.id,
        artifactId,
        versionNumber: 1,
        sourceCode: JSON.stringify({ value: "{{input.value}}" }),
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        dependencyManifest: {},
        testSpec: {},
        validationReport: {
          kind: "validation",
          status: "passed",
          checks: [],
        },
        securityReport: {
          kind: "security",
          status: "passed",
          checks: [],
        },
        contentHash: "b".repeat(64),
      });
    });

    return {
      company: company!,
      workflowId,
      revisionId,
      suggestion: suggestion!,
      artifactId,
      versionId,
    };
  }

  const actor = {
    principal: { type: "system" as const, service: "optimizer-promotion-test" },
  };

  it("atomically prepares canary and activates the same revision-bound artifact", async () => {
    const seeded = await seed();
    await instanceSettingsService(db).updateExperimental({
      enableWorkflowOptimizerPromotion: true,
    });
    const service = optimizerPromotionService(db);

    const prepared = await service.prepareCanary({
      companyId: seeded.company.id,
      suggestionId: seeded.suggestion.id,
      artifactId: seeded.artifactId,
      expectedArtifactVersionId: seeded.versionId,
      policy,
      evidence: evidence(),
      actor,
    });
    expect(prepared.status).toBe("canary_ready");

    const [ready] = await db
      .select()
      .from(workflowOptimizerSuggestions);
    expect(ready?.status).toBe("ready_to_promote");

    const activated = await service.activate({
      companyId: seeded.company.id,
      suggestionId: seeded.suggestion.id,
      artifactId: seeded.artifactId,
      expectedArtifactVersionId: seeded.versionId,
      policy,
      evidence: evidence({ canaryPassed: true }),
      actor,
    });
    expect(activated.status).toBe("promotion_ready");

    const [artifact] = await db.select().from(automationArtifacts);
    const [suggestion] = await db
      .select()
      .from(workflowOptimizerSuggestions);
    expect(artifact?.status).toBe("active");
    expect(suggestion?.status).toBe("promoted");

    const activities = await db.select().from(activityLog);
    expect(activities.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "optimizer.canary_ready",
        "optimizer.promoted",
      ]),
    );
  });

  it("fails closed while promotion is disabled", async () => {
    const seeded = await seed();
    await expect(
      optimizerPromotionService(db).prepareCanary({
        companyId: seeded.company.id,
        suggestionId: seeded.suggestion.id,
        artifactId: seeded.artifactId,
        expectedArtifactVersionId: seeded.versionId,
        policy,
        evidence: evidence(),
        actor,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        code: "optimizer_promotion_disabled",
      }),
    });
  });

  it("requires an active approving user when policy requires human approval", async () => {
    const seeded = await seed();
    await instanceSettingsService(db).updateExperimental({
      enableWorkflowOptimizerPromotion: true,
    });
    await db
      .update(automationArtifacts)
      .set({ riskClass: "C2", sideEffectClass: "write" })
      .where(eq(automationArtifacts.id, seeded.artifactId));

    await expect(
      optimizerPromotionService(db).prepareCanary({
        companyId: seeded.company.id,
        suggestionId: seeded.suggestion.id,
        artifactId: seeded.artifactId,
        expectedArtifactVersionId: seeded.versionId,
        policy,
        evidence: evidence({ humanApproved: true }),
        actor,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        code: "optimizer_promotion_human_approval_reference_required",
      }),
    });
  });

  it("rejects stale workflow revisions before canary or activation", async () => {
    const seeded = await seed();
    await instanceSettingsService(db).updateExperimental({
      enableWorkflowOptimizerPromotion: true,
    });
    const nextRevisionId = randomUUID();
    await db.transaction(async (tx) => {
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

    await expect(
      optimizerPromotionService(db).prepareCanary({
        companyId: seeded.company.id,
        suggestionId: seeded.suggestion.id,
        artifactId: seeded.artifactId,
        expectedArtifactVersionId: seeded.versionId,
        policy,
        evidence: evidence(),
        actor,
      }),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({
        code: "optimizer_promotion_stale_workflow_revision",
      }),
    });

    const [artifact] = await db.select().from(automationArtifacts);
    const [suggestion] = await db
      .select()
      .from(workflowOptimizerSuggestions);
    expect(artifact?.status).toBe("shadow");
    expect(suggestion?.status).toBe("detected");
  });
});
