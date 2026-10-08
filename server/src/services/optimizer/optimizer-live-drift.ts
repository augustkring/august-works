import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { isNull, and, desc, eq, inArray } from "drizzle-orm";
import { automationArtifacts, workflowOptimizerEvaluations, workflowOptimizerObservations, workflowOptimizerSuggestions,
  workflowRunReviews, workflowRuns, workflowStepRuns, workflows, type Db } from "@paperclipai/db";
import type { OptimizerDriftPolicy } from "@paperclipai/shared";
import { evaluateOptimizerDrift } from "./optimizer-drift.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { persistActivity, publishActivity } from "../activity-log.js";

// A maximum of 100 committed observations forms the qualification window.
// One failure, fallback, new shape or human override in that window requires review.
const POLICY: OptimizerDriftPolicy = { minimumExecutions: 1,
  degradedFailureRate: 0.01, reviewFailureRate: 0.01,
  degradedFallbackRate: 0.01, reviewFallbackRate: 0.01,
  degradedHumanOverrideRate: 0.01, reviewHumanOverrideRate: 0.01,
  degradedNewInputShapeRate: 0.01, reviewNewInputShapeRate: 0.01 };

/** Derives drift only from committed runtime observations and authoritative run reviews. */
export async function evaluateLiveOptimizerDrift(db: Db, companyId: string, evaluationId: string) {
  const applied = await db.transaction(async (tx) => {
    await lockAnalyticalCompany(tx as unknown as Db, companyId);
    await lockMemoryPrivacy(tx as unknown as Db, companyId);
    const [binding] = await tx.select().from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, companyId),
      eq(workflowOptimizerEvaluations.id, evaluationId))).for("update");
    if (!binding || !["canary", "active"].includes(binding.status)) return null;
    const rows = await tx.select({ observation: workflowOptimizerObservations, humanCorrection: workflowRunReviews.humanCorrection })
      .from(workflowOptimizerObservations)
      .innerJoin(workflowRuns, and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, workflowOptimizerObservations.workflowRunId)))
      .innerJoin(workflowStepRuns, and(eq(workflowStepRuns.companyId, companyId), eq(workflowStepRuns.workflowRunId, workflowRuns.id),
        eq(workflowStepRuns.nodeId, workflowOptimizerObservations.nodeId), eq(workflowStepRuns.status, "succeeded")))
      .leftJoin(workflowRunReviews, and(eq(workflowRunReviews.companyId, companyId), eq(workflowRunReviews.workflowRunId, workflowRuns.id)))
      .where(and(eq(workflowOptimizerObservations.companyId, companyId), eq(workflowOptimizerObservations.evaluationId, evaluationId),
        inArray(workflowOptimizerObservations.mode, ["canary", "active"]), eq(workflowRuns.status, "succeeded")))
      .orderBy(desc(workflowOptimizerObservations.observedAt)).limit(100);
    const [workflow] = await tx.select({ revisionId: workflows.publishedRevisionId }).from(workflows)
      .where(and(eq(workflows.companyId, companyId), eq(workflows.id, binding.workflowId)));
    const drift = evaluateOptimizerDrift({ totalExecutions: rows.length,
      candidateFailures: rows.filter((row) => !row.observation.passed).length,
      fallbacks: rows.filter((row) => row.observation.fallback).length,
      newInputShapes: rows.filter((row) => row.observation.newInputShape).length,
      humanOverrides: rows.filter((row) => row.humanCorrection).length,
      invariantFailures: rows.filter((row) => row.observation.invariantFailure).length,
      workflowChanged: workflow?.revisionId !== binding.workflowRevisionId,
      connectorOrToolChanged: false, foundationOrPolicyChanged: false }, POLICY);
    if (!["degraded", "review_required"].includes(drift.status)) return { drift, publication: null };
    await tx.update(workflowOptimizerEvaluations).set({ status: "degraded", updatedAt: new Date() }).where(eq(workflowOptimizerEvaluations.id, evaluationId));
    await tx.update(automationArtifacts).set({ status: "failed", updatedAt: new Date() })
      .where(and(eq(automationArtifacts.companyId, companyId), eq(automationArtifacts.id, binding.artifactId), isNull(automationArtifacts.archivedAt)));
    await tx.update(workflowOptimizerSuggestions).set({ status: "needs_revision", updatedAt: new Date() })
      .where(and(eq(workflowOptimizerSuggestions.companyId, companyId), eq(workflowOptimizerSuggestions.id, binding.suggestionId)));
    const audit = await persistActivity(tx as unknown as Db, { companyId, actorType: "system", actorId: "workflow-optimizer",
      action: "optimizer.drift_quarantined", entityType: "optimizer_evaluation", entityId: evaluationId,
      details: { ...drift, artifactId: binding.artifactId, fallback: "published_workflow" } });
    return { drift, publication: audit.publication };
  });
  if (applied?.publication) publishActivity(applied.publication);
  return applied?.drift ?? null;
}

export async function evaluateWorkflowOptimizerDrift(db: Db, companyId: string, workflowId: string) {
  const rows = await db.select({ id: workflowOptimizerEvaluations.id }).from(workflowOptimizerEvaluations)
    .where(and(eq(workflowOptimizerEvaluations.companyId, companyId), eq(workflowOptimizerEvaluations.workflowId, workflowId),
      inArray(workflowOptimizerEvaluations.status, ["canary", "active"])));
  for (const row of rows) await evaluateLiveOptimizerDrift(db, companyId, row.id);
}
