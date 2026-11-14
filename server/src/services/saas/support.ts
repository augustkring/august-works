import { runtimeControlService } from "../runtime/control.js";
import type { NotifyCompany } from "../notifications/notifications.js";
import { and, eq, isNull, sql } from "drizzle-orm";
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
  v6FeatureEnabled,
  nativeSupportReviewSchema,
  supportSessionSchema,
  prepareSupportApprovalSchema,
  entitlementOverrideSchema,
  runtimeOperationSchema,
  runtimeCellCreateSchema,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { sha256 } from "./crypto.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { instanceSettingsService } from "../instance-settings.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertConfiguredOperatorAuthentication } from "../../auth/authenticator-assurance.js";

export async function assertNativeSupportOwner(
  reader: Pick<Db, "select">,
  companyId: string,
  userId: string,
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
    return assertNativeSupportOwner(reader, companyId, userId, lock);
  }
  async function supportRollout(tx: Db) {
    await tx.execute(
      sql`select singleton_key from instance_settings where singleton_key='default' for share`,
    );
    if (
      !v6FeatureEnabled(
        await instanceSettingsService(tx).getExperimental(),
        "admin_support_v6",
      )
    )
      throw notFound();
  }
  async function originalApprovalReceipt(
    tx: Pick<Db, "select">,
    original: typeof supportSessions.$inferSelect,
  ) {
    const receipts = await tx
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, original.companyId),
          eq(activityLog.entityType, "support_session"),
          eq(activityLog.entityId, original.id),
          eq(activityLog.action, "support.access_approved"),
        ),
      )
      .limit(2)
      .for("share");
    const receipt = receipts[0];
    if (
      receipts.length !== 1 ||
      receipt?.actorType !== "user" ||
      receipt.actorId !== original.approvedByUserId ||
      receipt.details?.operatorUserId !== original.operatorUserId ||
      receipt.details?.expiresAt !== original.expiresAt.toISOString() ||
      !Array.isArray(receipt.details?.scopes) ||
      JSON.stringify([...receipt.details.scopes].sort()) !==
        JSON.stringify([...original.scopes].sort())
    )
      throw conflict("Original support approval receipt is unavailable", {
        code: "SUPPORT_APPROVAL_UNCONFIRMED",
      });
  }
  type ApprovalInput = ReturnType<typeof supportSessionSchema.parse>;
  function approvalHash(userId: string, input: ApprovalInput) {
    return sha256(
      JSON.stringify([
        "native-support-review:v1",
        input.companyId,
        userId,
        input.approvalId,
        input.operatorUserId,
        input.reason,
        [...new Set(input.scopes)].sort(),
        input.expiresInMinutes,
      ]),
    );
  }
  async function approvalReferenceLock(tx: Db, id: string) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`support:approval:${id}`}, 0))`,
    );
  }
  async function reviewRecord(
    tx: Pick<Db, "select">,
    companyId: string,
    userId: string,
    id: string,
  ) {
    const rows = await tx
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityType, "support_session"),
          eq(activityLog.entityId, id),
          eq(activityLog.action, "support.approval_reviewed"),
        ),
      )
      .limit(2)
      .for("update");
    const row = rows[0];
    if (
      rows.length !== 1 ||
      row?.companyId !== companyId ||
      row.actorType !== "user" ||
      row.actorId !== userId ||
      typeof row.details?.requestHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.details.requestHash)
    )
      throw conflict("Original support review is unavailable", {
        code: "SUPPORT_REVIEW_UNCONFIRMED",
      });
    return row;
  }
  async function reviewCancelled(
    tx: Pick<Db, "select">,
    review: typeof activityLog.$inferSelect,
  ) {
    const rows = await tx
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityType, "support_session"),
          eq(activityLog.entityId, review.entityId),
          eq(activityLog.action, "support.approval_cancelled"),
        ),
      )
      .limit(2)
      .for("share");
    if (
      rows.length > 1 ||
      (rows[0] &&
        (rows[0].companyId !== review.companyId ||
          rows[0].actorType !== "user" ||
          rows[0].actorId !== review.actorId ||
          rows[0].details?.requestHash !== review.details?.requestHash))
    )
      throw conflict("Original support cancellation is unavailable", {
        code: "SUPPORT_REVIEW_UNCONFIRMED",
      });
    return !!rows[0];
  }
  async function unresolvedReview(
    tx: Pick<Db, "select">,
    companyId: string,
    userId: string,
  ) {
    const rows = await tx
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.actorType, "user"),
          eq(activityLog.actorId, userId),
          eq(activityLog.entityType, "support_session"),
          eq(activityLog.action, "support.approval_reviewed"),
          sql`not exists (select 1 from support_sessions s where s.id::text=${activityLog.entityId} and s.company_id=${activityLog.companyId}
        and s.approved_by_user_id=${activityLog.actorId}
        and (select count(*) from activity_log a where a.entity_type='support_session' and a.entity_id=s.id::text and a.action='support.access_approved')=1
        and exists (select 1 from activity_log a where a.entity_type='support_session' and a.entity_id=s.id::text and a.action='support.access_approved'
          and a.company_id=s.company_id and a.actor_type='user' and a.actor_id=s.approved_by_user_id
          and a.details->>'operatorUserId'=s.operator_user_id and a.details->'scopes'=s.scopes
          and a.details->>'expiresAt'=to_char(s.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`,
          sql`not exists (select 1 from activity_log c where c.company_id=${activityLog.companyId} and c.actor_type='user'
        and c.actor_id=${activityLog.actorId} and c.entity_type='support_session' and c.entity_id=${activityLog.entityId}
        and c.action='support.approval_cancelled' and c.details->>'requestHash'=${activityLog.details}->>'requestHash'
        and (select count(*) from activity_log all_cancel where all_cancel.entity_type='support_session'
          and all_cancel.entity_id=${activityLog.entityId} and all_cancel.action='support.approval_cancelled')=1)`,
        ),
      )
      .limit(2)
      .for("share");
    if (rows.length > 1)
      throw conflict("Unresolved support reviews require inspection", {
        code: "SUPPORT_REVIEW_UNCONFIRMED",
      });
    return rows[0] ?? null;
  }
  function reviewReceipt(
    review: typeof activityLog.$inferSelect,
    state: "pending" | "cancelled" | "recorded",
  ) {
    return nativeSupportReviewSchema.parse({
      companyId: review.companyId,
      approvalId: review.entityId,
      reviewedAt: review.createdAt.toISOString(),
      state,
    });
  }
  async function prepareApproval(
    companyId: string,
    userId: string,
    raw: unknown,
  ) {
    const input = prepareSupportApprovalSchema.parse(raw);
    operator(input.operatorUserId);
    if (input.companyId !== companyId || input.operatorUserId === userId)
      throw forbidden("Independent company owner approval required");
    const id = input.approvalId,
      requestHash = approvalHash(userId, input);
    return db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Db;
      await tx.execute(sql`set local statement_timeout='5s'`);
      await supportRollout(tx);
      await lockMemoryPrivacy(tx, companyId);
      await owner(companyId, userId, tx, true);
      await approvalReferenceLock(tx, id);
      const existing = await tx
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityType, "support_session"),
            eq(activityLog.entityId, id),
            eq(activityLog.action, "support.approval_reviewed"),
          ),
        )
        .limit(2)
        .for("update");
      if (existing.length) {
        const original = await reviewRecord(tx, companyId, userId, id);
        if (original.details?.requestHash !== requestHash)
          throw conflict("Original support review changed", {
            code: "SUPPORT_APPROVAL_CHANGED",
          });
        const cancelled = await reviewCancelled(tx, original);
        const [grant] = await tx
          .select()
          .from(supportSessions)
          .where(eq(supportSessions.id, id))
          .limit(1)
          .for("share");
        if (
          grant &&
          (grant.companyId !== companyId ||
            grant.approvedByUserId !== userId ||
            cancelled)
        )
          throw conflict("Original support review changed");
        if (grant) await originalApprovalReceipt(tx, grant);
        return reviewReceipt(
          original,
          grant ? "recorded" : cancelled ? "cancelled" : "pending",
        );
      }
      if (await unresolvedReview(tx, companyId, userId))
        throw conflict(
          "Resolve the original support review before preparing another",
          { code: "SUPPORT_REVIEW_PENDING" },
        );
      const [grant] = await tx
        .select()
        .from(supportSessions)
        .where(eq(supportSessions.id, id))
        .limit(1)
        .for("share");
      if (grant)
        throw conflict("Original support reference already exists", {
          code: "SUPPORT_APPROVAL_CHANGED",
        });
      const [review] = await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "support.approval_reviewed",
          entityType: "support_session",
          entityId: id,
          details: { requestHash },
        })
        .returning();
      await owner(companyId, userId, tx, true);
      return reviewReceipt(review!, "pending");
    });
  }
  async function pendingApproval(companyId: string, userId: string) {
    return db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Db;
      await tx.execute(sql`set local statement_timeout='5s'`);
      await supportRollout(tx);
      await lockMemoryPrivacy(tx, companyId);
      await owner(companyId, userId, tx, true);
      const review = await unresolvedReview(tx, companyId, userId);
      if (review) await reviewRecord(tx, companyId, userId, review.entityId);
      await owner(companyId, userId, tx, true);
      return review ? reviewReceipt(review, "pending") : null;
    });
  }
  async function cancelApproval(companyId: string, userId: string, id: string) {
    return db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Db;
      await tx.execute(sql`set local statement_timeout='5s'`);
      // Cancelling an ungranted original command survives rollout disablement.
      await lockMemoryPrivacy(tx, companyId);
      await owner(companyId, userId, tx, true);
      await approvalReferenceLock(tx, id);
      const review = await reviewRecord(tx, companyId, userId, id);
      const [grant] = await tx
        .select()
        .from(supportSessions)
        .where(eq(supportSessions.id, id))
        .limit(1)
        .for("share");
      if (grant) {
        if (grant.companyId !== companyId || grant.approvedByUserId !== userId)
          throw conflict("Original support reference changed");
        if (await reviewCancelled(tx, review))
          throw conflict("Original support review is inconsistent");
        await originalApprovalReceipt(tx, grant);
        return reviewReceipt(review, "recorded");
      }
      if (!(await reviewCancelled(tx, review)))
        await tx.insert(activityLog).values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "support.approval_cancelled",
          entityType: "support_session",
          entityId: id,
          details: { requestHash: review.details!.requestHash },
        });
      await owner(companyId, userId, tx, true);
      return reviewReceipt(review, "cancelled");
    });
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
      await tx.execute(sql`set local statement_timeout='5s'`);
      if (input.approvalId) await supportRollout(tx as unknown as Db);
      await lockMemoryPrivacy(tx as unknown as Db, companyId);
      await owner(companyId, userId, tx, true);
      if (input.approvalId) {
        // Global Native PK, not a second receipt/permission store. The same
        // reference serializes even if a caller changes its company context.
        await approvalReferenceLock(tx as unknown as Db, input.approvalId);
        const review = await reviewRecord(
          tx,
          companyId,
          userId,
          input.approvalId,
        );
        if (review.details?.requestHash !== approvalHash(userId, input))
          throw conflict(
            "Original support approval does not match this request",
            { code: "SUPPORT_APPROVAL_CHANGED" },
          );
        if (await reviewCancelled(tx, review))
          throw conflict("Original support approval was cancelled", {
            code: "SUPPORT_APPROVAL_CANCELLED",
          });
        const [original] = await tx
          .select()
          .from(supportSessions)
          .where(eq(supportSessions.id, input.approvalId))
          .limit(1)
          .for("update");
        if (original) {
          const scopes = [...new Set(input.scopes)].sort();
          if (
            original.companyId !== companyId ||
            original.approvedByUserId !== userId ||
            original.operatorUserId !== input.operatorUserId ||
            original.reason !== input.reason ||
            JSON.stringify([...original.scopes].sort()) !==
              JSON.stringify(scopes) ||
            original.expiresAt.getTime() - original.createdAt.getTime() !==
              input.expiresInMinutes * 60000
          )
            throw conflict(
              "Original support approval does not match this request",
              { code: "SUPPORT_APPROVAL_CHANGED" },
            );
          await originalApprovalReceipt(tx, original);
          await owner(companyId, userId, tx, true);
          // Expiry/revocation is retained. Replaying is never a renewal or grant.
          return original;
        }
      }
      const [session] = await tx
        .insert(supportSessions)
        .values({
          ...(input.approvalId ? { id: input.approvalId } : {}),
          companyId,
          operatorUserId: input.operatorUserId,
          approvedByUserId: userId,
          reason: input.reason,
          scopes: [...new Set(input.scopes)],
          createdAt: now,
          expiresAt: new Date(now.getTime() + input.expiresInMinutes * 60000),
        })
        .returning();
      await tx.insert(activityLog).values({
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
    actor: AuthorizationActor,
    scope: string,
    _now = new Date(),
    reader: Pick<Db, "select" | "execute"> = db,
    lock = false,
    requireRecent = true,
  ) {
    const userId = actor.type === "board" ? actor.userId : null;
    await assertConfiguredOperatorAuthentication(
      reader,
      actor,
      config.operatorUserIds,
      { requireRecent },
    );
    if (!userId) throw forbidden("Internal operator access required");
    operator(userId);
    const query = reader
      .select()
      .from(supportSessions)
      .where(
        and(
          eq(supportSessions.id, sessionId),
          eq(supportSessions.operatorUserId, userId),
          isNull(supportSessions.revokedAt),
          sql`${supportSessions.expiresAt}>clock_timestamp()`,
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
      const [original] = await tx
        .select()
        .from(supportSessions)
        .where(
          and(
            eq(supportSessions.id, id),
            eq(supportSessions.companyId, companyId),
          ),
        )
        .limit(1)
        .for("update");
      if (!original) throw notFound();
      // The original Native row is the durable revocation receipt. Repeating
      // its exact target must not move the time or append another revoke audit.
      if (original.revokedAt) return original;
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
      await tx.insert(activityLog).values({
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
  async function readSessions(
    companyId: string,
    userId: string,
    sessionId?: string,
  ) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='5s'`);
      if (sessionId) await supportRollout(tx as unknown as Db);
      await lockMemoryPrivacy(tx as unknown as Db, companyId);
      await owner(companyId, userId, tx, true);
      const rows = await tx
        .select()
        .from(supportSessions)
        .where(
          and(
            eq(supportSessions.companyId, companyId),
            sessionId ? eq(supportSessions.id, sessionId) : undefined,
          ),
        )
        .orderBy(supportSessions.createdAt)
        .for("share");
      if (sessionId && rows[0]) await originalApprovalReceipt(tx, rows[0]);
      await owner(companyId, userId, tx, true);
      return rows;
    });
  }
  async function list(companyId: string, userId: string) {
    return readSessions(companyId, userId);
  }
  async function get(companyId: string, userId: string, sessionId: string) {
    const [row] = await readSessions(companyId, userId, sessionId);
    if (!row) throw notFound();
    return row;
  }
  async function status(sessionId: string, actor: AuthorizationActor) {
    const userId = actor.type === "board" ? actor.userId : null;
    if (!userId) throw forbidden("Internal operator access required");
    return db.transaction(async (tx) => {
      const session = await authorize(
        sessionId,
        actor,
        "status:read",
        new Date(),
        tx,
        true,
        false,
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
      await tx.insert(platformAdminAudit).values({
        companyId: session.companyId,
        operatorUserId: userId,
        supportSessionId: session.id,
        action: "support.status_read",
        resourceId: session.companyId,
      });
      await authorize(sessionId, actor, "status:read", new Date(), tx, true, false);
      return { companyId: session.companyId, runtimes: cells };
    });
  }
  async function override(
    sessionId: string,
    actor: AuthorizationActor,
    raw: unknown,
    now = new Date(),
  ) {
    const userId = actor.type === "board" ? actor.userId : null;
    if (!userId) throw forbidden("Internal operator access required");
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
        actor,
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
        await authorize(sessionId, actor, "billing:override", new Date(), tx, true);
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
      await tx.insert(platformAdminAudit).values({
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
      await tx.insert(activityLog).values({
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
      await authorize(sessionId, actor, "billing:override", new Date(), tx, true);
      return record!;
    });
  }
  async function runtimeAction(
    sessionId: string,
    actor: AuthorizationActor,
    cellId: string,
    raw: unknown,
    now = new Date(),
  ) {
    const userId = actor.type === "board" ? actor.userId : null;
    if (!userId) throw forbidden("Internal operator access required");
    const input = runtimeOperationSchema.parse(raw);
    if (["delete", "migrate"].includes(input.action))
      throw forbidden(
        "Destructive erasure and host migration require the company or fleet workflow",
      );
    return db.transaction(async (tx) => {
      const session = await authorize(
        sessionId,
        actor,
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
      await tx.insert(platformAdminAudit).values({
        companyId: session.companyId,
        operatorUserId: userId,
        supportSessionId: session.id,
        action: "support.runtime_" + input.action,
        resourceId: operation.id,
        safeDetails: { cellId },
      });
      await tx.insert(activityLog).values({
        companyId: session.companyId,
        actorType: "user",
        actorId: userId,
        action: "support.runtime_" + input.action,
        entityType: "runtime_cell",
        entityId: cellId,
        details: { supportSessionId: session.id, operationId: operation.id },
      });
      await authorize(sessionId, actor, input.action === "restore" ? "backup:restore" : "runtime:manage", new Date(), tx, true);
      return operation;
    });
  }
  async function canaryRuntime(
    sessionId: string,
    actor: AuthorizationActor,
    raw: unknown,
    now = new Date(),
  ) {
    const userId = actor.type === "board" ? actor.userId : null;
    if (!userId) throw forbidden("Internal operator access required");
    const input = runtimeCellCreateSchema.parse(raw);
    return db.transaction(async (tx) => {
      const session = await authorize(
        sessionId,
        actor,
        "runtime:manage",
        now,
        tx,
        true,
      );
      const result = await runtimeControlService(
        tx as unknown as Db,
        config,
      ).create(session.companyId, userId, input, now, userId);
      await tx.insert(platformAdminAudit).values({
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
      await authorize(sessionId, actor, "runtime:manage", new Date(), tx, true);
      return result;
    });
  }
  async function backupStatus(
    sessionId: string,
    actor: AuthorizationActor,
    cellId: string,
  ) {
    const userId = actor.type === "board" ? actor.userId : null;
    if (!userId) throw forbidden("Internal operator access required");
    return db.transaction(async (tx) => {
      const session = await authorize(
        sessionId,
        actor,
        "backup:restore",
        new Date(),
        tx,
        true,
        false,
      );
      const control = runtimeControlService(tx as unknown as Db, config);
      await control.getCell(session.companyId, cellId);
      const backups = await control.backups.list(session.companyId, cellId);
      await tx.insert(platformAdminAudit).values({
        companyId: session.companyId,
        operatorUserId: userId,
        supportSessionId: session.id,
        action: "support.backup_status_read",
        resourceId: cellId,
      });
      await authorize(sessionId, actor, "backup:restore", new Date(), tx, true, false);
      return backups;
    });
  }
  return {
    operator,
    approve,
    prepareApproval,
    pendingApproval,
    cancelApproval,
    authorize,
    revoke,
    list,
    get,
    status,
    override,
    runtimeAction,
    backupStatus,
    canaryRuntime,
  };
}
