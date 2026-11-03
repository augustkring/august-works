import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { agentWakeupRequests, heartbeatRuns, issueComments, issueExecutionDecisions, issues, nativeRunFinalizations,
  nativeRunResults, statusDecisions, statusDecisionEffects, workAssessments, type Db } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema, nativeRunInputSourceReceiptSchema,
  type NativePayloadSourceSnapshot, type NativeRunInputSourceReceipt } from "@paperclipai/shared";
import { buildExecutionStageWakeup } from "./issue-execution-stage-wakeup.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { applyIssueExecutionPolicyTransition, normalizeIssueExecutionPolicy,
  parseIssueExecutionState } from "./issue-execution-policy.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Task = typeof issues.$inferSelect;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Reconstruct the exact immutable receipt prefix captured by a Stage owner.
 * Parsing is strict; appended dispatch/additional-input rows remain outside the
 * prefix, while every original bootstrap/binding/source field is retained. */
export function nativeRunInputSourceReceiptPrefix(receiptValue:unknown,dispatchCount:unknown,
  additionalInputCount:unknown):NativeRunInputSourceReceipt|null{
  const parsed=nativeRunInputSourceReceiptSchema.safeParse(receiptValue);
  if(!parsed.success || !Number.isSafeInteger(dispatchCount) || !Number.isSafeInteger(additionalInputCount) ||
    (dispatchCount as number)<0 || (additionalInputCount as number)<0 ||
    (dispatchCount as number)>parsed.data.dispatches.length || (additionalInputCount as number)>parsed.data.additionalInputs.length) return null;
  return {...parsed.data,dispatches:parsed.data.dispatches.slice(0,dispatchCount as number),
    additionalInputs:parsed.data.additionalInputs.slice(0,additionalInputCount as number)};
}

/** Validate both the current full receipt's PostgreSQL JSONB digest and the
 * pinned full-receipt prefix. This deliberately hashes JSONB text in Postgres,
 * matching migration 0511 instead of the different JS canonical JSON format. */
export async function nativeRunInputSourceReceiptPrefixMatches(db:Db|Transaction,input:{receipt:unknown;
  originalDigest:unknown;dispatchCount:unknown;additionalInputCount:unknown}):Promise<boolean>{
  if(typeof input.originalDigest!=="string" || !/^[a-f0-9]{64}$/.test(input.originalDigest)) return false;
  const prefix=nativeRunInputSourceReceiptPrefix(input.receipt,input.dispatchCount,input.additionalInputCount);
  const current=nativeRunInputSourceReceiptSchema.safeParse(input.receipt);
  if(!prefix || !current.success) return false;
  const pinnedPrefix={...prefix,digest:input.originalDigest};
  const [hashes]=await db.execute<{currentDigestValid:boolean;prefixDigest:string}>(sql`select
    (${JSON.stringify(current.data)}::jsonb->>'digest')=encode(sha256(convert_to((${JSON.stringify(current.data)}::jsonb-'digest')::text,'UTF8')),'hex') as "currentDigestValid",
    encode(sha256(convert_to((${JSON.stringify(pinnedPrefix)}::jsonb-'digest')::text,'UTF8')),'hex') as "prefixDigest"`);
  return hashes?.currentDigestValid===true && hashes.prefixDigest===input.originalDigest;
}

/** Private service option, never a route field or a permission claim. The real
 * decision/comment rows are selected again under the Task's write transaction. */
export type NativeStageTaskBodyOwner =
  | { kind: "native_status_decision"; runId: string; decisionId: string }
  | { kind: "native_stage_comment"; runId: string; decisionId: string; commentId: string; effect: import("../agent-auth-jwt.js").NativeToolEffectClaim };

export type NativeStageTaskBodyReceipt = {
  version: 1; companyId: string; issueId: string; runId: string; agentId: string;
  responsibleUserId: string; transitionId: string; owner: NativeStageTaskBodyOwner;
  originalInputReceiptDigest: string; originalDispatchCount: number; originalAdditionalInputCount: number;
  executionInputDigest: string;
  originalSnapshot: NativePayloadSourceSnapshot;
  previousOwnerContentHash: string; nextOwnerContentHash: string;
  fromExecutionState: unknown; toExecutionState: unknown;
  fromUnblockDescriptor: unknown; toUnblockDescriptor: unknown;
  ownerFingerprint: string;
};

