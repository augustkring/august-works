import { planningProblemSchema, portfolioPlanningProfileSchema, type NativePortfolioPlanningResult, type PlanningProblem, type PortfolioPlanningProfile, type PortfolioPlanningSources } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { nativePlanningProvider } from "./provider.js";

/** Bounded advisory mathematics. All current facts are supplied by native
 * admission; this module has no company, database, network or execution access. */
export async function solveNativePortfolioPlanning(raw: PortfolioPlanningProfile, sources: PortfolioPlanningSources, dependencies: PlanningProblem["dependencies"]): Promise<NativePortfolioPlanningResult> {
  const profile = portfolioPlanningProfileSchema.parse(raw), policy = profile.initiativePolicy;
  const current = new Map(sources.projects.map(project => [project.id, project]));
  const taskProject = new Map(sources.projects.flatMap(project => project.taskKeys.map(key => [key, project.id] as const)));
  if (current.size !== profile.projects.length || current.size !== sources.projects.length || profile.projects.some(project => !current.has(project.id)) || taskProject.size !== profile.tasks.length || profile.tasks.some(task => !taskProject.has(task.key)) || sources.projects.reduce((count, project) => count + project.taskKeys.length, 0) !== taskProject.size) throw new Error("Exact native portfolio population is required");
  if (sources.budgets.some(bound => bound.projectId !== null && !current.has(bound.projectId) || bound.remainingCents !== null && (!Number.isSafeInteger(bound.remainingCents) || bound.remainingCents < 0) || !Number.isFinite(Date.parse(bound.windowEnd)))) throw new Error("Native portfolio budget bounds are unavailable");
  // Validate the complete graph before selecting subsets; omitted predecessors
  // must never silently become satisfied dependencies.
  const problem = planningProblemSchema.parse({ horizon: profile.horizon, pools: profile.pools, policy: profile.policy, dependencies, tasks: profile.tasks.map(({ expectedUpdatedAt: _version, rationale: _rationale, ...task }) => task) });
  const mandatory = (item: PortfolioPlanningProfile["initiatives"][number]) => item.mandatoryCommitment || problem.tasks.some(task => taskProject.get(task.key) === item.projectId && task.mandatoryCommitment);
  const ordered = [...profile.initiatives].sort((a, b) => {
    if (policy.mandatoryCommitmentsFirst && mandatory(a) !== mandatory(b)) return mandatory(a) ? -1 : 1;
    for (const dimension of policy.orderBy) { const av = a.dimensions[dimension.key], bv = b.dimensions[dimension.key]; if ((av == null) !== (bv == null)) return av == null ? 1 : -1; if (av != null && bv != null && av !== bv) return (av < bv ? -1 : 1) * (dimension.direction === "maximize" ? -1 : 1); }
    return a.projectId.localeCompare(b.projectId);
  });
  const selected = new Set<string>(), candidates = new Map<string, NativePortfolioPlanningResult["candidates"][number]>();
  let schedule: NativePortfolioPlanningResult["schedule"] = null;
  const horizonEnd = Date.parse(`${profile.horizon.start}T00:00:00Z`) + profile.horizon.days * 86400000;
  function refuse(item: PortfolioPlanningProfile["initiatives"][number], reasons: string[], known = false) {
    const project = current.get(item.projectId)!;
    candidates.set(item.projectId, { projectId: item.projectId, disposition: known && !item.protectedCommitment && !mandatory(item) && project.status === "in_progress" ? "pause" : "investigate", reasons });
  }
  // ponytail: at most 20 greedy inclusion trials; global optimality is not
  // proved. Use the provider seam if an evidenced customer need warrants more.
  while (candidates.size < ordered.length) {
    let progressed = false;
    for (const item of ordered) {
      if (candidates.has(item.projectId)) continue;
      const project = current.get(item.projectId)!;
      const predecessors = [...new Set(dependencies.filter(edge => taskProject.get(edge.after) === item.projectId && taskProject.get(edge.before) !== item.projectId).map(edge => taskProject.get(edge.before)!))];
      if (predecessors.some(id => !candidates.has(id))) continue;
      progressed = true;
      if (project.paused || !["backlog", "planned", "in_progress"].includes(project.status)) { refuse(item, ["native_project_lifecycle_requires_investigation"]); continue; }
      if (item.preference === "investigate") { refuse(item, ["human_investigation_requested"]); continue; }
      if (item.preference === "stop") {
        if (item.protectedCommitment || mandatory(item)) refuse(item, ["protected_or_mandatory_commitment"]);
        else candidates.set(item.projectId, { projectId: item.projectId, disposition: "stop", reasons: ["explicit_human_stop_preference"] });
        continue;
      }
      if (predecessors.some(id => !selected.has(id))) { refuse(item, ["unselected_native_predecessor"]); continue; }
      const required = [...new Set([...policy.orderBy, ...policy.minimumDimensions].map(dimension => dimension.key))];
      if (required.some(key => item.dimensions[key] == null) || item.estimatedBilledCostCents === null) { refuse(item, ["unknown_declared_dimension_or_cost"]); continue; }
      if (policy.requireActiveGoal && !project.activeGoalIds.length) { refuse(item, ["no_current_native_active_goal"], true); continue; }
      if (policy.minimumDimensions.some(dimension => item.dimensions[dimension.key]! < dimension.minimum)) { refuse(item, ["below_explicit_company_dimension_minimum"], true); continue; }
      if (selected.size >= policy.maxSelectedActiveProjects) { refuse(item, ["selected_project_count_limit"], true); continue; }
      const trial = new Set([...selected, item.projectId]), bounds = sources.budgets.filter(bound => bound.projectId === null || trial.has(bound.projectId));
      if (bounds.some(bound => bound.remainingCents === null || bound.windowKind === "calendar_month_utc" && horizonEnd > Date.parse(bound.windowEnd))) { refuse(item, ["unknown_native_cost_or_budget_period_coverage"]); continue; }
      if (bounds.some(bound => (bound.projectId === null ? ordered.filter(candidate => trial.has(candidate.projectId)).reduce((total, candidate) => total + candidate.estimatedBilledCostCents!, 0) : ordered.find(candidate => candidate.projectId === bound.projectId)!.estimatedBilledCostCents!) > bound.remainingCents!)) { refuse(item, ["native_hard_budget_bound"], true); continue; }
      const keys = new Set(problem.tasks.filter(task => trial.has(taskProject.get(task.key)!)).map(task => task.key));
      const solved = await nativePlanningProvider.solve({ ...problem, tasks: problem.tasks.filter(task => keys.has(task.key)), dependencies: dependencies.filter(edge => keys.has(edge.before) && keys.has(edge.after)) });
      if (solved.result.status !== "feasible_best_known") { refuse(item, [solved.result.status === "infeasible" ? "native_capacity_or_deadline_infeasible" : "native_schedule_inconclusive", ...solved.result.diagnostics.map(diagnostic => diagnostic.code)], solved.result.status === "infeasible"); continue; }
      selected.add(item.projectId); schedule = solved.result;
      candidates.set(item.projectId, { projectId: item.projectId, disposition: project.status === "in_progress" ? "continue" : "start", reasons: ["feasible_under_declared_selected_scope_constraints"] });
    }
    if (!progressed) for (const item of ordered) if (!candidates.has(item.projectId)) refuse(item, ["native_project_dependency_cycle"]);
  }
  const result = {
    provider: { key: "aw_native_constraints" as const, version: "1" as const }, optimality: "not_proven" as const,
    candidates: [...candidates.values()].sort((a, b) => a.projectId.localeCompare(b.projectId)), selectedProjectIds: [...selected].sort(), schedule,
    authority: "human_initiative_review_required" as const,
    limitations: ["Advisory greedy choices for the explicitly selected native projects; no global portfolio optimality or universal business score.", "Dimensions, cost estimates and capacity are explicit Human assumptions, not inferred employee or agent productivity.", "Native billed-runtime budget bounds are not cash runway, spending permission or fund reservations; canonical budget enforcement remains authoritative.", "No project lifecycle, Task dates, budget, dispatch or execution changes are performed by this calculation."],
  };
  return { ...result, resultHash: nativeSha256({ profile, sources, dependencies, result }) };
}
