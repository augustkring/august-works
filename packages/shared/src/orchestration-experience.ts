import { z } from "zod";

export const orchestrationExperienceStatusSchema = z.enum(["draft", "ready", "running", "paused", "verifying", "completed", "cancelled", "failed"]);
const agent = z.strictObject({ id: z.uuid(), name: z.string().min(1).max(200) });
const row = z.strictObject({
  id: z.uuid(), taskId: z.uuid(), taskTitle: z.string().min(1).max(400), taskTitleTruncated: z.boolean(),
  version: z.number().int().positive(), status: orchestrationExperienceStatusSchema,
  owner: agent.nullable(), helpers: z.array(agent).max(32), assignmentsUnavailable: z.boolean(),
  // This is current Native state, not an asserted verification or output result.
  taskHref: z.string(),
  inspection: z.strictObject({
    mode: z.enum(["single_worker", "planned_parallel", "workflow_bound", "supervised_worker", "supervised_parallel"]),
    budgets: z.strictObject({ maxWorkers: z.number().int().min(1).max(32), maxParallel: z.number().int().min(1).max(16),
      maxDepth: z.number().int().min(0).max(8), maxSeconds: z.number().int().min(30).max(86400),
      maxRetries: z.number().int().min(0).max(20), maxToolActions: z.number().int().min(0).max(10000), modelCostCapConfigured: z.boolean() }),
    workers: z.array(z.strictObject({ number: z.number().int().min(1).max(32), taskId: z.uuid(), agent: agent.nullable(),
      status: z.enum(["waiting", "running", "completed", "failed", "cancelled"]),
      dependsOn: z.array(z.number().int().min(1).max(32)).max(31), attemptsRecorded: z.number().int().nonnegative() })).min(1).max(32),
    // The full original controls retain Stop/Pause, propagation and takeover.
    controlHref: z.literal("/orchestration?view=advanced"),
    safetyHref: z.string(),
  }).nullable(),
}).superRefine((value, ctx) => {
  if (value.taskHref !== `/issues/${value.taskId}`)
    ctx.addIssue({ code: "custom", message: "Use the Original task reference" });
  const workers = value.inspection?.workers;
  if (value.inspection && value.inspection.safetyHref !== `/orchestration/${value.id}/control`)
    ctx.addIssue({ code: "custom", message: "Use the exact Original safety control resource" });
  if (workers && (new Set(workers.map(worker => worker.number)).size !== workers.length ||
    new Set(workers.map(worker => worker.taskId)).size !== workers.length ||
    workers.some(worker => worker.dependsOn.some(dependency => dependency === worker.number || !workers.some(other => other.number === dependency)))))
    ctx.addIssue({ code: "custom", message: "Worker dependencies must belong to the complete Original plan" });
});
export const orchestrationExperienceSchema = z.strictObject({ companyId: z.uuid(), observedAt: z.iso.datetime(),
  coverage: z.literal("bounded"), hasMore: z.boolean(), modelCalled: z.literal(false),
  canInspect: z.boolean(), rows: z.array(row).max(20),
}).superRefine((value, ctx) => {
  if (!value.canInspect && value.rows.some(item => item.inspection !== null))
    ctx.addIssue({ code: "custom", message: "Worker topology requires current Native administrator admission" });
});
export type OrchestrationExperience = z.infer<typeof orchestrationExperienceSchema>;
