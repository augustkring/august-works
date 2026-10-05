import { hostVersionMeetsMinimum } from "./catalog.js";
import { runtimeCommercialReason } from "./commercial.js";
import type { NotifyCompany } from "../notifications/notifications.js";
import { randomUUID } from "node:crypto";
import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  activityLog,
  companySecrets,
  agentProviderBindings,
  agentPresenceRuntimeBindings,
  agents,
  billingAccounts,
  runtimeCapacityProfiles,
  runtimeCells,
  runtimeHostCommands,
  runtimeHosts,
  runtimeOperations,
  runtimeOperationAttempts,
  runtimeBackups,
  runtimeVersionCatalog,
  type Db,
} from "@paperclipai/db";
import {
  runtimeModelProviderSchema,
  runtimeCellCreateSchema,
  runtimeCommandResultSchema,
  runtimeHeartbeatSchema,
  runtimeOperationSchema,
} from "@paperclipai/shared";
import type { z } from "zod";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { entitlementService } from "../billing/entitlements.js";
import { usageService } from "../billing/usage.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization } from "../v5-authorization.js";
import { agentService } from "../agents.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { secretService } from "../secrets.js";
import { equalDigest, randomToken, sha256 } from "../saas/crypto.js";
import { runtimeBackupService } from "./backups.js";
import { runtimeGatewayRelay } from "./gateway-relay.js";
import { runtimeHostAuth } from "./host-auth.js";

