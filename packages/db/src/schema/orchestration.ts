import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, jsonb, timestamp, foreignKey, unique, uniqueIndex, check, index } from "drizzle-orm/pg-core";
import type { ExecutionPrincipal, SupervisionPolicy, OrchestrationBudget, ModelReservationQuote } from "@paperclipai/shared";
import { documentRevisions } from "./document_revisions.js";
import { workflowRevisions } from "./workflows.js";
import { toolInvocations } from "./tool_access.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";
import { completionContracts } from "./completion_contracts.js";
import { agentExecutionManifests } from "./execution_manifests.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { workflowRuns, workflows } from "./workflows.js";
const times = () => ({ createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow() });
export const orchestrationPlans = pgTable("orchestration_plans", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), issueId: uuid("issue_id").notNull(), completionContractId: uuid("completion_contract_id").notNull(),
  mode: text("mode").notNull(), actionClass: text("action_class").notNull(), riskClass: text("risk_class").notNull(), supervisionMode: text("supervision_mode").notNull(), verificationMode: text("verification_mode").notNull(), humanOversightMode: text("human_oversight_mode").notNull(),
  workflowId: uuid("workflow_id"), workflowRevisionId: uuid("workflow_revision_id"), acceptedPlanRevisionId: uuid("accepted_plan_revision_id"), budgets: jsonb("budgets").$type<OrchestrationBudget>().notNull(),
  supervisionPolicy: jsonb("supervision_policy").$type<SupervisionPolicy>().notNull().default(sql`'{"repeatedFailureThreshold":3,"noProgressSeconds":null,"minCheckIntervalSeconds":30,"maxSupervisorChecks":100,"maxVerifierCalls":1,"maxVerificationDepth":1}'::jsonb`), executionPrincipal: jsonb("execution_principal").$type<ExecutionPrincipal | null>(), supervisorChecksUsed: integer("supervisor_checks_used").notNull().default(0), verifierCallsUsed: integer("verifier_calls_used").notNull().default(0),
  status: text("status").notNull().default("draft"), version: integer("version").notNull().default(1), retriesUsed: integer("retries_used").notNull().default(0), toolActionsUsed: integer("tool_actions_used").notNull().default(0), modelCostReserved: integer("model_cost_reserved").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }), createdBy: text("created_by").notNull(), erasedAt: timestamp("erased_at", { withTimezone: true }), ...times(),
}, t => ({ tenantUq: unique("orchestration_plan_tenant_uq").on(t.companyId, t.id), taskFk: foreignKey({ columns: [t.companyId, t.issueId], foreignColumns: [issues.companyId, issues.id] }), contractFk: foreignKey({ columns: [t.companyId, t.issueId, t.completionContractId], foreignColumns: [completionContracts.companyId, completionContracts.issueId, completionContracts.id] }), workflowRevisionFk: foreignKey({ columns: [t.companyId, t.workflowId, t.workflowRevisionId], foreignColumns: [workflowRevisions.companyId, workflowRevisions.workflowId, workflowRevisions.id] }), acceptedPlanFk: foreignKey({ columns: [t.companyId, t.acceptedPlanRevisionId], foreignColumns: [documentRevisions.companyId, documentRevisions.id] }), workflowFk: foreignKey({ columns: [t.companyId, t.workflowId], foreignColumns: [workflows.companyId, workflows.id] }), liveTaskUq: uniqueIndex("orchestration_plan_live_task_uq").on(t.companyId, t.issueId).where(sql`${t.status} not in ('completed','cancelled','failed')`),
  statusCheck: check("orchestration_plan_status_check", sql`${t.status} in ('draft','ready','running','paused','verifying','completed','cancelled','failed')`), modeCheck: check("orchestration_plan_mode_check", sql`${t.mode} in ('single_worker','planned_parallel','workflow_bound','supervised_worker','supervised_parallel')`), riskCheck: check("orchestration_plan_risk_check", sql`${t.riskClass} in ('C0','C1','C2','C3','C4')`), versionCheck: check("orchestration_plan_counter_check", sql`${t.version}>0 and ${t.retriesUsed}>=0 and ${t.toolActionsUsed}>=0 and ${t.modelCostReserved}>=0`), actionCheck: check("orchestration_plan_action_check", sql`${t.actionClass} in ('internal_draft','external_communication','data_mutation','financial_commitment','person_decision','destructive_action','restricted_processing')`),
  budgetCheck: check("orchestration_plan_budget_check", sql`coalesce(jsonb_typeof(${t.budgets})='object'
    and (${t.budgets}->>'maxWorkerCount')::int between 1 and 32
    and (${t.budgets}->>'maxParallelWorkers')::int between 1 and least(16,(${t.budgets}->>'maxWorkerCount')::int)
    and (${t.budgets}->>'maxDelegationDepth')::int between 0 and 8
    and (${t.budgets}->>'maxRetries')::int between 0 and 20
    and (${t.budgets}->>'maxWallClockSeconds')::int between 30 and 86400
    and (${t.budgets}->>'maxToolActions')::int between 0 and 10000
    and (${t.budgets}->'maxModelCostMinor'='null'::jsonb or (${t.budgets}->>'maxModelCostMinor')::int between 0 and 1000000)
    and ${t.budgets} ?& array['maxWorkerCount','maxParallelWorkers','maxDelegationDepth','maxRetries','maxWallClockSeconds','maxToolActions','maxModelCostMinor'],false)`),
  supervisionCheck: check("orchestration_supervision_budget_check", sql`coalesce(
    (${t.supervisionPolicy}->>'maxSupervisorChecks')::int between 1 and 10000
    and (${t.supervisionPolicy}->>'maxVerifierCalls')::int between 0 and 10
    and (${t.supervisionPolicy}->>'maxVerificationDepth')::int between 0 and 3
    and (${t.supervisionPolicy}->>'repeatedFailureThreshold')::int between 2 and 20
    and (${t.supervisionPolicy}->>'minCheckIntervalSeconds')::int between 5 and 3600
    and (${t.supervisionPolicy}->'noProgressSeconds'='null'::jsonb or (${t.supervisionPolicy}->>'noProgressSeconds')::int between 30 and 86400)
    and ${t.supervisorChecksUsed} between 0 and (${t.supervisionPolicy}->>'maxSupervisorChecks')::int
    and ${t.verifierCallsUsed} between 0 and (${t.supervisionPolicy}->>'maxVerifierCalls')::int,false)`),
  companyIdx: index("orchestration_plan_company_idx").on(t.companyId, t.createdAt) }));
