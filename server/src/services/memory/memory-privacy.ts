import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, isNull, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { agentExecutionManifests, providerTraceRecords,
  memoryDeletionMarkers, memoryEvidence, memoryJobs, memoryRecords, memoryPrivateSharePublications, memoryRetentionPolicies,
  contextManifests, contextManifestItems, contextManifestMemoryRoots, saasRunLogs, saasRunLogChunks, activityLog, issueThreadInteractions, toolAccessAuditEvents, toolActionRequests, toolCallEvents, toolInvocations,
  heartbeatRuns, heartbeatRunEvents, agentWakeupRequests, agents, authUsers, issues, issueComments, issueDocuments, documents, documentRevisions,
  nativeRunResults, workAssessments, statusDecisions, nativeRunFinalizations, completionContracts, issueWorkProducts, agentTaskSessions, agentRuntimeState,
  workflowRuns, workflowStepRuns, workflowWaits, workflowRunReviews, workflowOptimizerEvaluations, workflowOptimizerObservations, automationArtifacts, automationArtifactVersions, issuePrivacySources, companyDeletionOperations, type Db } from "@paperclipai/db";
import { notificationPreferenceProposals, foundationChangeProposals, foundationSections, routines, routineRevisions, routineTriggers, routineDocuments, routineRuns, companySecretBindings, memoryBindings, memoryBindingTargets } from "@paperclipai/db";
import { eraseAnalyticalSourcesUnderMemory } from "../analytical-source-erasure.js";
import { eraseBusinessEventObjectUnderMemory } from "../business-event-payload-erasure.js";
import { conflict, forbidden, HttpError } from "../../errors.js";
import { nativePayloadSourceSnapshotSchema, type MemoryCandidateInputParsed } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { agentAuthoringTestMemorySourceReadActive } from "../agents/authoring-test-memory-source-scope.js";
import { invalidateCognitiveRecords } from "./cognitive-privacy.js";
import { invalidateDerivedMemory } from "./derived-privacy.js";

export function memoryDeletionKey(companyId: string, kind: "record" | "operation" | "source", value: unknown) {
  return createHash("sha256").update(JSON.stringify([companyId, kind, value])).digest("hex");
}

