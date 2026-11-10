import { and, asc, desc, eq, getTableColumns, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  agentWakeupRequests,
  heartbeatRuns,
  heartbeatRunEvents,
  issueComments,
  issueRecoveryActions,
  nativeRunFinalizations, nativeRunResults, statusDecisions,
  issueThreadInteractions,
  orchestrationModelReservations, orchestrationWorkerAttempts, orchestrationWorkers, orchestrationPlans,
  issues,
  type Db,
} from "@paperclipai/db";
import { nativeRunInputSourceReceiptSchema, type NativeRunInputSourceReceipt, type ExecutionContinuationEnvelope } from "@paperclipai/shared";
import { sanitizeQuarantinedCommentForHigherTrust } from "./source-trust.js";
import { hasConversationContinuationPolicy } from "./conversation-continuation.js";
import { queuedCommentIdsFromWakePayload } from "./issue-queued-comment-queue.js";
import { childReviewOutcomes } from "./native-runtime/child-review-outcomes.js";
import { canActorReadHeartbeatRunPrivacy, type AuthorizationActor } from "./authorization.js";
import { createRunSecretRedactionRegistry } from "./run-secret-redaction.js";
import { nativeContinuationCommentProjection, nativeContinuationMessageHash, nativeTaskWakeOriginCommentIds, nativeTaskWakeInteraction, nativeSha256 } from "./native-runtime/canonical.js";
import { readNativeManualQueueAdoption } from "./native-runtime/manual-queue-adoption.js";
import { hasAcknowledgedNativeStopIntent } from "./acknowledged-native-stop.js";
import { isExactUnknownNativeTextCharge } from "./native-text-unknown-charge.js";
import type { NativeCommentSourceCapture } from "./agent-conversations.js";

/** A snapshot of the actual receiver and final redacted owner rendition; not
 * an authority boolean. Consumers still validate every source owner/current ACL. */
/** A Stage trigger is selected only by the persisted Stage owner. Readers
 * reconstruct every field; this projection is not itself execution authority. */
export type NativeStageTaskContinuationTrigger = {
  version: 1; companyId: string; issueId: string; runId: string; agentId: string;
  responsibleUserId: string; wakeupRequestId: string; intentId: string; effectId: string;
  decisionId: string; executorRunId: string; executorAgentId: string;
  reason: "execution_review_requested" | "execution_approval_requested";
  stageHash: string; chainHash: string; taskObjective: string;
};

export type NativeTaskContinuationCapture = {
  companyId: string; issueId: string; agentId: string; runId: string;
  responsibleUserId: string; wakeupRequestId: string;
  envelope: ExecutionContinuationEnvelope; commentSources: NativeCommentSourceCapture[];
  delivery?: import("./tool-action-delivery.js").NativeToolActionDeliveryCapture;
  finalizedSummary?: NativeFinalizedContinuationSummaryCapture;
  previousContext?: { runId: string; messages: ExecutionContinuationEnvelope["messages"] };
  retainedSource?: Extract<import("@paperclipai/shared").NativePayloadSourceInput, { kind: "retained_run" }>;
  summary?: { rawTrustHash: string; source: import("./documents.js").DocumentRevisionSourceCapture;
    rendition: { key: string; title: string | null; body: string;
      sourceTrust: import("@paperclipai/shared").SourceTrustMetadata | null; updatedAt: string } };
  currentHumanAssignment?: { companyId: string; issueId: string; agentId: string; responsibleUserId: string };
  stageActions?: import("./native-stage-wake-source.js").NativeFinalizedStageConsumption[];
  pendingInteractions?: import("./native-runtime/native-interaction-bridge.js").NativeGovernedPendingInteractionCapture[];
  governedInteractions?: import("./native-runtime/native-interaction-bridge.js").NativeGovernedInteractionContinuationCapture[];
  answeredQuestions?: import("./native-runtime/native-interaction-bridge.js").NativeAnsweredQuestionContinuationCapture[];
  humanReviewWithdrawals?: import("./native-runtime/native-interaction-bridge.js").NativeHumanReviewWithdrawalCapture[];
  adminExpiredInteractions?: import("./native-runtime/native-interaction-bridge.js").NativeAdministrativeInteractionExpiryCapture[];
  acceptedPlanReview?: import("./native-runtime/accepted-plan-review-source.js").NativeAcceptedPlanReviewCapture;
  /** Persisted Human admission for one fresh turn after a stopped Native Text
   * request with an unresolved provider charge. This never carries the result. */
  explicitHumanSource?: { version: 1; companyId: string; issueId: string; receiverRunId: string; sourceRunId: string;
    actorId: string; commentId: string; recoveryActionId: string; reservationId: string;
    recoveryActionCause: "uncertain_provider_action"; recoveryActionStatus: "resolved"; recoveryActionOutcome: "cancelled";
    recoveryReplay: "explicit_user_continuation";
    sourceStatus: "cancelled"; sourceRuntimeMode: "native"; sourceDriverKind: "aw_text_messages"; sourceStopReceiptHash: string;
    reservationStatus: "unknown"; reservationPurpose: "worker_model";
    reservationRequestHash: string; reservationInputHash: string; providerBodyHash: string };
  wake: { requestedByActorType: string | null; requestedByActorId: string | null; reason: string | null; originCommentIds: string[];
    interaction?: NonNullable<ReturnType<typeof nativeTaskWakeInteraction>>;
    manualQueueAdoption?: import("./native-runtime/manual-queue-adoption.js").NativeManualQueueAdoption };
};

/** Reconstructs the only admitted explicit continuation after an unknown
 * Native Text charge. Called by both bootstrap capture and current-source
 * validation; a saved descriptor is never accepted as proof. */
