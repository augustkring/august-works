import { randomUUID } from "node:crypto";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { activationConnectionConsents, agentPackageVersions, companies, toolApplications, toolConnections, type Db } from "@paperclipai/db";
import { getConnectableAppDefinition, activationConnectionConsentCommandSchema, activationConnectionConsentWithdrawalCommandSchema, activationConnectionConsentReceiptSchema, activationConnectionReviewSchema, packageReleaseSchema, v9FeatureEnabled } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { toolAccessService, activationConnectionMethodSource, type GalleryAppAllocationOwner } from "../tool-access.js";
import { readDeferredActivationSetup, recordDeferredActivationCompletion } from "./activation-connection-completion.js";
import { readRetainedActivationConnectionReview } from "./activation-retained-connection-review.js";
import { assertActivationAccess, lockActivationSnapshot, readActivationOwner } from "./activation-owner.js";
import { readFirstAgentCapabilityPin } from "./activation-first-agent.js";

type Receipt = typeof activationConnectionConsents.$inferSelect;
type Methods = Pick<ReturnType<typeof toolAccessService>, "activationConnectionMethod">;
type Method = Awaited<ReturnType<Methods["activationConnectionMethod"]>>;

const publicReceipt = (row: Receipt) => activationConnectionConsentReceiptSchema.parse({
  id: row.id, companyId: row.companyId, onboardingRunId: row.onboardingRunId,
  packageVersionId: row.packageVersionId, applicationId: row.applicationId,
  requestKey: row.requestKey, status: row.status, connectionId: row.connectionId,
  reviewHash: row.reviewHash, onboardingVersion: row.onboardingVersion,
  requestedAt: row.requestedAt.toISOString(), connectedAt: row.connectedAt?.toISOString() ?? null,
});

/** Reuse the original onboarding owner and locks. A purpose receipt does not
 * replace current account, company membership, package or Apps authority. */
async function owner(tx: Db, actor: AuthorizationActor, companyId: string, write = false) {
  await assertActivationAccess(tx, actor, companyId);
  await lockActivationSnapshot(tx, companyId, write ? "write" : "read");
  await assertActivationAccess(tx, actor, companyId, true);
  const query = tx.select().from(companies).where(eq(companies.id, companyId));
  const [company] = await (write ? query.for("update") : query.for("share"));
  if (!company || company.status !== "active") throw forbidden("Company setup is unavailable");
  return readActivationOwner(tx, actor, companyId, write);
}

