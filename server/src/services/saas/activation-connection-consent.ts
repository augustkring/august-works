import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { activationConnectionConsents, agentPackageVersions, companies, toolApplications, toolConnections, type Db } from "@paperclipai/db";
import { activationConnectionConsentCommandSchema, activationConnectionConsentReceiptSchema, activationConnectionReviewSchema, packageReleaseSchema, v9FeatureEnabled } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { toolAccessService, type GalleryAppAllocationOwner } from "../tool-access.js";
import { assertActivationAccess, lockActivationSnapshot, readActivationOwner } from "./activation-owner.js";
import { readFirstAgentCapabilityPin } from "./activation-first-agent.js";

type Receipt = typeof activationConnectionConsents.$inferSelect;
type Methods = Pick<ReturnType<typeof toolAccessService>, "activationConnectionMethod">;
type Method = Awaited<ReturnType<Methods["activationConnectionMethod"]>>;

const publicReceipt = (row: Receipt) => activationConnectionConsentReceiptSchema.parse({
  id: row.id, companyId: row.companyId, onboardingRunId: row.onboardingRunId,
  packageVersionId: row.packageVersionId, applicationId: row.applicationId,
  requestKey: row.requestKey, status: row.status, connectionId: row.connectionId,
  requestedAt: row.requestedAt.toISOString(), connectedAt: row.connectedAt?.toISOString() ?? null,
});

/** Reuse the original onboarding owner and locks. A purpose receipt does not
 * replace current account, company membership, package or Apps authority. */
async function owner(tx: Db, actor: AuthorizationActor, companyId: string, write = false) {
  await assertActivationAccess(tx, actor, companyId);
  await lockActivationSnapshot(tx, companyId);
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
  return { ...current, app, galleryKey, pin, purpose: release.manifest.purpose,
    applicationHash: nativeSha256({ id: app.id, key: app.applicationKey, name: app.name, metadata: app.metadata, updatedAt: app.updatedAt.toISOString() }) };
}

function review(current: Awaited<ReturnType<typeof source>>, method: Method) {
  const fields = {
    companyId: current.run.companyId, onboardingRunId: current.run.id, onboardingVersion: current.run.version,
    packageVersionId: current.pin.versionId, packageContentHash: current.pin.hash,
    applicationId: current.app.id, applicationKey: current.app.applicationKey!, applicationName: current.app.name,
    galleryKey: current.galleryKey, connectionMethodKey: method.method.key, methodHash: nativeSha256(method),
    providerScopes: method.providerScopes, scopeProfile: method.scopeProfile, grantKind: "user", deferAgentAccess: true,
    preview: {
      neededNow: [`Personal sign-in to ${method.providerName}; resource: ${method.resource}`, ...method.providerScopes],
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
    reviewHash: nativeSha256({ ...fields, subjectUserId: current.userId, applicationHash: current.applicationHash }) });
}

/** Explicit C3 purpose decision before original P2 provider setup. External
 * availability reads never run while native company/onboarding locks are held. */
export function activationConnectionConsentService(db: Db, methods: Methods = toolAccessService(db)) {
  async function prepare(actor: AuthorizationActor, companyId: string, applicationKey: string, methodKey?: string) {
    const initial = await db.transaction(tx => source(tx as unknown as Db, actor, companyId, applicationKey));
    const method = await methods.activationConnectionMethod(initial.galleryKey, methodKey);
    return { initial, method };
  }
  return {
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
        if (connections.length) throw conflict("The existing connection needs its own current permission review");
        const [row] = await tx.insert(activationConnectionConsents).values({
          companyId, onboardingRunId: current.run.id, subjectUserId: current.userId,
          packageVersionId: current.pin.versionId, packageContentHash: current.pin.hash, onboardingVersion: current.run.version,
          applicationId: current.app.id, applicationKey, applicationHash: current.applicationHash, galleryKey: current.galleryKey,
          connectionMethodKey: method.method.key, methodHash: currentReview.methodHash,
          requestKey: input.requestKey, requestHash, reviewHash: input.expectedReviewHash,
        }).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: current.userId,
          action: "activation.connection_consent_approved", entityType: "activation_connection_consent", entityId: row!.id,
          details: { onboardingRunId: current.run.id, applicationId: current.app.id, deferredAgentAccess: true } }, publications);
        return publicReceipt(row!);
      });
    },
  };
}
