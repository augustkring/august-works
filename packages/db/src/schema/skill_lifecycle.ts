import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { SkillEvalRubric } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { companySkills, companySkillVersions, companySkillTestRuns } from "./company_skills.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const companySkillDependencies = pgTable("company_skill_dependencies", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), skillId: uuid("skill_id").notNull(), skillVersionId: uuid("skill_version_id").notNull(),
  dependencyType: text("dependency_type").notNull(), dependencyRef: text("dependency_ref").notNull(), dependencyVersion: text("dependency_version").notNull(), required: boolean("required").notNull().default(true),
  status: text("status").notNull().default("current"), invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ versionFk: foreignKey({ columns: [t.companyId, t.skillId, t.skillVersionId], foreignColumns: [companySkillVersions.companyId, companySkillVersions.companySkillId, companySkillVersions.id] }).onDelete("cascade"), uniqueDependency: unique("company_skill_dependencies_version_ref_uq").on(t.skillVersionId, t.dependencyType, t.dependencyRef), lookup: index("company_skill_dependencies_lookup_idx").on(t.companyId, t.dependencyType, t.dependencyRef), stateCheck: check("company_skill_dependencies_state_check", sql`${t.status} in ('current','changed','missing')`) }));

export const companySkillEvalSuites = pgTable("company_skill_eval_suites", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), skillId: uuid("skill_id").notNull(), name: text("name").notNull(),
  requiredForPromotion: boolean("required_for_promotion").notNull().default(true), caseSetHash: text("case_set_hash").notNull(), createdByUserId: text("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ skillFk: foreignKey({ columns: [t.companyId, t.skillId], foreignColumns: [companySkills.companyId, companySkills.id] }).onDelete("cascade"), companyIdUnique: unique("company_skill_eval_suites_company_id_uq").on(t.companyId, t.id), skillIdx: index("company_skill_eval_suites_skill_idx").on(t.companyId, t.skillId) }));
export const companySkillEvalCases = pgTable("company_skill_eval_cases", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), suiteId: uuid("suite_id").notNull(), name: text("name").notNull(), input: text("input").notNull(),
  shouldTrigger: boolean("should_trigger").notNull(), risk: text("risk").notNull(), rubric: jsonb("rubric").$type<SkillEvalRubric>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ suiteFk: foreignKey({ columns: [t.companyId, t.suiteId], foreignColumns: [companySkillEvalSuites.companyId, companySkillEvalSuites.id] }).onDelete("cascade"), companySuiteIdUnique: unique("company_skill_eval_cases_company_suite_id_uq").on(t.companyId, t.suiteId, t.id), suiteIdx: index("company_skill_eval_cases_suite_idx").on(t.companyId, t.suiteId) }));
export const companySkillEvalRuns = pgTable("company_skill_eval_runs", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), skillId: uuid("skill_id").notNull(), suiteId: uuid("suite_id").notNull(),
  candidateVersionId: uuid("candidate_version_id").notNull(), championVersionId: uuid("champion_version_id"), trials: integer("trials").notNull(), caseSetHash: text("case_set_hash").notNull(),
  status: text("status").notNull().default("running"), agentSnapshot: jsonb("agent_snapshot").$type<Record<string, unknown>>(), aggregate: jsonb("aggregate").$type<Record<string, unknown>>(),
  createdByUserId: text("created_by_user_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => ({ suiteFk: foreignKey({ columns: [t.companyId, t.suiteId], foreignColumns: [companySkillEvalSuites.companyId, companySkillEvalSuites.id] }).onDelete("cascade"), candidateFk: foreignKey({ columns: [t.companyId, t.skillId, t.candidateVersionId], foreignColumns: [companySkillVersions.companyId, companySkillVersions.companySkillId, companySkillVersions.id] }), championFk: foreignKey({ columns: [t.companyId, t.skillId, t.championVersionId], foreignColumns: [companySkillVersions.companyId, companySkillVersions.companySkillId, companySkillVersions.id] }), companySuiteIdUnique: unique("company_skill_eval_runs_company_suite_id_uq").on(t.companyId, t.suiteId, t.id), skillIdx: index("company_skill_eval_runs_skill_idx").on(t.companyId, t.skillId), statusCheck: check("company_skill_eval_runs_state_check", sql`${t.status} in ('running','passed','failed','inconclusive','cancelled')`) }));
export const companySkillEvalScores = pgTable("company_skill_eval_scores", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), suiteId: uuid("suite_id").notNull(), evalRunId: uuid("eval_run_id").notNull(), caseId: uuid("case_id").notNull(), trial: integer("trial").notNull(), arm: text("arm").notNull(),
  testRunId: uuid("test_run_id").notNull(), scores: jsonb("scores").$type<Record<string, unknown>>().notNull(),
  judgeUserId: text("judge_user_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ traceFk: foreignKey({ name: "company_skill_eval_scores_company_trace_fk", columns: [t.companyId, t.testRunId], foreignColumns: [companySkillTestRuns.companyId, companySkillTestRuns.id] }), caseFk: foreignKey({ columns: [t.companyId, t.suiteId, t.caseId], foreignColumns: [companySkillEvalCases.companyId, companySkillEvalCases.suiteId, companySkillEvalCases.id] }), runFk: foreignKey({ columns: [t.companyId, t.suiteId, t.evalRunId], foreignColumns: [companySkillEvalRuns.companyId, companySkillEvalRuns.suiteId, companySkillEvalRuns.id] }).onDelete("cascade"), uniqueObservation: unique("company_skill_eval_scores_observation_uq").on(t.evalRunId, t.caseId, t.trial, t.arm), uniqueTrace: unique("company_skill_eval_scores_trace_uq").on(t.evalRunId, t.testRunId), armCheck: check("company_skill_eval_scores_arm_check", sql`${t.arm} in ('champion','candidate')`) }));

export const companySkillUsageEvents = pgTable("company_skill_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), runId: uuid("run_id").notNull(), agentId: uuid("agent_id").notNull(),
  skillId: uuid("skill_id").notNull(), skillVersionId: uuid("skill_version_id").notNull(), selectionReason: text("selection_reason").notNull(), stage: text("stage").notNull(), outcome: text("outcome").notNull().default("unknown"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ runFk: foreignKey({ name: "company_skill_usage_events_company_agent_run_fk", columns: [t.companyId, t.agentId, t.runId], foreignColumns: [heartbeatRuns.companyId, heartbeatRuns.agentId, heartbeatRuns.id] }), versionFk: foreignKey({ columns: [t.companyId, t.skillId, t.skillVersionId], foreignColumns: [companySkillVersions.companyId, companySkillVersions.companySkillId, companySkillVersions.id] }), agentFk: foreignKey({ columns: [t.companyId, t.agentId], foreignColumns: [agents.companyId, agents.id] }), uniqueEvent: unique("company_skill_usage_events_run_stage_uq").on(t.runId, t.skillVersionId, t.stage), skillIdx: index("company_skill_usage_events_skill_idx").on(t.companyId, t.skillId, t.createdAt), stageCheck: check("company_skill_usage_events_stage_check", sql`${t.stage} in ('offered','selected','loaded','used','completed','corrected','failure')`) }));
