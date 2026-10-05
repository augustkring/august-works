import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  billingAccountCompanies,
  usageAggregates,
  usageEvents,
  type Db,
} from "@paperclipai/db";
import { conflict, notFound, unprocessable } from "../../errors.js";

export const USAGE_METERS = {
  "runtime.shared_millisecond": "millisecond",
  "runtime.dedicated_gateway_millisecond": "millisecond",
  "runtime.dedicated_vm_millisecond": "millisecond",
  "storage.byte_millisecond": "byte_millisecond",
  "backup.byte_millisecond": "byte_millisecond",
} as const;
type Meter = keyof typeof USAGE_METERS;
/** Exact integer meters describe infrastructure consumption, never LLM token resale. */
export function usageService(db: Db) {
  async function record(
    input: {
      companyId: string;
      meterKey: Meter;
      resourceType: string;
      resourceId: string;
      quantity: bigint;
      periodStart: Date;
      periodEnd: Date;
      sourceEventId: string;
    },
    writeDb: Pick<Db, "select" | "insert"> = db,
  ) {
    if (
      !(input.meterKey in USAGE_METERS) ||
      input.quantity < 0n ||
      input.quantity.toString().length > 40 ||
      !Number.isSafeInteger(input.periodStart.getTime()) ||
      !Number.isSafeInteger(input.periodEnd.getTime()) ||
      input.periodEnd < input.periodStart ||
      input.periodEnd.getTime() - input.periodStart.getTime() > 366 * 86400000
    )
      throw unprocessable("Invalid usage sample");
    const [association] = await writeDb
      .select()
      .from(billingAccountCompanies)
      .where(
        and(
          eq(billingAccountCompanies.companyId, input.companyId),
          eq(billingAccountCompanies.status, "active"),
        ),
      )
      .limit(1);
    if (!association) throw notFound("Billing account not found");
    const values = {
      ...input,
      quantity: input.quantity.toString(),
      unit: USAGE_METERS[input.meterKey],
      billingAccountId: association.billingAccountId,
    };
    const [created] = await writeDb
      .insert(usageEvents)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: usageEvents.id });
    if (!created) {
      const [existing] = await writeDb
        .select()
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.companyId, input.companyId),
            eq(usageEvents.meterKey, input.meterKey),
            eq(usageEvents.resourceType, input.resourceType),
            eq(usageEvents.resourceId, input.resourceId),
            eq(usageEvents.sourceEventId, input.sourceEventId),
          ),
        )
        .limit(1);
      if (
        !existing ||
        existing.quantity !== values.quantity ||
        existing.periodStart.getTime() !== input.periodStart.getTime() ||
        existing.periodEnd.getTime() !== input.periodEnd.getTime()
      )
        throw conflict("Usage source identifier has different evidence");
    }
    return created?.id ?? null;
  }
  async function calculate(
    companyId: string,
    start: Date,
    end: Date,
    reader: Pick<Db, "select"> = db,
  ) {
    if (end <= start) throw unprocessable("Invalid usage bucket");
    // Samples may span a bucket boundary. Milliseconds are prorated exactly; any indivisible remainder
    // belongs to the final intersecting bucket, making daily replay totals equal source totals.
    const rows = await reader
      .select()
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.companyId, companyId),
          lt(usageEvents.periodStart, end),
          gte(usageEvents.periodEnd, start),
        ),
      );
    const totals = new Map<
      Meter,
      { account: string; quantity: bigint; watermark: Date }
    >();
    for (const row of rows) {
      const duration = BigInt(
        row.periodEnd.getTime() - row.periodStart.getTime(),
      );
      let quantity = 0n;
      if (duration === 0n) {
        if (row.periodStart >= start && row.periodStart < end)
          quantity = BigInt(row.quantity);
      } else {
        const left = BigInt(
          Math.max(start.getTime(), row.periodStart.getTime()) -
            row.periodStart.getTime(),
        );
        const right = BigInt(
          Math.min(end.getTime(), row.periodEnd.getTime()) -
            row.periodStart.getTime(),
        );
        quantity =
          (BigInt(row.quantity) * right) / duration -
          (BigInt(row.quantity) * left) / duration;
      }
      const key = row.meterKey as Meter;
      const existing = totals.get(key);
      if (existing && existing.account !== row.billingAccountId)
        throw conflict("Usage bucket crosses billing account ownership");
      totals.set(key, {
        account: row.billingAccountId,
        quantity: (existing?.quantity ?? 0n) + quantity,
        watermark: new Date(
          Math.max(
            existing?.watermark.getTime() ?? 0,
            row.recordedAt.getTime(),
          ),
        ),
      });
    }
    return totals;
  }
  const quantities = (totals: Awaited<ReturnType<typeof calculate>>) =>
    Object.fromEntries(
      [...totals].map(([key, value]) => [key, value.quantity.toString()]),
    );
  async function rebuild(
    companyId: string,
    start: Date,
    end: Date,
    now = new Date(),
  ) {
    if (
      start.getUTCHours() ||
      start.getUTCMinutes() ||
      start.getUTCSeconds() ||
      start.getUTCMilliseconds() ||
      end.getTime() - start.getTime() !== 86400000
    )
      throw unprocessable("Persisted aggregates require one UTC day");
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"aw-usage:" + companyId + ":" + start.toISOString()},0))`,
      );
      const totals = await calculate(companyId, start, end, tx);
      await tx
        .delete(usageAggregates)
        .where(
          and(
            eq(usageAggregates.companyId, companyId),
            eq(usageAggregates.bucketStart, start),
            eq(usageAggregates.bucketEnd, end),
          ),
        );
      for (const [meterKey, value] of totals)
        await tx
          .insert(usageAggregates)
          .values({
            companyId,
            billingAccountId: value.account,
            meterKey,
            bucketStart: start,
            bucketEnd: end,
            quantity: value.quantity.toString(),
            unit: USAGE_METERS[meterKey],
            sourceWatermark: value.watermark,
            calculatedAt: now,
          });
      return quantities(totals);
    });
  }
  async function summary(companyId: string, start: Date, end: Date) {
    if (
      !Number.isSafeInteger(start.getTime()) ||
      !Number.isSafeInteger(end.getTime()) ||
      end <= start ||
      end.getTime() - start.getTime() > 366 * 86400000
    )
      throw unprocessable("Usage window must be at most one year");
    const totals = quantities(await calculate(companyId, start, end));
    return {
      periodStart: start,
      periodEnd: end,
      meters: Object.entries(totals)
        .filter(([meterKey]) => meterKey !== "backup.byte_millisecond")
        .map(([meterKey, quantity]) => ({
          meterKey,
          quantity,
          unit: USAGE_METERS[meterKey as Meter],
        })),
      providerModelCosts: "byok_separate" as const,
    };
  }
  async function rebuildDirtyDays(now = new Date()) {
    // Source timestamps identify late arrivals too. No query from the customer UI drives persistence.
    // Millisecond SQL boundaries match the JS calculator, including samples ending exactly at midnight.
    const candidates = await db.execute<{
      company_id: string;
      bucket_start: string | Date;
    }>(sql`
      select distinct e.company_id, day.bucket_start
      from usage_events e
      cross join lateral generate_series(
        date_trunc('day', e.period_start at time zone 'UTC') at time zone 'UTC',
        date_trunc('day', least(e.period_end, ${now.toISOString()}::timestamptz) at time zone 'UTC') at time zone 'UTC',
        interval '1 day'
      ) day(bucket_start)
      left join usage_aggregates a on a.company_id=e.company_id and a.meter_key=e.meter_key
        and a.bucket_start=day.bucket_start and a.bucket_end=day.bucket_start+interval '1 day'
      where e.period_start <= ${now.toISOString()}::timestamptz
        and (e.period_end > day.bucket_start or (e.period_start=e.period_end and e.period_start=day.bucket_start))
        and (a.id is null or e.recorded_at > a.calculated_at)
      order by day.bucket_start, e.company_id limit 10
    `);
    for (const candidate of candidates) {
      const start = new Date(candidate.bucket_start);
      await rebuild(
        candidate.company_id,
        start,
        new Date(start.getTime() + 86400000),
        now,
      );
    }
    return candidates.length;
  }
  return { record, rebuild, rebuildDirtyDays, summary };
}
