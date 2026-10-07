import { planningProblemSchema, type NativePlanningResult, type PlanningProblem } from "@paperclipai/shared";
import { nativeSha256 as hash } from "../native-runtime/canonical.js";

const limits = { tasks: 200, dependencies: 2000, horizonDays: 366, pools: 32, paretoCandidates: 32, operations: 5_000_000 } as const;
type Task = PlanningProblem["tasks"][number];

/** Bounded, deterministic, non-preemptive UTC-day scheduling. No domain mutation. */
export function solveNativePlanning(raw: unknown): NativePlanningResult {
  const problem = planningProblemSchema.parse(raw);
  // Normalize unordered mathematical sets; policy arrays retain their explicit order.
  problem.tasks.sort((a, b) => a.key.localeCompare(b.key));
  problem.pools.sort((a, b) => a.key.localeCompare(b.key));
  problem.dependencies.sort((a, b) => a.before.localeCompare(b.before) || a.after.localeCompare(b.after));
  for (const task of problem.tasks) task.demands.sort((a, b) => a.poolKey.localeCompare(b.poolKey));
  const result: NativePlanningResult = {
    provider: { key: "aw_native_constraints", version: "1" }, status: "inconclusive", optimality: "not_proven",
    inputHash: hash(problem), resultHash: "", schedule: [], criticalPath: null,
    pareto: { status: "not_requested", taskKeys: [] }, diagnostics: [], objective: problem.policy, limits,
    limitations: ["All supplied tasks are required; this solve does not select or cancel initiatives.", "Capacity and duration are explicit company inputs, not inferred human productivity.", "UTC-day non-preemptive greedy scheduling; feasibility is checked, global optimality is not established.", "Equal company policy values use stable task-key order as a deterministic tie-break.", "This mathematical result grants no execution, budget, staffing or Roadmap authority."],
  };
  const finish = () => { const { resultHash: _hash, ...material } = result; result.resultHash = hash(material); return result; };
  const diagnostic = (code: string, taskKeys: string[] = [], poolKeys: string[] = []) => result.diagnostics.push({ code, taskKeys, poolKeys });
  const tasks = new Map(problem.tasks.map((task) => [task.key, task]));
  const before = new Map(problem.tasks.map((task) => [task.key, [] as string[]]));
  const after = new Map(problem.tasks.map((task) => [task.key, [] as string[]]));
  for (const edge of problem.dependencies) { before.get(edge.after)!.push(edge.before); after.get(edge.before)!.push(edge.after); }
  const compare = (a: Task, b: Task) => {
    if (problem.policy.mandatoryCommitmentsFirst && a.mandatoryCommitment !== b.mandatoryCommitment) return a.mandatoryCommitment ? -1 : 1;
    for (const dimension of problem.policy.orderBy) {
      const av = a.dimensions[dimension.key], bv = b.dimensions[dimension.key];
      if (av != null && bv != null && av !== bv) return (dimension.direction === "maximize" ? -1 : 1) * (av < bv ? -1 : 1);
    }
    return a.key.localeCompare(b.key);
  };
  const pending = new Map(problem.tasks.map((task) => [task.key, before.get(task.key)!.length]));
  const ready = problem.tasks.filter((task) => pending.get(task.key) === 0);
  const ordered: Task[] = [];
  while (ready.length) {
    ready.sort(compare); const task = ready.shift()!; ordered.push(task);
    for (const child of after.get(task.key)!) { pending.set(child, pending.get(child)! - 1); if (pending.get(child) === 0) ready.push(tasks.get(child)!); }
  }
  if (ordered.length !== problem.tasks.length) {
    result.status = "infeasible"; diagnostic("dependency_cycle", problem.tasks.filter((task) => pending.get(task.key)! > 0).map((task) => task.key)); return finish();
  }
  for (const task of problem.tasks) {
    if (task.durationDays === null) diagnostic("unknown_duration", [task.key]);
    for (const dimension of problem.policy.orderBy) if (task.dimensions[dimension.key] == null) diagnostic("unknown_policy_dimension", [task.key]);
  }
  for (const pool of problem.pools) {
    if (pool.days.some((day) => day.availableMinutes === null || day.committedMinutes === null)) diagnostic("unknown_capacity", [], [pool.key]);
    if (pool.days.some((day) => day.availableMinutes !== null && day.committedMinutes !== null && day.committedMinutes > day.availableMinutes)) diagnostic("existing_capacity_overcommit", [], [pool.key]);
  }
  if (result.diagnostics.some((item) => item.code === "existing_capacity_overcommit")) { result.status = "infeasible"; return finish(); }
  if (result.diagnostics.length) return finish();
  const earliest = new Map<string, { start: number; end: number; path: string[] }>();
  for (const task of ordered) {
    const parents = before.get(task.key)!.map((key) => earliest.get(key)!).sort((a, b) => b.end - a.end || a.path.join(":").localeCompare(b.path.join(":")));
    const parent = parents[0], start = Math.max(task.releaseDay, parent?.end ?? 0), end = start + task.durationDays!;
    earliest.set(task.key, { start, end, path: [...(parent && parent.end >= task.releaseDay ? parent.path : []), task.key] });
    if (end > (task.deadlineDay ?? problem.horizon.days)) diagnostic("critical_path_exceeds_deadline", [task.key]);
  }
  const longest = [...earliest.values()].sort((a, b) => b.end - a.end || a.path.join(":").localeCompare(b.path.join(":")))[0]!;
  result.criticalPath = { taskKeys: longest.path, earliestCompletionDay: longest.end };
  if (result.diagnostics.length) { result.status = "infeasible"; return finish(); }
  const capacity = new Map(problem.pools.map((pool) => [pool.key, pool.days.map((day) => day.availableMinutes! - day.committedMinutes!)]));
  for (const pool of problem.pools) {
    const required = problem.tasks.reduce((sum, task) => sum + task.durationDays! * (task.demands.find((demand) => demand.poolKey === pool.key)?.minutesPerDay ?? 0), 0);
    if (required > capacity.get(pool.key)!.reduce((sum, minutes) => sum + minutes, 0)) diagnostic("total_required_capacity_exceeds_available", problem.tasks.filter((task) => task.demands.some((demand) => demand.poolKey === pool.key)).map((task) => task.key), [pool.key]);
  }
  if (result.diagnostics.length) { result.status = "infeasible"; return finish(); }
  let operations = 0;
  const schedule = new Map<string, { taskKey: string; startDay: number; endDay: number }>();
  for (const task of ordered) {
    const first = Math.max(task.releaseDay, ...before.get(task.key)!.map((key) => schedule.get(key)!.endDay));
    const last = (task.deadlineDay ?? problem.horizon.days) - task.durationDays!;
    let chosen: number | null = null;
    for (let start = first; start <= last && chosen === null; start++) {
      let fits = true;
      for (let day = start; day < start + task.durationDays! && fits; day++) for (const demand of task.demands) {
        if (++operations > limits.operations) { diagnostic("operation_budget_exhausted", [task.key]); return finish(); }
        if (capacity.get(demand.poolKey)![day]! < demand.minutesPerDay) { fits = false; break; }
      }
      if (fits) chosen = start;
    }
    if (chosen === null) {
      // Greedy failure does not prove that another ordering is infeasible.
      diagnostic("greedy_allocation_unresolved", [task.key], task.demands.map((demand) => demand.poolKey)); return finish();
    }
    const item = { taskKey: task.key, startDay: chosen, endDay: chosen + task.durationDays! };
    schedule.set(task.key, item);
    for (let day = item.startDay; day < item.endDay; day++) for (const demand of task.demands) capacity.get(demand.poolKey)![day] -= demand.minutesPerDay;
  }
  result.schedule = [...schedule.values()]; result.status = "feasible_best_known";
  const dimensions = problem.policy.paretoDimensions;
  if (dimensions.length) {
    if (problem.tasks.length > limits.paretoCandidates) result.pareto.status = "candidate_limit";
    else if (problem.tasks.some((task) => dimensions.some((dimension) => task.dimensions[dimension.key] == null))) result.pareto.status = "unknown_dimensions";
    else {
      const dominates = (a: Task, b: Task) => {
        const comparison = dimensions.map((dimension) => (dimension.direction === "maximize" ? 1 : -1) * (a.dimensions[dimension.key]! - b.dimensions[dimension.key]!));
        return comparison.every((value) => value >= 0) && comparison.some((value) => value > 0);
      };
      result.pareto = { status: "available", taskKeys: problem.tasks.filter((task) => !problem.tasks.some((other) => other.key !== task.key && dominates(other, task))).map((task) => task.key) };
    }
  }
  return finish();
}

