import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {and,eq,sql} from "drizzle-orm";
import {companies,projects,issues,businessMetrics,businessMetricVersions,businessMetricPublications,businessMetricObservations,analyticalLineageManifests,analyticalLineageEdges,forecastSpecs,forecastSpecVersions,forecastBacktests,forecastRuns,forecastPublications,createDb} from "@paperclipai/db";
import {businessForecastDefinitionSchema,businessMetricDefinitionSchema,type BusinessMetricResult} from "@paperclipai/shared";
import {businessForecastService} from "../services/business-forecasting/service.js";
import {businessMetricService} from "../services/business-metrics/service.js";
import {instanceSettingsService} from "../services/instance-settings.js";
import {aiGovernanceService} from "../services/ai-governance/governance-service.js";
import {nativeSha256} from "../services/native-runtime/canonical.js";
import {lockAnalyticalCompany} from "../services/analytical-privacy.js";
import {lockMemoryPrivacy} from "../services/memory/memory-privacy.js";
import {eraseAnalyticalSourcesUnderMemory} from "../services/analytical-source-erasure.js";
import {eraseExpiredAnalyticalLineage} from "../services/analytical-retention.js";
import {purgeCompanyContent} from "../services/saas/company-purge.js";
import {metricDefinition,analyticalPurpose} from "./helpers/business-metric-fixture.js";
import {getEmbeddedPostgresTestSupport,startEmbeddedPostgresTestDatabase} from "./helpers/embedded-postgres.js";
const support=await getEmbeddedPostgresTestSupport(),suite=support.supported?describe:describe.skip;
const actor={type:"board" as const,source:"local_implicit" as const};
const flags={analytical_lineage_v8:true,business_metrics_v8:true,business_forecasting_v8:true,ai_use_cases_v7:true,governance_evidence_v7:true};
const DAY=86_400_000;
suite("Governed native business forecasts on migrated PostgreSQL",()=>{
 let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>,companyId:string,otherId:string,projectId:string,policyId:string;
 beforeAll(async()=>{database=await startEmbeddedPostgresTestDatabase("aw-v8-forecast-");db=createDb(database.connectionString);});
 afterAll(async()=>database?.cleanup());
 beforeEach(async()=>{
  await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental(flags);companyId=randomUUID();otherId=randomUUID();projectId=randomUUID();
  await db.insert(companies).values([{id:companyId,name:"Native forecasting test",issuePrefix:randomUUID()},{id:otherId,name:"Foreign tenant",issuePrefix:randomUUID()}]);
  await db.insert(projects).values({id:projectId,companyId,name:"Synthetic retained historical fixture",createdAt:new Date(Date.now()-20*DAY)});
  const policy=analyticalPurpose();policy.analyticalPurpose!.capabilities=["metrics","forecast"];policyId=(await aiGovernanceService(db).obligation(actor,companyId,policy)).id;
 });
 const service=()=>businessForecastService(db);
 /** Synthetic chronologically coherent fixtures exercise owner/SQL boundaries.
  * They do not establish an actually collected production history or release qualification. */
 async function history(values=Array(10).fill(1) as number[]) {
  const cutoff=new Date(Math.floor(Date.now()/DAY)*DAY),start=new Date(cutoff.getTime()-values.length*DAY),metricId=randomUUID(),versionId=randomUUID();
  const definition=businessMetricDefinitionSchema.parse({...metricDefinition(policyId),valueType:"count",unit:"objects",freshnessSeconds:20*DAY/1000,calculation:{kind:"native_count",population:{entity:"issue",statuses:["done"],projectId}}});
  const definitionHash=nativeSha256(definition),createdAt=new Date(start.getTime()-DAY);
  await db.insert(businessMetrics).values({id:metricId,companyId,key:`history_${randomUUID().replaceAll("-","")}`,createdBy:"local-board",createdAt,updatedAt:createdAt});
  await db.insert(businessMetricVersions).values({id:versionId,companyId,metricId,revision:1,definition,contentHash:definitionHash,createdBy:"local-board",createdAt});
  await db.insert(businessMetricPublications).values({companyId,metricId,versionId,publishedBy:"local-board",publishedAt:createdAt});
  await db.update(businessMetrics).set({revision:2,status:"published",publishedVersionId:versionId,updatedAt:createdAt}).where(eq(businessMetrics.id,metricId));
  const observations:BusinessMetricResult[]=[],sourceIds:string[]=[];
  for(let index=0;index<values.length;index++) {
   const from=new Date(start.getTime()+index*DAY),until=new Date(from.getTime()+DAY),observedAt=until,expiresAt=new Date(Date.now()+20*DAY),id=randomUUID(),manifestId=randomUUID(),inputHash=nativeSha256({index,value:values[index]});
   const ownIds=Array.from({length:values[index]},()=>randomUUID());sourceIds.push(...ownIds);
   if(ownIds.length) await db.insert(issues).values(ownIds.map(id=>({id,companyId,projectId,title:"Fixture source prose must not be copied",status:"done",createdAt:new Date(from.getTime()+12*60*60*1000),updatedAt:new Date(from.getTime()+12*60*60*1000)})));
   await db.insert(analyticalLineageManifests).values({id:manifestId,companyId,analysisType:"business_metric",analysisRef:id,engineVersion:"aw-native-metric-v1",inputHash,definitionHash,requestedBy:"local-board",sourceWatermark:observedAt.toISOString(),sourceCount:ownIds.length,parameters:{syntheticFixture:true},createdAt:observedAt,expiresAt});
   await db.insert(analyticalLineageEdges).values([{companyId,manifestId,inputType:"metric_version",inputRef:versionId,inputHash:definitionHash,relationship:"definition"},
    {companyId,manifestId,inputType:"project",inputRef:projectId,inputHash:nativeSha256({id:projectId}),relationship:"source"},
    {companyId,manifestId,inputType:"governance_obligation",inputRef:policyId,inputHash:(await db.execute<{h:string}>(sql`select obligation_hash as h from governance_obligations where id=${policyId}::uuid`))[0].h,relationship:"policy"},
    ...ownIds.map(source=>({companyId,manifestId,inputType:"issue" as const,inputRef:source,inputHash:nativeSha256({id:source}),relationship:"source" as const}))]);
   const result:BusinessMetricResult={id,companyId,metricId,versionId,from:from.toISOString(),until:until.toISOString(),asOf:observedAt.toISOString(),expiresAt:expiresAt.toISOString(),status:"observed",value:values[index],reason:null,groups:[],inputHash,definitionHash,engineVersion:"aw-native-metric-v1",lineageManifestId:manifestId,sourceWatermark:observedAt.toISOString()};
   await db.insert(businessMetricObservations).values({id,companyId,metricId,versionId,result,definitionHash,inputHash,lineageManifestId:manifestId,requestedBy:"local-board",observedAt,expiresAt});observations.push(result);
  }
  return {metricId,versionId,cutoff,observations,sourceIds};
 }
 const definition=(h:Awaited<ReturnType<typeof history>>)=>businessForecastDefinitionSchema.parse({name:"Daily native workload forecast",businessQuestion:"What workload could be observed next?",decisionUse:"Human capacity review without changing commitments",ownerUserId:"local-board",metricId:h.metricId,metricVersionId:h.versionId,scope:{type:"project",id:projectId},frequency:"daily_utc",horizon:1,provider:"aw_native",candidate:{kind:"naive"},baselines:[{kind:"naive"}],minimumHistory:8,captureLatencySeconds:60,backtest:{minimumTrainingPoints:3,minimumOrigins:3,gapPeriods:1,maximumMAE:1,minimumRelativeMAEImprovement:0},knownFailureModes:["Synthetic fixtures do not qualify a production measurement history"],sensitivity:"internal",purpose:"management_intelligence",governanceObligationRefs:[policyId],retentionDays:20});
 async function draft(source?:Awaited<ReturnType<typeof history>>) {const h=source??await history();const created=await service().create(companyId,actor,{key:`forecast_${randomUUID().replaceAll("-","")}`,definition:definition(h)});return {h,...created};}
 const backtest=(d:Awaited<ReturnType<typeof draft>>)=>service().backtest(companyId,actor,d.spec.id,{expectedRevision:1,versionId:d.version.id,observationIds:d.h.observations.map(item=>item.id),cutoff:d.h.cutoff.toISOString()});
 async function published() {const d=await draft(),test=await backtest(d),spec=await service().publish(companyId,actor,d.spec.id,{expectedRevision:1,versionId:d.version.id,backtestId:test.id,rationale:"Human approval of this exact retained time-safe backtest"});return {...d,test,spec};}
 it("persists separate definitions, native rolling-origin qualification and human publication before a run",async()=>{
  const d=await draft(),test=await backtest(d);expect(test).toMatchObject({kind:"backtest",currentQualification:"qualified",result:{status:"qualified",uncertainty:{method:"unavailable"}}});
  await expect(service().run(companyId,actor,d.spec.id,{expectedRevision:1,versionId:d.version.id,observationIds:d.h.observations.map(item=>item.id),cutoff:d.h.cutoff.toISOString()})).rejects.toMatchObject({status:409});
  const spec=await service().publish(companyId,actor,d.spec.id,{expectedRevision:1,versionId:d.version.id,backtestId:test.id,rationale:"Human approval of the exact native backtest evidence"});
  const run=await service().run(companyId,actor,d.spec.id,{expectedRevision:spec.revision,versionId:d.version.id,observationIds:d.h.observations.map(item=>item.id),cutoff:d.h.cutoff.toISOString()});
  expect((await service().listArtifacts(companyId,actor,d.spec.id,"run")).items.map(item=>item.id)).toEqual([run.id]);
  expect((await service().listArtifacts(companyId,actor,d.spec.id,"backtest")).items.map(item=>item.id)).toEqual([test.id]);
  expect(run).toMatchObject({kind:"run",currentQualification:"qualified",result:{points:[{value:1,interval:null}]}});expect((await db.select().from(forecastPublications).where(eq(forecastPublications.specId,d.spec.id)))[0].rationale).toContain("Human approval");
  expect(JSON.stringify(run)).not.toContain("Fixture source prose");await expect(service().detail(otherId,actor,d.spec.id)).rejects.toMatchObject({status:404});
 });
 it("does not fabricate punctual historic measurements from real queries collected today",async()=>{
  const d=await draft(),ids:string[]=[];
  for(const old of d.h.observations) {const observation=await businessMetricService(db).query(companyId,actor,{metricId:d.h.metricId,versionId:d.h.versionId,from:old.from,until:old.until,dimensions:[],maxRows:100});ids.push(observation.id);}
  const result=await service().backtest(companyId,actor,d.spec.id,{expectedRevision:1,versionId:d.version.id,observationIds:ids,cutoff:new Date().toISOString()});
  expect(result.result).toMatchObject({status:"data_not_ready",reasons:["unsafe_or_late_measurement_capture"],points:[]});
  await expect(service().publish(companyId,actor,d.spec.id,{expectedRevision:1,versionId:d.version.id,backtestId:result.id,rationale:"Attempt to publish a late reconstructed historical series"})).rejects.toMatchObject({status:409});
 });
 it("enforces native bounds, exact pins and expected revision; concurrent edits have one winner",async()=>{
  const d=await draft();await expect(service().backtest(companyId,actor,d.spec.id,{expectedRevision:1,versionId:d.version.id,observationIds:d.h.observations.map(item=>item.id),cutoff:new Date(d.h.cutoff.getTime()-DAY).toISOString()})).rejects.toMatchObject({status:409});
  const outcomes=await Promise.allSettled([service().revise(companyId,actor,d.spec.id,{expectedRevision:1,definition:definition(d.h)}),service().revise(companyId,actor,d.spec.id,{expectedRevision:1,definition:definition(d.h)})]);expect(outcomes.filter(item=>item.status==="fulfilled")).toHaveLength(1);
  await expect(backtest(d)).rejects.toMatchObject({status:409});expect((await service().detail(companyId,actor,d.spec.id)).versions).toHaveLength(2);
 });
 it("abstains when a mathematically accurate drift leaves the native count domain",async()=>{
  const h=await history([10,9,8,7,6,5,4,3,2,1]),input=definition(h);input.candidate={kind:"drift"};input.horizon=3;input.minimumHistory=10;input.backtest.minimumTrainingPoints=3;input.backtest.maximumMAE=0.1;
  const d=await service().create(companyId,actor,{key:"declining_workload",definition:input});const result=await service().backtest(companyId,actor,d.spec.id,{expectedRevision:1,versionId:d.version.id,observationIds:h.observations.map(item=>item.id),cutoff:h.cutoff.toISOString()});
  expect(result.result).toMatchObject({status:"not_qualified",reasons:["prediction_outside_native_metric_value_domain"],points:[]});
 });
 it("retains old math while a later correction invalidates qualification and human publication",async()=>{
  const d=await published(),last=d.h.observations.at(-1)!;
  const correction=await businessMetricService(db).query(companyId,actor,{metricId:d.h.metricId,versionId:d.h.versionId,from:last.from,until:last.until,dimensions:[],maxRows:100});expect(correction.id).not.toBe(last.id);
  const retained=await service().artifact(companyId,actor,d.spec.id,d.test.id,"backtest");expect(retained).toMatchObject({currentQualification:"needs_revalidation",contentHash:d.test.contentHash,result:{status:"qualified"}});
  await expect(service().run(companyId,actor,d.spec.id,{expectedRevision:d.spec.revision,versionId:d.version.id,observationIds:d.h.observations.map(item=>item.id),cutoff:new Date().toISOString()})).rejects.toMatchObject({status:409});
 });
 it("rejects direct SQL rewrites, bare publication pointers and deleting retained immutable evidence",async()=>{
  const d=await draft(),test=await backtest(d);
  await expect(db.update(forecastBacktests).set({contentHash:"a".repeat(64)}).where(eq(forecastBacktests.id,test.id))).rejects.toMatchObject({cause:{code:"23514"}});
  await expect(db.delete(forecastBacktests).where(eq(forecastBacktests.id,test.id))).rejects.toMatchObject({cause:{code:"23514"}});
  await expect(db.update(forecastSpecVersions).set({revision:2}).where(eq(forecastSpecVersions.id,d.version.id))).rejects.toMatchObject({cause:{code:"23514"}});
  await expect(db.update(forecastSpecs).set({status:"published",publishedVersionId:d.version.id,revision:2,updatedAt:new Date()}).where(eq(forecastSpecs.id,d.spec.id))).rejects.toMatchObject({cause:{code:"23514"}});
  await expect(db.update(forecastSpecs).set({revision:2,updatedAt:new Date()}).where(eq(forecastSpecs.id,d.spec.id))).rejects.toMatchObject({cause:{code:"23514"}});
 });
 it("requires an explicitly approved forecast capability and fails closed after rollout or purpose revocation",async()=>{
  const h=await history(),policy=analyticalPurpose();policy.citation="Metrics only policy";const onlyMetrics=(await aiGovernanceService(db).obligation(actor,companyId,policy)).id;
  await expect(service().create(companyId,actor,{key:"purpose_denied",definition:{...definition(h),governanceObligationRefs:[onlyMetrics]}})).rejects.toMatchObject({status:409});
  const d=await draft(h);await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({business_forecasting_v8:false});await expect(service().detail(companyId,actor,d.spec.id)).rejects.toMatchObject({status:404});
 });
 it("erases source-dependent forecasts through native lineage with flags off and keeps canonical and foreign sources",async()=>{
  const d=await published();await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({business_forecasting_v8:false});
  await db.transaction(async raw=>{const tx=raw as unknown as typeof db;await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);await eraseAnalyticalSourcesUnderMemory(tx,companyId,"issue",[d.h.sourceIds[0]]);});
  expect(await db.select().from(forecastSpecs).where(eq(forecastSpecs.id,d.spec.id))).toHaveLength(0);expect(await db.select().from(forecastBacktests).where(eq(forecastBacktests.id,d.test.id))).toHaveLength(0);expect(await db.select().from(issues).where(eq(issues.id,d.h.sourceIds[0]))).toHaveLength(1);
 });
 it("reauthorizes stored observations against current source ancestry before returning retained forecast facts",async()=>{
  const d=await published(),[foreign]=await db.insert(projects).values({companyId:otherId,name:"Currently inaccessible ancestry"}).returning();
  await db.update(issues).set({projectId:foreign.id}).where(eq(issues.id,d.h.sourceIds[0]));
  await expect(service().artifact(companyId,actor,d.spec.id,d.test.id,"backtest")).rejects.toMatchObject({status:403});
  expect(await service().listArtifacts(companyId,actor,d.spec.id,"backtest")).toMatchObject({items:[],coverage:"bounded_current_authorized_page"});
  expect((await db.select().from(forecastBacktests).where(eq(forecastBacktests.id,d.test.id)))[0].contentHash).toBe(d.test.contentHash);
 });
 it("keeps the human retirement control available after rollout rollback",async()=>{
  const d=await published();await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({business_forecasting_v8:false});
  const retired=await service().retire(companyId,actor,d.spec.id,{expectedRevision:d.spec.revision,rationale:"Human retirement while the forecast rollout is disabled"});
  expect(retired).toMatchObject({status:"retired",publishedVersionId:null,revision:d.spec.revision+1});
  await expect(service().retire(companyId,actor,d.spec.id,{expectedRevision:retired.revision,rationale:"Repeated retirement must remain a revision conflict"})).rejects.toMatchObject({status:409});
 });
 it("retention and company purge use native cascade owners after rollout rollback",async()=>{
  const d=await published();await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({business_forecasting_v8:false});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
  await eraseExpiredAnalyticalLineage(db,new Date(Date.now()+21*DAY));expect(await db.select().from(forecastSpecs).where(eq(forecastSpecs.id,d.spec.id))).toHaveLength(0);
  await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental(flags);await db.update(companies).set({status:"active"}).where(eq(companies.id,companyId));const live=await published();
  const foreignProject=(await db.insert(projects).values({companyId:otherId,name:"Foreign canonical survivor"}).returning())[0];await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({business_forecasting_v8:false});await purgeCompanyContent(db,companyId);
  expect(await db.select().from(forecastSpecs).where(eq(forecastSpecs.id,live.spec.id))).toHaveLength(0);expect(await db.select().from(projects).where(eq(projects.id,foreignProject.id))).toHaveLength(1);
 });
});