export const orchestrationWorkers = pgTable("orchestration_workers", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), planId: uuid("plan_id").notNull(), issueId: uuid("issue_id").notNull(), agentId: uuid("agent_id"), completionContractId: uuid("completion_contract_id").notNull(), workerKey: text("worker_key").notNull(), dependsOn: jsonb("depends_on").$type<string[]>().notNull(), status: text("status").notNull().default("waiting"), attemptCount: integer("attempt_count").notNull().default(0), ...times(),
}, t => ({ tenantUq: unique("orchestration_worker_tenant_uq").on(t.companyId, t.id), planWorkerUq: unique("orchestration_worker_plan_id_uq").on(t.companyId, t.planId, t.id), keyUq: unique("orchestration_worker_key_uq").on(t.planId, t.workerKey), contractFk: foreignKey({ columns: [t.companyId, t.issueId, t.completionContractId], foreignColumns: [completionContracts.companyId, completionContracts.issueId, completionContracts.id] }), taskUq: unique("orchestration_worker_plan_task_uq").on(t.planId, t.issueId), planFk: foreignKey({ columns: [t.companyId, t.planId], foreignColumns: [orchestrationPlans.companyId, orchestrationPlans.id] }).onDelete("cascade"), taskFk: foreignKey({ columns: [t.companyId, t.issueId], foreignColumns: [issues.companyId, issues.id] }), agentFk: foreignKey({ columns: [t.companyId, t.agentId], foreignColumns: [agents.companyId, agents.id] }), stateCheck: check("orchestration_worker_state_check", sql`${t.status} in ('waiting','running','completed','failed','cancelled')`), counterCheck: check("orchestration_worker_counter_check", sql`${t.attemptCount}>=0`), liveTaskUq: uniqueIndex("orchestration_worker_live_task_uq").on(t.companyId, t.issueId).where(sql`${t.status} in ('waiting','running')`) }));
export const orchestrationWorkerAttempts = pgTable("orchestration_worker_attempts", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), planId: uuid("plan_id").notNull(), workerId: uuid("worker_id").notNull(), agentId: uuid("agent_id"), runId: uuid("run_id"), workflowRunId: uuid("workflow_run_id"), attempt: integer("attempt").notNull(), status: text("status").notNull().default("running"), executionManifestId: uuid("execution_manifest_id"), startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(), finishedAt: timestamp("finished_at", { withTimezone: true }), ...times(),
}, t => ({ planAttemptUq: unique("orchestration_attempt_plan_id_uq").on(t.companyId,t.planId,t.id), workerFk: foreignKey({ columns: [t.companyId, t.planId, t.workerId], foreignColumns: [orchestrationWorkers.companyId, orchestrationWorkers.planId, orchestrationWorkers.id] }).onDelete("cascade"), runFk: foreignKey({ columns: [t.companyId, t.agentId, t.runId], foreignColumns: [heartbeatRuns.companyId, heartbeatRuns.agentId, heartbeatRuns.id] }), workflowRunFk: foreignKey({ columns: [t.companyId, t.workflowRunId], foreignColumns: [workflowRuns.companyId, workflowRuns.id] }), manifestFk: foreignKey({ columns: [t.companyId, t.executionManifestId], foreignColumns: [agentExecutionManifests.companyId, agentExecutionManifests.id] }), attemptUq: unique("orchestration_worker_attempt_number_uq").on(t.workerId, t.attempt), runUq: unique("orchestration_worker_attempt_run_uq").on(t.companyId, t.runId), workflowRunUq: unique("orchestration_worker_attempt_workflow_uq").on(t.companyId, t.workflowRunId), liveWorkerUq: uniqueIndex("orchestration_worker_attempt_live_uq").on(t.workerId).where(sql`${t.status}='running'`), kindCheck: check("orchestration_attempt_kind_check", sql`num_nonnulls(${t.runId},${t.workflowRunId})=1 and (${t.runId} is null or ${t.agentId} is not null)`), stateCheck: check("orchestration_attempt_state_check", sql`${t.status} in ('running','succeeded','failed','cancelled')`), countCheck: check("orchestration_attempt_number_check", sql`${t.attempt}>0`) }));

