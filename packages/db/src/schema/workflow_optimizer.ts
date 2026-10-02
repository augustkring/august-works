import { sql } from "drizzle-orm";
import {
  check,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  OptimizerCandidateType,
  OptimizerSideEffectRisk,
  OptimizerSuggestionStatus,
} from "@paperclipai/shared";
import { companies } from "./companies.js";
import { workflowRevisions, workflowRuns, workflows } from "./workflows.js";
import type { ExecutionPrincipal } from "@paperclipai/shared";
import type { OptimizerCompilerResult, OptimizerReplayEvaluation, OptimizerShadowEvaluation, OptimizerShadowObservationResult } from "@paperclipai/shared";
import { automationArtifacts, automationArtifactVersions } from "./automation_artifacts.js";

export const workflowOptimizerEvaluations = pgTable("workflow_optimizer_evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  suggestionId: uuid("suggestion_id").notNull().references(() => workflowOptimizerSuggestions.id, { onDelete: "restrict" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "restrict" }),
  workflowRevisionId: uuid("workflow_revision_id").notNull().references(() => workflowRevisions.id, { onDelete: "restrict" }),
  nodeId: text("node_id").notNull(),
  artifactId: uuid("artifact_id").notNull().references(() => automationArtifacts.id, { onDelete: "restrict" }),
  artifactVersionId: uuid("artifact_version_id").notNull().references(() => automationArtifactVersions.id, { onDelete: "restrict" }),
  contentHash: text("content_hash").notNull(),
  status: text("status").notNull().default("testing"),
  compilerResult: jsonb("compiler_result").$type<OptimizerCompilerResult>(),
  replayEvaluation: jsonb("replay_evaluation").$type<OptimizerReplayEvaluation>(),
  shadowEvaluation: jsonb("shadow_evaluation").$type<OptimizerShadowEvaluation>(),
  invariants: jsonb("invariants").$type<Array<{ id: string; description: string; critical: boolean; expression: string }>>().notNull().default([]),
  sourceRunIds: jsonb("source_run_ids").$type<string[]>().notNull().default([]),
  memoryRecordIds: jsonb("memory_record_ids").$type<string[]>().notNull().default([]),
  knownInputShapes: jsonb("known_input_shapes").$type<string[]>().notNull().default([]),
  approvalId: uuid("approval_id"),
  canaryTrafficPercent: integer("canary_traffic_percent").notNull().default(20),
  createdBy: jsonb("created_by").$type<ExecutionPrincipal>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyWorkflowIdx: index("workflow_optimizer_evaluations_company_workflow_idx").on(table.companyId, table.workflowId),
  activeNodeUq: uniqueIndex("workflow_optimizer_evaluations_live_node_uq").on(table.companyId, table.workflowRevisionId, table.nodeId)
    .where(sql`${table.status} in ('shadow', 'canary', 'active')`),
  versionUq: uniqueIndex("workflow_optimizer_evaluations_version_uq").on(table.companyId, table.artifactVersionId),
  statusCheck: check("workflow_optimizer_evaluations_status_check", sql`${table.status} in ('testing', 'failed', 'shadow', 'canary', 'active', 'degraded', 'retired')`),
  trafficCheck: check("workflow_optimizer_evaluations_traffic_check", sql`${table.canaryTrafficPercent} between 1 and 50`),
}));

export const workflowOptimizerObservations = pgTable("workflow_optimizer_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  evaluationId: uuid("evaluation_id").notNull().references(() => workflowOptimizerEvaluations.id, { onDelete: "cascade" }),
  workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  mode: text("mode").notNull(),
  candidateUsed: boolean("candidate_used").notNull(),
  passed: boolean("passed").notNull(),
  fallback: boolean("fallback").notNull(),
  inputShapeHash: text("input_shape_hash").notNull(),
  newInputShape: boolean("new_input_shape").notNull(),
  invariantFailure: boolean("invariant_failure").notNull(),
  shadowResult: jsonb("shadow_result").$type<OptimizerShadowObservationResult>(),
  errorCode: text("error_code"),
  durationMs: integer("duration_ms").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  runNodeUq: uniqueIndex("workflow_optimizer_observations_evaluation_run_node_uq").on(table.companyId, table.evaluationId, table.workflowRunId, table.nodeId),
  companyEvaluationIdx: index("workflow_optimizer_observations_company_evaluation_idx").on(table.companyId, table.evaluationId),
  modeCheck: check("workflow_optimizer_observations_mode_check", sql`${table.mode} in ('shadow', 'canary', 'active')`),
}));

export const workflowRunReviews = pgTable("workflow_run_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
  humanCorrection: boolean("human_correction").notNull(),
  correctedOutputs: jsonb("corrected_outputs").$type<Record<string, unknown>>().notNull().default({}),
  reason: text("reason").notNull(),
  reviewer: jsonb("reviewer").$type<ExecutionPrincipal>().notNull(),
  memoryRecordIds: jsonb("memory_record_ids").$type<string[]>().notNull().default([]),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  runUq: uniqueIndex("workflow_run_reviews_company_run_uq").on(table.companyId, table.workflowRunId),
  companyReviewedIdx: index("workflow_run_reviews_company_reviewed_idx").on(table.companyId, table.reviewedAt),
}));

