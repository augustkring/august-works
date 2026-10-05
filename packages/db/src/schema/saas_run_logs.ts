import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Append acknowledgement means the encrypted buffer and its ordinal are committed in PostgreSQL.
// Object storage is the archive; neither read nor recovery depends on the control VM filesystem.
export const saasRunLogs = pgTable(
  "saas_run_logs",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    agentId: uuid("agent_id").notNull(),
    logRef: text("log_ref").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull().default(0),
    pendingBytes: bigint("pending_bytes", { mode: "number" })
      .notNull()
      .default(0),
    nextOrdinal: integer("next_ordinal").notNull().default(1),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    sha256: text("sha256"),
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("saas_run_logs_ref_uq").on(t.logRef),
    uniqueIndex("saas_run_logs_company_id_uq").on(t.companyId, t.id),
    index("saas_run_logs_flush_idx").on(t.pendingBytes),
    check(
      "saas_run_logs_size_ck",
      sql`${t.byteSize} >= 0 and ${t.pendingBytes} >= 0 and ${t.nextOrdinal} > 0`,
    ),
  ],
);
export const saasRunLogChunks = pgTable(
  "saas_run_log_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    runId: uuid("run_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    eventSeq: integer("event_seq"),
    byteOffset: bigint("byte_offset", { mode: "number" }).notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    keyId: text("key_id").notNull(),
    ciphertext: text("ciphertext"),
    objectKey: text("object_key").notNull(),
    objectSha256: text("object_sha256").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.companyId, t.runId],
      foreignColumns: [saasRunLogs.companyId, saasRunLogs.id],
    }),
    uniqueIndex("saas_run_log_chunks_ordinal_uq").on(t.runId, t.ordinal),
    uniqueIndex("saas_run_log_chunks_event_uq")
      .on(t.runId, t.eventSeq)
      .where(sql`${t.eventSeq} is not null`),
    index("saas_run_log_chunks_pending_idx").on(t.archivedAt),
    check(
      "saas_run_log_chunks_size_ck",
      sql`${t.byteOffset} >= 0 and ${t.byteSize} > 0 and ${t.ordinal} > 0`,
    ),
  ],
);
