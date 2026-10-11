import { and, eq, or, sql } from "drizzle-orm";
import { activationConnectionConsents, connectionGrants, principalPermissionGrants, toolApplications, toolConnections, toolConnectionInstalls, type Db } from "@paperclipai/db";
import { activationRequiredAccessSchema, type ActivationRequiredAccess } from "@paperclipai/shared";
import { getConnectableAppDefinition } from "@paperclipai/shared";
import { activationConnectionMethodSource } from "../tool-access.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { readDeferredActivationSetup } from "./activation-connection-completion.js";
import { readFirstAgentCapabilityPin } from "./activation-first-agent.js";
import type { AuthorizationActor } from "../authorization.js";
import { authorizationService } from "../authorization.js";
import { v5HumanActorId } from "../v5-authorization.js";

/** Current original Apps setup metadata for the initiating human. This does
 * not resolve credentials, contact providers, install anything, grant a future
 * Agent access, or certify representative execution. The original tool and
 * Agent owners still decide whether that Agent may use a connection. */
export async function readActivationRequiredAccess(tx: Db, actor: AuthorizationActor, companyId: string, required: string[], purposeContext?: { runId: string; version: number; packageVersionId: string; step: string }): Promise<ActivationRequiredAccess[]> {
  const keys = [...new Set(required)];
  if (!keys.length) return [];
  if (keys.length > 20) throw new Error("Required access exceeds the original package bound");
  const userId = v5HumanActorId(actor), current = { ...actor, isInstanceAdmin: false, ignoreInstanceAdmin: true };
  // Use current original administration authority, including its original role
  // fallback. Cached account flags and an OAuth grant do not supply this right.
  await tx.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants).where(and(
    eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalType, "user"),
    eq(principalPermissionGrants.principalId, userId), eq(principalPermissionGrants.permissionKey, "tools:admin"),
  )).for("share");
  const permission = await authorizationService(tx).decide({ actor: current, action: "tools:admin", resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true });
  if (!permission.allowed) return keys.map(key => activationRequiredAccessSchema.parse({ key, status: "unavailable", checkedAt: null }));
  const result: ActivationRequiredAccess[] = [];
  for (const key of keys) {
    // Stable original application keys only; display names, endpoints and
    // caller-supplied connection IDs are never inferred as provider authority.
    const apps = await tx.select().from(toolApplications).where(and(
      eq(toolApplications.companyId, companyId), eq(toolApplications.applicationKey, key), eq(toolApplications.status, "active"), sql`${toolApplications.archivedAt} is null`,
    )).orderBy(toolApplications.id).limit(2).for("share");
    if (apps.length !== 1) { result.push({ key, status: apps.length ? "needs_review" : "not_connected", checkedAt: null }); continue; }
    const connections = await tx.select({ id: toolConnections.id, status: toolConnections.status, enabled: toolConnections.enabled,
      health: toolConnections.healthStatus, checked: toolConnections.healthCheckedAt, updated: toolConnections.updatedAt,
      auth: toolConnections.authKind, policy: toolConnections.credentialPolicy,
      sharedCredential: sql<boolean>`jsonb_array_length(${toolConnections.credentialSecretRefs}) > 0 or ${toolConnections.externalCredential} is not null`,
    }).from(toolConnections).where(and(eq(toolConnections.companyId, companyId), eq(toolConnections.applicationId, apps[0]!.id)))
      .orderBy(toolConnections.id).limit(2).for("share");
    if (connections.length !== 1) { result.push({ key, status: connections.length ? "needs_review" : "not_connected", checkedAt: null }); continue; }
    const connection = connections[0]!;
    const purposes = await tx.select().from(activationConnectionConsents).where(and(
      eq(activationConnectionConsents.companyId, companyId), eq(activationConnectionConsents.connectionId, connection.id))).limit(2).for("share");
    if (purposes.length) {
      const purpose = purposes[0]!, app = apps[0]!;
      const pin = purposeContext ? await readFirstAgentCapabilityPin(tx, purposeContext.packageVersionId) : null;
      const setup = purpose.status === "connected" ? await readDeferredActivationSetup(tx, purpose) : null;
      const definition = getConnectableAppDefinition(purpose.galleryKey);
      const method = definition?.methods.find(candidate => candidate.key === purpose.connectionMethodKey);
      let methodCurrent = false;
      if (definition && method) {
        try { methodCurrent = nativeSha256(activationConnectionMethodSource(definition, method)) === purpose.methodHash; }
        catch { /* Unsupported original profiles remain unqualified setup. */ }
      }
      const recorded = !!methodCurrent && purposes.length === 1 && !!purposeContext && purpose.onboardingRunId === purposeContext.runId &&
        purpose.subjectUserId === userId && purpose.packageVersionId === purposeContext.packageVersionId &&
        purposeContext.version >= purpose.onboardingVersion && (purposeContext.step !== "access" || purposeContext.version === purpose.onboardingVersion) &&
        pin?.hash === purpose.packageContentHash && nativeSha256({ id: app.id, key: app.applicationKey, name: app.name,
          metadata: app.metadata, status: app.status, archivedAt: app.archivedAt?.toISOString() ?? null }) === purpose.applicationHash &&
        !!setup && setup.hash === purpose.connectionHash;
      result.push(activationRequiredAccessSchema.parse({ key, status: recorded ? "recorded" : "needs_review",
        checkedAt: connection.checked?.toISOString() ?? null }));
      continue;
    }
    const installs = await tx.select({ id: toolConnectionInstalls.id }).from(toolConnectionInstalls).where(and(
      eq(toolConnectionInstalls.companyId, companyId), eq(toolConnectionInstalls.connectionId, connection.id),
      eq(toolConnectionInstalls.targetType, "company"), sql`lower(${toolConnectionInstalls.targetId})=${companyId.toLowerCase()}`,
    )).limit(2).for("share");
    const grants = await tx.select({ id: connectionGrants.id, kind: connectionGrants.kind,
      credential: sql<boolean>`jsonb_array_length(${connectionGrants.credentialSecretRefs}) > 0 or ${connectionGrants.externalCredential} is not null`,
    }).from(connectionGrants).where(and(eq(connectionGrants.companyId, companyId), eq(connectionGrants.connectionId, connection.id),
      eq(connectionGrants.status, "active"), sql`${connectionGrants.revokedAt} is null`,
      or(and(eq(connectionGrants.kind, "organization"), eq(connectionGrants.isDefault, true)),
        and(eq(connectionGrants.kind, "user"), eq(connectionGrants.subjectUserId, userId))),
    )).orderBy(connectionGrants.id).limit(3).for("share");
    const personal = grants.filter(grant => grant.kind === "user");
    const organization = grants.filter(grant => grant.kind === "organization");
    const personalRecorded = personal.length === 1 && personal[0]!.credential;
    const sharedRecorded = organization.length <= 1 && (organization[0]?.credential || connection.sharedCredential);
    // A different person's grant never satisfies per-user setup. A dedicated
    // Agent grant requires the original Agent owner and cannot be inferred
    // before that Agent exists. This remains setup metadata, not tool access.
    const credentialRecorded = connection.auth === "none" ||
      (connection.policy === "per_user" && personalRecorded) ||
      (connection.policy === "shared" && sharedRecorded) ||
      (connection.policy === "per_user_with_fallback" && (personalRecorded || sharedRecorded));
    const active = connection.status === "active" && connection.enabled;
    const observed = connection.health === "ok" && connection.checked !== null && connection.checked >= connection.updated;
    const recorded = active && observed && installs.length === 1 && grants.length <= 2 && credentialRecorded;
    result.push(activationRequiredAccessSchema.parse({ key,
      status: recorded ? "recorded" : active ? "needs_review" : "not_connected", checkedAt: connection.checked?.toISOString() ?? null }));
  }
  return result;
}
