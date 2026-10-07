import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { CapturedDecisionEvidence, DecisionContextDefinition } from "@paperclipai/shared";
import { decisions } from "./decisions.js";
import { analyticalLineageManifests } from "./analytical_lineage.js";
import { forecastRuns } from "./business_forecasting.js";
import { businessScenarioRuns } from "./business_scenarios.js";

/** Native Decisions own this aggregate. No alternate choice or effect store. */
export const decisionContexts = pgTable("decision_contexts", {
  companyId: uuid("company_id").notNull(), decisionId: uuid("decision_id").notNull(),
  revision: integer("revision").notNull().default(0), preparedVersionId: uuid("prepared_version_id"),
}, t => ({
  decisionUq: unique("decision_contexts_decision_uq").on(t.companyId,t.decisionId),
  decisionFk: foreignKey({name:"decision_contexts_decision_fk",columns:[t.companyId,t.decisionId],foreignColumns:[decisions.companyId,decisions.id]}).onDelete("cascade"),
  revisionCheck: check("decision_contexts_revision_check",sql`${t.revision}>=0`),
}));
export const decisionContextVersions = pgTable("decision_context_versions", {
  id:uuid("id").primaryKey().defaultRandom(),companyId:uuid("company_id").notNull(),decisionId:uuid("decision_id").notNull(),revision:integer("revision").notNull(),
  definition:jsonb("definition_json").$type<DecisionContextDefinition>().notNull(),
  evidence:jsonb("captured_evidence_json").$type<CapturedDecisionEvidence[]>().notNull(),
  contentHash:text("content_hash").notNull(),decisionSpecHash:text("decision_spec_hash").notNull(),lineageManifestId:uuid("lineage_manifest_id").notNull(),
  createdBy:text("created_by").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull(),expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),
}, t=>({
  tenantUq:unique("decision_context_versions_tenant_uq").on(t.companyId,t.decisionId,t.id),revisionUq:unique("decision_context_versions_revision_uq").on(t.companyId,t.decisionId,t.revision),
  rootFk:foreignKey({name:"decision_context_versions_root_fk",columns:[t.companyId,t.decisionId],foreignColumns:[decisionContexts.companyId,decisionContexts.decisionId]}).onDelete("cascade"),
  lineageFk:foreignKey({name:"decision_context_versions_lineage_fk",columns:[t.companyId,t.lineageManifestId],foreignColumns:[analyticalLineageManifests.companyId,analyticalLineageManifests.id]}).onDelete("cascade"),
  contentCheck:check("decision_context_versions_content_check",sql`${t.revision}>0 and ${t.contentHash} ~ '^[0-9a-f]{64}$' and ${t.decisionSpecHash} ~ '^[0-9a-f]{64}$' and ${t.expiresAt}>${t.createdAt} and jsonb_typeof(${t.definition})='object' and jsonb_typeof(${t.evidence})='array'`),
}));
export const decisionContextPreparations = pgTable("decision_context_preparations", {
  companyId:uuid("company_id").notNull(),decisionId:uuid("decision_id").notNull(),versionId:uuid("version_id").notNull(),revision:integer("revision").notNull(),
  action:text("action").$type<"prepare"|"withdraw">().notNull(),rationale:text("rationale").notNull(),recordedBy:text("recorded_by").notNull(),recordedAt:timestamp("recorded_at",{withTimezone:true}).notNull().defaultNow(),
},t=>({
  receiptUq:unique("decision_context_preparations_revision_uq").on(t.companyId,t.decisionId,t.revision),
  versionFk:foreignKey({name:"decision_context_preparations_version_fk",columns:[t.companyId,t.decisionId,t.versionId],foreignColumns:[decisionContextVersions.companyId,decisionContextVersions.decisionId,decisionContextVersions.id]}).onDelete("cascade"),
  actionCheck:check("decision_context_preparations_action_check",sql`${t.revision}>0 and ${t.action} in ('prepare','withdraw') and length(${t.rationale}) between 10 and 2000`),
}));
export const decisionContextBindings = pgTable("decision_context_bindings", {
  companyId:uuid("company_id").notNull(),decisionId:uuid("decision_id").notNull(),versionId:uuid("version_id").notNull(),
  optionId:text("option_id").notNull(),contextHash:text("context_hash").notNull(),decisionSpecHash:text("decision_spec_hash").notNull(),frozenBy:text("frozen_by").notNull(),
  frozenAt:timestamp("frozen_at",{withTimezone:true}).notNull(),
},t=>({
  decisionUq:unique("decision_context_bindings_decision_uq").on(t.companyId,t.decisionId),
  versionFk:foreignKey({name:"decision_context_bindings_version_fk",columns:[t.companyId,t.decisionId,t.versionId],foreignColumns:[decisionContextVersions.companyId,decisionContextVersions.decisionId,decisionContextVersions.id]}).onDelete("cascade"),
  hashesCheck:check("decision_context_bindings_hashes_check",sql`${t.contextHash} ~ '^[0-9a-f]{64}$' and ${t.decisionSpecHash} ~ '^[0-9a-f]{64}$'`),
}));

