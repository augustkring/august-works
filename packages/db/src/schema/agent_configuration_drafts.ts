import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import type { AgentAuthoringContent } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { authUsers } from "./auth.js";

/** Canonical unpublished configuration owner. Applied revisions remain in agent_config_revisions. */
export const agentConfigurationDrafts = pgTable(
  "agent_configuration_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    creationRequestId: uuid("creation_request_id").notNull(),
    creationRequestHash: text("creation_request_hash").notNull(),
    baselineHash: text("baseline_hash"),
    version: integer("version").notNull().default(1),
    status: text("status")
      .$type<"draft" | "discarded">()
      .notNull()
      .default("draft"),
    step: text("step").notNull().default("outcome"),
    content: jsonb("content").$type<AgentAuthoringContent>(),
    requestReceipts: jsonb("request_receipts")
      .$type<Array<{ requestId: string; hash: string; version: number }>>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    request: uniqueIndex("agent_configuration_drafts_request_uq").on(
      table.companyId,
      table.createdByUserId,
      table.creationRequestId,
    ),
    list: index("agent_configuration_drafts_owner_updated_idx").on(
      table.companyId,
      table.createdByUserId,
      table.updatedAt,
    ),
    target: foreignKey({
      columns: [table.companyId, table.agentId],
      foreignColumns: [agents.companyId, agents.id],
    }).onDelete("cascade"),
    version: check(
      "agent_configuration_drafts_version_check",
      sql`${table.version}>0`,
    ),
    state: check(
      "agent_configuration_drafts_state_check",
      sql`(${table.status}='draft' and ${table.content} is not null) or (${table.status}='discarded' and ${table.content} is null)`,
    ),
    size: check(
      "agent_configuration_drafts_size_check",
      sql`${table.content} is null or octet_length(${table.content}::text)<=65536`,
    ),
    receipts: check(
      "agent_configuration_drafts_receipts_check",
      sql`jsonb_typeof(${table.requestReceipts})='array' and jsonb_array_length(${table.requestReceipts})<=32`,
    ),
    hash: check(
      "agent_configuration_drafts_hash_check",
      sql`${table.creationRequestHash} ~ '^[a-f0-9]{64}$' and (${table.baselineHash} is null or ${table.baselineHash} ~ '^[a-f0-9]{64}$')`,
    ),
  }),
);
