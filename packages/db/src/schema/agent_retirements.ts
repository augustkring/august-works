import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { AgentRetirementCounts } from "@paperclipai/shared";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

/** Original Agent retirement receipt, not a general job queue or authority
 * source. The original Activity Log owns actor/audit identity and retention. */
export const agentRetirements = pgTable("agent_retirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull(),
  requestId: uuid("request_id").notNull(),
  requestHash: text("request_hash").notNull(),
  sourceToken: text("source_token").notNull(),
  policyVersion: text("policy_version").notNull(),
  detachedAccess: jsonb("detached_access").$type<AgentRetirementCounts>().notNull(),
  postcondition: text("postcondition").notNull().default("native_agent_access_detached"),
  retiredAt: timestamp("retired_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  tenantAgent: foreignKey({ columns: [table.companyId, table.agentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("cascade"),
  oneRetirement: unique("agent_retirements_company_agent_uq").on(table.companyId, table.agentId),
  requestKey: unique("agent_retirements_company_agent_request_uq").on(table.companyId, table.agentId, table.requestId),
  recent: index("agent_retirements_company_retired_idx").on(table.companyId, table.retiredAt),
  hashes: check("agent_retirements_hashes_ck", sql`${table.requestHash} ~ '^[a-f0-9]{64}$' and ${table.sourceToken} ~ '^[a-f0-9]{64}$'`),
  policy: check("agent_retirements_policy_ck", sql`${table.policyVersion} = 'aw.agent-retirement.v1' and ${table.postcondition} = 'native_agent_access_detached'`),
}));
