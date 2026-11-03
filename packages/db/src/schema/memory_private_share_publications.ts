import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { memoryBindings, memoryRecords } from "./memory.js";
import { companies } from "./companies.js";

/** Internal receipt for the one explicit path that publishes an Agent-private
 * Memory row into an authorized shared scope. Never returned by public DTOs. */
export const memoryPrivateSharePublications = pgTable("memory_private_share_publications", {
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sharedRecordId: uuid("shared_record_id").notNull(),
  sourceRecordId: uuid("source_record_id").notNull(),
  sourceOwnerUserId: text("source_owner_user_id"),
  targetBindingId: uuid("target_binding_id").notNull(),
  targetScopeType: text("target_scope_type").notNull(),
  targetScopeId: text("target_scope_id"),
  sourceVersion: text("source_version").notNull(),
  sourceFingerprint: text("source_fingerprint").notNull(),
  sharedFingerprint: text("shared_fingerprint").notNull(),
  operationFingerprint: text("operation_fingerprint").notNull(),
  state: text("state").$type<"pending" | "published" | "rejected">().notNull().default("pending"),
  proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedByUserId: text("published_by_user_id"),
}, (table) => ({
  pk: primaryKey({ columns: [table.companyId, table.sharedRecordId], name: "memory_private_share_publications_pk" }),
  sourceFk: foreignKey({ name: "memory_private_share_publications_source_fk", columns: [table.companyId, table.sourceRecordId],
    foreignColumns: [memoryRecords.companyId, memoryRecords.id] }).onDelete("cascade"),
  sharedFk: foreignKey({ name: "memory_private_share_publications_shared_fk", columns: [table.companyId, table.sharedRecordId],
    foreignColumns: [memoryRecords.companyId, memoryRecords.id] }).onDelete("cascade"),
  bindingFk: foreignKey({ name: "memory_private_share_publications_binding_fk", columns: [table.companyId, table.targetBindingId],
    foreignColumns: [memoryBindings.companyId, memoryBindings.id] }).onDelete("cascade"),
  operationUq: uniqueIndex("memory_private_share_publications_operation_uq").on(table.companyId, table.operationFingerprint),
  sourceIdx: index("memory_private_share_publications_source_idx").on(table.companyId, table.sourceRecordId),
  stateCheck: check("memory_private_share_publications_state_check", sql`${table.state} in ('pending','published','rejected')`),
  scopeCheck: check("memory_private_share_publications_scope_check",
    sql`(${table.targetScopeType} = 'company' and ${table.targetScopeId} is null) or (${table.targetScopeType} in ('project','subject') and ${table.targetScopeId} is not null)`),
  fingerprintCheck: check("memory_private_share_publications_fingerprint_check",
    sql`${table.sourceFingerprint} ~ '^[0-9a-f]{64}$' and ${table.sharedFingerprint} ~ '^[0-9a-f]{64}$' and ${table.operationFingerprint} ~ '^[0-9a-f]{64}$'`),
  distinctRecordsCheck: check("memory_private_share_publications_distinct_records_check", sql`${table.sourceRecordId} <> ${table.sharedRecordId}`),
  publishedCheck: check("memory_private_share_publications_published_check",
    sql`(${table.state} = 'published' and ${table.publishedAt} is not null and ${table.publishedByUserId} is not null
        and ${table.sourceOwnerUserId} is not null and ${table.publishedByUserId} = ${table.sourceOwnerUserId})
      or (${table.state} <> 'published' and ${table.publishedAt} is null and ${table.publishedByUserId} is null)`),
}));
