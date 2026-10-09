import { verifyPassword } from "better-auth/crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
  accountDeletionOperations,
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
      await db.transaction(async (tx) => {
        await eraseAccountAccess(tx, operation.userId, undefined, now);
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
  await tx.execute(sql`delete from customer_feedback where id in (select feedback_id from customer_feedback_access where user_id=${userId})`);
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
