import { and, desc, eq, sql } from "drizzle-orm";
import { authUsers, supportSessions, type Db } from "@paperclipai/db";
import {
  customerSupportHistorySchema,
  v6FeatureEnabled,
  v9FeatureEnabled,
} from "@paperclipai/shared";
import { performance } from "node:perf_hooks";
import { conflict, forbidden, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { assertNativeSupportOwner } from "../saas/support.js";

/** Native V6 approval history only. A recorded approval is not an access decision:
 * V6 rechecks its configured operator, approving owner, scope and expiry at use. */
export async function readCustomerSupportHistory(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
) {
  if (actor.source === "local_implicit")
    throw forbidden("Authenticated company owner account required");
  const userId = v5HumanActorId(actor),
    current = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false },
    started = performance.now();
  function budget() {
    if (performance.now() - started > 5000)
      throw conflict("Support source changed; reload", {
        code: "support_history_stale",
      });
  }
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await tx.execute(sql`set local statement_timeout='5s'`);
    await tx.execute(
      sql`select singleton_key from instance_settings where singleton_key='default' for share`,
    );
    await lockMemoryPrivacy(tx, companyId);
    async function access() {
      budget();
      const flags = await instanceSettingsService(tx).getExperimental();
      if (
        !v9FeatureEnabled(flags, "progressive_shell_v9") ||
        !v6FeatureEnabled(flags, "admin_support_v6")
      )
        throw notFound("Customer support history is unavailable");
      const [account] = await tx
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .limit(1)
        .for("share");
      if (!account)
        throw forbidden("Authenticated company owner account required");
      await assertV5Authorization(tx, current, companyId, "company_scope:read");
      await assertNativeSupportOwner(tx, companyId, userId, true);
      budget();
    }
    await access();
    const rows = await tx
      .select({
        id: supportSessions.id,
        operator: supportSessions.operatorUserId,
        createdAt: supportSessions.createdAt,
        expiresAt: supportSessions.expiresAt,
        revokedAt: supportSessions.revokedAt,
        scopes: supportSessions.scopes,
      })
      .from(supportSessions)
      .where(eq(supportSessions.companyId, companyId))
      .orderBy(desc(supportSessions.createdAt), desc(supportSessions.id))
      .limit(11)
      .for("share");
    const [clock] = await tx.execute<{ observed_at: Date }>(
      sql`select clock_timestamp() as observed_at`,
    );
    if (!clock) throw notFound("Support observation is unavailable");
    const observedAt = new Date(clock.observed_at).toISOString();
    const result = customerSupportHistorySchema.parse({
      companyId,
      observedAt,
      hasMore: rows.length > 10,
      entries: rows
        .slice(0, 10)
        .map((row) => ({
          sessionId: row.id,
          operatorReference: row.operator,
          approvedAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          revokedAt: row.revokedAt?.toISOString() ?? null,
          state: row.revokedAt
            ? "revoked"
            : row.expiresAt.getTime() <= Date.parse(observedAt)
              ? "expired"
              : "recorded",
          scopes: row.scopes,
          origin: "native_v6_approval",
        })),
    });
    await access();
    return result;
  });
}
