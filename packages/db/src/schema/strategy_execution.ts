import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import type { StrategyExecutionLinkDefinition, StrategyExecutionReference } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { goals } from "./goals.js";
import { projects } from "./projects.js";
import { issues } from "./issues.js";
import { projectMilestones } from "./project_control.js";
import { decisions } from "./decisions.js";
import { foundationDocuments } from "./foundation.js";
import { documentRevisions } from "./document_revisions.js";
import { businessMetrics, businessMetricVersions, businessMetricObservations } from "./business_metrics.js";
import { businessMetricTargets, businessMetricTargetVersions } from "./business_metric_targets.js";

/** Fixed native endpoint identities. Generated FK columns keep source erasure
 * in the existing relational owners; Foundation section reindex is ordinary
 * drift, not erasure, so section pins live in immutable version JSON. */
export const strategyExecutionLinks = pgTable("strategy_execution_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  fromType: text("from_type").$type<StrategyExecutionReference["type"]>().notNull(), fromRef: uuid("from_ref").notNull(),
  toType: text("to_type").$type<StrategyExecutionReference["type"]>().notNull(), toRef: uuid("to_ref").notNull(),
  relationship: text("relationship_type").$type<StrategyExecutionLinkDefinition["relationship"]>().notNull(),
  status: text("status").$type<"proposed" | "active" | "retired">().notNull().default("proposed"),
  revision: integer("revision").notNull().default(1), approvedVersionId: uuid("approved_version_id"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  fromFoundationId: uuid("from_foundation_section_id").generatedAlwaysAs(sql`case when from_type='foundation_section' then from_ref end`).references(() => foundationDocuments.id, { onDelete: "cascade" }),
  fromGoalId: uuid("from_goal_id").generatedAlwaysAs(sql`case when from_type='goal' then from_ref end`).references(() => goals.id, { onDelete: "cascade" }),
  fromProjectId: uuid("from_project_id").generatedAlwaysAs(sql`case when from_type='project' then from_ref end`).references(() => projects.id, { onDelete: "cascade" }),
  fromIssueId: uuid("from_issue_id").generatedAlwaysAs(sql`case when from_type='issue' then from_ref end`).references(() => issues.id, { onDelete: "cascade" }),
  fromMilestoneId: uuid("from_milestone_id").generatedAlwaysAs(sql`case when from_type='milestone' then from_ref end`).references(() => projectMilestones.id, { onDelete: "cascade" }),
  fromDecisionId: uuid("from_decision_id").generatedAlwaysAs(sql`case when from_type='decision' then from_ref end`).references(() => decisions.id, { onDelete: "cascade" }),
  fromMetricId: uuid("from_metric_id").generatedAlwaysAs(sql`case when from_type='metric' then from_ref end`).references(() => businessMetrics.id, { onDelete: "cascade" }),
  fromTargetId: uuid("from_metric_target_id").generatedAlwaysAs(sql`case when from_type='metric_target' then from_ref end`).references(() => businessMetricTargets.id, { onDelete: "cascade" }),
  fromObservationId: uuid("from_metric_observation_id").generatedAlwaysAs(sql`case when from_type='metric_observation' then from_ref end`).references(() => businessMetricObservations.id, { onDelete: "cascade" }),
  toFoundationId: uuid("to_foundation_section_id").generatedAlwaysAs(sql`case when to_type='foundation_section' then to_ref end`).references(() => foundationDocuments.id, { onDelete: "cascade" }),
  toGoalId: uuid("to_goal_id").generatedAlwaysAs(sql`case when to_type='goal' then to_ref end`).references(() => goals.id, { onDelete: "cascade" }),
  toProjectId: uuid("to_project_id").generatedAlwaysAs(sql`case when to_type='project' then to_ref end`).references(() => projects.id, { onDelete: "cascade" }),
  toIssueId: uuid("to_issue_id").generatedAlwaysAs(sql`case when to_type='issue' then to_ref end`).references(() => issues.id, { onDelete: "cascade" }),
  toMilestoneId: uuid("to_milestone_id").generatedAlwaysAs(sql`case when to_type='milestone' then to_ref end`).references(() => projectMilestones.id, { onDelete: "cascade" }),
  toDecisionId: uuid("to_decision_id").generatedAlwaysAs(sql`case when to_type='decision' then to_ref end`).references(() => decisions.id, { onDelete: "cascade" }),
  toMetricId: uuid("to_metric_id").generatedAlwaysAs(sql`case when to_type='metric' then to_ref end`).references(() => businessMetrics.id, { onDelete: "cascade" }),
  toTargetId: uuid("to_metric_target_id").generatedAlwaysAs(sql`case when to_type='metric_target' then to_ref end`).references(() => businessMetricTargets.id, { onDelete: "cascade" }),
  toObservationId: uuid("to_metric_observation_id").generatedAlwaysAs(sql`case when to_type='metric_observation' then to_ref end`).references(() => businessMetricObservations.id, { onDelete: "cascade" }),
}, (t): PgTableExtraConfigValue[] => [
  unique("strategy_links_tenant_id_uq").on(t.companyId, t.id),
  index("strategy_links_from_idx").on(t.companyId, t.fromType, t.fromRef),
  index("strategy_links_to_idx").on(t.companyId, t.toType, t.toRef),
  foreignKey({ name: "strategy_links_approved_fk", columns: [t.companyId, t.id, t.approvedVersionId], foreignColumns: [strategyExecutionLinkVersions.companyId, strategyExecutionLinkVersions.linkId, strategyExecutionLinkVersions.id] }).onDelete("cascade"),
  check("strategy_links_revision_check", sql`${t.revision}>0`),
  check("strategy_links_status_check", sql`${t.status} in ('proposed','active','retired') and (${t.status}<>'active' or ${t.approvedVersionId} is not null)`),
  check("strategy_links_identity_check", sql`(${t.fromType},${t.fromRef})<>(${t.toType},${t.toRef})`),
  check("strategy_links_relationship_check", sql`${t.relationship} in ('supports','measures','constrains','advanced_by','depends_on','conflicts_with','funds','informs')`),
  check("strategy_links_types_check", sql`${t.fromType} in ('foundation_section','goal','project','issue','milestone','decision','metric','metric_target','metric_observation') and ${t.toType} in ('foundation_section','goal','project','issue','milestone','decision','metric','metric_target','metric_observation')`),
]);
export const strategyExecutionLinkVersions = pgTable("strategy_execution_link_versions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), linkId: uuid("link_id").notNull(),
  revision: integer("revision").notNull(), definition: jsonb("definition_json").$type<StrategyExecutionLinkDefinition>().notNull(),
  contentHash: text("content_hash").notNull(), createdBy: text("created_by").notNull(),
  nextReviewAt: timestamp("next_review_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  fromFoundationRevisionId: uuid("from_foundation_section_version_id").generatedAlwaysAs(sql`case when definition_json->'from'->>'type'='foundation_section' then (definition_json->'from'->>'approvedRevisionId')::uuid end`).references(() => documentRevisions.id, { onDelete: "cascade" }),
  fromMetricVersionId: uuid("from_metric_version_id").generatedAlwaysAs(sql`case when definition_json->'from'->>'type'='metric' then (definition_json->'from'->>'versionId')::uuid end`).references(() => businessMetricVersions.id, { onDelete: "cascade" }),
  fromTargetVersionId: uuid("from_metric_target_version_id").generatedAlwaysAs(sql`case when definition_json->'from'->>'type'='metric_target' then (definition_json->'from'->>'versionId')::uuid end`).references(() => businessMetricTargetVersions.id, { onDelete: "cascade" }),
  toFoundationRevisionId: uuid("to_foundation_section_version_id").generatedAlwaysAs(sql`case when definition_json->'to'->>'type'='foundation_section' then (definition_json->'to'->>'approvedRevisionId')::uuid end`).references(() => documentRevisions.id, { onDelete: "cascade" }),
  toMetricVersionId: uuid("to_metric_version_id").generatedAlwaysAs(sql`case when definition_json->'to'->>'type'='metric' then (definition_json->'to'->>'versionId')::uuid end`).references(() => businessMetricVersions.id, { onDelete: "cascade" }),
  toTargetVersionId: uuid("to_metric_target_version_id").generatedAlwaysAs(sql`case when definition_json->'to'->>'type'='metric_target' then (definition_json->'to'->>'versionId')::uuid end`).references(() => businessMetricTargetVersions.id, { onDelete: "cascade" }),
}, (t) => ({
  tenantIdUq: unique("strategy_versions_tenant_id_uq").on(t.companyId, t.linkId, t.id),
  revisionUq: unique("strategy_versions_revision_uq").on(t.companyId, t.linkId, t.revision),
  rootFk: foreignKey({ name: "strategy_versions_link_fk", columns: [t.companyId, t.linkId], foreignColumns: [strategyExecutionLinks.companyId, strategyExecutionLinks.id] }).onDelete("cascade"),
  hashCheck: check("strategy_versions_definition_check", sql`${t.contentHash} ~ '^[0-9a-f]{64}$' and ${t.revision}>0 and jsonb_typeof(${t.definition})='object' and ${t.expiresAt}>${t.createdAt} and ${t.nextReviewAt}>${t.createdAt}`),
}));
export const strategyExecutionLinkApprovals = pgTable("strategy_execution_link_approvals", {
  companyId: uuid("company_id").notNull(), linkId: uuid("link_id").notNull(), versionId: uuid("version_id").notNull(),
  approvedBy: text("approved_by").notNull(), rationale: text("rationale").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  versionUq: unique("strategy_approvals_version_uq").on(t.companyId, t.linkId, t.versionId),
  versionFk: foreignKey({ name: "strategy_approvals_version_fk", columns: [t.companyId, t.linkId, t.versionId], foreignColumns: [strategyExecutionLinkVersions.companyId, strategyExecutionLinkVersions.linkId, strategyExecutionLinkVersions.id] }).onDelete("cascade"),
}));

