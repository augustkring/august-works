import {
  runtimeCatalogService,
  hostVersionMeetsMinimum,
} from "../services/runtime/catalog.js";
import { saasSupportService } from "../services/saas/support.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  agentIdentities,
  agentPresenceRuntimeBindings,
  agentProviderBindings,
  agents,
  authUsers,
  billingSubscriptions,
  createDb,
  heartbeatRuns,
  runtimeBackups,
  runtimeCapacityProfiles,
  runtimeCells,
  runtimeHosts,
  runtimeOperations,
  runtimeVersionCatalog,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { runtimeCommercialService } from "../services/runtime/commercial.js";
import { runtimeControlService } from "../services/runtime/control.js";
import { entitlementService } from "../services/billing/entitlements.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 commercial runtime reconciliation",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
    let db: ReturnType<typeof createDb>;
    const now = new Date("2026-10-04T12:00:00Z");
    let companyId: string, accountId: string, firstId: string, secondId: string;
    beforeAll(async () => {
      vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "a".repeat(64));
      database = await startEmbeddedPostgresTestDatabase("aw-v6-commercial-");
      db = createDb(database.connectionString);
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
      const run = await saasOnboardingService(db).create("owner", {
        name: "Commercial fixture",
        idempotencyKey: "commercial-company-001",
      });
      companyId = run.companyId;
      accountId = run.billingAccountId;
      const digest = "fixture.invalid/openclaw@sha256:" + "c".repeat(64);
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
          imageDigest: digest,
          providerVersion: "fixture-only",
          stateFormat: "fixture",
          hostAgentMinimumVersion: "6.0.0",
          conformance: { fixtureOnly: true },
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
        })
        .returning();
      const common = {
        companyId,
        billingAccountId: accountId,
        runtimeHostId: host!.id,
        capacityProfile: "fixture",
        isolationMode: "company_cell",
        desiredImageDigest: digest,
        status: "HEALTHY",
      };
      const [first] = await db
        .insert(runtimeCells)
        .values({ ...common, createdAt: new Date(now.getTime() - 1000) })
        .returning();
      firstId = first!.id;
      const [second] = await db
        .insert(runtimeCells)
        .values({ ...common, createdAt: now })
        .returning();
      secondId = second!.id;
      await db
        .insert(billingSubscriptions)
        .values({
          billingAccountId: accountId,
          providerSubscriptionId: "sub_fixture",
          status: "active",
          productKeys: ["platform", "runtime_standard"],
          currentPeriodEnd: new Date(now.getTime() + 86400000),
          graceUntil: new Date(now.getTime() + 8 * 86400000),
          providerUpdatedAt: now,
          sourceHash: "fixture",
        });
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
      vi.unstubAllEnvs();
    }, 30000);
    it("stops only excess cells, deduplicates stops and does not restart after payment recovery", async () => {
      const commercial = runtimeCommercialService(db);
      await Promise.all([commercial.reconcile(now), commercial.reconcile(now)]);
      const cells = await db.select().from(runtimeCells);
      expect(
        cells.find((cell) => cell.id === firstId)!.suspendedReason,
      ).toBeNull();
      expect(cells.find((cell) => cell.id === secondId)!.suspendedReason).toBe(
        "commercial_runtime_limit",
      );
      const stops = await db.select().from(runtimeOperations);
      expect(stops).toHaveLength(1);
      expect(stops[0]).toMatchObject({
        operationType: "stop",
        runtimeCellId: secondId,
        requestedByType: "system",
      });
      await db
        .update(runtimeOperations)
        .set({ status: "SUCCEEDED" })
        .where(eq(runtimeOperations.id, stops[0]!.id));
      await db
        .update(runtimeCells)
        .set({ status: "STOPPED" })
        .where(eq(runtimeCells.id, secondId));
      await db
        .update(billingSubscriptions)
        .set({
          productKeys: ["platform", "runtime_standard", "runtime_standard"],
        });
      await commercial.reconcile(now);
      expect(await db.select().from(runtimeOperations)).toHaveLength(1);
      expect(
        (
          await db
            .select()
            .from(runtimeCells)
            .where(eq(runtimeCells.id, secondId))
        )[0]!.suspendedReason,
      ).toBe("commercial_runtime_limit");
      const runtime = runtimeControlService(db, {
        runtime: { relayPort: 3102 },
      } as SaasPlatformConfig);
      await runtime.request(
        companyId,
        secondId,
        "owner",
        { action: "start", idempotencyKey: "explicit-start-001" },
        now,
      );
      expect(
        (
          await db
            .select()
            .from(runtimeCells)
            .where(eq(runtimeCells.id, secondId))
        )[0]!.suspendedReason,
      ).toBeNull();
    });
    it("requires owner approval for each operator runtime action and rejects revoked grants", async () => {
      const support = saasSupportService(db, {
        operatorUserIds: ["operator"],
        runtime: { relayPort: 3102 },
      } as SaasPlatformConfig);
      const session = await support.approve(
        companyId,
        "owner",
        {
          companyId,
          operatorUserId: "operator",
          reason: "Inspect and stop the fixture runtime",
          scopes: ["status:read", "runtime:manage"],
          expiresInMinutes: 10,
        },
        now,
      );
      await expect(
        support.runtimeAction(
          session.id,
          "owner",
          firstId,
          { action: "stop", idempotencyKey: "support-stop-fixture-001" },
          now,
        ),
      ).rejects.toMatchObject({ status: 403 });
      const operation = await support.runtimeAction(
        session.id,
        "operator",
        firstId,
        { action: "stop", idempotencyKey: "support-stop-fixture-001" },
        now,
      );
      expect(operation.runtimeCellId).toBe(firstId);
      await expect(
        support.runtimeAction(
          session.id,
          "operator",
          firstId,
          {
            action: "restore",
            backupId: crypto.randomUUID(),
            idempotencyKey: "support-restore-fixture-001",
          },
          now,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await support.revoke(companyId, "owner", session.id, now);
      await expect(
        support.runtimeAction(
          session.id,
          "operator",
          firstId,
          { action: "stop", idempotencyKey: "support-stop-fixture-001" },
          now,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("bounds stale active receipts and ends grace without deleting runtime state", async () => {
      const entitlements = entitlementService(db);
      const graceTime = new Date(now.getTime() + 2 * 86400000);
      expect((await entitlements.resolve(companyId, graceTime)).access).toBe(
        "grace",
      );
      await runtimeCommercialService(db).reconcile(graceTime);
      expect(
        (
          await db
            .select()
            .from(runtimeCells)
            .where(eq(runtimeCells.id, firstId))
        )[0]!.suspendedReason,
      ).toBeNull();
      const expiry = new Date(now.getTime() + 9 * 86400000);
      expect((await entitlements.resolve(companyId, expiry)).access).toBe(
        "read_only",
      );
      await runtimeCommercialService(db).reconcile(expiry);
      const first = (
        await db.select().from(runtimeCells).where(eq(runtimeCells.id, firstId))
      )[0]!;
      expect(first.suspendedReason).toBe("commercial_access_expired");
      expect(first.deletedAt).toBeNull();
      expect(first.stateStorageRef).toBeNull();
      await db.update(billingSubscriptions).set({ cancelAtPeriodEnd: true });
      expect((await entitlements.resolve(companyId, graceTime)).access).toBe(
        "read_only",
      );
    });
    it("keeps qualification internal, gates performance capacity by its product and never approves a canary without persisted execution and restore evidence", async () => {
      const sourceSha = "d".repeat(40),
        digest = "fixture.invalid/canary@sha256:" + "e".repeat(64);
      const config = {
        operatorUserIds: ["operator"],
        deployment: { sourceSha },
        objects: { endpoint: "https://objects.example.test" },
        runtime: { relayPort: 3102, hostPlan: "fixture-plan" },
      } as SaasPlatformConfig;
      const catalog = runtimeCatalogService(db, config),
        evidence = {
          reportUri:
            "https://objects.example.test/qualification/fixture-only.json",
          reportSha256: "f".repeat(64),
          qualifiedAt: now.toISOString(),
          qualificationSourceSha: sourceSha,
        };
      const candidate = {
        imageDigest: digest,
        providerVersion: "fixture-only",
        stateFormat: "fixture",
        hostAgentMinimumVersion: "6.0.0",
        conformance: {
          ...evidence,
          checks: {
            gateway: true,
            identity: true,
            taskExecution: true,
            runAccounting: true,
            tenantIsolation: true,
            egressIsolation: true,
            resourceLimits: true,
            restartRecovery: true,
            backupRestore: true,
            credentialStripping: true,
          },
        },
      };
      await expect(
        catalog.candidate("owner", candidate, now),
      ).rejects.toMatchObject({ status: 403 });
      await catalog.candidate("operator", candidate, now);
      await catalog.candidate("operator", candidate, now);
      await expect(
        catalog.transition(
          "operator",
          {
            imageDigest: digest,
            expectedStatus: "candidate",
            status: "approved",
            reason: "Fixture cannot skip the canary",
          },
          now,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await catalog.transition(
        "operator",
        {
          imageDigest: digest,
          expectedStatus: "candidate",
          status: "canary",
          reason: "Start the fixture-only canary",
        },
        now,
      );
      await expect(
        catalog.transition(
          "operator",
          {
            imageDigest: digest,
            expectedStatus: "candidate",
            status: "halted",
            reason: "Stale fixture version status",
          },
          now,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        catalog.transition(
          "operator",
          {
            imageDigest: digest,
            expectedStatus: "canary",
            status: "approved",
            reason: "A fixture has no live acceptance proof",
          },
          new Date(now.getTime() + 3600001),
        ),
      ).rejects.toMatchObject({ status: 409 });
      const profile = {
        key: "fixture-performance",
        commercialProductKey: "runtime_performance",
        cpuMillis: 1000,
        memoryBytes: "1000000000",
        diskBytes: "10000000000",
        pidsLimit: 128,
        benchmarkEvidence: {
          ...evidence,
          hostPlan: "fixture-plan",
          hostCpuMillis: 4000,
          hostMemoryBytes: "8000000000",
          hostDiskBytes: "40000000000",
          isolationPassed: true,
          quotaEnforcementPassed: true,
          cpuStressPassed: true,
          memoryStressPassed: true,
          diskStressPassed: true,
        },
      };
      await catalog.qualifyCapacity("operator", profile, now);
      await expect(
        catalog.qualifyCapacity(
          "operator",
          { ...profile, cpuMillis: 2000 },
          now,
        ),
      ).rejects.toMatchObject({ status: 409 });
      const runtime = runtimeControlService(db, config),
        input = {
          capacityProfile: profile.key,
          imageDigest: digest,
          isolationMode: "company_cell" as const,
          idempotencyKey: "canary-fixture-request-001",
        };
      await db
        .update(billingSubscriptions)
        .set({
          cancelAtPeriodEnd: false,
          currentPeriodEnd: new Date(Date.now() + 86400000),
          productKeys: [
            "platform",
            "runtime_standard",
            "runtime_standard",
            "runtime_standard",
          ],
        });
      await expect(
        runtime.create(companyId, "owner", input, now),
      ).rejects.toMatchObject({
        status: 403,
        details: { code: "RUNTIME_PLAN_LIMIT" },
      });
      await db
        .update(billingSubscriptions)
        .set({
          productKeys: [
            "platform",
            "runtime_standard",
            "runtime_standard",
            "runtime_performance",
          ],
        });
      await expect(
        runtime.create(companyId, "owner", input, now),
      ).rejects.toMatchObject({ status: 422 });
      const support = saasSupportService(db, config),
        grant = await support.approve(
          companyId,
          "owner",
          {
            companyId,
            operatorUserId: "operator",
            reason: "Create the fixture-only canary runtime",
            scopes: ["runtime:manage"],
            expiresInMinutes: 10,
          },
          now,
        );
      const created = await support.canaryRuntime(
        grant.id,
        "operator",
        input,
        now,
      );
      expect(created.operation.desiredState.canaryOperatorId).toBe("operator");
      await support.revoke(companyId, "owner", grant.id, now);
      await expect(
        support.canaryRuntime(grant.id, "operator", input, now),
      ).rejects.toMatchObject({ status: 403 });
      // Persisted rows exercise the approval predicate; these remain fixture evidence, not a live provider rehearsal.
      const restoreTime = new Date(now.getTime() + 3000000),
        approvalTime = new Date(now.getTime() + 3600001);
      const [persona] = await db
        .insert(agentIdentities)
        .values({ name: "Canary fixture", homeCompanyId: companyId })
        .returning();
      const [agent] = await db
        .insert(agents)
        .values({
          companyId,
          agentIdentityId: persona!.id,
          name: "Canary agent",
          adapterType: "openclaw_gateway",
        })
        .returning();
      const [provider] = await db
        .insert(agentProviderBindings)
        .values({
          agentIdentityId: persona!.id,
          providerType: "openclaw",
          providerAgentRef: "main",
          status: "active",
        })
        .returning();
      const [binding] = await db
        .update(agentPresenceRuntimeBindings)
        .set({
          providerBindingId: provider!.id,
          providerProfileRef: "aw:cell:" + created.cell.id + ":generation:1",
          providerSessionNamespace: "fixture-canary",
          qualifiedConfigurationHash: "fixture",
          conformanceSnapshotHash: "fixture",
        })
        .where(eq(agentPresenceRuntimeBindings.agentId, agent!.id))
        .returning();
      await db
        .update(runtimeOperations)
        .set({
          status: "SUCCEEDED",
          completedAt: new Date(now.getTime() + 1000),
        })
        .where(eq(runtimeOperations.id, created.operation.id));
      await db
        .update(runtimeCells)
        .set({
          generation: 2n,
          status: "HEALTHY",
          providerBindingId: provider!.id,
          activeImageDigest: digest,
          lastHealthyAt: approvalTime,
        })
        .where(eq(runtimeCells.id, created.cell.id));
      const backupValues = {
        companyId,
        runtimeCellId: created.cell.id,
        generation: 1n,
        imageDigest: digest,
        stateFormat: "fixture",
        status: "VERIFIED",
        encryptionKeyRef: "fixture-only",
        ciphertextSha256: "a".repeat(64),
        byteSize: 64n,
        verifiedAt: new Date(now.getTime() + 2000),
        retainUntil: new Date(now.getTime() + 86400000),
      };
      await db
        .insert(runtimeBackups)
        .values({ ...backupValues, objectKey: "fixture-no-restore" });
      const [backup] = await db
        .insert(runtimeBackups)
        .values({ ...backupValues, objectKey: "fixture-restored" })
        .returning();
      await db
        .insert(runtimeOperations)
        .values({
          companyId,
          runtimeCellId: created.cell.id,
          operationType: "restore",
          requestedByType: "user",
          requestedById: "owner",
          status: "SUCCEEDED",
          completedAt: restoreTime,
          deadlineAt: approvalTime,
          idempotencyKey: "fixture-restore-001",
          requestHash: "fixture",
          desiredState: { backupId: backup!.id, sourceGeneration: "1" },
        });
      const [oldRun] = await db
        .insert(heartbeatRuns)
        .values({
          companyId,
          agentId: agent!.id,
          status: "succeeded",
          startedAt: new Date(now.getTime() + 10000),
          finishedAt: new Date(now.getTime() + 20000),
        })
        .returning();
      const approve = {
        imageDigest: digest,
        expectedStatus: "canary",
        status: "approved",
        reason:
          "Fixture tests persisted restore and current generation execution",
      };
      await expect(
        catalog.transition("operator", approve, approvalTime),
      ).rejects.toMatchObject({ status: 409 });
      await db
        .update(agentPresenceRuntimeBindings)
        .set({
          providerProfileRef: "aw:cell:" + created.cell.id + ":generation:2",
        })
        .where(eq(agentPresenceRuntimeBindings.id, binding!.id));
      await expect(
        catalog.transition("operator", approve, approvalTime),
      ).rejects.toMatchObject({ status: 409 });
      await db
        .update(heartbeatRuns)
        .set({
          startedAt: new Date(restoreTime.getTime() + 1000),
          finishedAt: new Date(restoreTime.getTime() + 2000),
        })
        .where(eq(heartbeatRuns.id, oldRun!.id));
      expect(
        (await catalog.transition("operator", approve, approvalTime)).status,
      ).toBe("approved");
      await catalog.transition(
        "operator",
        {
          imageDigest: digest,
          expectedStatus: "approved",
          status: "halted",
          reason: "Fixture rollout is not a qualified live image",
        },
        new Date(now.getTime() + 40 * 86400000),
      );
      expect(hostVersionMeetsMinimum("6.0.0", "6.0.0")).toBe(true);
      expect(hostVersionMeetsMinimum("6.1.0", "6.0.99")).toBe(true);
      expect(hostVersionMeetsMinimum("6.0.1", "6.1.0")).toBe(false);
      expect(hostVersionMeetsMinimum(null, "6.0.0")).toBe(false);
    });

    it("pauses expired commercial execution, retries remote cancellation and preserves budget stops after payment recovery", async () => {
      const [identity] = await db
        .insert(agentIdentities)
        .values({ name: "Expiry fixture", homeCompanyId: companyId })
        .returning();
      const [active] = await db
        .insert(agents)
        .values({
          companyId,
          agentIdentityId: identity!.id,
          name: "Working agent",
          status: "running",
          adapterType: "http",
        })
        .returning();
      const [budgetIdentity] = await db
        .insert(agentIdentities)
        .values({ name: "Budget expiry fixture", homeCompanyId: companyId })
        .returning();
      const [budget] = await db
        .insert(agents)
        .values({
          companyId,
          agentIdentityId: budgetIdentity!.id,
          name: "Budget agent",
          status: "paused",
          pauseReason: "budget",
          adapterType: "http",
        })
        .returning();
      await db.update(billingSubscriptions).set({ status: "canceled" });
      const cancel = vi
        .fn()
        .mockRejectedValueOnce(
          Error("Remote cancellation temporarily unavailable"),
        )
        .mockResolvedValue({});
      const commercial = runtimeCommercialService(db, undefined, cancel);
      await expect(commercial.reconcile(now)).rejects.toThrow(
        "Remote cancellation",
      );
      expect(
        (await db.select().from(agents).where(eq(agents.id, active!.id)))[0],
      ).toMatchObject({
        status: "paused",
        pauseReason: "commercial_access_expired",
      });
      expect(
        (await db.select().from(agents).where(eq(agents.id, budget!.id)))[0],
      ).toMatchObject({ status: "paused", pauseReason: "budget" });
      await commercial.reconcile(now);
      expect(cancel).toHaveBeenCalledTimes(2);
      expect(cancel.mock.calls[1]![0]).toContain(active!.id);
      await db
        .update(billingSubscriptions)
        .set({
          status: "active",
          currentPeriodEnd: new Date(now.getTime() + 86400000),
        });
      await commercial.reconcile(now);
      expect(cancel).toHaveBeenCalledTimes(2);
      expect(
        (await db.select().from(agents).where(eq(agents.id, active!.id)))[0]!
          .status,
      ).toBe("paused");
    });
  },
);
