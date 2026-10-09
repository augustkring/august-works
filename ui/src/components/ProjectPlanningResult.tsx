import type { NativePlanningResult } from "@paperclipai/shared";
import { Badge } from "./ui/badge";

const messages: Record<string, string> = {
  dependency_cycle: "A dependency cycle prevents a valid task order.",
  unknown_duration: "A task duration is still unknown.",
  unknown_policy_dimension: "A value required by the declared priority policy is unknown.",
  unknown_capacity: "Available or committed capacity is unknown.",
  existing_capacity_overcommit: "Committed capacity already exceeds declared availability.",
  critical_path_exceeds_deadline: "The earliest dependency completion exceeds the task deadline or horizon.",
  total_required_capacity_exceeds_available: "Required work exceeds the total declared available capacity.",
  greedy_allocation_unresolved: "This task order could not fit. Another order may work; infeasibility has not been proved.",
  operation_budget_exhausted: "The bounded calculation stopped before establishing a complete schedule.",
};
function utcDate(start: string, offset: number) { return new Date(Date.parse(`${start}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10); }
export function ProjectPlanningResult({ result, horizonStart, taskLabels, current = true }: { result: NativePlanningResult; horizonStart: string; taskLabels: Record<string, string>; current?: boolean }) {
  const name = (key: string) => taskLabels[key] ?? "Retained task reference";
  return <section aria-label="Declared planning constraint result" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">Constraint result</h3><Badge variant={result.status === "infeasible" ? "destructive" : "outline"}>{result.status === "feasible_best_known" ? current ? "Checked feasible schedule" : "Retained feasible calculation" : result.status === "infeasible" ? "Infeasible constraints" : "Inconclusive"}</Badge></div>
    {!current && <p role="status" className="rounded-md border bg-muted p-3">The source changed. This is the original retained calculation; it requires a fresh proposal before new reliance.</p>}
    <p>The calculation uses declared duration, capacity and company priority rules. Global optimality is not established. A separate human Roadmap review is required before task dates change.</p>
    {result.diagnostics.length > 0 && <ul className="list-disc space-y-2 pl-5">{result.diagnostics.map((diagnostic, index) => <li key={index}><p>{messages[diagnostic.code] ?? "An admitted constraint could not be established."}</p>{diagnostic.taskKeys.length > 0 && <p className="break-words text-sm text-muted-foreground">Tasks: {diagnostic.taskKeys.map(name).join(" · ")}</p>}{diagnostic.poolKeys.length > 0 && <p className="break-words text-sm text-muted-foreground">Declared capacity pools: {diagnostic.poolKeys.join(" · ")}</p>}</li>)}</ul>}
    {result.criticalPath && <section className="space-y-2"><h4 className="font-medium">Dependency bound</h4><p className="break-words">{result.criticalPath.taskKeys.map(name).join(" → ")}</p><p>Earliest completion bound: {utcDate(horizonStart, result.criticalPath.earliestCompletionDay)}. This bound excludes capacity conflicts.</p></section>}
    {result.status === "feasible_best_known" && <div className="overflow-x-auto rounded-md border"><table className="w-full text-left text-sm"><caption className="p-3 text-left">Original proposed UTC intervals; end is exclusive. Task labels come from the current authorized Roadmap.</caption><thead><tr><th className="p-3">Task</th><th className="p-3">Start</th><th className="p-3">End</th></tr></thead><tbody>{result.schedule.map((item) => <tr key={item.taskKey} className="border-t"><th className="break-words p-3 font-normal">{name(item.taskKey)}</th><td className="p-3">{utcDate(horizonStart, item.startDay)}</td><td className="p-3">{utcDate(horizonStart, item.endDay)}</td></tr>)}</tbody></table></div>}
    {result.pareto.status !== "not_requested" && <section className="space-y-2"><h4 className="font-medium">Separate dimension trade-offs</h4>{result.pareto.status === "available" ? <><p>These tasks are not dominated on the explicitly selected dimensions. This does not combine them into a universal priority score or select initiatives.</p><ul className="list-disc pl-5">{result.pareto.taskKeys.map((key) => <li className="break-words" key={key}>{name(key)}</li>)}</ul></> : <p>{result.pareto.status === "unknown_dimensions" ? "Some selected dimension values are unknown." : "The candidate set exceeds the bounded comparison limit."}</p>}</section>}
    <details className="space-y-2"><summary className="cursor-pointer font-medium">Calculation basis and limits</summary><p>Native transparent constraints · version {result.provider.version}</p><p>Mandatory commitments first: {result.objective.mandatoryCommitmentsFirst ? "yes" : "no"}.</p>{result.objective.orderBy.length > 0 ? <ol className="list-decimal space-y-1 pl-5">{result.objective.orderBy.map((dimension) => <li key={dimension.key}>{dimension.key.replaceAll("_", " ")} · {dimension.direction === "maximize" ? "larger values first" : "smaller values first"}</li>)}</ol> : <p>No business ranking was declared; dependency-ready ties use stable task references.</p>}<p>Up to {result.limits.tasks} tasks, {result.limits.dependencies} dependencies and {result.limits.horizonDays} days.</p><ul className="list-disc space-y-1 pl-5">{result.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>
  </section>;
}
