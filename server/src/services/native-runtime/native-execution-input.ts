import type { NativeBlockedHumanInteraction, NativeTreeHoldInteractionSource } from "../native-direct-input.js";
import { exactNativeWorkspaceCoordination, type NativeWorkspaceCoordinationCapture } from "./native-workspace-coordination-source.js";
import { askUserQuestionsResultSchema, issueExecutionStateSchema } from "@paperclipai/shared";
import { PLAN_REVIEW_CONTEXT_LIMITS } from "../plan-review-context.js";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { nativeContinuationMessageHash, nativeCommentProjectionHash, nativeSha256 } from "./canonical.js";
import type { NativeTaskContinuationCapture } from "../execution-continuation.js";
import { buildNativeContinuationPrompt } from "./native-continuation.js";
import { buildNativeReviewRequest } from "./native-review-prompt.js";
import type { NativeReviewAssignment, NativeReviewWakeWitness } from "./native-review-participant.js";
import type {
  NativeAcpxAgent,
  NativeAcpxPermissionMode,
  NativeCodexApprovalPolicy,
  NativeExecutionInput,
  NativeExecutionInputV4,
  NativeInteractionResponseEnvelope,
  NativeOpenCodePermissionMode,
  NativePlanningContext,
  NativeRuntimeContextSnapshot,
  StrictCompletionContractInput,
} from "../../vendor/paperclip-runner/index.js";
import {
  nativePayloadSourceInputSchema, sourceTrustMetadataSchema, nativeRunInputSourceReceiptSchema, ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY,
  nativePayloadSourceSnapshotSchema,
  type NativePayloadSourceInput,
  type NativePayloadSourcePolicy,
} from "@paperclipai/shared";
import {
  parseNativeExecutionInput,
  resolveQualifiedAcpxProfile,
} from "../../vendor/paperclip-runner/index.js";
import { readNativeBootstrapContextWitness, type NativeBootstrapContextWitness } from "../context/native-bootstrap-context-witness.js";
import {
  isPaperclipExternalChatContractTurn,
  isPaperclipExternalChatQuestionResponseTurn,
  renderPaperclipWakePrompt,
} from "@paperclipai/adapter-utils/server-utils";
const NATIVE_GITHUB_ATTACHMENT_RECOVERY_GUIDANCE = [
  "## GitHub attachment recovery navigation",
  "Paperclip owns recovery navigation for unavailable GitHub attachments. It may append an authenticated task link after an accepted response, only when the current source remains authorized and a safe configured Board URL is available. The model does not select or authorize that link.",
  "A task URL missing from your prompt or tool results is not evidence that no task link can be provided; do not claim that a link is unavailable merely because you cannot see its URL. Do not invent a URL or promise that a link will appear. Briefly explain the unavailable input and ask the user to attach it directly to this Paperclip task or paste the needed text. Never infer the file's contents or substitute an older file.",
].join("\n");

export type NativeRenderedSourceReference = {
  kind: "task" | "comment" | "document_revision" | "attachment" | "project" | "unknown";
  id: string;
  commentId?: string;
  filename?: string;
  contentType?: string;
  byteSize?: number;
} | {
  /** Exact server-rendered review prompt is bound to its assignment witness in
   * the same aggregated native_task_wake source. */
  kind: "native_review_request_context";
  id: string;
} | {
  /** Server-rendered external-chat guidance is bound to the exact captured
   * wake source, which carries its provider and initial-guidance hash. */
  kind: "external_chat_context";
  id: string;
  provider: string;
} | {
  kind: "task_wake_interaction_state";
  id: string;
  interactionKind: "ask_user_questions" | "request_confirmation" | "request_checkbox_confirmation";
  interactionStatus: "cancelled" | "rejected";
};

export type NativePreparedSourceCandidate = {
  kind: "task" | "comment" | "document_revision" | "attachment" | "project";
  id: string;
  input: NativePayloadSourceInput;
  payloadSourceSnapshot: unknown;
  acceptedPresentationOwner?: import("../execution-continuation.js").NativeAcceptedFinalizedPresentationCommentOwner;
};

export type NativeTaskWakeInteractionStateOwner = {
  source: Extract<NativePayloadSourceInput, { kind: "native_task_wake" }>;
  capture: NativeTaskContinuationCapture;
  responsibleUserId: string;
  wakeupRequestId: string;
  wakeReason: string | null;
  taskObjective: string;
};

export type NativePayloadSourceSet = {
  policy: NativePayloadSourcePolicy;
  inputs: NativePayloadSourceInput[];
};

export type NativeConsumedSourceComponent =
  | { kind: "bootstrap" }
  | { kind: "dispatch"; executionInputDigest: string; policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[] }
  | { kind: "additional_input"; responsibleUserId: string; policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[] };

export type NativeBootstrapSourceClosure = {
  sourceSet: NativePayloadSourceSet;
  taskEnvelopeDigest: string;
  /** Digest and Context root attached to a later server-prepared turn. */
  turnContext?: { markdownDigest: string; manifestIds: string[] };
};

export function exactNativeInteractionSourceInputs(input: {
  issueId: string;
  responses: readonly NativeInteractionResponseEnvelope[] | null | undefined;
  sources: readonly Extract<NativePayloadSourceInput, { kind: "interaction" }>[] | null | undefined;
}): Extract<NativePayloadSourceInput, { kind: "interaction" }>[] | null {
  const responses = input.responses ?? [];
  const sources = input.sources ?? [];
  if (responses.length !== sources.length) return null;
  const responseIds = new Set<string>();
  for (const response of responses) {
    if (!response || typeof response.interactionId !== "string" || responseIds.has(response.interactionId)) return null;
    responseIds.add(response.interactionId);
  }
  const sourcesById = new Map<string, Extract<NativePayloadSourceInput, { kind: "interaction" }>>();
  for (const raw of sources) {
    const parsed = nativePayloadSourceInputSchema.safeParse(raw);
    if (!parsed.success || parsed.data.kind !== "interaction" || parsed.data.issueId !== input.issueId ||
      sourcesById.has(parsed.data.interactionId)) return null;
    sourcesById.set(parsed.data.interactionId, parsed.data);
  }
  const ordered: Extract<NativePayloadSourceInput, { kind: "interaction" }>[] = [];
  for (const response of responses) {
    const source = sourcesById.get(response.interactionId);
    if (!source || nativeSha256(response) !== source.contentHash) return null;
    ordered.push(source);
  }
  return ordered;
}

/** Server-only Native output capture. The model-call identity and hashes are
 * observations; source authority still comes from sourceSet and its owners. */
export type NativeModelOutputCapture = {
  runId: string;
  sourceSet: NativePayloadSourceSet;
  /** Exact receipt components that compose the source set consumed by this request. */
  consumedSourceComponents?: NativeConsumedSourceComponent[];
  dispatch: Extract<NativePayloadSourceInput, { kind: "worker_model_dispatch" | "conversation_model_dispatch" | "review_model_dispatch" }>;
  /** Present only when the output came from the pinned managed OpenCode tool boundary. */
  managedOpenCodeToolUse?: { callId: string; toolName: string; argumentsHash: string; responseContentHash: string };
};
export type NativeAwModelOutputCapture = NativeModelOutputCapture;

function isClosedEmptyTaskContinuation(value: unknown, input: {
  companyId: string;
  issueId: string;
  wakeReason: string | null;
  task: { title: string; description: string | null };
}): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const continuation = value as Record<string, unknown>;
  const keys = ["version", "companyId", "issueId", "trigger", "originCommentIds", "objective", "messages",
    "humanResponses", "interactionOutcomes", "completedWork", "recoveryOutcomes", "unresolvedInteractionIds", "coverage",
    "completedActions", "interruptedRunId"];
  if (Object.keys(continuation).some(key => !keys.includes(key)) ||
    continuation.version !== 1 || continuation.issueId !== input.issueId ||
    continuation.companyId !== input.companyId ||
    continuation.objective !== (input.task.description ?? input.task.title) ||
    !Array.isArray(continuation.originCommentIds) || continuation.originCommentIds.length !== 0 ||
    !Array.isArray(continuation.messages) || continuation.messages.length !== 0 ||
    (continuation.humanResponses !== undefined && (!Array.isArray(continuation.humanResponses) || continuation.humanResponses.length !== 0)) ||
    !Array.isArray(continuation.interactionOutcomes) || continuation.interactionOutcomes.length !== 0 ||
    (continuation.recoveryOutcomes !== undefined && (!Array.isArray(continuation.recoveryOutcomes) || continuation.recoveryOutcomes.length !== 0)) ||
    continuation.completedWork !== null ||
    (continuation.completedActions !== undefined && (!Array.isArray(continuation.completedActions) || continuation.completedActions.length !== 0)) ||
    continuation.interruptedRunId !== undefined || !Array.isArray(continuation.unresolvedInteractionIds) || continuation.unresolvedInteractionIds.length !== 0)
    return false;
  const trigger = continuation.trigger;
  if (!trigger || typeof trigger !== "object" || Array.isArray(trigger)) return false;
  const triggerRecord = trigger as Record<string, unknown>;
  const triggerKeys = ["reason", "interactionId", "sourceRunId"];
  if (Object.keys(triggerRecord).some(key => !triggerKeys.includes(key)) || typeof triggerRecord.reason !== "string" ||
    (triggerRecord.reason !== input.wakeReason && !(input.wakeReason === null && triggerRecord.reason === "task_execution")) ||
    triggerRecord.interactionId !== null || triggerRecord.sourceRunId !== null) return false;
  const coverage = continuation.coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return false;
  const coverageRecord = coverage as Record<string, unknown>;
  return Object.keys(coverageRecord).every(key => ["kind", "throughCommentId", "summaryThroughCommentId"].includes(key)) &&
    coverageRecord.kind === "full_task_history" && coverageRecord.throughCommentId === null && coverageRecord.summaryThroughCommentId === null;
}

/** Separate rendition of the original question owner. The regular response
 * hash alone cannot bind metadata changed by FK erasure without updatedAt. */
export function nativeAnsweredQuestionContinuationSource(value:
  Omit<NonNullable<NativeTaskContinuationCapture["answeredQuestions"]>[number], "continuationSource">,
): Extract<NativePayloadSourceInput, { kind: "interaction" }> {
  return { ...value.nativeSource, contentHash: nativeSha256({ rendition: "native_answered_question_continuation_v1", projection: {
    version: 1, companyId: value.companyId, issueId: value.issueId, interactionId: value.nativeSource.interactionId,
    sourceVersion: value.nativeSource.sourceVersion, nativeResponseDigest: value.nativeSource.contentHash,
    owner: value.owner, humanResponse: value.humanResponse, interactionOutcome: value.interactionOutcome,
  } }) };
}

/** Closed Task continuation profiles. Each nonempty family requires its own
 * owner-produced rendition; unsupported action/recovery families stay closed. */
