import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { FoundationDraftGovernance } from "@paperclipai/shared";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { documentRevisions } from "./document_revisions.js";
import { documents } from "./documents.js";

export const foundationDocuments = pgTable(
  "foundation_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    approvedRevisionId: uuid("approved_revision_id").references(() => documentRevisions.id, {
      onDelete: "set null",
    }),
    foundationKey: text("foundation_key").notNull(),
    category: text("category").notNull(),
    documentType: text("document_type").notNull(),
    authorityLevel: text("authority_level").notNull().default("canonical"),
    status: text("status").notNull().default("draft"),
    sensitivity: text("sensitivity").notNull().default("internal"),
    draftMetadata: jsonb("draft_metadata").$type<FoundationDraftGovernance | null>(),
    ownerUserId: text("owner_user_id"),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    reviewFrequencyDays: integer("review_frequency_days"),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKeyUq: uniqueIndex("foundation_documents_company_key_uq").on(
      table.companyId,
      table.foundationKey,
    ),
    companyDocumentUq: uniqueIndex("foundation_documents_company_document_uq").on(
      table.companyId,
      table.documentId,
    ),
    companyCategoryStatusIdx: index("foundation_documents_company_category_status_idx").on(
      table.companyId,
      table.category,
      table.status,
    ),
    companyStatusUpdatedIdx: index("foundation_documents_company_status_updated_idx").on(
      table.companyId,
      table.status,
      table.updatedAt,
    ),
    statusCheck: check(
      "foundation_documents_status_check",
      sql`${table.status} in ('draft', 'in_review', 'approved', 'superseded', 'archived')`,
    ),
    authorityCheck: check(
      "foundation_documents_authority_check",
      sql`${table.authorityLevel} in ('canonical', 'supporting')`,
    ),
    sensitivityCheck: check(
      "foundation_documents_sensitivity_check",
      sql`${table.sensitivity} in ('public', 'internal', 'confidential', 'restricted')`,
    ),
    reviewFrequencyCheck: check(
      "foundation_documents_review_frequency_check",
      sql`${table.reviewFrequencyDays} is null or ${table.reviewFrequencyDays} > 0`,
    ),
    validityCheck: check(
      "foundation_documents_validity_check",
      sql`${table.validUntil} is null or ${table.validFrom} is null or ${table.validUntil} > ${table.validFrom}`,
    ),
    approvedPointerCheck: check(
      "foundation_documents_approved_pointer_check",
      sql`${table.status} <> 'approved' or ${table.approvedRevisionId} is not null`,
    ),
  }),
);

export const foundationSections = pgTable(
  "foundation_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    foundationDocumentId: uuid("foundation_document_id")
      .notNull()
      .references(() => foundationDocuments.id, { onDelete: "cascade" }),
    documentRevisionId: uuid("document_revision_id")
      .notNull()
      .references(() => documentRevisions.id, { onDelete: "cascade" }),
    headingPath: text("heading_path").array().notNull(),
    ordinal: integer("ordinal").notNull(),
    body: text("body").notNull(),
    contentHash: text("content_hash").notNull(),
    tokenCount: integer("token_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    revisionOrdinalUq: uniqueIndex("foundation_sections_revision_ordinal_uq").on(
      table.foundationDocumentId,
      table.documentRevisionId,
      table.ordinal,
    ),
    companyDocumentRevisionIdx: index("foundation_sections_company_document_revision_idx").on(
      table.companyId,
      table.foundationDocumentId,
      table.documentRevisionId,
    ),
    tokenCountCheck: check(
      "foundation_sections_token_count_check",
      sql`${table.tokenCount} >= 0`,
    ),
  }),
);

export const foundationChangeProposals = pgTable(
  "foundation_change_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    foundationDocumentId: uuid("foundation_document_id")
      .notNull()
      .references(() => foundationDocuments.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    proposedByAgentId: uuid("proposed_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    proposedByUserId: text("proposed_by_user_id"),
    baseRevisionId: uuid("base_revision_id").references(() => documentRevisions.id, {
      onDelete: "set null",
    }),
    proposedBody: text("proposed_body").notNull(),
    changeSummary: text("change_summary"),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusCreatedIdx: index("foundation_change_proposals_company_status_created_idx").on(
      table.companyId,
      table.status,
      table.createdAt,
    ),
    documentStatusIdx: index("foundation_change_proposals_document_status_idx").on(
      table.foundationDocumentId,
      table.status,
    ),
    statusCheck: check(
      "foundation_change_proposals_status_check",
      sql`${table.status} in ('pending', 'accepted', 'rejected', 'superseded')`,
    ),
  }),
);
