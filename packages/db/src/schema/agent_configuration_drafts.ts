import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import type { AgentAuthoringContent } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { authUsers } from "./auth.js";
import { agentPackageVersions } from "./agent_packages.js";
import { approvals } from "./approvals.js";

/** Canonical unpublished configuration owner. Applied revisions remain in agent_config_revisions. */
export const agentConfigurationDrafts = pgTable(
  "agent_configuration_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id"),
    kind: text("kind").$type<"custom" | "hire">().notNull().default("custom"),
    packageVersionId: uuid("package_version_id").references(
      () => agentPackageVersions.id,
    ),
    packageKey: text("package_key"),
    packageContentHash: text("package_content_hash"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    creationRequestId: uuid("creation_request_id").notNull(),
    creationRequestHash: text("creation_request_hash").notNull(),
    baselineHash: text("baseline_hash"),
    // A separate explicit preparation decision links one actual inactive Agent.
    // Draft creation/save itself still creates no Agent or effective authority.
    preparedAgentId: uuid("prepared_agent_id"),
    preparationApprovalId: uuid("preparation_approval_id").references(() => approvals.id),
    preparationConfigurationHash: text("preparation_configuration_hash"),
    preparationRequestId: uuid("preparation_request_id"),
    preparationRequestHash: text("preparation_request_hash"),
    preparationReviewHash: text("preparation_review_hash"),
    version: integer("version").notNull().default(1),
    // Material candidate revisions are independent from accepted save versions.
    candidateRevision: integer("candidate_revision").notNull().default(1),
    status: text("status")
      .$type<"draft" | "discarded">()
      .notNull()
      .default("draft"),
    step: text("step").notNull().default("outcome"),
    content: jsonb("content").$type<AgentAuthoringContent>(),
    requestReceipts: jsonb("request_receipts")
      .$type<Array<{ requestId: string; hash: string; version: number }>>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyIdId: uniqueIndex("agent_configuration_drafts_company_id_id_uq").on(table.companyId, table.id),
    package: check(
      "agent_configuration_drafts_package_check",
      sql`(${table.kind}='custom' and ${table.packageVersionId} is null and ${table.packageKey} is null and ${table.packageContentHash} is null) or (${table.kind}='hire' and ${table.agentId} is null and ${table.packageVersionId} is not null and ${table.packageKey} is not null and ${table.packageContentHash} is not null and ${table.packageContentHash} ~ '^[a-f0-9]{64}$')`,
    ),
    request: uniqueIndex("agent_configuration_drafts_request_uq").on(
      table.companyId,
      table.createdByUserId,
      table.creationRequestId,
    ),
    preparationRequest: uniqueIndex("agent_configuration_drafts_preparation_request_uq").on(
      table.companyId, table.createdByUserId, table.preparationRequestId,
    ),
    preparedAgent: uniqueIndex("agent_configuration_drafts_prepared_agent_uq").on(table.preparedAgentId),
    preparedTarget: foreignKey({ columns: [table.companyId, table.preparedAgentId],
      foreignColumns: [agents.companyId, agents.id] }).onDelete("cascade"),
    preparation: check("agent_configuration_drafts_preparation_check", sql`
      (${table.preparedAgentId} is null and ${table.preparationApprovalId} is null and ${table.preparationConfigurationHash} is null
        and ${table.preparationRequestId} is null and ${table.preparationRequestHash} is null and ${table.preparationReviewHash} is null) or
      (${table.agentId} is null and ${table.preparedAgentId} is not null and ${table.preparationRequestId} is not null
        and ${table.preparationConfigurationHash} is not null and ${table.preparationRequestHash} is not null and ${table.preparationReviewHash} is not null
        and ${table.preparationConfigurationHash} ~ '^[a-f0-9]{64}$' and ${table.preparationRequestHash} ~ '^[a-f0-9]{64}$'
        and ${table.preparationReviewHash} ~ '^[a-f0-9]{64}$')`),
    list: index("agent_configuration_drafts_owner_updated_idx").on(
      table.companyId,
      table.createdByUserId,
      table.updatedAt,
    ),
    target: foreignKey({
      columns: [table.companyId, table.agentId],
      foreignColumns: [agents.companyId, agents.id],
    }).onDelete("cascade"),
    version: check(
      "agent_configuration_drafts_version_check",
      sql`${table.version}>0`,
    ),
    candidateRevision: check("agent_configuration_drafts_candidate_revision_check", sql`${table.candidateRevision}>0`),
    state: check(
      "agent_configuration_drafts_state_check",
      sql`(${table.status}='draft' and ${table.content} is not null) or (${table.status}='discarded' and ${table.content} is null)`,
    ),
    size: check(
      "agent_configuration_drafts_size_check",
      sql`${table.content} is null or octet_length(${table.content}::text)<=65536`,
    ),
    receipts: check(
      "agent_configuration_drafts_receipts_check",
      sql`jsonb_typeof(${table.requestReceipts})='array' and jsonb_array_length(${table.requestReceipts})<=32`,
    ),
    hash: check(
      "agent_configuration_drafts_hash_check",
      sql`${table.creationRequestHash} ~ '^[a-f0-9]{64}$' and (${table.baselineHash} is null or ${table.baselineHash} ~ '^[a-f0-9]{64}$')`,
    ),
  }),
);