export function exactNativeTaskContinuation(input: { value: unknown; companyId: string; issueId: string;
  runId: string; agentId?: string; responsibleUserId?: string | null; wakeupRequestId?: string | null; wakeReason: string | null;
  /** Optional objective from the already canonical safe Task projection. */
  taskObjective?: string;
  capture?: NativeTaskContinuationCapture | null; stageTrigger?: import("../execution-continuation.js").NativeStageTaskContinuationTrigger; historicalPendingSources?: readonly import("./native-interaction-bridge.js").NativeGovernedPendingInteractionCapture[] }): NativeTaskContinuationCapture | null {
  const { capture } = input;
  let serialized: string;
  try {
    const rejectNonJson = (_key: string, value: unknown) => {
      if (["function", "symbol", "bigint"].includes(typeof value)) throw new Error("non_json_continuation");
      return value;
    };
    const value = JSON.stringify(input.value,rejectNonJson); if (typeof value !== "string") return null;
    serialized = value; JSON.stringify(capture,rejectNonJson);
  }
  catch { return null; }
  if (!capture || !input.agentId || !input.responsibleUserId || !input.wakeupRequestId ||
    capture.companyId !== input.companyId || capture.issueId !== input.issueId || capture.runId !== input.runId ||
    capture.agentId !== input.agentId || capture.responsibleUserId !== input.responsibleUserId ||
    capture.wakeupRequestId !== input.wakeupRequestId || !isDeepStrictEqual(capture.envelope, input.value) ||
    Buffer.byteLength(serialized, "utf8") > 64_000) return null;
  const captureKeys = ["agentId", "commentSources", "companyId", "envelope", "issueId", "responsibleUserId", "runId", "wake", "wakeupRequestId",
    ...(capture.governedInteractions !== undefined ? ["governedInteractions"] : []),
    ...(capture.acceptedPlanReview !== undefined ? ["acceptedPlanReview"] : []),
    ...(capture.explicitHumanSource !== undefined ? ["explicitHumanSource"] : []),
    ...(capture.answeredQuestions !== undefined ? ["answeredQuestions"] : []),
    ...(capture.humanReviewWithdrawals !== undefined ? ["humanReviewWithdrawals"] : []),
    ...(capture.adminExpiredInteractions !== undefined ? ["adminExpiredInteractions"] : []),
    ...(capture.stageActions !== undefined ? ["stageActions"] : []),
    ...(capture.summary !== undefined ? ["summary"] : []),
    ...(capture.currentHumanAssignment !== undefined ? ["currentHumanAssignment"] : []),
    ...(capture.finalizedSummary !== undefined ? ["finalizedSummary"] : []),
    ...(capture.delivery !== undefined ? ["delivery"] : []),
    ...(capture.pendingInteractions !== undefined ? ["pendingInteractions"] : []),
    ...(capture.previousContext !== undefined ? ["previousContext"] : []), ...(capture.retainedSource !== undefined ? ["retainedSource"] : [])];
  if (Object.keys(capture).sort().join(",") !== captureKeys.sort().join(",")) return null;
  for (const value of [capture.summary,capture.finalizedSummary,capture.delivery,capture.previousContext,capture.retainedSource])
    if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) return null;
  if (capture.pendingInteractions !== undefined && !Array.isArray(capture.pendingInteractions) ||
    capture.governedInteractions !== undefined && !Array.isArray(capture.governedInteractions)) return null;
  const governed = capture.governedInteractions;
  const hasGoverned = Array.isArray(governed) && governed.length > 0 && governed.length <= 256;
  const questions = capture.answeredQuestions;
  const hasQuestions = Array.isArray(questions) && questions.length > 0 && questions.length <= 256;
  const withdrawals = capture.humanReviewWithdrawals;
  const hasReviewWithdrawals = Array.isArray(withdrawals) && withdrawals.length > 0 && withdrawals.length <= 64;
  if (capture.humanReviewWithdrawals !== undefined && (!hasReviewWithdrawals || hasGoverned || hasQuestions ||
    capture.acceptedPlanReview !== undefined || capture.adminExpiredInteractions !== undefined || capture.delivery !== undefined ||
    capture.pendingInteractions !== undefined || capture.stageActions !== undefined || input.stageTrigger !== undefined)) return null;
  if (questions !== undefined && (!hasQuestions || governed !== undefined || capture.acceptedPlanReview !== undefined ||
    capture.delivery !== undefined || capture.adminExpiredInteractions !== undefined || capture.humanReviewWithdrawals !== undefined || input.stageTrigger !== undefined)) return null;
  const administrativeExpiries = capture.adminExpiredInteractions;
  const hasAdministrativeExpiries = Array.isArray(administrativeExpiries) && administrativeExpiries.length > 0 &&
    administrativeExpiries.length <= 64;
  if (administrativeExpiries !== undefined && (!hasAdministrativeExpiries || governed !== undefined ||
    questions !== undefined || capture.acceptedPlanReview !== undefined || capture.delivery !== undefined ||
    capture.pendingInteractions !== undefined || capture.stageActions !== undefined || input.stageTrigger !== undefined)) return null;
  const acceptedPlanReview = capture.acceptedPlanReview;
  const hasAcceptedPlanReview = acceptedPlanReview !== undefined;
  if (hasAcceptedPlanReview && (hasGoverned || capture.delivery !== undefined || !acceptedPlanReview)) return null;
  const c = capture.envelope;
  const reviewWithdrawalSourceRunIds = hasReviewWithdrawals ? [...new Set(withdrawals!.flatMap(value =>
    value?.projection?.owner?.sourceKind === "native_interaction" && value.projection.owner.sourceRunStatus === "succeeded" &&
      value.projection.owner.sourceRunId === value.projection.interactionSourceRunId
      ? [value.projection.owner.sourceRunId] : []))] : [];
  const reviewWithdrawalSummarySourceRunId = reviewWithdrawalSourceRunIds.length === 1 && withdrawals!.every(value =>
    value?.projection?.owner?.sourceRunId === reviewWithdrawalSourceRunIds[0] &&
    value?.projection?.owner?.sourceRunId === c?.trigger?.sourceRunId) ? reviewWithdrawalSourceRunIds[0] : null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (hasAdministrativeExpiries) {
    if (!Array.isArray(c?.interactionOutcomes) || c.interactionOutcomes.length > 64 ||
      c.interactionOutcomes.some(outcome => {
        const result = outcome?.result && typeof outcome.result === "object" && !Array.isArray(outcome.result)
          ? outcome.result as Record<string, unknown> : null;
        return !outcome || Object.keys(outcome).sort().join(",") !== "id,kind,result,status" ||
          typeof outcome.id !== "string" || !uuid.test(outcome.id) || outcome.kind !== "request_confirmation" || outcome.status !== "expired" ||
          !result || Object.keys(result).sort().join(",") !== "outcome,reason,version" ||
          result.version !== 1 || result.outcome !== "issue_closed" || result.reason !== null;
      }) ||
      (c.humanResponses !== undefined && !Array.isArray(c.humanResponses))) return null;
    const expiryIds = new Set<string>();
    const expectedOutcomes = c.interactionOutcomes;
    if (c.interactionOutcomes.length !== expectedOutcomes.length || c.interactionOutcomes.length > 64 ||
      administrativeExpiries!.length !== expectedOutcomes.length ||
      (c.humanResponses?.length ?? 0) !== 0 || new Set(administrativeExpiries!.map(value => value?.projection?.interactionId)).size !== administrativeExpiries!.length)
      return null;
    for (const value of administrativeExpiries!) {
      if (!value || Object.keys(value).sort().join(",") !== "agentId,companyId,interactionOutcome,issueId,projection,runId,source" ||
        value.companyId !== input.companyId || value.issueId !== input.issueId || value.agentId !== input.agentId || value.runId !== input.runId ||
        !value.projection || !value.source || !value.interactionOutcome) return null;
      const p = value.projection;
      if (Object.keys(p).sort().join(",") !== "activityActorId,activityActorType,activityAgentId,activityCreatedAt,activityId,activityRunId,companyId,createdByAgentId,interactionId,issueId,kind,resolvedAt,resolvedByAgentId,resolvedByRunId,resolvedByUserId,result,sourceRunId,sourceVersion,status,version" ||
        p.version !== 1 || p.companyId !== input.companyId || p.issueId !== input.issueId || p.kind !== "request_confirmation" || p.status !== "expired" ||
        ![p.interactionId, p.activityId].every(id => typeof id === "string" && uuid.test(id)) ||
        typeof p.sourceVersion !== "string" || !/^\d+(?:\.\d+)?$/.test(p.sourceVersion) ||
        ![p.activityCreatedAt, p.resolvedAt].every(value => typeof value === "string" && Number.isFinite(Date.parse(value))) ||
        typeof p.activityActorId !== "string" || !["user", "agent", "system"].includes(p.activityActorType) ||
        !(p.activityAgentId === null || typeof p.activityAgentId === "string" && uuid.test(p.activityAgentId)) || p.activityRunId !== null ||
        !(p.createdByAgentId === null || typeof p.createdByAgentId === "string" && uuid.test(p.createdByAgentId)) ||
        typeof p.sourceRunId !== "string" || !uuid.test(p.sourceRunId) ||
        !(p.resolvedByUserId === null || typeof p.resolvedByUserId === "string") ||
        !(p.resolvedByAgentId === null || typeof p.resolvedByAgentId === "string" && uuid.test(p.resolvedByAgentId)) ||
        p.resolvedByRunId !== null || p.resolvedByUserId !== null && p.resolvedByAgentId !== null ||
        (p.resolvedByUserId !== null && (p.activityActorType !== "user" || p.activityActorId !== p.resolvedByUserId || p.activityAgentId !== null)) ||
        (p.resolvedByAgentId !== null && (p.activityActorType !== "agent" || p.activityActorId !== p.resolvedByAgentId || p.activityAgentId !== p.resolvedByAgentId)) ||
        (p.resolvedByUserId === null && p.resolvedByAgentId === null && (p.activityActorType !== "system" || p.activityActorId !== "issue_service" || p.activityAgentId !== null)) ||
        !p.result || Object.keys(p.result).sort().join(",") !== "outcome,reason,version" ||
        p.result.version !== 1 || p.result.outcome !== "issue_closed" || p.result.reason !== null ||
        !isDeepStrictEqual(value.interactionOutcome, { id: p.interactionId, kind: p.kind, status: p.status, result: p.result }) ||
        !expectedOutcomes.some(outcome => isDeepStrictEqual(outcome, value.interactionOutcome)) ||
        !nativePayloadSourceInputSchema.safeParse(value.source).success || value.source.kind !== "interaction" ||
        value.source.issueId !== input.issueId || value.source.interactionId !== p.interactionId || value.source.sourceVersion !== p.sourceVersion ||
        value.source.contentHash !== nativeSha256({ rendition: "native_issue_closed_interaction_v1", projection: p,
          interactionOutcome: value.interactionOutcome }) || expiryIds.has(p.interactionId)) return null;
      expiryIds.add(p.interactionId);
    }
  }
  const hasResolutionWake = capture.wake?.interaction !== undefined;
  const explicitHumanSource = capture.explicitHumanSource;
  const hasExplicitHumanSource = explicitHumanSource !== undefined;
  const explicitHumanMessage = explicitHumanSource
    ? capture.envelope?.messages?.find(message => message?.id === explicitHumanSource.commentId) : undefined;
  const exactExplicitHumanSource = Boolean(explicitHumanSource &&
    Object.keys(explicitHumanSource).sort().join(",") === "actorId,commentId,companyId,issueId,providerBodyHash,receiverRunId,recoveryActionCause,recoveryActionId,recoveryActionOutcome,recoveryActionStatus,recoveryReplay,reservationId,reservationInputHash,reservationPurpose,reservationRequestHash,reservationStatus,sourceDriverKind,sourceRunId,sourceRuntimeMode,sourceStatus,sourceStopReceiptHash,version" &&
    explicitHumanSource.version === 1 && explicitHumanSource.companyId === input.companyId &&
    explicitHumanSource.issueId === input.issueId && explicitHumanSource.receiverRunId === input.runId &&
    explicitHumanSource.sourceRunId === capture.envelope?.trigger?.sourceRunId &&
    explicitHumanSource.sourceRunId === capture.envelope?.interruptedRunId &&
    explicitHumanSource.sourceStatus === "cancelled" && explicitHumanSource.sourceRuntimeMode === "native" &&
    explicitHumanSource.sourceDriverKind === "aw_text_messages" &&
    explicitHumanSource.recoveryActionCause === "uncertain_provider_action" &&
    explicitHumanSource.recoveryActionStatus === "resolved" && explicitHumanSource.recoveryActionOutcome === "cancelled" &&
    explicitHumanSource.recoveryReplay === "explicit_user_continuation" &&
    explicitHumanSource.reservationStatus === "unknown" && explicitHumanSource.reservationPurpose === "worker_model" &&
    typeof explicitHumanSource.sourceStopReceiptHash === "string" && /^[a-f0-9]{64}$/i.test(explicitHumanSource.sourceStopReceiptHash) &&
    typeof explicitHumanSource.actorId === "string" && explicitHumanSource.actorId === input.responsibleUserId &&
    typeof explicitHumanSource.commentId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(explicitHumanSource.commentId) &&
    [explicitHumanSource.recoveryActionId, explicitHumanSource.reservationId].every(id => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) &&
    [explicitHumanSource.reservationRequestHash, explicitHumanSource.reservationInputHash, explicitHumanSource.providerBodyHash]
      .every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash)) &&
    capture.wake?.requestedByActorType === "user" && capture.wake.requestedByActorId === explicitHumanSource.actorId &&
    capture.wake.reason === "issue_commented" && capture.wake.originCommentIds.includes(explicitHumanSource.commentId) &&
    explicitHumanMessage?.authorType === "user" && explicitHumanMessage.authorId === explicitHumanSource.actorId &&
    explicitHumanMessage.createdByRunId === null && !explicitHumanMessage.deleted &&
    capture.envelope.originCommentIds.includes(explicitHumanSource.commentId) &&
    capture.commentSources?.some(source => source.input?.kind === "comment" && source.input.commentId === explicitHumanSource.commentId) &&
    capture.envelope.completedWork === null && !capture.finalizedSummary && !capture.summary && !hasResolutionWake);
  if (hasExplicitHumanSource && !exactExplicitHumanSource) return null;
  const stageTrigger = input.stageTrigger;
  const hasStageTrigger = stageTrigger !== undefined;
  const assignment = capture.currentHumanAssignment;
  const assignmentRecord = assignment && typeof assignment === "object" && !Array.isArray(assignment) ? assignment : null;
  const currentHumanAssignmentMatches = Boolean(assignmentRecord &&
    Object.keys(assignmentRecord).sort().join(",") === "agentId,companyId,issueId,responsibleUserId" &&
    assignmentRecord.companyId === input.companyId && assignmentRecord.issueId === input.issueId &&
    assignmentRecord.agentId === input.agentId && assignmentRecord.responsibleUserId === input.responsibleUserId &&
    typeof assignmentRecord.responsibleUserId === "string" && assignmentRecord.responsibleUserId.length > 0);
  const summaryRecord = capture.summary && typeof capture.summary === "object" && !Array.isArray(capture.summary)
    ? capture.summary as NonNullable<NativeTaskContinuationCapture["summary"]> : null;
  const summaryRendition = summaryRecord?.rendition && typeof summaryRecord.rendition === "object" &&
    !Array.isArray(summaryRecord.rendition) ? summaryRecord.rendition : null;
  const finalizedSummaryRecord = capture.finalizedSummary && typeof capture.finalizedSummary === "object" &&
    !Array.isArray(capture.finalizedSummary) ? capture.finalizedSummary : null;
  const assignmentBase = !hasStageTrigger && input.wakeReason === "issue_assigned" &&
    currentHumanAssignmentMatches && Boolean(summaryRendition || finalizedSummaryRecord) &&
    typeof input.taskObjective === "string" && c?.trigger?.reason === "issue_assigned" &&
    capture.wake?.reason === "issue_assigned" && capture.wake.requestedByActorType === "user" &&
    capture.wake.requestedByActorId === input.responsibleUserId && Array.isArray(c?.originCommentIds) &&
    c.originCommentIds.length === 0 && Array.isArray(capture.wake.originCommentIds) && capture.wake.originCommentIds.length === 0 &&
    c?.resumeDelta === undefined && capture.previousContext === undefined && capture.retainedSource === undefined &&
    !capture.delivery && !capture.acceptedPlanReview && !capture.governedInteractions && !capture.answeredQuestions && !capture.humanReviewWithdrawals &&
    (!capture.adminExpiredInteractions || hasAdministrativeExpiries) &&
    !capture.pendingInteractions && !capture.stageActions && !hasResolutionWake && !capture.wake.manualQueueAdoption &&
    c?.completedWork === (finalizedSummaryRecord?.body ?? summaryRendition?.body);
  const hasSummaryAssignment = assignmentBase && Array.isArray(c?.messages) && c.messages.length <= 256 &&
    Array.isArray(capture.commentSources) && capture.commentSources.length === c.messages.length;
  if ((capture.currentHumanAssignment !== undefined || hasAdministrativeExpiries) && !hasSummaryAssignment) return null;
  if (hasStageTrigger) {
    const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!stageTrigger || Object.keys(stageTrigger).sort().join(",") !==
      "agentId,chainHash,companyId,decisionId,effectId,executorAgentId,executorRunId,intentId,issueId,reason,responsibleUserId,runId,stageHash,taskObjective,version,wakeupRequestId" ||
      stageTrigger.version !== 1 || stageTrigger.companyId !== input.companyId || stageTrigger.issueId !== input.issueId ||
      stageTrigger.runId !== input.runId || stageTrigger.agentId !== input.agentId ||
      stageTrigger.responsibleUserId !== input.responsibleUserId || stageTrigger.wakeupRequestId !== input.wakeupRequestId ||
      ![stageTrigger.intentId,stageTrigger.effectId,stageTrigger.decisionId,stageTrigger.executorRunId,stageTrigger.executorAgentId].every(value=>typeof value === "string" && id.test(value)) ||
      ![stageTrigger.stageHash,stageTrigger.chainHash].every(value=>typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) ||
      !["execution_review_requested","execution_approval_requested"].includes(stageTrigger.reason) || stageTrigger.reason !== input.wakeReason ||
      typeof stageTrigger.taskObjective !== "string" || Buffer.byteLength(stageTrigger.taskObjective,"utf8") > 64_000 ||
      hasResolutionWake || capture.delivery !== undefined || capture.wake?.requestedByActorType !== "system" ||
      capture.wake.requestedByActorId !== `native-status-wake-dispatch:${stageTrigger.intentId}` ||
      !Array.isArray(capture.wake.originCommentIds) || capture.wake.originCommentIds.length !== 0) return null;
  }
  if (!c || typeof c !== "object" || Array.isArray(c) || !c.trigger || typeof c.trigger !== "object" ||
    Array.isArray(c.trigger) || !c.coverage || typeof c.coverage !== "object" || Array.isArray(c.coverage) ||
    !capture.wake || Object.keys(capture.wake).sort().join(",") !== ["originCommentIds", "reason", "requestedByActorId", "requestedByActorType", ...(capture.wake.interaction ? ["interaction"] : []),
      ...(capture.wake.manualQueueAdoption ? ["manualQueueAdoption"] : [])].sort().join(",") ||
    !Array.isArray(capture.wake.originCommentIds) || !Array.isArray(capture.commentSources)) return null;
  const keys = ["version", "companyId", "issueId", "trigger", "originCommentIds", "objective", "messages", "humanResponses",
    "interactionOutcomes", "completedWork", "recoveryOutcomes", "unresolvedInteractionIds", "coverage", "completedActions", "resumeDelta",
    ...(exactExplicitHumanSource ? ["interruptedRunId"] : [])];
  if (Object.keys(c).some(key => !keys.includes(key)) || c.version !== 1 || c.companyId !== input.companyId || c.issueId !== input.issueId ||
    Object.keys(c.trigger).sort().join(",") !== "interactionId,reason,sourceRunId" ||
    c.trigger.reason !== (input.wakeReason ?? "task_execution") ||
    (!hasResolutionWake && (c.trigger.interactionId !== null ||
      (c.trigger.sourceRunId !== null && !(hasSummaryAssignment && finalizedSummaryRecord) && !exactExplicitHumanSource))) ||
    !Array.isArray(c.messages) || (c.messages.length === 0 && !hasStageTrigger && !hasSummaryAssignment) || c.messages.length > 256 ||
    !Array.isArray(c.originCommentIds) || (!hasReviewWithdrawals && (hasStageTrigger || hasSummaryAssignment ? c.originCommentIds.length !== 0 : c.originCommentIds.length === 0)) || c.originCommentIds.length > 256 ||
    new Set(c.originCommentIds).size !== c.originCommentIds.length ||
    (c.humanResponses !== undefined && (!Array.isArray(c.humanResponses) || (!hasGoverned && !hasAcceptedPlanReview && !hasQuestions && !hasAdministrativeExpiries && !hasReviewWithdrawals && c.humanResponses.length !== 0))) ||
    !Array.isArray(c.interactionOutcomes) || (!hasGoverned && !hasAcceptedPlanReview && !hasQuestions && !hasAdministrativeExpiries && !hasReviewWithdrawals && c.interactionOutcomes.length !== 0) ||
    (c.recoveryOutcomes !== undefined && (!Array.isArray(c.recoveryOutcomes) || c.recoveryOutcomes.length !== 0)) ||
    (c.completedActions !== undefined && (!Array.isArray(c.completedActions) || c.completedActions.length > 64)) ||
    (c.completedWork !== null && c.completedWork !== capture.summary?.rendition?.body && c.completedWork !== capture.finalizedSummary?.body) || !Array.isArray(c.unresolvedInteractionIds) || c.unresolvedInteractionIds.length > 256 ||
    capture.commentSources.length !== c.messages.length || capture.wake.reason !== input.wakeReason ||
    (!hasStageTrigger && !hasSummaryAssignment && (capture.wake.requestedByActorType !== "user" || !capture.wake.requestedByActorId))) return null;
  const adoption = capture.wake.manualQueueAdoption;
  if (adoption && (Object.keys(adoption).sort().join(",") !==
      "agentId,companyId,issueId,operatorUserId,originCommentIds,originQueueIds,runId,schema,wakeupRequestId" ||
      adoption.schema !== "paperclip.native-manual-queue-adoption.v1" || adoption.companyId !== input.companyId ||
      adoption.issueId !== input.issueId || adoption.agentId !== input.agentId || adoption.runId !== input.runId ||
      adoption.wakeupRequestId !== input.wakeupRequestId || adoption.operatorUserId !== capture.wake.requestedByActorId ||
      adoption.operatorUserId !== input.responsibleUserId || capture.wake.requestedByActorType !== "user" || !Array.isArray(adoption.originQueueIds) || !adoption.originQueueIds.length ||
      !Array.isArray(adoption.originCommentIds) || adoption.originQueueIds.length > 256 ||
      adoption.originCommentIds.length > 256 || adoption.originQueueIds.some(id => typeof id !== "string" || !uuid.test(id)) ||
      adoption.originQueueIds.some((id, index) => index > 0 && adoption.originQueueIds[index - 1]! >= id) ||
      !isDeepStrictEqual(adoption.originCommentIds, [...new Set(capture.wake.originCommentIds)].sort()))) return null;
  if (![input.companyId, input.issueId, input.runId, input.agentId, input.wakeupRequestId].every(id => typeof id === "string" && uuid.test(id)) ||
    capture.wake.originCommentIds.length > 256 || capture.wake.originCommentIds.some(id => typeof id !== "string" || !uuid.test(id)) ||
    c.originCommentIds.some(id => typeof id !== "string" || !uuid.test(id))) return null;
  const stageActions=capture.stageActions;
  if ((c.completedActions?.length ?? 0) > 0) {
    if(!Array.isArray(stageActions) || stageActions.length !== c.completedActions!.length ||
      new Set(stageActions.map(value=>`${value.runId}:${value.apiReceiptId}`)).size !== stageActions.length) return null;
    for(const value of stageActions){
      if(!value || Object.keys(value).sort().join(",") !==
        "action,agentId,apiReceiptHash,apiReceiptId,assessmentId,callId,companyId,dispatchId,executionInputDigest,finalizationVersion,finalizerDecisionHash,finalizerDecisionId,fromState,issueId,originHash,receiptDigest,reservationId,responsibleUserId,resultHash,resultId,runId,stageDecisionHash,stageDecisionId,stageSource,toState" ||
        value.companyId !== input.companyId || value.issueId !== input.issueId || value.runId === input.runId ||
        ![value.runId,value.agentId,value.resultId,value.assessmentId,value.finalizerDecisionId,value.stageDecisionId,value.dispatchId,value.reservationId].every(id=>typeof id === "string" && uuid.test(id)) ||
        ![value.originHash,value.apiReceiptId,value.apiReceiptHash,value.receiptDigest,value.executionInputDigest,value.stageDecisionHash,value.finalizerDecisionHash].every(hash=>typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)) ||
        typeof value.resultHash !== "string" || !/^(?:sha256:)?[a-f0-9]{64}$/.test(value.resultHash) ||
        typeof value.responsibleUserId !== "string" || !value.responsibleUserId || typeof value.callId !== "string" ||
        typeof value.finalizationVersion !== "string" || !Number.isFinite(Date.parse(value.finalizationVersion)) ||
        !value.action || Object.keys(value.action).sort().join(",") !== "operationId,receiptId,result,runId" ||
        value.action.runId !== value.runId || value.action.receiptId !== value.apiReceiptId || value.action.operationId !== "POST /api/issues/{id}/comments" ||
        !c.completedActions!.some(action=>isDeepStrictEqual(action,value.action)) ||
        !value.stageSource || value.stageSource.kind !== "native_task_wake" || value.stageSource.runId !== value.runId || value.stageSource.issueId !== input.issueId ||
        !nativePayloadSourceInputSchema.safeParse(value.stageSource).success ||
        !value.fromState || !issueExecutionStateSchema.safeParse(value.fromState).success ||
        !isDeepStrictEqual(issueExecutionStateSchema.parse(value.fromState),value.fromState) ||
        !value.toState || !issueExecutionStateSchema.safeParse(value.toState).success ||
        !isDeepStrictEqual(issueExecutionStateSchema.parse(value.toState),value.toState) || value.fromState.status !== "pending" || value.fromState.currentParticipant?.type !== "agent" ||
        value.fromState.currentParticipant.agentId !== value.agentId || !value.toState || value.toState.lastDecisionId !== value.stageDecisionId ||
        !["approved","changes_requested"].includes(value.toState.lastDecisionOutcome ?? "")) return null;
    }
  } else if (stageActions !== undefined) return null;
  if (capture.summary) {
    const summary = capture.summary;
    if (Object.keys(summary).sort().join(",") !== "rawTrustHash,rendition,source" ||
      typeof summary.rawTrustHash !== "string" || !/^[a-f0-9]{64}$/.test(summary.rawTrustHash) || !summary.source || !summary.rendition || !nativePayloadSourceInputSchema.safeParse(summary.source.input).success ||
      Object.keys(summary.rendition).sort().join(",") !== "body,key,sourceTrust,title,updatedAt" ||
      summary.rendition.key !== ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY || typeof summary.rendition.body !== "string" ||
      !(summary.rendition.title === null || typeof summary.rendition.title === "string") ||
      typeof summary.rendition.updatedAt !== "string" || !Number.isFinite(Date.parse(summary.rendition.updatedAt)) ||
      (summary.rendition.sourceTrust !== null && !sourceTrustMetadataSchema.safeParse(summary.rendition.sourceTrust).success) ||
      summary.source.input.kind !== "document_revision" || summary.source.input.issueId !== input.issueId ||
      c.completedWork !== summary.rendition.body) return null;
  }
  if (capture.finalizedSummary) {
    const value = capture.finalizedSummary, receipt = nativeRunInputSourceReceiptSchema.safeParse(value.parentReceipt);
    const stageEntry=value.stageEntryRead;
    const reviewWithdrawalSummary = reviewWithdrawalSummarySourceRunId !== null &&
      value.sourceRunId === reviewWithdrawalSummarySourceRunId;
    const expectedKeys=stageEntry ? "agentId,assessmentId,body,companyId,decisionDigest,decisionId,decisionSnapshotHash,finalizationVersion,issueId,parentReceipt,receiverRunId,resultCanonicalSha256,resultCreatedAt,resultId,sourceRunId,stageEntryRead" :
      "agentId,assessmentId,body,companyId,decisionDigest,decisionId,decisionSnapshotHash,finalizationVersion,issueId,parentReceipt,receiverRunId,resultCanonicalSha256,resultCreatedAt,resultId,sourceRunId";
    if ((!hasGoverned && !(hasStageTrigger && stageEntry) && !hasSummaryAssignment && !reviewWithdrawalSummary) || capture.summary ||
      Object.keys(value).sort().join(",") !== expectedKeys ||
      value.companyId !== input.companyId || value.issueId !== input.issueId || value.agentId !== input.agentId ||
      value.receiverRunId !== input.runId || value.sourceRunId !== (hasStageTrigger ? stageTrigger!.executorRunId : c.trigger.sourceRunId) ||
      ![value.sourceRunId,value.resultId,value.assessmentId,value.decisionId].every(id => typeof id === "string" && uuid.test(id)) ||
      typeof value.resultCanonicalSha256 !== "string" || !/^(?:sha256:)?[a-f0-9]{64}$/.test(value.resultCanonicalSha256) ||
      typeof value.decisionDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.decisionDigest) ||
      typeof value.decisionSnapshotHash !== "string" || !/^[a-f0-9]{64}$/.test(value.decisionSnapshotHash) ||
      typeof value.resultCreatedAt !== "string" || !Number.isFinite(Date.parse(value.resultCreatedAt)) ||
      typeof value.finalizationVersion !== "string" || !Number.isFinite(Date.parse(value.finalizationVersion)) ||
      typeof value.body !== "string" || value.body.length > 32_000 || c.completedWork !== value.body || !receipt.success ||
      receipt.data.binding.companyId !== input.companyId || receipt.data.binding.issueId !== input.issueId ||
      receipt.data.binding.agentId !== (stageEntry?.agentId ?? input.agentId) || receipt.data.binding.runId !== value.sourceRunId ||
      (hasStageTrigger && (!stageEntry || stageEntry.kind !== "stage_entry" || stageEntry.companyId !== input.companyId ||
        stageEntry.issueId !== input.issueId || stageEntry.runId !== stageTrigger!.executorRunId ||
        stageEntry.agentId !== stageTrigger!.executorAgentId || stageTrigger!.runId !== input.runId ||
        stageEntry.resultId!==value.resultId || stageEntry.resultHash!==value.resultCanonicalSha256 ||
        stageEntry.decisionId!==value.decisionId || stageEntry.finalizationVersion!==value.finalizationVersion ||
        Object.keys(stageEntry).sort().join(",") !== "agentId,companyId,decisionId,executionInputDigest,finalizationVersion,issueId,kind,receiptDigest,resultHash,resultId,runId,taskCapture,transitionIds" ||
        ![stageEntry.runId,stageEntry.agentId,stageEntry.resultId,stageEntry.decisionId].every(value=>typeof value === "string" && uuid.test(value)) ||
        ![stageEntry.receiptDigest,stageEntry.executionInputDigest].every(value=>typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) ||
        typeof stageEntry.resultHash!=="string" || !/^(?:sha256:)?[a-f0-9]{64}$/.test(stageEntry.resultHash) ||
        typeof stageEntry.finalizationVersion !== "string" || !Number.isFinite(Date.parse(stageEntry.finalizationVersion)) ||
        !Array.isArray(stageEntry.transitionIds) || stageEntry.transitionIds.length===0 || stageEntry.transitionIds.some(id=>typeof id!=="string" || !uuid.test(id)) ||
        !stageEntry.taskCapture || !nativePayloadSourceInputSchema.safeParse(stageEntry.taskCapture.input).success ||
        !nativePayloadSourceSnapshotSchema.safeParse(stageEntry.taskCapture.payloadSourceSnapshot).success ||
        stageEntry.taskCapture.input.kind!=="task" || stageEntry.taskCapture.input.issueId !== input.issueId ||
        stageEntry.taskCapture.input.contentHash!==stageEntry.taskCapture.payloadSourceSnapshot.owner.contentHash ||
        !receipt.data.bootstrap.inputs.some(source=>isDeepStrictEqual(source,stageEntry.taskCapture.input)))) || (!hasStageTrigger && stageEntry)) return null;
  }
  const ids = new Set<string>();
  for (const message of c.messages) {
    if (!message || Object.keys(message).sort().join(",") !==
      "authorId,authorType,body,createdAt,createdByRunId,deleted,id,sourceTrust,updatedAt" ||
      typeof message.id !== "string" || !uuid.test(message.id) || ids.has(message.id) || typeof message.body !== "string" ||
      message.deleted !== false || !["user", "agent", "system"].includes(message.authorType) ||
      (message.sourceTrust !== null && !sourceTrustMetadataSchema.safeParse(message.sourceTrust).success) ||
      !(message.authorId === null || typeof message.authorId === "string") ||
      !(message.createdByRunId === null || typeof message.createdByRunId === "string") ||
      typeof message.createdAt !== "string" || typeof message.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(message.createdAt)) || !Number.isFinite(Date.parse(message.updatedAt))) return null;
    ids.add(message.id);
    const sources = capture.commentSources.filter(value => value && value.input?.kind === "comment" && value.input.commentId === message.id &&
      value.input.issueId === input.issueId && typeof value.input.sourceVersion === "string" && /^\d+(?:\.\d+)?$/.test(value.input.sourceVersion) &&
      value.input.contentHash === nativeContinuationMessageHash(message));
    if (sources.length !== 1 || Object.keys(sources[0]!).sort().join(",") !==
      (sources[0]!.acceptedPresentationOwner ? "acceptedPresentationOwner,input,payloadSourceSnapshot" : "input,payloadSourceSnapshot")) return null;
    const sourceSnapshot = nativePayloadSourceSnapshotSchema.safeParse(sources[0]!.payloadSourceSnapshot);
    if (sources[0]!.acceptedPresentationOwner) {
      const presentationOwner = sources[0]!.acceptedPresentationOwner;
      const exactWithdrawalProducer = hasReviewWithdrawals && withdrawals!.some(value =>
        value && ((value.projection?.kind === "ask_user_questions" && value.projection.status === "cancelled") ||
          ((value.projection?.kind === "request_confirmation" || value.projection?.kind === "request_checkbox_confirmation") &&
            value.projection.status === "rejected")) && value.projection.interactionSourceRunId === message.createdByRunId &&
        value.projection.owner?.sourceKind === "native_interaction" &&
        value.projection.owner.sourceRunStatus === "succeeded" &&
        value.projection.owner.sourceRunId === message.createdByRunId);
      if ((!hasSummaryAssignment && !exactWithdrawalProducer) || sourceSnapshot.success ||
          !exactNativeAcceptedPresentationCommentOwner(presentationOwner, {
            binding: { companyId: input.companyId, issueId: input.issueId, agentId: input.agentId }, commentSource: sources[0]!.input,
          }) || presentationOwner.acceptedSummaryOwner.sourceRunId !== message.createdByRunId || message.authorType !== "agent") return null;
    }
  }
  if (c.resumeDelta !== undefined) {
    if (!c.resumeDelta || typeof c.resumeDelta !== "object" || Array.isArray(c.resumeDelta)) return null;
    const previous = capture.previousContext, retained = capture.retainedSource;
    if (!previous || !retained || !nativePayloadSourceInputSchema.safeParse(retained).success || retained.kind !== "retained_run" ||
      Object.keys(previous).sort().join(",") !== "messages,runId" || previous.runId !== retained.runId ||
      !Array.isArray(previous.messages) || previous.messages.length > 256 ||
      Object.keys(c.resumeDelta).sort().join(",") !== "baseRunId,messages" || c.resumeDelta.baseRunId !== previous.runId ||
      !Array.isArray(c.resumeDelta.messages) || c.resumeDelta.messages.length > 256 ||
      !isDeepStrictEqual(c.resumeDelta.messages, c.messages.filter(message => c.originCommentIds.includes(message.id) ||
        !previous.messages.some(prior => prior && prior.id === message.id && prior.updatedAt === message.updatedAt &&
          prior.body === message.body && prior.deleted === message.deleted && prior.authorId === message.authorId &&
          (prior.createdByRunId ?? null) === message.createdByRunId && isDeepStrictEqual(prior.sourceTrust, message.sourceTrust))))) return null;
  } else if (capture.previousContext !== undefined) return null;
  const pending = capture.pendingInteractions ?? [];
  if (!Array.isArray(pending) || pending.length !== c.unresolvedInteractionIds.length ||
    new Set(c.unresolvedInteractionIds).size !== c.unresolvedInteractionIds.length ||
    new Set(pending.map(value => value?.projection?.interactionId)).size !== pending.length) return null;
  for (const value of pending) {
    if (!value || !value.projection || !value.source ||
      Object.keys(value).sort().join(",") !== "agentId,companyId,issueId,projection,runId,source" ||
      value.companyId !== input.companyId || value.issueId !== input.issueId || value.agentId !== input.agentId || value.runId !== input.runId) return null;
    const p = value.projection;
    if (Object.keys(p).sort().join(",") !== "actionRequestId,argumentsHash,companyId,expiresAt,interactionId,invocationId,invocationStatus,issueId,kind,originCommentIds,requestStatus,sourceCommentId,sourceRunId,sourceVersion,status,version" ||
      p.version !== 1 || p.companyId !== input.companyId || p.issueId !== input.issueId || p.kind !== "request_confirmation" || p.status !== "pending" ||
      !c.unresolvedInteractionIds.includes(p.interactionId) || ![p.interactionId,p.actionRequestId,p.invocationId,p.sourceRunId].every(id => typeof id === "string" && uuid.test(id)) ||
      typeof p.sourceVersion !== "string" || typeof p.argumentsHash !== "string" ||
      !/^\d+(?:\.\d+)?$/.test(p.sourceVersion) || !/^[a-f0-9]{64}$/.test(p.argumentsHash) ||
      p.requestStatus !== "pending" || p.invocationStatus !== "awaiting_approval" ||
      !Array.isArray(p.originCommentIds) || p.originCommentIds.length > 256 || p.originCommentIds.some(id => typeof id !== "string" || !uuid.test(id)) ||
      !(p.sourceCommentId === null || typeof p.sourceCommentId === "string" && uuid.test(p.sourceCommentId)) ||
      !(p.expiresAt === null || typeof p.expiresAt === "string" && Number.isFinite(Date.parse(p.expiresAt)) &&
        Date.parse(p.expiresAt) > (input.historicalPendingSources?.some(source=>isDeepStrictEqual(source,value)) ? Number(p.sourceVersion)*1000 : Date.now())) ||
      !isDeepStrictEqual(value.source, { kind: "interaction", issueId: input.issueId, interactionId: p.interactionId,
        sourceVersion: p.sourceVersion, contentHash: nativeSha256({ rendition: "native_governed_pending_reference_v1", projection: p }) })) return null;
  }
  const origins = c.originCommentIds.map(id => c.messages.find(message => message.id === id));
  const admittedWakeOrigins = capture.wake.originCommentIds.map(id =>
    c.messages.find(message => message.id === id));
  if (hasReviewWithdrawals) {
    const ids = new Set<string>();
    if (withdrawals!.length !== c.interactionOutcomes.length ||
      new Set(withdrawals!.map(value => value?.projection?.interactionId)).size !== withdrawals!.length ||
      origins.some(message => !message) ||
      !capture.wake.interaction || Object.keys(capture.wake.interaction).sort().join(",") !==
        "interactionId,interactionKind,interactionStatus,sourceRunId" ||
      (c.humanResponses?.length ?? 0) !== withdrawals!.filter(value => value?.projection?.kind !== "ask_user_questions").length) return null;
    for (const value of withdrawals!) {
      if (!value || Object.keys(value).sort().join(",") !== "agentId,companyId,continuationSource,interactionOutcome,issueId,nativeResponse,nativeSource,projection,runId" ||
        value.companyId !== input.companyId || value.issueId !== input.issueId || value.agentId !== input.agentId || value.runId !== input.runId ||
        !value.nativeResponse || !value.nativeSource || !value.continuationSource || !value.projection || !value.interactionOutcome) return null;
      const p = value.projection, o = p.owner;
      if (Object.keys(p).sort().join(",") !== "companyId,humanResponseDigest,interactionId,interactionSourceRunId,issueId,kind,nativeResponseDigest,owner,resultHash,sourceVersion,status,version" ||
        p.version !== 1 || p.companyId !== input.companyId || p.issueId !== input.issueId ||
        !uuid.test(p.interactionId) || !/^\d+(?:\.\d+)?$/.test(p.sourceVersion) ||
        !["ask_user_questions", "request_confirmation", "request_checkbox_confirmation"].includes(p.kind) ||
        !["cancelled", "rejected"].includes(p.status) ||
        (p.kind === "ask_user_questions" ? p.status !== "cancelled" : p.status !== "rejected") ||
        !/^[a-f0-9]{64}$/.test(p.resultHash) ||
        !o || typeof o !== "object" || Array.isArray(o) ||
        !Object.prototype.hasOwnProperty.call(p, "interactionSourceRunId") ||
        typeof p.interactionSourceRunId !== "string" || !uuid.test(p.interactionSourceRunId) ||
        Object.keys(o).sort().join(",") !== "finalizationResultHash,finalizationResultId,planId,resolvedAt,resolvedByUserId,sourceKind,sourceReceiptHash,sourceRunId,sourceRunStatus,workerAttemptId,workerId" ||
        ![p.interactionId, o.sourceRunId, o.planId, o.workerId, o.workerAttemptId].every(id => typeof id === "string" && uuid.test(id)) ||
        o.sourceKind !== "native_interaction" || p.interactionSourceRunId !== o.sourceRunId || c.trigger.sourceRunId !== o.sourceRunId ||
        o.sourceRunStatus !== "succeeded" || typeof o.sourceReceiptHash !== "string" || !/^[a-f0-9]{64}$/.test(o.sourceReceiptHash) ||
        typeof o.finalizationResultId !== "string" || !uuid.test(o.finalizationResultId) ||
        typeof o.finalizationResultHash !== "string" || !/^[a-f0-9]{64}$/.test(o.finalizationResultHash) ||
        typeof o.resolvedByUserId !== "string" ||
        !o.resolvedByUserId.trim() || o.resolvedByUserId.length > 512 ||
        !Number.isFinite(Date.parse(o.resolvedAt)) ||
        value.interactionOutcome.id !== p.interactionId || value.interactionOutcome.kind !== p.kind || value.interactionOutcome.status !== p.status ||
        nativeSha256(value.interactionOutcome.result) !== p.resultHash ||
        !isDeepStrictEqual(c.interactionOutcomes.find(outcome => outcome.id === p.interactionId), value.interactionOutcome) ||
        Object.keys(value.nativeResponse).sort().join(",") !== "interactionId,kind,response" ||
        Object.keys(value.nativeResponse.response).sort().join(",") !== "result,status" ||
        Object.keys(value.interactionOutcome).sort().join(",") !== "id,kind,result,status" ||
        value.nativeResponse.interactionId !== p.interactionId || value.nativeResponse.kind !== p.kind ||
        value.nativeResponse.response.status !== p.status ||
        (p.kind === "ask_user_questions" ? (value.nativeResponse.response.result as Record<string, unknown> | null)?.cancelled !== true :
          (value.nativeResponse.response.result as Record<string, unknown> | null)?.outcome !== "rejected") ||
        nativeSha256(value.nativeResponse) !== p.nativeResponseDigest ||
        !nativePayloadSourceInputSchema.safeParse(value.nativeSource).success || value.nativeSource.kind !== "interaction" ||
        value.nativeSource.issueId !== input.issueId || value.nativeSource.interactionId !== p.interactionId ||
        value.nativeSource.sourceVersion !== p.sourceVersion || value.nativeSource.contentHash !== p.nativeResponseDigest ||
        !isDeepStrictEqual(value.continuationSource, { ...value.nativeSource,
          contentHash: nativeSha256({ rendition: "native_human_review_withdrawal_v1", projection: p,
            interactionOutcome: value.interactionOutcome }) }) || ids.has(p.interactionId)) return null;
      ids.add(p.interactionId);
      const response = c.humanResponses?.find(row => row.id === p.interactionId);
      if ((p.kind === "ask_user_questions" && (response || p.humanResponseDigest !== null)) ||
        (p.kind !== "ask_user_questions" && (!response || !/^[a-f0-9]{64}$/.test(p.humanResponseDigest ?? "") ||
          nativeSha256(response) !== p.humanResponseDigest || response.kind !== p.kind || response.status !== p.status ||
          response.resolvedByUserId !== o.resolvedByUserId || response.resolvedAt !== o.resolvedAt ||
          !response.result || typeof response.result !== "object" || Array.isArray(response.result) ||
          !("outcome" in response.result) || response.result.outcome !== "rejected"))) return null;
    }
    const trigger = withdrawals!.find(value => value.projection.interactionId === c.trigger.interactionId)?.projection;
    if (!trigger || capture.wake.interaction.interactionId !== c.trigger.interactionId ||
      capture.wake.interaction.interactionKind !== trigger.kind || capture.wake.interaction.interactionStatus !== trigger.status ||
      capture.wake.interaction.sourceRunId !== trigger.interactionSourceRunId || capture.wake.requestedByActorId !== trigger.owner.resolvedByUserId ||
      capture.wake.requestedByActorType !== "user" || c.trigger.sourceRunId !== trigger.interactionSourceRunId ||
      withdrawals!.some(value => !value.nativeSource || !value.continuationSource)) return null;
  } else if (hasGoverned) {
    const captures = governed!;
    if (captures.some(value => !value || typeof value !== "object" || !value.projection || typeof value.projection !== "object" ||
      !value.projection.owner || typeof value.projection.owner !== "object" || !Array.isArray(value.projection.owner.originCommentIds) ||
      !value.projection.humanResponse || typeof value.projection.humanResponse !== "object" ||
      !value.projection.interactionOutcome || typeof value.projection.interactionOutcome !== "object" ||
      !value.nativeResponse || typeof value.nativeResponse !== "object" || !value.nativeResponse.response || typeof value.nativeResponse.response !== "object" || !value.nativeSource || !value.continuationSource)) return null;
    if (captures.length !== c.interactionOutcomes.length || captures.length !== c.humanResponses?.length ||
      new Set(captures.map(value => value.projection.interactionId)).size !== captures.length) return null;
    const delivery = capture.delivery, d = delivery?.projection;
    if (hasResolutionWake) {
      if (!capture.wake.interaction || Object.keys(capture.wake.interaction).sort().join(",") !==
        "interactionId,interactionKind,interactionStatus,sourceRunId" || c.trigger.interactionId !== capture.wake.interaction.interactionId ||
        c.trigger.sourceRunId !== capture.wake.interaction.sourceRunId || !c.trigger.sourceRunId || !uuid.test(c.trigger.sourceRunId)) return null;
      if (!delivery || !d || !d.agentMessage || Object.keys(delivery).sort().join(",") !== "agentId,companyId,issueId,projection,runId,source,wakeupRequestId" ||
        delivery.companyId !== input.companyId || delivery.issueId !== input.issueId || delivery.agentId !== input.agentId ||
        delivery.runId !== input.runId || delivery.wakeupRequestId !== input.wakeupRequestId ||
        Object.keys(d).sort().join(",") !== "actionRequestIds,agentId,agentMessage,companyId,cutoff,idempotencyKey,interactionId,interactionKind,interactionStatus,issueId,runId,sourceRunId,sourceVersion,version,wakeupRequestId" ||
        d.version !== 1 || d.companyId !== input.companyId || d.issueId !== input.issueId || d.agentId !== input.agentId ||
        d.runId !== input.runId || d.wakeupRequestId !== input.wakeupRequestId || d.interactionId !== c.trigger.interactionId ||
        d.sourceRunId !== c.trigger.sourceRunId || d.interactionKind !== "request_confirmation" ||
        d.interactionStatus !== capture.wake.interaction.interactionStatus || !Array.isArray(d.actionRequestIds) ||
        d.actionRequestIds.length === 0 || d.actionRequestIds.length > 256 || new Set(d.actionRequestIds).size !== d.actionRequestIds.length ||
        !d.cutoff || Object.keys(d.cutoff).sort().join(",") !== "actionRequestId,createdAt" ||
        d.cutoff.actionRequestId !== d.actionRequestIds.at(-1) || typeof d.cutoff.createdAt !== "string" || !Number.isFinite(Date.parse(d.cutoff.createdAt)) ||
        d.idempotencyKey !== `tool-action-response:${d.actionRequestIds[0]}` ||
        d.actionRequestIds.some(id => !captures.some(value => value.projection.owner.actionRequestId === id && value.projection.owner.sourceRunId === d.sourceRunId)) ||
        Object.keys(d.agentMessage).sort().join(",") !== "pluginKey,sessionId,source,text,untrustedToolResults" ||
        d.agentMessage.source !== "tool_action_review" || d.agentMessage.pluginKey !== null || d.agentMessage.sessionId !== d.interactionId ||
        typeof d.agentMessage.text !== "string" || !Array.isArray(d.agentMessage.untrustedToolResults) || d.agentMessage.untrustedToolResults.length > 8 ||
        d.agentMessage.untrustedToolResults.some(value => !value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "actionRequestId,declineReason,error,resultSummary,toolName" ||
          !d.actionRequestIds.includes(value.actionRequestId) || typeof value.toolName !== "string" || typeof value.resultSummary !== "string" ||
          !(value.error === null || typeof value.error === "string") || !(value.declineReason === null || typeof value.declineReason === "string")) ||
        !isDeepStrictEqual(delivery.source, { kind: "interaction", issueId: input.issueId, interactionId: d.interactionId,
          sourceVersion: d.sourceVersion, contentHash: nativeSha256({ rendition: "native_tool_action_delivery_v1", projection: d }) })) return null;
    } else if (capture.delivery !== undefined) return null;
    const originIds = new Set<string>();
    for (const value of captures) {
      const p = value.projection;
      if (value.companyId !== input.companyId || value.issueId !== input.issueId || value.runId !== input.runId || value.agentId !== input.agentId ||
        Object.keys(value).sort().join(",") !== "agentId,companyId,continuationSource,issueId,nativeResponse,nativeSource,projection,runId" ||
        Object.keys(p).sort().join(",") !== "companyId,humanResponse,interactionId,interactionOutcome,issueId,nativeResponseDigest,owner,sourceVersion,version" ||
        Object.keys(p.owner).sort().join(",") !== "actionRequestId,argumentsHash,continuationPolicy,invocationId,invocationStatus,originCommentIds,requestStatus,resolvedAt,resolvedByUserId,sourceCommentId,sourceRunId" ||
        p.owner.originCommentIds.length > 256 || p.owner.originCommentIds.some(id => typeof id !== "string" || !uuid.test(id)) ||
        p.version !== 1 || p.companyId !== input.companyId || p.issueId !== input.issueId ||
        typeof p.interactionId !== "string" || !uuid.test(p.interactionId) || typeof p.sourceVersion !== "string" || !/^\d+(?:\.\d+)?$/.test(p.sourceVersion) ||
        value.nativeSource.kind !== "interaction" || value.nativeSource.issueId !== input.issueId || value.nativeSource.interactionId !== p.interactionId ||
        value.nativeResponse.interactionId !== p.interactionId || value.nativeResponse.kind !== "request_confirmation" ||
        value.nativeResponse.response.status !== p.interactionOutcome.status ||
        value.nativeSource.sourceVersion !== p.sourceVersion || nativeSha256(value.nativeResponse) !== value.nativeSource.contentHash ||
        p.nativeResponseDigest !== value.nativeSource.contentHash ||
        !isDeepStrictEqual(value.continuationSource, { ...value.nativeSource,
          contentHash: nativeSha256({ rendition: "native_governed_continuation_v1", projection: p }) }) ||
        p.humanResponse.id !== p.interactionId || p.interactionOutcome.id !== p.interactionId ||
        p.humanResponse.kind !== "request_confirmation" || p.interactionOutcome.kind !== "request_confirmation" ||
        p.humanResponse.status !== p.interactionOutcome.status || !["accepted", "rejected"].includes(p.humanResponse.status) ||
        p.owner.resolvedByUserId !== p.humanResponse.resolvedByUserId || p.owner.resolvedAt !== p.humanResponse.resolvedAt ||
        typeof p.owner.sourceRunId !== "string" || !uuid.test(p.owner.sourceRunId) ||
        typeof p.owner.actionRequestId !== "string" || !uuid.test(p.owner.actionRequestId) ||
        typeof p.owner.invocationId !== "string" || !uuid.test(p.owner.invocationId) || typeof p.owner.argumentsHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(p.owner.argumentsHash) ||
        !["executed", "failed", "rejected"].includes(p.owner.requestStatus) ||
        p.owner.invocationStatus !== (p.owner.requestStatus === "executed" ? "succeeded" : p.owner.requestStatus === "rejected" ? "denied" : "failed") ||
        p.humanResponse.status !== (p.owner.requestStatus === "rejected" ? "rejected" : "accepted") ||
        nativeSha256(c.humanResponses?.find(response => response.id === p.interactionId)) !== nativeSha256(p.humanResponse) ||
        nativeSha256(c.interactionOutcomes.find(outcome => outcome.id === p.interactionId)) !== nativeSha256(p.interactionOutcome)) return null;
      for (const id of [...p.owner.originCommentIds, ...(p.owner.sourceCommentId ? [p.owner.sourceCommentId] : [])]) originIds.add(id);
    }
    if (hasResolutionWake) {
      const trigger = captures.find(value => value.projection.interactionId === c.trigger.interactionId)?.projection;
      if (!capture.wake.interaction || !d || !trigger || capture.wake.requestedByActorId !== trigger.owner.resolvedByUserId || trigger.interactionOutcome.status !== capture.wake.interaction.interactionStatus ||
        trigger.interactionOutcome.kind !== capture.wake.interaction.interactionKind || trigger.owner.sourceRunId !== c.trigger.sourceRunId ||
        d.sourceVersion !== trigger.sourceVersion ||
        origins.some(message => !message || message.authorType !== "user" || message.createdByRunId !== null || !originIds.has(message.id))) return null;
    } else if (!hasStageTrigger && (origins.some(message => !message || message.authorType !== "user" || message.createdByRunId !== null ||
      !capture.wake.originCommentIds.includes(message.id)) ||
      !origins.some(message => message?.authorId === capture.wake.requestedByActorId))) return null;
  } else if (hasQuestions) {
    if (questions!.some(value => !value || typeof value !== "object" || !value.nativeSource || !value.nativeResponse ||
        !value.nativeResponse.response || !value.humanResponse || !value.interactionOutcome) ||
      (c.humanResponses?.length ?? 0) !== questions!.length || c.interactionOutcomes.length !== questions!.length ||
      new Set(questions!.map(value => value.nativeSource.interactionId)).size !== questions!.length) return null;
    for (const value of questions!) {
      const { owner, nativeSource, nativeResponse, humanResponse, interactionOutcome } = value;
      const result = askUserQuestionsResultSchema.safeParse(interactionOutcome?.result);
      if (Object.keys(value).sort().join(",") !== "agentId,companyId,continuationSource,humanResponse,interactionOutcome,issueId,nativeResponse,nativeSource,owner,runId" ||
        !owner || Object.keys(owner).sort().join(",") !== "continuationPolicy,originCommentIds,resolvedAt,resolvedByUserId,sourceCommentId,sourceRunId" ||
        value.companyId !== input.companyId || value.issueId !== input.issueId || value.agentId !== input.agentId || value.runId !== input.runId ||
        !nativePayloadSourceInputSchema.safeParse(nativeSource).success || nativeSource.kind !== "interaction" || nativeSource.issueId !== input.issueId ||
        !uuid.test(nativeSource.interactionId) || !/^\d+(?:\.\d+)?$/.test(nativeSource.sourceVersion) ||
        nativeResponse?.interactionId !== nativeSource.interactionId || nativeResponse.kind !== "ask_user_questions" ||
        nativeResponse.response.status !== "answered" || nativeSha256(nativeResponse) !== nativeSource.contentHash ||
        !isDeepStrictEqual(value.continuationSource, nativeAnsweredQuestionContinuationSource(value)) ||
        interactionOutcome?.id !== nativeSource.interactionId || interactionOutcome.kind !== "ask_user_questions" || interactionOutcome.status !== "answered" ||
        !result.success || result.data.cancelled || !isDeepStrictEqual(result.data, interactionOutcome.result) ||
        !isDeepStrictEqual({ ...(nativeResponse.response.result as Record<string, unknown>), summaryMarkdown: undefined }, { ...result.data, summaryMarkdown: undefined }) ||
        Object.keys(nativeResponse).sort().join(",") !== "interactionId,kind,response" ||
        Object.keys(nativeResponse.response).sort().join(",") !== "result,status" ||
        !askUserQuestionsResultSchema.safeParse(nativeResponse.response.result).success ||
        !isDeepStrictEqual(askUserQuestionsResultSchema.parse(nativeResponse.response.result), nativeResponse.response.result) ||
        typeof owner.resolvedByUserId !== "string" || !owner.resolvedByUserId.trim() || owner.resolvedByUserId.length > 512 ||
        !Number.isFinite(Date.parse(owner.resolvedAt)) || !["wake_assignee", "none"].includes(owner.continuationPolicy) ||
        !(owner.sourceRunId === null || uuid.test(owner.sourceRunId)) || !(owner.sourceCommentId === null || uuid.test(owner.sourceCommentId)) ||
        !Array.isArray(owner.originCommentIds) || owner.originCommentIds.length > 256 || owner.originCommentIds.some(id => !uuid.test(id)) ||
        !isDeepStrictEqual(humanResponse, { id: nativeSource.interactionId, kind: "ask_user_questions", status: "answered",
          resolvedByUserId: owner.resolvedByUserId, resolvedAt: owner.resolvedAt,
          result: { answers: result.data.answers.map(answer => ({ questionId: answer.questionId, optionIds: answer.optionIds,
            ...(answer.otherText !== undefined ? { otherText: answer.otherText } : {}) })) } }) ||
        !isDeepStrictEqual(c.humanResponses?.find(response => response.id === nativeSource.interactionId), humanResponse) ||
        !isDeepStrictEqual(c.interactionOutcomes.find(outcome => outcome.id === nativeSource.interactionId), interactionOutcome)) return null;
    }
    if (capture.wake.interaction) {
      if (Object.keys(capture.wake.interaction).sort().join(",") !== "interactionId,interactionKind,interactionStatus,sourceRunId") return null;
      const trigger = questions!.find(value => value.nativeSource.interactionId === c.trigger.interactionId);
      if (!trigger || capture.wake.interaction.interactionId !== c.trigger.interactionId ||
        capture.wake.interaction.interactionKind !== "ask_user_questions" || capture.wake.interaction.interactionStatus !== "answered" ||
        capture.wake.interaction.sourceRunId !== c.trigger.sourceRunId || trigger.owner.sourceRunId !== c.trigger.sourceRunId) return null;
    }
    if (origins.some(message => !message || message.authorType !== "user" || message.createdByRunId !== null) ||
      admittedWakeOrigins.length === 0 || admittedWakeOrigins.some(message => !message || message.authorType !== "user" ||
        message.createdByRunId !== null || message.authorId !== capture.wake.requestedByActorId || !c.originCommentIds.includes(message.id))) return null;
  } else if (hasAcceptedPlanReview) {
    const plan = acceptedPlanReview!;
    const outcome = c.interactionOutcomes[0], response = c.humanResponses?.[0];
    if (Object.keys(plan).sort().join(",") !== "agentId,companyId,interactionId,interactionSource,issueId,originCommentIds,planRendition,planReviewContext,planSource,resolvedAt,resolvedByUserId,runId,sourceRunId,taskObjective,version" ||
      plan.version !== 1 || plan.companyId !== input.companyId || plan.issueId !== input.issueId || plan.agentId !== input.agentId || plan.runId !== input.runId ||
      !uuid.test(plan.interactionId) || typeof plan.resolvedByUserId !== "string" || !plan.resolvedByUserId.trim() ||
      plan.resolvedByUserId.length > 512 || !Number.isFinite(Date.parse(plan.resolvedAt)) ||
      !Array.isArray(plan.originCommentIds) || plan.originCommentIds.length !== c.originCommentIds.length ||
      plan.originCommentIds.some(id => typeof id !== "string") ||
      plan.originCommentIds.slice().sort().some((id, index) => id !== c.originCommentIds.slice().sort()[index]) ||
      typeof plan.taskObjective !== "string" || !plan.taskObjective.trim() ||
      plan.sourceRunId !== c.trigger.sourceRunId || c.trigger.interactionId !== plan.interactionId || !hasResolutionWake ||
      !capture.wake.interaction || capture.wake.interaction.interactionId !== plan.interactionId ||
      capture.wake.interaction.interactionKind !== "request_confirmation" || capture.wake.interaction.interactionStatus !== "accepted" ||
      capture.wake.interaction.sourceRunId !== plan.sourceRunId || capture.wake.requestedByActorType !== "user" ||
      capture.wake.requestedByActorId !== plan.resolvedByUserId ||
      !isDeepStrictEqual(plan.interactionSource, { kind: "interaction", issueId: input.issueId,
        interactionId: plan.interactionId, sourceVersion: plan.interactionSource.sourceVersion, contentHash: plan.interactionSource.contentHash }) ||
      plan.interactionSource.kind !== "interaction" || plan.interactionSource.issueId !== input.issueId ||
      plan.interactionSource.interactionId !== plan.interactionId || !/^\d+(?:\.\d+)?$/.test(plan.interactionSource.sourceVersion) ||
      !/^[a-f0-9]{64}$/.test(plan.interactionSource.contentHash) ||
      Object.keys(plan.planRendition).sort().join(",") !== "bodyHash,documentId,revisionId,revisionNumber" ||
      !uuid.test(plan.planRendition.documentId) || !uuid.test(plan.planRendition.revisionId) ||
      !Number.isSafeInteger(plan.planRendition.revisionNumber) || plan.planRendition.revisionNumber < 1 ||
      !/^[a-f0-9]{64}$/.test(plan.planRendition.bodyHash) ||
      !plan.planSource || !plan.planSource.input || !nativePayloadSourceInputSchema.safeParse(plan.planSource.input).success ||
      plan.planSource.input.kind !== "document_revision" || plan.planSource.input.issueId !== input.issueId ||
      plan.planSource.input.documentId !== plan.planRendition.documentId || plan.planSource.input.revisionId !== plan.planRendition.revisionId ||
      plan.planSource.input.contentHash !== plan.planRendition.bodyHash ||
      c.interactionOutcomes.length !== 1 || (c.humanResponses?.length ?? 0) !== 1 ||
      !outcome || outcome.id !== plan.interactionId || outcome.kind !== "request_confirmation" || outcome.status !== "accepted" ||
      !(outcome.result && typeof outcome.result === "object" && !Array.isArray(outcome.result) &&
        (outcome.result as Record<string, unknown>).outcome === "accepted") || !response || response.id !== plan.interactionId ||
      response.kind !== "request_confirmation" || response.status !== "accepted" || response.resolvedByUserId !== plan.resolvedByUserId ||
      response.resolvedAt !== plan.resolvedAt || capture.delivery !== undefined || governed !== undefined) return null;
    if (origins.some(message => !message) || capture.wake.originCommentIds.some(id => !plan.originCommentIds.includes(id))) return null;
  } else if (!hasReviewWithdrawals && (governed !== undefined || capture.delivery !== undefined || capture.wake.interaction || (!hasStageTrigger && !hasSummaryAssignment && (origins.some(message => !message || message.authorType !== "user" || message.createdByRunId !== null) ||
    admittedWakeOrigins.length === 0 || admittedWakeOrigins.some(message => !message || message.authorType !== "user" ||
      message.createdByRunId !== null || (!adoption && message.authorId !== capture.wake.requestedByActorId) ||
      !c.originCommentIds.includes(message.id) || (adoption && !adoption.originCommentIds.includes(message.id))))))) return null;
  const latest = c.messages.findLast(message => message.authorType === "user" && message.createdByRunId === null && message.body.trim());
  const withdrawalTaskObjective = hasReviewWithdrawals && typeof input.taskObjective === "string" &&
    Buffer.byteLength(input.taskObjective, "utf8") <= 64_000 ? input.taskObjective : null;
  if ((!latest && hasReviewWithdrawals && withdrawalTaskObjective === null) ||
    (!latest && !hasStageTrigger && !hasAcceptedPlanReview && !hasSummaryAssignment && !hasReviewWithdrawals) ||
    c.objective !== (hasSummaryAssignment ? input.taskObjective : latest?.body ??
      (hasReviewWithdrawals ? withdrawalTaskObjective : hasAcceptedPlanReview ? acceptedPlanReview!.taskObjective : stageTrigger?.taskObjective)) || Object.keys(c.coverage).sort().join(",") !==
    "kind,summaryThroughCommentId,throughCommentId" ||
    c.coverage.kind !== "full_task_history" || c.coverage.throughCommentId !== (c.messages.at(-1)?.id ?? null) ||
    c.coverage.summaryThroughCommentId !== null) return null;
  return capture;
}

