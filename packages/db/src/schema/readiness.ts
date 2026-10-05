import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ReadinessCriterion, ReadinessEvaluation } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { contextManifests } from "./context_manifests.js";

export const readinessRequirements = pgTable("readiness_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  requirementKey: text("requirement_key").notNull(),
  name: text("name").notNull(),
  actionClass: text("action_class").notNull(),
  version: integer("version").notNull(),
  criteria: jsonb("criteria_json").$type<ReadinessCriterion[]>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  versionUq: uniqueIndex("readiness_requirements_company_key_version_uq").on(t.companyId, t.requirementKey, t.version),
  versionCheck: check("readiness_requirements_version_check", sql`${t.version} > 0`),
  criteriaCheck: check("readiness_requirements_criteria_check", sql`jsonb_typeof(${t.criteria}) = 'array' and jsonb_array_length(${t.criteria}) between 1 and 32`),
  companyActionIdx: index("readiness_requirements_company_action_idx").on(t.companyId, t.actionClass),
}));

export const readinessAssessments = pgTable("readiness_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull(),
  principalId: text("principal_id").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  actionClass: text("action_class").notNull(),
  riskClass: text("risk_class").notNull(),
  status: text("status").notNull(),
  requirementSnapshotHash: text("requirement_snapshot_hash").notNull(),
  policySnapshotHash: text("policy_snapshot_hash").notNull(),
  contextManifestId: uuid("context_manifest_id"),
  requirementSnapshot: jsonb("requirement_snapshot_json").notNull(),
  assessment: jsonb("assessment_json").$type<ReadinessEvaluation>().notNull(),
  assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => ({
  companyIdUq: unique("readiness_assessments_company_id_uq").on(t.companyId, t.id),
  agentFk: foreignKey({ name: "readiness_assessments_company_agent_fk", columns: [t.companyId, t.agentId], foreignColumns: [agents.companyId, agents.id] }),
  manifestFk: foreignKey({ name: "readiness_assessments_company_manifest_fk", columns: [t.companyId, t.contextManifestId], foreignColumns: [contextManifests.companyId, contextManifests.id] }),
  principalIdx: index("readiness_assessments_company_principal_idx").on(t.companyId, t.principalId, t.assessedAt),
  statusCheck: check("readiness_assessments_status_check", sql`${t.status} in ('ready','ready_with_warnings','review_required','blocked','unknown')`),
  actionCheck: check("readiness_assessments_action_check", sql`${t.actionClass} in ('internal_draft','external_communication','data_mutation','financial_commitment','person_decision','destructive_action','restricted_processing')`),
  riskCheck: check("readiness_assessments_risk_check", sql`${t.riskClass} in ('low','material','high')`),
  expiryCheck: check("readiness_assessments_expiry_check", sql`${t.expiresAt} > ${t.assessedAt}`),
  hashCheck: check("readiness_assessments_hash_check", sql`${t.requirementSnapshotHash} ~ '^[0-9a-f]{64}$' and ${t.policySnapshotHash} ~ '^[0-9a-f]{64}$'`),
}));

export const knowledgeQualityFindings = pgTable("knowledge_quality_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  assessmentId: uuid("assessment_id").notNull(),
  findingHash: text("finding_hash").notNull(),
  qualityDimension: text("quality_dimension").notNull(),
  requirementKey: text("requirement_key").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull().default("open"),
  summary: text("summary").notNull(),
  evidenceRefs: jsonb("evidence_refs_json").notNull(),
  ruleVersion: text("rule_version").notNull(),
  resolutionRef: uuid("resolution_ref"),
  resolutionReason: text("resolution_reason"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  assessmentFk: foreignKey({ name: "knowledge_quality_findings_company_assessment_fk", columns: [t.companyId, t.assessmentId], foreignColumns: [readinessAssessments.companyId, readinessAssessments.id] }).onDelete("cascade"),
  findingUq: uniqueIndex("knowledge_quality_findings_assessment_hash_uq").on(t.assessmentId, t.findingHash),
  statusCheck: check("knowledge_quality_findings_status_check", sql`${t.status} in ('open','acknowledged','resolved','suppressed_with_reason')`),
  resolutionCheck: check("knowledge_quality_findings_resolution_check", sql`${t.status} <> 'resolved' or (${t.resolutionRef} is not null and ${t.resolvedAt} is not null and ${t.resolutionReason} is not null)`),
  companyStatusIdx: index("knowledge_quality_findings_company_status_idx").on(t.companyId, t.status),
}));
