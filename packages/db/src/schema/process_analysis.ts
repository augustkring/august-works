import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, type PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import type { NativeProcessAnalysisResult, ProcessAnalysisDefinition } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { analyticalLineageManifests } from "./analytical_lineage.js";

export const processAnalysisDefinitions = pgTable("process_analysis_definitions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  key: text("definition_key").notNull(), revision: integer("revision").notNull().default(1),
  status: text("status").$type<"draft" | "published" | "retired">().notNull().default("draft"), publishedVersionId: uuid("published_version_id"),
  createdBy: text("created_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t): PgTableExtraConfigValue[] => [
  unique("process_definitions_tenant_id_uq").on(t.companyId, t.id), unique("process_definitions_key_uq").on(t.companyId, t.key),
  foreignKey({ name: "process_definitions_published_fk", columns: [t.companyId, t.id, t.publishedVersionId], foreignColumns: [processAnalysisVersions.companyId, processAnalysisVersions.definitionId, processAnalysisVersions.id] }).onDelete("cascade"),
  check("process_definitions_state_check", sql`${t.revision}>0 and ${t.status} in ('draft','published','retired') and (${t.status}<>'published' or ${t.publishedVersionId} is not null)`),
]);
export const processAnalysisVersions = pgTable("process_analysis_versions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), definitionId: uuid("definition_id").notNull(), revision: integer("revision").notNull(),
  definition: jsonb("definition_json").$type<ProcessAnalysisDefinition>().notNull(), contentHash: text("content_hash").notNull(), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), nextReviewAt: timestamp("next_review_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => ({
  tenantIdUq: unique("process_versions_tenant_id_uq").on(t.companyId, t.definitionId, t.id), revisionUq: unique("process_versions_revision_uq").on(t.companyId, t.definitionId, t.revision),
  rootFk: foreignKey({ name: "process_versions_definition_fk", columns: [t.companyId, t.definitionId], foreignColumns: [processAnalysisDefinitions.companyId, processAnalysisDefinitions.id] }).onDelete("cascade"),
  definitionCheck: check("process_versions_definition_check", sql`${t.revision}>0 and ${t.contentHash} ~ '^[0-9a-f]{64}$' and jsonb_typeof(${t.definition})='object' and ${t.nextReviewAt}>${t.createdAt} and ${t.expiresAt}>${t.createdAt}`),
}));
export const processAnalysisPublications = pgTable("process_analysis_publications", {
  companyId: uuid("company_id").notNull(), definitionId: uuid("definition_id").notNull(), versionId: uuid("version_id").notNull(),
  publishedBy: text("published_by").notNull(), rationale: text("rationale").notNull(), publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  versionUq: unique("process_publications_version_uq").on(t.companyId, t.definitionId, t.versionId),
  versionFk: foreignKey({ name: "process_publications_version_fk", columns: [t.companyId, t.definitionId, t.versionId], foreignColumns: [processAnalysisVersions.companyId, processAnalysisVersions.definitionId, processAnalysisVersions.id] }).onDelete("cascade"),
}));
export const processAnalysisRuns = pgTable("process_analysis_runs", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), definitionId: uuid("definition_id").notNull(), versionId: uuid("version_id").notNull(),
  lineageManifestId: uuid("lineage_manifest_id").notNull(), definitionHash: text("definition_hash").notNull(), eventSetHash: text("event_set_hash").notNull(),
  from: timestamp("from_time", { withTimezone: true }).notNull(), until: timestamp("until_time", { withTimezone: true }).notNull(),
  result: jsonb("result_json").$type<NativeProcessAnalysisResult>().notNull(), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => ({
  tenantUq: unique("process_runs_tenant_id_uq").on(t.companyId, t.id), lineageUq: unique("process_runs_lineage_uq").on(t.companyId, t.lineageManifestId),
  versionFk: foreignKey({ name: "process_runs_version_fk", columns: [t.companyId, t.definitionId, t.versionId], foreignColumns: [processAnalysisVersions.companyId, processAnalysisVersions.definitionId, processAnalysisVersions.id] }).onDelete("cascade"),
  lineageFk: foreignKey({ name: "process_runs_lineage_fk", columns: [t.companyId, t.lineageManifestId], foreignColumns: [analyticalLineageManifests.companyId, analyticalLineageManifests.id] }).onDelete("cascade"),
  boundsCheck: check("process_runs_bounds_check", sql`${t.definitionHash} ~ '^[0-9a-f]{64}$' and ${t.eventSetHash} ~ '^[0-9a-f]{64}$' and ${t.from}<${t.until} and ${t.expiresAt}>${t.createdAt} and jsonb_typeof(${t.result})='object'`),
  companyTimeIdx: index("process_runs_company_time_idx").on(t.companyId, t.createdAt, t.id),
}));
