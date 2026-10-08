import { z } from "zod";
import { decisionEvidenceReferenceSchema, type CapturedDecisionEvidence } from "./decision-intelligence.js";
import { learningCycleSchema } from "./learning.js";
import type { RoadmapPolicy } from "./project-control.js";

// This is a sanitized mathematical contract. Authorization, source capture and
// human approval belong to the native owners, never to the optimization provider.
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "A valid UTC calendar date is required");
const finite = z.number().finite().min(-1e12).max(1e12);
export const planningDimensionSchema = z.object({
  key,
  direction: z.enum(["maximize", "minimize"]),
}).strict();
export const planningProblemSchema = z.object({
  horizon: z.object({ start: day, days: z.number().int().min(1).max(366) }).strict(),
  tasks: z.array(z.object({
    key,
    durationDays: z.number().int().min(1).max(366).nullable(),
    releaseDay: z.number().int().min(0).max(365).default(0),
    deadlineDay: z.number().int().min(1).max(366).nullable().default(null),
    demands: z.array(z.object({ poolKey: key, minutesPerDay: z.number().int().min(1).max(1440) }).strict()).max(8),
    // Supplied explicitly by the company; never inferred from work telemetry.
    mandatoryCommitment: z.boolean(),
    dimensions: z.record(key, finite.nullable()).refine((values) => Object.keys(values).length <= 24, "At most 24 separate dimensions are admitted"),
  }).strict()).min(1).max(200),
  dependencies: z.array(z.object({ before: key, after: key }).strict()).max(2000),
  pools: z.array(z.object({
    key,
    days: z.array(z.object({
      availableMinutes: z.number().int().min(0).max(1_000_000).nullable(),
      committedMinutes: z.number().int().min(0).max(1_000_000).nullable(),
    }).strict()).min(1).max(366),
  }).strict()).max(32),
  policy: z.object({
    mandatoryCommitmentsFirst: z.boolean(),
    // Array order is an explicit lexicographic company policy, not a universal score.
    orderBy: z.array(planningDimensionSchema).max(12),
    paretoDimensions: z.array(planningDimensionSchema).max(12),
  }).strict(),
}).strict().superRefine((problem, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: "custom", message });
  const taskKeys = new Set(problem.tasks.map((task) => task.key));
  const poolKeys = new Set(problem.pools.map((pool) => pool.key));
  if (taskKeys.size !== problem.tasks.length || poolKeys.size !== problem.pools.length) add("Task and pool keys must be unique");
  if (new Set(problem.dependencies.map((edge) => `${edge.before}:${edge.after}`)).size !== problem.dependencies.length) add("Dependencies must be unique");
  for (const edge of problem.dependencies) if (edge.before === edge.after || !taskKeys.has(edge.before) || !taskKeys.has(edge.after)) add("Dependencies must reference distinct supplied tasks");
  for (const pool of problem.pools) if (pool.days.length !== problem.horizon.days) add("Every capacity pool must cover the entire horizon");
  for (const task of problem.tasks) {
    if (task.releaseDay >= problem.horizon.days || task.deadlineDay !== null && task.deadlineDay > problem.horizon.days) add("Task dates must fall within the horizon");
    if (new Set(task.demands.map((demand) => demand.poolKey)).size !== task.demands.length || task.demands.some((demand) => !poolKeys.has(demand.poolKey))) add("Each task demand must reference a distinct supplied capacity pool");
  }
  for (const dimensions of [problem.policy.orderBy, problem.policy.paretoDimensions]) if (new Set(dimensions.map((dimension) => dimension.key)).size !== dimensions.length) add("Policy dimensions must be unique");
});
export type PlanningProblem = z.infer<typeof planningProblemSchema>;
export type PlanningProblemInput = z.input<typeof planningProblemSchema>;
export const projectPlanningProfileSchema = z.object({
  purpose: z.literal("management_intelligence"),
  sensitivity: z.enum(["internal", "confidential"]),
  retentionDays: z.number().int().min(1).max(365),
  governanceObligationRefs: z.array(z.string().uuid()).min(1).max(16),
  horizon: planningProblemSchema.shape.horizon,
  pools: planningProblemSchema.shape.pools,
  policy: planningProblemSchema.shape.policy,
  tasks: z.array(planningProblemSchema.shape.tasks.element.extend({
    key: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    rationale: z.string().trim().min(10).max(2000),
  }).strict()).min(1).max(200),
  evidence: z.array(z.object({ key, source: decisionEvidenceReferenceSchema, rationale: z.string().trim().min(10).max(2000) }).strict()).max(20),
}).strict().superRefine((profile, ctx) => {
  for (const values of [profile.governanceObligationRefs, profile.tasks.map((task) => task.key), profile.evidence.map((item) => item.key)]) if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", message: "Source and task identities must be unique" });
});
export const proposeProjectPlanningSchema = z.object({
  profile: projectPlanningProfileSchema,
  expectedSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(20).max(4000),
}).strict();
export type ProjectPlanningProfile = z.infer<typeof projectPlanningProfileSchema>;
export type ProposeProjectPlanning = z.infer<typeof proposeProjectPlanningSchema>;
export interface ProjectPlanningSourceSnapshot {
  projectId: string;
  projectUpdatedAt: string;
  roadmapPolicy: RoadmapPolicy;
  tasks: Array<{ id: string; updatedAt: string; status: string; plannedStartAt: string | null; plannedEndAt: string | null; estimatedEffortMinutes: number | null; milestoneId: string | null; assigneeAgentId: string | null; assigneeUserId: string | null }>;
  dependencies: Array<{ before: string; after: string }>;
  satisfiedDependencies: Array<{ id: string; projectId: string | null; updatedAt: string; status: "done" }>;
}
export interface ProjectPlanningContext {
  profile: ProjectPlanningProfile;
  sourceSnapshot: ProjectPlanningSourceSnapshot;
  evidence: CapturedDecisionEvidence[];
  snapshotHash: string;
  result: NativePlanningResult;
  runtimeMs: number;
  capturedAt: string;
  expiresAt: string;
  authority: "human_roadmap_review_required";
}
export interface NativePlanningResult {
  provider: { key: "aw_native_constraints"; version: "1" };
  status: "feasible_best_known" | "infeasible" | "inconclusive";
  optimality: "not_proven";
  inputHash: string;
  resultHash: string;
  schedule: Array<{ taskKey: string; startDay: number; endDay: number }>;
  criticalPath: { taskKeys: string[]; earliestCompletionDay: number } | null;
  pareto: { status: "available" | "not_requested" | "unknown_dimensions" | "candidate_limit"; taskKeys: string[] };
  diagnostics: Array<{ code: string; taskKeys: string[]; poolKeys: string[] }>;
  objective: PlanningProblem["policy"];
  limits: { tasks: 200; dependencies: 2000; horizonDays: 366; pools: 32; paretoCandidates: 32; operations: 5_000_000 };
  limitations: string[];
}

