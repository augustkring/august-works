/**
 * APR-E2E-17 (option A). TypeScript mirror of the parked-approved exception
 * that migration 0588 adds to `aw_v7_orchestration_tool_charge`, together with
 * the unchanged plan checks that follow it in that trigger. The database
 * trigger is the authority; this mirror documents the predicate and is kept in
 * agreement with it by `parked-approved-tool-charge.integration.test.ts`.
 *
 * It answers one question for an invocation of a Run that has an orchestration
 * worker attempt whose attempt or Run is no longer running: may the tool
 * gateway's server-side execution of a Human-approved parked call move it to
 * `executing` and be charged to its original plan?
 */
export type ParkedApprovedToolChargeFacts = {
  transition: { operation: "INSERT" | "UPDATE"; oldStatus: string | null; newStatus: string; approvalState: string };
  invocation: { id: string; companyId: string; runId: string | null; issueId: string | null; agentId: string | null };
  /** Every action request row of this invocation. */
  requests: ReadonlyArray<{ companyId: string; invocationId: string; status: string; decidedByUserId: string | null;
    decidedByAgentId: string | null; decidedAt: Date | null }>;
  /** The orchestration worker attempts of the invocation's Run, with their Run, Worker and Task. */
  attempts: ReadonlyArray<{ companyId: string; runId: string; planId: string; status: string; runStatus: string;
    runAgentId: string; workerIssueId: string; workerAgentId: string | null; taskStatus: string;
    taskAssigneeAgentId: string | null; cancellationRequested: boolean }>;
  /** The plan the trigger bound the invocation to (the plan of the Run's attempt). */
  plan: { id: string; status: string; erased: boolean; started: boolean; wallClockExceeded: boolean; featureGatesOn: boolean;
    toolActionsUsed: number; maxToolActions: number; alreadyChargedForInvocation: boolean };
  now: Date;
};

/** The exception itself: a server-executed, Human-approved parked invocation
 * on its original plan and Task. */
export function parkedApprovedToolExecution(f: ParkedApprovedToolChargeFacts): boolean {
  const { transition: t, invocation: inv } = f;
  if (t.operation !== "UPDATE" || t.oldStatus !== "awaiting_approval" || t.newStatus !== "executing" ||
    t.approvalState !== "approved" || inv.issueId === null || inv.agentId === null) return false;
  const requests = f.requests.filter(value => value.companyId === inv.companyId && value.invocationId === inv.id);
  if (requests.length !== 1) return false;
  const [request] = requests;
  if (request!.status !== "executing" || request!.decidedByUserId === null || request!.decidedByAgentId !== null ||
    request!.decidedAt === null || request!.decidedAt.getTime() > f.now.getTime()) return false;
  return f.attempts.some(value => value.companyId === inv.companyId && value.runId === inv.runId &&
    value.planId === f.plan.id && ["running", "succeeded"].includes(value.status) &&
    ["running", "succeeded"].includes(value.runStatus) && value.workerIssueId === inv.issueId &&
    value.workerAgentId === inv.agentId && value.runAgentId === inv.agentId &&
    !["done", "cancelled"].includes(value.taskStatus) && value.taskAssigneeAgentId === value.workerAgentId &&
    !value.cancellationRequested);
}

/** Whether the trigger admits the transition: the exception, then the plan,
 * wall-clock, feature-gate and tool-action budget hard stop, with a repeat
 * charge for the same invocation being a no-op. */
export function parkedApprovedToolChargeAllowed(f: ParkedApprovedToolChargeFacts): boolean {
  if (!parkedApprovedToolExecution(f)) return false;
  const p = f.plan;
  if (p.status !== "running" || p.erased || !p.started || p.wallClockExceeded || !p.featureGatesOn) return false;
  return p.alreadyChargedForInvocation || p.toolActionsUsed < p.maxToolActions;
}
