import { describe, expect, it } from "vitest";
import { planningProblemSchema, type PlanningProblemInput } from "@paperclipai/shared";
import { solveNativePlanning, validatePlanningSchedule } from "../services/adaptive-planning/kernel.js";
import { nativePlanningProvider } from "../services/adaptive-planning/provider.js";

function fixture(): PlanningProblemInput {
  return {
    horizon: { start: "2026-10-07", days: 5 },
    tasks: [
      { key: "build", durationDays: 2, demands: [{ poolKey: "engineering", minutesPerDay: 240 }], mandatoryCommitment: false, dimensions: { value: 20, cost: 10 } },
      { key: "review", durationDays: 1, demands: [{ poolKey: "engineering", minutesPerDay: 240 }], mandatoryCommitment: true, dimensions: { value: 10, cost: 20 } },
      { key: "other", durationDays: 1, demands: [{ poolKey: "engineering", minutesPerDay: 240 }], mandatoryCommitment: false, dimensions: { value: 5, cost: 30 } },
    ],
    dependencies: [{ before: "build", after: "review" }],
    pools: [{ key: "engineering", days: Array.from({ length: 5 }, () => ({ availableMinutes: 480, committedMinutes: 0 })) }],
    policy: { mandatoryCommitmentsFirst: true, orderBy: [{ key: "value", direction: "maximize" }], paretoDimensions: [{ key: "value", direction: "maximize" }, { key: "cost", direction: "minimize" }] },
  };
}

