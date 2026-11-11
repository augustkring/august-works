import { and, eq, inArray, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { toolInvocations, type Db } from "@paperclipai/db";

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