export function exactNativeInitialTaskContinuation(input: Parameters<typeof exactNativeTaskContinuation>[0]): NativeTaskContinuationCapture | null {
  if (input.capture?.governedInteractions !== undefined || input.capture?.answeredQuestions !== undefined || input.capture?.wake.interaction !== undefined) return null;
  return exactNativeTaskContinuation(input);
}

/** Capture only the closed Task wake profile. Inline comments are admitted only
 * when their exact bounded renditions match unique owner captures. Any other
 * wake source, attachment, annotation, interaction, continuation or unknown
 * key stays unknown and prevents the bootstrap source set from closing. */
/** A branch hint is derived from the exact Native workspace input. It is
 * not a caller-provided workspace/Project grant or a substitute for currentness. */
function exactNativeTaskWakeWorkspaceHint(input: {
  companyId: string; issueId: string; runId: string; agentId?: string; value: unknown;
  capture?: { execution: NativeExecutionInput;
    source: Extract<NativePayloadSourceInput, { kind: "workspace_metadata" }> } | null;
}): boolean {
  if (!input.value || typeof input.value !== "object" || Array.isArray(input.value) ||
    Object.keys(input.value).join(",") !== "branchName") return false;
  const hint = input.value as Record<string, unknown>;
  const execution = input.capture?.execution;
  if (!execution || execution.schema !== "paperclip.native-execution-input.v4") return false;
  const binding = execution.binding, workspace = execution.workspace;
  const parsed = nativePayloadSourceInputSchema.safeParse(input.capture?.source);
  if (!binding || !workspace || !parsed.success || parsed.data.kind !== "workspace_metadata" ||
    binding.companyId !== input.companyId || binding.issueId !== input.issueId ||
    binding.runId !== input.runId || binding.agentId !== input.agentId ||
    typeof workspace.branchName !== "string" || !workspace.branchName.trim() ||
    hint.branchName !== workspace.branchName || parsed.data.runId !== input.runId ||
    parsed.data.executionWorkspaceId !== binding.executionWorkspaceId) return false;
  const source = parsed.data;
  const originMatches = source.origin === "execution_workspace"
    ? source.executionWorkspaceId !== input.runId && Number.isFinite(Date.parse(source.sourceVersion)) &&
      new Date(source.sourceVersion).toISOString() === source.sourceVersion
    : source.origin === "task_session" && source.sourceVersion === `task-session:${input.runId}`;
  const tuple = { cwd: workspace.cwd, repoUrl: workspace.repoUrl, repoRef: workspace.repoRef, branchName: workspace.branchName };
  return originMatches && source.contentHash === createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex");
}

