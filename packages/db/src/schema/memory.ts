import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { EvidenceCitation } from "@paperclipai/shared";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

export const memoryBindings = pgTable(
  "memory_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    providerKey: text("provider_key").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdIdUq: uniqueIndex("memory_bindings_company_id_id_uq").on(table.companyId, table.id),
    companyKeyUq: uniqueIndex("memory_bindings_company_key_uq").on(table.companyId, table.key),
    companyEnabledIdx: index("memory_bindings_company_enabled_idx").on(table.companyId, table.enabled),
  }),
);

export const memoryBindingTargets = pgTable(
  "memory_binding_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bindingId: uuid("binding_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyBindingFk: foreignKey({
      name: "memory_binding_targets_company_binding_fk",
      columns: [table.companyId, table.bindingId],
      foreignColumns: [memoryBindings.companyId, memoryBindings.id],
    }).onDelete("cascade"),
    bindingTargetUq: uniqueIndex("memory_binding_targets_binding_target_uq").on(
      table.bindingId,
      table.targetType,
      table.targetId,
    ),
    companyTargetIdx: index("memory_binding_targets_company_target_idx").on(
      table.companyId,
      table.targetType,
      table.targetId,
    ),
    targetTypeCheck: check(
      "memory_binding_targets_target_type_check",
      sql`${table.targetType} in ('company', 'agent', 'project')`,
    ),
  }),
);