export type NativeStageTaskBodyTransform = {
  kind: "native_stage_policy"; transitionId: string; runId: string;
  ownerKind: NativeStageTaskBodyOwner["kind"]; decisionId: string;
  receiptHash: string; previousSnapshotDigest: string;
  previousOwnerContentHash: string; nextOwnerContentHash: string;
};

/** Only stable identity/body fields are fingerprinted. Lifecycle timestamps and
 * proposed -> applied are checked separately, not mistaken for immutable bytes. */
async function selectStageBodyOwner(db: Db | Transaction, task: Task, owner: NativeStageTaskBodyOwner,
  nextState: unknown, nextUnblock: unknown, phase: "preparing" | "current") {
  const runQuery = db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, task.companyId),
    eq(heartbeatRuns.id, owner.runId), eq(heartbeatRuns.nativeIssueId, task.id), eq(heartbeatRuns.runtimeMode, "native"))).limit(1);
  const [run] = await runQuery.for(phase === "preparing" ? "update" : "share");
  const profile = object(run?.runnerProfileJson);
  const inputReceipt = nativeRunInputSourceReceiptSchema.safeParse(profile?.nativeInputSourceReceipt);
  if (!run || !run.responsibleUserId || !inputReceipt.success ||
      inputReceipt.data.binding.companyId !== task.companyId || inputReceipt.data.binding.issueId !== task.id ||
      inputReceipt.data.binding.runId !== run.id || inputReceipt.data.binding.agentId !== run.agentId ||
      inputReceipt.data.binding.responsibleUserId !== run.responsibleUserId)
    throw new Error("native_stage_body_input_owner_unavailable");
  if (owner.kind === "native_status_decision") {
    const [decision] = await db.select().from(statusDecisions).where(and(eq(statusDecisions.companyId, task.companyId),
      eq(statusDecisions.issueId, task.id), eq(statusDecisions.runId, run.id), eq(statusDecisions.id, owner.decisionId))).limit(1).for("share");
    const [finalization] = await db.select().from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.companyId, task.companyId),
      eq(nativeRunFinalizations.issueId, task.id), eq(nativeRunFinalizations.runId, run.id))).limit(1).for("share");
    const [result] = finalization?.resultId ? await db.select().from(nativeRunResults).where(and(
      eq(nativeRunResults.companyId, task.companyId), eq(nativeRunResults.issueId, task.id),
      eq(nativeRunResults.runId, run.id), eq(nativeRunResults.id, finalization.resultId))).limit(1).for("share") : [];
    const [assessment] = decision?.assessmentId && result ? await db.select().from(workAssessments).where(and(
      eq(workAssessments.companyId, task.companyId), eq(workAssessments.issueId, task.id),
      eq(workAssessments.runId, run.id), eq(workAssessments.id, decision.assessmentId),
      eq(workAssessments.resultId, result.id), eq(workAssessments.contractId, result.completionContractId))).limit(1).for("share") : [];
    const decisionJson = object(decision?.decisionJson);
    if (!decision || !finalization || !result || !assessment || result.schemaStatus !== "accepted" || !decision.assessmentId ||
        (phase === "preparing" ? decision.applicationState !== "proposed" : decision.applicationState !== "applied" ||
          finalization.phase !== "committed" || finalization.decisionId !== decision.id || finalization.assessmentId !== decision.assessmentId) ||
        decisionJson?.reasonCode !== "execution_policy_stage_pending" || decisionJson.statusAction !== "in_review" ||
        decisionJson.toStatus !== "in_review" || !isDeepStrictEqual(decisionJson.unblockDescriptor ?? null, nextUnblock))
      throw new Error("native_stage_body_status_owner_unavailable");
    // Reproduce the exact original owner's policy transition from its locked
    // before row. No supplied stage/assignee becomes execution authority.
    if (phase === "preparing") {
      const policy = normalizeIssueExecutionPolicy(task.executionPolicy ?? null);
      const transition = applyIssueExecutionPolicyTransition({issue: task, policy, previousPolicy: policy,
        requestedStatus: "done", requestedAssigneePatch: {}, actor: {agentId: run.agentId, userId: null}, allowBoardOverride: false});
      if (!isDeepStrictEqual(transition.patch.executionState, nextState) || parseIssueExecutionState(nextState)?.status !== "pending")
        throw new Error("native_stage_body_status_projection_changed");
    } else {
      const effects = await db.select().from(statusDecisionEffects).where(and(
        eq(statusDecisionEffects.companyId, task.companyId), eq(statusDecisionEffects.issueId, task.id),
        eq(statusDecisionEffects.decisionId, decision.id), eq(statusDecisionEffects.effectKind, "execution_stage_wake"))).limit(2).for("share");
      const effect=effects.length===1 ? effects[0] : null;
      const canonical=buildExecutionStageWakeup({issueId:task.id,previousState:null,nextState:parseIssueExecutionState(nextState),
        interruptedRunId:null,requestedByActorType:"agent",requestedByActorId:run.agentId});
      const [intent]=effect?.targetId ? await db.select().from(agentWakeupRequests).where(and(
        eq(agentWakeupRequests.companyId,task.companyId),eq(agentWakeupRequests.id,effect.targetId))).limit(1).for("share") : [];
      if (!effect || !intent || !canonical || effect.targetType!=="agent_wakeup_request" ||
          intent.agentId!==canonical.agentId || intent.source!==canonical.wakeup.source ||
          intent.requestedByActorType!=="agent" || intent.requestedByActorId!==run.agentId ||
          intent.idempotencyKey!==`issue.execution_stage:${task.id}:${decision.id}` ||
          !isDeepStrictEqual(object(effect.payload)?.executionStage,canonical.wakeup.payload.executionStage) ||
          !isDeepStrictEqual(intent.payload,{...canonical.wakeup.payload,taskId:task.id,
            _paperclipWakeContext:{...canonical.wakeup.contextSnapshot,statusDecisionSource:"native_status_decision"}}))
        throw new Error("native_stage_body_status_effect_unavailable");
    }
    return {run, inputReceipt: inputReceipt.data,
      fingerprint: nativeSha256({id: decision.id, companyId: decision.companyId, issueId: decision.issueId,
        runId: decision.runId, assessmentId: decision.assessmentId, decisionDigest: decision.decisionDigest,
        resultId: result.id, resultHash: result.canonicalSha256, assessment: assessment.assessmentJson, assessmentInputDigest: assessment.inputDigest})};
  }
  const [decision] = await db.select().from(issueExecutionDecisions).where(and(eq(issueExecutionDecisions.companyId, task.companyId),
    eq(issueExecutionDecisions.issueId, task.id), eq(issueExecutionDecisions.id, owner.decisionId),
    eq(issueExecutionDecisions.createdByRunId, run.id), eq(issueExecutionDecisions.actorAgentId, run.agentId))).limit(1).for("share");
  const [comment] = await db.select().from(issueComments).where(and(eq(issueComments.companyId, task.companyId),
    eq(issueComments.issueId, task.id), eq(issueComments.id, owner.commentId), eq(issueComments.createdByRunId, run.id),
    eq(issueComments.authorAgentId, run.agentId))).limit(1).for("share");
  const transitions = object(object(run.resultJson)?.nativeStagePolicyTransitions);
  const to = parseIssueExecutionState(nextState);
  if (!decision || !comment || decision.actorUserId !== null || comment.authorUserId !== null ||
      comment.authorType !== "agent" || comment.deletedAt !== null || !to || to.lastDecisionId !== decision.id ||
      !["approved", "changes_requested"].includes(decision.outcome) || decision.outcome !== to.lastDecisionOutcome)
    throw new Error("native_stage_body_comment_owner_unavailable");
  if (phase === "preparing") {
    const from = parseIssueExecutionState(task.executionState);
    const api = object(object(object(run.resultJson)?.apiToolReceipts)?.[createHash("sha256").update(owner.effect.callId).digest("hex")]);
    if (run.status !== "running" || !from || from.status !== "pending" || from.currentParticipant?.type !== "agent" ||
        from.currentParticipant.agentId !== run.agentId || from.currentStageId !== decision.stageId ||
        from.currentStageType !== decision.stageType || owner.effect.method !== "POST" ||
        owner.effect.pathAndQuery !== `/api/issues/${task.id}/comments` || owner.effect.operationId !== "POST /api/issues/{id}/comments" ||
        api?.state !== "pending" || api.nativeEffectClaimConsumed !== true || api.digest !== owner.effect.apiReceiptDigest ||
        api.operationId !== owner.effect.operationId)
      throw new Error("native_stage_body_comment_generation_changed");
  } else if (!transitions || !Object.values(transitions).some(value => {
    const transition = object(value);return transition?.stageDecisionId === decision.id && transition.commentId === comment.id &&
      transition.runId === run.id && isDeepStrictEqual(transition.effect, owner.effect) && isDeepStrictEqual(transition.toState, nextState);
  })) throw new Error("native_stage_body_comment_receipt_unavailable");
  return {run, inputReceipt: inputReceipt.data, fingerprint: nativeSha256({decision: {...decision,
    createdAt: decision.createdAt.toISOString(), updatedAt: decision.updatedAt.toISOString()}, comment: {...comment,
    createdAt: comment.createdAt.toISOString(), updatedAt: comment.updatedAt.toISOString()}})};
}

