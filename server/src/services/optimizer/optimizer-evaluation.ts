import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray } from "drizzle-orm";
import { automationArtifacts, automationArtifactVersions, workflowOptimizerEvaluations, workflowOptimizerObservations,
  approvals, workflowOptimizerSuggestions, workflowRevisions, workflowRunReviews, workflowRuns, workflowStepRuns, workflows, type Db } from "@paperclipai/db";
import type { OptimizerCompiledCandidate, OptimizerReplayCase, OptimizerShadowEvaluation,
  WorkflowOptimizerEvaluationSummary } from "@paperclipai/shared";
import { z } from "zod";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { automationArtifactService, automationArtifactVersionContentHash, type AutomationArtifactMutationActor } from "../automation-artifacts/automation-artifact-service.js";
import { automationArtifactSecurityService } from "../automation-artifacts/automation-artifact-security.js";
import { executeAutomationArtifactDeclarativeSource } from "../automation-artifacts/automation-artifact-declarative.js";
import { executeAutomationArtifactTypeScriptSandbox } from "../automation-artifacts/automation-artifact-code-runtime.js";
import { assertMemoryRecordsRetained, lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { instanceSettingsService } from "../instance-settings.js";
import { persistActivity, publishActivity } from "../activity-log.js";
import { assertWorkflowOutputSchema, validateWorkflowOutput } from "../workflows/workflow-output-schema.js";
import { evaluateWorkflowTransformMapping } from "../workflows/workflow-transform-expression.js";
import { evaluateWorkflowConditionExpression, parseWorkflowConditionExpression } from "../workflows/workflow-condition-expression.js";
import { compileOptimizerCandidate } from "./optimizer-candidate-compiler.js";
import { evaluateOptimizerHistoricalReplay } from "./optimizer-historical-replay.js";
import { optimizerShapeHash, optimizerTraceService } from "./optimizer-trace.js";
import { evaluateOptimizerPromotion, optimizerPromotionService } from "./optimizer-promotion.js";
import { approvalService } from "../approvals.js";

const SYSTEM: AutomationArtifactMutationActor = { principal: { type: "system", service: "workflow-optimizer" } };
export const optimizerCandidateRequestSchema = z.object({
  kind: z.enum(["expression", "transform", "typescript"]), sourceCode: z.string().min(1).max(64_000),
  inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()),
  invariants: z.array(z.object({ id: z.string().min(1).max(80), description: z.string().min(1).max(500),
    critical: z.boolean().default(true), expression: z.string().min(1).max(2_000) }).strict()).min(1).max(16),
  cases: z.array(z.object({ id: z.string().min(1).max(80), category: z.enum(["boundary", "shape_variant"]), input: z.unknown() }).strict()).min(2).max(16),
}).strict().superRefine((value, ctx) => {
  try {
    assertWorkflowOutputSchema(value.inputSchema); assertWorkflowOutputSchema(value.outputSchema);
    for (const invariant of value.invariants) parseWorkflowConditionExpression(invariant.expression);
    if (!value.invariants.some((item) => item.critical)) throw new Error("At least one critical business invariant is required");
    if (!value.cases.some((item) => item.category === "boundary") || !value.cases.some((item) => item.category === "shape_variant")) throw new Error("Boundary and shape-variant cases are required");
    if (new Set(value.invariants.map((item) => item.id)).size !== value.invariants.length || new Set(value.cases.map((item) => item.id)).size !== value.cases.length) throw new Error("Case and invariant IDs must be unique");
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 256_000) throw new Error("Candidate request exceeds the size limit");
  } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "Invalid candidate contract" }); }
});

export function evaluateCandidateInvariant(expression: string, input: unknown, output: unknown) {
  return evaluateWorkflowConditionExpression(expression, { trigger: { input, output }, variables: {}, steps: {} });
}

