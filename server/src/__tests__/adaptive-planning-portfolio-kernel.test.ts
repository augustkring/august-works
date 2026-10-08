import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { portfolioPlanningProfileSchema, type PortfolioPlanningSources } from "@paperclipai/shared";
import { solveNativePortfolioPlanning } from "../services/adaptive-planning/portfolio-kernel.js";

function fixture() {
  const ids = [randomUUID(), randomUUID()], tasks = [randomUUID(), randomUUID()];
  const profile = portfolioPlanningProfileSchema.parse({
    purpose: "management_intelligence", sensitivity: "internal", retentionDays: 1, governanceObligationRefs: [randomUUID()],
    projects: ids.map(id => ({ id, expectedUpdatedAt: "2026-10-08T00:00:00Z" })),
    horizon: { start: "2026-10-09", days: 3 }, pools: [{ key: "capacity", days: Array.from({ length: 3 }, () => ({ availableMinutes: 480, committedMinutes: 0 })) }],
    policy: { mandatoryCommitmentsFirst: true, orderBy: [], paretoDimensions: [] },
    tasks: tasks.map(key => ({ key, expectedUpdatedAt: "2026-10-08T00:00:00Z", rationale: "Explicit software assumptions", durationDays: 1, demands: [{ poolKey: "capacity", minutesPerDay: 480 }], mandatoryCommitment: false, dimensions: {} })), evidence: [],
    initiatives: ids.map((projectId, index) => ({ projectId, mandatoryCommitment: false, protectedCommitment: false, preference: "eligible", dimensions: { alignment: 10 - index, risk: index + 1 }, estimatedBilledCostCents: 40, rationale: "Explicit software assumptions" })),
    initiativePolicy: { mandatoryCommitmentsFirst: true, orderBy: [{ key: "alignment", direction: "maximize" }], minimumDimensions: [{ key: "alignment", minimum: 5 }], requireActiveGoal: true, maxSelectedActiveProjects: 2 },
  });
  const sources: PortfolioPlanningSources = { projects: ids.map((id, index) => ({ id, status: index ? "in_progress" : "backlog", paused: false, taskKeys: [tasks[index]], activeGoalIds: [randomUUID()] })), budgets: [] };
  return { profile, sources, ids, tasks };
}
describe("Bounded advisory initiative prioritization", () => {
  it("keeps separate Human dimensions and selects a feasible native schedule without claiming optimality", async () => {
    const f = fixture(), original = structuredClone(f), result = await solveNativePortfolioPlanning(f.profile, f.sources, []);
    expect(result.candidates).toEqual(expect.arrayContaining([{ projectId: f.ids[0], disposition: "start", reasons: ["feasible_under_declared_selected_scope_constraints"] }, { projectId: f.ids[1], disposition: "continue", reasons: ["feasible_under_declared_selected_scope_constraints"] }]));
    expect(result).toMatchObject({ optimality: "not_proven", authority: "human_initiative_review_required", schedule: { status: "feasible_best_known" } });
    expect(result.schedule!.schedule).toHaveLength(2); expect(f).toEqual(original); expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("distinguishes known low alignment and insufficient capacity from unknown duration or costs", async () => {
    const f = fixture(); f.profile.initiatives[1].dimensions.alignment = 1;
    expect((await solveNativePortfolioPlanning(f.profile, f.sources, [])).candidates).toContainEqual({ projectId: f.ids[1], disposition: "pause", reasons: ["below_explicit_company_dimension_minimum"] });
    f.profile.initiatives[1].dimensions.alignment = 9; f.profile.tasks[1].durationDays = 4;
    expect((await solveNativePortfolioPlanning(f.profile, f.sources, [])).candidates.find(item => item.projectId === f.ids[1])).toMatchObject({ disposition: "pause", reasons: expect.arrayContaining(["native_capacity_or_deadline_infeasible"]) });
    f.profile.tasks[1].durationDays = null;
    expect((await solveNativePortfolioPlanning(f.profile, f.sources, [])).candidates.find(item => item.projectId === f.ids[1])).toMatchObject({ disposition: "investigate", reasons: expect.arrayContaining(["native_schedule_inconclusive"]) });
    f.profile.initiatives[1].estimatedBilledCostCents = null;
    expect((await solveNativePortfolioPlanning(f.profile, f.sources, [])).candidates.find(item => item.projectId === f.ids[1])).toMatchObject({ disposition: "investigate", reasons: ["unknown_declared_dimension_or_cost"] });
  });
  it("enforces cumulative company and individual project bounds and abstains on unknown periods", async () => {
    const f = fixture(); f.sources.budgets = [{ policyId: randomUUID(), projectId: null, remainingCents: 60, windowKind: "lifetime", windowEnd: "9999-01-01T00:00:00Z" }];
    expect((await solveNativePortfolioPlanning(f.profile, f.sources, [])).selectedProjectIds).toEqual([f.ids[0]]);
    f.sources.budgets[0].projectId = f.ids[0]; f.sources.budgets[0].remainingCents = 0;
    expect((await solveNativePortfolioPlanning(f.profile, f.sources, [])).selectedProjectIds).toEqual([f.ids[1]]);
    f.sources.budgets[0].projectId = null; f.sources.budgets[0].remainingCents = null;
    expect((await solveNativePortfolioPlanning(f.profile, f.sources, [])).candidates.every(item => item.disposition === "investigate")).toBe(true);
    f.sources.budgets[0].remainingCents = 100; f.sources.budgets[0].windowKind = "calendar_month_utc"; f.sources.budgets[0].windowEnd = "2026-10-11T00:00:00Z";
    expect((await solveNativePortfolioPlanning(f.profile, f.sources, [])).selectedProjectIds).toEqual([]);
  });
  it("protects mandatory commitments, never resumes paused scopes and admits stopping only as an explicit Human preference", async () => {
    const f = fixture(); f.profile.initiatives[0].preference = "stop"; f.profile.initiatives[1].preference = "stop"; f.profile.initiatives[1].protectedCommitment = true;
    expect((await solveNativePortfolioPlanning(f.profile, f.sources, [])).candidates).toEqual(expect.arrayContaining([{ projectId: f.ids[0], disposition: "stop", reasons: ["explicit_human_stop_preference"] }, { projectId: f.ids[1], disposition: "investigate", reasons: ["protected_or_mandatory_commitment"] }]));
    f.profile.initiatives[0].preference = "eligible"; f.sources.projects[0].paused = true;
    expect((await solveNativePortfolioPlanning(f.profile, f.sources, [])).selectedProjectIds).toEqual([]);
  });
  it("retains native predecessor coverage when a prior initiative is ineligible", async () => {
    const f = fixture(); f.profile.initiatives[0].dimensions.alignment = 0;
    const result = await solveNativePortfolioPlanning(f.profile, f.sources, [{ before: f.tasks[0], after: f.tasks[1] }]);
    expect(result.selectedProjectIds).toEqual([]); expect(result.candidates.find(item => item.projectId === f.ids[1])).toMatchObject({ disposition: "investigate", reasons: ["unselected_native_predecessor"] });
    await expect(solveNativePortfolioPlanning(f.profile, f.sources, [{ before: "omitted", after: f.tasks[1] }])).rejects.toThrow();
  });
  it("rejects duplicate initiative facts and sanitized populations with omitted or duplicated Tasks", async () => {
    const f = fixture(); expect(portfolioPlanningProfileSchema.safeParse({ ...f.profile, initiatives: [f.profile.initiatives[0], f.profile.initiatives[0]] }).success).toBe(false);
    f.sources.projects[1].taskKeys = [];
    await expect(solveNativePortfolioPlanning(f.profile, f.sources, [])).rejects.toThrow("Exact native portfolio population");
  });
});
