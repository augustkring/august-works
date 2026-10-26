import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import express from "express";
import request from "supertest";
import postgres from "postgres";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { expect } from "vitest";
import { nativeSha256 } from "../../services/native-runtime/canonical.js";

import {
  agents,
  agentIdentities,
  authUsers,
  authSessions,
  createDb,
  heartbeatRuns,
  completionContracts,
  companyMemberships,
  principalPermissionGrants,
  companies,
  documentRevisions,
  contextManifestItems,
  contextManifestMemoryRoots,
  agentExecutionManifests,
  issueDocuments,
  issues,
  orchestrationModelReservations,
  orchestrationPlans,
  orchestrationWorkerAttempts,
  orchestrationWorkers,
  nativeRunFinalizations,
  toolInvocations,
  memoryRecords,
  activityLog,
  supervisionInterventions,
  toolPolicies,
} from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema, nativeRunInputSourceReceiptSchema,
  type NativePayloadSourceInput } from "@paperclipai/shared";
import { seedV5Presences, enableV5ForTest } from "./v5-fixtures.js";
import { seedNativePasskeySession } from "./native-authentication-fixtures.js";
import { agentProviderBindingService } from "../../services/agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../../services/agent-runtime-fabric.js";
import { aiConnectionService } from "../../services/ai-connections.js";
import { issueService } from "../../services/issues.js";
import { environmentService } from "../../services/environments.js";
import { environmentRuntimeService } from "../../services/environment-runtime.js";
import { documentService } from "../../services/documents.js";
import { memoryService, type MemoryMutationActor } from "../../services/memory/memory-service.js";
import { canActorReadMemorySources } from "../../services/memory/memory-privacy.js";
import { assertNativeMemoryOutputSnapshotCurrent } from "../../services/native-direct-input.js";
import type { AuthorizationActor } from "../../services/authorization.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { orchestrationService } from "../../services/orchestration/orchestration-service.js";
import { workerModelGateway } from "../../services/orchestration/worker-model-gateway.js";
import { createToolGatewayService } from "../../services/tool-gateway.js";
import { recordNativeLocalProcessStopAfterExit } from "../../services/native-local-process-stop.js";
import { managedOpenCodeRuntimeDirectory } from "../../services/native-runtime/runtime-asset-retention.js";
import { getAssignedMcpGateway, registerAssignedMcpGateway } from "../../services/native-runtime/assigned-mcp-tools.js";
import { hashContextPolicySnapshot } from "../../services/context/context-manifest.js";
import { discoverNativeCapabilities } from "../../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../../services/provider-capabilities.js";
import { runtimeConnectionIntentRoutes } from "../../routes/connection-intents.js";
import { projectRoutes } from "../../routes/projects.js";
import { actorMiddleware } from "../../middleware/auth.js";
import type { BetterAuthSessionResult } from "../../auth/better-auth.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { issueRoutes } from "../../routes/issues.js";
import { setupRunnerPrpWebSocketServer } from "../../realtime/runner-prp-ws.js";
import { prepareNativeHeartbeatRun } from "../../services/native-runtime/prepare-native-run.js";
import { executePaperclipNativeSession } from "../../services/native-runtime/native-session-executor.js";
import { PaperclipControlPlanePort } from "../../services/native-runtime/paperclip-control-plane-port.js";
import { finalizeNativeRun } from "../../services/native-runtime/native-run-finalizer.js";
import { buildNativeExecutionInput, buildNativeBootstrapSourceSet } from "../../services/native-runtime/native-execution-input.js";
import { buildRetainedNativeRuntimeContext } from "../../services/native-runtime/runtime-context.js";
import { getIssueExecutionContext, buildPaperclipTaskMarkdown, persistHeartbeatRunProcessMetadata } from "../../services/heartbeat.js";
import { workerModelProfileSchema, type WorkerModelProfile } from "../../services/orchestration/worker-model-profiles.js";
import { currentNativeControllerIdentity } from "../../services/native-runtime/native-restart-recovery.js";
import { nativeCompletionContractInput } from "../../services/native-runtime/completion-contracts.js";
import { resolveDefaultAgentWorkspaceDir } from "../../home-paths.js";
import { OpenCodeServerDriver } from "@paperclipai/paperclip-runner";
import { buildNativeModelEnvelope, createCodexTaskEnvelope, nativeTaskConstraints } from "../../vendor/paperclip-runner/index.js";
import type { PrpStructuredRunResult, PrpTerminalState } from "../../vendor/paperclip-runner/index.js";

const QUALIFIED_OPENCODE_SHA256 = "513f500a1a5ea1dc7d865547ac87b32a8936334e8d5abd5b3ff585c45a170080";
const sourceSha = "a".repeat(40);
const credential = `e2e-only-${randomUUID()}`;

function toolName(value: unknown): string {
  let name = typeof value === "string" ? value : "";
  for (const prefix of ["paperclip__", "paperclip_", "paperclip."])
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  return name;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
  return value;
}

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value)) ?? "undefined").digest("hex");
}

function staticManagedErrorCodes(value: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof value === "string") {
    if (/^(?:managed_opencode|native|paperclip)_[a-z0-9_]{2,80}$/.test(value)) return [value];
    if (value.length > 16_384) return [];
    try { return staticManagedErrorCodes(JSON.parse(value), depth + 1); }
    catch { return []; }
  }
  if (Array.isArray(value)) return value.flatMap(item => staticManagedErrorCodes(item, depth + 1));
  if (value && typeof value === "object") return Object.values(value).flatMap(item =>
    staticManagedErrorCodes(item, depth + 1));
  return [];
}

function managedMemoryBoundaryFacts(value: unknown, depth = 0): { messageMatches: string[]; errorCodes: string[] } {
  const messageLabels = new Map([
    ["Managed Memory write has no exact provider tool-use capture", "provider_capture_missing"],
    ["Managed Memory requires the current verified Agent credential", "verified_agent_credential_missing"],
    ["Managed Memory result has no completed canonical Tool Gateway invocation", "gateway_invocation_missing"],
    ["Managed Memory result does not match its canonical invocation", "gateway_invocation_mismatch"],
    ["Managed Memory output capture is unavailable", "managed_memory_capture_unavailable"],
    ["Native Memory output capture does not match this scoped call", "scoped_memory_capture_mismatch"],
    ["The Native output capture is unavailable", "native_output_capture_unavailable"],
    ["The Native output capture is not bound to its settled provider tool use", "native_output_capture_unbound"],
    ["The Native consumed source graph contains a cycle", "native_source_cycle"],
    ["The Native output source chain exceeds its bound", "native_output_source_bound_exceeded"],
    ["The Native output capture lacks its consumed source components", "native_output_components_missing"],
    ["assigned_mcp_gateway_unavailable", "assigned_gateway_unavailable"],
  ]);
  const messageMatches = new Set<string>();
  const errorCodes = new Set<string>();
  const visit = (current: unknown, level: number) => {
    if (level > 6) return;
    if (typeof current === "string") {
      const label = messageLabels.get(current);
      if (label) messageMatches.add(label);
      if (current.length <= 16_384) {
        try { visit(JSON.parse(current), level + 1); } catch { /* plain tool text */ }
      }
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current.slice(0, 32)) visit(item, level + 1);
      return;
    }
    if (!current || typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    for (const key of ["code", "errorCode"]) {
      const code = record[key];
      if (typeof code === "string" && /^[a-z][a-z0-9_]{1,80}$/.test(code)) errorCodes.add(code);
    }
    for (const item of Object.values(record).slice(0, 32)) visit(item, level + 1);
  };
  visit(value, depth);
  return { messageMatches: [...messageMatches].sort(), errorCodes: [...errorCodes].sort() };
}

function safeToolResultShape(value: unknown) {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = null; }
  } else if (Array.isArray(value)) {
    const text = value.flatMap(part => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
      ? [(part as Record<string, unknown>).text as string] : []).join("");
    try { parsed = JSON.parse(text); } catch { parsed = null; }
  }
  const row = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const data = row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data as Record<string, unknown> : {};
  const record = data.record && typeof data.record === "object" && !Array.isArray(data.record)
    ? data.record as Record<string, unknown> : {};
  const scope = record.scope && typeof record.scope === "object" && !Array.isArray(record.scope)
    ? record.scope as Record<string, unknown> : {};
  const allowedStatuses = new Set(["accepted", "pending", "duplicate", "corroborated", "completed", "replayed", "failed"]);
  const allowedScopes = new Set(["company", "private", "agent", "project"]);
  return { parseSucceeded: parsed !== null,
    topLevelKeys: Object.keys(row).sort(), dataKeys: Object.keys(data).sort(), recordKeys: Object.keys(record).sort(),
    status: typeof data.status === "string" && allowedStatuses.has(data.status) ? data.status : "other_or_absent",
    scopeType: typeof scope.type === "string" && allowedScopes.has(scope.type) ? scope.type : "other_or_absent",
    errorCode: typeof row.errorCode === "string" && /^[a-z][a-z0-9_]{1,80}$/.test(row.errorCode) ? row.errorCode : undefined };
}

function safeCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9_]{1,120}$/i.test(value) ? value : undefined;
}

function differencePaths(left: unknown, right: unknown, path = "$"): string[] {
  if (JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right))) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const paths: string[] = [];
    for (let index = 0; index < Math.max(left.length, right.length); index += 1)
      paths.push(...differencePaths(left[index], right[index], `${path}[${index}]`));
    return paths;
  }
  if (left && right && typeof left === "object" && typeof right === "object" &&
    !Array.isArray(left) && !Array.isArray(right)) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    return [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort()
      .flatMap(key => differencePaths(leftRecord[key], rightRecord[key], `${path}.${key}`));
  }
  return [path];
}

function valueCategory(value: unknown): string {
  if (value === undefined) return "absent";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return value ? "true" : "false";
  return typeof value;
}

function qualifiedOpenCodeBinary(): string {
  const configured = process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim();
  if (configured) return configured;
  try { return execFileSync("which", ["opencode"], { encoding: "utf8" }).trim(); }
  catch { throw new Error("Set PAPERCLIP_QUALIFIED_OPENCODE_BINARY or install the qualified OpenCode binary on PATH."); }
}

export async function makeFixtureTreeWritable(target: string): Promise<void> {
  const metadata = await lstat(target).catch(() => null);
  if (!metadata || metadata.isSymbolicLink()) return;
  await chmod(target, metadata.isDirectory() ? 0o700 : 0o600);
  if (metadata.isDirectory())
    for (const name of await readdir(target)) await makeFixtureTreeWritable(join(target, name));
}

export type ManagedNativeOpenCodeModelStep = {
  tool: "write_document" | "create_task" | "self_remember" | "read_context" | "call_api" | "paperclip_finish";
  id?: string;
  input?: Record<string, unknown>;
};

export type ManagedNativeOpenCodeHumanAction = {
  afterModelToolCallId: string;
  action: "accept_memory_candidate" | "create_private_context_root" | "edit_project_workspace";
};

type ManagedNativePrivateRoot = {
  issueId: string;
  memoryId: string;
  content: string;
  memoryActor: MemoryMutationActor;
};

