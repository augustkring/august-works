import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { plugins } from "./plugins.js";

export const resourceLifecycleEvents = pgTable("resource_lifecycle_events", {
  id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").$type<"agent" | "project" | "agent_runtime">().notNull(),
  resourceId: uuid("resource_id").notNull(),
  action: text("action").$type<"create" | "update" | "archive" | "delete" | "pause" | "resume" | "terminate">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  companyIdx: index("resource_lifecycle_events_company_idx").on(table.companyId, table.id),
  resourceOrderIdx: index("resource_lifecycle_events_resource_order_idx").on(table.companyId, table.resourceType, table.resourceId, table.id),
  creationIdx: uniqueIndex("resource_lifecycle_events_creation_idx").on(table.companyId, table.resourceType, table.resourceId).where(sql`${table.action} = 'create'`),
  typeCheck: check("resource_lifecycle_events_resource_type_check", sql`${table.resourceType} IN ('agent', 'project', 'agent_runtime')`),
  actionCheck: check("resource_lifecycle_events_action_check", sql`(${table.resourceType} = 'agent_runtime' AND ${table.action} IN ('update', 'delete')) OR ${table.action} = 'create' OR (${table.resourceType} = 'project' AND ${table.action} IN ('update', 'archive', 'delete')) OR (${table.resourceType} = 'agent' AND ${table.action} IN ('pause', 'resume', 'terminate'))`),
}));

export const pluginLifecycleAcknowledgments = pgTable("plugin_lifecycle_acknowledgments", {
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  pluginId: uuid("plugin_id").notNull().references(() => plugins.id, { onDelete: "cascade" }),
  eventId: bigint("event_id", { mode: "bigint" }).notNull().references(() => resourceLifecycleEvents.id, { onDelete: "cascade" }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  pk: uniqueIndex("plugin_lifecycle_acknowledgments_pk").on(table.companyId, table.pluginId, table.eventId),
  eventIdx: index("plugin_lifecycle_acknowledgments_event_idx").on(table.eventId),
}));
