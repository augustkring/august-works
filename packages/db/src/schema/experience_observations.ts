import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { authUsers } from "./auth.js";
import type { ExperienceObservationPreferenceReceipt } from "@paperclipai/shared";

export const experienceObservationPreferences = pgTable("experience_observation_preferences", {
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  version: integer("version").notNull().default(1),
  lastRequestId: uuid("last_request_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.companyId, table.userId] }),
  check("experience_observation_preferences_version_ck", sql`${table.version} > 0`),
]);

export const experienceObservations = pgTable("experience_observations", {
  companyId: uuid("company_id").notNull(),
  userId: text("user_id").notNull(),
  requestId: uuid("request_id").notNull(),
  requestHash: text("request_hash").notNull(),
  preferenceVersion: integer("preference_version").notNull(),
  kind: text("kind").notNull(),
  surface: text("surface").notNull(),
  variant: text("variant").notNull(),
  step: text("step"),
  durationBucket: text("duration_bucket"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '35 days'`),
}, table => [primaryKey({ columns: [table.companyId, table.userId, table.requestId] }),
  foreignKey({ columns: [table.companyId, table.userId], foreignColumns: [experienceObservationPreferences.companyId, experienceObservationPreferences.userId], name: "experience_observations_owner_fk" }).onDelete("cascade"),
  index("experience_observations_owner_window_idx").on(table.companyId, table.userId, table.createdAt),
  index("experience_observations_expiry_idx").on(table.expiresAt),
  check("experience_observations_hash_ck", sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
  check("experience_observations_preference_version_ck", sql`${table.preferenceVersion} > 0`),
  check("experience_observations_kind_ck", sql`${table.kind} in ('surface_opened','activation_step_opened','active_view_interval')`),
  check("experience_observations_surface_ck", sql`${table.surface} in ('home','needs_you','activation','agents','workflow','maintenance_history','support','other')`),
  check("experience_observations_variant_ck", sql`${table.variant} in ('streamlined','classic')`),
  check("experience_observations_step_ck", sql`${table.step} is null or ${table.step} in ('intent','discovery_permission','discovery_progress','material_facts','capability','access','review','running','result','activated')`),
  check("experience_observations_duration_ck", sql`${table.durationBucket} is null or ${table.durationBucket} in ('under_minute','one_to_five_minutes','five_to_fifteen_minutes','fifteen_to_thirty_minutes','over_thirty_minutes')`),
  check("experience_observations_shape_ck", sql`(${table.kind} = 'activation_step_opened') = (${table.step} is not null)
    and (${table.step} is null or ${table.surface} = 'activation')
    and (${table.kind} = 'active_view_interval') = (${table.durationBucket} is not null)`),
  check("experience_observations_expiry_ck", sql`${table.expiresAt} > ${table.createdAt} and ${table.expiresAt} <= ${table.createdAt} + interval '35 days'`),
]);

export const experienceObservationCommands = pgTable("experience_observation_commands", {
  companyId: uuid("company_id").notNull(), userId: text("user_id").notNull(), requestId: uuid("request_id").notNull(),
  requestHash: text("request_hash").notNull(), receipt: jsonb("receipt").$type<ExperienceObservationPreferenceReceipt>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '1 day'`),
}, table => [primaryKey({ columns: [table.companyId, table.userId, table.requestId] }),
  foreignKey({ columns: [table.companyId, table.userId], foreignColumns: [experienceObservationPreferences.companyId, experienceObservationPreferences.userId], name: "experience_observation_commands_owner_fk" }).onDelete("cascade"),
  index("experience_observation_commands_expiry_idx").on(table.expiresAt),
  check("experience_observation_commands_hash_ck", sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
  check("experience_observation_commands_receipt_ck", sql`jsonb_typeof(${table.receipt}) = 'object'
    and ${table.receipt} ?& array['companyId','requestId','enabled','version','observationsErased']
    and ${table.receipt} - array['companyId','requestId','enabled','version','observationsErased'] = '{}'::jsonb
    and ${table.receipt}->>'companyId' = ${table.companyId}::text and ${table.receipt}->>'requestId' = ${table.requestId}::text
    and jsonb_typeof(${table.receipt}->'enabled') = 'boolean' and jsonb_typeof(${table.receipt}->'observationsErased') = 'boolean'
    and (${table.receipt}->>'enabled')::boolean <> (${table.receipt}->>'observationsErased')::boolean
    and jsonb_typeof(${table.receipt}->'version') = 'number' and ${table.receipt}->>'version' ~ '^[0-9]{1,10}$'
    and (${table.receipt}->>'version')::numeric between 1 and 2147483647`),
  check("experience_observation_commands_expiry_ck", sql`${table.expiresAt} > ${table.createdAt} and ${table.expiresAt} <= ${table.createdAt} + interval '1 day'`),
]);