export async function lockMemoryPrivacy(db: Db, companyId: string, mode: "read" | "write" = "write") {
  if (mode === "read") {
    await db.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${`memory:privacy:${companyId}`}, 0))`);
    return;
  }
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
type MemorySourceReadBudget = { signal?: AbortSignal; deadlineAt?: number; forbiddenRecordId?: string };
type MemorySourceReadScope = { active:Set<string>;deadline:number;work:number;signal?:AbortSignal;
  /** Set only while one bounded source-set read has checked the same live actor
   * before and after all of its owner rows. Never retained across operations. */
  batchAdmittedActors?:Set<string> };
function assertMemorySourceReadActive(state: MemorySourceReadScope) {
  if (state.signal?.aborted) throw state.signal.reason ?? new Error("Memory source read was cancelled");
  if (performance.now() > state.deadline) throw new Error("Memory source read deadline exceeded");
}
const memorySourceReads=new AsyncLocalStorage<MemorySourceReadScope>();
let nativeMemorySourceFailureDiagnostics = 0;
type NativeMemorySourceFailureStage = "source_owner" | "source_snapshot" | "private_owner" | "agent_scope" |
  "ancestor_retention" | "root_shape" | "human_evidence" | "snapshot_binding" | "published_share" |
  "nested_source" | "run_reader" | "task_reader" | "memory_temporal_reader" | "project_reader" |
  "foundation_reader" | "foundation_source" | "source_deadline" | "source_cycle" | "source_budget";
export function memoryShareContentFingerprint(record:typeof memoryRecords.$inferSelect):string {
  return createHash("sha256").update(JSON.stringify({
    companyId:record.companyId,bindingId:record.bindingId,memoryType:record.memoryType,scopeType:record.scopeType,scopeId:record.scopeId,
    subjectType:record.subjectType,subjectId:record.subjectId,ownerAgentId:record.ownerAgentId,title:record.title,content:record.content,
    summary:record.summary,sensitivityLabel:record.sensitivityLabel,importance:record.importance,confidenceScore:record.confidenceScore,
    validFrom:record.validFrom?.toISOString()??null,validUntil:record.validUntil?.toISOString()??null,observedAt:record.observedAt.toISOString(),
    retentionPolicy:record.retentionPolicy,expiresAt:record.expiresAt?.toISOString()??null,
  })).digest("hex");
}
export async function canActorReadMemorySources(db: Db, companyId: string, actor: AuthorizationActor | undefined, recordId: string,
  budget: MemorySourceReadBudget = {}):Promise<boolean> {
  const inherited=memorySourceReads.getStore(),state=inherited??{active:new Set<string>(),deadline:performance.now()+8000,work:0,
    ...(budget.signal ? { signal: budget.signal } : {})};
  const diagnosticDenied = (reason: NativeMemorySourceFailureStage | "scope_guard" | "cycle" | "deadline" | "work_budget") => {
    if (process.env.PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS === "1" && nativeMemorySourceFailureDiagnostics < 8) {
      nativeMemorySourceFailureDiagnostics += 1;
      console.error("native_memory_source_access_test_denial", JSON.stringify({ reason, inherited: Boolean(inherited),
        activeCount: state.active.size, work: state.work, deadlineExpired: performance.now() > state.deadline,
        signalAborted: state.signal?.aborted ?? false }));
    }
  };
  if (budget.deadlineAt !== undefined) state.deadline = Math.min(state.deadline, performance.now() + Math.max(0, budget.deadlineAt - Date.now()));
  if (budget.signal && !state.signal) state.signal = budget.signal;
  try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("scope_guard"); return false; }
  const key=`${companyId}:${recordId}`;
  if(state.active.has(key)) { diagnosticDenied("cycle"); return false; }
  if(performance.now()>state.deadline) { diagnosticDenied("deadline"); return false; }
  if(state.work>=256) { diagnosticDenied("work_budget"); return false; }
  const read=async()=>{
    state.active.add(key);
    const actorKey=actor?`${companyId}:${createHash("sha256").update(JSON.stringify(actor)).digest("hex")}`:"";
    const skipActorAdmission=Boolean(actorKey&&state.batchAdmittedActors?.has(actorKey));
    try{return await inspectMemorySourceAccess(db,companyId,actor,recordId,state,diagnosticDenied,budget.forbiddenRecordId,
      skipActorAdmission);}
    finally{state.active.delete(key);}
  };
  return inherited?read():memorySourceReads.run(state,read);
}
/** Revalidates a bounded union through the original recursive source reader.
 * A forbidden target is used only for a staged write that may add these roots
 * beneath that target; reaching it would create a cycle after commit. */
export async function canActorReadMemorySourceSet(db: Db, companyId: string, actor: AuthorizationActor | undefined,
  recordIds: readonly string[], forbiddenRecordId?: string): Promise<boolean> {
  const inherited=memorySourceReads.getStore(),state=inherited??{active:new Set<string>(),deadline:performance.now()+8000,work:0};
  const inspect=async()=>{
    const ids=[...new Set(recordIds)].sort();
    if(ids.length>256 || (forbiddenRecordId && ids.includes(forbiddenRecordId)))return false;
    if(!ids.length)return true;
    const actorKey=actor?`${companyId}:${createHash("sha256").update(JSON.stringify(actor)).digest("hex")}`:"";
    // Native Context readers often have several independently retained Memory
    // roots. Check the live Human/Agent/company ACL once on each side of that
    // bounded set, after all per-root provenance checks have run. This keeps
    // currentness inside this read while avoiding repeating the same principal
    // lookup around every root. Legacy authoring-test actors have no live run;
    // they retain the individual per-root authority path below.
    try{assertMemorySourceReadActive(state);}catch{return false;}
    const batchAdmission=Boolean(actor&&await memorySourceActorCurrent(db,companyId,actor));
    if(!batchAdmission){
      // Legacy authoring-test actors use root-specific admission evidence and
      // cannot share one principal admission across this set.
      for(const id of ids){
        try{assertMemorySourceReadActive(state);}catch{return false;}
        if(!await canActorReadMemorySources(db,companyId,actor,id,forbiddenRecordId?{forbiddenRecordId}:{}))return false;
      }
      return true;
    }
    const priorAdmission=Boolean(actorKey&&state.batchAdmittedActors?.has(actorKey));
    if(batchAdmission&&actorKey){
      state.batchAdmittedActors??=new Set();
      state.batchAdmittedActors.add(actorKey);
    }
    try {
      try{assertMemorySourceReadActive(state);}catch{return false;}
      if(!await inspectMemorySourceAccess(db,companyId,actor,ids,state,reason=>{
        if (process.env.PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS === "1" && nativeMemorySourceFailureDiagnostics < 8) {
          nativeMemorySourceFailureDiagnostics += 1;
          console.error("native_memory_source_access_test_denial", JSON.stringify({ reason, inherited: Boolean(inherited),
            activeCount: state.active.size, work: state.work, deadlineExpired: performance.now() > state.deadline,
            signalAborted: state.signal?.aborted ?? false }));
        }
      },forbiddenRecordId,true))return false;
      return batchAdmission?await memorySourceActorCurrent(db,companyId,actor):true;
    } finally {
      if(batchAdmission&&actorKey&&!priorAdmission)state.batchAdmittedActors?.delete(actorKey);
    }
  };
  return inherited?inspect():memorySourceReads.run(state,inspect);
}
async function memorySourceActorCurrent(db:Db,companyId:string,actor:AuthorizationActor|undefined,sourceRootId?:string):Promise<boolean> {
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
    if (!run && !agentAuthoringTestMemorySourceReadActive(companyId, actor, sourceRootId)) {
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
async function inspectMemorySourceAccess(db:Db,companyId:string,actor:AuthorizationActor|undefined,recordIds:string|readonly string[],
  state:MemorySourceReadScope,diagnosticDenied:(reason:NativeMemorySourceFailureStage|"scope_guard"|"cycle"|"deadline"|"work_budget")=>void,
  forbiddenRecordId?:string,skipActorAdmission=false):Promise<boolean> {
  if (!actor) { diagnosticDenied("source_owner"); return false; }
  const { authorizationService, canActorReadIssuePrivacy, canActorReadIssuePrivacyBatch,
    canActorReadProjectPrivacy, canActorReadHeartbeatRunPrivacy } = await import("../authorization.js");
  const roots = typeof recordIds === "string" ? [recordIds] : [...new Set(recordIds)].sort();
  if (!roots.length || roots.length > 256) { diagnosticDenied("source_budget"); return false; }
  const admitted = () => memorySourceActorCurrent(db,companyId,actor,roots[0]);
  if (!skipActorAdmission&&!await admitted()) { diagnosticDenied("source_owner"); return false; }
  const active = new Set<string>(), visited = new Set<string>();
  const runChecks = new Map<string, Map<string, string | null>>(), taskChecks = new Map<string, Map<string, string | null>>();
  const qualifiedOutputMemoryIds = new Set<string>();
  const qualifiedOutputMemoryExpectations = new Map<string, { sourceVersion: string; snapshot: unknown; issueIds: string[];
    projectIds: string[]; runIds: string[]; memoryIds: string[]; foundationRevisionIds: string[] }>();
  const projectIds = new Set<string>(), revisions = new Set<string>();
  const addScoped = (map:Map<string,Map<string,string|null>>,id:string,ownerId:string,contextIds:string[]|null) => {
    let values=map.get(id);if(!values){values=new Map();map.set(id,values);}values.set(ownerId,contextIds===null?null:JSON.stringify(contextIds));
  };
  const deadline = state.deadline;
  const visit = async (id:string,ancestor=false,authorizedPrivateOwnerEdge=false):Promise<boolean> => {
    try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("scope_guard"); return false; }
    if (id===forbiddenRecordId) { diagnosticDenied("cycle"); return false; }
    if (active.has(id)) { diagnosticDenied("cycle"); return false; }
    if (performance.now()>deadline) { diagnosticDenied("deadline"); return false; }
    if (visited.size>=256 || state.work>=256) { diagnosticDenied("work_budget"); return false; }
    // A row reached through the exact published edge is not equivalent to the
    // same row reached as a sibling source. Cache the edge context, never only
    // the record ID, or an allowed path could mask a forbidden direct path.
    const visitKey=`${id}:${ancestor?"ancestor":"root"}:${authorizedPrivateOwnerEdge?"published-edge":"ordinary-edge"}`;
    if (visited.has(visitKey)) return true;
    state.work++;
    const [row] = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId,companyId),eq(memoryRecords.id,id),memoryPayloadVisible()))
      .for("share");
    if (!row?.sourceProvenanceQualified || (row.expiresAt && row.expiresAt.getTime()<=Date.now())) { diagnosticDenied("source_owner"); return false; }
    if (row.payloadSourceProtocolVersion === 1 && row.payloadSourceSnapshot === null) { diagnosticDenied("source_snapshot"); return false; }
    const publicationSource=authorizedPrivateOwnerEdge;
    const readerUserId=actor.type==="board"?actor.userId:actor.onBehalfOfUserId;
    // A run may legitimately change Human after acknowledged steering. Its
    // current identity cannot transfer an earlier private Memory to that Human.
    if((row.scopeType==="agent" && !row.privateOwnerUserId)
      || (row.privateOwnerUserId && row.privateOwnerUserId!==readerUserId && !publicationSource)) {
      if (process.env.PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS === "1")
        console.error("native_memory_source_access_test_denial", JSON.stringify({ reason: "private_owner_mismatch",
          actorType: actor.type, actorHasReaderUser: Boolean(readerUserId), privateOwnerMatchesReader: row.privateOwnerUserId === readerUserId,
          publicationSource, agentScopeMissingOwner: row.scopeType === "agent" && !row.privateOwnerUserId }));
      diagnosticDenied("private_owner"); return false;
    }
    if(row.scopeType==="agent" && actor.type==="agent"
      && (row.ownerAgentId!==actor.agentId || row.scopeId!==actor.agentId) && !publicationSource) { diagnosticDenied("agent_scope"); return false; }
    if(ancestor && (row.revokedAt || row.retentionState==="expired" || row.validUntil && row.validUntil.getTime()<=Date.now())) { diagnosticDenied("ancestor_retention"); return false; }
    const ids = [...row.sourceRunIds,...row.sourceIssueIds,...row.sourceProjectIds,...row.sourceMemoryIds,...row.sourceFoundationRevisionIds];
    if (ids.length>256 || ids.some(value=>typeof value!=="string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))) { diagnosticDenied("root_shape"); return false; }
    if (row.createdByActorType === "user" && row.sourceIssueIds.length && row.sourceMemoryIds.length === 0) {
      const evidenceRows = await db.select({ sourceRef: memoryEvidence.sourceRef, sourceProvider: memoryEvidence.sourceProvider,
        sourceType: memoryEvidence.sourceType, sourceVersion: memoryEvidence.sourceVersion, sourceUpdatedAt: memoryEvidence.sourceUpdatedAt })
        .from(memoryEvidence).where(and(eq(memoryEvidence.companyId, companyId), eq(memoryEvidence.memoryRecordId, row.id),
          eq(memoryEvidence.sourceClass, "task")));
      const versions = new Map<string, string>();
      for (const item of evidenceRows) {
        if (item.sourceProvider !== "august_works_tasks" || item.sourceType !== "issue") { diagnosticDenied("human_evidence"); return false; }
        const ref = /^issue:\/\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(item.sourceRef);
        if (!ref || !item.sourceVersion || item.sourceUpdatedAt?.toISOString() !== item.sourceVersion) { diagnosticDenied("human_evidence"); return false; }
        const previous = versions.get(ref[1]!);
        if (previous && previous !== item.sourceVersion) { diagnosticDenied("human_evidence"); return false; }
        versions.set(ref[1]!, item.sourceVersion);
      }
      if (versions.size !== new Set(row.sourceIssueIds).size || row.sourceIssueIds.some(issueId => !versions.has(issueId)))
        { diagnosticDenied("human_evidence"); return false; }
      for (const [issueId, version] of versions) {
        const [issue] = await db.select({ updatedAt: issues.updatedAt }).from(issues).where(and(
          eq(issues.companyId, companyId), eq(issues.id, issueId),
        )).for("share");
        if (!issue || issue.updatedAt.toISOString() !== version) { diagnosticDenied("human_evidence"); return false; }
      }
    }
    visited.add(visitKey);active.add(id);
    const capturedSnapshot=nativePayloadSourceSnapshotSchema.safeParse(row.payloadSourceSnapshot);
    let capturedContextIds: string[] | null = null;
    let capturedReadRunIds = row.sourceRunIds;
    const rawSnapshot = row.payloadSourceSnapshot && typeof row.payloadSourceSnapshot === "object" && !Array.isArray(row.payloadSourceSnapshot)
      ? row.payloadSourceSnapshot as Record<string, unknown> : null;
    const rawInputs = Array.isArray(rawSnapshot?.inputs) ? rawSnapshot.inputs : [];
    const claimsModelOutput = rawInputs.some(value => value && typeof value === "object" && !Array.isArray(value) &&
      ["worker_model_dispatch", "conversation_model_dispatch"].includes(String((value as Record<string, unknown>).kind)));
    if (row.payloadSourceProtocolVersion === 1 && claimsModelOutput && (!capturedSnapshot.success || row.payloadSourceSnapshotInvalidated ||
      capturedSnapshot.data.owner.kind !== "memory_record" || capturedSnapshot.data.owner.companyId !== companyId ||
      capturedSnapshot.data.owner.id !== row.id)) { diagnosticDenied("snapshot_binding"); return false; }
    if (capturedSnapshot.success && row.payloadSourceProtocolVersion===1 && !row.payloadSourceSnapshotInvalidated &&
      capturedSnapshot.data.owner.kind==="memory_record" && capturedSnapshot.data.owner.companyId===companyId &&
      capturedSnapshot.data.owner.id===row.id) {
      const dispatches = capturedSnapshot.data.inputs.flatMap((value, index) =>
        value.kind === "worker_model_dispatch" || value.kind === "conversation_model_dispatch" ? [{ value, index }] : []);
      const dispatch = dispatches.at(-1)?.value;
      const expectedRunIds = dispatch
        ? [...new Set([...capturedSnapshot.data.policy.runIds, dispatch.runId])].sort()
        : row.sourceRunIds;
      const exactPolicy = isDeepStrictEqual(capturedSnapshot.data.policy.issueIds,[...row.sourceIssueIds].sort()) &&
        isDeepStrictEqual(capturedSnapshot.data.policy.projectIds,[...row.sourceProjectIds].sort()) &&
        isDeepStrictEqual([...row.sourceRunIds].sort(),expectedRunIds) &&
        isDeepStrictEqual(capturedSnapshot.data.policy.memoryIds,[...row.sourceMemoryIds].sort()) &&
        isDeepStrictEqual(capturedSnapshot.data.policy.foundationRevisionIds,[...row.sourceFoundationRevisionIds].sort());
      if (dispatch) {
        // A dispatch-qualified model output is readable only through the
        // exact body-bound model/tool receipt. Falling back to legacy Run ACL
        // would turn invalid provenance into broad read authority.
        const dispatchAtEnd = dispatches.at(-1)!.index === capturedSnapshot.data.inputs.length - 1;
        const uniqueDispatch = dispatches.filter(value => isDeepStrictEqual(value.value, dispatch)).length === 1;
        if (!exactPolicy || dispatches.length > 64 || !dispatchAtEnd || !actor || !uniqueDispatch) {
          if (process.env.PAPERCLIP_NATIVE_TEST_TOOL_RESULT_DIAGNOSTICS === "1")
            console.error("native_memory_source_access_test_denial", JSON.stringify({ reason: "output_snapshot_binding",
              exactPolicy, dispatchCount: dispatches.length, dispatchAtEnd, actorPresent: Boolean(actor), uniqueDispatch }));
          diagnosticDenied("snapshot_binding"); return false;
        }
        // The complete frozen proof is performed once inside the single
        // withReadMemoryTemporalSources callback below, together with every
        // selected Task/Run current-reader check for this owner. The row stays
        // shared-locked from this structural read until that proof completes.
        qualifiedOutputMemoryIds.add(row.id);
        qualifiedOutputMemoryExpectations.set(row.id, { sourceVersion: row.updatedAt.toISOString(), snapshot: row.payloadSourceSnapshot,
          issueIds: [...row.sourceIssueIds], projectIds: [...row.sourceProjectIds], runIds: [...row.sourceRunIds],
          memoryIds: [...row.sourceMemoryIds], foundationRevisionIds: [...row.sourceFoundationRevisionIds] });
        capturedContextIds = capturedSnapshot.data.inputs.filter((value): value is Extract<typeof value, { kind: "context" }> =>
          value.kind === "context").map(value => value.manifestId).sort();
        capturedReadRunIds = capturedSnapshot.data.policy.runIds;
      } else if (exactPolicy && !dispatch && capturedSnapshot.data.policy.runIds.length > 0 &&
        capturedSnapshot.data.inputs.every(value => value.kind === "context")) {
        capturedContextIds = capturedSnapshot.data.inputs.map(value => value.kind === "context" ? value.manifestId : "").sort();
      }
    }
    capturedReadRunIds.forEach(value=>addScoped(runChecks,value,row.id,capturedContextIds));
    row.sourceIssueIds.forEach(value=>addScoped(taskChecks,value,row.id,capturedContextIds));
    row.sourceProjectIds.forEach(value=>projectIds.add(value));row.sourceFoundationRevisionIds.forEach(value=>revisions.add(value));
    if (row.scopeType==="project") {
      if (!row.scopeId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.scopeId)) { diagnosticDenied("root_shape"); return false; }
      projectIds.add(row.scopeId);
    }
    const publishedSourceId=await publishedShareSourceEdge(db,companyId,row);
    if(publishedSourceId===false) { diagnosticDenied("published_share"); return false; }
    for (const source of row.sourceMemoryIds) {
      try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("source_deadline"); return false; }
      if (!await visit(source,true,source===publishedSourceId)) { diagnosticDenied("nested_source"); return false; }
    }
    active.delete(id);
    const scopedReads=[...runChecks.values(),...taskChecks.values()].reduce((count,scopes)=>count+scopes.size,0);
    if (visited.size+scopedReads+projectIds.size+revisions.size>256) { diagnosticDenied("source_budget"); return false; }
    return true;
  };
  for (const rootId of roots) {
    try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("scope_guard"); return false; }
    if (!await visit(rootId)) { diagnosticDenied("nested_source"); return false; }
  }
  const {withReadMemoryTemporalSources}=await import("../authorization.js");
  const {canActorReadNativeTaskSource}=await import("../native-direct-input.js");
  const temporalOwnerChecks = new Map<string, { runs: string[]; tasks: string[] }>();
  const unscopedTaskChecks: string[] = [];
  const temporalChecksFor = (ownerId: string) => {
    let checks = temporalOwnerChecks.get(ownerId);
    if (!checks) { checks = { runs: [], tasks: [] }; temporalOwnerChecks.set(ownerId, checks); }
    return checks;
  };
  for (const [id,owners] of runChecks) for (const [ownerId,encoded] of owners) {
    try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("source_deadline"); return false; }
    if (encoded === null) {
      if (performance.now()>deadline || !await canActorReadHeartbeatRunPrivacy(db,actor,{companyId,id})) { diagnosticDenied("run_reader"); return false; }
    } else temporalChecksFor(ownerId).runs.push(id);
  }
  for (const [id,owners] of taskChecks) for (const [ownerId,encoded] of owners) {
    try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("source_deadline"); return false; }
    if (encoded === null) {
      if (performance.now()>deadline) { diagnosticDenied("task_reader"); return false; }
      unscopedTaskChecks.push(id);
    } else temporalChecksFor(ownerId).tasks.push(id);
  }
  if (unscopedTaskChecks.length) {
    try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("source_deadline"); return false; }
    const readers = await canActorReadIssuePrivacyBatch(db, actor, companyId, unscopedTaskChecks);
    const deniedIds = unscopedTaskChecks.filter(id=>readers.get(id)!==true);
    if (performance.now()>deadline || deniedIds.length) {
      diagnosticDenied("task_reader"); return false;
    }
  }
  for (const ownerId of new Set([...qualifiedOutputMemoryIds, ...temporalOwnerChecks.keys()])) {
    try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("source_deadline"); return false; }
    const checks = temporalOwnerChecks.get(ownerId) ?? { runs: [], tasks: [] };
    const allowed = await withReadMemoryTemporalSources(db,actor,companyId,ownerId,async sourceDb => {
      for (const id of checks.runs) {
        try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("source_deadline"); return false; }
        if (!await canActorReadHeartbeatRunPrivacy(sourceDb,actor,{companyId,id})) { diagnosticDenied("run_reader"); return false; }
      }
      const currentTaskAclChecks: string[] = [];
      for (const id of checks.tasks) {
        try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("source_deadline"); return false; }
        const nativeAllowed = await canActorReadNativeTaskSource(sourceDb, { companyId, actor, issueId: id });
        if (nativeAllowed === false) {
          diagnosticDenied("task_reader"); return false;
        }
        if (nativeAllowed === null) currentTaskAclChecks.push(id);
      }
      if (currentTaskAclChecks.length) {
        try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("source_deadline"); return false; }
        const readers = await canActorReadIssuePrivacyBatch(sourceDb, actor, companyId, currentTaskAclChecks);
        const deniedIds = currentTaskAclChecks.filter(id=>readers.get(id)!==true);
        if (performance.now()>deadline || deniedIds.length) {
          diagnosticDenied("task_reader"); return false;
        }
      }
      return true;
    }, qualifiedOutputMemoryExpectations.get(ownerId));
    if (!allowed) { diagnosticDenied("memory_temporal_reader"); return false; }
  }
  for (const id of projectIds) {
    try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("source_deadline"); return false; }
    if (performance.now()>deadline || !await canActorReadProjectPrivacy(db,actor,{companyId,id})) { diagnosticDenied("project_reader"); return false; }
  }
  if (revisions.size) {
    if (!(await authorizationService(db).decide({actor,action:"foundation:read",resource:{type:"company",companyId},enforceResponsibleUserIntersection:true})).allowed) { diagnosticDenied("foundation_reader"); return false; }
    const {assertLearnedAssetAnalyticalSources} = await import("../learning/learning-analytical-sources.js");
    for (const id of revisions) {
      try { assertMemorySourceReadActive(state); } catch { diagnosticDenied("source_deadline"); return false; }
      if (performance.now()>deadline) { diagnosticDenied("source_deadline"); return false; }
      const [source] = await db.select({id:documentRevisions.id}).from(documentRevisions).where(and(eq(documentRevisions.companyId,companyId),eq(documentRevisions.id,id)));
      if (!source) { diagnosticDenied("foundation_source"); return false; }
      try {await assertLearnedAssetAnalyticalSources(db,companyId,"document_revision",id,actor,"task");}
      catch(error){if(error instanceof HttpError && [403,404,409,422].includes(error.status)){diagnosticDenied("foundation_source");return false;}throw error;}
    }
  }
  if (performance.now()>deadline) { diagnosticDenied("source_deadline"); return false; }
  if (!skipActorAdmission&&!await admitted()) { diagnosticDenied("source_owner"); return false; }
  return true;
}

/** Grants one edge only when the exact share payload, source version, owner
 * acceptance, and live target binding still match their internal receipt. */
async function publishedShareSourceEdge(db:Db,companyId:string,row:typeof memoryRecords.$inferSelect):Promise<string|null|false> {
  const [receipt]=await db.select().from(memoryPrivateSharePublications).where(and(
    eq(memoryPrivateSharePublications.companyId,companyId),eq(memoryPrivateSharePublications.sharedRecordId,row.id),
    eq(memoryPrivateSharePublications.state,"published")));
  if(!receipt)return null;
  if(row.sourceMemoryIds.length!==1||row.sourceMemoryIds[0]!==receipt.sourceRecordId)return false;
  const [source]=await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId,companyId),
    eq(memoryRecords.id,receipt.sourceRecordId),memoryPayloadVisible()));
  const [binding]=await db.select().from(memoryBindings).where(and(eq(memoryBindings.companyId,companyId),eq(memoryBindings.id,receipt.targetBindingId)));
  if(!source||!binding)return false;
  const targets=await db.select().from(memoryBindingTargets).where(and(eq(memoryBindingTargets.companyId,companyId),eq(memoryBindingTargets.bindingId,binding.id)));
  const authorizedTarget=targets.some(target=>(target.targetType==="company"&&target.targetId===companyId
    &&(row.scopeType==="company"||row.scopeType==="subject"))
    ||(target.targetType==="project"&&row.scopeType==="project"&&target.targetId===row.scopeId));
  const evidence=await db.select({id:memoryEvidence.id}).from(memoryEvidence).where(and(
    eq(memoryEvidence.companyId,companyId),eq(memoryEvidence.memoryRecordId,row.id),
    eq(memoryEvidence.sourceProvider,"august_works_memory"),eq(memoryEvidence.sourceRef,`memory://private/${source.id}`),
    eq(memoryEvidence.sourceVersion,receipt.sourceVersion),eq(memoryEvidence.excerptHash,createHash("sha256").update(source.content).digest("hex")),
  )).limit(2);
  const now=Date.now();
  if(receipt.sourceOwnerUserId===null||receipt.publishedByUserId!==receipt.sourceOwnerUserId||!receipt.publishedAt
    ||receipt.sourceRecordId===row.id||source.scopeType!=="agent"||source.privateOwnerUserId!==receipt.sourceOwnerUserId
    ||source.updatedAt.toISOString()!==receipt.sourceVersion||memoryShareContentFingerprint(source)!==receipt.sourceFingerprint
    ||source.reviewState!=="accepted"||source.retentionState!=="active"||source.revokedAt||source.supersededByRecordId
    ||(source.validFrom&&source.validFrom.getTime()>now)||(source.validUntil&&source.validUntil.getTime()<=now)
    ||(source.expiresAt&&source.expiresAt.getTime()<=now)||row.reviewState!=="accepted"
    ||row.scopeType!==receipt.targetScopeType||row.scopeId!==receipt.targetScopeId||row.bindingId!==receipt.targetBindingId
    ||!binding.enabled||!authorizedTarget||memoryShareContentFingerprint(row)!==receipt.sharedFingerprint||evidence.length!==1)return false;
  return source.id;
}

