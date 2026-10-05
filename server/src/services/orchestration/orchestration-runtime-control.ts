import { and, eq } from "drizzle-orm";
import { orchestrationWorkerAttempts, orchestrationPlans, type Db } from "@paperclipai/db";
import { forbidden } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { heartbeatService } from "../heartbeat.js";
import { workflowExecutorService } from "../workflows/workflow-executor.js";
import { orchestrationService } from "./orchestration-service.js";

/** Uses the canonical dispatch/cancellation engines; there is no second queue. */
export function orchestrationRuntimeControl(db: Db) {
  const service = orchestrationService(db), heartbeat = heartbeatService(db), workflow = workflowExecutorService(db, { heartbeat });
  const workflowActor = (actor: AuthorizationActor) => ({ principal: actor.source === "local_implicit" ? { type: "system" as const, service: "local-board" } : { type: "user" as const, userId: v7HumanActorId(actor) }, responsibleUserId: actor.source === "local_implicit" ? null : v7HumanActorId(actor) });
  return {
    /** Internal reconciliation only: persisted plan fencing precedes physical cancellation. */
    stopFencedPlan: async (companyId: string, id: string, reason: string) => {
      const [plan] = await db.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, companyId), eq(orchestrationPlans.id, id)));
      if (!plan || plan.status === "running") throw forbidden("Safety cancellation requires a durably fenced plan");
      const attempts = await db.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.planId, id), eq(orchestrationWorkerAttempts.status, "running")));
      for (const attempt of attempts) {
        if (attempt.runId) await heartbeat.cancelRun(attempt.runId, reason);
        else if (attempt.workflowRunId) await workflow.cancelRun(companyId, attempt.workflowRunId, { reason }, { principal: { type: "system", service: "orchestration_supervision" } });
      }
      return attempts.map(attempt => attempt.id);
    },
    dispatch: async (actor: AuthorizationActor, companyId: string, id: string, targetWorkerId?: string) => {
      const plan = await service.get(actor, companyId, id);
      if (plan.status !== "running") return [];
      const ready = plan.workers.filter(worker => worker.status === "waiting" && (!targetWorkerId || worker.id === targetWorkerId) && plan.attempts.filter(a => a.workerId === worker.id).sort((a,b) => b.attempt-a.attempt)[0]?.status !== "succeeded" && worker.dependsOn.every(key => plan.workers.find(peer => peer.workerKey === key)?.status === "completed"));
      const slots = Math.max(0, plan.budgets.maxParallelWorkers - plan.attempts.filter(attempt => attempt.status === "running").length);
      const outcomes: Array<{ workerId: string; runId: string | null; error: string | null }> = [];
      for (const worker of ready.slice(0, slots)) {
        try {
          if (plan.workflowId) {
            await assertV7Authorization(db, actor, companyId, "workflows:run");
            const result = await workflow.startTaskRun(companyId, worker.issueId, plan.workflowId, { input: {}, revisionId: plan.workflowRevisionId! }, workflowActor(actor), `aw-plan:${id}:${worker.id}:${worker.attemptCount + 1}`);
            outcomes.push({ workerId: worker.id, runId: result.run.id, error: null });
          } else {
            await assertV7Authorization(db, actor, companyId, "agent:wake", { type: "agent", companyId, agentId: worker.agentId });
            const run = await heartbeat.wakeup(worker.agentId!, { source: "on_demand", triggerDetail: "manual", manualUserWake: true, reason: "v7_orchestration_plan", requestedByActorType: "user", requestedByActorId: v7HumanActorId(actor),
              idempotencyKey: `aw-plan:${id}:${worker.id}:${worker.attemptCount + 1}`, allowRunCoalescing: false,
              payload: { issueId: worker.issueId, v7OrchestrationPlanId: id }, contextSnapshot: { failedRunId: plan.attempts.filter(a => a.workerId === worker.id && a.status === "failed").sort((a,b) => b.attempt-a.attempt)[0]?.runId ?? undefined, issueId: worker.issueId, v7OrchestrationPlanId: id, responsibleUserId: actor.source === "local_implicit" ? null : v7HumanActorId(actor) },
              issueStateGuard: { statuses: ["todo", "in_progress", "in_review", "blocked"], assigneeAgentId: worker.agentId! } });
            outcomes.push({ workerId: worker.id, runId: run?.id ?? null, error: run ? null : "Canonical queue did not dispatch this Task" });
          }
        } catch (error) { outcomes.push({ workerId: worker.id, runId: null, error: error instanceof Error ? error.message : "Dispatch failed" }); }
      }
      return outcomes;
    },
    stop: async (actor: AuthorizationActor, companyId: string, id: string, reason: string) => {
      const plan = await service.get(actor, companyId, id, true);
      const attempts = await db.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.planId, id), eq(orchestrationWorkerAttempts.status, "running")));
      const outcomes: Array<{ attemptId: string; stopRequested: boolean; error: string | null }> = [];
      for (const attempt of attempts) {
        try {
          if (attempt.runId) {
            await assertV7Authorization(db, actor, companyId, "runtime:manage", { type: "agent", companyId, agentId: attempt.agentId });
            await heartbeat.cancelRun(attempt.runId, reason);
          } else if (attempt.workflowRunId) {
            await assertV7Authorization(db, actor, companyId, "workflows:run");
            await workflow.cancelRun(companyId, attempt.workflowRunId, { reason }, workflowActor(actor));
          }
          outcomes.push({ attemptId: attempt.id, stopRequested: true, error: null });
        } catch (error) { outcomes.push({ attemptId: attempt.id, stopRequested: false, error: error instanceof Error ? error.message : "Stop failed" }); }
      }
      return { planStatus: plan.status, attempts: outcomes };
    },
  };
}
