import { sql } from "drizzle-orm";
import { pgTable, uuid, text, jsonb, integer, timestamp, unique, foreignKey, check, index } from "drizzle-orm/pg-core";
import type { SandboxCapabilitySnapshot, SandboxPolicy, SandboxPolicyCompilation } from "@paperclipai/shared";
import { runtimeCells } from "./runtime_fleet.js";
import { agentExecutionManifests } from "./execution_manifests.js";
import { agents } from "./agents.js";

export const runtimeSandboxBindings = pgTable("runtime_sandbox_bindings", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), runtimeCellId: uuid("runtime_cell_id").notNull(), cellGeneration: text("cell_generation").notNull(),
  backend: text("backend").$type<SandboxCapabilitySnapshot["backend"]>().notNull(), profile: text("profile").$type<SandboxPolicy["profile"]>().notNull(), sandboxRef: text("sandbox_ref"),
  boundaryPolicy: jsonb("boundary_policy").$type<SandboxPolicy>().notNull(), boundaryPolicyHash: text("boundary_policy_hash").notNull(),
  capabilitySnapshot: jsonb("capability_snapshot").$type<SandboxCapabilitySnapshot | null>(), capabilitySnapshotHash: text("capability_snapshot_hash"), qualificationRunId: uuid("qualification_run_id"),
  status: text("status").$type<"requested" | "ready" | "degraded" | "quarantined" | "stopping" | "stopped" | "failed" | "deleted">().notNull().default("requested"),
  version: integer("version").notNull().default(1), createdByUserId: text("created_by_user_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ tenantUq: unique("sandbox_binding_tenant_uq").on(t.companyId, t.id), cellGenerationUq: unique("sandbox_binding_cell_generation_uq").on(t.companyId, t.runtimeCellId, t.cellGeneration),
  cellFk: foreignKey({ columns: [t.companyId, t.runtimeCellId], foreignColumns: [runtimeCells.companyId, runtimeCells.id] }),
  statusCheck: check("sandbox_binding_status_check", sql`${t.status} in ('requested','ready','degraded','quarantined','stopping','stopped','failed','deleted')`),
  versionCheck: check("sandbox_binding_version_check", sql`${t.version}>0`), cellIdx: index("sandbox_binding_cell_idx").on(t.companyId, t.runtimeCellId),
}));
export const sandboxQualificationRuns = pgTable("sandbox_qualification_runs", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), bindingId: uuid("binding_id").notNull(),
  backend: text("backend").notNull(), backendVersion: text("backend_version").notNull(), hostOrImageRef: text("host_or_image_ref").notNull(), kernelVersion: text("kernel_version"), suiteVersion: text("suite_version").notNull(),
  evidenceKind: text("evidence_kind").$type<"local_fixture" | "protected_host_report">().notNull(), status: text("status").$type<"passed" | "failed" | "inconclusive">().notNull(),
  results: jsonb("results").$type<Array<{ caseId: string; control: string; verdict: "pass" | "fail" | "unsupported"; observationHash: string | null }>>().notNull(), exceptions: jsonb("exceptions").$type<string[]>().notNull(), reportHash: text("report_hash").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(), completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
}, t => ({ tenantUq: unique("sandbox_qualification_tenant_uq").on(t.companyId, t.id), bindingFk: foreignKey({ columns: [t.companyId, t.bindingId], foreignColumns: [runtimeSandboxBindings.companyId, runtimeSandboxBindings.id] }), bindingIdx: index("sandbox_qualification_binding_idx").on(t.companyId, t.bindingId) }));
export const runtimePolicySnapshots = pgTable("runtime_policy_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), bindingId: uuid("binding_id").notNull(), runtimeCellId: uuid("runtime_cell_id").notNull(), agentId: uuid("agent_id").notNull(), executionManifestId: uuid("execution_manifest_id").notNull(),
  policyVersion: integer("policy_version").notNull(), policyHash: text("policy_hash").notNull(), capabilitySnapshotHash: text("capability_snapshot_hash"),
  compilation: jsonb("compilation").$type<SandboxPolicyCompilation>().notNull(), authorityHash: text("authority_hash").notNull(), sourcePolicyRefs: jsonb("source_policy_refs").$type<string[]>().notNull(),
  status: text("status").$type<"draft" | "qualified" | "superseded" | "revoked">().notNull().default("draft"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => ({ tenantUq: unique("sandbox_policy_tenant_uq").on(t.companyId, t.id), bindingVersionUq: unique("sandbox_policy_binding_version_uq").on(t.companyId, t.bindingId, t.policyVersion),
  bindingFk: foreignKey({ columns: [t.companyId, t.bindingId], foreignColumns: [runtimeSandboxBindings.companyId, runtimeSandboxBindings.id] }), cellFk: foreignKey({ columns: [t.companyId, t.runtimeCellId], foreignColumns: [runtimeCells.companyId, runtimeCells.id] }),
  agentFk: foreignKey({ columns: [t.companyId, t.agentId], foreignColumns: [agents.companyId, agents.id] }), manifestFk: foreignKey({ columns: [t.companyId, t.executionManifestId], foreignColumns: [agentExecutionManifests.companyId, agentExecutionManifests.id] }),
  stateCheck: check("sandbox_policy_status_check", sql`${t.status} in ('draft','qualified','superseded','revoked')`), versionCheck: check("sandbox_policy_version_check", sql`${t.policyVersion}>0`), bindingIdx: index("sandbox_policy_binding_idx").on(t.companyId, t.bindingId, t.policyVersion),
}));