export const workflowOptimizerSuggestions = pgTable(
  "workflow_optimizer_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "restrict" }),
    workflowRevisionId: uuid("workflow_revision_id")
      .notNull()
      .references(() => workflowRevisions.id, { onDelete: "restrict" }),

    signatureHash: text("signature_hash").notNull(),
    status: text("status")
      .$type<OptimizerSuggestionStatus>()
      .notNull()
      .default("detected"),
    candidateType: text("candidate_type")
      .$type<OptimizerCandidateType>()
      .notNull(),
    stepOrdinals: jsonb("step_ordinals").$type<number[]>().notNull(),
    operationTypes: jsonb("operation_types").$type<string[]>().notNull(),
    capabilityRefs: jsonb("capability_refs")
      .$type<Array<string | null>>()
      .notNull(),
    sideEffectRisk: text("side_effect_risk")
      .$type<OptimizerSideEffectRisk>()
      .notNull(),

    observationCount: integer("observation_count").notNull(),
    successRate: doublePrecision("success_rate").notNull(),
    humanCorrectionRate: doublePrecision("human_correction_rate"),
    humanCorrectionEvidenceCount: integer("human_correction_evidence_count").notNull(),
    humanCorrectionEvidenceCoverage: doublePrecision(
      "human_correction_evidence_coverage",
    ).notNull(),
    inputShapeStability: doublePrecision("input_shape_stability").notNull(),
    outputShapeStability: doublePrecision("output_shape_stability").notNull(),
    averageDurationMs: doublePrecision("average_duration_ms").notNull(),
    averageCost: doublePrecision("average_cost"),
    estimatedLatencySavingsMs: doublePrecision(
      "estimated_latency_savings_ms",
    ).notNull(),
    estimatedCostSavings: doublePrecision("estimated_cost_savings"),
    observedRunIds: jsonb("observed_run_ids").$type<string[]>().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyIdIdUq: uniqueIndex(
      "workflow_optimizer_suggestions_company_id_id_uq",
    ).on(table.companyId, table.id),
    companyRevisionSignatureUq: uniqueIndex(
      "workflow_optimizer_suggestions_company_revision_signature_uq",
    ).on(table.companyId, table.workflowRevisionId, table.signatureHash),
    companyWorkflowStatusIdx: index(
      "workflow_optimizer_suggestions_company_workflow_status_idx",
    ).on(table.companyId, table.workflowId, table.status),
    companyCreatedIdx: index(
      "workflow_optimizer_suggestions_company_created_idx",
    ).on(table.companyId, table.createdAt.desc()),
    statusCheck: check(
      "workflow_optimizer_suggestions_status_check",
      sql`${table.status} in ('detected','generated','evaluating','ready_for_shadow','shadowing','ready_to_promote','promoted','rejected','needs_revision')`,
    ),
    candidateTypeCheck: check(
      "workflow_optimizer_suggestions_candidate_type_check",
      sql`${table.candidateType} in ('expression','transform','tool_chain','subworkflow','typescript','python')`,
    ),
    sideEffectRiskCheck: check(
      "workflow_optimizer_suggestions_side_effect_risk_check",
      sql`${table.sideEffectRisk} in ('low','medium','high')`,
    ),
    observationCountCheck: check(
      "workflow_optimizer_suggestions_observation_count_check",
      sql`${table.observationCount} >= 3`,
    ),
    rateBoundsCheck: check(
      "workflow_optimizer_suggestions_rate_bounds_check",
      sql`${table.successRate} between 0 and 1
        and (${table.humanCorrectionRate} is null or ${table.humanCorrectionRate} between 0 and 1)
        and ${table.humanCorrectionEvidenceCoverage} between 0 and 1
        and ${table.inputShapeStability} between 0 and 1
        and ${table.outputShapeStability} between 0 and 1`,
    ),
    nonNegativeMetricsCheck: check(
      "workflow_optimizer_suggestions_nonnegative_metrics_check",
      sql`${table.humanCorrectionEvidenceCount} >= 0
        and ${table.humanCorrectionEvidenceCount} <= ${table.observationCount}
        and ${table.averageDurationMs} >= 0
        and ${table.estimatedLatencySavingsMs} >= 0
        and (${table.averageCost} is null or ${table.averageCost} >= 0)
        and (${table.estimatedCostSavings} is null or ${table.estimatedCostSavings} >= 0)`,
    ),
    signatureHashCheck: check(
      "workflow_optimizer_suggestions_signature_hash_check",
      sql`${table.signatureHash} ~ '^[0-9a-f]{64}$'`,
    ),
  }),
);
