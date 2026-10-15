import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex, unique } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { documents } from "./documents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const documentRevisions = pgTable(
  "document_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title"),
    format: text("format").notNull().default("markdown"),
    body: text("body").notNull(),
    changeSummary: text("change_summary"),
    // Retained proposed-content sources are separate from the actual writer.
    conversationFoundationProposalIds: jsonb("conversation_foundation_proposal_ids").$type<string[]>().notNull().default([]),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdUq: unique("document_revisions_company_id_uq").on(table.companyId, table.id),
    companyDocumentIdUq: unique("document_revisions_company_document_id_uq").on(table.companyId, table.documentId, table.id),
    documentRevisionUq: uniqueIndex("document_revisions_document_revision_uq").on(
      table.documentId,
      table.revisionNumber,
    ),
    companyDocumentCreatedIdx: index("document_revisions_company_document_created_idx").on(
      table.companyId,
      table.documentId,
      table.createdAt,
    ),
  }),
);
