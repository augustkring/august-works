import { foundationService } from "../services/foundation/foundation-service.js";
import { foundationChangeProposals, principalPermissionGrants } from "@paperclipai/db";
import { routines } from "@paperclipai/db";
import { routineService } from "../services/routines.js";
import { routineAuthoringToolsService } from "../services/routine-authoring-tools.js";
import { grantsForHumanRole } from "../services/company-member-roles.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { analyticalLineageEdges, memoryDeletionMarkers, agentIdentities, agentExecutionManifests, agentExecutionManifestItems, contextManifests, memoryBindings } from "@paperclipai/db";
import { agentExecutionManifestSchema, createGovernedSkillSchema } from "@paperclipai/shared";
import { skillLifecycleService } from "../services/skill-lifecycle.js";
import { companySkillService } from "../services/company-skills.js";
import { buildRetainedNativeRuntimeContext, withRetainedNativeRuntimeAssets, materializeAsset, readNativeRuntimeAssetText } from "../services/native-runtime/runtime-context.js";
import { applyConnectorSkills, prepareRetainedConnectorSkills } from "../services/connector-runtime.js";
import { nativeRuntimeAssetsRoot, managedOpenCodeRuntimeDirectory, eraseNativeRuntimeAssets } from "../services/native-runtime/runtime-asset-retention.js";
import {projects,decisions,businessExperiments} from "@paperclipai/db";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {providerTraceStore} from "../services/provider-trace-store.js";
import {memoryJobService} from "../services/memory/memory-jobs.js";
import express from "express";
import request from "supertest";
import {issueService} from "../services/issues.js";
import {heartbeatService} from "../services/heartbeat.js";
import {issueRoutes} from "../routes/issues.js";
import {projectRoutes} from "../routes/projects.js";
import {errorHandler} from "../middleware/index.js";
import {randomUUID} from "node:crypto";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {WebSocket} from "ws";
import {setupLiveEventsWebSocketServer} from "../realtime/live-events-ws.js";
import {publishLiveEvent} from "../services/live-events.js";
import {analyticalLiveEventForReader} from "../services/analytical-live-events.js";
import {appendHeartbeatRunEvent} from "../services/heartbeat-run-events.js";
import type {LiveEvent} from "@paperclipai/shared";
import {and,eq,sql} from "drizzle-orm";
import {agents,authSessions,authUsers,companies,companyMemberships,heartbeatRuns,heartbeatRunEvents,issues,issuePrivacySources,issueComments,businessMetrics,businessMetricVersions,businessMetricPublications,businessMetricObservations,governanceObligations,analyticalLineageManifests,analyticalContextRoots,analyticalContextDependencies,memoryRecords,contextManifestMemoryRoots,providerTraceRecords,memoryJobs,nativeRunFinalizations,createDb} from "@paperclipai/db";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {instanceSettingsService} from "../services/instance-settings.js";
import {businessMetricService} from "../services/business-metrics/service.js";
import {aiGovernanceService} from "../services/ai-governance/governance-service.js";
import {contextManifestService} from "../services/context/context-manifest.js";
import {assertAnalyticalContextPayloadAccess,assertAnalyticalContextPayloadAccessBatch,assertAnalyticalContextPayloadOwnersAccessBatch,assertNativeAnalyticalRunPayloadAccess} from "../services/analytical-context-authority.js";
import type {NativePayloadSourceSet} from "../services/native-runtime/native-execution-input.js";
import {withAnalyticalConversationRetention} from "../services/analytical-context-privacy.js";
import {heartbeatMemoryPayloadRetained,lockMemoryPrivacy,reapplyMemoryDeletionMarkers} from "../services/memory/memory-privacy.js";
import {purgeCompanyContent} from "../services/saas/company-purge.js";
import {lockAnalyticalCompany,suppressAnalyticalSource} from "../services/analytical-privacy.js";
import {eraseExpiredAnalyticalLineage} from "../services/analytical-retention.js";
import {analyticalPurpose,metricDefinition} from "./helpers/business-metric-fixture.js";
import {PaperclipRunnerToolAuthority} from "../services/native-runtime/paperclip-runner-tool-authority.js";
import {PaperclipControlPlanePort} from "../services/native-runtime/paperclip-control-plane-port.js";
import type {PrpEvent} from "../vendor/paperclip-runner/index.js";
import {executePaperclipNativeSession} from "../services/native-runtime/native-session-executor.js";
import {prepareNativeHeartbeatRun} from "../services/native-runtime/prepare-native-run.js";
import type {NativeExecutionInputV1} from "@paperclipai/paperclip-runner";
import {completionContracts} from "@paperclipai/db";
import {nativeCompletionContractInput} from "../services/native-runtime/completion-contracts.js";
import {nativeManagementToolsAvailable} from "../services/native-runtime/management-analytical-tools.js";
import type {BusinessMetricResult} from "@paperclipai/shared";
import {getEmbeddedPostgresTestSupport,startEmbeddedPostgresTestDatabase} from "./helpers/embedded-postgres.js";
import {seedNativePasskeySession} from "./helpers/native-authentication-fixtures.js";
import type {AuthorizationActor} from "../services/authorization.js";
import {authorizationService} from "../services/authorization.js";
import {recordNativeLocalProcessStop} from "../services/native-local-process-stop.js";
const support=await getEmbeddedPostgresTestSupport(),board={type:"board" as const,source:"local_implicit" as const};
describe.skipIf(!support.supported)("Native analytical Context retention on PostgreSQL",()=>{
 let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>,companyId:string,userId:string,agentId:string,issueId:string,runId:string,reader:AuthorizationActor;
 beforeAll(async()=>{database=await startEmbeddedPostgresTestDatabase("aw-v8-analytical-context-");db=createDb(database.connectionString);});afterAll(async()=>database?.cleanup());
 beforeEach(async()=>{
  await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({analytical_lineage_v8:true,business_metrics_v8:true,management_reviews_v8:true,management_chat_tools_v8:true,enableContextEngineV1:true,ai_use_cases_v7:true,governance_evidence_v7:true,enableAgentChat:false});companyId=randomUUID();userId=randomUUID();agentId=randomUUID();issueId=randomUUID();runId=randomUUID();
  await db.insert(companies).values({id:companyId,name:"Synthetic private native analytical conversation",issuePrefix:randomUUID()});await db.insert(authUsers).values({id:userId,name:"Current human",email:`${userId}@example.test`,createdAt:new Date(),updatedAt:new Date()});await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:userId,membershipRole:"admin",status:"active"});await db.insert(agents).values({id:agentId,companyId,name:"Native analytical reader",role:"engineer",status:"active",adapterType:"paperclip_runner"});
  const sessionId=await seedNativePasskeySession(db,userId),[session]=await db.select({expiresAt:authSessions.expiresAt}).from(authSessions).where(eq(authSessions.id,sessionId));
  reader={type:"board",source:"session",userId,sessionId,authenticatedCredentialExpiresAt:session!.expiresAt.getTime(),companyIds:[companyId]};
  await db.insert(issues).values({id:issueId,companyId,title:"Private native conversation",assigneeAgentId:agentId,conversationAgentId:agentId,conversationUserId:userId,conversationState:"active",responsibleUserId:userId});await db.insert(heartbeatRuns).values({id:runId,companyId,agentId,nativeIssueId:issueId,runtimeMode:"native",status:"running",responsibleUserId:userId,contextSnapshot:{issueId}});await db.update(issues).set({executionRunId:runId}).where(eq(issues.id,issueId));
 });
 const actor=()=>({type:"agent" as const,source:"agent_jwt" as const,companyId,agentId,runId,onBehalfOfUserId:userId});

 async function fixture(withContext=true,count=false){
  if(withContext)await contextManifestService(db).create({companyId,agentId,issueId,runId,query:"Current analytical read",policySnapshot:{fixture:true},selected:[]});
  const policy=(await aiGovernanceService(db).obligation(board,companyId,analyticalPurpose())).id,owner=businessMetricService(db),created=await owner.create(companyId,board,{key:"native",definition:{...metricDefinition(policy),ownerUserId:userId,...(count?{valueType:"count" as const,unit:"objects",calculation:{kind:"native_count" as const,population:{entity:"issue" as const,statuses:["done" as const],projectId:null}}}:{})}});await owner.publish(companyId,board,created.metric.id,{expectedRevision:1,versionId:created.version.id});
  const sourceId=randomUUID();await db.insert(issues).values({id:sourceId,companyId,title:"Synthetic source task",status:"done",responsibleUserId:userId});
  const now=new Date(),query={metricId:created.metric.id,versionId:created.version.id,from:new Date(now.getTime()-86400000).toISOString(),until:new Date(now.getTime()+1000).toISOString(),dimensions:[],maxRows:100};
  async function capture(onCapture?:(source:NativePayloadSourceSet)=>void){return withAnalyticalConversationRetention(db,companyId,actor(),async tx=>{const result=await businessMetricService(tx).query(companyId,actor(),query);return {result,sourceManifestIds:[result.lineageManifestId],retentionUntil:new Date(result.expiresAt)};},onCapture);}
  return {sourceId,capture,query};
 }
 async function copied(){await db.update(heartbeatRuns).set({contextSnapshot:{sensitive:"Synthetic analytical context"},resultJson:{body:"Synthetic analytical result"},stdoutExcerpt:"Synthetic analytical output"}).where(eq(heartbeatRuns.id,runId));await db.insert(issueComments).values({companyId,issueId,body:"Synthetic analytical answer"});}
 async function root(){return (await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId)))[0]!;}
 async function erased(){expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);const [run]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,runId));expect(run!.resultJson).toBeNull();expect(run!.contextSnapshot).toEqual({});expect((await db.select().from(issueComments).where(eq(issueComments.issueId,issueId))).every(c=>c.body==="Source payload erased")).toBe(true);}

 it("keeps the source-free native admission fast path current for task privacy and retirement",async()=>{
  await contextManifestService(db).create({companyId,agentId,issueId,runId,query:"Native bootstrap only",policySnapshot:{fixture:true},selected:[]});
  await expect(assertNativeAnalyticalRunPayloadAccess(db,companyId,runId)).resolves.toBeUndefined();
  await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalId,userId)));
  await expect(assertNativeAnalyticalRunPayloadAccess(db,companyId,runId)).rejects.toMatchObject({status:403,details:{code:"analytical_source_access_lost"}});
  await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:userId,membershipRole:"admin",status:"active"});
  await db.update(issues).set({conversationAgentId:null,conversationUserId:null,conversationState:null,status:"cancelled",hiddenAt:new Date(),
   assigneeAgentId:null,assigneeUserId:null,executionRunId:null,checkoutRunId:null,conversationRetiredAt:new Date()}).where(eq(issues.id,issueId));
  await expect(assertNativeAnalyticalRunPayloadAccess(db,companyId,runId)).rejects.toMatchObject({status:403,details:{code:"analytical_source_access_lost"}});
 });

 it("keeps a current self-owned conversation comment on the deep privacy path and denies it after reader revocation",async()=>{
  await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({enableAgentChat:true});
  await db.update(issues).set({conversationAgentId:null,conversationUserId:null,conversationState:null}).where(eq(issues.id,issueId));
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.actor=reader;next();});app.use("/api",issueRoutes(db,{wakeup:async()=>null} as never));app.use(errorHandler);
  const chat=await request(app).post(`/api/companies/${companyId}/chats/${agentId}`).send({});
  expect(chat.status,JSON.stringify(chat.body)).toBe(200);
  issueId=chat.body.id;
  const submitted=await request(app).post(`/api/issues/${issueId}/comments`).send({body:"Synthetic current conversation input",clientRequestId:randomUUID()});
  expect(submitted.status,JSON.stringify(submitted.body)).toBe(201);
  const [owner]=await db.select({protocol:issues.payloadSourceProtocolVersion,snapshot:issues.payloadSourceSnapshot,
    invalidated:issues.payloadSourceSnapshotInvalidated}).from(issues).where(eq(issues.id,issueId));
  const payloadSnapshot=owner?.snapshot as {owner?:{kind?:string;id?:string;companyId?:string};inputs?:Array<{kind?:string;commentId?:string}>;policy?:{issueIds?:string[];projectIds?:string[];runIds?:string[];memoryIds?:string[];foundationRevisionIds?:string[]}}|null;
  expect(owner?.protocol).toBe(1);expect(owner?.invalidated).toBe(false);
  expect(payloadSnapshot?.owner).toMatchObject({kind:"issue",id:issueId,companyId});
  expect(payloadSnapshot?.inputs).toHaveLength(1);expect(payloadSnapshot?.inputs?.[0]).toMatchObject({kind:"comment",issueId,commentId:submitted.body.id});
  expect(payloadSnapshot?.policy).toEqual({issueIds:[],projectIds:[],runIds:[],memoryIds:[],foundationRevisionIds:[]});
  const priorDiagnostics=process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS,admissionLog=vi.spyOn(console,"info").mockImplementation(()=>{});
  process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS="1";
  try {
    await expect(assertAnalyticalContextPayloadAccessBatch(db,companyId,reader,[issueId],"task",{fastPathOnly:true})).resolves.toBe(false);
    expect(admissionLog).toHaveBeenCalledWith("native-analytical-batch-deep-route",
      expect.stringContaining('"privacyLockMode":"read"'));
  } finally {
    admissionLog.mockRestore();
    if(priorDiagnostics===undefined)delete process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS;
    else process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS=priorDiagnostics;
  }
  await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId})).resolves.toBeUndefined();
  const mixedRunId=randomUUID();
  await db.insert(heartbeatRuns).values({id:mixedRunId,companyId,agentId,nativeIssueId:issueId,runtimeMode:"native",status:"running",
    responsibleUserId:userId,contextSnapshot:{issueId,conversationSessionGeneration:0}});
  await db.update(issues).set({executionRunId:mixedRunId,checkoutRunId:mixedRunId}).where(eq(issues.id,issueId));
  await expect(assertAnalyticalContextPayloadOwnersAccessBatch(db,companyId,actor(),
    {issueIds:[issueId],runIds:[mixedRunId]},"task")).resolves.toBeUndefined();

  await expect(assertNativeAnalyticalRunPayloadAccess(db,companyId,mixedRunId)).resolves.toBeUndefined();

  // Hold the original source-writer lock before starting mixed-owner review.
  // Revoking the actual reader while it waits must be observed after admission,
  // rather than reusing a pre-wait Task or run ACL decision.
  let releaseLock!: () => void;
  let announceLock!: (pid: number) => void;
  const release = new Promise<void>(resolve => { releaseLock = resolve; });
  const locked = new Promise<number>(resolve => { announceLock = resolve; });
  const lockHolder = db.transaction(async tx => {
    await lockAnalyticalCompany(tx,companyId);
    await lockMemoryPrivacy(tx as unknown as typeof db,companyId);
    const [backend] = await tx.execute<{pid:number}>(sql`select pg_backend_pid() as pid`);
    announceLock(backend!.pid);
    await release;
  });
  const holderPid = await locked;
  const pendingMixedReview = assertNativeAnalyticalRunPayloadAccess(db,companyId,mixedRunId);
  let observedWait = false;
  for(let attempt=0;attempt<100&&!observedWait;attempt++){
    const [row]=await db.execute<{waiting:boolean}>(sql`select exists(
      select 1 from pg_stat_activity a where ${holderPid}=any(pg_blocking_pids(a.pid))
        and a.wait_event_type='Lock') as waiting`);
    observedWait=row?.waiting===true;
    if(!observedWait)await new Promise(resolve=>setTimeout(resolve,10));
  }
  try {
    expect(observedWait,"the mixed native source review must wait on its original privacy lock").toBe(true);
    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalId,userId)));
  } finally {
    releaseLock();
    await lockHolder;
  }
  await expect(pendingMixedReview).rejects.toMatchObject({status:403,details:{code:"analytical_source_access_lost"}});
  await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId})).rejects.toMatchObject({status:403,details:{code:"analytical_source_access_lost"}});
 });

 it("shares read-only source review while retaining contended writer revocation",async()=>{
  let releaseRead!:()=>void,announceRead!:(pid:number)=>void;
  const release=new Promise<void>(resolve=>{releaseRead=resolve;});
  const locked=new Promise<number>(resolve=>{announceRead=resolve;});
  const heldRead=db.transaction(async tx=>{
   const sourceDb=tx as unknown as typeof db;
   await assertAnalyticalContextPayloadAccess(sourceDb,companyId,reader,{issueId},undefined,{privacyLockMode:"read"});
   await assertAnalyticalContextPayloadAccess(sourceDb,companyId,reader,{runId},undefined,{privacyLockMode:"read"});
   const [backend]=await tx.execute<{pid:number}>(sql`select pg_backend_pid() as pid`);
   announceRead(backend!.pid);await release;
  });
  const readerPid=await locked;
  let writer:Promise<void>|undefined;
  try{
   let timeout:ReturnType<typeof setTimeout>|undefined;
   const secondRead=(async()=>{
    await assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId},undefined,{privacyLockMode:"read"});
    await assertAnalyticalContextPayloadAccess(db,companyId,reader,{runId},undefined,{privacyLockMode:"read"});
    return true;
   })();
   const completed=await Promise.race([secondRead,new Promise<false>(resolve=>{timeout=setTimeout(()=>resolve(false),2000);})]);
   if(timeout)clearTimeout(timeout);
   expect(completed,"a second source reader must not wait for the first reader to release").toBe(true);
   writer=db.transaction(async tx=>{
    await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx as unknown as typeof db,companyId);
    await tx.delete(companyMemberships).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalId,userId)));
   });
   let observedWriterWait=false;
   for(let attempt=0;attempt<100&&!observedWriterWait;attempt++){
    const [row]=await db.execute<{waiting:boolean}>(sql`select exists(select 1 from pg_stat_activity a
     where ${readerPid}=any(pg_blocking_pids(a.pid)) and a.wait_event_type='Lock') as waiting`);
    observedWriterWait=row?.waiting===true;
    if(!observedWriterWait)await new Promise(resolve=>setTimeout(resolve,10));
   }
   expect(observedWriterWait,"the privacy writer must remain exclusive behind the source reader").toBe(true);
   const pendingRead=assertAnalyticalContextPayloadAccess(db,companyId,reader,{runId},undefined,{privacyLockMode:"read"})
    .then(()=>null,error=>error);
   releaseRead();await heldRead;await writer;
   expect(await pendingRead).toMatchObject({status:403,details:{code:"analytical_source_access_lost"}});
   await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId},undefined,{privacyLockMode:"read"}))
    .rejects.toMatchObject({status:403,details:{code:"analytical_source_access_lost"}});
  }finally{releaseRead();await heldRead;await writer;}
 });

 it.each(["private_source","erased","retired"] as const)("keeps marked conversation admission denied for %s",async(reason)=>{
  await db.update(heartbeatRuns).set({contextSnapshot:{issueId,conversationSessionGeneration:0}}).where(eq(heartbeatRuns.id,runId));
  await expect(assertNativeAnalyticalRunPayloadAccess(db,companyId,runId)).resolves.toBeUndefined();
  if(reason==="private_source"){
   const privateTaskId=randomUUID(),privateRunId=randomUUID();
   await db.insert(issues).values({id:privateTaskId,companyId,title:"Human-only private source",visibility:"private",responsibleUserId:userId,createdByUserId:userId});
   await db.insert(heartbeatRuns).values({id:privateRunId,companyId,agentId,nativeIssueId:privateTaskId,runtimeMode:"native",status:"running",
    responsibleUserId:userId,contextSnapshot:{issueId:privateTaskId,conversationSessionGeneration:0}});
   await expect(assertNativeAnalyticalRunPayloadAccess(db,companyId,privateRunId)).rejects.toMatchObject({status:403,details:{code:"analytical_source_access_lost"}});
  }else{
   if(reason==="erased")await db.insert(memoryDeletionMarkers).values({companyId,kind:"source",key:`memory-run-source-erasure:v1:${runId}`});
   else await db.update(issues).set({conversationAgentId:null,conversationUserId:null,conversationState:null,status:"cancelled",hiddenAt:new Date(),
    assigneeAgentId:null,assigneeUserId:null,executionRunId:null,checkoutRunId:null,conversationRetiredAt:new Date()}).where(eq(issues.id,issueId));
   const [erasure]=await db.execute<{erased:boolean}>(sql`select aw_workflow_memory_erased(${companyId}::uuid,${runId}::uuid,${issueId}::uuid) as erased`);
   expect(erasure?.erased).toBe(true);
   await expect(assertNativeAnalyticalRunPayloadAccess(db,companyId,runId)).rejects.toMatchObject({status:403,details:{code:"analytical_source_access_lost"}});
  }
 });

 it("retains a managed metric result in a separate immutable Context and revokes its original sources",async()=>{
  const f=await fixture();
  const original=await db.select().from(contextManifests).where(eq(contextManifests.runId,runId));
  expect(original).toHaveLength(1);
  const captures:NativePayloadSourceSet[]=[];
  const result=await f.capture(source=>captures.push(source));
  expect(captures).toHaveLength(1);
  expect(captures[0]!.policy).toEqual({issueIds:[issueId],projectIds:[],runIds:[],memoryIds:[],foundationRevisionIds:[]});
  expect(captures[0]!.inputs).toEqual([expect.objectContaining({kind:"context",queryHash:nativeSha256(result)})]);
  const source=captures[0]!.inputs[0]!;
  if(source.kind!=="context")throw new Error("Expected the actual retained result Context");
  expect(source.manifestId).not.toBe(original[0]!.id);
  expect(await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,original[0]!.id))).toEqual([]);
  expect(await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,source.manifestId))).toHaveLength(1);
  const {assertAnalyticalRetentionRootOwnerCurrent}=await import("../services/analytical-context-authority.js");
  const retained=await root();
  await expect(assertAnalyticalRetentionRootOwnerCurrent(db,companyId,actor(),retained.memoryRecordId)).resolves.toBeDefined();
  await expect(assertAnalyticalRetentionRootOwnerCurrent(db,companyId,{...actor(),onBehalfOfUserId:randomUUID()},retained.memoryRecordId)).rejects.toMatchObject({status:403});
  await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{runId})).resolves.toBeUndefined();
  const {withNativeAnalyticalSourceReader}=await import("../services/analytical-reader.js");
  const sourceActor={...actor(),source:"none" as const};
  await expect(withNativeAnalyticalSourceReader(db,companyId,{...sourceActor,runId:randomUUID()},async()=>true)).rejects.toMatchObject({status:403});
  await expect(withNativeAnalyticalSourceReader(db,companyId,{...sourceActor,onBehalfOfUserId:randomUUID()},async()=>true)).rejects.toMatchObject({status:403});
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
  await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{runId})).rejects.toMatchObject({status:403});
 });

 it("withdraws routine execution payloads when an actual analytical authoring input becomes hidden",async()=>{
  const f=await fixture();await f.capture();
  await instanceSettingsService(db).updateExperimental({experience_projection_v9:true,ambient_commands_v9:true});
  await db.update(authUsers).set({emailVerified:true}).where(eq(authUsers.id,userId));
  await db.insert(principalPermissionGrants).values(grantsForHumanRole("admin").map(grant=>({companyId,principalType:"user" as const,principalId:userId,...grant})));
  const created=await routineAuthoringToolsService(db).create({companyId,agentId,runId},{idempotencyKey:"analytical-source-routine",
   title:"PRIVATE analytical routine",description:"PRIVATE copied answer",priority:"medium"});
  let executionRunId:string|null=null;
  const owner=routineService(db,{sourceActor:reader,heartbeat:{wakeup:async(targetAgentId,options)=>{
   const targetIssueId=typeof options.payload?.issueId==="string"?options.payload.issueId:
    typeof options.contextSnapshot?.issueId==="string"?options.contextSnapshot.issueId:null;
   if(!targetIssueId)return null;
   const [target]=await db.select({responsibleUserId:issues.responsibleUserId}).from(issues).where(eq(issues.id,targetIssueId));
   const [queued]=await db.insert(heartbeatRuns).values({companyId,agentId:targetAgentId,responsibleUserId:target?.responsibleUserId??userId,
    runtimeMode:"native",nativeIssueId:targetIssueId,status:"queued",contextSnapshot:{...(options.contextSnapshot??{}),issueId:targetIssueId}}).returning();
   await db.update(issues).set({executionRunId:queued!.id}).where(eq(issues.id,targetIssueId));executionRunId=queued!.id;return {id:queued!.id};
  }}});
  const draft=await owner.get(created.routineId);
  const active=await owner.update(created.routineId,{baseRevisionId:draft!.latestRevisionId,status:"active",assigneeAgentId:agentId,parentIssueId:null},{userId});
  expect(active).toMatchObject({status:"active",assigneeAgentId:agentId});
  const run=await owner.runRoutine(created.routineId,{source:"manual",idempotencyKey:"analytical-source-execution"},{userId});
  expect(run.status).toBe("issue_created");const taskId=run.linkedIssueId!;
  const [task]=await db.select().from(issues).where(eq(issues.id,taskId));
  expect(task).toMatchObject({originKind:"routine_execution",originId:created.routineId,originRunId:expect.any(String),assigneeAgentId:agentId,responsibleUserId:userId});
  expect(executionRunId).toEqual(expect.any(String));
  await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId:taskId})).resolves.toBeUndefined();
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
  await expect(owner.get(created.routineId)).rejects.toMatchObject({status:403});
  await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId:taskId})).rejects.toMatchObject({status:403});
  await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{runId:executionRunId!})).rejects.toMatchObject({status:403});
  expect(await db.select().from(memoryDeletionMarkers).where(eq(memoryDeletionMarkers.companyId,companyId))).toEqual([]);
 });

 it("withdraws an accepted Foundation revision when its actual analytical authoring input becomes hidden",async()=>{
  const f=await fixture();await f.capture();await db.update(authUsers).set({emailVerified:true}).where(eq(authUsers.id,userId));
  await db.insert(principalPermissionGrants).values({companyId,principalType:"user",principalId:userId,permissionKey:"foundation:read"});
  const actor={type:"board" as const,source:"session" as const,userId},mutation={principal:{type:"user" as const,userId}},owner=foundationService(db);
  const draft=await owner.createDraft(companyId,{foundationKey:"analytical-proposal",title:"Native Foundation",body:"Prior body",
    category:"governance",documentType:"policy",ownerUserId:userId},mutation);
  const [proposal]=await db.insert(foundationChangeProposals).values({companyId,foundationDocumentId:draft.id,sourceType:"conversation_authoring",
    sourceId:runId,conversationSourceRunId:runId,conversationResponsibleUserId:userId,proposedByAgentId:agentId,
    baseRevisionId:draft.latestRevisionId,proposedBody:"PRIVATE analytical proposal",reason:"PRIVATE analytical reason",status:"pending"}).returning();
  const accepted=await owner.acceptProposal(companyId,draft.id,proposal!.id,mutation);
  await expect(owner.get(companyId,draft.id,actor)).resolves.toMatchObject({latestRevisionId:accepted.foundation.latestRevisionId});
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
  await expect(owner.get(companyId,draft.id,actor)).rejects.toMatchObject({status:403});
  expect(await db.select().from(memoryDeletionMarkers).where(eq(memoryDeletionMarkers.companyId,companyId))).toEqual([]);
 });

 it("rejects a mixed restore population atomically when one manifest or native input was erased",async()=>{
  const f=await fixture(),captured=await f.capture(),[original]=await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,captured.lineageManifestId));
  const validId=randomUUID(),erasedId=randomUUID();
  await db.insert(memoryDeletionMarkers).values({companyId,kind:"source",key:nativeSha256([companyId,"source",["august_works_analytical",`manifest://${erasedId}`]])});
  await expect(db.insert(analyticalLineageManifests).values([validId,erasedId].map(id=>({...original!,id})))).rejects.toMatchObject({cause:{code:"23514",constraint_name:"aw_analytical_source_erased"}});
  expect(await db.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,companyId),sql`${analyticalLineageManifests.id} in (${validId},${erasedId})`))).toHaveLength(0);
  await db.insert(analyticalLineageManifests).values({...original!,id:validId});
  await db.insert(memoryDeletionMarkers).values({companyId,kind:"source",key:nativeSha256([companyId,"source",["august_works_analytical_input",`issue://${f.sourceId}`]])});
  const input=(inputRef:string)=>({companyId,manifestId:validId,inputType:"issue" as const,inputRef,inputHash:nativeSha256(inputRef),relationship:"source" as const});
  await expect(db.insert(analyticalLineageEdges).values([input(issueId),input(f.sourceId)])).rejects.toMatchObject({cause:{code:"23514",constraint_name:"aw_analytical_source_erased"}});
  expect(await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId,validId))).toHaveLength(0);
  await db.insert(analyticalLineageEdges).values(input(issueId));
  expect(await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId,validId))).toHaveLength(1);
 });

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
 it("explains complete exact metric lineage through the actual SDK and rejects substituted pins before retaining another root",async()=>{
  const f=await fixture(),tools=toolAuthority(),queried=await tools.execute({tool:"query_business_metric",callId:randomUUID(),arguments:f.query}) as {result:{observation:BusinessMetricResult}},value=queried.result.observation;
  const source={type:"metric_observation",id:value.id,metricId:value.metricId,metricVersionId:value.versionId},output=await tools.execute({tool:"explain_metric_lineage",callId:randomUUID(),arguments:{source}});
  expect(output).toMatchObject({tool:"explain_metric_lineage",citations:[{kind:"analytical_evidence",source}],result:{source,manifest:{id:value.lineageManifestId},edges:expect.arrayContaining([expect.objectContaining({inputType:"metric_version",inputRef:value.versionId})])}});
  const count=(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).length;expect(count).toBe(2);
  await expect(tools.execute({tool:"explain_metric_lineage",callId:randomUUID(),arguments:{source:{...source,metricVersionId:randomUUID()}}})).rejects.toMatchObject({status:404});
  expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(count);
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));await expect(tools.execute({tool:"explain_metric_lineage",callId:randomUUID(),arguments:{source}})).rejects.toMatchObject({status:403});
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
 it.each(["investigate","prepare_decision","propose_experiment","replan_project"] as const)("keeps the actual SDK %s preview advisory and dependent on its current Source",async(action)=>{
  const f=await fixture(),observation=await f.capture(),tools=toolAuthority();
  const source={type:"metric_observation" as const,id:observation.id,metricId:observation.metricId,metricVersionId:observation.versionId};
  const facts=async()=>({tasks:await db.select().from(issues).where(and(eq(issues.companyId,companyId),sql`${issues.id}<>${issueId}::uuid`)),projects:await db.select().from(projects).where(eq(projects.companyId,companyId)),decisions:await db.select().from(decisions).where(eq(decisions.companyId,companyId)),experiments:await db.select().from(businessExperiments).where(eq(businessExperiments.companyId,companyId))});
  const before=await facts(),input={tool:"propose_management_action",callId:randomUUID(),arguments:{action,rationale:"Investigate this exact observed native population",sources:[source]}};
  const preview=await tools.execute(input);
  expect(preview).toMatchObject({tool:"propose_management_action",citations:[{kind:"analytical_evidence",source}],result:{kind:"management_action_preview",action,humanReviewRequired:true,executionAuthority:"advisory_only"}});
  expect(await facts()).toEqual(before);
  expect((await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).at(-1)!.authorityPins).toEqual([{kind:"analytical_evidence",source}]);
  expect((await db.select().from(memoryRecords).where(eq(memoryRecords.companyId,companyId))).every(r=>r.reviewState==="rejected"&&r.verificationState==="unverified")).toBe(true);
  const rootCount=(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).length;
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
  await expect(tools.execute({...input,callId:randomUUID()})).rejects.toMatchObject({status:403});
  expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(rootCount);
  await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,f.sourceId));await copied();
  await instanceSettingsService(db).updateExperimental({management_chat_tools_v8:false,management_reviews_v8:false,business_metrics_v8:false,analytical_lineage_v8:false});
  await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
  await db.delete(businessMetricObservations).where(eq(businessMetricObservations.id,observation.id));
  expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);await reapplyMemoryDeletionMarkers(db,companyId);await erased();await memoryJobService(db).tick({limit:10});
  expect(await facts()).toEqual(before);
 });
 it("retains all eight actual SDK proposal Sources and rejects an oversized source set before adding a root",async()=>{
  const f=await fixture(),tools=toolAuthority(),sources=[];
  for(let index=0;index<8;index++){
   const started=performance.now();
   const result=await tools.execute({tool:"query_business_metric",callId:randomUUID(),arguments:{...f.query,from:new Date(Date.parse(f.query.from)+index).toISOString()}}) as {result:{observation:BusinessMetricResult}};
   expect(performance.now()-started).toBeLessThan(30000);
   const value=result.result.observation;sources.push({type:"metric_observation" as const,id:value.id,metricId:value.metricId,metricVersionId:value.versionId});
  }
  const argumentsValue={action:"prepare_decision",rationale:"Human must separately prepare a Decision from these eight exact Sources",sources};
  const result=await tools.execute({tool:"propose_management_action",callId:randomUUID(),arguments:argumentsValue});
  expect(result).toMatchObject({citations:sources.map(source=>({kind:"analytical_evidence",source})),result:{kind:"management_action_preview",humanReviewRequired:true}});
  const roots=await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId));expect(roots).toHaveLength(9);expect(roots.some(value=>value.sourceCount===8&&value.authorityPins.length===8)).toBe(true);
  await expect(tools.execute({tool:"propose_management_action",callId:randomUUID(),arguments:{...argumentsValue,sources:[...sources,sources[0]]}})).rejects.toThrow();
  expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(9);
  await copied();await db.delete(businessMetricObservations).where(eq(businessMetricObservations.id,sources[7]!.id));
  expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).toHaveLength(7);
  expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);await reapplyMemoryDeletionMarkers(db,companyId);await erased();await memoryJobService(db).tick({limit:10});
 // Eight separately bounded reads plus proposal/erasure are a multi-call
 // harness journey; every original tool deadline remains 30 seconds.
 },120_000);
 it.each([5000,10000])("qualifies the complete %s-Task SDK population and rejects oversized lineage without partial retention",async(populationSize)=>{
  const f=await fixture(true,true),at=new Date(Date.now()-1000),rows=Array.from({length:populationSize-1},(_,index)=>({id:randomUUID(),companyId,title:`Synthetic SDK volume Task ${index}`,status:"done" as const,responsibleUserId:userId,createdAt:at,updatedAt:at}));
  // Explicit native software population prerequisites, not performed Task
  // executions or a Human/customer/provider trial.
  for(let start=0;start<rows.length;start+=200)await db.insert(issues).values(rows.slice(start,start+200));
  const tools=toolAuthority(),input={...f.query,until:new Date(Date.now()+1000).toISOString(),maxRows:populationSize===10000?10000:undefined},started=performance.now();
  const payload=await tools.execute({tool:"query_business_metric",callId:randomUUID(),arguments:input}) as {result:{observation:BusinessMetricResult}};
  process.stdout.write(`Complete native metric query and Context retention ${JSON.stringify({populationSize,queryAndRetentionMs:Math.round(performance.now()-started),fixture:"explicit_bulk_software_prerequisites"})}\n`);
  expect(performance.now()-started).toBeLessThan(30000);expect(payload.result.observation.value).toBe(populationSize);
  expect(Buffer.byteLength(JSON.stringify(payload),"utf8")).toBeLessThanOrEqual(256000);expect((await root()).authorityPins).toHaveLength(1);
  const [manifest]=await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,payload.result.observation.lineageManifestId));expect(manifest!.sourceCount).toBe(populationSize);
  const observation=payload.result.observation,source={type:"metric_observation",id:observation.id,metricId:observation.metricId,metricVersionId:observation.versionId};
  await expect(tools.execute({tool:"explain_metric_lineage",callId:randomUUID(),arguments:{source}})).rejects.toMatchObject({status:422});
  expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(1);
  expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).toHaveLength(1);
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,rows.at(-1)!.id));
  await expect(assertAnalyticalContextPayloadAccess(db,companyId,board,{runId})).rejects.toMatchObject({status:403});
  await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,rows.at(-1)!.id));await copied();
  await instanceSettingsService(db).updateExperimental({management_chat_tools_v8:false,management_reviews_v8:false,business_metrics_v8:false,analytical_lineage_v8:false});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
  await db.delete(businessMetricObservations).where(eq(businessMetricObservations.id,payload.result.observation.id));
  expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);await reapplyMemoryDeletionMarkers(db,companyId);await erased();await memoryJobService(db).tick({limit:10});
  expect(await db.select({id:issues.id}).from(issues).where(and(eq(issues.companyId,companyId),eq(issues.status,"done")))).toHaveLength(populationSize);
 },120000);
 it("rolls back a valid native measurement when the complete read exceeds the original retention deadline",async()=>{
  const f=await fixture();let restoreClock:(()=>void)|undefined;
  try {
   await expect(withAnalyticalConversationRetention(db,companyId,actor(),async tx=>{
    const result=await businessMetricService(tx).query(companyId,actor(),f.query),late=performance.now()+31000;
    const clock=vi.spyOn(performance,"now").mockReturnValue(late);restoreClock=()=>clock.mockRestore();
    return {result,sourceManifestIds:[result.lineageManifestId],retentionUntil:new Date(result.expiresAt)};
   })).rejects.toMatchObject({status:409});
  } finally {restoreClock?.();}
  expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).toHaveLength(0);
  expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(0);
 });
 it("rechecks the complete batched Task privacy set before transaction commit",async()=>{
  const f=await fixture(),privateIssueId=randomUUID(),otherUserId=`private-source-${randomUUID()}`;
  await db.insert(authUsers).values({id:otherUserId,name:"Private source owner",email:`${otherUserId}@example.test`,emailVerified:true,image:null,createdAt:new Date(),updatedAt:new Date()});
  await db.insert(issues).values({id:privateIssueId,companyId,title:"Private contributing task",status:"done",visibility:"private",responsibleUserId:otherUserId});
  const beforeObservations=(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).length;
  const beforeManifests=(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.companyId,companyId))).length;
  const manifestId=randomUUID(),observationId=randomUUID(),now=new Date(),hash="a".repeat(64);
  await expect(db.transaction(async tx=>authorizationService(tx).withReadSources(companyId,[f.sourceId],[],async owner=>{
    await tx.insert(analyticalLineageManifests).values({id:manifestId,companyId,analysisType:"business_metric",analysisRef:observationId,engineVersion:"native-test",inputHash:hash,definitionHash:hash,requestedBy:userId,sourceWatermark:"fixture",sourceCount:1,parameters:{},createdAt:now,expiresAt:new Date(now.getTime()+60000)});
    await tx.insert(analyticalLineageEdges).values({companyId,manifestId,inputType:"issue",inputRef:f.sourceId,inputHash:hash,relationship:"source"});
    await tx.insert(issuePrivacySources).values({companyId,issueId:f.sourceId,sourceKind:"issue",sourceId:privateIssueId});
    await owner.assertTaskPrivacyBatch(actor(),[f.sourceId],[]);
    return "staged metric output";
  }))).rejects.toMatchObject({status:403});
  expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).toHaveLength(beforeObservations);
  expect(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.companyId,companyId))).toHaveLength(beforeManifests);
  expect(await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId,manifestId))).toHaveLength(0);
  expect(await db.select().from(issuePrivacySources).where(eq(issuePrivacySources.issueId,f.sourceId))).toHaveLength(0);
 });
 it("commits the full source set and conservative expiry before returning a native result",async()=>{const f=await fixture(),result=await f.capture(),r=await root(),[memory]=await db.select().from(memoryRecords).where(eq(memoryRecords.id,r.memoryRecordId));expect(result.lineageManifestId).toBeTruthy();expect(r.sourceCount).toBe(1);expect(r.expiresAt.toISOString()).toBe(result.expiresAt);expect(memory).toMatchObject({reviewState:"rejected",verificationState:"unverified",memoryType:"observation",scopeType:"agent",confidenceScore:0});expect(await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.memoryRecordId,r.memoryRecordId))).toHaveLength(1);await expect(db.update(memoryRecords).set({reviewState:"accepted",verificationState:"human_verified",memoryType:"outcome"}).where(eq(memoryRecords.id,r.memoryRecordId))).rejects.toThrow();});
 it("requires the current native Context and rolls back measurement derivation on failure",async()=>{const f=await fixture(false);await expect(f.capture()).rejects.toMatchObject({status:409});expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).toHaveLength(0);expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(0);});
 it("rolls back a derived measurement if the complete source set is unavailable",async()=>{await fixture();await expect(withAnalyticalConversationRetention(db,companyId,actor(),async()=>({result:{copy:"uncommitted"},sourceManifestIds:[randomUUID()],retentionUntil:new Date(Date.now()+60000)}))).rejects.toMatchObject({status:409});expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(0);});
 it("erases run-owned runtime copies and retained legacy bundles through native C7, retrying filesystem failure without removing another tenant reference",async()=>{
  const priorHome=process.env.PAPERCLIP_HOME,priorInstance=process.env.PAPERCLIP_INSTANCE_ID,home=await fs.mkdtemp(path.join(os.tmpdir(),"aw-native-asset-c7-"));
  process.env.PAPERCLIP_HOME=home;process.env.PAPERCLIP_INSTANCE_ID="native-asset-c7";
  try{
   const f=await fixture();await f.capture();
   const instructions=path.join(home,"user-sources","instructions"),skillSource=path.join(home,"user-sources","skill");
   await fs.mkdir(instructions,{recursive:true});await fs.mkdir(skillSource,{recursive:true});
   await fs.writeFile(path.join(instructions,"AGENTS.md"),"Synthetic retained instructions");await fs.writeFile(path.join(skillSource,"SKILL.md"),"Synthetic retained procedure");
   const [agent]=await db.update(agents).set({adapterConfig:{instructionsFilePath:path.join(instructions,"AGENTS.md")}}).where(eq(agents.id,agentId)).returning();
   const key=`company/${companyId}/retained`,input={db,agent:agent!,runId,runtimeConfig:{paperclipSkillSync:{desiredSkills:[key]}},runtimeSkillEntries:[{key,runtimeName:"retained",source:skillSource,sourceStatus:"available" as const,versionId:null}]};
   const context=await buildRetainedNativeRuntimeContext(input),owner={companyId,runId};
   const binding={companyId,agentId,runId,issueId};
   const connector=await withRetainedNativeRuntimeAssets({db,...binding},()=>applyConnectorSkills({},[],[{key:"agentmail",label:"AgentMail",skillKey:"paperclipai/paperclip/agentmail",tools:[],resources:[{id:"explicit-software-resource",label:"private-software-resource@example.test",connectionId:"explicit-software-connection"}]}],owner));
   expect(await fs.readFile(path.join(connector.paperclipRuntimeSkills[0].source,"SKILL.md"),"utf8")).toContain("private-software-resource@example.test");
   expect((await prepareRetainedConnectorSkills(db,binding,{},[])).assignments).toEqual([]);
   expect(context.skills).toHaveLength(1);expect(await readNativeRuntimeAssetText(context.skills[0]!.bundle,32000,owner)).toEqual([{path:"SKILL.md",text:"Synthetic retained procedure"}]);
   await expect(readNativeRuntimeAssetText(context.skills[0]!.bundle,32000,{companyId,runId:randomUUID()})).rejects.toThrow();
   await expect(eraseNativeRuntimeAssets(db,owner,[])).rejects.toThrow("no Source erasure receipt");
   await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
   await expect(buildRetainedNativeRuntimeContext(input)).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
   await expect(prepareRetainedConnectorSkills(db,binding,{},[])).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
   await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,f.sourceId));
   const legacy=await materializeAsset([{path:"SKILL.md",content:Buffer.from("Independent identical synthetic procedure"),mode:0o444}]);
   const otherCompany=randomUUID(),otherAgent=randomUUID(),otherRun=randomUUID();
   await db.insert(companies).values({id:otherCompany,name:"Independent tenant",issuePrefix:randomUUID()});await db.insert(agents).values({id:otherAgent,companyId:otherCompany,name:"Independent agent",role:"engineer"});
   const profile={nativeExecutionInput:{runtimeContext:{instructions:{bundle:legacy},skills:[]}}};
   await db.insert(heartbeatRuns).values({id:otherRun,companyId:otherCompany,agentId:otherAgent,status:"running",runnerProfileJson:profile});
   const otherOwner={companyId:otherCompany,runId:otherRun},otherBundle=await materializeAsset([{path:"SKILL.md",content:Buffer.from("Independent tenant run-owned procedure"),mode:0o444}],otherOwner);
   const providerHome=managedOpenCodeRuntimeDirectory(owner),providerDb=path.join(providerHome,"managed-session-1","data","opencode.db"),outsideUserData=path.join(home,"operator-owned.sqlite");
   await fs.mkdir(path.dirname(providerDb),{recursive:true});await fs.writeFile(providerDb,"Synthetic private OpenCode transcript bytes");
   await fs.writeFile(outsideUserData,"Independent operator data");
   await db.insert(memoryJobs).values({companyId,operationType:"retention",jobKey:`runtime-asset-erasure:v1:${runId}`,
     status:"succeeded",attemptNumber:1,finishedAt:new Date(),sourceRefJson:{kind:"runtime_asset_erasure",runId,legacyDigests:[]}});
   await expect(purgeCompanyContent(db,companyId)).rejects.toMatchObject({status:409});
   await expect(db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,runId))).resolves.toHaveLength(1);
   // Persisted native historical profile fixture owns the old shared reference;
   // newly published run-owned files exist even before the final profile write.
   await db.update(heartbeatRuns).set({runnerProfileJson:profile}).where(eq(heartbeatRuns.id,runId));
   const runRoot=nativeRuntimeAssetsRoot(owner),companyRoot=path.dirname(runRoot),saved=companyRoot+".saved";
   await instanceSettingsService(db).updateExperimental({management_chat_tools_v8:false,management_reviews_v8:false,business_metrics_v8:false,analytical_lineage_v8:false,enableCollectiveMemoryV1:false,enablePrivateAgentMemoryV1:false});
   await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));await db.delete(issues).where(eq(issues.id,f.sourceId));
   expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);
   await expect(buildRetainedNativeRuntimeContext(input)).rejects.toThrow("native_runtime_asset_source_unavailable");
   await memoryJobService(db).tick({limit:100});
   expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,runId)))[0]!.runnerProfileJson).toBeNull();
   const failed=await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId,companyId),sql`${memoryJobs.sourceRefJson}->>'kind'='runtime_asset_erasure'`));
   expect(failed.length).toBeGreaterThan(0);expect(failed.every(job=>job.status==="failed")).toBe(true);
   await expect(fs.readFile(providerDb,"utf8")).resolves.toBe("Synthetic private OpenCode transcript bytes");
   // A source receipt alone does not prove the local provider process stopped.
   // Advance the existing native Stop owner with an observed-absent local PID,
   // then persist the normal terminal finalization before retrying deletion.
   const stoppedProcess=spawn(process.execPath,["-e","setTimeout(()=>process.exit(0),25)"],{detached:true,stdio:"ignore"});
   if(!stoppedProcess.pid)throw new Error("Could not start local Stop test process");
   const [stoppedCode]=await once(stoppedProcess,"exit");expect(stoppedCode).toBe(0);
   const stoppedPid=stoppedProcess.pid;
   await db.update(heartbeatRuns).set({driverKind:"opencode_server",status:"interrupted",processPid:stoppedPid,
     processGroupId:stoppedPid,controllerLeaseExpiresAt:null}).where(eq(heartbeatRuns.id,runId));
   const [stoppingRun]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,runId));
   expect(await recordNativeLocalProcessStop(db,stoppingRun!)).toBe(true);
   await db.update(heartbeatRuns).set({processPid:null,processGroupId:null}).where(eq(heartbeatRuns.id,runId));
   await db.insert(nativeRunFinalizations).values({companyId,issueId,runId,phase:"committed",leaseOwner:null,leaseExpiresAt:null});
   await fs.rename(companyRoot,saved);await fs.symlink(saved,companyRoot);
   await db.update(memoryJobs).set({updatedAt:new Date(Date.now()-61000)}).where(and(eq(memoryJobs.companyId,companyId),sql`${memoryJobs.sourceRefJson}->>'kind'='runtime_asset_erasure'`));
   await memoryJobService(db).tick({limit:100});
   await fs.unlink(companyRoot);await fs.rename(saved,companyRoot);
   await db.update(memoryJobs).set({updatedAt:new Date(Date.now()-61000)}).where(and(eq(memoryJobs.companyId,companyId),sql`${memoryJobs.sourceRefJson}->>'kind'='runtime_asset_erasure'`));
   const providerSaved=providerHome+".saved";
   await fs.rename(providerHome,providerSaved);await fs.symlink(providerSaved,providerHome);
   await memoryJobService(db).tick({limit:100});
   await expect(fs.readFile(path.join(providerSaved,"managed-session-1","data","opencode.db"),"utf8")).resolves.toBe("Synthetic private OpenCode transcript bytes");
   await fs.unlink(providerHome);await fs.rename(providerSaved,providerHome);
   await db.update(memoryJobs).set({updatedAt:new Date(Date.now()-61000)}).where(and(eq(memoryJobs.companyId,companyId),sql`${memoryJobs.sourceRefJson}->>'kind'='runtime_asset_erasure'`));
   await memoryJobService(db).tick({limit:100});
   expect((await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId,companyId),sql`${memoryJobs.sourceRefJson}->>'kind'='runtime_asset_erasure'`))).every(job=>job.status==="succeeded")).toBe(true);
   await expect(fs.stat(runRoot)).rejects.toMatchObject({code:"ENOENT"});
   await expect(fs.stat(providerHome)).rejects.toMatchObject({code:"ENOENT"});
   await expect(fs.readFile(outsideUserData,"utf8")).resolves.toBe("Independent operator data");
   await expect(fs.stat(connector.paperclipRuntimeSkills[0].source)).rejects.toMatchObject({code:"ENOENT"});
   await expect(prepareRetainedConnectorSkills(db,binding,{},[])).rejects.toThrow("native_runtime_asset_source_unavailable");
   await expect(buildRetainedNativeRuntimeContext(input)).rejects.toThrow("native_runtime_asset_source_unavailable");
   expect(await readNativeRuntimeAssetText(legacy,32000,otherOwner)).toHaveLength(1);
   expect(await readNativeRuntimeAssetText(otherBundle,32000,otherOwner)).toHaveLength(1);
   expect(await fs.readFile(path.join(skillSource,"SKILL.md"),"utf8")).toBe("Synthetic retained procedure");
   await purgeCompanyContent(db,otherCompany);await memoryJobService(db).tick({limit:100});
   await expect(fs.stat(otherBundle.rootPath)).rejects.toMatchObject({code:"ENOENT"});await expect(fs.stat(legacy.rootPath)).rejects.toMatchObject({code:"ENOENT"});
  }finally{
   if(priorHome===undefined)delete process.env.PAPERCLIP_HOME;else process.env.PAPERCLIP_HOME=priorHome;
   if(priorInstance===undefined)delete process.env.PAPERCLIP_INSTANCE_ID;else process.env.PAPERCLIP_INSTANCE_ID=priorInstance;
   const writable=async(directory:string):Promise<void>=>{const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())return;await fs.chmod(directory,0o700);for(const name of await fs.readdir(directory))await writable(path.join(directory,name));};
   await writable(home);await fs.rm(home,{recursive:true,force:true});
  }
 });
 it("queues every legacy native profile digest in bounded original outbox jobs on actual run deletion",async()=>{
  const priorHome=process.env.PAPERCLIP_HOME,priorInstance=process.env.PAPERCLIP_INSTANCE_ID,home=await fs.mkdtemp(path.join(os.tmpdir(),"aw-native-asset-batches-"));
  process.env.PAPERCLIP_HOME=home;process.env.PAPERCLIP_INSTANCE_ID="asset-batches";
  try{
   // Explicit metadata fixtures qualify complete batching, not materialized bodies or provider execution.
   const digests=Array.from({length:513},(_,index)=>index.toString(16).padStart(64,"0")),assets=nativeRuntimeAssetsRoot();
   const reference=(digest:string)=>({digest,rootPath:path.join(assets,"bundles",digest)});
   const profile={nativeExecutionInput:{runtimeContext:{instructions:{bundle:reference(digests[0]!)},skills:digests.slice(1).map(digest=>({bundle:reference(digest)}))}}};
   await db.update(heartbeatRuns).set({runnerProfileJson:profile}).where(eq(heartbeatRuns.id,runId));
   await db.delete(heartbeatRuns).where(eq(heartbeatRuns.id,runId));
   const jobs=await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId,companyId),sql`${memoryJobs.sourceRefJson}->>'kind'='runtime_asset_erasure'`));
   expect(jobs).toHaveLength(3);expect(jobs.every(job=>(job.sourceRefJson.legacyDigests as string[]).length<=256)).toBe(true);
   expect(jobs.flatMap(job=>job.sourceRefJson.legacyDigests as string[]).sort()).toEqual(digests);
   await memoryJobService(db).tick({limit:100});
   expect((await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId,companyId),sql`${memoryJobs.sourceRefJson}->>'kind'='runtime_asset_erasure'`))).every(job=>job.status==="succeeded")).toBe(true);
  }finally{
   if(priorHome===undefined)delete process.env.PAPERCLIP_HOME;else process.env.PAPERCLIP_HOME=priorHome;
   if(priorInstance===undefined)delete process.env.PAPERCLIP_INSTANCE_ID;else process.env.PAPERCLIP_INSTANCE_ID=priorInstance;
   await fs.rm(home,{recursive:true,force:true});
  }
 });
 it.each(["profile","inventory"] as const)("fences and erases deleted Skill version copies using the actual %s owner without deleting independent outcomes",async(kind)=>{
  const priorHome=process.env.PAPERCLIP_HOME,priorInstance=process.env.PAPERCLIP_INSTANCE_ID,home=await fs.mkdtemp(path.join(os.tmpdir(),"aw-native-skill-source-"));
  process.env.PAPERCLIP_HOME=home;process.env.PAPERCLIP_INSTANCE_ID="skill-source";
  try{
   const f=await fixture();await f.capture();const privateRoot=await root();
   await instanceSettingsService(db).updateExperimental({skill_lifecycle_v5:true});
   const created=await skillLifecycleService(db).createDraft(board,companyId,createGovernedSkillSchema.parse({slug:"source-procedure",name:"Source procedure",markdown:"Synthetic native Skill procedure",sharing:"company_proposed"}));
   const service=companySkillService(db),skill=(await service.getById(companyId,created.skillId))!;
   const entries=await service.listRuntimeSkillEntries(companyId,{selectedSkillKeys:new Set([skill.key]),versionSelections:new Map([[skill.key,created.candidate.id]]),allowCandidateVersionsForTest:true});
   const [agent]=await db.select().from(agents).where(eq(agents.id,agentId));
   const input={db,agent:agent!,runId,runtimeConfig:{paperclipSkillSync:{desiredSkills:[skill.key]}},runtimeSkillEntries:entries};
   // Native candidate test preparation and persisted profile/inventory fixtures;
   // no promotion, provider execution or trial prerequisites are invented.
   const context=await buildRetainedNativeRuntimeContext(input);
   expect(context.skills[0]!.versionId).toBe(created.candidate.id);
   expect(await readNativeRuntimeAssetText(context.skills[0]!.bundle,32000,{companyId,runId})).toEqual([{path:"SKILL.md",text:"Synthetic native Skill procedure"}]);
   if(kind==="profile")await db.update(heartbeatRuns).set({runnerProfileJson:{nativeExecutionInput:{runtimeContext:context}}}).where(eq(heartbeatRuns.id,runId));
   else{
    const [identity]=await db.select().from(agentIdentities).where(eq(agentIdentities.id,agent!.agentIdentityId!));expect(identity).toBeDefined();
    const [packet]=await db.select().from(contextManifests).where(eq(contextManifests.runId,runId));
    const manifest=agentExecutionManifestSchema.parse({schemaVersion:5,runId,companyId,agentId,agentIdentityId:identity!.id,homeCompanyId:companyId,responsibleUserId:userId,
     executionScope:{primaryCompanyId:companyId,primaryAgentPresenceId:agentId,delegatedScopes:[]},rolePack:null,contextManifests:[{companyId,contextManifestId:packet!.id}],
     skills:[{skillId:skill.id,versionId:created.candidate.id,key:skill.key,name:skill.name,selection:"task_required",loadPoint:"always",estimatedDescriptorTokens:1}],playbooks:[],capabilities:[],
     providers:[{companyId,agentId,providerBindingId:randomUUID(),profileRef:"software-fixture",snapshotHash:"fixture",isolationMode:"isolated_per_presence"}],
     executionPolicy:{deterministicPreference:true,policies:[],approvalRefs:[],restrictions:[],policySnapshotHash:"fixture"},inventoryEstimatedTokens:1,warnings:[]});
    const [inventory]=await db.insert(agentExecutionManifests).values({companyId,runId,agentId,agentIdentityId:identity!.id,contextManifestId:packet!.id,manifest,policySnapshotHash:"fixture",hash:"fixture"}).returning();
    await db.insert(agentExecutionManifestItems).values({companyId,manifestId:inventory!.id,type:"skill",ref:skill.id,versionRef:created.candidate.id});
    await db.update(heartbeatRuns).set({runnerProfileJson:null}).where(eq(heartbeatRuns.id,runId));
   }
   const [binding]=await db.insert(memoryBindings).values({companyId,key:"independent",name:"Independent outcome fixture",providerKey:"local"}).returning();
   const [outcome]=await db.insert(memoryRecords).values({companyId,bindingId:binding!.id,providerKey:"local",memoryType:"outcome",scopeType:"company",content:"Independent verified outcome software fixture",reviewState:"accepted",verificationState:"human_verified",observedAt:new Date(),createdByActorType:"system",createdByActorId:"fixture"}).returning();
   await copied();
   await instanceSettingsService(db).updateExperimental({skill_lifecycle_v5:false,management_chat_tools_v8:false,management_reviews_v8:false,business_metrics_v8:false,analytical_lineage_v8:false,enableCollectiveMemoryV1:false,enablePrivateAgentMemoryV1:false});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
   await service.deleteSkill(companyId,skill.id);
   expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);
   await expect(assertAnalyticalContextPayloadAccess(db,companyId,actor(),{runId})).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
   await expect(assertAnalyticalContextPayloadAccess(db,companyId,actor(),{issueId})).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
   await expect(buildRetainedNativeRuntimeContext(input)).rejects.toThrow("native_runtime_asset_source_unavailable");
   await memoryJobService(db).tick({limit:100});await erased();
   await expect(fs.stat(nativeRuntimeAssetsRoot({companyId,runId}))).rejects.toMatchObject({code:"ENOENT"});await expect(fs.stat(entries[0]!.source)).rejects.toMatchObject({code:"ENOENT"});
   expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,privateRoot.memoryRecordId)))[0]).toMatchObject({content:"",reviewState:"rejected",verificationState:"unverified"});
   expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,outcome!.id)))[0]).toMatchObject({content:"Independent verified outcome software fixture",reviewState:"accepted",verificationState:"human_verified",deletedAt:null});
   if(kind==="inventory")expect((await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId,runId)))[0]!.manifest).toEqual({payloadDeleted:true});
   await db.update(heartbeatRuns).set({resultJson:{late:"Synthetic erased Skill copy"}}).where(eq(heartbeatRuns.id,runId));expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,runId)))[0]!.resultJson).toBeNull();
  }finally{
   if(priorHome===undefined)delete process.env.PAPERCLIP_HOME;else process.env.PAPERCLIP_HOME=priorHome;
   if(priorInstance===undefined)delete process.env.PAPERCLIP_INSTANCE_ID;else process.env.PAPERCLIP_INSTANCE_ID=priorInstance;
   const writable=async(directory:string):Promise<void>=>{const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())return;await fs.chmod(directory,0o700);for(const name of await fs.readdir(directory))await writable(path.join(directory,name));};await writable(home);await fs.rm(home,{recursive:true,force:true});
  }
 });
 it.each(["issue","project","observation"])("queues the original retention sweep for actual %s deletion with all relevant flags off and company paused",async(kind)=>{
  const f=await fixture();let projectId:string|undefined;
  if(kind==="project"){
   const app=express();app.use(express.json());app.use((req,_res,next)=>{req.actor=reader;next();});app.use("/api",projectRoutes(db));app.use(errorHandler);
   const created=await request(app).post(`/api/companies/${companyId}/projects`).send({name:"Human-owned Synthetic Source project"});
   expect(created.status).toBe(201);projectId=created.body.id as string;await db.update(issues).set({projectId}).where(eq(issues.id,f.sourceId));
   const [version]=await db.select().from(businessMetricVersions).where(eq(businessMetricVersions.id,f.query.versionId));if(version!.definition.calculation.kind!=="native_ratio")throw new Error("Expected the actual fixture ratio definition");
   const definition={...version!.definition,calculation:{...version!.definition.calculation,numerator:{...version!.definition.calculation.numerator,projectId},denominator:{...version!.definition.calculation.denominator,projectId}}};
   const next=await businessMetricService(db).createVersion(companyId,board,f.query.metricId,{expectedRevision:2,definition});await businessMetricService(db).publish(companyId,board,f.query.metricId,{expectedRevision:3,versionId:next.id});f.query.versionId=next.id;
  }
  const captured=await f.capture(),r=await root();await copied();
  await instanceSettingsService(db).updateExperimental({management_chat_tools_v8:false,management_reviews_v8:false,business_metrics_v8:false,analytical_lineage_v8:false,enableCollectiveMemoryV1:false,enablePrivateAgentMemoryV1:false});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
  if(kind==="issue")await db.delete(issues).where(eq(issues.id,f.sourceId));else if(kind==="project"){await db.update(issues).set({projectId:null}).where(eq(issues.id,f.sourceId));expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(true);await db.delete(projects).where(eq(projects.id,projectId!));}else await db.delete(businessMetricObservations).where(eq(businessMetricObservations.id,captured.id));
  expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);
  const [job]=await db.select().from(memoryJobs).where(eq(memoryJobs.jobKey,`analytical-context-erasure:v1:${r.memoryRecordId}`));expect(job!.sourceRefJson).toEqual({kind:"retention_sweep"});
  if(kind==="issue")await db.update(memoryJobs).set({status:"failed",finishedAt:new Date(Date.now()-61000),updatedAt:new Date(Date.now()-61000),error:"Synthetic interrupted local sweep"}).where(eq(memoryJobs.id,job!.id));
  await memoryJobService(db).tick({limit:10});expect((await db.select().from(memoryJobs).where(eq(memoryJobs.id,job!.id)))[0]!.status).toBe("succeeded");await erased();
 });
 it("erases native copied prose when its original source is suppressed with rollout disabled",async()=>{const f=await fixture();await f.capture();await copied();await instanceSettingsService(db).updateExperimental({management_chat_tools_v8:false,management_reviews_v8:false,business_metrics_v8:false});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));await db.transaction(tx=>suppressAnalyticalSource(tx,companyId,"issue",f.sourceId));await erased();});
 it("immediately withholds direct source deletion and physically scrubs through the existing C7 worker",async()=>{const f=await fixture(),result=await f.capture();await copied();await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,result.lineageManifestId));expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);await reapplyMemoryDeletionMarkers(db,companyId);await erased();});
 it("keeps source erasure effective against restored Memory and late runtime writes",async()=>{const f=await fixture(),result=await f.capture(),r=await root();await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,result.lineageManifestId));await db.update(memoryRecords).set({deletedAt:null,content:"Restored analytical root"}).where(eq(memoryRecords.id,r.memoryRecordId));await db.update(heartbeatRuns).set({resultJson:{leak:"Late worker"},contextSnapshot:{leak:"Late context"}}).where(eq(heartbeatRuns.id,runId));await db.insert(heartbeatRunEvents).values({companyId,agentId,runId,seq:1,eventType:"stdout",message:"Late output",payload:{leak:"Late output"}});expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,runId)))[0]!.resultJson).toBeNull();expect((await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId,runId)))[0]!.payload).toBeNull();await reapplyMemoryDeletionMarkers(db,companyId);expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,r.memoryRecordId)))[0]!.content).toBe("");});
 it("runs native analytical expiry while rollout is off and scrubs consumed results",async()=>{const f=await fixture();await f.capture();await copied();await instanceSettingsService(db).updateExperimental({management_chat_tools_v8:false,management_reviews_v8:false,business_metrics_v8:false});const now=new Date(Date.now()+31*86400000);let more=true;for(let tick=0;tick<10&&more;tick++)more=(await eraseExpiredAnalyticalLineage(db,now)).hasMoreCompanies;expect(more).toBe(false);await erased();});
 it("rejects mutable provenance and incomplete added source roots",async()=>{const f=await fixture();await f.capture();const r=await root();await expect(db.update(analyticalContextRoots).set({sourceCount:2}).where(eq(analyticalContextRoots.memoryRecordId,r.memoryRecordId))).rejects.toThrow();await expect(db.insert(analyticalContextDependencies).values({companyId,memoryRecordId:r.memoryRecordId,sourceManifestId:randomUUID()})).rejects.toThrow();});
 it("withholds copied payload at the original result expiry before any cleanup worker runs",async()=>{const f=await fixture();f.query.until=new Date(Date.now()+3_600_000).toISOString();const result=await f.capture();const now=new Date();await contextManifestService(db).create({companyId,agentId,issueId,runId,query:"Short result expiry",policySnapshot:{fixture:true},selected:[]});await withAnalyticalConversationRetention(db,companyId,actor(),async tx=>({result:await businessMetricService(tx).inspectCurrentObservation(companyId,actor(),result.id),sourceManifestIds:[result.lineageManifestId],retentionUntil:new Date(now.getTime()+5_000)}));await new Promise(resolve=>setTimeout(resolve,5_100));expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);await expect(f.capture()).rejects.toMatchObject({status:403});});
 it("preserves provenance against direct root removal and permits actual native company purge",async()=>{const f=await fixture();await f.capture();await toolAuthority().execute({tool:"list_business_metrics",callId:randomUUID(),arguments:{}});const r=await root();await expect(db.delete(analyticalContextRoots).where(eq(analyticalContextRoots.memoryRecordId,r.memoryRecordId))).rejects.toThrow();const foreign=randomUUID();await db.insert(companies).values({id:foreign,name:"Independent preserved tenant",issuePrefix:randomUUID()});await db.insert(issues).values({companyId:foreign,title:"Independent original source"});const purge=await purgeCompanyContent(db,companyId);expect(purge.companyTombstoneRetained).toBe(true);expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(0);expect(await db.select().from(issues).where(eq(issues.companyId,foreign))).toHaveLength(1);});

 it("closes a whole multi-source result when one source disappears without deleting the other observation",async()=>{const f=await fixture(),first=await f.capture(),second=await f.capture();await withAnalyticalConversationRetention(db,companyId,actor(),async tx=>({result:{first:await businessMetricService(tx).inspectCurrentObservation(companyId,actor(),first.id),second:await businessMetricService(tx).inspectCurrentObservation(companyId,actor(),second.id)},sourceManifestIds:[first.lineageManifestId,second.lineageManifestId],retentionUntil:new Date(Math.min(Date.parse(first.expiresAt),Date.parse(second.expiresAt)))}));expect((await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).some(r=>r.sourceCount===2)).toBe(true);await copied();await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,first.lineageManifestId));expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,second.id))).toHaveLength(1);await reapplyMemoryDeletionMarkers(db,companyId);await erased();});

 it("reauthorizes copied native prose for the current human after the original run ends",async()=>{const f=await fixture();await f.capture();await copied();const reader={type:"board" as const,source:"session" as const,userId,companyIds:[companyId]};await db.update(heartbeatRuns).set({status:"succeeded"}).where(eq(heartbeatRuns.id,runId));await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId})).resolves.toBeUndefined();await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{runId})).resolves.toBeUndefined();await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalId,userId)));await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId})).rejects.toMatchObject({status:403});});
 it("withholds copied prose when an original contributing task becomes hidden",async()=>{const f=await fixture();await f.capture();await copied();await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));await expect(assertAnalyticalContextPayloadAccess(db,companyId,board,{issueId})).rejects.toMatchObject({status:403});expect((await db.select().from(issueComments).where(eq(issueComments.issueId,issueId)))[0]!.body).toBe("Synthetic analytical answer");});
 it("reauthorizes the actual ancestor's analytical sources for a saved Native task",async()=>{
  const f=await fixture();await f.capture();
  const saved=await new PaperclipRunnerToolAuthority(db,{companyId,agentId,issueId,runId}).execute({tool:"create_task",callId:"retained-source-draft",arguments:{idempotencyKey:"retained-source-draft",title:"Synthetic retained analytical work",status:"backlog"}}) as {task:{id:string}};
  await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId:saved.task.id})).resolves.toBeUndefined();
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
  await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId:saved.task.id})).rejects.toMatchObject({status:403,details:{code:"analytical_source_access_lost"}});
 });
 it("reauthorizes actual WebSocket output at delivery without broadcasting private source identities on source loss",async()=>{
  const f=await fixture();await f.capture();
  const sessionId=randomUUID(),now=new Date();
  await db.insert(authSessions).values({id:sessionId,userId,token:randomUUID(),createdAt:now,updatedAt:now,expiresAt:new Date(now.getTime()+60000)});
  const http=createServer(),wss=setupLiveEventsWebSocketServer(http,db,{deploymentMode:"authenticated",resolveSessionFromHeaders:async()=>({session:{id:sessionId,userId},user:{id:userId,email:null,name:null}})});
  http.listen(0,"127.0.0.1");await once(http,"listening");const address=http.address() as {port:number};
  const socket=new WebSocket(`ws://127.0.0.1:${address.port}/api/companies/${companyId}/events/ws`);
  const read=()=>new Promise<LiveEvent>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Native live event delivery timed out")),5000);socket.once("message",data=>{clearTimeout(timer);resolve(JSON.parse(data.toString()));});});
  try{
   await once(socket,"open");
   const event={companyId,type:"heartbeat.run.log" as const,payload:{runId,issueId,chunk:"Synthetic original analytical live fact"}};
   const before=read();publishLiveEvent(event);expect((await before).payload.chunk).toContain("analytical live fact");
   await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
   const denied=read();publishLiveEvent(event);
   publishLiveEvent({companyId,type:"agent.status",payload:{marker:"authorized barrier"}});
   const next=await denied;
   expect(next).toMatchObject({type:"agent.status",payload:{marker:"authorized barrier"}});
   expect(JSON.stringify(next)).not.toContain(runId);expect(JSON.stringify(next)).not.toContain(issueId);
   await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,f.sourceId));
   const restored=read();publishLiveEvent(event);expect((await restored).payload.chunk).toContain("analytical live fact");
  }finally{const closed=once(socket,"close");socket.terminate();await closed;await new Promise<void>(resolve=>wss.close(resolve));await new Promise<void>((resolve,reject)=>http.close(error=>error?reject(error):resolve()));}
 });
 it("checks all earlier conversation roots for a later native output and refuses a static agent key without native reader authority",async()=>{
  const f=await fixture();await f.capture();
  const reader={type:"board" as const,source:"session" as const,userId};
  const laterRun=randomUUID();await db.insert(heartbeatRuns).values({id:laterRun,companyId,agentId,nativeIssueId:issueId,runtimeMode:"native",status:"running",responsibleUserId:userId});
  const event:LiveEvent={id:1,companyId,type:"heartbeat.run.progress",createdAt:new Date().toISOString(),payload:{runId:laterRun,lastAssistantSnippet:"Synthetic borrowed analytical fact"}};
  expect(await analyticalLiveEventForReader(db,event,reader)).toEqual(event);
  expect(await analyticalLiveEventForReader(db,event,{type:"agent",source:"agent_key",companyId,agentId,keyId:randomUUID(),onBehalfOfUserId:userId})).toBeNull();
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
  expect(await analyticalLiveEventForReader(db,event,reader)).toBeNull();
 });
 it("closes an already connected native browser after its current company membership is revoked",async()=>{
  const f=await fixture();await f.capture();
  const sessionId=randomUUID(),now=new Date();
  await db.insert(authSessions).values({id:sessionId,userId,token:randomUUID(),createdAt:now,updatedAt:now,expiresAt:new Date(now.getTime()+60000)});
  const http=createServer(),wss=setupLiveEventsWebSocketServer(http,db,{deploymentMode:"authenticated",resolveSessionFromHeaders:async()=>({user:{id:userId},session:{id:sessionId,userId}})});
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
 it("keeps later native turns source-dependent without creating another retention root and scrubs late inserts through their actual new binding",async()=>{
  const f=await fixture(),source=await f.capture(),later=randomUUID(),independentIssue=randomUUID(),independentRun=randomUUID();
  await db.update(heartbeatRuns).set({status:"succeeded"}).where(eq(heartbeatRuns.id,runId));
  await db.insert(heartbeatRuns).values({id:later,companyId,agentId,nativeIssueId:issueId,runtimeMode:"native",status:"running",responsibleUserId:userId,contextSnapshot:{body:"Synthetic previous-turn analytical fact"},resultJson:{body:"Synthetic copied analytical result"}});
  await db.update(issues).set({executionRunId:later}).where(eq(issues.id,issueId));
  await db.insert(issues).values({id:independentIssue,companyId,title:"Independent ordinary native task"});
  await db.insert(heartbeatRuns).values({id:independentRun,companyId,agentId,nativeIssueId:independentIssue,runtimeMode:"native",status:"running",responsibleUserId:userId,resultJson:{body:"Independent ordinary native result"}});
  await expect(assertNativeAnalyticalRunPayloadAccess(db,companyId,later)).resolves.toBeUndefined();
  expect(await db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId,companyId))).toHaveLength(1);
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
  await expect(assertNativeAnalyticalRunPayloadAccess(db,companyId,later)).rejects.toMatchObject({status:403,details:{code:"analytical_source_access_lost"}});
  await expect(assertAnalyticalContextPayloadAccess(db,companyId,board,{runId:later})).rejects.toMatchObject({status:403});
  await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,f.sourceId));
  await expect(assertNativeAnalyticalRunPayloadAccess(db,companyId,later)).resolves.toBeUndefined();
  await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,source.lineageManifestId));
  expect(await heartbeatMemoryPayloadRetained(db,companyId,later)).toBe(false);expect(await heartbeatMemoryPayloadRetained(db,companyId,independentRun)).toBe(true);
  await reapplyMemoryDeletionMarkers(db,companyId);
  const [scrubbed]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,later));expect(scrubbed).toMatchObject({contextSnapshot:{},resultJson:null});
  const inserted=randomUUID();await db.insert(heartbeatRuns).values({id:inserted,companyId,agentId,nativeIssueId:issueId,runtimeMode:"native",status:"queued",responsibleUserId:userId,contextSnapshot:{body:"Late original-source copy"},resultJson:{body:"Late original-source copy"}});
  const [late]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,inserted));expect(late).toMatchObject({contextSnapshot:{},resultJson:null});
  expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,independentRun)))[0]!.resultJson).toEqual({body:"Independent ordinary native result"});
 });
 it("rejects provider and internal-draft bytes before persistence and original-event callbacks when source access is lost",async()=>{
  const f=await fixture();await f.capture();
  const sessionId=randomUUID(),sourceInstanceId=randomUUID(),controlPlaneSourceInstanceId=randomUUID(),internalDraftSourceInstanceId=randomUUID();
  let callbacks=0;
  const port=new PaperclipControlPlanePort(db,{companyId,agentId,issueId,runId,sessionId,sourceInstanceId,controlPlaneSourceInstanceId,internalDraftSourceInstanceId,completionContractId:randomUUID(),completionContractSha256:"unused-append-only-binding"},{onCommittedEvent:async()=>{callbacks++;},onDuplicateEvent:async()=>{callbacks++;}});
  const event:PrpEvent={schema:"paperclip.prp.event.v1",schemaVersion:1,sourceEventId:randomUUID(),sourceSeq:1,sourceInstanceId,sourceKind:"runner",runId,normalizedSessionId:sessionId,turnId:randomUUID(),eventType:"item.delta",priority:1,emittedAt:new Date().toISOString(),payload:{kind:"agentMessage",text:"Synthetic retained analytical fact"}};
  await port.appendEvent(event);expect(callbacks).toBe(1);
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
  await expect(port.appendEvent({...event,sourceEventId:randomUUID(),sourceSeq:2})).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
  await expect(port.appendEvent({...event,sourceEventId:randomUUID(),sourceSeq:1,sourceInstanceId:internalDraftSourceInstanceId,sourceKind:"control_plane"})).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
  expect(callbacks).toBe(1);expect(await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId,runId))).toHaveLength(1);
  // The server-owned lifecycle stream still persists mechanics needed to stop.
  await port.appendEvent({...event,eventType:"turn.cancelled",sourceEventId:randomUUID(),sourceSeq:1,sourceInstanceId:controlPlaneSourceInstanceId,sourceKind:"control_plane",payload:{reason:"Source access lost"}});
  expect(callbacks).toBe(2);
 });
 it("refuses the actual native session entry before provider startup using current PostgreSQL source authority",async()=>{
  const [run]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,runId)),[issue]=await db.select().from(issues).where(eq(issues.id,issueId));
  const prepared=await prepareNativeHeartbeatRun({db,run:run!,issue:issue!,environmentLeaseId:randomUUID()});
  const [contract]=await db.select().from(completionContracts).where(eq(completionContracts.issueId,issueId));
  const f=await fixture();await f.capture();
  const execution:NativeExecutionInputV1={schema:"paperclip.native-execution-input.v1",binding:{companyId,issueId,runId,agentId,executionWorkspaceId:runId},provider:{kind:"codex",model:"gpt-5.6-luna"},task:{identifier:issueId,title:issue!.title,description:null,prompt:"Synthetic analytical context",workMode:"standard"},workspace:{cwd:"/tmp",repoUrl:null,repoRef:null,branchName:null},session:{normalizedSessionId:prepared.normalizedSessionId,driverKind:"codex_app_server",protocolVersion:1,lifecyclePolicy:{mode:"per_turn",idleTimeoutMs:null}},completionContract:{id:contract!.id,sha256:contract!.canonicalSha256,schemaVersion:"paperclip.completion-contract.v1",contract:nativeCompletionContractInput(contract!.contractJson)},interactionResponses:[],credentialBindings:[]};
  await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));
  await expect(executePaperclipNativeSession({db,execution,runnerInstanceId:prepared.runnerInstanceId})).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
  expect(await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId,runId))).toHaveLength(0);
 });
 it("requires an actual current reader and explicit source rollout without erasing original canonical facts",async()=>{const f=await fixture();await f.capture();await expect(assertAnalyticalContextPayloadAccess(db,companyId,undefined,{issueId})).rejects.toMatchObject({status:403});await instanceSettingsService(db).updateExperimental({management_chat_tools_v8:false,management_reviews_v8:false,business_metrics_v8:false});await expect(assertAnalyticalContextPayloadAccess(db,companyId,reader,{issueId})).rejects.toMatchObject({status:404});expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).toHaveLength(1);});

 it("rejects another native Task's Context even when it names the same current run and agent",async()=>{const f=await fixture(false),other=randomUUID();await db.insert(issues).values({id:other,companyId,title:"Other admitted native Task"});await expect(contextManifestService(db).create({companyId,agentId,issueId:other,runId,query:"Other task context",policySnapshot:{fixture:true},selected:[]})).rejects.toMatchObject({status:403});expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).toHaveLength(0);});

 it("closes copied prose when the native result owner is deleted and rejects restored-source recapture",async()=>{const f=await fixture(),result=await f.capture(),[original]=await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,result.id));await copied();await db.delete(businessMetricObservations).where(eq(businessMetricObservations.id,result.id));expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);expect(await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,result.lineageManifestId))).toHaveLength(1);await reapplyMemoryDeletionMarkers(db,companyId);await erased();await db.insert(businessMetricObservations).values(original!);const nextIssue=randomUUID(),nextRun=randomUUID(),nextAgent=randomUUID();await db.insert(agents).values({id:nextAgent,companyId,name:"Independent actual native reader",role:"engineer",status:"active",adapterType:"paperclip_runner"});await db.insert(issues).values({id:nextIssue,companyId,title:"New actual native conversation",assigneeAgentId:nextAgent,conversationAgentId:nextAgent,conversationUserId:userId,conversationState:"active",responsibleUserId:userId});await db.insert(heartbeatRuns).values({id:nextRun,companyId,agentId:nextAgent,nativeIssueId:nextIssue,runtimeMode:"native",status:"running",responsibleUserId:userId,contextSnapshot:{issueId:nextIssue}});await db.update(issues).set({executionRunId:nextRun}).where(eq(issues.id,nextIssue));await contextManifestService(db).create({companyId,agentId:nextAgent,issueId:nextIssue,runId:nextRun,query:"Restore attempt in a new run",policySnapshot:{fixture:true},selected:[]});expect(await heartbeatMemoryPayloadRetained(db,companyId,nextRun)).toBe(true);await expect(withAnalyticalConversationRetention(db,companyId,{...actor(),agentId:nextAgent,runId:nextRun},async()=>({result,sourceManifestIds:[result.lineageManifestId],retentionUntil:new Date(result.expiresAt)}))).rejects.toMatchObject({status:409});});

 it("withholds actual HTTP comment history after original source access changes",async()=>{const f=await fixture();await f.capture();await copied();const app=express();app.use(express.json());app.use((req,_res,next)=>{req.actor=reader;next();});app.use("/api",issueRoutes(db));app.use(errorHandler);const before=await request(app).get(`/api/issues/${issueId}/comments`);expect(before.status).toBe(200);expect(JSON.stringify(before.body)).toContain("Synthetic analytical answer");await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,f.sourceId));const after=await request(app).get(`/api/issues/${issueId}/comments`);expect(after.status).toBe(403);expect(JSON.stringify(after.body)).not.toContain("Synthetic analytical answer");});

 it("recovers an inaccessible source conversation only through its actual owner's explicit native request without deleting canonical source facts",async()=>{
  await instanceSettingsService(db).updateExperimental({enableAgentChat:true});
  const f=await fixture(),original=await f.capture();await copied();
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.actor=reader;next();});app.use("/api",issueRoutes(db));app.use(errorHandler);
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
  const retiredComments=await request(app).get(`/api/issues/${issueId}/comments`);expect(retiredComments.status).toBe(404);expect(JSON.stringify(retiredComments.body)).not.toContain("Synthetic analytical answer");
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
   const worker=memoryJobService(db),traceJobKey=`provider-trace-erasure:v1:${tombstone!.id}`;
   // Other independent fixtures may have queued native privacy sweeps. Follow
   // this original trace job, rather than whichever company row sorts first.
   for(let attempt=0;attempt<8;attempt++){const [job]=await db.select().from(memoryJobs).where(eq(memoryJobs.jobKey,traceJobKey));if(job?.status!=="queued")break;await worker.tick({limit:10});}
   expect((await db.select().from(memoryJobs).where(eq(memoryJobs.jobKey,traceJobKey)))[0]!.status).toBe("failed");
   await fs.rmdir(`${prepared.path}.rehydration`);await fs.writeFile(`${prepared.path}.rehydration`,"Synthetic retry payload");
   await worker.tick({now:new Date(Date.now()+61000)});await expect(fs.readFile(prepared.path)).rejects.toMatchObject({code:"ENOENT"});await expect(fs.readFile(`${prepared.path}.rehydration`)).rejects.toMatchObject({code:"ENOENT"});expect(await fs.readFile(foreignTrace.path,"utf8")).toContain("independent tenant");
   // A restored/late native capture stays tombstoned and requeues original file identities.
   await fs.writeFile(prepared.path,"Synthetic late bytes");await fs.writeFile(`${prepared.path}.rehydration`,"Synthetic late rehydration");await db.update(providerTraceRecords).set({status:"capturing",reason:null,deletedAt:null,frameCount:99}).where(eq(providerTraceRecords.runId,runId));
   expect((await db.select().from(providerTraceRecords).where(eq(providerTraceRecords.runId,runId)))[0]).toMatchObject({status:"deleted",reason:"source_erased",frameCount:0});
   await purgeCompanyContent(db,companyId);expect(await db.select().from(providerTraceRecords).where(eq(providerTraceRecords.companyId,companyId))).toHaveLength(0);
   const retained=await db.select().from(memoryJobs).where(eq(memoryJobs.companyId,companyId));expect(retained.length).toBeGreaterThan(0);expect(retained.every(j=>j.operationType==="retention"&&["provider_trace_erasure","runtime_asset_erasure"].includes(String(j.sourceRefJson.kind))&&j.sourceHeartbeatRunId===null&&j.sourceMemoryRecordId===null)).toBe(true);
   await worker.tick();await expect(fs.readFile(prepared.path)).rejects.toMatchObject({code:"ENOENT"});await expect(fs.readFile(`${prepared.path}.rehydration`)).rejects.toMatchObject({code:"ENOENT"});expect(await fs.readFile(foreignTrace.path,"utf8")).toContain("independent tenant");
  }finally{if(previous===undefined)delete process.env.PROVIDER_TRACE_BASE_PATH;else process.env.PROVIDER_TRACE_BASE_PATH=previous;await fs.rm(temp,{recursive:true,force:true});}
 });

 it("recovers the same person's erased conversation atomically without reviving its history or Task outcome",async()=>{
  await instanceSettingsService(db).updateExperimental({enableAgentChat:true});
  const f=await fixture(),result=await f.capture();await copied();
  await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,result.lineageManifestId));
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.actor=reader;next();});app.use("/api",issueRoutes(db,{} as never,{heartbeat:{...heartbeatService(db),wakeup:async()=>null}}));app.use(errorHandler);
  const path=`/api/companies/${companyId}/chats/${agentId}`;
  const unused=await request(app).get(path);expect(unused.status).toBe(200);expect(unused.body).toBeNull();
  expect((await db.select().from(issues).where(eq(issues.id,issueId)))[0]!.conversationAgentId).toBe(agentId);
  const opened=await Promise.all(Array.from({length:6},()=>request(app).post(path)));
  expect(opened.map(r=>r.status)).toEqual(Array(6).fill(200));expect(new Set(opened.map(r=>r.body.id)).size).toBe(1);
  const freshId=opened[0]!.body.id;expect(freshId).not.toBe(issueId);
  const [retired]=await db.select().from(issues).where(eq(issues.id,issueId));
  expect(retired).toMatchObject({conversationAgentId:null,conversationUserId:null,conversationState:null,status:"cancelled",assigneeAgentId:null,executionRunId:null});expect(retired!.conversationRetiredAt).toBeInstanceOf(Date);
  expect((await request(app).get(`${path}`)).body.id).toBe(freshId);
  const old=await request(app).get(`/api/issues/${issueId}/comments`);expect(old.status).toBe(404);expect(JSON.stringify(old.body)).not.toContain("Synthetic analytical answer");
  await expect(issueService(db).update(issueId,{status:"done"})).rejects.toMatchObject({status:409});
  await expect(db.update(issues).set({conversationRetiredAt:null}).where(eq(issues.id,issueId))).rejects.toMatchObject({cause:{code:"23514"}});
  await expect(toolAuthority().execute({tool:"query_business_metric",callId:randomUUID(),arguments:f.query})).rejects.toThrow();
  // The recovered shell must receive its first actual Human input through
  // the original route before Context can inspect its sealed source owner.
  const freshInput=await request(app).post(`/api/issues/${freshId}/comments`)
   .send({body:"Independent Human input after source erasure",clientRequestId:randomUUID()});
  expect(freshInput.status).toBe(201);
  const freshRun=randomUUID();await db.insert(heartbeatRuns).values({id:freshRun,companyId,agentId,nativeIssueId:freshId,runtimeMode:"native",status:"running",responsibleUserId:userId,contextSnapshot:{issueId:freshId}});await db.update(issues).set({executionRunId:freshRun,conversationState:"active"}).where(eq(issues.id,freshId));
  await contextManifestService(db).create({companyId,agentId,issueId:freshId,runId:freshRun,query:"A fresh source read",policySnapshot:{fixture:true},selected:[]});
  const tools=new PaperclipRunnerToolAuthority(db,{companyId,agentId,issueId:freshId,runId:freshRun,managementToolsEnabled:true});
  expect(await tools.execute({tool:"query_business_metric",callId:randomUUID(),arguments:f.query})).toMatchObject({result:{grade:"native_observation"}});
  expect(await heartbeatMemoryPayloadRetained(db,companyId,freshRun)).toBe(true);expect(await heartbeatMemoryPayloadRetained(db,companyId,runId)).toBe(false);
  expect((await purgeCompanyContent(db,companyId)).companyTombstoneRetained).toBe(true);
 });

});
