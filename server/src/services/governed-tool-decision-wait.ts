import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  activityLog,
  heartbeatRuns,
  issueComments,
  issueThreadInteractions,
  issues,
  statusDecisions,
  type Db,
} from "@paperclipai/db";
import { logActivity } from "./activity-log.js";

/**
 * APR-E2E-1 (decision: option B). A Human's comment on a Task that waits only
 * for a governed tool decision of its own assignee does not start a Run: the
 * gated action cannot run before the decision, so a Run could only yield again
 * while spending model budget and a plan retry. The comment is recorded as a
 * deferred note and handed to the resolution Run (approve, decline, Always
 * allow, or a failed approved action) exactly once.
 *
 * The match is exact and fails closed. Every other `in_review` Task keeps the
 * ordinary comment wake: review handoffs, signoff and plan review, any second
 * pending interaction, a card created by another actor, a card whose Run did
 * not record the governed wait as the Task's latest decision.
 */
export const GOVERNED_TOOL_DECISION_NOTE_DEFERRED_ACTION = "issue.comment_wake_deferred";
export const GOVERNED_TOOL_DECISION_NOTE_REASON = "governed_tool_decision_pending";

export type GovernedToolDecisionWait = {
  interactionId: string;
  sourceRunId: string;
  statusDecisionId: string;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function findGovernedToolDecisionWait(
  db: Db,
  input: { companyId: string; issueId: string; assigneeAgentId: string },
): Promise<GovernedToolDecisionWait | null> {
  const [issue] = await db
    .select({
      status: issues.status,
      assigneeAgentId: issues.assigneeAgentId,
      assigneeUserId: issues.assigneeUserId,
      lastStatusDecisionId: issues.lastStatusDecisionId,
    })
    .from(issues)
    .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)))
    .limit(1);
  if (
    !issue ||
    issue.status !== "in_review" ||
    issue.assigneeAgentId !== input.assigneeAgentId ||
    issue.assigneeUserId ||
    !issue.lastStatusDecisionId
  )
    return null;
  // Any other open interaction (a second card, a plan or completion review,
  // a question) keeps today's behaviour.
  const pending = await db
    .select({
      id: issueThreadInteractions.id,
      kind: issueThreadInteractions.kind,
      payload: issueThreadInteractions.payload,
      createdByAgentId: issueThreadInteractions.createdByAgentId,
      createdByUserId: issueThreadInteractions.createdByUserId,
      sourceRunId: issueThreadInteractions.sourceRunId,
    })
    .from(issueThreadInteractions)
    .where(
      and(
        eq(issueThreadInteractions.companyId, input.companyId),
        eq(issueThreadInteractions.issueId, input.issueId),
        eq(issueThreadInteractions.status, "pending"),
      ),
    )
    .limit(2);
  if (pending.length !== 1) return null;
  const card = pending[0]!;
  const toolAction = object(object(card.payload)?.toolAction);
  if (
    card.kind !== "request_confirmation" ||
    !toolAction ||
    typeof toolAction.actionRequestId !== "string" ||
    card.createdByAgentId !== input.assigneeAgentId ||
    card.createdByUserId ||
    !card.sourceRunId
  )
    return null;
  const [decision] = await db
    .select({ id: statusDecisions.id })
    .from(statusDecisions)
    .where(
      and(
        eq(statusDecisions.companyId, input.companyId),
        eq(statusDecisions.issueId, input.issueId),
        eq(statusDecisions.id, issue.lastStatusDecisionId),
        eq(statusDecisions.runId, card.sourceRunId),
        eq(statusDecisions.applicationState, "applied"),
        eq(statusDecisions.reasonCode, "governed_response_waiting"),
        eq(statusDecisions.toStatus, "in_review"),
      ),
    )
    .limit(1);
  if (!decision) return null;
  const [sourceRun] = await db
    .select({ id: heartbeatRuns.id })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, input.companyId),
        eq(heartbeatRuns.id, card.sourceRunId),
        eq(heartbeatRuns.agentId, input.assigneeAgentId),
      ),
    )
    .limit(1);
  if (!sourceRun) return null;
  return { interactionId: card.id, sourceRunId: card.sourceRunId, statusDecisionId: decision.id };
}

