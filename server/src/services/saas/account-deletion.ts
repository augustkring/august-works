import { verifyPassword } from "better-auth/crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
  accountDeletionOperations,
  feedbackImageDeletions,
  authAccounts,
  authRateLimits,
  authUsers,
  companySecrets,
  heartbeatRuns,
  type Db,
} from "@paperclipai/db";
import { accountDeletionRequestSchema } from "@paperclipai/shared";
import {
  conflict,
  forbidden,
  tooManyRequests,
  unauthorized,
} from "../../errors.js";
import { sha256 } from "./crypto.js";

export function accountDeletionService(
  db: Db,
  effects: {
    removeSecret(id: string): Promise<unknown>;
    cancelRun(id: string): Promise<unknown>;
    removeFeedbackImages?(operationId: string): Promise<unknown>;
  },
) {
  async function request(userId: string, raw: unknown, now = new Date()) {
    const input = accountDeletionRequestSchema.parse(raw);
    const key = "account-delete:" + sha256(userId),
      cutoff = now.getTime() - 600000;
    // Commit the attempt budget independently so a wrong password cannot roll it back.
    const [budget] = await db
      .insert(authRateLimits)
      .values({ id: key, key, count: 1, lastRequest: now.getTime() })
      .onConflictDoUpdate({
        target: authRateLimits.key,
        set: {
          count: sql`case when ${authRateLimits.lastRequest}<${cutoff} then 1 else ${authRateLimits.count}+1 end`,
          lastRequest: sql`case when ${authRateLimits.lastRequest}<${cutoff} then ${now.getTime()} else ${authRateLimits.lastRequest} end`,
        },
      })
      .returning();
    if (budget!.count > 10)
      throw tooManyRequests(
        "Account confirmation attempts exceeded; try again later",
      );
    return db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .for("update");
      const [existing] = await tx
        .select()
        .from(accountDeletionOperations)
        .where(eq(accountDeletionOperations.userId, userId));
      if (existing) {
        if (existing.idempotencyKey !== sha256(input.idempotencyKey))
          throw conflict("Account deletion is already requested");
        return receipt(existing);
      }
      if (!user?.emailVerified) throw unauthorized("Verified account required");
      const [credential] = await tx
        .select()
        .from(authAccounts)
        .where(
          and(
            eq(authAccounts.userId, userId),
            eq(authAccounts.providerId, "credential"),
          ),
        )
        .for("update");
      if (
        !credential?.password ||
        !(await verifyPassword({
          hash: credential.password,
          password: input.password,
        }))
      )
        throw forbidden("Current password confirmation required");
      // This rare, bounded operation must also serialize native membership writers that
      // do not take a company lock. Never remove the last owner using a stale snapshot.
      await tx.execute(
        sql`lock table company_memberships in share row exclusive mode`,
      );
      await tx.execute(sql`select c.id from companies c join company_memberships m on m.company_id=c.id
        where m.principal_type='user' and m.principal_id=${userId} and m.status='active' order by c.id for update of c`);
      const sole =
        await tx.execute(sql`select m.company_id from company_memberships m join companies c on c.id=m.company_id
        where m.principal_type='user' and m.principal_id=${userId} and m.status='active' and m.membership_role='owner'
        and not exists(select 1 from company_memberships other where other.company_id=m.company_id
          and other.principal_type='user' and other.principal_id<>${userId} and other.status='active' and other.membership_role='owner') limit 1`);
      if (sole.length)
        throw conflict(
          "Transfer ownership or finish deleting your organizations first",
          { code: "ACCOUNT_SOLE_OWNER" },
        );
      const payer =
        await tx.execute(sql`select b.id from billing_accounts b where b.payer_user_id=${userId}
        and (b.status<>'closed' or exists(select 1 from billing_account_companies l where l.billing_account_id=b.id and l.status='active')
          or exists(select 1 from billing_subscriptions s where s.billing_account_id=b.id and s.status<>'canceled')
          or exists(select 1 from runtime_cells r join billing_account_companies l on l.company_id=r.company_id where l.billing_account_id=b.id and r.deleted_at is null))
        order by b.id for update`);
      if (payer.length)
        throw conflict("Close or transfer your billing accounts first", {
          code: "ACCOUNT_BILLING_OPEN",
        });
      const [operation] = await tx
        .insert(accountDeletionOperations)
        .values({
          userId,
          idempotencyKey: sha256(input.idempotencyKey),
          createdAt: now,
          notBefore: now,
        })
        .returning();
      await eraseAccountAccess(tx, userId, user.email, now);
      // Provider-held secret material stays in a fenced durable operation until confirmed removed.
      await tx
        .update(companySecrets)
        .set({ status: "deleted", deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(companySecrets.scope, "user"),
            eq(companySecrets.ownerUserId, userId),
          ),
        );
      await tx
        .update(authUsers)
        .set({
          name: "Deleted account",
          email: "deleted+" + sha256(userId) + "@account.invalid",
          emailVerified: false,
          image: null,
          updatedAt: now,
        })
        .where(eq(authUsers.id, userId));
      return receipt(operation!);
    });
  }
  async function processOne(now = new Date()) {
    const operation = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(accountDeletionOperations)
        .where(
          and(
            inArray(accountDeletionOperations.status, [
              "requested",
              "processing",
            ]),
            lt(accountDeletionOperations.notBefore, now),
          ),
        )
        .orderBy(accountDeletionOperations.createdAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return null;
      await tx
        .update(accountDeletionOperations)
        .set({
          status: "processing",
          notBefore: new Date(now.getTime() + 120000),
        })
        .where(eq(accountDeletionOperations.userId, row.userId));
      return row;
    });
    if (!operation) return false;
    try {
      const runs = await db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.responsibleUserId, operation.userId),
            inArray(heartbeatRuns.status, ["queued", "running"]),
          ),
        )
        .limit(20);
      for (const run of runs) await effects.cancelRun(run.id);
      const [remainingRun] = await db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.responsibleUserId, operation.userId),
            inArray(heartbeatRuns.status, ["queued", "running"]),
          ),
        )
        .limit(1);
      if (remainingRun) throw Error("account_work_cancellation_pending");
      const secrets = await db
        .select({ id: companySecrets.id })
        .from(companySecrets)
        .where(
          and(
            eq(companySecrets.scope, "user"),
            eq(companySecrets.ownerUserId, operation.userId),
          ),
        )
        .limit(20);
      for (const secret of secrets) await effects.removeSecret(secret.id);
      const [remainingSecret] = await db
        .select({ id: companySecrets.id })
        .from(companySecrets)
        .where(
          and(
            eq(companySecrets.scope, "user"),
            eq(companySecrets.ownerUserId, operation.userId),
          ),
        )
        .limit(1);
      if (remainingSecret) throw Error("account_secret_erasure_pending");
      // Request-time access revocation is immediate. A current feedback legal
      // hold or an uncertain protected object must not be reported as erasure.
      await db.transaction(tx => eraseAccountAccess(tx, operation.userId, undefined, now));
      const held = await db.execute(sql`select 1 from customer_feedback_access where user_id=${operation.userId} limit 1`);
      if (held.length) throw Error("account_feedback_hold_pending");
      await effects.removeFeedbackImages?.(operation.id);
      const [pendingImage] = await db.select({ id: feedbackImageDeletions.id }).from(feedbackImageDeletions).where(and(
        eq(feedbackImageDeletions.accountDeletionId, operation.id), sql`${feedbackImageDeletions.deletedAt} is null`,
      )).limit(1);
      if (pendingImage) throw Error("account_feedback_image_erasure_pending");
      await db.transaction(async (tx) => {
        await eraseAccountAccess(tx, operation.userId, undefined, now);
        // Recheck after the final native erase: a hold can expire or be
        // released between attempts, creating a new protected-object outbox.
        // Completing the account must never outrun that physical erasure.
        const remaining = await tx.execute(sql`select 1 where
          exists(select 1 from customer_feedback_access where user_id=${operation.userId})
          or exists(select 1 from feedback_image_deletions where account_deletion_id=${operation.id} and deleted_at is null)`);
        if (remaining.length) throw Error("account_feedback_erasure_pending");
        await tx.delete(authUsers).where(eq(authUsers.id, operation.userId));
        await tx
          .update(accountDeletionOperations)
          .set({ status: "completed", errorCode: null, completedAt: now })
          .where(eq(accountDeletionOperations.userId, operation.userId));
      });
    } catch {
      await db
        .update(accountDeletionOperations)
        .set({
          errorCode: "account_erasure_pending",
          notBefore: new Date(now.getTime() + 30000),
        })
        .where(eq(accountDeletionOperations.userId, operation.userId));
    }
    return true;
  }
  return { request, processOne };
}

