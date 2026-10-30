import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { heartbeatRuns, issues, issueThreadInteractions, statusDecisions, type Db } from "@paperclipai/db";
import type { ExecutionContinuationEnvelope } from "@paperclipai/shared";
import { issueReadSqlCondition, heartbeatRunReadSqlCondition, type AuthorizationActor } from "../authorization.js";

/** Recorded decisions are evidence for the parent, never new review authority. */
export async function childReviewOutcomes(
  db: Db,
  companyId: string,
  parentIssueId: string,
  reader: AuthorizationActor = { type: "none" },
): Promise<ExecutionContinuationEnvelope["interactionOutcomes"]> {
  const rows = await db.select({
    id: issueThreadInteractions.id,
    status: issueThreadInteractions.status,
    childTaskId: issues.id,
    childTaskIdentifier: issues.identifier,
    childTaskStatus: issues.status,
    sourceDecisionId: statusDecisions.id,
    sourceRunId: issueThreadInteractions.sourceRunId,
    reviewerAgentId: issueThreadInteractions.resolvedByAgentId,
    reviewerUserId: issueThreadInteractions.resolvedByUserId,
    reviewerRunId: issueThreadInteractions.resolvedByRunId,
    resolvedAt: issueThreadInteractions.resolvedAt,
  }).from(issues)
    .innerJoin(issueThreadInteractions, and(
      eq(issueThreadInteractions.issueId, issues.id),
      eq(issueThreadInteractions.companyId, issues.companyId),
    ))
    .innerJoin(statusDecisions, and(
      eq(statusDecisions.issueId, issues.id),
      eq(statusDecisions.companyId, issues.companyId),
      eq(statusDecisions.runId, issueThreadInteractions.sourceRunId),
      sql`${statusDecisions.id}::text = ${issueThreadInteractions.payload}->'target'->>'revisionId'`,
      eq(statusDecisions.applicationState, "applied"),
    ))
    .innerJoin(heartbeatRuns, and(
      eq(heartbeatRuns.id, statusDecisions.runId),
      eq(heartbeatRuns.companyId, issues.companyId),
      eq(heartbeatRuns.nativeIssueId, issues.id),
    ))
    .where(and(
      eq(issues.companyId, companyId),
      eq(issues.parentId, parentIssueId),
      await issueReadSqlCondition(db, reader),
      await heartbeatRunReadSqlCondition(db, reader),
      or(isNull(issueThreadInteractions.createdByAgentId), eq(heartbeatRuns.agentId, issueThreadInteractions.createdByAgentId)),
      or(isNull(issueThreadInteractions.resolvedByRunId), sql`exists (
        select 1 from ${heartbeatRuns} where ${heartbeatRuns.id}=${issueThreadInteractions.resolvedByRunId}
          and ${heartbeatRuns.companyId}=${companyId} and ${heartbeatRuns.nativeIssueId}=${issues.id}
          and (${issueThreadInteractions.resolvedByAgentId} is null or ${heartbeatRuns.agentId}=${issueThreadInteractions.resolvedByAgentId})
          and ${await heartbeatRunReadSqlCondition(db, reader)}
      )`),
      eq(issueThreadInteractions.kind, "request_confirmation"),
      inArray(issueThreadInteractions.status, ["accepted", "rejected"]),
      sql`${issueThreadInteractions.payload}->'target'->>'type' = 'custom'`,
      sql`${issueThreadInteractions.payload}->'target'->>'key' = 'native_completion_review'`,
    ))
    .orderBy(desc(issueThreadInteractions.resolvedAt), desc(issueThreadInteractions.id))
    .limit(50);
  return rows.map(({ id, status, resolvedAt, ...result }) => ({
    id,
    kind: "native_completion_review",
    status,
    result: { ...result, resolvedAt: resolvedAt?.toISOString() ?? null },
  }));
}
