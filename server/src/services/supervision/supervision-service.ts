import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { agents, completionContracts, documents, heartbeatRuns, issueDocuments, issueThreadInteractions, issues, orchestrationPlans, orchestrationWorkers, orchestrationWorkerAttempts, orchestrationToolCharges, supervisionSessions, supervisionSignals, supervisionInterventions, toolInvocations, type Db } from "@paperclipai/db";
import { supervisionInterventionSchema, v7FeatureEnabled, type SupervisionInterventionInput, type SupervisionSignalType, type ReadinessAction } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { assertDerivedManager } from "../memory/derived-memory.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { readinessService } from "../readiness/readiness-service.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { orchestrationService } from "../orchestration/orchestration-service.js";
import { orchestrationRuntimeControl } from "../orchestration/orchestration-runtime-control.js";
import { reconcileOrchestrationAttempts } from "../orchestration/orchestration-admission.js";
import { issueService, executeIssuePostCommitActions, type IssuePostCommitAction } from "../issues.js";
import { retainedOrchestrationContract } from "../orchestration/orchestration-contracts.js";
import { logger } from "../../middleware/logger.js";
import { conflict, notFound } from "../../errors.js";
import { arbitrateSupervision, type SupervisionSnapshot } from "./supervision-policy.js";
import { ensureSupervisionSession, enqueueSupervisionStop } from "./supervision-outbox.js";

