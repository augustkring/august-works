import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { companyAgentPackageInstallations, issues, orchestrationPlans, orchestrationWorkers, orchestrationWorkerAttempts, type Db } from "@paperclipai/db";
import { activationFirstTaskCandidateSchema, activationFirstTaskViewSchema, orchestrationCompletionSchema, type ActivationState } from "@paperclipai/shared";
import { conflict, HttpError, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, assertV7Enabled } from "../v7-authorization.js";
import { retainedOrchestrationContract } from "../orchestration/orchestration-contracts.js";
import { qualifyNativeDraftPlan } from "../orchestration/native-draft-runtime.js";
import { assertOrchestrationSources } from "../orchestration/orchestration-service.js";
import { assertDerivedManager } from "../memory/derived-memory.js";

type Onboarding = { createdAt: Date; createdByUserId: string; activationState: ActivationState };

/** This adapter selects already prepared original work. It cannot approve a
 * purpose, install an agent, grant credentials or register a model controller. */
export async function readActivationFirstTask(
  rootDb: Db, tx: Db, actor: AuthorizationActor, companyId: string,
  onboarding: Onboarding, installationId: string, planId: string,
) {
  await assertV7Enabled(tx, "agent_packages_v7");
  await assertV7Enabled(tx, "orchestration_v7");
  await assertDerivedManager(tx, actor, companyId);
  const [plan] = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, companyId), eq(orchestrationPlans.id, planId))).for("share");
  const [installation] = await tx.select().from(companyAgentPackageInstallations).where(and(eq(companyAgentPackageInstallations.companyId, companyId), eq(companyAgentPackageInstallations.id, installationId))).for("share");
  if (!plan || plan.erasedAt || !installation) throw notFound("Current first task not found");
  const [task] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, plan.issueId))).for("share");
  if (!task || task.hiddenAt || task.harnessKind === "provider_conformance" || task.workMode !== "standard" ||
    task.createdByUserId !== onboarding.createdByUserId || task.responsibleUserId !== onboarding.createdByUserId ||
    task.createdAt < onboarding.createdAt || plan.createdAt < onboarding.createdAt || plan.createdBy !== onboarding.createdByUserId ||
    task.assigneeAgentId !== installation.agentId || task.assigneeUserId || !["todo", "in_progress"].includes(task.status) ||
    task.executionRunId || task.checkoutRunId || installation.installedVersionId !== onboarding.activationState.packageVersionId ||
    !installation.activationHash || plan.mode !== "single_worker" || plan.workflowId || plan.actionClass !== "internal_draft" || plan.riskClass !== "C1" ||
    !["draft", "ready"].includes(plan.status) || plan.startedAt || plan.executionPrincipal ||
    plan.budgets.maxWorkerCount !== 1 || plan.budgets.maxParallelWorkers !== 1 || plan.budgets.maxDelegationDepth !== 0 ||
    plan.budgets.maxRetries !== 0 || plan.budgets.maxToolActions !== 2 || plan.budgets.maxModelCostMinor === null ||
    plan.modelCostReserved || plan.toolActionsUsed || plan.retriesUsed)
    throw conflict("Review the current bounded first task before starting");
  await assertV7Authorization(tx, actor, companyId, "issue:mutate", { type: "issue", companyId, issueId: task.id, projectId: task.projectId, parentIssueId: task.parentId, assigneeAgentId: task.assigneeAgentId, assigneeUserId: task.assigneeUserId, status: task.status });
  const workers = await tx.select().from(orchestrationWorkers).where(and(eq(orchestrationWorkers.companyId, companyId), eq(orchestrationWorkers.planId, plan.id))).limit(2);
  const [attempt] = await tx.select({ id: orchestrationWorkerAttempts.id }).from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.planId, plan.id))).limit(1);
  if (workers.length !== 1 || workers[0]!.issueId !== task.id || workers[0]!.agentId !== installation.agentId ||
    workers[0]!.status !== "waiting" || workers[0]!.dependsOn.length || workers[0]!.attemptCount || attempt)
    throw conflict("The first task requires its untouched original worker");
  // Use the original completion-contract writer's fence so another original
  // writer cannot replace the reviewed goal before the start transaction commits.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`paperclip:native-completion-contract:${companyId}:${task.id}`}, 0))`);
  const contract = await retainedOrchestrationContract(tx, companyId, task.id);
  const completion = contract ? orchestrationCompletionSchema.parse(contract.row.contractJson.v7) : null;
  if (!contract || contract.row.id !== plan.completionContractId || workers[0]!.completionContractId !== plan.completionContractId ||
    completion?.objective !== onboarding.activationState.intent || completion.requiredOutputs.length !== 1 || completion.requiredPostconditions.length)
    throw conflict("The first task must preserve the reviewed goal and one internal output");
  const [authority] = await tx.execute(sql`select aw_v7_package_installation_current(i) as current,
    exists(select 1 from ai_use_case_deployments d where d.company_id=i.company_id and d.issue_id=${task.id}::uuid and d.agent_id=i.agent_id and d.use_case_id=i.ai_use_case_id and aw_v7_governance_deployment_current(d)) as purpose_current
    from company_agent_package_installations i where i.company_id=${companyId}::uuid and i.id=${installationId}::uuid`);
  if (authority?.current !== true || authority?.purpose_current !== true)
    throw conflict("Current package activation and reviewed purpose are required");
  const qualified = await qualifyNativeDraftPlan(rootDb, tx, plan, onboarding.createdByUserId);
  // ONB-09's default cannot incur a monetary charge. A price profile or an
  // existing subscription is not an approved AW-funded starter allowance.
  if (qualified.maximumMinor !== 0 || plan.budgets.maxModelCostMinor !== 0)
    throw conflict("The default first task requires qualified no-charge compute");
  return activationFirstTaskCandidateSchema.parse({ installationId, installationHash: installation.activationHash, planId, issueId: task.id,
    planVersion: plan.version, title: task.title, maximumModelCostMinor: qualified.maximumMinor, currency: "USD" });
}

