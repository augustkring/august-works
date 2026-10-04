import { expect, it } from "vitest";
import type { ProjectRoadmap, RoadmapTask } from "@paperclipai/shared";
import { roadmapHealth } from "../services/project-health.js";

const now = new Date("2026-10-04T12:00:00.000Z");
const task = (id: string, patch: Partial<RoadmapTask> = {}): RoadmapTask => ({ id, title: id, identifier: null, status: "todo", priority: "medium", updatedAt: now.toISOString(), assigneeAgentId: null, assigneeUserId: null, milestoneId: null, plannedStartAt: null, plannedEndAt: null, forecastStartAt: null, forecastEndAt: null, forecastConfidence: null, forecastReason: null, startedAt: null, completedAt: null, estimatedEffortMinutes: null, ...patch });
const milestone: ProjectRoadmap["milestones"][number] = { id: "milestone", name: "Release", description: "", status: "planned", targetDate: null, plannedStartAt: null, plannedEndAt: "2026-10-05T12:00:00.000Z", completedAt: null, updatedAt: now.toISOString() };

it("derives blockers, overdue, critical owners, stalled work and forecasts from visible tasks", () => {
  const tasks = [task("blocker", { priority: "high" }), task("late", { status: "in_progress", updatedAt: "2026-10-01T12:00:00.000Z", plannedEndAt: "2026-10-03T12:00:00.000Z", forecastEndAt: "2026-10-05T12:00:00.000Z" }), task("done", { status: "done", priority: "critical" })];
  const health = roadmapHealth(tasks, now, { dependencies: [{ id: "edge", issueId: "blocker", relatedIssueId: "late" }, { id: "foreign", issueId: "secret", relatedIssueId: "late" }], waitingApprovalTaskIds: ["late", "secret", "late", "done"] });
  expect(health.status).toBe("blocked");
  expect(health.metrics).toMatchObject({ openBlockerTaskIds: ["blocker"], overdueTaskIds: ["late"], forecastSlipTaskIds: ["late"], unassignedCriticalTaskIds: ["blocker"], stalledActiveTaskIds: ["late"], waitingApprovalTaskIds: ["late"] });
  expect(JSON.stringify(health)).not.toContain("secret");
});

it("keeps incomplete milestone forecasts and unobserved budget or approvals unknown", () => {
  const health = roadmapHealth([task("forecast", { milestoneId: milestone.id, forecastEndAt: "2026-10-08T12:00:00.000Z" }), task("missing", { milestoneId: milestone.id })], now, { milestones: [milestone] });
  expect(health.metrics).toMatchObject({ budgetUtilization: null, waitingApprovalTaskIds: null, milestoneVariance: [{ milestoneId: "milestone", days: null, basis: "unknown" }] });
});

it("uses a complete forecast and recorded completion for milestone variance", () => {
  const tasks = [task("first", { milestoneId: milestone.id, forecastEndAt: "2026-10-06T12:00:00.000Z" }), task("second", { milestoneId: milestone.id, forecastEndAt: "2026-10-08T12:00:00.000Z" })];
  expect(roadmapHealth(tasks, now, { milestones: [milestone] }).metrics?.milestoneVariance[0]).toEqual({ milestoneId: "milestone", days: 3, basis: "forecast" });
  expect(roadmapHealth(tasks, now, { milestones: [{ ...milestone, status: "completed", completedAt: "2026-10-07T12:00:00.000Z" }] }).metrics?.milestoneVariance[0]).toEqual({ milestoneId: "milestone", days: 2, basis: "actual" });
});