async function source(tx: Db, actor: AuthorizationActor, companyId: string, applicationKey: string) {
  const current = await owner(tx, actor, companyId, true);
  if (!v9FeatureEnabled(await instanceSettingsService(tx).getExperimental(), "activation_v9")) throw notFound("Activation changes are not enabled");
  if (current.run.status !== "in_progress" || current.state.step !== "access" || !current.state.packageVersionId)
    throw conflict("Review access at the current setup step");
  await assertV5Authorization(tx, { ...actor, ignoreInstanceAdmin: true }, companyId, "tools:admin");
  const pin = await readFirstAgentCapabilityPin(tx, current.state.packageVersionId);
  if (!pin) throw conflict("The selected capability is no longer qualified");
  const [version] = await tx.select().from(agentPackageVersions).where(eq(agentPackageVersions.id, pin.versionId));
  const release = packageReleaseSchema.parse(version!.release);
  if (!release.manifest.requiredConnections.includes(applicationKey)) throw notFound("Required connection not found");
  const apps = await tx.select().from(toolApplications).where(and(eq(toolApplications.companyId, companyId),
    eq(toolApplications.applicationKey, applicationKey), eq(toolApplications.status, "active"))).orderBy(toolApplications.id).limit(2).for("share");
  if (apps.length !== 1 || apps[0]!.archivedAt) throw conflict("The original required application is unavailable");
  const app = apps[0]!;
  const galleryKey = app.metadata?.sourceTemplateKey ?? app.metadata?.galleryKey;
  if (typeof galleryKey !== "string") throw conflict("The original application provider needs review");
  const [approvedPurpose] = await tx.select().from(activationConnectionConsents).where(and(
    eq(activationConnectionConsents.companyId, companyId), eq(activationConnectionConsents.onboardingRunId, current.run.id),
    eq(activationConnectionConsents.applicationId, app.id), eq(activationConnectionConsents.subjectUserId, current.userId),
    ne(activationConnectionConsents.status, "withdrawn"))).for("share");
  const connections = await tx.select().from(toolConnections).where(and(eq(toolConnections.companyId, companyId),
    eq(toolConnections.applicationId, app.id))).orderBy(toolConnections.id).limit(2).for("share");
  if (connections.length > 1) throw conflict("The exact original connection needs review");
  const connection = connections[0];
  let existingConnection: { id: string; name: string; setupHash: string; needsValidation?: true } | null = null;
  let existingMethodKey: string | undefined = approvedPurpose?.connectionMethodKey;
  let supersedesConsentId = approvedPurpose?.supersedesConsentId ?? null;
  if (connection) {
    const [owned] = await tx.select().from(activationConnectionConsents).where(and(eq(activationConnectionConsents.companyId, companyId),
      or(eq(activationConnectionConsents.connectionId, connection.id), eq(activationConnectionConsents.reservedConnectionId, connection.id))))
      .orderBy(sql`${activationConnectionConsents.status}='withdrawn'`, desc(activationConnectionConsents.requestedAt), desc(activationConnectionConsents.id)).limit(1).for("share");
    if (owned && (owned.onboardingRunId !== current.run.id || owned.subjectUserId !== current.userId))
      throw conflict("This retained connection needs a separate current purpose renewal");
    if (owned?.status === "withdrawn") supersedesConsentId = owned.id;
    if (!owned || owned.status === "withdrawn" || owned.existingConnectionId) {
      const setup = await readDeferredActivationSetup(tx, { companyId, applicationId: app.id, connectionId: connection.id, subjectUserId: current.userId });
      const retained = owned?.status === "withdrawn" && !setup ? await readRetainedActivationConnectionReview(tx, owned) : null;
      if (((!owned || owned.status === "withdrawn") && !setup && !retained) || typeof connection.config.connectionMethodKey !== "string" || connection.config.sourceTemplateKey !== galleryKey)
        throw conflict("The existing personal connection needs its original access review and validation");
      const definition = getConnectableAppDefinition(galleryKey), selectedMethod = definition?.methods.find(candidate => candidate.key === connection.config.connectionMethodKey);
      if (!definition || !selectedMethod) throw conflict("The original provider method is unavailable");
      const original = activationConnectionMethodSource(definition, selectedMethod), oauth = connection.config.oauth as Record<string, unknown> | undefined;
      if (connection.config.url !== original.resource || oauth?.resource !== original.resource || oauth.connectorProfile !== original.scopeProfile ||
          oauth.strategy !== selectedMethod.oauthStrategy || !["google", galleryKey].includes(String(oauth.provider)) ||
          nativeSha256(oauth.scopes) !== nativeSha256(original.providerScopes))
        throw conflict("The existing provider resource or scopes need a separate review");
      // A current unchanged business purpose survives credential expiry. Its
      // original adoption pin stays immutable; only Original finish can append
      // positive proof for a new validated credential version.
      const needsValidation = owned && owned.status !== "withdrawn" ? !owned.existingSetupValidated : !!retained;
      existingConnection = { id: connection.id, name: connection.name,
        setupHash: owned && owned.status !== "withdrawn" ? owned.existingSetupHash! : (setup ?? retained)!.hash,
        ...(needsValidation ? { needsValidation: true as const } : {}) };
      existingMethodKey = connection.config.connectionMethodKey;
    }
  }
  return { ...current, app, galleryKey, pin, existingConnection, existingMethodKey, supersedesConsentId, purpose: release.manifest.purpose,
    applicationHash: nativeSha256({ id: app.id, key: app.applicationKey, name: app.name, metadata: app.metadata, status: app.status, archivedAt: app.archivedAt?.toISOString() ?? null }) };
}

