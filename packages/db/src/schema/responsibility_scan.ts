// PRIVATE Resource 0565 candidate only. Keep outside the main schema/journal pending Root review.
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const responsibilityScanRuns = pgTable("responsibility_scan_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contractVersion: integer("contract_version").notNull().default(1),
  status: text("status").notNull().default("queued"),
  cursorJson: jsonb("cursor_json").$type<Record<string, { after: string | null; complete: boolean }>>().notNull().default({}),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: text("lease_owner"),
  leaseToken: uuid("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastErrorCode: text("last_error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("responsibility_scan_runs_status_check", sql`${table.status} in ('queued','running','complete','failed','abandoned')`),
  check("responsibility_scan_runs_lease_pair_check", sql`(${table.leaseOwner} is null) = (${table.leaseToken} is null) and (${table.leaseToken} is null) = (${table.leaseExpiresAt} is null)`),
  check("responsibility_scan_runs_attempt_check", sql`${table.attemptCount} >= 0`),
  check("responsibility_scan_runs_cursor_check", sql`jsonb_typeof(${table.cursorJson}) = 'object'`),
  uniqueIndex("responsibility_scan_runs_one_active_per_company").on(table.companyId).where(sql`${table.status} in ('queued','running','failed')`),
  index("responsibility_scan_runs_claim_idx").on(table.nextAttemptAt, table.requestedAt, table.companyId).where(sql`${table.status} in ('queued','failed')`),
  index("responsibility_scan_runs_expiry_idx").on(table.expiresAt),
]);

export const responsibilityScanCandidates = pgTable("responsibility_scan_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  scanRunId: uuid("scan_run_id").notNull().references(() => responsibilityScanRuns.id, { onDelete: "cascade" }),
  resourceKind: text("resource_kind").notNull(),
  resourceId: text("resource_id").notNull(),
  sourceVersion: text("source_version").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, table => [
  check("responsibility_scan_candidates_kind_check", sql`${table.resourceKind} in ('agent','deployment','workflow','workflow_run','routine','connector','metric','experiment','decision','approval','ai_use_case','tool_policy','skill_policy','billing','security_contact','support_incident_contact','support_case')`),
  check("responsibility_scan_candidates_source_version_check", sql`${table.sourceVersion} ~ '^[0-9a-f]{64}$'`),
  check("responsibility_scan_candidates_resource_id_check", sql`${table.resourceId} <> ''`),
  uniqueIndex("responsibility_scan_candidates_run_resource_uq").on(table.scanRunId, table.resourceKind, table.resourceId),
  index("responsibility_scan_candidates_read_idx").on(table.companyId, table.scanRunId, table.resourceKind, table.resourceId, table.expiresAt),
  index("responsibility_scan_candidates_expiry_idx").on(table.expiresAt),
]);
