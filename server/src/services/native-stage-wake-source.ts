import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { agentWakeupRequests, heartbeatRuns, issues, statusDecisionEffects, statusDecisions, issueExecutionDecisions, issueComments, nativeRunFinalizations, nativeRunResults, orchestrationModelReservations, type Db } from "@paperclipai/db";
import { buildExecutionStageWakeup } from "./issue-execution-stage-wakeup.js";
import { nativeCallApiResultEnvelope, nativeSha256 } from "./native-runtime/canonical.js";
import { captureNativeTaskWakeSource, exactNativeTaskContinuation } from "./native-runtime/native-execution-input.js";
import { nativeRunInputSourceReceiptSchema, type NativePayloadSourceInput } from "@paperclipai/shared";
import { canActorReadHeartbeatRunPrivacy, canActorReadIssuePrivacy, type AuthorizationActor } from "./authorization.js";
import { createRunSecretRedactionRegistry } from "./run-secret-redaction.js";
import { parseIssueExecutionState } from "./issue-execution-policy.js";
import { captureNativeFinalizedStageTaskBodyRead, nativeRunInputSourceReceiptPrefixMatches } from "./native-stage-task-body-source.js";
import { captureNativeFinalizedContinuationSummary, type NativeStageTaskContinuationTrigger } from "./execution-continuation.js";

/** Live selection requires the receiver's own actor context. Historical
 * selection relaxes that identity check only; its actual consumption proof and
 * the run/Task privacy checks below remain mandatory. */
export function nativeStageContinuationReaderMatches(input:{reader:AuthorizationActor;receiver:{companyId:string;id:string;
  agentId:string|null;responsibleUserId:string|null};historical:boolean}):boolean{
  const {reader,receiver,historical}=input;
  if(historical) return (reader.type==="board" && Boolean(reader.userId)) ||
    (reader.type==="agent" && reader.companyId===receiver.companyId);
  return reader.type==="agent" && reader.companyId===receiver.companyId && reader.agentId===receiver.agentId &&
    reader.runId===receiver.id && reader.onBehalfOfUserId===receiver.responsibleUserId;
}

/** Select only the finalized Executor summary that belongs to this live Stage
 * wake. This runs while building the first dispatch envelope, before rendering;
 * it deliberately needs no Reviewer Native input receipt. */
export async function captureNativeStageContinuationOwner(db: Db | Transaction,input:{companyId:string;issueId:string;
  receiver:typeof heartbeatRuns.$inferSelect;reader:AuthorizationActor;historicalConsumption?:NativeFinalizedStageConsumption;
  readWork?:()=>void}):Promise<{trigger:NativeStageTaskContinuationTrigger;
    receiver:typeof heartbeatRuns.$inferSelect;executor:typeof heartbeatRuns.$inferSelect}|null>{
  if(!input.receiver.agentId || !input.receiver.responsibleUserId || !input.receiver.wakeupRequestId) return null;
  const history=input.historicalConsumption;
  const [currentReceiver]=await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,input.companyId),
    eq(heartbeatRuns.id,input.receiver.id),eq(heartbeatRuns.agentId,input.receiver.agentId),
    eq(heartbeatRuns.responsibleUserId,input.receiver.responsibleUserId),eq(heartbeatRuns.wakeupRequestId,input.receiver.wakeupRequestId),
    ...(history ? [] : [eq(heartbeatRuns.status,"running")]))).limit(1).for("share");
  if(!currentReceiver || !isDeepStrictEqual(currentReceiver.contextSnapshot,input.receiver.contextSnapshot)) return null;
  if(history && (!currentReceiver.finishedAt || !["succeeded","failed","timed_out","cancelled"].includes(currentReceiver.status))) return null;
  const receiver=currentReceiver,context=record(receiver.contextSnapshot),intentId=nonEmpty(context?.nativeStatusWakeIntentId);
  const stage=record(record(context?.paperclipWake)?.executionStage);
  if(!receiver.responsibleUserId || !receiver.wakeupRequestId || receiver.agentId===null ||
    receiver.companyId!==input.companyId || context?.source!=="issue.execution_stage" ||
    context.statusDecisionSource!=="native_status_decision" || context.issueId!==input.issueId || context.taskId!==input.issueId ||
    !intentId || !stage || !sameStage(context.executionStage,stage) ||
    !nativeStageContinuationReaderMatches({reader:input.reader,receiver,historical:Boolean(history)}) ||
    ![receiver.issueId,receiver.nativeIssueId,context.issueId,context.taskId].includes(input.issueId) ||
    (!history && !await canActorReadHeartbeatRunPrivacy(db,input.reader,receiver))) return null;
  const [task]=await db.select().from(issues).where(and(eq(issues.companyId,input.companyId),eq(issues.id,input.issueId))).limit(1).for("share");
  if(!task || !await canActorReadIssuePrivacy(db,input.reader,task)) return null;
  let state=parseIssueExecutionState(task.executionState);
  if(history){
    const consumed=await captureNativeFinalizedStageConsumption(db,{companyId:input.companyId,issueId:input.issueId,
      runId:receiver.id,reader:input.reader,readWork:input.readWork});
    if(!consumed || !isDeepStrictEqual(consumed,history)) return null;
    state=history.fromState;
  } else if(task.status!=="in_review" || task.assigneeAgentId!==receiver.agentId || task.lastStatusDecisionId===null ||
    !state || state.status!=="pending" || state.currentParticipant?.type!=="agent" || state.currentParticipant.agentId!==receiver.agentId) return null;
  if(!state || state.status!=="pending" || state.currentParticipant?.type!=="agent" ||
    (history ? state.currentParticipant.agentId!==history.agentId : state.currentParticipant.agentId!==receiver.agentId)) return null;
  const origin=await captureNativeStageOrigin(db,{...receiver,nativeIssueId:input.issueId});
  if(!origin || origin.intentId!==intentId || (!history && origin.decisionId!==task.lastStatusDecisionId)) return null;
  const [intent]=await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId,input.companyId),
    eq(agentWakeupRequests.id,origin.intentId),eq(agentWakeupRequests.agentId,receiver.agentId))).limit(1).for("share");
  const [effect]=await db.select().from(statusDecisionEffects).where(and(eq(statusDecisionEffects.companyId,input.companyId),
    eq(statusDecisionEffects.issueId,input.issueId),eq(statusDecisionEffects.id,origin.effectId))).limit(1).for("share");
  const [decision]=await db.select().from(statusDecisions).where(and(eq(statusDecisions.companyId,input.companyId),
    eq(statusDecisions.issueId,input.issueId),eq(statusDecisions.id,origin.decisionId))).limit(1).for("share");
  const [executor]=await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,input.companyId),
    eq(heartbeatRuns.id,origin.executorRunId),eq(heartbeatRuns.agentId,origin.executorAgentId))).limit(1).for("share");
  const [delivered]=await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId,input.companyId),
    eq(agentWakeupRequests.id,origin.deliveredWakeId),eq(agentWakeupRequests.runId,receiver.id))).limit(1).for("share");
  if(!intent || !effect || !decision || !executor || !delivered || executor.responsibleUserId!==receiver.responsibleUserId ||
    decision.toStatus!=="in_review" || decision.reasonCode!=="execution_policy_stage_pending" ||
    !await canActorReadHeartbeatRunPrivacy(db,input.reader,executor)) return null;
  const reason=state.currentStageType==="approval"?"execution_approval_requested":"execution_review_requested";
  const intentPayload=record(intent.payload),intentContext=record(intentPayload?._paperclipWakeContext),effectPayload=record(effect.payload),
    deliveredPayload=record(delivered.payload);
  const canonical=buildExecutionStageWakeup({issueId:input.issueId,previousState:null,nextState:state,interruptedRunId:null,
    requestedByActorType:"agent",requestedByActorId:executor.agentId});
  const intentBound=(intent.status==="coalesced" && intent.runId===receiver.id) || (intent.status==="claimed" && intent.runId===null);
  if(!intentBound || !["claimed","completed"].includes(delivered.status) || intent.source!=="assignment" ||
    intent.requestedByActorType!=="agent" || intent.requestedByActorId!==executor.agentId ||
    intent.idempotencyKey!==`issue.execution_stage:${input.issueId}:${decision.id}` || intent.reason!==reason ||
    intentPayload?.issueId!==input.issueId || intentPayload.mutation!=="update" || intentContext?.source!=="issue.execution_stage" ||
    effect.effectKind!=="execution_stage_wake" || effect.targetType!=="agent_wakeup_request" || effect.targetId!==intent.id ||
    effectPayload?.agentId!==receiver.agentId || effectPayload.reason!==reason || effectPayload.source!=="assignment" ||
    effectPayload.requestedByActorType!=="agent" || effectPayload.requestedByActorId!==executor.agentId ||
    decision.applicationState!=="applied" || decision.runId!==executor.id || delivered.reason!==reason ||
    delivered.requestedByActorType!=="system" || delivered.requestedByActorId!==`native-status-wake-dispatch:${intent.id}` ||
    delivered.source!=="assignment" || deliveredPayload?.mutation!=="update" ||
    record(context.paperclipWake)?.reason!==reason || record(context.executionStage)===null || !sameStage(context.executionStage,stage) ||
    !sameStage(intentPayload?.executionStage,stage) || !sameStage(intentContext?.executionStage,stage) ||
    !sameStage(effectPayload?.executionStage,stage) || deliveredPayload?.issueId!==input.issueId ||
    !sameStage(deliveredPayload?.executionStage,stage) || !canonical || !sameStage(canonical.wakeup.payload.executionStage,stage)) return null;
  const trigger:NativeStageTaskContinuationTrigger={version:1,companyId:input.companyId,issueId:input.issueId,runId:receiver.id,
    agentId:receiver.agentId,responsibleUserId:receiver.responsibleUserId,wakeupRequestId:receiver.wakeupRequestId,
    intentId:intent.id,effectId:effect.id,decisionId:decision.id,executorRunId:executor.id,executorAgentId:executor.agentId,
    reason,stageHash:nativeSha256(stage),chainHash:nativeSha256({intentId:intent.id,effectId:effect.id,effectPayload:effect.payload,
      decisionId:decision.id,decisionDigest:decision.decisionDigest,executorRunId:executor.id,deliveredWakeId:delivered.id,stage}),
    taskObjective:task.description??task.title};
  return {trigger,receiver,executor};
}

