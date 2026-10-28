import { assertHumanAuthentication } from "../../auth/authenticator-assurance.js";
import type { AuthorizationActor } from "../authorization.js";
import { randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
  accountDeletionOperations,
  authVerifications,
  companySecrets,
  feedbackImageDeletions,
  authAccounts,
  authRateLimits,
  authUsers,
  humanWorkflowCoverages,
  heartbeatRuns,
  supportCaseIssueLinks,
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
import { accessService } from "../access.js";
import { parseAccountDeletionSsoChallenge } from "../../auth/account-deletion-sso-proof.js";

export function accountDeletionService(
  db: Db,
  effects: {
    removeSecret(id: string): Promise<unknown>;
    cancelRun(id: string): Promise<unknown>;
    removeFeedbackImages?(operationId: string): Promise<unknown>;
    enterpriseSourceSha?: string;
  },
) {
  async function request(userId: string, raw: unknown, now = new Date(), actor?: AuthorizationActor) {
    const input = accountDeletionRequestSchema.parse(raw);
    if (actor?.type !== "board" || actor.source !== "session" || actor.userId !== userId || !actor.sessionId)
      throw unauthorized("A current account session is required");
    const key = "account-delete:" + sha256(userId),
      budgetNow = sql`floor(extract(epoch from statement_timestamp()) * 1000)::bigint`,
      cutoff = sql`${budgetNow} - 600000`;
    // Commit the attempt budget independently so a wrong password cannot roll it back.
    const [budget] = await db
      .insert(authRateLimits)
      .values({ id: randomUUID(), key, count: 1, lastRequest: budgetNow })
      .onConflictDoUpdate({
        target: authRateLimits.key,
        set: {
          count: sql`case when ${authRateLimits.lastRequest}<${cutoff} then 1 else ${authRateLimits.count}+1 end`,
          lastRequest: sql`case when ${authRateLimits.lastRequest}<${cutoff} then ${budgetNow} else ${authRateLimits.lastRequest} end`,
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
      let pendingSsoProof: {
        rowId: string;
        authTime: number;
        rowExpiresAt: string;
        proofExpiresAt: string;
        qualificationExpiresAt: string;
        sourceSessionId: string;
        proofSessionId: string;
        sessionExpiries: [string, string];
      } | null = null;
      if (!user?.emailVerified) throw unauthorized("Verified account required");
      const [activeSession] = await tx.execute<{ id: string }>(sql`select id from "session"
        where id=${actor.sessionId} and user_id=${userId} and expires_at>clock_timestamp() for share nowait`);
      if (!activeSession) throw unauthorized("A current account session is required");
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
      if (credential?.password) {
        if (!input.password || input.reauthenticationProofId || !(await verifyPassword({
          hash: credential.password,
          password: input.password,
        }))) throw forbidden("Current password confirmation required");
      } else {
        const [proofRow] = await tx.select().from(authVerifications)
          .where(eq(authVerifications.identifier, `account-deletion-oidc:${userId}`)).for("update");
        const proof = proofRow ? parseAccountDeletionSsoChallenge(proofRow.value) : null;
        const proofTime = proof?.authTime ?? NaN;
        const proofRowExpiryMs = proofRow?.expiresAt instanceof Date
          ? proofRow.expiresAt.getTime()
          : Date.parse(String(proofRow?.expiresAt ?? ""));
        if (!input.reauthenticationProofId || input.password || !proofRow || !proof ||
          proof.challengeId !== input.reauthenticationProofId || proof.purpose !== "account-deletion" ||
          proof.state !== "ready" || proof.userId !== userId || proof.proofSessionId !== actor.sessionId ||
          proof.authenticatorVersion !== user.authenticatorVersion ||
          !Number.isSafeInteger(proofTime) || now.getTime() - proofTime > 300_000 || proofTime > now.getTime() + 5_000 ||
          !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= now.getTime() ||
          !Number.isFinite(proofRowExpiryMs) || proofRowExpiryMs <= now.getTime() ||
          typeof proof.policyRevision !== "string" || !effects.enterpriseSourceSha)
          throw forbidden("Current company sign-in confirmation required");
        const [authority] = await tx.execute<{
          id: string; version: number; companyId: string; providerId: string; issuer: string;
          configuration: Record<string, unknown>; qualification: Record<string, unknown>; updatedAt: Date | string;
          bindingId: string; subject: string;
        }>(sql`
          select p.id,p.version,p.company_id as "companyId",p.provider_id as "providerId",p.issuer,
            p.configuration,p.qualification,p.updated_at as "updatedAt",b.id as "bindingId",b.subject
          from enterprise_identity_policies p
          join enterprise_subject_bindings b on b.company_id=p.company_id and b.provider_id=p.provider_id
          join company_memberships m on m.company_id=b.company_id and m.principal_type='user'
            and m.principal_id=b.user_id and m.status='active'
          where b.id=${String(proof.bindingId)} and b.user_id=${userId} and b.status='active'
            and p.id=${String(proof.policyId)} and p.status='qualified' and p.version=${Number(proof.policyVersion)}
            and p.qualification->>'sourceRevision'=${effects.enterpriseSourceSha}
            and p.configuration->>'protocol'='oidc'
          for share of p,b,m`);
        if (!authority || authority.companyId !== proof.companyId || authority.providerId !== proof.providerId ||
          authority.issuer !== proof.issuer || authority.bindingId !== proof.bindingId || authority.subject !== proof.subject)
          throw forbidden("Current company sign-in confirmation required");
        const revision = sha256(JSON.stringify({ id: authority.id, version: authority.version,
          companyId: authority.companyId, providerId: authority.providerId, issuer: authority.issuer,
          configuration: authority.configuration, qualification: authority.qualification,
          updatedAt: new Date(authority.updatedAt).toISOString() }));
        const keyPin = authority.qualification.signingKey as { secretId?: string; version?: number; valueSha256?: string } | null;
        const qualificationExpiresAt = typeof authority.qualification.expiresAt === "string"
          ? Date.parse(authority.qualification.expiresAt)
          : NaN;
        if (revision !== proof.policyRevision || !keyPin ||
          keyPin.secretId !== authority.configuration.privateKeySecretId ||
          keyPin.version !== authority.configuration.privateKeySecretVersion ||
          !Number.isFinite(qualificationExpiresAt))
          throw forbidden("Current company sign-in confirmation required");
        const [key] = await tx.execute<{ id: string }>(sql`
          select s.id from company_secrets s join company_secret_versions v
            on v.secret_id=s.id and v.version=${keyPin?.version ?? -1}
          where s.id=${keyPin?.secretId ?? ""} and s.company_id=${authority.companyId}
            and s.scope='company' and s.provider='local_encrypted' and s.status='active' and s.deleted_at is null
            and s.latest_version=${keyPin?.version ?? -1} and v.status='current' and v.revoked_at is null
            and v.value_sha256=${keyPin?.valueSha256 ?? ""} for share of s,v`);
        if (!key || !proof.sourceSessionId || proof.sourceSessionId === proof.proofSessionId)
          throw forbidden("Current company sign-in confirmation required");
        pendingSsoProof = {
          rowId: proofRow.id,
          authTime: proofTime,
          rowExpiresAt: new Date(proofRowExpiryMs).toISOString(),
          proofExpiresAt: new Date(proof.expiresAt).toISOString(),
          qualificationExpiresAt: new Date(qualificationExpiresAt).toISOString(),
          sourceSessionId: proof.sourceSessionId,
          proofSessionId: proof.proofSessionId!,
          sessionExpiries: ["", ""],
        };
      }
      if (user.twoFactorEnabled || user.phishingResistantRequired) {
        if (actor?.type !== "board" || actor.userId !== userId) throw forbidden("Recent factor confirmation required");
        await assertHumanAuthentication(tx, actor, { requireRecent: true, phishingResistant: false });
      }
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
      if (pendingSsoProof) {
        if (pendingSsoProof.proofSessionId !== actor.sessionId ||
          pendingSsoProof.sourceSessionId === pendingSsoProof.proofSessionId)
          throw forbidden("Current company sign-in confirmation required");
        const sessions = await tx.execute<{ id: string; expiresAt: Date | string }>(sql`
          select id,expires_at as "expiresAt" from "session" where id in (${pendingSsoProof.sourceSessionId},${actor.sessionId})
            and user_id=${userId} and (authenticator_version is null or authenticator_version=${user.authenticatorVersion})
          for share nowait`);
        if (new Set(sessions.map(row => row.id)).size !== 2)
          throw forbidden("Current company sign-in confirmation required");
        const sourceSession = sessions.find(row => row.id === pendingSsoProof.sourceSessionId);
        const proofSession = sessions.find(row => row.id === actor.sessionId);
        if (!sourceSession || !proofSession)
          throw forbidden("Current company sign-in confirmation required");
        pendingSsoProof.sessionExpiries = [
          new Date(sourceSession.expiresAt).toISOString(),
          new Date(proofSession.expiresAt).toISOString(),
        ];
      }
      const [operation] = await tx
        .insert(accountDeletionOperations)
        .values({
          userId,
          idempotencyKey: sha256(input.idempotencyKey),
          createdAt: now,
          notBefore: now,
        })
        .returning();
      await eraseAccountAccess(tx, userId, user.email, now, pendingSsoProof?.rowId);
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
      if (pendingSsoProof) {
        const [fresh] = await tx.execute<{ valid: boolean }>(sql`
          select ${pendingSsoProof.authTime}::double precision between
              (extract(epoch from clock_timestamp())-299)*1000 and (extract(epoch from clock_timestamp())+5000)*1000
            and ${pendingSsoProof.rowExpiresAt}::timestamptz>clock_timestamp()+interval '1 second'
            and ${pendingSsoProof.proofExpiresAt}::timestamptz>clock_timestamp()+interval '1 second'
            and ${pendingSsoProof.qualificationExpiresAt}::timestamptz>clock_timestamp()+interval '1 second'
            and ${pendingSsoProof.sessionExpiries[0]}::timestamptz>clock_timestamp()+interval '1 second'
            and ${pendingSsoProof.sessionExpiries[1]}::timestamptz>clock_timestamp()+interval '1 second'
            and exists(select 1 from "user" where id=${userId} and authenticator_version=${user.authenticatorVersion}) as valid`);
        if (!fresh?.valid) throw forbidden("Current company sign-in confirmation required");
        await tx.delete(authVerifications).where(eq(authVerifications.id, pendingSsoProof.rowId));
      }
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
          or exists(select 1 from feedback_image_deletions where account_deletion_id=${operation.id} and deleted_at is null)
          or exists(select 1 from support_cases where opened_by_user_id=${operation.userId})
          or exists(select 1 from support_case_events where author_user_id=${operation.userId})`);
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
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  userId: string,
  email?: string,
  now = new Date(),
  preserveVerificationId?: string,
) {
  // Native intake takes the principal before the content root. Support roots
  // precede feedback roots, matching company purge's ordering.
  await tx.execute(sql`select id from "user" where id=${userId} for update`);
  // Reuse the company access owner before removing membership rows: revocation
  // pauses user-owned routines, withdraws connection access/coverage and clears
  // explicit responsible-human defaults in the same erasure transaction.
  await accessService(tx as unknown as Db).prepareMemberForOffboardingInTransaction(tx, userId, null, now);
  // Coverage authority ends as soon as account deletion begins. Keep the
  // immutable receipt row for audit, but erase its user-authored reason while
  // a support or legal hold keeps the account row pending physical deletion.
  await tx.execute(sql`update ${humanWorkflowCoverages}
    set revoked_at=coalesce(revoked_at,${now.toISOString()}::timestamptz),
        revoked_by_user_id=case when revoked_at is null then null else revoked_by_user_id end,
        reason='Revoked during account deletion'
    where principal_user_id=${userId} or delegatee_user_id=${userId}`);
  // Operation metadata contains no bundle/credential/body. Remove the
  // principal's private receipts under the same native erasure fence.
  await tx.execute(sql`delete from customer_operations where requested_by_user_id=${userId}`);
  await tx.execute(sql`select c.id from support_cases c where c.id in (
      select own.id from support_cases own where own.opened_by_user_id=${userId}
      union select e.case_id from support_case_events e where e.author_user_id=${userId}
    ) order by c.id for update`);
  // Issue links retain no support content, and their author identity is not
  // needed to preserve the customer's current support/work reference.
  await tx.update(supportCaseIssueLinks).set({ linkedByUserId: null }).where(eq(supportCaseIssueLinks.linkedByUserId, userId));
  // A hold or attempted/unknown provider outcome keeps physical erasure
  // pending; it must never roll back immediate credential revocation.
  await tx.execute(sql`delete from support_case_events e using support_cases c
    where c.id=e.case_id and c.company_id=e.company_id and e.author_user_id=${userId}
      and not (c.legal_hold and (c.hold_release_at is null or c.hold_release_at>clock_timestamp()))
      and c.provider_case_ref is null
      and not exists(select 1 from support_case_events other where other.company_id=c.company_id
        and other.case_id=c.id and (other.delivery_attempt_id is not null or other.delivery_provider_key is not null
          or other.delivery_started_at is not null or other.provider_message_ref is not null
          or other.delivery_state in ('sending','delivered','unknown')))`);
  await tx.execute(sql`delete from support_cases c where c.opened_by_user_id=${userId}
    and not (c.legal_hold and (c.hold_release_at is null or c.hold_release_at>clock_timestamp()))
    and c.provider_case_ref is null and not exists(select 1 from support_case_events e
      where e.company_id=c.company_id and e.case_id=c.id and (e.delivery_attempt_id is not null
        or e.delivery_provider_key is not null or e.delivery_started_at is not null
        or e.provider_message_ref is not null or e.delivery_state in ('sending','delivered','unknown')))`);
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
  await tx.execute(sql`delete from ${authRateLimits} where key like ${"support-case:" + sha256(JSON.stringify(userId)) + ":%"}`);
  await tx.execute(sql`delete from ${authRateLimits} where key=${"password-reauth:" + sha256(userId)}`);
  await tx.execute(sql`delete from ${authRateLimits} where key=${"factor-reauth:" + sha256(userId)}`);
  await tx.execute(sql`delete from ${authRateLimits} where key=${"passkey-auth:" + sha256(userId)}`);
  await tx.execute(sql`delete from "session" where user_id=${userId}`);
  await tx.execute(sql`delete from "account" where user_id=${userId}`);
  await tx.execute(sql`delete from two_factor where user_id=${userId}`);
  await tx.execute(sql`delete from passkey where user_id=${userId}`);
  await tx.execute(sql`delete from board_api_keys where user_id=${userId}`);
  await tx.execute(sql`delete from verification where
    (value=${userId} or aw_native_verification_user_id(value)=${userId} ${email ? sql`or identifier=${email}` : sql``})
    ${preserveVerificationId ? sql`and id<>${preserveVerificationId}` : sql``}`);
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
  await tx.execute(sql`delete from notification_preference_proposals where user_id=${userId}`);
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
  // Quarantine replay and ordinary requests share the same profile scrub.
  // Stable actor IDs remain only while required records still reference them.
  await tx.execute(sql`update "user" set name='Deleted account',
    email=${"deleted+" + sha256(userId) + "@account.invalid"},email_verified=false,
    image=null,locale=null,two_factor_enabled=false,updated_at=${now.toISOString()}::timestamptz where id=${userId}`);
}
