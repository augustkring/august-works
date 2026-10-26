import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer as createHttpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import express from "express";
import { eq } from "drizzle-orm";
import { agents, agentExecutionManifests, companies, heartbeatRuns, issues,
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
import { verifyRuntimeToolsToken } from "../../runtime-tools-token.js";
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
 * The local HTTPS proxy supplies the token returned by the original issuer because
 * this focused fixture does not include a V7 runtime host; it proves the genuine
 * conversation frame/ledger path, not RuntimeControl host-token injection. */
export async function runManagedNativeConversationFrame(input: {
  db: ReturnType<typeof createDb>;
  root: string;
  opencodeBinary: string;
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
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath,
    "-out", certPath, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  await chmod(keyPath, 0o600);
  const f = await seedV5Presences(db);
  const userId = f.userId, companyId = f.home, agentId = f.presence.id;
  await db.update(companies).set({ budgetMonthlyCents: 2000 }).where(eq(companies.id, companyId));
  await db.update(agents).set({ budgetMonthlyCents: 2000 }).where(eq(agents.id, agentId));
  const sessionId = await seedNativePasskeySession(db, userId);
  const human = { ...f.actor, sessionId };
  const model = "fixture-managed-conversation-v1";
  const adapterConfig = { provider: "opencode", model: `anthropic/${model}`, lifecycleMode: "per_turn" };
  await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig, runtimeConfig: {}, status: "idle" })
    .where(eq(agents.id, agentId));
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
    tariff: { provider: "anthropic", model, currency: "USD", inputMinorPerMillion: 0,
      outputMinorPerMillion: 0, fixedMinor: 1, qualificationHash: "b".repeat(64), sourceSha,
      testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
    qualificationEvidenceRef: "https://protected.test.invalid/qualification/managed-conversation-fixture.json",
    qualificationArtifactSha256: "c".repeat(64),
  });
  let activeToken: string | null = null;
  let activeExecution: import("../../vendor/paperclip-runner/index.js").NativeExecutionInput | null = null;
  let activeRunId: string | null = null;
  let activeIssueId: string | null = null;
  const providerCalls: Array<{ body: Record<string, unknown>; keyMatches: boolean }> = [];
  const gateway = workerModelGateway(db, { profiles: [profile], sourceSha,
    protectedEvidenceOrigin: "https://protected.test.invalid", fetch: async (url, init) => {
      if (String(url) !== "https://api.anthropic.com/v1/messages") throw new Error("conversation_fixture_provider_url_invalid");
      const headers = new Headers(init.headers);
      const wireBody = String(init.body);
      const body = JSON.parse(wireBody) as Record<string, unknown>;
      providerCalls.push({ body, keyMatches: headers.get("x-api-key") === apiKey });
      const execution = activeExecution;
      const contract = execution?.completionContract.contract;
      if (!execution || !contract) throw new Error("conversation_fixture_completion_contract_missing");
      const tools = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
      const finish = tools.find(tool => tool.name === "paperclip_finish");
      if (!finish || typeof finish.name !== "string") throw new Error("conversation_fixture_finish_tool_missing");
      const result = { schema: "paperclip.run_result.v1", reportedWorkDisposition: "done", summary: "Conversation Native turn completed.",
        completionClaim: { contractRevision: String(contract.revision), objectiveSatisfied: true,
          criteria: contract.criteria.map(criterion => ({ criterionId: criterion.id, status: "satisfied", evidenceRefs: [] })), remainingWork: [] },
        evidence: [], verification: [], attentionRequests: [], artifacts: [] };
      const usage = { input_tokens: 100, output_tokens: 32 };
      const responseBody = JSON.stringify({ id: `msg_conversation_${providerCalls.length}`, type: "message", role: "assistant", model,
        stop_reason: "tool_use", content: [{ type: "tool_use", id: `conversation-finish-${providerCalls.length}`,
          name: finish.name, input: result }], usage });
      const response = new Response(responseBody,
      { status: 200, headers: { "content-type": "application/json" } });
      if (input.beforeProviderResponse && activeRunId && activeIssueId) {
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
        await input.beforeProviderResponse({ db, actor: human, companyId, agentId, issueId: activeIssueId,
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
          usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } });
      }
      return response;
    } });
  const issuerFacts: Array<{ scope: string | null; runId: string; issueId: string; generation: number; manifestId: string; manifestHash: string }> = [];
  const brokerApp = express();
  brokerApp.use(express.json({ limit: "2mb" }));
  brokerApp.use((req, _res, next) => {
    if (req.headers["x-api-key"] === "paperclip-managed-model-broker" && activeToken)
      req.headers.authorization = `Bearer ${activeToken}`;
    next();
  });
  brokerApp.use(runtimeConnectionIntentRoutes(db, gateway));
  brokerApp.use(errorHandler);
  const broker = createHttpsServer({ key: await import("node:fs/promises").then(fs => fs.readFile(keyPath)),
    cert: await import("node:fs/promises").then(fs => fs.readFile(certPath)) }, brokerApp);
  broker.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => broker.once("listening", resolve));
  const address = broker.address();
  if (!address || typeof address === "string") throw new Error("conversation_fixture_broker_listen_failed");
  const origin = `https://127.0.0.1:${address.port}/`;
  const prevBroker = process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN;
  const prevJwt = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  const prevCa = process.env.NODE_EXTRA_CA_CERTS;
  process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN = origin;
  process.env.PAPERCLIP_AGENT_JWT_SECRET = `conversation-fixture-${randomUUID()}`;
  process.env.NODE_EXTRA_CA_CERTS = certPath;
  const heartbeat = heartbeatService(db, { testNativeRunnerEnvironment: async ({ execution, runId, issueId,
    agentId: currentAgentId, responsibleUserId }) => {
    if (execution.provider.kind !== "opencode" || !responsibleUserId)
      throw new Error("conversation_fixture_provider_or_human_missing");
    activeExecution = execution;
    activeRunId = runId;
    activeIssueId = issueId;
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
      NODE_EXTRA_CA_CERTS: certPath, SSL_CERT_FILE: certPath };
  } });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.actor = human; next(); });
  app.use("/api", issueRoutes(db, {} as never, { heartbeat }));
  app.use(errorHandler);
  try {
    const chat = await import("supertest").then(({ default: request }) => request(app)
      .post(`/api/companies/${companyId}/chats/${agentId}`));
    if (chat.status !== 200 || typeof chat.body.id !== "string") throw new Error(`conversation_fixture_chat_open_failed_${chat.status}`);
    const sent = await import("supertest").then(({ default: request }) => request(app)
      .post(`/api/issues/${chat.body.id}/comments`).send({ body: "Please respond briefly and complete this conversation turn.", clientRequestId: randomUUID() }));
    if (sent.status !== 201) throw new Error(`conversation_fixture_first_comment_failed_${sent.status}`);
    const deadline = Date.now() + 180_000;
    let run: typeof heartbeatRuns.$inferSelect | null = null;
    while (Date.now() < deadline) {
      const [candidate] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.nativeIssueId, chat.body.id)).limit(1);
      if (candidate && ["succeeded", "failed", "timed_out"].includes(candidate.status)) { run = candidate; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await heartbeat.drainActiveRunExecutions();
    const [finalRun] = run ? [run] : await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.nativeIssueId, chat.body.id)).limit(1);
    const [manifest] = finalRun ? await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, finalRun.id)).limit(1) : [];
    const [reservation] = finalRun ? await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.conversationRunId, finalRun.id)).limit(1) : [];
    const [plan] = finalRun ? await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.issueId, chat.body.id)).limit(1) : [];
    const attempts = finalRun ? await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.runId, finalRun.id)) : [];
    const profileValue = finalRun?.runnerProfileJson && typeof finalRun.runnerProfileJson === "object"
      ? finalRun.runnerProfileJson as Record<string, unknown> : {};
    return { issueId: chat.body.id as string, firstCommentId: sent.body.id as string, run: finalRun ?? null,
      manifest: manifest ?? null, reservation: reservation ?? null, workerPlan: plan ?? null,
      workerAttempts: attempts, providerCallCount: providerCalls.length,
      providerKeyMatched: providerCalls.length > 0 && providerCalls.every(call => call.keyMatches),
      issuerFacts, nativeInputSourceReceipt: profileValue.nativeInputSourceReceipt ?? null,
      runStatus: finalRun?.status ?? "not_started", success: finalRun?.status === "succeeded" };
  } finally {
    await heartbeat.drainActiveRunExecutions().catch(() => undefined);
    await new Promise<void>(resolve => broker.close(() => resolve()));
    if (prevBroker === undefined) delete process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN; else process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN = prevBroker;
    if (prevJwt === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET; else process.env.PAPERCLIP_AGENT_JWT_SECRET = prevJwt;
    if (prevCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS; else process.env.NODE_EXTRA_CA_CERTS = prevCa;
    await makeConversationFixtureTreeWritable(runHome);
    await rm(runHome, { recursive: true, force: true });
  }
}
