import { and, eq } from "drizzle-orm";
import { agentWakeupRequests, heartbeatRuns, issues, statusDecisionEffects, statusDecisions, type Db } from "@paperclipai/db";
import { buildExecutionStageWakeup } from "./issue-execution-stage-wakeup.js";
import { parseIssueExecutionState } from "./issue-execution-policy.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { captureNativeTaskWakeSource, exactNativeTaskContinuation } from "./native-runtime/native-execution-input.js";
import type { NativePayloadSourceInput } from "@paperclipai/shared";

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
    contextSnapshot.wakeReason !== payload.reason || !sameStage(contextSnapshot.executionStage, stage) ||
    !sameStage(contextSnapshot.paperclipWake, payload)) return null;

  const [reviewerRun] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId),
    eq(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.nativeIssueId, input.issueId),
  )).limit(1).for("share");
  if (!reviewerRun || !reviewerRun.agentId || !reviewerRun.wakeupRequestId) return null;
  const reviewerContext = record(reviewerRun.contextSnapshot);
  if (reviewerContext?.nativeStatusWakeIntentId !== intentId || reviewerContext.source !== "issue.execution_stage" ||
    reviewerContext.statusDecisionSource !== "native_status_decision" || reviewerContext.issueId !== input.issueId ||
    reviewerContext.taskId !== input.issueId || reviewerContext.wakeReason !== payload.reason ||
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
    intent.reason !== payload.reason || intent.reason !== reviewerContext.wakeReason ||
    intentContext?.source !== "issue.execution_stage" || intentContext.wakeReason !== intent.reason ||
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
  if (!currentIssue || currentIssue.lastStatusDecisionId !== decision.id || currentIssue.status !== decision.toStatus ||
    currentIssue.assigneeAgentId !== reviewerRun.agentId) return null;
  const currentState = parseIssueExecutionState(currentIssue.executionState);
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function nonEmpty(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function sameStage(left: unknown, right: unknown): boolean {
  return left !== null && left !== undefined && right !== null && right !== undefined && nativeSha256(left) === nativeSha256(right);
}
