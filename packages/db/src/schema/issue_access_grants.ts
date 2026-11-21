import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { issues } from "./issues.js";

export const issueAccessGrants = pgTable("issue_access_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  issueId: uuid("issue_id").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  source: text("source").notNull(),
  grantedByUserId: text("granted_by_user_id"),
  grantedByAgentId: uuid("granted_by_agent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, table => ({
  issueFk: foreignKey({ name: "issue_access_grants_company_issue_fk", columns: [table.companyId, table.issueId], foreignColumns: [issues.companyId, issues.id] }).onDelete("cascade"),
  subjectCheck: check("issue_access_grants_subject_check", sql`${table.subjectType} in ('user','agent') and length(btrim(${table.subjectId})) > 0`),
  sourceCheck: check("issue_access_grants_source_check", sql`${table.source} in ('explicit','assignment','project')`),
  activeSourceUq: uniqueIndex("issue_access_grants_active_source_uq").on(table.companyId, table.issueId, table.subjectType, table.subjectId, table.source).where(sql`${table.revokedAt} is null`),
  subjectIdx: index("issue_access_grants_subject_active_idx").on(table.companyId, table.subjectType, table.subjectId, table.revokedAt, table.issueId),
}));