/** Executes only the compiled pure candidate through the existing declarative engine or qualified sandbox. */
export async function executeCompiledOptimizerCandidate(candidate: OptimizerCompiledCandidate, input: unknown) {
  if (candidate.kind !== "artifact" || candidate.artifact.sideEffectClass !== "pure" || candidate.artifact.riskClass !== "C0") {
    throw forbidden("Live optimizer evaluation requires a pure C0 artifact", { code: "optimizer_candidate_effect_denied" });
  }
  const artifact = candidate.artifact;
  validateWorkflowOutput(artifact.inputSchema, input);
  let output: unknown;
  if (artifact.kind === "expression" || artifact.kind === "transform") output = executeAutomationArtifactDeclarativeSource(artifact.kind, artifact.sourceCode, input);
  else if (artifact.kind === "typescript") output = await executeAutomationArtifactTypeScriptSandbox({ sourceCode: artifact.sourceCode,
    dependencyManifest: artifact.dependencyManifest as unknown as Record<string, unknown>, value: input, timeoutMs: 2_000 });
  else throw unprocessable("Candidate runtime is not qualified", { code: "optimizer_candidate_runtime_unavailable" });
  validateWorkflowOutput(artifact.outputSchema, output);
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > 1_000_000) throw unprocessable("Candidate output exceeds its bound");
  return output;
}

export async function assertOptimizerEvaluationBinding(db: Db, companyId: string, evaluationId: string, requireGates = true) {
  const [evaluation] = await db.select().from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, companyId), eq(workflowOptimizerEvaluations.id, evaluationId)));
  if (!evaluation) throw notFound("Optimizer evaluation not found");
  const [workflow, artifact, version] = await Promise.all([
    db.select().from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, evaluation.workflowId))).then((rows) => rows[0]),
    db.select().from(automationArtifacts).where(and(eq(automationArtifacts.companyId, companyId), eq(automationArtifacts.id, evaluation.artifactId))).then((rows) => rows[0]),
    db.select().from(automationArtifactVersions).where(and(eq(automationArtifactVersions.companyId, companyId), eq(automationArtifactVersions.id, evaluation.artifactVersionId), eq(automationArtifactVersions.artifactId, evaluation.artifactId))).then((rows) => rows[0]),
  ]);
  if (workflow?.status !== "active" || workflow.publishedRevisionId !== evaluation.workflowRevisionId || artifact?.archivedAt ||
    artifact?.latestVersionId !== evaluation.artifactVersionId || !version || version.contentHash !== evaluation.contentHash ||
    artifact.riskClass !== "C0" || artifact.sideEffectClass !== "pure") throw conflict("Optimizer binding was changed or revoked", { code: "optimizer_evaluation_binding_changed" });
  const recomputedHash = automationArtifactVersionContentHash({ kind: artifact.kind, language: artifact.language,
    sourceCode: version.sourceCode, inputSchema: version.inputSchema, outputSchema: version.outputSchema,
    dependencyManifest: version.dependencyManifest, testSpec: version.testSpec });
  const candidate = evaluation.compilerResult?.candidate;
  if (recomputedHash !== evaluation.contentHash || (requireGates && (version.validationReport?.status !== "passed" ||
    version.validationReport.contentHash !== evaluation.contentHash || version.securityReport?.status !== "passed" ||
    version.securityReport.contentHash !== evaluation.contentHash)) || candidate?.kind !== "artifact" ||
    candidate.artifact.sourceCode !== version.sourceCode || candidate.artifact.kind !== artifact.kind ||
    !isDeepStrictEqual(candidate.artifact.inputSchema, version.inputSchema) || !isDeepStrictEqual(candidate.artifact.outputSchema, version.outputSchema)) {
    throw conflict("Optimizer candidate content or qualification gates changed", { code: "optimizer_evaluation_gates_changed" });
  }
  await assertMemoryRecordsRetained(db, companyId, evaluation.memoryRecordIds);
  return { evaluation, artifact, version };
}

