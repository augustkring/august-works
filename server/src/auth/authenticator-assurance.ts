import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { conflict, forbidden } from "../errors.js";
import type { AuthorizationActor } from "../services/authorization.js";

export const RECENT_AUTHENTICATION_SECONDS = 300;
export type NativeAuthenticationMethod = "password" | "totp" | "backup_code" | "passkey";

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
): Promise<{ method: NativeAuthenticationMethod; authenticatedAt: Date; authenticatorVersion: number }> {
  const denied = () => forbidden("Authenticate again to continue", { code: "recent_authentication_required" });
  if (actor.type !== "board" || actor.source !== "session" || !actor.userId || !actor.sessionId) throw denied();
  try {
    const [proof] = await db.execute<{
      method: NativeAuthenticationMethod; authenticatedAt: Date | string; authenticatorVersion: number;
    }>(sql`
      select s.authentication_method as method, s.authenticated_at as "authenticatedAt",
        s.authenticator_version as "authenticatorVersion"
      from "session" s join "user" u on u.id=s.user_id
      where s.id=${actor.sessionId} and u.id=${actor.userId}
        and s.expires_at>clock_timestamp()
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
    return { ...proof, authenticatedAt: new Date(proof.authenticatedAt) };
  } catch (error) {
    if (isAuthenticationStateBusy(error)) throw conflict("Authentication state is changing; try again", { code: "authentication_state_busy" });
    throw error;
  }
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