const ACTIVE_OPERATIONS = [
  "REQUESTED",
  "RUNNING",
  "WAITING_FOR_CAPACITY",
  "NEEDS_RECONCILIATION",
];
const CELL_ACTION_STATUS: Record<string, string> = {
  provision: "PROVISIONING",
  start: "STARTING",
  stop: "STOPPING",
  delete: "DELETING",
  backup: "BACKING_UP",
  restore: "RECOVERING",
  upgrade: "UPGRADING",
  migrate: "MIGRATING",
  rotate_gateway: "CONFIGURING",
};
export function runtimeControlService(
  db: Db,
  config: SaasPlatformConfig,
  notify?: NotifyCompany,
) {
  const auth = runtimeHostAuth(db);
  const backups = runtimeBackupService(db, config);
  const relay = runtimeGatewayRelay({
    authenticateHost: (proof, raw) =>
      auth.authenticate(proof, "WS", "/api/internal/runtime/relay", raw),
    async hostCurrent(host) {
      const [current] = await db
        .select({ id: runtimeHosts.id })
        .from(runtimeHosts)
        .where(
          and(
            eq(runtimeHosts.id, host.id),
            eq(runtimeHosts.credentialVersion, host.credentialVersion),
            isNull(runtimeHosts.credentialRevokedAt),
            isNull(runtimeHosts.fencedAt),
            isNull(runtimeHosts.retiredAt),
            inArray(runtimeHosts.status, ["READY", "DRAINING"]),
            gt(
              runtimeHosts.lastHeartbeatAt,
              new Date(Date.now() - config.runtime.suspectSeconds * 1000),
            ),
          ),
        )
        .limit(1);
      return !!current;
    },
    async cellCurrent(cellId, scope) {
      const [cell] = await db
        .select({ id: runtimeCells.id })
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, cellId),
            eq(runtimeCells.companyId, scope.companyId),
            eq(runtimeCells.runtimeHostId, scope.runtimeHostId),
            eq(runtimeCells.generation, BigInt(scope.generation)),
            eq(runtimeCells.status, "HEALTHY"),
            isNull(runtimeCells.suspendedReason),
            isNull(runtimeCells.deletedAt),
          ),
        )
        .limit(1);
      return !!cell;
    },
    async authorizeCell(cellId, generation, token) {
      const [cell] = await db
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, cellId),
            eq(runtimeCells.generation, BigInt(generation)),
            eq(runtimeCells.status, "HEALTHY"),
            isNull(runtimeCells.suspendedReason),
            isNull(runtimeCells.deletedAt),
          ),
        )
        .limit(1);
      if (!cell?.runtimeHostId || !cell.gatewaySecretRef)
        throw forbidden("Runtime unavailable");
      const expected = await secretService(db).resolveSecretValue(
        cell.companyId,
        cell.gatewaySecretRef,
        "latest",
        {
          accessContext: {
            consumerType: "system",
            consumerId: cell.id,
            actorType: "system",
            actorId: "runtime-relay",
          },
        },
      );
      if (!equalDigest(sha256(token), sha256(expected)))
        throw forbidden("Runtime credential unavailable");
      return {
        runtimeHostId: cell.runtimeHostId,
        companyId: cell.companyId,
        generation: cell.generation.toString(),
      };
    },
  });
  type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
  async function meter(
    tx: Tx,
    cell: typeof runtimeCells.$inferSelect,
    now: Date,
    _diskBytes?: bigint,
  ) {
    if (!cell.activeSince || !cell.meteredThrough || now <= cell.meteredThrough)
      return;
    const end = new Date(
      Math.min(
        now.getTime(),
        cell.meteredThrough.getTime() +
          config.runtime.unreachableSeconds * 1000,
      ),
    );
    const sourceEventId =
      cell.generation.toString() +
      ":" +
      cell.meteredThrough.toISOString() +
      ":" +
      end.toISOString();
    const common = {
      companyId: cell.companyId,
      resourceType: "runtime_cell",
      resourceId: cell.id,
      periodStart: cell.meteredThrough,
      periodEnd: end,
      sourceEventId,
    };
    const elapsed = BigInt(end.getTime() - cell.meteredThrough.getTime());
    await usageService(db).record(
      {
        ...common,
        meterKey:
          cell.isolationMode === "dedicated_vm"
            ? "runtime.dedicated_vm_millisecond"
            : cell.isolationMode === "dedicated_agent_gateway"
              ? "runtime.dedicated_gateway_millisecond"
              : "runtime.shared_millisecond",
        quantity: elapsed,
      },
      tx,
    );
    // Gateway state, logs and safety backups are internal overhead, not customer application-storage charges.
  }
  async function getCell(companyId: string, cellId: string) {
    const [cell] = await db
      .select()
      .from(runtimeCells)
      .where(
        and(eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, cellId)),
      )
      .limit(1);
    if (!cell) throw notFound("Runtime cell not found");
    return cell;
  }
  async function create(
    companyId: string,
    userId: string,
    input: z.infer<typeof runtimeCellCreateSchema>,
    now = new Date(),
    canaryOperatorId?: string,
  ) {
    await entitlementService(db).require(companyId, "platform.access");
    const state = await entitlementService(db).require(
      companyId,
      "hosted_runtime.provision",
    );
    if (canaryOperatorId && !config.operatorUserIds.includes(canaryOperatorId))
      throw forbidden("Internal canary operator required");
    const requestHash = sha256(
      JSON.stringify(canaryOperatorId ? { ...input, canaryOperatorId } : input),
    );
    return db.transaction(async (tx) => {
      await tx
        .select({ id: billingAccounts.id })
        .from(billingAccounts)
        .where(eq(billingAccounts.id, state.billingAccountId))
        .for("update");
      const [replay] = await tx
        .select()
        .from(runtimeOperations)
        .where(
          and(
            eq(runtimeOperations.companyId, companyId),
            eq(runtimeOperations.operationType, "provision"),
            eq(runtimeOperations.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw conflict("Idempotency key has a different request");
        return {
          cell: await getCell(companyId, replay.runtimeCellId),
          operation: replay,
        };
      }
      const current = await entitlementService(db).require(
        companyId,
        "hosted_runtime.provision",
      );
      const key =
        input.isolationMode === "dedicated_vm"
          ? "hosted_runtime.dedicated_vm.max_cells"
          : input.isolationMode === "dedicated_agent_gateway"
            ? "hosted_runtime.dedicated_gateway.max_cells"
            : "hosted_runtime.standard.max_cells";
      const occupied = await tx
        .select({ id: runtimeCells.id })
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.billingAccountId, current.billingAccountId),
            eq(runtimeCells.isolationMode, input.isolationMode),
            isNull(runtimeCells.deletedAt),
          ),
        );
      if (BigInt(occupied.length) >= BigInt(String(current.entitlements[key])))
        throw forbidden("Runtime plan capacity exceeded", {
          code: "RUNTIME_PLAN_LIMIT",
        });
      const [capacity] = await tx
        .select()
        .from(runtimeCapacityProfiles)
        .where(
          and(
            eq(runtimeCapacityProfiles.key, input.capacityProfile),
            eq(runtimeCapacityProfiles.qualified, true),
          ),
        )
        .limit(1);
      if (!capacity?.benchmarkEvidence)
        throw unprocessable("Runtime capacity profile is not qualified");
      const products =
        input.isolationMode === "company_cell"
          ? ["runtime_standard", "runtime_performance"]
          : input.isolationMode === "dedicated_vm"
            ? ["runtime_dedicated_vm"]
            : ["runtime_dedicated_gateway"];
      if (!products.includes(capacity.commercialProductKey))
        throw forbidden(
          "Capacity does not match the selected runtime product",
          { code: "RUNTIME_PRODUCT_MISMATCH" },
        );
      if (capacity.commercialProductKey === "runtime_performance") {
        const performance = await tx
          .select({ id: runtimeCells.id })
          .from(runtimeCells)
          .innerJoin(
            runtimeCapacityProfiles,
            eq(runtimeCapacityProfiles.key, runtimeCells.capacityProfile),
          )
          .where(
            and(
              eq(runtimeCells.billingAccountId, current.billingAccountId),
              eq(
                runtimeCapacityProfiles.commercialProductKey,
                "runtime_performance",
              ),
              isNull(runtimeCells.deletedAt),
            ),
          );
        if (
          BigInt(performance.length) >=
          BigInt(
            String(
              current.entitlements["hosted_runtime.performance.max_cells"],
            ),
          )
        )
          throw forbidden("Performance runtime capacity requires its add-on", {
            code: "RUNTIME_PLAN_LIMIT",
          });
      }
      const [version] = await tx
        .select()
        .from(runtimeVersionCatalog)
        .where(
          and(
            eq(runtimeVersionCatalog.imageDigest, input.imageDigest),
            inArray(
              runtimeVersionCatalog.status,
              canaryOperatorId ? ["canary", "approved"] : ["approved"],
            ),
          ),
        )
        .limit(1);
      if (
        !version ||
        (!canaryOperatorId &&
          (!version.approvedAt || !version.approvedByUserId))
      )
        throw unprocessable("Runtime version is not approved");
      if (input.dedicatedAgentId) {
        const [agent] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(
            and(
              eq(agents.id, input.dedicatedAgentId),
              eq(agents.companyId, companyId),
              ne(agents.status, "terminated"),
            ),
          )
          .limit(1);
        if (!agent) throw notFound("Agent not found");
      }
      const id = randomUUID();
      const secret = await secretService(tx).create(
        companyId,
        {
          name: "Runtime Gateway " + id,
          provider: "local_encrypted",
          value: randomToken(),
          description: "Managed runtime Gateway authentication",
        },
        { userId },
      );
      const [cell] = await tx
        .insert(runtimeCells)
        .values({
          id,
          companyId,
          billingAccountId: current.billingAccountId,
          isolationMode: input.isolationMode,
          capacityProfile: capacity.key,
          desiredImageDigest: version.imageDigest,
          dedicatedAgentId: input.dedicatedAgentId,
          gatewaySecretRef: secret.id,
          stateStorageRef: "cell:" + id,
        })
        .returning();
      const [operation] = await tx
        .insert(runtimeOperations)
        .values({
          companyId,
          runtimeCellId: id,
          operationType: "provision",
          requestedByType: "user",
          requestedById: userId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          desiredState: {
            imageDigest: input.imageDigest,
            ...(canaryOperatorId ? { canaryOperatorId } : {}),
          },
          deadlineAt: new Date(now.getTime() + 900000),
        })
        .returning();
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "runtime.provision_requested",
          entityType: "runtime_cell",
          entityId: id,
          details: {
            operationId: operation!.id,
            isolationMode: input.isolationMode,
          },
        });
      return { cell: cell!, operation: operation! };
    });
  }
  async function request(
    companyId: string,
    cellId: string,
    userId: string,
    input: z.infer<typeof runtimeOperationSchema>,
    now = new Date(),
    systemActor?: "backup-scheduler",
  ) {
    if (["start", "upgrade", "migrate", "restore"].includes(input.action))
      await entitlementService(db).require(
        companyId,
        "hosted_runtime.provision",
      );
    const requestHash = sha256(JSON.stringify({ cellId, ...input, ...(systemActor ? { systemActor } : {}) }));
    return db.transaction(async (tx) => {
      const initial = await getCell(companyId, cellId);
      await tx
        .select({ id: billingAccounts.id })
        .from(billingAccounts)
        .where(eq(billingAccounts.id, initial.billingAccountId))
        .for("update");
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, cellId),
            eq(runtimeCells.companyId, companyId),
          ),
        )
        .for("update");
      if (!cell) throw notFound("Runtime cell not found");
      const [replay] = await tx
        .select()
        .from(runtimeOperations)
        .where(
          and(
            eq(runtimeOperations.companyId, companyId),
            eq(runtimeOperations.operationType, input.action),
            eq(runtimeOperations.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw conflict("Idempotency key has a different request");
        return replay;
      }
      if (cell.deletedAt) throw conflict("Runtime cell was deleted");
      const [busy] = await tx
        .select({ id: runtimeOperations.id })
        .from(runtimeOperations)
        .where(
          and(
            eq(runtimeOperations.runtimeCellId, cellId),
            inArray(runtimeOperations.status, ACTIVE_OPERATIONS),
          ),
        )
        .limit(1);
      if (busy) throw conflict("Runtime operation already active");
      if (["start", "upgrade", "restore", "migrate"].includes(input.action)) {
        const reason = await runtimeCommercialReason(tx, cell, now);
        if (reason)
          throw forbidden("Runtime commercial capacity is unavailable", {
            code: "RUNTIME_PLAN_LIMIT",
          });
        if (input.action === "start")
          await tx
            .update(runtimeCells)
            .set({ suspendedReason: null, updatedAt: now })
            .where(eq(runtimeCells.id, cell.id));
      }
      if (
        (input.action === "start" && cell.status !== "STOPPED") ||
        (input.action === "stop" &&
          !["HEALTHY", "DEGRADED", "FAILED"].includes(cell.status))
      )
        throw conflict("Runtime state does not allow this operation");
      if (
        ["backup", "upgrade", "rotate_gateway"].includes(input.action) &&
        cell.status !== "STOPPED"
      )
        throw conflict("Stop the runtime before changing its state or image");
      if (input.action === "upgrade") {
        if (!input.imageDigest)
          throw unprocessable("Approved target image required");
        const [target] = await tx
          .select()
          .from(runtimeVersionCatalog)
          .where(
            and(
              eq(runtimeVersionCatalog.imageDigest, input.imageDigest),
              eq(runtimeVersionCatalog.status, "approved"),
            ),
          )
          .limit(1);
        const [source] = await tx
          .select()
          .from(runtimeVersionCatalog)
          .where(
            eq(
              runtimeVersionCatalog.imageDigest,
              cell.activeImageDigest ?? cell.desiredImageDigest,
            ),
          )
          .limit(1);
        if (!target || !source || target.stateFormat !== source.stateFormat)
          throw unprocessable(
            "State format changes require a qualified backup and restore migration",
          );
      }
      const [initialProvision] = await tx
        .select({ desired: runtimeOperations.desiredState })
        .from(runtimeOperations)
        .where(
          and(
            eq(runtimeOperations.runtimeCellId, cell.id),
            eq(runtimeOperations.operationType, "provision"),
          ),
        )
        .limit(1);
      const canaryOperatorId =
        typeof initialProvision?.desired.canaryOperatorId === "string" &&
        config.operatorUserIds?.includes(
          initialProvision.desired.canaryOperatorId,
        ) &&
        initialProvision.desired.imageDigest === cell.desiredImageDigest
          ? initialProvision.desired.canaryOperatorId
          : undefined;
      const transactionDb = tx as unknown as Db;
      let backupId = input.backupId;
      if (input.action === "backup")
        backupId = (await backups.prepare(transactionDb, cell, userId, now)).id;
      if (input.action === "upgrade") {
        if (!backupId)
          throw unprocessable("A verified backup is required before upgrading");
        const backup = await backups.get(companyId, backupId, tx);
        if (
          backup.runtimeCellId !== cell.id ||
          backup.generation !== cell.generation ||
          backup.status !== "VERIFIED" ||
          backup.imageDigest !==
            (cell.activeImageDigest ?? cell.desiredImageDigest)
        )
          throw unprocessable(
            "Verified backup does not describe this runtime generation",
          );
      }
      let sourceGeneration: string | undefined;
      if (["restore", "migrate"].includes(input.action)) {
        if (!backupId) throw unprocessable("A verified backup is required");
        const backup = await backups.get(companyId, backupId, tx);
        if (backup.runtimeCellId !== cell.id || backup.status !== "VERIFIED")
          throw unprocessable("Verified company-scoped backup required");
        const [sourceHost] = cell.runtimeHostId
          ? await tx
              .select()
              .from(runtimeHosts)
              .where(eq(runtimeHosts.id, cell.runtimeHostId))
              .limit(1)
          : [];
        if (
          !sourceHost ||
          (cell.status !== "STOPPED" && !sourceHost.fencedAt) ||
          (input.action === "migrate" && !sourceHost.fencedAt)
        )
          throw conflict(
            "Source runtime must be stopped; moving hosts requires confirmed provider fencing",
          );
        const [version] = await tx
          .select()
          .from(runtimeVersionCatalog)
          .where(
            and(
              eq(runtimeVersionCatalog.imageDigest, backup.imageDigest),
              inArray(
                runtimeVersionCatalog.status,
                canaryOperatorId ? ["canary", "approved"] : ["approved"],
              ),
            ),
          )
          .limit(1);
        if (!version || version.stateFormat !== backup.stateFormat)
          throw unprocessable(
            "Restore image and state format must remain approved",
          );
        sourceGeneration = cell.generation.toString();
        if (!cell.gatewaySecretRef)
          throw conflict("Gateway credential unavailable");
        await secretService(tx).rotate(
          cell.gatewaySecretRef,
          { value: randomToken() },
          { userId },
        );
        await tx
          .update(runtimeCells)
          .set({
            generation: sql`${runtimeCells.generation}+1`,
            desiredImageDigest: backup.imageDigest,
            activeImageDigest: null,
            activeSince: null,
            meteredThrough: null,
            modelSecretRef: null,
            modelSecretVersion: null,
            ...(sourceHost.fencedAt ? { runtimeHostId: null } : {}),
            updatedAt: now,
          })
          .where(eq(runtimeCells.id, cell.id));
      }
      if (input.action === "rotate_gateway") {
        if (!cell.gatewaySecretRef)
          throw conflict("Gateway credential unavailable");
        await secretService(tx).rotate(
          cell.gatewaySecretRef,
          { value: randomToken() },
          { userId },
        );
      }
      const [operation] = await tx
        .insert(runtimeOperations)
        .values({
          companyId,
          runtimeCellId: cellId,
          operationType: input.action,
          requestedByType: systemActor ? "system" : "user",
          requestedById: systemActor ?? userId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          desiredState: {
            ...(canaryOperatorId ? { canaryOperatorId } : {}),
            ...(input.imageDigest ? { imageDigest: input.imageDigest } : {}),
            ...(backupId ? { backupId } : {}),
            ...(sourceGeneration ? { sourceGeneration } : {}),
          },
          deadlineAt: new Date(
            now.getTime() +
              (["backup", "restore", "migrate"].includes(input.action)
                ? 3600000
                : 900000),
          ),
        })
        .returning();
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: systemActor ? "system" : "user",
          actorId: systemActor ?? userId,
          action: "runtime." + input.action + "_requested",
          entityType: "runtime_cell",
          entityId: cellId,
          details: { operationId: operation!.id, ...(systemActor ? { approvedByUserId: userId, scheduled: true } : {}) },
        });
      return operation!;
    });
  }
  async function dispatchOne(now = new Date(), admitNew = true) {
    return db.transaction(async (tx) => {
      const [operation] = await tx
        .select()
        .from(runtimeOperations)
        .where(
          and(
            inArray(runtimeOperations.status, [
              "REQUESTED",
              "WAITING_FOR_CAPACITY",
            ]),
            lte(runtimeOperations.notBefore, now),
            ...(admitNew
              ? []
              : [
                  inArray(runtimeOperations.operationType, [
                    "stop",
                    "delete",
                    "backup",
                    "rotate_gateway",
                  ]),
                ]),
          ),
        )
        .orderBy(runtimeOperations.createdAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!operation) return false;
      if (operation.deadlineAt <= now || operation.attemptCount >= 3) {
        await tx
          .update(runtimeOperations)
          .set({
            status: "FAILED",
            errorCode: "operation_deadline",
            completedAt: now,
          })
          .where(eq(runtimeOperations.id, operation.id));
        await tx
          .update(runtimeCells)
          .set({ lastErrorCode: "operation_deadline", updatedAt: now })
          .where(eq(runtimeCells.id, operation.runtimeCellId));
        return true;
      }
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(eq(runtimeCells.id, operation.runtimeCellId))
        .for("update")
        .limit(1);
      if (!cell || cell.deletedAt) throw conflict("Runtime unavailable");
      if (
        ["provision", "start", "upgrade", "restore", "migrate"].includes(
          operation.operationType,
        )
      ) {
        const state = await entitlementService(tx as unknown as Db).resolve(
          cell.companyId,
          now,
        );
        if (
          cell.suspendedReason ||
          state.entitlements["platform.access"] !== true ||
          state.entitlements["hosted_runtime.provision"] !== true
        ) {
          await tx
            .update(runtimeOperations)
            .set({
              status: "CANCELED",
              errorCode: "commercial_admission_closed",
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(runtimeOperations.id, operation.id));
          if (!cell.runtimeHostId)
            await tx
              .update(runtimeCells)
              .set({
                status: "FAILED",
                lastErrorCode: "commercial_admission_closed",
                updatedAt: now,
              })
              .where(eq(runtimeCells.id, cell.id));
          return true;
        }
      }
      const [profile] = await tx
        .select()
        .from(runtimeCapacityProfiles)
        .where(eq(runtimeCapacityProfiles.key, cell.capacityProfile))
        .limit(1);
      if (
        !profile ||
        (!profile.qualified &&
          !["stop", "delete", "backup", "rotate_gateway"].includes(
            operation.operationType,
          ))
      )
        throw conflict("Runtime profile unavailable");
      let requiredHostVersion: string | undefined;
      if (
        !["stop", "delete", "backup", "rotate_gateway"].includes(
          operation.operationType,
        )
      ) {
        const canary =
          typeof operation.desiredState.canaryOperatorId === "string" &&
          config.operatorUserIds?.includes(
            operation.desiredState.canaryOperatorId,
          );
        const [version] = await tx
          .select({
            id: runtimeVersionCatalog.imageDigest,
            minimum: runtimeVersionCatalog.hostAgentMinimumVersion,
          })
          .from(runtimeVersionCatalog)
          .where(
            and(
              eq(
                runtimeVersionCatalog.imageDigest,
                String(
                  operation.desiredState.imageDigest ?? cell.desiredImageDigest,
                ),
              ),
              inArray(
                runtimeVersionCatalog.status,
                canary ? ["canary", "approved"] : ["approved"],
              ),
            ),
          )
          .limit(1);
        if (!version) {
          await tx
            .update(runtimeOperations)
            .set({
              status: "FAILED",
              errorCode: "runtime_version_not_approved",
              completedAt: now,
            })
            .where(eq(runtimeOperations.id, operation.id));
          return true;
        }
        requiredHostVersion = version.minimum;
      }
      let host = cell.runtimeHostId
        ? (
            await tx
              .select()
              .from(runtimeHosts)
              .where(eq(runtimeHosts.id, cell.runtimeHostId))
              .for("update")
          )[0]
        : undefined;
      if (!host) {
        [host] = await tx
          .select()
          .from(runtimeHosts)
          .where(
            and(
              eq(runtimeHosts.environment, config.environment),
              eq(runtimeHosts.region, config.runtime.region),
              eq(runtimeHosts.status, "READY"),
              isNull(runtimeHosts.fencedAt),
              isNull(runtimeHosts.credentialRevokedAt),
              isNull(runtimeHosts.drainRequestedAt),
              gt(
                runtimeHosts.lastHeartbeatAt,
                new Date(now.getTime() - config.runtime.suspectSeconds * 1000),
              ),
              cell.isolationMode === "dedicated_vm"
                ? and(
                    eq(runtimeHosts.dedicatedCompanyId, cell.companyId),
                    eq(runtimeHosts.cpuReservedMillis, 0),
                  )
                : isNull(runtimeHosts.dedicatedCompanyId),
              sql`${runtimeHosts.cpuTotalMillis}-${runtimeHosts.cpuReservedMillis} >= ${profile.cpuMillis}`,
              sql`${runtimeHosts.memoryTotalBytes}-${runtimeHosts.memoryReservedBytes} >= ${profile.memoryBytes.toString()}::bigint`,
              sql`${runtimeHosts.diskTotalBytes}-${runtimeHosts.diskReservedBytes} >= ${profile.diskBytes.toString()}::bigint`,
            ),
          )
          .orderBy(runtimeHosts.createdAt)
          .limit(1)
          .for("update", { skipLocked: true });
        if (host) {
          await tx
            .update(runtimeHosts)
            .set({
              cpuReservedMillis: sql`${runtimeHosts.cpuReservedMillis}+${profile.cpuMillis}`,
              memoryReservedBytes: sql`${runtimeHosts.memoryReservedBytes}+${profile.memoryBytes.toString()}::bigint`,
              diskReservedBytes: sql`${runtimeHosts.diskReservedBytes}+${profile.diskBytes.toString()}::bigint`,
            })
            .where(eq(runtimeHosts.id, host.id));
          await tx
            .update(runtimeCells)
            .set({ runtimeHostId: host.id })
            .where(eq(runtimeCells.id, cell.id));
        }
      }
      if (
        !host ||
        !(["stop", "delete", "backup", "rotate_gateway"].includes(
          operation.operationType,
        )
          ? ["READY", "DRAINING", "DEGRADED"].includes(host.status)
          : host.status === "READY") ||
        host.fencedAt ||
        host.credentialRevokedAt
      ) {
        await tx
          .update(runtimeOperations)
          .set({
            status: "WAITING_FOR_CAPACITY",
            notBefore: new Date(now.getTime() + 10000),
          })
          .where(eq(runtimeOperations.id, operation.id));
        await tx
          .update(runtimeCells)
          .set({ status: "WAITING_FOR_CAPACITY" })
          .where(eq(runtimeCells.id, cell.id));
        return true;
      }
      if (
        requiredHostVersion &&
        !hostVersionMeetsMinimum(host.hostAgentVersion, requiredHostVersion)
      ) {
        await tx
          .update(runtimeOperations)
          .set({
            status: "WAITING_FOR_CAPACITY",
            notBefore: new Date(now.getTime() + 30000),
            errorCode: "host_agent_upgrade_required",
          })
          .where(eq(runtimeOperations.id, operation.id));
        await tx
          .update(runtimeCells)
          .set({
            status: "WAITING_FOR_CAPACITY",
            lastErrorCode: "host_agent_upgrade_required",
            updatedAt: now,
          })
          .where(eq(runtimeCells.id, cell.id));
        return true;
      }
      const [command] = await tx
        .insert(runtimeHostCommands)
        .values({
          runtimeHostId: host.id,
          companyId: cell.companyId,
          runtimeCellId: cell.id,
          operationId: operation.id,
          cellGeneration: cell.generation,
          commandType: operation.operationType,
          idempotencyKey: operation.id + ":" + cell.generation.toString(),
          payload: {
            ...(cell.modelProvider &&
            cell.modelId &&
            cell.modelSecretRef &&
            cell.modelSecretVersion
              ? {
                  modelProvider: {
                    provider: cell.modelProvider,
                    modelId: cell.modelId,
                    secretId: cell.modelSecretRef,
                    version: cell.modelSecretVersion,
                  },
                }
              : {}),
            cellId: cell.id,
            companyId: cell.companyId,
            generation: cell.generation.toString(),
            imageDigest:
              operation.desiredState.imageDigest ?? cell.desiredImageDigest,
            isolationMode: cell.isolationMode,
            capacity: {
              cpuMillis: profile.cpuMillis,
              memoryBytes: profile.memoryBytes.toString(),
              diskBytes: profile.diskBytes.toString(),
              pidsLimit: profile.pidsLimit,
            },
            ...operation.desiredState,
          },
          deadlineAt: operation.deadlineAt,
        })
        .returning();
      await tx
        .insert(runtimeOperationAttempts)
        .values({
          operationId: operation.id,
          attemptNumber: operation.attemptCount + 1,
          runtimeHostId: host.id,
          commandId: command!.id,
          status: "dispatched",
        });
      await tx
        .update(runtimeOperations)
        .set({
          status: "RUNNING",
          attemptCount: sql`${runtimeOperations.attemptCount}+1`,
          version: sql`${runtimeOperations.version}+1`,
          updatedAt: now,
        })
        .where(eq(runtimeOperations.id, operation.id));
      await tx
        .update(runtimeCells)
        .set({
          status: CELL_ACTION_STATUS[operation.operationType] ?? "CONFIGURING",
          ...(typeof operation.desiredState.imageDigest === "string"
            ? { desiredImageDigest: operation.desiredState.imageDigest }
            : {}),
          updatedAt: now,
        })
        .where(eq(runtimeCells.id, cell.id));
      return true;
    });
  }
  async function claim(hostId: string, now = new Date(), admitNew = true) {
    const claimed = await db.transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(runtimeHosts)
        .where(
          and(
            eq(runtimeHosts.id, hostId),
            isNull(runtimeHosts.credentialRevokedAt),
            isNull(runtimeHosts.fencedAt),
          ),
        )
        .for("update");
      if (!host || !["READY", "DRAINING"].includes(host.status))
        throw forbidden("Host cannot claim commands");
      const [command] = await tx
        .select()
        .from(runtimeHostCommands)
        .where(
          and(
            eq(runtimeHostCommands.runtimeHostId, hostId),
            ...(admitNew
              ? []
              : [
                  inArray(runtimeHostCommands.commandType, [
                    "stop",
                    "delete",
                    "backup",
                    "rotate_gateway",
                  ]),
                ]),
            or(
              eq(runtimeHostCommands.status, "PENDING"),
              and(
                eq(runtimeHostCommands.status, "CLAIMED"),
                lte(runtimeHostCommands.leaseUntil, now),
              ),
            ),
            gt(runtimeHostCommands.deadlineAt, now),
            lt(runtimeHostCommands.attempt, 3),
            lte(runtimeHostCommands.notBefore, now),
          ),
        )
        .orderBy(runtimeHostCommands.createdAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!command) return null;
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, command.runtimeCellId!),
            eq(runtimeCells.companyId, command.companyId!),
            eq(runtimeCells.runtimeHostId, hostId),
            eq(runtimeCells.generation, command.cellGeneration!),
          ),
        )
        .limit(1);
      if (!cell || cell.deletedAt) {
        await tx
          .update(runtimeHostCommands)
          .set({ status: "CANCELED", errorCode: "stale_generation" })
          .where(eq(runtimeHostCommands.id, command.id));
        return null;
      }
      if (
        ["provision", "start", "upgrade", "restore", "migrate"].includes(
          command.commandType,
        )
      ) {
        const [operation] = await tx
          .select({ desired: runtimeOperations.desiredState })
          .from(runtimeOperations)
          .where(eq(runtimeOperations.id, command.operationId!))
          .limit(1);
        const canary =
          typeof operation?.desired.canaryOperatorId === "string" &&
          config.operatorUserIds?.includes(operation.desired.canaryOperatorId);
        const [version] = await tx
          .select({ minimum: runtimeVersionCatalog.hostAgentMinimumVersion })
          .from(runtimeVersionCatalog)
          .where(
            and(
              eq(
                runtimeVersionCatalog.imageDigest,
                String(command.payload.imageDigest),
              ),
              inArray(
                runtimeVersionCatalog.status,
                canary ? ["canary", "approved"] : ["approved"],
              ),
            ),
          )
          .limit(1);
        if (
          !version ||
          !hostVersionMeetsMinimum(host.hostAgentVersion, version.minimum)
        ) {
          const unknown = command.attempt > 0;
          await tx
            .update(runtimeHostCommands)
            .set({
              status: unknown ? "EXPIRED" : "CANCELED",
              errorCode: "runtime_version_admission_closed",
            })
            .where(eq(runtimeHostCommands.id, command.id));
          await tx
            .update(runtimeOperations)
            .set({
              status: unknown ? "NEEDS_RECONCILIATION" : "FAILED",
              errorCode: "runtime_version_admission_closed",
              updatedAt: now,
              ...(!unknown ? { completedAt: now } : {}),
            })
            .where(eq(runtimeOperations.id, command.operationId!));
          return null;
        }
        const state = await entitlementService(tx as unknown as Db).resolve(
          cell.companyId,
          now,
        );
        if (
          cell.suspendedReason ||
          state.entitlements["platform.access"] !== true ||
          state.entitlements["hosted_runtime.provision"] !== true
        ) {
          const unknown = command.attempt > 0;
          await tx
            .update(runtimeHostCommands)
            .set({
              status: unknown ? "EXPIRED" : "CANCELED",
              errorCode: "commercial_admission_closed",
            })
            .where(eq(runtimeHostCommands.id, command.id));
          await tx
            .update(runtimeOperations)
            .set({
              status: unknown ? "NEEDS_RECONCILIATION" : "CANCELED",
              errorCode: "commercial_admission_closed",
              updatedAt: now,
              ...(!unknown ? { completedAt: now } : {}),
            })
            .where(eq(runtimeOperations.id, command.operationId!));
          await tx
            .update(runtimeCells)
            .set({
              status: unknown ? "DEGRADED" : "FAILED",
              lastErrorCode: "commercial_admission_closed",
              updatedAt: now,
            })
            .where(eq(runtimeCells.id, cell.id));
          return null;
        }
      }
      const token = randomToken();
      await tx
        .update(runtimeHostCommands)
        .set({
          status: "CLAIMED",
          claimTokenHash: sha256(token),
          attempt: sql`${runtimeHostCommands.attempt}+1`,
          leaseUntil: new Date(
            Math.min(command.deadlineAt.getTime(), now.getTime() + 120000),
          ),
        })
        .where(eq(runtimeHostCommands.id, command.id));
      return { host, cell, command, token };
    });
    if (!claimed) return null;
    if (!claimed.cell.gatewaySecretRef)
      throw conflict("Runtime credential unavailable");
    const gatewayToken = await secretService(db).resolveSecretValue(
      claimed.cell.companyId,
      claimed.cell.gatewaySecretRef,
      "latest",
      {
        accessContext: {
          consumerType: "system",
          consumerId: claimed.cell.id,
          actorType: "system",
          actorId: "runtime-host:" + hostId,
        },
      },
    );
    const backupAction = ["backup", "restore", "migrate"].includes(
      claimed.command.commandType,
    );
    const backup = backupAction
      ? await backups.command(
          claimed.cell.companyId,
          claimed.cell.id,
          String(claimed.command.payload.backupId),
          hostId,
          claimed.command.commandType === "backup" ? "backup" : "restore",
          String(
            (claimed.command.payload.capacity as { diskBytes: string })
              .diskBytes,
          ),
        )
      : undefined;
    const modelRef = claimed.command.payload.modelProvider as
      | { provider: string; modelId: string; secretId: string; version: number }
      | undefined;
    const modelProvider =
      modelRef &&
      ["provision", "start", "upgrade", "rotate_gateway"].includes(
        claimed.command.commandType,
      )
        ? {
            provider: modelRef.provider,
            modelId: modelRef.modelId,
            apiKey: await secretService(db).resolveSecretValue(
              claimed.cell.companyId,
              modelRef.secretId,
              modelRef.version,
              {
                accessContext: {
                  consumerType: "system",
                  consumerId: claimed.cell.id,
                  actorType: "system",
                  actorId: "runtime-host:" + hostId,
                },
              },
            ),
          }
        : undefined;
    return {
      id: claimed.command.id,
      type: claimed.command.commandType,
      deadlineAt: claimed.command.deadlineAt,
      envelope: auth.protectCommand(claimed.host, claimed.command.id, {
        ...claimed.command.payload,
        claimToken: claimed.token,
        gatewayToken,
        ...(modelProvider ? { modelProvider } : {}),
        ...(backup ? { backup } : {}),
      }),
    };
  }
  async function renew(
    hostId: string,
    commandId: string,
    raw: unknown,
    now = new Date(),
  ) {
    const input = runtimeCommandResultSchema
      .pick({ claimToken: true, generation: true })
      .parse(raw);
    return db.transaction(async (tx) => {
      const [command] = await tx
        .select()
        .from(runtimeHostCommands)
        .where(
          and(
            eq(runtimeHostCommands.id, commandId),
            eq(runtimeHostCommands.runtimeHostId, hostId),
          ),
        )
        .for("update");
      if (
        !command ||
        command.status !== "CLAIMED" ||
        !command.claimTokenHash ||
        !equalDigest(command.claimTokenHash, sha256(input.claimToken)) ||
        command.cellGeneration !== BigInt(input.generation) ||
        !command.leaseUntil ||
        command.leaseUntil <= now ||
        command.deadlineAt <= now
      )
        throw conflict("Command claim is no longer current");
      const [cell] = await tx
        .select({ id: runtimeCells.id })
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, command.runtimeCellId!),
            eq(runtimeCells.runtimeHostId, hostId),
            eq(runtimeCells.generation, command.cellGeneration),
          ),
        )
        .limit(1);
      if (!cell) throw conflict("Stale runtime ownership");
      await tx
        .update(runtimeHostCommands)
        .set({
          leaseUntil: new Date(
            Math.min(command.deadlineAt.getTime(), now.getTime() + 120000),
          ),
        })
        .where(eq(runtimeHostCommands.id, command.id));
      return { renewed: true };
    });
  }
  async function complete(
    hostId: string,
    commandId: string,
    raw: unknown,
    now = new Date(),
    recovering = false,
  ) {
    const input = runtimeCommandResultSchema.parse(raw);
    return db.transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(runtimeHosts)
        .where(
          and(
            eq(runtimeHosts.id, hostId),
            isNull(runtimeHosts.credentialRevokedAt),
            isNull(runtimeHosts.fencedAt),
          ),
        )
        .for("update");
      if (!host) throw forbidden("Host credential unavailable");
      const [command] = await tx
        .select()
        .from(runtimeHostCommands)
        .where(
          and(
            eq(runtimeHostCommands.id, commandId),
            eq(runtimeHostCommands.runtimeHostId, hostId),
          ),
        )
        .for("update");
      if (
        !command ||
        (!recovering &&
          (!command.claimTokenHash ||
            !equalDigest(command.claimTokenHash, sha256(input.claimToken))))
      )
        throw forbidden("Invalid command claim");
      if (["SUCCEEDED", "FAILED"].includes(command.status))
        return { duplicate: true };
      if (
        !recovering &&
        (command.status !== "CLAIMED" ||
          !command.leaseUntil ||
          command.leaseUntil <= now ||
          command.deadlineAt <= now)
      )
        throw conflict("Command lease expired");
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, command.runtimeCellId!),
            eq(runtimeCells.companyId, command.companyId!),
            eq(runtimeCells.runtimeHostId, hostId),
            eq(runtimeCells.generation, BigInt(input.generation)),
          ),
        )
        .for("update");
      if (!cell || command.cellGeneration !== cell.generation)
        throw conflict("Stale runtime generation");
      const [operation] = await tx
        .select()
        .from(runtimeOperations)
        .where(eq(runtimeOperations.id, command.operationId!))
        .for("update");
      if (
        !operation ||
        operation.status !== (recovering ? "NEEDS_RECONCILIATION" : "RUNNING")
      )
        throw conflict("Operation is no longer active");
      const healthy = ["provision", "start", "upgrade"].includes(
        command.commandType,
      );
      if (
        input.success &&
        healthy &&
        (input.state !== "healthy" ||
          !input.evidence.gatewayHandshake ||
          !input.evidence.volumeMounted ||
          input.evidence.imageDigest !== command.payload.imageDigest)
      )
        throw unprocessable("Functional Gateway health evidence required");
      if (
        (input.success &&
          ["stop", "rotate_gateway"].includes(command.commandType) &&
          input.state !== "stopped") ||
        (input.success &&
          command.commandType === "delete" &&
          input.state !== "deleted")
      )
        throw unprocessable("Command state evidence mismatch");
      if (input.success && command.commandType === "backup") {
        if (
          input.state !== "backed_up" ||
          !input.evidence.backupSha256 ||
          !input.evidence.backupBytes ||
          !input.evidence.stateFormat
        )
          throw unprocessable("Backup integrity evidence required");
        const backup = await backups.get(
          cell.companyId,
          String(command.payload.backupId),
          tx,
        );
        const bytes = BigInt(input.evidence.backupBytes),
          maximum =
            BigInt(
              (command.payload.capacity as { diskBytes: string }).diskBytes,
            ) + 100000000n;
        if (
          backup.runtimeCellId !== cell.id ||
          backup.generation !== cell.generation ||
          backup.stateFormat !== input.evidence.stateFormat ||
          bytes < 32n ||
          bytes > maximum
        )
          throw unprocessable("Backup evidence scope or size mismatch");
        await tx
          .update(runtimeBackups)
          .set({
            status: "AVAILABLE",
            ciphertextSha256: input.evidence.backupSha256,
            byteSize: bytes,
            manifest: {
              format: "aw-state-archive-v1",
              companyId: cell.companyId,
              cellId: cell.id,
              generation: cell.generation.toString(),
              imageDigest: backup.imageDigest,
              stateFormat: backup.stateFormat,
            },
          })
          .where(eq(runtimeBackups.id, backup.id));
      }
      if (
        input.success &&
        ["restore", "migrate"].includes(command.commandType) &&
        (input.state !== "restored" ||
          !input.evidence.quarantined ||
          !input.evidence.credentialsRemoved)
      )
        throw unprocessable("Offline quarantine restore evidence required");
      if (
        !input.success &&
        command.commandType === "backup" &&
        typeof command.payload.backupId === "string"
      )
        await tx
          .update(runtimeBackups)
          .set({ status: "FAILED" })
          .where(
            and(
              eq(runtimeBackups.id, command.payload.backupId),
              eq(runtimeBackups.companyId, cell.companyId),
              eq(runtimeBackups.status, "REQUESTED"),
            ),
          );
      const status = input.success
        ? command.commandType === "delete"
          ? "DELETED"
          : command.commandType === "stop"
            ? "STOPPED"
            : healthy
              ? "HEALTHY"
              : "STOPPED"
        : "FAILED";
      if (["STOPPED", "DELETED", "FAILED"].includes(status))
        await meter(tx, cell, now);
      await tx
        .update(runtimeHostCommands)
        .set({
          status: input.success ? "SUCCEEDED" : "FAILED",
          safeResult: input.evidence,
          errorCode: input.errorCode ?? null,
          completedAt: now,
        })
        .where(eq(runtimeHostCommands.id, command.id));
      await tx
        .update(runtimeOperations)
        .set({
          status: input.success ? "SUCCEEDED" : "FAILED",
          errorCode: input.errorCode ?? null,
          completedAt: now,
          version: sql`${runtimeOperations.version}+1`,
          updatedAt: now,
        })
        .where(eq(runtimeOperations.id, operation.id));
      await tx
        .update(runtimeOperationAttempts)
        .set({
          status: input.success ? "succeeded" : "failed",
          completedAt: now,
          errorCode: input.errorCode ?? null,
        })
        .where(eq(runtimeOperationAttempts.commandId, command.id));
      await tx
        .update(runtimeCells)
        .set({
          status,
          lastErrorCode: input.errorCode ?? null,
          updatedAt: now,
          ...(healthy && input.success
            ? {
                activeImageDigest: input.evidence.imageDigest,
                activeSince: now,
                meteredThrough: now,
                lastHealthyAt: now,
              }
            : {}),
          ...(status === "DELETED" ? { deletedAt: now } : {}),
          ...(command.commandType === "backup" && input.success
            ? { lastBackupAt: now }
            : {}),
          ...(["STOPPED", "DELETED"].includes(status)
            ? { activeSince: null }
            : {}),
        })
        .where(eq(runtimeCells.id, cell.id));
      if (status === "DELETED") {
        const [profile] = await tx
          .select()
          .from(runtimeCapacityProfiles)
          .where(eq(runtimeCapacityProfiles.key, cell.capacityProfile))
          .limit(1);
        if (profile)
          await tx
            .update(runtimeHosts)
            .set({
              cpuReservedMillis: sql`${runtimeHosts.cpuReservedMillis}-${profile.cpuMillis}`,
              memoryReservedBytes: sql`${runtimeHosts.memoryReservedBytes}-${profile.memoryBytes.toString()}::bigint`,
              diskReservedBytes: sql`${runtimeHosts.diskReservedBytes}-${profile.diskBytes.toString()}::bigint`,
            })
            .where(eq(runtimeHosts.id, hostId));
      }
      await tx
        .insert(activityLog)
        .values({
          companyId: cell.companyId,
          actorType: "system",
          actorId: "runtime-host:" + hostId,
          action:
            "runtime.operation_" + (input.success ? "succeeded" : "failed"),
          entityType: "runtime_cell",
          entityId: cell.id,
          details: { operationId: operation.id, generation: input.generation },
        });
      if (notify && !input.success)
        await notify(
          cell.companyId,
          "runtime",
          "A managed runtime needs attention",
          "company/settings/runtime",
          operation.id + ":failed",
          tx,
        );
      return { duplicate: false };
    });
  }
  async function recoveryCommands(hostId: string) {
    return db
      .select({
        id: runtimeHostCommands.id,
        generation: runtimeHostCommands.cellGeneration,
      })
      .from(runtimeHostCommands)
      .innerJoin(
        runtimeOperations,
        eq(runtimeOperations.id, runtimeHostCommands.operationId),
      )
      .where(
        and(
          eq(runtimeHostCommands.runtimeHostId, hostId),
          eq(runtimeOperations.status, "NEEDS_RECONCILIATION"),
          inArray(runtimeHostCommands.status, ["CLAIMED", "EXPIRED"]),
        ),
      )
      .orderBy(runtimeHostCommands.createdAt)
      .limit(20)
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          generation: row.generation!.toString(),
        })),
      );
  }
  async function recordRecovery(
    hostId: string,
    commandId: string,
    raw: unknown,
    now = new Date(),
  ) {
    // This path accepts only a read-only replay of the host's fsynced terminal receipt; it never reissues work.
    if (!raw || typeof raw !== "object" || "claimToken" in raw)
      throw unprocessable("Invalid recovery receipt");
    return complete(
      hostId,
      commandId,
      { ...raw, claimToken: randomToken() },
      now,
      true,
    );
  }
  async function reconcileCommands(now = new Date()) {
    const candidates = await db
      .select({
        id: runtimeHostCommands.id,
        hostId: runtimeHostCommands.runtimeHostId,
      })
      .from(runtimeHostCommands)
      .innerJoin(
        runtimeOperations,
        eq(runtimeOperations.id, runtimeHostCommands.operationId),
      )
      .where(
        and(
          inArray(runtimeOperations.status, [
            "RUNNING",
            "NEEDS_RECONCILIATION",
          ]),
          inArray(runtimeHostCommands.status, [
            "CLAIMED",
            "PENDING",
            "EXPIRED",
          ]),
          or(
            lte(runtimeHostCommands.deadlineAt, now),
            and(
              sql`${runtimeHostCommands.attempt} >= 3`,
              lte(runtimeHostCommands.leaseUntil, now),
            ),
          ),
        ),
      )
      .orderBy(runtimeHostCommands.createdAt)
      .limit(20);
    for (const candidate of candidates)
      await db.transaction(async (tx) => {
        const [host] = await tx
          .select()
          .from(runtimeHosts)
          .where(eq(runtimeHosts.id, candidate.hostId))
          .for("update");
        const [command] = await tx
          .select()
          .from(runtimeHostCommands)
          .where(eq(runtimeHostCommands.id, candidate.id))
          .for("update");
        if (
          !host ||
          !command ||
          !["CLAIMED", "PENDING", "EXPIRED"].includes(command.status)
        )
          return;
        const [cell] = await tx
          .select()
          .from(runtimeCells)
          .where(eq(runtimeCells.id, command.runtimeCellId!))
          .for("update");
        const [operation] = await tx
          .select()
          .from(runtimeOperations)
          .where(eq(runtimeOperations.id, command.operationId!))
          .for("update");
        if (
          !cell ||
          !operation ||
          !["RUNNING", "NEEDS_RECONCILIATION"].includes(operation.status)
        )
          return;
        if (host.fencedAt) {
          await meter(tx, cell, host.fencedAt);
          await tx
            .update(runtimeOperations)
            .set({
              status: "FAILED",
              errorCode: "host_fenced_recovery_required",
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(runtimeOperations.id, operation.id));
          await tx
            .update(runtimeHostCommands)
            .set({
              status: "EXPIRED",
              errorCode: "host_fenced",
              completedAt: now,
            })
            .where(eq(runtimeHostCommands.id, command.id));
          await tx
            .update(runtimeCells)
            .set({
              status: "DEGRADED",
              activeSince: null,
              lastErrorCode: "host_fenced_recovery_required",
              updatedAt: now,
            })
            .where(eq(runtimeCells.id, cell.id));
          return;
        }
        if (operation.status === "NEEDS_RECONCILIATION") return;
        await tx
          .update(runtimeOperations)
          .set({
            status: "NEEDS_RECONCILIATION",
            errorCode: "command_outcome_unknown",
            updatedAt: now,
          })
          .where(eq(runtimeOperations.id, operation.id));
        await tx
          .update(runtimeHostCommands)
          .set({ status: "EXPIRED", errorCode: "command_outcome_unknown" })
          .where(eq(runtimeHostCommands.id, command.id));
        await tx
          .update(runtimeCells)
          .set({
            status: "DEGRADED",
            lastErrorCode: "command_outcome_unknown",
            updatedAt: now,
          })
          .where(eq(runtimeCells.id, cell.id));
        if (notify)
          await notify(
            cell.companyId,
            "runtime",
            "A runtime operation is being reconciled",
            "company/settings/runtime",
            operation.id + ":unknown",
            tx,
          );
      });
    return candidates.length;
  }
  async function heartbeat(hostId: string, raw: unknown, now = new Date()) {
    const input = runtimeHeartbeatSchema.parse(raw);
    return db.transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, hostId))
        .for("update");
      if (!host || host.fencedAt || host.credentialRevokedAt)
        throw forbidden("Host unavailable");
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
      const seen = new Set<string>();
      for (const sample of input.cells) {
        if (seen.has(sample.cellId))
          throw unprocessable("Duplicate inventory cell");
        seen.add(sample.cellId);
        const cell = cells.find(
          (c) =>
            c.id === sample.cellId &&
            c.companyId === sample.companyId &&
            c.generation === BigInt(sample.generation),
        );
        if (
          !cell ||
          (sample.imageDigest !== cell.activeImageDigest &&
            sample.imageDigest !== cell.desiredImageDigest)
        )
          throw forbidden("Inventory scope mismatch");
      }
      const missing = cells.some(
        (cell) => cell.status === "HEALTHY" && !seen.has(cell.id),
      );
      await tx
        .update(runtimeHosts)
        .set({
          hostAgentVersion: input.agentVersion,
          lastHeartbeatAt: now,
          lastInventory: input,
          status: missing
            ? "DEGRADED"
            : host.drainRequestedAt
              ? "DRAINING"
              : "READY",
          updatedAt: now,
        })
        .where(eq(runtimeHosts.id, hostId));
      for (const cell of cells) {
        const sample = input.cells.find((s) => s.cellId === cell.id);
        if (cell.status === "HEALTHY") {
          await meter(
            tx,
            cell,
            now,
            sample ? BigInt(sample.diskBytes) : undefined,
          );
          await tx
            .update(runtimeCells)
            .set({
              meteredThrough: now,
              ...(sample?.status === "healthy"
                ? { lastHealthyAt: now }
                : { status: "DEGRADED", lastErrorCode: "gateway_unhealthy" }),
            })
            .where(eq(runtimeCells.id, cell.id));
        }
      }
      return { accepted: true };
    });
  }
  async function configureModel(
    companyId: string,
    cellId: string,
    userId: string,
    raw: unknown,
  ) {
    const input = runtimeModelProviderSchema.parse(raw);
    await entitlementService(db).require(companyId, "platform.access");
    return db.transaction(async (tx) => {
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, cellId),
            eq(runtimeCells.companyId, companyId),
          ),
        )
        .for("update");
      if (
        !cell ||
        cell.deletedAt ||
        !["REQUESTED", "WAITING_FOR_CAPACITY", "STOPPED"].includes(cell.status)
      )
        throw conflict("Stop the runtime before changing model credentials");
      const [busy] = await tx
        .select()
        .from(runtimeOperations)
        .where(
          and(
            eq(runtimeOperations.runtimeCellId, cellId),
            inArray(runtimeOperations.status, ACTIVE_OPERATIONS),
          ),
        )
        .limit(1);
      if (
        busy &&
        !(
          busy.operationType === "provision" &&
          busy.attemptCount === 0 &&
          ["REQUESTED", "WAITING_FOR_CAPACITY"].includes(busy.status)
        )
      )
        throw conflict("A runtime operation is already active");
      const [secret] = await tx
        .select()
        .from(companySecrets)
        .where(
          and(
            eq(companySecrets.id, input.secretId),
            eq(companySecrets.companyId, companyId),
          ),
        )
        .for("share")
        .limit(1);
      if (!secret || (secret.ownerUserId && secret.ownerUserId !== userId))
        throw forbidden("Model credential is unavailable");
      await tx
        .update(runtimeCells)
        .set({
          modelProvider: input.provider,
          modelId: input.modelId,
          modelSecretRef: input.secretId,
          modelSecretVersion: secret.latestVersion,
          updatedAt: new Date(),
        })
        .where(eq(runtimeCells.id, cellId));
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "runtime.model_provider_configured",
          entityType: "runtime_cell",
          entityId: cellId,
          details: {
            provider: input.provider,
            modelId: input.modelId,
            secretId: input.secretId,
            secretVersion: secret.latestVersion,
          },
        });
      return {
        configured: true,
        provider: input.provider,
        modelId: input.modelId,
      };
    });
  }
  async function bind(
    companyId: string,
    cellId: string,
    agentId: string,
    actor: AuthorizationActor,
  ) {
    await assertV5Authorization(
      db,
      { ...actor, ignoreInstanceAdmin: true },
      companyId,
      "agents:configure",
      { type: "agent", companyId, agentId },
    );
    return db.transaction(async (tx) => {
      const transactionDb = tx as unknown as Db;
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, cellId),
            eq(runtimeCells.companyId, companyId),
          ),
        )
        .for("update");
      if (
        !cell ||
        cell.deletedAt ||
        cell.status !== "HEALTHY" ||
        cell.suspendedReason ||
        !cell.gatewaySecretRef
      )
        throw conflict("A healthy runtime is required");
      if (cell.dedicatedAgentId && cell.dedicatedAgentId !== agentId)
        throw forbidden("Dedicated runtime belongs to another agent");
      const [agent] = await tx
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
        .for("update");
      if (!agent || !["idle", "error", "paused"].includes(agent.status))
        throw conflict("An idle agent is required for attachment");
      const expectedUrl =
        "ws://127.0.0.1:" +
        (config.runtime.relayPort ?? 3102) +
        "/cells/" +
        cell.id +
        "/" +
        cell.generation.toString();
      if (cell.providerBindingId) {
        const attached = await agentProviderBindingService(
          transactionDb,
        ).getForPresence(actor, companyId, agentId);
        if (attached?.provider.id !== cell.providerBindingId)
          throw conflict("Runtime is already attached to another presence");
        if (agent.adapterConfig.url === expectedUrl) return attached;
        await tx
          .update(agentProviderBindings)
          .set({ status: "revoked", updatedAt: new Date() })
          .where(eq(agentProviderBindings.id, cell.providerBindingId));
        await tx
          .update(agentPresenceRuntimeBindings)
          .set({
            status: "revoked",
            qualifiedConfigurationHash: null,
            conformanceSnapshotHash: null,
            updatedAt: new Date(),
          })
          .where(
            eq(
              agentPresenceRuntimeBindings.providerBindingId,
              cell.providerBindingId,
            ),
          );
      }
      const secret = {
        type: "secret_ref",
        secretId: cell.gatewaySecretRef,
        version: "latest",
      };
      await agentService(transactionDb).update(agentId, {
        adapterType: "openclaw_gateway",
        adapterConfig: {
          url: expectedUrl,
          authToken: secret,
          headers: { "x-aw-relay-token": secret },
          agentId: "main",
        },
      });
      const bindings = agentProviderBindingService(transactionDb);
      const binding = await bindings.create(actor, companyId, agentId, {
        providerType: "openclaw",
        providerEndpointRef: null,
        providerAgentRef: "main",
        isolationMode: "isolated_per_presence",
      });
      const presence = await bindings.attach(actor, companyId, agentId, {
        providerBindingId: binding.id,
        providerProfileRef:
          "aw:cell:" + cell.id + ":generation:" + cell.generation.toString(),
      });
      await tx
        .update(runtimeCells)
        .set({ providerBindingId: binding.id, updatedAt: new Date() })
        .where(eq(runtimeCells.id, cell.id));
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: "user",
          actorId: actor.userId!,
          action: "runtime.provider_attached",
          entityType: "runtime_cell",
          entityId: cell.id,
          details: {
            agentId,
            bindingId: binding.id,
            conformanceRequired: true,
          },
        });
      return { provider: binding, runtime: presence };
    });
  }
  async function cancelUnplacedForDeletion(
    companyId: string,
    userId: string,
    now = new Date(),
  ) {
    return db.transaction(async (tx) => {
      const operations = await tx
        .select()
        .from(runtimeOperations)
        .where(
          and(
            eq(runtimeOperations.companyId, companyId),
            inArray(runtimeOperations.status, [
              "REQUESTED",
              "WAITING_FOR_CAPACITY",
            ]),
            eq(runtimeOperations.operationType, "provision"),
          ),
        )
        .for("update", { skipLocked: true });
      for (const operation of operations) {
        const [cell] = await tx
          .select()
          .from(runtimeCells)
          .where(
            and(
              eq(runtimeCells.id, operation.runtimeCellId),
              isNull(runtimeCells.runtimeHostId),
              isNull(runtimeCells.deletedAt),
            ),
          )
          .for("update");
        if (!cell) continue;
        const [command] = await tx
          .select({ id: runtimeHostCommands.id })
          .from(runtimeHostCommands)
          .where(eq(runtimeHostCommands.runtimeCellId, cell.id))
          .limit(1);
        if (command) continue;
        await tx
          .update(runtimeOperations)
          .set({
            status: "CANCELED",
            completedAt: now,
            errorCode: "company_deletion",
          })
          .where(eq(runtimeOperations.id, operation.id));
        await tx
          .update(runtimeCells)
          .set({
            status: "DELETED",
            deletedAt: now,
            updatedAt: now,
            lastErrorCode: null,
          })
          .where(eq(runtimeCells.id, cell.id));
        await tx
          .insert(activityLog)
          .values({
            companyId,
            actorType: "user",
            actorId: userId,
            action: "runtime.unplaced_erased",
            entityType: "runtime_cell",
            entityId: cell.id,
            details: { operationId: operation.id, neverDispatched: true },
          });
      }
    });
  }
  async function list(companyId: string) {
    return db
      .select()
      .from(runtimeCells)
      .where(eq(runtimeCells.companyId, companyId))
      .orderBy(runtimeCells.createdAt);
  }
  return {
    auth,
    backups,
    relay,
    getCell,
    create,
    request,
    dispatchOne,
    claim,
    renew,
    complete,
    heartbeat,
    recoveryCommands,
    recordRecovery,
    reconcileCommands,
    configureModel,
    bind,
    cancelUnplacedForDeletion,
    list,
  };
}
