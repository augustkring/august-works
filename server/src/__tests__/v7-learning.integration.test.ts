import {automationArtifactService} from "../services/automation-artifacts/automation-artifact-service.js";
import {automationArtifactRuntimeService} from "../services/automation-artifacts/automation-artifact-runtime.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { companies, agents, agentIdentities, heartbeatRuns, contextManifestMemoryRoots, principalPermissionGrants, companyMemberships, issues, projects, goals, strategyExecutionLinks, strategyExecutionLinkVersions, automationArtifacts, automationArtifactVersions, workflowOptimizerEvaluations, workflows, workflowRevisions, workflowRuns, workflowStepRuns, workflowWaits, providerTraceRecords, rolePacks, rolePackVersions, rolePackItems, companySkills, companySkillVersions, playbookChangeProposals, projectRoadmapProposals, memoryBindings, memoryRecords, memoryEvidence, learningCycles, learningHypotheses, learningEvaluations, learningDomainCandidates, foundationChangeProposals, documentRevisions, foundationSections, createDb } from "@paperclipai/db";
import { learningChangeSchema, createGovernedSkillSchema, createPlaybookSchema, type LearningChange } from "@paperclipai/shared";
import { learningService } from "../services/learning/learning-service.js";
import {assertAnalyticalContextPayloadAccess} from "../services/analytical-context-authority.js";
import {businessMetricService} from "../services/business-metrics/service.js";
import {businessMetricObservations,learningAnalyticalDependencies,memoryJobs} from "@paperclipai/db";
import {metricDefinition} from "./helpers/business-metric-fixture.js";
import {memoryJobService} from "../services/memory/memory-jobs.js";
import {eraseExpiredAnalyticalLineage} from "../services/analytical-retention.js";
import { strategyExecutionService } from "../services/strategy-execution/service.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { analyticalPurpose } from "./helpers/business-metric-fixture.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import {foundationIndexService} from "../services/foundation/foundation-index.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { memoryService } from "../services/memory/memory-service.js";
import { purgeMemoryRecords, reapplyMemoryDeletionMarkers } from "../services/memory/memory-privacy.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import {optimizerPromotionService} from "../services/optimizer/optimizer-promotion.js";
import {optimizerShadowSummary, optimizerEvaluationService } from "../services/optimizer/optimizer-evaluation.js";
import { optimizerSuggestionService } from "../services/optimizer/optimizer-suggestions.js";
import { proposeOptimizerCandidate } from "../services/optimizer/optimizer-candidate-proposal.js";
import { reviewWorkflowRun } from "../services/optimizer/optimizer-run-review.js";
import { contextEngineService } from "../services/context/context-engine.js";
import { workflowExecutorService } from "../services/workflows/workflow-executor.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { rolePackService } from "../services/role-packs.js";
import { skillLifecycleService } from "../services/skill-lifecycle.js";
import { playbookService } from "../services/playbooks.js";
import {companySkillService} from "../services/company-skills.js";
import type {AnalyticalContextAuthorityPin} from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("V7 Organizational Learning domain promotion", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let companyId: string, roots: string[], tasks: string[], targetId: string, revisionId: string;
  const owner = { type: "board" as const, source: "local_implicit" as const }, principal = { principal: { type: "system" as const, service: "local-board" } };
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v7-learning-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).updateExperimental({ enableFoundationV1: true, enableWorkflowsV1: true, enableWorkflowOptimizerSuggestions: true, enableWorkflowOptimizerShadow: true, enableAutomationArtifactsV1: true, agent_identities_v5: true, agent_provider_bindings_v5: true, agent_runtime_fabric_v5: true, role_packs_v5: true, enableCollectiveMemoryV1: true, enableContextEngineV1: true, readiness_engine_v7: true, cognitive_memory_v7: true, memory_observations_v7: true, skill_lifecycle_v5: true, playbooks_v5: true, project_roadmap_v5: true, learning_engine_v7: true }); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({learning_engine_v7:true,management_reviews_v8:false});
    companyId = randomUUID(); roots = [randomUUID(), randomUUID()]; tasks = Array.from({ length: 4 }, () => randomUUID());
    await db.insert(companies).values({ id: companyId, name: "Learning fixture", issuePrefix: `L${companyId.slice(0, 7)}` });
    for (const id of tasks) await db.insert(issues).values({ id, companyId, title: `Reviewed outcome ${id}`, status: "done", completedAt: new Date() });
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: "learning", name: "Verified outcomes", providerKey: "local" }).returning();
    for (const [index, id] of roots.entries()) {
      await db.insert(memoryRecords).values({ id, companyId, bindingId: binding!.id, providerKey: "local", memoryType: "outcome", scopeType: "company", content: `Actual customer outcome ${index}`, reviewState: "accepted", verificationState: "human_verified", observedAt: new Date(), createdByActorType: "system", createdByActorId: "fixture" });
      await db.insert(memoryEvidence).values({ companyId, memoryRecordId: id, sourceClass: "task", sourceProvider: "august_works_tasks", sourceType: "issue", sourceRef: `issue://${tasks[index]}`, sourceVersion: "1", observedAt: new Date(), excerptHash: String(index).repeat(64), citationJson: { label: "Reviewed Task" }, trustLevel: "high", supportsOrContradicts: "supports" });
    }
    const document = await foundationService(db).createDraft(companyId, { foundationKey: "company_profile", title: "Company profile", body: "Original governed baseline", category: "company", documentType: "profile", sensitivity: "internal", reviewFrequencyDays: 30 }, principal);
    targetId = document.id; revisionId = document.latestRevisionId!;
  });
  const cycleInput = () => ({ scope: { type: "company" as const, id: null }, purpose: "native_task_execution", trigger: "Repeated late review increases rework", memoryRecordIds: roots });
  const change = () => ({ targetDomain: "foundation" as const, baseRevisionId: revisionId, proposedBody: "Add an evidence review before drafting the final response.", reason: "Repeated verified work outcomes suggest reviewing evidence earlier." });
  const contract = () => ({ expectedImprovement: "Earlier evidence review reduces rework", protectedInvariants: ["Human approval remains mandatory"], baselineRef: `foundation://${targetId}/${revisionId}`, challengerHash: nativeSha256(change()), minimumCases: 2, minimumQuality: 0.8, minimumImprovement: 0.05, rollbackPath: "Reject the candidate and retain the previously reviewed baseline" });
  const hypothesisInput = (version: number) => ({ expectedCycleVersion: version, claim: "Earlier evidence review should reduce repeated late corrections", predictedEffect: "Fewer late corrections without removing any approval gate", targetDomain: "foundation" as const, targetId, riskClass: "material" as const, evaluationContract: contract() });
  const judgment = (quality: number) => ({ correctness: true, safety: true, policy: true, businessOutcome: quality, reliability: 1, latencyMs: 100, costCents: 10 });
  const evaluationInput = (version: number) => ({ expectedHypothesisVersion: version, method: "manual_review" as const, cases: [0, 1].map((index) => ({ baselineTaskId: tasks[index * 2]!, challengerTaskId: tasks[index * 2 + 1]!, baseline: judgment(0.7), challenger: judgment(0.9), invariantResults: [true], rationale: "Reviewed saved work products and current canonical outcomes" })), limitations: ["Small manually selected case set; no randomized causal comparison"] });
  async function supported() {
    const service = learningService(db), cycle = await service.create(owner, companyId, cycleInput());
    const hypothesis = await service.addHypothesis(owner, companyId, cycle.id, hypothesisInput(cycle.version));
    const evaluation = await service.evaluate(owner, companyId, hypothesis.id, evaluationInput(hypothesis.version));
    return { service, cycle, hypothesis, evaluation };
  }
  async function domainProposal(target: string, baseline: string, rawChange: LearningChange, analyticalSources?:AnalyticalContextAuthorityPin[]) {
    const service = learningService(db), cycle = await service.create(owner, companyId, {...cycleInput(),...(analyticalSources?{analyticalSources}:{})}), normalized = learningChangeSchema.parse(rawChange);
    const hypothesis = await service.addHypothesis(owner, companyId, cycle.id, { ...hypothesisInput(1), targetDomain: normalized.targetDomain, targetId: target,
      evaluationContract: { ...contract(), baselineRef: baseline, challengerHash: nativeSha256(normalized) } });
    const evaluation = await service.evaluate(owner, companyId, hypothesis.id, evaluationInput(1));
    return service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: normalized });
  }
  async function analyticalSignal(sensitivity:"internal"|"confidential"="internal"){
    await instanceSettingsService(db).updateExperimental({analytical_lineage_v8:true,business_metrics_v8:true,management_reviews_v8:true,ai_use_cases_v7:true,governance_evidence_v7:true});
    const purpose=analyticalPurpose();purpose.analyticalPurpose!.permittedSensitivity=[sensitivity];
    const policy=await aiGovernanceService(db).obligation(owner,companyId,purpose),metrics=businessMetricService(db);
    const metric=await metrics.create(companyId,owner,{key:"learning_signal",definition:{...metricDefinition(policy.id),sensitivity}});
    await metrics.publish(companyId,owner,metric.metric.id,{expectedRevision:1,versionId:metric.version.id});
    const sourceId=randomUUID();await db.insert(issues).values({id:sourceId,companyId,title:"Independent synthetic analytical signal",status:"done",completedAt:new Date()});
    const now=Date.now(),observation=await metrics.query(companyId,owner,{metricId:metric.metric.id,versionId:metric.version.id,from:new Date(now-86400000).toISOString(),until:new Date(now+1000).toISOString(),dimensions:[],maxRows:100});
    return {sourceId,observation,pin:{kind:"analytical_evidence" as const,source:{type:"metric_observation" as const,id:observation.id,metricId:observation.metricId,metricVersionId:observation.versionId}}};
  }
  it("retains a supplemental original V8 signal while still requiring verified native Task outcomes and current source access",async()=>{
    const signal=await analyticalSignal(),service=learningService(db);
    await db.update(memoryRecords).set({verificationState:"unverified"}).where(eq(memoryRecords.id,roots[0]!));
    await expect(service.create(owner,companyId,{...cycleInput(),analyticalSources:[signal.pin]})).rejects.toMatchObject({status:409});
    await db.update(memoryRecords).set({verificationState:"human_verified"}).where(eq(memoryRecords.id,roots[0]!));
    const cycle=await service.create(owner,companyId,{...cycleInput(),analyticalSources:[signal.pin]});
    expect(cycle.analyticalSourceCount).toBe(1);expect(Object.keys(cycle.outcomeVersions).sort()).toEqual(tasks.slice(0,2).sort());
    expect(await db.select().from(learningAnalyticalDependencies).where(eq(learningAnalyticalDependencies.cycleId,cycle.id))).toHaveLength(1);
    await service.addHypothesis(owner,companyId,cycle.id,hypothesisInput(1));
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,tasks[3]!));
    await expect(service.get(owner,companyId,cycle.id)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    expect(await service.list(owner,companyId)).toEqual([]);
    await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,tasks[3]!));
    expect((await service.get(owner,companyId,cycle.id)).hypotheses).toHaveLength(1);
  });
  it("erases analytical Learning derivatives through the existing outbox with flags off and company paused, preserving verified outcomes",async()=>{
    const signal=await analyticalSignal(),service=learningService(db),cycle=await service.create(owner,companyId,{...cycleInput(),analyticalSources:[signal.pin]});
    const hypothesis=await service.addHypothesis(owner,companyId,cycle.id,hypothesisInput(1)),evaluation=await service.evaluate(owner,companyId,hypothesis.id,evaluationInput(1));
    const link=await service.proposeChange(owner,companyId,hypothesis.id,{expectedHypothesisVersion:2,evaluationId:evaluation.id,change:change()});
    await instanceSettingsService(db).updateExperimental({learning_engine_v7:false,business_metrics_v8:false,management_reviews_v8:false,analytical_lineage_v8:false});
    await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
    await db.delete(businessMetricObservations).where(eq(businessMetricObservations.id,signal.observation.id));
    expect((await db.select().from(learningCycles).where(eq(learningCycles.id,cycle.id)))[0]).toMatchObject({trigger:"",outcomeVersions:{},analyticalSourcePins:[],analyticalSourceCount:0});
    expect((await db.select().from(learningHypotheses).where(eq(learningHypotheses.id,hypothesis.id)))[0]).toMatchObject({claim:"",predictedEffect:"",evaluationContract:null});
    expect((await db.select().from(learningEvaluations).where(eq(learningEvaluations.id,evaluation.id)))[0]).toMatchObject({cases:[],metrics:{},limitations:[]});
    const lateHypothesisId=randomUUID();
    await db.insert(learningHypotheses).values({...hypothesis,id:lateHypothesisId,claim:"Late restored analytical claim",predictedEffect:"Late restored prediction",evaluationContract:contract(),erasedAt:null});
    expect((await db.select().from(learningHypotheses).where(eq(learningHypotheses.id,lateHypothesisId)))[0]).toMatchObject({claim:"",predictedEffect:"",evaluationContract:null});
    const lateEvaluationId=randomUUID();
    await db.insert(learningEvaluations).values({...evaluation,id:lateEvaluationId,hypothesisId:lateHypothesisId,cases:evaluationInput(1).cases,metrics:{copiedAnalyticalFacts:"Late restored facts"},limitations:["Late private copy"],erasedAt:null});
    expect((await db.select().from(learningEvaluations).where(eq(learningEvaluations.id,lateEvaluationId)))[0]).toMatchObject({cases:[],metrics:{},limitations:[]});
    const [job]=await db.select().from(memoryJobs).where(eq(memoryJobs.jobKey,`learning-analytical-erasure:v1:${cycle.id}`));expect(job!.sourceRefJson).toEqual({kind:"learning_analytical_erasure",cycleId:cycle.id});
    await memoryJobService(db).tick({limit:10});
    expect((await db.select().from(memoryJobs).where(eq(memoryJobs.id,job!.id)))[0]!.status).toBe("succeeded");
    expect((await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.id,link.candidateId)))[0]!.proposedBody).toBe("");
    expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,roots[0]!)))[0]!.content).toContain("Actual customer outcome");
    expect((await db.select().from(issues).where(eq(issues.id,tasks[0]!)))[0]!.status).toBe("done");
    await db.update(learningCycles).set({erasedAt:null}).where(eq(learningCycles.id,cycle.id));
    expect((await db.select().from(learningCycles).where(eq(learningCycles.id,cycle.id)))[0]!.erasedAt).not.toBeNull();
    await instanceSettingsService(db).updateExperimental({learning_engine_v7:true,management_reviews_v8:false});
  });
  it("closes an expired original analytical signal through the native retention owner",async()=>{
    const signal=await analyticalSignal(),cycle=await learningService(db).create(owner,companyId,{...cycleInput(),analyticalSources:[signal.pin]});
    // Exercise the native retention cutoff; immutable source timestamps stay intact.
    await eraseExpiredAnalyticalLineage(db,new Date(Date.parse(signal.observation.expiresAt)+1));
    expect((await db.select().from(learningCycles).where(eq(learningCycles.id,cycle.id)))[0]!.erasedAt).not.toBeNull();
  });
  it("requires current signal access for native human Foundation reads and approval, then leaves approval with that owner",async()=>{
    const signal=await analyticalSignal(),service=learningService(db),cycle=await service.create(owner,companyId,{...cycleInput(),analyticalSources:[signal.pin]});
    const hypothesis=await service.addHypothesis(owner,companyId,cycle.id,hypothesisInput(1)),evaluation=await service.evaluate(owner,companyId,hypothesis.id,evaluationInput(1));
    const link=await service.proposeChange(owner,companyId,hypothesis.id,{expectedHypothesisVersion:2,evaluationId:evaluation.id,change:change()});
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,signal.sourceId));
    await expect(foundationService(db).listProposals(companyId,targetId,owner)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    await expect(foundationService(db).acceptProposal(companyId,targetId,link.candidateId,principal)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,signal.sourceId));
    const accepted=await foundationService(db).acceptProposal(companyId,targetId,link.candidateId,principal);
    expect(accepted.foundation.body).toBe(change().proposedBody);
    await expect(foundationService(db).get(companyId,targetId)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    expect((await foundationService(db).get(companyId,targetId,owner))!.body).toBe(change().proposedBody);
    await foundationService(db).submitForReview(companyId,targetId,accepted.foundation.latestRevisionId!,principal);
    await foundationService(db).approve(companyId,targetId,accepted.foundation.latestRevisionId!,principal);
    expect(await foundationIndexService(db).search(companyId,{query:"evidence review",limit:12,scope:"approved"},owner)).toHaveLength(1);
    await expect(foundationIndexService(db).search(companyId,{query:"evidence review",limit:12,scope:"approved"})).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,signal.sourceId));
    await expect(foundationService(db).get(companyId,targetId,owner)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    await expect(foundationIndexService(db).search(companyId,{query:"evidence review",limit:12,scope:"approved"},owner)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
  });
  it("preserves original analytical sensitivity when proposing a native Learning change",async()=>{
    const signal=await analyticalSignal("confidential"),service=learningService(db),cycle=await service.create(owner,companyId,{...cycleInput(),analyticalSources:[signal.pin]});
    const hypothesis=await service.addHypothesis(owner,companyId,cycle.id,hypothesisInput(1)),evaluation=await service.evaluate(owner,companyId,hypothesis.id,evaluationInput(1));
    await expect(service.proposeChange(owner,companyId,hypothesis.id,{expectedHypothesisVersion:2,evaluationId:evaluation.id,change:change()})).rejects.toMatchObject({status:403});
    expect(await db.select().from(learningDomainCandidates).where(eq(learningDomainCandidates.hypothesisId,hypothesis.id))).toHaveLength(0);
  });
  it("rejects incomplete or mutable signal bindings at the native PostgreSQL boundary",async()=>{
    const signal=await analyticalSignal(),cycle=await learningService(db).create(owner,companyId,{...cycleInput(),analyticalSources:[signal.pin]});
    await expect(db.insert(learningCycles).values({...cycle,id:randomUUID()})).rejects.toMatchObject({cause:{code:"23514"}});
    await expect(db.update(learningCycles).set({analyticalSourceExpiresAt:new Date(Date.now()+86400000)}).where(eq(learningCycles.id,cycle.id))).rejects.toMatchObject({cause:{code:"23514"}});
    const [edge]=await db.select().from(learningAnalyticalDependencies).where(eq(learningAnalyticalDependencies.cycleId,cycle.id));
    await expect(db.update(learningAnalyticalDependencies).set({sourceManifestId:edge!.sourceManifestId}).where(eq(learningAnalyticalDependencies.cycleId,cycle.id))).rejects.toMatchObject({cause:{code:"23514"}});
  });
  it.each(["verified_memory","artifact_signal","workflow_signal"] as const)("retains current Optimizer source authority and erases native compiler copies: %s", async sourceKind => {
    const signal=sourceKind==="verified_memory"?null:await analyticalSignal();
    const service = workflowService(db), created = await service.create(companyId, { name: "Reviewed pure transform" }, principal);
    const draft = await service.updateDraft(companyId, created.id, { expectedRevisionId: created.draftRevisionId!, graph: {
      version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "copy", type: "core.transform", name: "Copy", position: { x: 100, y: 0 }, config: { mapping: { value: "{{input.value}}" } } },
      ], edges: [{ id: "e", source: "start", target: "copy" }], variables: [], settings: {} } }, principal);
    let currentDraft=draft.draftRevisionId!;
    if(sourceKind==="workflow_signal"){
      const graph={...draft.draftRevision!.graph,nodes:draft.draftRevision!.graph.nodes.map(node=>({...node,name:`Reviewed ${node.name}`}))};
      currentDraft=(await domainProposal(created.id,`workflow://${created.id}/${currentDraft}`,{targetDomain:"workflow",draft:{expectedRevisionId:currentDraft,graph,changeSummary:"Native verified outcomes and current signal inform the exact transform"}},[signal!.pin])).candidateId;
    }
    const published = await service.publish(companyId, created.id, { expectedDraftRevisionId: currentDraft, expectedPublishedRevisionId: null, approvalId: null }, principal);
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: "local-reviewer", status: "active", membershipRole: "owner" });
    const executor = workflowExecutorService(db);
    // These are actual local engine runs reviewed against the declared fixture contract, not customer pilot evidence.
    for (let index = 1; index <= 3; index++) {
      const run = await executor.startManualRun(companyId, created.id, { input: { value: index } }, principal, `learning-source-${index}`);
      await reviewWorkflowRun(db, companyId, run.run.id, { humanCorrection: false, correctedOutputs: {}, reason: "Verified the saved engine output against the copy contract" }, { principal: { type: "user", userId: "local-reviewer" } });
    }
    const suggestion = (await optimizerSuggestionService(db).forWorkflow(companyId, created.id))!.suggestions.find(item => item.operationTypes.length === 1 && item.operationTypes[0] === "core.transform")!;
    const request = await proposeOptimizerCandidate(db, companyId, created.id, suggestion.id,owner);
    const optimizer = optimizerEvaluationService(db), replay = await optimizer.compile(companyId, created.id, suggestion.id, request, principal);
    expect(replay.gatesPassed).toBe(true);
    const [evaluation] = await db.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id, replay.evaluationId));
    const link = await domainProposal(created.id, `optimizer://${created.id}/${published.publishedRevisionId}`, { targetDomain: "automation_artifact", optimizerEvaluationId: replay.evaluationId, expectedArtifactVersionId: replay.artifactVersionId, expectedContentHash: evaluation!.contentHash },sourceKind==="artifact_signal"?[signal!.pin]:undefined);
    expect(link.candidateId).toBe(replay.evaluationId);
    expect((await db.select().from(automationArtifacts).where(eq(automationArtifacts.id, replay.artifactId)))[0]!.status).toBe("testing");
    const artifacts=automationArtifactService(db);
    let descendantVersionId:string|null=null;
    if(signal){
      expect((await artifacts.getDetail(companyId,replay.artifactId,principal))!.latestVersion!.sourceCode).not.toBe("");
      expect(await artifacts.list(companyId,principal)).toHaveLength(1);
      expect(await optimizer.list(companyId,created.id,owner)).toHaveLength(1);
      await expect(optimizer.evaluate(companyId,replay.evaluationId)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
      expect((await optimizer.evaluate(companyId,replay.evaluationId,principal)).gatesPassed).toBe(true);
      await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,signal.sourceId));
      for(const read of [()=>optimizer.list(companyId,created.id,owner),()=>optimizer.evaluate(companyId,replay.evaluationId,principal),()=>optimizer.startShadow(companyId,replay.evaluationId,principal),()=>optimizer.requestPromotionApproval(companyId,replay.evaluationId,principal),()=>optimizer.prepareCanary(companyId,replay.evaluationId,principal),()=>optimizer.activate(companyId,replay.evaluationId,principal)])await expect(read()).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
      if(sourceKind==="workflow_signal"){
        await expect(proposeOptimizerCandidate(db,companyId,created.id,suggestion.id,owner)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
        await expect(optimizer.compile(companyId,created.id,suggestion.id,request,principal)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
        expect(await db.select().from(automationArtifacts).where(eq(automationArtifacts.companyId,companyId))).toHaveLength(1);
      }
      expect(await artifacts.list(companyId,principal)).toEqual([]);
      await expect(artifacts.getDetail(companyId,replay.artifactId,principal)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
      await expect(artifacts.transitionStatus(companyId,replay.artifactId,{expectedStatus:"testing",expectedLatestVersionId:replay.artifactVersionId,status:"candidate"},principal)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
      await expect(artifacts.archive(companyId,replay.artifactId,{expectedLatestVersionId:replay.artifactVersionId},principal)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
      const promotion={companyId,suggestionId:suggestion.id,artifactId:replay.artifactId,expectedArtifactVersionId:replay.artifactVersionId,actor:{principal:{type:"system" as const,service:"workflow-optimizer"}},sourceActor:owner,policy:{allowLowRiskAutoPromotion:false,fallbackKind:"published_workflow" as const},evidence:{replayEvaluation:replay.replayEvaluation,shadowEvaluation:optimizerShadowSummary([]),rollbackAvailable:true,driftGuardAvailable:true,humanApproved:false,canaryPassed:false}};
      await expect(optimizerPromotionService(db).prepareCanary(promotion)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
      await expect(optimizerPromotionService(db).activate(promotion)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
      expect((await db.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id,replay.evaluationId)))[0]!.status).toBe("testing");
      await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,signal.sourceId));
    }
    await optimizer.startShadow(companyId, replay.evaluationId, principal);
    if(signal){
      // Current read identity is insufficient for an unqualified runtime copy.
      await expect(automationArtifactRuntimeService(db).inspectPinnedBinding(companyId,replay.artifactId,replay.artifactVersionId,principal,false)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
      await artifacts.transitionStatus(companyId,replay.artifactId,{expectedStatus:"shadow",expectedLatestVersionId:replay.artifactVersionId,status:"candidate"},principal);
      const detail=(await artifacts.getDetail(companyId,replay.artifactId,principal))!;
      const version=detail.latestVersion!;
      const descendant=await artifacts.appendVersion(companyId,replay.artifactId,{expectedLatestVersionId:version.id,sourceCode:'{"value":"{{input.value}}","reviewed":"true"}',inputSchema:version.inputSchema,outputSchema:version.outputSchema,dependencyManifest:version.dependencyManifest,testSpec:version.testSpec},principal);
      descendantVersionId=descendant.latestVersion!.id;
      expect(descendantVersionId).not.toBe(replay.artifactVersionId);

      await instanceSettingsService(db).updateExperimental({learning_engine_v7:false,management_reviews_v8:false,business_metrics_v8:false,analytical_lineage_v8:false});
      await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
      await db.delete(businessMetricObservations).where(eq(businessMetricObservations.id,signal.observation.id));
      // Fence restored compiler bytes before the original outbox worker runs.
      await db.update(workflowOptimizerEvaluations).set({compilerResult:evaluation!.compilerResult,replayEvaluation:evaluation!.replayEvaluation,status:"shadow"}).where(eq(workflowOptimizerEvaluations.id,replay.evaluationId));
      expect((await db.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id,replay.evaluationId)))[0]).toMatchObject({status:"retired",compilerResult:null,replayEvaluation:null});
      // The current Source owner queues the original cycle outbox; no provider is invoked.
      await memoryJobService(db).tick({limit:10});
      expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,roots[0]!)))[0]!.deletedAt).toBeNull();
    }else await db.transaction(async tx => purgeMemoryRecords(tx as unknown as typeof db, companyId, [roots[0]!]));
    if(descendantVersionId)expect((await db.select().from(automationArtifactVersions).where(eq(automationArtifactVersions.id,descendantVersionId)))[0]).toMatchObject({sourceCode:"",inputSchema:{},outputSchema:{},testSpec:{},validationReport:null,securityReport:null});
    const [erased] = await db.select().from(automationArtifactVersions).where(eq(automationArtifactVersions.id, replay.artifactVersionId));
    expect(erased).toMatchObject({ sourceCode: "", inputSchema: {}, outputSchema: {}, dependencyManifest: {}, testSpec: {}, validationReport: null, securityReport: null });
    expect((await db.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id, replay.evaluationId)))[0]).toMatchObject({ status: "retired", compilerResult: null, replayEvaluation: null, shadowEvaluation: null });
    await expect(optimizer.startShadow(companyId, replay.evaluationId, principal)).rejects.toBeDefined();
    await db.update(automationArtifactVersions).set({ sourceCode: "Restored private facts" }).where(eq(automationArtifactVersions.id, replay.artifactVersionId));
    expect((await db.select().from(automationArtifactVersions).where(eq(automationArtifactVersions.id, replay.artifactVersionId)))[0]!.sourceCode).toBe("");
    await db.update(workflowOptimizerEvaluations).set({compilerResult:evaluation!.compilerResult,replayEvaluation:evaluation!.replayEvaluation,status:"shadow"}).where(eq(workflowOptimizerEvaluations.id,replay.evaluationId));
    expect((await db.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id,replay.evaluationId)))[0]).toMatchObject({status:"retired",compilerResult:null,replayEvaluation:null});
  }, 60_000);
  it("keeps Role Pack challengers unpublished, preserves required policies and erases descendants", async () => {
    const packs = rolePackService(db), pack = await packs.create(owner, companyId, { key: "learning-ops", name: "Operations", description: "" });
    const baseline = await packs.createVersion(owner, companyId, pack.id, { summary: "Baseline", items: [{ type: "required_policy", ref: "approval_before_side_effects", operation: "add", versionId: null, loadPoint: "always", triggerTerms: [], excludeTerms: [] }] });
    await packs.publish(owner, companyId, pack.id, baseline.id, null);
    await expect(domainProposal(pack.id, `role_pack://${pack.id}/${baseline.id}`, { targetDomain: "role_pack", expectedPublishedVersionId: baseline.id, draft: { items: [], summary: "Remove the approval checkpoint" } })).rejects.toMatchObject({ status: 403 });
    const link = await domainProposal(pack.id, `role_pack://${pack.id}/${baseline.id}`, { targetDomain: "role_pack", expectedPublishedVersionId: baseline.id, draft: { items: baseline.items, summary: "Reviewed outcome evidence improves the approval procedure" } });
    expect((await packs.get(owner, companyId, pack.id)).publishedVersionId).toBe(baseline.id);
    await packs.publish(owner, companyId, pack.id, link.candidateId, baseline.id);
    const descendant = await packs.createVersion(owner, companyId, pack.id, { items: baseline.items, summary: "Later refinement of learned procedure" });
    await db.transaction(async tx => purgeMemoryRecords(tx as unknown as typeof db, companyId, [roots[0]!]));
    expect((await db.select().from(rolePacks).where(eq(rolePacks.id, pack.id)))[0]!.publishedVersionId).toBeNull();
    expect((await db.select().from(rolePackVersions).where(eq(rolePackVersions.id, link.candidateId)))[0]!.summary).toBe("");
    expect((await db.select().from(rolePackVersions).where(eq(rolePackVersions.id, descendant.id)))[0]!.summary).toBe("");
    expect(await db.select().from(rolePackItems).where(eq(rolePackItems.versionId, link.candidateId))).toHaveLength(0);
    await expect(packs.getVersion(owner, companyId, pack.id, link.candidateId)).rejects.toMatchObject({ status: 409 });
    await expect(packs.publish(owner, companyId, pack.id, descendant.id, null)).rejects.toMatchObject({ status: 409 });
  });
  it("retains Workflow challenger roots through publication, executions and later drafts", async () => {
    const service = workflowService(db), created = await service.create(companyId, { name: "Learning workflow", description: null, projectId: null }, principal);
    const graph = { version: 1 as const, nodes: [{ id: "start", type: "core.manual_trigger", name: "Review evidence first", position: { x: 0, y: 0 }, config: {} }], edges: [], variables: [], settings: {} };
    const link = await domainProposal(created.id, `workflow://${created.id}/${created.draftRevisionId}`, { targetDomain: "workflow", draft: { expectedRevisionId: created.draftRevisionId!, graph, changeSummary: "Apply learned early evidence review" } });
    expect((await service.getDetail(companyId, created.id))!.publishedRevisionId).toBeNull();
    const published = await service.publish(companyId, created.id, { expectedDraftRevisionId: link.candidateId, expectedPublishedRevisionId: null, approvalId: null }, principal);
    const [run] = await db.insert(workflowRuns).values({ companyId, workflowId: created.id, workflowRevisionId: link.candidateId, triggerPayload: { copiedLearningDetail: "Outcome evidence" } }).returning();
    expect(run!.memoryRecordIds.sort()).toEqual([...roots].sort());
    const [step] = await db.insert(workflowStepRuns).values({ companyId, workflowRunId: run!.id, nodeId: "start", inputJson: { privateLearning: "Copied source" } }).returning();
    expect(step!.memoryRecordIds.sort()).toEqual([...roots].sort());
    const descendant = await service.updateDraft(companyId, created.id, { expectedRevisionId: published.draftRevisionId!, graph: { ...graph, nodes: [{ ...graph.nodes[0]!, name: "Refined evidence review" }] } }, principal);
    await db.transaction(async tx => purgeMemoryRecords(tx as unknown as typeof db, companyId, [roots[0]!]));
    const after = (await service.getDetail(companyId, created.id))!;
    expect(after).toMatchObject({ status: "paused", draftRevisionId: null, publishedRevisionId: null });
    for (const id of [link.candidateId, descendant.draftRevisionId!]) expect((await db.select().from(workflowRevisions).where(eq(workflowRevisions.id, id)))[0]!.graph.nodes).toEqual([]);
    expect((await db.select().from(workflowRuns).where(eq(workflowRuns.id, run!.id)))[0]).toMatchObject({ status: "cancelled", triggerPayload: {} });
    expect((await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.id, step!.id)))[0]!.inputJson).toBeNull();
    await expect(db.insert(workflowRuns).values({ companyId, workflowId: created.id, workflowRevisionId: link.candidateId })).rejects.toBeDefined();
    await db.update(workflowRevisions).set({ graph }).where(eq(workflowRevisions.id, link.candidateId));
    expect((await db.select().from(workflowRevisions).where(eq(workflowRevisions.id, link.candidateId)))[0]!.graph.nodes).toEqual([]);
  });
  it("keeps analytical Workflow reads, native publication and execution bound to current original sources",async()=>{
    const signal=await analyticalSignal(),service=workflowService(db),created=await service.create(companyId,{name:"Analytical Learning workflow"},principal);
    const graph={version:1 as const,nodes:[{id:"start",type:"core.manual_trigger",name:"Synthetic analytically informed review",position:{x:0,y:0},config:{}}],edges:[],variables:[],settings:{}};
    const link=await domainProposal(created.id,`workflow://${created.id}/${created.draftRevisionId}`,{targetDomain:"workflow",draft:{expectedRevisionId:created.draftRevisionId!,graph,changeSummary:"Verified outcomes and supplemental signal inform this procedure"}},[signal.pin]);
    await expect(service.getDetail(companyId,created.id)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    expect((await service.getDetail(companyId,created.id,owner))!.draftRevision!.graph.nodes[0]!.name).toContain("analytically informed");
    const publish={expectedDraftRevisionId:link.candidateId,expectedPublishedRevisionId:null,approvalId:null};
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,signal.sourceId));
    await expect(service.publish(companyId,created.id,publish,principal)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,signal.sourceId));
    await service.publish(companyId,created.id,publish,principal);
    const executor=workflowExecutorService(db),run=await executor.startManualRun(companyId,created.id,{input:{}},principal,null);
    expect(run.run.status).toBe("succeeded");
    // Persist actual historical child links; this qualifies native erasure, not a provider invocation.
    const [step]=await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.workflowRunId,run.run.id));
    const [identity]=await db.insert(agentIdentities).values({name:"Source-bound Workflow child",homeCompanyId:companyId}).returning();
    const [agent]=await db.insert(agents).values({companyId,agentIdentityId:identity!.id,name:"Source-bound Workflow child"}).returning();
    const [childTask]=await db.insert(issues).values({companyId,title:"Copied analytical procedure",description:"Historical source-informed instructions",assigneeAgentId:agent!.id}).returning();
    const [childRun]=await db.insert(heartbeatRuns).values({companyId,agentId:agent!.id,status:"succeeded",contextSnapshot:{issueId:childTask!.id},resultJson:{procedure:"Historical source-informed result"}}).returning();
    await db.update(workflowStepRuns).set({heartbeatRunId:childRun!.id}).where(eq(workflowStepRuns.id,step!.id));
    await db.insert(workflowWaits).values({companyId,workflowRunId:run.run.id,nodeId:step!.nodeId,waitKey:"historical-child",kind:"task_completion",status:"resolved",resolvedAt:new Date(),referenceType:"issue",referenceId:childTask!.id,resolutionJson:{copied:"Historical source-informed result"}});
    const [trace]=await db.insert(providerTraceRecords).values({companyId,runId:childRun!.id,provider:"fixture",traceRef:`${randomUUID()}.ndjson`,requestedBy:"fixture",expiresAt:new Date(Date.now()+60_000),status:"complete",frameCount:1,byteCount:24,digest:"a".repeat(64)}).returning();
    const erased=()=>db.execute(sql`select aw_workflow_memory_erased(${companyId}::uuid,${childRun!.id}::uuid,${childTask!.id}::uuid) as erased`);
    expect((await erased())[0]).toMatchObject({erased:false});
    await expect(assertAnalyticalContextPayloadAccess(db,companyId,owner,{issueId:childTask!.id})).resolves.toBeUndefined();
    await expect(assertAnalyticalContextPayloadAccess(db,companyId,owner,{runId:childRun!.id})).resolves.toBeUndefined();
    await expect(assertAnalyticalContextPayloadAccess(db,companyId,undefined,{runId:childRun!.id})).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,signal.sourceId));
    await expect(executor.getRun(companyId,run.run.id,owner)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    await expect(executor.listRuns(companyId,created.id,20,owner)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    for(const scope of [{issueId:childTask!.id},{runId:childRun!.id}])await expect(assertAnalyticalContextPayloadAccess(db,companyId,owner,scope)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    await expect(assertAnalyticalContextPayloadAccess(db,companyId,owner,{issueId:tasks[0]!})).resolves.toBeUndefined();
    await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,signal.sourceId));
    await expect(assertAnalyticalContextPayloadAccess(db,companyId,owner,{issueId:childTask!.id})).resolves.toBeUndefined();
    await expect(assertAnalyticalContextPayloadAccess(db,companyId,owner,{runId:childRun!.id})).resolves.toBeUndefined();
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,signal.sourceId));

    await expect(executor.startManualRun(companyId,created.id,{input:{}},principal,null)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    await db.delete(businessMetricObservations).where(eq(businessMetricObservations.id,signal.observation.id));
    // The SQL fence applies before the existing outbox performs physical erasure.
    expect((await erased())[0]).toMatchObject({erased:true});
    await db.update(heartbeatRuns).set({resultJson:{restored:"Write racing the erasure worker"}}).where(eq(heartbeatRuns.id,childRun!.id));
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,childRun!.id)))[0]!.resultJson).toBeNull();
    await instanceSettingsService(db).updateExperimental({learning_engine_v7:false});
    await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
    await memoryJobService(db).tick({limit:10});
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,childRun!.id)))[0]!.contextSnapshot).toEqual({});
    expect((await db.select().from(issues).where(eq(issues.id,childTask!.id)))[0]!.description).toBeNull();
    expect((await db.select().from(providerTraceRecords).where(eq(providerTraceRecords.id,trace!.id)))[0]).toMatchObject({status:"deleted",reason:"source_erased",frameCount:0,byteCount:0,digest:null});
    expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,roots[0]!)))[0]).toMatchObject({deletedAt:null,verificationState:"human_verified",content:"Actual customer outcome 0"});
    expect((await db.select().from(issues).where(eq(issues.id,tasks[0]!)))[0]!.title).toContain("Reviewed outcome");
    await db.update(issues).set({description:"Late restored source prose"}).where(eq(issues.id,childTask!.id));
    expect((await db.select().from(issues).where(eq(issues.id,childTask!.id)))[0]!.description).toBeNull();
    await db.update(providerTraceRecords).set({status:"complete",digest:"b".repeat(64),byteCount:100}).where(eq(providerTraceRecords.id,trace!.id));
    expect((await db.select().from(providerTraceRecords).where(eq(providerTraceRecords.id,trace!.id)))[0]).toMatchObject({status:"deleted",reason:"source_erased",digest:null,byteCount:0});
    await db.update(workflowRuns).set({triggerPayload:{restored:"Late original-source facts"}}).where(eq(workflowRuns.id,run.run.id));
    expect((await db.select().from(workflowRuns).where(eq(workflowRuns.id,run.run.id)))[0]!.triggerPayload).toEqual({});
    await db.update(workflowStepRuns).set({outputJson:{restored:"Late original-source output"}}).where(eq(workflowStepRuns.id,step!.id));
    expect((await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.id,step!.id)))[0]!.outputJson).toBeNull();
  });
  it("requires the actual native approval receipt before completing a cycle and fences closure replays", async () => {
    const { service, cycle, hypothesis, evaluation } = await supported();
    const link = await service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() });
    const current = await service.get(owner, companyId, cycle.id), input = { expectedVersion: current.version, decision: "complete" as const, rationale: "Reviewed the persisted native approval and retained evaluation" };
    expect(current.candidates[0]!.promotionReceipt).toBeNull();
    await expect(service.finish(owner, companyId, cycle.id, input)).rejects.toMatchObject({ status: 409 });
    await foundationService(db).acceptProposal(companyId, targetId, link.candidateId, principal);
    await expect(service.finish(owner, companyId, cycle.id, input)).rejects.toMatchObject({ status: 409 });
    const accepted = (await foundationService(db).get(companyId, targetId))!;
    await foundationService(db).submitForReview(companyId, targetId, accepted.latestRevisionId!, principal);
    await foundationService(db).approve(companyId, targetId, accepted.latestRevisionId!, principal);
    expect((await service.get(owner, companyId, cycle.id)).candidates[0]!.promotionReceipt?.versionId).toBe(accepted.latestRevisionId);
    expect((await service.finish(owner, companyId, cycle.id, input)).status).toBe("completed");
    await expect(service.finish(owner, companyId, cycle.id, input)).rejects.toMatchObject({ status: 409 });
  });
  it("propagates learned Foundation roots into actual Context consumers and erases late runtime writes with Learning off", async () => {
    const { service, hypothesis, evaluation } = await supported();
    const link = await service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() });
    const foundation = foundationService(db);
    await foundation.acceptProposal(companyId, targetId, link.candidateId, principal);
    const accepted = (await foundation.get(companyId, targetId))!;
    await foundation.submitForReview(companyId, targetId, accepted.latestRevisionId!, principal);
    await foundation.approve(companyId, targetId, accepted.latestRevisionId!, principal);
    const [identity] = await db.insert(agentIdentities).values({ name: "Learned Context reader", homeCompanyId: companyId }).returning();
    const [agent] = await db.insert(agents).values({ companyId, agentIdentityId: identity!.id, name: "Learned Context reader" }).returning();
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agent!.id, status: "active" });
    await db.insert(principalPermissionGrants).values([{ companyId, principalType: "agent", principalId: agent!.id, permissionKey: "company_scope:read" }, { companyId, principalType: "agent", principalId: agent!.id, permissionKey: "foundation:read" }]);
    const [task] = await db.insert(issues).values({ companyId, title: "Apply learned evidence review", description: "Retained learned procedure", assigneeAgentId: agent!.id }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent!.id, status: "running", contextSnapshot: { issueId: task!.id, learnedBody: "Evidence review procedure" }, resultJson: { body: "Copied learned evidence" } }).returning();
    const assembled = await contextEngineService(db).assemble({ companyId, agentId: agent!.id, runId: run!.id, issueId: task!.id, query: "evidence review", intent: "native_task_execution" });
    expect(assembled.packet.foundation).toHaveLength(1);
    expect((await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId, assembled.packet.manifest!.id))).map(root => root.memoryRecordId).sort()).toEqual([...roots].sort());
    await instanceSettingsService(db).updateExperimental({ analytical_lineage_v8: true, business_metrics_v8: true, strategy_execution_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true });
    const purpose = analyticalPurpose(); purpose.citation = "learned-strategy-purpose"; purpose.analyticalPurpose!.capabilities = ["strategy"];
    const policy = await aiGovernanceService(db).obligation(owner, companyId, purpose);
    const [goal] = await db.insert(goals).values({ companyId, title: "Reviewed objective" }).returning();
    const [section] = await db.select().from(foundationSections).where(eq(foundationSections.documentRevisionId, accepted.latestRevisionId!));
    const strategy = strategyExecutionService(db);
    const linkDefinition = { to: { type: "goal" as const, id: goal!.id }, relationship: "supports" as const, rationale: "A reviewed hypothesis informed by retained Learning evidence", contribution: null, ownerUserId: "local-board", reviewFrequencyDays: 30, retentionDays: 30, sensitivity: "internal" as const, purpose: "management_intelligence" as const, governanceObligationRefs: [policy.id] };
    const foundationLink = await strategy.create(companyId, owner, { definition: { ...linkDefinition, from: { type: "foundation_section", foundationDocumentId: targetId, approvedRevisionId: accepted.latestRevisionId!, sectionId: section!.id, headingPath: section!.headingPath, contentHash: section!.contentHash } } });
    const taskLink = await strategy.create(companyId, owner, { definition: { ...linkDefinition, from: { type: "issue", id: task!.id } } });
    for (const entry of [foundationLink,taskLink]) await strategy.approve(companyId, owner, entry.link.id, { expectedRevision: 1, versionId: entry.version.id, rationale: "Explicit review retains the approved evidence hypothesis" });
    await instanceSettingsService(db).updateExperimental({ learning_engine_v7: false, strategy_execution_v8: false, business_metrics_v8: false });
    await db.transaction(async tx => purgeMemoryRecords(tx as unknown as typeof db, companyId, [roots[0]!]));
    for (const entry of [foundationLink,taskLink]) {
      expect(await db.select().from(strategyExecutionLinks).where(eq(strategyExecutionLinks.id, entry.link.id))).toHaveLength(0);
      expect(await db.select().from(strategyExecutionLinkVersions).where(eq(strategyExecutionLinkVersions.linkId, entry.link.id))).toHaveLength(0);
    }
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id)))[0]).toMatchObject({ contextSnapshot: {}, resultJson: null });
    expect((await db.select().from(issues).where(eq(issues.id, task!.id)))[0]!.description).toBeNull();
    await db.update(heartbeatRuns).set({ resultJson: { restored: "Late learned source prose" } }).where(eq(heartbeatRuns.id, run!.id));
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id)))[0]!.resultJson).toBeNull();
    await instanceSettingsService(db).updateExperimental({ learning_engine_v7: true });
  });
  it("lets an owned live worker propose a hypothesis but cannot self-review or write after Stop", async () => {
    const [identity] = await db.insert(agentIdentities).values({ name: "Learning worker", homeCompanyId: companyId }).returning();
    const [agent] = await db.insert(agents).values({ companyId, agentIdentityId: identity!.id, name: "Learning worker" }).returning();
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agent!.id, status: "active" });
    await db.insert(principalPermissionGrants).values([{ companyId, principalType: "agent", principalId: agent!.id, permissionKey: "company_scope:read" }, { companyId, principalType: "agent", principalId: agent!.id, permissionKey: "foundation:read" }]);
    const [task] = await db.insert(issues).values({ companyId, title: "Inspect repeated learning outcomes", status: "in_progress", assigneeAgentId: agent!.id }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent!.id, status: "running", contextSnapshot: { issueId: task!.id } }).returning();
    await db.update(issues).set({ checkoutRunId: run!.id, executionRunId: run!.id }).where(eq(issues.id, task!.id));
    const actor = { type: "agent" as const, source: "agent_key" as const, companyId, agentId: agent!.id, runId: run!.id }, service = learningService(db);
    const cycle = await service.create(actor, companyId, cycleInput()), hypothesis = await service.addHypothesis(actor, companyId, cycle.id, hypothesisInput(1));
    expect(cycle.createdBy).toBe(`agent:${agent!.id}`);
    await expect(service.evaluate(actor, companyId, hypothesis.id, evaluationInput(1))).rejects.toMatchObject({ status: 403 });
    await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, run!.id));
    await expect(service.addHypothesis(actor, companyId, cycle.id, hypothesisInput(2))).rejects.toMatchObject({ status: 403 });
  });
  it("cancels a pre-proposal cycle without permitting further evaluation or hypothesis writes", async () => {
    const service = learningService(db), cycle = await service.create(owner, companyId, cycleInput());
    expect((await service.finish(owner, companyId, cycle.id, { expectedVersion: 1, decision: "cancel", rationale: "Stop the unused hypothesis cycle before any domain proposal" })).status).toBe("cancelled");
    await expect(service.addHypothesis(owner, companyId, cycle.id, hypothesisInput(2))).rejects.toMatchObject({ status: 409 });
  });
  it("uses the native Skill challenger lifecycle and still requires native Skill evaluation for promotion", async () => {
    const skills = skillLifecycleService(db), created = await skills.createDraft(owner, companyId, createGovernedSkillSchema.parse({ slug: "learning-procedure", name: "Procedure", markdown: "Keep human approval before changing systems" }));
    const link = await domainProposal(created.skillId, `skill://${created.skillId}/none`, { targetDomain: "skill", candidate: { baseActiveVersionId: null, markdown: "Review evidence before drafting; keep human approval", summary: "Evidence review before drafting", dependencies: [], sharing: "company_proposed" } });
    expect((await db.select().from(companySkillVersions).where(eq(companySkillVersions.id, link.candidateId)))[0]!.state).toBe("candidate");
    expect((await db.select().from(companySkills).where(eq(companySkills.id, created.skillId)))[0]!.activeVersionId).toBeNull();
    await expect(skills.promote(owner, companyId, created.skillId, { versionId: link.candidateId, expectedActiveVersionId: null, evaluationRunId: randomUUID() })).rejects.toBeDefined();
  });
  it("uses the native Playbook proposal without replacing its approved procedure", async () => {
    const playbooks = playbookService(db), created = await playbooks.create(owner, companyId, createPlaybookSchema.parse({ key: "learning-procedure", title: "Procedure", markdown: "Original reviewed procedure" }));
    const link = await domainProposal(created.id, `playbook://${created.id}/none`, { targetDomain: "playbook", proposal: { baseApprovedRevisionId: null, title: "Procedure", markdown: "Review evidence before drafting", reason: "Real outcomes show repeated late evidence review" } });
    expect((await db.select().from(playbookChangeProposals).where(eq(playbookChangeProposals.id, link.candidateId)))[0]!.status).toBe("pending");
    expect((await playbooks.get(owner, companyId, created.id)).approvedRevisionId).toBeNull();
  });
  it("repeats current analytical admission at the original Playbook read and human review owner",async()=>{
    const signal=await analyticalSignal(),playbooks=playbookService(db),created=await playbooks.create(owner,companyId,createPlaybookSchema.parse({key:"analytical-learning-procedure",title:"Procedure",markdown:"Original reviewed procedure"}));
    const link=await domainProposal(created.id,`playbook://${created.id}/none`,{targetDomain:"playbook",proposal:{baseApprovedRevisionId:null,title:"Procedure",markdown:"Review analytical evidence before drafting",reason:"Verified work outcomes and supplemental signal suggest an earlier review"}},[signal.pin]);
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,signal.sourceId));
    await expect(playbooks.get(owner,companyId,created.id)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    await expect(playbooks.reviewProposal(owner,companyId,created.id,link.candidateId,true,"Human review of the original governed procedure")).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,signal.sourceId));
    expect((await playbooks.reviewProposal(owner,companyId,created.id,link.candidateId,true,"Human review of the original governed procedure")).status).toBe("accepted");
    expect((await playbooks.get(owner,companyId,created.id)).document.latestBody).toContain("Review analytical evidence");
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,signal.sourceId));
    await expect(playbooks.get(owner,companyId,created.id)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
  });
  it("checks analytical source admission before native Skill payload reads and promotion",async()=>{
    const signal=await analyticalSignal(),skills=skillLifecycleService(db),created=await skills.createDraft(owner,companyId,createGovernedSkillSchema.parse({slug:"analytical-learning-procedure",name:"Procedure",markdown:"Keep human approval before changing systems"}));
    const link=await domainProposal(created.skillId,`skill://${created.skillId}/none`,{targetDomain:"skill",candidate:{baseActiveVersionId:null,markdown:"Review evidence before drafting; keep human approval",summary:"Supplemental analytical signal informs the procedure",dependencies:[],sharing:"company_proposed"}},[signal.pin]);
    const original=companySkillService(db);
    expect((await original.getVersion(companyId,created.skillId,link.candidateId,owner))?.fileInventory[0]?.content).toContain("Review evidence");
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,signal.sourceId));
    await expect(original.getVersion(companyId,created.skillId,link.candidateId,owner)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    await expect(skills.promote(owner,companyId,created.skillId,{versionId:link.candidateId,expectedActiveVersionId:null,evaluationRunId:randomUUID()})).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
    expect((await db.select().from(companySkills).where(eq(companySkills.id,created.skillId)))[0]!.activeVersionId).toBeNull();
    await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,signal.sourceId));
    expect((await original.getVersion(companyId,created.skillId,link.candidateId,owner))?.fileInventory[0]?.content).toContain("Review evidence");
  });
  it("keeps roadmap dates unchanged and policy proposals behind explicit human acknowledgement", async () => {
    const [project] = await db.insert(projects).values({ companyId, name: "Evidence project" }).returning();
    const [task] = await db.insert(issues).values({ companyId, projectId: project!.id, title: "Plan evidence checkpoint" }).returning();
    const link = await domainProposal(project!.id, `project://${project!.id}/${project!.updatedAt.toISOString()}`, { targetDomain: "project", proposal: { expectedProjectUpdatedAt: project!.updatedAt.toISOString(), changes: [{ issueId: task!.id, expectedUpdatedAt: task!.updatedAt.toISOString(), patch: { estimatedEffortMinutes: 60 } }], reason: "Allow enough time for early evidence review", evidence: [] } });
    expect((await db.select().from(projectRoadmapProposals).where(eq(projectRoadmapProposals.id, link.candidateId)))[0]!.status).toBe("pending");
    expect((await db.select().from(issues).where(eq(issues.id, task!.id)))[0]!.estimatedEffortMinutes).toBeNull();
    const policy = await domainProposal(project!.id, `policy://project/${project!.id}/${project!.updatedAt.toISOString()}`, learningChangeSchema.parse({ targetDomain: "policy", reason: "Use human review for all forecast-driven schedule changes", proposal: { policyType: "project_roadmap", expectedProjectUpdatedAt: project!.updatedAt.toISOString(), policy: {} } }));
    await expect(learningService(db).reviewPolicy(owner, companyId, policy.candidateId, { expectedVersion: 1, decision: "accept", rationale: "Reviewed the effects on approvals and scheduling rules", acknowledgeApprovalOrSecurityChange: false })).rejects.toMatchObject({ status: 403 });
    await learningService(db).reviewPolicy(owner, companyId, policy.candidateId, { expectedVersion: 1, decision: "accept", rationale: "Reviewed the effects on approvals and scheduling rules", acknowledgeApprovalOrSecurityChange: true });
    expect((await db.select().from(projects).where(eq(projects.id, project!.id)))[0]!.roadmapPolicy?.allowLowRiskAgentScheduleUpdates).toBe(false);
  });
  it("keeps failed comparisons out of production even when the challenger is cheaper", async () => {
    const service = learningService(db), cycle = await service.create(owner, companyId, cycleInput()), hypothesis = await service.addHypothesis(owner, companyId, cycle.id, hypothesisInput(1));
    const input = evaluationInput(1); input.cases[0]!.challenger.safety = false; input.cases[0]!.challenger.costCents = 0;
    const evaluation = await service.evaluate(owner, companyId, hypothesis.id, input); expect(evaluation.result).toBe("failed");
    await expect(service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.companyId, companyId))).toHaveLength(0);
    expect((await foundationService(db).get(companyId, targetId))!.latestRevisionId).toBe(revisionId);
  });
  it("creates a domain proposal after reviewed comparison without publishing canonical truth", async () => {
    const { service, hypothesis, evaluation } = await supported(); expect(evaluation.result).toBe("passed"); expect(evaluation.metrics.causalEffectEstablished).toBe(false);
    const link = await service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() });
    const [proposal] = await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.id, link.candidateId)); expect(proposal!.status).toBe("pending");
    expect((await foundationService(db).get(companyId, targetId))!.latestRevisionId).toBe(revisionId);
    await expect(service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects reflected-only evidence, copied cases, forged baselines and unevaluated edits", async () => {
    await db.update(memoryEvidence).set({ sourceRef: `issue://${randomUUID()}` }).where(eq(memoryEvidence.memoryRecordId, roots[0]!));
    await expect(learningService(db).create(owner, companyId, cycleInput())).rejects.toMatchObject({ status: 404 });
    await db.update(memoryEvidence).set({ sourceRef: `issue://${tasks[0]}` }).where(eq(memoryEvidence.memoryRecordId, roots[0]!));
    const { service, hypothesis, evaluation, cycle } = await supported();
    const copied = evaluationInput(2); copied.cases[1] = copied.cases[0]!; await expect(service.evaluate(owner, companyId, hypothesis.id, copied)).rejects.toBeDefined();
    await expect(service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: { ...change(), proposedBody: "An unevaluated security exception" } })).rejects.toMatchObject({ status: 409 });
    const current = await service.get(owner, companyId, cycle.id);
    await expect(service.addHypothesis(owner, companyId, cycle.id, { ...hypothesisInput(current.version), evaluationContract: { ...contract(), baselineRef: `foundation://${targetId}/${randomUUID()}` } })).rejects.toMatchObject({ status: 409 });
  });
  it("serializes hypothesis budgets and rejects agent self-certification and foreign evidence", async () => {
    const service = learningService(db), cycle = await service.create(owner, companyId, { ...cycleInput(), maxHypotheses: 1 });
    const results = await Promise.allSettled([service.addHypothesis(owner, companyId, cycle.id, hypothesisInput(1)), service.addHypothesis(owner, companyId, cycle.id, hypothesisInput(1))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(service.create({ type: "agent", source: "agent_key", companyId, agentId: randomUUID() }, companyId, cycleInput())).rejects.toMatchObject({ status: 403 });
    await expect(service.create(owner, companyId, { ...cycleInput(), memoryRecordIds: [randomUUID()] })).rejects.toMatchObject({ status: 404 });
  });
  it("rechecks current outcomes before creating a proposal", async () => {
    const { service, hypothesis, evaluation } = await supported();
    await db.update(issues).set({ updatedAt: new Date(Date.now() + 1000), status: "in_progress" }).where(eq(issues.id, tasks[3]!));
    await expect(service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() })).rejects.toMatchObject({ status: 409 });
  });
  it("blocks domain acceptance when source evidence changes with V7 disabled", async () => {
    const { service, hypothesis, evaluation } = await supported();
    const link = await service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() });
    await instanceSettingsService(db).updateExperimental({ learning_engine_v7: false });
    await memoryService(db).revoke(companyId, roots[0]!, { reason: "Wrong outcome" }, principal);
    expect((await db.select().from(learningDomainCandidates).where(eq(learningDomainCandidates.id, link.id)))[0]!.invalidatedAt).not.toBeNull();
    await expect(foundationService(db).acceptProposal(companyId, targetId, link.candidateId, principal)).rejects.toBeDefined();
    await instanceSettingsService(db).updateExperimental({ learning_engine_v7: true });
  });
  it("erases accepted derived revisions and prevents restored proposal content from surviving", async () => {
    const { service, hypothesis, evaluation, cycle } = await supported();
    const link = await service.proposeChange(owner, companyId, hypothesis.id, { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change: change() });
    await foundationService(db).acceptProposal(companyId, targetId, link.candidateId, principal);
    const accepted = (await foundationService(db).get(companyId, targetId))!;
    const descendant = await foundationService(db).updateDraft(companyId, targetId, { baseRevisionId: accepted.latestRevisionId!, body: "Later draft retains the learned procedure", changeSummary: "Refine the learned procedure without changing its provenance" }, principal);
    await db.transaction(async (tx) => { await purgeMemoryRecords(tx as unknown as typeof db, companyId, [roots[0]!]); });
    expect((await db.select().from(documentRevisions).where(eq(documentRevisions.id, accepted.latestRevisionId!)))[0]!.body).toBe("");
    expect((await db.select().from(documentRevisions).where(eq(documentRevisions.id, descendant.latestRevisionId!)))[0]!.body).toBe("");
    expect((await db.select().from(learningCycles).where(eq(learningCycles.id, cycle.id)))[0]!.trigger).toBe("");
    expect((await db.select().from(learningHypotheses).where(eq(learningHypotheses.id, hypothesis.id)))[0]!.evaluationContract).toBeNull();
    expect((await db.select().from(learningEvaluations).where(eq(learningEvaluations.id, evaluation.id)))[0]!.cases).toEqual([]);
    await db.update(foundationChangeProposals).set({ proposedBody: "Late restored customer details" }).where(eq(foundationChangeProposals.id, link.candidateId));
    expect((await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.id, link.candidateId)))[0]!.proposedBody).toBe("");
    await db.update(learningHypotheses).set({ claim: "Late restored customer claim", erasedAt: null }).where(eq(learningHypotheses.id, hypothesis.id));
    expect((await db.select().from(learningHypotheses).where(eq(learningHypotheses.id, hypothesis.id)))[0]!.claim).toBe("");
    await db.insert(foundationSections).values({ companyId, foundationDocumentId: targetId, documentRevisionId: accepted.latestRevisionId!, ordinal: 0, headingPath: ["Restored customer"], body: "Late copied customer facts", contentHash: "a".repeat(64), tokenCount: 10 });
    expect((await db.select().from(foundationSections).where(eq(foundationSections.documentRevisionId, accepted.latestRevisionId!)))[0]!.body).toBe("");
    await db.update(memoryRecords).set({ content: "Restored source", deletedAt: null }).where(eq(memoryRecords.id, roots[0]!));
    await reapplyMemoryDeletionMarkers(db, companyId); await expect(service.get(owner, companyId, cycle.id)).rejects.toMatchObject({ status: 404 });
  });
});
