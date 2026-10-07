// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { NativePlanningResult } from "@paperclipai/shared";
import { ProjectPlanningResult } from "./ProjectPlanningResult";

const fixture = (): NativePlanningResult => ({
  provider: { key: "aw_native_constraints", version: "1" }, status: "feasible_best_known", optimality: "not_proven", inputHash: "1".repeat(64), resultHash: "2".repeat(64),
  schedule: [{ taskKey: "first", startDay: 0, endDay: 1 }, { taskKey: "second", startDay: 1, endDay: 2 }], criticalPath: { taskKeys: ["first", "second"], earliestCompletionDay: 2 },
  pareto: { status: "not_requested", taskKeys: [] }, diagnostics: [], objective: { mandatoryCommitmentsFirst: true, orderBy: [], paretoDimensions: [] },
  limits: { tasks: 200, dependencies: 2000, horizonDays: 366, pools: 32, paretoCandidates: 32, operations: 5_000_000 }, limitations: ["Synthetic presentation only; no original native source or execution authority."],
});
async function view(result: NativePlanningResult, current = true) {
  const node = document.createElement("div"), root = createRoot(node);
  await act(async () => { root.render(<ProjectPlanningResult result={result} horizonStart="2026-10-08" taskLabels={{ first: "Prepare evidence", second: "Human review" }} current={current} />); });
  return { node, close: async () => { await act(async () => root.unmount()); } };
}
describe("Planning presentation preserves conditional mathematical authority", () => {
  it("shows checked UTC intervals and separate dependency bounds without approval or execution actions", async () => {
    const { node, close } = await view(fixture());
    expect(node.textContent).toContain("Checked feasible schedule"); expect(node.textContent).toContain("end is exclusive"); expect(node.textContent).toContain("2026-10-09"); expect(node.textContent).toContain("Global optimality is not established"); expect(node.textContent).toContain("This bound excludes capacity conflicts"); expect(node.querySelectorAll("tbody tr")).toHaveLength(2); expect(node.querySelectorAll("button")).toHaveLength(0); await close();
  });
  it("does not present unknown input or a greedy dead end as a feasible schedule", async () => {
    const result = fixture(); result.status = "inconclusive"; result.schedule = []; result.criticalPath = null; result.diagnostics = [{ code: "unknown_duration", taskKeys: ["first"], poolKeys: [] }, { code: "greedy_allocation_unresolved", taskKeys: ["second"], poolKeys: ["declared_capacity"] }];
    const { node, close } = await view(result); expect(node.textContent).toContain("duration is still unknown"); expect(node.textContent).toContain("Another order may work"); expect(node.textContent).not.toContain("Checked feasible schedule"); expect(node.querySelector("table")).toBeNull(); await close();
  });
  it("retains original numbers while marking changed source as needing fresh reliance", async () => {
    const result = fixture(), original = JSON.stringify(result), { node, close } = await view(result, false);
    expect(node.textContent).toContain("Retained feasible calculation"); expect(node.textContent).toContain("requires a fresh proposal before new reliance"); expect(node.textContent).not.toContain("Checked feasible schedule"); expect(node.textContent).toContain("2026-10-10"); expect(JSON.stringify(result)).toBe(original); await close();
  });
  it("keeps mathematical infeasibility and separate Pareto comparisons distinct", async () => {
    const result = fixture(); result.status = "infeasible"; result.schedule = []; result.diagnostics = [{ code: "existing_capacity_overcommit", taskKeys: [], poolKeys: ["declared_capacity"] }];
    const first = await view(result); expect(first.node.textContent).toContain("Infeasible constraints"); expect(first.node.textContent).toContain("Committed capacity already exceeds"); expect(first.node.querySelector("table")).toBeNull(); await first.close();
    result.status = "feasible_best_known"; result.schedule = fixture().schedule; result.diagnostics = []; result.pareto = { status: "available", taskKeys: ["first"] }; result.objective.paretoDimensions = [{ key: "learning_value", direction: "maximize" }];
    const second = await view(result); expect(second.node.textContent).toContain("does not combine them into a universal priority score"); expect(second.node.textContent).toContain("Prepare evidence"); await second.close();
  });
});
