import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { documentRevisions } from "./document_revisions.js";

/** Lifecycle metadata only; document content remains in the canonical revision owner. */
export const trustDocumentRegistry = pgTable("trust_document_registry", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull(),
  documentRevisionId: uuid("document_revision_id").notNull(),
  owner: text("owner").notNull(),
  version: text("version").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull().default([]),
  customerVisibility: text("customer_visibility").notNull(),
  ndaRequired: boolean("nda_required").notNull().default(false),
  lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
  nextReviewOrTrigger: text("next_review_or_trigger"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  supersededBy: uuid("superseded_by"),
  acceptanceRequired: boolean("acceptance_required").notNull().default(false),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("trust_document_registry_company_id_uq").on(table.companyId, table.id),
  unique("trust_document_registry_revision_uq").on(table.companyId, table.documentRevisionId),
  foreignKey({
    name: "trust_document_registry_revision_fk",
    columns: [table.companyId, table.documentId, table.documentRevisionId],
    foreignColumns: [documentRevisions.companyId, documentRevisions.documentId, documentRevisions.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "trust_document_registry_superseded_fk",
    columns: [table.companyId, table.supersededBy],
    foreignColumns: [table.companyId, table.id],
  }).onDelete("cascade"),
  index("trust_document_registry_company_current_idx").on(table.companyId, table.documentId, table.createdAt),
  check("trust_document_registry_version_ck", sql`length(btrim(${table.version})) between 1 and 128`),
  check("trust_document_registry_owner_ck", sql`length(btrim(${table.owner})) between 1 and 300`),
  check("trust_document_registry_visibility_ck", sql`${table.customerVisibility} in ('public','gated','internal')`),
  check("trust_document_registry_evidence_refs_ck", sql`jsonb_typeof(${table.evidenceRefs})='array' and jsonb_array_length(${table.evidenceRefs})<=100`),
  check("trust_document_registry_superseded_self_ck", sql`${table.supersededBy} is null or ${table.supersededBy} <> ${table.id}`),
]);

/** Append-only proof of an explicit action against one exact registry version. */
export const trustDocumentAcceptances = pgTable("trust_document_acceptances", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  registryEntryId: uuid("registry_entry_id").notNull(),
  documentRevisionId: uuid("document_revision_id").notNull(),
  principalUserId: text("principal_user_id").notNull(),
  documentVersion: text("document_version").notNull(),
  requestId: uuid("request_id").notNull(),
  requestHash: text("request_hash").notNull(),
  surface: text("surface").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("trust_document_acceptances_idempotency_uq").on(table.companyId, table.principalUserId, table.requestId),
  index("trust_document_acceptances_principal_idx").on(table.companyId, table.principalUserId, table.acceptedAt),
  check("trust_document_acceptances_hash_ck", sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
  check("trust_document_acceptances_version_ck", sql`length(btrim(${table.documentVersion})) between 1 and 128`),
  check("trust_document_acceptances_surface_ck", sql`length(btrim(${table.surface})) between 1 and 128`),
]);
