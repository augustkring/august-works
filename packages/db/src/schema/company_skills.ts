import { documentRevisions } from "./document_revisions.js";
import {
  type AnyPgColumn,
  type PgTableExtraConfig,
  check,
  foreignKey,
  unique,
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { CompanySkillFileInventoryEntry, CompanySkillSharingScope, SkillEvaluationBinding } from "@paperclipai/shared";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { folders } from "./folders.js";

export const companySkills = pgTable(
  "company_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    key: text("key").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    markdown: text("markdown").notNull(),
    sourceType: text("source_type").notNull().default("local_path"),
    sourceLocator: text("source_locator"),
    sourceRef: text("source_ref"),
    trustLevel: text("trust_level").notNull().default("markdown_only"),
    compatibility: text("compatibility").notNull().default("compatible"),
    fileInventory: jsonb("file_inventory").$type<Array<Record<string, unknown>>>().notNull().default([]),
    iconUrl: text("icon_url"),
    color: text("color"),
    tagline: text("tagline"),
    authorName: text("author_name"),
    homepageUrl: text("homepage_url"),
    categories: text("categories").array().notNull().default([]),
    sharingScope: text("sharing_scope").$type<CompanySkillSharingScope>().notNull().default("company"),
    publicShareToken: text("public_share_token"),
    forkedFromSkillId: uuid("forked_from_skill_id").references((): AnyPgColumn => companySkills.id, { onDelete: "set null" }),
    forkedFromCompanyId: uuid("forked_from_company_id").references(() => companies.id, { onDelete: "set null" }),
    starCount: integer("star_count").notNull().default(0),
    installCount: integer("install_count").notNull().default(0),
    forkCount: integer("fork_count").notNull().default(0),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => companySkillVersions.id, { onDelete: "set null" }),
    lifecycleState: text("lifecycle_state").notNull().default("draft"),
    ownerAgentId: uuid("owner_agent_id"),
    activeVersionId: uuid("active_version_id"),
    headVersionId: uuid("head_version_id"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
    degradedReason: text("degraded_reason"),
    reviewPolicy: jsonb("review_policy").$type<{ reviewIntervalDays: number; stewardUserId: string | null }>().notNull().default({ reviewIntervalDays: 90, stewardUserId: null }),
    promotionPolicy: jsonb("promotion_policy").$type<{ allowAutonomousPromotion: boolean; minimumPairedTrials: number; minimumOutcomeScore: number; maximumCostRegressionRatio: number; requireHumanReview: boolean }>().notNull().default({ allowAutonomousPromotion: false, minimumPairedTrials: 2, minimumOutcomeScore: 0.9, maximumCostRegressionRatio: 1.25, requireHumanReview: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table): PgTableExtraConfig => ({
    companyIdUnique: unique("company_skills_company_id_uq").on(table.companyId, table.id),
    lifecycleCheck: check("company_skills_lifecycle_check", sql`${table.lifecycleState} in ('draft','proposed','testing','active','needs_revalidation','degraded','deprecated','revoked')`),
    ownerCompanyFk: foreignKey({ columns: [table.companyId, table.ownerAgentId], foreignColumns: [agents.companyId, agents.id] }),
    activeVersionFk: foreignKey({ columns: [table.companyId, table.id, table.activeVersionId], foreignColumns: [companySkillVersions.companyId, companySkillVersions.companySkillId, companySkillVersions.id] }),
    headVersionFk: foreignKey({ columns: [table.companyId, table.id, table.headVersionId], foreignColumns: [companySkillVersions.companyId, companySkillVersions.companySkillId, companySkillVersions.id] }),
    companyKeyUniqueIdx: uniqueIndex("company_skills_company_key_idx").on(table.companyId, table.key),
    companyNameIdx: index("company_skills_company_name_idx").on(table.companyId, table.name),
    companyFolderIdx: index("company_skills_company_folder_idx").on(table.companyId, table.folderId),
    companyCategoriesIdx: index("company_skills_company_categories_idx").using("gin", table.categories),
    companySharingScopeIdx: index("company_skills_company_sharing_scope_idx").on(table.companyId, table.sharingScope),
    companyCurrentVersionIdx: index("company_skills_company_current_version_idx").on(table.companyId, table.currentVersionId),
    companyForkedFromIdx: index("company_skills_company_forked_from_idx").on(table.companyId, table.forkedFromSkillId),
  }),
);

export type CompanySkillVersionFileInventoryEntry = CompanySkillFileInventoryEntry & {
  content: string;
};

export const companySkillVersions = pgTable(
  "company_skill_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    companySkillId: uuid("company_skill_id").notNull().references(() => companySkills.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    label: text("label"),
    releaseId: text("release_id"),
    releaseName: text("release_name"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    fileInventory: jsonb("file_inventory").$type<CompanySkillVersionFileInventoryEntry[]>().notNull().default([]),
    state: text("state").notNull().default("candidate"),
    visibility: text("visibility").notNull().default("company"),
    sourcePlaybookRevisionId: uuid("source_playbook_revision_id"),
    validationSummary: jsonb("validation_summary").$type<Record<string, unknown>>(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table): PgTableExtraConfig => ({
    sourcePlaybookRevisionFk: foreignKey({ name: "company_skill_versions_source_playbook_revision_fk", columns: [table.companyId, table.sourcePlaybookRevisionId], foreignColumns: [documentRevisions.companyId, documentRevisions.id] }),
    companySkillVersionUnique: unique("company_skill_versions_company_skill_id_uq").on(table.companyId, table.companySkillId, table.id),
    activeVersionUnique: uniqueIndex("company_skill_versions_one_active_idx").on(table.companySkillId).where(sql`${table.state} = 'active'`),
    stateCheck: check("company_skill_versions_state_check", sql`${table.state} in ('candidate','testing','validated','active','rejected','superseded')`),
    companySkillRevisionUniqueIdx: uniqueIndex("company_skill_versions_skill_revision_idx").on(
      table.companySkillId,
      table.revisionNumber,
    ),
    companySkillReleaseUniqueIdx: uniqueIndex("company_skill_versions_skill_release_idx")
      .on(table.companySkillId, table.releaseId)
      .where(sql`${table.releaseId} is not null`),
    companySkillCreatedIdx: index("company_skill_versions_company_skill_created_idx").on(
      table.companyId,
      table.companySkillId,
      table.createdAt,
    ),
  }),
);

export const companySkillStars = pgTable(
  "company_skill_stars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    companySkillId: uuid("company_skill_id").notNull().references(() => companySkills.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySkillAgentUniqueIdx: uniqueIndex("company_skill_stars_skill_agent_idx").on(table.companySkillId, table.agentId),
    companySkillUserUniqueIdx: uniqueIndex("company_skill_stars_skill_user_idx").on(table.companySkillId, table.userId),
    companySkillCreatedIdx: index("company_skill_stars_company_skill_created_idx").on(
      table.companyId,
      table.companySkillId,
      table.createdAt,
    ),
  }),
);

export const companySkillComments = pgTable(
  "company_skill_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    companySkillId: uuid("company_skill_id").notNull().references(() => companySkills.id, { onDelete: "cascade" }),
    parentCommentId: uuid("parent_comment_id").references((): AnyPgColumn => companySkillComments.id, { onDelete: "set null" }),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id"),
    body: text("body").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySkillCreatedIdx: index("company_skill_comments_company_skill_created_idx").on(
      table.companyId,
      table.companySkillId,
      table.createdAt,
    ),
    parentIdx: index("company_skill_comments_parent_idx").on(table.parentCommentId),
  }),
);

