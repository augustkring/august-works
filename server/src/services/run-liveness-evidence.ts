import { and, asc, eq, inArray, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { activityLog, toolInvocations, type Db } from "@paperclipai/db";

import { isRunLivenessPlatformActivity, RUN_LIVENESS_BOOKKEEPING_ACTIVITY_ACTIONS } from "./run-liveness.js";

const TOOL_ACTION_EFFECT_STATUSES = ["executing", "succeeded", "failed", "timed_out"] as const;

/**
 * Counts actual dispatched tool invocations owned by this exact run and issue.
 * `startedAt` excludes denied, budget-blocked, and other pre-dispatch requests;
 * retaining in-flight and terminal failure rows prevents a dispatched unknown
 * outcome from being mistaken for no work and automatically replayed.
 * Completion/block proposals are control-plane reports, not task effects.
 */
export async function readRunLivenessToolActionStats(
  db: Db,
  input: { companyId: string; issueId: string; runId: string; agentId: string },
): Promise<{ count: number; latestAt: Date | null }> {
  const [stats] = await db.select({
    count: sql<number>`count(*)::int`,
    latestAt: sql<Date | null>`max(coalesce(${toolInvocations.completedAt}, ${toolInvocations.startedAt}, ${toolInvocations.createdAt}))`.mapWith(toolInvocations.completedAt),
  }).from(toolInvocations).where(and(
    eq(toolInvocations.companyId, input.companyId),
    eq(toolInvocations.issueId, input.issueId),
    eq(toolInvocations.runId, input.runId),
    eq(toolInvocations.agentId, input.agentId),
    inArray(toolInvocations.status, [...TOOL_ACTION_EFFECT_STATUSES]),
    isNotNull(toolInvocations.startedAt),
    or(
      isNotNull(toolInvocations.applicationId),
      isNotNull(toolInvocations.catalogEntryId),
      notInArray(toolInvocations.toolName, ["paperclip_finish", "paperclip_block"]),
    ),
  ));
  return { count: Number(stats?.count ?? 0), latestAt: stats?.latestAt ?? null };
}

const RUN_LIVENESS_ACTIVITY_ROW_LIMIT = 2_000;

/**
 * Activity evidence for one Run's liveness: recovery bookkeeping actions and
 * the platform-written rows (`isRunLivenessPlatformActivity`) are excluded, so
 * only effects that the Run itself produced count as concrete evidence.
 */
export async function readRunLivenessActivityStats(db: Db, companyId: string, runId: string) {
  const rows = await db.select({ action: activityLog.action, actorType: activityLog.actorType, actorId: activityLog.actorId,
    entityType: activityLog.entityType, details: activityLog.details, createdAt: activityLog.createdAt })
    .from(activityLog)
    .where(and(eq(activityLog.companyId, companyId), eq(activityLog.runId, runId),
      notInArray(activityLog.action, RUN_LIVENESS_BOOKKEEPING_ACTIVITY_ACTIONS)))
    .orderBy(asc(activityLog.createdAt))
    .limit(RUN_LIVENESS_ACTIVITY_ROW_LIMIT);
  const counted = rows.filter(row => !isRunLivenessPlatformActivity(row));
  const latestAt = counted.reduce<Date | null>((latest, row) => !latest || row.createdAt > latest ? row.createdAt : latest, null);
  return { count: counted.length, latestAt };
}
