import { isDeepStrictEqual } from "node:util";
import type { NativePayloadSourceInput } from "@paperclipai/shared";
import type { NativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import type { NativeTaskContinuationCapture } from "../execution-continuation.js";
import { buildNativeContinuationPrompt } from "./native-continuation.js";
import { exactNativeOrdinaryPlanContext, type NativeOrdinaryPlanReadCapture } from "./native-execution-input.js";

type RetainedRunSource = Extract<NativePayloadSourceInput, { kind: "retained_run" }>;

/** The retained Run row the bootstrap's verified retained-resume witness
 * (`nativeRetainedRunResumeWitness`) was computed from. */
export type NativeCompactContinuationRetainedRun = {
  id: string; companyId: string; agentId: string; nativeIssueId: string | null;
  contextSnapshot: unknown; runnerProfileJson: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * CONF15-W9: the only compact OpenCode continuation a Native bootstrap source
 * closure may qualify. Every other `continuationPrompt` stays an unsupported
 * closure input.
 *
 * The compact turn never reaches the provider under a closure: the managed
 * OpenCode executor replaces it with the full current v2 envelope
 * (`canonicalManagedOpenCodeContinuationTurn`), and dispatch accepts a closure
 * only for that full envelope (`nativeTurnFrameMatchesSourceClosure` refuses a
 * `continuation` turn). The compact prompt must still be exactly what the
 * server derives from records of this Task and the retained Run, because the
 * replacement binds the runner's compact turn to it byte for byte.
 *
 * It is admitted only when all hold:
 * - the execution is an OpenCode v4 input resuming exactly one retained
 *   Run through the verified retained-resume witness (`retainedSource`, and the
 *   very row it was computed from), on the same company, Agent and Task;
 * - the current wake is qualified by the closure and its continuation is the
 *   closure-verified capture, bound to that same retained-run source;
 * - re-derived here from the retained Run's own records: its delivered
 *   envelope is the capture's previous context, and the resume delta is
 *   exactly the current messages that envelope did not deliver (or that the
 *   wake names), based on that Run;
 * - the prompt equals the server producer's output for the closure-verified
 *   wake, the retained Run's id and persisted Task, and the current Task;
 * - its events hold only that delta, a title/description change between the
 *   retained Run's persisted Task and the current one, and the plan revision of
 *   an inert ordinary plan context (no thread, comment or interaction) bound to
 *   the closure's own plan read. Interaction answers, child results, blocker
 *   ids and external chat keep the full framing (unsupported here).
 *
 * Returns the qualified prompt, or null.
 */
export function qualifyNativeRetainedCompactContinuation(input: {
  execution: NativeExecutionInput;
  retainedSource: RetainedRunSource | null;
  retainedRun: NativeCompactContinuationRetainedRun | null;
  capture: NativeTaskContinuationCapture | null;
  wakeSource: Extract<NativePayloadSourceInput, { kind: "native_task_wake" }> | null;
  wakePayload: unknown;
  ordinaryPlanRead: NativeOrdinaryPlanReadCapture | null;
}): string | null {
  const { execution, retainedSource, retainedRun, capture, wakeSource } = input;
  if (execution.schema !== "paperclip.native-execution-input.v4" || execution.provider.kind !== "opencode" ||
    !("continuationPrompt" in execution) || typeof execution.continuationPrompt !== "string" ||
    execution.continuationPrompt.length === 0) return null;
  const prompt = execution.continuationPrompt;
  const binding = execution.binding;
  // One verified retained Run of this company, Agent and Task, never the
  // current Run itself.
  if (!retainedSource || retainedSource.kind !== "retained_run" || !retainedRun ||
    retainedRun.id !== retainedSource.runId || retainedRun.id === binding.runId ||
    retainedRun.companyId !== binding.companyId || retainedRun.agentId !== binding.agentId ||
    retainedRun.nativeIssueId !== binding.issueId || record(retainedRun.contextSnapshot).issueId !== binding.issueId) return null;
  let retainedExecution: NativeExecutionInput;
  try { retainedExecution = parseNativeExecutionInput(record(retainedRun.runnerProfileJson).nativeExecutionInput); }
  catch { return null; }
  if (retainedExecution.binding.runId !== retainedRun.id || retainedExecution.binding.companyId !== binding.companyId ||
    retainedExecution.binding.agentId !== binding.agentId || retainedExecution.binding.issueId !== binding.issueId ||
    retainedExecution.provider.kind !== "opencode") return null;
  // The closure-qualified wake and its closure-verified continuation, bound to
  // this retained-run source.
  if (!wakeSource || wakeSource.kind !== "native_task_wake" || wakeSource.runId !== binding.runId ||
    wakeSource.issueId !== binding.issueId) return null;
  if (!capture || capture.companyId !== binding.companyId || capture.issueId !== binding.issueId ||
    capture.runId !== binding.runId || capture.agentId !== binding.agentId ||
    !isDeepStrictEqual(capture.retainedSource, retainedSource) || capture.acceptedPlanReview !== undefined) return null;
  const wake = record(input.wakePayload);
  if (!isDeepStrictEqual(wake.executionContinuation, capture.envelope) ||
    (wake.externalChatProvider !== null && wake.externalChatProvider !== undefined)) return null;
  // Re-derive the delta from the retained Run's own delivered envelope.
  const delivered = record(record(retainedRun.contextSnapshot).executionContinuation).messages;
  const envelope = capture.envelope;
  const delta = envelope.resumeDelta;
  if (!Array.isArray(delivered) || delivered.length > 256 || !capture.previousContext ||
    capture.previousContext.runId !== retainedRun.id || !isDeepStrictEqual(capture.previousContext.messages, delivered) ||
    !delta || delta.baseRunId !== retainedRun.id || !Array.isArray(envelope.messages) ||
    !Array.isArray(envelope.originCommentIds)) return null;
  const deliveredMessages = delivered.map(record);
  const expectedDelta = envelope.messages.filter(message => envelope.originCommentIds.includes(message.id) ||
    !deliveredMessages.some(prior => prior.id === message.id && prior.updatedAt === message.updatedAt &&
      prior.body === message.body && prior.deleted === message.deleted && prior.authorId === message.authorId &&
      (prior.createdByRunId ?? null) === (message.createdByRunId ?? null) &&
      isDeepStrictEqual(prior.sourceTrust, message.sourceTrust)));
  if (!isDeepStrictEqual(delta.messages, expectedDelta)) return null;
  // The producer's own output for exactly these records.
  const previousIssue = { title: retainedExecution.task.title, description: retainedExecution.task.description };
  const issue = { title: execution.task.title, description: execution.task.description };
  if (buildNativeContinuationPrompt({ wakePayload: input.wakePayload, previousRunId: retainedRun.id,
    previousIssue, issue, allowExternalChat: true }) !== prompt) return null;
  // Only the delta, a Task change and an inert plan revision.
  const planContext = wake.planReviewContext;
  let planRevision: { documentKey: "plan"; latestRevisionId: string; latestRevisionNumber: number } | null = null;
  if (planContext !== null && planContext !== undefined) {
    const plan = input.ordinaryPlanRead;
    if (!plan || !exactNativeOrdinaryPlanContext({ companyId: binding.companyId, issueId: binding.issueId,
      runId: binding.runId, agentId: binding.agentId, responsibleUserId: capture.responsibleUserId,
      wakeupRequestId: capture.wakeupRequestId, capture: plan, value: planContext })) return null;
    planRevision = { documentKey: "plan", latestRevisionId: plan.source.revisionId, latestRevisionNumber: plan.revisionNumber };
  }
  const taskChanges = Object.fromEntries((["title", "description"] as const)
    .filter(key => issue[key] !== previousIssue[key]).map(key => [key, issue[key]]));
  let events: unknown;
  try { events = JSON.parse(prompt); } catch { return null; }
  return isDeepStrictEqual(events, { messages: expectedDelta,
    ...(Object.keys(taskChanges).length ? { taskChanges } : {}),
    ...(planRevision ? { planRevision } : {}) }) ? prompt : null;
}

/** A bootstrap set carrying a qualified compact continuation names exactly the
 * one retained Run the continuation was qualified for. */
export function nativeCompactContinuationSourceSetAdmits(input: {
  retainedSource: RetainedRunSource;
  inputs: readonly NativePayloadSourceInput[];
}): boolean {
  const retained = input.inputs.filter(source => source.kind === "retained_run");
  return retained.length === 1 && isDeepStrictEqual(retained[0], input.retainedSource);
}