export async function recordDeferredGovernedNote(
  db: Db,
  input: {
    companyId: string;
    issueId: string;
    assigneeAgentId: string;
    commentId: string;
    wait: GovernedToolDecisionWait;
    actor: { actorType: "user"; actorId: string };
  },
): Promise<boolean> {
  // The note becomes one of the card's origin comments (APR-E2E-13): the
  // resolution Run's continuation carries a card's origin comments, and the
  // Native source closure accepts a wake comment only when the resolved card
  // owns it. The card stays pending and its version (updatedAt) is unchanged.
  // If the card is no longer pending, nothing is recorded and the caller keeps
  // the ordinary wake.
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const [linked] = await tx
      .update(issueThreadInteractions)
      .set({
        originCommentIds: sql`(select coalesce(jsonb_agg(distinct value), '[]'::jsonb) from jsonb_array_elements_text(${issueThreadInteractions.originCommentIds} || ${JSON.stringify([input.commentId])}::jsonb) as value)`,
      })
      .where(and(
        eq(issueThreadInteractions.companyId, input.companyId),
        eq(issueThreadInteractions.issueId, input.issueId),
        eq(issueThreadInteractions.id, input.wait.interactionId),
        eq(issueThreadInteractions.status, "pending"),
      ))
      .returning({ id: issueThreadInteractions.id });
    if (!linked) return false;
    await logActivity(tx, {
      companyId: input.companyId,
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      action: GOVERNED_TOOL_DECISION_NOTE_DEFERRED_ACTION,
      entityType: "issue",
      entityId: input.issueId,
      details: {
        commentId: input.commentId,
        interactionId: input.wait.interactionId,
        sourceRunId: input.wait.sourceRunId,
        statusDecisionId: input.wait.statusDecisionId,
        assigneeAgentId: input.assigneeAgentId,
        reason: GOVERNED_TOOL_DECISION_NOTE_REASON,
      },
    });
    return true;
  });
}

/** Human notes deferred for this card, still present on this Task, oldest
 * first. The resolution wake is idempotent per card status, so they are
 * delivered once. */
export async function deferredGovernedNoteCommentIds(
  db: Db,
  input: { companyId: string; issueId: string; interactionId: string; assigneeAgentId: string },
): Promise<string[]> {
  const deferred = await db
    .select({ details: activityLog.details, actorType: activityLog.actorType, actorId: activityLog.actorId })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.companyId, input.companyId),
        eq(activityLog.entityType, "issue"),
        eq(activityLog.entityId, input.issueId),
        eq(activityLog.action, GOVERNED_TOOL_DECISION_NOTE_DEFERRED_ACTION),
        eq(activityLog.actorType, "user"),
        sql`${activityLog.details}->>'interactionId' = ${input.interactionId}`,
        sql`${activityLog.details}->>'assigneeAgentId' = ${input.assigneeAgentId}`,
      ),
    );
  const byComment = new Map<string, string>();
  for (const row of deferred) {
    const commentId = object(row.details)?.commentId;
    if (typeof commentId === "string" && !byComment.has(commentId)) byComment.set(commentId, row.actorId);
  }
  if (byComment.size === 0) return [];
  const comments = await db
    .select({ id: issueComments.id, authorUserId: issueComments.authorUserId })
    .from(issueComments)
    .where(
      and(
        eq(issueComments.companyId, input.companyId),
        eq(issueComments.issueId, input.issueId),
        inArray(issueComments.id, [...byComment.keys()]),
        isNull(issueComments.deletedAt),
        isNull(issueComments.createdByRunId),
      ),
    )
    .orderBy(asc(issueComments.createdAt), asc(issueComments.id));
  return comments
    .filter((comment) => comment.authorUserId && comment.authorUserId === byComment.get(comment.id))
    .map((comment) => comment.id);
}