/** The recorded reference permits original Stop controls even after package or
 * provider withdrawal. It does not permit another dispatch or changed goal. */
export async function readRecordedActivationFirstTask(tx: Db, actor: AuthorizationActor, companyId: string, onboarding: Onboarding, control = false) {
  const reference = onboarding.activationState.firstTask;
  if (!reference) throw notFound("First task not found");
  const [plan] = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, companyId), eq(orchestrationPlans.id, reference.planId))).for("share");
  const [task] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, reference.issueId))).for("share");
  if (!plan || !task || plan.issueId !== task.id || plan.createdBy !== onboarding.createdByUserId || task.createdByUserId !== onboarding.createdByUserId || task.responsibleUserId !== onboarding.createdByUserId ||
    plan.executionPrincipal?.type !== "user" || plan.executionPrincipal.userId !== onboarding.createdByUserId)
    throw notFound("Owned first task not found");
  await assertV7Authorization(tx, actor, companyId, "issue:read", { type: "issue", companyId, issueId: task.id, projectId: task.projectId });
  if (!control) await assertOrchestrationSources(tx, actor, companyId, plan);
  const attempts = await tx.select({ id: orchestrationWorkerAttempts.id }).from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.planId, plan.id))).limit(1);
  return { reference, plan, task, dispatched: Boolean(attempts.length) };
}

