import type { Db, heartbeatRuns, issues } from "@paperclipai/db";
import {
  readNativeChannelConversationScope,
  type NativeChannelConversationScope,
} from "../native-runtime/native-channel-conversation-owner.js";

type RuntimeConversationRun = Pick<typeof heartbeatRuns.$inferSelect,
  "id" | "companyId" | "agentId" | "responsibleUserId" | "nativeIssueId" | "contextSnapshot">;
type RuntimeConversationTask = Pick<typeof issues.$inferSelect,
  "id" | "originKind" | "conversationAgentId" | "conversationUserId" | "conversationState" |
  "conversationRetiredAt" | "conversationSessionGeneration">;

/**
 * RuntimeControl's owner for a Native turn on a `chat_channel` Task.
 *
 * Such a Task has no web-conversation columns. Its only conversation owner is
 * the persisted inbound wake of a linked Human (current link, active non-viewer
 * membership, active endpoint whose owner admitted agent execution, processed
 * delivery, current runtime generation, this exact Run). That owner is read by
 * `readNativeChannelConversationScope`, the same projection heartbeat
 * admission, workspace selection, the model gateway and the tool boundary use.
 * Inputs come only from the persisted Run and Task, never from a caller.
 * Returns null when the Task is not a channel conversation or the owner is not
 * current, so callers keep their existing fail-closed Worker or web checks.
 */
export async function readRuntimeChannelConversationScope(db: Db, input: {
  run: RuntimeConversationRun;
  task: RuntimeConversationTask;
}): Promise<NativeChannelConversationScope | null> {
  const { run, task } = input;
  if (task.originKind !== "chat_channel" || task.conversationAgentId !== null || task.conversationUserId !== null ||
      !run.agentId || !run.responsibleUserId || run.nativeIssueId !== task.id) return null;
  const context = run.contextSnapshot && typeof run.contextSnapshot === "object" && !Array.isArray(run.contextSnapshot)
    ? run.contextSnapshot as Record<string, unknown> : {};
  const generation = context.conversationSessionGeneration;
  const sourceCommentId = context.wakeCommentId;
  if (typeof generation !== "number" || typeof sourceCommentId !== "string") return null;
  let scope: NativeChannelConversationScope;
  try {
    scope = await readNativeChannelConversationScope(db, {
      companyId: run.companyId, issueId: task.id, agentId: run.agentId, responsibleUserId: run.responsibleUserId,
      runId: run.id, sessionGeneration: generation, sourceCommentId, consumer: "workspace",
    });
  } catch {
    return null;
  }
  return scope.companyId === run.companyId && scope.issueId === task.id && scope.agentId === run.agentId &&
    scope.responsibleUserId === run.responsibleUserId && scope.runId === run.id && scope.sessionGeneration === generation
    ? scope : null;
}

/** Exact conversation owner of this Run: the web Task columns, or the current
 * channel owner of a `chat_channel` Task. Never both, never a union. */
export function runtimeConversationOwnerExact(
  task: RuntimeConversationTask,
  run: Pick<RuntimeConversationRun, "id" | "companyId" | "agentId" | "responsibleUserId">,
  channelScope: NativeChannelConversationScope | null,
): boolean {
  if (channelScope) {
    return task.originKind === "chat_channel" && task.conversationAgentId === null && task.conversationUserId === null &&
      channelScope.companyId === run.companyId && channelScope.issueId === task.id &&
      channelScope.agentId === run.agentId && channelScope.responsibleUserId === run.responsibleUserId &&
      channelScope.runId === run.id;
  }
  return task.conversationAgentId !== null && task.conversationAgentId === run.agentId &&
    task.conversationUserId !== null && task.conversationUserId === run.responsibleUserId &&
    task.conversationState === "active" && task.conversationRetiredAt === null;
}

/** The session generation that owns this conversation turn. */
export function runtimeConversationGeneration(
  task: RuntimeConversationTask,
  channelScope: NativeChannelConversationScope | null,
): number {
  return channelScope ? channelScope.sessionGeneration : task.conversationSessionGeneration;
}
