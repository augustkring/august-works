import type { NativePayloadSourceSnapshot } from "@paperclipai/shared";
import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, date, index, jsonb, unique, check, uniqueIndex, boolean, integer } from "drizzle-orm/pg-core";
import type { AgentEnvConfig, RoadmapPolicy } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { goals } from "./goals.js";
import { agents } from "./agents.js";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Insert-only writer protocol. Historical payloads remain unknown; a hash
    // or an empty source set cannot reconstruct their lost input history.
    payloadSourceProtocolVersion: integer("payload_source_protocol_version").notNull().default(0),
    payloadSourceSnapshot: jsonb("payload_source_snapshot").$type<NativePayloadSourceSnapshot | null>(),
    payloadSourceSnapshotInvalidated: boolean("payload_source_snapshot_invalidated").notNull().default(false),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    goalId: uuid("goal_id").references(() => goals.id),
    name: text("name").notNull(),
    description: text("description"),
    visibility: text("visibility").notNull().default("open"),
    privacyOwnerUserId: text("privacy_owner_user_id"),
    personalOwnerUserId: text("personal_owner_user_id"),
    // Server-stamped derivation roots, retained after source erasure. Empty
    // roots are meaningful only when the native producer qualified them.
    sourceIssueIds: uuid("source_issue_ids").array().notNull().default(sql`'{}'::uuid[]`),
    sourceProjectIds: uuid("source_project_ids").array().notNull().default(sql`'{}'::uuid[]`),
    sourceProvenanceQualified: boolean("source_provenance_qualified").notNull().default(false),
    status: text("status").notNull().default("backlog"),
    leadAgentId: uuid("lead_agent_id").references(() => agents.id),
    targetDate: date("target_date"),
    roadmapPolicy: jsonb("roadmap_policy").$type<RoadmapPolicy>(),
    color: text("color"),
    icon: text("icon"),
    env: jsonb("env").$type<AgentEnvConfig>(),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    executionWorkspacePolicy: jsonb("execution_workspace_policy").$type<Record<string, unknown>>(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceBoundCheck: check("projects_source_bound_check", sql`cardinality(${table.sourceIssueIds}) + cardinality(${table.sourceProjectIds}) <= 256
      and array_position(${table.sourceIssueIds},null) is null and array_position(${table.sourceProjectIds},null) is null`),
    visibilityCheck: check("projects_visibility_check", sql`${table.visibility} in ('open', 'private')`),
    personalOwnerUq: uniqueIndex("projects_company_personal_owner_uq").on(table.companyId, table.personalOwnerUserId).where(sql`${table.personalOwnerUserId} is not null`),
    companyIdUq: unique("projects_company_id_uq").on(table.companyId, table.id),
    companyIdx: index("projects_company_idx").on(table.companyId),
  }),
);
