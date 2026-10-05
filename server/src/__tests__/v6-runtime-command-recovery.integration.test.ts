import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  authUsers,
  runtimeCapacityProfiles,
  runtimeVersionCatalog,
  runtimeCells,
  runtimeHosts,
  runtimeOperations,
  runtimeHostCommands,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { runtimeControlService } from "../services/runtime/control.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { sha256 } from "../services/saas/crypto.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 current-generation command recovery",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>;
    const config = {
      runtime: { suspectSeconds: 90, relayPort: 3102 },
    } as SaasPlatformConfig;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v6-commands-");
      db = createDb(database.connectionString);
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    it("blocks expired completion, reconciles a terminal receipt without a new command and rejects stale generations", async () => {
      const now = new Date();
      await db
        .insert(authUsers)
        .values({
          id: "owner",
          name: "Owner",
          email: "owner@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        });
      const onboarding = await saasOnboardingService(db).create("owner", {
        name: "Recovery fixture",
        idempotencyKey: "recovery-fixture-company-001",
      });
      const digest = "fixture.invalid/openclaw@sha256:" + "a".repeat(64);
      await db
        .insert(runtimeVersionCatalog)
        .values({
          imageDigest: digest,
          providerVersion: "fixture-only",
          stateFormat: "v1",
          hostAgentMinimumVersion: "6.0.0",
          conformance: { fixtureOnly: true },
          status: "approved",
        });
      await db
        .insert(runtimeCapacityProfiles)
        .values({
          key: "fixture",
          cpuMillis: 1000,
          memoryBytes: 1000000000n,
          diskBytes: 10000000000n,
          pidsLimit: 128,
          qualified: false,
        });
      const [host] = await db
        .insert(runtimeHosts)
        .values({
          environment: "staging",
          region: "dk-cph1",
          capacityClass: "fixture",
          status: "READY",
          cpuTotalMillis: 4000,
          memoryTotalBytes: 8000000000n,
          diskTotalBytes: 40000000000n,
          lastHeartbeatAt: now,
        })
        .returning();
      const [cell] = await db
        .insert(runtimeCells)
        .values({
          companyId: onboarding.companyId,
          billingAccountId: onboarding.billingAccountId,
          runtimeHostId: host!.id,
          capacityProfile: "fixture",
          isolationMode: "company_cell",
          desiredImageDigest: digest,
          status: "STARTING",
        })
        .returning();
      const deadline = new Date(now.getTime() - 1000);
      const [operation] = await db
        .insert(runtimeOperations)
        .values({
          companyId: cell!.companyId,
          runtimeCellId: cell!.id,
          operationType: "start",
          requestedByType: "user",
          requestedById: "owner",
          idempotencyKey: "fixture-start",
          requestHash: "fixture",
          status: "RUNNING",
          deadlineAt: deadline,
        })
        .returning();
      const claimToken = "x".repeat(43);
      const [command] = await db
        .insert(runtimeHostCommands)
        .values({
          runtimeHostId: host!.id,
          companyId: cell!.companyId,
          runtimeCellId: cell!.id,
          operationId: operation!.id,
          cellGeneration: 1n,
          commandType: "start",
          idempotencyKey: "fixture-command",
          payload: { imageDigest: digest },
          status: "CLAIMED",
          claimTokenHash: sha256(claimToken),
          attempt: 1,
          leaseUntil: deadline,
          deadlineAt: deadline,
        })
        .returning();
      const runtime = runtimeControlService(db, config),
        result = {
          generation: "1",
          success: true,
          state: "healthy",
          evidence: {
            imageDigest: digest,
            gatewayHandshake: true,
            volumeMounted: true,
          },
        };
      await expect(
        runtime.complete(host!.id, command!.id, { ...result, claimToken }, now),
      ).rejects.toMatchObject({ status: 409 });
      await runtime.reconcileCommands(now);
      expect(
        (
          await db
            .select()
            .from(runtimeOperations)
            .where(eq(runtimeOperations.id, operation!.id))
        )[0]!.status,
      ).toBe("NEEDS_RECONCILIATION");
      expect(await runtime.recoveryCommands(host!.id)).toEqual([
        { id: command!.id, generation: "1" },
      ]);
      await expect(
        runtime.recordRecovery(
          host!.id,
          command!.id,
          { ...result, generation: "2" },
          now,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        runtime.recordRecovery(crypto.randomUUID(), command!.id, result, now),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await runtime.recordRecovery(host!.id, command!.id, result, now),
      ).toEqual({ duplicate: false });
      expect(
        await runtime.recordRecovery(host!.id, command!.id, result, now),
      ).toEqual({ duplicate: true });
      expect(
        (
          await db
            .select()
            .from(runtimeCells)
            .where(eq(runtimeCells.id, cell!.id))
        )[0]!.status,
      ).toBe("HEALTHY");
      expect(await db.select().from(runtimeHostCommands)).toHaveLength(1);
    });
  },
);
