import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  applicationStorageObjects,
  assets,
  billingAccountCompanies,
  billingAccounts,
  companies,
  type Db,
} from "@paperclipai/db";
import type {
  StorageAccounting,
  StorageProvider,
} from "../../storage/types.js";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { entitlementService } from "./entitlements.js";
import { usageService } from "./usage.js";

/** Durable reservations serialize aggregate account quota before any provider write. */
export function applicationStorageService(db: Db, provider: StorageProvider) {
  function scope(companyId: string, objectKey: string) {
    if (!objectKey.startsWith(companyId + "/") || objectKey.includes(".."))
      throw forbidden("Company object scope required");
  }
  async function account(tx: Pick<Db, "select">, companyId: string) {
    const [association] = await tx
      .select()
      .from(billingAccountCompanies)
      .where(
        and(
          eq(billingAccountCompanies.companyId, companyId),
          eq(billingAccountCompanies.status, "active"),
        ),
      )
      .limit(1);
    if (!association) throw notFound("Company billing account not found");
    return association.billingAccountId;
  }
  async function allocation(reader: Pick<Db, "execute">, accountId: string) {
    const [result] = await reader.execute<{ bytes: string }>(sql`
      select (coalesce((select sum(byte_size) from application_storage_objects
        where billing_account_id=${accountId}::uuid and status <> 'deleted'),0)
        + coalesce((select sum(a.byte_size) from assets a
          join billing_account_companies c on c.company_id=a.company_id and c.status='active'
          where c.billing_account_id=${accountId}::uuid and not exists
            (select 1 from application_storage_objects o where o.company_id=a.company_id and o.object_key=a.object_key)),0))::text as bytes
    `);
    return BigInt(result?.bytes ?? "0");
  }
  async function meter(
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
    row: typeof applicationStorageObjects.$inferSelect,
    end: Date,
  ) {
    if (!row.meteredThrough || end <= row.meteredThrough) return;
    const [association] = await tx
      .select({ id: billingAccountCompanies.id })
      .from(billingAccountCompanies)
      .where(
        and(
          eq(billingAccountCompanies.companyId, row.companyId),
          eq(billingAccountCompanies.billingAccountId, row.billingAccountId),
          eq(billingAccountCompanies.status, "active"),
        ),
      )
      .limit(1);
    // Closed/offboarding accounts do not accumulate customer storage charges during mandatory retention.
    if (association)
      await usageService(db).record(
        {
          companyId: row.companyId,
          meterKey: "storage.byte_millisecond",
          resourceType: "application_object",
          resourceId: row.id,
          quantity:
            row.byteSize * BigInt(end.getTime() - row.meteredThrough.getTime()),
          periodStart: row.meteredThrough,
          periodEnd: end,
          sourceEventId:
            row.meteredThrough.toISOString() + ":" + end.toISOString(),
        },
        tx,
      );
    await tx
      .update(applicationStorageObjects)
      .set({ meteredThrough: end })
      .where(eq(applicationStorageObjects.id, row.id));
  }
  const accounting: StorageAccounting = {
    async reserve(companyId, objectKey, byteSize) {
      scope(companyId, objectKey);
      if (!Number.isSafeInteger(byteSize) || byteSize <= 0)
        throw unprocessable("Invalid storage size");
      await db.transaction(async (tx) => {
        const [company] = await tx
          .select({ status: companies.status })
          .from(companies)
          .where(eq(companies.id, companyId))
          .for("share");
        if (!company || company.status !== "active")
          throw forbidden("Active company required for uploads");
        const accountId = await account(tx, companyId);
        await tx
          .select({ id: billingAccounts.id })
          .from(billingAccounts)
          .where(eq(billingAccounts.id, accountId))
          .for("update");
        const [existing] = await tx
          .select()
          .from(applicationStorageObjects)
          .where(
            and(
              eq(applicationStorageObjects.companyId, companyId),
              eq(applicationStorageObjects.objectKey, objectKey),
            ),
          )
          .limit(1);
        if (existing)
          throw conflict("An application object key cannot be reused");
        const state = await entitlementService(tx as unknown as Db).resolve(
          companyId,
        );
        if (
          state.access === "read_only" ||
          state.entitlements["platform.access"] !== true
        )
          throw forbidden("Commercial access required for uploads", {
            code: "ENTITLEMENT_REQUIRED",
          });
        const used = await allocation(tx, accountId),
          limit = BigInt(String(state.entitlements["storage.included_bytes"]));
        if (used + BigInt(byteSize) > limit)
          throw forbidden(
            "Storage allowance exceeded. Existing files remain readable and removable.",
            {
              code: "STORAGE_PLAN_LIMIT",
              usedBytes: used.toString(),
              includedBytes: limit.toString(),
            },
          );
        await tx
          .insert(applicationStorageObjects)
          .values({
            companyId,
            billingAccountId: accountId,
            objectKey,
            byteSize: BigInt(byteSize),
          });
      });
    },
    async stored(companyId, objectKey) {
      scope(companyId, objectKey);
      const now = new Date();
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(applicationStorageObjects)
          .where(
            and(
              eq(applicationStorageObjects.companyId, companyId),
              eq(applicationStorageObjects.objectKey, objectKey),
            ),
          )
          .for("update");
        if (!row || row.status !== "reserved")
          throw conflict("Storage reservation is no longer current");
        await tx
          .update(applicationStorageObjects)
          .set({
            status: "present",
            storedAt: now,
            meteredThrough: now,
            lastObservedAt: now,
            updatedAt: now,
          })
          .where(eq(applicationStorageObjects.id, row.id));
      });
    },
    async deleting(companyId, objectKey) {
      scope(companyId, objectKey);
      await db
        .update(applicationStorageObjects)
        .set({ status: "deleting", updatedAt: new Date() })
        .where(
          and(
            eq(applicationStorageObjects.companyId, companyId),
            eq(applicationStorageObjects.objectKey, objectKey),
            inArray(applicationStorageObjects.status, ["reserved", "present"]),
          ),
        );
    },
    async deleted(companyId, objectKey) {
      scope(companyId, objectKey);
      const now = new Date();
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(applicationStorageObjects)
          .where(
            and(
              eq(applicationStorageObjects.companyId, companyId),
              eq(applicationStorageObjects.objectKey, objectKey),
            ),
          )
          .for("update");
        if (!row || row.status === "deleted") return;
        await meter(tx, row, now);
        await tx
          .update(applicationStorageObjects)
          .set({
            status: "deleted",
            deletedAt: now,
            lastObservedAt: now,
            updatedAt: now,
          })
          .where(eq(applicationStorageObjects.id, row.id));
      });
    },
  };
  async function summary(companyId: string) {
    const state = await entitlementService(db).resolve(companyId);
    return {
      usedBytes: (await allocation(db, state.billingAccountId)).toString(),
      includedBytes: String(state.entitlements["storage.included_bytes"]),
      scope: "billing_account" as const,
    };
  }
  async function reconcileOne(now = new Date()) {
    // Existing asset metadata is adopted without back-billing historical local usage.
    await db.execute(sql`
      insert into application_storage_objects (company_id,billing_account_id,object_key,byte_size,status)
      select a.company_id,c.billing_account_id,a.object_key,a.byte_size,'reserved' from assets a
      join billing_account_companies c on c.company_id=a.company_id and c.status='active'
      where a.provider=${provider.id} and a.byte_size>0 and not exists
        (select 1 from application_storage_objects o where o.company_id=a.company_id and o.object_key=a.object_key)
      order by a.id limit 10 on conflict do nothing
    `);
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(applicationStorageObjects)
        .where(
          and(
            inArray(applicationStorageObjects.status, [
              "reserved",
              "present",
              "deleting",
            ]),
            sql`${applicationStorageObjects.updatedAt} < ${new Date(now.getTime() - 300000).toISOString()}::timestamptz`,
            sql`(${applicationStorageObjects.lastObservedAt} is null or ${applicationStorageObjects.lastObservedAt} <= ${new Date(now.getTime() - 60000).toISOString()}::timestamptz)`,
          ),
        )
        .orderBy(
          asc(applicationStorageObjects.lastObservedAt),
          applicationStorageObjects.id,
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return false;
      scope(row.companyId, row.objectKey);
      let head = await provider.headObject({ objectKey: row.objectKey });
      if (
        row.status === "deleting" ||
        (row.status === "reserved" && !head.exists)
      ) {
        // Upload calls have a 30-second transport deadline; cleanup starts after a five-minute settlement window.
        await provider.deleteObject({ objectKey: row.objectKey });
        head = await provider.headObject({ objectKey: row.objectKey });
        if (head.exists) throw conflict("Storage cleanup is unconfirmed");
      }
      if (head.exists && head.contentLength !== Number(row.byteSize))
        throw conflict("Storage evidence does not match its reservation");
      if (row.status === "reserved" && head.exists) {
        // Acknowledgement loss is reconciled from the provider receipt, never a second upload.
        const observed =
          head.lastModified &&
          head.lastModified >= row.createdAt &&
          head.lastModified <= now
            ? head.lastModified
            : now;
        await tx
          .update(applicationStorageObjects)
          .set({
            status: "present",
            storedAt: observed,
            meteredThrough: observed,
            lastObservedAt: now,
            updatedAt: now,
          })
          .where(eq(applicationStorageObjects.id, row.id));
      } else {
        const end = row.meteredThrough
          ? new Date(
              Math.min(
                now.getTime(),
                row.meteredThrough.getTime() + 366 * 86400000,
              ),
            )
          : now;
        await meter(tx, row, end);
        await tx
          .update(applicationStorageObjects)
          .set({
            lastObservedAt: now,
            ...(head.exists ? {} : { status: "deleted", deletedAt: now }),
            updatedAt: now,
          })
          .where(eq(applicationStorageObjects.id, row.id));
      }
      return true;
    });
  }
  return { accounting, summary, reconcileOne };
}
