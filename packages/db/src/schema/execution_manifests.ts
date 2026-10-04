import { foreignKey, uniqueIndex, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AgentExecutionManifest, AgentExecutionScope } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { agentIdentities } from "./agent_identities.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { contextManifests } from "./context_manifests.js";

export const agentExecutionManifests = pgTable("agent_execution_manifests", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull(), agentId: uuid("agent_id").notNull(), agentIdentityId: uuid("agent_identity_id").notNull().references(() => agentIdentities.id),
  contextManifestId: uuid("context_manifest_id").notNull(), manifest: jsonb("manifest").$type<AgentExecutionManifest>().notNull(),
  policySnapshotHash: text("policy_snapshot_hash").notNull(), hash: text("hash").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ contextFk: foreignKey({ name: "agent_execution_manifests_company_context_fk", columns: [t.companyId, t.contextManifestId], foreignColumns: [contextManifests.companyId, contextManifests.id] }), runUnique: unique("agent_execution_manifests_run_uq").on(t.runId), runFk: foreignKey({ columns: [t.companyId, t.agentId, t.runId], foreignColumns: [heartbeatRuns.companyId, heartbeatRuns.agentId, heartbeatRuns.id] }).onDelete("cascade"), companyIdUnique: unique("agent_execution_manifests_company_id_uq").on(t.companyId, t.id), presenceFk: foreignKey({ columns: [t.companyId, t.agentId, t.agentIdentityId], foreignColumns: [agents.companyId, agents.id, agents.agentIdentityId] }), agentIdx: index("agent_execution_manifests_agent_idx").on(t.companyId, t.agentId, t.createdAt) }));
export const agentExecutionManifestItems = pgTable("agent_execution_manifest_items", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), manifestId: uuid("manifest_id").notNull(), type: text("type").notNull(), ref: text("ref").notNull(), versionRef: text("version_ref"),
}, (t) => ({ itemUnique: uniqueIndex("agent_execution_manifest_items_pin_uq").on(t.manifestId, t.type, t.ref, sql`coalesce(${t.versionRef}, '')`), manifestFk: foreignKey({ columns: [t.companyId, t.manifestId], foreignColumns: [agentExecutionManifests.companyId, agentExecutionManifests.id] }).onDelete("cascade"), refIdx: index("agent_execution_manifest_items_ref_idx").on(t.companyId, t.type, t.ref) }));
export const agentExecutionScopeRequests = pgTable("agent_execution_scope_requests", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), agentId: uuid("agent_id").notNull(),
  requestedByUserId: text("requested_by_user_id").notNull(), scope: jsonb("scope").$type<AgentExecutionScope>().notNull(), issueId: uuid("issue_id"), query: text("query").notNull(), runId: uuid("run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => ({ runFk: foreignKey({ name: "agent_execution_scope_requests_company_agent_run_fk", columns: [t.companyId, t.agentId, t.runId], foreignColumns: [heartbeatRuns.companyId, heartbeatRuns.agentId, heartbeatRuns.id] }), presenceFk: foreignKey({ columns: [t.companyId, t.agentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("cascade"), runUnique: unique("agent_execution_scope_requests_run_uq").on(t.runId) }));
export const agentExecutionAuthorizations = pgTable("agent_execution_authorizations", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), manifestId: uuid("manifest_id").notNull(),
  contextManifestRefs: jsonb("context_manifest_refs").$type<Array<{ companyId: string; contextManifestId: string }>>().notNull(), authorityHash: text("authority_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ manifestFk: foreignKey({ columns: [t.companyId, t.manifestId], foreignColumns: [agentExecutionManifests.companyId, agentExecutionManifests.id] }).onDelete("cascade"), manifestIdx: index("agent_execution_authorizations_manifest_idx").on(t.companyId, t.manifestId, t.createdAt) }));
