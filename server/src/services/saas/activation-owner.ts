import { and, eq, sql } from "drizzle-orm";
import { activationConnectionConsents, authUsers, companies, companyMemberships, companyOnboardingRuns, instanceSettings, toolApplications, toolConnections, type Db } from "@paperclipai/db";
import { activationStateSchema, v9FeatureEnabled } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { readFirstAgentCapabilityPin } from "./activation-first-agent.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

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

/** At the original provider/finish boundary. A historical allocation receipt
 * never replaces the current initiating human, scope or capability authority. */
export async function assertActivationConnectionPurpose(db: Db, actor: AuthorizationActor, companyId: string, connectionId: string,
  validateConnection: (connection: typeof toolConnections.$inferSelect, purpose: typeof activationConnectionConsents.$inferSelect) => void) {
  return db.transaction(transaction => assertActivationConnectionPurposeInTransaction(transaction as unknown as Db, actor, companyId, connectionId, validateConnection));
}

/** Recheck in the original finish transaction, before its writes. */
export async function assertActivationConnectionPurposeInTransaction(tx: Db, actor: AuthorizationActor, companyId: string, connectionId: string,
  validateConnection: (connection: typeof toolConnections.$inferSelect, purpose: typeof activationConnectionConsents.$inferSelect) => void) {
    await assertActivationAccess(tx, actor, companyId);
    await lockActivationSnapshot(tx, companyId);
    await assertActivationAccess(tx, actor, companyId, true);
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("share");
    if (!company || company.status !== "active") throw forbidden("Company setup is unavailable");
    const current = await readActivationOwner(tx, actor, companyId, true);
    await assertV5Authorization(tx, { ...actor, ignoreInstanceAdmin: true }, companyId, "tools:admin");
    const [purpose] = await tx.select().from(activationConnectionConsents).where(and(
      eq(activationConnectionConsents.companyId, companyId), eq(activationConnectionConsents.connectionId, connectionId))).for("share");
    if (!purpose || !["allocated", "connected"].includes(purpose.status) || purpose.subjectUserId !== current.userId ||
        purpose.onboardingRunId !== current.run.id || purpose.packageVersionId !== current.state.packageVersionId ||
        current.run.status !== "in_progress" || current.run.version !== purpose.onboardingVersion || current.state.step !== "access" ||
        !v9FeatureEnabled(await instanceSettingsService(tx).getExperimental(), "activation_v9"))
      throw conflict("The original connection purpose is no longer current");
    const pin = await readFirstAgentCapabilityPin(tx, purpose.packageVersionId);
    const [app] = await tx.select().from(toolApplications).where(and(eq(toolApplications.companyId, companyId),
      eq(toolApplications.id, purpose.applicationId))).for("share");
    if (!pin || pin.hash !== purpose.packageContentHash || !app || app.status !== "active" || app.archivedAt ||
        nativeSha256({ id: app.id, key: app.applicationKey, name: app.name, metadata: app.metadata, status: app.status, archivedAt: null }) !== purpose.applicationHash)
      throw conflict("The approved capability or connection application changed");
    const [connection] = await tx.select().from(toolConnections).where(and(eq(toolConnections.companyId, companyId),
      eq(toolConnections.id, connectionId))).for("share");
    if (!connection) throw notFound("The original connection allocation is unavailable");
    validateConnection(connection, purpose);
    return purpose;
}