/** Only actual producer/run and persisted Context owners stamp these columns.
 * Caller citations and metadata never qualify a producer or remove a source. */
export async function captureMemorySources(db: Db, companyId: string, actor: AuthorizationActor | undefined,
  scope:{type:string;id:string|null}, sourceMemoryIds:string[] = [],
  evidence:MemoryCandidateInputParsed["evidence"] = []) {
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
  } else if (actor.type==="board") {
    const {canActorReadIssuePrivacy} = await import("../authorization.js");
    for (const item of evidence) {
      if (item.sourceClass !== "task") continue;
      const ref = /^issue:\/\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(item.sourceRef);
      if (item.sourceProvider !== "august_works_tasks" || item.sourceType !== "issue" || !ref ||
        !item.sourceVersion || item.sourceUpdatedAt !== item.sourceVersion) {
        throw forbidden("Human Memory Task evidence is unavailable");
      }
      const issueId = ref[1]!;
      const [issue] = await db.select({ id: issues.id, updatedAt: issues.updatedAt,
        privacyParentIssueId: issues.privacyParentIssueId, privacyRootIssueId: issues.privacyRootIssueId }).from(issues).where(and(
        eq(issues.companyId, companyId), eq(issues.id, issueId),
      )).for("share");
      if (!issue || issue.updatedAt.toISOString() !== item.sourceVersion ||
        !await canActorReadIssuePrivacy(db, actor, { companyId, id: issueId })) {
        throw forbidden("Human Memory Task evidence is no longer current");
      }
      sources.sourceIssueIds.push(issueId);
      if(issue.privacyParentIssueId)sources.sourceIssueIds.push(issue.privacyParentIssueId);
      if(issue.privacyRootIssueId)sources.sourceIssueIds.push(issue.privacyRootIssueId);
    }
  } else return sources;
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

