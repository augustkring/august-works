import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { isNull, and, desc, eq, inArray } from "drizzle-orm";
import { automationArtifacts, workflowOptimizerEvaluations, workflowOptimizerObservations, workflowRuns, workflowStepRuns, type Db } from "@paperclipai/db";
import { instanceSettingsService } from "../instance-settings.js";
import { persistActivity, publishActivity } from "../activity-log.js";
import { evaluateOptimizerShadow } from "./optimizer-shadow.js";
import { selectOptimizerCanaryRoute } from "./optimizer-promotion.js";
import { optimizerShapeHash } from "./optimizer-trace.js";
import { assertOptimizerEvaluationBinding, evaluateCandidateInvariant, executeCompiledOptimizerCandidate } from "./optimizer-evaluation.js";
import { assertMemoryRecordsRetained, lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { evaluateLiveOptimizerDrift } from "./optimizer-live-drift.js";

/** A pure replacement may change output only after persisted qualification and governed promotion. */
export async function executeOptimizedWorkflowTransform(db: Db, run: typeof workflowRuns.$inferSelect,
  nodeId: string, input: unknown, memoryRecordIds: string[], trusted: () => unknown | Promise<unknown>) {
  const [binding] = await db.select().from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, run.companyId),
    eq(workflowOptimizerEvaluations.workflowRevisionId, run.workflowRevisionId), eq(workflowOptimizerEvaluations.nodeId, nodeId),
    inArray(workflowOptimizerEvaluations.status, ["shadow", "canary", "active"]))).orderBy(desc(workflowOptimizerEvaluations.createdAt)).limit(1);
  if (!binding) return trusted();
  const drift = await evaluateLiveOptimizerDrift(db, run.companyId, binding.id);
  if (drift && ["degraded", "review_required"].includes(drift.status)) return trusted();
  const flags = await instanceSettingsService(db).getExperimental();
  if (!flags.enableAutomationArtifactsV1 || (binding.status === "shadow" ? !flags.enableWorkflowOptimizerShadow : !flags.enableWorkflowOptimizerPromotion)) return trusted();
  const mode = binding.status as "shadow" | "canary" | "active";
  let candidateUsed = mode === "active" || (mode === "canary" && selectOptimizerCanaryRoute({ companyId: run.companyId,
    promotionKey: binding.id, routingKey: run.id, candidateTrafficPercent: binding.canaryTrafficPercent }).route === "candidate");
  if (mode === "canary" && !candidateUsed) return trusted();
  let output: unknown;
  let passed = false;
  let fallback = false;
  let invariantFailure = false;
  let errorCode: string | null = null;
  let shadowResult: (typeof workflowOptimizerObservations.$inferInsert)["shadowResult"];
  const shapeHash = optimizerShapeHash(input) ?? "undefined";
  const newInputShape = !binding.knownInputShapes.includes(shapeHash);
  const started = performance.now();
  try {
    const { evaluation, artifact } = await assertOptimizerEvaluationBinding(db, run.companyId, binding.id);
    const codeOwner = { db, companyId: run.companyId, versionId: binding.artifactVersionId, expectedStatus: artifact.status,
      actor: { principal: { type: "system" as const, service: "workflow-optimizer" } } };
    if (artifact.kind === "typescript" && !flags.enableAutomationArtifactCodeExecutionV1) throw new Error("optimizer_code_execution_disabled");
    if (artifact.status !== (mode === "canary" ? "shadow" : mode) || evaluation.replayEvaluation?.status !== "passed") throw new Error("optimizer_evaluation_binding_changed");
    await assertMemoryRecordsRetained(db, run.companyId, memoryRecordIds);
    if (mode !== "shadow" && newInputShape) throw new Error("optimizer_new_input_shape");
    const compiler = evaluation.compilerResult!;
    const candidate = compiler.candidate!;
    if (mode === "shadow") {
      const trustedOutput = await trusted();
      const shadow = await evaluateOptimizerShadow({ compilerResult: compiler, replayEvaluation: evaluation.replayEvaluation,
        observations: [{ id: `run:${run.id}:${nodeId}`, sourceRunId: run.id, input, trustedOutput }], executionMode: "pure" }, {
        execute: async () => ({ output: await executeCompiledOptimizerCandidate(candidate, input, codeOwner), durationMs: performance.now() - started, costEstimate: 0 }),
        evaluateAgreement: async ({ candidateOutput }) => ({ agreement: isDeepStrictEqual(trustedOutput, candidateOutput) }),
        evaluateInvariant: async ({ invariant, candidateOutput }) => ({ passed: evaluateCandidateInvariant(evaluation.invariants.find((item) => item.id === invariant.id)!.expression, input, candidateOutput) }),
      });
      shadowResult = shadow.observationResults[0] ?? null;
      passed = shadow.status === "passed";
      invariantFailure = shadow.criticalInvariantFailure;
      errorCode = passed ? null : shadow.reasonCode;
      candidateUsed = false;
      output = trustedOutput;
    } else {
      output = await executeCompiledOptimizerCandidate(candidate, input, codeOwner);
      for (const invariant of evaluation.invariants) {
        if (!evaluateCandidateInvariant(invariant.expression, input, output)) {
          invariantFailure = invariant.critical;
          throw new Error("optimizer_invariant_failed");
        }
      }
      if (mode === "canary" && !isDeepStrictEqual(output, await trusted())) throw new Error("optimizer_canary_output_mismatch");
      passed = true;
    }
  } catch (error) {
    errorCode = error instanceof Error && error.message.startsWith("optimizer_") ? error.message : "optimizer_candidate_execution_failed";
    fallback = mode !== "shadow";
    candidateUsed = false;
    output = await trusted();
  }
  const durationMs = Math.max(0, Math.round(performance.now() - started));
  let publication: Awaited<ReturnType<typeof persistActivity>>["publication"] | null = null;
  await db.transaction(async (tx) => {
    await lockMemoryPrivacy(tx as unknown as Db, run.companyId);
    await assertMemoryRecordsRetained(tx as unknown as Db, run.companyId, [...new Set([...binding.memoryRecordIds, ...memoryRecordIds])]);
    const [owned] = await tx.select().from(workflowRuns).where(and(eq(workflowRuns.companyId, run.companyId), eq(workflowRuns.id, run.id))).for("update");
    if (owned?.status !== "running" || owned.executionOwnerId !== run.executionOwnerId || !owned.leaseExpiresAt || owned.leaseExpiresAt <= new Date()) {
      throw new Error("workflow_run_claim_lost");
    }
    const [current] = await tx.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id, binding.id)).for("update");
    if (current?.status !== mode) { candidateUsed = false; output = await trusted(); return; }
    const [observation] = await tx.insert(workflowOptimizerObservations).values({ companyId: run.companyId,
      evaluationId: binding.id, workflowRunId: run.id, nodeId, mode, candidateUsed, passed, fallback, inputShapeHash: shapeHash,
      newInputShape, invariantFailure, shadowResult, errorCode, durationMs }).onConflictDoNothing().returning();
    if (!observation) return;
    if (candidateUsed) await tx.update(workflowStepRuns).set({ automationArtifactVersionId: binding.artifactVersionId })
      .where(and(eq(workflowStepRuns.companyId, run.companyId), eq(workflowStepRuns.workflowRunId, run.id), eq(workflowStepRuns.nodeId, nodeId), eq(workflowStepRuns.status, "running")));

    await tx.update(workflowOptimizerEvaluations).set({ memoryRecordIds: [...new Set([...current.memoryRecordIds, ...memoryRecordIds])], updatedAt: new Date() }).where(eq(workflowOptimizerEvaluations.id, binding.id));
    if (!passed && mode !== "shadow") {
      // The same artifact cannot bypass this drift decision through an Artifact node.
      await tx.update(automationArtifacts).set({ status: "failed", updatedAt: new Date() }).where(and(eq(automationArtifacts.companyId, run.companyId), eq(automationArtifacts.id, binding.artifactId), isNull(automationArtifacts.archivedAt)));
      // A failed promoted candidate loses live eligibility before the trusted path continues.
      await tx.update(workflowOptimizerEvaluations).set({ status: "degraded", updatedAt: new Date() }).where(eq(workflowOptimizerEvaluations.id, binding.id));
      const audit = await persistActivity(tx as unknown as Db, { companyId: run.companyId, actorType: "system", actorId: "workflow-optimizer",
        action: "optimizer.candidate_degraded", entityType: "optimizer_evaluation", entityId: binding.id,
        details: { workflowRunId: run.id, nodeId, errorCode, fallback: "published_workflow" } });
      publication = audit.publication;
    }
  });
  if (publication) publishActivity(publication);
  return output;
}
