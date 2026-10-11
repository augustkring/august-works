import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** Original onboarding purpose decision, never credentials or Agent access.
 * Allocation ownership survives provider failures and unknown replies. The
 * reserved private UUID is not proof that a connection has been allocated. */
export const activationConnectionConsents = pgTable("activation_connection_consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  onboardingRunId: uuid("onboarding_run_id").notNull(),
  subjectUserId: text("subject_user_id").notNull(),
  packageVersionId: uuid("package_version_id").notNull(),
  packageContentHash: text("package_content_hash").notNull(),
  onboardingVersion: integer("onboarding_version").notNull(),
  applicationId: uuid("application_id").notNull(),
  applicationKey: text("application_key").notNull(),
  applicationHash: text("application_hash").notNull(),
  galleryKey: text("gallery_key").notNull(),
  connectionMethodKey: text("connection_method_key").notNull(),
  methodHash: text("method_hash").notNull(),
  requestKey: uuid("request_key").notNull(),
  requestHash: text("request_hash").notNull(),
  reviewHash: text("review_hash").notNull(),
  supersedesConsentId: uuid("supersedes_consent_id"),
  existingConnectionId: uuid("existing_connection_id"),
  existingSetupHash: text("existing_setup_hash"),
  status: text("status").notNull().default("approved"),
  reservedConnectionId: uuid("reserved_connection_id"),
  connectionId: uuid("connection_id"),
  connectionHash: text("connection_hash"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
}, t => [
  uniqueIndex("activation_connection_consents_request_uq").on(t.companyId, t.onboardingRunId, t.requestKey),
  uniqueIndex("activation_connection_consents_connection_uq").on(t.connectionId).where(sql`${t.status}<>'withdrawn'`),
  uniqueIndex("activation_connection_consents_reserved_uq").on(t.reservedConnectionId).where(sql`${t.status}<>'withdrawn'`),
  uniqueIndex("activation_connection_consents_successor_uq").on(t.supersedesConsentId),
  uniqueIndex("activation_connection_consents_live_application_uq").on(t.onboardingRunId, t.applicationId).where(sql`${t.status}<>'withdrawn'`),
  index("activation_connection_consents_owner_idx").on(t.companyId, t.subjectUserId, t.onboardingRunId),
  check("activation_connection_consents_existing_ck", sql`(${t.existingConnectionId} is null and ${t.existingSetupHash} is null) or (${t.existingConnectionId} is not null and ${t.existingSetupHash} is not null and ${t.existingSetupHash} ~ '^[a-f0-9]{64}$')`),
  check("activation_connection_consents_version_ck", sql`${t.onboardingVersion}>0`),
  check("activation_connection_consents_hash_ck", sql`${t.packageContentHash} ~ '^[a-f0-9]{64}$' and ${t.applicationHash} ~ '^[a-f0-9]{64}$' and ${t.methodHash} ~ '^[a-f0-9]{64}$' and ${t.requestHash} ~ '^[a-f0-9]{64}$' and ${t.reviewHash} ~ '^[a-f0-9]{64}$' and (${t.connectionHash} is null or ${t.connectionHash} ~ '^[a-f0-9]{64}$')`),
  check("activation_connection_consents_status_ck", sql`
    (${t.status}='approved' and ${t.reservedConnectionId} is null and ${t.connectionId} is null and ${t.connectedAt} is null and ${t.connectionHash} is null) or
    (${t.status}='allocating' and ${t.reservedConnectionId} is not null and ${t.connectionId} is null and ${t.connectedAt} is null and ${t.connectionHash} is null) or
    (${t.status}='allocated' and ${t.reservedConnectionId}=${t.connectionId} and ${t.connectionId} is not null and ${t.connectedAt} is null and ${t.connectionHash} is null) or
    (${t.status}='connected' and ${t.reservedConnectionId}=${t.connectionId} and ${t.connectionId} is not null and ${t.connectedAt} is not null and ${t.connectionHash} is not null) or
    (${t.status}='withdrawn' and (${t.connectionId} is null or ${t.reservedConnectionId}=${t.connectionId}) and ((${t.connectedAt} is null and ${t.connectionHash} is null) or (${t.connectedAt} is not null and ${t.connectionHash} is not null and ${t.connectionId} is not null)))
  `),
]);
