import { z } from "zod";

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const parsed = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }, "A valid calendar date is required");
const instant = z.string().datetime({ offset: true });
export const roadmapPolicySchema = z.object({ allowAgentForecast: z.boolean().default(true), allowLowRiskAgentScheduleUpdates: z.boolean().default(false), scheduleToleranceDays: z.number().int().min(0).max(14).default(0), fieldOwnership: z.object({ title: z.enum(["internal", "external_readonly", "external_authoritative"]).default("internal"), status: z.enum(["internal", "external_readonly", "external_authoritative"]).default("internal"), assignee: z.enum(["internal", "external_readonly", "external_authoritative"]).default("internal"), plannedDates: z.enum(["internal", "external_readonly", "external_authoritative"]).default("internal"), forecast: z.enum(["internal", "external_readonly", "external_authoritative"]).default("internal") }).strict().default({ title: "internal", status: "internal", assignee: "internal", plannedDates: "internal", forecast: "internal" }), externalSourceRef: z.string().trim().min(1).max(500).nullable().default(null) }).strict().superRefine((v, ctx) => { if (Object.values(v.fieldOwnership).some((owner) => owner !== "internal") && !v.externalSourceRef) ctx.addIssue({ code: "custom", message: "External field ownership requires a source reference" }); });
export type RoadmapPolicy = z.infer<typeof roadmapPolicySchema>;
export const taskPlanPatchSchema = z.object({ plannedStartAt: instant.nullable().optional(), plannedEndAt: instant.nullable().optional(), milestoneId: z.string().uuid().nullable().optional(), estimatedEffortMinutes: z.number().int().min(1).max(525600).nullable().optional() }).strict().refine((v) => !v.plannedStartAt || !v.plannedEndAt || Date.parse(v.plannedEndAt) >= Date.parse(v.plannedStartAt), "Planned end must not precede planned start");
export const taskForecastPatchSchema = z.object({ expectedUpdatedAt: instant, forecastStartAt: instant.nullable(), forecastEndAt: instant.nullable(), forecastConfidence: z.number().min(0).max(1).nullable(), forecastReason: z.string().trim().min(10).max(4000) }).strict().refine((v) => !v.forecastStartAt || !v.forecastEndAt || Date.parse(v.forecastEndAt) >= Date.parse(v.forecastStartAt), "Forecast end must not precede forecast start");
export const roadmapChangeSchema = z.object({ issueId: z.string().uuid(), expectedUpdatedAt: instant, patch: taskPlanPatchSchema }).strict();
export const roadmapProposalSchema = z.object({ expectedProjectUpdatedAt: instant, changes: z.array(roadmapChangeSchema).min(1).max(200), reason: z.string().trim().min(20).max(4000), evidence: z.array(z.string().trim().min(1).max(1000)).max(32).default([]) }).strict().refine((v) => new Set(v.changes.map((c) => c.issueId)).size === v.changes.length, "A task may occur only once per proposal");
export const createMilestoneSchema = z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(4000).default(""), goalId: z.string().uuid().nullable().default(null), targetDate: calendarDate.nullable().default(null), plannedStartAt: instant.nullable().default(null), plannedEndAt: instant.nullable().default(null), ownerUserId: z.string().max(200).nullable().default(null), ownerAgentId: z.string().uuid().nullable().default(null), sortOrder: z.number().int().min(0).max(100000).default(0) }).strict().refine((v) => !v.plannedStartAt || !v.plannedEndAt || Date.parse(v.plannedEndAt) >= Date.parse(v.plannedStartAt), "Milestone end must not precede its start");
export const MILESTONE_STATUSES = ["planned", "in_progress", "at_risk", "completed", "cancelled"] as const;
export interface RoadmapTask { id: string; title: string; identifier: string | null; status: string; priority?: string; updatedAt: string; assigneeAgentId: string | null; assigneeUserId: string | null; milestoneId: string | null; plannedStartAt: string | null; plannedEndAt: string | null; forecastStartAt: string | null; forecastEndAt: string | null; forecastConfidence: number | null; forecastReason: string | null; startedAt: string | null; completedAt: string | null; estimatedEffortMinutes: number | null; }
export interface ProjectMilestone { id: string; name: string; description: string; status: typeof MILESTONE_STATUSES[number]; targetDate: string | null; plannedStartAt: string | null; plannedEndAt: string | null; completedAt: string | null; updatedAt: string; }
export interface ProjectRoadmap { companyId: string; projectId: string; projectName: string; projectUpdatedAt: string; policy: RoadmapPolicy; tasks: RoadmapTask[]; milestones: ProjectMilestone[]; dependencies: Array<{ id: string; issueId: string; relatedIssueId: string }>; baselines: Array<{ id: string; name: string; createdAt: string; snapshot: { tasks: RoadmapTask[]; milestones: ProjectMilestone[]; dependencies: Array<{ issueId: string; relatedIssueId: string }> } }>; proposals: Array<{ id: string; reason: string; risk: string; status: string; patch: z.infer<typeof roadmapProposalSchema>; createdAt: string }>; health: { status: "on_track" | "at_risk" | "blocked" | "unknown"; facts: string[]; observedAt: string; metrics?: ProjectHealthMetrics }; }

export type RoadmapProposalInput = z.infer<typeof roadmapProposalSchema>;

export interface ProjectHealthMetrics {
  openBlockerTaskIds: string[];
  overdueTaskIds: string[];
  forecastSlipTaskIds: string[];
  unassignedCriticalTaskIds: string[];
  waitingApprovalTaskIds: string[] | null;
  stalledActiveTaskIds: string[];
  stallHours: number;
  milestoneVariance: Array<{ milestoneId: string; days: number | null; basis: "actual" | "forecast" | "unknown" }>;
  budgetUtilization: Array<{ policyId: string; windowKind: string; utilizationPercent: number; status: "ok" | "warning" | "hard_stop" }> | null;
}

export type RoadmapProposalRequest = z.input<typeof roadmapProposalSchema>;
export type CreateMilestoneInput = z.input<typeof createMilestoneSchema>;

export const updateMilestoneSchema = z.object({ expectedUpdatedAt: instant, name: z.string().trim().min(1).max(200).optional(), description: z.string().max(4000).optional(), status: z.enum(MILESTONE_STATUSES).optional(), targetDate: calendarDate.nullable().optional(), plannedStartAt: instant.nullable().optional(), plannedEndAt: instant.nullable().optional() }).strict().refine((v) => !v.plannedStartAt || !v.plannedEndAt || Date.parse(v.plannedEndAt) >= Date.parse(v.plannedStartAt), "Milestone end must not precede start");
