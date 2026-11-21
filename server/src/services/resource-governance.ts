import { eq, sql } from "drizzle-orm";
import { activityLog, instanceSettings, type Db } from "@paperclipai/db";
import { resourceGovernancePolicySchema, type ResourceGovernancePolicy } from "@paperclipai/shared";
import { HttpError, tooManyRequests } from "../errors.js";

export async function currentResourcePolicy(db: Pick<Db, "select">, lock = false): Promise<ResourceGovernancePolicy | null> {
  const query = db.select({ general: instanceSettings.general }).from(instanceSettings)
    .where(eq(instanceSettings.singletonKey, "default"));
  const [row] = await (lock ? query.for("share") : query);
  const raw = row?.general.resourceGovernance;
  return raw === undefined ? null : resourceGovernancePolicySchema.parse(raw);
}

export function isResourceAdmissionDeferred(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const value = error as { code?: unknown; message?: unknown; status?: unknown; details?: unknown; cause?: unknown };
    if (value.code === "P0001" && value.message === "resource_durable_execution_deferred") return true;
    const details = value.details;
    if (value.status === 429 && details && typeof details === "object" &&
        (details as Record<string, unknown>).code === "resource_durable_execution_deferred") return true;
    error = value.cause;
  }
  return false;
}

export function resourceAdmissionDeferredError() {
  return tooManyRequests("Configured execution capacity is temporarily occupied", {
    code: "resource_durable_execution_deferred", resource: "durable_execution", retryAfterSeconds: 1,
  });
}

/** Original analytical transaction lifetime only. These locks do not attest CPU
 * isolation or the death of an external process. The original child owner must
 * still settle/retain unknown effects through its own cancellation machinery. */
export async function admitAnalyticalRequest(tx: Db, companyId: string): Promise<void> {
  const policy = await currentResourcePolicy(tx, true);
  const pool = policy?.pools.find(value => value.resource === "analytical_request");
  if (!pool) return;
  const company = pool.companies.find(value => value.companyId === companyId);
  // Policy row stays locked through the request transaction: limits cannot be
  // shrunk while an admitted request is occupying an older slot range.
  async function acquire(key: string, limit: number) {
    // Inspect actual held slots instead of materializing 1..configured limit.
    // A racing claim can cause a conservative refusal, never an extra slot.
    const rows = await tx.execute(sql`with occupied as materialized (
        select objid::bigint as slot from pg_locks where locktype='advisory' and granted and objsubid=2
          and database=(select oid from pg_database where datname=current_database())
          and classid::bigint=(hashtext(${key})::bigint & 4294967295)),
      candidate as materialized (select used.slot+1 as slot from (select 0::bigint as slot union select slot from occupied) used
        where used.slot<${limit} and not exists(select 1 from occupied next where next.slot=used.slot+1)
        order by used.slot limit 1)
      select slot from candidate where pg_try_advisory_xact_lock(hashtext(${key}), slot::int)`);
    if (!rows.length) throw new HttpError(429, "Configured analytical request capacity is occupied", {
      code: "resource_analytical_request_busy", resource: "analytical_request", retryAfterSeconds: 1,
    });
  }
  if (company) await acquire(`aw-resource-analytical:company:${companyId}`, company.hardLimit);
  await acquire("aw-resource-analytical:platform", pool.hardLimit);
  if (pool.softLimit !== undefined) {
    const [observation] = await tx.execute<{ occupied: number }>(sql`select count(*)::int as occupied from pg_locks
      where locktype='advisory' and granted and objsubid=2
        and database=(select oid from pg_database where datname=current_database())
        and classid::bigint=(hashtext('aw-resource-analytical:platform')::bigint & 4294967295)`);
    if (observation && observation.occupied >= pool.softLimit) await tx.insert(activityLog).values({ companyId,
      actorType: "system", actorId: "resource-governance", action: "resource.admission_soft_limit",
      entityType: "resource_pool", entityId: "analytical_request",
      details: { resource: "analytical_request", unit: "admitted_request" } });
  }
}
