import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, doublePrecision, unique, foreignKey, check, index } from "drizzle-orm/pg-core";
import type { EvidenceSensitivity } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { memoryRecords } from "./memory.js";
const timestamps = () => ({ createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow() });
export const memoryObservations = pgTable("memory_observations", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  observationKey: text("observation_key").notNull(), scopeType: text("scope_type").notNull(), scopeId: text("scope_id"), purpose: text("purpose").notNull(),
  content: text("content").notNull(), status: text("status").notNull().default("candidate"), version: integer("version").notNull().default(1),
  confidence: doublePrecision("confidence").notNull(), sensitivity: text("sensitivity").$type<EvidenceSensitivity>().notNull(),
  supportCount: integer("support_count").notNull(), contradictionCount: integer("contradiction_count").notNull(), independentSourceCount: integer("independent_source_count").notNull(),
  reviewedByUserId: text("reviewed_by_user_id"), reviewedAt: timestamp("reviewed_at", { withTimezone: true }), revokedAt: timestamp("revoked_at", { withTimezone: true }), erasedAt: timestamp("erased_at", { withTimezone: true }), ...timestamps(),
}, (t) => ({ tenantUq: unique("observations_company_id_uq").on(t.companyId, t.id),
  scopeCheck: check("observations_scope_check", sql`(${t.scopeType}='company' and ${t.scopeId} is null) or (${t.scopeType} in ('project','subject') and ${t.scopeId} is not null)`),
  statusCheck: check("observations_status_check", sql`${t.status} in ('candidate','accepted','needs_review','rejected','superseded','revoked','expired')`),
  confidenceCheck: check("observations_confidence_check", sql`${t.confidence} between 0 and 1`),
  versionCheck: check("observations_version_check", sql`${t.version} > 0`),
  countsCheck: check("observations_counts_check", sql`${t.supportCount} >= 0 and ${t.contradictionCount} >= 0 and ${t.independentSourceCount} >= 0`),
  sensitivityCheck: check("observations_sensitivity_check", sql`${t.sensitivity} in ('public','internal','confidential','restricted')`),
  statusIdx: index("observations_company_status_idx").on(t.companyId, t.status),
}));
export const memoryObservationEvidence = pgTable("memory_observation_evidence", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), observationId: uuid("observation_id").notNull(),
  memoryRecordId: uuid("memory_record_id").notNull(), sourceVersion: text("source_version").notNull(), relationship: text("relationship").notNull(), rootFingerprint: text("root_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ observationFk: foreignKey({ name: "observation_evidence_observation_fk", columns: [t.companyId, t.observationId], foreignColumns: [memoryObservations.companyId, memoryObservations.id] }).onDelete("cascade"),
  memoryFk: foreignKey({ name: "observation_evidence_memory_fk", columns: [t.companyId, t.memoryRecordId], foreignColumns: [memoryRecords.companyId, memoryRecords.id] }).onDelete("cascade"),
  rootUq: unique("observation_evidence_root_uq").on(t.observationId, t.memoryRecordId),
  relationCheck: check("observation_evidence_relation_check", sql`${t.relationship} in ('supports','contradicts','context')`),
}));
export const memoryModels = pgTable("memory_models", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  modelKey: text("model_key").notNull(), name: text("name").notNull(), scopeType: text("scope_type").notNull(), scopeId: text("scope_id"), purpose: text("purpose").notNull(), sourceQuery: text("source_query").notNull(),
  content: text("content").notNull(), status: text("status").notNull().default("candidate"), version: integer("version").notNull().default(1), confidence: doublePrecision("confidence").notNull(),
  sensitivity: text("sensitivity").$type<EvidenceSensitivity>().notNull(), sourceWatermark: text("source_watermark").notNull(),
  reviewedByUserId: text("reviewed_by_user_id"), reviewedAt: timestamp("reviewed_at", { withTimezone: true }), lastRebuiltAt: timestamp("last_rebuilt_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }), erasedAt: timestamp("erased_at", { withTimezone: true }), ...timestamps(),
}, (t) => ({ tenantUq: unique("models_company_id_uq").on(t.companyId, t.id), keyUq: unique("models_company_key_uq").on(t.companyId, t.modelKey),
  scopeCheck: check("models_scope_check", sql`(${t.scopeType}='company' and ${t.scopeId} is null) or (${t.scopeType} in ('project','subject') and ${t.scopeId} is not null)`),
  statusCheck: check("models_status_check", sql`${t.status} in ('candidate','active','needs_rebuild','degraded','superseded','revoked')`),
  confidenceCheck: check("models_confidence_check", sql`${t.confidence} between 0 and 1`), statusIdx: index("models_company_status_idx").on(t.companyId, t.status),
  versionCheck: check("models_version_check", sql`${t.version} > 0`),
  sensitivityCheck: check("models_sensitivity_check", sql`${t.sensitivity} in ('public','internal','confidential','restricted')`),
}));
export const memoryModelVersions = pgTable("memory_model_versions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), modelId: uuid("model_id").notNull(), version: integer("version").notNull(),
  content: text("content").notNull(), sourceWatermark: text("source_watermark").notNull(), erasedAt: timestamp("erased_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ modelFk: foreignKey({ name: "model_versions_model_fk", columns: [t.companyId, t.modelId], foreignColumns: [memoryModels.companyId, memoryModels.id] }).onDelete("cascade"),
  versionUq: unique("model_versions_company_model_version_uq").on(t.companyId, t.modelId, t.version),
  versionCheck: check("model_versions_version_check", sql`${t.version} > 0`),
}));
export const memoryModelEvidence = pgTable("memory_model_evidence", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), modelId: uuid("model_id").notNull(), modelVersion: integer("model_version").notNull(),
  memoryRecordId: uuid("memory_record_id").notNull(), observationId: uuid("observation_id"), observationVersion: integer("observation_version"), sourceVersion: text("source_version").notNull(),
  relationship: text("relationship").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ modelVersionFk: foreignKey({ name: "model_evidence_version_fk", columns: [t.companyId, t.modelId, t.modelVersion], foreignColumns: [memoryModelVersions.companyId, memoryModelVersions.modelId, memoryModelVersions.version] }).onDelete("cascade"),
  memoryFk: foreignKey({ name: "model_evidence_memory_fk", columns: [t.companyId, t.memoryRecordId], foreignColumns: [memoryRecords.companyId, memoryRecords.id] }).onDelete("cascade"),
  observationFk: foreignKey({ name: "model_evidence_observation_fk", columns: [t.companyId, t.observationId], foreignColumns: [memoryObservations.companyId, memoryObservations.id] }).onDelete("cascade"),
  observationCheck: check("model_evidence_observation_check", sql`(${t.observationId} is null) = (${t.observationVersion} is null)`),
  relationCheck: check("model_evidence_relation_check", sql`${t.relationship} in ('supports','contradicts','context','derived_from')`),
}));