export const orchestrationToolCharges = pgTable("orchestration_tool_charges", {
  invocationId: uuid("invocation_id").primaryKey().references(() => toolInvocations.id, { onDelete: "cascade" }), companyId: uuid("company_id").notNull(), planId: uuid("plan_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ planFk: foreignKey({ columns: [t.companyId, t.planId], foreignColumns: [orchestrationPlans.companyId, orchestrationPlans.id] }) }));

export const orchestrationModelReservations = pgTable("orchestration_model_reservations", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), planId: uuid("plan_id").notNull(), workerId: uuid("worker_id"), workerAttemptId: uuid("worker_attempt_id"),
  purpose: text("purpose").$type<"worker_model" | "read_only_verification" | "read_only_trajectory">().notNull(),
  principalUserId: text("principal_user_id").notNull(), idempotencyKey: text("idempotency_key").notNull(), requestHash: text("request_hash").notNull(), inputHash: text("input_hash").notNull(), authorityHash: text("authority_hash").notNull(),
  quote: jsonb("quote").$type<ModelReservationQuote>().notNull(), maximumMinor: integer("maximum_minor").notNull(),
  status: text("status").$type<"reserved" | "dispatched" | "completed" | "failed" | "unknown" | "cancelled">().notNull().default("reserved"),
  providerResponseHash: text("provider_response_hash"), usage: jsonb("usage").$type<{ inputTokens: number; outputTokens: number } | null>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), dispatchedAt: timestamp("dispatched_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  tenantUq: unique("orchestration_model_reservation_tenant_uq").on(t.companyId, t.id), keyUq: unique("orchestration_model_reservation_key_uq").on(t.companyId, t.planId, t.idempotencyKey),
  planFk: foreignKey({ columns: [t.companyId, t.planId], foreignColumns: [orchestrationPlans.companyId, orchestrationPlans.id] }).onDelete("cascade"), workerFk: foreignKey({ columns: [t.companyId, t.planId, t.workerId], foreignColumns: [orchestrationWorkers.companyId, orchestrationWorkers.planId, orchestrationWorkers.id] }), attemptFk: foreignKey({ columns: [t.companyId, t.planId, t.workerAttemptId], foreignColumns: [orchestrationWorkerAttempts.companyId, orchestrationWorkerAttempts.planId, orchestrationWorkerAttempts.id] }),
  statusCheck: check("orchestration_model_reservation_status_ck", sql`${t.status} in ('reserved','dispatched','completed','failed','unknown','cancelled')`),
  purposeCheck: check("orchestration_model_reservation_purpose_ck", sql`${t.purpose} in ('worker_model','read_only_verification','read_only_trajectory')`),
  costCheck: check("orchestration_model_reservation_cost_ck", sql`${t.maximumMinor} between 0 and 1000000 and (${t.quote}->>'maximumMinor')::int=${t.maximumMinor} and ${t.expiresAt}>${t.createdAt}`),
  hashCheck: check("orchestration_model_reservation_hash_ck", sql`${t.requestHash} ~ '^[a-f0-9]{64}$' and ${t.inputHash} ~ '^[a-f0-9]{64}$' and ${t.authorityHash} ~ '^[a-f0-9]{64}$' and (${t.providerResponseHash} is null or ${t.providerResponseHash} ~ '^[a-f0-9]{64}$')`),
  pendingIdx: index("orchestration_model_reservation_pending_idx").on(t.status, t.expiresAt),
}));
