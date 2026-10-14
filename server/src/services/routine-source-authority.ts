import { and, eq, sql } from "drizzle-orm";
import { authUsers, heartbeatRuns, issues, type Db } from "@paperclipai/db";
import { z } from "zod";
import type { AuthorizationActor } from "./authorization.js";
import { assertAnalyticalContextPayloadAccess } from "./analytical-context-authority.js";
import { assertV5Authorization } from "./v5-authorization.js";
import { forbidden } from "../errors.js";

export type RoutineSource = { id: string; companyId: string; originKind: string; originId: string | null;
  createdByAgentId: string | null; responsibleUserId: string | null };

/** New conversation drafts retain the actual Original run as their source.
 * A trusted scheduler uses the saved responsible user; HTTP readers supply
 * their current authenticated actor through the routine service. */
export async function assertRoutineSourceAccess(db: Db, routine: RoutineSource, reader?: AuthorizationActor) {
  if (routine.originKind !== "conversation_draft") return;
  if (!routine.responsibleUserId || !z.uuid().safeParse(routine.originId).success)
    throw forbidden("The saved routine source is unavailable");
  const actor = { ...(reader ?? { type: "board", source: "session", userId: routine.responsibleUserId }),
    ignoreInstanceAdmin: true, isInstanceAdmin: false } as AuthorizationActor;
  let userId = actor.type === "board" ? actor.userId : null;
  if (actor.type === "agent") {
    if (actor.source !== "agent_jwt" || actor.keyId || actor.keyScope || actor.companyId !== routine.companyId || !actor.runId || !actor.agentId)
      throw forbidden("A current accountable private routine reader is required");
    const [active] = await db.select({ userId: heartbeatRuns.responsibleUserId }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, routine.companyId), eq(heartbeatRuns.agentId, actor.agentId),
      eq(heartbeatRuns.id, actor.runId), eq(heartbeatRuns.status, "running")));
    userId = active?.userId;
    if (!userId || actor.onBehalfOfUserId && actor.onBehalfOfUserId !== userId)
      throw forbidden("The actual private routine reader changed");
    actor.onBehalfOfUserId = userId;
  }
  if (actor.source === "local_implicit" || userId !== routine.responsibleUserId)
    throw forbidden("The private routine requires its current responsible Human");
  const [account] = await db.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, userId!));
  if (!account?.verified) throw forbidden("A current verified private routine reader is required");
  await assertV5Authorization(db, actor, routine.companyId, "company_scope:read");
  const [origin] = await db.select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId, userId: heartbeatRuns.responsibleUserId,
    issueId: heartbeatRuns.nativeIssueId, snapshot: heartbeatRuns.contextSnapshot })
    .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, routine.companyId), eq(heartbeatRuns.id, routine.originId!)));
  if (!origin || origin.agentId !== routine.createdByAgentId || origin.userId !== routine.responsibleUserId)
    throw forbidden("The actual routine authoring source changed");
  const issueId = origin.issueId ?? origin.snapshot?.issueId ?? origin.snapshot?.taskId;
  if (!z.uuid().safeParse(issueId).success) throw forbidden("The actual private routine conversation is unavailable");
  const [conversation] = await db.select().from(issues).where(and(eq(issues.companyId, routine.companyId), eq(issues.id, issueId as string)));
  if (!conversation || conversation.conversationUserId !== userId || conversation.conversationAgentId !== origin.agentId ||
    conversation.conversationRetiredAt || conversation.hiddenAt)
    throw forbidden("The current owned routine conversation is unavailable");
  await assertV5Authorization(db, actor, routine.companyId, "agent:read", { type: "agent", companyId: routine.companyId, agentId: origin.agentId });
  await assertV5Authorization(db, actor, routine.companyId, "issue:read", { type: "issue", companyId: routine.companyId, issueId: conversation.id,
    projectId: conversation.projectId, parentIssueId: conversation.parentId, status: conversation.status,
    assigneeAgentId: conversation.assigneeAgentId, assigneeUserId: conversation.assigneeUserId });
  const [source] = await db.execute<{ erased: boolean }>(sql`select aw_conversation_routine_source_erased(${routine.companyId}::uuid,${routine.id}::uuid) as erased`);
  if (source?.erased !== false) throw forbidden("The saved routine source was erased or withdrawn");
  await assertAnalyticalContextPayloadAccess(db, routine.companyId, actor, { runId: origin.id });
  const [current] = await db.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, userId!));
  if (!current?.verified) throw forbidden("The current private routine account changed");
  const [finalSource] = await db.execute<{ erased: boolean }>(sql`select aw_conversation_routine_source_erased(${routine.companyId}::uuid,${routine.id}::uuid) as erased`);
  const [finalConversation] = await db.select({ userId: issues.conversationUserId, agentId: issues.conversationAgentId,
    retiredAt: issues.conversationRetiredAt, hiddenAt: issues.hiddenAt }).from(issues).where(and(
      eq(issues.companyId, routine.companyId), eq(issues.id, conversation.id)));
  if (finalSource?.erased !== false || !finalConversation || finalConversation.userId !== userId ||
    finalConversation.agentId !== origin.agentId || finalConversation.retiredAt || finalConversation.hiddenAt)
    throw forbidden("The current private routine source changed");
  await assertV5Authorization(db, actor, routine.companyId, "company_scope:read");
  await assertV5Authorization(db, actor, routine.companyId, "agent:read", { type: "agent", companyId: routine.companyId, agentId: origin.agentId });
  await assertV5Authorization(db, actor, routine.companyId, "issue:read", { type: "issue", companyId: routine.companyId, issueId: conversation.id,
    projectId: conversation.projectId, parentIssueId: conversation.parentId, status: conversation.status,
    assigneeAgentId: conversation.assigneeAgentId, assigneeUserId: conversation.assigneeUserId });
  if (actor.type === "agent") {
    const [active] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, routine.companyId), eq(heartbeatRuns.agentId, actor.agentId!), eq(heartbeatRuns.id, actor.runId!),
      eq(heartbeatRuns.responsibleUserId, userId!), eq(heartbeatRuns.status, "running")));
    if (!active) throw forbidden("The actual private routine reader is no longer active");
  }
}