export async function captureNativeStageContinuationForDispatch(db: Db | Transaction,input:{companyId:string;issueId:string;
  receiver:typeof heartbeatRuns.$inferSelect;reader:AuthorizationActor}):Promise<{trigger:NativeStageTaskContinuationTrigger;
    summary:Awaited<ReturnType<typeof captureNativeFinalizedContinuationSummary>>}|null>{
  const owner=await captureNativeStageContinuationOwner(db,input);
  if(!owner) return null;
  const stageEntryRead=await captureNativeFinalizedStageTaskBodyRead(db,{companyId:input.companyId,issueId:input.issueId,
    runId:owner.executor.id,reader:input.reader});
  const summary=stageEntryRead?.kind==="stage_entry" ? await captureNativeFinalizedContinuationSummary({db,companyId:input.companyId,
    issueId:input.issueId,agentId:owner.receiver.agentId!,receiverRunId:owner.receiver.id,sourceRunId:owner.executor.id,
    reader:input.reader,stageEntryRead,stageTrigger:owner.trigger}) : null;
  return {trigger:owner.trigger,summary};
}

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type NativeTaskWakeCaptureInput = Parameters<typeof captureNativeTaskWakeSource>[0];
type NativeTaskWakeSource = Extract<NativePayloadSourceInput, { kind: "native_task_wake" }>;

/**
 * Capture a stage-bearing Task wake only when its exact persisted native-status
 * outbox intent, applied decision, executor Run, current Task state, and
 * dispatched reviewer Run all agree. Ordinary wakes remain on the strict
 * null-executionStage capture path.
 */