// Tenant-scoped descendants index the same immutable typed aggregate. The SQL
// owner checks each payload against its exact version; they cannot diverge.
function materialColumns() { return {companyId:uuid("company_id").notNull(),decisionId:uuid("decision_id").notNull(),contextVersionId:uuid("context_version_id").notNull(),key:text("material_key").notNull()}; }
export const decisionEvidenceLinks=pgTable("decision_evidence_links",{...materialColumns(),payload:jsonb("payload_json").$type<DecisionContextDefinition["evidence"][number]>().notNull()},t=>({
  materialUq:unique("decision_evidence_links_material_uq").on(t.companyId,t.contextVersionId,t.key),
  versionFk:foreignKey({name:"decision_evidence_links_version_fk",columns:[t.companyId,t.decisionId,t.contextVersionId],foreignColumns:[decisionContextVersions.companyId,decisionContextVersions.decisionId,decisionContextVersions.id]}).onDelete("cascade"),
}));
/** Calculation owners erase dependent context prose through exact tenant FKs. */
export const decisionCalculationPins = pgTable("decision_calculation_pins", {
  ...materialColumns(), forecastRunId: uuid("forecast_run_id"), scenarioRunId: uuid("scenario_run_id"), sourceHash: text("source_hash").notNull(),
}, t => ({
  pinUq: unique("decision_calculation_pins_key_uq").on(t.companyId, t.contextVersionId, t.key),
  versionFk: foreignKey({ name: "decision_calculation_pins_version_fk", columns: [t.companyId, t.decisionId, t.contextVersionId], foreignColumns: [decisionContextVersions.companyId, decisionContextVersions.decisionId, decisionContextVersions.id] }).onDelete("cascade"),
  forecastFk: foreignKey({ name: "decision_calculation_pins_forecast_fk", columns: [t.companyId, t.forecastRunId], foreignColumns: [forecastRuns.companyId, forecastRuns.id] }).onDelete("cascade"),
  scenarioFk: foreignKey({ name: "decision_calculation_pins_scenario_fk", columns: [t.companyId, t.scenarioRunId], foreignColumns: [businessScenarioRuns.companyId, businessScenarioRuns.id] }).onDelete("cascade"),
  typeCheck: check("decision_calculation_pins_type_check", sql`(${t.forecastRunId} is null) <> (${t.scenarioRunId} is null) and ${t.sourceHash} ~ '^[0-9a-f]{64}$'`),
}));
export const decisionAssumptions=pgTable("decision_assumptions",{...materialColumns(),payload:jsonb("payload_json").$type<DecisionContextDefinition["assumptions"][number]>().notNull()},t=>({
  materialUq:unique("decision_assumptions_material_uq").on(t.companyId,t.contextVersionId,t.key),
  versionFk:foreignKey({name:"decision_assumptions_version_fk",columns:[t.companyId,t.decisionId,t.contextVersionId],foreignColumns:[decisionContextVersions.companyId,decisionContextVersions.decisionId,decisionContextVersions.id]}).onDelete("cascade"),
}));
export const decisionCriteria=pgTable("decision_criteria",{...materialColumns(),payload:jsonb("payload_json").$type<DecisionContextDefinition["criteria"][number]>().notNull()},t=>({
  materialUq:unique("decision_criteria_material_uq").on(t.companyId,t.contextVersionId,t.key),
  versionFk:foreignKey({name:"decision_criteria_version_fk",columns:[t.companyId,t.decisionId,t.contextVersionId],foreignColumns:[decisionContextVersions.companyId,decisionContextVersions.decisionId,decisionContextVersions.id]}).onDelete("cascade"),
}));
export const decisionExpectedOutcomes=pgTable("decision_expected_outcomes",{...materialColumns(),payload:jsonb("payload_json").$type<DecisionContextDefinition["expectedOutcomes"][number]>().notNull()},t=>({
  materialUq:unique("decision_expected_outcomes_material_uq").on(t.companyId,t.contextVersionId,t.key),
  versionFk:foreignKey({name:"decision_expected_outcomes_version_fk",columns:[t.companyId,t.decisionId,t.contextVersionId],foreignColumns:[decisionContextVersions.companyId,decisionContextVersions.decisionId,decisionContextVersions.id]}).onDelete("cascade"),
}));
