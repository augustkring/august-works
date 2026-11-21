import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { agentWakeupRequests, heartbeatRuns, statusDecisionEffects, statusDecisions, type Db } from "@paperclipai/db";
import type { AuthorizationActor } from "../authorization.js";
import type { NativeFinalizedContinuationSummaryCapture } from "../execution-continuation.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * APR-E2E-23b (work in progress, not yet wired). Server-captured owner of one
 * status-decision continuation wake: the same-agent continuation the status
 * arbiter enqueues when a Run claims done without enough evidence
 * (`completion_evidence_incomplete`). It binds the continuation Run to:
 * - the applied decision with that reason, on this Task, made for its source Run;
 * - that decision's `enqueue_continuation` effect, which targets the intent wake;
 * - the intent wake (`native-status:<decisionId>:continuation`) and its exact
 *   payload, including the continuation summary the effect carries;
 * - the dispatcher's delivered wake for this Run
 *   (`native-status-wake-dispatch:<intentId>`);
 * - the source Run's sealed finalized summary (never the unsealed continuation
 *   summary document), which is the continuation's completed work.
 * It grants no authority of its own.
 */
export type NativeStatusContinuationTrigger = {
  version: 1;
  companyId: string;
  issueId: string;
  runId: string;
  agentId: string;
  responsibleUserId: string;
  wakeupRequestId: string;
  decisionId: string;
  effectId: string;
  intentId: string;
  sourceRunId: string;
  continuationKind: "same_agent";
  continuationSummary: string;
  continuationIdempotencyKey: string;
};

export const NATIVE_STATUS_CONTINUATION_REASON = "issue_status_changed";
export const NATIVE_STATUS_CONTINUATION_DECISION_REASON = "completion_evidence_incomplete";

export type NativeStatusContinuationDiagnostic =
  | "receiver_unavailable" | "receiver_context_invalid" | "delivered_wake_invalid" | "intent_invalid"
  | "effect_invalid" | "decision_invalid" | "source_invalid" | "sealed_summary_missing";

const TRIGGER_KEYS = ["agentId", "companyId", "continuationIdempotencyKey", "continuationKind", "continuationSummary",
  "decisionId", "effectId", "intentId", "issueId", "responsibleUserId", "runId", "sourceRunId", "version",
  "wakeupRequestId"].join(",");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function nativeStatusContinuationIdempotencyKey(decisionId: string) {
  return `native-status:${decisionId}:continuation`;
}

/** Closed shape and binding check, independent of the database read. */
export function exactNativeStatusContinuationTrigger(value: unknown, binding: { companyId: string; issueId: string;
  runId: string; agentId?: string; responsibleUserId?: string | null; wakeupRequestId?: string | null;
  wakeReason: string | null }): value is NativeStatusContinuationTrigger {
  const trigger = record(value);
  if (!trigger || Object.keys(trigger).sort().join(",") !== TRIGGER_KEYS) return false;
  return trigger.version === 1 && binding.wakeReason === NATIVE_STATUS_CONTINUATION_REASON &&
    trigger.companyId === binding.companyId && trigger.issueId === binding.issueId && trigger.runId === binding.runId &&
    trigger.agentId === binding.agentId && trigger.responsibleUserId === binding.responsibleUserId &&
    trigger.wakeupRequestId === binding.wakeupRequestId &&
    [trigger.companyId, trigger.issueId, trigger.runId, trigger.agentId, trigger.wakeupRequestId, trigger.decisionId,
      trigger.effectId, trigger.intentId, trigger.sourceRunId].every(id => typeof id === "string" && UUID.test(id)) &&
    trigger.sourceRunId !== trigger.runId && trigger.intentId !== trigger.wakeupRequestId &&
    typeof trigger.responsibleUserId === "string" && trigger.responsibleUserId.length > 0 &&
    trigger.continuationKind === "same_agent" &&
    typeof trigger.continuationSummary === "string" && trigger.continuationSummary.trim().length > 0 &&
    Buffer.byteLength(trigger.continuationSummary, "utf8") <= 4_000 &&
    typeof trigger.continuationIdempotencyKey === "string" && trigger.continuationIdempotencyKey.length > 0;
}

/**
 * Read the owner of a status-decision continuation Run. Every value comes from
 * persisted rows; none is taken from the wake payload being qualified. Returns
 * null (with a diagnostic) when any binding does not hold, including when the
 * source Run has no sealed finalized summary: there is no fallback to the
 * unsealed continuation summary document.
 */