export async function captureNativeExplicitHumanSource(input: {
  db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0]; companyId: string; issueId: string;
  agentId: string; receiverRunId: string; context: Record<string, unknown>;
  envelope: ExecutionContinuationEnvelope; historicalSourceRead?: boolean;
}): Promise<NativeTaskContinuationCapture["explicitHumanSource"] | undefined> {
  const continuation = object(input.context.explicitUserContinuation);
  const sourceRunId = string(continuation.previousRunId), commentId = string(continuation.commentId);
  if (!sourceRunId || !commentId || input.envelope.completedWork !== null ||
      input.envelope.trigger?.sourceRunId !== sourceRunId || input.envelope.interruptedRunId !== sourceRunId) return undefined;
  const [receiver] = await input.db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.id, input.receiverRunId), eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.agentId, input.agentId),
    ...(input.historicalSourceRead ? [eq(heartbeatRuns.nativeIssueId, input.issueId),
      eq(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.driverKind, "aw_text_messages")] : []),
    eq(heartbeatRuns.status, input.historicalSourceRead ? "succeeded" : "running"),
  )).limit(1);
  if (!receiver?.responsibleUserId || !receiver.wakeupRequestId || receiver.id !== input.receiverRunId) return undefined;
  if (!input.historicalSourceRead) {
    const [issue] = await input.db.select().from(issues).where(and(
      eq(issues.companyId, input.companyId), eq(issues.id, input.issueId),
    )).limit(1);
    if (!issue || receiver.responsibleUserId !== issue.responsibleUserId || issue.assigneeAgentId !== input.agentId)
      return undefined;
  }
  const [wake] = await input.db.select().from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.id, receiver.wakeupRequestId), eq(agentWakeupRequests.companyId, input.companyId),
    eq(agentWakeupRequests.agentId, input.agentId), eq(agentWakeupRequests.runId, receiver.id),
  )).limit(1);
  if (!wake || wake.requestedByActorType !== "user" || !wake.requestedByActorId ||
      wake.requestedByActorId !== receiver.responsibleUserId || wake.reason !== "issue_commented" ||
      !nativeTaskWakeOriginCommentIds(wake.payload).includes(commentId)) return undefined;
  const [sourceComment] = await input.db.select().from(issueComments).where(and(
    eq(issueComments.companyId, input.companyId), eq(issueComments.issueId, input.issueId),
    eq(issueComments.authorType, "user"), isNull(issueComments.createdByRunId),
    isNull(issueComments.deletedAt),
    ...(input.historicalSourceRead ? [eq(issueComments.id, commentId)] : []),
  )).orderBy(desc(issueComments.createdAt), desc(issueComments.id)).limit(1);
  if (!sourceComment || (!input.historicalSourceRead && sourceComment.id !== commentId) ||
      sourceComment.authorUserId !== wake.requestedByActorId || !sourceComment.body.trim()) return undefined;
  const [source] = await input.db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, sourceRunId),
    eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.runtimeMode, "native"),
    eq(heartbeatRuns.driverKind, "aw_text_messages"), eq(heartbeatRuns.nativeIssueId, input.issueId),
    eq(heartbeatRuns.status, "cancelled"),
  )).limit(1);
  if (!source || !hasAcknowledgedNativeStopIntent(source)) return undefined;
  const [action, ...otherActions] = await input.db.select().from(issueRecoveryActions).where(and(
    eq(issueRecoveryActions.companyId, input.companyId), eq(issueRecoveryActions.sourceIssueId, input.issueId),
    eq(issueRecoveryActions.status, "resolved"), eq(issueRecoveryActions.outcome, "cancelled"),
    eq(issueRecoveryActions.cause, "uncertain_provider_action"),
    sql`${issueRecoveryActions.evidence}->'explicitUserContinuation'->>'runId'=${receiver.id}`,
    sql`${issueRecoveryActions.evidence}->'explicitUserContinuation'->>'previousRunId'=${sourceRunId}`,
    sql`${issueRecoveryActions.evidence}->'explicitUserContinuation'->>'commentId'=${commentId}`,
    sql`${issueRecoveryActions.evidence}->'explicitUserContinuation'->>'actorId'=${wake.requestedByActorId}`,
  )).limit(2);
  if (!action || otherActions.length) return undefined;
  const auth = object(action?.evidence.explicitUserContinuation);
  const reservationId = string(action?.evidence.modelReservationId);
  if (!action || !reservationId || auth.runId !== receiver.id || auth.previousRunId !== sourceRunId ||
      auth.commentId !== commentId || auth.actorId !== wake.requestedByActorId) return undefined;
  const [reservation] = await input.db.select().from(orchestrationModelReservations).where(and(
    eq(orchestrationModelReservations.companyId, input.companyId), eq(orchestrationModelReservations.id, reservationId),
    eq(orchestrationModelReservations.purpose, "worker_model"), eq(orchestrationModelReservations.status, "unknown"),
  )).limit(1);
  const [binding] = reservation?.workerAttemptId && reservation.planId ? await input.db.select({
    runId: orchestrationWorkerAttempts.runId, agentId: orchestrationWorkerAttempts.agentId,
    planIssueId: orchestrationPlans.issueId, workerIssueId: orchestrationWorkers.issueId,
    workerAgentId: orchestrationWorkers.agentId,
  }).from(orchestrationWorkerAttempts).innerJoin(orchestrationWorkers, and(
    eq(orchestrationWorkers.companyId, orchestrationWorkerAttempts.companyId),
    eq(orchestrationWorkers.id, orchestrationWorkerAttempts.workerId),
  )).innerJoin(orchestrationPlans, and(
    eq(orchestrationPlans.companyId, orchestrationWorkerAttempts.companyId),
    eq(orchestrationPlans.id, orchestrationWorkerAttempts.planId),
  )).where(and(eq(orchestrationWorkerAttempts.companyId, input.companyId),
    eq(orchestrationWorkerAttempts.id, reservation.workerAttemptId), eq(orchestrationWorkerAttempts.planId, reservation.planId))).limit(1) : [];
  const providerWireReceipt = object(reservation?.providerWireReceipt);
  if (!reservation || !binding || typeof reservation.requestHash !== "string" || typeof reservation.inputHash !== "string" ||
      typeof providerWireReceipt.bodySha256 !== "string" || !isExactUnknownNativeTextCharge({ run: source,
        issueId: input.issueId, actionCause: action.cause, actionEvidence: action.evidence, reservation, binding,
        wireIntents: object(source.runnerProfileJson).nativeAwModelWireIntents, expectedReplay: "explicit_user_continuation" }))
    return undefined;
  return { version: 1, companyId: input.companyId, issueId: input.issueId, receiverRunId: receiver.id, sourceRunId: source.id,
    actorId: wake.requestedByActorId, commentId, recoveryActionId: action.id, reservationId: reservation.id,
    recoveryActionCause: "uncertain_provider_action", recoveryActionStatus: "resolved", recoveryActionOutcome: "cancelled",
    recoveryReplay: "explicit_user_continuation", sourceStatus: "cancelled", sourceRuntimeMode: "native",
    sourceDriverKind: "aw_text_messages", sourceStopReceiptHash: nativeSha256(object(source.resultJson).nativeCancellation),
    reservationStatus: "unknown", reservationPurpose: "worker_model", reservationRequestHash: reservation.requestHash,
    reservationInputHash: reservation.inputHash, providerBodyHash: providerWireReceipt.bodySha256 };
}

/** A low-trust summary of one actual finalized Native result. Its parent
 * receipt is recursively revalidated for the current reader, never a Run grant. */
export type NativeFinalizedContinuationSummaryCapture = {
  companyId: string; issueId: string; agentId: string; receiverRunId: string; sourceRunId: string;
  resultId: string; resultCanonicalSha256: string; resultCreatedAt: string;
  finalizationVersion: string; assessmentId: string; decisionId: string; decisionDigest: string; decisionSnapshotHash: string;
  parentReceipt: NativeRunInputSourceReceipt; body: string;
  stageEntryRead?: import("./native-stage-task-body-source.js").NativeFinalizedStageTaskBodyRead;
};

export type NativeAcceptedFinalizedSummaryOwner = Omit<NativeFinalizedContinuationSummaryCapture, "receiverRunId" | "stageEntryRead">;
export type NativeAcceptedFinalizedPresentationCommentOwner = {
  commentSourceIdentity: Extract<import("@paperclipai/shared").NativePayloadSourceInput, { kind: "comment" }>;
  acceptedSummaryOwner: NativeAcceptedFinalizedSummaryOwner;
};

/** Read one producer's committed accepted result without inventing a receiving
 * Run. Callers still revalidate every parent receipt source for their reader. */