export async function runManagedNativeOpenCodeFixture(input: {
  db: ReturnType<typeof createDb>;
  connectionString: string;
  root: string;
  instanceId: string;
  steps?: ManagedNativeOpenCodeModelStep[];
  humanActions?: ManagedNativeOpenCodeHumanAction[];
  /** Prepare a private Task source; create its Human-reviewed Memory root after the configured model step. */
  privateContextContent?: string;
  /** Return early after a Human workspace change is rejected as a stale Project source. */
  expectProjectWorkspaceSourceDenial?: boolean;
  reuseIdentity?: { companyId: string; agentId: string; aliceUserId: string; bobUserId: string };
  onPreserveDebugArtifacts?: () => void;
}) {
  const { db, root, instanceId } = input;
  let contextProbeCallId: string | null = null;
  let pendingContextProbeCallId: string | null = null;
  let pendingContextProbeStartedAt: number | null = null;
  let contextProbeStartedAt: number | null = null;
  let contextProbeCompletedAt: number | null = null;
  let contextProbeSamples = 0;
  let contextPostCaptureProbeStartedAt: number | null = null;
  let contextPostCaptureProbeSamples = 0;
  const contextTransactionOwners = new Set<string>();
  const ownerDb = db as typeof db & { transaction: typeof db.transaction };
  const originalRootTransaction = ownerDb.transaction.bind(ownerDb);
  const instrumentedRootTransaction = (async (...args: Parameters<typeof db.transaction>) => {
    const [callback, config] = args;
    return originalRootTransaction(async tx => {
      if (contextProbeCallId) {
        const stack = new Error().stack ?? "";
        const serviceFrame = stack.split("\n").map(line => line.trim()).find(line =>
          /server\/src\/services\/[A-Za-z0-9_./-]+\.ts:\d+:\d+/.test(line));
        const sourceLocation = serviceFrame && /server\/src\/services\/([A-Za-z0-9_./-]+\.ts):(\d+):\d+/.exec(serviceFrame);
        const moduleName = sourceLocation?.[1]?.split("/").at(-1)?.replace(/\.ts$/, "") ?? "service";
        const lineNumber = sourceLocation?.[2] ?? "0";
        const ownerLabel = `fx.${moduleName}:${lineNumber}`.slice(0, 63);
        contextTransactionOwners.add(ownerLabel);
        await tx.execute(sql`select set_config('application_name', ${ownerLabel}, true)`);
      }
      return callback(tx);
    }, config);
  }) as typeof db.transaction;
  Object.defineProperty(ownerDb, "transaction", { configurable: true, writable: true, value: instrumentedRootTransaction });
  await instanceSettingsService(db).getExperimental();
  await enableV5ForTest(db);
  await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true,
    role_packs_v5: false, skill_resolver_v5: false, readiness_engine_v7: true, orchestration_v7: true,
    enableContextEngineV1: true, enableCollectiveMemoryV1: true, enablePrivateAgentMemoryV1: true });
  const defaultSteps: ManagedNativeOpenCodeModelStep[] = [
    { tool: "write_document", id: "managed-e2e-write-1", input: {
      idempotencyKey: "managed-opencode-source-document-v1", key: "managed-source-e2e", title: "Private E2E note",
      body: "This document was written through the governed OpenCode tool boundary.", baseRevisionId: null,
    } },
    { tool: "paperclip_finish", id: "managed-e2e-finish-1" },
  ];
  const modelSteps = input.steps ?? defaultSteps;
  if (modelSteps.length < 2 || modelSteps.at(-1)?.tool !== "paperclip_finish" ||
    modelSteps.slice(0, -1).some(step => step.tool === "paperclip_finish") ||
    new Set(modelSteps.map((step, index) => step.id ?? `managed-e2e-${step.tool}-${index}`)).size !== modelSteps.length)
    throw new Error("managed_fixture_model_steps_invalid");
  const includesProjectApiRead = modelSteps.some(step => step.tool === "call_api");
  for (const action of input.humanActions ?? []) {
    const target = modelSteps.find((step, index) =>
      (step.id ?? `managed-e2e-${step.tool}-${index}`) === action.afterModelToolCallId);
    const memoryAction = action.action === "accept_memory_candidate" || action.action === "create_private_context_root";
    if ((memoryAction && target?.tool !== "self_remember") ||
      (action.action === "edit_project_workspace" && target?.tool !== "call_api") ||
      !["accept_memory_candidate", "create_private_context_root", "edit_project_workspace"].includes(action.action))
      throw new Error("managed_fixture_human_action_invalid");
  }
  const acceptedMemoryIds: string[] = [];
  const completedHumanActions = new Set<string>();
    const opencodeBinary = qualifiedOpenCodeBinary();
    expect(execFileSync(opencodeBinary, ["--version"], { encoding: "utf8" }).trim()).toBe("1.18.32");
    expect(createHash("sha256").update(await readFile(opencodeBinary)).digest("hex")).toBe(QUALIFIED_OPENCODE_SHA256);
    const runRoot = await mkdtemp(join(root, "run-"));
    const keyPath = join(runRoot, "broker-key.pem");
    const certPath = join(runRoot, "broker-cert.pem");
    const caKeyPath = join(runRoot, "broker-ca-key.pem");
    const caCertPath = join(runRoot, "broker-ca-cert.pem");
    const csrPath = join(runRoot, "broker.csr");
    const extensionsPath = join(runRoot, "broker-extensions.cnf");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKeyPath,
      "-out", caCertPath, "-days", "1", "-subj", "/CN=Managed OpenCode E2E Test CA", "-addext",
      "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"], { stdio: "ignore" });
    execFileSync("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath,
      "-out", csrPath, "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
    await writeFile(extensionsPath, "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n");
    execFileSync("openssl", ["x509", "-req", "-in", csrPath, "-CA", caCertPath, "-CAkey", caKeyPath,
      "-CAcreateserial", "-out", certPath, "-days", "1", "-sha256", "-extfile", extensionsPath], { stdio: "ignore" });
    await chmod(keyPath, 0o600);
    const certBundlePath = join(runRoot, "broker-trust-bundle.pem");
    await writeFile(certBundlePath, Buffer.concat([await readFile("/etc/ssl/certs/ca-certificates.crt"),
      Buffer.from("\n"), await readFile(caCertPath)]), { mode: 0o600 });
    const f = input.reuseIdentity ? null : await seedV5Presences(db);
    const companyId = input.reuseIdentity?.companyId ?? f!.home;
    const agentId = input.reuseIdentity?.agentId ?? f!.presence.id;
    const aliceUserId = input.reuseIdentity?.aliceUserId ?? f!.userId;
    const sessionId = await seedNativePasskeySession(db, aliceUserId);
    const [membership] = await db.select({ companyId: companyMemberships.companyId,
      membershipRole: companyMemberships.membershipRole, status: companyMemberships.status })
      .from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, aliceUserId)));
    if (!membership) throw new Error("Current Human company membership is unavailable.");
    const [agentRow] = await db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
    if (!agentRow) throw new Error("The reused Native Agent is unavailable in its company.");
    const baseHumanActor = f?.actor ?? { type: "board" as const, source: "session" as const,
      userId: aliceUserId, companyIds: [companyId] };
    const human = { ...baseHumanActor, sessionId, memberships: [membership] };
    let bobUserId = input.reuseIdentity?.bobUserId ?? randomUUID();
    if (!input.reuseIdentity) {
      const userTimestamp = new Date();
      await db.insert(authUsers).values({ id: bobUserId, name: "Temporal Bob", email: `${bobUserId}@example.test`,
        createdAt: userTimestamp, updatedAt: userTimestamp });
      await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: bobUserId,
        status: "active", membershipRole: "admin" });
    }
    const bobSessionId = await seedNativePasskeySession(db, bobUserId);
    const [bobMembership] = await db.select({ companyId: companyMemberships.companyId,
      membershipRole: companyMemberships.membershipRole, status: companyMemberships.status })
      .from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, bobUserId)));
    if (!bobMembership) throw new Error("Temporal Bob company membership is unavailable.");
    const bobActor = { type: "board" as const, source: "session" as const, userId: bobUserId,
      companyIds: [companyId], sessionId: bobSessionId, memberships: [bobMembership] };
    const aliceMemoryActor = { principal: { type: "user" as const, userId: aliceUserId }, authorizationActor: human };
    const bobMemoryActor = { principal: { type: "user" as const, userId: bobUserId }, authorizationActor: bobActor };
    const privateRootRef: { current: ManagedNativePrivateRoot | null } = { current: null };
    let privateRootTask: typeof issues.$inferSelect | null = null;
    let privateRootBindingId: string | null = null;
    let privateRootMemoryActor: MemoryMutationActor | null = null;
    let managedMemoryBindingKey: string | null = null;
    const containsRemember = modelSteps.some(step => step.tool === "self_remember");
    if (containsRemember) {
      const memories = memoryService(db);
      managedMemoryBindingKey = `managed-opencode-${randomUUID()}`;
      const binding = await memories.createCompanyBinding(companyId, {
        key: managedMemoryBindingKey, name: "Managed OpenCode E2E Memory", providerKey: "local",
      }, aliceMemoryActor);
      await memories.addBindingTarget(companyId, binding.id, { targetType: "company", targetId: companyId }, aliceMemoryActor);
      await memories.addBindingTarget(companyId, binding.id, { targetType: "agent", targetId: agentId }, aliceMemoryActor);
      if (input.privateContextContent) privateRootBindingId = binding.id;
    }
    const profileId = randomUUID();
    const model = "fixture-managed-opencode-v1";
    const adapterConfig = { provider: "opencode", model: `anthropic/${model}`, lifecycleMode: "per_turn" };
    await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig, runtimeConfig: {} })
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));

    const providers = agentProviderBindingService(db);
    const providerBinding = await providers.create(human, companyId, agentId, {
      providerType: "paperclip_native", providerAgentRef: agentId, isolationMode: "isolated_per_presence", providerEndpointRef: null,
    });
    const attached = await providers.attach(human, companyId, agentId, {
      providerBindingId: providerBinding.id, providerProfileRef: agentId,
    });
    const snapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({
      companyId, adapterType: "paperclip_runner", config: adapterConfig,
    }));
    await providers.recordDiscovery(companyId, agentId, snapshot,
      Object.fromEntries(providerConformanceRequirements(snapshot, providerBinding.isolationMode).map(check => [check, true])));
    const provider = await providers.assertRuntime(companyId, agentId);

    const issued = await aiConnectionService(db).save(companyId, aliceUserId, {
      provider: "anthropic", method: "api_key", ownership: "shared", name: "Fixture managed model",
      apiKey: "fixture", allAgents: false, agentIds: [agentId],
    }, credential);
    const qualifiedHash = hashContextPolicySnapshot({ adapterType: "paperclip_runner", adapterConfig });
    const profile: WorkerModelProfile = workerModelProfileSchema.parse({
      id: profileId, companyId, workerAgentId: agentId, providerBindingId: provider.provider.id,
      providerSnapshotHash: provider.provider.capabilitySnapshotHash,
      providerProfileRef: provider.runtime.providerProfileRef, qualifiedConfigurationHash: qualifiedHash,
      binding: { provider: "anthropic", method: "api_key", mode: "shared", ...issued },
      transport: "server-anthropic-messages-v1", contract: "anthropic-messages-tools-2023-06-01",
      maximumEnvelopeBytes: 64000, inputTokensUpperBound: 100000, maxOutputTokens: 1024,
      tariff: { provider: "anthropic", model, currency: "USD", inputMinorPerMillion: 0, outputMinorPerMillion: 0,
        fixedMinor: 1, qualificationHash: "b".repeat(64), sourceSha, testedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
      qualificationEvidenceRef: "https://protected.test.invalid/qualification/managed-opencode-fixture.json",
      qualificationArtifactSha256: "c".repeat(64),
    });

    const humanApp = express();
    humanApp.use(express.json());
    humanApp.use((req, _res, next) => { req.actor = human as typeof req.actor; next(); });
    humanApp.use("/api", issueRoutes(db, {} as never));
    humanApp.use(errorHandler);
    const projectApiApp = express();
    projectApiApp.use(express.json());
    let fixtureProjectHumanCookie: string | null = null;
    if (includesProjectApiRead) {
      const [projectSession] = await db.select({ id: authSessions.id, userId: authSessions.userId,
        token: authSessions.token, expiresAt: authSessions.expiresAt })
        .from(authSessions).where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, aliceUserId)));
      if (!projectSession || projectSession.expiresAt.getTime() <= Date.now())
        throw new Error("managed_fixture_project_human_session_unavailable");
      fixtureProjectHumanCookie = `session_token=${encodeURIComponent(projectSession.token)}`;
      projectApiApp.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async req => {
        const cookieToken = (req.header("cookie") ?? "").split(";").map(value => value.trim())
          .map(value => value.slice(value.indexOf("=") + 1)).map(value => decodeURIComponent(value))
          .find(value => value === projectSession.token);
        if (!cookieToken || projectSession.expiresAt.getTime() <= Date.now()) return null;
        const [user] = await db.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
          .from(authUsers).where(eq(authUsers.id, projectSession.userId));
        if (!user) return null;
        const session: BetterAuthSessionResult = {
          session: { id: projectSession.id, userId: projectSession.userId, expiresAt: projectSession.expiresAt },
          user,
        };
        return session;
      } }));
      projectApiApp.use("/api", projectRoutes(db));
      projectApiApp.use(errorHandler);
    }
    let fixtureProjectId: string | null = null;
    let fixtureProjectWorkspaceId: string | null = null;
    if (includesProjectApiRead) {
      if (!fixtureProjectHumanCookie) throw new Error("managed_fixture_project_human_session_missing");
      const createdProject = await request(projectApiApp).post(`/api/companies/${companyId}/projects`)
        .set("cookie", fixtureProjectHumanCookie)
        .send({ name: `Managed OpenCode Project ${randomUUID()}`,
          description: "Human-created Project returned by the authenticated call_api route.",
          workspace: { name: "Public Project workspace", cwd: root, isPrimary: true } });
      if (createdProject.status !== 201 || typeof createdProject.body.id !== "string")
        throw new Error(`managed_fixture_project_create_failed_${createdProject.status}`);
      fixtureProjectId = createdProject.body.id;
      const createdWorkspace = Array.isArray(createdProject.body.workspaces)
        ? createdProject.body.workspaces.find((value: unknown) => value && typeof value === "object" &&
            (value as Record<string, unknown>).isPrimary === true) : null;
      if (!createdWorkspace || typeof (createdWorkspace as Record<string, unknown>).id !== "string")
        throw new Error("managed_fixture_project_workspace_id_missing");
      fixtureProjectWorkspaceId = (createdWorkspace as Record<string, unknown>).id as string;
    }
    if (input.privateContextContent) {
      // The ordinary HTTP admission path deliberately rejects private work.
      // For this source-closure fixture, create the private root through the
      // existing issue owner with the current verified Human actor.
      const privateTask = await issueService(db).create(companyId, {
        title: `Context producer Task ${randomUUID()}`,
        description: input.privateContextContent,
        visibility: "private", assigneeAgentId: agentId, responsibleUserId: aliceUserId,
        createdByUserId: aliceUserId,
      }, db, undefined, { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
      const [persistedPrivateTask] = await db.select({ visibility: issues.visibility, assigneeAgentId: issues.assigneeAgentId,
        responsibleUserId: issues.responsibleUserId }).from(issues)
        .where(and(eq(issues.companyId, companyId), eq(issues.id, privateTask.id)));
      if (!persistedPrivateTask || persistedPrivateTask.visibility !== "private" ||
        persistedPrivateTask.assigneeAgentId !== agentId || persistedPrivateTask.responsibleUserId !== aliceUserId)
        throw new Error("managed_fixture_private_context_task_binding_invalid");
      const sourceActor: MemoryMutationActor = {
        principal: { type: "user", userId: aliceUserId }, authorizationActor: human,
      };
      await db.insert(principalPermissionGrants).values([
        { companyId, principalType: "user", principalId: aliceUserId, permissionKey: "company_scope:read" },
        { companyId, principalType: "agent", principalId: agentId, permissionKey: "company_scope:read" },
      ]).onConflictDoNothing();
      privateRootTask = privateTask as typeof issues.$inferSelect;
      privateRootMemoryActor = sourceActor;
    }
    const createTaskResponse = await request(humanApp).post(`/api/companies/${companyId}/issues`)
      .send({ title: "Save a private source-bound note", description: "Create a short internal note and finish the task.",
        responsibleUserId: aliceUserId });
    expect(createTaskResponse.status, JSON.stringify(createTaskResponse.body)).toBe(201);
    const createdTask = createTaskResponse.body as { id: string };
    await db.update(issues).set({ status: "todo", assigneeAgentId: agentId,
      ...(fixtureProjectId ? { projectId: fixtureProjectId } : {}) })
      .where(and(eq(issues.companyId, companyId), eq(issues.id, createdTask.id)));
    const task = (await db.select().from(issues).where(eq(issues.id, createdTask.id)))[0]!;
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId, responsibleUserId: aliceUserId,
      status: "running", runtimeMode: "native", nativeIssueId: task.id, contextSnapshot: { issueId: task.id } }).returning();
    const localEnvironment = await environmentService(db).ensureLocalEnvironment();
    const runtimeEnvironment = environmentRuntimeService(db);
    const acquiredEnvironment = await runtimeEnvironment.acquireRunLease({ companyId, environment: localEnvironment,
      issueId: task.id, agentId, heartbeatRunId: run!.id, persistedExecutionWorkspace: null,
      executionWorkspaceSettings: null, adapterType: "paperclip_runner" });
    const contextProbe = postgres(input.connectionString, { max: 1, connect_timeout: 3 });
    const contextPrepareStartedAt = Date.now();
    let manifest: Awaited<ReturnType<ReturnType<typeof agentRuntimeFabricService>["prepare"]>>;
    try {
      manifest = await agentRuntimeFabricService(db).prepare({ companyId, agentId, runId: run!.id,
        responsibleUserId: aliceUserId, issueId: task.id, query: task.title });
    } catch (error) {
      let postgresWaitFacts: unknown = { available: false };
      try {
        const [sample] = await contextProbe<{ active: number; idleInTransaction: number; waiters: Array<{
          waitEventType: string | null; waitEvent: string | null; blockedByCount: number; queryKind: string;
        }> }[]>`
          select count(*) filter (where state = 'active')::int as active,
            count(*) filter (where state = 'idle in transaction')::int as "idleInTransaction",
            coalesce(json_agg(json_build_object('waitEventType', wait_event_type, 'waitEvent', wait_event,
              'blockedByCount', cardinality(pg_blocking_pids(pid)),
              'queryKind', case when query ilike '%context_manifest%' then 'context_manifest'
                when query ilike '%memory_records%' then 'memory_records'
                when query ilike '%issues%' then 'issues'
                when query ilike '%heartbeat_runs%' then 'heartbeat_runs'
                else lower(split_part(query, ' ', 1)) end))
              filter (where state = 'active' and wait_event_type is not null), '[]'::json) as waiters
          from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
        `;
        postgresWaitFacts = sample ?? { available: false };
      } catch { /* Bounded diagnostic: never mask the context failure with probe failure. */ }
      const errorRecord = error && typeof error === "object" ? error as Record<string, unknown> : {};
      const details = errorRecord.details && typeof errorRecord.details === "object"
        ? errorRecord.details as Record<string, unknown> : {};
      const safeContextFailure = {
        code: typeof details.code === "string" ? details.code : "unknown",
        stage: typeof details.stage === "string" ? details.stage : "unknown",
        reason: typeof details.reason === "string" ? details.reason : "unknown",
      };
      throw new Error(`managed_fixture_context_prepare_failed ${JSON.stringify({ elapsedMs: Date.now() - contextPrepareStartedAt,
        failure: safeContextFailure, postgresWaitFacts })}`, { cause: error });
    } finally {
      await contextProbe.end({ timeout: 1 });
    }
    const plan = await orchestrationService(db).create(human, companyId, {
      issueId: task.id, expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", actionClass: "internal_draft", riskClass: "C0",
      completionContract: { objective: "Complete the managed source-bound task", requiredOutputs: (() => {
        const keys = modelSteps.filter(step => step.tool === "write_document")
          .map(step => step.input?.key).filter((key): key is string => typeof key === "string");
        return keys.map(key => ({ key }));
      })(),
        businessInvariants: ["Use only this task's private workspace"] },
      budgets: { maxModelCostMinor: Math.max(10, modelSteps.length * 2), maxToolActions: modelSteps.length + 2 },
      workers: [{ key: "writer", issueId: task.id }],
    });
    await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(),
      executionPrincipal: { type: "user", userId: aliceUserId } }).where(eq(orchestrationPlans.id, plan.id));
    const [worker] = await db.update(orchestrationWorkers).set({ status: "running", attemptCount: 1 })
      .where(eq(orchestrationWorkers.planId, plan.id)).returning();
    await db.insert(orchestrationWorkerAttempts).values({ companyId, planId: plan.id, workerId: worker!.id,
      agentId, runId: run!.id, executionManifestId: manifest!.record.id, attempt: 1 });
    await db.update(issues).set({ status: "in_progress", executionRunId: run!.id })
      .where(and(eq(issues.companyId, companyId), eq(issues.id, task.id)));
    const [contractRow] = await db.select().from(completionContracts)
      .where(and(eq(completionContracts.companyId, companyId), eq(completionContracts.issueId, task.id)));
    if (!contractRow) throw new Error("Native completion contract was not persisted.");
    const prepared = await prepareNativeHeartbeatRun({ db, run: run!, issue: task, environmentLeaseId: acquiredEnvironment.lease.id });
    const managedOpenCodeRunHome = managedOpenCodeRuntimeDirectory({ companyId, runId: run!.id });
    const expectedOpenCodeDataHome = () => {
      const actualSessionId = configDirectory
        ? basename(dirname(dirname(configDirectory)))
        : prepared.normalizedSessionId;
      return join(managedOpenCodeRunHome, actualSessionId, "data");
    };
    let runtimeInputs: NativePayloadSourceInput[] = [];
    const agent = (await db.select().from(agents).where(eq(agents.id, agentId)))[0]!;
    const runtimeContext = await buildRetainedNativeRuntimeContext({ db, agent, runId: run!.id,
      runtimeConfig: {}, runtimeSkillEntries: [], onAuthoredSourceCapture: (capture) => { runtimeInputs = capture.inputs; } });
    const taskCapture: { value: { input: NativePayloadSourceInput; payloadSourceSnapshot: unknown } | null } = { value: null };
    const selectedTask = await getIssueExecutionContext(db, companyId, task.id, capture => { taskCapture.value = capture; });
    const taskSource = taskCapture.value;
    if (!selectedTask || !taskSource || taskSource.input.kind !== "task") throw new Error("Current task source capture is unavailable.");
    const renderedReferences: Array<{ kind: "task" | "comment" | "document_revision" | "attachment" | "unknown"; id: string }> = [];
    const taskPrompt = buildPaperclipTaskMarkdown({ issue: { id: task.id, identifier: selectedTask.identifier,
      title: selectedTask.title, description: selectedTask.description, workMode: selectedTask.workMode } },
    { onRenderedSource: source => renderedReferences.push(source) });
    if (!taskPrompt) throw new Error("Canonical task renderer returned no source-bound prompt.");
    const completionContract = nativeCompletionContractInput(contractRow.contractJson);
    const agentWorkspace = resolveDefaultAgentWorkspaceDir(agentId);
    await mkdir(agentWorkspace, { recursive: true, mode: 0o700 });
    const workspace = { id: run!.id, cwd: agentWorkspace, repoUrl: null, repoRef: null, branchName: null };
    const execution = buildNativeExecutionInput({ companyId, runId: run!.id, agentId,
      issue: { id: task.id, identifier: selectedTask.identifier, title: selectedTask.title,
        description: selectedTask.description, workMode: selectedTask.workMode }, taskPrompt,
      workspace, normalizedSessionId: prepared.normalizedSessionId, provider: "opencode", model: `anthropic/${model}`,
      lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null },
      completionContract: { id: contractRow.id, sha256: contractRow.canonicalSha256,
        schemaVersion: contractRow.schemaVersion, contract: completionContract }, runtimeContext });
    const managedTaskEnvelope = createCodexTaskEnvelope({
      objective: execution.completionContract.contract.objective,
      contractRevision: execution.completionContract.contract.revision,
      criteria: execution.completionContract.contract.criteria,
      constraints: ["Work only inside the supplied working directory.", ...nativeTaskConstraints(execution),
        "Return one semantic completion result through paperclip_finish or paperclip_block."],
    });
    const canonicalManagedPrompt = JSON.stringify({ task: managedTaskEnvelope,
      message: JSON.stringify(buildNativeModelEnvelope(execution)) });
    const canonicalManagedPromptHash = canonicalHash(canonicalManagedPrompt);
    const sourceSet = buildNativeBootstrapSourceSet({ companyId, runId: run!.id, agentId, issueId: task.id,
      renderedMarkdown: taskPrompt, renderedMarkdownDigest: createHash("sha256").update(taskPrompt, "utf8").digest("hex"),
      references: renderedReferences, candidates: [{ kind: "task", id: task.id, input: taskSource.input,
        payloadSourceSnapshot: taskSource.payloadSourceSnapshot }], runtimeInputs,
      additionalInputs: [
        { kind: "completion_contract", issueId: task.id, contractId: contractRow.id,
          revision: String(contractRow.revision), contentHash: contractRow.canonicalSha256 },
        { kind: "workspace_metadata", runId: run!.id, executionWorkspaceId: execution.binding.executionWorkspaceId,
          origin: "agent_home", sourceVersion: `agent-home:${agentId}:v1`,
          contentHash: createHash("sha256").update(JSON.stringify({ cwd: execution.workspace.cwd,
            repoUrl: execution.workspace.repoUrl, repoRef: execution.workspace.repoRef,
            branchName: execution.workspace.branchName }), "utf8").digest("hex") },
      ], contextManifestIds: [], rolePackInputs: [], unsupportedInputPresent: false });
    if (!sourceSet) throw new Error("Canonical source collector did not close the task input.");
    const bootstrapSourceClosure = { sourceSet,
      taskEnvelopeDigest: nativeSha256(execution.task) };
    const profileBlob = { ...(run!.runnerProfileJson as Record<string, unknown>), nativeExecutionInput: execution };
    await db.update(heartbeatRuns).set({ runnerProfileJson: profileBlob }).where(eq(heartbeatRuns.id, run!.id));
    const leaseOwner = `managed-opencode-e2e:${randomUUID()}`;
    const controller = await currentNativeControllerIdentity();
    await db.insert(nativeRunFinalizations).values({ runId: run!.id, companyId, issueId: task.id,
      phase: "running", attempt: 1, leaseOwner, leaseExpiresAt: new Date(Date.now() + 120_000),
      controllerBootId: controller.bootId, controllerPid: controller.pid,
      controllerProcessStartedAt: controller.processStartedAt });

    let responseCount = 0;
    const fakeFetchEntrances: Array<{ host: string; path: string; apiKeyHeader: boolean; bearerHeader: boolean }> = [];
    let qualifiedManagedProcessAtFirstProviderRequest = false;
    const modelCalls: Array<Record<string, unknown>> = [];
    const contextResultConsumers: Array<{ callId: string; consumed: boolean }> = [];
    const projectApiResultConsumers: Array<{ callId: string; consumed: boolean; contentDigest: string | null }> = [];
    const brokerRequests: string[] = [];
    const brokerFailureFacts = () => brokerRequests
      .filter(value => !value.startsWith("managed-tool-schema-comparison ")).slice(-40);
    const submittedPromptFacts: Array<{ length: number; sha256: string }> = [];
    let managedConfigReadOnlyVerified = false;
    const assignedToolGateway = createToolGatewayService(db);
    registerAssignedMcpGateway(db, assignedToolGateway, scopedDb => createToolGatewayService(scopedDb));
    expect(getAssignedMcpGateway(db)).toBe(assignedToolGateway);
    await db.insert(toolPolicies).values({ companyId,
      name: `Managed OpenCode fixture Memory policy ${randomUUID()}`,
      policyType: "allow", selectors: { toolName: "paperclip-self:remember" } });
    const gateway = workerModelGateway(db, {
      profiles: [profile], sourceSha, protectedEvidenceOrigin: "https://protected.test.invalid",
      fetch: async (url, init) => {
        const requestUrl = new URL(String(url));
        const requestHeaders = new Headers(init.headers);
        fakeFetchEntrances.push({ host: requestUrl.host, path: requestUrl.pathname,
          apiKeyHeader: requestHeaders.has("x-api-key"), bearerHeader: requestHeaders.has("authorization") });
        expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
        expect(requestHeaders.get("x-api-key")).toBe(credential);
        if (responseCount === 0) {
          qualifiedManagedProcessAtFirstProviderRequest = openCodeProcessFacts.some(fact => fact.shaMatchesQualifiedBinary &&
            fact.managedEnvironment.dataHomeMatchesManagedRun);
        }
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        modelCalls.push(body);
        responseCount += 1;
        if (responseCount > 1 && modelSteps[responseCount - 2]?.tool === "read_context") {
          const previousStep = modelSteps[responseCount - 2]!;
          const callId = previousStep.id ?? `managed-e2e-${previousStep.tool}-${responseCount - 2}`;
          const messages = Array.isArray(body.messages) ? body.messages : [];
          const toolResults = messages.flatMap(message => {
            if (!message || typeof message !== "object") return [];
            const content = (message as Record<string, unknown>).content;
            return Array.isArray(content) ? content : [];
          }).filter(block => block && typeof block === "object") as Array<Record<string, unknown>>;
          contextResultConsumers.push({ callId, consumed: toolResults.some(block =>
            block.type === "tool_result" && block.tool_use_id === callId && block.is_error !== true &&
            (typeof block.content === "string" || Array.isArray(block.content))) });
        }
        if (responseCount > 1 && modelSteps[responseCount - 2]?.tool === "call_api") {
          const previousStep = modelSteps[responseCount - 2]!;
          const callId = previousStep.id ?? `managed-e2e-${previousStep.tool}-${responseCount - 2}`;
          const messages = Array.isArray(body.messages) ? body.messages : [];
          const toolResults = messages.flatMap(message => {
            if (!message || typeof message !== "object") return [];
            const content = (message as Record<string, unknown>).content;
            return Array.isArray(content) ? content : [];
          }).filter(block => block && typeof block === "object") as Array<Record<string, unknown>>;
          const matching = toolResults.filter(block => block.type === "tool_result" && block.tool_use_id === callId);
          let contentDigest: string | null = null;
          const content = matching.length === 1 ? matching[0]!.content : null;
          if (typeof content === "string") {
            try {
              const parsed = JSON.parse(content) as unknown;
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
                contentDigest = createHash("sha256").update(JSON.stringify(parsed), "utf8").digest("hex");
            } catch { /* Keep only bounded digest evidence, never provider content. */ }
          }
          projectApiResultConsumers.push({ callId, consumed: matching.length === 1 && matching[0]!.is_error !== true &&
            typeof content === "string", contentDigest });
        }
        const tools = (body.tools as Array<Record<string, unknown>>) ?? [];
        const step = modelSteps[responseCount - 1];
        if (!step) throw new Error("Managed fixture provider exhausted its configured model steps.");
        if (step.tool === "read_context") {
          pendingContextProbeCallId = step.id ?? `managed-e2e-${step.tool}-${responseCount - 1}`;
          pendingContextProbeStartedAt = Date.now();
          if (pgMonitorTimer) {
            clearInterval(pgMonitorTimer);
            pgMonitorTimer = undefined;
          }
          if (contextProbeTimer) clearInterval(contextProbeTimer);
          if (contextInvocationWatchTimer) clearInterval(contextInvocationWatchTimer);
          contextInvocationWatchTimer = setInterval(() => { void watchContextInvocation(); }, 50);
          void watchContextInvocation();
        }
        const findTool = (name: ManagedNativeOpenCodeModelStep["tool"]) => tools.find(tool => {
          if (name === "paperclip_finish") return tool.name === "paperclip_finish" || toolName(tool.name) === "finish";
          return toolName(tool.name) === name;
        });
        if (step.tool === "call_api") {
          if (!fixtureProjectId) throw new Error("managed_fixture_project_read_not_prepared");
          const apiTool = findTool("call_api");
          expect(apiTool?.input_schema).toEqual({ type: "object", additionalProperties: false,
            properties: { operationId: { type: "string", enum: ["GET /api/projects/{id}"] },
              pathParams: { type: "object", additionalProperties: false,
                properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } },
            required: ["operationId", "pathParams"] });
        }
        if (step.tool === "paperclip_finish") {
          const finish = findTool(step.tool);
          if (!finish) throw new Error("OpenCode wire omitted paperclip_finish.");
          const finishInput = {
            schema: "paperclip.run_result.v1", reportedWorkDisposition: "done", summary: "The managed task is complete.",
            completionClaim: { contractRevision: String(contractRow.revision), objectiveSatisfied: true,
              criteria: completionContract.criteria.map(criterion => ({ criterionId: criterion.id, status: "satisfied", evidenceRefs: [] })),
              remainingWork: [] }, evidence: [], verification: [], attentionRequests: [], artifacts: [],
          };
          return new Response(JSON.stringify({ id: `msg_managed_e2e_${responseCount}`, type: "message", role: "assistant", model, stop_reason: "tool_use",
            content: [{ type: "tool_use", id: step.id ?? `managed-e2e-finish-${responseCount}`, name: finish.name, input: finishInput }],
            usage: { input_tokens: 160, output_tokens: 38 } }), { status: 200, headers: { "content-type": "application/json" } });
        }
        const selected = findTool(step.tool);
        if (!selected) throw new Error(`OpenCode wire omitted the governed ${step.tool} tool.`);
        const modelToolInput = { ...(step.input ?? {}) };
        if (step.tool === "self_remember") {
          if (!managedMemoryBindingKey) throw new Error("managed_fixture_memory_binding_unavailable");
          if (modelToolInput.bindingKey !== undefined && modelToolInput.bindingKey !== managedMemoryBindingKey)
            throw new Error("managed_fixture_memory_binding_key_mismatch");
          modelToolInput.bindingKey = managedMemoryBindingKey;
        }
        if (step.tool === "call_api") {
          const pathParams = modelToolInput.pathParams && typeof modelToolInput.pathParams === "object" &&
            !Array.isArray(modelToolInput.pathParams) ? modelToolInput.pathParams as Record<string, unknown> : {};
          if (modelToolInput.operationId !== "GET /api/projects/{id}" ||
            (pathParams.id !== "fixture-project" && pathParams.id !== fixtureProjectId))
            throw new Error("managed_fixture_project_read_step_invalid");
          modelToolInput.pathParams = { id: fixtureProjectId };
        }
        return new Response(JSON.stringify({ id: "msg_managed_e2e_finish", type: "message", role: "assistant", model, stop_reason: "tool_use",
          content: [{ type: "tool_use", id: step.id ?? `managed-e2e-${step.tool}-${responseCount}`, name: selected.name, input: modelToolInput }],
          usage: { input_tokens: 120, output_tokens: 42 } }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const minted = await gateway.issueForRun({ companyId, agentId, runId: run!.id, responsibleUserId: aliceUserId });
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use(async (req, res, next) => {
      brokerRequests.push(`${req.method} ${req.path}`);
      res.on("finish", () => brokerRequests.push(`response ${req.method} ${req.path} ${res.statusCode}`));
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        brokerRequests.push(`response-body ${req.method} ${req.path} ${JSON.stringify(body)}`);
        return originalJson(body);
      }) as typeof res.json;
      if (req.method !== "POST" || req.path !== "/runtime-tools/model/v1/messages") {
        res.status(404).end();
        return;
      }
      const wire = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
      const messages = Array.isArray(wire.messages) ? wire.messages : [];
      // Run explicitly configured Human review actions after the actual tool
      // call has completed and before the next Messages request is qualified.
      // This is a real service action on the current Gateway result; it does
      // not create or edit any Native source receipt.
      const incomingToolResults = messages.flatMap(message => {
        if (!message || typeof message !== "object") return [];
        const content = (message as Record<string, unknown>).content;
        return Array.isArray(content) ? content : [];
      }).flatMap(block => {
        if (!block || typeof block !== "object") return [];
        const value = block as Record<string, unknown>;
        return value.type === "tool_result" && value.is_error !== true && typeof value.tool_use_id === "string"
          ? [value.tool_use_id] : [];
      });
      for (const action of input.humanActions ?? []) {
        const callId = action.afterModelToolCallId;
        const actionKey = `${action.action}:${callId}`;
        const step = modelSteps.find((value, index) =>
          (value.id ?? `managed-e2e-${value.tool}-${index}`) === callId);
        if (!incomingToolResults.includes(callId) || completedHumanActions.has(actionKey)) continue;
        if (step?.tool !== "self_remember" && !(step?.tool === "call_api" && action.action === "edit_project_workspace"))
          throw new Error("managed_fixture_human_action_unqualified");
        brokerRequests.push(`human-action started ${action.action}`);
        if (action.action === "edit_project_workspace") {
          if (!fixtureProjectId || !fixtureProjectWorkspaceId)
            throw new Error("managed_fixture_project_workspace_unavailable");
          const editedPath = join(root, "project-workspace-edited");
          await mkdir(editedPath, { recursive: true, mode: 0o700 });
          if (!fixtureProjectHumanCookie) throw new Error("managed_fixture_project_human_session_missing");
          const edited = await request(projectApiApp).patch(
            `/api/projects/${fixtureProjectId}/workspaces/${fixtureProjectWorkspaceId}`,
          ).set("cookie", fixtureProjectHumanCookie).send({ cwd: editedPath });
          if (edited.status !== 200) throw new Error(`managed_fixture_project_workspace_edit_failed_${edited.status}`);
        } else if (action.action === "accept_memory_candidate") {
          const [invocation] = await db.select({ workflowResultJson: toolInvocations.workflowResultJson,
            status: toolInvocations.status, toolName: toolInvocations.toolName })
            .from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId),
              eq(toolInvocations.idempotencyKey, `aw-native-tool:${run!.id}:${callId}`)));
          if (!invocation || invocation.status !== "succeeded" || invocation.toolName !== "paperclip-self:remember")
            throw new Error("managed_fixture_memory_candidate_invocation_unavailable");
          const wrapper = (typeof invocation.workflowResultJson === "string"
            ? JSON.parse(invocation.workflowResultJson) : invocation.workflowResultJson) as Record<string, unknown>;
          const data = wrapper.data && typeof wrapper.data === "object" && !Array.isArray(wrapper.data)
            ? wrapper.data as Record<string, unknown> : wrapper;
          const record = data.record && typeof data.record === "object" && !Array.isArray(data.record)
            ? data.record as Record<string, unknown> : {};
          if (typeof record.id !== "string" || !/^[0-9a-f-]{36}$/i.test(record.id) || record.reviewState !== "pending")
            throw new Error("managed_fixture_memory_candidate_unavailable");
          await memoryService(db).reviewCandidate(companyId, record.id, { decision: "accept" }, aliceMemoryActor);
          acceptedMemoryIds.push(record.id);
        } else {
          if (!input.privateContextContent || !privateRootTask || !privateRootBindingId || !privateRootMemoryActor || privateRootRef.current)
            throw new Error("managed_fixture_private_context_root_not_prepared");
          const task = await issueService(db).getById(privateRootTask.id);
          if (!task || task.visibility !== "private" || task.assigneeAgentId !== agentId ||
            task.responsibleUserId !== aliceUserId || task.updatedAt.toISOString() !== privateRootTask.updatedAt.toISOString())
            throw new Error("managed_fixture_private_context_task_changed");
          const observedAt = new Date();
          const excerpt = [`Status: ${task.status}`, `Priority: ${task.priority}`,
            task.description?.trim() ? `Description: ${task.description.trim()}` : null].filter(Boolean).join("\n").slice(0, 60_000);
          const candidate = await memoryService(db).createCandidate(companyId, {
            bindingId: privateRootBindingId, memoryType: "lesson", scope: { type: "company", id: null },
            subject: { type: "company", id: companyId }, ownerAgentId: null,
            title: "Human-provided private-context root", content: input.privateContextContent, summary: null,
            sensitivity: "internal", importance: 50, confidenceScore: 0.8, validFrom: null, validUntil: null,
            observedAt: observedAt.toISOString(), retentionPolicy: "standard", expiresAt: null,
            createdByOperationId: null, metadata: {},
            evidence: [{ sourceClass: "task", sourceProvider: "august_works_tasks", sourceType: "issue",
              sourceRef: `issue://${task.id}`, sourceVersion: task.updatedAt.toISOString(),
              sourceUpdatedAt: task.updatedAt.toISOString(), observedAt: observedAt.toISOString(),
              excerptHash: createHash("sha256").update(excerpt).digest("hex"),
              citation: { label: `${task.identifier}: ${task.title}` }, trustLevel: "low", relation: "supports" }],
          }, privateRootMemoryActor);
          const accepted = await memoryService(db).reviewCandidate(companyId,
            candidate.record.id, { decision: "accept" }, privateRootMemoryActor);
          if (!(await memoryService(db).get(companyId, accepted.record.id, privateRootMemoryActor)) ||
            await memoryService(db).get(companyId, accepted.record.id, bobMemoryActor))
            throw new Error("managed_fixture_private_context_memory_acl_invalid");
          privateRootRef.current = { issueId: task.id, memoryId: accepted.record.id,
            content: input.privateContextContent, memoryActor: privateRootMemoryActor };
        }
        completedHumanActions.add(actionKey);
        brokerRequests.push(`human-action completed ${action.action}`);
      }
      const tools = Array.isArray(wire.tools) ? wire.tools : [];
      const currentCaptureRows = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson })
        .from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id)).catch(() => []);
      const currentCaptureRun = currentCaptureRows[0];
      const currentCaptureProfile = currentCaptureRun?.runnerProfileJson && typeof currentCaptureRun.runnerProfileJson === "object"
        ? currentCaptureRun.runnerProfileJson as Record<string, unknown> : {};
      const currentCaptures = Array.isArray(currentCaptureProfile.nativeToolResultSourceCaptures)
        ? currentCaptureProfile.nativeToolResultSourceCaptures.map(value => value && typeof value === "object"
          ? value as Record<string, unknown> : {}) : [];
      const toolResultFacts = messages.flatMap(message => {
        const item = message && typeof message === "object" ? message as Record<string, unknown> : {};
        return (Array.isArray(item.content) ? item.content : []).flatMap(block => {
          const value = block && typeof block === "object" ? block as Record<string, unknown> : {};
          if (value.type !== "tool_result") return [];
          const toolUseId = typeof value.tool_use_id === "string" ? value.tool_use_id : "";
          const priorCaptures = currentCaptures.filter(capture => capture.managedOpenCode === true && capture.callId === toolUseId);
          return [{ isError: value.is_error === true, contentType: typeof value.content,
            contentBlockTypes: Array.isArray(value.content) ? value.content.map(part => part && typeof part === "object"
              ? (part as Record<string, unknown>).type : "other") : [],
            resultShape: safeToolResultShape(value.content),
            capturePresent: priorCaptures.length > 0,
            captureTools: priorCaptures.map(capture => typeof capture.tool === "string" ? capture.tool : "other"),
            staticErrorCodes: staticManagedErrorCodes(value.content),
            managedMemoryBoundary: managedMemoryBoundaryFacts(value.content) }];
        });
      });
      const shape = {
        keys: Object.keys(wire).sort(), model: wire.model, max_tokens: wire.max_tokens, stream: wire.stream,
        messages: messages.map((message) => {
          const item = message && typeof message === "object" ? message as Record<string, unknown> : {};
          const content = Array.isArray(item.content) ? item.content : null;
          return { role: item.role, contentType: typeof item.content,
            blocks: content?.map((block) => {
              const value = block && typeof block === "object" ? block as Record<string, unknown> : {};
              return { type: value.type, keys: Object.keys(value).sort() };
            }) ?? null };
        }),
        tools: tools.map((tool) => tool && typeof tool === "object"
          ? { keys: Object.keys(tool as Record<string, unknown>).sort(), name: (tool as Record<string, unknown>).name }
          : { kind: typeof tool }),
        toolChoice: wire.tool_choice && typeof wire.tool_choice === "object"
          ? { keys: Object.keys(wire.tool_choice as Record<string, unknown>).sort(), type: (wire.tool_choice as Record<string, unknown>).type }
          : wire.tool_choice,
      };
      brokerRequests.push(`managed-request-shape ${JSON.stringify({ ...shape, toolResultFacts })}`);
      // Test TLS mediation stands in for OpenShell host injection. Only the
      // exact Messages endpoint receives a capability minted by issueForRun;
      // the OpenCode child receives no bearer token in its environment.
      const continueRequest = async () => {
        const [persisted] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson })
          .from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
        const profileBlob = persisted?.runnerProfileJson && typeof persisted.runnerProfileJson === "object"
          ? persisted.runnerProfileJson as Record<string, unknown> : {};
        const authority = profileBlob.nativeOpenCodeSourceAuthority && typeof profileBlob.nativeOpenCodeSourceAuthority === "object"
          ? profileBlob.nativeOpenCodeSourceAuthority as Record<string, unknown> : {};
        const nativeReceipt = nativeRunInputSourceReceiptSchema.safeParse(profileBlob.nativeInputSourceReceipt);
        const wireIntents = profileBlob.nativeAwModelWireIntents;
        const expected = Array.isArray(authority.toolSchemas) ? authority.toolSchemas.map(value =>
          value && typeof value === "object" ? value as Record<string, unknown> : {}) : [];
        const actual = tools.map(value => value && typeof value === "object" ? value as Record<string, unknown> : {});
        const authorizedPromptHashes = Array.isArray(authority.authorizedPromptHashes)
          ? authority.authorizedPromptHashes.filter((value): value is string => typeof value === "string") : [];
        const userTextFacts = messages.flatMap(message => {
          const item = message && typeof message === "object" ? message as Record<string, unknown> : {};
          if (item.role !== "user") return [];
          const content = Array.isArray(item.content) ? item.content : [];
          return content.flatMap(block => {
            const value = block && typeof block === "object" ? block as Record<string, unknown> : {};
            return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
          });
        }).map((value, index) => ({ index, length: value.length, matchesAuthorizedPrompt: authorizedPromptHashes.includes(
          canonicalHash(value)),
          matchesCanonicalExecutionPrompt: canonicalHash(value) === canonicalManagedPromptHash,
          matchesSubmittedPrompt: submittedPromptFacts.some(prompt => prompt.sha256 === canonicalHash(value)),
          jsonShape: (() => {
            try {
              const parsed = JSON.parse(value) as Record<string, unknown>;
              const task = parsed.task && typeof parsed.task === "object" ? parsed.task as Record<string, unknown> : {};
              const messageText = parsed.message;
              let nestedMessageShape: string[] = [];
              if (typeof messageText === "string") {
                try {
                  const nested = JSON.parse(messageText) as Record<string, unknown>;
                  nestedMessageShape = Object.keys(nested).sort();
                } catch { /* shape only; malformed data is denied by the route */ }
              }
              return { topLevelKeys: Object.keys(parsed).sort(), taskKeys: Object.keys(task).sort(),
                messageType: typeof messageText, messageLength: typeof messageText === "string" ? messageText.length : null,
                nestedMessageKeys: nestedMessageShape };
            } catch { return { parseable: false }; }
          })() }));
        const schemaComparison = expected.map(schema => {
          const actualSchema = actual.find(candidate => toolName(candidate.name) === schema.name);
          const expectedInput = schema.inputSchema;
          const actualInput = actualSchema?.input_schema;
          return { name: schema.name,
            descriptionEqual: actualSchema?.description === schema.description,
            expectedDescriptionPresent: typeof schema.description === "string",
            actualDescriptionPresent: typeof actualSchema?.description === "string",
            expectedDescriptionLength: typeof schema.description === "string" ? schema.description.length : null,
            actualDescriptionLength: typeof actualSchema?.description === "string" ? actualSchema.description.length : null,
            expectedDescriptionPrefixesActual: typeof schema.description === "string" && typeof actualSchema?.description === "string"
              ? schema.description.startsWith(actualSchema.description) : null,
            actualDescriptionPrefixesExpected: typeof schema.description === "string" && typeof actualSchema?.description === "string"
              ? actualSchema.description.startsWith(schema.description) : null,
            schemaEqual: canonicalHash(expectedInput) === canonicalHash(actualInput),
            expectedSchemaKeys: expectedInput && typeof expectedInput === "object" ? Object.keys(expectedInput).sort() : [],
            actualSchemaKeys: actualInput && typeof actualInput === "object" ? Object.keys(actualInput).sort() : [],
            descriptionDiffPaths: differencePaths(schema.description, actualSchema?.description, "description"),
            schemaDiffPaths: differencePaths(expectedInput, actualInput, "input_schema"),
            expectedAdditionalProperties: expectedInput && typeof expectedInput === "object"
              ? valueCategory((expectedInput as Record<string, unknown>).additionalProperties) : "absent",
            actualAdditionalProperties: actualInput && typeof actualInput === "object"
              ? valueCategory((actualInput as Record<string, unknown>).additionalProperties) : "absent",
            expectedSchemaHash: canonicalHash(expectedInput), actualSchemaHash: canonicalHash(actualInput) };
        });
        brokerRequests.push(`managed-tool-schema-comparison ${JSON.stringify({ expectedNames: expected.map(schema => schema.name),
          actualNames: actual.map(schema => toolName(schema.name)), tools: schemaComparison, userTextFacts,
          nativeReceiptPresent: nativeReceipt.success,
          bootstrapSourceKinds: nativeReceipt.success ? nativeReceipt.data.bootstrap.inputs.map(source => source.kind).sort() : [],
          nativeReceiptDispatchCount: nativeReceipt.success ? nativeReceipt.data.dispatches.length : null,
          wireIntentArray: Array.isArray(wireIntents), wireIntentCount: Array.isArray(wireIntents) ? wireIntents.length : null,
          toolResultCaptureCount: Array.isArray(profileBlob.nativeToolResultSourceCaptures)
            ? profileBlob.nativeToolResultSourceCaptures.length : null,
          submittedPromptFacts: submittedPromptFacts.map(prompt => ({ length: prompt.length,
            matchesAuthorizedPrompt: authorizedPromptHashes.includes(prompt.sha256),
            matchesCanonicalExecutionPrompt: prompt.sha256 === canonicalManagedPromptHash,
            matchesWireText: userTextFacts.some(fact => fact.length === prompt.length && fact.matchesSubmittedPrompt) })),
          authorizedPromptCount: authorizedPromptHashes.length, canonicalManagedPromptLength: canonicalManagedPrompt.length,
          authorityContainsCanonicalPrompt: authorizedPromptHashes.includes(canonicalManagedPromptHash) })}`);
        req.headers.authorization = `Bearer ${minted.token}`;
        next();
      };
      if (managedConfigReadOnlyVerified) void continueRequest().catch(next);
      else void assertManagedConfigIsReadOnlyBeforeSpawn().then(() => {
        managedConfigReadOnlyVerified = true;
        return continueRequest();
      }).catch(next);
    });
    app.use(runtimeConnectionIntentRoutes(db, gateway));
    app.use((error: unknown, req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const name = error instanceof Error ? error.name : "UnknownError";
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack?.split("\n").slice(1, 5).join(" | ") : "";
      brokerRequests.push(`route-error ${req.method} ${req.path} ${name}: ${message} ${stack}`);
      if (message === "Current Native human, internal draft Task, worker attempt and manifest required") {
        void (async () => {
          const [currentPlan] = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id));
          const [currentWorker] = await db.select().from(orchestrationWorkers).where(eq(orchestrationWorkers.id, worker!.id));
          const [currentAttempt] = await db.select().from(orchestrationWorkerAttempts)
            .where(eq(orchestrationWorkerAttempts.runId, run!.id));
          const [currentRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
          const [currentManifest] = await db.select().from(agentExecutionManifests)
            .where(eq(agentExecutionManifests.id, manifest!.record.id));
          const [currentTask] = await db.select().from(issues).where(eq(issues.id, task.id));
          const [currentRoot] = await db.select().from(issues).where(eq(issues.id, plan.issueId));
          const [currentAgent] = await db.select().from(agents).where(eq(agents.id, agentId));
          const [currentCompany] = await db.select().from(companies).where(eq(companies.id, companyId));
          const [currentIdentity] = currentAgent?.agentIdentityId
            ? await db.select().from(agentIdentities).where(eq(agentIdentities.id, currentAgent.agentIdentityId)) : [];
          const workflowErrorCodes = (value: unknown, depth = 0): string[] => {
            if (depth > 4 || !value || typeof value !== "object" || Array.isArray(value)) return [];
            const row = value as Record<string, unknown>;
            const result: string[] = [];
            for (const key of ["errorCode", "code"]) {
              const code = safeCode(row[key]);
              if (code) result.push(code);
            }
            for (const key of ["error", "record", "result", "data"]) result.push(...workflowErrorCodes(row[key], depth + 1));
            return [...new Set(result)];
          };
          const memoryInvocationRows = await db.select({ toolName: toolInvocations.toolName,
            status: toolInvocations.status, policyDecision: toolInvocations.policyDecision,
            approvalState: toolInvocations.approvalState, errorCode: toolInvocations.errorCode,
            workflowResultJson: toolInvocations.workflowResultJson })
            .from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId), eq(toolInvocations.runId, run!.id)));
          const memoryInvocationFacts = memoryInvocationRows.filter(value => value.toolName === "paperclip-self:remember")
            .map(value => {
              const parsed = typeof value.workflowResultJson === "string"
                ? (() => { try { return JSON.parse(value.workflowResultJson); } catch { return null; } })()
                : value.workflowResultJson;
              return { status: value.status, policyDecision: value.policyDecision,
                approvalState: value.approvalState, errorCode: safeCode(value.errorCode),
                resultTopLevelKeys: parsed && typeof parsed === "object" && !Array.isArray(parsed)
                  ? Object.keys(parsed as Record<string, unknown>).sort() : [],
                resultErrorCodes: workflowErrorCodes(parsed) };
            });
          const recentMemoryRows = await db.select({ reviewState: memoryRecords.reviewState,
            retentionState: memoryRecords.retentionState, deleted: memoryRecords.deletedAt,
            revoked: memoryRecords.revokedAt })
            .from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId),
              eq(memoryRecords.ownerAgentId, agentId), gte(memoryRecords.createdAt, run!.createdAt)));
          const fenceActivities = await db.select({ action: activityLog.action, details: activityLog.details })
            .from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.runId, run!.id)));
          const supervisionRows = await db.select({ reasonCode: supervisionInterventions.reasonCode,
            status: supervisionInterventions.status, lastErrorCode: supervisionInterventions.lastErrorCode })
            .from(supervisionInterventions).where(and(eq(supervisionInterventions.companyId, companyId),
              eq(supervisionInterventions.planId, plan.id)));
          const executionScope = currentManifest?.manifest.executionScope;
          const expectedPlanVersion = workerModelClaims.expectedPlanVersion;
          brokerRequests.push(`current-model-authority-facts ${JSON.stringify({
            planStatus: currentPlan?.status, planStarted: currentPlan?.startedAt instanceof Date,
            planVersionMatches: currentPlan?.version === expectedPlanVersion,
            planActionClass: currentPlan?.actionClass, planRiskClass: currentPlan?.riskClass,
            planPrincipalMatches: currentPlan?.executionPrincipal?.type === "user" &&
              currentPlan.executionPrincipal.userId === aliceUserId,
            planCostBudgetConfigured: currentPlan?.budgets.maxModelCostMinor !== null && currentPlan?.budgets.maxModelCostMinor !== undefined,
            workerStatus: currentWorker?.status, workerAgentMatches: currentWorker?.agentId === agentId,
            attemptStatus: currentAttempt?.status, attemptAgentMatches: currentAttempt?.agentId === agentId,
            attemptRunMatches: currentAttempt?.runId === run!.id,
            attemptManifestMatches: currentAttempt?.executionManifestId === manifest!.record.id,
            runStatus: currentRun?.status, runNative: currentRun?.runtimeMode === "native",
            runTaskMatches: currentRun?.nativeIssueId === task.id, runHumanMatches: currentRun?.responsibleUserId === aliceUserId,
            manifestHumanMatches: currentManifest?.manifest.responsibleUserId === aliceUserId,
            manifestScopesCompanyScoped: !!executionScope?.delegatedScopes.every(scope => scope.companyId === companyId),
            taskHidden: currentTask?.hiddenAt !== null && currentTask?.hiddenAt !== undefined,
            taskStatusAllowed: !!currentTask && !["done", "cancelled"].includes(currentTask.status),
            taskAgentMatches: currentTask?.assigneeAgentId === agentId, taskRunMatches: currentTask?.executionRunId === run!.id,
            taskCheckoutMatches: !currentTask?.checkoutRunId || currentTask.checkoutRunId === run!.id,
            rootHidden: currentRoot?.hiddenAt !== null && currentRoot?.hiddenAt !== undefined,
            rootStatusAllowed: !!currentRoot && !["done", "cancelled"].includes(currentRoot.status),
            delegationDepthAllowed: !!currentTask && !!currentRoot &&
              currentTask.requestDepth - currentRoot.requestDepth <= (currentPlan?.budgets.maxDelegationDepth ?? -1),
            agentStatusAllowed: !!currentAgent && ["idle", "running"].includes(currentAgent.status),
            companyActive: currentCompany?.status === "active", identityActive: currentIdentity?.status === "active",
            outputInvocationStatuses: (await db.select({ toolName: toolInvocations.toolName, status: toolInvocations.status })
              .from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId), eq(toolInvocations.runId, run!.id))))
              .map(value => ({ tool: value.toolName, status: value.status })),
            memoryInvocationFacts,
            memoryRows: { count: recentMemoryRows.length,
              states: recentMemoryRows.map(value => ({ reviewState: value.reviewState,
                retentionState: value.retentionState, deleted: value.deleted !== null, revoked: value.revoked !== null })) },
            fenceReasonCodes: fenceActivities.flatMap(value => {
              const details = value.details && typeof value.details === "object" ? value.details : {};
              const code = safeCode(details.reasonCode);
              return code && /(?:fenc|pause|supervision)/i.test(value.action) ? [code] : [];
            }),
            supervisionReasons: supervisionRows.map(value => ({ reasonCode: safeCode(value.reasonCode),
              status: value.status, lastErrorCode: safeCode(value.lastErrorCode) })),
          })}`);
        })().then(() => next(error), next);
        return;
      }
      next(error);
    });
    app.use(errorHandler);
    const broker = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, app);
    await new Promise<void>((resolveListen, reject) => {
      broker.once("error", reject);
      broker.listen(0, "127.0.0.1", () => { broker.off("error", reject); resolveListen(); });
    });
    const address = broker.address();
    if (!address || typeof address === "string") throw new Error("Expected local HTTPS listener.");
    setupRunnerPrpWebSocketServer(broker, { apiUrl: `https://127.0.0.1:${address.port}` });
    let apiServer: ReturnType<typeof createHttpServer> | null = null;
    const originalPaperclipApiUrl = process.env.PAPERCLIP_API_URL;
    if (includesProjectApiRead) {
      apiServer = createHttpServer(projectApiApp);
      await new Promise<void>((resolveListen, reject) => {
        apiServer!.once("error", reject);
        apiServer!.listen(0, "127.0.0.1", () => { apiServer!.off("error", reject); resolveListen(); });
      });
      const apiAddress = apiServer.address();
      if (!apiAddress || typeof apiAddress === "string") throw new Error("Expected local Project API listener.");
      process.env.PAPERCLIP_API_URL = `http://127.0.0.1:${apiAddress.port}`;
    }
    const runnerEnvironment = { PATH: `${dirname(opencodeBinary)}:${process.env.PATH ?? ""}`, SSL_CERT_FILE: certBundlePath,
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND: String(profile.inputTokensUpperBound),
      PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS: String(profile.maxOutputTokens),
      PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: `https://127.0.0.1:${address.port}` };
    const qualifiedOpenCodeSha256 = createHash("sha256")
      .update(await readFile(opencodeBinary)).digest("hex");
    const diagnostics: string[] = [];
    const openCodeProcessFacts: Array<{ shaMatchesQualifiedBinary: boolean; managedEnvironment: Record<string, boolean> }> = [];
    const capabilityPayload = JSON.parse(Buffer.from(minted.token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    const workerModelClaims = capabilityPayload.worker_model && typeof capabilityPayload.worker_model === "object"
      ? capabilityPayload.worker_model as Record<string, unknown> : {};
    const [livePlan] = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id));
    const [liveWorker] = await db.select().from(orchestrationWorkers).where(eq(orchestrationWorkers.id, worker!.id));
    const [liveAttempt] = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.runId, run!.id));
    const [liveRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    const [liveManifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.id, manifest!.record.id));
    const liveTask = (await db.select().from(issues).where(eq(issues.id, task.id)))[0];
    const manifestBody = liveManifest?.manifest as Record<string, unknown> | undefined;
    const manifestPrincipal = manifestBody?.responsibleUserId;
    diagnostics.push(`governance fixture predicates: ${JSON.stringify({
      planStatus: livePlan?.status, planActionClass: livePlan?.actionClass, planRiskClass: livePlan?.riskClass,
      planStarted: livePlan?.startedAt instanceof Date, planUnexpired: livePlan?.startedAt instanceof Date &&
        Date.now() < livePlan.startedAt.getTime() + Number(livePlan.budgets.maxWallClockSeconds) * 1000,
      planVersionMatchesCapability: livePlan?.version === workerModelClaims.expectedPlanVersion,
      budgetCostAvailable: livePlan?.budgets.maxModelCostMinor !== null && livePlan?.budgets.maxModelCostMinor !== undefined,
      workerRunning: liveWorker?.status === "running", workerAgentMatches: liveWorker?.agentId === agentId,
      attemptRunning: liveAttempt?.status === "running", attemptAgentMatches: liveAttempt?.agentId === agentId,
      attemptRunMatches: liveAttempt?.runId === run!.id, attemptManifestMatches: liveAttempt?.executionManifestId === manifest!.record.id,
      runRunning: liveRun?.status === "running", runNative: liveRun?.runtimeMode === "native",
      runTaskMatches: liveRun?.nativeIssueId === task.id, runUserMatches: liveRun?.responsibleUserId === aliceUserId,
      manifestPrincipalMatches: manifestPrincipal === aliceUserId,
      manifestScopesCompanyScoped: !!liveManifest?.manifest.executionScope.delegatedScopes.every(scope => scope.companyId === companyId),
      taskAssigned: liveTask?.assigneeAgentId === agentId, taskRunMatches: liveTask?.executionRunId === run!.id,
    })}`);
    let runtimeDirectory = "";
    let configDirectory = "";
    let completedNativeFinalization: {
      result: Record<string, unknown>; terminal: PrpTerminalState; turnId: string | null;
      normalizedSessionId: string; sourceInstanceId: string;
    } | null = null;
    const processTreeTimers: ReturnType<typeof setInterval>[] = [];
    const observedOpenCodePids = new Set<number>();
    let managedProviderConfigReported = false;
    const pgMonitor = postgres(input.connectionString, { max: 1 });
    let pgMonitorStartedAt: number | null = null;
    let pgMonitorTimer: ReturnType<typeof setInterval> | undefined;
    let contextProbeTimer: ReturnType<typeof setInterval> | undefined;
    let contextInvocationWatchTimer: ReturnType<typeof setInterval> | undefined;
    let pgMonitorInFlight = false;
    let contextInvocationWatchInFlight = false;
    const inspectPostgresWaits = async () => {
      if (pgMonitorInFlight) return;
      pgMonitorInFlight = true;
      try {
        const [sample] = await pgMonitor<{ active: number; idleInTransaction: number; waiters: Array<{
          pid: number; appLabel: string; waitEventType: string | null; waitEvent: string | null; blockedBy: number[]; queryKind: string;
        }>; sessions: Array<{ pid: number; appLabel: string; state: string | null; backendType: string | null;
          waitEventType: string | null; waitEvent: string | null; xactAgeMs: number | null; queryAgeMs: number | null;
          queryKind: string; queryLength: number; querySha256: string; blockedBy: number[];
          advisoryLockCount: number; relationLockCount: number }> }[]>`
          select count(*) filter (where state = 'active')::int as active,
            count(*) filter (where state = 'idle in transaction')::int as "idleInTransaction",
            coalesce(json_agg(json_build_object('pid', pid,
              'appLabel', left(regexp_replace(coalesce(application_name, ''), '[^A-Za-z0-9_.-]', '', 'g'), 64),
              'waitEventType', wait_event_type,
              'waitEvent', wait_event, 'blockedBy', pg_blocking_pids(pid),
              'queryKind', case when query ilike '%issues%' then 'issues'
                when query ilike '%heartbeat_runs%' then 'heartbeat_runs'
                when query ilike '%native_run_finalizations%' then 'run_finalizations'
                else lower(split_part(query, ' ', 1)) end))
              filter (where state = 'active' and wait_event_type is not null), '[]'::json) as waiters,
            coalesce((select json_agg(json_build_object('pid', tracked.pid,
              'appLabel', left(regexp_replace(coalesce(tracked.application_name, ''), '[^A-Za-z0-9_.-]', '', 'g'), 64),
              'state', tracked.state, 'backendType', tracked.backend_type,
              'waitEventType', tracked.wait_event_type, 'waitEvent', tracked.wait_event,
              'xactAgeMs', case when tracked.xact_start is null then null
                else greatest(0, (extract(epoch from clock_timestamp() - tracked.xact_start) * 1000)::int) end,
              'queryAgeMs', case when tracked.query_start is null then null
                else greatest(0, (extract(epoch from clock_timestamp() - tracked.query_start) * 1000)::int) end,
              'queryKind', case when tracked.query ilike '%issues%' then 'issues'
                when tracked.query ilike '%heartbeat_runs%' then 'heartbeat_runs'
                when tracked.query ilike '%native_run_finalizations%' then 'run_finalizations'
                else lower(split_part(tracked.query, ' ', 1)) end,
              'queryLength', length(coalesce(tracked.query, '')),
              'querySha256', encode(sha256(convert_to(coalesce(tracked.query, ''), 'UTF8')), 'hex'),
              'blockedBy', pg_blocking_pids(tracked.pid),
              'advisoryLockCount', (select count(*)::int from pg_locks where pid = tracked.pid and locktype = 'advisory'),
              'relationLockCount', (select count(*)::int from pg_locks where pid = tracked.pid and locktype = 'relation')))
              from (select activity.* from pg_stat_activity activity
                where activity.datname = current_database() and activity.pid <> pg_backend_pid()
                and (activity.state = 'idle in transaction' or activity.wait_event_type is not null or exists (
                  select 1 from pg_locks held where held.pid = activity.pid and held.granted
                ))
                order by activity.pid limit 40) tracked), '[]'::json) as sessions
          from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
        `;
        if (sample) {
          contextProbeSamples += contextProbeCallId ? 1 : 0;
          const contextInvocation = contextProbeCallId
            ? (await pgMonitor<{ status: string }[]>`
              select status from tool_invocations where company_id = ${companyId}::uuid
                and idempotency_key = ${`aw-native-tool:${run!.id}:${contextProbeCallId}`} limit 1
            `)[0] ?? null
            : null;
          const contextResultCapturePresent = contextProbeCallId && contextInvocation?.status === "succeeded"
            ? (await pgMonitor<{ present: boolean }[]>`
              select exists (
                select 1 from heartbeat_runs r,
                  jsonb_array_elements(coalesce(r.runner_profile_json->'nativeToolResultSourceCaptures', '[]'::jsonb)) capture
                where r.company_id = ${companyId}::uuid and r.id = ${run!.id}::uuid
                  and capture->>'callId' = ${contextProbeCallId}
                  and capture->>'tool' = 'read_context' and capture->>'managedOpenCode' = 'true'
              ) as present
            `)[0]?.present === true
            : false;
          if (contextResultCapturePresent && contextPostCaptureProbeStartedAt === null) {
            contextPostCaptureProbeStartedAt = Date.now();
            contextPostCaptureProbeSamples = 0;
            diagnostics.push(`managed Context post-capture probe started: ${JSON.stringify({ providerFetchCount: responseCount })}`);
          }
          if (contextPostCaptureProbeStartedAt !== null) contextPostCaptureProbeSamples += 1;
          if (contextInvocation?.status === "succeeded" && contextProbeCompletedAt === null)
            contextProbeCompletedAt = Date.now();
          const sampleFacts = {
            elapsedSinceSessionStartMs: pgMonitorStartedAt === null ? null : Math.max(0, Date.now() - pgMonitorStartedAt),
            contextProbeElapsedMs: contextProbeStartedAt === null ? null : Math.max(0, Date.now() - contextProbeStartedAt),
            contextProbeCompletedElapsedMs: contextProbeCompletedAt === null ? null : Math.max(0, Date.now() - contextProbeCompletedAt),
            contextProbeSample: contextProbeCallId ? contextProbeSamples : null,
            contextPostCaptureElapsedMs: contextPostCaptureProbeStartedAt === null ? null :
              Math.max(0, Date.now() - contextPostCaptureProbeStartedAt),
            contextPostCaptureSample: contextPostCaptureProbeStartedAt === null ? null : contextPostCaptureProbeSamples,
            providerFetchCount: responseCount,
            contextInvocationStatus: contextInvocation?.status ?? (contextProbeCallId ? "not_started" : null),
            contextResultCapturePresent,
            ...sample,
          };
          const postCaptureHasActivity = sample.sessions.length > 0 || sample.waiters.length > 0;
          if (!contextProbeCallId || sample.waiters.length ||
            (contextPostCaptureProbeStartedAt === null && (sample.sessions.length || contextProbeSamples <= 1 ||
              contextInvocation?.status && contextInvocation.status !== "executing")) ||
            (contextPostCaptureProbeStartedAt !== null &&
              (contextPostCaptureProbeSamples === 1 || contextPostCaptureProbeSamples % 4 === 0 || postCaptureHasActivity)))
            diagnostics.push(`independent PG wait sample: ${JSON.stringify(sampleFacts)}`);
          const invocationFinished = contextInvocation?.status && contextInvocation.status !== "executing";
          const completedCaptureStillPending = contextInvocation?.status === "succeeded" && !contextResultCapturePresent &&
            contextProbeCompletedAt !== null && Date.now() - contextProbeCompletedAt < 5_000;
          const fifthModelFetchStarted = contextPostCaptureProbeStartedAt !== null && responseCount >= 5;
          const postCaptureProbeExpired = contextPostCaptureProbeStartedAt !== null &&
            (Date.now() - contextPostCaptureProbeStartedAt >= 15_000 || contextPostCaptureProbeSamples >= 60);
          const contextInvocationFailed = invocationFinished && contextInvocation?.status !== "succeeded";
          const captureWaitExpired = contextProbeCompletedAt !== null && !contextResultCapturePresent &&
            Date.now() - contextProbeCompletedAt >= 5_000;
          const preCaptureProbeExpired = contextPostCaptureProbeStartedAt === null && contextProbeStartedAt !== null &&
            Date.now() - contextProbeStartedAt >= 10_000;
          if (contextProbeCallId && (fifthModelFetchStarted || postCaptureProbeExpired || contextInvocationFailed ||
            captureWaitExpired || preCaptureProbeExpired)) {
            if (contextPostCaptureProbeStartedAt !== null)
              diagnostics.push(`managed Context post-capture probe stopped: ${JSON.stringify({
                reason: fifthModelFetchStarted ? "fifth_model_fetch" : postCaptureProbeExpired ? "bounded_window" : "invocation_finished",
                elapsedMs: Date.now() - contextPostCaptureProbeStartedAt,
                samples: contextPostCaptureProbeSamples, providerFetchCount: responseCount,
              })}`);
            if (contextProbeTimer) clearInterval(contextProbeTimer);
            contextProbeTimer = undefined;
            contextProbeCallId = null;
          }
        }
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code : "unavailable";
        diagnostics.push(`independent PG wait sample unavailable: ${code}`);
      } finally {
        pgMonitorInFlight = false;
      }
    };
    const watchContextInvocation = async () => {
      if (!pendingContextProbeCallId || contextInvocationWatchInFlight) return;
      contextInvocationWatchInFlight = true;
      try {
        const callId = pendingContextProbeCallId;
        const contextInvocation = (await pgMonitor<{ status: string }[]>`
          select status from tool_invocations where company_id = ${companyId}::uuid
            and idempotency_key = ${`aw-native-tool:${run!.id}:${callId}`} limit 1
        `)[0] ?? null;
        if (contextInvocation?.status === "executing") {
          contextProbeCallId = callId;
          pendingContextProbeCallId = null;
          contextProbeStartedAt = Date.now();
          contextProbeCompletedAt = null;
          contextProbeSamples = 0;
          if (contextInvocationWatchTimer) clearInterval(contextInvocationWatchTimer);
          contextInvocationWatchTimer = undefined;
          contextProbeTimer = setInterval(() => { void inspectPostgresWaits(); }, 250);
          void inspectPostgresWaits();
          return;
        }
        if (contextInvocation?.status && contextInvocation.status !== "executing") {
          diagnostics.push(`managed Context invocation completed before detailed wait sampling: ${JSON.stringify({
            status: contextInvocation.status,
            elapsedMs: pendingContextProbeStartedAt === null ? null : Date.now() - pendingContextProbeStartedAt,
          })}`);
          pendingContextProbeCallId = null;
          if (contextInvocationWatchTimer) clearInterval(contextInvocationWatchTimer);
          contextInvocationWatchTimer = undefined;
          return;
        }
        if (pendingContextProbeStartedAt !== null && Date.now() - pendingContextProbeStartedAt >= 30_000) {
          diagnostics.push(`managed Context invocation start was not observed within bound: ${JSON.stringify({ elapsedMs: 30_000 })}`);
          pendingContextProbeCallId = null;
          if (contextInvocationWatchTimer) clearInterval(contextInvocationWatchTimer);
          contextInvocationWatchTimer = undefined;
        }
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code : "unavailable";
        diagnostics.push(`managed Context invocation status probe unavailable: ${code}`);
      } finally {
        contextInvocationWatchInFlight = false;
      }
    };
    const findManagedOpenCodeConfig = async (directory: string, depth = 0): Promise<string | null> => {
      if (depth > 16) return null;
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          const found = await findManagedOpenCodeConfig(path, depth + 1);
          if (found) return found;
        } else if (entry.isFile() && entry.name === "opencode.json" &&
          directory.endsWith(`${join("config", "opencode")}`)) return directory;
      }
      return null;
    };
    const assertManagedConfigIsReadOnlyBeforeSpawn = async () => {
      if (!configDirectory) {
        const found = await findManagedOpenCodeConfig(join(root, "instances", instanceId));
        if (!found) throw new Error("managed_opencode_config_not_found");
        configDirectory = found;
        runtimeDirectory = dirname(dirname(dirname(configDirectory)));
      }
      const [directory, ignore, config, plugin] = await Promise.all([
        stat(configDirectory), stat(join(configDirectory, ".gitignore")),
        stat(join(configDirectory, "opencode.json")), stat(join(configDirectory, "plugins", "paperclip-source-witness.js")),
      ]);
      const modes = [directory.mode & 0o777, ignore.mode & 0o777, config.mode & 0o777, plugin.mode & 0o777];
      if (modes.some((mode, index) => mode !== [0o500, 0o400, 0o400, 0o400][index]))
        throw new Error(`managed_opencode_config_not_read_only_before_spawn:${modes.map(mode => mode.toString(8)).join(",")}`);
      diagnostics.push(`managed config modes before spawn: ${modes.map(mode => mode.toString(8)).join(",")}`);
      if (!managedProviderConfigReported) {
        const config = JSON.parse(await readFile(join(configDirectory, "opencode.json"), "utf8")) as Record<string, unknown>;
        const provider = config.provider && typeof config.provider === "object"
          ? (config.provider as Record<string, unknown>).anthropic as Record<string, unknown> | undefined : undefined;
        const options = provider?.options && typeof provider.options === "object"
          ? provider.options as Record<string, unknown> : {};
        diagnostics.push(`managed provider config: apiKey=${options.apiKey === "paperclip-managed-model-broker" ? "placeholder" : "missing"} baseURL=${typeof options.baseURL === "string" && options.baseURL.startsWith("https://127.0.0.1:") ? "local" : "missing"}`);
        managedProviderConfigReported = true;
      }
    };
    const onSpawn = async (meta: { pid: number; processGroupId: number | null; startedAt: string }) => {
      await persistHeartbeatRunProcessMetadata(db, run!.id, meta);
      const { pid } = meta;
      diagnostics.push(`runner process pid ${pid}`);
      const observed = new Set<number>();
      const inspect = async () => {
        const descendants: Array<{ pid: number; parent: number }> = [];
        const pending = [pid];
        const parents = new Map<number, number>();
        for (let depth = 0; pending.length > 0 && depth < 8; depth += 1) {
          const parentPid = pending.shift()!;
          const children = await readFile(`/proc/${parentPid}/task/${parentPid}/children`, "utf8").catch(() => "");
          for (const rawChildPid of children.trim().split(/\s+/)) {
            const childPid = Number(rawChildPid);
            if (!Number.isSafeInteger(childPid) || childPid <= 0 || parents.has(childPid)) continue;
            parents.set(childPid, parentPid);
            descendants.push({ pid: childPid, parent: parentPid });
            pending.push(childPid);
          }
        }
        for (const { pid: childPid, parent: parentPid } of descendants) {
          if (observed.has(childPid)) continue;
          observed.add(childPid);
          const [executablePath, comm, environmentText] = await Promise.all([
            readlink(`/proc/${childPid}/exe`).catch(() => "unknown"),
            readFile(`/proc/${childPid}/comm`, "utf8").catch(() => "unknown"),
            readFile(`/proc/${childPid}/environ`, "utf8").catch(() => ""),
          ]);
          const environment = environmentText.split("\0");
          const executable = executablePath.split("/").at(-1) || "unknown";
          const isOpenCodeProcess = /opencode/i.test(executable);
          let openCodeShaMatches: boolean | null = null;
          let openCodeManagedEnvironment: Record<string, boolean> | null = null;
          if (isOpenCodeProcess) {
            const runningHash = await readFile(`/proc/${childPid}/exe`).then(bytes =>
              createHash("sha256").update(bytes).digest("hex")).catch(() => "");
            openCodeShaMatches = runningHash === qualifiedOpenCodeSha256;
            openCodeManagedEnvironment = {
              brokerOrigin: environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN=")),
              inputCap: environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND=")),
              outputCap: environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS=")),
              placeholderKey: environment.includes("ANTHROPIC_API_KEY=paperclip-managed-model-broker"),
              dataHomeMatchesManagedRun: environment.includes(`XDG_DATA_HOME=${expectedOpenCodeDataHome()}`),
            };
            if (!observedOpenCodePids.has(childPid)) {
              observedOpenCodePids.add(childPid);
              openCodeProcessFacts.push({ shaMatchesQualifiedBinary: openCodeShaMatches, managedEnvironment: openCodeManagedEnvironment });
            }
          }
          diagnostics.push(`runner descendant pid=${childPid} parent=${parentPid} executable=${executable} comm=${comm.trim()} openCode=${isOpenCodeProcess ? "yes" : "no"} brokerOrigin=${environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN=")) ? "present" : "missing"} inputCap=${environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND=")) ? "present" : "missing"} outputCap=${environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS=")) ? "present" : "missing"} placeholderKey=${environment.includes("ANTHROPIC_API_KEY=paperclip-managed-model-broker") ? "present" : "missing"} dataHomeMatchesManagedRun=${environment.includes(`XDG_DATA_HOME=${expectedOpenCodeDataHome()}`) ? "yes" : "no"}`);
          if (isOpenCodeProcess)
            diagnostics.push(`OpenCode child qualification: ${JSON.stringify({ shaMatchesQualifiedBinary: openCodeShaMatches, managedEnvironment: openCodeManagedEnvironment })}`);
        }
        // Runnerd may own the process boundary and omit the provider PID from
        // its reported tree. Inspect live /proc entries for the exact pinned
        // executable, then retain only booleans about its managed environment.
        for (const entry of await readdir("/proc", { withFileTypes: true }).catch(() => [])) {
          if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
          const childPid = Number(entry.name);
          if (observedOpenCodePids.has(childPid)) continue;
          const executablePath = await readlink(`/proc/${childPid}/exe`).catch(() => "");
          if (!/(?:^|\/)opencode(?:[-.]|$)/i.test(executablePath)) continue;
          const [runningHash, environmentText] = await Promise.all([
            readFile(`/proc/${childPid}/exe`).then(bytes => createHash("sha256").update(bytes).digest("hex")).catch(() => ""),
            readFile(`/proc/${childPid}/environ`, "utf8").catch(() => ""),
          ]);
          const environment = environmentText.split("\0");
          const managedEnvironment = {
            brokerOrigin: environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN=")),
            inputCap: environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND=")),
            outputCap: environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS=")),
            placeholderKey: environment.includes("ANTHROPIC_API_KEY=paperclip-managed-model-broker"),
            dataHomeMatchesManagedRun: environment.includes(`XDG_DATA_HOME=${expectedOpenCodeDataHome()}`),
          };
          observedOpenCodePids.add(childPid);
          openCodeProcessFacts.push({ shaMatchesQualifiedBinary: runningHash === qualifiedOpenCodeSha256, managedEnvironment });
          diagnostics.push(`OpenCode process qualification: ${JSON.stringify({
            shaMatchesQualifiedBinary: runningHash === qualifiedOpenCodeSha256, managedEnvironment,
          })}`);
        }
      };
      const timer = setInterval(() => { void inspect(); }, 250);
      void inspect();
      processTreeTimers.push(timer);
    };
    try {
      const result = await executePaperclipNativeSession({ db, execution, bootstrapSourceClosure, useRunnerd: true, onSpawn,
        runnerInstanceId: prepared.runnerInstanceId, leaseOwner, turnTimeoutMs: 90_000, adapterType: "paperclip_runner",
        runnerEnvironment, onLog: async (stream, chunk) => {
          for (const line of chunk.split(/\r?\n/)) {
            if (!line.trim()) continue;
            try {
              const envelope = JSON.parse(line) as Record<string, unknown>;
              const event = envelope.event && typeof envelope.event === "object" ? envelope.event as Record<string, unknown> : null;
              if (event) {
                const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
                if (event.eventType === "turn.submitted") {
                  const submittedText = typeof payload.text === "string" ? payload.text :
                    payload.message && typeof payload.message === "object" && typeof (payload.message as Record<string, unknown>).text === "string"
                      ? (payload.message as Record<string, unknown>).text as string : null;
                  if (submittedText !== null) submittedPromptFacts.push({ length: submittedText.length,
                    sha256: canonicalHash(submittedText) });
                  diagnostics.push(`turn submitted prompt metadata: ${JSON.stringify({ textPresent: submittedText !== null,
                    textLength: submittedText?.length ?? null })}`);
                }
                const safe = { eventType: event.eventType, payloadType: payload.type, status: payload.status,
                  code: payload.code, reasonCode: payload.reasonCode,
                  tool: typeof payload.name === "string" ? payload.name : undefined,
                  payloadKeys: Object.keys(payload).sort() };
                diagnostics.push(`runner ${stream} event: ${JSON.stringify(safe)}`);
                if (event.eventType === "semantic_tool.result") {
                  const semantic = payload.semantic_tool && typeof payload.semantic_tool === "object"
                    ? payload.semantic_tool as Record<string, unknown> : {};
                  const correlation = semantic.correlation && typeof semantic.correlation === "object"
                    ? semantic.correlation as Record<string, unknown> : {};
                  diagnostics.push(`runner semantic tool result: ${JSON.stringify({
                    code: typeof semantic.code === "string" && /^[a-z0-9_]{1,100}$/.test(semantic.code) ? semantic.code : null,
                    outcome: semantic.outcome, phase: semantic.phase,
                    callIdPresent: typeof semantic.callId === "string" && semantic.callId.length > 0,
                    operationIdPresent: typeof semantic.operationId === "string" && semantic.operationId.length > 0,
                    operationReceiptIdPresent: typeof semantic.operationReceiptId === "string" && semantic.operationReceiptId.length > 0,
                    correlationKeys: Object.keys(correlation).sort(),
                  })}`);
                }
                if (event.eventType === "session.started")
                  void assertManagedConfigIsReadOnlyBeforeSpawn().catch(() => diagnostics.push("managed config probe unavailable"));
                if (event.eventType === "session.started" && !pgMonitorTimer) {
                  pgMonitorStartedAt = Date.now();
                  pgMonitorTimer = setInterval(() => { void inspectPostgresWaits(); }, 5_000);
                  void inspectPostgresWaits();
                }
                if (event.eventType === "turn.failed") {
                  const failure = payload.error;
                  if (typeof failure === "string")
                    diagnostics.push(`runner turn failure: ${failure.replaceAll(credential, "<redacted>").slice(0, 240)}`);
                  else if (failure && typeof failure === "object" && !Array.isArray(failure)) {
                    const details = failure as Record<string, unknown>;
                    const data = details.data && typeof details.data === "object" && !Array.isArray(details.data)
                      ? details.data as Record<string, unknown> : {};
                    diagnostics.push(`runner turn failure: ${JSON.stringify({ name: details.name, code: details.code,
                      message: typeof details.message === "string" ? details.message.replaceAll(credential, "<redacted>").slice(0, 240) : undefined,
                      keys: Object.keys(details).sort(), dataKeys: Object.keys(data).sort(), dataCode: data.code,
                      dataStatus: data.statusCode ?? data.status,
                      dataMessage: typeof data.message === "string" ? data.message.replaceAll(credential, "<redacted>").slice(0, 240) : undefined })}`);
                  }
                }
              }
            } catch {
              if (stream === "stderr" && /(?:error|failed|failure|denied|unavailable|timeout|timed out|disconnect|exit code|command_execution_failed)/i.test(line))
                diagnostics.push(`runner stderr: ${line.replace(/\s+/g, " ").slice(0, 240)}`);
            }
          }
        } }).catch(error => {
          input.onPreserveDebugArtifacts?.();
          const failure = error instanceof Error ? error as Error & { code?: unknown; cause?: { code?: unknown }; stage?: unknown } : null;
          const frames = failure?.stack?.split("\n").slice(1)
            .filter(line => /^\s*at /.test(line)).slice(0, 6)
            .map(line => line.trim().replace(/\s+/g, " ").slice(0, 220)) ?? [];
          const metadata = { name: failure?.name ?? "UnknownError", code: safeCode(failure?.code),
            causeCode: safeCode(failure?.cause?.code), stage: safeCode(failure?.stage), frames };
          diagnostics.push(`execution failure metadata: ${JSON.stringify(metadata)}`);
          const safeMessage = safeCode(failure?.message) ?? "native_session_execution_failed";
          throw new Error(`${safeMessage}\n${diagnostics.join("\n")}\nBroker: ${JSON.stringify(brokerFailureFacts())}\nArtifacts: ${runRoot}`);
        });
      if (result.exitCode !== 0) {
        input.onPreserveDebugArtifacts?.();
        const [failedRun] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson })
          .from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
        const failedProfile = failedRun?.runnerProfileJson && typeof failedRun.runnerProfileJson === "object"
          ? failedRun.runnerProfileJson as Record<string, unknown> : {};
        const failedIntents = Array.isArray(failedProfile.nativeAwModelWireIntents) ? failedProfile.nativeAwModelWireIntents : [];
        const writeUses = failedIntents.flatMap(value => {
          const intent = value && typeof value === "object" ? value as Record<string, unknown> : {};
          return Array.isArray(intent.responseToolUses) ? intent.responseToolUses.flatMap(useValue => {
            const use = useValue && typeof useValue === "object" ? useValue as Record<string, unknown> : {};
            return toolName(use.name) === "write_document" && use.id === "managed-e2e-write-1" ? [use] : [];
          }) : [];
        });
        const associations = Array.isArray(failedProfile.nativeToolCallDispatchAssociations)
          ? failedProfile.nativeToolCallDispatchAssociations as Array<Record<string, unknown>> : [];
        const captures = Array.isArray(failedProfile.nativeToolResultSourceCaptures)
          ? failedProfile.nativeToolResultSourceCaptures as Array<Record<string, unknown>> : [];
        const invocations = await db.select({ id: toolInvocations.id, idempotencyKey: toolInvocations.idempotencyKey,
          toolName: toolInvocations.toolName, status: toolInvocations.status,
          policyDecision: toolInvocations.policyDecision, approvalState: toolInvocations.approvalState,
          errorCode: toolInvocations.errorCode, workflowResultJson: toolInvocations.workflowResultJson })
          .from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId), eq(toolInvocations.runId, run!.id)));
        const documentPrefixFacts = await Promise.all(modelSteps.filter(step => step.tool === "write_document").map(async step => {
          const callId = step.id ?? `managed-e2e-${step.tool}-${modelSteps.indexOf(step)}`;
          const key = typeof step.input?.key === "string" ? step.input.key : "";
          const visible = key ? await documentService(db).getIssueDocumentByKey(task.id, key) : undefined;
          const [revision] = visible?.latestRevisionId ? await db.select({ payloadSourceSnapshot: documentRevisions.payloadSourceSnapshot })
            .from(documentRevisions).where(eq(documentRevisions.id, visible.latestRevisionId)) : [];
          const snapshot = revision?.payloadSourceSnapshot && typeof revision.payloadSourceSnapshot === "object"
            ? revision.payloadSourceSnapshot as Record<string, unknown> : {};
          const snapshotInputs = Array.isArray(snapshot.inputs) ? snapshot.inputs as Array<Record<string, unknown>> : [];
          const matchingIntents = failedIntents.filter(value => {
            const intent = value && typeof value === "object" ? value as Record<string, unknown> : {};
            return Array.isArray(intent.responseToolUses) && intent.responseToolUses.some(useValue => {
              const use = useValue && typeof useValue === "object" ? useValue as Record<string, unknown> : {};
              return use.id === callId && toolName(use.name) === "write_document";
            });
          });
          const components = matchingIntents.flatMap(value => {
            const intent = value && typeof value === "object" ? value as Record<string, unknown> : {};
            return Array.isArray(intent.consumedSourceComponents)
              ? intent.consumedSourceComponents as Array<Record<string, unknown>> : [];
          });
          const ownToolResultInComponents = components.some(component =>
            (Array.isArray(component.inputs) ? component.inputs as Array<Record<string, unknown>> : [])
              .some(source => source.kind === "tool_result" && source.callId === callId));
          return { snapshotInputCount: snapshotInputs.length,
            snapshotInputKinds: snapshotInputs.map(source => typeof source.kind === "string" ? source.kind : "unknown").sort(),
            snapshotIncludesOwnToolResult: snapshotInputs.some(source => source.kind === "tool_result" && source.callId === callId),
            matchingIntentCount: matchingIntents.length,
            consumedComponentCount: components.length,
            consumedComponentKinds: components.map(component => typeof component.kind === "string" ? component.kind : "unknown").sort(),
            intentSetIncludesOwnToolResult: ownToolResultInComponents };
        }));
        const memoryPrefixFacts = modelSteps.filter(step => step.tool === "self_remember").map(step => {
          const callId = step.id ?? `managed-e2e-${step.tool}-${modelSteps.indexOf(step)}`;
          const matchingIntents = failedIntents.filter(value => {
            const intent = value && typeof value === "object" ? value as Record<string, unknown> : {};
            return Array.isArray(intent.responseToolUses) && intent.responseToolUses.some(useValue => {
              const use = useValue && typeof useValue === "object" ? useValue as Record<string, unknown> : {};
              return use.id === callId && toolName(use.name) === "self_remember";
            });
          });
          const components = matchingIntents.flatMap(value => {
            const intent = value && typeof value === "object" ? value as Record<string, unknown> : {};
            return Array.isArray(intent.consumedSourceComponents)
              ? intent.consumedSourceComponents as Array<Record<string, unknown>> : [];
          });
          const inputs = components.flatMap(component => Array.isArray(component.inputs)
            ? component.inputs as Array<Record<string, unknown>> : []);
          const matchingCaptures = captures.filter(value => value && typeof value === "object" &&
            (value as Record<string, unknown>).callId === callId &&
            toolName((value as Record<string, unknown>).tool) === "self_remember");
          const captureInputKinds = matchingCaptures.flatMap(value => {
            const capture = value as Record<string, unknown>;
            const source = capture.source && typeof capture.source === "object" ? capture.source as Record<string, unknown> : {};
            return Array.isArray(source.inputs) ? (source.inputs as Array<Record<string, unknown>>)
              .map(input => typeof input.kind === "string" ? input.kind : "unknown") : [];
          });
          return { intentCount: matchingIntents.length,
            componentKinds: components.map(component => typeof component.kind === "string" ? component.kind : "unknown").sort(),
            consumedInputCount: inputs.length,
            consumedInputKinds: inputs.map(source => typeof source.kind === "string" ? source.kind : "unknown").sort(),
            captureCount: matchingCaptures.length, captureInputKinds: captureInputKinds.sort() };
        });
        const memoryOutputQualificationFacts = modelSteps.filter(step => step.tool === "self_remember").map(step => {
          const callId = step.id ?? `managed-e2e-${step.tool}-${modelSteps.indexOf(step)}`;
          const matchingUses = failedIntents.flatMap(value => {
            const intent = value && typeof value === "object" ? value as Record<string, unknown> : {};
            return Array.isArray(intent.responseToolUses) ? intent.responseToolUses.flatMap(useValue => {
              const use = useValue && typeof useValue === "object" ? useValue as Record<string, unknown> : {};
              return use.id === callId && toolName(use.name) === "self_remember" ? [use] : [];
            }) : [];
          });
          const matchingAssociations = associations.filter(value => value.callId === callId &&
            toolName(value.tool) === "self_remember");
          const matchingCaptures = captures.filter(value => value.callId === callId &&
            toolName(value.tool) === "self_remember");
          const canonicalInvocationRows = invocations.filter(value => value.toolName === "paperclip-self:remember" &&
            value.idempotencyKey === `aw-native-tool:${run!.id}:${callId}`);
          const invocationResultShapes = canonicalInvocationRows.map(value => safeToolResultShape(value.workflowResultJson));
          return { providerUseCount: matchingUses.length, associationCount: matchingAssociations.length,
            associationHasTurnId: matchingAssociations.map(value => typeof value.turnId === "string"),
            captureCount: matchingCaptures.length,
            captureQualification: matchingCaptures.map(value => {
              const source = value.source && typeof value.source === "object" ? value.source as Record<string, unknown> : {};
              return { managed: value.managedOpenCode === true,
                sourceIsToolResult: source.kind === "tool_result",
                sourceCallIdMatches: source.callId === callId,
                sourceToolNameCanonicalRemember: source.toolName === "paperclip-self:remember",
                sourceToolNameProviderAlias: toolName(source.toolName) === "self_remember",
                resultDigestPresent: typeof value.resultDigest === "string" && /^[0-9a-f]{64}$/.test(value.resultDigest) };
            }),
            invocationStates: canonicalInvocationRows.map(value => ({ status: value.status,
              policyDecision: value.policyDecision, approvalState: value.approvalState,
              errorCode: typeof value.errorCode === "string" && /^[a-z0-9_]{1,120}$/i.test(value.errorCode)
                ? value.errorCode : undefined })), invocationResultShapes };
        });
        const memoryOutputSourceFacts = await Promise.all(modelSteps.filter(step => step.tool === "self_remember").map(async step => {
          const callId = step.id ?? `managed-e2e-${step.tool}-${modelSteps.indexOf(step)}`;
          const invocation = invocations.find(value => value.toolName === "paperclip-self:remember" &&
            value.idempotencyKey === `aw-native-tool:${run!.id}:${callId}`);
          let result: Record<string, unknown> = {};
          try {
            const parsed = typeof invocation?.workflowResultJson === "string"
              ? JSON.parse(invocation.workflowResultJson) : invocation?.workflowResultJson;
            result = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
          } catch { /* bounded failure diagnostic */ }
          const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
            ? result.data as Record<string, unknown> : result;
          const record = data.record && typeof data.record === "object" && !Array.isArray(data.record)
            ? data.record as Record<string, unknown> : {};
          const memoryId = typeof record.id === "string" ? record.id : null;
          const [memory] = memoryId ? await db.select({ scopeType: memoryRecords.scopeType,
            scopeId: memoryRecords.scopeId, ownerAgentId: memoryRecords.ownerAgentId,
            privateOwnerUserId: memoryRecords.privateOwnerUserId, sourceMemoryIds: memoryRecords.sourceMemoryIds,
            payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot,
            payloadSourceSnapshotInvalidated: memoryRecords.payloadSourceSnapshotInvalidated,
            payloadSourceProtocolVersion: memoryRecords.payloadSourceProtocolVersion, metadata: memoryRecords.metadata,
            deletedAt: memoryRecords.deletedAt, revokedAt: memoryRecords.revokedAt })
            .from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, memoryId))) : [];
          const snapshot = memory?.payloadSourceSnapshot && typeof memory.payloadSourceSnapshot === "object"
            ? memory.payloadSourceSnapshot as Record<string, unknown> : {};
          const snapshotInputs = Array.isArray(snapshot.inputs) ? snapshot.inputs as Array<Record<string, unknown>> : [];
          const metadata = memory?.metadata && typeof memory.metadata === "object" ? memory.metadata as Record<string, unknown> : {};
          const firstStep = modelSteps.find(value => value.tool === "self_remember");
          const firstCallId = firstStep?.id ?? (firstStep ? `managed-e2e-${firstStep.tool}-${modelSteps.indexOf(firstStep)}` : "");
          const firstInvocation = firstCallId ? invocations.find(value => value.toolName === "paperclip-self:remember" &&
            value.idempotencyKey === `aw-native-tool:${run!.id}:${firstCallId}`) : undefined;
          let firstMemoryId: string | null = null;
          try {
            const parsed = typeof firstInvocation?.workflowResultJson === "string"
              ? JSON.parse(firstInvocation.workflowResultJson) : firstInvocation?.workflowResultJson;
            const wrapper = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
            const payload = wrapper.data && typeof wrapper.data === "object" ? wrapper.data as Record<string, unknown> : wrapper;
            const firstRecord = payload.record && typeof payload.record === "object" ? payload.record as Record<string, unknown> : {};
            firstMemoryId = typeof firstRecord.id === "string" ? firstRecord.id : null;
          } catch { /* bounded failure diagnostic */ }
          let canReadSources = false;
          let aliceCanRead = false;
          let aliceOutputSourceValidation: "passed" | "failed" | "not_applicable" = "not_applicable";
          const sourceFailureLabels = [
            "The Native output reader is unavailable", "The Native output source chain exceeds its bound",
            "The Native output capture is unavailable", "The Native output capture is not bound to its settled provider tool use",
            "The Native output capture lacks its consumed source components", "The Native consumed source set is unavailable",
            "The Native consumed source graph contains a cycle", "The Native consumed source receipt is unavailable",
            "The Native consumed source dispatch is unavailable", "The Native consumed source prefix is unavailable",
            "The Native consumed source family is unsupported", "A Native output Task source is unavailable",
            "A Native output Task source changed", "A Native output document source is unavailable",
            "A Native output Context source is unavailable", "A Native output model dispatch is unavailable",
          ];
          let aliceOutputSourceFailure: string | null = null;
          if (memoryId) {
            try { canReadSources = await canActorReadMemorySources(db, companyId, aliceMemoryActor.authorizationActor, memoryId); }
            catch { canReadSources = false; }
            try { aliceCanRead = Boolean(await memoryService(db).get(companyId, memoryId, aliceMemoryActor)); }
            catch { aliceCanRead = false; }
            const parsedSnapshot = nativePayloadSourceSnapshotSchema.safeParse(memory?.payloadSourceSnapshot);
            if (parsedSnapshot.success) {
              try {
                await assertNativeMemoryOutputSnapshotCurrent(db, { companyId, recordId: memoryId,
                  snapshot: parsedSnapshot.data, actor: aliceMemoryActor.authorizationActor });
                aliceOutputSourceValidation = "passed";
              } catch (error) {
                aliceOutputSourceValidation = "failed";
                aliceOutputSourceFailure = error instanceof Error
                  ? sourceFailureLabels.find(label => error.message === label) ?? "unclassified" : "non_error_throw";
              }
            }
          }
          const snapshotOwner = snapshot.owner && typeof snapshot.owner === "object" ? snapshot.owner as Record<string, unknown> : {};
          return { gatewayInvocationFound: Boolean(invocation),
            gatewayResultTopLevelKeys: Object.keys(result).sort(), gatewayResultDataKeys: Object.keys(data).sort(),
            gatewayResultHasRecordId: typeof record.id === "string",
            gatewayResultStatus: typeof data.status === "string" && ["accepted", "pending", "duplicate", "corroborated"].includes(data.status)
              ? data.status : "other_or_absent",
            gatewayResultScopeType: typeof (record.scope as Record<string, unknown> | undefined)?.type === "string"
              ? (record.scope as Record<string, unknown>).type as string : "absent",
            rowExists: Boolean(memory), scopeType: memory?.scopeType,
            privateOwnerPresent: typeof memory?.privateOwnerUserId === "string",
            privateOwnerMatchesResponsibleUser: memory?.privateOwnerUserId === aliceUserId,
            ownerAgentMatches: memory?.ownerAgentId === agentId,
            sourceMemoryIdsIncludeMemoryA: Boolean(firstMemoryId && memory?.sourceMemoryIds.includes(firstMemoryId)),
            protocolVersion: memory?.payloadSourceProtocolVersion,
            snapshotInvalidated: memory?.payloadSourceSnapshotInvalidated,
            snapshotOwnerKind: typeof snapshotOwner.kind === "string" ? snapshotOwner.kind : "absent",
            snapshotInputKinds: snapshotInputs.map(source => typeof source.kind === "string" ? source.kind : "unknown").sort(),
            snapshotBindsInvocation: typeof metadata.nativeManagedMemoryInvocationId === "string" &&
              metadata.nativeManagedMemoryInvocationId === invocation?.id,
            deleted: memory?.deletedAt !== null && memory?.deletedAt !== undefined,
            revoked: memory?.revokedAt !== null && memory?.revokedAt !== undefined,
            canActorReadMemorySources: canReadSources, aliceMemoryServiceRead: aliceCanRead,
            aliceOutputSourceValidation, aliceOutputSourceFailure };
        }));
        const allowedContextStages = new Set([
          "authorization", "provider_retrieval", "context_manifest", "context_inspection", "context_audit",
        ]);
        const contextInvocationFacts = invocations.filter(value => value.toolName === "read_context").map(value => {
          let result: Record<string, unknown> = {};
          try {
            const parsed = typeof value.workflowResultJson === "string"
              ? JSON.parse(value.workflowResultJson) : value.workflowResultJson;
            result = parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? parsed as Record<string, unknown> : {};
          } catch { /* bounded failure diagnostic */ }
          const details = result.details && typeof result.details === "object" && !Array.isArray(result.details)
            ? result.details as Record<string, unknown> : {};
          return { status: value.status, errorCode: safeCode(value.errorCode), resultKeys: Object.keys(result).sort(),
            resultCode: safeCode(result.code), resultReason: safeCode(result.reason),
            stage: typeof result.stage === "string" && allowedContextStages.has(result.stage) ? result.stage : undefined,
            detailsStage: typeof details.stage === "string" && allowedContextStages.has(details.stage)
              ? details.stage : undefined };
        });
        const privateRootMemoryId = privateRootRef.current?.memoryId ?? null;
        const contextReadSourceFacts = captures.filter(value => toolName(value.tool) === "read_context").map(value => {
          const contextRead = value.contextRead && typeof value.contextRead === "object" && !Array.isArray(value.contextRead)
            ? value.contextRead as Record<string, unknown> : {};
          const sourceSet = contextRead.sourceSet && typeof contextRead.sourceSet === "object" && !Array.isArray(contextRead.sourceSet)
            ? contextRead.sourceSet as Record<string, unknown> : {};
          const policy = sourceSet.policy && typeof sourceSet.policy === "object" && !Array.isArray(sourceSet.policy)
            ? sourceSet.policy as Record<string, unknown> : {};
          const memoryIds = Array.isArray(policy.memoryIds) ? policy.memoryIds.filter((item): item is string => typeof item === "string") : [];
          const sourceInputs = Array.isArray(sourceSet.inputs)
            ? sourceSet.inputs.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item))
            : [];
          const manifestIds = Array.isArray(contextRead.manifestIds) ? contextRead.manifestIds : [];
          return { contextCapturePresent: Object.keys(contextRead).length > 0,
            manifestCount: manifestIds.length,
            sourceInputCount: sourceInputs.length,
            sourceInputKinds: sourceInputs.map(source => typeof source.kind === "string" ? source.kind : "unknown").sort(),
            selectedMemoryCount: memoryIds.length,
            selectedPrivateRoot: privateRootMemoryId !== null && memoryIds.includes(privateRootMemoryId),
            contentDigestPresent: typeof contextRead.contentDigest === "string" && /^[0-9a-f]{64}$/.test(contextRead.contentDigest) };
        });
        const writeInvocationStatusCounts = Object.fromEntries(["executing", "succeeded", "failed", "cancelled"].map(status =>
          [status, invocations.filter(value => value.toolName === "write_document" && value.status === status).length]));
        diagnostics.push(`managed write capture facts: ${JSON.stringify({ providerWriteUseCount: writeUses.length,
          matchingAssociationCount: associations.filter(value => value.callId === "managed-e2e-write-1" &&
            toolName(value.tool) === "write_document").length,
          matchingCaptureCount: captures.filter(value => value.callId === "managed-e2e-write-1" &&
            value.managedOpenCode === true && toolName(value.tool) === "write_document").length,
          writeInvocationStatusCounts,
          succeededCanonicalInvocationCount: invocations.filter(value => value.toolName === "write_document" &&
            value.status === "succeeded").length,
          managedToolResultErrorCodes: diagnostics.flatMap(line => [...line.matchAll(/managed_opencode_tool_result_[a-z_]+/g)]
            .map(match => match[0]).filter((value, index, all) => all.indexOf(value) === index)) })}`);
        diagnostics.push(`managed document prefix facts: ${JSON.stringify(documentPrefixFacts)}`);
        diagnostics.push(`managed memory prefix facts: ${JSON.stringify(memoryPrefixFacts)}`);
        diagnostics.push(`managed memory output qualification facts: ${JSON.stringify(memoryOutputQualificationFacts)}`);
        diagnostics.push(`managed memory output source facts: ${JSON.stringify(memoryOutputSourceFacts)}`);
        diagnostics.push(`managed context invocation facts: ${JSON.stringify(contextInvocationFacts)}`);
        diagnostics.push(`managed Context source facts: ${JSON.stringify(contextReadSourceFacts)}`);
        diagnostics.push(`managed context transaction owners: ${JSON.stringify([...contextTransactionOwners].slice(0, 40))}`);
        if (input.expectProjectWorkspaceSourceDenial) {
          const denied = brokerRequests.some(value => value.includes("response POST /runtime-tools/model/v1/messages 403"));
          expect(denied, "a workspace edit must make the prior Project source stale before the next provider dispatch").toBe(true);
          expect(responseCount).toBe(1);
          const [deniedRun] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson })
            .from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
          const deniedProfile = deniedRun?.runnerProfileJson && typeof deniedRun.runnerProfileJson === "object"
            ? deniedRun.runnerProfileJson as Record<string, unknown> : {};
          const denialCaptures = Array.isArray(deniedProfile.nativeToolResultSourceCaptures)
            ? deniedProfile.nativeToolResultSourceCaptures.filter(value => value && typeof value === "object" &&
                (value as Record<string, unknown>).tool === "call_api") as Array<Record<string, unknown>> : [];
          expect(denialCaptures).toHaveLength(2);
          return { projectWorkspaceSourceDenial: { status: 403, providerResponsesBeforeDenial: responseCount,
            originalCaptureRetained: denialCaptures.some(value => value.managedOpenCode !== true),
            managedToolResultRetained: denialCaptures.some(value => value.managedOpenCode === true) } };
        }
        throw new Error(`managed_opencode_runner_exit_${result.exitCode}; providerResponses=${responseCount}; fakeFetchEntrances=${JSON.stringify(fakeFetchEntrances)}\n${diagnostics.join("\n")}\nBroker: ${JSON.stringify(brokerFailureFacts())}\nArtifacts: ${runRoot}`);
      }
      completedNativeFinalization = (result as unknown as Record<string, unknown>).nativeFinalization as NonNullable<typeof completedNativeFinalization>;
      expect(responseCount).toBeGreaterThanOrEqual(2);
      expect(qualifiedManagedProcessAtFirstProviderRequest,
        `qualified OpenCode process must use the run-owned data home before the first provider response; observed=${JSON.stringify(openCodeProcessFacts)}`)
        .toBe(true);
      const assertManagedConfigCleanup = async () => {
        expect((await stat(configDirectory)).mode & 0o777).toBe(0o700);
        expect((await stat(join(configDirectory, ".gitignore"))).mode & 0o777).toBe(0o400);
        await expect(stat(join(configDirectory, "opencode.json"))).rejects.toMatchObject({ code: "ENOENT" });
        await expect(stat(join(configDirectory, "plugins", "paperclip-source-witness.js"))).rejects.toMatchObject({ code: "ENOENT" });
      };
      await assertManagedConfigCleanup();
      // Reopen the same normalized session directory to exercise warm XDG
      // reuse: the driver must restore owner write bits before replacing its
      // files, then return the directory and ignore file to read-only before
      // OpenCode starts and attempts its implicit SDK install.
      const warmDriver = new OpenCodeServerDriver({ model: execution.provider.model!,
        runtimeDirectory, command: opencodeBinary, runnerInstanceId: prepared.runnerInstanceId,
        systemInstructions: "Warm managed runtime startup probe.", environment: runnerEnvironment,
        onSpawn: assertManagedConfigIsReadOnlyBeforeSpawn,
        onDiagnostic: message => diagnostics.push(message) });
      const warmSession = await warmDriver.openSession({ runId: run!.id,
        normalizedSessionId: prepared.normalizedSessionId, workingDirectory: execution.workspace.cwd });
      await warmSession.close({ reason: "managed E2E warm-start probe complete" });
      await assertManagedConfigCleanup();
    } finally {
      for (const timer of processTreeTimers) clearInterval(timer);
      if (pgMonitorTimer) clearInterval(pgMonitorTimer);
      if (contextProbeTimer) clearInterval(contextProbeTimer);
      if (contextInvocationWatchTimer) clearInterval(contextInvocationWatchTimer);
      await pgMonitor.end({ timeout: 1 });
      broker.closeAllConnections();
      await new Promise<void>(resolveClose => broker.close(() => resolveClose()));
      if (apiServer) {
        apiServer.closeAllConnections();
        await new Promise<void>(resolveClose => apiServer!.close(() => resolveClose()));
      }
      if (originalPaperclipApiUrl === undefined) delete process.env.PAPERCLIP_API_URL;
      else process.env.PAPERCLIP_API_URL = originalPaperclipApiUrl;
    }
    const [persistedRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    const sourceReceipt = persistedRun!.runnerProfileJson as Record<string, unknown>;
    expect(sourceReceipt.nativeOpenCodeSourceAuthority).toMatchObject({ version: 1, toolSchemas: expect.any(Array) });
    expect(persistedRun!.nativeInputSourceProtocolVersion).toBe(1);
    expect(nativeRunInputSourceReceiptSchema.safeParse(sourceReceipt.nativeInputSourceReceipt).success).toBe(true);
    const effectSteps = modelSteps.filter(step => ["write_document", "create_task", "self_remember", "read_context"]
      .includes(step.tool));
    const capturedResults = Array.isArray(sourceReceipt.nativeToolResultSourceCaptures)
      ? sourceReceipt.nativeToolResultSourceCaptures as Array<Record<string, unknown>> : [];
    for (const [index, step] of effectSteps.entries()) {
      const callId = step.id ?? `managed-e2e-${step.tool}-${modelSteps.indexOf(step)}`;
      expect(capturedResults, `missing managed output source capture for step ${index}:${step.tool}`)
        .toEqual(expect.arrayContaining([expect.objectContaining({ managedOpenCode: true, callId })]));
    }
    const documentSteps = modelSteps.filter(step => step.tool === "write_document");
    // Exercise the real current-source HTTP reader after the producer run is
    // terminal and the exact output is published on an open Task.
    const nativeFinalization = completedNativeFinalization;
    expect(nativeFinalization).not.toBeNull();
    if (!nativeFinalization) throw new Error("managed_opencode_finalization_missing");
    const controlPlane = new PaperclipControlPlanePort(db, {
      companyId, issueId: task.id, runId: run!.id, agentId,
      sessionId: nativeFinalization.normalizedSessionId,
      completionContractId: contractRow.id, completionContractSha256: contractRow.canonicalSha256,
      sourceInstanceId: nativeFinalization.sourceInstanceId,
      controlPlaneSourceInstanceId: nativeFinalization.sourceInstanceId,
    });
    await controlPlane.completeRun({ result: nativeFinalization.result as PrpStructuredRunResult,
      terminal: nativeFinalization.terminal, turnId: nativeFinalization.turnId,
      callerResultId: `managed-opencode-e2e:${run!.id}` });
    await finalizeNativeRun({ db, runId: run!.id, workspaceFinalizeStatus: "succeeded", projectRunStatus: true });
    const [terminalRun] = await db.select({ status: heartbeatRuns.status, nativePhase: heartbeatRuns.nativePhase })
      .from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    expect(terminalRun?.status).toBe("succeeded");
    expect(await recordNativeLocalProcessStopAfterExit(db, companyId, run!.id)).toBe(true);
    await runtimeEnvironment.releaseRunLeases(run!.id, "released");
    expect(completedHumanActions.size).toBe(input.humanActions?.length ?? 0);
    const bobApp = express();
    bobApp.use(express.json());
    bobApp.use((req, _res, next) => { req.actor = bobActor as typeof req.actor; next(); });
    bobApp.use("/api", issueRoutes(db, {} as never)); bobApp.use(errorHandler);
    const documents = [] as Array<{ key: string; id: string | null; snapshot: unknown; aliceHttpStatus: number; bobHttpStatus: number }>;
    for (const step of documentSteps) {
      const key = typeof step.input?.key === "string" ? step.input.key : null;
      if (!key) throw new Error("managed_fixture_document_key_missing");
      const visibleDocument = await documentService(db).getIssueDocumentByKey(task.id, key);
      const [documentLink] = await db.select().from(issueDocuments)
        .where(and(eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, task.id)));
      expect(documentLink).toBeDefined();
      const expectedBody = step.input?.body;
      if (typeof expectedBody === "string") expect(visibleDocument?.body).toContain(expectedBody);
      let snapshot: unknown;
      if (visibleDocument?.latestRevisionId) {
        const [snapshotRow] = await db.select({ payloadSourceSnapshot: documentRevisions.payloadSourceSnapshot })
          .from(documentRevisions).where(eq(documentRevisions.id, visibleDocument.latestRevisionId));
        expect(nativePayloadSourceSnapshotSchema.safeParse(snapshotRow?.payloadSourceSnapshot).success).toBe(true);
        snapshot = snapshotRow?.payloadSourceSnapshot;
      }
      const aliceHttpDocument = await request(humanApp).get(`/api/issues/${task.id}/documents/${encodeURIComponent(key)}`);
      expect(aliceHttpDocument.status).toBe(200);
      if (typeof expectedBody === "string") expect(aliceHttpDocument.body.body).toContain(expectedBody);
      const bobHttpDocument = await request(bobApp).get(`/api/issues/${task.id}/documents/${encodeURIComponent(key)}`);
      documents.push({ key, id: visibleDocument?.id ?? null, snapshot,
        aliceHttpStatus: aliceHttpDocument.status, bobHttpStatus: bobHttpDocument.status });
    }
    const reservations = await db.select().from(orchestrationModelReservations)
      .where(and(eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.planId, plan.id)));
    expect(reservations.length).toBeGreaterThanOrEqual(2);
    expect(reservations.every(reservation => reservation.status === "completed" && reservation.providerResponseHash)).toBe(true);
    expect(modelCalls.every(call => call.model === model && Array.isArray(call.messages))).toBe(true);
    expect(JSON.stringify(persistedRun!.runnerProfileJson)).not.toContain(minted.token);
    const actualInvocations = await db.select().from(toolInvocations)
      .where(and(eq(toolInvocations.companyId, companyId), eq(toolInvocations.runId, run!.id)));
    const toolResults = actualInvocations.flatMap(invocation => {
      try {
        if (typeof invocation.idempotencyKey !== "string" || !invocation.idempotencyKey.startsWith(`aw-native-tool:${run!.id}:`)) return [];
        const result = (typeof invocation.workflowResultJson === "string"
          ? JSON.parse(invocation.workflowResultJson) : invocation.workflowResultJson) as Record<string, unknown>;
        const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
          ? result.data as Record<string, unknown> : result;
        const record = data.record && typeof data.record === "object" ? data.record as Record<string, unknown> : null;
        const task = data.task && typeof data.task === "object" ? data.task as Record<string, unknown> : null;
        return [{ invocationId: invocation.id, callId: invocation.idempotencyKey.slice(`aw-native-tool:${run!.id}:`.length),
          toolName: invocation.toolName, status: invocation.status, result,
          memoryId: typeof record?.id === "string" ? record.id : null,
          taskId: typeof task?.id === "string" ? task.id : null }];
      } catch { return []; }
    });
    const memoryOutputs = await Promise.all(toolResults.filter(value => value.toolName === "paperclip-self:remember" && value.memoryId)
      .map(async value => ({ ...value, currentForAlice: await memoryService(db).get(companyId, value.memoryId!, aliceMemoryActor),
        currentForBob: await memoryService(db).get(companyId, value.memoryId!, bobMemoryActor) })));
    const childTaskIds = toolResults.flatMap(value => value.taskId ? [value.taskId] : []);
    const childTasks = childTaskIds.length ? await db.select().from(issues)
      .where(and(eq(issues.companyId, companyId), inArray(issues.id, childTaskIds))) : [];
    const contextReadCaptures = capturedResults.filter(value => value.contextRead !== undefined);
    const privateRootMemoryId = privateRootRef.current?.memoryId ?? null;
    const contextManifestSelectionFacts = await Promise.all(contextReadCaptures.flatMap(value => {
      const contextRead = value.contextRead && typeof value.contextRead === "object" && !Array.isArray(value.contextRead)
        ? value.contextRead as Record<string, unknown> : {};
      const manifestIds = Array.isArray(contextRead.manifestIds) ? contextRead.manifestIds : [];
      return manifestIds.flatMap(manifestValue => {
        const manifest = manifestValue && typeof manifestValue === "object" && !Array.isArray(manifestValue)
          ? manifestValue as Record<string, unknown> : {};
        const contextManifestId = typeof manifest.contextManifestId === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(manifest.contextManifestId)
          ? manifest.contextManifestId : null;
        if (!contextManifestId) return [];
        return [async () => {
          const [items, roots] = await Promise.all([
            db.select({ sourceProvider: contextManifestItems.sourceProvider, sourceRef: contextManifestItems.sourceRef })
              .from(contextManifestItems).where(eq(contextManifestItems.manifestId, contextManifestId)),
            privateRootMemoryId
              ? db.select({ memoryRecordId: contextManifestMemoryRoots.memoryRecordId }).from(contextManifestMemoryRoots)
                .where(and(eq(contextManifestMemoryRoots.manifestId, contextManifestId),
                  eq(contextManifestMemoryRoots.memoryRecordId, privateRootMemoryId)))
              : Promise.resolve([]),
          ]);
          return { contextManifestId,
            selectedPrivateRootItem: privateRootMemoryId !== null && items.some(item =>
              item.sourceProvider === "august_works_memory" && item.sourceRef === `memory://record/${privateRootMemoryId}`),
            retainedPrivateRoot: roots.length === 1 };
        }];
      });
    }).map(read => read()));
    let projectApiReadEvidence: Record<string, unknown> | null = null;
    const projectApiStepIndex = modelSteps.findIndex(step => step.tool === "call_api");
    if (projectApiStepIndex >= 0) {
      if (!fixtureProjectId || !fixtureProjectWorkspaceId) throw new Error("managed_fixture_project_read_not_prepared");
      const projectApiStep = modelSteps[projectApiStepIndex]!;
      const callId = projectApiStep.id ?? `managed-e2e-call_api-${projectApiStepIndex}`;
      const matchingCaptures = capturedResults.filter(value => value.callId === callId && value.tool === "call_api");
      const originalCapture = matchingCaptures.find(value => value.managedOpenCode !== true);
      const managedCapture = matchingCaptures.find(value => value.managedOpenCode === true);
      if (!originalCapture || !managedCapture) throw new Error("managed_fixture_project_read_capture_missing");
      const originalSource = originalCapture.source && typeof originalCapture.source === "object"
        ? originalCapture.source as Record<string, unknown> : {};
      const managedProjectSource = managedCapture.projectSource && typeof managedCapture.projectSource === "object"
        ? managedCapture.projectSource as Record<string, unknown> : {};
      const managedResultSource = managedCapture.source && typeof managedCapture.source === "object"
        ? managedCapture.source as Record<string, unknown> : {};
      const [currentProjectResponse, projectRun] = await Promise.all([
        request(projectApiApp).get(`/api/projects/${fixtureProjectId}`).set("cookie", fixtureProjectHumanCookie!),
        db.select({ resultJson: heartbeatRuns.resultJson }).from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id)).then(rows => rows[0]),
      ]);
      if (currentProjectResponse.status !== 200) throw new Error(`managed_fixture_project_read_current_projection_failed_${currentProjectResponse.status}`);
      const projectDto = currentProjectResponse.body as Record<string, unknown>;
      const workspaces = Array.isArray(projectDto.workspaces) ? projectDto.workspaces : [];
      const primaryWorkspace = projectDto.primaryWorkspace && typeof projectDto.primaryWorkspace === "object"
        ? projectDto.primaryWorkspace as Record<string, unknown> : null;
      const projectionHash = createHash("sha256").update(JSON.stringify(projectDto), "utf8").digest("hex");
      const apiResult = projectRun?.resultJson && typeof projectRun.resultJson === "object"
        ? projectRun.resultJson as Record<string, unknown> : {};
      const apiReceipts = apiResult.apiToolReceipts && typeof apiResult.apiToolReceipts === "object"
        ? apiResult.apiToolReceipts as Record<string, unknown> : {};
      const apiReceiptHash = createHash("sha256").update(callId).digest("hex");
      const apiReceipt = apiReceipts[apiReceiptHash] && typeof apiReceipts[apiReceiptHash] === "object"
        ? apiReceipts[apiReceiptHash] as Record<string, unknown> : {};
      const captureRequestHash = typeof originalCapture.requestHash === "string" ? originalCapture.requestHash : null;
      const dispatchAssociations = Array.isArray(sourceReceipt.nativeToolCallDispatchAssociations)
        ? sourceReceipt.nativeToolCallDispatchAssociations as Array<Record<string, unknown>> : [];
      const matchingAssociations = dispatchAssociations.filter(value => value.callId === callId &&
        value.turnId === originalCapture.turnId && value.eventSeq === originalCapture.eventSeq &&
        value.attempt === originalCapture.attempt && value.tool === "call_api" &&
        value.argumentsHash === managedCapture.argumentsHash);
      const inputReceipt = sourceReceipt.nativeInputSourceReceipt && typeof sourceReceipt.nativeInputSourceReceipt === "object"
        ? sourceReceipt.nativeInputSourceReceipt as Record<string, unknown> : {};
      const additionalInputs = Array.isArray(inputReceipt.additionalInputs)
        ? inputReceipt.additionalInputs as Array<Record<string, unknown>> : [];
      const matchingSourceSets = additionalInputs.filter(value => {
        const inputs = Array.isArray(value.inputs) ? value.inputs as Array<Record<string, unknown>> : [];
        return inputs.some(source => source.kind === "tool_result" && source.callId === callId);
      });
      const consumedInputs = matchingSourceSets.length === 1 && Array.isArray(matchingSourceSets[0]!.inputs)
        ? matchingSourceSets[0]!.inputs as Array<Record<string, unknown>> : [];
      const policy = matchingSourceSets.length === 1 && matchingSourceSets[0]!.policy &&
        typeof matchingSourceSets[0]!.policy === "object"
        ? matchingSourceSets[0]!.policy as Record<string, unknown> : {};
      const toolResultInput = consumedInputs.find(value => value.kind === "tool_result");
      const projectInput = consumedInputs.find(value => value.kind === "project");
      expect(workspaces).toEqual(expect.arrayContaining([expect.objectContaining({ id: fixtureProjectWorkspaceId, isPrimary: true })]));
      expect(primaryWorkspace).toMatchObject({ id: fixtureProjectWorkspaceId, isPrimary: true });
      expect(originalSource).toMatchObject({ kind: "project", projectId: fixtureProjectId,
        contentHash: projectionHash });
      expect(managedProjectSource).toEqual(originalSource);
      expect(managedCapture).toMatchObject({ callId, tool: "call_api", resultDigest: originalCapture.resultDigest,
        turnId: originalCapture.turnId, eventSeq: originalCapture.eventSeq, attempt: originalCapture.attempt });
      expect(managedResultSource).toEqual({ kind: "tool_result", runId: run!.id, callId,
        toolName: "call_api", invocationId: null, contentHash: originalCapture.resultDigest });
      expect(apiReceipt).toMatchObject({ callId, turnId: originalCapture.turnId, eventSeq: originalCapture.eventSeq,
        attempt: originalCapture.attempt, operationId: "GET /api/projects/{id}", method: "GET",
        pathAndQuery: `/api/projects/${fixtureProjectId}`, requestHash: captureRequestHash,
        argumentsHash: managedCapture.argumentsHash, state: "completed", status: 200,
        resultDigest: originalCapture.resultDigest });
      expect(matchingAssociations).toHaveLength(1);
      expect(matchingSourceSets).toHaveLength(1);
      expect(policy).toEqual({ issueIds: [], projectIds: [fixtureProjectId], runIds: [], memoryIds: [],
        foundationRevisionIds: [] });
      expect(consumedInputs).toHaveLength(2);
      expect(toolResultInput).toEqual({ kind: "tool_result", runId: run!.id, callId,
        toolName: "call_api", invocationId: null, contentHash: originalCapture.resultDigest });
      expect(projectInput).toEqual(originalSource);
      const consumedProjectResult = projectApiResultConsumers.filter(value => value.callId === callId);
      expect(consumedProjectResult).toEqual([{ callId, consumed: true, contentDigest: originalCapture.resultDigest }]);
      projectApiReadEvidence = { providerContinued: responseCount >= 2, toolSchemaPinned: true,
        providerConsumedExactNonErrorToolResult: consumedProjectResult.length === 1 && consumedProjectResult[0]!.consumed,
        projectSourceMatchedCurrentExpandedProjection: originalSource.contentHash === projectionHash,
        hasPrimaryWorkspaceInProjection: Boolean(primaryWorkspace?.id === fixtureProjectWorkspaceId),
        matchingOriginalAndManagedCaptures: matchingCaptures.length === 2,
        matchingAssociation: matchingAssociations.length === 1,
        exactAdditionalInputClosure: matchingSourceSets.length === 1 && consumedInputs.length === 2 };
    }
    return {
      companyId,
      agentId,
      reuseIdentity: { companyId, agentId, aliceUserId, bobUserId },
      runId: run!.id,
      issueId: task.id,
      aliceUserId,
      aliceActor: human,
      bobActor,
      aliceMemoryActor,
      bobUserId,
      bobMemoryActor,
      documents,
      sourceReceipt: sourceReceipt.nativeInputSourceReceipt,
      toolResultSourceCaptures: sourceReceipt.nativeToolResultSourceCaptures,
      toolInvocations: actualInvocations,
      toolResults,
      memoryOutputs,
      acceptedMemoryIds,
      contextReadCaptures,
      contextManifestSelectionFacts,
      contextResultConsumers,
      projectApiResultConsumers,
      projectApiReadEvidence,
      childTasks,
      modelCalls: modelCalls.length,
      completedRun: terminalRun,
      nativeFinalization,
      privateRoot: privateRootRef.current,
    };
}
