import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { WorkflowGraphV1, WorkflowJsonSchema } from "@paperclipai/shared";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { folders } from "./folders.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { projects } from "./projects.js";

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    publishedRevisionId: uuid("published_revision_id"),
    draftRevisionId: uuid("draft_revision_id"),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    companyStatusIdx: index("workflows_company_status_idx").on(table.companyId, table.status),
    companyUpdatedIdx: index("workflows_company_updated_idx").on(table.companyId, table.updatedAt),
    companyProjectIdx: index("workflows_company_project_idx").on(table.companyId, table.projectId),
    companyFolderIdx: index("workflows_company_folder_idx").on(table.companyId, table.folderId),
    statusCheck: check(
      "workflows_status_check",
      sql`${table.status} in ('active', 'paused', 'archived')`,
    ),
    archiveCheck: check(
      "workflows_archive_check",
      sql`(${table.status} = 'archived') = (${table.archivedAt} is not null)`,
    ),
  }),
);

export const workflowRevisions = pgTable(
  "workflow_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    state: text("state").notNull().default("draft"),
    graph: jsonb("graph_json").$type<WorkflowGraphV1>().notNull(),
    inputSchema: jsonb("input_schema").$type<WorkflowJsonSchema | null>(),
    outputSchema: jsonb("output_schema").$type<WorkflowJsonSchema | null>(),
    changeSummary: text("change_summary"),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workflowRevisionUq: uniqueIndex("workflow_revisions_workflow_revision_uq").on(
      table.workflowId,
      table.revisionNumber,
    ),
    companyWorkflowStateIdx: index("workflow_revisions_company_workflow_state_idx").on(
      table.companyId,
      table.workflowId,
      table.state,
    ),
    stateCheck: check(
      "workflow_revisions_state_check",
      sql`${table.state} in ('draft', 'published', 'superseded', 'discarded')`,
    ),
  }),
);