/** Called only in issueService.update, after locking the original Task and
 * before its ONE body UPDATE. The existing no-rebinding latch is never crossed.
 * No policy/input is added and no original source is rewritten. */
export async function prepareNativeStageTaskBodySnapshot(tx: Transaction, input: {
  task: Task; owner: NativeStageTaskBodyOwner; nextExecutionState: unknown; nextUnblockDescriptor: unknown;
  actualBodyPatch: SQL;
}): Promise<SQL> {
  const snapshot = nativePayloadSourceSnapshotSchema.parse(input.task.payloadSourceSnapshot);
  if (input.task.payloadSourceProtocolVersion !== 1 || input.task.payloadSourceSnapshotInvalidated ||
      snapshot.owner.kind !== "issue" || snapshot.owner.companyId !== input.task.companyId || snapshot.owner.id !== input.task.id ||
      (snapshot.transforms?.length ?? 0) >= 32) throw new Error("native_stage_body_snapshot_unavailable");
  const [hashes] = await tx.execute<{oldHash: string; newHash: string; metadataHash: string; validDigest: boolean}>(sql`select
    public.aw_native_payload_body_hash('issue',to_jsonb(${issues})) as "oldHash",
    public.aw_native_payload_body_hash('issue',to_jsonb(jsonb_populate_record(${issues},to_jsonb(${issues}) || ${input.actualBodyPatch}))) as "newHash",
    public.aw_native_payload_body_hash('issue',to_jsonb(jsonb_populate_record(${issues},to_jsonb(${issues}) ||
      jsonb_build_object('execution_state',${JSON.stringify(input.nextExecutionState ?? null)}::jsonb,
        'unblock_descriptor',${JSON.stringify(input.nextUnblockDescriptor ?? null)}::jsonb)))) as "metadataHash",
    ${JSON.stringify(snapshot)}::jsonb->>'digest'=encode(sha256(convert_to((${JSON.stringify(snapshot)}::jsonb-'digest')::text,'UTF8')),'hex') as "validDigest"
    from ${issues} where ${issues.companyId}=${input.task.companyId} and ${issues.id}=${input.task.id}`);
  if (!hashes || !hashes.validDigest || hashes.oldHash !== snapshot.owner.contentHash || hashes.newHash !== hashes.metadataHash ||
      hashes.oldHash === hashes.newHash) throw new Error("native_stage_body_literal_or_source_changed");
  const bound = await selectStageBodyOwner(tx,input.task,input.owner,input.nextExecutionState,input.nextUnblockDescriptor,"preparing");
  const captured=object(object(bound.run.runnerProfileJson)?.nativeBootstrapTaskSource);
  if (!captured || !isDeepStrictEqual(captured.payloadSourceSnapshot,snapshot) ||
      object(captured.input)?.kind!=="task" || object(captured.input)?.issueId!==input.task.id ||
      object(captured.input)?.contentHash!==hashes.oldHash ||
      !bound.inputReceipt.bootstrap.inputs.some(source=>isDeepStrictEqual(source,captured.input)))
    throw new Error("native_stage_body_original_task_capture_changed");
  const transitionId=randomUUID();
  const receipt: NativeStageTaskBodyReceipt = {version:1,companyId:input.task.companyId,issueId:input.task.id,
    runId:bound.run.id,agentId:bound.run.agentId,responsibleUserId:bound.run.responsibleUserId!,transitionId,owner:input.owner,
    originalInputReceiptDigest:bound.inputReceipt.digest,originalDispatchCount:bound.inputReceipt.dispatches.length,
    originalAdditionalInputCount:bound.inputReceipt.additionalInputs.length,
    executionInputDigest:bound.inputReceipt.bootstrap.executionInputDigest,
    originalSnapshot:snapshot,previousOwnerContentHash:hashes.oldHash,nextOwnerContentHash:hashes.newHash,
    fromExecutionState:input.task.executionState ?? null,toExecutionState:input.nextExecutionState ?? null,
    fromUnblockDescriptor:input.task.unblockDescriptor ?? null,toUnblockDescriptor:input.nextUnblockDescriptor ?? null,
    ownerFingerprint:bound.fingerprint};
  const [hash] = await tx.execute<{value:string}>(sql`select encode(sha256(convert_to(${JSON.stringify(receipt)}::jsonb::text,'UTF8')),'hex') as value`);
  if (!hash?.value) throw new Error("native_stage_body_receipt_hash_unavailable");
  const result=object(bound.run.resultJson) ?? {}, receipts=object(result.nativeStageTaskBodyTransitions) ?? {};
  if (Object.keys(receipts).length >= 32) throw new Error("native_stage_body_receipt_bound");
  await tx.update(heartbeatRuns).set({resultJson:{...result,nativeStageTaskBodyTransitions:{...receipts,[transitionId]:receipt}}})
    .where(and(eq(heartbeatRuns.companyId,input.task.companyId),eq(heartbeatRuns.id,bound.run.id)));
  const transform:NativeStageTaskBodyTransform={kind:"native_stage_policy",transitionId,runId:bound.run.id,
    ownerKind:input.owner.kind,decisionId:input.owner.decisionId,receiptHash:hash.value,previousSnapshotDigest:snapshot.digest,
    previousOwnerContentHash:hashes.oldHash,nextOwnerContentHash:hashes.newHash};
  const value={version:1,owner:{...snapshot.owner,contentHash:hashes.newHash},policy:snapshot.policy,inputs:snapshot.inputs,
    transforms:[...(snapshot.transforms ?? []),transform]};
  return sql`(with payload as (select ${JSON.stringify(value)}::jsonb as value)
    select value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex')) from payload)`;
}

