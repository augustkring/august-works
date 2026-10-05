import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { billingAccounts } from "./saas_billing.js";

export const companyOnboardingRuns = pgTable(
  "company_onboarding_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id),
    createdByUserId: text("created_by_user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    currentStage: text("current_stage").notNull().default("organization"),
    status: text("status").notNull().default("in_progress"),
    version: integer("version").notNull().default(1),
    answers: jsonb("answers")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("company_onboarding_runs_company_uq").on(t.companyId),
    uniqueIndex("company_onboarding_runs_request_uq").on(
      t.createdByUserId,
      t.idempotencyKey,
    ),
    check(
      "company_onboarding_runs_status_ck",
      sql`${t.status} in ('in_progress','completed','abandoned')`,
    ),
  ],
);
export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id),
    userId: text("user_id"),
    purpose: text("purpose").notNull(),
    recipientHash: text("recipient_hash").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    payloadCiphertext: text("payload_ciphertext"),
    payloadKeyId: text("payload_key_id").notNull().default("initial"),
    payloadExpiresAt: timestamp("payload_expires_at", {
      withTimezone: true,
    }).notNull(),
    status: text("status").notNull().default("pending"),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("email_deliveries_dedupe_uq").on(t.dedupeKey),
    uniqueIndex("email_deliveries_provider_uq")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
    index("email_deliveries_work_idx").on(t.status, t.notBefore),
    check(
      "email_deliveries_status_ck",
      sql`${t.status} in ('pending','sending','accepted','delivered','failed','bounced','complained','suppressed','expired','quarantined')`,
    ),
    check(
      "email_deliveries_purpose_ck",
      sql`${t.purpose} in ('verification','password_reset','invite','billing','runtime','security','approval','work_update')`,
    ),
  ],
);
export const emailSuppressions = pgTable("email_suppressions", {
  recipientHash: text("recipient_hash").primaryKey(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const emailWebhookReceipts = pgTable("email_webhook_receipts", {
  eventId: text("event_id").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const saasNotifications = pgTable(
  "saas_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    userId: text("user_id").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    relativePath: text("relative_path").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("saas_notifications_user_dedupe_uq").on(t.userId, t.dedupeKey),
    index("saas_notifications_user_idx").on(t.companyId, t.userId, t.createdAt),
    check(
      "saas_notifications_path_ck",
      sql`${t.relativePath} like '/%' and ${t.relativePath} not like '//%'`,
    ),
  ],
);
export const saasNotificationPreferences = pgTable(
  "saas_notification_preferences",
  {
    userId: text("user_id").notNull(),
    category: text("category").notNull(),
    emailEnabled: boolean("email_enabled").notNull().default(true),
  },
  (t) => [
    uniqueIndex("saas_notification_preferences_uq").on(t.userId, t.category),
    check(
      "saas_notification_preferences_security_ck",
      sql`${t.category} <> 'security' or ${t.emailEnabled}`,
    ),
  ],
);
export const supportSessions = pgTable(
  "support_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    operatorUserId: text("operator_user_id").notNull(),
    approvedByUserId: text("approved_by_user_id").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("support_sessions_operator_idx").on(t.operatorUserId, t.expiresAt),
    check(
      "support_sessions_expiry_ck",
      sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '1 hour'`,
    ),
  ],
);
export const platformAdminAudit = pgTable("platform_admin_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id"),
  operatorUserId: text("operator_user_id").notNull(),
  supportSessionId: uuid("support_session_id").references(
    () => supportSessions.id,
  ),
  action: text("action").notNull(),
  resourceId: text("resource_id"),
  safeDetails: jsonb("safe_details").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const companyDeletionOperations = pgTable(
  "company_deletion_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    requestedByUserId: text("requested_by_user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("requested"),
    stage: text("stage").notNull().default("revoke"),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    notBefore: timestamp("not_before", { withTimezone: true })
      .notNull()
      .defaultNow(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("company_deletion_operations_company_uq").on(t.companyId),
    check(
      "company_deletion_operations_status_ck",
      sql`${t.status} in ('requested','processing','waiting_retention','failed','completed')`,
    ),
  ],
);
export const deploymentRecords = pgTable(
  "deployment_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSha: text("source_sha").notNull(),
    imageDigest: text("image_digest").notNull(),
    schemaVersion: text("schema_version").notNull(),
    configHash: text("config_hash").notNull(),
    operator: text("operator").notNull(),
    environment: text("environment").notNull(),
    verificationResult: text("verification_result").notNull(),
    deployedAt: timestamp("deployed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "deployment_records_digest_ck",
      sql`${t.imageDigest} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
  ],
);
// Scheduler ownership, not a second generic job queue. Durable work stays in its domain table.
export const platformSchedulerLeases = pgTable("platform_scheduler_leases", {
  jobKey: text("job_key").primaryKey(),
  occurrenceId: text("occurrence_id").notNull(),
  owner: text("owner").notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
});
export const authSecurityEvents = pgTable(
  "auth_security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    companyId: uuid("company_id").references(() => companies.id),
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("auth_security_events_user_idx").on(t.userId, t.createdAt),
    check(
      "auth_security_events_action_ck",
      sql`${t.action} in ('verification_requested','email_verified','password_reset_requested','password_reset_completed','sessions_revoked','invite_accepted')`,
    ),
  ],
);
export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("auth_rate_limits_key_uq").on(t.key),
    index("auth_rate_limits_expiry_idx").on(t.lastRequest),
  ],
);
