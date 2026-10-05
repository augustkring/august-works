import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  runtimeCapacityProfiles,
  runtimeHostProviderOperations,
  runtimeHosts,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { runtimeFleetService } from "../services/runtime/fleet.js";
import {
  RuntimeProviderError,
  type RuntimeProvider,
  type UpCloudServer,
} from "../services/runtime/upcloud-provider.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 bounded provider ownership and fencing",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>;
    const provider: RuntimeProvider = {
      create: vi.fn(),
      get: vi.fn(),
      find: vi.fn(),
      stop: vi.fn(),
      delete: vi.fn(),
      storageAbsent: vi.fn(),
    };
    const config = {
      environment: "staging",
      objects: {
        endpoint: "https://objects.example.test",
        region: "europe-1",
        bucket: "fixture",
      },
      operatorUserIds: ["operator"],
      runtime: {
        region: "dk-cph1",
        networkId: "44444444-4444-4444-8444-444444444444",
        hostPlan: "4xCPU-8GB",
        hostAgentImage: "example.invalid/host@sha256:" + "a".repeat(64),
        maxHosts: 2,
        maxCreatesPerHour: 1,
        suspectSeconds: 90,
        unreachableSeconds: 180,
      },
    } as SaasPlatformConfig;
    const resourceId = "22222222-2222-4222-8222-222222222222";
    const owned = (hostId: string, state = "started"): UpCloudServer => ({
      uuid: resourceId,
      state,
      zone: "dk-cph1",
      labels: {
        label: [
          { key: "aw-host-id", value: hostId },
          { key: "environment", value: "staging" },
          { key: "managed-by", value: "august-works-v6" },
        ],
      },
      networking: {
        interfaces: {
          interface: [{ type: "private", network: config.runtime.networkId }],
        },
      },
    });
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v6-fleet-");
      db = createDb(database.connectionString);
      await db.insert(runtimeCapacityProfiles).values({
        key: "fixture-standard",
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
          reportUri: "https://evidence.example.test/fixture-only",
          qualifiedAt: new Date().toISOString(),
        },
      });
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    let hostId: string;
    it("serializes the hourly create ceiling and never repeats an ambiguous provider create", async () => {
      const fleet = runtimeFleetService(
        db,
        config,
        "https://app.example.test",
        provider,
      );
      const outcomes = await Promise.allSettled([
        fleet.requestHost("fixture-standard", "operator"),
        fleet.requestHost("fixture-standard", "operator"),
      ]);
      const successes = outcomes.filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof fleet.requestHost>>
        > => result.status === "fulfilled",
      );
      expect(successes).toHaveLength(1);
      hostId = successes[0]!.value.id;
      vi.mocked(provider.create).mockRejectedValue(
        new RuntimeProviderError("upcloud_request_unknown", true),
      );
      expect(await fleet.processCreate()).toBe(true);
      expect(await fleet.processCreate()).toBe(false);
      expect(provider.create).toHaveBeenCalledTimes(1);
      const [op] = await db.select().from(runtimeHostProviderOperations);
      expect(op!.status).toBe("NEEDS_RECONCILIATION");
      vi.mocked(provider.find).mockResolvedValue([owned(hostId)]);
      await fleet.reconcileCreates(new Date(Date.now() + 61000));
      const [host] = await db
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, hostId));
      expect(host!.providerResourceId).toBe(resourceId);
      expect(host!.status).toBe("BOOTSTRAPPING");
      expect(provider.create).toHaveBeenCalledTimes(1);
    });
    it("revokes host authority immediately but records fencing only after scoped provider stopped evidence", async () => {
      const fleet = runtimeFleetService(
        db,
        config,
        "https://app.example.test",
        provider,
      );
      await fleet.requestFence(hostId, "operator");
      let [host] = await db
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, hostId));
      expect(host!.credentialRevokedAt).toBeTruthy();
      expect(host!.fencedAt).toBeNull();
      vi.mocked(provider.get).mockResolvedValue({
        ...owned(hostId),
        labels: { label: [{ key: "aw-host-id", value: "another-host" }] },
      });
      await expect(
        fleet.processFence(new Date(Date.now() + 1000)),
      ).rejects.toMatchObject({ code: "upcloud_ownership_mismatch" });
      expect(provider.stop).not.toHaveBeenCalled();
      vi.mocked(provider.get).mockResolvedValue(owned(hostId));
      await fleet.processFence(new Date(Date.now() + 1000));
      expect(provider.stop).toHaveBeenCalledTimes(1);
      [host] = await db
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, hostId));
      expect(host!.fencedAt).toBeNull();
      vi.mocked(provider.get).mockResolvedValue(owned(hostId, "stopped"));
      await fleet.processFence(new Date(Date.now() + 62000));
      [host] = await db
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, hostId));
      expect(host!.fencedAt).toBeTruthy();
    });
    it("retires only owned stopped hosts and waits for both VM and exact disk absence after an unknown deletion acknowledgement", async () => {
      const fleet = runtimeFleetService(
          db,
          config,
          "https://app.example.test",
          provider,
        ),
        now = new Date(Date.now() + 120000);
      await fleet.requestRetire(hostId, "operator", now);
      const disks = [
        "66666666-6666-4666-8666-666666666666",
        "77777777-7777-4777-8777-777777777777",
      ];
      vi.mocked(provider.get).mockResolvedValue({
        ...owned(hostId, "stopped"),
        storage_devices: {
          storage_device: [
            { storage: disks[0]!, storage_title: "aw-os-" + hostId },
            { storage: disks[1]!, storage_title: "aw-state-" + hostId },
          ],
        },
      });
      vi.mocked(provider.delete).mockRejectedValue(
        new RuntimeProviderError("upcloud_request_unknown", true),
      );
      await fleet.processRetire(new Date(now.getTime() + 1000));
      expect(provider.delete).toHaveBeenCalledTimes(1);
      vi.mocked(provider.get).mockRejectedValue(
        new RuntimeProviderError("upcloud_http_404"),
      );
      vi.mocked(provider.storageAbsent!).mockResolvedValue(false);
      await fleet.processRetire(new Date(now.getTime() + 62000));
      expect(
        (
          await db
            .select()
            .from(runtimeHosts)
            .where(eq(runtimeHosts.id, hostId))
        )[0]!.retiredAt,
      ).toBeNull();
      vi.mocked(provider.storageAbsent!).mockResolvedValue(true);
      await fleet.processRetire(new Date(now.getTime() + 123000));
      expect(
        (
          await db
            .select()
            .from(runtimeHosts)
            .where(eq(runtimeHosts.id, hostId))
        )[0]!.status,
      ).toBe("RETIRED");
      expect(provider.delete).toHaveBeenCalledTimes(1);
    });
    it("reports untracked resources while preserving foreign resources and unknown creation outcomes", async () => {
      const pendingId = "88888888-8888-4888-8888-888888888888";
      await db
        .insert(runtimeHosts)
        .values({
          id: pendingId,
          environment: "staging",
          region: "dk-cph1",
          capacityClass: "fixture-standard",
          status: "PROVISIONING",
          cpuTotalMillis: 4000,
          memoryTotalBytes: 8000000000n,
          diskTotalBytes: 100000000000n,
        });
      await db
        .insert(runtimeHostProviderOperations)
        .values({
          runtimeHostId: pendingId,
          operationType: "create",
          requestHash: "pending-create",
          createdByUserId: "operator",
          status: "NEEDS_RECONCILIATION",
        });
      const inventory = vi.fn().mockResolvedValue([
        owned(hostId), // Previously retired: requires review, even with valid labels.
        { ...owned(pendingId), uuid: "99999999-9999-4999-8999-999999999999" }, // Lost create acknowledgement, not an orphan.
        {
          ...owned(pendingId),
          uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          labels: { label: [{ key: "managed-by", value: "other-controller" }] },
        },
      ]);
      const deletes = vi.mocked(provider.delete).mock.calls.length;
      const fleet = runtimeFleetService(
        db,
        config,
        "https://app.example.test",
        { ...provider, inventory },
      );
      const report = await fleet.observeProviderInventory();
      expect(report.untracked).toEqual([resourceId]);
      expect(report.mismatched).toEqual([]);
      expect(provider.delete).toHaveBeenCalledTimes(deletes);
      expect(
        (
          await db
            .select()
            .from(runtimeHosts)
            .where(eq(runtimeHosts.id, pendingId))
        )[0]!.providerResourceId,
      ).toBeNull();
    });
  },
);
