import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, issues } from "@paperclipai/db";

/**
 * Serialize native runtime selection in the same issue → run order used by
 * issue claims. Native finalization rows reference both records, so locking
 * the run first can deadlock against a concurrent issue claim that already
 * owns the issue row.
 */
export async function lockNativeRuntimeSelectionRows(
  tx: Db,
  input: { companyId: string; runId: string; issueId: string | null },
) {
  if (input.issueId) {
    const [lockedIssue] = await tx
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)))
      .for("update")
      .limit(1);
    if (!lockedIssue) throw new Error("native_runtime_issue_missing");
  }

  const [lockedRun] = await tx
    .select()
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.companyId, input.companyId)))
    .for("update")
    .limit(1);
  if (!lockedRun) throw new Error("native_runtime_run_missing");
  if (
    (lockedRun.issueId !== null && lockedRun.issueId !== input.issueId) ||
    (lockedRun.nativeIssueId !== null && lockedRun.nativeIssueId !== input.issueId)
  ) {
    throw new Error("native_runtime_issue_binding_changed");
  }
  const snapshotIssueId = lockedRun.contextSnapshot &&
    (typeof lockedRun.contextSnapshot.issueId === "string"
      ? lockedRun.contextSnapshot.issueId
      : typeof lockedRun.contextSnapshot.taskId === "string"
        ? lockedRun.contextSnapshot.taskId
        : null);
  if (snapshotIssueId !== null && snapshotIssueId !== input.issueId) {
    throw new Error("native_runtime_issue_binding_changed");
  }
  return lockedRun;
}
