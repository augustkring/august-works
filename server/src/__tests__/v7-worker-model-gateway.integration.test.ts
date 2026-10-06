import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import {
  afterAll,
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
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
const sourceSha = "a".repeat(40),
  credential = "fixture-private-worker-secret-12345";
const support = await getEmbeddedPostgresTestSupport();
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
      if (home) await rm(home, { recursive: true, force: true });
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
      expect(rows.at(-1)).toMatchObject({
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
    function gateway() {
      return workerModelGateway(db, {
        profiles: [profile],
        sourceSha,
        protectedEvidenceOrigin: "https://protected.test.invalid",
        fetch,
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