/** Original ordinary plan metadata, selected by the canonical plan owner. */
export type NativeOrdinaryPlanReadCapture = {
  companyId: string; issueId: string; runId: string; agentId: string; responsibleUserId: string; wakeupRequestId: string;
  source: Extract<NativePayloadSourceInput, { kind: "document_revision" }>; revisionNumber: number;
};

function exactNativeOrdinaryPlanContext(input: {
  companyId: string; issueId: string; runId: string; agentId?: string; responsibleUserId?: string | null; wakeupRequestId?: string | null;
  capture?: NativeOrdinaryPlanReadCapture | null; value: unknown;
}): boolean {
  const c = input.capture;
  if (!c || Object.keys(c).sort().join(",") !== "agentId,companyId,issueId,responsibleUserId,revisionNumber,runId,source,wakeupRequestId" ||
    c.companyId !== input.companyId || c.issueId !== input.issueId || c.runId !== input.runId || c.agentId !== input.agentId ||
    c.responsibleUserId !== input.responsibleUserId || c.wakeupRequestId !== input.wakeupRequestId ||
    !nativePayloadSourceInputSchema.safeParse(c.source).success || c.source.kind !== "document_revision" || c.source.issueId !== input.issueId ||
    !Number.isSafeInteger(c.revisionNumber) || c.revisionNumber < 1) return false;
  return isDeepStrictEqual(input.value, { documentKey: "plan", issueId: input.issueId,
    latestRevisionId: c.source.revisionId, latestRevisionNumber: c.revisionNumber, threads: [], interaction: null,
    totals: { openThreadCount: 0, includedThreadCount: 0, omittedThreadCount: 0,
      commentCount: 0, includedCommentCount: 0, omittedCommentCount: 0 }, limits: { ...PLAN_REVIEW_CONTEXT_LIMITS }, truncated: false });
}

