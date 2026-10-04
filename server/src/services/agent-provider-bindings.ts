import { skillLifecycleService } from "./skill-lifecycle.js";
import { withV5ActivityTransaction } from "./v5-mutations.js";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { agentIdentities, agentPresenceRuntimeBindings, agentProviderBindings, agents, providerSharedRuntimeAcknowledgements, type Db } from "@paperclipai/db";
import { PROVIDER_ISOLATION_WARNING_VERSION, type ProviderCapabilitySnapshot, type createProviderBindingSchema, type attachProviderBindingSchema } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict, forbidden, notFound } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { logActivity, type ActivityPublication } from "./activity-log.js";
import { hashContextPolicySnapshot } from "./context/context-manifest.js";
import { makeProviderCapabilitySnapshot, providerCapabilityChanges, providerConformanceRequirements } from "./provider-capabilities.js";
import { getServerAdapter } from "../adapters/index.js";

type IsolationPeerProof = { companyId: string; agentId: string; runtimeId: string; bindingId: string; profileRef: string; configurationHash: string };

export function agentProviderBindingService(db: Db) {
  async function localPresence(tx: Db, companyId: string, agentId: string) {
    const [presence] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId), ne(agents.status, "terminated"))).limit(1);
    if (!presence) throw notFound("Agent presence not found");
    return presence;
  }
  async function lockIdentity(tx: Db, identityId: string) {
    const [identity] = await tx.select().from(agentIdentities).where(eq(agentIdentities.id, identityId)).limit(1).for("update");
    if (!identity || identity.status !== "active") throw conflict("An active logical identity is required");
    return identity;
  }
  async function audit(tx: Db, actor: AuthorizationActor, companyId: string, bindingId: string, action: string, publications: ActivityPublication[]) {
    await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action, entityType: "agent_provider_binding", entityId: bindingId }, publications);
  }
  async function assertIsolationPeerCurrent(tx: Db, report: Record<string, unknown> | null) {
    const pin = report?.isolationPeer as IsolationPeerProof | undefined;
    if (!pin) return;
    const [peer] = await tx.select({ runtime: agentPresenceRuntimeBindings, agent: agents }).from(agentPresenceRuntimeBindings).innerJoin(agents, and(eq(agents.id, agentPresenceRuntimeBindings.agentId), eq(agents.companyId, agentPresenceRuntimeBindings.companyId))).where(and(eq(agentPresenceRuntimeBindings.companyId, pin.companyId), eq(agentPresenceRuntimeBindings.agentId, pin.agentId))).limit(1);
    if (!peer || peer.runtime.status === "revoked" || peer.agent.status === "terminated" || peer.runtime.id !== pin.runtimeId || peer.runtime.providerBindingId !== pin.bindingId || peer.runtime.providerProfileRef !== pin.profileRef || hashContextPolicySnapshot({ adapterType: peer.agent.adapterType, adapterConfig: peer.agent.adapterConfig }) !== pin.configurationHash) throw conflict("The isolation peer profile/configuration changed; repeat conformance");
  }
  async function assertSharedAcknowledgements(tx: Db, bindingId: string, companyIds: string[]) {
    const acknowledgements = await tx.select({ companyId: providerSharedRuntimeAcknowledgements.companyId }).from(providerSharedRuntimeAcknowledgements).where(and(
      eq(providerSharedRuntimeAcknowledgements.providerBindingId, bindingId),
      eq(providerSharedRuntimeAcknowledgements.warningVersion, PROVIDER_ISOLATION_WARNING_VERSION),
      isNull(providerSharedRuntimeAcknowledgements.revokedAt),
    )).limit(501);
    const accepted = new Set(acknowledgements.map((ack) => ack.companyId));
    if (companyIds.some((id) => !accepted.has(id))) throw conflict("Every participating company must acknowledge reduced provider isolation");
  }
  return {
    assertReducedIsolationAcknowledgements: async (bindingId: string) => {
      await assertV5Enabled(db, "shared_trusted_runtime_v5");
      const peers = await db.select({ companyId: agentPresenceRuntimeBindings.companyId }).from(agentPresenceRuntimeBindings).where(and(eq(agentPresenceRuntimeBindings.providerBindingId, bindingId), ne(agentPresenceRuntimeBindings.status, "revoked"))).limit(501);
      if (peers.length > 500) throw conflict("Provider presence limit reached");
      await assertSharedAcknowledgements(db, bindingId, peers.map((peer) => peer.companyId));
    },
    getForPresence: async (actor: AuthorizationActor, companyId: string, agentId: string) => {
      await assertV5Enabled(db, "agent_provider_bindings_v5");
      await assertV5Authorization(db, actor, companyId, "agent_config:read", { type: "agent", companyId, agentId });
      await localPresence(db, companyId, agentId);
      const [record] = await db.select({ runtime: agentPresenceRuntimeBindings, provider: agentProviderBindings }).from(agentPresenceRuntimeBindings)
        .innerJoin(agentProviderBindings, eq(agentPresenceRuntimeBindings.providerBindingId, agentProviderBindings.id))
        .where(and(eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, agentId))).limit(1);
      return record ?? null;
    },
    create: async (actor: AuthorizationActor, companyId: string, agentId: string, input: z.infer<typeof createProviderBindingSchema>) => {
      await assertV5Enabled(db, "agent_provider_bindings_v5");
      v5HumanActorId(actor);
      await assertV5Authorization(db, actor, companyId, "agents:configure", { type: "agent", companyId, agentId });
      if (input.isolationMode === "shared_trusted_runtime") await assertV5Enabled(db, "shared_trusted_runtime_v5");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const presence = await localPresence(tx, companyId, agentId);
        const identity = await lockIdentity(tx, presence.agentIdentityId);
        // Sharing decisions are owned at home and independently acknowledged
        // locally. A guest configuration grant cannot widen identity policy.
        if (input.isolationMode === "shared_trusted_runtime") await assertV5Authorization(tx, actor, identity.homeCompanyId, "agents:configure");
        const config = presence.adapterConfig as Record<string, unknown>, configuredUrl = config.apiBaseUrl ?? config.url;
        let endpointRef = input.providerEndpointRef;
        if (typeof configuredUrl === "string" && configuredUrl.trim()) {
          let endpoint: URL;
          const canonicalize = getServerAdapter(presence.adapterType).canonicalProviderEndpoint;
          const normalized = canonicalize ? canonicalize(configuredUrl) : configuredUrl;
          if (!normalized) throw conflict("Configure a valid provider URL before creating the binding");
          try { endpoint = new URL(normalized); } catch { throw conflict("Configure a valid provider URL before creating the binding"); }
          endpoint.username = ""; endpoint.password = ""; endpoint.hash = ""; endpoint.search = "";
          endpoint.pathname = endpoint.pathname.replace(/\/+$/, "") || "/";
          endpointRef = `endpoint:${hashContextPolicySnapshot(endpoint.toString())}`;
        }
        const [binding] = await tx.insert(agentProviderBindings).values({ ...input, providerEndpointRef: endpointRef, agentIdentityId: identity.id }).returning();
        await audit(tx, actor, companyId, binding!.id, "provider_binding.created", publications);
        return binding!;
      });
    },
    attach: async (actor: AuthorizationActor, companyId: string, agentId: string, input: z.infer<typeof attachProviderBindingSchema>) => {
      await assertV5Enabled(db, "agent_provider_bindings_v5");
      v5HumanActorId(actor);
      await assertV5Authorization(db, actor, companyId, "agents:configure", { type: "agent", companyId, agentId });
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const presence = await localPresence(tx, companyId, agentId);
        await lockIdentity(tx, presence.agentIdentityId);
        const [binding] = await tx.select().from(agentProviderBindings).where(and(eq(agentProviderBindings.id, input.providerBindingId), eq(agentProviderBindings.agentIdentityId, presence.agentIdentityId))).limit(1).for("update");
        if (!binding || binding.status === "revoked") throw notFound("Provider binding not found");
        const peers = await tx.select().from(agentPresenceRuntimeBindings).where(and(eq(agentPresenceRuntimeBindings.providerBindingId, binding.id), ne(agentPresenceRuntimeBindings.agentId, agentId), ne(agentPresenceRuntimeBindings.status, "revoked"))).limit(501);
        if (peers.length >= 500) throw conflict("Provider presence limit reached");
        if (binding.isolationMode === "isolated_per_presence" && peers.length) throw conflict("An isolated provider binding belongs to one presence");
        // Separate binding UUIDs must not disguise reuse of the same physical
        // provider agent. Serialize the check across logical identities too.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${binding.providerType}:${binding.providerEndpointRef ?? "local"}:${binding.providerAgentRef}`}, 0))`);
        const aliases = await tx.select({ agentId: agentPresenceRuntimeBindings.agentId, isolationMode: agentProviderBindings.isolationMode, bindingId: agentProviderBindings.id })
          .from(agentPresenceRuntimeBindings).innerJoin(agentProviderBindings, eq(agentPresenceRuntimeBindings.providerBindingId, agentProviderBindings.id))
          .where(and(eq(agentProviderBindings.providerType, binding.providerType),
            binding.providerEndpointRef === null ? isNull(agentProviderBindings.providerEndpointRef) : eq(agentProviderBindings.providerEndpointRef, binding.providerEndpointRef),
            eq(agentProviderBindings.providerAgentRef, binding.providerAgentRef),
            ne(agentPresenceRuntimeBindings.agentId, agentId), ne(agentPresenceRuntimeBindings.status, "revoked"))).limit(501);
        if (aliases.length && (binding.isolationMode === "isolated_per_presence" || aliases.some((alias) => alias.isolationMode === "isolated_per_presence" || alias.bindingId !== binding.id))) {
          throw conflict("This physical provider agent is already assigned to another presence; explicitly share one acknowledged binding or use an isolated provider profile");
        }
        if (binding.isolationMode === "shared_trusted_runtime") {
          await assertV5Enabled(tx, "shared_trusted_runtime_v5");
          await assertSharedAcknowledgements(tx, binding.id, [companyId, ...peers.map((peer) => peer.companyId)]);
        }
        const [runtime] = await tx.insert(agentPresenceRuntimeBindings).values({
          companyId, agentId, agentIdentityId: presence.agentIdentityId, providerBindingId: binding.id,
          providerProfileRef: input.providerProfileRef,
          providerSessionNamespace: `aw:v5:company:${companyId}:agent:${agentId}`,
          status: binding.status === "degraded" ? "degraded" : "active",
        }).onConflictDoUpdate({ target: [agentPresenceRuntimeBindings.companyId, agentPresenceRuntimeBindings.agentId], set: {
          providerBindingId: binding.id, providerProfileRef: input.providerProfileRef,
          status: binding.status === "degraded" ? "degraded" : "active", updatedAt: new Date(),
        } }).returning();
        await audit(tx, actor, companyId, binding.id, "provider_binding.presence_attached", publications);
        return runtime!;
      });
    },
    acknowledgeShared: async (actor: AuthorizationActor, companyId: string, agentId: string, bindingId: string) => {
      await assertV5Enabled(db, "shared_trusted_runtime_v5");
      const userId = v5HumanActorId(actor);
      await assertV5Authorization(db, actor, companyId, "users:manage_permissions");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const presence = await localPresence(tx, companyId, agentId);
        await lockIdentity(tx, presence.agentIdentityId);
        const [binding] = await tx.select().from(agentProviderBindings).where(and(eq(agentProviderBindings.id, bindingId), eq(agentProviderBindings.agentIdentityId, presence.agentIdentityId))).limit(1);
        if (!binding || binding.isolationMode !== "shared_trusted_runtime" || binding.status === "revoked") throw notFound("Shared provider binding not found");
        const [ack] = await tx.insert(providerSharedRuntimeAcknowledgements).values({ companyId, providerBindingId: bindingId, acknowledgedByUserId: userId, warningVersion: PROVIDER_ISOLATION_WARNING_VERSION })
          .onConflictDoUpdate({ target: [providerSharedRuntimeAcknowledgements.companyId, providerSharedRuntimeAcknowledgements.providerBindingId], set: { acknowledgedByUserId: userId, warningVersion: PROVIDER_ISOLATION_WARNING_VERSION, revokedAt: null, createdAt: new Date() } }).returning();
        await audit(tx, actor, companyId, bindingId, "provider_binding.isolation_acknowledged", publications);
        return ack!;
      });
    },
    markUnavailable: async (companyId: string, agentId: string, reason: "discovery_failed" | "conformance_invalidated" | "provider_termination_unconfirmed") => {
      const result = await withV5ActivityTransaction(db, async (tx, publications) => {
        const [runtime] = await tx.select().from(agentPresenceRuntimeBindings).where(and(eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, agentId))).limit(1).for("update");
        if (!runtime || runtime.status === "revoked") return null;
        const [binding] = await tx.select().from(agentProviderBindings).where(eq(agentProviderBindings.id, runtime.providerBindingId)).limit(1).for("update");
        if (!binding || binding.status === "revoked") return null;
        await tx.update(agentProviderBindings).set({ status: "degraded", updatedAt: new Date() }).where(eq(agentProviderBindings.id, binding.id));
        await tx.update(agentPresenceRuntimeBindings).set({ status: "degraded", qualifiedConfigurationHash: null, conformanceSnapshotHash: null, updatedAt: new Date() }).where(and(eq(agentPresenceRuntimeBindings.providerBindingId, binding.id), ne(agentPresenceRuntimeBindings.status, "revoked")));
        await logActivity(tx, { companyId, actorType: "system", actorId: "provider-discovery", action: "provider_binding.unavailable", entityType: "agent_provider_binding", entityId: binding.id, details: { reason } }, publications);
        return binding.id;
      });
      if (result) {
        const peers = await db.select({ companyId: agentPresenceRuntimeBindings.companyId }).from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.providerBindingId, result)).limit(501);
        if (peers.length > 500) throw conflict("Provider presence limit reached");
        for (const cid of new Set(peers.map((peer) => peer.companyId))) await skillLifecycleService(db).invalidateDependency(cid, "provider_capability", result, null);
      }
    },
    // Internal, read-only adapter metadata. This never fabricates a new
    // conformance date or copies one presence's proof to another profile.
    recordCapabilityAdvertisement: async (companyId: string, agentId: string, snapshotInput: Omit<ProviderCapabilitySnapshot, "hash">, expected?: { configurationHash: string; runtimeId: string; bindingId: string }) => {
      await assertV5Enabled(db, "agent_provider_bindings_v5"); const snapshot = makeProviderCapabilitySnapshot(snapshotInput);
      const result = await withV5ActivityTransaction(db, async (tx, publications) => {
        const presence = await localPresence(tx, companyId, agentId); await lockIdentity(tx, presence.agentIdentityId);
        const [runtime] = await tx.select().from(agentPresenceRuntimeBindings).where(and(eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, agentId))).limit(1).for("update");
        if (!runtime || runtime.status === "revoked") throw notFound("Local provider profile not found");
        if (expected && (runtime.id !== expected.runtimeId || runtime.providerBindingId !== expected.bindingId || hashContextPolicySnapshot({ adapterType: presence.adapterType, adapterConfig: presence.adapterConfig }) !== expected.configurationHash)) throw conflict("Provider configuration/profile changed during discovery; repeat discovery");
        const [binding] = await tx.select().from(agentProviderBindings).where(eq(agentProviderBindings.id, runtime.providerBindingId)).limit(1).for("update");
        if (!binding || binding.status === "revoked" || snapshot.provider !== binding.providerType) throw conflict("Provider identity is unavailable or does not match the binding");
        const changes = providerCapabilityChanges(binding.capabilitySnapshot, snapshot);
        const [updated] = await tx.update(agentProviderBindings).set({ capabilitySnapshot: snapshot, capabilitySnapshotHash: snapshot.hash, capabilityDiscoveredAt: new Date(snapshot.discoveredAt), ...(changes.changed ? { status: "degraded" } : {}), updatedAt: new Date() }).where(eq(agentProviderBindings.id, binding.id)).returning();
        if (changes.changed) await tx.update(agentPresenceRuntimeBindings).set({ status: "degraded", updatedAt: new Date() }).where(and(eq(agentPresenceRuntimeBindings.providerBindingId, binding.id), ne(agentPresenceRuntimeBindings.status, "revoked")));
        await logActivity(tx, { companyId, actorType: "system", actorId: "provider-discovery", action: changes.changed ? "provider_binding.capability_drift_detected" : "provider_binding.capability_metadata_refreshed", entityType: "agent_provider_binding", entityId: binding.id, details: { snapshotHash: snapshot.hash, lostFeatures: changes.lostFeatures, lostSkills: changes.lostSkills, lostTools: changes.lostTools, conformancePerformed: false } }, publications);
        return { binding: updated!, changed: changes.changed };
      });
      if (result.changed) { const peers = await db.select({ companyId: agentPresenceRuntimeBindings.companyId }).from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.providerBindingId, result.binding.id)); for (const cid of new Set(peers.map((peer) => peer.companyId))) await skillLifecycleService(db).invalidateDependency(cid, "provider_capability", result.binding.id, snapshot.hash); }
      return result.binding;
    },
    // Internal entry point for adapter-owned deterministic discovery/conformance.
    // No HTTP route accepts snapshots or evidence supplied by an agent/model.
    recordDiscovery: async (companyId: string, agentId: string, snapshotInput: Omit<ProviderCapabilitySnapshot, "hash">, evidence: Record<string, boolean>, expected?: { configurationHash: string; runtimeId: string; profileRef: string; bindingId: string; isolationPeer?: IsolationPeerProof }) => {
      await assertV5Enabled(db, "agent_provider_bindings_v5");
      const snapshot = makeProviderCapabilitySnapshot(snapshotInput);
      const result = await withV5ActivityTransaction(db, async (tx, publications) => {
        const presence = await localPresence(tx, companyId, agentId);
        await lockIdentity(tx, presence.agentIdentityId);
        const [runtime] = await tx.select().from(agentPresenceRuntimeBindings).where(and(eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, agentId))).limit(1).for("update");
        if (!runtime) throw notFound("Provider runtime binding not found");
        if (expected && (runtime.id !== expected.runtimeId || runtime.providerProfileRef !== expected.profileRef || runtime.providerBindingId !== expected.bindingId || hashContextPolicySnapshot({ adapterType: presence.adapterType, adapterConfig: presence.adapterConfig }) !== expected.configurationHash)) throw conflict("Provider configuration/profile changed during conformance; repeat the tests");
        const [binding] = await tx.select().from(agentProviderBindings).where(eq(agentProviderBindings.id, runtime.providerBindingId)).limit(1).for("update");
        if (!binding || binding.status === "revoked") throw conflict("Provider binding is revoked");
        if (binding.providerType !== snapshot.provider) throw conflict("Provider discovery identity does not match the binding");
        const drift = providerCapabilityChanges(binding.capabilitySnapshot, snapshot);
        const qualified = providerConformanceRequirements(snapshot, binding.isolationMode).every((key) => evidence[key] === true);
        const status = !qualified ? "unqualified" : drift.changed || binding.status === "degraded" ? "degraded" : "active";
        const [updated] = await tx.update(agentProviderBindings).set({
          capabilitySnapshot: snapshot, capabilitySnapshotHash: snapshot.hash,
          capabilityDiscoveredAt: new Date(snapshot.discoveredAt), conformance: evidence, status, updatedAt: new Date(),
        }).where(eq(agentProviderBindings.id, binding.id)).returning();
        if (status !== "active") await tx.update(agentPresenceRuntimeBindings).set({ status: "degraded", updatedAt: new Date() }).where(and(eq(agentPresenceRuntimeBindings.providerBindingId, binding.id), ne(agentPresenceRuntimeBindings.status, "revoked")));
        await tx.update(agentPresenceRuntimeBindings).set({
          status: status === "active" ? "active" : "degraded", updatedAt: new Date(),
          qualifiedConfigurationHash: qualified ? hashContextPolicySnapshot({ adapterType: presence.adapterType, adapterConfig: presence.adapterConfig }) : null,
          conformanceSnapshotHash: qualified ? snapshot.hash : null,
          conformanceReport: { adapterContractVersion: "aw-provider-conformance-v5.1", providerVersion: snapshot.version, testedAt: new Date().toISOString(), profileRef: runtime.providerProfileRef, checks: evidence, ...(expected?.isolationPeer ? { isolationPeer: expected.isolationPeer } : {}) },
        }).where(eq(agentPresenceRuntimeBindings.id, runtime.id));
        await logActivity(tx, { companyId, actorType: "system", actorId: "provider-discovery", action: drift.changed ? "provider_binding.capability_drift_detected" : "provider_binding.capabilities_discovered", entityType: "agent_provider_binding", entityId: binding.id, details: { hash: snapshot.hash, status, lostFeatures: drift.lostFeatures, versionChanged: drift.versionChanged } }, publications);
        return updated!;
      });
      const affected = await db.select({ companyId: agentPresenceRuntimeBindings.companyId }).from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.providerBindingId, result.id));
      for (const affectedCompany of new Set(affected.map((presence) => presence.companyId))) await skillLifecycleService(db).invalidateDependency(affectedCompany, "provider_capability", result.id, result.status === "active" ? snapshot.hash : null);
      return result;
    },
    revalidate: async (actor: AuthorizationActor, companyId: string, agentId: string, expectedSnapshotHash: string, rationale: string) => {
      await assertV5Enabled(db, "agent_provider_bindings_v5"); const userId = v5HumanActorId(actor);
      await assertV5Authorization(db, actor, companyId, "agents:configure", { type: "agent", companyId, agentId });
      if (rationale.trim().length < 20 || rationale.length > 4000) throw conflict("Provider revalidation requires a reviewed rationale of 20–4000 characters");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const presence = await localPresence(tx, companyId, agentId); await lockIdentity(tx, presence.agentIdentityId);
        const [runtime] = await tx.select().from(agentPresenceRuntimeBindings).where(and(eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, agentId))).limit(1).for("update");
        if (!runtime || runtime.status === "revoked") throw notFound("Current provider profile not found");
        const [binding] = await tx.select().from(agentProviderBindings).where(eq(agentProviderBindings.id, runtime.providerBindingId)).limit(1).for("update");
        if (!binding || binding.status === "revoked" || !binding.capabilitySnapshot || binding.capabilitySnapshot.hash !== expectedSnapshotHash) throw conflict("Provider capabilities changed; repeat review");
        await assertIsolationPeerCurrent(tx, runtime.conformanceReport);
        const report = runtime.conformanceReport, checks = report?.checks as Record<string, unknown> | undefined;
        if (runtime.qualifiedConfigurationHash !== hashContextPolicySnapshot({ adapterType: presence.adapterType, adapterConfig: presence.adapterConfig }) || runtime.conformanceSnapshotHash !== expectedSnapshotHash || report?.profileRef !== runtime.providerProfileRef || report?.adapterContractVersion !== "aw-provider-conformance-v5.1" || !providerConformanceRequirements(binding.capabilitySnapshot, binding.isolationMode).every((key) => checks?.[key] === true)) throw conflict("Revalidation requires fresh, passing adapter-owned conformance for this exact local profile and configuration");
        if (binding.isolationMode === "shared_trusted_runtime") { await assertV5Enabled(tx, "shared_trusted_runtime_v5"); const peers = await tx.select({ companyId: agentPresenceRuntimeBindings.companyId }).from(agentPresenceRuntimeBindings).where(and(eq(agentPresenceRuntimeBindings.providerBindingId, binding.id), ne(agentPresenceRuntimeBindings.status, "revoked"))).limit(501); if (peers.length > 500) throw conflict("Provider presence limit reached"); await assertSharedAcknowledgements(tx, binding.id, peers.map((peer) => peer.companyId)); }
        const [updated] = await tx.update(agentProviderBindings).set({ status: "active", updatedAt: new Date() }).where(eq(agentProviderBindings.id, binding.id)).returning();
        await tx.update(agentPresenceRuntimeBindings).set({ status: "active", updatedAt: new Date() }).where(eq(agentPresenceRuntimeBindings.id, runtime.id));
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "provider_binding.profile_revalidated", entityType: "agent_provider_binding", entityId: binding.id, details: { profileRef: runtime.providerProfileRef, snapshotHash: expectedSnapshotHash, rationale } }, publications);
        return updated!;
      });
    },
    assertRuntime: async (companyId: string, agentId: string) => {
      const [record] = await db.select({ runtime: agentPresenceRuntimeBindings, provider: agentProviderBindings }).from(agentPresenceRuntimeBindings)
        .innerJoin(agentProviderBindings, eq(agentPresenceRuntimeBindings.providerBindingId, agentProviderBindings.id))
        .where(and(eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, agentId))).limit(1);
      if (!record || record.runtime.status !== "active" || record.provider.status !== "active" || !record.provider.capabilitySnapshot) throw conflict("A qualified active provider binding is required");
      const presence = await localPresence(db, companyId, agentId);
      if (record.runtime.qualifiedConfigurationHash !== hashContextPolicySnapshot({ adapterType: presence.adapterType, adapterConfig: presence.adapterConfig })
        || record.runtime.conformanceSnapshotHash !== record.provider.capabilitySnapshot.hash
        || record.runtime.conformanceReport?.profileRef !== record.runtime.providerProfileRef) throw conflict("Provider profile/configuration changed; repeat conformance and dependency validation");
      await assertIsolationPeerCurrent(db, record.runtime.conformanceReport);
      if (record.provider.isolationMode === "shared_trusted_runtime") {
        await assertV5Enabled(db, "shared_trusted_runtime_v5");
        const peers = await db.select({ companyId: agentPresenceRuntimeBindings.companyId }).from(agentPresenceRuntimeBindings).where(and(eq(agentPresenceRuntimeBindings.providerBindingId, record.provider.id), ne(agentPresenceRuntimeBindings.status, "revoked"))).limit(501);
        if (peers.length > 500) throw conflict("Provider presence limit reached");
        await assertSharedAcknowledgements(db, record.provider.id, peers.map((peer) => peer.companyId));
      }
      return record;
    },
  };
}