export async function captureNativeExecutionStageTaskWakeSource(db: Db | Transaction, input: {
  companyId: string;
  runId: string;
  issueId: string;
  sourceVersion: string;
  task: NativeTaskWakeCaptureInput["task"];
  runContext: unknown;
  payload: unknown;
  workspaceCapture?: NativeTaskWakeCaptureInput["workspaceCapture"];
  commentSources?: NativeTaskWakeCaptureInput["commentSources"];
  continuationCapture?: NativeTaskWakeCaptureInput["continuationCapture"];
  historicalPendingSources?: NativeTaskWakeCaptureInput["historicalPendingSources"];
  checkoutRunId?: string | null;
  historicalConsumption?: NativeFinalizedStageConsumption;
  reader?: AuthorizationActor;
  expectedStageTrigger?: import("./execution-continuation.js").NativeStageTaskContinuationTrigger;
  onContinuationCapture?: (capture: import("./execution-continuation.js").NativeTaskContinuationCapture) => void;
}): Promise<NativeTaskWakeSource | null> {
  const payload = record(input.payload);
  const contextSnapshot = record(input.runContext);
  const taskProjection = payload && record(payload.issue);
  const stage = payload && record(payload.executionStage);
  const intentId = contextSnapshot && nonEmpty(contextSnapshot.nativeStatusWakeIntentId);
  if (!payload || !contextSnapshot || !stage || !intentId || !taskProjection ||
    taskProjection.id !== input.issueId || input.task.id !== input.issueId ||
    contextSnapshot.source !== "issue.execution_stage" || contextSnapshot.statusDecisionSource !== "native_status_decision" ||
    contextSnapshot.issueId !== input.issueId || contextSnapshot.taskId !== input.issueId ||
    !sameStage(contextSnapshot.executionStage, stage) ||
    !sameStage(contextSnapshot.paperclipWake, payload)) return null;

  const [reviewerRun] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId),
    eq(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.nativeIssueId, input.issueId),
  )).limit(1).for("share");
  if (!reviewerRun || !reviewerRun.agentId || !reviewerRun.wakeupRequestId) return null;
  const reviewerContext = record(reviewerRun.contextSnapshot);
  if (reviewerContext?.nativeStatusWakeIntentId !== intentId || reviewerContext.source !== "issue.execution_stage" ||
    reviewerContext.statusDecisionSource !== "native_status_decision" || reviewerContext.issueId !== input.issueId ||
    reviewerContext.taskId !== input.issueId ||
    !sameStage(reviewerContext.paperclipWake, payload) || !sameStage(reviewerContext.executionStage, stage) ||
    !sameStage(contextSnapshot.executionStage, stage)) return null;

  const [intent] = await db.select().from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.companyId, input.companyId), eq(agentWakeupRequests.id, intentId),
    eq(agentWakeupRequests.agentId, reviewerRun.agentId),
    eq(agentWakeupRequests.source, "assignment"), eq(agentWakeupRequests.requestedByActorType, "agent"),
  )).limit(1).for("share");
  // The dispatcher links the original outbox row after enqueueWakeup returns;
  // the exact delivered row and Run context below also bind the in-flight case.
  if (!intent || (intent.runId !== null && intent.runId !== reviewerRun.id) || !intent.requestedByActorId || !intent.reason ||
    !["execution_review_requested", "execution_approval_requested"].includes(intent.reason) ||
    !intent.idempotencyKey?.startsWith(`issue.execution_stage:${input.issueId}:`)) return null;
  const intentPayload = record(intent.payload);
  const intentContext = record(intentPayload?._paperclipWakeContext);
  if (!intentPayload || !intentContext || intentPayload.issueId !== input.issueId || intentPayload.mutation !== "update" ||
    intent.reason !== payload.reason || intentContext?.source !== "issue.execution_stage" ||
    intentContext.issueId !== input.issueId || intentContext.taskId !== input.issueId ||
    payload.reason !== intent.reason || taskProjection.identifier !== input.task.identifier ||
    taskProjection.title !== input.task.title || taskProjection.description !== input.task.description ||
    taskProjection.status !== input.task.status || taskProjection.priority !== input.task.priority ||
    taskProjection.workMode !== input.task.workMode || !sameStage(intentPayload.executionStage, stage) ||
    !sameStage(intentContext.executionStage, stage) || !sameStage(reviewerContext.executionStage, stage) ||
    !sameStage(payload.executionStage, stage)) return null;

  const [deliveredWake] = await db.select().from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.companyId, input.companyId), eq(agentWakeupRequests.id, reviewerRun.wakeupRequestId),
    eq(agentWakeupRequests.agentId, reviewerRun.agentId), eq(agentWakeupRequests.runId, reviewerRun.id),
    eq(agentWakeupRequests.requestedByActorType, "system"),
    eq(agentWakeupRequests.requestedByActorId, `native-status-wake-dispatch:${intent.id}`),
  )).limit(1).for("share");
  const deliveredPayload = record(deliveredWake?.payload);
  if (!deliveredWake || !deliveredPayload || deliveredWake.source !== "assignment" || deliveredWake.reason !== intent.reason ||
    deliveredPayload.issueId !== input.issueId || deliveredPayload.mutation !== "update" ||
    !sameStage(deliveredPayload.executionStage, stage)) return null;
  const intentIsBoundToDeliveredRun = intent.status === "coalesced" && intent.runId === reviewerRun.id;
  const intentIsInFlightForDeliveredRun = intent.status === "claimed" && intent.runId === null;
  const deliveredWakeIsCurrent = deliveredWake.status === "claimed" || deliveredWake.status === "completed";
  if ((!intentIsBoundToDeliveredRun && !intentIsInFlightForDeliveredRun) || !deliveredWakeIsCurrent) return null;

  const [effect] = await db.select().from(statusDecisionEffects).where(and(
    eq(statusDecisionEffects.companyId, input.companyId), eq(statusDecisionEffects.issueId, input.issueId),
    eq(statusDecisionEffects.effectKind, "execution_stage_wake"),
    eq(statusDecisionEffects.targetType, "agent_wakeup_request"), eq(statusDecisionEffects.targetId, intent.id),
  )).limit(1).for("share");
  if (!effect) return null;
  const effectPayload = record(effect.payload);
  if (!effectPayload || effectPayload.agentId !== reviewerRun.agentId || effectPayload.reason !== intent.reason ||
    effectPayload.source !== "assignment" || effectPayload.requestedByActorType !== "agent" ||
    effectPayload.requestedByActorId !== intent.requestedByActorId || !sameStage(effectPayload.executionStage, stage)) return null;
  const [decision] = await db.select().from(statusDecisions).where(and(
    eq(statusDecisions.companyId, input.companyId), eq(statusDecisions.issueId, input.issueId),
    eq(statusDecisions.id, effect.decisionId), eq(statusDecisions.applicationState, "applied"),
  )).limit(1).for("share");
  if (!decision || decision.toStatus !== "in_review" || decision.reasonCode !== "execution_policy_stage_pending" ||
    intent.idempotencyKey !== `issue.execution_stage:${input.issueId}:${decision.id}`) return null;
  const [executorRun] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, decision.runId),
    eq(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.nativeIssueId, input.issueId),
  )).limit(1).for("share");
  if (!executorRun || executorRun.agentId !== intent.requestedByActorId) return null;

  const [currentIssue] = await db.select().from(issues).where(and(
    eq(issues.companyId, input.companyId), eq(issues.id, input.issueId),
  )).limit(1).for("share");
  const consumed=input.historicalConsumption && input.reader ? await captureNativeFinalizedStageConsumption(db,{
    companyId:input.companyId,issueId:input.issueId,runId:reviewerRun.id,reader:input.reader}) : null;
  if(input.historicalConsumption && (!consumed || !isDeepStrictEqual(consumed,input.historicalConsumption))) return null;
  if (!currentIssue || (!consumed && (currentIssue.lastStatusDecisionId !== decision.id || currentIssue.status !== decision.toStatus ||
    currentIssue.assigneeAgentId !== reviewerRun.agentId))) return null;
  const currentState = consumed?.fromState ?? parseIssueExecutionState(currentIssue.executionState);
  if (!currentState || currentState.status !== "pending" || currentState.currentParticipant?.type !== "agent" ||
    currentState.currentParticipant.agentId !== reviewerRun.agentId) return null;
  const canonicalWake = buildExecutionStageWakeup({ issueId: input.issueId, previousState: null, nextState: currentState,
    interruptedRunId: null, requestedByActorType: "agent", requestedByActorId: executorRun.agentId });
  const canonicalContext = record(canonicalWake?.wakeup.contextSnapshot);
  if (!canonicalWake || canonicalWake.agentId !== reviewerRun.agentId || canonicalWake.wakeup.reason !== intent.reason ||
    canonicalWake.wakeup.source !== intent.source || !sameStage(canonicalWake.wakeup.payload.executionStage, stage) ||
    !canonicalContext || !sameStage(canonicalContext.executionStage, stage)) return null;

  // Reuse the ordinary strict Task-wake validator on a detached copy after the
  // exact stage witness above. The actual captured payload remains untouched,
  // and the source hash continues to cover its original stage-bearing bytes.
  const stageTrigger: import("./execution-continuation.js").NativeStageTaskContinuationTrigger | undefined = reviewerRun.responsibleUserId ? {
    version: 1, companyId: input.companyId, issueId: input.issueId, runId: reviewerRun.id, agentId: reviewerRun.agentId,
    responsibleUserId: reviewerRun.responsibleUserId, wakeupRequestId: reviewerRun.wakeupRequestId,
    intentId: intent.id, effectId: effect.id, decisionId: decision.id, executorRunId: executorRun.id,
    executorAgentId: executorRun.agentId, reason: currentState.currentStageType === "approval" ? "execution_approval_requested" : "execution_review_requested",
    stageHash: nativeSha256(stage), chainHash: nativeSha256({ intentId: intent.id, effectId: effect.id, effectPayload: effect.payload,
      decisionId: decision.id, decisionDigest: decision.decisionDigest, executorRunId: executorRun.id,
      deliveredWakeId: deliveredWake.id, stage }),
    taskObjective: input.task.description ?? input.task.title,
  } : undefined;
  if(input.expectedStageTrigger && !isDeepStrictEqual(input.expectedStageTrigger,stageTrigger)) return null;
  const closedContinuation = exactNativeTaskContinuation({ value: payload.executionContinuation,
    companyId: input.companyId, issueId: input.issueId, runId: reviewerRun.id, agentId: reviewerRun.agentId,
    responsibleUserId: reviewerRun.responsibleUserId, wakeupRequestId: reviewerRun.wakeupRequestId,
    wakeReason: intent.reason, capture: input.continuationCapture, stageTrigger,
    historicalPendingSources: input.historicalPendingSources });
  const normalizedPayload = { ...payload, executionStage: null };
  const source = captureNativeTaskWakeSource({
    companyId: input.companyId, runId: input.runId, issueId: input.issueId, sourceVersion: input.sourceVersion,
    task: input.task, persistedWakeReason: intent.reason, agentId: reviewerRun.agentId,
    responsibleUserId: reviewerRun.responsibleUserId, wakeupRequestId: reviewerRun.wakeupRequestId,
    continuationCapture: closedContinuation, stageTrigger, historicalPendingSources: input.historicalPendingSources,
    workspaceCapture: input.workspaceCapture, checkoutRunId: input.checkoutRunId, commentSources: input.commentSources,
    payload: normalizedPayload,
  });
  if (source && closedContinuation) input.onContinuationCapture?.(closedContinuation);
  return source ? { ...source, contentHash: nativeSha256(input.payload) } : null;
}

