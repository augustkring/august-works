import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import type { BusinessExperimentDefinition, BusinessExperimentMetricPin, BusinessExperimentState } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { analyticalLineageManifests } from "./analytical_lineage.js";
import { businessMetricVersions } from "./business_metrics.js";
import { decisions } from "./decisions.js";

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
  revisionUq: unique("business_experiment_transitions_revision_uq").on(t.companyId, t.experimentId, t.revision),
  versionFk: foreignKey({ name: "business_experiment_transitions_version_fk", columns: [t.companyId, t.experimentId, t.versionId], foreignColumns: [businessExperimentVersions.companyId, businessExperimentVersions.experimentId, businessExperimentVersions.id] }).onDelete("cascade"),
  contentCheck: check("business_experiment_transitions_content_check", sql`${t.revision}>1 and ${t.fromState}<>${t.toState} and length(btrim(${t.rationale})) between 10 and 2000 and length(btrim(${t.createdBy})) between 1 and 200`),
}));
