import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";

/** Authorization membership, distinct from sidebar project_memberships. */
export const projectAccessMembers = pgTable("project_access_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  projectId: uuid("project_id").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  projectFk: foreignKey({ name: "project_access_members_company_project_fk", columns: [table.companyId, table.projectId], foreignColumns: [projects.companyId, projects.id] }).onDelete("cascade"),
  subjectCheck: check("project_access_members_subject_check", sql`${table.subjectType} in ('user','agent') and length(btrim(${table.subjectId})) > 0`),
  subjectUq: uniqueIndex("project_access_members_subject_uq").on(table.companyId, table.projectId, table.subjectType, table.subjectId),
  subjectIdx: index("project_access_members_subject_idx").on(table.companyId, table.subjectType, table.subjectId, table.projectId),
}));
