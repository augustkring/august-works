import { seedApprovedAuthoringPreference } from "./helpers/authoring-memory.js";
import { memoryService } from "../services/memory/memory-service.js";
import { grantAuthoringKnowledgeReadFixture } from "./helpers/authoring-procedures.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { agentConfigurationDrafts, agentConfigurationTests, agents, authSessions, authUsers, billingAccounts, billingAccountCompanies, companyMemberships, companySkills, companySkillVersions, createDb, heartbeatRuns, orchestrationPlans, orchestrationModelReservations, orchestrationWorkers, toolInvocations, verificationRuns, documents, principalPermissionGrants } from "@paperclipai/db";
import { agentAuthoringContentSchema, type AgentAuthoringDraftView, type AgentDraftTestCommand, type VerificationReviewInput } from "@paperclipai/shared";
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
import { issues, issueThreadInteractions } from "@paperclipai/db";
import { foundationService } from "../services/foundation/foundation-service.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { budgetService } from "../services/budgets.js";
import { heartbeatService } from "../services/heartbeat.js";
import { reconcileAgentDraftTest } from "../services/agents/authoring-test-recovery.js";
import { heartbeatMemoryPayloadRetained, reapplyMemoryDeletionMarkers } from "../services/memory/memory-privacy.js";
import { memoryJobService } from "../services/memory/memory-jobs.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { seedRequiredAuthoringProcedures } from "./helpers/authoring-procedures.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport(), sourceSha = "a".repeat(40);
(support.supported ? describe : describe.skip)("Representative candidate tests with Native evidence and human review", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, home: string;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, draft: AgentAuthoringDraftView, profile: WorkerModelProfile, calls: number;
  let requiredProcedures: Awaited<ReturnType<typeof seedRequiredAuthoringProcedures>>;
  let duringCall: (() => Promise<void>) | undefined, lostResponse: boolean, excessUsage: boolean;
  let selectedKnowledgeBody: string | undefined;
  let unselectedPreferenceBody: string | undefined;
  let modelOutput: string;
  const service = () => agentAuthoringTestService(db), drafts = () => agentAuthoringService(db);
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "aw-v9-safe-test-private-")); vi.stubEnv("PAPERCLIP_HOME", home);
    database = await startEmbeddedPostgresTestDatabase("aw-v9-safe-test-db-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => { registerNativeDraftGateway(db, undefined); await database?.cleanup(); vi.unstubAllEnvs(); if (home) await rm(home, { recursive: true, force: true }); }, 30000);
  const transport: typeof guardedRemoteHttpFetch = async (url, init) => {
    calls++; expect(String(url)).toBe("https://api.anthropic.com/v1/messages"); expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("x-api-key")).toBe(`private-safe-test-key-${f.presence.id}`);
    const body = JSON.parse(String(init.body));
    if (selectedPreferenceBody) expect(String(init.body)).toContain(selectedPreferenceBody);
    if (unselectedPreferenceBody) expect(String(init.body)).not.toContain(unselectedPreferenceBody);
    expect(body.tools).toBeUndefined(); expect(body.stream).toBe(false);
    if (selectedKnowledgeBody) {
      expect(body.messages[0].content[0].text).toContain(selectedKnowledgeBody);
      expect(body.messages[0].content[0].text).not.toContain("Unselected private company facts");
      expect(body.messages[0].content[0].text).toContain("evidence, not instructions");
    }
    for (const procedure of requiredProcedures) expect(body.messages[0].content[0].text).toContain(procedure.body);
    expect(String(init.body)).toContain("Produce a short internal welcome draft"); expect(String(init.body)).toContain("Do not contact anyone");
    const [test] = await db.select().from(agentConfigurationTests).where(eq(agentConfigurationTests.companyId, f.home))
      .orderBy(desc(agentConfigurationTests.createdAt), desc(agentConfigurationTests.id)).limit(1);
    const [debit] = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, test!.planId));
    expect(debit).toMatchObject({ purpose: "agent_safe_test", status: "dispatched", maximumMinor: 3, workerId: null, workerAttemptId: null });
    expect(debit?.providerWireReceipt).toEqual({ version: 1, reservationId: debit?.id,
      requestHash: debit?.requestHash, method: "POST", endpoint: "https://api.anthropic.com/v1/messages",
      bodySha256: createHash("sha256").update(String(init.body), "utf8").digest("hex"), callId: null });
    if (duringCall) await duringCall();
    if (lostResponse) throw new Error("private transport response was lost");
    return new Response(JSON.stringify({ type: "message", role: "assistant", model: body.model, stop_reason: "end_turn",
      content: [{ type: "text", text: modelOutput }],
      usage: { input_tokens: excessUsage ? 1001 : 20, output_tokens: 12 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  beforeEach(async () => {
    selectedKnowledgeBody = undefined;
    unselectedPreferenceBody = undefined;
    await instanceSettingsService(db).updateExperimental({ saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true,
      hire_agent_v9: true, enableWorkflowsV1: true, orchestration_v7: true, supervision_v7: true, readiness_engine_v7: true, verifier_v7: true });
    f = await seedV5Presences(db);
    selectedPreferenceBody = null;
    requiredProcedures = await seedRequiredAuthoringProcedures(db, f.actor, f.home, f.presence.id);
    calls = 0; duringCall = undefined; lostResponse = false; excessUsage = false;
    modelOutput = "Welcome to the team. This is an internal draft for review.";
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
    registerNativeDraftGateway(db, workerModelGateway(db, { profiles: [profile, { ...profile, id: randomUUID(), qualifiedConfigurationHash: "f".repeat(64), tariff: { ...profile.tariff, model: "unselected-alternative-model" } }], sourceSha, protectedEvidenceOrigin: "https://protected.test.invalid", fetch: transport }));
    const initial = await drafts().create(f.actor, f.home, { requestId: randomUUID(), agentId: f.presence.id });
    draft = await drafts().save(f.actor, f.home, initial.id, { requestId: randomUUID(), expectedVersion: initial.version, step: "test",
      content: agentAuthoringContentSchema.parse({ name: "Welcome specialist", description: "Creates internal welcome drafts", ownerUserId: f.userId,
        outcome: "Produce a short internal welcome draft", runtimeBindingId: runtime.id, scenarios: ["Produce a short internal welcome draft"],
        instructions: { purpose: "Prepare an internal draft", responsibilities: "Draft a friendly welcome", prohibited: "Do not contact anyone",
          missingInformation: "Ask the owner", escalation: "Ask the owner before any other action", communication: "Use concise language" } }) });
  });
  async function command(): Promise<AgentDraftTestCommand> {
    const reviewed = await service().review(f.actor, f.home, draft.id, 0);
    expect(reviewed).toMatchObject({ maximumCostMinor: 3, currency: "USD", companyVisibleResult: true, toolsGranted: false, activatesAgent: false });
    expect(JSON.stringify(reviewed)).not.toContain("private-safe-test-key");
    return { requestId: randomUUID(), expectedVersion: draft.version, scenarioIndex: 0, expectedReviewHash: reviewed.reviewHash,
      confirmRepresentativeTest: true, confirmCompanyVisibleResult: true };
  }
  async function attachCurrentNativeSession() {
    const sessionId = await seedNativePasskeySession(db, f.userId);
    const [session] = await db.select({ expiresAt: authSessions.expiresAt }).from(authSessions).where(eq(authSessions.id, sessionId));
    f.actor = { ...f.actor, sessionId, authenticatedCredentialExpiresAt: session!.expiresAt.getTime() };
  }
  async function execute() { const input = await command(); return { input, result: await service().start(f.actor, f.home, draft.id, input) }; }
  async function selectReviewedTaskProposal() {
    draft = await drafts().save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: draft.version, step: "test",
      content: { ...draft.content!, capabilities: [
        { operation: "create_internal_draft", autonomy: "automatic" }, { operation: "create_task", autonomy: "ask_first" },
      ] } });
  }
  it("records a representative task proposal as evidence without creating a business task or approval interaction", async () => {
    await selectReviewedTaskProposal();
    modelOutput = JSON.stringify({ draft: "An internal welcome draft", proposedTask: { title: "A proposed welcome followup", description: "Review approved internal onboarding facts" } });
    const { result } = await execute();
    expect(calls).toBe(1);
    expect(result).toMatchObject({ execution: "succeeded", verification: "not_reviewed", testQualified: false, toolsGranted: false, activatesAgent: false });
    expect(result.result).toContain("Proposed task — not created");
    expect(result.result).toContain("A proposed welcome followup");
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, result.runId));
    expect(run!.resultJson).toMatchObject({ taskProposalRecorded: true, businessTasksCreated: 0, independentlyVerified: false });
    expect(await db.select().from(issues).where(and(eq(issues.companyId, f.home), eq(issues.title, "A proposed welcome followup")))).toEqual([]);
    expect(await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.companyId, f.home))).toEqual([]);
    expect(await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, f.home))).toEqual([]);
  });
  it("refuses widened task output while retaining the actual model debit without an output document", async () => {
    await selectReviewedTaskProposal();
    modelOutput = JSON.stringify({ draft: "Private invalid output", proposedTask: { title: "A forged task", description: "Outside scope", companyId: f.guest } });
    const { result } = await execute();
    expect(result).toMatchObject({ execution: "failed", testQualified: false, toolsGranted: false, activatesAgent: false });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, result.runId));
    expect(run!.resultJson?.outputDocumentId).toBeUndefined();
    expect(await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.companyId, f.home))).toEqual([]);
    const [test] = await db.select().from(agentConfigurationTests).where(eq(agentConfigurationTests.runId, result.runId));
    expect((await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, test!.planId)))[0])
      .toMatchObject({ status: "completed", maximumMinor: 3 });
  });
  let selectedPreferenceBody: string | null = null;
  async function selectPreference() {
    const preference = await seedApprovedAuthoringPreference(db, f.home, f.presence.id, f.userId);
    selectedPreferenceBody = preference.body;
    draft = await drafts().save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: draft.version, step: "test",
      content: { ...draft.content!, memory: "approved_work_preferences", memoryRecordIds: [preference.id],
        capabilities: [{ operation: "create_internal_draft", autonomy: "automatic" }] } });
    return preference;
  }
  async function selectKnowledge() {
    const owner = foundationService(db), actor = { principal: { type: "user" as const, userId: f.userId } };
    selectedKnowledgeBody = "The selected company is named Aster";
    const source = await owner.createDraft(f.home, { foundationKey: `selected-${randomUUID()}`, category: "company", documentType: "company_profile",
      title: "Selected company facts", body: selectedKnowledgeBody, sensitivity: "internal" }, actor);
    await owner.submitForReview(f.home, source.id, source.latestRevisionId!, actor); const approved = await owner.approve(f.home, source.id, source.latestRevisionId!, actor);
    const other = await owner.createDraft(f.home, { foundationKey: `unselected-${randomUUID()}`, category: "company", documentType: "company_profile",
      title: "Unselected facts", body: "Unselected private company facts", sensitivity: "internal" }, actor);
    await owner.submitForReview(f.home, other.id, other.latestRevisionId!, actor); await owner.approve(f.home, other.id, other.latestRevisionId!, actor);
    await grantAuthoringKnowledgeReadFixture(db, f.home, f.presence.id, f.userId);
    draft = await drafts().save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: draft.version, step: "test",
      content: { ...draft.content!, knowledgeDocumentIds: [approved.id], capabilities: [
        { operation: "create_internal_draft", autonomy: "automatic" }, { operation: "read_approved_knowledge", autonomy: "automatic" }] } });
    return approved;
  }
  async function reviewInput(requestId: string): Promise<VerificationReviewInput> {
    const packet = await service().packet(f.actor, f.home, draft.id, requestId), refs = packet.evidence.map(evidence => evidence.ref);
    expect(packet.policy.humanRequired).toBe(true); expect(packet.deterministicFailures).toEqual([]);
    return { expectedPlanVersion: packet.planVersion, expectedResultHash: packet.resultHash, workerId: null, result: "pass",
      objectiveSatisfied: true, explicitHighImpactApproval: true, rationale: "I compared the generated draft with every saved requirement.",
      businessInvariants: packet.contract.businessInvariants.map((_, index) => ({ index, satisfied: true, evidenceRefs: refs })),
      evidenceRequirements: packet.contract.evidenceRequirements.map((_, index) => ({ index, satisfied: true, evidenceRefs: refs })),
      prohibitedOutcomes: packet.contract.prohibitedOutcomes.map((_, index) => ({ index, satisfied: true, evidenceRefs: refs })) };
  }
  it("executes exactly once, retains real evidence, and qualifies only after canonical human review", async () => {
    const { input, result } = await execute();
    expect(calls).toBe(1); expect(result).toMatchObject({ execution: "succeeded", verification: "not_reviewed", testQualified: false,
      candidateCurrent: true, runtimeCurrent: true, resultCurrent: true, toolsGranted: false, activatesAgent: false });
    expect(result.result).toContain("internal draft for review");
    expect(await service().start(f.actor, f.home, draft.id, input)).toEqual(result); expect(calls).toBe(1);
    expect((await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]!.status).toBe("paused");
    expect(await db.select().from(orchestrationWorkers).where(eq(orchestrationWorkers.companyId, f.home))).toEqual([]);
    expect(await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, f.home))).toEqual([]);
    const verified = await service().verify(f.actor, f.home, draft.id, input.requestId, await reviewInput(input.requestId));
    expect(verified).toMatchObject({ verification: "pass", testQualified: true });
    const readiness = await drafts().review(f.actor, f.home, draft.id);
    expect(readiness.test).toMatchObject({ status: "qualified", scenariosVerified: 1 });
    expect(readiness.blockers.map(blocker => blocker.code)).not.toContain("representative_test_unqualified");
    expect(readiness).toMatchObject({ publishAllowed: false, productionChanged: false });
    expect(readiness.blockers.map(blocker => blocker.code)).toContain("internal_draft_authority_required");
    expect((await db.select().from(verificationRuns).where(eq(verificationRuns.planId, result.planId)))[0]).toMatchObject({ reviewerType: "human", reviewerId: f.userId });
  });
  it("preserves a tested candidate through navigation while fencing unversioned behavior changes", async () => {
    const { input } = await execute();
    await service().verify(f.actor, f.home, draft.id, input.requestId, await reviewInput(input.requestId));
    const request = { requestId: randomUUID(), expectedVersion: draft.version, step: "review" as const, content: draft.content! };
    const saved = await drafts().save(f.actor, f.home, draft.id, request);
    expect(saved).toMatchObject({ version: draft.version + 1, step: "review", content: draft.content });
    expect(await drafts().save(f.actor, f.home, draft.id, request)).toEqual(saved);
    expect((await drafts().review(f.actor, f.home, draft.id)).test.status).toBe("qualified");
    const [row] = await db.select().from(agentConfigurationDrafts).where(eq(agentConfigurationDrafts.id, draft.id));
    await expect(db.update(agentConfigurationDrafts).set({ content: { ...row!.content!, outcome: "Changed behavior without its candidate version" }, version: row!.version + 1 })
      .where(eq(agentConfigurationDrafts.id, draft.id))).rejects.toMatchObject({ cause: { code: "23514", message: "agent_configuration_draft_candidate_conflict" } });
    expect((await drafts().review(f.actor, f.home, draft.id)).test.status).toBe("qualified"); expect(calls).toBe(1);
    const changed = await drafts().save(f.actor, f.home, draft.id, { ...request, requestId: randomUUID(), expectedVersion: saved.version,
      content: { ...saved.content!, outcome: "A changed bounded internal responsibility" } });
    const restored = await drafts().save(f.actor, f.home, draft.id, { ...request, requestId: randomUUID(), expectedVersion: changed.version });
    expect(restored.content).toEqual(saved.content);
    expect((await drafts().review(f.actor, f.home, draft.id)).test.status).toBe("unqualified");
  });
  it("preserves one admitted model execution when only navigation changes during inference", async () => {
    const originalVersion = draft.version;
    duringCall = async () => { draft = await drafts().save(f.actor, f.home, draft.id, {
      requestId: randomUUID(), expectedVersion: draft.version, step: "review", content: draft.content!,
    }); };
    const { input, result } = await execute();
    expect(draft.version).toBe(originalVersion + 1);
    expect(result).toMatchObject({ version: originalVersion, candidateCurrent: true, runtimeCurrent: true, resultCurrent: true, execution: "succeeded" });
    await service().verify(f.actor, f.home, draft.id, input.requestId, await reviewInput(input.requestId));
    expect((await drafts().review(f.actor, f.home, draft.id)).test.status).toBe("qualified");
    expect(calls).toBe(1);
    expect((await db.select().from(orchestrationModelReservations))[0]!.status).toBe("completed");
  });
  it("does not reuse an older passing test when the latest attempt is unresolved", async () => {
    const first = await execute();
    await service().verify(f.actor, f.home, draft.id, first.input.requestId, await reviewInput(first.input.requestId));
    expect((await drafts().review(f.actor, f.home, draft.id)).test.status).toBe("qualified");
    lostResponse = true; const second = await execute(); expect(second.result.execution).toBe("unknown");
    expect((await drafts().review(f.actor, f.home, draft.id)).test.status).toBe("unqualified"); expect(calls).toBe(2);
  });
  it("requires current human verification of every saved scenario before clearing the test blocker", async () => {
    draft = await drafts().save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: draft.version, step: "test",
      content: { ...draft.content!, scenarios: [...draft.content!.scenarios, "Write an internal welcome draft for a remote teammate"] } });
    const first = await execute();
    await service().verify(f.actor, f.home, draft.id, first.input.requestId, await reviewInput(first.input.requestId));
    expect((await drafts().review(f.actor, f.home, draft.id)).test.status).toBe("unqualified");
    const secondReview = await service().review(f.actor, f.home, draft.id, 1), second = { ...first.input, requestId: randomUUID(), scenarioIndex: 1, expectedReviewHash: secondReview.reviewHash };
    expect((await service().start(f.actor, f.home, draft.id, second)).testQualified).toBe(false);
    await service().verify(f.actor, f.home, draft.id, second.requestId, await reviewInput(second.requestId));
    expect((await drafts().review(f.actor, f.home, draft.id)).test).toMatchObject({ status: "qualified", scenariosVerified: 2 });
    draft = await drafts().save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: draft.version, step: "review",
      content: { ...draft.content!, outcome: "A changed saved responsibility must be tested again" } });
    expect((await drafts().review(f.actor, f.home, draft.id)).test.status).toBe("unqualified"); expect(calls).toBe(2);
  });
  it("cannot pass without the canonical explicit human approval even with satisfied criteria", async () => {
    const { input } = await execute();
    const review = { ...await reviewInput(input.requestId), explicitHighImpactApproval: false };
    expect(await service().verify(f.actor, f.home, draft.id, input.requestId, review)).toMatchObject({ verification: "fail", testQualified: false });
    expect(calls).toBe(1);
  });
  it("tests an actual newly prepared Custom Agent without granting creation permissions or activating it", async () => {
    const settings = instanceSettingsService(db), original = await settings.getExperimental();
    try {
      await settings.updateExperimental({ free_core_commercial_v7: true, billing_entitlements_v6: true, billing_usage_v6: true });
      const [account] = await db.insert(billingAccounts).values({ displayName: "Unfunded preparation fixture", payerUserId: f.userId }).returning();
      await db.insert(billingAccountCompanies).values({ companyId: f.home, billingAccountId: account!.id });
      const initial = await drafts().create(f.actor, f.home, { requestId: randomUUID() });
      const saved = await drafts().save(f.actor, f.home, initial.id, { requestId: randomUUID(), expectedVersion: initial.version, step: "runtime",
        content: { ...draft.content!, runtimeBindingId: null } });
      const preparation = await drafts().preparationReview(f.actor, f.home, saved.id);
      draft = await drafts().prepare(f.actor, f.home, saved.id, { requestId: randomUUID(), expectedVersion: saved.version,
        expectedReviewHash: preparation.reviewHash, confirmInactiveAgentPreparation: true });
      const agentId = draft.preparation!.agentId, [prepared] = await db.select().from(agents).where(eq(agents.id, agentId));
      expect(prepared).toMatchObject({ status: "paused", permissions: { canCreateAgents: false, canCreateSkills: false } });
      const config = { provider: "aw_text_only", model: profile.tariff.model, workerModelProfileId: profile.id, maxOutputTokens: 256 };
      await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: config }).where(eq(agents.id, agentId));
      const providers = agentProviderBindingService(db), pb = await providers.create(f.actor, f.home, agentId,
        { providerType: "paperclip_native", providerAgentRef: agentId, isolationMode: "isolated_per_presence", providerEndpointRef: null });
      const runtime = await providers.attach(f.actor, f.home, agentId, { providerBindingId: pb.id, providerProfileRef: `private:${agentId}` });
      const snapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId: f.home, adapterType: "paperclip_runner", config }));
      await providers.recordDiscovery(f.home, agentId, snapshot, Object.fromEntries(providerConformanceRequirements(snapshot, pb.isolationMode).map(check => [check, true])),
        { configurationHash: hashContextPolicySnapshot({ adapterType: "paperclip_runner", adapterConfig: config }), runtimeId: runtime.id,
          profileRef: runtime.providerProfileRef, bindingId: pb.id, accountingComplete: true });
      const connection = await aiConnectionService(db).save(f.home, f.userId, { provider: "anthropic", method: "api_key", ownership: "shared",
        name: "Explicit new Agent fixture", apiKey: "fixture", allAgents: false, agentIds: [agentId] }, `private-safe-test-key-${agentId}`);
      f = { ...f, presence: (await db.select().from(agents).where(eq(agents.id, agentId)))[0]! };
      profile = { ...profile, workerAgentId: agentId, providerBindingId: pb.id, providerSnapshotHash: snapshot.hash,
        providerProfileRef: runtime.providerProfileRef, qualifiedConfigurationHash: hashContextPolicySnapshot({ adapterType: "paperclip_runner", adapterConfig: config }),
        binding: { provider: "anthropic", method: "api_key", mode: "shared", ...connection } };
      registerNativeDraftGateway(db, workerModelGateway(db, { profiles: [profile, { ...profile, id: randomUUID(), qualifiedConfigurationHash: "f".repeat(64), tariff: { ...profile.tariff, model: "unselected-alternative-model" } }], sourceSha, protectedEvidenceOrigin: "https://protected.test.invalid", fetch: transport }));
      draft = await drafts().save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: draft.version, step: "test", content: { ...draft.content!, runtimeBindingId: runtime.id } });
      const { input, result } = await execute(); expect(result).toMatchObject({ agentId, execution: "succeeded", testQualified: false });
      expect((await service().verify(f.actor, f.home, draft.id, input.requestId, await reviewInput(input.requestId))).testQualified).toBe(true);
      expect((await db.select().from(agents).where(eq(agents.id, agentId)))[0]).toMatchObject({ status: "paused", permissions: { canCreateAgents: false, canCreateSkills: false } });
      expect(calls).toBe(1);
    } finally { await settings.updateExperimental({ free_core_commercial_v7: original.free_core_commercial_v7,
      billing_entitlements_v6: original.billing_entitlements_v6, billing_usage_v6: original.billing_usage_v6 }); }
  });
  it("retains an ambiguous model debit and never dispatches again after a lost reply", async () => {
    lostResponse = true; const { input, result } = await execute(); expect(result).toMatchObject({ execution: "unknown", testQualified: false, result: null });
    const [debit] = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, result.planId));
    expect(debit).toMatchObject({ status: "unknown", maximumMinor: 3 });
    expect((await service().start(f.actor, f.home, draft.id, input)).id).toBe(result.id);
    expect((await service().get(f.actor, f.home, draft.id, input.requestId))?.execution).toBe("unknown"); expect(calls).toBe(1);
  });
  it("refuses stale C3 confirmation, undeclared sharing and request-ID content changes", async () => {
    const input = await command();
    await expect(service().start(f.actor, f.home, draft.id, { ...input, confirmCompanyVisibleResult: false })).rejects.toThrow();
    await expect(service().start(f.actor, f.home, draft.id, { ...input, expectedReviewHash: "f".repeat(64) })).rejects.toMatchObject({ status: 409 });
    expect(calls).toBe(0);
    await service().start(f.actor, f.home, draft.id, input);
    await expect(service().start(f.actor, f.home, draft.id, { ...input, scenarioIndex: 1 })).rejects.toMatchObject({ status: 409 }); expect(calls).toBe(1);
  });
  it("fences changed candidates after actual dispatch while retaining the completed model receipt", async () => {
    duringCall = async () => { draft = await drafts().save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: draft.version, step: "test",
      content: { ...draft.content!, outcome: "Changed candidate responsibility" } }); };
    const { result } = await execute(); expect(result).toMatchObject({ execution: "failed", candidateCurrent: false, result: null, testQualified: false });
    expect((await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, result.planId)))[0]!.status).toBe("completed"); expect(calls).toBe(1);
  });
  it("withdraws qualification when the actual generated document revision changes", async () => {
    const { input, result } = await execute(), review = await reviewInput(input.requestId);
    expect((await service().verify(f.actor, f.home, draft.id, input.requestId, review)).testQualified).toBe(true);
    const [plan] = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, result.planId));
    const original = await documentService(db).getIssueDocumentByKey(plan!.issueId, "representative-draft");
    expect(original?.body).toBe(result.result);
    await documentService(db).upsertIssueDocument({ issueId: plan!.issueId, key: "representative-draft", title: "Changed output", format: "markdown", baseRevisionId: original!.latestRevisionId,
      body: "A human edited this result after generation", createdByUserId: f.userId });
    expect(await service().get(f.actor, f.home, draft.id, input.requestId)).toMatchObject({ resultCurrent: false, verification: "not_reviewed", testQualified: false });
    expect((await drafts().review(f.actor, f.home, draft.id)).test.status).toBe("unqualified");
  });
  it("withdraws human test qualification after an actual required procedure is revoked", async () => {
    const { input } = await execute();
    expect((await service().verify(f.actor, f.home, draft.id, input.requestId, await reviewInput(input.requestId))).testQualified).toBe(true);
    await db.update(companySkills).set({ lifecycleState: "revoked" }).where(eq(companySkills.id, requiredProcedures[0]!.skillId));
    expect(await service().get(f.actor, f.home, draft.id, input.requestId)).toMatchObject({ runtimeCurrent: false, testQualified: false });
    expect((await drafts().review(f.actor, f.home, draft.id)).test.status).toBe("unqualified");
    await expect(service().review(f.actor, f.home, draft.id, 0)).rejects.toMatchObject({ status: 409 });
    expect(calls).toBe(1);
  });
  it("withholds a late output after procedure withdrawal while keeping the actual completed debit", async () => {
    duringCall = async () => { await db.update(companySkills).set({ lifecycleState: "revoked" }).where(eq(companySkills.id, requiredProcedures[0]!.skillId)); };
    const { result } = await execute();
    expect(result).toMatchObject({ execution: "failed", runtimeCurrent: false, testQualified: false, result: null });
    expect((await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, result.planId)))[0]!.status).toBe("completed");
    expect(calls).toBe(1);
  });
  it("uses only the selected approved preference through the actual bounded test controller", async () => {
    await attachCurrentNativeSession();
    const selected = await selectPreference();
    unselectedPreferenceBody = (await seedApprovedAuthoringPreference(db, f.home, f.presence.id, f.userId)).body;
    expect(unselectedPreferenceBody).not.toBe(selected.body);
    const { result } = await execute();
    expect(result).toMatchObject({ execution: "succeeded", runtimeCurrent: true, testQualified: false }); expect(calls).toBe(1);
    expect((await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId,result.planId)))[0]!.status).toBe("completed");
  });
  it.each(["different-test", "stale-candidate", "revoked-human"] as const)(
    "does not admit a paused candidate Memory read after its bound $s changes",
    async change => {
      await selectPreference();
      const input = await command(), suffix = draft.id.replaceAll("-", ""), name = `aw_safe_test_memory_${suffix}`;
      const forgedTestId = randomUUID();
      const mutation = change === "different-test"
        ? `update heartbeat_runs set context_snapshot=jsonb_set(context_snapshot,'{agentConfigurationTestId}',to_jsonb('${forgedTestId}'::text)) where id=new.run_id and company_id=new.company_id;`
        : change === "stale-candidate"
          ? `update heartbeat_runs set context_snapshot=jsonb_set(context_snapshot,'{candidateHash}',to_jsonb('${"0".repeat(64)}'::text)) where id=new.run_id and company_id=new.company_id;`
          : `update company_memberships set status='inactive' where company_id=new.company_id and principal_type='user' and principal_id=(select created_by_user_id from agent_configuration_tests where id=new.id);`;
      await db.execute(sql`create function public.${sql.identifier(name)}() returns trigger language plpgsql as $body$
        begin ${sql.raw(mutation)} return new; end $body$`);
      await db.execute(sql`create trigger ${sql.identifier(name)} after insert on agent_configuration_tests
        for each row execute function public.${sql.identifier(name)}()`);
      try {
        await expect(service().start(f.actor, f.home, draft.id, input)).rejects.toMatchObject({ status: 403 });
      } finally {
        await db.execute(sql`drop trigger if exists ${sql.identifier(name)} on agent_configuration_tests`);
        await db.execute(sql`drop function if exists public.${sql.identifier(name)}()`);
      }
      expect(calls).toBe(0);
      expect(await db.select().from(agentConfigurationTests).where(and(eq(agentConfigurationTests.companyId, f.home),
        eq(agentConfigurationTests.draftId, draft.id)))).toEqual([]);
      expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.companyId, f.home))).toEqual([]);
      expect(await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, f.home),
        eq(companyMemberships.principalId, f.userId), eq(companyMemberships.status, "active")))).toHaveLength(1);
    });
  it("withholds a late result after preference withdrawal while retaining the completed debit", async () => {
    await attachCurrentNativeSession();
    const preference = await selectPreference();
    duringCall = async () => { await memoryService(db).revoke(f.home, preference.id, { reason: "Human withdrew the preference" },
      { principal: { type: "user", userId: f.userId } }); };
    const { result } = await execute();
    expect(result).toMatchObject({ execution: "failed", runtimeCurrent: false, testQualified: false, result: null }); expect(calls).toBe(1);
    expect((await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId,result.planId)))[0]!.status).toBe("completed");
  });
  it("consumes only selected approved knowledge through the Original controller with a synthetic provider response", async () => {
    await selectKnowledge(); const { result } = await execute();
    expect(result).toMatchObject({ execution: "succeeded", runtimeCurrent: true, testQualified: false }); expect(calls).toBe(1);
    expect((await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, result.planId)))[0]!.status).toBe("completed");
  });
  it("withdraws a late knowledge-dependent result after read access is revoked while retaining its financial receipt", async () => {
    await selectKnowledge(); duringCall = async () => {
      await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home), eq(principalPermissionGrants.principalId, f.presence.id), eq(principalPermissionGrants.permissionKey, "foundation:read")));
    };
    const { result } = await execute();
    expect(result).toMatchObject({ execution: "failed", runtimeCurrent: false, testQualified: false, result: null }); expect(calls).toBe(1);
    expect((await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, result.planId)))[0]!.status).toBe("completed");
  });
  it("erases actual knowledge-dependent test copies while retaining the completed model debit", async () => {
    const source = await selectKnowledge(), { result } = await execute();
    expect(result.execution).toBe("succeeded"); expect(await heartbeatMemoryPayloadRetained(db, f.home, result.runId)).toBe(true);
    await db.delete(documents).where(eq(documents.id, source.documentId)); expect(await heartbeatMemoryPayloadRetained(db, f.home, result.runId)).toBe(false);
    await reapplyMemoryDeletionMarkers(db, f.home); await memoryJobService(db).tick({ limit: 20 });
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, result.runId)))[0]!.resultJson).toBeNull();
    expect((await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, result.planId)))[0]!.status).toBe("completed"); expect(calls).toBe(1);
  });
  it("erases actual test copies through the Original Skill Source tombstone while retaining the financial debit", async () => {
    const { result } = await execute(), pin = requiredProcedures[0]!;
    expect(await heartbeatMemoryPayloadRetained(db, f.home, result.runId)).toBe(true);
    await db.update(companySkills).set({ lifecycleState: "revoked", activeVersionId: null, currentVersionId: null, headVersionId: null })
      .where(eq(companySkills.id, pin.skillId));
    await db.delete(companySkillVersions).where(eq(companySkillVersions.id, pin.versionId));
    expect(await heartbeatMemoryPayloadRetained(db, f.home, result.runId)).toBe(false);
    await reapplyMemoryDeletionMarkers(db, f.home);
    await memoryJobService(db).tick({ limit: 10 });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, result.runId));
    expect(run!.resultJson).toBeNull();
    expect((await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, result.planId)))[0]!.status).toBe("completed");
    expect(calls).toBe(1);
  });
  it("refuses cross-company, noncreator and revoked-account access without extra model effects", async () => {
    const { input } = await execute(), other = await seedV5Presences(db);
    await expect(service().get(f.actor, f.guest, draft.id, input.requestId)).rejects.toMatchObject({ status: 404 });
    await expect(service().get(other.actor, other.home, draft.id, input.requestId)).rejects.toMatchObject({ status: 404 });
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(service().get({ ...f.actor, isInstanceAdmin: true }, f.home, draft.id, input.requestId)).rejects.toMatchObject({ status: 403 }); expect(calls).toBe(1);
  });
  it("closes publication on account withdrawal during dispatch without erasing actual financial use", async () => {
    duringCall = async () => { await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId))); };
    const input = await command(); await expect(service().start(f.actor, f.home, draft.id, input)).rejects.toMatchObject({ status: 403 });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home));
    expect(run).toMatchObject({ status: "failed", errorCode: "agent_test_failed" }); expect(calls).toBe(1);
    expect((await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.companyId, f.home)))[0]!.status).toBe("completed");
  });
  it("prevents mutable correlations, erased idempotency and ordinary orchestration admission", async () => {
    const { result } = await execute();
    await expect(db.update(agentConfigurationTests).set({ maximumCostMinor: 0 }).where(eq(agentConfigurationTests.id, result.id))).rejects.toMatchObject({ cause: { code: "23514", message: "agent_test_correlation_immutable" } });
    await expect(db.delete(agentConfigurationTests).where(eq(agentConfigurationTests.id, result.id))).rejects.toMatchObject({ cause: { code: "23514", message: "agent_test_original_request_retained" } });
    await expect(orchestrationService(db).decide(f.actor, f.home, result.planId, { action: "start", expectedVersion: 1,
      rationale: "Do not allow this harness to start ordinary work" })).rejects.toMatchObject({ status: 403 });
    const [debit] = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, result.planId));
    await expect(db.insert(orchestrationModelReservations).values({ ...debit!, id: randomUUID(), idempotencyKey: "forged-second-call", status: "reserved",
      dispatchedAt: null, completedAt: null, usage: null, providerResponseHash: null })).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it("refuses unsupported external authority and stale runtime before producing a spend receipt", async () => {
    draft = await drafts().save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: draft.version, step: "test",
      content: { ...draft.content!, capabilities: [{ operation: "external_send", autonomy: "ask_first" }] } });
    await expect(service().review(f.actor, f.home, draft.id, 0)).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(agentConfigurationTests).where(eq(agentConfigurationTests.companyId, f.home))).toEqual([]); expect(calls).toBe(0);
  });
  it("retains the liability and refuses successful publication when usage exceeds its qualified upper bound", async () => {
    excessUsage = true; const { result } = await execute(); expect(result).toMatchObject({ testQualified: false, result: null });
    expect((await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, result.planId)))[0]).toMatchObject({ status: "unknown", maximumMinor: 3 });
    expect(calls).toBe(1);
  });
  it("counts retained maximum exposure across tests and preserves verification when the admitted ceiling fills a budget", async () => {
    const budgets = budgetService(db);
    await budgets.upsertPolicy(f.home, { scopeType: "company", scopeId: f.home, amount: 3, windowKind: "calendar_month_utc", hardStopEnabled: true }, f.userId);
    const { input, result } = await execute(); expect(result).toMatchObject({ execution: "succeeded", runtimeCurrent: true });
    const [summary] = await budgets.planningSummary(f.home, "company", f.home);
    expect(summary?.summary).toMatchObject({ observedAmount: 3 });
    await expect(service().review(f.actor, f.home, draft.id, 0)).rejects.toMatchObject({ status: 403 });
    expect((await service().verify(f.actor, f.home, draft.id, input.requestId, await reviewInput(input.requestId))).testQualified).toBe(true); expect(calls).toBe(1);
  });
  it("refuses a model ceiling above remaining agent budget before creating any test or debit", async () => {
    await budgetService(db).upsertPolicy(f.home, { scopeType: "agent", scopeId: f.presence.id, amount: 2, windowKind: "lifetime", hardStopEnabled: true }, f.userId);
    await expect(service().review(f.actor, f.home, draft.id, 0)).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(agentConfigurationTests).where(eq(agentConfigurationTests.companyId, f.home))).toEqual([]);
    expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.companyId, f.home))).toEqual([]); expect(calls).toBe(0);
  });
  it("protects an in-flight test from ordinary orphan recovery, then retains unknown spend at its persisted deadline", async () => {
    duringCall = async () => {
      const heartbeat = heartbeatService(db);
      await heartbeat.reapOrphanedRuns({ staleThresholdMs: 0 });
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.triggerDetail, "agent_safe_test")));
      expect(run?.status).toBe("running");
      const [test] = await db.select().from(agentConfigurationTests).where(eq(agentConfigurationTests.runId, run!.id));
      await db.update(orchestrationPlans).set({ startedAt: new Date(Date.now() - 301000) }).where(eq(orchestrationPlans.id, test!.planId));
      expect(await reconcileAgentDraftTest(db, run!)).toBe(true);
      expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id)))[0]).toMatchObject({ status: "failed", errorCode: "agent_test_outcome_unknown" });
    };
    const { input, result } = await execute(); expect(result).toMatchObject({ execution: "unknown", testQualified: false, result: null });
    expect((await service().start(f.actor, f.home, draft.id, input)).id).toBe(result.id); expect(calls).toBe(1);
  });
  it("retains readable history without qualification after the installed tariff expires", async () => {
    const { input } = await execute();
    profile.tariff.expiresAt = new Date(Date.now() - 1).toISOString();
    expect(await service().get(f.actor, f.home, draft.id, input.requestId)).toMatchObject({ execution: "succeeded", runtimeCurrent: false, testQualified: false });
    await expect(service().review(f.actor, f.home, draft.id, 0)).rejects.toMatchObject({ status: 409 });
    expect(calls).toBe(1);
  });
  it("retains Native budget exposure and correlation if the private candidate is physically erased", async () => {
    lostResponse = true; const { result } = await execute();
    await budgetService(db).upsertPolicy(f.home, { scopeType: "company", scopeId: f.home, amount: 6, windowKind: "lifetime", hardStopEnabled: true }, f.userId);
    await db.delete(agentConfigurationDrafts).where(eq(agentConfigurationDrafts.id, draft.id));
    expect((await db.select().from(agentConfigurationTests).where(eq(agentConfigurationTests.id, result.id)))[0]).toBeDefined();
    await expect(db.delete(agentConfigurationTests).where(eq(agentConfigurationTests.id, result.id))).rejects.toMatchObject({ cause: { code: "23514", message: "agent_test_original_request_retained" } });
    const [summary] = await budgetService(db).planningSummary(f.home, "company", f.home);
    expect(summary?.summary).toMatchObject({ observedAmount: 3 }); expect(calls).toBe(1);
  });
});
