import { createHash, randomUUID } from "node:crypto";
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
import { and, eq, sql } from "drizzle-orm";
import {
  agents,
  authUsers,
  agentIdentities,
  companies,
  companyMemberships,
  connectionGrants,
  createDb,
  heartbeatRuns,
  issues,
  agentExecutionManifests,
  contextManifestMemoryRoots,
  contextManifests,
  contextManifestItems,
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
  documentRevisions,
  issueThreadInteractions,
  memoryDeletionMarkers,
} from "@paperclipai/db";
import {
  PROVIDER_CAPABILITY_FEATURES,
  agentAuthoringContentSchema, AUTHORED_AGENT_DEFINITION_KEY,
  nativePayloadSourceSnapshotSchema,
  nativeRunInputSourceReceiptSchema,
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
import { purgeMemoryRecords, purgeDerivedWorkflowMemory, lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { assertAnalyticalContextPayloadAccess } from "../services/analytical-context-authority.js";
import { PaperclipRunnerToolAuthority } from "../services/native-runtime/paperclip-runner-tool-authority.js";
import { PaperclipRunnerSemanticAuthority } from "../services/native-runtime/runner-semantic-authority.js";
import { createAssignedMcpTools } from "../services/native-runtime/assigned-mcp-tools.js";
import type { ToolGatewayService } from "../services/tool-gateway.js";
import { withOrchestrationNativeTool } from "../services/orchestration/native-tool-boundary.js";
import { createAwTextDraftBackend } from "../services/native-runtime/aw-text-draft-backend.js";
import { registerNativeDraftGateway } from "../services/orchestration/native-draft-runtime.js";
import { heartbeatService } from "../services/heartbeat.js";
import { discoverNativeCapabilities } from "../services/native-provider-conformance.js";

function nativeDraftSourceFailureFacts(
  run: typeof heartbeatRuns.$inferSelect | null | undefined,
) {
  const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object"
    ? run.runnerProfileJson as Record<string, unknown>
    : {};
  const parsedReceipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
  const inputs = parsedReceipt.success ? parsedReceipt.data.bootstrap.inputs : [];
  const executionInput = profile.nativeExecutionInput && typeof profile.nativeExecutionInput === "object"
    ? profile.nativeExecutionInput as Record<string, unknown>
    : {};
  const taskCapture = profile.nativeBootstrapTaskSource && typeof profile.nativeBootstrapTaskSource === "object"
    ? profile.nativeBootstrapTaskSource as Record<string, unknown>
    : {};
  const taskCaptureInput = taskCapture.input && typeof taskCapture.input === "object"
    ? taskCapture.input as Record<string, unknown>
    : {};
  const authoredCapture = profile.nativeBootstrapAuthoredSources && typeof profile.nativeBootstrapAuthoredSources === "object"
    ? profile.nativeBootstrapAuthoredSources as Record<string, unknown>
    : {};
  const authoredInputs = Array.isArray(authoredCapture.inputs) ? authoredCapture.inputs.filter(
    (value): value is Record<string, unknown> => Boolean(value) && typeof value === "object",
  ) : [];
  const task = executionInput.task && typeof executionInput.task === "object"
    ? executionInput.task as Record<string, unknown>
    : {};
  const completionContract = executionInput.completionContract && typeof executionInput.completionContract === "object"
    ? executionInput.completionContract as Record<string, unknown>
    : {};
  const runtimeContext = executionInput.runtimeContext && typeof executionInput.runtimeContext === "object"
    ? executionInput.runtimeContext as Record<string, unknown>
    : {};
  const instructions = runtimeContext.instructions && typeof runtimeContext.instructions === "object"
    ? runtimeContext.instructions as Record<string, unknown>
    : {};
  const instructionBundle = instructions.bundle && typeof instructions.bundle === "object"
    ? instructions.bundle as Record<string, unknown>
    : {};
  const skills = Array.isArray(runtimeContext.skills) ? runtimeContext.skills : [];
  const taskDigest = createHash("sha256").update(JSON.stringify({
    id: run?.issueId,
    identifier: task.identifier,
    title: task.title,
    description: task.description,
    workMode: task.workMode,
  }), "utf8").digest("hex");
  const taskSource = inputs.find((source) => source.kind === "task" && source.issueId === run?.issueId);
  const contractSource = inputs.find((source) => source.kind === "completion_contract" &&
    source.issueId === run?.issueId && source.contractId === completionContract.id &&
    source.contentHash === completionContract.sha256);
  const instructionSource = inputs.find((source) => source.kind === "runtime_instructions" &&
    source.agentId === run?.agentId && source.bundleDigest === instructionBundle.digest &&
    source.manifestDigest === instructionBundle.manifestDigest);
  const runtimeSkills = inputs.filter((source) => source.kind === "runtime_skill");
  const skillMatches = skills.map((value) => {
    const skill = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const bundle = skill.bundle && typeof skill.bundle === "object" ? skill.bundle as Record<string, unknown> : {};
    return runtimeSkills.some((source) => source.kind === "runtime_skill" && source.key === skill.key &&
      source.versionId === skill.versionId && source.bundleDigest === bundle.digest &&
      source.manifestDigest === bundle.manifestDigest);
  });
  return {
    receiptValid: parsedReceipt.success,
    bootstrapKinds: inputs.map((source) => source.kind),
    profileKeys: Object.keys(profile).sort(),
    executionInputKeys: Object.keys(executionInput).sort(),
    taskCaptureKind: taskCaptureInput.kind ?? null,
    authoredSourceKinds: authoredInputs.map((source) => source.kind ?? "unknown"),
    runtimeContextKeys: Object.keys(runtimeContext).sort(),
    taskFound: Boolean(taskSource),
    taskDigestMatches: taskSource?.contentHash === taskDigest,
    completionContractFound: Boolean(contractSource),
    completionContractRevision: inputs.find((source) => source.kind === "completion_contract")?.kind === "completion_contract"
      ? inputs.find((source) => source.kind === "completion_contract")!.revision
      : null,
    instructionFound: Boolean(instructionSource),
    skillCount: skills.length,
    skillSourceCount: runtimeSkills.length,
    skillMatches,
  };
}
import {
  validatePrpEvent,
  validatePrpStructuredRunResult,
} from "../vendor/paperclip-runner/index.js";
import { documentService } from "../services/documents.js";
import { agentService } from "../services/agents.js";
import { compileAuthoredAgentDefinition, readAuthoredAgentDefinition } from "../services/agents/authored-definition.js";
import { issueThreadInteractionService } from "../services/issue-thread-interactions.js";
import { issueService } from "../services/issues.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../services/provider-capabilities.js";
import { hashContextPolicySnapshot } from "../services/context/context-manifest.js";
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
      modelOutput: string,
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
    beforeEach(async (context) => {
      await instanceSettingsService(db).updateExperimental({
        enableWorkflowsV1: true,
        role_packs_v5: false,
        skill_resolver_v5: false,
        readiness_engine_v7: true,
        orchestration_v7: true,
      });
      f = await seedV5Presences(db);
      const workerProfileId = randomUUID();
      await db
        .update(agents)
        .set({ adapterType: "claude_local" })
        .where(eq(agents.id, f.presence.id));
      // This mode publishes through the Original owner before manifest creation;
      // it does not patch an already retained execution pin to fit the test.
      if (context.task.name.startsWith("reviewed proposal:")) {
        const definition = compileAuthoredAgentDefinition(agentAuthoringContentSchema.parse({
          name: "Internal task proposer", description: "Drafts one bounded follow-up for Human review",
          outcome: "Draft a bounded internal follow-up", ownerUserId: f.userId,
          capabilities: [{ operation: "create_internal_draft", autonomy: "automatic" }, { operation: "create_task", autonomy: "ask_first" }],
          instructions: { purpose: "Draft internal work", responsibilities: "Propose one follow-up", prohibited: "No external actions",
            missingInformation: "Ask the owner", escalation: "Ask the owner", communication: "Plain language" },
        }), randomUUID(), "a".repeat(64));
        await agentService(db).update(f.presence.id, { adapterType: "paperclip_runner", adapterConfig: { provider: "aw_text_only", model: "fixture-worker-model-20261005", workerModelProfileId: workerProfileId, lifecycleMode: "per_turn" },
          runtimeConfig: { [AUTHORED_AGENT_DEFINITION_KEY]: definition } },
        { authoredPublication: definition, recordRevision: { id: definition.revisionId, source: "agent_authoring_publish", createdByUserId: f.userId } });
      }
      const providers = agentProviderBindingService(db),
        pb = await providers.create(f.actor, f.home, f.presence.id, {
          providerType: "paperclip_native",
          providerAgentRef: f.presence.id,
          isolationMode: "isolated_per_presence",
          providerEndpointRef: null,
        });
      const attached = await providers.attach(f.actor, f.home, f.presence.id, {
        providerBindingId: pb.id,
        providerProfileRef: f.presence.id,
      });
      if (context.task.name.startsWith("reviewed proposal:")) {
        const agent = (await agentService(db).getById(f.presence.id))!;
        const snapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId: f.home, adapterType: agent.adapterType, config: agent.adapterConfig }));
        // Software fixture metadata through the Original owner, not live conformance.
        await providers.recordDiscovery(f.home, agent.id, snapshot,
          Object.fromEntries(providerConformanceRequirements(snapshot, pb.isolationMode).map(check => [check, true])),
          { configurationHash: hashContextPolicySnapshot({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig }),
            runtimeId: attached.id, profileRef: attached.providerProfileRef, bindingId: pb.id, accountingComplete: true });
      } else await providers.recordDiscovery(
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
        budgets: { maxModelCostMinor: 6, maxToolActions: context.task.name.startsWith("reviewed proposal:") && !context.task.name.includes("insufficient retained") ? 3 : 2 },
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
        id: workerProfileId,
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
      modelOutput = "Retained bounded draft";
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
      const sourceActor = await seedCurrentHumanSourceActor(db, [f.home], f.userId);
      task = await issueService(db).create(f.home, {
        title: "Produce the scheduler's single internal draft",
        description: "Retain one internal draft for human review.",
        status: "todo",
        workMode: "standard",
        responsibleUserId: f.userId,
        createdByUserId: f.userId,
      }, db, undefined, { manualInputActor: sourceActor, privacyActor: sourceActor, sourceAccessActor: sourceActor });
      expect(task.payloadSourceSnapshot, "manual Task producer must retain its canonical source snapshot before assignment").toBeTruthy();
      task = await issueService(db).update(task.id, {
        assigneeAgentId: f.presence.id,
        actorUserId: f.userId,
        privacyActor: sourceActor,
      });
      if (!task) throw new Error("Canonical Task assignment was not stored");
      const [persistedTask] = await db.select({ payloadSourceSnapshot: issues.payloadSourceSnapshot })
        .from(issues).where(eq(issues.id, task.id));
      expect(nativePayloadSourceSnapshotSchema.safeParse(persistedTask?.payloadSourceSnapshot).success,
        "assignment must preserve the unchanged human-authored Task snapshot").toBe(true);
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
      const assertCurrentTaskSnapshot = async (phase: string) => {
        const [current] = await db.select({ payloadSourceSnapshot: issues.payloadSourceSnapshot })
          .from(issues).where(eq(issues.id, task.id));
        expect(nativePayloadSourceSnapshotSchema.safeParse(current?.payloadSourceSnapshot).success,
          `canonical human Task source snapshot must remain current ${phase}`).toBe(true);
      };
      await assertCurrentTaskSnapshot("after plan creation");
      const started = await orchestrationService(db).decide(f.actor, f.home, plan.id, {
        expectedVersion: plan.version,
        action: "start",
        rationale: "Start only the operator-qualified bounded internal draft",
      });
      await assertCurrentTaskSnapshot("after plan start");
      return started;
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
      const started = await freshNativePlan({ maxModelCostMinor: 6, maxToolActions: 3 });
      modelOutput = "Retained bounded draft";
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
      if (actualRun?.status !== "succeeded") {
        const persistedError = typeof actualRun?.error === "string" ? actualRun.error : null;
        console.info("Worker heartbeat persisted failure", JSON.stringify({
          status: actualRun?.status ?? null,
          errorCode: actualRun?.errorCode ?? null,
          error: persistedError?.slice(0, 512).replaceAll(credential, "[redacted]") ?? null,
          sourceClosure: nativeDraftSourceFailureFacts(actualRun),
        }));
      }
      expect(actualRun?.issueId, "the exercised scheduler run must retain the canonical human-authored Task").toBe(task.id);
      expect(actualRun).toMatchObject({
        status: "succeeded",
        runtimeMode: "native",
        driverKind: "aw_text_messages",
        responsibleUserId: f.userId,
      });
      expect(actualRun!.error).toBeNull();
      const sourceReceipt = nativeRunInputSourceReceiptSchema.parse(
        (actualRun!.runnerProfileJson as Record<string, unknown>).nativeInputSourceReceipt,
      );
      expect(sourceReceipt.bootstrap.inputs.map((source) => source.kind)).toEqual(
        expect.arrayContaining(["task", "context", "workspace_metadata"]),
      );
      expect(substitution).not.toHaveBeenCalled();
      expect(calls).toBe(1);
      expect(observedBody).toContain("assignedRuntimeContext");
      expect(observedBody).not.toContain("## Pinned execution inventory");
      expect(observedBody).not.toContain(credential);
      expect(
        (await documentService(db).getIssueDocumentByKey(task.id, "result"))
          ?.body,
      ).toBe("Retained bounded draft");
      const [revision] = await db.select({ revision: documentRevisions }).from(issueDocuments)
        .innerJoin(documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
        .innerJoin(documentRevisions, and(eq(documentRevisions.companyId, documents.companyId),
          eq(documentRevisions.id, documents.latestRevisionId), eq(documentRevisions.documentId, documents.id)))
        .where(and(eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
      expect(revision?.revision.payloadSourceProtocolVersion).toBe(1);
      expect(revision?.revision.payloadSourceSnapshot?.inputs.map((source) => source.kind)).toEqual(
        expect.arrayContaining(["task", "completion_contract", "runtime_instructions", "worker_model_dispatch"]),
      );
      const wireDispatch = ((actualRun!.runnerProfileJson as Record<string, unknown>).nativeAwModelWireIntents as Array<Record<string, unknown>>)[0];
      expect(revision?.revision.payloadSourceSnapshot?.inputs).toContainEqual(expect.objectContaining({
        kind: "worker_model_dispatch", runId: actualRun!.id, requestHash: wireDispatch!.requestHash,
        wireBodyHash: wireDispatch!.wireBodyHash,
      }));
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

      // The dispatch run is provenance for the copied model output, not a
      // grant over the canonical Human Task that existed before the run.
      const independentActor = await seedCurrentHumanSourceActor(db, [f.home], f.userId);
      const { document: independentDocument } = await documentService(db).upsertIssueDocument({
        issueId: task.id, key: "human-note", title: "Independent Human note", format: "markdown",
        body: "KEEP_INDEPENDENT_DOCUMENT", createdByUserId: f.userId, manualInputActor: independentActor,
      });
      await db.transaction(async rawTx => {
        const tx = rawTx as unknown as typeof db;
        await lockMemoryPrivacy(tx, f.home);
        await tx.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${actualRun!.id}` });
        await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [actualRun!.id] });
      });
      const [retainedTask] = await db.select().from(issues).where(eq(issues.id, task.id));
      expect(retainedTask).toMatchObject({ title: "Produce the scheduler's single internal draft", description: "Retain one internal draft for human review." });
      const [erasedRevision] = await db.select().from(documentRevisions).where(eq(documentRevisions.id, revision!.revision.id));
      expect(erasedRevision).toMatchObject({ body: "", title: null, payloadSourceSnapshot: null });
      const [retainedDocument] = await db.select().from(documents).where(eq(documents.id, independentDocument.id));
      expect(retainedDocument).toMatchObject({ title: "Independent Human note", latestBody: "KEEP_INDEPENDENT_DOCUMENT" });
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
      const invocation = await heartbeat.invoke(
        f.presence.id,
        "on_demand",
        { issueId: task.id },
        "manual",
        { actorType: "user", actorId: f.userId },
      );
      await heartbeat.drainActiveRunExecutions();
      const [actualRun] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, invocation!.id));
      if (actualRun?.status !== "succeeded") {
        const persistedError = typeof actualRun?.error === "string" ? actualRun.error : null;
        console.info("Worker heartbeat persisted failure", JSON.stringify({
          status: actualRun?.status ?? null,
          errorCode: actualRun?.errorCode ?? null,
          error: persistedError?.slice(0, 512).replaceAll(credential, "[redacted]") ?? null,
          sourceClosure: nativeDraftSourceFailureFacts(actualRun),
        }));
      }
      expect(calls).toBe(1);
      expect(
        await documentService(db).getIssueDocumentByKey(task.id, "result"),
      ).toBeNull();
      expect((await ledger())[0]).toMatchObject({
        status: "completed",
        maximumMinor: 3,
        usage: { inputTokens, outputTokens: 20 },
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
          content: [{ type: "text", text: modelOutput }],
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
    it("reviewed proposal: saves bounded data and requests Human approval before any backlog task exists", async () => {
      modelOutput = JSON.stringify({ draft: "Review the internal evidence", proposedTask: { title: "Follow up on the approved scope", description: "Compare only the internal source" } });
      const session = await draftBackend().openSession({ identity: sessionIdentity() });
      await session.startTurn({ message: { role: "user", text: "Propose one internal follow-up for Human review" } });
      expect(await session.result()).toMatchObject({ result: { reportedWorkDisposition: "needs_review", completionClaim: { objectiveSatisfied: false } } });
      expect(calls).toBe(1);
      expect(JSON.parse(observedBody).system).toContain("proposedTask");
      expect(JSON.parse(observedBody).tools).toBeUndefined();
      const [proposal] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.issueId, task.id));
      expect(proposal).toMatchObject({ kind: "suggest_tasks", status: "pending", requestedResolverPolicy: "human_only", continuationPolicy: "none", sourceRunId: run.id,
        payload: { version: 1, tasks: [{ clientKey: "proposed-task", title: "Follow up on the approved scope", description: "Compare only the internal source", status: "backlog", placement: "company_backlog" }] } });
      expect(await db.select().from(issues).where(eq(issues.originRunId, run.id))).toEqual([]);
      expect((await documentService(db).getIssueDocumentByKey(task.id, "result"))?.body).toContain("Proposed task — not created");
      const service = issueThreadInteractionService(db);
      await expect(service.acceptInteraction(task, proposal!.id, {}, { agentId: f.presence.id, runId: run.id, suggestedTaskEffectsAuthorized: true })).rejects.toThrow();
      const resolutions = await Promise.allSettled([
        service.acceptInteraction(task, proposal!.id, {}, { userId: f.userId }),
        service.acceptInteraction(task, proposal!.id, {}, { userId: f.userId }),
      ]);
      const failures = resolutions.filter(result => result.status === "rejected").map(result => ({
        code: result.reason?.details?.code ?? result.reason?.code,
        reason: result.reason?.cause?.message ?? result.reason?.message,
      }));
      expect(resolutions.filter(result => result.status === "fulfilled"), JSON.stringify(failures)).toHaveLength(1);
      expect(resolutions.filter(result => result.status === "rejected")).toHaveLength(1);
      const accepted = resolutions.find(result => result.status === "fulfilled")!.value;
      expect(accepted.createdIssues).toEqual([expect.objectContaining({ status: "backlog", assigneeAgentId: null })]);
      const [child] = await db.select().from(issues).where(eq(issues.id, accepted.createdIssues[0]!.id));
      expect(child).toMatchObject({ companyId: f.home, parentId: null, originRunId: run.id, originId: `paperclip-suggested-task:${proposal!.id}`,
        createdByUserId: f.userId, assigneeAgentId: null, assigneeUserId: null, status: "backlog" });
      await expect(service.acceptInteraction(task, proposal!.id, {}, { userId: f.userId })).rejects.toThrow();
      expect(await db.select().from(issues).where(eq(issues.originRunId, run.id))).toHaveLength(1);
      const lineage = await db.execute<{ source_run_id: string; source_task_id: string; invalid: boolean }>(sql`
        select * from aw_runner_task_source_chain(${f.home}::uuid,null,${child!.id}::uuid)`);
      expect(lineage).toEqual([expect.objectContaining({ source_run_id: run.id, source_task_id: task.id, invalid: false })]);
      const [forged] = await db.insert(issues).values({ companyId: f.home, title: "FORGED receipt identity", status: "backlog",
        createdByUserId: f.userId, originKind: "manual", originRunId: run.id, originId: child!.originId }).returning();
      await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { issueId: forged!.id }))
        .rejects.toMatchObject({ status: 403, details: { code: "analytical_source_access_lost" } });
      await db.transaction(async rawTx => {
        const tx = rawTx as unknown as typeof db;
        await lockMemoryPrivacy(tx, f.home);
        await tx.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${run.id}` });
        await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [run.id] });
      });
      expect((await db.select().from(issues).where(eq(issues.id, child!.id)))[0])
        .toMatchObject({ title: "Erased workflow task", description: null });
      await expect(assertAnalyticalContextPayloadAccess(db, f.home, f.actor, { issueId: child!.id }))
        .rejects.toMatchObject({ status: 403, details: { code: "analytical_source_access_lost" } });
    });
    it("reviewed proposal: explicit absence saves a draft without requesting task approval", async () => {
      modelOutput = JSON.stringify({ draft: "No additional task is needed", proposedTask: null });
      const session = await draftBackend().openSession({ identity: sessionIdentity() });
      await session.startTurn({ message: { role: "user", text: "Draft only the requested answer" } });
      expect(await session.result()).toMatchObject({ result: { reportedWorkDisposition: "needs_review" } });
      expect(await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.issueId, task.id))).toEqual([]);
      expect((await documentService(db).getIssueDocumentByKey(task.id, "result"))?.body).toBe("No additional task is needed");
    });
    it("reviewed proposal: erased run Source prevents Human task creation and rolls back the verdict", async () => {
      modelOutput = JSON.stringify({ draft: "A Source-bound draft", proposedTask: { title: "A Source-bound task", description: "Only retained source data" } });
      const session = await draftBackend().openSession({ identity: sessionIdentity() });
      await session.startTurn({ message: { role: "user", text: "Propose one internal task" } });
      expect(await session.result()).toMatchObject({ result: { reportedWorkDisposition: "needs_review" } });
      const [proposal] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.issueId, task.id));
      await db.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${run.id}` });
      const service = issueThreadInteractionService(db);
      await expect(service.acceptInteraction(task, proposal!.id, {}, { userId: f.userId })).rejects.toMatchObject({ status: 403 });
      expect((await service.getById(proposal!.id))?.status).toBe("pending");
      expect(await db.select().from(issues).where(eq(issues.originRunId, run.id))).toEqual([]);
    });
    it("reviewed proposal: current Human membership withdrawal prevents separate task creation", async () => {
      modelOutput = JSON.stringify({ draft: "A bounded draft", proposedTask: { title: "A bounded task", description: "Original internal scope" } });
      const session = await draftBackend().openSession({ identity: sessionIdentity() });
      await session.startTurn({ message: { role: "user", text: "Propose one internal task" } });
      expect(await session.result()).toMatchObject({ result: { reportedWorkDisposition: "needs_review" } });
      const [proposal] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.issueId, task.id));
      await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, f.userId)));
      const service = issueThreadInteractionService(db);
      await expect(service.acceptInteraction(task, proposal!.id, {}, { userId: f.userId })).rejects.toMatchObject({ status: 403 });
      expect((await service.getById(proposal!.id))?.status).toBe("pending");
      expect(await db.select().from(issues).where(eq(issues.originRunId, run.id))).toEqual([]);
    });
    it("reviewed proposal: an unverified Human cannot approve a separate task", async () => {
      modelOutput = JSON.stringify({ draft: "A bounded draft", proposedTask: { title: "A bounded task", description: "Original internal scope" } });
      const session = await draftBackend().openSession({ identity: sessionIdentity() });
      await session.startTurn({ message: { role: "user", text: "Propose one internal task" } });
      expect(await session.result()).toMatchObject({ result: { reportedWorkDisposition: "needs_review" } });
      const [proposal] = await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.issueId, task.id));
      await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
      const service = issueThreadInteractionService(db);
      await expect(service.acceptInteraction(task, proposal!.id, {}, { userId: f.userId })).rejects.toMatchObject({ status: 403 });
      expect((await service.getById(proposal!.id))?.status).toBe("pending");
      expect(await db.select().from(issues).where(eq(issues.originRunId, run.id))).toEqual([]);
    });
    it("reviewed proposal: refuses an insufficient retained tool budget before any model dispatch", async () => {
      await expect(draftBackend().openSession({ identity: sessionIdentity() })).rejects.toThrow("three remaining Native tool actions");
      expect(calls).toBe(0);
      expect(await ledger()).toEqual([]);
    });
    it("reviewed proposal: refuses model-selected assignees before saving output or an interaction", async () => {
      modelOutput = JSON.stringify({ draft: "An invalid proposal", proposedTask: { title: "Widen the scope", description: "Unsafe extra fields", assigneeAgentId: f.guestPresence.id } });
      const session = await draftBackend().openSession({ identity: sessionIdentity() });
      await session.startTurn({ message: { role: "user", text: "Propose one bounded task" } });
      expect(await session.result()).toBeNull();
      expect((await ledger())[0]).toMatchObject({ status: "completed", maximumMinor: 3 });
      expect(await documentService(db).getIssueDocumentByKey(task.id, "result")).toBeNull();
      expect(await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.issueId, task.id))).toEqual([]);
      expect(await db.select().from(issues).where(eq(issues.parentId, task.id))).toEqual([]);
    });
    it("reviewed proposal: withdraws publication when the Original Agent version changes during inference", async () => {
      modelOutput = JSON.stringify({ draft: "A stale candidate", proposedTask: { title: "A stale task", description: "Do not publish this scope" } });
      duringCall = async () => {
        const agent = (await agentService(db).getById(f.presence.id))!;
        const current = (await readAuthoredAgentDefinition(db, agent))!;
        const next = compileAuthoredAgentDefinition({ ...current.content, outcome: "A different approved responsibility" }, randomUUID(), "b".repeat(64));
        await agentService(db).update(agent.id, { runtimeConfig: { [AUTHORED_AGENT_DEFINITION_KEY]: next } },
          { authoredPublication: next, recordRevision: { id: next.revisionId, source: "agent_authoring_publish", createdByUserId: f.userId } });
      };
      const session = await draftBackend().openSession({ identity: sessionIdentity() });
      await session.startTurn({ message: { role: "user", text: "Propose the original reviewed scope" } });
      expect(await session.result()).toBeNull();
      expect(calls).toBe(1);
      expect(await documentService(db).getIssueDocumentByKey(task.id, "result")).toBeNull();
      expect(await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.issueId, task.id))).toEqual([]);
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
        status: "completed",
        maximumMinor: 3,
        usage: { inputTokens, outputTokens: 20 },
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
    it("limits plan-created Tasks to C0 backlog drafts without delegation", async () => {
      let effects = 0;
      const call = {
        tool: "create_task",
        callId: "bounded-backlog-task",
        arguments: { idempotencyKey: "bounded-backlog-task", title: "Private draft", status: "backlog" },
      };
      await expect(withOrchestrationNativeTool(db, nativeBinding(), call,
        async () => { effects++; return { task: { id: randomUUID() } }; })).resolves.toMatchObject({
        task: { id: expect.any(String) },
      });
      await expect(withOrchestrationNativeTool(db, nativeBinding(), call,
        async () => { effects++; return {}; })).rejects.toMatchObject({ status: 409 });
      await expect(withOrchestrationNativeTool(db, nativeBinding(), {
        tool: "create_task",
        callId: "unqualified-todo-task",
        arguments: { idempotencyKey: "unqualified-todo-task", title: "Would start work", status: "todo" },
      }, async () => { effects++; return { task: { id: randomUUID() } }; })).rejects.toMatchObject({ status: 403 });
      const [c1Task] = await db.insert(issues).values({ companyId: f.home, title: "C1 Task plan fixture",
        status: "todo", assigneeAgentId: f.presence.id }).returning();
      const [c1Run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id,
        responsibleUserId: f.userId, status: "running", runtimeMode: "native", nativeIssueId: c1Task!.id,
        contextSnapshot: { issueId: c1Task!.id } }).returning();
      const c1Prepared = await agentRuntimeFabricService(db).prepare({ companyId: f.home, agentId: f.presence.id,
        runId: c1Run!.id, responsibleUserId: f.userId, issueId: c1Task!.id, query: c1Task!.title });
      const c1Plan = await orchestrationService(db).create(f.actor, f.home, {
        issueId: c1Task!.id, expectedIssueUpdatedAt: c1Task!.updatedAt.toISOString(), workload: "semantic", riskClass: "C1",
        completionContract: { objective: "Save one internal C1 draft", requiredOutputs: [{ key: "result" }],
          businessInvariants: ["Use authorized sources only"] },
        budgets: { maxModelCostMinor: 6, maxToolActions: 2 }, workers: [{ key: "writer", issueId: c1Task!.id }],
      });
      await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(),
        executionPrincipal: { type: "user", userId: f.userId } }).where(eq(orchestrationPlans.id, c1Plan.id));
      const [c1Worker] = await db.update(orchestrationWorkers).set({ status: "running", attemptCount: 1 })
        .where(eq(orchestrationWorkers.planId, c1Plan.id)).returning();
      await db.insert(orchestrationWorkerAttempts).values({ companyId: f.home, planId: c1Plan.id,
        workerId: c1Worker!.id, agentId: f.presence.id, runId: c1Run!.id,
        executionManifestId: c1Prepared!.record.id, attempt: 1 });
      await db.update(issues).set({ executionRunId: c1Run!.id }).where(eq(issues.id, c1Task!.id));
      await expect(withOrchestrationNativeTool(db, { companyId: f.home, issueId: c1Task!.id,
        agentId: f.presence.id, runId: c1Run!.id }, {
        tool: "create_task",
        callId: "unqualified-c1-task",
        arguments: { idempotencyKey: "unqualified-c1-task", title: "Material plan", status: "backlog" },
      }, async () => { effects++; return {}; })).rejects.toMatchObject({ status: 403 });
      for (const [callId, extra] of [
        ["unqualified-assignment-task", { assigneeActorId: randomUUID() }],
        ["unqualified-placement-task", { projectId: randomUUID() }],
        ["unqualified-plan-task", { initialPlan: "PRIVATE execution plan" }],
        ["unqualified-dependency-task", { blockedByTaskIds: [randomUUID()] }],
        ["unqualified-repository-task", { repositoryId: randomUUID() }],
        ["unqualified-workspace-task", { workspaceId: randomUUID() }],
        ["unqualified-approval-task", { approvalId: randomUUID() }],
      ] as const) {
        await expect(withOrchestrationNativeTool(db, nativeBinding(), {
          tool: "create_task",
          callId,
          arguments: { idempotencyKey: callId, title: "Unqualified material field", status: "backlog", ...extra },
        }, async () => { effects++; return {}; })).rejects.toMatchObject({ status: 403 });
      }
      const [materialTask] = await db.insert(issues).values({ companyId: f.home, title: "Material Task plan fixture",
        status: "todo", assigneeAgentId: f.presence.id }).returning();
      const [materialRun] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id,
        responsibleUserId: f.userId, status: "running", runtimeMode: "native", nativeIssueId: materialTask!.id,
        contextSnapshot: { issueId: materialTask!.id } }).returning();
      const materialPrepared = await agentRuntimeFabricService(db).prepare({ companyId: f.home, agentId: f.presence.id,
        runId: materialRun!.id, responsibleUserId: f.userId, issueId: materialTask!.id, query: materialTask!.title });
      const materialPlan = await orchestrationService(db).create(f.actor, f.home, {
        issueId: materialTask!.id, expectedIssueUpdatedAt: materialTask!.updatedAt.toISOString(), workload: "semantic",
        actionClass: "data_mutation", riskClass: "C2",
        completionContract: { objective: "Save one internal material Task", requiredOutputs: [{ key: "result" }],
          businessInvariants: ["Use authorized sources only"],
          requiredPostconditions: [{ kind: "tool_receipt", toolName: "create_task", argumentsHash: "a".repeat(64) }] },
        budgets: { maxModelCostMinor: 6, maxToolActions: 2 }, workers: [{ key: "writer", issueId: materialTask!.id }],
      });
      await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(),
        executionPrincipal: { type: "user", userId: f.userId } }).where(eq(orchestrationPlans.id, materialPlan.id));
      const [materialWorker] = await db.update(orchestrationWorkers).set({ status: "running", attemptCount: 1 })
        .where(eq(orchestrationWorkers.planId, materialPlan.id)).returning();
      await db.insert(orchestrationWorkerAttempts).values({ companyId: f.home, planId: materialPlan.id,
        workerId: materialWorker!.id, agentId: f.presence.id, runId: materialRun!.id,
        executionManifestId: materialPrepared!.record.id, attempt: 1 });
      await db.update(issues).set({ executionRunId: materialRun!.id }).where(eq(issues.id, materialTask!.id));
      await expect(withOrchestrationNativeTool(db, { companyId: f.home, issueId: materialTask!.id,
        agentId: f.presence.id, runId: materialRun!.id }, {
        tool: "create_task",
        callId: "unqualified-material-plan-task",
        arguments: { idempotencyKey: "unqualified-material-plan-task", title: "Material plan", status: "backlog" },
      }, async () => { effects++; return {}; })).rejects.toMatchObject({ status: 403 });
      expect(effects).toBe(1);
      expect(await db.select().from(toolInvocations).where(eq(toolInvocations.runId, run.id))).toHaveLength(1);
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
      "settles known usage without disclosure and requests Native Stop on %s during inference",
      async (kind) => {
        duringCall = () => change(kind);
        await expect(gateway().call(claims, input())).rejects.toMatchObject({
          status: 409,
        });
        expect(calls).toBe(1);
        expect((await ledger())[0]).toMatchObject({
          status: "completed",
          maximumMinor: 3,
          usage: { inputTokens, outputTokens: 20 },
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
          reasonCode: "worker_model_result_withheld",
        });
        await expect(gateway().call(claims, input())).rejects.toThrow();
        expect(calls).toBe(1);
      },
    );
    it("rejects qualified token overflow and keeps the full conservative charge", async () => {
      inputTokens = profile.inputTokensUpperBound + 1;
      await expect(gateway().call(claims, input())).rejects.toMatchObject({
        status: 409,
        details: { code: "worker_model_unsettled" },
      });
      expect((await ledger())[0]).toMatchObject({
        status: "unknown",
        maximumMinor: 3,
      });
      const interventions = await db.select().from(supervisionInterventions)
        .where(eq(supervisionInterventions.planId, plan.id));
      expect(interventions[0]).toMatchObject({ reasonCode: "worker_model_unsettled" });
      expect(calls).toBe(1);
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
        status: "completed",
        maximumMinor: 3,
        usage: { inputTokens, outputTokens: 20 },
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
