import {assertLearningAssetCurrent} from "./learning/learning-assets.js";
import {assertAnalyticalContextPayloadAccess} from "./analytical-context-authority.js";
import {lockAnalyticalCompany} from "./analytical-privacy.js";
import {lockMemoryPrivacy} from "./memory/memory-privacy.js";
import { companySkillService } from "./company-skills.js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { companySkills, companySkillVersions, companySkillEvalSuites, companySkillEvalCases, companySkillEvalRuns, agentExecutionManifests, companySkillEvalScores, companySkillTestRuns, companySkillUsageEvents, costEvents, heartbeatRuns, toolInvocations, type Db } from "@paperclipai/db";
import { attachSkillEvalObservationSchema, createSkillEvalRunSchema, createSkillEvalSuiteSchema, replaceSkillEvalSuiteSchema, skillPromotionPolicySchema } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict, forbidden, notFound } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { withV5ActivityTransaction } from "./v5-mutations.js";
import { hashContextPolicySnapshot } from "./context/context-manifest.js";
import { skillLifecycleService } from "./skill-lifecycle.js";
import { logActivity } from "./activity-log.js";

type Observation = { arm: string; scores: Record<string, unknown> };
export function aggregateSkillEvaluation(observations: Observation[], expectedObservations: number, policy: z.infer<typeof skillPromotionPolicySchema>, hasChampion: boolean) {
  if (observations.length !== expectedObservations) return { status: "running" as const, aggregate: null };
  const candidate = observations.filter((item) => item.arm === "candidate"), champion = observations.filter((item) => item.arm === "champion");
  const all = observations.map((item) => item.scores);
  const failed = all.some((item) => item.triggerPassed === false || item.processPassed === false || item.safetyPassed === false || item.efficiencyPassed === false);
  const unknown = all.some((item) => ["triggerPassed", "processPassed", "safetyPassed", "efficiencyPassed"].some((key) => typeof item[key] !== "boolean") || typeof item.outcomeScore !== "number" || !Number.isFinite(item.outcomeScore) || typeof item.costCents !== "number" || !Number.isFinite(item.costCents));
  const average = (arm: Observation[], key: string) => arm.length && arm.every((item) => typeof item.scores[key] === "number" && Number.isFinite(item.scores[key])) ? arm.reduce((sum, item) => sum + (item.scores[key] as number), 0) / arm.length : null;
  const candidateOutcomeScore = average(candidate, "outcomeScore"), championOutcomeScore = average(champion, "outcomeScore");
  const candidateCost = average(candidate, "costCents"), championCost = average(champion, "costCents");
  const costRegressionRatio = hasChampion && candidateCost !== null && championCost !== null ? championCost === 0 ? candidateCost === 0 ? 1 : Infinity : candidateCost / championCost : hasChampion ? null : 1;
  const qualityPassed = candidateOutcomeScore !== null && candidateOutcomeScore >= policy.minimumOutcomeScore && (!hasChampion || (championOutcomeScore !== null && candidateOutcomeScore >= championOutcomeScore));
  const costPassed = costRegressionRatio !== null && costRegressionRatio <= policy.maximumCostRegressionRatio;
  // Usage/association never establishes causal business improvement. This is
  // only a paired result on the recorded case set, with explicit judge limits.
  const aggregate = { candidateOutcomeScore, championOutcomeScore, candidateCostCents: candidateCost, championCostCents: championCost,
    costRegressionRatio: Number.isFinite(costRegressionRatio) ? costRegressionRatio : null,
    safetyPassed: all.every((item) => item.safetyPassed === true), processPassed: all.every((item) => item.processPassed === true), triggerPassed: all.every((item) => item.triggerPassed === true),
    observationCount: all.length, causalClaim: false, judgementLimitations: "Deterministic rubric checks and attributable human review; passing this case set does not prove production improvement." };
  return { status: failed || (!unknown && (!qualityPassed || !costPassed)) ? "failed" as const : unknown || !qualityPassed || !costPassed ? "inconclusive" as const : "passed" as const, aggregate };
}

