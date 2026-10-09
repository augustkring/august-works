import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { agents, completionContracts, issuePlanDecompositions, issueDocuments, documents, issueThreadInteractions, issues, orchestrationPlans, orchestrationWorkers, orchestrationWorkerAttempts, supervisionInterventions, workflows, type Db } from "@paperclipai/db";
import { createOrchestrationPlanSchema, orchestrationCompletionSchema, orchestrationDecisionSchema, selectOrchestrationShape, type CreateOrchestrationPlanInput } from "@paperclipai/shared";
import type { z } from "zod";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, assertV7Enabled, v7HumanActorId } from "../v7-authorization.js";
import { assertDerivedManager } from "../memory/derived-memory.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { assertAnalyticalContextPayloadAccess } from "../analytical-context-authority.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { conflict, forbidden, notFound } from "../../errors.js";
import { writeOrchestrationContract } from "./orchestration-contracts.js";
import { assertWorkflowOutputSchema } from "../workflows/workflow-output-schema.js";
import { enqueueSupervisionStop } from "../supervision/supervision-outbox.js";
import { reconcileOrchestrationAttempts } from "./orchestration-admission.js";
import { qualifyNativeDraftPlan } from "./native-draft-runtime.js";

type Plan = typeof orchestrationPlans.$inferSelect;
/** Follow actual native Task/attempt bindings; copied IDs never grant source access. */
export async function assertOrchestrationSources(db: Db, actor: AuthorizationActor | undefined, companyId: string, row: Plan) {
  const workers = await db.select({ issueId: orchestrationWorkers.issueId }).from(orchestrationWorkers).where(and(eq(orchestrationWorkers.companyId, companyId), eq(orchestrationWorkers.planId, row.id))).limit(257);
  const attempts = await db.select({ runId: orchestrationWorkerAttempts.runId }).from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.planId, row.id))).limit(257);
  if (workers.length > 256 || attempts.length > 256) throw forbidden("The complete Orchestration source review exceeds its budget");
  const deadline = performance.now() + 30000;
  for (const issueId of new Set([row.issueId, ...workers.map(w => w.issueId)])) {
    if (performance.now() > deadline) throw forbidden("The complete Orchestration source review exceeds its budget");
    await assertAnalyticalContextPayloadAccess(db, companyId, actor, { issueId });
  }
  for (const runId of new Set(attempts.flatMap(a => a.runId ? [a.runId] : []))) {
    if (performance.now() > deadline) throw forbidden("The complete Orchestration source review exceeds its budget");
    await assertAnalyticalContextPayloadAccess(db, companyId, actor, { runId });
  }
}
export function orchestrationService(db: Db) {
  async function admit(actor: AuthorizationActor, companyId: string, tx = db, manage = false, control = false) {
    if (!control) await assertV7Enabled(tx, "orchestration_v7");
    await assertV7Authorization(tx, actor, companyId, "company_scope:read");
    if (manage) await assertDerivedManager(tx, actor, companyId);
  }
  async function plan(actor: AuthorizationActor, companyId: string, id: string, tx = db, lock = false, control = false) {
    await admit(actor, companyId, tx, false, control);
    const query = tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, companyId), eq(orchestrationPlans.id, id)));
    const [row] = await (lock ? query.for("update") : query);
    if (!row || row.erasedAt && !control) throw notFound("Orchestration plan not found");
    await assertV7Authorization(tx, actor, companyId, "issue:read", { type: "issue", companyId, issueId: row.issueId });
    if (!control) await assertOrchestrationSources(tx, actor, companyId, row);
    return row;
  }
  const audit = (tx: Db, actor: AuthorizationActor, row: Plan, action: string, publications: Parameters<typeof logActivity>[2], details: Record<string, unknown>) => logActivity(tx, { companyId: row.companyId, actorType: "user", actorId: v7HumanActorId(actor), action, entityType: "orchestration_plan", entityId: row.id, details }, publications);
  return {
    list: async (actor: AuthorizationActor, companyId: string) => withV7ActivityTransaction(db, async tx => {
      await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
      await admit(actor, companyId, tx);
      const rows = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, companyId), isNull(orchestrationPlans.erasedAt))).orderBy(desc(orchestrationPlans.createdAt)).limit(100);
      // Recheck Task visibility; a company listing never widens project access.
      const visible: Plan[] = [];
      for (const row of rows) {
        try { await assertV7Authorization(tx, actor, companyId, "issue:read", { type: "issue", companyId, issueId: row.issueId }); await assertOrchestrationSources(tx, actor, companyId, row); visible.push(row); }
        catch (error) { if (error && typeof error === "object" && "status" in error && [403,404,409,422].includes(Number(error.status))) continue; throw error; }
      }
      return visible;
    }),
    get: async (actor: AuthorizationActor, companyId: string, id: string, control = false) => withV7ActivityTransaction(db, async tx => {
      await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
      const row = await plan(actor, companyId, id, tx, false, control);
      let sourceAvailable = !row.erasedAt;
      if (control && sourceAvailable) {
        try { await assertOrchestrationSources(tx, actor, companyId, row); }
        catch (error) { if (error && typeof error === "object" && "status" in error && [403,404,409,422].includes(Number(error.status))) sourceAvailable = false; else throw error; }
      }
      const workers = await tx.select().from(orchestrationWorkers).where(and(eq(orchestrationWorkers.companyId, companyId), eq(orchestrationWorkers.planId, id)));
      for (const worker of workers) await assertV7Authorization(tx, actor, companyId, "issue:read", { type: "issue", companyId, issueId: worker.issueId });
      const attempts = await tx.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.planId, id)));
      const [contract] = await tx.select().from(completionContracts).where(and(eq(completionContracts.companyId, companyId), eq(completionContracts.id, row.completionContractId)));
      return { ...row, workers: sourceAvailable ? workers : workers.map(worker => ({ ...worker, workerKey: "[Source unavailable]", dependsOn: [] })), attempts, completionContract: sourceAvailable ? orchestrationCompletionSchema.parse(contract?.contractJson.v7) : null };
    }),
    create: async (actor: AuthorizationActor, companyId: string, raw: CreateOrchestrationPlanInput) => {
      const input = createOrchestrationPlanSchema.parse(raw);
      for (const contract of [input.completionContract, ...input.workers.flatMap(worker => worker.completionContract ? [worker.completionContract] : [])]) for (const output of contract.requiredOutputs) if (output.jsonSchema) assertWorkflowOutputSchema(output.jsonSchema);
      await admit(actor, companyId, db, true);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId); await admit(actor, companyId, tx, true);
        const taskIds = [...new Set([input.issueId, ...input.workers.map(worker => worker.issueId)])].sort();
        const tasks = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), inArray(issues.id, taskIds))).orderBy(issues.id).for("update");
        if (tasks.length !== taskIds.length) throw notFound("A canonical Task is outside this company or missing");
        for (const task of tasks) await assertAnalyticalContextPayloadAccess(tx, companyId, actor, { issueId: task.id });
        const root = tasks.find(task => task.id === input.issueId)!;
        if (root.updatedAt.toISOString() !== input.expectedIssueUpdatedAt) throw conflict("Task changed; reload the current brief before planning");
        if (tasks.some(task => ["done", "cancelled"].includes(task.status) || task.executionRunId || task.checkoutRunId)) throw conflict("Plan creation requires nonterminal Tasks without a live execution owner");
        for (const task of tasks) await assertV7Authorization(tx, actor, companyId, "issue:mutate", { type: "issue", companyId, issueId: task.id, projectId: task.projectId, parentIssueId: task.parentId, assigneeAgentId: task.assigneeAgentId, assigneeUserId: task.assigneeUserId, status: task.status });
        if (input.workers.length > 1) {
          const [accepted] = await tx.select().from(issuePlanDecompositions).where(and(eq(issuePlanDecompositions.companyId, companyId), eq(issuePlanDecompositions.sourceIssueId, root.id), eq(issuePlanDecompositions.acceptedPlanRevisionId, input.acceptedPlanRevisionId!))).for("share");
          const [current] = await tx.select({ revisionId: documents.latestRevisionId }).from(issueDocuments).innerJoin(documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId))).where(and(eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, root.id), eq(issueDocuments.key, "plan"))).for("share", { of: documents });
          const [confirmation] = accepted?.acceptedInteractionId ? await tx.select().from(issueThreadInteractions).where(and(eq(issueThreadInteractions.companyId, companyId), eq(issueThreadInteractions.issueId, root.id), eq(issueThreadInteractions.id, accepted.acceptedInteractionId))).for("share") : [];
          const wanted = input.workers.map(worker => worker.issueId).sort();
          if (current?.revisionId !== input.acceptedPlanRevisionId || confirmation?.status !== "accepted" || !accepted || accepted.status !== "completed" || !accepted.acceptedInteractionId || JSON.stringify([...accepted.childIssueIds].sort()) !== JSON.stringify(wanted)
            || tasks.some(task => task.id !== root.id && (task.parentId !== root.id || task.projectId !== root.projectId))) throw conflict("Use the existing accepted Task decomposition and its exact canonical children");
          if (input.budgets.maxDelegationDepth < 1) throw conflict("Parallel children require a delegation depth budget");
        }
        if (tasks.some(task => task.requestDepth - root.requestDepth > input.budgets.maxDelegationDepth || task.requestDepth < root.requestDepth)) throw conflict("Task depth exceeds the explicit delegation budget");
        let workflowRevisionId: string | null = null;
        if (input.workflowId) {
          await assertV7Authorization(tx, actor, companyId, "workflows:read");
          const [workflow] = await tx.select().from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, input.workflowId))).for("share");
          if (!workflow || workflow.status !== "active" || !workflow.publishedRevisionId) throw conflict("Bind an existing published, active Workflow");
          workflowRevisionId = workflow.publishedRevisionId;
        }
        for (const worker of input.workers) {
          const task = tasks.find(item => item.id === worker.issueId)!;
          if (!input.workflowId && !task.assigneeAgentId) throw conflict("Assign each worker Task to one canonical agent first");
          if (task.assigneeAgentId) {
            const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, task.assigneeAgentId))).for("share");
            if (!agent || !["idle", "running", "error"].includes(agent.status)) throw forbidden("An invokable current local agent is required");
          }
        }
        const contract = await writeOrchestrationContract(tx, companyId, root.id, input.completionContract, v7HumanActorId(actor));
        const [created] = await tx.insert(orchestrationPlans).values({ companyId, issueId: root.id, completionContractId: contract.id, ...selectOrchestrationShape(input), actionClass: input.actionClass,
          riskClass: input.riskClass, workflowRevisionId, workflowId: input.workflowId, acceptedPlanRevisionId: input.acceptedPlanRevisionId, supervisionPolicy: input.supervisionPolicy, budgets: input.budgets, createdBy: v7HumanActorId(actor) }).returning();
        for (const worker of input.workers) {
          const task = tasks.find(item => item.id === worker.issueId)!;
          const workerContract = worker.issueId === root.id ? contract : await writeOrchestrationContract(tx, companyId, worker.issueId, worker.completionContract!, v7HumanActorId(actor));
          await tx.insert(orchestrationWorkers).values({ companyId, planId: created!.id, issueId: task.id, agentId: task.assigneeAgentId, completionContractId: workerContract.id, workerKey: worker.key, dependsOn: worker.dependsOn });
        }
        await audit(tx, actor, created!, "orchestration.plan_created", publications, { mode: created!.mode, workerCount: input.workers.length, completionContractId: contract.id });
        return created!;
      });
    },
    decide: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof orchestrationDecisionSchema>) => {
      const input = orchestrationDecisionSchema.parse(raw); const control = input.action !== "start"; await admit(actor, companyId, db, true, control);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId); await admit(actor, companyId, tx, true, control);
        const row = await plan(actor, companyId, id, tx, true, control);
        if (row.version !== input.expectedVersion) throw conflict("Plan version changed; reload before deciding");
        if (["completed", "cancelled", "failed"].includes(row.status)) throw conflict("Plan is terminal");
        if (input.action === "start") {
          const [task] = await tx.select({ harnessKind: issues.harnessKind }).from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, row.issueId)));
          if (task?.harnessKind === "provider_conformance") throw forbidden("Provider conformance cannot start ordinary work");
          if (row.executionPrincipal && ((row.executionPrincipal.type === "user" && row.executionPrincipal.userId !== v7HumanActorId(actor)) || (row.executionPrincipal.type === "system" && actor.source !== "local_implicit"))) throw forbidden("Resume must preserve the plan's initiating human authority; cancel and review a new plan to transfer it");
          if (!["draft", "ready", "paused"].includes(row.status)) throw conflict("Plan is already started");
          if (row.budgets.maxModelCostMinor !== null) {
            if (actor.source === "local_implicit") throw conflict("A model-cost cap requires its initiating authenticated human");
            await qualifyNativeDraftPlan(db, tx, row, v7HumanActorId(actor));
          }
          await reconcileOrchestrationAttempts(tx, row);
          const running = await tx.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.planId, id), eq(orchestrationWorkerAttempts.status, "running")));
          const [unsettledStop] = await tx.select({ id: supervisionInterventions.id }).from(supervisionInterventions).where(and(eq(supervisionInterventions.companyId, companyId), eq(supervisionInterventions.planId, id), sql`${supervisionInterventions.status} in ('pending','running','failed') and ${supervisionInterventions.decisionAction} in ('PAUSE','STOP','ESCALATE_HUMAN')`)).limit(1);
          if (unsettledStop) throw conflict("Qualified Stop must reconcile before resuming");
          if (running.length) throw conflict("Wait for existing workers to stop before resuming");
          if (row.startedAt && Date.now() >= row.startedAt.getTime() + row.budgets.maxWallClockSeconds * 1000) throw conflict("The original plan deadline has expired");
        }
        const [updated] = await tx.update(orchestrationPlans).set({ status: input.action === "start" ? "running" : input.action === "pause" ? "paused" : "cancelled", version: row.version + 1,
          executionPrincipal: input.action === "start" ? row.executionPrincipal ?? (actor.source === "local_implicit" ? { type: "system", service: "local-board" } : { type: "user", userId: v7HumanActorId(actor) }) : row.executionPrincipal,
          startedAt: input.action === "start" ? row.startedAt ?? new Date() : row.startedAt, completedAt: input.action === "cancel" ? new Date() : null, updatedAt: new Date() }).where(eq(orchestrationPlans.id, id)).returning();
        if (input.action === "cancel") await tx.update(orchestrationWorkers).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(orchestrationWorkers.planId, id), sql`${orchestrationWorkers.status} in ('waiting','running')`));
        if (control) {
          const attempts = await tx.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.planId, id), eq(orchestrationWorkerAttempts.status, "running")));
          await enqueueSupervisionStop(tx, updated!, { actorType: "user", actorId: v7HumanActorId(actor), rationale: input.rationale, action: input.action === "pause" ? "PAUSE" : "STOP", reasonCode: `human_${input.action}`, attemptIds: attempts.map(a => a.id) });
        }
        await audit(tx, actor, updated!, `orchestration.${input.action}_requested`, publications, { rationaleRecorded: Boolean(input.rationale) });
        return updated!;
      });
    },
  };
}