type NativeStageOrigin = {intentId:string;intentHash:string;effectId:string;effectHash:string;decisionId:string;decisionHash:string;
  executorRunId:string;executorAgentId:string;deliveredWakeId:string;deliveredWakeHash:string};

export async function captureNativeStageOrigin(db:Db|Transaction,run:typeof heartbeatRuns.$inferSelect):Promise<NativeStageOrigin|null>{
  const context=record(run.contextSnapshot),intentId=nonEmpty(context?.nativeStatusWakeIntentId);
  if(!intentId || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(intentId) || !run.nativeIssueId || !run.wakeupRequestId) return null;
  const [intent]=await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId,run.companyId),
    eq(agentWakeupRequests.id,intentId),eq(agentWakeupRequests.agentId,run.agentId))).limit(1).for("share");
  const [effect]=await db.select().from(statusDecisionEffects).where(and(eq(statusDecisionEffects.companyId,run.companyId),
    eq(statusDecisionEffects.issueId,run.nativeIssueId),eq(statusDecisionEffects.effectKind,"execution_stage_wake"),
    eq(statusDecisionEffects.targetType,"agent_wakeup_request"),eq(statusDecisionEffects.targetId,intentId))).limit(1).for("share");
  if(!intent || !effect || intent.source !== "assignment" || intent.requestedByActorType !== "agent" || !intent.requestedByActorId) return null;
  const [decision]=await db.select().from(statusDecisions).where(and(eq(statusDecisions.companyId,run.companyId),
    eq(statusDecisions.issueId,run.nativeIssueId),eq(statusDecisions.id,effect.decisionId),eq(statusDecisions.applicationState,"applied"))).limit(1).for("share");
  const [delivered]=await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId,run.companyId),
    eq(agentWakeupRequests.id,run.wakeupRequestId),eq(agentWakeupRequests.runId,run.id),eq(agentWakeupRequests.agentId,run.agentId))).limit(1).for("share");
  if(!decision || !delivered || intent.idempotencyKey !== `issue.execution_stage:${run.nativeIssueId}:${decision.id}` ||
    delivered.requestedByActorType !== "system" || delivered.requestedByActorId !== `native-status-wake-dispatch:${intent.id}`) return null;
  const [executor]=await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,run.companyId),
    eq(heartbeatRuns.id,decision.runId),eq(heartbeatRuns.nativeIssueId,run.nativeIssueId),eq(heartbeatRuns.runtimeMode,"native"))).limit(1).for("share");
  if(!executor || executor.agentId !== intent.requestedByActorId) return null;
  const wakeHash=(wake:typeof agentWakeupRequests.$inferSelect)=>nativeSha256({id:wake.id,companyId:wake.companyId,agentId:wake.agentId,
    source:wake.source,reason:wake.reason,idempotencyKey:wake.idempotencyKey,requestedByActorType:wake.requestedByActorType,
    requestedByActorId:wake.requestedByActorId,payload:wake.payload,requestedAt:wake.requestedAt.toISOString()});
  return {intentId:intent.id,intentHash:wakeHash(intent),effectId:effect.id,effectHash:nativeSha256({id:effect.id,companyId:effect.companyId,
    issueId:effect.issueId,decisionId:effect.decisionId,effectKind:effect.effectKind,targetType:effect.targetType,targetId:effect.targetId,payload:effect.payload}),
    decisionId:decision.id,decisionHash:nativeSha256({...decision,createdAt:decision.createdAt.toISOString(),appliedAt:decision.appliedAt?.toISOString()}),
    executorRunId:executor.id,executorAgentId:executor.agentId,deliveredWakeId:delivered.id,deliveredWakeHash:wakeHash(delivered)};
}

export type NativeStagePolicyTransition = {
  version:1; companyId:string; issueId:string; runId:string; agentId:string; responsibleUserId:string;
  originalReceiptDigest:string; originalDispatchCount:number; originalAdditionalInputCount:number;
  executionInputDigest:string; stageSource:NativeTaskWakeSource;origin:NativeStageOrigin;
  effect:import("../agent-auth-jwt.js").NativeToolEffectClaim;
  fromState:NonNullable<ReturnType<typeof parseIssueExecutionState>>;
  toState:NonNullable<ReturnType<typeof parseIssueExecutionState>>;
  stageDecisionId:string; stageDecisionHash:string; commentId:string; commentHash:string;
};

