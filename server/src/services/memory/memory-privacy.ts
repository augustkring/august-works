import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { agentExecutionManifests,providerTraceRecords, memoryDeletionMarkers, memoryEvidence, memoryJobs, memoryRecords, memoryRetentionPolicies,
  contextManifests, contextManifestItems, contextManifestMemoryRoots, saasRunLogs, saasRunLogChunks, activityLog, issueThreadInteractions, toolAccessAuditEvents, toolActionRequests, toolCallEvents, toolInvocations,
  heartbeatRuns, heartbeatRunEvents, agentWakeupRequests, agents, authUsers, issues, issueComments, issueDocuments, documents, documentRevisions,
  nativeRunResults, workAssessments, statusDecisions, nativeRunFinalizations, completionContracts, issueWorkProducts, agentTaskSessions, agentRuntimeState,
  workflowRuns, workflowStepRuns, workflowWaits, workflowRunReviews, workflowOptimizerEvaluations, workflowOptimizerObservations, automationArtifacts, automationArtifactVersions, type Db } from "@paperclipai/db";
import { notificationPreferenceProposals, foundationChangeProposals, foundationSections, routines, routineRevisions, routineTriggers, routineDocuments, routineRuns, companySecretBindings } from "@paperclipai/db";
import { eraseAnalyticalSourcesUnderMemory } from "../analytical-source-erasure.js";
import { eraseBusinessEventObjectUnderMemory } from "../business-event-payload-erasure.js";
import { conflict, forbidden, HttpError } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { invalidateCognitiveRecords } from "./cognitive-privacy.js";
import { invalidateDerivedMemory } from "./derived-privacy.js";

export function memoryDeletionKey(companyId: string, kind: "record" | "operation" | "source", value: unknown) {
  return createHash("sha256").update(JSON.stringify([companyId, kind, value])).digest("hex");
}

