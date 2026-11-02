import { assertManagedFixtureOpenCodeImage } from "./managed-native-opencode-fixture-pin.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createConnection, Socket } from "node:net";
import { createManagedModelTunnelAssociations, type ModelChannel, type ManagedModelTunnel } from "./managed-native-model-transport.js";
import { createServer as createHttpsServer } from "node:https";
import { connect as connectTls } from "node:tls";
import { execFile, execFileSync } from "node:child_process";
import express, { type Express as ExpressApp, type Request as ExpressRequest } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { agents, agentExecutionManifests, authSessions, authUsers, companies, companyMemberships,
  heartbeatRunEvents, heartbeatRuns, issueComments, issueThreadInteractions, issues, toolInvocations,
  orchestrationModelReservations, orchestrationPlans, orchestrationWorkerAttempts, createDb } from "@paperclipai/db";
import { workerModelProfileSchema, type WorkerModelProfile } from "../../services/orchestration/worker-model-profiles.js";
import { workerModelGateway } from "../../services/orchestration/worker-model-gateway.js";
import { aiConnectionService } from "../../services/ai-connections.js";
import { agentProviderBindingService } from "../../services/agent-provider-bindings.js";
import { discoverNativeCapabilities } from "../../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../../services/provider-capabilities.js";
import { hashContextPolicySnapshot } from "../../services/context/context-manifest.js";
import { enableV5ForTest, seedV5Presences } from "./v5-fixtures.js";
import { seedNativePasskeyActor } from "./native-authentication-fixtures.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { heartbeatService } from "../../services/heartbeat.js";
import { issueRoutes } from "../../routes/issues.js";
import { runtimeConnectionIntentRoutes } from "../../routes/connection-intents.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { actorMiddleware } from "../../middleware/auth.js";
import type { BetterAuthSessionResult } from "../../auth/better-auth.js";
import { verifyRuntimeToolsToken } from "../../runtime-tools-token.js";
import { setupRunnerPrpWebSocketServer, runnerPrpWebSocketInternals } from "../../realtime/runner-prp-ws.js";
import { createToolGatewayService } from "../../services/tool-gateway.js";
import { mcpGatewayProtocolRoutes } from "../../routes/tool-gateway.js";
import { registerAssignedMcpGateway } from "../../services/native-runtime/assigned-mcp-tools.js";
import type { AuthorizationActor } from "../../services/authorization.js";

const sourceSha = "a".repeat(40);

