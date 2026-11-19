import type { Db, issues } from "@paperclipai/db";
import {
  applyIssueExecutionPolicyTransition,
  normalizeIssueExecutionPolicy,
  parseIssueExecutionState,
} from "../issue-execution-policy.js";
import { activePlanCoveringTask } from "../orchestration/plan-coverage.js";

type NativeExecutorIssue = typeof issues.$inferSelect;

/**
 * The execution-policy transition a Native executor's `done` requests, exactly
 * as the status decision committer applies it. Pure; it throws when the policy
 * does not parse or no eligible stage participant exists.
 */
export function nativeExecutorDoneTransition(issue: NativeExecutorIssue, agentId: string) {
  const policy = normalizeIssueExecutionPolicy(issue.executionPolicy ?? null);
  const transition = applyIssueExecutionPolicyTransition({
    issue,
    policy,
    previousPolicy: policy,
    requestedStatus: "done",
    requestedAssigneePatch: {},
    actor: { agentId, userId: null },
    allowBoardOverride: false,
  });
  const nextExecutionStateValue = Object.hasOwn(transition.patch, "executionState")
    ? transition.patch.executionState
    : issue.executionState;
  return { transition, nextExecutionState: parseIssueExecutionState(nextExecutionStateValue) };
}

/**
 * MS1f decision 1. The executor's `done` transition when it would enter a
 * pending execution-policy stage, otherwise null (also when the transition
 * cannot be computed). A stage handoff applies only such a transition.
 */
export function nativeExecutorStageHandoffTransition(issue: NativeExecutorIssue, agentId: string) {
  try {
    const result = nativeExecutorDoneTransition(issue, agentId);
    return result.nextExecutionState?.status === "pending" ? result : null;
  } catch {
    return null;
  }
}

/**
 * MS1f decision 1. Finalizer dry run: a plan covers the Task (the 0360 guard's
 * fact, shared with the committer and the stage approval routes) and the
 * executor's `done` would enter a pending stage. The caller also requires a V7
 * `server_arbiter` contract. An already pending stage is a governance gate the
 * arbiter handles first. The committer rechecks all of it in its transaction.
 */
export async function nativeExecutionStageHandoffAvailable(
  db: Pick<Db, "select">,
  input: { companyId: string; issue: NativeExecutorIssue; agentId: string },
): Promise<boolean> {
  if ((await activePlanCoveringTask(db, input.companyId, input.issue.id)) === null) return false;
  return nativeExecutorStageHandoffTransition(input.issue, input.agentId) !== null;
}
