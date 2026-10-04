import { and, eq, sql } from "drizzle-orm";
import { agentIdentities, agents, companies, heartbeatRuns, issues, contextManifestItems, companySkillTestRuns, companySkillEvalRuns, agentExecutionManifests, agentExecutionManifestItems, agentExecutionAuthorizations, agentExecutionScopeRequests, companySkillUsageEvents, type Db } from "@paperclipai/db";
import { agentExecutionManifestSchema, createExecutionScopeRequestSchema, v5FeatureEnabled, type AgentExecutionScope } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict, forbidden, notFound } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { instanceSettingsService } from "./instance-settings.js";
import { agentProviderBindingService } from "./agent-provider-bindings.js";
import { crossCompanyContextService } from "./cross-company-context.js";
import { contextEngineService } from "./context/context-engine.js";
import { hashContextPolicySnapshot } from "./context/context-manifest.js";
import { rolePackService } from "./role-packs.js";
import { skillResolverService } from "./skill-resolver.js";
import { capabilityResolverService } from "./capability-resolver.js";
import { withV5ActivityTransaction } from "./v5-mutations.js";
import { playbookResolverService } from "./playbook-resolver.js";
import { logActivity } from "./activity-log.js";

export function agentRuntimeFabricService(db: Db) {
  async function primary(actor: AuthorizationActor, companyId: string, agentId: string) {
    await assertV5Authorization(db, actor, companyId, "company_scope:read");
    if (actor.type === "agent" && (actor.companyId !== companyId || actor.agentId !== agentId)) throw forbidden("Execution must use the authenticated local presence");
    const [row] = await db.select({ agent: agents, identity: agentIdentities, company: companies }).from(agents)
      .innerJoin(agentIdentities, eq(agentIdentities.id, agents.agentIdentityId)).innerJoin(companies, eq(companies.id, agents.companyId))
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).limit(1);
    if (!row || row.company.status !== "active" || row.identity.status !== "active" || !["idle", "running", "error"].includes(row.agent.status)) throw forbidden("An active, invokable local presence and logical identity are required");
    return row;
  }
  async function freshContext(actor: AuthorizationActor, scope: AgentExecutionScope, query: string, runId: string, issueId: string | null) {
    if (scope.delegatedScopes.length) {
      const packet = await crossCompanyContextService(db).assemble(actor, { executionScope: scope, query, intent: "v5_runtime_execution", maxEstimatedTokens: 8000 });
      return { refs: packet.manifests, markdown: packet.evidence.map((e) => `### ${e.title ?? e.sourceType}\nSource company: ${e.sourceCompanyName} (${e.sourceCompanyId})\nClassification: ${e.shareClassification}; use: ${e.crossCompanyUsePolicy}\n${e.excerpt}\nCitation: ${e.citation.label}`).join("\n\n"), warnings: packet.warnings };
    }
    const result = await contextEngineService(db).assemble({ companyId: scope.primaryCompanyId, agentId: scope.primaryAgentPresenceId, responsibleUserId: actor.onBehalfOfUserId ?? actor.userId ?? null, enforceResponsibleUserIntersection: true, runId, issueId, query, intent: "v5_runtime_execution", includeFoundation: true, sensitivityCeiling: "internal" });
    if (!result.packet.manifest) throw conflict("Runtime context requires persisted provenance");
    return { refs: [{ companyId: scope.primaryCompanyId, contextManifestId: result.packet.manifest.id }], markdown: result.markdown, warnings: [] as string[] };
  }
  return {
    requestScope: async (actor: AuthorizationActor, companyId: string, agentId: string, raw: z.infer<typeof createExecutionScopeRequestSchema>) => {
      await assertV5Enabled(db, "agent_runtime_fabric_v5");
      const input = createExecutionScopeRequestSchema.parse(raw), userId = v5HumanActorId(actor);
      if (input.executionScope.primaryCompanyId !== companyId || input.executionScope.primaryAgentPresenceId !== agentId) throw forbidden("Primary scope must match the requested local presence");
      await primary(actor, companyId, agentId);
      await assertV5Authorization(db, actor, companyId, "agent:wake", { type: "agent", companyId, agentId });
      if (input.executionScope.delegatedScopes.length) await crossCompanyContextService(db).resolve(actor, input.executionScope);
      if (input.issueId) {
        const [issue] = await db.select({ id: issues.id }).from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, input.issueId))).limit(1);
        if (!issue) throw notFound("Task not found");
        await assertV5Authorization(db, actor, companyId, "issue:read", { type: "issue", companyId, issueId: input.issueId });
      }
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const [request] = await tx.insert(agentExecutionScopeRequests).values({ companyId, agentId, requestedByUserId: userId, scope: input.executionScope, query: input.query, issueId: input.issueId, expiresAt: new Date(Date.now() + 15 * 60_000) }).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "runtime.execution_scope_requested", entityType: "agent", entityId: agentId, details: { scopeRequestId: request!.id, companies: [companyId, ...input.executionScope.delegatedScopes.map((s) => s.companyId)] } }, publications);
        return request!;
      });
    },
    getManifest: async (actor: AuthorizationActor, companyId: string, runId: string) => {
      await assertV5Authorization(db, actor, companyId, "company_scope:read");
      const [row] = await db.select().from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.runId, runId))).limit(1);
      if (!row) throw notFound("Execution manifest not found");
      if (actor.type === "agent") await primary(actor, companyId, row.agentId);
      else await assertV5Authorization(db, actor, companyId, "agent_config:read", { type: "agent", companyId, agentId: row.agentId });
      // Every source company's present rights are required even to inspect its
      // scope/profile metadata. Identity membership alone grants nothing.
      if (row.manifest.executionScope.delegatedScopes.length) await crossCompanyContextService(db).resolve(actor, row.manifest.executionScope);
      return row;
    },
    prepare: async (input: { companyId: string; agentId: string; runId: string; responsibleUserId: string | null; issueId: string | null; query: string; scopeRequestId?: string | null }) => {
      const flags = await instanceSettingsService(db).getExperimental();
      const [stored] = await db.select().from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, input.companyId), eq(agentExecutionManifests.runId, input.runId))).limit(1);
      if (!stored && !v5FeatureEnabled(flags, "agent_runtime_fabric_v5")) return null;
      const actor: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId: input.companyId, agentId: input.agentId, runId: input.runId, onBehalfOfUserId: input.responsibleUserId };
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.id, input.runId))).limit(1);
      if (!run || run.responsibleUserId !== input.responsibleUserId) throw forbidden("Execution authority does not match the persisted run");
      const local = await primary(actor, input.companyId, input.agentId);
      let scope: AgentExecutionScope = stored?.manifest.executionScope ?? { primaryCompanyId: input.companyId, primaryAgentPresenceId: input.agentId, delegatedScopes: [] };
      let query = input.query.trim().slice(0, 500) || "Execute the assigned task";
      if (input.scopeRequestId) {
        const [request] = await db.select().from(agentExecutionScopeRequests).where(and(eq(agentExecutionScopeRequests.id, input.scopeRequestId), eq(agentExecutionScopeRequests.companyId, input.companyId), eq(agentExecutionScopeRequests.agentId, input.agentId))).limit(1);
        if (!request || request.requestedByUserId !== input.responsibleUserId || request.issueId !== input.issueId || (request.runId !== input.runId && (request.runId || request.expiresAt <= new Date()))) throw forbidden("Execution scope request is expired, claimed, or belongs to another operator/task");
        const [claimed] = await db.update(agentExecutionScopeRequests).set({ runId: input.runId }).where(and(eq(agentExecutionScopeRequests.id, request.id), sql`(${agentExecutionScopeRequests.runId} is null or ${agentExecutionScopeRequests.runId} = ${input.runId})`)).returning();
        if (!claimed) throw conflict("Execution scope was already claimed");
        scope = request.scope; query = request.query;
      }
      const scoped = scope.delegatedScopes.length ? await crossCompanyContextService(db).resolve(actor, scope) : null;
      const provider = await agentProviderBindingService(db).assertRuntime(input.companyId, input.agentId);
      const providers = [{ companyId: input.companyId, agentId: input.agentId, providerBindingId: provider.provider.id, profileRef: provider.runtime.providerProfileRef, snapshotHash: provider.provider.capabilitySnapshot!.hash, isolationMode: provider.provider.isolationMode as "isolated_per_presence" | "shared_trusted_runtime" }, ...(scoped?.scopes.filter((s) => s.companyId !== input.companyId).map((s) => ({ companyId: s.companyId, agentId: s.presence.id, providerBindingId: s.provider.provider.id, profileRef: s.provider.runtime.providerProfileRef, snapshotHash: s.provider.provider.capabilitySnapshot!.hash, isolationMode: s.provider.provider.isolationMode as "isolated_per_presence" | "shared_trusted_runtime" })) ?? [])];
      const rolePack = v5FeatureEnabled(flags, "role_packs_v5") ? await rolePackService(db).resolve(actor, input.companyId, input.agentId) : null;
      const [test] = input.issueId ? await db.select().from(companySkillTestRuns).where(and(eq(companySkillTestRuns.companyId, input.companyId), eq(companySkillTestRuns.agentId, input.agentId), eq(companySkillTestRuns.issueId, input.issueId))).limit(1) : [];
      if (test?.deletedAt) throw conflict("This Skill test was deleted");
      if (test?.evaluationContext) {
        const [evaluation] = await db.select().from(companySkillEvalRuns).where(and(eq(companySkillEvalRuns.companyId, input.companyId), eq(companySkillEvalRuns.id, test.evaluationContext.evaluationRunId))).limit(1);
        if (!evaluation || evaluation.status !== "running" || evaluation.createdByUserId !== input.responsibleUserId) throw forbidden("Skill evaluation authority is no longer current");
      }
      // Test input is the actual query. Expected trigger labels never enter
      // resolver inputs, so negative controls can observe real non-selection.
      if (test) query = test.inputSnapshot.slice(0, 500);
      if (!v5FeatureEnabled(flags, "skill_resolver_v5") && rolePack?.items.some((item) => item.type === "required_skill")) throw conflict("This Role Pack requires the Skill resolver runtime");
      const resolvedSkills = !stored && v5FeatureEnabled(flags, "skill_resolver_v5") ? await skillResolverService(db).resolve(actor, input.companyId, query, test?.evaluationContext ? [] : rolePack?.items ?? [], test ? { skillId: test.skillId, versionId: test.skillVersionId } : undefined) : { skills: stored?.manifest.skills ?? [], estimatedTokens: stored?.manifest.inventoryEstimatedTokens ?? 0, warnings: [] };
      const resolvedPlaybooks = !stored && v5FeatureEnabled(flags, "playbooks_v5") ? await playbookResolverService(db).resolve(actor, input.companyId, query, rolePack?.items ?? []) : { pins: stored?.manifest.playbooks ?? [], warnings: [] as string[] };
      if (!v5FeatureEnabled(flags, "playbooks_v5") && rolePack?.items.some((item) => item.type === "required_playbook")) throw conflict("This Role Pack requires the Playbook runtime");
      const capabilities = await capabilityResolverService(db).search(actor, input.companyId, "");
      const context = await freshContext(actor, scope, query, input.runId, input.issueId);
      if (stored) {
        if (stored.agentId !== input.agentId || stored.agentIdentityId !== local.identity.id || hashContextPolicySnapshot(stored.manifest.providers) !== hashContextPolicySnapshot(providers)) throw conflict("Pinned provider identity/profile changed; start a new execution");
        for (const pin of stored.manifest.skills) await skillResolverService(db).authorizedVersion(actor, input.companyId, pin.skillId, pin.versionId, Boolean(test && pin.skillId === test.skillId && pin.versionId === test.skillVersionId));
        for (const pin of stored.manifest.playbooks) await playbookResolverService(db).validate(actor, input.companyId, pin);
        for (const pin of stored.manifest.capabilities) if (!capabilities.some((c) => c.ref === pin.ref && c.versionHash === pin.versionHash && (pin.access !== "allowed" || c.access === "allowed"))) throw forbidden("A pinned execution capability is no longer authorized/available");
        // Reconstruct current context rather than treating the old manifest as
        // authority. If old evidence disappeared, never dispatch its old body.
        const currentRefs = new Set<string>();
        for (const ref of context.refs) for (const item of await db.select().from(contextManifestItems).where(and(eq(contextManifestItems.companyId, ref.companyId), eq(contextManifestItems.manifestId, ref.contextManifestId)))) currentRefs.add(`${ref.companyId}:${item.sourceProvider}:${item.sourceRef}:${item.contentHash}`);
        for (const ref of stored.manifest.contextManifests) for (const item of await db.select().from(contextManifestItems).where(and(eq(contextManifestItems.companyId, ref.companyId), eq(contextManifestItems.manifestId, ref.contextManifestId)))) if (!currentRefs.has(`${ref.companyId}:${item.sourceProvider}:${item.sourceRef}:${item.contentHash}`)) throw forbidden("Previously admitted context is no longer authorized/current; start a fresh execution");
      }
      const policies = rolePack?.items.filter((r) => r.type === "required_policy").map((r) => r.ref) ?? ["budget_hard_stop", "source_provenance", "approval_before_side_effects"];
      for (const expectation of rolePack?.items.filter((r) => r.type === "capability_expectation") ?? []) if (!capabilities.some((c) => c.ref === expectation.ref && (!expectation.versionId || c.versionHash === expectation.versionId))) throw conflict(`Required capability unavailable: ${expectation.ref}`);
      if (!stored) {
        const expected = new Set(rolePack?.items.filter((item) => item.type === "capability_expectation").map((item) => item.ref) ?? []);
        let tokens = 0;
        for (let index = 0; index < capabilities.length;) {
          const capability = capabilities[index]!, cost = Math.ceil(Buffer.byteLength(`${capability.type}:${capability.ref}; ${capability.access}; risk ${capability.risk}; version ${capability.versionHash ?? "current"}`, "utf8") / 4);
          if (!expected.has(capability.ref) && tokens + cost > 1500) capabilities.splice(index, 1);
          else { tokens += cost; index++; }
        }
        if (tokens > 2000) throw conflict("Required capabilities exceed the bounded runtime inventory; split this Role Pack");
      }
      const policyHash = hashContextPolicySnapshot({ scope, policies, providers, capabilities });
      const manifest = stored?.manifest ?? agentExecutionManifestSchema.parse({ schemaVersion: 5, runId: input.runId, companyId: input.companyId, agentId: input.agentId, agentIdentityId: local.identity.id, homeCompanyId: local.identity.homeCompanyId, responsibleUserId: input.responsibleUserId, executionScope: scope, rolePack: rolePack ? { systemKey: rolePack.systemKey, systemVersion: rolePack.systemVersion, pins: rolePack.pins } : null, contextManifests: context.refs, skills: resolvedSkills.skills, playbooks: resolvedPlaybooks.pins, capabilities, providers, executionPolicy: { deterministicPreference: true, policies, approvalRefs: [], restrictions: ["Every action requires current local authority", "Guest evidence retains source-company classification", "Provider-local tools do not grant platform permissions"], policySnapshotHash: policyHash }, inventoryEstimatedTokens: resolvedSkills.estimatedTokens, warnings: [...resolvedSkills.warnings, ...resolvedPlaybooks.warnings, ...context.warnings].slice(0, 64) });
      const inventory = ["## Pinned execution inventory", `Run: ${manifest.runId}; company: ${input.companyId}; local presence: ${input.agentId}`, `Policies: ${manifest.executionPolicy.policies.join(", ")}`, ...manifest.executionPolicy.restrictions.map((restriction) => `- ${restriction}`), "Skills (procedures; no permission grants):", ...manifest.skills.map((pin) => `- ${pin.key} (${pin.skillId}@${pin.versionId}); ${pin.selection}; load ${pin.loadPoint}${pin.loadPoint === "on_demand" ? ` via GET /api/companies/${input.companyId}/runs/${input.runId}/skills/${pin.skillId}/body` : ""}`), "Playbook references (canonical organizational procedures):", ...manifest.playbooks.map((pin) => `- ${pin.playbookId}@${pin.revisionId}; ${pin.required ? "required" : "recommended"}; retrieve using the company Playbook API`), `Explicit scoped actions: POST /api/companies/${input.companyId}/runs/${input.runId}/scoped-actions using this primary run authentication. Specify action and companyId. task.read uses taskId; task.forecast uses projectId, taskId and forecast; task.propose_plan uses projectId and proposal; playbook.propose uses playbookId and proposal. tool.list lists authorized local connected tools; tool.invoke uses tool, parameters and an idempotencyKey for mutations. Connection output is confidential and cannot be exported further. Guest mutations require their selected mode and current local authority; commitment review and forecast policy still apply. Never reuse primary-company keys directly against guest-company APIs.`, "Capabilities (current authorization is required at each use; prefer deterministic execution):", ...manifest.capabilities.map((pin) => `- ${pin.type}:${pin.ref}; ${pin.access}; risk ${pin.risk}; version ${pin.versionHash ?? "current"}`)].join("\n");
      const inventoryTokens = Math.ceil(Buffer.byteLength(inventory, "utf8") / 4);
      if (inventoryTokens > 4000) throw conflict("Pinned execution inventory exceeds 4000 estimated tokens; split the task requirements");
      if (!stored) manifest.inventoryEstimatedTokens = inventoryTokens;
      const record = await withV5ActivityTransaction(db, async (tx, publications) => {
        await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.id, input.runId)).for("update");
        let row = stored;
        if (!row) {
          [row] = await tx.insert(agentExecutionManifests).values({ companyId: input.companyId, runId: input.runId, agentId: input.agentId, agentIdentityId: local.identity.id, contextManifestId: context.refs[0]!.contextManifestId, manifest, policySnapshotHash: policyHash, hash: hashContextPolicySnapshot(manifest) }).returning();
          const items = [...manifest.skills.map((p) => ({ type: "skill", ref: p.skillId, versionRef: p.versionId })), ...manifest.playbooks.map((p) => ({ type: "playbook", ref: p.playbookId, versionRef: p.revisionId })), ...manifest.capabilities.map((c) => ({ type: "capability", ref: c.ref, versionRef: c.versionHash })), ...manifest.contextManifests.map((c) => ({ type: "company_scope", ref: c.companyId, versionRef: c.contextManifestId }))];
          if (items.length) await tx.insert(agentExecutionManifestItems).values(items.map((i) => ({ ...i, companyId: input.companyId, manifestId: row!.id })));
          await logActivity(tx, { companyId: input.companyId, actorType: "system", actorId: "runtime-fabric", action: "runtime.manifest_created", entityType: "heartbeat_run", entityId: input.runId, details: { manifestId: row!.id, hash: row!.hash } }, publications);
        }
        await tx.insert(agentExecutionAuthorizations).values({ companyId: input.companyId, manifestId: row!.id, contextManifestRefs: context.refs, authorityHash: policyHash });
        for (const pin of manifest.skills) await tx.insert(companySkillUsageEvents).values({ companyId: input.companyId, runId: input.runId, agentId: input.agentId, skillId: pin.skillId, skillVersionId: pin.versionId, selectionReason: pin.selection, stage: "selected" }).onConflictDoNothing();
        await tx.update(heartbeatRuns).set({ contextSnapshot: sql`coalesce(${heartbeatRuns.contextSnapshot}, '{}'::jsonb) || ${JSON.stringify({ v5ExecutionManifestId: row!.id })}::jsonb` }).where(eq(heartbeatRuns.id, input.runId));
        return row!;
      });

      return { record, manifest, contextMarkdown: `${inventory}\n\n${context.markdown}`, testSelected: Boolean(test && manifest.skills.some((p) => p.skillId === test.skillId)), providerRuntime: { providerType: provider.provider.providerType, providerBindingId: provider.provider.id, providerAgentRef: provider.provider.providerAgentRef, providerProfileRef: provider.runtime.providerProfileRef, sessionNamespace: provider.runtime.providerSessionNamespace, isolationMode: provider.provider.isolationMode as "isolated_per_presence" | "shared_trusted_runtime", capabilitySnapshotHash: provider.provider.capabilitySnapshot!.hash } };
    },
  };
}
