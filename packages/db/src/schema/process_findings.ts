import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { CreateProcessFinding, ProcessFindingFacts, ProcessFindingState } from "@paperclipai/shared";
import { processAnalysisRuns } from "./process_analysis.js";

export const processFindings = pgTable("process_findings", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(),
  analysisRunId: uuid("analysis_run_id").notNull(), definitionId: uuid("definition_id").notNull(),
  findingType: text("finding_type").$type<CreateProcessFinding["findingType"]>().notNull(),
  objectType: text("object_type").$type<CreateProcessFinding["objectType"]>(), variantHash: text("variant_hash"),
  severity: text("severity").$type<CreateProcessFinding["severity"]>().notNull(),
  interpretation: text("interpretation").notNull(), summary: text("summary").notNull(),
  facts: jsonb("facts_json").$type<ProcessFindingFacts>().notNull(), contentHash: text("content_hash").notNull(),
  definitionHash: text("definition_hash").notNull(), eventSetHash: text("event_set_hash").notNull(), fingerprint: text("fingerprint").notNull(),
  status: text("status").$type<ProcessFindingState>().notNull().default("OPEN"), version: integer("version").notNull().default(1),
  createdBy: text("created_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, t => ({
  tenantUq: unique("process_findings_tenant_id_uq").on(t.companyId, t.id),
  fingerprintUq: unique("process_findings_material_uq").on(t.companyId, t.analysisRunId, t.fingerprint),
  runFk: foreignKey({ name: "process_findings_run_fk", columns: [t.companyId, t.analysisRunId], foreignColumns: [processAnalysisRuns.companyId, processAnalysisRuns.id] }).onDelete("cascade"),
  runIdx: index("process_findings_run_idx").on(t.companyId, t.analysisRunId, t.id),
  stateCheck: check("process_findings_state_check", sql`${t.version}>0 and ${t.status} in ('OPEN','ACKNOWLEDGED','INVESTIGATING','RESOLVED','SUPPRESSED_WITH_REASON') and (${t.status}='RESOLVED')=(${t.resolvedAt} is not null)`),
  scopeCheck: check("process_findings_scope_check", sql`${t.findingType} in ('missing_process_data','rework','avoidable_wait','bottleneck','unusual_variant') and (${t.findingType}='missing_process_data')=(${t.objectType} is null) and (${t.objectType} is null or ${t.objectType} in ('issue','project'))`),
  variantCheck: check("process_findings_variant_check", sql`(${t.findingType}='unusual_variant')=(${t.variantHash} is not null) and (${t.variantHash} is null or ${t.variantHash} ~ '^[0-9a-f]{64}$')`),
  evidenceCheck: check("process_findings_evidence_check", sql`${t.contentHash} ~ '^[0-9a-f]{64}$' and ${t.definitionHash} ~ '^[0-9a-f]{64}$' and ${t.eventSetHash} ~ '^[0-9a-f]{64}$' and ${t.fingerprint} ~ '^[0-9a-f]{64}$' and ${t.expiresAt}>${t.createdAt} and ${t.severity} in ('low','medium','high') and jsonb_typeof(${t.facts})='object'`),
}));
export const processFindingTransitions = pgTable("process_finding_transitions", {
  companyId: uuid("company_id").notNull(), findingId: uuid("finding_id").notNull(), version: integer("version").notNull(),
  fromStatus: text("from_status").$type<ProcessFindingState>(), toStatus: text("to_status").$type<ProcessFindingState>().notNull(),
  reason: text("reason").notNull(), recordedBy: text("recorded_by").notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  revisionUq: unique("process_finding_transitions_revision_uq").on(t.companyId, t.findingId, t.version),
  findingFk: foreignKey({ name: "process_finding_transitions_finding_fk", columns: [t.companyId, t.findingId], foreignColumns: [processFindings.companyId, processFindings.id] }).onDelete("cascade"),
  reasonCheck: check("process_finding_transition_reason_check", sql`${t.version}>0 and length(btrim(${t.reason})) between 10 and 2000 and ${t.toStatus} in ('OPEN','ACKNOWLEDGED','INVESTIGATING','RESOLVED','SUPPRESSED_WITH_REASON')`),
}));
