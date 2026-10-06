import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { BootstrapCandidate, BootstrapSource } from "@paperclipai/shared";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { foundationDocuments } from "./foundation.js";
import { issues } from "./issues.js";
import { contextManifests } from "./context_manifests.js";

export const foundationBootstrapRuns = pgTable("foundation_bootstrap_runs", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull(), taskId: uuid("task_id").notNull(), startedBy: text("started_by").notNull(), responsibleUserId: text("responsible_user_id"),
  idempotencyKey: text("idempotency_key").notNull(), requestHash: text("request_hash").notNull(), query: text("query").notNull(),
  status: text("status").notNull().default("awaiting_candidates"), version: integer("version").notNull().default(1),
  sources: jsonb("source_scope_json").$type<BootstrapSource[]>().notNull(), answers: jsonb("answers_json").$type<Record<string, string>>().notNull().default({}),
  sourceManifestId: uuid("source_manifest_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  companyIdUq: unique("foundation_bootstrap_runs_company_id_uq").on(t.companyId, t.id),
  requestUq: uniqueIndex("foundation_bootstrap_runs_request_uq").on(t.companyId, t.startedBy, t.idempotencyKey),
  agentFk: foreignKey({ name: "foundation_bootstrap_runs_agent_fk", columns: [t.companyId, t.agentId], foreignColumns: [agents.companyId, agents.id] }),
  taskFk: foreignKey({ name: "foundation_bootstrap_runs_task_fk", columns: [t.companyId, t.taskId], foreignColumns: [issues.companyId, issues.id] }).onDelete("cascade"),
  manifestFk: foreignKey({ name: "foundation_bootstrap_runs_manifest_fk", columns: [t.companyId, t.sourceManifestId], foreignColumns: [contextManifests.companyId, contextManifests.id] }),
  statusCheck: check("foundation_bootstrap_runs_status_check", sql`${t.status} in ('awaiting_candidates','needs_answers','ready_for_review','proposals_created','cancelled','failed')`),
  versionCheck: check("foundation_bootstrap_runs_version_check", sql`${t.version} > 0`),
  ownerIdx: index("foundation_bootstrap_runs_owner_idx").on(t.companyId, t.startedBy, t.createdAt),
}));
export const foundationBootstrapCandidates = pgTable("foundation_bootstrap_candidates", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  bootstrapRunId: uuid("bootstrap_run_id").notNull(), foundationKey: text("foundation_key").notNull(), version: integer("version").notNull(),
  candidate: jsonb("candidate_json").$type<BootstrapCandidate>().notNull(), evidenceRefs: jsonb("evidence_refs_json").$type<BootstrapSource[]>().notNull(),
  status: text("status").notNull().default("candidate"), foundationDocumentId: uuid("foundation_document_id").references(() => foundationDocuments.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  runFk: foreignKey({ name: "foundation_bootstrap_candidates_run_fk", columns: [t.companyId, t.bootstrapRunId], foreignColumns: [foundationBootstrapRuns.companyId, foundationBootstrapRuns.id] }).onDelete("cascade"),
  versionUq: uniqueIndex("foundation_bootstrap_candidates_version_uq").on(t.bootstrapRunId, t.foundationKey, t.version),
  statusCheck: check("foundation_bootstrap_candidates_status_check", sql`${t.status} in ('candidate','superseded','proposed','rejected')`),
}));