export async function captureNativeAcceptedFinalizedSummaryOwner(input: {
  db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0]; companyId: string; issueId: string;
  agentId: string; sourceRunId: string; reader: AuthorizationActor;
}): Promise<{ owner: NativeAcceptedFinalizedSummaryOwner; sourceRun: typeof heartbeatRuns.$inferSelect } | null> {
  const [source] = await input.db.select({ run: heartbeatRuns,
    receiptDigestValid: sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt'->>'digest') =
      encode(sha256(convert_to(((${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt')-'digest')::text,'UTF8')),'hex')`,
    inputDigestValid: sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt'->'bootstrap'->>'executionInputDigest') =
      encode(sha256(convert_to((${heartbeatRuns.runnerProfileJson}->'nativeExecutionInput')::text,'UTF8')),'hex')`,
  }).from(heartbeatRuns).where(and(eq(heartbeatRuns.id, input.sourceRunId), eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.nativeIssueId, input.issueId),
    eq(heartbeatRuns.runtimeMode, "native"))).for("share");
  if (!source || source.run.nativeInputSourceProtocolVersion !== 1 || !source.run.finishedAt ||
    source.run.status !== "succeeded" || source.run.nativePhase !== "committed" || source.run.nativeProcessCleanupPending !== false ||
    source.receiptDigestValid !== true || source.inputDigestValid !== true ||
    !await canActorReadHeartbeatRunPrivacy(input.db, input.reader, source.run)) return null;
  const [coordinator] = await input.db.select().from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.runId, source.run.id),
    eq(nativeRunFinalizations.companyId, input.companyId), eq(nativeRunFinalizations.issueId, input.issueId),
    eq(nativeRunFinalizations.phase, "committed"), isNull(nativeRunFinalizations.leaseOwner))).for("share");
  if (!coordinator?.resultId || !coordinator.assessmentId || !coordinator.decisionId || coordinator.failureCode) return null;
  const [accepted] = await input.db.select().from(nativeRunResults).where(and(eq(nativeRunResults.id, coordinator.resultId),
    eq(nativeRunResults.companyId, input.companyId), eq(nativeRunResults.issueId, input.issueId), eq(nativeRunResults.runId, source.run.id),
    eq(nativeRunResults.schemaStatus, "accepted"))).for("share");
  const [decision] = await input.db.select().from(statusDecisions).where(and(eq(statusDecisions.id, coordinator.decisionId),
    eq(statusDecisions.companyId, input.companyId), eq(statusDecisions.issueId, input.issueId), eq(statusDecisions.runId, source.run.id),
    eq(statusDecisions.assessmentId, coordinator.assessmentId), eq(statusDecisions.applicationState, "applied"), isNotNull(statusDecisions.appliedAt))).for("share");
  const profile = object(source.run.runnerProfileJson), receipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  if (!accepted || !decision || !receipt.success || accepted.completionContractId !== source.run.completionContractId ||
    receipt.data.binding.companyId !== input.companyId || receipt.data.binding.issueId !== input.issueId ||
    receipt.data.binding.agentId !== input.agentId || receipt.data.binding.runId !== source.run.id ||
    receipt.data.binding.responsibleUserId !== source.run.responsibleUserId ||
    object(source.run.resultJson).decisionId !== decision.id || object(source.run.resultJson).finalizationPhase !== "committed") return null;
  const { acceptedResponseDigestMatches } = await import("./native-runtime/native-run-finalizer.js");
  if (!await acceptedResponseDigestMatches(input.db, source.run, accepted)) return null;
  const acceptedResult = object(object(accepted.resultJson).result);
  const rawSummary = string(object(object(source.run.resultJson).nativeResult).summary) ?? string(object(source.run.resultJson).summary);
  if (acceptedResult.schema !== "paperclip.run_result.v1" || !rawSummary || rawSummary !== acceptedResult.summary) return null;
  const sets = [receipt.data.bootstrap, ...receipt.data.dispatches, ...receipt.data.additionalInputs];
  if (sets.length > 64) return null;
  const body = await createRunSecretRedactionRegistry(input.db as Db).redactForIssue(input.companyId, input.issueId, rawSummary.slice(0, 32_000));
  return { sourceRun: source.run, owner: { companyId: input.companyId, issueId: input.issueId, agentId: input.agentId,
    sourceRunId: source.run.id, resultId: accepted.id, resultCanonicalSha256: accepted.canonicalSha256,
    resultCreatedAt: accepted.createdAt.toISOString(), finalizationVersion: coordinator.updatedAt.toISOString(),
    assessmentId: coordinator.assessmentId, decisionId: decision.id, decisionDigest: decision.decisionDigest,
    decisionSnapshotHash: nativeSha256({decisionVersion:decision.decisionVersion, policyVersion:decision.policyVersion,
      fromStatus:decision.fromStatus,toStatus:decision.toStatus,reasonCode:decision.reasonCode, decisionJson:decision.decisionJson,
      applicationState:decision.applicationState,appliedAt:decision.appliedAt?.toISOString()}), parentReceipt: receipt.data, body } };
}

export async function captureNativeAcceptedFinalizedPresentationCommentOwner(input: {
  db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0]; companyId: string; issueId: string;
  commentId: string; reader: AuthorizationActor;
}): Promise<NativeAcceptedFinalizedPresentationCommentOwner | null> {
  const [comment] = await input.db.select({ ...getTableColumns(issueComments),
    sourceVersion: sql<string>`extract(epoch from ${issueComments.updatedAt})::text` }).from(issueComments).where(and(
      eq(issueComments.companyId, input.companyId), eq(issueComments.issueId, input.issueId),
      eq(issueComments.id, input.commentId), isNull(issueComments.deletedAt))).for("share");
  if (!comment || comment.authorType !== "agent" || !comment.authorAgentId || !comment.createdByRunId) return null;
  const selected = await captureNativeAcceptedFinalizedSummaryOwner({ db: input.db, companyId: input.companyId,
    issueId: input.issueId, agentId: comment.authorAgentId, sourceRunId: comment.createdByRunId, reader: input.reader });
  if (!selected || selected.owner.body !== comment.body) return null;
  const presentation = object(object(selected.sourceRun.resultJson).presentationDecision);
  if (presentation.schema !== "paperclip.run_presentation_decision.v1" || presentation.commentAction !== "create" ||
    presentation.commentId !== comment.id || !Array.isArray(presentation.reasonCodes) ||
    !presentation.reasonCodes.includes("resolved_response_materialized")) return null;
  const events = await input.db.select({ payload: heartbeatRunEvents.payload }).from(heartbeatRunEvents).where(and(
    eq(heartbeatRunEvents.companyId, input.companyId), eq(heartbeatRunEvents.runId, comment.createdByRunId),
    eq(heartbeatRunEvents.eventType, "run.presentation.resolved"))).limit(2).for("share");
  if (events.length !== 1 || !isDeepStrictEqual(object(events[0]!.payload).presentationDecision, presentation)) return null;
  const committed = object(object(selected.sourceRun.resultJson).nativeCommittedChatResponse);
  if (Object.keys(committed).length && (committed.schema !== "paperclip.native_committed_chat_response.v1" ||
    committed.resultId !== selected.owner.resultId || committed.canonicalSha256 !== selected.owner.resultCanonicalSha256 ||
    committed.decisionId !== selected.owner.decisionId)) return null;
  const safe = sanitizeQuarantinedCommentForHigherTrust(comment);
  const projection = nativeContinuationCommentProjection({ ...comment, body: safe.body });
  const redacted = await createRunSecretRedactionRegistry(input.db as Db).redactForIssue(input.companyId, input.issueId, projection);
  return { commentSourceIdentity: { kind: "comment", issueId: input.issueId, commentId: comment.id,
      sourceVersion: comment.sourceVersion, contentHash: nativeContinuationMessageHash(redacted) },
    acceptedSummaryOwner: selected.owner };
}

export async function captureNativeFinalizedContinuationSummary(input: {
  db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0]; companyId: string; issueId: string; agentId: string; receiverRunId: string; sourceRunId: string; reader?: AuthorizationActor;
  stageEntryRead?: import("./native-stage-task-body-source.js").NativeFinalizedStageTaskBodyRead;
  stageTrigger?: NativeStageTaskContinuationTrigger;
  historicalConsumption?: import("./native-stage-wake-source.js").NativeFinalizedStageConsumption;
  readWork?: () => void;
}): Promise<NativeFinalizedContinuationSummaryCapture | null> {
  let receiver: typeof heartbeatRuns.$inferSelect | undefined;
  if (input.stageEntryRead) {
    if (!input.reader || !input.stageTrigger) return null;
    const [selectedReceiver] = await input.db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id,input.receiverRunId),
      eq(heartbeatRuns.companyId,input.companyId),eq(heartbeatRuns.agentId,input.agentId))).limit(1);
    receiver = selectedReceiver;
    if (!receiver || input.stageTrigger.runId!==receiver.id || input.stageTrigger.agentId!==receiver.agentId ||
      input.stageTrigger.companyId!==input.companyId || input.stageTrigger.issueId!==input.issueId ||
      input.stageTrigger.responsibleUserId!==receiver.responsibleUserId || input.stageTrigger.wakeupRequestId!==receiver.wakeupRequestId ||
      input.stageTrigger.executorRunId!==input.sourceRunId || input.stageEntryRead.runId!==input.sourceRunId ||
      input.stageEntryRead.agentId!==input.stageTrigger.executorAgentId ||
      (input.historicalConsumption ? (!receiver.finishedAt || !["succeeded","failed","timed_out","cancelled"].includes(receiver.status)) : receiver.status!=="running")) return null;
    const {captureNativeStageContinuationOwner}=await import("./native-stage-wake-source.js");
    const stageOwner=await captureNativeStageContinuationOwner(input.db,{companyId:input.companyId,issueId:input.issueId,
      receiver,reader:input.reader,...(input.historicalConsumption ? {historicalConsumption:input.historicalConsumption,readWork:input.readWork} : {})});
    const {nativeStageContinuationOwnerMatches}=await import("./native-stage-wake-source.js");
    if(!stageOwner || !nativeStageContinuationOwnerMatches({candidate:stageOwner.trigger,expected:input.stageTrigger,
      ...(input.historicalConsumption ? {historicalConsumption:input.historicalConsumption} : {})})) return null;
    const { captureNativeFinalizedStageTaskBodyRead } = await import("./native-stage-task-body-source.js");
    const currentStageEntry = await captureNativeFinalizedStageTaskBodyRead(input.db, { companyId: input.companyId,
      issueId: input.issueId, runId: input.stageEntryRead.runId, reader: input.reader });
    if (!currentStageEntry || !isDeepStrictEqual(currentStageEntry, input.stageEntryRead)) return null;
  }
  const [selectedReceiver] = receiver ? [receiver] : await input.db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.id, input.receiverRunId), eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.agentId, input.agentId))).limit(1);
  receiver = selectedReceiver;
  if (!receiver || (!input.reader && receiver.status !== "running") ||
    ![receiver.issueId,receiver.nativeIssueId,object(receiver.contextSnapshot).issueId,object(receiver.contextSnapshot).taskId].includes(input.issueId) ||
    !receiver.responsibleUserId) return null;
  const reader: AuthorizationActor = input.reader ?? { type: "agent", source: "agent_jwt", companyId: input.companyId,
    agentId: input.agentId, runId: receiver.id, onBehalfOfUserId: receiver.responsibleUserId };
  if (!await canActorReadHeartbeatRunPrivacy(input.db, reader, receiver)) return null;
  const result = await captureNativeAcceptedFinalizedSummaryOwner({ db: input.db, companyId: input.companyId,
    issueId: input.issueId, agentId: input.stageEntryRead?.agentId ?? input.agentId, sourceRunId: input.sourceRunId, reader });
  if (!result || result.sourceRun.id === receiver.id ||
    (input.stageEntryRead && receiver.responsibleUserId !== result.sourceRun.responsibleUserId)) return null;
  if (input.stageEntryRead && (input.stageEntryRead.kind !== "stage_entry" || input.stageEntryRead.companyId !== input.companyId ||
      input.stageEntryRead.issueId !== input.issueId || input.stageEntryRead.runId !== result.sourceRun.id ||
      input.stageEntryRead.agentId !== result.sourceRun.agentId || input.stageEntryRead.taskCapture.input.issueId !== input.issueId)) return null;
  return { ...result.owner, receiverRunId: receiver.id, ...(input.stageEntryRead ? { stageEntryRead: input.stageEntryRead } : {}) };
}

/** Select the latest accepted finalized Native result as of this fresh Human
 * assignment and consume its exact accepted summary through the ordinary
 * finalized-result owner. A captured Human-authored summary document takes
 * precedence in the caller. */
export async function captureNativeAssignmentFinalizedContinuationSummary(input: {
  db: Db; companyId: string; issueId: string; agentId: string; receiverRunId: string;
  responsibleUserId: string; reader: AuthorizationActor; expectedSourceRunId?: string;
}): Promise<NativeFinalizedContinuationSummaryCapture | null> {
  const [receiver] = await input.db.select({ responsibleUserId: heartbeatRuns.responsibleUserId,
    agentId: heartbeatRuns.agentId, status: heartbeatRuns.status, createdAt: heartbeatRuns.createdAt }).from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.receiverRunId))).for("share");
  if (!receiver || receiver.agentId !== input.agentId || receiver.responsibleUserId !== input.responsibleUserId ||
      (input.expectedSourceRunId
        ? receiver.status !== "running" && !["succeeded", "failed", "timed_out", "cancelled"].includes(receiver.status)
        : receiver.status !== "running")) return null;
  const [issue] = await input.db.select({ assigneeAgentId: issues.assigneeAgentId,
    responsibleUserId: issues.responsibleUserId, status: issues.status }).from(issues)
    .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).for("share");
  if (!issue || (!input.expectedSourceRunId && (issue.assigneeAgentId !== input.agentId ||
      issue.responsibleUserId !== input.responsibleUserId || ["done", "cancelled"].includes(issue.status)))) return null;
  const [latestEligible] = await input.db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
    .innerJoin(nativeRunFinalizations, and(eq(nativeRunFinalizations.companyId, heartbeatRuns.companyId),
      eq(nativeRunFinalizations.issueId, input.issueId), eq(nativeRunFinalizations.runId, heartbeatRuns.id),
      eq(nativeRunFinalizations.phase, "committed"), isNull(nativeRunFinalizations.leaseOwner), isNull(nativeRunFinalizations.failureCode)))
    .innerJoin(nativeRunResults, and(eq(nativeRunResults.companyId, heartbeatRuns.companyId),
      eq(nativeRunResults.issueId, input.issueId), eq(nativeRunResults.runId, heartbeatRuns.id),
      eq(nativeRunResults.id, nativeRunFinalizations.resultId), eq(nativeRunResults.schemaStatus, "accepted")))
    .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.nativeIssueId, input.issueId),
      eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.responsibleUserId, input.responsibleUserId),
      eq(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.nativeInputSourceProtocolVersion, 1),
      isNotNull(heartbeatRuns.finishedAt), lte(heartbeatRuns.finishedAt, receiver.createdAt),
      inArray(heartbeatRuns.status, ["succeeded", "failed", "timed_out", "cancelled"])))
    .orderBy(desc(heartbeatRuns.finishedAt), desc(heartbeatRuns.id)).limit(1);
  if (!latestEligible || (input.expectedSourceRunId && latestEligible.id !== input.expectedSourceRunId)) return null;
  return captureNativeFinalizedContinuationSummary({ db: input.db, companyId: input.companyId,
    issueId: input.issueId, agentId: input.agentId, receiverRunId: input.receiverRunId,
    sourceRunId: latestEligible.id, reader: input.reader });
}

export class StaleExecutionContinuationError extends Error {
  constructor(readonly code: "continuation_task_ownership_changed") {
    super(code);
    this.name = "StaleExecutionContinuationError";
  }
}

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const string = (v: unknown) =>
  typeof v === "string" && v.length > 0 ? v : null;
export function continuationOriginCommentIds(context: unknown): string[] {
  const c = object(context);
  const prior = object(c.executionContinuation);
  return [
    ...new Set(
      [
        c.commentId,
        c.latestCommentId,
        ...(Array.isArray(c.commentIds) ? c.commentIds : []),
        ...(Array.isArray(c.wakeCommentIds) ? c.wakeCommentIds : []),
        ...(Array.isArray(prior.originCommentIds)
          ? prior.originCommentIds
          : []),
      ].filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ];
}

/** Keep service/tool results and generated summaries out of human authority. */
export function projectHumanInteractionResponse(row: {
  id: string; kind: string; status: string; result: unknown;
  resolvedByUserId: string | null; resolvedByAgentId: string | null;
  resolvedByRunId: string | null; resolvedAt: Date | null;
}): NonNullable<ExecutionContinuationEnvelope["humanResponses"]>[number] | null {
  if (!row.resolvedByUserId || row.resolvedByAgentId || row.resolvedByRunId || !row.resolvedAt) return null;
  const result = object(row.result);
  let response: Record<string, unknown>;
  if (row.kind === "ask_user_questions" && row.status === "answered" && Array.isArray(result.answers)) {
    response = { answers: result.answers.map(value => {
      const answer = object(value);
      return { questionId: answer.questionId, optionIds: answer.optionIds,
        ...(answer.otherText !== undefined ? { otherText: answer.otherText } : {}) };
    }) };
  } else if (["request_confirmation", "request_checkbox_confirmation"].includes(row.kind)
    && ["accepted", "rejected"].includes(row.status) && result.outcome === row.status) {
    response = { outcome: result.outcome, reason: result.reason,
      ...(Array.isArray(result.selectedOptionIds) ? { selectedOptionIds: result.selectedOptionIds } : {}) };
  } else return null;
  return { id: row.id, kind: row.kind, status: row.status, resolvedByUserId: row.resolvedByUserId,
    resolvedAt: row.resolvedAt.toISOString(), result: response };
}

/** Also retain user direction delivered after the source run's initial wake. */
export async function currentContinuationOrigins(
  db: Db,
  companyId: string,
  issueId: string,
  context: unknown,
): Promise<string[]> {
  const candidates = continuationOriginCommentIds(context);
  // A run may create an interaction on another task. Its own comments do not
  // become authority on that task. Keep unknown references for dispatch to
  // reject, rather than silently claiming complete context.
  const foreignComments = candidates.length
    ? await db.select({ id: issueComments.id }).from(issueComments).where(and(
        eq(issueComments.companyId, companyId),
        sql`${issueComments.issueId} != ${issueId}`,
        inArray(sql<string>`${issueComments.id}::text`, candidates),
      ))
    : [];
  const foreignIds = new Set(foreignComments.map(row => row.id));
  const [latest] = await db
    .select({ id: issueComments.id })
    .from(issueComments)
    .where(
      and(
        eq(issueComments.companyId, companyId),
        eq(issueComments.issueId, issueId),
        isNotNull(issueComments.authorUserId),
        isNull(issueComments.createdByRunId),
        isNull(issueComments.authorAgentId),
        isNull(issueComments.deletedAt),
      ),
    )
    .orderBy(desc(issueComments.createdAt), desc(issueComments.id))
    .limit(1);
  return [
    ...new Set([
      ...candidates.filter(id => !foreignIds.has(id)),
      ...(latest ? [latest.id] : []),
    ]),
  ];
}

/** Re-read task scope at dispatch, including messages already delivered to an earlier provider session. */
export async function buildExecutionContinuation(input: {
  db: Db;
  companyId: string;
  issueId: string;
  agentId: string;
  context: Record<string, unknown>;
  previousContextRunId?: string | null;
  /** Server-owned current run identity when validating dispatch authority. */
  runId?: string;
  summary: string | null;
  summaryDocument?: { source: import("./documents.js").DocumentRevisionSourceCapture;
    value: import("./issue-continuation-summary.js").IssueContinuationSummaryDocument };
  /** Native fresh assignment consumes the sealed finalized result, not the derived Markdown document. */
  useFinalizedSummaryForAssignment?: boolean;
  exposeLowTrustRaw: boolean;
  /** Selected message sources only; interactions and prior results are separate. */
  onCommentSourceCapture?: (capture: NativeCommentSourceCapture) => void;
  onContinuationSourceCapture?: (capture: NativeTaskContinuationCapture) => void;
  onStageTriggerCapture?: (trigger: NativeStageTaskContinuationTrigger) => void;
}): Promise<ExecutionContinuationEnvelope> {
  const { db, companyId, issueId } = input;
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)));
  if (
    !issue ||
    issue.assigneeAgentId !== input.agentId ||
    ["done", "cancelled"].includes(issue.status)
  )
    throw new StaleExecutionContinuationError("continuation_task_ownership_changed");
  // Preflight has no current run and cannot borrow a saved owner's authority.
  // Dispatch uses only the actual matching running receiver and its current Human.
  let outcomeReader: AuthorizationActor = { type: "none" };
  let stageContinuation: { trigger: NativeStageTaskContinuationTrigger;
    summary: NativeFinalizedContinuationSummaryCapture | null } | null = null;
  const [receiver] = input.runId ? await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, companyId),
    eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.status, "running"),
  )).limit(1) : [];
  if (receiver) {
    const refs = [receiver.issueId, receiver.nativeIssueId, object(receiver.contextSnapshot).issueId, object(receiver.contextSnapshot).taskId];
    const reader: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId, agentId: input.agentId,
      runId: receiver.id, onBehalfOfUserId: receiver.responsibleUserId };
    if (refs.some(ref => typeof ref === "string" && ref.toLowerCase() === issueId.toLowerCase()) &&
      await canActorReadHeartbeatRunPrivacy(db, reader, receiver)) outcomeReader = reader;
    if (outcomeReader.type === "agent") {
      const { captureNativeStageContinuationForDispatch } = await import("./native-stage-wake-source.js");
      const selected = await captureNativeStageContinuationForDispatch(db, { companyId, issueId, receiver, reader });
      stageContinuation = selected ? { ...selected, summary: input.summary === null ? selected.summary : null } : null;
      if (stageContinuation) input.onStageTriggerCapture?.(stageContinuation.trigger);
    }
  }
  const rows = await db
    .select({
      ...getTableColumns(issueComments),
      ...((input.onCommentSourceCapture || input.onContinuationSourceCapture) ? {
        sourceVersion: sql<string>`extract(epoch from ${issueComments.updatedAt})::text`,
      } : {}),
    })
    .from(issueComments)
    .where(
      and(
        eq(issueComments.companyId, companyId),
        eq(issueComments.issueId, issueId),
        // Native provider context admits live, source-backed messages only.
        input.onContinuationSourceCapture ? isNull(issueComments.deletedAt) : undefined,
      ),
    )
    .orderBy(asc(issueComments.createdAt), asc(issueComments.id));
  const interactions = await db
    .select()
    .from(issueThreadInteractions)
    .where(
      and(
        eq(issueThreadInteractions.companyId, companyId),
        eq(issueThreadInteractions.issueId, issueId),
      ),
    )
    .orderBy(
      asc(issueThreadInteractions.createdAt),
      asc(issueThreadInteractions.id),
    );
  const triggerInteraction = interactions.find(
    (row) => row.id === input.context.interactionId,
  );
  const explicitContinuation = object(input.context.explicitUserContinuation);
  const explicitUserSource = string(explicitContinuation.previousRunId);
  let assignmentFinalizedSummary: NativeFinalizedContinuationSummaryCapture | null = null;
  if (input.useFinalizedSummaryForAssignment && !input.summaryDocument?.source.payloadSourceSnapshot &&
      input.context.wakeReason === "issue_assigned" &&
      rows.length <= 256 && issue.responsibleUserId && receiver?.responsibleUserId &&
      receiver.responsibleUserId === issue.responsibleUserId) {
    assignmentFinalizedSummary = await captureNativeAssignmentFinalizedContinuationSummary({ db, companyId, issueId,
      agentId: input.agentId, receiverRunId: receiver.id, responsibleUserId: receiver.responsibleUserId, reader: outcomeReader });
  }
  const resumeSourceRunId =
    explicitUserSource ??
    string(input.context.retryOfRunId) ??
    string(input.context.previousRunId) ??
    string(input.context.interruptedRunId);
  const producerRunId = triggerInteraction?.sourceRunId ?? null;
  const sourceRunId = assignmentFinalizedSummary?.sourceRunId ?? resumeSourceRunId ?? producerRunId;
  const loadRun = async (id: string) => (await db
    .select({ context: heartbeatRuns.contextSnapshot, result: heartbeatRuns.resultJson })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, id)))
  )[0];
  const candidate = sourceRunId ? await loadRun(sourceRunId) : null;
  // An interaction producer is provenance. Explicit resume history must still
  // belong to this task, and only task-scoped content can enter the envelope.
  const sourceRun = object(candidate?.context).issueId === issueId ? candidate : null;
  if ((sourceRunId && !candidate) || (resumeSourceRunId && !sourceRun))
    throw new Error(explicitUserSource ? "continuation_user_authorization_missing" : "continuation_source_context_missing");
  const producer = producerRunId === sourceRunId ? candidate
    : producerRunId ? await loadRun(producerRunId) : null;
  if (producerRunId && !producer) throw new Error("continuation_source_context_missing");
  const producerIssueId = string(object(producer?.context).issueId);
  const producerOrigins = new Set(continuationOriginCommentIds(producer?.context));
  const recordedOrigins = triggerInteraction?.originCommentIds ?? [];
  const inheritedOrigins = recordedOrigins.filter(id => producerOrigins.has(id));
  // Older interactions copied the producer's origins without task scope.
  // Ignore only references proven to be comments on that producer's other
  // task. Missing rows, unrelated references, and explicit wake origins keep
  // the existing fail-closed check below.
  const inheritedForeignComments = producerIssueId && producerIssueId !== issueId && inheritedOrigins.length
    ? await db.select({ id: issueComments.id }).from(issueComments).where(and(
        eq(issueComments.companyId, companyId),
        sql`${issueComments.issueId}::text = ${producerIssueId}`,
        inArray(sql<string>`${issueComments.id}::text`, inheritedOrigins),
      ))
    : [];
  const inheritedForeignIds = new Set(inheritedForeignComments.map(row => row.id));
  const originCommentIds = [
    ...new Set([
      ...continuationOriginCommentIds(input.context),
      ...continuationOriginCommentIds(sourceRun?.context),
      ...recordedOrigins.filter(id => !inheritedForeignIds.has(id)),
      ...(triggerInteraction?.sourceCommentId
        ? [triggerInteraction.sourceCommentId]
        : []),
    ]),
  ];
  // Missing source rows cannot silently become a claim of complete context.
  if (originCommentIds.some((id) => !rows.some((row) => row.id === id)))
    throw new Error("continuation_source_context_missing");
  const freshAssignmentUsesFullHistory = Boolean(input.onContinuationSourceCapture && receiver?.responsibleUserId &&
    input.context.wakeReason === "issue_assigned" && issue.assigneeAgentId === input.agentId &&
    issue.responsibleUserId === receiver.responsibleUserId && (assignmentFinalizedSummary ||
      input.summaryDocument?.source.payloadSourceSnapshot && input.summary === input.summaryDocument.value.body));
  // A canonical Human continuation deliberately starts a fresh session. Keep
  // its exact source envelope in full-history form instead of capturing a
  // provider-session delta that heartbeat will later discard.
  const fullHistoryTurn = freshAssignmentUsesFullHistory || input.context.forceFreshSession === true;
  const effectiveSummary = assignmentFinalizedSummary ? null : input.summary;
  const messages = rows.map((row) => {
    const safe = input.exposeLowTrustRaw
      ? row
      : sanitizeQuarantinedCommentForHigherTrust(row);
    return nativeContinuationCommentProjection({ ...row, body: safe.body });
  });
  const previousRun = input.previousContextRunId
    ? (
        await db
          .select({ context: heartbeatRuns.contextSnapshot })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, companyId),
              eq(heartbeatRuns.agentId, input.agentId),
              eq(heartbeatRuns.id, input.previousContextRunId),
              sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
            ),
          )
      )[0]
    : null;
  const priorEnvelope = object(previousRun?.context?.executionContinuation);
  const deliveredMessages = Array.isArray(priorEnvelope.messages)
    ? priorEnvelope.messages.map(object)
    : null;
  const resumeDelta =
    !fullHistoryTurn && deliveredMessages?.length && input.previousContextRunId
      ? {
          baseRunId: input.previousContextRunId,
          messages: messages.filter(
            (message) =>
              originCommentIds.includes(message.id) ||
              !deliveredMessages.some(
                (prior) =>
                  prior.id === message.id &&
                  prior.updatedAt === message.updatedAt &&
                  prior.body === message.body &&
                  prior.deleted === message.deleted &&
                  prior.authorId === message.authorId &&
                  (prior.createdByRunId ?? null) === message.createdByRunId &&
                  nativeSha256(prior.sourceTrust) ===
                    nativeSha256(message.sourceTrust),
              ),
          ),
        }
      : undefined;
  const latestRequest = messages.findLast(
    (row) =>
      row.authorType === "user" && !row.createdByRunId && !row.deleted && row.body.trim().length > 0,
  );
  const priorRuns = await db
    .select({ id: heartbeatRuns.id, result: heartbeatRuns.resultJson, status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode, runtimeMode: heartbeatRuns.runtimeMode, retryOfRunId: heartbeatRuns.retryOfRunId })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, companyId),
        or(eq(heartbeatRuns.agentId, input.agentId),
          sourceRunId ? eq(heartbeatRuns.id, sourceRunId) : undefined),
        sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
      ),
    )
    .orderBy(asc(heartbeatRuns.createdAt), asc(heartbeatRuns.id));
  const completedActions = priorRuns.flatMap((run) =>
    Object.entries(object(object(run.result).apiToolReceipts)).flatMap(
      ([receiptId, receipt]) => {
        const value = object(receipt);
        return value.state === "completed" &&
          typeof value.operationId === "string"
          ? [
              {
                runId: run.id,
                receiptId,
                operationId: value.operationId,
                result: value.result,
              },
            ]
          : [];
      },
    ),
  );
  const reconciliations = await db
    .select({
      id: issueRecoveryActions.id,
      evidence: issueRecoveryActions.evidence,
    })
    .from(issueRecoveryActions)
    .where(
      and(
        eq(issueRecoveryActions.companyId, companyId),
        eq(issueRecoveryActions.sourceIssueId, issueId),
        eq(issueRecoveryActions.status, "resolved"),
      ),
    );
  const lastTerminal = priorRuns.findLast((run) =>
    ["succeeded", "failed", "timed_out", "interrupted", "cancelled"].includes(run.status) &&
    !(run.status === "cancelled" && run.errorCode === "execution_reconciliation_required"),
  );
  if (explicitUserSource) {
    const predecessor = priorRuns.find(run => run.id === explicitUserSource &&
      ["failed", "timed_out", "interrupted", "cancelled"].includes(run.status));
    const failedRunId = string(explicitContinuation.failedRunId);
    const retryWakes = failedRunId ? await db.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, input.agentId),
      eq(agentWakeupRequests.reason, "retry_failed_run"), eq(agentWakeupRequests.requestedByActorType, "user"),
      sql`${agentWakeupRequests.payload}->>'issueId' = ${issueId}`,
    )) : [];
    // Admission records the board operator's authority separately from the
    // message author. At dispatch, prove that exact queue was adopted by this
    // run; caller-supplied continuation context cannot grant this authority.
    const continuationAuthorizations = reconciliations.map(row => object(row.evidence.explicitUserContinuation))
      .filter(value => value.previousRunId === explicitUserSource &&
        (!input.runId || value.runId === input.runId) &&
        value.commentId === explicitContinuation.commentId &&
        priorRuns.some(run => run.id === value.runId));
    const interruptQueueIds = [...new Set(continuationAuthorizations.flatMap(value => {
      const parsed = z.string().guid().safeParse(value.queuedCommentInterruptId);
      return parsed.success ? [parsed.data] : [];
    }))];
    const interruptQueues = interruptQueueIds.length
      ? await db.select().from(agentWakeupRequests).where(and(
        inArray(agentWakeupRequests.id, interruptQueueIds),
        eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, input.agentId),
        eq(agentWakeupRequests.status, "coalesced"),
        sql`${agentWakeupRequests.payload}->>'issueId' = ${issueId}`,
        sql`${agentWakeupRequests.payload}->'queuedCommentInterrupt' is not null`,
        input.runId ? eq(agentWakeupRequests.runId, input.runId) : undefined,
      )) : [];
    const authorization = continuationAuthorizations.find(value => failedRunId
          ? value.failedRunId === failedRunId && retryWakes.some(wake =>
              wake.runId === value.runId && wake.requestedByActorId === value.actorId &&
              priorRuns.some(run => run.id === wake.runId && run.retryOfRunId === failedRunId))
          : rows.some(comment => comment.id === value.commentId &&
              comment.authorType === "user" &&
              (value.queuedCommentInterruptId
                ? interruptQueues.some(queue => queue.id === value.queuedCommentInterruptId &&
                    queue.runId === value.runId &&
                    object(object(queue.payload).queuedCommentInterrupt).actorId === value.actorId &&
                    queuedCommentIdsFromWakePayload(queue.payload).includes(comment.id))
                : comment.authorUserId === value.actorId) &&
              !comment.createdByRunId && !comment.deletedAt));
    if (!predecessor || !authorization || explicitUserSource !== sourceRunId)
      throw new Error("continuation_user_authorization_missing");
  }
  const interruptedRunId = explicitUserSource ?? string(input.context.interruptedRunId) ?? (lastTerminal && lastTerminal.status !== "succeeded" &&
    (hasConversationContinuationPolicy(lastTerminal.result) ||
      lastTerminal.status === "interrupted" || lastTerminal.errorCode === "process_lost")
    ? lastTerminal.id : undefined);
  // Every consumer, including completion contracts and safe replacement,
  // receives the same secret-redacted evidence after authority validation.
  const envelope = await createRunSecretRedactionRegistry(db).redactForIssue<ExecutionContinuationEnvelope>(companyId, issueId, {
    ...(interruptedRunId ? { interruptedRunId } : {}),
    ...(resumeDelta ? { resumeDelta } : {}),
    recoveryOutcomes: reconciliations
      .filter((row) => row.evidence.executionReconciliation)
      .map((row) => ({
        recoveryActionId: row.id,
        decision: row.evidence.executionReconciliation,
      })),
    version: 1,
    companyId,
    issueId,
    trigger: {
      reason: string(input.context.wakeReason) ?? "task_execution",
      interactionId: triggerInteraction?.id ?? null,
      sourceRunId,
    },
    originCommentIds,
    objective: freshAssignmentUsesFullHistory ? issue.description ?? issue.title : latestRequest?.body ?? issue.description ?? issue.title,
    messages,
    humanResponses: interactions.flatMap(row => {
      const response = projectHumanInteractionResponse(row);
      return response ? [response] : [];
    }),
    interactionOutcomes: [...interactions
      .filter((row) => row.status !== "pending")
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        result: row.result,
      })), ...await childReviewOutcomes(db, companyId, issueId, outcomeReader)],
    // Low-trust evidence only: renderPaperclipWakePrompt removes completedWork
    // from requestContext and encodes it in the fenced, non-authoritative
    // continuation-evidence section. It cannot supply objective or authority.
    // An explicit Human continuation may name a stopped source whose provider
    // result is still unknown. Only a separately captured summary owner may
    // turn that Run into completed work; never copy its raw result summary.
    completedWork: assignmentFinalizedSummary?.body ?? effectiveSummary ?? (stageContinuation ? stageContinuation.summary?.body ?? null :
      !explicitUserSource ? string(object(object(sourceRun?.result).nativeResult).summary)?.slice(0, 32_000) ??
        string(object(sourceRun?.result).summary)?.slice(0, 32_000) ?? null : null),
    completedActions,
    unresolvedInteractionIds: interactions
      .filter((row) => row.status === "pending")
      .map((row) => row.id),
    coverage: {
      kind: "full_task_history",
      throughCommentId: rows.at(-1)?.id ?? null,
      summaryThroughCommentId: null,
    },
  });
  const finalCommentSources: NativeCommentSourceCapture[] = [];
  if (input.onCommentSourceCapture || input.onContinuationSourceCapture) {
    // Match final redacted renditions to their own selected rows, never a new
    // live lookup or the independently selected wake/replay comment version.
    const selectedById = new Map(rows.map(row => [row.id, row]));
    const assignmentSummarySelected = input.context.wakeReason === "issue_assigned" && Boolean(issue.responsibleUserId) &&
      Boolean(assignmentFinalizedSummary || input.summaryDocument?.source.payloadSourceSnapshot && input.summary === input.summaryDocument.value.body);
    for (const message of envelope.messages) {
      if (message.deleted) continue;
      const selected = selectedById.get(message.id);
      if (!selected || typeof selected.sourceVersion !== "string") {
        throw new Error("Selected continuation comment source is unavailable");
      }
      const capture: NativeCommentSourceCapture = {
        input: { kind: "comment", issueId, commentId: selected.id,
          sourceVersion: selected.sourceVersion,
          contentHash: nativeContinuationMessageHash(message) },
        payloadSourceSnapshot: selected.payloadSourceSnapshot,
      };
      let selectedCapture = capture;
      if (assignmentSummarySelected && !selected.payloadSourceSnapshot && selected.authorType === "agent" &&
          selected.createdByRunId && outcomeReader.type === "agent") {
        const acceptedPresentationOwner = await captureNativeAcceptedFinalizedPresentationCommentOwner({ db, companyId, issueId,
          commentId: selected.id, reader: outcomeReader });
        if (acceptedPresentationOwner && isDeepStrictEqual(acceptedPresentationOwner.commentSourceIdentity, capture.input))
          selectedCapture = { ...capture, acceptedPresentationOwner };
      }
      finalCommentSources.push(selectedCapture);
      input.onCommentSourceCapture?.(selectedCapture);
    }
  }
  if (input.onContinuationSourceCapture && receiver && outcomeReader.type === "agent" &&
    receiver.responsibleUserId && receiver.wakeupRequestId) {
    const [wake] = await db.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.id, receiver.wakeupRequestId), eq(agentWakeupRequests.companyId, companyId),
      eq(agentWakeupRequests.agentId, input.agentId), eq(agentWakeupRequests.runId, receiver.id),
    )).limit(1);
    const explicitHumanSource = await captureNativeExplicitHumanSource({ db, companyId, issueId,
      agentId: input.agentId, receiverRunId: receiver.id, context: input.context, envelope });

    const governedInteractions: import("./native-runtime/native-interaction-bridge.js").NativeGovernedInteractionContinuationCapture[] = [];
    const answeredQuestions: import("./native-runtime/native-interaction-bridge.js").NativeAnsweredQuestionContinuationCapture[] = [];
    const humanReviewWithdrawals: import("./native-runtime/native-interaction-bridge.js").NativeHumanReviewWithdrawalCapture[] = [];
    const adminExpiredInteractions: import("./native-runtime/native-interaction-bridge.js").NativeAdministrativeInteractionExpiryCapture[] = [];
    const adminExpiryCandidates = wake?.reason === "issue_assigned" &&
      (assignmentFinalizedSummary || Boolean(input.summaryDocument?.source.payloadSourceSnapshot &&
        input.summary === input.summaryDocument.value.body)) &&
      issue.assigneeAgentId === input.agentId && issue.responsibleUserId === receiver.responsibleUserId &&
      !nativeTaskWakeInteraction(wake?.payload) && envelope.messages.length <= 256
      ? envelope.interactionOutcomes.filter(outcome => outcome.kind === "request_confirmation" && outcome.status === "expired" &&
          object(outcome.result).outcome === "issue_closed") : [];
    if (adminExpiryCandidates.length > 0) {
      const { captureNativeAdministrativeInteractionExpiries } = await import("./native-runtime/native-interaction-bridge.js");
      adminExpiredInteractions.push(...await captureNativeAdministrativeInteractionExpiries({ db, companyId, issueId,
        runId: receiver.id, agentId: input.agentId, interactionIds: adminExpiryCandidates.map(value => value.id) }));
      if (adminExpiredInteractions.length !== adminExpiryCandidates.length || adminExpiredInteractions.some(capture =>
        !isDeepStrictEqual(capture.interactionOutcome, envelope.interactionOutcomes.find(value => value.id === capture.projection.interactionId))))
        throw new Error("native_administrative_interaction_expiry_owner_missing");
    }
    const administrativelyOwnedIds = new Set(adminExpiredInteractions.map(capture => capture.projection.interactionId));
    const materializableOutcomes = envelope.interactionOutcomes.filter(outcome => !administrativelyOwnedIds.has(outcome.id));
    if (wake && materializableOutcomes.length > 0) {
      const { materializeNativeInteractionResponses } = await import("./native-runtime/native-interaction-bridge.js");
      // Every included historical outcome is selected through its actual
      // authoritative owner, not only the triggering row.
      await materializeNativeInteractionResponses({ db, companyId, issueId, runId: receiver.id, agentId: input.agentId,
        interactionIds: materializableOutcomes.map(outcome => outcome.id), sourceReader: outcomeReader,
        onContinuationSourceCapture: capture => { governedInteractions.push(capture); },
        onAnsweredQuestionCapture: capture => { answeredQuestions.push(capture); },
        onHumanReviewWithdrawalCapture: capture => { humanReviewWithdrawals.push(capture); } });
    }
    const { captureNativeGovernedPendingInteractions } = await import("./native-runtime/native-interaction-bridge.js");
    const pendingInteractions = wake && envelope.unresolvedInteractionIds.length
      ? await captureNativeGovernedPendingInteractions({ db, companyId, issueId, runId: receiver.id, agentId: input.agentId,
          interactionIds: envelope.unresolvedInteractionIds }) : [];
    const finalizedSummary = (wake && stageContinuation?.summary) ?? (wake && assignmentFinalizedSummary) ?? (wake && input.summary === null && sourceRunId && envelope.completedWork !== null
      ? await captureNativeFinalizedContinuationSummary({ db, companyId, issueId, agentId: input.agentId,
          receiverRunId: receiver.id, sourceRunId }) : null);
    const { captureNativeToolActionDelivery } = await import("./tool-action-delivery.js");
    const delivery = wake && governedInteractions.length ? await captureNativeToolActionDelivery({ db, companyId, issueId,
      agentId: input.agentId, runId: receiver.id, wakeupRequestId: wake.id }) : null;
    const stageActions: import("./native-stage-wake-source.js").NativeFinalizedStageConsumption[] = [];
    if (wake && completedActions.length > 0 && completedActions.length <= 64) {
      const {captureNativeFinalizedStageConsumption}=await import("./native-stage-wake-source.js");
      for (const action of completedActions) {
        const selected=await captureNativeFinalizedStageConsumption(db,{companyId,issueId,runId:action.runId,reader:outcomeReader});
        if(selected) stageActions.push(selected);
      }
    }
    const interaction = nativeTaskWakeInteraction(wake?.payload);
    const manualQueueAdoption = wake && receiver ? await readNativeManualQueueAdoption(db, {
      run: receiver, issueId, currentWake: wake }) : null;
    const summary = !assignmentFinalizedSummary && input.summaryDocument && effectiveSummary === input.summaryDocument.value.body
      ? { source: input.summaryDocument.source, rawTrustHash: nativeSha256(input.summaryDocument.value.sourceTrust),
          rendition: await createRunSecretRedactionRegistry(db).redactForIssue(companyId, issueId, {
            key: input.summaryDocument.value.key, title: input.summaryDocument.value.title,
            body: input.summaryDocument.value.body, sourceTrust: input.summaryDocument.value.sourceTrust,
            updatedAt: input.summaryDocument.value.updatedAt.toISOString() }) } : null;
    const currentHumanAssignment = (summary || assignmentFinalizedSummary) && input.context.wakeReason === "issue_assigned" &&
      receiver.responsibleUserId && issue.assigneeAgentId === input.agentId &&
      issue.responsibleUserId === receiver.responsibleUserId
      ? { companyId, issueId, agentId: input.agentId, responsibleUserId: receiver.responsibleUserId } : undefined;
    if (wake) input.onContinuationSourceCapture(structuredClone({ companyId, issueId, agentId: input.agentId, runId: receiver.id,
      responsibleUserId: receiver.responsibleUserId, wakeupRequestId: wake.id, envelope, commentSources: finalCommentSources,
      ...(governedInteractions.length ? { governedInteractions } : {}),
      ...(answeredQuestions.length ? { answeredQuestions } : {}),
      ...(humanReviewWithdrawals.length ? { humanReviewWithdrawals } : {}),
      ...(adminExpiredInteractions.length ? { adminExpiredInteractions } : {}),
      ...(stageActions.length ? { stageActions } : {}),
      ...(delivery ? { delivery } : {}),
      ...(pendingInteractions.length ? { pendingInteractions } : {}),
      ...(summary ? { summary } : {}),
      ...(currentHumanAssignment ? { currentHumanAssignment } : {}),
      ...(finalizedSummary ? { finalizedSummary } : {}),
      ...(explicitHumanSource ? { explicitHumanSource } : {}),
      ...(!fullHistoryTurn && input.previousContextRunId && deliveredMessages?.length ? { previousContext: { runId: input.previousContextRunId,
        messages: deliveredMessages as ExecutionContinuationEnvelope["messages"] } } : {}),
      wake: { requestedByActorType: wake.requestedByActorType, requestedByActorId: wake.requestedByActorId, reason: wake.reason,
        originCommentIds: nativeTaskWakeOriginCommentIds(wake.payload),
        ...(interaction ? { interaction } : {}), ...(manualQueueAdoption ? { manualQueueAdoption } : {}) } }));
  }
  return envelope;
}