export async function lockMemoryPrivacy(db: Db, companyId: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`memory:privacy:${companyId}`}, 0))`);
}

/** Internal receipt from the native worker's locked capture transaction. Neither
 * actor claims nor a completed run alone admit retained source comparison. */
export type NativeMemoryCaptureReceipt = {
  jobId: string;
  executionOwnerId: string;
  backendPid: number;
  transactionId: string;
};
const nativeCaptureSources = new AsyncLocalStorage<{
  companyId: string; agentId: string; runId: string; userId: string;
  receipt: NativeMemoryCaptureReceipt; active: boolean;
}>();
export function nativeMemoryCaptureSourcePurposeActive(companyId: string, actor: AuthorizationActor): boolean {
  const permit = nativeCaptureSources.getStore();
  return !!permit?.active && actor.type === "agent" && actor.source === "agent_jwt" && !actor.keyId && !actor.keyScope
    && actor.companyId === companyId && permit.companyId === companyId
    && permit.agentId === actor.agentId && permit.runId === actor.runId && permit.userId === actor.onBehalfOfUserId;
}
/** Savepoints retain the same physical backend and top-level transaction. Each
 * source owner rechecks the live lease; this is not a cached permission result. */
export function nativeMemoryCapturePrincipalCondition(actor: AuthorizationActor, company: SQL): SQL<boolean> {
  const permit = nativeCaptureSources.getStore();
  if (!permit || !nativeMemoryCaptureSourcePurposeActive(permit.companyId, actor)) return sql<boolean>`false`;
  const receipt = permit.receipt;
  return sql<boolean>`(${company}=${permit.companyId}::uuid
    and pg_backend_pid()=${receipt.backendPid} and pg_current_xact_id()::text=${receipt.transactionId}
    and exists(select 1 from ${memoryJobs} j
      join ${heartbeatRuns} r on r.id=j.source_heartbeat_run_id and r.company_id=j.company_id
      join ${agents} a on a.id=r.agent_id and a.company_id=r.company_id
      join ${authUsers} u on u.id=r.responsible_user_id
      join company_memberships m on m.company_id=r.company_id and m.principal_type='user'
        and m.principal_id=u.id and m.status='active'
      where j.id=${receipt.jobId}::uuid and j.company_id=${company} and j.operation_type='capture'
        and j.status='running' and j.execution_owner_id=${receipt.executionOwnerId}
        and j.lease_expires_at>clock_timestamp() and r.id=${permit.runId}::uuid
        and r.agent_id=${permit.agentId}::uuid and r.responsible_user_id=${permit.userId}
        and r.status='succeeded' and r.runtime_mode='native'
        and a.status not in ('paused','terminated','pending_approval','error')))`;
}
export async function assertNativeMemoryCaptureSourcePrincipal(db: Db, companyId: string, actor: AuthorizationActor) {
  const [current] = await db.execute<{allowed:boolean}>(sql`select ${nativeMemoryCapturePrincipalCondition(actor,sql`${companyId}::uuid`)} as allowed`);
  if (!current?.allowed) throw forbidden("Native Memory capture source authority changed");
}
export async function withNativeMemoryCaptureSources<T>(db: Db, companyId: string, actor: AuthorizationActor | undefined,
  receipt: NativeMemoryCaptureReceipt, inspect: () => Promise<T>): Promise<T> {
  if (!actor || actor.type !== "agent" || actor.source !== "agent_jwt" || actor.companyId !== companyId
    || !actor.agentId || !actor.runId || !actor.onBehalfOfUserId || actor.keyId || actor.keyScope
    || ![companyId,actor.agentId,actor.runId].every(id=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
    || !receipt || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(receipt.jobId)
    || !Number.isSafeInteger(receipt.backendPid) || receipt.backendPid <= 0
    || !/^\d+$/.test(receipt.transactionId) || !receipt.executionOwnerId || receipt.executionOwnerId.length > 256)
    throw forbidden("A native Memory capture transaction is required");
  const permit = {companyId,agentId:actor.agentId,runId:actor.runId,userId:actor.onBehalfOfUserId,
    receipt:{...receipt},active:true};
  try {
    return await nativeCaptureSources.run(permit,async()=>{
      await assertNativeMemoryCaptureSourcePrincipal(db,companyId,actor);
      await db.execute(sql`select id from ${memoryJobs} where id=${receipt.jobId}::uuid for update`);
      try {
        // Native account erasure and Agent deletion have different row orders.
        // Never wait on their principal rows while holding this job/run. These
        // positive pins last through the actual outer transaction's commit.
        await db.execute(sql`select u.id from ${authUsers} u
          join company_memberships m on m.principal_id=u.id and m.principal_type='user'
            and m.company_id=${companyId}::uuid and m.status='active'
          join ${agents} a on a.id=${actor.agentId}::uuid and a.company_id=m.company_id
          where u.id=${actor.onBehalfOfUserId} and ${nativeMemoryCapturePrincipalCondition(actor,sql`${companyId}::uuid`)}
          for share of u,m,a nowait`);
      } catch (error) {
        let cause:unknown=error;
        for(let depth=0;depth<4 && cause && typeof cause==="object";depth++){
          const current=cause as {code?:unknown;cause?:unknown};
          if(current.code==="55P03")throw conflict("Memory capture source is busy",{code:"memory_capture_source_busy"});
          cause=current.cause;
        }
        throw error;
      }
      await assertNativeMemoryCaptureSourcePrincipal(db,companyId,actor);
      const result = await inspect();
      await assertNativeMemoryCaptureSourcePrincipal(db,companyId,actor);
      return result;
    });
  } finally { permit.active=false; }
}

/** Current source authority, independent of a Memory record's display scope.
 * A shared/corrected copy keeps every original root. Unknown history is withheld. */
const memorySourceReads=new AsyncLocalStorage<{active:Set<string>;deadline:number;work:number}>();
export async function canActorReadMemorySources(db: Db, companyId: string, actor: AuthorizationActor | undefined, recordId: string):Promise<boolean> {
  const inherited=memorySourceReads.getStore(),state=inherited??{active:new Set<string>(),deadline:performance.now()+8000,work:0};
  const key=`${companyId}:${recordId}`;
  if(state.active.has(key) || performance.now()>state.deadline || state.work>=256)return false;
  const read=async()=>{
    state.active.add(key);
    try{return await inspectMemorySourceAccess(db,companyId,actor,recordId,state);}
    finally{state.active.delete(key);}
  };
  return inherited?read():memorySourceReads.run(state,read);
}
async function memorySourceActorCurrent(db:Db,companyId:string,actor:AuthorizationActor|undefined):Promise<boolean> {
  if(!actor)return false;
  const {authorizationService}=await import("../authorization.js");
  if (actor.type === "agent") {
    if (!actor.runId || !actor.agentId || !actor.onBehalfOfUserId) return false;
    const [run] = await db.select({id:heartbeatRuns.id}).from(heartbeatRuns)
    .innerJoin(agents,and(eq(agents.companyId,heartbeatRuns.companyId),eq(agents.id,heartbeatRuns.agentId))).where(and(
      eq(heartbeatRuns.companyId,companyId),eq(heartbeatRuns.id,actor.runId),eq(heartbeatRuns.agentId,actor.agentId),
      eq(heartbeatRuns.responsibleUserId,actor.onBehalfOfUserId),eq(heartbeatRuns.status,"running"),
      sql`${agents.status} not in ('paused','terminated','pending_approval','error')`,
    ));
    if (!run) {
      const [capture] = await db.execute<{allowed:boolean}>(sql`select ${nativeMemoryCapturePrincipalCondition(actor,sql`${companyId}::uuid`)} as allowed`);
      if (!capture?.allowed) return false;
    }
  }else if(actor.type==="board" && actor.source!=="local_implicit"){
    if(!actor.userId)return false;
    const [account]=await db.select({id:authUsers.id}).from(authUsers).where(eq(authUsers.id,actor.userId));
    if(!account)return false;
  }
  return (await authorizationService(db).decide({actor,action:"company_scope:read",resource:{type:"company",companyId},enforceResponsibleUserIntersection:true})).allowed;
}
async function inspectMemorySourceAccess(db:Db,companyId:string,actor:AuthorizationActor|undefined,recordId:string,
  state:{deadline:number;work:number}):Promise<boolean> {
  if (!actor) return false;
  const { authorizationService, canActorReadIssuePrivacy, canActorReadProjectPrivacy, canActorReadHeartbeatRunPrivacy } = await import("../authorization.js");
  const admitted = () => memorySourceActorCurrent(db,companyId,actor);
  if (!await admitted()) return false;
  const active = new Set<string>(), visited = new Set<string>();
  const runs = new Set<string>(), tasks = new Set<string>(), projectIds = new Set<string>(), revisions = new Set<string>();
  const deadline = state.deadline;
  const visit = async (id:string,ancestor=false):Promise<boolean> => {
    if (active.has(id) || performance.now()>deadline || visited.size>=256 || state.work>=256) return false;
    if (visited.has(id)) return true;
    state.work++;
    const [row] = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId,companyId),eq(memoryRecords.id,id),memoryPayloadVisible()));
    if (!row?.sourceProvenanceQualified || (row.expiresAt && row.expiresAt.getTime()<=Date.now())) return false;
    const readerUserId=actor.type==="board"?actor.userId:actor.onBehalfOfUserId;
    // A run may legitimately change Human after acknowledged steering. Its
    // current identity cannot transfer an earlier private Memory to that Human.
    if((row.scopeType==="agent" && !row.privateOwnerUserId)
      || (row.privateOwnerUserId && row.privateOwnerUserId!==readerUserId))return false;
    if(row.scopeType==="agent" && actor.type==="agent"
      && (row.ownerAgentId!==actor.agentId || row.scopeId!==actor.agentId))return false;
    if(ancestor && (row.revokedAt || row.retentionState==="expired" || row.validUntil && row.validUntil.getTime()<=Date.now()))return false;
    const ids = [...row.sourceRunIds,...row.sourceIssueIds,...row.sourceProjectIds,...row.sourceMemoryIds,...row.sourceFoundationRevisionIds];
    if (ids.length>256 || ids.some(value=>typeof value!=="string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))) return false;
    visited.add(id);active.add(id);
    row.sourceRunIds.forEach(value=>runs.add(value));row.sourceIssueIds.forEach(value=>tasks.add(value));
    row.sourceProjectIds.forEach(value=>projectIds.add(value));row.sourceFoundationRevisionIds.forEach(value=>revisions.add(value));
    if (row.scopeType==="project") {
      if (!row.scopeId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.scopeId)) return false;
      projectIds.add(row.scopeId);
    }
    for (const source of row.sourceMemoryIds) if (!await visit(source,true)) return false;
    active.delete(id);
    return visited.size+runs.size+tasks.size+projectIds.size+revisions.size<=256;
  };
  if (!await visit(recordId)) return false;
  for (const id of runs) if (performance.now()>deadline || !await canActorReadHeartbeatRunPrivacy(db,actor,{companyId,id})) return false;
  for (const id of tasks) if (performance.now()>deadline || !await canActorReadIssuePrivacy(db,actor,{companyId,id})) return false;
  for (const id of projectIds) if (performance.now()>deadline || !await canActorReadProjectPrivacy(db,actor,{companyId,id})) return false;
  if (revisions.size) {
    if (!(await authorizationService(db).decide({actor,action:"foundation:read",resource:{type:"company",companyId},enforceResponsibleUserIntersection:true})).allowed) return false;
    const {assertLearnedAssetAnalyticalSources} = await import("../learning/learning-analytical-sources.js");
    for (const id of revisions) {
      if (performance.now()>deadline) return false;
      const [source] = await db.select({id:documentRevisions.id}).from(documentRevisions).where(and(eq(documentRevisions.companyId,companyId),eq(documentRevisions.id,id)));
      if (!source) return false;
      try {await assertLearnedAssetAnalyticalSources(db,companyId,"document_revision",id,actor,"task");}
      catch(error){if(error instanceof HttpError && [403,404,409,422].includes(error.status))return false;throw error;}
    }
  }
  return performance.now()<=deadline && await admitted();
}

/** Only actual producer/run and persisted Context owners stamp these columns.
 * Caller citations and metadata never qualify a producer or remove a source. */
export async function captureMemorySources(db: Db, companyId: string, actor: AuthorizationActor | undefined,
  scope:{type:string;id:string|null}, sourceMemoryIds:string[] = []) {
  const sources = {
    sourceProvenanceQualified:false,privateOwnerUserId:null as string|null,sourceRunIds:[] as string[],sourceIssueIds:[] as string[],
    sourceProjectIds:[] as string[],sourceMemoryIds:[...new Set(sourceMemoryIds)],sourceFoundationRevisionIds:[] as string[],
  };
  if (!actor) return sources;
  const {authorizationService} = await import("../authorization.js");
  if (!await memorySourceActorCurrent(db,companyId,actor))
    throw forbidden("Memory producer authority is unavailable");
  if (scope.type==="project" && scope.id) sources.sourceProjectIds.push(scope.id);
  if (actor.type==="agent") {
    if (!actor.runId || !actor.agentId || !actor.onBehalfOfUserId) throw forbidden("Memory requires its actual accountable producer run");
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,companyId),eq(heartbeatRuns.id,actor.runId),
      eq(heartbeatRuns.agentId,actor.agentId),eq(heartbeatRuns.responsibleUserId,actor.onBehalfOfUserId))).for("share");
    if (!run || (run.status!=="running" && !nativeMemoryCaptureSourcePurposeActive(companyId,actor)))
      throw forbidden("Memory producer run is unavailable");
    if(run.status!=="running")await assertNativeMemoryCaptureSourcePrincipal(db,companyId,actor);
    if(scope.type==="agent")sources.privateOwnerUserId=run.responsibleUserId;
    sources.sourceRunIds.push(run.id);
    if (run.issueId) sources.sourceIssueIds.push(run.issueId);
    const contexts = await db.select().from(contextManifests).where(and(eq(contextManifests.companyId,companyId),eq(contextManifests.agentId,actor.agentId),eq(contextManifests.runId,run.id))).limit(65);
    if (contexts.length>64) throw forbidden("Complete Memory producer Context exceeds its source budget");
    if (contexts.length) {
      const contextIds=contexts.map(row=>row.id);
      sources.sourceProjectIds.push(...contexts.flatMap(row=>row.projectId?[row.projectId]:[]));
      const roots=await db.select({id:contextManifestMemoryRoots.memoryRecordId}).from(contextManifestMemoryRoots)
        .where(and(eq(contextManifestMemoryRoots.companyId,companyId),inArray(contextManifestMemoryRoots.manifestId,contextIds))).limit(257);
      if (roots.length>256) throw forbidden("Complete Memory roots exceed their source budget");
      sources.sourceMemoryIds.push(...roots.map(row=>row.id));
      const items=await db.select().from(contextManifestItems).where(and(eq(contextManifestItems.companyId,companyId),inArray(contextManifestItems.manifestId,contextIds))).limit(257);
      if (items.length>256) throw forbidden("Complete Memory Context exceeds its source budget");
      for (const item of items) {
        if (item.sourceProvider==="august_works_tasks") {
          const ref=/^issue:\/\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(item.sourceRef);
          if (!ref) throw forbidden("Memory Task provenance is unavailable");
          sources.sourceIssueIds.push(ref[1]!);
        } else if (item.sourceProvider==="august_works_foundation") {
          const ref=/^foundation:\/\/[a-f0-9-]{36}\/([a-f0-9-]{36})\/(?:\d+|whole)$/i.exec(item.sourceRef);
          if (!ref || item.sourceVersion!==ref[1]) throw forbidden("Memory Foundation provenance is unavailable");
          sources.sourceFoundationRevisionIds.push(ref[1]!);
        }
      }
    }
  } else if (actor.type!=="board" || (!actor.userId && actor.source!=="local_implicit")) return sources;
  for (const key of ["sourceRunIds","sourceIssueIds","sourceProjectIds","sourceMemoryIds","sourceFoundationRevisionIds"] as const)
    sources[key]=[...new Set(sources[key])].sort();
  if (sources.sourceRunIds.length+sources.sourceIssueIds.length+sources.sourceProjectIds.length+sources.sourceMemoryIds.length+sources.sourceFoundationRevisionIds.length>256)
    throw forbidden("Complete Memory provenance exceeds its source budget");
  // Actual Context retention supplies dependencies, never authority. In
  // particular, acknowledged Human steering cannot authorize the prior Human's
  // private roots merely because they still belong to this same producer run.
  const {canActorReadIssuePrivacy,canActorReadProjectPrivacy,canActorReadHeartbeatRunPrivacy}=await import("../authorization.js");
  const deadline=performance.now()+8000;
  for(const id of sources.sourceRunIds)if(performance.now()>deadline || !await canActorReadHeartbeatRunPrivacy(db,actor,{companyId,id}))
    throw forbidden("Memory producer source access is unavailable");
  for(const id of sources.sourceIssueIds)if(performance.now()>deadline || !await canActorReadIssuePrivacy(db,actor,{companyId,id}))
    throw forbidden("Memory Task source access is unavailable");
  for(const id of sources.sourceProjectIds)if(performance.now()>deadline || !await canActorReadProjectPrivacy(db,actor,{companyId,id}))
    throw forbidden("Memory Project source access is unavailable");
  for(const id of sources.sourceMemoryIds)if(performance.now()>deadline || !await canActorReadMemorySources(db,companyId,actor,id))
    throw forbidden("Memory retained source access is unavailable");
  if(sources.sourceFoundationRevisionIds.length){
    if(!(await authorizationService(db).decide({actor,action:"foundation:read",resource:{type:"company",companyId},enforceResponsibleUserIntersection:true})).allowed)
      throw forbidden("Memory Foundation source access is unavailable");
    const {assertLearnedAssetAnalyticalSources}=await import("../learning/learning-analytical-sources.js");
    for(const id of sources.sourceFoundationRevisionIds){
      const [revision]=await db.select({id:documentRevisions.id}).from(documentRevisions).where(and(eq(documentRevisions.companyId,companyId),eq(documentRevisions.id,id)));
      if(!revision || performance.now()>deadline)throw forbidden("Memory Foundation source is unavailable");
      await assertLearnedAssetAnalyticalSources(db,companyId,"document_revision",id,actor,"task");
    }
  }
  if (performance.now()>deadline || !await memorySourceActorCurrent(db,companyId,actor))
    throw forbidden("Memory producer authority changed");
  sources.sourceProvenanceQualified=true;
  return sources;
}

export function memoryPayloadVisible() {
  return and(isNull(memoryRecords.deletedAt), sql`not exists (select 1 from ${memoryDeletionMarkers}
    where ${memoryDeletionMarkers.companyId} = ${memoryRecords.companyId}
    and ${memoryDeletionMarkers.recordId} = ${memoryRecords.id})`);
}

export async function assertMemoryRecordsRetained(db: Db, companyId: string, ids: string[]) {
  if (!ids.length) return;
  const rows = await db.select({ id: memoryRecords.id }).from(memoryRecords).where(and(
    eq(memoryRecords.companyId, companyId), inArray(memoryRecords.id, [...new Set(ids)]), memoryPayloadVisible()));
  if (rows.length !== new Set(ids).size) throw conflict("A workflow Memory source was erased or is unavailable", {
    code: "workflow_memory_source_deleted" });
}

/** Company-scoped database guard covers both bound and lost-response child executions. */
export function heartbeatMemoryPayloadVisible() {
  return sql`not aw_workflow_memory_erased(${heartbeatRuns.companyId}, ${heartbeatRuns.id}, null)`;
}
export async function heartbeatMemoryPayloadRetained(db: Db, companyId: string, runId: string) {
  const [row] = await db.select({ visible: heartbeatMemoryPayloadVisible() }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)));
  return row?.visible !== false;
}

function evidenceDeletionKeys(companyId: string, item: { sourceProvider: string; sourceRef: string }) {
  const keys = [memoryDeletionKey(companyId, "source", [item.sourceProvider, item.sourceRef])];
  if (["august_works_memory_agent_tool", "august_works_post_run_extraction"].includes(item.sourceProvider)) {
    const match = /^run:\/\/[a-f0-9-]{36}\/issue\/([a-f0-9-]{36})$/i.exec(item.sourceRef);
    if (match) keys.push(memoryDeletionKey(companyId, "source", ["august_works_issue", `issue://${match[1]}`]));
  }
  return keys;
}

