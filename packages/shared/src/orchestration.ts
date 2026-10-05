import { z } from "zod";
import { READINESS_ACTIONS } from "./readiness.js";
export const orchestrationCompletionSchema = z.object({
  objective: z.string().trim().min(10).max(4000),
  requiredOutputs: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/), jsonSchema: z.record(z.string(), z.unknown()).nullable().default(null) }).strict()).min(1).max(16),
  businessInvariants: z.array(z.string().trim().min(5).max(1000)).min(1).max(16),
  evidenceRequirements: z.array(z.string().trim().min(5).max(1000)).max(16).default([]),
  prohibitedOutcomes: z.array(z.string().trim().min(5).max(1000)).max(16).default([]),
  requiredPostconditions: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("task_state"), issueId: z.string().uuid(), status: z.literal("done") }).strict(),
    z.object({ kind: z.literal("tool_receipt"), toolName: z.string().trim().min(1).max(500), argumentsHash: z.string().regex(/^[a-f0-9]{64}$/), requireApproval: z.boolean().default(true) }).strict(),
  ])).max(16).default([]),
}).strict().refine(value => new Set(value.requiredOutputs.map(output => output.key)).size === value.requiredOutputs.length, "Output keys must be distinct");
export const orchestrationBudgetSchema = z.object({
  maxWorkerCount: z.number().int().min(1).max(32).default(1), maxParallelWorkers: z.number().int().min(1).max(16).default(1), maxDelegationDepth: z.number().int().min(0).max(8).default(0),
  maxRetries: z.number().int().min(0).max(20).default(1), maxWallClockSeconds: z.number().int().min(30).max(86400).default(900),
  maxModelCostMinor: z.number().int().min(0).max(1000000).nullable().default(null), maxToolActions: z.number().int().min(0).max(10000).default(100),
}).strict().refine(value => value.maxParallelWorkers <= value.maxWorkerCount, "Parallel workers cannot exceed the total worker budget");
export const createOrchestrationPlanSchema = z.object({
  issueId: z.string().uuid(), expectedIssueUpdatedAt: z.string().datetime({ offset: true }), riskClass: z.enum(["C0", "C1", "C2", "C3", "C4"]),
  actionClass: z.enum(READINESS_ACTIONS).default("internal_draft"),
  workload: z.enum(["semantic", "decomposable", "long_running", "deterministic"]), workflowId: z.string().uuid().nullable().default(null),
  acceptedPlanRevisionId: z.string().uuid().nullable().default(null), completionContract: orchestrationCompletionSchema, budgets: orchestrationBudgetSchema,
  workers: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/), issueId: z.string().uuid(), dependsOn: z.array(z.string().min(1).max(80)).max(31).default([]), completionContract: orchestrationCompletionSchema.optional() }).strict()).min(1).max(32),
}).strict().superRefine((value, ctx) => {
  const floor = value.actionClass === "internal_draft" ? 0 : ["external_communication", "data_mutation"].includes(value.actionClass) ? 2 : 3;
  if (Number(value.riskClass.slice(1)) < floor) ctx.addIssue({ code: "custom", message: "The declared risk class cannot reduce mandatory action assurance" });
  if (value.actionClass !== "internal_draft" && !value.completionContract.requiredPostconditions.length) ctx.addIssue({ code: "custom", message: "Material actions require an authoritative declared postcondition" });
  if (["external_communication", "financial_commitment", "destructive_action"].includes(value.actionClass) && !value.completionContract.requiredPostconditions.some(condition => condition.kind === "tool_receipt" && condition.requireApproval)) ctx.addIssue({ code: "custom", message: "This action requires an approved exact-arguments side-effect receipt" });
  for (const [issueId, contract] of [[value.issueId, value.completionContract], ...value.workers.flatMap(worker => worker.completionContract ? [[worker.issueId, worker.completionContract] as const] : [])] as const) if (contract.requiredPostconditions.some(condition => condition.kind === "task_state" && condition.issueId === issueId)) ctx.addIssue({ code: "custom", message: "Completion cannot depend on its own terminal state" });
  if (value.workers.length > value.budgets.maxWorkerCount) ctx.addIssue({ code: "custom", message: "Worker budget exceeded" });
  if (new Set(value.workers.map(worker => worker.key)).size !== value.workers.length || new Set(value.workers.map(worker => worker.issueId)).size !== value.workers.length) ctx.addIssue({ code: "custom", message: "Workers require distinct keys and canonical Tasks" });
  const byKey = new Map(value.workers.map(worker => [worker.key, worker]));
  const colors = new Map<string, "visiting" | "visited">();
  function visit(key: string) { if (colors.get(key) === "visiting") throw new Error("Worker joins are cyclic"); if (colors.get(key) === "visited") return; const worker = byKey.get(key); if (!worker) throw new Error("Worker join is outside this plan"); colors.set(key, "visiting"); if (new Set(worker.dependsOn).size !== worker.dependsOn.length) throw new Error("Duplicate join dependencies"); for (const dependency of worker.dependsOn) visit(dependency); colors.set(key, "visited"); }
  try { for (const worker of value.workers) visit(worker.key); } catch (error) { ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid joins" }); }
  if (value.workload === "deterministic" && (!value.workflowId || value.workers.length !== 1)) ctx.addIssue({ code: "custom", message: "Deterministic work requires one existing Workflow binding" });
  if (value.workload !== "deterministic" && value.workflowId) ctx.addIssue({ code: "custom", message: "Workflow binding requires deterministic work" });
  if (value.workers.length > 1 && (value.workload !== "decomposable" || !value.acceptedPlanRevisionId)) ctx.addIssue({ code: "custom", message: "Parallel work requires a canonically accepted decomposition" });
  if (value.workers.length > 1 && value.workers.some(worker => !worker.completionContract)) ctx.addIssue({ code: "custom", message: "Each parallel worker requires its own explicit completion contract" });
  if (value.workers.length === 1 && value.workers[0]?.issueId !== value.issueId) ctx.addIssue({ code: "custom", message: "A single worker must execute the root Task" });
});
export function selectOrchestrationShape(input: Pick<CreateOrchestrationPlan, "workload" | "workers" | "riskClass">) {
  const mode = input.workload === "deterministic" ? "workflow_bound" : input.workers.length > 1 ? "planned_parallel" : input.workload === "long_running" ? "supervised_worker" : "single_worker";
  return { mode, supervisionMode: input.workload === "long_running" ? "deterministic" : "checkpoints", verificationMode: ["C2", "C3", "C4"].includes(input.riskClass) ? "independent_required" : "deterministic", humanOversightMode: ["C3", "C4"].includes(input.riskClass) ? "required" : "policy" } as const;
}
export const orchestrationDecisionSchema = z.object({ expectedVersion: z.number().int().positive(), action: z.enum(["start", "pause", "cancel"]), rationale: z.string().trim().min(20).max(2000) }).strict();
export type OrchestrationCompletion = z.infer<typeof orchestrationCompletionSchema>;
export type OrchestrationBudget = z.infer<typeof orchestrationBudgetSchema>;
export type CreateOrchestrationPlan = z.infer<typeof createOrchestrationPlanSchema>;
export type CreateOrchestrationPlanInput = z.input<typeof createOrchestrationPlanSchema>;
export interface OrchestrationWorkerView { id: string; issueId: string; agentId: string | null; completionContractId: string; workerKey: string; dependsOn: string[]; status: string; attemptCount: number; }
export interface OrchestrationAttemptView { id: string; workerId: string; runId: string | null; workflowRunId: string | null; status: string; attempt: number; }
export interface OrchestrationPlanDetail extends OrchestrationPlanView { workers: OrchestrationWorkerView[]; attempts: OrchestrationAttemptView[]; completionContract: OrchestrationCompletion | null; }
export interface OrchestrationPlanView { id: string; companyId: string; issueId: string; completionContractId: string; mode: string; riskClass: string; actionClass: string; status: string; version: number; budgets: OrchestrationBudget; startedAt: string | null; createdAt: string; }
