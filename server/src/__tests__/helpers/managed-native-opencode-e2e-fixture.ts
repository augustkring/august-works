import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
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
  issueComments,
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
import { assertNativeMemoryOutputSnapshotCurrent, assertNativePayloadSourceSetCurrent,
  nativeSourceMemoDiagnosticsForTest } from "../../services/native-direct-input.js";
import type { AuthorizationActor } from "../../services/authorization.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { orchestrationService } from "../../services/orchestration/orchestration-service.js";
import { workerModelGateway } from "../../services/orchestration/worker-model-gateway.js";
import { blenteraPlatformContractHashes, createToolGatewayService } from "../../services/tool-gateway.js";
import { preparePlatformSkillAdmission } from "../../services/platform-skill-admission.js";
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
  tool: "write_document" | "create_task" | "create_project" | "self_remember" | "read_context" | "call_api" | "paperclip_finish";
  id?: string;
  input?: Record<string, unknown>;
};

export type ManagedNativeOpenCodeHumanAction = {
  afterModelToolCallId: string;
  action: "accept_memory_candidate" | "create_private_context_root" | "edit_project_workspace";
};

export type ManagedNativeMemoryReplayProbe = {
  callId: string;
  run: (input: {
    companyId: string;
    runId: string;
    callId: string;
    initialResult: unknown;
    replay: () => Promise<unknown>;
    acceptOutput: (recordId: string) => Promise<void>;
    revokeOutput: (recordId: string) => Promise<void>;
    assertConsumedInputsCurrent: (recordId: string) => Promise<void>;
  }) => Promise<void>;
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
  taskTitle?: string;
  /** Execute an already sealed Task as this fixture's actual Native run root. */
  existingTaskId?: string;
  humanActions?: ManagedNativeOpenCodeHumanAction[];
  /** Prepare a private Task source; create its Human-reviewed Memory root after the configured model step. */
  privateContextContent?: string;
  /** Use an authenticated, Human-sealed conversation as the admitted worker-plan root. */
  conversationRoot?: boolean;
  /** Return early after a Human workspace change is rejected as a stale Project source. */
  expectProjectWorkspaceSourceDenial?: boolean;
  /** Test-only probe that repeats one actual, sealed Gateway Memory call with its original scoped invocation context. */
  nativeMemoryReplayProbe?: ManagedNativeMemoryReplayProbe;
  /** Stop after the first real provider request to qualify the spawned OpenCode process in isolation. */
  processProbeOnly?: boolean;
  /** Test-only barrier after exact provider capture and before managed Project source validation/mutation. */
  beforeManagedProjectCreate?: (capture: import("../../services/native-runtime/native-execution-input.js").NativeModelOutputCapture) => Promise<void>;
  /** Test-only exact same-call Project replay probe after the original commit. */
  afterManagedProjectCreate?: (input: { actor: AuthorizationActor; companyId: string; issueId: string;
    capture: import("../../services/native-runtime/native-execution-input.js").NativeModelOutputCapture;
    callId: string; arguments: Record<string, unknown>; result: { project: Record<string, unknown>; receipt: import("../../services/native-project-output.js").NativeProjectCreateReceipt;
      sourceSet: import("../../services/native-runtime/native-execution-input.js").NativePayloadSourceSet } }) => Promise<void>;
  /** Validate the exact persisted Project source prefix when its actual tool_result reaches the next provider request. */
  nativeProjectCreatePrefixProbe?: { callId: string };
  reuseIdentity?: { companyId: string; agentId: string; aliceUserId: string; bobUserId: string;
    aliceSessionId?: string; bobSessionId?: string };
  onPreserveDebugArtifacts?: () => void;
}) {
  const { db, root, instanceId } = input;
  const diagnosticsEnabled = process.env.PAPERCLIP_MANAGED_OPENCODE_E2E_DIAGNOSTICS === "1";
  const ownerFrameDiagnosticsEnabled = process.env.PAPERCLIP_MANAGED_OPENCODE_OWNER_FRAMES === "1";
  const sourceFirstRequestProbeEnabled = process.env.PAPERCLIP_NATIVE_SOURCE_FIRST_REQUEST_PROBE === "1";
  const sourceMemoDiagnosticsEnabled = process.env.PAPERCLIP_NATIVE_SOURCE_MEMO_DIAGNOSTICS === "1" ||
    sourceFirstRequestProbeEnabled;
  let contextProbeCallId: string | null = null;
  let pendingContextProbeCallId: string | null = null;
  let pendingContextProbeStartedAt: number | null = null;
  let contextProbeStartedAt: number | null = null;
  let contextProbeCompletedAt: number | null = null;
  let contextProbeSamples = 0;
  let contextPostCaptureProbeStartedAt: number | null = null;
  let contextPostCaptureProbeSamples = 0;
  let finalExchangeProbeTimer: ReturnType<typeof setInterval> | undefined;
  let finalExchangeProbeStartedAt: number | null = null;
  let finalExchangeProbeSamples = 0;
  let sourceLockSnapshotTimer: ReturnType<typeof setTimeout> | undefined;
  let captureSourceLockSnapshot: () => Promise<void> = async () => undefined;
  let sourceLockSnapshot: { elapsedMs: number; rows: Array<Record<string, unknown>> } | null = null;
  let sourceLockSnapshotStartedAt: number | null = null;
  let sourceMemoLabelTransactions = false;
  const contextTransactionOwners = new Set<string>();
  const contextTransactionOwnerFrames = new Map<string, string[]>();
  const sourceMemoTransactionRecords: Array<{ txOrdinal: number; startedAtElapsedMs: number; heldMs: number; frames: string[] }> = [];
  const sourceMemoActiveTransactions = new Map<number, { startedAtElapsedMs: number; startedAt: number; frames: string[] }>();
  const sourceMemoStartedAt = performance.now();
  const sourceMemoTxOrdinalMap = new WeakMap<object, number>();
  const sourceMemoTxOrdinalSymbol = Symbol.for("paperclip.nativeSourceMemoDiagnosticTxOrdinals.v1");
  if (sourceMemoDiagnosticsEnabled)
    (globalThis as unknown as Record<PropertyKey, unknown>)[sourceMemoTxOrdinalSymbol] = sourceMemoTxOrdinalMap;
  let sourceMemoTxOrdinal = 0;
  const ownerDb = db as typeof db & { transaction: typeof db.transaction };
  const originalRootTransaction = ownerDb.transaction.bind(ownerDb);
  const instrumentedRootTransaction = (async (...args: Parameters<typeof db.transaction>) => {
    const [callback, config] = args;
    let memoTxOrdinal: number | undefined;
    let memoTxStartedAt: number | undefined;
    let memoTxObject: object | undefined;
    const memoTxFrames = sourceMemoDiagnosticsEnabled ? new Error().stack?.split("\n").flatMap(line => {
      const match = /server\/src\/services\/([A-Za-z0-9_./-]+\.ts):(\d+):\d+/.exec(line);
      return match ? [`${match[1]}:${match[2]}`] : [];
    }).slice(0, 4) ?? [] : [];
    try { return await originalRootTransaction(async tx => {
      if (sourceMemoDiagnosticsEnabled) {
        memoTxOrdinal = ++sourceMemoTxOrdinal;
        memoTxStartedAt = performance.now();
        memoTxObject = tx as object;
        sourceMemoTxOrdinalMap.set(memoTxObject, memoTxOrdinal);
        sourceMemoActiveTransactions.set(memoTxOrdinal, {
          startedAtElapsedMs: Math.max(0, memoTxStartedAt - sourceMemoStartedAt),
          startedAt: memoTxStartedAt, frames: memoTxFrames,
        });
      }
      if (contextProbeCallId || finalExchangeProbeStartedAt !== null || ownerFrameDiagnosticsEnabled) {
        const stack = new Error().stack ?? "";
        const serviceFrames = stack.split("\n").map(line => line.trim())
          .map(line => /server\/src\/services\/([A-Za-z0-9_./-]+\.ts):(\d+):\d+/.exec(line))
          .filter((frame): frame is RegExpExecArray => Boolean(frame)).slice(0, 6)
          .map(frame => `${frame[1]}:${frame[2]}`);
        const sourceLocation = serviceFrames[0] && /([A-Za-z0-9_./-]+\.ts):(\d+)/.exec(serviceFrames[0]);
        const moduleName = sourceLocation?.[1]?.split("/").at(-1)?.replace(/\.ts$/, "") ?? "service";
        const lineNumber = sourceLocation?.[2] ?? "0";
        const ownerLabel = `fx.${moduleName}:${lineNumber}`.slice(0, 63);
        contextTransactionOwners.add(ownerLabel);
        if (!contextTransactionOwnerFrames.has(ownerLabel) && contextTransactionOwnerFrames.size < 160)
          contextTransactionOwnerFrames.set(ownerLabel, serviceFrames);
        if (contextProbeCallId || finalExchangeProbeStartedAt !== null)
          await tx.execute(sql`select set_config('application_name', ${ownerLabel}, true)`);
      }
      if (sourceMemoDiagnosticsEnabled && sourceMemoLabelTransactions && memoTxOrdinal !== undefined) {
        const firstFrame = memoTxFrames[0] ?? "unknown:0";
        const [frameFile, frameLine] = firstFrame.split(":");
        const txLabel = `fx.${memoTxOrdinal}.${frameFile?.split("/").at(-1)?.replace(/\.ts$/, "") ?? "service"}:${frameLine ?? "0"}`
          .slice(0, 63);
        await tx.execute(sql`select set_config('application_name', ${txLabel}, true)`);
      }
      return callback(tx);
    }, config); }
    finally {
      if (memoTxOrdinal !== undefined && memoTxStartedAt !== undefined) {
        const elapsed = Math.max(0, performance.now() - memoTxStartedAt);
        if (memoTxObject) sourceMemoTxOrdinalMap.delete(memoTxObject);
        sourceMemoActiveTransactions.delete(memoTxOrdinal);
        sourceMemoTransactionRecords.push({ txOrdinal: memoTxOrdinal,
          startedAtElapsedMs: Math.max(0, memoTxStartedAt - sourceMemoStartedAt), heldMs: elapsed, frames: memoTxFrames });
        sourceMemoTransactionRecords.sort((a, b) => b.heldMs - a.heldMs);
        sourceMemoTransactionRecords.length = Math.min(sourceMemoTransactionRecords.length, 16);
      }
    }
  }) as typeof db.transaction;
  if (diagnosticsEnabled || ownerFrameDiagnosticsEnabled || sourceMemoDiagnosticsEnabled)
    Object.defineProperty(ownerDb, "transaction", { configurable: true, writable: true, value: instrumentedRootTransaction });
  await instanceSettingsService(db).getExperimental();
  await enableV5ForTest(db);
  await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true,
    role_packs_v5: false, skill_resolver_v5: false, readiness_engine_v7: true, orchestration_v7: true,
    enableContextEngineV1: true, enableCollectiveMemoryV1: true, enablePrivateAgentMemoryV1: true,
    ...(input.conversationRoot ? { enableAgentChat: true } : {}) });
  const defaultSteps: ManagedNativeOpenCodeModelStep[] = [
    { tool: "write_document", id: "managed-e2e-write-1", input: {
      idempotencyKey: "managed-opencode-source-document-v1", key: "managed-source-e2e", title: "Private E2E note",
      body: "This document was written through the governed OpenCode tool boundary.", baseRevisionId: null,
    } },
    { tool: "paperclip_finish", id: "managed-e2e-finish-1" },
  ];
  const modelSteps = input.steps ?? defaultSteps;
  // The managed E2E performs one bounded real provider roundtrip per configured
  // tool step, followed by OpenCode's required final-text roundtrip after finish.
  // Scale only this fixture's whole-turn allowance, never product deadlines.
  const fixtureProviderResponses = modelSteps.length + 1;
  const fixtureTurnTimeoutMs = input.processProbeOnly ? 20_000 : Math.max(90_000, 30_000 * fixtureProviderResponses);
  if (modelSteps.length < 2 || modelSteps.at(-1)?.tool !== "paperclip_finish" ||
    modelSteps.slice(0, -1).some(step => step.tool === "paperclip_finish") ||
    new Set(modelSteps.map((step, index) => step.id ?? `managed-e2e-${step.tool}-${index}`)).size !== modelSteps.length)
    throw new Error("managed_fixture_model_steps_invalid");
  const includesProjectApiRead = modelSteps.some(step => step.tool === "call_api");
  const includesProjectCreate = modelSteps.some(step => step.tool === "create_project");
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
    const sessionId = input.reuseIdentity?.aliceSessionId ?? await seedNativePasskeySession(db, aliceUserId);
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
    const bobSessionId = input.reuseIdentity?.bobSessionId ?? await seedNativePasskeySession(db, bobUserId);
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
    let conversationApp: express.Express | null = null;
    let conversationHumanCookie: string | null = null;
    if (input.conversationRoot) {
      const [session] = await db.select({ id: authSessions.id, userId: authSessions.userId,
        token: authSessions.token, expiresAt: authSessions.expiresAt }).from(authSessions)
        .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, aliceUserId)));
      if (!session || session.expiresAt.getTime() <= Date.now())
        throw new Error("managed_fixture_conversation_human_session_unavailable");
      conversationHumanCookie = `session_token=${encodeURIComponent(session.token)}`;
      conversationApp = express();
      conversationApp.use(express.json());
      conversationApp.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async req => {
        const token = (req.header("cookie") ?? "").split(";").map(value => value.trim())
          .map(value => value.slice(value.indexOf("=") + 1)).map(value => decodeURIComponent(value))
          .find(value => value === session.token);
        if (!token || session.expiresAt.getTime() <= Date.now()) return null;
        const [user] = await db.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
          .from(authUsers).where(eq(authUsers.id, session.userId));
        if (!user) return null;
        const result: BetterAuthSessionResult = { session: { id: session.id, userId: session.userId, expiresAt: session.expiresAt }, user };
        return result;
      } }));
      // The fixture explicitly starts the admitted Worker plan below. Keep the
      // chat route's notification from creating a second conversation-model
      // run, while exercising its real authenticated open/comment owners.
      conversationApp.use("/api", issueRoutes(db, {} as never, { heartbeat: { wakeup: async () => null } as never }));
      conversationApp.use(errorHandler);
    }
    const projectApiApp = express();
    projectApiApp.use(express.json());
    let fixtureProjectHumanCookie: string | null = null;
    let fixtureProjectBobCookie: string | null = null;
    if (includesProjectApiRead || includesProjectCreate) {
      const [projectSession, projectBobSession] = await Promise.all([
        db.select({ id: authSessions.id, userId: authSessions.userId,
        token: authSessions.token, expiresAt: authSessions.expiresAt })
          .from(authSessions).where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, aliceUserId)))
          .then(rows => rows[0]),
        db.select({ id: authSessions.id, userId: authSessions.userId,
          token: authSessions.token, expiresAt: authSessions.expiresAt })
          .from(authSessions).where(and(eq(authSessions.id, bobSessionId), eq(authSessions.userId, bobUserId)))
          .then(rows => rows[0]),
      ]);
      if (!projectSession || projectSession.expiresAt.getTime() <= Date.now() ||
          !projectBobSession || projectBobSession.expiresAt.getTime() <= Date.now())
        throw new Error("managed_fixture_project_human_session_unavailable");
      fixtureProjectHumanCookie = `session_token=${encodeURIComponent(projectSession.token)}`;
      fixtureProjectBobCookie = `session_token=${encodeURIComponent(projectBobSession.token)}`;
      projectApiApp.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async req => {
        const cookieToken = (req.header("cookie") ?? "").split(";").map(value => value.trim())
          .map(value => value.slice(value.indexOf("=") + 1)).map(value => decodeURIComponent(value)).find(value =>
            value === projectSession.token || value === projectBobSession.token);
        const session = cookieToken === projectSession.token ? projectSession
          : cookieToken === projectBobSession.token ? projectBobSession : null;
        if (!session || session.expiresAt.getTime() <= Date.now()) return null;
        const [user] = await db.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
          .from(authUsers).where(eq(authUsers.id, session.userId));
        if (!user) return null;
        const result: BetterAuthSessionResult = {
          session: { id: session.id, userId: session.userId, expiresAt: session.expiresAt },
          user,
        };
        return result;
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
    let task: typeof issues.$inferSelect;
    if (input.conversationRoot) {
      if (!conversationApp || !conversationHumanCookie)
        throw new Error("managed_fixture_conversation_routes_unavailable");
      const opened = await request(conversationApp).post(`/api/companies/${companyId}/chats/${agentId}`)
        .set("cookie", conversationHumanCookie).send({});
      expect(opened.status, JSON.stringify(opened.body)).toBe(200);
      if (typeof opened.body.id !== "string") throw new Error("managed_fixture_conversation_issue_missing");
      const commentRequestId = randomUUID();
      const comment = await request(conversationApp).post(`/api/issues/${opened.body.id}/comments`)
        .set("cookie", conversationHumanCookie).send({ body: "Start the admitted source-bound Worker plan.",
          clientRequestId: commentRequestId });
      expect(comment.status, JSON.stringify(comment.body)).toBe(201);
      const [openedTask] = await db.select().from(issues)
        .where(and(eq(issues.companyId, companyId), eq(issues.id, opened.body.id)));
      const [humanComment] = await db.select({ authorUserId: issueComments.authorUserId,
        protocolVersion: issueComments.payloadSourceProtocolVersion, snapshot: issueComments.payloadSourceSnapshot,
        invalidated: issueComments.payloadSourceSnapshotInvalidated }).from(issueComments).where(and(
        eq(issueComments.companyId, companyId), eq(issueComments.issueId, opened.body.id),
        eq(issueComments.clientRequestId, commentRequestId)));
      if (!openedTask?.payloadSourceSnapshot || openedTask.payloadSourceSnapshotInvalidated ||
        openedTask.conversationAgentId !== agentId || openedTask.conversationUserId !== aliceUserId ||
        humanComment?.authorUserId !== aliceUserId || humanComment.protocolVersion !== 1 ||
        !humanComment.snapshot || humanComment.invalidated)
        throw new Error("managed_fixture_conversation_task_was_not_human_sealed");
      task = openedTask;
    } else if (input.existingTaskId) {
      const [existingTask] = await db.select().from(issues).where(and(
        eq(issues.companyId, companyId), eq(issues.id, input.existingTaskId)));
      if (!existingTask?.payloadSourceSnapshot || existingTask.payloadSourceProtocolVersion !== 1 ||
        existingTask.payloadSourceSnapshotInvalidated)
        throw new Error("managed_fixture_existing_task_source_was_not_sealed");
      await db.update(issues).set({ status: "todo", assigneeAgentId: agentId })
        .where(and(eq(issues.companyId, companyId), eq(issues.id, existingTask.id)));
      task = (await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, existingTask.id))))[0]!;
    } else {
      const createTaskResponse = await request(humanApp).post(`/api/companies/${companyId}/issues`)
        .send({ title: input.taskTitle ?? "Save a source-bound note", description: "Create a short internal note and finish the task.",
          responsibleUserId: aliceUserId, visibility: "open" });
      expect(createTaskResponse.status, JSON.stringify(createTaskResponse.body)).toBe(201);
      const createdTask = createTaskResponse.body as { id: string };
      await db.update(issues).set({ status: "todo", assigneeAgentId: agentId,
        ...(fixtureProjectId ? { projectId: fixtureProjectId } : {}) })
        .where(and(eq(issues.companyId, companyId), eq(issues.id, createdTask.id)));
      task = (await db.select().from(issues).where(eq(issues.id, createdTask.id)))[0]!;
      if (task.payloadSourceProtocolVersion !== 1 || !task.payloadSourceSnapshot ||
          task.payloadSourceSnapshotInvalidated || task.visibility !== "open")
        throw new Error("managed_fixture_human_task_source_was_not_sealed");
    }
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId, responsibleUserId: aliceUserId,
      status: "running", runtimeMode: "native", nativeIssueId: task.id,
      contextSnapshot: { issueId: task.id, ...(task.conversationSessionGeneration !== null
        ? { conversationSessionGeneration: task.conversationSessionGeneration } : {}) } }).returning();
    await preparePlatformSkillAdmission(db, { companyId, agentId, runId: run!.id,
      responsibleUserId: aliceUserId, requireExisting: false }, blenteraPlatformContractHashes());
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
      completionContract: { objective: input.conversationRoot
        ? "Complete the admitted Worker plan from the Human-sealed conversation root"
        : "Complete the managed source-bound task", requiredOutputs: (() => {
        const keys = modelSteps.filter(step => step.tool === "write_document")
          .map(step => step.input?.key).filter((key): key is string => typeof key === "string");
        const documentOutputs = keys.map(key => ({ kind: "task_document" as const, key }));
        const projectOutputs = modelSteps.filter(step => step.tool === "create_project")
          .map((_step, index) => ({ kind: "private_project" as const, key: index === 0 ? "project" : `project_${index + 1}` }));
        return [...documentOutputs, ...projectOutputs];
      })(),
        businessInvariants: [input.conversationRoot
          ? "Use only the Human-sealed conversation and current authorized sources; create only backlog drafts"
          : "Use only this task's supplied workspace"] },
      budgets: { maxModelCostMinor: Math.max(10, fixtureProviderResponses * 2), maxToolActions: modelSteps.length + 2 },
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
    await db.update(heartbeatRuns).set({ runnerProfileJson: sql`coalesce(${heartbeatRuns.runnerProfileJson}, '{}'::jsonb) ||
      ${JSON.stringify({ nativeExecutionInput: execution })}::jsonb` }).where(eq(heartbeatRuns.id, run!.id));
    const leaseOwner = `managed-opencode-e2e:${randomUUID()}`;
    const controller = await currentNativeControllerIdentity();
    await db.insert(nativeRunFinalizations).values({ runId: run!.id, companyId, issueId: task.id,
      phase: "running", attempt: 1, leaseOwner, leaseExpiresAt: new Date(Date.now() + 120_000),
      controllerBootId: controller.bootId, controllerPid: controller.pid,
      controllerProcessStartedAt: controller.processStartedAt });

    let responseCount = 0;
    let brokerPostCount = 0;
    const fakeFetchEntrances: Array<{ host: string; path: string; apiKeyHeader: boolean; bearerHeader: boolean }> = [];
    let qualifiedManagedProcessAtFirstProviderRequest = false;
    let refreshOpenCodeProcessFacts: (() => Promise<void>) | null = null;
    const modelCalls: Array<Record<string, unknown>> = [];
    const contextResultConsumers: Array<{ callId: string; consumed: boolean }> = [];
    const projectApiResultConsumers: Array<{ callId: string; consumed: boolean; contentDigest: string | null }> = [];
    const projectCreateResultConsumers: Array<{ callId: string; consumed: boolean; projectId: string | null;
      privateProject: boolean; contentDigest: string | null }> = [];
    const brokerRequests: string[] = [];
    const brokerFailureFacts = () => brokerRequests
      .filter(value => !value.startsWith("managed-tool-schema-comparison ")).slice(-40);
    const submittedPromptFacts: Array<{ length: number; sha256: string }> = [];
    let managedConfigReadOnlyVerified = false;
    const assignedToolGateway = createToolGatewayService(db);
    let pendingNativeMemoryReplayProbe: { initialResult: unknown; replay: () => Promise<unknown> } | null = null;
    let nativeMemoryReplayProbeCompleted = false;
    let nativeMemoryReplayProbeToolResultObserved = false;
    let nativeMemoryReplayProbePhase = "not_started";
    let nativeMemoryReplayProbeFailure: { phase: string; name: string; code?: string; message: string } | null = null;
    let nativeProjectCreatePrefixProbeCompleted = false;
    let nativeProjectCreatePrefixProbeToolResultObserved = false;
    let nativeProjectCreatePrefixProbeEvidence: Record<string, unknown> | null = null;
    const nativeReplayProbeSafeMessages = new Set([
      "Managed Memory replay receipt is unavailable", "Managed Memory replay transaction is unavailable",
      "Managed Memory replay receipt is no longer current", "Managed Memory output is no longer current",
      "Managed Memory output changed during replay validation", "Managed Memory output destination is no longer readable",
      "The Native output capture is unavailable", "The Native output capture is not bound to its settled provider tool use",
      "The Native output capture lacks its consumed source components", "The Native consumed source set is unavailable",
      "The Native consumed source receipt is unavailable", "The Native source component is malformed",
      "A Native output Memory source is unavailable", "A Native Memory source is unavailable",
      "A Native output Task source is unavailable", "A Native output Task source changed or was erased",
    ]);
    if (input.nativeMemoryReplayProbe) {
      const probe = input.nativeMemoryReplayProbe;
      const probeStep = modelSteps.find(step => step.id === probe.callId && step.tool === "self_remember");
      const idempotencyKey = probeStep?.input?.idempotencyKey;
      if (typeof idempotencyKey !== "string") throw new Error("managed_fixture_memory_replay_probe_step_missing");
      const executeAssignedTool = assignedToolGateway.executeTool.bind(assignedToolGateway);
      let probeCompleted = false;
      assignedToolGateway.executeTool = async (call, workflowContext, scopedContext) => {
        const initialResult = await executeAssignedTool(call, workflowContext, scopedContext);
        const parameters = call.parameters && typeof call.parameters === "object" && !Array.isArray(call.parameters)
          ? call.parameters as Record<string, unknown> : {};
        if (!probeCompleted && call.tool === "paperclip-self:remember" && parameters.idempotencyKey === idempotencyKey) {
          probeCompleted = true;
          pendingNativeMemoryReplayProbe = { initialResult,
            replay: () => executeAssignedTool(call, workflowContext, scopedContext) };
        }
        return initialResult;
      };
    }
    const runNativeMemoryReplayProbe = async () => {
      const pending = pendingNativeMemoryReplayProbe;
      if (!input.nativeMemoryReplayProbe || !pending || nativeMemoryReplayProbeCompleted) return;
      const probe = input.nativeMemoryReplayProbe;
      nativeMemoryReplayProbePhase = "bind_output_result";
      const envelope = pending.initialResult && typeof pending.initialResult === "object" && !Array.isArray(pending.initialResult)
        ? pending.initialResult as Record<string, unknown> : {};
      const result = envelope.result && typeof envelope.result === "object" && !Array.isArray(envelope.result)
        ? envelope.result as Record<string, unknown> : {};
      const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? result.data as Record<string, unknown> : {};
      const outputRecord = data.record && typeof data.record === "object" && !Array.isArray(data.record)
        ? data.record as Record<string, unknown> : {};
      const recordId = typeof outputRecord.id === "string" ? outputRecord.id : null;
      if (!recordId || envelope.status !== "completed")
        throw new Error("managed_fixture_memory_replay_initial_result_unavailable");
      const [output] = await db.select({ payloadSourceSnapshot: memoryRecords.payloadSourceSnapshot }).from(memoryRecords)
        .where(and(eq(memoryRecords.companyId, companyId), eq(memoryRecords.id, recordId)));
      const snapshot = nativePayloadSourceSnapshotSchema.parse(output?.payloadSourceSnapshot);
      const dispatchIndex = snapshot.inputs.findIndex(value => value.kind === "worker_model_dispatch");
      if (dispatchIndex !== snapshot.inputs.length - 1 || dispatchIndex < 0)
        throw new Error("managed_fixture_memory_replay_source_prefix_missing");
      const actor: AuthorizationActor = { type: "agent", source: "none", companyId, agentId,
        runId: run!.id, onBehalfOfUserId: aliceUserId };
      let replayCount = 0;
      let consumedInputCheckCount = 0;
      await probe.run({ companyId, runId: run!.id, callId: probe.callId, initialResult: pending.initialResult,
        replay: () => {
          replayCount += 1;
          nativeMemoryReplayProbePhase = replayCount === 1 ? "matching_replay" : "revoked_output_replay";
          return pending.replay();
        },
        acceptOutput: async requestedRecordId => {
          if (requestedRecordId !== recordId) throw new Error("managed_fixture_memory_replay_output_changed");
          nativeMemoryReplayProbePhase = "accept_output";
          await memoryService(db).reviewCandidate(companyId, recordId, { decision: "accept" }, aliceMemoryActor);
        },
        revokeOutput: async requestedRecordId => {
          if (requestedRecordId !== recordId) throw new Error("managed_fixture_memory_replay_output_changed");
          nativeMemoryReplayProbePhase = "revoke_output";
          await memoryService(db).revoke(companyId, recordId,
            { reason: "The Human revoked this output during its live Native replay test." }, aliceMemoryActor);
        },
        assertConsumedInputsCurrent: async requestedRecordId => {
          if (requestedRecordId !== recordId) throw new Error("managed_fixture_memory_replay_output_changed");
          consumedInputCheckCount += 1;
          nativeMemoryReplayProbePhase = consumedInputCheckCount === 1 ? "source_prefix_before_replay" : "source_prefix_after_revoke";
          await assertNativePayloadSourceSetCurrent(db, { companyId, issueId: task.id, runId: run!.id, actor,
            policy: snapshot.policy, inputs: snapshot.inputs.slice(0, dispatchIndex) });
        },
      });
      nativeMemoryReplayProbeCompleted = true;
    };
    const runNativeProjectCreatePrefixProbe = async () => {
      const probe = input.nativeProjectCreatePrefixProbe;
      if (!probe || nativeProjectCreatePrefixProbeCompleted) return;
      const [currentRun] = await db.select({ runnerProfileJson: heartbeatRuns.runnerProfileJson })
        .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, run!.id)));
      const profile = currentRun?.runnerProfileJson && typeof currentRun.runnerProfileJson === "object" &&
        !Array.isArray(currentRun.runnerProfileJson) ? currentRun.runnerProfileJson as Record<string, unknown> : {};
      const parsedReceipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
      if (!parsedReceipt.success) throw new Error("managed_fixture_project_prefix_receipt_unavailable");
      const matchingInputs = parsedReceipt.data.additionalInputs.filter(entry =>
        entry.inputs.some(source => source.kind === "tool_result" && source.callId === probe.callId &&
          source.toolName === "create_project"));
      if (matchingInputs.length !== 1) throw new Error("managed_fixture_project_prefix_not_unique");
      const exact = matchingInputs[0]!;
      const actor: AuthorizationActor = { type: "agent", source: "none", companyId, agentId,
        runId: run!.id, onBehalfOfUserId: aliceUserId };
      const sourceSet = { policy: exact.policy, inputs: exact.inputs };
      await assertNativePayloadSourceSetCurrent(db, { companyId, issueId: task.id, runId: run!.id,
        actor, policy: sourceSet.policy, inputs: sourceSet.inputs });
      const tamperedProjectInputs = structuredClone(sourceSet.inputs);
      const projectSource = tamperedProjectInputs.find(source => source.kind === "project");
      if (!projectSource || projectSource.kind !== "project") throw new Error("managed_fixture_project_prefix_project_missing");
      projectSource.contentHash = "0".repeat(64);
      let tamperedSourceRejected = false;
      try {
        await assertNativePayloadSourceSetCurrent(db, { companyId, issueId: task.id, runId: run!.id,
          actor, policy: sourceSet.policy, inputs: tamperedProjectInputs });
      } catch { tamperedSourceRejected = true; }
      const tamperedToolResultInputs = structuredClone(sourceSet.inputs);
      const toolResultSource = tamperedToolResultInputs.find(source => source.kind === "tool_result");
      if (!toolResultSource || toolResultSource.kind !== "tool_result") throw new Error("managed_fixture_project_prefix_result_missing");
      toolResultSource.invocationId = `forged-${probe.callId}`;
      let forgedAssociationRejected = false;
      try {
        await assertNativePayloadSourceSetCurrent(db, { companyId, issueId: task.id, runId: run!.id,
          actor, policy: sourceSet.policy, inputs: tamperedToolResultInputs });
      } catch { forgedAssociationRejected = true; }
      nativeProjectCreatePrefixProbeEvidence = { exactPersistedPrefixAccepted: true,
        changedProjectHashRejected: tamperedSourceRejected, forgedToolResultAssociationRejected: forgedAssociationRejected,
        receiptInputCount: exact.inputs.length };
      nativeProjectCreatePrefixProbeCompleted = true;
    };
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
          if (!openCodeProcessFacts.length) await refreshOpenCodeProcessFacts?.();
          if (observedRunnerPid !== null) runnerPidProcAliveAtFirstRequest = await readFile(`/proc/${observedRunnerPid}/stat`, "utf8")
            .then(() => true).catch(error => { recordProcFailure("first_request_runner_stat", error); return false; });
          qualifiedManagedProcessAtFirstProviderRequest = openCodeProcessFacts.some(fact => fact.shaMatchesQualifiedBinary &&
            fact.managedEnvironment.dataHomeMatchesManagedRun);
        }
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        modelCalls.push(body);
        responseCount += 1;
        if (input.processProbeOnly) return new Response(JSON.stringify({
          id: "msg_managed_process_probe", type: "message", role: "assistant", model,
          stop_reason: "end_turn", content: [{ type: "text", text: "Process qualification probe complete." }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }), { status: 200, headers: { "content-type": "application/json" } });
        if (sourceMemoDiagnosticsEnabled && responseCount === 5) sourceMemoLabelTransactions = true;
        if (responseCount > 1 && modelSteps[responseCount - 2]?.tool === "read_context") {
          const previousStep = modelSteps[responseCount - 2]!;
          const callId = previousStep.id ?? `managed-e2e-${previousStep.tool}-${responseCount - 2}`;
          const messages = Array.isArray(body.messages) ? body.messages : [];
          const toolResults = messages.flatMap(message => {
            if (!message || typeof message !== "object") return [];
            const content = (message as Record<string, unknown>).content;
            return Array.isArray(content) ? content : [];
          }).filter(block => block && typeof block === "object") as Array<Record<string, unknown>>;
          const consumed = toolResults.some(block =>
            block.type === "tool_result" && block.tool_use_id === callId && block.is_error !== true &&
            (typeof block.content === "string" || Array.isArray(block.content)));
          contextResultConsumers.push({ callId, consumed });
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
        if (responseCount > 1 && modelSteps[responseCount - 2]?.tool === "create_project") {
          const previousStep = modelSteps[responseCount - 2]!;
          const callId = previousStep.id ?? `managed-e2e-${previousStep.tool}-${responseCount - 1}`;
          const messages = Array.isArray(body.messages) ? body.messages : [];
          const toolResults = messages.flatMap(message => {
            if (!message || typeof message !== "object") return [];
            const content = (message as Record<string, unknown>).content;
            return Array.isArray(content) ? content : [];
          }).filter(block => block && typeof block === "object") as Array<Record<string, unknown>>;
          const matching = toolResults.filter(block => block.type === "tool_result" && block.tool_use_id === callId);
          let projectId: string | null = null, privateProject = false, contentDigest: string | null = null;
          const content = matching.length === 1 ? matching[0]!.content : null;
          if (typeof content === "string") {
            try {
              const parsed = JSON.parse(content) as Record<string, unknown>;
              projectId = typeof parsed.id === "string" ? parsed.id : null;
              privateProject = parsed.visibility === "private";
              contentDigest = nativeSha256(parsed);
            } catch { /* Keep only bounded result identity facts. */ }
          }
          projectCreateResultConsumers.push({ callId,
            consumed: matching.length === 1 && matching[0]!.is_error !== true && typeof content === "string",
            projectId, privateProject, contentDigest });
        }
        const tools = (body.tools as Array<Record<string, unknown>>) ?? [];
        const step = modelSteps[responseCount - 1];
        if (!step) {
          if (responseCount === fixtureProviderResponses && modelSteps.at(-1)?.tool === "paperclip_finish")
            return new Response(JSON.stringify({ id: `msg_managed_e2e_final_${responseCount}`, type: "message", role: "assistant",
              model, stop_reason: "end_turn", content: [{ type: "text", text: "The requested managed task is complete." }],
              usage: { input_tokens: 80, output_tokens: 12 } }),
            { status: 200, headers: { "content-type": "application/json" } });
          throw new Error("Managed fixture provider exhausted its configured model steps.");
        }
        if (step.tool === "read_context" && diagnosticsEnabled) {
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
          if (name === "paperclip_finish") return tool.name === "paperclip_finish" || toolName(tool.name) === "paperclip_finish";
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
        if (step.tool === "create_project") {
          const createTool = findTool("create_project");
          expect(createTool?.input_schema).toEqual({ type: "object", additionalProperties: false,
            properties: { name: { type: "string", minLength: 1, maxLength: 200 },
              description: { type: "string", maxLength: 4000 },
              workspace: { type: "object", additionalProperties: false,
                properties: { name: { type: "string", minLength: 1, maxLength: 200 } }, required: ["name"] },
              idempotencyKey: { type: "string", minLength: 1, maxLength: 255 } },
            required: ["name", "workspace", "idempotencyKey"] });
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
      if (req.method === "POST" && req.path === "/runtime-tools/model/v1/messages") {
        brokerPostCount += 1;
        if (sourceMemoDiagnosticsEnabled && (brokerPostCount === 6 || sourceFirstRequestProbeEnabled && brokerPostCount === 1)) {
          sourceMemoLabelTransactions = true;
          if (!sourceLockSnapshotTimer) sourceLockSnapshotTimer = setTimeout(() => {
            void captureSourceLockSnapshot().catch(() => undefined);
          }, 4_000);
        }
      }
      if (diagnosticsEnabled && req.method === "POST" && req.path === "/runtime-tools/model/v1/messages" &&
        responseCount >= 5 && finalExchangeProbeTimer === undefined) {
        if (contextProbeTimer) clearInterval(contextProbeTimer);
        contextProbeTimer = undefined;
        contextProbeCallId = null;
        finalExchangeProbeStartedAt = Date.now();
        finalExchangeProbeSamples = 0;
        diagnostics.push(`managed final exchange probe started: ${JSON.stringify({ providerFetchCount: responseCount })}`);
        finalExchangeProbeTimer = setInterval(() => {
          finalExchangeProbeSamples += 1;
          void inspectPostgresWaits();
        }, 250);
        void inspectPostgresWaits();
      }
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
      if (input.nativeMemoryReplayProbe && incomingToolResults.includes(input.nativeMemoryReplayProbe.callId)) {
        nativeMemoryReplayProbeToolResultObserved = true;
        try { await runNativeMemoryReplayProbe(); }
        catch (error) {
          const row = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; reasonCode?: unknown; message?: unknown } : {};
          nativeMemoryReplayProbeFailure = { phase: nativeMemoryReplayProbePhase,
            name: safeCode(row.name) ?? "UnknownError", code: safeCode(row.code) ?? safeCode(row.reasonCode),
            message: typeof row.message === "string" && nativeReplayProbeSafeMessages.has(row.message)
              ? row.message : safeCode(row.message) ?? (row.name === "AssertionError" ? "assertion_failed" : "probe_failed") };
          next(error);
          return;
        }
      }
      if (input.nativeProjectCreatePrefixProbe && incomingToolResults.includes(input.nativeProjectCreatePrefixProbe.callId)) {
        nativeProjectCreatePrefixProbeToolResultObserved = true;
        try { await runNativeProjectCreatePrefixProbe(); }
        catch (error) {
          next(error);
          return;
        }
      }
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
    if (includesProjectApiRead || includesProjectCreate) {
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
      PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: `https://127.0.0.1:${address.port}`,
      ...(process.env.PAPERCLIP_MANAGED_OPENCODE_E2E_DIAGNOSTICS === "1"
        ? { PAPERCLIP_MANAGED_OPENCODE_E2E_DIAGNOSTICS: "1" } : {}),
      ...(process.env.PAPERCLIP_NATIVE_SOURCE_MEMO_DIAGNOSTICS === "1"
        ? { PAPERCLIP_NATIVE_SOURCE_MEMO_DIAGNOSTICS: "1" } : {}),
      ...(process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1"
        ? { PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS: "1" } : {}) };
    const qualifiedOpenCodeSha256 = createHash("sha256")
      .update(await readFile(opencodeBinary)).digest("hex");
    const diagnostics: string[] = [];
    const openCodeProcessFacts: Array<{ shaMatchesQualifiedBinary: boolean; managedEnvironment: Record<string, boolean> }> = [];
    const processInspectionFailures: Record<string, number> = {};
    let observedRunnerPid: number | null = null;
    let runnerPidProcAliveAtSpawn = false;
    let runnerPidProcAliveAtFirstRequest = false;
    let procOpenCodeCommCandidates = 0;
    let procHashReadSuccesses = 0;
    let procHashMismatches = 0;
    const recordProcFailure = (target: string, error: unknown) => {
      const raw = error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : undefined;
      const code = raw === "EACCES" || raw === "EPERM" || raw === "ENOENT" ? raw : "other";
      const key = target + ":" + code;
      processInspectionFailures[key] = Math.min(1000, (processInspectionFailures[key] ?? 0) + 1);
    };
    let spawnExecutableKind: "opencode" | "runner" | "node" | "other" | "unavailable" = "unavailable";
    let inspectedRunnerDescendants = 0;
    let pinnedOpenCodeDescendants = 0;
    let inspectedRunnerTaskEntries = 0;
    let inspectedRunnerChildPidEntries = 0;
    let processProbeExecutionFailure: { name: string; code: string | null } | null = null;
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
    type ManagedNativeFinalization = {
      result: Record<string, unknown>; terminal: PrpTerminalState; turnId: string | null;
      normalizedSessionId: string; sourceInstanceId: string;
    };
    let completedNativeFinalization: ManagedNativeFinalization | null = null;
    const observedOpenCodePids = new Set<number>();
    let managedProviderConfigReported = false;
    const pgMonitor = postgres(input.connectionString, { max: 1 });
    captureSourceLockSnapshot = async () => {
      if (sourceLockSnapshot || !sourceMemoDiagnosticsEnabled) return;
      sourceLockSnapshotStartedAt = performance.now();
      const rows = await pgMonitor<Array<{ pid: number; application_name: string; state: string | null;
        wait_event_type: string | null; wait_event: string | null; xact_age_ms: number | string | null;
        blocked_by: number[]; blockers: Array<{ pid: number; application_name: string; state: string | null;
          xact_age_ms: number | string | null }> | null }>>`
        select a.pid, left(a.application_name, 64) as application_name, a.state,
          a.wait_event_type, a.wait_event,
          case when a.xact_start is null then null
            else greatest(0, extract(epoch from (clock_timestamp() - a.xact_start)) * 1000)::bigint end as xact_age_ms,
          pg_blocking_pids(a.pid) as blocked_by,
          (select json_agg(json_build_object('pid', b.pid, 'application_name', left(b.application_name, 64),
            'state', b.state, 'xact_age_ms', case when b.xact_start is null then null
              else greatest(0, extract(epoch from (clock_timestamp() - b.xact_start)) * 1000)::bigint end))
            from pg_stat_activity b where b.pid = any(pg_blocking_pids(a.pid))) as blockers
        from pg_stat_activity a
        where a.datname = current_database() and a.pid <> pg_backend_pid()
          and (cardinality(pg_blocking_pids(a.pid)) > 0 or
            (a.state = 'active' and a.xact_start < clock_timestamp() - interval '2 seconds'))
        order by a.xact_start asc nulls last limit 12
      `;
      sourceLockSnapshot = { elapsedMs: Math.max(0, performance.now() - sourceLockSnapshotStartedAt),
        rows: rows.map(row => ({ pid: row.pid, applicationName: row.application_name, state: row.state,
          waitEventType: row.wait_event_type, waitEvent: row.wait_event,
          xactAgeMs: row.xact_age_ms === null ? null : Number(row.xact_age_ms), blockedBy: row.blocked_by,
          blockers: row.blockers?.map(blocker => ({ pid: blocker.pid, applicationName: blocker.application_name,
            state: blocker.state, xactAgeMs: blocker.xact_age_ms === null ? null : Number(blocker.xact_age_ms) })) ?? [] })) };
    };
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
            finalExchangeProbeElapsedMs: finalExchangeProbeStartedAt === null ? null :
              Math.max(0, Date.now() - finalExchangeProbeStartedAt),
            finalExchangeProbeSample: finalExchangeProbeStartedAt === null ? null : finalExchangeProbeSamples,
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
          const sixthModelFetchStarted = contextPostCaptureProbeStartedAt !== null && responseCount >= 6;
          const postCaptureProbeExpired = contextPostCaptureProbeStartedAt !== null &&
            (Date.now() - contextPostCaptureProbeStartedAt >= 15_000 || contextPostCaptureProbeSamples >= 60);
          const contextInvocationFailed = invocationFinished && contextInvocation?.status !== "succeeded";
          const captureWaitExpired = contextProbeCompletedAt !== null && !contextResultCapturePresent &&
            Date.now() - contextProbeCompletedAt >= 5_000;
          const preCaptureProbeExpired = contextPostCaptureProbeStartedAt === null && contextProbeStartedAt !== null &&
            Date.now() - contextProbeStartedAt >= 10_000;
          if (contextProbeCallId && (sixthModelFetchStarted || postCaptureProbeExpired || contextInvocationFailed ||
            captureWaitExpired || preCaptureProbeExpired)) {
            if (contextPostCaptureProbeStartedAt !== null)
              diagnostics.push(`managed Context post-capture probe stopped: ${JSON.stringify({
                reason: sixthModelFetchStarted ? "sixth_model_fetch" : postCaptureProbeExpired ? "bounded_window" : "invocation_finished",
                elapsedMs: Date.now() - contextPostCaptureProbeStartedAt,
                samples: contextPostCaptureProbeSamples, providerFetchCount: responseCount,
              })}`);
            if (contextProbeTimer) clearInterval(contextProbeTimer);
            contextProbeTimer = undefined;
            contextProbeCallId = null;
          }
          if (finalExchangeProbeStartedAt !== null && finalExchangeProbeTimer &&
            (Date.now() - finalExchangeProbeStartedAt >= 15_000 || finalExchangeProbeSamples >= 60)) {
            diagnostics.push(`managed final exchange probe stopped: ${JSON.stringify({
              reason: "bounded_window", elapsedMs: Date.now() - finalExchangeProbeStartedAt,
              samples: finalExchangeProbeSamples, providerFetchCount: responseCount,
            })}`);
            clearInterval(finalExchangeProbeTimer);
            finalExchangeProbeTimer = undefined;
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
      observedRunnerPid = pid;
      runnerPidProcAliveAtSpawn = await readFile(`/proc/${pid}/stat`, "utf8")
        .then(() => true).catch(error => { recordProcFailure("spawn_stat", error); return false; });
      diagnostics.push(`runner process pid ${pid}`);
      // OpenCodeServerDriver reports the spawned OpenCode PID itself here.
      // Inspect that exact process before walking its descendants; the binary
      // can finish quickly enough that a later /proc sweep would miss it.
      const [spawnExecutablePath, spawnEnvironmentText] = await Promise.all([
        readlink(`/proc/${pid}/exe`).catch(error => { recordProcFailure("spawn_exe", error); return ""; }),
        readFile(`/proc/${pid}/environ`, "utf8").catch(error => { recordProcFailure("spawn_environment", error); return ""; }),
      ]);
      const spawnedExecutable = spawnExecutablePath.split("/").at(-1)?.toLowerCase() ?? "";
      spawnExecutableKind = /opencode(?:[-.]|$)/i.test(spawnedExecutable) ? "opencode" :
        /runnerd|paperclip-runner/i.test(spawnedExecutable) ? "runner" : /node/i.test(spawnedExecutable) ? "node" :
          spawnExecutablePath ? "other" : "unavailable";
      diagnostics.push(`spawn process inspection: executable=${spawnExecutableKind} environment=${spawnEnvironmentText ? "readable" : "unavailable"}`);
      if (/(?:^|\/)opencode(?:[-.]|$)/i.test(spawnExecutablePath)) {
        const [runningHash] = await Promise.all([
          readFile(`/proc/${pid}/exe`).then(bytes => createHash("sha256").update(bytes).digest("hex")).catch(() => ""),
        ]);
        const spawnEnvironment = spawnEnvironmentText.split("\0");
        observedOpenCodePids.add(pid);
        openCodeProcessFacts.push({ shaMatchesQualifiedBinary: runningHash === qualifiedOpenCodeSha256,
          managedEnvironment: {
            brokerOrigin: spawnEnvironment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN=")),
            inputCap: spawnEnvironment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND=")),
            outputCap: spawnEnvironment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS=")),
            placeholderKey: spawnEnvironment.includes("ANTHROPIC_API_KEY=paperclip-managed-model-broker"),
            dataHomeMatchesManagedRun: spawnEnvironment.includes(`XDG_DATA_HOME=${expectedOpenCodeDataHome()}`),
          } });
      }
      const inspect = async (includeGlobalProcessDiscovery = false) => {
        const descendants: Array<{ pid: number; parent: number }> = [];
        const pending = [pid];
        const parents = new Map<number, number>();
        const maximumDescendants = 128;
        for (let depth = 0; pending.length > 0 && depth < 8; depth += 1) {
          const parentPid = pending.shift()!;
          // Runnerd may start OpenCode from a Tokio worker thread. Linux keeps
          // each thread's child list separately, so inspect every task rather
          // than only the process leader's `/children` file.
          const taskEntries = await readdir(`/proc/${parentPid}/task`, { withFileTypes: true }).catch(error => {
            recordProcFailure("runner_task_directory", error);
            return [];
          });
          inspectedRunnerTaskEntries = Math.min(1000, inspectedRunnerTaskEntries + taskEntries.length);
          for (const taskEntry of taskEntries) {
            if (!taskEntry.isDirectory() || !/^\d+$/.test(taskEntry.name)) continue;
            const children = await readFile(`/proc/${parentPid}/task/${taskEntry.name}/children`, "utf8").catch(error => {
              recordProcFailure("runner_task_children", error);
              return "";
            });
            for (const rawChildPid of children.trim().split(/\s+/)) {
              const childPid = Number(rawChildPid);
              if (!Number.isSafeInteger(childPid) || childPid <= 0 || parents.has(childPid)) continue;
              inspectedRunnerChildPidEntries = Math.min(1000, inspectedRunnerChildPidEntries + 1);
              parents.set(childPid, parentPid);
              descendants.push({ pid: childPid, parent: parentPid });
              if (descendants.length >= maximumDescendants) break;
              pending.push(childPid);
            }
            if (descendants.length >= maximumDescendants) break;
          }
          if (descendants.length >= maximumDescendants) break;
        }
        for (const { pid: childPid, parent: parentPid } of descendants) {
          inspectedRunnerDescendants = Math.min(1000, inspectedRunnerDescendants + 1);
          const [executablePath, comm] = await Promise.all([
            readlink(`/proc/${childPid}/exe`).catch(error => { recordProcFailure("descendant_exe", error); return "unknown"; }),
            readFile(`/proc/${childPid}/comm`, "utf8").catch(() => "unknown"),
          ]);
          const executable = executablePath.split("/").at(-1) || "unknown";
          // The qualified binary can run under a non-obvious executable name
          // (for example a Bun/exec descriptor). Hash only this bounded tree,
          // then inspect environment data only for the exact pinned binary.
          const runningHash = await readFile(`/proc/${childPid}/exe`).then(bytes =>
            createHash("sha256").update(bytes).digest("hex")).catch(error => {
              recordProcFailure("descendant_hash", error);
              return "";
            });
          const isOpenCodeProcess = runningHash === qualifiedOpenCodeSha256;
          if (isOpenCodeProcess) pinnedOpenCodeDescendants = Math.min(1000, pinnedOpenCodeDescendants + 1);
          let openCodeShaMatches: boolean | null = null;
          let openCodeManagedEnvironment: Record<string, boolean> | null = null;
          if (isOpenCodeProcess) {
            const environmentText = await readFile(`/proc/${childPid}/environ`, "utf8").catch(error => {
              recordProcFailure("descendant_environment", error);
              return "";
            });
            const environment = environmentText.split("\0");
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
          diagnostics.push(`runner descendant pid=${childPid} parent=${parentPid} executable=${executable} comm=${comm.trim()} pinnedOpenCode=${isOpenCodeProcess ? "yes" : "no"}${openCodeManagedEnvironment ? ` managedEnvironment=${JSON.stringify(openCodeManagedEnvironment)}` : " environment=not-inspected"}`);
          if (isOpenCodeProcess)
            diagnostics.push(`OpenCode child qualification: ${JSON.stringify({ shaMatchesQualifiedBinary: openCodeShaMatches, managedEnvironment: openCodeManagedEnvironment })}`);
        }
        if (!includeGlobalProcessDiscovery || openCodeProcessFacts.length > 0) return;
        // Detached runnerd execution can reparent the OpenCode child before
        // the provider request reaches the local broker. Make one bounded
        // host `/proc` pass by `comm`, then hash only OpenCode-style names or
        // the numeric comm used by the launcher's `/proc/self/fd/N` binding.
        // Read environment data only after the pinned SHA matches, and qualify
        // only a unique run-owned data home.
        const procEntries = await readdir("/proc", { withFileTypes: true }).catch(error => {
          recordProcFailure("proc_directory", error);
          return [];
        });
        const runHomeMatches: Array<{ shaMatchesQualifiedBinary: boolean; managedEnvironment: Record<string, boolean> }> = [];
        for (const entry of procEntries) {
          if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
          const candidatePid = Number(entry.name);
          if (observedOpenCodePids.has(candidatePid)) continue;
          const comm = await readFile(`/proc/${candidatePid}/comm`, "utf8").catch(error => {
            recordProcFailure("proc_comm", error);
            return "";
          });
          if (!/^(?:opencode(?:\.exe|[.-]|$)|[0-9]{1,3})$/i.test(comm.trim())) continue;
          const statText = await readFile(`/proc/${candidatePid}/stat`, "utf8").catch(error => {
            recordProcFailure("proc_stat", error);
            return "";
          });
          const statClose = statText.lastIndexOf(")");
          const processState = statClose >= 0 ? statText.slice(statClose + 2).trim().split(/\s+/)[0] : "";
          if (processState === "Z" || processState === "X") continue;
          procOpenCodeCommCandidates = Math.min(1000, procOpenCodeCommCandidates + 1);
          const runningHash = await readFile(`/proc/${candidatePid}/exe`).then(bytes =>
            createHash("sha256").update(bytes).digest("hex")).catch(error => {
              recordProcFailure("proc_hash", error);
              return "";
            });
          if (runningHash) procHashReadSuccesses = Math.min(1000, procHashReadSuccesses + 1);
          if (runningHash && runningHash !== qualifiedOpenCodeSha256)
            procHashMismatches = Math.min(1000, procHashMismatches + 1);
          if (runningHash !== qualifiedOpenCodeSha256) continue;
          const environmentText = await readFile(`/proc/${candidatePid}/environ`, "utf8").catch(error => {
            recordProcFailure("proc_environment", error);
            return "";
          });
          const environment = environmentText.split("\0");
          const managedEnvironment = {
            brokerOrigin: environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN=")),
            inputCap: environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND=")),
            outputCap: environment.some(value => value.startsWith("PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS=")),
            placeholderKey: environment.includes("ANTHROPIC_API_KEY=paperclip-managed-model-broker"),
            dataHomeMatchesManagedRun: environment.includes(`XDG_DATA_HOME=${expectedOpenCodeDataHome()}`),
          };
          if (managedEnvironment.dataHomeMatchesManagedRun)
            runHomeMatches.push({ shaMatchesQualifiedBinary: true, managedEnvironment });
        }
        if (runHomeMatches.length === 1) openCodeProcessFacts.push(runHomeMatches[0]!);
      };
      refreshOpenCodeProcessFacts = () => inspect(true);
      await inspect();
    };
    try {
      const result = await executePaperclipNativeSession({ db, execution, bootstrapSourceClosure, useRunnerd: true, onSpawn,
        runnerInstanceId: prepared.runnerInstanceId, leaseOwner, turnTimeoutMs: fixtureTurnTimeoutMs, adapterType: "paperclip_runner",
        runnerEnvironment, testBeforeManagedProjectCreate: input.beforeManagedProjectCreate,
        testAfterManagedProjectCreate: input.afterManagedProjectCreate,
        onLog: async (stream, chunk) => {
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
                if (diagnosticsEnabled && event.eventType === "session.started" && !pgMonitorTimer) {
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
              if (stream === "stderr" && /(?:error|failed|failure|denied|unavailable|timeout|timed out|disconnect|exit code|command_execution_failed)/i.test(line)) {
                const safeLine = line.replace(/\s+/g, " ");
                const isFailureFacts = safeLine.includes("native session original failure facts:");
                diagnostics.push(`${isFailureFacts ? "runner failure facts" : "runner stderr"}: ${safeLine.slice(0, isFailureFacts ? 360 : 240)}`);
                if (isFailureFacts && sourceMemoDiagnosticsEnabled) diagnostics.push(
                  `managed source active root transactions at original failure: ${JSON.stringify(
                    [...sourceMemoActiveTransactions.entries()].map(([txOrdinal, tx]) => ({ txOrdinal,
                      startedAtElapsedMs: tx.startedAtElapsedMs,
                      heldMs: Math.max(0, performance.now() - tx.startedAt), frames: tx.frames,
                    })).sort((a, b) => b.heldMs - a.heldMs).slice(0, 12))}`);
              }
            }
          }
        } }).catch(error => {
          input.onPreserveDebugArtifacts?.();
          const failure = error instanceof Error ? error as Error & { code?: unknown; cause?: { code?: unknown }; stage?: unknown } : null;
          if (input.processProbeOnly) {
            processProbeExecutionFailure = { name: safeCode(failure?.name) ?? "UnknownError",
              code: safeCode(failure?.code) ?? safeCode(failure?.cause?.code) ?? null };
            return { exitCode: 1 } as Awaited<ReturnType<typeof executePaperclipNativeSession>>;
          }
          const frames = failure?.stack?.split("\n").slice(1)
            .filter(line => /^\s*at /.test(line)).slice(0, 6)
            .map(line => line.trim().replace(/\s+/g, " ").slice(0, 220)) ?? [];
          const metadata = { name: failure?.name ?? "UnknownError", code: safeCode(failure?.code),
            causeCode: safeCode(failure?.cause?.code), stage: safeCode(failure?.stage), frames };
          diagnostics.push(`managed context transaction owners: ${JSON.stringify([...contextTransactionOwners].slice(0, 160).map(owner => ({
            owner, frames: contextTransactionOwnerFrames.get(owner) ?? [],
          })))}`);
          if (sourceMemoDiagnosticsEnabled) diagnostics.push(`managed source transaction diagnostics: ${JSON.stringify({
            longest: sourceMemoTransactionRecords,
            active: [...sourceMemoActiveTransactions.entries()].map(([txOrdinal, tx]) => ({ txOrdinal,
              startedAtElapsedMs: tx.startedAtElapsedMs,
              heldMs: Math.max(0, performance.now() - tx.startedAt), frames: tx.frames,
            })).sort((a, b) => b.heldMs - a.heldMs).slice(0, 12),
          })}`);
          if (sourceMemoDiagnosticsEnabled) {
            const memo = nativeSourceMemoDiagnosticsForTest();
            const transactions = Object.entries(memo.byTransaction).map(([txOrdinal, stats]) => ({ txOrdinal,
              hits: stats.hits, misses: stats.misses, uncachedProofMs: Math.round(stats.uncachedProofMs),
              maxUncachedProofMs: Math.round(stats.maxUncachedProofMs), sourceKindMissCounts: stats.sourceKindMissCounts }))
              .sort((left, right) => right.uncachedProofMs - left.uncachedProofMs).slice(0, 12);
            diagnostics.push(`managed native source memo summary: ${JSON.stringify({ roots: memo.roots,
              actorScopes: memo.actorScopes, nestedScopeReuses: memo.nestedScopeReuses,
              memoHits: memo.memoHits, memoMisses: memo.memoMisses, uncachedProofMs: Math.round(memo.uncachedProofMs),
              byActor: memo.byActor, transactions })}`);
          }
          if (sourceMemoDiagnosticsEnabled && sourceLockSnapshot)
            diagnostics.push(`managed source lock snapshot: ${JSON.stringify(sourceLockSnapshot)}`);
          diagnostics.push(`execution failure metadata: ${JSON.stringify(metadata)}`);
          const safeMessage = safeCode(failure?.message) ?? "native_session_execution_failed";
          throw new Error(`${safeMessage}\n${diagnostics.join("\n")}\nBroker: ${JSON.stringify(brokerFailureFacts())}\nArtifacts: ${runRoot}`);
        });
      if (input.processProbeOnly) {
        input.onPreserveDebugArtifacts?.();
        return { processProbeOnly: true as const, responseCount, modelCallCount: modelCalls.length,
          exitCode: result.exitCode, executionFailure: processProbeExecutionFailure,
          spawnExecutableKind, inspectedRunnerTaskEntries, inspectedRunnerChildPidEntries,
          runnerPidProcAliveAtSpawn, runnerPidProcAliveAtFirstRequest, procOpenCodeCommCandidates,
          procHashReadSuccesses, procHashMismatches,
          inspectedRunnerDescendants, pinnedOpenCodeDescendants, processInspectionFailures,
          processFacts: openCodeProcessFacts };
      }
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
          failedInvocationErrors: invocations.filter(value => value.status === "failed" && value.errorCode)
            .map(value => ({ tool: value.toolName, errorCode: value.errorCode })).slice(0, 24),
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
        diagnostics.push(`managed context transaction owners: ${JSON.stringify([...contextTransactionOwners].slice(0, 160).map(owner => ({
          owner, frames: contextTransactionOwnerFrames.get(owner) ?? [],
        })))}`);
        if (sourceMemoDiagnosticsEnabled) diagnostics.push(`managed source transaction diagnostics: ${JSON.stringify({
          longest: sourceMemoTransactionRecords,
          active: [...sourceMemoActiveTransactions.entries()].map(([txOrdinal, tx]) => ({ txOrdinal,
            startedAtElapsedMs: tx.startedAtElapsedMs,
            heldMs: Math.max(0, performance.now() - tx.startedAt), frames: tx.frames,
          })).sort((a, b) => b.heldMs - a.heldMs).slice(0, 12),
        })}`);
        if (sourceMemoDiagnosticsEnabled && sourceLockSnapshot)
          diagnostics.push(`managed source lock snapshot: ${JSON.stringify(sourceLockSnapshot)}`);
        if (input.nativeMemoryReplayProbe) {
          const denied = brokerRequests.some(value => value.includes("response POST /runtime-tools/model/v1/messages 403"));
          expect(nativeMemoryReplayProbeToolResultObserved, "the exact successful Gateway result must reach the next managed Messages request").toBe(true);
          expect(nativeMemoryReplayProbeFailure, `the actual replay probe must not fail: ${JSON.stringify(nativeMemoryReplayProbeFailure)}`).toBeNull();
          expect(nativeMemoryReplayProbeCompleted, "the probe must succeed after the managed result owner persists the sealed receipt").toBe(true);
          expect(denied, "revoked Memory output must stop the next managed source boundary").toBe(true);
          expect(responseCount).toBe(1);
          return { companyId, runId: run!.id,
            nativeMemoryReplaySourceDenial: { status: 403, providerResponsesBeforeDenial: responseCount,
            replayProbeCompleted: nativeMemoryReplayProbeCompleted } };
        }
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
        throw new Error(`managed_opencode_runner_exit_${result.exitCode}; providerResponses=${responseCount}; fakeFetchEntrances=${JSON.stringify(fakeFetchEntrances)}\nprocessInspectionFailures=${JSON.stringify(processInspectionFailures)} spawnExecutableKind=${spawnExecutableKind}\n${diagnostics.join("\n")}\nBroker: ${JSON.stringify(brokerFailureFacts())}\nArtifacts: ${runRoot}`);
      }
      completedNativeFinalization = (result as unknown as Record<string, unknown>).nativeFinalization as ManagedNativeFinalization;
      if (input.nativeMemoryReplayProbe) {
        expect(nativeMemoryReplayProbeToolResultObserved,
          "the exact successful Gateway result must reach the next managed Messages request").toBe(true);
        expect(nativeMemoryReplayProbeFailure, `the actual replay probe must not fail: ${JSON.stringify(nativeMemoryReplayProbeFailure)}`).toBeNull();
        expect(nativeMemoryReplayProbeCompleted,
          "the replay and canonical Human revoke probe must run before the next Messages route").toBe(true);
        throw new Error("managed_fixture_revoked_memory_output_did_not_deny_next_messages_request");
      }
      expect(responseCount).toBeGreaterThanOrEqual(2);
      expect(qualifiedManagedProcessAtFirstProviderRequest,
        `qualified OpenCode process must use the run-owned data home before the first provider response; observed=${JSON.stringify({
          processFacts: openCodeProcessFacts, responseCount, modelCallCount: modelCalls.length, exitCode: result.exitCode,
          spawnExecutableKind, inspectedRunnerTaskEntries, inspectedRunnerChildPidEntries,
          runnerPidProcAliveAtSpawn, runnerPidProcAliveAtFirstRequest, procOpenCodeCommCandidates,
          procHashReadSuccesses, procHashMismatches,
          inspectedRunnerDescendants, pinnedOpenCodeDescendants, processInspectionFailures,
          runner: diagnostics.filter(line => /runner process pid|runner descendant|OpenCode (?:child|process) qualification|runner stdout event: .*run\.(?:result|terminal)|runner turn failure/.test(line)).slice(-20),
        })}`)
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
      if (pgMonitorTimer) clearInterval(pgMonitorTimer);
      if (contextProbeTimer) clearInterval(contextProbeTimer);
      if (finalExchangeProbeTimer) clearInterval(finalExchangeProbeTimer);
      if (sourceLockSnapshotTimer) clearTimeout(sourceLockSnapshotTimer);
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
      if (sourceMemoDiagnosticsEnabled) {
        const globals = globalThis as unknown as Record<PropertyKey, unknown>;
        if (globals[sourceMemoTxOrdinalSymbol] === sourceMemoTxOrdinalMap) delete globals[sourceMemoTxOrdinalSymbol];
      }
    }
    const [persistedRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    const sourceReceipt = persistedRun!.runnerProfileJson as Record<string, unknown>;
    expect(sourceReceipt.nativeOpenCodeSourceAuthority).toMatchObject({ version: 1, toolSchemas: expect.any(Array) });
    expect(persistedRun!.nativeInputSourceProtocolVersion).toBe(1);
    expect(nativeRunInputSourceReceiptSchema.safeParse(sourceReceipt.nativeInputSourceReceipt).success).toBe(true);
    const effectSteps = modelSteps.filter(step => ["write_document", "create_task", "create_project", "self_remember", "read_context"]
      .includes(step.tool));
    const capturedResults = Array.isArray(sourceReceipt.nativeToolResultSourceCaptures)
      ? sourceReceipt.nativeToolResultSourceCaptures as Array<Record<string, unknown>> : [];
    for (const [index, step] of effectSteps.entries()) {
      const callId = step.id ?? `managed-e2e-${step.tool}-${modelSteps.indexOf(step) + 1}`;
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
      const aliceReadError = typeof aliceHttpDocument.body?.error === "string" ? aliceHttpDocument.body.error : null;
      const safeAliceReadError = new Set([
        "A Native source Task changed", "A Native source Task changed or was erased",
        "A Native source Context changed", "A Native source Document changed",
        "The Native source prefix is not in its original receipt",
        "The Native source Task is not current for this reader",
      ]).has(aliceReadError ?? "") ? aliceReadError : null;
      const aliceErrorBody = aliceHttpDocument.body && typeof aliceHttpDocument.body === "object"
        ? aliceHttpDocument.body as Record<string, unknown> : {};
      const aliceReadErrorCode = safeCode(aliceErrorBody.code) ?? safeCode(aliceErrorBody.reasonCode) ??
        safeCode(aliceErrorBody.errorCode);
      const aliceReadErrorBodyJson = JSON.stringify(aliceHttpDocument.body ?? null);
      const aliceReadErrorBodySha256 = createHash("sha256").update(aliceReadErrorBodyJson, "utf8").digest("hex");
      if (aliceHttpDocument.status !== 200) {
        // This is a synthetic fixture error response, not source or document
        // content. Preserve it only in the retained local run artifact so a
        // later review can map an otherwise opaque 403 without printing it.
        input.onPreserveDebugArtifacts?.();
        await writeFile(join(runRoot, `alice-document-read-denial-${documentSteps.indexOf(step)}.json`),
          `${JSON.stringify({ status: aliceHttpDocument.status, body: aliceHttpDocument.body ?? null }, null, 2)}\n`,
          { mode: 0o600 });
      }
      expect(aliceHttpDocument.status,
        `Alice document ${key} read failed: status=${aliceHttpDocument.status}, error=${safeAliceReadError ?? "unknown"}, ` +
          `bodyKeys=${JSON.stringify(Object.keys(aliceErrorBody).sort())}, errorCode=${aliceReadErrorCode ?? "unknown"}, ` +
          `bodyLength=${aliceReadErrorBodyJson.length}, bodySha256=${aliceReadErrorBodySha256}`)
        .toBe(200);
      if (typeof expectedBody === "string") expect(aliceHttpDocument.body.body).toContain(expectedBody);
      const bobHttpDocument = await request(bobApp).get(`/api/issues/${task.id}/documents/${encodeURIComponent(key)}`);
      if (key === "managed-source-a" && bobHttpDocument.status !== 200) {
        // Document A predates the private Context source and is expected to
        // remain readable by Bob. Keep only a synthetic denial response for
        // local diagnosis if that temporal boundary regresses.
        input.onPreserveDebugArtifacts?.();
        await writeFile(join(runRoot, "bob-document-a-read-denial.json"),
          `${JSON.stringify({ status: bobHttpDocument.status, body: bobHttpDocument.body ?? null }, null, 2)}\n`,
          { mode: 0o600 });
      }
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
    let managedProjectCreateEvidence: Record<string, unknown> | null = null;
    let managedProjectPrivacyRead: { aliceStatus: number; bobStatus: number } | null = null;
    const projectCreateStepIndex = modelSteps.findIndex(step => step.tool === "create_project");
    if (projectCreateStepIndex >= 0) {
      const createStep = modelSteps[projectCreateStepIndex]!;
      const callId = createStep.id ?? `managed-e2e-create_project-${projectCreateStepIndex + 1}`;
      const matchingCaptures = capturedResults.filter(value => value.callId === callId && value.tool === "create_project" &&
        value.managedOpenCode === true);
      if (matchingCaptures.length !== 1) throw new Error("managed_fixture_project_create_capture_missing");
      const managedCapture = matchingCaptures[0]!;
      const projectCreate = managedCapture.projectCreate && typeof managedCapture.projectCreate === "object"
        ? managedCapture.projectCreate as Record<string, unknown> : {};
      const createReceipt = projectCreate.receipt && typeof projectCreate.receipt === "object"
        ? projectCreate.receipt as Record<string, unknown> : {};
      const createdProjectSource = createReceipt.projectSource && typeof createReceipt.projectSource === "object"
        ? createReceipt.projectSource as Record<string, unknown> : {};
      const sourceSet = projectCreate.sourceSet && typeof projectCreate.sourceSet === "object"
        ? projectCreate.sourceSet as Record<string, unknown> : {};
      const sourceInputs = Array.isArray(sourceSet.inputs) ? sourceSet.inputs as Array<Record<string, unknown>> : [];
      const sourcePolicy = sourceSet.policy && typeof sourceSet.policy === "object"
        ? sourceSet.policy as Record<string, unknown> : {};
      const resultSource = managedCapture.source && typeof managedCapture.source === "object"
        ? managedCapture.source as Record<string, unknown> : {};
      const persistedReceiptBody = sourceReceipt.nativeInputSourceReceipt && typeof sourceReceipt.nativeInputSourceReceipt === "object"
        ? sourceReceipt.nativeInputSourceReceipt as Record<string, unknown> : {};
      const additionalInputs = Array.isArray(persistedReceiptBody.additionalInputs)
        ? persistedReceiptBody.additionalInputs as Array<Record<string, unknown>> : [];
      const expectedPolicy = { ...sourcePolicy,
        projectIds: [...new Set([...(Array.isArray(sourcePolicy.projectIds) ? sourcePolicy.projectIds as string[] : []),
          String(createReceipt.projectId ?? "")])].filter(Boolean).sort() };
      const expectedInputs = [resultSource, ...sourceInputs, createdProjectSource,
        ...(Array.isArray(createReceipt.workspaceSources) ? createReceipt.workspaceSources as Array<Record<string, unknown>> : [])];
      const matchingSourceSets = additionalInputs.filter(entry => entry.responsibleUserId === aliceUserId &&
        isDeepStrictEqual(entry.policy, expectedPolicy) && isDeepStrictEqual(entry.inputs, expectedInputs));
      const consumers = projectCreateResultConsumers.filter(value => value.callId === callId);
      const resultDigest = typeof managedCapture.resultDigest === "string" ? managedCapture.resultDigest : null;
      const sourceSnapshotDigest = typeof createReceipt.sourceSnapshotDigest === "string" ? createReceipt.sourceSnapshotDigest : null;
      const createdProjectId = typeof createReceipt.projectId === "string" ? createReceipt.projectId : null;
      if (!createdProjectId || !fixtureProjectHumanCookie || !fixtureProjectBobCookie)
        throw new Error("managed_fixture_project_create_privacy_probe_unavailable");
      const [aliceProjectRead, bobProjectRead] = await Promise.all([
        request(projectApiApp).get(`/api/projects/${createdProjectId}`).set("cookie", fixtureProjectHumanCookie),
        request(projectApiApp).get(`/api/projects/${createdProjectId}`).set("cookie", fixtureProjectBobCookie),
      ]);
      managedProjectPrivacyRead = { aliceStatus: aliceProjectRead.status, bobStatus: bobProjectRead.status };
      expect(aliceProjectRead.status).toBe(200);
      expect([403, 404]).toContain(bobProjectRead.status);
      expect(managedCapture).toMatchObject({ callId, tool: "create_project", resultDigest,
        argumentsHash: canonicalHash(createStep.input ?? {}) });
      expect(managedCapture.source).toEqual({ kind: "tool_result", runId: run!.id, callId,
        toolName: "create_project", invocationId: null, contentHash: resultDigest });
      expect(createReceipt).toMatchObject({ callId, tool: "create_project", argumentsHash: canonicalHash(createStep.input ?? {}),
        resultDigest, sourceSetHash: canonicalHash({ policy: sourcePolicy, inputs: sourceInputs }),
        projectId: consumers[0]?.projectId, responsibleUserId: aliceUserId });
      expect(createdProjectSource).toMatchObject({ kind: "project", projectId: consumers[0]?.projectId });
      expect(resultSource).toEqual({ kind: "tool_result", runId: run!.id, callId,
        toolName: "create_project", invocationId: null, contentHash: resultDigest });
      expect(matchingSourceSets).toHaveLength(1);
      expect(consumers).toHaveLength(1);
      expect(consumers[0]).toMatchObject({ consumed: true, privateProject: true,
        projectId: String(createReceipt.projectId), contentDigest: resultDigest });
      managedProjectCreateEvidence = { providerContinued: responseCount >= 2,
        toolSchemaPinned: true, providerConsumedExactNonErrorToolResult: consumers[0]!.consumed,
        projectIsPrivate: consumers[0]!.privateProject, sourceSetBound: createReceipt.sourceSetHash === canonicalHash({ policy: sourcePolicy, inputs: sourceInputs }),
        hasSnapshotDigest: typeof sourceSnapshotDigest === "string" && /^[0-9a-f]{64}$/.test(sourceSnapshotDigest),
        aliceAuthenticatedRead: aliceProjectRead.status === 200, bobAuthenticatedReadDenied: [403, 404].includes(bobProjectRead.status),
        matchingManagedCapture: matchingCaptures.length === 1, exactAdditionalInputClosure: matchingSourceSets.length === 1 };
    }
    return {
      companyId,
      agentId,
      reuseIdentity: { companyId, agentId, aliceUserId, bobUserId,
        aliceSessionId: sessionId, bobSessionId },
      runId: run!.id,
      issueId: task.id,
      planId: plan.id,
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
      projectCreateResultConsumers,
      nativeProjectCreatePrefixProbe: input.nativeProjectCreatePrefixProbe ? {
        toolResultObserved: nativeProjectCreatePrefixProbeToolResultObserved,
        completed: nativeProjectCreatePrefixProbeCompleted,
        evidence: nativeProjectCreatePrefixProbeEvidence,
      } : null,
      managedProjectCreateEvidence,
      managedProjectPrivacyRead,
      childTasks,
      modelCalls: modelCalls.length,
      completedRun: terminalRun,
      nativeFinalization,
      privateRoot: privateRootRef.current,
    };
}
