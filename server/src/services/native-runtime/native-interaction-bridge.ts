import { nativeRunInputSourceReceiptSchema } from "@paperclipai/shared";
import { isDeepStrictEqual } from "node:util";
import type { Db } from "@paperclipai/db";
import type { NativeInteractionResponseEnvelope } from "../../vendor/paperclip-runner/index.js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  agents,
  toolActionRequests,
  toolInvocations,
  heartbeatRuns,
  issues,
  issueThreadInteractions,
  nativeRunFinalizations,
  nativeRunResults,
  statusDecisions,
  workAssessments,
  activityLog,
} from "@paperclipai/db";
import { getAgentWorkEligibility, askUserQuestionsPayloadSchema, askUserQuestionsResultSchema, requestConfirmationResultSchema, type ExecutionContinuationEnvelope, type NativePayloadSourceInput } from "@paperclipai/shared";
import { issueThreadInteractionService } from "../issue-thread-interactions.js";
import { commitNativeStatusDecision } from "./status-decision-committer.js";
import { nativeSha256 } from "./canonical.js";
import { nativeAnsweredQuestionContinuationSource } from "./native-execution-input.js";
import { recordNativeAttentionAssessment } from "./work-assessments.js";
import { formatDurableQuestionResponseSummary } from "../question-response-delivery.js";
import { createRunSecretRedactionRegistry } from "../run-secret-redaction.js";
import {
  NATIVE_STATUS_ARBITER_POLICY_VERSION,
  type NativeAuthoritativeIssueStatus,
  type NativeGovernanceGate,
  type NativeStatusDecision,
  type NativeStatusEffect,
} from "./status-arbiter.js";

/** Distinct final-redacted renditions selected by the existing governed owner.
 * A source consumer must reconstruct this owner; this descriptor grants nothing. */
export type NativeGovernedInteractionContinuationCapture = {
  companyId: string; issueId: string; runId: string; agentId: string;
  nativeSource: Extract<NativePayloadSourceInput, { kind: "interaction" }>;
  continuationSource: Extract<NativePayloadSourceInput, { kind: "interaction" }>;
  nativeResponse: NativeInteractionResponseEnvelope;
  projection: {
    version: 1; companyId: string; issueId: string; interactionId: string; sourceVersion: string;
    nativeResponseDigest: string;
    owner: { sourceRunId: string | null; sourceCommentId: string | null; originCommentIds: string[];
      continuationPolicy: string; resolvedByUserId: string; resolvedAt: string;
      actionRequestId: string; invocationId: string; argumentsHash: string; requestStatus: string; invocationStatus: string };
    humanResponse: NonNullable<ExecutionContinuationEnvelope["humanResponses"]>[number];
    interactionOutcome: ExecutionContinuationEnvelope["interactionOutcomes"][number];
  };
};

/** Ordinary Human answers are read context, never a governed action owner. */
export type NativeAnsweredQuestionContinuationCapture = {
  companyId: string; issueId: string; runId: string; agentId: string;
  nativeSource: Extract<NativePayloadSourceInput, { kind: "interaction" }>;
  continuationSource: Extract<NativePayloadSourceInput, { kind: "interaction" }>;
  nativeResponse: NativeInteractionResponseEnvelope;
  owner: { sourceRunId: string | null; sourceCommentId: string | null; originCommentIds: string[];
    continuationPolicy: string; resolvedByUserId: string; resolvedAt: string };
  humanResponse: NonNullable<ExecutionContinuationEnvelope["humanResponses"]>[number];
  interactionOutcome: ExecutionContinuationEnvelope["interactionOutcomes"][number];
};

/** An administrative issue-close outcome is historical context, not a Human
 * answer. Its Activity row owns why the interaction was expired; the exact
 * result remains low-trust data and never becomes a Native response. */
export type NativeAdministrativeInteractionExpiryCapture = {
  companyId: string; issueId: string; runId: string; agentId: string;
  source: Extract<NativePayloadSourceInput, { kind: "interaction" }>;
  projection: {
    version: 1; companyId: string; issueId: string; interactionId: string; sourceVersion: string;
    kind: "request_confirmation"; status: "expired"; result: Record<string, unknown>;
    sourceRunId: string | null; createdByAgentId: string | null; resolvedByUserId: string | null;
    resolvedByAgentId: string | null; resolvedByRunId: string | null; resolvedAt: string;
    activityId: string; activityCreatedAt: string; activityActorType: string; activityActorId: string;
    activityAgentId: string | null; activityRunId: string | null;
  };
  interactionOutcome: ExecutionContinuationEnvelope["interactionOutcomes"][number];
};

export type NativeGovernedPendingInteractionCapture = {
  companyId: string; issueId: string; runId: string; agentId: string;
  source: Extract<NativePayloadSourceInput, { kind: "interaction" }>;
  projection: { version: 1; companyId: string; issueId: string; interactionId: string; sourceVersion: string;
    kind: "request_confirmation"; status: "pending"; sourceRunId: string; sourceCommentId: string | null;
    originCommentIds: string[]; actionRequestId: string; invocationId: string; argumentsHash: string;
    requestStatus: "pending"; invocationStatus: "awaiting_approval"; expiresAt: string | null };
};

function nativeGovernedPendingProjection(input: { companyId: string; issueId: string; sourceVersion: string;
  sourceRunId: string; interaction: { id: string; sourceCommentId?: string | null; originCommentIds?: string[] };
  request: typeof toolActionRequests.$inferSelect; invocation: typeof toolInvocations.$inferSelect;
}): NativeGovernedPendingInteractionCapture["projection"] {
  return { version: 1, companyId: input.companyId, issueId: input.issueId, interactionId: input.interaction.id,
    sourceVersion: input.sourceVersion, kind: "request_confirmation", status: "pending", sourceRunId: input.sourceRunId,
    sourceCommentId: input.interaction.sourceCommentId ?? null, originCommentIds: [...(input.interaction.originCommentIds ?? [])],
    actionRequestId: input.request.id, invocationId: input.invocation.id, argumentsHash: input.request.canonicalArgumentsHash,
    requestStatus: "pending", invocationStatus: "awaiting_approval", expiresAt: input.request.expiresAt?.toISOString() ?? null };
}

/** Reconstructs only a canonical Task-close expiration. This never projects
 * the row into an interaction response or Human response. */
