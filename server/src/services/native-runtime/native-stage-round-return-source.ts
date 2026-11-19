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
      statusVersion: issues.statusVersion, lastStatusDecisionId: issues.lastStatusDecisionId, executionState: issues.executionState })
      .from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).limit(1).for("share");
    if (!task || task.assigneeAgentId !== receiver.agentId || task.responsibleUserId !== receiver.responsibleUserId ||
      task.statusVersion !== version!.to || task.lastStatusDecisionId !== decision.id || task.executionState !== null) return null;
  }
  // The stage Reviewer Runs this decision's stage wake started on the returned
  // stage, ended before the return.
  const candidates = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
    eq(heartbeatRuns.agentId, reviewerAgentId), eq(heartbeatRuns.nativeIssueId, input.issueId), eq(heartbeatRuns.runtimeMode, "native"),
    inArray(heartbeatRuns.status, TERMINAL), isNotNull(heartbeatRuns.finishedAt), gte(heartbeatRuns.createdAt, decision.appliedAt!),
    lte(heartbeatRuns.finishedAt, activity.createdAt))).orderBy(asc(heartbeatRuns.id)).limit(17).for("share");
  if (candidates.length > 16) return null;
  const { captureNativeStageOrigin } = await import("../native-stage-wake-source.js");
  const reviewerRunIds: string[] = [];
  for (const run of candidates) {
    const context = record(run.contextSnapshot), stage = record(context?.executionStage);
    if (context?.source !== "issue.execution_stage" || stage?.stageId !== stageId) continue;
    const origin = await captureNativeStageOrigin(db, run);
    if (!origin || origin.decisionId !== decision.id || origin.executorRunId !== executor.id ||
      origin.executorAgentId !== receiver.agentId || !await canActorReadHeartbeatRunPrivacy(db, input.reader, run)) continue;
    reviewerRunIds.push(run.id);
  }
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
