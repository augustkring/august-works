import { pgTable, text, timestamp, uuid, boolean, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";

/** Customer-controlled opt-in. It contains no provider credential or prompt. */
export const jevDecisionSettings = pgTable("jev_decision_settings", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  mode: text("mode").$type<"off" | "shadow" | "suggestions">().notNull().default("off"),
  allowBackground: boolean("allow_background").notNull().default(false),
  connectionId: uuid("connection_id"),
  grantId: uuid("grant_id"),
  updatedByUserId: text("updated_by_user_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  modeCheck: check("jev_decision_settings_mode_ck", sql`${table.mode} in ('off','shadow','suggestions')`),
  identityCheck: check("jev_decision_settings_connection_ck", sql`(${table.connectionId} is null) = (${table.grantId} is null)`),
}));