/** Explicit share preserves the exact source edge but avoids attaching the
 * producer's incidental run/context roots to the shared copy. The walk below
 * still qualifies every root retained by the private source itself. */
export async function capturePrivateShareSource(db:Db,companyId:string,actor:AuthorizationActor|undefined,
  sourceRecordId:string,sourceOwnerUserId:string):Promise<Awaited<ReturnType<typeof captureMemorySources>>> {
  if(!actor||!await memorySourceActorCurrent(db,companyId,actor))throw forbidden("Private Memory share authority is unavailable");
  const [source]=await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId,companyId),
    eq(memoryRecords.id,sourceRecordId),memoryPayloadVisible()));
  if(!source||source.scopeType!=="agent"||source.privateOwnerUserId!==sourceOwnerUserId||!source.sourceProvenanceQualified
    ||!await canActorReadMemorySources(db,companyId,actor,sourceRecordId))throw forbidden("Private Memory source is unavailable");
  return {sourceProvenanceQualified:true,privateOwnerUserId:null,sourceRunIds:[],sourceIssueIds:[],sourceProjectIds:[],
    sourceMemoryIds:[sourceRecordId],sourceFoundationRevisionIds:[]};
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

async function scrubMemoryToolInvocations(db: Db, companyId: string, ids: string[], now: Date) {
  if (!ids.length) return;
  await db.update(toolInvocations).set({ argumentsHash: null, argumentsSummary: null, idempotencyRequestHash: null,
    resultHash: null, resultSummary: null, resultSizeBytes: null, workflowResultJson: null, errorMessage: null, updatedAt: now })
    .where(and(eq(toolInvocations.companyId, companyId), inArray(toolInvocations.id, ids)));
  await db.update(toolCallEvents).set({ argumentsSummary: null, requestSummary: null, resultSummary: null,
    metadata: { payloadDeleted: true }, errorMessage: null }).where(and(eq(toolCallEvents.companyId, companyId),
      inArray(toolCallEvents.invocationId, ids)));
  const reviews = await db.select({ interactionId: toolActionRequests.interactionId }).from(toolActionRequests).where(and(
    eq(toolActionRequests.companyId, companyId), inArray(toolActionRequests.invocationId, ids)));
  await db.update(toolActionRequests).set({ signedArguments: null,
    canonicalArgumentsSummary: { summary: "Erased source payload", sizeBytes: 0 }, previewMarkdown: null, updatedAt: now })
    .where(and(eq(toolActionRequests.companyId, companyId), inArray(toolActionRequests.invocationId, ids)));
  await db.update(toolActionRequests).set({ status: "cancelled", resolvedAt: now, updatedAt: now }).where(and(
    eq(toolActionRequests.companyId, companyId), inArray(toolActionRequests.invocationId, ids),
    inArray(toolActionRequests.status, ["pending", "approved"])));
  await db.update(toolAccessAuditEvents).set({ details: { payloadDeleted: true } }).where(and(
    eq(toolAccessAuditEvents.companyId, companyId),
    sql`${toolAccessAuditEvents.details} ->> 'invocationId' in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`));
  await db.update(activityLog).set({ details: { payloadDeleted: true } }).where(and(eq(activityLog.companyId, companyId),
    sql`${activityLog.details} ->> 'invocationId' in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`));
  const interactionIds = reviews.flatMap(row => row.interactionId ? [row.interactionId] : []);
  if (interactionIds.length) await db.update(issueThreadInteractions).set({
    payload: sql`jsonb_set(jsonb_set(jsonb_set(${issueThreadInteractions.payload}, '{toolAction,argumentsSummaryJson}', '"Erased source payload"'),
      '{toolAction,previewMarkdown}', '"Source payload erased"'), '{detailsMarkdown}', '""')`,
    result: sql`case when ${issueThreadInteractions.result} is null then null else
      jsonb_set(jsonb_set(${issueThreadInteractions.result}, '{toolAction,resultSummary}', 'null'), '{toolAction,errorMessage}', 'null') end`,
    updatedAt: now,
  }).where(and(eq(issueThreadInteractions.companyId, companyId), inArray(issueThreadInteractions.id, interactionIds)));
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
  // Resolution metadata is a retained derived copy of record identities, even
  // when the survivor's authored body is independent. Remove only links to the
  // erased records; preserve the surviving record and all unrelated metadata.
  // Metadata participates in the native payload body hash. Preserve a frozen
  // snapshot only when its original owner binding is valid and its exact source
  // graph is independent of the erased IDs; otherwise let the DB owner trigger
  // irreversibly invalidate it when the metadata edit clears the snapshot.
  const erasedIds = new Set(ids);
  const erasedIdList = [...ids];
  const relatedIdArray = sql`ARRAY[${sql.join(erasedIdList.map((id) => sql`${id}`), sql`, `)}]::text[]`;
  const referencesErasedId = or(
    inArray(sql<string>`${memoryRecords.metadata}->'memoryResolution'->>'targetRecordId'`, erasedIdList),
    sql`${memoryRecords.metadata}->'memoryResolution'->'relatedRecordIds' ?| ${relatedIdArray}`,
  );
  const survivingRows = await db.select({ id: memoryRecords.id, metadata: memoryRecords.metadata,
    payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot,
    payloadSourceProtocolVersion: memoryRecords.payloadSourceProtocolVersion,
    payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated,
  }).from(memoryRecords).where(and(
    eq(memoryRecords.companyId, companyId), notInArray(memoryRecords.id, erasedIdList), referencesErasedId,
  )).for("update");
  for (const survivor of survivingRows) {
    if (!survivor.metadata || typeof survivor.metadata !== "object" || Array.isArray(survivor.metadata)) continue;
    const metadata = survivor.metadata as Record<string, unknown>;
    const resolution = metadata.memoryResolution;
    if (!resolution || typeof resolution !== "object" || Array.isArray(resolution)) continue;
    const existing = resolution as Record<string, unknown>;
    const targetErased = typeof existing.targetRecordId === "string" && erasedIds.has(existing.targetRecordId);
    const related = Array.isArray(existing.relatedRecordIds) ? existing.relatedRecordIds : null;
    const keptRelated = related?.filter((id) => typeof id !== "string" || !erasedIds.has(id));
    const relatedChanged = related !== null && keptRelated!.length !== related.length;
    if (!targetErased && !relatedChanged) continue;
    const nextResolution = { ...existing };
    if (targetErased) delete nextResolution.targetRecordId;
    if (relatedChanged) nextResolution.relatedRecordIds = keptRelated;
    const nextMetadata = { ...metadata, memoryResolution: nextResolution };
    let payloadSourceSnapshotUpdate: SQL | undefined;
    if (survivor.payloadSourceSnapshot !== null) {
      const snapshot = nativePayloadSourceSnapshotSchema.safeParse(survivor.payloadSourceSnapshot);
      const [binding] = snapshot.success ? await db.execute<{ valid: boolean }>(sql`select
        ${memoryRecords.payloadSourceSnapshot}->'owner'->>'kind'='memory_record'
          and ${memoryRecords.payloadSourceSnapshot}->'owner'->>'companyId'=${companyId}
          and ${memoryRecords.payloadSourceSnapshot}->'owner'->>'id'=${survivor.id}
          and ${memoryRecords.payloadSourceSnapshot}->'owner'->>'contentHash'=
            public.aw_native_payload_body_hash('memory_record',to_jsonb(${memoryRecords}))
          and ${memoryRecords.payloadSourceSnapshot}->>'digest'=
            encode(sha256(convert_to((${memoryRecords.payloadSourceSnapshot}-'digest')::text,'UTF8')),'hex')
          as valid from ${memoryRecords} where ${memoryRecords.companyId}=${companyId}::uuid
            and ${memoryRecords.id}=${survivor.id}::uuid`) : [];
      const sourceGraphIndependent = snapshot.success &&
        survivor.payloadSourceProtocolVersion === 1 && !survivor.payloadSourceSnapshotInvalidated &&
        snapshot.data.policy.memoryIds.every((id) => !erasedIds.has(id)) &&
        snapshot.data.inputs.every((input) => input.kind !== "memory" || !erasedIds.has(input.memoryId));
      if (binding?.valid && sourceGraphIndependent) {
        // The metadata edit removes a resolver pointer, not a payload source.
        // Preserve the exact frozen policy/input graph while recomputing only
        // the owner body hash and digest; reads still revalidate that graph.
        const policyJson = JSON.stringify(snapshot.data.policy);
        const inputsJson = JSON.stringify(snapshot.data.inputs);
        const metadataJson = JSON.stringify(nextMetadata);
        payloadSourceSnapshotUpdate = sql`(
          with payload as (select jsonb_build_object('version',1,'owner',jsonb_build_object(
            'kind','memory_record','companyId',${companyId}::text,'id',${survivor.id}::text,
            'contentHash',public.aw_native_payload_body_hash('memory_record',
              to_jsonb(${memoryRecords}) || jsonb_build_object('metadata',${metadataJson}::jsonb))),
            'policy',${policyJson}::jsonb,'inputs',${inputsJson}::jsonb) as value)
          select value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex')) from payload
        )`;
      } else {
        // Corrupt or source-dependent snapshots fail closed. Clearing the old
        // snapshot lets the DB trigger set the irreversible invalidation bit.
        payloadSourceSnapshotUpdate = sql`null`;
      }
    }
    await db.update(memoryRecords).set({
      metadata: nextMetadata,
      ...(payloadSourceSnapshotUpdate ? { payloadSourceSnapshot: payloadSourceSnapshotUpdate } : {}),
      updatedAt: now,
    }).where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, survivor.id)));
  }
  const outputBindings = rows.flatMap(row => {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown> : null;
    const invocationId = metadata?.nativeManagedMemoryInvocationId;
    const callId = metadata?.nativeManagedMemoryCallId;
    const argumentsHash = metadata?.nativeManagedMemoryArgumentsHash;
    if (row.createdByActorType !== "agent" || !row.createdByActorId || !row.sourceProvenanceQualified ||
      typeof invocationId !== "string" || typeof callId !== "string" || typeof argumentsHash !== "string" || row.payloadSourceSnapshotInvalidated ||
      row.payloadSourceProtocolVersion !== 1) return [];
    const snapshot = nativePayloadSourceSnapshotSchema.safeParse(row.payloadSourceSnapshot);
    if (row.payloadSourceSnapshot != null && (!snapshot.success || snapshot.data.owner.kind !== "memory_record" ||
      snapshot.data.owner.companyId !== companyId || snapshot.data.owner.id !== row.id)) return [];
    return [{ row, invocationId, callId, argumentsHash, snapshot: snapshot.success ? snapshot.data : null,
      snapshotWasPresent: row.payloadSourceSnapshot != null }];
  });
  for (const binding of outputBindings) {
    if (!binding.snapshot) continue;
    const [owner] = await db.execute<{ valid: boolean }>(sql`select
      public.aw_native_payload_body_hash('memory_record',to_jsonb(m))=${binding.snapshot.owner.contentHash}
        and encode(sha256(convert_to((m.payload_source_snapshot-'digest')::text,'UTF8')),'hex')=${binding.snapshot.digest} as valid
      from ${memoryRecords} m where m.company_id=${companyId}::uuid and m.id=${binding.row.id}::uuid`);
    if (!owner?.valid) binding.snapshot = null;
  }
  const verifiedOutputBindings = outputBindings.filter(binding => !binding.snapshotWasPresent || binding.snapshot !== null);
  const outputInvocationRows = verifiedOutputBindings.length ? await db.select({ id: toolInvocations.id, runId: toolInvocations.runId,
    issueId: toolInvocations.issueId, agentId: toolInvocations.agentId, toolName: toolInvocations.toolName,
    idempotencyKey: toolInvocations.idempotencyKey, argumentsHash: toolInvocations.argumentsHash }).from(toolInvocations).where(and(
    eq(toolInvocations.companyId, companyId), inArray(toolInvocations.id, verifiedOutputBindings.map(binding => binding.invocationId)))) : [];
  const outputInvocationIds = verifiedOutputBindings.flatMap(binding => {
    const invocation = outputInvocationRows.find(value => value.id === binding.invocationId);
    const invocationIssueId = invocation?.issueId ?? null;
    const exactTaskRoots = invocationIssueId && binding.snapshot
      ? binding.snapshot.inputs.filter(source => source.kind === "task" && source.issueId === invocationIssueId)
      : [];
    // A Native bootstrap's producer Task is an exact consumed source input,
    // but is intentionally absent from the policy-only issueIds/sourceIssueIds
    // union. Keep those policy roots authoritative and also accept only the
    // unique sealed Task tuple that binds this invocation's own issue.
    const invocationIssueBound = invocationIssueId !== null &&
      (binding.row.sourceIssueIds.includes(invocationIssueId) ||
        binding.snapshot?.policy.issueIds.includes(invocationIssueId) === true ||
        exactTaskRoots.length === 1);
    return invocation && invocation.agentId === binding.row.createdByActorId &&
      invocation.runId != null && binding.row.sourceRunIds.includes(invocation.runId) &&
      invocationIssueBound && invocation.toolName === "paperclip-self:remember" &&
      invocation.argumentsHash === binding.argumentsHash &&
      (!binding.snapshot || binding.snapshot.inputs.some(source =>
        (source.kind === "worker_model_dispatch" || source.kind === "conversation_model_dispatch") &&
        source.runId === invocation.runId)) &&
      invocation.idempotencyKey === `aw-native-tool:${invocation.runId}:${binding.callId}` ? [invocation.id] : [];
  });
  await scrubMemoryToolInvocations(db, companyId, [...new Set(outputInvocationIds)], now);
  await db.delete(memoryPrivateSharePublications).where(and(eq(memoryPrivateSharePublications.companyId,companyId),or(
    inArray(memoryPrivateSharePublications.sharedRecordId,[...ids]),inArray(memoryPrivateSharePublications.sourceRecordId,[...ids]))));
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
  sourceAssets?:{workflowRevisionIds:string[];artifactVersionIds:string[];runIds?:string[];skillVersionIds?:string[];companyPurgeOperationId?:string}) {
  if (!recordIds.length&&!sourceAssets?.workflowRevisionIds.length&&!sourceAssets?.artifactVersionIds.length&&!sourceAssets?.runIds?.length&&!sourceAssets?.skillVersionIds?.length) return;
  if (sourceAssets?.companyPurgeOperationId) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sourceAssets.companyPurgeOperationId))
      throw conflict("Company-purge Memory erasure receipt is invalid");
    const [operation] = await db.select({ id: companyDeletionOperations.id }).from(companyDeletionOperations).where(and(
      eq(companyDeletionOperations.id, sourceAssets.companyPurgeOperationId), eq(companyDeletionOperations.companyId, companyId),
      eq(companyDeletionOperations.stage, "purge"), eq(companyDeletionOperations.status, "processing"),
      sql`${companyDeletionOperations.evidence}->>'runtimesErasedAt' is not null`,
    ));
    if (!operation) throw conflict("Company-purge Memory erasure receipt is not current");
  }
  if (sourceAssets?.runIds?.length) {
    // A Run-level source erasure scrubs its actual Memory copies. Do not use
    // this retention edge for Context/Memory-root erasure; those follow the
    // exact qualified snapshot/sourceMemoryIds graph instead.
    const runCopies = await db.select({ id: memoryRecords.id }).from(memoryRecords).where(and(
      eq(memoryRecords.companyId, companyId), isNull(memoryRecords.deletedAt),
      sql`${memoryRecords.sourceRunIds} && ARRAY[${sql.join(sourceAssets.runIds.map(id => sql`${id}::uuid`), sql`, `)}]::uuid[]`,
    ));
    if (runCopies.length) await purgeMemoryRecords(db, companyId, runCopies.map(row => row.id), now);
    const memoryCalls = await db.select({ id: toolInvocations.id }).from(toolInvocations).where(and(
      eq(toolInvocations.companyId, companyId), inArray(toolInvocations.runId, sourceAssets.runIds),
      eq(toolInvocations.toolName, "paperclip-self:remember"),
    ));
    await scrubMemoryToolInvocations(db, companyId, memoryCalls.map(row => row.id), now);
    await db.update(activityLog).set({ details: { payloadDeleted: true } }).where(and(eq(activityLog.companyId, companyId),
      inArray(activityLog.runId, sourceAssets.runIds), eq(activityLog.action, "memory.private_created")));
  }
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
      await db.update(documentRevisions).set({title:null,body:"",changeSummary:null,payloadSourceSnapshot:null}).where(and(eq(documentRevisions.companyId,companyId),inArray(documentRevisions.id,revisions)));
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
      await db.update(documentRevisions).set({ title: null, body: "", changeSummary: null, payloadSourceSnapshot: null })
        .where(and(eq(documentRevisions.companyId, companyId), inArray(documentRevisions.documentId, ids)));
    }
  }
  if(affected.length)await db.update(workflowRunReviews).set({correctedOutputs:{},reason:"Source payload erased"}).where(and(eq(workflowRunReviews.companyId,companyId),inArray(workflowRunReviews.workflowRunId,[...new Set(affected.map(row=>row.workflowRunId))])));
  if (childIds.length) {
    for (const child of children) {
      // Provider-local data homes are retained for exact session recovery and
      // share the same run-scoped Native asset outbox as generated context files.
      // The worker waits for the existing Native Stop/lease receipts before it
      // removes any managed provider bytes.
      const runtimeAssetJobKey = `runtime-asset-erasure:v1:${child.id}`;
      await db.insert(memoryJobs).values({ companyId, operationType: "retention", jobKey: runtimeAssetJobKey,
        sourceRefJson: { kind: "runtime_asset_erasure", runId: child.id, legacyDigests: [] } }).onConflictDoNothing();
      const companyPurgeReceiptCondition = sourceAssets?.companyPurgeOperationId
        ? sql`(${memoryJobs.status}='succeeded'
          and ${memoryJobs.sourceRefJson}->>'runId'=${child.id}
          and ${memoryJobs.sourceRefJson}->>'companyPurgeOperationId'=${sourceAssets.companyPurgeOperationId}) is not true`
        : sql`true`;
      await db.update(memoryJobs).set({ status: "queued", finishedAt: null, resultJson: null, resultSummary: null,
        error: null, errorCode: null, sourceRefJson: { kind: "runtime_asset_erasure", runId: child.id, legacyDigests: [] }, updatedAt: now })
        .where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.jobKey, runtimeAssetJobKey), eq(memoryJobs.attemptNumber, 1),
          inArray(memoryJobs.status, ["succeeded", "failed", "cancelled"]), companyPurgeReceiptCondition));
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
  const erasedRuns = [...new Set([...(sourceAssets?.runIds ?? []), ...childIds])];
  const runConsumers = erasedRuns.length ? await db.select({ issueId: issuePrivacySources.issueId }).from(issuePrivacySources)
    .where(and(eq(issuePrivacySources.companyId, companyId), inArray(issuePrivacySources.sourceId, erasedRuns),
      inArray(issuePrivacySources.sourceKind, ["run", "run_copy"]))) : [];
  const copiedRunOutputs = erasedRuns.length ? await db.execute<{ id: string; document_id: string }>(sql`
    select distinct r.id,r.document_id from document_revisions r
    where r.company_id=${companyId}::uuid and r.payload_source_snapshot is not null and (
      exists(select 1 from jsonb_array_elements(r.payload_source_snapshot->'inputs') source(value)
        where source.value->>'kind' in ('worker_model_dispatch','conversation_model_dispatch') and source.value->>'runId'=any(array[${sql.join(erasedRuns.map(id=>sql`${id}`),sql`, `)}]::text[]))
      or r.payload_source_snapshot->'policy'->'runIds' ?| array[${sql.join(erasedRuns.map(id=>sql`${id}`),sql`, `)}]::text[]
    )
  `) : [];
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
  const legacyNativeTasks = originNativeTasks.length ? await db.select({ id: issues.id }).from(issues).where(and(
    eq(issues.companyId, companyId), inArray(issues.id, originNativeTasks.map(row => row.id)),
    or(eq(issues.payloadSourceProtocolVersion, 0), isNull(issues.payloadSourceSnapshot)),
  )) : [];
  // A routine execution can retain a copied description before it has its
  // own heartbeat. Scrub that actual task through the same Original owner.
  const originRoutineTasks = sourceRoutines.length ? await db.select({ id: issues.id }).from(issues).where(and(
    eq(issues.companyId, companyId), eq(issues.originKind, "routine_execution"),
    inArray(issues.originId, sourceRoutines.map(routine => routine.id)),
  )) : [];
  const issueIds = [...new Set([...originRoutineTasks.map(task => task.id),...originNativeTasks.map(task => task.id),...originWorkflowTasks.map(task => task.id),...skillHarnessTasks.map(task=>task.issue_id),
    ...runConsumers.map(source => source.issueId), ...childWaits.flatMap((wait) => wait.issueId ? [wait.issueId] : []), ...contextRoots.flatMap((root) => root.issueId ? [root.issueId] : [])])];
  if (issueIds.length) {
    await eraseAnalyticalSourcesUnderMemory(db, companyId, "issue", issueIds, now);
    for (const issueId of issueIds) await eraseBusinessEventObjectUnderMemory(db, companyId, "issue", issueId);
    await db.update(issues).set({ title: "Erased workflow task", description: null, payloadSourceSnapshot: null, updatedAt: now })
      .where(and(eq(issues.companyId, companyId), inArray(issues.id, issueIds)));
    await db.update(completionContracts).set({ contractJson: { payloadDeleted: true } }).where(and(eq(completionContracts.companyId, companyId), inArray(completionContracts.issueId, issueIds)));
    await db.update(issueWorkProducts).set({ title: "Erased workflow output", url: null, externalId: null, summary: null, metadata: {}, sourceTrust: null, updatedAt: now })
      .where(and(eq(issueWorkProducts.companyId, companyId), inArray(issueWorkProducts.issueId, issueIds)));
    await db.update(issueComments).set({ body: "Source payload erased", payloadSourceSnapshot: null, updatedAt: now })
      .where(and(eq(issueComments.companyId, companyId), inArray(issueComments.issueId, issueIds)));
  }
  const legacyLinkedIssueIds = [...new Set([...legacyNativeTasks.map(row => row.id), ...originRoutineTasks.map(row => row.id),
    ...originWorkflowTasks.map(row => row.id), ...skillHarnessTasks.map(row => row.issue_id),
    ...childWaits.flatMap(row => row.issueId ? [row.issueId] : []), ...contextRoots.flatMap(row => row.issueId ? [row.issueId] : [])])];
  if (legacyLinkedIssueIds.length) {
    const linkedDocs = await db.select({ id: issueDocuments.documentId }).from(issueDocuments).where(and(
      eq(issueDocuments.companyId, companyId), inArray(issueDocuments.issueId, legacyLinkedIssueIds)));
    if (linkedDocs.length) {
      const ids = [...new Set(linkedDocs.map(doc => doc.id))];
      await eraseAnalyticalSourcesUnderMemory(db, companyId, "document", ids, now);
      await db.update(documents).set({ title: "Erased workflow document", latestBody: "", updatedAt: now })
        .where(and(eq(documents.companyId, companyId), inArray(documents.id, ids)));
      await db.update(documentRevisions).set({ title: null, body: "", changeSummary: null, payloadSourceSnapshot: null })
        .where(and(eq(documentRevisions.companyId, companyId), inArray(documentRevisions.documentId, ids)));
    }
  }
  if (copiedRunOutputs.length) {
    const revisionIds = [...new Set(copiedRunOutputs.map(row => row.id))];
    const documentIds = [...new Set(copiedRunOutputs.map(row => row.document_id))];
    await eraseAnalyticalSourcesUnderMemory(db, companyId, "document", documentIds, now);
    await db.update(documents).set({ title: "Source-erased native document", latestBody: "", updatedAt: now })
      .where(and(eq(documents.companyId, companyId), inArray(documents.latestRevisionId, revisionIds)));
    await db.update(documentRevisions).set({ title: null, body: "", changeSummary: null, payloadSourceSnapshot: null })
      .where(and(eq(documentRevisions.companyId, companyId), inArray(documentRevisions.id, revisionIds)));
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
  await db.insert(memoryDeletionMarkers).values([
    { companyId, kind: "source", key: memoryDeletionKey(companyId, "source", ["august_works_issue", `issue://${issueId}`]) },
    { companyId, kind: "source", key: memoryDeletionKey(companyId, "source", ["august_works_tasks", `issue://${issueId}`]) },
  ]).onConflictDoNothing();
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