/** Privacy ancestry includes implicit execution sources, especially all native
 * Decision targets. Losing the native target join must not lose erasure ancestry. */
export const strategyExecutionSourceBindings = pgTable("strategy_execution_source_bindings", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), linkId: uuid("link_id").notNull(),
  issueId: uuid("issue_id"), projectId: uuid("project_id"),
}, t => ({
  linkFk: foreignKey({ name: "strategy_bindings_link_fk", columns: [t.companyId, t.linkId], foreignColumns: [strategyExecutionLinks.companyId, strategyExecutionLinks.id] }).onDelete("cascade"),
  issueFk: foreignKey({ name: "strategy_bindings_issue_fk", columns: [t.companyId, t.issueId], foreignColumns: [issues.companyId, issues.id] }).onDelete("cascade"),
  projectFk: foreignKey({ name: "strategy_bindings_project_fk", columns: [t.companyId, t.projectId], foreignColumns: [projects.companyId, projects.id] }).onDelete("cascade"),
  sourceCheck: check("strategy_bindings_source_check", sql`(${t.issueId} is not null)::int + (${t.projectId} is not null)::int = 1`),
  issueUq: unique("strategy_bindings_issue_uq").on(t.companyId, t.linkId, t.issueId),
  projectUq: unique("strategy_bindings_project_uq").on(t.companyId, t.linkId, t.projectId),
}));