import { makeConversationFixtureTreeWritable } from "./managed-native-conversation-frame.js";
import type { runManagedNativeConversationFrame } from "./managed-native-conversation-frame.js";
import type { NativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { nativeSha256 } from "../../services/native-runtime/canonical.js";
import { registerNativeDraftGateway } from "../../services/orchestration/native-draft-runtime.js";

type FrameInput = Parameters<typeof runManagedNativeConversationFrame>[0];
/** Pre-run extraction of the existing controlled Host fixture. The driver
 * calls the real scheduler; this helper never inserts a Run or worker attempt.
 * Fake CLI/provider HTTP effects remain software-only, not physical evidence. */
export async function withManagedNativeHeartbeatFixture<T>(input: Omit<FrameInput,
  "providerReply" | "createConversationApp" | "driveConversation" | "configureHeartbeat"> & {
  /** Explicit opt-in. The default retains the original one-Run Host. */
  schedulerMode?: "serial";
  providerReply: (facts: { body: Record<string, unknown>; callIndex: number; execution: NativeExecutionInput;
    runId: string; issueId: string | null }) => {
    stop_reason: "tool_use" | "end_turn"; content: Array<Record<string, unknown>>;
  };
  /** Observe only after the fixture Host has authenticated the current provider and signed model request. */
  beforeManagedModelRequest?: (facts: { body: unknown; runId: string; issueId: string | null }) => Promise<void>;
  /** Observe a completed result from the real assigned-MCP owner; replay calls the same bound owner with captured inputs. */
  afterSuccessfulAssignedToolResult?: (facts: {
    call: Parameters<ReturnType<typeof createToolGatewayService>["executeTool"]>[0];
    result: Awaited<ReturnType<ReturnType<typeof createToolGatewayService>["executeTool"]>>;
    replay: () => ReturnType<ReturnType<typeof createToolGatewayService>["executeTool"]>;
  }) => Promise<void>;
  configureHeartbeat?: FrameInput["configureHeartbeat"];
  driveScheduler: (context: { db: ReturnType<typeof createDb>; actor: AuthorizationActor; companyId: string;
    agentId: string; gateway: ReturnType<typeof workerModelGateway>; heartbeat: ReturnType<typeof heartbeatService>;
    facts: () => { providerCallCount: number; issuerFacts: Array<{ scope: string; runId: string; manifestId: string }>;
      sandboxRuntimeFacts: Record<string, unknown> | null };
    factsForRun: (runId: string) => { providerCallCount: number; issuerFacts: Array<{ scope: string; runId: string; manifestId: string }>;
      sandboxRuntimeFacts: Record<string, unknown> | null } }) => Promise<T>;
}): Promise<T> {
  if (input.sandboxRelay === false) throw new Error("scheduler_fixture_requires_managed_sandbox");
  if (input.schedulerMode === "serial" && input.configureHeartbeat)
    throw new Error("scheduler_serial_fixture_requires_owned_host");
  if (input.observeModelOriginDenials && input.schedulerMode !== "serial")
    throw new Error("scheduler_origin_denials_require_serial_fixture");
  const verifiedModelRun = new AsyncLocalStorage<string>();
  const originHttpDenials = new Map<string, { directDenied: boolean; unownedConnectDenied: boolean; noAdditionalEffects: boolean }>();
  let authenticatedModelRouteDenials = 0;
  // This scope is entered only around the real Host model methods below, after
  // their provider attachment/JWT checks and before the gateway's own source
  // and admission checks.
  const authenticatedHostModelRequest = new AsyncLocalStorage<boolean>();
  input = { ...input, sandboxRelay: true,
    configureHeartbeat: input.configureHeartbeat ?? (async context => {
      const { configureManagedConversationSandboxHost, configureManagedSerialSchedulerSandboxHost } =
        await import("./managed-native-conversation-sandbox-host.js");
      if (input.schedulerMode === "serial") return configureManagedSerialSchedulerSandboxHost({ ...context, root: context.runHome,
        withVerifiedModelRun: (runId, work) => verifiedModelRun.run(runId, work) });
      return configureManagedConversationSandboxHost({ ...context, root: context.runHome, ordinaryWorker: true });
    }) };
  const { db } = input;
  try { await assertManagedFixtureOpenCodeImage(input.opencodeBinary); }
  catch (error) {
    if (error instanceof Error && error.message === "fixture_opencode_image_pin_changed")
      throw new Error("conversation_fixture_opencode_pin_mismatch");
    throw error;
  }
  const runHome = await mkdtemp(join(input.root, "conversation-run-"));
  await chmod(runHome, 0o700);
  await instanceSettingsService(db).getExperimental();
  await enableV5ForTest(db);
  await instanceSettingsService(db).updateExperimental({ enableAgentChat: true, enableNativeRunner: true,
    enableContextEngineV1: true, enableWorkflowsV1: true, readiness_engine_v7: true,
    enablePrivateAgentMemoryV1: true, orchestration_v7: true, role_packs_v5: false, skill_resolver_v5: false });
  const keyPath = join(runHome, "broker-key.pem"), certPath = join(runHome, "broker-cert.pem");
  const caKeyPath = join(runHome, "broker-ca-key.pem"), caCertPath = join(runHome, "broker-ca-cert.pem");
  const csrPath = join(runHome, "broker.csr"), extensionsPath = join(runHome, "broker-extensions.cnf");
  const brokerHostname = input.sandboxRelay ? "127-0-0-1.sslip.io" : "broker.localhost";
  // The relay policy keeps its public-DNS-shaped exact broker origin; the
  // normal fixture keeps its reserved test hostname.
  if (input.sandboxRelay) {
    const brokerAddresses = input.sandboxRelayDnsLookup
      ? await input.sandboxRelayDnsLookup(brokerHostname, { all: true })
      : await lookup(brokerHostname, { all: true });
    if (brokerAddresses.length === 0 || brokerAddresses.some(value => !["127.0.0.1", "::1"].includes(value.address)))
      throw new Error("conversation_fixture_broker_dns_not_loopback");
  }
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKeyPath,
    "-out", caCertPath, "-days", "1", "-subj", "/CN=Managed conversation fixture CA", "-addext",
    "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"], { stdio: "ignore" });
  execFileSync("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath,
    "-out", csrPath, "-subj", `/CN=${brokerHostname}`], { stdio: "ignore" });
  const { readFile } = await import("node:fs/promises");
  await writeFile(extensionsPath, `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${brokerHostname}\n`);
  execFileSync("openssl", ["x509", "-req", "-in", csrPath, "-CA", caCertPath, "-CAkey", caKeyPath,
    "-CAcreateserial", "-out", certPath, "-days", "1", "-sha256", "-extfile", extensionsPath], { stdio: "ignore" });
  await chmod(keyPath, 0o600);
  const certBundlePath = join(runHome, "broker-trust-bundle.pem");
  await writeFile(certBundlePath, Buffer.concat([await readFile("/etc/ssl/certs/ca-certificates.crt"),
    Buffer.from("\n"), await readFile(caCertPath)]), { mode: 0o600 });
  const f = await seedV5Presences(db);
  const userId = f.userId, companyId = f.home, agentId = f.presence.id;
  const budgetMonthlyCents = input.budgetMonthlyCents ?? 2000;
  if (!Number.isSafeInteger(budgetMonthlyCents) || budgetMonthlyCents < 1)
    throw new Error("conversation_fixture_budget_must_be_positive_integer");
  await db.update(companies).set({ budgetMonthlyCents }).where(eq(companies.id, companyId));
  await db.update(agents).set({ budgetMonthlyCents }).where(eq(agents.id, agentId));
  const human = await seedNativePasskeyActor(db, userId, [companyId]);
  const sessionId = human.sessionId;
  const model = "fixture-managed-conversation-v1";
  const baseAdapterConfig = { provider: "opencode", model: `anthropic/${model}`, lifecycleMode: "per_turn" };
  await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: baseAdapterConfig,
    runtimeConfig: { timeoutSec: input.timeoutSec ?? 180 }, status: "idle" })
    .where(eq(agents.id, agentId));
  await input.prepareNativeRuntimeContext?.({ db, actor: human, companyId, agentId });
  const [configuredAgent] = await db.select({ adapterConfig: agents.adapterConfig })
    .from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).limit(1);
  if (!configuredAgent || !configuredAgent.adapterConfig || typeof configuredAgent.adapterConfig !== "object" ||
    Array.isArray(configuredAgent.adapterConfig))
    throw new Error("conversation_fixture_adapter_configuration_missing");
  const adapterConfig = configuredAgent.adapterConfig as Record<string, unknown>;
  const providerService = agentProviderBindingService(db);
  const providerBinding = await providerService.create(human, companyId, agentId, {
    providerType: "paperclip_native", providerAgentRef: agentId, isolationMode: "isolated_per_presence", providerEndpointRef: null,
  });
  await providerService.attach(human, companyId, agentId, { providerBindingId: providerBinding.id, providerProfileRef: agentId });
  const snapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId,
    adapterType: "paperclip_runner", config: adapterConfig }));
  await providerService.recordDiscovery(companyId, agentId, snapshot,
    Object.fromEntries(providerConformanceRequirements(snapshot, providerBinding.isolationMode).map(check => [check, true])));
  const provider = await providerService.assertRuntime(companyId, agentId);
  const apiKey = `conversation-fixture-${randomUUID()}`;
  const issued = await aiConnectionService(db).save(companyId, userId, { provider: "anthropic", method: "api_key",
    ownership: "shared", name: "Conversation fixture provider", apiKey: "fixture", allAgents: false, agentIds: [agentId] }, apiKey);
  const profile: WorkerModelProfile = workerModelProfileSchema.parse({
    id: randomUUID(), companyId, workerAgentId: agentId, providerBindingId: provider.provider.id,
    providerSnapshotHash: provider.provider.capabilitySnapshotHash, providerProfileRef: provider.runtime.providerProfileRef,
    qualifiedConfigurationHash: hashContextPolicySnapshot({ adapterType: "paperclip_runner", adapterConfig }),
    binding: { provider: "anthropic", method: "api_key", mode: "shared", ...issued },
    transport: "server-anthropic-messages-v1", contract: "anthropic-messages-tools-2023-06-01",
    maximumEnvelopeBytes: 64000, inputTokensUpperBound: 100000, maxOutputTokens: 1024,
    tariff: input.tariff ?? { provider: "anthropic", model, currency: "USD", inputMinorPerMillion: 0,
      outputMinorPerMillion: 0, fixedMinor: 1, qualificationHash: "b".repeat(64), sourceSha,
      testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
    qualificationEvidenceRef: "https://protected.test.invalid/qualification/managed-conversation-fixture.json",
    qualificationArtifactSha256: "c".repeat(64),
  });
  const executionsByRun = new Map<string, { execution: NativeExecutionInput; issueId: string | null }>();
  let activeToken: string | null = null;
  let activeExecution: import("../../vendor/paperclip-runner/index.js").NativeExecutionInput | null = null;
  let activeRunId: string | null = null;
  let activeIssueId: string | null = null;
  let providerHookInvoked = false;
  let providerHookFailure: { name: string; message: string } | null = null;
  let providerStubFailure: { stage: string; code: string } | null = null;
  let providerToolNames: string[] = [];
  const brokerRequestFacts: Array<{ requestHash: string; status: number; code?: string; stage?: string;
    sqlState?: string; constraint?: string; errorName?: string; errorStatus?: number;
    errorCode?: string; serviceFrames?: string[] }> = [];
  const providerCalls: Array<{ body: Record<string, unknown>; keyMatches: boolean; runId: string }> = [];
  const reservationForRun = async (runId: string) => db.select({ reservation: orchestrationModelReservations })
    .from(orchestrationModelReservations).innerJoin(orchestrationWorkerAttempts,
      and(eq(orchestrationWorkerAttempts.companyId, orchestrationModelReservations.companyId),
        eq(orchestrationWorkerAttempts.id, orchestrationModelReservations.workerAttemptId)))
    .where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.runId, runId)))
    .orderBy(desc(orchestrationModelReservations.createdAt)).limit(1).then(rows => rows[0]?.reservation);
  const reservationIdsForRun = (runId: string) => db.select({ id: orchestrationModelReservations.id })
    .from(orchestrationModelReservations).innerJoin(orchestrationWorkerAttempts,
      and(eq(orchestrationWorkerAttempts.companyId, orchestrationModelReservations.companyId),
        eq(orchestrationWorkerAttempts.id, orchestrationModelReservations.workerAttemptId)))
    .where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.runId, runId)));
  const gateway = workerModelGateway(db, { profiles: [profile], sourceSha,
    protectedEvidenceOrigin: "https://protected.test.invalid", fetch: async (url, init) => {
      if (String(url) !== "https://api.anthropic.com/v1/messages") {
        providerStubFailure ??= { stage: "provider_url", code: "unexpected_provider_url" };
        throw new Error("conversation_fixture_provider_url_invalid");
      }
      const headers = new Headers(init.headers);
      const wireBody = String(init.body);
      const body = JSON.parse(wireBody) as Record<string, unknown>;
      const scopedRunId = verifiedModelRun.getStore();
      const runId = input.schedulerMode === "serial" ? scopedRunId : activeRunId;
      const scoped = runId ? executionsByRun.get(runId) : undefined;
      const execution = input.schedulerMode === "serial" ? scoped?.execution : activeExecution;
      const issueId = input.schedulerMode === "serial" ? scoped?.issueId : activeIssueId;
      if (!runId) throw new Error("scheduler_fixture_verified_model_run_missing");
      providerCalls.push({ body, keyMatches: headers.get("x-api-key") === apiKey, runId });
      const contract = execution?.completionContract.contract;
      if (!execution || !contract) {
        providerStubFailure ??= { stage: "execution_contract", code: "completion_contract_missing" };
        throw new Error("conversation_fixture_completion_contract_missing");
      }
      const tools = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
      providerToolNames = tools.map(tool => tool.name).filter((name): name is string =>
        typeof name === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(name));
      // A conversation turn completes with an ordinary assistant reply. The
      // Native executor binds that text to the real final agentMessage event
      // and yields to the next Human message; it does not need a Worker
      // paperclip_finish result.
      const usage = { input_tokens: 100, output_tokens: 32 };
      const reply=input.providerReply({body,callIndex: input.schedulerMode === "serial"
        ? providerCalls.filter(call => call.runId === runId).length : providerCalls.length,execution,runId,issueId:issueId ?? null})??{
        stop_reason:"end_turn",content:[{type:"text",text:"I’ve received your message and am ready to continue."}]};
      const responseBody = JSON.stringify({ id: `msg_conversation_${providerCalls.length}`, type: "message", role: "assistant", model,
        ...reply, usage });
      const response = new Response(responseBody,
      { status: 200, headers: { "content-type": "application/json" } });
      if (input.observeModelOriginDenials && runId && !originHttpDenials.has(runId)) {
        const before = { calls: providerCalls.length, injections: appliedModelProfileInjections.length,
          denied: authenticatedModelRouteDenials,
          reservations: await reservationIdsForRun(runId),
          tools: await db.select({ id: toolInvocations.id }).from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId), eq(toolInvocations.runId, runId))) };
        const directStatus = await probeUnownedModelHttp(false, body);
        const connectStatus = await probeUnownedModelHttp(true, body);
        const after = await reservationIdsForRun(runId);
        const toolsAfter = await db.select({ id: toolInvocations.id }).from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId), eq(toolInvocations.runId, runId)));
        const noEffects = providerCalls.length === before.calls && appliedModelProfileInjections.length === before.injections &&
          authenticatedModelRouteDenials === before.denied + 2 &&
          JSON.stringify(toolsAfter.map(row => row.id).sort()) === JSON.stringify(before.tools.map(row => row.id).sort()) &&
          JSON.stringify(after.map(row => row.id).sort()) === JSON.stringify(before.reservations.map(row => row.id).sort());
        if (directStatus < 400 || connectStatus < 400 || !noEffects)
          throw new Error("scheduler_actual_origin_negative_effect_or_authentication_mismatch");
        originHttpDenials.set(runId, { directDenied: true, unownedConnectDenied: true, noAdditionalEffects: true });
      }
      if (input.beforeProviderResponse && runId && issueId) {
        providerHookInvoked = true;
        const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).limit(1);
        const [manifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, runId)).limit(1);
        const reservation = await reservationForRun(runId);
        const [company] = await db.select({ budgetMonthlyCents: companies.budgetMonthlyCents }).from(companies).where(eq(companies.id, companyId)).limit(1);
        const [agent] = await db.select({ budgetMonthlyCents: agents.budgetMonthlyCents }).from(agents).where(eq(agents.id, agentId)).limit(1);
        if (!run || !manifest || !reservation || !company || !agent)
          throw new Error("conversation_fixture_live_provider_boundary_facts_missing");
        const profileValue = run.runnerProfileJson && typeof run.runnerProfileJson === "object"
          ? run.runnerProfileJson as Record<string, unknown> : {};
        const sourceReceipt = profileValue.nativeInputSourceReceipt ?? null;
        try { await input.beforeProviderResponse({ db, actor: human, companyId, agentId, issueId: issueId,
          run, manifest, reservation, sourceReceipt,
          request: { body, bodySha256: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
            wireBodySha256: createHash("sha256").update(wireBody).digest("hex"), byteLength: Buffer.byteLength(wireBody),
            reservationRequestHash: reservation.requestHash, reservationInputHash: reservation.inputHash,
            reservationAuthorityHash: reservation.authorityHash, idempotencyKey: reservation.idempotencyKey },
          providerResponseSha256: createHash("sha256").update(responseBody).digest("hex"),
          tariffSnapshot: reservation.conversationTariffSnapshot, quote: reservation.quote,
          budget: { companyMonthlyCents: company.budgetMonthlyCents, agentMonthlyCents: agent.budgetMonthlyCents },
          profileBinding: { id: profile.id, providerBindingId: profile.providerBindingId,
            providerSnapshotHash: profile.providerSnapshotHash, qualifiedConfigurationHash: profile.qualifiedConfigurationHash,
            model: profile.tariff.model },
          usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } }); }
        catch (error) {
          providerHookFailure = { name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message.slice(0, 400) : "non_error_throwable" };
          throw error;
        }
      }
      else if (input.beforeProviderResponse) providerStubFailure ??= {
        stage: "provider_callback_binding", code: "active_run_or_issue_missing",
      };
      return response;
    } });
  if (input.beforeManagedModelRequest) {
    const callManagedMessages = gateway.callManagedMessages.bind(gateway);
    gateway.callManagedMessages = async (claims, body, callerSignal, internal) => {
      callerSignal?.throwIfAborted();
      if (authenticatedHostModelRequest.getStore() === true) {
        const runId = claims.run_id;
        const execution = typeof runId === "string" ? executionsByRun.get(runId) : undefined;
        if (typeof runId !== "string" || !execution)
          throw new Error("scheduler_fixture_authenticated_model_run_unmapped");
        // The observer receives an immutable-by-ownership snapshot. The
        // original raw value and claim object continue to the real gateway.
        await input.beforeManagedModelRequest!({ body: structuredClone(body), runId, issueId: execution.issueId });
      }
      return callManagedMessages(claims, body, callerSignal, internal);
    };
  }
  const issuerFacts: Array<{ scope: string; runId: string; manifestId: string }> = [];
  const appliedModelProfileInjections: Array<{ runId: string; leaseId: string; sessionKey: string }> = [];
  let authenticatedModelTunnels = 0;
  // The origin is finalized before any proxy can connect; this closure keeps
  // the exact existing origin while exposing the actual association owner.
  let modelTunnelAssociations: ReturnType<typeof createManagedModelTunnelAssociations>;
  const brokerApp = express();
  brokerApp.use(express.json({ limit: "2mb" }));
  // Heartbeat delivers a run-scoped MCP URL to the actual runner. Give the
  // fixture that URL's real protocol endpoint instead of pointing it at a
  // dummy base URL or suppressing managed MCP delivery.
  const assignedToolGateway = createToolGatewayService(db, { remoteHttpRequest: input.assignedToolGatewayHttpRequest });
  if (input.afterSuccessfulAssignedToolResult) {
    const executeAssignedTool = assignedToolGateway.executeTool.bind(assignedToolGateway);
    assignedToolGateway.executeTool = async (call, workflowContext, scopedContext) => {
      // Capture the exact plain request before the asynchronous owner call. The
      // workflow and scoped contexts remain the original owner objects.
      const capturedCall = structuredClone(call);
      const replayCall = structuredClone(capturedCall);
      const result = await executeAssignedTool(call, workflowContext, scopedContext);
      const status = result && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>).status : null;
      if (status === "completed") await input.afterSuccessfulAssignedToolResult!({ call: capturedCall, result,
        replay: () => executeAssignedTool(structuredClone(replayCall), workflowContext, scopedContext) });
      return result;
    };
  }
  registerAssignedMcpGateway(db, assignedToolGateway);
  brokerApp.use(mcpGatewayProtocolRoutes(assignedToolGateway));
  const brokerRequestByObject = new WeakMap<object, (typeof brokerRequestFacts)[number]>();
  let sandboxHeartbeat: (Awaited<ReturnType<NonNullable<typeof input.configureHeartbeat>>> & {
    factsForRun?: (runId: string) => Record<string, unknown>;
    attestModelProxyClient?: (client: Socket) => Promise<ModelChannel | null>;
    modelRequestAuthenticated?: (body: unknown, signal: AbortSignal, authorization: string | undefined) =>
      ReturnType<ReturnType<typeof workerModelGateway>["callManagedMessages"]>;
  }) | undefined;
  brokerApp.use((req, res, next) => {
    if (req.method === "POST" && req.path === "/runtime-tools/model/v1/messages") {
      const requestHash = createHash("sha256").update(JSON.stringify(req.body ?? null)).digest("hex");
      const fact: (typeof brokerRequestFacts)[number] = { requestHash, status: 0 };
      brokerRequestByObject.set(req, fact);
      const sendJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        if (body && typeof body === "object" && !Array.isArray(body) &&
          typeof (body as Record<string, unknown>).code === "string")
          fact.code = (body as Record<string, unknown>).code as string;
        return sendJson(body as never);
      }) as typeof res.json;
      res.once("finish", () => { fact.status = res.statusCode; brokerRequestFacts.push(fact); });
    }
    next();
  });
  brokerApp.use(async (req, _res, next) => {
    if (input.schedulerMode !== "serial" || req.method !== "POST" || req.path !== "/runtime-tools/model/v1/messages") {
      next(); return;
    }
    try {
      const applied = await modelTunnelAssociations.authorization(req.socket, { method: req.method,
        path: req.path, url: req.originalUrl, host: req.headers.host, authorization: req.headers.authorization });
      if (!applied) { next(); return; }
      req.headers.authorization = applied.authorization;
      if (appliedModelProfileInjections.length >= 1024) throw new Error("serial_model_observation_limit");
      appliedModelProfileInjections.push({ runId: applied.runId, leaseId: applied.leaseId, sessionKey: applied.sessionKey });
      next();
    } catch { next(new Error("serial_model_channel_not_current")); }
  });
  brokerApp.use((req, res, next) => {
    if (!input.sandboxRelay || req.method !== "POST" || req.path !== "/runtime-tools/model/v1/messages") { next(); return; }
    if (!sandboxHeartbeat?.modelRequest) { next(new Error("conversation_fixture_host_model_request_unavailable")); return; }
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    req.once("aborted", cancel); res.once("close", cancel);
    if (input.schedulerMode === "serial" && (req.headers.origin || req.headers.cookie || req.headers["sec-fetch-site"])) {
      req.off("aborted", cancel); res.off("close", cancel);
      next(new Error("scheduler_fixture_model_runtime_authentication_required")); return;
    }
    const call = input.schedulerMode === "serial"
      ? sandboxHeartbeat.modelRequestAuthenticated?.(req.body, controller.signal, req.header("authorization"))
      : sandboxHeartbeat.modelRequest(req.body, controller.signal);
    if (!call) { req.off("aborted", cancel); res.off("close", cancel);
      next(new Error("scheduler_fixture_authenticated_model_route_missing")); return; }
    void call.then(result => {
      if (!res.writableEnded) res.status(200).set("Cache-Control", "no-store").set("X-Accel-Buffering", "no")
        .type("text/event-stream").send(result.sse);
    }).catch(error => {
      if (error instanceof Error && error.message === "scheduler_software_host_incoming_model_authority_invalid")
        authenticatedModelRouteDenials++;
      next(error);
    }).finally(() => { req.off("aborted", cancel); res.off("close", cancel); });
  });
  brokerApp.use((req, _res, next) => {
    if (!input.sandboxRelay && req.headers["x-api-key"] === "paperclip-managed-model-broker" && activeToken)
      req.headers.authorization = `Bearer ${activeToken}`;
    next();
  });
  brokerApp.use(runtimeConnectionIntentRoutes(db, gateway));
  brokerApp.use((error: unknown, req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const fact = brokerRequestByObject.get(req);
    const diagnostic = error && typeof error === "object" ? error as Error & {
      code?: unknown; status?: unknown; statusCode?: unknown; cause?: { code?: unknown };
    } : null;
    const safeIdentifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_:-]{1,96}$/.test(value) ? value : null;
    if (fact && diagnostic) {
      fact.errorName = safeIdentifier(diagnostic.name) ?? "UnknownError";
      fact.errorCode = safeIdentifier(diagnostic.code) ?? safeIdentifier(diagnostic.cause?.code) ?? undefined;
      const status = typeof diagnostic.status === "number" ? diagnostic.status
        : typeof diagnostic.statusCode === "number" ? diagnostic.statusCode : null;
      if (status !== null && status >= 400 && status <= 599) fact.errorStatus = status;
      fact.serviceFrames = diagnostic.stack?.split("\n").slice(1).flatMap(frame => {
        const match = /server\/src\/services\/([^\s():]+\.ts):(\d+):\d+/.exec(frame);
        return match ? [`${match[1]}:${match[2]}`] : [];
      }).slice(0, 6) ?? [];
    }
    const details = error && typeof error === "object" &&
      (error as Record<string, unknown>).details && typeof (error as Record<string, unknown>).details === "object"
      ? (error as Record<string, unknown>).details as Record<string, unknown> : null;
    if (fact && details) {
      if (typeof details.code === "string" && /^[a-z0-9_]{1,80}$/.test(details.code)) fact.code = details.code;
      if (typeof details.stage === "string" && /^[a-z0-9_]{1,80}$/.test(details.stage)) fact.stage = details.stage;
      if (typeof details.sqlState === "string" && /^[0-9A-Z]{5}$/.test(details.sqlState)) fact.sqlState = details.sqlState;
      if (typeof details.constraint === "string" && /^[A-Za-z0-9_]{1,96}$/.test(details.constraint)) fact.constraint = details.constraint;
    }
    next(error);
  });
  brokerApp.use(errorHandler);
  const broker = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, brokerApp);
  broker.on("secureConnection", socket => {
    if (!modelTunnelAssociations) { socket.destroy(); return; }
    modelTunnelAssociations.observeTls(socket);
  });
  broker.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => broker.once("listening", resolve));
  const address = broker.address();
  if (!address || typeof address === "string") throw new Error("conversation_fixture_broker_listen_failed");
  // Durable PRP and the runner accept only an origin, with no trailing path
  // separator; a slash would make the managed environment tuple invalid.
  const origin = new URL(`https://${brokerHostname}:${address.port}`).origin;
  modelTunnelAssociations = createManagedModelTunnelAssociations(origin);
  let brokerProxy: ReturnType<typeof createHttpServer> | null = null;
  let brokerProxyOrigin: string | null = null;
  const brokerProxySockets = new Set<Socket>();
  let brokerProxyTunnelCount = 0;
  let brokerProxyRejectedCount = 0;
  if (input.sandboxRelay) {
    brokerProxy = createHttpServer();
    brokerProxy.on("connection", socket => {
      brokerProxySockets.add(socket);
      socket.setTimeout(60_000, () => socket.destroy());
      socket.once("close", () => brokerProxySockets.delete(socket));
    });
    brokerProxy.on("request", (_request, response) => {
      brokerProxyRejectedCount++;
      response.writeHead(403, { connection: "close" }).end();
    });
    brokerProxy.on("connect", (request, client, head) => {
      if (request.url !== `${brokerHostname}:${address.port}`) {
        brokerProxyRejectedCount++;
        client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      brokerProxyTunnelCount++;
      void (async () => {
        const observed = input.schedulerMode === "serial" && client instanceof Socket && sandboxHeartbeat?.attestModelProxyClient
          ? await sandboxHeartbeat.attestModelProxyClient(client) : null;
        if (client.destroyed) { observed?.close(); return; }
        const upstream = createConnection(address.port, "127.0.0.1");
        brokerProxySockets.add(upstream);
        upstream.setTimeout(60_000, () => upstream.destroy());
        let entry: ManagedModelTunnel | null = null;
        const discard = () => { if (entry) modelTunnelAssociations.retire(entry); else { observed?.close(); client.destroy(); upstream.destroy(); } };
        upstream.once("close", () => { brokerProxySockets.delete(upstream); discard(); });
        upstream.once("connect", () => {
          if (observed && client instanceof Socket) {
            try { entry = modelTunnelAssociations.register(client, upstream, observed); authenticatedModelTunnels++; }
            catch { discard(); return; }
          }
          // Mapping is installed before the first TLS byte can be forwarded.
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length > 0) upstream.write(head);
          client.pipe(upstream); upstream.pipe(client);
        });
        upstream.once("error", discard); client.once("error", discard); client.once("close", discard);
      })().catch(() => client.destroy());
    });
    brokerProxy.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => brokerProxy!.once("listening", resolve));
    const proxyAddress = brokerProxy.address();
    if (!proxyAddress || typeof proxyAddress === "string") throw new Error("conversation_fixture_broker_proxy_listen_failed");
    brokerProxyOrigin = `http://127.0.0.1:${proxyAddress.port}`;
    const runProxyCurl = (args: string[], env: NodeJS.ProcessEnv) => new Promise<string>((resolve, reject) => {
      execFile("curl", args, { encoding: "utf8", timeout: 5_000, env }, (error, stdout) => {
        if (error) reject(error); else resolve(stdout.trim());
      });
    });
    try {
      const status = await runProxyCurl(["--max-time", "5", "--silent", "--show-error", "--output", "/dev/null",
        "--write-out", "%{http_code}", "--cacert", caCertPath,
        `${origin}/__proxy_preflight`], {
          ...process.env, HTTP_PROXY: "", http_proxy: "", HTTPS_PROXY: brokerProxyOrigin, https_proxy: brokerProxyOrigin,
          ALL_PROXY: "", all_proxy: "", NO_PROXY: "", no_proxy: "" });
      const wrongConnectStatus = await new Promise<number>((resolve, reject) => {
        const request = httpRequest({ host: "127.0.0.1", port: proxyAddress.port, method: "CONNECT",
          path: `untrusted.example:${address.port}`, timeout: 5_000 });
        request.once("response", response => { response.resume(); resolve(response.statusCode ?? 0); });
        request.once("connect", (response, socket) => { socket.destroy(); resolve(response.statusCode ?? 0); });
        request.once("timeout", () => request.destroy(new Error("broker_proxy_reject_timeout")));
        request.once("error", reject);
        request.end();
      });
      const plainHttpStatus = await runProxyCurl(["--max-time", "5", "--silent", "--show-error", "--output", "/dev/null",
        "--write-out", "%{http_code}", "--proxy", brokerProxyOrigin, "--noproxy", "", "http://localhost/"], {
          ...process.env, HTTP_PROXY: "", http_proxy: "", HTTPS_PROXY: "", https_proxy: "",
          ALL_PROXY: "", all_proxy: "", NO_PROXY: "", no_proxy: "" });
      if (status !== "404" || wrongConnectStatus !== 403 || plainHttpStatus !== "403" ||
        brokerProxyTunnelCount !== 1 || brokerProxyRejectedCount !== 2)
        throw new Error("unexpected_broker_proxy_preflight_result");
    } catch {
      for (const socket of brokerProxySockets) socket.destroy();
      if (brokerProxy.listening) await new Promise<void>(resolve => brokerProxy!.close(() => resolve()));
      if (broker.listening) await new Promise<void>(resolve => broker.close(() => resolve()));
      await makeConversationFixtureTreeWritable(runHome);
    await rm(runHome, { recursive: true, force: true });
      throw new Error("conversation_fixture_broker_proxy_preflight_failed");
    }
  }
  setupRunnerPrpWebSocketServer(broker, { apiUrl: origin });
  const prevBroker = process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN;
  const prevJwt = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  const prevCa = process.env.NODE_EXTRA_CA_CERTS;
  const prevRunnerPublicUrl = process.env.PAPERCLIP_RUNNER_PUBLIC_URL;
  const prevPaperclipApiUrl = process.env.PAPERCLIP_API_URL;
  process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN = origin;
  process.env.PAPERCLIP_API_URL = origin;
  process.env.PAPERCLIP_AGENT_JWT_SECRET = `conversation-fixture-${randomUUID()}`;
  async function probeUnownedModelHttp(tunnel: boolean, body: Record<string, unknown>): Promise<number> {
    const target = new URL(origin);
    const proxy = brokerProxyOrigin ? new URL(brokerProxyOrigin) : null;
    if (tunnel && !proxy) throw new Error("scheduler_negative_owned_proxy_missing");
    const raw = createConnection(Number(tunnel ? proxy!.port : target.port), "127.0.0.1");
    let tls: ReturnType<typeof connectTls> | null = null;
    const timeout = setTimeout(() => { raw.destroy(new Error("scheduler_negative_http_deadline")); tls?.destroy(); }, 5_000);
    raw.on("error", () => {});
    try {
      await new Promise<void>((resolve, reject) => { raw.once("connect", resolve); raw.once("error", reject); });
      if (tunnel) {
        const ready = new Promise<void>((resolve, reject) => {
          let header = "";
          const data = (chunk: Buffer) => {
            header += chunk.toString();
            if (header.length > 4096) { raw.off("data", data); reject(new Error("scheduler_negative_connect_response_limit")); }
            else if (header.includes("\r\n\r\n")) {
              raw.off("data", data);
              if (!header.startsWith("HTTP/1.1 200 ")) reject(new Error("scheduler_negative_connect_denied_before_model"));
              else resolve();
            }
          };
          raw.on("data", data); raw.once("error", reject);
        });
        raw.write(`CONNECT ${target.host} HTTP/1.1\r\nHost: ${target.host}\r\n\r\n`); await ready;
      }
      // No Authorization, API key, cookie or SDK credential is supplied. TLS
      // server identity is checked using the actual fixture CA and fixed DNS.
      tls = connectTls({ socket: raw, servername: target.hostname, ca: await readFile(certBundlePath) });
      const secure = tls;
      return await new Promise<number>((resolve, reject) => {
        let header = ""; let responded = false;
        secure.once("error", reject);
        secure.once("close", () => { if (!responded) reject(new Error("scheduler_negative_model_response_missing")); });
        secure.on("data", chunk => {
          if (responded) return;
          header += chunk.toString();
          if (header.length > 65536) { reject(new Error("scheduler_negative_model_response_limit")); secure.destroy(); }
          else if (header.includes("\r\n\r\n")) {
            const status = /^HTTP\/1\.[01] (\d{3}) /.exec(header);
            if (!status) reject(new Error("scheduler_negative_model_status_invalid"));
            else { responded = true; resolve(Number(status[1])); }
          }
        });
        secure.once("secureConnect", () => {
          const payload = JSON.stringify(body);
          secure.write(`POST /runtime-tools/model/v1/messages HTTP/1.1\r\nHost: ${target.host}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n${payload}`);
        });
      });
    } finally { clearTimeout(timeout); tls?.destroy(); raw.destroy(); }
  }
  process.env.NODE_EXTRA_CA_CERTS = certBundlePath;
  if (input.sandboxRelay) {
    const runnerPublicUrl = new URL(origin);
    runnerPublicUrl.protocol = "wss:";
    process.env.PAPERCLIP_RUNNER_PUBLIC_URL = runnerPublicUrl.origin;
  }
  sandboxHeartbeat = await input.configureHeartbeat?.({ db, actor: human, companyId, agentId,
    providerBindingId: provider.provider.id, gateway, profile, runHome, opencodeBinary: input.opencodeBinary,
    brokerOrigin: origin, brokerProxyOrigin, certBundlePath, assignedToolGatewayHttpRequest: input.assignedToolGatewayHttpRequest, observeModelOriginDenials: input.observeModelOriginDenials, setBrokerToken: token => { activeToken = token; } });
  if (input.beforeManagedModelRequest && sandboxHeartbeat) {
    const originalModelRequest = sandboxHeartbeat.modelRequest;
    if (!originalModelRequest) throw new Error("scheduler_fixture_model_observer_host_method_missing");
    const modelRequest = originalModelRequest.bind(sandboxHeartbeat);
    sandboxHeartbeat.modelRequest = (body, signal) =>
      authenticatedHostModelRequest.run(true, () => modelRequest(body, signal));
    if (sandboxHeartbeat.modelRequestAuthenticated) {
      const modelRequestAuthenticated = sandboxHeartbeat.modelRequestAuthenticated.bind(sandboxHeartbeat);
      sandboxHeartbeat.modelRequestAuthenticated = (body, signal, authorization) =>
        authenticatedHostModelRequest.run(true, () => modelRequestAuthenticated(body, signal, authorization));
    }
  }
  registerNativeDraftGateway(db, gateway);
  const heartbeat = heartbeatService(db, { sandboxExec: sandboxHeartbeat?.sandboxExec,
    environmentRuntime: sandboxHeartbeat?.environmentRuntime,
    testNativeRunnerEnvironment: async ({ execution, runId, issueId,
    agentId: currentAgentId, responsibleUserId, bootstrapSourceClosure }) => {
    if (execution.provider.kind !== "opencode" || !responsibleUserId)
      throw new Error("conversation_fixture_provider_or_human_missing");
    const existing = executionsByRun.get(runId);
    if (input.schedulerMode === "serial" && existing &&
        (existing.issueId !== issueId || nativeSha256(existing.execution) !== nativeSha256(execution)))
      throw new Error("scheduler_fixture_execution_changed_for_run");
    executionsByRun.set(runId, { execution: structuredClone(execution), issueId });
    if (input.schedulerMode !== "serial") {
      activeExecution = execution;
      activeRunId = runId;
      activeIssueId = issueId;
    }
    const hostEnvironment = sandboxHeartbeat?.beforeNativeExecution
      ? await sandboxHeartbeat.beforeNativeExecution({ execution, runId, issueId, agentId: currentAgentId,
          responsibleUserId, bootstrapSourceClosure })
      : {};
    const minted = await gateway.issueForRun({ companyId, agentId: currentAgentId, runId, responsibleUserId });
    const claims = verifyRuntimeToolsToken(minted.token, "worker_model");
    if (!claims?.worker_model || claims.scope !== "worker_model") throw new Error("scheduler_fixture_issuer_scope_missing");
    issuerFacts.push({ scope: claims.scope, runId: claims.run_id,
      manifestId: claims.worker_model.executionManifestId });
    return { PATH: `${dirname(input.opencodeBinary)}:${process.env.PATH ?? ""}`,
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      // Preserve the qualified sandbox host's proxy and CA bindings while
      // adding only the model profile minted for this exact Native run.
      ...hostEnvironment,
      PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: origin,
      PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND: String(minted.inputTokensUpperBound),
      PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS: String(minted.maxOutputTokens),
      // The relay's exact public-DNS-shaped broker origin is tunneled through
      // a loopback-only test proxy because this environment blocks direct
      // loopback egress. The proxy accepts only that exact broker host+port.
      NO_PROXY: input.sandboxRelay ? "localhost,127.0.0.1,::1" : new URL(origin).hostname,
      no_proxy: input.sandboxRelay ? "localhost,127.0.0.1,::1" : new URL(origin).hostname,
      HTTP_PROXY: "", http_proxy: "", HTTPS_PROXY: brokerProxyOrigin ?? "", https_proxy: brokerProxyOrigin ?? "",
      ALL_PROXY: "", all_proxy: "",
      NODE_EXTRA_CA_CERTS: certBundlePath, SSL_CERT_FILE: certBundlePath };
  } });
  try {
    return await input.driveScheduler({ db, actor: human, companyId, agentId, gateway, heartbeat,
      facts: () => ({ providerCallCount: providerCalls.length, issuerFacts: structuredClone(issuerFacts),
        sandboxRuntimeFacts: input.schedulerMode === "serial" ? { ...sandboxHeartbeat?.facts?.(),
          originHttpDenials: Object.fromEntries(originHttpDenials), authenticatedModelTunnels, appliedModelProfileInjections: structuredClone(appliedModelProfileInjections) }
          : sandboxHeartbeat?.facts?.() ?? null }),
      factsForRun: runId => {
        if (!executionsByRun.has(runId)) throw new Error("scheduler_fixture_run_not_observed");
        return { providerCallCount: providerCalls.filter(call => call.runId === runId).length,
          issuerFacts: structuredClone(issuerFacts.filter(fact => fact.runId === runId)),
          sandboxRuntimeFacts: input.schedulerMode === "serial" ? { ...sandboxHeartbeat?.factsForRun?.(runId),
            originHttpDenials: originHttpDenials.get(runId) ?? null,
            appliedModelProfileInjections: structuredClone(appliedModelProfileInjections.filter(entry => entry.runId === runId)) }
            : runId === activeRunId ? sandboxHeartbeat?.facts?.() ?? null : null };
      } });
  } finally {
    await heartbeat.drainActiveRunExecutions();
    // Failure diagnostics read existing server events only. The pinned OpenCode
    // session.error schema has eight name literals and APIError.data.statusCode;
    // it declares no code field. Never print messages, bodies, paths or IDs.
    try {
      const failedRuns = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId),
          eq(heartbeatRuns.status, "failed"))).orderBy(desc(heartbeatRuns.createdAt)).limit(8);
      const knownNames = new Set(["ProviderAuthError", "UnknownError", "MessageOutputLengthError",
        "MessageAbortedError", "StructuredOutputError", "ContextOverflowError", "ContentFilterError", "APIError"]);
      const record = (value: unknown): Record<string, unknown> =>
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? value as Record<string, unknown> : {};
      for (const [index, failedRun] of failedRuns.entries()) {
        const events = await db.select({ payload: heartbeatRunEvents.payload }).from(heartbeatRunEvents)
          .where(and(eq(heartbeatRunEvents.companyId, companyId), eq(heartbeatRunEvents.agentId, agentId),
            eq(heartbeatRunEvents.runId, failedRun.id), eq(heartbeatRunEvents.eventType, "turn.failed")))
          .orderBy(desc(heartbeatRunEvents.seq)).limit(4);
        console.info("managed_scheduler_failed_turn_projection", JSON.stringify({
          failedRunOrdinal: index + 1, failedRunStatus: "failed",
          executionObserved: executionsByRun.has(failedRun.id),
          providerCallCount: providerCalls.filter(call => call.runId === failedRun.id).length,
          modelIssuanceCount: issuerFacts.filter(fact => fact.runId === failedRun.id).length,
          fixtureTotalAuthenticatedModelTunnels: authenticatedModelTunnels,
          turnFailures: events.map(event => {
            const payload = record(event.payload), error = record(payload.error), data = record(error.data);
            return {
              status: payload.status === "failed" ? "failed" : "unrecognized",
              name: typeof error.name === "string" && knownNames.has(error.name) ? error.name : "unrecognized",
              code: null,
              codeFieldPresent: Object.hasOwn(error, "code") || Object.hasOwn(data, "code"),
              httpStatus: error.name === "APIError" && typeof data.statusCode === "number" &&
                Number.isInteger(data.statusCode) && data.statusCode >= 100 && data.statusCode <= 599
                ? data.statusCode : null,
            };
          }),
        }));
      }
    } catch {
      // Diagnostics must never replace the original assertion/runtime failure.
    }
    registerNativeDraftGateway(db, undefined);
    await sandboxHeartbeat?.close?.();
    modelTunnelAssociations.retireAll();
    for (const socket of brokerProxySockets) socket.destroy();
    if (brokerProxy?.listening) await new Promise<void>(resolve => brokerProxy!.close(() => resolve()));
    runnerPrpWebSocketInternals.resetForTests();
    await new Promise<void>(resolve => broker.close(() => resolve()));
    if (prevBroker === undefined) delete process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN;
    else process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN = prevBroker;
    if (prevJwt === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET; else process.env.PAPERCLIP_AGENT_JWT_SECRET = prevJwt;
    if (prevCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS; else process.env.NODE_EXTRA_CA_CERTS = prevCa;
    if (prevRunnerPublicUrl === undefined) delete process.env.PAPERCLIP_RUNNER_PUBLIC_URL; else process.env.PAPERCLIP_RUNNER_PUBLIC_URL = prevRunnerPublicUrl;
    if (prevPaperclipApiUrl === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = prevPaperclipApiUrl;
    await makeConversationFixtureTreeWritable(runHome);
    await rm(runHome, { recursive: true, force: true });
  }
}
