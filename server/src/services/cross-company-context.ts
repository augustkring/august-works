import { withV5ActivityTransaction } from "./v5-mutations.js";
import { and, eq } from "drizzle-orm";
import { agentIdentities, agents, companies, companyCrossCompanyPolicies, type Db } from "@paperclipai/db";
import {
  agentExecutionScopeSchema, crossCompanyPolicySchema, type AgentExecutionScope,
  type CrossCompanyContextPacket, type CrossCompanyPolicy, type EvidenceItem,
  type ScopedEvidenceItem, type crossCompanyContextRequestSchema,
  getAgentWorkEligibility,
} from "@paperclipai/shared";
import type { z } from "zod";
import { forbidden, notFound } from "../errors.js";
import type { AuthorizationAction, AuthorizationActor, AuthorizationResource } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { agentProviderBindingService } from "./agent-provider-bindings.js";
import { contextEngineService, DEFAULT_CONTEXT_BUDGET } from "./context/context-engine.js";
import { estimateEvidenceTokens } from "./context/context-budget.js";
import { logActivity } from "./activity-log.js";

export function crossCompanyEvidencePolicy(evidence: EvidenceItem): ScopedEvidenceItem["crossCompanyUsePolicy"] {
  if (evidence.sourceClass === "private_memory" || evidence.sensitivity === "restricted"
    || evidence.metadata.scope === "user" || evidence.metadata.personal === true) return "no_export";
  const policy = evidence.metadata.crossCompanyUsePolicy;
  if (policy === "no_export" || policy === "aggregate_only") return policy;
  if (policy === "allow") return "allow";
  return evidence.sensitivity === "confidential" ? "no_export" : "allow";
}

