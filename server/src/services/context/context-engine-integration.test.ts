import type { NativeRenderedSourceReference } from "../native-runtime/native-execution-input.js";
import { createHash, randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  workflows,
  workflowStepRuns,
  agents,
  authUsers,
  authSessions,
  companies,
  companyMemberships,
  contextManifestItems,
  contextManifests,
  completionContracts,
  createDb,
  documentRevisions,
  documents,
  foundationChangeProposals,
  foundationDocuments,
  foundationSections,
  companySecrets, companySecretBindings, connectionGrants, toolConnections,
  orchestrationModelReservations, orchestrationPlans, orchestrationToolCharges,
  supervisionSignals, supervisionInterventions, verificationRuns, agentExecutionManifests,
  heartbeatRuns,
  heartbeatRunEvents,
  externalObjectMentions,
  externalObjects,
  issues,
  issuePrivacySources,
  projects,
  instanceSettings,
  memoryBindings,
  memoryBindingTargets,
  memoryEvidence,
  memoryRecords,
  memoryJobs,
  principalPermissionGrants,
  toolPolicies,
  nativeRunFinalizations,
  nativeRunResults,
  agentRuntimeState,
  agentWakeupRequests,
  companySkills,
  companySkillVersions,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { memoryService } from "../memory/memory-service.js";
import { assertMemorySourcesRetained, canActorReadMemorySources, expireMemoryPayloads } from "../memory/memory-privacy.js";
import { issueService, lockIssuePrivacyTree, type NativeTaskSourceCapture } from "../issues.js";
import { workflowService } from "../workflows/workflow-service.js";
import { workflowExecutorService } from "../workflows/workflow-executor.js";
import { foundationService } from "../foundation/foundation-service.js";
import { instanceSettingsService } from "../instance-settings.js";
import { contextEngineService } from "./context-engine.js";
import { assertAnalyticalContextPayloadAccess } from "../analytical-context-authority.js";
import { revalidateNativeBootstrapContextWitness } from "./context-manifest.js";
import { captureNativeBootstrapContextWitness, readNativeBootstrapContextWitness } from "./native-bootstrap-context-witness.js";
import { seedCurrentHumanSourceActor } from "../../__tests__/helpers/current-human-source-fixture.js";
import { errorHandler } from "../../middleware/index.js";
import { issueRoutes } from "../../routes/issues.js";
import { buildPaperclipTaskMarkdown, getIssueExecutionContext } from "../heartbeat.js";
import { buildNativeBootstrapSourceSet } from "../native-runtime/native-execution-input.js";
import { assembleNativeContextRead, assertNativeContextReadSourceSetCurrent, assertNativeTaskSourceOwnerCurrent,
  assertNativeTemporalContextInputsCurrent } from "../native-direct-input.js";
import { createLocalAgentJwt, verifyLocalAgentJwt } from "../../agent-auth-jwt.js";
import type { AuthorizationActor } from "../authorization.js";
import { createToolGatewayService } from "../tool-gateway.js";
import { heartbeatService } from "../heartbeat.js";
import { nativeRunInputSourceReceiptSchema } from "@paperclipai/shared";
import { agentIdentityService } from "../agent-identities.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { aiConnectionService } from "../ai-connections.js";
import { discoverNativeCapabilities } from "../native-provider-conformance.js";
import { workerModelGateway } from "../orchestration/worker-model-gateway.js";
import { registerNativeDraftGateway } from "../orchestration/native-draft-runtime.js";
import { orchestrationService } from "../orchestration/orchestration-service.js";
import type { WorkerModelProfile } from "../orchestration/worker-model-profiles.js";
import type { guardedRemoteHttpFetch } from "../remote-http-fetch.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

describeEmbeddedPostgres("Context Engine integration", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const ownedContextSetupCompanies = new Set<string>();
  const ownedContextConnections: Array<{ companyId: string; connectionId: string; grantId: string;
    userId: string; secretIds: string[] }> = [];
  const ownedContextPlans: Array<{ companyId: string; planId: string }> = [];
  const activeNativeMemoryRunDrains: Array<{ release: () => void; drain: () => Promise<void> }> = [];

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-context-engine-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    const activeDrains = activeNativeMemoryRunDrains.splice(0);
    for (const active of activeDrains) active.release();
    for (const active of activeDrains) await active.drain();
    registerNativeDraftGateway(db, undefined);
    for (const owned of ownedContextConnections) {
      if (!ownedContextSetupCompanies.has(owned.companyId))
        throw new Error("Context credential cleanup lost its original setup company");
      await db.transaction(async tx => {
        const [grant] = await tx.select().from(connectionGrants).where(and(
          eq(connectionGrants.companyId, owned.companyId), eq(connectionGrants.id, owned.grantId),
          eq(connectionGrants.connectionId, owned.connectionId))).for("update");
        const refs = grant?.credentialSecretRefs;
        if (!refs || refs.length !== 1 || refs[0]!.configPath !== "ai.credential" || !refs[0]!.secretId ||
          owned.secretIds.length > 0 && (owned.secretIds.length !== 1 || owned.secretIds[0] !== refs[0]!.secretId))
          throw new Error("Context credential cleanup lacks its exact original grant reference");
        const secretId = refs[0]!.secretId;
        const [secret] = await tx.select({ id: companySecrets.id, name: companySecrets.name,
          scope: companySecrets.scope, createdByUserId: companySecrets.createdByUserId }).from(companySecrets).where(and(
          eq(companySecrets.companyId, owned.companyId), eq(companySecrets.id, secretId))).for("update");
        if (!secret || secret.name !== `ai-${owned.grantId}` || secret.scope !== "company" || secret.createdByUserId !== owned.userId)
          throw new Error("Context credential cleanup does not own the saved private slot");
        await tx.delete(toolConnections).where(and(eq(toolConnections.companyId, owned.companyId), eq(toolConnections.id, owned.connectionId)));
        await tx.delete(companySecretBindings).where(and(eq(companySecretBindings.companyId, owned.companyId),
          eq(companySecretBindings.secretId, secretId), eq(companySecretBindings.targetType, "tool_connection"),
          eq(companySecretBindings.targetId, owned.connectionId)));
        const remaining = await tx.select({ id: companySecretBindings.id }).from(companySecretBindings)
          .where(eq(companySecretBindings.secretId, secretId)).limit(1);
        if (remaining.length) throw new Error("Context credential still has another consumer");
        await tx.delete(companySecrets).where(and(eq(companySecrets.companyId, owned.companyId), eq(companySecrets.id, secretId)));
      });
    }
    ownedContextConnections.splice(0);
    ownedContextSetupCompanies.clear();
    const closedPlans = ownedContextPlans.splice(0);
    for (const { companyId, planId } of closedPlans) {
      // FK-dependent software-fixture ledger cleanup follows owned Run drain;
      // no active Plan or output is removed during a business assertion.
      await db.delete(supervisionInterventions).where(and(eq(supervisionInterventions.companyId, companyId), eq(supervisionInterventions.planId, planId)));
      await db.delete(supervisionSignals).where(and(eq(supervisionSignals.companyId, companyId), eq(supervisionSignals.planId, planId)));
      await db.delete(verificationRuns).where(and(eq(verificationRuns.companyId, companyId), eq(verificationRuns.planId, planId)));
      await db.delete(orchestrationToolCharges).where(and(eq(orchestrationToolCharges.companyId, companyId), eq(orchestrationToolCharges.planId, planId)));
      await db.delete(orchestrationModelReservations).where(and(eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.planId, planId)));
      await db.delete(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, companyId), eq(orchestrationPlans.id, planId)));
    }
    for (const companyId of new Set(closedPlans.map(plan => plan.companyId)))
      await db.delete(agentExecutionManifests).where(eq(agentExecutionManifests.companyId, companyId));
    await db.delete(activityLog);
    await db.delete(agentRuntimeState);
    await db.delete(companySkills);
    await db.delete(companySkillVersions);
    await db.delete(workflows);
    await db.delete(contextManifestItems);
    await db.delete(memoryEvidence);
    await db.delete(memoryRecords);
    await db.delete(memoryBindingTargets);
    await db.delete(memoryBindings);
    // The original run deletion owner enqueues its runtime-asset erasure job.
    await db.delete(memoryJobs);
    await db.delete(nativeRunFinalizations);
    await db.delete(nativeRunResults);
    await db.delete(heartbeatRunEvents);
    await db.delete(contextManifests);
    await db.delete(completionContracts);
    await db.delete(heartbeatRuns);
    await db.delete(foundationChangeProposals);
    await db.delete(foundationSections);
    await db.delete(foundationDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(externalObjectMentions);
    await db.delete(externalObjects);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(principalPermissionGrants);
    await db.delete(toolPolicies);
    await db.delete(agentWakeupRequests);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(authUsers);
    await db.delete(companies);
    await db.delete(instanceSettings);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createContextPresence(companyId: string, human: AuthorizationActor, name: string, status: "idle" | "running" = "idle") {
    // Only the installed controller's actual predecessor gates. Memory enablement
    // and foundation:read remain the independent inputs of the original cases.
    await instanceSettingsService(db).updateExperimental({ agent_identities_v5: true,
      agent_provider_bindings_v5: true, agent_runtime_fabric_v5: true,
      enableFoundationV1: true, enableContextEngineV1: true, enableWorkflowsV1: true,
      readiness_engine_v7: true, orchestration_v7: true, supervision_v7: true });
    const { presence } = await agentIdentityService(db).create(human, { homeCompanyId: companyId, name });
    const [configured] = await db.update(agents).set({ role: "analyst", adapterType: "paperclip_runner",
      adapterConfig: {}, runtimeConfig: {}, permissions: {}, status }).where(eq(agents.id, presence.id)).returning();
    if (!configured) throw new Error("Context fixture identity-backed presence disappeared");
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: configured.id,
      status: "active", membershipRole: "member" }).onConflictDoNothing();
    return configured;
  }

  async function seedContextOwners() {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Context Co",
      issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: userId,
    });
    const humanActor = await seedCurrentHumanSourceActor(db, [companyId], userId);
    // Keep this suite's source authorization explicit: its tests grant
    // foundation:read only where that permission is part of the scenario.
    await db.delete(principalPermissionGrants).where(and(
      eq(principalPermissionGrants.companyId, companyId),
      eq(principalPermissionGrants.principalType, "user"),
      eq(principalPermissionGrants.principalId, userId),
      eq(principalPermissionGrants.permissionKey, "foundation:read"),
    ));
    const agent = await createContextPresence(companyId, humanActor, "Context Agent", "running");
    const [issue] = await db.insert(issues).values({
      companyId,
      title: "Prepare enterprise strategy recommendation",
      description: "Recommend how to position the enterprise launch.",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent!.id,
      responsibleUserId: userId,
    }).returning();
    return { companyId, userId, humanActor, agent, issue: issue! };
  }

  // Existing direct Context-reader component cases retain their original row.
  // Genuine Memory producers below start from owners only, leaving the single
  // installed draft slot free without altering any pre-existing Run.
  async function seed() {
    const seeded = await seedContextOwners();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: seeded.companyId,
      agentId: seeded.agent.id, responsibleUserId: seeded.userId, status: "running",
      runtimeMode: "native", nativeIssueId: seeded.issue.id, issueId: seeded.issue.id }).returning();
    return { ...seeded, run: run! };
  }

  it("keeps a timed-out mandatory Task provider inside its deadline and releases its privacy locks", async () => {
    const seeded = await seed();
    let releaseWriter!: () => void;
    let signalWriterReady!: () => void;
    const writerReady = new Promise<void>(resolve => { signalWriterReady = resolve; });
    const writerGate = new Promise<void>(resolve => { releaseWriter = resolve; });
    const writer = db.transaction(async tx => {
      await lockIssuePrivacyTree(tx, seeded.companyId);
      signalWriterReady();
      await writerGate;
    });
    await writerReady;

    const startedAt = Date.now();
    try {
      await expect(contextEngineService(db).assemble({
        runId: seeded.run.id, companyId: seeded.companyId, agentId: seeded.agent.id,
        responsibleUserId: seeded.userId, issueId: seeded.issue.id, query: "deadline lock regression",
        sensitivityCeiling: "internal", totalDeadlineMs: 3_000,
      })).rejects.toMatchObject({ status: 503, details: expect.objectContaining({ providerKey: "task" }) });
      let pendingPrivacyWaiters = 1;
      while (pendingPrivacyWaiters > 0 && Date.now() - startedAt < 1_500) {
        const [sample] = await db.execute<{ count: number }>(sql`select count(*)::int as count
          from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()
            and wait_event_type='Lock' and query ilike 'select pg_advisory%'`);
        pendingPrivacyWaiters = sample?.count ?? 0;
        if (pendingPrivacyWaiters > 0) await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(pendingPrivacyWaiters).toBe(0);
      expect(Date.now() - startedAt).toBeLessThan(1_500);
    } finally {
      releaseWriter();
      await writer;
    }

    const context = await contextEngineService(db).assemble({
      runId: seeded.run.id, companyId: seeded.companyId, agentId: seeded.agent.id,
      responsibleUserId: seeded.userId, issueId: seeded.issue.id, query: "nested statement deadline regression",
      sensitivityCeiling: "internal", totalDeadlineMs: 3_000,
    });
    expect(context.packet.manifest?.id).toBeTruthy();
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as ReturnType<typeof createDb>;
      await tx.execute(sql`set local statement_timeout='500ms'`);
      await assertAnalyticalContextPayloadAccess(tx, seeded.companyId, seeded.humanActor, { issueId: seeded.issue.id }, undefined,
        { privacyLockMode: "read" });
      const [timeout] = await tx.execute<{ value: string }>(sql`select current_setting('statement_timeout') as value`);
      const durationMs = Number.parseFloat(timeout?.value ?? "0") * (timeout?.value.endsWith("s") && !timeout.value.endsWith("ms") ? 1_000 : 1);
      expect(durationMs).toBeGreaterThan(0);
      expect(durationMs).toBeLessThanOrEqual(500);
    });

    const releasedAt = Date.now();
    await db.transaction(async tx => {
      await tx.execute(sql`set local statement_timeout='500ms'`);
      await lockIssuePrivacyTree(tx, seeded.companyId);
    });
    expect(Date.now() - releasedAt).toBeLessThan(500);
  });

  it("captures append-only native Context alongside shared readers and rechecks a later source withdrawal", async () => {
    const seeded = await seed();
    const primaryTask = await issueService(db).create(seeded.companyId, {
      title: "Native append-only privacy capture",
      description: "The original Human-owned Task payload for Native Context.",
      createdByUserId: seeded.userId,
      responsibleUserId: seeded.userId,
    }, db, undefined, { manualInputActor: seeded.humanActor, privacyActor: seeded.humanActor,
      sourceAccessActor: seeded.humanActor });
    const [nativeRun] = await db.insert(heartbeatRuns).values({ companyId: seeded.companyId,
      agentId: seeded.agent.id, responsibleUserId: seeded.userId, issueId: primaryTask.id,
      nativeIssueId: primaryTask.id, runtimeMode: "native", status: "running" }).returning();
    const memory = await seedMemory({ companyId: seeded.companyId, agentId: seeded.agent.id,
      content: "Native append-only privacy capture Memory with a Human source Task.", humanActor: seeded.humanActor,
      privateSourceTask: true });
    await instanceSettingsService(db).updateExperimental({ enableContextEngineV1: true, enableFoundationV1: false,
      enableCollectiveMemoryV1: true });
    const actor = { type: "agent" as const, source: "none" as const, companyId: seeded.companyId,
      agentId: seeded.agent.id, runId: nativeRun!.id, onBehalfOfUserId: seeded.userId };
    let releaseReader!: () => void;
    let signalReaderReady!: () => void;
    const readerReady = new Promise<void>(resolve => { signalReaderReady = resolve; });
    const readerGate = new Promise<void>(resolve => { releaseReader = resolve; });
    const reader = db.transaction(async tx => {
      await lockIssuePrivacyTree(tx, seeded.companyId, "read");
      signalReaderReady();
      await readerGate;
    });
    await readerReady;

    let captured: Awaited<ReturnType<typeof assembleNativeContextRead>> | null = null;
    let withdrawal: Promise<unknown> | null = null;
    let captureDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      const capture = await Promise.race([
        assembleNativeContextRead(db, { companyId: seeded.companyId, agentId: seeded.agent.id, runId: nativeRun!.id,
          issueId: primaryTask.id, projectId: null, responsibleUserId: seeded.userId,
          actor, query: "append-only privacy capture" })
          .then(result => ({ result })),
        new Promise<{ timedOut: true }>(resolve => {
          captureDeadlineTimer = setTimeout(() => resolve({ timedOut: true }), 4_250);
        }),
      ]);
      if (captureDeadlineTimer) clearTimeout(captureDeadlineTimer);
      if ("timedOut" in capture) throw new Error("Append-only native Context waited behind another shared reader");
      captured = capture.result;
      const capturedManifestId = captured.manifestIds[0]!.contextManifestId;
      const capturedItems = await db.select().from(contextManifestItems).where(and(
        eq(contextManifestItems.companyId, seeded.companyId), eq(contextManifestItems.manifestId, capturedManifestId)));
      expect(capturedItems.length).toBeGreaterThan(0);
      expect(capturedItems.every(item => (item.sourceProvider === "august_works_tasks" &&
        item.sourceRef === `issue://${primaryTask.id}`) || (item.sourceProvider === "august_works_memory" &&
        item.sourceRef === `memory://record/${memory.id}`))).toBe(true);
      expect(captured.sourceSet.policy.memoryIds).toContain(memory.id);
      expect(await db.select().from(issuePrivacySources).where(and(eq(issuePrivacySources.companyId, seeded.companyId),
        eq(issuePrivacySources.issueId, primaryTask.id)))).toHaveLength(0);

      withdrawal = memoryService(db).revoke(seeded.companyId, memory.id, { reason: "Native Context privacy withdrawal regression" }, {
        principal: { type: "user", userId: seeded.userId }, authorizationActor: seeded.humanActor,
      });
      let waitingWriter = false;
      const waitDeadline = Date.now() + 1_000;
      while (Date.now() < waitDeadline && !waitingWriter) {
        const [sample] = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity
          where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock'
            and query ilike 'select pg_advisory%'`);
        waitingWriter = (sample?.count ?? 0) > 0;
        if (!waitingWriter) await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waitingWriter).toBe(true);
    } finally {
      if (captureDeadlineTimer) clearTimeout(captureDeadlineTimer);
      releaseReader();
      await reader;
    }
    if (!withdrawal) throw new Error("Human Memory withdrawal did not start");
    await withdrawal;
    if (!captured) throw new Error("Native append-only Context capture did not complete");
    await expect(assertNativeContextReadSourceSetCurrent(db, { companyId: seeded.companyId, agentId: seeded.agent.id,
      runId: nativeRun!.id, issueId: primaryTask.id, actor, sourceSet: captured.sourceSet,
      manifestIds: captured.manifestIds })).rejects.toMatchObject({ status: 403 });
  });

  async function createOwnerPrivateMemoryThroughNativeGateway(input: {
    companyId: string; agentId: string; userId: string; issueId: string; bindingKey: string; content: string;
    sensitivity: "public" | "internal" | "confidential" | "restricted"; observedAt: Date; expiresAt: Date | null;
    onNativeRun?: (run: { id: string; actor: AuthorizationActor; issueId: string }) => void;
    human: AuthorizationActor;
  }) {
    ownedContextSetupCompanies.add(input.companyId);
    const previousSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
    const previousApiUrl = process.env.PAPERCLIP_API_URL;
    process.env.PAPERCLIP_AGENT_JWT_SECRET = randomUUID();
    // A normal server boot derives this URL before admitting native runs.
    // Keep the fixture on the same configured environment path.
    process.env.PAPERCLIP_API_URL = "http://127.0.0.1:3100/api";
    const previousMemorySettings = await instanceSettingsService(db).getExperimental();
    let releaseTurn!: () => void;
    let signalTurnStarted!: () => void;
    const turnGate = new Promise<void>((resolve) => { releaseTurn = resolve; });
    const turnStarted = new Promise<void>((resolve) => { signalTurnStarted = resolve; });
    let heartbeat: ReturnType<typeof heartbeatService> | undefined;
    let retainedForContextRead = false;
    try {
      await instanceSettingsService(db).updateExperimental({ enablePrivateAgentMemoryV1: true });
      // This is the installed text controller's real reservation/wire path with
      // controlled software HTTP. It does not qualify OpenCode or a Sandbox.
      const profileId = randomUUID(), model = "fixture-context-memory-text-v1";
      const sourceSha = "a".repeat(40), credential = "context-memory-private-fixture-secret";
      await db.update(agents).set({ adapterConfig: { provider: "aw_text_only", workerModelProfileId: profileId,
        model, maxOutputTokens: 256, lifecycleMode: "per_turn" },
        runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
      }).where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId)));
      const providers = agentProviderBindingService(db);
      const provider = await providers.create(input.human, input.companyId, input.agentId, {
        providerType: "paperclip_native", providerAgentRef: input.agentId,
        isolationMode: "isolated_per_presence", providerEndpointRef: null });
      await providers.attach(input.human, input.companyId, input.agentId,
        { providerBindingId: provider.id, providerProfileRef: input.agentId });
      const [presence] = await db.select().from(agents).where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId)));
      if (!presence) throw new Error("Context Memory controller presence disappeared");
      const advertised = await discoverNativeCapabilities({ companyId: input.companyId,
        adapterType: "paperclip_runner", config: presence.adapterConfig });
      const recorded = await providers.recordDiscovery(input.companyId, input.agentId, advertised, {
        connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
      await providers.revalidate(input.human, input.companyId, input.agentId, recorded.capabilitySnapshotHash!,
        "Review the installed text-controller software contract for Context Memory; no live provider qualification claimed");
      const qualified = await providers.assertRuntime(input.companyId, input.agentId);
      if (!qualified.provider.capabilitySnapshotHash || !qualified.runtime.qualifiedConfigurationHash)
        throw new Error("Context Memory controller profile is not current");
      const connection = await aiConnectionService(db).save(input.companyId, input.userId, {
        provider: "anthropic", method: "api_key", ownership: "shared", name: "Context Memory text fixture",
        apiKey: "fixture", allAgents: false, agentIds: [input.agentId] }, credential);
      // save is atomic. Record its exact returned IDs before any subsequent
      // profile/Plan work, including failures while reading saved references.
      const ownedConnection = { companyId: input.companyId, ...connection, userId: input.userId, secretIds: [] as string[] };
      ownedContextConnections.push(ownedConnection);
      const [savedGrant] = await db.select({ refs: connectionGrants.credentialSecretRefs }).from(connectionGrants).where(and(
        eq(connectionGrants.companyId, input.companyId), eq(connectionGrants.id, connection.grantId),
        eq(connectionGrants.connectionId, connection.connectionId)));
      if (!savedGrant || savedGrant.refs.length !== 1 || savedGrant.refs[0]!.configPath !== "ai.credential")
        throw new Error("Context saved connection lacks its exact credential reference");
      ownedConnection.secretIds = [savedGrant.refs[0]!.secretId];
      const profile: WorkerModelProfile = { id: profileId, companyId: input.companyId, workerAgentId: input.agentId,
        providerBindingId: qualified.provider.id, providerSnapshotHash: qualified.provider.capabilitySnapshotHash,
        providerProfileRef: qualified.runtime.providerProfileRef, qualifiedConfigurationHash: qualified.runtime.qualifiedConfigurationHash,
        binding: { provider: "anthropic", method: "api_key", mode: "shared", ...connection },
        transport: "server-text-only-v1", contract: "anthropic-text-messages-2023-06-01", maximumEnvelopeBytes: 64000,
        inputTokensUpperBound: 100000, maxOutputTokens: 1024,
        tariff: { provider: "anthropic", model, currency: "USD", inputMinorPerMillion: 0,
          outputMinorPerMillion: 0, fixedMinor: 3, qualificationHash: "b".repeat(64), sourceSha,
          testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString() },
        qualificationEvidenceRef: "https://protected.test.invalid/qualification/context-memory-software-only.json",
        qualificationArtifactSha256: "c".repeat(64) };
      let modelCalls = 0, planId = "";
      const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
        if (++modelCalls !== 1 || String(url) !== "https://api.anthropic.com/v1/messages" ||
          new Headers(init.headers).get("x-api-key") !== credential)
          throw new Error("Context Memory text request is not its exact installed transport");
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (body.model !== model || body.max_tokens !== 256 || body.tools !== undefined)
          throw new Error("Context Memory text request changed its closed profile");
        const reservations = await db.select().from(orchestrationModelReservations)
          .where(eq(orchestrationModelReservations.planId, planId));
        if (reservations.length !== 1 || reservations[0]!.status !== "dispatched")
          throw new Error("Context Memory text request lacks its real dispatched reservation");
        signalTurnStarted();
        // Release only this owned response gate; the real controller and its
        // original source/budget checks own the Run and eventual document finish.
        await turnGate;
        init.signal?.throwIfAborted();
        return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
          content: [{ type: "text", text: "Retained internal Context Memory fixture document for Human review." }],
          usage: { input_tokens: 10, output_tokens: 20 } }),
          { status: 200, headers: { "content-type": "application/json" } });
      };
      const consumer = workerModelGateway(db, { profiles: [profile], sourceSha,
        protectedEvidenceOrigin: "https://protected.test.invalid", fetch });
      registerNativeDraftGateway(db, consumer);
      heartbeat = heartbeatService(db, { nativeSessionBackendFactory: () => {
        throw new Error("Context Memory must use the installed text controller, not a backend substitute");
      } });
      await instanceSettingsService(db).updateExperimental({ enableNativeRunner: true });
      const [task] = await db.select().from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)));
      if (!task || task.assigneeAgentId !== input.agentId || !task.payloadSourceSnapshot)
        throw new Error("Context Memory requires its original assigned Human Task source");
      const plans = orchestrationService(db);
      const plan = await plans.create(input.human, input.companyId, { issueId: task.id,
        expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
        completionContract: { objective: "Retain one internal text document for Human review",
          requiredOutputs: [{ kind: "task_document", key: "result" }],
          businessInvariants: ["The Context assertions and private Memory remain owner scoped"] },
        budgets: { maxModelCostMinor: 6, maxToolActions: 3 }, workers: [{ key: "context-memory-writer", issueId: task.id }] });
      planId = plan.id;
      ownedContextPlans.push({ companyId: input.companyId, planId });
      await plans.decide(input.human, input.companyId, plan.id, { expectedVersion: plan.version, action: "start",
        rationale: "Admit the installed bounded text controller for the actual Context Memory producer Task" });
      const run = await heartbeat.invoke(input.agentId, "on_demand", { issueId: input.issueId }, "manual",
        { actorType: "user", actorId: input.userId });
      if (!run) throw new Error("Canonical Heartbeat owner did not create the Memory producer run");
      let backendWaitTimer: ReturnType<typeof setTimeout> | undefined;
      const backendWait = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Canonical Heartbeat run did not reach its native backend")), 15_000);
        backendWaitTimer = timer;
        timer.unref();
      });
      try {
        await Promise.race([turnStarted, backendWait]);
      } finally {
        if (backendWaitTimer) clearTimeout(backendWaitTimer);
      }

      const currentRunRows = await db.select({ id: heartbeatRuns.id, status: heartbeatRuns.status,
        runtimeMode: heartbeatRuns.runtimeMode, nativeIssueId: heartbeatRuns.nativeIssueId,
        responsibleUserId: heartbeatRuns.responsibleUserId,
        activeIdentityContextId: heartbeatRuns.activeIdentityContextId,
        runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.agentId, input.agentId)));
      const returnedRun = currentRunRows.find((candidate) => candidate.id === run.id);
      if (returnedRun?.status !== "running" || returnedRun.runtimeMode !== "native" ||
        returnedRun.nativeIssueId !== input.issueId || returnedRun.responsibleUserId !== input.userId)
        throw new Error(`Canonical Memory producer run is not active: ${JSON.stringify({returnedRun, currentRunRows})}`);

      const profileJson = returnedRun.runnerProfileJson as Record<string, unknown>;
      const receipt = nativeRunInputSourceReceiptSchema.safeParse(profileJson.nativeInputSourceReceipt);
      if (!receipt.success || receipt.data.binding.companyId !== input.companyId ||
        receipt.data.binding.agentId !== input.agentId || receipt.data.binding.runId !== run.id ||
        receipt.data.binding.issueId !== input.issueId || receipt.data.binding.responsibleUserId !== input.userId ||
        !receipt.data.bootstrap.inputs.some(source => source.kind === "task" && source.issueId === input.issueId))
        throw new Error("Context Memory producer lacks its exact retained Native input source receipt");

      const token = createLocalAgentJwt(input.agentId, input.companyId, "paperclip_runner", run.id, input.userId);
      const claims = token ? verifyLocalAgentJwt(token) : null;
      if (!token || !claims) throw new Error("Could not mint and verify the actual Memory producer AgentJWT");
      const memberships = await db.select({ companyId: companyMemberships.companyId,
        membershipRole: companyMemberships.membershipRole, status: companyMemberships.status })
        .from(companyMemberships).where(and(eq(companyMemberships.companyId, input.companyId),
          eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, input.userId)));
      const actor: AuthorizationActor = {
        type: "agent", source: "agent_jwt", companyId: claims.company_id, agentId: claims.sub, runId: claims.run_id,
        onBehalfOfUserId: claims.responsible_user_id, authenticatedCredentialExpiresAt: claims.exp * 1000,
        keyScope: claims.key_scope ?? { kind: "standard" }, onBehalfOfMemberships: memberships,
      };
      input.onNativeRun?.({ id: run.id, actor, issueId: input.issueId });
      await db.insert(toolPolicies).values({ companyId: input.companyId, name: `Allow native Memory ${randomUUID()}`,
        policyType: "allow", selectors: { toolName: "paperclip-self:remember" } });
      const gateway = createToolGatewayService(db);
      const session = await gateway.createSession({ companyId: input.companyId, agentId: input.agentId, runId: run.id,
        issueId: input.issueId, authorizationActor: actor });
      const result = await gateway.executeTool({ sessionToken: session.token, tool: "paperclip-self:remember",
        parameters: { scope: "private", memoryType: "lesson", content: input.content,
          bindingKey: input.bindingKey,
          observedAt: input.observedAt.toISOString(), expiresAt: input.expiresAt?.toISOString() ?? null,
          idempotencyKey: randomUUID() } });
      if (result.status !== "completed" || !result.result || typeof result.result !== "object" ||
        !("data" in result.result) || typeof (result.result as { data?: unknown }).data !== "object" ||
        !("record" in ((result.result as { data: Record<string, unknown> }).data)) ||
        !((result.result as { data: { record?: { id?: string } } }).data.record?.id))
        throw new Error(`The real Tool Gateway Memory producer returned no record: ${JSON.stringify({
          status: result.status, reasonCode: "reasonCode" in result ? result.reasonCode : null,
          resultKeys: result.result && typeof result.result === "object" ? Object.keys(result.result) : [],
          dataKeys: result.result && typeof result.result === "object" && "data" in result.result &&
            result.result.data && typeof result.result.data === "object" ? Object.keys(result.result.data) : [],
        })}`);
      const recordId = (result.result as { data: { record: { id: string } } }).data.record.id;
      const [record] = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, input.companyId),
        eq(memoryRecords.id, recordId)));
      if (!record) throw new Error("The real Tool Gateway Memory producer record was not persisted");
      const restartedGateway = createToolGatewayService(db);
      await expect(restartedGateway.executeTool({ sessionToken: session.token, tool: "paperclip-self:remember",
        parameters: { scope: "private", memoryType: "lesson", content: input.content, bindingKey: input.bindingKey,
          observedAt: input.observedAt.toISOString(), expiresAt: input.expiresAt?.toISOString() ?? null,
          idempotencyKey: randomUUID() } })).rejects.toMatchObject({
        reasonCode: "memory_agent_authority_unavailable",
      });
      const persistedAfterRestart = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, input.companyId),
        eq(memoryRecords.id, recordId)));
      expect(persistedAfterRestart).toHaveLength(1);
      retainedForContextRead = true;
      const retainedHeartbeat = heartbeat;
      activeNativeMemoryRunDrains.push({ release: releaseTurn, drain: () => retainedHeartbeat.drainActiveRunExecutions() });
      return record;
    } finally {
      if (!retainedForContextRead) {
        releaseTurn();
        for (const active of activeNativeMemoryRunDrains) active.release();
        await heartbeat?.drainActiveRunExecutions();
      }
      if (!retainedForContextRead) registerNativeDraftGateway(db, undefined);
      if (previousSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
      else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousSecret;
      if (previousApiUrl === undefined) delete process.env.PAPERCLIP_API_URL;
      else process.env.PAPERCLIP_API_URL = previousApiUrl;
      await instanceSettingsService(db).updateExperimental({
        enablePrivateAgentMemoryV1: previousMemorySettings.enablePrivateAgentMemoryV1,
      });
    }
  }

  async function seedMemory(input: {
    companyId: string;
    agentId: string;
    content: string;
    scope?: "company" | "agent";
    reviewState?: "pending" | "accepted" | "rejected";
    sensitivity?: "public" | "internal" | "confidential" | "restricted";
    revokedAt?: Date | null;
    expiresAt?: Date | null;
    verificationState?: "unverified" | "corroborated" | "human_verified" | "system_verified";
    sourceTaskBody?: string;
    sourceSnapshotState?: "missing" | "invalidated";
    expireHumanCredential?: boolean;
    privateSourceTask?: boolean;
    foreignSource?: { id: string; updatedAt: Date; identifier: string; title: string };
    humanActor?: AuthorizationActor;
    onNativeRun?: (run: { id: string; actor: AuthorizationActor; issueId: string }) => void;
  }) {
    const scope = input.scope ?? "company";
    const [binding] = await db
      .insert(memoryBindings)
      .values({
        companyId: input.companyId,
        key: `context-${randomUUID()}`,
        name: "Context memory",
        providerKey: "local",
        config: {},
        enabled: true,
      })
      .returning();
    await db.insert(memoryBindingTargets).values({
      companyId: input.companyId,
      bindingId: binding!.id,
      targetType: scope === "agent" ? "agent" : "company",
      targetId: scope === "agent" ? input.agentId : input.companyId,
    });
    const observedAt = new Date("2026-09-30T12:00:00.000Z");
    const [company] = await db.select().from(companies).where(eq(companies.id,input.companyId));
    const userId=company!.defaultResponsibleUserId!;
    const human=input.humanActor??await seedCurrentHumanSourceActor(db,[input.companyId],userId);
    if(human.type!=="board"||human.source!=="session"||!human.userId||!human.sessionId||human.userId!==userId||
      !human.companyIds?.includes(input.companyId))throw new Error("Canonical Memory Human fixture lacks its verified session");
    if(scope==="company"){
      // Shared Memory uses a current, canonical Human-authored Task as its
      // evidence source; no synthetic/manual URI stands in for source access.
      await db.insert(principalPermissionGrants).values({companyId:input.companyId,principalType:"agent",principalId:input.agentId,
        permissionKey:"company_scope:read"}).onConflictDoNothing();
      await db.insert(principalPermissionGrants).values({companyId:input.companyId,principalType:"user",principalId:userId,
        permissionKey:"company_scope:read"}).onConflictDoNothing();
      const sourceTask=await issueService(db).create(input.companyId,{
        title:`Human Memory evidence ${randomUUID()}`,description:`${input.content}\n\nThis is the source Task for the reviewed Memory candidate.`,
        createdByUserId:userId,responsibleUserId:userId,
        ...(input.privateSourceTask?{visibility:"private" as const,status:"todo" as const,assigneeAgentId:input.agentId}:{}),
      },db,undefined,input.sourceSnapshotState==="missing"
        ?{privacyActor:human,sourceAccessActor:human}
        :{manualInputActor:human,privacyActor:human,sourceAccessActor:human});
      let sourceTaskUpdatedAt=sourceTask.updatedAt;
      if(input.sourceSnapshotState==="invalidated"){
        await issueService(db).update(sourceTask.id,{description:`${sourceTask.description}\nEdited after direct Human input.`,
          actorUserId:userId,privacyActor:human},db);
        const [updatedSourceTask]=await db.select({updatedAt:issues.updatedAt}).from(issues).where(and(
          eq(issues.companyId,input.companyId),eq(issues.id,sourceTask.id)));
        if(!updatedSourceTask)throw new Error("Edited Human Memory source Task disappeared");
        sourceTaskUpdatedAt=updatedSourceTask.updatedAt;
      }
      const humanActor={principal:{type:"user" as const,userId},authorizationActor:human};
      if(input.expireHumanCredential&&human.sessionId)await db.update(authSessions).set({expiresAt:new Date(Date.now()-1000)})
        .where(eq(authSessions.id,human.sessionId));
      const evidenceTask=input.foreignSource??{...sourceTask,updatedAt:sourceTaskUpdatedAt};
      const candidate=await memoryService(db).createCandidate(input.companyId,{
        bindingId:binding!.id,memoryType:"lesson",scope:{type:"company",id:null},subject:{type:"company",id:input.companyId},
        ownerAgentId:null,title:null,content:input.content,summary:null,sensitivity:input.sensitivity??"internal",importance:50,
        confidenceScore:0.8,validFrom:null,validUntil:null,observedAt:observedAt.toISOString(),retentionPolicy:"standard",
        expiresAt:input.expiresAt?.toISOString()??null,createdByOperationId:null,metadata:{},evidence:[{
          sourceClass:"task",sourceProvider:"august_works_tasks",sourceType:"issue",sourceRef:`issue://${evidenceTask.id}`,
          sourceVersion:evidenceTask.updatedAt.toISOString(),sourceUpdatedAt:evidenceTask.updatedAt.toISOString(),observedAt:observedAt.toISOString(),
          excerptHash:createHash("sha256").update(input.content).digest("hex"),
          citation:{label:`${evidenceTask.identifier}: ${evidenceTask.title}`},
          trustLevel:"low",relation:"supports"}],
      },humanActor);
      let record=candidate.record;
      if((input.reviewState??"accepted")==="accepted"||(input.reviewState??"accepted")==="rejected"){
        const reviewed=await memoryService(db).reviewCandidate(input.companyId,record.id,
          (input.reviewState??"accepted")==="accepted"?{decision:"accept"}:{decision:"reject",reason:"Context fixture control"},humanActor);
        record=reviewed.record;
      }
      if(input.revokedAt){
        await memoryService(db).revoke(input.companyId,record.id,{reason:"Context fixture revocation"},humanActor);
        record=(await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId,input.companyId),
          eq(memoryRecords.id,record.id))))[0]!;
      }
      return record;
    }
    const app=express(); app.use(express.json());
    app.use(((req,_res,next)=>{req.actor={type:"board",source:"session",userId:human.userId!,sessionId:human.sessionId??undefined,
      ...(typeof human.authenticatedCredentialExpiresAt==="number"?{authenticatedCredentialExpiresAt:human.authenticatedCredentialExpiresAt}:{}),
      companyIds:[input.companyId],memberships:[{companyId:input.companyId,membershipRole:"owner",status:"active"}]};next();}) as RequestHandler);
    app.use("/api",issueRoutes(db,{} as never)); app.use(errorHandler);
    const createdSourceIssue=await request(app).post(`/api/companies/${input.companyId}/issues`)
      .send({title:`Actual Memory producer Task ${randomUUID()}`,status:"todo",description:input.sourceTaskBody??"Human-authored source for a native Memory candidate."});
    if(createdSourceIssue.status!==201)throw new Error(`Canonical source Task creation returned ${createdSourceIssue.status}: ${JSON.stringify(createdSourceIssue.body)}`);
    const sourceIssueId=createdSourceIssue.body.id as string;
    await request(app).patch(`/api/issues/${sourceIssueId}`).send({assigneeAgentId:input.agentId}).expect(200);
    const [sourceIssue] = await db.select().from(issues).where(and(eq(issues.companyId,input.companyId),eq(issues.id,sourceIssueId)));
    if(!sourceIssue?.payloadSourceSnapshot)throw new Error("Memory source fixture Task lacks its original Human payload capture");
    await db.insert(principalPermissionGrants).values({companyId:input.companyId,principalType:"agent",principalId:input.agentId,
      permissionKey:"company_scope:read"}).onConflictDoNothing();
    const memoryRecord=await createOwnerPrivateMemoryThroughNativeGateway({
      companyId:input.companyId,agentId:input.agentId,userId,issueId:sourceIssueId,bindingKey:binding!.key,content:input.content,
      sensitivity:input.sensitivity??"internal",observedAt,expiresAt:input.expiresAt??null,onNativeRun:input.onNativeRun,human,
    });
    if(input.revokedAt){
      const [revoked]=await db.update(memoryRecords).set({revokedAt:input.revokedAt,revokedByActorType:"system",
        revokedByActorId:"context-memory-test",revocationReason:"Test revocation"})
        .where(and(eq(memoryRecords.companyId,input.companyId),eq(memoryRecords.id,memoryRecord.id))).returning();
      return revoked!;
    }
    return memoryRecord;
  }

  async function createApprovedFoundation(input: {
    companyId: string;
    userId: string;
    key: string;
    body: string;
    sensitivity: "internal" | "confidential";
  }) {
    const svc = foundationService(db);
    const draft = await svc.createDraft(
      input.companyId,
      {
        foundationKey: input.key,
        category: "strategy",
        documentType: "strategy",
        title: input.key,
        body: input.body,
        sensitivity: input.sensitivity,
      },
      { principal: { type: "user", userId: input.userId } },
    );
    const submitted = await svc.submitForReview(
      input.companyId,
      draft.id,
      draft.latestRevisionId!,
      { principal: { type: "user", userId: input.userId } },
    );
    return svc.approve(
      input.companyId,
      draft.id,
      submitted.latestRevisionId!,
      { principal: { type: "user", userId: input.userId } },
    );
  }

  it("executes Foundation and Memory query nodes with approved and accepted sources only", async () => {
    const seeded = await seedContextOwners();
    await instanceSettingsService(db).updateExperimental({ enableFoundationV1: true, enableCollectiveMemoryV1: true });
    await db.insert(principalPermissionGrants).values({ companyId: seeded.companyId, principalType: "user",
      principalId: seeded.userId, permissionKey: "foundation:read", scope: null });
    const approved = await createApprovedFoundation({ companyId: seeded.companyId, userId: seeded.userId,
      key: "enterprise-guidance", body: "# Enterprise\nApproved enterprise strategy", sensitivity: "internal" });
    await foundationService(db).createDraft(seeded.companyId, { foundationKey: "enterprise-draft", category: "strategy",
      documentType: "strategy", title: "Unapproved enterprise strategy", body: "Draft enterprise secret", sensitivity: "internal" },
      { principal: { type: "user", userId: seeded.userId } });
    const accepted = await seedMemory({ companyId: seeded.companyId, agentId: seeded.agent.id,
      content: "Accepted enterprise memory", reviewState: "accepted" });
    await seedMemory({ companyId: seeded.companyId, agentId: seeded.agent.id,
      content: "Pending enterprise memory", reviewState: "pending" });
    await seedMemory({ companyId: seeded.companyId, agentId: seeded.agent.id,
      content: "Private enterprise memory", scope: "agent", reviewState: "accepted" });
    // Memory setup creates canonical passkey sessions for its review flows;
    // the last ceremony revokes older sessions, so capture the Workflow reader
    // only after those source-owner fixtures are complete.
    const humanActor = await seedCurrentHumanSourceActor(db, [seeded.companyId], seeded.userId);
    await db.insert(principalPermissionGrants).values({ companyId: seeded.companyId, principalType: "user",
      principalId: seeded.userId, permissionKey: "company_scope:read", scope: null }).onConflictDoNothing();
    expect(accepted.sourceIssueIds).toHaveLength(1);
    const sourceRef = `issue://${accepted.sourceIssueIds[0]}`;
    const actor = { principal: { type: "user" as const, userId: seeded.userId }, authorizationActor: humanActor };
    const svc = workflowService(db);
    const created = await svc.create(seeded.companyId, { name: "Native evidence workflow" }, actor);
    const updated = await svc.updateDraft(seeded.companyId, created.id, { expectedRevisionId: created.draftRevisionId!,
      graph: { version: 1, variables: [], settings: {}, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "foundation", type: "native.foundation_query", name: "Foundation", position: { x: 100, y: 0 }, config: { query: "{{trigger.query}}", limit: 8 } },
        { id: "memory", type: "native.memory_recall", name: "Memory", position: { x: 200, y: 0 }, config: { query: "{{trigger.query}}", limit: 8 } },
        { id: "derived", type: "core.transform", name: "Derived output", position: { x: 300, y: 0 }, config: { mapping: { content: '{{input.records["0"].record.content}}' } } },
      ], edges: [{ id: "e1", source: "start", target: "foundation" }, { id: "e2", source: "foundation", target: "memory" },
        { id: "e3", source: "memory", target: "derived" }] } }, actor);
    await svc.publish(seeded.companyId, created.id, { expectedDraftRevisionId: updated.draftRevisionId!, expectedPublishedRevisionId: null, approvalId: null }, actor);
    const executor = workflowExecutorService(db);
    const result = await executor.startManualRun(seeded.companyId, created.id, { input: { query: "enterprise" } }, actor, "native-evidence-run");
    expect(result.run.status,JSON.stringify({failureCode:result.run.failureCode,steps:result.steps.map(step=>({nodeId:step.nodeId,status:step.status}))})).toBe("succeeded");
    const foundation = result.steps.find((step) => step.nodeId === "foundation")!.outputJson as { sections: Array<{ foundationDocumentId: string; sourceRef: string }> };
    expect(foundation.sections).toMatchObject([{ foundationDocumentId: approved.id, sourceRef: expect.stringContaining(approved.approvedRevisionId!) }]);
    const memory = result.steps.find((step) => step.nodeId === "memory")!.outputJson as { records: Array<{ record: { id: string; content: string }; sourceRef: string }> };
    expect(memory.records).toMatchObject([{ record: { id: accepted.id, content: "Accepted enterprise memory" }, sourceRef: `memory://shared/${accepted.id}` }]);
    expect(memory.records).toHaveLength(1);
    expect(result.steps.find((step) => step.nodeId === "derived")).toMatchObject({ outputJson: { content: "Accepted enterprise memory" }, memoryRecordIds: [accepted.id] });
    // Use the canonical authenticated PATCH owner to change the captured Task
    // body. The owner invalidates the old body snapshot; retained Memory must
    // fail closed against that changed source.
    const sourceUpdateApp = express();
    sourceUpdateApp.use(express.json());
    sourceUpdateApp.use(((req, _res, next) => {
      req.actor = { type: "board", source: "session", userId: humanActor.userId!,
        sessionId: humanActor.sessionId ?? undefined,
        ...(typeof humanActor.authenticatedCredentialExpiresAt === "number"
          ? { authenticatedCredentialExpiresAt: humanActor.authenticatedCredentialExpiresAt } : {}),
        companyIds: [seeded.companyId],
        memberships: [{ companyId: seeded.companyId, membershipRole: "owner", status: "active" }] };
      next();
    }) as RequestHandler);
    sourceUpdateApp.use("/api", issueRoutes(db, {} as never));
    sourceUpdateApp.use(errorHandler);
    await request(sourceUpdateApp).patch(`/api/issues/${accepted.sourceIssueIds[0]}`)
      .send({ description: "The canonical Human Task source changed after Memory review." }).expect(200);
    const [changedSource] = await db.select({ payloadSourceSnapshot: issues.payloadSourceSnapshot,
      payloadSourceSnapshotInvalidated: issues.payloadSourceSnapshotInvalidated }).from(issues).where(and(
        eq(issues.companyId, seeded.companyId), eq(issues.id, accepted.sourceIssueIds[0]!)));
    expect(changedSource).toMatchObject({ payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: true });
    expect(await memoryService(db).get(seeded.companyId, accepted.id, actor)).toBeNull();
    await issueService(db).remove(accepted.sourceIssueIds[0]!);
    await issueService(db).remove(seeded.issue.id);
    await expect(executor.getRun(seeded.companyId, result.run.id, humanActor)).rejects.toMatchObject({ status: 403 });
    const erasedSteps = await db.select({ nodeId: workflowStepRuns.nodeId, inputJson: workflowStepRuns.inputJson,
      outputJson: workflowStepRuns.outputJson }).from(workflowStepRuns).where(and(
        eq(workflowStepRuns.companyId, seeded.companyId), eq(workflowStepRuns.workflowRunId, result.run.id)));
    for (const id of ["memory", "derived"]) expect(erasedSteps.find((step) => step.nodeId === id))
      .toMatchObject({ inputJson: null, outputJson: null });
    expect(await memoryService(db).get(seeded.companyId, accepted.id, actor)).toBeNull();
    await expect(assertMemorySourcesRetained(db, seeded.companyId, [{ sourceProvider: "august_works_tasks", sourceRef }]))
      .rejects.toMatchObject({ details: { code: "memory_source_deleted" } });
    await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: false });
    const denied = await executor.startManualRun(seeded.companyId, created.id, { input: { query: "enterprise" } }, actor, "native-evidence-disabled");
    expect(denied.run).toMatchObject({ status: "failed", failureCode: "collective_memory_disabled" });
  });

  it("assembles authorized approved Foundation and task context into a durable manifest", async () => {
    const seeded = await seed();
    await db.insert(principalPermissionGrants).values([
      {
        companyId: seeded.companyId,
        principalType: "agent",
        principalId: seeded.agent.id,
        permissionKey: "foundation:read",
        scope: null,
      },
      {
        companyId: seeded.companyId,
        principalType: "user",
        principalId: seeded.userId,
        permissionKey: "foundation:read",
        scope: null,
      },
    ]);
    await createApprovedFoundation({
      companyId: seeded.companyId,
      userId: seeded.userId,
      key: "enterprise-strategy",
      body: "# Enterprise strategy\nEnterprise strategy prioritizes durable customer value.",
      sensitivity: "internal",
    });
    await createApprovedFoundation({
      companyId: seeded.companyId,
      userId: seeded.userId,
      key: "confidential-strategy",
      body: "# Confidential strategy\nEnterprise strategy acquisition target is confidential.",
      sensitivity: "confidential",
    });

    const result = await contextEngineService(db).assemble({
      runId: seeded.run.id,
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      responsibleUserId: seeded.userId,
      issueId: seeded.issue.id,
      query: "enterprise strategy",
      sensitivityCeiling: "internal",
      totalDeadlineMs: 3_000,
    });

    expect(result.packet.taskContext).toHaveLength(1);
    expect(result.packet.foundation).toEqual([
      expect.objectContaining({
        sourceClass: "foundation",
        sensitivity: "internal",
        excerpt: expect.stringContaining("durable customer value"),
      }),
    ]);
    expect(result.markdown).toContain("## August Works governed context");
    expect(result.markdown).toContain("Approved Foundation");
    expect(result.markdown).not.toContain("acquisition target");
    expect(result.packet.manifest?.id).toBeTruthy();

    const persisted = await db.select().from(contextManifests);
    const items = await db.select().from(contextManifestItems);
    expect(persisted).toHaveLength(1);
    expect(items.some((item) => item.sourceClass === "foundation")).toBe(true);
    expect(items.some((item) => item.sourceClass === "task")).toBe(true);
    expect(JSON.stringify({ persisted, items })).not.toContain("durable customer value");
  });

  it("binds actual approved Foundation and private Task Context to one native bootstrap witness and rechecks current Human authority", async () => {
    const seeded = await seed();
    const human = seeded.humanActor;
    if (human.type !== "board" || human.source !== "session" || !human.sessionId)
      throw new Error("Context mutation fixture did not retain its actual Human session");
    const task = await issueService(db).create(seeded.companyId, {
      title: "Prepare enterprise Context source", description: "Use only the current Task and approved guidance.",
      createdByUserId: seeded.userId, responsibleUserId: seeded.userId }, db, undefined,
    { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const [run] = await db.insert(heartbeatRuns).values({ companyId: seeded.companyId, agentId: seeded.agent.id,
      responsibleUserId: seeded.userId, issueId: task.id, nativeIssueId: task.id, runtimeMode: "native", status: "running" }).returning();
    await db.insert(principalPermissionGrants).values({ companyId: seeded.companyId, principalType: "agent",
      principalId: seeded.agent.id, permissionKey: "foundation:read", scope: null });
    await db.insert(principalPermissionGrants).values({ companyId: seeded.companyId, principalType: "user",
      principalId: seeded.userId, permissionKey: "foundation:read", scope: null });
    const foundation = await createApprovedFoundation({ companyId: seeded.companyId, userId: seeded.userId,
      key: "enterprise-strategy", body: "# Enterprise strategy\nEnterprise strategy prioritizes durable customer value.", sensitivity: "internal" });

    const assembleInput = { companyId: seeded.companyId, agentId: seeded.agent.id, responsibleUserId: seeded.userId,
      runId: run!.id, issueId: task.id, projectId: null, query: "enterprise strategy",
      intent: "native_task_execution", includeFoundation: true, sensitivityCeiling: "internal" as const,
      authorizationActor: { type: "agent" as const, source: "none" as const, companyId: seeded.companyId,
        agentId: seeded.agent.id, runId: run!.id, onBehalfOfUserId: seeded.userId } };
    let context = await contextEngineService(db).assembleNativeBootstrap(assembleInput);
    expect(context.nativeBootstrapWitness).toBeDefined();
    expect(readNativeBootstrapContextWitness(context.nativeBootstrapWitness, { companyId: seeded.companyId,
      runId: run!.id, agentId: seeded.agent.id, issueId: task.id, renderedMarkdown: context.markdown,
      manifestIds: [{ companyId: seeded.companyId, contextManifestId: context.packet.manifest!.id }] })?.actor)
      .toMatchObject({ type: "agent", source: "none", companyId: seeded.companyId, agentId: seeded.agent.id,
        runId: run!.id, onBehalfOfUserId: seeded.userId });
    expect(context.packet.foundation).toHaveLength(1);
    expect(context.packet.taskContext).toEqual(expect.arrayContaining([expect.objectContaining({ sourceRef: `issue://${task.id}` })]));

    const taskCaptureHolder: { value: NativeTaskSourceCapture | null } = { value: null };
    const renderedTask = await getIssueExecutionContext(db, seeded.companyId, task.id,
      capture => { taskCaptureHolder.value = capture; });
    const taskCapture = taskCaptureHolder.value;
    expect(renderedTask).not.toBeNull();
    expect(taskCapture).not.toBeNull();
    const references: NativeRenderedSourceReference[] = [];
    const renderedMarkdown = buildPaperclipTaskMarkdown({ issue: { id: task.id, identifier: renderedTask!.identifier,
      title: renderedTask!.title, description: renderedTask!.description, workMode: renderedTask!.workMode } },
      { onRenderedSource: reference => references.push(reference) });
    if (!renderedMarkdown) throw new Error("Native bootstrap fixture could not render its exact Task Markdown");
    const sourceSet = buildNativeBootstrapSourceSet({ companyId: seeded.companyId, runId: run!.id,
      agentId: seeded.agent.id, issueId: task.id, renderedMarkdown,
      renderedMarkdownDigest: createHash("sha256").update(renderedMarkdown, "utf8").digest("hex"), references,
      candidates: [{ kind: "task", id: task.id, input: taskCapture!.input,
        payloadSourceSnapshot: taskCapture!.payloadSourceSnapshot }], runtimeInputs: [],
      contextManifestIds: [{ companyId: seeded.companyId, contextManifestId: context.packet.manifest!.id }],
      governedContextMarkdown: context.markdown, contextWitness: context.nativeBootstrapWitness,
      rolePackInputs: [], unsupportedInputPresent: false });
    expect(sourceSet?.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "context", manifestId: context.packet.manifest!.id }),
      expect.objectContaining({ kind: "task", issueId: task.id }),
    ]));
    expect(sourceSet?.policy.foundationRevisionIds).toEqual([foundation.latestRevisionId]);

    if (!taskCapture) throw new Error("Native bootstrap did not retain its exact Task source capture");
    const [capturedTask] = await db.select({ status: issues.status, title: issues.title }).from(issues)
      .where(and(eq(issues.companyId, seeded.companyId), eq(issues.id, task.id)));
    if (!capturedTask) throw new Error("Native Context captured Task owner is unavailable");
    await db.update(issues).set({ status: capturedTask.status === "in_progress" ? "backlog" : "in_progress",
      updatedAt: new Date() }).where(and(eq(issues.companyId, seeded.companyId), eq(issues.id, task.id)));
    await expect(assertNativeTaskSourceOwnerCurrent(db, { companyId: seeded.companyId,
      actor: assembleInput.authorizationActor, source: taskCapture.input })).resolves.toBeUndefined();
    // The Task body stays current across a status transition, while Context
    // explicitly rendered that old status. Its old witness must be refused.
    await expect(revalidateNativeBootstrapContextWitness(db, { witness: context.nativeBootstrapWitness!,
      companyId: seeded.companyId, runId: run!.id, agentId: seeded.agent.id, issueId: task.id,
      renderedMarkdown: context.markdown,
      manifestIds: [{ companyId: seeded.companyId, contextManifestId: context.packet.manifest!.id }] }))
      .rejects.toMatchObject({ status: 403 });
    context = await contextEngineService(db).assembleNativeBootstrap(assembleInput);
    const contextMemory=await seedMemory({companyId:seeded.companyId,agentId:seeded.agent.id,humanActor:human,
      content:"Enterprise strategy context memory from a directly captured Human Task.",privateSourceTask:true});
    const memoryTaskId=contextMemory.sourceIssueIds[0];
    if(!memoryTaskId)throw new Error("Human Memory source Task was not retained");
    await instanceSettingsService(db).updateExperimental({
      enableContextEngineV1: true, enableCollectiveMemoryV1: true,
    });
    const contextRead=await assembleNativeContextRead(db,{companyId:seeded.companyId,agentId:seeded.agent.id,runId:run!.id,
      issueId:task.id,projectId:null,responsibleUserId:seeded.userId,actor:assembleInput.authorizationActor,
      query:"enterprise strategy"});
    expect(contextRead.witness).toBeDefined();
    expect(contextRead.markdown).toContain(contextMemory.content);
    expect(contextRead.sourceSet.policy.memoryIds).toContain(contextMemory.id);
    const bobId=`memory-bob-${randomUUID()}`;
    const bob=await seedCurrentHumanSourceActor(db,[seeded.companyId],bobId);
    await db.update(companyMemberships).set({membershipRole:"member"}).where(and(eq(companyMemberships.companyId,seeded.companyId),
      eq(companyMemberships.principalType,"user"),eq(companyMemberships.principalId,bobId)));
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId,seeded.companyId),
      eq(principalPermissionGrants.principalType,"user"),eq(principalPermissionGrants.principalId,bobId)));
    await db.insert(principalPermissionGrants).values({companyId:seeded.companyId,principalType:"user",principalId:bobId,
      permissionKey:"company_scope:read"}).onConflictDoNothing();
    expect(await canActorReadMemorySources(db,seeded.companyId,bob,contextMemory.id)).toBe(false);
    expect(contextRead.sourceSet.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({kind:"task",issueId:memoryTaskId}),
      expect.objectContaining({kind:"context",manifestId:contextRead.manifestIds[0]!.contextManifestId}),
    ]));
    expect(contextRead.sourceSet.inputs.filter(value=>value.kind==="task"&&value.issueId===memoryTaskId)).toHaveLength(1);
    expect(contextRead.sourceSet.inputs.filter(value=>value.kind==="context")).toHaveLength(1);
    const contextReadInput={companyId:seeded.companyId,agentId:seeded.agent.id,runId:run!.id,issueId:task.id,
      actor:assembleInput.authorizationActor,sourceSet:contextRead.sourceSet,manifestIds:contextRead.manifestIds};
    await expect(assertNativeContextReadSourceSetCurrent(db,contextReadInput)).resolves.toBeUndefined();
    const taskInput=contextRead.sourceSet.inputs.find(value=>value.kind==="task");
    if(!taskInput||taskInput.kind!=="task")throw new Error("Native Context source Task input is unavailable");
    await expect(assertNativeContextReadSourceSetCurrent(db,{...contextReadInput,sourceSet:{...contextRead.sourceSet,
      inputs:contextRead.sourceSet.inputs.filter(value=>value.kind!=="task")}})).rejects.toMatchObject({status:403});
    await expect(assertNativeContextReadSourceSetCurrent(db,{...contextReadInput,sourceSet:{...contextRead.sourceSet,
      inputs:contextRead.sourceSet.inputs.map(value=>value.kind==="task"?{...value,contentHash:"0".repeat(64)}:value)}}))
      .rejects.toMatchObject({status:403});
    const nestedContextInput=contextRead.sourceSet.inputs.find(value=>value.kind==="context");
    if(!nestedContextInput||nestedContextInput.kind!=="context")throw new Error("Nested Context source is unavailable");
    const overBoundContextInputs=[...contextRead.sourceSet.inputs,...Array.from({length:64},()=>({
      ...nestedContextInput,manifestId:randomUUID()}))];
    await expect(assertNativeContextReadSourceSetCurrent(db,{...contextReadInput,sourceSet:{...contextRead.sourceSet,
      inputs:overBoundContextInputs}})).rejects.toMatchObject({status:403});
    const [outerManifest]=await db.select().from(contextManifests).where(and(eq(contextManifests.companyId,seeded.companyId),
      eq(contextManifests.id,context.packet.manifest!.id)));
    if(!outerManifest)throw new Error("Outer Context manifest is unavailable");
    const outerItems=await db.select().from(contextManifestItems).where(and(eq(contextManifestItems.companyId,seeded.companyId),
      eq(contextManifestItems.manifestId,context.packet.manifest!.id)));
    const nestedSnapshotWitness=captureNativeBootstrapContextWitness({companyId:seeded.companyId,runId:run!.id,
      agentId:seeded.agent.id,issueId:task.id,actor:assembleInput.authorizationActor,renderedMarkdown:context.markdown,
      manifest:outerManifest,items:outerItems.map(item=>{
        if(item.sourceProvider!=="august_works_tasks"||item.sourceRef!==`issue://${task.id}`)return item;
        if(!item.payloadSourceSnapshot||typeof item.payloadSourceSnapshot!=="object"||Array.isArray(item.payloadSourceSnapshot))
          throw new Error("Native Context Task snapshot is unavailable");
        const snapshot=item.payloadSourceSnapshot as {inputs?:unknown[]};
        if(!Array.isArray(snapshot.inputs))throw new Error("Native Context Task snapshot inputs are unavailable");
        const inputs=snapshot.inputs;
        return {...item,payloadSourceSnapshot:{...snapshot,inputs:inputs.some(value=>JSON.stringify(value)===JSON.stringify(nestedContextInput))
          ?inputs:[...inputs,nestedContextInput]}};
      }),roots:[]});
    const nestedWitnessClosure=readNativeBootstrapContextWitness(nestedSnapshotWitness,{companyId:seeded.companyId,runId:run!.id,
      agentId:seeded.agent.id,issueId:task.id,renderedMarkdown:context.markdown,
      manifestIds:[{companyId:seeded.companyId,contextManifestId:context.packet.manifest!.id}]});
    expect(nestedWitnessClosure?.inputs).toContainEqual(nestedContextInput);
    await expect(assertNativeTemporalContextInputsCurrent(db,seeded.companyId,[nestedContextInput])).resolves.toBeUndefined();
    await db.delete(contextManifests).where(and(eq(contextManifests.companyId,seeded.companyId),
      eq(contextManifests.id,nestedContextInput.manifestId)));
    await expect(assertNativeTemporalContextInputsCurrent(db,seeded.companyId,[nestedContextInput])).rejects.toMatchObject({status:403});
    const witnessInput = { witness: context.nativeBootstrapWitness!, companyId: seeded.companyId, runId: run!.id,
      agentId: seeded.agent.id, issueId: task.id, renderedMarkdown: context.markdown,
      manifestIds: [{ companyId: seeded.companyId, contextManifestId: context.packet.manifest!.id }] };
    const [initialTaskItem] = await db.select().from(contextManifestItems).where(and(
      eq(contextManifestItems.manifestId, context.packet.manifest!.id),
      eq(contextManifestItems.sourceProvider, "august_works_tasks"),
      eq(contextManifestItems.sourceRef, `issue://${task.id}`)));
    const [currentTaskOwner] = await db.select().from(issues).where(eq(issues.id, task.id));
    expect(currentTaskOwner!.updatedAt.toISOString(), "refreshed Context Task version remains current")
      .toBe(initialTaskItem!.sourceVersion);
    expect(currentTaskOwner!.payloadSourceSnapshot, "later Context does not alter the original Human Task source")
      .toEqual(initialTaskItem!.payloadSourceSnapshot);
    await expect(revalidateNativeBootstrapContextWitness(db, witnessInput)).resolves.toBeUndefined();
    const changedTitle = `${capturedTask.title} changed after Context capture`;
    await issueService(db).update(task.id, { title: changedTitle, actorUserId: seeded.userId, privacyActor: human });
    const [changedTask] = await db.select({ title: issues.title, snapshot: issues.payloadSourceSnapshot,
      invalidated: issues.payloadSourceSnapshotInvalidated }).from(issues)
      .where(and(eq(issues.companyId, seeded.companyId), eq(issues.id, task.id)));
    expect(changedTask).toMatchObject({ title: changedTitle, snapshot: null, invalidated: true });
    await expect(assertNativeTaskSourceOwnerCurrent(db, { companyId: seeded.companyId,
      actor: assembleInput.authorizationActor, source: taskCapture.input })).rejects.toMatchObject({ status: 403 });
    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, seeded.companyId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, seeded.userId)));
    await expect(revalidateNativeBootstrapContextWitness(db, witnessInput)).rejects.toMatchObject({ status: 403 });
    await expect(contextEngineService(db).assembleNativeBootstrap(assembleInput)).rejects.toMatchObject({ status: 403 });
    await seedCurrentHumanSourceActor(db, [seeded.companyId], seeded.userId);
    await issueService(db).remove(task.id);
    await expect(revalidateNativeBootstrapContextWitness(db, witnessInput)).rejects.toMatchObject({ status: 403 });
  });

  it("preserves an original Human Task source across status changes and rejects it after a canonical body edit", async () => {
    const seeded = await seed();
    const human = await seedCurrentHumanSourceActor(db, [seeded.companyId], seeded.userId);
    const task = await issueService(db).create(seeded.companyId, {
      title: "Human source Task for currentness", description: "The original captured body.",
      createdByUserId: seeded.userId, responsibleUserId: seeded.userId, assigneeAgentId: seeded.agent.id,
    }, db, undefined, { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const captureHolder: { value: NativeTaskSourceCapture | null } = { value: null };
    const selected = await getIssueExecutionContext(db, seeded.companyId, task.id, capture => { captureHolder.value = capture; });
    const capture = captureHolder.value;
    if (!selected || !capture?.payloadSourceSnapshot) throw new Error("Canonical Human Task source capture is unavailable");
    const actor = { type: "agent" as const, source: "none" as const, companyId: seeded.companyId,
      agentId: seeded.agent.id, runId: seeded.run.id, onBehalfOfUserId: seeded.userId };
    await issueService(db).update(task.id, { status: "in_progress", actorUserId: seeded.userId, privacyActor: human });
    await expect(assertNativeTaskSourceOwnerCurrent(db, { companyId: seeded.companyId, actor, source: capture.input }))
      .resolves.toBeUndefined();
    const editedTitle = `${task.title} edited by its Human owner`;
    await issueService(db).update(task.id, { title: editedTitle, actorUserId: seeded.userId, privacyActor: human });
    const [current] = await db.select({ title: issues.title, snapshot: issues.payloadSourceSnapshot,
      invalidated: issues.payloadSourceSnapshotInvalidated }).from(issues)
      .where(and(eq(issues.companyId, seeded.companyId), eq(issues.id, task.id)));
    expect(current).toMatchObject({ title: editedTitle, snapshot: null, invalidated: true });
    await expect(assertNativeTaskSourceOwnerCurrent(db, { companyId: seeded.companyId, actor, source: capture.input }))
      .rejects.toMatchObject({ status: 403 });
  });

  it("retrieves only issue-authorized synced GitHub evidence into the governed Context packet", async () => {
    const seeded = await seed();
    const now = new Date("2026-09-29T12:01:00.000Z");

    const [linked] = await db.insert(externalObjects).values({
      companyId: seeded.companyId,
      providerKey: "github",
      objectType: "issue",
      externalId: "augustkring/august-works#issues/42",
      sanitizedCanonicalUrl:
        "https://github.com/augustkring/august-works/issues/42",
      displayKey: "GitHub Issue",
      displayTitle: "augustkring/august-works#42: Critical billing bug",
      statusKey: "open",
      statusLabel: "Open",
      statusCategory: "open",
      statusTone: "info",
      liveness: "fresh",
      isTerminal: false,
      data: {
        state: "open",
        authorLogin: "maintainer",
      },
      remoteVersion: "2026-09-29T12:00:00.000Z",
      etag: "\"issue-42\"",
      lastResolvedAt: now,
      lastChangedAt: new Date("2026-09-29T12:00:00.000Z"),
      nextRefreshAt: new Date("2026-09-29T12:06:00.000Z"),
      updatedAt: now,
    }).returning();

    await db.insert(externalObjectMentions).values({
      companyId: seeded.companyId,
      sourceIssueId: seeded.issue.id,
      sourceKind: "description",
      sourceRecordId: null,
      documentKey: null,
      propertyKey: null,
      matchedTextRedacted:
        "https://github.com/augustkring/august-works/issues/42",
      sanitizedDisplayUrl:
        "https://github.com/augustkring/august-works/issues/42",
      canonicalIdentityHash: "linked-github-42",
      canonicalIdentity: {
        scheme: "https",
        host: "github.com",
        path: "/augustkring/august-works/issues/42",
      },
      objectId: linked!.id,
      providerKey: "github",
      detectorKey: "github",
      objectType: "issue",
      confidence: "exact",
    });

    const [otherIssue] = await db.insert(issues).values({
      companyId: seeded.companyId,
      title: "Unrelated issue",
      description: "A separate task.",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: seeded.agent.id,
      responsibleUserId: seeded.userId,
    }).returning();
    const [unrelated] = await db.insert(externalObjects).values({
      companyId: seeded.companyId,
      providerKey: "github",
      objectType: "issue",
      externalId: "augustkring/august-works#issues/99",
      sanitizedCanonicalUrl:
        "https://github.com/augustkring/august-works/issues/99",
      displayKey: "GitHub Issue",
      displayTitle: "augustkring/august-works#99: Critical billing bug unrelated",
      statusKey: "open",
      statusLabel: "Open",
      statusCategory: "open",
      statusTone: "info",
      liveness: "fresh",
      isTerminal: false,
      data: { state: "open" },
      remoteVersion: "2026-09-29T12:00:00.000Z",
      etag: "\"issue-99\"",
      lastResolvedAt: now,
      lastChangedAt: now,
      nextRefreshAt: new Date("2026-09-29T12:06:00.000Z"),
      updatedAt: now,
    }).returning();
    await db.insert(externalObjectMentions).values({
      companyId: seeded.companyId,
      sourceIssueId: otherIssue!.id,
      sourceKind: "description",
      sourceRecordId: null,
      documentKey: null,
      propertyKey: null,
      matchedTextRedacted:
        "https://github.com/augustkring/august-works/issues/99",
      sanitizedDisplayUrl:
        "https://github.com/augustkring/august-works/issues/99",
      canonicalIdentityHash: "unrelated-github-99",
      canonicalIdentity: {
        scheme: "https",
        host: "github.com",
        path: "/augustkring/august-works/issues/99",
      },
      objectId: unrelated!.id,
      providerKey: "github",
      detectorKey: "github",
      objectType: "issue",
      confidence: "exact",
    });

    const result = await contextEngineService(db).assemble({
      runId: seeded.run.id,
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      responsibleUserId: seeded.userId,
      issueId: seeded.issue.id,
      query: "critical billing bug",
      includeFoundation: false,
      sensitivityCeiling: "internal",
      asOf: new Date("2026-09-29T12:02:00.000Z"),
      totalDeadlineMs: 3_000,
    });

    expect(result.packet.connectedEvidence).toEqual([
      expect.objectContaining({
        sourceClass: "external_untrusted",
        sourceProvider: "github",
        sourceType: "github_issue",
        sourceRef:
          "https://github.com/augustkring/august-works/issues/42",
        title: "augustkring/august-works#42: Critical billing bug",
        sourceVersion: "2026-09-29T12:00:00.000Z",
        trustLevel: "untrusted",
        metadata: expect.objectContaining({
          syncMode: "synced",
          tombstone: false,
          freshness: "fresh",
          aclFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    ]);
    expect(JSON.stringify(result.packet.connectedEvidence)).not.toContain(
      "issues/99",
    );

    const manifestItems = await db
      .select()
      .from(contextManifestItems);
    expect(manifestItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceClass: "external_untrusted",
          sourceProvider: "github",
          sourceRef:
            "https://github.com/augustkring/august-works/issues/42",
        }),
      ]),
    );
    expect(JSON.stringify(manifestItems)).not.toContain("Critical billing bug");
  });


  it("keeps Memory hydration disabled until Memory flags are enabled", async () => {
    const seeded = await seedContextOwners();
    await seedMemory({
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      content: "Enterprise launch memory should remain disabled.",
    });
    const nativeRuns: Array<{ id: string; actor: AuthorizationActor; issueId: string }> = [];
    await seedMemory({ companyId: seeded.companyId, agentId: seeded.agent.id, scope: "agent",
      content: "Enterprise launch private Memory remains disabled.",
      sourceTaskBody: "Enterprise launch source task for the disabled Memory control.",
      onNativeRun: run => { nativeRuns.push(run); } });
    const nativeRun = nativeRuns[0];
    if (!nativeRun) throw new Error("Canonical disabled-Memory source run is unavailable");

    const result = await contextEngineService(db).assemble({
      runId: nativeRun.id,
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      responsibleUserId: seeded.userId,
      issueId: nativeRun.issueId,
      authorizationActor: nativeRun.actor,
      query: "enterprise launch",
      includeFoundation: false,
      totalDeadlineMs: 3_000,
    });

    expect(result.packet.sharedMemory).toEqual([]);
    expect(result.packet.privateMemory).toEqual([]);
    expect(result.markdown).not.toContain("memory should remain disabled");
  });

  it("hydrates only eligible relevant shared and owner-private Memory into Context", async () => {
    const seeded = await seedContextOwners();
    await instanceSettingsService(db).updateExperimental({
      enableCollectiveMemoryV1: true,
      enablePrivateAgentMemoryV1: true,
    });

    const shared = await seedMemory({
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      content: "Enterprise launch works best with a staged security review.",
      verificationState: "human_verified",
    });
    expect(shared.payloadSourceProtocolVersion).toBe(1);
    expect(shared.payloadSourceSnapshot).toMatchObject({
      version: 1,
      owner: { kind: "memory_record", companyId: seeded.companyId, id: shared.id },
      policy: { issueIds: shared.sourceIssueIds },
      inputs: [expect.objectContaining({ kind: "task", issueId: shared.sourceIssueIds[0] })],
    });
    const nativeRuns: Array<{ id: string; actor: AuthorizationActor; issueId: string }> = [];
    const privateRecord = await seedMemory({
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      scope: "agent",
      content: "Enterprise launch follow-ups should name the decision owner.",
      verificationState: "unverified",
      onNativeRun: run => { nativeRuns.push(run); },
    });
    const nativeRun = nativeRuns[0];
    if (!nativeRun) throw new Error("Canonical private Memory producer did not retain its exact Agent run authority");
    const otherHuman = await seedCurrentHumanSourceActor(db, [seeded.companyId], seeded.userId);
    const otherAgent = await createContextPresence(seeded.companyId, otherHuman, "Other Context Agent");
    const otherPrivate = await seedMemory({
      companyId: seeded.companyId,
      agentId: otherAgent!.id,
      scope: "agent",
      content: "Enterprise launch other-agent private memory must not hydrate.",
      verificationState: "unverified",
    });
    await seedMemory({
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      content: "Enterprise launch pending memory must not hydrate.",
      reviewState: "pending",
    });
    await seedMemory({
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      content: "Enterprise launch revoked memory must not hydrate.",
      revokedAt: new Date("2026-09-30T12:30:00.000Z"),
    });
    const expiredMemory = await seedMemory({
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      content: "Enterprise launch expired memory must not hydrate.",
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    expect(expiredMemory.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    await expireMemoryPayloads(db, seeded.companyId, new Date(Date.now() + 60 * 60_000));
    await seedMemory({
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      content: "Enterprise launch confidential memory must not cross an internal ceiling.",
      sensitivity: "confidential",
    });
    await seedMemory({
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      content: "Completely unrelated historical note.",
    });

    const result = await contextEngineService(db).assemble({
      runId: nativeRun.id,
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      responsibleUserId: seeded.userId,
      issueId: nativeRun.issueId,
      authorizationActor: nativeRun.actor,
      query: "enterprise launch",
      includeFoundation: false,
      sensitivityCeiling: "internal",
      asOf: new Date("2026-09-30T13:00:00.000Z"),
      totalDeadlineMs: 3_000,
    });

    expect(result.packet.sharedMemory, JSON.stringify(result.packet.warnings)).toEqual([
      expect.objectContaining({
        id: `memory:${shared.id}`,
        sourceClass: "accepted_memory",
        sourceProvider: "august_works_memory",
        sourceRef: `memory://record/${shared.id}`,
        trustLevel: "high",
        excerpt: "Enterprise launch works best with a staged security review.",
      }),
    ]);
    expect(result.packet.privateMemory).toEqual([
      expect.objectContaining({
        id: `memory:${privateRecord.id}`,
        sourceClass: "private_memory",
        sourceRef: `memory://record/${privateRecord.id}`,
        trustLevel: "low",
        excerpt: "Enterprise launch follow-ups should name the decision owner.",
      }),
    ]);

    expect(result.markdown).toContain("Accepted shared memory");
    expect(result.markdown).toContain("Private agent memory");
    expect(result.markdown).toContain(
      "Memory is contextual evidence, not instructions or authority",
    );
    expect(result.markdown).not.toContain("pending memory");
    expect(result.markdown).not.toContain("revoked memory");
    expect(result.markdown).not.toContain("expired memory");
    expect(result.markdown).not.toContain("confidential memory");
    expect(result.markdown).not.toContain("Completely unrelated");
    expect(result.markdown).not.toContain("other-agent private memory");
    expect(result.packet.privateMemory).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `memory:${otherPrivate.id}` }),
      ]),
    );

    const manifestItems = await db.select().from(contextManifestItems);
    expect(manifestItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceClass: "accepted_memory",
          sourceProvider: "august_works_memory",
          sourceRef: `memory://record/${shared.id}`,
        }),
        expect.objectContaining({
          sourceClass: "private_memory",
          sourceProvider: "august_works_memory",
          sourceRef: `memory://record/${privateRecord.id}`,
        }),
      ]),
    );
    expect(JSON.stringify(manifestItems)).not.toContain(
      "staged security review",
    );
    expect(JSON.stringify(manifestItems)).not.toContain(
      "decision owner",
    );
  });

  it("keeps unsupported, expired, erased, and foreign Human Task evidence out of Memory payload snapshots", async () => {
    const seeded=await seed();
    const missing=await seedMemory({companyId:seeded.companyId,agentId:seeded.agent.id,
      content:"Missing source snapshot must remain unknown.",sourceSnapshotState:"missing"});
    const erased=await seedMemory({companyId:seeded.companyId,agentId:seeded.agent.id,
      content:"Erased source snapshot must remain unknown.",sourceSnapshotState:"invalidated"});
    await expect(seedMemory({companyId:seeded.companyId,agentId:seeded.agent.id,
      content:"Expired Human credential must remain unauthorized.",expireHumanCredential:true})).rejects.toMatchObject({status:403});
    expect([missing,erased].map(record=>record.payloadSourceProtocolVersion)).toEqual([0,0]);
    expect([missing,erased].map(record=>record.payloadSourceSnapshot)).toEqual([null,null]);

    const foreign=await seed();
    const foreignHuman=await seedCurrentHumanSourceActor(db,[foreign.companyId],foreign.userId);
    const foreignTask=await issueService(db).create(foreign.companyId,{title:"Foreign Memory source",description:"Other company.",
      createdByUserId:foreign.userId,responsibleUserId:foreign.userId},
      db,undefined,{manualInputActor:foreignHuman,privacyActor:foreignHuman,sourceAccessActor:foreignHuman});
    await expect(seedMemory({companyId:seeded.companyId,agentId:seeded.agent.id,content:"Foreign source must be denied.",
      foreignSource:{id:foreignTask.id,updatedAt:foreignTask.updatedAt,identifier:foreignTask.identifier??"FOREIGN",
        title:foreignTask.title??"Foreign Memory source"}}))
      .rejects.toMatchObject({status:403});
  });

  it("omits Foundation without foundation:read but still admits authorized task context", async () => {
    const seeded = await seedContextOwners();
    await createApprovedFoundation({
      companyId: seeded.companyId,
      userId: seeded.userId,
      key: "enterprise-strategy",
      body: "# Enterprise strategy\nEnterprise strategy prioritizes durable customer value.",
      sensitivity: "internal",
    });

    const nativeRuns: Array<{ id: string; actor: AuthorizationActor; issueId: string }> = [];
    await seedMemory({ companyId: seeded.companyId, agentId: seeded.agent.id, humanActor: seeded.humanActor,
      content: "Enterprise strategy context for the native source reader.", scope: "agent",
      sourceTaskBody: "Enterprise strategy source task for the current native run.",
      onNativeRun: run => { nativeRuns.push(run); } });
    const nativeRun = nativeRuns[0];
    if (!nativeRun) throw new Error("Canonical native producer did not expose its exact run authority");
    const sourceIssueId = nativeRun.issueId;

    // No fixture renewal may restore the grant whose absence this case tests.
    expect(await db.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants).where(and(
      eq(principalPermissionGrants.companyId, seeded.companyId), eq(principalPermissionGrants.principalType, "user"),
      eq(principalPermissionGrants.principalId, seeded.userId), eq(principalPermissionGrants.permissionKey, "foundation:read"),
    ))).toHaveLength(0);

    const result = await contextEngineService(db).assemble({
      runId: nativeRun.id,
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      responsibleUserId: seeded.userId,
      issueId: sourceIssueId,
      authorizationActor: nativeRun.actor,
      query: "enterprise strategy",
      sensitivityCeiling: "internal",
      totalDeadlineMs: 3_000,
    });

    expect(result.packet.foundation).toEqual([]);
    expect(result.packet.taskContext).toHaveLength(1);
    expect(result.packet.warnings).toEqual([
      expect.objectContaining({
        providerKey: "foundation",
        code: "permission_denied",
      }),
    ]);
    expect(result.markdown).not.toContain("durable customer value");
  });

  it("enforces the represented human's source permission for V5 even in shadow mode", async () => {
    const seeded = await seed();
    await db.insert(principalPermissionGrants).values({ companyId: seeded.companyId, principalType: "agent", principalId: seeded.agent.id, permissionKey: "foundation:read", scope: null });
    await createApprovedFoundation({ companyId: seeded.companyId, userId: seeded.userId, key: "enterprise-strategy", body: "# Enterprise strategy\nEnterprise strategy requires confidential source permission.", sensitivity: "internal" });
    const priorMode = process.env.PAPERCLIP_RESPONSIBLE_USER_AUTHZ_MODE;
    process.env.PAPERCLIP_RESPONSIBLE_USER_AUTHZ_MODE = "shadow";
    try {
      const result = await contextEngineService(db).assemble({ runId:seeded.run.id, companyId: seeded.companyId, agentId: seeded.agent.id, responsibleUserId: seeded.userId, query: "enterprise strategy", enforceResponsibleUserIntersection: true });
      expect(result.packet.foundation).toEqual([]);
      expect(result.markdown).not.toContain("requires confidential source permission");
    } finally {
      if (priorMode === undefined) delete process.env.PAPERCLIP_RESPONSIBLE_USER_AUTHZ_MODE;
      else process.env.PAPERCLIP_RESPONSIBLE_USER_AUTHZ_MODE = priorMode;
    }
  });
});
