import {disableV8Rollout} from "./helpers/v8-rollout.js";
import {randomUUID} from "node:crypto";
import express from "express";
import request from "supertest";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {and,eq} from "drizzle-orm";
import {companies,projects,causalClaims,causalClaimVersions,causalClaimReviews,causalAnalysisRuns,createDb} from "@paperclipai/db";
import {causalClaimDefinitionSchema,businessMetricDefinitionSchema} from "@paperclipai/shared";
import {causalClaimService} from "../services/causal-claims/service.js";
import {causalClaimRoutes} from "../routes/causal-claims.js";
import {errorHandler} from "../middleware/index.js";
import {businessMetricService} from "../services/business-metrics/service.js";
import {aiGovernanceService} from "../services/ai-governance/governance-service.js";
import {instanceSettingsService} from "../services/instance-settings.js";
import {lockMemoryPrivacy} from "../services/memory/memory-privacy.js";
import {eraseAnalyticalSourcesUnderMemory} from "../services/analytical-source-erasure.js";
import {purgeCompanyContent} from "../services/saas/company-purge.js";
import {analyticalPurpose,metricDefinition} from "./helpers/business-metric-fixture.js";
import {causalClaimFixture} from "./helpers/causal-claim-fixture.js";
import {getEmbeddedPostgresTestSupport,startEmbeddedPostgresTestDatabase} from "./helpers/embedded-postgres.js";
const support=await getEmbeddedPostgresTestSupport(),suite=support.supported?describe:describe.skip;
const actor={type:"board" as const,source:"local_implicit" as const},rationale="Explicit synthetic human model review, not collected causal or business evidence";
const flags={analytical_lineage_v8:true,business_metrics_v8:true,business_experiments_v8:true,causal_claims_v8:true,ai_use_cases_v7:true,governance_evidence_v7:true};
suite("Native causal model/review/source owner on migrated PostgreSQL",()=>{
 let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>,companyId:string,otherId:string,policyId:string;
 beforeAll(async()=>{database=await startEmbeddedPostgresTestDatabase("aw-v8-causal-owner-");db=createDb(database.connectionString);});afterAll(async()=>database?.cleanup());
 beforeEach(async()=>{await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental(flags);companyId=randomUUID();otherId=randomUUID();await db.insert(companies).values([{id:companyId,name:"Native causal fixture",issuePrefix:randomUUID()},{id:otherId,name:"Foreign causal fixture",issuePrefix:randomUUID()}]);const policy=analyticalPurpose();policy.analyticalPurpose!.capabilities=["metrics","causal"];policyId=(await aiGovernanceService(db).obligation(actor,companyId,policy)).id;});
 const service=()=>causalClaimService(db);
 async function proposal(projectId:string|null=null){const definition=metricDefinition(policyId);if(projectId&&definition.calculation.kind==="native_ratio"){definition.calculation.numerator.projectId=projectId;definition.calculation.denominator.projectId=projectId;}const metric=await businessMetricService(db).create(companyId,actor,{key:`metric_${randomUUID().replaceAll("-","")}`,definition:businessMetricDefinitionSchema.parse(definition)});await businessMetricService(db).publish(companyId,actor,metric.metric.id,{expectedRevision:1,versionId:metric.version.id});const seed=causalClaimFixture().definition;const model=causalClaimDefinitionSchema.parse({...seed,outcomeMetricId:metric.metric.id,outcomeMetricVersionId:metric.version.id,experimentEvidence:null,population:{...seed.population,scope:projectId?{type:"project",id:projectId}:{type:"company",id:null}},governanceObligationRefs:[policyId]});return {model,metric};}
 const create=(model:ReturnType<typeof causalClaimDefinitionSchema.parse>)=>service().create(companyId,actor,{key:`claim_${randomUUID().replaceAll("-","")}`,definition:model});
 async function reviewed(){const f=await proposal(),d=await create(f.model),claim=await service().review(companyId,actor,d.claim.id,{expectedRevision:1,versionId:d.version.id,rationale,graphAndAssumptionsAcknowledged:true});return {...f,...d,claim};}
 function app(){const a=express();a.use(express.json());a.use((req,_res,next)=>{req.actor={...actor,userId:"local-board"};next();});a.use("/api",causalClaimRoutes(db));a.use(errorHandler);return a;}
 it("persists a human question, separates review and abstains without an identified dataset instead of inventing effects",async()=>{
  const f=await proposal(),d=await create(f.model);expect(d.claim).toMatchObject({status:"hypothesis",revision:1,reviewedVersionId:null,latestRunId:null});await expect(service().analyze(companyId,actor,d.claim.id,{expectedRevision:1,versionId:d.version.id})).rejects.toMatchObject({status:409});
  const reviewed=await service().review(companyId,actor,d.claim.id,{expectedRevision:1,versionId:d.version.id,rationale,graphAndAssumptionsAcknowledged:true});const result=await service().analyze(companyId,actor,d.claim.id,{expectedRevision:reviewed.revision,versionId:d.version.id});expect(result).toMatchObject({claim:{status:"inconclusive",revision:3},run:{result:{status:"inconclusive",evidenceGrade:"descriptive_only",identification:{status:"unsupported"},estimate:null,executionAuthority:"advisory_only"}}});
  const detail=await service().detail(companyId,actor,d.claim.id);expect(detail.versions[0].run).toEqual(result.run);expect(JSON.stringify(detail)).not.toContain('"signature"');await expect(service().analyze(companyId,actor,d.claim.id,{expectedRevision:3,versionId:d.version.id})).rejects.toMatchObject({status:409});
 });
 it("retains immutable versions/receipts and resets review on explicit amendment with CAS",async()=>{
  const d=await reviewed();const attempts=await Promise.allSettled([1,2].map(()=>service().revise(companyId,actor,d.claim.id,{expectedRevision:2,definition:{...d.model,question:"Which explicit native causal question should be investigated?"},rationale})));expect(attempts.filter(a=>a.status==="fulfilled")).toHaveLength(1);const detail=await service().detail(companyId,actor,d.claim.id);expect(detail.claim).toMatchObject({status:"hypothesis",revision:3,reviewedVersionId:null,latestRunId:null});expect(detail.versions).toHaveLength(2);
  await expect(db.update(causalClaimVersions).set({contentHash:"f".repeat(64)}).where(eq(causalClaimVersions.id,d.version.id))).rejects.toMatchObject({cause:{code:"23514"}});await expect(db.delete(causalClaimReviews).where(eq(causalClaimReviews.claimId,d.claim.id))).rejects.toMatchObject({cause:{code:"23514"}});await expect(service().review(companyId,actor,d.claim.id,{expectedRevision:3,versionId:d.version.id,rationale,graphAndAssumptionsAcknowledged:true})).rejects.toMatchObject({status:409});
 });
 it("requires causal purpose and current human/company authority without borrowing metric permission",async()=>{
  const f=await proposal(),policy=analyticalPurpose();policy.citation="Metric-only fixture purpose";const metricsOnly=await aiGovernanceService(db).obligation(actor,companyId,policy);await expect(create({...f.model,governanceObligationRefs:[metricsOnly.id]})).rejects.toMatchObject({status:409});expect(await db.select().from(causalClaims).where(eq(causalClaims.companyId,companyId))).toHaveLength(0);
  const d=await create(f.model);await expect(service().detail(otherId,actor,d.claim.id)).rejects.toMatchObject({status:404});await expect(service().detail(companyId,{type:"agent",agentId:randomUUID(),runId:null},d.claim.id)).rejects.toMatchObject({status:403});
 });
 it("deferred material proof rejects an empty claim and SQL cannot promote an unreviewed model to support",async()=>{
  await expect(db.transaction(async raw=>{const tx=raw as unknown as typeof db;await tx.insert(causalClaims).values({companyId,key:`bare_${randomUUID().replaceAll("-","")}`,createdBy:"local-board",createdAt:new Date(),updatedAt:new Date()});})).rejects.toMatchObject({code:"23514",message:expect.stringContaining("causal_initial_material_incomplete")});
  const f=await proposal(),d=await create(f.model);await expect(db.update(causalClaims).set({revision:2,status:"supported"}).where(eq(causalClaims.id,d.claim.id))).rejects.toMatchObject({cause:{code:"23514"}});expect((await service().detail(companyId,actor,d.claim.id)).claim.status).toBe("hypothesis");
 });
 it("erases source-owned causal question, review, run and prose with rollout off and company paused",async()=>{
  const [project]=await db.insert(projects).values({companyId,name:"Causal governed source scope",status:"in_progress"}).returning(),f=await proposal(project.id),d=await create(f.model);
  await service().review(companyId,actor,d.claim.id,{expectedRevision:1,versionId:d.version.id,rationale,graphAndAssumptionsAcknowledged:true});await service().analyze(companyId,actor,d.claim.id,{expectedRevision:2,versionId:d.version.id});
  await disableV8Rollout(db);await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));await db.transaction(async raw=>{const tx=raw as unknown as typeof db;await lockMemoryPrivacy(tx,companyId);await eraseAnalyticalSourcesUnderMemory(tx,companyId,"project",[project.id]);});
  for(const table of [causalClaims,causalClaimVersions,causalClaimReviews,causalAnalysisRuns])expect(await db.select().from(table).where(eq(table.companyId,companyId))).toHaveLength(0);
 });
 it("preserves immutable analysis and permits explicit revocation independently of rollout/source disclosure",async()=>{
  const d=await reviewed(),result=await service().analyze(companyId,actor,d.claim.id,{expectedRevision:2,versionId:d.version.id});await expect(db.delete(causalAnalysisRuns).where(eq(causalAnalysisRuns.id,result.run.id))).rejects.toMatchObject({cause:{code:"23514"}});await expect(db.update(causalAnalysisRuns).set({sourceHash:"f".repeat(64)}).where(eq(causalAnalysisRuns.id,result.run.id))).rejects.toMatchObject({cause:{code:"23514"}});
  await disableV8Rollout(db);await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));const revoked=await service().revoke(companyId,actor,d.claim.id,{expectedRevision:3,rationale});expect(revoked).toMatchObject({status:"revoked",revision:4});expect((await db.select().from(causalAnalysisRuns).where(eq(causalAnalysisRuns.id,result.run.id)))[0].result).toEqual(result.run.result);await expect(service().revoke(companyId,actor,d.claim.id,{expectedRevision:4,rationale})).rejects.toMatchObject({status:409});
 });
 it("returns bounded minimal revocation metadata with flags off and company paused, without source admission",async()=>{
  const d=await reviewed();await disableV8Rollout(db);await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
  await expect(service().detail(companyId,actor,d.claim.id)).rejects.toMatchObject({status:404});
  const controls=await service().controls(companyId,actor);expect(controls.items).toEqual([{id:d.claim.id,companyId,revision:2,status:"hypothesis"}]);expect(controls.coverage).toBe("bounded_native_revocation_metadata");
  const response=await request(app()).get(`/api/companies/${companyId}/causal-claims/controls?expectedUserId=local-board`).expect(200);expect(response.headers["cache-control"]).toBe("no-store");expect(response.body.items).toEqual(controls.items);
  await request(app()).get(`/api/companies/${companyId}/causal-claims/controls?includeProse=true`).expect(400);await request(app()).get(`/api/companies/${companyId}/causal-claims/controls?expectedUserId=other`).expect(409);
  await service().revoke(companyId,actor,d.claim.id,{expectedRevision:2,rationale});expect((await service().controls(companyId,actor)).items).toHaveLength(0);
 });
 it("native company purge clears causal descendants with flags off and preserves a foreign tenant",async()=>{
  const d=await reviewed();await service().analyze(companyId,actor,d.claim.id,{expectedRevision:2,versionId:d.version.id});await disableV8Rollout(db);await purgeCompanyContent(db,companyId,{operationId:randomUUID()});for(const table of [causalClaims,causalClaimVersions,causalClaimReviews,causalAnalysisRuns])expect(await db.select().from(table).where(eq(table.companyId,companyId))).toHaveLength(0);expect(await db.select().from(companies).where(eq(companies.id,otherId))).toHaveLength(1);
 });
 it("public commands are strict, account-bound and no-store without accepting caller effects or quality flags",async()=>{
  const f=await proposal(),api=app(),base=`/api/companies/${companyId}/causal-claims`;const valid={key:"native_api_claim",definition:f.model};await request(api).post(base).send({...valid,result:{status:"supported",effect:1}}).expect(400);await request(api).post(base).send({...valid,definition:{...f.model,confidence:0.99}}).expect(400);await request(api).post(base+"?expectedUserId=changed-account").send(valid).expect(409);
  const response=await request(api).post(base+"?expectedUserId=local-board").send(valid).expect(201);expect(response.headers["cache-control"]).toBe("no-store");await request(api).get(base+"?includePrivate=true").expect(400);const detail=await request(api).get(base+"/"+response.body.claim.id+"?expectedUserId=local-board").expect(200);expect(detail.headers["cache-control"]).toBe("no-store");expect(detail.body.versions[0].run).toBeNull();expect(detail.body.versions[0].review).toBeNull();
 });
});
