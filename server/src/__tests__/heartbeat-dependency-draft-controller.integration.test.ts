import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { chmod, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, agentExecutionManifests, agentWakeupRequests, createDb, documentRevisions, documents, heartbeatRuns, issueDocuments, issues,
  nativeRunFinalizations, nativeRunResults, orchestrationModelReservations, orchestrationPlans, orchestrationWorkerAttempts, toolInvocations } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema, nativeRunInputSourceReceiptSchema } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { discoverNativeCapabilities } from "../services/native-provider-conformance.js";
import { workerModelGateway } from "../services/orchestration/worker-model-gateway.js";
import type { WorkerModelProfile } from "../services/orchestration/worker-model-profiles.js";
import type { guardedRemoteHttpFetch } from "../services/remote-http-fetch.js";
import { registerNativeDraftGateway } from "../services/orchestration/native-draft-runtime.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { issueService } from "../services/issues.js";
import { documentService } from "../services/documents.js";
import { heartbeatService } from "../services/heartbeat.js";
import {
  CHAT_CONTROL_RECOVERY_ADMISSION_KEY,
  CHAT_CONTROL_RECOVERY_UNRESOLVED_CODE,
  chatControlRecoveryAdmission,
  readChatControlRecoveryAdmission,
} from "../services/chat-control-recovery-stop.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { mcpGatewayProtocolRoutes } from "../routes/tool-gateway.js";
import { errorHandler } from "../middleware/index.js";

// This is the installed one-call text controller's software transport fixture,
// copied from v7-worker-model-gateway's actual-heartbeat case. It does not
// qualify OpenCode, an external provider, or a physical Sandbox Host.
const sourceSha = "a".repeat(40);
const credential = "fixture-private-worker-secret-12345";
const support = await getEmbeddedPostgresTestSupport();
if (!support.supported) throw new Error(`Dependency draft fixture requires embedded PostgreSQL: ${support.reason}`);

async function makeWritable(target: string): Promise<void> {
  const metadata = await lstat(target).catch(() => null);
  if (!metadata || metadata.isSymbolicLink()) return;
  await chmod(target, metadata.isDirectory() ? 0o700 : 0o600);
  if (metadata.isDirectory()) for (const name of await readdir(target)) await makeWritable(join(target, name));
}

