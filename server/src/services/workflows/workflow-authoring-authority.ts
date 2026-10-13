import { and, eq, sql } from "drizzle-orm";
import { heartbeatRuns, issues, type Db } from "@paperclipai/db";
import { forbidden } from "../../errors.js";
import { authorizationService } from "../authorization.js";

/** Use the canonical active run, never a caller-supplied responsible user. */
export async function assertWorkflowAuthoringAuthority(db: Db, context: {
  companyId: string; agentId: string; runId: string;
}, action: "workflows:edit" | "workflows:publish") {
  const [run] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, context.companyId), eq(heartbeatRuns.agentId, context.agentId),
    eq(heartbeatRuns.id, context.runId), eq(heartbeatRuns.status, "running"),
  ));
  if (!run) throw forbidden("Workflow authoring requires the current active run", { code: "workflow_authoring_run_required" });
  const snapshot = run.contextSnapshot ?? {};
  const issueId = run.nativeIssueId ?? snapshot.issueId ?? snapshot.taskId;
  if (typeof issueId === "string") {
    const [issue] = await db.select().from(issues).where(and(eq(issues.companyId, context.companyId), eq(issues.id, issueId),
      sql`not aw_workflow_memory_erased(${context.companyId}::uuid, null, ${issues.id})`));
    if (!issue || issue.conversationRetiredAt || (issue.conversationAgentId && (
      issue.conversationAgentId !== context.agentId || issue.conversationUserId !== run.responsibleUserId ||
      issue.conversationSessionGeneration !== (snapshot.conversationSessionGeneration ?? 0)
    ))) throw forbidden("Workflow authoring conversation is no longer current", { code: "workflow_authoring_context_changed" });
  }
  const decision = await authorizationService(db).decide({ actor: {
    type: "agent", companyId: context.companyId, agentId: context.agentId, runId: context.runId,
    onBehalfOfUserId: run.responsibleUserId,
  }, action, resource: { type: "company", companyId: context.companyId }, enforceResponsibleUserIntersection: true });
  if (!decision.allowed) throw forbidden(decision.explanation, { code: "permission_denied", permission: action, reason: decision.reason });
}
