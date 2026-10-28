import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

function findLockUnavailable(error: unknown) {
  let current: unknown = error;
  const seen = new Set<object>();
  for (let depth = 0; depth < 8 && current && typeof current === "object" && !seen.has(current); depth += 1) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (record.code === "55P03" || record.sqlState === "55P03") return record;
    current = record.cause;
  }
  return null;
}

function safeRelation(error: unknown) {
  let current: unknown = error;
  const seen = new Set<object>();
  for (let depth = 0; depth < 8 && current && typeof current === "object" && !seen.has(current); depth += 1) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    const name = typeof record.table_name === "string" ? record.table_name
      : typeof record.table === "string" ? record.table
        : null;
    if (name && /^[a-z_][a-z0-9_]{0,62}$/i.test(name)) return name;
    const message = typeof record.message === "string" ? record.message : "";
    const match = message.match(/relation "([a-z_][a-z0-9_]{0,62})"/i);
    if (match) return match[1];
    current = record.cause;
  }
  return null;
}

function safeQueryShape(query: unknown) {
  if (typeof query !== "string") return null;
  return query
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\$([a-z_][a-z0-9_]*)?\$[\s\S]*?\$\1?\$/gi, " ? ")
    .replace(/'(?:''|[^'])*'/g, "'?' ")
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, "?")
    .replace(/\b(?:[A-Za-z0-9_-]{32,})\b/g, "?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

/** Capture only bounded PostgreSQL lock metadata and normalized SQL shape.
 * Query text is never logged verbatim because it can contain literals. */
export async function logPostgresLockUnavailable(
  db: Db,
  error: unknown,
  source: string,
) {
  const lockError = findLockUnavailable(error);
  if (!lockError) return;
  const relation = safeRelation(error);
  try {
    const rows = await db.execute<{
      pid: number;
      application_name: string | null;
      state: string | null;
      wait_event_type: string | null;
      wait_event: string | null;
      transaction_age_ms: number | null;
      blocking_pids: number[];
      locks: Array<{ locktype: string; mode: string; granted: boolean; relation: string | null }>;
      lock_modes: string[];
      relations: string[];
      query_text: string | null;
    }>(sql`
      select a.pid::int as pid, a.application_name, a.state, a.wait_event_type, a.wait_event,
        case when a.xact_start is null then null
          else floor(extract(epoch from (clock_timestamp()-a.xact_start))*1000)::int end as transaction_age_ms,
        coalesce(pg_blocking_pids(a.pid), array[]::int[]) as blocking_pids,
        coalesce((select jsonb_agg(jsonb_build_object('locktype', l.locktype, 'mode', l.mode,
          'granted', l.granted, 'relation', c.relname) order by l.locktype, l.mode, l.granted)
          from pg_locks l left join pg_class c on c.oid=l.relation
          where l.pid=a.pid and (l.locktype='transactionid' or ${relation}::text is null or c.relname=${relation})),
          '[]'::jsonb) as locks,
        coalesce((select array_agg(distinct l.mode order by l.mode) from pg_locks l
          left join pg_class c on c.oid=l.relation
          where l.pid=a.pid and l.granted and (l.locktype='transactionid' or ${relation}::text is null or c.relname=${relation})),
          array[]::text[]) as lock_modes,
        coalesce((select array_agg(distinct c.relname order by c.relname) from pg_locks l
          join pg_class c on c.oid=l.relation
          where l.pid=a.pid and l.granted and (${relation}::text is null or c.relname=${relation})),
          array[]::text[]) as relations,
        a.query as query_text
      from pg_stat_activity a
      where a.datname=current_database() and a.pid<>pg_backend_pid()
        and a.xact_start > clock_timestamp()-interval '2 minutes'
        and (a.state='active' or a.state='idle in transaction' or a.wait_event_type='Lock')
        and (a.wait_event_type='Lock' or exists(select 1 from pg_locks l left join pg_class c on c.oid=l.relation
          where l.pid=a.pid and l.granted and (l.locktype='transactionid' or ${relation}::text is null or c.relname=${relation})))
      order by a.xact_start asc limit 20
    `);
    logger.warn({
      event: "postgres_lock_unavailable_observed",
      source: source.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80),
      sqlState: "55P03",
      relation,
      candidates: rows.map((row) => ({
        pid: row.pid,
        applicationName: (row.application_name ?? "").replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80),
        state: row.state,
        waitEventType: row.wait_event_type,
        waitEvent: row.wait_event,
        transactionAgeMs: row.transaction_age_ms,
        blockingPids: row.blocking_pids,
        locks: row.locks,
        lockModes: row.lock_modes,
        relations: row.relations,
        queryShape: safeQueryShape(row.query_text),
      })),
    }, "PostgreSQL NOWAIT contention observed; emitted bounded lock-owner metadata");
  } catch {
    logger.warn({ event: "postgres_lock_unavailable_observed", source, sqlState: "55P03", relation,
      diagnosticsUnavailable: true }, "PostgreSQL NOWAIT contention observed; lock metadata unavailable");
  }
}
