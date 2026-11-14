import { and, eq, sql } from "drizzle-orm";
import { agentPackageVersions, agentPackages, agents, companyAgentPackageInstallations, type Db } from "@paperclipai/db";
import { activationFirstTaskPreparationSchema, BLENTERA_MANAGED_STARTER_PROFILE, SPECIALIST_CANDIDATES, specialistCompletionContract, type ActivationCommand, type ActivationState } from "@paperclipai/shared";
import type { ActivityPublication } from "../activity-log.js";
import type { AuthorizationActor } from "../authorization.js";
import { conflict, HttpError, notFound } from "../../errors.js";
import { assertV7Authorization, assertV7Enabled, v7HumanActorId } from "../v7-authorization.js";
import { assertDerivedManager } from "../memory/derived-memory.js";
import { companySkillService } from "../company-skills.js";
import { blenteraPlatformContractHashes } from "../tool-gateway.js";
import { aiGovernanceService } from "../ai-governance/governance-service.js";
import { issueService } from "../issues.js";
import { orchestrationService } from "../orchestration/orchestration-service.js";
import { qualifyNativeDraftPresence } from "../orchestration/native-draft-runtime.js";
import { logActivity } from "../v7-mutations.js";
import { readActivationFirstTask } from "./activation-first-task.js";

type Onboarding = { id: string; createdAt: Date; createdByUserId: string; activationState: ActivationState };
type Prepare = Extract<ActivationCommand, { operation: "prepare_first_task" }>;

/** Read current original authorities. Selection and receipts never grant access. */
async function preparationSource(rootDb: Db, tx: Db, actor: AuthorizationActor, companyId: string, onboarding: Onboarding, installationId: string) {
  await assertV7Enabled(tx, "agent_packages_v7");
  await assertV7Enabled(tx, "orchestration_v7");
  await assertV7Enabled(tx, "ai_use_cases_v7");
  await assertDerivedManager(tx, actor, companyId);
  await assertV7Authorization(tx, actor, companyId, "tasks:assign");
  const [installation] = await tx.select().from(companyAgentPackageInstallations)
    .where(and(eq(companyAgentPackageInstallations.companyId, companyId), eq(companyAgentPackageInstallations.id, installationId))).for("share");
  if (!installation) throw notFound("Current installed capability not found");
  if (installation.installedVersionId !== onboarding.activationState.packageVersionId || installation.status !== "active" || !installation.activationHash || !installation.aiUseCaseId)
    throw conflict("A current active capability with an approved purpose is required");
  await assertV7Authorization(tx, actor, companyId, "agent:read", { type: "agent", companyId, agentId: installation.agentId });
  const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, installation.agentId))).for("share");
  if (!agent) throw notFound("Current agent not found");
  const [current] = await tx.execute(sql`select aw_v7_package_installation_current(i) as allowed from company_agent_package_installations i where i.company_id=${companyId}::uuid and i.id=${installation.id}::uuid`);
  if (current?.allowed !== true) throw conflict("The original package activation is no longer current");
  const { useCase } = await aiGovernanceService(tx).get(actor, companyId, installation.aiUseCaseId);
  const purpose = useCase.purpose;
  if (useCase.status !== "approved" || !["C0", "C1"].includes(purpose.riskClass) || purpose.peopleDomain !== "none" || purpose.specialCategoryDataExpected ||
    purpose.externalCommunication || purpose.makesRecommendationsAboutPeople || purpose.makesDecisionsAboutPeople || purpose.materialLegalOrSimilarEffect)
    throw conflict("The first draft requires a current approved internal purpose without material effects");
  const quote = await qualifyNativeDraftPresence(rootDb, tx, companyId, installation.agentId, onboarding.createdByUserId);
  if (quote.maximumMinor !== 0) throw conflict("The default first draft requires qualified no-charge compute");
  return { installation, useCase, option: activationFirstTaskPreparationSchema.parse({
    installationId: installation.id, installationVersion: installation.version, installationHash: installation.activationHash,
    agentName: agent.name, useCaseVersion: useCase.version, purposeVersion: useCase.purposeVersion,
    intendedPurpose: purpose.intendedPurpose, maximumModelCostMinor: 0,
  }) };
}

/** Read-only bounded choice list. No GET creates a Task, purpose or plan. */
export async function activationFirstTaskPreparationOptions(rootDb: Db, tx: Db, actor: AuthorizationActor, companyId: string, onboarding: Onboarding) {
  const state = onboarding.activationState;
  if (state.step !== "review" || !state.packageVersionId || state.firstTask || state.preparedFirstTask || state.firstValueReceipt || state.intent.trim().length < 10) return [];
  const rows = await tx.select({ id: companyAgentPackageInstallations.id }).from(companyAgentPackageInstallations)
    .where(and(eq(companyAgentPackageInstallations.companyId, companyId), eq(companyAgentPackageInstallations.installedVersionId, state.packageVersionId), eq(companyAgentPackageInstallations.status, "active")))
    .orderBy(companyAgentPackageInstallations.id).limit(5);
  const options = [];
  for (const row of rows) {
    try { options.push((await preparationSource(rootDb, tx, actor, companyId, onboarding, row.id)).option); }
    catch (error) { if (!(error instanceof HttpError) || ![403, 404, 409, 422].includes(error.status)) throw error; }
  }
  return options;
}

