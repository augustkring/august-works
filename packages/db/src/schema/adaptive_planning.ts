import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { AppliedInitiativeProjectRef, CrossProjectPlanningContext, InitiativePlanningContext } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { analyticalLineageManifests } from "./analytical_lineage.js";

// Cross-project proposal identity only. Canonical project schedules, Tasks,
// baselines, permissions and execution remain with the original native owners.
export const adaptivePlanningProposals = pgTable("adaptive_planning_proposals", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  proposalType: text("proposal_type").$type<"change_schedule" | "prioritize_initiatives">().notNull(),
  status: text("status").$type<"proposed" | "under_review" | "accepted" | "rejected" | "cancelled">().notNull().default("proposed"), revision: integer("revision").notNull().default(1),
  context: jsonb("context_json").$type<CrossProjectPlanningContext>().notNull(), contextHash: text("context_hash").notNull(), manifestId: uuid("manifest_id").notNull(),
  initiativeContext: jsonb("initiative_context_json").$type<InitiativePlanningContext>(),
  reason: text("reason").notNull(), createdByUserId: text("created_by_user_id").notNull(), reviewedByUserId: text("reviewed_by_user_id"), reviewRationale: text("review_rationale"),
  appliedRoadmapRefs: jsonb("applied_roadmap_refs_json").$type<Array<{ projectId: string; proposalId: string }>>().notNull().default([]),
  appliedProjectRefs: jsonb("applied_project_refs_json").$type<AppliedInitiativeProjectRef[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, table => ({
  tenantUq: unique("adaptive_planning_proposals_tenant_id_uq").on(table.companyId, table.id),
  manifestFk: foreignKey({ name: "adaptive_planning_proposals_manifest_fk", columns: [table.companyId, table.manifestId], foreignColumns: [analyticalLineageManifests.companyId, analyticalLineageManifests.id] }).onDelete("cascade"),
  stateCheck: check("adaptive_planning_proposals_state_check", sql`${table.proposalType} in ('change_schedule','prioritize_initiatives') and ${table.status} in ('proposed','under_review','accepted','rejected','cancelled') and ${table.revision}>0 and (${table.proposalType}='prioritize_initiatives')=(${table.initiativeContext} is not null)`),
  hashCheck: check("adaptive_planning_proposals_hash_check", sql`${table.contextHash} ~ '^[0-9a-f]{64}$'`),
  companyIdx: index("adaptive_planning_proposals_company_idx").on(table.companyId, table.id),
}));
