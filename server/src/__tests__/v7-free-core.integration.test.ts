import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createDb,
  authUsers,
  agents,
  heartbeatRuns,
  billingAccounts,
  billingSubscriptions,
  applicationStorageObjects,
  runtimeCells,
  runtimeCapacityProfiles,
  runtimeOperations,
  runtimeVersionCatalog,
  agentIdentities,
  agentProviderBindings,
  agentPresenceRuntimeBindings,
} from "@paperclipai/db";
import {
  FREE_CORE_ENTITLEMENTS,
  FREE_CORE_CATALOG_VERSION,
} from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { entitlementService } from "../services/billing/entitlements.js";
import { applicationStorageService } from "../services/billing/storage.js";
import { runtimeCommercialService } from "../services/runtime/commercial.js";
import { isCompanyCapacityWait } from "../services/billing/capacity-admission.js";
import { assertAgentRunWriteAllowed } from "../agent-run-cancellation.js";
import type { StorageProvider } from "../storage/types.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V7 permanent Free Core and canonical capacity",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      companyId: string,
      accountId: string,
      agentId: string;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v7-free-core-");
      db = createDb(database.connectionString);
      await db
        .insert(authUsers)
        .values({
          id: "free-owner",
          name: "Owner",
          email: "free@example.test",
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      await db
        .insert(runtimeVersionCatalog)
        .values({
          imageDigest: "fixture.invalid/free-core@sha256:" + "c".repeat(64),
          providerVersion: "local-commercial-protocol-fixture",
          stateFormat: "fixture",
          hostAgentMinimumVersion: "6.0.0",
          conformance: { fixtureOnly: true },
        });
      await instanceSettingsService(db).updateExperimental({
        saas_deployment_profile_v6: true,
        billing_v6: true,
        billing_entitlements_v6: true,
        billing_usage_v6: true,
        free_core_commercial_v7: true,
      });
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    beforeEach(async () => {
      const run = await saasOnboardingService(db).create("free-owner", {
        name: "Free Core fixture",
        idempotencyKey: randomUUID(),
      });
      companyId = run.companyId;
      accountId = run.billingAccountId;
      const [agent] = await db
        .insert(agents)
        .values({
          companyId,
          name: "BYO fixture",
          role: "engineer",
          adapterType: "http",
        })
        .returning();
      agentId = agent!.id;
      await entitlementService(db).resolve(companyId);
    });
    const subscription = async () =>
      (
        await db
          .insert(billingSubscriptions)
          .values({
            billingAccountId: accountId,
            providerSubscriptionId: "fixture-" + randomUUID(),
            status: "active",
            productKeys: ["platform", "runtime_standard"],
            currentPeriodEnd: new Date(Date.now() + 86400000),
            providerUpdatedAt: new Date(),
            sourceHash: "local-normalized-receipt-fixture",
          })
          .returning()
      )[0]!;
    it("activates permanent Core without a subscription, checkout or payment card", async () => {
      const state = await entitlementService(db).resolve(companyId);
      expect(state).toMatchObject({
        access: "active",
        commercialState: "FREE",
        catalogVersion: FREE_CORE_CATALOG_VERSION,
        freeCore: { active: true, paymentMethodRequired: false },
      });
      expect(state.subscriptions).toEqual([]);
      for (const key of [
        "foundation.use",
        "memory.use",
        "workflows.use",
        "governance.use",
        "audit.use",
        "privacy.manage",
        "export.use",
        "agents.create",
      ] as const)
        expect(state.entitlements[key]).toBe(true);
      expect(state.entitlements["hosted_runtime.provision"]).toBe(false);
      await expect(
        entitlementService(db).require(companyId, "hosted_runtime.provision"),
      ).rejects.toMatchObject({ status: 403 });
      const account = (
        await db
          .select()
          .from(billingAccounts)
          .where(eq(billingAccounts.id, accountId))
      )[0]!;
      expect(account.providerCustomerId).toBeNull();
      const service = saasOnboardingService(db),
        start = await service.get(companyId);
      const plan = await service.update(companyId, "free-owner", {
        expectedVersion: start.version,
        stage: "plan",
        answers: {
          mission: "Build meaningful company knowledge and reviewed work",
        },
      });
      expect(
        (
          await service.update(companyId, "free-owner", {
            expectedVersion: plan.version,
            stage: "runtime",
            answers: {},
          })
        ).currentStage,
      ).toBe("runtime");
    });
    it("serializes simultaneous run admissions and releases capacity only through canonical status", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 3 }, () =>
          db
            .insert(heartbeatRuns)
            .values({
              companyId,
              agentId,
              invocationSource: "on_demand",
              status: "running",
            })
            .returning(),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(2);
      const rejected = results.find((result) => result.status === "rejected");
      expect(
        rejected?.status === "rejected" &&
          isCompanyCapacityWait(rejected.reason),
      ).toBe(true);
      const [queued] = await db
        .insert(heartbeatRuns)
        .values({
          companyId,
          agentId,
          invocationSource: "on_demand",
          status: "queued",
        })
        .returning();
      await expect(
        db
          .update(heartbeatRuns)
          .set({ status: "running" })
          .where(eq(heartbeatRuns.id, queued!.id)),
      ).rejects.toThrow();
      const [active] = await db
        .select()
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            eq(heartbeatRuns.status, "running"),
          ),
        );
      // Local lifecycle fixture: no provider execution or physical Stop is claimed.
      await db
        .update(heartbeatRuns)
        .set({ status: "succeeded", finishedAt: new Date() })
        .where(eq(heartbeatRuns.id, active!.id));
      await db
        .update(heartbeatRuns)
        .set({ status: "running" })
        .where(eq(heartbeatRuns.id, queued!.id));
      expect(
        await db
          .select()
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, companyId),
              eq(heartbeatRuns.status, "running"),
            ),
          ),
      ).toHaveLength(2);
    });
    it("composes paid capacity over Free and returns to usable Free on cancellation without deleting state", async () => {
      const paid = await subscription(),
        state = await entitlementService(db).resolve(companyId);
      expect(state.commercialState).toBe("ACTIVE");
      expect(state.entitlements["hosted_runtime.provision"]).toBe(true);
      expect(
        BigInt(String(state.entitlements["storage.included_bytes"])),
      ).toBeGreaterThan(
        BigInt(String(FREE_CORE_ENTITLEMENTS["storage.included_bytes"])),
      );
      const profile = "free-core-" + randomUUID();
      await db
        .insert(runtimeCapacityProfiles)
        .values({
          key: profile,
          cpuMillis: 1000,
          memoryBytes: 1073741824n,
          diskBytes: 10737418240n,
          pidsLimit: 128,
        });
      const [cell] = await db
        .insert(runtimeCells)
        .values({
          companyId,
          billingAccountId: accountId,
          capacityProfile: profile,
          isolationMode: "company_cell",
          status: "STOPPED",
          desiredImageDigest:
            "fixture.invalid/free-core@sha256:" + "c".repeat(64),
        })
        .returning();
      await db
        .update(billingSubscriptions)
        .set({ status: "canceled", version: 2 })
        .where(eq(billingSubscriptions.id, paid.id));
      const free = await entitlementService(db).resolve(companyId);
      expect(free).toMatchObject({ access: "active", commercialState: "FREE" });
      expect(free.entitlements["hosted_runtime.provision"]).toBe(false);
      await runtimeCommercialService(db).reconcile();
      expect(
        (
          await db
            .select()
            .from(runtimeCells)
            .where(eq(runtimeCells.id, cell!.id))
        )[0],
      ).toMatchObject({
        deletedAt: null,
        suspendedReason: "commercial_runtime_limit",
      });
      expect(
        await db
          .select()
          .from(runtimeOperations)
          .where(eq(runtimeOperations.runtimeCellId, cell!.id)),
      ).toHaveLength(0);
      expect(
        (await db.select().from(agents).where(eq(agents.id, agentId)))[0]!
          .status,
      ).not.toBe("paused");
    });
    it("prevents storage expansion above the new allowance while preserving existing customer objects", async () => {
      const paid = await subscription();
      const provider: StorageProvider = {
        id: "s3",
        putObject: async () => undefined,
        getObject: async () => ({ stream: Readable.from("fixture") }),
        headObject: async () => ({ exists: false }),
        deleteObject: async () => undefined,
      };
      const storage = applicationStorageService(db, provider),
        key = companyId + "/existing-reservation";
      await storage.accounting.reserve(companyId, key, 1500000000);
      await db
        .update(billingSubscriptions)
        .set({ status: "canceled", version: 2 })
        .where(eq(billingSubscriptions.id, paid.id));
      await expect(
        storage.accounting.reserve(companyId, companyId + "/expansion", 1),
      ).rejects.toMatchObject({
        status: 403,
        details: { code: "STORAGE_PLAN_LIMIT" },
      });
      expect(
        (
          await db
            .select()
            .from(applicationStorageObjects)
            .where(eq(applicationStorageObjects.objectKey, key))
        )[0],
      ).toMatchObject({ status: "reserved", byteSize: 1500000000n });
      expect(
        (await entitlementService(db).resolve(companyId)).entitlements[
          "export.use"
        ],
      ).toBe(true);
      await storage.accounting.deleting(companyId, key);
      await storage.accounting.deleted(companyId, key);
    });
    it("fences only the actual managed presence before remote cancellation and retries a lost acknowledgement", async () => {
      const paid = await subscription();
      await entitlementService(db).resolve(companyId);
      const [identity] = await db
        .insert(agentIdentities)
        .values({
          name: "Managed commercial fixture",
          homeCompanyId: companyId,
        })
        .returning();
      const [managed] = await db
        .insert(agents)
        .values({
          companyId,
          agentIdentityId: identity!.id,
          name: "Managed fixture",
          role: "engineer",
          adapterType: "openclaw_gateway",
          status: "running",
        })
        .returning();
      const [provider] = await db
        .insert(agentProviderBindings)
        .values({
          agentIdentityId: identity!.id,
          providerType: "openclaw",
          providerAgentRef: managed!.id,
        })
        .returning();
      const profile = "managed-free-core-" + randomUUID();
      await db
        .insert(runtimeCapacityProfiles)
        .values({
          key: profile,
          cpuMillis: 1000,
          memoryBytes: 1073741824n,
          diskBytes: 10737418240n,
          pidsLimit: 128,
        });
      const [cell] = await db
        .insert(runtimeCells)
        .values({
          companyId,
          billingAccountId: accountId,
          providerBindingId: provider!.id,
          capacityProfile: profile,
          isolationMode: "company_cell",
          status: "HEALTHY",
          desiredImageDigest:
            "fixture.invalid/free-core@sha256:" + "c".repeat(64),
        })
        .returning();
      await db
        .insert(agentPresenceRuntimeBindings)
        .values({
          companyId,
          agentId: managed!.id,
          agentIdentityId: identity!.id,
          providerBindingId: provider!.id,
          providerProfileRef: `aw:cell:${cell!.id}:generation:${cell!.generation}`,
          providerSessionNamespace: "local-managed-fixture",
          status: "active",
        })
        .onConflictDoUpdate({
          target: [
            agentPresenceRuntimeBindings.companyId,
            agentPresenceRuntimeBindings.agentId,
          ],
          set: {
            providerBindingId: provider!.id,
            providerProfileRef: `aw:cell:${cell!.id}:generation:${cell!.generation}`,
            providerSessionNamespace: "local-managed-fixture",
            status: "active",
          },
        });
      const [execution] = await db
        .insert(heartbeatRuns)
        .values({
          companyId,
          agentId: managed!.id,
          invocationSource: "on_demand",
          status: "running",
        })
        .returning();
      const [byo] = await db
        .insert(heartbeatRuns)
        .values({
          companyId,
          agentId,
          invocationSource: "on_demand",
          status: "running",
        })
        .returning();
      await db
        .update(billingSubscriptions)
        .set({ status: "canceled", version: 2 })
        .where(eq(billingSubscriptions.id, paid.id));
      // Fresh commercial authority closes immediately, before reconciliation.
      await expect(
        assertAgentRunWriteAllowed(db, companyId, {
          agentId: managed!.id,
          runId: execution!.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await assertAgentRunWriteAllowed(db, companyId, {
        agentId,
        runId: byo!.id,
      });
      const cancel = vi.fn(async () => {
        throw new Error("local-controller-ack-lost");
      });
      await expect(
        runtimeCommercialService(db, undefined, cancel).reconcile(),
      ).rejects.toThrow("ack-lost");
      expect(cancel).toHaveBeenCalledWith([managed!.id], expect.any(String));
      expect(
        (await db.select().from(agents).where(eq(agents.id, managed!.id)))[0]!
          .status,
      ).toBe("paused");
      const fenced = (
        await db
          .select()
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, execution!.id))
      )[0]!;
      expect(fenced.status).toBe("running");
      expect(fenced.resultJson?.executionCancellation).toMatchObject({
        state: "requested",
        reason: "commercial_runtime_capacity_expired",
      });
      const retry = vi.fn(async () => undefined);
      await runtimeCommercialService(db, undefined, retry).reconcile();
      expect(retry).toHaveBeenCalledWith([managed!.id], expect.any(String));
      expect(
        (await db.select().from(agents).where(eq(agents.id, agentId)))[0]!
          .status,
      ).not.toBe("paused");
    });
    it("does not grant core or paid compute to a suspended billing account", async () => {
      await db
        .update(billingAccounts)
        .set({ status: "suspended", version: 2 })
        .where(eq(billingAccounts.id, accountId));
      expect(await entitlementService(db).resolve(companyId)).toMatchObject({
        access: "read_only",
        freeCore: { active: false },
      });
      await expect(
        db
          .insert(heartbeatRuns)
          .values({
            companyId,
            agentId,
            invocationSource: "on_demand",
            status: "running",
          }),
      ).rejects.toThrow();
    });
  },
);