/** Descriptive native completion facts are supplemental signals, not verified
 * business impact, causal claims or authority to promote a Learning candidate. */
export const recordPlanningOutcomeSchema=z.object({rationale:z.string().trim().min(10).max(4000)}).strict();
export const startPlanningOutcomeLearningSchema=learningCycleSchema.omit({scope:true,analyticalSources:true}).extend({manifestId:z.string().uuid()}).strict();
export type StartPlanningOutcomeLearning=z.input<typeof startPlanningOutcomeLearningSchema>;
export const planningOutcomeSchema=z.object({
  companyId:z.string().uuid(),projectId:z.string().uuid(),proposalId:z.string().uuid(),contextHash:z.string().regex(/^[a-f0-9]{64}$/),
  recordedBy:z.string().min(1),recordedAt:z.string().datetime({offset:true}),expiresAt:z.string().datetime({offset:true}),rationale:z.string().min(10).max(4000),
  tasks:z.array(z.object({issueId:z.string().uuid(),updatedAt:z.string().datetime({offset:true}),completedAt:z.string().datetime({offset:true}),plannedEndAt:z.string().datetime({offset:true}),completionDeltaDays:z.number().finite()}).strict()).min(1).max(200),
  authority:z.literal("supplemental_descriptive_signal"),causalClaimRef:z.null(),
}).strict();
export type PlanningOutcome=z.infer<typeof planningOutcomeSchema>;

/** One governed mathematical problem across explicitly selected same-company
 * projects. Each project contributes its complete current active Task population. */