function receipt(row: typeof accountDeletionOperations.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

/** Also used by quarantine replay. Audit actor IDs and required financial records stay stable. */
export async function eraseAccountAccess(
  tx: Pick<Db, "execute">,
  userId: string,
  email?: string,
  now = new Date(),
) {
  // Erase this actor's feedback content and private ownership links together.
  // The same path covers no-name submissions without exposing them to triage.
  await tx.execute(sql`select f.id from customer_feedback f join customer_feedback_access a on a.company_id=f.company_id and a.feedback_id=f.id
    where a.user_id=${userId} order by f.id for update of f`);
  // Retain only a current legal/incident hold under its native private owner.
  // Required private DSR links remain for pending erasure, while membership,
  // sessions and keys are still revoked below and named product identity clears.
  await tx.execute(sql`update customer_feedback set submitted_by_user_id=null,version=version+1
    where submitted_by_user_id=${userId} and id in (select feedback_id from customer_feedback_access where user_id=${userId})
      and exists(select 1 from account_deletion_operations where user_id=${userId} and status in ('requested','processing'))`);
  await tx.execute(sql`delete from customer_feedback f where id in (select feedback_id from customer_feedback_access where user_id=${userId})
    and not exists(select 1 from customer_feedback_retention r where r.company_id=f.company_id and r.feedback_id=f.id
      and r.legal_hold and (r.hold_release_at is null or r.hold_release_at>clock_timestamp()))`);
  await tx.execute(sql`delete from ${authRateLimits} where key like ${"customer-feedback:" + sha256(JSON.stringify(userId)) + ":%"}`);
  await tx.execute(sql`delete from "session" where user_id=${userId}`);
  await tx.execute(sql`delete from "account" where user_id=${userId}`);
  await tx.execute(sql`delete from board_api_keys where user_id=${userId}`);
  await tx.execute(
    sql`delete from verification where value=${userId} ${email ? sql`or identifier=${email}` : sql``}`,
  );
  await tx.execute(
    sql`delete from company_memberships where principal_type='user' and principal_id=${userId}`,
  );
  await tx.execute(
    sql`delete from principal_permission_grants where principal_type='user' and principal_id=${userId}`,
  );
  await tx.execute(
    sql`delete from instance_user_roles where user_id=${userId}`,
  );
  await tx.execute(
    sql`delete from user_sidebar_preferences where user_id=${userId}`,
  );
  await tx.execute(sql`delete from company_user_sidebar_preferences where user_id=${userId}`);
  await tx.execute(
    sql`delete from user_inbox_agent_policies where user_id=${userId}`,
  );
  await tx.execute(sql`delete from saas_notifications where user_id=${userId}`);
  await tx.execute(
    sql`delete from saas_notification_preferences where user_id=${userId}`,
  );
  await tx.execute(
    sql`update support_sessions set revoked_at=${now.toISOString()}::timestamptz where operator_user_id=${userId} or approved_by_user_id=${userId}`,
  );
  await tx.execute(
    sql`update email_deliveries set status='expired',payload_ciphertext=null,lease_owner=null,lease_until=null where user_id=${userId}`,
  );
}
