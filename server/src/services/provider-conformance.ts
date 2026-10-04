import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { agents, agentIdentities, agentPresenceRuntimeBindings, heartbeatRuns, type Db } from "@paperclipai/db";
import type { ProviderConformanceTarget } from "@paperclipai/adapter-utils";
import { z } from "zod";
import { conflict, forbidden, notFound } from "../errors.js";
import { getServerAdapter } from "../adapters/index.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { agentProviderBindingService } from "./agent-provider-bindings.js";
import { providerDiscoveryService } from "./provider-discovery.js";
import { providerConformanceRequirements } from "./provider-capabilities.js";
import { hashContextPolicySnapshot } from "./context/context-manifest.js";
import { secretService } from "./secrets.js";
import { budgetService } from "./budgets.js";
import { costService } from "./costs.js";
import { logActivity } from "./activity-log.js";

export const providerConformanceInputSchema = z.object({ acknowledgeProviderRuns: z.literal(true), maximumCostCents: z.number().int().min(1).max(10000), isolationPeer: z.object({ companyId: z.string().uuid(), agentId: z.string().uuid() }).strict().nullable().default(null) }).strict();

/** Operator-only bootstrapping, with real retained runs and no platform tools. */
export function providerConformanceService(db: Db) {
  return {
    test: async (actor: AuthorizationActor, companyId: string, agentId: string, raw: z.infer<typeof providerConformanceInputSchema>) => {
      await assertV5Enabled(db, "agent_provider_bindings_v5");
      const input = providerConformanceInputSchema.parse(raw), userId = v5HumanActorId(actor), bindings = agentProviderBindingService(db);
      await assertV5Authorization(db, actor, companyId, "agents:configure", { type: "agent", companyId, agentId });
      async function target(cid: string, aid: string) {
        await assertV5Authorization(db, actor, cid, "agents:configure", { type: "agent", companyId: cid, agentId: aid });
        await assertV5Authorization(db, actor, cid, "agent:wake", { type: "agent", companyId: cid, agentId: aid });
        const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, cid), eq(agents.id, aid))).limit(1);
        if (!agent || !["idle", "error"].includes(agent.status)) throw conflict("Conformance requires an idle, invokable local presence");
        const [identity] = await db.select().from(agentIdentities).where(eq(agentIdentities.id, agent.agentIdentityId)).limit(1);
        if (!identity || identity.status !== "active") throw forbidden("Logical identity is unavailable");
        const binding = await bindings.getForPresence(actor, cid, aid);
        if (!binding || binding.provider.status === "revoked" || binding.runtime.status === "revoked") throw notFound("Current provider profile not found");
        if (binding.provider.isolationMode === "shared_trusted_runtime") await bindings.assertReducedIsolationAcknowledgements(binding.provider.id);
        return { agent, binding, target: { companyId: cid, agentId: aid, providerAgentRef: binding.provider.providerAgentRef, providerProfileRef: binding.runtime.providerProfileRef, sessionNamespace: `${binding.runtime.providerSessionNamespace}:conformance:${randomUUID()}` } satisfies ProviderConformanceTarget };
      }
      const primary = await target(companyId, agentId), adapter = getServerAdapter(primary.agent.adapterType);
      if (!adapter.testProviderConformance) throw conflict("This adapter has no deterministic conformance driver and cannot be qualified manually");
      const peer = input.isolationPeer ? await target(input.isolationPeer.companyId, input.isolationPeer.agentId) : null;
      if (peer && (peer.agent.agentIdentityId !== primary.agent.agentIdentityId || peer.agent.id === agentId || peer.agent.adapterType !== primary.agent.adapterType || peer.binding.provider.providerType !== primary.binding.provider.providerType || peer.binding.provider.providerEndpointRef !== primary.binding.provider.providerEndpointRef)) throw conflict("Isolation tests require another explicit local presence of this identity on the same provider endpoint");
      const configurationHash = hashContextPolicySnapshot({ adapterType: primary.agent.adapterType, adapterConfig: primary.agent.adapterConfig });
      const discovered = await providerDiscoveryService(db).discover(actor, companyId, agentId), snapshot = discovered.capabilitySnapshot!;
      const runIds: string[] = [], groupId = randomUUID(); let spentCents = 0, unknownCost = false;
      const probes = new Map([primary, ...(peer ? [peer] : [])].map((entry) => [entry.agent.id, entry]));
      async function assertTargetCurrent(entry: typeof primary) {
        const current = await bindings.getForPresence(actor, entry.agent.companyId, entry.agent.id);
        const [agent] = await db.select().from(agents).where(eq(agents.id, entry.agent.id)).limit(1);
        if (!agent || !current || current.provider.status === "revoked" || current.runtime.status === "revoked"
          || current.runtime.id !== entry.binding.runtime.id || current.provider.id !== entry.binding.provider.id
          || current.runtime.providerProfileRef !== entry.target.providerProfileRef
          || hashContextPolicySnapshot({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig }) !== hashContextPolicySnapshot({ adapterType: entry.agent.adapterType, adapterConfig: entry.agent.adapterConfig })) throw conflict("A tested provider profile or configuration changed");
        if (entry.binding.provider.isolationMode === "shared_trusted_runtime") await bindings.assertReducedIsolationAcknowledgements(entry.binding.provider.id);
      }
      let checks: Record<string, boolean> = {}, failure: string | null = null;
      try {
        checks = await adapter.testProviderConformance({ snapshot, primary: primary.target, peer: peer?.target ?? null, probe: async (requested, probe) => {
          const entry = probes.get(requested.agentId);
          if (!entry || requested !== entry.target || runIds.length >= 10 || unknownCost || spentCents >= input.maximumCostCents) throw conflict("Conformance probe ceiling or cost guard reached; review retained evidence");
          const cid = requested.companyId, aid = requested.agentId;
          await assertTargetCurrent(entry);
          await assertV5Authorization(db, actor, cid, "agent:wake", { type: "agent", companyId: cid, agentId: aid });
          if (await budgetService(db).getInvocationBlock(cid, aid)) throw forbidden("Current company/agent budget blocks conformance");
          const [identity] = await db.select().from(agentIdentities).where(eq(agentIdentities.id, entry.agent.agentIdentityId)).limit(1);
          if (identity?.status !== "active") throw forbidden("Logical identity stopped during conformance");
          const resolved = await secretService(db).resolveAdapterConfigForRuntime(cid, entry.agent.adapterConfig, { consumerType: "agent", consumerId: aid, responsibleUserId: userId, actorType: "user", actorId: userId, actorSource: actor.source === "local_implicit" ? "local_implicit" : "session" });
          const run = await db.transaction(async (tx) => {
            const [current] = await tx.select().from(agents).where(and(eq(agents.companyId, cid), eq(agents.id, aid))).limit(1).for("update");
            if (!current || !["idle", "error"].includes(current.status) || hashContextPolicySnapshot(current.adapterConfig) !== hashContextPolicySnapshot(entry.agent.adapterConfig)) throw conflict("Local presence/configuration changed during conformance");
            const active = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, cid), eq(heartbeatRuns.agentId, aid), inArray(heartbeatRuns.status, ["queued", "running"]))).limit(1);
            if (active.length) throw conflict("Wait for existing provider work to settle before conformance");
            const [row] = await tx.insert(heartbeatRuns).values({ companyId: cid, agentId: aid, responsibleUserId: userId, invocationSource: "on_demand", triggerDetail: "provider_conformance", status: "running", startedAt: new Date(), contextSnapshot: { providerConformanceGroupId: groupId, profileRef: requested.providerProfileRef, containsCompanyContext: false, platformToolsGranted: false } }).returning();
            await tx.update(agents).set({ status: "running" }).where(eq(agents.id, aid)); return row!;
          });
          runIds.push(run.id);
          const controller = new AbortController(); let streamObserved = false, excerpt = "", cancelTimer: ReturnType<typeof setTimeout> | null = null, checking = false;
          const timeout = setTimeout(() => controller.abort(), 25_000);
          const guard = setInterval(() => { if (checking) return; checking = true; void (async () => {
            await assertTargetCurrent(entry);
            await assertV5Authorization(db, actor, cid, "agent:wake", { type: "agent", companyId: cid, agentId: aid });
            const [identity] = await db.select().from(agentIdentities).where(eq(agentIdentities.id, entry.agent.agentIdentityId)).limit(1);
            const [currentRun] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id)).limit(1);
            if (identity?.status !== "active" || currentRun?.status !== "running" || await budgetService(db).getInvocationBlock(cid, aid)) controller.abort();
          })().catch(() => controller.abort()).finally(() => { checking = false; }); }, 1000);
          try {
            const config = { ...resolved.config, instructions: "Follow only this synthetic conformance prompt. Use no tools, files or external resources. Do not access company data.", paperclipApiUrl: undefined, sessionKeyStrategy: "agent", timeoutSec: 20, payloadTemplate: { input: probe.prompt, message: probe.prompt, toolsets: [], skills: [], max_tokens: 128, ...(probe.structured ? { response_format: { type: "json_object" } } : {}) } };
            const result = await adapter.execute({ runId: run.id, agent: entry.agent, runtime: { sessionId: null, sessionDisplayId: null, sessionParams: null, taskKey: null }, config, context: { conversationMode: true }, providerRuntime: { providerBindingId: entry.binding.provider.id, providerAgentRef: requested.providerAgentRef, providerProfileRef: requested.providerProfileRef, sessionNamespace: requested.sessionNamespace, isolationMode: entry.binding.provider.isolationMode as "isolated_per_presence" | "shared_trusted_runtime", capabilitySnapshotHash: snapshot.hash }, signal: controller.signal, onLog: async (_stream, text) => { if (text.includes("[hermes-gateway:event]") || text.includes("[openclaw-gateway:event]")) streamObserved = true; if (excerpt.length < 16000) excerpt += text.slice(0, 16000 - excerpt.length); }, onDispatch: () => { if (probe.cancelAfterMs) cancelTimer = setTimeout(() => controller.abort(), probe.cancelAfterMs); } });
            if (result.errorCode === "cancellation_unconfirmed") {
              await bindings.markUnavailable(cid, aid, "provider_termination_unconfirmed");
            }
            const status = result.errorCode === "cancelled" ? "cancelled" : result.exitCode === 0 && !result.errorCode ? "succeeded" : "failed";
            await db.update(heartbeatRuns).set({ status, finishedAt: new Date(), exitCode: result.exitCode, errorCode: result.errorCode, error: result.errorMessage?.slice(0, 2000), resultJson: result.resultJson, usageJson: result.usage ? { ...result.usage } : null, stdoutExcerpt: excerpt }).where(eq(heartbeatRuns.id, run.id));
            const reported = result.cacheAdjustedCostUsd ?? result.costUsd, known = typeof reported === "number" && Number.isFinite(reported) && reported >= 0;
            const costCents = known ? Math.ceil(reported * 100) : 0; spentCents += costCents; unknownCost ||= !known;
            await costService(db, { cancelWorkForScope: async () => controller.abort() }).createEvent(cid, { agentId: aid, heartbeatRunId: run.id, provider: result.provider ?? entry.agent.adapterType, model: result.model ?? "unknown", costCents, costStatus: known ? "reported" : "unknown", billingType: result.billingType ?? "unknown", inputTokens: result.usage?.inputTokens ?? 0, outputTokens: result.usage?.outputTokens ?? 0, occurredAt: new Date() });
            await logActivity(db, { companyId: cid, actorType: "user", actorId: userId, runId: run.id, agentId: aid, action: "provider.conformance_probe_settled", entityType: "heartbeat_run", entityId: run.id, details: { groupId, status, costKnown: known, ...(known ? { costCents } : {}) } });
            return { result, streamObserved };
          } catch (error) {
            await db.update(heartbeatRuns).set({ status: "failed", finishedAt: new Date(), errorCode: "provider_conformance_failed", error: "Provider probe failed; inspect the configured connection", stdoutExcerpt: excerpt }).where(and(eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "running"))); throw error;
          } finally {
            clearTimeout(timeout); clearInterval(guard); if (cancelTimer) clearTimeout(cancelTimer);
            await db.update(agents).set({ status: entry.agent.status, updatedAt: new Date() }).where(and(eq(agents.id, aid), eq(agents.status, "running")));
          }
        } });
      } catch { failure = "Conformance stopped: a probe failed, authority/configuration changed, or cost evidence/ceiling prevented further runs."; }
      try { for (const entry of probes.values()) await assertTargetCurrent(entry); }
      catch {
        await bindings.markUnavailable(companyId, agentId, "conformance_invalidated");
        throw conflict("A tested profile/configuration or its authorization changed; repeat conformance");
      }
      const { hash: _hash, ...snapshotInput } = snapshot;
      const binding = await bindings.recordDiscovery(companyId, agentId, snapshotInput, checks, { configurationHash, runtimeId: primary.binding.runtime.id, profileRef: primary.target.providerProfileRef, bindingId: primary.binding.provider.id, ...(peer ? { isolationPeer: { companyId: peer.agent.companyId, agentId: peer.agent.id, runtimeId: peer.binding.runtime.id, bindingId: peer.binding.provider.id, profileRef: peer.target.providerProfileRef, configurationHash: hashContextPolicySnapshot({ adapterType: peer.agent.adapterType, adapterConfig: peer.agent.adapterConfig }) } } : {}) });
      return { binding, checks, requiredChecks: providerConformanceRequirements(snapshot, binding.isolationMode), runIds, groupId, spentCents: unknownCost ? null : spentCents, failure };
    },
  };
}