export const crossProjectPlanningProfileSchema = projectPlanningProfileSchema.safeExtend({
  projects: z.array(z.object({ id: z.string().uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict()).min(2).max(20),
}).strict().superRefine((profile, ctx) => {
  for (const values of [profile.projects.map(project => project.id), profile.governanceObligationRefs, profile.tasks.map(task => task.key), profile.evidence.map(item => item.key)])
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", message: "Cross-project native identities must be unique" });
});
export const proposeCrossProjectPlanningSchema = z.object({ profile: crossProjectPlanningProfileSchema, expectedSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(20).max(4000) }).strict();
export const reviewCrossProjectPlanningSchema = z.object({ expectedRevision: z.number().int().positive(), action: z.enum(["begin_review", "accept", "reject", "cancel"]), rationale: z.string().trim().min(10).max(4000) }).strict();
export type CrossProjectPlanningProfile = z.infer<typeof crossProjectPlanningProfileSchema>;
export interface CrossProjectPlanningContext {
  profile: CrossProjectPlanningProfile;
  sourceSnapshots: ProjectPlanningSourceSnapshot[];
  evidence: CapturedDecisionEvidence[];
  snapshotHash: string;
  result: NativePlanningResult;
  capturedAt: string;
  expiresAt: string;
  authority: "human_cross_project_roadmap_review_required";
}

/** Explicit Human inputs for prioritizing the selected native projects. Task
 * and initiative dimensions remain separate; no combined performance score. */
export const portfolioPlanningProfileSchema = crossProjectPlanningProfileSchema.safeExtend({
  initiatives: z.array(z.object({
    projectId: z.string().uuid(),
    mandatoryCommitment: z.boolean(),
    protectedCommitment: z.boolean(),
    preference: z.enum(["eligible", "stop", "investigate"]),
    dimensions: planningProblemSchema.shape.tasks.element.shape.dimensions,
    estimatedBilledCostCents: z.number().int().min(0).max(1_000_000_000).nullable(),
    rationale: z.string().trim().min(10).max(2000),
  }).strict()).min(2).max(20),
  initiativePolicy: z.object({
    mandatoryCommitmentsFirst: z.boolean(),
    orderBy: z.array(planningDimensionSchema).max(12),
    minimumDimensions: z.array(z.object({ key, minimum: finite }).strict()).max(12),
    requireActiveGoal: z.boolean(),
    maxSelectedActiveProjects: z.number().int().min(1).max(20),
  }).strict(),
}).strict().superRefine((profile, ctx) => {
  const ids = new Set(profile.initiatives.map(item => item.projectId));
  if (ids.size !== profile.initiatives.length || ids.size !== profile.projects.length || profile.projects.some(project => !ids.has(project.id))) ctx.addIssue({ code: "custom", message: "Every selected native project requires exactly one explicit initiative input" });
  for (const dimensions of [profile.initiativePolicy.orderBy, profile.initiativePolicy.minimumDimensions]) if (new Set(dimensions.map(dimension => dimension.key)).size !== dimensions.length) ctx.addIssue({ code: "custom", message: "Initiative policy dimensions must be unique" });
});
export type PortfolioPlanningProfile = z.infer<typeof portfolioPlanningProfileSchema>;

/** Sanitized current facts admitted by native owners, never client assertions. */
export interface PortfolioPlanningSources {
  projects: Array<{ id: string; status: string; paused: boolean; taskKeys: string[]; activeGoalIds: string[] }>;
  budgets: Array<{ policyId: string; projectId: string | null; remainingCents: number | null; windowKind: "calendar_month_utc" | "lifetime"; windowEnd: string }>;
}
export interface NativePortfolioPlanningResult {
  provider: { key: "aw_native_constraints"; version: "1" };
  optimality: "not_proven";
  candidates: Array<{ projectId: string; disposition: "start" | "continue" | "pause" | "stop" | "investigate"; reasons: string[] }>;
  selectedProjectIds: string[];
  schedule: NativePlanningResult | null;
  resultHash: string;
  authority: "human_initiative_review_required";
  limitations: string[];
}
export interface PortfolioPlanningPreview {
  snapshotHash: string;
  result: NativePortfolioPlanningResult;
  currentSources: PortfolioPlanningSources;
  capturedAt: string;
  expiresAt: string;
  authority: "human_initiative_review_required";
}
