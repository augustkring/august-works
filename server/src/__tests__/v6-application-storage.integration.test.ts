import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  applicationStorageObjects,
  assets,
  authUsers,
  billingAccountCompanies,
  billingEntitlementOverrides,
  billingSubscriptions,
  createDb,
  usageEvents,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { applicationStorageService } from "../services/billing/storage.js";
import { createStorageService } from "../storage/service.js";
import type { StorageProvider } from "../storage/types.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 application storage against migrated PostgreSQL",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>;
    let companyId: string, otherCompanyId: string, accountId: string;
    const objects = new Map<string, { body: Buffer; createdAt: Date }>();
    let losePutAck = false,
      loseDeleteAck = false,
      puts = 0;
    const provider: StorageProvider = {
      id: "s3",
      async putObject(input) {
        puts++;
        objects.set(input.objectKey, {
          body: input.body as Buffer,
          createdAt: new Date(),
        });
        if (losePutAck) throw Error("Lost PUT acknowledgement");
      },
      async getObject(input) {
        return { stream: Readable.from(objects.get(input.objectKey)!.body) };
      },
      async headObject(input) {
        const value = objects.get(input.objectKey);
        return value
          ? {
              exists: true,
              contentLength: value.body.length,
              lastModified: value.createdAt,
            }
          : { exists: false };
      },
      async deleteObject(input) {
        objects.delete(input.objectKey);
        if (loseDeleteAck) throw Error("Lost DELETE acknowledgement");
      },
    };
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v6-storage-");
      db = createDb(database.connectionString);
      const now = new Date();
      await db.insert(authUsers).values({
        id: "storage-owner",
        name: "Owner",
        email: "storage@example.test",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      const service = saasOnboardingService(db);
      const first = await service.create("storage-owner", {
        name: "Storage A",
        idempotencyKey: "storage-company-a-001",
      });
      const second = await service.create("storage-owner", {
        name: "Storage B",
        idempotencyKey: "storage-company-b-001",
      });
      companyId = first.companyId;
      accountId = first.billingAccountId;
      otherCompanyId = second.companyId;
      await db
        .update(billingAccountCompanies)
        .set({ billingAccountId: accountId })
        .where(eq(billingAccountCompanies.companyId, otherCompanyId));
      await db.insert(billingSubscriptions).values({
        billingAccountId: accountId,
        providerSubscriptionId: "sub_storage",
        status: "active",
        productKeys: ["platform"],
        currentPeriodEnd: new Date(now.getTime() + 86400000),
        providerUpdatedAt: now,
        sourceHash: "fixture",
      });
      await db.insert(billingEntitlementOverrides).values({
        billingAccountId: accountId,
        entitlementKey: "storage.included_bytes",
        value: "10",
        reason: "Bounded concurrency fixture",
        createdByUserId: "operator",
        startsAt: new Date(now.getTime() - 86400000),
        expiresAt: new Date(now.getTime() + 86400000),
      });
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    const input = (company = companyId) => ({
      companyId: company,
      namespace: "artifacts",
      originalFilename: "fixture.txt",
      contentType: "text/plain",
      body: Buffer.from("123456"),
    });
    it("serializes shared-account reservations before concurrent provider writes", async () => {
      const accounting = applicationStorageService(db, provider),
        storage = createStorageService(provider, accounting.accounting);
      expect(
        (await db.select().from(billingEntitlementOverrides))[0]!.value,
      ).toBe("10");
      expect((await accounting.summary(companyId)).includedBytes).toBe("10");
      const results = await Promise.allSettled([
        storage.putFile(input()),
        storage.putFile(input(otherCompanyId)),
      ]);
      expect(
        results.filter((value) => value.status === "fulfilled"),
      ).toHaveLength(1);
      expect(puts).toBe(1);
      const denied = results.find(
        (value) => value.status === "rejected",
      ) as PromiseRejectedResult;
      expect(denied.reason).toMatchObject({
        status: 403,
        details: { code: "STORAGE_PLAN_LIMIT" },
      });
      expect(await accounting.summary(companyId)).toMatchObject({
        usedBytes: "6",
        includedBytes: "10",
        scope: "billing_account",
      });
      const [row] = await db.select().from(applicationStorageObjects);
      await expect(
        storage.getObject(
          row!.companyId === companyId ? otherCompanyId : companyId,
          row!.objectKey,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await storage.deleteObject(row!.companyId, row!.objectKey);
      expect((await accounting.summary(companyId)).usedBytes).toBe("0");
    });
    it("reconciles lost upload and deletion acknowledgements without re-uploading or double metering", async () => {
      const accounting = applicationStorageService(db, provider),
        storage = createStorageService(provider, accounting.accounting);
      losePutAck = true;
      const initialPuts = puts;
      await expect(storage.putFile(input())).rejects.toThrow(
        "Lost PUT acknowledgement",
      );
      losePutAck = false;
      const [pending] = (
        await db.select().from(applicationStorageObjects)
      ).filter((row) => row.status === "reserved");
      const old = new Date(Date.now() - 600000),
        storedAt = new Date(old.getTime() + 1000);
      objects.get(pending!.objectKey)!.createdAt = storedAt;
      await db
        .update(applicationStorageObjects)
        .set({ createdAt: old, updatedAt: old })
        .where(eq(applicationStorageObjects.id, pending!.id));
      const now = new Date();
      await accounting.reconcileOne(now);
      const [present] = await db
        .select()
        .from(applicationStorageObjects)
        .where(eq(applicationStorageObjects.id, pending!.id));
      expect(present).toMatchObject({ status: "present", storedAt });
      expect(puts).toBe(initialPuts + 1);
      await db
        .update(applicationStorageObjects)
        .set({ updatedAt: old, lastObservedAt: old })
        .where(eq(applicationStorageObjects.id, pending!.id));
      await Promise.all([
        accounting.reconcileOne(now),
        accounting.reconcileOne(now),
      ]);
      const events = (await db.select().from(usageEvents)).filter(
        (row) => row.resourceId === pending!.id,
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.quantity).toBe(
        (6n * BigInt(now.getTime() - storedAt.getTime())).toString(),
      );
      loseDeleteAck = true;
      await expect(
        storage.deleteObject(companyId, pending!.objectKey),
      ).rejects.toThrow("Lost DELETE acknowledgement");
      loseDeleteAck = false;
      expect((await accounting.summary(companyId)).usedBytes).toBe("6");
      await db
        .update(applicationStorageObjects)
        .set({ updatedAt: old, lastObservedAt: old })
        .where(eq(applicationStorageObjects.id, pending!.id));
      await accounting.reconcileOne(new Date(now.getTime() + 1000));
      expect((await accounting.summary(companyId)).usedBytes).toBe("0");
      expect(
        (
          await db
            .select()
            .from(applicationStorageObjects)
            .where(eq(applicationStorageObjects.id, pending!.id))
        )[0]!.status,
      ).toBe("deleted");
    });
    it("preserves a 40-digit quota override as an exact decimal string", async () => {
      const value = "9999999999999999999999999999999999999999";
      await db
        .update(billingEntitlementOverrides)
        .set({ value })
        .where(eq(billingEntitlementOverrides.billingAccountId, accountId));
      expect(
        (await db.select().from(billingEntitlementOverrides))[0]!.value,
      ).toBe(value);
      expect(
        (await applicationStorageService(db, provider).summary(companyId))
          .includedBytes,
      ).toBe(value);
      await db
        .update(billingEntitlementOverrides)
        .set({ value: "10" })
        .where(eq(billingEntitlementOverrides.billingAccountId, accountId));
    });
    it("counts legacy owned artifacts before admission, preserves removal after payment expiry and excludes safety data", async () => {
      const accounting = applicationStorageService(db, provider),
        storage = createStorageService(provider, accounting.accounting);
      const key = companyId + "/artifacts/legacy-" + randomUUID();
      objects.set(key, {
        body: Buffer.from("123456789"),
        createdAt: new Date(),
      });
      await db.insert(assets).values({
        companyId,
        provider: "s3",
        objectKey: key,
        contentType: "text/plain",
        byteSize: 9,
        sha256: "a".repeat(64),
      });
      await expect(storage.putFile(input())).rejects.toMatchObject({
        status: 403,
        details: { code: "STORAGE_PLAN_LIMIT" },
      });
      objects.set("run-logs/" + companyId + "/safety", {
        body: Buffer.alloc(100000),
        createdAt: new Date(),
      });
      expect((await accounting.summary(companyId)).usedBytes).toBe("9");
      await accounting.reconcileOne();
      const [adopted] = (
        await db.select().from(applicationStorageObjects)
      ).filter((row) => row.objectKey === key);
      await db
        .update(billingSubscriptions)
        .set({ status: "canceled" })
        .where(eq(billingSubscriptions.billingAccountId, accountId));
      await expect(storage.putFile(input())).rejects.toMatchObject({
        status: 403,
      });
      expect(await storage.getObject(companyId, key)).toBeTruthy();
      await storage.deleteObject(companyId, key);
      expect((await accounting.summary(companyId)).usedBytes).toBe("0");
      expect(
        (await db.select().from(usageEvents)).filter(
          (row) => row.resourceId === adopted!.id,
        ),
      ).toHaveLength(0);
    });
  },
);
