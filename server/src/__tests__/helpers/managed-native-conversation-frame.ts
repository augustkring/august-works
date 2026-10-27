import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer as createHttpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import express from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { agents, agentExecutionManifests, authSessions, authUsers, companies, companyMemberships,
  heartbeatRuns, issueComments, issueThreadInteractions, issues,
  orchestrationModelReservations, orchestrationPlans, orchestrationWorkerAttempts, createDb } from "@paperclipai/db";
import { workerModelProfileSchema, type WorkerModelProfile } from "../../services/orchestration/worker-model-profiles.js";
import { workerModelGateway } from "../../services/orchestration/worker-model-gateway.js";
import { aiConnectionService } from "../../services/ai-connections.js";
import { agentProviderBindingService } from "../../services/agent-provider-bindings.js";
import { discoverNativeCapabilities } from "../../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../../services/provider-capabilities.js";
import { hashContextPolicySnapshot } from "../../services/context/context-manifest.js";
import { enableV5ForTest, seedV5Presences } from "./v5-fixtures.js";
import { seedNativePasskeySession } from "./native-authentication-fixtures.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { heartbeatService } from "../../services/heartbeat.js";
import { issueRoutes } from "../../routes/issues.js";
import { runtimeConnectionIntentRoutes } from "../../routes/connection-intents.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { actorMiddleware } from "../../middleware/auth.js";
import type { BetterAuthSessionResult } from "../../auth/better-auth.js";
import { verifyRuntimeToolsToken } from "../../runtime-tools-token.js";
import { setupRunnerPrpWebSocketServer, runnerPrpWebSocketInternals } from "../../realtime/runner-prp-ws.js";
import type { AuthorizationActor } from "../../services/authorization.js";

const OPENCODE_SHA256 = "513f500a1a5ea1dc7d865547ac87b32a8936334e8d5abd5b3ff585c45a170080";
const sourceSha = "a".repeat(40);

export async function makeConversationFixtureTreeWritable(path: string): Promise<void> {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata || metadata.isSymbolicLink()) return;
  await chmod(path, metadata.isDirectory() ? 0o700 : 0o600);
  if (metadata.isDirectory()) for (const name of await readdir(path)) await makeConversationFixtureTreeWritable(join(path, name));
}

/** Actual route→heartbeat→Native executor→pinned OpenCode→conversation broker proof.
 * The default focused mode supplies the original issuer token through a local
 * HTTPS proxy. With sandboxRelay enabled, the configured V7 software host runs
 * the actual signed RuntimeControl relay and uses that same PRP endpoint. */
