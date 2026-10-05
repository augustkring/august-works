import { and, eq, gt, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import {
  platformAdminAudit,
  runtimeCapacityProfiles,
  runtimeCells,
  companyDeletionOperations,
  runtimeOperations,
  runtimeHostCommands,
  activityLog,
  runtimeHostEnrollments,
  runtimeHostProviderOperations,
  runtimeHosts,
  type Db,
} from "@paperclipai/db";
import { z } from "zod";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { conflict, forbidden } from "../../errors.js";
import { runtimeHostAuth } from "./host-auth.js";
import { runtimeHostCloudInit } from "./host-bootstrap.js";
import {
  RuntimeProviderError,
  type RuntimeProvider,
  type UpCloudServer,
} from "./upcloud-provider.js";
import { sha256 } from "../saas/crypto.js";
import type { SaasCostSnapshot } from "@paperclipai/shared";
const hostBenchmarkSchema = z.object({
  hostPlan: z.string(),
  hostCpuMillis: z.number().int().positive(),
  hostMemoryBytes: z.string().regex(/^\d{1,16}$/),
  hostDiskBytes: z.string().regex(/^\d{1,16}$/),
  reportUri: z.string().url(),
  qualifiedAt: z.iso.datetime(),
});

export function runtimeFleetService(
  db: Db,
  config: SaasPlatformConfig,
  origin: string,
  provider?: RuntimeProvider,
) {
  const auth = runtimeHostAuth(db);
  function available() {
    if (!provider)
      throw new RuntimeProviderError("upcloud_credentials_missing");
    return provider;
  }
  function assertOwned(
    server: UpCloudServer,
    host: typeof runtimeHosts.$inferSelect,
  ) {
    const labels = new Map(server.labels?.label.map((v) => [v.key, v.value]));
    if (
      server.uuid !== host.providerResourceId ||
      server.zone !== host.region ||
      labels.get("aw-host-id") !== host.id ||
      labels.get("environment") !== host.environment ||
      labels.get("managed-by") !== "august-works-v6"
    )
      throw new RuntimeProviderError("upcloud_ownership_mismatch");
  }
  async function requestHost(
    profileKey: string,
    operatorId: string,
    dedicatedCompanyId?: string,
    now = new Date(),
  ) {
    available();
    if (
      !config.operatorUserIds.includes(operatorId) &&
      operatorId !== "runtime-scheduler"
    )
      throw forbidden();
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"aw-fleet:" + config.environment},0))`,
      );
      const hosts = await tx
        .select({ id: runtimeHosts.id })
        .from(runtimeHosts)
        .where(
          and(
            eq(runtimeHosts.environment, config.environment),
            isNull(runtimeHosts.retiredAt),
          ),
        );
      const recent = await tx
        .select({ id: runtimeHostProviderOperations.id })
        .from(runtimeHostProviderOperations)
        .innerJoin(
          runtimeHosts,
          eq(runtimeHosts.id, runtimeHostProviderOperations.runtimeHostId),
        )
        .where(
          and(
            eq(runtimeHosts.environment, config.environment),
            eq(runtimeHostProviderOperations.operationType, "create"),
            gt(
              runtimeHostProviderOperations.createdAt,
              new Date(now.getTime() - 3600000),
            ),
          ),
        );
      if (
        hosts.length >= config.runtime.maxHosts ||
        recent.length >= config.runtime.maxCreatesPerHour
      )
        throw conflict("Fleet cost ceiling reached");
      if (operatorId === "runtime-scheduler") {
        const [record] = await tx
          .select({ data: platformAdminAudit.safeDetails })
          .from(platformAdminAudit)
          .where(
            and(
              eq(platformAdminAudit.action, "billing.cost_snapshot_recorded"),
              eq(platformAdminAudit.resourceId, config.environment),
            ),
          )
          .orderBy(sql`${platformAdminAudit.createdAt} desc`)
          .limit(1);
        const snapshot = record?.data?.snapshot as unknown as
          | SaasCostSnapshot
          | undefined;
        const limit = BigInt(config.runtime.maxEstimatedMonthlyMinor ?? "0");
        if (
          !snapshot ||
          limit <= 0n ||
          snapshot.month !== now.toISOString().slice(0, 7) ||
          snapshot.hostPlan !== config.runtime.hostPlan ||
          snapshot.currency !== "EUR" ||
          !Number.isFinite(Date.parse(snapshot.observedAt)) ||
          now.getTime() - Date.parse(snapshot.observedAt) > 7 * 86400000 ||
          Date.parse(snapshot.observedAt) > now.getTime() + 60000 ||
          BigInt(snapshot.platformMonthlyMinor) +
            BigInt(snapshot.newHostMonthlyMinor) * BigInt(hosts.length + 1) >
            limit
        )
          throw conflict(
            "A fresh provider cost envelope within the explicit EUR ceiling is required for automatic host creation",
          );
        const [inventory] = await tx
          .select({ data: platformAdminAudit.safeDetails })
          .from(platformAdminAudit)
          .where(
            and(
              eq(
                platformAdminAudit.action,
                "runtime.provider_inventory_observed",
              ),
              eq(platformAdminAudit.resourceId, config.environment),
            ),
          )
          .orderBy(sql`${platformAdminAudit.createdAt} desc`)
          .limit(1);
        const observedAt = Date.parse(
          String(inventory?.data?.observedAt ?? ""),
        );
        if (
          !inventory ||
          !Number.isFinite(observedAt) ||
          now.getTime() - observedAt > 3600000 ||
          observedAt > now.getTime() + 60000 ||
          inventory.data?.untrackedCount !== 0 ||
          inventory.data?.mismatchCount !== 0
        )
          throw conflict(
            "A fresh provider inventory without untracked or mismatched resources is required for automatic host creation",
          );
      }
      const [profile] = await tx
        .select()
        .from(runtimeCapacityProfiles)
        .where(
          and(
            eq(runtimeCapacityProfiles.key, profileKey),
            eq(runtimeCapacityProfiles.qualified, true),
          ),
        )
        .limit(1);
      const benchmark = hostBenchmarkSchema.safeParse(
        profile?.benchmarkEvidence,
      );
      if (
        !benchmark.success ||
        benchmark.data.hostPlan !== config.runtime.hostPlan
      )
        throw conflict("A qualified host benchmark is required");
      const evidence = benchmark.data;
      const [host] = await tx
        .insert(runtimeHosts)
        .values({
          environment: config.environment,
          region: config.runtime.region,
          capacityClass: profileKey,
          dedicatedCompanyId,
          cpuTotalMillis: evidence.hostCpuMillis,
          memoryTotalBytes: BigInt(evidence.hostMemoryBytes),
          diskTotalBytes: BigInt(evidence.hostDiskBytes),
        })
        .returning();
      await tx.insert(runtimeHostProviderOperations).values({
        runtimeHostId: host!.id,
        operationType: "create",
        requestHash: sha256(
          JSON.stringify({
            profileKey,
            hostPlan: config.runtime.hostPlan,
            dedicatedCompanyId: dedicatedCompanyId ?? null,
          }),
        ),
        createdByUserId: operatorId,
      });
      await tx.insert(platformAdminAudit).values({
        operatorUserId: operatorId,
        action: "runtime.host_create_requested",
        resourceId: host!.id,
        safeDetails: {
          profileKey,
          hostPlan: config.runtime.hostPlan,
          dedicatedCompanyId: dedicatedCompanyId ?? null,
        },
      });
      return host!;
    });
  }
  async function attach(hostId: string, server: UpCloudServer, now: Date) {
    return db.transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, hostId))
        .for("update");
      if (
        !host ||
        (host.providerResourceId && host.providerResourceId !== server.uuid)
      )
        throw conflict("Provider ownership changed");
      const expected = { ...host, providerResourceId: server.uuid };
      assertOwned(server, expected);
      const address = server.networking?.interfaces.interface
        .filter(
          (v) => v.type === "private" && v.network === config.runtime.networkId,
        )
        .flatMap((v) => v.ip_addresses?.ip_address ?? [])
        .find((v) => v.family === "IPv4")?.address;
      if (
        server.networking?.interfaces.interface.some((v) => v.type === "public")
      )
        throw conflict("Runtime host must have no public network");
      await tx
        .update(runtimeHosts)
        .set({
          providerResourceId: server.uuid,
          privateIp: address ?? null,
          status: "BOOTSTRAPPING",
          updatedAt: now,
        })
        .where(eq(runtimeHosts.id, hostId));
      await tx
        .update(runtimeHostEnrollments)
        .set({ expectedProviderResourceId: server.uuid })
        .where(
          and(
            eq(runtimeHostEnrollments.runtimeHostId, hostId),
            isNull(runtimeHostEnrollments.usedAt),
          ),
        );
      await tx
        .update(runtimeHostProviderOperations)
        .set({
          status: "SUCCEEDED",
          completedAt: now,
          leaseUntil: null,
          evidence: {
            providerResourceId: server.uuid,
            state: server.state,
            observedAt: now.toISOString(),
          },
          errorCode: null,
        })
        .where(
          and(
            eq(runtimeHostProviderOperations.runtimeHostId, hostId),
            eq(runtimeHostProviderOperations.operationType, "create"),
          ),
        );
    });
  }
  async function processCreate(now = new Date()) {
    const api = available();
    const operation = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(runtimeHostProviderOperations)
        .where(
          and(
            eq(runtimeHostProviderOperations.operationType, "create"),
            eq(runtimeHostProviderOperations.status, "REQUESTED"),
            lt(runtimeHostProviderOperations.notBefore, now),
          ),
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return null;
      await tx
        .update(runtimeHostProviderOperations)
        .set({ status: "WRITING", leaseUntil: new Date(now.getTime() + 60000) })
        .where(eq(runtimeHostProviderOperations.id, row.id));
      return row;
    });
    if (!operation) return false;
    try {
      const token = await auth.issueEnrollment(
        operation.runtimeHostId,
        operation.createdByUserId,
        now,
        true,
      );
      await attach(
        operation.runtimeHostId,
        await api.create(
          operation.runtimeHostId,
          runtimeHostCloudInit(config, origin, operation.runtimeHostId, token),
        ),
        new Date(),
      );
    } catch (error) {
      await db
        .update(runtimeHostProviderOperations)
        .set({
          status: "NEEDS_RECONCILIATION",
          leaseUntil: null,
          notBefore: new Date(now.getTime() + 60000),
          errorCode:
            error instanceof RuntimeProviderError
              ? error.code
              : "host_create_outcome_unknown",
        })
        .where(eq(runtimeHostProviderOperations.id, operation.id));
    }
    return true;
  }
  async function reconcileCreates(now = new Date()) {
    const api = available();
    await db
      .update(runtimeHostProviderOperations)
      .set({
        status: "NEEDS_RECONCILIATION",
        errorCode: "host_create_acknowledgement_lost",
      })
      .where(
        and(
          eq(runtimeHostProviderOperations.operationType, "create"),
          eq(runtimeHostProviderOperations.status, "WRITING"),
          lt(runtimeHostProviderOperations.leaseUntil, now),
        ),
      );
    const rows = await db
      .select()
      .from(runtimeHostProviderOperations)
      .where(
        and(
          eq(runtimeHostProviderOperations.operationType, "create"),
          eq(runtimeHostProviderOperations.status, "NEEDS_RECONCILIATION"),
          lt(runtimeHostProviderOperations.notBefore, now),
        ),
      )
      .limit(10);
    for (const row of rows) {
      const owned = await api.find(row.runtimeHostId);
      if (owned.length === 1) await attach(row.runtimeHostId, owned[0]!, now);
      else
        await db
          .update(runtimeHostProviderOperations)
          .set({
            notBefore: new Date(now.getTime() + 60000),
            errorCode: owned.length
              ? "host_duplicate_ownership"
              : "host_create_absence_requires_review",
            evidence: {
              matches: owned.map((v) => v.uuid),
              observedAt: now.toISOString(),
            },
          })
          .where(eq(runtimeHostProviderOperations.id, row.id));
    }
  }
  async function requestFence(
    hostId: string,
    operatorId: string,
    now = new Date(),
  ) {
    available();
    if (
      operatorId !== "runtime-scheduler" &&
      !config.operatorUserIds.includes(operatorId)
    )
      throw forbidden();
    return db.transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, hostId))
        .for("update");
      if (!host?.providerResourceId)
        throw conflict("Known provider ownership required for fencing");
      await tx
        .update(runtimeHosts)
        .set({
          credentialRevokedAt: now,
          credentialVersion: sql`${runtimeHosts.credentialVersion}+1`,
          status: "UNREACHABLE",
          updatedAt: now,
        })
        .where(
          and(
            eq(runtimeHosts.id, hostId),
            isNull(runtimeHosts.credentialRevokedAt),
          ),
        );
      const [operation] = await tx
        .insert(runtimeHostProviderOperations)
        .values({
          runtimeHostId: hostId,
          operationType: "fence",
          requestHash: sha256(host.providerResourceId),
          createdByUserId: operatorId,
        })
        .onConflictDoNothing()
        .returning();
      if (operation)
        await tx.insert(platformAdminAudit).values({
          operatorUserId: operatorId,
          action: "runtime.host_fence_requested",
          resourceId: hostId,
        });
      return operation ?? null;
    });
  }
  async function processFence(now = new Date()) {
    const api = available();
    const rows = await db
      .select()
      .from(runtimeHostProviderOperations)
      .where(
        and(
          eq(runtimeHostProviderOperations.operationType, "fence"),
          inArray(runtimeHostProviderOperations.status, [
            "REQUESTED",
            "WRITING",
            "NEEDS_RECONCILIATION",
          ]),
          lt(runtimeHostProviderOperations.notBefore, now),
        ),
      )
      .limit(5);
    for (const operation of rows) {
      const [host] = await db
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, operation.runtimeHostId))
        .limit(1);
      if (!host?.providerResourceId)
        throw conflict("Known provider resource required");
      const server = await api.get(host.providerResourceId);
      assertOwned(server, host);
      if (server.state !== "stopped") {
        const attempts = Number(operation.evidence.stopAttempts ?? 0);
        if (attempts >= 3) {
          await db
            .update(runtimeHostProviderOperations)
            .set({
              status: "NEEDS_RECONCILIATION",
              errorCode: "provider_fence_requires_review",
              notBefore: new Date(now.getTime() + 300000),
            })
            .where(eq(runtimeHostProviderOperations.id, operation.id));
          continue;
        }
        await db
          .update(runtimeHostProviderOperations)
          .set({
            status: "WRITING",
            notBefore: new Date(now.getTime() + 60000),
            evidence: { stopAttempts: attempts + 1 },
          })
          .where(eq(runtimeHostProviderOperations.id, operation.id));
        try {
          await api.stop(host.providerResourceId);
        } catch {
          /* Durable observed-state reconciliation decides fencing, never HTTP acknowledgement. */
        }
        continue;
      }
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(runtimeHosts)
          .where(eq(runtimeHosts.id, host.id))
          .for("update");
        if (current?.providerResourceId !== server.uuid)
          throw conflict("Provider ownership changed");
        await tx
          .update(runtimeHosts)
          .set({ fencedAt: now, updatedAt: now })
          .where(eq(runtimeHosts.id, host.id));
        await tx
          .update(runtimeCells)
          .set({
            status: "DEGRADED",
            lastErrorCode: "provider_host_fenced",
            updatedAt: now,
          })
          .where(
            and(
              eq(runtimeCells.runtimeHostId, host.id),
              isNull(runtimeCells.deletedAt),
            ),
          );
        await tx
          .update(runtimeHostProviderOperations)
          .set({
            status: "SUCCEEDED",
            completedAt: now,
            evidence: {
              providerResourceId: server.uuid,
              state: "stopped",
              observedAt: now.toISOString(),
            },
            errorCode: null,
          })
          .where(eq(runtimeHostProviderOperations.id, operation.id));
      });
    }
  }
  async function drain(hostId: string, operatorId: string, now = new Date()) {
    if (!config.operatorUserIds.includes(operatorId)) throw forbidden();
    return db.transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, hostId))
        .for("update");
      if (!host || host.retiredAt) throw conflict("Host unavailable");
      await tx
        .update(runtimeHosts)
        .set({ drainRequestedAt: now, status: "DRAINING", updatedAt: now })
        .where(eq(runtimeHosts.id, hostId));
      await tx.insert(platformAdminAudit).values({
        operatorUserId: operatorId,
        action: "runtime.host_drain_requested",
        resourceId: hostId,
      });
      return { id: hostId, status: "DRAINING" };
    });
  }
  async function requestRetire(
    hostId: string,
    operatorId: string,
    now = new Date(),
  ) {
    const api = available();
    if (!api.storageAbsent)
      throw conflict("Provider storage erasure verification required");
    if (
      operatorId !== "runtime-scheduler" &&
      !config.operatorUserIds.includes(operatorId)
    )
      throw forbidden();
    return db.transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, hostId))
        .for("update");
      if (!host?.providerResourceId || !host.fencedAt)
        throw conflict("Confirmed provider fencing required before retirement");
      const cells = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.runtimeHostId, hostId),
            isNull(runtimeCells.deletedAt),
          ),
        )
        .for("update");
      for (const cell of cells) {
        const [deletion] = await tx
          .select({ id: companyDeletionOperations.id })
          .from(companyDeletionOperations)
          .where(eq(companyDeletionOperations.companyId, cell.companyId))
          .limit(1);
        if (!deletion)
          throw conflict(
            "Migrate every retained runtime before retiring its host",
          );
      }
      const [operation] = await tx
        .insert(runtimeHostProviderOperations)
        .values({
          runtimeHostId: hostId,
          operationType: "delete",
          requestHash: sha256(host.providerResourceId),
          createdByUserId: operatorId,
        })
        .onConflictDoNothing()
        .returning();
      if (operation)
        await tx.insert(platformAdminAudit).values({
          operatorUserId: operatorId,
          action: "runtime.host_retire_requested",
          resourceId: hostId,
        });
      return operation ?? null;
    });
  }
  async function processRetire(now = new Date()) {
    const api = available();
    if (!api.storageAbsent)
      throw conflict("Provider storage verification unavailable");
    const [operation] = await db
      .select()
      .from(runtimeHostProviderOperations)
      .where(
        and(
          eq(runtimeHostProviderOperations.operationType, "delete"),
          inArray(runtimeHostProviderOperations.status, [
            "REQUESTED",
            "WRITING",
            "NEEDS_RECONCILIATION",
          ]),
          lte(runtimeHostProviderOperations.notBefore, now),
        ),
      )
      .orderBy(runtimeHostProviderOperations.createdAt)
      .limit(1);
    if (!operation) return false;
    const [host] = await db
      .select()
      .from(runtimeHosts)
      .where(eq(runtimeHosts.id, operation.runtimeHostId))
      .limit(1);
    if (!host?.providerResourceId || !host.fencedAt)
      throw conflict("Retirement fencing evidence unavailable");
    let server: UpCloudServer | undefined;
    try {
      server = await api.get(host.providerResourceId);
    } catch (error) {
      if (
        !(
          error instanceof RuntimeProviderError &&
          error.code === "upcloud_http_404"
        )
      )
        throw error;
    }
    let storageIds = operation.evidence.storageIds as string[] | undefined;
    if (server) {
      assertOwned(server, host);
      if (server.state !== "stopped")
        throw conflict("Retirement requires observed stopped state");
      const devices = server.storage_devices?.storage_device;
      if (
        !devices ||
        devices.length !== 2 ||
        new Set(devices.map((v) => v.storage)).size !== 2 ||
        devices.some(
          (v) =>
            !["aw-os-" + host.id, "aw-state-" + host.id].includes(
              v.storage_title,
            ),
        )
      )
        throw conflict("Exact owned host storage evidence required");
      const currentIds = devices.map((v) => v.storage).sort();
      if (
        storageIds &&
        JSON.stringify([...storageIds].sort()) !== JSON.stringify(currentIds)
      )
        throw conflict("Retirement storage ownership changed");
      storageIds = currentIds;
      const attempts = Number(operation.evidence.deleteAttempts ?? 0);
      if (attempts >= 3) {
        await db
          .update(runtimeHostProviderOperations)
          .set({
            status: "NEEDS_RECONCILIATION",
            errorCode: "retirement_requires_review",
            notBefore: new Date(now.getTime() + 300000),
          })
          .where(eq(runtimeHostProviderOperations.id, operation.id));
        return true;
      }
      // Persist the exact owned disks before the destructive provider call. A lost response is verified by UUID absence.
      await db
        .update(runtimeHostProviderOperations)
        .set({
          status: "WRITING",
          notBefore: new Date(now.getTime() + 60000),
          evidence: {
            storageIds,
            deleteAttempts: attempts + 1,
            providerResourceId: host.providerResourceId,
          },
        })
        .where(eq(runtimeHostProviderOperations.id, operation.id));
      try {
        await api.delete(host.providerResourceId);
      } catch {
        /* Verify next occurrence; no acknowledgement is treated as erasure evidence. */
      }
      return true;
    }
    if (
      !storageIds?.length ||
      !storageIds.every((value) => /^[a-f0-9-]{36}$/.test(value))
    )
      throw conflict("Retirement storage manifest unavailable");
    for (const storageId of storageIds)
      if (!(await api.storageAbsent(storageId))) {
        await db
          .update(runtimeHostProviderOperations)
          .set({
            status: "NEEDS_RECONCILIATION",
            errorCode: "retirement_storage_erasure_pending",
            notBefore: new Date(now.getTime() + 60000),
          })
          .where(eq(runtimeHostProviderOperations.id, operation.id));
        return true;
      }
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, host.id))
        .for("update");
      if (
        !current?.fencedAt ||
        current.providerResourceId !== host.providerResourceId
      )
        throw conflict("Retirement ownership changed");
      const cells = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.runtimeHostId, host.id),
            isNull(runtimeCells.deletedAt),
          ),
        )
        .for("update");
      for (const cell of cells) {
        const [deletion] = await tx
          .select({ id: companyDeletionOperations.id })
          .from(companyDeletionOperations)
          .where(eq(companyDeletionOperations.companyId, cell.companyId))
          .limit(1);
        if (!deletion) throw conflict("Retained company still owns host state");
        await tx
          .update(runtimeOperations)
          .set({
            status: "CANCELED",
            errorCode: "provider_storage_erased",
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(runtimeOperations.runtimeCellId, cell.id),
              inArray(runtimeOperations.status, [
                "REQUESTED",
                "RUNNING",
                "WAITING_FOR_CAPACITY",
                "NEEDS_RECONCILIATION",
              ]),
            ),
          );
        await tx
          .update(runtimeHostCommands)
          .set({
            status: "CANCELED",
            errorCode: "provider_storage_erased",
            completedAt: now,
          })
          .where(
            and(
              eq(runtimeHostCommands.runtimeCellId, cell.id),
              inArray(runtimeHostCommands.status, [
                "PENDING",
                "CLAIMED",
                "EXPIRED",
              ]),
            ),
          );
        await tx
          .update(runtimeCells)
          .set({
            status: "DELETED",
            deletedAt: now,
            activeSince: null,
            gatewaySecretRef: null,
            stateStorageRef: null,
            modelSecretRef: null,
            modelSecretVersion: null,
            updatedAt: now,
          })
          .where(eq(runtimeCells.id, cell.id));
        await tx.insert(activityLog).values({
          companyId: cell.companyId,
          actorType: "system",
          actorId: "runtime-scheduler",
          action: "runtime.provider_storage_erased",
          entityType: "runtime_cell",
          entityId: cell.id,
          details: {
            hostId: host.id,
            providerResourceId: host.providerResourceId,
            storageIds,
          },
        });
      }
      await tx
        .update(runtimeHosts)
        .set({
          status: "RETIRED",
          retiredAt: now,
          cpuReservedMillis: 0,
          memoryReservedBytes: 0n,
          diskReservedBytes: 0n,
          updatedAt: now,
        })
        .where(eq(runtimeHosts.id, host.id));
      await tx
        .update(runtimeHostProviderOperations)
        .set({
          status: "SUCCEEDED",
          completedAt: now,
          errorCode: null,
          evidence: {
            ...operation.evidence,
            storageIds,
            serverAbsent: true,
            storagesAbsent: true,
            verifiedAt: now.toISOString(),
          },
        })
        .where(eq(runtimeHostProviderOperations.id, operation.id));
    });
    return true;
  }
  async function observeLiveness(now = new Date()) {
    await db
      .update(runtimeHosts)
      .set({ status: "DEGRADED", updatedAt: now })
      .where(
        and(
          inArray(runtimeHosts.status, ["READY", "DRAINING"]),
          lt(
            runtimeHosts.lastHeartbeatAt,
            new Date(now.getTime() - config.runtime.suspectSeconds * 1000),
          ),
        ),
      );
    const lost = await db
      .select()
      .from(runtimeHosts)
      .where(
        and(
          inArray(runtimeHosts.status, [
            "READY",
            "DRAINING",
            "DEGRADED",
            "UNREACHABLE",
          ]),
          isNull(runtimeHosts.fencedAt),
          lt(
            runtimeHosts.lastHeartbeatAt,
            new Date(now.getTime() - config.runtime.unreachableSeconds * 1000),
          ),
        ),
      )
      .limit(10);
    for (const host of lost)
      if (provider) await requestFence(host.id, "runtime-scheduler", now);
  }
  async function scaleOne(now = new Date()) {
    const [waiting] = await db
      .select({ cell: runtimeCells })
      .from(runtimeOperations)
      .innerJoin(
        runtimeCells,
        eq(runtimeCells.id, runtimeOperations.runtimeCellId),
      )
      .where(eq(runtimeOperations.status, "WAITING_FOR_CAPACITY"))
      .orderBy(runtimeOperations.createdAt)
      .limit(1);
    if (!waiting) return false;
    const [pending] = await db
      .select({ id: runtimeHosts.id })
      .from(runtimeHosts)
      .where(
        and(
          eq(runtimeHosts.environment, config.environment),
          inArray(runtimeHosts.status, ["PROVISIONING", "BOOTSTRAPPING"]),
        ),
      )
      .limit(1);
    if (pending) return false;
    await requestHost(
      waiting.cell.capacityProfile,
      "runtime-scheduler",
      waiting.cell.isolationMode === "dedicated_vm"
        ? waiting.cell.companyId
        : undefined,
      now,
    );
    return true;
  }
  async function observeProviderInventory(now = new Date()) {
    const api = available();
    if (!api.inventory)
      throw new RuntimeProviderError("upcloud_inventory_unavailable");
    const resources = await api.inventory(),
      untracked: string[] = [],
      mismatched: string[] = [];
    if (resources.length > 50)
      throw new RuntimeProviderError("upcloud_inventory_limit");
    let resourceCount = 0;
    for (const server of resources) {
      const labels = new Map(
        server.labels?.label.map((label) => [label.key, label.value]),
      );
      if (
        labels.get("managed-by") !== "august-works-v6" ||
        labels.get("environment") !== config.environment
      )
        continue;
      resourceCount++;
      const hostId = labels.get("aw-host-id");
      const [host] =
        hostId && z.string().uuid().safeParse(hostId).success
          ? await db
              .select()
              .from(runtimeHosts)
              .where(
                and(
                  eq(runtimeHosts.id, hostId),
                  eq(runtimeHosts.environment, config.environment),
                ),
              )
              .limit(1)
          : [];
      if (!host || host.retiredAt) {
        untracked.push(server.uuid);
        continue;
      }
      if (!host.providerResourceId) {
        // A create may have committed while its response was lost. Do not call it
        // an orphan until the existing create operation has reconciled ownership.
        const [create] = await db
          .select({ id: runtimeHostProviderOperations.id })
          .from(runtimeHostProviderOperations)
          .where(
            and(
              eq(runtimeHostProviderOperations.runtimeHostId, host.id),
              eq(runtimeHostProviderOperations.operationType, "create"),
              inArray(runtimeHostProviderOperations.status, [
                "REQUESTED",
                "WRITING",
                "NEEDS_RECONCILIATION",
              ]),
            ),
          )
          .limit(1);
        if (!create) untracked.push(server.uuid);
      } else if (host.providerResourceId !== server.uuid)
        mismatched.push(server.uuid);
      else {
        try {
          assertOwned(server, host);
        } catch {
          mismatched.push(server.uuid);
        }
      }
    }
    const report = {
      environment: config.environment,
      observedAt: now.toISOString(),
      resourceCount,
      untrackedCount: untracked.length,
      mismatchCount: mismatched.length,
      untracked,
      mismatched,
    };
    await db.insert(platformAdminAudit).values({
      operatorUserId: "runtime-scheduler",
      action: "runtime.provider_inventory_observed",
      resourceId: config.environment,
      safeDetails: report,
    });
    return report;
  }
  return {
    requestHost,
    processCreate,
    reconcileCreates,
    requestFence,
    processFence,
    observeLiveness,
    scaleOne,
    observeProviderInventory,
    drain,
    requestRetire,
    processRetire,
  };
}
