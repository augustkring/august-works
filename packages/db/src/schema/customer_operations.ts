import { sql } from "drizzle-orm";
import { pgTable, text, uuid, integer, jsonb, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { CompanyImportJobState } from "@paperclipai/shared/customer-operations";
import { companies } from "./companies.js";

/** Status/coordination only. No bundle, credential, source prose or executable
 * request is stored here. Native portability retains all business effects. */
export const customerOperations = pgTable("customer_operations", {
  id: text("id").primaryKey(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  operationType: text("operation_type").notNull(),
  domain: text("domain").notNull(),
  domainOperationRef: text("domain_operation_ref"),
  requesterKeyHash: text("requester_key_hash").notNull(),
  requestedByUserId: text("requested_by_user_id"),
  scopeKey: text("scope_key").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  inputHash: text("input_hash").notNull(),
  status: text("status").$type<CompanyImportJobState>().notNull().default("running"),
  progressStage: text("progress_stage").notNull().default("admitted"),
  attempt: integer("attempt").notNull().default(1),
  attemptId: uuid("attempt_id").notNull().defaultRandom(),
  resultRef: jsonb("result_ref").$type<{ companyId: string; agentCount: number; warningCount: number; companyAction: "created" | "updated" | "unchanged" }>(),
  errorCode: text("error_code"),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  progressAt: timestamp("progress_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("customer_operations_request_key_uq").on(t.requesterKeyHash, t.operationType, t.scopeKey, t.idempotencyKey),
  index("customer_operations_requester_status_idx").on(t.requesterKeyHash, t.status),
  index("customer_operations_user_idx").on(t.requestedByUserId),
  check("customer_operations_domain_check", sql`${t.operationType}='company_import' AND ${t.domain}='company_portability'`),
  check("customer_operations_state_check", sql`${t.status} in ('running','cancelled','succeeded','failed','needs_reconciliation')`),
  check("customer_operations_hash_check", sql`${t.requesterKeyHash} ~ '^[a-f0-9]{64}$' AND ${t.inputHash} ~ '^[a-f0-9]{64}$'`),
  check("customer_operations_attempt_check", sql`${t.attempt}>=1`),
]);
