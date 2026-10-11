import { performance } from "node:perf_hooks";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import {
  agents, agentIdentities, agentApiKeys, agentPresenceRuntimeBindings, agentRetirements,
  authUsers, companies, companyMemberships, companySecretBindings,
  connectionGrantDelegations, principalPermissionGrants, toolConnectionInstalls, instanceSettings,
  toolMcpGatewayTokens, toolGatewaySessions, toolProfileBindings, type Db,
} from "@paperclipai/db";
import {
  AGENT_RETIREMENT_MAX_BINDINGS, AGENT_RETIREMENT_POLICY_VERSION,
  agentRetirementCommandSchema, agentRetirementCountsSchema, agentRetirementViewSchema,
  v9FeatureEnabled, type AgentRetirementView,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { readBuiltInAgentMarker } from "../built-in-agent-metadata.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { instanceSettingsService } from "../instance-settings.js";
import { agentService } from "../agents.js";
import { logActivity } from "../activity-log.js";
import { withV5ActivityTransaction } from "../v5-mutations.js";

/** Human-reviewed extension of the original Agent owner. No external effects,
 * provider revocation, generic job queue or reconstructed grant authority. */
export function agentRetirementService(db: Db) {
  async function access(tx: Db, actor: AuthorizationActor, companyId: string, agentId: string) {
    const userId = v5HumanActorId(actor);
    if (actor.source === "local_implicit") throw forbidden("A verified account is required for retirement");
    const [member] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
      eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"),
    )).for("share");
    const [user] = await tx.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, userId)).for("share");
    if (!member || !user?.verified) throw forbidden("Current verified company membership is required");
    // Latch current explicit human grants as well as the original role row.
    await tx.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants).where(and(
      eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalType, "user"),
      eq(principalPermissionGrants.principalId, userId),
    )).for("share");
    const current = { ...actor, isInstanceAdmin: false, ignoreInstanceAdmin: true };
    for (const action of ["agent:read", "agents:configure", "runtime:manage"] as const)
      await assertV5Authorization(tx, current, companyId, action, { type: "agent", companyId, agentId });
    // Cleanup does not inherit another domain's write authority from agent
    // configure permission. Original access and tool administration still apply.
    for (const action of ["users:manage_permissions", "tools:admin"] as const)
      await assertV5Authorization(tx, current, companyId, action);
    return userId;
  }
  async function lock(tx: Db, actor: AuthorizationActor, companyId: string, agentId: string) {
    await tx.execute(sql`select set_config('statement_timeout','5000',true), set_config('lock_timeout','1000',true)`);
    await lockAnalyticalCompany(tx, companyId);
    await lockMemoryPrivacy(tx, companyId);
    await tx.select({ key: instanceSettings.singletonKey }).from(instanceSettings).where(eq(instanceSettings.singletonKey, "default")).for("share");
    const [company] = await tx.select({ id: companies.id, status: companies.status }).from(companies)
      .where(eq(companies.id, companyId)).for("update");
    if (!company || company.status !== "active") throw forbidden("Company retirement controls are unavailable");
    await access(tx, actor, companyId, agentId);
    // Original identity writers lock the global identity before its presence.
    // Latch that owner in the same order; a new guest presence must not appear
    // between the review and the original home-lifecycle trigger at commit.
    const [association] = await tx.select({ identityId: agents.agentIdentityId }).from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
    if (!association) throw notFound("Agent not found");
    const [identity] = await tx.select({ id: agentIdentities.id, homeCompanyId: agentIdentities.homeCompanyId,
      status: agentIdentities.status, version: sql<string>`xmin::text` }).from(agentIdentities)
      .where(eq(agentIdentities.id, association.identityId)).for("update");
    if (!identity) throw conflict("Original Agent identity is unavailable");
    const [agent] = await tx.select({ id: agents.id, name: agents.name, status: agents.status,
      permissionsDetached: sql<boolean>`permissions = '{}'::jsonb`,
      metadata: agents.metadata, version: sql<string>`xmin::text`, updatedAt: sql<string>`updated_at::text` }).from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("update");
    if (!agent) throw notFound("Agent not found");
    return { ...agent, identity };
  }
  async function bindings(tx: Db, companyId: string, agentId: string) {
    const bound = AGENT_RETIREMENT_MAX_BINDINGS + 1;
    const [settings] = await tx.select({ detached: sql<boolean>`permissions = '{}'::jsonb` }).from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("share");
    if (!settings) throw conflict("Original Agent permission settings are unavailable");
    const [keys, permissions, memberships, delegations, apps, credentials, runtimes, tokens, sessions, profiles] = await Promise.all([
      tx.select({ id: agentApiKeys.id, version: sql<string>`xmin::text` }).from(agentApiKeys).where(and(eq(agentApiKeys.companyId, companyId), eq(agentApiKeys.agentId, agentId), isNull(agentApiKeys.revokedAt))).orderBy(agentApiKeys.id).limit(bound).for("share"),
      tx.select({ id: principalPermissionGrants.id, version: sql<string>`xmin::text` }).from(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalType, "agent"), sql`lower(${principalPermissionGrants.principalId})=${agentId.toLowerCase()}`)).orderBy(principalPermissionGrants.id).limit(bound).for("share"),
      tx.select({ id: companyMemberships.id, version: sql<string>`xmin::text` }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "agent"), sql`lower(${companyMemberships.principalId})=${agentId.toLowerCase()}`, eq(companyMemberships.status, "active"))).orderBy(companyMemberships.id).limit(bound).for("share"),
      tx.select({ id: connectionGrantDelegations.id, version: sql<string>`xmin::text` }).from(connectionGrantDelegations).where(and(eq(connectionGrantDelegations.companyId, companyId), eq(connectionGrantDelegations.agentId, agentId))).orderBy(connectionGrantDelegations.id).limit(bound).for("share"),
      tx.select({ id: toolConnectionInstalls.id, version: sql<string>`xmin::text` }).from(toolConnectionInstalls).where(and(eq(toolConnectionInstalls.companyId, companyId), eq(toolConnectionInstalls.targetType, "agent"), sql`lower(${toolConnectionInstalls.targetId})=${agentId.toLowerCase()}`)).orderBy(toolConnectionInstalls.id).limit(bound).for("share"),
      tx.select({ id: companySecretBindings.id, version: sql<string>`xmin::text` }).from(companySecretBindings).where(and(eq(companySecretBindings.companyId, companyId), eq(companySecretBindings.targetType, "agent"), sql`lower(${companySecretBindings.targetId})=${agentId.toLowerCase()}`)).orderBy(companySecretBindings.id).limit(bound).for("share"),
      tx.select({ id: agentPresenceRuntimeBindings.id, version: sql<string>`xmin::text` }).from(agentPresenceRuntimeBindings).where(and(eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, agentId), ne(agentPresenceRuntimeBindings.status, "revoked"))).orderBy(agentPresenceRuntimeBindings.id).limit(bound).for("share"),
      tx.select({ id: toolMcpGatewayTokens.id, version: sql<string>`xmin::text` }).from(toolMcpGatewayTokens).where(and(eq(toolMcpGatewayTokens.companyId, companyId), eq(toolMcpGatewayTokens.subjectType, "agent"), sql`lower(${toolMcpGatewayTokens.subjectId})=${agentId.toLowerCase()}`, isNull(toolMcpGatewayTokens.revokedAt))).orderBy(toolMcpGatewayTokens.id).limit(bound).for("share"),
      tx.select({ id: toolGatewaySessions.id, version: sql<string>`xmin::text` }).from(toolGatewaySessions).where(and(eq(toolGatewaySessions.companyId, companyId), eq(toolGatewaySessions.agentId, agentId), isNull(toolGatewaySessions.revokedAt))).orderBy(toolGatewaySessions.id).limit(bound).for("share"),
      tx.select({ id: toolProfileBindings.id, version: sql<string>`xmin::text` }).from(toolProfileBindings).where(and(eq(toolProfileBindings.companyId, companyId), eq(toolProfileBindings.targetType, "agent"), sql`lower(${toolProfileBindings.targetId})=${agentId.toLowerCase()}`)).orderBy(toolProfileBindings.id).limit(bound).for("share"),
    ]);
    const counts = agentRetirementCountsSchema.safeParse({ apiKeys: keys.length, permissions: permissions.length + memberships.length + delegations.length,
      agentPermissionSettings: settings.detached ? 0 : 1,
      connectedApps: apps.length, credentialBindings: credentials.length, runtimeBindings: runtimes.length, toolTokens: tokens.length + sessions.length, toolProfiles: profiles.length });
    return { source: { keys, permissions, memberships, delegations, apps, credentials, runtimes, tokens, sessions, profiles }, counts: counts.success ? counts.data : null };
  }
  async function blockers(tx: Db, companyId: string, agentId: string) {
    // Fixed original owner columns only. No recursive content/configuration scan.
    const [row] = await tx.execute<{ work: boolean; automation: boolean; reports: boolean; disconnect: boolean; identity: boolean }>(sql`select
      exists(select 1 from agents a join agent_identities i on i.id=a.agent_identity_id
        where a.company_id=${companyId}::uuid and a.id=${agentId}::uuid and a.status<>'terminated'
          and i.home_company_id=a.company_id and i.status<>'archived'
          and exists(select 1 from agents other where other.agent_identity_id=i.id
            and other.company_id<>a.company_id and other.status<>'terminated')) as identity,
      (exists(select 1 from issues where company_id=${companyId}::uuid and assignee_agent_id=${agentId}::uuid and status not in ('done','cancelled'))
       or exists(select 1 from heartbeat_runs where company_id=${companyId}::uuid and agent_id=${agentId}::uuid and status in ('queued','scheduled_retry','running'))
       or exists(select 1 from agent_wakeup_requests where company_id=${companyId}::uuid and agent_id=${agentId}::uuid and status in ('queued','claimed'))
       or exists(select 1 from issue_thread_interactions where company_id=${companyId}::uuid and status='pending' and (addressee_agent_id=${agentId}::uuid or created_by_agent_id=${agentId}::uuid))
       or exists(select 1 from approvals where company_id=${companyId}::uuid and status in ('pending','revision_requested') and (requested_by_agent_id=${agentId}::uuid or lower(payload->>'agentId')=${agentId}::text))
       or exists(select 1 from tool_invocations where company_id=${companyId}::uuid and agent_id=${agentId}::uuid and status in ('pending','authorized','awaiting_approval','executing','failed','timed_out'))
       or exists(select 1 from tool_action_requests a join tool_invocations i on i.company_id=a.company_id and i.id=a.invocation_id where a.company_id=${companyId}::uuid and i.agent_id=${agentId}::uuid and a.status in ('pending','approved'))
       or exists(select 1 from orchestration_workers w join orchestration_plans p on p.company_id=w.company_id and p.id=w.plan_id where w.company_id=${companyId}::uuid and w.agent_id=${agentId}::uuid and p.status not in ('completed','cancelled','failed'))
       or exists(select 1 from orchestration_worker_attempts where company_id=${companyId}::uuid and agent_id=${agentId}::uuid and status='running')
       or exists(select 1 from workflow_step_runs where company_id=${companyId}::uuid and agent_id=${agentId}::uuid and status in ('pending','running','waiting','retry_scheduled','cancelling'))
       or exists(select 1 from workflow_runs where company_id=${companyId}::uuid and status in ('queued','running','waiting','recovering','cancelling')
         and execution_principal->>'type'='agent' and lower(execution_principal->>'agentId')=${agentId}::text)
      ) as work,
      (exists(select 1 from routines where company_id=${companyId}::uuid and
        (assignee_agent_id=${agentId}::uuid or (execution_target_kind='agent_task' and execution_target_ref=${agentId}::uuid)
         or (workflow_execution_principal->>'type'='agent' and lower(workflow_execution_principal->>'agentId')=${agentId}::text)))
       or exists(select 1 from pipeline_stages s join pipelines p on p.id=s.pipeline_id where p.company_id=${companyId}::uuid
         and ((s.workflow_execution_principal->>'type'='agent' and lower(s.workflow_execution_principal->>'agentId')=${agentId}::text)
          or lower(s.config->'automation'->>'assigneeAgentId')=${agentId}::text
          or (s.config->'approver'->>'kind'='agent' and lower(s.config->'approver'->>'id')=${agentId}::text)))
       or exists(select 1 from workflows w join workflow_revisions r on r.company_id=w.company_id and r.workflow_id=w.id
          and (r.id=w.published_revision_id or r.id=w.draft_revision_id)
         where w.company_id=${companyId}::uuid and w.status<>'archived'
          and exists(select 1 from jsonb_array_elements(r.graph_json->'nodes') node where lower(node->'config'->>'agentId')=${agentId}::text))
      ) as automation,
      exists(select 1 from agents where company_id=${companyId}::uuid and reports_to=${agentId}::uuid and status<>'terminated') as reports,
      (exists(select 1 from connection_grants where company_id=${companyId}::uuid and subject_agent_id=${agentId}::uuid and status<>'revoked')
       or exists(select 1 from tool_oauth_states where company_id=${companyId}::uuid and subject_agent_id=${agentId}::uuid and expires_at>clock_timestamp())
       or exists(select 1 from connection_token_issuances where company_id=${companyId}::uuid and agent_id=${agentId}::uuid and outcome in ('success','upstream_error','failure') and (expires_at is null or expires_at>clock_timestamp()))
       or exists(select 1 from company_agent_package_installations where company_id=${companyId}::uuid and agent_id=${agentId}::uuid and status not in ('suspended','uninstalled'))
      ) as disconnect`);
    if (!row) throw conflict("Original retirement sources are unavailable");
    return row;
  }
  async function snapshot(tx: Db, companyId: string, agent: Awaited<ReturnType<typeof lock>>) {
    const access = await bindings(tx, companyId, agent.id), pending = await blockers(tx, companyId, agent.id);
    const token = nativeSha256({ companyId, agentId: agent.id, version: agent.version, updatedAt: agent.updatedAt,
      identity: agent.identity, access: access.source, pending });
    return { ...access, pending, token };
  }
  async function view(tx: Db, companyId: string, agent: Awaited<ReturnType<typeof lock>>, source: Awaited<ReturnType<typeof snapshot>>) {
    const [receipt] = await tx.select().from(agentRetirements).where(and(eq(agentRetirements.companyId, companyId), eq(agentRetirements.agentId, agent.id))).for("share");
    const reasons: AgentRetirementView["blockers"] = [];
    if (!receipt) {
      if (!["paused", "terminated"].includes(agent.status)) reasons.push("pause_required");
      if (readBuiltInAgentMarker(agent.metadata)) reasons.push("protected_agent");
      if (source.pending.identity) reasons.push("identity_lifecycle");
      if (source.pending.work) reasons.push("work_pending");
      if (source.pending.automation) reasons.push("automation_connected");
      if (source.pending.reports) reasons.push("reports_pending");
      if (source.pending.disconnect) reasons.push("disconnect_required");
      if (!source.counts) reasons.push("source_limit");
      if (!v9FeatureEnabled(await instanceSettingsService(tx).getExperimental(), "hire_agent_v9")) reasons.push("disabled");
    } else if (agent.status !== "terminated" || !agent.permissionsDetached || !source.counts || Object.values(source.counts).some(value => value !== 0) || Object.values(source.pending).some(Boolean)) {
      throw conflict("Recorded retirement no longer matches its original Native postcondition");
    }
    return agentRetirementViewSchema.parse({ companyId, agentId: agent.id, name: Array.from(agent.name).slice(0, 200).join(""),
      observedAt: new Date().toISOString(), sourceToken: source.token, state: receipt ? "retired" : reasons.length ? "blocked" : "ready",
      alreadyStopped: agent.status === "terminated",
      canRetire: !receipt && !reasons.length, blockers: reasons, affectedAccess: receipt ? receipt.detachedAccess : source.counts,
      retiredAt: receipt?.retiredAt.toISOString() ?? null, policyVersion: AGENT_RETIREMENT_POLICY_VERSION });
  }
  return {
    get: async (actor: AuthorizationActor, companyId: string, agentId: string) => db.transaction(async transaction => {
      const tx = transaction as unknown as Db, start = performance.now();
      const agent = await lock(tx, actor, companyId, agentId), current = await snapshot(tx, companyId, agent);
      const result = await view(tx, companyId, agent, current);
      await access(tx, actor, companyId, agentId);
      if (performance.now() - start > 5000) throw conflict("Retirement read exceeded its original budget");
      return result;
    }),
    retire: async (actor: AuthorizationActor, companyId: string, agentId: string, raw: unknown) => {
      companyId = companyId.toLowerCase(); agentId = agentId.toLowerCase();
      const input = agentRetirementCommandSchema.parse(raw), requestHash = nativeSha256({ companyId, agentId, input });
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const start = performance.now(), agent = await lock(tx, actor, companyId, agentId);
        const [receipt] = await tx.select().from(agentRetirements).where(and(eq(agentRetirements.companyId, companyId), eq(agentRetirements.agentId, agentId))).for("share");
        if (receipt) {
          if (receipt.requestId !== input.requestId || receipt.requestHash !== requestHash) throw conflict("The original Agent has already been retired", { code: "AGENT_RETIREMENT_REQUEST_CONFLICT" });
          const result = await view(tx, companyId, agent, await snapshot(tx, companyId, agent));
          if (performance.now() - start > 5000) throw conflict("Retirement replay exceeded its original budget");
          return result;
        }
        const current = await snapshot(tx, companyId, agent), reviewed = await view(tx, companyId, agent, current);
        if (!reviewed.canRetire || current.token !== input.expectedSourceToken) throw conflict("Review current retirement requirements before continuing", { code: "AGENT_RETIREMENT_SOURCE_CHANGED" });
        const userId = await access(tx, actor, companyId, agentId);
        await tx.execute(sql`select set_config('aw_v9.agent_retirement_intent', ${`${companyId}:${agentId}:${input.requestId}`}, true)`);
        await agentService(tx).terminate(agentId);
        await tx.update(agents).set({ permissions: {} }).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
        await tx.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalType, "agent"), sql`lower(${principalPermissionGrants.principalId})=${agentId.toLowerCase()}`));
        await tx.update(companyMemberships).set({ status: "inactive", updatedAt: new Date() }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "agent"), sql`lower(${companyMemberships.principalId})=${agentId.toLowerCase()}`, eq(companyMemberships.status, "active")));
        await tx.delete(connectionGrantDelegations).where(and(eq(connectionGrantDelegations.companyId, companyId), eq(connectionGrantDelegations.agentId, agentId)));
        await tx.delete(toolConnectionInstalls).where(and(eq(toolConnectionInstalls.companyId, companyId), eq(toolConnectionInstalls.targetType, "agent"), sql`lower(${toolConnectionInstalls.targetId})=${agentId.toLowerCase()}`));
        await tx.delete(companySecretBindings).where(and(eq(companySecretBindings.companyId, companyId), eq(companySecretBindings.targetType, "agent"), sql`lower(${companySecretBindings.targetId})=${agentId.toLowerCase()}`));
        await tx.delete(toolProfileBindings).where(and(eq(toolProfileBindings.companyId, companyId), eq(toolProfileBindings.targetType, "agent"), sql`lower(${toolProfileBindings.targetId})=${agentId.toLowerCase()}`));
        const now = new Date();
        await tx.update(agentPresenceRuntimeBindings).set({ status: "revoked", updatedAt: now }).where(and(eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, agentId), ne(agentPresenceRuntimeBindings.status, "revoked")));
        await tx.update(toolMcpGatewayTokens).set({ revokedAt: now }).where(and(eq(toolMcpGatewayTokens.companyId, companyId), eq(toolMcpGatewayTokens.subjectType, "agent"), sql`lower(${toolMcpGatewayTokens.subjectId})=${agentId.toLowerCase()}`, isNull(toolMcpGatewayTokens.revokedAt)));
        await tx.update(toolGatewaySessions).set({ revokedAt: now, updatedAt: now }).where(and(eq(toolGatewaySessions.companyId, companyId), eq(toolGatewaySessions.agentId, agentId), isNull(toolGatewaySessions.revokedAt)));
        const postcondition = await bindings(tx, companyId, agentId);
        if (!postcondition.counts || Object.values(postcondition.counts).some(value => value !== 0) || Object.values(await blockers(tx, companyId, agentId)).some(Boolean)) throw conflict("The original retirement postcondition was not verified");
        await tx.insert(agentRetirements).values({ companyId, agentId, requestId: input.requestId, requestHash, sourceToken: current.token,
          policyVersion: AGENT_RETIREMENT_POLICY_VERSION, detachedAccess: current.counts!, retiredAt: sql`clock_timestamp()` });
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "agent.retired", entityType: "agent", entityId: agentId,
          details: { policyVersion: AGENT_RETIREMENT_POLICY_VERSION, detachedAccess: current.counts, postcondition: "native_agent_access_detached", externalEffects: false } }, publications);
        await access(tx, actor, companyId, agentId);
        if (performance.now() - start > 5000) throw conflict("Retirement write exceeded its original budget");
        const retired = await lock(tx, actor, companyId, agentId);
        const result = await view(tx, companyId, retired, await snapshot(tx, companyId, retired));
        if (performance.now() - start > 5000) throw conflict("Retirement result exceeded its original budget");
        return result;
      });
    },
  };
}