/** Current machine-state proof is independent of finalized-output permission.
 * Reads reselect the actual decision/effect/comment; a persisted receipt is
 * never a substitute for those owners or the current reader's source graph. */
export async function readNativeStageTaskBodyStep(db: Db | Transaction, input: {
  task: Task; step: NativeStageTaskBodyTransform;
}): Promise<NativeStageTaskBodyReceipt> {
  const {task,step}=input;
  const [row]=await db.select({run:heartbeatRuns,
    receipt:sql<NativeStageTaskBodyReceipt>`${heartbeatRuns.resultJson}->'nativeStageTaskBodyTransitions'->${step.transitionId}`,
    hash:sql<string>`encode(sha256(convert_to((${heartbeatRuns.resultJson}->'nativeStageTaskBodyTransitions'->${step.transitionId})::text,'UTF8')),'hex')`,
  }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,task.companyId),eq(heartbeatRuns.id,step.runId),
    eq(heartbeatRuns.nativeIssueId,task.id),eq(heartbeatRuns.runtimeMode,"native"))).limit(1).for("share");
  const receipt=row?.receipt;
  const snapshot=nativePayloadSourceSnapshotSchema.safeParse(receipt?.originalSnapshot);
  if(!receipt || Object.keys(receipt).sort().join(",")!=="agentId,companyId,executionInputDigest,fromExecutionState,fromUnblockDescriptor,issueId,nextOwnerContentHash,originalAdditionalInputCount,originalDispatchCount,originalInputReceiptDigest,originalSnapshot,owner,ownerFingerprint,previousOwnerContentHash,responsibleUserId,runId,toExecutionState,toUnblockDescriptor,transitionId,version" ||
    receipt.version!==1 || receipt.companyId!==task.companyId || receipt.issueId!==task.id ||
    receipt.runId!==step.runId || receipt.agentId!==row.run.agentId || receipt.responsibleUserId!==row.run.responsibleUserId ||
    receipt.transitionId!==step.transitionId || row.hash!==step.receiptHash || receipt.owner.kind!==step.ownerKind ||
    receipt.owner.runId!==step.runId || receipt.owner.decisionId!==step.decisionId || !snapshot.success ||
    snapshot.data.digest!==step.previousSnapshotDigest || snapshot.data.owner.contentHash!==step.previousOwnerContentHash ||
    receipt.previousOwnerContentHash!==step.previousOwnerContentHash || receipt.nextOwnerContentHash!==step.nextOwnerContentHash)
    throw new Error("native_stage_body_transition_changed");
  const bound=await selectStageBodyOwner(db,task,receipt.owner,receipt.toExecutionState,receipt.toUnblockDescriptor,"current");
  if(bound.fingerprint!==receipt.ownerFingerprint ||
    !await nativeRunInputSourceReceiptPrefixMatches(db,{receipt:object(bound.run.runnerProfileJson)?.nativeInputSourceReceipt,
      originalDigest:receipt.originalInputReceiptDigest,dispatchCount:receipt.originalDispatchCount,
      additionalInputCount:receipt.originalAdditionalInputCount}) ||
    bound.inputReceipt.bootstrap.executionInputDigest!==receipt.executionInputDigest)
    throw new Error("native_stage_body_transition_authority_changed");
  // These are the actual producer's captured before bytes. This comparison
  // remains exact even if another machine transition has since advanced Task.
  const originalTask=object(object(row.run.runnerProfileJson)?.nativeBootstrapTaskSource);
  if(!originalTask || object(originalTask.input)?.kind!=="task" || object(originalTask.input)?.issueId!==task.id ||
    object(originalTask.input)?.contentHash!==receipt.previousOwnerContentHash ||
    !isDeepStrictEqual(originalTask.payloadSourceSnapshot,receipt.originalSnapshot) ||
    !bound.inputReceipt.bootstrap.inputs.some(source=>isDeepStrictEqual(source,originalTask.input)))
    throw new Error("native_stage_body_original_task_capture_unavailable");
  return receipt;
}