export function captureNativeTaskWakeSource(input: {
  companyId: string;
  runId: string;
  issueId: string;
  sourceVersion: string;
  /** Resolved by the canonical inbound-chat owner, never copied from the wake payload. */
  externalChatProvider?: import("@paperclipai/shared").ChatProvider | null;
  /** Both values come from the loaded canonical chat conversation and the exact Native input. */
  canonicalInitialGuidance?: string | null;
  nativeInitialGuidance?: string | null;
  nativeReviewWitness?: NativeReviewWakeWitness | null;
  agentId?: string; responsibleUserId?: string | null; wakeupRequestId?: string | null;
  continuationCapture?: NativeTaskContinuationCapture | null;
  ordinaryPlanRead?: NativeOrdinaryPlanReadCapture | null;
  stageTrigger?: import("../execution-continuation.js").NativeStageTaskContinuationTrigger;
  historicalPendingSources?: readonly import("./native-interaction-bridge.js").NativeGovernedPendingInteractionCapture[];
  /** Actual constructor input plus its captured metadata source. The recurring
   * reader re-parses the locked profile and checks the current metadata owner. */
  workspaceCapture?: { execution: NativeExecutionInput;
    source: Extract<NativePayloadSourceInput, { kind: "workspace_metadata" }> } | null;
  workspaceCoordinationCapture?: NativeWorkspaceCoordinationCapture | null;
  /** Independent current source-owner capture, never a wake flag. */
  blockedHumanInteraction?: NativeBlockedHumanInteraction | null;
  /** Independently read original pause/comment owners; never a wake flag. */
  treeHoldInteractionSource?: NativeTreeHoldInteractionSource | null;
  task: { id: string; identifier: string | null; title: string; description: string | null; status: string;
    priority: string; workMode: string };
  /** Read from the persisted heartbeat run, independently of the rendered
   * wake payload. */
  persistedWakeReason: string | null;
  /** Current issue checkout owner; a true harness flag must be bound to this Run. */
  checkoutRunId?: string | null;
  /** Exact server captures for comments included by the bounded wake payload. */
  commentSources?: readonly Extract<NativePayloadSourceInput, { kind: "comment" }>[];
  onDiagnostic?: (reason: "identity_invalid" | "payload_shape" | "payload_keys" | "task_projection" |
    "wake_fields_invalid" | "comment_count_invalid" | "comment_shape_invalid" | "comment_source_invalid" |
    "comment_hash_mismatch" | "comment_window_invalid" | "review_witness_invalid", fields?: readonly string[]) => void;
  payload: unknown;
}): Extract<NativePayloadSourceInput, { kind: "native_task_wake" }> | null {
  const reject = (reason: Parameters<NonNullable<typeof input.onDiagnostic>>[0], fields?: readonly string[]) => {
    input.onDiagnostic?.(reason, fields);
    return null;
  };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.runId) || !uuid.test(input.issueId) || !/^\d+(?:\.\d+)?$/.test(input.sourceVersion) ||
    input.task.id !== input.issueId) return reject("identity_invalid");
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) return reject("payload_shape");
  if (input.canonicalInitialGuidance !== input.nativeInitialGuidance ||
    Boolean(input.nativeInitialGuidance) && !input.externalChatProvider) return reject("wake_fields_invalid", ["initialGuidance"]);
  const reviewWitness = input.nativeReviewWitness ?? null;
  if (reviewWitness && (reviewWitness.version !== 1 || reviewWitness.companyId !== input.companyId ||
    reviewWitness.issueId !== input.issueId || reviewWitness.reviewerRunId !== input.runId ||
    reviewWitness.reviewerAgentId !== input.agentId || reviewWitness.responsibleUserId !== input.responsibleUserId))
    return reject("review_witness_invalid");
  const payload = input.payload as Record<string, unknown>;
  const keys = ["reason", "executionContinuation", "attachmentOmissions", "externalChatProvider", "recovery", "issue",
    "agentMessage", "childIssueSummaries", "childIssueSummaryTruncated", "dispositionRepair", "livenessContinuation",
    "interactionKind", "interactionStatus", "interactionId", "sourceRunId", "externalChatQuestionResponse",
    "externalInteractionContinuation", "checkboxSelection", "checkedOutByHarness", "externalChatExecutionBound",
    "simplifiedEnglishInteractions", "dependencyBlockedInteraction", "treeHoldInteraction", "activeTreeHold",
    "unresolvedBlockerIssueIds", "unresolvedBlockerSummaries", "executionStage", "taskWatchdog", "skillTest",
    "continuationSummary", "commentIds", "latestCommentId", "comments", "annotationDeltas", "planReviewContext",
    "documentReviewContext", "commentWindow", "truncated", "fallbackFetchNeeded"].sort();
  const actualKeys = Object.keys(payload).sort();
  const expectedKeys = [...(payload.connectorSkillInstructions === undefined ? keys : [...keys, "connectorSkillInstructions"]),
    ...(Object.hasOwn(payload, "executionWorkspace") ? ["executionWorkspace"] : [])].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) return reject("payload_keys");
  const issue = payload.issue;
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) return null;
  const wakeIssue = issue as Record<string, unknown>;
  const issueKeys = ["id", "identifier", "title", "description", "descriptionTruncated", "status", "priority", "workMode"].sort();
  if (JSON.stringify(Object.keys(wakeIssue).sort()) !== JSON.stringify(issueKeys) ||
    JSON.stringify({ id: wakeIssue.id, identifier: wakeIssue.identifier, title: wakeIssue.title,
      description: wakeIssue.description, status: wakeIssue.status, priority: wakeIssue.priority, workMode: wakeIssue.workMode }) !==
    JSON.stringify(input.task) || wakeIssue.descriptionTruncated !== false) return reject("task_projection");
  const emptyObject = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
  const closedContinuation = exactNativeTaskContinuation({ value: payload.executionContinuation, companyId: input.companyId,
    issueId: input.issueId, runId: input.runId, agentId: input.agentId, responsibleUserId: input.responsibleUserId,
    wakeupRequestId: input.wakeupRequestId, wakeReason: input.persistedWakeReason,
    taskObjective: input.task.description ?? input.task.title, capture: input.continuationCapture, stageTrigger: input.stageTrigger, historicalPendingSources: input.historicalPendingSources });
  const governedWake = closedContinuation?.governedInteractions?.length || closedContinuation?.acceptedPlanReview || closedContinuation?.answeredQuestions?.length || closedContinuation?.humanReviewWithdrawals?.length
    ? closedContinuation.wake.interaction ?? null : null;
  const blocked = input.blockedHumanInteraction;
  const blockedBinding = blocked && blocked.companyId === input.companyId && blocked.issueId === input.issueId &&
    blocked.runId === input.runId && blocked.agentId === input.agentId && blocked.wakeupRequestId === input.wakeupRequestId &&
    blocked.responsibleUserId === input.responsibleUserId && ["issue_commented", "issue_comment_mentioned"].includes(input.persistedWakeReason ?? "") &&
    closedContinuation?.wake.requestedByActorType === "user" && closedContinuation.wake.requestedByActorId === blocked.requestedByUserId &&
    isDeepStrictEqual([...closedContinuation.wake.originCommentIds].sort(),
      [...new Set(blocked.commentSources.map(source => source.commentId))].sort()) &&
    blocked.commentSources.length > 0 && blocked.blockers.length > 0 &&
    isDeepStrictEqual([...blocked.unresolvedBlockerIssueIds].sort(), blocked.blockers.map(value => value.summary.id).sort());
  const held = input.treeHoldInteractionSource;
  const heldBinding = held && held.companyId === input.companyId && held.issueId === input.issueId &&
    held.runId === input.runId && held.agentId === input.agentId && held.wakeupRequestId === input.wakeupRequestId &&
    held.responsibleUserId === input.responsibleUserId &&
    ["issue_commented", "issue_reopened_via_comment", "issue_comment_mentioned"].includes(input.persistedWakeReason ?? "") &&
    closedContinuation?.wake.requestedByActorType === "user" && closedContinuation.wake.requestedByActorId === held.requestedByUserId &&
    held.commentSources.length > 0 && isDeepStrictEqual([...closedContinuation.wake.originCommentIds].sort(),
      [...new Set(held.commentSources.map(source => source.commentId))].sort()) &&
    Object.keys(held.hold).sort().join(",") === "holdId,interaction,mode,rootIssueId" &&
    uuid.test(held.hold.holdId) && uuid.test(held.hold.rootIssueId) && held.hold.mode === "pause" && held.hold.interaction === true &&
    (held.hold.rootIssueId === input.issueId ? held.rootSource === null :
      held.rootSource?.kind === "task" && held.rootSource.issueId === held.hold.rootIssueId);
  const checks: Record<string, boolean> = {
    reason: payload.reason === input.persistedWakeReason,
    executionWorkspace: !Object.hasOwn(payload, "executionWorkspace") || exactNativeTaskWakeWorkspaceHint({
      companyId: input.companyId, issueId: input.issueId, runId: input.runId, agentId: input.agentId,
      value: payload.executionWorkspace, capture: input.workspaceCapture }),
    continuation: payload.executionContinuation === null || isClosedEmptyTaskContinuation(payload.executionContinuation, {
      companyId: input.companyId, issueId: input.issueId, wakeReason: input.persistedWakeReason, task: input.task,
    }) || exactNativeTaskContinuation({ value: payload.executionContinuation, companyId: input.companyId, issueId: input.issueId,
      runId: input.runId, agentId: input.agentId, responsibleUserId: input.responsibleUserId, wakeupRequestId: input.wakeupRequestId,
      wakeReason: input.persistedWakeReason, taskObjective: input.task.description ?? input.task.title,
      capture: input.continuationCapture,
      stageTrigger: input.stageTrigger, historicalPendingSources: input.historicalPendingSources }) !== null,
    attachmentOmissions: Array.isArray(payload.attachmentOmissions) && payload.attachmentOmissions.length === 0,
    externalChatProvider: payload.externalChatProvider === (input.externalChatProvider ?? null),
    recovery: payload.recovery === null,
    agentMessage: isDeepStrictEqual(payload.agentMessage, closedContinuation?.delivery?.projection.agentMessage ?? null),
    childIssueSummaries: Array.isArray(payload.childIssueSummaries) && payload.childIssueSummaries.length === 0,
    childIssueSummaryTruncated: payload.childIssueSummaryTruncated === false,
    dispositionRepair: payload.dispositionRepair === null, livenessContinuation: payload.livenessContinuation === null,
    interactionKind: payload.interactionKind === (governedWake?.interactionKind ?? null),
    interactionStatus: payload.interactionStatus === (governedWake?.interactionStatus ?? null),
    interactionId: payload.interactionId === (governedWake?.interactionId ?? null),
    sourceRunId: payload.sourceRunId === (governedWake?.sourceRunId ?? null),
    externalChatQuestionResponse: payload.externalChatQuestionResponse === null,
    externalInteractionContinuation: payload.externalInteractionContinuation === false, checkboxSelection: payload.checkboxSelection === null,
    checkedOutByHarness: payload.checkedOutByHarness === (input.checkoutRunId === input.runId),
    externalChatExecutionBound: payload.externalChatExecutionBound === false,
    simplifiedEnglishInteractions: payload.simplifiedEnglishInteractions === false, dependencyBlockedInteraction: payload.dependencyBlockedInteraction === false,
    treeHoldInteraction: payload.treeHoldInteraction === false, activeTreeHold: Boolean(emptyObject(payload.activeTreeHold)),
    unresolvedBlockerIssueIds: Array.isArray(payload.unresolvedBlockerIssueIds) && payload.unresolvedBlockerIssueIds.length === 0,
    unresolvedBlockerSummaries: Array.isArray(payload.unresolvedBlockerSummaries) && payload.unresolvedBlockerSummaries.length === 0,
    executionStage: payload.executionStage === null, taskWatchdog: payload.taskWatchdog === null, skillTest: payload.skillTest === null,
    continuationSummary: isDeepStrictEqual(payload.continuationSummary, closedContinuation?.summary ? {
      key: closedContinuation.summary.rendition.key, title: closedContinuation.summary.rendition.title,
      body: closedContinuation.summary.rendition.body.slice(0, 4_000), bodyTruncated: closedContinuation.summary.rendition.body.length > 4_000,
      sourceTrust: closedContinuation.summary.rendition.sourceTrust, updatedAt: closedContinuation.summary.rendition.updatedAt,
    } : null),
    connectorSkillInstructions: payload.connectorSkillInstructions === undefined || payload.connectorSkillInstructions === null || payload.connectorSkillInstructions === "",
    commentIds: Array.isArray(payload.commentIds) && payload.commentIds.every(value => typeof value === "string"),
    latestCommentId: Array.isArray(payload.commentIds) && payload.commentIds.length > 0
      ? payload.latestCommentId === payload.commentIds[payload.commentIds.length - 1]
      : payload.latestCommentId === null,
    comments: Array.isArray(payload.comments),
    annotationDeltas: Array.isArray(payload.annotationDeltas) && payload.annotationDeltas.length === 0,
    planReviewContext: closedContinuation?.acceptedPlanReview
      ? isDeepStrictEqual(payload.planReviewContext, closedContinuation.acceptedPlanReview.planReviewContext)
      : payload.planReviewContext === null || Boolean(closedContinuation && !input.stageTrigger &&
        !closedContinuation.governedInteractions && !closedContinuation.delivery &&
        exactNativeOrdinaryPlanContext({ ...input, capture: input.ordinaryPlanRead, value: payload.planReviewContext })),
    documentReviewContext: payload.documentReviewContext === null,
    truncated: payload.truncated === false, fallbackFetchNeeded: payload.fallbackFetchNeeded === false,
  };
  if (blocked) {
    checks.dependencyBlockedInteraction = Boolean(blockedBinding && payload.dependencyBlockedInteraction === true);
    checks.unresolvedBlockerIssueIds = Boolean(blockedBinding && Array.isArray(payload.unresolvedBlockerIssueIds) &&
      isDeepStrictEqual([...payload.unresolvedBlockerIssueIds].sort(), blocked.unresolvedBlockerIssueIds));
    checks.unresolvedBlockerSummaries = Boolean(blockedBinding &&
      isDeepStrictEqual(payload.unresolvedBlockerSummaries, blocked.blockers.map(value => value.summary)));
  }
  if (held) {
    checks.treeHoldInteraction = Boolean(heldBinding && payload.treeHoldInteraction === true);
    checks.activeTreeHold = Boolean(heldBinding && isDeepStrictEqual(payload.activeTreeHold, held.hold));
  }
  const failedChecks = Object.keys(checks).filter(key => !checks[key]);
  if (failedChecks.length) return reject("wake_fields_invalid", failedChecks);
  const commentIds = payload.commentIds as string[];
  const comments = payload.comments as unknown[];
  if (commentIds.length === 0) {
    if (comments.length !== 0) return reject("comment_count_invalid");
  } else {
    if (comments.length !== commentIds.length || payload.truncated !== false || payload.fallbackFetchNeeded !== false)
      return reject("comment_count_invalid");
    for (const [index, commentId] of commentIds.entries()) {
      const comment = comments[index];
      if (!comment || typeof comment !== "object" || Array.isArray(comment)) return reject("comment_shape_invalid");
      const item = comment as Record<string, unknown>;
      if (item.bodyTruncated !== false || item.deletedAt !== null || typeof item.body !== "string")
        return reject("comment_shape_invalid");
      if (item.id !== commentId || item.issueId !== input.issueId) return reject("comment_source_invalid", [
        ...(item.id !== commentId ? ["payload_comment_id"] : []),
        ...(item.issueId !== input.issueId ? ["payload_issue_binding"] : []),
      ]);
      const projectionHash = nativeCommentProjectionHash({ body: item.body,
        presentation: item.presentation ?? null, metadata: item.metadata ?? null });
      const observedSources = (input.commentSources ?? []).filter(source => source.commentId === commentId &&
        source.issueId === input.issueId && source.contentHash === projectionHash);
      const sources = observedSources.filter((source, index) => observedSources
        .slice(0, index).every(previous => !isDeepStrictEqual(previous, source)));
      if (sources.length !== 1) return reject("comment_source_invalid", [
        ...(sources.length !== 1 ? ["matching_source_cardinality"] : []),
        ...(observedSources.length > 1 && new Set(observedSources.map(source => source.sourceVersion)).size > 1
          ? ["matching_source_versions_differ"] : []),
      ]);
    }
  }
  // Attachment descriptors are rendered into the prompt, but they are not
  // comment content authority. Validate their closed display shape here and
  // omit them from the wake/comment projection below; the separately staged
  // attachment source owner binds the actual asset, bytes, comment and receipt.
  const attachmentIds = new Set<string>();
  let attachmentCount = 0;
  for (const comment of comments) {
    const item = comment as Record<string, unknown>;
    if (item.attachments === undefined) continue;
    if (!Array.isArray(item.attachments)) return reject("comment_shape_invalid");
    for (const value of item.attachments) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return reject("comment_shape_invalid");
      const attachment = value as Record<string, unknown>;
      const attachmentId = attachment.id;
      if (Object.keys(attachment).sort().join(",") !== "byteSize,contentPath,contentType,filename,id" ||
        typeof attachmentId !== "string" || !uuid.test(attachmentId) || attachmentIds.has(attachmentId) ||
        typeof attachment.filename !== "string" || !attachment.filename.trim() || attachment.filename.length > 512 ||
        typeof attachment.contentType !== "string" || !attachment.contentType.trim() || attachment.contentType.length > 256 ||
        !Number.isSafeInteger(attachment.byteSize) || (attachment.byteSize as number) < 0 ||
        attachment.contentPath !== `/api/attachments/${attachmentId}/content`) return reject("comment_shape_invalid");
      attachmentIds.add(attachmentId);
      attachmentCount += 1;
      if (attachmentCount > 20) return reject("comment_shape_invalid");
    }
  }
  const commentWindow = payload.commentWindow;
  if (!commentWindow || typeof commentWindow !== "object" || Array.isArray(commentWindow)) return reject("comment_window_invalid");
  const commentWindowRecord = commentWindow as Record<string, unknown>;
  if (commentWindowRecord.requestedCount !== commentIds.length || commentWindowRecord.includedCount !== commentIds.length ||
    commentWindowRecord.missingCount !== 0) return reject("comment_window_invalid");
  const coordination = input.workspaceCoordinationCapture
    ? exactNativeWorkspaceCoordination(input.workspaceCoordinationCapture, input) : null;
  if (input.workspaceCoordinationCapture && !coordination) return reject("wake_fields_invalid", ["workspaceCoordination"]);
  const manualQueueAdoption = input.continuationCapture?.wake.manualQueueAdoption;
  const hasAttachmentDescriptors = comments.some(value =>
    (value as Record<string, unknown>).attachments !== undefined);
  const commentSourceProjection = hasAttachmentDescriptors ? comments.map(value => {
    const comment = value as Record<string, unknown>;
    if (comment.attachments === undefined) return comment;
    const { attachments: _attachments, ...sourceComment } = comment;
    return sourceComment;
  }) : null;
  const sourcePayload = commentSourceProjection ? { ...payload, comments: commentSourceProjection } : payload;
  const content = manualQueueAdoption
    ? (coordination ? { wake: sourcePayload, manualQueueAdoption, workspaceCoordination: coordination }
      : { wake: sourcePayload, manualQueueAdoption })
    : coordination ? { wake: sourcePayload, workspaceCoordination: coordination } : sourcePayload;
  const initialGuidanceHash = input.nativeInitialGuidance ? nativeSha256(input.nativeInitialGuidance) : undefined;
  const aggregatedContent = reviewWitness ? { wake: content, nativeReview: reviewWitness } : content;
  return { kind: "native_task_wake", runId: input.runId, issueId: input.issueId, sourceVersion: input.sourceVersion,
    contentHash: nativeSha256(aggregatedContent), ...(input.externalChatProvider ? { externalChatProvider: input.externalChatProvider } : {}),
    ...(initialGuidanceHash ? { initialGuidanceHash } : {}), ...(reviewWitness ? { nativeReview: reviewWitness } : {}) };
}

