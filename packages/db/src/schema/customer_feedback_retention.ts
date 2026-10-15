import { sql } from "drizzle-orm";
import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, uniqueIndex, check, foreignKey } from "drizzle-orm/pg-core";
import { customerFeedback } from "./customer_feedback.js";

/** Restricted original internal feedback operator purpose. Neither customer
 * requests nor tenant roles can configure these incident/legal exceptions. */
export const customerFeedbackRetention = pgTable("customer_feedback_retention", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(), feedbackId: uuid("feedback_id").notNull(),
  version: integer("version").notNull(),
  legalHold: boolean("legal_hold").notNull().default(false),
  holdReleaseAt: timestamp("hold_release_at", { withTimezone: true }),
  holdReason: text("hold_reason").notNull().default(""),
  extensionUntil: timestamp("extension_until", { withTimezone: true }),
  extensionReason: text("extension_reason").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  foreignKey({ columns: [t.companyId, t.feedbackId], foreignColumns: [customerFeedback.companyId, customerFeedback.id] }).onDelete("cascade"),
  uniqueIndex("customer_feedback_retention_owner_idx").on(t.companyId, t.feedbackId),
  check("customer_feedback_retention_version_check", sql`${t.version} > 0`),
  check("customer_feedback_retention_hold_check", sql`(${t.legalHold} and length(trim(${t.holdReason})) between 1 and 1000) or (not ${t.legalHold} and ${t.holdReason}='' and ${t.holdReleaseAt} is null)`),
  check("customer_feedback_retention_extension_check", sql`(${t.extensionUntil} is not null and length(trim(${t.extensionReason})) between 1 and 1000) or (${t.extensionUntil} is null and ${t.extensionReason}='')`),
]);

export const customerFeedbackRetentionChanges = pgTable("customer_feedback_retention_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(), feedbackId: uuid("feedback_id").notNull(),
  requestKey: uuid("request_key").notNull(), requestHash: text("request_hash").notNull(),
  receipt: jsonb("receipt").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  foreignKey({ columns: [t.companyId, t.feedbackId], foreignColumns: [customerFeedback.companyId, customerFeedback.id] }).onDelete("cascade"),
  uniqueIndex("customer_feedback_retention_changes_request_idx").on(t.companyId, t.feedbackId, t.requestKey),
]);