export async function captureNativeAdministrativeInteractionExpiries(input: {
  db: Db; companyId: string; issueId: string; runId: string; agentId: string;
  interactionIds: string[]; reader?: import("../authorization.js").AuthorizationActor;
}): Promise<NativeAdministrativeInteractionExpiryCapture[]> {
  if (input.interactionIds.length === 0) return [];
  if (input.interactionIds.length > 64 || new Set(input.interactionIds).size !== input.interactionIds.length ||
    input.interactionIds.some(id => typeof id !== "string" || !id))
    throw new NativeInteractionBridgeError("native_interaction_binding_mismatch", "Administrative interaction selection is invalid");
  const [run] = await input.db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, input.runId),
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId))).limit(1);
  const [task] = await input.db.select().from(issues).where(and(eq(issues.id, input.issueId),
    eq(issues.companyId, input.companyId))).limit(1);
  const reader = input.reader ?? { type: "agent" as const, source: "agent_jwt" as const, companyId: input.companyId,
    agentId: input.agentId, runId: input.runId, onBehalfOfUserId: run?.responsibleUserId ?? null };
  const { canActorReadHeartbeatRunPrivacy, canActorReadIssuePrivacy, isCurrentTaskPrivacyPrincipal } =
    await import("../authorization.js");
  if (!run || !task || !run.responsibleUserId || ![run.issueId, run.nativeIssueId, record(run.contextSnapshot).issueId].includes(input.issueId) ||
    !await isCurrentTaskPrivacyPrincipal(input.db, reader, input.companyId) ||
    !await canActorReadHeartbeatRunPrivacy(input.db, reader, run) || !await canActorReadIssuePrivacy(input.db, reader, task))
    throw new NativeInteractionBridgeError("native_interaction_binding_mismatch", "Administrative interaction reader is unavailable");
  const versions = new Map<string, string>();
  const rows = await issueThreadInteractionService(input.db).listForIssue(input.issueId,
    { onSourceVersionSelected: (id, version) => { versions.set(id, version); } });
  const captures: NativeAdministrativeInteractionExpiryCapture[] = [];
  for (const id of input.interactionIds) {
    const interaction = rows.find(value => value.id === id), sourceVersion = versions.get(id);
    const result = interaction?.result;
    if (!interaction || !sourceVersion || interaction.companyId !== input.companyId || interaction.issueId !== input.issueId ||
      interaction.kind !== "request_confirmation" || interaction.status !== "expired" || !interaction.resolvedAt ||
      !result || Object.keys(result).sort().join(",") !== "outcome,reason,version" ||
      result.version !== 1 || result.outcome !== "issue_closed" || result.reason !== null || interaction.resolvedByRunId ||
      !interaction.sourceRunId)
      throw new NativeInteractionBridgeError("native_interaction_unresolved", "Administrative issue-close outcome changed");
    const [producer] = await input.db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, interaction.sourceRunId),
      eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId),
      eq(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.nativeIssueId, input.issueId))).limit(1);
    if (!producer || !producer.finishedAt || !["succeeded", "failed", "timed_out", "interrupted", "cancelled"].includes(producer.status) ||
      producer.nativeInputSourceProtocolVersion !== 1 || !await canActorReadHeartbeatRunPrivacy(input.db, reader, producer) ||
      ![producer.issueId, producer.nativeIssueId, record(producer.contextSnapshot).issueId].includes(input.issueId))
      throw new NativeInteractionBridgeError("native_interaction_binding_mismatch", "Administrative interaction producer changed");
    const events = await input.db.select().from(activityLog).where(and(
      eq(activityLog.companyId, input.companyId), eq(activityLog.action, "issue.thread_interaction_expired"),
      eq(activityLog.entityType, "issue"), eq(activityLog.entityId, input.issueId),
      sql`${activityLog.details}->>'interactionId' = ${id}`)).limit(2);
    const event = events.length === 1 ? events[0] : null;
    if (!event || event.companyId !== input.companyId || event.action !== "issue.thread_interaction_expired" ||
      event.entityType !== "issue" || event.entityId !== input.issueId || !event.details ||
      Object.keys(event.details).sort().join(",") !== "identifier,interactionId,interactionKind,interactionStatus,result,source" ||
      event.details.identifier !== (task.identifier ?? null) || event.details.interactionId !== id || event.details.interactionKind !== interaction.kind ||
      event.details.interactionStatus !== "expired" || event.details.source !== "issue.status_transition.issue_closed" ||
      !isDeepStrictEqual(event.details.result, result) || event.runId !== null)
      throw new NativeInteractionBridgeError("native_interaction_binding_mismatch", "Administrative interaction lifecycle owner changed");
    const resolverMatches = interaction.resolvedByUserId
      ? event.actorType === "user" && event.actorId === interaction.resolvedByUserId && event.agentId === null
      : interaction.resolvedByAgentId
        ? event.actorType === "agent" && event.actorId === interaction.resolvedByAgentId && event.agentId === interaction.resolvedByAgentId
        : event.actorType === "system" && event.actorId === "issue_service" && event.agentId === null;
    if (!resolverMatches || (interaction.resolvedByUserId && interaction.resolvedByAgentId))
      throw new NativeInteractionBridgeError("native_interaction_binding_mismatch", "Administrative interaction actor changed");
    const interactionOutcome: ExecutionContinuationEnvelope["interactionOutcomes"][number] = {
      id, kind: interaction.kind, status: interaction.status, result: structuredClone(result),
    };
    const projection: NativeAdministrativeInteractionExpiryCapture["projection"] = {
      version: 1, companyId: input.companyId, issueId: input.issueId, interactionId: id, sourceVersion,
      kind: "request_confirmation", status: "expired", result: { ...result },
      sourceRunId: interaction.sourceRunId ?? null, createdByAgentId: interaction.createdByAgentId ?? null,
      resolvedByUserId: interaction.resolvedByUserId ?? null, resolvedByAgentId: interaction.resolvedByAgentId ?? null,
      resolvedByRunId: interaction.resolvedByRunId ?? null, resolvedAt: new Date(interaction.resolvedAt).toISOString(),
      activityId: event.id, activityCreatedAt: event.createdAt.toISOString(), activityActorType: event.actorType,
      activityActorId: event.actorId, activityAgentId: event.agentId ?? null, activityRunId: event.runId ?? null,
    };
    captures.push({ companyId: input.companyId, issueId: input.issueId, runId: input.runId, agentId: input.agentId,
      projection, interactionOutcome,
      source: { kind: "interaction", issueId: input.issueId, interactionId: id, sourceVersion,
        contentHash: nativeSha256({ rendition: "native_issue_closed_interaction_v1", projection, interactionOutcome }) } });
  }
  return captures;
}

/** Read-only unresolved-ID witness. It never projects a pending request into a
 * Native Human response, executes a tool, or grants approval. */
export async function captureNativeGovernedPendingInteractions(input: {
  db: Db; companyId: string; issueId: string; runId: string; agentId: string; interactionIds: string[];
  reader?: import("../authorization.js").AuthorizationActor;
}): Promise<NativeGovernedPendingInteractionCapture[]> {
  if (input.interactionIds.length === 0) return [];
  if (input.interactionIds.length > 256 || new Set(input.interactionIds).size !== input.interactionIds.length)
    throw new NativeInteractionBridgeError("native_interaction_binding_mismatch", "Pending interaction selection is invalid");
  const [run] = await input.db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, input.runId),
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.status, "running"))).limit(1);
  const [task] = await input.db.select().from(issues).where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId),
    eq(issues.assigneeAgentId, input.agentId))).limit(1);
  const reader = input.reader ?? { type: "agent" as const, source: "agent_jwt" as const, companyId: input.companyId,
    agentId: input.agentId, runId: input.runId, onBehalfOfUserId: run?.responsibleUserId ?? null };
  const { canActorReadHeartbeatRunPrivacy, canActorReadIssuePrivacy, isCurrentTaskPrivacyPrincipal } =
    await import("../authorization.js");
  if (!run || !task || ["done", "cancelled"].includes(task.status) || !run.responsibleUserId ||
    ![run.issueId, run.nativeIssueId, record(run.contextSnapshot).issueId].includes(input.issueId) ||
    !await isCurrentTaskPrivacyPrincipal(input.db, reader, input.companyId) ||
    !await canActorReadHeartbeatRunPrivacy(input.db, reader, run) ||
    !await canActorReadIssuePrivacy(input.db, reader, task))
    throw new NativeInteractionBridgeError("native_interaction_binding_mismatch", "Pending interaction reader is unavailable");
  const versions = new Map<string, string>();
  const rows = await issueThreadInteractionService(input.db).listForIssue(input.issueId,
    { onSourceVersionSelected: (id, version) => { versions.set(id, version); } });
  const captures: NativeGovernedPendingInteractionCapture[] = [];
  for (const id of input.interactionIds) {
    const row = rows.find(value => value.id === id), version = versions.get(id);
    if (!row || !version || row.companyId !== input.companyId || row.issueId !== input.issueId || row.kind !== "request_confirmation" ||
      row.status !== "pending" || !row.payload.toolAction || !row.sourceRunId || row.result !== null || row.resolvedAt ||
      row.resolvedByUserId || row.resolvedByAgentId || row.resolvedByRunId)
      throw new NativeInteractionBridgeError("native_interaction_unresolved", "Pending governed interaction changed");
    const action = row.payload.toolAction;
    const [request] = await input.db.select().from(toolActionRequests).where(and(eq(toolActionRequests.id, action.actionRequestId),
      eq(toolActionRequests.companyId, input.companyId), eq(toolActionRequests.issueId, input.issueId),
      eq(toolActionRequests.interactionId, id), eq(toolActionRequests.invocationId, action.invocationId))).limit(1);
    const [invocation] = await input.db.select().from(toolInvocations).where(and(eq(toolInvocations.id, action.invocationId),
      eq(toolInvocations.companyId, input.companyId), eq(toolInvocations.issueId, input.issueId), eq(toolInvocations.agentId, input.agentId))).limit(1);
    const [producer] = await input.db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, row.sourceRunId),
      eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId))).limit(1);
    if (!request || !invocation || !producer || ![producer.nativeIssueId, producer.issueId, record(producer.contextSnapshot).issueId].includes(input.issueId) ||
      request.status !== "pending" || invocation.status !== "awaiting_approval" || invocation.approvalState !== "pending" ||
      request.requestedByAgentId !== input.agentId || invocation.runId !== producer.id ||
      request.canonicalArgumentsHash !== action.argumentsHash || invocation.argumentsHash !== action.argumentsHash ||
      request.decidedByUserId || request.decidedByAgentId || request.decidedAt || request.resolvedAt ||
      (request.expiresAt && request.expiresAt.getTime() <= Date.now()) ||
      (action.expiresAt != null && (!Number.isFinite(Date.parse(action.expiresAt)) || Date.parse(action.expiresAt) <= Date.now())) ||
      (request.expiresAt?.toISOString() ?? null) !== (action.expiresAt ?? null))
      throw new NativeInteractionBridgeError("native_interaction_governed_request_unresolved", "Pending request has no exact live invocation owner");
    const projection = nativeGovernedPendingProjection({ companyId: input.companyId, issueId: input.issueId,
      sourceVersion: version, sourceRunId: producer.id, interaction: row, request, invocation });
    captures.push({ companyId: input.companyId, issueId: input.issueId, runId: input.runId, agentId: input.agentId,
      projection, source: { kind: "interaction", issueId: input.issueId, interactionId: id, sourceVersion: version,
        contentHash: nativeSha256({ rendition: "native_governed_pending_reference_v1", projection }) } });
  }
  return captures;
}

export type NativeHistoricalPendingTransitionContext = {
  consumerRunId: string; parentRunId: string; parentReceiptDigest: string;
  terminalSources: NativeGovernedInteractionContinuationCapture[];
  lineage: Array<{ runId: string; receiptDigest: string }>;
};

/** A narrowly scoped historical fact, never live pending authority. Both the
 * original parent receipt and the actual current terminal transition context are required.
 * A still-pending sibling must also remain an exact live consumer source. */