export async function assertMemoryOperationRetained(db: Db, companyId: string, operationId: string) {
  const [marker] = await db.select().from(memoryDeletionMarkers).where(and(eq(memoryDeletionMarkers.companyId, companyId),
    eq(memoryDeletionMarkers.key, memoryDeletionKey(companyId, "operation", operationId))));
  if (marker) throw conflict("This Memory operation was deleted and cannot be replayed", { code: "memory_operation_deleted" });
}

export async function assertMemorySourcesRetained(db: Db, companyId: string,
  evidence: Array<{ sourceProvider: string; sourceRef: string }>) {
  await lockMemoryPrivacy(db, companyId);
  if (!evidence.length) return;
  const keys = evidence.flatMap((item) => evidenceDeletionKeys(companyId, item));
  const [marker] = await db.select().from(memoryDeletionMarkers).where(and(eq(memoryDeletionMarkers.companyId, companyId),
    inArray(memoryDeletionMarkers.key, keys))).limit(1);
  if (marker) throw conflict("A deleted source cannot be captured into Memory", { code: "memory_source_deleted" });
}

/** Scrub a record and its correction/share lineage in the caller's transaction. */
export async function purgeMemoryRecords(db: Db, companyId: string, rootIds: string[], now = new Date()) {
  await lockMemoryPrivacy(db, companyId);
  const ids = new Set(rootIds);
  let frontier = rootIds;
  while (frontier.length) {
    const lineage = await db.select({ id: memoryRecords.id }).from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId),
      or(inArray(memoryRecords.supersedesRecordId, frontier), inArray(memoryRecords.supersededByRecordId, frontier),
        sql`${memoryRecords.sourceMemoryIds} && ARRAY[${sql.join(frontier.map(id=>sql`${id}::uuid`),sql`, `)}]::uuid[]`,
        sql`${memoryRecords.metadata} ->> 'promotedFromPrivateRecordId' in (${sql.join(frontier.map((id) => sql`${id}`), sql`, `)})`)));
    const evidence = await db.select({ id: memoryEvidence.memoryRecordId }).from(memoryEvidence).where(and(
      eq(memoryEvidence.companyId, companyId), inArray(memoryEvidence.sourceRef, frontier.flatMap((id) =>
        [`memory://private/${id}`, `memory://shared/${id}`, `memory://${id}`]))));
    frontier = [...lineage, ...evidence].map((row) => row.id).filter((id) => !ids.has(id));
    frontier.forEach((id) => ids.add(id));
  }
  if (!ids.size) return { deletedRecordIds: [] as string[], deletedRecordCount: 0 };
  const rows = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), inArray(memoryRecords.id, [...ids]))).for("update");
  for (const row of rows) {
    const markers: Array<typeof memoryDeletionMarkers.$inferInsert> = [
      { companyId, kind: "record", recordId: row.id, key: memoryDeletionKey(companyId, "record", row.id), deletedAt: now },
      ...[`memory://private/${row.id}`, `memory://shared/${row.id}`, `memory://${row.id}`].map((ref) => ({
        companyId, kind: "source" as const, key: memoryDeletionKey(companyId, "source", ["august_works_memory", ref]), deletedAt: now,
      })),
    ];
    if (row.createdByOperationId) markers.push({ companyId, kind: "operation",
      key: memoryDeletionKey(companyId, "operation", row.createdByOperationId), deletedAt: now });
    await db.insert(memoryDeletionMarkers).values(markers).onConflictDoNothing();
  }
  await db.delete(memoryEvidence).where(and(eq(memoryEvidence.companyId, companyId), inArray(memoryEvidence.memoryRecordId, [...ids])));
  await db.update(memoryRecords).set({ content: "", title: null, summary: null, subjectType: null, subjectId: null,
    metadata: {}, payloadSourceSnapshot: null, deletedAt: now, updatedAt: now, retentionState: "expired", reviewState: "rejected",
    revokedAt: null, revokedByActorType: null, revokedByActorId: null, revocationReason: null,
  }).where(and(eq(memoryRecords.companyId, companyId), inArray(memoryRecords.id, [...ids])));
  await db.update(memoryJobs).set({ sourceRefJson: {}, resultJson: null, resultSummary: null, error: null,
    updatedAt: now }).where(and(eq(memoryJobs.companyId, companyId), or(inArray(memoryJobs.sourceMemoryRecordId, [...ids]),
      sql`${memoryJobs.sourceRefJson}->'recordIds' ?| ARRAY[${sql.join([...ids].map((id) => sql`${id}`), sql`, `)}]::text[]`)));
  await purgeDerivedWorkflowMemory(db, companyId, [...ids], now);
  await invalidateCognitiveRecords(db, companyId, [...ids]);
  await invalidateDerivedMemory(db, companyId, [...ids], true);
  return { deletedRecordIds: rows.map((row) => row.id), deletedRecordCount: rows.filter((row) => !row.deletedAt).length };
}

