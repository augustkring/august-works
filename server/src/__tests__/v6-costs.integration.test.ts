import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  authUsers,
  billingSubscriptions,
  createDb,
  runtimeCapacityProfiles,
  runtimeCells,
  runtimeHosts,
  runtimeVersionCatalog,
  platformAdminAudit,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  allocateHostCost,
  saasCostService,
} from "../services/billing/costs.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { runtimeFleetService } from "../services/runtime/fleet.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
import type { RuntimeProvider } from "../services/runtime/upcloud-provider.js";
it("cost allocation keeps integer precision, unallocated capacity and rounding without exceeding a host envelope", () => {
  const total = 9999999999999999999999999999999999999999n;
  const value = allocateHostCost(total, 3, [
    { accountId: "one", cpuMillis: 1 },
    { accountId: "two", cpuMillis: 1 },
  ]);
  expect(value.allocated + value.unallocated).toBe(total);
  expect(value.accounts.get("one")).toBe(total / 3n);
  expect(() =>
    allocateHostCost(100n, 1, [{ accountId: "one", cpuMillis: 2 }]),
  ).toThrow("reservations exceed");
});
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 operator cost evidence and automatic spend admission",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      hostId: string,
      accountId: string;
    const now = new Date(),
      config = {
        environment: "staging",
        objects: { endpoint: "https://objects.example.test" },
        operatorUserIds: ["operator"],
        runtime: {
          hostPlan: "4xCPU-8GB",
          maxHosts: 4,
          maxCreatesPerHour: 4,
          maxEstimatedMonthlyMinor: "25000",
          region: "dk-cph1",
        },
      } as SaasPlatformConfig;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v6-costs-");
      db = createDb(database.connectionString);
      await db.insert(authUsers).values({
        id: "cost-owner",
        name: "Owner",
        email: "cost@example.test",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      const onboarding = saasOnboardingService(db),
        first = await onboarding.create("cost-owner", {
          name: "Cost A",
          idempotencyKey: "cost-company-a-001",
        }),
        second = await onboarding.create("cost-owner", {
          name: "Cost B",
          idempotencyKey: "cost-company-b-001",
        });
      accountId = first.billingAccountId;
      await db.insert(billingSubscriptions).values({
        billingAccountId: accountId,
        providerSubscriptionId: "sub_cost",
        status: "active",
        productKeys: ["platform"],
        currentPeriodEnd: new Date(now.getTime() + 86400000),
        providerUpdatedAt: now,
        sourceHash: "fixture",
      });
      await db.insert(runtimeCapacityProfiles).values({
        key: "cost-standard",
        cpuMillis: 1000,
        memoryBytes: 1000000000n,
        diskBytes: 10000000000n,
        pidsLimit: 128,
        qualified: true,
        benchmarkEvidence: {
          hostPlan: config.runtime.hostPlan,
          hostCpuMillis: 4000,
          hostMemoryBytes: "8000000000",
          hostDiskBytes: "100000000000",
          reportUri: "https://objects.example.test/qualification/fixture",
          qualifiedAt: now.toISOString(),
        },
      });
      const image = "fixture.invalid/openclaw@sha256:" + "c".repeat(64);
      await db.insert(runtimeVersionCatalog).values({
        imageDigest: image,
        providerVersion: "fixture",
        stateFormat: "fixture",
        hostAgentMinimumVersion: "6.0.0",
        conformance: { fixtureOnly: true },
      });
      const [host] = await db
        .insert(runtimeHosts)
        .values({
          environment: "staging",
          region: "dk-cph1",
          capacityClass: "cost-standard",
          status: "READY",
          providerResourceId: randomUUID(),
          cpuTotalMillis: 4000,
          cpuReservedMillis: 2000,
          memoryTotalBytes: 8000000000n,
          diskTotalBytes: 100000000000n,
        })
        .returning();
      hostId = host!.id;
      await db.insert(runtimeCells).values(
        [first, second].map((company) => ({
          companyId: company.companyId,
          billingAccountId: company.billingAccountId,
          runtimeHostId: hostId,
          capacityProfile: "cost-standard",
          isolationMode: "company_cell",
          desiredImageDigest: image,
          status: "STOPPED",
        })),
      );
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    const report = () => ({
      idempotencyKey: randomUUID(),
      month: now.toISOString().slice(0, 7),
      currency: "EUR",
      reportUri: "https://objects.example.test/cost-reports/fixture.json",
      reportSha256: "a".repeat(64),
      basis: "provider_price_estimate",
      platformMonthlyMinor: "5000",
      newHostMonthlyMinor: "10000",
      hostPlan: config.runtime.hostPlan,
      hosts: [{ hostId, monthlyMinor: "10000" }],
      accountRevenue: [{ accountId, monthlyMinor: "25000" }],
    });
    it("keeps missing costs unknown, requires owned current coverage and records exact scoped estimates once", async () => {
      const service = saasCostService(db, config);
      expect(await service.latest()).toBeNull();
      await expect(
        service.record("ordinary", report(), now),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.record("operator", { ...report(), hosts: [] }, now),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.record("operator", { ...report(), accountRevenue: [] }, now),
      ).rejects.toMatchObject({ status: 409 });
      const input = report(),
        results = await Promise.all([
          service.record("operator", input, now),
          service.record("operator", input, now),
        ]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toMatchObject({
        estimatedMonthlyCogsMinor: "15000",
        reportedMrrMinor: "25000",
        reportedArrMinor: "300000",
        estimatedGrossMarginMinor: "10000",
        unallocatedHostCostMinor: "5000",
      });
      expect(
        results[0]!.accounts.map(
          (account) => account.estimatedRuntimeMonthlyMinor,
        ),
      ).toEqual(["2500", "2500"]);
      await expect(
        service.record(
          "operator",
          { ...input, platformMonthlyMinor: "6000" },
          now,
        ),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("serializes automatic creation against a fresh cost envelope and closes admission without an explicit EUR ceiling", async () => {
      const provider = {
        create: vi.fn(),
        get: vi.fn(),
        find: vi.fn(),
        stop: vi.fn(),
        delete: vi.fn(),
      } as RuntimeProvider;
      await expect(
        runtimeFleetService(
          db,
          {
            ...config,
            runtime: { ...config.runtime, maxEstimatedMonthlyMinor: "0" },
          },
          "https://app.example.test",
          provider,
        ).requestHost("cost-standard", "runtime-scheduler", undefined, now),
      ).rejects.toMatchObject({ status: 409 });
      const fleet = runtimeFleetService(
        db,
        config,
        "https://app.example.test",
        provider,
      );
      await expect(
        fleet.requestHost("cost-standard", "runtime-scheduler", undefined, now),
      ).rejects.toThrow("provider inventory");
      await db.insert(platformAdminAudit).values({
        operatorUserId: "runtime-scheduler",
        action: "runtime.provider_inventory_observed",
        resourceId: "staging",
        safeDetails: {
          observedAt: now.toISOString(),
          untrackedCount: 0,
          mismatchCount: 0,
        },
      });
      const results = await Promise.allSettled([
        fleet.requestHost("cost-standard", "runtime-scheduler", undefined, now),
        fleet.requestHost("cost-standard", "runtime-scheduler", undefined, now),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      expect(provider.create).not.toHaveBeenCalled();
    });
  },
);
