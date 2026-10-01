import { sql } from "drizzle-orm";
import {
  check,
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
import { workflowRevisions, workflows } from "./workflows.js";

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
