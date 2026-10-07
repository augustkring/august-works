import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {providerTraceStore} from "../services/provider-trace-store.js";
import {memoryJobService} from "../services/memory/memory-jobs.js";
import express from "express";
import request from "supertest";
import {issueService} from "../services/issues.js";
import {issueRoutes} from "../routes/issues.js";
import {errorHandler} from "../middleware/index.js";
import {randomUUID} from "node:crypto";
import {createServer} from "node:http";
import {once} from "node:events";
import {WebSocket} from "ws";
import {setupLiveEventsWebSocketServer} from "../realtime/live-events-ws.js";
import {publishLiveEvent} from "../services/live-events.js";
import {analyticalLiveEventForReader} from "../services/analytical-live-events.js";
import {appendHeartbeatRunEvent} from "../services/heartbeat-run-events.js";
import type {LiveEvent} from "@paperclipai/shared";
import {and,eq,sql} from "drizzle-orm";
import {agents,authUsers,companies,companyMemberships,heartbeatRuns,heartbeatRunEvents,issues,issueComments,businessMetrics,businessMetricVersions,businessMetricPublications,businessMetricObservations,governanceObligations,analyticalLineageManifests,analyticalContextRoots,analyticalContextDependencies,memoryRecords,contextManifestMemoryRoots,providerTraceRecords,memoryJobs,createDb} from "@paperclipai/db";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {instanceSettingsService} from "../services/instance-settings.js";
import {businessMetricService} from "../services/business-metrics/service.js";
import {aiGovernanceService} from "../services/ai-governance/governance-service.js";
import {contextManifestService} from "../services/context/context-manifest.js";
import {assertAnalyticalContextPayloadAccess} from "../services/analytical-context-authority.js";
import {withAnalyticalConversationRetention} from "../services/analytical-context-privacy.js";
import {heartbeatMemoryPayloadRetained,reapplyMemoryDeletionMarkers} from "../services/memory/memory-privacy.js";
import {purgeCompanyContent} from "../services/saas/company-purge.js";
import {suppressAnalyticalSource} from "../services/analytical-privacy.js";
import {eraseExpiredAnalyticalLineage} from "../services/analytical-retention.js";
import {analyticalPurpose,metricDefinition} from "./helpers/business-metric-fixture.js";
import {PaperclipRunnerToolAuthority} from "../services/native-runtime/paperclip-runner-tool-authority.js";
import {nativeManagementToolsAvailable} from "../services/native-runtime/management-analytical-tools.js";
import type {BusinessMetricResult} from "@paperclipai/shared";
import {getEmbeddedPostgresTestSupport,startEmbeddedPostgresTestDatabase} from "./helpers/embedded-postgres.js";
const support=await getEmbeddedPostgresTestSupport(),board={type:"board" as const,source:"local_implicit" as const};
describe.skipIf(!support.supported)("Native analytical Context retention on PostgreSQL",()=>{
 let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>,companyId:string,userId:string,agentId:string,issueId:string,runId:string;
 beforeAll(async()=>{database=await startEmbeddedPostgresTestDatabase("aw-v8-analytical-context-");db=createDb(database.connectionString);});afterAll(async()=>database?.cleanup());
 beforeEach(async()=>{
  await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({analytical_lineage_v8:true,business_metrics_v8:true,management_reviews_v8:true,management_chat_tools_v8:true,enableContextEngineV1:true,ai_use_cases_v7:true,governance_evidence_v7:true});companyId=randomUUID();userId=randomUUID();agentId=randomUUID();issueId=randomUUID();runId=randomUUID();
  await db.insert(companies).values({id:companyId,name:"Synthetic private native analytical conversation",issuePrefix:randomUUID()});await db.insert(authUsers).values({id:userId,name:"Current human",email:`${userId}@example.test`,createdAt:new Date(),updatedAt:new Date()});await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:userId,membershipRole:"admin",status:"active"});await db.insert(agents).values({id:agentId,companyId,name:"Native analytical reader",role:"engineer",status:"active",adapterType:"paperclip_runner"});
  await db.insert(issues).values({id:issueId,companyId,title:"Private native conversation",assigneeAgentId:agentId,conversationAgentId:agentId,conversationUserId:userId,conversationState:"active",responsibleUserId:userId});await db.insert(heartbeatRuns).values({id:runId,companyId,agentId,nativeIssueId:issueId,runtimeMode:"native",status:"running",responsibleUserId:userId,contextSnapshot:{issueId}});await db.update(issues).set({executionRunId:runId}).where(eq(issues.id,issueId));
 });
 const actor=()=>({type:"agent" as const,source:"agent_jwt" as const,companyId,agentId,runId,onBehalfOfUserId:userId});

 async function fixture(withContext=true,count=false){
  if(withContext)await contextManifestService(db).create({companyId,agentId,issueId,runId,query:"Current analytical read",policySnapshot:{fixture:true},selected:[]});
  const policy=(await aiGovernanceService(db).obligation(board,companyId,analyticalPurpose())).id,owner=businessMetricService(db),created=await owner.create(companyId,board,{key:"native",definition:{...metricDefinition(policy),ownerUserId:userId,...(count?{valueType:"count" as const,unit:"objects",calculation:{kind:"native_count" as const,population:{entity:"issue" as const,statuses:["done" as const],projectId:null}}}:{})}});await owner.publish(companyId,board,created.metric.id,{expectedRevision:1,versionId:created.version.id});
  const sourceId=randomUUID();await db.insert(issues).values({id:sourceId,companyId,title:"Synthetic source task",status:"done",responsibleUserId:userId});
  const now=new Date(),query={metricId:created.metric.id,versionId:created.version.id,from:new Date(now.getTime()-86400000).toISOString(),until:new Date(now.getTime()+1000).toISOString(),dimensions:[],maxRows:100};
  async function capture(){return withAnalyticalConversationRetention(db,companyId,actor(),async tx=>{const result=await businessMetricService(tx).query(companyId,actor(),query);return {result,sourceManifestIds:[result.lineageManifestId],retentionUntil:new Date(result.expiresAt)};});}
  return {sourceId,capture,query};
 }
 async function copied(){await db.update(heartbeatRuns).set({contextSnapshot:{sensitive:"Synthetic analytical context"},resultJson:{body:"Synthetic analytical result"},stdoutExcerpt:"Synthetic analytical output"}).where(eq(heartbeatRuns.id,runId));await db.insert(issueComments).values({companyId,issueId,body:"Synthetic analytical answer"});}
 async function root(){return (await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId)))[0]!;}
 async function erased(){expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);const [run]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,runId));expect(run!.resultJson).toBeNull();expect(run!.contextSnapshot).toEqual({});expect((await db.select().from(issueComments).where(eq(issueComments.issueId,issueId))).every(c=>c.body==="Source payload erased")).toBe(true);}

 const toolAuthority=()=>new PaperclipRunnerToolAuthority(db,{companyId,agentId,issueId,runId,managementToolsEnabled:true});
 it("discovers original published metric metadata without creating a fabricated measurement or disclosing a later human draft",async()=>{
  const f=await fixture(),[version]=await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id,f.query.versionId));
  await businessMetricService(db).createVersion(companyId,board,f.query.metricId,{expectedRevision:2,definition:{...version!.definition,name:"Private pending metric definition"}});
  const listed=await toolAuthority().execute({tool:"list_business_metrics",callId:randomUUID(),arguments:{limit:1}});
  expect(listed).toMatchObject({result:{items:[{versionId:f.query.versionId,grade:"native_definition",measurement:null}]}});expect(JSON.stringify(listed)).not.toContain("Private pending");
  expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).toHaveLength(0);
  const retained=await root();expect(retained.authorityPins).toMatchObject([{kind:"metric_definition"}]);expect(retained.sourceCount).toBe(1);
 });
 it("returns an empty authorized discovery page without inventing source facts or a Memory root",async()=>{
  await contextManifestService(db).create({companyId,agentId,issueId,runId,query:"Empty metadata discovery",policySnapshot:{fixture:true},selected:[]});
  expect(await toolAuthority().execute({tool:"list_business_metrics",callId:randomUUID(),arguments:{}})).toEqual([]);
  expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(0);
 });
 it("closes metadata copies immediately when the original definition row is deleted",async()=>{
  const f=await fixture();await toolAuthority().execute({tool:"list_business_metrics",callId:randomUUID(),arguments:{}});await copied();
  await db.update(businessMetrics).set({status:"revoked",publishedVersionId:null}).where(eq(businessMetrics.id,f.query.metricId));
  await db.delete(businessMetricVersions).where(eq(businessMetricVersions.id,f.query.versionId));
  expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);await reapplyMemoryDeletionMarkers(db,companyId);await erased();
 });
 it("refuses a restored metadata definition from a new actual native consumer without reusing the erased conversation",async()=>{
  const f=await fixture(),[version]=await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id,f.query.versionId)),[publication]=await db.select().from(businessMetricPublications).where(eq(businessMetricPublications.versionId,f.query.versionId));
  await toolAuthority().execute({tool:"list_business_metrics",callId:randomUUID(),arguments:{}});
  await db.update(businessMetrics).set({status:"revoked",publishedVersionId:null}).where(eq(businessMetrics.id,f.query.metricId));await db.delete(businessMetricVersions).where(eq(businessMetricVersions.id,f.query.versionId));
  await db.insert(businessMetricVersions).values(version!);await db.insert(businessMetricPublications).values(publication!);await db.update(businessMetrics).set({status:"published",publishedVersionId:f.query.versionId}).where(eq(businessMetrics.id,f.query.metricId));
  agentId=randomUUID();issueId=randomUUID();runId=randomUUID();
  await db.insert(agents).values({id:agentId,companyId,name:"Independent metadata consumer",role:"engineer",status:"active",adapterType:"paperclip_runner"});
  await db.insert(issues).values({id:issueId,companyId,title:"Independent private metadata conversation",assigneeAgentId:agentId,conversationAgentId:agentId,conversationUserId:userId,conversationState:"active",responsibleUserId:userId});
  await db.insert(heartbeatRuns).values({id:runId,companyId,agentId,nativeIssueId:issueId,runtimeMode:"native",status:"running",responsibleUserId:userId});await db.update(issues).set({executionRunId:runId}).where(eq(issues.id,issueId));
  await contextManifestService(db).create({companyId,agentId,issueId,runId,query:"Restored source denied",policySnapshot:{syntheticSoftwareFixture:true},selected:[]});
  expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(true);
  await expect(toolAuthority().execute({tool:"query_business_metric",callId:randomUUID(),arguments:f.query})).rejects.toMatchObject({status:409});
 });
 it("preserves immutable governance and reauthorizes metadata against a superseding native purpose review",async()=>{
  const f=await fixture();await toolAuthority().execute({tool:"list_business_metrics",callId:randomUUID(),arguments:{}});
  await expect(db.delete(governanceObligations).where(eq(governanceObligations.companyId,companyId))).rejects.toMatchObject({cause:{code:"23514",message:"governance_versioned_evidence_immutable"}});
  const updated=analyticalPurpose();updated.analyticalPurpose!.approvalRationale="A subsequent explicit native human purpose review";
  await aiGovernanceService(db).obligation(board,companyId,updated);
  await expect(assertAnalyticalContextPayloadAccess(db,companyId,{type:"board",source:"session",userId},{issueId})).rejects.toMatchObject({status:409,details:{code:"analytical_source_access_lost"}});
  expect(await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id,f.query.versionId))).toHaveLength(1);
 });
 it("dispatches a real SDK metric tool and retains its exact native source before returning facts",async()=>{
  const f=await fixture(),binding={companyId,agentId,runId};expect(await nativeManagementToolsAvailable(db,binding,userId)).toBe(true);
  const tools=toolAuthority();expect(tools.definitions().some(d=>d.name==="query_business_metric")).toBe(true);
  expect(new PaperclipRunnerToolAuthority(db,{...binding,issueId}).definitions().some(d=>d.name==="query_business_metric")).toBe(false);
  await expect(tools.execute({tool:"query_business_metric",callId:randomUUID(),arguments:{...f.query,companyId}})).rejects.toThrow();
  expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(0);
  const payload=await tools.execute({tool:"query_business_metric",callId:randomUUID(),arguments:f.query});
  expect(payload).toMatchObject({tool:"query_business_metric",result:{grade:"native_observation",observation:{value:1}},executionAuthority:"read_only_or_advisory"});
  expect((await root()).authorityPins).toHaveLength(1);expect(await db.select().from(analyticalContextDependencies).where(eq(analyticalContextDependencies.companyId,companyId))).toHaveLength(1);
  await expect(businessMetricService(db).query(companyId,actor(),f.query)).rejects.toMatchObject({status:403});
 });
 it.each([false,true])("reuses exact native window comparison semantics through the actual SDK (count=%s)",async(count)=>{
  const f=await fixture(true,count),at=Date.now()-1000,day=86400000;
  await db.update(issues).set({createdAt:new Date(at-3600000)}).where(eq(issues.id,f.sourceId));
  const tools=toolAuthority(),query=async(from:number,until:number)=>((await tools.execute({tool:"query_business_metric",callId:randomUUID(),arguments:{...f.query,from:new Date(from).toISOString(),until:new Date(until).toISOString()}})) as {result:{observation:BusinessMetricResult}}).result.observation;
  const before=await query(at-2*day,at-day),after=await query(at-day,at),ref=(v:BusinessMetricResult)=>({type:"metric_observation",id:v.id,metricId:v.metricId,metricVersionId:v.versionId});
  const compared=await tools.execute({tool:"compare_business_metrics",callId:randomUUID(),arguments:{before:ref(before),after:ref(after)}});
  expect(compared).toMatchObject({result:{claims:[{grade:"native_observation",facts:{status:count?"observed_change":"unknown",reason:count?null:"observation_unavailable",absoluteChange:count?1:null,relativeChangeFraction:null}}]}});
  expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(3);
 });
 it("returns a source-retained human-review preview without creating or publishing business work",async()=>{
  const f=await fixture(),observation=await f.capture(),tools=toolAuthority(),count=(await db.select().from(issues).where(eq(issues.companyId,companyId))).length;
  const preview=await tools.execute({tool:"propose_management_action",callId:randomUUID(),arguments:{action:"investigate",rationale:"Investigate this exact observed native population",sources:[{type:"metric_observation",id:observation.id,metricId:observation.metricId,metricVersionId:observation.versionId}]}});
  expect(preview).toMatchObject({result:{kind:"management_action_preview",humanReviewRequired:true,executionAuthority:"advisory_only"}});
  expect(await db.select().from(issues).where(eq(issues.companyId,companyId))).toHaveLength(count);
  expect((await db.select().from(memoryRecords).where(eq(memoryRecords.companyId,companyId))).every(r=>r.reviewState==="rejected"&&r.verificationState==="unverified")).toBe(true);
 });
 it("commits the full source set and conservative expiry before returning a native result",async()=>{const f=await fixture(),result=await f.capture(),r=await root(),[memory]=await db.select().from(memoryRecords).where(eq(memoryRecords.id,r.memoryRecordId));expect(result.lineageManifestId).toBeTruthy();expect(r.sourceCount).toBe(1);expect(r.expiresAt.toISOString()).toBe(result.expiresAt);expect(memory).toMatchObject({reviewState:"rejected",verificationState:"unverified",memoryType:"observation",scopeType:"agent",confidenceScore:0});expect(await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.memoryRecordId,r.memoryRecordId))).toHaveLength(1);await expect(db.update(memoryRecords).set({reviewState:"accepted",verificationState:"human_verified",memoryType:"outcome"}).where(eq(memoryRecords.id,r.memoryRecordId))).rejects.toThrow();});
 it("requires the current native Context and rolls back measurement derivation on failure",async()=>{const f=await fixture(false);await expect(f.capture()).rejects.toMatchObject({status:409});expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).toHaveLength(0);expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(0);});
 it("rolls back a derived measurement if the complete source set is unavailable",async()=>{await fixture();await expect(withAnalyticalConversationRetention(db,companyId,actor(),async()=>({result:{copy:"uncommitted"},sourceManifestIds:[randomUUID()],retentionUntil:new Date(Date.now()+60000)}))).rejects.toMatchObject({status:409});expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(0);});
 it("erases native copied prose when its original source is suppressed with rollout disabled",async()=>{const f=await fixture();await f.capture();await copied();await instanceSettingsService(db).updateExperimental({management_chat_tools_v8:false,management_reviews_v8:false,business_metrics_v8:false});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));await db.transaction(tx=>suppressAnalyticalSource(tx,companyId,"issue",f.sourceId));await erased();});
 it("immediately withholds direct source deletion and physically scrubs through the existing C7 worker",async()=>{const f=await fixture(),result=await f.capture();await copied();await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,result.lineageManifestId));expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);await reapplyMemoryDeletionMarkers(db,companyId);await erased();});
 it("keeps source erasure effective against restored Memory and late runtime writes",async()=>{const f=await fixture(),result=await f.capture(),r=await root();await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,result.lineageManifestId));await db.update(memoryRecords).set({deletedAt:null,content:"Restored analytical root"}).where(eq(memoryRecords.id,r.memoryRecordId));await db.update(heartbeatRuns).set({resultJson:{leak:"Late worker"},contextSnapshot:{leak:"Late context"}}).where(eq(heartbeatRuns.id,runId));await db.insert(heartbeatRunEvents).values({companyId,agentId,runId,seq:1,eventType:"stdout",message:"Late output",payload:{leak:"Late output"}});expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,runId)))[0]!.resultJson).toBeNull();expect((await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId,runId)))[0]!.payload).toBeNull();await reapplyMemoryDeletionMarkers(db,companyId);expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,r.memoryRecordId)))[0]!.content).toBe("");});
 it("runs native analytical expiry while rollout is off and scrubs consumed results",async()=>{const f=await fixture();await f.capture();await copied();await instanceSettingsService(db).updateExperimental({management_chat_tools_v8:false,management_reviews_v8:false,business_metrics_v8:false});await eraseExpiredAnalyticalLineage(db,new Date(Date.now()+31*86400000));await erased();});
 it("rejects mutable provenance and incomplete added source roots",async()=>{const f=await fixture();await f.capture();const r=await root();await expect(db.update(analyticalContextRoots).set({sourceCount:2}).where(eq(analyticalContextRoots.memoryRecordId,r.memoryRecordId))).rejects.toThrow();await expect(db.insert(analyticalContextDependencies).values({companyId,memoryRecordId:r.memoryRecordId,sourceManifestId:randomUUID()})).rejects.toThrow();});
 it("withholds copied payload at the original result expiry before any cleanup worker runs",async()=>{const f=await fixture(),result=await f.capture();const now=new Date();await contextManifestService(db).create({companyId,agentId,issueId,runId,query:"Short result expiry",policySnapshot:{fixture:true},selected:[]});await withAnalyticalConversationRetention(db,companyId,actor(),async tx=>({result:await businessMetricService(tx).inspectCurrentObservation(companyId,actor(),result.id),sourceManifestIds:[result.lineageManifestId],retentionUntil:new Date(now.getTime()+300)}));await new Promise(resolve=>setTimeout(resolve,350));expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);await expect(f.capture()).rejects.toMatchObject({status:403});});
 it("preserves provenance against direct root removal and permits actual native company purge",async()=>{const f=await fixture();await f.capture();await toolAuthority().execute({tool:"list_business_metrics",callId:randomUUID(),arguments:{}});const r=await root();await expect(db.delete(analyticalContextRoots).where(eq(analyticalContextRoots.memoryRecordId,r.memoryRecordId))).rejects.toThrow();const foreign=randomUUID();await db.insert(companies).values({id:foreign,name:"Independent preserved tenant",issuePrefix:randomUUID()});await db.insert(issues).values({companyId:foreign,title:"Independent original source"});const purge=await purgeCompanyContent(db,companyId);expect(purge.companyTombstoneRetained).toBe(true);expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(0);expect(await db.select().from(issues).where(eq(issues.companyId,foreign))).toHaveLength(1);});

 it("closes a whole multi-source result when one source disappears without deleting the other observation",async()=>{const f=await fixture(),first=await f.capture(),second=await f.capture();await withAnalyticalConversationRetention(db,companyId,actor(),async tx=>({result:{first:await businessMetricService(tx).inspectCurrentObservation(companyId,actor(),first.id),second:await businessMetricService(tx).inspectCurrentObservation(companyId,actor(),second.id)},sourceManifestIds:[first.lineageManifestId,second.lineageManifestId],retentionUntil:new Date(Math.min(Date.parse(first.expiresAt),Date.parse(second.expiresAt)))}));expect((await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).some(r=>r.sourceCount===2)).toBe(true);await copied();await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,first.lineageManifestId));expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,second.id))).toHaveLength(1);await reapplyMemoryDeletionMarkers(db,companyId);await erased();});

 it("reauthorizes copied native prose for the current human after the original run ends",async()=>{const f=await fixture();await f.capture();await copied();const reader={type:"board" as const,source:"session" as const,userId,companyIds:[companyId]};await db.update(heartbeatRuns).set({status:"succeeded"}).where(eq(heartbeatRuns.id,runId));await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId})).resolves.toBeUndefined();await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{runId})).resolves.toBeUndefined();await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalId,userId)));await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId})).rejects.toMatchObject({status:403});});
 it("withholds copied prose when an original contributing task becomes hidden",async()=>{const f=await fixture();await f.capture();await copied();await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));await expect(assertAnalyticalContextPayloadAccess(db,companyId,board,{issueId})).rejects.toMatchObject({status:403});expect((await db.select().from(issueComments).where(eq(issueComments.issueId,issueId)))[0]!.body).toBe("Synthetic analytical answer");});
 it("reauthorizes actual WebSocket output at delivery and exposes only native identities on source loss",async()=>{
  const f=await fixture();await f.capture();
  const http=createServer(),wss=setupLiveEventsWebSocketServer(http,db,{deploymentMode:"local_trusted"});
  http.listen(0,"127.0.0.1");await once(http,"listening");const address=http.address() as {port:number};
  const socket=new WebSocket(`ws://127.0.0.1:${address.port}/api/companies/${companyId}/events/ws`);
  const read=()=>new Promise<LiveEvent>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Native live event delivery timed out")),5000);socket.once("message",data=>{clearTimeout(timer);resolve(JSON.parse(data.toString()));});});
  try{
   await once(socket,"open");
   const event={companyId,type:"heartbeat.run.log" as const,payload:{runId,issueId:randomUUID(),chunk:"Synthetic original analytical live fact"}};
   const before=read();publishLiveEvent(event);expect((await before).payload.chunk).toContain("analytical live fact");
   await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
   const denied=read();publishLiveEvent(event);const loss=await denied;
   expect(loss).toMatchObject({type:"analytical.context.access_lost",payload:{runId,issueId,code:"analytical_source_access_lost"}});
   expect(JSON.stringify(loss)).not.toContain("analytical live fact");expect(Object.keys(loss.payload).sort()).toEqual(["code","issueId","runId"]);
   await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,f.sourceId));
   const restored=read();publishLiveEvent(event);expect((await restored).payload.chunk).toContain("analytical live fact");
  }finally{const closed=once(socket,"close");socket.terminate();await closed;await new Promise<void>(resolve=>wss.close(resolve));await new Promise<void>((resolve,reject)=>http.close(error=>error?reject(error):resolve()));}
 });
 it("checks all earlier conversation roots for a later native output and refuses a static agent key without native reader authority",async()=>{
  const f=await fixture();await f.capture();
  const laterRun=randomUUID();await db.insert(heartbeatRuns).values({id:laterRun,companyId,agentId,nativeIssueId:issueId,runtimeMode:"native",status:"running",responsibleUserId:userId});
  const event:LiveEvent={id:1,companyId,type:"heartbeat.run.progress",createdAt:new Date().toISOString(),payload:{runId:laterRun,lastAssistantSnippet:"Synthetic borrowed analytical fact"}};
  expect(await analyticalLiveEventForReader(db,event,board)).toEqual(event);
  expect(await analyticalLiveEventForReader(db,event,{type:"agent",source:"agent_key",companyId,agentId,keyId:randomUUID(),onBehalfOfUserId:userId})).toMatchObject({type:"analytical.context.access_lost"});
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
  const denied=await analyticalLiveEventForReader(db,event,board);expect(denied).toMatchObject({type:"analytical.context.access_lost",payload:{runId:laterRun,issueId}});expect(JSON.stringify(denied)).not.toContain("borrowed analytical fact");
 });
 it("closes an already connected native browser after its current company membership is revoked",async()=>{
  const f=await fixture();await f.capture();
  const http=createServer(),wss=setupLiveEventsWebSocketServer(http,db,{deploymentMode:"authenticated",resolveSessionFromHeaders:async()=>({user:{id:userId},session:{id:randomUUID()}} as never)});
  http.listen(0,"127.0.0.1");await once(http,"listening");const address=http.address() as {port:number};
  const socket=new WebSocket(`ws://127.0.0.1:${address.port}/api/companies/${companyId}/events/ws`),received:string[]=[];
  socket.on("message",data=>received.push(data.toString()));
  try{
   await once(socket,"open");
   await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalId,userId)));
   const closed=once(socket,"close");publishLiveEvent({companyId,type:"heartbeat.run.log",payload:{runId,chunk:"Revoked human private analytical fact"}});
   expect((await closed)[0]).toBe(1008);expect(received).toEqual([]);
  }finally{socket.terminate();await new Promise<void>(resolve=>wss.close(resolve));await new Promise<void>(resolve=>http.close(()=>resolve()));}
 });
 it("returns the actually scrubbed C7 row from the common native output allocator",async()=>{
  const f=await fixture(),original=await f.capture();await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,original.lineageManifestId));
  const persisted=await appendHeartbeatRunEvent(db,{companyId,agentId,runId,eventType:"item.delta",message:"Late private original analytical text",payload:{text:"Late private original analytical text"}});
  expect(persisted.disposition).toBe("committed");expect(persisted.row.message).toBeNull();expect(persisted.row.payload).toBeNull();
 });
 it("requires an actual current reader and explicit source rollout without erasing original canonical facts",async()=>{const f=await fixture();await f.capture();await expect(assertAnalyticalContextPayloadAccess(db,companyId,undefined,{issueId})).rejects.toMatchObject({status:403});await instanceSettingsService(db).updateExperimental({management_chat_tools_v8:false,management_reviews_v8:false,business_metrics_v8:false});await expect(assertAnalyticalContextPayloadAccess(db,companyId,board,{issueId})).rejects.toMatchObject({status:404});expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).toHaveLength(1);});

 it("rejects another native Task's Context even when it names the same current run and agent",async()=>{const f=await fixture(false),other=randomUUID();await db.insert(issues).values({id:other,companyId,title:"Other admitted native Task"});await contextManifestService(db).create({companyId,agentId,issueId:other,runId,query:"Other task context",policySnapshot:{fixture:true},selected:[]});await expect(f.capture()).rejects.toMatchObject({status:409});expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).toHaveLength(0);});

 it("closes copied prose when the native result owner is deleted and rejects restored-source recapture",async()=>{const f=await fixture(),result=await f.capture(),[original]=await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,result.id));await copied();await db.delete(businessMetricObservations).where(eq(businessMetricObservations.id,result.id));expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);expect(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,result.lineageManifestId))).toHaveLength(1);await reapplyMemoryDeletionMarkers(db,companyId);await erased();await db.insert(businessMetricObservations).values(original!);const nextIssue=randomUUID(),nextRun=randomUUID(),nextAgent=randomUUID();await db.insert(agents).values({id:nextAgent,companyId,name:"Independent actual native reader",role:"engineer",status:"active",adapterType:"paperclip_runner"});await db.insert(issues).values({id:nextIssue,companyId,title:"New actual native conversation",assigneeAgentId:nextAgent,conversationAgentId:nextAgent,conversationUserId:userId,conversationState:"active",responsibleUserId:userId});await db.insert(heartbeatRuns).values({id:nextRun,companyId,agentId:nextAgent,nativeIssueId:nextIssue,runtimeMode:"native",status:"running",responsibleUserId:userId,contextSnapshot:{issueId:nextIssue}});await db.update(issues).set({executionRunId:nextRun}).where(eq(issues.id,nextIssue));await contextManifestService(db).create({companyId,agentId:nextAgent,issueId:nextIssue,runId:nextRun,query:"Restore attempt in a new run",policySnapshot:{fixture:true},selected:[]});expect(await heartbeatMemoryPayloadRetained(db,companyId,nextRun)).toBe(true);await expect(withAnalyticalConversationRetention(db,companyId,{...actor(),agentId:nextAgent,runId:nextRun},async()=>({result,sourceManifestIds:[result.lineageManifestId],retentionUntil:new Date(result.expiresAt)}))).rejects.toMatchObject({status:409});});

 it("withholds actual HTTP comment history after original source access changes",async()=>{const f=await fixture();await f.capture();await copied();const app=express();app.use(express.json());app.use((req,_res,next)=>{req.actor={type:"board",source:"session",userId,companyIds:[companyId]};next();});app.use("/api",issueRoutes(db));app.use(errorHandler);const before=await request(app).get(`/api/issues/${issueId}/comments`);expect(before.status).toBe(200);expect(JSON.stringify(before.body)).toContain("Synthetic analytical answer");await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));const after=await request(app).get(`/api/issues/${issueId}/comments`);expect(after.status).toBe(403);expect(JSON.stringify(after.body)).not.toContain("Synthetic analytical answer");});

 it("recovers an inaccessible source conversation only through its actual owner's explicit native request without deleting canonical source facts",async()=>{
  await instanceSettingsService(db).updateExperimental({enableAgentChat:true});
  const f=await fixture(),original=await f.capture();await copied();
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.actor={type:"board",source:"session",userId,companyIds:[companyId]};next();});app.use("/api",issueRoutes(db));app.use(errorHandler);
  const chatPath=`/api/companies/${companyId}/chats/${agentId}`,input={replaceInaccessibleIssueId:issueId};
  expect((await request(app).post(chatPath).send(input)).status).toBe(409);
  expect((await db.select().from(issues).where(eq(issues.id,issueId)))[0]!.conversationRetiredAt).toBeNull();
  expect((await request(app).post(chatPath).send({...input,companyId})).status).toBe(400);
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
  expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(true);
  const lost=await request(app).get(chatPath);expect(lost.status).toBe(403);expect(lost.body.details).toEqual({code:"analytical_source_access_lost",conversationIssueId:issueId});expect(JSON.stringify(lost.body)).not.toContain("Synthetic analytical answer");
  expect((await request(app).post(chatPath)).status).toBe(403);
  const opened=await Promise.all(Array.from({length:6},()=>request(app).post(chatPath).send(input)));
  expect(opened.map(r=>r.status)).toEqual(Array(6).fill(200));expect(new Set(opened.map(r=>r.body.id)).size).toBe(1);
  const nextId=opened[0]!.body.id;expect(nextId).not.toBe(issueId);
  expect((await request(app).post(chatPath).send(input)).body.id).toBe(nextId);
  expect((await request(app).get(`/api/issues/${issueId}/comments`)).status).toBe(403);
  expect((await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,original.id)))[0]!.id).toBe(original.id);
  expect((await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id,f.query.versionId)))[0]!.id).toBe(f.query.versionId);
  expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);
  expect((await db.select().from(memoryRecords).where(eq(memoryRecords.companyId,companyId))).every(r=>r.deletedAt&&r.content==="")).toBe(true);
 });

 it("erases both original trace sidecars through the native outbox with rollout off and keeps the cleanup after actual company purge",async()=>{
  const previous=process.env.PROVIDER_TRACE_BASE_PATH,temp=await fs.mkdtemp(path.join(os.tmpdir(),"aw-v8-trace-erasure-"));process.env.PROVIDER_TRACE_BASE_PATH=temp;
  try{
   const f=await fixture(),result=await f.capture(),store=providerTraceStore(db),prepared=await store.prepare({companyId,runId,provider:"codex",requestedBy:userId});
   await fs.writeFile(prepared.path,'{"synthetic":"original private provider payload"}\n');await fs.writeFile(`${prepared.path}.rehydration`,'{"synthetic":"original private rehydration payload"}\n');
   const foreign=randomUUID(),foreignRun=randomUUID(),foreignAgent=randomUUID();await db.insert(companies).values({id:foreign,name:"Preserved trace tenant",issuePrefix:randomUUID()});await db.insert(agents).values({id:foreignAgent,companyId:foreign,name:"Preserved actual agent",role:"engineer",status:"active",adapterType:"process"});await db.insert(heartbeatRuns).values({id:foreignRun,companyId:foreign,agentId:foreignAgent,status:"succeeded"});const foreignTrace=await store.prepare({companyId:foreign,runId:foreignRun,provider:"codex",requestedBy:"synthetic"});await fs.writeFile(foreignTrace.path,'{"synthetic":"independent tenant"}\n');
   const files=await fs.readdir(temp);
   await expect(store.prepare({companyId:foreign,runId,provider:"codex",requestedBy:"Wrong company"})).rejects.toMatchObject({cause:{code:"23514"}});
   expect(await fs.readdir(temp)).toEqual(files);
   await instanceSettingsService(db).updateExperimental({management_chat_tools_v8:false,management_reviews_v8:false,business_metrics_v8:false,enableCollectiveMemoryV1:false,enablePrivateAgentMemoryV1:false});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
   await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,result.lineageManifestId));
   const [tombstone]=await db.select().from(providerTraceRecords).where(eq(providerTraceRecords.runId,runId));expect(tombstone).toMatchObject({status:"deleted",reason:"source_erased",frameCount:0,byteCount:0,digest:null});expect(tombstone!.deletedAt).toBeInstanceOf(Date);
   expect(await store.download(runId,companyId)).toBeNull();await expect(store.prepare({companyId,runId,provider:"codex",requestedBy:userId})).rejects.toThrow("provider_trace_unavailable");
   // Real filesystem failure: unlink cannot remove a directory. The durable
   // cleanup must remain retryable with every Memory and V8 feature disabled.
   await fs.rm(`${prepared.path}.rehydration`);await fs.mkdir(`${prepared.path}.rehydration`);
   const worker=memoryJobService(db);await worker.tick();
   expect((await db.select().from(memoryJobs).where(eq(memoryJobs.companyId,companyId)))[0]!.status).toBe("failed");
   await fs.rmdir(`${prepared.path}.rehydration`);await fs.writeFile(`${prepared.path}.rehydration`,"Synthetic retry payload");
   await worker.tick({now:new Date(Date.now()+61000)});await expect(fs.readFile(prepared.path)).rejects.toMatchObject({code:"ENOENT"});await expect(fs.readFile(`${prepared.path}.rehydration`)).rejects.toMatchObject({code:"ENOENT"});expect(await fs.readFile(foreignTrace.path,"utf8")).toContain("independent tenant");
   // A restored/late native capture stays tombstoned and requeues original file identities.
   await fs.writeFile(prepared.path,"Synthetic late bytes");await fs.writeFile(`${prepared.path}.rehydration`,"Synthetic late rehydration");await db.update(providerTraceRecords).set({status:"capturing",reason:null,deletedAt:null,frameCount:99}).where(eq(providerTraceRecords.runId,runId));
   expect((await db.select().from(providerTraceRecords).where(eq(providerTraceRecords.runId,runId)))[0]).toMatchObject({status:"deleted",reason:"source_erased",frameCount:0});
   await purgeCompanyContent(db,companyId);expect(await db.select().from(providerTraceRecords).where(eq(providerTraceRecords.companyId,companyId))).toHaveLength(0);
   const retained=await db.select().from(memoryJobs).where(eq(memoryJobs.companyId,companyId));expect(retained.length).toBeGreaterThan(0);expect(retained.every(j=>j.operationType==="retention"&&j.sourceRefJson.kind==="provider_trace_erasure"&&j.sourceHeartbeatRunId===null&&j.sourceMemoryRecordId===null)).toBe(true);
   await worker.tick();await expect(fs.readFile(prepared.path)).rejects.toMatchObject({code:"ENOENT"});await expect(fs.readFile(`${prepared.path}.rehydration`)).rejects.toMatchObject({code:"ENOENT"});expect(await fs.readFile(foreignTrace.path,"utf8")).toContain("independent tenant");
  }finally{if(previous===undefined)delete process.env.PROVIDER_TRACE_BASE_PATH;else process.env.PROVIDER_TRACE_BASE_PATH=previous;await fs.rm(temp,{recursive:true,force:true});}
 });

 it("recovers the same person's erased conversation atomically without reviving its history or Task outcome",async()=>{
  await instanceSettingsService(db).updateExperimental({enableAgentChat:true});
  const f=await fixture(),result=await f.capture();await copied();
  await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,result.lineageManifestId));
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.actor={type:"board",source:"session",userId,companyIds:[companyId]};next();});app.use("/api",issueRoutes(db));app.use(errorHandler);
  const path=`/api/companies/${companyId}/chats/${agentId}`;
  const unused=await request(app).get(path);expect(unused.status).toBe(200);expect(unused.body).toBeNull();
  expect((await db.select().from(issues).where(eq(issues.id,issueId)))[0]!.conversationAgentId).toBe(agentId);
  const opened=await Promise.all(Array.from({length:6},()=>request(app).post(path)));
  expect(opened.map(r=>r.status)).toEqual(Array(6).fill(200));expect(new Set(opened.map(r=>r.body.id)).size).toBe(1);
  const freshId=opened[0]!.body.id;expect(freshId).not.toBe(issueId);
  const [retired]=await db.select().from(issues).where(eq(issues.id,issueId));
  expect(retired).toMatchObject({conversationAgentId:null,conversationUserId:null,conversationState:null,status:"cancelled",assigneeAgentId:null,executionRunId:null});expect(retired!.conversationRetiredAt).toBeInstanceOf(Date);
  expect((await request(app).get(`${path}`)).body.id).toBe(freshId);
  const old=await request(app).get(`/api/issues/${issueId}/comments`);expect(old.status).toBe(403);expect(old.body.details.code).toBe("analytical_source_access_lost");expect(JSON.stringify(old.body)).not.toContain("Synthetic analytical answer");
  await expect(issueService(db).update(issueId,{status:"done"})).rejects.toMatchObject({status:409});
  await expect(db.update(issues).set({conversationRetiredAt:null}).where(eq(issues.id,issueId))).rejects.toMatchObject({cause:{code:"23514"}});
  await expect(toolAuthority().execute({tool:"query_business_metric",callId:randomUUID(),arguments:f.query})).rejects.toThrow();
  const freshRun=randomUUID();await db.insert(heartbeatRuns).values({id:freshRun,companyId,agentId,nativeIssueId:freshId,runtimeMode:"native",status:"running",responsibleUserId:userId,contextSnapshot:{issueId:freshId}});await db.update(issues).set({executionRunId:freshRun,conversationState:"active"}).where(eq(issues.id,freshId));
  await contextManifestService(db).create({companyId,agentId,issueId:freshId,runId:freshRun,query:"A fresh source read",policySnapshot:{fixture:true},selected:[]});
  const tools=new PaperclipRunnerToolAuthority(db,{companyId,agentId,issueId:freshId,runId:freshRun,managementToolsEnabled:true});
  expect(await tools.execute({tool:"query_business_metric",callId:randomUUID(),arguments:f.query})).toMatchObject({result:{grade:"native_observation"}});
  expect(await heartbeatMemoryPayloadRetained(db,companyId,freshRun)).toBe(true);expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);
  expect((await purgeCompanyContent(db,companyId)).companyTombstoneRetained).toBe(true);
 });

});
