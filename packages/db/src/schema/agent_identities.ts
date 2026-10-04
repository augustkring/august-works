import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Global persona metadata is not an authorization principal. Company operations
// continue to use the local agents row and its grants, keys and budget.
export const agentIdentities = pgTable("agent_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  homeCompanyId: uuid("home_company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  baseProfile: jsonb("base_profile").$type<Record<string, unknown>>().notNull().default({}),
  appearance: jsonb("appearance").$type<Record<string, unknown>>(),
  description: text("description"),
  providerPreference: text("provider_preference"),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  homeStatusIdx: index("agent_identities_home_status_idx").on(t.homeCompanyId, t.status),
  statusCheck: check("agent_identities_status_check", sql`${t.status} in ('active', 'paused', 'archived')`),
}));
