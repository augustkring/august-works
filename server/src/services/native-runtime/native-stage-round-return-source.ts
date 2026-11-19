import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { activityLog, agentWakeupRequests, heartbeatRuns, issues, statusDecisions, type Db } from "@paperclipai/db";
import { nativeSha256 } from "./canonical.js";
import { parseIssueExecutionState } from "../issue-execution-policy.js";
import { canActorReadHeartbeatRunPrivacy, type AuthorizationActor } from "../authorization.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * MS1f stop 4 (returned-executor continuation family). The board returned a
 * Task in a pending execution-policy stage to its executor (the PATCH board
 * override that clears the stage), and the route's assignment wake started this
 * executor Run. The owner names exactly that return and the stage round it
 * ended: the board's own activity row and the Task version it produced, the
 * executor's applied stage-pending decision that opened the round, and the
 * stage Reviewer Runs that this decision's stage wake started on this Task's
 * returned stage. Only those Reviewer Runs' own sealed presentation comments
 * join the returned executor's continuation, each under its own Run and Agent.
 */
export type NativeStageRoundReturnOwner = {
  version: 1; companyId: string; issueId: string; receiverRunId: string; agentId: string; responsibleUserId: string;
  wakeupRequestId: string; activityId: string; activityHash: string; taskStatusVersion: number;
  stageId: string; stagePendingDecisionId: string; executorRunId: string; reviewerAgentId: string; reviewerRunIds: string[];
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL = ["succeeded", "failed", "timed_out", "cancelled"];

/** Exact shape check of a saved or captured owner (no database read). */
export function exactNativeStageRoundReturnOwner(value: unknown, binding: {
  companyId: string; issueId: string; runId: string; agentId: string; responsibleUserId: string; wakeupRequestId: string;
}): value is NativeStageRoundReturnOwner {
  const owner = record(value);
  if (!owner || Object.keys(owner).sort().join(",") !== "activityHash,activityId,agentId,companyId,executorRunId,issueId," +
      "receiverRunId,responsibleUserId,reviewerAgentId,reviewerRunIds,stageId,stagePendingDecisionId,taskStatusVersion,version,wakeupRequestId")
    return false;
  const reviewerRunIds = owner.reviewerRunIds;
  return owner.version === 1 && owner.companyId === binding.companyId && owner.issueId === binding.issueId &&
    owner.receiverRunId === binding.runId && owner.agentId === binding.agentId &&
    owner.responsibleUserId === binding.responsibleUserId && owner.wakeupRequestId === binding.wakeupRequestId &&
    [owner.activityId, owner.stageId, owner.stagePendingDecisionId, owner.executorRunId, owner.reviewerAgentId]
      .every(id => typeof id === "string" && uuid.test(id)) &&
    owner.reviewerAgentId !== owner.agentId && owner.executorRunId !== owner.receiverRunId &&
    typeof owner.activityHash === "string" && /^[a-f0-9]{64}$/.test(owner.activityHash) &&
    Number.isSafeInteger(owner.taskStatusVersion) && (owner.taskStatusVersion as number) > 0 &&
    Array.isArray(reviewerRunIds) && reviewerRunIds.length > 0 && reviewerRunIds.length <= 16 &&
    reviewerRunIds.every((id, index) => typeof id === "string" && uuid.test(id) && id !== owner.receiverRunId &&
      id !== owner.executorRunId && (index === 0 || (reviewerRunIds[index - 1] as string) < id));
}

/**
 * Read the owner from the database for `receiver`. A running receiver must
 * still be the Task's assignee at exactly the returned Task version, with the
 * round's decision still the Task's last status decision. A finished receiver
 * (historical re-read) keeps every immutable binding.
 */
export async function captureNativeStageRoundReturnOwner(db: Db | Transaction, input: {
  companyId: string; issueId: string; receiver: typeof heartbeatRuns.$inferSelect; reader: AuthorizationActor;
}): Promise<NativeStageRoundReturnOwner | null> {
  const { receiver } = input;
  const running = receiver.status === "running";
  if (receiver.companyId !== input.companyId || !receiver.agentId || !receiver.responsibleUserId || !receiver.wakeupRequestId ||
    (!running && !(receiver.finishedAt && TERMINAL.includes(receiver.status))) ||
    record(receiver.contextSnapshot)?.issueId !== input.issueId || record(receiver.contextSnapshot)?.wakeReason !== "issue_assigned" ||
    (receiver.nativeIssueId !== null && receiver.nativeIssueId !== input.issueId)) return null;
  const [wake] = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, input.companyId),
    eq(agentWakeupRequests.id, receiver.wakeupRequestId), eq(agentWakeupRequests.agentId, receiver.agentId))).limit(1).for("share");
  const wakePayload = record(wake?.payload);
  if (!wake || wake.reason !== "issue_assigned" || wake.source !== "assignment" || wake.requestedByActorType !== "user" ||
    wake.requestedByActorId !== receiver.responsibleUserId || (wake.runId !== null && wake.runId !== receiver.id) ||
    wakePayload?.issueId !== input.issueId || wakePayload.mutation !== "update") return null;
  // The board's own return: the latest Task update at or before the wake.
  const [activity] = await db.select().from(activityLog).where(and(eq(activityLog.companyId, input.companyId),
    eq(activityLog.entityType, "issue"), eq(activityLog.entityId, input.issueId), eq(activityLog.action, "issue.updated"),
    lte(activityLog.createdAt, wake.requestedAt))).orderBy(desc(activityLog.createdAt), desc(activityLog.id)).limit(1).for("share");
  const changes = record(record(activity?.details)?.changes);
  const status = record(changes?.status), assignee = record(changes?.assigneeAgentId);
  const execution = record(changes?.executionState), version = record(changes?.statusVersion);
  const from = parseIssueExecutionState(execution?.from);
  if (!activity || activity.actorType !== "user" || activity.actorId !== receiver.responsibleUserId || activity.agentId !== null ||
    activity.runId !== null || !changes || Object.hasOwn(changes, "lastStatusDecisionId") ||
    status?.from !== "in_review" || status.to === "in_review" || assignee?.to !== receiver.agentId ||
    !execution || execution.to !== null || !from || from.status !== "pending" || typeof from.currentStageId !== "string" ||
    from.currentParticipant?.type !== "agent" || typeof from.currentParticipant.agentId !== "string" ||
    from.currentParticipant.agentId === receiver.agentId || assignee.from !== from.currentParticipant.agentId ||
    from.returnAssignee?.type !== "agent" || from.returnAssignee.agentId !== receiver.agentId ||
    !Number.isSafeInteger(version?.to) || !Number.isSafeInteger(version?.from) || (version!.to as number) <= (version!.from as number))
    return null;
  const reviewerAgentId = from.currentParticipant.agentId;
  const stageId = from.currentStageId;
  // The round's decision: the Task's last applied status decision before the
  // return, the executor's stage-pending handoff on this Task.
  const decided = await db.select().from(statusDecisions).where(and(eq(statusDecisions.companyId, input.companyId),
    eq(statusDecisions.issueId, input.issueId), eq(statusDecisions.applicationState, "applied"), isNotNull(statusDecisions.appliedAt)))
    .orderBy(desc(statusDecisions.decisionVersion)).limit(64).for("share");
  const beforeReturn = decided.filter(row => row.appliedAt! <= activity.createdAt);
  // The round's own Reviewer turns may end with an applied decision that
  // keeps the Task in review (it never becomes the Task's last decision); each
  // must belong to a Reviewer Run of this round (checked below).
  const reviewTurnDecisions: typeof decided = [];
  while (beforeReturn.length && beforeReturn[0]!.fromStatus === "in_review" && beforeReturn[0]!.toStatus === "in_review" &&
    beforeReturn[0]!.reasonCode !== "execution_policy_stage_pending") reviewTurnDecisions.push(beforeReturn.shift()!);
  const decision = beforeReturn[0];
  if (!decision || decision.reasonCode !== "execution_policy_stage_pending" || decision.toStatus !== "in_review" ||
    decided.some(row => row.appliedAt! > activity.createdAt && row.appliedAt! <= receiver.createdAt)) return null;
  const [executor] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.id, decision.runId), eq(heartbeatRuns.nativeIssueId, input.issueId), eq(heartbeatRuns.runtimeMode, "native")))
    .limit(1).for("share");
  if (!executor || executor.agentId !== receiver.agentId || executor.id === receiver.id || !executor.finishedAt ||
    executor.finishedAt > activity.createdAt) return null;
  if (running) {
    const [task] = await db.select({ assigneeAgentId: issues.assigneeAgentId, responsibleUserId: issues.responsibleUserId,
      statusVersion: issues.statusVersion, lastStatusDecisionId: issues.lastStatusDecisionId, executionState: issues.executionState,
      payloadSourceSnapshot: issues.payloadSourceSnapshot })
      .from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).limit(1).for("share");
    if (!task || task.assigneeAgentId !== receiver.agentId || task.responsibleUserId !== receiver.responsibleUserId ||
      task.statusVersion !== version!.to || task.lastStatusDecisionId !== decision.id || task.executionState !== null) return null;
    // MS1f stop 5 (0587): the Task source records exactly this board return.
    const transforms = record(task.payloadSourceSnapshot)?.transforms;
    const last = Array.isArray(transforms) ? record(transforms.at(-1)) : null;
    if (!last || last.kind !== "board_stage_return" || last.activityId !== activity.id || last.stageId !== stageId ||
      last.decisionId !== decision.id || last.taskStatusVersion !== version!.to ||
      last.participantAgentId !== reviewerAgentId || last.executorAgentId !== receiver.agentId) return null;
  }
  // The stage Reviewer Runs this decision's stage wake started on the returned
  // stage, ended before the return.
  const reviewerRunIds = await nativeStageRoundReviewerRunIds(db, { companyId: input.companyId, issueId: input.issueId,
    reviewerAgentId, stageId, decision: { id: decision.id, appliedAt: decision.appliedAt! }, executorRunId: executor.id,
    executorAgentId: receiver.agentId, returnedAt: activity.createdAt, reader: input.reader });
  if (!reviewerRunIds) return null;
  if (reviewTurnDecisions.some(row => !reviewerRunIds.includes(row.runId) || row.appliedAt! < decision.appliedAt!)) return null;
  if (reviewerRunIds.length === 0) return null;
  const owner: NativeStageRoundReturnOwner = { version: 1, companyId: input.companyId, issueId: input.issueId,
    receiverRunId: receiver.id, agentId: receiver.agentId, responsibleUserId: receiver.responsibleUserId,
    wakeupRequestId: receiver.wakeupRequestId, activityId: activity.id,
    activityHash: nativeSha256({ id: activity.id, companyId: activity.companyId, actorType: activity.actorType, actorId: activity.actorId,
      action: activity.action, entityType: activity.entityType, entityId: activity.entityId, details: activity.details,
      createdAt: activity.createdAt.toISOString() }),
    taskStatusVersion: version!.to as number, stageId, stagePendingDecisionId: decision.id, executorRunId: executor.id,
    reviewerAgentId, reviewerRunIds: reviewerRunIds.sort() };
  return exactNativeStageRoundReturnOwner(owner, { companyId: input.companyId, issueId: input.issueId, runId: receiver.id,
    agentId: receiver.agentId, responsibleUserId: receiver.responsibleUserId, wakeupRequestId: receiver.wakeupRequestId }) ? owner : null;
}

