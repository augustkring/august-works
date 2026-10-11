import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  companyAgentPackageInstallations,
  heartbeatRuns,
  issues,
  issueDocuments,
  orchestrationPlans,
  orchestrationWorkerAttempts,
  orchestrationWorkers,
  verificationRuns,
  type Db,
} from "@paperclipai/db";
import {
  activationFirstValueResultSchema,
  verificationReviewSchema,
  type ActivationState,
} from "@paperclipai/shared";
import { conflict, HttpError, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Enabled } from "../v7-authorization.js";
import { verificationService } from "../supervision/verification-service.js";
import { heartbeatMemoryPayloadVisible } from "../memory/memory-privacy.js";

type Onboarding = {
  createdAt: Date;
  createdByUserId: string;
  activationState: ActivationState;
};

/** Caller holds analytical/privacy locks, current membership and the onboarding
 * owner. Read original verification, installation, Task and run in that snapshot;
 * never execute a task, reconcile attempts, manufacture evidence or certify ROI. */
export async function readActivationFirstValue(
  tx: Db,
  actor: AuthorizationActor,
  companyId: string,
  onboarding: Onboarding,
  installationId: string,
  verificationRunId: string,
) {
  const [started] = await tx.execute(
    sql`select clock_timestamp() as observed_at`,
  );
  await assertV7Enabled(tx, "agent_packages_v7");
  await assertV7Enabled(tx, "verifier_v7");
  const [installation] = await tx
    .select()
    .from(companyAgentPackageInstallations)
    .where(
      and(
        eq(companyAgentPackageInstallations.companyId, companyId),
        eq(companyAgentPackageInstallations.id, installationId),
      ),
    )
    .for("share");
  if (
    !installation ||
    installation.installedVersionId !==
      onboarding.activationState.packageVersionId
  )
    throw notFound("Current first-result installation not found");
  const [authority] = await tx.execute(
    sql`select aw_v7_package_installation_current(i) as current from company_agent_package_installations i where company_id=${companyId}::uuid and id=${installationId}::uuid`,
  );
  if (authority?.current !== true || !installation.activationHash)
    throw conflict("First-result installation is no longer current");
  const [review] = await tx
    .select()
    .from(verificationRuns)
    .where(
      and(
        eq(verificationRuns.companyId, companyId),
        eq(verificationRuns.id, verificationRunId),
      ),
    )
    .for("share");
  if (!review || review.erasedAt)
    throw notFound("Retained first-result review not found");
  const firstTask = onboarding.activationState.firstTask ?? onboarding.activationState.preparedFirstTask;
  if (firstTask && (firstTask.installationId !== installation.id || firstTask.installationHash !== installation.activationHash ||
    firstTask.planId !== review.planId || firstTask.issueId !== review.issueId))
    throw conflict("The reviewed result must belong to the recorded first task");
  const parsedReview = verificationReviewSchema.safeParse(review.review);
  if (
    review.result !== "pass" ||
    review.reviewerType !== "human" ||
    !review.workerId ||
    !review.workerAttemptId ||
    review.failedInvariants.length ||
    review.uncertainties.length ||
    !parsedReview.success ||
    parsedReview.data.result !== "pass" ||
    !parsedReview.data.objectiveSatisfied
  )
    throw conflict("An independent passing worker review is required");
  const [plan] = await tx
    .select()
    .from(orchestrationPlans)
    .where(
      and(
        eq(orchestrationPlans.companyId, companyId),
        eq(orchestrationPlans.id, review.planId),
      ),
    )
    .for("share");
  const [task] = await tx
    .select()
    .from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.id, review.issueId)))
    .for("share");
  if (
    !plan ||
    plan.erasedAt ||
    !task ||
    plan.issueId !== task.id ||
    plan.createdBy !== onboarding.createdByUserId ||
    task.createdByUserId !== onboarding.createdByUserId ||
    task.responsibleUserId !== onboarding.createdByUserId ||
    task.assigneeAgentId !== installation.agentId ||
    task.createdAt < onboarding.createdAt ||
    plan.createdAt < onboarding.createdAt ||
    review.completedAt < onboarding.createdAt ||
    review.completedAt > new Date(started!.observed_at as string | Date) ||
    task.status !== "done" ||
    plan.mode !== "single_worker" ||
    plan.actionClass !== "internal_draft" ||
    plan.riskClass !== "C1" ||
    plan.status !== "completed" ||
    plan.version !== review.expectedPlanVersion + 1
  )
    throw conflict(
      "The current result does not belong to this first-outcome goal",
    );
  const packet = await verificationService(tx).currentPacket(
    actor,
    companyId,
    plan.id,
    review.workerId,
  );
  if (
    packet.issueId !== task.id ||
    packet.contractId !== review.completionContractId ||
    packet.contractHash !== review.completionContractHash ||
    packet.resultHash !== review.resultHash ||
    packet.contract.objective !== onboarding.activationState.intent ||
    packet.liveAttempts ||
    packet.deterministicFailures.length
  )
    throw conflict("First-result evidence or goal is no longer current");
  const [execution] = await tx
    .select({ run: heartbeatRuns, attempt: orchestrationWorkerAttempts })
    .from(orchestrationWorkerAttempts)
    .innerJoin(
      orchestrationWorkers,
      and(
        eq(
          orchestrationWorkers.companyId,
          orchestrationWorkerAttempts.companyId,
        ),
        eq(orchestrationWorkers.id, orchestrationWorkerAttempts.workerId),
      ),
    )
    .innerJoin(
      heartbeatRuns,
      and(
        eq(heartbeatRuns.companyId, orchestrationWorkerAttempts.companyId),
        eq(heartbeatRuns.agentId, orchestrationWorkerAttempts.agentId),
        eq(heartbeatRuns.id, orchestrationWorkerAttempts.runId),
      ),
    )
    .where(
      and(
        eq(orchestrationWorkerAttempts.companyId, companyId),
        eq(orchestrationWorkerAttempts.planId, plan.id),
        eq(orchestrationWorkerAttempts.id, review.workerAttemptId),
        eq(orchestrationWorkerAttempts.workerId, review.workerId),
        eq(orchestrationWorkers.issueId, task.id),
        eq(heartbeatRuns.agentId, installation.agentId),
        heartbeatMemoryPayloadVisible(),
      ),
    )
    .for("share");
  if (
    !execution ||
    execution.attempt.status !== "succeeded" ||
    execution.run.status !== "succeeded" ||
    !execution.run.finishedAt ||
    execution.run.finishedAt > review.completedAt ||
    execution.run.contextSnapshot?.issueId !== task.id ||
    execution.run.contextSnapshot?.agentPackageInstallationId !==
      installation.id ||
    execution.run.contextSnapshot?.agentPackageActivationHash !==
      installation.activationHash
  )
    throw conflict(
      "A successful run for this exact package activation is required",
    );
  const outputEvidence = packet.evidence.filter((e) => e.type === "task_document");
  if (!outputEvidence.length || outputEvidence.length > 16)
    throw conflict("Complete bounded first-result output evidence is required");
  const outputLinks = await tx
    .select({ documentId: issueDocuments.documentId, key: issueDocuments.key })
    .from(issueDocuments)
    .where(and(
      eq(issueDocuments.companyId, companyId),
      eq(issueDocuments.issueId, task.id),
      inArray(issueDocuments.documentId, outputEvidence.map((e) => e.sourceId)),
    ))
    .for("share");
  const artifacts = outputEvidence.map((e) => {
    const link = outputLinks.find((output) => output.documentId === e.sourceId);
    if (!link) throw conflict("The reviewed output is no longer linked to this task");
    return {
      documentId: e.sourceId,
      documentKey: link.key,
      revisionId: e.sourceVersion,
      hash: e.hash,
    };
  });
  const [finished] = await tx.execute(
    sql`select clock_timestamp() as observed_at`,
  );
  if (
    new Date(finished!.observed_at as string | Date).getTime() -
      new Date(started!.observed_at as string | Date).getTime() >
    5000
  )
    throw conflict("The complete first-result read exceeded its budget");
  // Refuse incomplete/oversized evidence; never truncate a verification packet.
  return activationFirstValueResultSchema.parse({
    installationId,
    verificationRunId,
    issueId: task.id,
    runId: execution.run.id,
    resultHash: review.resultHash,
    title: task.title,
    verifiedAt: review.completedAt.toISOString(),
    artifacts,
  });
}