/** Independently checks a provider's proposed schedule against the supplied math. */
export function validatePlanningSchedule(raw: unknown, schedule: NativePlanningResult["schedule"]): { valid: boolean; violations: string[] } {
  const problem = planningProblemSchema.parse(raw), violations: string[] = [];
  if (!Array.isArray(schedule) || schedule.length > limits.tasks) return { valid: false, violations: ["schedule_budget"] };
  const byKey = new Map(schedule.map((item) => [item.taskKey, item]));
  if (schedule.length !== problem.tasks.length || byKey.size !== schedule.length || schedule.some((item) => !problem.tasks.some((task) => task.key === item.taskKey))) violations.push("exact_task_coverage");
  const usage = new Map(problem.pools.map((pool) => [pool.key, Array<number>(problem.horizon.days).fill(0)]));
  for (const task of problem.tasks) {
    const item = byKey.get(task.key); if (!item) continue;
    if (!Number.isInteger(item.startDay) || !Number.isInteger(item.endDay) || item.startDay < task.releaseDay || item.endDay > (task.deadlineDay ?? problem.horizon.days) || task.durationDays === null || item.endDay - item.startDay !== task.durationDays) { violations.push(`task_window:${task.key}`); continue; }
    for (let day = item.startDay; day < item.endDay; day++) for (const demand of task.demands) usage.get(demand.poolKey)![day] += demand.minutesPerDay;
  }
  for (const edge of problem.dependencies) if (byKey.has(edge.before) && byKey.has(edge.after) && byKey.get(edge.before)!.endDay > byKey.get(edge.after)!.startDay) violations.push(`dependency:${edge.before}:${edge.after}`);
  for (const pool of problem.pools) if (pool.days.some((day, index) => day.availableMinutes === null || day.committedMinutes === null || usage.get(pool.key)![index]! + day.committedMinutes > day.availableMinutes)) violations.push(`capacity:${pool.key}`);
  return { valid: violations.length === 0, violations: [...new Set(violations)] };
}
