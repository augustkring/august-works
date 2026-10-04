import { and, eq } from "drizzle-orm";
import { agents, agentPresenceRuntimeBindings, type Db } from "@paperclipai/db";
import { conflict, notFound } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { secretService } from "./secrets.js";
import { getServerAdapter } from "../adapters/index.js";
import { hashContextPolicySnapshot } from "./context/context-manifest.js";
import { agentProviderBindingService } from "./agent-provider-bindings.js";
import { discoverNativeCapabilities } from "./native-provider-conformance.js";
import { discoverA2ACapabilities } from "./a2a-capabilities.js";

export function providerDiscoveryService(db: Db) {
  return {
    discover: async (actor: AuthorizationActor, companyId: string, agentId: string) => {
      await assertV5Enabled(db, "agent_provider_bindings_v5");
      const userId = v5HumanActorId(actor);
      await assertV5Authorization(db, actor, companyId, "agents:configure", { type: "agent", companyId, agentId });
      const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).limit(1);
      if (!agent) throw notFound("Local presence not found");
      const adapter = getServerAdapter(agent.adapterType);
      const binding = await agentProviderBindingService(db).getForPresence(actor, companyId, agentId);
      const discover = binding?.provider.providerType === "a2a" ? discoverA2ACapabilities : binding?.provider.providerType === "paperclip_native" ? discoverNativeCapabilities : adapter.discoverCapabilities;
      if (!discover) {
        await agentProviderBindingService(db).markUnavailable(companyId, agentId, "discovery_failed");
        throw conflict("This adapter does not implement deterministic V5 capability discovery; it cannot be qualified from advertisements");
      }
      const [runtime] = await db.select().from(agentPresenceRuntimeBindings).where(and(eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, agentId))).limit(1);
      if (!runtime || runtime.status === "revoked") throw notFound("Current provider profile not found");
      const expected = { runtimeId: runtime.id, bindingId: runtime.providerBindingId, configurationHash: hashContextPolicySnapshot({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig }) };
      let snapshot;
      try {
        const resolved = await secretService(db).resolveAdapterConfigForRuntime(companyId, agent.adapterConfig, { consumerType: "agent", consumerId: agentId, responsibleUserId: userId, actorType: "user", actorId: userId, actorSource: actor.source === "local_implicit" ? "local_implicit" : "session" });
        snapshot = await discover({ companyId, adapterType: agent.adapterType, config: agent.adapterType === "openclaw_gateway" && binding ? { ...resolved.config, agentId: binding.provider.providerAgentRef } : resolved.config });
      } catch {
        await agentProviderBindingService(db).markUnavailable(companyId, agentId, "discovery_failed");
        throw conflict("Provider capability discovery failed; repeat conformance after restoring the configured connection");
      }
      await assertV5Authorization(db, actor, companyId, "agents:configure", { type: "agent", companyId, agentId });
      return agentProviderBindingService(db).recordCapabilityAdvertisement(companyId, agentId, snapshot, expected);
    },
  };
}
