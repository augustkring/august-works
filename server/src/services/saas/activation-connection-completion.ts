import { and, eq, sql } from "drizzle-orm";
import { activationConnectionConsents, connectionGrants, companySecrets, connectionGrantDelegations, toolConnections, toolConnectionInstalls, toolProfiles, toolProfileBindings, type Db } from "@paperclipai/db";
import { conflict } from "../../errors.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

type Purpose = typeof activationConnectionConsents.$inferSelect;
type Connection = typeof toolConnections.$inferSelect;
type Grant = typeof connectionGrants.$inferSelect;

/** Pin material original setup, never tokens or an incidental activity clock. */
export function activationConnectionSetupHash(connection: Connection, grant: Grant) {
  return nativeSha256({ connection: { id: connection.id, applicationId: connection.applicationId,
    companyId: connection.companyId, creator: connection.createdByUserId, auth: connection.authKind,
    policy: connection.credentialPolicy, source: connection.credentialSource, transport: connection.transport,
    config: connection.config, transportConfig: connection.transportConfig, status: connection.status, enabled: connection.enabled },
    grant: { id: grant.id, kind: grant.kind, subjectUserId: grant.subjectUserId, status: grant.status,
      revokedAt: grant.revokedAt, isDefault: grant.isDefault, credentialSecretRefs: grant.credentialSecretRefs,
      externalCredential: grant.externalCredential, providerTenant: grant.providerTenant } });
}

/** Only original personal credentials and an actual current health observation
 * qualify setup. This never qualifies execution, Safe Test or Agent authority. */
export async function readDeferredActivationSetup(tx: Db, purpose: Purpose, requireProfile = true) {
  const [connection] = await tx.select().from(toolConnections).where(and(eq(toolConnections.companyId, purpose.companyId),
    eq(toolConnections.id, purpose.connectionId!))).for("share");
  if (!connection || connection.applicationId !== purpose.applicationId || connection.createdByUserId !== purpose.subjectUserId ||
      connection.credentialPolicy !== "per_user" || connection.authKind !== "oauth" || connection.credentialSource !== "paperclip_vault" ||
      connection.credentialSecretRefs.length || connection.externalCredential || !(connection.status === "active" && connection.enabled || !requireProfile && connection.status === "draft" && !connection.enabled) ||
      connection.healthStatus !== "ok" || !connection.healthCheckedAt || connection.healthCheckedAt < connection.updatedAt)
    return null;
  const grants = await tx.select().from(connectionGrants).where(and(eq(connectionGrants.companyId, purpose.companyId),
    eq(connectionGrants.connectionId, connection.id), eq(connectionGrants.status, "active"), sql`${connectionGrants.revokedAt} is null`))
    .orderBy(connectionGrants.id).limit(2).for("share");
  const grant = grants[0];
  if (grants.length !== 1 || !grant || grant.kind !== "user" || grant.subjectUserId !== purpose.subjectUserId ||
      grant.isDefault || grant.externalCredential || !grant.credentialSecretRefs.some(ref => ref.configPath === "oauth.access_token")) return null;
  const installs = await tx.select({ id: toolConnectionInstalls.id }).from(toolConnectionInstalls).where(and(
    eq(toolConnectionInstalls.companyId, purpose.companyId), eq(toolConnectionInstalls.connectionId, connection.id))).limit(1).for("share");
  const delegations = await tx.select({ id: connectionGrantDelegations.id }).from(connectionGrantDelegations).where(and(
    eq(connectionGrantDelegations.companyId, purpose.companyId), eq(connectionGrantDelegations.grantId, grant.id))).limit(1).for("share");
  if (installs.length || delegations.length) return null;
  const scopes = (connection.config.oauth as { scopes?: unknown } | undefined)?.scopes;
  if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== "string") ||
      !grant.providerTenant?.oauth?.scopes || nativeSha256([...grant.providerTenant.oauth.scopes].sort()) !== nativeSha256([...scopes].sort())) return null;
  const secretMetadata = [];
  for (const ref of grant.credentialSecretRefs) {
    const [secret] = await tx.select({ id: companySecrets.id, version: companySecrets.latestVersion, scope: companySecrets.scope, owner: companySecrets.ownerUserId }).from(companySecrets).where(and(
      eq(companySecrets.companyId, purpose.companyId), eq(companySecrets.id, ref.secretId), eq(companySecrets.status, "active"), sql`${companySecrets.deletedAt} is null`)).for("share");
    if (!secret) return null;
    secretMetadata.push(secret);
  }
  if (requireProfile) {
    const [profile] = await tx.select().from(toolProfiles).where(and(eq(toolProfiles.companyId, purpose.companyId),
      eq(toolProfiles.profileKey, `app:${connection.id}`), eq(toolProfiles.status, "active"), eq(toolProfiles.defaultAction, "deny"))).for("share");
    if (!profile) return null;
    const bindings = await tx.select({ id: toolProfileBindings.id }).from(toolProfileBindings).where(eq(toolProfileBindings.profileId, profile.id)).limit(1).for("share");
    if (bindings.length) return null;
  }
  return { connection, grant, hash: nativeSha256({ setup: activationConnectionSetupHash(connection, grant), secretMetadata }) };
}

/** Called inside original Apps finish after its profile writes. */
export async function recordDeferredActivationCompletion(tx: Db, purpose: Purpose) {
  const setup = await readDeferredActivationSetup(tx, purpose);
  const [profile] = await tx.select().from(toolProfiles).where(and(eq(toolProfiles.companyId, purpose.companyId),
    eq(toolProfiles.profileKey, `app:${purpose.connectionId}`), eq(toolProfiles.status, "active"), eq(toolProfiles.defaultAction, "deny"))).for("share");
  if (!setup || !profile) throw conflict("The original personal connection needs a current successful validation");
  const bindings = await tx.select({ id: toolProfileBindings.id }).from(toolProfileBindings).where(eq(toolProfileBindings.profileId, profile.id)).limit(1).for("share");
  if (bindings.length) throw conflict("Agent access must remain unassigned during onboarding");
  if (purpose.status === "connected") {
    if (purpose.connectionHash !== setup.hash) throw conflict("The original connection setup changed; review it again");
    return;
  }
  const [changed] = await tx.update(activationConnectionConsents).set({ status: "connected", connectionHash: setup.hash, connectedAt: new Date() })
    .where(and(eq(activationConnectionConsents.id, purpose.id), eq(activationConnectionConsents.status, "allocated"))).returning({ id: activationConnectionConsents.id });
  if (!changed) throw conflict("The original connection decision changed before completion");
}
