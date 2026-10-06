import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import type { BusinessMetricDefinition, BusinessMetricResult, BusinessMetricView } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { analyticalLineageManifests } from "./analytical_lineage.js";

export const businessMetrics = pgTable("business_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  key: text("metric_key").notNull(), revision: integer("revision").notNull().default(1),
  status: text("status").$type<BusinessMetricView["status"]>().notNull().default("draft"),
  publishedVersionId: uuid("published_version_id"), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t): PgTableExtraConfigValue[] => [
  unique("business_metrics_company_id_uq").on(t.companyId, t.id),
  unique("business_metrics_company_key_uq").on(t.companyId, t.key),
  foreignKey({ name: "business_metrics_published_version_fk", columns: [t.companyId, t.id, t.publishedVersionId],
    foreignColumns: [businessMetricVersions.companyId, businessMetricVersions.metricId, businessMetricVersions.id] }),
  check("business_metrics_revision_check", sql`${t.revision} > 0`),
  check("business_metrics_status_check", sql`${t.status} in ('draft','published','deprecated','revoked')`),
  check("business_metrics_publication_check", sql`${t.status} <> 'published' or ${t.publishedVersionId} is not null`),
]);

/** Definition bytes are insert-only; PostgreSQL rejects version updates. Publication
 * pointers are separate so historical definitions never need mutation. */
export const businessMetricVersions = pgTable("business_metric_versions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(),
  metricId: uuid("metric_id").notNull(), revision: integer("revision").notNull(),
  definition: jsonb("definition_json").$type<BusinessMetricDefinition>().notNull(),
  contentHash: text("content_hash").notNull(), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t): PgTableExtraConfigValue[] => [
  unique("business_metric_versions_tenant_metric_id_uq").on(t.companyId, t.metricId, t.id),
  unique("business_metric_versions_tenant_id_uq").on(t.companyId, t.id),
  unique("business_metric_versions_revision_uq").on(t.companyId, t.metricId, t.revision),
  foreignKey({ name: "business_metric_versions_metric_fk", columns: [t.companyId, t.metricId], foreignColumns: [businessMetrics.companyId, businessMetrics.id] }).onDelete("cascade"),
  check("business_metric_versions_revision_check", sql`${t.revision}>0`),
  check("business_metric_versions_hash_check", sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
  check("business_metric_versions_definition_check", sql`jsonb_typeof(${t.definition})='object'`),
]);

export const businessMetricPublications = pgTable("business_metric_publications", {
  companyId: uuid("company_id").notNull(), metricId: uuid("metric_id").notNull(),
  versionId: uuid("version_id").notNull(), publishedBy: text("published_by").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  versionUq: unique("business_metric_publications_version_uq").on(t.companyId, t.metricId, t.versionId),
  versionFk: foreignKey({ name: "business_metric_publications_version_fk", columns: [t.companyId, t.metricId, t.versionId],
    foreignColumns: [businessMetricVersions.companyId, businessMetricVersions.metricId, businessMetricVersions.id] }).onDelete("cascade"),
}));

export const businessMetricObservations = pgTable("business_metric_observations", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(),
  metricId: uuid("metric_id").notNull(), versionId: uuid("version_id").notNull(),
  result: jsonb("result_json").$type<BusinessMetricResult>().notNull(),
  definitionHash: text("definition_hash").notNull(), inputHash: text("input_hash").notNull(),
  lineageManifestId: uuid("lineage_manifest_id").notNull(), requestedBy: text("requested_by").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => ({
  tenantUq: unique("business_metric_observations_tenant_id_uq").on(t.companyId, t.id),
  versionFk: foreignKey({ name: "business_metric_observations_version_fk", columns: [t.companyId, t.metricId, t.versionId],
    foreignColumns: [businessMetricVersions.companyId, businessMetricVersions.metricId, businessMetricVersions.id] }).onDelete("cascade"),
  lineageFk: foreignKey({ name: "business_metric_observations_lineage_fk", columns: [t.companyId, t.lineageManifestId],
    foreignColumns: [analyticalLineageManifests.companyId, analyticalLineageManifests.id] }).onDelete("cascade"),
  hashCheck: check("business_metric_observations_hash_check", sql`${t.definitionHash} ~ '^[0-9a-f]{64}$' and ${t.inputHash} ~ '^[0-9a-f]{64}$'`),
  expiryCheck: check("business_metric_observations_expiry_check", sql`${t.expiresAt}>${t.observedAt}`),
  companyTimeIdx: index("business_metric_observations_company_time_idx").on(t.companyId, t.observedAt, t.id),
}));
