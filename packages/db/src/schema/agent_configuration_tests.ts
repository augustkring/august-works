import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, uniqueIndex, foreignKey, check } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { orchestrationPlans } from "./orchestration.js";

/** Immutable candidate/decision links. Native runs, documents, spend receipts
 * and verification remain the authoritative execution/result owners. */
export const agentConfigurationTests = pgTable("agent_configuration_tests", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // The insert guard proves the current creator/draft. Keep the opaque audit
  // references if that private payload is erased, like the Native cost ledger.
  draftId: uuid("draft_id").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  requestId: uuid("request_id").notNull(), requestHash: text("request_hash").notNull(),
  draftVersion: integer("draft_version").notNull(), scenarioIndex: integer("scenario_index").notNull(),
  agentId: uuid("agent_id").notNull(), runId: uuid("run_id").notNull(), planId: uuid("plan_id").notNull(),
  runtimeBindingId: uuid("runtime_binding_id").notNull(), providerBindingId: uuid("provider_binding_id").notNull(),
  candidateHash: text("candidate_hash").notNull(), configurationHash: text("configuration_hash").notNull(),
  authorityHash: text("authority_hash").notNull(), reviewHash: text("review_hash").notNull(),
  maximumCostMinor: integer("maximum_cost_minor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  request: uniqueIndex("agent_configuration_tests_request_uq").on(table.companyId, table.createdByUserId, table.requestId),
  run: uniqueIndex("agent_configuration_tests_run_uq").on(table.companyId, table.runId),
  agent: foreignKey({ columns: [table.companyId, table.agentId], foreignColumns: [agents.companyId, agents.id] }),
  runTarget: foreignKey({ columns: [table.companyId, table.agentId, table.runId], foreignColumns: [heartbeatRuns.companyId, heartbeatRuns.agentId, heartbeatRuns.id] }),
  plan: foreignKey({ columns: [table.companyId, table.planId], foreignColumns: [orchestrationPlans.companyId, orchestrationPlans.id] }),
  counters: check("agent_configuration_tests_counter_check", sql`${table.draftVersion}>0 and ${table.scenarioIndex} between 0 and 9 and ${table.maximumCostMinor} between 0 and 1000000`),
  hashes: check("agent_configuration_tests_hash_check", sql`${table.requestHash} ~ '^[a-f0-9]{64}$' and ${table.candidateHash} ~ '^[a-f0-9]{64}$' and ${table.configurationHash} ~ '^[a-f0-9]{64}$' and ${table.authorityHash} ~ '^[a-f0-9]{64}$' and ${table.reviewHash} ~ '^[a-f0-9]{64}$'`),
}));