export async function assertActivationFirstTaskDispatch(rootDb: Db, tx: Db, actor: AuthorizationActor, companyId: string, onboarding: Onboarding) {
  const owned = await readRecordedActivationFirstTask(tx, actor, companyId, onboarding);
  const { reference, plan, task } = owned;
  if (owned.dispatched || plan.erasedAt || task.hiddenAt || plan.status !== "running" ||
    plan.mode !== "single_worker" || plan.actionClass !== "internal_draft" || plan.riskClass !== "C1" ||
    plan.budgets.maxWorkerCount !== 1 || plan.budgets.maxParallelWorkers !== 1 || plan.budgets.maxRetries !== 0 ||
    plan.budgets.maxDelegationDepth !== 0 || plan.budgets.maxToolActions !== 2)
    throw conflict("Read the current first task before continuing");
  const [installation] = await tx.select().from(companyAgentPackageInstallations).where(and(eq(companyAgentPackageInstallations.companyId, companyId), eq(companyAgentPackageInstallations.id, reference.installationId))).for("share");
  const [authority] = await tx.execute(sql`select aw_v7_package_installation_current(i) as current,
    exists(select 1 from ai_use_case_deployments d where d.company_id=i.company_id and d.issue_id=${task.id}::uuid and d.agent_id=i.agent_id and d.use_case_id=i.ai_use_case_id and aw_v7_governance_deployment_current(d)) as purpose_current
    from company_agent_package_installations i where i.company_id=${companyId}::uuid and i.id=${reference.installationId}::uuid`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`paperclip:native-completion-contract:${companyId}:${task.id}`}, 0))`);
  const contract = await retainedOrchestrationContract(tx, companyId, task.id);
  if (!installation || installation.activationHash !== reference.installationHash ||
    installation.installedVersionId !== onboarding.activationState.packageVersionId || task.assigneeAgentId !== installation.agentId ||
    authority?.current !== true || authority?.purpose_current !== true || !contract || contract.row.id !== plan.completionContractId ||
    orchestrationCompletionSchema.parse(contract.row.contractJson.v7).objective !== onboarding.activationState.intent)
    throw conflict("The reviewed first task changed; use its original controls");
  const qualified = await qualifyNativeDraftPlan(rootDb, tx, plan, onboarding.createdByUserId);
  if (qualified.maximumMinor !== 0 || plan.budgets.maxModelCostMinor !== 0)
    throw conflict("The default first task requires qualified no-charge compute");
  return plan.id;
}

export async function activationFirstTaskView(rootDb: Db, tx: Db, actor: AuthorizationActor, companyId: string, onboarding: Onboarding) {
  const state = onboarding.activationState;
  if (state.firstTask) {
    try {
      let owned: Awaited<ReturnType<typeof readRecordedActivationFirstTask>>;
      let sourcesWithdrawn = false;
      try {
        owned = await readRecordedActivationFirstTask(tx, actor, companyId, onboarding);
      } catch (error) {
        if (!(error instanceof HttpError) || ![403, 404, 409, 422].includes(error.status)) throw error;
        // The recorded owner may still need Stop after a package, purpose or
        // rollout withdrawal. Recheck the exact current task/principal and expose
        // only its control reference/version, never the withdrawn source content.
        owned = await readRecordedActivationFirstTask(tx, actor, companyId, onboarding, true);
        sourcesWithdrawn = true;
      }
      const { reference, plan, task, dispatched } = owned;
      if (plan.erasedAt || task.hiddenAt)
        return activationFirstTaskViewSchema.parse({ candidates: [], hasMore: false, current: null });
      return activationFirstTaskViewSchema.parse({ candidates: [], hasMore: false, current: { ...reference, planVersion: plan.version,
        status: sourcesWithdrawn && !["cancelled", "failed", "completed"].includes(plan.status) ? "withdrawn" : plan.status, dispatched } });
    } catch (error) {
      if (!(error instanceof HttpError) || ![403, 404, 409].includes(error.status)) throw error;
      // Withdraw private metadata; the reference remains durable on its owner.
      return activationFirstTaskViewSchema.parse({ candidates: [], hasMore: false, current: null });
    }
  }
  if (state.step !== "review" || !state.packageVersionId) return activationFirstTaskViewSchema.parse({ candidates: [], hasMore: false, current: null });
  const rows = await tx.select({ planId: orchestrationPlans.id, installationId: companyAgentPackageInstallations.id }).from(orchestrationPlans)
    .innerJoin(issues, and(eq(issues.companyId, orchestrationPlans.companyId), eq(issues.id, orchestrationPlans.issueId)))
    .innerJoin(companyAgentPackageInstallations, and(eq(companyAgentPackageInstallations.companyId, issues.companyId), eq(companyAgentPackageInstallations.agentId, issues.assigneeAgentId)))
    .where(and(eq(orchestrationPlans.companyId, companyId), eq(orchestrationPlans.createdBy, onboarding.createdByUserId),
      gte(orchestrationPlans.createdAt, onboarding.createdAt), inArray(orchestrationPlans.status, ["draft", "ready"]),
      eq(companyAgentPackageInstallations.installedVersionId, state.packageVersionId)))
    .orderBy(desc(orchestrationPlans.createdAt), orchestrationPlans.id).limit(6);
  const candidates = [];
  for (const row of rows) {
    if (state.preparedFirstTask && (state.preparedFirstTask.installationId !== row.installationId || state.preparedFirstTask.planId !== row.planId)) continue;
    try { candidates.push(await readActivationFirstTask(rootDb, tx, actor, companyId, onboarding, row.installationId, row.planId)); }
    catch (error) { if (!(error instanceof HttpError) || ![403, 404, 409, 422].includes(error.status)) throw error; }
  }
  return activationFirstTaskViewSchema.parse({ candidates: candidates.slice(0, 5), hasMore: candidates.length > 5, current: null });
}
