import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, jsonb, unique, foreignKey, check, index } from "drizzle-orm/pg-core";
import type { WorkSignalView } from "@paperclipai/shared";
import { issues } from "./issues.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { chatEndpoints, chatDeliveries } from "./chat_channels.js";

/** A bounded coordination candidate, never an authoritative task or transcript. */
export const workSignalCandidates = pgTable("work_signal_candidates", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), issueId: uuid("issue_id").notNull(), targetIssueId: uuid("target_issue_id"),
  endpointId: uuid("endpoint_id").notNull(), sourceDeliveryId: uuid("source_delivery_id"), sourceEventKey: text("source_event_key").notNull(),
  sourcePrincipalId: uuid("source_principal_id").notNull(), sourceUserId: text("source_user_id").notNull(), sourceChannel: text("source_channel").notNull(), sourceMessageId: text("source_message_id").notNull(),
  sourceHash: text("source_hash").notNull(), sourceRevision: text("source_revision").notNull(), runId: uuid("run_id").notNull(), readInvocationId: uuid("read_invocation_id").notNull(),
  signalType: text("signal_type").$type<WorkSignalView["signalType"]>().notNull(), sensitivity: text("sensitivity").$type<WorkSignalView["sensitivity"]>().notNull(), confidence: text("confidence").$type<WorkSignalView["confidence"]>().notNull(),
  purpose: text("purpose").notNull().default("work_coordination"), facts: jsonb("facts").$type<WorkSignalView["facts"]>(),
  status: text("status").$type<WorkSignalView["status"]>().notNull().default("candidate"), version: integer("version").notNull().default(1),
  proposalId: uuid("proposal_id"), interactionId: uuid("interaction_id"), invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  followupAttempts: integer("followup_attempts").notNull().default(0), followupErrorCode: text("followup_error_code"), followupLeaseUntil: timestamp("followup_lease_until", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ tenantUq: unique("work_signal_tenant_uq").on(t.companyId, t.id), sourceUq: unique("work_signal_source_version_uq").on(t.companyId, t.endpointId, t.sourceEventKey, t.sourceRevision, t.sourceHash, t.signalType),
  taskFk: foreignKey({ columns: [t.companyId, t.issueId], foreignColumns: [issues.companyId, issues.id] }),
  targetTaskFk: foreignKey({ columns: [t.companyId, t.targetIssueId], foreignColumns: [issues.companyId, issues.id] }),
  endpointFk: foreignKey({ columns: [t.companyId, t.endpointId], foreignColumns: [chatEndpoints.companyId, chatEndpoints.id] }),
  deliveryFk: foreignKey({ columns: [t.companyId, t.sourceDeliveryId], foreignColumns: [chatDeliveries.companyId, chatDeliveries.id] }),
  runFk: foreignKey({ columns: [t.companyId, t.runId], foreignColumns: [heartbeatRuns.companyId, heartbeatRuns.id] }),
  statusCheck: check("work_signal_status_check", sql`${t.status} in ('candidate','ignored','review_requested','proposed','invalidated')`),
  purposeCheck: check("work_signal_purpose_check", sql`${t.purpose}='work_coordination'`), versionCheck: check("work_signal_version_check", sql`${t.version}>0`),
  followupCheck: check("work_signal_followup_budget_check", sql`${t.followupAttempts} between 0 and 3`),
  inboxIdx: index("work_signal_inbox_idx").on(t.companyId, t.sourceUserId, t.status, t.createdAt),
}));
