import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { companies, issues, projects, agents, heartbeatRuns, authUsers, companyMemberships, decisions, decisionContexts, decisionContextVersions, decisionExperimentPins, decisionEvidenceLinks, decisionCriteria, decisionExpectedOutcomes, issueComments, causalClaims, causalClaimVersions, causalClaimReviews, causalAnalysisRuns, businessExperiments, businessExperimentAssignments, businessExperimentExposures, businessExperimentExecutions, businessExperimentCompletions, businessExperimentVersions, businessExperimentTransitions, businessExperimentAnalyses, businessExperimentOutcomes, businessExperimentInterpretations, analyticalLineageManifests, analyticalLineageEdges, createDb } from "@paperclipai/db";
import { ISSUE_STATUSES, businessMetricDefinitionSchema, decisionContextDefinitionSchema } from "@paperclipai/shared";
import { causalClaimService } from "../services/causal-claims/service.js";
import { causalClaimFixture } from "./helpers/causal-claim-fixture.js";
import { decisionService } from "../services/decisions.js";
import { decisionIntelligenceService } from "../services/decision-intelligence.js";
import { businessExperimentService } from "../services/business-experiments/service.js";
import { businessExperimentRecordingService } from "../services/business-experiments/recording.js";
import { businessExperimentRoutes } from "../routes/business-experiments.js";
import { errorHandler } from "../middleware/index.js";
import { businessMetricService } from "../services/business-metrics/service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { eraseAnalyticalSourcesUnderMemory } from "../services/analytical-source-erasure.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
import { metricDefinition, analyticalPurpose } from "./helpers/business-metric-fixture.js";
import { experimentDefinition } from "./helpers/business-experiment-fixture.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { businessExperimentAnalysisService } from "../services/business-experiments/analysis.js";
import { experimentAssignmentKey } from "../services/business-experiments/receipts.js";
import { assignNativeBusinessExperimentUnit } from "../services/business-experiments/kernel.js";
const support = await getEmbeddedPostgresTestSupport(), suite = support.supported ? describe : describe.skip;
const actor = { type: "board" as const, source: "local_implicit" as const }, rationale = "Human source-owner recording of this exact non-personal native protocol";
const flags = { analytical_lineage_v8: true, business_metrics_v8: true, business_experiments_v8: true, causal_claims_v8: true, decision_intelligence_v8: true, enableDecisions: true, ai_use_cases_v7: true, governance_evidence_v7: true };
suite("Native experiment final capture and human interpretation on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, companyId: string, otherId: string, policyId: string;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v8-experiment-analysis-"); db = createDb(database.connectionString); });
  afterAll(async () => database?.cleanup());
  beforeEach(async () => {
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags); companyId = randomUUID(); otherId = randomUUID();
    await db.insert(companies).values([{ id: companyId, name: "Recording tenant", issuePrefix: randomUUID() }, { id: otherId, name: "Foreign recording tenant", issuePrefix: randomUUID() }]);
    const policy = analyticalPurpose(); policy.analyticalPurpose!.capabilities = ["metrics", "experiment", "decision", "causal"];
    policyId = (await aiGovernanceService(db).obligation(actor, companyId, policy)).id;
  });
  const analysis = () => businessExperimentAnalysisService(db);
  const registry = () => businessExperimentService(db), recording = () => businessExperimentRecordingService(db);
  async function reviewed(short = false, delay = 86400, confirmatory = false) {
    const metrics = [];
    for (const status of ["done", "cancelled", "in_progress"] as const) {
      const definition = businessMetricDefinitionSchema.parse({ ...metricDefinition(policyId), calculation: { kind: "native_ratio", numerator: { entity: "issue", statuses: [status], projectId: null }, denominator: { entity: "issue", statuses: [...ISSUE_STATUSES], projectId: null } } });
      const source = await businessMetricService(db).create(companyId, actor, { key: `metric_${randomUUID().replaceAll("-", "")}`, definition });
      await businessMetricService(db).publish(companyId, actor, source.metric.id, { expectedRevision: 1, versionId: source.version.id }); metrics.push(source);
    }
    const definition = experimentDefinition(policyId, metrics.map(item => ({ id: item.metric.id, versionId: item.version.id })));
    // Actual PostgreSQL time is used throughout. Synthetic fixture sources are
    // enrolled after the real preregistered start; no mocked database clock.
    definition.sampleOrDurationPlan.from = new Date(Date.now() + 1500).toISOString();
    definition.sampleOrDurationPlan.until = new Date(Date.parse(definition.sampleOrDurationPlan.from) + (confirmatory ? 8000 : short ? 1800 : 60000)).toISOString();
    definition.sampleOrDurationPlan.minimumAssignedUnits = 4;
    definition.analysisPlan.finalCaptureMaxDelaySeconds = delay;
    if(confirmatory){ definition.analysisPlan.familywiseAlpha=0.2; definition.guardrailMetrics[0].maximumAcceptableHarm=1; }
    const d = await registry().create(companyId, actor, { key: `recording_${randomUUID().replaceAll("-", "")}`, definition });
    await registry().transition(companyId, actor, d.experiment.id, { expectedRevision: 1, versionId: d.version.id, state: "in_review", rationale });
    const experiment = await registry().transition(companyId, actor, d.experiment.id, { expectedRevision: 2, versionId: d.version.id, state: "ready", rationale });
    return { ...d, experiment, definition, metrics };
  }
  async function running(short = false, delay = 86400, confirmatory = false) {
    const d = await reviewed(short, delay, confirmatory), experiment = await recording().start(companyId, actor, d.experiment.id, { expectedRevision: 3, versionId: d.version.id, mode: "recording_only_human_attested_native_process", rationale });
    return { ...d, experiment };
  }
  async function insideWindow(d: Awaited<ReturnType<typeof running>>) {
    const remaining = Date.parse(d.definition.sampleOrDurationPlan.from) - Date.now() + 20;
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  }
  async function enrolled(d: Awaited<ReturnType<typeof running>>, status = "todo", projectId: string | null = null) {
    await insideWindow(d);
    const [unit] = await db.insert(issues).values({ companyId, projectId, title: "Synthetic fixture business unit; not a collected operational outcome", status }).returning();
    const assignment = await recording().assign(companyId, actor, d.experiment.id, { expectedRevision: d.experiment.revision, versionId: d.version.id, unitId: unit.id });
    return { unit, assignment };
  }
  function app() {
    const value = express(); value.use(express.json()); value.use((req, _res, next) => { req.actor = { ...actor, userId: "local-board" }; next(); });
    value.use("/api", businessExperimentRoutes(db)); value.use(errorHandler); return value;
  }
  async function closure(d:Awaited<ReturnType<typeof running>>,reason:"fixed_horizon"|"emergency_safety_stop"="fixed_horizon",assessment:"none_identified"|"material_or_unknown"="none_identified"){
    if(reason==="fixed_horizon"){const left=Date.parse(d.definition.sampleOrDurationPlan.until)-Date.now()+10;if(left>0)await new Promise(r=>setTimeout(r,left));}
    return recording().control(companyId,actor,d.experiment.id,{expectedRevision:4,versionId:d.version.id,state:"completed",rationale,completion:{reason,concurrentChangeReview:{assessment,rationale}}});
  }
  async function attested(d:Awaited<ReturnType<typeof running>>,status="todo"){
    const enrolledUnit=await enrolled(d,status);
    await recording().recordExposure(companyId,actor,d.experiment.id,{expectedRevision:4,versionId:d.version.id,assignmentId:enrolledUnit.assignment.id,exposure:{status:"not_applied",rationale}});return enrolledUnit;
  }
  function causalModel(d:Awaited<ReturnType<typeof running>>,analysisId:string,interpretationId:string){const seed=causalClaimFixture().definition;return {...seed,outcomeMetricId:d.definition.primaryMetric.metricId,outcomeMetricVersionId:d.definition.primaryMetric.metricVersionId,population:{...seed.population,scope:d.definition.scope,unit:d.definition.population.randomizationUnit},horizon:{from:d.definition.sampleOrDurationPlan.from,until:d.definition.sampleOrDurationPlan.until},experimentEvidence:{type:"experiment_analysis" as const,id:analysisId,experimentId:d.experiment.id,versionId:d.version.id,interpretationId},governanceObligationRefs:[policyId]};}
  const analyzed=(d:Awaited<ReturnType<typeof running>>)=>analysis().analyze(companyId,actor,d.experiment.id,{expectedRevision:5,versionId:d.version.id});
  async function nativeDecision() {
    await db.insert(authUsers).values({id:"local-board",name:"Local fixture human",email:"experiment-decision@example.test",createdAt:new Date(),updatedAt:new Date()}).onConflictDoNothing();
    await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:"local-board",membershipRole:"member",status:"active"}).onConflictDoNothing();
    const [agent]=await db.insert(agents).values({companyId,name:"Native fixture proposer",role:"engineer",status:"active",adapterType:"codex_local"}).returning();
    const [origin]=await db.insert(issues).values({companyId,title:"Native decision origin",status:"done",responsibleUserId:"local-board"}).returning();
    const [target]=await db.insert(issues).values({companyId,title:"Native decision target",status:"todo",responsibleUserId:"local-board"}).returning();
    const [run]=await db.insert(heartbeatRuns).values({companyId,agentId:agent.id,status:"running",responsibleUserId:"local-board",contextSnapshot:{issueId:origin.id}}).returning();
    const owner=decisionService(db,{wakeOriginAgent:async()=>{}});
    const decision=await owner.create({companyId,actor,agentId:agent.id,runId:run.id,title:"Consider this exact retained experiment?",body:rationale,options:[{id:"proceed",label:"Proceed",effects:[{type:"comment_on_issue",targetIssueId:target.id,staleness:"lenient",bodyMarkdown:"Separate human native choice"}]},{id:"defer",label:"Defer",effects:[]}]});
    return {decision,target,owner};
  }
  function context(source:{id:string;experimentId:string;versionId:string;interpretationId:string}) {
    return decisionContextDefinitionSchema.parse({question:"Should this native proxy evidence inform the option?",objective:rationale,ownerUserId:"local-board",scope:{type:"company",id:null},timeHorizon:{from:new Date().toISOString(),until:new Date(Date.now()+86400000).toISOString()},uncertaintySummary:rationale,revisitAt:null,sensitivity:"internal",purpose:"management_intelligence",governanceObligationRefs:[policyId],retentionDays:1,evidence:[{key:"trial",source:{type:"experiment_analysis",...source},relationship:"experiment_result",optionId:null,criterionKey:null,rationale}],assumptions:[],criteria:[{key:"judgment",name:"Human consideration",description:rationale,type:"qualitative",priority:"high",evidenceKey:null}],expectedOutcomes:[{kind:"qualitative",optionId:"proceed",statement:rationale,reviewAt:new Date(Date.now()+2*86400000).toISOString(),uncertaintySummary:rationale}]});
  }
  it("binds exact interpreted experiment evidence before a separate canonical choice and erases dependent prose from final-capture ancestry",async()=>{
    const d=await running(true),unit=await attested(d),[project]=await db.insert(projects).values({companyId,name:"Experiment final-only ancestry",status:"in_progress"}).returning();
    await db.update(issues).set({projectId:project.id}).where(eq(issues.id,unit.unit.id));await closure(d);const result=await analyzed(d),native=await nativeDecision(),service=decisionIntelligenceService(db);
    const missing=context({id:result.analysis.id,experimentId:d.experiment.id,versionId:d.version.id,interpretationId:randomUUID()});
    await expect(service.propose(companyId,actor,native.decision.id,{expectedRevision:0,definition:missing})).rejects.toMatchObject({status:404});
    const interpreted=await analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"iterate",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"});
    const definition=context({id:result.analysis.id,experimentId:d.experiment.id,versionId:d.version.id,interpretationId:interpreted.interpretation.id});
    const proposed=await service.propose(companyId,actor,native.decision.id,{expectedRevision:0,definition}),pin=proposed.versions[0];
    expect(pin.evidence[0].facts).toMatchObject({status:"inconclusive",humanConclusion:"iterate",executionAuthority:"advisory_only",causalAuthority:"withheld",assignedUnits:1});
    expect((await native.owner.get(native.decision.id))!.status).toBe("open");expect(await db.select().from(issueComments).where(eq(issueComments.issueId,native.target.id))).toHaveLength(0);
    const bindings=await db.select().from(decisionExperimentPins).where(eq(decisionExperimentPins.contextVersionId,pin.id));expect(bindings).toHaveLength(1);
    const [stored]=await db.select().from(decisionContextVersions).where(eq(decisionContextVersions.id,pin.id));
    const [manifest]=await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,stored.lineageManifestId));
    await expect(db.transaction(async raw=>{const tx=raw as unknown as typeof db,versionId=randomUUID(),manifestId=randomUUID();
      await tx.insert(analyticalLineageManifests).values({...manifest,id:manifestId,analysisRef:versionId});
      await tx.insert(decisionContextVersions).values({...stored,id:versionId,revision:2,lineageManifestId:manifestId});
      const fields={companyId,decisionId:native.decision.id,contextVersionId:versionId};
      await tx.insert(decisionEvidenceLinks).values(definition.evidence.map(payload=>({...fields,key:payload.key,payload})));
      await tx.insert(decisionCriteria).values(definition.criteria.map(payload=>({...fields,key:payload.key,payload})));
      await tx.insert(decisionExpectedOutcomes).values(definition.expectedOutcomes.map((payload,i)=>({...fields,key:String(i),payload})));
      // Every ordinary descendant is complete. Only the exact experiment pin
      // is absent: the separate deferred proof must reject COMMIT itself.
    })).rejects.toMatchObject({code:"23514",message:expect.stringContaining("decision_experiment_material_incomplete")});
    await expect(db.delete(decisionExperimentPins).where(eq(decisionExperimentPins.contextVersionId,pin.id))).rejects.toMatchObject({cause:{code:"23514"}});
    await db.update(issues).set({status:"done",updatedAt:new Date()}).where(eq(issues.id,unit.unit.id));
    expect((await service.detail(companyId,actor,native.decision.id)).versions[0].contentHash).toBe(pin.contentHash);
    await service.prepare(companyId,actor,native.decision.id,{expectedRevision:1,versionId:pin.id,rationale});
    const chosen=await native.owner.decide({id:native.decision.id,optionId:"proceed",decidedByUserId:"local-board",userActor:actor});expect(chosen.status).toBe("decided");
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
    await db.transaction(async raw=>{const tx=raw as unknown as typeof db;await lockMemoryPrivacy(tx,companyId);await eraseAnalyticalSourcesUnderMemory(tx,companyId,"project",[project.id]);});
    expect(await db.select().from(decisionContextVersions).where(eq(decisionContextVersions.decisionId,native.decision.id))).toHaveLength(0);
    expect(await db.select().from(decisionExperimentPins).where(eq(decisionExperimentPins.decisionId,native.decision.id))).toHaveLength(0);
    expect((await db.select().from(decisions).where(eq(decisions.id,native.decision.id)))[0].chosenOptionId).toBe("proceed");expect(await db.select().from(issueComments).where(eq(issueComments.issueId,native.target.id))).toHaveLength(1);
  });
  it("rejects cross-tenant/altered interpretations and hidden enrolled sources without admitting a prospective context",async()=>{
    const d=await running(true),unit=await attested(d);await closure(d);const result=await analyzed(d),native=await nativeDecision(),service=decisionIntelligenceService(db);
    const interpreted=await analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"iterate",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"});
    const definition=context({id:result.analysis.id,experimentId:d.experiment.id,versionId:d.version.id,interpretationId:interpreted.interpretation.id});
    await expect(service.propose(otherId,actor,native.decision.id,{expectedRevision:0,definition})).rejects.toMatchObject({status:404});
    for(const source of [{...definition.evidence[0].source,id:randomUUID()},{...definition.evidence[0].source,interpretationId:randomUUID()}]) await expect(service.propose(companyId,actor,native.decision.id,{expectedRevision:0,definition:{...definition,evidence:[{...definition.evidence[0],source}]}})).rejects.toMatchObject({status:404});
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,unit.unit.id));await expect(service.propose(companyId,actor,native.decision.id,{expectedRevision:0,definition})).rejects.toMatchObject({status:404});
    expect(await db.select().from(decisionContexts).where(eq(decisionContexts.decisionId,native.decision.id))).toHaveLength(0);expect((await native.owner.get(native.decision.id))!.status).toBe("open");
  });
  it("inherits current project ancestry at downstream capture without rewriting recorded experiment facts",async()=>{
    const d=await running(true),unit=await attested(d);await closure(d);const result=await analyzed(d),native=await nativeDecision(),service=decisionIntelligenceService(db);
    const interpreted=await analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"iterate",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"});
    const [currentProject]=await db.insert(projects).values({companyId,name:"New downstream current ancestry",status:"in_progress"}).returning();await db.update(issues).set({projectId:currentProject.id}).where(eq(issues.id,unit.unit.id));
    const definition=context({id:result.analysis.id,experimentId:d.experiment.id,versionId:d.version.id,interpretationId:interpreted.interpretation.id});
    const proposed=await service.propose(companyId,actor,native.decision.id,{expectedRevision:0,definition});expect(proposed.versions[0].evidence[0].experiment!.analysis.result).toEqual(result.analysis.result);
    const [stored]=await db.select().from(decisionContextVersions).where(eq(decisionContextVersions.id,proposed.versions[0].id));expect(await db.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.manifestId,stored.lineageManifestId),eq(analyticalLineageEdges.inputType,"project"),eq(analyticalLineageEdges.inputRef,currentProject.id)))).toHaveLength(1);
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));await db.transaction(async raw=>{const tx=raw as unknown as typeof db;await lockMemoryPrivacy(tx,companyId);await eraseAnalyticalSourcesUnderMemory(tx,companyId,"project",[currentProject.id]);});
    expect(await db.select().from(decisionContextVersions).where(eq(decisionContextVersions.decisionId,native.decision.id))).toHaveLength(0);expect(await db.select().from(decisionExperimentPins).where(eq(decisionExperimentPins.decisionId,native.decision.id))).toHaveLength(0);expect((await db.select().from(decisions).where(eq(decisions.id,native.decision.id)))[0].status).toBe("open");
    expect((await db.select().from(businessExperimentAnalyses).where(eq(businessExperimentAnalyses.id,result.analysis.id)))[0].result).toEqual(result.analysis.result);
  });
  it("preserves exact captured experiment results after metric republication and blocks new preparation without rebinding",async()=>{
    const d=await running(true);await attested(d);await closure(d);const result=await analyzed(d),native=await nativeDecision(),service=decisionIntelligenceService(db);
    const interpreted=await analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"iterate",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"});
    const definition=context({id:result.analysis.id,experimentId:d.experiment.id,versionId:d.version.id,interpretationId:interpreted.interpretation.id}),proposed=await service.propose(companyId,actor,native.decision.id,{expectedRevision:0,definition}),pin=proposed.versions[0];
    const owner=businessMetricService(db),metric=d.metrics[0],updated=await owner.createVersion(companyId,actor,metric.metric.id,{expectedRevision:2,definition:{...metric.version.definition,name:"New reasoned metric definition"}});await owner.publish(companyId,actor,metric.metric.id,{expectedRevision:3,versionId:updated.id});
    const retained=await service.detail(companyId,actor,native.decision.id);expect(retained.versions[0].contentHash).toBe(pin.contentHash);expect(retained.versions[0].evidence).toEqual(pin.evidence);expect(retained.versions[0].revalidationRequiredEvidenceKeys).toEqual(["trial"]);
    await expect(service.prepare(companyId,actor,native.decision.id,{expectedRevision:1,versionId:pin.id,rationale})).rejects.toMatchObject({status:409});expect((await native.owner.get(native.decision.id))!.status).toBe("open");
  });
  it.each([false,true])("actual migrated owner admits registered effect only with balanced pretreatment invariants (imbalance=%s)",async(imbalance)=>{
    const d=await running(false,86400,true);await insideWindow(d);const key=experimentAssignmentKey(companyId,d.version.id), counts={control:0,treatment:0};
    // Deliberately balanced synthetic qualification frame. This uses the private
    // test owner solely to make the assertion deterministic, not trial evidence.
    while(counts.control<8||counts.treatment<8){const id=randomUUID(),arm=assignNativeBusinessExperimentUnit(key,companyId,d.version.id,id,0.5);if(counts[arm]>=8)continue;
      await db.insert(issues).values({id,companyId,title:"Deterministic synthetic qualification subject",status:imbalance&&arm==="control"?"todo":"in_progress"});
      const allocation=await recording().assign(companyId,actor,d.experiment.id,{expectedRevision:4,versionId:d.version.id,unitId:id});expect(allocation.arm).toBe(arm);
      await recording().recordExposure(companyId,actor,d.experiment.id,{expectedRevision:4,versionId:d.version.id,assignmentId:allocation.id,exposure:{status:"not_applied",rationale}});
      await db.update(issues).set({status:arm==="treatment"?"done":"todo"}).where(eq(issues.id,id));counts[arm]++;
    }
    await closure(d);const result=await analyzed(d);expect(result.analysis.invariantDiagnostics[0].balanced).toBe(!imbalance);
    expect(result.analysis.result.status).toBe(imbalance?"invalid":"pass");expect(result.analysis.result.numericallyQualified).toBe(!imbalance);
    expect(result.analysis.result.diagnostics).toMatchObject({assigned:16,exposed:0});
    expect((await recording().receipts(companyId,actor,d.experiment.id,d.version.id)).analysis).toEqual(result.analysis);
    if(!imbalance){const interpreted=await analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"ship_candidate",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"});expect(interpreted.experiment.state).toBe("decided");expect(interpreted.interpretation.executionAuthority).toBe("advisory_only");
      const seed=causalClaimFixture().definition,owner=causalClaimService(db),definition={...seed,outcomeMetricId:d.definition.primaryMetric.metricId,outcomeMetricVersionId:d.definition.primaryMetric.metricVersionId,population:{...seed.population,scope:d.definition.scope,unit:d.definition.population.randomizationUnit},horizon:{from:d.definition.sampleOrDurationPlan.from,until:d.definition.sampleOrDurationPlan.until},experimentEvidence:{type:"experiment_analysis" as const,id:result.analysis.id,experimentId:d.experiment.id,versionId:d.version.id,interpretationId:interpreted.interpretation.id},governanceObligationRefs:[policyId]};
      const claim=await owner.create(companyId,actor,{key:`causal_${randomUUID().replaceAll("-","")}`,definition});await owner.review(companyId,actor,claim.claim.id,{expectedRevision:1,versionId:claim.version.id,rationale,graphAndAssumptionsAcknowledged:true});const causal=await owner.analyze(companyId,actor,claim.claim.id,{expectedRevision:2,versionId:claim.version.id});
      expect(causal.run.result).toMatchObject({status:"supported",evidenceGrade:"randomized_experiment",language:"conditional_assignment_effect_on_native_proxy",robustness:{providerRefutations:"not_run",sensitivity:"unknown"},executionAuthority:"advisory_only"});expect(causal.run.result.estimate!.interval).toEqual(result.analysis.result.metrics.find(m=>m.role==="primary")!.interval);expect((await owner.detail(companyId,actor,claim.claim.id)).versions[0].run).toEqual(causal.run);
    }
  });
  it("captures all assigned native outcomes at one actual time including unexposed units, signs immutable receipts and permits one advisory interpretation",async()=>{
    const d=await running(true),unit=await attested(d,"done");await closure(d);const result=await analyzed(d);
    expect(result.experiment.state).toBe("analyzing");expect(result.analysis.result.status).toBe("inconclusive");expect(result.analysis.result.diagnostics).toMatchObject({assigned:1,exposed:0});expect(result.analysis.causalAuthority).toBe("withheld");
    const outcomes=await db.select().from(businessExperimentOutcomes).where(eq(businessExperimentOutcomes.versionId,d.version.id));expect(outcomes).toHaveLength(2);expect(outcomes.map(o=>o.capturedAt.toISOString())).toEqual([result.analysis.analyzedAt,result.analysis.analyzedAt]);expect(outcomes.find(o=>o.key==="primary")?.value).toBe(1);
    const saved=await recording().receipts(companyId,actor,d.experiment.id,d.version.id);expect(saved.analysis).toEqual(result.analysis);expect(JSON.stringify(saved.analysis)).not.toContain("signature");expect(JSON.stringify(saved.analysis)).not.toContain("sourceSnapshot");
    await expect(analyzed(d)).rejects.toMatchObject({status:409});await expect(analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"ship_candidate",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"})).rejects.toMatchObject({status:409});
    const interpreted=await analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"iterate",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"});expect(interpreted.experiment.state).toBe("inconclusive");expect(interpreted.interpretation.executionAuthority).toBe("advisory_only");
    await expect(db.update(businessExperimentOutcomes).set({value:0}).where(eq(businessExperimentOutcomes.id,outcomes[0].id))).rejects.toMatchObject({cause:{code:"23514"}});
    expect((await db.select().from(issues).where(eq(issues.id,unit.unit.id)))[0].status).toBe("done");
  });
  it("withholds inference for a missing exposure receipt and requires explicit human abstention",async()=>{
    const d=await running(true);await enrolled(d);await closure(d);const result=await analyzed(d);expect(result.analysis.result.status).toBe("invalid");expect(result.analysis.result.metrics).toEqual([]);
    await expect(analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"iterate",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"})).rejects.toMatchObject({status:409});
    const result2=await analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"abstain",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"});expect(result2.experiment.state).toBe("invalid");
    await expect(recording().recordExposure(companyId,actor,d.experiment.id,{expectedRevision:7,versionId:d.version.id,assignmentId:(await db.select().from(businessExperimentAssignments).where(eq(businessExperimentAssignments.versionId,d.version.id)))[0].id,exposure:{status:"not_applied",rationale}})).rejects.toMatchObject({status:409});
  });
  it("retains unknown/material concurrent changes as an invalid causal gate without invented effects",async()=>{
    const d=await running(true);await attested(d);await closure(d,"fixed_horizon","material_or_unknown");const result=await analyzed(d);expect(result.analysis.result.status).toBe("invalid");expect(result.analysis.causalAuthority).toBe("withheld");expect(result.analysis.concurrentChangeReview.assessment).toBe("material_or_unknown");
  });
  it("admits explicit safety-stop analysis without future outcomes or confirmatory effects",async()=>{
    const d=await running();await attested(d);await closure(d,"emergency_safety_stop");const result=await analyzed(d);expect(result.analysis.result.status).toBe("inconclusive");expect(result.analysis.result.metrics).toEqual([]);expect(result.analysis.result.reasons).toContain("experiment_safety_stop_or_cancellation_withholds_confirmatory_inference");expect(await db.select().from(businessExperimentOutcomes).where(eq(businessExperimentOutcomes.versionId,d.version.id))).toEqual([]);expect((await recording().receipts(companyId,actor,d.experiment.id,d.version.id)).analysis).toEqual(result.analysis);
  });
  it("a missed preregistered final-capture deadline invalidates actual retained outcomes",async()=>{
    const d=await running(true,1);await attested(d);await closure(d);await new Promise(r=>setTimeout(r,1100));const result=await analyzed(d);expect(result.analysis.result.status).toBe("invalid");expect(result.analysis.result.reasons).toContain("experiment_registered_final_capture_deadline_missed");expect((await recording().receipts(companyId,actor,d.experiment.id,d.version.id)).analysis?.result).toEqual(result.analysis.result);
  });
  it("erases protocol, result and human prose when the actual final-capture project is erased with flags off",async()=>{
    const d=await running(true),unit=await attested(d),[project]=await db.insert(projects).values({companyId,name:"Final capture ancestry",status:"in_progress"}).returning();await db.update(issues).set({projectId:project.id}).where(eq(issues.id,unit.unit.id));await closure(d);const result=await analyzed(d);
    const interpreted=await analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"iterate",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"});
    const causalOwner=causalClaimService(db),causal=await causalOwner.create(companyId,actor,{key:`causal_${randomUUID().replaceAll("-","")}`,definition:causalModel(d,result.analysis.id,interpreted.interpretation.id)});await causalOwner.review(companyId,actor,causal.claim.id,{expectedRevision:1,versionId:causal.version.id,rationale,graphAndAssumptionsAcknowledged:true});expect((await causalOwner.analyze(companyId,actor,causal.claim.id,{expectedRevision:2,versionId:causal.version.id})).run.result.estimate).toBeNull();
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
    await db.transaction(async raw=>{const tx=raw as unknown as typeof db;await lockMemoryPrivacy(tx,companyId);await eraseAnalyticalSourcesUnderMemory(tx,companyId,"project",[project.id]);});
    for(const table of [businessExperimentVersions,businessExperimentAnalyses,businessExperimentOutcomes,businessExperimentInterpretations])expect(await db.select().from(table).where(eq(table.companyId,companyId))).toEqual([]);
    expect(await db.select().from(issues).where(eq(issues.id,unit.unit.id))).toHaveLength(1);
    for(const table of [causalClaims,causalClaimVersions,causalClaimReviews,causalAnalysisRuns])expect(await db.select().from(table).where(eq(table.companyId,companyId))).toHaveLength(0);
  });
  it("actual native company purge includes saved analyses and interpretations with rollout disabled",async()=>{
    const d=await running(true);await attested(d);await closure(d);const result=await analyzed(d);await analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"abstain",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"});
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({});await purgeCompanyContent(db,companyId);
    expect(await db.select().from(businessExperimentAnalyses).where(eq(businessExperimentAnalyses.companyId,companyId))).toEqual([]);expect(await db.select().from(businessExperimentOutcomes).where(eq(businessExperimentOutcomes.companyId,companyId))).toEqual([]);expect(await db.select().from(companies).where(eq(companies.id,otherId))).toHaveLength(1);
  });
  it("rejects omitted final outcomes at deferred commit and blocks ordinary receipt deletion",async()=>{
    const d=await running(true);await attested(d);await closure(d);const result=await analyzed(d),[saved]=await db.select().from(businessExperimentAnalyses).where(eq(businessExperimentAnalyses.id,result.analysis.id));
    await expect(db.delete(businessExperimentAnalyses).where(eq(businessExperimentAnalyses.id,saved.id))).rejects.toMatchObject({cause:{code:"23514"}});
    const [outcome]=await db.select().from(businessExperimentOutcomes).where(eq(businessExperimentOutcomes.analysisId,saved.id));await expect(db.delete(businessExperimentOutcomes).where(eq(businessExperimentOutcomes.id,outcome.id))).rejects.toMatchObject({cause:{code:"23514"}});
    const another=await running(true);await attested(another);await closure(another);
    await expect(db.transaction(async raw=>{const tx=raw as unknown as typeof db;const at=new Date();await tx.insert(businessExperimentTransitions).values({companyId,experimentId:another.experiment.id,versionId:another.version.id,revision:6,fromState:"completed",toState:"analyzing",rationale,createdBy:"local-board",createdAt:at});await tx.update(businessExperiments).set({state:"analyzing",revision:6,updatedAt:at}).where(eq(businessExperiments.id,another.experiment.id));})).rejects.toMatchObject({code:"23514"});
    expect((await recording().receipts(companyId,actor,d.experiment.id,d.version.id)).analysis?.receiptHash).toBe(saved.receiptHash);
  });
  it("public analysis routes reject pasted result/integrity fields and preserve current account/no-store",async()=>{
    const d=await running(true);await attested(d);await closure(d);const app=express();app.use(express.json());app.use((req,_res,next)=>{req.actor=actor;next();});app.use(businessExperimentRoutes(db));app.use(errorHandler);const url=`/companies/${companyId}/experiments/${d.experiment.id}/analyze`;
    const injected=await request(app).post(url).send({expectedRevision:5,versionId:d.version.id,result:"pass",integrity:{telemetryComplete:true}});expect(injected.status).toBe(400);
    const foreign=await request(app).post(`${url}?expectedUserId=someone-else`).send({expectedRevision:5,versionId:d.version.id});expect(foreign.status).toBe(409);expect(foreign.headers["cache-control"]).toBe("no-store");
    const valid=await request(app).post(url).send({expectedRevision:5,versionId:d.version.id});expect(valid.status).toBe(200);expect(valid.body.analysis.exposureProvenance).toBe("human_attestation");expect(valid.headers["cache-control"]).toBe("no-store");
  });
});
