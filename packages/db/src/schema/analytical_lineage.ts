import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const analyticalLineageManifests = pgTable("analytical_lineage_manifests", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  analysisType: text("analysis_type").notNull(), analysisRef: uuid("analysis_ref").notNull(),
  engineVersion: text("engine_version").notNull(), inputHash: text("input_hash").notNull(),
  definitionHash: text("definition_hash").notNull(), requestedBy: text("requested_by").notNull(),
  sourceWatermark: text("source_watermark").notNull(), sourceCount: integer("source_count").notNull(),
  parameters: jsonb("parameters_json").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => ({
  tenantUq: unique("analytical_lineage_manifests_tenant_id_uq").on(t.companyId, t.id),
  hashCheck: check("analytical_lineage_manifests_hash_check", sql`${t.inputHash} ~ '^[0-9a-f]{64}$' and ${t.definitionHash} ~ '^[0-9a-f]{64}$'`),
  expiryCheck: check("analytical_lineage_manifests_expiry_check", sql`${t.expiresAt}>${t.createdAt}`),
  countCheck: check("analytical_lineage_manifests_count_check", sql`${t.sourceCount}>=0`),
  companyTimeIdx: index("analytical_lineage_manifests_company_time_idx").on(t.companyId, t.createdAt, t.id),
}));

/** Source refs preserve historical analytical identity; resolving a ref never
 * grants source access. Native owner erasure removes dependent manifests. */
export const analyticalLineageEdges = pgTable("analytical_lineage_edges", {
  companyId: uuid("company_id").notNull(), manifestId: uuid("manifest_id").notNull(),
  inputType: text("input_type").$type<"issue" | "project" | "metric_version" | "governance_obligation" | "business_event_source">().notNull(),
  inputRef: uuid("input_ref").notNull(), inputHash: text("input_hash").notNull(),
  relationship: text("relationship").$type<"source" | "definition" | "policy">().notNull(),
}, (t) => ({
  manifestFk: foreignKey({ name: "analytical_lineage_edges_manifest_fk", columns: [t.companyId, t.manifestId],
    foreignColumns: [analyticalLineageManifests.companyId, analyticalLineageManifests.id] }).onDelete("cascade"),
  edgeUq: unique("analytical_lineage_edges_input_uq").on(t.companyId, t.manifestId, t.inputType, t.inputRef),
  sourceIdx: index("analytical_lineage_edges_source_idx").on(t.companyId, t.inputType, t.inputRef),
  typeCheck: check("analytical_lineage_edges_type_check", sql`${t.inputType} in ('issue','project','metric_version','governance_obligation','business_event_source') and ${t.relationship} in ('source','definition','policy')`),
  hashCheck: check("analytical_lineage_edges_hash_check", sql`${t.inputHash} ~ '^[0-9a-f]{64}$'`),
}));

/** Minimal native-owner erasure guards survive backup replay. No source payload
 * or analytical result is retained here. Company erasure owns their lifecycle. */
export const analyticalSourceSuppressions = pgTable("analytical_source_suppressions", {
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  inputType: text("input_type").$type<"issue" | "project" | "goal" | "document" | "document_revision">().notNull(),
  inputRef: uuid("input_ref").notNull(),
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sourceUq: unique("analytical_source_suppressions_source_uq").on(t.companyId, t.inputType, t.inputRef),
  typeCheck: check("analytical_source_suppressions_type_check", sql`${t.inputType} in ('issue','project','goal','document','document_revision')`),
}));