export function crossCompanyContextService(db: Db) {
  async function policy(companyId: string) {
    const [row] = await db.select().from(companyCrossCompanyPolicies).where(eq(companyCrossCompanyPolicies.companyId, companyId)).limit(1);
    return crossCompanyPolicySchema.parse(row?.policy ?? {});
  }

  async function resolve(actor: AuthorizationActor, rawScope: AgentExecutionScope) {
    await assertV5Enabled(db, "cross_company_execution_v5");
    const scope = agentExecutionScopeSchema.parse(rawScope);
    await assertV5Authorization(db, actor, scope.primaryCompanyId, "company_scope:read");
    if (actor.type === "agent" && (actor.agentId !== scope.primaryAgentPresenceId || actor.companyId !== scope.primaryCompanyId)) throw forbidden("The primary execution scope must match the authenticated local presence");
    // A narrow bridge/test key cannot expand its envelope by adding an identity.
    if (actor.type === "agent" && actor.keyScope && actor.keyScope.kind !== "standard") throw forbidden("Scoped agent keys cannot create cross-company execution");
    if (actor.type === "agent" && !actor.onBehalfOfUserId) throw forbidden("Cross-company agent execution requires a represented human");
    const companyScopes = [{ companyId: scope.primaryCompanyId, agentPresenceId: scope.primaryAgentPresenceId, purpose: "primary_execution", accessMode: "act" as const }, ...scope.delegatedScopes];
    const primary = await db.select({ identityId: agents.agentIdentityId }).from(agents).where(and(eq(agents.companyId, scope.primaryCompanyId), eq(agents.id, scope.primaryAgentPresenceId))).limit(1);
    if (!primary[0]) throw notFound("Primary local presence not found");
    const resolved = [];
    for (const requested of companyScopes) {
      const [row] = await db.select({ presence: agents, company: companies, identityStatus: agentIdentities.status }).from(agents)
        .innerJoin(companies, eq(agents.companyId, companies.id)).innerJoin(agentIdentities, eq(agents.agentIdentityId, agentIdentities.id))
        .where(and(eq(agents.id, requested.agentPresenceId), eq(agents.companyId, requested.companyId), eq(agents.agentIdentityId, primary[0].identityId))).limit(1);
      if (!row || row.company.status !== "active" || row.identityStatus !== "active" || !["idle", "running", "error"].includes(row.presence.status)) throw forbidden("An active, invokable local presence of the same identity is required in every company");
      const localAgents = [row.presence];
      let managerId = row.presence.reportsTo;
      const visited = new Set([row.presence.id]);
      for (let depth = 0; managerId && depth < 64 && !visited.has(managerId); depth++) {
        visited.add(managerId);
        const [manager] = await db.select().from(agents).where(and(eq(agents.companyId, requested.companyId), eq(agents.id, managerId))).limit(1);
        if (!manager) break;
        localAgents.push(manager);
        managerId = manager.reportsTo;
      }
      if (!getAgentWorkEligibility({ agent: row.presence, agents: localAgents }).invokable) throw forbidden("The local presence is not invokable");
      const responsibleUserId = actor.type === "board" ? actor.userId ?? null : actor.onBehalfOfUserId ?? null;
      const localActor: AuthorizationActor = {
        type: "agent", agentId: row.presence.id, companyId: requested.companyId,
        source: "agent_jwt", onBehalfOfUserId: responsibleUserId,
        // Keep an existing primary key's attenuation. Guest authority comes
        // from its own local presence, never from the source key or run id.
        ...(requested.companyId === scope.primaryCompanyId && actor.type === "agent" ? { keyScope: actor.keyScope, keyId: actor.keyId } : {}),
      };
      await assertV5Authorization(db, actor.type === "board" ? actor : { type: "board", source: "session", userId: responsibleUserId }, requested.companyId, "company_scope:read");
      await assertV5Authorization(db, localActor, requested.companyId, "company_scope:read");
      await assertV5Authorization(db, actor.type === "board" ? actor : { type: "board", source: "session", userId: responsibleUserId }, requested.companyId, "agent:wake", { type: "agent", companyId: requested.companyId, agentId: row.presence.id });
      const companyPolicy = await policy(requested.companyId);
      if (requested.companyId !== scope.primaryCompanyId) {
        const allowed = requested.accessMode === "read" ? companyPolicy.allowRead : requested.accessMode === "contribute" ? companyPolicy.allowContribute : companyPolicy.allowAct;
        if (!allowed) throw forbidden("The guest company's cross-company policy does not allow this mode");

      }
      const provider = await agentProviderBindingService(db).assertRuntime(requested.companyId, row.presence.id);
      resolved.push({ ...requested, presence: row.presence, companyName: row.company.name, localActor, policy: companyPolicy, provider });
    }
    return { scope, scopes: resolved };
  }

  return {
    resolve,
    getPolicy: async (actor: AuthorizationActor, companyId: string) => {
      await assertV5Enabled(db, "cross_company_execution_v5");
      await assertV5Authorization(db, actor, companyId, "company_scope:read");
      return policy(companyId);
    },
    setPolicy: async (actor: AuthorizationActor, companyId: string, input: CrossCompanyPolicy) => {
      await assertV5Enabled(db, "cross_company_execution_v5");
      const userId = v5HumanActorId(actor);
      await assertV5Authorization(db, actor, companyId, "users:manage_permissions");
      const validated = crossCompanyPolicySchema.parse(input);
      await withV5ActivityTransaction(db, async (tx, publications) => {
        await tx.insert(companyCrossCompanyPolicies).values({ companyId, policy: validated }).onConflictDoUpdate({ target: companyCrossCompanyPolicies.companyId, set: { policy: validated, updatedAt: new Date() } });
        await logActivity(tx as unknown as Db, { companyId, actorType: "user", actorId: userId, action: "cross_company.policy_updated", entityType: "company", entityId: companyId }, publications);
      });
      return validated;
    },
    assertAction: async (actor: AuthorizationActor, scope: AgentExecutionScope, companyId: string, action: AuthorizationAction, resource: AuthorizationResource) => {
      const authorized = await resolve(actor, scope); // Current authority, not a cached preview.
      const local = authorized.scopes.find((s) => s.companyId === companyId);
      if (!local || resource.companyId !== companyId) throw forbidden("Action is outside the explicit execution scope");
      const read = ["company_scope:read", "issue:read", "project:read", "agent:read", "foundation:read"].includes(action);
      if (companyId !== scope.primaryCompanyId && !read && local.accessMode !== "act" && !(local.accessMode === "contribute" && ["foundation:propose", "agents:suggest-changes", "skills:suggest-changes"].includes(action))) throw forbidden("This guest mutation requires act scope");
      await assertV5Authorization(db, local.localActor, companyId, action, resource);
      return local.localActor;
    },
    assemble: async (actor: AuthorizationActor, input: z.infer<typeof crossCompanyContextRequestSchema>): Promise<CrossCompanyContextPacket> => {
      const resolved = await resolve(actor, input.executionScope);
      const evidence: ScopedEvidenceItem[] = [], manifests: CrossCompanyContextPacket["manifests"] = [], warnings: string[] = [];
      let estimatedTokens = 0;
      const perCompanyBudget = Math.floor(input.maxEstimatedTokens / resolved.scopes.length);
      for (const local of resolved.scopes) {
        const result = await contextEngineService(db).assemble({
          companyId: local.companyId, agentId: local.presence.id,
          responsibleUserId: local.localActor.onBehalfOfUserId ?? null,
          enforceResponsibleUserIntersection: true,
          query: input.query, intent: `${input.intent}: ${local.purpose}`,
          sensitivityCeiling: "internal", budget: { ...DEFAULT_CONTEXT_BUDGET, maxEstimatedTokens: perCompanyBudget },
        });
        if (!result.packet.manifest) throw forbidden("Cross-company context requires a persisted provenance manifest");
        manifests.push({ companyId: local.companyId, contextManifestId: result.packet.manifest.id });
        for (const item of [
          ...result.packet.foundation, ...result.packet.connectedEvidence, ...result.packet.sharedMemory,
          ...result.packet.privateMemory, ...result.packet.taskContext, ...result.packet.artifacts,
        ]) {
          if (item.companyId !== local.companyId) throw forbidden("Context provider returned evidence from another company");
          const usePolicy = crossCompanyEvidencePolicy(item);
          if (local.companyId !== resolved.scope.primaryCompanyId && (usePolicy !== "allow" || !local.policy.allowedSensitivities.includes(item.sensitivity as "public" | "internal" | "confidential"))) {
            warnings.push(`Evidence from ${local.companyId} was excluded by its sharing policy`);
            continue;
          }
          const cost = estimateEvidenceTokens(item);
          if (estimatedTokens + cost > input.maxEstimatedTokens) continue;
          evidence.push({ ...item, sourceCompanyId: local.companyId, sourceCompanyName: local.companyName, shareClassification: item.sensitivity, crossCompanyUsePolicy: usePolicy });
          estimatedTokens += cost;
        }
      }
      // Recheck after retrieval to close revoke/terminate races before disclosure.
      await resolve(actor, resolved.scope);
      return { executionScope: resolved.scope, evidence, manifests, estimatedTokens, warnings: [...new Set(warnings)], resultOwnerCompanyId: resolved.scope.primaryCompanyId };
    },
  };
}
