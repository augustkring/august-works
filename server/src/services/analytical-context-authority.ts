import {and,eq,inArray,or,sql} from "drizzle-orm";
import { is } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import {analyticalContextDependencies,analyticalContextRoots,contextManifestMemoryRoots,contextManifestItems,contextManifests,memoryRecords,agentExecutionManifests,decisionContextVersions,decisionOutcomeReviewReceipts,processAnalysisVersions,issues,heartbeatRuns,workflowStepRuns,workflowRuns,companyMemberships,authUsers,agents,type Db} from "@paperclipai/db";
import {analyticalContextAuthorityPinSchema,type AnalyticalContextAuthorityPin} from "@paperclipai/shared";
import {z} from "zod";
import {authorizationService,canActorReadHeartbeatRunPrivacy,canActorReadIssuePrivacy,issueReadSqlCondition,type AuthorizationActor} from "./authorization.js";
import type {NativeReadScope} from "./analytical-reader.js";
import {HttpError,conflict,forbidden,unprocessable} from "../errors.js";

/** Analytical retention is a private copy owner, never an ordinary Memory
 * candidate or a verified model output. Its exact owner still has to exist. */
export async function assertAnalyticalRetentionRootOwnerCurrent(db:Db,companyId:string,actor:AuthorizationActor,rootId:string){
 const {memoryPayloadVisible}=await import("./memory/memory-privacy.js");
 const [owner]=await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId,companyId),
  eq(memoryRecords.id,rootId),memoryPayloadVisible())).for("share");
 const reader=actor.type==="board"?actor.userId:actor.onBehalfOfUserId;
 if(!owner||!reader||owner.privateOwnerUserId!==reader||owner.scopeType!=="agent"||
  !owner.ownerAgentId||owner.scopeId!==owner.ownerAgentId||actor.type==="agent"&&owner.ownerAgentId!==actor.agentId||
  owner.createdByActorType!=="system"||owner.createdByActorId!=="native_analytical_retention"||
  owner.content!=="Private analytical retention root; not a verified Task outcome"||
  owner.providerKey!=="local"||owner.memoryType!=="observation"||owner.sensitivityLabel!=="restricted"||
  owner.reviewState!=="rejected"||owner.verificationState!=="unverified"||!owner.sourceProvenanceQualified||
  owner.payloadSourceSnapshotInvalidated||owner.revokedAt||owner.supersededByRecordId||owner.retentionState==="expired"||
  owner.validUntil&&owner.validUntil.getTime()<=Date.now()||
  !owner.expiresAt||owner.expiresAt.getTime()<=Date.now())
  throw forbidden("The private analytical retention owner is unavailable");
 return owner;
}

const pinsSchema=z.array(analyticalContextAuthorityPinSchema).min(1).max(32);
type AnalyticalPayloadScope={issueId:string}|{runId:string};
type AnalyticalPayloadWorklist={
 directSources:Map<string,AnalyticalPayloadScope>;
 sharedSources:Map<string,AnalyticalPayloadScope>;
 finalChecks:Array<()=>Promise<void>>;
 workflowRunIds:Set<string>;
};
/** Exact native source owners reauthorize retained identities. No copied fact,
 * historical requester or feature flag supplies a current reader privilege. */