/** Called after the real decision/effect writers, before THEIR transaction
 * commits. Failure rolls back both the coherent snapshot and actual effects. */
export async function assertNativeStageTaskBodyTransitionsCommitted(tx:Transaction,input:{companyId:string;issueId:string;runId:string}) {
  const [task]=await tx.select().from(issues).where(and(eq(issues.companyId,input.companyId),eq(issues.id,input.issueId))).limit(1).for("share");
  const snapshot=nativePayloadSourceSnapshotSchema.safeParse(task?.payloadSourceSnapshot);
  if(!task || !snapshot.success) throw new Error("native_stage_body_committed_snapshot_unavailable");
  const steps=(snapshot.data.transforms ?? []).filter((step):step is NativeStageTaskBodyTransform=>
    step.kind==="native_stage_policy" && step.runId===input.runId);
  if(steps.length===0) throw new Error("native_stage_body_committed_transition_missing");
  for(const step of steps) await readNativeStageTaskBodyStep(tx,{task,step});
}

export type NativeFinalizedStageTaskBodyRead = {
  kind:"stage_entry"|"stage_consumption"; companyId:string;issueId:string;runId:string;agentId:string;
  receiptDigest:string;executionInputDigest:string;resultId:string;resultHash:string;decisionId:string;
  finalizationVersion:string; transitionIds:string[];
  taskCapture:{input:Extract<import("@paperclipai/shared").NativePayloadSourceInput,{kind:"task"}>;
    payloadSourceSnapshot:NativePayloadSourceSnapshot};
};

