import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import { agentExecutionScopeRequests, agents, contextManifestItems, contextManifestMemoryRoots,
  contextManifests, delegatedContextManifestBindings, heartbeatRuns, type Db } from "@paperclipai/db";
import { agentExecutionScopeSchema, type AgentExecutionScope } from "@paperclipai/shared";
import { forbidden } from "../../errors.js";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { hashContextPolicySnapshot, revalidateStoredContextManifestSources } from "./context-manifest.js";

export interface DelegatedContextManifestResolverInput {
  homeCompanyId: string;
  homeAgentId: string;
  homeRunId: string;
  responsibleUserId: string;
  actor: AuthorizationActor;
  /** Exact saved refs are preferred; omission enumerates at most the bounded run set. */
  manifestIds?: string[];
}

export interface ResolvedDelegatedContextManifest {
  guestCompanyId: string;
  contextManifestId: string;
  guestAgentId: string;
  guestAgentIdentityId: string;
  scopeRequestId: string;
  purpose: string;
  accessMode: "read" | "contribute" | "act";
  scope: AgentExecutionScope;
  queryHash: string;
  policySnapshotHash: string;
  sourceSnapshotHash: string;
  bindingHash: string;
  items: Array<{ rank: number; sourceProvider: string; sourceRef: string; sourceVersion: string | null; contentHash: string }>;
  roots: Array<{ memoryRecordId: string; sourceVersion: string; payloadHash: string }>;
}

/** Resolve only manifests whose immutable binding names this exact home Run.
 * The actual actor is checked against the original run and the original
 * cross-company owner rechecks scope, local presence, membership, and policy. */
export async function resolveDelegatedContextManifestBindings(
  db: Db,
  input: DelegatedContextManifestResolverInput,
): Promise<ResolvedDelegatedContextManifest[]> {
  return db.transaction(async rawTx => resolveDelegatedContextManifestBindingsInScope(rawTx as unknown as Db, input));
}