/** The owner a dispatch recheck reads again must equal the saved bootstrap owner. */
export function nativeStageRoundReturnOwnerMatches(current: NativeStageRoundReturnOwner | null, saved: unknown): boolean {
  return current !== null && isDeepStrictEqual(current, saved);
}

/** The stage Reviewer Runs a round's stage-pending decision started on that
 * stage, ended before the board's return (shared by the board-return owner and
 * the historical Reviewer turn). Null when the candidate set exceeds its bound. */
export async function nativeStageRoundReviewerRunIds(db: Db | Transaction, input: {
  companyId: string; issueId: string; reviewerAgentId: string; stageId: string; decision: { id: string; appliedAt: Date };
  executorRunId: string; executorAgentId: string; returnedAt: Date; reader: AuthorizationActor;
}): Promise<string[] | null> {
  const candidates = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.agentId, input.reviewerAgentId), eq(heartbeatRuns.nativeIssueId, input.issueId), eq(heartbeatRuns.runtimeMode, "native"),
    inArray(heartbeatRuns.status, TERMINAL), isNotNull(heartbeatRuns.finishedAt), gte(heartbeatRuns.createdAt, input.decision.appliedAt),
    lte(heartbeatRuns.finishedAt, input.returnedAt))).orderBy(asc(heartbeatRuns.id)).limit(17).for("share");
  if (candidates.length > 16) return null;
  const { captureNativeStageOrigin } = await import("../native-stage-wake-source.js");
  const reviewerRunIds: string[] = [];
  for (const run of candidates) {
    const context = record(run.contextSnapshot), stage = record(context?.executionStage);
    if (context?.source !== "issue.execution_stage" || stage?.stageId !== input.stageId) continue;
    const origin = await captureNativeStageOrigin(db, run);
    if (!origin || origin.decisionId !== input.decision.id || origin.executorRunId !== input.executorRunId ||
      origin.executorAgentId !== input.executorAgentId || !await canActorReadHeartbeatRunPrivacy(db, input.reader, run)) continue;
    reviewerRunIds.push(run.id);
  }
  return reviewerRunIds;
}

