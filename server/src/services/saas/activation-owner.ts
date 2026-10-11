import { and, eq, sql } from "drizzle-orm";
import { authUsers, companyMemberships, companyOnboardingRuns, instanceSettings, type Db } from "@paperclipai/db";
import { activationStateSchema } from "@paperclipai/shared";
import { forbidden, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";

/** Shared original onboarding locks and human authority. No cached session,
 * instance-admin flag, consent receipt or provider credential grants access. */
export async function lockActivationSnapshot(tx: Db, companyId: string) {
  await tx.execute(
    sql`select set_config('statement_timeout', '5000', true), set_config('lock_timeout', '1000', true)`,
  );
  await lockAnalyticalCompany(tx, companyId);
  await lockMemoryPrivacy(tx, companyId);
  await tx
    .select({ key: instanceSettings.singletonKey })
    .from(instanceSettings)
    .where(eq(instanceSettings.singletonKey, "default"))
    .for("share");
}
export async function assertActivationAccess(
  tx: Db,
  actor: AuthorizationActor,
  companyId: string,
  write = false,
) {
  const userId = v5HumanActorId(actor);
  if (actor.source === "local_implicit")
    throw forbidden("A verified account is required for activation");
  await assertV5Authorization(
    tx,
    { ...actor, ignoreInstanceAdmin: true },
    companyId,
    "company_scope:read",
  );
  const membershipQuery = tx
    .select()
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, userId),
        eq(companyMemberships.status, "active"),
      ),
    );
  const [membership] = await (write
    ? membershipQuery.for("share")
    : membershipQuery);
  const userQuery = tx
    .select({ verified: authUsers.emailVerified })
    .from(authUsers)
    .where(eq(authUsers.id, userId));
  const [user] = await (write ? userQuery.for("share") : userQuery);
  if (!membership || !user?.verified)
    throw forbidden("Current verified company membership is required");
  return userId;
}
export async function readActivationOwner(
  tx: Db,
  actor: AuthorizationActor,
  companyId: string,
  lock = false,
) {
  const userId = await assertActivationAccess(tx, actor, companyId, lock);
  const q = tx
    .select()
    .from(companyOnboardingRuns)
    .where(eq(companyOnboardingRuns.companyId, companyId));
  const [run] = await (lock ? q.for("update") : q);
  if (!run?.activationState || run.createdByUserId !== userId)
    throw notFound("Activation not found");
  return {
    run,
    userId,
    state: activationStateSchema.parse(run.activationState),
  };
}
