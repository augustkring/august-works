import type { Db, workflowRuns } from "@paperclipai/db";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import type { WorkflowRunActor } from "./workflow-executor.js";
import { WorkflowCheckpointError } from "./workflow-errors.js";

type CreateTaskConfig = {
  title: string;
  description: string | null;
  projectId: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  waitForCompletion: boolean;
};

function workflowTaskAuthorizationActor(
  run: typeof workflowRuns.$inferSelect,
  actor: WorkflowRunActor,
): AuthorizationActor {
  const responsibleUserId =
    run.responsibleUserId ??
    actor.responsibleUserId ??
    (actor.principal.type === "agent"
      ? actor.principal.responsibleUserId
      : null);

  if (actor.principal.type === "agent") {
    return {
      type: "agent",
      agentId: actor.principal.agentId,
      companyId: run.companyId,
      source: "agent_jwt",
      runId: actor.runId ?? run.id,
      onBehalfOfUserId: responsibleUserId,
    };
  }
  if (actor.principal.type === "user") {
    return {
      type: "board",
      userId: actor.principal.userId,
      companyIds: [run.companyId],
      source: "session",
    };
  }
  if (responsibleUserId) {
    return {
      type: "board",
      userId: responsibleUserId,
      companyIds: [run.companyId],
      source: "session",
      ignoreInstanceAdmin: true,
    };
  }
  throw new WorkflowCheckpointError(
    "workflow_task_responsible_user_required",
    "Create Task requires an attributable user or agent responsible-user context",
  );
}

export async function assertWorkflowTaskAssignmentAuthorized(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  actor: WorkflowRunActor,
  config: CreateTaskConfig,
) {
  const decision = await authorizationService(db).decide({
    actor: workflowTaskAuthorizationActor(run, actor),
    action: "tasks:assign",
    resource: {
      type: "issue",
      companyId: run.companyId,
      projectId: config.projectId,
      parentIssueId: null,
      assigneeAgentId: config.assigneeAgentId,
      assigneeUserId: config.assigneeUserId,
      originKind: "workflow_task",
      originId: run.workflowId,
      status: config.assigneeAgentId || config.assigneeUserId ? "todo" : "backlog",
    },
    scope: {
      projectId: config.projectId,
      assigneeAgentId: config.assigneeAgentId,
      assigneeUserId: config.assigneeUserId,
    },
  });
  if (!decision.allowed) {
    throw new WorkflowCheckpointError(
      "workflow_task_permission_denied",
      decision.explanation,
    );
  }
}

