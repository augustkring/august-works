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
    distinctRevisionPointersCheck: check(
      "workflows_distinct_revision_pointers_check",
      sql`${table.publishedRevisionId} is null or ${table.draftRevisionId} is null or ${table.publishedRevisionId} <> ${table.draftRevisionId}`,
    ),
  }),
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    workflowRevisionId: uuid("workflow_revision_id")
      .notNull()
      .references(() => workflowRevisions.id, { onDelete: "restrict" }),
    triggerId: uuid("trigger_id"),
    status: text("status").notNull().default("queued"),
    source: text("source").notNull().default("manual"),
    triggerPayload: jsonb("trigger_payload").$type<Record<string, unknown>>().notNull().default({}),
    responsibleUserId: text("responsible_user_id"),
    idempotencyKey: text("idempotency_key"),
    correlationId: text("correlation_id"),
    executionOwnerId: text("execution_owner_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    ownerHeartbeatAt: timestamp("owner_heartbeat_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyWorkflowCreatedIdx: index("workflow_runs_company_workflow_created_idx").on(
      table.companyId,
      table.workflowId,
      table.createdAt,
    ),
    companyStatusCreatedIdx: index("workflow_runs_company_status_created_idx").on(
      table.companyId,
      table.status,
      table.createdAt,
    ),
    companyIdempotencyUq: uniqueIndex("workflow_runs_company_idempotency_uq")
      .on(table.companyId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    statusCheck: check(
      "workflow_runs_status_check",
      sql`${table.status} in ('queued', 'running', 'waiting', 'recovering', 'cancelling', 'succeeded', 'failed', 'cancelled')`,
    ),
    sourceCheck: check(
      "workflow_runs_source_check",
      sql`${table.source} in ('manual', 'schedule', 'webhook', 'api', 'connector_event', 'routine', 'pipeline', 'task')`,
    ),
    leasePairCheck: check(
      "workflow_runs_lease_pair_check",
      sql`(${table.executionOwnerId} is null) = (${table.leaseExpiresAt} is null)`,
    ),
    terminalLeaseCheck: check(
      "workflow_runs_terminal_lease_check",
      sql`${table.status} not in ('succeeded', 'failed', 'cancelled') or (${table.executionOwnerId} is null and ${table.leaseExpiresAt} is null)`,
    ),
    terminalFinishedCheck: check(
      "workflow_runs_terminal_finished_check",
      sql`${table.status} not in ('succeeded', 'failed', 'cancelled') or ${table.finishedAt} is not null`,
    ),
  }),
);

export const workflowStepRuns = pgTable(
  "workflow_step_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowRunId: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    attempt: integer("attempt").notNull().default(1),
    status: text("status").notNull().default("pending"),
    inputJson: jsonb("input_json").$type<unknown>(),
    outputJson: jsonb("output_json").$type<unknown>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    toolInvocationId: uuid("tool_invocation_id"),
    automationArtifactVersionId: uuid("automation_artifact_version_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runNodeAttemptUq: uniqueIndex("workflow_step_runs_run_node_attempt_uq").on(
      table.workflowRunId,
      table.nodeId,
      table.attempt,
    ),
    companyRunStatusIdx: index("workflow_step_runs_company_run_status_idx").on(
      table.companyId,
      table.workflowRunId,
      table.status,
    ),
    statusCheck: check(
      "workflow_step_runs_status_check",
      sql`${table.status} in ('pending', 'running', 'waiting', 'retry_scheduled', 'retried', 'succeeded', 'failed', 'skipped', 'cancelling', 'cancelled')`,
    ),
    attemptCheck: check(
      "workflow_step_runs_attempt_check",
      sql`${table.attempt} >= 1`,
    ),
    durationCheck: check(
      "workflow_step_runs_duration_check",
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
    terminalFinishedCheck: check(
      "workflow_step_runs_terminal_finished_check",
      sql`${table.status} not in ('retried', 'succeeded', 'failed', 'skipped', 'cancelled') or ${table.finishedAt} is not null`,
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
    oneDraftUq: uniqueIndex("workflow_revisions_one_draft_uq")
      .on(table.workflowId)
      .where(sql`${table.state} = 'draft'`),
    onePublishedUq: uniqueIndex("workflow_revisions_one_published_uq")
      .on(table.workflowId)
      .where(sql`${table.state} = 'published'`),
    stateCheck: check(
      "workflow_revisions_state_check",
      sql`${table.state} in ('draft', 'published', 'superseded', 'discarded')`,
    ),
  }),
);
