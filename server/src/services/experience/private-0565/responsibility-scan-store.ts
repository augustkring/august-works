/** PostgreSQL persistence for metadata-only responsibility scan pointers. */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import type { ResponsibilityLease, ResponsibilityPointer, ResponsibilityScanKind, ResponsibilityScanStore } from "./responsibility-scan.js";

const MAX_DB_BATCH = 40;
const allowedKinds = new Set<string>(["agent","deployment","workflow","workflow_run","routine","connector","metric","experiment","decision","approval","ai_use_case","tool_policy","skill_policy","billing","security_contact","support_incident_contact","support_case"]);

/** Claims the next eligible company by oldest completed scan, using a row
 * lock on the company and the partial active-run unique index. One company is
 * admitted per maintenance tick, so a large tenant set cannot monopolize the
 * scanner. */
export async function enqueueNextFairResponsibilityScan(db: Db, now = new Date()) {
  const nextAttemptAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 86_400_000).toISOString();
  const runId = randomUUID();
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    const [row] = await tx.execute<{ id: string; company_id: string }>(sql`with next_company as (
      select c.id as company_id
      from companies c
      left join lateral (
        select completed_at from responsibility_scan_runs r
        where r.company_id=c.id and r.status='complete'
        order by r.completed_at desc,r.id desc limit 1
      ) latest on true
      where c.status='active'
        and not exists(select 1 from responsibility_scan_runs r where r.company_id=c.id and r.status in ('queued','running','failed'))
        and not exists(select 1 from responsibility_scan_runs r where r.company_id=c.id and r.status='abandoned'
          and r.updated_at > ${new Date(now.getTime() - 300_000).toISOString()})
      order by latest.completed_at asc nulls first,c.id asc
      for update of c skip locked limit 1
    ) insert into responsibility_scan_runs
      (id,company_id,status,requested_at,next_attempt_at,expires_at,created_at,updated_at)
      select ${runId}::uuid,company_id,'queued',${nextAttemptAt},${nextAttemptAt},${expiresAt},${nextAttemptAt},${nextAttemptAt}
      from next_company
      on conflict (company_id) where status in ('queued','running','failed') do nothing
      returning id,company_id`);
    return row ?? null;
  });
}

/** Called after an explicit native responsibility change when an immediate
 * scan is useful. It is idempotent while a company already has live work. */
export async function enqueueResponsibilityScan(db: Db, companyId: string, now = new Date()) {
  const nextAttemptAt = now;
  const expiresAt = new Date(now.getTime() + 86_400_000);
  const runId = randomUUID();
  return db.execute(sql`insert into responsibility_scan_runs
      (id, company_id, status, requested_at, next_attempt_at, expires_at, created_at, updated_at)
    values (${runId}::uuid, ${companyId}::uuid, 'queued', ${now.toISOString()}, ${nextAttemptAt.toISOString()}, ${expiresAt.toISOString()}, ${now.toISOString()}, ${now.toISOString()})
    on conflict (company_id) where status in ('queued','running','failed') do nothing
    returning id`);
}

