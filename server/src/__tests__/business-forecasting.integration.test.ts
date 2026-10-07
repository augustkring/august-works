import {managementAnalyticalFixture} from "./helpers/management-analytical-fixture.js";
import {companyMemberships,analyticalContextRoots,analyticalContextDependencies} from "@paperclipai/db";
import {contextManifestService} from "../services/context/context-manifest.js";
import {PaperclipRunnerToolAuthority} from "../services/native-runtime/paperclip-runner-tool-authority.js";
import {heartbeatMemoryPayloadRetained} from "../services/memory/memory-privacy.js";
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {and,eq,sql} from "drizzle-orm";
import {companies,projects,issues,agents,authUsers,heartbeatRuns,decisions,decisionContexts,decisionContextVersions,decisionContextBindings,decisionCalculationPins,managementReviewSnapshots,decisionEvidenceLinks,decisionAssumptions,decisionCriteria,decisionExpectedOutcomes,businessScenarioRuns,businessMetrics,businessMetricVersions,businessMetricPublications,businessMetricObservations,analyticalLineageManifests,analyticalLineageEdges,forecastSpecs,forecastSpecVersions,forecastBacktests,forecastRuns,forecastPublications,createDb} from "@paperclipai/db";
import {businessForecastDefinitionSchema,businessMetricDefinitionSchema,decisionContextDefinitionSchema,type DecisionEvidenceReference,type BusinessMetricResult} from "@paperclipai/shared";
import {businessForecastService} from "../services/business-forecasting/service.js";
import {businessScenarioService} from "../services/business-scenarios/service.js";
import {decisionIntelligenceService,decisionContextSpecHash} from "../services/decision-intelligence.js";
import {decisionService} from "../services/decisions.js";
import {scenarioDefinition} from "./helpers/business-scenario-fixture.js";
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
const flags={analytical_lineage_v8:true,business_metrics_v8:true,business_forecasting_v8:true,scenario_planning_v8:true,decision_intelligence_v8:true,enableDecisions:true,ai_use_cases_v7:true,governance_evidence_v7:true};
const DAY=86_400_000;
suite("Governed native business forecasts on migrated PostgreSQL",()=>{
 let nativeOwnerUserId:string|null=null;
 let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>,companyId:string,otherId:string,projectId:string,policyId:string;
 beforeAll(async()=>{database=await startEmbeddedPostgresTestDatabase("aw-v8-forecast-");db=createDb(database.connectionString);process.env.PAPERCLIP_DECISION_SIGNING_SECRET="0123456789abcdef0123456789abcdef";await db.insert(authUsers).values({id:"local-board",name:"Local native board",email:"local-board-forecast@example.test",createdAt:new Date(),updatedAt:new Date()});});
 afterAll(async()=>database?.cleanup());
 beforeEach(async()=>{
  nativeOwnerUserId=null;
  await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental(flags);companyId=randomUUID();otherId=randomUUID();projectId=randomUUID();
  await db.insert(companies).values([{id:companyId,name:"Native forecasting test",issuePrefix:randomUUID()},{id:otherId,name:"Foreign tenant",issuePrefix:randomUUID()}]);
  await db.insert(projects).values({id:projectId,companyId,name:"Synthetic retained historical fixture",createdAt:new Date(Date.now()-20*DAY)});
  const policy=analyticalPurpose();policy.analyticalPurpose!.capabilities=["metrics","forecast","scenario","decision"];policyId=(await aiGovernanceService(db).obligation(actor,companyId,policy)).id;
 });
 const service=()=>businessForecastService(db);
 async function nativeDecision() {
  const agentId=randomUUID(),issueId=randomUUID(),runId=randomUUID();
  await db.insert(agents).values({id:agentId,companyId,name:"Native proposer",role:"engineer",status:"active",adapterType:"codex_local"});
  await db.insert(issues).values({id:issueId,companyId,projectId,title:"Separate canonical decision origin",status:"todo",responsibleUserId:"local-board"});
  await db.insert(heartbeatRuns).values({id:runId,companyId,agentId,status:"running",responsibleUserId:"local-board",contextSnapshot:{issueId}});
  return decisionService(db,{wakeOriginAgent:async()=>{}}).create({companyId,actor,agentId,runId,title:"Consider retained conditional evidence?",body:"Native human choice remains separate",options:[{id:"proceed",label:"Proceed",effects:[]},{id:"defer",label:"Defer",effects:[]}]});
 }
 function decisionDefinition(source:DecisionEvidenceReference) {
  return decisionContextDefinitionSchema.parse({question:"Should a human adopt this conditional proposal?",objective:"Review exact advisory evidence before any native choice",ownerUserId:"local-board",scope:{type:"company",id:null},timeHorizon:{from:new Date().toISOString(),until:new Date(Date.now()+DAY).toISOString()},uncertaintySummary:"Native forecasts and scenarios are conditional rather than measured causal outcomes",revisitAt:null,sensitivity:"internal",purpose:"management_intelligence",governanceObligationRefs:[policyId],retentionDays:10,
   evidence:[{key:"calculation",source,relationship:"supports_option",optionId:"proceed",criterionKey:null,rationale:"Human review of the exact retained calculation and limitations"}],assumptions:[],criteria:[{key:"review",name:"Human evidence review",description:"Conditional evidence informs a qualitative human assessment",type:"qualitative",priority:"high",evidenceKey:"calculation"}],expectedOutcomes:[{kind:"qualitative",optionId:"proceed",statement:"Review observed business outcomes after the declared horizon",reviewAt:new Date(Date.now()+2*DAY).toISOString(),uncertaintySummary:"No calibrated prediction or causal identification is claimed"}]});
 }
 async function prepareCalculation(decisionId:string,source:DecisionEvidenceReference) {
  const contexts=decisionIntelligenceService(db),proposal=await contexts.propose(companyId,actor,decisionId,{expectedRevision:0,definition:decisionDefinition(source)});
  return contexts.prepare(companyId,actor,decisionId,{expectedRevision:proposal.revision,versionId:proposal.versions[0].id,rationale:"Human review of this exact native calculation without automatic choice"});
 }
 /** Synthetic chronologically coherent fixtures exercise owner/SQL boundaries.
  * They do not establish an actually collected production history or release qualification. */
 async function history(values=Array(10).fill(1) as number[]) {
  const cutoff=new Date(Math.floor(Date.now()/DAY)*DAY),start=new Date(cutoff.getTime()-values.length*DAY),metricId=randomUUID(),versionId=randomUUID();
  const definition=businessMetricDefinitionSchema.parse({...metricDefinition(policyId),ownerUserId:nativeOwnerUserId??"local-board",valueType:"count",unit:"objects",freshnessSeconds:20*DAY/1000,calculation:{kind:"native_count",population:{entity:"issue",statuses:["done"],projectId}}});
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
 const definition=(h:Awaited<ReturnType<typeof history>>)=>businessForecastDefinitionSchema.parse({name:"Daily native workload forecast",businessQuestion:"What workload could be observed next?",decisionUse:"Human capacity review without changing commitments",ownerUserId:nativeOwnerUserId??"local-board",metricId:h.metricId,metricVersionId:h.versionId,scope:{type:"project",id:projectId},frequency:"daily_utc",horizon:1,provider:"aw_native",candidate:{kind:"naive"},baselines:[{kind:"naive"}],minimumHistory:8,captureLatencySeconds:60,backtest:{minimumTrainingPoints:3,minimumOrigins:3,gapPeriods:1,maximumMAE:1,minimumRelativeMAEImprovement:0},knownFailureModes:["Synthetic fixtures do not qualify a production measurement history"],sensitivity:"internal",purpose:"management_intelligence",governanceObligationRefs:[policyId],retentionDays:20});
 async function draft(source?:Awaited<ReturnType<typeof history>>) {const h=source??await history();const created=await service().create(companyId,actor,{key:`forecast_${randomUUID().replaceAll("-","")}`,definition:definition(h)});return {h,...created};}
 const backtest=(d:Awaited<ReturnType<typeof draft>>)=>service().backtest(companyId,actor,d.spec.id,{expectedRevision:1,versionId:d.version.id,observationIds:d.h.observations.map(item=>item.id),cutoff:d.h.cutoff.toISOString()});
 async function published() {const d=await draft(),test=await backtest(d),spec=await service().publish(companyId,actor,d.spec.id,{expectedRevision:1,versionId:d.version.id,backtestId:test.id,rationale:"Human approval of this exact retained time-safe backtest"});return {...d,test,spec};}
 it("discovers only original human-published Forecast metadata through a real native consumer and closes on original measurement deletion",async()=>{
  nativeOwnerUserId=randomUUID();const agentId=randomUUID(),issueId=randomUUID(),runId=randomUUID();
  await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({...flags,management_reviews_v8:true,management_chat_tools_v8:true,enableContextEngineV1:true});
  await db.insert(authUsers).values({id:nativeOwnerUserId,name:"Actual metadata reader",email:`${nativeOwnerUserId}@example.test`,createdAt:new Date(),updatedAt:new Date()});
  await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:nativeOwnerUserId,membershipRole:"admin",status:"active"});
  await db.insert(agents).values({id:agentId,companyId,name:"Actual native Forecast reader",role:"engineer",status:"active",adapterType:"paperclip_runner"});
  await db.insert(issues).values({id:issueId,companyId,title:"Private native Forecast conversation",assigneeAgentId:agentId,conversationAgentId:agentId,conversationUserId:nativeOwnerUserId,conversationState:"active",responsibleUserId:nativeOwnerUserId});
  await db.insert(heartbeatRuns).values({id:runId,companyId,agentId,nativeIssueId:issueId,runtimeMode:"native",status:"running",responsibleUserId:nativeOwnerUserId});
  await db.update(issues).set({executionRunId:runId}).where(eq(issues.id,issueId));
  await contextManifestService(db).create({companyId,agentId,issueId,runId,query:"Published Forecast metadata",policySnapshot:{syntheticSoftwareFixture:true},selected:[]});
  const d=await published();await service().revise(companyId,actor,d.spec.id,{expectedRevision:d.spec.revision,definition:{...d.version.definition,name:"Private pending Forecast definition"}});
  const authority=new PaperclipRunnerToolAuthority(db,{companyId,agentId,issueId,runId,managementToolsEnabled:true});
  const listed=await authority.execute({tool:"list_forecasts",callId:randomUUID(),arguments:{limit:1}});
  expect(listed).toMatchObject({result:{items:[{specId:d.spec.id,versionId:d.version.id,grade:"native_definition",measurement:null,currentQualification:"qualified"}]}});
  expect(JSON.stringify(listed)).not.toContain("Private pending");
  const [root]=await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId));
  expect(root!.sourceCount).toBe(12);expect(await db.select().from(analyticalContextDependencies).where(eq(analyticalContextDependencies.companyId,companyId))).toHaveLength(12);
  await db.delete(businessMetricObservations).where(eq(businessMetricObservations.id,d.h.observations[0]!.id));
  expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);
 });
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
 it("composes an exact qualified native point and erases dependent scenario prose through the forecast owner",async()=>{
  const d=await published(),run=await service().run(companyId,actor,d.spec.id,{expectedRevision:d.spec.revision,versionId:d.version.id,observationIds:d.h.observations.map(item=>item.id),cutoff:d.h.cutoff.toISOString()});
  const scenarios=businessScenarioService(db),definition=scenarioDefinition(policyId,{kind:"forecast_point",key:"forecast",specId:d.spec.id,versionId:d.version.id,runId:run.id,pointIndex:0,unit:{issue:1}});
  const proposal=await scenarios.create(companyId,actor,{key:"forecast_composition",definition});
  await scenarios.publish(companyId,actor,proposal.scenario.id,{expectedRevision:1,versionId:proposal.version.id,rationale:"Human approval of an exact forecast point and conditional assumptions"});
  const result=await scenarios.run(companyId,actor,proposal.scenario.id,{expectedRevision:2,versionId:proposal.version.id,seed:null});
  expect(result.result.cases[0].outputs[0].nominal).toBe(run.result.points[0].value*2);
  const forecastRow=(await db.select().from(forecastRuns).where(eq(forecastRuns.id,run.id)))[0];
  await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({scenario_planning_v8:false,business_forecasting_v8:false});
  await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,forecastRow.lineageManifestId));
  expect((await db.execute<{n:number}>(sql`select count(*)::integer as n from business_scenarios where id=${proposal.scenario.id}::uuid`))[0].n).toBe(0);
  expect(await db.select().from(issues).where(eq(issues.id,d.h.sourceIds[0]))).toHaveLength(1);
 });
 it("pins an exact native forecast point to prospective context and preserves the chosen historical basis on retirement",async()=>{
  const d=await published(),run=await service().run(companyId,actor,d.spec.id,{expectedRevision:d.spec.revision,versionId:d.version.id,observationIds:d.h.observations.map(item=>item.id),cutoff:d.h.cutoff.toISOString()}),decision=await nativeDecision();
  const ref:DecisionEvidenceReference={type:"forecast_run",id:run.id,specId:d.spec.id,versionId:d.version.id,pointIndex:0},contexts=decisionIntelligenceService(db),prepared=await prepareCalculation(decision.id,ref);
  const management=await managementAnalyticalFixture(db,companyId,[ref]);expect(management.original.sources[0].grade).toBe("predictive");expect(management.original.sources[0].facts.value).toBe(1);expect(management.original.currentQualification).toBe("current");
  expect(prepared.versions[0].evidence[0].facts).toMatchObject({value:1,intervalLower:null,intervalUpper:null,calibration:"not_assessed"});
  expect((await db.select().from(decisions).where(eq(decisions.id,decision.id)))[0].status).toBe("open");
  expect(await db.select().from(decisionCalculationPins).where(eq(decisionCalculationPins.decisionId,decision.id))).toMatchObject([{forecastRunId:run.id,scenarioRunId:null,sourceHash:prepared.versions[0].evidence[0].sourceHash}]);
  await expect(db.delete(decisionCalculationPins).where(eq(decisionCalculationPins.decisionId,decision.id))).rejects.toMatchObject({cause:{code:"23514"}});
  await expect(db.update(decisionCalculationPins).set({sourceHash:"f".repeat(64)}).where(eq(decisionCalculationPins.decisionId,decision.id))).rejects.toMatchObject({cause:{code:"23514"}});
  await decisionService(db,{wakeOriginAgent:async()=>{}}).decide({id:decision.id,optionId:"proceed",decidedByUserId:"local-board",userActor:actor});
  await service().retire(companyId,actor,d.spec.id,{expectedRevision:d.spec.revision,rationale:"Human retirement after an earlier exact choice used this forecast"});
  const managementRetained=await management.read();expect(managementRetained.currentQualification).toBe("needs_revalidation");expect(managementRetained.sources).toEqual(management.original.sources);expect(managementRetained.packet).toEqual(management.original.packet);await expect(management.publish()).rejects.toMatchObject({status:409});await expect(management.recapture()).rejects.toMatchObject({status:409});
  const retained=await contexts.detail(companyId,actor,decision.id);
  expect(retained.versions[0].contentHash).toBe(prepared.versions[0].contentHash);expect(retained.versions[0].revalidationRequiredEvidenceKeys).toEqual(["calculation"]);
  const next=await nativeDecision();await expect(prepareCalculation(next.id,ref)).rejects.toMatchObject({status:409});expect(await db.select().from(decisionContexts).where(eq(decisionContexts.decisionId,next.id))).toHaveLength(0);
  const [source]=await db.select().from(forecastRuns).where(eq(forecastRuns.id,run.id));
  await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({business_forecasting_v8:false,decision_intelligence_v8:false});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
  await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,source.lineageManifestId));
  expect(await db.select().from(managementReviewSnapshots).where(eq(managementReviewSnapshots.id,management.created.id))).toHaveLength(0);
  expect(await db.select().from(decisionContextVersions).where(eq(decisionContextVersions.decisionId,decision.id))).toHaveLength(0);expect(await db.select().from(decisionContextBindings).where(eq(decisionContextBindings.decisionId,decision.id))).toHaveLength(0);
  expect((await db.select().from(decisions).where(eq(decisions.id,decision.id)))[0].chosenOptionId).toBe("proceed");expect(await db.select().from(projects).where(eq(projects.id,projectId))).toHaveLength(1);
 });
 it("pins exact conditional scenario outputs without treating them as actuals and erases dependent context through its owner",async()=>{
  const scenarios=businessScenarioService(db),proposal=await scenarios.create(companyId,actor,{key:"decision_conditions",definition:scenarioDefinition(policyId)});
  await scenarios.publish(companyId,actor,proposal.scenario.id,{expectedRevision:1,versionId:proposal.version.id,rationale:"Human approval of these explicit synthetic conditional assumptions"});
  const run=await scenarios.run(companyId,actor,proposal.scenario.id,{expectedRevision:2,versionId:proposal.version.id,seed:null}),decision=await nativeDecision(),ref:DecisionEvidenceReference={type:"scenario_run",id:run.id,scenarioId:run.scenarioId,versionId:run.versionId,caseKey:"option",outputKey:"capacity"};
  const prepared=await prepareCalculation(decision.id,ref);expect(prepared.versions[0].evidence[0].facts).toMatchObject({nominal:3,differenceFromBase:1,p10:null,uncertaintyMethod:"deterministic",uncertaintyQualification:"not_assessed"});expect(prepared.versions[0].evidence[0].facts.value).toBeUndefined();
  const pins=await db.select().from(decisionCalculationPins).where(eq(decisionCalculationPins.decisionId,decision.id));expect(pins).toMatchObject([{scenarioRunId:run.id,forecastRunId:null}]);
  const next=await nativeDecision();await expect(prepareCalculation(next.id,{...ref,versionId:randomUUID()})).rejects.toMatchObject({status:404});await expect(prepareCalculation(next.id,{...ref,caseKey:"missing"})).rejects.toMatchObject({status:409});
  expect(await db.select().from(decisionContexts).where(eq(decisionContexts.decisionId,next.id))).toHaveLength(0);
  await decisionService(db,{wakeOriginAgent:async()=>{}}).decide({id:decision.id,optionId:"defer",decidedByUserId:"local-board",userActor:actor});
  const [source]=await db.select().from(businessScenarioRuns).where(eq(businessScenarioRuns.id,run.id));
  await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({scenario_planning_v8:false,decision_intelligence_v8:false});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
  await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,source.lineageManifestId));
  expect(await db.select().from(decisionContextVersions).where(eq(decisionContextVersions.decisionId,decision.id))).toHaveLength(0);expect(await db.select().from(decisionCalculationPins).where(eq(decisionCalculationPins.decisionId,decision.id))).toHaveLength(0);
  expect((await db.select().from(decisions).where(eq(decisions.id,decision.id)))[0].chosenOptionId).toBe("defer");expect(await db.select().from(projects).where(eq(projects.id,projectId))).toHaveLength(1);
 });
 it("blocks a prepared choice after scenario replacement and denies confidential calculation downgrading",async()=>{
  const scenarios=businessScenarioService(db),definition=scenarioDefinition(policyId),proposal=await scenarios.create(companyId,actor,{key:"prospective_conditions",definition});
  await scenarios.publish(companyId,actor,proposal.scenario.id,{expectedRevision:1,versionId:proposal.version.id,rationale:"Explicit human review before prospective evidence capture"});
  const run=await scenarios.run(companyId,actor,proposal.scenario.id,{expectedRevision:2,versionId:proposal.version.id,seed:null}),decision=await nativeDecision(),ref:DecisionEvidenceReference={type:"scenario_run",id:run.id,scenarioId:run.scenarioId,versionId:run.versionId,caseKey:"option",outputKey:"capacity"};
  const management=await managementAnalyticalFixture(db,companyId,[ref]);expect(management.original.sources[0].grade).toBe("conditional_scenario");
  const prepared=await prepareCalculation(decision.id,ref),replacement=await scenarios.revise(companyId,actor,proposal.scenario.id,{expectedRevision:2,definition:{...definition,objective:"A new human proposal changes the currently reviewed conditional model"}});
  // Drafting alone preserves the previous publication. Explicit human
  // publication replaces the currently reviewed source basis.
  await scenarios.publish(companyId,actor,proposal.scenario.id,{expectedRevision:replacement.scenario.revision,versionId:replacement.version.id,rationale:"Human publication replaces the exact formerly admitted scenario basis"});
  await expect(decisionService(db,{wakeOriginAgent:async()=>{}}).decide({id:decision.id,optionId:"proceed",decidedByUserId:"local-board",userActor:actor})).rejects.toMatchObject({status:409});
  expect((await db.select().from(decisions).where(eq(decisions.id,decision.id)))[0].status).toBe("open");expect(await db.select().from(decisionContextBindings).where(eq(decisionContextBindings.decisionId,decision.id))).toHaveLength(0);
  const managementRetained=await management.read();expect(managementRetained.currentQualification).toBe("needs_revalidation");expect(managementRetained.sources).toEqual(management.original.sources);expect(managementRetained.packet).toEqual(management.original.packet);await expect(management.publish()).rejects.toMatchObject({status:409});await expect(management.recapture()).rejects.toMatchObject({status:409});
  const retained=await decisionIntelligenceService(db).detail(companyId,actor,decision.id);expect(retained.versions[0].contentHash).toBe(prepared.versions[0].contentHash);expect(retained.versions[0].revalidationRequiredEvidenceKeys).toEqual(["calculation"]);
  const policy=analyticalPurpose();policy.citation="Confidential scenario evidence purpose";policy.analyticalPurpose!.capabilities=["metrics","scenario"];policy.analyticalPurpose!.permittedSensitivity=["internal","confidential"];
  const confidentialPolicy=(await aiGovernanceService(db).obligation(actor,companyId,policy)).id,secret=await scenarios.create(companyId,actor,{key:"confidential_conditions",definition:{...scenarioDefinition(confidentialPolicy),sensitivity:"confidential"}});
  await scenarios.publish(companyId,actor,secret.scenario.id,{expectedRevision:1,versionId:secret.version.id,rationale:"Human approval of a confidential conditional model"});
  const secretRun=await scenarios.run(companyId,actor,secret.scenario.id,{expectedRevision:2,versionId:secret.version.id,seed:null}),next=await nativeDecision();
  await expect(prepareCalculation(next.id,{type:"scenario_run",id:secretRun.id,scenarioId:secretRun.scenarioId,versionId:secretRun.versionId,caseKey:"base",outputKey:"capacity"})).rejects.toMatchObject({status:403});
  expect(await db.select().from(decisionContexts).where(eq(decisionContexts.decisionId,next.id))).toHaveLength(0);
 });
 it("rejects an otherwise complete restored context whose calculation source descendant was omitted",async()=>{
  const scenarios=businessScenarioService(db),proposal=await scenarios.create(companyId,actor,{key:"restore_conditions",definition:scenarioDefinition(policyId)});
  await scenarios.publish(companyId,actor,proposal.scenario.id,{expectedRevision:1,versionId:proposal.version.id,rationale:"Human approval before native source-pin restoration qualification"});
  const run=await scenarios.run(companyId,actor,proposal.scenario.id,{expectedRevision:2,versionId:proposal.version.id,seed:null}),original=await nativeDecision();
  await prepareCalculation(original.id,{type:"scenario_run",id:run.id,scenarioId:run.scenarioId,versionId:run.versionId,caseKey:"base",outputKey:"capacity"});
  const [old]=await db.select().from(decisionContextVersions).where(eq(decisionContextVersions.decisionId,original.id)),next=await nativeDecision(),newId=randomUUID(),manifestId=randomUUID();
  await expect(db.transaction(async raw=>{
    const tx=raw as unknown as typeof db;await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);
    const now=new Date(),[decision]=await tx.select().from(decisions).where(eq(decisions.id,next.id)),decisionSpecHash=decisionContextSpecHash(decision),contentHash=nativeSha256({definition:old.definition,evidence:old.evidence,decisionSpecHash});
    await tx.insert(decisionContexts).values({companyId,decisionId:next.id});
    const [manifest]=await tx.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,old.lineageManifestId)),edges=await tx.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId,old.lineageManifestId));
    await tx.insert(analyticalLineageManifests).values({...manifest,id:manifestId,analysisRef:newId,definitionHash:contentHash,createdAt:now,parameters:{...manifest.parameters,decisionId:next.id,decisionSpecHash}});
    await tx.insert(analyticalLineageEdges).values(edges.map(({id:_id,...edge})=>({...edge,manifestId})));
    await tx.insert(decisionContextVersions).values({...old,id:newId,decisionId:next.id,contentHash,decisionSpecHash,lineageManifestId:manifestId,createdAt:now});
    for(const table of [decisionEvidenceLinks,decisionAssumptions,decisionCriteria,decisionExpectedOutcomes]) {
      const material=await tx.select().from(table).where(eq(table.contextVersionId,old.id));
      if(material.length) await tx.insert(table).values(material.map(item=>({...item,decisionId:next.id,contextVersionId:newId})));
    }
    await tx.update(decisionContexts).set({revision:1}).where(eq(decisionContexts.decisionId,next.id));
    // Calculation pin deliberately omitted. All older material descendants exist.
  })).rejects.toMatchObject({code:"23514",message:expect.stringContaining("decision_context_material_incomplete")});
  expect(await db.select().from(decisionContextVersions).where(eq(decisionContextVersions.id,newId))).toHaveLength(0);expect(await db.select().from(decisionContexts).where(eq(decisionContexts.decisionId,next.id))).toHaveLength(0);
 });
});
