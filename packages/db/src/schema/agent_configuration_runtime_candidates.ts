import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { authUsers } from "./auth.js";
import { agents } from "./agents.js";
import { agentConfigurationDrafts } from "./agent_configuration_drafts.js";

/** A saved selector and qualification identity, never a live binding or a
 * copied credential/configuration envelope. Original Agent/runtime owners
 * retain effective configuration and promotion. */
export const agentConfigurationRuntimeCandidates = pgTable("agent_configuration_runtime_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  draftId: uuid("draft_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  creationRequestId: uuid("creation_request_id").notNull(),
  creationRequestHash: text("creation_request_hash").notNull(),
  modelProfileId: uuid("model_profile_id").notNull(),
  profileHash: text("profile_hash").notNull(),
  baselineConfigurationHash: text("baseline_configuration_hash").notNull(),
  configurationHash: text("configuration_hash").notNull(),
  sourceSha: text("source_sha").notNull(),
  status: text("status").$type<"draft" | "testing" | "qualified" | "failed" | "unknown" | "retired">().notNull().default("draft"),
  qualificationRequestId: uuid("qualification_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  companyIdId: uniqueIndex("agent_configuration_runtime_candidates_company_id_id_uq").on(t.companyId, t.id),
  request: uniqueIndex("agent_configuration_runtime_candidates_request_uq").on(t.companyId, t.createdByUserId, t.creationRequestId),
  draft: foreignKey({ columns: [t.companyId, t.draftId], foreignColumns: [agentConfigurationDrafts.companyId, agentConfigurationDrafts.id] }).onDelete("cascade"),
  agent: foreignKey({ columns: [t.companyId, t.agentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("cascade"),
  owner: index("agent_configuration_runtime_candidates_draft_idx").on(t.companyId, t.draftId, t.createdAt),
  state: check("agent_configuration_runtime_candidates_state_check", sql`${t.status} in ('draft','testing','qualified','failed','unknown','retired')`),
  qualification: check("agent_configuration_runtime_candidates_qualification_check", sql`(${t.status}='qualified') = (${t.qualificationRequestId} is not null)`),
  hashes: check("agent_configuration_runtime_candidates_hashes_check", sql`${t.creationRequestHash} ~ '^[a-f0-9]{64}$' and ${t.profileHash} ~ '^[a-f0-9]{64}$'
    and ${t.baselineConfigurationHash} ~ '^[a-f0-9]{64}$' and ${t.configurationHash} ~ '^[a-f0-9]{64}$' and ${t.sourceSha} ~ '^[a-f0-9]{40}$'`),
}));

/** Original C4 request slots survive later attempts. No automatic transport
 * replay is implied by a pending/unknown receipt. Probe work and liabilities
 * remain in the existing Native run, plan and model reservation owners. */
export const agentRuntimeCandidateConformanceRequests = pgTable("agent_runtime_candidate_conformance_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  candidateId: uuid("candidate_id").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull(),
  requestHash: text("request_hash").notNull(),
  expectedDraftVersion: integer("expected_draft_version").notNull(),
  candidateHash: text("candidate_hash").notNull(),
  input: jsonb("input").$type<{ acknowledgeProviderRuns: true; maximumCostCents: number;
    isolationPeer: { companyId: string; agentId: string } }>().notNull(),
  status: text("status").$type<"pending" | "qualified" | "failed" | "unknown">().notNull().default("pending"),
  // Only bounded Native IDs/checks/accounting metadata belong here. No
  // provider prose, credentials, configuration or customer context is retained.
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, t => ({
  request: uniqueIndex("agent_runtime_candidate_conformance_requests_request_uq").on(t.companyId, t.createdByUserId, t.requestId),
  candidate: foreignKey({ columns: [t.companyId, t.candidateId], foreignColumns: [agentConfigurationRuntimeCandidates.companyId, agentConfigurationRuntimeCandidates.id] }).onDelete("cascade"),
  history: index("agent_runtime_candidate_conformance_requests_candidate_idx").on(t.companyId, t.candidateId, t.createdAt),
  state: check("agent_runtime_candidate_conformance_requests_state_check", sql`${t.status} in ('pending','qualified','failed','unknown')`),
  finished: check("agent_runtime_candidate_conformance_requests_finished_check", sql`(${t.status}='pending') = (${t.finishedAt} is null)`),
  version: check("agent_runtime_candidate_conformance_requests_version_check", sql`${t.expectedDraftVersion}>0`),
  hashes: check("agent_runtime_candidate_conformance_requests_hashes_check", sql`${t.requestHash} ~ '^[a-f0-9]{64}$' and ${t.candidateHash} ~ '^[a-f0-9]{64}$'`),
  bounded: check("agent_runtime_candidate_conformance_requests_evidence_check", sql`${t.evidence} is null or (jsonb_typeof(${t.evidence})='object' and octet_length(${t.evidence}::text)<=16384)`),
  inputBounded: check("agent_runtime_candidate_conformance_requests_input_check", sql`jsonb_typeof(${t.input})='object' and octet_length(${t.input}::text)<=1024`),
}));