export function postgresResponsibilityScanStore(db: Db): ResponsibilityScanStore {
  return {
    async claimDue({ worker, now, leaseMs }) {
      const token = randomUUID(), leaseExpiresAt = new Date(now.getTime() + leaseMs);
      return db.transaction(async raw => {
        const tx = raw as unknown as Db;
        const [row] = await tx.execute<{
          id: string; company_id: string; cursor_json: unknown; attempt_count: number;
        }>(sql`with candidate as (
          select id from responsibility_scan_runs
          where status in ('queued','failed','running') and next_attempt_at <= ${now.toISOString()}
            and expires_at > ${now.toISOString()} and (lease_token is null or lease_expires_at <= ${now.toISOString()})
          order by requested_at asc, company_id asc, id asc
          for update skip locked limit 1
        ) update responsibility_scan_runs r set status='running', lease_owner=${worker}, lease_token=${token}::uuid,
          lease_expires_at=${leaseExpiresAt.toISOString()}, attempt_count=r.attempt_count+1, started_at=coalesce(r.started_at,${now.toISOString()}), updated_at=${now.toISOString()}
        from candidate c where r.id=c.id returning r.id,r.company_id,r.cursor_json,r.attempt_count`);
        if (!row) return null;
        const cursor = parseCursor(row.cursor_json);
        return { runId: row.id, companyId: row.company_id, owner: worker, token, cursor,
          expiresAt: leaseExpiresAt, attempts: Number(row.attempt_count) } satisfies ResponsibilityLease;
      });
    },
    async commitPage(input) {
      if (!allowedKinds.has(input.kind) || input.pointers.length > MAX_DB_BATCH) return false;
      return db.transaction(async raw => {
        const tx = raw as unknown as Db;
        const cursorValue = JSON.stringify({ after: input.nextCursor, complete: input.complete });
        const [fenced] = await tx.execute<{ id: string }>(sql`update responsibility_scan_runs
          set cursor_json=jsonb_set(cursor_json, array[${input.kind}], ${cursorValue}::jsonb, true),
              expires_at=${input.cursorExpiresAt.toISOString()}, attempt_count=0, updated_at=${input.now.toISOString()}
          where id=${input.runId}::uuid and company_id=${input.companyId}::uuid and status='running'
            and lease_owner=${input.owner} and lease_token=${input.token}::uuid and lease_expires_at > ${input.now.toISOString()}
          returning id`);
        if (!fenced) return false;
        for (const pointer of input.pointers) {
          if (!allowedKinds.has(pointer.kind) || pointer.kind !== input.kind || !/^[0-9a-f]{64}$/.test(pointer.sourceVersion) || !pointer.id) throw new Error("responsibility_scan_pointer_contract_invalid");
        }
        for (let offset = 0; offset < input.pointers.length; offset += MAX_DB_BATCH) {
          const batch = input.pointers.slice(offset, offset + MAX_DB_BATCH);
          for (const pointer of batch) await tx.execute(sql`insert into responsibility_scan_candidates
              (company_id, scan_run_id, resource_kind, resource_id, source_version, observed_at, expires_at)
            values (${input.companyId}::uuid, ${input.runId}::uuid, ${pointer.kind}, ${pointer.id}, ${pointer.sourceVersion}, ${input.now.toISOString()}, ${input.pointerExpiresAt.toISOString()})
            on conflict (scan_run_id, resource_kind, resource_id) do update set source_version=excluded.source_version,
              observed_at=excluded.observed_at, expires_at=excluded.expires_at`);
        }
        return true;
      });
    },
    async releaseForNextPage(input) {
      const [row] = await db.execute<{ id: string }>(sql`update responsibility_scan_runs set status='queued', lease_owner=null,
        lease_token=null, lease_expires_at=null, requested_at=${input.now.toISOString()}, next_attempt_at=${input.now.toISOString()}, updated_at=${input.now.toISOString()}
        where id=${input.runId}::uuid and status='running' and lease_owner=${input.owner}
          and lease_token=${input.token}::uuid and lease_expires_at > ${input.now.toISOString()} returning id`);
      return Boolean(row);
    },
    async complete(input) {
      return db.transaction(async raw => {
        const tx = raw as unknown as Db;
        const [row] = await tx.execute<{ id: string; company_id: string }>(sql`update responsibility_scan_runs set status='complete',
          lease_owner=null, lease_token=null, lease_expires_at=null, completed_at=${input.now.toISOString()}, updated_at=${input.now.toISOString()}
          where id=${input.runId}::uuid and status='running' and lease_owner=${input.owner}
            and lease_token=${input.token}::uuid and lease_expires_at > ${input.now.toISOString()} returning id,company_id`);
        if (!row) return false;
        const nextId = randomUUID(), expiresAt = new Date(input.nextScanAt.getTime() + 86_400_000);
        await tx.execute(sql`insert into responsibility_scan_runs
          (id,company_id,status,requested_at,next_attempt_at,expires_at,created_at,updated_at)
          values (${nextId}::uuid,${row.company_id}::uuid,'queued',${input.nextScanAt.toISOString()},${input.nextScanAt.toISOString()},${expiresAt.toISOString()},${input.now.toISOString()},${input.now.toISOString()})`);
        return true;
      });
    },
    async fail(input) {
      const status = input.abandoned ? "abandoned" : "failed";
      const nextAttemptAt = input.retryAt ?? input.now;
      const [row] = await db.execute<{ id: string }>(sql`update responsibility_scan_runs set status=${status},
        last_error_code=${input.code}, next_attempt_at=${nextAttemptAt.toISOString()}, lease_owner=null, lease_token=null,
        lease_expires_at=null, updated_at=${input.now.toISOString()}
        where id=${input.runId}::uuid and status='running' and lease_owner=${input.owner}
          and lease_token=${input.token}::uuid and lease_expires_at > ${input.now.toISOString()} returning id`);
      return Boolean(row);
    },
  };
}

function parseCursor(value: unknown): ResponsibilityLease["cursor"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cursor: ResponsibilityLease["cursor"] = {};
  for (const [kind, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowedKinds.has(kind) || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const state = raw as Record<string, unknown>;
    if (typeof state.complete !== "boolean" || (state.after !== null && typeof state.after !== "string")) continue;
    cursor[kind as ResponsibilityScanKind] = { after: state.after as string | null, complete: state.complete };
  }
  return cursor;
}

/** Returns raw pointer rows only to the trusted Experience resolver. Callers
 * must never serialize this result; every item needs its owning native service's
 * current get/authorization/source-version check before public classification. */
export async function readResponsibilityPointersForResolution(db: Db, companyId: string, now = new Date()) {
  return db.execute<{ resource_kind: ResponsibilityScanKind; resource_id: string; source_version: string }>(sql`
    with latest as (
      select id from responsibility_scan_runs where company_id=${companyId}::uuid and status='complete'
      order by completed_at desc,id desc limit 1
    ), ranked as (
      select c.resource_kind,c.resource_id,c.source_version,
        row_number() over (partition by c.resource_kind order by c.resource_id asc) as internal_rank
      from responsibility_scan_candidates c join latest r on r.id=c.scan_run_id
      where c.company_id=${companyId}::uuid and c.expires_at > ${now.toISOString()}
    ) select resource_kind,resource_id,source_version from ranked
      where internal_rank <= ${MAX_DB_BATCH} order by resource_kind asc,resource_id asc`);
}

/** Reaper only. Delete expired pointer snapshots first; run-row TTL removes
 * abandoned cursors. This function changes scanner metadata, never native rows. */
export async function expireResponsibilityScanMetadata(db: Db, now = new Date(), limit = 500) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const pointers = await db.execute(sql`with expired as (
      select id from responsibility_scan_candidates where expires_at <= ${now.toISOString()} order by expires_at asc limit ${safeLimit}
      for update skip locked
    ) delete from responsibility_scan_candidates c using expired e where c.id=e.id returning c.id`);
  const runs = await db.execute(sql`with expired as (
      select id from responsibility_scan_runs where expires_at <= ${now.toISOString()}
        and (status <> 'running' or lease_expires_at <= ${now.toISOString()})
      order by expires_at asc limit ${safeLimit} for update skip locked
    ) delete from responsibility_scan_runs r using expired e where r.id=e.id returning r.id`);
  return { pointersDeleted: (pointers as unknown as unknown[]).length, runsDeleted: (runs as unknown as unknown[]).length };
}
