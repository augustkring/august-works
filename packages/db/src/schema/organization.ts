import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const companyRelationships = pgTable("company_relationships", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceCompanyId: uuid("source_company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  targetCompanyId: uuid("target_company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  relationshipType: text("relationship_type").notNull(),
  status: text("status").notNull().default("proposed"),
  createdByUserId: text("created_by_user_id").notNull(),
  acceptedByUserId: text("accepted_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  targetStatusIdx: index("company_relationships_target_status_idx").on(t.targetCompanyId, t.status),
  sourceTypeUnique: unique("company_relationships_source_target_type_uq").on(t.sourceCompanyId, t.targetCompanyId, t.relationshipType),
  differentCompanies: check("company_relationships_different_companies", sql`${t.sourceCompanyId} <> ${t.targetCompanyId}`),
  statusCheck: check("company_relationships_status_check", sql`${t.status} in ('proposed', 'active', 'rejected', 'revoked')`),
}));

export const orgUnits = pgTable("org_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  type: text("type").notNull().default("team"),
  parentId: uuid("parent_id").references((): AnyPgColumn => orgUnits.id),
  leadUserId: text("lead_user_id"),
  leadAgentId: uuid("lead_agent_id"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  companyIdUnique: unique("org_units_company_id_uq").on(t.companyId, t.id),
  companySlugUnique: unique("org_units_company_slug_uq").on(t.companyId, t.slug),
  companyStatusIdx: index("org_units_company_status_idx").on(t.companyId, t.status),
  parentCompanyFk: foreignKey({ columns: [t.companyId, t.parentId], foreignColumns: [t.companyId, t.id] }),
  leadCompanyFk: foreignKey({ columns: [t.companyId, t.leadAgentId], foreignColumns: [agents.companyId, agents.id] }),
  parentCheck: check("org_units_parent_check", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  statusCheck: check("org_units_status_check", sql`${t.status} in ('active', 'archived')`),
}));

export const orgUnitMemberships = pgTable("org_unit_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  orgUnitId: uuid("org_unit_id").notNull(),
  principalType: text("principal_type").notNull(),
  principalId: text("principal_id").notNull(),
  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unitPrincipalUnique: unique("org_unit_memberships_unit_principal_uq").on(t.orgUnitId, t.principalType, t.principalId),
  companyPrincipalIdx: index("org_unit_memberships_company_principal_idx").on(t.companyId, t.principalType, t.principalId),
  unitCompanyFk: foreignKey({ columns: [t.companyId, t.orgUnitId], foreignColumns: [orgUnits.companyId, orgUnits.id] }).onDelete("cascade"),
  principalTypeCheck: check("org_unit_memberships_principal_type_check", sql`${t.principalType} in ('user', 'agent')`),
  statusCheck: check("org_unit_memberships_status_check", sql`${t.status} in ('active', 'archived')`),
}));
