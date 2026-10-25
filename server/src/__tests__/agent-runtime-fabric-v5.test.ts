import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { agents, companyMemberships, agentExecutionManifests, agentExecutionScopeRequests, delegatedContextManifestBindings, heartbeatRuns, instanceSettings, issues, projects, toolApplications, toolConnections, connectionGrants, contextManifests, toolCatalogEntries, toolProfiles, toolProfileBindings, toolInvocations, principalPermissionGrants, createDb } from "@paperclipai/db";
import { PROVIDER_CAPABILITY_FEATURES } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase, getEmbeddedPostgresTestSupport } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { skillTaskMatches } from "../services/skill-resolver.js";
import { crossCompanyContextService } from "../services/cross-company-context.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { scopedRuntimeActionService } from "../services/scoped-runtime-actions.js";
import { resolveDelegatedContextManifestBindings } from "../services/context/delegated-context-binding.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
import { projectControlService } from "../services/project-control.js";
import { issueService } from "../services/issues.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import { foundationIndexService } from "../services/foundation/foundation-index.js";
import { createCanonicalHumanProject, seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
import { roadmapPolicySchema, crossCompanyPolicySchema } from "@paperclipai/shared";

it("negative triggers veto selection and empty trigger sets do not match every task", () => {
  expect(skillTaskMatches("review database migration", ["database"], [])).toBe(true);
  expect(skillTaskMatches("explain database without migration", ["database"], ["without migration"])).toBe(false);
  expect(skillTaskMatches("anything", [], [])).toBe(false);
  expect(skillTaskMatches("build the Linux service", ["ui", "ux"], [])).toBe(false);
  expect(skillTaskMatches("Build the UI: keyboard flow", ["ui"], [])).toBe(true);
  expect(skillTaskMatches("migration on PostgreSQL", ["migration"], ["sql"])).toBe(true);
  expect(skillTaskMatches("Review DATABASE   MIGRATION", ["database migration"], [])).toBe(true);
  expect(skillTaskMatches("Ret tilgængelighed i grænsefladen", ["tilgængelighed"], [])).toBe(true);
});
const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("V5 execution authority", () => {
  let db!: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v5-runtime-"); db = createDb(database.connectionString); await enableV5ForTest(db); const [settings] = await db.select().from(instanceSettings); await db.update(instanceSettings).set({ experimental: { ...settings!.experimental, role_packs_v5: false, skill_resolver_v5: false } }).where(eq(instanceSettings.singletonKey, "default")); });
  afterAll(async () => { await database?.cleanup(); });
  it("does not discard required Role Pack Skills when their resolver is disabled", async () => {
    const f = await seedV5Presences(db), providers = agentProviderBindingService(db), svc = agentRuntimeFabricService(db);
    const binding = await providers.create(f.actor, f.home, f.presence.id, { providerType: "paperclip_native", providerAgentRef: f.presence.id, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
    await providers.attach(f.actor, f.home, f.presence.id, { providerBindingId: binding.id, providerProfileRef: f.presence.id });
    await providers.recordDiscovery(f.home, f.presence.id, { provider: "paperclip_native", version: "internal-fixture", features: Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map(key => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>, skills: [], tools: [], discoveredAt: new Date().toISOString() }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId, status: "running" }).returning();
    const [settings] = await db.select().from(instanceSettings).where(eq(instanceSettings.singletonKey, "default"));
    const input = { companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: null, query: "Review security permissions" };
    try {
      await db.update(instanceSettings).set({ experimental: { ...settings!.experimental, role_packs_v5: true, skill_resolver_v5: false } }).where(eq(instanceSettings.singletonKey, "default"));
      await expect(svc.prepare(input)).rejects.toMatchObject({ status: 409 });
      expect(await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, run!.id))).toEqual([]);
      await db.update(instanceSettings).set({ experimental: { ...settings!.experimental, role_packs_v5: true, skill_resolver_v5: true } }).where(eq(instanceSettings.singletonKey, "default"));
      // Enabling the resolver cannot fabricate the still-missing required Skill.
      await expect(svc.prepare(input)).rejects.toMatchObject({ status: 409 });
      expect(await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, run!.id))).toEqual([]);
    } finally {
      await db.update(instanceSettings).set({ experimental: settings!.experimental }).where(eq(instanceSettings.singletonKey, "default"));
    }
  });
  it("allows explicitly authorized guest act forecasts, denies read/contribute mutations and rechecks revoked humans", async () => {
    const f = await seedV5Presences(db), providers = agentProviderBindingService(db), fabric = agentRuntimeFabricService(db), cross = crossCompanyContextService(db), actions = scopedRuntimeActionService(db);
    const currentHuman = await seedCurrentHumanSourceActor(db, [f.home, f.guest], f.userId);
    const features = Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map((key) => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>;
    for (const [companyId, agentId] of [[f.home, f.presence.id], [f.guest, f.guestPresence.id]] as const) {
      const binding = await providers.create(f.actor, companyId, agentId, { providerType: "paperclip_native", providerAgentRef: agentId, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
      await providers.attach(f.actor, companyId, agentId, { providerBindingId: binding.id, providerProfileRef: agentId });
      await providers.recordDiscovery(companyId, agentId, { provider: "paperclip_native", version: "internal-fixture", features, skills: [], tools: [], discoveredAt: new Date().toISOString() }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
    }
    await cross.setPolicy(f.actor, f.guest, crossCompanyPolicySchema.parse({ allowRead: true, allowContribute: true, allowAct: true }));
    const project = await createCanonicalHumanProject(db, f.guest, currentHuman, "Guest delivery");
    await projectControlService(db).policy(currentHuman, f.guest, project.id, roadmapPolicySchema.parse({ allowAgentForecast: true }));
    const task = await issueService(db).create(f.guest, { projectId: project.id, title: "Guest task", status: "todo",
      assigneeAgentId: f.guestPresence.id, createdByUserId: f.userId, responsibleUserId: f.userId }, db, undefined,
      { manualInputActor: currentHuman, privacyActor: currentHuman, sourceAccessActor: currentHuman });
    const foundationActor = { principal: { type: "user" as const, userId: f.userId } };
    const foundation = await foundationService(db).createDraft(f.guest, { foundationKey: "guest_delivery_guidance",
      title: "Guest delivery guidance", body: "Guest task forecast the explicitly delegated guest delivery",
      category: "company", documentType: "profile", sensitivity: "internal", reviewFrequencyDays: 30 }, foundationActor);
    await foundationService(db).submitForReview(f.guest, foundation.id, foundation.latestRevisionId!, foundationActor);
    await foundationService(db).approve(f.guest, foundation.id, foundation.latestRevisionId!, foundationActor);
    await foundationIndexService(db).reindexRevision(f.guest, foundation.id, foundation.latestRevisionId!);
    expect(await foundationIndexService(db).search(f.guest, { query: "Guest task forecast the explicitly delegated guest delivery",
      limit: 12, scope: "approved" }, currentHuman, "task")).toHaveLength(1);
    let firstDelegated: { contextManifestId: string } | null = null;
    let lastDelegated: { contextManifestId: string } | null = null;
    for (const accessMode of ["read", "contribute", "act"] as const) {
      const query = "Guest task forecast the explicitly delegated guest delivery";
      const request = await fabric.requestScope(currentHuman, f.home, f.presence.id, { executionScope: { primaryCompanyId: f.home, primaryAgentPresenceId: f.presence.id, delegatedScopes: [{ companyId: f.guest, agentPresenceId: f.guestPresence.id, accessMode, purpose: query }] }, query, issueId: null });
      const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId, status: "running" }).returning();
      const prepared = await fabric.prepare({ companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: null, query, scopeRequestId: request.id });
      const guestContext = prepared?.inputContextManifests.find(ref => ref.companyId === f.guest);
      expect(guestContext).toBeDefined();
      const [guestManifest] = await db.select().from(contextManifests).where(and(
        eq(contextManifests.companyId, f.guest), eq(contextManifests.id, guestContext!.contextManifestId)));
      expect(guestManifest).toMatchObject({ companyId: f.guest, runId: null, agentId: f.guestPresence.id });
      const [delegatedBinding] = await db.select().from(delegatedContextManifestBindings).where(and(
        eq(delegatedContextManifestBindings.guestCompanyId, f.guest),
        eq(delegatedContextManifestBindings.contextManifestId, guestContext!.contextManifestId)));
      expect(delegatedBinding).toMatchObject({ homeCompanyId: f.home, homeAgentId: f.presence.id,
        homeAgentIdentityId: f.identity.id, homeRunId: run!.id, scopeRequestId: request.id,
        responsibleUserId: f.userId, guestAgentId: f.guestPresence.id, guestAgentIdentityId: f.identity.id,
        purpose: query, accessMode, scopeSnapshot: { primaryCompanyId: f.home, primaryAgentPresenceId: f.presence.id } });
      if (accessMode === "read") firstDelegated = { contextManifestId: guestContext!.contextManifestId };
      if (accessMode === "act") lastDelegated = { contextManifestId: guestContext!.contextManifestId };
      const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.home, agentId: f.presence.id, runId: run!.id, onBehalfOfUserId: f.userId };
      const resolvedBinding = await resolveDelegatedContextManifestBindings(db, { homeCompanyId: f.home,
        homeAgentId: f.presence.id, homeRunId: run!.id, responsibleUserId: f.userId, actor,
        manifestIds: [guestContext!.contextManifestId] });
      expect(resolvedBinding).toHaveLength(1);
      expect(resolvedBinding[0]).toMatchObject({ guestCompanyId: f.guest, contextManifestId: guestContext!.contextManifestId,
        guestAgentId: f.guestPresence.id, scopeRequestId: request.id, accessMode, purpose: query });
      expect(resolvedBinding[0]!.bindingHash).toMatch(/^[0-9a-f]{64}$/);
      if (accessMode === "read") expect(resolvedBinding[0]!.items.length).toBeGreaterThan(0);
      if (accessMode === "read") await expect(resolveDelegatedContextManifestBindings(db, { homeCompanyId: f.home,
        homeAgentId: f.presence.id, homeRunId: randomUUID(), responsibleUserId: f.userId, actor,
        manifestIds: [guestContext!.contextManifestId] })).rejects.toMatchObject({ status: 403 });
      const command = { action: "task.forecast" as const, companyId: f.guest, projectId: project.id, taskId: task.id, forecast: { expectedUpdatedAt: task.updatedAt.toISOString(), forecastStartAt: null, forecastEndAt: "2026-10-12T00:00:00Z", forecastConfidence: 0.5, forecastReason: "Current evidence supports a guest delivery estimate" } };
      if (accessMode !== "act") await expect(actions.execute(actor, f.home, run!.id, command)).rejects.toMatchObject({ status: 403 });
      else {
        await expect(actions.execute(actor, f.home, run!.id, command)).resolves.toMatchObject({ sourceCompanyId: f.guest, resultOwnerCompanyId: f.home, classification: "internal" });
        const [updated] = await db.select().from(issues).where(eq(issues.id, task!.id));
        expect(updated!.forecastEndAt?.toISOString()).toBe("2026-10-12T00:00:00.000Z"); expect(updated!.plannedEndAt).toBeNull();
        await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.guest), eq(companyMemberships.principalId, f.userId)));
        await expect(actions.execute(actor, f.home, run!.id, { ...command, forecast: { ...command.forecast, expectedUpdatedAt: updated!.updatedAt.toISOString() } })).rejects.toMatchObject({ status: 403 });
        await expect(fabric.prepare({ companyId: f.home, agentId: f.presence.id, runId: run!.id,
          responsibleUserId: f.userId, issueId: null, query, scopeRequestId: request.id })).rejects.toMatchObject({ status: 403 });
        await expect(resolveDelegatedContextManifestBindings(db, { homeCompanyId: f.home,
          homeAgentId: f.presence.id, homeRunId: run!.id, responsibleUserId: f.userId, actor,
          manifestIds: [guestContext!.contextManifestId] })).rejects.toMatchObject({ status: 403 });
      }
      if (accessMode === "contribute") {
        // Scope-request erasure cascades the guest-local retained copy rather
        // than leaving a detached manifest with stale runtime provenance.
        await db.delete(agentExecutionScopeRequests).where(eq(agentExecutionScopeRequests.id, request.id));
        expect(await db.select().from(contextManifests).where(and(eq(contextManifests.companyId, f.guest),
          eq(contextManifests.id, guestContext!.contextManifestId)))).toEqual([]);
      }
    }
    expect(firstDelegated).not.toBeNull();
    // Removing the accountability link cannot leave a detached guest copy.
    await db.delete(delegatedContextManifestBindings).where(eq(delegatedContextManifestBindings.contextManifestId,
      firstDelegated!.contextManifestId));
    expect(await db.select().from(contextManifests).where(and(eq(contextManifests.companyId, f.guest),
      eq(contextManifests.id, firstDelegated!.contextManifestId)))).toEqual([]);
    expect(await db.select().from(delegatedContextManifestBindings).where(eq(delegatedContextManifestBindings.contextManifestId,
      firstDelegated!.contextManifestId))).toEqual([]);
    expect(lastDelegated).not.toBeNull();
    // Home-company erasure remains blocked while its identity is still shared
    // with the active guest presence; this guard must run before any content
    // purge or delegated-reference cleanup.
    await expect(purgeCompanyContent(db, f.home)).rejects.toThrow(/Archive or rehome shared identities/);
    expect(await db.select().from(contextManifests).where(and(eq(contextManifests.companyId, f.guest),
      eq(contextManifests.id, lastDelegated!.contextManifestId)))).toHaveLength(1);
    // Purging the delegated guest company must remove retained local Context
    // before its local presence and manifest parents disappear.
    await purgeCompanyContent(db, f.guest);
    expect(await db.select().from(contextManifests).where(and(eq(contextManifests.companyId, f.guest),
      eq(contextManifests.id, lastDelegated!.contextManifestId)))).toEqual([]);
    expect(await db.select().from(delegatedContextManifestBindings).where(eq(delegatedContextManifestBindings.contextManifestId,
      lastDelegated!.contextManifestId))).toEqual([]);
  });
  it("pins immutable provenance, rechecks resumed runs and rejects revoked human membership", async () => {
    const f = await seedV5Presences(db), providers = agentProviderBindingService(db), svc = agentRuntimeFabricService(db);
    const binding = await providers.create(f.actor, f.home, f.presence.id, { providerType: "paperclip_native", providerAgentRef: f.presence.id, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
    await providers.attach(f.actor, f.home, f.presence.id, { providerBindingId: binding.id, providerProfileRef: f.presence.id });
    // This is an internal fixture contract, not proof of an external provider.
    await providers.recordDiscovery(f.home, f.presence.id, { provider: "paperclip_native", version: "test-only", features: Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map((key) => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>, skills: [], tools: [], discoveredAt: new Date().toISOString() }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId, status: "running" }).returning();
    const input = { companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: null, query: "Review the approved company context" };
    const first = await svc.prepare(input); expect(first?.manifest.agentIdentityId).toBe(f.identity.id);
    expect(first?.inputRolePackSources).toEqual([]);
    expect(first?.manifest.executionScope.delegatedScopes).toEqual([]);
    expect(first?.inputContextManifests).toEqual(first?.manifest.contextManifests);
    const resumed = await svc.prepare(input); expect(resumed?.record.id).toBe(first?.record.id);
    expect(resumed?.inputRolePackSources).toBeNull();
    expect(resumed?.manifest.contextManifests).toEqual(first?.manifest.contextManifests);
    expect(resumed?.inputContextManifests).toHaveLength(1);
    expect(resumed?.inputContextManifests).not.toEqual(first?.inputContextManifests);
    const [actualContext] = await db.select().from(contextManifests).where(eq(contextManifests.id, resumed!.inputContextManifests[0]!.contextManifestId));
    expect(actualContext).toMatchObject({ companyId: f.home, runId: run!.id, agentId: f.presence.id });
    await expect(db.update(agentExecutionManifests).set({ hash: "rewrite" }).where(eq(agentExecutionManifests.id, first!.record.id))).rejects.toThrow();
    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
    await expect(svc.prepare(input)).rejects.toMatchObject({ status: 403 });
  });
  it("routes guest connected tools through current local authority and denies writes/revoked result disclosure", async () => {
    const f = await seedV5Presences(db), providers = agentProviderBindingService(db), fabric = agentRuntimeFabricService(db), cross = crossCompanyContextService(db);
    for (const [companyId, agentId] of [[f.home, f.presence.id], [f.guest, f.guestPresence.id]] as const) {
      const binding = await providers.create(f.actor, companyId, agentId, { providerType: "paperclip_native", providerAgentRef: agentId, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
      await providers.attach(f.actor, companyId, agentId, { providerBindingId: binding.id, providerProfileRef: agentId });
      await providers.recordDiscovery(companyId, agentId, { provider: "paperclip_native", version: "internal-fixture", features: Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map(key => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>, skills: [], tools: [], discoveredAt: new Date().toISOString() }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
    }
    await cross.setPolicy(f.actor, f.guest, crossCompanyPolicySchema.parse({ allowRead: true, allowContribute: true, allowAct: true, allowedSensitivities: ["internal", "confidential"] }));
    await db.insert(companyMemberships).values({ companyId: f.guest, principalType: "agent", principalId: f.guestPresence.id, status: "active", membershipRole: "member" });
    await db.insert(principalPermissionGrants).values({ companyId: f.guest, principalType: "agent", principalId: f.guestPresence.id, permissionKey: "tools:use" });
    const [application] = await db.insert(toolApplications).values({ companyId: f.guest, applicationKey: randomUUID(), name: "Guest protocol fixture", type: "mcp_http", status: "active" }).returning();
    const [connection] = await db.insert(toolConnections).values({ companyId: f.guest, applicationId: application!.id, name: "Guest fixture", uid: `fixture/${randomUUID()}`, transport: "mcp_remote", status: "active", enabled: true, healthStatus: "ok", config: { url: "https://guest.example.test/mcp" }, transportConfig: { url: "https://guest.example.test/mcp" }, credentialRefs: [], credentialSecretRefs: [] }).returning();
    await db.insert(connectionGrants).values({ companyId: f.guest, connectionId: connection!.id, kind: "organization", status: "active", isDefault: true, credentialSecretRefs: [] });
    const [profile] = await db.insert(toolProfiles).values({ companyId: f.guest, profileKey: randomUUID(), name: "Guest fixture allowlist", defaultAction: "allow" }).returning();
    await db.insert(toolProfileBindings).values({ companyId: f.guest, profileId: profile!.id, targetType: "agent", targetId: f.guestPresence.id });
    const catalog = await db.insert(toolCatalogEntries).values((["read", "write"] as const).map(risk => ({ companyId: f.guest, applicationId: application!.id, connectionId: connection!.id, entryKind: "tool", name: `guest_${risk}`, toolName: `guest_${risk}`, title: `Guest ${risk}`, description: "Synthetic fixture only", inputSchema: { type: "object", additionalProperties: false }, annotations: { readOnlyHint: risk === "read" }, riskLevel: risk, isReadOnly: risk === "read", isWrite: risk === "write", isDestructive: false, status: "active", versionHash: randomUUID() }))).returning();
    let revokeDuringResponse = false;
    const remote = vi.fn(async (url, init) => {
      expect(String(url)).toBe("https://guest.example.test/mcp");
      if (revokeDuringResponse) await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.guest), eq(companyMemberships.principalId, f.userId)));
      const request = JSON.parse(String(init.body));
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "synthetic guest response" }] } });
    });
    const gateway = createToolGatewayService(db, { remoteHttpRequest: remote, toolActionSigningSecret: "synthetic-fixture-signing-key-only" }), actions = scopedRuntimeActionService(db, gateway);
    async function primary(accessMode: "read" | "act") {
      const query = "Use explicitly delegated guest tools";
      const request = await fabric.requestScope(f.actor, f.home, f.presence.id, { executionScope: { primaryCompanyId: f.home, primaryAgentPresenceId: f.presence.id, delegatedScopes: [{ companyId: f.guest, agentPresenceId: f.guestPresence.id, accessMode, purpose: query }] }, query, issueId: null });
      const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId, status: "running" }).returning();
      await fabric.prepare({ companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: null, query, scopeRequestId: request.id });
      return { run: run!, actor: { type: "agent" as const, source: "agent_jwt" as const, companyId: f.home, agentId: f.presence.id, runId: run!.id, onBehalfOfUserId: f.userId } };
    }
    const reader = await primary("read");
    const list = await actions.execute(reader.actor, f.home, reader.run.id, { action: "tool.list", companyId: f.guest }) as { result: { name: string; risk: string }[] };
    expect(list.result).toHaveLength(1); expect(list.result[0]!.risk).toBe("read");
    const readName = list.result[0]!.name;
    await expect(actions.execute(reader.actor, f.home, reader.run.id, { action: "tool.invoke", companyId: f.guest, tool: readName, parameters: {} })).resolves.toMatchObject({ sourceCompanyId: f.guest, resultOwnerCompanyId: f.home, classification: "confidential", crossCompanyUsePolicy: "allow" });
    const [invocation] = await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, f.guest));
    expect(invocation).toMatchObject({ companyId: f.guest, agentId: f.guestPresence.id, runId: null });
    await expect(actions.execute(reader.actor, f.home, reader.run.id, { action: "tool.invoke", companyId: f.guest, tool: "search_tools", parameters: {} })).rejects.toMatchObject({ status: 404 });
    const writer = await primary("act"), available = await actions.execute(writer.actor, f.home, writer.run.id, { action: "tool.list", companyId: f.guest }) as typeof list;
    const writeName = available.result.find(tool => tool.risk === "write")!.name;
    await expect(actions.execute(reader.actor, f.home, reader.run.id, { action: "tool.invoke", companyId: f.guest, tool: writeName, parameters: {}, idempotencyKey: "read-scope-write" })).rejects.toMatchObject({ status: 403 });
    await expect(actions.execute(writer.actor, f.home, writer.run.id, { action: "tool.invoke", companyId: f.guest, tool: writeName, parameters: {} })).rejects.toMatchObject({ status: 422 });
    expect(remote).toHaveBeenCalledTimes(1);
    const command = { action: "tool.invoke" as const, companyId: f.guest, tool: writeName, parameters: {}, idempotencyKey: "guest-write-once" };
    const written = await actions.execute(writer.actor, f.home, writer.run.id, command) as { result: { result: unknown } };
    const replayed = await actions.execute(writer.actor, f.home, writer.run.id, command) as typeof written;
    expect(replayed.result.result).toEqual(written.result.result);
    expect(remote).toHaveBeenCalledTimes(2);
    revokeDuringResponse = true;
    await expect(actions.execute(writer.actor, f.home, writer.run.id, { action: "tool.invoke", companyId: f.guest, tool: readName, parameters: {} })).rejects.toMatchObject({ status: 403 });
    await db.insert(companyMemberships).values({ companyId: f.guest, principalType: "user", principalId: f.userId, status: "active", membershipRole: "owner" });
    revokeDuringResponse = false;
    // A failed result disclosure cannot be replayed as a completed operation.
    const failedCommand = { action: "tool.invoke" as const, companyId: f.guest, tool: readName, parameters: {}, idempotencyKey: "failed-disclosure" };
    revokeDuringResponse = true;
    await expect(actions.execute(writer.actor, f.home, writer.run.id, failedCommand)).rejects.toMatchObject({ status: 403 });
    await db.insert(companyMemberships).values({ companyId: f.guest, principalType: "user", principalId: f.userId, status: "active", membershipRole: "owner" });
    revokeDuringResponse = false;
    await expect(actions.execute(writer.actor, f.home, writer.run.id, failedCommand)).rejects.toMatchObject({ status: 409 });
    expect(remote).toHaveBeenCalledTimes(4); expect(catalog).toHaveLength(2);
  });

});