export async function purgeDerivedWorkflowMemory(db: Db, companyId: string, recordIds: string[], now = new Date(),
  sourceAssets?:{workflowRevisionIds:string[];artifactVersionIds:string[];runIds?:string[];skillVersionIds?:string[]}) {
  if (!recordIds.length&&!sourceAssets?.workflowRevisionIds.length&&!sourceAssets?.artifactVersionIds.length&&!sourceAssets?.runIds?.length&&!sourceAssets?.skillVersionIds?.length) return;
  const evaluations = await db.select({ id: workflowOptimizerEvaluations.id, artifactId: workflowOptimizerEvaluations.artifactId }).from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, companyId),
    or(recordIds.length?sql`${workflowOptimizerEvaluations.memoryRecordIds} ?| ARRAY[${sql.join(recordIds.map((id) => sql`${id}`), sql`, `)}]::text[]`:undefined,sourceAssets?.artifactVersionIds.length?inArray(workflowOptimizerEvaluations.artifactVersionId,sourceAssets.artifactVersionIds):undefined)??sql`false`));
  if (evaluations.length) {
    const artifactIds = evaluations.map((row) => row.artifactId);
    await db.update(workflowOptimizerEvaluations).set({ status: "retired", compilerResult: null, replayEvaluation: null, shadowEvaluation: null, invariants: [], updatedAt: now })
      .where(and(eq(workflowOptimizerEvaluations.companyId, companyId), inArray(workflowOptimizerEvaluations.id, evaluations.map((row) => row.id))));
    await db.update(workflowOptimizerObservations).set({ shadowResult: null }).where(and(eq(workflowOptimizerObservations.companyId, companyId), inArray(workflowOptimizerObservations.evaluationId, evaluations.map(row => row.id))));
    await db.update(automationArtifacts).set({ status: "deprecated", archivedAt: now, name: "Erased optimizer candidate", description: null, updatedAt: now })
      .where(and(eq(automationArtifacts.companyId, companyId), inArray(automationArtifacts.id, artifactIds)));
    // Content erasure is the explicit privacy exception to immutable artifact payloads.
    // The original content hash remains as provenance; cleared gates prevent reuse.
    await db.update(automationArtifactVersions).set({ sourceCode: "", inputSchema: {}, outputSchema: {}, dependencyManifest: {}, testSpec: {}, validationReport: null, securityReport: null })
      .where(and(eq(automationArtifactVersions.companyId, companyId), or(recordIds.length?inArray(automationArtifactVersions.artifactId, artifactIds):undefined,sourceAssets?.artifactVersionIds.length?inArray(automationArtifactVersions.id,sourceAssets.artifactVersionIds):undefined)??sql`false`));
  }
  await db.update(workflowRunReviews).set({ correctedOutputs: {}, reason: "Source payload erased" }).where(and(eq(workflowRunReviews.companyId, companyId),
    sql`${workflowRunReviews.memoryRecordIds} ?| ARRAY[${sql.join(recordIds.map((id) => sql`${id}`), sql`, `)}]::text[]`));

  await db.execute(sql`select aw_erase_skill_harness_sources(${companyId}::uuid)`);
  const sourceWorkflowRuns = await db.select({ id: workflowRuns.id }).from(workflowRuns).where(and(
    eq(workflowRuns.companyId, companyId), sql`aw_workflow_run_authoring_source_erased(${companyId}::uuid,${workflowRuns.id})`,
    inArray(workflowRuns.status, ["queued", "running", "waiting", "recovering", "cancelling"]),
  ));
  if (sourceWorkflowRuns.length) {
    const { requestErasedWorkflowRunCancellation } = await import("../workflows/workflow-executor.js");
    for (const run of sourceWorkflowRuns) await requestErasedWorkflowRunCancellation(db, companyId, run.id);
  }
  // The Native workflow retains private authoring dependencies across all
  // later Human revisions. Erase before enumerating its descendant runs/tasks.
  await db.execute(sql`select aw_erase_workflow_authoring_sources(${companyId}::uuid)`);
  await db.execute(sql`select aw_erase_workflow_run_authoring_sources(${companyId}::uuid)`);
  const affected = await db.select().from(workflowStepRuns).where(and(eq(workflowStepRuns.companyId, companyId),
    or(sql`exists(select 1 from workflow_runs owner where owner.company_id=${companyId}::uuid and owner.id=${workflowStepRuns.workflowRunId}
      and aw_workflow_run_authoring_source_erased(${companyId}::uuid,owner.id))`,
      recordIds.length?sql`${workflowStepRuns.memoryRecordIds} ?| ARRAY[${sql.join(recordIds.map((id) => sql`${id}`), sql`, `)}]::text[]`:undefined,
      sourceAssets?.workflowRevisionIds.length?sql`exists(select 1 from ${workflowRuns} w where w.company_id=${companyId}::uuid and w.id=${workflowStepRuns.workflowRunId} and w.workflow_revision_id in (${sql.join(sourceAssets.workflowRevisionIds.map(id=>sql`${id}::uuid`),sql`, `)}))`:undefined,
      sourceAssets?.artifactVersionIds.length?sql`exists(select 1 from workflow_step_runs source_step
        where source_step.company_id=${companyId}::uuid and source_step.workflow_run_id=${workflowStepRuns.workflowRunId}
          and source_step.automation_artifact_version_id in (${sql.join(sourceAssets.artifactVersionIds.map(id=>sql`${id}::uuid`),sql`, `)}))`:undefined,
      sourceAssets?.runIds?.length?inArray(workflowStepRuns.heartbeatRunId,sourceAssets.runIds):undefined)??sql`false`));
  const contextRoots = await db.select({ runId: contextManifests.runId, issueId: contextManifests.issueId }).from(contextManifestMemoryRoots)
    .innerJoin(contextManifests, and(eq(contextManifests.companyId, contextManifestMemoryRoots.companyId), eq(contextManifests.id, contextManifestMemoryRoots.manifestId)))
    .where(and(eq(contextManifestMemoryRoots.companyId, companyId), inArray(contextManifestMemoryRoots.memoryRecordId, recordIds)));
  if (!affected.length && !contextRoots.length && !sourceAssets?.runIds?.length&&!sourceAssets?.skillVersionIds?.length) return;
  const children = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), sql`not (${heartbeatMemoryPayloadVisible()})`));
  const childIds = children.map((child) => child.id);
  const notificationProposals = childIds.length ? await db.select({id:notificationPreferenceProposals.id}).from(notificationPreferenceProposals)
    .where(and(eq(notificationPreferenceProposals.companyId,companyId),inArray(notificationPreferenceProposals.sourceRunId,childIds))) : [];
  if(notificationProposals.length){
    const ids=notificationProposals.map(row=>row.id);
    await db.update(notificationPreferenceProposals).set({preference:null,status:"erased",updatedAt:now})
      .where(and(eq(notificationPreferenceProposals.companyId,companyId),inArray(notificationPreferenceProposals.id,ids)));
    await db.update(activityLog).set({details:{payloadDeleted:true}}).where(and(eq(activityLog.companyId,companyId),
      eq(activityLog.entityType,"notification_preference_proposal"),inArray(activityLog.entityId,ids)));
  }
  const sourceFoundationProposals = childIds.length ? await db.select({ id: foundationChangeProposals.id }).from(foundationChangeProposals).where(and(
    eq(foundationChangeProposals.companyId,companyId),inArray(foundationChangeProposals.conversationSourceRunId,childIds),
  )) : [];
  if (sourceFoundationProposals.length) {
    const ids=sourceFoundationProposals.map(row=>row.id);
    await db.update(foundationChangeProposals).set({ proposedBody:"",changeSummary:null,reason:null,updatedAt:now })
      .where(and(eq(foundationChangeProposals.companyId,companyId),inArray(foundationChangeProposals.id,ids)));
    await db.update(activityLog).set({details:{payloadDeleted:true}}).where(and(eq(activityLog.companyId,companyId),
      eq(activityLog.entityType,"foundation_change_proposal"),inArray(activityLog.entityId,ids)));
    const copied=await db.select({id:documentRevisions.id,documentId:documentRevisions.documentId}).from(documentRevisions).where(and(
      eq(documentRevisions.companyId,companyId),sql`${documentRevisions.conversationFoundationProposalIds} ?| ARRAY[${sql.join(ids.map(id=>sql`${id}`),sql`, `)}]::text[]`,
    ));
    if(copied.length){
      const revisions=copied.map(row=>row.id),docIds=[...new Set(copied.map(row=>row.documentId))];
      await db.update(documentRevisions).set({title:null,body:"",changeSummary:null}).where(and(eq(documentRevisions.companyId,companyId),inArray(documentRevisions.id,revisions)));
      await db.update(foundationSections).set({headingPath:[],body:"",tokenCount:0}).where(and(eq(foundationSections.companyId,companyId),inArray(foundationSections.documentRevisionId,revisions)));
      await db.update(documents).set({title:null,latestBody:"",updatedAt:now}).where(and(eq(documents.companyId,companyId),inArray(documents.id,docIds),inArray(documents.latestRevisionId,revisions)));
      await eraseAnalyticalSourcesUnderMemory(db,companyId,"document",docIds,now);
    }
  }
  const sourceRoutines = childIds.length ? await db.select({ id: routines.id }).from(routines).where(and(
    eq(routines.companyId, companyId), eq(routines.originKind, "conversation_draft"), inArray(routines.originId, childIds),
  )) : [];
  if (sourceRoutines.length) {
    const routineIds = sourceRoutines.map(row => row.id);
    await db.update(activityLog).set({ details: { payloadDeleted: true } }).where(and(
      eq(activityLog.companyId, companyId), or(
        and(eq(activityLog.entityType, "routine"), inArray(activityLog.entityId, routineIds)),
        and(eq(activityLog.entityType, "routine_trigger"), sql`exists(select 1 from routine_triggers t
          where t.company_id=${companyId}::uuid and t.id::text=${activityLog.entityId}
            and t.routine_id in (${sql.join(routineIds.map(id => sql`${id}::uuid`), sql`, `)}))`),
      ),
    ));
    await db.update(routines).set({ title: "Source-erased routine", description: null, status: "paused", variables: [], env: null, updatedAt: now })
      .where(and(eq(routines.companyId, companyId), inArray(routines.id, routineIds)));
    await db.update(routineTriggers).set({ enabled: false, nextRunAt: null, updatedAt: now })
      .where(and(eq(routineTriggers.companyId, companyId), inArray(routineTriggers.routineId, routineIds)));
    await db.update(routineRevisions).set({ title: "Source-erased routine", description: null, changeSummary: null,
      snapshot: sql`jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(${routineRevisions.snapshot},'{routine,title}','"Source-erased routine"'::jsonb),'{routine,description}','null'::jsonb),'{routine,variables}','[]'::jsonb),'{routine,env}','null'::jsonb),'{routine,status}','"paused"'::jsonb),'{triggers}','[]'::jsonb)` })
      .where(and(eq(routineRevisions.companyId, companyId), inArray(routineRevisions.routineId, routineIds)));
    await db.update(routineRuns).set({ triggerPayload: null, failureReason: "source_erased", updatedAt: now })
      .where(and(eq(routineRuns.companyId, companyId), inArray(routineRuns.routineId, routineIds)));
    await db.delete(companySecretBindings).where(and(eq(companySecretBindings.companyId, companyId),
      eq(companySecretBindings.targetType, "routine"), inArray(companySecretBindings.targetId, routineIds)));
    const linked = await db.select({ id: routineDocuments.documentId }).from(routineDocuments).where(and(
      eq(routineDocuments.companyId, companyId), inArray(routineDocuments.routineId, routineIds)));
    if (linked.length) {
      const ids = linked.map(row => row.id); await eraseAnalyticalSourcesUnderMemory(db, companyId, "document", ids, now);
      await db.update(documents).set({ title: "Source-erased routine document", latestBody: "", updatedAt: now })
        .where(and(eq(documents.companyId, companyId), inArray(documents.id, ids)));
      await db.update(documentRevisions).set({ title: null, body: "", changeSummary: null })
        .where(and(eq(documentRevisions.companyId, companyId), inArray(documentRevisions.documentId, ids)));
    }
  }
  if(affected.length)await db.update(workflowRunReviews).set({correctedOutputs:{},reason:"Source payload erased"}).where(and(eq(workflowRunReviews.companyId,companyId),inArray(workflowRunReviews.workflowRunId,[...new Set(affected.map(row=>row.workflowRunId))])));
  if (childIds.length) {
    for (const child of children) {
      if (child.logRef && child.logStore === "local_file") {
        // Transactional outbox: content-free identities only, independent of
        // feature flags and retained after source-job payloads are erased.
        const jobKey = `run-log-erasure:v1:${child.id}`;
        await db.insert(memoryJobs).values({ companyId, operationType: "retention", jobKey,
          sourceRefJson: { kind: "run_log_erasure", runId: child.id, agentId: child.agentId, logRef: child.logRef } }).onConflictDoNothing();
        await db.update(memoryJobs).set({ status: "queued", finishedAt: null, resultJson: null, resultSummary: null, error: null, errorCode: null,
          sourceRefJson: { kind: "run_log_erasure", runId: child.id, agentId: child.agentId, logRef: child.logRef }, updatedAt: now })
          .where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.jobKey, jobKey), eq(memoryJobs.attemptNumber, 1),
            inArray(memoryJobs.status, ["succeeded", "failed", "cancelled"])));
      }
    }
    // Preserve erasure after a preparation run loses its copied Task context.
    // IDs only, selected by the original current-erasure predicate above.
    for (let offset = 0; offset < children.length; offset += 500) {
      await db.insert(memoryDeletionMarkers).values(children.slice(offset, offset + 500).map(child => ({ companyId, kind: "source" as const,
        key: `memory-run-source-erasure:v1:${child.id}`, deletedAt: now }))).onConflictDoNothing();
    }
    // Native trace guards scrub metadata and enqueue the existing file outbox.
    await db.update(agentExecutionManifests).set({manifest:sql`'{"payloadDeleted":true}'::jsonb`}).where(and(eq(agentExecutionManifests.companyId,companyId),inArray(agentExecutionManifests.runId,childIds)));
    await db.update(providerTraceRecords).set({reason:"source_erased",updatedAt:now}).where(and(eq(providerTraceRecords.companyId,companyId),inArray(providerTraceRecords.runId,childIds)));
    await db.update(saasRunLogs).set({ erasedAt: now, pendingBytes: 0, sha256: null }).where(and(eq(saasRunLogs.companyId, companyId), inArray(saasRunLogs.id, childIds)));
    await db.update(saasRunLogChunks).set({ ciphertext: null }).where(and(eq(saasRunLogChunks.companyId, companyId), inArray(saasRunLogChunks.runId, childIds)));
    await db.update(heartbeatRuns).set({ contextSnapshot: {}, resultJson: null, runnerProfileJson: {}, stdoutExcerpt: null,
      stderrExcerpt: null, error: null, logRef: null, logStore: null, logBytes: null, logSha256: null, updatedAt: now })
      .where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.id, childIds)));
    await db.update(nativeRunResults).set({ resultJson: { payloadDeleted: true } }).where(and(eq(nativeRunResults.companyId, companyId), inArray(nativeRunResults.runId, childIds)));
    await db.update(workAssessments).set({ assessmentJson: { payloadDeleted: true } }).where(and(eq(workAssessments.companyId, companyId), inArray(workAssessments.runId, childIds)));
    await db.update(statusDecisions).set({ decisionJson: { payloadDeleted: true } }).where(and(eq(statusDecisions.companyId, companyId), inArray(statusDecisions.runId, childIds)));
    await db.update(nativeRunFinalizations).set({ failureDetail: null, recoveryHistory: [] }).where(and(eq(nativeRunFinalizations.companyId, companyId), inArray(nativeRunFinalizations.runId, childIds)));
    await db.update(agentTaskSessions).set({ sessionParamsJson: null, sessionDisplayId: null, lastError: null, goalJson: null, goalCapabilityJson: null, updatedAt: now })
      .where(and(eq(agentTaskSessions.companyId, companyId), inArray(agentTaskSessions.lastRunId, childIds)));
    await db.update(agentRuntimeState).set({ stateJson: {}, sessionId: null, lastError: null, updatedAt: now })
      .where(and(eq(agentRuntimeState.companyId, companyId), inArray(agentRuntimeState.lastRunId, childIds)));
    await db.update(heartbeatRunEvents).set({ message: null, payload: null })
      .where(and(eq(heartbeatRunEvents.companyId, companyId), inArray(heartbeatRunEvents.runId, childIds)));
    const wakeIds = children.flatMap((child) => child.wakeupRequestId ? [child.wakeupRequestId] : []);
    if (wakeIds.length) await db.update(agentWakeupRequests).set({ payload: {}, error: null, updatedAt: now })
      .where(and(eq(agentWakeupRequests.companyId, companyId), inArray(agentWakeupRequests.id, wakeIds)));
    await db.update(activityLog).set({ details: { payloadDeleted: true } })
      .where(and(eq(activityLog.companyId, companyId), inArray(activityLog.runId, childIds)));
  }
  const childWaits = affected.length ? await db.select({ issueId: workflowWaits.referenceId }).from(workflowWaits).where(and(
    eq(workflowWaits.companyId, companyId), eq(workflowWaits.referenceType, "issue"),
    or(...affected.map((step) => and(eq(workflowWaits.workflowRunId, step.workflowRunId), eq(workflowWaits.nodeId, step.nodeId)))))) : [];
  const sourceRunContexts = sourceAssets?.runIds?.length ? await db.select({ issueId: contextManifests.issueId }).from(agentExecutionManifests)
    .innerJoin(contextManifests, and(eq(contextManifests.companyId, agentExecutionManifests.companyId), eq(contextManifests.id, agentExecutionManifests.contextManifestId)))
    .where(and(eq(agentExecutionManifests.companyId, companyId), inArray(agentExecutionManifests.runId, sourceAssets.runIds))) : [];
  const sourceRunIssues = sourceAssets?.runIds?.length ? children.filter(child => sourceAssets.runIds!.includes(child.id)).flatMap(child => child.nativeIssueId ? [child.nativeIssueId] : []) : [];
  const skillHarnessTasks=sourceAssets?.skillVersionIds?.length?await db.execute<{issue_id:string}>(sql`select distinct t.issue_id from company_skill_test_runs t where t.company_id=${companyId}::uuid and t.skill_version_id in (${sql.join(sourceAssets.skillVersionIds.map(id=>sql`${id}::uuid`),sql`, `)}) and aw_skill_harness_source_erased(t.company_id,t.skill_version_id,t.issue_id)`):[];
  const originWorkflowTasks = affected.length ? await db.select({ id: issues.id }).from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.originKind, "workflow_task"),
      inArray(issues.originRunId, [...new Set(affected.map(step => step.workflowRunId))]))) : [];
  // These tasks are separate saved Native results, not workflow_task rows.
  // Keep their Original origin IDs after receipt/context payloads are erased.
  const originNativeTasks = childIds.length ? await db.select({ id: issues.id }).from(issues).where(and(
    eq(issues.companyId, companyId), eq(issues.originKind, "manual"), inArray(issues.originRunId, childIds),
    sql`(${issues.originId} like 'paperclip-runner:create-task:%' or ${issues.originId} like 'paperclip-suggested-task:%')`,
  )) : [];
  // A routine execution can retain a copied description before it has its
  // own heartbeat. Scrub that actual task through the same Original owner.
  const originRoutineTasks = sourceRoutines.length ? await db.select({ id: issues.id }).from(issues).where(and(
    eq(issues.companyId, companyId), eq(issues.originKind, "routine_execution"),
    inArray(issues.originId, sourceRoutines.map(routine => routine.id)),
  )) : [];
  const issueIds = [...new Set([...originRoutineTasks.map(task => task.id),...originNativeTasks.map(task => task.id),...originWorkflowTasks.map(task => task.id),...skillHarnessTasks.map(task=>task.issue_id),...childWaits.flatMap((wait) => wait.issueId ? [wait.issueId] : []), ...contextRoots.flatMap((root) => root.issueId ? [root.issueId] : []),
    ...sourceRunContexts.flatMap(context => context.issueId ? [context.issueId] : []), ...sourceRunIssues])];
  if (issueIds.length) {
    await eraseAnalyticalSourcesUnderMemory(db, companyId, "issue", issueIds, now);
    for (const issueId of issueIds) await eraseBusinessEventObjectUnderMemory(db, companyId, "issue", issueId);
    await db.update(issues).set({ title: "Erased workflow task", description: null, updatedAt: now })
      .where(and(eq(issues.companyId, companyId), inArray(issues.id, issueIds)));
    await db.update(completionContracts).set({ contractJson: { payloadDeleted: true } }).where(and(eq(completionContracts.companyId, companyId), inArray(completionContracts.issueId, issueIds)));
    await db.update(issueWorkProducts).set({ title: "Erased workflow output", url: null, externalId: null, summary: null, metadata: {}, sourceTrust: null, updatedAt: now })
      .where(and(eq(issueWorkProducts.companyId, companyId), inArray(issueWorkProducts.issueId, issueIds)));
    await db.update(issueComments).set({ body: "Source payload erased", updatedAt: now })
      .where(and(eq(issueComments.companyId, companyId), inArray(issueComments.issueId, issueIds)));
    const linkedDocs = await db.select({ id: issueDocuments.documentId }).from(issueDocuments).where(and(
      eq(issueDocuments.companyId, companyId), inArray(issueDocuments.issueId, issueIds)));
    if (linkedDocs.length) {
      const ids = linkedDocs.map((doc) => doc.id);
      await eraseAnalyticalSourcesUnderMemory(db, companyId, "document", ids, now);
      await db.update(documents).set({ title: "Erased workflow document", latestBody: "", updatedAt: now })
        .where(and(eq(documents.companyId, companyId), inArray(documents.id, ids)));
      await db.update(documentRevisions).set({ title: null, body: "", changeSummary: null })
        .where(and(eq(documentRevisions.companyId, companyId), inArray(documentRevisions.documentId, ids)));
    }
  }
  if (!affected.length) return;
  await db.update(workflowStepRuns).set({ inputJson: null, outputJson: null, taskResultJson: null, errorMessage: null, updatedAt: now })
    .where(and(eq(workflowStepRuns.companyId, companyId), inArray(workflowStepRuns.id, affected.map((row) => row.id))));
  await db.update(workflowRuns).set({ triggerPayload: {}, updatedAt: now }).where(and(eq(workflowRuns.companyId, companyId),
    or(recordIds.length?sql`${workflowRuns.memoryRecordIds} ?| ARRAY[${sql.join(recordIds.map((id) => sql`${id}`), sql`, `)}]::text[]`:undefined,sourceAssets?.workflowRevisionIds.length?inArray(workflowRuns.workflowRevisionId,sourceAssets.workflowRevisionIds):undefined,
      sourceAssets?.artifactVersionIds.length?inArray(workflowRuns.id,[...new Set(affected.map(step=>step.workflowRunId))]):undefined)??sql`false`));
  await db.update(workflowWaits).set({ resolutionJson: null, updatedAt: now }).where(and(eq(workflowWaits.companyId, companyId),
    or(...affected.map((row) => and(eq(workflowWaits.workflowRunId, row.workflowRunId), eq(workflowWaits.nodeId, row.nodeId))))));
  const receiptIds = await db.select({ id: toolInvocations.id }).from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId),
    or(...affected.map((row) => and(eq(toolInvocations.workflowRunId, row.workflowRunId), eq(toolInvocations.workflowNodeId, row.nodeId))))));
  if (receiptIds.length) {
    const ids = receiptIds.map((row) => row.id);
    const reviews = await db.select({ interactionId: toolActionRequests.interactionId }).from(toolActionRequests).where(and(
      eq(toolActionRequests.companyId, companyId), inArray(toolActionRequests.invocationId, ids)));
    await db.update(toolInvocations).set({ workflowResultJson: null, argumentsSummary: null, resultSummary: null,
      errorMessage: null, updatedAt: now }).where(and(eq(toolInvocations.companyId, companyId), inArray(toolInvocations.id, ids)));
    await db.update(toolActionRequests).set({ signedArguments: null, canonicalArgumentsSummary: { summary: "Erased source payload", sizeBytes: 0 },
      previewMarkdown: null, updatedAt: now }).where(and(eq(toolActionRequests.companyId, companyId), inArray(toolActionRequests.invocationId, ids)));
    await db.update(toolActionRequests).set({ status: "cancelled", resolvedAt: now, updatedAt: now }).where(and(
      eq(toolActionRequests.companyId, companyId), inArray(toolActionRequests.invocationId, ids), inArray(toolActionRequests.status, ["pending", "approved"])));
    await db.update(toolCallEvents).set({ argumentsSummary: null, requestSummary: null, resultSummary: null,
      metadata: { payloadDeleted: true }, errorMessage: null }).where(and(eq(toolCallEvents.companyId, companyId), inArray(toolCallEvents.invocationId, ids)));
    const invocationPredicate = sql`(${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
    await db.update(toolAccessAuditEvents).set({ details: { payloadDeleted: true } }).where(and(eq(toolAccessAuditEvents.companyId, companyId),
      sql`${toolAccessAuditEvents.details} ->> 'invocationId' in ${invocationPredicate}`));
    await db.update(activityLog).set({ details: { payloadDeleted: true } }).where(and(eq(activityLog.companyId, companyId),
      sql`${activityLog.details} ->> 'invocationId' in ${invocationPredicate}`));
    const interactionIds = reviews.flatMap((review) => review.interactionId ? [review.interactionId] : []);
    if (interactionIds.length) await db.update(issueThreadInteractions).set({
      payload: sql`jsonb_set(jsonb_set(jsonb_set(${issueThreadInteractions.payload}, '{toolAction,argumentsSummaryJson}', '"Erased source payload"'),
        '{toolAction,previewMarkdown}', '"Source payload erased"'), '{detailsMarkdown}', '""')`,
      result: sql`case when ${issueThreadInteractions.result} is null then null else
        jsonb_set(jsonb_set(${issueThreadInteractions.result}, '{toolAction,resultSummary}', 'null'), '{toolAction,errorMessage}', 'null') end`,
      updatedAt: now,
    }).where(and(eq(issueThreadInteractions.companyId, companyId), inArray(issueThreadInteractions.id, interactionIds)));
  }
  await db.update(workflowRuns).set({ status: "cancelling", executionOwnerId: null, leaseExpiresAt: null, ownerHeartbeatAt: null,
    updatedAt: now }).where(and(eq(workflowRuns.companyId, companyId), inArray(workflowRuns.id, [...new Set(affected.map((row) => row.workflowRunId))]),
      inArray(workflowRuns.status, ["queued", "running", "waiting", "recovering"])));
}

/** Called in the source Task deletion transaction, even when Memory is off. */
export async function forgetMemoryForDeletedIssue(db: Db, companyId: string, issueId: string) {
  await lockMemoryPrivacy(db, companyId);
  await db.insert(memoryDeletionMarkers).values({ companyId, kind: "source",
    key: memoryDeletionKey(companyId, "source", ["august_works_issue", `issue://${issueId}`]) }).onConflictDoNothing();
  const roots = await db.select({ id: memoryEvidence.memoryRecordId }).from(memoryEvidence).where(and(
    eq(memoryEvidence.companyId, companyId), inArray(memoryEvidence.sourceProvider, ["august_works_memory_agent_tool", "august_works_post_run_extraction"]),
    sql`${memoryEvidence.sourceRef} like ${`run://%/issue/${issueId}`}`));
  const retained=await db.select({id:memoryRecords.id}).from(memoryRecords).where(and(eq(memoryRecords.companyId,companyId),
    sql`${issueId}::uuid=any(${memoryRecords.sourceIssueIds})`));
  return purgeMemoryRecords(db, companyId, [...new Set([...roots,...retained].map((row) => row.id))]);
}

export async function expireMemoryPayloads(db: Db, companyId: string, now: Date) {
  return db.transaction(async (tx) => {
    const scopedDb = tx as unknown as Db;
    await lockMemoryPrivacy(scopedDb, companyId);
    const [policy] = await scopedDb.select().from(memoryRetentionPolicies).where(eq(memoryRetentionPolicies.companyId, companyId));
    const due = await scopedDb.select({ id: memoryRecords.id }).from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId),
      isNull(memoryRecords.deletedAt), or(lte(memoryRecords.expiresAt, now),
        policy?.maxAgeDays ? lte(memoryRecords.observedAt, new Date(now.getTime() - policy.maxAgeDays * 86_400_000)) : undefined)));
    return purgeMemoryRecords(scopedDb, companyId, due.map((row) => row.id), now);
  });
}

