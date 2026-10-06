import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import type { BusinessMetricTargetDefinition } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { goals } from "./goals.js";
import { projects } from "./projects.js";
import { businessMetrics, businessMetricVersions } from "./business_metrics.js";

/** Scope and metric identity are fixed per commitment. Changing ownership scope
 * creates a new commitment; revisions never silently move an approved target. */
export const businessMetricTargets = pgTable("business_metric_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  key: text("target_key").notNull(), metricId: uuid("metric_id").notNull(),
  scopeType: text("scope_type").$type<BusinessMetricTargetDefinition["scope"]["type"]>().notNull(),
  goalId: uuid("goal_id"), projectId: uuid("project_id"),
  revision: integer("revision").notNull().default(1),
  status: text("status").$type<"draft" | "approved" | "retired">().notNull().default("draft"),
  approvedVersionId: uuid("approved_version_id"), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t): PgTableExtraConfigValue[] => [
  unique("business_metric_targets_tenant_id_uq").on(t.companyId, t.id),
  unique("business_metric_targets_key_uq").on(t.companyId, t.key),
  foreignKey({ name: "business_metric_targets_metric_fk", columns: [t.companyId, t.metricId], foreignColumns: [businessMetrics.companyId, businessMetrics.id] }).onDelete("cascade"),
  foreignKey({ name: "business_metric_targets_goal_fk", columns: [t.companyId, t.goalId], foreignColumns: [goals.companyId, goals.id] }).onDelete("cascade"),
  foreignKey({ name: "business_metric_targets_project_fk", columns: [t.companyId, t.projectId], foreignColumns: [projects.companyId, projects.id] }).onDelete("cascade"),
  foreignKey({ name: "business_metric_targets_approved_fk", columns: [t.companyId, t.id, t.approvedVersionId], foreignColumns: [businessMetricTargetVersions.companyId, businessMetricTargetVersions.targetId, businessMetricTargetVersions.id] }).onDelete("cascade"),
  check("business_metric_targets_revision_check", sql`${t.revision}>0`),
  check("business_metric_targets_status_check", sql`${t.status} in ('draft','approved','retired') and (${t.status}<>'approved' or ${t.approvedVersionId} is not null)`),
  check("business_metric_targets_scope_check", sql`(${t.scopeType}='goal' and ${t.goalId} is not null and ${t.projectId} is null) or (${t.scopeType}='project' and ${t.projectId} is not null and ${t.goalId} is null) or (${t.scopeType} in ('company','portfolio') and ${t.goalId} is null and ${t.projectId} is null)`),
]);
export const businessMetricTargetVersions = pgTable("business_metric_target_versions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), targetId: uuid("target_id").notNull(),
  metricId: uuid("metric_id").notNull(), metricVersionId: uuid("metric_version_id").notNull(),
  revision: integer("revision").notNull(), definition: jsonb("definition_json").$type<BusinessMetricTargetDefinition>().notNull(),
  contentHash: text("content_hash").notNull(), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdUq: unique("business_metric_target_versions_tenant_id_uq").on(t.companyId, t.targetId, t.id),
  revisionUq: unique("business_metric_target_versions_revision_uq").on(t.companyId, t.targetId, t.revision),
  targetFk: foreignKey({ name: "business_metric_target_versions_target_fk", columns: [t.companyId, t.targetId], foreignColumns: [businessMetricTargets.companyId, businessMetricTargets.id] }).onDelete("cascade"),
  metricFk: foreignKey({ name: "business_metric_target_versions_metric_fk", columns: [t.companyId, t.metricId, t.metricVersionId], foreignColumns: [businessMetricVersions.companyId, businessMetricVersions.metricId, businessMetricVersions.id] }).onDelete("cascade"),
  hashCheck: check("business_metric_target_versions_hash_check", sql`${t.contentHash} ~ '^[0-9a-f]{64}$' and ${t.revision}>0 and jsonb_typeof(${t.definition})='object'`),
}));
export const businessMetricTargetApprovals = pgTable("business_metric_target_approvals", {
  companyId: uuid("company_id").notNull(), targetId: uuid("target_id").notNull(), versionId: uuid("version_id").notNull(),
  approvedBy: text("approved_by").notNull(), rationale: text("rationale").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  versionUq: unique("business_metric_target_approvals_version_uq").on(t.companyId, t.targetId, t.versionId),
  versionFk: foreignKey({ name: "business_metric_target_approvals_version_fk", columns: [t.companyId, t.targetId, t.versionId], foreignColumns: [businessMetricTargetVersions.companyId, businessMetricTargetVersions.targetId, businessMetricTargetVersions.id] }).onDelete("cascade"),
}));
