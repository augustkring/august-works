import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { ProviderCapabilitySnapshot } from "@paperclipai/shared";
import { agentIdentities } from "./agent_identities.js";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

export const agentProviderBindings = pgTable("agent_provider_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentIdentityId: uuid("agent_identity_id").notNull().references(() => agentIdentities.id, { onDelete: "cascade" }),
  providerType: text("provider_type").notNull(),
  providerEndpointRef: text("provider_endpoint_ref"),
  providerAgentRef: text("provider_agent_ref").notNull(),
  isolationMode: text("isolation_mode").notNull().default("isolated_per_presence"),
  status: text("status").notNull().default("unqualified"),
  capabilitySnapshot: jsonb("capability_snapshot").$type<ProviderCapabilitySnapshot>(),
  capabilitySnapshotHash: text("capability_snapshot_hash"),
  capabilityDiscoveredAt: timestamp("capability_discovered_at", { withTimezone: true }),
  conformance: jsonb("conformance").$type<Record<string, boolean>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  identityIdx: index("agent_provider_bindings_identity_idx").on(t.agentIdentityId),
  identityIdUnique: unique("agent_provider_bindings_identity_id_uq").on(t.agentIdentityId, t.id),
  isolationCheck: check("agent_provider_bindings_isolation_check", sql`${t.isolationMode} in ('isolated_per_presence', 'shared_trusted_runtime')`),
  statusCheck: check("agent_provider_bindings_status_check", sql`${t.status} in ('unqualified', 'active', 'degraded', 'revoked')`),
}));

export const agentPresenceRuntimeBindings = pgTable("agent_presence_runtime_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull(),
  agentIdentityId: uuid("agent_identity_id").notNull(),
  providerBindingId: uuid("provider_binding_id").notNull(),
  providerProfileRef: text("provider_profile_ref").notNull(),
  providerSessionNamespace: text("provider_session_namespace").notNull(),
  qualifiedConfigurationHash: text("qualified_configuration_hash"),
  conformanceSnapshotHash: text("conformance_snapshot_hash"),
  conformanceReport: jsonb("conformance_report").$type<{ adapterContractVersion: string; providerVersion: string | null; testedAt: string; profileRef: string; checks: Record<string, boolean> }>(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  presenceUnique: unique("agent_presence_runtime_bindings_presence_uq").on(t.companyId, t.agentId),
  namespaceUnique: unique("agent_presence_runtime_bindings_namespace_uq").on(t.providerBindingId, t.providerSessionNamespace),
  providerIdx: index("agent_presence_runtime_bindings_provider_idx").on(t.providerBindingId),
  presenceFk: foreignKey({ columns: [t.companyId, t.agentId, t.agentIdentityId], foreignColumns: [agents.companyId, agents.id, agents.agentIdentityId] }).onDelete("cascade"),
  providerIdentityFk: foreignKey({ columns: [t.agentIdentityId, t.providerBindingId], foreignColumns: [agentProviderBindings.agentIdentityId, agentProviderBindings.id] }).onDelete("cascade"),
  statusCheck: check("agent_presence_runtime_bindings_status_check", sql`${t.status} in ('active', 'degraded', 'revoked')`),
}));

export const providerSharedRuntimeAcknowledgements = pgTable("provider_shared_runtime_acknowledgements", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  providerBindingId: uuid("provider_binding_id").notNull().references(() => agentProviderBindings.id, { onDelete: "cascade" }),
  acknowledgedByUserId: text("acknowledged_by_user_id").notNull(),
  warningVersion: text("warning_version").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  companyBindingUnique: unique("provider_shared_runtime_acknowledgements_company_binding_uq").on(t.companyId, t.providerBindingId),
}));