type NativeStageTransitionPreparation = Omit<NativeStagePolicyTransition,"fromState"|"toState"|"stageDecisionId"|"stageDecisionHash"|"commentId"|"commentHash">;

/** Runs BEFORE the route's policy/comment writes, in their same transaction.
 * The existing company/privacy -> Task -> Run order matches completeRun and
 * the route policy writer; no locks span the outbound HTTP request. */
export async function prepareNativeStagePolicyTransition(tx: Transaction,input:{companyId:string;issueId:string;
  runId:string;agentId:string;effect:import("../agent-auth-jwt.js").NativeToolEffectClaim;
}):Promise<NativeStageTransitionPreparation|null>{
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(![input.companyId,input.issueId,input.runId,input.agentId].every(value=>uuid.test(value))) throw new Error("native_stage_transition_identity_invalid");
  const {lockAnalyticalCompany}=await import("./analytical-privacy.js");
  const {lockMemoryPrivacy}=await import("./memory/memory-privacy.js");
  await lockAnalyticalCompany(tx as unknown as Db,input.companyId);await lockMemoryPrivacy(tx as unknown as Db,input.companyId);
  const [task]=await tx.select({id:issues.id}).from(issues).where(and(eq(issues.companyId,input.companyId),eq(issues.id,input.issueId)))
    .limit(1).for("update");if(!task) throw new Error("native_stage_transition_task_unavailable");
  const [run]=await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,input.companyId),eq(heartbeatRuns.id,input.runId),
    eq(heartbeatRuns.agentId,input.agentId),eq(heartbeatRuns.nativeIssueId,input.issueId),eq(heartbeatRuns.runtimeMode,"native"),
    eq(heartbeatRuns.status,"running"))).limit(1).for("update");
  if(!run) throw new Error("native_stage_transition_run_unavailable");
  const context=record(run.contextSnapshot);
  if(context?.source !== "issue.execution_stage" && !context?.nativeStatusWakeIntentId) return null;
  const profile=record(run.runnerProfileJson),receipt=nativeRunInputSourceReceiptSchema.safeParse(profile?.nativeInputSourceReceipt);
  const stage=receipt.success ? receipt.data.bootstrap.inputs.filter((source):source is NativeTaskWakeSource=>
    source.kind === "native_task_wake" && source.runId === run.id && source.issueId === input.issueId):[];
  const apiReceipt=record(record(record(run.resultJson)?.apiToolReceipts)?.[createHash("sha256").update(input.effect.callId).digest("hex")]);
  if(!receipt.success || !run.responsibleUserId || receipt.data.binding.companyId !== input.companyId ||
    receipt.data.binding.issueId !== input.issueId || receipt.data.binding.runId !== run.id || receipt.data.binding.agentId !== input.agentId ||
    receipt.data.binding.responsibleUserId !== run.responsibleUserId || stage.length !== 1 ||
    input.effect.method !== "POST" || input.effect.pathAndQuery !== `/api/issues/${input.issueId}/comments` ||
    input.effect.operationId !== "POST /api/issues/{id}/comments" || apiReceipt?.state !== "pending" ||
    apiReceipt.nativeEffectClaimConsumed !== true || apiReceipt.digest !== input.effect.apiReceiptDigest ||
    apiReceipt.operationId !== input.effect.operationId) throw new Error("native_stage_transition_effect_unavailable");
  const {assertNativePayloadSourceSetCurrent}=await import("./native-direct-input.js");
  await assertNativePayloadSourceSetCurrent(tx as unknown as Db,{companyId:input.companyId,issueId:input.issueId,runId:run.id,
    actor:{type:"agent",source:"agent_jwt",companyId:input.companyId,agentId:run.agentId,runId:run.id,onBehalfOfUserId:run.responsibleUserId},
    policy:receipt.data.bootstrap.policy,inputs:receipt.data.bootstrap.inputs});
  const origin=await captureNativeStageOrigin(tx,run);if(!origin) throw new Error("native_stage_transition_origin_changed");
  return {version:1,origin,companyId:input.companyId,issueId:input.issueId,runId:run.id,agentId:run.agentId,responsibleUserId:run.responsibleUserId,
    originalReceiptDigest:receipt.data.digest,originalDispatchCount:receipt.data.dispatches.length,
    originalAdditionalInputCount:receipt.data.additionalInputs.length,
    executionInputDigest:receipt.data.bootstrap.executionInputDigest,stageSource:stage[0]!,effect:structuredClone(input.effect)};
}

/** The decision row and transition receipt commit atomically with the comment
 * and Task projection. No output/finalization is manufactured here. */
export async function recordNativeStagePolicyTransition(tx:Transaction,input:{prepared:NativeStageTransitionPreparation;
  decisionId:string;commentId:string;updatedIssue:typeof issues.$inferSelect & {changes?:unknown};
}):Promise<void>{
  const p=input.prepared,changes=record(input.updatedIssue.changes),change=record(changes?.executionState);
  const fromState=parseIssueExecutionState(change?.from),toState=parseIssueExecutionState(change?.to);
  const [decision]=await tx.select().from(issueExecutionDecisions).where(and(eq(issueExecutionDecisions.companyId,p.companyId),
    eq(issueExecutionDecisions.issueId,p.issueId),eq(issueExecutionDecisions.id,input.decisionId),eq(issueExecutionDecisions.createdByRunId,p.runId),
    eq(issueExecutionDecisions.actorAgentId,p.agentId),isNull(issueExecutionDecisions.actorUserId))).limit(1).for("share");
  const [comment]=await tx.select().from(issueComments).where(and(eq(issueComments.companyId,p.companyId),eq(issueComments.issueId,p.issueId),
    eq(issueComments.id,input.commentId),eq(issueComments.createdByRunId,p.runId),eq(issueComments.authorAgentId,p.agentId))).limit(1).for("share");
  const [run]=await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,p.companyId),eq(heartbeatRuns.id,p.runId),
    eq(heartbeatRuns.agentId,p.agentId),eq(heartbeatRuns.nativeIssueId,p.issueId))).limit(1).for("update");
  const result=record(run?.resultJson),receiptKey=createHash("sha256").update(p.effect.callId).digest("hex"),api=record(record(result?.apiToolReceipts)?.[receiptKey]);
  const parsedReceipt=nativeRunInputSourceReceiptSchema.safeParse(record(run?.runnerProfileJson)?.nativeInputSourceReceipt);
  if(!run || !decision || !comment || comment.authorType !== "agent" || comment.authorUserId !== null || !fromState || !toState || !isDeepStrictEqual(fromState,change?.from) || !isDeepStrictEqual(toState,change?.to) ||
    fromState.status !== "pending" || fromState.currentParticipant?.type !== "agent" || fromState.currentParticipant.agentId !== p.agentId ||
    decision.stageId !== fromState.currentStageId || decision.stageType !== fromState.currentStageType || decision.outcome !== toState.lastDecisionOutcome ||
    toState.lastDecisionId !== decision.id || !["approved","changes_requested"].includes(decision.outcome) ||
    !isDeepStrictEqual(input.updatedIssue.executionState,change?.to) || api?.state !== "pending" || api.nativeEffectClaimConsumed !== true ||
    api.digest !== p.effect.apiReceiptDigest || run.responsibleUserId !== p.responsibleUserId || !parsedReceipt.success ||
    parsedReceipt.data.digest!==p.originalReceiptDigest || parsedReceipt.data.dispatches.length!==p.originalDispatchCount ||
    parsedReceipt.data.additionalInputs.length!==p.originalAdditionalInputCount)
    throw new Error("native_stage_transition_owner_changed");
  const originalStage=record(record(record(run.contextSnapshot)?.paperclipWake)?.executionStage);
  const canonical=buildExecutionStageWakeup({issueId:p.issueId,previousState:null,nextState:fromState,interruptedRunId:null,
    requestedByActorType:"agent",requestedByActorId:p.agentId});
  if(!canonical || !isDeepStrictEqual(canonical.wakeup.payload.executionStage,originalStage)) throw new Error("native_stage_transition_generation_changed");
  const captured:NativeStagePolicyTransition={...p,fromState,toState,stageDecisionId:decision.id,
    stageDecisionHash:nativeSha256({...decision,createdAt:decision.createdAt.toISOString(),updatedAt:decision.updatedAt.toISOString()}),
    commentId:comment.id,commentHash:nativeSha256({...comment,createdAt:comment.createdAt.toISOString(),updatedAt:comment.updatedAt.toISOString()})};
  const transitions=record(result?.nativeStagePolicyTransitions) ?? {};
  if(Object.keys(transitions).length>=64 || (transitions[receiptKey] && !isDeepStrictEqual(transitions[receiptKey],captured)))
    throw new Error("native_stage_transition_receipt_conflict");
  transitions[receiptKey]=captured;
  await tx.update(heartbeatRuns).set({resultJson:{...result,nativeStagePolicyTransitions:transitions}})
    .where(and(eq(heartbeatRuns.companyId,p.companyId),eq(heartbeatRuns.id,p.runId)));
}

