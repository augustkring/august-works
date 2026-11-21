import { and, desc, eq, gte } from "drizzle-orm";
import { issues, orchestrationPlans, statusDecisions, verificationRuns, type Db } from "@paperclipai/db";
import { activePlanCoveringTask } from "../orchestration/plan-coverage.js";

export type OrchestrationVerificationHold = {
  companyId: string;
  issueId: string;
  decisionId: string;
  planId: string;
};

/**
 * APR-E2E-25. A plan-covered Task that the status arbiter moved to review with
 * `orchestration_verification_required` waits for the plan's server
 * verification (MS1h14). Review-path recovery treats that hold as a maintained
 * review path. Every fact is re-read from the database:
 * - the Task is still `in_review`;
 * - its latest applied status decision is that hold;
 * - an unfinished, running plan still covers the Task;
 * - no verification of that plan for this Task has been recorded since the hold.
 * Any other in-review Task keeps today's recovery.
 */
export async function captureOrchestrationVerificationHold(
  db: Pick<Db, "select">,
  input: { companyId: string; issueId: string },
): Promise<OrchestrationVerificationHold | null> {
  const [task] = await db.select({ status: issues.status }).from(issues)
    .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).limit(1);
  if (task?.status !== "in_review") return null;
  const [decision] = await db.select({
    id: statusDecisions.id, toStatus: statusDecisions.toStatus, reasonCode: statusDecisions.reasonCode,
    appliedAt: statusDecisions.appliedAt,
  }).from(statusDecisions)
    .where(and(eq(statusDecisions.companyId, input.companyId), eq(statusDecisions.issueId, input.issueId),
      eq(statusDecisions.applicationState, "applied")))
    .orderBy(desc(statusDecisions.appliedAt), desc(statusDecisions.createdAt))
    .limit(1);
  if (!decision?.appliedAt || decision.reasonCode !== "orchestration_verification_required" ||
    decision.toStatus !== "in_review") return null;
  const planId = await activePlanCoveringTask(db, input.companyId, input.issueId);
  if (!planId) return null;
  const [plan] = await db.select({ status: orchestrationPlans.status, erasedAt: orchestrationPlans.erasedAt })
    .from(orchestrationPlans)
    .where(and(eq(orchestrationPlans.companyId, input.companyId), eq(orchestrationPlans.id, planId))).limit(1);
  if (plan?.status !== "running" || plan.erasedAt) return null;
  const [verified] = await db.select({ id: verificationRuns.id }).from(verificationRuns)
    .where(and(eq(verificationRuns.companyId, input.companyId), eq(verificationRuns.planId, planId),
      eq(verificationRuns.issueId, input.issueId), gte(verificationRuns.createdAt, decision.appliedAt)))
    .limit(1);
  if (verified) return null;
  return { companyId: input.companyId, issueId: input.issueId, decisionId: decision.id, planId };
}
