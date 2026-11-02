import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { chmod, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, agentExecutionManifests, agentWakeupRequests, createDb, documentRevisions, documents, heartbeatRuns, issueDocuments, issues,
  nativeRunResults, orchestrationModelReservations, orchestrationPlans, orchestrationWorkerAttempts } from "@paperclipai/db";
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

  it("keeps a one-document Task idle while blocked, then completes one scheduler Run for Human review", async () => {
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
});