export async function activationFirstValueView(
  tx: Db,
  actor: AuthorizationActor,
  companyId: string,
  onboarding: Onboarding,
  allowCandidates: boolean,
) {
  const receipt = onboarding.activationState.firstValueReceipt;
  if (receipt) {
    try {
      const result = await readActivationFirstValue(
        tx,
        actor,
        companyId,
        onboarding,
        receipt.installationId,
        receipt.verificationRunId,
      );
      if (
        result.issueId !== receipt.issueId ||
        result.runId !== receipt.runId ||
        result.resultHash !== receipt.resultHash
      )
        throw conflict("Recorded first-result references changed");
      return {
        status: "verified" as const,
        result,
        candidates: [],
        hasMore: false,
      };
    } catch (error) {
      if (
        !(error instanceof HttpError) ||
        ![403, 404, 409].includes(error.status)
      )
        throw error;
      return {
        status: "withdrawn" as const,
        result: null,
        candidates: [],
        hasMore: false,
      };
    }
  }
  const candidates: Array<
    ReturnType<typeof activationFirstValueResultSchema.parse>
  > = [];
  if (allowCandidates && ["review", "running"].includes(onboarding.activationState.step)) {
    const rows = await tx
      .select({
        installationId: companyAgentPackageInstallations.id,
        verificationRunId: verificationRuns.id,
      })
      .from(verificationRuns)
      .innerJoin(
        orchestrationPlans,
        and(
          eq(orchestrationPlans.companyId, verificationRuns.companyId),
          eq(orchestrationPlans.id, verificationRuns.planId),
        ),
      )
      .innerJoin(
        issues,
        and(
          eq(issues.companyId, verificationRuns.companyId),
          eq(issues.id, verificationRuns.issueId),
        ),
      )
      .innerJoin(
        companyAgentPackageInstallations,
        and(
          eq(
            companyAgentPackageInstallations.companyId,
            verificationRuns.companyId,
          ),
          eq(companyAgentPackageInstallations.agentId, issues.assigneeAgentId),
        ),
      )
      .where(
        and(
          eq(verificationRuns.companyId, companyId),
          eq(verificationRuns.result, "pass"),
          eq(orchestrationPlans.createdBy, onboarding.createdByUserId),
          eq(
            companyAgentPackageInstallations.installedVersionId,
            onboarding.activationState.packageVersionId!,
          ),
          gte(verificationRuns.completedAt, onboarding.createdAt),
        ),
      )
      .orderBy(desc(verificationRuns.completedAt), verificationRuns.id)
      .limit(6);
    for (const row of rows) {
      try {
        candidates.push(
          await readActivationFirstValue(
            tx,
            actor,
            companyId,
            onboarding,
            row.installationId,
            row.verificationRunId,
          ),
        );
      } catch (error) {
        if (
          !(error instanceof HttpError) ||
          ![403, 404, 409].includes(error.status)
        )
          throw error;
      }
    }
  }
  return {
    status: "not_recorded" as const,
    result: null,
    candidates: candidates.slice(0, 5),
    hasMore: candidates.length > 5,
  };
}