export async function nativeGovernedPendingTransitionCurrent(input: {
  db: Db; companyId: string; issueId: string; agentId: string;
  source: Extract<NativePayloadSourceInput, { kind: "interaction" }>;
  context: NativeHistoricalPendingTransitionContext; reader: import("../authorization.js").AuthorizationActor; readWork?: () => void;
}): Promise<NativeGovernedPendingInteractionCapture | null> {
  const c = input.context, source = input.source;
  if (!Array.isArray(c.lineage) || c.lineage.length === 0 || c.lineage.length > 64 ||
    new Set(c.lineage.map(step => step.runId)).size !== c.lineage.length ||
    c.lineage.at(-1)?.runId !== c.parentRunId || c.lineage.at(-1)?.receiptDigest !== c.parentReceiptDigest ||
    c.parentRunId === c.consumerRunId || !/^\d+(?:\.\d+)?$/.test(source.sourceVersion) || (!Array.isArray(c.terminalSources) || c.terminalSources.length > 256)) return null;
  const [parent] = await input.db.select({ run: heartbeatRuns,
    digestValid: sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt'->>'digest') =
      encode(sha256(convert_to(((${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt')-'digest')::text,'UTF8')),'hex')`,
    inputDigestValid: sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt'->'bootstrap'->>'executionInputDigest') =
      encode(sha256(convert_to((${heartbeatRuns.runnerProfileJson}->'nativeExecutionInput')::text,'UTF8')),'hex')`,
  }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, c.parentRunId),
    eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.nativeIssueId, input.issueId), eq(heartbeatRuns.runtimeMode, "native"))).for("share");
  const [consumer] = await input.db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.id, c.consumerRunId), eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.nativeIssueId, input.issueId),
    eq(heartbeatRuns.runtimeMode, "native"))).for("share");
  if (!parent || !consumer || parent.digestValid !== true || parent.inputDigestValid !== true || parent.run.nativeInputSourceProtocolVersion !== 1 || consumer.nativeInputSourceProtocolVersion !== 1 || !parent.run.finishedAt || ["queued", "running"].includes(parent.run.status)) return null;
  const parentReceipt = nativeRunInputSourceReceiptSchema.safeParse(record(parent.run.runnerProfileJson).nativeInputSourceReceipt);
  const consumerReceipt = nativeRunInputSourceReceiptSchema.safeParse(record(consumer.runnerProfileJson).nativeInputSourceReceipt);
  if (!parentReceipt.success || !consumerReceipt.success || parentReceipt.data.digest !== c.parentReceiptDigest ||
    parentReceipt.data.binding.companyId !== input.companyId || parentReceipt.data.binding.issueId !== input.issueId ||
    parentReceipt.data.binding.agentId !== input.agentId || parentReceipt.data.binding.runId !== parent.run.id ||
    parentReceipt.data.binding.responsibleUserId !== parent.run.responsibleUserId ||
    consumerReceipt.data.binding.companyId !== input.companyId || consumerReceipt.data.binding.issueId !== input.issueId ||
    consumerReceipt.data.binding.agentId !== input.agentId || consumerReceipt.data.binding.runId !== consumer.id ||
    consumerReceipt.data.binding.responsibleUserId !== consumer.responsibleUserId ||
    ![parentReceipt.data.bootstrap,...parentReceipt.data.dispatches,...parentReceipt.data.additionalInputs]
      .some(set => set.inputs.some(value => isDeepStrictEqual(value,source)))) return null;
  const [consumerDigest] = await input.db.select({valid:sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt'->>'digest') =
    encode(sha256(convert_to(((${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt')-'digest')::text,'UTF8')),'hex')`,
    inputValid:sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt'->'bootstrap'->>'executionInputDigest') =
      encode(sha256(convert_to((${heartbeatRuns.runnerProfileJson}->'nativeExecutionInput')::text,'UTF8')),'hex')`})
    .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,input.companyId),eq(heartbeatRuns.id,consumer.id)));
  if (consumerDigest?.valid !== true || consumerDigest.inputValid !== true) return null;
  const { nativeRetainedRunResumeWitness, nativeToolContractFingerprintForTarget } = await import("./native-session-resume.js");
  const { parseNativeExecutionInput } = await import("../../vendor/paperclip-runner/index.js");
  const { captureNativeFinalizedContinuationSummary } = await import("../execution-continuation.js");
  let lineageOwner = consumer, lineageReceipt = consumerReceipt.data;
  for (const step of c.lineage) {
    input.readWork?.();
    const [selected] = await input.db.select({ run: heartbeatRuns,
      digestValid: sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt'->>'digest') =
        encode(sha256(convert_to(((${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt')-'digest')::text,'UTF8')),'hex')`,
    inputDigestValid: sql<boolean>`(${heartbeatRuns.runnerProfileJson}->'nativeInputSourceReceipt'->'bootstrap'->>'executionInputDigest') =
      encode(sha256(convert_to((${heartbeatRuns.runnerProfileJson}->'nativeExecutionInput')::text,'UTF8')),'hex')`,
    }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,input.companyId),eq(heartbeatRuns.id,step.runId),
      eq(heartbeatRuns.agentId,input.agentId),eq(heartbeatRuns.nativeIssueId,input.issueId))).for("share");
    const receipt = nativeRunInputSourceReceiptSchema.safeParse(record(selected?.run.runnerProfileJson).nativeInputSourceReceipt);
    if (!selected || selected.digestValid !== true || selected.inputDigestValid !== true || selected.run.nativeInputSourceProtocolVersion !== 1 || selected.run.runtimeMode !== "native" || !receipt.success || receipt.data.digest !== step.receiptDigest ||
      receipt.data.binding.runId !== step.runId || receipt.data.binding.companyId !== input.companyId ||
      receipt.data.binding.issueId !== input.issueId || receipt.data.binding.agentId !== input.agentId ||
      receipt.data.binding.responsibleUserId !== selected.run.responsibleUserId) return null;
    const profile = record(lineageOwner.runnerProfileJson);
    let retained: ReturnType<typeof nativeRetainedRunResumeWitness> = null;
    try {
      const execution = parseNativeExecutionInput(profile.nativeExecutionInput), generation = record(lineageOwner.contextSnapshot).conversationSessionGeneration;
      const target = profile.nativeToolContractFingerprint === nativeToolContractFingerprintForTarget("remote") ? "remote" :
        profile.nativeToolContractFingerprint === nativeToolContractFingerprintForTarget("local") ? "local" : null;
      retained = target ? nativeRetainedRunResumeWitness({previousRun:selected.run,currentExecution:execution,
        currentResponsibleUserId:lineageOwner.responsibleUserId,currentConversationSessionGeneration:
          Number.isSafeInteger(generation) && Number(generation)>=0 ? Number(generation) : null,
        requireConversationGeneration:false,executionTargetKind:target}) : null;
    } catch { retained = null; }
    const retainedEdge = retained && lineageReceipt.bootstrap.inputs.some(value => isDeepStrictEqual(value,retained!.source));
    let summaryEdge = false;
    if (!retainedEdge && record(profile.nativeBootstrapFinalizedContinuationSummary).sourceRunId === step.runId) {
      const summary = await captureNativeFinalizedContinuationSummary({db:input.db,companyId:input.companyId,issueId:input.issueId,
        agentId:input.agentId,receiverRunId:lineageOwner.id,sourceRunId:step.runId,reader:input.reader});
      summaryEdge = Boolean(summary && summary.parentReceipt.digest === step.receiptDigest &&
        isDeepStrictEqual(summary,profile.nativeBootstrapFinalizedContinuationSummary));
    }
    if (!retainedEdge && !summaryEdge) return null;
    lineageOwner=selected.run;lineageReceipt=receipt.data;
  }
  const { canActorReadHeartbeatRunPrivacy } = await import("../authorization.js");
  if (!await canActorReadHeartbeatRunPrivacy(input.db,input.reader,parent.run) || !await canActorReadHeartbeatRunPrivacy(input.db,input.reader,consumer)) return null;
  const [currentState] = await input.db.select({ status: issueThreadInteractions.status }).from(issueThreadInteractions)
    .where(and(eq(issueThreadInteractions.companyId,input.companyId),eq(issueThreadInteractions.issueId,input.issueId),
      eq(issueThreadInteractions.id,source.interactionId))).for("share");
  if (currentState?.status === "pending") {
    // One sibling may remain pending while another supplied the terminal
    // transition. Re-read through the actual current running consumer and
    // current reader, never by impersonating the finished parent Run.
    const pending = await captureNativeGovernedPendingInteractions({db:input.db,companyId:input.companyId,
      issueId:input.issueId,agentId:input.agentId,runId:consumer.id,interactionIds:[source.interactionId],reader:input.reader});
    if (pending.length !== 1 || !isDeepStrictEqual(pending[0]!.source,source) ||
      !consumerReceipt.data.bootstrap.inputs.some(value=>isDeepStrictEqual(value,source))) return null;
    // runId is only the enclosing historical rendition; its actor and all
    // live owner reads above remain bound to the current consumer.
    return {...pending[0]!,runId:parent.run.id};
  }
  const expected = c.terminalSources.filter(value => value.continuationSource.interactionId === source.interactionId);
  if (expected.length !== 1 || !consumerReceipt.data.bootstrap.inputs.some(value => isDeepStrictEqual(value,expected[0]!.continuationSource))) return null;
  const current: NativeGovernedInteractionContinuationCapture[] = [];
  await materializeNativeInteractionResponses({ db: input.db, companyId: input.companyId, issueId: input.issueId,
    runId: consumer.id, agentId: input.agentId, interactionIds: [source.interactionId], onContinuationSourceCapture: value => { current.push(value); } });
  if (current.length !== 1 || !isDeepStrictEqual(current[0],expected[0])) return null;
  const owner = current[0]!.projection.owner;
  const [row] = await input.db.select({ interaction: issueThreadInteractions, request: toolActionRequests, invocation: toolInvocations,
    originalBeforeDecision: sql<boolean>`${source.sourceVersion}::numeric >= extract(epoch from ${issueThreadInteractions.createdAt}) and
      ${source.sourceVersion}::numeric >= extract(epoch from ${toolActionRequests.createdAt}) and
      ${source.sourceVersion}::numeric >= extract(epoch from ${toolInvocations.createdAt}) and
      ${source.sourceVersion}::numeric < extract(epoch from ${toolActionRequests.decidedAt}) and
      ${source.sourceVersion}::numeric < extract(epoch from ${issueThreadInteractions.resolvedAt}) and
      ${parent.run.finishedAt}::timestamptz <= ${toolActionRequests.decidedAt} and
      (${toolActionRequests.expiresAt} is null or ${source.sourceVersion}::numeric < extract(epoch from ${toolActionRequests.expiresAt}))`,
  }).from(issueThreadInteractions).innerJoin(toolActionRequests,and(eq(toolActionRequests.interactionId,issueThreadInteractions.id),
    eq(toolActionRequests.id,owner.actionRequestId),eq(toolActionRequests.companyId,input.companyId),eq(toolActionRequests.issueId,input.issueId)))
    .innerJoin(toolInvocations,and(eq(toolInvocations.id,toolActionRequests.invocationId),eq(toolInvocations.id,owner.invocationId),
      eq(toolInvocations.companyId,input.companyId),eq(toolInvocations.issueId,input.issueId),eq(toolInvocations.agentId,input.agentId)))
    .where(and(eq(issueThreadInteractions.id,source.interactionId),eq(issueThreadInteractions.companyId,input.companyId),
      eq(issueThreadInteractions.issueId,input.issueId))).for("share");
  if (!row || row.originalBeforeDecision !== true || row.invocation.runId !== owner.sourceRunId ||
    row.request.decidedByUserId !== owner.resolvedByUserId || row.request.canonicalArgumentsHash !== owner.argumentsHash ||
    row.invocation.argumentsHash !== owner.argumentsHash) return null;
  const projection = nativeGovernedPendingProjection({ companyId:input.companyId,issueId:input.issueId,
    sourceVersion:source.sourceVersion,sourceRunId:owner.sourceRunId!,interaction:row.interaction,request:row.request,invocation:row.invocation });
  return source.contentHash === nativeSha256({rendition:"native_governed_pending_reference_v1",projection})
    ? { companyId:input.companyId,issueId:input.issueId,runId:parent.run.id,agentId:input.agentId,projection,source } : null;
}

// Schema parsing may trim recognized strings. Reject any raw field that the
// existing result schema would discard, while retaining the distinct raw DTO.
function sameGovernedResultShape(raw: unknown, parsed: unknown): boolean {
  if (Array.isArray(raw) || Array.isArray(parsed)) return Array.isArray(raw) && Array.isArray(parsed) && raw.length === parsed.length &&
    raw.every((value,index)=>sameGovernedResultShape(value,parsed[index]));
  if (raw && typeof raw === "object" || parsed && typeof parsed === "object") {
    if (!raw || !parsed || typeof raw !== "object" || typeof parsed !== "object") return false;
    const a=raw as Record<string,unknown>,b=parsed as Record<string,unknown>;
    return Object.keys(a).sort().join(",")===Object.keys(b).sort().join(",") && Object.keys(a).every(key=>sameGovernedResultShape(a[key],b[key]));
  }
  return true;
}

export class NativeInteractionBridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "NativeInteractionBridgeError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export type NativeAttentionMaterializedTarget = {
  effectKind: string;
  targetType: string;
  targetId: string;
};

/**
 * Applies audit-only attention outcomes that intentionally create no status
 * decision. The durable interaction/coordinator mutation is the proof; a
 * synthetic delivered effect row is neither created nor accepted.
 */
export async function applyNativeAttentionStatusDecision(input: {
  db: Db;
  companyId: string;
  issueId: string;
  runId: string;
  decision: NativeStatusDecision;
  targetInteractionId?: string;
  canonicalRequestId?: string;
}): Promise<NativeAttentionMaterializedTarget[]> {
  if (input.decision.statusAction !== "preserve") {
    throw new NativeInteractionBridgeError("native_attention_status_authority_invalid", "Audit-only attention cannot change issue status");
  }
  return input.db.transaction(async (tx) => {
    const targets: NativeAttentionMaterializedTarget[] = [];
    for (const effect of input.decision.effects) {
      if (effect.kind === "link_canonical_request") {
        const boundIds = [input.canonicalRequestId, input.targetInteractionId]
          .filter((id): id is string => typeof id === "string");
        const interactions = await tx.select({
          id: issueThreadInteractions.id,
          summary: issueThreadInteractions.summary,
        })
          .from(issueThreadInteractions).where(and(
            eq(issueThreadInteractions.companyId, input.companyId),
            eq(issueThreadInteractions.issueId, input.issueId),
            ...(boundIds.length > 0 ? [inArray(issueThreadInteractions.id, boundIds)] : []),
          )).limit(2);
        const canonical = input.canonicalRequestId
          ? interactions.find((interaction) => interaction.id === input.canonicalRequestId)
          : interactions[0];
        const duplicate = input.targetInteractionId
          ? interactions.find((interaction) => interaction.id === input.targetInteractionId)
          : interactions.find((interaction) => interaction.id !== canonical?.id);
        if (!canonical || !duplicate || canonical.id === duplicate.id) {
          throw new NativeInteractionBridgeError("native_attention_canonical_pair_missing", "Canonical and duplicate requests are required");
        }
        const summary = `Canonical native attention request: ${canonical.id}`;
        if (duplicate.summary !== summary) {
          await tx.update(issueThreadInteractions).set({
            summary,
            updatedAt: new Date(),
          }).where(eq(issueThreadInteractions.id, duplicate.id));
        }
        targets.push({ effectKind: effect.kind, targetType: "issue_thread_interaction", targetId: duplicate.id });
        continue;
      }
      if (effect.kind === "record_stale_response") {
        const interaction = await tx.select({
          id: issueThreadInteractions.id,
          summary: issueThreadInteractions.summary,
        })
          .from(issueThreadInteractions).where(and(
            eq(issueThreadInteractions.companyId, input.companyId),
            eq(issueThreadInteractions.issueId, input.issueId),
            ...(input.targetInteractionId ? [eq(issueThreadInteractions.id, input.targetInteractionId)] : []),
          )).limit(1).then((rows) => rows[0] ?? null);
        if (!interaction) throw new NativeInteractionBridgeError("native_stale_response_missing", "Stale response is not durable");
        const summary = "Response retained for audit after native supersession.";
        if (interaction.summary !== summary) {
          await tx.update(issueThreadInteractions).set({
            summary,
            updatedAt: new Date(),
          }).where(eq(issueThreadInteractions.id, interaction.id));
        }
        targets.push({ effectKind: effect.kind, targetType: "issue_thread_interaction", targetId: interaction.id });
        continue;
      }
      if (effect.kind === "record_finalization_error") {
        const [coordinator] = await tx.update(nativeRunFinalizations).set({
          phase: "terminal_failure",
          failureCode: effect.cause,
          failureDetail: { nextAction: effect.nextAction, recoveryOwner: { kind: "agent", agentId: effect.agentId } },
          nextAttemptAt: null,
          updatedAt: new Date(),
        }).where(and(
          eq(nativeRunFinalizations.runId, input.runId),
          eq(nativeRunFinalizations.companyId, input.companyId),
          eq(nativeRunFinalizations.issueId, input.issueId),
        )).returning({ runId: nativeRunFinalizations.runId });
        if (!coordinator) throw new NativeInteractionBridgeError("native_finalization_coordinator_missing", "Native coordinator is required");
        await tx.update(heartbeatRuns).set({
          nativePhase: "terminal_failure",
          nativePhaseUpdatedAt: new Date(),
          errorCode: effect.cause,
          updatedAt: new Date(),
        }).where(and(eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, input.companyId)));
        targets.push({ effectKind: effect.kind, targetType: "native_run_finalization", targetId: coordinator.runId });
        continue;
      }
      throw new NativeInteractionBridgeError("native_attention_effect_unimplemented", effect.kind);
    }
    return targets;
  });
}

/**
 * Materialize only interactions that authorized this run's wake. Resolution
 * remains owned by the existing interaction service; this bridge is a
 * read-only, identity-bound projection and never receives credentials.
 */
export async function materializeNativeInteractionResponses(input: {
  db: Db;
  companyId: string;
  issueId: string;
  runId: string;
  agentId: string;
  interactionIds: string[];
  onSourceCapture?: (source: Extract<NativePayloadSourceInput, { kind: "interaction" }>) => void;
  onContinuationSourceCapture?: (capture: NativeGovernedInteractionContinuationCapture) => void;
  onAnsweredQuestionCapture?: (capture: NativeAnsweredQuestionContinuationCapture) => void;
}): Promise<NativeInteractionResponseEnvelope[]> {
  const requestedIds = new Set(input.interactionIds.filter(Boolean));
  if (requestedIds.size === 0) return [];
  const selectedVersions = new Map<string, string>();
  const [interactions, issue] = await Promise.all([
    issueThreadInteractionService(input.db).listForIssue(input.issueId, (input.onSourceCapture || input.onContinuationSourceCapture || input.onAnsweredQuestionCapture) ? {
      onSourceVersionSelected: (id, version) => { selectedVersions.set(id, version); },
    } : undefined),
    input.db.select({ status: issues.status }).from(issues).where(and(
      eq(issues.id, input.issueId),
      eq(issues.companyId, input.companyId),
    )).limit(1).then((rows) => rows[0] ?? null),
  ]);
  if (!issue) throw new NativeInteractionBridgeError("native_interaction_binding_mismatch", "Issue binding not found");
  const responses: NativeInteractionResponseEnvelope[] = [];
  const governedOwners = new Map<string, NativeGovernedInteractionContinuationCapture["projection"]["owner"]>();

  for (const interaction of interactions) {
    if (!requestedIds.has(interaction.id)) continue;
    if (interaction.companyId !== input.companyId || interaction.issueId !== input.issueId) {
      throw new NativeInteractionBridgeError(
        "native_interaction_binding_mismatch",
        `Interaction ${interaction.id} is not bound to the native company and issue`,
      );
    }
    if (interaction.kind === "request_confirmation" && interaction.payload.toolAction) {
      const action = interaction.payload.toolAction;
      if (["accepted", "rejected"].includes(interaction.status) && (interaction.resolvedByAgentId || interaction.resolvedByRunId === input.runId)) {
        throw new NativeInteractionBridgeError("native_interaction_self_approval", "Agents cannot resolve governed tool reviews");
      }
      const [request] = await input.db.select().from(toolActionRequests).where(and(eq(toolActionRequests.id, action.actionRequestId), eq(toolActionRequests.companyId, input.companyId), eq(toolActionRequests.issueId, input.issueId), eq(toolActionRequests.interactionId, interaction.id), eq(toolActionRequests.invocationId, action.invocationId)));
      const [invocation] = await input.db.select().from(toolInvocations).where(and(eq(toolInvocations.id, action.invocationId), eq(toolInvocations.companyId, input.companyId), eq(toolInvocations.issueId, input.issueId), eq(toolInvocations.agentId, input.agentId)));
      if (!request || !invocation || request.requestedByAgentId !== input.agentId || request.canonicalArgumentsHash !== action.argumentsHash) {
        throw new NativeInteractionBridgeError("native_interaction_governed_request_unresolved", "Tool review has no matching authoritative invocation");
      }
      if (["expired", "cancelled"].includes(request.status)) {
        if (interaction.status !== request.status && !(interaction.status === "accepted" && interaction.result?.toolAction?.status === "expired")) throw new NativeInteractionBridgeError("native_interaction_governed_result_mismatch", "Tool review lifecycle does not match its request");
        responses.push({ interactionId: interaction.id, kind: interaction.kind, response: { status: interaction.status, result: structuredClone(interaction.result), executionStatus: request.status } });
        continue;
      }
      if (!request.decidedByUserId || request.decidedByUserId !== interaction.resolvedByUserId || !["executed", "failed", "rejected"].includes(request.status) || (request.status === "rejected" ? interaction.status !== "rejected" : interaction.status !== "accepted")) {
        throw new NativeInteractionBridgeError("native_interaction_governed_request_unresolved", "Tool review must have a human decision and an authoritative terminal execution outcome");
      }
      const expectedInvocationStatus = request.status === "executed" ? "succeeded" : request.status === "rejected" ? "denied" : "failed";
      if (invocation.status !== expectedInvocationStatus || (request.status !== "rejected" && interaction.result?.toolAction?.status !== request.status)) throw new NativeInteractionBridgeError("native_interaction_governed_result_mismatch", "Tool review outcome does not match its invocation");
      if (input.onContinuationSourceCapture && interaction.resolvedByUserId && interaction.resolvedAt &&
        !interaction.resolvedByAgentId && !interaction.resolvedByRunId && interaction.sourceRunId) {
        const [producer] = await input.db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, interaction.sourceRunId),
          eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId))).limit(1);
        if (!producer || invocation.runId !== producer.id ||
          ![producer.nativeIssueId, producer.issueId, record(producer.contextSnapshot).issueId].includes(input.issueId))
          throw new NativeInteractionBridgeError("native_interaction_binding_mismatch", "Governed continuation producer changed");
        governedOwners.set(interaction.id, { sourceRunId: interaction.sourceRunId ?? null, sourceCommentId: interaction.sourceCommentId ?? null,
          originCommentIds: [...(interaction.originCommentIds ?? [])], continuationPolicy: interaction.continuationPolicy,
          resolvedByUserId: interaction.resolvedByUserId, resolvedAt: new Date(interaction.resolvedAt).toISOString(),
          actionRequestId: request.id, invocationId: invocation.id, argumentsHash: request.canonicalArgumentsHash,
          requestStatus: request.status, invocationStatus: invocation.status });
      }
    }
    const interactionResult = record(interaction.result);
    const supersessionOutcome = interaction.status === "expired"
      && ["superseded_by_newer_request", "superseded_by_comment", "stale_target"].includes(String(interactionResult.outcome));
    if (supersessionOutcome) {
      const duplicate = interactionResult.outcome === "superseded_by_newer_request";
      const decision = resolveNativeAttentionStatus({
        facts: duplicate
          ? {
              companyScopeValid: true,
              responseState: "none",
              route: "duplicate",
              summary: interaction.summary ?? interaction.title ?? "Duplicate native attention request",
            }
          : {
              companyScopeValid: true,
              responseState: "stale",
              route: "context",
              summary: interaction.summary ?? interaction.title ?? "Stale native attention response",
            },
        priorIssueStatus: issue.status as NativeAuthoritativeIssueStatus,
        agentId: input.agentId,
      });
      await applyNativeAttentionStatusDecision({
        db: input.db,
        companyId: input.companyId,
        issueId: input.issueId,
        runId: input.runId,
        decision,
        targetInteractionId: interaction.id,
        canonicalRequestId: typeof interactionResult.supersededByInteractionId === "string"
          ? interactionResult.supersededByInteractionId
          : undefined,
      });
      continue;
    }
    if (
      interaction.resolvedByRunId === input.runId
      || (
        interaction.resolvedByAgentId === input.agentId
        && interaction.createdByAgentId === input.agentId
      )
    ) {
      throw new NativeInteractionBridgeError(
        "native_interaction_self_approval",
        `Run ${input.runId} cannot consume a response it resolved itself`,
      );
    }
    const hasInteractionResolver = Boolean(interaction.resolvedByUserId || interaction.resolvedByAgentId);
    if (interaction.kind !== "request_item_verdicts" && !hasInteractionResolver) {
      throw new NativeInteractionBridgeError(
        "native_interaction_unresolved",
        `Interaction ${interaction.id} has no authorized resolver`,
      );
    }

    if (interaction.kind === "request_confirmation" || interaction.kind === "request_checkbox_confirmation") {
      if (interaction.resolvedByAgentId === input.agentId) {
        throw new NativeInteractionBridgeError(
          "native_interaction_self_approval",
          `Agent ${input.agentId} cannot consume a confirmation it resolved`,
        );
      }
      if (
        (interaction.status !== "accepted" && interaction.status !== "rejected")
        || !interaction.result
        || (interaction.result.outcome !== "accepted" && interaction.result.outcome !== "rejected")
      ) {
        throw new NativeInteractionBridgeError(
          "native_interaction_unresolved",
          `Confirmation ${interaction.id} is not authoritatively resolved`,
        );
      }
      const resolution = resolveNativeAttentionStatus({
        facts: {
          companyScopeValid: true,
          responseState: "resolved",
          route: "context",
          summary: interaction.summary ?? interaction.title ?? "Resolved native interaction",
        },
        priorIssueStatus: issue.status as NativeAuthoritativeIssueStatus,
        agentId: input.agentId,
      });
      if (resolution.reasonCode !== "attention_resolved_from_context") {
        throw new NativeInteractionBridgeError("native_attention_resolution_invalid", "Resolved interaction has no continuation policy");
      }
      responses.push({
        interactionId: interaction.id,
        kind: interaction.kind,
        response: {
          status: interaction.status,
          result: structuredClone(interaction.result) as unknown as Record<string, unknown>,
        },
      });
      continue;
    }

    if (interaction.kind === "suggest_tasks" || interaction.kind === "connection_intent") {
      if (
        (interaction.status !== "accepted" && interaction.status !== "rejected")
        || !interaction.result
      ) {
        throw new NativeInteractionBridgeError(
          "native_interaction_unresolved",
          `Suggested-task interaction ${interaction.id} is not authoritatively resolved`,
        );
      }
      responses.push({
        interactionId: interaction.id,
        kind: interaction.kind,
        response: {
          status: interaction.status,
          result: structuredClone(interaction.result) as unknown as Record<string, unknown>,
        },
      });
      continue;
    }

    if (interaction.kind === "ask_user_questions") {
      if (interaction.status !== "answered" || !interaction.result || interaction.result.cancelled === true) {
        throw new NativeInteractionBridgeError(
          "native_interaction_unresolved",
          `Question interaction ${interaction.id} is not authoritatively answered`,
        );
      }
      const resolution = resolveNativeAttentionStatus({
        facts: {
          companyScopeValid: true,
          responseState: "resolved",
          route: "context",
          summary: interaction.summary ?? interaction.title ?? "Answered native interaction",
        },
        priorIssueStatus: issue.status as NativeAuthoritativeIssueStatus,
        agentId: input.agentId,
      });
      if (resolution.reasonCode !== "attention_resolved_from_context") {
        throw new NativeInteractionBridgeError("native_attention_resolution_invalid", "Answered interaction has no continuation policy");
      }
      const result = structuredClone(interaction.result) as unknown as Record<string, unknown>;
      const summaryMarkdown = formatDurableQuestionResponseSummary(interaction);
      responses.push({
        interactionId: interaction.id,
        kind: interaction.kind,
        response: {
          status: interaction.status,
          result: summaryMarkdown
            ? { ...result, summaryMarkdown }
            : result,
        },
      });
      continue;
    }

    if (interaction.kind === "request_item_verdicts") {
      const result = record(interaction.result);
      const items = Array.isArray(result.items) ? result.items.map(record) : [];
      const complete = result.complete === true;
      const hasAuthorizedItemResolver = items.some((item) =>
        typeof item.resolvedByUserId === "string"
        || (typeof item.resolvedByAgentId === "string" && item.resolvedByAgentId !== input.agentId));
      const hasSelfResolvedItem = items.some((item) => item.resolvedByAgentId === input.agentId);
      if (hasSelfResolvedItem) {
        throw new NativeInteractionBridgeError(
          "native_interaction_self_approval",
          `Agent ${input.agentId} cannot consume item verdicts it resolved`,
        );
      }
      if (
        !interaction.result
        || (interaction.status !== "pending" && interaction.status !== "answered")
        || (interaction.status === "answered" && !complete)
        || items.length === 0
        || !hasAuthorizedItemResolver
      ) {
        throw new NativeInteractionBridgeError(
          "native_interaction_unresolved",
          `Item-verdict interaction ${interaction.id} has no authoritative response`,
        );
      }
      responses.push({
        interactionId: interaction.id,
        kind: interaction.kind,
        response: {
          status: interaction.status,
          result: structuredClone(interaction.result) as unknown as Record<string, unknown>,
        },
      });
      continue;
    }

    throw new NativeInteractionBridgeError(
      "native_runtime_request_unsupported",
      "Interaction kind is not supported by the native input contract",
    );
  }

  const missing = [...requestedIds].filter((id) => !responses.some((response) => response.interactionId === id));
  if (missing.length > 0) {
    throw new NativeInteractionBridgeError(
      "native_interaction_missing",
      `Native interaction response not found: ${missing.join(", ")}`,
    );
  }
  // Redact before constructing native input, including formatted answers and
  // the legacy question projection, without changing stored resolution proof.
  const redacted = await createRunSecretRedactionRegistry(input.db).redactForIssue(
    input.companyId,
    input.issueId,
    responses.sort((left, right) => left.interactionId.localeCompare(right.interactionId)),
  );
  if (input.onSourceCapture || input.onContinuationSourceCapture || input.onAnsweredQuestionCapture) {
    for (const response of redacted) {
      const sourceVersion = selectedVersions.get(response.interactionId);
      if (!sourceVersion) throw new NativeInteractionBridgeError(
        "native_interaction_source_missing", "Selected interaction version is unavailable",
      );
      const nativeSource = { kind: "interaction" as const, issueId: input.issueId,
        interactionId: response.interactionId, sourceVersion, contentHash: nativeSha256(response) };
      input.onSourceCapture?.(nativeSource);
      const owner = governedOwners.get(response.interactionId);
      const selected = interactions.find(row => row.id === response.interactionId);
      if (input.onAnsweredQuestionCapture && selected?.kind === "ask_user_questions") {
        const { projectHumanInteractionResponse } = await import("../execution-continuation.js");
        const [raw] = await input.db.select({ row: issueThreadInteractions,
          version: sql<string>`extract(epoch from ${issueThreadInteractions.updatedAt})::text` }).from(issueThreadInteractions)
          .where(and(eq(issueThreadInteractions.id, selected.id), eq(issueThreadInteractions.companyId, input.companyId),
            eq(issueThreadInteractions.issueId, input.issueId))).for("share");
        const result = askUserQuestionsResultSchema.safeParse(raw?.row.result);
        const payload = askUserQuestionsPayloadSchema.safeParse(raw?.row.payload);
        const humanResponse = raw && projectHumanInteractionResponse(raw.row);
        if (!raw || raw.version !== sourceVersion || raw.row.kind !== "ask_user_questions" || raw.row.status !== "answered" ||
          !payload.success || !isDeepStrictEqual(selected.payload, payload.data) || selected.title !== raw.row.title ||
          !result.success || !isDeepStrictEqual(selected.result, result.data) || result.data.cancelled ||
          !isDeepStrictEqual(raw.row.result, result.data) || !humanResponse)
          throw new NativeInteractionBridgeError("native_interaction_question_result_mismatch", "Human question rendition changed");
        const projection = await createRunSecretRedactionRegistry(input.db).redactForIssue(input.companyId, input.issueId, {
          owner: { sourceRunId: raw.row.sourceRunId, sourceCommentId: raw.row.sourceCommentId,
            originCommentIds: raw.row.originCommentIds ?? [], continuationPolicy: raw.row.continuationPolicy,
            resolvedByUserId: raw.row.resolvedByUserId!, resolvedAt: raw.row.resolvedAt!.toISOString() },
          humanResponse, interactionOutcome: { id: raw.row.id, kind: raw.row.kind, status: raw.row.status, result: raw.row.result },
        });
        const capture = { companyId: input.companyId, issueId: input.issueId,
          runId: input.runId, agentId: input.agentId, nativeSource, nativeResponse: response, ...projection };
        input.onAnsweredQuestionCapture(structuredClone({ ...capture,
          continuationSource: nativeAnsweredQuestionContinuationSource(capture) }));
      }
      if (input.onContinuationSourceCapture && owner && selected) {
        const { projectHumanInteractionResponse } = await import("../execution-continuation.js");
        const [raw] = await input.db.select({row:issueThreadInteractions,
          version:sql<string>`extract(epoch from ${issueThreadInteractions.updatedAt})::text`}).from(issueThreadInteractions)
          .where(and(eq(issueThreadInteractions.id,selected.id),eq(issueThreadInteractions.companyId,input.companyId),eq(issueThreadInteractions.issueId,input.issueId))).for("share");
        const parsedResult=requestConfirmationResultSchema.safeParse(raw?.row.result);
        if(!raw || raw.version!==sourceVersion || !parsedResult.success || !sameGovernedResultShape(raw.row.result,parsedResult.data))
          throw new NativeInteractionBridgeError("native_interaction_governed_result_mismatch","Governed continuation rendition changed");
        const humanResponse = projectHumanInteractionResponse(raw.row);
        if (!humanResponse) throw new NativeInteractionBridgeError("native_interaction_governed_result_mismatch",
          "Governed interaction has no exact Human response projection");
        const projection = await createRunSecretRedactionRegistry(input.db).redactForIssue(input.companyId, input.issueId, {
          version: 1 as const, companyId: input.companyId, issueId: input.issueId,
          interactionId: response.interactionId, sourceVersion, nativeResponseDigest: nativeSource.contentHash,
          owner, humanResponse, interactionOutcome: { id: raw.row.id, kind: raw.row.kind, status: raw.row.status, result: raw.row.result },
        });
        input.onContinuationSourceCapture(structuredClone({ companyId: input.companyId, issueId: input.issueId,
          runId: input.runId, agentId: input.agentId, nativeResponse: response, nativeSource,
          continuationSource: { ...nativeSource, contentHash: nativeSha256({ rendition: "native_governed_continuation_v1", projection }) }, projection }));
      }
    }
  }
  return redacted;
}

