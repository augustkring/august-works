import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import type { BusinessExperimentDefinition, BusinessExperimentMetricPin, BusinessExperimentState, BusinessExperimentInvariantReceipt, BusinessExperimentUnitSnapshot } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { analyticalLineageManifests } from "./analytical_lineage.js";
import { businessMetricVersions } from "./business_metrics.js";
import { decisions } from "./decisions.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

export const businessExperiments = pgTable("business_experiments", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  key: text("experiment_key").notNull(), revision: integer("revision").notNull().default(1),
  state: text("state").$type<BusinessExperimentState>().notNull().default("draft"), currentVersionId: uuid("current_version_id"),
  createdBy: text("created_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t): PgTableExtraConfigValue[] => [
  unique("business_experiments_tenant_uq").on(t.companyId, t.id), unique("business_experiments_key_uq").on(t.companyId, t.key),
  foreignKey({ name: "business_experiments_version_fk", columns: [t.companyId, t.id, t.currentVersionId], foreignColumns: [businessExperimentVersions.companyId, businessExperimentVersions.experimentId, businessExperimentVersions.id] }).onDelete("cascade"),
  check("business_experiments_state_check", sql`${t.revision}>0 and ${t.state} in ('draft','in_review','ready','running','paused','completed','analyzing','decided','inconclusive','invalid','cancelled') and ${t.updatedAt}>=${t.createdAt}`),
]);
export const businessExperimentVersions = pgTable("business_experiment_versions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), experimentId: uuid("experiment_id").notNull(), revision: integer("revision").notNull(),
  definition: jsonb("definition_json").$type<BusinessExperimentDefinition>().notNull(), contentHash: text("content_hash").notNull(),
  metricPins: jsonb("metric_pins_json").$type<BusinessExperimentMetricPin[]>().notNull(), inputHash: text("input_hash").notNull(),
  decisionId: uuid("decision_id"), lineageManifestId: uuid("lineage_manifest_id").notNull(), amendmentReason: text("amendment_reason").notNull(), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => ({
  tenantUq: unique("business_experiment_versions_tenant_uq").on(t.companyId, t.experimentId, t.id),
  revisionUq: unique("business_experiment_versions_revision_uq").on(t.companyId, t.experimentId, t.revision),
  rootFk: foreignKey({ name: "business_experiment_versions_root_fk", columns: [t.companyId, t.experimentId], foreignColumns: [businessExperiments.companyId, businessExperiments.id] }).onDelete("cascade"),
  lineageFk: foreignKey({ name: "business_experiment_versions_lineage_fk", columns: [t.companyId, t.lineageManifestId], foreignColumns: [analyticalLineageManifests.companyId, analyticalLineageManifests.id] }).onDelete("cascade"),
  decisionFk: foreignKey({ name: "business_experiment_versions_decision_fk", columns: [t.companyId, t.decisionId], foreignColumns: [decisions.companyId, decisions.id] }).onDelete("cascade"),
  contentCheck: check("business_experiment_versions_content_check", sql`${t.revision}>0 and ${t.contentHash} ~ '^[0-9a-f]{64}$' and ${t.inputHash} ~ '^[0-9a-f]{64}$' and jsonb_typeof(${t.definition})='object' and jsonb_typeof(${t.metricPins})='array' and ${t.expiresAt}>${t.createdAt} and length(btrim(${t.amendmentReason})) between 10 and 2000`),
}));
/** Exact canonical definitions own erasure, including the protocol prose. */
export const businessExperimentMetricPins = pgTable("business_experiment_metric_pins", {
  companyId: uuid("company_id").notNull(), experimentId: uuid("experiment_id").notNull(), versionId: uuid("version_id").notNull(),
  key: text("metric_key").notNull(), metricId: uuid("metric_id").notNull(), metricVersionId: uuid("metric_version_id").notNull(), contentHash: text("content_hash").notNull(),
}, t => ({
  keyUq: unique("business_experiment_metric_pins_key_uq").on(t.companyId, t.versionId, t.key),
  metricUq: unique("business_experiment_metric_pins_metric_uq").on(t.companyId, t.versionId, t.metricId),
  versionFk: foreignKey({ name: "business_experiment_metric_pins_version_fk", columns: [t.companyId, t.experimentId, t.versionId], foreignColumns: [businessExperimentVersions.companyId, businessExperimentVersions.experimentId, businessExperimentVersions.id] }).onDelete("cascade"),
  metricFk: foreignKey({ name: "business_experiment_metric_pins_metric_fk", columns: [t.companyId, t.metricId, t.metricVersionId], foreignColumns: [businessMetricVersions.companyId, businessMetricVersions.metricId, businessMetricVersions.id] }).onDelete("cascade"),
  hashCheck: check("business_experiment_metric_pins_hash_check", sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
}));
export const businessExperimentTransitions = pgTable("business_experiment_transitions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), experimentId: uuid("experiment_id").notNull(), versionId: uuid("version_id").notNull(),
  revision: integer("revision").notNull(), fromState: text("from_state").$type<BusinessExperimentState>().notNull(), toState: text("to_state").$type<BusinessExperimentState>().notNull(),
  rationale: text("rationale").notNull(), createdBy: text("created_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, t => ({
  tenantUq: unique("business_experiment_transitions_tenant_uq").on(t.companyId, t.experimentId, t.versionId, t.id),
  revisionUq: unique("business_experiment_transitions_revision_uq").on(t.companyId, t.experimentId, t.revision),
  versionFk: foreignKey({ name: "business_experiment_transitions_version_fk", columns: [t.companyId, t.experimentId, t.versionId], foreignColumns: [businessExperimentVersions.companyId, businessExperimentVersions.experimentId, businessExperimentVersions.id] }).onDelete("cascade"),
  contentCheck: check("business_experiment_transitions_content_check", sql`${t.revision}>1 and ${t.fromState}<>${t.toState} and length(btrim(${t.rationale})) between 10 and 2000 and length(btrim(${t.createdBy})) between 1 and 200`),
}));

