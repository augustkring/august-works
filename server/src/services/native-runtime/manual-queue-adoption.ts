import { and, eq, inArray, sql } from "drizzle-orm";
import { agentWakeupRequests, issueComments, type Db } from "@paperclipai/db";
import { nativeTaskWakeOriginCommentIds } from "./canonical.js";

type RunOwner = { id: string; companyId: string; agentId: string; responsibleUserId: string | null;
  wakeupRequestId: string | null; nativeIssueId: string | null; issueId: string | null; contextSnapshot: unknown };

/** Stable identity proof; mutable queue status/timestamps are checked by the
 * owner and deliberately do not enter the native_task_wake content hash. */
export type NativeManualQueueAdoption = {
  schema: "paperclip.native-manual-queue-adoption.v1";
  companyId: string; issueId: string; agentId: string; runId: string; wakeupRequestId: string;
  operatorUserId: string; originQueueIds: string[]; originCommentIds: string[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function commentReason(reason: string | null) {
  return reason === "issue_commented" || reason === "issue_comment_mentioned";
}

/** Rebuild an adoption from the current receiver wake and only exact coalesced
 * queue rows already linked to that Run. ACL checks remain with source owners. */
export async function readNativeManualQueueAdoption(db: Db, input: {
  run: RunOwner; issueId: string; currentWake: typeof agentWakeupRequests.$inferSelect; readWork?: () => void;
}): Promise<NativeManualQueueAdoption | null> {
  const { run, issueId, currentWake } = input;
  const currentPayload = record(currentWake.payload);
  const context = record(run.contextSnapshot);
  if (!run.responsibleUserId || !run.wakeupRequestId ||
      (run.nativeIssueId !== null && run.nativeIssueId !== issueId) ||
      ![run.issueId, run.nativeIssueId, context.issueId, context.taskId].includes(issueId) ||
      currentWake.companyId !== run.companyId || currentWake.agentId !== run.agentId ||
      currentWake.id !== run.wakeupRequestId || currentWake.runId !== run.id ||
      currentWake.requestedByActorType !== "user" || currentWake.requestedByActorId !== run.responsibleUserId ||
      currentPayload.manualUserWake !== true || currentPayload.issueId !== issueId) return null;

  const ids = nativeTaskWakeOriginCommentIds(currentWake.payload);
  if (!ids.length || ids.length > 256 || ids.includes("invalid-origin")) return null;
  let queueRows: typeof agentWakeupRequests.$inferSelect[];
  const mergedWake = currentWake.source === "automation" && commentReason(currentWake.reason) &&
    (currentWake.triggerDetail === null || currentWake.triggerDetail === "system") &&
    (currentWake.coalescedCount ?? 0) > 0;
  const coldManualWake = currentWake.source === "on_demand" && currentWake.triggerDetail === "manual";
  const currentWakeStatusIsLive = ["claimed", "coalesced", "completed", "processed"].includes(currentWake.status);
  if (!currentWakeStatusIsLive) return null;
  if (mergedWake) {
    input.readWork?.();
    queueRows = [currentWake];
  } else if (coldManualWake) {
    input.readWork?.();
    const linked = await db.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.companyId, run.companyId), eq(agentWakeupRequests.agentId, run.agentId),
      eq(agentWakeupRequests.runId, run.id), eq(agentWakeupRequests.status, "coalesced"),
      eq(agentWakeupRequests.source, "automation"), inArray(agentWakeupRequests.reason, ["issue_commented", "issue_comment_mentioned"]),
      sql`${agentWakeupRequests.payload}->>'issueId' = ${issueId}`,
    )).limit(257);
    if (linked.length > 256) return null;
    for (const _row of linked) input.readWork?.();
    queueRows = linked.filter(row => row.id !== currentWake.id &&
      (row.triggerDetail === null || row.triggerDetail === "system") && row.requestedByActorType === "user" &&
      Boolean(row.requestedByActorId));
  } else return null;

  if (!queueRows.length || queueRows.length > 256) return null;
  const queueIds = [...new Set(queueRows.map(row => row.id))].sort();
  const rowCommentIds = queueRows.flatMap(row => nativeTaskWakeOriginCommentIds(row.payload));
  const commentIds = [...new Set(rowCommentIds)].sort();
  if (!queueIds.length || queueIds.length > 256 || commentIds.length > 256 ||
      rowCommentIds.length !== commentIds.length || commentIds.includes("invalid-origin") ||
      JSON.stringify(commentIds) !== JSON.stringify([...new Set(ids)].sort())) return null;
  input.readWork?.();
  const comments = await db.select({ id: issueComments.id, authorType: issueComments.authorType,
    authorUserId: issueComments.authorUserId, authorAgentId: issueComments.authorAgentId,
    createdByRunId: issueComments.createdByRunId, deletedAt: issueComments.deletedAt })
    .from(issueComments).where(and(eq(issueComments.companyId, run.companyId), eq(issueComments.issueId, issueId),
      inArray(issueComments.id, commentIds))).limit(257);
  if (comments.length > 256) return null;
  for (const _comment of comments) input.readWork?.();
  if (comments.length !== commentIds.length || comments.some(comment => comment.authorType !== "user" ||
      !comment.authorUserId || comment.authorAgentId !== null || comment.createdByRunId !== null || comment.deletedAt !== null)) return null;
  const commentById = new Map(comments.map(comment => [comment.id, comment]));
  if (coldManualWake && queueRows.some(row => !nativeTaskWakeOriginCommentIds(row.payload).some(id =>
      row.requestedByActorId === commentById.get(id)?.authorUserId))) return null;

  if (comments.every(comment => comment.authorUserId === run.responsibleUserId)) return null;
  return { schema: "paperclip.native-manual-queue-adoption.v1", companyId: run.companyId, issueId,
    agentId: run.agentId, runId: run.id, wakeupRequestId: currentWake.id, operatorUserId: run.responsibleUserId,
    originQueueIds: queueIds, originCommentIds: commentIds };
}
