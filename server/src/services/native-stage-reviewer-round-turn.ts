import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { activityLog, heartbeatRuns, issueExecutionDecisions, issues, statusDecisions, type Db } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema, type NativePayloadSourceTransform } from "@paperclipai/shared";
import { parseIssueExecutionState } from "./issue-execution-policy.js";
import type { AuthorizationActor } from "./authorization.js";
import type { NativeBoardStageReturnTransform } from "./native-board-stage-return-source.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type ExecutionState = NonNullable<ReturnType<typeof parseIssueExecutionState>>;

/**
 * MS1f (historical stage-wake owner). A stage Reviewer turn that recorded no
 * stage decision and was then returned by the board. Its stage wake can no
 * longer be rebuilt from the current Task; this proof carries the pending
 * state recorded at that turn instead, for parent-receipt walks only.
 */
export type NativeStageReviewerRoundTurn = {
  version: 1; companyId: string; issueId: string; runId: string; agentId: string; responsibleUserId: string;
  fromState: ExecutionState; decisionId: string; executorRunId: string; executorAgentId: string;
  boardActivityId: string; boardTransitionId: string; resultId: string;
};

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * The admission rules, without database reads. The Reviewer turn qualifies
 * only when: it recorded no stage decision; its stage origin and Run are in
 * the board return's round (stage, stage-pending decision, executor); the
 * board step names this Reviewer, stage and decision; the Reviewer's own saved
 * Task capture is an exact prefix of the Task history and the board step comes
 * right after it (no intervening transform); the capture ends with this
 * round's stage-entry step, whose recorded pending state (its own turn's
 * state) equals the board step's recorded from-state exactly.
 */
export function nativeStageReviewerRoundTurnState(input: {
  reviewer: { runId: string; agentId: string; contextStageId: unknown };
  hasRecordedStageDecision: boolean;
  origin: { decisionId: string; executorRunId: string; executorAgentId: string } | null;
  roundReviewerRunIds: readonly string[] | null;
  boardStep: NativeBoardStageReturnTransform | null;
  boardFromState: unknown;
  captureSteps: readonly NativePayloadSourceTransform[];
  currentSteps: readonly NativePayloadSourceTransform[];
  stageEntryReceipt: { toExecutionState: unknown } | null;
}): ExecutionState | null {
  const { reviewer, origin, boardStep } = input;
  if (input.hasRecordedStageDecision || !origin || !boardStep || !input.roundReviewerRunIds?.includes(reviewer.runId) ||
    typeof reviewer.contextStageId !== "string") return null;
  if (boardStep.decisionId !== origin.decisionId || boardStep.executorAgentId !== origin.executorAgentId ||
    boardStep.participantAgentId !== reviewer.agentId || boardStep.stageId !== reviewer.contextStageId) return null;
  const n = input.captureSteps.length;
  if (input.currentSteps.length <= n || !isDeepStrictEqual(input.currentSteps.slice(0, n), input.captureSteps) ||
    !isDeepStrictEqual(input.currentSteps[n], boardStep)) return null;
  const entry = input.captureSteps.at(-1);
  if (!entry || entry.kind !== "native_stage_policy" || entry.decisionId !== origin.decisionId ||
    entry.runId !== origin.executorRunId || !input.stageEntryReceipt) return null;
  if (!isDeepStrictEqual(input.stageEntryReceipt.toExecutionState, input.boardFromState)) return null;
  const state = parseIssueExecutionState(input.boardFromState);
  if (!state || state.status !== "pending" || state.currentStageId !== reviewer.contextStageId ||
    state.currentParticipant?.type !== "agent" || state.currentParticipant.agentId !== reviewer.agentId) return null;
  return state;
}

