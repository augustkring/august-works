import { agentRetirementService } from "../services/agents/retirement.js";
import { agentIdentityService } from "../services/agent-identities.js";
import { agentService } from "../services/agents.js";
import { agentAuthoringPublicationService } from "../services/agents/authoring-publication.js";
import { agentAuthoringPackageSetupService } from "../services/agents/authoring-package-setup.js";
import { buildRetainedNativeRuntimeContext, readNativeRuntimeAssetText } from "../services/native-runtime/runtime-context.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { agentConfigRevisions, agentExecutionManifests, memoryJobs, activityLog, agentConfigurationDrafts, agentConfigurationTests, agents, authUsers, billingAccounts, billingAccountCompanies, companyMemberships, companySkills, companySkillVersions, createDb, documents, heartbeatRuns, orchestrationPlans, orchestrationModelReservations, orchestrationWorkers, toolInvocations, verificationRuns } from "@paperclipai/db";
import { agentAuthoringContentSchema, type AgentAuthoringDraftView, type AgentDraftTestCommand, AUTHORED_AGENT_DEFINITION_KEY, agentDraftPublicationCommandSchema, type AgentDraftPublicationCommand, type VerificationReviewInput } from "@paperclipai/shared";
import { agentAuthoringService } from "../services/agents/authoring-drafts.js";
import { agentAuthoringTestService } from "../services/agents/authoring-tests.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { discoverNativeCapabilities } from "../services/native-provider-conformance.js";
import { providerConformanceRequirements, makeProviderCapabilitySnapshot } from "../services/provider-capabilities.js";
import { hashContextPolicySnapshot } from "../services/context/context-manifest.js";
import { workerModelGateway } from "../services/orchestration/worker-model-gateway.js";
import { registerNativeDraftGateway } from "../services/orchestration/native-draft-runtime.js";
import type { WorkerModelProfile } from "../services/orchestration/worker-model-profiles.js";
import type { guardedRemoteHttpFetch } from "../services/remote-http-fetch.js";
import { documentService } from "../services/documents.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { budgetService } from "../services/budgets.js";
import { heartbeatService } from "../services/heartbeat.js";
import { reconcileAgentDraftTest } from "../services/agents/authoring-test-recovery.js";
import { heartbeatMemoryPayloadRetained, reapplyMemoryDeletionMarkers } from "../services/memory/memory-privacy.js";
import { memoryJobService } from "../services/memory/memory-jobs.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { seedRequiredAuthoringProcedures, seedApprovedAuthoringPlaybook, bindAuthoringPlaybook, grantAuthoringPlaybookReadFixture } from "./helpers/authoring-procedures.js";
import { prepareHirePublicationFixture } from "./helpers/hire-publication.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport(), sourceSha = "a".repeat(40);
(support.supported ? describe : describe.skip)("C3 publication with Original versions, Native evidence and Source erasure", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, home: string;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, draft: AgentAuthoringDraftView, profile: WorkerModelProfile, calls: number;
  let requiredProcedures: Awaited<ReturnType<typeof seedRequiredAuthoringProcedures>>;
  let requiredPlaybook: Awaited<ReturnType<typeof seedApprovedAuthoringPlaybook>> | undefined;
  let duringCall: (() => Promise<void>) | undefined, lostResponse: boolean, excessUsage: boolean;
  const service = () => agentAuthoringTestService(db), drafts = () => agentAuthoringService(db);
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "aw-v9-publication-private-")); vi.stubEnv("PAPERCLIP_HOME", home);
    database = await startEmbeddedPostgresTestDatabase("aw-v9-publication-db-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => { registerNativeDraftGateway(db, undefined); await database?.cleanup(); vi.unstubAllEnvs(); if (home) await rm(home, { recursive: true, force: true }); }, 30000);
  const transport: typeof guardedRemoteHttpFetch = async (url, init) => {
    calls++; expect(String(url)).toBe("https://api.anthropic.com/v1/messages"); expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("x-api-key")).toBe(`private-safe-test-key-${f.presence.id}`);
    const body = JSON.parse(String(init.body)); expect(body.tools).toBeUndefined(); expect(body.stream).toBe(false);
    for (const procedure of requiredProcedures) expect(body.messages[0].content[0].text).toContain(procedure.body);
    if (requiredPlaybook) expect(body.messages[0].content[0].text).toContain(requiredPlaybook.body);
    expect(String(init.body)).toContain("Produce a short internal welcome draft"); expect(String(init.body)).toContain("Do not contact anyone");
    const [test] = await db.select().from(agentConfigurationTests).where(eq(agentConfigurationTests.companyId, f.home))
      .orderBy(desc(agentConfigurationTests.createdAt), desc(agentConfigurationTests.id)).limit(1);
    const [debit] = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, test!.planId));
    expect(debit).toMatchObject({ purpose: "agent_safe_test", status: "dispatched", maximumMinor: 3, workerId: null, workerAttemptId: null });
    if (duringCall) await duringCall();
    if (lostResponse) throw new Error("private transport response was lost");
    return new Response(JSON.stringify({ type: "message", role: "assistant", model: body.model, stop_reason: "end_turn",
      content: [{ type: "text", text: "Welcome to the team. This is an internal draft for review." }],
      usage: { input_tokens: excessUsage ? 1001 : 20, output_tokens: 12 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  async function configureRuntime() {
    const config = { provider: "aw_text_only", model: "fixture-draft-model", workerModelProfileId: randomUUID(), maxOutputTokens: 256 };
    await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: config, status: "paused", pauseReason: "manual" }).where(eq(agents.id, f.presence.id));
    const providers = agentProviderBindingService(db), pb = await providers.create(f.actor, f.home, f.presence.id,
      { providerType: "paperclip_native", providerAgentRef: f.presence.id, isolationMode: "isolated_per_presence", providerEndpointRef: null });
    const runtime = await providers.attach(f.actor, f.home, f.presence.id, { providerBindingId: pb.id, providerProfileRef: `private:${f.presence.id}` });
    const snapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId: f.home, adapterType: "paperclip_runner", config }));
    // Software metadata fixture through the Original owner; this is not live
    // provider conformance evidence or a GA qualification claim.
    await providers.recordDiscovery(f.home, f.presence.id, snapshot,
      Object.fromEntries(providerConformanceRequirements(snapshot, pb.isolationMode).map(check => [check, true])),
      { configurationHash: hashContextPolicySnapshot({ adapterType: "paperclip_runner", adapterConfig: config }), runtimeId: runtime.id,
        profileRef: runtime.providerProfileRef, bindingId: pb.id, accountingComplete: true });
    const connection = await aiConnectionService(db).save(f.home, f.userId, { provider: "anthropic", method: "api_key", ownership: "shared",
      name: "Private test model", apiKey: "fixture", allAgents: false, agentIds: [f.presence.id] }, `private-safe-test-key-${f.presence.id}`);
    profile = { id: config.workerModelProfileId, companyId: f.home, workerAgentId: f.presence.id, providerBindingId: pb.id,
      providerSnapshotHash: snapshot.hash, providerProfileRef: runtime.providerProfileRef,
      qualifiedConfigurationHash: hashContextPolicySnapshot({ adapterType: "paperclip_runner", adapterConfig: config }),
      binding: { provider: "anthropic", method: "api_key", mode: "shared", ...connection }, transport: "server-text-only-v1",
      contract: "anthropic-text-messages-2023-06-01", maximumEnvelopeBytes: 64000, inputTokensUpperBound: 1000, maxOutputTokens: 256,
      tariff: { provider: "anthropic", model: config.model, currency: "USD", fixedMinor: 3, inputMinorPerMillion: 0, outputMinorPerMillion: 0,
        sourceSha, qualificationHash: "b".repeat(64), testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString() },
      qualificationEvidenceRef: "https://protected.test.invalid/qualification/safe-test-fixture", qualificationArtifactSha256: "c".repeat(64) };
    registerNativeDraftGateway(db, workerModelGateway(db, { profiles: [profile], sourceSha, protectedEvidenceOrigin: "https://protected.test.invalid", fetch: transport }));
    return runtime;
  }
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true,
      hire_agent_v9: true, enableWorkflowsV1: true, orchestration_v7: true, supervision_v7: true, readiness_engine_v7: true, verifier_v7: true });
    f = await seedV5Presences(db);
    requiredProcedures = await seedRequiredAuthoringProcedures(db, f.actor, f.home, f.presence.id);
    calls = 0; duringCall = undefined; lostResponse = false; excessUsage = false; requiredPlaybook = undefined;
    const runtime = await configureRuntime();
    const initial = await drafts().create(f.actor, f.home, { requestId: randomUUID(), agentId: f.presence.id });
    draft = await drafts().save(f.actor, f.home, initial.id, { requestId: randomUUID(), expectedVersion: initial.version, step: "test",
      content: agentAuthoringContentSchema.parse({ name: "Welcome specialist", description: "Creates internal welcome drafts", ownerUserId: f.userId,
        outcome: "Produce a short internal welcome draft", capabilities: [{ operation: "create_internal_draft", autonomy: "automatic" }], runtimeBindingId: runtime.id, scenarios: ["Produce a short internal welcome draft"],
        instructions: { purpose: "Prepare an internal draft", responsibilities: "Draft a friendly welcome", prohibited: "Do not contact anyone",
          missingInformation: "Ask the owner", escalation: "Ask the owner before any other action", communication: "Use concise language" } }) });
  });
  async function command(): Promise<AgentDraftTestCommand> {
    const reviewed = await service().review(f.actor, f.home, draft.id, 0);
    expect(reviewed).toMatchObject({ maximumCostMinor: 3, currency: "USD", companyVisibleResult: true, toolsGranted: false, activatesAgent: false });
    expect(JSON.stringify(reviewed)).not.toContain("private-safe-test-key");
    if (requiredPlaybook) expect(reviewed.requiredPlaybooks).toEqual([{ playbookId: requiredPlaybook.playbookId,
      revisionId: requiredPlaybook.revisionId, name: requiredPlaybook.name, bodyHash: expect.any(String) }]);
    return { requestId: randomUUID(), expectedVersion: draft.version, scenarioIndex: 0, expectedReviewHash: reviewed.reviewHash,
      confirmRepresentativeTest: true, confirmCompanyVisibleResult: true };
  }
  async function execute() { const input = await command(); return { input, result: await service().start(f.actor, f.home, draft.id, input) }; }
  async function reviewInput(requestId: string): Promise<VerificationReviewInput> {
    const packet = await service().packet(f.actor, f.home, draft.id, requestId), refs = packet.evidence.map(evidence => evidence.ref);
    expect(packet.policy.humanRequired).toBe(true); expect(packet.deterministicFailures).toEqual([]);
    return { expectedPlanVersion: packet.planVersion, expectedResultHash: packet.resultHash, workerId: null, result: "pass",
      objectiveSatisfied: true, explicitHighImpactApproval: true, rationale: "I compared the generated draft with every saved requirement.",
      businessInvariants: packet.contract.businessInvariants.map((_, index) => ({ index, satisfied: true, evidenceRefs: refs })),
      evidenceRequirements: packet.contract.evidenceRequirements.map((_, index) => ({ index, satisfied: true, evidenceRefs: refs })),
      prohibitedOutcomes: packet.contract.prohibitedOutcomes.map((_, index) => ({ index, satisfied: true, evidenceRefs: refs })) };
  }
  const publications = () => agentAuthoringPublicationService(db);
  async function qualify() {
    const { input, result } = await execute();
    await service().verify(f.actor, f.home, draft.id, input.requestId, await reviewInput(input.requestId));
    return result;
  }
  async function publicationCommand(): Promise<AgentDraftPublicationCommand> {
    const reviewed = await publications().review(f.actor, f.home, draft.id);
    expect(reviewed.blockers).toEqual([]);
    expect(reviewed).toMatchObject({ canPublish: true, activate: true, modelCalled: false, authorityGranted: false, executionStarted: false, maximumPerModelCallMinor: 3 });
    if (requiredPlaybook) expect(reviewed.requiredPlaybooks).toEqual([{ playbookId: requiredPlaybook.playbookId,
      revisionId: requiredPlaybook.revisionId, name: requiredPlaybook.name, bodyHash: expect.any(String) }]);
    return { requestId: randomUUID(), expectedVersion: draft.version, expectedReviewHash: reviewed.reviewHash,
      activate: true, confirmPublication: true, confirmActivation: true };
  }
  async function publish() { return publications().publish(f.actor, f.home, draft.id, await publicationCommand()); }
  async function agent() { return (await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]!; }
  it("publishes the exact verified candidate once and recovers its Original receipt without another model call", async () => {
    await qualify(); const input = await publicationCommand();
    const runCount = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).length;
    const [first, repeated] = await Promise.all([publications().publish(f.actor, f.home, draft.id, input), publications().publish(f.actor, f.home, draft.id, input)]);
    expect(first).toEqual(repeated); expect(first).toMatchObject({ revisionId: input.requestId, publishedVersion: 1, activatedAtPublication: true, authorityGranted: false, executionStarted: false });
    const current = await agent(); expect(current).toMatchObject({ name: draft.content!.name, status: "idle", pauseReason: null });
    expect((current.runtimeConfig as Record<string, any>)[AUTHORED_AGENT_DEFINITION_KEY]).toMatchObject({ version: 1, content: draft.content, publication: { draftId: draft.id, requestedByUserId: f.userId } });
    expect(await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.id, input.requestId))).toHaveLength(1);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).toHaveLength(runCount);
    expect(calls).toBe(1); expect(await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, f.home))).toEqual([]);
    const published = draft.content!;
    draft = await drafts().save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: draft.version, step: "review", content: { ...published, internalDescription: "Later private edits" } });
    expect(first.publishedContent).toEqual(published);
    expect(await publications().receipt(f.actor, f.home, draft.id)).toEqual(first);
    await instanceSettingsService(db).updateExperimental({ hire_agent_v9: false });
    expect(await publications().receipt(f.actor, f.home, draft.id, input.requestId)).toEqual(first);
    await expect(publications().publish(f.actor, f.home, draft.id, input)).rejects.toMatchObject({ status: 404 });
  });
  it("requires independent verification, both confirmations and an exact current review", async () => {
    await execute();
    const unverified = await publications().review(f.actor, f.home, draft.id);
    expect(unverified.canPublish).toBe(false); expect(unverified.blockers.map(item => item.code)).toContain("representative_test_unqualified");
    await qualify(); const input = await publicationCommand();
    for (const key of ["confirmPublication", "confirmActivation"] as const) expect(agentDraftPublicationCommandSchema.safeParse({ ...input, [key]: false }).success).toBe(false);
    await expect(publications().publish(f.actor, f.home, draft.id, { ...input, expectedReviewHash: "0".repeat(64) })).rejects.toMatchObject({ status: 409 });
    await db.update(companySkills).set({ lifecycleState: "revoked" }).where(eq(companySkills.id, requiredProcedures[0]!.skillId));
    await expect(publications().publish(f.actor, f.home, draft.id, input)).rejects.toMatchObject({ status: 409 });
    expect((await agent()).runtimeConfig).not.toHaveProperty(AUTHORED_AGENT_DEFINITION_KEY);
    expect(await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.id, input.requestId))).toEqual([]);
  });
  it("keeps the published version active during subsequent draft editing and testing", async () => {
    await qualify(); const first = await publish(), v1 = (await agent()).runtimeConfig;
    const next = await drafts().create(f.actor, f.home, { requestId: randomUUID(), agentId: f.presence.id });
    expect(next.content).toEqual(draft.content);
    draft = await drafts().save(f.actor, f.home, next.id, { requestId: randomUUID(), expectedVersion: next.version, step: "test",
      content: { ...next.content!, internalDescription: "New draft still awaiting separate publication" } });
    expect((await agent()).runtimeConfig).toEqual(v1);
    await qualify(); expect((await agent()).runtimeConfig).toEqual(v1);
    const second = await publish(); expect(second.publishedVersion).toBe(2);
    expect(await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.id, first.revisionId))).toHaveLength(1);
    expect((await agent()).runtimeConfig).not.toEqual(v1); expect(calls).toBe(2);
  });
  it("refuses replacement while a run is queued and respects the Original budget pause", async () => {
    await qualify(); const input = await publicationCommand();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId, status: "queued" }).returning();
    expect((await publications().review(f.actor, f.home, draft.id)).blockers.map(item => item.code)).toContain("publication_work_in_flight");
    await expect(publications().publish(f.actor, f.home, draft.id, input)).rejects.toMatchObject({ status: 409 });
    await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, run!.id));
    await db.update(agents).set({ status: "paused", pauseReason: "budget" }).where(eq(agents.id, f.presence.id));
    expect((await publications().review(f.actor, f.home, draft.id)).canPublish).toBe(false);
    expect((await agent()).runtimeConfig).not.toHaveProperty(AUTHORED_AGENT_DEFINITION_KEY);
  });
  it("protects active versions and Original history against raw database mutation", async () => {
    await qualify(); const receipt = await publish();
    await expect(db.update(agents).set({ name: "Unversioned replacement" }).where(eq(agents.id, f.presence.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(agents).set({ runtimeConfig: {} }).where(eq(agents.id, f.presence.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(agents).set({ permissions: { canCreateAgents: true } }).where(eq(agents.id, f.presence.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(agentConfigRevisions).set({ afterConfig: {} }).where(eq(agentConfigRevisions.id, receipt.revisionId))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.delete(agentConfigRevisions).where(eq(agentConfigRevisions.id, receipt.revisionId))).rejects.toMatchObject({ cause: { code: "23514", message: "agent_authored_active_revision_readonly" } });
    expect(await publications().receipt(f.actor, f.home, draft.id, receipt.requestId)).toEqual(receipt);
  });
  it("keeps request receipts scoped to their exact draft, actor, company and command", async () => {
    const test = await qualify(), input = await publicationCommand();
    await expect(publications().publish(f.actor, f.home, draft.id, { ...input, requestId: test.requestId })).rejects.toMatchObject({ status: 409 });
    const first = await publications().publish(f.actor, f.home, draft.id, input);
    await expect(publications().publish(f.actor, f.home, draft.id, { ...input, expectedVersion: input.expectedVersion + 1 })).rejects.toMatchObject({ status: 409 });
    await expect(publications().receipt(f.actor, f.guest, draft.id, input.requestId)).rejects.toMatchObject({ status: 404 });
    expect(await publications().receipt(f.actor, f.home, draft.id, input.requestId)).toEqual(first);
  });
  it("allows Original retirement to withdraw permissions while preserving the identified version", async () => {
    await db.update(agents).set({ permissions: { canCreateAgents: true } }).where(eq(agents.id, f.presence.id));
    // Refresh the Original draft baseline after this explicit software setup.
    const next = await drafts().create(f.actor, f.home, { requestId: randomUUID(), agentId: f.presence.id });
    draft = await drafts().save(f.actor, f.home, next.id, { requestId: randomUUID(), expectedVersion: next.version, step: "test", content: draft.content! });
    await qualify(); await publish(); const before = (await agent()).runtimeConfig;
    await agentIdentityService(db).rehome(f.actor, f.home, f.identity.id, f.guest);
    await agentService(db).pause(f.presence.id);
    const retirements = agentRetirementService(db), reviewed = await retirements.get(f.actor, f.home, f.presence.id);
    await retirements.retire(f.actor, f.home, f.presence.id, { requestId: randomUUID(), expectedSourceToken: reviewed.sourceToken,
      confirmRetirement: true, pendingWorkPolicy: "require_settled", accessPolicy: "detach_agent_only", retentionPolicy: "existing_company_policy" });
    expect(await agent()).toMatchObject({ status: "terminated", runtimeConfig: before, permissions: {} });
  });
  it("erases a deleted historical definition's retained runtime payload and assets through the actual privacy outbox", async () => {
    await qualify(); const first = await publish(), old = await agent();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: old.id, responsibleUserId: f.userId, status: "running" }).returning();
    const runtime = await buildRetainedNativeRuntimeContext({ db, agent: old, runId: run!.id, runtimeConfig: old.adapterConfig, runtimeSkillEntries: [] });
    expect(await readNativeRuntimeAssetText(runtime.instructions.bundle, 64000, { companyId: f.home, runId: run!.id })).toHaveLength(1);
    await db.update(heartbeatRuns).set({ status: "succeeded", resultJson: { body: "A retained output" } }).where(eq(heartbeatRuns.id, run!.id));
    const next = await drafts().create(f.actor, f.home, { requestId: randomUUID(), agentId: f.presence.id });
    draft = await drafts().save(f.actor, f.home, next.id, { requestId: randomUUID(), expectedVersion: next.version, step: "test", content: { ...next.content!, internalDescription: "Next tested version" } });
    await qualify(); const second = await publish();
    const [original] = await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.id, first.revisionId));
    await db.delete(agentConfigRevisions).where(and(eq(agentConfigRevisions.companyId, f.home), eq(agentConfigRevisions.id, first.revisionId)));
    await expect(db.insert(agentConfigRevisions).values(original!))
      .rejects.toMatchObject({ cause: { code: "23514", message: "agent_authored_revision_erased" } });
    await expect(db.insert(agentConfigRevisions).values({ ...original!, id: randomUUID() }))
      .rejects.toMatchObject({ cause: { code: "23514", message: "agent_authored_revision_erased" } });
    await expect(db.insert(agentConfigRevisions).values({ ...original!, companyId: f.guest, beforeConfig: {}, afterConfig: {} }))
      .rejects.toMatchObject({ cause: { code: "23514", message: "agent_authored_revision_erased" } });
    const [history] = await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.id, second.revisionId));
    expect(history!.beforeConfig).toEqual({ payloadDeleted: true, revisionId: first.revisionId });
    // A changed or cleared snapshot without the exact C7 receipt still fails.
    await expect(db.update(agentConfigRevisions).set({ beforeConfig: {} }).where(eq(agentConfigRevisions.id, second.revisionId)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
    expect(await heartbeatMemoryPayloadRetained(db, f.home, run!.id)).toBe(false);
    expect((await db.select().from(memoryJobs).where(eq(memoryJobs.jobKey, `authored-definition-source-erasure:v1:${run!.id}:${first.revisionId}`)))[0]!.status).toBe("queued");
    await memoryJobService(db).tick({ limit: 20 }); await memoryJobService(db).tick({ limit: 20 });
    const erased = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id)))[0]!;
    expect(erased.resultJson).toBeNull(); expect(erased.contextSnapshot).toEqual({});
    await expect(readNativeRuntimeAssetText(runtime.instructions.bundle, 64000, { companyId: f.home, runId: run!.id })).rejects.toThrow();
    expect((await agent()).runtimeConfig).toHaveProperty(`${AUTHORED_AGENT_DEFINITION_KEY}.revisionId`, second.revisionId);
    const fresh = await drafts().create(f.actor, f.home, { requestId: randomUUID(), agentId: f.presence.id });
    draft = await drafts().save(f.actor, f.home, fresh.id, { requestId: randomUUID(), expectedVersion: fresh.version, step: "test", content: fresh.content! });
    await qualify(); const freshCommand = await publicationCommand();
    await expect(publications().publish(f.actor, f.home, draft.id, { ...freshCommand, requestId: first.revisionId }))
      .rejects.toMatchObject({ status: 409, details: { code: "publication_request_erased" } });
    expect((await agent()).runtimeConfig).toHaveProperty(`${AUTHORED_AGENT_DEFINITION_KEY}.revisionId`, second.revisionId);
    expect((await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.companyId, f.home))).map(row => row.status)).toEqual(["completed", "completed", "completed"]);
  });
  it("closes an erased Playbook's actual Safe Test copies while preserving its completed financial reservation", async () => {
    requiredPlaybook = await seedApprovedAuthoringPlaybook(db, f.actor, f.home);
    await bindAuthoringPlaybook(db, f.actor, f.home, f.presence.id, requiredPlaybook);
    await grantAuthoringPlaybookReadFixture(db, f.home, f.presence.id);
    const tested = await qualify();
    const [manifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, tested.runId));
    expect(manifest!.manifest.playbooks).toEqual([{ playbookId: requiredPlaybook.playbookId, revisionId: requiredPlaybook.revisionId, required: true }]);
    const financial = async () => (await db.select().from(orchestrationModelReservations)
      .where(eq(orchestrationModelReservations.companyId, f.home))).map(({ id, status, maximumMinor, quote, usage }) => ({ id, status, maximumMinor, quote, usage }));
    const before = await financial();
    expect(before).toEqual([expect.objectContaining({ status: "completed", maximumMinor: 3, usage: { inputTokens: 20, outputTokens: 12 } })]);
    await db.delete(documents).where(eq(documents.id, requiredPlaybook.documentId));
    expect(await heartbeatMemoryPayloadRetained(db, f.home, tested.runId)).toBe(false);
    await memoryJobService(db).tick({ limit: 20 }); await memoryJobService(db).tick({ limit: 20 });
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, tested.runId)))[0]!.resultJson).toBeNull();
    expect(await financial()).toEqual(before); expect(calls).toBe(1);
    const reviewed = await publications().review(f.actor, f.home, draft.id);
    expect(reviewed.canPublish).toBe(false);
    expect(reviewed.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: "representative_test_unqualified" })]));
    await expect(publications().publish(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: draft.version,
      expectedReviewHash: "a".repeat(64), activate: true, confirmPublication: true, confirmActivation: true })).rejects.toMatchObject({ status: 409 });
  });
  it("publishes a Hire only with its actual package, reviewed purpose and current activation, and rebinds the Original package to that version", async () => {
    requiredPlaybook = await seedApprovedAuthoringPlaybook(db, f.actor, f.home);
    const hired = await prepareHirePublicationFixture(db, f, requiredProcedures[0]!, requiredPlaybook, false);
    expect(hired.agent.status).toBe("paused");
    expect(hired.installation.components).toEqual(expect.arrayContaining([expect.objectContaining({
      key: "welcome-procedure", type: "skill", resourceId: requiredProcedures[0]!.skillId, versionId: requiredProcedures[0]!.versionId,
    })]));
    expect(hired.installation.components).toEqual(expect.arrayContaining([expect.objectContaining({
      key: "welcome-playbook", type: "playbook", resourceId: requiredPlaybook.playbookId, versionId: requiredPlaybook.revisionId,
    })]));
    f = { ...f, presence: hired.agent };
    const runtime = await configureRuntime();
    draft = await drafts().save(f.actor, f.home, hired.draft.id, { requestId: randomUUID(), expectedVersion: hired.draft.version,
      step: "hire_test", content: { ...hired.draft.content!, runtimeBindingId: runtime.id, scenarios: [hired.release.manifest.purpose] } });
    await expect(db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      status: "running", invocationSource: "on_demand", triggerDetail: "ordinary_work" }))
      .rejects.toMatchObject({ cause: { code: "23514", message: "package_run_activation_required" } });
    await expect(db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      status: "running", invocationSource: "on_demand", triggerDetail: "agent_safe_test", contextSnapshot: {
        agentConfigurationTestId: randomUUID(), draftId: draft.id, candidateHash: "d".repeat(64), toolsGranted: false, activatesAgent: false } }))
      .rejects.toMatchObject({ cause: { code: "23514", message: "agent_safe_test_original_run_scope_required" } });
    await qualify();
    const before = await publications().review(f.actor, f.home, draft.id);
    expect(before.canPublish).toBe(false);
    expect(before.blockers.map(item => item.code)).toContain("hire_package_activation_required");
    const setup = agentAuthoringPackageSetupService(db), blocked = await setup.review(f.actor, f.home, draft.id);
    expect(blocked.canConfirm).toBe(false); expect(blocked.blockers).toContain("approved_purpose_required");
    expect(blocked.purposes.map(purpose => purpose.id)).toContain(hired.useCase.id);
    const selected = await setup.review(f.actor, f.home, draft.id, hired.useCase.id);
    expect(selected.canConfirm).toBe(true);
    const setupInput = { requestId: randomUUID(), expectedVersion: draft.version, expectedReviewHash: selected.reviewHash,
      purposeId: hired.useCase.id, confirmIntendedPurpose: true, confirmPackageActivation: true };
    const [firstSetup, repeatedSetup] = await Promise.all([setup.confirm(f.actor, f.home, draft.id, setupInput), setup.confirm(f.actor, f.home, draft.id, setupInput)]);
    expect(firstSetup).toEqual(repeatedSetup);
    expect(await setup.receipt(f.actor, f.home, draft.id, setupInput.requestId)).toEqual(firstSetup);
    expect((await db.select().from(activityLog).where(and(eq(activityLog.entityId, draft.id), eq(activityLog.action, "agent_configuration.package_setup_confirmed"))))).toHaveLength(1);
    expect(calls).toBe(1);
    const active = await hired.packages.get(f.actor, f.home, hired.installation.id);
    expect(active.aiUseCaseId).toBe(hired.useCase.id);
    expect(active.version).toBe(hired.installation.version + 2);
    const beforeSetupVersion = draft.version;
    draft = await drafts().get(f.actor, f.home, draft.id);
    expect(draft.version).toBe(beforeSetupVersion + 1);
    expect(active.readiness?.reasons).toEqual([]); expect(active.status).toBe("active");
    const input = await publicationCommand(), runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home));
    const first = await publications().publish(f.actor, f.home, draft.id, input);
    expect(first.packageInstallation).toEqual({ installationId: active.id, versionId: hired.published.id,
      key: hired.release.packageKey, version: hired.release.version, contentHash: hired.published.contentHash });
    const installed = await hired.packages.get(f.actor, f.home, active.id);
    expect(installed.status).toBe("active"); expect(installed.version).toBe(active.version + 1);
    const [current] = await db.execute<{ current: boolean }>(sql`select aw_v7_package_installation_current(i) as current
      from company_agent_package_installations i where company_id=${f.home}::uuid and id=${active.id}::uuid`);
    expect(current!.current).toBe(true);
    expect(await publications().publish(f.actor, f.home, draft.id, input)).toEqual(first);
    expect((await hired.packages.get(f.actor, f.home, active.id)).version).toBe(installed.version);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).toEqual(runs);
    expect(calls).toBe(1);
  });
});