export function nativeTaskWakeGuidanceSourceMatches(
  wakeInputs: readonly Extract<NativePayloadSourceInput, { kind: "native_task_wake" }>[],
  guidance: string | null | undefined,
): boolean {
  const expectedHash = typeof guidance === "string" && guidance.length > 0 ? nativeSha256(guidance) : undefined;
  return !(expectedHash && wakeInputs.length !== 1) &&
    (wakeInputs.length !== 1 || wakeInputs[0]!.initialGuidanceHash === expectedHash);
}

/** Resolve only references emitted by the real Markdown renderer. Missing,
 * ambiguous, unsupported, or source-history-unknown references stay unknown. */
function exactNativeAcceptedSummaryOwner(value: unknown, binding: { companyId: string; issueId: string; agentId: string }):
  value is import("../execution-continuation.js").NativeAcceptedFinalizedSummaryOwner {
  const owner = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!owner || Object.keys(owner).sort().join(",") !==
    "agentId,assessmentId,body,companyId,decisionDigest,decisionId,decisionSnapshotHash,finalizationVersion,issueId,parentReceipt,resultCanonicalSha256,resultCreatedAt,resultId,sourceRunId") return false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const receipt = nativeRunInputSourceReceiptSchema.safeParse(owner.parentReceipt);
  return owner.companyId === binding.companyId && owner.issueId === binding.issueId && owner.agentId === binding.agentId &&
    typeof owner.body === "string" && Buffer.byteLength(owner.body, "utf8") <= 32_000 &&
    [owner.sourceRunId, owner.resultId, owner.assessmentId, owner.decisionId].every(id => typeof id === "string" && uuid.test(id)) &&
    typeof owner.resultCanonicalSha256 === "string" && /^(?:sha256:)?[a-f0-9]{64}$/.test(owner.resultCanonicalSha256) &&
    typeof owner.decisionDigest === "string" && /^[a-f0-9]{64}$/.test(owner.decisionDigest) &&
    typeof owner.decisionSnapshotHash === "string" && /^[a-f0-9]{64}$/.test(owner.decisionSnapshotHash) &&
    typeof owner.resultCreatedAt === "string" && Number.isFinite(Date.parse(owner.resultCreatedAt)) &&
    typeof owner.finalizationVersion === "string" && Number.isFinite(Date.parse(owner.finalizationVersion)) && receipt.success &&
    receipt.data.binding.companyId === binding.companyId && receipt.data.binding.issueId === binding.issueId &&
    receipt.data.binding.agentId === binding.agentId && receipt.data.binding.runId === owner.sourceRunId &&
    typeof receipt.data.binding.responsibleUserId === "string" && receipt.data.binding.responsibleUserId.length > 0;
}

