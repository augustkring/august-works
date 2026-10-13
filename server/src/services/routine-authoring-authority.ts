import { and, eq } from "drizzle-orm";
import { agents, authUsers, heartbeatRuns, issues, type Db } from "@paperclipai/db";
import { z } from "zod";
import { v9FeatureEnabled } from "@paperclipai/shared";
import { instanceSettingsService } from "./instance-settings.js";
import { assertV5Authorization } from "./v5-authorization.js";
import { authorizationService } from "./authorization.js";
import { assertAnalyticalContextPayloadAccess } from "./analytical-context-authority.js";
import { forbidden, notFound } from "../errors.js";

/** The V9 conversational route creates drafts; generic Agent HTTP mutation
 * cannot silently substitute an enabled routine for that reviewed boundary. */
export async function assertRoutineConversationDraftEntry(db: Db, companyId: string, actor: { agentId?: string | null; runId?: string | null }) {
  if (!actor.agentId || !actor.runId || !v9FeatureEnabled(await instanceSettingsService(db).getExperimental(), "ambient_commands_v9")) return;
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
    eq(heartbeatRuns.agentId, actor.agentId), eq(heartbeatRuns.id, actor.runId)));
  const id = run?.nativeIssueId ?? run?.contextSnapshot?.issueId ?? run?.contextSnapshot?.taskId;
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return;
  const [conversation] = await db.select({ agentId: issues.conversationAgentId }).from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.id, id)));
  if (conversation?.agentId) throw forbidden("Use the conversation routine draft action; a Human configures and enables the saved routine");
}

export async function assertConversationRoutineAuthoring(db: Db, context: { companyId: string; agentId: string; runId: string }) {
  if (!v9FeatureEnabled(await instanceSettingsService(db).getExperimental(), "ambient_commands_v9"))
    throw notFound("Conversation authoring is not enabled");
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, context.companyId),
    eq(heartbeatRuns.agentId, context.agentId), eq(heartbeatRuns.id, context.runId), eq(heartbeatRuns.status, "running")));
  if (!run?.responsibleUserId) throw forbidden("A current responsible conversation user is required");
  const [account] = await db.select({ verified: authUsers.emailVerified }).from(authUsers)
    .where(eq(authUsers.id, run.responsibleUserId)).for("share");
  const [agent] = await db.select({ status: agents.status }).from(agents)
    .where(and(eq(agents.companyId, context.companyId), eq(agents.id, context.agentId))).for("share");
  if (!account?.verified || !agent || !["idle", "running", "active"].includes(agent.status))
    throw forbidden("Current verified user and Agent admission are required");
  const human = { type: "board" as const, source: "session" as const, userId: run.responsibleUserId,
    ignoreInstanceAdmin: true, isInstanceAdmin: false };
  await assertV5Authorization(db, human, context.companyId, "tasks:assign");
  const conversationId = run.nativeIssueId ?? run.contextSnapshot?.issueId ?? run.contextSnapshot?.taskId;
  if (typeof conversationId !== "string" || !z.uuid().safeParse(conversationId).success) throw forbidden("A current conversation is required");
  const [conversation] = await db.select().from(issues).where(and(eq(issues.companyId, context.companyId), eq(issues.id, conversationId))).for("share");
  if (!conversation || conversation.conversationAgentId !== context.agentId || conversation.conversationUserId !== run.responsibleUserId ||
    conversation.conversationRetiredAt || conversation.originKind === "routine_execution" ||
    conversation.conversationSessionGeneration !== (run.contextSnapshot?.conversationSessionGeneration ?? 0))
    throw forbidden("The authoring conversation is no longer current");
  if (run.runtimeMode === "native" && (conversation.executionRunId !== run.id || conversation.assigneeAgentId !== context.agentId))
    throw forbidden("The Native run no longer owns the authoring conversation");
  const [lockedRun] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, context.companyId),
    eq(heartbeatRuns.agentId, context.agentId), eq(heartbeatRuns.id, context.runId), eq(heartbeatRuns.status, "running"))).for("share");
  if (!lockedRun || lockedRun.responsibleUserId !== run.responsibleUserId ||
    (lockedRun.nativeIssueId ?? lockedRun.contextSnapshot?.issueId ?? lockedRun.contextSnapshot?.taskId) !== conversationId ||
    (lockedRun.contextSnapshot?.conversationSessionGeneration ?? 0) !== conversation.conversationSessionGeneration)
    throw forbidden("The current conversation run changed");
  const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId: context.companyId,
    agentId: context.agentId, runId: run.id, onBehalfOfUserId: run.responsibleUserId };
  const access = await authorizationService(db).decide({ actor, action: "tasks:assign", resource: { type: "company", companyId: context.companyId },
    enforceResponsibleUserIntersection: true });
  if (!access.allowed) throw forbidden("Current routine authoring authority is required");
  await assertAnalyticalContextPayloadAccess(db, context.companyId, actor, { runId: run.id });
  await assertAnalyticalContextPayloadAccess(db, context.companyId, actor, { issueId: conversation.id });
  return { run, conversation, responsibleUserId: run.responsibleUserId };
}
