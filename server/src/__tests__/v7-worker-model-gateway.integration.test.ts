import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  agentIdentities,
  companies,
  companyMemberships,
  connectionGrants,
  createDb,
  heartbeatRuns,
  issues,
  agentExecutionManifests,
  contextManifestMemoryRoots,
  memoryBindings,
  memoryRecords,
  orchestrationPlans,
  orchestrationWorkers,
  orchestrationWorkerAttempts,
  orchestrationModelReservations,
  supervisionInterventions,
  toolInvocations,
  issueDocuments,
  documents,
} from "@paperclipai/db";
import {
  PROVIDER_CAPABILITY_FEATURES,
  type WorkerModelBinding,
} from "@paperclipai/shared";
import { instanceSettingsService } from "../services/instance-settings.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { workerModelGateway } from "../services/orchestration/worker-model-gateway.js";
import type { WorkerModelProfile } from "../services/orchestration/worker-model-profiles.js";
import {
  createRuntimeToolsToken,
  verifyRuntimeToolsToken,
  type RuntimeToolsTokenClaims,
} from "../runtime-tools-token.js";
import type { guardedRemoteHttpFetch } from "../services/remote-http-fetch.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { runtimeConnectionIntentRoutes } from "../routes/connection-intents.js";
import { errorHandler } from "../middleware/index.js";
import { purgeMemoryRecords } from "../services/memory/memory-privacy.js";
import { PaperclipRunnerToolAuthority } from "../services/native-runtime/paperclip-runner-tool-authority.js";
import { PaperclipRunnerSemanticAuthority } from "../services/native-runtime/runner-semantic-authority.js";
import { createAssignedMcpTools } from "../services/native-runtime/assigned-mcp-tools.js";
import type { ToolGatewayService } from "../services/tool-gateway.js";
import { withOrchestrationNativeTool } from "../services/orchestration/native-tool-boundary.js";
import { createAwTextDraftBackend } from "../services/native-runtime/aw-text-draft-backend.js";
import { registerNativeDraftGateway } from "../services/orchestration/native-draft-runtime.js";
import { heartbeatService } from "../services/heartbeat.js";
import { discoverNativeCapabilities } from "../services/native-provider-conformance.js";
import {
  validatePrpEvent,
  validatePrpStructuredRunResult,
} from "../vendor/paperclip-runner/index.js";
import { documentService } from "../services/documents.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
const sourceSha = "a".repeat(40),
  credential = "fixture-private-worker-secret-12345";