function exactNativeAcceptedPresentationCommentOwner(value: unknown, input: {
  binding: { companyId: string; issueId: string; agentId: string };
  commentSource: Extract<NativePayloadSourceInput, { kind: "comment" }>;
}): value is import("../execution-continuation.js").NativeAcceptedFinalizedPresentationCommentOwner {
  const owner = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!owner || Object.keys(owner).sort().join(",") !== "acceptedSummaryOwner,commentSourceIdentity") return false;
  const commentSource = nativePayloadSourceInputSchema.safeParse(owner.commentSourceIdentity);
  if (!commentSource.success || commentSource.data.kind !== "comment" ||
      !isDeepStrictEqual(commentSource.data, input.commentSource)) return false;
  return exactNativeAcceptedSummaryOwner(owner.acceptedSummaryOwner, input.binding);
}

export function buildNativeBootstrapSourceSet(input: {
  companyId: string;
  runId: string;
  agentId: string;
  issueId: string;
  renderedMarkdown: string;
  renderedMarkdownDigest: string | null;
  references: readonly NativeRenderedSourceReference[] | null;
  candidates: readonly NativePreparedSourceCandidate[];
  runtimeInputs: readonly NativePayloadSourceInput[] | null;
  additionalInputs?: readonly NativePayloadSourceInput[] | null;
  taskWakeCommentCandidates?: readonly NativePreparedSourceCandidate[];
  taskWakeDependencyCandidates?: readonly NativePreparedSourceCandidate[];
  taskWakeInteractionSources?: readonly Extract<NativePayloadSourceInput, { kind: "interaction" }>[];
  taskWakeInteractionStateOwner?: NativeTaskWakeInteractionStateOwner | null;
  taskWakeDocumentCandidates?: readonly NativePreparedSourceCandidate[];
  additionalPolicy?: NativePayloadSourcePolicy | null;
  interactionResponses?: readonly NativeInteractionResponseEnvelope[] | null;
  interactionSources?: readonly Extract<NativePayloadSourceInput, { kind: "interaction" }>[] | null;
  contextManifestIds: readonly { companyId: string; contextManifestId: string }[] | null;
  governedContextMarkdown?: string | null;
  contextWitnessMarkdown?: string | null;
  contextWitness?: NativeBootstrapContextWitness | null;
  rolePackInputs: readonly NativePayloadSourceInput[] | null;
  unsupportedInputPresent: boolean;
  onDiagnostic?: (reason: "interaction_sources" | "unsupported_or_missing_witness" | "rendered_source_missing" |
    "rendered_digest_mismatch" | "runtime_sources_missing" | "context_witness_missing" |
    "role_pack_sources_invalid" | "unknown_rendered_source" | "ambiguous_reference" |
    "reference_source_mismatch" | "source_snapshot_invalid" | "additional_inputs_unknown" | "source_budget_exceeded") => void;
}): NativePayloadSourceSet | null {
  const reject = (reason: Parameters<NonNullable<typeof input.onDiagnostic>>[0]) => {
    input.onDiagnostic?.(reason);
    return null;
  };
  const interactionSources = exactNativeInteractionSourceInputs({ issueId: input.issueId,
    responses: input.interactionResponses, sources: input.interactionSources });
  if (!interactionSources) return reject("interaction_sources");
  const contextMarkdown = input.contextWitnessMarkdown ?? input.governedContextMarkdown;
  const context = input.contextWitness && contextMarkdown
    ? readNativeBootstrapContextWitness(input.contextWitness, { companyId: input.companyId, runId: input.runId,
      agentId: input.agentId, issueId: input.issueId, renderedMarkdown: contextMarkdown,
      manifestIds: input.contextManifestIds ?? [] }) : null;
  if (input.unsupportedInputPresent) return reject("unsupported_or_missing_witness");
  if (!input.references || input.references.length === 0 ||
    !input.references.some(reference => reference.kind === "task")) return reject("rendered_source_missing");
  if (!input.renderedMarkdownDigest ||
    createHash("sha256").update(input.renderedMarkdown, "utf8").digest("hex") !== input.renderedMarkdownDigest)
    return reject("rendered_digest_mismatch");
  if (!input.runtimeInputs) return reject("runtime_sources_missing");
  if (!input.contextManifestIds || (input.contextManifestIds.length > 0 || input.governedContextMarkdown?.trim()) && !context)
    return reject("context_witness_missing");
  if (!input.rolePackInputs || input.rolePackInputs.some(source => {
    const parsed = nativePayloadSourceInputSchema.safeParse(source);
    return !parsed.success || parsed.data.kind !== "role_pack_version";
  })) return reject("role_pack_sources_invalid");
  if (input.references.some(reference => reference.kind === "unknown")) return reject("unknown_rendered_source");
  const policy: NativePayloadSourcePolicy = { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };
  const inputs: NativePayloadSourceInput[] = [];
  const append = (source: NativePayloadSourceInput) => {
    const parsed = nativePayloadSourceInputSchema.parse(source);
    if (!inputs.some(existing => JSON.stringify(existing) === JSON.stringify(parsed))) inputs.push(parsed);
  };
  const addSnapshotPolicy = (raw: unknown, expected: { kind: string; id: string }) => {
    if (raw === null || raw === undefined) return false;
    const parsed = nativePayloadSourceSnapshotSchema.safeParse(raw);
    if (!parsed.success || parsed.data.owner.kind !== expected.kind || parsed.data.owner.id !== expected.id ||
      parsed.data.owner.companyId !== input.companyId) return false;
    for (const key of Object.keys(policy) as Array<keyof NativePayloadSourcePolicy>) {
      policy[key].push(...parsed.data.policy[key]);
      policy[key] = [...new Set(policy[key])].sort();
    }
    for (const source of parsed.data.inputs) append(source);
    return true;
  };
  const mergePolicy = (incoming: NativePayloadSourcePolicy) => {
    for (const key of Object.keys(policy) as Array<keyof NativePayloadSourcePolicy>)
      policy[key] = [...new Set([...policy[key], ...incoming[key]])].sort();
  };
  for (const reference of input.references) {
    if (reference.kind === "native_review_request_context") {
      const wakeSources = (input.additionalInputs ?? []).filter(source => source.kind === "native_task_wake" &&
        source.runId === input.runId && source.issueId === input.issueId);
      const parsed = wakeSources.length === 1 ? nativePayloadSourceInputSchema.safeParse(wakeSources[0]) : null;
      if (!parsed?.success || parsed.data.kind !== "native_task_wake" || !parsed.data.nativeReview ||
        parsed.data.nativeReview.interactionId !== reference.id || parsed.data.nativeReview.reviewerRunId !== input.runId ||
        parsed.data.nativeReview.reviewerAgentId !== input.agentId || parsed.data.nativeReview.issueId !== input.issueId)
        return reject("reference_source_mismatch");
      append(parsed.data);
      policy.runIds = [...new Set([...policy.runIds, parsed.data.nativeReview.sourceRunId])].sort();
      continue;
    }
    if (reference.kind === "external_chat_context") {
      const wakeSources = (input.additionalInputs ?? []).filter(source => source.kind === "native_task_wake" &&
        source.runId === input.runId && source.issueId === input.issueId);
      const parsed = wakeSources.length === 1 ? nativePayloadSourceInputSchema.safeParse(wakeSources[0]) : null;
      if (reference.id !== input.issueId || !parsed?.success || parsed.data.kind !== "native_task_wake" ||
        parsed.data.externalChatProvider !== reference.provider) return reject("reference_source_mismatch");
      append(parsed.data);
      continue;
    }
    if (reference.kind === "task_wake_interaction_state") {
      const owner = input.taskWakeInteractionStateOwner;
      const ownerCapture = owner?.capture;
      const wakeSources = (input.additionalInputs ?? []).filter(source => source.kind === "native_task_wake" &&
        source.runId === input.runId && source.issueId === input.issueId);
      const exactWakeSource = Boolean(owner?.source && nativePayloadSourceInputSchema.safeParse(owner.source).success &&
        owner.source.runId === input.runId && owner.source.issueId === input.issueId && wakeSources.length === 1 &&
        isDeepStrictEqual(wakeSources[0], owner.source));
      const exactContinuation = owner && ownerCapture && exactWakeSource
        ? exactNativeTaskContinuation({ value: ownerCapture.envelope, companyId: input.companyId, issueId: input.issueId,
            runId: input.runId, agentId: input.agentId, responsibleUserId: owner.responsibleUserId,
            wakeupRequestId: owner.wakeupRequestId, wakeReason: owner.wakeReason, taskObjective: owner.taskObjective,
            capture: ownerCapture }) : null;
      const wakeInteraction = exactContinuation?.wake.interaction;
      const withdrawalMatches = exactContinuation?.humanReviewWithdrawals?.filter(value =>
        value.projection.interactionId === reference.id && value.projection.kind === reference.interactionKind &&
        value.projection.status === reference.interactionStatus && value.projection.interactionSourceRunId === wakeInteraction?.sourceRunId &&
        value.projection.owner.sourceRunId === wakeInteraction?.sourceRunId) ?? [];
      const withdrawal = withdrawalMatches.length === 1 ? withdrawalMatches[0] : null;
      const ownerSources = input.taskWakeInteractionSources ?? [];
      const ownerRenditionsPresent = Boolean(withdrawal && [withdrawal.nativeSource, withdrawal.continuationSource].every(source =>
        ownerSources.filter(candidate => isDeepStrictEqual(candidate, source)).length === 1));
      if (!withdrawal || !wakeInteraction || wakeInteraction.interactionId !== reference.id ||
        wakeInteraction.interactionKind !== reference.interactionKind || wakeInteraction.interactionStatus !== reference.interactionStatus ||
        !ownerRenditionsPresent) return reject("reference_source_mismatch");
      append(withdrawal.nativeSource);
      append(withdrawal.continuationSource);
      policy.runIds = [...new Set([...policy.runIds, withdrawal.projection.owner.sourceRunId])].sort();
      continue;
    }
    const matches = input.candidates.filter(candidate => candidate.kind === reference.kind && candidate.id === reference.id);
    const uniqueMatches = [...new Map(matches.map(candidate => [JSON.stringify(candidate), candidate])).values()];
    if (uniqueMatches.length !== 1) return reject("ambiguous_reference");
    const candidate = uniqueMatches[0]!;
    const expectedOwner = reference.kind === "task" ? "issue" : reference.kind;
    const sourceMatchesReference = reference.kind === "task"
      ? candidate.input.kind === "task" && candidate.input.issueId === reference.id
      : reference.kind === "project"
        ? candidate.input.kind === "project" && candidate.input.projectId === reference.id
      : reference.kind === "document_revision"
        ? candidate.input.kind === "document_revision" && candidate.input.revisionId === reference.id
        : reference.kind === "comment"
          ? candidate.input.kind === "comment" && candidate.input.commentId === reference.id
          : reference.kind === "attachment"
            ? candidate.input.kind === "attachment" && candidate.input.attachmentId === reference.id &&
              typeof reference.commentId === "string" && typeof reference.filename === "string" &&
              typeof reference.contentType === "string" && Number.isSafeInteger(reference.byteSize) &&
              candidate.input.commentId === reference.commentId && candidate.input.byteSize === reference.byteSize &&
              candidate.input.disposition === "delivered" && candidate.input.assetId !== null && candidate.input.sha256 !== null
            : false;
    if (!sourceMatchesReference) return reject("reference_source_mismatch");
    if (!addSnapshotPolicy(candidate.payloadSourceSnapshot, { kind: expectedOwner, id: reference.id }))
      return reject("source_snapshot_invalid");
    append(candidate.input);
  }
  if ((input.taskWakeCommentCandidates?.length ?? 0) > 0 &&
    input.additionalInputs?.filter(source => source.kind === "native_task_wake" &&
      source.runId === input.runId && source.issueId === input.issueId).length !== 1) return reject("source_snapshot_invalid");
  for (const candidate of input.taskWakeCommentCandidates ?? []) {
    if (candidate.kind !== "comment" || candidate.input.kind !== "comment" ||
      candidate.input.commentId !== candidate.id || candidate.input.issueId !== input.issueId) return reject("source_snapshot_invalid");
    if (candidate.payloadSourceSnapshot) {
      if (candidate.acceptedPresentationOwner || !addSnapshotPolicy(candidate.payloadSourceSnapshot, { kind: "comment", id: candidate.id }))
        return reject("source_snapshot_invalid");
    } else if (!candidate.acceptedPresentationOwner || !exactNativeAcceptedPresentationCommentOwner(candidate.acceptedPresentationOwner, {
      binding: { companyId: input.companyId, issueId: input.issueId, agentId: input.agentId }, commentSource: candidate.input,
    }) || !input.additionalPolicy?.runIds.includes(candidate.acceptedPresentationOwner.acceptedSummaryOwner.sourceRunId)) {
      return reject("source_snapshot_invalid");
    }
    append(candidate.input);
  }
  for (const candidate of input.taskWakeDependencyCandidates ?? []) {
    if (candidate.kind !== "task" || candidate.input.kind !== "task" || candidate.input.issueId !== candidate.id ||
      candidate.id === input.issueId || input.additionalInputs?.filter(source => source.kind === "native_task_wake" &&
        source.runId === input.runId && source.issueId === input.issueId).length !== 1 ||
      !addSnapshotPolicy(candidate.payloadSourceSnapshot, { kind: "issue", id: candidate.id })) return reject("source_snapshot_invalid");
    append(candidate.input);
  }
  if ((input.taskWakeInteractionSources?.length ?? 0) > 0 &&
    input.additionalInputs?.filter(source => source.kind === "native_task_wake" &&
      source.runId === input.runId && source.issueId === input.issueId).length !== 1) return reject("interaction_sources");
  for (const candidate of input.taskWakeDocumentCandidates ?? []) {
    if (candidate.kind !== "document_revision" || candidate.input.kind !== "document_revision" ||
      candidate.input.revisionId !== candidate.id || candidate.input.issueId !== input.issueId ||
      input.additionalInputs?.filter(source => source.kind === "native_task_wake" && source.runId === input.runId && source.issueId === input.issueId).length !== 1 ||
      !addSnapshotPolicy(candidate.payloadSourceSnapshot, { kind: "document_revision", id: candidate.id })) return reject("source_snapshot_invalid");
    append(candidate.input);
  }
  for (const source of input.taskWakeInteractionSources ?? []) {
    if (source.kind !== "interaction" || source.issueId !== input.issueId) return reject("interaction_sources");
    append(source);
  }
  for (const source of input.runtimeInputs) append(source);
  if (input.additionalInputs === null) return reject("additional_inputs_unknown");
  for (const source of input.additionalInputs ?? []) append(source);
  if (input.additionalPolicy) mergePolicy(input.additionalPolicy);
  for (const source of interactionSources) append(source);
  if (context) {
    mergePolicy(context.policy);
    append(context.contextInput);
    for (const source of context.inputs) append(source);
  }
  for (const source of input.rolePackInputs) append(source);
  const references = inputs.length + Object.values(policy).reduce((sum, values) => sum + values.length, 0);
  if (references > 256) return reject("source_budget_exceeded");
  return { policy, inputs };
}

