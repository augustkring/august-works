import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import type { BusinessScenarioCapturedInput, BusinessScenarioDefinition, NativeBusinessScenarioResult } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { analyticalLineageManifests } from "./analytical_lineage.js";
import { businessMetricObservations } from "./business_metrics.js";
import { forecastRuns } from "./business_forecasting.js";

export const businessScenarios = pgTable("business_scenarios", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  key: text("scenario_key").notNull(), revision: integer("revision").notNull().default(1), status: text("status").$type<"draft" | "published" | "retired">().notNull().default("draft"),
  publishedVersionId: uuid("published_version_id"), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t): PgTableExtraConfigValue[] => [
  unique("business_scenarios_tenant_uq").on(t.companyId, t.id), unique("business_scenarios_key_uq").on(t.companyId, t.key),
  foreignKey({ name: "business_scenarios_published_fk", columns: [t.companyId, t.id, t.publishedVersionId], foreignColumns: [businessScenarioVersions.companyId, businessScenarioVersions.scenarioId, businessScenarioVersions.id] }).onDelete("cascade"),
  check("business_scenarios_state_check", sql`${t.revision}>0 and ${t.status} in ('draft','published','retired') and (${t.status}<>'published' or ${t.publishedVersionId} is not null)`),
]);
export const businessScenarioVersions = pgTable("business_scenario_versions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), scenarioId: uuid("scenario_id").notNull(), revision: integer("revision").notNull(),
  definition: jsonb("definition_json").$type<BusinessScenarioDefinition>().notNull(), contentHash: text("content_hash").notNull(), inputHash: text("input_hash").notNull(),
  inputs: jsonb("inputs_json").$type<BusinessScenarioCapturedInput[]>().notNull(), lineageManifestId: uuid("lineage_manifest_id").notNull(), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => ({
  tenantUq: unique("business_scenario_versions_tenant_uq").on(t.companyId, t.scenarioId, t.id), revisionUq: unique("business_scenario_versions_revision_uq").on(t.companyId, t.scenarioId, t.revision),
  rootFk: foreignKey({ name: "business_scenario_versions_root_fk", columns: [t.companyId, t.scenarioId], foreignColumns: [businessScenarios.companyId, businessScenarios.id] }).onDelete("cascade"),
  lineageFk: foreignKey({ name: "business_scenario_versions_lineage_fk", columns: [t.companyId, t.lineageManifestId], foreignColumns: [analyticalLineageManifests.companyId, analyticalLineageManifests.id] }).onDelete("cascade"),
  contentCheck: check("business_scenario_versions_content_check", sql`${t.revision}>0 and ${t.contentHash} ~ '^[0-9a-f]{64}$' and ${t.inputHash} ~ '^[0-9a-f]{64}$' and jsonb_typeof(${t.definition})='object' and jsonb_typeof(${t.inputs})='array' and ${t.expiresAt}>${t.createdAt}`),
}));
/** Source-owner cascades erase the dependent proposal including its prose. */
export const businessScenarioSourcePins = pgTable("business_scenario_source_pins", {
  companyId: uuid("company_id").notNull(), scenarioId: uuid("scenario_id").notNull(), versionId: uuid("version_id").notNull(), inputKey: text("input_key").notNull(),
  metricObservationId: uuid("metric_observation_id"), forecastRunId: uuid("forecast_run_id"),
}, t => ({
  inputUq: unique("business_scenario_source_pins_input_uq").on(t.companyId, t.scenarioId, t.versionId, t.inputKey),
  versionFk: foreignKey({ name: "business_scenario_source_pins_version_fk", columns: [t.companyId, t.scenarioId, t.versionId], foreignColumns: [businessScenarioVersions.companyId, businessScenarioVersions.scenarioId, businessScenarioVersions.id] }).onDelete("cascade"),
  metricFk: foreignKey({ name: "business_scenario_source_pins_metric_fk", columns: [t.companyId, t.metricObservationId], foreignColumns: [businessMetricObservations.companyId, businessMetricObservations.id] }).onDelete("cascade"),
  forecastFk: foreignKey({ name: "business_scenario_source_pins_forecast_fk", columns: [t.companyId, t.forecastRunId], foreignColumns: [forecastRuns.companyId, forecastRuns.id] }).onDelete("cascade"),
  typeCheck: check("business_scenario_source_pins_type_check", sql`(${t.metricObservationId} is null) <> (${t.forecastRunId} is null)`),
}));
export const businessScenarioPublications = pgTable("business_scenario_publications", {
  companyId: uuid("company_id").notNull(), scenarioId: uuid("scenario_id").notNull(), versionId: uuid("version_id").notNull(),
  publishedBy: text("published_by").notNull(), rationale: text("rationale").notNull(), publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
}, t => ({
  versionUq: unique("business_scenario_publications_version_uq").on(t.companyId, t.scenarioId, t.versionId),
  versionFk: foreignKey({ name: "business_scenario_publications_version_fk", columns: [t.companyId, t.scenarioId, t.versionId], foreignColumns: [businessScenarioVersions.companyId, businessScenarioVersions.scenarioId, businessScenarioVersions.id] }).onDelete("cascade"),
  rationaleCheck: check("business_scenario_publications_rationale_check", sql`length(btrim(${t.rationale})) between 10 and 2000`),
}));
export const businessScenarioRuns = pgTable("business_scenario_runs", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), scenarioId: uuid("scenario_id").notNull(), versionId: uuid("version_id").notNull(),
  lineageManifestId: uuid("lineage_manifest_id").notNull(), definitionHash: text("definition_hash").notNull(), inputHash: text("input_hash").notNull(), contentHash: text("content_hash").notNull(),
  result: jsonb("result_json").$type<NativeBusinessScenarioResult>().notNull(), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => ({
  tenantUq: unique("business_scenario_runs_tenant_uq").on(t.companyId, t.id),
  versionFk: foreignKey({ name: "business_scenario_runs_version_fk", columns: [t.companyId, t.scenarioId, t.versionId], foreignColumns: [businessScenarioVersions.companyId, businessScenarioVersions.scenarioId, businessScenarioVersions.id] }).onDelete("cascade"),
  lineageFk: foreignKey({ name: "business_scenario_runs_lineage_fk", columns: [t.companyId, t.lineageManifestId], foreignColumns: [analyticalLineageManifests.companyId, analyticalLineageManifests.id] }).onDelete("cascade"),
  contentCheck: check("business_scenario_runs_content_check", sql`${t.definitionHash} ~ '^[0-9a-f]{64}$' and ${t.inputHash} ~ '^[0-9a-f]{64}$' and ${t.contentHash} ~ '^[0-9a-f]{64}$' and jsonb_typeof(${t.result})='object' and ${t.expiresAt}>${t.createdAt}`),
  timeIdx: index("business_scenario_runs_time_idx").on(t.companyId, t.scenarioId, t.createdAt, t.id),
}));