export type LegacyQuestionResponseWakeProjection = {
  interactionId: string;
  summaryMarkdown: string;
};

/**
 * Legacy adapters do not consume the runner's closed interaction-response
 * envelope. Project an answered question set into their wake prompt at invoke
 * time instead. The caller must keep this projection ephemeral so the
 * interaction result remains the only control-plane copy of the answers.
 */
export async function materializeLegacyQuestionResponseWakeProjection(input: {
  db: Db;
  companyId: string;
  issueId: string;
  runId: string;
  agentId: string;
  interactionId: string;
}): Promise<LegacyQuestionResponseWakeProjection | null> {
  const responses = await materializeNativeInteractionResponses({
    ...input,
    interactionIds: [input.interactionId],
  });
  const response = responses.find((candidate) =>
    candidate.interactionId === input.interactionId
    && candidate.kind === "ask_user_questions"
    && candidate.response.status === "answered"
  );
  if (!response) return null;
  const summaryMarkdown = record(response.response.result).summaryMarkdown;
  if (typeof summaryMarkdown !== "string" || summaryMarkdown.trim().length === 0) return null;
  return {
    interactionId: response.interactionId,
    summaryMarkdown: summaryMarkdown.trim(),
  };
}

/** Native runtimes never receive credentials and never auto-approve requests. */
export function rejectUnsupportedNativeRuntimeRequest(requestKind: string) {
  return {
    accepted: false as const,
    code: "native_runtime_request_unsupported" as const,
    requestKind,
    credentialsInjected: false as const,
    selfApproval: false as const,
  };
}

