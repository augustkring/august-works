import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { companies, issues, projects, businessExperiments, businessExperimentAssignments, businessExperimentExposures, businessExperimentExecutions, businessExperimentCompletions, businessExperimentVersions, businessExperimentTransitions, businessExperimentAnalyses, businessExperimentOutcomes, businessExperimentInterpretations, analyticalLineageManifests, analyticalLineageEdges, createDb } from "@paperclipai/db";
import { ISSUE_STATUSES, businessMetricDefinitionSchema } from "@paperclipai/shared";
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
const flags = { analytical_lineage_v8: true, business_metrics_v8: true, business_experiments_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true };
suite("Native experiment final capture and human interpretation on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, companyId: string, otherId: string, policyId: string;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v8-experiment-analysis-"); db = createDb(database.connectionString); });
  afterAll(async () => database?.cleanup());
  beforeEach(async () => {
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags); companyId = randomUUID(); otherId = randomUUID();
    await db.insert(companies).values([{ id: companyId, name: "Recording tenant", issuePrefix: randomUUID() }, { id: otherId, name: "Foreign recording tenant", issuePrefix: randomUUID() }]);
    const policy = analyticalPurpose(); policy.analyticalPurpose!.capabilities = ["metrics", "experiment"];
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
  const analyzed=(d:Awaited<ReturnType<typeof running>>)=>analysis().analyze(companyId,actor,d.experiment.id,{expectedRevision:5,versionId:d.version.id});
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
    if(!imbalance){const interpreted=await analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"ship_candidate",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"});expect(interpreted.experiment.state).toBe("decided");expect(interpreted.interpretation.executionAuthority).toBe("advisory_only");}
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
    await analysis().interpret(companyId,actor,d.experiment.id,{expectedRevision:6,versionId:d.version.id,analysisId:result.analysis.id,conclusion:"iterate",rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"});
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
    await db.transaction(async raw=>{const tx=raw as unknown as typeof db;await lockMemoryPrivacy(tx,companyId);await eraseAnalyticalSourcesUnderMemory(tx,companyId,"project",[project.id]);});
    for(const table of [businessExperimentVersions,businessExperimentAnalyses,businessExperimentOutcomes,businessExperimentInterpretations])expect(await db.select().from(table).where(eq(table.companyId,companyId))).toEqual([]);
    expect(await db.select().from(issues).where(eq(issues.id,unit.unit.id))).toHaveLength(1);
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