export async function runManagedNativeConversationFrame(input: {
  db: ReturnType<typeof createDb>;
  root: string;
  opencodeBinary: string;
  /** Use a policy-valid DNS name that resolves to loopback for the signed host relay case. */
  sandboxRelay?: boolean;
  /** Bounded run timeout for relay roundtrips; defaults to the normal 180s fixture limit. */
  timeoutSec?: number;
  conversationWorkMode?: "standard" | "planning" | "ask";
  budgetMonthlyCents?: number;
  tariff?: WorkerModelProfile["tariff"];
  providerReply?: (facts:{body:Record<string,unknown>;callIndex:number}) => {
    stop_reason:"tool_use"|"end_turn";content:Array<Record<string,unknown>>;
  } | undefined;
  /** Test-only canonical source setup before the Agent profile is qualified or chat opens. */
  prepareNativeRuntimeContext?: (context: {
    db: ReturnType<typeof createDb>;
    actor: AuthorizationActor;
    companyId: string;
    agentId: string;
  }) => Promise<void>;
  configureHeartbeat?: (context: {
    db: ReturnType<typeof createDb>;
    actor: AuthorizationActor;
    companyId: string;
    agentId: string;
    providerBindingId: string;
    gateway: ReturnType<typeof workerModelGateway>;
    profile: WorkerModelProfile;
    runHome: string;
    opencodeBinary: string;
    brokerOrigin: string;
    certBundlePath: string;
    setBrokerToken: (token: string) => void;
  }) => Promise<{
    sandboxExec?: NonNullable<Parameters<typeof heartbeatService>[1]>["sandboxExec"];
    environmentRuntime?: NonNullable<Parameters<typeof heartbeatService>[1]>["environmentRuntime"];
    beforeNativeExecution?: (args: Parameters<NonNullable<NonNullable<Parameters<typeof heartbeatService>[1]>["testNativeRunnerEnvironment"]>>[0]) => Promise<Record<string, string>>;
    close?: () => Promise<void>;
    facts?: () => Record<string, unknown>;
  }>;
  beforeProviderResponse?: (facts: {
    db: ReturnType<typeof createDb>;
    actor: AuthorizationActor;
    companyId: string;
    agentId: string;
    issueId: string;
    run: typeof heartbeatRuns.$inferSelect;
    manifest: typeof agentExecutionManifests.$inferSelect;
    reservation: typeof orchestrationModelReservations.$inferSelect;
    sourceReceipt: unknown;
    request: { body: Record<string, unknown>; bodySha256: string; wireBodySha256: string; byteLength: number;
      reservationRequestHash: string; reservationInputHash: string; reservationAuthorityHash: string; idempotencyKey: string };
    providerResponseSha256: string;
    tariffSnapshot: unknown;
    quote: unknown;
    budget: { companyMonthlyCents: number; agentMonthlyCents: number };
    profileBinding: { id: string; providerBindingId: string; providerSnapshotHash: string; qualifiedConfigurationHash: string; model: string };
    usage: { inputTokens: number; outputTokens: number };
  }) => Promise<void>;
  afterRunSettledBeforeTeardown?: (facts: {
    db: ReturnType<typeof createDb>;
    actor: AuthorizationActor;
    companyId: string;
    agentId: string;
    issueId: string;
    run: typeof heartbeatRuns.$inferSelect | null;
    manifest: typeof agentExecutionManifests.$inferSelect | null;
    reservation: typeof orchestrationModelReservations.$inferSelect | null;
    nativeInputSourceReceipt: unknown;
    sandboxRuntimeFacts: Record<string, unknown> | null;
    providerCallCount: number;
    providerHookInvoked: boolean;
    providerStubFailure: { stage: string; code: string } | null;
  }) => Promise<void>;
}) {
  const { db } = input;
  const opencodeBytes = await import("node:fs/promises").then(fs => fs.readFile(input.opencodeBinary));
  if (createHash("sha256").update(opencodeBytes).digest("hex") !== OPENCODE_SHA256)
    throw new Error("conversation_fixture_opencode_pin_mismatch");
  const runHome = await mkdtemp(join(input.root, "conversation-run-"));
  await chmod(runHome, 0o700);
  await instanceSettingsService(db).getExperimental();
  await enableV5ForTest(db);
  await instanceSettingsService(db).updateExperimental({ enableAgentChat: true, enableNativeRunner: true,
    enableContextEngineV1: true, enableWorkflowsV1: true, readiness_engine_v7: true,
    enablePrivateAgentMemoryV1: true, orchestration_v7: true });
  const keyPath = join(runHome, "broker-key.pem"), certPath = join(runHome, "broker-cert.pem");
  const caKeyPath = join(runHome, "broker-ca-key.pem"), caCertPath = join(runHome, "broker-ca-cert.pem");
  const csrPath = join(runHome, "broker.csr"), extensionsPath = join(runHome, "broker-extensions.cnf");
  const brokerHostname = input.sandboxRelay ? "127-0-0-1.sslip.io" : "broker.localhost";
  // The signed sandbox policy requires a public-DNS-shaped hostname. Only that
  // explicit relay case uses sslip; ordinary local broker fixtures retain the
  // original reserved localhost name and its local routing semantics.
  if (input.sandboxRelay) {
    const brokerAddresses = await lookup(brokerHostname, { all: true });
    if (brokerAddresses.length === 0 || brokerAddresses.some(value => value.address !== "127.0.0.1"))
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
  const sessionId = await seedNativePasskeySession(db, userId);
  const human = { type: "board", source: "session", userId, companyIds: [companyId],
    sessionId, isInstanceAdmin: false } satisfies AuthorizationActor & Express.Request["actor"];
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
  const providerCalls: Array<{ body: Record<string, unknown>; keyMatches: boolean }> = [];
  const gateway = workerModelGateway(db, { profiles: [profile], sourceSha,
    protectedEvidenceOrigin: "https://protected.test.invalid", fetch: async (url, init) => {
      if (String(url) !== "https://api.anthropic.com/v1/messages") {
        providerStubFailure ??= { stage: "provider_url", code: "unexpected_provider_url" };
        throw new Error("conversation_fixture_provider_url_invalid");
      }
      const headers = new Headers(init.headers);
      const wireBody = String(init.body);
      const body = JSON.parse(wireBody) as Record<string, unknown>;
      providerCalls.push({ body, keyMatches: headers.get("x-api-key") === apiKey });
      const execution = activeExecution;
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
      const reply=input.providerReply?.({body,callIndex:providerCalls.length})??{
        stop_reason:"end_turn",content:[{type:"text",text:"I’ve received your message and am ready to continue."}]};
      const responseBody = JSON.stringify({ id: `msg_conversation_${providerCalls.length}`, type: "message", role: "assistant", model,
        ...reply, usage });
      const response = new Response(responseBody,
      { status: 200, headers: { "content-type": "application/json" } });
      if (input.beforeProviderResponse && activeRunId && activeIssueId) {
        providerHookInvoked = true;
        const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, activeRunId)).limit(1);
        const [manifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, activeRunId)).limit(1);
        const [reservation] = await db.select().from(orchestrationModelReservations)
          .where(eq(orchestrationModelReservations.conversationRunId, activeRunId)).limit(1);
        const [company] = await db.select({ budgetMonthlyCents: companies.budgetMonthlyCents }).from(companies).where(eq(companies.id, companyId)).limit(1);
        const [agent] = await db.select({ budgetMonthlyCents: agents.budgetMonthlyCents }).from(agents).where(eq(agents.id, agentId)).limit(1);
        if (!run || !manifest || !reservation || !company || !agent)
          throw new Error("conversation_fixture_live_provider_boundary_facts_missing");
        const profileValue = run.runnerProfileJson && typeof run.runnerProfileJson === "object"
          ? run.runnerProfileJson as Record<string, unknown> : {};
        const sourceReceipt = profileValue.nativeInputSourceReceipt ?? null;
        try { await input.beforeProviderResponse({ db, actor: human, companyId, agentId, issueId: activeIssueId,
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
  const issuerFacts: Array<{ scope: string | null; runId: string; issueId: string; generation: number; manifestId: string; manifestHash: string }> = [];
  const brokerApp = express();
  brokerApp.use(express.json({ limit: "2mb" }));
  const brokerRequestByObject = new WeakMap<object, (typeof brokerRequestFacts)[number]>();
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
  brokerApp.use((req, _res, next) => {
    if (req.headers["x-api-key"] === "paperclip-managed-model-broker" && activeToken)
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
  broker.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => broker.once("listening", resolve));
  const address = broker.address();
  if (!address || typeof address === "string") throw new Error("conversation_fixture_broker_listen_failed");
  // The public wildcard DNS record resolves to the loopback HTTPS listener.
  // Durable PRP and the runner accept only an origin, with no trailing path
  // separator; a slash would make the managed environment tuple invalid.
  const origin = new URL(`https://${brokerHostname}:${address.port}`).origin;
  setupRunnerPrpWebSocketServer(broker, { apiUrl: origin });
  const prevBroker = process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN;
  const prevJwt = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  const prevCa = process.env.NODE_EXTRA_CA_CERTS;
  const prevRunnerPublicUrl = process.env.PAPERCLIP_RUNNER_PUBLIC_URL;
  process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN = origin;
  process.env.PAPERCLIP_AGENT_JWT_SECRET = `conversation-fixture-${randomUUID()}`;
  process.env.NODE_EXTRA_CA_CERTS = certBundlePath;
  if (input.sandboxRelay) {
    const runnerPublicUrl = new URL(origin);
    runnerPublicUrl.protocol = "wss:";
    process.env.PAPERCLIP_RUNNER_PUBLIC_URL = runnerPublicUrl.origin;
  }
  const sandboxHeartbeat = await input.configureHeartbeat?.({ db, actor: human, companyId, agentId,
    providerBindingId: provider.provider.id, gateway, profile, runHome, opencodeBinary: input.opencodeBinary,
    brokerOrigin: origin, certBundlePath, setBrokerToken: token => { activeToken = token; } });
  const heartbeat = heartbeatService(db, { sandboxExec: sandboxHeartbeat?.sandboxExec,
    environmentRuntime: sandboxHeartbeat?.environmentRuntime,
    testNativeRunnerEnvironment: async ({ execution, runId, issueId,
    agentId: currentAgentId, responsibleUserId }) => {
    if (execution.provider.kind !== "opencode" || !responsibleUserId)
      throw new Error("conversation_fixture_provider_or_human_missing");
    activeExecution = execution;
    activeRunId = runId;
    activeIssueId = issueId;
    if (sandboxHeartbeat?.beforeNativeExecution)
      return await sandboxHeartbeat.beforeNativeExecution({ execution, runId, issueId, agentId: currentAgentId,
        responsibleUserId });
    let minted: Awaited<ReturnType<typeof gateway.issueForConversationRun>>;
    try { minted = await gateway.issueForConversationRun({ companyId, agentId: currentAgentId, runId, responsibleUserId }); }
    catch (error) {
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).limit(1);
      const [issue] = run?.nativeIssueId ? await db.select({ id: issues.id, conversationAgentId: issues.conversationAgentId,
        conversationUserId: issues.conversationUserId, conversationState: issues.conversationState,
        conversationSessionGeneration: issues.conversationSessionGeneration, executionRunId: issues.executionRunId,
        status: issues.status, assigneeAgentId: issues.assigneeAgentId }).from(issues).where(eq(issues.id, run.nativeIssueId)).limit(1) : [];
      const [manifest] = await db.select({ id: agentExecutionManifests.id, hash: agentExecutionManifests.hash,
        responsibleUserId: agentExecutionManifests.manifest }).from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, runId)).limit(1);
      const manifestUserId = manifest?.responsibleUserId && typeof manifest.responsibleUserId === "object"
        ? (manifest.responsibleUserId as Record<string, unknown>).responsibleUserId : null;
      throw new Error(`conversation_fixture_issuer_failed_${JSON.stringify({ message: error instanceof Error ? error.message : String(error),
        run: run ? { id: run.id, status: run.status, runtimeMode: run.runtimeMode, scopeKind: run.scopeKind,
          nativeIssueId: run.nativeIssueId, responsibleUserId: run.responsibleUserId } : null,
        issue, manifest: manifest ? { id: manifest.id, hash: manifest.hash, responsibleUserId: manifestUserId } : null })}`);
    }
    const claims = verifyRuntimeToolsToken(minted.token, "conversation_model");
    if (!claims?.conversation_model) throw new Error("conversation_fixture_issuer_scope_missing");
    activeToken = minted.token;
    issuerFacts.push({ scope: claims.scope, runId: claims.run_id, issueId: claims.conversation_model.issueId,
      generation: claims.conversation_model.conversationSessionGeneration,
      manifestId: claims.conversation_model.executionManifestId, manifestHash: claims.conversation_model.executionManifestHash });
    return { PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: origin,
      PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND: String(minted.inputTokensUpperBound),
      PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS: String(minted.maxOutputTokens),
      PATH: `${dirname(input.opencodeBinary)}:${process.env.PATH ?? ""}`,
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      NODE_EXTRA_CA_CERTS: certBundlePath, SSL_CERT_FILE: certBundlePath };
  } });
  const [humanSession] = await db.select({ id: authSessions.id, userId: authSessions.userId,
    token: authSessions.token, expiresAt: authSessions.expiresAt }).from(authSessions)
    .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId))).limit(1);
  if (!humanSession || humanSession.expiresAt.getTime() <= Date.now())
    throw new Error("conversation_fixture_human_session_unavailable");
  const foreignUserId = `conversation-foreign-${randomUUID()}`;
  const now = new Date();
  await db.insert(authUsers).values({ id: foreignUserId, name: "Foreign conversation Human",
    email: `${foreignUserId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
  // A valid colleague with company access still cannot inherit this
  // person's conversation through its Task or route identity.
  await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:foreignUserId,
    membershipRole:"admin",status:"active"});
  const foreignSessionId = await seedNativePasskeySession(db, foreignUserId);
  const [foreignSession] = await db.select({ token: authSessions.token, expiresAt: authSessions.expiresAt })
    .from(authSessions).where(eq(authSessions.id, foreignSessionId)).limit(1);
  if (!foreignSession || foreignSession.expiresAt.getTime() <= Date.now())
    throw new Error("conversation_fixture_foreign_session_unavailable");
  const humanCookie = `session_token=${encodeURIComponent(humanSession.token)}`;
  const foreignCookie = `session_token=${encodeURIComponent(foreignSession.token)}`;
  const app = express();
  app.use(express.json());
  app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async req => {
    const token = (req.header("cookie") ?? "").split(";").map(value => value.trim())
      .map(value => value.slice(value.indexOf("=") + 1)).map(decodeURIComponent)
      .find(Boolean);
    if (!token) return null;
    const [session] = await db.select({ id: authSessions.id, userId: authSessions.userId,
      expiresAt: authSessions.expiresAt }).from(authSessions)
      .where(and(eq(authSessions.token, token), sql`${authSessions.expiresAt} > now()`)).limit(1);
    if (!session) return null;
    const [user] = await db.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
      .from(authUsers).where(eq(authUsers.id, session.userId)).limit(1);
    if (!user) return null;
    const result: BetterAuthSessionResult = {
      session: { id: session.id, userId: session.userId, expiresAt: session.expiresAt }, user,
    };
    return result;
  } }));
  app.use("/api", issueRoutes(db, {} as never, { heartbeat }));
  app.use(errorHandler);
  try {
    const chat = await import("supertest").then(({ default: request }) => request(app)
      .post(`/api/companies/${companyId}/chats/${agentId}`).set("cookie", humanCookie));
    if (chat.status !== 200 || typeof chat.body.id !== "string") throw new Error(`conversation_fixture_chat_open_failed_${chat.status}`);
    if (input.conversationWorkMode) {
      const mode = await import("supertest").then(({ default: request }) => request(app)
        .patch(`/api/issues/${chat.body.id}`).set("cookie", humanCookie)
        .send({ workMode: input.conversationWorkMode }));
      if (mode.status !== 200) {
        const error = typeof mode.body?.error === "string" && /^[A-Za-z ]{1,80}$/.test(mode.body.error)
          ? mode.body.error.toLowerCase().replaceAll(" ", "_") : "unclassified";
        throw new Error(`conversation_fixture_work_mode_update_failed_${mode.status}_${error}`);
      }
    }
    const sent = await import("supertest").then(({ default: request }) => request(app)
      .post(`/api/issues/${chat.body.id}/comments`).set("cookie", humanCookie)
      .send({ body: "Please respond briefly and complete this conversation turn.", clientRequestId: randomUUID() }));
    if (sent.status !== 201) throw new Error(`conversation_fixture_first_comment_failed_${sent.status}`);
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const [candidate] = await db.select().from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId),
        sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${chat.body.id}`,
        sql`${heartbeatRuns.contextSnapshot}->>'wakeCommentId' = ${sent.body.id}`,
      )).orderBy(desc(heartbeatRuns.startedAt)).limit(1);
      if (candidate && ["succeeded", "failed", "timed_out", "cancelled", "superseded"].includes(candidate.status)) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await heartbeat.drainActiveRunExecutions();
    const [finalRun] = await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId),
      sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${chat.body.id}`,
      sql`${heartbeatRuns.contextSnapshot}->>'wakeCommentId' = ${sent.body.id}`,
    )).orderBy(desc(heartbeatRuns.startedAt)).limit(1);
    const [manifest] = finalRun ? await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, finalRun.id)).limit(1) : [];
    const [reservation] = finalRun ? await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.conversationRunId, finalRun.id)).limit(1) : [];
    const [plan] = finalRun ? await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.issueId, chat.body.id)).limit(1) : [];
    const attempts = finalRun ? await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.runId, finalRun.id)) : [];
    const profileValue = finalRun?.runnerProfileJson && typeof finalRun.runnerProfileJson === "object"
      ? finalRun.runnerProfileJson as Record<string, unknown> : {};
    const comments = await db.select().from(issueComments).where(eq(issueComments.issueId, chat.body.id as string));
    const reviewInteractionCount = await db.select({ id: issueThreadInteractions.id }).from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.issueId, chat.body.id as string));
    const agentReply = comments.find(comment => comment.authorAgentId === agentId && comment.createdByRunId === finalRun?.id) ?? null;
    const [conversationIssue] = await db.select({ status: issues.status, conversationState: issues.conversationState,
      executionRunId: issues.executionRunId }).from(issues).where(eq(issues.id, chat.body.id as string)).limit(1);
    const countBeforeForeignWrite = comments.length;
    const foreignWrite = await import("supertest").then(({ default: request }) => request(app)
      .post(`/api/issues/${chat.body.id}/comments`).set("cookie", foreignCookie)
      .send({ body: "This foreign session must not write to the conversation.", clientRequestId: randomUUID() }));
    const commentsAfterForeignWrite = await db.select().from(issueComments).where(eq(issueComments.issueId, chat.body.id as string));
    const sandboxRuntimeFacts = sandboxHeartbeat?.facts?.() ?? null;
    const nativeInputSourceReceipt = profileValue.nativeInputSourceReceipt ?? null;
    if (finalRun && ["succeeded", "failed", "timed_out", "cancelled", "superseded"].includes(finalRun.status))
      await input.afterRunSettledBeforeTeardown?.({ db, actor: human, companyId, agentId,
        issueId: chat.body.id as string, run: finalRun, manifest: manifest ?? null, reservation: reservation ?? null,
        nativeInputSourceReceipt, sandboxRuntimeFacts, providerCallCount: providerCalls.length,
        providerHookInvoked, providerStubFailure });
    return { issueId: chat.body.id as string, firstCommentId: sent.body.id as string, run: finalRun ?? null,
      manifest: manifest ?? null, reservation: reservation ?? null, workerPlan: plan ?? null,
      workerAttempts: attempts, providerCallCount: providerCalls.length,
      providerHookInvoked, providerHookFailure, providerStubFailure, providerToolNames, brokerRequestFacts,
      providerKeyMatched: providerCalls.length > 0 && providerCalls.every(call => call.keyMatches),
      issuerFacts, nativeInputSourceReceipt,
      agentReply, conversationCommentCount: comments.length, reviewInteractionCount: reviewInteractionCount.length,
      conversationIssue: conversationIssue ?? null, foreignWriteStatus: foreignWrite.status,
      foreignWriteDidNotMutate: commentsAfterForeignWrite.length === countBeforeForeignWrite,
      sandboxRuntimeFacts,
      runStatus: finalRun?.status ?? "not_started", success: finalRun?.status === "succeeded" };
  } finally {
    await heartbeat.drainActiveRunExecutions().catch(() => undefined);
    await sandboxHeartbeat?.close?.().catch(() => undefined);
    runnerPrpWebSocketInternals.resetForTests();
    await new Promise<void>(resolve => broker.close(() => resolve()));
    if (prevBroker === undefined) delete process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN; else process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN = prevBroker;
    if (prevJwt === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET; else process.env.PAPERCLIP_AGENT_JWT_SECRET = prevJwt;
    if (prevCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS; else process.env.NODE_EXTRA_CA_CERTS = prevCa;
    if (prevRunnerPublicUrl === undefined) delete process.env.PAPERCLIP_RUNNER_PUBLIC_URL; else process.env.PAPERCLIP_RUNNER_PUBLIC_URL = prevRunnerPublicUrl;
    await makeConversationFixtureTreeWritable(runHome);
    await rm(runHome, { recursive: true, force: true });
  }
}
