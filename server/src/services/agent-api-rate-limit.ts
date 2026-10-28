import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { authRateLimits, type Db } from "@paperclipai/db";

export const AGENT_SELF_API_READ_LIMIT = 120;
export const AGENT_SELF_API_READ_WINDOW_MS = 60_000;

export type AgentSelfApiReadAdmission = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Durable cross-process admission for the public agent self-identity read.
 * The existing auth_rate_limits row is keyed by a one-way principal digest;
 * credentials and raw agent IDs are never persisted in the key.
 */
export async function admitAgentSelfApiRead(
  db: Db,
  agentId: string,
): Promise<AgentSelfApiReadAdmission> {
  const principalHash = createHash("sha256").update(agentId).digest("hex");
  const key = `agent-self-api:v1:${principalHash}`;
  const databaseNow = sql`floor(extract(epoch from statement_timestamp()) * 1000)::bigint`;
  const cutoff = sql`${databaseNow} - ${AGENT_SELF_API_READ_WINDOW_MS}`;
  const [row] = await db.insert(authRateLimits).values({
    id: randomUUID(), key, count: 1, lastRequest: databaseNow,
  }).onConflictDoUpdate({
    target: authRateLimits.key,
    set: {
      count: sql`case
        when ${authRateLimits.lastRequest} <= ${cutoff} then 1
        when ${authRateLimits.count} < ${AGENT_SELF_API_READ_LIMIT} then ${authRateLimits.count} + 1
        else ${AGENT_SELF_API_READ_LIMIT + 1}
      end`,
      // Keep lastRequest as the fixed window start. Neither an admitted read
      // nor a denied retry moves the boundary.
      lastRequest: sql`case
        when ${authRateLimits.lastRequest} <= ${cutoff} then ${databaseNow}
        else ${authRateLimits.lastRequest}
      end`,
    },
  }).returning({
    count: authRateLimits.count,
    retryAfterSeconds: sql<number>`case
      when ${authRateLimits.count} > ${AGENT_SELF_API_READ_LIMIT}
        then greatest(1, ceil((${authRateLimits.lastRequest} + ${AGENT_SELF_API_READ_WINDOW_MS} - ${databaseNow}) / 1000.0)::int)
      else 0
    end`,
  });

  const allowed = row!.count <= AGENT_SELF_API_READ_LIMIT;
  return {
    allowed,
    remaining: allowed ? AGENT_SELF_API_READ_LIMIT - row!.count : 0,
    retryAfterSeconds: row!.retryAfterSeconds,
  };
}