export const memoryRecords = pgTable(
  "memory_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bindingId: uuid("binding_id").notNull(),
    providerKey: text("provider_key").notNull(),

    memoryType: text("memory_type").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id"),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id, { onDelete: "restrict" }),

    title: text("title"),
    content: text("content").notNull(),
    summary: text("summary"),

    reviewState: text("review_state").notNull().default("pending"),
    verificationState: text("verification_state").notNull().default("unverified"),
    sensitivityLabel: text("sensitivity_label").notNull().default("internal"),

    importance: integer("importance").notNull().default(50),
    confidenceScore: doublePrecision("confidence_score").notNull().default(0.5),

    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),

    retentionPolicy: text("retention_policy").notNull().default("standard"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    retentionState: text("retention_state").notNull().default("active"),

    supersedesRecordId: uuid("supersedes_record_id"),
    supersededByRecordId: uuid("superseded_by_record_id"),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByActorType: text("revoked_by_actor_type"),
    revokedByActorId: text("revoked_by_actor_id"),
    revocationReason: text("revocation_reason"),

    createdByActorType: text("created_by_actor_type").notNull(),
    createdByActorId: text("created_by_actor_id").notNull(),
    createdByOperationId: text("created_by_operation_id"),

    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    companyIdIdUq: uniqueIndex("memory_records_company_id_id_uq").on(table.companyId, table.id),
    companyBindingFk: foreignKey({
      name: "memory_records_company_binding_fk",
      columns: [table.companyId, table.bindingId],
      foreignColumns: [memoryBindings.companyId, memoryBindings.id],
    }).onDelete("restrict"),
    supersedesFk: foreignKey({
      name: "memory_records_supersedes_fk",
      columns: [table.companyId, table.supersedesRecordId],
      foreignColumns: [table.companyId, table.id],
    }).onDelete("restrict"),
    supersededByFk: foreignKey({
      name: "memory_records_superseded_by_fk",
      columns: [table.companyId, table.supersededByRecordId],
      foreignColumns: [table.companyId, table.id],
    }).onDelete("restrict"),
    companyReviewRetentionIdx: index("memory_records_company_review_retention_idx").on(
      table.companyId,
      table.reviewState,
      table.retentionState,
    ),
    companyScopeIdx: index("memory_records_company_scope_idx").on(
      table.companyId,
      table.scopeType,
      table.scopeId,
    ),
    companySubjectIdx: index("memory_records_company_subject_idx").on(
      table.companyId,
      table.subjectType,
      table.subjectId,
    ),
    companyObservedIdx: index("memory_records_company_observed_idx").on(
      table.companyId,
      table.observedAt.desc(),
    ),
    companyValidityIdx: index("memory_records_company_validity_idx").on(
      table.companyId,
      table.validFrom,
      table.validUntil,
    ),
    companySupersededIdx: index("memory_records_company_superseded_idx").on(
      table.companyId,
      table.supersededByRecordId,
    ),
    searchIdx: index("memory_records_search_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${table.title}, '') || ' ' || ${table.content} || ' ' || coalesce(${table.summary}, ''))`,
    ),
    memoryTypeCheck: check(
      "memory_records_memory_type_check",
      sql`${table.memoryType} in ('fact','observation','decision_reference','preference','lesson','outcome','relationship','constraint')`,
    ),
    scopeTypeCheck: check(
      "memory_records_scope_type_check",
      sql`${table.scopeType} in ('company','agent','project','subject')`,
    ),
    scopeShapeCheck: check(
      "memory_records_scope_shape_check",
      sql`(${table.scopeType} = 'company' and ${table.scopeId} is null) or (${table.scopeType} <> 'company' and ${table.scopeId} is not null)`,
    ),
    privateSharedCheck: check(
      "memory_records_private_shared_check",
      sql`(${table.scopeType} = 'agent' and ${table.ownerAgentId} is not null and ${table.scopeId} = ${table.ownerAgentId}::text) or (${table.scopeType} <> 'agent' and ${table.ownerAgentId} is null)`,
    ),
    subjectShapeCheck: check(
      "memory_records_subject_shape_check",
      sql`num_nonnulls(${table.subjectType}, ${table.subjectId}) in (0, 2)`,
    ),
    reviewStateCheck: check(
      "memory_records_review_state_check",
      sql`${table.reviewState} in ('pending','accepted','rejected')`,
    ),
    verificationStateCheck: check(
      "memory_records_verification_state_check",
      sql`${table.verificationState} in ('unverified','corroborated','human_verified','system_verified')`,
    ),
    sensitivityCheck: check(
      "memory_records_sensitivity_check",
      sql`${table.sensitivityLabel} in ('public','internal','confidential','restricted')`,
    ),
    retentionStateCheck: check(
      "memory_records_retention_state_check",
      sql`${table.retentionState} in ('active','expired')`,
    ),
    importanceCheck: check(
      "memory_records_importance_check",
      sql`${table.importance} between 0 and 100`,
    ),
    confidenceCheck: check(
      "memory_records_confidence_check",
      sql`${table.confidenceScore} between 0 and 1`,
    ),
    validityCheck: check(
      "memory_records_validity_check",
      sql`${table.validUntil} is null or ${table.validFrom} is null or ${table.validUntil} > ${table.validFrom}`,
    ),
    expiryCheck: check(
      "memory_records_expiry_check",
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.observedAt}`,
    ),
    revocationCheck: check(
      "memory_records_revocation_check",
      sql`(${table.revokedAt} is null and ${table.revokedByActorType} is null and ${table.revokedByActorId} is null and ${table.revocationReason} is null) or (${table.revokedAt} is not null and ${table.revokedByActorType} is not null and ${table.revokedByActorId} is not null and ${table.revocationReason} is not null)`,
    ),
    createdActorTypeCheck: check(
      "memory_records_created_actor_type_check",
      sql`${table.createdByActorType} in ('user','agent','system')`,
    ),
    revokedActorTypeCheck: check(
      "memory_records_revoked_actor_type_check",
      sql`${table.revokedByActorType} is null or ${table.revokedByActorType} in ('user','agent','system')`,
    ),
  }),
);

export const memoryEvidence = pgTable(
  "memory_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    memoryRecordId: uuid("memory_record_id").notNull(),

    sourceClass: text("source_class").notNull(),
    sourceProvider: text("source_provider").notNull(),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    sourceVersion: text("source_version"),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    excerptHash: text("excerpt_hash").notNull(),
    citationJson: jsonb("citation_json").$type<EvidenceCitation>().notNull(),
    trustLevel: text("trust_level").notNull(),
    supportsOrContradicts: text("supports_or_contradicts").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyRecordFk: foreignKey({
      name: "memory_evidence_company_record_fk",
      columns: [table.companyId, table.memoryRecordId],
      foreignColumns: [memoryRecords.companyId, memoryRecords.id],
    }).onDelete("restrict"),
    recordIdx: index("memory_evidence_memory_record_idx").on(table.memoryRecordId),
    companySourceIdx: index("memory_evidence_company_source_idx").on(
      table.companyId,
      table.sourceProvider,
      table.sourceRef,
    ),
    sourceClassCheck: check(
      "memory_evidence_source_class_check",
      sql`${table.sourceClass} in ('foundation','system_of_record','accepted_memory','private_memory','task','artifact','conversation','external_untrusted')`,
    ),
    trustLevelCheck: check(
      "memory_evidence_trust_level_check",
      sql`${table.trustLevel} in ('high','medium','low','untrusted')`,
    ),
    relationCheck: check(
      "memory_evidence_relation_check",
      sql`${table.supportsOrContradicts} in ('supports','contradicts','context')`,
    ),
    excerptHashCheck: check(
      "memory_evidence_excerpt_hash_check",
      sql`${table.excerptHash} ~ '^[0-9a-f]{64}$'`,
    ),
  }),
);
