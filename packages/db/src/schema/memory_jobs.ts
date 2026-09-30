import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  MemoryJobOperationType,
  MemoryJobStatus,
} from "@paperclipai/shared";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { memoryRecords } from "./memory.js";

export const memoryJobs = pgTable(
  "memory_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    operationType: text("operation_type")
      .$type<MemoryJobOperationType>()
      .notNull(),
    status: text("status").$type<MemoryJobStatus>().notNull().default("queued"),

    jobKey: text("job_key").notNull(),
    attemptNumber: integer("attempt_number").notNull().default(1),
    retryOfJobId: uuid("retry_of_job_id"),
    sourceHeartbeatRunId: uuid("source_heartbeat_run_id"),
    sourceMemoryRecordId: uuid("source_memory_record_id"),
    sourceRefJson: jsonb("source_ref_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    executionOwnerId: text("execution_owner_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),

    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    resultSummary: text("result_summary"),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyIdIdUq: uniqueIndex("memory_jobs_company_id_id_uq").on(
      table.companyId,
      table.id,
    ),
    retryOfFk: foreignKey({
      name: "memory_jobs_company_retry_of_fk",
      columns: [table.companyId, table.retryOfJobId],
      foreignColumns: [table.companyId, table.id],
    }),
    sourceRunFk: foreignKey({
      name: "memory_jobs_company_source_run_fk",
      columns: [table.companyId, table.sourceHeartbeatRunId],
      foreignColumns: [heartbeatRuns.companyId, heartbeatRuns.id],
    }),
    sourceMemoryRecordFk: foreignKey({
      name: "memory_jobs_company_source_memory_record_fk",
      columns: [table.companyId, table.sourceMemoryRecordId],
      foreignColumns: [memoryRecords.companyId, memoryRecords.id],
    }),
    attemptUq: uniqueIndex("memory_jobs_company_key_attempt_uq").on(
      table.companyId,
      table.jobKey,
      table.attemptNumber,
    ),
    companyStatusSubmittedIdx: index(
      "memory_jobs_company_status_submitted_idx",
    ).on(table.companyId, table.status, table.submittedAt),
    queueIdx: index("memory_jobs_queue_idx")
      .on(table.submittedAt)
      .where(sql`${table.status} = 'queued'`),
    runningLeaseIdx: index("memory_jobs_running_lease_idx")
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} = 'running'`),
    sourceRunIdx: index("memory_jobs_source_run_idx").on(
      table.companyId,
      table.sourceHeartbeatRunId,
      table.operationType,
    ),
    retryOfIdx: index("memory_jobs_retry_of_idx").on(table.retryOfJobId),
    operationTypeCheck: check(
      "memory_jobs_operation_type_check",
      sql`${table.operationType} in ('capture','dedupe','compaction','reflection','index_refresh','retention')`,
    ),
    statusCheck: check(
      "memory_jobs_status_check",
      sql`${table.status} in ('queued','running','succeeded','failed','cancelled')`,
    ),
    attemptCheck: check(
      "memory_jobs_attempt_number_check",
      sql`${table.attemptNumber} >= 1`,
    ),
    retryLineageCheck: check(
      "memory_jobs_retry_lineage_check",
      sql`(${table.attemptNumber} = 1 and ${table.retryOfJobId} is null) or (${table.attemptNumber} > 1 and ${table.retryOfJobId} is not null)`,
    ),
    retryNotSelfCheck: check(
      "memory_jobs_retry_not_self_check",
      sql`${table.retryOfJobId} is null or ${table.retryOfJobId} <> ${table.id}`,
    ),
    leasePairCheck: check(
      "memory_jobs_lease_pair_check",
      sql`(${table.executionOwnerId} is null) = (${table.leaseExpiresAt} is null)`,
    ),
    terminalLeaseCheck: check(
      "memory_jobs_terminal_lease_check",
      sql`${table.status} not in ('succeeded','failed','cancelled') or (${table.executionOwnerId} is null and ${table.leaseExpiresAt} is null)`,
    ),
    statusLeaseCheck: check(
      "memory_jobs_status_lease_check",
      sql`(${table.status} = 'running' and ${table.executionOwnerId} is not null and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'running' and ${table.executionOwnerId} is null and ${table.leaseExpiresAt} is null)`,
    ),
    terminalFinishedCheck: check(
      "memory_jobs_terminal_finished_check",
      sql`${table.status} not in ('succeeded','failed','cancelled') or ${table.finishedAt} is not null`,
    ),
  }),
);
