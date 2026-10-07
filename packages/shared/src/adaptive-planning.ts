import { z } from "zod";

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