/** Read the proof for one finished stage Reviewer Run from the database. */
export async function captureNativeStageReviewerRoundTurn(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; reader: AuthorizationActor;
}): Promise<NativeStageReviewerRoundTurn | null> {
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.nativeIssueId, input.issueId), eq(heartbeatRuns.runtimeMode, "native")))
    .limit(1).for("share");
  const context = record(run?.contextSnapshot);
  if (!run || !run.agentId || !run.responsibleUserId || !run.finishedAt ||
    !["succeeded", "failed", "timed_out", "cancelled"].includes(run.status) || context?.source !== "issue.execution_stage") return null;
  const contextStageId = record(context.executionStage)?.stageId;
  const [decided] = await db.select({ id: issueExecutionDecisions.id }).from(issueExecutionDecisions).where(and(
    eq(issueExecutionDecisions.companyId, input.companyId), eq(issueExecutionDecisions.issueId, input.issueId),
    eq(issueExecutionDecisions.createdByRunId, run.id))).limit(1);
  const { captureNativeStageOrigin } = await import("./native-stage-wake-source.js");
  const origin = await captureNativeStageOrigin(db, run);
  const { captureNativeAcceptedFinalizedSummaryOwner } = await import("./execution-continuation.js");
  const accepted = await captureNativeAcceptedFinalizedSummaryOwner({ db, companyId: input.companyId, issueId: input.issueId,
    agentId: run.agentId, sourceRunId: run.id, reader: input.reader });
  const capture = record(record(run.runnerProfileJson)?.nativeBootstrapTaskSource);
  const captureInput = record(capture?.input);
  const saved = nativePayloadSourceSnapshotSchema.safeParse(capture?.payloadSourceSnapshot);
  if (!origin || !accepted || !captureInput || !saved.success || captureInput.kind !== "task") return null;
  const { verifyNativeParentTaskCaptureLineage, readNativeBoardStageReturnStep } = await import("./native-board-stage-return-source.js");
  if (!await verifyNativeParentTaskCaptureLineage(db, { companyId: input.companyId, issueId: input.issueId, parentRunId: run.id,
    source: captureInput as { kind: "task"; issueId: string; sourceVersion: string; contentHash: string } })) return null;
  const [task] = await db.select().from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)))
    .limit(1).for("share");
  const current = nativePayloadSourceSnapshotSchema.safeParse(task?.payloadSourceSnapshot);
  if (!task || !current.success) return null;
  const captureSteps = saved.data.transforms ?? [], currentSteps = current.data.transforms ?? [];
  const next = currentSteps[captureSteps.length];
  const boardStep = next?.kind === "board_stage_return" ? next : null;
  const boardRead = boardStep ? await readNativeBoardStageReturnStep(db, { companyId: input.companyId, issueId: input.issueId,
    step: boardStep }) : null;
  const entry = captureSteps.at(-1);
  const { readNativeStageTaskBodyStep } = await import("./native-stage-task-body-source.js");
  const stageEntryReceipt = entry?.kind === "native_stage_policy"
    ? await readNativeStageTaskBodyStep(db, { task, step: entry }).catch(() => null) : null;
  const [activity] = boardStep ? await db.select({ createdAt: activityLog.createdAt }).from(activityLog).where(and(
    eq(activityLog.companyId, input.companyId), eq(activityLog.id, boardStep.activityId))).limit(1) : [];
  const [decision] = await db.select({ id: statusDecisions.id, appliedAt: statusDecisions.appliedAt }).from(statusDecisions)
    .where(and(eq(statusDecisions.companyId, input.companyId), eq(statusDecisions.issueId, input.issueId),
      eq(statusDecisions.id, origin.decisionId))).limit(1);
  const { nativeStageRoundReviewerRunIds } = await import("./native-runtime/native-stage-round-return-source.js");
  const roundReviewerRunIds = boardStep && activity && decision?.appliedAt && typeof contextStageId === "string"
    ? await nativeStageRoundReviewerRunIds(db, { companyId: input.companyId, issueId: input.issueId, reviewerAgentId: run.agentId,
        stageId: contextStageId, decision: { id: decision.id, appliedAt: decision.appliedAt }, executorRunId: origin.executorRunId,
        executorAgentId: origin.executorAgentId, returnedAt: activity.createdAt, reader: input.reader }) : null;
  const fromState = nativeStageReviewerRoundTurnState({
    reviewer: { runId: run.id, agentId: run.agentId, contextStageId }, hasRecordedStageDecision: Boolean(decided),
    origin, roundReviewerRunIds, boardStep: boardRead ? boardStep : null, boardFromState: boardRead?.fromExecutionState ?? null,
    captureSteps, currentSteps, stageEntryReceipt });
  if (!fromState || !boardStep) return null;
  return { version: 1, companyId: input.companyId, issueId: input.issueId, runId: run.id, agentId: run.agentId,
    responsibleUserId: run.responsibleUserId, fromState, decisionId: origin.decisionId, executorRunId: origin.executorRunId,
    executorAgentId: origin.executorAgentId, boardActivityId: boardStep.activityId, boardTransitionId: boardStep.transitionId,
    resultId: accepted.owner.resultId };
}
