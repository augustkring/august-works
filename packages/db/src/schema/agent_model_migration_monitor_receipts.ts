import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/** Append-only Human decision over post-publication AgentAuthoring tests.
 * Evidence is restricted to opaque Native IDs, timestamps and hashes. */
export const agentModelMigrationMonitorReceipts = pgTable("agent_model_migration_monitor_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull(),
  migrationRevisionId: uuid("migration_revision_id").notNull(),
  draftId: uuid("draft_id").notNull(),
  reviewedByUserId: text("reviewed_by_user_id").notNull(),
  requestId: uuid("request_id").notNull(), requestHash: text("request_hash").notNull(), reviewHash: text("review_hash").notNull(),
  publishedVersion: integer("published_version").notNull(), publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  targetProfileHash: text("target_profile_hash").notNull(), targetConfigurationHash: text("target_configuration_hash").notNull(),
  targetLifecycleHash: text("target_lifecycle_hash").notNull(),
  evidence: jsonb("evidence").$type<Array<{ testId: string; runId: string; scenarioIndex: number; testCreatedAt: string;
    runStartedAt: string; verificationId: string; verificationCreatedAt: string; execution: "succeeded" | "failed" | "unknown" | "cancelled";
    verificationResult: "pass" | "fail" | "inconclusive" | "needs_human"; testQualified: boolean; outputHash: string; resultHash: string }>>().notNull(),
  decision: text("decision").$type<"healthy" | "hold">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  request: uniqueIndex("agent_model_migration_monitor_request_uq").on(table.companyId, table.reviewedByUserId, table.requestId),
  migration: index("agent_model_migration_monitor_revision_idx").on(table.companyId, table.migrationRevisionId, table.createdAt),
  agent: foreignKey({ columns: [table.companyId, table.agentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("cascade"),
  decision: check("agent_model_migration_monitor_decision_check", sql`${table.decision} in ('healthy','hold')`),
  versions: check("agent_model_migration_monitor_version_check", sql`${table.publishedVersion}>0`),
  hashes: check("agent_model_migration_monitor_hash_check", sql`${table.requestHash} ~ '^[a-f0-9]{64}$' and ${table.reviewHash} ~ '^[a-f0-9]{64}$'
    and ${table.targetProfileHash} ~ '^[a-f0-9]{64}$' and ${table.targetConfigurationHash} ~ '^[a-f0-9]{64}$' and ${table.targetLifecycleHash} ~ '^[a-f0-9]{64}$'`),
  evidence: check("agent_model_migration_monitor_evidence_check", sql`jsonb_typeof(${table.evidence})='array' and jsonb_array_length(${table.evidence}) between 1 and 10 and octet_length(${table.evidence}::text)<=16384`),
}));