/** Observes canonical facts, never hidden reasoning or worker-reported completion. */
export function supervisionService(db: Db) {
  async function observe(companyId: string, id: string, human?: { actor: AuthorizationActor; input: SupervisionInterventionInput }) {
    const postCommitActions: IssuePostCommitAction[] = [];
    const outcome = await withV7ActivityTransaction(db, async (tx, publications) => {
      await lockMemoryPrivacy(tx, companyId);
      const [plan] = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, companyId), eq(orchestrationPlans.id, id))).for("update");
      if (!plan) throw notFound("Orchestration plan not found");
      const input = human ? supervisionInterventionSchema.parse(human.input) : null;
      if (human) {
        await assertDerivedManager(tx, human.actor, companyId);
        if (input!.expectedPlanVersion !== plan.version) throw conflict("Plan changed; reload supervision before intervening");
        
      }
      const session = await ensureSupervisionSession(tx, plan), now = new Date();
      const experimental = await instanceSettingsService(tx).getExperimental();
      const enabled = v7FeatureEnabled(experimental, "supervision_v7");
      // Safety controls still reconcile when the observation interval or feature gate is closed.
      if (!human && enabled && !plan.erasedAt && plan.status === "running" && session.lastObservedAt && now.getTime() - session.lastObservedAt.getTime() < plan.supervisionPolicy.minCheckIntervalSeconds * 1000) return null;
      await reconcileOrchestrationAttempts(tx, plan);
      const workers = await tx.select().from(orchestrationWorkers).where(and(eq(orchestrationWorkers.companyId, companyId), eq(orchestrationWorkers.planId, id)));
      const attempts = await tx.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.planId, id))).orderBy(desc(orchestrationWorkerAttempts.createdAt));
      const tasks = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), inArray(issues.id, [...new Set([plan.issueId, ...workers.map(w => w.issueId)])]))).for("share");
      const contracts = await tx.select().from(completionContracts).where(and(eq(completionContracts.companyId, companyId), inArray(completionContracts.id, [plan.completionContractId, ...workers.map(w => w.completionContractId)])));
      const sourceCurrent = !plan.erasedAt && contracts.length === new Set([plan.completionContractId, ...workers.map(w => w.completionContractId)]).size && contracts.every(c => c.contractJson.payloadDeleted !== true);
      const principal = plan.executionPrincipal;
      const actor: AuthorizationActor | null = principal?.type === "user" ? { type: "board", source: "session", userId: principal.userId } : principal?.type === "system" && principal.service === "local-board" ? { type: "board", source: "local_implicit" } : null;
      let authorityCurrent = Boolean(actor), readinessAllows = true;
      const live = attempts.filter(a => a.status === "running");
      const authorizationFailure = (error: unknown) => error && typeof error === "object" && "status" in error && [403,404,409].includes(Number(error.status));
      for (const worker of workers) {
        const task = tasks.find(t => t.id === worker.issueId), root = tasks.find(t => t.id === plan.issueId);
        if (!task || !root || task.assigneeAgentId !== worker.agentId || (plan.mode === "planned_parallel" && (task.parentId !== root.id || task.projectId !== root.projectId))) { authorityCurrent = false; continue; }
        const resource = { type: "issue" as const, companyId, issueId: task.id, projectId: task.projectId, parentIssueId: task.parentId, assigneeAgentId: task.assigneeAgentId, assigneeUserId: task.assigneeUserId, status: task.status };
        if (human) await assertV7Authorization(tx, human.actor, companyId, "issue:mutate", resource);
        try {
          if (sourceCurrent && !["completed","cancelled","failed"].includes(plan.status)) await retainedOrchestrationContract(tx,companyId,worker.issueId);
          if (actor) await assertV7Authorization(tx, actor, companyId, "issue:mutate", resource);
          for (const attempt of live.filter(a => a.workerId === worker.id && a.runId)) {
            const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, attempt.runId!)));
            if (!run) { authorityCurrent = false; continue; }
            await assertV7Authorization(tx, { type: "agent", source: "agent_jwt", companyId, agentId: worker.agentId!, runId: run.id, onBehalfOfUserId: run.responsibleUserId }, companyId, "issue:mutate", resource);
          }
        } catch (error) { if (!authorizationFailure(error)) throw error; authorityCurrent = false; }
        if (enabled && sourceCurrent && authorityCurrent && actor && worker.agentId && plan.status === "running") {
          try {
            await agentProviderBindingService(tx).assertRuntime(companyId, worker.agentId);
            const assessment = await readinessService(tx).assess(companyId, { agentId: worker.agentId, actionClass: plan.actionClass as ReadinessAction, subjectType: "task", subjectId: task.id, query: task.title.slice(0,500) }, { actor: actor as Parameters<ReturnType<typeof readinessService>["assess"]>[2]["actor"], principalId: actor.userId ?? "local-board", userId: actor.userId ?? null }, publications);
            if (!["ready","ready_with_warnings"].includes(assessment.status)) readinessAllows = false;
          } catch (error) { if (!authorizationFailure(error)) throw error; readinessAllows = false; }
        }
      }
      const receipts = await tx.select({ receipt: toolInvocations }).from(orchestrationToolCharges).innerJoin(toolInvocations, and(eq(toolInvocations.companyId, orchestrationToolCharges.companyId), eq(toolInvocations.id, orchestrationToolCharges.invocationId))).where(and(eq(orchestrationToolCharges.companyId, companyId), eq(orchestrationToolCharges.planId, id))).orderBy(desc(toolInvocations.createdAt), desc(toolInvocations.id)).limit(100);
      let repeatedFailures = 0, fingerprint: string | null = null;
      for (const { receipt } of receipts) {
        if (receipt.status !== "failed") break;
        const hash = nativeSha256({ tool: receipt.toolName, arguments: receipt.argumentsHash, error: receipt.errorCode });
        if (fingerprint && fingerprint !== hash) break;
        fingerprint = hash; repeatedFailures++;
      }
      const outputs = await tx.select({ issueId: issueDocuments.issueId, key: issueDocuments.key, body: documents.latestBody }).from(issueDocuments).innerJoin(documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId))).where(and(eq(issueDocuments.companyId, companyId), inArray(issueDocuments.issueId, workers.map(w => w.issueId)))).orderBy(issueDocuments.issueId, issueDocuments.key);
      const progressHash = nativeSha256({ outputs: outputs.map(o => ({ task: o.issueId, key: o.key, hash: nativeSha256(o.body) })), successes: receipts.filter(r => r.receipt.status === "succeeded").map(r => r.receipt.id).sort() });
      const progressed = session.progressHash !== progressHash;
      const lastProgressAt = progressed && session.progressHash ? now : session.lastProgressAt ?? plan.startedAt ?? now;
      const [humanWait] = await tx.select({ id: issueThreadInteractions.id }).from(issueThreadInteractions).where(and(eq(issueThreadInteractions.companyId, companyId), inArray(issueThreadInteractions.issueId, tasks.map(t => t.id)), eq(issueThreadInteractions.status, "pending"))).limit(1);
      const snapshot: SupervisionSnapshot = { planStatus: plan.status, featureEnabled: enabled, sourceCurrent, authorityCurrent, readinessAllows,
        deadlineExpired: !!plan.startedAt && now.getTime() >= plan.startedAt.getTime() + plan.budgets.maxWallClockSeconds * 1000,
        checkBudgetExhausted: plan.supervisorChecksUsed >= plan.supervisionPolicy.maxSupervisorChecks,
        repeatedFailures, repeatedFailureThreshold: plan.supervisionPolicy.repeatedFailureThreshold,
        noProgress: plan.supervisionPolicy.noProgressSeconds !== null && now.getTime() - lastProgressAt.getTime() >= plan.supervisionPolicy.noProgressSeconds * 1000,
        humanWait: !!humanWait, pendingFailedWorker: workers.some(w => attempts.find(a => a.workerId === w.id)?.status === "failed"), retryAvailable: plan.retriesUsed < plan.budgets.maxRetries,
        liveAttempts: live.length, possibleCompletion: workers.length > 0 && workers.every(w => w.status === "completed" || attempts.find(a => a.workerId === w.id)?.status === "succeeded"), hasVerifiedCompletion: false,
        verifierBudgetAvailable: plan.verifierCallsUsed < plan.supervisionPolicy.maxVerifierCalls, independentVerifierRequired: plan.verificationMode === "independent_required" };
      const snapshotHash = nativeSha256({ ...snapshot, attempts: attempts.map(a => ({ id: a.id, status: a.status })), progressHash });
      const facts: Array<{ type: SupervisionSignalType; severity: "info" | "warning" | "blocking"; data: Record<string,unknown> }> = [];
      if (progressed && session.progressHash) facts.push({ type: "progress", severity: "info", data: { outputHash: progressHash } });
      if (!sourceCurrent) facts.push({ type: "policy_violation", severity: "blocking", data: { reason: "source_erased" } });
      if (!authorityCurrent) facts.push({ type: "permission_changed", severity: "blocking", data: { reason: "current_authority_revoked" } });
      if (!readinessAllows) facts.push({ type: "readiness_degraded", severity: "blocking", data: { actionClass: plan.actionClass } });
      if (snapshot.deadlineExpired || snapshot.checkBudgetExhausted) facts.push({ type: "budget_exceeded", severity: "blocking", data: { deadline: snapshot.deadlineExpired, checks: snapshot.checkBudgetExhausted } });
      if (repeatedFailures >= snapshot.repeatedFailureThreshold) facts.push({ type: "repeated_failure", severity: "blocking", data: { count: repeatedFailures, fingerprint, receiptIds: receipts.slice(0,repeatedFailures).map(r => r.receipt.id) } });
      if (humanWait) facts.push({ type: "human_input_needed", severity: "info", data: { interactionId: humanWait.id } });
      if (snapshot.noProgress && !humanWait) facts.push({ type: "no_progress", severity: "warning", data: { since: lastProgressAt.toISOString(), thresholdSeconds: plan.supervisionPolicy.noProgressSeconds } });
      if (snapshot.possibleCompletion) facts.push({ type: "possible_completion", severity: "info", data: { attemptIds: attempts.filter(a => a.status === "succeeded").map(a => a.id), verified: false } });
      const signalIds: string[] = [];
      for (const fact of facts) {
        const [signal] = await tx.insert(supervisionSignals).values({ companyId, planId: id, sessionId: session.id, signalType: fact.type, severity: fact.severity, sourceType: "canonical_snapshot", sourceRef: id, facts: fact.data, snapshotHash, dedupKey: nativeSha256({ snapshotHash, type: fact.type }), observedAt: now, expiresAt: new Date(now.getTime()+120000) }).onConflictDoUpdate({ target: [supervisionSignals.companyId, supervisionSignals.planId, supervisionSignals.dedupKey], set: { observedAt: now, expiresAt: new Date(now.getTime()+120000) } }).returning();
        signalIds.push(signal!.id);
      }
      if (input?.signalIds.length) {
        const selected = await tx.select().from(supervisionSignals).where(and(eq(supervisionSignals.companyId, companyId), eq(supervisionSignals.planId, id), inArray(supervisionSignals.id, input.signalIds)));
        if (selected.length !== new Set(input.signalIds).size || selected.some(s => !s.expiresAt || s.expiresAt.getTime() <= now.getTime() || s.snapshotHash !== snapshotHash)) throw conflict("Referenced signals are stale or outside this current plan snapshot");
      }
      const decision = arbitrateSupervision(snapshot, input?.action ?? null, !!human);
      const checks = Math.min(plan.supervisionPolicy.maxSupervisorChecks, plan.supervisorChecksUsed + Number(enabled && plan.status === "running"));
      await tx.update(supervisionSessions).set({ lastObservedAt: now, progressHash, lastProgressAt, checksUsed: session.checksUsed + Number(checks > plan.supervisorChecksUsed) }).where(eq(supervisionSessions.id, session.id));
      await tx.update(orchestrationPlans).set({ supervisorChecksUsed: checks, updatedAt: now }).where(eq(orchestrationPlans.id, id));
      let intervention: typeof supervisionInterventions.$inferSelect | null = null;
      if (decision.effect === "stop") {
        const nextStatus = decision.action === "STOP" ? "cancelled" : "paused";
        const changed = !["completed","cancelled","failed"].includes(plan.status) && plan.status !== nextStatus;
        const [fenced] = await tx.update(orchestrationPlans).set({ status: changed ? nextStatus : plan.status, version: plan.version + Number(changed), updatedAt: now, completedAt: changed && nextStatus === "cancelled" ? now : plan.completedAt }).where(eq(orchestrationPlans.id,id)).returning();
        intervention = await enqueueSupervisionStop(tx, fenced!, { actorType: human ? "user" : "system", actorId: human ? v7HumanActorId(human.actor) : "supervision", rationale: input?.rationale ?? "Deterministic intervention from current canonical execution facts", action: decision.action, reasonCode: decision.reasonCode, attemptIds: live.map(a => a.id), signalIds });
      } else if (human || decision.action !== "CONTINUE") {
        if (decision.effect === "reassign" && human && input) {
          const worker = workers.find(w => w.id === input.workerId);
          const task = tasks.find(t => t.id === worker?.issueId);
          const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId,companyId),eq(agents.id,input.reassignToAgentId!))).for("share");
          if (!worker || !task || !agent || !["idle","running","error"].includes(agent.status)) throw conflict("Select a current canonical worker and invokable local agent");
          if (task.checkoutRunId || task.executionRunId || live.length) throw conflict("Canonical Stop and ownership release must complete before reassignment");
          await assertV7Authorization(tx,human.actor,companyId,"agent:wake",{ type: "agent", companyId, agentId: agent.id });
          await issueService(tx).update(task.id,{ assigneeAgentId: agent.id, assigneeUserId: null, actorUserId: v7HumanActorId(human.actor), companyGuard: companyId },tx,publications,postCommitActions);
          await tx.update(orchestrationWorkers).set({ agentId: agent.id, updatedAt: now }).where(and(eq(orchestrationWorkers.companyId,companyId),eq(orchestrationWorkers.id,worker.id)));
          await tx.update(orchestrationPlans).set({ version: plan.version+1, updatedAt: now }).where(eq(orchestrationPlans.id,id));
        }
        // Execution/reassignment/verification require their qualified consumers; no status-only success.
        const [record] = await tx.insert(supervisionInterventions).values({ companyId, planId: id, sessionId: session.id, signalIds, recommendation: input?.action ?? decision.action, decisionAction: decision.action, reasonCode: decision.reasonCode, policySnapshotHash: nativeSha256(plan.supervisionPolicy), expectedPlanVersion: plan.version,
          requestedByType: human ? "user" : "system", requestedById: human ? v7HumanActorId(human.actor) : "supervision", rationale: input?.rationale ?? null, targetWorkerId: input?.workerId ?? null, targetAgentId: input?.reassignToAgentId ?? null,
          idempotencyKey: nativeSha256({ plan: id, version: plan.version, snapshotHash, action: decision.action, requester: human ? v7HumanActorId(human.actor) : "supervision" }), status: decision.effect === "dispatch" && decision.allowed ? "pending" : ["none","reassign"].includes(decision.effect) && decision.allowed ? "applied" : "blocked", completedAt: now }).onConflictDoNothing().returning();
        intervention = record ?? null;
      }
      if (intervention) await logActivity(tx, { companyId, actorType: human ? "user" : "system", actorId: human ? v7HumanActorId(human.actor) : "supervision", action: "supervision.intervention", entityType: "orchestration_plan", entityId: id, details: { interventionId: intervention.id, recommendation: intervention.recommendation, decisionAction: decision.action, reasonCode: decision.reasonCode, signalIds } }, publications);
      return { snapshot, decision, intervention };
    });
    await executeIssuePostCommitActions(db,postCommitActions);
    return outcome;
  }
  async function deliverStops(limit = 20, companyId?: string) {
    let applied = 0, failed = 0;
    const seen: string[] = [];
    for (let n = 0; n < limit; n++) {
      const owner = randomUUID();
      const job = await db.transaction(async tx => {
        const [row] = await tx.select().from(supervisionInterventions).where(and(companyId ? eq(supervisionInterventions.companyId,companyId) : undefined, sql`(${supervisionInterventions.status}='pending' or (${supervisionInterventions.status}='running' and ${supervisionInterventions.leaseExpiresAt}<now())) and ${supervisionInterventions.decisionAction} in ('STOP','PAUSE','ESCALATE_HUMAN','RETRY') and ${supervisionInterventions.attempts}<3 and not (${supervisionInterventions.id}::text = any(select jsonb_array_elements_text(${JSON.stringify(seen)}::jsonb)))`)).orderBy(supervisionInterventions.createdAt).limit(1).for("update", { skipLocked: true });
        if (!row) return null;
        const [claimed] = await tx.update(supervisionInterventions).set({ status: "running", leaseOwner: owner, leaseExpiresAt: new Date(Date.now()+300000), attempts: row.attempts+1 }).where(eq(supervisionInterventions.id,row.id)).returning();
        return claimed!;
      });
      if (!job) break;
      seen.push(job.id);
      try {
        if (job.decisionAction === "RETRY") {
          const [plan] = await db.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId,job.companyId),eq(orchestrationPlans.id,job.planId)));
          const principal = plan?.executionPrincipal;
          const actor: AuthorizationActor | null = principal?.type === "user" ? { type: "board", source: "session", userId: principal.userId } : principal?.type === "system" && principal.service === "local-board" ? { type: "board", source: "local_implicit" } : null;
          if (!actor || plan?.status !== "running") throw conflict("Retry authority is no longer current");
          const outcomes = await orchestrationRuntimeControl(db).dispatch(actor,job.companyId,job.planId,job.targetWorkerId ?? undefined);
          if (!outcomes.length || outcomes.some(o => !o.runId || o.error)) throw conflict("Canonical retry was not dispatched");
        } else await orchestrationRuntimeControl(db).stopFencedPlan(job.companyId, job.planId, `Supervision: ${job.reasonCode}`);
        await withV7ActivityTransaction(db, async (tx, publications) => {
          await lockMemoryPrivacy(tx, job.companyId);
          const [plan] = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId,job.companyId),eq(orchestrationPlans.id,job.planId))).for("update");
          await reconcileOrchestrationAttempts(tx, plan!);
          const [updated] = await tx.update(supervisionInterventions).set({ status: "applied", leaseOwner: null, leaseExpiresAt: null, completedAt: new Date(), lastErrorCode: null }).where(and(eq(supervisionInterventions.id,job.id),eq(supervisionInterventions.leaseOwner,owner))).returning();
          if (updated) await logActivity(tx, { companyId: job.companyId, actorType: "system", actorId: "supervision", action: "supervision.intervention_applied", entityType: "orchestration_plan", entityId: job.planId, details: { interventionId: job.id } }, publications);
        }); applied++;
      } catch {
        await db.update(supervisionInterventions).set({ status: job.attempts >= 3 ? "failed" : "pending", leaseOwner: null, leaseExpiresAt: null, lastErrorCode: "qualified_stop_unconfirmed" }).where(and(eq(supervisionInterventions.id,job.id),eq(supervisionInterventions.leaseOwner,owner))); failed++;
      }
    }
    return { applied, failed };
  }
  return {
    observe,
    intervene: async (actor: AuthorizationActor, companyId: string, id: string, input: SupervisionInterventionInput) => { await orchestrationService(db).get(actor,companyId,id,true); return observe(companyId,id,{ actor,input }); },
    get: async (actor: AuthorizationActor, companyId: string, id: string) => {
      await orchestrationService(db).get(actor,companyId,id,true);
      const sessions = await db.select().from(supervisionSessions).where(and(eq(supervisionSessions.companyId,companyId),eq(supervisionSessions.planId,id))).orderBy(desc(supervisionSessions.createdAt)).limit(20);
      const signals = await db.select().from(supervisionSignals).where(and(eq(supervisionSignals.companyId,companyId),eq(supervisionSignals.planId,id))).orderBy(desc(supervisionSignals.observedAt)).limit(100);
      const interventions = await db.select().from(supervisionInterventions).where(and(eq(supervisionInterventions.companyId,companyId),eq(supervisionInterventions.planId,id))).orderBy(desc(supervisionInterventions.createdAt)).limit(100);
      return { sessions, signals, interventions };
    }, deliverStops,
    tick: async (limit = 20) => {
      const plans = await db.select().from(orchestrationPlans).where(sql`${orchestrationPlans.status}='running' or exists(select 1 from orchestration_worker_attempts a where a.company_id=${orchestrationPlans.companyId} and a.plan_id=${orchestrationPlans.id} and a.status='running')`).orderBy(orchestrationPlans.updatedAt).limit(limit);
      let observed = 0, failedObservations = 0;
      for (const plan of plans) { try { if (await observe(plan.companyId,plan.id)) observed++; } catch { failedObservations++; logger.error({ planId: plan.id, companyId: plan.companyId, code: "supervision_observation_failed" },"Supervision observation must retry"); } }
      return { observed, failedObservations, ...await deliverStops(limit) };
    },
  };
}