/** Recording a governed experiment dispatches no native work or exposure. */
export const businessExperimentExecutions = pgTable("business_experiment_executions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), experimentId: uuid("experiment_id").notNull(), versionId: uuid("version_id").notNull(),
  mode: text("mode").$type<"recording_only_human_attested_native_process">().notNull(), reviewTransitionId: uuid("review_transition_id").notNull(),
  assignmentKeyFingerprint: text("assignment_key_fingerprint").notNull(), rationale: text("rationale").notNull(), receiptHash: text("receipt_hash").notNull(), signature: text("signature").notNull(),
  startedBy: text("started_by").notNull(), startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
}, t => ({
  versionUq: unique("business_experiment_executions_version_uq").on(t.companyId, t.experimentId, t.versionId),
  versionFk: foreignKey({ name: "business_experiment_executions_version_fk", columns: [t.companyId, t.experimentId, t.versionId], foreignColumns: [businessExperimentVersions.companyId, businessExperimentVersions.experimentId, businessExperimentVersions.id] }).onDelete("cascade"),
  reviewFk: foreignKey({ name: "business_experiment_executions_review_fk", columns: [t.companyId, t.experimentId, t.versionId, t.reviewTransitionId], foreignColumns: [businessExperimentTransitions.companyId, businessExperimentTransitions.experimentId, businessExperimentTransitions.versionId, businessExperimentTransitions.id] }).onDelete("cascade"),
  contentCheck: check("business_experiment_executions_content_check", sql`${t.mode}='recording_only_human_attested_native_process' and ${t.assignmentKeyFingerprint} ~ '^[0-9a-f]{64}$' and ${t.receiptHash} ~ '^[0-9a-f]{64}$' and ${t.signature} ~ '^decision-spec-v1[.][0-9a-f]{64}$' and length(btrim(${t.rationale})) between 10 and 2000`),
}));
export const businessExperimentAssignments = pgTable("business_experiment_assignments", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), experimentId: uuid("experiment_id").notNull(), versionId: uuid("version_id").notNull(),
  unitType: text("unit_type").$type<"issue" | "project">().notNull(), unitId: uuid("unit_id").notNull(), issueId: uuid("issue_id"), projectId: uuid("project_id"),
  arm: text("arm").$type<"control" | "treatment">().notNull(), sourceSnapshot: jsonb("source_snapshot_json").$type<BusinessExperimentUnitSnapshot>().notNull(), sourceHash: text("source_hash").notNull(),
  invariantReceipts: jsonb("invariant_receipts_json").$type<BusinessExperimentInvariantReceipt[]>().notNull(), lineageManifestId: uuid("lineage_manifest_id").notNull(),
  receiptHash: text("receipt_hash").notNull(), signature: text("signature").notNull(), assignedBy: text("assigned_by").notNull(), assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull(),
}, t => ({
  tenantUq: unique("business_experiment_assignments_tenant_uq").on(t.companyId, t.experimentId, t.versionId, t.id),
  unitUq: unique("business_experiment_assignments_unit_uq").on(t.companyId, t.versionId, t.unitId),
  executionFk: foreignKey({ name: "business_experiment_assignments_execution_fk", columns: [t.companyId, t.experimentId, t.versionId], foreignColumns: [businessExperimentExecutions.companyId, businessExperimentExecutions.experimentId, businessExperimentExecutions.versionId] }).onDelete("cascade"),
  issueFk: foreignKey({ name: "business_experiment_assignments_issue_fk", columns: [t.companyId, t.issueId], foreignColumns: [issues.companyId, issues.id] }).onDelete("cascade"),
  projectFk: foreignKey({ name: "business_experiment_assignments_project_fk", columns: [t.companyId, t.projectId], foreignColumns: [projects.companyId, projects.id] }).onDelete("cascade"),
  lineageFk: foreignKey({ name: "business_experiment_assignments_lineage_fk", columns: [t.companyId, t.lineageManifestId], foreignColumns: [analyticalLineageManifests.companyId, analyticalLineageManifests.id] }).onDelete("cascade"),
  contentCheck: check("business_experiment_assignments_content_check", sql`${t.arm} in ('control','treatment') and (${t.unitType}='issue' and ${t.issueId} is not null and ${t.issueId}=${t.unitId} and ${t.projectId} is null or ${t.unitType}='project' and ${t.projectId} is not null and ${t.projectId}=${t.unitId} and ${t.issueId} is null) and ${t.sourceHash} ~ '^[0-9a-f]{64}$' and ${t.receiptHash} ~ '^[0-9a-f]{64}$' and ${t.signature} ~ '^decision-spec-v1[.][0-9a-f]{64}$' and jsonb_typeof(${t.sourceSnapshot})='object' and jsonb_typeof(${t.invariantReceipts})='array'`),
}));
export const businessExperimentExposures = pgTable("business_experiment_exposures", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), experimentId: uuid("experiment_id").notNull(), versionId: uuid("version_id").notNull(), assignmentId: uuid("assignment_id").notNull(),
  arm: text("arm").$type<"control" | "treatment">().notNull(), status: text("status").$type<"applied" | "not_applied">().notNull(), provenance: text("provenance").$type<"human_attestation">().notNull(),
  assertedAppliedAt: timestamp("asserted_applied_at", { withTimezone: true }), rationale: text("rationale").notNull(), receiptHash: text("receipt_hash").notNull(), signature: text("signature").notNull(),
  recordedBy: text("recorded_by").notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
}, t => ({
  assignmentUq: unique("business_experiment_exposures_assignment_uq").on(t.companyId, t.assignmentId),
  assignmentFk: foreignKey({ name: "business_experiment_exposures_assignment_fk", columns: [t.companyId, t.experimentId, t.versionId, t.assignmentId], foreignColumns: [businessExperimentAssignments.companyId, businessExperimentAssignments.experimentId, businessExperimentAssignments.versionId, businessExperimentAssignments.id] }).onDelete("cascade"),
  contentCheck: check("business_experiment_exposures_content_check", sql`${t.arm} in ('control','treatment') and ${t.status} in ('applied','not_applied') and ${t.provenance}='human_attestation' and (${t.status}='applied')=(${t.assertedAppliedAt} is not null) and (${t.assertedAppliedAt} is null or ${t.assertedAppliedAt}<=${t.recordedAt}) and ${t.receiptHash} ~ '^[0-9a-f]{64}$' and ${t.signature} ~ '^decision-spec-v1[.][0-9a-f]{64}$' and length(btrim(${t.rationale})) between 10 and 2000`),
}));
export const businessExperimentCompletions = pgTable("business_experiment_completions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), experimentId: uuid("experiment_id").notNull(), versionId: uuid("version_id").notNull(),
  reason: text("reason").$type<"fixed_horizon" | "emergency_safety_stop" | "cancelled">().notNull(),
  concurrentChangeReview: jsonb("concurrent_change_review_json").$type<{ assessment: "none_identified" | "material_or_unknown"; rationale: string }>().notNull(),
  rationale: text("rationale").notNull(), receiptHash: text("receipt_hash").notNull(), signature: text("signature").notNull(), completedBy: text("completed_by").notNull(), completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
}, t => ({
  versionUq: unique("business_experiment_completions_version_uq").on(t.companyId, t.experimentId, t.versionId),
  executionFk: foreignKey({ name: "business_experiment_completions_execution_fk", columns: [t.companyId, t.experimentId, t.versionId], foreignColumns: [businessExperimentExecutions.companyId, businessExperimentExecutions.experimentId, businessExperimentExecutions.versionId] }).onDelete("cascade"),
  contentCheck: check("business_experiment_completions_content_check", sql`${t.reason} in ('fixed_horizon','emergency_safety_stop','cancelled') and jsonb_typeof(${t.concurrentChangeReview})='object' and ${t.concurrentChangeReview}->>'assessment' in ('none_identified','material_or_unknown') and length(btrim(${t.concurrentChangeReview}->>'rationale')) between 10 and 2000 and length(btrim(${t.rationale})) between 10 and 2000 and ${t.receiptHash} ~ '^[0-9a-f]{64}$' and ${t.signature} ~ '^decision-spec-v1[.][0-9a-f]{64}$'`),
}));