async function resolveDelegatedContextManifestBindingsInScope(
  db: Db,
  input: DelegatedContextManifestResolverInput,
): Promise<ResolvedDelegatedContextManifest[]> {
  if (input.manifestIds && (input.manifestIds.length > 64 || new Set(input.manifestIds).size !== input.manifestIds.length))
    throw forbidden("Delegated Context references exceed their bounded review");
  const bindings = await db.select().from(delegatedContextManifestBindings).where(and(
    eq(delegatedContextManifestBindings.homeCompanyId, input.homeCompanyId),
    eq(delegatedContextManifestBindings.homeAgentId, input.homeAgentId),
    eq(delegatedContextManifestBindings.homeRunId, input.homeRunId),
    ...(input.manifestIds ? [inArray(delegatedContextManifestBindings.contextManifestId, input.manifestIds)] : []),
  )).orderBy(delegatedContextManifestBindings.guestCompanyId, delegatedContextManifestBindings.contextManifestId).limit(65);
  if (bindings.length > 64 || input.manifestIds && bindings.length !== input.manifestIds.length)
    throw forbidden("Delegated Context references are incomplete or unavailable");
  const [homeRun] = await db.select({ id: heartbeatRuns.id, issueId: heartbeatRuns.issueId,
    responsibleUserId: heartbeatRuns.responsibleUserId, agentIdentityId: agents.agentIdentityId }).from(heartbeatRuns)
    .innerJoin(agents, and(eq(agents.companyId, heartbeatRuns.companyId), eq(agents.id, heartbeatRuns.agentId)))
    .where(and(eq(heartbeatRuns.companyId, input.homeCompanyId), eq(heartbeatRuns.agentId, input.homeAgentId),
      eq(heartbeatRuns.id, input.homeRunId), eq(heartbeatRuns.responsibleUserId, input.responsibleUserId))).limit(1);
  if (!homeRun) throw forbidden("Delegated Context home accountability was erased or changed");
  if (input.actor.type !== "agent" || input.actor.source !== "agent_jwt" ||
    input.actor.companyId !== input.homeCompanyId || input.actor.agentId !== input.homeAgentId ||
    input.actor.runId !== input.homeRunId || input.actor.onBehalfOfUserId !== input.responsibleUserId)
    throw forbidden("Delegated Context reader is not its actual accountable home actor");

  const result: ResolvedDelegatedContextManifest[] = [];
  for (const binding of bindings) {
    const scope = agentExecutionScopeSchema.parse(binding.scopeSnapshot);
    const selected = scope.delegatedScopes.find(entry => entry.companyId === binding.guestCompanyId && entry.agentPresenceId === binding.guestAgentId);
    if (!selected || selected.purpose !== binding.purpose || selected.accessMode !== binding.accessMode ||
      scope.primaryCompanyId !== input.homeCompanyId || scope.primaryAgentPresenceId !== input.homeAgentId ||
      binding.homeAgentIdentityId !== homeRun.agentIdentityId || binding.responsibleUserId !== input.responsibleUserId)
      throw forbidden("Delegated Context binding does not match the actual home execution");
    const [request] = await db.select().from(agentExecutionScopeRequests).where(and(
      eq(agentExecutionScopeRequests.id, binding.scopeRequestId), eq(agentExecutionScopeRequests.companyId, input.homeCompanyId),
      eq(agentExecutionScopeRequests.agentId, input.homeAgentId), eq(agentExecutionScopeRequests.runId, input.homeRunId),
      eq(agentExecutionScopeRequests.requestedByUserId, input.responsibleUserId),
    )).limit(1);
    if (!request || request.issueId !== homeRun.issueId ||
      hashContextPolicySnapshot(agentExecutionScopeSchema.parse(request.scope)) !== hashContextPolicySnapshot(scope))
      throw forbidden("Delegated Context claimed request is unavailable or changed");
    const [presence] = await db.select({ agentIdentityId: agents.agentIdentityId }).from(agents).where(and(
      eq(agents.companyId, binding.guestCompanyId), eq(agents.id, binding.guestAgentId))).limit(1);
    if (!presence || presence.agentIdentityId !== binding.guestAgentIdentityId || presence.agentIdentityId !== homeRun.agentIdentityId)
      throw forbidden("Delegated Context guest presence was erased or changed");
    const { crossCompanyContextService } = await import("../cross-company-context.js");
    const currentScope = await crossCompanyContextService(db).resolve(input.actor, scope, db);
    const guestActor = currentScope.scopes.find(candidate => candidate.companyId === binding.guestCompanyId)?.localActor;
    if (!guestActor) throw forbidden("Delegated Context current guest authority is unavailable");
    const [manifest] = await db.select({ queryHash: contextManifests.queryHash, policySnapshotHash: contextManifests.policySnapshotHash,
      agentId: contextManifests.agentId, runId: contextManifests.runId }).from(contextManifests).where(and(
      eq(contextManifests.companyId, binding.guestCompanyId), eq(contextManifests.id, binding.contextManifestId))).limit(1);
    if (!manifest || manifest.agentId !== binding.guestAgentId || manifest.runId !== null)
      throw forbidden("Delegated Context guest manifest is unavailable");
    const items = await db.select({ rank: contextManifestItems.rank, sourceProvider: contextManifestItems.sourceProvider,
      sourceRef: contextManifestItems.sourceRef, sourceVersion: contextManifestItems.sourceVersion,
      contentHash: contextManifestItems.contentHash }).from(contextManifestItems).where(and(
      eq(contextManifestItems.companyId, binding.guestCompanyId), eq(contextManifestItems.manifestId, binding.contextManifestId)))
      .orderBy(contextManifestItems.rank).limit(257);
    if (items.length > 256) throw forbidden("Delegated Context item set exceeds its bounded review");
    const roots = await db.select({ memoryRecordId: contextManifestMemoryRoots.memoryRecordId,
      sourceVersion: contextManifestMemoryRoots.sourceVersion,
      payloadSourceSnapshot: contextManifestMemoryRoots.payloadSourceSnapshot }).from(contextManifestMemoryRoots).where(and(
      eq(contextManifestMemoryRoots.companyId, binding.guestCompanyId), eq(contextManifestMemoryRoots.manifestId, binding.contextManifestId)))
      .orderBy(contextManifestMemoryRoots.memoryRecordId).limit(257);
    if (roots.length > 256) throw forbidden("Delegated Context Memory roots exceed their bounded review");
    await authorizationService(db).withReadDelegatedContextSources({ homeActor: input.actor, scope,
      scopeRequestId: binding.scopeRequestId, guestCompanyId: binding.guestCompanyId, guestAgentId: binding.guestAgentId },
    async source => {
      if (!isDeepStrictEqual(source.actor, guestActor))
        throw forbidden("Delegated Context source principal changed during review");
      await revalidateStoredContextManifestSources(source.db, { companyId: binding.guestCompanyId,
        manifestId: binding.contextManifestId, agentId: binding.guestAgentId, actor: source.actor });
      return undefined;
    });
    const sourceSnapshotHash = hashContextPolicySnapshot({ items: items.map(item => ({ rank: item.rank, sourceProvider: item.sourceProvider,
      sourceRef: item.sourceRef, sourceVersion: item.sourceVersion, contentHash: item.contentHash })),
      roots: roots.map(root => ({ memoryRecordId: root.memoryRecordId, sourceVersion: root.sourceVersion,
        payloadHash: hashContextPolicySnapshot(root.payloadSourceSnapshot) })).sort((a, b) => a.memoryRecordId.localeCompare(b.memoryRecordId)) });
    if (sourceSnapshotHash !== binding.sourceSnapshotHash)
      throw forbidden("Delegated Context selected sources or retained roots changed");
    const bindingHash = hashContextPolicySnapshot({ guestCompanyId: binding.guestCompanyId,
      contextManifestId: binding.contextManifestId, homeCompanyId: binding.homeCompanyId,
      homeAgentId: binding.homeAgentId, homeAgentIdentityId: binding.homeAgentIdentityId,
      homeRunId: binding.homeRunId, scopeRequestId: binding.scopeRequestId,
      responsibleUserId: binding.responsibleUserId, guestAgentId: binding.guestAgentId,
      guestAgentIdentityId: binding.guestAgentIdentityId, purpose: binding.purpose,
      accessMode: binding.accessMode, scopeSnapshot: scope, sourceSnapshotHash, queryHash: manifest.queryHash,
      policySnapshotHash: manifest.policySnapshotHash });
    result.push({ guestCompanyId: binding.guestCompanyId, contextManifestId: binding.contextManifestId,
      guestAgentId: binding.guestAgentId, guestAgentIdentityId: binding.guestAgentIdentityId,
      scopeRequestId: binding.scopeRequestId, purpose: binding.purpose, accessMode: binding.accessMode,
      scope, queryHash: manifest.queryHash, policySnapshotHash: manifest.policySnapshotHash,
      sourceSnapshotHash, bindingHash, items, roots: roots.map(root => ({ memoryRecordId: root.memoryRecordId,
        sourceVersion: root.sourceVersion, payloadHash: hashContextPolicySnapshot(root.payloadSourceSnapshot) })) });
  }
  return result;
}
