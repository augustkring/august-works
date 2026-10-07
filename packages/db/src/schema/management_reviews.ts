import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { CapturedManagementSource, ManagementReviewDefinition, ManagementReviewPacket } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { analyticalLineageManifests } from "./analytical_lineage.js";

/** Historical synthesis, never a parallel Goal/Project/Decision authority. */
export const managementReviewSnapshots = pgTable("management_review_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  status: text("status").$type<"draft" | "published" | "superseded">().notNull().default("draft"),
  definition: jsonb("definition_json").$type<ManagementReviewDefinition>().notNull(),
  sources: jsonb("sources_json").$type<CapturedManagementSource[]>().notNull(),
  packet: jsonb("content_json").$type<ManagementReviewPacket>().notNull(), contentHash: text("content_hash").notNull(),
  lineageManifestId: uuid("lineage_manifest_id").notNull(), signature: text("signature").notNull(),
  createdBy: text("created_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  publishedBy: text("published_by"), publishedAt: timestamp("published_at", { withTimezone: true }),
  publicationRationale: text("publication_rationale"), publicationSignature: text("publication_signature"), supersedesId: uuid("supersedes_id"),
}, (t) => ({
  tenantUq: unique("management_review_snapshots_tenant_uq").on(t.companyId, t.id),
  manifestFk: foreignKey({ name: "management_review_snapshots_manifest_fk", columns: [t.companyId, t.lineageManifestId], foreignColumns: [analyticalLineageManifests.companyId, analyticalLineageManifests.id] }).onDelete("cascade"),
  timeIdx: index("management_review_snapshots_company_time_idx").on(t.companyId, t.createdAt, t.id),
  contentCheck: check("management_review_snapshots_content_check", sql`${t.contentHash} ~ '^[a-f0-9]{64}$' and ${t.signature} ~ '^decision-spec-v1[.][a-f0-9]{64}$' and jsonb_typeof(${t.definition})='object' and jsonb_typeof(${t.sources})='array' and jsonb_array_length(${t.sources}) between 1 and 20 and jsonb_typeof(${t.packet})='object' and ${t.packet}->>'contentHash'=${t.contentHash} and ${t.expiresAt}>${t.createdAt}`),
  stateCheck: check("management_review_snapshots_state_check", sql`(${t.status}='draft' and ${t.publishedBy} is null and ${t.publishedAt} is null and ${t.publicationRationale} is null and ${t.publicationSignature} is null and ${t.supersedesId} is null) or (${t.status} in ('published','superseded') and ${t.publishedBy} is not null and ${t.publishedAt} is not null and length(btrim(${t.publicationRationale})) between 10 and 2000 and ${t.publicationSignature} ~ '^decision-spec-v1[.][a-f0-9]{64}$' and ${t.publishedAt}>=${t.createdAt})`),
}));
/** Extra native primitive dependencies cover Foundation/Goal/Learning sources
 * absent from metric lineage. Each loss erases the whole dependent snapshot. */
export const managementReviewSourceLinks = pgTable("management_review_source_links", {
  companyId: uuid("company_id").notNull(), reviewId: uuid("review_id").notNull(),
  sourceType: text("source_type").$type<"issue" | "project" | "goal" | "document" | "document_revision" | "learning_cycle">().notNull(),
  sourceRef: uuid("source_ref").notNull(), sourceHash: text("source_hash").notNull(),
}, (t) => ({
  sourceUq: unique("management_review_source_links_source_uq").on(t.companyId, t.reviewId, t.sourceType, t.sourceRef),
  reviewFk: foreignKey({ name: "management_review_source_links_review_fk", columns: [t.companyId, t.reviewId], foreignColumns: [managementReviewSnapshots.companyId, managementReviewSnapshots.id] }).onDelete("cascade"),
  sourceIdx: index("management_review_source_links_source_idx").on(t.companyId, t.sourceType, t.sourceRef),
  sourceCheck: check("management_review_source_links_source_check", sql`${t.sourceType} in ('issue','project','goal','document','document_revision','learning_cycle') and ${t.sourceHash} ~ '^[a-f0-9]{64}$'`),
}));
export const managementReviewManifestDependencies = pgTable("management_review_manifest_dependencies", {
  companyId: uuid("company_id").notNull(), reviewId: uuid("review_id").notNull(), sourceManifestId: uuid("source_manifest_id").notNull(),
}, (t) => ({
  sourceUq: unique("management_review_manifest_dependencies_source_uq").on(t.companyId, t.reviewId, t.sourceManifestId),
  reviewFk: foreignKey({ name: "management_review_manifest_dependencies_review_fk", columns: [t.companyId, t.reviewId], foreignColumns: [managementReviewSnapshots.companyId, managementReviewSnapshots.id] }).onDelete("cascade"),
  manifestFk: foreignKey({ name: "management_review_manifest_dependencies_source_fk", columns: [t.companyId, t.sourceManifestId], foreignColumns: [analyticalLineageManifests.companyId, analyticalLineageManifests.id] }).onDelete("cascade"),
}));
export const managementReviewEvents = pgTable("management_review_events", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), reviewId: uuid("review_id").notNull(),
  itemKey: text("item_key").notNull(), event: text("event").$type<"opened" | "ignored" | "acted_on" | "false_alarm" | "correction">().notNull(),
  rationale: text("rationale").notNull(), recordedBy: text("recorded_by").notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  ordinal: integer("ordinal").notNull(), contentHash: text("content_hash").notNull(), signature: text("signature").notNull(),
}, (t) => ({
  reviewFk: foreignKey({ name: "management_review_events_review_fk", columns: [t.companyId, t.reviewId], foreignColumns: [managementReviewSnapshots.companyId, managementReviewSnapshots.id] }).onDelete("cascade"),
  ordinalUq: unique("management_review_events_ordinal_uq").on(t.companyId, t.reviewId, t.ordinal),
  contentCheck: check("management_review_events_content_check", sql`${t.ordinal} between 1 and 100 and ${t.itemKey} ~ '^[a-z][a-z0-9_-]{0,79}$' and ${t.event} in ('opened','ignored','acted_on','false_alarm','correction') and length(btrim(${t.rationale})) between 10 and 2000 and ${t.contentHash} ~ '^[a-f0-9]{64}$' and ${t.signature} ~ '^decision-spec-v1[.][a-f0-9]{64}$'`),
}));
