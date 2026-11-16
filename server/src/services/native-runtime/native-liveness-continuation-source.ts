import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { agentWakeupRequests, heartbeatRuns, type Db } from "@paperclipai/db";
import {
  DEFAULT_MAX_LIVENESS_CONTINUATION_ATTEMPTS,
  DEFAULT_RUN_LIVENESS_CONTINUATION_INSTRUCTION,
  RUN_LIVENESS_CONTINUATION_REASON,
  buildRunLivenessContinuationIdempotencyKey,
} from "../recovery/run-liveness-continuations.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Server-captured witness for one bounded run-liveness continuation wake. It
 * binds the continuation Run to its source Run (same company, Agent, Task,
 * responsible Human and session) and to the bounded continuation record the
 * heartbeat wrote: the source Run's liveness classification and attempt
 * counter, the wake request with its idempotency key and exact payload, and
 * the continuation Run's context. It grants no authority of its own.
 */
export type NativeRunLivenessContinuationTrigger = {
  version: 1;
  companyId: string;
  issueId: string;
  runId: string;
  agentId: string;
  responsibleUserId: string;
  wakeupRequestId: string;
  sourceRunId: string;
  sourceSessionId: string;
  state: "plan_only" | "empty_response";
  reason: string | null;
  instruction: string;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string;
};

export type NativeRunLivenessContinuationDiagnostic =
  | "receiver_unavailable" | "receiver_context_invalid" | "wake_unavailable" | "wake_invalid"
  | "source_unavailable" | "source_binding_invalid" | "source_state_invalid" | "session_binding_invalid";

const NATIVE_RUN_LIVENESS_TRIGGER_KEYS = ["agentId", "attempt", "companyId", "idempotencyKey", "instruction", "issueId",
  "maxAttempts", "reason", "responsibleUserId", "runId", "sourceRunId", "sourceSessionId", "state", "version",
  "wakeupRequestId"].join(",");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The exact `livenessContinuation` wake projection the heartbeat renders. */
export function nativeRunLivenessContinuationProjection(trigger: NativeRunLivenessContinuationTrigger) {
  return { attempt: trigger.attempt, maxAttempts: trigger.maxAttempts, sourceRunId: trigger.sourceRunId,
    state: trigger.state, reason: trigger.reason, instruction: trigger.instruction };
}

/** Closed shape and binding check, independent of the database read. */
export function exactNativeRunLivenessContinuationTrigger(value: unknown, binding: { companyId: string; issueId: string;
  runId: string; agentId?: string; responsibleUserId?: string | null; wakeupRequestId?: string | null;
  wakeReason: string | null }): value is NativeRunLivenessContinuationTrigger {
  const trigger = record(value);
  if (!trigger || Object.keys(trigger).sort().join(",") !== NATIVE_RUN_LIVENESS_TRIGGER_KEYS) return false;
  return trigger.version === 1 && binding.wakeReason === RUN_LIVENESS_CONTINUATION_REASON &&
    trigger.companyId === binding.companyId && trigger.issueId === binding.issueId && trigger.runId === binding.runId &&
    trigger.agentId === binding.agentId && trigger.responsibleUserId === binding.responsibleUserId &&
    trigger.wakeupRequestId === binding.wakeupRequestId &&
    [trigger.companyId, trigger.issueId, trigger.runId, trigger.agentId, trigger.wakeupRequestId, trigger.sourceRunId]
      .every(id => typeof id === "string" && UUID.test(id)) &&
    trigger.sourceRunId !== trigger.runId &&
    typeof trigger.responsibleUserId === "string" && trigger.responsibleUserId.length > 0 &&
    typeof trigger.sourceSessionId === "string" && trigger.sourceSessionId.length > 0 &&
    (trigger.state === "plan_only" || trigger.state === "empty_response") &&
    (trigger.reason === null || typeof trigger.reason === "string" && trigger.reason.length > 0) &&
    typeof trigger.instruction === "string" && trigger.instruction.trim().length > 0 &&
    Buffer.byteLength(trigger.instruction, "utf8") <= 64_000 &&
    trigger.maxAttempts === DEFAULT_MAX_LIVENESS_CONTINUATION_ATTEMPTS &&
    Number.isSafeInteger(trigger.attempt) && (trigger.attempt as number) >= 1 &&
    (trigger.attempt as number) <= DEFAULT_MAX_LIVENESS_CONTINUATION_ATTEMPTS &&
    trigger.idempotencyKey === buildRunLivenessContinuationIdempotencyKey({ issueId: binding.issueId,
      sourceRunId: trigger.sourceRunId as string, livenessState: trigger.state, nextAttempt: trigger.attempt as number });
}

/**
 * Read the bounded continuation record for a `run_liveness_continuation` Run.
 * Every value comes from persisted server rows; none is taken from the wake
 * payload being qualified. Returns null when any binding does not hold.
 */
