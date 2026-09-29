import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const contextManifests = pgTable(
  "context_manifests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    // These identifiers are retained as immutable provenance even if ordinary
    // runtime/task retention later removes the referenced row. Creation is
    // tenant-verified in contextManifestService before persistence.
    runId: uuid("run_id"),
    agentId: uuid("agent_id").notNull(),
    issueId: uuid("issue_id"),
    projectId: uuid("project_id"),

    queryHash: text("query_hash").notNull(),
    policySnapshotHash: text("policy_snapshot_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdIdUq: uniqueIndex("context_manifests_company_id_id_uq").on(
      table.companyId,
      table.id,
    ),
    companyRunCreatedIdx: index("context_manifests_company_run_created_idx").on(
      table.companyId,
      table.runId,
      table.createdAt,
    ),
    companyAgentCreatedIdx: index("context_manifests_company_agent_created_idx").on(
      table.companyId,
      table.agentId,
      table.createdAt,
    ),
    companyIssueCreatedIdx: index("context_manifests_company_issue_created_idx").on(
      table.companyId,
      table.issueId,
      table.createdAt,
    ),
    queryHashCheck: check(
      "context_manifests_query_hash_check",
      sql`${table.queryHash} ~ '^[0-9a-f]{64}$'`,
    ),
    policyHashCheck: check(
      "context_manifests_policy_snapshot_hash_check",
      sql`${table.policySnapshotHash} ~ '^[0-9a-f]{64}$'`,
    ),
  }),
);

export const contextManifestItems = pgTable(
  "context_manifest_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    manifestId: uuid("manifest_id").notNull(),

    sourceClass: text("source_class").notNull(),
    sourceProvider: text("source_provider").notNull(),
    sourceRef: text("source_ref").notNull(),
    sourceVersion: text("source_version"),
    contentHash: text("content_hash").notNull(),
    authorityDomain: text("authority_domain"),
    trustLevel: text("trust_level").notNull(),
    sensitivity: text("sensitivity").notNull(),

    rank: integer("rank").notNull(),
    selectionReason: text("selection_reason").notNull(),
    retrievalScore: doublePrecision("retrieval_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    manifestRankUq: uniqueIndex("context_manifest_items_manifest_rank_uq").on(
      table.manifestId,
      table.rank,
    ),
    companyManifestIdx: index("context_manifest_items_company_manifest_idx").on(
      table.companyId,
      table.manifestId,
    ),
    companySourceIdx: index("context_manifest_items_company_source_idx").on(
      table.companyId,
      table.sourceProvider,
      table.sourceRef,
    ),
    companyManifestFk: foreignKey({
      name: "context_manifest_items_company_manifest_fk",
      columns: [table.companyId, table.manifestId],
      foreignColumns: [contextManifests.companyId, contextManifests.id],
    }).onDelete("cascade"),
    sourceClassCheck: check(
      "context_manifest_items_source_class_check",
      sql`${table.sourceClass} in ('foundation', 'system_of_record', 'accepted_memory', 'private_memory', 'task', 'artifact', 'conversation', 'external_untrusted')`,
    ),
    trustLevelCheck: check(
      "context_manifest_items_trust_level_check",
      sql`${table.trustLevel} in ('high', 'medium', 'low', 'untrusted')`,
    ),
    sensitivityCheck: check(
      "context_manifest_items_sensitivity_check",
      sql`${table.sensitivity} in ('public', 'internal', 'confidential', 'restricted')`,
    ),
    rankCheck: check(
      "context_manifest_items_rank_check",
      sql`${table.rank} >= 0`,
    ),
    contentHashCheck: check(
      "context_manifest_items_content_hash_check",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
  }),
);