function review(current: Awaited<ReturnType<typeof source>>, method: Method) {
  const fields = {
    // Preserve existing root-purpose hashes; a successor separately pins the
    // exact withdrawn parent, whose old approval can never become current.
    ...(current.supersedesConsentId ? { supersedesConsentId: current.supersedesConsentId } : {}),
    companyId: current.run.companyId, onboardingRunId: current.run.id, onboardingVersion: current.run.version,
    packageVersionId: current.pin.versionId, packageContentHash: current.pin.hash,
    applicationId: current.app.id, applicationKey: current.app.applicationKey!, applicationName: current.app.name,
    galleryKey: current.galleryKey, connectionMethodKey: method.method.key, methodHash: nativeSha256(method),
    existingConnection: current.existingConnection,
    providerScopes: method.providerScopes, scopeProfile: method.scopeProfile, grantKind: "user", deferAgentAccess: true,
    preview: {
      neededNow: [current.existingConnection ? current.existingConnection.needsValidation
        ? `Review the retained personal ${method.providerName} connection ${current.existingConnection.name}; sign-in and current validation are still required; resource: ${method.resource}`
        : `Reuse the exact validated personal ${method.providerName} connection ${current.existingConnection.name}; resource: ${method.resource}`
        : `Personal sign-in to ${method.providerName}; resource: ${method.resource}`, ...method.providerScopes],
      why: current.purpose,
      usedBy: `${current.pin.name}; no Agent receives this connection during setup.`,
      canRead: [`Provider sign-in requests exactly these scopes: ${method.providerScopes.join(", ")}. Access covers the account authorized at the provider.`],
      canChange: [method.providerWriteTools.length ? `The provider profile includes: ${method.providerWriteTools.join(", ")}. These are not authorized for an Agent by this decision.` : "The selected provider profile has no write tools.",
        "August Works authorizes no business changes or Agent actions in this setup decision. Provider scopes may be broader than those actions."],
      notRequested: ["No organization identity, company installation or Agent access.", "No August Works permission to send messages, delete data, spend money or broaden access."],
      automatic: ["No Agent execution. Sign-in and connection validation use the original connection owner; later use needs a separate current purpose and Safe Test."],
      asksFirst: ["Agent access and automatic business actions need a separate reviewed decision.", "External communication, changes, deletion, spending and broader permissions require their own approval."],
    },
  };
  return activationConnectionReviewSchema.parse({ ...fields,
    supersedesConsentId: current.supersedesConsentId,
    explanation: { providerName: method.providerName, resource: method.resource,
      capabilityName: current.pin.name, providerWriteTools: method.providerWriteTools },
    reviewHash: nativeSha256({ ...fields, subjectUserId: current.userId, applicationHash: current.applicationHash }) });
}

/** Explicit C3 purpose decision before original P2 provider setup. External
 * availability reads never run while native company/onboarding locks are held. */
