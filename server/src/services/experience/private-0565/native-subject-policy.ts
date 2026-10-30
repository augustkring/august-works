/** PRIVATE 0565 candidate. Re-evaluates canonical owner/default authority for
 * an offline Human without borrowing an HTTP/session/effect credential. */
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { authUsers, companyMemberships } from "@paperclipai/db";
import type { AuthorizationAction, AuthorizationActor, AuthorizationResource } from "../../authorization.js";
import { authorizationService } from "../../authorization.js";

/** This subject identity intentionally has no source, session, key, JWT,
 * credential expiry, instance-admin privilege, or effect claim. */
export function responsibilityPolicySubject(userId: string): AuthorizationActor {
  return { type: "board", userId, ignoreInstanceAdmin: true, isInstanceAdmin: false };
}

/** Current company membership/account and current domain policy are checked
 * independently. This helper is for pure read/authority decisions only; never
 * pass its actor to mutation, effect, or credential-backed APIs. */
export async function canSubjectPerformNativeRead(input: {
  db: Db;
  companyId: string;
  userId: string;
  action: AuthorizationAction;
  resource: AuthorizationResource;
}): Promise<boolean> {
  if (!input.userId || input.resource.companyId !== input.companyId) return false;
  const [membership] = await input.db.select({ id: companyMemberships.id })
    .from(companyMemberships)
    .innerJoin(authUsers, and(eq(authUsers.id, companyMemberships.principalId), eq(authUsers.emailVerified, true)))
    .where(and(eq(companyMemberships.companyId, input.companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, input.userId), eq(companyMemberships.status, "active")))
    .limit(1);
  if (!membership) return false;
  const decision = await authorizationService(input.db).decide({
    actor: responsibilityPolicySubject(input.userId),
    action: input.action,
    resource: input.resource,
  });
  return decision.allowed;
}