/** Attach one real, freshly assembled Context render to the exact next Native
 * user frame and carry its witness-derived owners into that dispatch closure.
 * This is a server-only preparation helper; caller prose cannot mint the
 * witness or source references. */
export function prepareNativeTurnWithContext<T extends { message: { role: string; text: string } }>(input: {
  turnInput: T;
  baseClosure: NativeBootstrapSourceClosure;
  companyId: string;
  runId: string;
  agentId: string;
  issueId: string;
  contextMarkdown: string;
  contextWitness: NativeBootstrapContextWitness | null;
  manifestIds: readonly { companyId: string; contextManifestId: string }[];
}): { turnInput: T; sourceClosure: NativeBootstrapSourceClosure } | null {
  if (input.turnInput.message.role !== "user" || input.turnInput.message.text.length > 2_000_000) return null;
  const context = input.contextWitness && readNativeBootstrapContextWitness(input.contextWitness, {
    companyId: input.companyId, runId: input.runId, agentId: input.agentId, issueId: input.issueId,
    renderedMarkdown: input.contextMarkdown, manifestIds: input.manifestIds,
  });
  if (!context || input.manifestIds.length !== 1) return null;
  let frame: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input.turnInput.message.text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    frame = parsed as Record<string, unknown>;
  } catch { return null; }
  if (frame.schema !== "paperclip.native-model-envelope.v2" || Object.hasOwn(frame, "turnContext")) return null;
  const markdownDigest = createHash("sha256").update(input.contextMarkdown, "utf8").digest("hex");
  const manifestIds = [...new Set([context.contextInput.manifestId])].sort();
  frame.turnContext = { schema: "paperclip.native-turn-context.v1", markdown: input.contextMarkdown,
    digest: markdownDigest, manifestIds };
  const policy: NativePayloadSourcePolicy = { ...input.baseClosure.sourceSet.policy };
  for (const key of Object.keys(policy) as Array<keyof NativePayloadSourcePolicy>)
    policy[key] = [...new Set([...policy[key], ...context.policy[key]])].sort();
  const inputs = [...input.baseClosure.sourceSet.inputs];
  for (const source of [context.contextInput, ...context.inputs]) {
    const encoded = JSON.stringify(source);
    if (!inputs.some(existing => JSON.stringify(existing) === encoded)) inputs.push(source);
  }
  if (inputs.length + Object.values(policy).reduce((sum, values) => sum + values.length, 0) > 256) return null;
  return { turnInput: { ...input.turnInput,
    message: { ...input.turnInput.message, text: JSON.stringify(frame) } },
    sourceClosure: { sourceSet: { policy, inputs }, taskEnvelopeDigest: input.baseClosure.taskEnvelopeDigest,
      turnContext: { markdownDigest, manifestIds } } };
}

/** Closed constructor: callers cannot spread legacy context or environment data. */
/** Canonical structured fields; external messages retain their raw Task source
 * in the prompt and closed wake rather than repeating it as a turn instruction. */
export function nativeTaskFields(issue: {
  id: string; identifier: string | null; title: string; description: string | null;
  workMode: string;
}, wakePayload: unknown, nativeReview?: NativeReviewAssignment | null) {
  if (nativeReview) return { identifier: issue.identifier ?? issue.id, title: `Review: ${issue.title}`,
    description: buildNativeReviewRequest({ title: nativeReview.interaction.title, summary: nativeReview.interaction.summary,
      payload: nativeReview.interaction.payload }), workMode: issue.workMode };
  const externalChatTurn = isPaperclipExternalChatContractTurn(wakePayload) ||
    isPaperclipExternalChatQuestionResponseTurn(wakePayload);
  return { identifier: issue.identifier ?? issue.id,
    title: externalChatTurn ? "External chat follow-up" : issue.title,
    description: externalChatTurn ? null : issue.description, workMode: issue.workMode };
}

export function buildNativeExecutionInput(input: {
  companyId: string;
  runId: string;
  issue: {
    id: string;
    identifier: string | null;
    title: string;
    description: string | null;
    workMode: string;
  };
  taskPrompt: string;
  /**
   * Server-assembled, authorized and budgeted August Works context. This is
   * injected only after Context Engine policy resolution; it must never carry
   * credentials or grant authority by itself.
   */
  governedContextMarkdown?: string | null;
  initialCommunicationGuidance?: string | null;
  /**
   * The already-sanitized Paperclip wake envelope for this run. Native drivers
   * receive a closed execution input rather than the legacy adapter context,
   * so the constructor must deliberately project the same bounded wake delta
   * that legacy adapters place in their provider prompt.
   */
  wakePayload?: unknown;
  nativeReviewAssignment?: NativeReviewAssignment | null;
  resumedSession?: boolean;
  previousTurn?: { runId: string; task: { title: string; description: string | null } } | null;
  conversationMode?: boolean;
  agentId: string;
  workspace: {
    id: string;
    cwd: string;
    repoUrl: string | null;
    repoRef: string | null;
    branchName: string | null;
  };
  normalizedSessionId: string | null;
  provider?: "codex" | "opencode" | "claude_managed" | "aws_agentcore" | "acpx" | "aw_text_only";
  workerModelProfileId?: string;
  maxOutputTokens?: number;
  acpxAgent?: NativeAcpxAgent;
  codexApprovalPolicy?: NativeCodexApprovalPolicy;
  opencodePermissionMode?: NativeOpenCodePermissionMode;
  acpxPermissionMode?: NativeAcpxPermissionMode;
  model?: string | null;
  managedProfile?: Extract<
    NativeExecutionInputV4["provider"],
    { kind: "claude_managed" }
  >["managedProfile"];
  maxSessionListCostUsd?: number;
  agentCoreProfile?: Extract<
    NativeExecutionInputV4["provider"],
    { kind: "aws_agentcore" }
  >["agentCoreProfile"];
  maxEstimatedSessionCostUsd?: number;
  invocationLimits?: Extract<
    NativeExecutionInputV4["provider"],
    { kind: "aws_agentcore" }
  >["invocationLimits"];
  lifecyclePolicy?: NativeExecutionInputV4["session"]["lifecyclePolicy"];
  executionMode?: "default" | "plan";
  planningContext?: NativePlanningContext | null;
  interactionResponses?: NativeInteractionResponseEnvelope[];
  completionContract: {
    id: string;
    sha256: string;
    schemaVersion: string;
    contract: StrictCompletionContractInput;
  };
  runtimeContext: NativeRuntimeContextSnapshot;
}): NativeExecutionInputV4 {
  if (input.issue.workMode !== "standard" && input.issue.workMode !== "planning" && input.issue.workMode !== "ask") {
    throw new Error("native_execution_input_invalid: issue work mode must be standard, planning, or ask");
  }
  const executionMode = input.executionMode
    ?? (input.issue.workMode === "planning" ? "plan" : "default");
  const acpxProfile = input.provider === "acpx"
    ? resolveQualifiedAcpxProfile(
        input.acpxAgent ?? "codex",
        input.model ?? "",
      )
    : null;
  // Answers are materialized from the authoritative interaction only for this
  // invocation; do not persist a duplicate answer in the durable wake snapshot.
  const wake =
    input.wakePayload &&
    typeof input.wakePayload === "object" &&
    !Array.isArray(input.wakePayload)
      ? (input.wakePayload as Record<string, unknown>)
      : null;
  const question = wake?.externalChatQuestionResponse
    ? input.interactionResponses?.find(
        (response) =>
          response.interactionId === wake.interactionId &&
          response.kind === "ask_user_questions" &&
          response.response.status === "answered",
      )
    : null;
  const answerResult = question?.response.result as
    Record<string, unknown> | undefined;
  // The server supplies only the revalidated answer chain, in source order.
  // Keep prior choices available even when this continuation starts a fresh
  // provider session; never recover them from model prose or a transcript.
  const answerChain = question
    ? input.interactionResponses?.filter((response) =>
        response.kind === "ask_user_questions" &&
        response.response.status === "answered" &&
        typeof (response.response.result as Record<string, unknown> | undefined)
          ?.summaryMarkdown === "string")
    : null;
  const answerSummary =
    answerChain && answerChain.length > 1 &&
    answerChain.at(-1)?.interactionId === question?.interactionId
      ? answerChain.map((response, index) => {
          const label = index === answerChain.length - 1
            ? "Latest answered question" : `Earlier answer ${index + 1}`;
          return `${label}:\n${(response.response.result as Record<string, unknown>).summaryMarkdown}`;
        }).join("\n\n")
      : answerResult?.summaryMarkdown;
  const wakePayload =
    question && typeof answerSummary === "string"
      ? {
          ...wake,
          questionResponse: {
            interactionId: question.interactionId,
            summaryMarkdown: answerSummary,
          },
        }
      : input.wakePayload;
  const wakePrompt = renderPaperclipWakePrompt(wakePayload, {
    resumedSession: false,
    conversationMode: input.conversationMode === true,
    suppressIssueDescription: input.taskPrompt.trim().length > 0,
    nativeWakeReaderAvailable: true,
  });
  const externalChatTurn =
    isPaperclipExternalChatContractTurn(wakePayload) ||
    isPaperclipExternalChatQuestionResponseTurn(wakePayload);
  const taskPrompt = [
    wakePrompt,
    // Durable task questions must survive the current provider turn.
    // Keep routing visible before deferred tool discovery; usage belongs in the tool schema.
    "Use Paperclip's request_human_input for durable task questions.",
    externalChatTurn && wake?.externalChatProvider === "github"
      ? NATIVE_GITHUB_ATTACHMENT_RECOVERY_GUIDANCE
      : "",
    input.governedContextMarkdown?.trim() ?? "",
    input.taskPrompt.trim(),
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
  return parseNativeExecutionInput({
    schema: "paperclip.native-execution-input.v4",
    ...(input.initialCommunicationGuidance ? { initialCommunicationGuidance: input.initialCommunicationGuidance } : {}),
    ...(input.resumedSession && input.previousTurn && !input.conversationMode ? {
      continuationPrompt: buildNativeContinuationPrompt({
        wakePayload: input.wakePayload,
        previousRunId: input.previousTurn.runId,
        previousIssue: input.previousTurn.task,
        allowExternalChat: true,
        issue: input.issue,
      }),
    } : {}),
    executionMode,
    planningContext: input.planningContext ?? null,
    binding: {
      companyId: input.companyId,
      runId: input.runId,
      issueId: input.issue.id,
      agentId: input.agentId,
      executionWorkspaceId: input.workspace.id,
    },
    task: { ...nativeTaskFields(input.issue, wakePayload, input.nativeReviewAssignment), prompt: taskPrompt },
    workspace: {
      cwd: input.workspace.cwd,
      repoUrl: input.workspace.repoUrl,
      repoRef: input.workspace.repoRef,
      branchName: input.workspace.branchName,
    },
    session: {
      normalizedSessionId: input.normalizedSessionId,
      driverKind: input.provider === "aw_text_only" ? "aw_text_messages" : input.provider === "opencode"
        ? "opencode_server"
        : input.provider === "claude_managed"
          ? "claude_managed_agents_api"
          : input.provider === "aws_agentcore"
            ? "aws_agentcore_harness_api"
        : input.provider === "acpx"
            ? "acpx_runtime"
            : "codex_app_server",
      protocolVersion: 1,
      lifecyclePolicy: input.lifecyclePolicy ?? { mode: "per_turn", idleTimeoutMs: null },
    },
    provider: input.provider === "aw_text_only"
      ? { kind: "aw_text_only", model: input.model, profileId: input.workerModelProfileId, maxOutputTokens: input.maxOutputTokens }
      : input.provider === "claude_managed"
      ? {
          kind: "claude_managed",
          model: input.model,
          managedProfile: input.managedProfile,
          maxSessionListCostUsd: input.maxSessionListCostUsd,
        }
      : input.provider === "aws_agentcore"
        ? {
            kind: "aws_agentcore",
            model: input.model,
            agentCoreProfile: input.agentCoreProfile,
            maxEstimatedSessionCostUsd: input.maxEstimatedSessionCostUsd,
            invocationLimits: input.invocationLimits,
          }
      : input.provider === "acpx"
      ? {
          kind: "acpx",
          agent: acpxProfile!.agent,
          model: input.model,
          permissionMode: input.acpxPermissionMode ?? "approve-all",
          profile: {
            driverKind: acpxProfile!.driverKind,
            protocolVersion: acpxProfile!.protocolVersion,
            acpxVersion: acpxProfile!.acpxVersion,
            agent: acpxProfile!.agent,
            agentProfileVersion: acpxProfile!.agentProfileVersion,
            agentServerPackage: acpxProfile!.agentServerPackage,
            agentServerVersion: acpxProfile!.agentServerVersion,
            agentRuntimePackage: acpxProfile!.agentRuntimePackage,
            agentRuntimeVersion: acpxProfile!.agentRuntimeVersion,
            commandDigest: acpxProfile!.commandDigest,
          },
        }
      : input.provider === "opencode"
        ? {
            kind: "opencode",
            model: input.model,
            permissionMode: input.opencodePermissionMode ?? "allow",
          }
        : {
            kind: "codex",
            model: input.model ?? null,
            approvalPolicy: input.codexApprovalPolicy ?? "never",
          },
    completionContract: input.completionContract,
    interactionResponses: input.interactionResponses ?? [],
    credentialBindings: [],
    runtimeContext: input.runtimeContext,
  }) as NativeExecutionInputV4;
}
