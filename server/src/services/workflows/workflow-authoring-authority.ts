import { and, eq, sql } from "drizzle-orm";
import { authUsers, heartbeatRuns, issues, type Db } from "@paperclipai/db";
import { forbidden } from "../../errors.js";
import { authorizationService } from "../authorization.js";
import { assertAgentRunWriteAllowed } from "../../agent-run-cancellation.js";

/** Use the canonical active run, never a caller-supplied responsible user. */
export async function assertWorkflowAuthoringAuthority(db: Db, context: {
  companyId: string; agentId: string; runId: string;
}, action: "workflows:edit" | "workflows:publish") {
  const [run] = await db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, context.companyId), eq(heartbeatRuns.agentId, context.agentId),
    eq(heartbeatRuns.id, context.runId), eq(heartbeatRuns.status, "running"),
  ));
  if (!run) throw forbidden("Workflow authoring requires the current active run", { code: "workflow_authoring_run_required" });
  if (run.responsibleUserId !== null) {
    // When called by the Original mutation transaction this share lock keeps
    // the canonical account qualification stable until that write commits.
    const [account] = await db.select({ verified: authUsers.emailVerified }).from(authUsers)
      .where(eq(authUsers.id, run.responsibleUserId)).for("share");
    if (!account?.verified) throw forbidden("Current verified account is required for conversation authoring", {
      code: "workflow_authoring_account_unavailable",
    });
  }
  const snapshot = run.contextSnapshot ?? {};
  const issueId = run.nativeIssueId ?? snapshot.issueId ?? snapshot.taskId;
  if (run.runtimeMode === "native" && !run.nativeIssueId)
    throw forbidden("Native workflow authoring requires its current Task owner");
  if (typeof issueId === "string") {
    const [issue] = await db.select().from(issues).where(and(eq(issues.companyId, context.companyId), eq(issues.id, issueId),
      sql`not aw_workflow_memory_erased(${context.companyId}::uuid, null, ${issues.id})`)).for("share");
    if (!issue || issue.conversationRetiredAt || (issue.conversationAgentId && (
      issue.conversationAgentId !== context.agentId || issue.conversationUserId !== run.responsibleUserId ||
      issue.conversationSessionGeneration !== (snapshot.conversationSessionGeneration ?? 0)
    ))) throw forbidden("Workflow authoring conversation is no longer current", { code: "workflow_authoring_context_changed" });
    if (run.runtimeMode === "native" && (issue.assigneeAgentId !== context.agentId || issue.executionRunId !== run.id ||
      issue.workMode !== "standard" || issue.hiddenAt || ["cancelled", "done"].includes(issue.status)))
      throw forbidden("The Native run no longer owns standard authoring execution", { code: "workflow_authoring_context_changed" });
  }
  if (run.runtimeMode === "native") await assertAgentRunWriteAllowed(db, context.companyId, context);
  const decision = await authorizationService(db).decide({ actor: {
    type: "agent", companyId: context.companyId, agentId: context.agentId, runId: context.runId,
    onBehalfOfUserId: run.responsibleUserId,
  }, action, resource: { type: "company", companyId: context.companyId }, enforceResponsibleUserIntersection: true });
  if (!decision.allowed) throw forbidden(decision.explanation, { code: "permission_denied", permission: action, reason: decision.reason });
}
