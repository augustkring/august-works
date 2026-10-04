import type { ProjectRoadmap } from "@paperclipai/shared";
import { Link } from "@/lib/router";

export function ProjectHealthObservations({ roadmap }: { roadmap: ProjectRoadmap }) {
  const metrics = roadmap.health.metrics;
  if (!metrics) return null;
  const tasks = new Map(roadmap.tasks.map((task) => [task.id, task]));
  const groups: Array<[string, string[] | null]> = [
    ["Open blockers", metrics.openBlockerTaskIds], ["Overdue tasks", metrics.overdueTaskIds],
    ["Forecast slip", metrics.forecastSlipTaskIds], ["Unassigned critical tasks", metrics.unassignedCriticalTaskIds],
    ["Waiting approvals", metrics.waitingApprovalTaskIds], [`No task update in ${metrics.stallHours} hours`, metrics.stalledActiveTaskIds],
  ];
  return <details className="rounded-md border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Health observations and source tasks</summary>
    <div className="space-y-3 pt-3">
      <p className="text-muted-foreground">Calculated from tasks you can read at {new Date(roadmap.health.observedAt).toLocaleString()}. Missing forecasts and budget access remain unknown.</p>
      {groups.map(([name, ids]) => <div key={name}><p className="font-medium">{name}: {ids === null ? "unknown" : ids.length}</p>{ids && ids.length > 0 && <ul className="list-inside list-disc">{ids.map((id) => <li key={id}><Link className="text-primary underline" to={`/issues/${tasks.get(id)?.identifier ?? id}`}>{tasks.get(id)?.title ?? "Task"}</Link></li>)}</ul>}</div>)}
      <div><p className="font-medium">Milestone variance</p><ul className="list-inside list-disc">{metrics.milestoneVariance.map((item) => <li key={item.milestoneId}>{roadmap.milestones.find((milestone) => milestone.id === item.milestoneId)?.name ?? "Milestone"}: {item.days === null ? "unknown; a complete forecast or recorded completion is required" : `${item.days} days (${item.basis})`}</li>)}</ul></div>
      <div><p className="font-medium">Project budget utilization</p>{metrics.budgetUtilization === null ? <p>Unknown; current budget authority is required.</p> : metrics.budgetUtilization.length === 0 ? <p>No active project budget is configured.</p> : <ul className="list-inside list-disc">{metrics.budgetUtilization.map((budget) => <li key={budget.policyId}>{budget.utilizationPercent}% of {budget.windowKind.replaceAll("_", " ")} budget · {budget.status.replaceAll("_", " ")}</li>)}</ul>}</div>
    </div>
  </details>;
}