export type NativeAttentionFacts = {
  companyScopeValid: boolean;
  responseState: "none" | "resolved" | "stale" | "expired";
  route: "alternate_track" | "context" | "retry" | "agent" | "human" | "duplicate" | "recovery";
  summary: string;
  budgetExhausted?: boolean;
  governanceGate?: NativeGovernanceGate | null;
  resolvedTargetAgentId?: string | null;
};

export type NativeAttentionCandidate = {
  route: NativeAttentionFacts["route"];
  summary: string;
  responseState?: NativeAttentionFacts["responseState"];
  targetAgentId?: string | null;
  targetCompanyId?: string | null;
  budgetExhausted?: boolean;
  governanceGate?: NativeGovernanceGate | null;
  targetInteractionId?: string;
  canonicalRequestId?: string;
};

function nonEmptyText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function candidateFromPersistedRequest(request: Record<string, unknown>): NativeAttentionCandidate {
  const summary = nonEmptyText(request.summary);
  if (!summary) {
    throw new NativeInteractionBridgeError(
      "native_attention_request_invalid",
      "Persisted native attention requires a summary",
    );
  }
  const target = record(request.target);
  const capability = nonEmptyText(request.requestedCapability) ?? nonEmptyText(request.kind);
  const ownerClass = nonEmptyText(target.ownerClass);
  const requiredAuthority = nonEmptyText(request.requiredAuthority);
  const responseState = nonEmptyText(request.responseState);
  const governanceGate = record(request.governanceGate);
  let route: NativeAttentionCandidate["route"];
  if (capability === "context_lookup") route = "context";
  else if (capability === "retry") route = "retry";
  else if (capability === "duplicate") route = "duplicate";
  else if (capability === "alternate_track" || ownerClass === "current_agent") route = "alternate_track";
  else if (capability === "domain_expertise" || ownerClass === "agent") route = "agent";
  else if (
    ["review", "credential_grant", "governed_approval", "subjective_decision", "external_action"].includes(capability ?? "")
    || ["board_user", "external_system"].includes(ownerClass ?? "")
    || ["board", "external"].includes(requiredAuthority ?? "")
  ) route = "human";
  else {
    throw new NativeInteractionBridgeError(
      "native_attention_request_invalid",
      `Persisted native attention capability ${capability ?? "unknown"} has no authorized route`,
    );
  }
  return {
    route,
    summary,
    responseState: ["none", "resolved", "stale", "expired"].includes(responseState ?? "")
      ? responseState as NativeAttentionFacts["responseState"]
      : undefined,
    targetAgentId: nonEmptyText(target.agentId),
    targetCompanyId: nonEmptyText(target.companyId),
    budgetExhausted: request.budgetExhausted === true,
    governanceGate: governanceGate.kind === "interaction" && nonEmptyText(governanceGate.id)
      ? { kind: "interaction", id: nonEmptyText(governanceGate.id)! }
      : null,
    targetInteractionId: nonEmptyText(request.targetInteractionId) ?? undefined,
    canonicalRequestId: nonEmptyText(request.canonicalRequestId) ?? undefined,
  };
}

