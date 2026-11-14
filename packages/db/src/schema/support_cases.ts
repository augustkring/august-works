import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, unique, uniqueIndex, index, check, foreignKey } from "drizzle-orm/pg-core";
import type { SupportCaseCategory, SupportCaseImpact, SupportCaseStatus, SupportCaseSafeContext, SupportCaseDataPolicy } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { authUsers } from "./auth.js";

/** Customer support content. V6 supportSessions remains the only owner of
 * privileged tenant access; creating or reopening a case grants none. */
export const supportCases = pgTable("support_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  openedByUserId: text("opened_by_user_id").notNull().references(() => authUsers.id),
  category: text("category").$type<SupportCaseCategory>().notNull().default("other"),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  impact: text("impact").$type<SupportCaseImpact>(),
  safeContext: jsonb("safe_context").$type<SupportCaseSafeContext>(),
  followUpOfId: uuid("follow_up_of_id"),
  customerStatus: text("customer_status").$type<SupportCaseStatus>().notNull().default("RECEIVED"),
  requestedResponse: text("requested_response"),
  version: integer("version").notNull().default(0),
  dataPolicy: jsonb("data_policy").$type<SupportCaseDataPolicy>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  legalHold: boolean("legal_hold").notNull().default(false),
  holdReason: text("hold_reason"),
  holdReleaseAt: timestamp("hold_release_at", { withTimezone: true }),
  providerCaseRef: text("provider_case_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, t => [
  unique("support_cases_company_id_key").on(t.companyId, t.id),
  index("support_cases_company_created_idx").on(t.companyId, t.createdAt, t.id),
  index("support_cases_opener_idx").on(t.openedByUserId, t.companyId),
  index("support_cases_expiry_idx").on(t.expiresAt),
  foreignKey({ columns: [t.companyId, t.followUpOfId], foreignColumns: [t.companyId, t.id] }),
  check("support_cases_category_check", sql`${t.category} in ('not_working','access','apps_connections','account_billing','using_blentera','other')`),
  check("support_cases_impact_check", sql`${t.impact} is null or ${t.impact} in ('blocked','limited','question')`),
  check("support_cases_status_check", sql`${t.customerStatus} in ('RECEIVED','INVESTIGATING','WORKING_ON_IT','WAITING_FOR_YOU','RESOLVED','CLOSED')`),
  check("support_cases_text_check", sql`length(trim(${t.subject})) between 1 and 200 and length(trim(${t.description})) between 1 and 10000`),
  check("support_cases_response_check", sql`(${t.customerStatus}='WAITING_FOR_YOU' and ${t.requestedResponse} is not null and length(trim(${t.requestedResponse})) between 1 and 10000) or (${t.customerStatus}<>'WAITING_FOR_YOU' and ${t.requestedResponse} is null)`),
  check("support_cases_hold_check", sql`(${t.legalHold} and ${t.holdReason} is not null and length(trim(${t.holdReason})) between 1 and 1000) or (not ${t.legalHold} and ${t.holdReason} is null and ${t.holdReleaseAt} is null)`),
  check("support_cases_version_check", sql`${t.version}>=0`),
  check("support_cases_follow_up_check", sql`${t.followUpOfId} is null or ${t.followUpOfId}<>${t.id}`),
]);

/** Only customer-safe messages and status events belong here. Provider payloads
 * and internal engineering/security notes are deliberately absent. Delivery
 * fields are private operation facts and are never spread into a customer DTO. */
export const supportCaseEvents = pgTable("support_case_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  caseId: uuid("case_id").notNull(),
  authorUserId: text("author_user_id").notNull().references(() => authUsers.id),
  kind: text("kind").$type<"request" | "customer_reply" | "support_message" | "status_change" | "resolution">().notNull(),
  body: text("body").notNull(),
  customerStatus: text("customer_status").$type<SupportCaseStatus>().notNull(),
  safeContext: jsonb("safe_context").$type<SupportCaseSafeContext>(),
  requestKey: uuid("request_key").notNull(),
  requestHash: text("request_hash").notNull(),
  deliveryState: text("delivery_state").$type<"pending" | "sending" | "delivered" | "unknown" | "not_required">().notNull().default("pending"),
  deliveryAttemptId: uuid("delivery_attempt_id"),
  deliveryProviderKey: text("delivery_provider_key"),
  deliveryStartedAt: timestamp("delivery_started_at", { withTimezone: true }),
  deliveryLeaseUntil: timestamp("delivery_lease_until", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  providerMessageRef: text("provider_message_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("support_case_events_company_id_idx").on(t.companyId, t.id),
  uniqueIndex("support_case_events_request_idx").on(t.companyId, t.authorUserId, t.requestKey),
  index("support_case_events_case_created_idx").on(t.companyId, t.caseId, t.createdAt, t.id),
  index("support_case_events_delivery_idx").on(t.deliveryState, t.createdAt),
  foreignKey({ columns: [t.companyId, t.caseId], foreignColumns: [supportCases.companyId, supportCases.id] }).onDelete("cascade"),
  check("support_case_events_kind_check", sql`${t.kind} in ('request','customer_reply','support_message','status_change','resolution')`),
  check("support_case_events_body_check", sql`length(trim(${t.body})) between 1 and 10000`),
  check("support_case_events_status_check", sql`${t.customerStatus} in ('RECEIVED','INVESTIGATING','WORKING_ON_IT','WAITING_FOR_YOU','RESOLVED','CLOSED')`),
  check("support_case_events_hash_check", sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`),
  check("support_case_events_delivery_check", sql`${t.deliveryState} in ('pending','sending','delivered','unknown','not_required') and
    ((${t.deliveryState}='delivered' and ${t.deliveredAt} is not null and ${t.deliveryAttemptId} is not null and ${t.deliveryProviderKey} is not null and ${t.providerMessageRef} is not null) or (${t.deliveryState}<>'delivered' and ${t.deliveredAt} is null)) and
    (${t.deliveryState}<>'sending' or (${t.deliveryAttemptId} is not null and ${t.deliveryProviderKey} is not null and ${t.deliveryStartedAt} is not null and ${t.deliveryLeaseUntil} is not null))`),
]);

/** Content-free identities outlive erased content and company deletion. The
 * authenticated restore ledger, not an old backup, owns their current horizon. */
export const supportCaseDeletionMarkers = pgTable("support_case_deletion_markers", {
  subjectId: uuid("subject_id").primaryKey(),
  companyId: uuid("company_id").notNull(),
  caseId: uuid("case_id").notNull(),
  targetKind: text("target_kind").$type<"case" | "event">().notNull(),
  erasedAt: timestamp("erased_at", { withTimezone: true }).notNull().defaultNow(),
  retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
}, t => [
  index("support_case_deletion_markers_company_idx").on(t.companyId),
  index("support_case_deletion_markers_case_idx").on(t.caseId),
  index("support_case_deletion_markers_horizon_idx").on(t.retainUntil),
  check("support_case_deletion_markers_target_check", sql`(${t.targetKind}='case' and ${t.subjectId}=${t.caseId}) or (${t.targetKind}='event' and ${t.subjectId}<>${t.caseId})`),
  check("support_case_deletion_markers_horizon_check", sql`${t.retainUntil}>${t.erasedAt}`),
]);