const support = await getEmbeddedPostgresTestSupport();
async function makeFixtureTreeWritable(target: string): Promise<void> {
  const metadata = await lstat(target).catch(() => null);
  if (!metadata || metadata.isSymbolicLink()) return;
  await chmod(target, metadata.isDirectory() ? 0o700 : 0o600);
  if (metadata.isDirectory())
    for (const name of await readdir(target))
      await makeFixtureTreeWritable(join(target, name));
}
(support.supported ? describe : describe.skip)(
  "Native bounded worker model gateway",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      home: string;
    let f: Awaited<ReturnType<typeof seedV5Presences>>,
      plan: typeof orchestrationPlans.$inferSelect,
      task: typeof issues.$inferSelect,
      run: typeof heartbeatRuns.$inferSelect,
      binding: WorkerModelBinding,
      profile: WorkerModelProfile,
      claims: RuntimeToolsTokenClaims;
    let calls: number,
      observedKey: string,
      observedBody: string,
      inputTokens: number,
      duringCall: (() => Promise<void>) | undefined;
    beforeAll(async () => {
      home = await mkdtemp(join(tmpdir(), "aw-v7-worker-model-fixture-"));
      vi.stubEnv("PAPERCLIP_HOME", home);
      vi.stubEnv("PAPERCLIP_INSTANCE_ID", "worker-model-fixture");
      vi.stubEnv(
        "PAPERCLIP_AGENT_JWT_SECRET",
        "private-fixture-signing-master-123456789",
      );
      database = await startEmbeddedPostgresTestDatabase("aw-v7-worker-model-");
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
      vi.unstubAllEnvs();
      if (home) {
        await makeFixtureTreeWritable(home);
        await rm(home, { recursive: true, force: true });
      }
    }, 30000);
    beforeEach(async () => {
      await instanceSettingsService(db).updateExperimental({
        enableWorkflowsV1: true,
        role_packs_v5: false,
        skill_resolver_v5: false,
        readiness_engine_v7: true,
        orchestration_v7: true,
      });
      f = await seedV5Presences(db);
      await db
        .update(agents)
        .set({ adapterType: "claude_local" })
        .where(eq(agents.id, f.presence.id));
      const providers = agentProviderBindingService(db),
        pb = await providers.create(f.actor, f.home, f.presence.id, {
          providerType: "paperclip_native",
          providerAgentRef: f.presence.id,
          isolationMode: "isolated_per_presence",
          providerEndpointRef: null,
        });
      await providers.attach(f.actor, f.home, f.presence.id, {
        providerBindingId: pb.id,
        providerProfileRef: f.presence.id,
      });
      await providers.recordDiscovery(
        f.home,
        f.presence.id,
        {
          provider: "paperclip_native",
          version: "worker-model-fixture-only",
          features: Object.fromEntries(
            PROVIDER_CAPABILITY_FEATURES.map((key) => [key, false]),
          ) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>,
          skills: [],
          tools: [],
          discoveredAt: new Date().toISOString(),
        },
        {
          connect: true,
          identity: true,
          start: true,
          stream: true,
          wait: true,
          cancel: true,
          memoryScoping: true,
        },
      );
      const provider = await providers.assertRuntime(f.home, f.presence.id);
      [task] = (await db
        .insert(issues)
        .values({
          companyId: f.home,
          title: "Save the bounded private fixture draft",
          status: "todo",
          assigneeAgentId: f.presence.id,
        })
        .returning()) as [typeof task];
      [run] = (await db
        .insert(heartbeatRuns)
        .values({
          companyId: f.home,
          agentId: f.presence.id,
          responsibleUserId: f.userId,
          status: "running",
          runtimeMode: "native",
          nativeIssueId: task.id,
          contextSnapshot: { issueId: task.id },
        })
        .returning()) as [typeof run];
      const prepared = await agentRuntimeFabricService(db).prepare({
        companyId: f.home,
        agentId: f.presence.id,
        runId: run.id,
        responsibleUserId: f.userId,
        issueId: task.id,
        query: task.title,
      });
      plan = await orchestrationService(db).create(f.actor, f.home, {
        issueId: task.id,
        expectedIssueUpdatedAt: task.updatedAt.toISOString(),
        workload: "semantic",
        riskClass: "C0",
        completionContract: {
          objective: "Save the internal draft",
          requiredOutputs: [{ key: "result" }],
          businessInvariants: ["Use authorized sources only"],
        },
        budgets: { maxModelCostMinor: 6, maxToolActions: 2 },
        workers: [{ key: "writer", issueId: task.id }],
      });
      // Private Native fixture setup only. Production launch remains closed for
      // capped CLIs/sessions; this does not fabricate forced dispatch or a pilot.
      await db
        .update(orchestrationPlans)
        .set({
          status: "running",
          startedAt: new Date(),
          executionPrincipal: { type: "user", userId: f.userId },
        })
        .where(eq(orchestrationPlans.id, plan.id));
      const [worker] = await db
        .update(orchestrationWorkers)
        .set({ status: "running", attemptCount: 1 })
        .where(eq(orchestrationWorkers.planId, plan.id))
        .returning();
      const [attempt] = await db
        .insert(orchestrationWorkerAttempts)
        .values({
          companyId: f.home,
          planId: plan.id,
          workerId: worker!.id,
          agentId: f.presence.id,
          runId: run.id,
          executionManifestId: prepared!.record.id,
          attempt: 1,
        })
        .returning();
      await db
        .update(issues)
        .set({ executionRunId: run.id })
        .where(eq(issues.id, task.id));
      binding = {
        planId: plan.id,
        workerId: worker!.id,
        workerAttemptId: attempt!.id,
        executionManifestId: prepared!.record.id,
        expectedPlanVersion: plan.version,
      };
      const connection = await aiConnectionService(db).save(
        f.home,
        f.userId,
        {
          provider: "anthropic",
          method: "api_key",
          ownership: "shared",
          name: "Encrypted private worker fixture",
          apiKey: "fixture",
          allAgents: false,
          agentIds: [f.presence.id],
        },
        credential,
      );
      profile = {
        id: randomUUID(),
        companyId: f.home,
        workerAgentId: f.presence.id,
        providerBindingId: provider.provider.id,
        providerSnapshotHash: provider.provider.capabilitySnapshotHash!,
        providerProfileRef: provider.runtime.providerProfileRef,
        qualifiedConfigurationHash:
          provider.runtime.qualifiedConfigurationHash!,
        binding: {
          provider: "anthropic",
          method: "api_key",
          mode: "shared",
          ...connection,
        },
        transport: "server-text-only-v1",
        contract: "anthropic-text-messages-2023-06-01",
        maximumEnvelopeBytes: 64000,
        inputTokensUpperBound: 100000,
        maxOutputTokens: 1024,
        tariff: {
          provider: "anthropic",
          model: "fixture-worker-model-20261005",
          currency: "USD",
          inputMinorPerMillion: 0,
          outputMinorPerMillion: 0,
          fixedMinor: 3,
          qualificationHash: "b".repeat(64),
          sourceSha,
          testedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        },
        qualificationEvidenceRef:
          "https://protected.test.invalid/qualification/worker-fixture-only.json",
        qualificationArtifactSha256: "c".repeat(64),
      };
      const minted = await gateway().issue(issueInput());
      claims = verifyRuntimeToolsToken(minted.token, "worker_model")!;
      calls = 0;
      observedKey = "";
      observedBody = "";
      inputTokens = 10;
      duringCall = undefined;
    });
    afterEach(() => registerNativeDraftGateway(db, undefined));

    async function qualifiedNativePresence() {
      await db
        .update(agents)
        .set({
          adapterType: "paperclip_runner",
          adapterConfig: {
            provider: "aw_text_only",
            workerModelProfileId: profile.id,
            model: profile.tariff.model,
            maxOutputTokens: 256,
            lifecycleMode: "per_turn",
          },
          runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true } },
        })
        .where(eq(agents.id, f.presence.id));
      const providers = agentProviderBindingService(db);
      // Explicit local fixture only; this is not provider/pilot qualification evidence.
      const [presence] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, f.presence.id));
      const advertised = await discoverNativeCapabilities({
        companyId: f.home,
        adapterType: "paperclip_runner",
        config: presence!.adapterConfig,
      });
      const recorded = await providers.recordDiscovery(
        f.home,
        f.presence.id,
        advertised,
        {
          connect: true,
          identity: true,
          start: true,
          stream: true,
          wait: true,
          cancel: true,
          memoryScoping: true,
        },
      );
      await providers.revalidate(
        f.actor,
        f.home,
        f.presence.id,
        recorded.capabilitySnapshotHash!,
        "Review the explicit local fixture's new draft-only contract; no live qualification claimed",
      );
      const qualified = await providers.assertRuntime(f.home, f.presence.id);
      profile = {
        ...profile,
        providerSnapshotHash: qualified.provider.capabilitySnapshotHash!,
        qualifiedConfigurationHash:
          qualified.runtime.qualifiedConfigurationHash!,
      };
      const consumer = gateway();
      registerNativeDraftGateway(db, consumer);
      return consumer;
    }

    async function freshNativePlan(
      budgets = { maxModelCostMinor: 6, maxToolActions: 2 },
    ) {
      await qualifiedNativePresence();
      // Retire the separate, manually bound component fixture before exercising
      // the real scheduler. This new plan has no manually inserted attempt.
      await db
        .update(heartbeatRuns)
        .set({ status: "failed", finishedAt: new Date() })
        .where(eq(heartbeatRuns.id, run.id));
      [task] = (await db
        .insert(issues)
        .values({
          companyId: f.home,
          title: "Produce the scheduler's single internal draft",
          status: "todo",
          workMode: "standard",
          assigneeAgentId: f.presence.id,
          responsibleUserId: f.userId,
        })
        .returning()) as [typeof task];
      plan = await orchestrationService(db).create(f.actor, f.home, {
        issueId: task.id,
        expectedIssueUpdatedAt: task.updatedAt.toISOString(),
        workload: "semantic",
        riskClass: "C0",
        completionContract: {
          objective: "Retain one internal draft for human review",
          requiredOutputs: [{ key: "result" }],
          businessInvariants: ["Human review is required"],
        },
        budgets,
        workers: [{ key: "native-writer", issueId: task.id }],
      });
      return orchestrationService(db).decide(f.actor, f.home, plan.id, {
        expectedVersion: plan.version,
        action: "start",
        rationale: "Start only the operator-qualified bounded internal draft",
      });
    }

    it("qualifies only the explicit private Native draft selector without decrypting or spending", async () => {
      await expect(
        gateway().qualifyDraft(db, {
          companyId: f.home,
          agentId: f.presence.id,
          responsibleUserId: f.userId,
        }),
      ).rejects.toMatchObject({ status: 403 });
      const consumer = await qualifiedNativePresence();
      await expect(
        consumer.qualifyDraft(db, {
          companyId: f.home,
          agentId: f.presence.id,
          responsibleUserId: f.userId,
        }),
      ).resolves.toMatchObject({
        profileId: profile.id,
        model: profile.tariff.model,
        maxOutputTokens: 256,
        maximumMinor: 3,
      });
      expect(calls).toBe(0);
      expect(await ledger()).toEqual([]);
    });

    it.each(["configuration", "runtime_binding", "membership", "grant", "price"] as const)(
      "rejects native draft qualification after current %s drift",
      async (change) => {
        const consumer = await qualifiedNativePresence();
        if (change === "configuration")
          await db
            .update(agents)
            .set({ adapterConfig: { provider: "codex" } })
            .where(eq(agents.id, f.presence.id));
        if (change === "membership")
          await db
            .delete(companyMemberships)
            .where(
              and(
                eq(companyMemberships.companyId, f.home),
                eq(companyMemberships.principalId, f.userId),
              ),
            );
        if (change === "runtime_binding")
          await db.update(agents).set({ runtimeConfig: { aiConnection: profile.binding } }).where(eq(agents.id, f.presence.id));
        if (change === "grant")
          await db
            .update(connectionGrants)
            .set({ status: "revoked", revokedAt: new Date() })
            .where(eq(connectionGrants.companyId, f.home));
        if (change === "price")
          profile.tariff.expiresAt = new Date(Date.now() - 1).toISOString();
        await expect(
          consumer.qualifyDraft(db, {
            companyId: f.home,
            agentId: f.presence.id,
            responsibleUserId: f.userId,
          }),
        ).rejects.toThrow();
        expect(calls).toBe(0);
        expect(await ledger()).toEqual([]);
      },
    );

    it.each([
      { maxModelCostMinor: 2, maxToolActions: 2 },
      { maxModelCostMinor: 6, maxToolActions: 1 },
    ])(
      "refuses plan start when the actual one-call draft cannot fit remaining budgets: %j",
      async (budgets) => {
        await expect(freshNativePlan(budgets)).rejects.toMatchObject({
          status: 409,
        });
        expect(
          await db
            .select()
            .from(orchestrationWorkerAttempts)
            .where(eq(orchestrationWorkerAttempts.planId, plan.id)),
        ).toEqual([]);
        expect(calls).toBe(0);
      },
    );

    it("forces the real heartbeat through native admission and the budget gateway, saves one draft and retains human review", async () => {
      const started = await freshNativePlan();
      const substitution = vi.fn(() => {
        throw new Error(
          "An internal draft must not use the injected provider seam",
        );
      });
      const heartbeat = heartbeatService(db, {
        nativeSessionBackendFactory: substitution,
      });
      try {
        await heartbeat.invoke(
          f.presence.id,
          "on_demand",
          { issueId: task.id },
          "manual",
          { actorType: "user", actorId: f.userId },
        );
        await heartbeat.drainActiveRunExecutions();
      } finally {
        await heartbeat.drainActiveRunExecutions();
      }
      const attempts = await db
        .select()
        .from(orchestrationWorkerAttempts)
        .where(eq(orchestrationWorkerAttempts.planId, plan.id));
      expect(attempts).toHaveLength(1);
      const [actualRun] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, attempts[0]!.runId!));
      expect(actualRun).toMatchObject({
        status: "succeeded",
        runtimeMode: "native",
        driverKind: "aw_text_messages",
        responsibleUserId: f.userId,
      });
      expect(actualRun!.error).toBeNull();
      expect(substitution).not.toHaveBeenCalled();
      expect(calls).toBe(1);
      expect(observedBody).toContain("assignedRuntimeContext");
      expect(observedBody).not.toContain(credential);
      expect(
        (await documentService(db).getIssueDocumentByKey(task.id, "result"))
          ?.body,
      ).toBe("Retained bounded draft");
      const [current] = await db
        .select()
        .from(orchestrationPlans)
        .where(eq(orchestrationPlans.id, started.id));
      expect(current).toMatchObject({
        toolActionsUsed: 2,
        modelCostReserved: 3,
      });
      const [currentTask] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, task.id));
      expect(currentTask!.status).not.toBe("done");
    }, 60000);

    it("rejects actual Native admission after a private grant is revoked, before a worker attempt or model dispatch", async () => {
      await freshNativePlan();
      await db
        .update(connectionGrants)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(eq(connectionGrants.companyId, f.home));
      const heartbeat = heartbeatService(db);
      await heartbeat.invoke(
        f.presence.id,
        "on_demand",
        { issueId: task.id },
        "manual",
        { actorType: "user", actorId: f.userId },
      );
      await heartbeat.drainActiveRunExecutions();
      expect(
        await db
          .select()
          .from(orchestrationWorkerAttempts)
          .where(eq(orchestrationWorkerAttempts.planId, plan.id)),
      ).toEqual([]);
      expect(calls).toBe(0);
      expect(await ledger()).toEqual([]);
      expect(
        await documentService(db).getIssueDocumentByKey(task.id, "result"),
      ).toBeNull();
    }, 60000);

    it("withholds draft publication after human Pause during the actual heartbeat model call and retains its reservation", async () => {
      const started = await freshNativePlan();
      duringCall = async () => {
        await orchestrationService(db).decide(f.actor, f.home, started.id, {
          expectedVersion: started.version,
          action: "pause",
          rationale:
            "Pause the actual Native draft before canonical publication",
        });
      };
      const heartbeat = heartbeatService(db);
      await heartbeat.invoke(
        f.presence.id,
        "on_demand",
        { issueId: task.id },
        "manual",
        { actorType: "user", actorId: f.userId },
      );
      await heartbeat.drainActiveRunExecutions();
      expect(calls).toBe(1);
      expect(
        await documentService(db).getIssueDocumentByKey(task.id, "result"),
      ).toBeNull();
      expect((await ledger())[0]).toMatchObject({
        status: "unknown",
        maximumMinor: 3,
      });
      const [current] = await db
        .select()
        .from(orchestrationPlans)
        .where(eq(orchestrationPlans.id, started.id));
      expect(current).toMatchObject({
        status: "paused",
        toolActionsUsed: 1,
        modelCostReserved: 3,
      });
      expect(
        await db
          .select()
          .from(supervisionInterventions)
          .where(eq(supervisionInterventions.planId, started.id)),
      ).not.toEqual([]);
    }, 60000);
    function issueInput() {
      return {
        companyId: f.home,
        agentId: f.presence.id,
        runId: run.id,
        responsibleUserId: f.userId,
        binding,
      };
    }
    const input = () => ({
      callId: "draft-1",
      system: "Write only from supplied evidence",
      prompt: "Authorized source for a fixture draft",
      maxOutputTokens: 256,
    });
    const ledger = () =>
      db
        .select()
        .from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, plan.id));
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      calls++;
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      observedBody = String(init.body);
      observedKey = new Headers(init.headers).get("x-api-key")!;
      const rows = await ledger();
      // PostgreSQL does not promise insertion order after receipt updates.
      expect(rows.find((row) => row.status === "dispatched")).toMatchObject({
        status: "dispatched",
        maximumMinor: 3,
      });
      await duringCall?.();
      return new Response(
        JSON.stringify({
          type: "message",
          role: "assistant",
          model: profile.tariff.model,
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Retained bounded draft" }],
          usage: { input_tokens: inputTokens, output_tokens: 20 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    function gateway(transport: typeof guardedRemoteHttpFetch = fetch) {
      return workerModelGateway(db, {
        profiles: [profile],
        sourceSha,
        protectedEvidenceOrigin: "https://protected.test.invalid",
        fetch: transport,
      });
    }
    function nativeBinding() {
      return {
        companyId: f.home,
        issueId: task.id,
        agentId: f.presence.id,
        runId: run.id,
      };
    }
    function nativeTools() {
      return new PaperclipRunnerToolAuthority(db, nativeBinding());
    }
    function draftBackend(consumer = gateway()) {
      return createAwTextDraftBackend(db, consumer, {
        ...issueInput(),
        outputKey: "result",
        maxOutputTokens: 256,
      });
    }
    const sessionIdentity = () => ({
      ...nativeBinding(),
      sessionId: randomUUID(),
    });
    it("runs the real one-call Native draft backend, saves its declared Task output and proposes only review", async () => {
      const backend = draftBackend(),
        identity = sessionIdentity();
      const descriptor = await backend.descriptor();
      expect(descriptor).toMatchObject({
        name: "aw-text-draft-v1",
        kind: "remote",
        capabilities: { resume: false, dynamicTools: false },
      });
      // No runtime-context capabilities are fabricated to open production admission.
      expect(descriptor.runtimeContextCapabilities).toBeUndefined();
      const session = await backend.openSession({ identity });
      expect(calls).toBe(0);
      await session.startTurn({
        message: { role: "user", text: "Write the declared internal draft." },
      });
      const result = await session.result();
      expect(result).toMatchObject({
        result: {
          reportedWorkDisposition: "needs_review",
          completionClaim: { objectiveSatisfied: false },
        },
      });
      expect(validatePrpStructuredRunResult(result!.result).ok).toBe(true);
      expect(
        result!.result.completionClaim.criteria.every(
          (c) => c.status === "unknown",
        ),
      ).toBe(true);
      const doc = await documentService(db).getIssueDocumentByKey(
        task.id,
        "result",
      );
      expect(doc?.body).toBe("Retained bounded draft");
      expect(calls).toBe(1);
      expect((await ledger())[0]).toMatchObject({
        status: "completed",
        purpose: "worker_model",
        maximumMinor: 3,
      });
      const [current] = await db
        .select()
        .from(orchestrationPlans)
        .where(eq(orchestrationPlans.id, plan.id));
      expect(current).toMatchObject({
        status: "running",
        toolActionsUsed: 2,
        modelCostReserved: 3,
      });
      const [currentTask] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, task.id));
      expect(currentTask!.status).toBe("todo");
      const events = [];
      for await (const event of session.events()) {
        expect(validatePrpEvent(event).ok).toBe(true);
        events.push(event);
      }
      expect(events.map((e) => e.eventType)).toEqual([
        "session.started",
        "turn.started",
        "usage.reported",
        "run.result.proposed",
        "turn.completed",
        "run.terminal",
      ]);
      expect(events.every((e) => e.sourceKind === "control_plane")).toBe(true);
      expect(JSON.stringify(events)).not.toContain("Retained bounded draft");
      expect(JSON.stringify(await session.snapshot())).not.toContain(
        "Retained bounded draft",
      );
      expect(JSON.stringify(await session.snapshot())).not.toContain(
        credential,
      );
      expect(await session.usage!()).toMatchObject({
        inputTokens: inputTokens,
        outputTokens: 20,
      });
      await session.close({ reason: "native_finished" });
    });
    it("rejects changed draft session and undeclared output bindings before a tool or model dispatch", async () => {
      for (const altered of [
        { ...sessionIdentity(), issueId: randomUUID() },
        { ...sessionIdentity(), companyId: f.guest },
        { ...sessionIdentity(), agentId: f.guestPresence.id },
        { ...sessionIdentity(), runId: randomUUID() },
      ])
        await expect(
          draftBackend().openSession({ identity: altered }),
        ).rejects.toMatchObject({ status: 403 });
      const undeclared = createAwTextDraftBackend(db, gateway(), {
        ...issueInput(),
        outputKey: "plan",
        maxOutputTokens: 256,
      });
      await expect(
        undeclared.openSession({ identity: sessionIdentity() }),
      ).rejects.toMatchObject({ status: 403 });
      expect(calls).toBe(0);
      expect(await ledger()).toHaveLength(0);
      expect(
        await db
          .select()
          .from(toolInvocations)
          .where(eq(toolInvocations.runId, run.id)),
      ).toHaveLength(0);
    });
    it("cannot resume, replace, open another session or silently repeat a completed draft model call", async () => {
      const backend = draftBackend(),
        identity = sessionIdentity();
      const session = await backend.openSession({ identity });
      await session.startTurn({
        message: { role: "user", text: "Write the draft." },
      });
      await session.result();
      await expect(
        session.startTurn({
          message: { role: "user", text: "Write it again." },
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(backend.openSession({ identity })).rejects.toMatchObject({
        status: 409,
      });
      const snapshot = await session.snapshot(),
        signal = new AbortController().signal;
      expect(await backend.recoverSession!(snapshot, { signal })).toMatchObject(
        { recovered: false },
      );
      await expect(
        backend.openReplacementSession!({ identity }, snapshot),
      ).rejects.toMatchObject({ status: 403 });
      expect(calls).toBe(1);
      expect(await ledger()).toHaveLength(1);
      await session.close({ reason: "native_finished" });
    });
    it("refuses continuation and plan turns before spending for a draft", async () => {
      const session = await draftBackend().openSession({
        identity: sessionIdentity(),
      });
      await expect(
        session.startTurn({
          message: { role: "user", text: "Continue" },
          continuation: true,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        session.startTurn({
          message: { role: "user", text: "Plan" },
          requestedCollaborationMode: "plan",
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(calls).toBe(0);
      expect(await ledger()).toHaveLength(0);
      await session.close({ reason: "invalid_turn" });
      expect(await session.result()).toBeNull();
    });
    it("withholds draft output on ambiguous provider failure and emits only a fixed Native error", async () => {
      const broken: typeof guardedRemoteHttpFetch = async () => {
        calls++;
        throw new Error(credential);
      };
      const session = await draftBackend(gateway(broken)).openSession({
        identity: sessionIdentity(),
      });
      await session.startTurn({
        message: { role: "user", text: "Write the draft." },
      });
      expect(await session.result()).toBeNull();
      const events = [];
      for await (const event of session.events()) events.push(event);
      expect(
        events.find((e) => e.eventType === "session.failed")?.payload,
      ).toMatchObject({ code: "aw_text_draft_unsettled", recoverable: false });
      expect(JSON.stringify(events)).not.toContain(credential);
      expect(
        await documentService(db).getIssueDocumentByKey(task.id, "result"),
      ).toBeNull();
      expect((await ledger())[0]).toMatchObject({
        status: "unknown",
        maximumMinor: 3,
      });
      const [current] = await db
        .select()
        .from(orchestrationPlans)
        .where(eq(orchestrationPlans.id, plan.id));
      expect(current).toMatchObject({
        status: "paused",
        modelCostReserved: 3,
        toolActionsUsed: 1,
      });
      await session.close({ reason: "failed" });
    });
    it("fences an empty provider draft while retaining the completed financial receipt", async () => {
      const empty: typeof guardedRemoteHttpFetch = async (
        url,
        init,
        options,
      ) => {
        const response = await fetch(url, init, options);
        const body = await response.json();
        body.content = [{ type: "text", text: "" }];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
      const session = await draftBackend(gateway(empty)).openSession({
        identity: sessionIdentity(),
      });
      await session.startTurn({
        message: { role: "user", text: "Write the draft." },
      });
      expect(await session.result()).toBeNull();
      expect(calls).toBe(1);
      expect((await ledger())[0]).toMatchObject({
        status: "completed",
        maximumMinor: 3,
      });
      expect(
        await documentService(db).getIssueDocumentByKey(task.id, "result"),
      ).toBeNull();
      const [current] = await db
        .select()
        .from(orchestrationPlans)
        .where(eq(orchestrationPlans.id, plan.id));
      expect(current).toMatchObject({
        status: "paused",
        toolActionsUsed: 1,
        modelCostReserved: 3,
      });
      await session.close({ reason: "empty_output" });
    });
    it("revokes a pending Native draft synchronously, settles iterators and retains the ambiguous debit without writing output", async () => {
      let dispatched!: () => void;
      const started = new Promise<void>((resolve) => {
        dispatched = resolve;
      });
      const held: typeof guardedRemoteHttpFetch = async (_url, init) => {
        calls++;
        dispatched();
        const signal = init.signal!;
        await new Promise<void>((_resolve, reject) => {
          if (signal.aborted) reject(new Error("aborted"));
          else
            signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
        });
        throw new Error("unreachable");
      };
      const session = await draftBackend(gateway(held)).openSession({
        identity: sessionIdentity(),
      });
      const iterator = session.events()[Symbol.asyncIterator]();
      await iterator.next();
      await session.startTurn({
        message: { role: "user", text: "Write the draft." },
      });
      await iterator.next();
      const waiting = iterator.next();
      await started;
      const cancelled = session.cancel!({
        reason: "native_stop",
        signal: new AbortController().signal,
      });
      expect((await waiting).value?.eventType).toBe("turn.cancelled");
      expect((await iterator.next()).done).toBe(true);
      await cancelled.cleanup;
      expect(await session.result()).toBeNull();
      expect(
        await documentService(db).getIssueDocumentByKey(task.id, "result"),
      ).toBeNull();
      expect((await ledger())[0]).toMatchObject({
        status: "unknown",
        maximumMinor: 3,
      });
      expect(calls).toBe(1);
      await expect(
        session.startTurn({ message: { role: "user", text: "Retry" } }),
      ).rejects.toMatchObject({ status: 403 });
      await session.close({ reason: "cancelled" });
    });
    it("retains the model debit and fences if authority changes before a canonical draft can be returned", async () => {
      duringCall = async () => {
        await db
          .delete(companyMemberships)
          .where(
            and(
              eq(companyMemberships.companyId, f.home),
              eq(companyMemberships.principalId, f.userId),
            ),
          );
      };
      const session = await draftBackend().openSession({
        identity: sessionIdentity(),
      });
      await session.startTurn({
        message: { role: "user", text: "Write the draft." },
      });
      expect(await session.result()).toBeNull();
      expect(
        await documentService(db).getIssueDocumentByKey(task.id, "result"),
      ).toBeNull();
      expect((await ledger())[0]).toMatchObject({
        status: "unknown",
        maximumMinor: 3,
      });
      expect(calls).toBe(1);
      await session.close({ reason: "revoked" });
    });
    it("charges assigned-tool catalog search and keeps actual MCP invocation charging at its existing gateway", async () => {
      let effects = 0;
      // Private gateway fixture uses the actual Native SQL invocation guard.
      // It does not establish a live connected-tool or credential qualification.
      const assigned = await createAssignedMcpTools({
        gateway: {
          listToolsForNamedGateway: async () => [
            {
              name: "fixture.read",
              displayName: "Read",
              description: "Private native charge fixture",
              risk: "read",
              parametersSchema: { type: "object", properties: {} },
            },
          ],
          executeTool: async () => {
            const [receipt] = await db
              .insert(toolInvocations)
              .values({
                companyId: f.home,
                agentId: f.presence.id,
                issueId: task.id,
                runId: run.id,
                toolName: "fixture.read",
                riskLevel: "read",
                status: "executing",
              })
              .returning();
            effects++;
            await db
              .update(toolInvocations)
              .set({ status: "succeeded", completedAt: new Date() })
              .where(eq(toolInvocations.id, receipt!.id));
            return { status: "completed", result: { fixture: true } };
          },
        } as unknown as ToolGatewayService,
        gatewayPublicId: "private-budget-fixture",
        bearerToken: "private-fixture-token",
      });
      const authority = new PaperclipRunnerToolAuthority(db, {
        ...nativeBinding(),
        assignedMcpTools: assigned,
      });
      const catalog = (await authority.execute({
        tool: "paperclip_search_assigned_tools",
        callId: "catalog-native-budget",
        arguments: { query: "" },
      })) as { tools: Array<{ name: string }> };
      expect(catalog.tools).toHaveLength(1);
      await authority.execute({
        tool: catalog.tools[0]!.name,
        callId: "mcp-native-budget",
        arguments: {},
      });
      expect(effects).toBe(1);
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0],
      ).toMatchObject({ toolActionsUsed: 2, status: "running" });
      expect(
        await db
          .select()
          .from(toolInvocations)
          .where(eq(toolInvocations.runId, run.id)),
      ).toHaveLength(2);
      await expect(
        authority.execute({
          tool: catalog.tools[0]!.name,
          callId: "mcp-native-exhausted",
          arguments: {},
        }),
      ).rejects.toThrow();
      expect(effects).toBe(1);
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0],
      ).toMatchObject({ toolActionsUsed: 2, status: "paused" });
    });
    it("shares one tool ceiling across both Native protocol authority paths", async () => {
      await db
        .update(issues)
        .set({ status: "in_progress" })
        .where(eq(issues.id, task.id));
      await nativeTools().execute({
        tool: "get_task_context",
        callId: "main-native-path",
        arguments: {},
      });
      const semantic = new PaperclipRunnerSemanticAuthority(
        db,
        nativeBinding(),
      );
      expect(
        await semantic.dispatch({
          operationId: "get_task_history",
          callId: "coordinator-native-path",
          input: {},
          correlation: {
            runId: run.id,
            normalizedSessionId: `session_${run.id}`,
            turnId: "turn-budget",
            itemId: "item-budget",
          },
        }),
      ).toMatchObject({ ok: true });
      await expect(
        semantic.dispatch({
          operationId: "list_documents",
          callId: "coordinator-exhausted",
          input: {},
          correlation: {
            runId: run.id,
            normalizedSessionId: `session_${run.id}`,
            turnId: "turn-budget",
            itemId: "item-budget",
          },
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0],
      ).toMatchObject({ toolActionsUsed: 2, status: "paused" });
      expect(
        await db
          .select()
          .from(toolInvocations)
          .where(eq(toolInvocations.runId, run.id)),
      ).toHaveLength(2);
    });
    it("charges actual Native Task read/write dispatch before effect and stops at the shared tool ceiling", async () => {
      const authority = nativeTools();
      expect(
        await authority.execute({
          tool: "get_task_context",
          callId: "native-context",
          arguments: {},
        }),
      ).toMatchObject({ activeTask: { id: task.id } });
      await authority.execute({
        tool: "write_document",
        callId: "native-draft",
        arguments: {
          key: "result",
          title: "Bounded draft",
          body: "Authorized unverified draft",
          baseRevisionId: null,
          idempotencyKey: "native-draft-write",
        },
      });
      const [saved] = await db
        .select({ document: documents })
        .from(issueDocuments)
        .innerJoin(documents, eq(documents.id, issueDocuments.documentId))
        .where(
          and(
            eq(issueDocuments.companyId, f.home),
            eq(issueDocuments.issueId, task.id),
            eq(issueDocuments.key, "result"),
          ),
        );
      expect(saved?.document.latestBody).toBe("Authorized unverified draft");
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0],
      ).toMatchObject({ toolActionsUsed: 2, status: "running" });
      await expect(
        authority.execute({
          tool: "get_task_history",
          callId: "native-exhausted",
          arguments: {},
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0],
      ).toMatchObject({ toolActionsUsed: 2, status: "paused" });
      expect(
        await db
          .select()
          .from(supervisionInterventions)
          .where(eq(supervisionInterventions.planId, plan.id)),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "native_tool_budget_exhausted",
          }),
        ]),
      );
      const receipts = await db
        .select()
        .from(toolInvocations)
        .where(eq(toolInvocations.runId, run.id));
      expect(receipts).toHaveLength(2);
      expect(receipts.every((r) => r.status === "succeeded")).toBe(true);
      expect(JSON.stringify(receipts)).not.toContain(
        "Authorized unverified draft",
      );
      expect(
        (await db.select().from(issues).where(eq(issues.id, task.id)))[0]
          ?.status,
      ).toBe("todo");
    });
    it("deduplicates concurrent Native protocol calls and refuses changed or completed dispatch identities", async () => {
      const call = {
        tool: "get_task_context",
        callId: "native-duplicate",
        arguments: {},
      };
      const outcomes = await Promise.allSettled([
        nativeTools().execute(call),
        nativeTools().execute(call),
      ]);
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
      await expect(nativeTools().execute(call)).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        nativeTools().execute({ ...call, arguments: { changed: true } }),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0],
      ).toMatchObject({ toolActionsUsed: 1, status: "running" });
    });
    it("keeps unknown/material Native API paths and undeclared document keys outside the draft qualification", async () => {
      for (const tool of [
        "call_api",
        "hire_agent",
        "reassign_task",
        "create_project",
        "create_skill",
        "connections_search",
      ]) {
        await expect(
          nativeTools().execute({ tool, callId: tool, arguments: {} }),
        ).rejects.toMatchObject({ status: 403 });
      }
      await expect(
        nativeTools().execute({
          tool: "write_document",
          callId: "undeclared-output",
          arguments: { key: "plan", body: "Do not rewrite accepted authority" },
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await db
          .select()
          .from(toolInvocations)
          .where(eq(toolInvocations.runId, run.id)),
      ).toHaveLength(0);
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0]?.toolActionsUsed,
      ).toBe(0);
    });
    it.each([
      "pause",
      "membership",
      "stop",
      "flag",
      "identity",
      "company",
      "attempt",
    ])(
      "fences Native Task tools before dispatch after %s changes",
      async (reason) => {
        if (reason === "pause")
          await db
            .update(orchestrationPlans)
            .set({ status: "paused" })
            .where(eq(orchestrationPlans.id, plan.id));
        if (reason === "membership")
          await db
            .delete(companyMemberships)
            .where(
              and(
                eq(companyMemberships.companyId, f.home),
                eq(companyMemberships.principalId, f.userId),
              ),
            );
        if (reason === "stop")
          await db
            .update(heartbeatRuns)
            .set({
              resultJson: { executionCancellation: { state: "requested" } },
            })
            .where(eq(heartbeatRuns.id, run.id));
        if (reason === "flag")
          await instanceSettingsService(db).updateExperimental({
            orchestration_v7: false,
          });
        if (reason === "identity")
          await db
            .update(agentIdentities)
            .set({ status: "paused" })
            .where(eq(agentIdentities.id, f.identity.id));
        if (reason === "company")
          await db
            .update(companies)
            .set({ status: "paused" })
            .where(eq(companies.id, f.home));
        if (reason === "attempt")
          await db
            .update(orchestrationWorkerAttempts)
            .set({ status: "cancelled", finishedAt: new Date() })
            .where(eq(orchestrationWorkerAttempts.id, binding.workerAttemptId));
        await expect(
          nativeTools().execute({
            tool: "get_task_context",
            callId: "revoked-native-context",
            arguments: {},
          }),
        ).rejects.toMatchObject({ status: reason === "flag" ? 404 : 403 });
        expect(
          await db
            .select()
            .from(toolInvocations)
            .where(eq(toolInvocations.runId, run.id)),
        ).toHaveLength(0);
      },
    );
    it("retains a Native tool debit and does not resend an ambiguous side effect", async () => {
      let effects = 0;
      const call = {
        tool: "report_progress",
        callId: "ambiguous-native-effect",
        arguments: {
          body: "Private unretained fixture",
          idempotencyKey: "private-effect",
        },
      };
      await expect(
        withOrchestrationNativeTool(db, nativeBinding(), call, async () => {
          effects++;
          throw new Error("private fixture transport failure");
        }),
      ).rejects.toThrow("private fixture transport failure");
      expect(effects).toBe(1);
      const [receipt] = await db
        .select()
        .from(toolInvocations)
        .where(eq(toolInvocations.runId, run.id));
      expect(receipt).toMatchObject({
        status: "failed",
        errorCode: "native_tool_result_unsettled",
        errorMessage: null,
      });
      expect(JSON.stringify(receipt)).not.toContain(
        "Private unretained fixture",
      );
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0],
      ).toMatchObject({ toolActionsUsed: 1, status: "paused" });
      await expect(
        withOrchestrationNativeTool(db, nativeBinding(), call, async () => {
          effects++;
          return {};
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(effects).toBe(1);
    });
    it("withholds Native read output after membership changes during dispatch without retaining source bodies", async () => {
      await expect(
        withOrchestrationNativeTool(
          db,
          nativeBinding(),
          {
            tool: "get_task_context",
            callId: "native-revoked-during-read",
            arguments: {},
          },
          async () => {
            await db
              .delete(companyMemberships)
              .where(
                and(
                  eq(companyMemberships.companyId, f.home),
                  eq(companyMemberships.principalId, f.userId),
                ),
              );
            return { privateSource: "Never return this revoked fixture body" };
          },
        ),
      ).rejects.toMatchObject({ status: 403 });
      const [receipt] = await db
        .select()
        .from(toolInvocations)
        .where(eq(toolInvocations.runId, run.id));
      expect(receipt).toMatchObject({
        status: "failed",
        resultHash: null,
        errorMessage: null,
      });
      expect(JSON.stringify(receipt)).not.toContain("Never return");
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0],
      ).toMatchObject({ status: "paused", toolActionsUsed: 1 });
    });
    it("reserves before actual transport, keeps the encrypted key private and leaves completion to Native verification", async () => {
      const result = await gateway().call(claims, input());
      expect(result).toMatchObject({
        text: "Retained bounded draft",
        usage: { inputTokens: 10, outputTokens: 20 },
      });
      expect(observedKey).toBe(credential);
      expect(observedBody).not.toContain(credential);
      expect(JSON.stringify(result)).not.toContain(credential);
      expect((await ledger())[0]).toMatchObject({
        status: "completed",
        purpose: "worker_model",
        workerAttemptId: binding.workerAttemptId,
      });
      expect(
        (await db.select().from(issues).where(eq(issues.id, task.id)))[0]
          ?.status,
      ).toBe("todo");
      await expect(gateway().call(claims, input())).rejects.toMatchObject({
        status: 409,
      });
      expect(calls).toBe(1);
    });
    it("permits one durable dispatch winner under concurrent duplicate calls", async () => {
      const results = await Promise.allSettled([
        gateway().call(claims, input()),
        gateway().call(claims, input()),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(calls).toBe(1);
      expect(await ledger()).toHaveLength(1);
    });
    it("refuses cost overrun before any further model request", async () => {
      await gateway().call(claims, input());
      await gateway().call(claims, { ...input(), callId: "draft-2" });
      await expect(
        gateway().call(claims, { ...input(), callId: "draft-3" }),
      ).rejects.toMatchObject({ status: 403 });
      expect(calls).toBe(2);
      expect(await ledger()).toHaveLength(2);
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0]?.modelCostReserved,
      ).toBe(6);
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0]?.status,
      ).toBe("paused");
    });
    it.each([
      "membership",
      "grant",
      "assignment",
      "Stop",
      "flag",
      "plan version",
      "identity",
      "company",
    ])("blocks %s changes before spend", async (kind) => {
      await change(kind);
      await expect(gateway().call(claims, input())).rejects.toThrow();
      expect(calls).toBe(0);
      expect(await ledger()).toHaveLength(0);
    });
    async function change(kind: string) {
      if (kind === "membership")
        await db
          .update(companyMemberships)
          .set({ status: "suspended" })
          .where(
            and(
              eq(companyMemberships.companyId, f.home),
              eq(companyMemberships.principalId, f.userId),
            ),
          );
      if (kind === "grant" && profile.binding.mode !== "responsible_user")
        await db
          .update(connectionGrants)
          .set({ status: "revoked" })
          .where(eq(connectionGrants.id, profile.binding.grantId));
      if (kind === "assignment")
        await db
          .update(issues)
          .set({ assigneeAgentId: null })
          .where(eq(issues.id, task.id));
      if (kind === "Stop")
        await db
          .update(heartbeatRuns)
          .set({
            resultJson: { executionCancellation: { state: "requested" } },
          })
          .where(eq(heartbeatRuns.id, run.id));
      if (kind === "flag")
        await instanceSettingsService(db).updateExperimental({
          orchestration_v7: false,
        });
      if (kind === "plan version")
        await db
          .update(orchestrationPlans)
          .set({ version: plan.version + 1 })
          .where(eq(orchestrationPlans.id, plan.id));
      if (kind === "identity")
        await db
          .update(agentIdentities)
          .set({ status: "paused" })
          .where(eq(agentIdentities.id, f.identity.id));
      if (kind === "company")
        await db
          .update(companies)
          .set({ status: "paused" })
          .where(eq(companies.id, f.home));
      if (kind === "Task source")
        await db
          .update(issues)
          .set({ description: "The original request changed during inference" })
          .where(eq(issues.id, task.id));
    }
    it.each([
      "membership",
      "grant",
      "assignment",
      "Stop",
      "flag",
      "identity",
      "company",
      "Task source",
    ])(
      "retains unknown debit and requests Native Stop on %s during inference",
      async (kind) => {
        duringCall = () => change(kind);
        await expect(gateway().call(claims, input())).rejects.toMatchObject({
          status: 409,
        });
        expect(calls).toBe(1);
        expect((await ledger())[0]).toMatchObject({
          status: "unknown",
          maximumMinor: 3,
        });
        expect(
          (
            await db
              .select()
              .from(orchestrationPlans)
              .where(eq(orchestrationPlans.id, plan.id))
          )[0]?.status,
        ).toBe("paused");
        const stop = await db
          .select()
          .from(supervisionInterventions)
          .where(eq(supervisionInterventions.planId, plan.id));
        expect(stop[0]).toMatchObject({
          decisionAction: "ESCALATE_HUMAN",
          reasonCode: "worker_model_unsettled",
        });
        await expect(gateway().call(claims, input())).rejects.toThrow();
        expect(calls).toBe(1);
      },
    );
    it("rejects qualified token overflow and keeps the full conservative charge", async () => {
      inputTokens = profile.inputTokensUpperBound + 1;
      await expect(gateway().call(claims, input())).rejects.toMatchObject({
        status: 409,
      });
      expect((await ledger())[0]).toMatchObject({
        status: "unknown",
        maximumMinor: 3,
      });
    });
    it("binds company, run, attempt, manifest and current source instead of accepting caller prices or destinations", async () => {
      for (const altered of [
        { ...claims, company_id: f.guest },
        { ...claims, sub: f.guestPresence.id },
        { ...claims, run_id: randomUUID() },
        {
          ...claims,
          worker_model: { ...binding, workerAttemptId: randomUUID() },
        },
        {
          ...claims,
          worker_model: { ...binding, executionManifestId: randomUUID() },
        },
        { ...claims, exp: Math.floor(Date.now() / 1000) - 1 },
      ])
        await expect(gateway().call(altered, input())).rejects.toThrow();
      await expect(
        gateway().call(claims, { ...input(), maxOutputTokens: 2048 }),
      ).rejects.toThrow();
      await expect(
        gateway().call(claims, { ...input(), prompt: "x".repeat(65000) }),
      ).rejects.toThrow();
      await expect(
        gateway().call(claims, {
          ...input(),
          providerUrl: "https://attacker.invalid",
        } as ReturnType<typeof input>),
      ).rejects.toThrow();
      expect(calls).toBe(0);
      expect(await ledger()).toHaveLength(0);
    });
    it("uses a distinct five-minute capability and cannot widen another runtime scope", async () => {
      const minted = await gateway().issue(issueInput());
      expect(verifyRuntimeToolsToken(minted.token)).toBeNull();
      expect(
        verifyRuntimeToolsToken(minted.token, "github_credentials"),
      ).toBeNull();
      expect(claims.exp - claims.iat).toBe(300);
      const other = createRuntimeToolsToken({
        ...issueInput(),
        scope: "connection_intents",
      });
      expect(verifyRuntimeToolsToken(other!.token, "worker_model")).toBeNull();
      expect(
        createRuntimeToolsToken({ ...issueInput(), scope: "worker_model" }),
      ).toBeNull();
    });
    it("scrubs admitted source material during dispatch without releasing its financial debit or replaying the model call", async () => {
      const [mb] = await db
        .insert(memoryBindings)
        .values({
          companyId: f.home,
          key: "worker-gateway-privacy",
          name: "Private source",
          providerKey: "local",
        })
        .returning();
      const [record] = await db
        .insert(memoryRecords)
        .values({
          companyId: f.home,
          bindingId: mb!.id,
          providerKey: "local",
          memoryType: "fact",
          scopeType: "company",
          content: "Fixture source to erase",
          observedAt: new Date(),
          createdByActorType: "system",
          createdByActorId: "fixture",
        })
        .returning();
      const [manifest] = await db
        .select()
        .from(agentExecutionManifests)
        .where(eq(agentExecutionManifests.id, binding.executionManifestId));
      await db.insert(contextManifestMemoryRoots).values({
        companyId: f.home,
        manifestId: manifest!.contextManifestId,
        memoryRecordId: record!.id,
        sourceVersion: record!.updatedAt.toISOString(),
      });
      duringCall = () =>
        db.transaction((tx) =>
          purgeMemoryRecords(tx as unknown as typeof db, f.home, [record!.id]),
        );
      await expect(gateway().call(claims, input())).rejects.toMatchObject({
        status: 409,
      });
      expect((await ledger())[0]).toMatchObject({
        status: "unknown",
        maximumMinor: 3,
      });
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0],
      ).toMatchObject({
        status: "failed",
        erasedAt: expect.any(Date),
        modelCostReserved: 3,
      });
      await expect(gateway().call(claims, input())).rejects.toThrow();
      expect(calls).toBe(1);
    });
    it("mounts only the scoped runtime transport, rejects browser and ordinary credentials, and returns no provider key", async () => {
      const app = express();
      app.use(express.json());
      app.use(runtimeConnectionIntentRoutes(db, gateway()));
      app.use(errorHandler);
      const minted = await gateway().issue(issueInput());
      const post = () => request(app).post("/runtime-tools/model/messages");
      for (const [header, value] of [
        ["Origin", "https://board.test.invalid"],
        ["Cookie", "session=fixture"],
        ["Sec-Fetch-Site", "same-origin"],
      ])
        expect(
          (
            await post()
              .set("Authorization", `Bearer ${minted.token}`)
              .set(header!, value!)
              .send(input())
          ).status,
        ).toBe(403);
      for (const token of [
        "ordinary-board-or-agent-key",
        createRuntimeToolsToken({
          ...issueInput(),
          scope: "connection_intents",
        })!.token,
        createRuntimeToolsToken({
          ...issueInput(),
          scope: "github_credentials",
        })!.token,
      ])
        expect(
          (await post().set("Authorization", `Bearer ${token}`).send(input()))
            .status,
        ).toBe(401);
      const malformed = await post()
        .set("Authorization", `Bearer ${minted.token}`)
        .send({ ...input(), workerId: randomUUID() });
      expect(malformed.status).toBe(400);
      expect(calls).toBe(0);
      const result = await post()
        .set("Authorization", `Bearer ${minted.token}`)
        .send(input());
      expect(result.status).toBe(200);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.body.text).toBe("Retained bounded draft");
      expect(JSON.stringify(result.body)).not.toContain(credential);
      const unconfigured = express();
      unconfigured.use(express.json());
      unconfigured.use(runtimeConnectionIntentRoutes(db));
      unconfigured.use(errorHandler);
      expect(
        (
          await request(unconfigured)
            .post("/runtime-tools/model/messages")
            .set("Authorization", `Bearer ${minted.token}`)
            .send({ ...input(), callId: "offline" })
        ).status,
      ).toBe(403);
      expect(calls).toBe(1);
    });
  },
);
