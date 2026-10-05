import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  activityLog,
  companies,
  companyMemberships,
  runtimeBackupPolicies,
  runtimeBackups,
  runtimeCells,
  runtimeOperations,
  type Db,
} from "@paperclipai/db";
import { runtimeBackupPolicySchema } from "@paperclipai/shared";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { HttpError, conflict, forbidden, notFound } from "../../errors.js";
import { accessService } from "../access.js";
import { entitlementService } from "../billing/entitlements.js";
import type { NotifyCompany } from "../notifications/notifications.js";
import { runtimeControlService } from "./control.js";

/** Explicit customer consent permits a brief stop/snapshot/resume window. Agent pause state is never changed. */
export function runtimeBackupSchedule(
  db: Db,
  config: SaasPlatformConfig,
  notify?: NotifyCompany,
) {
  async function authorized(
    reader: Pick<Db, "select">,
    companyId: string,
    userId: string,
  ) {
    const [member] = await reader
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"),
        ),
      )
      .for("share");
    return Boolean(
      member &&
        (member.membershipRole === "owner" ||
          member.membershipRole === "admin" ||
          (await accessService(reader as Db).canUser(
            companyId,
            userId,
            "runtime:manage",
          ))),
    );
  }
  async function get(companyId: string, cellId: string) {
    const [cell] = await db
      .select({ id: runtimeCells.id })
      .from(runtimeCells)
      .where(
        and(eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, cellId)),
      )
      .limit(1);
    if (!cell) throw notFound();
    const [policy] = await db
      .select()
      .from(runtimeBackupPolicies)
      .where(eq(runtimeBackupPolicies.runtimeCellId, cellId))
      .limit(1);
    return policy ?? null;
  }
  async function configure(
    companyId: string,
    cellId: string,
    userId: string,
    raw: unknown,
    now = new Date(),
  ) {
    const input = runtimeBackupPolicySchema.parse(raw);
    return db.transaction(async (tx) => {
      if (!(await authorized(tx, companyId, userId)))
        throw forbidden("Runtime management permission required");
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.companyId, companyId),
            eq(runtimeCells.id, cellId),
            isNull(runtimeCells.deletedAt),
          ),
        )
        .limit(1);
      if (!cell) throw notFound();
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"aw-backup-policy:" + cellId},0))`,
      );
      const [previous] = await tx
        .select()
        .from(runtimeBackupPolicies)
        .where(eq(runtimeBackupPolicies.runtimeCellId, cellId))
        .for("update");
      if (input.expectedVersion !== (previous?.version ?? 0))
        throw conflict("Backup schedule changed; reload it");
      if (previous?.phase !== "idle" && previous && input.enabled)
        throw conflict(
          "Let the current backup window finish before changing its schedule",
        );
      const values = {
        companyId,
        runtimeCellId: cellId,
        createdByUserId: userId,
        enabled: input.enabled,
        allowBriefPause: input.allowBriefPause,
        intervalHours: input.intervalHours,
        version: (previous?.version ?? 0) + 1,
        updatedAt: now,
        nextDueAt:
          previous?.nextDueAt ??
          new Date(now.getTime() + input.intervalHours * 3600000),
        notBefore: now,
      };
      const [policy] = await tx
        .insert(runtimeBackupPolicies)
        .values(values)
        .onConflictDoUpdate({
          target: runtimeBackupPolicies.runtimeCellId,
          set: values,
        })
        .returning();
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "runtime.backup_schedule_configured",
          entityType: "runtime_cell",
          entityId: cellId,
          details: {
            enabled: input.enabled,
            allowBriefPause: input.allowBriefPause,
            intervalHours: input.intervalHours,
            version: policy!.version,
          },
        });
      return policy!;
    });
  }
  async function tick(now = new Date(), admitResume = true) {
    return db.transaction(async (tx) => {
      const [policy] = await tx
        .select()
        .from(runtimeBackupPolicies)
        .where(
          and(
            lte(runtimeBackupPolicies.notBefore, now),
            sql`(${runtimeBackupPolicies.phase}<>'idle' or (${runtimeBackupPolicies.enabled}=true and ${runtimeBackupPolicies.nextDueAt}<=${now.toISOString()}::timestamptz))`,
          ),
        )
        .orderBy(
          runtimeBackupPolicies.notBefore,
          runtimeBackupPolicies.runtimeCellId,
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (!policy) return false;
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(eq(runtimeCells.id, policy.runtimeCellId))
        .limit(1);
      const [company] = await tx
        .select({ status: companies.status })
        .from(companies)
        .where(eq(companies.id, policy.companyId))
        .limit(1);
      async function finish(
        errorCode: string | null,
        success = false,
        disabled = false,
      ) {
        await tx
          .update(runtimeBackupPolicies)
          .set({
            phase: "idle",
            operationId: null,
            cycleId: null,
            cycleGeneration: null,
            resumeAfterBackup: false,
            errorCode,
            ...(disabled ? { enabled: false } : {}),
            ...(success ? { lastSuccessAt: now } : {}),
            nextDueAt: new Date(now.getTime() + policy.intervalHours * 3600000),
            notBefore: now,
            updatedAt: now,
          })
          .where(eq(runtimeBackupPolicies.runtimeCellId, policy.runtimeCellId));
        await tx
          .insert(activityLog)
          .values({
            companyId: policy.companyId,
            actorType: "system",
            actorId: "backup-scheduler",
            action: success
              ? "runtime.scheduled_backup_completed"
              : "runtime.scheduled_backup_stopped",
            entityType: "runtime_cell",
            entityId: policy.runtimeCellId,
            details: { cycleId: policy.cycleId, errorCode },
          });
        if (errorCode && notify)
          await notify(
            policy.companyId,
            "runtime",
            "A scheduled runtime backup needs attention",
            "company/settings/runtime",
            policy.runtimeCellId +
              ":" +
              (policy.cycleId ?? now.toISOString().slice(0, 10)) +
              ":" +
              errorCode,
            tx,
          );
      }
      if (
        !cell ||
        cell.deletedAt ||
        company?.status !== "active" ||
        !(await authorized(tx, policy.companyId, policy.createdByUserId))
      ) {
        await finish("backup_schedule_authority_unavailable", false, true);
        return true;
      }
      if (
        policy.phase !== "idle" &&
        cell.generation !== policy.cycleGeneration
      ) {
        await finish("backup_schedule_generation_changed");
        return true;
      }
      await tx
        .update(runtimeBackupPolicies)
        .set({ notBefore: new Date(now.getTime() + 10000) })
        .where(eq(runtimeBackupPolicies.runtimeCellId, cell.id));
      const control = runtimeControlService(
        tx as unknown as Db,
        config,
        notify,
      );
      async function request(
        action: "stop" | "backup" | "start",
        cycleId: string,
        phase: string,
      ) {
        try {
          const operation = await control.request(
            cell!.companyId,
            cell!.id,
            policy.createdByUserId,
            {
              action,
              idempotencyKey: "scheduled-backup:" + cycleId + ":" + action,
            },
            now,
            "backup-scheduler",
          );
          await tx
            .update(runtimeBackupPolicies)
            .set({ phase, operationId: operation.id, updatedAt: now })
            .where(eq(runtimeBackupPolicies.runtimeCellId, cell!.id));
        } catch (error) {
          if (
            !(error instanceof HttpError) ||
            ![403, 404, 409, 422].includes(error.status)
          )
            throw error;
          // Request admission is a database-only savepoint. A rejected window
          // must not roll back its backoff and starve all other due policies.
          await finish("scheduled_backup_request_unavailable");
        }
      }
      if (policy.phase === "idle") {
        const [busy] = await tx
          .select({ id: runtimeOperations.id })
          .from(runtimeOperations)
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
          )
          .limit(1);
        if (busy) return true;
        if (
          !["STOPPED", "HEALTHY"].includes(cell.status) ||
          (cell.status === "HEALTHY" && !policy.allowBriefPause)
        ) {
          await tx
            .update(runtimeBackupPolicies)
            .set({
              errorCode: "backup_window_required",
              notBefore: new Date(now.getTime() + 3600000),
            })
            .where(eq(runtimeBackupPolicies.runtimeCellId, cell.id));
          if (notify)
            await notify(
              cell.companyId,
              "runtime",
              "Stop the runtime or approve a brief pause for its scheduled backup",
              "company/settings/runtime",
              cell.id + ":window:" + now.toISOString().slice(0, 10),
              tx,
            );
          return true;
        }
        if (cell.status === "HEALTHY") {
          const state = await entitlementService(tx as unknown as Db).resolve(
            cell.companyId,
            now,
          );
          if (
            !admitResume ||
            cell.suspendedReason ||
            state.access !== "active" ||
            state.entitlements["hosted_runtime.provision"] !== true
          ) {
            await tx
              .update(runtimeBackupPolicies)
              .set({
                errorCode: "backup_resume_unavailable",
                notBefore: new Date(now.getTime() + 3600000),
              })
              .where(eq(runtimeBackupPolicies.runtimeCellId, cell.id));
            return true;
          }
        }
        const cycleId = randomUUID();
        await tx
          .update(runtimeBackupPolicies)
          .set({
            cycleId,
            cycleGeneration: cell.generation,
            resumeAfterBackup: cell.status === "HEALTHY",
            errorCode: null,
          })
          .where(eq(runtimeBackupPolicies.runtimeCellId, cell.id));
        await request(
          cell.status === "HEALTHY" ? "stop" : "backup",
          cycleId,
          cell.status === "HEALTHY" ? "await_stop" : "await_backup",
        );
        return true;
      }
      const [operation] = policy.operationId
        ? await tx
            .select()
            .from(runtimeOperations)
            .where(
              and(
                eq(runtimeOperations.id, policy.operationId),
                eq(runtimeOperations.runtimeCellId, cell.id),
              ),
            )
            .limit(1)
        : [];
      if (!operation || ["FAILED", "CANCELED"].includes(operation.status)) {
        await finish("scheduled_backup_operation_failed");
        return true;
      }
      if (operation.status !== "SUCCEEDED") return true;
      if (!policy.enabled) {
        await finish("scheduled_backup_disabled");
        return true;
      }
      if (policy.phase === "await_stop") {
        if (cell.status !== "STOPPED") {
          await finish("scheduled_backup_stop_unconfirmed");
          return true;
        }
        await request("backup", policy.cycleId!, "await_backup");
        return true;
      }
      if (policy.phase === "await_backup") {
        const [backup] = await tx
          .select()
          .from(runtimeBackups)
          .where(
            and(
              eq(runtimeBackups.runtimeCellId, cell.id),
              eq(runtimeBackups.id, String(operation.desiredState.backupId)),
            ),
          )
          .limit(1);
        if (!backup || ["FAILED", "DELETED"].includes(backup.status)) {
          await finish("scheduled_backup_verification_failed");
          return true;
        }
        if (backup.status !== "VERIFIED") return true;
        const state = await entitlementService(tx as unknown as Db).resolve(
          cell.companyId,
          now,
        );
        if (
          policy.resumeAfterBackup &&
          policy.allowBriefPause &&
          admitResume &&
          !cell.suspendedReason &&
          state.access === "active" &&
          state.entitlements["hosted_runtime.provision"] === true
        ) {
          if (cell.status !== "STOPPED") {
            await finish("scheduled_backup_resume_state_changed");
            return true;
          }
          await request("start", policy.cycleId!, "await_start");
          return true;
        }
        await finish(null, true);
        return true;
      }
      if (policy.phase === "await_start") {
        await finish(
          cell.status === "HEALTHY"
            ? null
            : "scheduled_backup_resume_unconfirmed",
          cell.status === "HEALTHY",
        );
        return true;
      }
      throw conflict("Invalid backup schedule phase");
    });
  }
  return { get, configure, tick };
}
