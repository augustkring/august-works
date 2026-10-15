import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, jsonb, uniqueIndex, unique, foreignKey, check, index } from "drizzle-orm/pg-core";
import type { NotificationChannelCategory, NotificationChannelPreferenceReceipt } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { authUsers } from "./auth.js";
import { saasNotifications } from "./saas_lifecycle.js";
import { chatIdentityLinks, chatConversations, chatActions } from "./chat_channels.js";

/** Company-bound delivery choice under the Original notification owner. Global
 * cadence remains in saas_notification_preferences; this row grants no access. */
export const notificationChannelPreferences = pgTable("notification_channel_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  category: text("category").$type<NotificationChannelCategory>().notNull(),
  version: integer("version").notNull().default(1),
  deliveryLocale: text("delivery_locale").$type<"en" | "da">().notNull().default("en"),
  channel: text("channel").$type<"default" | "slack" | "microsoft-teams">().notNull(),
  identityLinkId: uuid("identity_link_id"),
  conversationId: uuid("conversation_id"),
  targetHash: text("target_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("notification_channel_preferences_company_id_uq").on(table.companyId, table.id),
  uniqueIndex("notification_channel_preferences_owner_uq").on(table.companyId, table.userId, table.category),
  foreignKey({ columns: [table.companyId, table.identityLinkId], foreignColumns: [chatIdentityLinks.companyId, chatIdentityLinks.id], name: "notification_channel_preferences_link_fk" }).onDelete("set null"),
  foreignKey({ columns: [table.companyId, table.conversationId], foreignColumns: [chatConversations.companyId, chatConversations.id], name: "notification_channel_preferences_conversation_fk" }).onDelete("set null"),
  check("notification_channel_preferences_category_ck", sql`${table.category} in ('billing','runtime','approval','work_update')`),
  check("notification_channel_preferences_locale_ck", sql`${table.deliveryLocale} in ('en','da')`),
  check("notification_channel_preferences_version_ck", sql`${table.version} > 0`),
  check("notification_channel_preferences_target_ck", sql`(
    ${table.channel} = 'default' and ${table.identityLinkId} is null and ${table.conversationId} is null and ${table.targetHash} is null
  ) or (
    ${table.channel} in ('slack','microsoft-teams') and ${table.targetHash} is not null and ${table.targetHash} ~ '^[a-f0-9]{64}$'
  )`),
]);

/** Content-free command receipt. This proves a preference change only. Expiry
 * never authorizes replay, provider delivery, erasure or a new target. */
export const notificationChannelPreferenceCommands = pgTable("notification_channel_preference_commands", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  category: text("category").$type<NotificationChannelCategory>().notNull(),
  preferenceId: uuid("preference_id").notNull(),
  requestId: uuid("request_id").notNull(),
  requestHash: text("request_hash").notNull(),
  receipt: jsonb("receipt").$type<NotificationChannelPreferenceReceipt>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`clock_timestamp() + interval '1 day'`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("notification_channel_preference_commands_request_uq").on(table.companyId, table.userId, table.requestId),
  index("notification_channel_preference_commands_expiry_idx").on(table.expiresAt),
  foreignKey({ columns: [table.companyId, table.preferenceId], foreignColumns: [notificationChannelPreferences.companyId, notificationChannelPreferences.id], name: "notification_channel_preference_commands_owner_fk" }).onDelete("cascade"),
  check("notification_channel_preference_commands_category_ck", sql`${table.category} in ('billing','runtime','approval','work_update')`),
  check("notification_channel_preference_commands_hash_ck", sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
]);

/** Every canonical notice records its transport disposition, including membership
 * of a digest. A missing provider action is never permission to stage it again. */
export const notificationChannelDeliveries = pgTable("notification_channel_deliveries", {
  notificationId: uuid("notification_id").primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  preferenceId: uuid("preference_id").notNull(),
  actionId: uuid("action_id").references(() => chatActions.id, { onDelete: "set null" }),
  disposition: text("disposition").$type<"staged" | "suppressed">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({ columns: [table.companyId, table.notificationId], foreignColumns: [saasNotifications.companyId, saasNotifications.id], name: "notification_channel_deliveries_notice_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.companyId, table.preferenceId], foreignColumns: [notificationChannelPreferences.companyId, notificationChannelPreferences.id], name: "notification_channel_deliveries_preference_fk" }).onDelete("cascade"),
  check("notification_channel_deliveries_disposition_ck", sql`${table.disposition} in ('staged','suppressed')`),
]);
