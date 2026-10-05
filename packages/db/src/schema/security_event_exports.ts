import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  unique,
  foreignKey,
  check,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";
import { activityLog } from "./activity_log.js";
export const securityEventExportConfigurations = pgTable(
  "security_event_export_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    version: integer("version").notNull().default(1),
    endpoint: text("endpoint").notNull(),
    signingSecretId: uuid("signing_secret_id")
      .notNull()
      .references(() => companySecrets.id),
    signingSecretVersion: integer("signing_secret_version").notNull(),
    signingSecretHash: text("signing_secret_hash").notNull(),
    actions: jsonb("actions").$type<string[]>().notNull(),
    enabled: boolean("enabled").notNull().default(false),
    approvedByUserId: text("approved_by_user_id").notNull(),
    droppedEvents: integer("dropped_events").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    company: unique("security_event_export_company_uq").on(t.companyId),
    scoped: unique("security_event_export_scope_uq").on(t.companyId, t.id),
    shape: check(
      "security_event_export_shape",
      sql`${t.version}>0 and ${t.signingSecretVersion}>0 and ${t.droppedEvents}>=0 and ${t.signingSecretHash} ~ '^[a-f0-9]{64}$'`,
    ),
  }),
);
// Delivery metadata only. Payload remains in the canonical company activity log.
export const securityEventDeliveries = pgTable(
  "security_event_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    configurationId: uuid("configuration_id").notNull(),
    configurationVersion: integer("configuration_version").notNull(),
    eventId: uuid("event_id").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastFailureCode: text("last_failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    configuration: foreignKey({
      columns: [t.companyId, t.configurationId],
      foreignColumns: [
        securityEventExportConfigurations.companyId,
        securityEventExportConfigurations.id,
      ],
    }),
    event: foreignKey({
      columns: [t.companyId, t.eventId],
      foreignColumns: [activityLog.companyId, activityLog.id],
    }).onDelete("cascade"),
    dedup: unique("security_event_delivery_dedup_uq").on(
      t.companyId,
      t.eventId,
    ),
    ready: index("security_event_delivery_ready_idx").on(
      t.status,
      t.nextAttemptAt,
    ),
    tenant: index("security_event_delivery_company_idx").on(
      t.companyId,
      t.expiresAt,
    ),
    shape: check(
      "security_event_delivery_state",
      sql`${t.status} in ('pending','sending','delivered','failed','cancelled') and ${t.attempts} between 0 and 5 and ${t.configurationVersion}>0`,
    ),
  }),
);