/** Prepare via the original Task, governance and plan writers, in the original
 * onboarding transaction. This creates no run, approval, credentials or grants. */
export async function prepareActivationFirstTask(rootDb: Db, tx: Db, publications: ActivityPublication[], actor: AuthorizationActor, companyId: string, onboarding: Onboarding, input: Prepare) {
  const state = onboarding.activationState;
  if (state.step !== "review" || state.firstTask || state.preparedFirstTask || state.firstValueReceipt || state.intent.trim().length < 10)
    throw conflict("Review the current goal before preparing one first draft");
  await assertV7Authorization(tx, actor, companyId, "tasks:assign");
  const { installation, useCase } = await preparationSource(rootDb, tx, actor, companyId, onboarding, input.installationId);
  if (installation.version !== input.expectedInstallationVersion || installation.activationHash !== input.expectedInstallationHash || useCase.version !== input.expectedUseCaseVersion || useCase.purposeVersion !== input.expectedPurposeVersion)
    throw conflict("The reviewed capability or intended purpose changed; review it again");
  // The first purpose deployment is bound below, before a heartbeat Run exists.
  // Admit the canonical platform Skill in this original transaction first so
  // the deployment authority hash and the later Run admission observe the same
  // company Skill inventory. Runtime preparation still pins the exact Skill on
  // the Run and rejects drift; this pre-run step does not create a Run or grant.
  const platformActor: AuthorizationActor = {
    type: "agent", source: "none", companyId, agentId: installation.agentId,
    onBehalfOfUserId: v7HumanActorId(actor),
  };
  await companySkillService(tx).requiredPlatformSkill(companyId, platformActor, blenteraPlatformContractHashes(), {
    admitContractRefresh: true,
  });
  const [installedPackage] = await tx.select({ key: agentPackages.key }).from(agentPackageVersions)
    .innerJoin(agentPackages, eq(agentPackages.id, agentPackageVersions.packageId))
    .where(eq(agentPackageVersions.id, installation.installedVersionId)).limit(1);
  if (!installedPackage) throw conflict("The installed package identity is unavailable; review the activation again");
  const businessInvariants = installedPackage.key === BLENTERA_MANAGED_STARTER_PROFILE.packageKey
    ? SPECIALIST_CANDIDATES[BLENTERA_MANAGED_STARTER_PROFILE.packageKey].cases.flatMap(testCase =>
      specialistCompletionContract(BLENTERA_MANAGED_STARTER_PROFILE.packageKey, testCase.key).businessInvariants)
    : ["Use only currently authorized approved Source context", "Missing facts and uncertainty remain explicit"];
  const task = await issueService(rootDb).create(companyId, {
    title: state.intent.slice(0, 500), description: state.intent,
    status: "todo", workMode: "standard", assigneeAgentId: installation.agentId,
    createdByUserId: onboarding.createdByUserId, actorResponsibleUserId: onboarding.createdByUserId,
    // This Task body is the current Human's explicit onboarding intent. Keep
    // the onboarding/plan/install provenance in the activation receipt below;
    // do not misclassify that origin metadata as an upstream source owner.
    originKind: "manual",
    allowDuplicate: true,
    idempotencyKey: `activation-first-task:${onboarding.id}:${input.requestId}`,
  }, tx, publications, { manualInputActor: actor });
  if (!task) throw conflict("The original first Task could not be prepared");
  await aiGovernanceService(rootDb).bindWithinTransaction(tx, publications, actor, companyId, useCase.id, {
    issueId: task.id, agentId: installation.agentId, expectedVersion: input.expectedUseCaseVersion,
  });
  const plan = await orchestrationService(rootDb).createWithinTransaction(tx, publications, actor, companyId, {
    issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(), riskClass: "C1", actionClass: "internal_draft", workload: "semantic",
    completionContract: { objective: state.intent, requiredOutputs: [{ key: "result" }],
      businessInvariants,
      prohibitedOutcomes: ["Do not send externally, spend money, delete data or change permissions"],
    },
    budgets: { maxWorkerCount: 1, maxParallelWorkers: 1, maxDelegationDepth: 0, maxRetries: 0, maxWallClockSeconds: 300, maxModelCostMinor: 0, maxToolActions: 2 },
    workers: [{ key: "first_draft", issueId: task.id }],
  });
  const candidate = await readActivationFirstTask(rootDb, tx, actor, companyId, onboarding, installation.id, plan.id);
  await logActivity(tx, { companyId, actorType: "user", actorId: onboarding.createdByUserId,
    action: "activation.first_task_prepared", entityType: "issue", entityId: task.id,
    details: { onboardingRunId: onboarding.id, planId: plan.id, installationId: installation.id, runCreated: false, grantsCreated: 0 },
  }, publications);
  return { installationId: candidate.installationId, installationHash: candidate.installationHash, planId: candidate.planId, issueId: candidate.issueId };
}
