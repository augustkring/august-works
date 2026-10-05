import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  authUsers,
  companySecrets,
  createDb,
  runtimeBackups,
  runtimeCapacityProfiles,
  runtimeCells,
  runtimeOperations,
  runtimeVersionCatalog,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { runtimeBackupRetention } from "../services/runtime/backup-retention.js";
import { runtimeBackupService } from "../services/runtime/backups.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { secretService } from "../services/secrets.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 backup retention and restore races",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>;
    let companyId: string, cellId: string;
    const now = new Date(),
      objects = new Set<string>();
    beforeAll(async () => {
      vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "a".repeat(64));
      database = await startEmbeddedPostgresTestDatabase("aw-v6-retention-");
      db = createDb(database.connectionString);
      await db
        .insert(authUsers)
        .values({
          id: "retention-owner",
          name: "Owner",
          email: "retention@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        });
      const company = await saasOnboardingService(db).create(
        "retention-owner",
        { name: "Retention fixture", idempotencyKey: "retention-fixture-001" },
      );
      companyId = company.companyId;
      await db
        .insert(runtimeCapacityProfiles)
        .values({
          key: "fixture",
          cpuMillis: 1000,
          memoryBytes: 1000000000n,
          diskBytes: 10000000000n,
          pidsLimit: 128,
        });
      await db
        .insert(runtimeVersionCatalog)
        .values({
          imageDigest: "fixture.invalid/openclaw@sha256:" + "a".repeat(64),
          providerVersion: "fixture",
          stateFormat: "fixture",
          hostAgentMinimumVersion: "6.0.0",
          conformance: { fixtureOnly: true },
        });
      const [cell] = await db
        .insert(runtimeCells)
        .values({
          companyId,
          billingAccountId: company.billingAccountId,
          capacityProfile: "fixture",
          isolationMode: "company_cell",
          desiredImageDigest:
            "fixture.invalid/openclaw@sha256:" + "a".repeat(64),
          status: "STOPPED",
        })
        .returning();
      cellId = cell!.id;
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
      vi.unstubAllEnvs();
    }, 30000);
    async function fixture() {
      const id = randomUUID(),
        key = await secretService(db).create(
          companyId,
          {
            name: "Runtime backup " + id,
            provider: "local_encrypted",
            value: "b".repeat(64),
          },
          { userId: "retention-owner" },
        );
      const [backup] = await db
        .insert(runtimeBackups)
        .values({
          id,
          companyId,
          runtimeCellId: cellId,
          generation: 1n,
          imageDigest: "fixture.invalid/openclaw@sha256:" + "a".repeat(64),
          stateFormat: "fixture",
          status: "VERIFIED",
          objectKey:
            "companies/" +
            companyId +
            "/runtime-backups/" +
            cellId +
            "/" +
            id +
            ".awb6",
          encryptionKeyRef: key.id,
          retainUntil: new Date(now.getTime() - 1),
        })
        .returning();
      objects.add(backup!.objectKey);
      return backup!;
    }
    it("does not erase a backup referenced by an active or unknown restore", async () => {
      const backup = await fixture();
      const [operation] = await db
        .insert(runtimeOperations)
        .values({
          companyId,
          runtimeCellId: cellId,
          operationType: "restore",
          status: "NEEDS_RECONCILIATION",
          requestedByType: "user",
          requestedById: "retention-owner",
          idempotencyKey: "restore-retention-fixture",
          requestHash: "fixture",
          desiredState: { backupId: backup.id },
          deadlineAt: now,
        })
        .returning();
      const remove = vi.fn(async (key: string) => {
        objects.delete(key);
      });
      const retention = runtimeBackupRetention(db, {
        remove,
        exists: async (key) => objects.has(key),
      });
      expect(await retention.expireOne(now)).toBe(false);
      expect(remove).not.toHaveBeenCalled();
      await db
        .update(runtimeOperations)
        .set({ status: "FAILED" })
        .where(eq(runtimeOperations.id, operation!.id));
      expect(await retention.expireOne(now)).toBe(true);
      expect(
        await db
          .select()
          .from(companySecrets)
          .where(eq(companySecrets.id, backup.encryptionKeyRef)),
      ).toHaveLength(0);
    });
    it("retries lost deletion acknowledgements without falsely claiming erasure", async () => {
      const backup = await fixture(),
        remove = vi
          .fn()
          .mockImplementationOnce(async (key: string) => {
            objects.delete(key);
            throw Error("Lost deletion acknowledgement");
          })
          .mockResolvedValue(undefined);
      const retention = runtimeBackupRetention(db, {
        remove,
        exists: async (key) => objects.has(key),
      });
      await expect(retention.expireOne(now)).rejects.toThrow("Lost deletion");
      expect(
        (
          await db
            .select()
            .from(runtimeBackups)
            .where(eq(runtimeBackups.id, backup.id))
        )[0]!.deletedAt,
      ).toBeNull();
      expect(
        await db
          .select()
          .from(companySecrets)
          .where(eq(companySecrets.id, backup.encryptionKeyRef)),
      ).toHaveLength(1);
      expect(await retention.expireOne(now)).toBe(true);
      expect(remove).toHaveBeenCalledTimes(2);
    });
    it("locks retention against a concurrent restore selection", async () => {
      const backup = await fixture();
      let release!: () => void, started!: () => void;
      const entered = new Promise<void>((resolve) => {
          started = resolve;
        }),
        barrier = new Promise<void>((resolve) => {
          release = resolve;
        });
      const retention = runtimeBackupRetention(db, {
        async remove(key) {
          started();
          await barrier;
          objects.delete(key);
        },
        exists: async (key) => objects.has(key),
      });
      const expired = retention.expireOne(now);
      await entered;
      const selection = db.transaction((tx) =>
        runtimeBackupService(db, {} as SaasPlatformConfig).get(
          companyId,
          backup.id,
          tx,
        ),
      );
      const assertion = expect(selection).rejects.toMatchObject({
        status: 404,
      });
      release();
      expect(await expired).toBe(true);
      await assertion;
    });
  },
);
