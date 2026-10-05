import { and, eq, sql } from "drizzle-orm";
import { agentExecutionManifests, agents, documents, issueDocuments, issuePlanDecompositions, issueThreadInteractions, heartbeatRuns, issues, orchestrationPlans, orchestrationWorkers, orchestrationWorkerAttempts, workflowRuns, type Db } from "@paperclipai/db";
import { type ReadinessAction } from "@paperclipai/shared";
import { conflict, forbidden } from "../../errors.js";
import { assertV7Authorization, assertV7Enabled } from "../v7-authorization.js";
import type { AuthorizationActor } from "../authorization.js";
import { agentRunWritesRevoked } from "../../agent-run-cancellation.js";
import { readinessService } from "../readiness/readiness-service.js";
import type { ActivityPublication } from "../activity-log.js";
import { logActivity } from "../v7-mutations.js";
import { retainedOrchestrationContract } from "./orchestration-contracts.js";

type Plan = typeof orchestrationPlans.$inferSelect;
/** Called under the plan lock. Terminal provider runs release slots, never certify work. */
export async function reconcileOrchestrationAttempts(tx: Db, plan: Plan) {
  const attempts = await tx.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, plan.companyId), eq(orchestrationWorkerAttempts.planId, plan.id), eq(orchestrationWorkerAttempts.status, "running")));
  for (const attempt of attempts) {
    const [run] = attempt.runId
      ? await tx.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, plan.companyId), eq(heartbeatRuns.id, attempt.runId)))
      : await tx.select({ status: workflowRuns.status }).from(workflowRuns).where(and(eq(workflowRuns.companyId, plan.companyId), eq(workflowRuns.id, attempt.workflowRunId!)));
    if (!run || !["succeeded", "failed", "cancelled", "timed_out"].includes(run.status)) continue;
    await tx.update(orchestrationWorkerAttempts).set({ status: run.status === "succeeded" ? "succeeded" : run.status === "cancelled" ? "cancelled" : "failed", finishedAt: new Date(), updatedAt: new Date() }).where(eq(orchestrationWorkerAttempts.id, attempt.id));
    await tx.update(orchestrationWorkers).set({ status: ["cancelled", "failed"].includes(plan.status) ? "cancelled" : "waiting", updatedAt: new Date() }).where(and(eq(orchestrationWorkers.id, attempt.workerId), eq(orchestrationWorkers.status, "running")));
  }
}
async function scope(tx: Db, companyId: string, issueId: string) {
  const [worker] = await tx.select({ worker: orchestrationWorkers, plan: orchestrationPlans }).from(orchestrationWorkers).innerJoin(orchestrationPlans, and(eq(orchestrationPlans.companyId, orchestrationWorkers.companyId), eq(orchestrationPlans.id, orchestrationWorkers.planId)))
    .where(and(eq(orchestrationWorkers.companyId, companyId), eq(orchestrationWorkers.issueId, issueId), sql`${orchestrationPlans.status} not in ('completed','cancelled','failed')`)).limit(1);
  if (worker) return worker;
  const [root] = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, companyId), eq(orchestrationPlans.issueId, issueId), sql`${orchestrationPlans.status} not in ('completed','cancelled','failed')`)).limit(1);
  if (root) throw forbidden("The coordinator Task cannot execute as a worker of its parallel plan");
  return null;
}
export async function hasOrchestrationPlan(db: Db, companyId: string, issueId: string | null) {
  return issueId ? Boolean(await scope(db, companyId, issueId)) : false;
}
async function admit(tx: Db, input: { companyId: string; issueId: string; actor: AuthorizationActor; runId?: string; workflowRunId?: string; executionManifestId?: string }, publications: ActivityPublication[]) {
  const binding = await scope(tx, input.companyId, input.issueId);
  if (!binding) return null;
  const [plan] = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, input.companyId), eq(orchestrationPlans.id, binding.plan.id))).for("update");
  await assertV7Enabled(tx, "orchestration_v7");
  if (!plan || plan.erasedAt || plan.status !== "running" || !plan.startedAt) throw forbidden("The orchestration plan is not running");
  if (Date.now() >= plan.startedAt.getTime() + plan.budgets.maxWallClockSeconds * 1000) throw forbidden("The orchestration deadline expired");
  if (!plan.executionPrincipal || (plan.executionPrincipal.type !== "user" && !(plan.executionPrincipal.type === "system" && plan.executionPrincipal.service === "local-board"))) throw forbidden("The plan requires its current initiating human principal");
  if (input.runId && plan.mode === "workflow_bound") throw forbidden("Deterministic plans execute through their pinned Workflow, not a semantic worker");
  if (plan.budgets.maxModelCostMinor !== null) throw forbidden("A pre-spend reservation broker has not qualified this plan cost cap");
  const [task] = await tx.select().from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).for("share");
  const [worker] = await tx.select().from(orchestrationWorkers).where(and(eq(orchestrationWorkers.companyId, input.companyId), eq(orchestrationWorkers.id, binding.worker.id)));
  if (!task || !worker || ["done", "cancelled"].includes(task.status) || task.assigneeAgentId !== worker.agentId) throw forbidden("Worker no longer has the plan's canonical assignment");
  await assertV7Authorization(tx, input.actor, input.companyId, "issue:mutate", { type: "issue", companyId: input.companyId, issueId: task.id, projectId: task.projectId, parentIssueId: task.parentId, assigneeAgentId: task.assigneeAgentId, assigneeUserId: task.assigneeUserId, status: task.status });
  const initiatingActor: AuthorizationActor = plan.executionPrincipal.type === "user" ? { type: "board", source: "session", userId: plan.executionPrincipal.userId } : { type: "board", source: "local_implicit" };
  await assertV7Authorization(tx, initiatingActor, input.companyId, "issue:mutate", { type: "issue", companyId: input.companyId, issueId: task.id, projectId: task.projectId, parentIssueId: task.parentId, assigneeAgentId: task.assigneeAgentId, assigneeUserId: task.assigneeUserId, status: task.status });
  if (input.actor.type === "agent" && input.actor.agentId !== worker.agentId) throw forbidden("Execution cannot assume another worker's identity");
  const [root] = await tx.select().from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, plan.issueId))).for("share");
  if (!root || (plan.mode === "planned_parallel" && (task.parentId !== root.id || task.projectId !== root.projectId)) || ["done", "cancelled"].includes(root.status) || task.requestDepth - root.requestDepth > plan.budgets.maxDelegationDepth) throw forbidden("Canonical coordinator or delegation depth changed");
  if (input.runId && ((task.executionRunId && task.executionRunId !== input.runId) || (task.checkoutRunId && task.checkoutRunId !== input.runId))) throw forbidden("Another canonical run owns this Task");
  if (plan.mode === "planned_parallel") {
    const [accepted] = await tx.select().from(issuePlanDecompositions).where(and(eq(issuePlanDecompositions.companyId, input.companyId), eq(issuePlanDecompositions.sourceIssueId, root.id), eq(issuePlanDecompositions.acceptedPlanRevisionId, plan.acceptedPlanRevisionId!)));
    const [current] = await tx.select({ revisionId: documents.latestRevisionId }).from(issueDocuments).innerJoin(documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId))).where(and(eq(issueDocuments.companyId, input.companyId), eq(issueDocuments.issueId, root.id), eq(issueDocuments.key, "plan"))).for("share", { of: documents });
    const [confirmation] = accepted?.acceptedInteractionId ? await tx.select().from(issueThreadInteractions).where(and(eq(issueThreadInteractions.companyId, input.companyId), eq(issueThreadInteractions.id, accepted.acceptedInteractionId))) : [];
    if (!accepted || accepted.status !== "completed" || current?.revisionId !== plan.acceptedPlanRevisionId || confirmation?.status !== "accepted") throw forbidden("Canonical plan acceptance changed");
  }
  await retainedOrchestrationContract(tx, input.companyId, input.issueId);
  await reconcileOrchestrationAttempts(tx, plan);
  const peers = await tx.select().from(orchestrationWorkers).where(and(eq(orchestrationWorkers.companyId, input.companyId), eq(orchestrationWorkers.planId, plan.id)));
  if (peers.length > plan.budgets.maxWorkerCount) throw forbidden("The total worker budget is exceeded");
  if (worker.dependsOn.some(key => peers.find(peer => peer.workerKey === key)?.status !== "completed")) throw forbidden("Explicit worker joins are incomplete");
  // Reassess authorized evidence at admission. A historical ready label is not authority.
  if (worker.agentId) {
    const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, input.companyId), eq(agents.id, worker.agentId))).for("share");
    if (!agent || !["idle", "running", "error"].includes(agent.status)) throw forbidden("Worker presence is no longer invokable");
    const assessment = await readinessService(tx).assess(input.companyId, { agentId: worker.agentId, actionClass: plan.actionClass as ReadinessAction, subjectType: "task", subjectId: task.id, query: task.title.slice(0, 500) },
      { actor: input.actor as Parameters<ReturnType<typeof readinessService>["assess"]>[2]["actor"], principalId: input.actor.type === "agent" ? worker.agentId : input.actor.userId ?? "local-board", userId: input.actor.onBehalfOfUserId ?? input.actor.userId ?? null }, publications);
    if (!["ready", "ready_with_warnings"].includes(assessment.status)) throw forbidden("Current action-specific Readiness does not permit execution", { assessmentId: assessment.id, status: assessment.status });
  } else if (plan.actionClass !== "internal_draft") throw forbidden("Material Workflow plans require an assigned readiness subject");
  const [existing] = await tx.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, input.companyId), input.runId ? eq(orchestrationWorkerAttempts.runId, input.runId) : eq(orchestrationWorkerAttempts.workflowRunId, input.workflowRunId!)));
  if (existing) {
    if (existing.planId !== plan.id || existing.workerId !== worker.id || existing.status !== "running") throw forbidden("Worker attempt is no longer current");
    if (input.executionManifestId && existing.executionManifestId && existing.executionManifestId !== input.executionManifestId) throw conflict("Execution manifest changed");
    if (input.executionManifestId && !existing.executionManifestId) await tx.update(orchestrationWorkerAttempts).set({ executionManifestId: input.executionManifestId }).where(eq(orchestrationWorkerAttempts.id, existing.id));
    return existing;
  }
  if (["completed", "cancelled", "failed"].includes(worker.status)) throw forbidden("Worker is terminal");
  const live = await tx.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.planId, plan.id), eq(orchestrationWorkerAttempts.status, "running")));
  if (live.some(attempt => attempt.workerId === worker.id) || live.length >= plan.budgets.maxParallelWorkers) throw conflict("The bounded worker concurrency is occupied");
  const retry = worker.attemptCount > 0;
  if (retry && plan.retriesUsed >= plan.budgets.maxRetries) throw forbidden("The cumulative plan retry budget is exhausted");
  const [attempt] = await tx.insert(orchestrationWorkerAttempts).values({ companyId: input.companyId, planId: plan.id, workerId: worker.id, agentId: worker.agentId, runId: input.runId ?? null, workflowRunId: input.workflowRunId ?? null, executionManifestId: input.executionManifestId ?? null, attempt: worker.attemptCount + 1 }).returning();
  await tx.update(orchestrationWorkers).set({ status: "running", attemptCount: worker.attemptCount + 1, updatedAt: new Date() }).where(eq(orchestrationWorkers.id, worker.id));
  await tx.update(orchestrationPlans).set({ retriesUsed: plan.retriesUsed + Number(retry), updatedAt: new Date() }).where(eq(orchestrationPlans.id, plan.id));
  await logActivity(tx, { companyId: input.companyId, actorType: "system", actorId: "orchestration-admission", action: "orchestration.worker_admitted", entityType: "orchestration_plan", entityId: plan.id, details: { workerId: worker.id, attemptId: attempt!.id, runId: input.runId ?? null, workflowRunId: input.workflowRunId ?? null } }, publications);
  return attempt!;
}
export async function admitOrchestrationHeartbeat(tx: Db, input: { companyId: string; issueId: string | null; agentId: string; runId: string; responsibleUserId: string | null; executionManifestId: string }, publications: ActivityPublication[]) {
  if (!input.issueId) return null;
  const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.agentId, input.agentId)));
  if (!await hasOrchestrationPlan(tx, input.companyId, input.issueId)) return null;
  if (!run || !["queued", "running"].includes(run.status) || agentRunWritesRevoked(run) || run.responsibleUserId !== input.responsibleUserId || (run.contextSnapshot?.issueId ?? run.contextSnapshot?.nativeIssueId) !== input.issueId) throw forbidden("Current persisted Task worker authority is required");
  const [manifest] = await tx.select({ id: agentExecutionManifests.id }).from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, input.companyId), eq(agentExecutionManifests.id, input.executionManifestId), eq(agentExecutionManifests.agentId, input.agentId), eq(agentExecutionManifests.runId, input.runId)));
  if (!manifest) throw forbidden("The attempt requires this run's actual Runtime Fabric manifest");
  return admit(tx, { ...input, issueId: input.issueId, actor: { type: "agent", source: "agent_jwt", companyId: input.companyId, agentId: input.agentId, runId: input.runId, onBehalfOfUserId: input.responsibleUserId } }, publications);
}
export async function admitOrchestrationWorkflow(tx: Db, run: typeof workflowRuns.$inferSelect, actor: AuthorizationActor, publications: ActivityPublication[]) {
  if (run.source !== "task") return null;
  const task = run.triggerPayload.task;
  const issueId = task && typeof task === "object" && "id" in task && typeof task.id === "string" ? task.id : null;
  if (!issueId) return null;
  const binding = await scope(tx, run.companyId, issueId);
  if (!binding) return null;
  if (binding.plan.mode !== "workflow_bound" || binding.plan.workflowId !== run.workflowId || binding.plan.workflowRevisionId !== run.workflowRevisionId) throw forbidden("The Task plan is bound to a different execution mode or Workflow");
  return admit(tx, { companyId: run.companyId, issueId, workflowRunId: run.id, actor }, publications);
}