/** Read-only provenance selected at an authenticated settled-output/parent edge.
 * The current Stage executor cannot use this context to dispatch or mutate. */
export type NativeFinalizedStageConsumption = {
  companyId: string; issueId: string; runId: string; agentId: string; responsibleUserId: string;
  receiptDigest: string; executionInputDigest: string; stageSource: NativeTaskWakeSource; originHash:string;
  apiReceiptId: string; apiReceiptHash: string; callId: string; dispatchId: string; reservationId: string;
  fromState: NonNullable<ReturnType<typeof parseIssueExecutionState>>;
  toState: NonNullable<ReturnType<typeof parseIssueExecutionState>>;
  stageDecisionId: string; stageDecisionHash: string;
  resultId: string; resultHash: string; assessmentId: string; finalizerDecisionId: string;
  finalizerDecisionHash: string; finalizationVersion: string;
  action: { runId: string; receiptId: string; operationId: string; result: unknown };
};

/** Bind a caller's historical trigger to the Stage owner rebuilt from current
 * persisted rows and the actual completed-consumption receipt. */
export function nativeStageContinuationOwnerMatches(input:{candidate:NativeStageTaskContinuationTrigger;
  expected:NativeStageTaskContinuationTrigger;historicalConsumption?:{companyId:string;issueId:string;runId:string;agentId:string;
    responsibleUserId:string;stageSource:{runId:string;issueId:string}}}):boolean{
  const {candidate,expected,historicalConsumption}=input;
  return isDeepStrictEqual(candidate,expected) && (!historicalConsumption ||
    (historicalConsumption.companyId===expected.companyId && historicalConsumption.issueId===expected.issueId &&
      historicalConsumption.runId===expected.runId && historicalConsumption.agentId===expected.agentId &&
      historicalConsumption.responsibleUserId===expected.responsibleUserId &&
      historicalConsumption.stageSource.runId===expected.runId && historicalConsumption.stageSource.issueId===expected.issueId));
}

/** No status-only inference: both the original input and the actual policy API
 * receipt/result/decision must be bound to this same finalized Native Run. */