export async function inspectAnalyticalContextPins(tx:Db,companyId:string,actor:AuthorizationActor,raw:AnalyticalContextAuthorityPin[],deadline=performance.now()+30000,historicalQualification=true,learningCycleScope?:{cycleId:string;purpose:string}) {
 let sourceSensitivity:"internal"|"confidential"="internal";
 const retainSensitivity=(value:string)=>{if(value==="confidential")sourceSensitivity="confidential";};
 const pins=pinsSchema.parse(raw),manifestIds=new Set<string>();let expiresAt=Infinity;
 for(const pin of pins){
  let pinStage="budget";
  try {
  if(performance.now()>deadline)throw unprocessable("The complete analytical source review exceeded its time budget");
  if(pin.kind==="analytical_evidence"){
   pinStage="analytical_evidence_capture";
   const {captureAnalyticalEvidence}=await import("./analytical-evidence.js");
   const captured=await captureAnalyticalEvidence(tx,companyId,actor,{sensitivity:"confidential",retentionDays:3650,evidence:[{key:"retained_source",source:pin.source}]},deadline,historicalQualification);
   retainSensitivity(captured.sourceSensitivity);captured.manifestIds.forEach(id=>manifestIds.add(id));expiresAt=Math.min(expiresAt,captured.expiresAt.getTime());
  }else if(pin.kind==="process_run"){
   pinStage="process_run_revalidation";
   const {processAnalysisService}=await import("./process-analysis.js");
   const run=await processAnalysisService(tx).getRun(companyId,actor,pin.definitionId,pin.runId);const [version]=await tx.select().from(processAnalysisVersions).where(and(eq(processAnalysisVersions.companyId,companyId),eq(processAnalysisVersions.id,run.versionId))).for("share");if(!version)throw conflict("Native Process source definition is unavailable");retainSensitivity(version.definition.sensitivity);manifestIds.add(run.lineageManifestId);expiresAt=Math.min(expiresAt,Date.parse(run.expiresAt));
  }else if(pin.kind==="decision_context"){
   pinStage="decision_context_revalidation";
   const {decisionIntelligenceService}=await import("./decision-intelligence.js");
   const view=await decisionIntelligenceService(tx).detail(companyId,actor,pin.decisionId),version=view.versions.find(v=>v.id===pin.versionId);
   if(!version)throw conflict("The retained native Decision context is unavailable");
   const [stored]=await tx.select().from(decisionContextVersions).where(and(eq(decisionContextVersions.companyId,companyId),eq(decisionContextVersions.decisionId,pin.decisionId),eq(decisionContextVersions.id,pin.versionId))).for("share");
   if(!stored||stored.contentHash!==version.contentHash)throw conflict("The native Decision context changed");
   retainSensitivity(stored.definition.sensitivity);manifestIds.add(stored.lineageManifestId);expiresAt=Math.min(expiresAt,stored.expiresAt.getTime());
  }else if(pin.kind==="outcome_review"){
   pinStage="outcome_review_revalidation";
   const {consumeLearningOutcomeReviewBundle,decisionOutcomeReviewService}=await import("./decision-outcome-reviews.js");
   const owned=learningCycleScope?await consumeLearningOutcomeReviewBundle(tx,companyId,actor,pin.decisionId,pin.revision,learningCycleScope.cycleId,learningCycleScope.purpose):null;
   if(owned){
    retainSensitivity(owned.sourceSensitivity);owned.manifestIds.forEach(id=>manifestIds.add(id));expiresAt=Math.min(expiresAt,owned.expiresAt.getTime());
   }else{
    const view=await decisionOutcomeReviewService(tx).detail(companyId,actor,pin.decisionId);
    if(!view||view.revision!==pin.revision)throw conflict("The retained native outcome review changed");
    const [version]=await tx.select().from(decisionContextVersions).where(and(eq(decisionContextVersions.companyId,companyId),eq(decisionContextVersions.id,view.contextVersionId))).for("share");if(!version)throw conflict("Native outcome-review source definition is unavailable");retainSensitivity(version.definition.sensitivity);
    const receipts=await tx.select().from(decisionOutcomeReviewReceipts).where(and(eq(decisionOutcomeReviewReceipts.companyId,companyId),eq(decisionOutcomeReviewReceipts.reviewId,view.id))).limit(4);
    if(receipts.length!==view.receipts.length)throw conflict("Native outcome review provenance is unavailable");
    for(const receipt of receipts){manifestIds.add(receipt.lineageManifestId);expiresAt=Math.min(expiresAt,Date.parse(receipt.payload.expiresAt));}
   }
  }else if(pin.kind==="planning_outcome"){
   pinStage="planning_outcome_revalidation";
   const {inspectPlanningOutcome}=await import("./adaptive-planning/outcome.js"),source=await inspectPlanningOutcome(tx,companyId,actor,pin.projectId,pin.proposalId,pin.manifestId);retainSensitivity(source.sourceSensitivity);source.manifestIds.forEach(id=>manifestIds.add(id));expiresAt=Math.min(expiresAt,source.expiresAt.getTime());
  }else if(pin.kind==="metric_definition"){
   pinStage="metric_definition_revalidation";
   const {inspectMetricDefinitionDisclosure}=await import("./business-metrics/definition-disclosure.js"),source=await inspectMetricDefinitionDisclosure(tx,companyId,actor,pin);retainSensitivity(source.sourceSensitivity);manifestIds.add(source.manifestId);expiresAt=Math.min(expiresAt,source.expiresAt.getTime());
  }else{
   pinStage="forecast_definition_revalidation";
   const {inspectPublishedForecastDefinition}=await import("./business-forecasting/service.js"),source=await inspectPublishedForecastDefinition(tx,companyId,actor,pin.specId,pin.versionId);retainSensitivity(source.value.definition.sensitivity);source.manifestIds.forEach(id=>manifestIds.add(id));expiresAt=Math.min(expiresAt,source.expiresAt.getTime());
  }
  }catch(error){
   if(process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS==="1"){
    const candidate=error&&typeof error==="object"?error as {status?:unknown;details?:unknown}:null;
    const details=candidate?.details&&typeof candidate.details==="object"?candidate.details as Record<string,unknown>:null;
    const code=typeof details?.code==="string"&&/^[a-z][a-z0-9_]{0,63}$/.test(details.code)?details.code:null;
    console.info("native-analytical-pin-revalidation-diagnostic",JSON.stringify({stage:pinStage,pinKind:pin.kind,
     status:typeof candidate?.status==="number"?candidate.status:null,code}));
   }
   throw error;
  }
 }
 if(performance.now()>deadline)throw unprocessable("The complete analytical source review exceeded its time budget");
 if(manifestIds.size>26200||!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw conflict("Native analytical source retention is unavailable");
 const {assertMemorySourcesRetained}=await import("./memory/memory-privacy.js");
 await assertMemorySourcesRetained(tx,companyId,[...manifestIds].map(id=>({sourceProvider:"august_works_analytical",sourceRef:`manifest://${id}`})));
 return {sourceSensitivity:sourceSensitivity as "internal"|"confidential",pins,manifestIds:[...manifestIds].sort(),expiresAt:new Date(expiresAt)};
}

/** Copied prose is admitted as one complete source-dependent payload. Owners
 * remain authoritative after an original run has finished or roles change. */
/** Follow only persisted native child relationships. A copied Task/run ID or
 * initiating principal is never an analytical reader grant. */
export async function assertLearnedWorkflowPayloadAccess(db:Db,companyId:string,actor:AuthorizationActor|undefined,scope:{issueId:string}|{runId:string}|{workflowRunId:string},readScope?:NativeReadScope):Promise<void> {
 if(!is(db,PgTransaction))return db.transaction(tx=>assertLearnedWorkflowPayloadAccess(tx as unknown as Db,companyId,actor,scope,readScope));
 const deadline=performance.now()+30000;
 const budget=()=>{if(performance.now()>deadline)throw new HttpError(403,"Complete analytical Workflow source review exceeded its budget",{code:"analytical_source_access_lost"});};
 const match="workflowRunId" in scope?eq(workflowStepRuns.workflowRunId,scope.workflowRunId):"issueId" in scope?sql`exists(select 1 from workflow_waits w where w.company_id=${companyId}::uuid and w.workflow_run_id=${workflowStepRuns.workflowRunId} and w.node_id=${workflowStepRuns.nodeId} and w.reference_type='issue' and w.reference_id=${scope.issueId}) or exists(select 1 from issues i where i.company_id=${companyId}::uuid and i.id=${scope.issueId}::uuid and i.origin_kind='workflow_task' and i.origin_run_id=${workflowStepRuns.workflowRunId}::text)`:
  sql`(${workflowStepRuns.heartbeatRunId}=${scope.runId}::uuid or exists(select 1 from heartbeat_runs h left join agent_wakeup_requests a on a.company_id=h.company_id and a.id=h.wakeup_request_id where h.company_id=${companyId}::uuid and h.id=${scope.runId}::uuid and (a.idempotency_key='workflow-direct-agent:'||${workflowStepRuns.id}::text or exists(select 1 from issues i where i.company_id=h.company_id and i.id=h.native_issue_id and i.origin_kind='workflow_task' and i.origin_run_id=${workflowStepRuns.workflowRunId}::text) or exists(select 1 from workflow_waits w where w.company_id=h.company_id and w.workflow_run_id=${workflowStepRuns.workflowRunId} and w.node_id=${workflowStepRuns.nodeId} and w.reference_type='issue' and (w.reference_id=a.payload->>'issueId' or (h.runtime_mode='native' and w.reference_id=h.native_issue_id::text))))))`;
 // A later native Task may contain a prior Artifact's output. Its actual
 // Workflow Run is the existing complete copy owner, including sibling steps.
 const sourceRunRows=await db.selectDistinct({id:workflowStepRuns.workflowRunId}).from(workflowStepRuns)
  .where(and(eq(workflowStepRuns.companyId,companyId),match)).limit(257);
 if(sourceRunRows.length>256)throw new HttpError(403,"Analytical Workflow source access is unavailable",{code:"analytical_source_access_lost"});
 const sourceRunIds=[...new Set([...sourceRunRows.map(row=>row.id),...( "workflowRunId" in scope ? [scope.workflowRunId] : [])])].sort();
 if(!sourceRunIds.length)return;
 const sourceActor=actor??{type:"none" as const};
 return authorizationService(db).withReadWorkflowSources(companyId,sourceActor,sourceRunIds,async()=>{
 if("workflowRunId" in scope){const {assertWorkflowRunAuthoringSources}=await import("./workflows/workflow-authoring-sources.js");
  await assertWorkflowRunAuthoringSources(db,companyId,scope.workflowRunId,sourceActor,readScope);}
 const assets=await db.selectDistinct({revisionId:workflowRuns.workflowRevisionId,artifactVersionId:workflowStepRuns.automationArtifactVersionId}).from(workflowStepRuns)
  .innerJoin(workflowRuns,and(eq(workflowRuns.companyId,workflowStepRuns.companyId),eq(workflowRuns.id,workflowStepRuns.workflowRunId)))
  .where(and(eq(workflowStepRuns.companyId,companyId),inArray(workflowStepRuns.workflowRunId,sourceRunIds))).limit(257);
 if(assets.length>256)throw new HttpError(403,"Analytical Workflow source access is unavailable",{code:"analytical_source_access_lost"});
 if(!assets.length)return;
 const {assertLearnedAssetAnalyticalSources}=await import("./learning/learning-analytical-sources.js");
 const {assertWorkflowRunAuthoringSources}=await import("./workflows/workflow-authoring-sources.js");
 for(const sourceId of sourceRunIds){budget();await assertWorkflowRunAuthoringSources(db,companyId,sourceId,sourceActor,readScope);}
 for(const revisionId of new Set(assets.map(asset=>asset.revisionId))){
  budget();const [receipt]=await db.execute<{lost:boolean}>(sql`select not aw_learning_asset_current(${companyId}::uuid,'workflow_revision',${revisionId}::uuid) as lost`);
  if(receipt?.lost)throw new HttpError(403,"Native Workflow Source is unavailable",{code:"analytical_source_access_lost"});
  await assertLearnedAssetAnalyticalSources(db,companyId,"workflow_revision",revisionId,sourceActor,readScope);
 }
 for(const artifactId of new Set(assets.flatMap(asset=>asset.artifactVersionId?[asset.artifactVersionId]:[]))){
  budget();const [receipt]=await db.execute<{erased:boolean}>(sql`select aw_artifact_version_source_erased(${companyId}::uuid,${artifactId}::uuid) or not aw_learning_asset_current(${companyId}::uuid,'automation_artifact_version',${artifactId}::uuid) as erased`);
  if(receipt?.erased)throw new HttpError(403,"Native Workflow Artifact Source is unavailable",{code:"analytical_source_access_lost"});
  await assertLearnedAssetAnalyticalSources(db,companyId,"automation_artifact_version",artifactId,sourceActor,readScope);
 }
 budget();
 });
}

export async function assertAnalyticalContextPayloadAccess(db:Db,companyId:string,actor:AuthorizationActor|undefined,scope:{issueId:string}|{runId:string},readScope?:NativeReadScope):Promise<void> {
 return assertAnalyticalContextPayloadAccessInternal(db,companyId,actor,scope,readScope);
}

/** Verify a complete selected Task population while checking its shared
 * Original ancestors once. Every exact Task still receives its own direct
 * reader, retained-root, and lineage review in this physical transaction. */
export async function assertAnalyticalContextPayloadAccessBatch(db:Db,companyId:string,actor:AuthorizationActor|undefined,
 issueIds:string[],readScope?:NativeReadScope):Promise<void> {
 const ids=[...new Set(issueIds)];
 if(ids.length>256||ids.some(id=>!z.string().uuid().safeParse(id).success))
  throw new HttpError(403,"The complete analytical Task population is unavailable",{code:"analytical_source_access_lost"});
 if(!ids.length)return;
 if(!is(db,PgTransaction))return db.transaction(tx=>assertAnalyticalContextPayloadAccessBatch(tx as unknown as Db,companyId,actor,ids,readScope));
 // Match source erasure's ordering: company privacy locks precede all source
 // discovery and row pins, avoiding an advisory-lock/row-lock inversion.
 const {lockAnalyticalCompany}=await import("./analytical-privacy.js"),{lockMemoryPrivacy}=await import("./memory/memory-privacy.js");
 await lockAnalyticalCompany(db,companyId);await lockMemoryPrivacy(db,companyId);
 // Large imports commonly contain ordinary manual Tasks with no captured
 // analytical inputs. Prove that the complete selected population has no
 // retained Workflow/Routine/run/context edge in one query, then apply the
 // same current Task privacy predicate and erasure check in bulk. This avoids
 // repeating no-context discovery through several round trips per Task.
 if(actor&&ids.length>1){
  const selectedIds=sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `);
  const [candidate]=await db.execute<{complex:boolean}>(sql`
   with selected(id) as (select unnest(array[${selectedIds}]::uuid[])),
   chains as (
    select selected.id,source.source_run_id,source.source_task_id,source.invalid
    from selected cross join lateral aw_runner_task_source_chain(${companyId}::uuid,null::uuid,selected.id) source
   )
   select (
    exists(select 1 from selected join issues i on i.company_id=${companyId}::uuid and i.id=selected.id
      where i.origin_run_id is not null or i.execution_run_id is not null or
        i.payload_source_protocol_version not in (0,1) or
        (i.payload_source_protocol_version=1 and (i.payload_source_snapshot is null or i.payload_source_snapshot_invalidated
          or jsonb_typeof(i.payload_source_snapshot->'inputs')<>'array' or jsonb_array_length(i.payload_source_snapshot->'inputs')>0
          or jsonb_array_length(coalesce(i.payload_source_snapshot->'policy'->'issueIds','[]'::jsonb))>0
          or jsonb_array_length(coalesce(i.payload_source_snapshot->'policy'->'projectIds','[]'::jsonb))>0
          or jsonb_array_length(coalesce(i.payload_source_snapshot->'policy'->'runIds','[]'::jsonb))>0
          or jsonb_array_length(coalesce(i.payload_source_snapshot->'policy'->'memoryIds','[]'::jsonb))>0
          or jsonb_array_length(coalesce(i.payload_source_snapshot->'policy'->'foundationRevisionIds','[]'::jsonb))>0))
        or i.origin_kind in ('workflow_task','routine_execution'))
    or exists(select 1 from chains where source_run_id is not null or source_task_id is not null or invalid)
    or exists(select 1 from selected join issue_privacy_sources s on s.company_id=${companyId}::uuid and s.issue_id=selected.id
      where s.source_kind in ('run','run_copy','workflow_run','routine_run'))
    or exists(select 1 from selected join context_manifests cm on cm.company_id=${companyId}::uuid and cm.issue_id=selected.id)
    or exists(select 1 from selected join heartbeat_runs h on h.company_id=${companyId}::uuid
      and coalesce(h.issue_id,h.native_issue_id)=selected.id
      join context_manifests cm on cm.company_id=h.company_id and cm.run_id=h.id)
    or exists(select 1 from selected join context_manifest_items item on item.company_id=${companyId}::uuid
      and item.source_provider='august_works_tasks' and item.source_ref='issue://'||selected.id::text)
   ) as complex
  `);
  if(candidate?.complex!==true){
   const [erasure]=await db.execute<{erased:boolean}>(sql`
    with selected(id) as (select unnest(array[${selectedIds}]::uuid[]))
    select coalesce(bool_or(aw_workflow_memory_erased(${companyId}::uuid,null::uuid,selected.id)),false) as erased from selected
   `);
   if(erasure?.erased)throw new HttpError(403,"Analytical conversation source access is unavailable",{code:"analytical_source_access_lost"});
   const readable=await db.select({id:issues.id}).from(issues).where(and(eq(issues.companyId,companyId),
    inArray(issues.id,ids),await issueReadSqlCondition(db,actor)));
   if(readable.length!==ids.length)throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
   return;
  }
 }
 const worklist:AnalyticalPayloadWorklist={directSources:new Map(),sharedSources:new Map(),finalChecks:[],workflowRunIds:new Set()};
 for(const issueId of ids)
  await assertAnalyticalContextPayloadAccessInternal(db,companyId,actor,{issueId},readScope,worklist);
 const sourceIssueIds=[...new Set([...ids,...[...worklist.sharedSources.values()].flatMap(source=>"issueId"in source?[source.issueId]:[])])];
 const sourceRunIds=[...new Set([...worklist.sharedSources.values()].flatMap(source=>"runId"in source?[source.runId]:[]))];
 // Pin the exact lineage rows after all per-Task source discovery, before its
 // final current-owner checks. The caller's broader privacy transaction stays
 // open through the complete worklist and final checks below.
 if(sourceIssueIds.length){
  const locked=await db.select({id:issues.id}).from(issues).where(and(eq(issues.companyId,companyId),inArray(issues.id,sourceIssueIds))).for("share");
  if(locked.length!==sourceIssueIds.length)throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
 }
 if(sourceRunIds.length){
  const locked=await db.select({id:heartbeatRuns.id}).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,companyId),inArray(heartbeatRuns.id,sourceRunIds))).for("share");
  if(locked.length!==sourceRunIds.length)throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
 }
 const finalize=async()=>{
  const directScopes=new Map([...worklist.directSources,...worklist.sharedSources]);
  await db.execute(sql`set local statement_timeout='8s'`);
  for(const source of directScopes.values())await assertDirectAnalyticalContextPayloadAccess(db,companyId,actor,source,readScope,true);
  for(const check of worklist.finalChecks)await check();
 };
 const workflowRunIds=[...worklist.workflowRunIds].sort();
 if(workflowRunIds.length){
  if(workflowRunIds.length>256||!actor)throw new HttpError(403,"Complete Workflow task source access is unavailable",{code:"analytical_source_access_lost"});
  await authorizationService(db).withReadWorkflowSources(companyId,actor,workflowRunIds,finalize);
 }else await finalize();
}

async function assertAnalyticalContextPayloadAccessInternal(db:Db,companyId:string,actor:AuthorizationActor|undefined,
 scope:{issueId:string}|{runId:string},readScope?:NativeReadScope,worklist?:AnalyticalPayloadWorklist):Promise<void>{
 const origins=()=>db.execute<{source_run_id:string|null;source_task_id:string|null;invalid:boolean}>(sql`
   select source_run_id,source_task_id,invalid from aw_runner_task_source_chain(${companyId}::uuid,
     ${"runId"in scope?scope.runId:null}::uuid,${"issueId"in scope?scope.issueId:null}::uuid)
   order by source_run_id,source_task_id,invalid`);
 const initial=await origins();
 if(!is(db,PgTransaction)){
  const taskIds=[...new Set([...( "issueId" in scope ? [scope.issueId] : []),...initial.map(source=>source.source_task_id).filter((id):id is string=>!!id)])];
  const workflowTasks=taskIds.length?await db.select({id:issues.id}).from(issues).where(and(eq(issues.companyId,companyId),inArray(issues.id,taskIds),eq(issues.originKind,"workflow_task"))).limit(1):[];
  const workflowStep="runId" in scope?await db.select({id:workflowStepRuns.id}).from(workflowStepRuns)
    .where(and(eq(workflowStepRuns.companyId,companyId),eq(workflowStepRuns.heartbeatRunId,scope.runId))).limit(1):[];
  if(workflowTasks.length||workflowStep.length)return db.transaction(tx=>assertAnalyticalContextPayloadAccess(tx as unknown as Db,companyId,actor,scope,readScope));
 }
 if(initial.length>16||initial.some(source=>source.invalid||!source.source_run_id||!source.source_task_id))
   throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
 // A saved routine may copy a private analytical answer into a new task.
 // Retain the exact authoring run's current reader policy as well as erasure.
 const routineOrigins=()=>db.execute<{source_run_id:string;source_task_id:string}>(sql`
   with tasks as (
     select coalesce(${"issueId"in scope?scope.issueId:null}::uuid,(select coalesce(h.native_issue_id,case
       when coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       then coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')::uuid else null end)
       from heartbeat_runs h where h.company_id=${companyId}::uuid and h.id=${"runId"in scope?scope.runId:null}::uuid)) as id
     union select source_task_id from aw_runner_task_source_chain(${companyId}::uuid,
       ${"runId"in scope?scope.runId:null}::uuid,${"issueId"in scope?scope.issueId:null}::uuid)
   ) select distinct h.id as source_run_id,c.id as source_task_id
     from tasks t join issues i on i.company_id=${companyId}::uuid and i.id=t.id and i.origin_kind='routine_execution'
     join routines r on r.company_id=i.company_id and r.origin_kind='conversation_draft' and r.id=case
       when i.origin_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then i.origin_id::uuid else null end
     join heartbeat_runs h on h.company_id=r.company_id and h.id=case
       when r.origin_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then r.origin_id::uuid else null end
     join issues c on c.company_id=h.company_id and c.id=coalesce(h.native_issue_id,case
       when coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       then coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')::uuid else null end)
     order by source_run_id,source_task_id limit 18`);
 const initialRoutines=await routineOrigins();
 if(initialRoutines.length>17)throw new HttpError(403,"Complete routine source access is unavailable",{code:"analytical_source_access_lost"});
 const workflowTaskIds=[...new Set([...( "issueId" in scope ? [scope.issueId] : []),...initial.map(source=>source.source_task_id).filter((id):id is string=>!!id)])];
 const workflowTasks=workflowTaskIds.length?await db.select({id:issues.id,runId:issues.originRunId}).from(issues)
  .where(and(eq(issues.companyId,companyId),inArray(issues.id,workflowTaskIds),eq(issues.originKind,"workflow_task"))).limit(18):[];
 const stepRuns="runId" in scope?await db.selectDistinct({runId:workflowStepRuns.workflowRunId}).from(workflowStepRuns)
  .where(and(eq(workflowStepRuns.companyId,companyId),eq(workflowStepRuns.heartbeatRunId,scope.runId))).limit(257):[];
 const workflowRunIds=[...new Set([...workflowTasks.map(task=>task.runId).filter((id):id is string=>!!id),...stepRuns.map(row=>row.runId)])].sort();
 if(workflowRunIds.length>256)throw new HttpError(403,"Complete Workflow task source access is unavailable",{code:"analytical_source_access_lost"});
 if(worklist)workflowRunIds.forEach(runId=>worklist.workflowRunIds.add(runId));
 const inspect=async()=>{
 if(worklist)worklist.directSources.set("issueId"in scope?`issue:${scope.issueId}`:`run:${scope.runId}`,scope);
 else await assertDirectAnalyticalContextPayloadAccess(db,companyId,actor,scope,readScope);
 for(const source of initial){
   // Each actual ancestor keeps its Original current-reader policy, not just
   // an erasure marker or the descendant task's company membership.
   if(worklist){
    worklist.sharedSources.set(`run:${source.source_run_id}`,{runId:source.source_run_id!});
    worklist.sharedSources.set(`issue:${source.source_task_id}`,{issueId:source.source_task_id!});
   }else{
    await assertDirectAnalyticalContextPayloadAccess(db,companyId,actor,{runId:source.source_run_id!},readScope);
    await assertDirectAnalyticalContextPayloadAccess(db,companyId,actor,{issueId:source.source_task_id!},readScope);
   }
 }
 for(const source of initialRoutines){
   if(worklist){
    worklist.sharedSources.set(`run:${source.source_run_id}`,{runId:source.source_run_id});
    worklist.sharedSources.set(`issue:${source.source_task_id}`,{issueId:source.source_task_id});
   }else{
    await assertDirectAnalyticalContextPayloadAccess(db,companyId,actor,{runId:source.source_run_id},readScope);
    await assertDirectAnalyticalContextPayloadAccess(db,companyId,actor,{issueId:source.source_task_id},readScope);
   }
 }
 if(initial.length||initialRoutines.length){
  const recheck=async()=>{
   const final=await origins();
   if(JSON.stringify(initialRoutines)!==JSON.stringify(await routineOrigins()))
     throw new HttpError(403,"Routine source provenance changed",{code:"analytical_source_access_lost"});
   if(JSON.stringify(initial)!==JSON.stringify(final))
     throw new HttpError(403,"Native task source provenance changed",{code:"analytical_source_access_lost"});
   const [receipt]=await db.execute<{erased:boolean}>(sql`select aw_workflow_memory_erased(${companyId}::uuid,
     ${"runId"in scope?scope.runId:null}::uuid,${"issueId"in scope?scope.issueId:null}::uuid) as erased`);
   if(receipt?.erased)throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
  };
  if(worklist)worklist.finalChecks.push(recheck);
  else await recheck();
 }
 };
 if(workflowRunIds.length){
  if(!actor)throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
  return authorizationService(db).withReadWorkflowSources(companyId,actor,workflowRunIds,inspect);
 }
 return inspect();
}

async function assertDirectAnalyticalContextPayloadAccess(db:Db,companyId:string,actor:AuthorizationActor|undefined,scope:{issueId:string}|{runId:string},readScope?:NativeReadScope,companyLocksHeld=false) {
 // Ordinary conversation prose has source privacy even without analytical
 // retention roots. Every actual ancestor goes through this same narrowing.
 let diagnosticStage="task_reader_acl";
 try {
 if(!actor || !("issueId" in scope
   ? await canActorReadIssuePrivacy(db,actor,{companyId,id:scope.issueId})
   : await canActorReadHeartbeatRunPrivacy(db,actor,{companyId,id:scope.runId})))
   throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
 diagnosticStage="task_erasure_currentness";
 const [sourceReceipt]=await db.execute<{erased:boolean}>(sql`select aw_workflow_memory_erased(${companyId}::uuid,${"runId"in scope?scope.runId:null}::uuid,${"issueId"in scope?scope.issueId:null}::uuid) as erased`);
 if(sourceReceipt?.erased)throw new HttpError(403,"Analytical conversation source access is unavailable",{code:"analytical_source_access_lost"});
 diagnosticStage="learned_workflow_currentness";
 await assertLearnedWorkflowPayloadAccess(db,companyId,actor,scope,readScope);
 diagnosticStage="conversation_retirement_check";
 const boundRun="runId" in scope?await db.select({issueId:heartbeatRuns.issueId}).from(heartbeatRuns)
  .where(and(eq(heartbeatRuns.companyId,companyId),eq(heartbeatRuns.id,scope.runId))).limit(1):[];
 const conversationIssueId="issueId" in scope?scope.issueId:boundRun[0]?.issueId;
 const retired = await db.select({id:issues.id}).from(issues).where(and(eq(issues.companyId,companyId),sql`${issues.conversationRetiredAt} is not null`,
  "issueId" in scope?eq(issues.id,scope.issueId):sql`exists(select 1 from ${heartbeatRuns} h where h.company_id=${companyId}::uuid and h.id=${scope.runId}::uuid and h.native_issue_id=${issues.id})`)).limit(1);
 if(retired.length)throw new HttpError(403,"Analytical conversation source access is unavailable",{code:"analytical_source_access_lost"});
 diagnosticStage="retained_context_lookup";
 const condition="issueId" in scope?or(eq(contextManifests.issueId,scope.issueId),
  sql`exists(select 1 from heartbeat_runs h where h.company_id=${companyId}::uuid and h.id=${contextManifests.runId} and h.agent_id=${contextManifests.agentId} and h.issue_id=${scope.issueId}::uuid)`):or(eq(contextManifests.runId,scope.runId),conversationIssueId?eq(contextManifests.issueId,conversationIssueId):undefined,sql`exists(select 1 from ${agentExecutionManifests} e where e.company_id=${companyId}::uuid and e.run_id=${scope.runId}::uuid and e.context_manifest_id=${contextManifests.id})`);
 const {lockAnalyticalCompany}=await import("./analytical-privacy.js"),{lockMemoryPrivacy}=await import("./memory/memory-privacy.js");
 const inspectIn=async(tx:Db)=>{
  // The caller already owns a pinned source transaction in the batched/Home
  // path. Opening a savepoint for every retained Context root adds a full
  // round trip per Task without strengthening the locks or current checks.
  // Keep a transaction only for standalone callers.
  if(!companyLocksHeld){
   diagnosticStage="retained_context_privacy_locks";
   await tx.execute(sql`set local statement_timeout='8s'`);
   await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);
  }
  const currentActor=actor;
  if(!currentActor)throw forbidden("A current reader is required for source-dependent analytical payloads");
  if(!companyLocksHeld){
   diagnosticStage="task_reader_acl_recheck";
   const canRead="issueId" in scope
    ? await canActorReadIssuePrivacy(tx,currentActor,{companyId,id:scope.issueId})
    : await canActorReadHeartbeatRunPrivacy(tx,currentActor,{companyId,id:scope.runId});
   if(!canRead)throw new HttpError(403,"Native task source access is unavailable",{code:"analytical_source_access_lost"});
  }
  diagnosticStage="retained_context_lookup";
  const retainedContexts=await tx.select({id:contextManifests.id}).from(contextManifests)
   .where(and(eq(contextManifests.companyId,companyId),condition)).limit(1);
  if(!retainedContexts.length)return;
  const hasRoots=await tx.select({id:analyticalContextRoots.memoryRecordId}).from(contextManifests)
   .innerJoin(contextManifestMemoryRoots,and(eq(contextManifestMemoryRoots.companyId,contextManifests.companyId),eq(contextManifestMemoryRoots.manifestId,contextManifests.id)))
   .innerJoin(analyticalContextRoots,and(eq(analyticalContextRoots.companyId,contextManifests.companyId),eq(analyticalContextRoots.memoryRecordId,contextManifestMemoryRoots.memoryRecordId)))
   .where(and(eq(contextManifests.companyId,companyId),condition)).limit(1);
  const inspectCurrentSources=async()=>{
  diagnosticStage="retained_root_lookup";
  const roots=await tx.selectDistinct({id:analyticalContextRoots.memoryRecordId,sourceCount:analyticalContextRoots.sourceCount,pins:analyticalContextRoots.authorityPins,expiresAt:analyticalContextRoots.expiresAt}).from(contextManifests).innerJoin(contextManifestMemoryRoots,and(eq(contextManifestMemoryRoots.companyId,contextManifests.companyId),eq(contextManifestMemoryRoots.manifestId,contextManifests.id)))
   .innerJoin(analyticalContextRoots,and(eq(analyticalContextRoots.companyId,contextManifests.companyId),eq(analyticalContextRoots.memoryRecordId,contextManifestMemoryRoots.memoryRecordId))).where(and(eq(contextManifests.companyId,companyId),condition)).limit(257);
  if(roots.length>256)throw forbidden("The complete analytical conversation exceeds its source review budget");
  diagnosticStage="retained_run_erasure_currentness";
  const erased=await tx.execute<{erased:boolean}>(sql`select aw_workflow_memory_erased(${companyId}::uuid,${"runId"in scope?scope.runId:null}::uuid,${conversationIssueId??null}::uuid) as erased`);
  if(erased[0]?.erased)throw forbidden("The analytical conversation source was erased or expired");
  const deadline=performance.now()+30000;
  const memoryRoots=await tx.selectDistinct({id:contextManifestMemoryRoots.memoryRecordId}).from(contextManifests)
   .innerJoin(contextManifestMemoryRoots,and(eq(contextManifestMemoryRoots.companyId,contextManifests.companyId),eq(contextManifestMemoryRoots.manifestId,contextManifests.id)))
   .where(and(eq(contextManifests.companyId,companyId),condition)).limit(257);
  if(memoryRoots.length>256)throw forbidden("The complete retained Context exceeds its source review budget");
  const {canActorReadMemorySources}=await import("./memory/memory-privacy.js");
  const analyticalIds=new Set(roots.map(root=>root.id));
  diagnosticStage="retained_memory_reader";
  for(const root of memoryRoots){
   if(analyticalIds.has(root.id)){
    await assertAnalyticalRetentionRootOwnerCurrent(tx,companyId,currentActor,root.id);
    continue;
   }
   if(performance.now()>deadline || !await canActorReadMemorySources(tx,companyId,currentActor,root.id))
    throw forbidden("Retained Context source access is unavailable");
  }
  const foundation=await tx.selectDistinct({ref:contextManifestItems.sourceRef}).from(contextManifests)
   .innerJoin(contextManifestItems,and(eq(contextManifestItems.companyId,contextManifests.companyId),eq(contextManifestItems.manifestId,contextManifests.id)))
   .where(and(eq(contextManifests.companyId,companyId),condition,eq(contextManifestItems.sourceProvider,"august_works_foundation"))).limit(257);
  if(foundation.length>256)throw forbidden("The complete learned Context exceeds its source review budget");
  if(foundation.length){
   const {accessService}=await import("./access.js"),access=await accessService(tx).decide({actor:currentActor,enforceResponsibleUserIntersection:true,action:"foundation:read",resource:{type:"company",companyId}});
   if(!access.allowed)throw forbidden("The learned Foundation Context is no longer authorized");
   const {assertLearnedAssetAnalyticalSources}=await import("./learning/learning-analytical-sources.js");
   for(const item of foundation){const ref=/^foundation:\/\/[a-f0-9-]{36}\/([a-f0-9-]{36})\/(?:\d+|whole)$/i.exec(item.ref);if(!ref||performance.now()>deadline)throw forbidden("The exact learned Foundation Context is unavailable");await assertLearnedAssetAnalyticalSources(tx,companyId,"document_revision",ref[1]!,currentActor,readScope);}
  }
  for(const root of roots){
   diagnosticStage="retained_root_shape";
   if(!root.pins.length)throw forbidden("The analytical conversation requires current source review");
   diagnosticStage="retained_root_expiry";
   if(root.expiresAt.getTime()<=Date.now())throw forbidden("The analytical conversation requires current source review");
   diagnosticStage="retained_root_pin_revalidation";
   const current=await inspectAnalyticalContextPins(tx,companyId,currentActor,root.pins,deadline);
   diagnosticStage="retained_root_dependency_read";
   const retained=await tx.select({id:analyticalContextDependencies.sourceManifestId}).from(analyticalContextDependencies).where(and(eq(analyticalContextDependencies.companyId,companyId),eq(analyticalContextDependencies.memoryRecordId,root.id))).limit(26201);
   diagnosticStage="retained_root_dependency_match";
   if(retained.length!==root.sourceCount||JSON.stringify(retained.map(source=>source.id).sort())!==JSON.stringify(current.manifestIds))throw forbidden("The complete retained analytical source authority changed");
  }
  };
  if(hasRoots.length&&currentActor.type==="agent"){
   const {withNativeAnalyticalReader,withNativeAnalyticalSourceReader}=await import("./analytical-reader.js");
   return currentActor.source==="none"
    ? await withNativeAnalyticalSourceReader(tx,companyId,currentActor,inspectCurrentSources,readScope??"task")
    : await withNativeAnalyticalReader(tx,companyId,currentActor,inspectCurrentSources,readScope);
  }
  return inspectCurrentSources();
 };
 const inspect=()=>is(db,PgTransaction)?inspectIn(db):db.transaction(rawTx=>inspectIn(rawTx as unknown as Db));
 try {
  return await inspect();
 }catch(error){
  if(error instanceof HttpError&&[403,404,409,422].includes(error.status))throw new HttpError(error.status,"Analytical conversation source access is unavailable",{code:"analytical_source_access_lost"});
  throw error;
 }
 }catch(error){
  if(process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS==="1"){
   const candidate=error&&typeof error==="object"?error as {status?:unknown;code?:unknown;details?:unknown;cause?:unknown}:null;
   const details=candidate?.details&&typeof candidate.details==="object"?candidate.details as Record<string,unknown>:null;
   const code=typeof details?.code==="string"&&/^[a-z][a-z0-9_]{0,63}$/.test(details.code)?details.code:null;
   console.info("native-analytical-source-review-diagnostic",JSON.stringify({stage:diagnosticStage,
    scope:"issueId"in scope?"issue":"run",actorType:actor?.type??"none",
    status:typeof candidate?.status==="number"?candidate.status:null,code}));
  }
  throw error;
 }
}

/** Provider inputs and outputs use the actual persisted native identity. A
 * caller supplies only the existing company/run binding, never a human grant. */
export async function assertNativeAnalyticalRunPayloadAccess(db:Db,companyId:string,runId:string) {
 const [run]=await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,companyId),eq(heartbeatRuns.id,runId))).limit(1);
 if(!run)throw new HttpError(403,"Analytical conversation source access is unavailable",{code:"analytical_source_access_lost"});
 const actor:AuthorizationActor={type:"agent",source:"agent_jwt",companyId,agentId:run.agentId,runId:run.id,onBehalfOfUserId:run.responsibleUserId};
 await assertAnalyticalContextPayloadAccess(db,companyId,actor,{runId:run.id},"task");
}
