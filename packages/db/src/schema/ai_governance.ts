import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  foreignKey,
  unique,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  UseCasePurpose,
  OversightProfile,
  UseCaseAssessment,
  GovernanceObligation,
  AIUseCaseView,
} from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
const times = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const humanOversightProfiles = pgTable(
  "human_oversight_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    profile: jsonb("profile").$type<OversightProfile>().notNull(),
    profileHash: text("profile_hash").notNull(),
    status: text("status")
      .$type<"active" | "revoked">()
      .notNull()
      .default("active"),
    createdByUserId: text("created_by_user_id").notNull(),
    ...times(),
  },
  (t) => ({
    tenantUq: unique("oversight_profile_tenant_uq").on(t.companyId, t.id),
    stateCheck: check(
      "oversight_profile_state_check",
      sql`${t.status} in ('active','revoked')`,
    ),
  }),
);

export const aiUseCases = pgTable(
  "ai_use_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    key: text("key").notNull(),
    purposeVersion: integer("purpose_version").notNull().default(1),
    version: integer("version").notNull().default(1),
    status: text("status")
      .$type<AIUseCaseView["status"]>()
      .notNull()
      .default("draft"),
    ownerUserId: text("owner_user_id").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }).notNull(),
    ...times(),
  },
  (t) => ({
    tenantUq: unique("ai_use_case_tenant_uq").on(t.companyId, t.id),
    keyUq: unique("ai_use_case_company_key_uq").on(t.companyId, t.key),
    stateCheck: check(
      "ai_use_case_state_check",
      sql`${t.status} in ('draft','assessing','approved','restricted','suspended','retired')`,
    ),
    counterCheck: check(
      "ai_use_case_version_check",
      sql`${t.purposeVersion}>0 and ${t.version}>0`,
    ),
    reviewIdx: index("ai_use_case_review_idx").on(t.status, t.nextReviewAt),
  }),
);
export const aiUseCaseVersions = pgTable(
  "ai_use_case_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    useCaseId: uuid("use_case_id").notNull(),
    purposeVersion: integer("purpose_version").notNull(),
    purpose: jsonb("purpose").$type<UseCasePurpose>().notNull(),
    purposeHash: text("purpose_hash").notNull(),
    oversightProfileId: uuid("oversight_profile_id").notNull(),
    oversightProfileHash: text("oversight_profile_hash").notNull(),
    changeClassification: text("change_classification").notNull(),
    changeReason: text("change_reason").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    versionUq: unique("ai_use_case_purpose_version_uq").on(
      t.companyId,
      t.useCaseId,
      t.purposeVersion,
    ),
    caseFk: foreignKey({
      columns: [t.companyId, t.useCaseId],
      foreignColumns: [aiUseCases.companyId, aiUseCases.id],
    }),
    oversightFk: foreignKey({
      columns: [t.companyId, t.oversightProfileId],
      foreignColumns: [
        humanOversightProfiles.companyId,
        humanOversightProfiles.id,
      ],
    }),
  }),
);
export const aiUseCaseAssessments = pgTable(
  "ai_use_case_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    useCaseId: uuid("use_case_id").notNull(),
    purposeVersion: integer("purpose_version").notNull(),
    assessment: jsonb("assessment").$type<UseCaseAssessment>().notNull(),
    assessmentHash: text("assessment_hash").notNull(),
    assessedByUserId: text("assessed_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantUq: unique("ai_assessment_tenant_uq").on(t.companyId, t.id),
    versionFk: foreignKey({
      columns: [t.companyId, t.useCaseId, t.purposeVersion],
      foreignColumns: [
        aiUseCaseVersions.companyId,
        aiUseCaseVersions.useCaseId,
        aiUseCaseVersions.purposeVersion,
      ],
    }),
    caseIdx: index("ai_assessment_case_idx").on(
      t.companyId,
      t.useCaseId,
      t.purposeVersion,
    ),
  }),
);
export const aiUseCaseDeployments = pgTable(
  "ai_use_case_deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    useCaseId: uuid("use_case_id").notNull(),
    purposeVersion: integer("purpose_version").notNull(),
    issueId: uuid("issue_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    purposeHash: text("purpose_hash").notNull(),
    authorityHash: text("authority_hash").notNull(),
    status: text("status")
      .$type<"active" | "review_required" | "suspended" | "retired">()
      .notNull()
      .default("review_required"),
    createdByUserId: text("created_by_user_id").notNull(),
    ...times(),
  },
  (t) => ({
    tenantUq: unique("ai_deployment_tenant_uq").on(t.companyId, t.id),
    taskHistoryIdx: index("ai_deployment_task_history_idx").on(
      t.companyId,
      t.issueId,
    ),
    taskLiveUq: uniqueIndex("ai_deployment_task_live_uq")
      .on(t.companyId, t.issueId)
      .where(sql`${t.status}<>'retired'`),
    versionFk: foreignKey({
      columns: [t.companyId, t.useCaseId, t.purposeVersion],
      foreignColumns: [
        aiUseCaseVersions.companyId,
        aiUseCaseVersions.useCaseId,
        aiUseCaseVersions.purposeVersion,
      ],
    }),
    taskFk: foreignKey({
      columns: [t.companyId, t.issueId],
      foreignColumns: [issues.companyId, issues.id],
    }),
    agentFk: foreignKey({
      columns: [t.companyId, t.agentId],
      foreignColumns: [agents.companyId, agents.id],
    }),
    stateCheck: check(
      "ai_deployment_state_check",
      sql`${t.status} in ('active','review_required','suspended','retired')`,
    ),
  }),
);
export const governanceObligations = pgTable(
  "governance_obligations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    obligation: jsonb("obligation").$type<GovernanceObligation>().notNull(),
    obligationHash: text("obligation_hash").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    lastReviewedAt: timestamp("last_reviewed_at", {
      withTimezone: true,
    }).notNull(),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }).notNull(),
    ...times(),
  },
  (t) => ({
    tenantUq: unique("governance_obligation_tenant_uq").on(t.companyId, t.id),
    reviewIdx: index("governance_obligation_review_idx").on(t.nextReviewAt),
  }),
);
export const governanceStopActions = pgTable(
  "governance_stop_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    deploymentId: uuid("deployment_id").notNull(),
    runId: uuid("run_id").notNull(),
    status: text("status")
      .$type<"queued" | "delivering" | "delivered">()
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    errorCode: text("error_code"),
    ...times(),
  },
  (t) => ({
    runUq: unique("governance_stop_run_uq").on(t.companyId, t.runId),
    deploymentFk: foreignKey({
      columns: [t.companyId, t.deploymentId],
      foreignColumns: [aiUseCaseDeployments.companyId, aiUseCaseDeployments.id],
    }),
    runFk: foreignKey({
      columns: [t.companyId, t.runId],
      foreignColumns: [heartbeatRuns.companyId, heartbeatRuns.id],
    }),
    stateCheck: check(
      "governance_stop_state_check",
      sql`${t.status} in ('queued','delivering','delivered')`,
    ),
    countCheck: check("governance_stop_attempts_check", sql`${t.attempts}>=0`),
  }),
);
export const aiUseCaseChangeEvents = pgTable(
  "ai_use_case_change_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    useCaseId: uuid("use_case_id").notNull(),
    purposeVersion: integer("purpose_version").notNull(),
    classification: text("classification").notNull(),
    reasonCode: text("reason_code").notNull(),
    sourceRefHash: text("source_ref_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    versionFk: foreignKey({
      columns: [t.companyId, t.useCaseId, t.purposeVersion],
      foreignColumns: [
        aiUseCaseVersions.companyId,
        aiUseCaseVersions.useCaseId,
        aiUseCaseVersions.purposeVersion,
      ],
    }),
    caseIdx: index("ai_use_case_change_event_idx").on(
      t.companyId,
      t.useCaseId,
      t.createdAt,
    ),
  }),
);