export async function captureNativeFinalizedStageConsumption(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; reader: AuthorizationActor; readWork?:()=>void;
}): Promise<NativeFinalizedStageConsumption | null> {
  const [entry] = await db.select({ run: heartbeatRuns,
    receiptDigestValid: sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt'->>'digest') =
      encode(sha256(convert_to(((${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt')-'digest')::text,'UTF8')),'hex')`,
    inputDigestValid: sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt'->'bootstrap'->>'executionInputDigest') =
      encode(sha256(convert_to((${heartbeatRuns.runnerProfileJson}->'nativeExecutionInput')::text,'UTF8')),'hex')`,
  }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,input.companyId),eq(heartbeatRuns.id,input.runId),
    eq(heartbeatRuns.nativeIssueId,input.issueId),eq(heartbeatRuns.runtimeMode,"native"))).limit(1).for("share");
  if (!entry || entry.run.nativeInputSourceProtocolVersion !== 1 || !["succeeded","failed","timed_out","cancelled"].includes(entry.run.status) || !entry.run.finishedAt ||
    !entry.run.responsibleUserId || entry.receiptDigestValid !== true || entry.inputDigestValid !== true ||
    !await canActorReadHeartbeatRunPrivacy(db,input.reader,entry.run)) return null;
  const run=entry.run, profile=record(run.runnerProfileJson), receipt=nativeRunInputSourceReceiptSchema.safeParse(profile?.nativeInputSourceReceipt);
  const authority=record(profile?.nativeOpenCodeSourceAuthority);
  if (authority?.version !== 1 || authority.executionInputHash !== nativeSha256(profile?.nativeExecutionInput)) return null;
  if (!receipt.success || receipt.data.binding.companyId !== input.companyId || receipt.data.binding.issueId !== input.issueId ||
    receipt.data.binding.runId !== run.id || receipt.data.binding.agentId !== run.agentId ||
    receipt.data.binding.responsibleUserId !== run.responsibleUserId) return null;
  const stageSources=receipt.data.bootstrap.inputs.filter((value):value is NativeTaskWakeSource=>value.kind === "native_task_wake" && value.runId === run.id && value.issueId === input.issueId);
  const context=record(run.contextSnapshot), wake=record(context?.paperclipWake), originalStage=record(wake?.executionStage);
  if (stageSources.length !== 1 || !wake || !originalStage || context?.source !== "issue.execution_stage" ||
    stageSources[0]!.contentHash !== nativeSha256(wake)) return null;
  input.readWork?.();
  const origin=await captureNativeStageOrigin(db,run);if(!origin) return null;
  const [coordinator]=await db.select().from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.companyId,input.companyId),
    eq(nativeRunFinalizations.runId,run.id),eq(nativeRunFinalizations.issueId,input.issueId),eq(nativeRunFinalizations.phase,"committed"),
    isNull(nativeRunFinalizations.leaseOwner))).limit(1).for("share");
  if (!coordinator?.resultId || !coordinator.assessmentId || !coordinator.decisionId || coordinator.failureCode) return null;
  const [accepted]=await db.select().from(nativeRunResults).where(and(eq(nativeRunResults.companyId,input.companyId),
    eq(nativeRunResults.issueId,input.issueId),eq(nativeRunResults.runId,run.id),eq(nativeRunResults.id,coordinator.resultId),
    eq(nativeRunResults.schemaStatus,"accepted"))).limit(1).for("share");
  const [finalizerDecision]=await db.select().from(statusDecisions).where(and(eq(statusDecisions.companyId,input.companyId),
    eq(statusDecisions.issueId,input.issueId),eq(statusDecisions.runId,run.id),eq(statusDecisions.id,coordinator.decisionId),
    eq(statusDecisions.assessmentId,coordinator.assessmentId),eq(statusDecisions.applicationState,"applied"),
    isNotNull(statusDecisions.appliedAt))).limit(1).for("share");
  const runResult=record(run.resultJson);
  const acceptedEnvelope=record(accepted?.resultJson),acceptedResult=record(acceptedEnvelope?.result),acceptedTerminal=record(acceptedEnvelope?.terminal);
  if (!accepted || !finalizerDecision || acceptedResult?.schema !== "paperclip.run_result.v1" ||
    !acceptedTerminal || acceptedTerminal.reportedWorkDisposition !== acceptedResult.reportedWorkDisposition || !((acceptedTerminal.runTerminalState === "succeeded" && run.status === "succeeded" && acceptedTerminal.turnTerminalState === "completed") ||
      (acceptedTerminal.runTerminalState === "failed" && ["failed","timed_out"].includes(run.status) && acceptedTerminal.turnTerminalState === "failed") ||
      (acceptedTerminal.runTerminalState === "cancelled" && run.status === "cancelled" && ["cancelled","interrupted"].includes(String(acceptedTerminal.turnTerminalState)))) || accepted.completionContractId !== run.completionContractId ||
    runResult?.decisionId !== finalizerDecision.id || runResult.finalizationPhase !== "committed") return null;
  const { acceptedResponseDigestMatches }=await import("./native-runtime/native-run-finalizer.js");
  if (!await acceptedResponseDigestMatches(db,run,accepted)) return null;
  const receipts=record(runResult.apiToolReceipts),transitions=record(runResult.nativeStagePolicyTransitions);
  if (!receipts || !transitions || Object.keys(receipts).length > 512 || Object.keys(transitions).length > 64) return null;
  const candidates=[];
  for (const [receiptId,raw] of Object.entries(receipts)) {
    input.readWork?.();
    const api=record(raw), result=record(api?.result), data=record(result?.data),transition=record(transitions[receiptId]),effect=record(transition?.effect);
    if (api?.operationId !== "POST /api/issues/{id}/comments" || api.state !== "completed" || result?.ok !== true || result.status !== 201 ||
      !transition || Object.keys(transition).sort().join(",") !==
        "agentId,commentHash,commentId,companyId,effect,executionInputDigest,fromState,issueId,origin,originalAdditionalInputCount,originalDispatchCount,originalReceiptDigest,responsibleUserId,runId,stageDecisionHash,stageDecisionId,stageSource,toState,version" ||
      transition.version !== 1 || transition.companyId !== input.companyId || transition.issueId !== input.issueId || transition.runId !== run.id ||
      transition.agentId !== run.agentId || transition.responsibleUserId !== run.responsibleUserId ||
      !Number.isSafeInteger(transition.originalDispatchCount) || !Number.isSafeInteger(transition.originalAdditionalInputCount) ||
      transition.originalDispatchCount<0 || transition.originalAdditionalInputCount<0 ||
      transition.executionInputDigest !== receipt.data.bootstrap.executionInputDigest ||
      !isDeepStrictEqual(transition.stageSource,stageSources[0]) || !isDeepStrictEqual(transition.origin,origin) || !effect ||
      Object.keys(effect).sort().join(",") !== "apiReceiptDigest,attempt,bodyHash,bodyPresent,callId,controllerBootId,controllerPid,controllerProcessStartedAt,dispatchId,eventSeq,leaseExpiresAt,leaseOwner,method,operationId,pathAndQuery,tool,turnId" ||
      effect.tool !== "call_api" || effect.method !== "POST" || effect.pathAndQuery !== `/api/issues/${input.issueId}/comments` ||
      effect.operationId !== api.operationId || effect.apiReceiptDigest !== api.digest || effect.bodyHash !== api.bodyHash || effect.bodyPresent !== true ||
      !["callId","dispatchId","eventSeq","attempt","turnId","method","pathAndQuery"].every(key=>effect[key] === api[key]) ||
      typeof effect.leaseOwner !== "string" || !effect.leaseOwner || typeof effect.controllerBootId !== "string" || !effect.controllerBootId ||
      !Number.isSafeInteger(effect.controllerPid) || Number(effect.controllerPid)<=0 ||
      typeof effect.leaseExpiresAt !== "string" || !Number.isFinite(Date.parse(effect.leaseExpiresAt)) ||
      typeof effect.controllerProcessStartedAt !== "string" || !Number.isFinite(Date.parse(effect.controllerProcessStartedAt)) ||
      data?.id !== transition.commentId || data.companyId !== input.companyId || data.issueId !== input.issueId || data.createdByRunId !== run.id ||
      api.method !== "POST" || api.pathAndQuery !== `/api/issues/${input.issueId}/comments` || typeof api.turnId !== "string" || !api.turnId ||
      typeof api.dispatchId !== "string" || !/^[a-f0-9-]{36}$/i.test(api.dispatchId) || !Number.isSafeInteger(api.eventSeq) || !Number.isSafeInteger(api.attempt) ||
      typeof api.callId !== "string" || !/^[\x21-\x7e]{1,240}$/.test(api.callId) || createHash("sha256").update(api.callId).digest("hex") !== receiptId ||
      typeof api.bodyHash !== "string" || !/^[a-f0-9]{64}$/.test(api.bodyHash) || typeof api.digest !== "string" || !/^[a-f0-9]{64}$/.test(api.digest)) continue;
    if(!await nativeRunInputSourceReceiptPrefixMatches(db,{receipt:receipt.data,
      originalDigest:transition.originalReceiptDigest,dispatchCount:transition.originalDispatchCount,
      additionalInputCount:transition.originalAdditionalInputCount})) continue;
    const stateChange={from:transition.fromState,to:transition.toState};
    const fromState=parseIssueExecutionState(stateChange?.from),toState=parseIssueExecutionState(stateChange?.to);
    if (!fromState || !toState || !isDeepStrictEqual(fromState,stateChange?.from) || !isDeepStrictEqual(toState,stateChange?.to) || fromState.status !== "pending" || fromState.currentParticipant?.type !== "agent" ||
      fromState.currentParticipant.agentId !== run.agentId || !toState.lastDecisionId ||
      !["approved","changes_requested"].includes(toState.lastDecisionOutcome ?? "") ||
      !isDeepStrictEqual(transition.stageDecisionId,toState.lastDecisionId)) continue;
    const originalIntent=String(context?.nativeStatusWakeIntentId ?? "");
    const originalWake=buildExecutionStageWakeup({issueId:input.issueId,previousState:null,nextState:fromState,interruptedRunId:null,
      requestedByActorType:"agent",requestedByActorId:run.agentId});
    if (!originalIntent || !originalWake || originalWake.agentId !== run.agentId ||
      !isDeepStrictEqual(originalWake.wakeup.payload.executionStage,originalStage)) continue;
    const [stageDecision]=await db.select().from(issueExecutionDecisions).where(and(eq(issueExecutionDecisions.companyId,input.companyId),
      eq(issueExecutionDecisions.issueId,input.issueId),eq(issueExecutionDecisions.id,toState.lastDecisionId),
      eq(issueExecutionDecisions.createdByRunId,run.id),eq(issueExecutionDecisions.actorAgentId,run.agentId),
      isNull(issueExecutionDecisions.actorUserId))).limit(1).for("share");
    if (!stageDecision || stageDecision.stageId !== fromState.currentStageId || stageDecision.stageType !== fromState.currentStageType ||
      stageDecision.outcome !== toState.lastDecisionOutcome || stageDecision.createdAt < run.createdAt || stageDecision.createdAt > run.finishedAt!) continue;
    const [comment]=await db.select().from(issueComments).where(and(eq(issueComments.companyId,input.companyId),
      eq(issueComments.issueId,input.issueId),eq(issueComments.id,String(transition.commentId)),eq(issueComments.createdByRunId,run.id),
      eq(issueComments.authorAgentId,run.agentId))).limit(1).for("share");
    if(!comment || comment.authorType !== "agent" || comment.authorUserId !== null || transition.commentHash !== nativeSha256({...comment,createdAt:comment.createdAt.toISOString(),updatedAt:comment.updatedAt.toISOString()}) ||
      transition.stageDecisionHash !== nativeSha256({...stageDecision,createdAt:stageDecision.createdAt.toISOString(),updatedAt:stageDecision.updatedAt.toISOString()})) continue;
    const {operationId:_operationId,...publicResult}=result;
    if (api.providerResultDigest !== nativeSha256(nativeCallApiResultEnvelope(api.callId,{...publicResult,apiOperationId:api.operationId}))) continue;
    const associations=Array.isArray(profile?.nativeToolCallDispatchAssociations)?profile.nativeToolCallDispatchAssociations.map(record).filter(v=>
      v?.callId === api.callId && v.tool === "call_api" && v.turnId === api.turnId && v.eventSeq === api.eventSeq && v.attempt === api.attempt && v.dispatchId === api.dispatchId):[];
    const intents=Array.isArray(profile?.nativeAwModelWireIntents)?profile.nativeAwModelWireIntents.map(record).flatMap(intent=>{
      const uses=Array.isArray(intent?.responseToolUses)?intent.responseToolUses.map(record):[];
      return uses.filter(use=>use?.id === api.callId && typeof use.name === "string" && use.name.replace(/^(?:paperclip__|paperclip_|paperclip\.)/, "") === "call_api" && use.argumentsHash === associations[0]?.argumentsHash).map(use=>({intent,use}));}):[];
    const dispatches=Array.isArray(profile?.nativeModelInputDispatchIntents)?profile.nativeModelInputDispatchIntents.map(record).filter(v=>
      v?.dispatchId === api.dispatchId && v.turnId === api.turnId && v.eventSeq === api.eventSeq && v.attempt === api.attempt && v.responsibleUserId === run.responsibleUserId):[];
    const onlyAssociation=associations[0],onlyIntent=intents[0]?.intent,onlyDispatch=dispatches[0];
    if (associations.length !== 1 || intents.length !== 1 || dispatches.length !== 1 || !onlyAssociation || !onlyIntent || !onlyDispatch ||
      typeof onlyAssociation.argumentsHash !== "string" || !/^[a-f0-9]{64}$/.test(onlyAssociation.argumentsHash) ||
      typeof onlyDispatch.turnInputDigest !== "string" || !/^[a-f0-9]{64}$/.test(onlyDispatch.turnInputDigest) ||
      onlyIntent.sourceDispatchDigest !== onlyDispatch.turnInputDigest || onlyIntent.modelPurpose !== "worker_model" || typeof onlyIntent.reservationId !== "string") continue;
    const [reservation]=await db.select().from(orchestrationModelReservations).where(and(eq(orchestrationModelReservations.companyId,input.companyId),
      eq(orchestrationModelReservations.purpose,"worker_model"),eq(orchestrationModelReservations.id,onlyIntent.reservationId),
      eq(orchestrationModelReservations.status,"completed"))).limit(1).for("share");
    if (!reservation || reservation.inputHash !== onlyIntent.requestHash ||
      onlyIntent.sourcePolicyHash !== nativeSha256(receipt.data.bootstrap) ||
      !receipt.data.dispatches.some(dispatch=>dispatch.inputs.some(source=>source.kind === "worker_model_dispatch" &&
        source.runId === run.id && source.reservationId === reservation.id && source.callId === onlyIntent.callId &&
        source.requestHash === reservation.inputHash && source.wireBodyHash === onlyIntent.wireBodyHash &&
        source.responseHash === reservation.providerResponseHash))) continue;
    const action=await createRunSecretRedactionRegistry(db as Db).redactForIssue(input.companyId,input.issueId,
      {runId:run.id,receiptId,operationId:String(api.operationId),result:api.result});
    if (Buffer.byteLength(JSON.stringify(action),"utf8") > 64_000) continue;
    candidates.push({companyId:input.companyId,issueId:input.issueId,runId:run.id,agentId:run.agentId,responsibleUserId:run.responsibleUserId!,
      receiptDigest:receipt.data.digest,executionInputDigest:receipt.data.bootstrap.executionInputDigest,stageSource:stageSources[0]!,originHash:nativeSha256(origin),
      apiReceiptId:receiptId,apiReceiptHash:nativeSha256(api),callId:api.callId,dispatchId:String(api.dispatchId),reservationId:reservation.id,
      fromState,toState,stageDecisionId:stageDecision.id,stageDecisionHash:nativeSha256({...stageDecision,
        createdAt:stageDecision.createdAt.toISOString(),updatedAt:stageDecision.updatedAt.toISOString()}),resultId:accepted.id,
      resultHash:accepted.canonicalSha256,assessmentId:coordinator.assessmentId,finalizerDecisionId:finalizerDecision.id,
      finalizerDecisionHash:nativeSha256({...finalizerDecision,createdAt:finalizerDecision.createdAt.toISOString(),appliedAt:finalizerDecision.appliedAt?.toISOString()}),
      finalizationVersion:coordinator.updatedAt.toISOString(),action});
  }
  return candidates.length === 1 ? candidates[0]! : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function nonEmpty(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function sameStage(left: unknown, right: unknown): boolean {
  return left !== null && left !== undefined && right !== null && right !== undefined && nativeSha256(left) === nativeSha256(right);
}
