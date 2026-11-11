import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createConnection, type Socket } from "node:net";
import { createServer as createHttpsServer } from "node:https";
import { execFile, execFileSync } from "node:child_process";
import express, { type Express as ExpressApp, type Request as ExpressRequest } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { agents, agentExecutionManifests, authSessions, authUsers, companies, companyMemberships,
  heartbeatRuns, issueComments, issueThreadInteractions, issues, nativeRunFinalizations, workspaceOperations,
  orchestrationModelReservations, orchestrationPlans, orchestrationWorkerAttempts, createDb } from "@paperclipai/db";
import { workerModelProfileSchema, type WorkerModelProfile } from "../../services/orchestration/worker-model-profiles.js";
import { workerModelGateway } from "../../services/orchestration/worker-model-gateway.js";
import { aiConnectionService } from "../../services/ai-connections.js";
import { agentProviderBindingService } from "../../services/agent-provider-bindings.js";
import { agentIdentityService } from "../../services/agent-identities.js";
import { discoverNativeCapabilities } from "../../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../../services/provider-capabilities.js";
import { hashContextPolicySnapshot } from "../../services/context/context-manifest.js";
import { enableV5ForTest, seedV5Presences } from "./v5-fixtures.js";
import { seedNativePasskeyActor, seedNativePasskeySession } from "./native-authentication-fixtures.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { heartbeatService } from "../../services/heartbeat.js";
import { environmentRuntimeService } from "../../services/environment-runtime.js";
import { issueRoutes } from "../../routes/issues.js";
import { getStorageService } from "../../storage/index.js";
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

const OPENCODE_SHA256 = "513f500a1a5ea1dc7d865547ac87b32a8936334e8d5abd5b3ff585c45a170080";
const sourceSha = "a".repeat(40);

function frameWorkspaceFinalizeFailureFacets(value: unknown) {
  const firstLine = typeof value === "string" ? value.slice(0, 4096).split(/\r?\n/, 1)[0]! : "";
  const exactCodes = ["runner_remote_checkpoint_failed", "runner_remote_checkpoint_snapshot_failed",
    "workspace_sync_out_unrecoverable",
    "WORKSPACE_RESTORE_UNSAFE_ARCHIVE", "ERR_WORKSPACE_RESTORE_LOCK_TIMEOUT"] as const;
  const ownerCode = exactCodes.find(code => firstLine === code) ??
    (firstLine.startsWith("runner_remote_checkpoint_incomplete: exact suspended harness state unavailable (") ? "runner_remote_checkpoint_incomplete" :
      firstLine.startsWith("Remote file read was truncated for ") ? "remote_file_truncated" :
      firstLine.startsWith("Could not determine remote file size for ") ? "remote_file_size_unknown" :
      firstLine.startsWith("Project repository escaped its workspace") ? "project_workspace_escape" :
      firstLine.startsWith("Timed out waiting for workspace restore lock at ") ? "restore_lock_timeout" :
      firstLine.startsWith("Daytona syncOut refusing ") ? "restore_archive_refused" : "other");
  const errno = /^(?:Error: )?(EACCES|EPERM|ENOENT|ENOSPC|EIO|ETIMEDOUT)(?=[:\s]|$)/.exec(firstLine)?.[1] ?? null;
  const rawExit = / failed with exit code (-?\d+|null)(?=[:\s]|$)/.exec(firstLine)?.[1];
  const exitNumber = rawExit !== undefined && rawExit !== "null" ? Number(rawExit) : null;
  const exitCode = exitNumber !== null && Number.isSafeInteger(exitNumber) && exitNumber >= -255 && exitNumber <= 255 ? exitNumber : null;
  return { messagePresent: typeof value === "string" && value.length > 0, ownerCode, errno, exitCode,
    timeout: ownerCode === "restore_lock_timeout" || errno === "ETIMEDOUT" };
}

export async function makeConversationFixtureTreeWritable(path: string): Promise<void> {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata || metadata.isSymbolicLink()) return;
  await chmod(path, metadata.isDirectory() ? 0o700 : 0o600);
  if (metadata.isDirectory()) for (const name of await readdir(path)) await makeConversationFixtureTreeWritable(join(path, name));
}

/** Actual route→heartbeat→Native executor→pinned OpenCode→conversation broker proof.
 * Paid positive fixtures use the actual signed RuntimeControl Sandbox relay
 * and its current attached provider credential. Explicit local mode remains
 * available only for unsupported-transport denial checks. */