export const companySkillTestInputs = pgTable(
  "company_skill_test_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id").notNull().references(() => companySkills.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    content: text("content").notNull(),
    createdBy: text("created_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySkillNameIdx: index("company_skill_test_inputs_company_skill_name_idx").on(
      table.companyId,
      table.skillId,
      table.name,
    ),
    companySkillActiveIdx: index("company_skill_test_inputs_company_skill_active_idx").on(
      table.companyId,
      table.skillId,
      table.deletedAt,
    ),
  }),
);

export const companySkillTestRunTemplates = pgTable(
  "company_skill_test_run_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    body: text("body").notNull(),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    updatedByAgentId: uuid("updated_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    updatedByUserId: text("updated_by_user_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyActiveIdx: index("company_skill_test_run_templates_company_active_idx").on(
      table.companyId,
      table.deletedAt,
      table.name,
    ),
  }),
);

export const companySkillTestRuns = pgTable(
  "company_skill_test_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id").notNull().references(() => companySkills.id, { onDelete: "cascade" }),
    inputId: uuid("input_id").references(() => companySkillTestInputs.id, { onDelete: "set null" }),
    inputSnapshot: text("input_snapshot").notNull(),
    skillVersionId: uuid("skill_version_id").notNull().references(() => companySkillVersions.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "restrict" }),
    agentConfigSnapshot: jsonb("agent_config_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    evaluationContext: jsonb("evaluation_context").$type<SkillEvaluationBinding>(),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "restrict" }),
    templateId: text("template_id"),
    templateName: text("template_name"),
    templateBody: text("template_body"),
    renderedTemplateBody: text("rendered_template_body"),
    harnessIssueDescription: text("harness_issue_description").notNull().default(""),
    status: text("status").notNull().default("queued"),
    outputDocumentKey: text("output_document_key").notNull().default("output"),
    outputSnapshot: text("output_snapshot").notNull().default(""),
    error: text("error"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    harnessIssueExpiresAt: timestamp("harness_issue_expires_at", { withTimezone: true }),
    harnessIssueDeletedAt: timestamp("harness_issue_deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdUnique: unique("company_skill_test_runs_company_id_uq").on(table.companyId, table.id),
    evaluationBindingUnique: uniqueIndex("company_skill_test_runs_eval_binding_uq").on(table.companyId, sql`(${table.evaluationContext}->>'evaluationRunId')`, sql`(${table.evaluationContext}->>'caseId')`, sql`(${table.evaluationContext}->>'arm')`, sql`(${table.evaluationContext}->>'trial')`).where(sql`${table.evaluationContext} is not null`),
    companySkillCreatedIdx: index("company_skill_test_runs_company_skill_created_idx").on(
      table.companyId,
      table.skillId,
      table.createdAt,
    ),
    companyIssueIdx: uniqueIndex("company_skill_test_runs_company_issue_idx").on(table.companyId, table.issueId),
    companyInputCreatedIdx: index("company_skill_test_runs_company_input_created_idx").on(
      table.companyId,
      table.inputId,
      table.createdAt,
    ),
    companyStatusIdx: index("company_skill_test_runs_company_status_idx").on(table.companyId, table.status),
    companyHarnessIssueExpiresIdx: index("company_skill_test_runs_company_harness_expires_idx").on(
      table.companyId,
      table.harnessIssueExpiresAt,
    ),
  }),
);