/** One earlier stage round the board returned, derived from its verified
 * board_stage_return step: its executor Run (through the round's
 * stage-pending decision) and its Reviewer Runs. */
export type NativeReturnedStageRound = {
  activityId: string; stageId: string; decisionId: string; executorRunId: string; executorAgentId: string;
  reviewerAgentId: string; reviewerRunIds: string[];
};

/** Rounds must be recorded in time order: each round's stage-pending decision
 * was applied after the previous round's return, and each return comes after
 * the previous one. */
export function nativeReturnedStageRoundsOrdered(rounds: ReadonlyArray<{ decisionAppliedAt: Date; returnedAt: Date }>): boolean {
  return rounds.every((round, index) => round.decisionAppliedAt <= round.returnedAt &&
    (index === 0 || (round.returnedAt > rounds[index - 1]!.returnedAt && round.decisionAppliedAt >= rounds[index - 1]!.returnedAt)));
}

/** Exact shape of a recorded round history (no database read). */
export function exactNativeReturnedStageRounds(value: unknown): value is NativeReturnedStageRound[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return false;
  const runIds = new Set<string>();
  return value.every(round => {
    const r = record(round);
    if (!r || Object.keys(r).sort().join(",") !==
        "activityId,decisionId,executorAgentId,executorRunId,reviewerAgentId,reviewerRunIds,stageId") return false;
    const reviewerRunIds = r.reviewerRunIds;
    if (![r.activityId, r.decisionId, r.executorAgentId, r.executorRunId, r.reviewerAgentId, r.stageId]
        .every(id => typeof id === "string" && uuid.test(id)) || r.reviewerAgentId === r.executorAgentId ||
      !Array.isArray(reviewerRunIds) || reviewerRunIds.length > 16 ||
      !reviewerRunIds.every((id, index) => typeof id === "string" && uuid.test(id) &&
        (index === 0 || (reviewerRunIds[index - 1] as string) < id))) return false;
    for (const id of [r.executorRunId as string, ...(reviewerRunIds as string[])]) {
      if (runIds.has(id)) return false;
      runIds.add(id);
    }
    return true;
  });
}

