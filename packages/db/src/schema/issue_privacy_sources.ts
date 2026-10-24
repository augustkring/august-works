import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { issues } from "./issues.js";

/** Task-domain provenance. A removed source stays a denied tombstone. */
export const issuePrivacySources = pgTable("issue_privacy_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  issueId: uuid("issue_id").notNull(),
  sourceKind: text("source_kind").$type<"issue" | "project" | "run" | "workflow_run" | "routine_run">().notNull(),
  sourceId: uuid("source_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  issueFk: foreignKey({ name: "issue_privacy_sources_company_issue_fk", columns: [table.companyId, table.issueId], foreignColumns: [issues.companyId, issues.id] }).onDelete("cascade"),
  kindCheck: check("issue_privacy_sources_kind_check", sql`${table.sourceKind} in ('issue','project','run','workflow_run','routine_run')`),
  sourceUq: uniqueIndex("issue_privacy_sources_source_uq").on(table.companyId, table.issueId, table.sourceKind, table.sourceId),
  sourceIdx: index("issue_privacy_sources_source_idx").on(table.companyId, table.sourceKind, table.sourceId),
}));