export type PersistedNativeAttentionReceipt = {
  requestId: string;
  route: NativeAttentionCandidate["route"];
  assessmentId: string;
  decisionId: string | null;
  reasonCode: string | null;
  resolvedTargetAgentId: string | null;
  materializedTargets: NativeAttentionMaterializedTarget[];
  replayed: boolean;
};

/**
 * Runtime-reachable ingress for accepted attention facts. It starts from the
 * immutable package result row, derives an authorized route, appends one
 * assessment/decision lineage per request, and lets the existing issue and
 * interaction owners materialize the effect.
 */
export async function routePersistedNativeResultAttention(input: {
  db: Db;
  runId: string;
}): Promise<PersistedNativeAttentionReceipt[]> {
  const binding = await input.db.select({
    companyId: heartbeatRuns.companyId,
    runtimeMode: heartbeatRuns.runtimeMode,
    resultId: nativeRunFinalizations.resultId,
    issueId: nativeRunFinalizations.issueId,
  }).from(heartbeatRuns)
    .innerJoin(nativeRunFinalizations, eq(nativeRunFinalizations.runId, heartbeatRuns.id))
    .where(eq(heartbeatRuns.id, input.runId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (!binding || binding.runtimeMode !== "native" || !binding.resultId) {
    throw new NativeInteractionBridgeError(
      "native_attention_binding_mismatch",
      "Accepted native result binding not found",
    );
  }
  const resultRow = await input.db.select().from(nativeRunResults).where(and(
    eq(nativeRunResults.id, binding.resultId),
    eq(nativeRunResults.companyId, binding.companyId),
    eq(nativeRunResults.issueId, binding.issueId),
    eq(nativeRunResults.runId, input.runId),
    eq(nativeRunResults.schemaStatus, "accepted"),
  )).limit(1).then((rows) => rows[0] ?? null);
  if (!resultRow) {
    throw new NativeInteractionBridgeError(
      "native_attention_result_missing",
      "Accepted native result row not found",
    );
  }
  const result = record(record(resultRow.resultJson).result);
  const requests = Array.isArray(result.attentionRequests)
    ? result.attentionRequests.map(record)
    : [];
  const receipts: PersistedNativeAttentionReceipt[] = [];

  for (const [index, request] of requests.entries()) {
    const candidate = candidateFromPersistedRequest(request);
    const requestId = nonEmptyText(request.id) ?? nativeSha256({
      runId: input.runId,
      resultId: resultRow.id,
      index,
      request,
    });
    const existingAssessment = await input.db.select({ id: workAssessments.id })
      .from(workAssessments).where(and(
        eq(workAssessments.companyId, binding.companyId),
        eq(workAssessments.issueId, binding.issueId),
        eq(workAssessments.runId, input.runId),
        eq(workAssessments.triggerKind, "native_attention"),
        eq(workAssessments.triggerRef, requestId),
      )).limit(1).then((rows) => rows[0] ?? null);
    if (existingAssessment) {
      const existingDecision = await input.db.select({
        id: statusDecisions.id,
        reasonCode: statusDecisions.reasonCode,
        decisionJson: statusDecisions.decisionJson,
      }).from(statusDecisions).where(and(
        eq(statusDecisions.companyId, binding.companyId),
        eq(statusDecisions.assessmentId, existingAssessment.id),
      )).limit(1).then((rows) => rows[0] ?? null);
      if (existingDecision) {
        const decisionJson = record(existingDecision.decisionJson);
        const effects = Array.isArray(decisionJson.effects) ? decisionJson.effects.map(record) : [];
        const delegation = effects.find((effect) => effect.kind === "create_delegated_issue");
        const finalizationError = effects.find((effect) => effect.kind === "record_finalization_error");
        await input.db.update(nativeRunFinalizations).set({
          phase: finalizationError ? "retryable_failure" : "committed",
          assessmentId: existingAssessment.id,
          decisionId: existingDecision.id,
          leaseOwner: null,
          leaseExpiresAt: null,
          failureCode: nonEmptyText(finalizationError?.cause),
          failureDetail: finalizationError ? {
            originalFailureCode: finalizationError.cause,
            nextAction: finalizationError.nextAction,
          } : null,
          nextAttemptAt: finalizationError ? new Date(Date.now() + 30_000) : null,
          updatedAt: new Date(),
        }).where(and(
          eq(nativeRunFinalizations.runId, input.runId),
          eq(nativeRunFinalizations.companyId, binding.companyId),
          eq(nativeRunFinalizations.issueId, binding.issueId),
        ));
        receipts.push({
          requestId,
          route: candidate.route,
          assessmentId: existingAssessment.id,
          decisionId: existingDecision.id,
          reasonCode: existingDecision.reasonCode,
          resolvedTargetAgentId: nonEmptyText(delegation?.agentId),
          materializedTargets: [],
          replayed: true,
        });
        continue;
      }
    }

    const issue = await input.db.select({
      status: issues.status,
      statusVersion: issues.statusVersion,
      lastStatusDecisionId: issues.lastStatusDecisionId,
    }).from(issues).where(and(
      eq(issues.id, binding.issueId),
      eq(issues.companyId, binding.companyId),
    )).limit(1).then((rows) => rows[0] ?? null);
    if (!issue) throw new NativeInteractionBridgeError("native_attention_binding_mismatch", "Issue binding not found");
    const coordinator = await input.db.select({
      phase: nativeRunFinalizations.phase,
      assessmentId: nativeRunFinalizations.assessmentId,
      decisionId: nativeRunFinalizations.decisionId,
    }).from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, input.runId))
      .limit(1).then((rows) => rows[0] ?? null);
    if (!coordinator) throw new NativeInteractionBridgeError("native_attention_binding_mismatch", "Coordinator binding not found");
    const assessment = await recordNativeAttentionAssessment({
      db: input.db,
      companyId: binding.companyId,
      issueId: binding.issueId,
      runId: input.runId,
      turnId: resultRow.turnId,
      contractId: resultRow.completionContractId,
      resultId: resultRow.id,
      requestId,
      request,
      routingFacts: candidate as unknown as Record<string, unknown>,
      priorIssueStatus: issue.status,
      priorStatusVersion: Number(issue.statusVersion),
      priorDecisionId: issue.lastStatusDecisionId,
      supersedesAssessmentId: coordinator.assessmentId,
    });
    const routed = await routeNativeAttention({
      db: input.db,
      runId: input.runId,
      assessmentId: assessment.id,
      supersedesCommittedDecisionId: coordinator.phase === "committed"
        ? coordinator.decisionId ?? undefined
        : undefined,
      candidate,
    });
    receipts.push({
      requestId,
      route: candidate.route,
      assessmentId: assessment.id,
      decisionId: routed.decisionId,
      reasonCode: routed.decision.reasonCode,
      resolvedTargetAgentId: routed.resolvedTargetAgentId,
      materializedTargets: routed.targets,
      replayed: existingAssessment !== null,
    });
  }

  if (receipts.length > 0) {
    await input.db.transaction(async (tx) => {
      const run = await tx.select({ resultJson: heartbeatRuns.resultJson })
        .from(heartbeatRuns).where(and(
          eq(heartbeatRuns.id, input.runId),
          eq(heartbeatRuns.companyId, binding.companyId),
        )).for("update").limit(1).then((rows) => rows[0] ?? null);
      if (!run) throw new NativeInteractionBridgeError("native_attention_binding_mismatch", "Heartbeat run missing");
      await tx.update(heartbeatRuns).set({
        resultJson: { ...record(run.resultJson), nativeAttentionRouting: receipts },
        updatedAt: new Date(),
      }).where(eq(heartbeatRuns.id, input.runId));
    });
  }
  return receipts;
}