export async function runManagedNativeConversationFrame(input: {
  db: ReturnType<typeof createDb>;
  /** Independent read-only observer pool; never used for runtime operations. */
  diagnosticDb?: ReturnType<typeof createDb>;
  root: string;
  opencodeBinary: string;
  /** Constructor-only controlled HTTP transport; no tool or admission authority. */
  /** Fixed observation-only model-origin negative controls; serial integration only. */
  observeModelOriginDenials?: true;
  assignedToolGatewayHttpRequest?: NonNullable<Parameters<typeof createToolGatewayService>[1]>["remoteHttpRequest"];
  /** Use a policy-valid DNS name that resolves to loopback for the signed host relay case. */
  sandboxRelay?: boolean;
  sandboxRelayDnsLookup?: (hostname: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>>;
  /** Bounded run timeout for relay roundtrips; defaults to the normal 180s fixture limit. */
  timeoutSec?: number;
  conversationWorkMode?: "standard" | "planning" | "ask";
  conversationPrompt?: string;
  /** Optional canonical serialized provider-request bound for replay-heavy scenarios. */
  providerRequestBodyLimitBytes?: number;
  firstCommentAttachment?: { filename: string; contentType: string; bytes: Buffer };
  budgetMonthlyCents?: number;
  tariff?: WorkerModelProfile["tariff"];
  /** Create independently authorized Native Agent presences in the same Company and qualify a separate provider profile for each. */
  managedAgentNames?: string[];
  managedPrimaryAgentName?: string;
  providerReply?: (facts:{body:Record<string,unknown>;callIndex:number;issueId:string;runId:string;
    completionContract:import("../../vendor/paperclip-runner/index.js").NativeExecutionInput["completionContract"]["contract"]}) => {
    stop_reason:"tool_use"|"end_turn";content:Array<Record<string,unknown>>;
  } | undefined | Promise<{ stop_reason:"tool_use"|"end_turn";content:Array<Record<string,unknown>> } | undefined>;
  /** Test-only full app composition for browser drivers; the returned app must use the supplied heartbeat and session resolver. */
  createConversationApp?: (context: {
    db: ReturnType<typeof createDb>;
    heartbeat: ReturnType<typeof heartbeatService>;
    resolveSession: (req: ExpressRequest) => Promise<BetterAuthSessionResult | null>;
    resolveSessionFromHeaders: (headers: Headers) => Promise<BetterAuthSessionResult | null>;
  }) => Promise<{ app: ExpressApp; origin: string; close?: () => Promise<void> }>;
  /** Optional browser driver; absent preserves the existing mini-app/Supertest route flow. */
  driveConversation?: (context: {
    app: ExpressApp;
    origin: string;
    humanCookie: string;
    companyId: string;
    agentId: string;
    managedAgents?: Array<{ id: string; name: string }>;
    chatPath: string;
    conversationRoute: string;
    prompt: string;
    onConversationOpened: (issueId: string) => void;
  }) => Promise<{ issueId: string; wakeCommentId: string }>;
  /** Test-only canonical source setup before the Agent profile is qualified or chat opens. */
  prepareNativeRuntimeContext?: (context: {
    db: ReturnType<typeof createDb>;
    actor: AuthorizationActor;
    companyId: string;
    agentId: string;
  }) => Promise<void>;
  configureHeartbeat?: (context: {
    db: ReturnType<typeof createDb>;
    diagnosticDb?: ReturnType<typeof createDb>;
    actor: AuthorizationActor;
    companyId: string;
    agentId: string;
    providerBindingId: string;
    gateway: ReturnType<typeof workerModelGateway>;
    profile: WorkerModelProfile;
    managedAgentProfiles?: Array<{ agentId: string; providerBindingId: string; profile: WorkerModelProfile }>;
    runHome: string;
    opencodeBinary: string;
    observeModelOriginDenials?: true;
    assignedToolGatewayHttpRequest?: NonNullable<Parameters<typeof createToolGatewayService>[1]>["remoteHttpRequest"];
    brokerOrigin: string;
    brokerProxyOrigin: string | null;
    certBundlePath: string;
    setBrokerToken: (token: string) => void;
  }) => Promise<{
    sandboxExec?: NonNullable<Parameters<typeof heartbeatService>[1]>["sandboxExec"];
    environmentRuntime?: NonNullable<Parameters<typeof heartbeatService>[1]>["environmentRuntime"];
    beforeNativeRuntimeSelection?: NonNullable<Parameters<typeof heartbeatService>[1]>["beforeNativeRuntimeSelection"];
    beforeNativeExecution?: (args: Parameters<NonNullable<NonNullable<Parameters<typeof heartbeatService>[1]>["testNativeRunnerEnvironment"]>>[0]) => Promise<Record<string, string>>;
    close?: () => Promise<void>;
    facts?: () => Record<string, unknown>;
    modelRequest?: (body: unknown, signal: AbortSignal) => ReturnType<ReturnType<typeof workerModelGateway>["callManagedMessages"]>;
    modelRequestAuthenticated?: (body: unknown, signal: AbortSignal, authorization: string | undefined) =>
      ReturnType<ReturnType<typeof workerModelGateway>["callManagedMessages"]>;
  }>;
  /** Test-only mutation window at broker ingress, before Gateway request validation. */
  beforeManagedConversationModelRequest?: (context: { db: ReturnType<typeof createDb>; requestNumber: number }) => Promise<void>;
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
    guestCompanyId: string;
    identityId: string;
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
    providerWireBodyBytes: number[];
  }) => Promise<void>;
}) {
  input = { ...input, sandboxRelay: input.sandboxRelay ?? true,
    configureHeartbeat: input.configureHeartbeat ?? (async context => {
      const { configureManagedConversationSandboxHost, configureManagedSerialSchedulerSandboxHost } =
        await import("./managed-native-conversation-sandbox-host.js");
      const profiles = context.managedAgentProfiles ?? [{ agentId: context.agentId,
        providerBindingId: context.providerBindingId, profile: context.profile }];
      if (profiles.length === 1)
        return configureManagedConversationSandboxHost({ ...context, root: context.runHome });
      type ManagedHost = Awaited<ReturnType<typeof configureManagedSerialSchedulerSandboxHost>>;
      const hosts = new Map<string, ManagedHost>();
      const closed = new Set<string>();
      let lastRun: { runId: string; agentId: string } | null = null;
      const profileFor = (id: string) => profiles.find(profile => profile.agentId === id);
      const hostForAgent = async (id: string) => {
        if (closed.has(id)) throw new Error("conversation_multi_agent_host_reuse_not_supported");
        const existing = hosts.get(id);
        if (existing) return existing;
        const profile = profileFor(id);
        if (!profile) throw new Error("conversation_multi_agent_profile_missing");
        const hostRoot = join(context.runHome, `managed-agent-${id}`);
        await mkdir(hostRoot, { mode: 0o700 }); await chmod(hostRoot, 0o700);
        const host = await configureManagedSerialSchedulerSandboxHost({ ...context, agentId: id,
          providerBindingId: profile.providerBindingId, profile: profile.profile, root: hostRoot });
        hosts.set(id, host);
        return host;
      };
      const hostForRun = async (runId: string) => {
        const [run] = await db.select({ agentId: heartbeatRuns.agentId, status: heartbeatRuns.status })
          .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId))).limit(1);
        if (!run) throw new Error("conversation_multi_agent_run_missing");
        return { ...run, host: await hostForAgent(run.agentId) };
      };
      const closeRun = async (runId: string) => {
        const { agentId: runAgentId, status, host } = await hostForRun(runId);
        if (!["succeeded", "failed", "timed_out", "cancelled", "superseded"].includes(status))
          throw new Error("conversation_multi_agent_host_close_requires_terminal_run");
        if (!closed.has(runAgentId)) { await host.close?.(); closed.add(runAgentId); }
      };
      const waitForTerminalRun = async (runId: string) => {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const [run] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
            .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId))).limit(1);
          if (!run) throw new Error("conversation_multi_agent_prior_run_missing");
          if (["succeeded", "failed", "timed_out", "cancelled", "superseded"].includes(run.status)) return;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error("conversation_multi_agent_prior_run_terminal_timeout");
      };
      let hostTransition = Promise.resolve();
      const beforeNativeExecution = (args: Parameters<NonNullable<NonNullable<Parameters<typeof heartbeatService>[1]>["testNativeRunnerEnvironment"]>>[0]) => {
        const operation = hostTransition.then(async () => {
          if (lastRun && lastRun.agentId !== args.agentId) {
            await waitForTerminalRun(lastRun.runId);
            await closeRun(lastRun.runId);
          }
          if (closed.has(args.agentId)) throw new Error("conversation_multi_agent_host_already_retired");
          const host = await hostForAgent(args.agentId);
          if (!host.beforeNativeExecution) throw new Error("conversation_multi_agent_native_execution_owner_missing");
          lastRun = { agentId: args.agentId, runId: args.runId };
          return host.beforeNativeExecution(args);
        });
        hostTransition = operation.then(() => undefined, () => undefined);
        return operation;
      };
      const router = {
        sandboxExec: async (command: Parameters<NonNullable<ManagedHost["sandboxExec"]>>[0]) => {
          if (!command.runId) throw new Error("conversation_multi_agent_sandbox_run_missing");
          const { host } = await hostForRun(command.runId);
          if (!host.sandboxExec) throw new Error("conversation_multi_agent_sandbox_host_missing");
          return host.sandboxExec(command);
        },
        environmentRuntime: environmentRuntimeService(db, {
          executeSandboxTask: async command => {
            if (!command.runId) throw new Error("conversation_multi_agent_sandbox_run_missing");
            const { host } = await hostForRun(command.runId);
            if (!host.executeManagedSandboxTask) throw new Error("conversation_multi_agent_sandbox_owner_missing");
            return host.executeManagedSandboxTask(command);
          },
          stopSandboxRunLease: async scope => {
            const { host } = await hostForRun(scope.runId);
            if (!host.stopManagedSandboxRunLease) throw new Error("conversation_multi_agent_stop_owner_missing");
            return host.stopManagedSandboxRunLease(scope);
          },
        }),
        beforeNativeExecution,
        modelRequest: async () => { throw new Error("conversation_multi_agent_model_authority_required"); },
        modelRequestAuthenticated: async (body: unknown, signal: AbortSignal, authorization: string | undefined) => {
          const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
          const claims = token ? (verifyRuntimeToolsToken(token, "conversation_model") ??
            verifyRuntimeToolsToken(token, "worker_model")) : null;
          if ((!claims?.conversation_model && !claims?.worker_model) || claims.company_id !== companyId)
            throw new Error("conversation_multi_agent_model_claim_invalid");
          const owner = await hostForRun(claims.run_id);
          if (owner.agentId !== claims.sub) throw new Error("conversation_multi_agent_model_run_owner_mismatch");
          const host = owner.host;
          if (!host.modelRequestAuthenticated) throw new Error("conversation_multi_agent_model_owner_missing");
          return host.modelRequestAuthenticated(body, signal, authorization);
        },
        attestModelProxyClient: async (client: Socket) => {
          const admitted: Array<{ close: () => void }> = [];
          for (const [id, host] of hosts) {
            if (closed.has(id) || !host.attestModelProxyClient) continue;
            const result = await host.attestModelProxyClient(client);
            if (result) admitted.push(result);
          }
          if (admitted.length !== 1) { for (const result of admitted) result.close(); return null; }
          return admitted[0]!;
        },
        facts: () => ({ mode: "conversation_multi_agent_serial_signed_hosts",
          agents: [...hosts].map(([id, host]) => ({ agentId: id, closed: closed.has(id), facts: host.facts?.() ?? null })) }),
        close: async () => {
          for (const [id, host] of hosts) {
            if (closed.has(id)) continue;
            if (lastRun?.agentId === id) await closeRun(lastRun.runId);
            else throw new Error("conversation_multi_agent_host_retirement_witness_missing");
          }
        },
      };
      return router as unknown as Awaited<ReturnType<NonNullable<typeof input.configureHeartbeat>>>;
    }) };
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
  if (input.managedPrimaryAgentName)
    await db.update(agents).set({ name: input.managedPrimaryAgentName }).where(eq(agents.id, agentId));
  const budgetMonthlyCents = input.budgetMonthlyCents ?? 2000;
  if (!Number.isSafeInteger(budgetMonthlyCents) || budgetMonthlyCents < 1)
    throw new Error("conversation_fixture_budget_must_be_positive_integer");
  await db.update(companies).set({ budgetMonthlyCents }).where(eq(companies.id, companyId));
  await db.update(agents).set({ budgetMonthlyCents }).where(eq(agents.id, agentId));
  const human = await seedNativePasskeyActor(db, userId, [companyId]);
  const additionalAgentIds: string[] = [];
  for (const name of input.managedAgentNames ?? []) {
    if (!name || name.length > 80 || additionalAgentIds.length >= 8)
      throw new Error("conversation_fixture_managed_agent_names_invalid");
    const created = await agentIdentityService(db).create(human, { name, homeCompanyId: companyId });
    additionalAgentIds.push(created.presence.id);
  }
  const managedAgentIds = [agentId, ...additionalAgentIds];
  const sessionId = human.sessionId;
  const model = "fixture-managed-conversation-v1";
  const baseAdapterConfig = { provider: "opencode", model: `anthropic/${model}`, lifecycleMode: "per_turn" };
  const providerService = agentProviderBindingService(db);
  const profilesByAgent = new Map<string, WorkerModelProfile>();
  const providerBindingsByAgent = new Map<string, string>();
  const apiKeysByAgent = new Map<string, string>();
  for (const configuredAgentId of managedAgentIds) {
    await db.update(agents).set({ budgetMonthlyCents, adapterType: "paperclip_runner", adapterConfig: baseAdapterConfig,
      runtimeConfig: { timeoutSec: input.timeoutSec ?? 180 }, status: "idle" }).where(eq(agents.id, configuredAgentId));
    await input.prepareNativeRuntimeContext?.({ db, actor: human, companyId, agentId: configuredAgentId });
    const [configuredAgent] = await db.select({ adapterConfig: agents.adapterConfig }).from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, configuredAgentId))).limit(1);
    if (!configuredAgent || !configuredAgent.adapterConfig || typeof configuredAgent.adapterConfig !== "object" ||
        Array.isArray(configuredAgent.adapterConfig)) throw new Error("conversation_fixture_adapter_configuration_missing");
    const adapterConfig = configuredAgent.adapterConfig as Record<string, unknown>;
    const providerBinding = await providerService.create(human, companyId, configuredAgentId, {
      providerType: "paperclip_native", providerAgentRef: configuredAgentId,
      isolationMode: "isolated_per_presence", providerEndpointRef: null,
    });
    await providerService.attach(human, companyId, configuredAgentId,
      { providerBindingId: providerBinding.id, providerProfileRef: configuredAgentId });
    const snapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId,
      adapterType: "paperclip_runner", config: adapterConfig }));
    await providerService.recordDiscovery(companyId, configuredAgentId, snapshot,
      Object.fromEntries(providerConformanceRequirements(snapshot, providerBinding.isolationMode).map(check => [check, true])));
    const provider = await providerService.assertRuntime(companyId, configuredAgentId);
    const apiKey = `conversation-fixture-${randomUUID()}`;
    apiKeysByAgent.set(configuredAgentId, apiKey);
    const issued = await aiConnectionService(db).save(companyId, userId, { provider: "anthropic", method: "api_key",
      ownership: "shared", name: "Conversation fixture provider", apiKey: "fixture", allAgents: false,
      agentIds: [configuredAgentId] }, apiKey);
    const profile: WorkerModelProfile = workerModelProfileSchema.parse({
      id: randomUUID(), companyId, workerAgentId: configuredAgentId, providerBindingId: provider.provider.id,
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
    profilesByAgent.set(configuredAgentId, profile);
    providerBindingsByAgent.set(configuredAgentId, providerBinding.id);
  }
  const profile = profilesByAgent.get(agentId)!;
  const providerBindingId = providerBindingsByAgent.get(agentId)!;
  let activeToken: string | null = null;
  type ProviderRunContext = {
    completionContract: import("../../vendor/paperclip-runner/index.js").NativeExecutionInput["completionContract"]["contract"];
    runId: string;
    issueId: string;
    agentId: string;
    claims: Readonly<NonNullable<ReturnType<typeof verifyRuntimeToolsToken>>>;
  };
  const providerRunContexts = new Map<string, ProviderRunContext>();
  const authenticatedProviderContext = new AsyncLocalStorage<ProviderRunContext>();
  const providerWireBodyBytes: number[] = [];
  let providerHookInvoked = false;
  let providerHookFailure: { name: string; message: string } | null = null;
  let providerStubFailure: { stage: string; code: string } | null = null;
  let providerToolNames: string[] = [];
  const brokerRequestFacts: Array<{ requestHash: string; status: number; code?: string; stage?: string;
    sqlState?: string; constraint?: string; errorName?: string; errorStatus?: number;
    errorCode?: string; serviceFrames?: string[] }> = [];
  const providerCalls: Array<{ body: Record<string, unknown>; keyMatches: boolean }> = [];
  let managedConversationModelRequestCount = 0;
  const providerCallsByIssue = new Map<string, number>();
  const gateway = workerModelGateway(db, { profiles: [...profilesByAgent.values()], sourceSha,
    protectedEvidenceOrigin: "https://protected.test.invalid", fetch: async (url, init) => {
      if (String(url) !== "https://api.anthropic.com/v1/messages") {
        providerStubFailure ??= { stage: "provider_url", code: "unexpected_provider_url" };
        throw new Error("conversation_fixture_provider_url_invalid");
      }
      const headers = new Headers(init.headers);
      const wireBody = String(init.body);
      const wireBodyBytes = Buffer.byteLength(wireBody);
      providerWireBodyBytes.push(wireBodyBytes);
      if (input.providerRequestBodyLimitBytes !== undefined &&
          (!Number.isSafeInteger(input.providerRequestBodyLimitBytes) || input.providerRequestBodyLimitBytes < 1))
        throw new Error("conversation_fixture_provider_request_limit_invalid");
      if (input.providerRequestBodyLimitBytes !== undefined && wireBodyBytes > input.providerRequestBodyLimitBytes)
        throw new Error("conversation_fixture_provider_request_exceeds_configured_byte_limit");
      const body = JSON.parse(wireBody) as Record<string, unknown>;
      const context = authenticatedProviderContext.getStore();
      if (!context) throw new Error("conversation_fixture_authenticated_provider_context_missing");
      const expectedKey = apiKeysByAgent.get(context.agentId);
      providerCalls.push({ body, keyMatches: headers.get("x-api-key") === expectedKey });
      const contract = context.completionContract;
      if (!contract) {
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
      const callIndex = (providerCallsByIssue.get(context.issueId) ?? 0) + 1;
      providerCallsByIssue.set(context.issueId, callIndex);
      const reply = await input.providerReply?.({ body, callIndex, issueId: context.issueId,
        runId: context.runId, completionContract: contract }) ?? {
        stop_reason:"end_turn",content:[{type:"text",text:"I’ve received your message and am ready to continue."}]};
      const responseBody = JSON.stringify({ id: `msg_conversation_${providerCalls.length}`, type: "message", role: "assistant", model,
        ...reply, usage });
      const response = new Response(responseBody,
      { status: 200, headers: { "content-type": "application/json" } });
      if (input.beforeProviderResponse) {
        providerHookInvoked = true;
        const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, context.runId)).limit(1);
        const [manifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, context.runId)).limit(1);
        const [reservation] = await db.select().from(orchestrationModelReservations)
          .where(eq(orchestrationModelReservations.conversationRunId, context.runId)).limit(1);
        const [company] = await db.select({ budgetMonthlyCents: companies.budgetMonthlyCents }).from(companies).where(eq(companies.id, companyId)).limit(1);
        const [agent] = await db.select({ budgetMonthlyCents: agents.budgetMonthlyCents }).from(agents).where(eq(agents.id, context.agentId)).limit(1);
        if (!run || !manifest || !reservation || !company || !agent)
          throw new Error("conversation_fixture_live_provider_boundary_facts_missing");
        const profileValue = run.runnerProfileJson && typeof run.runnerProfileJson === "object"
          ? run.runnerProfileJson as Record<string, unknown> : {};
        const sourceReceipt = profileValue.nativeInputSourceReceipt ?? null;
        try { await input.beforeProviderResponse({ db, actor: human, companyId, agentId: context.agentId, issueId: context.issueId,
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
      return response;
    } });
  const issuerFacts: Array<{ scope: string | null; runId: string; issueId: string;
    generation?: number; manifestId: string; manifestHash?: string }> = [];
  const brokerApp = express();
  brokerApp.use(express.json({ limit: "2mb" }));
  // Heartbeat delivers a run-scoped MCP URL to the actual runner. Give the
  // fixture that URL's real protocol endpoint instead of pointing it at a
  // dummy base URL or suppressing managed MCP delivery.
  const assignedToolGateway = createToolGatewayService(db, { remoteHttpRequest: input.assignedToolGatewayHttpRequest });
  registerAssignedMcpGateway(db, assignedToolGateway);
  brokerApp.use(mcpGatewayProtocolRoutes(assignedToolGateway));
  const brokerRequestByObject = new WeakMap<object, (typeof brokerRequestFacts)[number]>();
  let sandboxHeartbeat: Awaited<ReturnType<NonNullable<typeof input.configureHeartbeat>>> | undefined;
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
  // This fixture-only observer must run before the optional sandbox relay,
  // which owns the authenticated request and intentionally does not call next.
  brokerApp.use((req, _res, next) => {
    if (req.method !== "POST" || req.path !== "/runtime-tools/model/v1/messages" ||
      !input.beforeManagedConversationModelRequest) { next(); return; }
    managedConversationModelRequestCount += 1;
    void input.beforeManagedConversationModelRequest({ db, requestNumber: managedConversationModelRequestCount })
      .then(() => next(), next);
  });
  brokerApp.use((req, _res, next) => {
    if (req.method === "POST" && req.path === "/runtime-tools/model/v1/messages" &&
        req.headers["x-api-key"] === "paperclip-managed-model-broker" && !req.headers.authorization && activeToken)
      req.headers.authorization = `Bearer ${activeToken}`;
    next();
  });
  brokerApp.use((req, _res, next) => {
    if (req.method !== "POST" || req.path !== "/runtime-tools/model/v1/messages") { next(); return; }
    const token = /^Bearer\s+(\S+)$/i.exec(typeof req.headers.authorization === "string" ? req.headers.authorization : "")?.[1];
    const claims = token ? (verifyRuntimeToolsToken(token, "conversation_model") ??
      verifyRuntimeToolsToken(token, "worker_model")) : null;
    if (!claims?.conversation_model && !claims?.worker_model) { next(); return; }
    const context = providerRunContexts.get(claims.run_id);
    const sameClaims = context?.claims.scope === claims.scope &&
      context.claims.responsible_user_id === claims.responsible_user_id &&
      context.claims.instance_id === claims.instance_id &&
      (claims.conversation_model
        ? context.claims.conversation_model?.executionManifestHash === claims.conversation_model.executionManifestHash &&
          context.claims.conversation_model?.executionManifestId === claims.conversation_model.executionManifestId &&
          context.claims.conversation_model?.conversationSessionGeneration === claims.conversation_model.conversationSessionGeneration
        : context.claims.worker_model?.workerAttemptId === claims.worker_model?.workerAttemptId &&
          context.claims.worker_model?.executionManifestId === claims.worker_model?.executionManifestId &&
          context.claims.worker_model?.planId === claims.worker_model?.planId &&
          context.claims.worker_model?.workerId === claims.worker_model?.workerId &&
          context.claims.worker_model?.expectedPlanVersion === claims.worker_model?.expectedPlanVersion);
    if (!context || !sameClaims || context.agentId !== claims.sub || context.runId !== claims.run_id ||
        context.issueId !== (claims.conversation_model?.issueId ?? context.issueId) || claims.company_id !== companyId) {
      next(new Error("conversation_fixture_authenticated_provider_run_binding_mismatch"));
      return;
    }
    authenticatedProviderContext.run(context, () => next());
  });
  brokerApp.use((req, res, next) => {
    if (!input.sandboxRelay || req.method !== "POST" || req.path !== "/runtime-tools/model/v1/messages") { next(); return; }
    const authenticatedRequest = sandboxHeartbeat?.modelRequestAuthenticated;
    const request = sandboxHeartbeat?.modelRequest;
    if (!authenticatedRequest && !request) { next(new Error("conversation_fixture_host_model_request_unavailable")); return; }
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    req.once("aborted", cancel); res.once("close", cancel);
    const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
    const modelRequest = authenticatedRequest
      ? authenticatedRequest(req.body, controller.signal, authorization)
      : request!(req.body, controller.signal);
    void modelRequest.then(result => {
      if (!res.writableEnded) res.status(200).set("Cache-Control", "no-store").set("X-Accel-Buffering", "no")
        .type("text/event-stream").send(result.sse);
    }).catch(next).finally(() => { req.off("aborted", cancel); res.off("close", cancel); });
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
  // Durable PRP and the runner accept only an origin, with no trailing path
  // separator; a slash would make the managed environment tuple invalid.
  const origin = new URL(`https://${brokerHostname}:${address.port}`).origin;
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
      const upstream = createConnection(address.port, "127.0.0.1");
      brokerProxySockets.add(upstream);
      upstream.setTimeout(60_000, () => upstream.destroy());
      upstream.once("close", () => brokerProxySockets.delete(upstream));
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.once("error", () => client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"));
      client.once("error", () => upstream.destroy());
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
  process.env.NODE_EXTRA_CA_CERTS = certBundlePath;
  if (input.sandboxRelay) {
    const runnerPublicUrl = new URL(origin);
    runnerPublicUrl.protocol = "wss:";
    process.env.PAPERCLIP_RUNNER_PUBLIC_URL = runnerPublicUrl.origin;
  }
  sandboxHeartbeat = await input.configureHeartbeat?.({ db, diagnosticDb: input.diagnosticDb, actor: human, companyId, agentId,
    providerBindingId, gateway, profile,
    managedAgentProfiles: managedAgentIds.map(id => ({ agentId: id, providerBindingId: providerBindingsByAgent.get(id)!,
      profile: profilesByAgent.get(id)! })), runHome, opencodeBinary: input.opencodeBinary,
    brokerOrigin: origin, brokerProxyOrigin, certBundlePath, assignedToolGatewayHttpRequest: input.assignedToolGatewayHttpRequest, observeModelOriginDenials: input.observeModelOriginDenials, setBrokerToken: token => { activeToken = token; } });
  const heartbeat = heartbeatService(db, { sandboxExec: sandboxHeartbeat?.sandboxExec,
    environmentRuntime: sandboxHeartbeat?.environmentRuntime,
    beforeNativeRuntimeSelection: sandboxHeartbeat?.beforeNativeRuntimeSelection,
    testNativeRunnerEnvironment: async ({ execution, runId, issueId,
    agentId: currentAgentId, responsibleUserId }) => {
    if (execution.provider.kind !== "opencode" || !responsibleUserId || !issueId)
      throw new Error("conversation_fixture_provider_or_human_missing");
    const hostEnvironment = sandboxHeartbeat?.beforeNativeExecution
      ? await sandboxHeartbeat.beforeNativeExecution({ execution, runId, issueId, agentId: currentAgentId,
          responsibleUserId })
      : {};
    let minted: Awaited<ReturnType<typeof gateway.issueForConversationRun>> | Awaited<ReturnType<typeof gateway.issueForRun>>;
    let workerRunIssueId: string | null = null;
    try {
      const [run] = await db.select({ id: heartbeatRuns.id, nativeIssueId: heartbeatRuns.nativeIssueId,
        companyId: heartbeatRuns.companyId, agentId: heartbeatRuns.agentId, responsibleUserId: heartbeatRuns.responsibleUserId,
        runtimeMode: heartbeatRuns.runtimeMode, scopeKind: heartbeatRuns.scopeKind, status: heartbeatRuns.status })
        .from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).limit(1);
      if (run?.companyId !== companyId || run.agentId !== currentAgentId || run.responsibleUserId !== responsibleUserId ||
          run.runtimeMode !== "native" || run.status !== "running") throw new Error("native_run_binding_mismatch");
      const [currentIssue] = run.nativeIssueId === issueId ? await db.select({ conversationAgentId: issues.conversationAgentId,
        conversationUserId: issues.conversationUserId, conversationState: issues.conversationState })
        .from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).limit(1) : [];
      if (run.scopeKind === "issue" && run.nativeIssueId === issueId && currentIssue?.conversationAgentId === currentAgentId &&
          currentIssue.conversationUserId === responsibleUserId && currentIssue.conversationState === "active") {
        minted = await gateway.issueForConversationRun({ companyId, agentId: currentAgentId, runId, responsibleUserId });
      } else {
        // An ordinary assigned-task execution uses only the gateway's exact
        // active Worker attempt capability, never a conversation capability.
        minted = await gateway.issueForRun({ companyId, agentId: currentAgentId, runId, responsibleUserId });
        workerRunIssueId = issueId;
      }
    }
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
    const conversationClaims = verifyRuntimeToolsToken(minted.token, "conversation_model");
    const workerClaims = conversationClaims ? null : verifyRuntimeToolsToken(minted.token, "worker_model");
    const claims = conversationClaims ?? workerClaims;
    if (!claims || claims.run_id !== runId || claims.sub !== currentAgentId || claims.company_id !== companyId ||
        (conversationClaims && (!conversationClaims.conversation_model || conversationClaims.conversation_model.issueId !== issueId)) ||
        (workerClaims && (!workerClaims.worker_model || !workerRunIssueId)))
      throw new Error("conversation_fixture_issuer_scope_missing");
    const providerContext: ProviderRunContext = Object.freeze({
      completionContract: Object.freeze({ ...execution.completionContract.contract }),
      runId, issueId: workerClaims ? workerRunIssueId! : issueId, agentId: currentAgentId, claims: Object.freeze({ ...claims }) });
    providerRunContexts.set(runId, providerContext);
    // This is the exact Runtime Tools capability minted for this Run. The serial
    // host path authenticates it against its immutable Run/lease admission.
    activeToken = minted.token;
    issuerFacts.push({ scope: claims.scope, runId: claims.run_id, issueId: providerContext.issueId,
      ...(conversationClaims?.conversation_model ? { generation: conversationClaims.conversation_model.conversationSessionGeneration,
        manifestHash: conversationClaims.conversation_model.executionManifestHash } : {}),
      manifestId: claims.conversation_model?.executionManifestId ?? claims.worker_model!.executionManifestId });
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
  const resolveSessionFromHeaders = async (headers: Headers): Promise<BetterAuthSessionResult | null> => {
    const tokenCookie = (headers.get("cookie") ?? "").split(";").map((value: string) => value.trim())
      .find((value: string) => value.startsWith("session_token="));
    const token = tokenCookie ? decodeURIComponent(tokenCookie.slice("session_token=".length)) : null;
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
  };
  const resolveSession = async (req: ExpressRequest) =>
    resolveSessionFromHeaders(new Headers({ cookie: req.header("cookie") ?? "" }));
  let app: ExpressApp;
  let conversationOrigin = "";
  let closeConversationApp: (() => Promise<void>) | undefined;
  let closeConversationFailure: unknown;
  let managedHostCloseFailure: unknown;
  try {
    if (input.createConversationApp && !input.driveConversation)
      throw new Error("conversation_fixture_composed_app_requires_driver");
    if (input.createConversationApp) {
      const composed = await input.createConversationApp({ db, heartbeat, resolveSession, resolveSessionFromHeaders });
      app = composed.app;
      conversationOrigin = composed.origin;
      closeConversationApp = composed.close;
      if (!conversationOrigin || !/^https?:\/\//.test(conversationOrigin))
        throw new Error("conversation_fixture_browser_origin_invalid");
      // In the composed full-app fixture the Native run must call the same
      // authenticated HTTP API that the browser opened. The broker origin is
      // only the model/PRP transport and does not own product API routes.
      process.env.PAPERCLIP_API_URL = conversationOrigin;
    } else {
      app = express();
      app.use(express.json());
      app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession }));
      app.use("/api", issueRoutes(db, getStorageService(), { heartbeat }));
      app.use(errorHandler);
    }
    let conversationIssueId: string;
    let firstCommentId: string;
    const originHeaders: Record<string, string> = conversationOrigin ? { origin: conversationOrigin } : {};
    const conversationPrompt = input.conversationPrompt ?? "Please respond briefly and complete this conversation turn.";
    if (input.driveConversation) {
      if (input.firstCommentAttachment) throw new Error("conversation_fixture_attachment_requires_default_comment_driver");
      if (!input.createConversationApp)
        throw new Error("conversation_fixture_browser_driver_requires_composed_app");
      const [company] = await db.select({ issuePrefix: companies.issuePrefix }).from(companies)
        .where(eq(companies.id, companyId)).limit(1);
      if (!company?.issuePrefix) throw new Error("conversation_fixture_company_prefix_missing");
      let openedIssueId: string | null = null;
      const managedAgents = [
        { id: agentId, name: input.managedPrimaryAgentName ?? "Fox" },
        ...(input.managedAgentNames ?? []).map((name, index) => ({ id: additionalAgentIds[index]!, name })),
      ];
      const driven = await input.driveConversation({ app, origin: conversationOrigin, humanCookie, companyId, agentId, managedAgents,
        chatPath: `/api/companies/${companyId}/chats/${agentId}`,
        conversationRoute: `/${company.issuePrefix}/chats/${agentId}`,
        prompt: conversationPrompt,
        onConversationOpened: issueId => { openedIssueId = issueId; },
      });
      if (!driven.issueId || !driven.wakeCommentId || openedIssueId !== driven.issueId)
        throw new Error("conversation_fixture_browser_driver_result_invalid");
      conversationIssueId = driven.issueId;
      firstCommentId = driven.wakeCommentId;
    } else {
      const chat = await import("supertest").then(({ default: request }) => request(app)
        .post(`/api/companies/${companyId}/chats/${agentId}`).set("cookie", humanCookie).set(originHeaders));
      if (chat.status !== 200 || typeof chat.body.id !== "string") throw new Error(`conversation_fixture_chat_open_failed_${chat.status}`);
      conversationIssueId = chat.body.id;
      if (input.conversationWorkMode) {
        const mode = await import("supertest").then(({ default: request }) => request(app)
          .patch(`/api/issues/${conversationIssueId}`).set("cookie", humanCookie).set(originHeaders)
          .send({ workMode: input.conversationWorkMode }));
        if (mode.status !== 200) {
          const error = typeof mode.body?.error === "string" && /^[A-Za-z ]{1,80}$/.test(mode.body.error)
            ? mode.body.error.toLowerCase().replaceAll(" ", "_") : "unclassified";
          throw new Error(`conversation_fixture_work_mode_update_failed_${mode.status}_${error}`);
        }
      }
      let attachmentIds: string[] | undefined;
      if (input.firstCommentAttachment) {
        const uploaded = await import("supertest").then(({ default: request }) => request(app)
          .post(`/api/companies/${companyId}/issues/${conversationIssueId}/attachments`)
          .set("cookie", humanCookie).set(originHeaders)
          .attach("file", input.firstCommentAttachment!.bytes, {
            filename: input.firstCommentAttachment!.filename, contentType: input.firstCommentAttachment!.contentType,
          }));
        if (uploaded.status !== 201 || typeof uploaded.body?.id !== "string")
          throw new Error(`conversation_fixture_attachment_upload_failed_${uploaded.status}`);
        attachmentIds = [uploaded.body.id];
      }
      const sent = await import("supertest").then(({ default: request }) => request(app)
        .post(`/api/issues/${conversationIssueId}/comments`).set("cookie", humanCookie).set(originHeaders)
        .send({ body: conversationPrompt, clientRequestId: randomUUID(), ...(attachmentIds ? { attachmentIds } : {}) }));
      if (sent.status !== 201) throw new Error(`conversation_fixture_first_comment_failed_${sent.status}`);
      firstCommentId = sent.body.id;
    }
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const [candidate] = await db.select().from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId),
        sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${conversationIssueId}`,
        sql`${heartbeatRuns.contextSnapshot}->>'wakeCommentId' = ${firstCommentId}`,
      )).orderBy(desc(heartbeatRuns.startedAt)).limit(1);
      if (candidate && ["succeeded", "failed", "timed_out", "cancelled", "superseded"].includes(candidate.status)) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await heartbeat.drainActiveRunExecutions();
    const [finalRun] = await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId),
      sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${conversationIssueId}`,
      sql`${heartbeatRuns.contextSnapshot}->>'wakeCommentId' = ${firstCommentId}`,
    )).orderBy(desc(heartbeatRuns.startedAt)).limit(1);
    if (finalRun && finalRun.status !== "succeeded") {
      try {
        const [coordinator] = await db.select({ phase: nativeRunFinalizations.phase,
          attempt: nativeRunFinalizations.attempt, failureCode: nativeRunFinalizations.failureCode })
          .from(nativeRunFinalizations).where(and(eq(nativeRunFinalizations.companyId, companyId),
            eq(nativeRunFinalizations.runId, finalRun.id))).limit(1);
        const operations = await db.select({ status: workspaceOperations.status, metadata: workspaceOperations.metadata })
          .from(workspaceOperations).where(and(eq(workspaceOperations.companyId, companyId),
            eq(workspaceOperations.heartbeatRunId, finalRun.id), eq(workspaceOperations.phase, "workspace_finalize")))
          .orderBy(desc(workspaceOperations.createdAt)).limit(4);
        console.info("conversation_frame_workspace_finalize_failure", JSON.stringify({
          coordinatorPresent: !!coordinator,
          phase: ["pending", "proposed", "committed", "retryable_failure", "terminal_failure"].find(value => value === coordinator?.phase) ?? "other",
          attempt: Number.isSafeInteger(coordinator?.attempt) && coordinator!.attempt >= 0 ? coordinator!.attempt : null,
          failureCode: ["native_workspace_sync_out_failed", "native_workspace_sync_out_unrecoverable", "native_finalization_invalid"].find(value => value === coordinator?.failureCode) ?? "other",
          operations: operations.map(operation => ({
            status: ["succeeded", "failed", "running"].find(value => value === operation.status) ?? "other",
            ...frameWorkspaceFinalizeFailureFacets(operation.metadata?.errorMessage),
          })),
        }));
      } catch { /* Failure diagnostics must not replace the original Run outcome. */ }
    }
    const [manifest] = finalRun ? await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, finalRun.id)).limit(1) : [];
    const [reservation] = finalRun ? await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.conversationRunId, finalRun.id)).limit(1) : [];
    const [plan] = finalRun ? await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.issueId, conversationIssueId)).limit(1) : [];
    const attempts = finalRun ? await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.runId, finalRun.id)) : [];
    const profileValue = finalRun?.runnerProfileJson && typeof finalRun.runnerProfileJson === "object"
      ? finalRun.runnerProfileJson as Record<string, unknown> : {};
    const comments = await db.select().from(issueComments).where(eq(issueComments.issueId, conversationIssueId));
    const reviewInteractionCount = await db.select({ id: issueThreadInteractions.id }).from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.issueId, conversationIssueId));
    const agentReply = comments.find(comment => comment.authorAgentId === agentId && comment.createdByRunId === finalRun?.id) ?? null;
    const [conversationIssue] = await db.select({ status: issues.status, conversationState: issues.conversationState,
      executionRunId: issues.executionRunId }).from(issues).where(eq(issues.id, conversationIssueId)).limit(1);
    const countBeforeForeignWrite = comments.length;
    const foreignWrite = await import("supertest").then(({ default: request }) => request(app)
      .post(`/api/issues/${conversationIssueId}/comments`).set("cookie", foreignCookie).set(originHeaders)
      .send({ body: "This foreign session must not write to the conversation.", clientRequestId: randomUUID() }));
    const commentsAfterForeignWrite = await db.select().from(issueComments).where(eq(issueComments.issueId, conversationIssueId));
    const sandboxRuntimeFacts = sandboxHeartbeat?.facts?.() ?? null;
    const nativeInputSourceReceipt = profileValue.nativeInputSourceReceipt ?? null;
    if (finalRun && (["succeeded", "failed", "timed_out", "cancelled", "superseded"].includes(finalRun.status) ||
      process.env.PAPERCLIP_NATIVE_CANCEL_ORIGIN_TEST_DIAGNOSTICS === "1"))
      await input.afterRunSettledBeforeTeardown?.({ db, actor: human, companyId, guestCompanyId: f.guest,
        identityId: f.identity.id, agentId,
        issueId: conversationIssueId, run: finalRun, manifest: manifest ?? null, reservation: reservation ?? null,
        nativeInputSourceReceipt, sandboxRuntimeFacts, providerCallCount: providerCalls.length,
        providerHookInvoked, providerStubFailure, providerWireBodyBytes: [...providerWireBodyBytes] });
    return { issueId: conversationIssueId, firstCommentId, run: finalRun ?? null,
      manifest: manifest ?? null, reservation: reservation ?? null, workerPlan: plan ?? null,
      workerAttempts: attempts, providerCallCount: providerCalls.length,
      providerHookInvoked, providerHookFailure, providerStubFailure, providerToolNames, brokerRequestFacts,
      providerWireBodyBytes: [...providerWireBodyBytes], maxProviderWireBodyBytes: Math.max(0, ...providerWireBodyBytes),
      providerKeyMatched: providerCalls.length > 0 && providerCalls.every(call => call.keyMatches),
      issuerFacts, nativeInputSourceReceipt,
      agentReply, conversationCommentCount: comments.length, reviewInteractionCount: reviewInteractionCount.length,
      conversationIssue: conversationIssue ?? null, foreignWriteStatus: foreignWrite.status,
      foreignWriteDidNotMutate: commentsAfterForeignWrite.length === countBeforeForeignWrite,
      sandboxRuntimeFacts,
      runStatus: finalRun?.status ?? "not_started", success: finalRun?.status === "succeeded" };
  } finally {
    await heartbeat.drainActiveRunExecutions().catch(() => undefined);
    try { await closeConversationApp?.(); }
    catch (error) { closeConversationFailure = error; }
    try { await sandboxHeartbeat?.close?.(); }
    catch (error) { managedHostCloseFailure = error; }
    for (const socket of brokerProxySockets) socket.destroy();
    if (brokerProxy?.listening) await new Promise<void>(resolve => brokerProxy!.close(() => resolve()));
    runnerPrpWebSocketInternals.resetForTests();
    await new Promise<void>(resolve => broker.close(() => resolve()));
    if (prevBroker === undefined) delete process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN; else process.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN = prevBroker;
    if (prevJwt === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET; else process.env.PAPERCLIP_AGENT_JWT_SECRET = prevJwt;
    if (prevCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS; else process.env.NODE_EXTRA_CA_CERTS = prevCa;
    if (prevRunnerPublicUrl === undefined) delete process.env.PAPERCLIP_RUNNER_PUBLIC_URL; else process.env.PAPERCLIP_RUNNER_PUBLIC_URL = prevRunnerPublicUrl;
    if (prevPaperclipApiUrl === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = prevPaperclipApiUrl;
    await makeConversationFixtureTreeWritable(runHome);
    await rm(runHome, { recursive: true, force: true });
    if (closeConversationFailure !== undefined || managedHostCloseFailure !== undefined)
      throw new AggregateError([closeConversationFailure, managedHostCloseFailure]
        .filter((error): error is unknown => error !== undefined), "conversation_fixture_shutdown_failed");
  }
}