export async function captureNativeStatusContinuationTrigger(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; reader: AuthorizationActor;
  onDiagnostic?: (reason: NativeStatusContinuationDiagnostic) => void;
}): Promise<{ trigger: NativeStatusContinuationTrigger; summary: NativeFinalizedContinuationSummaryCapture } | null> {
  const reject = (reason: NativeStatusContinuationDiagnostic) => { input.onDiagnostic?.(reason); return null; };
  const [receiver] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.id, input.runId))).limit(1);
  const receiverRuntime = receiver && (receiver.runtimeMode === "native" ? receiver.nativeIssueId === input.issueId
    : receiver.runtimeMode === "legacy" && receiver.runtimeModeResolvedAt === null && receiver.nativeIssueId === null);
  if (!receiver || !receiverRuntime || !receiver.wakeupRequestId || !receiver.responsibleUserId) return reject("receiver_unavailable");
  const context = record(receiver.contextSnapshot);
  const intentId = context?.nativeStatusWakeIntentId;
  if (!context || context.issueId !== input.issueId || context.taskId !== input.issueId ||
    context.statusDecisionSource !== "native_status_decision" || context.source !== "native_status_decision" ||
    typeof intentId !== "string" || !UUID.test(intentId)) return reject("receiver_context_invalid");

  const [delivered] = await db.select().from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.companyId, input.companyId), eq(agentWakeupRequests.id, receiver.wakeupRequestId),
    eq(agentWakeupRequests.agentId, receiver.agentId), eq(agentWakeupRequests.runId, receiver.id))).limit(1);
  if (!delivered || delivered.requestedByActorType !== "system" ||
    delivered.requestedByActorId !== `native-status-wake-dispatch:${intentId}` ||
    !["claimed", "completed"].includes(delivered.status)) return reject("delivered_wake_invalid");

  const [intent] = await db.select().from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.companyId, input.companyId), eq(agentWakeupRequests.id, intentId),
    eq(agentWakeupRequests.agentId, receiver.agentId))).limit(1);
  const intentPayload = record(intent?.payload);
  const decisionId = intentPayload?.nativeDecisionId;
  if (!intent || intent.source !== "automation" || intent.triggerDetail !== "system" ||
    intent.reason !== NATIVE_STATUS_CONTINUATION_REASON || intent.requestedByActorType !== "system" ||
    intent.requestedByActorId !== "native-status-committer" || typeof decisionId !== "string" || !UUID.test(decisionId) ||
    intent.idempotencyKey !== nativeStatusContinuationIdempotencyKey(decisionId) ||
    (intent.runId !== null && intent.runId !== receiver.id)) return reject("intent_invalid");
  const { _paperclipWakeContext: intentContext, ...payload } = intentPayload!;
  const summary = payload.continuationSummary;
  const idempotencyKey = payload.continuationIdempotencyKey;
  if (!isDeepStrictEqual(Object.keys(payload).sort(), ["continuationIdempotencyKey", "continuationKind",
      "continuationSummary", "issueId", "nativeDecisionId", "taskId"]) ||
    payload.issueId !== input.issueId || payload.taskId !== input.issueId || payload.continuationKind !== "same_agent" ||
    typeof summary !== "string" || typeof idempotencyKey !== "string" ||
    record(intentContext)?.wakeReason !== NATIVE_STATUS_CONTINUATION_REASON ||
    record(intentContext)?.statusDecisionSource !== "native_status_decision") return reject("intent_invalid");

  const [effect] = await db.select().from(statusDecisionEffects).where(and(
    eq(statusDecisionEffects.companyId, input.companyId), eq(statusDecisionEffects.issueId, input.issueId),
    eq(statusDecisionEffects.decisionId, decisionId), eq(statusDecisionEffects.effectKind, "enqueue_continuation"),
    eq(statusDecisionEffects.targetType, "agent_wakeup_request"), eq(statusDecisionEffects.targetId, intent.id))).limit(1);
  if (!effect || !isDeepStrictEqual(effect.payload, { continuationKind: "same_agent", summary })) return reject("effect_invalid");

  const [decision] = await db.select().from(statusDecisions).where(and(
    eq(statusDecisions.companyId, input.companyId), eq(statusDecisions.issueId, input.issueId),
    eq(statusDecisions.id, decisionId))).limit(1);
  if (!decision || decision.applicationState !== "applied" ||
    decision.reasonCode !== NATIVE_STATUS_CONTINUATION_DECISION_REASON || decision.toStatus !== "in_progress" ||
    decision.runId === receiver.id) return reject("decision_invalid");

  const [source] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.id, decision.runId))).limit(1);
  if (!source || source.agentId !== receiver.agentId || source.runtimeMode !== "native" ||
    source.nativeIssueId !== input.issueId || source.responsibleUserId !== receiver.responsibleUserId ||
    source.status !== "succeeded" || source.createdAt.getTime() > receiver.createdAt.getTime()) return reject("source_invalid");

  const { captureNativeFinalizedContinuationSummary } = await import("../execution-continuation.js");
  const sealed = await captureNativeFinalizedContinuationSummary({ db, companyId: input.companyId, issueId: input.issueId,
    agentId: receiver.agentId, receiverRunId: receiver.id, sourceRunId: source.id, reader: input.reader });
  if (!sealed || sealed.sourceRunId !== source.id) return reject("sealed_summary_missing");

  const trigger: NativeStatusContinuationTrigger = { version: 1, companyId: input.companyId, issueId: input.issueId,
    runId: receiver.id, agentId: receiver.agentId, responsibleUserId: receiver.responsibleUserId,
    wakeupRequestId: receiver.wakeupRequestId, decisionId, effectId: effect.id, intentId: intent.id, sourceRunId: source.id,
    continuationKind: "same_agent", continuationSummary: summary, continuationIdempotencyKey: idempotencyKey };
  return exactNativeStatusContinuationTrigger(trigger, { companyId: input.companyId, issueId: input.issueId,
    runId: receiver.id, agentId: receiver.agentId, responsibleUserId: receiver.responsibleUserId,
    wakeupRequestId: receiver.wakeupRequestId, wakeReason: NATIVE_STATUS_CONTINUATION_REASON })
    ? { trigger, summary: sealed } : reject("intent_invalid");
}
