import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and,eq,sql } from "drizzle-orm";
import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from "vitest";
import { agents,agentWakeupRequests,companies,completionContracts,createDb,environments,environmentLeases,heartbeatRuns,issues,nativeRunFinalizations,nativeRunResults,statusDecisions,workAssessments,type Db } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { commitNativeStatusDecision } from "../services/native-runtime/status-decision-committer.js";
import { NATIVE_STATUS_ARBITER_POLICY_VERSION } from "../services/native-runtime/status-arbiter.js";
import { heartbeatService } from "../services/heartbeat.js";
import { appendHeartbeatRunEvent } from "../services/heartbeat-run-events.js";
import { hasPendingRunCleanup } from "../services/execution-blocker.js";
import { remoteTerminationReceipt,remoteExecutionHasStopped,NATIVE_REMOTE_WORKLOAD_STOPPED } from "../services/remote-execution-termination.js";
import { publishLiveEvent } from "../services/live-events.js";
const telemetry=vi.hoisted(()=>({track:vi.fn()}));
vi.mock("../telemetry.js",async()=>({...await vi.importActual<typeof import("../telemetry.js")>("../telemetry.js"),getTelemetryClient:()=>telemetry}));
vi.mock("../services/live-events.js",async()=>({...await vi.importActual<typeof import("../services/live-events.js")>("../services/live-events.js"),publishLiveEvent:vi.fn()}));
describe("committed Native Agent terminal reconciliation (actual PostgreSQL)",()=>{
 let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>;let companyCounter=0;
 beforeAll(async()=>{database=await startEmbeddedPostgresTestDatabase("native-agent-terminal-");db=createDb(database.connectionString);
  const forward=readFileSync(new URL("../../../packages/db/src/migrations/0569_native_remote_workload_stop_projection.sql",import.meta.url),"utf8");
  for(const statement of forward.split("--> statement-breakpoint"))if(statement.trim())await db.execute(sql.raw(statement));
 },30000);
 afterAll(async()=>{await database?.cleanup();},30000);
 beforeEach(()=>{vi.mocked(publishLiveEvent).mockClear();telemetry.track.mockClear();});
 async function seed(options:{knownProjectedStop?:boolean}={}){
  const companyId=randomUUID(),agentId=randomUUID(),runId=randomUUID(),issueId=randomUUID(),contractId=randomUUID(),resultId=randomUUID(),assessmentId=randomUUID(),decisionId=randomUUID(),environmentId=randomUUID(),leaseId=randomUUID();
  const responsibleUserId="terminal-owner-"+randomUUID(),finishedAt=new Date(Date.now()-1000),createdAt=new Date(Date.now()-60000);
  await db.insert(companies).values({id:companyId,name:"Terminal ownership",issuePrefix:`NAT${++companyCounter}`});
  await db.insert(agents).values({id:agentId,companyId,name:"Committed Native",role:"engineer",adapterType:"paperclip_runner",status:"running"});
  await db.insert(issues).values({id:issueId,companyId,title:"Committed work",status:"done",statusVersion:1,assigneeAgentId:agentId});
  await db.insert(completionContracts).values({id:contractId,companyId,issueId,revision:1,schemaVersion:"paperclip.completion-contract.v1",policyVersion:"fixture-v1",risk:"standard",completionAuthority:"server_arbiter",incompleteCriteriaPolicy:"preserve_non_terminal",contractJson:{revision:"1",objective:"Complete",criteria:[{id:"objective",requirement:"Complete"}]},canonicalSha256:"a".repeat(64),createdByActorType:"system",createdByActorId:"test"});
  await db.insert(heartbeatRuns).values({id:runId,companyId,agentId,issueId,scopeKind:"issue",nativeIssueId:issueId,responsibleUserId,runtimeMode:"native",status:"succeeded",driverKind:"opencode_server",nativePhase:"committed",nativeSessionId:randomUUID(),runnerInstanceId:randomUUID(),completionContractId:contractId,completionContractSha256:"a".repeat(64),startedAt:createdAt,createdAt,finishedAt,contextSnapshot:{issueId},resultJson:{finalizationPhase:"committed",assessmentId,decisionId}});
  await db.insert(nativeRunResults).values({id:resultId,companyId,issueId,runId,completionContractId:contractId,serverFingerprint:resultId,schemaStatus:"accepted",resultJson:{schema:"paperclip.run_result.v1",reportedWorkDisposition:"done"},canonicalSha256:"b".repeat(64)});
  await db.insert(workAssessments).values({id:assessmentId,companyId,issueId,runId,contractId,resultId,triggerKind:"native_result",triggerActorCompanyId:companyId,priorIssueStatus:"in_progress",priorStatusVersion:0,policyVersion:"fixture-v1",assessmentJson:{},inputDigest:"c".repeat(64)});
  await db.insert(statusDecisions).values({id:decisionId,companyId,issueId,runId,assessmentId,decisionVersion:1,policyVersion:"fixture-v1",fromStatus:"in_progress",toStatus:"done",reasonCode:"objective_satisfied",decisionJson:{statusAction:"done",priorStatusVersion:0,projectedStatusVersion:1},decisionDigest:"d".repeat(64),applicationState:"applied",appliedAt:finishedAt});
  await db.insert(nativeRunFinalizations).values({runId,companyId,issueId,phase:"committed",resultId,assessmentId,decisionId});
  await db.update(issues).set({lastStatusDecisionId:decisionId}).where(eq(issues.id,issueId));
  await db.insert(environments).values({id:environmentId,name:"Stopped remote "+runId,driver:"fixture_remote"});
  const lease={id:leaseId,companyId,heartbeatRunId:runId,provider:"fixture_remote",providerLeaseId:"remote-"+runId};
  await db.insert(environmentLeases).values({...lease,environmentId,issueId,status:"released",cleanupStatus:"success",releasedAt:finishedAt,metadata:{remoteExecutionTermination:remoteTerminationReceipt(lease,{providerLeaseId:lease.providerLeaseId,state:"stopped"})}});
  // Isolated consumer precondition ONLY: a trusted server has already
  // projected Stop. Actual managed Worker/9 must use the signed proof writer.
  if(options.knownProjectedStop !== false)await appendHeartbeatRunEvent(db,{companyId,agentId,runId,eventType:NATIVE_REMOTE_WORKLOAD_STOPPED,stream:"system",payload:{fixture:"trusted projected-stop consumer precondition; not physical proof"}});
  return {companyId,agentId,runId,issueId,responsibleUserId,contractId,resultId,assessmentId,decisionId,leaseId};
 }
 type Fixture=Awaited<ReturnType<typeof seed>>;
 async function seedPreserve(priorPointer: "existing" | "null" = "existing") {
  const f=await seed();
  const priorDecisionId=priorPointer === "existing" ? f.decisionId : null;
  if(priorPointer === "null")await db.update(issues).set({lastStatusDecisionId:null}).where(eq(issues.id,f.issueId));
  const [priorAssessment]=await db.select().from(workAssessments).where(eq(workAssessments.id,f.assessmentId));
  const assessmentId=randomUUID();
  await db.insert(workAssessments).values({...priorAssessment!,id:assessmentId,inputDigest:randomUUID(),
    supersedesAssessmentId:f.assessmentId,priorIssueStatus:"done",priorStatusVersion:1,priorDecisionId,
    policyVersion:NATIVE_STATUS_ARBITER_POLICY_VERSION});
  await db.update(nativeRunFinalizations).set({phase:"arbitrating",decisionId:null,assessmentId}).where(eq(nativeRunFinalizations.runId,f.runId));
  const committed=await commitNativeStatusDecision({db,companyId:f.companyId,issueId:f.issueId,runId:f.runId,
    assessmentId,priorStatus:"done",priorStatusVersion:1,priorDecisionId,
    decision:{policyVersion:NATIVE_STATUS_ARBITER_POLICY_VERSION,statusAction:"preserve",toStatus:"done",
      reasonCode:"objective_satisfied",unblockDescriptor:null,effects:[]}});
  expect(committed.decision.decisionVersion).toBeGreaterThan(committed.issue.statusVersion);
  expect(committed.issue.lastStatusDecisionId).toBe(priorDecisionId);
  expect(committed.decision.decisionJson).toMatchObject({statusAction:"preserve",priorStatusVersion:1,projectedStatusVersion:1});
  await db.update(heartbeatRuns).set({resultJson:{finalizationPhase:"committed",assessmentId,
    decisionId:committed.decision.id}}).where(eq(heartbeatRuns.id,f.runId));
  return {...f,assessmentId,decisionId:committed.decision.id};
 }
 const reconcile=(f:Fixture,owner:Db=db)=>heartbeatService(owner).reconcileCommittedNativeAgentRun(f);
 const status=async(f:Fixture)=>(await db.select().from(agents).where(eq(agents.id,f.agentId)))[0]!.status;
 it("returns only the exact settled committed owner to idle through existing finalization",async()=>{
  const f=await seed();expect(await reconcile(f)).toBe(true);expect(await status(f)).toBe("idle");
  expect(vi.mocked(publishLiveEvent).mock.calls.filter(([event])=>event.type==="agent.status")).toHaveLength(1);
  const [run]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,f.runId));expect(run.status).toBe("succeeded");expect(run.processPid).toBeNull();
  expect(await reconcile(f)).toBe(false);expect(telemetry.track).toHaveBeenCalledTimes(1);
 });
 it.each(["existing","null"] as const)("accepts the actual committer preserve projection with %s prior pointer",async pointer=>{
  const f=await seedPreserve(pointer);expect(await reconcile(f)).toBe(true);expect(await status(f)).toBe("idle");
 });
 it.each(["prior_pointer","projected_version","prior_version","from_status","prior_status"])("rejects a stale preserve projection: %s",async kind=>{
  const f=await seedPreserve();
  if(kind==="prior_pointer")await db.update(issues).set({lastStatusDecisionId:f.decisionId}).where(eq(issues.id,f.issueId));
  if(kind==="projected_version")await db.update(issues).set({statusVersion:2}).where(eq(issues.id,f.issueId));
  if(kind==="prior_version")await db.update(workAssessments).set({priorStatusVersion:0}).where(eq(workAssessments.id,f.assessmentId));
  if(kind==="from_status")await db.update(statusDecisions).set({fromStatus:"in_progress"}).where(eq(statusDecisions.id,f.decisionId));
  if(kind==="prior_status")await db.update(workAssessments).set({priorIssueStatus:"in_progress"}).where(eq(workAssessments.id,f.assessmentId));
  expect(await reconcile(f)).toBe(false);expect(await status(f)).toBe("running");
 });
 it.each(["paused","error","disabled","terminated","revoked","unknown","idle"])("preserves current Agent status %s",async current=>{
  const f=await seed();await db.update(agents).set({status:current}).where(eq(agents.id,f.agentId));expect(await reconcile(f)).toBe(false);expect(await status(f)).toBe(current);expect(publishLiveEvent).not.toHaveBeenCalled();
 });
 it.each(["nonterminal","unfinished","wrong_phase","coordinator_lease","coordinator_wrong","result_rejected","decision_unapplied","new_decision_version","missing_projected_version","invalid_projected_version","stale_projected_version","run_contract_digest","contract_row_digest","assessment_contract","wrong_human","wrong_agent_owner","pending_workspace","active_lease","released_without_receipt","receipt_wrong_scope","unknown_remote","no_lease","local_without_stop","successor_queued","successor_retry","successor_terminal","active_claim","queued_claim","deferred_claim"])("holds an unqualified terminal projection: %s",async kind=>{
  const f=await seed();
  if(kind==="nonterminal")await db.update(heartbeatRuns).set({status:"running"}).where(eq(heartbeatRuns.id,f.runId));
  if(kind==="unfinished")await db.update(heartbeatRuns).set({finishedAt:null}).where(eq(heartbeatRuns.id,f.runId));
  if(kind==="wrong_phase")await db.update(heartbeatRuns).set({nativePhase:"provider_running"}).where(eq(heartbeatRuns.id,f.runId));
  if(kind==="coordinator_lease")await db.update(nativeRunFinalizations).set({leaseOwner:"still-owned"}).where(eq(nativeRunFinalizations.runId,f.runId));
  if(kind==="coordinator_wrong")await db.update(nativeRunFinalizations).set({phase:"arbitrating"}).where(eq(nativeRunFinalizations.runId,f.runId));
  if(kind==="result_rejected")await db.update(nativeRunResults).set({schemaStatus:"rejected"}).where(eq(nativeRunResults.id,f.resultId));
  if(kind==="decision_unapplied")await db.update(statusDecisions).set({applicationState:"proposed",appliedAt:null}).where(eq(statusDecisions.id,f.decisionId));
  if(kind==="new_decision_version")await db.update(issues).set({statusVersion:2}).where(eq(issues.id,f.issueId));
  if(kind==="missing_projected_version")await db.update(statusDecisions).set({decisionJson:{}}).where(eq(statusDecisions.id,f.decisionId));
  if(kind==="invalid_projected_version")await db.update(statusDecisions).set({decisionJson:{projectedStatusVersion:"1"}}).where(eq(statusDecisions.id,f.decisionId));
  if(kind==="stale_projected_version")await db.update(statusDecisions).set({decisionJson:{projectedStatusVersion:0}}).where(eq(statusDecisions.id,f.decisionId));
  if(kind==="run_contract_digest")await db.update(heartbeatRuns).set({completionContractSha256:"e".repeat(64)}).where(eq(heartbeatRuns.id,f.runId));
  if(kind==="contract_row_digest")await db.update(completionContracts).set({canonicalSha256:"f".repeat(64)}).where(eq(completionContracts.id,f.contractId));
  if(kind==="assessment_contract"){
    const [original]=await db.select().from(completionContracts).where(eq(completionContracts.id,f.contractId));const changed=randomUUID();
    await db.insert(completionContracts).values({...original!,id:changed,revision:2,canonicalSha256:"e".repeat(64),contractJson:{...original!.contractJson,revision:"2"}});
    await db.update(workAssessments).set({contractId:changed}).where(eq(workAssessments.id,f.assessmentId));
  }
  if(kind==="wrong_human")f.responsibleUserId="different-user";
  if(kind==="wrong_agent_owner")await db.update(issues).set({assigneeAgentId:null}).where(eq(issues.id,f.issueId));
  if(kind==="pending_workspace")await db.update(heartbeatRuns).set({runnerProfileJson:{nativeWorkspaceFinalizationOwner:{owner:"pending"}}}).where(eq(heartbeatRuns.id,f.runId));
  if(kind==="active_lease")await db.update(environmentLeases).set({status:"active",releasedAt:null}).where(eq(environmentLeases.id,f.leaseId));
  if(kind==="released_without_receipt")await db.update(environmentLeases).set({metadata:{}}).where(eq(environmentLeases.id,f.leaseId));
  if(kind==="receipt_wrong_scope")await db.update(environmentLeases).set({metadata:{remoteExecutionTermination:{schema:"paperclip.remote-termination.v1",companyId:f.companyId,runId:randomUUID(),leaseId:f.leaseId,provider:"fixture_remote",providerLeaseId:"remote-"+f.runId,state:"stopped"}}}).where(eq(environmentLeases.id,f.leaseId));
  if(kind==="unknown_remote")await db.update(environmentLeases).set({provider:null}).where(eq(environmentLeases.id,f.leaseId));
  if(kind==="no_lease")await db.delete(environmentLeases).where(eq(environmentLeases.id,f.leaseId));
  if(kind==="local_without_stop")await db.update(environmentLeases).set({provider:"local",providerLeaseId:null,metadata:{}}).where(eq(environmentLeases.id,f.leaseId));
  if(kind==="successor_queued" || kind==="successor_retry" || kind==="successor_terminal")await db.insert(heartbeatRuns).values({companyId:f.companyId,agentId:f.agentId,status:kind==="successor_queued"?"queued":kind==="successor_retry"?"retry_wait":"succeeded",finishedAt:kind==="successor_terminal"?new Date():null});
  if(["active_claim","queued_claim","deferred_claim"].includes(kind))await db.insert(agentWakeupRequests).values({companyId:f.companyId,agentId:f.agentId,source:"automation",status:kind==="active_claim"?"claimed":kind==="queued_claim"?"queued":"deferred_issue_execution",runId:kind==="active_claim"?f.runId:null});
  expect(await reconcile(f)).toBe(false);expect(await status(f)).toBe("running");expect(publishLiveEvent).not.toHaveBeenCalled();
 });
 it.each(["unknown_null","new_original_intent"])("holds an unconfirmed process projection despite an old generic receipt: %s",async kind=>{
  const f=await seed({knownProjectedStop:kind !== "unknown_null"});
  if(kind==="new_original_intent")await appendHeartbeatRunEvent(db,{companyId:f.companyId,agentId:f.agentId,runId:f.runId,eventType:"native.process_start_requested",stream:"system"});
  const [run]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,f.runId));
  expect(run.nativeProcessCleanupPending).toBe(kind==="unknown_null"?null:true);
  expect(await hasPendingRunCleanup(db,f.companyId,f.runId)).toBe(false);
  expect(await remoteExecutionHasStopped(db,f.companyId,f.runId)).toBe(true);
  expect(await reconcile(f)).toBe(false);expect(await status(f)).toBe("running");expect(publishLiveEvent).not.toHaveBeenCalled();
 });
 it("does not publish idle or telemetry if the owner transaction rolls back",async()=>{
  const f=await seed();const rollback=new Error("forced-rollback-after-finalizer");
  const owner=new Proxy(db,{get(target,key){if(key==="transaction")return async(callback:(tx:unknown)=>Promise<unknown>)=>target.transaction(async tx=>{await callback(tx);throw rollback;});const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}}) as Db;
  await expect(reconcile(f,owner)).rejects.toThrow("forced-rollback-after-finalizer");expect(await status(f)).toBe("running");expect(publishLiveEvent).not.toHaveBeenCalled();expect(telemetry.track).not.toHaveBeenCalled();
 });
 it("serializes concurrent reconciles with the existing locks and publishes once",async()=>{
  const f=await seed();expect((await Promise.all([reconcile(f),reconcile(f)])).sort()).toEqual([false,true]);expect(await status(f)).toBe("idle");
  expect(vi.mocked(publishLiveEvent).mock.calls.filter(([event])=>event.type==="agent.status")).toHaveLength(1);
 });
});
