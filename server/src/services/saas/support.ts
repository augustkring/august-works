import { runtimeControlService } from "../runtime/control.js";
import type { NotifyCompany } from "../notifications/notifications.js";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  activityLog,
  billingEntitlementOverrides,
  companyMemberships,
  platformAdminAudit,
  runtimeCells,
  supportSessions,
  type Db,
} from "@paperclipai/db";
import {
  EMPTY_ENTITLEMENTS,
  supportSessionSchema,
  entitlementOverrideSchema,
  runtimeOperationSchema,
  runtimeCellCreateSchema,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { sha256 } from "./crypto.js";

export function saasSupportService(
  db: Db,
  config: SaasPlatformConfig,
  notify?: NotifyCompany,
) {
  function operator(userId: string) {
    if (!config.operatorUserIds.includes(userId))
      throw forbidden("Internal operator access required");
  }
  async function owner(
    companyId: string,
    userId: string,
    reader: Pick<Db, "select"> = db,
    lock = false,
  ) {
    const query = reader
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.membershipRole, "owner"),
          eq(companyMemberships.status, "active"),
        ),
      )
      .limit(1);
    const [membership] = await (lock ? query.for("share") : query);

    if (!membership) throw forbidden("Company owner approval required");
  }
  async function approve(
    companyId: string,
    userId: string,
    raw: unknown,
    now = new Date(),
  ) {
    const input = supportSessionSchema.parse(raw);
    operator(input.operatorUserId);
    if (input.companyId !== companyId || input.operatorUserId === userId)
      throw forbidden("Independent company owner approval required");
    return db.transaction(async (tx) => {
      await owner(companyId, userId, tx, true);
      const [session] = await tx
        .insert(supportSessions)
        .values({
          companyId,
          operatorUserId: input.operatorUserId,
          approvedByUserId: userId,
          reason: input.reason,
          scopes: [...new Set(input.scopes)],
          createdAt: now,
          expiresAt: new Date(now.getTime() + input.expiresInMinutes * 60000),
        })
        .returning();
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "support.access_approved",
          entityType: "support_session",
          entityId: session!.id,
          details: {
            operatorUserId: input.operatorUserId,
            scopes: session!.scopes,
            expiresAt: session!.expiresAt.toISOString(),
          },
        });
      if (notify)
        await notify(
          companyId,
          "security",
          "Support access has been approved",
          "company/settings/support",
          session!.id + ":approved",
          tx,
        );
      return session!;
    });
  }
  async function authorize(
    sessionId: string,
    userId: string,
    scope: string,
    now = new Date(),
    reader: Pick<Db, "select"> = db,
    lock = false,
  ) {
    operator(userId);
    const query = reader
      .select()
      .from(supportSessions)
      .where(
        and(
          eq(supportSessions.id, sessionId),
          eq(supportSessions.operatorUserId, userId),
          isNull(supportSessions.revokedAt),
          gt(supportSessions.expiresAt, now),
        ),
      )
      .limit(1);
    const [session] = await (lock ? query.for("update") : query);
    if (!session || !session.scopes.includes(scope))
      throw forbidden("Active scoped support approval required");
    await owner(session.companyId, session.approvedByUserId, reader, lock);
    return session;
  }
  async function revoke(
    companyId: string,
    userId: string,
    id: string,
    now = new Date(),
  ) {
    return db.transaction(async (tx) => {
      await owner(companyId, userId, tx, true);
      const [session] = await tx
        .update(supportSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(supportSessions.id, id),
            eq(supportSessions.companyId, companyId),
          ),
        )
        .returning();
      if (!session) throw notFound();
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "support.access_revoked",
          entityType: "support_session",
          entityId: id,
        });
      return session;
    });
  }
  async function list(companyId: string, userId: string) {
    await owner(companyId, userId);
    return db
      .select()
      .from(supportSessions)
      .where(eq(supportSessions.companyId, companyId))
      .orderBy(supportSessions.createdAt);
  }
  async function status(sessionId: string, userId: string) {
    return db.transaction(async (tx) => {
      const session = await authorize(
        sessionId,
        userId,
        "status:read",
        new Date(),
        tx,
        true,
      );
      const cells = await tx
        .select({
          id: runtimeCells.id,
          status: runtimeCells.status,
          lastHealthyAt: runtimeCells.lastHealthyAt,
          lastErrorCode: runtimeCells.lastErrorCode,
          generation: runtimeCells.generation,
        })
        .from(runtimeCells)
        .where(eq(runtimeCells.companyId, session.companyId));
      await tx
        .insert(platformAdminAudit)
        .values({
          companyId: session.companyId,
          operatorUserId: userId,
          supportSessionId: session.id,
          action: "support.status_read",
          resourceId: session.companyId,
        });
      return { companyId: session.companyId, runtimes: cells };
    });
  }
  async function override(
    sessionId: string,
    userId: string,
    raw: unknown,
    now = new Date(),
  ) {
    const input = entitlementOverrideSchema.parse(raw),
      expiry = new Date(input.expiresAt);
    if (expiry <= now || expiry.getTime() > now.getTime() + 30 * 86400000)
      throw unprocessable("Override must expire within thirty days");
    if (
      (typeof EMPTY_ENTITLEMENTS[input.key] === "boolean") !==
        (typeof input.value === "boolean") ||
      (typeof input.value === "string" && input.value.length > 40)
    )
      throw unprocessable("Override value does not match entitlement type");
    return db.transaction(async (tx) => {
      const session = await authorize(
        sessionId,
        userId,
        "billing:override",
        now,
        tx,
        true,
      );
      if (session.companyId !== input.companyId)
        throw forbidden("Support company scope mismatch");
      const hex = sha256(session.id + ":" + input.idempotencyKey);
      const id =
        hex.slice(0, 8) +
        "-" +
        hex.slice(8, 12) +
        "-4" +
        hex.slice(13, 16) +
        "-8" +
        hex.slice(17, 20) +
        "-" +
        hex.slice(20, 32);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"aw-override:" + id},0))`,
      );
      const [existing] = await tx
        .select()
        .from(billingEntitlementOverrides)
        .where(eq(billingEntitlementOverrides.id, id))
        .limit(1);
      if (existing) {
        if (
          existing.entitlementKey !== input.key ||
          existing.value !== input.value ||
          existing.reason !== input.reason ||
          existing.expiresAt.getTime() !== expiry.getTime()
        )
          throw conflict("Idempotency key has a different override");
        return existing;
      }
      const [record] = await tx
        .insert(billingEntitlementOverrides)
        .values({
          id,
          companyId: input.companyId,
          entitlementKey: input.key,
          value: input.value,
          reason: input.reason,
          startsAt: now,
          expiresAt: expiry,
          createdByUserId: userId,
        })
        .returning();
      await tx
        .insert(platformAdminAudit)
        .values({
          companyId: input.companyId,
          operatorUserId: userId,
          supportSessionId: session.id,
          action: "billing.entitlement_override",
          resourceId: id,
          safeDetails: {
            key: input.key,
            value: input.value,
            reason: input.reason,
            expiresAt: input.expiresAt,
          },
        });
      await tx
        .insert(activityLog)
        .values({
          companyId: input.companyId,
          actorType: "user",
          actorId: userId,
          action: "billing.entitlement_override",
          entityType: "billing_override",
          entityId: id,
          details: {
            supportSessionId: session.id,
            key: input.key,
            expiresAt: input.expiresAt,
          },
        });
      return record!;
    });
  }
  async function runtimeAction(
    sessionId: string,
    userId: string,
    cellId: string,
    raw: unknown,
    now = new Date(),
  ) {
    const input = runtimeOperationSchema.parse(raw);
    if (["delete", "migrate"].includes(input.action))
      throw forbidden(
        "Destructive erasure and host migration require the company or fleet workflow",
      );
    return db.transaction(async (tx) => {
      const session = await authorize(
        sessionId,
        userId,
        input.action === "restore" ? "backup:restore" : "runtime:manage",
        now,
        tx,
        true,
      );
      const control = runtimeControlService(tx as unknown as Db, config);
      const operation = await control.request(
        session.companyId,
        cellId,
        userId,
        input,
        now,
      );
      await tx
        .insert(platformAdminAudit)
        .values({
          companyId: session.companyId,
          operatorUserId: userId,
          supportSessionId: session.id,
          action: "support.runtime_" + input.action,
          resourceId: operation.id,
          safeDetails: { cellId },
        });
      await tx
        .insert(activityLog)
        .values({
          companyId: session.companyId,
          actorType: "user",
          actorId: userId,
          action: "support.runtime_" + input.action,
          entityType: "runtime_cell",
          entityId: cellId,
          details: { supportSessionId: session.id, operationId: operation.id },
        });
      return operation;
    });
  }
  async function canaryRuntime(
    sessionId: string,
    userId: string,
    raw: unknown,
    now = new Date(),
  ) {
    const input = runtimeCellCreateSchema.parse(raw);
    return db.transaction(async (tx) => {
      const session = await authorize(
        sessionId,
        userId,
        "runtime:manage",
        now,
        tx,
        true,
      );
      const result = await runtimeControlService(
        tx as unknown as Db,
        config,
      ).create(session.companyId, userId, input, now, userId);
      await tx
        .insert(platformAdminAudit)
        .values({
          companyId: session.companyId,
          operatorUserId: userId,
          supportSessionId: session.id,
          action: "runtime.canary_requested",
          resourceId: result.operation.id,
          safeDetails: {
            imageDigest: input.imageDigest,
            cellId: result.cell.id,
          },
        });
      return result;
    });
  }
  async function backupStatus(
    sessionId: string,
    userId: string,
    cellId: string,
  ) {
    return db.transaction(async (tx) => {
      const session = await authorize(
        sessionId,
        userId,
        "backup:restore",
        new Date(),
        tx,
        true,
      );
      const control = runtimeControlService(tx as unknown as Db, config);
      await control.getCell(session.companyId, cellId);
      const backups = await control.backups.list(session.companyId, cellId);
      await tx
        .insert(platformAdminAudit)
        .values({
          companyId: session.companyId,
          operatorUserId: userId,
          supportSessionId: session.id,
          action: "support.backup_status_read",
          resourceId: cellId,
        });
      return backups;
    });
  }
  return {
    operator,
    approve,
    authorize,
    revoke,
    list,
    status,
    override,
    runtimeAction,
    backupStatus,
    canaryRuntime,
  };
}