describe("Native bounded planning over explicitly supplied mathematics", () => {
  it("qualifies the native provider seam against actual constrained execution and validation", async () => {
    const input = planningProblemSchema.parse(fixture()), solved = await nativePlanningProvider.solve(input);
    expect(solved.result.status).toBe("feasible_best_known"); expect(solved.runtimeMs).toBeGreaterThanOrEqual(0);
    expect(await nativePlanningProvider.validate(input, solved.result.schedule)).toEqual({ valid: true, violations: [] });
    expect(await nativePlanningProvider.health()).toEqual({ status: "ready", version: "1", databaseAccess: false, networkAccess: false });
    expect(nativePlanningProvider.capabilities()).toMatchObject({ globalOptimality: false, limits: { tasks: 200, operations: 5_000_000 } });
  });
  it("computes a valid dependency schedule and separate Pareto dimensions without claiming optimality", () => {
    const problem = fixture(), result = solveNativePlanning(problem);
    expect(result).toMatchObject({ status: "feasible_best_known", optimality: "not_proven", criticalPath: { taskKeys: ["build", "review"], earliestCompletionDay: 3 }, pareto: { status: "available", taskKeys: ["build"] } });
    expect(result.schedule).toEqual([{ taskKey: "build", startDay: 0, endDay: 2 }, { taskKey: "review", startDay: 2, endDay: 3 }, { taskKey: "other", startDay: 0, endDay: 1 }]);
    expect(validatePlanningSchedule(problem, result.schedule)).toEqual({ valid: true, violations: [] });
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/); expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("normalizes unordered input sets and never mutates the caller's source", () => {
    const a = fixture(), b = structuredClone(a); b.tasks.reverse(); const original = JSON.stringify(a);
    expect(solveNativePlanning(a)).toEqual(solveNativePlanning(b)); expect(JSON.stringify(a)).toBe(original);
  });
  it("uses explicit commitment policy before ambiguous business value", () => {
    const p = fixture(); p.dependencies = []; p.pools[0]!.days.forEach((day) => { day.availableMinutes = 240; });
    expect(solveNativePlanning(p).schedule[0]!.taskKey).toBe("review");
    p.policy.mandatoryCommitmentsFirst = false; expect(solveNativePlanning(p).schedule[0]!.taskKey).toBe("build");
  });
  it("abstains on unknown duration, policy dimensions or capacity instead of inventing them", () => {
    for (const change of [(p: PlanningProblemInput) => { p.tasks[0]!.durationDays = null; }, (p: PlanningProblemInput) => { p.tasks[0]!.dimensions.value = null; }, (p: PlanningProblemInput) => { p.pools[0]!.days[0]!.availableMinutes = null; }]) {
      const p = fixture(); change(p); const result = solveNativePlanning(p); expect(result.status).toBe("inconclusive"); expect(result.schedule).toEqual([]); expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
  it("identifies cycles and impossible critical-path deadlines", () => {
    const p = fixture(); p.dependencies.push({ before: "review", after: "build" });
    expect(solveNativePlanning(p)).toMatchObject({ status: "infeasible", schedule: [], diagnostics: [{ code: "dependency_cycle", taskKeys: ["build", "review"] }] });
    p.dependencies.pop(); p.tasks[1]!.deadlineDay = 2;
    expect(solveNativePlanning(p)).toMatchObject({ status: "infeasible", schedule: [], diagnostics: [{ code: "critical_path_exceeds_deadline", taskKeys: ["review"] }] });
  });
  it("identifies existing overcommit and mathematically insufficient aggregate capacity", () => {
    const p = fixture(); p.pools[0]!.days[0]!.committedMinutes = 481;
    expect(solveNativePlanning(p)).toMatchObject({ status: "infeasible", diagnostics: [{ code: "existing_capacity_overcommit", poolKeys: ["engineering"] }] });
    p.pools[0]!.days.forEach((day) => { day.availableMinutes = 100; day.committedMinutes = 0; });
    expect(solveNativePlanning(p)).toMatchObject({ status: "infeasible", schedule: [], diagnostics: [{ code: "total_required_capacity_exceeds_available", poolKeys: ["engineering"] }] });
  });
  it("keeps a greedy dead end inconclusive when another valid ordering exists", () => {
    const p = fixture(); p.tasks = p.tasks.slice(0, 2); p.dependencies = []; p.horizon.days = 3; p.pools[0]!.days = Array.from({ length: 3 }, () => ({ availableMinutes: 240, committedMinutes: 0 }));
    p.policy.mandatoryCommitmentsFirst = false; p.tasks[1]!.deadlineDay = 1;
    expect(solveNativePlanning(p)).toMatchObject({ status: "inconclusive", schedule: [], diagnostics: [{ code: "greedy_allocation_unresolved", taskKeys: ["review"] }] });
    expect(validatePlanningSchedule(p, [{ taskKey: "review", startDay: 0, endDay: 1 }, { taskKey: "build", startDay: 1, endDay: 3 }]).valid).toBe(true);
  });
  it("does not pretend a release gap is a predecessor critical path", () => {
    const p = fixture(); p.tasks[1]!.releaseDay = 4;
    expect(solveNativePlanning(p).criticalPath).toEqual({ taskKeys: ["review"], earliestCompletionDay: 5 });
  });
  it("keeps Pareto unknown or bounded without a fabricated combined priority score", () => {
    const p = fixture(); p.tasks[0]!.dimensions.cost = null;
    expect(solveNativePlanning(p)).toMatchObject({ status: "feasible_best_known", pareto: { status: "unknown_dimensions", taskKeys: [] } });
    p.tasks = Array.from({ length: 33 }, (_, index) => ({ ...p.tasks[0]!, key: `t${index}`, durationDays: 1, demands: [], dimensions: { value: index, cost: index } })); p.dependencies = [];
    expect(solveNativePlanning(p).pareto).toEqual({ status: "candidate_limit", taskKeys: [] });
  });
  it("independently rejects forged coverage, dependency, capacity and date claims", () => {
    const p = fixture(), good = solveNativePlanning(p).schedule;
    expect(validatePlanningSchedule(p, good.slice(1)).violations).toContain("exact_task_coverage");
    const early = structuredClone(good); early[1] = { taskKey: "review", startDay: 0, endDay: 1 };
    expect(validatePlanningSchedule(p, early).violations).toContain("dependency:build:review");
    p.pools[0]!.days[0]!.availableMinutes = 240; expect(validatePlanningSchedule(p, good).violations).toContain("capacity:engineering");
    const bad = structuredClone(good); bad[0]!.startDay = Number.NaN; expect(validatePlanningSchedule(p, bad).valid).toBe(false);
    expect(validatePlanningSchedule(p, [...good, good[0]!]).violations).toContain("exact_task_coverage");
  });
  it("rejects malformed, unbounded, dangling and arbitrary command input", () => {
    const p = fixture();
    for (const invalid of [{ ...p, sql: "select * from issues" }, { ...p, horizon: { start: "2026-02-30", days: 5 } }, { ...p, tasks: Array.from({ length: 201 }, () => p.tasks[0]) }, { ...p, dependencies: [{ before: "private_unknown", after: "review" }] }, { ...p, pools: [{ ...p.pools[0], days: [] }] }, { ...p, dependencies: [...p.dependencies, ...p.dependencies] }]) expect(planningProblemSchema.safeParse(invalid).success).toBe(false);
  });
});