export async function reapplyMemoryDeletionMarkers(db: Db, companyId: string) {
  return db.transaction(async (tx) => {
    const scopedDb = tx as unknown as Db;
    await lockMemoryPrivacy(scopedDb, companyId);
    const markers = await scopedDb.select().from(memoryDeletionMarkers).where(eq(memoryDeletionMarkers.companyId, companyId));
    const keys = new Set(markers.map((row) => row.key));
    const records = await scopedDb.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), isNull(memoryRecords.deletedAt)));
    const roots = records.filter((row) => keys.has(memoryDeletionKey(companyId, "record", row.id)) ||
      (row.createdByOperationId && keys.has(memoryDeletionKey(companyId, "operation", row.createdByOperationId)))).map((row) => row.id);
    const evidence = await scopedDb.select().from(memoryEvidence).where(eq(memoryEvidence.companyId, companyId));
    for (const item of evidence) {
      if (evidenceDeletionKeys(companyId, item).some((key) => keys.has(key))) roots.push(item.memoryRecordId);
    }
    const result = await purgeMemoryRecords(scopedDb, companyId, roots);
    await purgeDerivedWorkflowMemory(scopedDb, companyId, markers.flatMap((row) => row.recordId ? [row.recordId] : []));
    await invalidateCognitiveRecords(scopedDb, companyId, markers.flatMap((row) => row.recordId ? [row.recordId] : []));
    await invalidateDerivedMemory(scopedDb, companyId, markers.flatMap((row) => row.recordId ? [row.recordId] : []), true);
    return result;
  });
}
