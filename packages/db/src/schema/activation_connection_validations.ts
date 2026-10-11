import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** Append-only original setup observations. A renewed personal credential
 * never rewrites the first purpose approval or creates Agent authority. */
export const activationConnectionValidations = pgTable("activation_connection_validations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  purposeId: uuid("purpose_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  setupHash: text("setup_hash").notNull(),
  healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("activation_connection_validations_setup_uq").on(t.purposeId, t.setupHash),
  index("activation_connection_validations_company_idx").on(t.companyId, t.connectionId),
  check("activation_connection_validations_hash_ck", sql`${t.setupHash} ~ '^[a-f0-9]{64}$'`),
]);
