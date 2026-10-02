import { isDeepStrictEqual } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import { agents, heartbeatRuns, issues, workflowRevisions, workflowRuns, workflowStepRuns, workflowWaits, type Db } from "@paperclipai/db";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { persistActivity, publishActivity } from "../activity-log.js";
import { assertMemoryRecordsRetained, lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { validateWorkflowOutput, WorkflowOutputSchemaError } from "./workflow-output-schema.js";

/** An assigned agent submits once through its active, checked-out execution. Comments are never parsed as results. */
export async function submitWorkflowTaskResult(db: Db, input: {
  companyId: string; workflowRunId: string; nodeId: string; agentId: string; heartbeatRunId: string; result: unknown;
}) {
  const serialized = JSON.stringify(input.result);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > 1_000_000) {
    throw unprocessable("Task result must be bounded JSON", { code: "workflow_task_result_too_large" });
  }
  const accepted = await db.transaction(async (tx) => {
    await lockMemoryPrivacy(tx as unknown as Db, input.companyId);
    const [run] = await tx.select().from(workflowRuns).where(and(eq(workflowRuns.id, input.workflowRunId),
      eq(workflowRuns.companyId, input.companyId))).for("update");
    if (!run) throw notFound("Workflow run not found");
    if (run.status !== "waiting") throw conflict("Workflow is not waiting for a result", { code: "workflow_task_result_not_waiting" });
    const [step] = await tx.select().from(workflowStepRuns).where(and(eq(workflowStepRuns.companyId, input.companyId),
      eq(workflowStepRuns.workflowRunId, run.id), eq(workflowStepRuns.nodeId, input.nodeId)))
      .orderBy(desc(workflowStepRuns.attempt)).limit(1).for("update");
    const [wait] = await tx.select().from(workflowWaits).where(and(eq(workflowWaits.companyId, input.companyId),
      eq(workflowWaits.workflowRunId, run.id), eq(workflowWaits.nodeId, input.nodeId),
      eq(workflowWaits.kind, "task_completion"), eq(workflowWaits.status, "active")));
    if (!step || step.status !== "waiting" || !wait?.referenceId || wait.referenceType !== "issue" || step.agentId !== input.agentId) {
      throw forbidden("Result is not bound to this agent's waiting task", { code: "workflow_task_result_actor_mismatch" });
    }
    const [agent] = await tx.select().from(agents).where(and(eq(agents.id, input.agentId), eq(agents.companyId, input.companyId)));
    const [execution] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, input.heartbeatRunId),
      eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId)));
    const [issue] = await tx.select().from(issues).where(and(eq(issues.id, wait.referenceId),
      eq(issues.companyId, input.companyId))).for("update");
    if (!agent || !["idle", "running", "active"].includes(agent.status) || execution?.status !== "running" ||
      issue?.assigneeAgentId !== input.agentId || !["todo", "in_progress", "in_review", "blocked"].includes(issue.status) ||
      (issue.checkoutRunId !== input.heartbeatRunId && issue.executionRunId !== input.heartbeatRunId)) {
      throw forbidden("An active execution holding this task is required", { code: "workflow_task_result_execution_mismatch" });
    }
    await assertMemoryRecordsRetained(tx as unknown as Db, input.companyId, step.memoryRecordIds);
    const [revision] = await tx.select().from(workflowRevisions).where(and(eq(workflowRevisions.id, run.workflowRevisionId),
      eq(workflowRevisions.companyId, input.companyId)));
    const node = revision?.graph.nodes.find((item) => item.id === input.nodeId);
    if (node?.type !== "agent.task") throw conflict("Task result is not supported by this node");
    const schema = (node.config as Record<string, unknown>).expectedOutputSchema as Record<string, unknown> | null | undefined;
    if (!schema) throw conflict("This task has no structured output contract", { code: "workflow_task_result_contract_missing" });
    try { validateWorkflowOutput(schema, input.result); }
    catch (error) {
      if (error instanceof WorkflowOutputSchemaError) throw unprocessable(error.message, { code: error.code, validationErrors: error.validationErrors });
      throw error;
    }
    if (step.taskResultAcceptedAt) {
      if (!isDeepStrictEqual(step.taskResultJson, input.result) || step.taskResultRunId !== input.heartbeatRunId) {
        throw conflict("An accepted task result is immutable", { code: "workflow_task_result_already_accepted" });
      }
      return { stepId: step.id, acceptedAt: step.taskResultAcceptedAt, publication: null };
    }
    const now = new Date();
    await tx.update(workflowStepRuns).set({ taskResultJson: input.result, taskResultAcceptedAt: now,
      taskResultRunId: input.heartbeatRunId, updatedAt: now }).where(eq(workflowStepRuns.id, step.id));
    const audit = await persistActivity(tx as unknown as Db, { companyId: input.companyId, actorType: "agent",
      actorId: input.agentId, agentId: input.agentId, runId: input.heartbeatRunId,
      action: "workflow.task_result_accepted", entityType: "workflow_step_run", entityId: step.id,
      details: { workflowRunId: run.id, nodeId: input.nodeId, issueId: issue.id } });
    return { stepId: step.id, acceptedAt: now, publication: audit.publication };
  });
  if (accepted.publication) publishActivity(accepted.publication);
  return { stepId: accepted.stepId, acceptedAt: accepted.acceptedAt.toISOString() };
}