/** Selected only inside the existing authenticated parent/output edge. It is
 * read-only evidence: no dispatcher, current-source mutation fence or fresh
 * model turn accepts this object. The current reader is checked independently. */
export async function captureNativeFinalizedStageTaskBodyRead(db:Db|Transaction,input:{companyId:string;issueId:string;
  runId:string;reader:import("./authorization.js").AuthorizationActor}):Promise<NativeFinalizedStageTaskBodyRead|null>{
  const [entry]=await db.select({run:heartbeatRuns,
    receiptDigestValid:sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt'->>'digest')=encode(sha256(convert_to(((${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt')-'digest')::text,'UTF8')),'hex')`,
    inputDigestValid:sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt'->'bootstrap'->>'executionInputDigest')=encode(sha256(convert_to((${heartbeatRuns.runnerProfileJson}->'nativeExecutionInput')::text,'UTF8')),'hex')`,
    capturedSnapshotDigestValid:sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeBootstrapTaskSource'->'payloadSourceSnapshot'->>'digest')=encode(sha256(convert_to(((${heartbeatRuns.runnerProfileJson}->'nativeBootstrapTaskSource'->'payloadSourceSnapshot')-'digest')::text,'UTF8')),'hex')`,
  }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,input.companyId),eq(heartbeatRuns.nativeIssueId,input.issueId),
    eq(heartbeatRuns.id,input.runId),eq(heartbeatRuns.runtimeMode,"native"))).limit(1).for("share");
  const run=entry?.run;
  if(!entry || entry.receiptDigestValid!==true || entry.inputDigestValid!==true || entry.capturedSnapshotDigestValid!==true ||
    run?.nativeInputSourceProtocolVersion!==1) return null;
  const {canActorReadHeartbeatRunPrivacy}=await import("./authorization.js");
  if(!run || !run.finishedAt || !["succeeded","failed","timed_out","cancelled"].includes(run.status) ||
    !await canActorReadHeartbeatRunPrivacy(db,input.reader,run)) return null;
  if(!object(object(run.resultJson)?.nativeStageTaskBodyTransitions)) return null;
  const profile=object(run.runnerProfileJson),parsed=nativeRunInputSourceReceiptSchema.safeParse(profile?.nativeInputSourceReceipt);
  const captured=object(profile?.nativeBootstrapTaskSource),taskInput=object(captured?.input);
  const snapshot=nativePayloadSourceSnapshotSchema.safeParse(captured?.payloadSourceSnapshot);
  if(!parsed.success || parsed.data.binding.companyId!==input.companyId || parsed.data.binding.issueId!==input.issueId ||
    parsed.data.binding.runId!==run.id || parsed.data.binding.agentId!==run.agentId || parsed.data.binding.responsibleUserId!==run.responsibleUserId ||
    !taskInput || taskInput.kind!=="task" || taskInput.issueId!==input.issueId || !snapshot.success ||
    taskInput.contentHash!==snapshot.data.owner.contentHash || !parsed.data.bootstrap.inputs.some(source=>isDeepStrictEqual(source,taskInput))) return null;
  const [coordinator]=await db.select().from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.companyId,input.companyId),
    eq(nativeRunFinalizations.issueId,input.issueId),eq(nativeRunFinalizations.runId,run.id),eq(nativeRunFinalizations.phase,"committed"))).limit(1).for("share");
  if(!coordinator?.resultId || !coordinator.decisionId || !coordinator.assessmentId || coordinator.leaseOwner || coordinator.failureCode) return null;
  const [accepted]=await db.select().from(nativeRunResults).where(and(eq(nativeRunResults.companyId,input.companyId),
    eq(nativeRunResults.issueId,input.issueId),eq(nativeRunResults.runId,run.id),eq(nativeRunResults.id,coordinator.resultId),eq(nativeRunResults.schemaStatus,"accepted"))).limit(1).for("share");
  const [decision]=await db.select().from(statusDecisions).where(and(eq(statusDecisions.companyId,input.companyId),eq(statusDecisions.issueId,input.issueId),
    eq(statusDecisions.runId,run.id),eq(statusDecisions.id,coordinator.decisionId),eq(statusDecisions.assessmentId,coordinator.assessmentId),
    eq(statusDecisions.applicationState,"applied"))).limit(1).for("share");
  const result=object(run.resultJson),envelope=object(accepted?.resultJson),semantic=object(envelope?.result),terminal=object(envelope?.terminal);
  const {acceptedResponseDigestMatches}=await import("./native-runtime/native-run-finalizer.js");
  if(!accepted || !decision?.appliedAt || accepted.completionContractId!==run.completionContractId ||
    result?.decisionId!==decision.id || result.finalizationPhase!=="committed" || semantic?.schema!=="paperclip.run_result.v1" || !terminal ||
    terminal.reportedWorkDisposition!==semantic.reportedWorkDisposition || !((run.status==="succeeded" && terminal.runTerminalState==="succeeded" && terminal.turnTerminalState==="completed") ||
      (["failed","timed_out"].includes(run.status) && terminal.runTerminalState==="failed" && terminal.turnTerminalState==="failed") ||
      (run.status==="cancelled" && terminal.runTerminalState==="cancelled" && ["cancelled","interrupted"].includes(String(terminal.turnTerminalState)))) ||
    !await acceptedResponseDigestMatches(db,run,accepted)) return null;
  const [task]=await db.select().from(issues).where(and(eq(issues.companyId,input.companyId),eq(issues.id,input.issueId))).limit(1).for("share");
  const current=nativePayloadSourceSnapshotSchema.safeParse(task?.payloadSourceSnapshot);
  if(!task || task.payloadSourceSnapshotInvalidated || !current.success) return null;
  const steps=(current.data.transforms ?? []).filter((step):step is NativeStageTaskBodyTransform=>step.kind==="native_stage_policy" && step.runId===run.id);
  if(steps.length===0) return null;
  for(const step of steps) await readNativeStageTaskBodyStep(db,{task,step});
  const consumption=steps.some(step=>step.ownerKind==="native_stage_comment");
  if(consumption){
    const {captureNativeFinalizedStageConsumption}=await import("./native-stage-wake-source.js");
    if(!await captureNativeFinalizedStageConsumption(db,input)) return null;
  }
  const typedInput=parsed.data.bootstrap.inputs.find((source):source is Extract<import("@paperclipai/shared").NativePayloadSourceInput,{kind:"task"}>=>
    source.kind==="task" && isDeepStrictEqual(source,taskInput));
  if(!typedInput) return null;
  return {kind:consumption?"stage_consumption":"stage_entry",companyId:input.companyId,issueId:input.issueId,runId:run.id,agentId:run.agentId,
    receiptDigest:parsed.data.digest,executionInputDigest:parsed.data.bootstrap.executionInputDigest,resultId:accepted.id,resultHash:accepted.canonicalSha256,
    decisionId:decision.id,finalizationVersion:coordinator.updatedAt.toISOString(),transitionIds:steps.map(step=>step.transitionId),
    taskCapture:{input:typedInput,payloadSourceSnapshot:snapshot.data}};
}

/** Finalizer may load its Run before the machine-policy writer commits.
 * Preserve ONLY the two current-row Stage receipts; finalizer metadata keeps
 * its existing owner and erased maps cannot return from a stale Run value. */
export function nativeStageTaskBodyResultProjection(value: Record<string,unknown>):SQL {
  const metadata = { ...value };
  delete metadata.nativeStageTaskBodyTransitions;
  delete metadata.nativeStagePolicyTransitions;
  return sql`${JSON.stringify(metadata)}::jsonb ||
    case when ${heartbeatRuns.resultJson} ? 'nativeStageTaskBodyTransitions'
      then jsonb_build_object('nativeStageTaskBodyTransitions',${heartbeatRuns.resultJson}->'nativeStageTaskBodyTransitions')
      else '{}'::jsonb end ||
    case when ${heartbeatRuns.resultJson} ? 'nativeStagePolicyTransitions'
      then jsonb_build_object('nativeStagePolicyTransitions',${heartbeatRuns.resultJson}->'nativeStagePolicyTransitions')
      else '{}'::jsonb end`;
}
