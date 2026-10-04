import type { BudgetPolicySummary, ProjectRoadmap, RoadmapTask } from "@paperclipai/shared";

const dayMs = 86_400_000;
type Context = {
  dependencies?: ProjectRoadmap["dependencies"];
  milestones?: ProjectRoadmap["milestones"];
  waitingApprovalTaskIds?: readonly string[];
  budgets?: readonly BudgetPolicySummary[] | null;
  stallHours?: number;
};

/** Facts use only the caller's visible tasks. Missing observations stay unknown. */
export function roadmapHealth(tasks: readonly RoadmapTask[], now: Date, context: Context = {}): ProjectRoadmap["health"] {
  const open = tasks.filter((task) => !["done", "cancelled"].includes(task.status));
  const openIds = new Set(open.map((task) => task.id));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const blockerIds = new Set(open.filter((task) => task.status === "blocked").map((task) => task.id));
  const criticalIds = new Set(open.filter((task) => ["critical", "high"].includes(task.priority ?? "")).map((task) => task.id));
  for (const edge of context.dependencies ?? []) {
    if (openIds.has(edge.issueId) && openIds.has(edge.relatedIssueId)) {
      blockerIds.add(edge.issueId);
      criticalIds.add(edge.issueId);
    }
  }
  const overdue = open.filter((task) => task.plannedEndAt && Date.parse(task.plannedEndAt) < now.getTime());
  const slipping = open.filter((task) => task.forecastEndAt && task.plannedEndAt && Date.parse(task.forecastEndAt) > Date.parse(task.plannedEndAt));
  const unassigned = open.filter((task) => criticalIds.has(task.id) && !task.assigneeAgentId && !task.assigneeUserId);
  const stallHours = Number.isFinite(context.stallHours) && context.stallHours! > 0 ? context.stallHours! : 72;
  const stalled = open.filter((task) => task.status === "in_progress" && now.getTime() - Date.parse(task.updatedAt) >= stallHours * 3_600_000);
  const waiting = [...new Set(context.waitingApprovalTaskIds ?? [])].filter((id) => openIds.has(id)).sort();
  const milestoneVariance = (context.milestones ?? []).flatMap((milestone) => {
    if (milestone.status === "cancelled") return [];
    const plannedEnd = milestone.plannedEndAt ?? (milestone.targetDate ? `${milestone.targetDate}T23:59:59.999Z` : null);
    if (!plannedEnd) return [{ milestoneId: milestone.id, days: null, basis: "unknown" as const }];
    const children = tasks.filter((task) => task.milestoneId === milestone.id && task.status !== "cancelled");
    const forecastEnds = children.flatMap((task) => task.forecastEndAt ? [Date.parse(task.forecastEndAt)] : []);
    const completed = milestone.completedAt ? Date.parse(milestone.completedAt) : null;
    const observed = completed ?? (forecastEnds.length === children.length && children.length > 0 ? Math.max(...forecastEnds) : null);
    return [{ milestoneId: milestone.id, days: observed === null ? null : Math.ceil((observed - Date.parse(plannedEnd)) / dayMs), basis: completed !== null ? "actual" as const : observed !== null ? "forecast" as const : "unknown" as const }];
  });
  const budgets = context.budgets?.filter((budget) => budget.isActive && budget.amount > 0).map((budget) => ({ policyId: budget.policyId, windowKind: budget.windowKind, utilizationPercent: budget.utilizationPercent, status: budget.status })) ?? null;
  const facts = [
    blockerIds.size ? `${blockerIds.size} accessible tasks are blocked or block unfinished work` : null,
    overdue.length ? `${overdue.length} accessible tasks are past their committed end` : null,
    slipping.length ? `${slipping.length} forecasts extend beyond the committed plan` : null,
    unassigned.length ? `${unassigned.length} critical or blocking tasks have no owner` : null,
    waiting.length ? `${waiting.length} accessible tasks wait for approval` : null,
    stalled.length ? `${stalled.length} active tasks have no task update in ${stallHours} hours` : null,
    milestoneVariance.some((milestone) => milestone.days !== null && milestone.days > 0) ? "A milestone actual or complete forecast exceeds its planned end" : null,
    budgets?.some((budget) => budget.status !== "ok") ? "A visible project budget reached its warning or hard-stop threshold" : null,
  ].filter((fact): fact is string => fact !== null);
  const hardStop = budgets?.some((budget) => budget.status === "hard_stop");
  const ids = (items: readonly RoadmapTask[]) => items.map((task) => task.id).sort();
  const status = blockerIds.size || hardStop ? "blocked" : facts.length ? "at_risk" : open.some((task) => task.plannedEndAt) ? "on_track" : "unknown";
  return { status, facts, observedAt: now.toISOString(), metrics: {
    openBlockerTaskIds: [...blockerIds].filter((id) => byId.has(id)).sort(), overdueTaskIds: ids(overdue), forecastSlipTaskIds: ids(slipping),
    unassignedCriticalTaskIds: ids(unassigned), waitingApprovalTaskIds: context.waitingApprovalTaskIds ? waiting : null,
    stalledActiveTaskIds: ids(stalled), stallHours, milestoneVariance, budgetUtilization: budgets,
  } };
}
