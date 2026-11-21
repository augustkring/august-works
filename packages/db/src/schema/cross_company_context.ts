import { check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AgentExecutionScope, CrossCompanyPolicy } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { contextManifests } from "./context_manifests.js";
import { agentExecutionScopeRequests } from "./execution_manifests.js";

export const companyCrossCompanyPolicies = pgTable("company_cross_company_policies", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  policy: jsonb("policy").$type<CrossCompanyPolicy>().notNull().default({ allowRead: false, allowContribute: false, allowAct: false, allowedSensitivities: ["public", "internal"] }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Immutable accountability link for a context retained in a delegated
 * company's own tenant. The guest manifest intentionally has no guest run;
 * the exact home run and claimed request are recorded here instead. */
export const delegatedContextManifestBindings = pgTable("delegated_context_manifest_bindings", {
  guestCompanyId: uuid("guest_company_id").notNull(),
  contextManifestId: uuid("context_manifest_id").notNull(),
  homeCompanyId: uuid("home_company_id").notNull(),
  homeAgentId: uuid("home_agent_id").notNull(),
  homeAgentIdentityId: uuid("home_agent_identity_id").notNull(),
  homeRunId: uuid("home_run_id").notNull(),
  scopeRequestId: uuid("scope_request_id").notNull(),
  responsibleUserId: text("responsible_user_id").notNull(),
  guestAgentId: uuid("guest_agent_id").notNull(),
  guestAgentIdentityId: uuid("guest_agent_identity_id").notNull(),
  purpose: text("purpose").notNull(),
  accessMode: text("access_mode").$type<"read" | "contribute" | "act">().notNull(),
  scopeSnapshot: jsonb("scope_snapshot").$type<AgentExecutionScope>().notNull(),
  sourceSnapshotHash: text("source_snapshot_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: unique("delegated_context_manifest_bindings_guest_manifest_uq").on(t.guestCompanyId, t.contextManifestId),
  contextFk: foreignKey({ name: "delegated_context_manifest_bindings_guest_context_fk",
    columns: [t.guestCompanyId, t.contextManifestId], foreignColumns: [contextManifests.companyId, contextManifests.id] }).onDelete("cascade"),
  homeAgentFk: foreignKey({ name: "delegated_context_manifest_bindings_home_presence_fk",
    columns: [t.homeCompanyId, t.homeAgentId, t.homeAgentIdentityId], foreignColumns: [agents.companyId, agents.id, agents.agentIdentityId] }).onDelete("cascade"),
  guestAgentFk: foreignKey({ name: "delegated_context_manifest_bindings_guest_presence_fk",
    columns: [t.guestCompanyId, t.guestAgentId, t.guestAgentIdentityId], foreignColumns: [agents.companyId, agents.id, agents.agentIdentityId] }).onDelete("cascade"),
  homeRunFk: foreignKey({ name: "delegated_context_manifest_bindings_home_run_fk",
    columns: [t.homeCompanyId, t.homeAgentId, t.homeRunId], foreignColumns: [heartbeatRuns.companyId, heartbeatRuns.agentId, heartbeatRuns.id] }).onDelete("cascade"),
  scopeRequestFk: foreignKey({ name: "delegated_context_manifest_bindings_scope_request_fk",
    columns: [t.scopeRequestId], foreignColumns: [agentExecutionScopeRequests.id] }).onDelete("cascade"),
  guestIdx: index("delegated_context_manifest_bindings_guest_company_idx").on(t.guestCompanyId, t.guestAgentId, t.createdAt),
  homeIdx: index("delegated_context_manifest_bindings_home_run_idx").on(t.homeCompanyId, t.homeRunId),
  accessModeCheck: check("delegated_context_manifest_bindings_access_mode_check", sql`${t.accessMode} in ('read','contribute','act')`),
  sourceHashCheck: check("delegated_context_manifest_bindings_source_hash_check", sql`${t.sourceSnapshotHash} ~ '^[0-9a-f]{64}$'`),
}));