/**
 * MS1f (round history). Every earlier stage round the board returned on this
 * Task, in recorded order, each derived separately from its own verified
 * board_stage_return step exactly as the board-return owner derives it. Null
 * when any recorded return no longer verifies, a round is out of order or a
 * bound is exceeded; an empty list when the Task has no board return.
 */
export async function captureNativeReturnedStageRounds(db: Db | Transaction, input: {
  companyId: string; issueId: string; reader: AuthorizationActor;
}): Promise<NativeReturnedStageRound[] | null> {
  const [task] = await db.select({ snapshot: issues.payloadSourceSnapshot, invalidated: issues.payloadSourceSnapshotInvalidated })
    .from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).limit(1).for("share");
  if (!task || task.invalidated) return null;
  const steps = (record(task.snapshot)?.transforms ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(steps)) return null;
  const boardSteps = steps.filter(step => record(step)?.kind === "board_stage_return");
  if (boardSteps.length > 16) return null;
  const { readNativeBoardStageReturnStep } = await import("../native-board-stage-return-source.js");
  const rounds: NativeReturnedStageRound[] = [];
  const times: Array<{ decisionAppliedAt: Date; returnedAt: Date }> = [];
  for (const raw of boardSteps) {
    const step = raw as unknown as import("../native-board-stage-return-source.js").NativeBoardStageReturnTransform;
    const read = await readNativeBoardStageReturnStep(db, { companyId: input.companyId, issueId: input.issueId, step });
    const [activity] = await db.select({ createdAt: activityLog.createdAt }).from(activityLog).where(and(
      eq(activityLog.companyId, input.companyId), eq(activityLog.id, step.activityId))).limit(1);
    const [decision] = await db.select({ id: statusDecisions.id, runId: statusDecisions.runId, appliedAt: statusDecisions.appliedAt })
      .from(statusDecisions).where(and(eq(statusDecisions.companyId, input.companyId), eq(statusDecisions.issueId, input.issueId),
        eq(statusDecisions.id, step.decisionId))).limit(1);
    const [executor] = decision ? await db.select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, decision.runId),
        eq(heartbeatRuns.nativeIssueId, input.issueId), eq(heartbeatRuns.runtimeMode, "native"))).limit(1) : [];
    if (!read || !activity || !decision?.appliedAt || !executor || executor.agentId !== step.executorAgentId) return null;
    const reviewerRunIds = await nativeStageRoundReviewerRunIds(db, { companyId: input.companyId, issueId: input.issueId,
      reviewerAgentId: step.participantAgentId, stageId: step.stageId, decision: { id: decision.id, appliedAt: decision.appliedAt },
      executorRunId: executor.id, executorAgentId: step.executorAgentId, returnedAt: activity.createdAt, reader: input.reader });
    if (!reviewerRunIds) return null;
    rounds.push({ activityId: step.activityId, stageId: step.stageId, decisionId: decision.id, executorRunId: executor.id,
      executorAgentId: step.executorAgentId, reviewerAgentId: step.participantAgentId, reviewerRunIds: [...reviewerRunIds].sort() });
    times.push({ decisionAppliedAt: decision.appliedAt, returnedAt: activity.createdAt });
  }
  if (!nativeReturnedStageRoundsOrdered(times)) return null;
  if (rounds.length > 0 && !exactNativeReturnedStageRounds(rounds)) return null;
  return rounds;
}

/** The Run of a returned round that authored a presentation comment, and the
 * Agent its owner must be bound to; null for any other Run or Agent. */
export function nativeReturnedRoundCommentAgent(rounds: readonly NativeReturnedStageRound[] | undefined,
  comment: { createdByRunId: string | null; authorId: string | null }): string | null {
  if (!rounds || !comment.createdByRunId || !comment.authorId) return null;
  for (const round of rounds) {
    if (comment.createdByRunId === round.executorRunId && comment.authorId === round.executorAgentId) return round.executorAgentId;
    if (round.reviewerRunIds.includes(comment.createdByRunId) && comment.authorId === round.reviewerAgentId) return round.reviewerAgentId;
  }
  return null;
}
