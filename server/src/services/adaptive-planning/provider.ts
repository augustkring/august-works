import type { NativePlanningResult, PlanningProblem } from "@paperclipai/shared";
import { solveNativePlanning, validatePlanningSchedule } from "./kernel.js";

export interface PlanningOptimizationProvider {
  readonly key: string;
  capabilities(): { methods: string[]; globalOptimality: boolean; limits: NativePlanningResult["limits"] };
  solve(input: PlanningProblem): Promise<{ result: NativePlanningResult; runtimeMs: number }>;
  validate(input: PlanningProblem, schedule: NativePlanningResult["schedule"]): Promise<{ valid: boolean; violations: string[] }>;
  health(): Promise<{ status: "ready"; version: string; databaseAccess: false; networkAccess: false }>;
}

/** No database, company context, worker shell or arbitrary solver code is admitted. */
export const nativePlanningProvider: PlanningOptimizationProvider = {
  key: "aw_native_constraints",
  capabilities: () => ({ methods: ["constraint_validation", "critical_path", "capacity_overcommit", "explicit_lexicographic_greedy", "small_set_pareto"], globalOptimality: false, limits: { tasks: 200, dependencies: 2000, horizonDays: 366, pools: 32, paretoCandidates: 32, operations: 5_000_000 } }),
  async solve(input) {
    const started = performance.now(), result = solveNativePlanning(input);
    if (result.status === "feasible_best_known" && !validatePlanningSchedule(input, result.schedule).valid) throw new Error("Native planning produced a schedule that failed independent constraint validation");
    return { result, runtimeMs: performance.now() - started };
  },
  async validate(input, schedule) { return validatePlanningSchedule(input, schedule); },
  async health() { return { status: "ready", version: "1", databaseAccess: false, networkAccess: false }; },
};
