import { eq } from "drizzle-orm";
import { saasCostSnapshotSchema } from "@paperclipai/shared";
import type { AuthorizationActor } from "../services/authorization.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  authUsers,
  authAccounts,
  authSessions,
  agents,
  billingAccountCompanies,
  billingSubscriptions,
  costEvents,
  createDb,
  runtimeCapacityProfiles,
  runtimeCells,
  runtimeHosts,
  runtimeVersionCatalog,
  platformAdminAudit,
  usageAggregates,
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
    let firstCompanyId: string, secondCompanyId: string;
    let operatorActor: AuthorizationActor;
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
      await db.insert(authUsers).values({ id: "operator", name: "Operator", email: "operator@example.test",
        emailVerified: true, createdAt: now, updatedAt: now });
      // Structural native proof for cost-domain tests, not a WebAuthn ceremony.
      operatorActor = { type: "board", source: "session", userId: "operator",
        sessionId: await seedNativePasskeySession(db, "operator") };
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
      firstCompanyId = first.companyId;
      secondCompanyId = second.companyId;
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
        service.record({ type: "board", source: "session", userId: "ordinary" }, report(), now),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.record(operatorActor, { ...report(), hosts: [] }, now),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.record(operatorActor, { ...report(), accountRevenue: [] }, now),
      ).rejects.toMatchObject({ status: 409 });
      const [agent] = await db.insert(agents).values({ companyId: firstCompanyId, name: "Cost fixture" }).returning();
      await db.insert(costEvents).values([
        { companyId: firstCompanyId, agentId: agent!.id, provider: "fixture", biller: "fixture", billingType: "metered_api", costStatus: "reported", model: "fixture/model", costCents: 125, occurredAt: now },
        { companyId: firstCompanyId, agentId: agent!.id, provider: "fixture", biller: "fixture", billingType: "metered_api", costStatus: "unpriced", model: "fixture/model", costCents: 0, occurredAt: now },
      ]);
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const dayEnd = new Date(monthStart.getTime() + 86400000);
      await db.insert(usageAggregates).values([
        { companyId: firstCompanyId, billingAccountId: accountId, meterKey: "runtime.shared_millisecond", bucketStart: monthStart, bucketEnd: dayEnd, quantity: "60000", unit: "millisecond", sourceWatermark: now },
        { companyId: firstCompanyId, billingAccountId: accountId, meterKey: "storage.byte_millisecond", bucketStart: monthStart, bucketEnd: dayEnd, quantity: "4096000", unit: "byte_millisecond", sourceWatermark: now },
        { companyId: firstCompanyId, billingAccountId: accountId, meterKey: "backup.byte_millisecond", bucketStart: monthStart, bucketEnd: dayEnd, quantity: "2048000", unit: "byte_millisecond", sourceWatermark: now },
      ]);
      const input = report(),
        results = await Promise.all([
          service.record(operatorActor, input, now),
          service.record(operatorActor, input, now),
        ]);
      expect(results[0]).toEqual(results[1]);
      expect(() => saasCostSnapshotSchema.parse(results[0])).not.toThrow();
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
      expect(results[0]!.unitEconomics).toMatchObject({
        coverage: "partial_sources_only",
        platformCost: { amountMinor: "5000", currency: "EUR", allocation: "environment_unallocated" },
        managedRuntimeHostCost: { amountMinor: "10000", currency: "EUR", basis: "provider_price_estimate", unallocatedMultiCompanyMinor: "0" },
        providerModelCost: { reportedCents: "125", estimatedCents: null, currency: "unspecified", reportedEventCount: 1, unpricedEventCount: 1, captureCompleteness: "not_established" },
        unavailable: { supportCost: "not_recorded", analyticsCost: "not_recorded", storageAndRuntimeRates: "not_configured", acceptedOutcomeCost: "no_canonical_cost_attribution" },
      });
      expect(results[0]!.unitEconomics!.runtimeAndStorageUsage.quantities).toEqual(expect.arrayContaining([
        { meterKey: "runtime.shared_millisecond", quantity: "60000", unit: "millisecond" },
        { meterKey: "storage.byte_millisecond", quantity: "4096000", unit: "byte_millisecond" },
        { meterKey: "backup.byte_millisecond", quantity: "2048000", unit: "byte_millisecond" },
      ]));
      expect(results[0]!.unitEconomics!.tenants).toContainEqual(expect.objectContaining({
        companyId: firstCompanyId, billingAccountId: accountId, providerReportedCents: "125", providerEstimatedCents: null, providerUnpricedEventCount: 1,
        estimatedHostRuntimeMinor: "2500", estimatedHostRuntimeCurrency: "EUR", hostAllocation: "single_active_company", totalCost: "unavailable_incomplete_components",
      }));
      const current = await service.latest();
      expect(current).toMatchObject({ unitEconomics: { coverage: "partial_sources_only" } });
      expect(current!.unitEconomics!.providerModelCost.currency).toBe("unspecified");
      expect(current!.unitEconomics!.tenants.find((tenant) => tenant.companyId === firstCompanyId)?.usage)
        .toEqual(expect.arrayContaining([{ meterKey: "runtime.shared_millisecond", quantity: "60000", unit: "millisecond" }]));
      await db.insert(costEvents).values({ companyId: firstCompanyId, agentId: agent!.id, provider: "fixture", biller: "fixture",
        billingType: "metered_api", costStatus: "reported", model: "fixture/model", costCents: 50, occurredAt: now });
      expect(await service.record(operatorActor, input, now)).toEqual(results[0]);
      const refreshed = await service.latest();
      expect(refreshed!.unitEconomics!.providerModelCost).toMatchObject({ reportedCents: "175", reportedEventCount: 2 });
      expect(refreshed!.unitEconomics!.providerModelCost).not.toEqual(results[0]!.unitEconomics!.providerModelCost);
      await expect(
        service.record(
          operatorActor,
          { ...input, platformMonthlyMinor: "6000" },
          now,
        ),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("refuses cost publication without current recent passkey proof, including a password session", async () => {
      const service = saasCostService(db, config), input = report();
      const before = await db.select().from(platformAdminAudit);
      await expect(service.record({ ...operatorActor, sessionId: undefined }, input, now)).rejects.toMatchObject({ status: 403 });
      await db.update(authSessions).set({ authenticatedAt: new Date(Date.now() - 301000) })
        .where(eq(authSessions.id, operatorActor.sessionId!));
      await expect(service.record(operatorActor, input, now)).rejects.toMatchObject({ status: 403 });
      const createdAt = new Date();
      await db.insert(authAccounts).values({ id: randomUUID(), userId: "operator", issuer: "local:credential",
        accountId: "operator", providerId: "credential", password: "structural-fixture-not-a-password-hash",
        createdAt, updatedAt: createdAt });
      const [user] = await db.select({ version: authUsers.authenticatorVersion }).from(authUsers).where(eq(authUsers.id, "operator"));
      const sessionId = randomUUID();
      await db.insert(authSessions).values({ id: sessionId, userId: "operator", token: randomUUID(), createdAt,
        updatedAt: createdAt, expiresAt: new Date(createdAt.getTime() + 3600000), authenticationMethod: "password",
        authenticatedAt: createdAt, authenticatorVersion: user!.version });
      await expect(service.record({ ...operatorActor, sessionId }, input, now)).rejects.toMatchObject({ status: 403 });
      expect(await db.select().from(platformAdminAudit)).toEqual(before);
    });
    it("keeps shared billing account host estimates unallocated instead of splitting them across companies", async () => {
      await db.update(authSessions).set({ authenticatedAt: new Date(), updatedAt: new Date() })
        .where(eq(authSessions.id, operatorActor.sessionId!));
      await db.update(billingAccountCompanies).set({ status: "inactive", updatedAt: now })
        .where(eq(billingAccountCompanies.companyId, secondCompanyId));
      await db.insert(billingAccountCompanies).values({ companyId: secondCompanyId, billingAccountId: accountId, status: "active" });
      await db.update(runtimeCells).set({ billingAccountId: accountId }).where(eq(runtimeCells.companyId, secondCompanyId));
      const snapshot = await saasCostService(db, config).record(operatorActor, report(), now);
      expect(snapshot.unitEconomics!.managedRuntimeHostCost).toMatchObject({ amountMinor: "10000", unallocatedMultiCompanyMinor: "5000" });
      const sharedTenants = snapshot.unitEconomics!.tenants.filter((tenant) => tenant.billingAccountId === accountId);
      expect(sharedTenants).toHaveLength(2);
      expect(sharedTenants.every((tenant) => tenant.hostAllocation === "shared_account_unallocated" && tenant.estimatedHostRuntimeMinor === null)).toBe(true);
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
