import { randomUUID } from "node:crypto";
import { prepareConnectionIntentRailwayFixture } from "./helpers/connection-intent-railway-fixture.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, notInArray } from "drizzle-orm";
import { agents, companies, companyMemberships, agentExecutionManifests, agentExecutionScopeRequests, delegatedContextManifestBindings, heartbeatRuns, instanceSettings, issues, projects, toolApplications, toolConnections, connectionGrants, contextManifests, contextManifestItems, toolCatalogEntries, toolProfiles, toolProfileBindings, toolProfileEntries, toolPolicies, toolCallEvents, toolInvocations, principalPermissionGrants, createDb } from "@paperclipai/db";
import { PROVIDER_CAPABILITY_FEATURES, rolePackVersionInputSchema } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase, getEmbeddedPostgresTestSupport } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { prepareGenuineNativeDraftConformanceFixture } from "./helpers/prepare-genuine-native-draft-conformance-fixture.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { skillTaskMatches } from "../services/skill-resolver.js";
import { crossCompanyContextService } from "../services/cross-company-context.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { toolAccessService } from "../services/tool-access.js";
import { scopedRuntimeActionService } from "../services/scoped-runtime-actions.js";
import { authorizationService } from "../services/authorization.js";
import { resolveDelegatedContextManifestBindings } from "../services/context/delegated-context-binding.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
import { issueService } from "../services/issues.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import { foundationIndexService } from "../services/foundation/foundation-index.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { playbookService } from "../services/playbooks.js";
import { rolePackService } from "../services/role-packs.js";
import { createCanonicalHumanProject, seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
import { crossCompanyPolicySchema } from "@paperclipai/shared";

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
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v5-runtime-"); db = createDb(database.connectionString, { maxConnections: 3 }); await enableV5ForTest(db); const [settings] = await db.select().from(instanceSettings); await db.update(instanceSettings).set({ experimental: { ...settings!.experimental, role_packs_v5: false, skill_resolver_v5: false } }).where(eq(instanceSettings.singletonKey, "default")); });
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
      if (accessMode === "read") {
        expect(resolvedBinding[0]!.items.length).toBeGreaterThan(0);
        expect(resolvedBinding[0]!.items).toEqual(expect.arrayContaining([
          expect.objectContaining({ sourceProvider: "august_works_foundation", sourceVersion: foundation.latestRevisionId }),
        ]));
      }
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
    await expect(purgeCompanyContent(db, f.home)).rejects.toThrow();
    const [homeAfterBlockedPurge] = await db.select({ status: companies.status }).from(companies).where(eq(companies.id, f.home));
    expect(homeAfterBlockedPurge?.status).toBe("active");
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
  it("preserves current-Human guest read and contribution within bounded plans while keeping guest act blocked", async () => {
    const f = await seedV5Presences(db), providers = agentProviderBindingService(db), fabric = agentRuntimeFabricService(db), cross = crossCompanyContextService(db), actions = scopedRuntimeActionService(db);
    const currentHuman = await seedCurrentHumanSourceActor(db, [f.home, f.guest], f.userId);
    const features = Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map((key) => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>;
    for (const [companyId, agentId] of [[f.home, f.presence.id], [f.guest, f.guestPresence.id]] as const) {
      const binding = await providers.create(f.actor, companyId, agentId, { providerType: "paperclip_native", providerAgentRef: agentId, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
      await providers.attach(f.actor, companyId, agentId, { providerBindingId: binding.id, providerProfileRef: agentId });
      await providers.recordDiscovery(companyId, agentId, { provider: "paperclip_native", version: "bounded-cross-company-fixture", features, skills: [], tools: [], discoveredAt: new Date().toISOString() }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
    }
    const [settings] = await db.select().from(instanceSettings).where(eq(instanceSettings.singletonKey, "default"));
    try {
      await db.update(instanceSettings).set({ experimental: { ...settings!.experimental, enableWorkflowsV1: true, readiness_engine_v7: true, orchestration_v7: true } }).where(eq(instanceSettings.singletonKey, "default"));
      await cross.setPolicy(f.actor, f.guest, crossCompanyPolicySchema.parse({ allowRead: true, allowContribute: true, allowAct: true }));
      const foundationActor = { principal: { type: "user" as const, userId: f.userId } };
      const boundedQuery = "Guest task forecast the explicitly delegated guest delivery";
      const foundation = await foundationService(db).createDraft(f.guest, { foundationKey: "bounded_guest_guidance",
        title: "Bounded guest guidance", body: boundedQuery,
        category: "company", documentType: "profile", sensitivity: "internal", reviewFrequencyDays: 30 }, foundationActor);
      await foundationService(db).submitForReview(f.guest, foundation.id, foundation.latestRevisionId!, foundationActor);
      await foundationService(db).approve(f.guest, foundation.id, foundation.latestRevisionId!, foundationActor);
      await foundationIndexService(db).reindexRevision(f.guest, foundation.id, foundation.latestRevisionId!);
      expect(await foundationIndexService(db).search(f.guest, { query: boundedQuery, limit: 12, scope: "approved" }, currentHuman, "task")).toHaveLength(1);
      // Multi-company presence creation is separate from local runtime
      // membership. The guest Agent needs an explicit, current local member
      // row before its already Human-granted contribution permission applies.
      await db.insert(companyMemberships).values({ companyId: f.guest, principalType: "agent", principalId: f.guestPresence.id,
        status: "active", membershipRole: "member" }).onConflictDoNothing();
      await db.insert(principalPermissionGrants).values(["foundation:read", "foundation:propose"].map(permissionKey => ({
        companyId: f.guest, principalType: "agent", principalId: f.guestPresence.id,
        permissionKey, scope: null, grantedByUserId: f.userId,
      })));
      const book = await playbookService(db).create(f.actor, f.guest, { key: "bounded_guest_contribution", title: "Bounded guest contribution",
        category: "general", markdown: "# Guest procedure\n\nA current Human reviews proposed changes.", sensitivity: "internal",
        ownerUserId: f.userId, ownerAgentId: null, reviewFrequencyDays: 90 });

      const startPlan = async (task: typeof issues.$inferSelect) => {
        const plan = await orchestrationService(db).create(f.actor, f.home, { issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(),
          riskClass: "C0", workload: "semantic", completionContract: { objective: "Use only authorized company sources for this bounded worker", requiredOutputs: [{ key: "result" }], businessInvariants: ["Preserve current company and Human authority"] }, budgets: {}, workers: [{ key: "worker", issueId: task.id }] });
        await orchestrationService(db).decide(f.actor, f.home, plan.id, { expectedVersion: plan.version, action: "start", rationale: "Start this bounded cross-company authorization fixture" });
      };
      const executeMode = async (accessMode: "read" | "contribute" | "act", bounded = true) => {
        const query = boundedQuery;
        const [task] = await db.insert(issues).values({ companyId: f.home, title: `Bounded ${accessMode} scope`, status: "todo", assigneeAgentId: f.presence.id }).returning();
        if (bounded) await startPlan(task!);
        const request = await fabric.requestScope(currentHuman, f.home, f.presence.id, { executionScope: { primaryCompanyId: f.home, primaryAgentPresenceId: f.presence.id,
          delegatedScopes: [{ companyId: f.guest, agentPresenceId: f.guestPresence.id, accessMode, purpose: query }] }, query, issueId: task!.id });
        const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
          status: "running", issueId: task!.id, contextSnapshot: { issueId: task!.id } }).returning();
        const runActor = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.home, agentId: f.presence.id, runId: run!.id, onBehalfOfUserId: f.userId };
        const prepare = () => fabric.prepare({ companyId: f.home, agentId: f.presence.id, runId: run!.id,
          responsibleUserId: f.userId, issueId: task!.id, query, scopeRequestId: request.id });
        return { prepare, runActor, runId: run!.id, task: task! };
      };

      const read = await executeMode("read"), readPrepared = await read.prepare();
      expect(readPrepared!.manifest.executionScope.delegatedScopes[0]).toMatchObject({ companyId: f.guest, accessMode: "read" });
      const readGuestRef = readPrepared!.inputContextManifests.find(ref => ref.companyId === f.guest)!;
      const readItems = await db.select().from(contextManifestItems).where(and(eq(contextManifestItems.companyId, f.guest), eq(contextManifestItems.manifestId, readGuestRef.contextManifestId)));
      expect(readItems.some(item => item.sourceProvider === "august_works_foundation" && item.sourceVersion === foundation.latestRevisionId)).toBe(true);
      expect(readItems.every(item => item.sourceClass !== "private_memory" && item.sensitivity !== "restricted")).toBe(true);

      const contribute = await executeMode("contribute"), contributePrepared = await contribute.prepare();
      expect(contributePrepared!.manifest.executionScope.delegatedScopes[0]).toMatchObject({ companyId: f.guest, accessMode: "contribute" });
      const proposed = await actions.execute(contribute.runActor, f.home, contribute.runId, { action: "playbook.propose", companyId: f.guest, playbookId: book.id,
        proposal: { baseApprovedRevisionId: null, title: "Proposed bounded clarification", markdown: "# Guest procedure\n\nClarify the checked handoff.",
          reason: "The bounded worker identified a specific documented clarification for Human review.", sourceSkillId: null, sourceSkillVersionId: null } });
      expect(proposed).toMatchObject({ sourceCompanyId: f.guest, resultOwnerCompanyId: f.home, classification: "internal", result: { status: "pending", createdByAgentId: f.guestPresence.id } });

      const act = await executeMode("act");
      await expect(act.prepare()).rejects.toMatchObject({ status: 403 });
      const previouslyPreparedAct = await executeMode("act", false);
      await previouslyPreparedAct.prepare();
      await startPlan(previouslyPreparedAct.task);
      await expect(actions.execute(previouslyPreparedAct.runActor, f.home, previouslyPreparedAct.runId, { action: "playbook.propose", companyId: f.guest, playbookId: book.id,
        proposal: { baseApprovedRevisionId: null, title: "Forbidden bounded change", markdown: "# Guest procedure\n\nShould not persist.",
          reason: "An act-scoped bounded proposal is denied even with current guest policy.", sourceSkillId: null, sourceSkillVersionId: null } })).rejects.toMatchObject({ status: 403 });
    } finally {
      await db.update(instanceSettings).set({ experimental: settings!.experimental }).where(eq(instanceSettings.singletonKey, "default"));
    }
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
    await seedCurrentHumanSourceActor(db, [f.home, f.guest], f.userId);
    await db.insert(companyMemberships).values({ companyId: f.guest, principalType: "agent", principalId: f.guestPresence.id, status: "active", membershipRole: "member" });
    await db.insert(principalPermissionGrants).values({ companyId: f.guest, principalType: "agent", principalId: f.guestPresence.id, permissionKey: "tools:use" });
    const railway = await prepareConnectionIntentRailwayFixture({ db, companyId: f.guest,
      userId: f.userId, holderAgentId: f.guestPresence.id });
    const access = toolAccessService(db);
    const [appProfile] = await db.select({ id: toolProfiles.id }).from(toolProfiles).where(and(
      eq(toolProfiles.companyId, f.guest), eq(toolProfiles.profileKey, `app:${railway.connection.id}`)));
    expect(appProfile).toBeDefined();
    await access.updateProfile(appProfile!.id, { status: "inactive" });
    const catalog = await db.select().from(toolCatalogEntries).where(eq(toolCatalogEntries.connectionId, railway.connection.id));
    const [readEntry, writeEntry] = [
      catalog.find(entry => entry.toolName === "paperclip-railway-list-projects"),
      catalog.find(entry => entry.toolName === "paperclip-railway-restart"),
    ];
    expect(readEntry).toBeDefined(); expect(writeEntry).toBeDefined();
    // `tools:use` explicitly grants all active catalog entries. Keep the
    // fixture universe itself to the original read/write pair.
    await db.update(toolCatalogEntries).set({ status: "disabled" }).where(eq(toolCatalogEntries.connectionId, railway.connection.id));
    await db.update(toolCatalogEntries).set({ status: "active" }).where(and(
      eq(toolCatalogEntries.id, readEntry!.id), eq(toolCatalogEntries.connectionId, railway.connection.id)));
    await db.update(toolCatalogEntries).set({ status: "active" }).where(and(
      eq(toolCatalogEntries.id, writeEntry!.id), eq(toolCatalogEntries.connectionId, railway.connection.id)));
    const [profile] = await db.insert(toolProfiles).values({ companyId: f.guest, profileKey: randomUUID(), name: "Guest two-tool fixture allowlist", defaultAction: "deny" }).returning();
    await db.insert(toolProfileBindings).values({ companyId: f.guest, profileId: profile!.id, targetType: "agent", targetId: f.guestPresence.id });
    await db.insert(toolProfileEntries).values([readEntry!, writeEntry!].map(entry => ({ companyId: f.guest,
      profileId: profile!.id, selectorType: "catalog_entry" as const, catalogEntryId: entry.id, effect: "include" as const })));
    let revokeDuringResponse = false;
    const remote = vi.fn(async (url: string, init: RequestInit) => {
      const response = await railway.request(url, init);
      if (revokeDuringResponse) await db.delete(companyMemberships).where(and(
        eq(companyMemberships.companyId, f.guest), eq(companyMemberships.principalId, f.userId)));
      return response;
    });
    const gateway = createToolGatewayService(db, { remoteHttpRequest: remote, toolActionSigningSecret: "synthetic-fixture-signing-key-only" }), actions = scopedRuntimeActionService(db, gateway);
    async function primary(accessMode: "read" | "act") {
      const query = "Use explicitly delegated guest tools";
      const [task] = await db.insert(issues).values({ companyId: f.home, title: "Home task for guest tool scope", status: "todo", assigneeAgentId: f.presence.id, responsibleUserId: f.userId }).returning();
      const request = await fabric.requestScope(f.actor, f.home, f.presence.id, { executionScope: { primaryCompanyId: f.home, primaryAgentPresenceId: f.presence.id, delegatedScopes: [{ companyId: f.guest, agentPresenceId: f.guestPresence.id, accessMode, purpose: query }] }, query, issueId: task!.id });
      const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
        status: "running", issueId: task!.id, nativeIssueId: task!.id, contextSnapshot: { issueId: task!.id } }).returning();
      await db.update(issues).set({ executionRunId: run!.id }).where(eq(issues.id, task!.id));
      await fabric.prepare({ companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: task!.id, query, scopeRequestId: request.id });
      return { run: run!, task: task!, actor: { type: "agent" as const, source: "agent_jwt" as const, companyId: f.home, agentId: f.presence.id, runId: run!.id, onBehalfOfUserId: f.userId } };
    }
    const reader = await primary("read");
    const list = await actions.execute(reader.actor, f.home, reader.run.id, { action: "tool.list", companyId: f.guest }) as { result: { name: string; risk: string }[] };
    expect(list.result).toHaveLength(1); expect(list.result[0]!.risk).toBe("read");
    const readName = list.result[0]!.name;
    const fixedCallCount = () => railway.captures().filter(capture => ["target_validation", "deployment_validation", "restart", "projects_call"].includes(capture.purpose)).length;
    const beforeRead = fixedCallCount();
    await expect(actions.execute(reader.actor, f.home, reader.run.id, { action: "tool.invoke", companyId: f.guest, tool: readName, parameters: { workspaceId: railway.workspaceId } })).resolves.toMatchObject({ sourceCompanyId: f.guest, resultOwnerCompanyId: f.home, classification: "confidential", crossCompanyUsePolicy: "allow" });
    expect(fixedCallCount()).toBe(beforeRead + 1);
    const [invocation] = await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, f.guest));
    expect(invocation).toMatchObject({ companyId: f.guest, agentId: f.guestPresence.id, runId: null, issueId: null });
    await expect(actions.execute(reader.actor, f.home, reader.run.id, { action: "tool.invoke", companyId: f.guest, tool: "search_tools", parameters: {} })).rejects.toMatchObject({ status: 404 });
    const writer = await primary("act"), available = await actions.execute(writer.actor, f.home, writer.run.id, { action: "tool.list", companyId: f.guest }) as typeof list;
    expect(available.result).toHaveLength(2);
    expect(writeEntry!.riskLevel).toBe("destructive");
    const writeName = available.result.find(tool => tool.risk === "destructive")!.name;
    const target = railway.deploymentTarget;
    const beforeDenied = fixedCallCount();
    await expect(actions.execute(reader.actor, f.home, reader.run.id, { action: "tool.invoke", companyId: f.guest, tool: writeName, parameters: target, idempotencyKey: "read-scope-write" })).rejects.toMatchObject({ status: 403 });
    await expect(actions.execute(writer.actor, f.home, writer.run.id, { action: "tool.invoke", companyId: f.guest, tool: writeName, parameters: {} })).rejects.toMatchObject({ status: 422 });
    expect(fixedCallCount()).toBe(beforeDenied);
    await db.insert(toolPolicies).values({ companyId: f.guest, name: "Current guest catalog block", policyType: "block", priority: 1,
      selectors: { catalogEntryId: writeEntry!.id } });
    await expect(actions.execute(writer.actor, f.home, writer.run.id, { action: "tool.invoke", companyId: f.guest, tool: writeName,
      parameters: target, idempotencyKey: "current-guest-block" })).rejects.toMatchObject({ status: 403 });
    expect(fixedCallCount()).toBe(beforeDenied);
    expect(remote).toHaveBeenCalledTimes(beforeDenied);
    await db.delete(toolPolicies).where(eq(toolPolicies.companyId, f.guest));
    const command = { action: "tool.invoke" as const, companyId: f.guest, tool: writeName, parameters: target, idempotencyKey: "guest-write-once" };
    const written = await actions.execute(writer.actor, f.home, writer.run.id, command) as { result: { result: unknown } };
    expect(railway.captures().slice(-3).map(capture => capture.purpose)).toEqual(["target_validation", "deployment_validation", "restart"]);
    const replayed = await actions.execute(writer.actor, f.home, writer.run.id, command) as typeof written;
    expect(replayed.result.result).toEqual(written.result.result);
    const afterReplay = fixedCallCount();
    expect(afterReplay).toBe(beforeDenied + 3);
    expect(remote).toHaveBeenCalledTimes(afterReplay);
    revokeDuringResponse = true;
    await expect(actions.execute(writer.actor, f.home, writer.run.id, { action: "tool.invoke", companyId: f.guest, tool: readName, parameters: { workspaceId: railway.workspaceId } })).rejects.toMatchObject({ status: 403 });
    await db.insert(companyMemberships).values({ companyId: f.guest, principalType: "user", principalId: f.userId, status: "active", membershipRole: "owner" });
    revokeDuringResponse = false;
    // A failed result disclosure cannot be replayed as a completed operation.
    const failedCommand = { action: "tool.invoke" as const, companyId: f.guest, tool: readName, parameters: { workspaceId: railway.workspaceId }, idempotencyKey: "failed-disclosure" };
    revokeDuringResponse = true;
    await expect(actions.execute(writer.actor, f.home, writer.run.id, failedCommand)).rejects.toMatchObject({ status: 403 });
    await db.insert(companyMemberships).values({ companyId: f.guest, principalType: "user", principalId: f.userId, status: "active", membershipRole: "owner" });
    revokeDuringResponse = false;
    await db.update(toolCatalogEntries).set({ versionHash: randomUUID() }).where(eq(toolCatalogEntries.id, readEntry!.id));
    await expect(actions.execute(writer.actor, f.home, writer.run.id, { action: "tool.invoke", companyId: f.guest,
      tool: readName, parameters: {}, idempotencyKey: "guest-catalog-drift" })).rejects.toMatchObject({
      status: 409, message: "Pinned tool catalog changed; reconcile and start a newly admitted execution",
    });
    expect(fixedCallCount()).toBe(afterReplay + 2);
    await expect(actions.execute(writer.actor, f.home, writer.run.id, failedCommand)).rejects.toMatchObject({ status: 409 });
    expect(fixedCallCount()).toBe(afterReplay + 2);
    expect(remote).toHaveBeenCalledTimes(afterReplay + 2);
    expect(available.result).toHaveLength(2);
  });

  it("binds scoped discovery and invocation to the current Task policy context", async () => {
    const f = await seedV5Presences(db), providers = agentProviderBindingService(db), fabric = agentRuntimeFabricService(db);
    const binding = await providers.create(f.actor, f.home, f.presence.id, { providerType: "paperclip_native", providerAgentRef: f.presence.id, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
    await providers.attach(f.actor, f.home, f.presence.id, { providerBindingId: binding.id, providerProfileRef: f.presence.id });
    await providers.recordDiscovery(f.home, f.presence.id, { provider: "paperclip_native", version: "task-profile-fixture", features: Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map(key => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>, skills: [], tools: [], discoveredAt: new Date().toISOString() }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });

    const currentHuman = await seedCurrentHumanSourceActor(db, [f.home], f.userId);
    const project = await createCanonicalHumanProject(db, f.home, currentHuman, "Task profile fixture");
    const task = await issueService(db).create(f.home, { projectId: project.id, title: "Current task profile", status: "todo",
      assigneeAgentId: f.presence.id, createdByUserId: f.userId, responsibleUserId: f.userId }, db, undefined,
      { manualInputActor: currentHuman, privacyActor: currentHuman, sourceAccessActor: currentHuman });
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      status: "running", issueId: task.id, contextSnapshot: { issueId: task.id, projectId: project.id } }).returning();
    await db.update(issues).set({ executionRunId: run!.id }).where(eq(issues.id, task.id));
    const railway = await prepareConnectionIntentRailwayFixture({ db, companyId: f.home,
      userId: f.userId, holderAgentId: f.presence.id });
    const connection = railway.connection, allowed = railway.tool;
    // Exercise the Task profile alone; discovery also creates an additive app
    // profile, which this case deliberately disables through its owner.
    const [appProfile] = await db.select({ id: toolProfiles.id }).from(toolProfiles).where(and(
      eq(toolProfiles.companyId, f.home), eq(toolProfiles.profileKey, `app:${connection.id}`)));
    expect(appProfile).toBeDefined();
    await toolAccessService(db).updateProfile(appProfile!.id, { status: "inactive" });
    const [application] = await db.select().from(toolApplications).where(eq(toolApplications.id, connection.applicationId));
    const [denied] = await db.select().from(toolCatalogEntries).where(and(
      eq(toolCatalogEntries.companyId, f.home), eq(toolCatalogEntries.connectionId, connection.id),
      eq(toolCatalogEntries.toolName, "paperclip-railway-list-services")));
    expect(denied).toBeDefined();
    // Match the original two-tool fixture universe. An explicit tools:use
    // grant also permits unrelated active catalog entries, independently of profiles.
    await db.update(toolCatalogEntries).set({ status: "disabled" }).where(and(
      eq(toolCatalogEntries.companyId, f.home), eq(toolCatalogEntries.connectionId, connection.id),
      notInArray(toolCatalogEntries.id, [allowed.id, denied!.id])));
    const [profile] = await db.insert(toolProfiles).values({ companyId: f.home, profileKey: randomUUID(), name: "Issue-bound profile evidence", defaultAction: "deny" }).returning();
    await db.insert(toolProfileBindings).values({ companyId: f.home, profileId: profile!.id, targetType: "issue", targetId: task.id });
    await db.insert(toolProfileEntries).values({ companyId: f.home, profileId: profile!.id, selectorType: "catalog_entry", catalogEntryId: allowed!.id, effect: "include" });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, status: "active", membershipRole: "member" }).onConflictDoNothing();
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey: "tools:use" });
    expect(await db.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants).where(and(
      eq(principalPermissionGrants.companyId, f.home), eq(principalPermissionGrants.principalType, "agent"),
      eq(principalPermissionGrants.principalId, f.presence.id), eq(principalPermissionGrants.permissionKey, "tools:use"),
    ))).toHaveLength(1);
    const deniedName = `mcp.${application!.applicationKey}-${connection!.id.replace(/-/g, "").slice(0, 8)}:paperclip-railway-list-services`;
    const [block] = await db.insert(toolPolicies).values({ companyId: f.home, name: "Deny selected tool on current Task", policyType: "block", priority: 1,
      selectors: { issueId: task.id, catalogEntryId: denied!.id } }).returning();
    await fabric.prepare({ companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: task.id, query: task.title });

    const remote = vi.fn(railway.request);
    const gateway = createToolGatewayService(db, { remoteHttpRequest: remote, toolActionSigningSecret: "synthetic-task-profile-signing-key" });
    const actions = scopedRuntimeActionService(db, gateway);
    const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.home, agentId: f.presence.id, runId: run!.id, onBehalfOfUserId: f.userId };
    expect(await authorizationService(db).decide({ actor, action: "tools:use", resource: { type: "company", companyId: f.home }, enforceResponsibleUserIntersection: true }))
      .toMatchObject({ allowed: true, reason: "allow_explicit_grant" });
    const list = await actions.execute(actor, f.home, run!.id, { action: "tool.list", companyId: f.home }) as { result: { name: string; catalogEntryId: string }[] };
    expect(list.result.map(tool => tool.catalogEntryId)).toEqual([allowed!.id]);
    expect(remote).not.toHaveBeenCalled();
    await expect(actions.execute(actor, f.home, run!.id, { action: "tool.invoke", companyId: f.home, tool: list.result[0]!.name, parameters: { workspaceId: railway.workspaceId } }))
      .resolves.toMatchObject({ sourceCompanyId: f.home, classification: "confidential", result: expect.any(Object) });
    const [invocation] = await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, f.home));
    expect(invocation).toMatchObject({ agentId: f.presence.id, runId: run!.id, issueId: task.id });
    const [callEvent] = await db.select().from(toolCallEvents).where(and(eq(toolCallEvents.companyId, f.home), eq(toolCallEvents.issueId, task.id), eq(toolCallEvents.runId, run!.id),
      eq(toolCallEvents.catalogEntryId, allowed.id), eq(toolCallEvents.eventType, "policy_decision")));
    expect(callEvent?.metadata).toMatchObject({ effectiveProfileIds: [profile!.id] });
    expect(remote).toHaveBeenCalledTimes(1);

    await expect(actions.execute(actor, f.home, run!.id, { action: "tool.invoke", companyId: f.home, tool: deniedName, parameters: {} }))
      .rejects.toMatchObject({ status: 403 });
    expect(remote).toHaveBeenCalledTimes(1);
    const [deniedEvent] = await db.select().from(toolCallEvents).where(and(eq(toolCallEvents.companyId, f.home), eq(toolCallEvents.issueId, task.id), eq(toolCallEvents.runId, run!.id), eq(toolCallEvents.catalogEntryId, denied!.id),
      eq(toolCallEvents.eventType, "policy_decision")));
    expect(deniedEvent).toMatchObject({ matchedPolicyIds: [block!.id], outcome: "denied" });
    expect(block).toBeDefined();
    expect(denied).toBeDefined();
  });

  it("selects only Role Pack catalog UUIDs and rejects task-blocked or drifted tool pins", async () => {
    const f = await seedV5Presences(db), fabric = agentRuntimeFabricService(db);
    const [settings] = await db.select().from(instanceSettings).where(eq(instanceSettings.singletonKey, "default"));
    const originalFlags = settings!.experimental;
    await db.update(instanceSettings).set({ experimental: { ...originalFlags, role_packs_v5: true,
      skill_resolver_v5: true, enableNativeRunner: true, enableWorkflowsV1: true,
      readiness_engine_v7: true, orchestration_v7: true } })
      .where(eq(instanceSettings.singletonKey, "default"));
    try {
      await prepareGenuineNativeDraftConformanceFixture({ db, f, sourceSha: "a".repeat(40),
        model: "fixture-role-pack" });
      await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, status: "active", membershipRole: "member" }).onConflictDoNothing();
      await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey: "tools:use" }).onConflictDoNothing();

      const railway = await prepareConnectionIntentRailwayFixture({ db, companyId: f.home,
        userId: f.userId, holderAgentId: f.presence.id });
      const connection = railway.connection;
      const catalog = await db.select().from(toolCatalogEntries).where(eq(toolCatalogEntries.connectionId, connection.id));
      const allowed = catalog.find(entry => entry.toolName === "paperclip-railway-restart");
      const taskBlocked = catalog.find(entry => entry.toolName === "paperclip-railway-redeploy");
      const undisclosedButAllowed = catalog.find(entry => entry.toolName === "paperclip-railway-rollback");
      expect(allowed).toBeDefined(); expect(taskBlocked).toBeDefined(); expect(undisclosedButAllowed).toBeDefined();
      const discoveredLaterTemplate = catalog.find(entry => entry.toolName === "paperclip-railway-service-status");
      expect(discoveredLaterTemplate).toBeDefined();
      await db.delete(toolCatalogEntries).where(and(eq(toolCatalogEntries.companyId, f.home),
        eq(toolCatalogEntries.id, discoveredLaterTemplate!.id)));
      // Preserve the original three-entry candidate universe. The permission
      // grant authorizes active catalog rows, so disable unrelated canonical
      // descriptors through metadata before selecting the Role Pack pin.
      await db.update(toolCatalogEntries).set({ status: "disabled" }).where(eq(toolCatalogEntries.connectionId, connection.id));
      for (const entry of [allowed!, taskBlocked!, undisclosedButAllowed!])
        await db.update(toolCatalogEntries).set({ status: "active" }).where(eq(toolCatalogEntries.id, entry.id));

      const packs = rolePackService(db);
      const makePack = async (key: string, catalogEntryId: string) => {
        const pack = await packs.create(f.actor, f.home, { key, name: key, description: "PostgreSQL runtime selection fixture" });
        const version = await packs.createVersion(f.actor, f.home, pack.id, rolePackVersionInputSchema.parse({ items: [{ type: "capability_expectation", ref: `tool:${catalogEntryId}`, versionId: null }] }));
        await packs.publish(f.actor, f.home, pack.id, version.id, null);
        await packs.assign(f.actor, f.home, { scopeType: "agent", scopeId: f.presence.id, rolePackId: pack.id, versionPolicy: "pinned", pinnedVersionId: version.id });
      };
      const makeRun = async (title: string) => {
        const [task] = await db.insert(issues).values({ companyId: f.home, title, status: "todo", assigneeAgentId: f.presence.id, responsibleUserId: f.userId }).returning();
        const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
          status: "running", issueId: task!.id, contextSnapshot: { issueId: task!.id } }).returning();
        await db.update(issues).set({ executionRunId: run!.id }).where(eq(issues.id, task!.id));
        const [block] = await db.insert(toolPolicies).values({ companyId: f.home, name: `Block Role Pack task tool ${task!.id}`, policyType: "block", priority: 1,
          selectors: { issueId: task!.id, catalogEntryId: taskBlocked!.id } }).returning();
        return { task: task!, run: run!, block: block! };
      };

      await makePack("role-pack-selected-tool", allowed!.id);
      const selected = await makeRun("Review acme supplier account");
      const selectedInput = { companyId: f.home, agentId: f.presence.id, runId: selected.run.id, responsibleUserId: f.userId,
        issueId: selected.task.id, query: selected.task.title };
      const prepared = await fabric.prepare(selectedInput);
      expect(prepared!.manifest.capabilities.filter(capability => capability.type === "tool").map(capability => capability.ref))
        .toEqual([`tool:${allowed!.id}`]);
      expect(allowed!.versionHash).toMatch(/^[a-f0-9]{64}$/);
      expect(prepared!.manifest.capabilities.find(capability => capability.ref === `tool:${allowed!.id}`)?.versionHash).toBe(allowed!.versionHash);
      expect(selected.block).toBeDefined();
      // Introduce a genuine fixed-contract descriptor only after admission.
      // Opaque MCP tools have a separate model-effect denial before this check.
      const [discoveredAfterAdmission] = await db.insert(toolCatalogEntries).values({
        ...discoveredLaterTemplate!, id: randomUUID(), status: "active", createdAt: new Date(), updatedAt: new Date(),
      }).returning();
      const remote = vi.fn((url: string, init: RequestInit) => railway.request(url, init));
      const gateway = createToolGatewayService(db, { remoteHttpRequest: remote, toolActionSigningSecret: "role-pack-catalog-list-only" });
      const actions = scopedRuntimeActionService(db, gateway);
      const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.home, agentId: f.presence.id,
        runId: selected.run.id, onBehalfOfUserId: f.userId };
      const namePrefix = `mcp.railway-${connection.id.replace(/-/g, "").slice(0, 8)}:`;
      const taskBlockedName = `${namePrefix}paperclip-railway-redeploy`;
      await expect(actions.execute(actor, f.home, selected.run.id, { action: "tool.invoke", companyId: f.home,
        tool: taskBlockedName, parameters: railway.deploymentTarget, idempotencyKey: "invoke-task-blocked-tool" })).rejects.toMatchObject({ status: 403 });
      const [blockedInvocation] = await db.select().from(toolCallEvents).where(and(
        eq(toolCallEvents.companyId, f.home), eq(toolCallEvents.issueId, selected.task.id),
        eq(toolCallEvents.runId, selected.run.id), eq(toolCallEvents.catalogEntryId, taskBlocked!.id),
      ));
      expect(blockedInvocation).toMatchObject({ matchedPolicyIds: [selected.block.id], outcome: "denied" });
      const listed = await actions.execute(actor, f.home, selected.run.id, { action: "tool.list", companyId: f.home }) as { result: { catalogEntryId: string }[] };
      expect(listed.result.map(tool => tool.catalogEntryId)).toEqual([allowed!.id]);
      expect(listed.result.some(tool => tool.catalogEntryId === discoveredAfterAdmission!.id)).toBe(false);
      const newlyVisibleName = `${namePrefix}paperclip-railway-service-status`;
      await expect(actions.execute(actor, f.home, selected.run.id, { action: "tool.invoke", companyId: f.home,
        tool: newlyVisibleName, parameters: {}, idempotencyKey: "invoke-newly-visible-tool" }))
        .rejects.toMatchObject({ status: 403, message: "Connected tool is outside the pinned execution manifest" });
      const undisclosedName = `${namePrefix}paperclip-railway-rollback`;
      await expect(actions.execute(actor, f.home, selected.run.id, { action: "tool.invoke", companyId: f.home,
        tool: undisclosedName, parameters: railway.deploymentTarget, idempotencyKey: "invoke-not-disclosed" }))
        .rejects.toMatchObject({ status: 403, message: "Connected tool is outside the pinned execution manifest" });
      await expect(actions.execute(actor, f.home, selected.run.id, { action: "tool.invoke", companyId: f.home,
        tool: `${namePrefix}paperclip-railway-restart`,
        parameters: railway.deploymentTarget, idempotencyKey: "invoke-pinned-tool" })).resolves.toMatchObject({ result: expect.any(Object) });
      expect(railway.captures().slice(-3).map(capture => capture.purpose)).toEqual(["target_validation", "deployment_validation", "restart"]);
      expect(remote).toHaveBeenCalledTimes(3);
      expect(undisclosedButAllowed).toBeDefined();

      await makePack("role-pack-task-blocked-tool", taskBlocked!.id);
      const blocked = await makeRun("Review acme supplier account");
      await expect(fabric.prepare({ companyId: f.home, agentId: f.presence.id, runId: blocked.run.id, responsibleUserId: f.userId,
        issueId: blocked.task.id, query: blocked.task.title })).rejects.toMatchObject({ status: 409, message: `Required capability unavailable: tool:${taskBlocked!.id}` });
      expect(await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, blocked.run.id))).toEqual([]);

      await makePack("role-pack-selected-tool-again", allowed!.id);
      await db.update(toolCatalogEntries).set({ versionHash: "b".repeat(64) }).where(eq(toolCatalogEntries.id, allowed!.id));
      await expect(actions.execute(actor, f.home, selected.run.id, { action: "tool.invoke", companyId: f.home,
        tool: listed.result[0]!.name, parameters: {}, idempotencyKey: "invoke-drifted-tool" }))
        .rejects.toMatchObject({ status: 409, message: "Pinned tool catalog changed; reconcile and start a newly admitted execution" });
      expect(remote).toHaveBeenCalledTimes(3);
      await expect(fabric.prepare(selectedInput)).rejects.toMatchObject({ status: 403, message: "A pinned execution capability is no longer authorized/available" });
    } finally {
      await db.update(instanceSettings).set({ experimental: originalFlags }).where(eq(instanceSettings.singletonKey, "default"));
    }
  });

});
