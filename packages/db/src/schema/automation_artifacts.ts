import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AutomationArtifactGateReport,
  AutomationArtifactKind,
  AutomationArtifactLanguage,
  AutomationArtifactStatus,
  WorkflowJsonSchema,
  WorkflowRiskClass,
  WorkflowSideEffectClass,
} from "@paperclipai/shared";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { workflows } from "./workflows.js";

export const automationArtifacts = pgTable(
  "automation_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    kind: text("kind").$type<AutomationArtifactKind>().notNull(),
    language: text("language").$type<AutomationArtifactLanguage>(),
    inputSchema: jsonb("input_schema")
      .$type<WorkflowJsonSchema>()
      .notNull()
      .default({}),
    outputSchema: jsonb("output_schema")
      .$type<WorkflowJsonSchema>()
      .notNull()
      .default({}),
    riskClass: text("risk_class").$type<WorkflowRiskClass>().notNull(),
    sideEffectClass: text("side_effect_class")
      .$type<WorkflowSideEffectClass>()
      .notNull(),
    status: text("status")
      .$type<AutomationArtifactStatus>()
      .notNull()
      .default("candidate"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id"),
    createdByOptimizerSuggestionId: uuid("created_by_optimizer_suggestion_id"),
    originWorkflowId: uuid("origin_workflow_id"),
    originNodeId: text("origin_node_id"),
    latestVersionId: uuid("latest_version_id"),
    successCount: integer("success_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    companyIdIdUq: uniqueIndex("automation_artifacts_company_id_id_uq").on(
      table.companyId,
      table.id,
    ),
    originWorkflowFk: foreignKey({
      name: "automation_artifacts_company_origin_workflow_fk",
      columns: [table.companyId, table.originWorkflowId],
      foreignColumns: [workflows.companyId, workflows.id],
    }),
    latestVersionFk: foreignKey({
      name: "automation_artifacts_company_latest_version_fk",
      columns: [table.companyId, table.latestVersionId],
      foreignColumns: [
        automationArtifactVersions.companyId as AnyPgColumn,
        automationArtifactVersions.id as AnyPgColumn,
      ],
    }),
    companyStatusUpdatedIdx: index(
      "automation_artifacts_company_status_updated_idx",
    ).on(table.companyId, table.status, table.updatedAt),
    companyKindIdx: index("automation_artifacts_company_kind_idx").on(
      table.companyId,
      table.kind,
    ),
    companyOriginWorkflowIdx: index(
      "automation_artifacts_company_origin_workflow_idx",
    ).on(table.companyId, table.originWorkflowId),
    kindCheck: check(
      "automation_artifacts_kind_check",
      sql`${table.kind} in ('expression','transform','typescript','python','tool_chain','subworkflow')`,
    ),
    languageCheck: check(
      "automation_artifacts_language_check",
      sql`(${table.kind} = 'typescript' and ${table.language} = 'typescript')
        or (${table.kind} = 'python' and ${table.language} = 'python')
        or (${table.kind} not in ('typescript','python') and ${table.language} is null)`,
    ),
    statusCheck: check(
      "automation_artifacts_status_check",
      sql`${table.status} in ('candidate','testing','shadow','active','deprecated','revoked','failed')`,
    ),
    riskCheck: check(
      "automation_artifacts_risk_class_check",
      sql`${table.riskClass} in ('C0','C1','C2','C3','C4')`,
    ),
    sideEffectCheck: check(
      "automation_artifacts_side_effect_class_check",
      sql`${table.sideEffectClass} in ('pure','read','write','destructive','external_communication','financial','privileged')`,
    ),
    creatorCheck: check(
      "automation_artifacts_creator_check",
      sql`num_nonnulls(${table.createdByAgentId}, ${table.createdByUserId}, ${table.createdByOptimizerSuggestionId}) <= 1`,
    ),
    originCheck: check(
      "automation_artifacts_origin_check",
      sql`${table.originNodeId} is null or ${table.originWorkflowId} is not null`,
    ),
    countersCheck: check(
      "automation_artifacts_counters_check",
      sql`${table.successCount} >= 0 and ${table.failureCount} >= 0`,
    ),
    archiveCheck: check(
      "automation_artifacts_archive_check",
      sql`${table.archivedAt} is null or ${table.status} in ('deprecated','revoked')`,
    ),
  }),
);

export const automationArtifactVersions = pgTable(
  "automation_artifact_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    sourceCode: text("source_code").notNull(),
    inputSchema: jsonb("input_schema")
      .$type<WorkflowJsonSchema>()
      .notNull()
      .default({}),
    outputSchema: jsonb("output_schema")
      .$type<WorkflowJsonSchema>()
      .notNull()
      .default({}),
    dependencyManifest: jsonb("dependency_manifest")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    testSpec: jsonb("test_spec")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    validationReport: jsonb("validation_report")
      .$type<AutomationArtifactGateReport | null>(),
    securityReport: jsonb("security_report")
      .$type<AutomationArtifactGateReport | null>(),
    contentHash: text("content_hash").notNull(),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyIdIdUq: uniqueIndex(
      "automation_artifact_versions_company_id_id_uq",
    ).on(table.companyId, table.id),
    companyArtifactFk: foreignKey({
      name: "automation_artifact_versions_company_artifact_fk",
      columns: [table.companyId, table.artifactId],
      foreignColumns: [automationArtifacts.companyId, automationArtifacts.id],
    }).onDelete("cascade"),
    artifactVersionUq: uniqueIndex(
      "automation_artifact_versions_artifact_version_uq",
    ).on(table.artifactId, table.versionNumber),
    artifactContentHashUq: uniqueIndex(
      "automation_artifact_versions_artifact_content_hash_uq",
    ).on(table.artifactId, table.contentHash),
    companyArtifactCreatedIdx: index(
      "automation_artifact_versions_company_artifact_created_idx",
    ).on(table.companyId, table.artifactId, table.createdAt),
    versionCheck: check(
      "automation_artifact_versions_version_check",
      sql`${table.versionNumber} >= 1`,
    ),
    hashCheck: check(
      "automation_artifact_versions_content_hash_check",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
    sourceSizeCheck: check(
      "automation_artifact_versions_source_size_check",
      sql`char_length(${table.sourceCode}) between 1 and 1000000`,
    ),
    creatorCheck: check(
      "automation_artifact_versions_creator_check",
      sql`num_nonnulls(${table.createdByAgentId}, ${table.createdByUserId}) <= 1`,
    ),
  }),
);
