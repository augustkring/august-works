import { sql } from "drizzle-orm";
import { type PgTableExtraConfig, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { RolePackItem } from "@paperclipai/shared";
import { companies } from "./companies.js";

export const rolePacks = pgTable("role_packs", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  key: text("key").notNull(), name: text("name").notNull(), description: text("description").notNull().default(""),
  status: text("status").notNull().default("active"),
  publishedVersionId: uuid("published_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t): PgTableExtraConfig => ({ companyKeyUnique: unique("role_packs_company_key_uq").on(t.companyId, t.key), companyIdUnique: unique("role_packs_company_id_uq").on(t.companyId, t.id), publishedVersionFk: foreignKey({ columns: [t.companyId, t.id, t.publishedVersionId], foreignColumns: [rolePackVersions.companyId, rolePackVersions.rolePackId, rolePackVersions.id] }), statusCheck: check("role_packs_status_check", sql`${t.status} in ('active', 'archived')`) }));
export const rolePackVersions = pgTable("role_pack_versions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  rolePackId: uuid("role_pack_id").notNull(), revisionNumber: integer("revision_number").notNull(), state: text("state").notNull().default("draft"),
  summary: text("summary").notNull().default(""), createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), publishedAt: timestamp("published_at", { withTimezone: true }),
}, (t): PgTableExtraConfig => ({ packFk: foreignKey({ columns: [t.companyId, t.rolePackId], foreignColumns: [rolePacks.companyId, rolePacks.id] }).onDelete("cascade"), revisionUnique: unique("role_pack_versions_revision_uq").on(t.rolePackId, t.revisionNumber), companyIdUnique: unique("role_pack_versions_company_id_uq").on(t.companyId, t.id), packVersionUnique: unique("role_pack_versions_company_pack_id_uq").on(t.companyId, t.rolePackId, t.id), stateCheck: check("role_pack_versions_state_check", sql`${t.state} in ('draft', 'published')`) }));
export const rolePackItems = pgTable("role_pack_items", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), versionId: uuid("version_id").notNull(),
  ordinal: integer("ordinal").notNull(), item: jsonb("item").$type<RolePackItem>().notNull(),
}, (t): PgTableExtraConfig => ({ versionFk: foreignKey({ columns: [t.companyId, t.versionId], foreignColumns: [rolePackVersions.companyId, rolePackVersions.id] }).onDelete("cascade"), ordinalUnique: unique("role_pack_items_version_ordinal_uq").on(t.versionId, t.ordinal) }));
export const agentRolePackAssignments = pgTable("agent_role_pack_assignments", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  scopeType: text("scope_type").notNull(), scopeId: uuid("scope_id").notNull(), rolePackId: uuid("role_pack_id").notNull(),
  versionPolicy: text("version_policy").notNull().default("follow_published"), pinnedVersionId: uuid("pinned_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t): PgTableExtraConfig => ({ scopeUnique: unique("agent_role_pack_assignments_scope_uq").on(t.companyId, t.scopeType, t.scopeId), packFk: foreignKey({ columns: [t.companyId, t.rolePackId], foreignColumns: [rolePacks.companyId, rolePacks.id] }).onDelete("cascade"), versionFk: foreignKey({ columns: [t.companyId, t.rolePackId, t.pinnedVersionId], foreignColumns: [rolePackVersions.companyId, rolePackVersions.rolePackId, rolePackVersions.id] }), companyIdx: index("agent_role_pack_assignments_company_idx").on(t.companyId), scopeCheck: check("agent_role_pack_assignments_scope_check", sql`${t.scopeType} in ('company', 'org_unit', 'agent')`), policyCheck: check("agent_role_pack_assignments_policy_check", sql`(${t.versionPolicy} = 'follow_published' and ${t.pinnedVersionId} is null) or (${t.versionPolicy} = 'pinned' and ${t.pinnedVersionId} is not null)`) }));