export function activationConnectionConsentService(db: Db, methods: Methods = toolAccessService(db)) {
  async function prepare(actor: AuthorizationActor, companyId: string, applicationKey: string, methodKey?: string) {
    const initial = await db.transaction(tx => source(tx as unknown as Db, actor, companyId, applicationKey));
    if (initial.existingMethodKey && methodKey && methodKey !== initial.existingMethodKey)
      throw conflict("Reusing a connection must preserve its original provider method");
    const method = await methods.activationConnectionMethod(initial.galleryKey, initial.existingMethodKey ?? methodKey);
    return { initial, method };
  }
  return {
    async getCurrentReceipt(actor: AuthorizationActor, companyId: string, applicationKey: string) {
      return db.transaction(async tx => {
        const current = await owner(tx as unknown as Db, actor, companyId);
        const rows = await tx.select().from(activationConnectionConsents).where(and(
          eq(activationConnectionConsents.companyId, companyId), eq(activationConnectionConsents.onboardingRunId, current.run.id),
          eq(activationConnectionConsents.subjectUserId, current.userId), eq(activationConnectionConsents.applicationKey, applicationKey),
          ne(activationConnectionConsents.status, "withdrawn"))).orderBy(activationConnectionConsents.id).limit(2);
        if (rows.length > 1) throw conflict("The original application identity needs review");
        return rows[0] ? publicReceipt(rows[0]) : null;
      });
    },
    async withdraw(actor: AuthorizationActor, companyId: string, requestKey: string, raw: unknown) {
      const input = activationConnectionConsentWithdrawalCommandSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const current = await owner(tx, actor, companyId, true);
        await assertV5Authorization(tx, { ...actor, ignoreInstanceAdmin: true }, companyId, "tools:admin");
        const [row] = await tx.select().from(activationConnectionConsents).where(and(
          eq(activationConnectionConsents.companyId, companyId), eq(activationConnectionConsents.onboardingRunId, current.run.id),
          eq(activationConnectionConsents.subjectUserId, current.userId), eq(activationConnectionConsents.requestKey, requestKey))).for("update");
        if (!row) throw notFound("Original connection consent receipt not found");
        if (row.reviewHash !== input.expectedReviewHash) throw conflict("The original purpose decision changed; review it again");
        if (row.status === "withdrawn") return publicReceipt(row);
        const [changed] = await tx.update(activationConnectionConsents).set({ status: "withdrawn" })
          .where(eq(activationConnectionConsents.id, row.id)).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: current.userId,
          action: "activation.connection_consent_withdrawn", entityType: "activation_connection_consent", entityId: row.id,
          details: { connectionId: row.connectionId, providerCredentialRevocation: "original_apps_owner" } }, publications);
        return publicReceipt(changed!);
      });
    },
    /** Internal callbacks for the existing Apps allocator. Claim precedes P2;
     * guard and binding share the original connection insertion transaction. */
    allocationOwner(actor: AuthorizationActor, companyId: string, requestKey: string): GalleryAppAllocationOwner {
      let claimed: Receipt | null = null;
      let method: Method | null = null;
      async function currentReceipt(tx: Db) {
        if (!claimed || !method) throw conflict("Original connection allocation has not been claimed");
        const current = await source(tx, actor, companyId, claimed.applicationKey);
        const [row] = await tx.select().from(activationConnectionConsents).where(eq(activationConnectionConsents.id, claimed.id)).for("update");
        if (!row || row.subjectUserId !== current.userId || row.status !== "allocating" || row.reservedConnectionId !== claimed.reservedConnectionId ||
            current.galleryKey !== method.galleryKey || review(current, method).reviewHash !== row.reviewHash)
          throw conflict("The approved connection is no longer current");
        return row;
      }
      return {
        async claim(originalMethod) {
          method = originalMethod;
          return withV7ActivityTransaction(db, async (tx, publications) => {
            const current = await owner(tx, actor, companyId, true);
            const [row] = await tx.select().from(activationConnectionConsents).where(and(
              eq(activationConnectionConsents.companyId, companyId), eq(activationConnectionConsents.onboardingRunId, current.run.id),
              eq(activationConnectionConsents.requestKey, requestKey), eq(activationConnectionConsents.subjectUserId, current.userId))).for("update");
            if (!row) throw notFound("Original connection approval not found");
            if (row.status !== "approved") throw conflict("Read the original allocation receipt before continuing", { code: "ACTIVATION_CONNECTION_ALLOCATION_PENDING" });
            const selected = await source(tx, actor, companyId, row.applicationKey);
            if (selected.galleryKey !== originalMethod.galleryKey || review(selected, originalMethod).reviewHash !== row.reviewHash)
              throw conflict("The approved connection method changed; review it again");
            const [existing] = await tx.select({ id: toolConnections.id }).from(toolConnections).where(and(
              eq(toolConnections.companyId, companyId), eq(toolConnections.applicationId, row.applicationId))).limit(1).for("share");
            if (existing) throw conflict("An existing connection needs its own current review");
            const reservedConnectionId = randomUUID();
            const [changed] = await tx.update(activationConnectionConsents).set({ status: "allocating", reservedConnectionId })
              .where(and(eq(activationConnectionConsents.id, row.id), eq(activationConnectionConsents.status, "approved"))).returning();
            if (!changed) throw conflict("The original allocation was already claimed");
            claimed = changed;
            await logActivity(tx, { companyId, actorType: "user", actorId: current.userId,
              action: "activation.connection_allocation_claimed", entityType: "activation_connection_consent", entityId: row.id,
              details: { onboardingRunId: row.onboardingRunId, applicationId: row.applicationId } }, publications);
            return reservedConnectionId;
          });
        },
        async guard(tx) { await currentReceipt(tx); },
        async bind(tx, connection, publications) {
          const row = await currentReceipt(tx);
          if (connection.id !== row.reservedConnectionId || connection.companyId !== companyId || connection.applicationId !== row.applicationId ||
              connection.createdByUserId !== row.subjectUserId || connection.credentialPolicy !== "per_user" ||
              connection.credentialSecretRefs.length || connection.externalCredential || connection.authKind !== "oauth" ||
              connection.config.sourceTemplateKey !== row.galleryKey || connection.config.connectionMethodKey !== row.connectionMethodKey)
            throw conflict("The original allocation does not match the approved personal connection");
          const [bound] = await tx.update(activationConnectionConsents).set({ status: "allocated", connectionId: connection.id })
            .where(and(eq(activationConnectionConsents.id, row.id), eq(activationConnectionConsents.status, "allocating"))).returning();
          if (!bound) throw conflict("The original connection binding changed");
          // The enclosing original allocator retains the row on later provider
          // failure. No second allocator, grant owner or credential store exists.
          await logActivity(tx, { companyId, actorType: "user", actorId: row.subjectUserId,
            action: "activation.connection_allocated", entityType: "activation_connection_consent", entityId: row.id,
            details: { connectionId: connection.id, deferredAgentAccess: true } }, publications);
        },
      };
    },
    async getApprovedSetup(actor: AuthorizationActor, companyId: string, requestKey: string) {
      return db.transaction(async tx => {
        const current = await owner(tx as unknown as Db, actor, companyId);
        await assertV5Authorization(tx as unknown as Db, { ...actor, ignoreInstanceAdmin: true }, companyId, "tools:admin");
        const [row] = await tx.select().from(activationConnectionConsents).where(and(
          eq(activationConnectionConsents.companyId, companyId), eq(activationConnectionConsents.onboardingRunId, current.run.id),
          eq(activationConnectionConsents.subjectUserId, current.userId), eq(activationConnectionConsents.requestKey, requestKey)));
        if (!row) throw notFound("Connection consent receipt not found");
        if (row.status !== "approved") throw conflict("Read the original allocation receipt before continuing", { code: "ACTIVATION_CONNECTION_ALLOCATION_PENDING" });
        return { galleryKey: row.galleryKey, connectionMethodKey: row.connectionMethodKey, applicationId: row.applicationId,
          grantKind: "user" as const };
      });
    },
    async getReview(actor: AuthorizationActor, companyId: string, applicationKey: string, methodKey?: string) {
      const { method } = await prepare(actor, companyId, applicationKey, methodKey);
      return db.transaction(async tx => {
        const current = await source(tx as unknown as Db, actor, companyId, applicationKey);
        if (current.galleryKey !== method.galleryKey) throw conflict("The connection provider changed; review it again");
        return review(current, method);
      });
    },
    async getReceipt(actor: AuthorizationActor, companyId: string, requestKey: string) {
      return db.transaction(async tx => {
        const current = await owner(tx as unknown as Db, actor, companyId);
        const [row] = await tx.select().from(activationConnectionConsents).where(and(
          eq(activationConnectionConsents.companyId, companyId), eq(activationConnectionConsents.onboardingRunId, current.run.id),
          eq(activationConnectionConsents.subjectUserId, current.userId), eq(activationConnectionConsents.requestKey, requestKey)));
        if (!row) throw notFound("Connection consent receipt not found");
        return publicReceipt(row);
      });
    },
    async approve(actor: AuthorizationActor, companyId: string, applicationKey: string, raw: unknown, methodKey?: string) {
      const input = activationConnectionConsentCommandSchema.parse(raw);
      const { method } = await prepare(actor, companyId, applicationKey, methodKey);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const current = await source(tx, actor, companyId, applicationKey);
        const requestHash = nativeSha256({ applicationKey, ...input });
        const [existing] = await tx.select().from(activationConnectionConsents).where(and(
          eq(activationConnectionConsents.companyId, companyId), eq(activationConnectionConsents.onboardingRunId, current.run.id),
          eq(activationConnectionConsents.requestKey, input.requestKey))).for("update");
        if (existing) {
          if (existing.subjectUserId !== current.userId || existing.requestHash !== requestHash) throw conflict("Request key has different content");
          return publicReceipt(existing);
        }
        const currentReview = review(current, method);
        if (current.galleryKey !== method.galleryKey || currentReview.reviewHash !== input.expectedReviewHash)
          throw conflict("The reviewed connection changed; review it again");
        const connections = await tx.select({ id: toolConnections.id }).from(toolConnections).where(and(
          eq(toolConnections.companyId, companyId), eq(toolConnections.applicationId, current.app.id))).limit(1).for("share");
        if (connections.length && connections[0]!.id !== current.existingConnection?.id) throw conflict("The existing connection needs its own current permission review");
        const [row] = await tx.insert(activationConnectionConsents).values({
          companyId, onboardingRunId: current.run.id, subjectUserId: current.userId,
          packageVersionId: current.pin.versionId, packageContentHash: current.pin.hash, onboardingVersion: current.run.version,
          applicationId: current.app.id, applicationKey, applicationHash: current.applicationHash, galleryKey: current.galleryKey,
          connectionMethodKey: method.method.key, methodHash: currentReview.methodHash,
          requestKey: input.requestKey, requestHash, reviewHash: input.expectedReviewHash,
          supersedesConsentId: current.supersedesConsentId,
          existingConnectionId: current.existingConnection?.id ?? null, existingSetupHash: current.existingConnection?.setupHash ?? null,
          existingSetupValidated: !current.existingConnection?.needsValidation,
        }).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: current.userId,
          action: "activation.connection_consent_approved", entityType: "activation_connection_consent", entityId: row!.id,
          details: { onboardingRunId: current.run.id, applicationId: current.app.id, deferredAgentAccess: true } }, publications);
        if (current.existingConnection) {
          // C3 adopts the real original row in this same Native snapshot. It
          // allocates nothing, copies no credentials and starts no provider I/O.
          await tx.update(activationConnectionConsents).set({ status: "allocating", reservedConnectionId: current.existingConnection.id })
            .where(eq(activationConnectionConsents.id, row!.id));
          const [bound] = await tx.update(activationConnectionConsents).set({ status: "allocated", connectionId: current.existingConnection.id })
            .where(eq(activationConnectionConsents.id, row!.id)).returning();
          if (!current.existingConnection.needsValidation) await recordDeferredActivationCompletion(tx, bound!);
          const [adopted] = await tx.select().from(activationConnectionConsents).where(eq(activationConnectionConsents.id, row!.id));
          await logActivity(tx, { companyId, actorType: "user", actorId: current.userId,
            action: current.existingConnection.needsValidation ? "activation.connection_purpose_validation_pending" : "activation.connection_purpose_adopted",
            entityType: "activation_connection_consent", entityId: row!.id,
            details: { connectionId: current.existingConnection.id, newAllocation: false, deferredAgentAccess: true,
              validationPending: !!current.existingConnection.needsValidation } }, publications);
          return publicReceipt(adopted!);
        }
        return publicReceipt(row!);
      });
    },
  };
}