describe("dependency scheduling through the installed Native text draft controller", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let home = "";
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "dependency-native-draft-"));
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "dependency-native-draft");
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "private-fixture-signing-master-123456789");
    database = await startEmbeddedPostgresTestDatabase("dependency-native-draft-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
    await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({ enableNativeRunner: true, enableWorkflowsV1: true,
      role_packs_v5: false, skill_resolver_v5: false, readiness_engine_v7: true, orchestration_v7: true });
  }, 60_000);
  afterAll(async () => {
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (home) { await makeWritable(home); await rm(home, { recursive: true, force: true }); }
  });

  async function seedInstalledDraft() {
    const f = await seedV5Presences(db);
    // Seed the current Human once; reuse that same authenticated actor for all
    // source, provider and Plan operations rather than invalidating its session.
    const human = await seedCurrentHumanSourceActor(db, [f.home], f.userId);
    const profileId = randomUUID();
    const model = "fixture-worker-model-20261005";
    await db.update(agents).set({ adapterType: "paperclip_runner",
      adapterConfig: { provider: "aw_text_only", workerModelProfileId: profileId, model,
        maxOutputTokens: 256, lifecycleMode: "per_turn" },
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: 1 } },
    }).where(eq(agents.id, f.presence.id));
    const providers = agentProviderBindingService(db);
    const provider = await providers.create(human, f.home, f.presence.id, { providerType: "paperclip_native",
      providerAgentRef: f.presence.id, isolationMode: "isolated_per_presence", providerEndpointRef: null });
    await providers.attach(human, f.home, f.presence.id, { providerBindingId: provider.id, providerProfileRef: f.presence.id });
    const [presence] = await db.select().from(agents).where(eq(agents.id, f.presence.id));
    if (!presence) throw new Error("dependency_draft_presence_missing");
    const advertised = await discoverNativeCapabilities({ companyId: f.home, adapterType: "paperclip_runner", config: presence.adapterConfig });
    // Same explicit software-fixture protocol metadata as the existing v7
    // text-controller fixture. No live/provider/pilot qualification is claimed.
    const recorded = await providers.recordDiscovery(f.home, f.presence.id, advertised, {
      connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true,
    });
    await providers.revalidate(human, f.home, f.presence.id, recorded.capabilitySnapshotHash!,
      "Review the existing controlled draft-only software contract; no live provider qualification claimed");
    const qualified = await providers.assertRuntime(f.home, f.presence.id);
    if (!qualified.provider.capabilitySnapshotHash || !qualified.runtime.qualifiedConfigurationHash)
      throw new Error("dependency_draft_current_profile_missing");
    const connection = await aiConnectionService(db).save(f.home, f.userId, {
      provider: "anthropic", method: "api_key", ownership: "shared", name: "Controlled dependency draft fixture",
      apiKey: "fixture", allAgents: false, agentIds: [f.presence.id],
    }, credential);
    const profile: WorkerModelProfile = { id: profileId, companyId: f.home, workerAgentId: f.presence.id,
      providerBindingId: qualified.provider.id, providerSnapshotHash: qualified.provider.capabilitySnapshotHash,
      providerProfileRef: qualified.runtime.providerProfileRef, qualifiedConfigurationHash: qualified.runtime.qualifiedConfigurationHash,
      binding: { provider: "anthropic", method: "api_key", mode: "shared", ...connection },
      transport: "server-text-only-v1", contract: "anthropic-text-messages-2023-06-01", maximumEnvelopeBytes: 64000,
      inputTokensUpperBound: 100000, maxOutputTokens: 1024,
      // Existing v7 fixture tariff, not a commercial price or live qualification.
      tariff: { provider: "anthropic", model, currency: "USD", inputMinorPerMillion: 0, outputMinorPerMillion: 0,
        fixedMinor: 3, qualificationHash: "b".repeat(64), sourceSha, testedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 120_000).toISOString() },
      qualificationEvidenceRef: "https://protected.test.invalid/qualification/worker-fixture-only.json",
      qualificationArtifactSha256: "c".repeat(64) };

    return { f, human, profile, model };
  }

  it("keeps a one-document Task idle while blocked, then completes one scheduler Run for Human review", async () => {
    const { f, human, profile, model } = await seedInstalledDraft();

    const tasks = issueService(db);
    const blocker = await tasks.create(f.home, { title: "Human dependency", description: "A Human must resolve this dependency.",
      status: "todo", responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
      { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const draft = await tasks.create(f.home, { title: "Draft after the Human dependency resolves",
      description: "Retain one internal text document for Human review; no tools or external side effects.",
      status: "todo", workMode: "standard", responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
      { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const task = await tasks.update(draft.id, { assigneeAgentId: f.presence.id, blockedByIssueIds: [blocker.id],
      actorUserId: f.userId, privacyActor: human });
    if (!task) throw new Error("dependency_draft_task_missing");
    expect(nativePayloadSourceSnapshotSchema.safeParse(task.payloadSourceSnapshot).success).toBe(true);

    let calls = 0, planId = "", observedBody = "";
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      calls++;
      expect(calls).toBe(1);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      observedBody = String(init.body);
      expect(JSON.parse(observedBody)).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(observedBody).tools).toBeUndefined();
      const dispatched = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, planId));
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: "The dependency is resolved. Retained internal draft for Human review." }],
        usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    const consumer = workerModelGateway(db, { profiles: [profile], sourceSha,
      protectedEvidenceOrigin: "https://protected.test.invalid", fetch });
    const app = express(); app.use(express.json()); app.use(mcpGatewayProtocolRoutes(createToolGatewayService(db))); app.use(errorHandler);
    const server = createServer(app);
    const priorApiUrl = process.env.PAPERCLIP_API_URL;
    let heartbeat: ReturnType<typeof heartbeatService> | undefined;
    const substitution = vi.fn(() => { throw new Error("Installed draft controller must not use the provider backend seam"); });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("dependency_draft_api_listener_missing");
      process.env.PAPERCLIP_API_URL = `http://127.0.0.1:${address.port}`;
      registerNativeDraftGateway(db, consumer);
      heartbeat = heartbeatService(db, { nativeSessionBackendFactory: substitution });
      expect((await request(server).post("/mcp/gateways/not-a-token")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })).status).toBe(401);
      const plans = orchestrationService(db);
      const plan = await plans.create(human, f.home, { issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(),
        workload: "semantic", riskClass: "C0", completionContract: { objective: "Retain one internal draft after its dependency resolves",
          requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["Human review remains required"] },
        budgets: { maxModelCostMinor: 6, maxToolActions: 3 }, workers: [{ key: "native-writer", issueId: task.id }] });
      planId = plan.id;
      await plans.decide(human, f.home, plan.id, { expectedVersion: plan.version, action: "start",
        rationale: "Start the existing bounded text controller only after dependency scheduling admits the Task" });
      const blockedWake = await heartbeat.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: f.userId, payload: { issueId: task.id },
        contextSnapshot: { issueId: task.id, wakeReason: "issue_assigned" } });
      expect(blockedWake).toBeNull();
      const blockedRequests = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.agentId, f.presence.id),
        eq(agentWakeupRequests.reason, "issue_dependencies_blocked")));
      expect(blockedRequests).toHaveLength(1);
      expect(blockedRequests[0]).toMatchObject({ status: "skipped" });
      expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).toEqual([]);
      expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id))).toEqual([]);
      expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id))).toEqual([]);
      expect(calls).toBe(0);
      expect(substitution).not.toHaveBeenCalled();

      await tasks.update(blocker.id, { status: "done", actorUserId: f.userId, privacyActor: human });
      const readyWake = await heartbeat.wakeup(f.presence.id, { source: "automation", triggerDetail: "system", reason: "issue_blockers_resolved",
        requestedByActorType: "user", requestedByActorId: f.userId, payload: { issueId: task.id },
        contextSnapshot: { issueId: task.id, wakeReason: "issue_blockers_resolved" } });
      expect(readyWake).not.toBeNull();
      await heartbeat.drainActiveRunExecutions();
      const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home));
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ id: readyWake!.id, nativeIssueId: task.id, responsibleUserId: f.userId,
        runtimeMode: "native", driverKind: "aw_text_messages", status: "succeeded", error: null });
      const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ runId: readyWake!.id, agentId: f.presence.id });
      const manifests = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, readyWake!.id));
      expect(manifests).toHaveLength(1);
      expect(attempts[0]!.executionManifestId).toBe(manifests[0]!.id);
      const reservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ workerAttemptId: attempts[0]!.id, status: "completed", maximumMinor: 3,
        usage: { inputTokens: 10, outputTokens: 20 } });
      expect((await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id)))[0])
        .toMatchObject({ toolActionsUsed: 2, modelCostReserved: 3 });
      expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, readyWake!.id)))
        .toEqual([expect.objectContaining({ schemaStatus: "accepted" })]);
      const receipt = nativeRunInputSourceReceiptSchema.parse(runs[0]!.runnerProfileJson?.nativeInputSourceReceipt);
      expect(receipt.binding).toMatchObject({ companyId: f.home, agentId: f.presence.id, issueId: task.id, runId: readyWake!.id });
      expect(receipt.bootstrap.inputs.map(source => source.kind)).toEqual(expect.arrayContaining(["task", "context", "workspace_metadata"]));
      expect((await documentService(db).getIssueDocumentByKey(task.id, "result"))?.body)
        .toBe("The dependency is resolved. Retained internal draft for Human review.");
      const revisions = await db.select({ revision: documentRevisions }).from(issueDocuments)
        .innerJoin(documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
        .innerJoin(documentRevisions, and(eq(documentRevisions.companyId, documents.companyId),
          eq(documentRevisions.id, documents.latestRevisionId), eq(documentRevisions.documentId, documents.id)))
        .where(and(eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
      expect(revisions).toHaveLength(1);
      expect(revisions[0]!.revision.payloadSourceProtocolVersion).toBe(1);
      const outputSources = nativePayloadSourceSnapshotSchema.parse(revisions[0]!.revision.payloadSourceSnapshot);
      expect(outputSources.inputs.map(source => source.kind)).toEqual(expect.arrayContaining([
        "task", "completion_contract", "runtime_instructions", "worker_model_dispatch",
      ]));
      const wireIntents = runs[0]!.runnerProfileJson?.nativeAwModelWireIntents;
      if (!Array.isArray(wireIntents) || wireIntents.length !== 1) throw new Error("dependency_draft_wire_intent_missing");
      const wireIntent: unknown = wireIntents[0];
      if (!wireIntent || typeof wireIntent !== "object" || !("requestHash" in wireIntent) || !("wireBodyHash" in wireIntent))
        throw new Error("dependency_draft_wire_intent_invalid");
      expect(wireIntent.requestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(wireIntent.wireBodyHash).toMatch(/^[a-f0-9]{64}$/);
      expect(outputSources.inputs).toContainEqual(expect.objectContaining({
        kind: "worker_model_dispatch", runId: readyWake!.id, reservationId: reservations[0]!.id,
        requestHash: wireIntent.requestHash, wireBodyHash: wireIntent.wireBodyHash,
      }));
      expect((await db.select().from(issues).where(eq(issues.id, task.id)))[0]!.status).not.toBe("done");
      expect(observedBody).toContain("assignedRuntimeContext");
      expect(observedBody).not.toContain(credential);
      expect(calls).toBe(1);
      expect(substitution).not.toHaveBeenCalled();
    } finally {
      try { await heartbeat?.drainActiveRunExecutions(); }
      finally {
        registerNativeDraftGateway(db, undefined);
        if (priorApiUrl === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = priorApiUrl;
        server.closeAllConnections();
        if (server.listening)
          await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    }
  }, 60_000);
  it("keeps a second one-document Plan queued until the first scheduler Run releases capacity", async () => {
    const { f, human, profile, model } = await seedInstalledDraft();
    const tasks = issueService(db);
    const plans = orchestrationService(db);
    const taskPlans: { task: Awaited<ReturnType<typeof tasks.create>>; plan: Awaited<ReturnType<typeof plans.create>> }[] = [];
    let releaseFirst!: () => void;
    const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
    let calls = 0;
    const dispatchedPlanIds: string[] = [];
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      const call = ++calls;
      expect(call).toBeLessThanOrEqual(2);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      const body = String(init.body);
      expect(JSON.parse(body)).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(body).tools).toBeUndefined();
      expect(body).toContain("assignedRuntimeContext");
      expect(body).not.toContain(credential);
      const current = taskPlans[call - 1]!;
      const reservations = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, current.plan.id));
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
      dispatchedPlanIds.push(current.plan.id);
      if (call === 1) await firstResponse;
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: `Internal draft ${call} retained for Human review.` }],
        usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    const consumer = workerModelGateway(db, { profiles: [profile], sourceSha,
      protectedEvidenceOrigin: "https://protected.test.invalid", fetch });
    const app = express(); app.use(express.json()); app.use(mcpGatewayProtocolRoutes(createToolGatewayService(db))); app.use(errorHandler);
    const server = createServer(app);
    const priorApiUrl = process.env.PAPERCLIP_API_URL;
    let heartbeat: ReturnType<typeof heartbeatService> | undefined;
    const substitution = vi.fn(() => { throw new Error("Installed draft controller must not use the provider backend seam"); });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("capacity_draft_api_listener_missing");
      process.env.PAPERCLIP_API_URL = `http://127.0.0.1:${address.port}`;
      registerNativeDraftGateway(db, consumer);
      heartbeat = heartbeatService(db, { nativeSessionBackendFactory: substitution });
      for (const ordinal of [1, 2]) {
        const draft = await tasks.create(f.home, { title: `Capacity-controlled internal draft ${ordinal}`,
          description: "Retain one internal text document for Human review; no interactive tools or external effects.",
          status: "todo", workMode: "standard", responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
          { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
        const task = await tasks.update(draft.id, { assigneeAgentId: f.presence.id, actorUserId: f.userId, privacyActor: human });
        if (!task) throw new Error("capacity_draft_task_missing");
        const plan = await plans.create(human, f.home, { issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(),
          workload: "semantic", riskClass: "C0", completionContract: { objective: `Retain internal draft ${ordinal} for Human review`,
            requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["Human review remains required"] },
          budgets: { maxModelCostMinor: 6, maxToolActions: 3 }, workers: [{ key: "native-writer", issueId: task.id }] });
        await plans.decide(human, f.home, plan.id, { expectedVersion: plan.version, action: "start",
          rationale: "Admit the existing one-call document controller subject to actual scheduler capacity" });
        taskPlans.push({ task, plan });
      }
      const wake = (issueId: string) => heartbeat!.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system",
        reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: f.userId,
        payload: { issueId }, contextSnapshot: { issueId, wakeReason: "issue_assigned" } });
      const first = await wake(taskPlans[0]!.task.id);
      expect(first).not.toBeNull();
      try {
        await vi.waitFor(() => {
          expect(calls).toBe(1);
          expect(dispatchedPlanIds).toEqual([taskPlans[0]!.plan.id]);
        }, { timeout: 10_000, interval: 25 });
      } catch {
        const [run] = await db.select({ status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode,
          nativePhase: heartbeatRuns.nativePhase }).from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, first!.id)));
        const category = (value: unknown) => typeof value === "string"
          ? (/^[a-z0-9_:-]{1,96}$/i.test(value) ? value : "other") : null;
        throw new Error(`capacity_draft_first_dispatch_wait_failed:${JSON.stringify({
          status: category(run?.status), errorCode: category(run?.errorCode), nativePhase: category(run?.nativePhase),
        })}`);
      }
      const activeRun = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, first!.id)))[0];
      expect(activeRun).toMatchObject({ status: "running", errorCode: null });
      expect(activeRun?.wakeupRequestId).toBeTruthy();
      const second = await wake(taskPlans[1]!.task.id);
      expect(second).not.toBeNull();
      expect(second!.id).not.toBe(first!.id);
      const queued = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, second!.id));
      expect(queued[0]).toMatchObject({ status: "queued", contextSnapshot: { issueId: taskPlans[1]!.task.id } });
      expect(calls).toBe(1);
      expect(dispatchedPlanIds).toEqual([taskPlans[0]!.plan.id]);
      expect(await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, taskPlans[1]!.plan.id))).toEqual([]);
      expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, second!.id))).toEqual([]);
      // The first real Native text-controller HTTP request is still held above.
      // Age its actual Run row, then ask a second service instance to reap it.
      // The module-shared activeRunExecutions ownership guard must retain the
      // original running Run and claimed assignment wake until the owner settles.
      await db.update(heartbeatRuns).set({ updatedAt: new Date("2026-03-19T00:00:00.000Z") })
        .where(eq(heartbeatRuns.id, first!.id));
      const reaperHeartbeat = heartbeatService(db);
      expect(await reaperHeartbeat.reapOrphanedRuns({ staleThresholdMs: 1 }))
        .toEqual({ reaped: 0, runIds: [] });
      const heldRun = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, first!.id)))[0];
      expect(heldRun).toMatchObject({ id: first!.id, status: "running", errorCode: null });
      const heldWake = (await db.select().from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.id, activeRun!.wakeupRequestId!)))[0];
      expect(heldWake).toMatchObject({ status: "claimed", runId: first!.id });
      expect(substitution).not.toHaveBeenCalled();
      releaseFirst();
      await heartbeat.drainActiveRunExecutions();
      const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home));
      expect(runs).toHaveLength(2);
      expect(dispatchedPlanIds).toEqual(taskPlans.map(({ plan }) => plan.id));
      expect(calls).toBe(2);
      for (const [index, { task, plan }] of taskPlans.entries()) {
        const runId = index === 0 ? first!.id : second!.id;
        const run = runs.find(candidate => candidate.id === runId);
        expect(run).toMatchObject({ nativeIssueId: task.id, responsibleUserId: f.userId,
          runtimeMode: "native", driverKind: "aw_text_messages", status: "succeeded", error: null });
        const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id));
        expect(attempts).toHaveLength(1);
        expect(attempts[0]).toMatchObject({ runId, agentId: f.presence.id });
        const manifests = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, runId));
        expect(manifests).toHaveLength(1);
        expect(attempts[0]!.executionManifestId).toBe(manifests[0]!.id);
        const reservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
        expect(reservations).toHaveLength(1);
        expect(reservations[0]).toMatchObject({ workerAttemptId: attempts[0]!.id, status: "completed", maximumMinor: 3,
          usage: { inputTokens: 10, outputTokens: 20 } });
        expect((await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id)))[0])
          .toMatchObject({ toolActionsUsed: 2, modelCostReserved: 3 });
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, runId)))
          .toEqual([expect.objectContaining({ schemaStatus: "accepted" })]);
        const receipt = nativeRunInputSourceReceiptSchema.parse(run?.runnerProfileJson?.nativeInputSourceReceipt);
        expect(receipt.binding).toMatchObject({ companyId: f.home, agentId: f.presence.id, issueId: task.id, runId });
        expect((await documentService(db).getIssueDocumentByKey(task.id, "result"))?.body)
          .toBe(`Internal draft ${index + 1} retained for Human review.`);
        const revisions = await db.select({ revision: documentRevisions }).from(issueDocuments)
          .innerJoin(documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
          .innerJoin(documentRevisions, and(eq(documentRevisions.companyId, documents.companyId),
            eq(documentRevisions.id, documents.latestRevisionId), eq(documentRevisions.documentId, documents.id)))
          .where(and(eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
        expect(revisions).toHaveLength(1);
        const source = nativePayloadSourceSnapshotSchema.parse(revisions[0]!.revision.payloadSourceSnapshot);
        const intents = run?.runnerProfileJson?.nativeAwModelWireIntents;
        if (!Array.isArray(intents) || intents.length !== 1) throw new Error("capacity_draft_wire_intent_missing");
        const intent: unknown = intents[0];
        if (!intent || typeof intent !== "object" || !("requestHash" in intent) || !("wireBodyHash" in intent))
          throw new Error("capacity_draft_wire_intent_invalid");
        expect(intent.requestHash).toMatch(/^[a-f0-9]{64}$/);
        expect(intent.wireBodyHash).toMatch(/^[a-f0-9]{64}$/);
        expect(source.inputs).toContainEqual(expect.objectContaining({ kind: "worker_model_dispatch", runId,
          reservationId: reservations[0]!.id, requestHash: intent.requestHash, wireBodyHash: intent.wireBodyHash }));
        expect((await db.select().from(issues).where(eq(issues.id, task.id)))[0]!.status).not.toBe("done");
      }
      expect(substitution).not.toHaveBeenCalled();
    } finally {
      releaseFirst();
      try { await heartbeat?.drainActiveRunExecutions(); }
      finally {
        registerNativeDraftGateway(db, undefined);
        if (priorApiUrl === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = priorApiUrl;
        server.closeAllConnections();
        if (server.listening)
          await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    }
  }, 60_000);
  it("runs unrelated assigned Native Text tasks concurrently under separate issue claims", async () => {
    const fixture = await seedInstalledDraft();
    const { f, model } = fixture;
    await db.update(agents).set({ runtimeConfig: { heartbeat: {
      enabled: false, wakeOnDemand: true, maxConcurrentRuns: 2,
    } } }).where(eq(agents.id, f.presence.id));

    const entries: Awaited<ReturnType<typeof createDraftPlan>>[] = [];
    const dispatchedPlanIds: string[] = [];
    let closing = false;
    const releaseResponses: Array<() => void> = [];
    let calls = 0;
    const output = (ordinal: number) => `Unrelated Native draft ${ordinal} retained for Human review.`;
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      const ordinal = ++calls;
      expect(ordinal).toBeLessThanOrEqual(2);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      const body = String(init.body);
      expect(JSON.parse(body)).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(body).tools).toBeUndefined();
      expect(body).toContain("assignedRuntimeContext");
      expect(body).not.toContain(credential);
      const entry = entries[ordinal - 1];
      if (!entry) throw new Error("unrelated_native_draft_plan_missing");
      dispatchedPlanIds.push(entry.plan.id);
      const reservations = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, entry.plan.id));
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
      await new Promise<void>(resolve => {
        if (closing) resolve();
        else releaseResponses.push(resolve);
      });
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: output(ordinal) }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      const releaseBoth = () => { for (const release of releaseResponses.splice(0)) release(); };
      try {
        entries.push(await createDraftPlan(fixture, "Unrelated issue claim one"));
        entries.push(await createDraftPlan(fixture, "Unrelated issue claim two"));
        expect(entries[0]!.task.id).not.toBe(entries[1]!.task.id);
        const wake = (issueId: string) => heartbeat.wakeup(f.presence.id, {
          source: "assignment", triggerDetail: "system", reason: "issue_assigned",
          requestedByActorType: "user", requestedByActorId: f.userId,
          payload: { issueId }, contextSnapshot: { issueId, wakeReason: "issue_assigned" },
        });
        const first = await wake(entries[0]!.task.id);
        expect(first).not.toBeNull();
        await vi.waitFor(() => { expect(calls).toBe(1); }, { timeout: 10_000, interval: 25 });
        const second = await wake(entries[1]!.task.id);
        expect(second).not.toBeNull();
        expect(second!.id).not.toBe(first!.id);
        await vi.waitFor(() => { expect(calls).toBe(2); }, { timeout: 10_000, interval: 25 });

        const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home));
        expect(runs).toHaveLength(2);
        expect(new Set(runs.map(run => run.id))).toEqual(new Set([first!.id, second!.id]));
        expect(dispatchedPlanIds).toHaveLength(2);
        expect(new Set(dispatchedPlanIds)).toEqual(new Set(entries.map(entry => entry.plan.id)));
        for (const [index, entry] of entries.entries()) {
          const runId = index === 0 ? first!.id : second!.id;
          const run = runs.find(candidate => candidate.id === runId);
          expect(run).toMatchObject({ nativeIssueId: entry.task.id, responsibleUserId: f.userId,
            runtimeMode: "native", driverKind: "aw_text_messages", status: "running", error: null });
          const [issue] = await db.select().from(issues).where(eq(issues.id, entry.task.id));
          expect(issue).toMatchObject({ assigneeAgentId: f.presence.id, executionRunId: runId });
          const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, entry.plan.id));
          expect(attempts).toHaveLength(1);
          expect(attempts[0]).toMatchObject({ runId, agentId: f.presence.id });
          expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entry.plan.id)))
            .toEqual([expect.objectContaining({ status: "dispatched", workerAttemptId: attempts[0]!.id })]);
          expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, runId))).toEqual([]);
          expect(await documentService(db).getIssueDocumentByKey(entry.task.id, "result")).toBeNull();
        }
        expect(calls).toBe(2);
        releaseBoth();
        await heartbeat.drainActiveRunExecutions();
        for (const [index, entry] of entries.entries()) {
          const runId = index === 0 ? first!.id : second!.id;
          await assertCompletedDraft(fixture, entry, runId, output(index + 1));
        }
        expect(calls).toBe(2);
        expect(new Set(dispatchedPlanIds)).toEqual(new Set(entries.map(entry => entry.plan.id)));
      } finally {
        closing = true;
        releaseBoth();
      }
    });
  }, 60_000);

  // Same current-Human/Plan and installed HTTP/listener owners as the two
  // cases above. The new cases share only their identical local setup/proofs.
  async function createDraftPlan(fixture: Awaited<ReturnType<typeof seedInstalledDraft>>, title: string) {
    const { f, human } = fixture;
    const tasks = issueService(db), plans = orchestrationService(db);
    const draft = await tasks.create(f.home, { title, description: "Retain one internal document for Human review; no interactive tools or external effects.",
      status: "todo", workMode: "standard", responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
      { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const task = await tasks.update(draft.id, { assigneeAgentId: f.presence.id, actorUserId: f.userId, privacyActor: human });
    if (!task) throw new Error("dependency_domain_draft_missing");
    const plan = await plans.create(human, f.home, { issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(),
      workload: "semantic", riskClass: "C0", completionContract: { objective: title,
        requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["Human review remains required"] },
      budgets: { maxModelCostMinor: 6, maxToolActions: 3 }, workers: [{ key: "native-writer", issueId: task.id }] });
    await plans.decide(human, f.home, plan.id, { expectedVersion: plan.version, action: "start",
      rationale: "Admit one eligible internal document through the installed controller and real scheduler" });
    return { task, plan };
  }

  async function withInstalledDraftTransport(fixture: Awaited<ReturnType<typeof seedInstalledDraft>>,
    fetch: typeof guardedRemoteHttpFetch, drive: (heartbeat: ReturnType<typeof heartbeatService>) => Promise<void>,
    beforeChatControlRecoveryCheck?: (input: { runId: string; issueId: string; stage: "claim" | "dispatch" }) => Promise<void>,
    beforeNativeRuntimeSelection?: (runId: string) => Promise<void>) {
    const consumer = workerModelGateway(db, { profiles: [fixture.profile], sourceSha,
      protectedEvidenceOrigin: "https://protected.test.invalid", fetch });
    const app = express(); app.use(express.json()); app.use(mcpGatewayProtocolRoutes(createToolGatewayService(db))); app.use(errorHandler);
    const server = createServer(app), priorApiUrl = process.env.PAPERCLIP_API_URL;
    let heartbeat: ReturnType<typeof heartbeatService> | undefined;
    const substitution = vi.fn(() => { throw new Error("Installed draft controller must not use the provider backend seam"); });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("dependency_domain_api_listener_missing");
      process.env.PAPERCLIP_API_URL = `http://127.0.0.1:${address.port}`;
      registerNativeDraftGateway(db, consumer);
      heartbeat = heartbeatService(db, {
        nativeSessionBackendFactory: substitution,
        ...(beforeChatControlRecoveryCheck ? { beforeChatControlRecoveryCheck } : {}),
        ...(beforeNativeRuntimeSelection ? { beforeNativeRuntimeSelection } : {}),
      });
      await drive(heartbeat);
      expect(substitution).not.toHaveBeenCalled();
    } finally {
      try { await heartbeat?.drainActiveRunExecutions(); }
      finally {
        registerNativeDraftGateway(db, undefined);
        if (priorApiUrl === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = priorApiUrl;
        server.closeAllConnections();
        if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    }
  }

  async function assertCompletedDraft(fixture: Awaited<ReturnType<typeof seedInstalledDraft>>,
    entry: Awaited<ReturnType<typeof createDraftPlan>>, runId: string, body: string) {
    const { f } = fixture; const { task, plan } = entry;
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, runId)));
    expect(run).toMatchObject({ nativeIssueId: task.id, responsibleUserId: f.userId,
      runtimeMode: "native", driverKind: "aw_text_messages", status: "succeeded", error: null });
    const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, plan.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ runId, agentId: f.presence.id });
    const manifests = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, runId));
    expect(manifests).toHaveLength(1);
    expect(attempts[0]!.executionManifestId).toBe(manifests[0]!.id);
    const reservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ workerAttemptId: attempts[0]!.id, status: "completed", maximumMinor: 3,
      usage: { inputTokens: 10, outputTokens: 20 } });
    expect((await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id)))[0])
      .toMatchObject({ toolActionsUsed: 2, modelCostReserved: 3 });
    expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, runId)))
      .toEqual([expect.objectContaining({ schemaStatus: "accepted" })]);
    const receipt = nativeRunInputSourceReceiptSchema.parse(run?.runnerProfileJson?.nativeInputSourceReceipt);
    expect(receipt.binding).toMatchObject({ companyId: f.home, agentId: f.presence.id, issueId: task.id, runId });
    expect((await documentService(db).getIssueDocumentByKey(task.id, "result"))?.body)
      .toBe(body);
    const revisions = await db.select({ revision: documentRevisions }).from(issueDocuments)
      .innerJoin(documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
      .innerJoin(documentRevisions, and(eq(documentRevisions.companyId, documents.companyId),
        eq(documentRevisions.id, documents.latestRevisionId), eq(documentRevisions.documentId, documents.id)))
      .where(and(eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
    expect(revisions).toHaveLength(1);
    const source = nativePayloadSourceSnapshotSchema.parse(revisions[0]!.revision.payloadSourceSnapshot);
    const intents = run?.runnerProfileJson?.nativeAwModelWireIntents;
    if (!Array.isArray(intents) || intents.length !== 1) throw new Error("capacity_draft_wire_intent_missing");
    const intent: unknown = intents[0];
    if (!intent || typeof intent !== "object" || !("requestHash" in intent) || !("wireBodyHash" in intent))
      throw new Error("capacity_draft_wire_intent_invalid");
    expect(intent.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(intent.wireBodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(source.inputs).toContainEqual(expect.objectContaining({ kind: "worker_model_dispatch", runId,
      reservationId: reservations[0]!.id, requestHash: intent.requestHash, wireBodyHash: intent.wireBodyHash }));
    expect((await db.select().from(issues).where(eq(issues.id, task.id)))[0]!.status).not.toBe("done");
  }

  it("coalesces two durable status-wake domain inputs into one real installed-controller Run", async () => {
    const fixture = await seedInstalledDraft();
    const { f, model } = fixture;
    let entry: Awaited<ReturnType<typeof createDraftPlan>> | undefined;
    let calls = 0;
    const output = "One coalesced internal draft retained for Human review.";
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      expect(++calls).toBe(1);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(String(init.body)).tools).toBeUndefined();
      expect(String(init.body)).toContain("assignedRuntimeContext");
      expect(String(init.body)).not.toContain(credential);
      if (!entry) throw new Error("coalesced_draft_plan_missing");
      const reservations = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, entry.plan.id));
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: output }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      entry = await createDraftPlan(fixture, "Retain the coalesced status-wake draft");
      const issueId = entry.task.id;
      // Explicit dispatcher input-domain fixture only: these outbox inputs are
      // not evidence that a real Native status committer emitted them. Run,
      // attempt, manifest, reservation and accepted output remain owner-created.
      const payload = { issueId, taskId: issueId,
        _paperclipWakeContext: { issueId, taskId: issueId, source: "native_status_decision" } };
      const intents = await db.insert(agentWakeupRequests).values([
        { companyId: f.home, agentId: f.presence.id, source: "automation", triggerDetail: "system",
          reason: "issue_children_completed", payload, requestedByActorType: "system",
          requestedByActorId: "native-status-committer", idempotencyKey: `native-parent:${issueId}` },
        { companyId: f.home, agentId: f.presence.id, source: "automation", triggerDetail: "system",
          reason: "issue_blockers_resolved", payload, requestedByActorType: "system",
          requestedByActorId: "native-status-committer", idempotencyKey: `native-dependency:${issueId}` },
      ]).returning({ id: agentWakeupRequests.id });
      expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).toEqual([]);
      expect(await heartbeat.dispatchPendingNativeStatusWakeups({ companyId: f.home }))
        .toMatchObject({ scanned: 2, dispatched: 1, recovered: 1 });
      await heartbeat.drainActiveRunExecutions();
      const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home));
      expect(runs).toHaveLength(1);
      const deliveries = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, f.home),
        inArray(agentWakeupRequests.requestedByActorId, intents.map(intent => `native-status-wake-dispatch:${intent.id}`))));
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.runId).toBe(runs[0]!.id);
      expect(runs[0]).toMatchObject({ contextSnapshot: { source: "native_status_decision", statusDecisionSource: "native_status_decision" } });
      const persisted = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, f.home),
        inArray(agentWakeupRequests.id, intents.map(intent => intent.id))));
      expect(persisted).toHaveLength(2);
      for (const intent of persisted) expect(intent).toMatchObject({ status: "coalesced", runId: runs[0]!.id });
      await assertCompletedDraft(fixture, entry, runs[0]!.id, output);
      expect(calls).toBe(1);
    });
  }, 60_000);

  it("cancels a genuinely queued Task after a Human adds its blocker, repairs its stale pointer, and completes ready work", async () => {
    const fixture = await seedInstalledDraft();
    const { f, human, model } = fixture;
    const entries: Awaited<ReturnType<typeof createDraftPlan>>[] = [];
    const dispatchedPlans: string[] = [];
    let calls = 0;
    let releaseHolder!: () => void;
    const holderResponse = new Promise<void>(resolve => { releaseHolder = resolve; });
    const output = (ordinal: number) => `Queue repair internal draft ${ordinal} retained for Human review.`;
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      const ordinal = ++calls;
      expect(ordinal).toBeLessThanOrEqual(2);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
      expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
      expect(JSON.parse(String(init.body)).tools).toBeUndefined();
      expect(String(init.body)).toContain("assignedRuntimeContext");
      expect(String(init.body)).not.toContain(credential);
      const entry = entries[ordinal === 1 ? 0 : 2];
      if (!entry) throw new Error("queue_repair_dispatch_plan_missing");
      const reservations = await db.select().from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, entry.plan.id));
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
      dispatchedPlans.push(entry.plan.id);
      if (ordinal === 1) await holderResponse;
      return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
        content: [{ type: "text", text: output(ordinal) }], usage: { input_tokens: 10, output_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
    await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
      try {
        for (const title of ["Capacity holder draft", "Draft blocked after queue admission", "Independent ready draft"])
          entries.push(await createDraftPlan(fixture, title));
        const wake = (issueId: string) => heartbeat.wakeup(f.presence.id, { source: "assignment", triggerDetail: "system",
          reason: "issue_assigned", requestedByActorType: "user", requestedByActorId: f.userId,
          payload: { issueId }, contextSnapshot: { issueId, wakeReason: "issue_assigned" } });
        const holder = await wake(entries[0]!.task.id);
        expect(holder).not.toBeNull();
        await vi.waitFor(() => { expect(calls).toBe(1); expect(dispatchedPlans).toEqual([entries[0]!.plan.id]); },
          { timeout: 10_000, interval: 25 });
        const blocked = await wake(entries[1]!.task.id), ready = await wake(entries[2]!.task.id);
        expect(blocked).not.toBeNull(); expect(ready).not.toBeNull();
        expect(new Set([holder!.id, blocked!.id, ready!.id]).size).toBe(3);
        for (const id of [blocked!.id, ready!.id])
          expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, id)))[0]?.status).toBe("queued");
        const [modernQueuedIssue] = await db.select().from(issues).where(eq(issues.id, entries[1]!.task.id));
        expect(modernQueuedIssue).toMatchObject({ executionRunId: null, executionAgentNameKey: null, executionLockedAt: null });
        expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, entries[1]!.plan.id))).toEqual([]);
        expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entries[1]!.plan.id))).toEqual([]);
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, blocked!.id))).toEqual([]);
        // Explicit legacy/corrupt persisted-pointer input: the actual scheduler
        // created this queued Run above. This does not claim a real modern
        // execution owner stamped the pointer, or fabricate a running/accepted Run.
        const legacyPointer = { executionRunId: blocked!.id, executionAgentNameKey: "fixture-legacy-queued-owner",
          executionLockedAt: new Date() };
        await db.update(issues).set(legacyPointer).where(and(eq(issues.companyId, f.home), eq(issues.id, entries[1]!.task.id)));
        expect((await db.select().from(issues).where(eq(issues.id, entries[1]!.task.id)))[0]).toMatchObject(legacyPointer);
        const tasks = issueService(db);
        const blocker = await tasks.create(f.home, { title: "Human-added unresolved prerequisite", status: "todo",
          responsibleUserId: f.userId, createdByUserId: f.userId }, db, undefined,
          { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
        await tasks.update(entries[1]!.task.id, { blockedByIssueIds: [blocker.id], actorUserId: f.userId, privacyActor: human });
        expect((await db.select().from(issues).where(eq(issues.id, entries[1]!.task.id)))[0]).toMatchObject(legacyPointer);
        expect(calls).toBe(1);
        releaseHolder();
        await heartbeat.drainActiveRunExecutions();
        await heartbeat.resumeQueuedRuns();
        await heartbeat.drainActiveRunExecutions();
        const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home));
        expect(runs).toHaveLength(3);
        const blockedRun = runs.find(run => run.id === blocked!.id);
        expect(blockedRun).toMatchObject({ status: "cancelled", errorCode: "issue_dependencies_blocked",
          resultJson: expect.objectContaining({ stopReason: "issue_dependencies_blocked" }) });
        expect(blockedRun!.finishedAt).toBeInstanceOf(Date);
        const [blockedWake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, blockedRun!.wakeupRequestId!));
        expect(blockedWake).toMatchObject({ status: "skipped" });
        expect(blockedWake!.error).toContain("dependencies are still blocked");
        expect((await db.select().from(issues).where(eq(issues.id, entries[1]!.task.id)))[0])
          .toMatchObject({ executionRunId: null, executionAgentNameKey: null, executionLockedAt: null });
        expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, entries[1]!.plan.id))).toEqual([]);
        expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entries[1]!.plan.id))).toEqual([]);
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, blocked!.id))).toEqual([]);
        expect(await db.select().from(toolInvocations).where(and(eq(toolInvocations.companyId, f.home), eq(toolInvocations.runId, blocked!.id)))).toEqual([]);
        expect(await documentService(db).getIssueDocumentByKey(entries[1]!.task.id, "result")).toBeNull();
        expect(dispatchedPlans).toEqual([entries[0]!.plan.id, entries[2]!.plan.id]);
        expect(calls).toBe(2);
        await assertCompletedDraft(fixture, entries[0]!, holder!.id, output(1));
        await assertCompletedDraft(fixture, entries[2]!, ready!.id, output(2));
        expect(runs.every(run => run.status !== "queued" && run.status !== "running")).toBe(true);
      } finally { releaseHolder(); }
    });
  }, 60_000);

  it.each(["intact", "lost", "copied"] as const)(
    "persists and consumes the chat-control admission marker on a real Native Text C0 Plan: %s",
    async mode => {
      const fixture = await seedInstalledDraft();
      const { f, model } = fixture;
      const entries: Awaited<ReturnType<typeof createDraftPlan>>[] = [];
      const wakeIds: string[] = [];
      let releaseFirst!: () => void;
      const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
      let calls = 0;
      const dispatchedPlanIds: string[] = [];
      const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
        const call = ++calls;
        expect(call).toBeLessThanOrEqual(2);
        expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
        expect(new Headers(init.headers).get("x-api-key")).toBe(credential);
        expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 256 });
        expect(JSON.parse(String(init.body)).tools).toBeUndefined();
        expect(String(init.body)).toContain("assignedRuntimeContext");
        expect(String(init.body)).not.toContain(credential);
        const entry = entries[call - 1];
        if (!entry) throw new Error("marker_native_draft_plan_missing");
        dispatchedPlanIds.push(entry.plan.id);
        const reservations = await db.select().from(orchestrationModelReservations)
          .where(eq(orchestrationModelReservations.planId, entry.plan.id));
        expect(reservations).toHaveLength(1);
        expect(reservations[0]).toMatchObject({ status: "dispatched", maximumMinor: 3 });
        if (call === 1) await firstResponse;
        return new Response(JSON.stringify({ type: "message", role: "assistant", model, stop_reason: "end_turn",
          content: [{ type: "text", text: `Marker ${call} internal draft retained for Human review.` }],
          usage: { input_tokens: 10, output_tokens: 20 } }),
        { status: 200, headers: { "content-type": "application/json" } });
      };
      let secondDispatchMarkerObserved = false;
      await withInstalledDraftTransport(fixture, fetch, async heartbeat => {
        try {
          entries.push(await createDraftPlan(fixture, "Marker admission holder draft"));
          entries.push(await createDraftPlan(fixture, "Marker admission queued draft"));
          // Domain-shaped user-origin automation input matching issue-comment wake provenance;
          // it claims no HTTP-route execution or system continuation ancestry.
          const userAutomationWake = (issueId: string) => heartbeat.wakeup(f.presence.id, {
            source: "automation", triggerDetail: "system", reason: "issue_commented",
            requestedByActorType: "user", requestedByActorId: f.userId,
            payload: { issueId, mutation: "comment" },
            contextSnapshot: { issueId, taskId: issueId, wakeReason: "issue_commented", source: "issue.comment" },
          });
          const first = await userAutomationWake(entries[0]!.task.id);
          expect(first).not.toBeNull();
          wakeIds.push(first!.id);
          expect(first).toMatchObject({ invocationSource: "automation" });
          await vi.waitFor(() => {
            expect(calls).toBe(1);
            expect(dispatchedPlanIds).toEqual([entries[0]!.plan.id]);
          }, { timeout: 10_000, interval: 25 });
          const [activeFirst] = await db.select().from(heartbeatRuns)
            .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, first!.id)));
          expect(activeFirst).toMatchObject({ invocationSource: "automation", runtimeMode: "native", driverKind: "aw_text_messages", status: "running" });

          const second = await userAutomationWake(entries[1]!.task.id);
          expect(second).not.toBeNull();
          wakeIds.push(second!.id);
          expect(second).toMatchObject({ invocationSource: "automation" });
          expect((await db.select().from(heartbeatRuns)
            .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, second!.id))))[0])
            .toMatchObject({ status: "queued" });
          expect(calls).toBe(1);
          expect(dispatchedPlanIds).toEqual([entries[0]!.plan.id]);
          expect(await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId, entries[1]!.plan.id))).toEqual([]);
          expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entries[1]!.plan.id))).toEqual([]);
          expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, second!.id))).toEqual([]);

          releaseFirst();
          await heartbeat.drainActiveRunExecutions();
        } finally {
          releaseFirst();
          await heartbeat.drainActiveRunExecutions();
        }
      }, async ({ runId, issueId, stage }) => {
        if (stage !== "dispatch") return;
        const entryIndex = entries.findIndex(entry => entry.task.id === issueId);
        if (entryIndex < 0) return;
        const [row] = await db.select().from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, runId)));
        expect(row).toBeDefined();
        expect(row).toMatchObject({ invocationSource: "automation", runtimeMode: "native", driverKind: "aw_text_messages" });
        expect(readChatControlRecoveryAdmission(row!)).toBe("required");
        if (entryIndex === 1) {
          secondDispatchMarkerObserved = true;
          if (mode === "lost") {
            const profile = { ...(row!.runnerProfileJson ?? {}) };
            delete profile[CHAT_CONTROL_RECOVERY_ADMISSION_KEY];
            await db.update(heartbeatRuns).set({ runnerProfileJson: profile })
              .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, runId)));
          } else if (mode === "copied") {
            await db.update(heartbeatRuns).set({ runnerProfileJson: {
              ...(row!.runnerProfileJson ?? {}),
              [CHAT_CONTROL_RECOVERY_ADMISSION_KEY]: {
                ...chatControlRecoveryAdmission(row!, "required"),
                runId: wakeIds[0]!,
              },
            } }).where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, runId)));
          }
        }
      });
      const firstId = wakeIds[0]!, secondId = wakeIds[1]!;
      expect(secondDispatchMarkerObserved).toBe(true);
      await assertCompletedDraft(fixture, entries[0]!, firstId, "Marker 1 internal draft retained for Human review.");
      const [firstRun] = await db.select().from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, firstId)));
      expect(readChatControlRecoveryAdmission(firstRun!)).toBe("admitted");
      const [secondRun] = await db.select().from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, f.home), eq(heartbeatRuns.id, secondId)));
      expect(secondRun).toBeDefined();
      if (mode === "intact") {
        expect(calls).toBe(2);
        expect(dispatchedPlanIds).toEqual(entries.map(({ plan }) => plan.id));
        expect(readChatControlRecoveryAdmission(secondRun!)).toBe("admitted");
        await assertCompletedDraft(fixture, entries[1]!, secondId, "Marker 2 internal draft retained for Human review.");
      } else {
        expect(calls).toBe(1);
        expect(dispatchedPlanIds).toEqual([entries[0]!.plan.id]);
        expect(secondRun).toMatchObject({ nativeIssueId: entries[1]!.task.id, invocationSource: "automation",
          runtimeMode: "native", driverKind: "aw_text_messages", status: "failed",
          errorCode: CHAT_CONTROL_RECOVERY_UNRESOLVED_CODE,
          resultJson: expect.objectContaining({ automaticRecovery: { code: CHAT_CONTROL_RECOVERY_UNRESOLVED_CODE, providerDispatched: false } }) });
        const [secondWake] = await db.select().from(agentWakeupRequests)
          .where(eq(agentWakeupRequests.id, secondRun!.wakeupRequestId!));
        expect(secondWake).toMatchObject({ status: "failed", runId: secondId });
        expect(readChatControlRecoveryAdmission(secondRun!)).toBe(mode === "lost" ? "historical" : "invalid");
        // Runtime Fabric admits the actual run before the later dispatch gate. The
        // gate terminalizes the Run but does not synchronously reconcile its
        // orchestration attempt; supervision/admission owns that later transition.
        const secondManifests = await db.select().from(agentExecutionManifests)
          .where(and(eq(agentExecutionManifests.companyId, f.home), eq(agentExecutionManifests.runId, secondId)));
        expect(secondManifests).toHaveLength(1);
        const secondAttempts = await db.select().from(orchestrationWorkerAttempts)
          .where(and(eq(orchestrationWorkerAttempts.companyId, f.home), eq(orchestrationWorkerAttempts.planId, entries[1]!.plan.id)));
        expect(secondAttempts).toHaveLength(1);
        expect(secondAttempts[0]).toMatchObject({ runId: secondId, executionManifestId: secondManifests[0]!.id, status: "running", attempt: 1 });
        expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, entries[1]!.plan.id))).toEqual([]);
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, secondId))).toEqual([]);
        expect(await documentService(db).getIssueDocumentByKey(entries[1]!.task.id, "result")).toBeNull();
      }
    },
  );

  // These are genuine scheduler/Plan/current-Human cancellation fences, not a
  // provider backend mock. Both intentionally stop before the HTTP controller.
  it.each(["before_selection", "after_selection"] as const)(
    "cancels a real installed-controller Run at %s without dispatching its model",
    async phase => {
      const fixture = await seedInstalledDraft(), {f} = fixture;
      let heartbeatOwner: ReturnType<typeof heartbeatService> | undefined;
      let entry: Awaited<ReturnType<typeof createDraftPlan>> | undefined;
      let selectedRunId: string | null = null;
      let selectionReached = false, dispatchReached = false, calls = 0;
      let cancellation: Promise<unknown> | undefined, cancellationError: unknown;
      const fetch: typeof guardedRemoteHttpFetch = async () => {
        calls++;
        throw new Error("Cancellation fence must precede actual controlled model HTTP");
      };
      const beforeSelection = async (runId: string) => {
        if (!heartbeatOwner || !entry) throw new Error("cancellation_fence_owner_missing");
        selectionReached = true; selectedRunId = runId;
        const current = await heartbeatOwner.getRun(runId);
        expect(current).toMatchObject({companyId:f.home,agentId:f.presence.id,responsibleUserId:f.userId,
          runtimeMode:"legacy",runtimeModeResolvedAt:null,nativeSessionId:null});
        expect(calls).toBe(0);
        if (phase === "before_selection") await heartbeatOwner.cancelRun(runId,"Cancel before Native selection");
      };
      const beforeDispatch = async ({runId,issueId,stage}: {runId:string;issueId:string;stage:"claim"|"dispatch"}) => {
        if (stage !== "dispatch" || phase !== "after_selection") return;
        if (!heartbeatOwner || !entry) throw new Error("cancellation_fence_owner_missing");
        dispatchReached = true;
        expect(issueId).toBe(entry.task.id);expect(runId).toBe(selectedRunId);
        expect(await heartbeatOwner.getRun(runId)).toMatchObject({runtimeMode:"native",nativeIssueId:entry.task.id});
        expect(calls).toBe(0);
        // Cancellation can await this executor. Start it, observe its actual
        // durable fence with a bounded wait, then let the hook unwind.
        cancellation = heartbeatOwner.cancelRun(runId,"Cancel after Native selection")
          .catch(error=>{cancellationError=error;});
        await vi.waitFor(async () => {
          const current=await heartbeatOwner!.getRun(runId);
          expect(current?.resultJson).toMatchObject({startupCancellation:{requestedAt:expect.any(String)}});
        },{timeout:5_000,interval:25});
      };
      await withInstalledDraftTransport(fixture,fetch,async heartbeat => {
        heartbeatOwner=heartbeat;
        // The helper installed this exact profile/gateway before Plan admission.
        entry=await createDraftPlan(fixture,`Cancellation fence ${phase}`);
        const wake=await heartbeat.wakeup(f.presence.id,{source:"automation",triggerDetail:"system",reason:"issue_assigned",
          requestedByActorType:"user",requestedByActorId:f.userId,payload:{issueId:entry.task.id},
          contextSnapshot:{issueId:entry.task.id,wakeReason:"issue_assigned"}});
        expect(wake).not.toBeNull();
        if (!wake) throw new Error("cancellation_fence_run_missing");
        await heartbeat.drainActiveRunExecutions();
        await cancellation;
        expect(cancellationError).toBeUndefined();
        expect(selectionReached).toBe(true);expect(selectedRunId).toBe(wake.id);
        expect(dispatchReached).toBe(phase==="after_selection");
        const runs=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId,f.home));
        expect(runs).toHaveLength(1);
        const run=runs[0]!;
        expect(run).toMatchObject({id:wake.id,companyId:f.home,agentId:f.presence.id,responsibleUserId:f.userId,
          status:"cancelled",runtimeMode:phase==="before_selection"?"legacy":"native",
          resultJson:{startupPreparationSettledAt:expect.any(String)}});
        const coordinators=await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId,wake.id));
        if (phase==="before_selection") {
          expect(run).toMatchObject({runtimeModeResolvedAt:null,nativeSessionId:null,
            resultJson:{startupCancellation:{beforeNativeSelection:true}}});
          expect(coordinators).toEqual([]);
        } else {
          expect(run.runtimeModeResolvedAt).toBeInstanceOf(Date);expect(run.nativeSessionId).toEqual(expect.any(String));
          expect(coordinators).toEqual([expect.objectContaining({runId:wake.id,issueId:entry.task.id,attempt:0,leaseOwner:null})]);
        }
        const [task]=await db.select().from(issues).where(eq(issues.id,entry.task.id));
        expect(task).toMatchObject({executionRunId:null,executionAgentNameKey:null,executionLockedAt:null});
        expect(task?.status).not.toBe("done");
        const [request]=await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id,run.wakeupRequestId!));
        expect(request).toMatchObject({runId:wake.id,status:"cancelled"});
        const attempts=await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.planId,entry.plan.id));
        expect(attempts).toHaveLength(1);
        expect(attempts[0]).toMatchObject({companyId:f.home,planId:entry.plan.id,runId:wake.id,agentId:f.presence.id});
        const manifests=await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId,wake.id));
        expect(manifests).toHaveLength(1);expect(attempts[0]!.executionManifestId).toBe(manifests[0]!.id);
        expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId,entry.plan.id))).toEqual([]);
        expect(await db.select().from(nativeRunResults).where(eq(nativeRunResults.runId,wake.id))).toEqual([]);
        expect(await documentService(db).getIssueDocumentByKey(entry.task.id,"result")).toBeNull();
        expect(calls).toBe(0);
      },beforeDispatch,beforeSelection);
    },60_000,
  );

});
