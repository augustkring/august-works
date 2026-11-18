import { and, asc, eq, notInArray, or, sql } from "drizzle-orm";
import { orchestrationPlans, orchestrationWorkers, type Db } from "@paperclipai/db";

/** The orchestration plan that is not finished and covers this Task, read in
 * the caller's transaction: the same fact aw_v7_orchestration_task_guard
 * (migration 0360) uses to refuse `done` before the plan's server verification
 * (the plan's own Task, or a worker Task whose worker is not completed). The
 * trigger stays the backstop.
 *
 * One helper for every caller that must not move a plan-covered Task to `done`
 * itself: the completion review accept (MS1h14), both execution-policy stage
 * approval routes and the Native status decision committer (MS1f). */
export async function activePlanCoveringTask(db: Pick<Db, "select">, companyId: string, issueId: string): Promise<string | null> {
  const [plan] = await db
    .select({ id: orchestrationPlans.id })
    .from(orchestrationPlans)
    .where(and(
      eq(orchestrationPlans.companyId, companyId),
      notInArray(orchestrationPlans.status, ["completed", "cancelled", "failed"]),
      or(
        eq(orchestrationPlans.issueId, issueId),
        sql`exists (select 1 from ${orchestrationWorkers} where ${orchestrationWorkers.companyId} = ${orchestrationPlans.companyId}
          and ${orchestrationWorkers.planId} = ${orchestrationPlans.id} and ${orchestrationWorkers.issueId} = ${issueId}
          and ${orchestrationWorkers.status} <> 'completed')`,
      ),
    ))
    .orderBy(asc(orchestrationPlans.createdAt))
    .limit(1);
  return plan?.id ?? null;
}