export function optimizerShadowSummary(observations: Array<typeof workflowOptimizerObservations.$inferSelect>): OptimizerShadowEvaluation {
  const shadow = observations.filter((item) => item.mode === "shadow");
  return { status: shadow.length >= 3 && shadow.every((item) => item.passed && item.shadowResult?.status === "passed") ? "passed" : "failed",
    reasonCode: shadow.length < 3 ? "optimizer_shadow_observations_required" : shadow.every((item) => item.passed) ? "optimizer_shadow_passed" : "optimizer_shadow_mismatch",
    trustedPathAuthoritative: true, criticalInvariantFailure: shadow.some((item) => item.invariantFailure),
    observationResults: shadow.flatMap((item) => item.shadowResult ? [item.shadowResult] : []),
    passedObservationCount: shadow.filter((item) => item.passed).length, failedObservationCount: shadow.filter((item) => !item.passed).length,
    unsupportedObservationCount: 0, totalCandidateDurationMs: shadow.reduce((sum, item) => sum + item.durationMs, 0), totalCandidateCostEstimate: 0 };
}

export function optimizerEvaluationService(db: Db) {
  const artifacts = automationArtifactService(db);

  async function committedObservations(companyId: string, evaluationId: string) {
    const rows = await db.select({ observation: workflowOptimizerObservations }).from(workflowOptimizerObservations)
      .innerJoin(workflowRuns, and(eq(workflowRuns.companyId, workflowOptimizerObservations.companyId), eq(workflowRuns.id, workflowOptimizerObservations.workflowRunId)))
      .innerJoin(workflowStepRuns, and(eq(workflowStepRuns.companyId, workflowRuns.companyId), eq(workflowStepRuns.workflowRunId, workflowRuns.id), eq(workflowStepRuns.nodeId, workflowOptimizerObservations.nodeId)))
      .where(and(eq(workflowOptimizerObservations.companyId, companyId), eq(workflowOptimizerObservations.evaluationId, evaluationId),
        eq(workflowRuns.status, "succeeded"), eq(workflowStepRuns.status, "succeeded")))
      .orderBy(desc(workflowOptimizerObservations.observedAt)).limit(100);
    return rows.map((item) => item.observation);
  }

  async function promotionEvidence(companyId: string, evaluationId: string) {
    const bound = await assertOptimizerEvaluationBinding(db, companyId, evaluationId);
    const observations = await committedObservations(companyId, evaluationId);
    const shadow = optimizerShadowSummary(observations);
    const canary = observations.filter((item) => item.mode === "canary");
    const [approval] = bound.evaluation.approvalId ? await db.select().from(approvals).where(and(eq(approvals.companyId, companyId), eq(approvals.id, bound.evaluation.approvalId))) : [];
    const [revision] = await db.select().from(workflowRevisions).where(and(eq(workflowRevisions.companyId, companyId), eq(workflowRevisions.id, bound.evaluation.workflowRevisionId)));
    const rollbackAvailable = revision?.graph.nodes.some((item) => item.id === bound.evaluation.nodeId && item.type === "core.transform") === true;
    if (!bound.evaluation.replayEvaluation) throw conflict("Replay evaluation is required");
    return { ...bound, approval, evidence: { replayEvaluation: bound.evaluation.replayEvaluation,
      shadowEvaluation: shadow, rollbackAvailable, driftGuardAvailable: true,
      humanApproved: approval?.status === "approved", canaryPassed: canary.filter((item) => item.candidateUsed && item.passed).length >= 10 && canary.every((item) => item.passed && !item.fallback && !item.invariantFailure) } };
  }

  return {
    list: async (companyId: string, workflowId: string): Promise<WorkflowOptimizerEvaluationSummary[]> => {
      const rows = await db.select().from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, companyId), eq(workflowOptimizerEvaluations.workflowId, workflowId)))
        .orderBy(desc(workflowOptimizerEvaluations.createdAt)).limit(50);
      return Promise.all(rows.map(async (row) => {
        const observations = await committedObservations(companyId, row.id);
        return { id: row.id, suggestionId: row.suggestionId, nodeId: row.nodeId, workflowRevisionId: row.workflowRevisionId,
          artifactId: row.artifactId, artifactVersionId: row.artifactVersionId, status: row.status as WorkflowOptimizerEvaluationSummary["status"],
          replayEvaluation: row.replayEvaluation, shadowEvaluation: optimizerShadowSummary(observations), approvalId: row.approvalId,
          canaryTrafficPercent: row.canaryTrafficPercent,
          committedCanaryCount: observations.filter((item) => item.mode === "canary" && item.candidateUsed && item.passed).length,
          committedActiveCount: observations.filter((item) => item.mode === "active" && item.candidateUsed && item.passed).length,
          fallbackCount: observations.filter((item) => item.fallback).length, lastErrorCode: observations.find((item) => item.errorCode)?.errorCode ?? null };
      }));
    },

    compile: async (companyId: string, workflowId: string, suggestionId: string,
      rawInput: z.input<typeof optimizerCandidateRequestSchema>, actor: AutomationArtifactMutationActor) => {
      const settings = await instanceSettingsService(db).getExperimental();
      if (!settings.enableWorkflowOptimizerSuggestions || !settings.enableAutomationArtifactsV1) throw forbidden("Optimizer candidate generation is disabled");
      const parsed = optimizerCandidateRequestSchema.safeParse(rawInput);
      if (!parsed.success) throw unprocessable("Invalid candidate contract", parsed.error.issues);
      const input = parsed.data;
      if (input.kind === "typescript" && !settings.enableAutomationArtifactCodeExecutionV1) throw forbidden("Sandboxed code execution is disabled");
      const [suggestion] = await db.select().from(workflowOptimizerSuggestions).where(and(eq(workflowOptimizerSuggestions.companyId, companyId),
        eq(workflowOptimizerSuggestions.workflowId, workflowId), eq(workflowOptimizerSuggestions.id, suggestionId)));
      const [workflow] = await db.select().from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)));
      if (!suggestion || !workflow) throw notFound("Optimizer suggestion not found");
      if (workflow.publishedRevisionId !== suggestion.workflowRevisionId) throw conflict("Suggestion targets a stale revision");
      if (suggestion.stepOrdinals.length !== 1 || suggestion.operationTypes[0] !== "core.transform" || suggestion.sideEffectRisk !== "low") {
        throw unprocessable("This candidate span needs a separately reviewed replacement plan", { code: "optimizer_span_not_replaceable" });
      }
      const [revision] = await db.select().from(workflowRevisions).where(and(eq(workflowRevisions.companyId, companyId), eq(workflowRevisions.id, suggestion.workflowRevisionId)));
      if (!revision) throw notFound("Workflow revision not found");
      const runs = await db.select().from(workflowRuns).where(and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.workflowRevisionId, revision.id), eq(workflowRuns.status, "succeeded")))
        .orderBy(desc(workflowRuns.finishedAt)).limit(50);
      const cases: OptimizerReplayCase[] = [];
      const samples: Parameters<typeof compileOptimizerCandidate>[0]["traceSamples"] = [];
      const references = new Set<string>();
      const sourceRunIds: string[] = [];
      let nodeId: string | null = null;
      for (const run of runs) {
        const [review] = await db.select().from(workflowRunReviews).where(and(eq(workflowRunReviews.companyId, companyId), eq(workflowRunReviews.workflowRunId, run.id)));
        if (!review) continue;
        const steps = await db.select().from(workflowStepRuns).where(and(eq(workflowStepRuns.companyId, companyId), eq(workflowStepRuns.workflowRunId, run.id)));
        const ordered = steps.sort((left, right) => (left.startedAt?.getTime() ?? left.createdAt.getTime()) - (right.startedAt?.getTime() ?? right.createdAt.getTime()) || left.nodeId.localeCompare(right.nodeId) || left.attempt - right.attempt);
        const step = ordered[suggestion.stepOrdinals[0]! - 1];
        if (!step || step.status !== "succeeded" || (nodeId && nodeId !== step.nodeId) || revision.graph.nodes.find((item) => item.id === step.nodeId)?.type !== "core.transform") continue;
        nodeId = step.nodeId;
        await assertMemoryRecordsRetained(db, companyId, [...run.memoryRecordIds, ...step.memoryRecordIds, ...review.memoryRecordIds]);
        for (const ref of [...run.memoryRecordIds, ...step.memoryRecordIds, ...review.memoryRecordIds]) references.add(ref);
        const nodeInput = (step.inputJson as { input?: unknown } | null)?.input;
        const corrected = Object.prototype.hasOwnProperty.call(review.correctedOutputs, nodeId);
        const expected = corrected ? review.correctedOutputs[nodeId] : step.outputJson;
        cases.push({ id: `run:${run.id}`, category: corrected ? "corrected" : "representative", sourceRunId: run.id, input: nodeInput, expectedOutput: expected });
        const trace = await optimizerTraceService(db).normalizeWorkflowRun(companyId, run.id);
        const observed = trace.steps[suggestion.stepOrdinals[0]! - 1]!;
        samples.push({ runId: run.id, inputShapeHash: optimizerShapeHash(nodeInput), outputShapeHash: optimizerShapeHash(expected), outcome: corrected ? "corrected" : observed.outcome });
        sourceRunIds.push(run.id);
      }
      // Fit the artifact test runner's hard 50-case budget, retaining corrected cases first.
      const selected = [...cases].sort((left, right) => Number(right.category === "corrected") - Number(left.category === "corrected")).slice(0, 50 - input.cases.length);
      cases.splice(0, cases.length, ...selected);
      const selectedRuns = new Set(selected.flatMap((item) => item.sourceRunId ? [item.sourceRunId] : []));
      samples.splice(0, samples.length, ...samples.filter((item) => selectedRuns.has(item.runId)));
      sourceRunIds.splice(0, sourceRunIds.length, ...selectedRuns);
      if (sourceRunIds.length < 3 || !nodeId) throw conflict("At least three reviewed source runs of the pinned span are required", { code: "optimizer_source_evidence_required" });
      const node = revision.graph.nodes.find((item) => item.id === nodeId)!;
      const mapping = (node.config as { mapping: Record<string, string> }).mapping;
      for (const fixture of input.cases) {
        const expectedOutput = evaluateWorkflowTransformMapping(mapping, { input: fixture.input, trigger: {}, variables: {}, steps: {} });
        cases.push({ ...fixture, id: `fixture:${fixture.id}`, sourceRunId: null, expectedOutput });
      }
      const compiler = compileOptimizerCandidate({ suggestion: { ...suggestion, createdAt: suggestion.createdAt.toISOString(), updatedAt: suggestion.updatedAt.toISOString() },
        inputSchema: input.inputSchema, outputSchema: input.outputSchema, businessInvariants: input.invariants,
        allowedCapabilityRefs: suggestion.capabilityRefs.filter((item): item is string => Boolean(item)), traceSamples: samples,
        observedImplementation: input.kind === "typescript" ? { kind: "generated_code", language: "typescript", sourceCode: input.sourceCode } : { kind: input.kind, sourceCode: input.sourceCode },
        riskClass: "C0", sideEffectClass: "pure" });
      if (compiler.status !== "compiled" || compiler.candidate?.kind !== "artifact") throw unprocessable("Candidate could not be compiled", { code: compiler.reasonCode });
      const candidate = compiler.candidate;
      const prepared = await db.transaction(async (tx) => {
        await lockMemoryPrivacy(tx as unknown as Db, companyId);
        await assertMemoryRecordsRetained(tx as unknown as Db, companyId, [...references]);
      const detail = await automationArtifactService(tx as unknown as Db).create(companyId, { ...candidate.artifact, originNodeId: nodeId,
        dependencyManifest: candidate.artifact.dependencyManifest as unknown as Record<string, unknown>,
        testSpec: { ...candidate.artifact.testSpec, cases: cases.map((item) => ({ name: item.id, input: item.input, expectedOutput: item.expectedOutput, category: item.category, sourceRunId: item.sourceRunId })) } }, SYSTEM);
      const version = detail.latestVersion!;
        const [evaluation] = await tx.insert(workflowOptimizerEvaluations).values({ companyId, suggestionId, workflowId,
          workflowRevisionId: revision.id, nodeId, artifactId: detail.artifact.id, artifactVersionId: version.id, contentHash: version.contentHash,
          compilerResult: compiler, invariants: input.invariants, sourceRunIds, memoryRecordIds: [...references],
          knownInputShapes: [...new Set(cases.map((item) => optimizerShapeHash(item.input)).filter((item): item is string => item !== null))], createdBy: actor.principal }).returning();
        return { detail, version, evaluation: evaluation! };
      });
      const { detail, version, evaluation } = prepared;
      return optimizerEvaluationService(db).evaluate(companyId, evaluation.id);
    },

    evaluate: async (companyId: string, evaluationId: string) => {
      const bound = await assertOptimizerEvaluationBinding(db, companyId, evaluationId, false);
      const { evaluation, artifact, version } = bound;
      if (artifact.kind === "typescript" && !(await instanceSettingsService(db).getExperimental()).enableAutomationArtifactCodeExecutionV1) throw forbidden("Sandboxed code execution is disabled");
      if (!["testing", "failed"].includes(evaluation.status) || !["candidate", "testing"].includes(artifact.status)) throw conflict("Only a testing candidate can be re-evaluated");
      if (artifact.status === "candidate") await artifacts.transitionStatus(companyId, artifact.id,
        { expectedLatestVersionId: version.id, expectedStatus: "candidate", status: "testing" }, SYSTEM);
      const compiler = evaluation.compilerResult!;
      const candidate = compiler.candidate!;
      const stored = version.testSpec.cases;
      if (!Array.isArray(stored) || stored.length > 50) throw conflict("Stored replay cases are unavailable");
      const cases: OptimizerReplayCase[] = stored.map((value) => {
        const item = value as { name: string; input: unknown; expectedOutput: unknown; category: OptimizerReplayCase["category"]; sourceRunId: string | null };
        return { id: item.name, input: item.input, expectedOutput: item.expectedOutput, category: item.category, sourceRunId: item.sourceRunId };
      });
      const gates = await automationArtifactSecurityService(db).evaluateLatestVersion(companyId, artifact.id, SYSTEM);
      const replay = await evaluateOptimizerHistoricalReplay({ compilerResult: compiler, cases, executionMode: "pure" }, {
        execute: async ({ replayCase }) => { const started = performance.now(); const output = await executeCompiledOptimizerCandidate(candidate, replayCase.input); return { output, durationMs: performance.now() - started, costEstimate: 0 }; },
        evaluateInvariant: async ({ invariant, replayCase, candidateOutput }) => ({ passed: evaluateCandidateInvariant(evaluation.invariants.find((item) => item.id === invariant.id)!.expression, replayCase.input, candidateOutput) }),
      });
      const passed = replay.status === "passed" && gates.latestVersion?.validationReport?.status === "passed" && gates.latestVersion?.securityReport?.status === "passed";
      await db.transaction(async (tx) => {
        await lockMemoryPrivacy(tx as unknown as Db, companyId);
        await assertMemoryRecordsRetained(tx as unknown as Db, companyId, evaluation.memoryRecordIds);
        await tx.update(workflowOptimizerEvaluations).set({ replayEvaluation: replay, status: passed ? "testing" : "failed", updatedAt: new Date() })
          .where(and(eq(workflowOptimizerEvaluations.id, evaluationId), inArray(workflowOptimizerEvaluations.status, ["testing", "failed"])));
      });
      return { evaluationId, artifactId: artifact.id, artifactVersionId: version.id, replayEvaluation: replay, gatesPassed: passed };
    },

    startShadow: async (companyId: string, evaluationId: string, actor: AutomationArtifactMutationActor) => {
      if (!(await instanceSettingsService(db).getExperimental()).enableWorkflowOptimizerShadow) throw forbidden("Optimizer shadow is disabled");
      const { evaluation, artifact, version } = await assertOptimizerEvaluationBinding(db, companyId, evaluationId);
      if (evaluation.status !== "testing" || evaluation.replayEvaluation?.status !== "passed") throw conflict("A passed evaluation is required before shadow execution");
      await db.transaction(async (tx) => {
        await lockMemoryPrivacy(tx as unknown as Db, companyId);
        await assertMemoryRecordsRetained(tx as unknown as Db, companyId, evaluation.memoryRecordIds);
        const [current] = await tx.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id, evaluationId)).for("update");
        if (current?.status !== "testing") throw conflict("Optimizer lifecycle changed");
        await automationArtifactService(tx as unknown as Db).transitionStatus(companyId, artifact.id,
          { expectedLatestVersionId: version.id, expectedStatus: "testing", status: "shadow" }, actor);
        await tx.update(workflowOptimizerEvaluations).set({ status: "shadow", updatedAt: new Date() }).where(eq(workflowOptimizerEvaluations.id, evaluationId));
        await tx.update(workflowOptimizerSuggestions).set({ status: "shadowing", updatedAt: new Date() }).where(eq(workflowOptimizerSuggestions.id, evaluation.suggestionId));
      });
      return { evaluationId, status: "shadow" };
    },

    requestPromotionApproval: async (companyId: string, evaluationId: string, actor: AutomationArtifactMutationActor) => {
      const bound = await promotionEvidence(companyId, evaluationId);
      if (bound.evaluation.status !== "shadow" || bound.evidence.shadowEvaluation.status !== "passed") throw conflict("Three successful committed shadow observations are required");
      if (actor.principal.type !== "user") throw forbidden("Promotion requires an identified company member");
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, companyId), eq(workflowOptimizerEvaluations.id, evaluationId))).for("update");
        if (!current || current.status !== "shadow") throw conflict("Optimizer lifecycle changed");
        if (current.approvalId) return { approvalId: current.approvalId, publication: null };
        const approval = await approvalService(tx as unknown as Db).create(companyId, { type: "optimizer_promotion", status: "pending",
          requestedByUserId: actor.principal.type === "user" ? actor.principal.userId : null,
          payload: { suggestionId: current.suggestionId, artifactId: current.artifactId, artifactVersionId: current.artifactVersionId,
            workflowRevisionId: current.workflowRevisionId, evaluationId: current.id, nodeId: current.nodeId,
            summary: "Approve a bounded pure-transform canary; the pinned published workflow remains the fallback." } });
        await tx.update(workflowOptimizerEvaluations).set({ approvalId: approval!.id, shadowEvaluation: bound.evidence.shadowEvaluation, updatedAt: new Date() }).where(eq(workflowOptimizerEvaluations.id, evaluationId));
        const audit = await persistActivity(tx as unknown as Db, { companyId, actorType: "user", actorId: actor.principal.type === "user" ? actor.principal.userId : "",
          action: "optimizer.promotion_requested", entityType: "optimizer_evaluation", entityId: evaluationId, details: { approvalId: approval!.id } });
        return { approvalId: approval!.id, publication: audit.publication };
      });
      if (result.publication) publishActivity(result.publication);
      return { evaluationId, approvalId: result.approvalId };
    },

    prepareCanary: async (companyId: string, evaluationId: string) => {
      const bound = await promotionEvidence(companyId, evaluationId);
      if (bound.evaluation.status !== "shadow") throw conflict("Candidate is not in shadow state");
      const decision = await db.transaction(async (tx) => {
        await lockMemoryPrivacy(tx as unknown as Db, companyId);
        await assertMemoryRecordsRetained(tx as unknown as Db, companyId, bound.evaluation.memoryRecordIds);
        const [current] = await tx.select().from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, companyId), eq(workflowOptimizerEvaluations.id, evaluationId))).for("update");
        if (current?.status !== "shadow") throw conflict("Optimizer lifecycle changed");
        const result = await optimizerPromotionService(tx as unknown as Db).prepareCanary({ companyId,
          suggestionId: current.suggestionId, artifactId: current.artifactId, expectedArtifactVersionId: current.artifactVersionId,
          policy: { allowLowRiskAutoPromotion: false, fallbackKind: "published_workflow" }, evidence: bound.evidence,
          actor: SYSTEM, approvalId: current.approvalId, approvedByUserId: bound.approval?.decidedByUserId });
        if (result.status === "canary_ready") await tx.update(workflowOptimizerEvaluations).set({ status: "canary",
          shadowEvaluation: bound.evidence.shadowEvaluation, updatedAt: new Date() }).where(eq(workflowOptimizerEvaluations.id, evaluationId));
        return result;
      });
      return { evaluationId, decision };
    },

    activate: async (companyId: string, evaluationId: string) => {
      const bound = await promotionEvidence(companyId, evaluationId);
      if (bound.evaluation.status !== "canary") throw conflict("Candidate has not completed canary evaluation");
      if (!bound.evidence.canaryPassed) return { evaluationId, decision: evaluateOptimizerPromotion({
        riskClass: bound.artifact.riskClass, sideEffectClass: bound.artifact.sideEffectClass,
        policy: { allowLowRiskAutoPromotion: false, fallbackKind: "published_workflow" }, evidence: bound.evidence }) };
      const decision = await db.transaction(async (tx) => {
        await lockMemoryPrivacy(tx as unknown as Db, companyId);
        await assertMemoryRecordsRetained(tx as unknown as Db, companyId, bound.evaluation.memoryRecordIds);
        const [current] = await tx.select().from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, companyId), eq(workflowOptimizerEvaluations.id, evaluationId))).for("update");
        if (current?.status !== "canary") throw conflict("Optimizer lifecycle changed");
        const result = await optimizerPromotionService(tx as unknown as Db).activate({ companyId,
          suggestionId: current.suggestionId, artifactId: current.artifactId, expectedArtifactVersionId: current.artifactVersionId,
          policy: { allowLowRiskAutoPromotion: false, fallbackKind: "published_workflow" }, evidence: bound.evidence,
          actor: SYSTEM, approvalId: current.approvalId, approvedByUserId: bound.approval?.decidedByUserId });
        if (result.status === "promotion_ready") await tx.update(workflowOptimizerEvaluations).set({ status: "active", updatedAt: new Date() }).where(eq(workflowOptimizerEvaluations.id, evaluationId));
        return result;
      });
      return { evaluationId, decision };
    },

    retire: async (companyId: string, evaluationId: string, actor: AutomationArtifactMutationActor) => {
      const [evaluation] = await db.select().from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, companyId), eq(workflowOptimizerEvaluations.id, evaluationId)));
      if (!evaluation) throw notFound("Optimizer evaluation not found");
      await db.transaction(async (tx) => {
        await lockMemoryPrivacy(tx as unknown as Db, companyId);
        const [current] = await tx.select().from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, companyId), eq(workflowOptimizerEvaluations.id, evaluationId))).for("update");
        if (!current || current.status === "retired") return;
        await automationArtifactService(tx as unknown as Db).archive(companyId, current.artifactId, { expectedLatestVersionId: current.artifactVersionId }, actor);
        await tx.update(workflowOptimizerEvaluations).set({ status: "retired", updatedAt: new Date() }).where(eq(workflowOptimizerEvaluations.id, evaluationId));
      });
      return { evaluationId, status: "retired" };
    },
  };
}
