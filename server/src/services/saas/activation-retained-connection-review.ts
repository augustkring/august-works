import { and, eq, inArray } from "drizzle-orm";
import { companySecrets, connectionGrantDelegations, connectionGrants, toolConnections, toolConnectionInstalls,
  toolProfileBindings, toolProfiles, type Db, activationConnectionConsents } from "@paperclipai/db";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { activationConnectionSetupHash } from "./activation-connection-completion.js";

type Purpose = typeof activationConnectionConsents.$inferSelect;

/** Review metadata for an existing withdrawn personal purpose. This cannot
 * establish validated credentials, complete setup, grant access or resolve a
 * secret. Original provider setup must establish all positive evidence later. */
export async function readRetainedActivationConnectionReview(tx: Db, purpose: Purpose) {
  if (purpose.status !== "withdrawn" || !purpose.connectionId) return null;
  const [connection] = await tx.select().from(toolConnections).where(and(eq(toolConnections.companyId, purpose.companyId),
    eq(toolConnections.id, purpose.connectionId))).for("share");
  if (!connection || connection.applicationId !== purpose.applicationId || connection.createdByUserId !== purpose.subjectUserId ||
      connection.credentialPolicy !== "per_user" || connection.authKind !== "oauth" || connection.credentialSource !== "paperclip_vault" ||
      !["active", "draft"].includes(connection.status) || connection.status === "draft" && connection.enabled ||
      connection.externalCredential || connection.credentialSecretRefs.length)
    return null;
  const installs = await tx.select({ id: toolConnectionInstalls.id }).from(toolConnectionInstalls).where(and(
    eq(toolConnectionInstalls.companyId, purpose.companyId), eq(toolConnectionInstalls.connectionId, connection.id))).limit(1).for("share");
  const profiles = await tx.select().from(toolProfiles).where(and(eq(toolProfiles.companyId, purpose.companyId),
    eq(toolProfiles.profileKey, `app:${connection.id}`))).limit(2).for("share");
  const profile = profiles[0];
  if (installs.length || profiles.length > 1 || profile && (profile.status !== "active" || profile.defaultAction !== "deny") ||
      !profile && connection.status !== "draft") return null;
  const bindings = profile ? await tx.select({ id: toolProfileBindings.id }).from(toolProfileBindings).where(eq(toolProfileBindings.profileId, profile.id)).limit(1).for("share") : [];
  const grants = await tx.select().from(connectionGrants).where(and(eq(connectionGrants.companyId, purpose.companyId),
    eq(connectionGrants.connectionId, connection.id))).orderBy(connectionGrants.id).limit(2).for("share");
  if (bindings.length || grants.length > 1 || grants.some(grant => grant.kind !== "user" || grant.subjectUserId !== purpose.subjectUserId ||
      grant.isDefault || grant.externalCredential)) return null;
  const grant = grants[0];
  if (grant) {
    const delegations = await tx.select({ id: connectionGrantDelegations.id }).from(connectionGrantDelegations).where(and(
      eq(connectionGrantDelegations.companyId, purpose.companyId), eq(connectionGrantDelegations.grantId, grant.id))).limit(1).for("share");
    if (delegations.length) return null;
    const scopes = (connection.config.oauth as { scopes?: unknown } | undefined)?.scopes;
    const grantScopes = grant.providerTenant?.oauth?.scopes;
    if (grant.status === "active" && (grant.revokedAt || !Array.isArray(scopes) || scopes.some(scope => typeof scope !== "string") ||
        !Array.isArray(grantScopes) || grantScopes.some(scope => typeof scope !== "string") ||
        nativeSha256([...grantScopes].sort()) !== nativeSha256([...scopes].sort()))) return null;
  }
  const secretIds = [...new Set(grant?.credentialSecretRefs.map(ref => ref.secretId) ?? [])].sort();
  const secrets = secretIds.length ? await tx.select({ id: companySecrets.id, version: companySecrets.latestVersion,
    scope: companySecrets.scope, owner: companySecrets.ownerUserId, status: companySecrets.status, deletedAt: companySecrets.deletedAt })
    .from(companySecrets).where(and(eq(companySecrets.companyId, purpose.companyId), inArray(companySecrets.id, secretIds)))
    .orderBy(companySecrets.id).for("share") : [];
  return { connection, hash: nativeSha256({ setup: grant ? activationConnectionSetupHash(connection, grant) : {
    connection: { id: connection.id, applicationId: connection.applicationId, companyId: connection.companyId,
      creator: connection.createdByUserId, auth: connection.authKind, policy: connection.credentialPolicy,
      source: connection.credentialSource, transport: connection.transport, config: connection.config,
      transportConfig: connection.transportConfig, status: connection.status, enabled: connection.enabled }, grant: null },
    secrets, profile: profile ? { id: profile.id, defaultAction: profile.defaultAction } : null }) };
}
