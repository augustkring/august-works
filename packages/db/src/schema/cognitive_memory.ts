import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, unique, foreignKey, check, index } from "drizzle-orm/pg-core";
import type { CognitiveConformance, EvidenceSensitivity, CognitiveScope } from "@paperclipai/shared";
import { companies } from "./companies.js";
export const cognitiveMemoryBindings = pgTable("cognitive_memory_bindings", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  bindingKey: text("binding_key").notNull(), providerKey: text("provider_key").notNull(),
  scopeType: text("scope_type").$type<CognitiveScope["scopeType"]>().notNull(), scopeId: text("scope_id"),
  mode: text("mode").notNull().default("governed_only"), purpose: text("purpose").notNull(),
  sensitivityCeiling: text("sensitivity_ceiling").$type<EvidenceSensitivity>().notNull().default("internal"),
  approvedPrivateProjection: boolean("approved_private_projection").notNull().default(false),
  status: text("status").notNull().default("active"), capabilitySnapshot: jsonb("capability_snapshot").$type<CognitiveConformance>(), conformanceHash: text("conformance_hash"),
  lastHealthyAt: timestamp("last_healthy_at", { withTimezone: true }), lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ companyIdUq: unique("cognitive_bindings_company_id_uq").on(t.companyId, t.id), keyUq: unique("cognitive_bindings_company_key_uq").on(t.companyId, t.bindingKey),
  modeCheck: check("cognitive_bindings_mode_check", sql`${t.mode} = 'governed_only'`),
  scopeCheck: check("cognitive_bindings_scope_check", sql`(${t.scopeType}='company' and ${t.scopeId} is null) or (${t.scopeType} in ('agent','project','subject') and ${t.scopeId} is not null)`),
  statusCheck: check("cognitive_bindings_status_check", sql`${t.status} in ('active','degraded','disabled')`),
  privateCheck: check("cognitive_bindings_private_check", sql`not ${t.approvedPrivateProjection} or ${t.scopeType}='agent'`),
}));
export const cognitiveProviderOperations = pgTable("cognitive_provider_operations", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), bindingId: uuid("binding_id").notNull(),
  operationType: text("operation_type").notNull(), status: text("status").notNull().default("queued"),
  recordVersions: jsonb("record_versions").$type<Array<{ id: string; version: string }>>().notNull().default([]),
  attemptCount: integer("attempt_count").notNull().default(0), receiptHash: text("receipt_hash"), errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => ({ bindingFk: foreignKey({ name: "cognitive_operations_binding_fk", columns: [t.companyId, t.bindingId], foreignColumns: [cognitiveMemoryBindings.companyId, cognitiveMemoryBindings.id] }).onDelete("cascade"),
  pendingIdx: index("cognitive_operations_pending_idx").on(t.companyId, t.status),
  typeCheck: check("cognitive_operations_type_check", sql`${t.operationType} in ('reconcile','delete')`), statusCheck: check("cognitive_operations_status_check", sql`${t.status} in ('queued','running','succeeded','failed')`),
}));
