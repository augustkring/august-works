import { foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { supportCases } from "./support_cases.js";
import { authUsers } from "./auth.js";

/** Content-free support-to-work pointer. Either source owner's deletion
 * cascades the link; no support text is copied into the broadly visible Issue. */
export const supportCaseIssueLinks = pgTable("support_case_issue_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  caseId: uuid("case_id").notNull(),
  issueId: uuid("issue_id").notNull(),
  linkedByUserId: text("linked_by_user_id").references(() => authUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("support_case_issue_links_company_case_uq").on(table.companyId, table.caseId),
  index("support_case_issue_links_issue_idx").on(table.companyId, table.issueId),
  foreignKey({ name: "support_case_issue_links_case_fk", columns: [table.companyId, table.caseId], foreignColumns: [supportCases.companyId, supportCases.id] }).onDelete("cascade"),
  foreignKey({ name: "support_case_issue_links_issue_fk", columns: [table.companyId, table.issueId], foreignColumns: [issues.companyId, issues.id] }).onDelete("cascade"),
]);