export async function captureNativeRunLivenessContinuationTrigger(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string;
  onDiagnostic?: (reason: NativeRunLivenessContinuationDiagnostic) => void;
}): Promise<NativeRunLivenessContinuationTrigger | null> {
  const reject = (reason: NativeRunLivenessContinuationDiagnostic) => { input.onDiagnostic?.(reason); return null; };
  const [receiver] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.id, input.runId))).limit(1);
  // An automatic continuation is still an unresolved legacy row while its
  // Native input is being prepared; once resolved it is this Task's Native Run.
  const receiverRuntime = receiver && (receiver.runtimeMode === "native" ? receiver.nativeIssueId === input.issueId
    : receiver.runtimeMode === "legacy" && receiver.runtimeModeResolvedAt === null && receiver.nativeIssueId === null);
  if (!receiver || !receiverRuntime || !receiver.wakeupRequestId || !receiver.responsibleUserId) return reject("receiver_unavailable");
  const context = record(receiver.contextSnapshot);
  const sourceRunId = context?.livenessContinuationSourceRunId;
  const state = context?.livenessContinuationState;
  const attempt = context?.livenessContinuationAttempt;
  const maxAttempts = context?.livenessContinuationMaxAttempts;
  const instruction = context?.livenessContinuationInstruction;
  const reason = context?.livenessContinuationReason ?? null;
  if (!context || context.wakeReason !== RUN_LIVENESS_CONTINUATION_REASON || context.issueId !== input.issueId ||
    context.taskId !== input.issueId || typeof sourceRunId !== "string" || !UUID.test(sourceRunId) ||
    context.parentRunId !== sourceRunId || (state !== "plan_only" && state !== "empty_response") ||
    typeof attempt !== "number" || typeof maxAttempts !== "number" || typeof instruction !== "string" ||
    !(reason === null || typeof reason === "string")) return reject("receiver_context_invalid");

  const [wake] = await db.select().from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.companyId, input.companyId), eq(agentWakeupRequests.id, receiver.wakeupRequestId),
    eq(agentWakeupRequests.agentId, receiver.agentId), eq(agentWakeupRequests.runId, receiver.id))).limit(1);
  if (!wake) return reject("wake_unavailable");
  const expectedPayload = { issueId: input.issueId, sourceRunId, livenessState: state, livenessReason: reason,
    continuationAttempt: attempt, maxContinuationAttempts: maxAttempts, instruction };
  // A wake deferred behind the source Run's issue execution also carries the
  // heartbeat's own deferral fields; its saved context must name the same record.
  const { _paperclipWakeContext: deferredContext, executionWait, ...wakePayload } = record(wake.payload) ?? {};
  const deferred = record(deferredContext);
  const deferredMatches = deferredContext === undefined ? executionWait === undefined : Boolean(deferred &&
    ["wakeReason", "issueId", "parentRunId", "livenessContinuationSourceRunId", "livenessContinuationState",
      "livenessContinuationAttempt", "livenessContinuationMaxAttempts", "livenessContinuationInstruction"]
      .every(key => isDeepStrictEqual(deferred[key], context[key])) &&
    isDeepStrictEqual(deferred.livenessContinuationReason ?? null, reason));
  if (wake.source !== "automation" || wake.triggerDetail !== "system" || wake.reason !== RUN_LIVENESS_CONTINUATION_REASON ||
    wake.requestedByActorType !== "system" || wake.requestedByActorId !== "heartbeat" ||
    wake.idempotencyKey !== buildRunLivenessContinuationIdempotencyKey({ issueId: input.issueId, sourceRunId,
      livenessState: state, nextAttempt: attempt }) ||
    !deferredMatches || !isDeepStrictEqual(wakePayload, expectedPayload)) return reject("wake_invalid");

  const [source] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.id, sourceRunId))).limit(1);
  if (!source) return reject("source_unavailable");
  if (source.agentId !== receiver.agentId || source.runtimeMode !== "native" || source.nativeIssueId !== input.issueId ||
    source.responsibleUserId !== receiver.responsibleUserId || source.createdAt.getTime() > receiver.createdAt.getTime())
    return reject("source_binding_invalid");
  if (source.status !== "succeeded" || source.livenessState !== state || (source.livenessReason ?? null) !== reason ||
    source.continuationAttempt !== attempt ||
    (source.nextAction ?? DEFAULT_RUN_LIVENESS_CONTINUATION_INSTRUCTION) !== instruction) return reject("source_state_invalid");
  if (!source.sessionIdAfter || receiver.sessionIdBefore !== source.sessionIdAfter) return reject("session_binding_invalid");

  const trigger: NativeRunLivenessContinuationTrigger = { version: 1, companyId: input.companyId, issueId: input.issueId,
    runId: receiver.id, agentId: receiver.agentId, responsibleUserId: receiver.responsibleUserId,
    wakeupRequestId: receiver.wakeupRequestId, sourceRunId, sourceSessionId: source.sessionIdAfter, state,
    reason, instruction, attempt, maxAttempts,
    idempotencyKey: wake.idempotencyKey };
  return exactNativeRunLivenessContinuationTrigger(trigger, { companyId: input.companyId, issueId: input.issueId,
    runId: receiver.id, agentId: receiver.agentId, responsibleUserId: receiver.responsibleUserId,
    wakeupRequestId: receiver.wakeupRequestId, wakeReason: RUN_LIVENESS_CONTINUATION_REASON })
    ? trigger : reject("source_state_invalid");
}