export function skillEvaluationService(db: Db) {
  async function authorize(actor: AuthorizationActor, companyId: string, mutate = false, skillId?: string) {
    await assertV5Enabled(db, "skill_lifecycle_v5"); await assertV5Authorization(db, actor, companyId, "company_scope:read");
    if (skillId && !(await companySkillService(db).canReadSkill(companyId, skillId, actor))) throw notFound("Skill not found");
    if (mutate) { v5HumanActorId(actor); await assertV5Authorization(db, actor, companyId, "users:manage_permissions"); }
    if (mutate) await skillLifecycleService(db).authorizeAction(actor, companyId, "skills.test");
  }
  async function skill(tx: Db, companyId: string, id: string, lock = false) {
    const query = tx.select().from(companySkills).where(and(eq(companySkills.companyId, companyId), eq(companySkills.id, id))).limit(1);
    const [row] = await (lock ? query.for("update") : query); if (!row) throw notFound("Skill not found"); return row;
  }
  async function currentSources(reader:Db,actor:AuthorizationActor,companyId:string,evaluation:typeof companySkillEvalRuns.$inferSelect){
    const [source]=await reader.execute<{erased:boolean}>(sql`select aw_skill_evaluation_source_erased(${companyId}::uuid,${evaluation.id}::uuid) as erased`);
    if(source?.erased)throw forbidden("Skill evaluation Source access is unavailable",{code:"analytical_source_access_lost"});
    for(const id of new Set([evaluation.candidateVersionId,evaluation.championVersionId].filter((id):id is string=>Boolean(id))))await assertLearningAssetCurrent(reader,companyId,"skill_version",id,actor);
    const traces=await reader.select({issueId:companySkillTestRuns.issueId}).from(companySkillTestRuns).where(and(eq(companySkillTestRuns.companyId,companyId),sql`(${companySkillTestRuns.evaluationContext}->>'evaluationRunId'=${evaluation.id} or exists(select 1 from company_skill_eval_scores s where s.company_id=${companyId}::uuid and s.eval_run_id=${evaluation.id}::uuid and s.test_run_id=${companySkillTestRuns.id}))`)).limit(1001);
    if(traces.length>1000)throw conflict("The complete Skill evaluation Source exceeds its retained trace budget");
    for(const trace of traces)await assertAnalyticalContextPayloadAccess(reader,companyId,actor,{issueId:trace.issueId});
  }
  return {
    list: async (actor: AuthorizationActor, companyId: string, id: string) => {
      await authorize(actor, companyId, false, id); await skill(db, companyId, id);
      const suites = await db.select().from(companySkillEvalSuites).where(and(eq(companySkillEvalSuites.companyId, companyId), eq(companySkillEvalSuites.skillId, id))).orderBy(asc(companySkillEvalSuites.createdAt));
      const runs = await db.select().from(companySkillEvalRuns).where(and(eq(companySkillEvalRuns.companyId, companyId), eq(companySkillEvalRuns.skillId, id))).orderBy(asc(companySkillEvalRuns.createdAt));
      for(const run of runs)await currentSources(db,actor,companyId,run);
      return { suites, runs };
    },
    createSuite: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof createSkillEvalSuiteSchema>) => {
      await authorize(actor, companyId, true, id); const input = createSkillEvalSuiteSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await skill(tx, companyId, id, true);
        const [suite] = await tx.insert(companySkillEvalSuites).values({ companyId, skillId: id, name: input.name, requiredForPromotion: input.requiredForPromotion, caseSetHash: hashContextPolicySnapshot(input.cases), createdByUserId: v5HumanActorId(actor) }).returning();
        const cases = await tx.insert(companySkillEvalCases).values(input.cases.map((item) => ({ ...item, companyId, suiteId: suite!.id }))).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action: "skill.eval_suite_created", entityType: "company_skill", entityId: id, details: { suiteId: suite!.id, caseCount: cases.length } }, publications);
        return { ...suite!, cases };
      });
    },
    getSuite: async (actor: AuthorizationActor, companyId: string, id: string, suiteId: string) => {
      await authorize(actor, companyId, false, id); const [suite] = await db.select().from(companySkillEvalSuites).where(and(eq(companySkillEvalSuites.companyId, companyId), eq(companySkillEvalSuites.skillId, id), eq(companySkillEvalSuites.id, suiteId))).limit(1);
      if (!suite) throw notFound("Evaluation suite not found");
      const cases = await db.select().from(companySkillEvalCases).where(and(eq(companySkillEvalCases.companyId, companyId), eq(companySkillEvalCases.suiteId, suiteId))).orderBy(asc(companySkillEvalCases.id)); return { ...suite, cases };
    },
    replaceSuite: async (actor: AuthorizationActor, companyId: string, id: string, suiteId: string, raw: z.infer<typeof replaceSkillEvalSuiteSchema>) => {
      await authorize(actor, companyId, true, id); const input = replaceSkillEvalSuiteSchema.parse(raw);
      if (!input.replacement.requiredForPromotion) throw conflict("A replacement must remain required for promotion");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await skill(tx, companyId, id, true);
        const [previous] = await tx.select().from(companySkillEvalSuites).where(and(eq(companySkillEvalSuites.companyId, companyId), eq(companySkillEvalSuites.skillId, id), eq(companySkillEvalSuites.id, suiteId))).limit(1).for("update");
        if (!previous || !previous.requiredForPromotion) throw conflict("Select a current required suite to replace");
        const [replacement] = await tx.insert(companySkillEvalSuites).values({ companyId, skillId: id, name: input.replacement.name, requiredForPromotion: true, caseSetHash: hashContextPolicySnapshot(input.replacement.cases), createdByUserId: v5HumanActorId(actor) }).returning();
        const cases = await tx.insert(companySkillEvalCases).values(input.replacement.cases.map((item) => ({ ...item, companyId, suiteId: replacement!.id }))).returning();
        // Case bytes, hashes, observations and historical runs stay immutable.
        // Only the future promotion requirement moves, under the Skill lock.
        await tx.update(companySkillEvalSuites).set({ requiredForPromotion: false }).where(eq(companySkillEvalSuites.id, previous.id));
        await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action: "skill.eval_suite_replaced", entityType: "company_skill", entityId: id, details: { previousSuiteId: previous.id, replacementSuiteId: replacement!.id, previousCaseSetHash: previous.caseSetHash, replacementCaseSetHash: replacement!.caseSetHash, reason: input.reason } }, publications);
        return { ...replacement!, cases };
      });
    },
    start: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof createSkillEvalRunSchema>) => {
      await authorize(actor, companyId, true, id); const input = createSkillEvalRunSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);
        const row = await skill(tx, companyId, id, true);
        if (row.activeVersionId !== input.championVersionId || input.candidateVersionId === input.championVersionId) throw conflict("Compare a challenger against the current champion");
        const [candidate] = await tx.select().from(companySkillVersions).where(and(eq(companySkillVersions.companyId, companyId), eq(companySkillVersions.companySkillId, id), eq(companySkillVersions.id, input.candidateVersionId))).limit(1);
        if (!candidate || candidate.visibility !== "company" || !["candidate", "validated"].includes(candidate.state)) throw conflict("Evaluation requires a shared immutable candidate");
        await assertLearningAssetCurrent(tx,companyId,"skill_version",candidate.id,actor);
        if(input.championVersionId)await assertLearningAssetCurrent(tx,companyId,"skill_version",input.championVersionId,actor);
        const [suite] = await tx.select().from(companySkillEvalSuites).where(and(eq(companySkillEvalSuites.companyId, companyId), eq(companySkillEvalSuites.skillId, id), eq(companySkillEvalSuites.id, input.suiteId))).limit(1);
        if (!suite) throw notFound("Evaluation suite not found");
        const policy = skillPromotionPolicySchema.parse(row.promotionPolicy);
        if (input.trials < policy.minimumPairedTrials) throw conflict("The configured minimum paired trial count is required");
        const [run] = await tx.insert(companySkillEvalRuns).values({ ...input, companyId, skillId: id, caseSetHash: suite.caseSetHash, createdByUserId: v5HumanActorId(actor) }).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action: "skill.eval_started", entityType: "company_skill", entityId: id, details: { evaluationRunId: run!.id, suiteId: suite.id } }, publications); return run!;
      });
    },
    observe: async (actor: AuthorizationActor, companyId: string, id: string, evalRunId: string, raw: z.infer<typeof attachSkillEvalObservationSchema>) => {
      await authorize(actor, companyId, true, id); const input = attachSkillEvalObservationSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);
        const row = await skill(tx, companyId, id, true);
        const [evaluation] = await tx.select().from(companySkillEvalRuns).where(and(eq(companySkillEvalRuns.companyId, companyId), eq(companySkillEvalRuns.skillId, id), eq(companySkillEvalRuns.id, evalRunId))).limit(1).for("update");
        if (!evaluation || evaluation.status !== "running") throw conflict("A running evaluation is required");
        await currentSources(tx,actor,companyId,evaluation);
        if (input.trial >= evaluation.trials) throw conflict("Observation is outside the pinned trial set");
        const versionId = input.arm === "candidate" ? evaluation.candidateVersionId : evaluation.championVersionId;
        if (!versionId) throw conflict("This evaluation has no champion arm");
        const [testCase] = await tx.select().from(companySkillEvalCases).where(and(eq(companySkillEvalCases.companyId, companyId), eq(companySkillEvalCases.suiteId, evaluation.suiteId), eq(companySkillEvalCases.id, input.caseId))).limit(1);
        const [trace] = await tx.select().from(companySkillTestRuns).where(and(eq(companySkillTestRuns.companyId, companyId), eq(companySkillTestRuns.skillId, id), eq(companySkillTestRuns.id, input.testRunId))).limit(1);
        if (!testCase || !trace || trace.evaluationContext?.evaluationRunId !== evalRunId || trace.evaluationContext?.caseId !== input.caseId || trace.evaluationContext?.arm !== input.arm || trace.evaluationContext?.trial !== input.trial || trace.skillVersionId !== versionId || trace.inputSnapshot.trim() !== testCase.input.trim() || trace.deletedAt) throw conflict("Observation must reference this pinned case and version's retained test run");
        if (trace.status !== "succeeded") throw conflict("A completed successful test trace is required");
        const executions = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, trace.agentId), sql`(${heartbeatRuns.nativeIssueId} = ${trace.issueId} or ${heartbeatRuns.contextSnapshot}->>'issueId' = ${trace.issueId})`)).orderBy(asc(heartbeatRuns.createdAt)).limit(101);
        if (!executions.length || executions.length > 100 || executions.some((run) => !["succeeded", "failed", "cancelled"].includes(run.status))) throw conflict("Settled attributable provider traces are required");
        const snapshotHash = hashContextPolicySnapshot(trace.agentConfigSnapshot);
        if (evaluation.agentSnapshot && (evaluation.agentSnapshot.hash !== snapshotHash || evaluation.agentSnapshot.agentId !== trace.agentId)) throw conflict("Champion/challenger observations must use the same agent configuration");
        if (!evaluation.agentSnapshot) await tx.update(companySkillEvalRuns).set({ agentSnapshot: { hash: snapshotHash, agentId: trace.agentId } }).where(eq(companySkillEvalRuns.id, evalRunId));
        const runIds = executions.map((run) => run.id), rubric = testCase.rubric;
        const costs = await tx.select().from(costEvents).where(and(eq(costEvents.companyId, companyId), inArray(costEvents.heartbeatRunId, runIds)));
        const tools = await tx.select().from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId), inArray(toolInvocations.runId, runIds)));
        const selections = await tx.select().from(companySkillUsageEvents).where(and(eq(companySkillUsageEvents.companyId, companyId), inArray(companySkillUsageEvents.runId, runIds), eq(companySkillUsageEvents.skillVersionId, versionId), eq(companySkillUsageEvents.stage, "selected")));
        const manifests = await tx.select().from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.agentId, trace.agentId), inArray(agentExecutionManifests.runId, runIds)));
        const instrumented = executions.every((run) => manifests.some((manifest) => manifest.runId === run.id && manifest.id === run.contextSnapshot?.v5ExecutionManifestId));
        const triggered = selections.length > 0;
        const successfulTools = tools.filter((tool) => tool.status === "succeeded").map((tool) => tool.toolName);
        const textPassed = rubric.requiredText.every((text) => trace.outputSnapshot.includes(text)) && rubric.forbiddenText.every((text) => !trace.outputSnapshot.includes(text));
        const processCheck = rubric.requiredTools.every((tool) => successfulTools.includes(tool)) && rubric.prohibitedTools.every((tool) => !successfulTools.includes(tool));
        const unsafe = tools.some((tool) => tool.status === "succeeded" && !["not_required", "approved"].includes(tool.approvalState));
        const measuredCost = costs.length && costs.every((event) => event.costStatus === "reported") ? costs.reduce((sum, event) => sum + event.costCents, 0) : null;
        const runtimeMs = executions.every((run) => run.startedAt && run.finishedAt) ? executions.reduce((sum, run) => sum + (run.finishedAt!.getTime() - run.startedAt!.getTime()), 0) : null;
        const human = input.humanAssessment;
        const scores = { triggerPassed: instrumented ? triggered === testCase.shouldTrigger : null,
          processPassed: !processCheck ? false : rubric.requiresHumanJudgement ? human ? human.processScore >= 0.9 : null : true,
          outcomeScore: !textPassed ? 0 : rubric.requiresHumanJudgement ? human?.outcomeScore ?? null : 1,
          safetyPassed: unsafe || !textPassed || human?.safetyPassed === false ? false : human ? true : null,
          efficiencyPassed: measuredCost === null || runtimeMs === null ? null : (rubric.maximumCostCents === null || measuredCost <= rubric.maximumCostCents) && (rubric.maximumRuntimeMs === null || runtimeMs <= rubric.maximumRuntimeMs),
          costCents: measuredCost, runtimeMs, toolCount: tools.length, executionIds: runIds, traceHash: hashContextPolicySnapshot({ output: trace.outputSnapshot, input: trace.inputSnapshot, versionId, agentConfigSnapshot: trace.agentConfigSnapshot }), humanAssessment: human ?? null, judgeKind: human ? "attributable_human_and_deterministic_checks" : "deterministic_checks", causalClaim: false };
        const [score] = await tx.insert(companySkillEvalScores).values({ ...input, companyId, suiteId: evaluation.suiteId, evalRunId, scores, judgeUserId: v5HumanActorId(actor) }).onConflictDoNothing().returning();
        if (!score) throw conflict("This trace or paired case/trial arm is already recorded");
        const cases = await tx.select({ id: companySkillEvalCases.id }).from(companySkillEvalCases).where(and(eq(companySkillEvalCases.companyId, companyId), eq(companySkillEvalCases.suiteId, evaluation.suiteId)));
        const observations = await tx.select({ arm: companySkillEvalScores.arm, scores: companySkillEvalScores.scores }).from(companySkillEvalScores).where(and(eq(companySkillEvalScores.companyId, companyId), eq(companySkillEvalScores.evalRunId, evalRunId)));
        const result = aggregateSkillEvaluation(observations, cases.length * evaluation.trials * (evaluation.championVersionId ? 2 : 1), skillPromotionPolicySchema.parse(row.promotionPolicy), Boolean(evaluation.championVersionId));
        if (result.status !== "running") {
          await tx.update(companySkillEvalRuns).set({ status: result.status, aggregate: result.aggregate, completedAt: new Date() }).where(eq(companySkillEvalRuns.id, evalRunId));
          if (result.status === "passed") await tx.update(companySkillVersions).set({ state: "validated" }).where(eq(companySkillVersions.id, evaluation.candidateVersionId));
        }
        await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action: "skill.eval_observation_recorded", entityType: "company_skill", entityId: id, details: { evaluationRunId: evalRunId, status: result.status, caseId: input.caseId, arm: input.arm, trial: input.trial } }, publications);
        return { score, status: result.status, aggregate: result.aggregate };
      });
    },
  };
}
