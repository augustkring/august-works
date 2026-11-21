import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { conflict, forbidden } from "../errors.js";
import type { AuthorizationActor } from "../services/authorization.js";

export const RECENT_AUTHENTICATION_SECONDS = 300;
export type NativeAuthenticationMethod = "password" | "totp" | "backup_code" | "passkey";
type NativeAuthenticationProof = {
  method: NativeAuthenticationMethod;
  authenticatedAt: Date;
  authenticatorVersion: number;
  credentialExpiresAt: Date;
};

export function isAuthenticationStateBusy(error: unknown): boolean {
  let cause = error;
  for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth++) {
    const candidate = cause as { code?: unknown; cause?: unknown };
    if (candidate.code === "55P03") return true;
    cause = candidate.cause;
  }
  return false;
}

/** Authentication proof narrows the original domain authorization; it never
 * grants membership, a permission or operator status. Use the domain's physical
 * transaction and repeat the check before commit after intervening waits. */
export async function assertHumanAuthentication(
  db: Pick<Db, "execute">,
  actor: AuthorizationActor,
  options: { requireRecent: boolean; phishingResistant: boolean; requireVerifiedEmail?: boolean },
): Promise<NativeAuthenticationProof> {
  const denied = () => forbidden("Authenticate again to continue", { code: "recent_authentication_required" });
  if (actor.type !== "board" || actor.source !== "session" || !actor.userId || !actor.sessionId) throw denied();
  const verifiedExpiresAt = actor.authenticatedCredentialExpiresAt ?? null;
  if (verifiedExpiresAt !== null && !Number.isFinite(verifiedExpiresAt)) throw denied();
  try {
    const [proof] = await db.execute<{
      method: NativeAuthenticationMethod; authenticatedAt: Date | string; authenticatorVersion: number;
      credentialExpiresAt: Date | string;
    }>(sql`
      select s.authentication_method as method, s.authenticated_at as "authenticatedAt",
        s.authenticator_version as "authenticatorVersion",s.expires_at as "credentialExpiresAt"
      from "session" s join "user" u on u.id=s.user_id
      where s.id=${actor.sessionId} and u.id=${actor.userId}
        and s.expires_at>clock_timestamp()
        and ${verifiedExpiresAt === null ? sql`true`
          : sql`${verifiedExpiresAt}::double precision>extract(epoch from clock_timestamp())*1000`}
        and s.authenticator_version=u.authenticator_version
        and (${!options.requireVerifiedEmail} or u.email_verified)
        and not exists (select 1 from account_deletion_operations where user_id=u.id)
        and s.authenticated_at<=clock_timestamp()
        and ${options.requireRecent
          ? sql`s.authenticated_at>=clock_timestamp()-${RECENT_AUTHENTICATION_SECONDS}*interval '1 second'`
          : sql`true`}
        and case when ${options.phishingResistant} or u.phishing_resistant_required then
          s.authentication_method='passkey'
        when u.two_factor_enabled then s.authentication_method in ('totp','backup_code','passkey')
        else s.authentication_method in ('password','passkey') end
        and (s.authentication_method<>'password' or exists (
          select 1 from account a where a.user_id=u.id and a.provider_id='credential' and a.password is not null))
        and (s.authentication_method not in ('totp','backup_code') or exists (
          select 1 from two_factor f where f.user_id=u.id and f.verified and u.two_factor_enabled))
        and (s.authentication_method<>'passkey' or exists (
          select 1 from passkey p where p.user_id=u.id))
      for share of s,u nowait
    `);
    if (!proof) throw denied();
    const authenticatedAt = new Date(proof.authenticatedAt);
    // The stored row may have been extended since request authentication.
    // Preserve the original verified carrier's deadline through native work.
    const credentialExpiresAt = new Date(Math.min(new Date(proof.credentialExpiresAt).getTime(), verifiedExpiresAt ?? Infinity));
    if (!Number.isFinite(authenticatedAt.getTime()) || !Number.isFinite(credentialExpiresAt.getTime())) throw denied();
    return { ...proof, authenticatedAt, credentialExpiresAt };
  } catch (error) {
    if (isAuthenticationStateBusy(error)) throw conflict("Authentication state is changing; try again", { code: "authentication_state_busy" });
    throw error;
  }
}

/** Finish a protected native effect on the same transaction that pinned its
 * source principal. Rotation/revocation cannot extend that source's deadline. */
export async function assertPinnedAuthenticationDeadline(db: Pick<Db, "execute">,
  proof: Pick<NativeAuthenticationProof, "authenticatedAt" | "credentialExpiresAt">) {
  const authenticatedAt = proof.authenticatedAt.getTime(), expiresAt = proof.credentialExpiresAt.getTime();
  const denied = () => forbidden("Authenticate again to continue", { code: "recent_authentication_required" });
  if (!Number.isFinite(authenticatedAt) || !Number.isFinite(expiresAt)) throw denied();
  const [current] = await db.execute<{ active: boolean }>(sql`select
    ${expiresAt}::double precision>extract(epoch from clock_timestamp())*1000
    and ${authenticatedAt}::double precision between
      (extract(epoch from clock_timestamp())-${RECENT_AUTHENTICATION_SECONDS})*1000
      and extract(epoch from clock_timestamp())*1000 as active`);
  if (!current?.active) throw denied();
}

/** Use in the original domain transaction; configured identity is never proof
 * of a live phishing-resistant session or of company/resource permission. */
export async function assertConfiguredOperatorAuthentication(
  db: Pick<Db, "execute">,
  actor: AuthorizationActor,
  operatorUserIds: readonly string[],
  options: { requireRecent: boolean } = { requireRecent: true },
) {
  if (actor.type !== "board" || !actor.userId || !operatorUserIds.includes(actor.userId)) {
    throw forbidden("Configured platform operator required");
  }
  return assertHumanAuthentication(db, actor, {
    ...options, phishingResistant: true, requireVerifiedEmail: true,
  });
}