/**
 * Internal owner-routing step for native attention. The persisted-result
 * ingress above supplies the server-owned assessment and untrusted candidate;
 * this step resolves company scope and commits or audit-materializes the
 * authority decision.
 */
export async function routeNativeAttention(input: {
  db: Db;
  runId: string;
  assessmentId?: string;
  supersedesCommittedDecisionId?: string;
  candidate: NativeAttentionCandidate;
}) {
  const binding = await input.db.select({
    companyId: heartbeatRuns.companyId,
    agentId: heartbeatRuns.agentId,
    runtimeMode: heartbeatRuns.runtimeMode,
    issueId: nativeRunFinalizations.issueId,
    assessmentId: nativeRunFinalizations.assessmentId,
    issueStatus: issues.status,
    issueStatusVersion: issues.statusVersion,
    issueDecisionId: issues.lastStatusDecisionId,
  }).from(heartbeatRuns)
    .innerJoin(nativeRunFinalizations, eq(nativeRunFinalizations.runId, heartbeatRuns.id))
    .innerJoin(issues, and(
      eq(issues.id, nativeRunFinalizations.issueId),
      eq(issues.companyId, heartbeatRuns.companyId),
    ))
    .where(eq(heartbeatRuns.id, input.runId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (!binding || binding.runtimeMode !== "native") {
    throw new NativeInteractionBridgeError("native_attention_binding_mismatch", "Native attention run binding not found");
  }

  const companyAgents = await input.db.select({
    id: agents.id,
    companyId: agents.companyId,
    name: agents.name,
    status: agents.status,
    reportsTo: agents.reportsTo,
  }).from(agents).where(eq(agents.companyId, binding.companyId)).orderBy(asc(agents.createdAt), asc(agents.id));
  const targetSuggestion = input.candidate.targetAgentId
    ? await input.db.select({ id: agents.id, companyId: agents.companyId })
        .from(agents).where(eq(agents.id, input.candidate.targetAgentId)).limit(1)
        .then((rows) => rows[0] ?? null)
    : null;
  const companyScopeValid = (
    !input.candidate.targetCompanyId
    || input.candidate.targetCompanyId === binding.companyId
  ) && (
    !input.candidate.targetAgentId
    || targetSuggestion?.companyId === binding.companyId
  );
  let resolvedTargetAgentId: string | null = null;
  if (companyScopeValid && input.candidate.route === "agent") {
    const eligible = companyAgents.filter((candidate) =>
      candidate.id !== binding.agentId
      && getAgentWorkEligibility({ agent: candidate, agents: companyAgents }).invokable
    );
    const requested = eligible.find((candidate) => candidate.id === input.candidate.targetAgentId);
    resolvedTargetAgentId = requested?.id ?? eligible[0]?.id ?? null;
  }

  const facts: NativeAttentionFacts = {
    companyScopeValid,
    responseState: input.candidate.responseState ?? "none",
    route: input.candidate.route === "agent" && !resolvedTargetAgentId
      ? "recovery"
      : input.candidate.route,
    summary: input.candidate.summary,
    budgetExhausted: input.candidate.budgetExhausted,
    governanceGate: input.candidate.governanceGate,
    resolvedTargetAgentId,
  };
  const decision = resolveNativeAttentionStatus({
    facts,
    priorIssueStatus: binding.issueStatus as NativeAuthoritativeIssueStatus,
    agentId: binding.agentId,
  });
  const auditOnly = decision.reasonCode === "attention_duplicate_suppressed";
  if (auditOnly) {
    const targets = await applyNativeAttentionStatusDecision({
      db: input.db,
      companyId: binding.companyId,
      issueId: binding.issueId,
      runId: input.runId,
      decision,
      targetInteractionId: input.candidate.targetInteractionId,
      canonicalRequestId: input.candidate.canonicalRequestId,
    });
    return { decision, decisionId: null, targets, resolvedTargetAgentId };
  }
  const assessmentId = input.assessmentId ?? binding.assessmentId;
  if (!assessmentId) {
    throw new NativeInteractionBridgeError(
      "native_attention_assessment_missing",
      "Native attention requires the server-owned work assessment for this result",
    );
  }
  const committed = await commitNativeStatusDecision({
    db: input.db,
    companyId: binding.companyId,
    issueId: binding.issueId,
    runId: input.runId,
    assessmentId,
    priorStatus: binding.issueStatus,
    priorStatusVersion: Number(binding.issueStatusVersion),
    priorDecisionId: binding.issueDecisionId,
    decision,
    supersedesCommittedDecisionId: input.supersedesCommittedDecisionId,
  });
  return {
    decision,
    decisionId: committed.decision.id,
    targets: [],
    resolvedTargetAgentId,
  };
}

/** Server-owned attention resolution from canonical routing facts. */
export function resolveNativeAttentionStatus(input: {
  facts: NativeAttentionFacts;
  priorIssueStatus: NativeAuthoritativeIssueStatus;
  agentId: string;
}): NativeStatusDecision {
  const preserve = (reasonCode: string, effects: NativeStatusEffect[]): NativeStatusDecision => ({
    policyVersion: NATIVE_STATUS_ARBITER_POLICY_VERSION,
    statusAction: "preserve",
    toStatus: input.priorIssueStatus,
    reasonCode,
    unblockDescriptor: null,
    effects,
  });
  const continuation = (reasonCode: string): NativeStatusDecision => ({
    policyVersion: NATIVE_STATUS_ARBITER_POLICY_VERSION,
    statusAction: "in_progress",
    toStatus: "in_progress",
    reasonCode,
    unblockDescriptor: null,
    effects: [{
      kind: "enqueue_continuation",
      continuationKind: input.facts.route === "agent" ? "response_wake" : "same_agent",
      summary: input.facts.summary,
      idempotencyKey: `native-attention:${input.facts.route}:${input.facts.summary}`,
      agentId: input.agentId,
    }],
  });

  if (!input.facts.companyScopeValid) {
    return preserve("result_schema_rejected", [{
      kind: "record_finalization_error",
      cause: "result_schema_rejected",
      nextAction: "Remove the cross-company attention target.",
      agentId: input.agentId,
    }]);
  }
  if (input.facts.responseState === "stale") {
    return preserve("attention_duplicate_suppressed", [{ kind: "record_stale_response" }]);
  }
  if (input.facts.responseState === "expired") {
    return preserve("attention_budget_exhausted", [{ kind: "record_expiry" }]);
  }
  if (input.facts.budgetExhausted || input.facts.route === "recovery") {
    return preserve("attention_budget_exhausted", [{
      kind: "record_finalization_error",
      cause: "attention_budget_exhausted",
      nextAction: "Assign a named recovery owner.",
      agentId: input.agentId,
    }]);
  }
  if (input.facts.route === "duplicate") {
    return preserve("attention_duplicate_suppressed", [{ kind: "link_canonical_request" }]);
  }
  if (input.facts.governanceGate) {
    return {
      policyVersion: NATIVE_STATUS_ARBITER_POLICY_VERSION,
      statusAction: "in_review",
      toStatus: "in_review",
      reasonCode: "governed_gate_pending",
      unblockDescriptor: null,
      effects: [
        { kind: "create_interaction", gate: input.facts.governanceGate },
        { kind: "notify_owner", agentId: input.agentId, reason: "governed_gate_pending" },
      ],
    };
  }
  if (input.facts.route === "alternate_track") {
    return continuation("turn_waiting_other_track_live");
  }
  if (input.facts.route === "context" || input.facts.route === "retry") {
    return continuation("attention_resolved_from_context");
  }
  if (input.facts.route === "agent") {
    if (!input.facts.resolvedTargetAgentId) {
      return preserve("attention_budget_exhausted", [{
        kind: "record_finalization_error",
        cause: "attention_no_valid_route",
        nextAction: "Assign a same-company eligible delegate.",
        agentId: input.agentId,
      }]);
    }
    const decision = continuation("attention_routed_to_agent");
    return {
      ...decision,
      effects: [
        { kind: "create_delegated_issue", agentId: input.facts.resolvedTargetAgentId, summary: input.facts.summary },
        ...decision.effects,
      ],
    };
  }
  if (input.facts.route === "human") {
    return {
      policyVersion: NATIVE_STATUS_ARBITER_POLICY_VERSION,
      statusAction: "in_review",
      toStatus: "in_review",
      reasonCode: "attention_requires_human_authority",
      unblockDescriptor: null,
      effects: [
        { kind: "create_interaction", prompt: input.facts.summary },
        { kind: "notify_owner", agentId: input.agentId, reason: "attention_requires_human_authority" },
      ],
    };
  }
  throw new NativeInteractionBridgeError("native_attention_facts_invalid", "Attention facts do not select a route");
}
