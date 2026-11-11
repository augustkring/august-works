import { isDeepStrictEqual } from "node:util";
import { MANAGED_NATIVE_OPENCODE_IMAGE_PIN, assertManagedFixtureOpenCodeImage } from "./managed-native-opencode-fixture-pin.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Socket } from "node:net";
import { verifySandboxExecJwt } from "../../agent-auth-jwt.js";
import { NATIVE_SELECTED_PROVIDER_PACK_DISCOVERY_SCRIPT, REMOTE_PROVIDER_PACK_SCHEMA, REMOTE_PROVIDER_PACK_ARTIFACT_PATHS } from "../../services/native-runtime/native-artifact-preparation.js";
import { readRemoteProviderPackManifest } from "../../services/native-runtime/native-session-executor.js";
import { attestNativeModelClient, type ModelChannel, type SignedModelOrigin } from "./managed-native-model-transport.js";
import assert from "node:assert/strict";
import request from "supertest";
import { constants, generateKeyPairSync, privateDecrypt, randomBytes, randomUUID, sign } from "node:crypto";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import http, { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, sep } from "node:path";
import express from "express";
import { WebSocket } from "ws";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  activityLog, agentPresenceRuntimeBindings, connectionGrants, toolApplications, toolCatalogEntries, toolConnections, toolProfileBindings, toolProfileEntries, toolProfiles,
  chatConversations, agentProviderBindings, billingAccounts, billingAccountCompanies, billingSubscriptions, companies, createDb,
  agents, agentExecutionManifests, environments, environmentLeases, heartbeatRuns, heartbeatRunEvents, nativeRunFinalizations,
  nativeRunResults, orchestrationModelReservations, issues, runtimeCapacityProfiles, runtimeCells, runtimeHosts, runtimeHostRequestNonces,
  runtimeVersionCatalog, runtimeHostCommands, runtimeSandboxBindings, runtimePolicySnapshots, runtimeOperations, sandboxQualificationRuns, orchestrationPlans, orchestrationWorkers, orchestrationWorkerAttempts,
} from "@paperclipai/db";
import { SANDBOX_CONTROLS, SANDBOX_HOST_COMMAND, runtimeRequestSigningInput, sandboxCapabilitySnapshotSchema, sandboxHostRequestSchema, sandboxHostReplySchema, type NativePayloadSourceInput, type SandboxHostRequest, type SandboxQualificationProbeFixture, type SandboxCapabilitySnapshot } from "@paperclipai/shared";
import { canActorReadIssuePrivacy, type AuthorizationActor } from "../../services/authorization.js";
import { assertHumanAuthentication } from "../../auth/authenticator-assurance.js";
import { assertNativeWorkspaceMetadataSourcesCurrent } from "../../services/native-direct-input.js";
import type { NativeBootstrapSourceClosure } from "../../services/native-runtime/native-execution-input.js";
import { environmentService } from "../../services/environments.js";
import { readRunLeaseCleanup, verifyNativeCleanupRuntimeState } from "../../services/execution-sandbox/run-lease-cleanup.js";
import { isNativeBootstrapPrelaunchCleanupCandidate, readNativeBootstrapPrelaunchCleanup, verifyNativeBootstrapPrelaunchRuntimeState } from "../../services/execution-sandbox/native-prelaunch-cleanup.js";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { isRemoteRuntimeAssetLocator } from "../../services/native-runtime/runtime-asset-retention.js";
import { NATIVE_REMOTE_WORKLOAD_STOPPED } from "../../services/remote-execution-termination.js";
import { PROCESS_IDENTITY_RECORDED, PROCESS_START_REQUESTED } from "../../services/native-local-process-stop.js";
import { environmentRuntimeService } from "../../services/environment-runtime.js";
import { executionSandboxService } from "../../services/execution-sandbox/sandbox-service.js";
import { openShellBackend } from "../../services/execution-sandbox/openshell-backend.js";
import { checkOpenShellBoundary } from "../../services/execution-sandbox/openshell-prover.js";
import { sandboxProbeCases, type SandboxAdmissionCleanup, type SandboxIdentity, type SandboxProbeCase } from "../../services/execution-sandbox/backend.js";
import { nativeSandboxHostTransport, type NativeOpenCodeConformanceHostAuthority } from "../../services/execution-sandbox/native-host-bridge.js";
import { agentProviderBindingService } from "../../services/agent-provider-bindings.js";
import { assertV5Authorization, v5HumanActorId } from "../../services/v5-authorization.js";
import { entitlementService } from "../../services/billing/entitlements.js";
import { discoverNativeCapabilities } from "../../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../../services/provider-capabilities.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { runtimeControlService } from "../../services/runtime/control.js";
import type { workerModelGateway } from "../../services/orchestration/worker-model-gateway.js";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { policyFixture as defaultPolicyFixture } from "./sandbox-fixture.js";
import { findNativeChatWorkspaceScope, nativeChatWorkspaceCwd } from "../../services/native-runtime/native-chat-workspace.js";
import { createToolGatewayService } from "../../services/tool-gateway.js";
import { toolAccessService } from "../../services/tool-access.js";
import { secretService } from "../../services/secrets.js";
import { registerAssignedMcpGateway } from "../../services/native-runtime/assigned-mcp-tools.js";
import { mcpGatewayProtocolRoutes } from "../../routes/tool-gateway.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { deriveNativeConformanceProofMaximum, projectOpenShellPolicy, projectOpenShellQualificationProbePolicy } from "../../services/execution-sandbox/openshell-policy.js";
import { open as unseal } from "../../services/saas/crypto.js";
import { nativeSha256 } from "../../services/native-runtime/canonical.js";
import { hashContextPolicySnapshot } from "../../services/context/context-manifest.js";
import { parseEnvironmentDriverConfig } from "../../services/environment-config.js";
import { compileSandboxPolicy } from "../../services/execution-sandbox/policy-compiler.js";
import { readNativeRuntimeAssetText } from "../../services/native-runtime/runtime-context.js";
import { nativeRuntimeAssetsRoot } from "../../services/native-runtime/runtime-asset-retention.js";
import { resolveDefaultAgentWorkspaceDir, resolvePaperclipInstanceRoot } from "../../home-paths.js";
import { verifyRuntimeToolsToken } from "../../runtime-tools-token.js";
import { REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT, REMOTE_RUNNER_CHILD_LAUNCH_SCRIPT } from "../../services/native-runtime/remote-runner-identity.js";
import { assertManagedNativeProjectWorkspace, type ManagedNativeProjectWorkspaceScope } from "./managed-native-project-workspace-fixture.js";

/** Creates a synthetic proc namespace link, accepting only an exact prior fixture entry. */
export function ensureFixtureNamespaceSymlink(path: string, target: string): void {
  try {
    symlinkSync(target, path);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const existing = lstatSync(path);
  if (!existing.isSymbolicLink() || readlinkSync(path) !== target)
    throw new Error("native_fixture_proc_namespace_link_conflict");
}

/** Closed completed-span projection; it does not identify a currently active phase. */
export function projectCompletedNativeStartupSpans(payloads: readonly unknown[]) {
  const startupSpanNames = new Set([
    "runner.session.startup", "stage.sync", "runner.runtime.stage",
    "runner.artifact.discover", "runner.artifact.link", "runner.artifact.prepare",
    "runner.artifact.verify", "runner.artifact.verify_preinstalled", "runner.artifact.verify_retained",
    "runner.process.dispatch", "runner.process.identity_failure_cleanup", "runner.process.launch",
    "runner.ingress.acquire", "runner.ingress.wait_for_process",
    "runner.transport.activation", "runner.transport.connect", "runner.transport.ready",
    "runner.transport.resolve", "runner.transport.selected",
    "session.checkpoint.restore", "stage.asset.home",
    "runner.session.bootstrap", "runner.session.resume", "runner.turn.submit",
  ]);
  return payloads.slice(0, 32).flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const payload = value as Record<string, unknown>;
    if (payload.schema !== "paperclip.run-performance-span.v1" || typeof payload.span !== "string" ||
      !startupSpanNames.has(payload.span) || typeof payload.durationMs !== "number" ||
      !Number.isFinite(payload.durationMs) || payload.durationMs < 0 ||
      (payload.outcome !== "ok" && payload.outcome !== "failed" && payload.outcome !== "cancelled")) return [];
    return [{ span: payload.span, durationMs: Math.min(86_400_000, Math.trunc(payload.durationMs)), outcome: payload.outcome }];
  }).slice(0, 20);
}

const hostAgentRequire = createRequire(import.meta.url);
const { openShellHostEngine, NATIVE_SESSION_UPPER_ERASE_SCRIPT, NATIVE_ATTACHMENT_STAGE_ERASE_SCRIPT } = hostAgentRequire("../../../../deploy/v6/host-agent/openshell.mjs") as {
  openShellHostEngine: (input: Record<string, unknown>) => any;
  NATIVE_SESSION_UPPER_ERASE_SCRIPT: string;
  NATIVE_ATTACHMENT_STAGE_ERASE_SCRIPT: string;
};

const imageDigest = `fixture.invalid/openshell@sha256:${"a".repeat(64)}`;
const qualificationPolicyGolden = JSON.parse(readFileSync(new URL("../fixtures/openshell-qualification-policy-golden.json", import.meta.url), "utf8")) as { fixture: SandboxQualificationProbeFixture };
const goldenQualificationProbeFixture = qualificationPolicyGolden.fixture;
const conversationRequiredControls = [...SANDBOX_CONTROLS];
const { fixtureHash: _qualificationFixtureHash, ...qualificationFixtureBody } = goldenQualificationProbeFixture;
if (nativeSha256(qualificationFixtureBody) !== goldenQualificationProbeFixture.fixtureHash)
  throw new Error("conversation_software_host_qualification_fixture_hash_mismatch");

function signedRelayProof(hostId: string, privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]) {
  const fields = { hostId, epoch: 1, timestamp: String(Date.now()), nonce: randomBytes(32).toString("base64url") };
  const raw = Buffer.from(JSON.stringify({ hostId, epoch: 1 }));
  const message = runtimeRequestSigningInput("WS", "/api/internal/runtime/relay", createHashHex(raw), fields);
  return { nonce: fields.nonce, proof: { ...fields, signature: sign("sha256", Buffer.from(message), {
    key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
  }).toString("base64url") } };
}

function createHashHex(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function safeSandboxFailureClass(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const known: Array<[string, string]> = [
    ["runner_process_status_unavailable", "runner_process_status_unavailable"],
    ["Current active native Task run is required", "current_native_task_not_active"],
    ["Sandbox execution source changed before claim admission", "source_changed_before_claim"],
    ["A previous sandbox execution on this Task attempt has an unknown outcome", "previous_sandbox_exec_unknown"],
    ["Sandbox execution deadline expired", "sandbox_exec_deadline_expired"],
    ["Sandbox execution scope is stale", "sandbox_exec_scope_stale"],
    ["Sandbox execution capability is no longer active", "sandbox_exec_capability_inactive"],
  ];
  const exact = known.find(([prefix]) => message === prefix || message.startsWith(`${prefix}:`));
  if (exact) return exact[1];
  if (/^[a-z][a-z0-9_:-]{0,99}$/.test(message)) return message;
  return error instanceof Error ? `unclassified_${error.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}` : "non_error_throwable";
}

function safeErrorSourceFrames(error: unknown): Array<{ functionName: string | null; sourceFile: string; line: number }> {
  const stack = error instanceof Error ? error.stack?.split("\n").slice(1) ?? [] : [];
  const frames: Array<{ functionName: string | null; sourceFile: string; line: number }> = [];
  for (const line of stack) {
    const match = /^\s*at (?:(.*?) \()?(.+?):(\d+):\d+\)?$/.exec(line);
    if (!match) continue;
    const sourceFile = match[2]!.split(/[\\/]/).at(-1)!;
    const row = Number(match[3]);
    if (!/^[-\w.]+\.(?:ts|js|mjs|cjs)$/.test(sourceFile) || !Number.isSafeInteger(row)) continue;
    frames.push({ functionName: match[1] || null, sourceFile, line: row });
    if (frames.length >= 8) break;
  }
  return frames;
}

function safeNativePreReceiptFailedChecks(error: unknown): string[] {
  const message = error instanceof Error ? error.message : "";
  const prefix = "Native pre-receipt command is outside the current conversation Run, input, Human and workspace scope:";
  if (!message.startsWith(prefix)) return [];
  const allowed = new Set(["provider", "execution_input", "human_run_manifest", "comment_source", "workspace_roots",
    "trusted_command", "runtime_context_source_authority", "runtime_context_target", "credential_shape", "task_source_owner",
    "workload_credentials", "comment_source_taskSnapshotSingleInput", "comment_source_snapshotInputComment",
    "comment_source_snapshotInputIssueBound", "comment_source_requestInputComment", "comment_source_requestInputIssueBound",
    "comment_source_snapshotAndRequestCommentMatch", "comment_source_wakeCommentIdMatches", "comment_source_markdownMapVersion",
    "comment_source_markdownDigestValid", "comment_source_markdownLengthValid", "comment_source_executionPromptAvailable",
    "comment_source_promptContainsMarkdownLength", "comment_source_promptMarkdownSuffixMatches",
    "comment_source_taskReferencePresent", "comment_source_commentReferencePresent"]);
  return message.slice(prefix.length).split(",").filter((value, index, all) => all.indexOf(value) === index && allowed.has(value)).slice(0, 16);
}


/** The software Host must use the already provisioned image Node, rather
 * than the CI bootstrap's writable toolcache. No signed request env changes. */
function qualifiedFixtureImageNode(configured: string | undefined): string {
  if (configured === undefined) return process.execPath;
  if (!configured || !posix.isAbsolute(configured) || posix.normalize(configured) !== configured ||
      !["/bin/", "/sbin/", "/usr/", "/opt/"].some(root => configured.startsWith(root)))
    throw new Error("fixture_image_node_path_invalid");
  const node = realpathSync(configured);
  const file = lstatSync(configured);
  if (node !== configured || !file.isFile() || file.isSymbolicLink() || file.uid !== 0 ||
      (file.mode & 0o6022) !== 0 || (file.mode & 0o111) === 0)
    throw new Error("fixture_image_node_binary_unqualified");
  for (const image of [node, "/usr/bin/sha256sum"]) {
    for (let current = realpathSync(image); ; current = dirname(current)) {
      const metadata = statSync(current);
      if (metadata.uid !== 0 || (metadata.mode & 0o6022) !== 0)
        throw new Error("fixture_image_node_ancestor_unqualified");
      if (current === "/") break;
    }
  }
  // The existing CI image prerequisite copies the current pinned Node bytes.
  const sums = spawnSync("/usr/bin/sha256sum", [node, process.execPath], {
    encoding: "utf8", timeout: 5_000, maxBuffer: 16 * 1024, env: { PATH: "/usr/bin:/bin" },
  });
  const hashes = typeof sums.stdout === "string" ? sums.stdout.trim().split("\n").map(line => /^([a-f0-9]{64})\s/.exec(line)?.[1]) : [];
  if (sums.error || sums.signal || sums.status !== 0 || hashes.length !== 2 || !hashes[0] || hashes[0] !== hashes[1])
    throw new Error("fixture_image_node_bytes_mismatch");
  return node;
}

type ManagedSandboxHostInput = {
  db: ReturnType<typeof createDb>;
  /** Independent one-connection read-only diagnostic pool, never a runtime owner. */
  diagnosticDb?: ReturnType<typeof createDb>;
  actor: AuthorizationActor;
  companyId: string;
  agentId: string;
  providerBindingId: string;
  preparedRegistration?: ManagedSandboxProviderRegistration;
  gateway: ReturnType<typeof workerModelGateway>;
  profile: import("../../services/orchestration/worker-model-profiles.js").WorkerModelProfile;
  root: string;
  opencodeBinary: string;
  brokerOrigin: string;
  observeModelOriginDenials?: true;
  assignedToolGatewayHttpRequest?: NonNullable<Parameters<typeof createToolGatewayService>[1]>["remoteHttpRequest"];
  /** Fixture-only observer applied to each registered Gateway owner, including scoped DB owners. */
  observeAssignedToolGateway?: (owner: ReturnType<typeof createToolGatewayService>, kind: "host_root" | "scoped") => void;
  brokerProxyOrigin: string | null;
  certBundlePath: string;
  setBrokerToken: (token: string) => void;
  /** A narrower original operator boundary for natural-expiry test cases. */
  wallClockSeconds?: number;
  /** Exact server-created ordinary Worker run; never a model-selected path. */
  ordinaryWorkerRunId?: string;
  /** Bind one real scheduler-created ordinary Run at the existing execution
   * callback. All persisted Task, Human, lease and source checks still run. */
  ordinaryWorker?: true;
  /** Closed test-fixture admission for the registered six-probe Native OpenCode owner. */
  nativeOpenCodeConformance?: true;
  /** Test-only revocation hook after the real signed Host start receipt is persisted. */
  afterSandboxStartReceipt?: (facts: { scope: SandboxIdentity; cleanup: SandboxAdmissionCleanup;
    attemptStop(cleanup: SandboxAdmissionCleanup): Promise<unknown> }) => Promise<void>;
  /** Observe the real Host Stop receipt before EnvironmentRuntime publishes lease cleanup. */
  afterManagedSandboxStopReceipt?: (facts: { scope: { companyId: string; runId: string; leaseId: string }; receipt: unknown }) => Promise<void>;
  /** Existing constructor-only controlled backend: this component performs no model dispatch. */
  controlledNativeSessionBackendFactory?: (execution: import("../../vendor/paperclip-runner/index.js").NativeExecutionInput) =>
    import("../../vendor/paperclip-runner/index.js").NativeSessionBackend;
  /** Explicit same-company Project prepared before the qualified profile; no caller cwd. */
  ordinaryWorkerProject?: ManagedNativeProjectWorkspaceScope;
  /** Invoked only after the closure verifies the attached provider's actual
   * Run token and current DB owner. It scopes fixture response callbacks. */
  withVerifiedModelRun?: (runId: string, work: () => ReturnType<ReturnType<typeof workerModelGateway>["callManagedMessages"]>) =>
    ReturnType<ReturnType<typeof workerModelGateway>["callManagedMessages"]>;
};

async function assertFixtureOrdinaryWorker(input: ManagedSandboxHostInput, runId: string) {
  const { db, actor, companyId, agentId } = input;
    if (input.ordinaryWorkerRunId !== undefined && runId !== input.ordinaryWorkerRunId) throw new Error("worker_software_host_run_changed");
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
      eq(heartbeatRuns.id, runId), eq(heartbeatRuns.agentId, agentId)));
    if (!run || run.runtimeMode !== "native" || run.status !== "running" || run.responsibleUserId !== actor.userId || !run.nativeIssueId)
      throw new Error("worker_software_host_run_binding_invalid");
    const [task] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, run.nativeIssueId)));
    const [chat] = await db.select({ id: chatConversations.id }).from(chatConversations).where(and(
      eq(chatConversations.companyId, companyId), eq(chatConversations.issueId, run.nativeIssueId))).limit(1);
    if (!task || chat || task.originKind === "chat_channel" || task.conversationAgentId || task.conversationUserId ||
      task.assigneeAgentId !== agentId || task.payloadSourceProtocolVersion !== 1 || !task.payloadSourceSnapshot ||
      task.payloadSourceSnapshotInvalidated || !await canActorReadIssuePrivacy(db, actor, task))
      throw new Error("worker_software_host_task_binding_invalid");
    return run;
}

/** Admit only the registered owner's real hidden Run and current group workspace. */
async function assertFixtureNativeOpenCodeConformance(input: ManagedSandboxHostInput, runId: string, leaseId: string) {
  const { db, actor, companyId, agentId } = input;
  const environmentConfig = parseEnvironmentDriverConfig(input.preparedRegistration!.environment);
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
    eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.id, runId))).limit(1);
  const context = run?.contextSnapshot && typeof run.contextSnapshot === "object"
    ? run.contextSnapshot as Record<string, unknown> : {};
  const [task] = run?.nativeIssueId ? await db.select().from(issues).where(and(eq(issues.companyId, companyId),
    eq(issues.id, run.nativeIssueId))).limit(1) : [];
  const [plan] = typeof context.providerConformancePlanId === "string" && task
    ? await db.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, companyId),
      eq(orchestrationPlans.id, context.providerConformancePlanId), eq(orchestrationPlans.issueId, task.id))).limit(1) : [];
  const [manifest] = await db.select().from(agentExecutionManifests).where(and(
    eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.runId, runId),
    eq(agentExecutionManifests.agentId, agentId))).limit(1);
  const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object"
    ? run.runnerProfileJson as Record<string, unknown> : {};
  const execution = profile.nativeExecutionInput && typeof profile.nativeExecutionInput === "object"
    ? profile.nativeExecutionInput as Record<string, any> : {};
  const workspace = profile.nativeOpenCodeConformanceWorkspace && typeof profile.nativeOpenCodeConformanceWorkspace === "object"
    ? profile.nativeOpenCodeConformanceWorkspace as Record<string, unknown> : {};
  const dispatch = context.nativeOpenCodeConformanceDispatch && typeof context.nativeOpenCodeConformanceDispatch === "object"
    ? context.nativeOpenCodeConformanceDispatch as Record<string, unknown> : null;
  const [lease] = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, companyId), eq(environmentLeases.id, leaseId),
    eq(environmentLeases.heartbeatRunId, runId),
    eq(environmentLeases.environmentId, input.preparedRegistration!.environment.id),
    eq(environmentLeases.status, "active"))).limit(1);
  const workers = plan ? await db.select({ id: orchestrationWorkers.id }).from(orchestrationWorkers)
    .where(eq(orchestrationWorkers.planId, plan.id)) : [];
  const attempts = plan ? await db.select({ id: orchestrationWorkerAttempts.id }).from(orchestrationWorkerAttempts)
    .where(eq(orchestrationWorkerAttempts.planId, plan.id)) : [];
  const manifestValue = manifest?.manifest && typeof manifest.manifest === "object"
    ? manifest.manifest as Record<string, unknown> : {};
  const executionScope = manifestValue.executionScope && typeof manifestValue.executionScope === "object"
    ? manifestValue.executionScope as Record<string, unknown> : {};
  const noTools = Array.isArray(manifestValue.capabilities) && manifestValue.capabilities.length === 0 &&
    Array.isArray(manifestValue.skills) && manifestValue.skills.length === 0 &&
    Array.isArray(manifestValue.playbooks) && manifestValue.playbooks.length === 0 &&
    executionScope.primaryCompanyId === companyId && executionScope.primaryAgentPresenceId === agentId &&
    Array.isArray(executionScope.delegatedScopes) && executionScope.delegatedScopes.length === 0;
  const currentAuthority = lease ? await executionSandboxService(db).assertTaskExecutionContext(db, {
    companyId, runId, leaseId: lease.id,
  }) : null;
  let creationReceiptMatches = false;
  try {
    const instanceRoot = realpathSync(resolvePaperclipInstanceRoot());
    const expectedRoot = join(instanceRoot, "chat-workspaces", companyId, agentId, task?.id ?? "");
    const receiptKey = createHash("sha256")
      .update(`${String(workspace.groupId)}\0${companyId}\0${agentId}\0${task?.id ?? ""}`).digest("hex");
    const receipt = JSON.parse(readFileSync(join(instanceRoot, "chat-workspace-proofs", `${receiptKey}.json`), "utf8")) as Record<string, unknown>;
    const rootStat = lstatSync(expectedRoot), rootReal = realpathSync(expectedRoot);
    creationReceiptMatches = rootStat.isDirectory() && !rootStat.isSymbolicLink() && rootReal === expectedRoot &&
      workspace.taskRoot === expectedRoot && workspace.localCwd === expectedRoot &&
      receipt.schema === "paperclip.native-opencode-conformance-workspace/v1" &&
      receipt.groupId === workspace.groupId && receipt.companyId === companyId && receipt.agentId === agentId &&
      receipt.taskId === task?.id && receipt.taskRoot === expectedRoot && receipt.cwd === expectedRoot &&
      receipt.workspaceId === workspace.workspaceId && receipt.dev === rootStat.dev && receipt.ino === rootStat.ino &&
      nativeSha256(receipt) === workspace.creationReceipt;
  } catch { creationReceiptMatches = false; }
  if (!run || run.status !== "running" || run.runtimeMode !== "native" || run.triggerDetail !== "provider_conformance" ||
      run.responsibleUserId !== actor.userId || !run.nativeIssueId || !task || task.hiddenAt === null ||
      task.harnessKind !== "provider_conformance" || task.assigneeAgentId !== agentId || task.status !== "in_progress" ||
      task.executionRunId !== runId || task.conversationAgentId !== null || task.conversationUserId !== null ||
      task.projectId !== null || task.parentId !== null || plan?.status !== "paused" || plan.actionClass !== "internal_draft" ||
      plan.riskClass !== "C0" || plan.budgets.maxToolActions !== 0 || plan.budgets.maxRetries !== 0 ||
      context.providerConformancePlanId !== plan?.id || typeof context.providerConformanceGroupId !== "string" ||
      typeof context.nativeOpenCodeConformanceProbeId !== "string" ||
      context.nativeOpenCodeConformanceProfileId !== input.profile.id || context.containsCompanyContext !== false ||
      context.platformToolsGranted !== false || !manifest || !noTools || workers.length !== 0 || attempts.length !== 0 ||
      execution.binding?.companyId !== companyId || execution.binding?.agentId !== agentId ||
      execution.binding?.runId !== runId || execution.binding?.issueId !== task.id ||
      execution.workspace?.cwd !== workspace.remoteCwd || typeof workspace.remoteCwd !== "string" ||
      !isAbsolute(workspace.remoteCwd) || workspace.schema !== "paperclip.native-opencode-conformance-workspace/v1" ||
      workspace.groupId !== context.providerConformanceGroupId || workspace.companyId !== companyId ||
      workspace.agentId !== agentId || workspace.taskId !== task.id || workspace.leaseId !== leaseId ||
      typeof workspace.createdEmpty !== "boolean" || !creationReceiptMatches || typeof workspace.creationReceipt !== "string" ||
      typeof workspace.authorityHash !== "string" || !/^[a-f0-9]{64}$/.test(workspace.authorityHash) ||
      !lease || lease.status !== "active" || environmentConfig.driver !== "sandbox" || lease.provider !== environmentConfig.config.provider ||
      !lease.expiresAt || lease.expiresAt <= new Date() || !currentAuthority ||
      currentAuthority.authorityHash !== workspace.authorityHash ||
      (dispatch !== null && (dispatch.qualificationGroupId !== workspace.groupId || dispatch.planId !== plan?.id ||
        dispatch.profileId !== input.profile.id || dispatch.probeId !== context.nativeOpenCodeConformanceProbeId)))
    throw new Error("scheduler_software_host_conformance_run_not_current");
  return { run, task, plan: plan!, manifest, lease, workspace, execution, dispatch };
}

async function preflightManagedSandboxInput(input: ManagedSandboxHostInput) {
  if (input.ordinaryWorkerProject && !input.ordinaryWorker && !input.ordinaryWorkerRunId)
    throw new Error("worker_software_host_project_requires_ordinary_worker");
  const fixtureImageNode = qualifiedFixtureImageNode(process.env.PAPERCLIP_TEST_ERASER_NODE_PATH);
  const maximum = defaultPolicyFixture().resources.wallClockSeconds;
  if (input.wallClockSeconds !== undefined && (!Number.isSafeInteger(input.wallClockSeconds) ||
      input.wallClockSeconds < 1 || input.wallClockSeconds > maximum))
    throw new Error("fixture_original_wall_clock_boundary_invalid");
  if (input.ordinaryWorkerRunId) await assertFixtureOrdinaryWorker(input, input.ordinaryWorkerRunId);
  if (!input.ordinaryWorker && !input.ordinaryWorkerRunId) await realpath(resolvePaperclipInstanceRoot());
  return fixtureImageNode;
}

type ManagedFixtureInfrastructureCleanup = {
  restoreEnvironment: () => void; retireData: () => void; retainData: (reason: string) => void;
};
async function finishManagedFixtureInfrastructure(infrastructure: ManagedFixtureInfrastructureCleanup,
  close: () => Promise<void>, proveClosed: () => Promise<void>) {
  let servicesClosed = false;
  try { await close(); servicesClosed = true; }
  finally {
    infrastructure.restoreEnvironment();
    if (servicesClosed) {
      try { await proveClosed(); infrastructure.retireData(); }
      catch { infrastructure.retainData("native_closure_not_proven"); }
    } else infrastructure.retainData("host_services_close_failed");
  }
}
export async function configureManagedConversationSandboxHost(input: ManagedSandboxHostInput) {
  const fixtureImageNode = await preflightManagedSandboxInput(input);
  const infrastructure = await installManagedSandboxInfrastructure(input, fixtureImageNode);
  try {
    const host = await configureManagedSandboxRun(input, infrastructure);
    return { ...host, close: () => finishManagedFixtureInfrastructure(infrastructure,
      () => host.close(), () => host.proveImageDataRetirement()) };
  } catch (error) {
    infrastructure.restoreEnvironment(); infrastructure.retainData("host_prepare_failed"); throw error;
  }
}

export async function ensureManagedSandboxEnvironmentForAgent(
  db: Parameters<typeof environmentService>[0], companyId: string, agentId: string,
) {
  const { environment } = await environmentService(db).ensureManagedSandboxEnvironment({ companyId,
    name: `Conversation managed sandbox ${agentId}`, provider: "fake", stockVersion: "conversation-software-host-v1",
    config: { image: "ubuntu:24.04", reuseLease: false } });
  await db.update(agents).set({ defaultEnvironmentId: environment.id })
    .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
  return environment;
}

export async function registerManagedSandboxProvider(
  input: Pick<ManagedSandboxHostInput, "db" | "actor" | "companyId" | "agentId" | "providerBindingId"> &
    { nativeOpenCodeConformance?: true; sandboxQualificationOperator?: AuthorizationActor },
) {
  const { db, actor, companyId, agentId, providerBindingId } = input;
  const nativeOpenCodeConformance = input.nativeOpenCodeConformance === true;
  const hostKeys = generateKeyPairSync("rsa", { modulusLength: 3072 });
  await instanceSettingsService(db).updateExperimental({
    sandbox_abstraction_v7: true, openshell_v7: true, runtime_host_agent_v6: true,
    hosted_openclaw_v6: true,
    saas_deployment_profile_v6: true, billing_v6: true, billing_entitlements_v6: true, billing_usage_v6: true,
  });
  const catalogEntry = { imageDigest, providerVersion: "fixture-software-host",
    stateFormat: "v1", hostAgentMinimumVersion: "6.0.0", conformance: { controlledSoftwareHost: true }, status: "approved" } as const;
  await db.insert(runtimeVersionCatalog).values(catalogEntry).onConflictDoNothing();
  const [catalog] = await db.select().from(runtimeVersionCatalog).where(eq(runtimeVersionCatalog.imageDigest, imageDigest));
  if (!catalog || catalog.providerVersion !== catalogEntry.providerVersion || catalog.stateFormat !== catalogEntry.stateFormat ||
      catalog.hostAgentMinimumVersion !== catalogEntry.hostAgentMinimumVersion || catalog.status !== catalogEntry.status ||
      nativeSha256(catalog.conformance) !== nativeSha256(catalogEntry.conformance))
    throw new Error("conversation_software_host_catalog_changed");
  const conversationHostCapacity = { cpuMillis: 1000, memoryBytes: 1073741824n, diskBytes: 10737418240n, pidsLimit: 128 };
  await db.insert(runtimeCapacityProfiles).values({ key: "conversation-software-host", ...conversationHostCapacity, qualified: true })
    .onConflictDoNothing();
  const [capacity] = await db.select().from(runtimeCapacityProfiles).where(eq(runtimeCapacityProfiles.key, "conversation-software-host"));
  if (!capacity || !capacity.qualified || capacity.cpuMillis !== conversationHostCapacity.cpuMillis ||
      capacity.memoryBytes !== conversationHostCapacity.memoryBytes || capacity.diskBytes !== conversationHostCapacity.diskBytes ||
      capacity.pidsLimit !== conversationHostCapacity.pidsLimit)
    throw new Error("conversation_software_host_capacity_profile_changed");
  const [host] = await db.insert(runtimeHosts).values({ environment: "test", region: "local", capacityClass: "software-fixture",
    cpuTotalMillis: 4000, memoryTotalBytes: 8000000000n, diskTotalBytes: 40000000000n,
    publicKeyPem: hostKeys.publicKey.export({ type: "spki", format: "pem" }).toString(), status: "READY",
    hostAgentVersion: "6.0.2", lastHeartbeatAt: new Date() }).returning();
  if (!host) throw new Error("conversation_software_host_row_missing");
  const payerUserId = actor.userId;
  if (!payerUserId || v5HumanActorId(actor) !== payerUserId) throw new Error("conversation_software_host_payer_missing");
  const account = await db.transaction(async tx => {
    await assertV5Authorization(tx as unknown as ReturnType<typeof createDb>, actor, companyId, "agents:configure",
      { type: "agent", companyId, agentId });
    // The company lock serializes the absent-association case as well as reuse.
    // The existing unique active-company association remains authoritative.
    const [company] = await tx.select({ id: companies.id }).from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.status, "active"))).for("update");
    if (!company) throw new Error("conversation_software_host_billing_company_unavailable");
    const [association] = await tx.select().from(billingAccountCompanies).where(and(
      eq(billingAccountCompanies.companyId, companyId), eq(billingAccountCompanies.status, "active"))).limit(1);
    let selected: typeof billingAccounts.$inferSelect;
    if (association) {
      const [existing] = await tx.select().from(billingAccounts)
        .where(eq(billingAccounts.id, association.billingAccountId)).limit(1).for("update");
      if (!existing || existing.payerUserId !== payerUserId || existing.status !== "active" || existing.closedAt !== null)
        throw new Error("conversation_software_host_billing_account_changed");
      selected = existing;
    } else {
      const [created] = await tx.insert(billingAccounts)
        .values({ displayName: "Conversation software host fixture", payerUserId }).returning();
      if (!created) throw new Error("conversation_software_host_billing_account_missing");
      await tx.insert(billingAccountCompanies).values({ companyId, billingAccountId: created.id });
      for (const productKeys of [["platform", "runtime_standard"], ["runtime_standard"]])
        await tx.insert(billingSubscriptions).values({ billingAccountId: created.id,
          providerSubscriptionId: `conversation-software-${randomUUID()}`, status: "active", productKeys,
          currentPeriodEnd: new Date(Date.now() + 86_400_000), providerUpdatedAt: new Date(), sourceHash: "controlled-software-host-fixture" });
      selected = created;
    }
    const entitlement = await entitlementService(tx as unknown as ReturnType<typeof createDb>)
      .require(companyId, "hosted_runtime.provision");
    if (entitlement.billingAccountId !== selected.id || entitlement.entitlements["platform.access"] !== true)
      throw new Error("conversation_software_host_billing_entitlement_changed");
    return selected;
  });
  const [cell] = await db.insert(runtimeCells).values({ companyId, billingAccountId: account.id,
    capacityProfile: "conversation-software-host", desiredImageDigest: imageDigest, status: "STOPPED",
    isolationMode: "company_cell", runtimeHostId: host.id, providerBindingId }).returning();
  if (!cell) throw new Error("conversation_software_host_cell_missing");
  // This fixture represents a V6-qualified profile and the existing reservation owned by this STOPPED cell.
  // Sandbox qualification must reuse this bounded profile, not allocate untracked capacity.
  await db.update(runtimeHosts).set({ cpuReservedMillis: conversationHostCapacity.cpuMillis,
    memoryReservedBytes: conversationHostCapacity.memoryBytes, diskReservedBytes: conversationHostCapacity.diskBytes })
    .where(eq(runtimeHosts.id, host.id));
  const [provider] = await db.select().from(agentProviderBindings).where(eq(agentProviderBindings.id, providerBindingId)).limit(1);
  if (!provider) throw new Error("conversation_software_host_provider_binding_missing");
  const providerService = agentProviderBindingService(db);
  await providerService.attach(actor, companyId, agentId, {
    providerBindingId, providerProfileRef: `aw:cell:${cell.id}:generation:${cell.generation}`,
  });
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) throw new Error("conversation_software_host_agent_missing");
  const providerSnapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId,
    adapterType: agent.adapterType, config: agent.adapterConfig }));
  const providerSnapshotInput = Object.fromEntries(Object.entries(providerSnapshot).filter(([key]) => key !== "hash")) as Omit<typeof providerSnapshot, "hash">;
  await providerService.recordDiscovery(companyId, agentId, providerSnapshotInput,
    Object.fromEntries(providerConformanceRequirements(providerSnapshot, "isolated_per_presence")
      .map(check => [check, nativeOpenCodeConformance ? false : true])));
  const qualifiedProvider = nativeOpenCodeConformance
    ? await providerService.getForPresence(actor, companyId, agentId)
    : await providerService.assertRuntime(companyId, agentId);
  if (!qualifiedProvider) throw new Error("conversation_software_host_provider_binding_missing");
  const providerProfileRef = qualifiedProvider.runtime.providerProfileRef;
  if (!providerProfileRef) throw new Error("conversation_software_host_provider_profile_missing");
  const providerSnapshotHash = qualifiedProvider.provider.capabilitySnapshotHash;
  if (!providerSnapshotHash) throw new Error("conversation_software_host_provider_snapshot_missing");
  const environment = await ensureManagedSandboxEnvironmentForAgent(db, companyId, agentId);

  const configurationHash = qualifiedProvider.runtime.qualifiedConfigurationHash ??
    hashContextPolicySnapshot({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig });
  const conformanceHash = nativeSha256(qualifiedProvider.runtime.conformanceReport);
  const assertCurrent = async (currentInput: Pick<ManagedSandboxHostInput,
    "db" | "actor" | "companyId" | "agentId" | "providerBindingId">,
    profile?: ManagedSandboxHostInput["profile"]) => {
    if (currentInput.db !== db || currentInput.companyId !== companyId || currentInput.agentId !== agentId ||
        currentInput.providerBindingId !== providerBindingId || currentInput.actor.userId !== payerUserId ||
        currentInput.actor.sessionId !== actor.sessionId)
      throw new Error("conversation_software_host_registration_owner_changed");
    const current = nativeOpenCodeConformance
      ? await providerService.getForPresence(actor, companyId, agentId)
      : await providerService.assertRuntime(companyId, agentId);
    const [currentAgent] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
    const [currentCell] = await db.select().from(runtimeCells).where(and(eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, cell.id)));
    const [currentHost] = await db.select().from(runtimeHosts).where(eq(runtimeHosts.id, host.id));
    const [currentEnvironment] = await db.select().from(environments).where(eq(environments.id, environment.id));
    const [currentBilling] = await db.select().from(billingAccountCompanies).where(and(
      eq(billingAccountCompanies.companyId, companyId), eq(billingAccountCompanies.status, "active"),
      eq(billingAccountCompanies.billingAccountId, account.id))).limit(1);
    const [currentAccount] = await db.select().from(billingAccounts).where(eq(billingAccounts.id, account.id)).limit(1);
    const currentConfigurationHash = current?.runtime.qualifiedConfigurationHash ??
      (nativeOpenCodeConformance && currentAgent
        ? hashContextPolicySnapshot({ adapterType: currentAgent.adapterType, adapterConfig: currentAgent.adapterConfig }) : null);
    if (!current || current.provider.id !== providerBindingId || current.runtime.id !== qualifiedProvider.runtime.id ||
        current.runtime.providerProfileRef !== providerProfileRef || current.provider.capabilitySnapshotHash !== providerSnapshotHash ||
        currentConfigurationHash !== configurationHash || nativeSha256(current.runtime.conformanceReport) !== conformanceHash ||
        !currentAgent || currentAgent.defaultEnvironmentId !== environment.id ||
        !currentBilling || !currentAccount || currentAccount.payerUserId !== payerUserId ||
        currentAccount.status !== "active" || currentAccount.closedAt !== null ||
        !currentCell || currentCell.generation !== cell.generation || currentCell.runtimeHostId !== host.id || currentCell.providerBindingId !== providerBindingId ||
        currentCell.billingAccountId !== account.id || currentCell.desiredImageDigest !== imageDigest ||
        currentCell.capacityProfile !== cell.capacityProfile || currentCell.isolationMode !== cell.isolationMode ||
        !currentHost || currentHost.publicKeyPem !== host.publicKeyPem || currentHost.credentialVersion !== host.credentialVersion ||
        currentHost.credentialRevokedAt !== null || currentHost.fencedAt !== null || currentHost.retiredAt !== null ||
        !currentEnvironment || currentEnvironment.status !== environment.status || currentEnvironment.driver !== environment.driver ||
        nativeSha256(currentEnvironment.envVars) !== nativeSha256(environment.envVars) ||
        nativeSha256(currentEnvironment.config) !== nativeSha256(environment.config) ||
        (profile && (profile.companyId !== companyId || profile.workerAgentId !== agentId ||
          profile.providerBindingId !== providerBindingId || profile.providerProfileRef !== providerProfileRef ||
          profile.providerSnapshotHash !== providerSnapshotHash || profile.qualifiedConfigurationHash !== configurationHash)))
      throw new Error("conversation_software_host_registration_changed");
  };
  // DB/provider preparation only: no Run, lease, image directory, process environment or gateway is installed.
  if (nativeOpenCodeConformance && (!input.sandboxQualificationOperator?.userId ||
      input.sandboxQualificationOperator.userId === actor.userId || input.sandboxQualificationOperator.type !== "board"))
    throw new Error("conversation_software_host_distinct_qualification_operator_required");
  return Object.freeze({ hostKeys, host, cell, environment, conversationHostCapacity, payerUserId,
    ...(input.sandboxQualificationOperator ? { sandboxQualificationOperator: input.sandboxQualificationOperator } : {}),
    providerProfileRef, providerSnapshotHash, assertCurrent });
}
export type ManagedSandboxProviderRegistration = Awaited<ReturnType<typeof registerManagedSandboxProvider>>;

async function installManagedSandboxInfrastructure(input: ManagedSandboxHostInput, fixtureImageNode: string) {
  const registration = input.preparedRegistration ?? await registerManagedSandboxProvider(input);
  const { hostKeys, host, cell, environment, conversationHostCapacity, payerUserId,
    sandboxQualificationOperator, providerProfileRef, providerSnapshotHash } = registration;
  // Existing single-Agent callers still install their canonical profile here.
  // Pre-registered two-Agent callers must already have sealed this exact tuple.
  if (!input.preparedRegistration) {
    input.profile.providerProfileRef = providerProfileRef;
    input.profile.providerSnapshotHash = providerSnapshotHash;
  }
  await registration.assertCurrent(input, input.profile);
  const { db, companyId, agentId } = input;
  const brokerOrigin = new URL(input.brokerOrigin).origin;

  const secrets = secretService(db);
  const runtimeSecretValue = `runtime-secret-${randomUUID()}`;
  const runtimeSecret = await secrets.create(companyId, {name:`Runtime broker ${randomUUID()}`,
    key:`runtime_broker_${randomUUID().replace(/-/g,"")}`,provider:"local_encrypted",value:runtimeSecretValue});
  const schemas = {
    read_canary:{type:"object",properties:{fixtureId:{type:"string"},caseId:{type:"string"},nonce:{type:"string"}},required:["fixtureId","caseId","nonce"],additionalProperties:false},
    read_record:{type:"object",properties:{id:{type:"string"}},required:["id"],additionalProperties:false},
  };
  const fixtureToolAccess = toolAccessService(db,{
    remoteHttpEndpointLookup:async()=>[{address:"8.8.8.8",family:4}],
    remoteHttpRequest:async(url,init)=>{
      const rpc=JSON.parse(String(init.body)) as {id:unknown;method:string};
      assert.equal(rpc.method,"tools/list");
      const tool=url === `${brokerOrigin}/mcp/qualification/credential-echo` ? "read_canary" : url === "https://provider.example.test/mcp" ? "read_record" : null;
      assert.ok(tool,"Unknown software fixture destination");
      return new Response(JSON.stringify({jsonrpc:"2.0",id:rpc.id,result:{tools:[{name:tool,
        description:"Read fixed software fixture",inputSchema:schemas[tool],annotations:{readOnlyHint:true}}]}}),
        {status:200,headers:{"content-type":"application/json"}});
    },
  });
  const makeConnection=async(kind:"canary"|"runtime",secretId:string)=>{
    const connectionOwnerUserId = kind === "canary" ? sandboxQualificationOperator?.userId ?? payerUserId : payerUserId;
    const applicationKey=`conversation-${kind}-${randomUUID().replace(/-/g,"")}`;
    const [application]=await db.insert(toolApplications).values({companyId,applicationKey,name:`Conversation ${kind} fixture ${applicationKey}`,type:"mcp_http",status:"active"}).returning();
    assert.ok(application);
    const url=kind === "canary" ? `${brokerOrigin}/mcp/qualification/credential-echo` : "https://provider.example.test/mcp";
    const credentialSecretRefs=[{secretId,versionSelector:"latest" as const,configPath:"credentials.authorization",required:true,label:`${kind} fixture credential`}];
    const connection=await fixtureToolAccess.createConnection(companyId,{applicationId:application.id,name:`Conversation ${kind} fixture`,
      connectionPurpose:"tool",authKind:"api_key",ownership:"customer",connectionKind:"managed",
      transport:"mcp_remote",status:"active",enabled:true,config:{url},transportConfig:{url},
      credentialRefs:[{name:"credentials.authorization",secretId,version:"latest",placement:"header",key:"Authorization",prefix:"Bearer "}],
      credentialSecretRefs},{actorType:"user",actorId:connectionOwnerUserId});
    const upstream=kind === "canary" ? "read_canary" : "read_record";
    await db.insert(toolCatalogEntries).values({companyId,applicationId:application.id,connectionId:connection.id,entryKind:"tool",
      name:`${upstream}-${randomUUID()}`,toolName:upstream,title:`Read ${kind}`,description:"Read fixed software fixture",
      inputSchema:schemas[upstream],annotations:{readOnlyHint:true},riskLevel:"read",isReadOnly:true,isWrite:false,isDestructive:false,
      status:"active",versionHash:randomUUID(),quarantinedAt:null});
    const health=await fixtureToolAccess.checkHealth(connection.id,{actorType:"user",actorId:connectionOwnerUserId});
    assert.equal(health.connection.healthStatus,"ok");
    const [grant]=await db.select().from(connectionGrants).where(and(eq(connectionGrants.companyId,companyId),
      eq(connectionGrants.connectionId,connection.id),eq(connectionGrants.status,"active"),eq(connectionGrants.isDefault,true))).limit(1);
    assert.ok(grant);assert.equal(grant.kind,"organization");
    const toolName=`mcp.${applicationKey.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")}-${connection.id.replace(/-/g,"").slice(0,8)}:${upstream.replace(/_/g,"-")}`;
    return {connection,grant,toolName,credentialSecretRefs};
  };
  const runtimeConnection = await makeConnection("runtime", runtimeSecret.id);
  const [runtimeToolProfile]=await db.insert(toolProfiles).values({companyId,profileKey:`conversation-runtime-${randomUUID()}`,
    name:`Conversation runtime broker fixture ${randomUUID()}`,defaultAction:"deny"}).returning();
  assert.ok(runtimeToolProfile);
  await db.insert(toolProfileBindings).values({companyId,profileId:runtimeToolProfile.id,targetType:"agent",targetId:agentId});
  await db.insert(toolProfileEntries).values({companyId,profileId:runtimeToolProfile.id,selectorType:"tool_name",effect:"include",toolName:runtimeConnection.toolName});
  const [runtimePresence]=await db.select({id:agentPresenceRuntimeBindings.id}).from(agentPresenceRuntimeBindings).where(and(
    eq(agentPresenceRuntimeBindings.companyId,companyId),eq(agentPresenceRuntimeBindings.agentId,agentId),
    input.nativeOpenCodeConformance
      ? and(eq(agentPresenceRuntimeBindings.providerBindingId, input.profile.providerBindingId),
        inArray(agentPresenceRuntimeBindings.status, ["degraded", "active"]))
      : eq(agentPresenceRuntimeBindings.status,"active"))).limit(1);
  assert.ok(runtimePresence);
  const providerPackRoot = process.env.PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH?.trim();
  if (!providerPackRoot || !lstatSync(providerPackRoot).isDirectory())
    throw new Error("conversation_software_host_provider_pack_image_missing");
  // Build the fixture image only from the same manifest and file verifier used
  // by the real Native runner. A directory with a plausible binary is not an
  // image prerequisite; the complete pack, pins, artifact hashes, and dist
  // tree must match before it is made discoverable to remote preparation.
  const providerPackManifest = readRemoteProviderPackManifest(providerPackRoot);
  if (providerPackManifest.payload.target.platform !== process.platform ||
      providerPackManifest.payload.target.architecture !== process.arch ||
      providerPackManifest.payload.artifacts.opencodeExecutable.sha256 !==
        `sha256:${MANAGED_NATIVE_OPENCODE_IMAGE_PIN.sha256}`)
    throw new Error("conversation_software_host_provider_pack_image_pin_mismatch");
  const providerImageHome = mkdtempSync(join(tmpdir(), "paperclip-managed-provider-image-"));
  const preinstalledPack = join(providerImageHome, ".local", "share", "paperclip-runner", "provider-pack");
  mkdirSync(join(providerImageHome, ".local", "share", "paperclip-runner"), { recursive: true, mode: 0o700 });
  symlinkSync(providerPackRoot, preinstalledPack, "dir");
  const previousInstalledPackRoot = process.env.PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_INSTALL_ROOT;
  process.env.PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_INSTALL_ROOT = preinstalledPack;

  const createCanary = async () => {
    const canarySecretValue = `qualification-secret-${randomUUID()}`;
    const secret = await secrets.create(companyId, {name:`Qualification canary ${randomUUID()}`,
      key:`qualification_canary_${randomUUID().replace(/-/g,"")}`,provider:"local_encrypted",value:canarySecretValue});
    const canary = await makeConnection("canary", secret.id);
    assert.notEqual(canary.connection.id, runtimeConnection.connection.id);
    assert.notEqual(canary.grant.id, runtimeConnection.grant.id);
    return { canary, canarySecretValue };
  };
  return Object.freeze({ hostKeys, host, cell, environment, conversationHostCapacity, payerUserId, fixtureImageNode, sandboxQualificationOperator,
    runtimeConnection, runtimePresence, createCanary, providerImageHome, fixtureToolAccess, runtimeSecretValue,
    assertInstalledProfileCurrent: () => registration.assertCurrent(input, input.profile),
    restoreEnvironment: () => {
      if (process.env.PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_INSTALL_ROOT === preinstalledPack) {
        if (previousInstalledPackRoot === undefined) delete process.env.PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_INSTALL_ROOT;
        else process.env.PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_INSTALL_ROOT = previousInstalledPackRoot;
      }
    },
    retireData: () => { rmSync(providerImageHome, { recursive: true, force: true }); },
    retainData: (reason: string) => {
      console.info("managed_software_host_image_retained", JSON.stringify({ path: providerImageHome, reason }));
    } });
}

type SerialHostAdmission<Host> = { leaseId: string; promise: Promise<Host>; closed: boolean; host?: Host };

/** Snapshot BEFORE insertion: A cannot await later B while B awaits A. This
 * schedules fixture setup only; the supplied callback retains all DB owners. */
function reserveSerialHostAdmission<Host>(admissions: Map<string, SerialHostAdmission<Host>>, runId: string,
  leaseId: string, transition: Promise<void>, prepare: (prior: Array<[string, SerialHostAdmission<Host>]>) => Promise<Host>) {
  if (admissions.has(runId)) throw new Error("scheduler_software_host_duplicate_reservation");
  const prior = [...admissions.entries()];
  const entry: SerialHostAdmission<Host> = { leaseId, closed: false, promise: transition.then(() => prepare(prior)) };
  admissions.set(runId, entry);
  return entry;
}

function authenticateSerialModelRequest(authorization: string | undefined,
  scope: { companyId: string; agentId: string; runId?: string; capabilityToken?: string; providerConformance?: true }) {
  const match = typeof authorization === "string" ? /^Bearer\s+(\S+)$/i.exec(authorization) : null;
  const token = match?.[1];
  const claims = token ? verifyRuntimeToolsToken(token, scope.providerConformance ? "provider_conformance" : "worker_model") : null;
  if (!token || !claims || (scope.providerConformance ? !claims.provider_conformance : !claims.worker_model) ||
      claims.company_id !== scope.companyId || claims.sub !== scope.agentId ||
      (scope.runId !== undefined && claims.run_id !== scope.runId) ||
      (scope.capabilityToken !== undefined && nativeSha256(token) !== nativeSha256(scope.capabilityToken)))
    throw Object.assign(new Error("scheduler_software_host_incoming_model_authority_invalid"), {
      serialIncomingCredentialKind: !authorization ? "absent" : !match ? "non_bearer"
        : token?.split(".").length === 3 ? "jwt" : "opaque",
    });
  return { token, claims };
}

function serialModelAdmission<Host>(authorization: string | undefined,
  scope: { companyId: string; agentId: string; providerConformance?: true }, admissions: ReadonlyMap<string, { closed: boolean; host?: Host }>) {
  // Authentication precedes selecting a server-side provider/context. An
  // SDK placeholder, raw body Run, or sole live attachment grants nothing.
  const authenticated = authenticateSerialModelRequest(authorization, scope);
  const entry = admissions.get(authenticated.claims.run_id);
  if (!entry?.host || entry.closed) throw new Error("scheduler_software_host_incoming_run_not_admitted");
  return { ...authenticated, host: entry.host };
}

/** Pure fixture control seams: no database rows, admission flags or source
 * authorities are minted. Used by the deterministic unit/HTTP controls. */
export const managedSerialSchedulerFixtureControls = Object.freeze({
  reserveSerialHostAdmission, authenticateSerialModelRequest, serialModelAdmission, finishManagedFixtureInfrastructure,
});

/** Explicit serial scheduler scope. Infrastructure/profile is installed once,
 * before Plan quotes. Every admitted Run retains the original Host closure. */
export async function configureManagedSerialSchedulerSandboxHost(
  input: Omit<ManagedSandboxHostInput, "ordinaryWorker" | "ordinaryWorkerRunId">,
) {
  // A Project tuple is checked for each actual Run by configureManagedSandboxRun;
  // serial admission still binds exact Run/lease and retires the predecessor Host.
  if (input.nativeOpenCodeConformance && (!input.preparedRegistration || input.ordinaryWorkerProject))
    throw new Error("conformance_software_host_requires_exact_registered_presence");
  const fixtureImageNode = await preflightManagedSandboxInput(input.nativeOpenCodeConformance
    ? input : { ...input, ordinaryWorker: true });
  const infrastructure = await installManagedSandboxInfrastructure(input, fixtureImageNode);
  type Host = Awaited<ReturnType<typeof configureManagedSandboxRun>>;
  type Admission = SerialHostAdmission<Host>;
  const hostAdmissionByRun = new Map<string, Admission>();
  const preparedHostsByRun = new Map<string, Host>();
  // The conformance cell's real signed Host and base boundary are qualified
  // before the first hidden Run is minted. The first exact Run then adopts
  // this prepared owner; later Runs receive fresh per-run Host closures.
  let prequalifiedConformanceHost: Host | null = input.nativeOpenCodeConformance
    ? await configureManagedSandboxRun({ ...input, root: join(input.root, "scheduler-hosts", "prequalified") }, infrastructure, true)
    : null;
  let transition = Promise.resolve();
  let closing = false;
  const exactAdmission = async (runId: string, leaseId: string) => {
    if (closing) throw new Error("scheduler_software_host_closed");
    const known = hostAdmissionByRun.get(runId);
    if (known) {
      if (known.leaseId !== leaseId) throw new Error("scheduler_software_host_lease_changed");
      if (known.closed) throw new Error("scheduler_software_host_run_retired");
      return await known.promise;
    }
    // Reserve the immutable actual Run/lease key synchronously. Concurrent
    // callers join this promise; no mutable latest-Run routing is involved.
    const entry = reserveSerialHostAdmission(hostAdmissionByRun, runId, leaseId, transition, async priorAdmissions => {
      if (closing) throw new Error("scheduler_software_host_closed");
      const [run] = await input.db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
        eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.id, runId))).limit(1);
      const [lease] = await input.db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, input.companyId),
        eq(environmentLeases.id, leaseId), eq(environmentLeases.heartbeatRunId, runId),
        eq(environmentLeases.environmentId, infrastructure.environment.id))).limit(1);
      if (input.nativeOpenCodeConformance) {
        await assertFixtureNativeOpenCodeConformance(input, runId, leaseId);
        if (!lease || lease.status !== "active" || !lease.expiresAt || lease.expiresAt <= new Date())
          throw new Error("scheduler_software_host_current_run_lease_required");
      } else if (!run || run.status !== "running" || run.runtimeMode !== "native" || run.responsibleUserId !== input.actor.userId ||
          !lease || lease.status !== "active" || !lease.expiresAt || lease.expiresAt <= new Date()) {
        throw new Error("scheduler_software_host_current_run_lease_required");
      }
      await infrastructure.assertInstalledProfileCurrent();
      for (const [previousRunId, previous] of priorAdmissions) {
        if (previousRunId === runId || previous.closed) continue;
        const prior = await previous.promise;
        // This observes real terminal/lease/Stop/FD owners. It does not mark a
        // Run stopped or release an unfinished lease to admit a successor.
        await prior.assertSerialSuccessorReady(previous.leaseId);
        await prior.close();
        previous.closed = true;
      }
      const context = run?.contextSnapshot && typeof run.contextSnapshot === "object"
        ? run.contextSnapshot as Record<string, unknown> : {};
      const conversationGeneration = typeof context.conversationSessionGeneration === "number"
        ? context.conversationSessionGeneration : null;
      const chatWorkspace = !input.nativeOpenCodeConformance && run?.nativeIssueId
        ? await findNativeChatWorkspaceScope(input.db, { adapterType: "paperclip_runner", environmentDriver: "sandbox",
            companyId: input.companyId, agentId: input.agentId, issueId: run.nativeIssueId, runId,
            responsibleUserId: run.responsibleUserId, conversationSessionGeneration: conversationGeneration })
        : null;
      const host = preparedHostsByRun.get(runId) ?? prequalifiedConformanceHost ?? await configureManagedSandboxRun({ ...input,
        ...(input.nativeOpenCodeConformance ? { nativeOpenCodeConformance: true as const }
          : chatWorkspace ? {} : { ordinaryWorker: true as const, ordinaryWorkerRunId: runId }),
        root: join(input.root, "scheduler-hosts", runId, leaseId) }, infrastructure, true);
      prequalifiedConformanceHost = null;
      preparedHostsByRun.delete(runId);
      hostAdmissionByRun.get(runId)!.host = host;
      return host;
    });
    // A failed transition is retained as a rejected admission. Never retry
    // setup/qualification invisibly after partial effects on the same key.
    transition = entry.promise.then(() => undefined, () => undefined);
    return await entry.promise;
  };
  const prepareNativeOpenCodeConformanceRun = async (actor: AuthorizationActor, bootstrap: {
    companyId: string; runId: string; taskId: string; planId: string; groupId: string; manifestId: string;
    manifestHash: string; leaseId: string; workspaceRoot: string; creationReceipt: string;
  }) => {
    if (!input.nativeOpenCodeConformance || bootstrap.companyId !== input.companyId ||
        input.preparedRegistration?.sandboxQualificationOperator?.userId === actor.userId)
      throw new Error("conformance_software_host_prepare_owner_scope_changed");
    let host = preparedHostsByRun.get(bootstrap.runId) ?? prequalifiedConformanceHost;
    if (!host) host = await configureManagedSandboxRun({ ...input,
      nativeOpenCodeConformance: true as const,
      root: join(input.root, "scheduler-hosts", bootstrap.runId, bootstrap.leaseId) }, infrastructure, true);
    const prepared = await host.prepareNativeOpenCodeConformanceRun(actor, bootstrap);
    // Failed or mutated bootstrap attempts retain the same prequalified Host
    // owner, so the fixture does not create setup effects before production
    // admission rejects their scope.
    if (prequalifiedConformanceHost === host) prequalifiedConformanceHost = null;
    preparedHostsByRun.set(bootstrap.runId, host);
    return prepared;
  };
  const currentAdmission = async (runId: string, leaseId: string) => {
    const entry = hostAdmissionByRun.get(runId);
    if (!entry || entry.closed || entry.leaseId !== leaseId)
      throw new Error("scheduler_software_host_exact_admission_required");
    return await entry.promise;
  };
  const executeSandboxTask: NonNullable<Parameters<typeof environmentRuntimeService>[1]>["executeSandboxTask"] = async command => {
    if (command.companyId !== input.companyId || !command.runId)
      throw new Error("scheduler_software_host_command_owner_changed");
    return await (await exactAdmission(command.runId, command.leaseId)).executeManagedSandboxTask(command);
  };
  const stopSandboxRunLease: NonNullable<Parameters<typeof environmentRuntimeService>[1]>["stopSandboxRunLease"] = async scope => {
    if (scope.companyId !== input.companyId) throw new Error("scheduler_software_host_cleanup_company_changed");
    const host = await currentAdmission(scope.runId, scope.leaseId);
    const receipt = await host.stopSandboxRunLease(scope);
    await input.afterManagedSandboxStopReceipt?.({ scope, receipt });
    return receipt;
  };
  const environmentRuntime = environmentRuntimeService(input.db, { executeSandboxTask, stopSandboxRunLease });
  return {
    // Private composition seams for the two-Agent integration fixture. These
    // are the same exact-run admission callbacks used by environmentRuntime;
    // they do not add a second dispatch path or weaken the Host's checks.
    executeManagedSandboxTask: executeSandboxTask,
    stopManagedSandboxRunLease: stopSandboxRunLease,
    sandboxExec: (async command => {
      if (command.companyId !== input.companyId || !command.runId || !command.leaseId)
        throw new Error("scheduler_software_host_command_owner_changed");
      return await (await exactAdmission(command.runId, command.leaseId)).sandboxExec(command);
    }) satisfies Host["sandboxExec"],
    environmentRuntime,
    prepareNativeOpenCodeConformanceRun,
    configuredSandboxOperatorUserIds: () => [...new Set([
      ...preparedHostsByRun.values(), ...(prequalifiedConformanceHost ? [prequalifiedConformanceHost] : []),
    ].flatMap(host => host.configuredSandboxOperatorUserIds()))],
    beforeNativeExecution: (async args => {
      const leases = await input.db.select({ id: environmentLeases.id }).from(environmentLeases).where(and(
        eq(environmentLeases.companyId, input.companyId), eq(environmentLeases.heartbeatRunId, args.runId),
        eq(environmentLeases.environmentId, infrastructure.environment.id), eq(environmentLeases.status, "active")));
      if (leases.length !== 1) throw new Error("scheduler_software_host_unique_active_lease_required");
      return await (await exactAdmission(args.runId, leases[0]!.id)).beforeNativeExecution(args);
    }) satisfies Host["beforeNativeExecution"],
    modelRequest: async (_body: unknown, _signal?: AbortSignal): ReturnType<ReturnType<typeof workerModelGateway>["callManagedMessages"]> => {
      throw new Error("scheduler_software_host_incoming_model_authority_required");
    },
    modelRequestAuthenticated: async (body: unknown, signal: AbortSignal, authorization: string | undefined) => {
      const { host } = serialModelAdmission(authorization, { ...input,
        ...(input.nativeOpenCodeConformance ? { providerConformance: true as const } : {}) }, hostAdmissionByRun);
      return await host.modelRequestAuthenticated(body, signal, authorization);
    },
    attestModelProxyClient: async (client: Socket) => {
      const observed = [];
      for (const entry of hostAdmissionByRun.values()) {
        if (entry.closed || !entry.host) continue;
        const binding = await entry.host.attestModelProxyClient(client);
        if (binding) { if (entry.closed) binding.close(); else observed.push(binding); }
      }
      if (observed.length !== 1) { for (const binding of observed) binding.close(); return null; }
      return observed[0]!;
    },
    factsForRun: (runId: string) => {
      const entry = hostAdmissionByRun.get(runId);
      if (!entry?.host) throw new Error("scheduler_software_host_run_not_observed");
      return { ...entry.host.facts(), serialContextRetired: entry.closed };
    },
    closeManagedAgentHostForRun: async (runId: string) => {
      const entry = hostAdmissionByRun.get(runId);
      if (!entry || !entry.host) throw new Error("scheduler_software_host_run_not_observed");
      if (entry.closed) return;
      const host = await entry.promise;
      await host.assertSerialSuccessorReady(entry.leaseId);
      await host.close();
      entry.closed = true;
    },
    facts: () => ({ mode: "controlled_signed_host_relay_serial", hostId: infrastructure.host.id, cellId: infrastructure.cell.id,
      environmentId: infrastructure.environment.id, runs: [...hostAdmissionByRun].map(([runId, entry]) =>
        ({ runId, leaseId: entry.leaseId, retired: entry.closed })) }),
    close: async () => {
      closing = true;
      await transition;
      await finishManagedFixtureInfrastructure(infrastructure, async () => {
        for (const entry of hostAdmissionByRun.values()) {
          if (entry.closed || !entry.host) continue;
          await entry.host.close(); entry.closed = true;
        }
      }, async () => {
        if (hostAdmissionByRun.size === 0) throw new Error("serial_image_no_run_closure");
        for (const entry of hostAdmissionByRun.values()) {
          if (!entry.host) throw new Error("serial_image_prepare_closure_unknown");
          await entry.host.assertSerialSuccessorReady(entry.leaseId);
        }
      });
    },
  };
}

async function configureManagedSandboxRun(input: ManagedSandboxHostInput,
  infrastructure: Awaited<ReturnType<typeof installManagedSandboxInfrastructure>>, serialTransport = false) {
  const { db, actor, companyId, agentId, providerBindingId } = input;
  const policyFixture = () => {
    const policy = defaultPolicyFixture();
    if (input.wallClockSeconds !== undefined) {
      if (!Number.isSafeInteger(input.wallClockSeconds) || input.wallClockSeconds < 1 ||
          input.wallClockSeconds > policy.resources.wallClockSeconds)
        throw new Error("fixture_original_wall_clock_boundary_invalid");
      policy.resources.wallClockSeconds = input.wallClockSeconds;
    }
    return policy;
  };
  const brokerOrigin = new URL(input.brokerOrigin).origin;
  const nativeConformanceMode = input.nativeOpenCodeConformance === true;
  const ordinaryWorkerMode = input.ordinaryWorker === true || input.ordinaryWorkerRunId !== undefined;
  let sealedExecutionInputHash: string | null = null;
  const assertOrdinaryWorker = async (runId: string) => {
    const run = await assertFixtureOrdinaryWorker(input, runId);
    return run;
  };
  if (input.ordinaryWorkerRunId) await assertOrdinaryWorker(input.ordinaryWorkerRunId);
  const workspaceBoundaryRoot = ordinaryWorkerMode ? resolveDefaultAgentWorkspaceDir(agentId)
    : join(await realpath(resolvePaperclipInstanceRoot()), "chat-workspaces", companyId, agentId);
  const runtime = runtimeControlService(db, { runtime: { suspectSeconds: 90, unreachableSeconds: 600, relayPort: 3102 } } as SaasPlatformConfig,
    undefined, { credentialBrokerOrigin: brokerOrigin, workerModels: input.gateway as any });
  const purposesByCommandDigest = new Map<string, Array<string | null>>();
  const purposeByRequestId = new Map<string, string | null>();
  const relayCommandOwnerByRequestId = new Map<string, string>();
  const sandboxRelayRequestByError = new WeakMap<object, {
    requestId: string; requestDigest: string; harnessCommandDigest: string; purpose: string | null; sequence: number;
    schemaIssues?: Array<{ code: string; path: Array<string | number>; maximum?: number; minimum?: number;
      origin?: string; reasonCode?: string }>;
  }>();
  const sandboxRelaySchemaPathFields = new Set([
    "requestId", "bindingId", "hostEpoch", "runId", "attemptId", "attempt", "manifestId", "manifestHash",
    "policySnapshotId", "policyHash", "commandDigest", "deadlineAt", "sandboxRef", "imageDigest", "argv", "cwd",
    "env", "brokerCredential", "modelBrokerCredential", "modelBrokerSession", "stdinBase64", "capabilityToken",
    "profileId", "profileHash", "expiresAt", "inputTokensUpperBound", "maxOutputTokens", "phase", "sessionKey",
    "nativeSessionIdDigest", "runnerInstanceId", "leaseId", "sessionDeadlineAt", "expectedCapabilityHash",
  ]);
  const sandboxRelaySchemaReasonCodes = new Set([
    "exec_request_too_large", "exec_workdir_must_be_absolute", "raw_managed_credentials_are_not_supported",
    "managed_model_bounds_do_not_match_typed_credential", "managed_model_bounds_require_typed_credential",
    "managed_model_session_start_must_not_have_old_hash", "managed_model_session_transition_requires_old_hash",
    "managed_model_session_requires_typed_credential",
  ]);
  const safeSandboxRelaySchemaIssues = (error: unknown) => {
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
      const issues = "issues" in current ? current.issues : undefined;
      if (Array.isArray(issues)) return issues.slice(0, 16).map(issue => {
        if (!issue || typeof issue !== "object") return { code: "unknown", path: [] as Array<string | number> };
        const raw = issue as { code?: unknown; path?: unknown; maximum?: unknown; minimum?: unknown; origin?: unknown; message?: unknown };
        const rawPath = Array.isArray(raw.path) ? raw.path : [];
        const path = rawPath.slice(0, 16).map((segment): string | number =>
          typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0 ? segment :
            typeof segment === "string" && sandboxRelaySchemaPathFields.has(segment) ? segment : "[key]");
        const fact: { code: string; path: Array<string | number>; maximum?: number; minimum?: number;
          origin?: string; reasonCode?: string } = {
          code: typeof raw.code === "string" && /^[a-z_]{1,40}$/.test(raw.code) ? raw.code : "unknown",
          path,
        };
        if (typeof raw.maximum === "number" && Number.isFinite(raw.maximum)) fact.maximum = raw.maximum;
        if (typeof raw.minimum === "number" && Number.isFinite(raw.minimum)) fact.minimum = raw.minimum;
        if (typeof raw.origin === "string" && ["string", "number", "array", "object", "record", "custom"].includes(raw.origin))
          fact.origin = raw.origin;
        if (path.length === 0 && raw.code === "custom")
          fact.reasonCode = typeof raw.message === "string" && sandboxRelaySchemaReasonCodes.has(raw.message)
            ? raw.message : "custom_unspecified";
        return fact;
      });
      current = "cause" in current ? current.cause : null;
    }
    return undefined;
  };
  let sandboxRelayRequestSequence = 0;
  const relayRequestFactsForError = (error: unknown) => {
    let candidate: unknown = error;
    for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth++) {
      const facts = sandboxRelayRequestByError.get(candidate);
      if (facts) return facts;
      candidate = "cause" in candidate ? candidate.cause : null;
    }
    return undefined;
  };
  const commandDigest = (command: string, args: readonly string[]) => nativeSha256({ command, args });
  let nativeSessionStartCredentialNegativeControls: { missingTokenDenied: boolean; mismatchedTokenDenied: boolean } | null = null;
  const executeOpenShell = runtime.relay.executeOpenShell.bind(runtime.relay);
  runtime.relay.executeOpenShell = async relayInput => {
    const request = relayInput.request;
    const harnessCommandDigest = commandDigest(request.argv[0]!, request.argv.slice(1));
    const purposeQueue = purposesByCommandDigest.get(harnessCommandDigest);
    const purpose = purposeQueue?.shift() ?? null;
    const requestFacts = { requestId: request.requestId, requestDigest: request.commandDigest,
      harnessCommandDigest, purpose, sequence: ++sandboxRelayRequestSequence };
    purposeByRequestId.set(request.requestId, purpose);
    const credential = request.modelBrokerCredential;
    if (!nativeSessionStartCredentialNegativeControls && request.argv[0] === "sh" &&
      request.argv[3] === "paperclip-runner-launch" && credential) {
      const expectDenied = async (tampered: typeof relayInput.request) => {
        try { await executeOpenShell({ ...relayInput, request: tampered }); return false; }
        catch { return true; }
      };
      const missingTokenDenied = await expectDenied({ ...request, modelBrokerCredential: undefined });
      const mismatchedTokenDenied = await expectDenied({ ...request,
        modelBrokerCredential: { ...credential, capabilityToken: "invalid-model-capability" } });
      nativeSessionStartCredentialNegativeControls = { missingTokenDenied, mismatchedTokenDenied };
    }
    try {
      return await executeOpenShell(relayInput);
    } catch (error) {
      if (error && typeof error === "object") {
        const schemaIssues = safeSandboxRelaySchemaIssues(error);
        if (schemaIssues?.length)
          console.info("sandbox_relay_schema_issue_facts", JSON.stringify(schemaIssues));
        sandboxRelayRequestByError.set(error, { ...requestFacts, ...(schemaIssues ? { schemaIssues } : {}) });
      }
      throw error;
    } finally {
      purposeByRequestId.delete(request.requestId);
    }
  };
  const { hostKeys, host, cell, environment, conversationHostCapacity, payerUserId, fixtureImageNode, sandboxQualificationOperator,
    runtimeConnection, runtimePresence, createCanary, providerImageHome, fixtureToolAccess, runtimeSecretValue } = infrastructure;
  const baseQualificationActor = nativeConformanceMode ? sandboxQualificationOperator : actor;
  if (!baseQualificationActor?.userId) throw new Error("conversation_software_host_base_qualification_operator_missing");
  // Every closure receives a fresh setup-only canary, never a revoked prior grant.
  // Qualification-only canary and the stable runtime connection have separate
  // grants. Requalification creates a new canary without changing Agent tools.
  const { canary, canarySecretValue } = await createCanary();
  const [gatewayProfile]=await db.insert(toolProfiles).values({companyId,profileKey:`conversation-gateway-${randomUUID()}`,
    name:`Conversation qualification gateway ${randomUUID()}`,defaultAction:"deny"}).returning();assert.ok(gatewayProfile);
  await db.insert(toolProfileEntries).values([canary,runtimeConnection].map(item=>({companyId,profileId:gatewayProfile.id,
    selectorType:"connection" as const,effect:"include" as const,connectionId:item.connection.id})));
  let qualificationCredentialFixture: NonNullable<SandboxCapabilitySnapshot["qualificationCredentialFixture"]>;
  const qualificationToolResponses:Array<{caseId:string;status:number;reasonCode:string|null;marker:string|null;replayDenied?:boolean}>=[];
  const hostCapabilityObservations:Array<Record<string,unknown>>=[];
  const hostLifecycleObservations:Array<Record<string,unknown>>=[];
  const softwareOnlyPolicyProofObservations:Array<Record<string,unknown>>=[];
  const softwareOnlyPolicyProofSidecarHashes = new Map<string, string>();
  const gatewayOptions:Parameters<typeof createToolGatewayService>[1]={operatorUserIds:[baseQualificationActor.userId],qualificationBrokerOrigin:brokerOrigin,toolActionSigningSecret:"conversation-software-canary",
    remoteHttpRequest:async(url,init)=>{
      if (url !== `${brokerOrigin}/mcp/qualification/credential-echo` && input.assignedToolGatewayHttpRequest)
        return input.assignedToolGatewayHttpRequest(url, init);
      assert.equal(url,`${brokerOrigin}/mcp/qualification/credential-echo`);
      const authorization=new Headers(init.headers).get("authorization");assert.ok(authorization === `Bearer ${canarySecretValue}`,"Qualification provider credential did not match its separate canary grant");
      assert.equal(init.method,"POST");assert.equal(init.redirect,"manual");
      const http=request(qualificationProtocolApp).post("/mcp/qualification/credential-echo");
      new Headers(init.headers).forEach((value,key)=>http.set(key,value));
      const response=await http.send(JSON.parse(String(init.body)));
      assert.ok(!JSON.stringify(response.body).includes(canarySecretValue),"Qualification echo reflected its credential");
      return new Response(JSON.stringify(response.body),{status:response.status,headers:{"content-type":"application/json"}});
    }};
  const qualificationGateway=createToolGatewayService(db,gatewayOptions);
  input.observeAssignedToolGateway?.(qualificationGateway, "host_root");
  registerAssignedMcpGateway(db,qualificationGateway,scopedDb => {
    const scopedGateway=createToolGatewayService(scopedDb,gatewayOptions);
    input.observeAssignedToolGateway?.(scopedGateway, "scoped");
    return scopedGateway;
  });
  qualificationGateway.setSandboxBrokerAuthority(runtime.authorizeSandboxBrokerCapability, brokerOrigin);
  const namedGateway=await qualificationGateway.createNamedGateway({companyId,body:{name:`Conversation qualification and runtime gateway ${randomUUID()}`,profileId:gatewayProfile.id}});
  const qualificationProviderProfile={id:"paperclip-qualification",
    credentials:[{name:"qualification_token",auth_style:"bearer",header_name:"Authorization",env_vars:["PAPERCLIP_SANDBOX_QUALIFICATION_TOKEN"]}],
    endpoints:[{host:new URL(brokerOrigin).hostname,port:Number(new URL(brokerOrigin).port || 443),protocol:"rest",enforcement:"enforce",
      rules:[{allow:{method:"POST",path:`/mcp/gateways/${namedGateway.gatewayPublicId}`}}]}],
    binaries:[{path:"/usr/bin/curl"}]};
  const credentialFixtureBase={version:1 as const,fixtureId:`conversation-canary-${randomUUID()}`,profileId:"paperclip-qualification",profileHash:nativeSha256(qualificationProviderProfile),
    binaries:["/usr/bin/curl"] as ["/usr/bin/curl"],wrongBinaryPath:"/usr/bin/wget" as const,origin:brokerOrigin,port:Number(new URL(brokerOrigin).port || 443),method:"POST" as const,
    gatewayPublicId:namedGateway.gatewayPublicId,toolName:canary.toolName,wrongToolName:"wrong_scope_canary",
    argumentTemplateHash:nativeSha256({caseId:"<caseId>",fixtureId:"<fixtureId>",nonce:"<nonce>"}),marker:"paperclip-qualification-credential-ok-v1"};
  qualificationCredentialFixture={...credentialFixtureBase,fixtureHash:nativeSha256(credentialFixtureBase)};
  const {fixtureHash:_goldenHash,...goldenBody}=goldenQualificationProbeFixture;
  const qualificationBody={...goldenBody,credential:qualificationCredentialFixture};
  const qualificationProbeFixture={...qualificationBody,fixtureHash:nativeSha256(qualificationBody)};
  await fixtureToolAccess.updateConnection(canary.connection.id,{config:{...(canary.connection.config as Record<string,unknown>),sandboxQualificationCanary:{
    argumentTemplateHash:qualificationCredentialFixture.argumentTemplateHash,endpointOrigin:brokerOrigin,endpointPath:"/mcp/qualification/credential-echo",
    fixtureHash:qualificationCredentialFixture.fixtureHash,fixtureId:qualificationCredentialFixture.fixtureId,gatewayPublicId:namedGateway.gatewayPublicId,
    grantId:canary.grant.id,kind:"platform_owned_qualification_echo",marker:qualificationCredentialFixture.marker,noSideEffects:true,
    purpose:"sandbox_qualification",readOnly:true,setupOnly:true,toolName:canary.toolName,version:1,wrongToolName:qualificationCredentialFixture.wrongToolName,
  }}});
  const qualificationProtocolApp=express();qualificationProtocolApp.use(express.json());
  qualificationProtocolApp.use(mcpGatewayProtocolRoutes(qualificationGateway));qualificationProtocolApp.use(errorHandler);
  const runtimeBrokerBinding={connectionId:runtimeConnection.connection.id,grantVersionHash:"",hostname:"provider.example.test",port:443,
    methods:["POST"] as ["POST"],pathPrefixes:["/mcp"],binary:"/usr/bin/curl",ttlSeconds:120};

  let protectedQualificationTarget: Record<string, any> | null = null;
  let activeHostIdentity: { sandboxId: string; containerId: string } | null = null;
  let activeHostTarget: SandboxCapabilitySnapshot["qualificationTarget"] | null = null;
  const projectedQualification=projectOpenShellQualificationProbePolicy(qualificationProbeFixture);
  assert.deepEqual(projectedQualification.unsupportedFeatures,[]);assert.ok(projectedQualification.document);
  const qualificationDocument=projectedQualification.document;
  const softwareProbeObservations:Array<{caseId:string;passed:boolean;observationHash:string}>=[];
  const filesystemAllowed=(value:string)=>{
    const normalized=posix.normalize(value);
    return [...qualificationDocument.filesystem_policy.read_only,...qualificationDocument.filesystem_policy.read_write]
      .some(root=>normalized === root || normalized.startsWith(`${root.replace(/\/$/,"")}/`));
  };
  const policyCanary=express();
  policyCanary.use((req,res)=>{
    const target=new URL(String(req.headers["x-fixture-url"])),binary=String(req.headers["x-fixture-binary"]);
    const resolved=String(req.headers["x-fixture-resolve"] ?? "203.0.113.7");
    const endpoints=Object.values(qualificationDocument.network_policies).filter(policy=>policy.binaries.some(item=>item.path === binary))
      .flatMap(policy=>policy.endpoints);
    const allowed=resolved === "203.0.113.7" && endpoints.some(endpoint=>endpoint.host === target.hostname && endpoint.port === Number(target.port || 443) &&
      endpoint.rules.some(rule=>rule.allow.method === req.method && new RegExp(`^${rule.allow.path.replace(/[.+^${}()|[\]\\]/g,"\\$&").replace(/\?/g,".")}$`).test(target.pathname)));
    if (!allowed || target.pathname.startsWith("/redirect/")) {res.status(403).json({denied:true});return;}
    res.json({marker:qualificationProbeFixture.network.allow.marker});
  });
  const requestPolicyCanary=async(template:string,method:string,resolve?:string)=>{
    const target=template.replace("{nonce}",randomBytes(16).toString("hex"));
    const call=request(policyCanary)[method.toLowerCase() as "get"|"post"]("/")
      .set("x-fixture-url",target).set("x-fixture-binary","/usr/bin/curl");
    if(resolve)call.set("x-fixture-resolve",resolve);
    const response=await call;
    return {status:response.status,marker:response.body?.marker ?? null};
  };
  const observeSoftwareBoundary=async(test:SandboxProbeCase)=>{
    const fixture=qualificationProbeFixture;
    let passed=false,observation:Record<string,unknown>;
    switch(test.caseId){
      case "filesystem_allow":case "filesystem_deny":case "filesystem_escape":{
        const operand=test.caseId === "filesystem_allow" ? fixture.filesystem.allowedReadPath : test.caseId === "filesystem_deny"
          ? fixture.filesystem.deniedReadPath : fixture.filesystem.escapeOperand;
        const allowed=filesystemAllowed(operand);passed=allowed === (test.expected === "allow");
        observation={operand,normalized:posix.normalize(operand),allowed};break;
      }
      case "process_nonprivileged":case "process_privilege_denied":{
        const effectiveUid=qualificationDocument.process.run_as_user,effectiveGid=qualificationDocument.process.run_as_group;
        const privilegedRequestAllowed=effectiveUid === "0" || effectiveGid === "0";
        passed=!privilegedRequestAllowed && effectiveUid === fixture.runAsUser && effectiveGid === fixture.runAsGroup;
        observation={effectiveUid,effectiveGid,privilegedRequestAllowed};break;
      }
      case "syscall_allow":case "syscall_deny":{
        // Controlled software kernel decision: unprivileged read/write are
        // available; privileged namespace/mount requests are refused. This
        // fixture is not evidence of a physical OpenShell kernel boundary.
        const syscall=test.caseId === "syscall_allow" ? "read" : "mount";
        const allowed=["read","write"].includes(syscall) && qualificationDocument.process.run_as_user !== "0";
        passed=allowed === (test.expected === "allow");observation={syscall,allowed,uid:qualificationDocument.process.run_as_user};break;
      }
      case "network_allow":case "network_l7_allow":case "network_l7_deny":{
        const route=test.caseId === "network_allow" ? fixture.network.allow : test.caseId === "network_l7_allow" ? fixture.network.l7Allow : fixture.network.l7Deny;
        const response=await requestPolicyCanary(route.urlTemplate,route.method);
        passed=test.expected === "allow" ? response.status === 200 && response.marker === route.marker : response.status === 403 && response.marker === null;
        observation={...response,method:route.method};break;
      }
      case "network_host_port_deny":{
        const responses=await Promise.all([fixture.network.hostPortDeny,fixture.network.wrongHostDeny,fixture.network.redirectDeny]
          .map(route=>requestPolicyCanary(route.urlTemplate,route.method)));
        passed=responses.every(response=>response.status === 403 && response.marker === null);observation={responses};break;
      }
      case "network_dns_redirect_deny":{
        const route=fixture.network.dnsRedirectDeny,response=await requestPolicyCanary(route.urlTemplate,route.method,route.resolveIp);
        passed=response.status === 403 && response.marker === null;observation={...response,resolveIp:route.resolveIp};break;
      }
      case "resource_exhaustion_contained":{
        const limits=protectedQualificationTarget?.resourceLimits;
        passed=Boolean(limits && limits.cpuMillis > 0 && limits.cpuMillis <= conversationHostCapacity.cpuMillis &&
          limits.memoryBytes > 0 && limits.memoryBytes <= Number(conversationHostCapacity.memoryBytes) &&
          limits.diskBytes > 0 && limits.diskBytes <= Number(conversationHostCapacity.diskBytes) && limits.pidsLimit > 0 && limits.pidsLimit <= conversationHostCapacity.pidsLimit);
        observation={limits,cellReservation: {cpuMillis:conversationHostCapacity.cpuMillis,memoryBytes:Number(conversationHostCapacity.memoryBytes),
          diskBytes:Number(conversationHostCapacity.diskBytes),pidsLimit:conversationHostCapacity.pidsLimit}};break;
      }
      case "force_stop":{
        const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
        await once(child,"spawn");const closed=once(child,"close");child.kill("SIGTERM");
        const [code,signal]=await closed;passed=signal === "SIGTERM" && code === null;observation={code,signal};break;
      }
      default:throw new Error(`conversation_software_probe_unsupported:${test.caseId}`);
    }
    const observationHash=nativeSha256({kind:"controlled_software_boundary",caseId:test.caseId,documentHash:projectedQualification.documentHash,observation});
    softwareProbeObservations.push({caseId:test.caseId,passed,observationHash});
    return {action:"probe",verdict:passed ? "pass" : "fail",observationHash,contractHash:test.contractHash,targetQualificationHash:protectedQualificationTarget?.targetHash};
  };

  const identity: SandboxIdentity = { companyId, bindingId: randomUUID(), cellId: cell.id,
    cellGeneration: cell.generation.toString(), sandboxRef: `aw-v7-${cell.id}` };
  const transport = nativeSandboxHostTransport(db, { operatorUserIds: [baseQualificationActor.userId] });
  const capabilities = (): SandboxCapabilitySnapshot => lastHostCapabilities ?? {
    filesystemPolicy: false, processPrivilegePolicy: false, syscallPolicy: false,
    networkDestinationPolicy: false, networkLayer7Policy: false, credentialBrokering: false,
    resourceLimits: false, forceStop: false,
    backend: "openshell", backendVersion: "0.1.2", hostKernelVersion: null,
    sandboxImageDigest: imageDigest, filesystemEnforcementMode: "unknown", staticPolicyRequiresRecreate: true,
    dynamicNetworkPolicy: false, policyProverBoundaryCheck: false, policyProverCoverage: [],
    credentialBindingDimensions: [], testedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    qualificationHash: qualificationProbeFixture.fixtureHash, evidenceKind: "protected_host_report",
    qualificationProbeFixture,
    ...(activeHostTarget ? { qualificationTarget: activeHostTarget } : {}),
  };
  const resolveCurrentCredentialBrokerBindings = async (policy: import("@paperclipai/shared").SandboxPolicyCompilation) => {
    const runId = expectedRunId;
    if (!runId) throw new Error("conversation_software_host_run_unavailable");
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
      eq(heartbeatRuns.id, runId), eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.status, "running"))).limit(1);
    const manifestRef = policy.sourcePolicyRefs.find(ref => ref.startsWith("manifest:"));
    const manifestMatch = manifestRef ? /^manifest:([0-9a-f-]{36}):([a-f0-9]{64})$/i.exec(manifestRef) : null;
    const [manifest] = manifestMatch ? await db.select().from(agentExecutionManifests).where(and(
      eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.id, manifestMatch[1]!),
      eq(agentExecutionManifests.runId, runId), eq(agentExecutionManifests.hash, manifestMatch[2]!))).limit(1) : [];
    const [presence] = await db.select({ id: agentPresenceRuntimeBindings.id }).from(agentPresenceRuntimeBindings).where(and(
      eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, agentId),
      eq(agentPresenceRuntimeBindings.status, "active"))).limit(1);
    if (!run?.responsibleUserId || !manifest || !presence || manifest.agentId !== agentId)
      throw new Error("conversation_software_host_broker_binding_unavailable");
    return qualificationGateway.resolveSandboxCredentialBrokerPolicyBindings({ companyId, agentId, runId,
      responsibleUserId: run.responsibleUserId, presenceId: presence.id,
      bindings: policy.compiledPolicy.credentials.bindings });
  };
  const sandboxOperatorUserIds = [baseQualificationActor.userId];
  const service = executionSandboxService(db, { operatorUserIds: sandboxOperatorUserIds, credentialBrokerOrigin: brokerOrigin,
    assertRuntimeStartAdmission: (tx, start) => runtime.assertSandboxStartAdmission(tx, start),
    recordRuntimeWorkloadState: (tx, stateChange) => runtime.recordSandboxWorkloadState(tx, stateChange),
    backendFor: (currentBinding, currentActor, conformance) => {
      const executable = process.env.AW_V7_OPENSHELL_PROVER ??
        "/workspace/v10-preparation/tools/openshell-prover-v0.1.2/openshell-prover";
      const executableSha256 = "3e80c0d041a7552d57cc338868bc825a6261e21b5f29a7d7527bcc7926d423f1";
      if (createHashHex(readFileSync(executable)) !== executableSha256)
        throw new Error("conversation_software_host_prover_pin_mismatch");
      const bridge = transport.bridge(currentActor, conformance);
      const backend = openShellBackend({
        identity: { companyId: currentBinding.companyId, bindingId: currentBinding.id,
          cellId: currentBinding.runtimeCellId, cellGeneration: currentBinding.cellGeneration,
          sandboxRef: currentBinding.sandboxRef ?? `aw-v7-${currentBinding.id}` },
        boundary: currentBinding.boundaryPolicy,
        ...(conformance ? { conformance } : {}),
        bridge, evidenceKind: "protected_host_report",
        prover: { executable, executableSha256 },
        credentialBrokerDatabase: db, credentialBrokerOrigin: brokerOrigin,
        resolveCredentialBrokerBindings: resolveCurrentCredentialBrokerBindings,
      });
      const applyPolicy = backend.applyPolicy;
      const startWorkload = backend.startWorkload;
      return { ...backend,
        startWorkload: async (startInput: Parameters<typeof startWorkload>[0]) => {
          const started = await startWorkload(startInput);
          if (conformance && input.afterSandboxStartReceipt) {
            const startParts = startInput.idempotencyKey.split(":");
            const claimVersion = Number(startParts[3]);
            if (startParts.length !== 5 || startParts[0] !== "v7-sandbox-start" || startParts[1] !== currentBinding.id ||
                startParts[2] !== currentBinding.cellGeneration || !Number.isSafeInteger(claimVersion) || claimVersion < 1 ||
                startParts[4] !== conformance.policySnapshotId)
              throw new Error("conversation_host_admission_start_claim_key_invalid");
            const [claim] = await db.select().from(activityLog).where(and(
              eq(activityLog.companyId, currentBinding.companyId), eq(activityLog.entityType, "runtime_sandbox"),
              eq(activityLog.entityId, currentBinding.id), eq(activityLog.action, "sandbox.admission_claimed"),
              sql`${activityLog.details}->>'claimVersion' = ${String(claimVersion)}`,
              sql`${activityLog.details}->>'generation' = ${currentBinding.cellGeneration}`,
              sql`${activityLog.details}->>'policySnapshotId' = ${conformance.policySnapshotId}`,
              sql`${activityLog.details}->>'policyHash' = ${conformance.policyHash}`,
              sql`${activityLog.details}->>'executionManifestId' = ${conformance.manifestId}`,
              sql`${activityLog.details}->>'executionManifestHash' = ${conformance.manifestHash}`,
            )).limit(1);
            const claimDetails = claim?.details && typeof claim.details === "object" && !Array.isArray(claim.details)
              ? claim.details as Record<string, unknown> : {};
            const claimKey = typeof claimDetails.claimKey === "string" ? claimDetails.claimKey : "";
            const expectedClaimKey = `v7-sandbox-admission:${currentBinding.id}:${currentBinding.cellGeneration}:${currentBinding.version}:${conformance.policySnapshotId}`;
            if (!claim || claim.actorType !== "user" || claim.actorId !== currentActor.userId ||
                claimDetails.claimVersion !== claimVersion || claimDetails.generation !== currentBinding.cellGeneration ||
                claimDetails.expectedVersion !== currentBinding.version || claimKey !== expectedClaimKey ||
                claimDetails.policySnapshotId !== conformance.policySnapshotId || claimDetails.policyHash !== conformance.policyHash ||
                claimDetails.executionManifestId !== conformance.manifestId || claimDetails.executionManifestHash !== conformance.manifestHash)
              throw new Error("conversation_host_admission_claim_receipt_mismatch");
            const [prepared] = await db.select().from(runtimeHostCommands).where(and(
              eq(runtimeHostCommands.companyId, currentBinding.companyId),
              eq(runtimeHostCommands.runtimeHostId, host.id),
              eq(runtimeHostCommands.runtimeCellId, currentBinding.runtimeCellId),
              eq(runtimeHostCommands.cellGeneration, BigInt(currentBinding.cellGeneration)),
              eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"),
              sql`${runtimeHostCommands.payload}->'provisioning'->>'purpose' = 'admission'`,
              sql`${runtimeHostCommands.payload}->'provisioning'->>'operationKey' = ${claimKey}`,
              sql`${runtimeHostCommands.payload}->'provisioning'->>'policyHash' = ${conformance.policyHash}`,
              sql`${runtimeHostCommands.payload}->'provisioning'->>'bindingVersion' = ${String(claimVersion)}`,
            )).limit(1);
            const prepareRequest = prepared?.payload as Record<string, any> | undefined;
            const prepareReply = prepared?.safeResult as Record<string, any> | undefined;
            const provisioning = prepareRequest?.provisioning as Record<string, any> | undefined;
            if (!prepared || !prepareRequest || !prepareReply || !provisioning || prepareRequest.action !== "prepare" ||
              prepareReply.action !== "prepare" || provisioning.policyHash !== conformance.policyHash ||
              provisioning.operationKey !== claimKey || provisioning.bindingVersion !== claimVersion || !prepareReply.sandboxId || !prepareReply.containerId ||
              prepareReply.hostEpoch !== prepareRequest.hostEpoch || prepareReply.imageDigest !== prepareRequest.imageDigest)
              throw new Error("conversation_host_admission_start_receipt_owner_missing");
            const cleanup: SandboxAdmissionCleanup = { requesterUserId: currentActor.userId!,
              claimKey: provisioning.operationKey, claimVersion: provisioning.bindingVersion,
              policySnapshotId: conformance.policySnapshotId, policyHash: conformance.policyHash,
              manifestId: conformance.manifestId, manifestHash: conformance.manifestHash,
              hostEpoch: prepareRequest.hostEpoch, imageDigest: prepareRequest.imageDigest,
              sandboxId: prepareReply.sandboxId, containerId: prepareReply.containerId };
            const scope: SandboxIdentity = { companyId: currentBinding.companyId, bindingId: currentBinding.id,
              cellId: currentBinding.runtimeCellId, cellGeneration: currentBinding.cellGeneration,
              sandboxRef: currentBinding.sandboxRef ?? `aw-v7-${currentBinding.id}` };
            await input.afterSandboxStartReceipt({ scope, cleanup, attemptStop: candidate => bridge.stop({ ...scope,
              idempotencyKey: `v7-sandbox-admission-contain:${currentBinding.id}:${currentBinding.cellGeneration}:${candidate.claimVersion}:${candidate.policySnapshotId}`,
              nativeAdmissionCleanup: candidate }) });
          }
          return started;
        },
        applyPolicy: async (applyInput: Parameters<typeof applyPolicy>[0]) => {
        const result = await applyPolicy(applyInput);
        if (!result.applied && result.unsupportedFeatures.includes("boundary:unsupported")) {
          const candidateProjection = projectOpenShellPolicy(applyInput.policy.compiledPolicy,
            applyInput.policy.modelBrokerEndpoint, applyInput.policy.credentialBrokerEndpoints);
          const boundaryProjection = projectOpenShellPolicy(currentBinding.boundaryPolicy,
            applyInput.policy.modelBrokerEndpoint);
          const proof = candidateProjection.document && boundaryProjection.document
            ? await checkOpenShellBoundary({ executable, executableSha256,
              candidate: candidateProjection.document, boundary: boundaryProjection.document }) : null;
          const reason = typeof proof?.reasonCode === "string" && /^[a-z0-9_:-]{1,100}$/.test(proof.reasonCode)
            ? proof.reasonCode : null;
          const projectedPathFacts = (kind: "candidate" | "boundary", document: typeof candidateProjection.document) =>
            document ? (["read_only", "read_write"] as const).flatMap(mode => document.filesystem_policy[mode]
              .map((path, index) => {
                try {
                  const link = lstatSync(path), target = statSync(path);
                  return { kind, mode, index, absolute: path.startsWith("/"), exists: true,
                    directory: target.isDirectory(), symlink: link.isSymbolicLink() };
                } catch (error) {
                  const code = typeof error === "object" && error !== null && "code" in error &&
                    typeof error.code === "string" && /^[A-Z0-9_]{1,24}$/.test(error.code) ? error.code : "OTHER";
                  return { kind, mode, index, absolute: path.startsWith("/"), exists: false, errorCode: code };
                }
              })) : [];
          const filesystemPathFacts = [
            ...projectedPathFacts("candidate", candidateProjection.document),
            ...projectedPathFacts("boundary", boundaryProjection.document),
          ];
          const boundaryReads = new Set(boundaryProjection.document?.filesystem_policy.read_only ?? []);
          const boundaryWrites = new Set(boundaryProjection.document?.filesystem_policy.read_write ?? []);
          const uncoveredReadOnlyIndices = candidateProjection.document?.filesystem_policy.read_only
            .flatMap((path, index) => boundaryReads.has(path) || boundaryWrites.has(path) ? [] : [index]) ?? [];
          const uncoveredReadWriteIndices = candidateProjection.document?.filesystem_policy.read_write
            .flatMap((path, index) => boundaryWrites.has(path) ? [] : [index]) ?? [];
          console.info("conversation_software_host_boundary_proof", JSON.stringify({
            result: proof?.result ?? "projection_unavailable", reasonCode: reason,
            coveredDomains: proof?.coveredDomains.filter(value => /^[a-z0-9_:-]{1,100}$/.test(value)).slice(0, 16) ?? [],
            candidateHashMatches: proof?.candidateHash === candidateProjection.documentHash,
            boundaryHashMatches: proof?.boundaryHash === boundaryProjection.documentHash,
            candidateEqualsBoundary: candidateProjection.documentHash === boundaryProjection.documentHash,
            uncoveredReadOnlyIndices, uncoveredReadWriteIndices,
            filesystemPathFacts,
          }));
        }
        const safeNames = (value: unknown) => Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === "string" && /^[a-z0-9_:-]{1,80}$/.test(entry)).slice(0, 32)
          : [];
        console.info("conversation_software_host_backend_apply", JSON.stringify({
          applied: result.applied, requiresRecreate: Boolean(result.requiresRecreate),
          observedPolicyHashMatches: result.observedPolicyHash === nativeSha256(applyInput.policy),
          unsupportedFeatures: safeNames(result.unsupportedFeatures),
        }));
        return result;
      } };
    } });

  let binding: Awaited<ReturnType<typeof service.create>>;
  let setupAdmissionOwner: { bindingId: string; cellId: string; generation: string; hostId: string;
    claimKey: string; claimVersion: number; bindingVersion: number; startCommandId: string;
    policySnapshotId: string; policyHash: string;
    manifestId: string; manifestHash: string; hostEpoch: number; imageDigest: string;
    sandboxId: string; containerId: string; requesterUserId: string } | null = null;
  let sessionHostEngine: any = null;
  let sessionOverlayUpperDir: string | null = null;
  let fixtureSandboxExists = false;
  let fixtureSandboxPhase: "Ready" | "Stopped" = "Stopped";
  let fixtureSandboxContainerId: string | null = null;
  let previousHostName: string | undefined;
  let originalDockerHttpRequest: typeof http.request | null = null;
  const helperContainersByName = new Map<string, any>(), helperContainersById = new Map<string, any>();
  const httpArchiveObservations: Array<{ root: boolean; originalContainer: boolean; status: number }> = [];
  const hostCliOperations: string[] = [];
  let observedSandboxPhase: "Ready" | "Stopped" = "Stopped";
  let actualCliPolicyObservation: { bindingId: string; sandboxId: string; containerId: string;
    document: unknown; hash: string } | null = null;
  const modelBrokerSessionReceipts: Array<{ phase: string; sessionKey: string; capabilityHash: string;
    expiresAt: string; sessionDeadlineAt: string; nativeSessionIdDigest: string | null;
    startBindingDigest: string | null }> = [];
  type SafeHostExecErrorDetails = { sentinel: string; errorType: "Error" | "TypeError" | "RangeError" | "AbortError" | "Other";
    signalAborted: boolean; deadlineRemainingMs: number | null; phase: "start" | "refresh" | "stop" | null;
    monitorLabel: boolean; sourceFrames: Array<{ source: "openshell.mjs"; line: number }>;
    refreshCredentialFacts?: Record<string, boolean | number | string | null> };
  let sessionHostJournalFile: string | null = null;
  const hostExecErrorFactByRequestId = new Map<string, (details: SafeHostExecErrorDetails) => void>();
  const nativeSessionBackingObservations: Array<Record<string, boolean | number | string | null>> = [];
  type NativeRunnerClosureWitness = {
    phase: "launch_observed" | "identity_matched" | "alive_observed" | "stop_observed" | "gone_verified" | "invalid";
    launchMatched: boolean; nonceMatches: boolean; runnerMatches: boolean;
    identityMatched: boolean; runPidStartedAtMatched: boolean;
    identityVerdict: "unknown" | "alive" | "gone" | "mismatch";
    previousLiveGroupKnown: boolean; previousLiveSessionKnown: boolean; processGone: boolean;
    processGroupLive: number | null; processSessionLive: number | null;
    fdOrCwdSessionsHolders: number | null; fdOrCwdScanComplete: boolean; noSessionHandles: boolean;
    runId: string; taskRoot: string; identityPath: string;
    nonce: string; runnerId: string; sessionKey: string; sessionDigest: string; leaseId: string;
    sessionDeadlineAt: string; expectedCapabilityHash: string;
    pid: number | null; startedAt: string | null;
    processFingerprint: string | null; processGroupId: number | null; processSessionId: number | null;
    stopCheckerExit: number | null; stopReceiptMatched: boolean; startBindingDigest: string | null;
  };
  let nativeRunnerClosureWitness: NativeRunnerClosureWitness | null = null;
  const nativeRunnerLaunchIntentRunIds = new Set<string>();
  let modelProviderRequestCount = 0;
  let activeHostExecStreams = 0;
  let nextRuntimeExecuteStreamId = 0;
  const activeRuntimeExecuteStreams = new Map<number, number>();
  let nextHostOperationId = 0;
  const activeHostOperations = new Map<number, { operation: string; startedAtMs: number }>();
  const nativeSessionBackingByKey = new Map<string, { sessionKey: string; sessionDigest: string; taskRoot: string;
    runId: string; runnerInstanceId: string; leaseId: string; startBindingDigest: string;
    sandboxId: string; containerId: string; sourceSessions: string; upperSessions: string; originalTreeDigest: string;
    rootDev: number; rootIno: number; fileCount: number; byteCount: number; witnessMatched: boolean;
    runnerStateFilePresent: boolean; runnerIdentityFilePresent: boolean; processPid: number;
    processGroupId: number; processSessionId: number }>();
  const fixtureOverlayPath = (containerPath: string) => {
    if (!sessionOverlayUpperDir || !posix.isAbsolute(containerPath) || posix.normalize(containerPath) !== containerPath ||
        containerPath === "/" || containerPath.split("/").some(part => part === "." || part === ".."))
      throw new Error("conversation_native_session_overlay_path_invalid");
    return join(sessionOverlayUpperDir, containerPath.slice(1));
  };
  const assertRealDirectoryTree = (absolutePath: string) => {
    if (!posix.isAbsolute(absolutePath) || posix.normalize(absolutePath) !== absolutePath)
      throw new Error("conversation_native_session_directory_path_invalid");
    let current = "/";
    for (const part of absolutePath.split("/").filter(Boolean)) {
      current = join(current, part);
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("conversation_native_session_directory_changed");
    }
  };
  const ensureRealDirectoryTree = (absolutePath: string) => {
    if (!posix.isAbsolute(absolutePath) || posix.normalize(absolutePath) !== absolutePath)
      throw new Error("conversation_native_session_directory_path_invalid");
    let current = "/";
    for (const part of absolutePath.split("/").filter(Boolean)) {
      current = join(current, part);
      let stat;
      try { stat = lstatSync(current); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try { mkdirSync(current, { mode: 0o700 }); } catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
        }
        stat = lstatSync(current);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("conversation_native_session_directory_changed");
    }
  };
  const snapshotNativeSessionTree = (rootPath: string, deadlineMs: number) => {
    const entries: Array<{ path: string; kind: string; dev: number; ino: number; mode: number; size: number; contentHash?: string }> = [];
    let fileCount = 0, byteCount = 0;
    const visit = (absolute: string, relative: string, depth: number) => {
      if (!Number.isFinite(deadlineMs) || Date.now() >= deadlineMs || depth > 128 || entries.length >= 50_000)
        throw new Error("conversation_native_session_snapshot_limit");
      const stat = lstatSync(absolute);
      const mode = stat.mode & 0o7777;
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        entries.push({ path: relative, kind: "directory", dev: stat.dev, ino: stat.ino, mode, size: stat.size });
        for (const name of readdirSync(absolute).sort()) visit(join(absolute, name), relative ? `${relative}/${name}` : name, depth + 1);
      } else if (stat.isFile() && !stat.isSymbolicLink()) {
        const bytes = readFileSync(absolute);
        fileCount++; byteCount += bytes.byteLength;
        entries.push({ path: relative, kind: "file", dev: stat.dev, ino: stat.ino, mode, size: stat.size,
          contentHash: createHash("sha256").update(bytes).digest("hex") });
      } else if (stat.isSymbolicLink()) {
        entries.push({ path: relative, kind: "symlink", dev: stat.dev, ino: stat.ino, mode, size: stat.size,
          contentHash: createHash("sha256").update(readlinkSync(absolute)).digest("hex") });
      } else throw new Error("conversation_native_session_entry_type_unsupported");
    };
    visit(rootPath, "", 0);
    return { treeDigest: nativeSha256(entries), fileCount, byteCount, entries };
  };
  const nativeProcessGroupSession = (pid: number, deadlineMs: number) => {
    if (!Number.isSafeInteger(pid) || pid <= 0 || Date.now() >= deadlineMs) return null;
    const remaining = Math.max(1, Math.min(1000, deadlineMs - Date.now()));
    const result = spawnSync("ps", ["-o", "pgid=", "-o", "sid=", "-p", String(pid)], {
      encoding: "utf8", timeout: remaining, maxBuffer: 16 * 1024,
    });
    if (result.error || result.status !== 0 || result.signal || typeof result.stdout !== "string") return null;
    const rows = result.stdout.trim().split(/\n+/).filter(Boolean);
    if (rows.length !== 1) return null;
    const fields = rows[0]!.trim().split(/\s+/);
    if (fields.length !== 2 || fields.some(field => !/^\d+$/.test(field))) return null;
    const pgid = Number(fields[0]), sid = Number(fields[1]);
    return Number.isSafeInteger(pgid) && pgid > 0 && Number.isSafeInteger(sid) && sid > 0 ? { pgid, sid } : null;
  };
  const nativeGroupSessionLiveCounts = (pgid: number, sid: number, deadlineMs: number) => {
    if (!Number.isSafeInteger(pgid) || pgid <= 0 || !Number.isSafeInteger(sid) || sid <= 0 || Date.now() >= deadlineMs) return null;
    const remaining = Math.max(1, Math.min(1000, deadlineMs - Date.now()));
    const result = spawnSync("ps", ["-eo", "pid=,pgid=,sid=,stat="], {
      encoding: "utf8", timeout: remaining, maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0 || result.signal || typeof result.stdout !== "string") return null;
    let groupLive = 0, sessionLive = 0;
    for (const row of result.stdout.split(/\n+/)) {
      const fields = row.trim().split(/\s+/);
      if (fields.length < 4 || !/^\d+$/.test(fields[0]!) || !/^\d+$/.test(fields[1]!) || !/^\d+$/.test(fields[2]!)) continue;
      const state = fields[3]!;
      if (state.startsWith("Z")) continue;
      if (Number(fields[1]) === pgid) groupLive++;
      if (Number(fields[2]) === sid) sessionLive++;
    }
    return { groupLive, sessionLive };
  };
  const nativeProcessGone = (pid: number, deadlineMs: number) => {
    if (!Number.isSafeInteger(pid) || pid <= 0 || Date.now() >= deadlineMs) return false;
    const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8", timeout: Math.max(1, Math.min(1000, deadlineMs - Date.now())), maxBuffer: 16 * 1024,
    });
    if (result.error || result.signal || typeof result.stdout !== "string") return false;
    if (result.status === 1 && result.stdout.trim() === "") return true;
    if (result.status !== 0) return false;
    const rows = result.stdout.trim().split(/\n+/).filter(Boolean);
    return rows.length === 1 && rows[0]!.trim().startsWith("Z");
  };
  const nativeSessionHandleScanFailures: Array<{ stage: string; errno: string | null; elapsedMs: number;
    deadlineRemainingMs: number | null; numericPidsScanned: number; sameUidProcesses: number;
    nonZombieProcesses: number; fdEntriesScanned: number; observerPhase?: string; failureLabel?: string; failedChecks?: string[] }> = [];
  const nativeSessionHandleFacts = (sourceSessions: string, upperSessions: string, deadlineMs: number) => {
    const startedAt = Date.now();
    let numericPidsScanned = 0, sameUidProcesses = 0, nonZombieProcesses = 0, fdEntriesScanned = 0;
    const failed = (stage: "initial_deadline" | "uid_api_unavailable" | "process_deadline" | "process_directory_stat" |
      "process_state_read" | "cwd_readlink" | "fd_directory_list" | "fd_deadline" | "fd_readlink" | "proc_list_or_outer",
      error?: unknown) => {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      const errno = code === null ? null : typeof code === "string" &&
        ["ENOENT", "ESRCH", "EACCES", "EPERM", "EBADF", "EIO", "ENOTDIR", "ELOOP", "EMFILE", "ENFILE", "EINVAL"].includes(code)
        ? code : "OTHER";
      const now = Date.now();
      const fact = { stage, errno, elapsedMs: Math.max(0, now - startedAt),
        deadlineRemainingMs: Number.isFinite(deadlineMs) ? Math.trunc(deadlineMs - now) : null,
        numericPidsScanned, sameUidProcesses, nonZombieProcesses, fdEntriesScanned };
      nativeSessionHandleScanFailures.push(fact);
      if (nativeSessionHandleScanFailures.length > 8) nativeSessionHandleScanFailures.shift();
      if (process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1") {
        try { console.info("conversation_software_host_fd_scan_failed", JSON.stringify(fact)); } catch { /* Diagnostic only. */ }
      }
      return { holders: null, complete: false };
    };
    if (Date.now() >= deadlineMs || typeof process.getuid !== "function") return failed(typeof process.getuid !== "function" ? "uid_api_unavailable" : "initial_deadline");
    let holders = 0;
    const trustedUid = process.getuid();
    const within = (value: string) => value === sourceSessions || value.startsWith(`${sourceSessions}/`) ||
      value === upperSessions || value.startsWith(`${upperSessions}/`);
    try {
      for (const entry of readdirSync("/proc")) {
        if (!/^\d+$/.test(entry)) continue;
        if (Date.now() >= deadlineMs) return failed("process_deadline");
        numericPidsScanned++;
        const proc = join("/proc", entry);
        let procStat;
        try { procStat = statSync(proc); }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT" || code === "ESRCH") continue;
          return failed("process_directory_stat", error);
        }
        if (procStat.uid !== trustedUid) continue;
        sameUidProcesses++;
        let processState: string;
        try {
          const statText = readFileSync(join(proc, "stat"), "utf8");
          const close = statText.lastIndexOf(") ");
          processState = close >= 0 ? statText.slice(close + 2).trim().split(/\s+/)[0] ?? "" : "";
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT" || code === "ESRCH") continue;
          return failed("process_state_read", error);
        }
        if (processState === "Z") continue;
        nonZombieProcesses++;
        try {
          const cwd = readlinkSync(join(proc, "cwd"));
          if (within(cwd)) holders++;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ENOENT" && code !== "ESRCH") return failed("cwd_readlink", error);
        }
        let descriptors: string[];
        try { descriptors = readdirSync(join(proc, "fd")); }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT" || code === "ESRCH") continue;
          return failed("fd_directory_list", error);
        }
        for (const descriptor of descriptors) {
          if (Date.now() >= deadlineMs) return failed("fd_deadline");
          fdEntriesScanned++;
          try { if (within(readlinkSync(join(proc, "fd", descriptor)))) holders++; }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ENOENT" && code !== "ESRCH") return failed("fd_readlink", error);
          }
        }
      }
      return { holders, complete: true };
    } catch (error) { return failed("proc_list_or_outer", error); }
  };
  // Explicit CI prerequisite only; unconfigured local observation is unchanged.
  const observeNativeSessionHandles = async (sourceTarget: string, upperTarget: string, deadlineMs: number) => {
    if (process.env.PAPERCLIP_TEST_PRIVILEGED_SESSION_OBSERVER !== "1")
      return nativeSessionHandleFacts(sourceTarget, upperTarget, deadlineMs);
    const startedAt = Date.now();
    let observerPhase: "beforeScope" | "prerequisite" | "fileQualification" | "exec" | "response" | "afterScope" | "digestMismatch" = "beforeScope";
    let observerFailedChecks: string[] = [];
    let observedScopeDigest: string | null = null;
    const errorLabels = new Set(["fixture_observer_scope_changed", "fixture_observer_roots_changed",
      "fixture_observer_current_owner_changed", "fixture_observer_scope_expired", "fixture_observer_system_alias_unqualified",
      "fixture_observer_source_ancestor_unqualified", "fixture_observer_file_unqualified", "fixture_observer_file_alias",
      "fixture_observer_ancestor_unqualified", "fixture_observer_hash_mismatch", "prerequisite_unavailable",
      "request_invalid_or_expired", "exec_unknown", "response_not_object", "response_scan_incomplete", "response_invalid",
      "after_scope_changed", "caught_error"]);
    const unknown = (label: string, error?: unknown) => {
      // Diagnostics never change the unknown result or expose raw exception text.
      try {
        const firstLine = error instanceof Error ? error.message.split(/\r?\n/, 1)[0] ?? "" : "";
        const failureLabel = errorLabels.has(firstLine) ? firstLine : label === "caught_error" || error !== undefined ? "OTHER" : errorLabels.has(label) ? label : "OTHER";
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        const errno = code === null ? null : typeof code === "string" &&
          ["ENOENT", "ESRCH", "EACCES", "EPERM", "EBADF", "EIO", "ENOTDIR", "ELOOP", "EMFILE", "ENFILE", "EINVAL", "ETIMEDOUT", "EPIPE"].includes(code)
          ? code : "OTHER";
        const now = Date.now();
        const fact = { stage: "privileged_observer_unknown", errno, elapsedMs: Math.max(0, now - startedAt),
          deadlineRemainingMs: Number.isFinite(deadlineMs) ? Math.trunc(deadlineMs - now) : null,
          numericPidsScanned: 0, sameUidProcesses: 0, nonZombieProcesses: 0, fdEntriesScanned: 0,
          observerPhase, failureLabel, failedChecks: [...observerFailedChecks].slice(0, 16) };
        nativeSessionHandleScanFailures.push(fact);
        if (nativeSessionHandleScanFailures.length > 8) nativeSessionHandleScanFailures.shift();
        if (process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1")
          console.info("conversation_software_host_fd_scan_failed", JSON.stringify(fact));
      } catch { /* Failure-only diagnostics cannot change the unknown result. */ }
      return { holders: null, complete: false };
    };
    const launcher = "/usr/local/libexec/paperclip-fixture-observers/native-session-handles-v1";
    const scanner = `${launcher}.mjs`;
    const fixedNode = "/usr/local/libexec/paperclip-erasure-test-node/node";
    const witness = nativeRunnerClosureWitness;
    const exactScope = async () => {
      if (!witness || nativeRunnerClosureWitness !== witness || !expectedRunId || !expectedTaskRoot ||
          witness.runId !== expectedRunId || witness.taskRoot !== expectedTaskRoot ||
          !["stop_observed", "gone_verified"].includes(witness.phase) || !witness.stopReceiptMatched ||
          !witness.identityMatched || !witness.runPidStartedAtMatched || !witness.pid ||
          activeHostExecStreams !== 0 || Date.now() >= deadlineMs || !sessionOverlayUpperDir ||
          !/^[a-f0-9]{64}$/.test(witness.sessionDigest)) throw new Error("fixture_observer_scope_changed");
      const expectedSource = join(expectedTaskRoot, ".paperclip-runtime", "paperclip-runner", "sessions", witness.sessionDigest);
      if (sourceTarget !== expectedSource || upperTarget !== fixtureOverlayPath(expectedSource))
        throw new Error("fixture_observer_roots_changed");
      const start = modelBrokerSessionReceipts.find(receipt => receipt.phase === "start" &&
        receipt.sessionKey === witness.sessionKey && receipt.nativeSessionIdDigest === witness.sessionDigest &&
        receipt.startBindingDigest === witness.startBindingDigest);
      const stop = modelBrokerSessionReceipts.find(receipt => receipt.phase === "stop" &&
        receipt.sessionKey === witness.sessionKey && receipt.nativeSessionIdDigest === witness.sessionDigest &&
        receipt.capabilityHash === witness.expectedCapabilityHash && receipt.sessionDeadlineAt === witness.sessionDeadlineAt);
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.id, expectedRunId))).limit(1);
      const [lease] = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
        eq(environmentLeases.id, witness.leaseId), eq(environmentLeases.heartbeatRunId, expectedRunId),
        eq(environmentLeases.environmentId, environment.id))).limit(1);
      const profile = run?.runnerProfileJson as Record<string, any> | null;
      if (!start || !stop || !run || !["succeeded", "failed", "cancelled", "interrupted", "timed_out"].includes(run.status) ||
          run.nativeProcessCleanupPending || run.processPid !== witness.pid ||
          !(run.processStartedAt instanceof Date) || run.processStartedAt.toISOString() !== witness.startedAt ||
          profile?.nativeExecutionInput?.workspace?.cwd !== expectedTaskRoot || !lease ||
          !["released", "expired", "retained"].includes(lease.status) || lease.cleanupStatus !== "success" ||
          !lease.releasedAt || lease.metadata?.remoteCwd !== expectedTaskRoot) {
        // Failure diagnostics do not contribute to authorization.
        try {
          observerFailedChecks = Object.entries({ startReceipt: Boolean(start), stopReceipt: Boolean(stop), runPresent: Boolean(run),
            runTerminal: Boolean(run && ["succeeded", "failed", "cancelled", "interrupted", "timed_out"].includes(run.status)),
            processCleanupClear: Boolean(run && !run.nativeProcessCleanupPending), pidMatches: Boolean(run && run.processPid === witness.pid),
            startMatches: Boolean(run && run.processStartedAt instanceof Date && run.processStartedAt.toISOString() === witness.startedAt),
            profileCwd: profile?.nativeExecutionInput?.workspace?.cwd === expectedTaskRoot, leasePresent: Boolean(lease),
            leaseRetired: Boolean(lease && ["released", "expired", "retained"].includes(lease.status)),
            cleanupSuccess: lease?.cleanupStatus === "success", releasedAt: Boolean(lease?.releasedAt),
            leaseCwd: lease?.metadata?.remoteCwd === expectedTaskRoot,
          }).filter(([, passed]) => !passed).map(([name]) => name);
        } catch { /* The original owner failure remains authoritative. */ }
        throw new Error("fixture_observer_current_owner_changed");
      }
      observerFailedChecks = ["combinedStopRead"];
      const proof = await verifyNativeCleanupRuntimeState(db, { companyId, runId: expectedRunId, leaseId: witness.leaseId },
        lease.metadata?.remoteExecutionTermination);
      observerFailedChecks = [];
      if (Date.now() >= deadlineMs || nativeRunnerClosureWitness !== witness || activeHostExecStreams !== 0)
        throw new Error("fixture_observer_scope_expired");
      const digest = nativeSha256({ runId: run.id, status: run.status, pid: run.processPid, startedAt: run.processStartedAt,
        input: profile.nativeExecutionInput, leaseId: lease.id, statusLease: lease.status,
        metadata: lease.metadata, releasedAt: lease.releasedAt, failureReason: lease.failureReason, proof, start, stop,
        taskRoot: expectedTaskRoot, upperDir: sessionOverlayUpperDir, witness });
      observedScopeDigest = digest; // Private comparison only; no hash is diagnostic output.
      return digest;
    };
    try {
      const before = await exactScope(); // Authorization BEFORE any privileged operation.
      observerPhase = "prerequisite";
      if (!witness || typeof process.getuid !== "function" || process.getuid() <= 0 || fixtureImageNode !== fixedNode) {
        observerFailedChecks = Object.entries({ witnessPresent: Boolean(witness), uidApiPresent: typeof process.getuid === "function",
          originalUidPositive: typeof process.getuid === "function" && process.getuid() > 0,
          fixedNodeSelected: fixtureImageNode === fixedNode }).filter(([, passed]) => !passed).map(([name]) => name);
        return unknown("prerequisite_unavailable");
      }
      const qualified = (file: string, expectedHash?: string) => {
        const resolved = realpathSync(file), sourceEntry = lstatSync(file), metadata = lstatSync(resolved);
        if (sourceEntry.uid !== 0 || (!sourceEntry.isSymbolicLink() && (sourceEntry.mode & 0o22) !== 0))
          throw new Error("fixture_observer_system_alias_unqualified");
        for (let parent = dirname(file); ; parent = dirname(parent)) {
          const entry = lstatSync(parent);
          if (entry.uid !== 0 || (!entry.isSymbolicLink() && (entry.mode & 0o6022) !== 0))
            throw new Error("fixture_observer_source_ancestor_unqualified");
          if (parent === "/") break;
        }
        const forbiddenMode = file === "/usr/bin/sudo" ? 0o2022 : 0o6022;
        if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & forbiddenMode) !== 0 || metadata.uid !== 0 ||
            (file !== scanner && (metadata.mode & 0o111) === 0)) throw new Error("fixture_observer_file_unqualified");
        if ((file === launcher || file === scanner || file === fixedNode) && resolved !== file)
          throw new Error("fixture_observer_file_alias");
        for (let current = resolved; ; current = dirname(current)) {
          const entry = lstatSync(current);
          if (entry.isSymbolicLink() || entry.uid !== 0 || (entry.mode & (current === resolved ? forbiddenMode : 0o6022)) !== 0)
            throw new Error("fixture_observer_ancestor_unqualified");
          if (current === "/") break;
        }
        if (expectedHash && (metadata.size > 32 * 1024 || createHash("sha256").update(readFileSync(file)).digest("hex") !== expectedHash))
          throw new Error("fixture_observer_hash_mismatch");
      };
      observerPhase = "fileQualification";
      qualified(launcher, "9045f8998cfe2fd12b706b58b459d1271815c37175a8017d1d958a3afbc009e8");
      qualified(scanner, "7a092f75132698d5e43c0424fc103b100f0dd62353e80ca5c5d3d71969462f55");
      for (const executable of [fixedNode, "/usr/bin/sudo", "/usr/bin/env", "/usr/bin/id", "/bin/sh"]) qualified(executable);
      observerPhase = "exec";
      const request = JSON.stringify({ schema: "paperclip.fixture.native-session-handles.v1", taskRoot: expectedTaskRoot,
        sessionDigest: witness.sessionDigest, upperDir: sessionOverlayUpperDir, observerUid: process.getuid(), deadlineAt: deadlineMs });
      if (Buffer.byteLength(request) > 4096 || Date.now() >= deadlineMs) {
        observerFailedChecks = Object.entries({ requestBounded: Buffer.byteLength(request) <= 4096, deadlineFuture: Date.now() < deadlineMs })
          .filter(([, passed]) => !passed).map(([name]) => name);
        return unknown("request_invalid_or_expired");
      }
      const result = spawnSync("/usr/bin/sudo", ["-n", "--", launcher], { input: request, encoding: "utf8", cwd: "/",
        env: { PATH: "/usr/bin:/bin" }, timeout: Math.max(1, deadlineMs - Date.now()), maxBuffer: 8192 });
      if (result.error || result.signal || result.status !== 0 || result.stderr !== "" ||
          typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > 8192 || Date.now() >= deadlineMs) {
        observerFailedChecks = Object.entries({ execNoError: !result.error, execNoSignal: !result.signal, execSuccess: result.status === 0,
          execStderrEmpty: result.stderr === "", execStdoutString: typeof result.stdout === "string",
          execOutputBounded: typeof result.stdout === "string" && Buffer.byteLength(result.stdout) <= 8192,
          deadlineFuture: Date.now() < deadlineMs }).filter(([, passed]) => !passed).map(([name]) => name);
        return unknown("exec_unknown", result.error);
      }
      observerPhase = "response";
      const response: unknown = JSON.parse(result.stdout);
      if (!response || typeof response !== "object" || Array.isArray(response)) return unknown("response_not_object");
      const value = response as Record<string, unknown>;
      if (value.complete === false && value.holders === null &&
          Object.keys(value).sort().join(",") === "complete,failure,holders" && value.failure &&
          typeof value.failure === "object" && !Array.isArray(value.failure)) {
        const failure = value.failure as Record<string, unknown>;
        const allowedStages = ["initial_deadline", "uid_api_unavailable", "process_deadline", "process_directory_stat",
          "process_state_read", "cwd_readlink", "fd_directory_list", "fd_deadline", "fd_readlink", "proc_list_or_outer"];
        const counts = ["elapsedMs", "numericPidsScanned", "sameUidProcesses", "nonZombieProcesses", "fdEntriesScanned"];
        if (Object.keys(failure).sort().join(",") === "deadlineRemainingMs,elapsedMs,errno,fdEntriesScanned,nonZombieProcesses,numericPidsScanned,sameUidProcesses,stage" &&
            typeof failure.stage === "string" && allowedStages.includes(failure.stage) &&
            (failure.errno === null || typeof failure.errno === "string" &&
              ["ENOENT", "ESRCH", "EACCES", "EPERM", "EBADF", "EIO", "ENOTDIR", "ELOOP", "EMFILE", "ENFILE", "EINVAL", "OTHER"].includes(failure.errno)) &&
            counts.every(key => Number.isSafeInteger(failure[key]) && (failure[key] as number) >= 0) &&
            Number.isSafeInteger(failure.deadlineRemainingMs)) {
          const fact = { stage: failure.stage, errno: failure.errno as string | null, elapsedMs: failure.elapsedMs as number,
            deadlineRemainingMs: failure.deadlineRemainingMs as number, numericPidsScanned: failure.numericPidsScanned as number,
            sameUidProcesses: failure.sameUidProcesses as number, nonZombieProcesses: failure.nonZombieProcesses as number,
            fdEntriesScanned: failure.fdEntriesScanned as number };
          nativeSessionHandleScanFailures.push(fact);
          if (nativeSessionHandleScanFailures.length > 8) nativeSessionHandleScanFailures.shift();
          if (process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1")
            console.info("conversation_software_host_fd_scan_failed", JSON.stringify(fact));
        }
        return unknown("response_scan_incomplete");
      }
      if (value.complete !== true || !Number.isSafeInteger(value.holders) || (value.holders as number) < 0 ||
          Object.keys(value).sort().join(",") !== "complete,holders") return unknown("response_invalid");
      // Blocking observation never replaces the original AFTER-observation currentness check.
      observerPhase = "afterScope";
      if (await exactScope() !== before || Date.now() >= deadlineMs) {
        if (observedScopeDigest !== before) observerPhase = "digestMismatch";
        observerFailedChecks = Object.entries({ scopeDigestSame: observedScopeDigest === before, deadlineFuture: Date.now() < deadlineMs })
          .filter(([, passed]) => !passed).map(([name]) => name);
        return unknown("after_scope_changed");
      }
      return { holders: value.holders as number, complete: true };
    } catch (error) {
      return unknown("caught_error", error);
    }
  };
  const attachActualNativeSessionBacking = async (command: Record<string, any>, deadlineMs: number) => {
    const descriptor = command.nativeSessionErasure as Record<string, any> | undefined;
    if (!descriptor || typeof descriptor.sessionKey !== "string" || typeof descriptor.sessionDigest !== "string" ||
        typeof descriptor.taskRoot !== "string" || typeof descriptor.sandboxId !== "string" || typeof descriptor.containerId !== "string" ||
        typeof descriptor.runId !== "string" || typeof descriptor.runnerInstanceId !== "string" ||
        descriptor.runId !== expectedRunId ||
        descriptor.taskRoot !== expectedTaskRoot || descriptor.sandboxId !== activeHostIdentity?.sandboxId ||
        descriptor.containerId !== activeHostIdentity?.containerId || descriptor.containerId !== fixtureSandboxContainerId ||
        !fixtureSandboxExists || fixtureSandboxPhase !== "Stopped" ||
        !/^[a-f0-9]{64}$/.test(descriptor.sessionDigest) || expectedTaskRoot === null)
      throw new Error("conversation_native_session_backing_scope_changed");
    const started = modelBrokerSessionReceipts.some(receipt => receipt.phase === "start" &&
      receipt.sessionKey === descriptor.sessionKey && receipt.nativeSessionIdDigest === descriptor.sessionDigest &&
      receipt.startBindingDigest === descriptor.startBindingDigest);
    if (!started) throw new Error("conversation_native_session_start_receipt_missing");
    // startBindingDigest is deliberately start-only on the signed wire. Bind
    // the stop receipt back to that start through the already validated
    // process-closure witness instead of expecting the stop request to repeat
    // start-only provenance.
    const closureWitness = nativeRunnerClosureWitness;
    const stoppedReceipt = modelBrokerSessionReceipts.find(receipt => receipt.phase === "stop" &&
      receipt.sessionKey === descriptor.sessionKey && receipt.nativeSessionIdDigest === descriptor.sessionDigest);
    const stopped = Boolean(started && stoppedReceipt && closureWitness &&
      closureWitness.phase === "stop_observed" && closureWitness.stopReceiptMatched &&
      closureWitness.sessionKey === descriptor.sessionKey && closureWitness.sessionDigest === descriptor.sessionDigest &&
      closureWitness.runId === descriptor.runId && closureWitness.taskRoot === descriptor.taskRoot &&
      closureWitness.runnerId === descriptor.runnerInstanceId && closureWitness.leaseId === descriptor.leaseId &&
      closureWitness.startBindingDigest === descriptor.startBindingDigest &&
      stoppedReceipt.capabilityHash === closureWitness.expectedCapabilityHash &&
      stoppedReceipt.sessionDeadlineAt === closureWitness.sessionDeadlineAt);
    const sourceSessions = join(descriptor.taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions");
    const upperSessions = join(fixtureOverlayPath(descriptor.taskRoot), ".paperclip-runtime", "paperclip-runner", "sessions");
    const targetAtUpper = join(upperSessions, descriptor.sessionDigest);
    const sourceTarget = join(sourceSessions, descriptor.sessionDigest);
    const previous = nativeSessionBackingByKey.get(descriptor.sessionKey);
    if (previous) {
      if (previous.sessionDigest !== descriptor.sessionDigest || previous.taskRoot !== descriptor.taskRoot ||
          previous.runId !== descriptor.runId || previous.runnerInstanceId !== descriptor.runnerInstanceId ||
          previous.leaseId !== descriptor.leaseId || previous.startBindingDigest !== descriptor.startBindingDigest ||
          previous.sandboxId !== descriptor.sandboxId || previous.containerId !== descriptor.containerId ||
          previous.sourceSessions !== sourceSessions || previous.upperSessions !== upperSessions)
        throw new Error("conversation_native_session_backing_replay_scope_changed");
      const sourceStat = lstatSync(sourceSessions);
      if (!sourceStat.isSymbolicLink() || readlinkSync(sourceSessions) !== upperSessions || realpathSync(sourceSessions) !== realpathSync(upperSessions))
        throw new Error("conversation_native_session_backing_alias_changed");
      let targetAbsent = false;
      try { lstatSync(targetAtUpper); } catch (error) { targetAbsent = (error as NodeJS.ErrnoException).code === "ENOENT"; }
      if (!targetAbsent) throw new Error("conversation_native_session_replay_target_present");
      const groups = nativeGroupSessionLiveCounts(previous.processGroupId, previous.processSessionId, deadlineMs);
      const handles = await observeNativeSessionHandles(sourceTarget, targetAtUpper, deadlineMs);
      if (activeHostExecStreams !== 0 || !nativeProcessGone(previous.processPid, deadlineMs) ||
          groups?.groupLive !== 0 || groups.sessionLive !== 0 || !handles.complete || handles.holders !== 0)
        throw new Error("conversation_native_session_replay_process_closure_unverified");
      nativeSessionBackingObservations.push({ processWitnessPresent: true, processWitnessPhase: "gone_verified",
        launchMatched: true, nonceMatches: true, runnerMatches: true, identityMatched: true,
        runPidStartedAtMatched: true, identityVerdict: "gone", processGone: true,
        previousLiveGroupKnown: true, previousLiveSessionKnown: true, processGroupLive: 0, processSessionLive: 0,
        fdOrCwdSessionsHolders: 0, fdOrCwdScanComplete: true, noSessionHandles: true,
        stopCheckerExit: 3, stopReceiptMatched: true, noActiveHostExecStreams: true,
        closureWitnessComplete: true, backingMoved: false });
      return { ...previous, moved: false, replayAliasExact: true, targetAbsent };
    }
    const processWitness = nativeRunnerClosureWitness;
    if (!stopped || activeHostExecStreams !== 0 || !processWitness || processWitness.phase !== "stop_observed" ||
        !processWitness.launchMatched || !processWitness.nonceMatches || !processWitness.runnerMatches ||
        !processWitness.identityMatched || !processWitness.runPidStartedAtMatched ||
        processWitness.identityVerdict !== "gone" || !processWitness.processGone || !processWitness.previousLiveGroupKnown ||
        !processWitness.previousLiveSessionKnown || processWitness.processGroupLive !== 0 ||
        processWitness.processSessionLive !== 0 ||
        processWitness.stopCheckerExit !== 3 || !processWitness.stopReceiptMatched ||
        processWitness.runId !== expectedRunId || processWitness.taskRoot !== descriptor.taskRoot ||
        processWitness.sessionKey !== descriptor.sessionKey || processWitness.sessionDigest !== descriptor.sessionDigest ||
        processWitness.leaseId !== descriptor.leaseId ||
        processWitness.runnerId !== descriptor.runnerInstanceId || processWitness.runId !== descriptor.runId ||
        processWitness.startBindingDigest !== descriptor.startBindingDigest ||
        processWitness.identityPath !== join(descriptor.taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions",
          descriptor.sessionDigest, "runner", "runner-process.identity"))
      throw new Error("conversation_native_session_process_closure_unverified");
    const targetIdentityPath = join(descriptor.taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions",
      descriptor.sessionDigest, "runner", "runner-process.identity");
    let identityMarkerMatches = false;
    try {
      const identityStat = lstatSync(targetIdentityPath);
      const marker = readFileSync(targetIdentityPath, "utf8").split(/\r?\n/);
      identityMarkerMatches = identityStat.isFile() && !identityStat.isSymbolicLink() && marker.length >= 5 &&
        marker[0] === processWitness.nonce && marker[1] === String(processWitness.pid) &&
        marker[2] === processWitness.startedAt && marker[3] === processWitness.runnerId &&
        marker[4] === processWitness.processFingerprint;
    } catch { identityMarkerMatches = false; }
    const groupSessionLive = processWitness.processGroupId !== null && processWitness.processSessionId !== null
      ? nativeGroupSessionLiveCounts(processWitness.processGroupId, processWitness.processSessionId, deadlineMs) : null;
    if (process.env.PAPERCLIP_TEST_PRIVILEGED_SESSION_OBSERVER === "1") {
      const [beforeObserverRun] = await db.select({ processPid: heartbeatRuns.processPid, processStartedAt: heartbeatRuns.processStartedAt })
        .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, processWitness.runId))).limit(1);
      if (beforeObserverRun?.processPid !== processWitness.pid || !(beforeObserverRun?.processStartedAt instanceof Date) ||
          beforeObserverRun.processStartedAt.toISOString() !== processWitness.startedAt)
        throw new Error("conversation_native_session_process_closure_unverified");
    }
    const handleFacts = await observeNativeSessionHandles(sourceTarget, targetAtUpper, deadlineMs);
    const [boundRun] = expectedRunId ? await db.select({ status: heartbeatRuns.status, processPid: heartbeatRuns.processPid,
      processStartedAt: heartbeatRuns.processStartedAt }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, expectedRunId))).limit(1) : [];
    const databaseIdentityMatches = Boolean(boundRun && processWitness.runId === expectedRunId &&
      boundRun.processPid === processWitness.pid && boundRun.processStartedAt instanceof Date && processWitness.startedAt &&
      boundRun.processStartedAt.toISOString() === processWitness.startedAt);
    const closureWitnessComplete = identityMarkerMatches && databaseIdentityMatches && groupSessionLive?.groupLive === 0 &&
      groupSessionLive.sessionLive === 0 && processWitness.pid !== null && nativeProcessGone(processWitness.pid, deadlineMs) &&
      handleFacts.complete && handleFacts.holders === 0 && activeHostExecStreams === 0;
    if (closureWitnessComplete) {
      processWitness.phase = "gone_verified";
      processWitness.identityVerdict = "gone";
      processWitness.processGone = true;
      processWitness.processGroupLive = groupSessionLive.groupLive;
      processWitness.processSessionLive = groupSessionLive.sessionLive;
      processWitness.fdOrCwdSessionsHolders = handleFacts.holders;
      processWitness.fdOrCwdScanComplete = handleFacts.complete;
      processWitness.noSessionHandles = true;
    }
    nativeSessionBackingObservations.push({
      processWitnessPresent: true, processWitnessPhase: processWitness.phase,
      launchMatched: processWitness.launchMatched, identityMatched: processWitness.identityMatched,
      runPidStartedAtMatched: processWitness.runPidStartedAtMatched, identityVerdict: processWitness.identityVerdict,
      processGone: processWitness.processGone, nonceMatches: processWitness.nonceMatches,
      runnerMatches: processWitness.runnerMatches,
      previousLiveGroupKnown: processWitness.previousLiveGroupKnown,
      previousLiveSessionKnown: processWitness.previousLiveSessionKnown,
      processGroupLive: groupSessionLive?.groupLive ?? null, processSessionLive: groupSessionLive?.sessionLive ?? null,
      fdOrCwdSessionsHolders: handleFacts.holders, fdOrCwdScanComplete: handleFacts.complete,
      noSessionHandles: handleFacts.complete && handleFacts.holders === 0,
      identityMarkerMatches, databaseIdentityMatches, stopReceiptMatched: processWitness.stopReceiptMatched,
      noActiveHostExecStreams: activeHostExecStreams === 0, closureWitnessComplete,
    });
    if (!closureWitnessComplete) throw new Error("conversation_native_session_process_closure_unverified");
    assertRealDirectoryTree(descriptor.taskRoot);
    assertRealDirectoryTree(join(descriptor.taskRoot, ".paperclip-runtime"));
    assertRealDirectoryTree(join(descriptor.taskRoot, ".paperclip-runtime", "paperclip-runner"));
    assertRealDirectoryTree(sourceSessions);
    assertRealDirectoryTree(join(sourceTarget, "runner"));
    const runnerStatePath = join(sourceTarget, "runner", "runner-state.json");
    const runnerIdentityPath = join(sourceTarget, "runner", "runner-process.identity");
    for (const required of [runnerStatePath, runnerIdentityPath]) {
      const stat = lstatSync(required);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0)
        throw new Error("conversation_native_session_real_runner_state_missing");
    }
    const beforeTree = snapshotNativeSessionTree(sourceSessions, deadlineMs);
    const sourceRootStat = lstatSync(sourceSessions);
    const upperRoot = sessionOverlayUpperDir;
    if (!upperRoot || statSync(upperRoot).dev !== sourceRootStat.dev)
      throw new Error("conversation_native_session_backing_device_mismatch");
    const upperTaskRoot = fixtureOverlayPath(descriptor.taskRoot);
    const upperRuntimeRoot = join(upperTaskRoot, ".paperclip-runtime");
    const upperRunnerRoot = join(upperRuntimeRoot, "paperclip-runner");
    ensureRealDirectoryTree(upperTaskRoot);
    ensureRealDirectoryTree(upperRuntimeRoot);
    ensureRealDirectoryTree(upperRunnerRoot);
    for (const parent of [upperRoot, upperTaskRoot, upperRuntimeRoot, upperRunnerRoot]) assertRealDirectoryTree(parent);
    try { lstatSync(upperSessions); throw new Error("conversation_native_session_backing_destination_occupied"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    renameSync(sourceSessions, upperSessions);
    symlinkSync(upperSessions, sourceSessions, "dir");
    const movedRoot = lstatSync(upperSessions);
    const afterTree = snapshotNativeSessionTree(upperSessions, deadlineMs);
    const aliasStat = lstatSync(sourceSessions);
    const aliasExact = aliasStat.isSymbolicLink() && readlinkSync(sourceSessions) === upperSessions &&
      realpathSync(sourceSessions) === realpathSync(upperSessions);
    const sameTree = beforeTree.treeDigest === afterTree.treeDigest && beforeTree.fileCount === afterTree.fileCount &&
      beforeTree.byteCount === afterTree.byteCount && sourceRootStat.dev === movedRoot.dev && sourceRootStat.ino === movedRoot.ino &&
      sourceRootStat.dev === movedRoot.dev && aliasExact;
    if (!sameTree) throw new Error("conversation_native_session_move_witness_mismatch");
    const record = { sessionKey: descriptor.sessionKey, sessionDigest: descriptor.sessionDigest, taskRoot: descriptor.taskRoot,
      runId: descriptor.runId, runnerInstanceId: descriptor.runnerInstanceId, leaseId: descriptor.leaseId,
      startBindingDigest: descriptor.startBindingDigest,
      sandboxId: descriptor.sandboxId, containerId: descriptor.containerId, sourceSessions, upperSessions,
      originalTreeDigest: beforeTree.treeDigest, rootDev: sourceRootStat.dev, rootIno: sourceRootStat.ino,
      fileCount: beforeTree.fileCount, byteCount: beforeTree.byteCount, witnessMatched: sameTree,
      runnerStateFilePresent: true, runnerIdentityFilePresent: true, processPid: processWitness.pid!,
      processGroupId: processWitness.processGroupId!, processSessionId: processWitness.processSessionId! };
    nativeSessionBackingByKey.set(descriptor.sessionKey, record);
    nativeSessionBackingObservations.push({ processWitnessPresent: true, processWitnessPhase: "gone_verified",
      launchMatched: true, nonceMatches: true, runnerMatches: true,
      identityMatched: true, runPidStartedAtMatched: true, identityVerdict: "gone", processGone: true,
      previousLiveGroupKnown: true, previousLiveSessionKnown: true, processGroupLive: 0, processSessionLive: 0,
      fdOrCwdSessionsHolders: 0, fdOrCwdScanComplete: true, noSessionHandles: true, identityMarkerMatches: true,
      databaseIdentityMatches: true, stopReceiptMatched: true, noActiveHostExecStreams: true,
      closureWitnessComplete: true, backingMoved: true });
    return { ...record, moved: true, replayAliasExact: aliasExact, targetAbsent: false };
  };
  const sessionProviders = new Map<string, { type: string; credential: string | null; expiresAt: string | null;
    family: "worker_model" | "conversation_model" | null }>();
  const attachedSessionProviders = new Set<string>();
  const hostCredentialProfile = {
    id: "paperclip-runtime-app-broker",
    credentials: [{ name: "app_token", env_vars: ["PAPERCLIP_SANDBOX_BROKER_TOKEN"], required: true,
      auth_style: "bearer", header_name: "Authorization" }],
    endpoints: [{ host: new URL(brokerOrigin).hostname, port: Number(new URL(brokerOrigin).port || 443),
      protocol: "rest", enforcement: "enforce", path: "", rules: [{ allow: { method: "POST", path: "/mcp/gateways/*" } }] }],
    binaries: [{ path: "/usr/bin/curl" }],
  };
  const hostModelProfile = {
    id: "paperclip-model-broker",
    credentials: [{ name: "model_token", env_vars: ["PAPERCLIP_SANDBOX_MODEL_TOKEN"], required: true,
      auth_style: "bearer", header_name: "Authorization" }],
    endpoints: [{ host: new URL(brokerOrigin).hostname, port: Number(new URL(brokerOrigin).port || 443),
      protocol: "rest", enforcement: "enforce", path: "", rules: [{ allow: { method: "POST",
        path: "/runtime-tools/model/v1/messages" } }] }],
    binaries: [{ path: input.opencodeBinary }],
  };
  const runtimeBrokerProfiles = {
    app: { id: hostCredentialProfile.id, hash: nativeSha256(hostCredentialProfile), origin: brokerOrigin, binaries: ["/usr/bin/curl"] },
    model: { id: hostModelProfile.id, hash: nativeSha256(hostModelProfile), origin: brokerOrigin, binaries: [input.opencodeBinary] },
  };
  const runtimeBrokerBinaryReadPaths = [...new Set(["/usr/bin/curl", input.opencodeBinary])].sort();
  if (runtimeBrokerBinaryReadPaths.some(binary => !binary.startsWith("/") || binary === "/" || binary.includes("\\") ||
      binary.split("/").some(part => part === "." || part === "..") || binary.includes("//") || /[\r\n*?]/.test(binary)))
    throw new Error("conversation_software_host_runtime_broker_binary_path_invalid");
  let lastHostCapabilities: SandboxCapabilitySnapshot | null = null;
  type ModelStartArtifactPin = { authority: Record<string, unknown>; artifactAuthority: Record<string, any>;
    imageSha256: string; imageBytes: number; manifestDigest: string };
  const immutableModelAuthority = (authority: Record<string, any>) => ({ version: authority.version,
    artifactAuthority: authority.artifactAuthority, workspaceMetadataSource: authority.workspaceMetadataSource,
    executionInputHash: authority.executionInputHash, systemInstructionsHash: authority.systemInstructionsHash,
    toolSchemasHash: authority.toolSchemasHash, toolSchemas: authority.toolSchemas });
  const captureOriginalStartArtifact = async (hostInput: any): Promise<ModelStartArtifactPin> => {
    const request = hostInput.request, claims = verifySandboxExecJwt(hostInput.capabilityToken), cap = claims?.sandbox_exec;
    if (!claims || !cap || claims.company_id !== companyId || claims.sub !== agentId || claims.run_id !== expectedRunId ||
        claims.jti !== request.requestId || cap.runId !== request.runId || request.runId !== expectedRunId ||
        cap.commandDigest !== request.commandDigest || cap.manifestId !== request.manifestId || cap.manifestHash !== request.manifestHash)
      throw new Error("serial_model_artifact_start_not_authorized");
    // RuntimeControl has already authorized this real command against its
    // current source owner. Native constructor13695+ verified/materialized the
    // build-owned pack, persisted its immutable authority13708+, then staged
    // workspace/context before this launch. Capture that owner NOW, not at HTTP.
    const read = async () => {
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.id, request.runId), eq(heartbeatRuns.status, "running"))).limit(1);
      const profile = run?.runnerProfileJson as Record<string, any> | null, authority = profile?.nativeOpenCodeSourceAuthority;
      if (!run || run.responsibleUserId !== actor.userId || !authority || authority.version !== 1 ||
          authority.executionInputHash !== sealedExecutionInputHash || nativeSha256(profile?.nativeExecutionInput) !== sealedExecutionInputHash)
        throw new Error("serial_model_original_artifact_owner_missing");
      if (nativeConformanceMode) {
        const context = run.contextSnapshot && typeof run.contextSnapshot === "object"
          ? run.contextSnapshot as Record<string, any> : {};
        const tuple = context.nativeOpenCodeConformanceDispatch;
        if (!tuple || Object.keys(tuple).sort().join(",") !==
            ["authorityHash", "dispatchNonce", "planId", "probeId", "profileId", "qualificationGroupId"].sort().join(",") ||
            tuple.qualificationGroupId !== context.providerConformanceGroupId ||
            tuple.planId !== context.providerConformancePlanId || tuple.profileId !== context.nativeOpenCodeConformanceProfileId ||
            tuple.probeId !== context.nativeOpenCodeConformanceProbeId ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tuple.dispatchNonce ?? "") ||
            !/^[a-f0-9]{64}$/.test(tuple.authorityHash ?? ""))
          throw new Error("serial_model_conformance_dispatch_tuple_missing_at_launch");
      }
      return structuredClone(immutableModelAuthority(authority));
    };
    const authority = await read(), artifactAuthority = authority.artifactAuthority as Record<string, any> | undefined;
    const manifest = artifactAuthority?.providerPackManifest, image = manifest?.payload?.artifacts?.opencodeExecutable;
    const digest = typeof image?.sha256 === "string" ? /^sha256:([a-f0-9]{64})$/.exec(image.sha256) : null;
    if (!artifactAuthority || artifactAuthority.installedPackRoot !== join(providerImageHome, ".local", "share", "paperclip-runner", "provider-pack") ||
        manifest?.schema !== REMOTE_PROVIDER_PACK_SCHEMA || !/^sha256:[a-f0-9]{64}$/.test(manifest?.digest ?? "") ||
        manifest?.payload?.pins?.opencode !== MANAGED_NATIVE_OPENCODE_IMAGE_PIN.version ||
        image?.path !== REMOTE_PROVIDER_PACK_ARTIFACT_PATHS.opencodeExecutable || digest?.[1] !== MANAGED_NATIVE_OPENCODE_IMAGE_PIN.sha256)
      throw new Error("serial_model_original_artifact_pin_invalid");
    // No duplicate manifest canonicalizer: trust the existing authorized
    // Native artifact owner; additionally match its exact image to the already
    // qualified server-selected fixture binary with a bounded streaming read.
    const selected = await assertManagedFixtureOpenCodeImage(input.opencodeBinary,
      Math.min(Date.parse(request.deadlineAt), Date.now() + 10_000));
    if (!isDeepStrictEqual(await read(), authority)) throw new Error("serial_model_original_artifact_changed_during_capture");
    return Object.freeze({ authority, artifactAuthority, imageSha256: digest[1]!, imageBytes: selected.size, manifestDigest: manifest.digest });
  };
  const verifiedSpawnScope = new AsyncLocalStorage<{ scope: Record<string, unknown>; request: Record<string, any>;
    capabilityToken: string; artifactPin?: ModelStartArtifactPin }>();
  let modelOrigin: SignedModelOrigin | null = null;
  let observedModelChannel: ModelChannel | null = null;
  const modelOriginDenialFacts = { wrongNonceDenied: false, wrongImageDenied: false, retiredChannelDenied: false };
  const activateModelOrigin = () => {
    if (!serialTransport) return;
    const invocation = verifiedSpawnScope.getStore();
    const request = invocation?.request ? structuredClone(invocation.request) : null;
    const descriptor = request?.modelBrokerSession;
    if (descriptor?.phase !== "start") return;
    const artifactPin = invocation?.artifactPin;
    if (!artifactPin) throw new Error("serial_model_original_start_artifact_missing");
    const claims = invocation ? verifySandboxExecJwt(invocation.capabilityToken) : null, cap = claims?.sandbox_exec;
    if (!request || !cap || claims?.company_id !== companyId || claims.sub !== agentId || claims.run_id !== expectedRunId ||
        claims.jti !== request.requestId || cap.hostId !== host.id || cap.requestId !== request.requestId || cap.runId !== request.runId || request.runId !== expectedRunId ||
        cap.bindingId !== binding.id || cap.cellId !== cell.id || cap.generation !== cell.generation.toString() ||
        cap.hostEpoch !== request.hostEpoch || cap.manifestId !== request.manifestId || cap.manifestHash !== request.manifestHash ||
        cap.attemptId !== request.attemptId || cap.attempt !== request.attempt || cap.commandDigest !== request.commandDigest ||
        cap.policySnapshotId !== request.policySnapshotId || cap.policyHash !== request.policyHash || cap.deadlineAt !== request.deadlineAt ||
        request.argv[3] !== "paperclip-runner-launch" || request.argv[7] !== REMOTE_RUNNER_CHILD_LAUNCH_SCRIPT ||
        request.argv[6] !== descriptor.runnerInstanceId || typeof request.argv[5] !== "string" ||
        !/^[a-f0-9-]{36}$/.test(request.argv[5]) || !expectedTaskRoot || !sealedExecutionInputHash)
      throw new Error("serial_model_start_scope_invalid");
    const markerPath = join(expectedTaskRoot, ".paperclip-runtime", "paperclip-runner", "sessions",
      descriptor.nativeSessionIdDigest, "runner", "runner-process.identity");
    if (request.argv[4] !== markerPath) throw new Error("serial_model_start_marker_changed");
    const journal = JSON.parse(readFileSync(sessionHostJournalFile!, "utf8"));
    const original = journal.modelBrokerSessions?.[descriptor.sessionKey];
    if (!original || original.state !== "active" || original.startBindingDigest !== descriptor.startBindingDigest ||
        original.binding.runId !== expectedRunId || original.binding.leaseId !== descriptor.leaseId ||
        original.binding.sessionKey !== descriptor.sessionKey || original.binding.manifestId !== request.manifestId ||
        original.binding.manifestHash !== request.manifestHash || original.profileId !== hostModelProfile.id ||
        original.profileHash !== nativeSha256(hostModelProfile)) throw new Error("serial_model_applied_start_unavailable");
    if (modelOrigin) throw new Error("serial_model_start_already_observed");
    const originalBindingHash = nativeSha256(original.binding), inputHash = sealedExecutionInputHash;
    modelOrigin = Object.freeze({ runId: request.runId, leaseId: descriptor.leaseId, sessionKey: descriptor.sessionKey,
      markerPath, nonce: request.argv[5], runnerInstanceId: descriptor.runnerInstanceId,
      currentProvider: async () => {
        const currentJournal = JSON.parse(readFileSync(sessionHostJournalFile!, "utf8"));
        const entry = currentJournal.modelBrokerSessions?.[descriptor.sessionKey];
        const provider = entry ? sessionProviders.get(entry.providerName) : null;
        const token = provider?.credential;
        const tokenClaims = token ? verifyRuntimeToolsToken(token, "worker_model") : null;
        const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.id, request.runId))).limit(1);
        const [lease] = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
          eq(environmentLeases.id, descriptor.leaseId), eq(environmentLeases.heartbeatRunId, request.runId),
          eq(environmentLeases.environmentId, environment.id))).limit(1);
        const [manifest] = await db.select().from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, companyId),
          eq(agentExecutionManifests.id, request.manifestId), eq(agentExecutionManifests.runId, request.runId))).limit(1);
        const profile = run?.runnerProfileJson as Record<string, any> | null;
        const authority = profile?.nativeOpenCodeSourceAuthority;
        const artifactManifest = authority?.artifactAuthority?.providerPackManifest;
        const image = artifactManifest?.payload?.artifacts?.opencodeExecutable;
        if (!entry || entry.state !== "active" || nativeSha256(entry.binding) !== originalBindingHash ||
            entry.startBindingDigest !== descriptor.startBindingDigest || entry.profileId !== hostModelProfile.id ||
            entry.profileHash !== nativeSha256(hostModelProfile) || !attachedSessionProviders.has(entry.providerName) ||
            !token || !tokenClaims || tokenClaims.run_id !== request.runId || tokenClaims.company_id !== companyId || tokenClaims.sub !== agentId || tokenClaims.responsible_user_id !== actor.userId ||
            !Number.isFinite(Date.parse(entry.expiresAt)) || !Number.isFinite(Date.parse(descriptor.sessionDeadlineAt)) ||
            createHash("sha256").update(token).digest("hex") !== entry.capabilityHash || provider?.expiresAt !== entry.expiresAt ||
            Date.parse(entry.expiresAt) <= Date.now() || Date.parse(entry.expiresAt) > Date.parse(descriptor.sessionDeadlineAt) ||
            Date.parse(descriptor.sessionDeadlineAt) <= Date.now() || observedSandboxPhase !== "Ready" ||
            !run || run.status !== "running" || run.responsibleUserId !== actor.userId || !lease || lease.status !== "active" ||
            !lease.expiresAt || lease.expiresAt <= new Date() || manifest?.hash !== request.manifestHash ||
            nativeSha256(profile?.nativeExecutionInput) !== inputHash || authority?.executionInputHash !== inputHash ||
            profile?.nativeExecutionInput?.workspace?.cwd !== expectedTaskRoot || lease.metadata?.remoteCwd !== expectedTaskRoot ||
            request.cwd !== expectedTaskRoot || currentJournal.scopes?.[binding.id]?.policy?.policyHash !== request.policyHash ||
            !isDeepStrictEqual(immutableModelAuthority(authority), artifactPin.authority) ||
            !isDeepStrictEqual(authority?.artifactAuthority, artifactPin.artifactAuthority) ||
            artifactManifest?.digest !== artifactPin.manifestDigest || image?.sha256 !== "sha256:" + artifactPin.imageSha256)
          throw new Error("serial_model_current_applied_provider_changed");
        const providerAfter = sessionProviders.get(entry.providerName);
        const journalAfter = JSON.parse(readFileSync(sessionHostJournalFile!, "utf8"));
        if (nativeSha256(journalAfter.modelBrokerSessions?.[descriptor.sessionKey]) !== nativeSha256(entry) ||
            providerAfter?.credential !== token || !attachedSessionProviders.has(entry.providerName))
          throw new Error("serial_model_provider_changed_during_observation");
        return { token, capabilityHash: entry.capabilityHash, expiresAt: entry.expiresAt, imageSha256: artifactPin.imageSha256,
          imageBytes: artifactPin.imageBytes, manifestDigest: artifactPin.manifestDigest,
          runPid: run.processPid, runStartedAt: run.processStartedAt?.toISOString() ?? null };
      } });
  };
  const initializeSessionHostEngine = async () => {
    if (sessionHostEngine) return;
    const hostRoot = join(input.root, ".openshell-session-engine");
    const stateHome = join(hostRoot, "state");
    sessionHostJournalFile = join(hostRoot, "openshell-journal.json");
    mkdirSync(stateHome, { recursive: true, mode: 0o700 });
    const dockerRoot = join(hostRoot, "docker"), overlayLayerId = "f".repeat(64);
    const overlayUpperDir = join(dockerRoot, "overlay2", overlayLayerId, "diff");
    const overlayMergedDir = join(dockerRoot, "overlay2", overlayLayerId, "merged");
    sessionOverlayUpperDir = overlayUpperDir;
    mkdirSync(overlayUpperDir, { recursive: true, mode: 0o700 });
    mkdirSync(overlayMergedDir, { recursive: true, mode: 0o700 });
    const hostProcRoot = join(hostRoot, "proc"), hostContainerId = "b".repeat(64);
    const hostImageId = `sha256:${"9".repeat(64)}`;
    const hostImageRef = `fixture.invalid/aw-runtime-host@sha256:${"8".repeat(64)}`;
    const mountNamespace = "mnt:[4026531840]";
    mkdirSync(join(hostProcRoot, "1", "ns"), { recursive: true, mode: 0o700 });
    mkdirSync(join(hostProcRoot, "100", "ns"), { recursive: true, mode: 0o700 });
    mkdirSync(join(hostProcRoot, "101", "ns"), { recursive: true, mode: 0o700 });
    ensureFixtureNamespaceSymlink(join(hostProcRoot, "1", "ns", "mnt"), mountNamespace);
    ensureFixtureNamespaceSymlink(join(hostProcRoot, "100", "ns", "mnt"), mountNamespace);
    ensureFixtureNamespaceSymlink(join(hostProcRoot, "101", "ns", "mnt"), "mnt:[4026531999]");
    writeFileSync(join(hostProcRoot, "100", "comm"), "dockerd\n");
    writeFileSync(join(hostProcRoot, "101", "comm"), "dockerd\n");
    const hostMountInfo = "36 25 0:32 / / rw - overlay fixture rw\n";
    writeFileSync(join(hostProcRoot, "1", "mountinfo"), hostMountInfo);
    writeFileSync(join(hostProcRoot, "100", "mountinfo"), hostMountInfo);
    writeFileSync(join(hostProcRoot, "101", "mountinfo"), hostMountInfo);
    previousHostName = process.env.HOSTNAME;
    process.env.HOSTNAME = hostContainerId.slice(0, 12);
    const dockerHttpRequestBeforeFixture = http.request;
    originalDockerHttpRequest = dockerHttpRequestBeforeFixture;
    const executable = join(stateHome, "openshell-cli.fixture");
    const executableBytes = "controlled OpenShell session fixture CLI\n";
    writeFileSync(executable, executableBytes, { mode: 0o700 });
    let sandboxExists = false;
    let sandboxId = randomUUID();
    let sandboxPhase: "Ready" | "Stopped" = "Ready";
    observedSandboxPhase = sandboxPhase;
    let containerId = "d".repeat(64);
    fixtureSandboxExists = sandboxExists;
    fixtureSandboxPhase = sandboxPhase;
    fixtureSandboxContainerId = containerId;
    const supervisorContainerId = "c".repeat(64);
    const imageId = `sha256:${"e".repeat(64)}`;
    let currentImageDigest = imageDigest;
    let currentDocument: any = structuredClone(qualificationDocument);
    let currentProvisioning: Record<string, string> = {};
    let currentWorkdir = qualificationProbeFixture.filesystem.workdirPath;
    let currentResource = { NanoCpus: 0, Memory: 0, MemorySwap: 0, PidsLimit: 128,
      StorageOpt: { size: `${policyFixture().resources.diskBytes}B` } };
    let policyRevision = 1;
    let configRevision = 1;
    const scopeNow = () => ({ companyId, bindingId: binding.id, cellId: cell.id,
      cellGeneration: cell.generation.toString(), sandboxRef: binding.sandboxRef ?? `aw-v7-${binding.id}` });
    const labelsNow = () => ({
      "openshell.ai/managed-by": "openshell", "openshell.ai/sandbox-id": sandboxId,
      "openshell.ai/sandbox-name": scopeNow().sandboxRef, "openshell.ai/sandbox-namespace": "fixture-namespace",
      "openshell.ai/sandbox-workspace": "fixture-company", "openshell.ai/workspace-root": currentWorkdir,
      "openshell.ai/isolation-backend": "openshell-sandbox", "openshell.ai/isolation-role": "sandbox",
      "aw.company_id": companyId, "aw.binding_id": binding.id, "aw.cell_id": cell.id,
      "aw.generation": cell.generation.toString(), ...currentProvisioning,
    });
    const dockerContainer = (role: "sandbox" | "supervisor") => role === "supervisor" ? ({
      Id: supervisorContainerId, Image: imageId, Config: { Image: imageId, Labels: {
        "openshell.ai/managed-by": "openshell", "openshell.ai/sandbox-id": sandboxId,
        "openshell.ai/sandbox-name": scopeNow().sandboxRef, "openshell.ai/sandbox-namespace": "fixture-namespace",
        "openshell.ai/isolation-role": "supervisor",
      } }, HostConfig: { LogConfig: { Type: "none", Config: {} } },
    }) : ({
      Id: containerId, Image: imageId,
      Config: { Image: currentImageDigest, User: `${currentDocument.process?.run_as_user ?? "1000"}:${currentDocument.process?.run_as_group ?? "1000"}`,
        WorkingDir: currentWorkdir, Env: [], Labels: labelsNow() },
      GraphDriver: { Name: "overlay2", Data: { UpperDir: overlayUpperDir, MergedDir: overlayMergedDir } },
      HostConfig: { ...currentResource, LogConfig: { Type: "none", Config: {} },
        Tmpfs: { "/run/openshell-supervisor-ca/material": "rw,noexec,nosuid,nodev,size=1m,uid=1000,gid=1000,mode=0755" } },
      Mounts: [
        { Type: "volume", Name: `openshell-channel-${createHash("sha256").update(`fixture-namespace\0${sandboxId}`).digest("hex").slice(0, 32)}`,
          Driver: "local", Destination: "/.openshell/channel", RW: true },
        { Type: "tmpfs", Destination: "/run/openshell-supervisor-ca/material",
          Mode: "rw,noexec,nosuid,nodev,size=1m,uid=1000,gid=1000,mode=0755", RW: true },
      ], State: { Running: sandboxPhase === "Ready" },
    });
    http.request = ((...requestArgs: any[]) => {
      const first = requestArgs[0];
      const options = first && typeof first === "object" && !(first instanceof URL) ? first : requestArgs[1];
      const callback = requestArgs.slice(1).find(value => typeof value === "function") as ((response: any) => void) | undefined;
      if (options?.socketPath !== "/var/run/docker.sock" || options.method !== "HEAD")
        return Reflect.apply(dockerHttpRequestBeforeFixture, http, requestArgs as any);
      const request = new EventEmitter() as any;
      request.end = () => {
        const url = new URL(String(options.path), "http://docker");
        const segments = url.pathname.split("/"), id = segments[3], targetPath = url.searchParams.get("path");
        let status = segments.length === 5 && /^v1\.[0-9]+$/.test(segments[1] ?? "") &&
          segments[2] === "containers" && segments[4] === "archive" && typeof targetPath === "string" ? 200 : 404;
        if (status === 200 && typeof targetPath === "string" && targetPath !== "/") {
          const knownId = id === containerId || helperContainersById.has(id ?? "");
          if (!knownId) status = 404;
          else if (id === containerId) {
            try { lstatSync(join(overlayUpperDir, targetPath.slice(1))); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") status = 404; else status = 500; }
          } else status = 404;
        } else if (status === 200 && id !== containerId && !helperContainersById.has(id ?? "")) status = 404;
        httpArchiveObservations.push({ root: targetPath === "/", originalContainer: id === containerId, status });
        const response = new PassThrough() as any; response.statusCode = status;
        callback?.(response); response.end(); request.emit("close");
      };
      request.destroy = (error?: Error) => { if (error) request.emit("error", error); request.emit("close"); };
      return request;
    }) as typeof http.request;

    // Exercise both ordinary Node HTTP overloads through the fixture override.
    // A local server keeps this regression independent of external networking.
    const passthroughServer = createServer((_request, response) => {
      response.statusCode = 200;
      response.end("fixture-http-passthrough");
    });
    await new Promise<void>((resolve, reject) => {
      passthroughServer.once("error", reject);
      passthroughServer.listen(0, "127.0.0.1", () => resolve());
    });
    const address = passthroughServer.address();
    if (!address || typeof address === "string") throw new Error("fixture_http_passthrough_address_unavailable");
    const requestRoundTrip = (start: (callback: (response: any) => void) => any) => new Promise<string>((resolve, reject) => {
      const outgoing = start(response => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          try {
            assert.equal(response.statusCode, 200);
            resolve(Buffer.concat(chunks).toString("utf8"));
          } catch (error) { reject(error); }
        });
      });
      outgoing.once("error", reject);
      outgoing.end();
    });
    try {
      const byUrlAndOptions = await requestRoundTrip(callback => http.request(
        new URL(`http://127.0.0.1:${address.port}/url-options`), { method: "GET" }, callback));
      const byOptions = await requestRoundTrip(callback => http.request({ hostname: "127.0.0.1", port: address.port,
        path: "/options", method: "GET" }, callback));
      assert.equal(byUrlAndOptions, "fixture-http-passthrough");
      assert.equal(byOptions, "fixture-http-passthrough");
    } finally {
      await new Promise<void>((resolve, reject) => passthroughServer.close(error => error ? reject(error) : resolve()));
    }

    const hostRunImpl = async (file: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      if (file === "docker") {
        if (args[0] === "info" && args.includes("{{.ID}}")) return { stdout: "fixture-docker-engine\n", stderr: "" };
        if (args[0] === "info" && args.includes("{{.DockerRootDir}}")) return { stdout: `${dockerRoot}\n`, stderr: "" };
        if (args[0] === "info" && args.includes("{{.Driver}}")) return { stdout: "overlay2\n", stderr: "" };
        if (args[0] === "info" && args.includes("{{json .DriverStatus}}"))
          return { stdout: JSON.stringify([["Backing Filesystem", "xfs"]]), stderr: "" };
        if (args[0] === "info" && args.includes("{{.KernelVersion}}")) return { stdout: "fixture-kernel\n", stderr: "" };
        if (args[0] === "version" && args[2] === "{{.Server.APIVersion}}") return { stdout: "1.45\n", stderr: "" };
        if (args[0] === "image" && args[1] === "inspect") {
          const image = args[2];
          if (image === hostImageId) return { stdout: JSON.stringify([{ Id: hostImageId, RepoDigests: [hostImageRef] }]), stderr: "" };
          if (image === imageId) return { stdout: JSON.stringify([{ Id: imageId, RepoDigests: [currentImageDigest] }]), stderr: "" };
          throw new Error("fixture_unknown_image_inspect");
        }
        if (args[0] === "ps" && args.includes("-aq")) {
          const nameFilter = args.find(value => String(value).startsWith("name=^/"));
          const idFilter = args.find(value => String(value).startsWith("id="));
          if (nameFilter) {
            const filter = String(nameFilter);
            if (!/^name=\^\/[A-Za-z0-9_.-]{1,128}\$$/.test(filter)) throw new Error("fixture_invalid_helper_name_filter");
            const name = filter.slice("name=^/".length, -1);
            const helper = helperContainersByName.get(name);
            return { stdout: helper ? `${helper.Id}\n` : "", stderr: "" };
          }
          if (idFilter) { const id = String(idFilter).slice(3);
            return { stdout: helperContainersById.has(id) ? `${id}\n` : "", stderr: "" }; }
          const role = args.find(value => value.includes("label=openshell.ai/isolation-role="))?.split("=").at(-1);
          if (!sandboxExists) return { stdout: "", stderr: "" };
          return { stdout: role === "supervisor" ? `${supervisorContainerId}\n` : `${containerId}\n`, stderr: "" };
        }
        if (args[0] === "inspect" && args[1] === "aw-runtime-host") return { stdout: JSON.stringify([{
          Id: hostContainerId, Image: hostImageId, Config: { Image: hostImageRef }, State: { Running: true } }]), stderr: "" };
        if (args[0] === "inspect" && helperContainersById.has(args[1] ?? ""))
          return { stdout: JSON.stringify([helperContainersById.get(args[1]!)]), stderr: "" };
        if (args[0] === "inspect") return { stdout: JSON.stringify([dockerContainer(
          args[1] === supervisorContainerId ? "supervisor" : "sandbox")]), stderr: "" };
        if (args[0] === "create" && args.includes("--name")) {
          const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
          const name = option("--name")!;
          if (!name.startsWith("aw-native-lower-") && !name.startsWith("aw-native-proof-") && !name.startsWith("aw-native-erase-") &&
              !name.startsWith("aw-native-attachments-erase-"))
            throw new Error("fixture_unexpected_cleanup_helper");
          const id = createHash("sha256").update(`native-session-erasure:${name}`).digest("hex");
          const entrypointIndex = args.indexOf("--entrypoint");
          const imageIndex = entrypointIndex >= 0 ? entrypointIndex + 2 : args.length - 1;
          const image = args[imageIndex]!;
          const config = { Image: image, User: option("--user") ?? "1000:1000", Env: [],
            Labels: { "aw.native_session_erasure": "true", "aw.native_session_erasure_name": name },
            ...(entrypointIndex >= 0 ? { Entrypoint: [args[entrypointIndex + 1]!] } : {}),
            Cmd: args.slice(imageIndex + 1) };
          const mounts: any[] = [];
          for (let index = 0; index < args.length; index++) if (args[index] === "--mount") {
            const optionMap = Object.fromEntries(args[index + 1]!.split(",").map(piece => {
              const equal = piece.indexOf("="); return equal < 0 ? [piece, true] : [piece.slice(0, equal), piece.slice(equal + 1)];
            }));
            mounts.push({ Type: optionMap.type, Source: optionMap.src, Destination: optionMap.dst, RW: optionMap.readonly !== true });
          }
          const info: any = { Id: id, Name: `/${name}`, Image: image, Config: config, Mounts: mounts,
            HostConfig: { NetworkMode: option("--network"), ReadonlyRootfs: args.includes("--read-only"),
              Privileged: false, CapAdd: [], CapDrop: args.includes("--cap-drop") ? [option("--cap-drop")] : [],
              Devices: [], SecurityOpt: args.includes("--security-opt") ? [option("--security-opt")] : [],
              PidsLimit: Number(option("--pids-limit") ?? 16), Memory: Number(option("--memory") ?? 67_108_864),
              MemorySwap: Number(option("--memory-swap") ?? 67_108_864), CpuPeriod: Number(option("--cpu-period") ?? 100_000),
              CpuQuota: Number(option("--cpu-quota") ?? 25_000), UsernsMode: "" },
            State: { Status: "created", Running: false, ExitCode: null } };
          helperContainersByName.set(name, info); helperContainersById.set(id, info);
          return { stdout: `${id}\n`, stderr: "" };
        }
        if (args[0] === "start" && helperContainersById.has(args[1] ?? "")) {
          const info = helperContainersById.get(args[1]!)!; info.State = { Status: "running", Running: true, ExitCode: null };
          if (info.Config.Cmd[0] === "-e") {
            const proof = info.Mounts.find((mount: any) => mount.Destination === "/proof")?.Source;
            const sessions = info.Mounts.find((mount: any) => mount.Destination === "/sessions")?.Source;
            const attachments = info.Mounts.find((mount: any) => mount.Destination === "/attachments")?.Source;
            const name = info.Config.Labels["aw.native_session_erasure_name"];
            const mountInfoFile = join(hostRoot, `${name}.mountinfo`);
            const mountRows = ["36 25 0:32 / /proof rw - bind fixture rw"];
            if (sessions) mountRows.push("37 25 0:33 / /sessions rw - bind fixture rw");
            if (attachments) mountRows.push("38 25 0:34 / /attachments rw - bind fixture rw");
            writeFileSync(mountInfoFile, `${mountRows.join("\n")}\n`);
            const unusedSessions = join(hostRoot, "unused-sessions");
            const rawScript = info.Config.Cmd[1];
            let script = rawScript === NATIVE_SESSION_UPPER_ERASE_SCRIPT ? NATIVE_SESSION_UPPER_ERASE_SCRIPT :
              rawScript === NATIVE_ATTACHMENT_STAGE_ERASE_SCRIPT ? NATIVE_ATTACHMENT_STAGE_ERASE_SCRIPT : null;
            if (!script) throw new Error("fixture_unknown_native_erasure_script");
            script = script
              .replace('fs.openSync("/proof",', `fs.openSync(${JSON.stringify(proof)},`)
              .replace('fs.openSync("/sessions",', `fs.openSync(${JSON.stringify(sessions ?? unusedSessions)},`)
              .replace('fs.openSync("/attachments",', `fs.openSync(${JSON.stringify(attachments ?? join(hostRoot, "unused-attachments"))},`)
              .replace('fs.readFileSync("/proc/self/mountinfo",', `fs.readFileSync(${JSON.stringify(mountInfoFile)},`);
            const result = spawnSync(process.execPath, ["-e", script, ...info.Config.Cmd.slice(2)],
              { encoding: "utf8", timeout: 10_000 });
            info.stdout = result.stdout ?? ""; info.stderr = result.stderr ?? "";
            info.State = { Status: "exited", Running: false, ExitCode: result.status ?? 1, FinishedAt: new Date().toISOString() };
          }
          return { stdout: "", stderr: "" };
        }
        if (args[0] === "wait" && helperContainersById.has(args[1] ?? ""))
          return { stdout: `${helperContainersById.get(args[1]!)?.State?.ExitCode ?? 0}\n`, stderr: "" };
        if (args[0] === "logs" && helperContainersById.has(args.at(-1) ?? ""))
          return { stdout: helperContainersById.get(args.at(-1)!)?.stdout ?? "", stderr: "" };
        if (args[0] === "rm" && helperContainersById.has(args.at(-1) ?? "")) {
          const info = helperContainersById.get(args.at(-1)!)!; helperContainersById.delete(info.Id); helperContainersByName.delete(info.Name.slice(1));
          return { stdout: "", stderr: "" };
        }
        if (args[0] === "kill" && helperContainersById.has(args[1] ?? "")) {
          const info = helperContainersById.get(args[1]!)!; info.State = { Status: "exited", Running: false, ExitCode: 137, FinishedAt: new Date().toISOString() };
          return { stdout: "", stderr: "" };
        }
        if (args[0] === "update") {
          const option = (name: string) => args[args.indexOf(name) + 1];
          currentResource = { ...currentResource, NanoCpus: Math.round(Number(option("--cpus")) * 1e9),
            Memory: Number(option("--memory")), MemorySwap: Number(option("--memory-swap")), PidsLimit: Number(option("--pids-limit")) };
          return { stdout: "fixture update\n", stderr: "" };
        }
        if (args[0] === "exec") {
          const operation = args.slice(4).join(" ");
          if (operation.includes("/sys/fs/cgroup/cpu.max")) return { stdout: "100000 100000\n", stderr: "" };
          if (operation.includes("/sys/fs/cgroup/memory.max")) return { stdout: `${currentResource.Memory}\n`, stderr: "" };
          if (operation.includes("/sys/fs/cgroup/memory.swap.max")) return { stdout: `${currentResource.MemorySwap}\n`, stderr: "" };
          if (operation.includes("/sys/fs/cgroup/pids.max")) return { stdout: `${currentResource.PidsLimit}\n`, stderr: "" };
          if (operation.includes("/sys/fs/cgroup/memory.oom.group")) return { stdout: "0\n", stderr: "" };
          if (operation.includes("/usr/bin/stat")) return { stdout: "regular file:444\n", stderr: "" };
          if (operation.includes("/usr/bin/head")) return { stdout: "a", stderr: "" };
          if (operation.includes("/usr/bin/test")) return { stdout: "", stderr: "" };
          return { stdout: "", stderr: "" };
        }
        if (args[0] === "cp") {
          const destination = args.at(-1);
          if (typeof destination === "string") writeFileSync(destination, "fixture pinned runtime binary\\n", { mode: 0o600 });
          return { stdout: "", stderr: "" };
        }
        throw new Error(`fixture_docker_command_${args[0] ?? "missing"}`);
      }
      const command = args.slice(4);
      const operation = command[0] ?? "unknown";
      const isNamedOperation = ["sandbox", "profile", "policy", "provider"].includes(operation);
      const safeOperation = file === "docker" ? "docker:" + operation :
        operation + (isNamedOperation ? ":" + (command[1] ?? "unknown") : "");
      hostCliOperations.push(safeOperation);
      if (hostCliOperations.length > 96) hostCliOperations.shift();
      if (command[0] === "--version") return { stdout: "openshell 0.1.2\n", stderr: "" };
      if (command[0] === "profile" && command[1] === "describe") {
        const profile = command[2] === qualificationProviderProfile.id ? qualificationProviderProfile
          : command[2] === hostCredentialProfile.id ? hostCredentialProfile
            : command[2] === hostModelProfile.id ? hostModelProfile : {};
        return { stdout: JSON.stringify(profile), stderr: "" };
      }
      if (command[0] === "sandbox" && command[1] === "list") return { stdout: JSON.stringify({
        sandboxes: sandboxExists ? [{ id: sandboxId, name: scopeNow().sandboxRef, workspace: "fixture-company", labels: {
          "aw.company_id": companyId, "aw.binding_id": binding.id, "aw.cell_id": cell.id,
          "aw.generation": cell.generation.toString(), ...currentProvisioning,
        } }] : [], next_page_token: "" }), stderr: "" };
      if (command[0] === "sandbox" && command[1] === "get") {
        if (!sandboxExists) throw new Error("sandbox not found");
        return { stdout: JSON.stringify({
          id: sandboxId, name: scopeNow().sandboxRef, workspace: "fixture-company", phase: sandboxPhase,
          labels: { "aw.company_id": companyId, "aw.binding_id": binding.id, "aw.cell_id": cell.id,
            "aw.generation": cell.generation.toString(), ...currentProvisioning },
        }), stderr: "" };
      }
      if (command[0] === "sandbox" && command[1] === "create") {
        const option = (name: string) => command[command.indexOf(name) + 1];
        sandboxId = randomUUID(); containerId = createHash("sha256").update(`fixture:${sandboxId}`).digest("hex");
        currentImageDigest = option("--from");
        const policyPath = option("--policy"); currentDocument = JSON.parse(readFileSync(policyPath, "utf8"));
        const resources = JSON.parse(option("--driver-config-json")).docker;
        currentResource = { NanoCpus: Math.round(Number(option("--cpu").slice(0, -1)) * 1e6),
          Memory: Number(option("--memory")), MemorySwap: Number(option("--memory")),
          PidsLimit: Number(resources.pids_limit), StorageOpt: { size: `${resources.disk_limit_bytes}B` } };
        currentProvisioning = Object.fromEntries(command.flatMap((value, index) => value === "--label"
          ? [command[index + 1].split(/=(.*)/s).slice(0, 2)] : []));
        sandboxExists = true;
        fixtureSandboxExists = true;
        fixtureSandboxContainerId = containerId;
        currentWorkdir = currentDocument?.filesystem_policy?.read_write?.[0] ?? qualificationProbeFixture.filesystem.workdirPath;
        sandboxPhase = "Ready"; observedSandboxPhase = sandboxPhase;
        return { stdout: "{}", stderr: "" };
      }
      if (command[0] === "sandbox" && command[1] === "start") { sandboxPhase = "Ready"; observedSandboxPhase = sandboxPhase; fixtureSandboxPhase = sandboxPhase; return { stdout: "Started", stderr: "" }; }
      if (command[0] === "sandbox" && command[1] === "stop") { sandboxPhase = "Stopped"; observedSandboxPhase = sandboxPhase; fixtureSandboxPhase = sandboxPhase; return { stdout: "Stopped", stderr: "" }; }
      if (command[0] === "sandbox" && command[1] === "delete") { sandboxPhase = "Stopped"; observedSandboxPhase = sandboxPhase; fixtureSandboxPhase = sandboxPhase; sandboxExists = false; fixtureSandboxExists = false; return { stdout: "Deleted", stderr: "" }; }
      if (command[0] === "policy" && command[1] === "get") {
        const hash = nativeSha256(currentDocument);
        actualCliPolicyObservation = { bindingId: binding.id, sandboxId, containerId,
          document: structuredClone(currentDocument), hash };
        return { stdout: JSON.stringify({ sandbox: scopeNow().sandboxRef,
          status: "effective", version: policyRevision, config_revision: configRevision,
          hash, policy: currentDocument }), stderr: "" };
      }
      if (command[0] === "policy" && command[1] === "set") {
        currentDocument = JSON.parse(readFileSync(command[command.indexOf("--policy") + 1], "utf8"));
        configRevision += 1; return { stdout: "Policy updated", stderr: "" };
      }
      if (command[0] === "provider" && command[1] === "create") {
        const name = command[command.indexOf("--name") + 1], type = command[command.indexOf("--type") + 1];
        const env = command[command.indexOf("--credential") + 1];
        const credential = options.env?.[env] ?? null;
        const family = credential ? (verifyRuntimeToolsToken(credential, "worker_model") ? "worker_model" :
          verifyRuntimeToolsToken(credential, "conversation_model") ? "conversation_model" : null) : null;
        sessionProviders.set(name, { type, credential, expiresAt: null, family });
        return { stdout: "provider created", stderr: "" };
      }
      if (command[0] === "provider" && command[1] === "update") {
        const provider = sessionProviders.get(command[2]);
        const credentialArg = command.indexOf("--credential");
        const env = credentialArg >= 0 ? command[credentialArg + 1] : null;
        const expiryArg = command.indexOf("--credential-expires-at");
        const expiry = expiryArg >= 0 ? command[expiryArg + 1].slice(command[expiryArg + 1].indexOf("=") + 1) : null;
        if (provider) {
          if (env) provider.credential = options.env?.[env] ?? provider.credential;
          if (expiry) provider.expiresAt = expiry;
          sessionProviders.set(command[2], provider);
        }
        return { stdout: JSON.stringify(provider ?? {}), stderr: "" };
      }
      if (command[0] === "provider" && command[1] === "list") return { stdout: JSON.stringify({
        providers: [...sessionProviders.entries()].map(([name, provider]) => ({ name, type: provider.type,
          credential_expires_at: provider.expiresAt })), next_page_token: "" }), stderr: "" };
      if (command[0] === "provider" && command[1] === "delete") {
        sessionProviders.delete(command[2]); return { stdout: "provider deleted", stderr: "" };
      }
      if (command[0] === "sandbox" && command[1] === "provider" && command[2] === "attach") {
        attachedSessionProviders.add(command[4]); return { stdout: "{}", stderr: "" };
      }
      if (command[0] === "sandbox" && command[1] === "provider" && command[2] === "detach") {
        attachedSessionProviders.delete(command[4]);
        return { stdout: "{}", stderr: "" };
      }
      if (command[0] === "sandbox" && command[1] === "provider" && command[2] === "list")
        return { stdout: JSON.stringify({ providers: [...attachedSessionProviders].map(name => ({ name })), next_page_token: "" }), stderr: "" };
      if (command[0] === "sandbox" && command[1] === "exec") {
        const workload = command.slice(command.indexOf("--") + 1);
        if (workload[0] === "/.openshell/runtime/openshell-sandbox" && workload[1] === "runtime-seccomp-probe")
          return { stdout: JSON.stringify({version:1,profile:"openshell-linux-built-in-seccomp-v1",getpid:"allowed",
            memfd_create:"denied",denied_errno:"EPERM"}), stderr: "" };
        return { stdout: "", stderr: "" };
      }
      throw new Error(`fixture_openshell_command_${command.slice(0, 2).join("_")}`);
    };
    const safeHostOperation = (file: string, args: string[]) => {
      const command = file === "docker" ? args : args.slice(4);
      const operation = command[0] ?? "unknown";
      if (file === "docker") return new Set(["info", "version", "image", "ps", "inspect", "create", "start", "wait", "logs", "rm", "kill", "update", "exec", "cp"]).has(operation)
        ? `docker:${operation}` : "docker:other";
      const named = new Set(["sandbox:list", "sandbox:get", "sandbox:create", "sandbox:start", "sandbox:stop", "sandbox:delete",
        "profile:describe", "policy:get", "policy:set", "provider:list", "provider:get", "provider:create", "provider:delete"]);
      const label = `${operation}:${command[1] ?? ""}`;
      return named.has(label) ? label : new Set(["--version", "version"]).has(operation) ? "version" : "other";
    };
    const hostRun = async (file: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      const id = ++nextHostOperationId;
      activeHostOperations.set(id, { operation: safeHostOperation(file, args), startedAtMs: Date.now() });
      try { return await hostRunImpl(file, args, options); }
      finally { activeHostOperations.delete(id); }
    };
    const spawnSandboxWorkload = (_file: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string;
      stdio?: unknown; shell?: boolean; windowsHide?: boolean }) => {
      const separator = args.indexOf("--");
      if (separator < 0) throw new Error("fixture_sandbox_exec_separator_missing");
      const cli = args.slice(4, separator);
      const workdirIndex = cli.indexOf("--workdir");
      const cwd = workdirIndex >= 0 ? cli[workdirIndex + 1] : input.root;
      const softwarePath = [...new Set([dirname(fixtureImageNode), "/usr/local/bin", "/usr/bin", "/bin"])].join(":");
      const env: NodeJS.ProcessEnv = { PATH: softwarePath, HOME: providerImageHome ?? input.root };
      for (let index = 0; index < cli.length; index++) {
        if (cli[index] !== "--env") continue;
        const entry = cli[++index];
        if (typeof entry !== "string") throw new Error("fixture_sandbox_exec_env_missing");
        const split = entry.indexOf("=");
        if (split <= 0) throw new Error("fixture_sandbox_exec_env_invalid");
        env[entry.slice(0, split)] = entry.slice(split + 1);
      }
      const workload = args.slice(separator + 1);
      const requestedExecutable = workload[0];
      if (typeof requestedExecutable !== "string" || !requestedExecutable) throw new Error("fixture_sandbox_exec_argv_invalid");
      const fixtureExecutables: Record<string, string> = { sh: "/bin/sh", node: process.execPath,
        base64: "/usr/bin/base64", rm: "/usr/bin/rm" };
      const executable = fixtureExecutables[requestedExecutable] ?? requestedExecutable;
      if (!posix.isAbsolute(executable)) throw new Error("fixture_sandbox_exec_argv_invalid");
      // This adapter executes in the local software image. Resolve its actual
      // cwd and matching policy roots here; this is not remote/physical proof.
      if (!Array.isArray(currentDocument?.filesystem_policy?.read_only) ||
        !Array.isArray(currentDocument?.filesystem_policy?.read_write))
        throw new Error("fixture_sandbox_cwd_policy_invalid");
      const canonicalCwd = realpathSync(cwd);
      const filesystemRoots = [...(currentDocument?.filesystem_policy?.read_only ?? []),
        ...(currentDocument?.filesystem_policy?.read_write ?? [])];
      const canonicalCwdAllowed = filesystemRoots.some((root: unknown) => {
        if (typeof root !== "string" || !posix.isAbsolute(root)) return false;
        const lexicalRelative = posix.relative(posix.normalize(root), posix.normalize(cwd));
        if (lexicalRelative === ".." || lexicalRelative.startsWith("../") || posix.isAbsolute(lexicalRelative)) return false;
        try {
          const canonicalRoot = realpathSync(root);
          const relative = posix.relative(canonicalRoot, canonicalCwd);
          return relative === "" || (relative !== ".." && !relative.startsWith("../") && !posix.isAbsolute(relative));
        } catch { return false; }
      });
      if (!canonicalCwdAllowed || !statSync(canonicalCwd).isDirectory())
        throw new Error("fixture_sandbox_cwd_outside_policy");
      // The production Host has already authorized argv. This software-only
      // adapter resolves the image's shell and Node from the trusted fixture
      // image, while the Host journal owns provider credentials and attachment.
      activateModelOrigin();
      return spawn(executable, workload.slice(1), { cwd: canonicalCwd, env, shell: false, windowsHide: true,
        stdio: options.stdio as ["pipe", "pipe", "pipe"] });
    };
    sessionHostEngine = openShellHostEngine({ config: { executable,
      executableSha256: createHash("sha256").update(executableBytes).digest("hex"), stateHome,
      gateway: "fixture-gateway", workspace: "fixture-company", qualificationFixtures: qualificationProbeFixture,
      runtimeBrokerProfiles },
      epoch: 1, root: hostRoot, run: hostRun, spawnProcess: spawnSandboxWorkload, hostProcRoot });
    const { fixtureHash: expectedFixtureHash, ...fixtureBody } = qualificationProbeFixture;
    assert.equal(expectedFixtureHash, nativeSha256(fixtureBody), "Host and credential echo qualification fixture must share the exact source hash");
    await sessionHostEngine.initialize();
    const originalExecuteStream = sessionHostEngine.executeStream.bind(sessionHostEngine);
    sessionHostEngine.executeStream = async (hostInput: any, onOutput: any, signal?: AbortSignal) => {
      const runtimeExecuteStreamId = ++nextRuntimeExecuteStreamId;
      let runtimeExecuteStreamStarted = false;
      try {
        const artifactPin = serialTransport && hostInput?.request?.modelBrokerSession?.phase === "start"
          ? await captureOriginalStartArtifact(hostInput) : undefined;
        activeRuntimeExecuteStreams.set(runtimeExecuteStreamId, Date.now());
        runtimeExecuteStreamStarted = true;
        return await verifiedSpawnScope.run({ ...hostInput, artifactPin }, () => originalExecuteStream(hostInput, onOutput, signal));
      } catch (error) {
        const request = hostInput?.request;
        const requestId = typeof request?.requestId === "string" ? request.requestId : null;
        const sentinelNames = new Set(["exec_rejected", "exec_timeout", "exec_unknown", "sandbox_host_unavailable",
          "sandbox_observation_unavailable", "sandbox_operation_unsupported", "sandbox_restart_observation_failed",
          "sandbox_scope_changed", "sandbox_stop_observation_failed"]);
        const rawSentinel = error instanceof Error ? error.message : "";
        const sentinel = sentinelNames.has(rawSentinel) ? rawSentinel : "unclassified_host_error";
        const rawErrorType = error && typeof error === "object" && "name" in error ? String(error.name) : "";
        const errorType = (["Error", "TypeError", "RangeError", "AbortError"] as const)
          .find(name => name === rawErrorType) ?? "Other";
        const deadline = typeof request?.deadlineAt === "string" ? Date.parse(request.deadlineAt) : Number.NaN;
        const remaining = Number.isFinite(deadline) ? deadline - Date.now() : null;
        const phaseValue = request?.modelBrokerSession?.phase;
        const phase = phaseValue === "start" || phaseValue === "refresh" || phaseValue === "stop" ? phaseValue : null;
        const argv = Array.isArray(request?.argv) ? request.argv : [];
        const sourceFrames = (error instanceof Error && typeof error.stack === "string" ? error.stack.split("\n") : [])
          .flatMap(frame => {
            const match = /openshell\.mjs:(\d+):\d+\)?$/.exec(frame.trim());
            return match ? [{ source: "openshell.mjs" as const, line: Number(match[1]) }] : [];
          }).filter(frame => Number.isSafeInteger(frame.line) && frame.line > 0).slice(0, 8);
        let refreshCredentialFacts: Record<string, boolean | number | string | null> | undefined;
        if (phase === "refresh") {
          const broker = request?.modelBrokerCredential;
          const descriptor = request?.modelBrokerSession;
          let claims: Record<string, any> | null = null;
          if (typeof broker?.capabilityToken === "string" && broker.capabilityToken.length <= 16_384) {
            try {
              claims = JSON.parse(Buffer.from(broker.capabilityToken.split(".")[1] ?? "", "base64url").toString("utf8"));
            } catch { claims = null; }
          }
          let hostJournal: any = null;
          if (sessionHostJournalFile) {
            try { hostJournal = JSON.parse(readFileSync(sessionHostJournalFile, "utf8")); } catch { hostJournal = null; }
          }
          const sessionEntry = typeof descriptor?.sessionKey === "string"
            ? hostJournal?.modelBrokerSessions?.[descriptor.sessionKey] : null;
          const credentialExpiry = typeof broker?.expiresAt === "string" ? Date.parse(broker.expiresAt) : Number.NaN;
          const sessionDeadline = typeof descriptor?.sessionDeadlineAt === "string" ? Date.parse(descriptor.sessionDeadlineAt) : Number.NaN;
          const activeExpiry = sessionEntry && typeof sessionEntry.expiresAt === "string" ? Date.parse(sessionEntry.expiresAt) : Number.NaN;
          const expiryRelation = Number.isFinite(credentialExpiry) && Number.isFinite(activeExpiry)
            ? credentialExpiry === activeExpiry ? "equal" : credentialExpiry < activeExpiry ? "earlier" : "later" : "unknown";
          let authority: Record<string, unknown> | null = null;
          let familyValid = false;
          if (claims?.scope === "worker_model" && claims.worker_model && !claims.conversation_model) {
            const b = claims.worker_model;
            familyValid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(b.planId ?? "") &&
              /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(b.workerId ?? "") &&
              /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(b.workerAttemptId ?? "") && b.executionManifestId === request?.manifestId &&
              Number.isSafeInteger(b.expectedPlanVersion) && b.expectedPlanVersion >= 1;
            if (familyValid) authority = { scope: claims.scope, sub: claims.sub, company_id: claims.company_id,
              run_id: claims.run_id, responsible_user_id: claims.responsible_user_id, instance_id: claims.instance_id, worker_model: b };
          } else if (claims?.scope === "conversation_model" && claims.conversation_model && !claims.worker_model) {
            const b = claims.conversation_model;
            familyValid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(b.issueId ?? "") && Number.isSafeInteger(b.conversationSessionGeneration) &&
              b.conversationSessionGeneration >= 0 && b.executionManifestId === request?.manifestId &&
              b.executionManifestHash === request?.manifestHash;
            if (familyValid) authority = { scope: claims.scope, sub: claims.sub, company_id: claims.company_id,
              run_id: claims.run_id, responsible_user_id: claims.responsible_user_id, instance_id: claims.instance_id, conversation_model: b };
          }
          const tokenIat = claims?.iat;
          const tokenExp = claims?.exp;
          const tokenTimesValid = claims !== null && Number.isSafeInteger(tokenIat) && Number.isSafeInteger(tokenExp) &&
            tokenExp > tokenIat && tokenExp - tokenIat <= 300;
          const claimIdentityMatches = typeof claims?.sub === "string" && claims.sub.length > 0 &&
            typeof claims?.responsible_user_id === "string" && claims.responsible_user_id.length > 0 &&
            claims?.company_id === hostInput?.scope?.companyId && claims?.run_id === request?.runId;
          const tokenExpiryCoversCredential = claims !== null && Number.isFinite(credentialExpiry) &&
            Number.isSafeInteger(tokenExp) && tokenExp * 1000 >= credentialExpiry;
          const credentialExpiryWithinSession = Number.isFinite(credentialExpiry) && Number.isFinite(sessionDeadline) &&
            credentialExpiry > Date.now() && credentialExpiry <= sessionDeadline;
          const boundsValid = Number.isSafeInteger(broker?.inputTokensUpperBound) && broker.inputTokensUpperBound >= 1 &&
            broker.inputTokensUpperBound <= 2_000_000 && Number.isSafeInteger(broker?.maxOutputTokens) &&
            broker.maxOutputTokens >= 256 && broker.maxOutputTokens <= 8192;
          let requestBindingMatches = false;
          if (descriptor && hostInput?.scope && request) {
            const binding = { companyId: hostInput.scope.companyId, runId: request.runId, attemptId: request.attemptId,
              attempt: request.attempt, bindingId: request.bindingId, cellId: hostInput.scope.cellId,
              generation: hostInput.scope.cellGeneration, hostEpoch: request.hostEpoch, manifestId: request.manifestId,
              manifestHash: request.manifestHash, policySnapshotId: request.policySnapshotId, policyHash: request.policyHash,
              sessionKey: descriptor.sessionKey, nativeSessionIdDigest: descriptor.nativeSessionIdDigest,
              runnerInstanceId: descriptor.runnerInstanceId, leaseId: descriptor.leaseId,
              sessionDeadlineAt: descriptor.sessionDeadlineAt };
            try { requestBindingMatches = Boolean(sessionEntry?.binding) && nativeSha256(binding) === nativeSha256(sessionEntry.binding); }
            catch { requestBindingMatches = false; }
          }
          let authorityMatchesEntry = false;
          if (authority && typeof sessionEntry?.authorityHash === "string") {
            try { authorityMatchesEntry = nativeSha256(authority) === sessionEntry.authorityHash; }
            catch { authorityMatchesEntry = false; }
          }
          const activeExpiryRemainingMs = Number.isFinite(activeExpiry) ? Math.trunc(activeExpiry - Date.now()) : null;
          refreshCredentialFacts = {
            credentialPresent: Boolean(broker && typeof broker.capabilityToken === "string"),
            tokenParsed: claims !== null, tokenFamilyValid: familyValid, claimIdentityMatches,
            tokenTimesValid, tokenUnexpired: claims !== null && Number.isSafeInteger(tokenExp) && tokenExp * 1000 > Date.now(),
            tokenExpiryCoversCredential, credentialExpiryFutureWithinSession: credentialExpiryWithinSession,
            boundsValid,
            sessionEntryPresent: Boolean(sessionEntry), sessionEntryActive: sessionEntry?.state === "active",
            sessionEntryUpdating: sessionEntry?.state === "updating", nextCapabilityHashPresent: typeof sessionEntry?.nextCapabilityHash === "string",
            expectedCapabilityHashMatches: typeof descriptor?.expectedCapabilityHash === "string" &&
              descriptor.expectedCapabilityHash === sessionEntry?.capabilityHash,
            requestBindingMatches, authorityMatchesEntry,
            profileMatchesEntry: Boolean(broker && sessionEntry) && broker?.profileId === sessionEntry?.profileId &&
              broker?.profileHash === sessionEntry?.profileHash,
            inputBoundsMatchEntry: Boolean(broker && sessionEntry) &&
              broker?.inputTokensUpperBound === sessionEntry?.inputTokensUpperBound && broker?.maxOutputTokens === sessionEntry?.maxOutputTokens,
            descriptorDeadlineMatchesEntry: descriptor?.sessionDeadlineAt === sessionEntry?.binding?.sessionDeadlineAt,
            expiryRelation, activeExpiryRemainingMs,
          };
        }
        const record = requestId ? hostExecErrorFactByRequestId.get(requestId) : undefined;
        record?.({ sentinel, errorType, signalAborted: signal?.aborted === true,
          deadlineRemainingMs: remaining === null ? null : Math.trunc(remaining), phase,
          monitorLabel: argv[0] === "sh" && argv[1] === "-c" && argv[2] === "paperclip-runner-monitor", sourceFrames,
          ...(refreshCredentialFacts ? { refreshCredentialFacts } : {}) });
        throw error;
      } finally {
        if (runtimeExecuteStreamStarted) activeRuntimeExecuteStreams.delete(runtimeExecuteStreamId);
      }
    };
  };
  const createBindingForRun=async(credentialBinding: typeof runtimeBrokerBinding, exactTaskRoot: string)=>{
    const boundaryPolicy = (() => {
      const boundary = policyFixture(); boundary.riskClass = "C3"; boundary.requiredControls = [...conversationRequiredControls];
      // Each fixture has one server-derived maximum: the chat namespace or
      // the exact ordinary Worker's canonical Agent home. Per-run compilation
      // retains that owner and narrows chat to its exact Task root.
      boundary.filesystem.readPaths = [...new Set([exactTaskRoot, "/.openshell/runtime/openshell-sandbox", ...runtimeBrokerBinaryReadPaths])].sort();
      boundary.filesystem.writePaths = [exactTaskRoot];
      boundary.process.allowedBinaries = []; boundary.process.allowedSyscalls = [];
      boundary.network.destinations = []; boundary.credentials={mode:"brokered",bindings:[credentialBinding]}; return boundary;
    })();
    const [retained] = await db.select().from(runtimeSandboxBindings).where(and(
      eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.runtimeCellId, cell.id),
      eq(runtimeSandboxBindings.cellGeneration, cell.generation.toString()))).limit(1);
    // The broker grant hash includes the Run. Keep the original maximum
    // unchanged; a later credentialless policy cannot exercise that old grant.
    const currentCredentials = policyFixture().credentials;
    const credentiallessReuse = currentCredentials.mode === "none" && currentCredentials.bindings.length === 0 && retained &&
      nativeSha256({ ...retained.boundaryPolicy.credentials,
        bindings: retained.boundaryPolicy.credentials.bindings.map(({ grantVersionHash: _hash, ...binding }) => binding) }) ===
      nativeSha256({ ...boundaryPolicy.credentials,
        bindings: boundaryPolicy.credentials.bindings.map(({ grantVersionHash: _hash, ...binding }) => binding) });
    const comparableBoundary = credentiallessReuse
      ? { ...boundaryPolicy, credentials: retained.boundaryPolicy.credentials } : boundaryPolicy;
    if (retained && (retained.status !== "stopped" || retained.backend !== "openshell" || retained.profile !== "development" ||
        retained.boundaryPolicyHash !== nativeSha256(comparableBoundary) || retained.createdByUserId !== actor.userId))
      throw new Error("scheduler_retained_sandbox_binding_changed");
    binding = retained ?? await service.create(actor, companyId, { runtimeCellId: cell.id,
      expectedCellGeneration: cell.generation.toString(), backend: "openshell", profile: "development", boundaryPolicy });
  const actualIdentity: SandboxIdentity = { ...identity, bindingId: binding.id, sandboxRef: binding.sandboxRef ?? `aw-v7-${binding.id}` };
  await db.update(runtimeCells).set({ providerBindingId }).where(eq(runtimeCells.id, cell.id));
  // Keep the original bridge identity pinned to the durable binding.
  identity.bindingId = binding.id;
  identity.sandboxRef = actualIdentity.sandboxRef;
  await initializeSessionHostEngine();

  };

  let qualificationTargetProbeActive=false;
  const completeHostCommand = async (commandId: string, raw: Parameters<typeof transport.complete>[2], metadata: { action: string; probeCaseId?: string }) => {
    try {
      return await transport.complete(host.id, commandId, raw);
    } catch (error) {
      const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
      const issues = Array.isArray(record.issues) ? record.issues.slice(0, 20).map(issue => {
        const value = issue && typeof issue === "object" ? issue as Record<string, unknown> : {};
        return { code: typeof value.code === "string" ? value.code : "unknown",
          path: Array.isArray(value.path) ? value.path.map(part => typeof part === "string" || typeof part === "number" ? part : "?") : [] };
      }) : [];
      sandboxExecutionFailures.push({ phase: "host_completion_schema", action: metadata.action,
        ...(metadata.probeCaseId ? { probeCaseId: metadata.probeCaseId } : {}), issues });
      throw error;
    }
  };
  const driveHostObservation = { active: false, phase: "idle", currentAction: "none", lastAction: "none",
    claimedCommands: 0, claimPolls: 0, startedAt: 0, lastCommandAt: 0, workSettled: false };
  const safeDriveHostObservation = () => ({ active: driveHostObservation.active,
    phase: ["idle", "claiming", "processing", "waiting", "settled", "rejected", "deadline"].includes(driveHostObservation.phase)
      ? driveHostObservation.phase : "other",
    currentAction: ["none", "capabilities", "prepare", "probe", "inspect", "apply", "start", "prove_policy", "stop", "unknown"].includes(driveHostObservation.currentAction)
      ? driveHostObservation.currentAction : "other",
    lastAction: ["none", "capabilities", "prepare", "probe", "inspect", "apply", "start", "prove_policy", "stop", "unknown"].includes(driveHostObservation.lastAction)
      ? driveHostObservation.lastAction : "other",
    claimedCommands: Math.min(1_000_000, driveHostObservation.claimedCommands),
    claimPolls: Math.min(1_000_000, driveHostObservation.claimPolls),
    elapsedMs: driveHostObservation.startedAt ? Math.min(600_000, Math.max(0, Date.now() - driveHostObservation.startedAt)) : 0,
    lastCommandAgeMs: driveHostObservation.lastCommandAt ? Math.min(600_000, Math.max(0, Date.now() - driveHostObservation.lastCommandAt)) : null,
    workSettled: driveHostObservation.workSettled });
  // This signed peer is a software integration fixture, never physical Host qualification.
  // It uses the pinned prover on unchanged DB-derived documents and does not start Docker.
  const softwareOnlyConformanceProof = async (commandId: string, command: Record<string, any>) => {
    if (command.action !== "prove_policy" || !command.policyProof || !sessionHostJournalFile)
      throw new Error("software_only_host_peer_proof_scope_invalid");
    const proof = command.policyProof as NonNullable<SandboxHostRequest["policyProof"]>;
    if (typeof command.requesterUserId !== "string" || !command.requesterUserId)
      throw new Error("software_only_host_peer_human_requester_missing");
    const requesterUserId = command.requesterUserId;
    if (!binding || command.scope?.companyId !== companyId || command.scope?.bindingId !== binding.id ||
        command.scope?.cellId !== cell.id || command.scope?.cellGeneration !== cell.generation.toString() ||
        command.requesterUserId !== actor.userId || proof.proverSha256 !== "3e80c0d041a7552d57cc338868bc825a6261e21b5f29a7d7527bcc7926d423f1" ||
        !["requested", "effective"].includes(proof.stage) ||
        proof.candidateDocumentHash !== nativeSha256(proof.candidateDocument) ||
        proof.boundaryDocumentHash !== nativeSha256(proof.boundaryDocument))
      throw new Error("software_only_host_peer_proof_request_changed");
    const [currentCell] = await db.select().from(runtimeCells).where(and(eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, cell.id))).limit(1);
    const [currentBinding] = await db.select().from(runtimeSandboxBindings).where(and(
      eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.id, binding.id))).limit(1);
    if (!currentCell || currentCell.status !== "STOPPED" || observedSandboxPhase !== "Stopped" ||
        currentCell.generation.toString() !== command.scope.cellGeneration ||
        !currentBinding || currentBinding.status !== "admitting" || currentBinding.version !== proof.bindingVersion ||
        currentBinding.cellGeneration !== command.scope.cellGeneration ||
        (currentCell.activeImageDigest ?? currentCell.desiredImageDigest) !== command.imageDigest)
      throw new Error("software_only_host_peer_stopped_target_changed");
    const [snapshot, ...extraSnapshots] = await db.select().from(runtimePolicySnapshots).where(and(
      eq(runtimePolicySnapshots.companyId, companyId), eq(runtimePolicySnapshots.bindingId, binding.id),
      eq(runtimePolicySnapshots.policyHash, proof.policyHash), eq(runtimePolicySnapshots.status, "qualified"))).limit(2);
    if (!snapshot || extraSnapshots.length || snapshot.expiresAt <= new Date() ||
        snapshot.compilation.proverResult !== "pass" || nativeSha256(snapshot.compilation) !== proof.policyHash ||
        snapshot.compilation.boundaryPolicyHash !== currentBinding.boundaryPolicyHash ||
        !snapshot.compilation.sourcePolicyRefs.includes(`boundary:${currentBinding.boundaryPolicyHash}`))
      throw new Error("software_only_host_peer_compilation_changed");
    const [manifest] = await db.select().from(agentExecutionManifests).where(and(
      eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.id, snapshot.executionManifestId))).limit(1);
    if (!manifest || !snapshot.compilation.sourcePolicyRefs.includes(`manifest:${manifest.id}:${manifest.hash}`))
      throw new Error("software_only_host_peer_manifest_hash_changed");
    const [run] = manifest ? await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, manifest.runId),
      eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.responsibleUserId, requesterUserId),
      eq(heartbeatRuns.status, "running"))).limit(1) : [];
    const [lease] = run ? await db.select().from(environmentLeases).where(and(
      eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, run.id),
      eq(environmentLeases.environmentId, infrastructure.environment.id), eq(environmentLeases.status, "active"))).limit(1) : [];
    if (!manifest || !run || !lease?.expiresAt || lease.expiresAt <= new Date() ||
        manifest.id !== snapshot.executionManifestId ||
        !snapshot.compilation.sourcePolicyRefs.includes(`manifest:${manifest.id}:${manifest.hash}`))
      throw new Error("software_only_host_peer_run_lease_changed");
    const responsibleUserId = run.responsibleUserId;
    if (typeof responsibleUserId !== "string") throw new Error("software_only_host_peer_human_owner_missing");
    let taskRoot: string;
    let expectedSidecar: Record<string, unknown> | null = null;
    let currentConformanceClaim: NativeOpenCodeConformanceHostAuthority | null = null;
    if (nativeConformanceMode) {
      const context = run.contextSnapshot && typeof run.contextSnapshot === "object" && !Array.isArray(run.contextSnapshot)
        ? run.contextSnapshot as Record<string, any> : {};
      const profile = run.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
        ? run.runnerProfileJson as Record<string, any> : {};
      const workspace = profile.nativeOpenCodeConformanceWorkspace && typeof profile.nativeOpenCodeConformanceWorkspace === "object"
        ? profile.nativeOpenCodeConformanceWorkspace as Record<string, any> : {};
      const taskRootCandidate = workspace.taskRoot;
      const creationReceipt = workspace.creationReceipt;
      const taskId = run.nativeIssueId, planId = context.providerConformancePlanId, groupId = context.providerConformanceGroupId;
      if (typeof taskId !== "string" || typeof planId !== "string" || typeof groupId !== "string" ||
          typeof taskRootCandidate !== "string" || typeof creationReceipt !== "string" ||
          !/^[a-f0-9]{64}$/.test(creationReceipt) || run.responsibleUserId !== command.requesterUserId ||
          actor.type !== "board" || actor.source !== "session" || actor.userId !== requesterUserId || !actor.sessionId ||
          snapshot.capabilitySnapshotHash !== currentBinding.capabilitySnapshotHash)
        throw new Error("software_only_host_peer_current_authority_changed");
      const originalHumanAuthentication = await assertHumanAuthentication(db, actor,
        { requireRecent: true, phishingResistant: false });
      const authorityInput = { runId: run.id, taskId, planId, groupId,
        manifestId: manifest.id, manifestHash: manifest.hash, leaseId: lease.id,
        workspaceRoot: taskRootCandidate, creationReceipt, policySnapshotId: snapshot.id, policyHash: snapshot.policyHash };
      const currentOwner = await executionSandboxService(db).assertNativeConformanceProofOwner(db, actor, companyId, authorityInput);
      taskRoot = currentOwner.workspaceRoot;
      if (snapshot.authorityHash !== currentOwner.sourceAuthorityHash ||
          !snapshot.compilation.sourcePolicyRefs.includes(`authority:${currentOwner.sourceAuthorityHash}`))
        throw new Error("software_only_host_peer_current_authority_changed");
      currentConformanceClaim = {
        runId: run.id, taskId, planId, groupId,
        manifestId: manifest.id, manifestHash: manifest.hash, leaseId: lease.id,
        workspaceRoot: taskRoot, creationReceipt,
        policySnapshotId: snapshot.id, policyHash: snapshot.policyHash,
      };
      expectedSidecar = { version: 1, conformance: currentConformanceClaim,
        requesterSessionId: actor.sessionId,
        verifiedCredentialExpiresAtMs: originalHumanAuthentication.credentialExpiresAt.getTime() };
    } else {
      // Ordinary managed Native Task proof uses its existing exact Run/Task
      // workspace owner and the unchanged operator maximum.
      const workerRun = ordinaryWorkerMode ? await assertFixtureOrdinaryWorker(input, run.id) : null;
      const [task] = run.nativeIssueId
        ? await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, run.nativeIssueId))).limit(1)
        : [];
      const context = run.contextSnapshot && typeof run.contextSnapshot === "object" && !Array.isArray(run.contextSnapshot)
        ? run.contextSnapshot as Record<string, unknown> : {};
      const conversationGeneration = typeof context.conversationSessionGeneration === "number"
        ? context.conversationSessionGeneration : null;
      const chatScope = !workerRun && task
        ? await findNativeChatWorkspaceScope(db, { adapterType: "paperclip_runner", environmentDriver: "sandbox",
            companyId, agentId: run.agentId, issueId: task.id, runId: run.id, responsibleUserId,
            conversationSessionGeneration: conversationGeneration })
        : null;
      const [channelConversation] = task?.originKind === "chat_channel" ? await db.select({
        sessionGeneration: chatConversations.sessionGeneration, state: chatConversations.state,
      }).from(chatConversations).where(and(eq(chatConversations.companyId, companyId),
        eq(chatConversations.issueId, task.id))).limit(1) : [];
      taskRoot = expectedTaskRoot ?? "";
      const canonicalChannelTask = Boolean(task?.originKind === "chat_channel" && chatScope &&
        chatScope.companyId === companyId && chatScope.agentId === run.agentId && chatScope.issueId === task.id &&
        chatScope.projectId === null && nativeChatWorkspaceCwd(chatScope, null, false) === taskRoot &&
        conversationGeneration !== null && channelConversation &&
        ["active", "waiting"].includes(channelConversation.state) &&
        channelConversation.sessionGeneration === conversationGeneration &&
        task.conversationRetiredAt === null && task.hiddenAt === null);
      const canonicalAppConversationTask = Boolean(chatScope && task && task.originKind !== "chat_channel" &&
        chatScope.companyId === companyId && chatScope.agentId === run.agentId && chatScope.issueId === task.id &&
        task.conversationAgentId === run.agentId && task.conversationUserId === run.responsibleUserId &&
        task.conversationState === "active" && task.conversationRetiredAt === null &&
        nativeChatWorkspaceCwd(chatScope, null, false) === taskRoot);
      if (!task || !taskRoot || run.nativeIssueId !== task.id || responsibleUserId !== requesterUserId ||
          task.assigneeAgentId !== run.agentId || task.executionRunId !== run.id ||
          (workerRun ? task.conversationAgentId !== null || task.conversationUserId !== null
            : task.conversationRetiredAt !== null || task.hiddenAt !== null ||
              !canonicalChannelTask && !canonicalAppConversationTask) ||
          Object.prototype.hasOwnProperty.call((await db.select({ payload: runtimeHostCommands.payload })
            .from(runtimeHostCommands).where(eq(runtimeHostCommands.id, commandId)).limit(1))[0]?.payload ?? {},
            "__nativeConformancePolicyProof")) {
        throw new Error("software_only_host_peer_current_task_owner_changed");
      }
    }
    if (snapshot.capabilitySnapshotHash !== currentBinding.capabilitySnapshotHash)
      throw new Error("software_only_host_peer_current_authority_changed");
    const capability = currentBinding.capabilitySnapshot
      ? sandboxCapabilitySnapshotSchema.safeParse(currentBinding.capabilitySnapshot) : null;
    const modelBinaries = capability?.success ? capability.data.modelBrokerProviderProfile?.binaries ?? [] : [];
    const endpointBinaries = snapshot.compilation.modelBrokerEndpoint?.binaries ?? [];
    if (!capability?.success || capability.data.evidenceKind !== "protected_host_report" ||
        capability.data.backend !== "openshell" || capability.data.expiresAt <= new Date().toISOString() ||
        !modelBinaries.length || nativeSha256(modelBinaries) !== nativeSha256(endpointBinaries))
      throw new Error("software_only_host_peer_model_binary_authority_changed");
    const expectedReads = [...new Set([taskRoot, "/.openshell/runtime/openshell-sandbox", ...modelBinaries])].sort();
    const compiledReads = snapshot.compilation.compiledPolicy.filesystem.readPaths;
    const readScopeValid = nativeConformanceMode
      ? nativeSha256(compiledReads) === nativeSha256(expectedReads)
      : expectedReads.every(path => compiledReads.includes(path));
    if (!readScopeValid ||
        nativeSha256(snapshot.compilation.compiledPolicy.filesystem.writePaths) !== nativeSha256([taskRoot]))
      throw new Error("software_only_host_peer_task_scope_changed");
    const candidate = projectOpenShellPolicy(snapshot.compilation.compiledPolicy, snapshot.compilation.modelBrokerEndpoint,
      snapshot.compilation.credentialBrokerEndpoints);
    const sourceBoundary = currentBinding.boundaryPolicy.credentials.mode === "brokered" &&
      currentBinding.boundaryPolicy.credentials.bindings.length === 0
      ? { ...currentBinding.boundaryPolicy, credentials: { mode: "none" as const, bindings: [] } }
      : currentBinding.boundaryPolicy;
    const parent = projectOpenShellPolicy(sourceBoundary, snapshot.compilation.modelBrokerEndpoint,
      snapshot.compilation.credentialBrokerEndpoints);
    const maximum = nativeConformanceMode && candidate.document && parent.document ? deriveNativeConformanceProofMaximum({
      operatorMaximum: parent.document, candidate: candidate.document, taskRoot, modelBinaries,
    }) : null;
    const proofMaximum = nativeConformanceMode ? maximum : parent.document;
    if (!candidate.document || candidate.unsupportedFeatures.length || !parent.document || parent.unsupportedFeatures.length || !proofMaximum ||
        nativeSha256(proof.candidateDocument) !== nativeSha256(candidate.document) ||
        nativeSha256(proof.boundaryDocument) !== nativeSha256(proofMaximum))
      throw new Error("software_only_host_peer_derived_documents_changed");
    const prepares = await db.select().from(runtimeHostCommands).where(and(
      eq(runtimeHostCommands.companyId, companyId), eq(runtimeHostCommands.runtimeHostId, host.id),
      eq(runtimeHostCommands.runtimeCellId, cell.id), eq(runtimeHostCommands.cellGeneration, BigInt(command.scope.cellGeneration)),
      eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"),
      sql`${runtimeHostCommands.payload}->>'action' = 'prepare'`,
      sql`${runtimeHostCommands.payload}->'provisioning'->>'purpose' = 'admission'`,
      sql`${runtimeHostCommands.payload}->'provisioning'->>'operationKey' = ${proof.operationKey}`,
      sql`${runtimeHostCommands.payload}->'provisioning'->>'bindingVersion' = ${String(proof.bindingVersion)}`,
      sql`${runtimeHostCommands.payload}->'provisioning'->>'policyHash' = ${proof.policyHash}`)).limit(2);
    const prepare = prepares[0];
    if (prepares.length !== 1 || !prepare || prepare.safeResult === null || typeof prepare.safeResult !== "object" || Array.isArray(prepare.safeResult))
      throw new Error("software_only_host_peer_prepare_receipt_missing");
    let wrongMaximumRejected = false;
    if (nativeConformanceMode && proof.stage === "requested" &&
        !softwareOnlyPolicyProofObservations.some(row => row.wrongMaximumRejected === true)) {
      if (!currentConformanceClaim || !parent.document)
        throw new Error("software_only_host_peer_current_maximum_missing");
      const wrongProof: NonNullable<SandboxHostRequest["policyProof"]> = { ...proof,
        operationKey: `software-only-wrong-maximum:${randomUUID()}`,
        boundaryDocument: parent.document,
        boundaryDocumentHash: nativeSha256(parent.document) };
      const before = await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands)
        .where(and(eq(runtimeHostCommands.companyId, companyId), eq(runtimeHostCommands.runtimeCellId, cell.id),
          eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND)));
      try {
        await nativeSandboxHostTransport(db).bridge(actor, currentConformanceClaim).provePolicy!(
          command.scope, wrongProof, `${wrongProof.operationKey}:idempotency`);
      } catch (error) {
        const details = error && typeof error === "object" && "details" in error
          ? (error as { details?: { code?: unknown } }).details : undefined;
        wrongMaximumRejected = details?.code === "sandbox_policy_proof_document_changed";
      }
      const after = await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands)
        .where(and(eq(runtimeHostCommands.companyId, companyId), eq(runtimeHostCommands.runtimeCellId, cell.id),
          eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND)));
      if (!wrongMaximumRejected || after.length !== before.length)
        throw new Error("software_only_host_peer_wrong_maximum_not_rejected");
    }
    const prepareRequest = prepare.payload as Record<string, any>;
    const prepareReply = prepare.safeResult as Record<string, any>;
    const prepareProvisioning = prepareRequest.provisioning as Record<string, any> | undefined;
    if (prepareRequest.action !== "prepare" || nativeSha256(prepareRequest.scope) !== nativeSha256(command.scope) ||
        prepareRequest.requesterUserId !== command.requesterUserId || prepareRequest.hostEpoch !== command.hostEpoch ||
        prepareRequest.imageDigest !== command.imageDigest || !prepareProvisioning ||
        prepareProvisioning.purpose !== "admission" || prepareProvisioning.operationKey !== proof.operationKey ||
        prepareProvisioning.bindingVersion !== proof.bindingVersion || prepareProvisioning.policyHash !== proof.policyHash ||
        nativeSha256(prepareProvisioning.document) !== nativeSha256(candidate.document) ||
        prepareReply.action !== "prepare" || prepareReply.hostEpoch !== command.hostEpoch ||
        prepareReply.imageDigest !== command.imageDigest || prepareReply.bindingVersion !== proof.bindingVersion ||
        prepareReply.provisioningHash !== proof.provisioningHash || prepareReply.policyHash !== proof.policyHash ||
        prepareReply.probePolicyHash !== nativeSha256(prepareProvisioning.document) ||
        prepareReply.sandboxId !== proof.sandboxId || prepareReply.containerId !== proof.containerId)
      throw new Error("software_only_host_peer_prepare_target_changed");
    const stored = await db.select({ payload: runtimeHostCommands.payload }).from(runtimeHostCommands)
      .where(eq(runtimeHostCommands.id, commandId)).limit(1);
    const payload = stored[0]?.payload && typeof stored[0].payload === "object" && !Array.isArray(stored[0].payload)
      ? stored[0].payload as Record<string, any> : {};
    const sidecar = payload.__nativeConformancePolicyProof;
    if (nativeSha256(sidecar ?? null) !== nativeSha256(expectedSidecar) ||
        Object.prototype.hasOwnProperty.call(command, "__nativeConformancePolicyProof"))
      throw new Error("software_only_host_peer_private_claim_changed");
    if (nativeConformanceMode) softwareOnlyPolicyProofSidecarHashes.set(commandId, nativeSha256(sidecar));
    const journal = JSON.parse(readFileSync(sessionHostJournalFile, "utf8")) as Record<string, any>;
    const currentScope = journal.scopes?.[binding.id];
    const creation = currentScope?.creation;
    const pinned = currentScope?.policy;
    const cliPolicy = actualCliPolicyObservation;
    const observedPolicyMatchesTarget = cliPolicy?.bindingId === binding.id &&
      cliPolicy.sandboxId === proof.sandboxId && cliPolicy.containerId === proof.containerId &&
      nativeSha256(cliPolicy.document) === cliPolicy.hash;
    const requestedPolicyMatchesCreation = Boolean(creation?.document) && observedPolicyMatchesTarget &&
      nativeSha256(creation.document) === proof.candidateDocumentHash &&
      nativeSha256(cliPolicy!.document) === nativeSha256(creation.document) &&
      cliPolicy!.hash === creation.observedPolicyHash;
    const effectivePolicyMatchesPin = Boolean(pinned?.document) && observedPolicyMatchesTarget &&
      pinned.policyHash === proof.policyHash &&
      nativeSha256(pinned.document) === proof.candidateDocumentHash &&
      nativeSha256(cliPolicy!.document) === proof.candidateDocumentHash;
    if (!currentScope || creation?.purpose !== "admission" ||
        creation.sandboxId !== proof.sandboxId || creation.containerId !== proof.containerId ||
        currentScope.sandboxId !== proof.sandboxId || currentScope.containerId !== proof.containerId ||
        activeHostIdentity?.sandboxId !== proof.sandboxId || activeHostIdentity?.containerId !== proof.containerId ||
        !observedPolicyMatchesTarget ||
        (proof.stage === "requested" && !requestedPolicyMatchesCreation) ||
        (proof.stage === "effective" && !effectivePolicyMatchesPin))
      throw new Error("software_only_host_peer_effective_policy_changed");
    const executable = process.env.AW_V7_OPENSHELL_PROVER ?? "/workspace/v10-preparation/tools/openshell-prover-v0.1.2/openshell-prover";
    const executableSha256 = "3e80c0d041a7552d57cc338868bc825a6261e21b5f29a7d7527bcc7926d423f1";
    const checked = await checkOpenShellBoundary({ executable, executableSha256,
      candidate: proof.candidateDocument, boundary: proof.boundaryDocument });
    const expectedDomains = ["filesystem", "landlock", "network_l4", "network_rest", "process"];
    if (checked.result !== "within_boundary" || checked.candidateHash !== proof.candidateDocumentHash ||
        checked.boundaryHash !== proof.boundaryDocumentHash || nativeSha256(checked.coveredDomains) !== nativeSha256(expectedDomains))
      throw new Error("software_only_host_peer_actual_prover_rejected_policy");
    const target = { hostEpoch: command.hostEpoch, imageDigest: command.imageDigest, sandboxId: proof.sandboxId,
      containerId: proof.containerId, bindingVersion: proof.bindingVersion, provisioningHash: proof.provisioningHash,
      policyHash: proof.policyHash };
    const result = checked.result, coveredDomains = checked.coveredDomains, effectiveDocumentHash = cliPolicy!.hash;
    const proofFields = { schema: "paperclip.sandbox-host-policy-proof.v1", stage: proof.stage, result, coveredDomains,
      candidateDocumentHash: proof.candidateDocumentHash, boundaryDocumentHash: proof.boundaryDocumentHash,
      effectiveDocumentHash, proverVersion: "0.1.2", proverSha256: executableSha256, target };
    const reply = { action: "prove_policy", stage: proof.stage, result, coveredDomains,
      candidateDocumentHash: proof.candidateDocumentHash, boundaryDocumentHash: proof.boundaryDocumentHash,
      effectiveDocumentHash, proverVersion: "0.1.2", proverSha256: executableSha256, target,
      evidenceHash: nativeSha256(proofFields) };
    softwareOnlyPolicyProofObservations.push({ peer: "software_only_host_peer", physicalQualification: false, stage: proof.stage,
      persistedCompilationMatched: true, conformanceClaimPersisted: nativeConformanceMode, claimAbsentFromHostEnvelope: true,
      exactStoppedPreparedTarget: true, actualPinnedProver: true, result: "within_boundary", completedSuccessfully: false,
      ...(nativeConformanceMode ? { wrongMaximumRejected:
        wrongMaximumRejected || softwareOnlyPolicyProofObservations.some(row => row.wrongMaximumRejected === true) } : {}) });
    return reply;
  };
  const driveHost = async <T>(work: Promise<T>): Promise<T> => {
    let settled = false;
    driveHostObservation.active = true; driveHostObservation.phase = "claiming";
    driveHostObservation.currentAction = "none"; driveHostObservation.lastAction = "none";
    driveHostObservation.claimedCommands = 0; driveHostObservation.claimPolls = 0;
    driveHostObservation.startedAt = Date.now(); driveHostObservation.lastCommandAt = 0; driveHostObservation.workSettled = false;
    const result = work.then(value => ({ value }), error => ({ error })).then(value => {
      settled = true; driveHostObservation.workSettled = true;
      driveHostObservation.phase = "settled"; driveHostObservation.active = false; return value;
    });
    const deadline = Date.now() + 30_000;
    while (!settled && Date.now() < deadline) {
      driveHostObservation.phase = "claiming"; driveHostObservation.claimPolls++;
      const claim = await transport.claim(host.id);
      if (!claim) { await new Promise(resolve => setTimeout(resolve, 2)); continue; }
      driveHostObservation.phase = "processing"; driveHostObservation.claimedCommands++;
      driveHostObservation.lastCommandAt = Date.now();
      const secret = privateDecrypt({ key: hostKeys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256",
        oaepLabel: Buffer.from("aw-runtime-command-v6") }, Buffer.from(claim.envelope.encryptedKey, "base64url"));
      const command = unseal<Record<string, any>>(claim.envelope.ciphertext, secret.toString("hex"), `command:${claim.id}:${host.id}:1`);
      const action = command.action as string;
      const observedAction = ["capabilities", "prepare", "probe", "inspect", "apply", "start", "prove_policy", "stop"].includes(action)
        ? action : "unknown";
      driveHostObservation.currentAction = observedAction; driveHostObservation.lastAction = observedAction;
      const snapshot = capabilities();
      let reply: Record<string, any>;
      if (action === "capabilities") reply = { action, capabilities: snapshot };
      else if (action === "prepare" && command.provisioning) {
        const provisioning = command.provisioning as Record<string, any>;
        if(provisioning.purpose === "qualification"){
          if(provisioning.probeFixtureHash !== qualificationProbeFixture.fixtureHash || nativeSha256(provisioning.qualificationProbeFixture) !== nativeSha256(qualificationProbeFixture) ||
            nativeSha256(provisioning.document) !== projectedQualification.documentHash || provisioning.policyHash !== projectedQualification.documentHash)
            throw new Error("conversation_software_host_protected_qualification_provisioning_mismatch");
        }else if(provisioning.purpose !== "admission" || !protectedQualificationTarget)
          throw new Error("conversation_software_host_protected_admission_provisioning_mismatch");
        // The actual service runs every signed qualification probe after Host
        // capabilities returns the exact created target. Do not duplicate those
        // probes here before the creation receipt exists: resource containment
        // is meaningful only against that exact immutable target.
        reply = { action, backendVersion: "0.1.2", imageDigest: command.imageDigest, hostEpoch: command.hostEpoch,
          ...(protectedQualificationTarget ? { sandboxId: protectedQualificationTarget.sandboxId,
            containerId: protectedQualificationTarget.containerId } : {}),
          provisioningHash: provisioning.provisioningHash, bindingVersion: provisioning.bindingVersion,
          policyHash: provisioning.policyHash, probePolicyHash: nativeSha256(provisioning.document),
          resourceLimits: provisioning.resourceLimits, requiresRecreate: false };
      } else if (action === "prepare") reply = { action, backendVersion: "0.1.2", imageDigest };
      else if(action === "probe"){
        if(qualificationTargetProbeActive){
          const target=protectedQualificationTarget,identity=activeHostIdentity;
          assert.ok(target && identity, `qualification probe lacks actual prepared target: ${String(command.probe.caseId ?? "unknown")}`);
          assert.equal(identity.sandboxId,target.sandboxId,`qualification probe sandbox mismatch: ${String(command.probe.caseId ?? "unknown")}`);
          assert.equal(identity.containerId,target.containerId,`qualification probe container mismatch: ${String(command.probe.caseId ?? "unknown")}`);
        }
        if(command.probe.qualificationCredentialCapability){
          const test=command.probe,fixture=qualificationCredentialFixture,tool=test.caseId === "credential_wrong_destination_deny" ? fixture.wrongToolName : fixture.toolName;
          const persisted=await db.select({payload:runtimeHostCommands.payload}).from(runtimeHostCommands).where(eq(runtimeHostCommands.id,claim.id));
          const serializedPayload=JSON.stringify(persisted[0]?.payload);
          assert.ok(!serializedPayload.includes(test.qualificationCredentialCapability));assert.ok(!serializedPayload.includes(test.qualificationCredentialNonce));
          const call=request(qualificationProtocolApp).post(`/mcp/gateways/${fixture.gatewayPublicId}`);
          if(test.caseId !== "credential_wrong_binary_deny")call.set("Authorization",`Bearer ${test.qualificationCredentialCapability}`);
          const body={jsonrpc:"2.0",id:claim.id,method:"tools/call",params:{name:tool,arguments:{fixtureId:fixture.fixtureId,caseId:test.caseId,nonce:test.qualificationCredentialNonce}}};
          const response=await call.send(body),reasonCode=response.body?.error?.data?.reasonCode ?? null,marker=response.body?.result?.structuredContent?.marker ?? null;
          const serialized=JSON.stringify(response.body);
          for(const value of [canarySecretValue,runtimeSecretValue,test.qualificationCredentialCapability,"qualification-provider-output-sentinel"])assert.ok(!serialized.includes(value));
          if(response.status === 200){assert.deepEqual(response.body.result.content,[{type:"text",text:fixture.marker}]);assert.deepEqual(response.body.result.structuredContent,{marker:fixture.marker});}
          let replayDenied:boolean|undefined;
          if(test.caseId === "credential_allow"){
            const replay=await request(qualificationProtocolApp).post(`/mcp/gateways/${fixture.gatewayPublicId}`)
              .set("Authorization",`Bearer ${test.qualificationCredentialCapability}`).send(body);
            replayDenied=replay.status === 409 && JSON.stringify(replay.body).includes("sandbox_qualification_capability_replayed");assert.ok(replayDenied);
          }
          const passed=test.caseId === "credential_allow" || test.caseId === "credential_raw_read_deny" ? response.status === 200 && marker === fixture.marker
            : test.caseId === "credential_wrong_destination_deny" ? response.status === 403 && reasonCode === "sandbox_qualification_tool_mismatch"
            : test.caseId === "credential_wrong_binary_deny" ? response.status === 401 && reasonCode === "sandbox_qualification_credential_required"
            : test.caseId === "credential_revoke_deny" && response.status === 403 && reasonCode === "sandbox_qualification_grant_revoked";
          qualificationToolResponses.push({caseId:test.caseId,status:response.status,reasonCode,marker,...(replayDenied !== undefined ? {replayDenied} : {})});
          reply={action,verdict:passed ? "pass" : "fail",observationHash:nativeSha256({caseId:test.caseId,status:response.status,reasonCode,marker}),contractHash:test.contractHash,targetQualificationHash:protectedQualificationTarget?.targetHash};
        }else reply=await observeSoftwareBoundary(command.probe);
      }
      else if (action === "prove_policy") {
        // Exercise the production signed command/claim/complete path while
        // keeping this controlled peer's evidence explicitly software-only.
        reply = await softwareOnlyConformanceProof(claim.id, command);
      }
      else {
        // Lifecycle and effective-policy replies come only from the production
        // Host engine below; local maps cannot serve as observed receipts.
        if (!sessionHostEngine) throw new Error("conversation_software_host_engine_unavailable");
        reply = { action };
      }
      const needsEngineReceipt = sessionHostEngine && (
        (action === "prepare" && command.provisioning) ||
        action === "capabilities" ||
        ["inspect", "effective_policy", "apply", "start", "prove_policy", "stop", "revoke_providers", "destroy", "erase_native_session"].includes(action) &&
        !(action === "prove_policy"));
      if (needsEngineReceipt) {
        const now = Date.now();
        const deadlines = [command.deadlineAt, command.provisioning?.expiresAt,
          command.admission?.expiresAt, command.start?.expiresAt]
          .map(value => typeof value === "string" ? Date.parse(value) : Number.NaN)
          .filter(value => Number.isFinite(value));
        const hostDeadlineAt = new Date(Math.min(now + 30_000, ...deadlines)).toISOString();
        const nativeSessionBacking = action === "erase_native_session"
          ? await attachActualNativeSessionBacking(command, Date.parse(hostDeadlineAt)) : null;
        const observed = await sessionHostEngine.execute(claim.id, command, hostDeadlineAt);
        if (observed.success && action === "prepare" && command.provisioning && !observed.reply?.requiresRecreate) {
          const actual = observed.reply;
          if (actual?.action !== "prepare" || actual.provisioningHash !== command.provisioning.provisioningHash ||
            actual.imageDigest !== command.imageDigest || typeof actual.sandboxId !== "string" ||
            typeof actual.containerId !== "string") throw new Error("conversation_host_prepare_receipt_mismatch");
          activeHostIdentity = { sandboxId: actual.sandboxId, containerId: actual.containerId };
          reply = actual;
          if (command.provisioning.purpose === "qualification" && protectedQualificationTarget) {
            const actualTargetWithOldHash: Record<string, unknown> = { ...protectedQualificationTarget, sandboxId: actual.sandboxId,
              containerId: actual.containerId, provisioningHash: actual.provisioningHash };
            const actualTarget = Object.fromEntries(Object.entries(actualTargetWithOldHash)
              .filter(([key]) => key !== "targetHash"));
            protectedQualificationTarget = { ...actualTarget, targetHash: nativeSha256(actualTarget) };
          }
        } else if (observed.success && action === "capabilities") {
          const actualCapabilities = observed.reply?.capabilities;
          if (observed.reply?.action !== "capabilities" || !actualCapabilities) {
            const safeFailure={phase:"host_capability_receipt_missing",action,replyAction:observed.reply?.action ?? null,
              capabilitiesKind:actualCapabilities === null ? "null" : typeof actualCapabilities,
              activeHostIdentityPresent:activeHostIdentity !== null,observedSandboxPhase,hostCliOperations:hostCliOperations.slice(-40)};
            sandboxExecutionFailures.push(safeFailure);
            if(process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1")
              console.error("conversation_host_capability_receipt_missing",JSON.stringify(safeFailure));
            throw new Error("conversation_host_capability_receipt_mismatch");
          }
          const parsedCapabilities=sandboxCapabilitySnapshotSchema.safeParse(actualCapabilities);
          const target=actualCapabilities.qualificationTarget;
          const fixture=actualCapabilities.qualificationProbeFixture as SandboxQualificationProbeFixture|undefined;
          const fixtureCredential=fixture?.credential ?? null;
          const snapshotObservation={
            targetPresent:Boolean(target), targetHashValid:typeof target?.targetHash === "string" && /^[a-f0-9]{64}$/.test(target.targetHash),
            targetKernelMatches:target?.hostKernelVersion === actualCapabilities.hostKernelVersion,
            topCredentialFixtureMatches:Boolean(fixtureCredential) === Boolean(actualCapabilities.qualificationCredentialFixture) &&
              nativeSha256(fixtureCredential) === nativeSha256(actualCapabilities.qualificationCredentialFixture ?? null),
            targetCredentialFixtureMatches:Boolean(fixtureCredential) === Boolean(target?.qualificationCredentialFixture) &&
              nativeSha256(fixtureCredential) === nativeSha256(target?.qualificationCredentialFixture ?? null),
            sharedSchemaValid:parsedCapabilities.success,
            sharedSchemaIssues:parsedCapabilities.success ? [] : parsedCapabilities.error.issues.slice(0,12).map(issue=>({
              code:issue.code,path:issue.path.map(part=>typeof part === "string" || typeof part === "number" ? part : "?"),
            })),
            controls: Object.fromEntries(SANDBOX_CONTROLS.map(control => [control, actualCapabilities[control] === true])),
            phase:target?.phase ?? null,
          };
          hostCapabilityObservations.push(snapshotObservation);
          if(!parsedCapabilities.success) throw new Error(`conversation_host_capability_snapshot_schema_invalid:${snapshotObservation.sharedSchemaIssues
            .map(issue=>`${issue.code}:${issue.path.join(".")}`).join(",")}`);
          if(target && (!snapshotObservation.targetKernelMatches || !snapshotObservation.topCredentialFixtureMatches ||
            !snapshotObservation.targetCredentialFixtureMatches))
            throw new Error("conversation_host_target_snapshot_fixture_mismatch");
          const testedAt = Date.parse(actualCapabilities.testedAt);
          const expiresAt = Date.parse(actualCapabilities.expiresAt);
          const initialQualificationPreflight = !actualCapabilities.qualificationTarget &&
            activeHostIdentity === null && protectedQualificationTarget === null && activeHostTarget === null &&
            actualCapabilities.evidenceKind === "protected_host_report" &&
            actualCapabilities.backend === "openshell" && actualCapabilities.backendVersion === "0.1.2" &&
            actualCapabilities.sandboxImageDigest === imageDigest && typeof actualCapabilities.hostKernelVersion === "string" && actualCapabilities.hostKernelVersion.length > 0 &&
            Number.isFinite(testedAt) && testedAt <= Date.now() && Number.isFinite(expiresAt) && expiresAt > Date.now() &&
            actualCapabilities.qualificationHash === qualificationProbeFixture.fixtureHash &&
            nativeSha256(actualCapabilities.qualificationProbeFixture) === nativeSha256(qualificationProbeFixture) &&
            nativeSha256(actualCapabilities.qualificationCredentialFixture ?? null) ===
              nativeSha256(qualificationProbeFixture.credential ?? null) &&
            SANDBOX_CONTROLS.every(control => actualCapabilities[control] === false);
          if (!actualCapabilities.qualificationTarget && !initialQualificationPreflight)
            throw new Error("conversation_host_capability_receipt_mismatch");
          if (actualCapabilities.qualificationTarget) {
            activeHostTarget = actualCapabilities.qualificationTarget;
            if (command.provisioning?.purpose === "qualification" || !protectedQualificationTarget)
              protectedQualificationTarget = actualCapabilities.qualificationTarget;
          }
          lastHostCapabilities = actualCapabilities as SandboxCapabilitySnapshot;
          reply = observed.reply;
        } else if (observed.success && action !== "capabilities") {
          if (!observed.reply || observed.reply.action !== action) throw new Error("conversation_host_lifecycle_receipt_mismatch");
          if (action === "inspect") hostLifecycleObservations.push({
            state: ["running", "stopped", "unknown", "failed"].includes(observed.reply.state)
              ? observed.reply.state : "unknown",
            controlsHealthy: observed.reply.controlsHealthy === true,
            generationMatches: observed.reply.generation === command.scope.cellGeneration,
            imageDigestMatches: observed.reply.imageDigest === command.imageDigest,
            policyHashPresent: typeof observed.reply.policyHash === "string" && /^[a-f0-9]{64}$/.test(observed.reply.policyHash),
          });
          reply = observed.reply;
          if (action === "erase_native_session") {
            const descriptor = command.nativeSessionErasure;
            const attachmentStageNonces = Array.isArray(descriptor?.attachmentStageNonces) ? descriptor.attachmentStageNonces : [];
            const exactReply = nativeSha256(reply.attachmentStageNoncesAbsent ?? []) === nativeSha256(attachmentStageNonces) &&
              reply.erased === true && reply.schema === descriptor?.schema &&
              reply.startBindingDigest === descriptor?.startBindingDigest && reply.sessionKey === descriptor?.sessionKey &&
              reply.leaseId === descriptor?.leaseId && reply.sessionDigest === descriptor?.sessionDigest &&
              reply.policyHash === descriptor?.policyHash && reply.sandboxId === descriptor?.sandboxId &&
              reply.containerId === descriptor?.containerId && reply.imageDigest === descriptor?.imageDigest &&
              reply.dockerEngineIdHash === descriptor?.dockerEngineIdHash && reply.cellGeneration === descriptor?.cellGeneration &&
              reply.runId === descriptor?.runId && reply.runnerInstanceId === descriptor?.runnerInstanceId &&
              reply.upperLayerAbsent === true && reply.mergedViewAbsent === true && reply.stoppedBefore === true && reply.stoppedAfter === true;
            const upperSessions = descriptor?.taskRoot
              ? join(fixtureOverlayPath(descriptor.taskRoot), ".paperclip-runtime", "paperclip-runner", "sessions") : "";
            const sessionPath = descriptor?.sessionDigest ? join(upperSessions, descriptor.sessionDigest) : "";
            const logicalSessionPath = descriptor?.taskRoot && descriptor?.sessionDigest
              ? join(descriptor.taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions", descriptor.sessionDigest) : "";
            const attachmentStagePaths = attachmentStageNonces.map((nonce: string) => join(fixtureOverlayPath(descriptor.taskRoot),
              ".paperclip-inbound", descriptor.runId, nonce));
            for (const attachmentPath of attachmentStagePaths) {
              if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(attachmentPath.split(sep).at(-1) ?? "") ||
                !attachmentPath.startsWith(join(fixtureOverlayPath(descriptor.taskRoot), ".paperclip-inbound", descriptor.runId) + sep))
                throw new Error("conversation_native_attachment_stage_cleanup_scope_invalid");
            }
            const attachmentStagesAbsent = attachmentStagePaths.every((value: string) => {
              try { lstatSync(value); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
            });
            const neighborPath = join(upperSessions, "f".repeat(64), "retained-neighbor.txt");
            let targetAbsent = false, neighborPresent = false;
            try { lstatSync(sessionPath); } catch (error) { targetAbsent = (error as NodeJS.ErrnoException).code === "ENOENT"; }
            let logicalTargetAbsent = false;
            try { lstatSync(logicalSessionPath); } catch (error) { logicalTargetAbsent = (error as NodeJS.ErrnoException).code === "ENOENT"; }
            try { neighborPresent = readFileSync(neighborPath, "utf8") === "neighbor remains"; } catch { neighborPresent = false; }
            nativeSessionBackingObservations.push({ exactReply, targetAbsent, logicalTargetAbsent, neighborPresent, attachmentStagesAbsent,
              actualRunnerFilesBacked: Boolean(nativeSessionBacking?.fileCount && nativeSessionBacking.fileCount > 0),
              backingMoved: nativeSessionBacking?.moved === true,
              replayAliasExact: nativeSessionBacking?.replayAliasExact === true,
              backingWitnessMatches: nativeSessionBacking?.witnessMatched === true && Boolean(nativeSessionBacking?.originalTreeDigest),
              runnerStateFilePresent: nativeSessionBacking?.runnerStateFilePresent === true,
              runnerIdentityFilePresent: nativeSessionBacking?.runnerIdentityFilePresent === true,
              backedFileCount: nativeSessionBacking?.fileCount ?? 0,
              backedByteCount: nativeSessionBacking?.byteCount ?? 0,
              originalContainerArchiveRoot200: httpArchiveObservations.some(value => value.originalContainer && value.root && value.status === 200),
              originalContainerArchiveTarget404: httpArchiveObservations.some(value => value.originalContainer && !value.root && value.status === 404),
              helperContainersRemoved: helperContainersByName.size === 0 });
            if (!exactReply || !targetAbsent || !logicalTargetAbsent || !neighborPresent || !attachmentStagesAbsent ||
                !nativeSessionBacking?.originalTreeDigest || helperContainersByName.size !== 0)
              throw new Error("conversation_native_session_erasure_receipt_mismatch");
          }
          if (action === "destroy") { activeHostIdentity = null; activeHostTarget = null; }
        }
        if (!observed.success) {
          const errorCode = typeof observed.errorCode === "string" && /^[a-z][a-z0-9_:-]{0,99}$/.test(observed.errorCode)
            ? observed.errorCode : "sandbox_host_unavailable";
          const allowedRequestKeys = ["version", "scope", "action", "hostEpoch", "imageDigest", "requesterUserId",
            "probe", "admission", "start", "provisioning", "cleanupAttestation", "nativeSessionErasure", "claimToken"].sort();
          const requestKeys = Object.keys(command).sort();
          const provision = command.provisioning && typeof command.provisioning === "object" ? command.provisioning : {};
          const sortedProvisioningKeys = Object.keys(provision).sort().join(",");
          const expectedProvisioningKeys = provision.purpose === "qualification"
            ? "bindingVersion,document,expiresAt,idleUntilUnixSeconds,operationKey,policyHash,probeFixtureHash,provisioningHash,purpose,qualificationProbeFixture,requestId,resourceLimits"
            : "bindingVersion,document,expiresAt,idleUntilUnixSeconds,operationKey,policyHash,provisioningHash,purpose,requestId,resourceLimits";
          const hostProvisioningEnvelope = {
            scope: { companyId: command.scope?.companyId, bindingId: command.scope?.bindingId, cellId: command.scope?.cellId,
              cellGeneration: command.scope?.cellGeneration, sandboxRef: command.scope?.sandboxRef },
            hostEpoch: command.hostEpoch, imageDigest: command.imageDigest, purpose: provision.purpose,
            operationKey: provision.operationKey, bindingVersion: provision.bindingVersion, expiresAt: provision.expiresAt,
            idleUntilUnixSeconds: provision.idleUntilUnixSeconds, policyHash: provision.policyHash,
            document: provision.document, resourceLimits: provision.resourceLimits,
            ...(provision.purpose === "qualification" ? { qualificationProbeFixture: provision.qualificationProbeFixture,
              probeFixtureHash: provision.probeFixtureHash } : {}),
          };
          const provisioningDigest = nativeSha256(hostProvisioningEnvelope);
          const expectedRequestIdBytes = /^[a-f0-9]{64}$/.test(provision.provisioningHash ?? "")
            ? Buffer.from(provision.provisioningHash.slice(0, 32), "hex") : null;
          if (expectedRequestIdBytes) { expectedRequestIdBytes[6] = (expectedRequestIdBytes[6]! & 0x0f) | 0x50;
            expectedRequestIdBytes[8] = (expectedRequestIdBytes[8]! & 0x3f) | 0x80; }
          const expectedRequestIdHex = expectedRequestIdBytes?.toString("hex") ?? "";
          const expectedRequestId = expectedRequestIdHex
            ? `${expectedRequestIdHex.slice(0, 8)}-${expectedRequestIdHex.slice(8, 12)}-${expectedRequestIdHex.slice(12, 16)}-${expectedRequestIdHex.slice(16, 20)}-${expectedRequestIdHex.slice(20)}` : null;
          sandboxExecutionFailures.push({ phase: "host_engine_receipt", action, errorCode,
            hostCliOperations: [...hostCliOperations],
            requestFacts: {
              provisioningPurposeQualification: provision.purpose === "qualification",
              provisioningKeysExact: sortedProvisioningKeys === expectedProvisioningKeys,
              requestIdPresent: typeof provision.requestId === "string",
              requestIdUuid: typeof provision.requestId === "string" && /^[0-9a-f-]{36}$/i.test(provision.requestId),
              requestIdMatchesHash: provision.requestId === expectedRequestId,
              hostCanonicalProvisioningHashMatches: provisioningDigest === provision.provisioningHash,
              bindingVersionValid: Number.isSafeInteger(provision.bindingVersion) && provision.bindingVersion >= 1,
              operationKeyValid: typeof provision.operationKey === "string" && provision.operationKey.length >= 1 && provision.operationKey.length <= 300 && !/[\r\n\0]/.test(provision.operationKey),
              expiryCanonical: typeof provision.expiresAt === "string" && Number.isFinite(Date.parse(provision.expiresAt)) && new Date(provision.expiresAt).toISOString() === provision.expiresAt,
              expiryWithinHostLimit: Number.isFinite(Date.parse(provision.expiresAt)) && Date.parse(provision.expiresAt) - Date.now() <= 86_400_000,
              idleDeadlineMatches: Number.isSafeInteger(provision.idleUntilUnixSeconds) && provision.idleUntilUnixSeconds === Math.floor(Date.parse(provision.expiresAt) / 1000),
              resourceLimitsWithinHostRange: Number.isSafeInteger(provision.resourceLimits?.cpuMillis) && provision.resourceLimits.cpuMillis >= 100 && provision.resourceLimits.cpuMillis <= 64000 &&
                Number.isSafeInteger(provision.resourceLimits?.memoryBytes) && provision.resourceLimits.memoryBytes >= 67108864 && provision.resourceLimits.memoryBytes <= 137438953472 &&
                Number.isSafeInteger(provision.resourceLimits?.diskBytes) && provision.resourceLimits.diskBytes >= 1048576 && provision.resourceLimits.diskBytes <= 1099511627776 &&
                Number.isSafeInteger(provision.resourceLimits?.pidsLimit) && provision.resourceLimits.pidsLimit >= 16 && provision.resourceLimits.pidsLimit <= 16384,
              documentRootKeysExact: Object.keys(provision.document ?? {}).sort().join(",") === "filesystem_policy,landlock,network_policies,process,version",
              versionOne: command.version === 1,
              allowedRequestKeysOnly: requestKeys.every(key => allowedRequestKeys.includes(key)),
              scopeKeysExact: Object.keys(command.scope ?? {}).sort().join(",") === "bindingId,cellGeneration,cellId,companyId,sandboxRef",
              scopeMatchesHost: command.scope?.companyId === companyId && command.scope?.bindingId === binding.id &&
                command.scope?.cellId === cell.id && command.scope?.cellGeneration === cell.generation.toString(),
              epochOne: command.hostEpoch === 1,
              requesterPresent: typeof command.requesterUserId === "string" && command.requesterUserId.length > 0,
              imageDigestWellFormed: typeof command.imageDigest === "string" &&
                /^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(command.imageDigest),
              provisioningPresent: Boolean(command.provisioning),
              qualificationFixtureHashMatches: provision.probeFixtureHash === qualificationProbeFixture.fixtureHash,
              qualificationFixtureBodyMatches: nativeSha256(provision.qualificationProbeFixture) === nativeSha256(qualificationProbeFixture),
              policyDocumentHashMatches: typeof provision.document === "object" && nativeSha256(provision.document) === provision.policyHash,
              projectedQualificationPolicyMatches: provision.policyHash === projectedQualification.documentHash,
            } });
          await completeHostCommand(claim.id, { claimToken: command.claimToken,
            generation: command.scope.cellGeneration, success: false, reply: null, errorCode },
            { action, ...(command.probe?.caseId ? { probeCaseId: command.probe.caseId } : {}) });
          continue;
        }
      }
      await completeHostCommand(claim.id, { claimToken: command.claimToken, generation: command.scope.cellGeneration,
        success: true, reply, errorCode: null }, { action, ...(command.probe?.caseId ? { probeCaseId: command.probe.caseId } : {}) });
      if (action === "prove_policy") {
        const [completed] = await db.select().from(runtimeHostCommands).where(eq(runtimeHostCommands.id, claim.id)).limit(1);
        const observation = softwareOnlyPolicyProofObservations.at(-1);
        const storedPayload = completed?.payload && typeof completed.payload === "object" && !Array.isArray(completed.payload)
          ? completed.payload as Record<string, any> : {};
        const sidecarHash = softwareOnlyPolicyProofSidecarHashes.get(claim.id);
        const exactCompletion = completed?.status === "SUCCEEDED" && completed.safeResult?.action === "prove_policy" &&
          nativeSha256(completed.safeResult) === nativeSha256(reply) &&
          (nativeConformanceMode
            ? typeof sidecarHash === "string" && nativeSha256(storedPayload.__nativeConformancePolicyProof ?? null) === sidecarHash
            : !Object.prototype.hasOwnProperty.call(storedPayload, "__nativeConformancePolicyProof"));
        if (!exactCompletion || !observation) throw new Error("software_only_host_peer_completion_receipt_mismatch");
        observation.completedSuccessfully = true;
        softwareOnlyPolicyProofSidecarHashes.delete(claim.id);
      }
      driveHostObservation.currentAction = "none"; driveHostObservation.phase = "waiting";
    }
    if (!settled) { driveHostObservation.phase = "deadline"; driveHostObservation.active = false;
      throw new Error("conversation_software_host_command_timeout"); }
    const output = await result;
    if ("error" in output) { driveHostObservation.phase = "rejected"; driveHostObservation.active = false; throw output.error; }
    return output.value;
  };
  let qualificationEvidence:Record<string,unknown>|null=null;
  const qualifyHost=async(qualificationActor: AuthorizationActor = actor)=>{
  qualificationTargetProbeActive=true;
  let qualification: Awaited<ReturnType<typeof service.qualify>>;
  try { qualification = await driveHost(service.qualify(qualificationActor, companyId, binding.id, binding.version)); }
  finally { qualificationTargetProbeActive=false; }
    const [report] = qualification.qualificationRunId ? await db.select({ status: sandboxQualificationRuns.status,
      suiteVersion: sandboxQualificationRuns.suiteVersion, evidenceKind: sandboxQualificationRuns.evidenceKind,
      results: sandboxQualificationRuns.results, exceptions: sandboxQualificationRuns.exceptions })
      .from(sandboxQualificationRuns).where(eq(sandboxQualificationRuns.id, qualification.qualificationRunId)).limit(1) : [];
    const expectedContracts=new Map(sandboxProbeCases(binding.boundaryPolicyHash,binding.boundaryPolicy.requiredControls)
      .map(test=>[test.caseId,test.contractHash]));
    const results = Array.isArray(report?.results) ? report.results.map(result => ({
      caseId: result.caseId, control: result.control, verdict: result.verdict,
      observationHashPresent: typeof result.observationHash === "string" && /^[a-f0-9]{64}$/.test(result.observationHash),
      contractHashMatches: result.contractHash === expectedContracts.get(result.caseId),
      targetHashMatches: typeof protectedQualificationTarget?.targetHash === "string" &&
        result.targetQualificationHash === protectedQualificationTarget.targetHash,
    })) : [];
    const exceptions = Array.isArray(report?.exceptions) ? report.exceptions.filter((value): value is string =>
      typeof value === "string" && /^[a-z0-9_:-]{1,100}$/.test(value)).slice(0, 32) : [];
    qualificationEvidence={bindingStatus:qualification.status,reportStatus:report?.status ?? null,suiteVersion:report?.suiteVersion ?? null,
      evidenceKind:report?.evidenceKind ?? null,results,exceptions,hostCapabilityObservations,
      softwareProbeObservations,credentialProbeResponses:qualificationToolResponses.map(({caseId,status,reasonCode,replayDenied})=>({caseId,status,reasonCode,replayDenied:replayDenied ?? null})),
      hostFailureCodes:sandboxExecutionFailures.map(failure=>({phase:failure.phase,action:failure.action,
        errorCode:failure.errorCode,probeCaseId:failure.probeCaseId})).slice(0,24)};
    if(process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1" || qualification.status !== "ready")
      console.info("conversation_software_host_qualification",JSON.stringify(qualificationEvidence));
    if(qualification.status !== "ready")throw new Error(`conversation_software_host_qualification_failed:${report?.status ?? "missing"}:`+
      `${results.filter(result=>result.verdict !== "pass" || !result.observationHashPresent || !result.contractHashMatches || !result.targetHashMatches)
        .map(result=>result.caseId).join(",")}:${exceptions.join(",")}`);
    binding = qualification;
    assert.equal(results.length,19);assert.equal(new Set(results.map(result=>result.caseId)).size,19);
    const failedProbeCaseIds=results.filter(result=>result.verdict !== "pass" || !result.observationHashPresent || !result.targetHashMatches)
      .map(result=>result.caseId);
    assert.ok(failedProbeCaseIds.length === 0, `qualification probe failed or target changed: ${failedProbeCaseIds.join(",")}`);
    const [canaryState]=await db.select({status:connectionGrants.status}).from(connectionGrants).where(eq(connectionGrants.id,canary.grant.id));
    const [runtimeState]=await db.select({status:connectionGrants.status}).from(connectionGrants).where(eq(connectionGrants.id,runtimeConnection.grant.id));
    assert.equal(canaryState?.status,"revoked");assert.equal(runtimeState?.status,"active");
    assert.equal(qualificationToolResponses.length,5);
  };
  let expectedRunId: string | null = null;
  let expectedLeaseIdForRun: string | null = null;
  let expectedIssueId: string | null = null;
  let expectedTaskRoot: string | null = null;
  let acquiredLeaseExpiresAt: string | null = null;
  let preAdmissionObservation: { state: string; generationMatches: boolean; imageDigestMatches: boolean; controlsHealthy: boolean } | null = null;
  let prepareHostForRun: ((runId: string, leaseId: string) => Promise<void>) | null = null;
  const hostAdmissionByRun = new Map<string, { leaseId: string; promise: Promise<void> }>();
  const sandboxExecutionChecks: Array<Record<string, boolean | number | string | null>> = [];
  const sandboxExecutionFailures: Array<Record<string, unknown>> = [];
  let sandboxExecInvocationSequence = 0;
  let preparationStage="not_started";
  let negativeAdmissionControls: {wrongRunDenied:boolean;wrongLeaseDenied:boolean;wrongCwdDenied:boolean;wrongPolicyDenied:boolean}|null=null;
  let negativeNativeSessionStartControls: { wrongCommandDenied: boolean; wrongRootDenied: boolean; noExecution: boolean } | null = null;
  const executeSandboxTask: typeof runtime.executeSandboxTask = async execInput => {
    if (!execInput.runId || !execInput.leaseId || !prepareHostForRun)
      throw new Error("conversation_software_host_run_binding_unavailable");
    await heartbeatHost();
    // The first runtime command is workspace preparation, before the Native
    // provider callback. Admit the same real manifest-bound host here, at the
    // original RuntimeControl execution seam, before delegating its signed exec.
    await prepareHostForRun(execInput.runId, execInput.leaseId);
    const commandName = execInput.command.toLowerCase().split("/").at(-1) ?? "";
    const args = execInput.args ?? [];
    const runnerLaunch = commandName === "sh" && args[2] === "paperclip-runner-launch";
    if (execInput.runId && (sandboxExecutionChecks.length < 8 || runnerLaunch)) {
      const [run] = await db.select({ status: heartbeatRuns.status, startedAt: heartbeatRuns.startedAt,
        agentId: heartbeatRuns.agentId, nativeIssueId: heartbeatRuns.nativeIssueId,
        responsibleUserId: heartbeatRuns.responsibleUserId, runtimeMode: heartbeatRuns.runtimeMode,
        contextSnapshot: heartbeatRuns.contextSnapshot, resultJson: heartbeatRuns.resultJson })
        .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, execInput.runId))).limit(1);
      const runContext = run?.contextSnapshot && typeof run.contextSnapshot === "object"
        ? run.contextSnapshot as Record<string, unknown> : {};
      const contextIssueId = typeof runContext.issueId === "string" ? runContext.issueId : null;
      const [contextIssue] = contextIssueId ? await db.select({ conversationAgentId: issues.conversationAgentId,
        conversationUserId: issues.conversationUserId, executionRunId: issues.executionRunId,
        conversationSessionGeneration: issues.conversationSessionGeneration }).from(issues)
        .where(and(eq(issues.companyId, companyId), eq(issues.id, contextIssueId))).limit(1) : [];
      const [lease] = await db.select({ status: environmentLeases.status, expiresAt: environmentLeases.expiresAt,
        heartbeatRunId: environmentLeases.heartbeatRunId }).from(environmentLeases)
        .where(and(eq(environmentLeases.companyId, companyId), eq(environmentLeases.id, execInput.leaseId))).limit(1);
      const cancellation = run?.resultJson?.executionCancellation;
      const cancellationRequested = Boolean(cancellation && typeof cancellation === "object" &&
        "state" in cancellation && cancellation.state === "requested");
      const commandKind = commandName.includes("opencode") ? "opencode" : commandName.includes("runner") ? "runner" :
        commandName.includes("rsync") ? "rsync" : commandName === "git" ? "git" :
          commandName === "bash" ? "bash" : commandName === "sh" ? "shell" :
            commandName === "tar" ? "tar" : commandName === "node" ? "node" : "other";
      const commandScript = args[1] ?? "";
      const commandOwner = runnerLaunch ? "runner_process_launch" : args[2] === "paperclip-runner-monitor"
        ? "runner_process_monitor" : args[2] === "paperclip-runner-process-identity"
          ? "runner_process_identity_read" : args[2] === "paperclip-runner-diagnostics"
            ? "runner_diagnostic_tail" : commandScript.startsWith("command -v ")
              ? "managed_runtime_install_probe" : commandScript.startsWith("mkdir -p ")
                ? "managed_runtime_directory_prepare" : commandScript.startsWith("umask 077; install -d -m 0700 ")
                  ? "runner_harness_directory_prepare" : commandScript.includes("runner-state.json") && commandScript.includes("base64 <")
                    ? "runner_harness_state_read" : commandScript.includes("base64 -d")
                      ? "managed_runtime_file_transfer" : commandScript.includes("tar -xf")
                        ? "managed_runtime_archive_extract" : commandScript.startsWith("rm -rf ")
                          ? "managed_runtime_remove" : commandScript.startsWith("chmod ")
                            ? "managed_runtime_permissions" : commandScript.startsWith("test -")
                              ? "managed_runtime_path_probe" : commandScript.startsWith("if ")
                                ? "managed_runtime_listing" : commandScript.startsWith("set ")
                                  ? "managed_runtime_sync" : "other";
      const managedGitContextProbe = commandName === "sh" && args[0] === "-c" && args[2] === "paperclip-git-context" &&
        (args[3] === "managed" || args[3] === "host");
      const unstartedSessionClaimProbe = commandName === "sh" && args[0] === "-c" && args[2] === "paperclip-runner-claim-unstarted-session";
      const credentialEnvNames = Object.keys(execInput.env ?? {})
        .filter(name => /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|AUTHORIZATION)/i.test(name))
        .sort().slice(0, 16).join(",");
      const nativePreparationPurpose = execInput.nativePreparationPurpose ?? null;
      sandboxExecutionChecks.push({ expectedRun: execInput.runId === expectedRunId,
        commandKind, commandOwner, stdinBytes: Buffer.byteLength(execInput.stdin ?? "", "utf8"),
        cwdAbsolute: Boolean(execInput.cwd?.startsWith("/")), argumentCount: (execInput.args ?? []).length,
        runnerLaunch,
        nativePreparationPurpose,
        managedGitContextProbe, unstartedSessionClaimProbe, credentialEnvNames,
        runtimeMode: run?.runtimeMode ?? null, runStatus: run?.status ?? null, runStatusRunning: run?.status === "running",
        startedAtPresent: Boolean(run?.startedAt), agentIdPresent: Boolean(run?.agentId),
        nativeIssueIdPresent: Boolean(run?.nativeIssueId), responsibleUserIdPresent: Boolean(run?.responsibleUserId),
        cancellationRequested, leaseActiveForRun: lease?.status === "active" && lease.heartbeatRunId === execInput.runId,
        leaseExpiryPresent: Boolean(lease?.expiresAt), leaseUnexpired: Boolean(lease?.expiresAt && lease.expiresAt > new Date()),
        contextIssuePresent: Boolean(contextIssueId), contextWakeCommentPresent: typeof runContext.wakeCommentId === "string",
        contextConversationOwnerMatches: contextIssue?.conversationAgentId === agentId && contextIssue?.conversationUserId === actor.userId,
        contextIssueGenerationPresent: contextIssue?.conversationSessionGeneration !== null && contextIssue?.conversationSessionGeneration !== undefined,
        contextIssueExecutionRunMatches: contextIssue?.executionRunId === execInput.runId,
        nativeIssueMatchesContext: Boolean(run?.nativeIssueId && contextIssueId && run.nativeIssueId === contextIssueId) });
    }
    const commandKey = commandDigest(execInput.command, execInput.args ?? []);
    const purposeQueue = purposesByCommandDigest.get(commandKey) ?? [];
    purposeQueue.push(execInput.nativePreparationPurpose ?? null);
    purposesByCommandDigest.set(commandKey, purposeQueue);
    const sandboxExecSequence = ++sandboxExecInvocationSequence;
    const sandboxExecStartedAt = new Date();
    try {
      // Keep the controlled signed host fresh under the long OpenCode prep
      // sequence; the periodic timer alone can be delayed by a busy test loop.
      await heartbeatHost();
      const result = await runtime.executeSandboxTask(execInput);
      if (!result) return null;
      if (nativeConformanceMode && execInput.nativePreparationPurpose === "native_session_start" &&
          result.exitCode === 0 && !result.timedOut) {
        const [startedRun] = await db.select({ contextSnapshot: heartbeatRuns.contextSnapshot })
          .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
            eq(heartbeatRuns.id, execInput.runId), eq(heartbeatRuns.agentId, agentId))).limit(1);
        const context = startedRun?.contextSnapshot && typeof startedRun.contextSnapshot === "object"
          ? startedRun.contextSnapshot as Record<string, any> : {};
        const tuple = context.nativeOpenCodeConformanceDispatch;
        if (!tuple || Object.keys(tuple).sort().join(",") !==
            ["authorityHash", "dispatchNonce", "planId", "probeId", "profileId", "qualificationGroupId"].sort().join(",") ||
            tuple.qualificationGroupId !== context.providerConformanceGroupId ||
            tuple.planId !== context.providerConformancePlanId || tuple.profileId !== context.nativeOpenCodeConformanceProfileId ||
            tuple.probeId !== context.nativeOpenCodeConformanceProbeId ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tuple.dispatchNonce ?? "") ||
            !/^[a-f0-9]{64}$/.test(tuple.authorityHash ?? ""))
          throw new Error("conversation_fixture_native_session_start_dispatch_tuple_missing");
        nativeConformanceStartTupleObservations.push({ runId: execInput.runId, tuple: structuredClone(tuple) });
      }
      if ((runnerLaunch || result.exitCode === 126 || result.timedOut) &&
          sandboxExecutionFailures.length < 16 && (result.exitCode !== 0 || result.timedOut)) {
        sandboxExecutionFailures.push({
          commandKind: commandName.includes("runner") ? "runner" : commandName === "sh" ? "shell" : "other",
          runnerLaunch,
          nativePreparationPurpose: execInput.nativePreparationPurpose ?? null,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
        });
      }
      return result;
    } catch (error) {
      if ((runnerLaunch || sandboxExecutionFailures.length < 16) && sandboxExecutionFailures.length < 16) {
        const relayFacts = relayRequestFactsForError(error);
        if (relayFacts?.schemaIssues?.length) {
          const stdinUtf8Bytes = typeof execInput.stdin === "string" ? Buffer.byteLength(execInput.stdin, "utf8") : 0;
          const argv = [execInput.command, ...(execInput.args ?? [])];
          const env = execInput.env ?? {};
          console.info("conversation_software_host_relay_request_sizes", JSON.stringify({
            nativePreparationPurpose: execInput.nativePreparationPurpose ?? null,
            commandKind: commandName.includes("runner") ? "runner" : commandName === "sh" ? "shell" : "other",
            argvCount: argv.length,
            argvJsonBytes: Buffer.byteLength(JSON.stringify(argv), "utf8"),
            envKeyCount: Object.keys(env).length,
            envJsonBytes: Buffer.byteLength(JSON.stringify(env), "utf8"),
            stdinUtf8Bytes,
            stdinBase64CharacterCount: 4 * Math.ceil(stdinUtf8Bytes / 3),
          }));
        }
        let runtimeAssetDiagnostics:unknown[]|null=null;
        if(execInput.runId && safeErrorSourceFrames(error).some(frame=>frame.functionName?.includes("assertNativeDocumentRuntimeSkillCurrent"))){
          try{
            const [currentRun]=await db.select({profile:heartbeatRuns.runnerProfileJson}).from(heartbeatRuns).where(and(
              eq(heartbeatRuns.companyId,companyId),eq(heartbeatRuns.id,execInput.runId),eq(heartbeatRuns.agentId,agentId)));
            const profile=currentRun?.profile as Record<string,unknown>|undefined;
            const execution=profile?.nativeExecutionInput as {runtimeContext?:{skills?:Array<{key:string;bundle:Parameters<typeof readNativeRuntimeAssetText>[0]}>}}|undefined;
            runtimeAssetDiagnostics=[];
            for(const skill of execution?.runtimeContext?.skills ?? []){
              const bundle=skill.bundle;let failureCode:string|null=null;
              try{await readNativeRuntimeAssetText(bundle,256000,{companyId,runId:execInput.runId});}
              catch(failure){
                const message=failure instanceof Error ? failure.message : "";
                const code=failure && typeof failure === "object" ? (failure as {code?:unknown}).code : null;
                failureCode=/^native_text_asset_[a-z_]+$/.test(message) ? message
                  :typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code) ? code
                  :message.startsWith("runtime context asset digest mismatch") ? "runtime_asset_digest_mismatch"
                  :failure instanceof Error ? failure.name : "unknown";
              }
              runtimeAssetDiagnostics.push({key:skill.key,totalBytes:bundle.totalBytes,fileCount:bundle.fileCount,digest:bundle.digest,
                ownerRootMatch:bundle.rootPath === join(nativeRuntimeAssetsRoot({companyId,runId:execInput.runId}),"bundles",bundle.digest),failureCode});
            }
            console.info("conversation_software_host_runtime_asset_diagnostic",JSON.stringify(runtimeAssetDiagnostics));
          }catch{/* source diagnostics must preserve the original failure */}
        }
        const rawCode = error && typeof error === "object" && "code" in error ? error.code : null;
        const requestFacts = relayRequestFactsForError(error);
        let claim: { status: string; errorCode: string | null; commandDigest: string | null;
          nativePreparationPurpose: string | null; requestId: string; createdAt: Date } | undefined;
        let unresolvedClaims: Array<{ requestId: string; status: string; errorCode: string | null;
          commandDigest: string | null; nativePreparationPurpose: string | null; attempt: number; createdAt: Date }> = [];
        if (requestFacts) {
          try {
            [claim] = await db.select({
              requestId: runtimeHostCommands.idempotencyKey,
              status: runtimeHostCommands.status,
              errorCode: runtimeHostCommands.errorCode,
              commandDigest: sql<string | null>`${runtimeHostCommands.payload}->>'commandDigest'`,
              nativePreparationPurpose: sql<string | null>`${runtimeHostCommands.payload}->>'nativePreparationPurpose'`,
              createdAt: runtimeHostCommands.createdAt,
            }).from(runtimeHostCommands).where(and(
              eq(runtimeHostCommands.idempotencyKey, requestFacts.requestId),
              eq(runtimeHostCommands.commandType, "sandbox_exec"),
            )).limit(1);
          } catch { /* diagnostics never replace the original sandbox error */ }
        }
        if (!claim && execInput.runId) {
          try {
            [claim] = await db.select({
              requestId: runtimeHostCommands.idempotencyKey,
              status: runtimeHostCommands.status,
              errorCode: runtimeHostCommands.errorCode,
              commandDigest: sql<string | null>`${runtimeHostCommands.payload}->>'commandDigest'`,
              nativePreparationPurpose: sql<string | null>`${runtimeHostCommands.payload}->>'nativePreparationPurpose'`,
              createdAt: runtimeHostCommands.createdAt,
            }).from(runtimeHostCommands).where(and(
              eq(runtimeHostCommands.commandType, "sandbox_exec"),
              sql`${runtimeHostCommands.payload}->>'runId' = ${execInput.runId}`,
              sql`${runtimeHostCommands.payload}->>'nativePreparationPurpose' = ${execInput.nativePreparationPurpose ?? null}`,
              gte(runtimeHostCommands.createdAt, sandboxExecStartedAt),
            )).orderBy(desc(runtimeHostCommands.createdAt)).limit(1);
          } catch { /* diagnostics never replace the original sandbox error */ }
        }
        if (execInput.runId) {
          try {
            unresolvedClaims = await db.select({
              requestId: runtimeHostCommands.idempotencyKey,
              status: runtimeHostCommands.status,
              errorCode: runtimeHostCommands.errorCode,
              commandDigest: sql<string | null>`${runtimeHostCommands.payload}->>'commandDigest'`,
              nativePreparationPurpose: sql<string | null>`${runtimeHostCommands.payload}->>'nativePreparationPurpose'`,
              attempt: runtimeHostCommands.attempt,
              createdAt: runtimeHostCommands.createdAt,
            }).from(runtimeHostCommands).where(and(
              eq(runtimeHostCommands.companyId, companyId),
              eq(runtimeHostCommands.commandType, "sandbox_exec"),
              sql`${runtimeHostCommands.payload}->>'runId' = ${execInput.runId}`,
              inArray(runtimeHostCommands.status, ["PENDING", "CLAIMED"]),
            )).orderBy(desc(runtimeHostCommands.createdAt)).limit(8);
          } catch { /* diagnostics never replace the original sandbox error */ }
        }
        sandboxExecutionFailures.push({
          commandKind: commandName.includes("runner") ? "runner" : commandName === "sh" ? "shell" : "other",
          runnerLaunch,
          nativePreparationPurpose: execInput.nativePreparationPurpose ?? null,
          failureClass: safeSandboxFailureClass(error),
          requestAssociationSource: requestFacts ? "signed_relay_request" : claim ? "persisted_command_claim" : "pre_claim_error",
          requestSequence: requestFacts?.sequence ?? sandboxExecSequence,
          requestId: requestFacts?.requestId ?? claim?.requestId ?? null,
          requestDigest: requestFacts?.requestDigest ?? claim?.commandDigest ?? null,
          relaySchemaIssues: requestFacts?.schemaIssues ?? null,
          harnessCommandDigest: requestFacts?.harnessCommandDigest ?? commandKey,
          claimStatus: claim?.status ?? null,
          claimErrorCode: claim?.errorCode ?? null,
          claimCommandDigest: claim?.commandDigest ?? null,
          claimNativePreparationPurpose: claim?.nativePreparationPurpose ?? null,
          claimAgeMs: claim ? Math.max(0, Date.now() - claim.createdAt.getTime()) : null,
          unresolvedClaims: unresolvedClaims.map(row => ({ requestId: row.requestId, status: row.status,
            errorCode: row.errorCode, commandDigest: row.commandDigest,
            nativePreparationPurpose: row.nativePreparationPurpose, attempt: row.attempt,
            ageMs: Math.max(0, Date.now() - row.createdAt.getTime()),
            relayCommandOwner: relayCommandOwnerByRequestId.get(row.requestId) ?? null })),
          argumentCount: (execInput.args ?? []).length,
          monitorLabelPresent: (execInput.args ?? []).includes("paperclip-runner-monitor"),
          monitorScriptPrefix: (execInput.args?.[1] ?? "").startsWith("set -eu; identity_path=$1;"),
          errorName: error instanceof Error && ["Error", "HttpError", "TypeError"].includes(error.name) ? error.name : "other",
          errorCode: typeof rawCode === "string" && /^[a-z0-9_:-]{1,100}$/i.test(rawCode) ? rawCode : null,
          errorSourceFrames: safeErrorSourceFrames(error),runtimeAssetDiagnostics,
          nativePreReceiptFailedChecks: safeNativePreReceiptFailedChecks(error),
        });
      }
      throw error;
    } finally {
      if (purposeQueue.length === 0) purposesByCommandDigest.delete(commandKey);
    }
  };
  const stopSandboxRunLease: NonNullable<Parameters<typeof environmentRuntimeService>[1]>["stopSandboxRunLease"] = async scope => {
      if (scope.companyId !== companyId) throw new Error("sandbox_cleanup_fixture_company_changed");
      if (await isNativeBootstrapPrelaunchCleanupCandidate(db, scope)) {
        const prelaunch = await readNativeBootstrapPrelaunchCleanup(db, scope);
        if (prelaunch.owner.hostId !== host.id || prelaunch.owner.cellId !== cell.id)
          throw new Error("sandbox_prelaunch_cleanup_fixture_host_scope_changed");
      } else {
        const owner = await readRunLeaseCleanup(db, scope);
        if (owner.session.hostId !== host.id || owner.scope.cellId !== cell.id)
          throw new Error("sandbox_cleanup_fixture_host_scope_changed");
      }
      return await driveHost(runtime.stopSandboxRunLeaseForCleanup(scope));
  };
  const environmentRuntime = environmentRuntimeService(db, { executeSandboxTask, stopSandboxRunLease });
  const relayServer = createServer(); runtime.relay.attach(relayServer);
  relayServer.listen(0, "127.0.0.1"); await once(relayServer, "listening");
  await runtime.relay.listen(0);
  const relayAddress = relayServer.address();
  if (!relayAddress || typeof relayAddress === "string") throw new Error("conversation_software_host_relay_listen_failed");
  const relayHost = new WebSocket(`ws://127.0.0.1:${relayAddress.port}/api/internal/runtime/relay`);
  await once(relayHost, "open");
  const proof = signedRelayProof(host.id, hostKeys.privateKey); relayHost.send(JSON.stringify({ type: "hello", proof: proof.proof }));
  let authenticated = false;
  for (let i = 0; i < 150; i++) {
    const [nonce] = await db.select({ nonce: runtimeHostRequestNonces.nonce }).from(runtimeHostRequestNonces)
      .where(eq(runtimeHostRequestNonces.nonce, proof.nonce)).limit(1);
    if (nonce) { authenticated = true; break; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (!authenticated) throw new Error("conversation_software_host_relay_auth_failed");
  let hostHeartbeatCount = 0;
  let hostHeartbeatFailed = false;
  let hostHeartbeatInFlight: Promise<void> | null = null;
  const postgresLockSnapshots: Array<Record<string, unknown>> = [];
  let postgresLockProbeInFlight = false;
  let lastPostgresBackendSnapshotAt = 0;
  const probePostgresLocks = async () => {
    if (process.env.PAPERCLIP_RUNTIME_LOCK_DIAGNOSTICS !== "1" || postgresLockProbeInFlight) return;
    postgresLockProbeInFlight = true;
    try {
      const [sample] = await (input.diagnosticDb ?? db).execute(sql`
        select coalesce(json_agg(json_build_object(
          'pid', activity.pid,
          'applicationName', left(regexp_replace(coalesce(activity.application_name, ''), '[^A-Za-z0-9_.-]', '', 'g'), 64),
          'state', activity.state,
          'waitEventType', activity.wait_event_type,
          'waitEvent', activity.wait_event,
          'xactAgeMs', case when activity.xact_start is null then null
            else greatest(0, (extract(epoch from clock_timestamp() - activity.xact_start) * 1000)::int) end,
          'queryAgeMs', case when activity.query_start is null then null
            else greatest(0, (extract(epoch from clock_timestamp() - activity.query_start) * 1000)::int) end,
          'queryKind', case when activity.query ilike '%pg_advisory_%lock%' then 'advisory_lock'
            when activity.query ilike '%heartbeat_runs%' then 'heartbeat_runs'
            when activity.query ilike '%native_run_finalizations%' then 'native_run_finalizations'
            when activity.query ilike '%runtime_host_commands%' then 'runtime_host_commands'
            when activity.query ilike '%context_manifests%' then 'context_manifests'
            when activity.query ilike '%memory_records%' then 'memory_records'
            else lower(split_part(activity.query, ' ', 1)) end,
          'blockedBy', pg_blocking_pids(activity.pid),
          'locks', (select coalesce(json_agg(json_build_object(
              'lockType', lock.locktype, 'mode', lock.mode, 'granted', lock.granted,
              'classId', case when lock.locktype = 'advisory' then lock.classid::bigint else null end,
              'objectId', case when lock.locktype = 'advisory' then lock.objid::bigint else null end,
              'objectSubId', case when lock.locktype = 'advisory' then lock.objsubid else null end,
              'lockPurpose', case
                when lock.locktype = 'advisory' and lock.objsubid = 1 and
                  lock.classid::bigint = ((hashtextextended(${`business-events:${companyId}`}, 0) >> 32) & 4294967295) and
                  lock.objid::bigint = (hashtextextended(${`business-events:${companyId}`}, 0) & 4294967295)
                  then 'business_events_privacy'
                when lock.locktype = 'advisory' and lock.objsubid = 1 and
                  lock.classid::bigint = ((hashtextextended(${`memory:privacy:${companyId}`}, 0) >> 32) & 4294967295) and
                  lock.objid::bigint = (hashtextextended(${`memory:privacy:${companyId}`}, 0) & 4294967295)
                  then 'memory_privacy'
                else null end,
              'relation', case when lock.relation is null then null else lock.relation::regclass::text end,
              'transactionId', lock.transactionid)), '[]'::json)
            from pg_locks lock where lock.pid = activity.pid and
              (lock.locktype in ('advisory', 'transactionid') or lock.relation = 'heartbeat_runs'::regclass))
        ) order by activity.xact_start asc nulls last), '[]'::json) as sessions,
        coalesce((select json_agg(json_build_object(
          'pid', activity.pid,
          'applicationName', left(regexp_replace(coalesce(activity.application_name, ''), '[^A-Za-z0-9_.-]', '', 'g'), 64),
          'state', coalesce(activity.state, 'unknown'),
          'waitEventType', activity.wait_event_type,
          'waitEvent', activity.wait_event,
          'xactAgeMs', case when activity.xact_start is null then null
            else greatest(0, (extract(epoch from clock_timestamp() - activity.xact_start) * 1000)::int) end,
          'queryAgeMs', case when activity.query_start is null then null
            else greatest(0, (extract(epoch from clock_timestamp() - activity.query_start) * 1000)::int) end
        ) order by activity.xact_start asc nulls last) from pg_stat_activity activity
          where activity.datname = current_database() and activity.pid <> pg_backend_pid()), '[]'::json) as backends
        from pg_stat_activity activity
        where activity.datname = current_database() and activity.pid <> pg_backend_pid()
          and (cardinality(pg_blocking_pids(activity.pid)) > 0 or activity.pid = any(
            select unnest(pg_blocking_pids(waiter.pid)) from pg_stat_activity waiter
            where waiter.datname = current_database() and waiter.pid <> pg_backend_pid()
              and cardinality(pg_blocking_pids(waiter.pid)) > 0
          ) or (activity.xact_start < clock_timestamp() - interval '2 seconds' and exists (
            select 1 from pg_locks held where held.pid = activity.pid and held.relation = 'heartbeat_runs'::regclass
          )))
      `) as unknown as Array<{ sessions: unknown; backends: unknown }>;
      const sessions = sample?.sessions;
      const backends = sample?.backends;
      const hasLockEvidence = Array.isArray(sessions) && sessions.length > 0;
      const backendSampleDue = Array.isArray(backends) && backends.length > 0 && Date.now() - lastPostgresBackendSnapshotAt >= 4_000;
      if (hasLockEvidence || backendSampleDue) {
        lastPostgresBackendSnapshotAt = Date.now();
        const snapshot = { at: new Date().toISOString(), sessions, backends };
        postgresLockSnapshots.push(snapshot);
        if (postgresLockSnapshots.length > 20) postgresLockSnapshots.shift();
        if (input.diagnosticDb)
          console.info("conversation_postgres_backend_observation", JSON.stringify(snapshot));
      }
    } catch {
      // The bounded diagnostic must never alter or mask runtime behavior.
    } finally {
      postgresLockProbeInFlight = false;
    }
  };
  const postgresLockProbeTimer = process.env.PAPERCLIP_RUNTIME_LOCK_DIAGNOSTICS === "1"
    ? setInterval(() => { void probePostgresLocks(); }, 250) : null;
  postgresLockProbeTimer?.unref();
  void probePostgresLocks();
  const heartbeatHost = async () => {
    if (hostHeartbeatInFlight) return await hostHeartbeatInFlight;
    const run = async () => {
      const inventoryRows = await db.select({
        cellId: runtimeCells.id, companyId: runtimeCells.companyId, generation: runtimeCells.generation,
        activeImageDigest: runtimeCells.activeImageDigest, desiredImageDigest: runtimeCells.desiredImageDigest,
        status: runtimeCells.status, capacityProfile: runtimeCells.capacityProfile,
      }).from(runtimeCells).where(and(eq(runtimeCells.runtimeHostId, host.id), isNull(runtimeCells.deletedAt)));
      const profileNames = [...new Set(inventoryRows.map(row => row.capacityProfile))];
      const profiles = profileNames.length ? await db.select().from(runtimeCapacityProfiles)
        .where(inArray(runtimeCapacityProfiles.key, profileNames)) : [];
      const profileByName = new Map(profiles.map(profile => [profile.key, profile]));
      const cells = inventoryRows.map(row => {
        const profile = profileByName.get(row.capacityProfile);
        if (!profile) throw new Error("conversation_software_host_capacity_profile_missing");
        const status = row.status === "HEALTHY" ? "healthy" : row.status === "STOPPED" ? "stopped" :
          row.status === "FENCED" ? "fenced" : row.status === "DEGRADED" || row.status === "FAILED" ? "failed" : "starting";
        return { cellId: row.cellId, companyId: row.companyId, generation: row.generation.toString(),
          imageDigest: row.activeImageDigest ?? row.desiredImageDigest, status,
          cpuMillis: profile.cpuMillis, memoryBytes: profile.memoryBytes.toString(), diskBytes: profile.diskBytes.toString() };
      });
      await runtime.heartbeat(host.id, { agentVersion: "6.0.2", cells });
      hostHeartbeatCount++;
    };
    const inFlight = run().catch(error => { hostHeartbeatFailed = true; throw error; });
    hostHeartbeatInFlight = inFlight;
    try { await inFlight; }
    finally { if (hostHeartbeatInFlight === inFlight) hostHeartbeatInFlight = null; }
  };
  await heartbeatHost();
  let lastProgressSnapshot = "";
  const reportProgress = async () => {
    if (!expectedRunId) return;
    try {
      const diagnosticDb = input.diagnosticDb ?? db;
      const [run] = await diagnosticDb.select({status:heartbeatRuns.status,errorCode:heartbeatRuns.errorCode})
        .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,companyId),eq(heartbeatRuns.id,expectedRunId)));
      const events = await diagnosticDb.select({type:heartbeatRunEvents.eventType,seq:heartbeatRunEvents.seq})
        .from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId,expectedRunId)).orderBy(desc(heartbeatRunEvents.seq)).limit(5);
      const spanEvents = await diagnosticDb.select({type:heartbeatRunEvents.eventType,seq:heartbeatRunEvents.seq,payload:heartbeatRunEvents.payload})
        .from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.runId,expectedRunId),eq(heartbeatRunEvents.eventType,"run.performance.span")))
        .orderBy(desc(heartbeatRunEvents.seq)).limit(32);
      const completedStartupSpans = projectCompletedNativeStartupSpans(spanEvents.map(event => event.payload));
      const runtimeExecuteStream = activeRuntimeExecuteStreams.size ? {
        activeCount: activeRuntimeExecuteStreams.size,
        elapsedMs: Math.min(86_400_000, Date.now() - Math.min(...activeRuntimeExecuteStreams.values())),
        activeSafeOperations: [...activeHostOperations.values()].slice(0, 4).map(operation => ({
          operation: operation.operation, elapsedMs: Math.min(86_400_000, Date.now() - operation.startedAtMs),
        })),
      } : { activeCount: 0, elapsedMs: null, activeSafeOperations: [] };
      const reservations = await diagnosticDb.select({status:orchestrationModelReservations.status,purpose:orchestrationModelReservations.purpose,
        responsePresent:sql<boolean>`${orchestrationModelReservations.providerResponseHash} is not null`})
        .from(orchestrationModelReservations).where(eq(orchestrationModelReservations.conversationRunId,expectedRunId));
      const snapshot=JSON.stringify({stage:preparationStage,run,events:events.map(({type,seq})=>({type,seq})),
        completedStartupSpans,runtimeExecuteStream,reservations,
        hostAction:safeDriveHostObservation(),postgresLockSampleCount:postgresLockSnapshots.length,
        postgresLockSnapshots:postgresLockSnapshots.slice(-4)});
      if(snapshot!==lastProgressSnapshot){lastProgressSnapshot=snapshot;console.info("conversation_software_host_progress",snapshot);}
    } catch {/* progress sampling never controls execution */}
  };
  const hostHeartbeatTimer = setInterval(() => {
    void reportProgress();
    if (!hostHeartbeatInFlight) void heartbeatHost().catch(() => {});
  }, 20_000);
  hostHeartbeatTimer.unref();
  const safeNativeRunnerClosureObservation = () => {
    const witness = nativeRunnerClosureWitness;
    return witness ? {
      present: true, phase: witness.phase, launchMatched: witness.launchMatched,
      identityMatched: witness.identityMatched, runPidStartedAtMatched: witness.runPidStartedAtMatched,
      identityVerdict: witness.identityVerdict, processGone: witness.processGone,
      nonceMatches: witness.nonceMatches, runnerMatches: witness.runnerMatches,
      previousLiveGroupKnown: witness.previousLiveGroupKnown,
      previousLiveSessionKnown: witness.previousLiveSessionKnown,
      processGroupLive: witness.processGroupLive, processSessionLive: witness.processSessionLive,
      fdOrCwdSessionsHolders: witness.fdOrCwdSessionsHolders, fdOrCwdScanComplete: witness.fdOrCwdScanComplete,
      noSessionHandles: witness.noSessionHandles,
      stopCheckerExit: witness.stopCheckerExit, stopReceiptMatched: witness.stopReceiptMatched,
    } : { present: false, phase: "none", launchMatched: false, identityMatched: false,
      runPidStartedAtMatched: false, identityVerdict: "unknown", processGone: false, previousLiveGroupKnown: false,
      nonceMatches: false, runnerMatches: false, previousLiveSessionKnown: false, processGroupLive: null, processSessionLive: null,
      fdOrCwdSessionsHolders: null, fdOrCwdScanComplete: false, noSessionHandles: false,
      stopCheckerExit: null, stopReceiptMatched: false };
  };
  const relayPreflightFacts: Array<{ phase: "start" | "refresh" | "stop" | "none"; nativePreparationPurpose: string | null;
    brokerCredentialPresent: boolean; modelCredentialPresent: boolean; managedOriginPresent: boolean;
    managedOriginMatches: boolean; noBrokerPreparation: boolean; noCredentialEnvironment: boolean;
    exactSessionStop: boolean }> = [];
  const execFacts: Array<{ executable: string; cwdExact: boolean; modelCredentialPresent: boolean;
    managedModelBrokerOriginPresent: boolean; modelBrokerSessionPhase: string | null;
    assignedMcpEnvironmentAbsent: boolean; credentialEnvironmentAbsent: boolean;
    nativePreparationPurpose: string | null; providerPackImageProbe: boolean; providerPackImageRootMatches: boolean;
    exitCode: number | null; timedOut: boolean; erasureFailureGuard: string | null; hostSessionErrorCode: string | null;
    hostSessionErrorDetails?: SafeHostExecErrorDetails }> = [];
  const nativeConformanceStartTupleObservations: Array<{ runId: string; tuple: Record<string, string> }> = [];
  relayHost.on("message", raw => {
    let message: Record<string, any>;
    try { message = JSON.parse(raw.toString()) as Record<string, any>; } catch { return; }
    if (message.type !== "exec_open" || !Array.isArray(message.request?.argv) || typeof message.channelId !== "string") return;
    const request = message.request as Record<string, any>;
    const requestDeadlineMs = typeof request.deadlineAt === "string" ? Date.parse(request.deadlineAt) : Number.NaN;
    const requestEnv = request.env && typeof request.env === "object" ? request.env as Record<string, unknown> : {};
    const requestArgv = request.argv as string[];
    const nativePreparationPurpose = purposeByRequestId.get(request.requestId) ??
      (requestArgv[3] === "paperclip-native-asset-erasure" ? "native_provider_data_erasure" : null);
    const requestLabel = requestArgv[0] === "sh" && requestArgv[1] === "-c" ? requestArgv[3] : null;
    if (expectedRunId && (requestLabel === "paperclip-runner-launch" || request.modelBrokerSession?.phase === "start"))
      nativeRunnerLaunchIntentRunIds.add(expectedRunId);
    relayCommandOwnerByRequestId.set(request.requestId, requestLabel === "paperclip-runner-monitor"
      ? "runner_monitor" : requestLabel === "paperclip-runner-process-identity"
        ? "runner_identity_read" : requestLabel === "paperclip-runner-signal"
          ? "runner_signal" : requestLabel === "paperclip-runner-diagnostics"
            ? "runner_diagnostic_read" : requestLabel === "paperclip-runner-launch"
              ? "runner_launch" : requestLabel === "paperclip-runner-failure-check"
                ? "runner_failure_cleanup" : "other");
    const noBrokerPreparation = ["provider_artifact", "native_harness_state", "native_workspace_prepare", "native_runtime_context_prepare",
      "native_provider_data_erasure", "native_provider_data_erasure_probe", "native_attachment_stage", "native_attachment_cleanup"]
      .includes(nativePreparationPurpose ?? "");
    const managedModelOriginMatches = requestEnv.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN === brokerOrigin &&
      Boolean(request.modelBrokerCredential);
    const noCredentialEnvironment = !Object.keys(requestEnv).some(name =>
      /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|AUTHORIZATION)/i.test(name));
    const credentialFreePreparation = noBrokerPreparation && !managedModelOriginMatches &&
      !request.modelBrokerCredential && !request.brokerCredential && noCredentialEnvironment;
    const sessionStop = request.modelBrokerSession && typeof request.modelBrokerSession === "object"
      ? request.modelBrokerSession as Record<string, unknown> : null;
    const exactSessionStop = Boolean(sessionStop && sessionStop.phase === "stop" &&
      Object.keys(sessionStop).sort().join(",") === "expectedCapabilityHash,leaseId,nativeSessionIdDigest,phase,runnerInstanceId,sessionDeadlineAt,sessionKey" &&
      typeof sessionStop.sessionKey === "string" && /^[a-f0-9]{64}$/.test(sessionStop.sessionKey) &&
      typeof sessionStop.nativeSessionIdDigest === "string" && /^[a-f0-9]{64}$/.test(sessionStop.nativeSessionIdDigest) &&
      typeof sessionStop.expectedCapabilityHash === "string" && /^[a-f0-9]{64}$/.test(sessionStop.expectedCapabilityHash) &&
      typeof sessionStop.runnerInstanceId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionStop.runnerInstanceId) &&
      typeof sessionStop.leaseId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionStop.leaseId) &&
      typeof sessionStop.sessionDeadlineAt === "string" && Number.isFinite(Date.parse(sessionStop.sessionDeadlineAt)));
    const credentialFreeModelSessionStop = exactSessionStop && !managedModelOriginMatches &&
      request.modelBrokerCredential === undefined && request.brokerCredential === undefined && noCredentialEnvironment &&
      requestEnv.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN === undefined;
    if (!managedModelOriginMatches && !credentialFreePreparation && !credentialFreeModelSessionStop) {
      if (sessionStop?.phase === "refresh") relayPreflightFacts.push({
        phase: "refresh",
        nativePreparationPurpose: ["provider_artifact", "native_harness_state", "native_workspace_prepare", "native_runtime_context_prepare",
          "native_provider_data_erasure", "native_provider_data_erasure_probe", "native_attachment_stage", "native_attachment_cleanup"]
          .includes(nativePreparationPurpose ?? "")
          ? nativePreparationPurpose : null,
        brokerCredentialPresent: Boolean(request.brokerCredential),
        modelCredentialPresent: Boolean(request.modelBrokerCredential),
        managedOriginPresent: typeof requestEnv.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN === "string",
        managedOriginMatches: managedModelOriginMatches,
        noBrokerPreparation,
        noCredentialEnvironment,
        exactSessionStop,
      });
      relayHost.send(JSON.stringify({ type: "exec_exit", channelId: message.channelId, exitCode: 126, timedOut: false }));
      return;
    }
    const modelToken = request.modelBrokerCredential?.capabilityToken;
    const modelCredentialPresent = typeof modelToken === "string";
    const argv = request.argv as string[];
    const cwd = typeof request.cwd === "string" && request.cwd.startsWith("/") ? request.cwd : input.root;
    const assignedMcpEnvironmentAbsent = !requestEnv.PAPERCLIP_NATIVE_MCP_NAME &&
      !requestEnv.PAPERCLIP_NATIVE_MCP_URL && !requestEnv.PAPERCLIP_NATIVE_MCP_TOKEN;
    const expectedProviderPackImageRoot = join(providerImageHome, ".local", "share", "paperclip-runner", "provider-pack");
    const providerPackImageProbe = nativePreparationPurpose === "provider_artifact" && argv.length === 5 &&
      (argv[0] === "sh" || argv[0] === "/bin/sh") && argv[1] === "-c" &&
      argv[2] === NATIVE_SELECTED_PROVIDER_PACK_DISCOVERY_SCRIPT &&
      argv[3] === "paperclip-managed-provider-pack";
    const providerPackImageRootMatches = providerPackImageProbe && argv[4] === expectedProviderPackImageRoot;
    const fact = { executable: argv[0] ?? "", cwdExact: cwd === expectedTaskRoot, modelCredentialPresent,
      managedModelBrokerOriginPresent: requestEnv.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN === brokerOrigin,
      modelBrokerSessionPhase: typeof request.modelBrokerSession?.phase === "string" ? request.modelBrokerSession.phase : null,
      assignedMcpEnvironmentAbsent, credentialEnvironmentAbsent: noCredentialEnvironment,
      nativePreparationPurpose, providerPackImageProbe, providerPackImageRootMatches,
      exitCode: null as number | null, timedOut: false, erasureFailureGuard: null as string | null,
      hostSessionErrorCode: null as string | null, hostSessionErrorDetails: undefined as SafeHostExecErrorDetails | undefined };
    execFacts.push(fact);
    if (typeof request.requestId === "string") hostExecErrorFactByRequestId.set(request.requestId, details => {
      fact.hostSessionErrorDetails = details;
    });
    const sessionPhase = request.modelBrokerSession && typeof request.modelBrokerSession === "object"
      ? request.modelBrokerSession.phase : null;
    const launchPath = requestLabel === "paperclip-runner-launch" && typeof requestArgv[4] === "string" ? requestArgv[4] : null;
    const launchNonce = requestLabel === "paperclip-runner-launch" && typeof requestArgv[5] === "string" ? requestArgv[5] : null;
    const launchRunnerId = requestLabel === "paperclip-runner-launch" && typeof requestArgv[6] === "string" ? requestArgv[6] : null;
    const launchSessionKey = typeof request.modelBrokerSession?.sessionKey === "string" ? request.modelBrokerSession.sessionKey : null;
    const launchSessionDigest = typeof request.modelBrokerSession?.nativeSessionIdDigest === "string"
      ? request.modelBrokerSession.nativeSessionIdDigest : null;
    const launchStartBindingDigest = typeof request.modelBrokerSession?.startBindingDigest === "string"
      ? request.modelBrokerSession.startBindingDigest : null;
    const launchLeaseId = typeof request.modelBrokerSession?.leaseId === "string" ? request.modelBrokerSession.leaseId : null;
    const launchSessionDeadlineAt = typeof request.modelBrokerSession?.sessionDeadlineAt === "string"
      ? request.modelBrokerSession.sessionDeadlineAt : null;
    const launchModelRunnerId = typeof request.modelBrokerSession?.runnerInstanceId === "string"
      ? request.modelBrokerSession.runnerInstanceId : null;
    const launchSessionMatch = Boolean(launchPath && expectedTaskRoot &&
      launchPath.startsWith(`${join(expectedTaskRoot, ".paperclip-runtime", "paperclip-runner", "sessions")}/`) &&
      /^\/[\w./-]+\/runner\/runner-process\.identity$/.test(launchPath) &&
      typeof launchNonce === "string" && /^[0-9a-f-]{36}$/i.test(launchNonce) &&
      typeof launchRunnerId === "string" && /^[0-9a-f-]{36}$/i.test(launchRunnerId) &&
      typeof launchSessionKey === "string" && /^[a-f0-9]{64}$/.test(launchSessionKey) &&
      typeof launchSessionDigest === "string" && /^[a-f0-9]{64}$/.test(launchSessionDigest) &&
      typeof launchStartBindingDigest === "string" && /^[a-f0-9]{64}$/.test(launchStartBindingDigest) &&
      typeof launchLeaseId === "string" && /^[0-9a-f-]{36}$/i.test(launchLeaseId) &&
      typeof launchSessionDeadlineAt === "string" && Number.isFinite(Date.parse(launchSessionDeadlineAt)) &&
      launchModelRunnerId === launchRunnerId &&
      launchSessionDigest === launchPath.split("/").at(-3) &&
      sessionPhase === "start" && cwd === expectedTaskRoot && expectedRunId !== null);
    // Native worker launches can use an authenticated chat workspace as well
    // as an ordinary worker workspace. Observe only the exact signed launch's
    // identity path; workspace selection does not change process ownership.
    const launchedWorkerIdentityRead = nativeRunnerClosureWitness !== null &&
      nativeRunnerClosureWitness.runId === expectedRunId && nativePreparationPurpose === null &&
      managedModelOriginMatches &&
      requestLabel === "paperclip-runner-process-identity" && requestArgv.length === 5 &&
      requestArgv[0] === "sh" && requestArgv[1] === "-c" &&
      requestArgv[2] === 'test -f "$1" && test ! -L "$1" && cat -- "$1"' &&
      typeof nativeRunnerClosureWitness?.identityPath === "string" && requestArgv[4] === nativeRunnerClosureWitness.identityPath &&
      cwd === expectedTaskRoot;
    const identityRead = requestLabel === "paperclip-runner-process-identity" && requestArgv.length === 5 &&
      requestArgv[0] === "sh" && requestArgv[1] === "-c" &&
      requestArgv[2] === 'test -f "$1" && test ! -L "$1" && cat -- "$1"' &&
      typeof requestArgv[4] === "string" && cwd === expectedTaskRoot &&
      (nativePreparationPurpose === "native_harness_state" || launchedWorkerIdentityRead);
    const launchedWorkerMonitor = nativeRunnerClosureWitness !== null &&
      nativeRunnerClosureWitness.runId === expectedRunId && nativePreparationPurpose === null &&
      (sessionPhase === "refresh" ? managedModelOriginMatches && Boolean(request.modelBrokerCredential) :
        sessionPhase === "stop" ? exactSessionStop && !request.modelBrokerCredential && !request.brokerCredential && noCredentialEnvironment : false);
    const monitorOperation = requestLabel === "paperclip-runner-monitor" && requestArgv[0] === "sh" && requestArgv[1] === "-c" &&
      requestArgv[2] === REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT && requestArgv.length === 8 &&
      typeof requestArgv[4] === "string" && cwd === expectedTaskRoot &&
      (nativePreparationPurpose === "native_harness_state" || launchedWorkerMonitor);
    const identityOutput: Buffer[] = [];
    let identityOutputBytes = 0;
    let streamStarted = false;
    void (async () => {
      try {
        if (!sessionHostEngine || typeof message.capabilityToken !== "string") throw new Error("sandbox_host_unavailable");
        activeHostExecStreams++;
        streamStarted = true;
        const result = await sessionHostEngine.executeStream({ scope: {
          companyId, bindingId: identity.bindingId, cellId: identity.cellId,
          cellGeneration: identity.cellGeneration, sandboxRef: identity.sandboxRef,
        }, request, capabilityToken: message.capabilityToken }, (stream: "stdout" | "stderr", chunk: Buffer) => {
          if (identityRead && stream === "stdout" && identityOutputBytes + chunk.byteLength <= 2048) {
            identityOutput.push(Buffer.from(chunk)); identityOutputBytes += chunk.byteLength;
          } else if (identityRead && stream === "stdout") identityOutputBytes = 2049;
          if (nativePreparationPurpose === "native_provider_data_erasure" && stream === "stderr") {
            const text = chunk.toString("utf8");
            const identityCleanup = /^remote_identity_cleanup_failed:([a-z_]{1,40}):([0-9]{1,3})\s*$/m.exec(text);
            const erasure = /^remote_erasure_failed:([a-z_]{1,40}):([0-9]{1,3})\s*$/m.exec(text);
            if (identityCleanup) fact.erasureFailureGuard = `process_stop/${identityCleanup[1]}:${identityCleanup[2]}`;
            else if (erasure) fact.erasureFailureGuard = `${erasure[1]}:${erasure[2]}`;
          }
          relayHost.send(JSON.stringify({ type: "exec_output", channelId: message.channelId,
            stream, base64: chunk.toString("base64") }));
        });
        if (launchSessionMatch && result.exitCode === 0 && !result.timedOut && launchPath && launchNonce && launchRunnerId &&
            launchSessionKey && launchSessionDigest && launchStartBindingDigest && launchLeaseId &&
            launchSessionDeadlineAt && launchModelRunnerId &&
            result.modelBrokerSessionReceipt?.sessionKey === launchSessionKey &&
            typeof result.modelBrokerSessionReceipt?.capabilityHash === "string" &&
            /^[a-f0-9]{64}$/.test(result.modelBrokerSessionReceipt.capabilityHash)) {
          const sessionDigest = launchPath.split("/").at(-3) ?? "";
          const expectedIdentityPath = join(expectedTaskRoot!, ".paperclip-runtime", "paperclip-runner", "sessions",
            sessionDigest, "runner", "runner-process.identity");
          nativeRunnerClosureWitness = {
            phase: "launch_observed", launchMatched: launchPath === expectedIdentityPath && /^[a-f0-9]{64}$/.test(sessionDigest),
            nonceMatches: false, runnerMatches: false, identityMatched: false, runPidStartedAtMatched: false, identityVerdict: "unknown",
            previousLiveGroupKnown: false, previousLiveSessionKnown: false, processGone: false,
            processGroupLive: null, processSessionLive: null,
            fdOrCwdSessionsHolders: null, fdOrCwdScanComplete: false, noSessionHandles: false,
            runId: expectedRunId!, taskRoot: expectedTaskRoot!,
            identityPath: launchPath, nonce: launchNonce, runnerId: launchRunnerId,
            sessionKey: launchSessionKey, sessionDigest: launchSessionDigest, leaseId: launchLeaseId,
            sessionDeadlineAt: launchSessionDeadlineAt, expectedCapabilityHash: result.modelBrokerSessionReceipt.capabilityHash,
            pid: null, startedAt: null,
            processFingerprint: null, processGroupId: null, processSessionId: null, stopCheckerExit: null, stopReceiptMatched: false,
            startBindingDigest: launchStartBindingDigest,
          };
        }
        if (identityRead && result.exitCode === 0 && !result.timedOut && identityOutputBytes <= 2048 && nativeRunnerClosureWitness) {
          const witness = nativeRunnerClosureWitness;
          const identityPath = requestArgv[4]!;
          const marker = Buffer.concat(identityOutput).toString("utf8").split(/\r?\n/);
          const pid = Number(marker[1]);
          const startedAt = marker[2];
          const processFingerprint = marker[4];
          const pathMatches = identityPath === witness.identityPath && identityPath === join(expectedTaskRoot!,
            ".paperclip-runtime", "paperclip-runner", "sessions", witness.sessionDigest, "runner", "runner-process.identity");
          const nonceMatches = marker.length >= 5 && marker[0] === witness.nonce;
          const runnerMatches = marker.length >= 5 && marker[3] === witness.runnerId;
          const markerMatches = marker.length >= 5 && nonceMatches && runnerMatches &&
            Number.isSafeInteger(pid) && pid > 0 && typeof startedAt === "string" && Number.isFinite(Date.parse(startedAt)) &&
            typeof processFingerprint === "string" && /^linux:[0-9a-f-]+:\d+$/.test(processFingerprint);
          const group = markerMatches ? nativeProcessGroupSession(pid, requestDeadlineMs) : null;
          witness.nonceMatches = nonceMatches;
          witness.runnerMatches = runnerMatches;
          witness.identityMatched = pathMatches && markerMatches;
          // onSpawn persists the durable run PID/start timestamp only after
          // this marker-read command has returned. Bind those exact fields at
          // the first subsequent successful signed liveness monitor instead.
          witness.runPidStartedAtMatched = false;
          witness.identityVerdict = witness.identityMatched ? "unknown" : "mismatch";
          witness.phase = witness.identityMatched ? "identity_matched" : "invalid";
          witness.pid = markerMatches ? pid : null; witness.startedAt = markerMatches ? startedAt : null;
          witness.processFingerprint = markerMatches ? processFingerprint : null;
          witness.processGroupId = group?.pgid ?? null; witness.processSessionId = group?.sid ?? null;
        }
        if (monitorOperation && nativeRunnerClosureWitness) {
          const witness = nativeRunnerClosureWitness;
          const argsMatch = requestArgv[4] === witness.identityPath && requestArgv[5] === witness.nonce &&
            requestArgv[6] === witness.runnerId && requestArgv[7] === String(witness.pid) &&
            (request.modelBrokerSession?.phase === "refresh" || request.modelBrokerSession?.phase === "stop") &&
            request.modelBrokerSession?.sessionKey === witness.sessionKey &&
            request.modelBrokerSession?.nativeSessionIdDigest === witness.sessionDigest &&
            request.modelBrokerSession?.runnerInstanceId === witness.runnerId &&
            request.modelBrokerSession?.leaseId === witness.leaseId &&
            request.modelBrokerSession?.sessionDeadlineAt === witness.sessionDeadlineAt &&
            request.modelBrokerSession?.expectedCapabilityHash === witness.expectedCapabilityHash &&
            (nativePreparationPurpose === "native_harness_state" || launchedWorkerMonitor);
          if (argsMatch && request.modelBrokerSession?.phase === "refresh" && result.exitCode === 0 && !result.timedOut &&
              witness.identityMatched) {
            const [run] = expectedRunId === witness.runId
              ? await db.select({ processPid: heartbeatRuns.processPid, processStartedAt: heartbeatRuns.processStartedAt })
                .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, witness.runId))).limit(1)
              : [];
            witness.runPidStartedAtMatched = Boolean(run && run.processPid === witness.pid &&
              run.processStartedAt instanceof Date && run.processStartedAt.toISOString() === witness.startedAt);
            const group = witness.pid ? nativeProcessGroupSession(witness.pid, requestDeadlineMs) : null;
            witness.previousLiveGroupKnown = Boolean(witness.runPidStartedAtMatched && group &&
              group.pgid === witness.pid && group.pgid === group.sid);
            witness.previousLiveSessionKnown = Boolean(witness.runPidStartedAtMatched && group && group.sid === witness.pid);
            witness.processGroupId = group?.pgid ?? null; witness.processSessionId = group?.sid ?? null;
            witness.identityVerdict = witness.runPidStartedAtMatched && witness.previousLiveGroupKnown &&
              witness.previousLiveSessionKnown ? "alive" : "mismatch";
            witness.phase = witness.identityVerdict === "alive" ? "alive_observed" : "invalid";
          } else if (argsMatch && result.exitCode === 3 && !result.timedOut && witness.identityMatched &&
              witness.runPidStartedAtMatched && witness.previousLiveGroupKnown && witness.previousLiveSessionKnown &&
              request.modelBrokerSession?.phase === "stop") {
            const marker = readFileSync(witness.identityPath, "utf8").split(/\r?\n/);
            const markerStillMatches = marker.length >= 5 && marker[0] === witness.nonce && marker[1] === String(witness.pid) &&
              marker[2] === witness.startedAt && marker[3] === witness.runnerId && marker[4] === witness.processFingerprint;
            const stopCheck = markerStillMatches && Number.isFinite(requestDeadlineMs) && Date.now() < requestDeadlineMs
              ? spawnSync("sh", ["-c", REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT,
                "paperclip-runner-monitor", witness.identityPath, witness.nonce, witness.runnerId, String(witness.pid)], {
                cwd: witness.taskRoot, encoding: "utf8", timeout: Math.max(1, Math.min(1000, requestDeadlineMs - Date.now())),
                maxBuffer: 16 * 1024,
              }) : null;
            const independentGone = Boolean(stopCheck && !stopCheck.error && stopCheck.signal === null && stopCheck.status === 3 &&
              nativeProcessGone(witness.pid!, requestDeadlineMs));
            const groups = independentGone && witness.processGroupId !== null && witness.processSessionId !== null
              ? nativeGroupSessionLiveCounts(witness.processGroupId, witness.processSessionId, requestDeadlineMs) : null;
            const stopReceiptMatched = Boolean(result.modelBrokerSessionReceipt && request.modelBrokerSession?.phase === "stop" &&
              result.modelBrokerSessionReceipt.sessionKey === witness.sessionKey &&
              result.modelBrokerSessionReceipt.capabilityHash === request.modelBrokerSession.expectedCapabilityHash &&
              result.modelBrokerSessionReceipt.capabilityHash === witness.expectedCapabilityHash);
            if (independentGone && groups?.groupLive === 0 && groups.sessionLive === 0 && stopReceiptMatched) {
              witness.stopCheckerExit = stopCheck!.status;
              witness.stopReceiptMatched = true;
              witness.processGone = true;
              witness.processGroupLive = groups.groupLive; witness.processSessionLive = groups.sessionLive;
              witness.phase = "stop_observed"; witness.identityVerdict = "gone";
            } else { witness.phase = "invalid"; witness.identityVerdict = "mismatch"; }
          }
        }
        if (result.modelBrokerSessionReceipt) modelBrokerSessionReceipts.push({
          phase: request.modelBrokerSession?.phase ?? "unknown",
          sessionKey: result.modelBrokerSessionReceipt.sessionKey,
          capabilityHash: result.modelBrokerSessionReceipt.capabilityHash,
          expiresAt: result.modelBrokerSessionReceipt.expiresAt,
          sessionDeadlineAt: request.modelBrokerSession?.sessionDeadlineAt ?? "",
          nativeSessionIdDigest: typeof request.modelBrokerSession?.nativeSessionIdDigest === "string"
            ? request.modelBrokerSession.nativeSessionIdDigest : null,
          startBindingDigest: typeof request.modelBrokerSession?.startBindingDigest === "string"
            ? request.modelBrokerSession.startBindingDigest : null,
        });
        fact.exitCode = result.exitCode;
        relayHost.send(JSON.stringify({ type: "exec_exit", channelId: message.channelId,
          exitCode: result.exitCode, timedOut: result.timedOut,
          ...(result.modelBrokerSessionReceipt ? { modelBrokerSessionReceipt: result.modelBrokerSessionReceipt } : {}) }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "";
        const safeHostSentinels = new Set(["exec_rejected", "exec_timeout", "exec_unknown", "sandbox_host_unavailable",
          "sandbox_observation_unavailable", "sandbox_operation_unsupported", "sandbox_restart_observation_failed",
          "sandbox_scope_changed", "sandbox_stop_observation_failed"]);
        fact.hostSessionErrorCode = safeHostSentinels.has(errorMessage) ? errorMessage : "unclassified_host_error";
        fact.exitCode = 126;
        relayHost.send(JSON.stringify({ type: "exec_exit", channelId: message.channelId, exitCode: 126, timedOut: false }));
      } finally {
        if (streamStarted) activeHostExecStreams--;
        if (typeof request.requestId === "string") hostExecErrorFactByRequestId.delete(request.requestId);
      }
    })();
  });

  let ordinaryBootstrapClosure: NativeBootstrapSourceClosure | null = null;
  const beforeNativeExecution = async ({ runId, issueId, bootstrapSourceClosure }: {
    runId: string; issueId: string | null; bootstrapSourceClosure?: NativeBootstrapSourceClosure;
  }) => {
    if (ordinaryWorkerMode) {
      if ((input.ordinaryWorkerRunId !== undefined && runId !== input.ordinaryWorkerRunId) || !bootstrapSourceClosure)
        throw new Error("worker_software_host_bootstrap_closure_missing");
      if (ordinaryBootstrapClosure && nativeSha256(ordinaryBootstrapClosure) !== nativeSha256(bootstrapSourceClosure))
        throw new Error("worker_software_host_bootstrap_closure_changed");
      ordinaryBootstrapClosure = structuredClone(bootstrapSourceClosure);
    }
    if (!issueId) throw new Error("conversation_software_host_issue_missing");
    if (!prepareHostForRun) throw new Error("conversation_software_host_admission_unavailable");
    const [lease] = await db.select({ id: environmentLeases.id }).from(environmentLeases)
      .where(and(eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, runId),
        eq(environmentLeases.status, "active"), eq(environmentLeases.environmentId, environment.id))).limit(1);
    if (!lease) throw new Error("conversation_software_host_run_lease_missing");
    await prepareHostForRun(runId, lease.id);
    if (expectedIssueId !== issueId) throw new Error("conversation_software_host_issue_binding_changed");
    return { PATH: `${input.opencodeBinary.slice(0, input.opencodeBinary.lastIndexOf("/"))}:${process.env.PATH ?? ""}`,
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      NODE_EXTRA_CA_CERTS: input.certBundlePath, SSL_CERT_FILE: input.certBundlePath,
      ...(input.brokerProxyOrigin ? { HTTP_PROXY: "", http_proxy: "", HTTPS_PROXY: input.brokerProxyOrigin,
        https_proxy: input.brokerProxyOrigin, ALL_PROXY: "", all_proxy: "",
        NO_PROXY: "localhost,127.0.0.1,::1", no_proxy: "localhost,127.0.0.1,::1" } : {}) };
  };

  const prepareHostForRunOnce = async (runId: string, expectedLeaseId: string) => {
    if (expectedRunId === runId && expectedTaskRoot && acquiredLeaseExpiresAt) {
      if (expectedLeaseIdForRun !== expectedLeaseId)
        throw new Error("conversation_software_host_lease_changed");
      return;
    }
    if (expectedRunId !== null && expectedRunId !== runId)
      throw new Error("conversation_software_host_run_changed");
    expectedRunId = runId;
    expectedLeaseIdForRun = expectedLeaseId;
    preparationStage="read_run";
    const [run] = await db.select({ status: heartbeatRuns.status, runtimeMode: heartbeatRuns.runtimeMode,
      nativeIssueId: heartbeatRuns.nativeIssueId, responsibleUserId: heartbeatRuns.responsibleUserId,
      contextSnapshot: heartbeatRuns.contextSnapshot, runnerProfileJson: heartbeatRuns.runnerProfileJson }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId))).limit(1);
    if (!run || run.status !== "running" || run.runtimeMode !== "native" ||
      run.responsibleUserId !== actor.userId || !run.nativeIssueId)
      throw new Error("conversation_software_host_native_run_binding_invalid");
    if (serialTransport) {
      const profile = run.runnerProfileJson as Record<string, unknown> | null;
      if (!profile?.nativeExecutionInput) throw new Error("serial_model_native_input_missing");
      const next = nativeSha256(profile.nativeExecutionInput);
      if (sealedExecutionInputHash !== null && sealedExecutionInputHash !== next) throw new Error("serial_model_native_input_changed");
      sealedExecutionInputHash = next;
    }
    const runContext = run.contextSnapshot && typeof run.contextSnapshot === "object"
      ? run.contextSnapshot as Record<string, unknown> : {};
    const issueId = nativeConformanceMode ? run.nativeIssueId
      : typeof runContext.issueId === "string" ? runContext.issueId : null;
    if (!issueId || issueId !== run.nativeIssueId)
      throw new Error("conversation_software_host_issue_binding_invalid");
    if (expectedIssueId !== null && expectedIssueId !== issueId)
      throw new Error("conversation_software_host_issue_changed");
    expectedIssueId = issueId;
    const [manifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, runId)).limit(1);
    if (!manifest) throw new Error("conversation_software_host_manifest_missing");
    const conversationGeneration = run?.contextSnapshot && typeof run.contextSnapshot === "object" &&
      "conversationSessionGeneration" in run.contextSnapshot &&
      typeof run.contextSnapshot.conversationSessionGeneration === "number"
        ? run.contextSnapshot.conversationSessionGeneration : null;
    const scope = nativeConformanceMode ? null : await findNativeChatWorkspaceScope(db, {
      adapterType: "paperclip_runner", environmentDriver: "sandbox", companyId, agentId, issueId, runId,
      responsibleUserId: run?.responsibleUserId, conversationSessionGeneration: conversationGeneration });
    let taskRoot = nativeConformanceMode ? null : scope && scope.projectId === null ? nativeChatWorkspaceCwd(scope, null, false) : null;
    if (ordinaryWorkerMode) {
      const workerRun = await assertOrdinaryWorker(runId);
      if (scope) throw new Error("worker_software_host_workspace_owner_changed");
      const profile = workerRun.runnerProfileJson as Record<string, unknown> | null;
      const execution = profile?.nativeExecutionInput as { binding?: { companyId?: string; agentId?: string; runId?: string; issueId?: string;
        executionWorkspaceId?: string }; workspace?: { cwd?: string; repoUrl?: unknown; repoRef?: unknown; branchName?: unknown };
        task?: unknown } | undefined;
      if (execution?.binding?.companyId !== companyId || execution.binding.agentId !== agentId || execution.binding.runId !== runId ||
        execution.binding.issueId !== issueId || !execution.workspace)
        throw new Error("worker_software_host_workspace_binding_invalid");
      if (!input.ordinaryWorkerProject && (execution.workspace.cwd !== workspaceBoundaryRoot ||
          execution.workspace.repoUrl !== null || execution.workspace.repoRef !== null || execution.workspace.branchName !== null))
        throw new Error("worker_software_host_workspace_binding_invalid");
      // The executor seals the dispatch receipt after this preparation callback.
      // Use its exact server-collected bootstrap closure, bound to the persisted Task envelope.
      if (!ordinaryBootstrapClosure || !execution.task ||
          ordinaryBootstrapClosure.taskEnvelopeDigest !== nativeSha256(execution.task))
        throw new Error("worker_software_host_bootstrap_task_changed");
      const workspaceSources = ordinaryBootstrapClosure.sourceSet.inputs.filter((source): source is Extract<NativePayloadSourceInput, { kind: "workspace_metadata" }> => source.kind === "workspace_metadata" &&
        source.runId === runId && source.executionWorkspaceId === execution.binding!.executionWorkspaceId);
      if (workspaceSources.length !== 1 || workspaceSources.some(source => source.kind !== "workspace_metadata" ||
        (source.origin !== "agent_home" && source.origin !== "execution_workspace")))
        throw new Error("worker_software_host_workspace_source_invalid");
      // Infrastructure preparation precedes the first dispatch receipt. Check
      // the canonical workspace owner here; the executor checks the full bootstrap at dispatch.
      if (input.ordinaryWorkerProject && workspaceSources[0]?.origin !== "execution_workspace")
        throw new Error("worker_software_host_project_workspace_source_invalid");
      taskRoot = await db.transaction(async tx => {
        const root = input.ordinaryWorkerProject
          ? await assertManagedNativeProjectWorkspace({ db: tx, actor, companyId, agentId, runId, issueId,
              leaseId: expectedLeaseId, project: input.ordinaryWorkerProject, execution,
              bootstrapSourceClosure: ordinaryBootstrapClosure })
          : workspaceBoundaryRoot;
        await assertNativeWorkspaceMetadataSourcesCurrent(tx, companyId, workspaceSources);
        return root;
      });
    }
    if (nativeConformanceMode) {
      const conformance = await assertFixtureNativeOpenCodeConformance(input, runId, expectedLeaseId);
      const expectedExecution = conformance.execution;
      if (scope || expectedExecution.provider?.kind !== "opencode" ||
          expectedExecution.workspace?.cwd !== conformance.workspace.remoteCwd ||
          expectedExecution.binding?.executionWorkspaceId !== conformance.workspace.workspaceId ||
          conformance.workspace.taskRoot !== conformance.workspace.localCwd)
        throw new Error("conformance_software_host_workspace_binding_invalid");
      taskRoot = expectedExecution.workspace.cwd;
    }
    if (!taskRoot) throw new Error("conversation_software_host_private_task_root_missing");
    expectedTaskRoot = taskRoot;
    if (nativeConformanceMode) {
      preparationStage = "verify_prequalified_conformance_host";
      const conformance = await assertFixtureNativeOpenCodeConformance(input, runId, expectedLeaseId);
      const [currentBinding] = await db.select().from(runtimeSandboxBindings).where(and(
        eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.id, binding.id),
        eq(runtimeSandboxBindings.runtimeCellId, cell.id),
        eq(runtimeSandboxBindings.cellGeneration, cell.generation.toString()))).limit(1);
      if (!currentBinding || !["ready", "running"].includes(currentBinding.status) || currentBinding.backend !== "openshell" ||
          currentBinding.createdByUserId !== baseQualificationActor.userId || currentBinding.boundaryPolicy.credentials.mode !== "brokered" ||
          currentBinding.boundaryPolicy.credentials.bindings.length !== 0 ||
          currentBinding.boundaryPolicy.filesystem.writePaths.length !== 1 ||
          currentBinding.boundaryPolicy.filesystem.writePaths[0] !== workspaceBoundaryRoot ||
          !currentBinding.boundaryPolicy.filesystem.readPaths.includes(workspaceBoundaryRoot) ||
          conformance.execution.workspace?.cwd !== taskRoot || conformance.workspace.taskRoot !== conformance.workspace.localCwd)
        throw new Error("conformance_software_host_prequalified_binding_changed");
      binding = currentBinding;
      preparationStage = "prepared_by_native_conformance_owner";
      return;
    }
    preparationStage="resolve_runtime_broker";
    const resolvedRuntimeBroker=await qualificationGateway.resolveSandboxCredentialBrokerPolicyBindings({companyId,agentId,runId,
      responsibleUserId:actor.userId!,presenceId:runtimePresence.id,bindings:[{...runtimeBrokerBinding,grantVersionHash:"0".repeat(64)}]});
    const grantVersionHash=resolvedRuntimeBroker.authorizedConnectionGrantHashes[runtimeConnection.connection.id];
    assert.ok(grantVersionHash);assert.ok(resolvedRuntimeBroker.bindings[0]?.allowedTools.includes(runtimeConnection.toolName));
    preparationStage="create_binding";
    await createBindingForRun({...runtimeBrokerBinding,grantVersionHash}, taskRoot);
    preparationStage="qualify";await qualifyHost();preparationStage="compile";
    const boundary = policyFixture(); boundary.riskClass = "C3"; boundary.requiredControls = [...conversationRequiredControls];
    boundary.filesystem.readPaths = [...new Set([taskRoot, "/.openshell/runtime/openshell-sandbox", ...runtimeBrokerBinaryReadPaths])].sort();
    boundary.filesystem.writePaths = [taskRoot];
    boundary.process.allowedBinaries = []; boundary.process.allowedSyscalls = []; boundary.network.destinations = [];
    const candidate = structuredClone(boundary);
    candidate.network.destinations = [{ hostname: new URL(brokerOrigin).hostname,
      port: Number(new URL(brokerOrigin).port || 443), methods: ["POST"], pathPrefixes: ["/runtime-tools/model/v1/messages"] }];
    const compiled = await service.compile(actor, companyId, binding.id, { expectedVersion: binding.version,
      executionManifestId: manifest.id, candidatePolicy: candidate });
    if (compiled.status !== "qualified") {
      const proof = compiled.compilation as { proverResult?: unknown; failedBoundaries?: unknown; unsupportedFeatures?: unknown } | null;
      const safeNames = (value: unknown) => Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string" && /^[a-z0-9_:-]{1,80}$/.test(entry)).slice(0, 24)
        : [];
      throw new Error(`conversation_software_host_policy_compile_failed_${JSON.stringify({
        status: compiled.status,
        proverResult: proof && typeof proof.proverResult === "string" ? proof.proverResult : null,
        failedBoundaries: safeNames(proof?.failedBoundaries),
        unsupportedFeatures: safeNames(proof?.unsupportedFeatures),
      })}`);
    }
    const projectedAdmission = projectOpenShellPolicy(compiled.compilation.compiledPolicy,
      compiled.compilation.modelBrokerEndpoint, compiled.compilation.credentialBrokerEndpoints);
    console.info("conversation_software_host_admission_projection", JSON.stringify({
      unsupportedFeatures: projectedAdmission.unsupportedFeatures.filter(value => /^[a-z0-9_:-]{1,80}$/.test(value)).slice(0, 32),
      modelEndpointPresent: Boolean(compiled.compilation.modelBrokerEndpoint),
      modelBinaryCount: compiled.compilation.modelBrokerEndpoint?.binaries?.length ?? 0,
      appEndpointCount: compiled.compilation.credentialBrokerEndpoints?.length ?? 0,
    }));
    preparationStage="inspect";
    const observedBeforeAdmission = await driveHost(transport.bridge(actor).inspect(identity));
    preAdmissionObservation = { state: observedBeforeAdmission.state,
      generationMatches: observedBeforeAdmission.generation === identity.cellGeneration,
      imageDigestMatches: observedBeforeAdmission.imageDigest === imageDigest,
      controlsHealthy: observedBeforeAdmission.controlsHealthy };
    if (observedBeforeAdmission.state !== "stopped" || observedBeforeAdmission.generation !== identity.cellGeneration ||
      observedBeforeAdmission.imageDigest !== imageDigest || !observedBeforeAdmission.controlsHealthy)
      throw new Error(`conversation_software_host_pre_admission_observation_invalid_${JSON.stringify(preAdmissionObservation)}`);
    preparationStage="admit";
    const admittedPromise = service.admit(actor, companyId, binding.id, { expectedVersion: binding.version + 1, policySnapshotId: compiled.id });
    const admitted = await driveHost(admittedPromise);
    if (admitted.binding.status !== "running") throw new Error("conversation_software_host_workload_not_running");
    if (!nativeConformanceMode) {
      const expectedVersion = binding.version + 1;
      const claimKey = `v7-sandbox-admission:${binding.id}:${cell.generation}:${expectedVersion}:${compiled.id}`;
      const [claim] = await db.select().from(activityLog).where(and(
        eq(activityLog.companyId, companyId), eq(activityLog.entityType, "runtime_sandbox"),
        eq(activityLog.entityId, binding.id), eq(activityLog.action, "sandbox.admission_claimed"),
        sql`${activityLog.details}->>'claimKey' = ${claimKey}`)).limit(1);
      const claimDetails = claim?.details && typeof claim.details === "object" && !Array.isArray(claim.details)
        ? claim.details as Record<string, unknown> : {};
      const [policy] = await db.select().from(runtimePolicySnapshots).where(and(
        eq(runtimePolicySnapshots.companyId, companyId), eq(runtimePolicySnapshots.id, compiled.id),
        eq(runtimePolicySnapshots.bindingId, binding.id), eq(runtimePolicySnapshots.executionManifestId, manifest.id),
        eq(runtimePolicySnapshots.status, "qualified"))).limit(1);
      const prepareRows = await db.select().from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, companyId), eq(runtimeHostCommands.runtimeHostId, host.id),
        eq(runtimeHostCommands.runtimeCellId, cell.id), eq(runtimeHostCommands.cellGeneration, BigInt(cell.generation)),
        eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"),
        sql`${runtimeHostCommands.payload}->>'action' = 'prepare'`,
        sql`${runtimeHostCommands.payload}->'provisioning'->>'purpose' = 'admission'`,
        sql`${runtimeHostCommands.payload}->'provisioning'->>'operationKey' = ${claimKey}`));
      const prepareRequest = prepareRows.length === 1 ? sandboxHostRequestSchema.safeParse(prepareRows[0]!.payload) : null;
      const prepareReply = prepareRows.length === 1 ? sandboxHostReplySchema.safeParse(prepareRows[0]!.safeResult) : null;
      const request = prepareRequest?.success ? prepareRequest.data : null;
      const reply = prepareReply?.success ? prepareReply.data : null;
      const [start] = admitted.operationId ? await db.select().from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, companyId), eq(runtimeHostCommands.id, admitted.operationId),
        eq(runtimeHostCommands.runtimeHostId, host.id), eq(runtimeHostCommands.runtimeCellId, cell.id),
        eq(runtimeHostCommands.cellGeneration, BigInt(cell.generation)),
        eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"))) : [];
      const startRequestResult = start ? sandboxHostRequestSchema.safeParse(start.payload) : null;
      const startReplyResult = start ? sandboxHostReplySchema.safeParse(start.safeResult) : null;
      const startRequest = startRequestResult?.success ? startRequestResult.data : null;
      const startReply = startReplyResult?.success ? startReplyResult.data : null;
      const claimVersion = Number(claimDetails.claimVersion);
      if (!claim || claim.actorType !== "user" || claim.actorId !== actor.userId || claimDetails.claimKey !== claimKey ||
          claimDetails.expectedVersion !== expectedVersion || claimDetails.claimVersion !== claimVersion ||
          claimVersion !== expectedVersion + 1 || admitted.binding.version !== claimVersion + 1 ||
          claimDetails.generation !== cell.generation.toString() || claimDetails.policySnapshotId !== compiled.id ||
          claimDetails.executionManifestId !== manifest.id || claimDetails.executionManifestHash !== manifest.hash ||
          !policy || !request || !reply || request.action !== "prepare" || reply.action !== "prepare" ||
          request.scope.companyId !== companyId || request.scope.bindingId !== binding.id || request.scope.cellId !== cell.id ||
          request.scope.cellGeneration !== cell.generation.toString() || request.hostEpoch !== host.credentialVersion ||
          request.imageDigest !== reply.imageDigest || reply.hostEpoch !== host.credentialVersion ||
          reply.bindingVersion !== claimVersion || reply.requiresRecreate || !reply.sandboxId || !reply.containerId ||
          request.provisioning?.operationKey !== claimKey || request.provisioning.bindingVersion !== claimVersion ||
          request.provisioning.policyHash !== policy.policyHash || policy.policyHash !== claimDetails.policyHash)
        throw new Error("conversation_software_host_prepared_admission_owner_missing");
      if (!start || !startRequest || !startReply || startRequest.action !== "start" || startReply.action !== "start" ||
          startRequest.scope.bindingId !== binding.id || startRequest.scope.cellGeneration !== cell.generation.toString() ||
          startRequest.hostEpoch !== host.credentialVersion || startRequest.imageDigest !== request.imageDigest ||
          startRequest.start?.idempotencyKey !== `v7-sandbox-start:${binding.id}:${cell.generation}:${claimVersion}:${compiled.id}` ||
          startRequest.start.policyHash !== policy.policyHash || startReply.sandboxId !== reply.sandboxId ||
          startReply.containerId !== reply.containerId || startReply.imageDigest !== request.imageDigest ||
          startReply.policyHash !== policy.policyHash)
        throw new Error("conversation_software_host_prepared_admission_start_receipt_missing");
      setupAdmissionOwner = { bindingId: binding.id, cellId: cell.id, generation: cell.generation.toString(),
        hostId: host.id, claimKey, claimVersion, bindingVersion: admitted.binding.version, startCommandId: start.id,
        policySnapshotId: compiled.id, policyHash: policy.policyHash,
        manifestId: manifest.id, manifestHash: manifest.hash, hostEpoch: host.credentialVersion,
        imageDigest: request.imageDigest, sandboxId: reply.sandboxId, containerId: reply.containerId,
        requesterUserId: actor.userId! };
    }
    preparationStage="admitted_lease";
    const [lease] = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
      eq(environmentLeases.id, expectedLeaseId), eq(environmentLeases.heartbeatRunId, runId),
      eq(environmentLeases.environmentId, environment.id), eq(environmentLeases.status, "active"))).limit(1);
    if (!lease) throw new Error("conversation_software_host_run_lease_missing");
    if (!lease.expiresAt || lease.expiresAt <= new Date())
      throw new Error("conversation_software_host_provider_lease_expiry_missing");
    acquiredLeaseExpiresAt = lease.expiresAt.toISOString();
    const expectDenied = async (work: Promise<unknown>) => {
      try { await work; return false; } catch { return true; }
    };
    preparationStage="negative_run";
    const wrongRunDenied = await expectDenied(runtime.executeSandboxTask({ companyId, runId: randomUUID(), leaseId: lease.id,
      command: "true", cwd: taskRoot, timeoutMs: 1000 }));
    preparationStage="negative_lease";
    const wrongLeaseDenied = await expectDenied(runtime.executeSandboxTask({ companyId, runId, leaseId: randomUUID(),
      command: "true", cwd: taskRoot, timeoutMs: 1000 }));
    // An existing child is valid for a generic Worker; a missing path would
    // only test ENOENT. Conversation/session-start exact-root guards stay separate.
    // The controlled Native backend consumes no model capability. Keep Host
    // admission/negative/Stop proofs, without claiming this positive model probe.
    if (ordinaryWorkerMode && typeof input.controlledNativeSessionBackendFactory !== "function") {
      const allowedChild = mkdtempSync(join(taskRoot, ".native-cwd-child-"));
      try {
        preparationStage="allowed_child_cwd";
        const acceptedChild = await runtime.executeSandboxTask({ companyId, runId, leaseId: lease.id,
          command: "sh", args: ["-c", "true"], cwd: allowedChild, timeoutMs: 10_000 });
        if (!acceptedChild || acceptedChild.exitCode !== 0 || acceptedChild.timedOut) {
          try { console.info("ordinary_worker_allowed_child_cwd_failure", JSON.stringify({
            resultIsNull: acceptedChild === null,
            exitCode: acceptedChild && Number.isSafeInteger(acceptedChild.exitCode) ? acceptedChild.exitCode : null,
            timedOut: acceptedChild ? acceptedChild.timedOut : null,
          })); } catch {/* diagnostics cannot alter the original assertion */}
        }
        assert.ok(acceptedChild && acceptedChild.exitCode === 0 && !acceptedChild.timedOut,
          "ordinary_worker_allowed_child_cwd_rejected");
      } finally { rmSync(allowedChild, { recursive: true, force: true }); }
    }
    const outsideCwd = mkdtempSync(join(input.root, ".native-cwd-outside-"));
    let wrongCwdDenied = false;
    try {
      const outsideAllowed = [...compiled.compilation.compiledPolicy.filesystem.readPaths,
        ...compiled.compilation.compiledPolicy.filesystem.writePaths].some(root => {
          const relative = posix.relative(posix.normalize(root), posix.normalize(outsideCwd));
          return relative === "" || (relative !== ".." && !relative.startsWith("../") && !posix.isAbsolute(relative));
        });
      assert.equal(outsideAllowed, false, "negative_cwd_probe_must_be_outside_current_policy");
      try {
        preparationStage="negative_cwd";
        await runtime.executeSandboxTask({ companyId, runId, leaseId: lease.id,
          command: "true", cwd: outsideCwd, timeoutMs: 1000 });
      } catch (error) {
        const details = error && typeof error === "object" && "details" in error ? error.details : null;
        wrongCwdDenied = Boolean(error && typeof error === "object" && "status" in error && error.status === 403 &&
          details && typeof details === "object" && "code" in details && details.code === "sandbox_execution_cwd_outside_policy");
        if (!wrongCwdDenied) throw error;
      }
    } finally { rmSync(outsideCwd, { recursive: true, force: true }); }
    const execCountBeforeStartProbes = execFacts.length;
    preparationStage="negative_session_command";
    const wrongSessionStartCommandDenied = await expectDenied(runtime.executeSandboxTask({ companyId, runId, leaseId: lease.id,
      command: "sh", args: ["-c", "exit 0", "paperclip-not-runner-launch"], cwd: taskRoot, timeoutMs: 1000,
      nativePreparationPurpose: "native_session_start" }));
    preparationStage="negative_session_root";
    const wrongSessionStartRootDenied = await expectDenied(runtime.executeSandboxTask({ companyId, runId, leaseId: lease.id,
      command: "sh", args: ["-c", "exit 0", "paperclip-runner-launch"], cwd: `${taskRoot}/outside`, timeoutMs: 1000,
      nativePreparationPurpose: "native_session_start" }));
    const wrongSessionStartExecuted = execFacts.length !== execCountBeforeStartProbes;
    const broadened = structuredClone(candidate);
    broadened.filesystem.writePaths = ["/"];
    const wrongPolicy = compileSandboxPolicy({ boundary, candidate: broadened, capabilities: capabilities() as any,
      authorizedConnectionGrantHashes: {}, credentialBrokerOrigin: brokerOrigin, credentialBrokerBindings: [], sourcePolicyRefs: [] });
    const wrongPolicyDenied = wrongPolicy.failedBoundaries.includes("filesystem_write_expansion");
    negativeAdmissionControls={wrongRunDenied,wrongLeaseDenied,wrongCwdDenied,wrongPolicyDenied};
    if (!wrongRunDenied || !wrongLeaseDenied || !wrongCwdDenied || !wrongPolicyDenied ||
      !wrongSessionStartCommandDenied || !wrongSessionStartRootDenied || wrongSessionStartExecuted) {
      try {
        if (process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1")
          console.info("managed_native_negative_admission_control_failed", JSON.stringify({
            wrongRunDenied, wrongLeaseDenied, wrongCwdDenied, wrongPolicyDenied,
            wrongSessionStartCommandDenied, wrongSessionStartRootDenied, wrongSessionStartExecuted,
          }));
      } catch { /* Keep the original admission failure authoritative. */ }
      throw new Error("conversation_software_host_negative_admission_control_failed");
    }
    negativeNativeSessionStartControls = { wrongCommandDenied: wrongSessionStartCommandDenied,
      wrongRootDenied: wrongSessionStartRootDenied, noExecution: !wrongSessionStartExecuted };
    preparationStage="prepared";
  };
  prepareHostForRun = async (runId, leaseId) => {
    const existing = hostAdmissionByRun.get(runId);
    if (existing) {
      if (existing.leaseId !== leaseId) throw new Error("conversation_software_host_lease_binding_changed");
      return await existing.promise;
    }
    const promise = prepareHostForRunOnce(runId, leaseId);
    hostAdmissionByRun.set(runId, { leaseId, promise });
    try {
      await promise;
    } catch (error) {
      const chain:Record<string,unknown>[]=[];
      let current:unknown=error;
      for(let depth=0;depth<4 && current && typeof current === "object";depth++){
        const row=current as Record<string,unknown>;
        const reason=typeof row.reasonCode === "string" ? row.reasonCode : typeof row.code === "string" ? row.code : null;
        chain.push({name:current instanceof Error ? current.name : "unknown",
          reason:reason && /^[A-Za-z][A-Za-z0-9_:-]{0,99}$/.test(reason) ? reason : null,
          failureClass:safeSandboxFailureClass(current),sourceFrames:safeErrorSourceFrames(current)});
        current=row.cause;
      }
      const failure={phase:preparationStage,chain,hostAction:safeDriveHostObservation(),
        postgresLockSampleCount:postgresLockSnapshots.length,
        hostLifecycleObservations:hostLifecycleObservations.slice(-12)};sandboxExecutionFailures.push(failure);
      if(process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1")console.error("conversation_software_host_preparation_failed",JSON.stringify(failure));
      hostAdmissionByRun.delete(runId);
      throw error;
    }
  };


  let activeModelRequests = 0;
  const verifiedModelProvider = async () => {
      if (!expectedRunId || !binding || !activeHostIdentity || observedSandboxPhase !== "Ready")
        throw new Error("sandbox_session_provider_not_running");
      const [runningRun] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId),
        eq(heartbeatRuns.id, expectedRunId), eq(heartbeatRuns.status, "running"))).limit(1);
      if (!runningRun) throw new Error("sandbox_session_provider_not_running");
      const names = [...attachedSessionProviders].filter(name => name.startsWith("awms-"));
      if (names.length !== 1) throw new Error("sandbox_session_provider_observation_unavailable");
      const provider = sessionProviders.get(names[0]!);
      if (!provider?.credential || !provider.expiresAt || Date.parse(provider.expiresAt) <= Date.now())
        throw new Error("sandbox_session_provider_credential_unavailable");
      const claims = provider.family ? verifyRuntimeToolsToken(provider.credential, provider.family) : null;
      if (!claims || claims.scope !== provider.family || claims.company_id !== companyId || claims.run_id !== expectedRunId ||
        claims.sub !== agentId || claims.exp * 1000 <= Date.now())
        throw new Error("sandbox_session_provider_authority_changed");
      return { runId: expectedRunId, claims, token: provider.credential };
  };

  const assertProvenNotLaunchedRun = async (leaseId: string) => {
      // Native selection persists the logical runner/session IDs and the
      // observed phase before a process starts. This branch proves that exact
      // prelaunch state; it never manufactures a PID or Stop receipt.
      if (!expectedRunId || !expectedTaskRoot || nativeRunnerClosureWitness ||
          nativeRunnerLaunchIntentRunIds.has(expectedRunId) || activeHostExecStreams !== 0 || activeRuntimeExecuteStreams.size !== 0 ||
          activeHostOperations.size !== 0 || activeModelRequests !== 0 || modelProviderRequestCount !== 0 ||
          attachedSessionProviders.size !== 0 || modelBrokerSessionReceipts.length !== 0 ||
          [...nativeSessionBackingByKey.values()].some(session => session.runId === expectedRunId))
        throw new Error("scheduler_unlaunched_native_run_host_proof_incomplete");
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.id, expectedRunId))).limit(1);
      const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
        ? run.runnerProfileJson as Record<string, unknown> : {};
      let execution: ReturnType<typeof parseNativeExecutionInput> | null = null;
      try { execution = parseNativeExecutionInput(profile.nativeExecutionInput); } catch { /* Fail closed below. */ }
      const recovery = run?.resultJson && typeof run.resultJson === "object" && !Array.isArray(run.resultJson)
        ? (run.resultJson as Record<string, unknown>).executionRecovery : null;
      const recoveryFacts = recovery && typeof recovery === "object" && !Array.isArray(recovery)
        ? recovery as Record<string, unknown> : {};
      const context = run?.contextSnapshot && typeof run.contextSnapshot === "object" && !Array.isArray(run.contextSnapshot)
        ? run.contextSnapshot as Record<string, unknown> : {};
      const [lease] = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
        eq(environmentLeases.id, leaseId), eq(environmentLeases.heartbeatRunId, expectedRunId),
        eq(environmentLeases.environmentId, environment.id))).limit(1);
      const events = await db.select({ eventType: heartbeatRunEvents.eventType, payload: heartbeatRunEvents.payload,
        stream: heartbeatRunEvents.stream, level: heartbeatRunEvents.level, message: heartbeatRunEvents.message,
        sourceInstanceId: heartbeatRunEvents.sourceInstanceId, sourceEventId: heartbeatRunEvents.sourceEventId,
        sourceSeq: heartbeatRunEvents.sourceSeq, sourcePayloadSha256: heartbeatRunEvents.sourcePayloadSha256,
        protocolSchemaVersion: heartbeatRunEvents.protocolSchemaVersion })
        .from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.companyId, companyId), eq(heartbeatRunEvents.runId, expectedRunId)));
      const coordinatorRows = run?.nativeIssueId ? await db.select().from(nativeRunFinalizations).where(and(
        eq(nativeRunFinalizations.companyId, companyId), eq(nativeRunFinalizations.issueId, run.nativeIssueId),
        eq(nativeRunFinalizations.runId, expectedRunId))).limit(2) : [];
      const coordinator = coordinatorRows.length === 1 ? coordinatorRows[0] : null;
      const failureDetail = coordinator?.failureDetail && typeof coordinator.failureDetail === "object" && !Array.isArray(coordinator.failureDetail)
        ? coordinator.failureDetail as Record<string, unknown> : {};
      const sourceAuthority = profile.nativeOpenCodeSourceAuthority && typeof profile.nativeOpenCodeSourceAuthority === "object" &&
        !Array.isArray(profile.nativeOpenCodeSourceAuthority) ? profile.nativeOpenCodeSourceAuthority as Record<string, any> : {};
      const artifactAuthority = sourceAuthority.artifactAuthority && typeof sourceAuthority.artifactAuthority === "object" &&
        !Array.isArray(sourceAuthority.artifactAuthority) ? sourceAuthority.artifactAuthority as Record<string, any> : {};
      const providerPack = artifactAuthority.providerPackManifest;
      const opencodeArtifact = providerPack?.payload?.artifacts?.opencodeExecutable;
      const sourceAuthorityMatches = Boolean(run && execution && sourceAuthority.version === 1 &&
        sourceAuthority.executionInputHash === nativeSha256(profile.nativeExecutionInput) &&
        artifactAuthority.installedPackRoot === join(providerImageHome, ".local", "share", "paperclip-runner", "provider-pack") &&
        typeof artifactAuthority.runnerSha256 === "string" && /^[a-f0-9]{64}$/.test(artifactAuthority.runnerSha256) &&
        providerPack?.schema === REMOTE_PROVIDER_PACK_SCHEMA && /^sha256:[a-f0-9]{64}$/.test(providerPack?.digest ?? "") &&
        providerPack?.payload?.pins?.opencode === MANAGED_NATIVE_OPENCODE_IMAGE_PIN.version &&
        opencodeArtifact?.path === REMOTE_PROVIDER_PACK_ARTIFACT_PATHS.opencodeExecutable &&
        opencodeArtifact?.sha256 === `sha256:${MANAGED_NATIVE_OPENCODE_IMAGE_PIN.sha256}`);
      const remoteLocator = profile.nativeRemoteRuntimeAssetLocator;
      const remoteLocatorMatches = Boolean(run && lease && isRemoteRuntimeAssetLocator(remoteLocator, { companyId, runId: run.id }) &&
        remoteLocator.environmentId === environment.id && remoteLocator.environmentLeaseId === lease.id &&
        remoteLocator.provider === lease.provider && remoteLocator.providerLeaseId === lease.providerLeaseId &&
        remoteLocator.runnerInstanceId === run.runnerInstanceId &&
        remoteLocator.remoteCwdDigest === createHash("sha256").update(expectedTaskRoot).digest("hex") &&
        execution?.session.normalizedSessionId &&
        remoteLocator.normalizedSessionIdDigest === createHash("sha256").update(execution.session.normalizedSessionId).digest("hex"));
      const nativeBootstrapExhausted = Boolean(run && coordinator && sourceAuthorityMatches && remoteLocatorMatches &&
        coordinator.attempt === 3 && coordinator.phase === "terminal_failure" &&
        coordinator.failureCode === "native_session_retry_exhausted" && coordinator.recoveryState === "blocked" &&
        coordinator.leaseOwner === null && coordinator.leaseExpiresAt === null && coordinator.nextAttemptAt === null &&
        coordinator.resultId === null && coordinator.assessmentId === null && coordinator.decisionId === null &&
        failureDetail.originalFailureCode === "provider_initialize_protocol_error" &&
        failureDetail.recoveryMode === "bootstrap_retry" && failureDetail.providerSessionEstablished === false &&
        failureDetail.providerEventsExist === false && failureDetail.checkpointExists === false &&
        run.status === "failed" && run.runtimeMode === "native" && run.nativeIssueId === context.issueId &&
        run.errorCode === "provider_initialize_protocol_error" && run.nativePhase === "terminal_failure" &&
        run.finishedAt !== null && run.nativeInputSourceProtocolVersion === 0 && run.sessionIdAfter === null);
      const safePrelaunchSpans = new Set(["heartbeat.queue", "comment.to_run_created", "question_response.to_run_created",
        "heartbeat.prepare_before_environment", "heartbeat.prepare_after_environment", "skills.prepare", "environment.acquire",
        "environment.workspace.realize", "sandbox.lifecycle.selected", "environment.startup"]);
      const nativeBootstrapSpanNames = new Set(["task.prepare", "native.coordinator.claim", "native.session.execute",
        "runner.session.startup", "runner.runtime.stage", "task.settle", "task.run.measured",
        "runner.transport.resolve", "runner.transport.selected", "runner.transport.connect", "runner.artifact.prepare",
        "runner.artifact.verify", "session.checkpoint.restore", "stage.asset.home", "stage.sync"]);
      const spans = events.filter(event => event.eventType === "run.performance.span");
      const prelaunchSpanCounts = new Map<string, number>();
      const bootstrapAdmissionEvents = events.filter(event => event.eventType === PROCESS_START_REQUESTED);
      const eventsArePrelaunchOnly = events.every(event => {
        if (event.eventType === "lifecycle" || event.eventType === "error") return true;
        // This fixture injects failure before Native session admission: there is
        // no process-start intent and no Native remote-workload-stopped projection.
        if (event.eventType === PROCESS_START_REQUESTED || event.eventType === NATIVE_REMOTE_WORKLOAD_STOPPED) return false;
        if (event.eventType === PROCESS_IDENTITY_RECORDED) return false;
        if (event.eventType !== "run.performance.span" || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload))
          return false;
        const payload = event.payload as Record<string, unknown>;
        if (payload.schema !== "paperclip.run-performance-span.v1" || typeof payload.span !== "string" ||
            typeof payload.durationMs !== "number" || !Number.isFinite(payload.durationMs) || payload.durationMs < 0 ||
            !(payload.outcome === "ok" || payload.outcome === "failed" || payload.outcome === "cancelled")) return false;
        const bootstrapSpan = nativeBootstrapSpanNames.has(payload.span);
        if (!bootstrapSpan && !safePrelaunchSpans.has(payload.span)) return false;
        const count = (prelaunchSpanCounts.get(payload.span) ?? 0) + 1;
        prelaunchSpanCounts.set(payload.span, count);
        // Retry reconstructs preparation and input-latency spans as well as
        // Native startup spans; each remains bounded by the actual attempts.
        return count <= (nativeBootstrapExhausted ? coordinator!.attempt : 1);
      }) && (nativeBootstrapExhausted
        ? bootstrapAdmissionEvents.length === 0 &&
          spans.length <= (safePrelaunchSpans.size + nativeBootstrapSpanNames.size) * coordinator!.attempt
        : bootstrapAdmissionEvents.length === 0 && spans.length === prelaunchSpanCounts.size);
      const hostExecutions = await db.select({ id: runtimeHostCommands.id, idempotencyKey: runtimeHostCommands.idempotencyKey,
        status: runtimeHostCommands.status, completedAt: runtimeHostCommands.completedAt,
        payload: runtimeHostCommands.payload, safeResult: runtimeHostCommands.safeResult }).from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, companyId), eq(runtimeHostCommands.commandType, "sandbox_exec"),
        sql`${runtimeHostCommands.payload}->>'runId' = ${expectedRunId}`));
      const allowedPrelaunchPurposes = new Set(["provider_artifact", "native_workspace_prepare", "native_runtime_context_prepare",
        "native_harness_state", "native_attachment_stage", "native_attachment_cleanup"]);
      const noPaidOrLaunchHostCommand = hostExecutions.every(command => {
        const payload = command.payload && typeof command.payload === "object" && !Array.isArray(command.payload)
          ? command.payload as Record<string, unknown> : {};
        const safeResult = command.safeResult && typeof command.safeResult === "object" && !Array.isArray(command.safeResult)
          ? command.safeResult as Record<string, unknown> : {};
        const admission = setupAdmissionOwner;
        return !!admission && command.status === "SUCCEEDED" && !!command.completedAt && payload.kind === "sandbox_exec_v1" &&
          payload.requestId === command.idempotencyKey && payload.runId === expectedRunId && payload.leaseId === leaseId &&
          payload.bindingId === admission.bindingId && payload.cellId === admission.cellId &&
          payload.generation === admission.generation && payload.hostId === admission.hostId &&
          payload.hostEpoch === admission.hostEpoch && payload.manifestId === admission.manifestId &&
          payload.manifestHash === admission.manifestHash && payload.policySnapshotId === admission.policySnapshotId &&
          payload.policyHash === admission.policyHash && typeof payload.commandDigest === "string" &&
          /^[a-f0-9]{64}$/.test(payload.commandDigest) &&
          typeof payload.nativePreparationPurpose === "string" && allowedPrelaunchPurposes.has(payload.nativePreparationPurpose) &&
          Number.isSafeInteger(safeResult.exitCode) && safeResult.timedOut === false;
      });
      const preparedSdkWorkspace = hostExecutions.some(command => command.payload && typeof command.payload === "object" &&
        !Array.isArray(command.payload) && (command.payload as Record<string, unknown>).nativePreparationPurpose === "native_workspace_prepare");
      const modelReservations = await db.select({ id: orchestrationModelReservations.id }).from(orchestrationModelReservations)
        .where(and(eq(orchestrationModelReservations.companyId, companyId), or(
          eq(orchestrationModelReservations.conversationRunId, expectedRunId),
          inArray(orchestrationModelReservations.workerAttemptId, db.select({ id: orchestrationWorkerAttempts.id })
            .from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, companyId),
              eq(orchestrationWorkerAttempts.runId, expectedRunId)))))));
      const nativeResults = await db.select({ id: nativeRunResults.id }).from(nativeRunResults).where(and(
        eq(nativeRunResults.companyId, companyId), eq(nativeRunResults.runId, expectedRunId))).limit(1);
      const dispatchIntents = profile.nativeModelInputDispatchIntents;
      const noDispatchReceipt = run?.nativeInputSourceProtocolVersion === 0 &&
        (dispatchIntents === undefined || Array.isArray(dispatchIntents) && dispatchIntents.length === 0) &&
        profile.nativeInputSourceReceipt == null &&
        (profile.nativeToolCallDispatchAssociations === undefined ||
          Array.isArray(profile.nativeToolCallDispatchAssociations) && profile.nativeToolCallDispatchAssociations.length === 0);
      const logicalIdentityMatches = Boolean(run && execution &&
        execution.binding.companyId === companyId && execution.binding.runId === run.id &&
        execution.binding.agentId === agentId && execution.binding.issueId === run.nativeIssueId &&
        execution.session.normalizedSessionId && execution.session.normalizedSessionId === run.nativeSessionId &&
        typeof run.runnerInstanceId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(run.runnerInstanceId));
      const noProcessIdentity = run && run.nativePhaseUpdatedAt !== null &&
        run.processPid === null && run.processGroupId === null && run.processStartedAt === null &&
        run.sessionIdAfter === null && ((run.nativePhase === "observed" && run.nativeProcessCleanupPending !== true) ||
          (nativeBootstrapExhausted && run.nativePhase === "terminal_failure"));
      const observedBootstrapFailure = run?.nativePhase === "observed" &&
        recoveryFacts.kind === "bootstrap" && recoveryFacts.providerWorkStarted === false;
      const noLaunchEvidence = run?.status === "failed" && run.runtimeMode === "native" && run.nativeIssueId === context.issueId &&
        run.finishedAt !== null && logicalIdentityMatches && noProcessIdentity && noDispatchReceipt &&
        (observedBootstrapFailure || nativeBootstrapExhausted) && eventsArePrelaunchOnly &&
        modelReservations.length === 0 && nativeResults.length === 0 &&
        (nativeBootstrapExhausted ? noPaidOrLaunchHostCommand && preparedSdkWorkspace
          : hostExecutions.length === 0);
      const leaseOutcomeMatches = nativeConformanceMode
        ? lease?.status === (run?.status === "cancelled" && lease?.leasePolicy !== "reuse_by_environment" ? "expired" : "released") && !lease.failureReason
        : lease?.leasePolicy === "reuse_by_environment"
          ? lease.status === "released" && !lease.failureReason
          : lease?.status === "expired" && lease.failureReason === "paperclip_runner_destroy_after_turn";
      if (!noLaunchEvidence || !lease || !leaseOutcomeMatches || lease.cleanupStatus !== "success" || !lease.releasedAt) {
        if (process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1")
          console.warn("native_prelaunch_closure_diagnostic", { nativeBootstrapExhausted,
            sourceAuthorityMatches, remoteLocatorMatches, logicalIdentityMatches, noProcessIdentity, noDispatchReceipt,
            eventsArePrelaunchOnly, noPaidOrLaunchHostCommand, preparedSdkWorkspace,
            modelReservationCount: modelReservations.length, nativeResultCount: nativeResults.length,
            spans: [...prelaunchSpanCounts], eventTypes: [...new Set(events.map(event => event.eventType))],
            hostExecutionCount: hostExecutions.length, hostFactCount: execFacts.length,
            hostCommandOutcomes: hostExecutions.map(command => ({ status: command.status,
              purpose: (command.payload as Record<string, unknown> | null)?.nativePreparationPurpose,
              exitCode: (command.safeResult as Record<string, unknown> | null)?.exitCode })),
            leaseOutcomeMatches, leaseStatus: lease?.status, leasePolicy: lease?.leasePolicy,
            cleanupStatus: lease?.cleanupStatus, leaseReleased: !!lease?.releasedAt });
        throw new Error("scheduler_unlaunched_native_run_database_proof_incomplete");
      }
      if (nativeBootstrapExhausted) {
        // The actual hook fails before session admission. Verify the distinct
        // setup-container owner and signed Stop/Inspect receipt; never create a
        // synthetic Native process-stop record or weaken started-session proof.
        if (!remoteLocatorMatches || !lease.metadata?.remoteExecutionTermination)
          throw new Error("scheduler_native_bootstrap_prelaunch_stop_missing");
        const proof = await verifyNativeBootstrapPrelaunchRuntimeState(db,
          { companyId, runId: expectedRunId, leaseId }, lease.metadata.remoteExecutionTermination);
        const stopped = proof.prelaunchStop;
        if (stopped.owner.runId !== expectedRunId || stopped.owner.leaseId !== leaseId ||
            typeof stopped.runtimeOperationId !== "string" || !stopped.runtimeOperationId || bootstrapAdmissionEvents.length !== 0)
          throw new Error("scheduler_native_bootstrap_prelaunch_runtime_owner_missing");
        const [settledRun] = await db.select().from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.id, expectedRunId))).limit(1);
        const nativeStopEvents = await db.select({ id: heartbeatRunEvents.id }).from(heartbeatRunEvents).where(and(
          eq(heartbeatRunEvents.companyId, companyId), eq(heartbeatRunEvents.runId, expectedRunId),
          inArray(heartbeatRunEvents.eventType, [PROCESS_START_REQUESTED, NATIVE_REMOTE_WORKLOAD_STOPPED, PROCESS_IDENTITY_RECORDED])));
        if (!settledRun || settledRun.nativeProcessCleanupPending === true || nativeStopEvents.length !== 0)
          throw new Error("scheduler_native_bootstrap_prelaunch_created_native_lifecycle_evidence");
        return;
      }
      const storedTermination = lease.metadata?.remoteExecutionTermination as Record<string, unknown> | undefined;
      const storedSandboxStop = storedTermination?.sandboxStop as Record<string, unknown> | undefined;
      if (nativeConformanceMode || !setupAdmissionOwner || storedSandboxStop?.runtimeOperationId)
        throw new Error("scheduler_unlaunched_native_setup_admission_owner_unavailable");
      const setupOwner = setupAdmissionOwner;
      const [currentBinding] = await db.select().from(runtimeSandboxBindings).where(and(
        eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.id, setupOwner.bindingId),
        eq(runtimeSandboxBindings.runtimeCellId, setupOwner.cellId),
        eq(runtimeSandboxBindings.cellGeneration, setupOwner.generation))).limit(1);
      const [currentCell] = await db.select().from(runtimeCells).where(and(
        eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, setupOwner.cellId),
        eq(runtimeCells.generation, BigInt(setupOwner.generation)), eq(runtimeCells.runtimeHostId, setupOwner.hostId))).limit(1);
      const stopIdempotencyKey = `unlaunched-run-close:${expectedRunId}:${leaseId}:${setupOwner.claimVersion}`;
      const priorStopOperations = await db.select().from(runtimeOperations).where(and(
        eq(runtimeOperations.companyId, companyId), eq(runtimeOperations.runtimeCellId, setupOwner.cellId),
        eq(runtimeOperations.operationType, "stop"), eq(runtimeOperations.idempotencyKey, stopIdempotencyKey))).limit(2);
      const priorStop = priorStopOperations.length === 1 ? priorStopOperations[0] : null;
      const claims = await db.select().from(activityLog).where(and(
        eq(activityLog.companyId, companyId), eq(activityLog.entityType, "runtime_sandbox"),
        eq(activityLog.entityId, setupOwner.bindingId), eq(activityLog.action, "sandbox.admission_claimed")))
        .orderBy(desc(activityLog.createdAt), desc(activityLog.id)).limit(2);
      const latestDetails = claims[0]?.details && typeof claims[0].details === "object" && !Array.isArray(claims[0].details)
        ? claims[0].details as Record<string, unknown> : {};
      const [currentPolicy] = await db.select().from(runtimePolicySnapshots).where(and(
        eq(runtimePolicySnapshots.companyId, companyId), eq(runtimePolicySnapshots.id, setupOwner.policySnapshotId),
        eq(runtimePolicySnapshots.bindingId, setupOwner.bindingId), eq(runtimePolicySnapshots.executionManifestId, setupOwner.manifestId))).limit(1);
      const [currentManifest] = await db.select().from(agentExecutionManifests).where(and(
        eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.id, setupOwner.manifestId),
        eq(agentExecutionManifests.runId, expectedRunId), eq(agentExecutionManifests.agentId, agentId))).limit(1);
      const prepared = await db.select().from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, companyId), eq(runtimeHostCommands.runtimeHostId, setupOwner.hostId),
        eq(runtimeHostCommands.runtimeCellId, setupOwner.cellId),
        eq(runtimeHostCommands.cellGeneration, BigInt(setupOwner.generation)),
        eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"),
        sql`${runtimeHostCommands.payload}->>'action' = 'prepare'`,
        sql`${runtimeHostCommands.payload}->'provisioning'->>'purpose' = 'admission'`,
        sql`${runtimeHostCommands.payload}->'provisioning'->>'operationKey' = ${setupOwner.claimKey}`));
      const preparedRequest = prepared.length === 1 ? sandboxHostRequestSchema.safeParse(prepared[0]!.payload) : null;
      const preparedReply = prepared.length === 1 ? sandboxHostReplySchema.safeParse(prepared[0]!.safeResult) : null;
      const prepareRequest = preparedRequest?.success ? preparedRequest.data : null;
      const prepareReply = preparedReply?.success ? preparedReply.data : null;
      const [start] = await db.select().from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, companyId), eq(runtimeHostCommands.id, setupOwner.startCommandId),
        eq(runtimeHostCommands.runtimeHostId, setupOwner.hostId), eq(runtimeHostCommands.runtimeCellId, setupOwner.cellId),
        eq(runtimeHostCommands.cellGeneration, BigInt(setupOwner.generation)),
        eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"))).limit(1);
      const startRequestResult = start ? sandboxHostRequestSchema.safeParse(start.payload) : null;
      const startReplyResult = start ? sandboxHostReplySchema.safeParse(start.safeResult) : null;
      const startRequest = startRequestResult?.success ? startRequestResult.data : null;
      const startReply = startReplyResult?.success ? startReplyResult.data : null;
      const pendingHostEffects = await db.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, companyId), eq(runtimeHostCommands.runtimeHostId, setupOwner.hostId),
        eq(runtimeHostCommands.runtimeCellId, setupOwner.cellId),
        eq(runtimeHostCommands.cellGeneration, BigInt(setupOwner.generation)),
        eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), inArray(runtimeHostCommands.status, ["PENDING", "CLAIMED"]),
        sql`${runtimeHostCommands.payload}->'scope'->>'bindingId' = ${setupOwner.bindingId}`));
      if (!currentBinding || currentBinding.status !== (priorStop ? "stopped" : "running") ||
          (priorStop ? currentBinding.version <= setupOwner.bindingVersion : currentBinding.version !== setupOwner.bindingVersion) ||
          !currentCell || currentCell.status !== (priorStop ? "STOPPED" : "HEALTHY") ||
          (currentCell.activeImageDigest ?? currentCell.desiredImageDigest) !== setupOwner.imageDigest ||
          latestDetails.claimKey !== setupOwner.claimKey ||
          claims[0]!.actorType !== "user" || claims[0]!.actorId !== setupOwner.requesterUserId ||
          latestDetails.policySnapshotId !== setupOwner.policySnapshotId || latestDetails.policyHash !== setupOwner.policyHash ||
          latestDetails.executionManifestId !== setupOwner.manifestId || latestDetails.executionManifestHash !== setupOwner.manifestHash ||
          !currentPolicy || currentPolicy.policyHash !== setupOwner.policyHash ||
          currentPolicy.status !== (priorStop ? "revoked" : "qualified") || !currentManifest ||
          currentManifest.hash !== setupOwner.manifestHash || !prepareRequest || !prepareReply ||
          prepareRequest.action !== "prepare" || prepareReply.action !== "prepare" ||
          prepareRequest.hostEpoch !== setupOwner.hostEpoch || prepareRequest.imageDigest !== setupOwner.imageDigest ||
          prepareRequest.scope.bindingId !== setupOwner.bindingId || prepareRequest.scope.cellGeneration !== setupOwner.generation ||
          prepareRequest.provisioning?.operationKey !== setupOwner.claimKey ||
          prepareRequest.provisioning.bindingVersion !== setupOwner.claimVersion || prepareReply.hostEpoch !== setupOwner.hostEpoch ||
          prepareReply.imageDigest !== setupOwner.imageDigest || prepareReply.sandboxId !== setupOwner.sandboxId ||
          prepareReply.containerId !== setupOwner.containerId || prepareReply.requiresRecreate ||
          !start || !startRequest || !startReply || startRequest.action !== "start" || startReply.action !== "start" ||
          startRequest.scope.bindingId !== setupOwner.bindingId || startRequest.scope.cellGeneration !== setupOwner.generation ||
          startRequest.start?.policyHash !== setupOwner.policyHash ||
          startRequest.start?.idempotencyKey !== `v7-sandbox-start:${setupOwner.bindingId}:${setupOwner.generation}:${setupOwner.claimVersion}:${setupOwner.policySnapshotId}` ||
          startReply.sandboxId !== setupOwner.sandboxId || startReply.containerId !== setupOwner.containerId ||
          startReply.imageDigest !== setupOwner.imageDigest || startReply.policyHash !== setupOwner.policyHash || pendingHostEffects.length !== 0)
        throw new Error("scheduler_unlaunched_native_setup_admission_target_changed");
      // The ordinary fixture owns this prepared Sandbox as the authenticated
      // setup Human. Its service Stop records the real Host Stop, independent
      // Inspect, and canonical runtime operation without inventing a Native
      // session cleanup receipt for a session that never started.
      if (!priorStop) {
        const stopped = await driveHost(service.stop(actor, companyId, setupOwner.bindingId, stopIdempotencyKey));
        if (!stopped.stopConfirmed || stopped.binding.status !== "stopped")
          throw new Error("scheduler_unlaunched_native_setup_admission_stop_unconfirmed");
      }
      const [stopOperation] = await db.select().from(runtimeOperations).where(and(
        eq(runtimeOperations.companyId, companyId), eq(runtimeOperations.runtimeCellId, setupOwner.cellId),
        eq(runtimeOperations.operationType, "stop"), eq(runtimeOperations.idempotencyKey, stopIdempotencyKey))).limit(1);
      const [stoppedBinding] = await db.select().from(runtimeSandboxBindings).where(and(
        eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.id, setupOwner.bindingId),
        eq(runtimeSandboxBindings.runtimeCellId, setupOwner.cellId), eq(runtimeSandboxBindings.cellGeneration, setupOwner.generation)));
      const [stoppedCell] = await db.select().from(runtimeCells).where(and(
        eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, setupOwner.cellId),
        eq(runtimeCells.generation, BigInt(setupOwner.generation)), eq(runtimeCells.runtimeHostId, setupOwner.hostId)));
      const remainingPolicies = await db.select({ id: runtimePolicySnapshots.id }).from(runtimePolicySnapshots).where(and(
        eq(runtimePolicySnapshots.companyId, companyId), eq(runtimePolicySnapshots.bindingId, setupOwner.bindingId),
        inArray(runtimePolicySnapshots.status, ["draft", "qualified"])));
      const stopCommandId = stopOperation?.desiredState && typeof stopOperation.desiredState === "object"
        ? (stopOperation.desiredState as Record<string, unknown>).sandboxHostCommandId : null;
      const stopCommand = typeof stopCommandId === "string" ? await db.select().from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, companyId), eq(runtimeHostCommands.id, stopCommandId),
        eq(runtimeHostCommands.runtimeHostId, setupOwner.hostId), eq(runtimeHostCommands.runtimeCellId, setupOwner.cellId),
        eq(runtimeHostCommands.cellGeneration, BigInt(setupOwner.generation)),
        eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"))).limit(1) : [];
      const stopRequest = stopCommand.length === 1 ? sandboxHostRequestSchema.safeParse(stopCommand[0]!.payload) : null;
      const stopReply = stopCommand.length === 1 ? sandboxHostReplySchema.safeParse(stopCommand[0]!.safeResult) : null;
      const inspectCommands = await db.select().from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, companyId), eq(runtimeHostCommands.runtimeHostId, setupOwner.hostId),
        eq(runtimeHostCommands.runtimeCellId, setupOwner.cellId),
        eq(runtimeHostCommands.cellGeneration, BigInt(setupOwner.generation)),
        eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"),
        sql`${runtimeHostCommands.payload}->>'action' = 'inspect'`,
        sql`${runtimeHostCommands.createdAt} >= (select stopped.completed_at from runtime_host_commands stopped where stopped.id = ${stopCommandId ?? "00000000-0000-0000-0000-000000000000"})`))
        .orderBy(runtimeHostCommands.createdAt).limit(2);
      const inspectCommand = inspectCommands.length === 1 ? inspectCommands[0] : null;
      const inspectRequest = inspectCommand ? sandboxHostRequestSchema.safeParse(inspectCommand.payload) : null;
      const inspectReply = inspectCommand ? sandboxHostReplySchema.safeParse(inspectCommand.safeResult) : null;
      const stopPayload = stopRequest?.success ? stopRequest.data : null;
      const stopResult = stopReply?.success ? stopReply.data : null;
      const inspectPayload = inspectRequest?.success ? inspectRequest.data : null;
      const inspectResult = inspectReply?.success ? inspectReply.data : null;
      const stopOriginalStartOwnerMatches = Boolean(stopPayload && startRequest &&
        nativeSha256(stopPayload.scope) === nativeSha256(startRequest.scope) &&
        stopPayload.hostEpoch === startRequest.hostEpoch && stopPayload.imageDigest === startRequest.imageDigest &&
        stopPayload.requesterUserId === startRequest.requesterUserId &&
        stopPayload.requesterUserId === setupOwner.requesterUserId);
      const inspectOriginalStartOwnerMatches = Boolean(inspectPayload && startRequest &&
        nativeSha256(inspectPayload.scope) === nativeSha256(startRequest.scope) &&
        inspectPayload.hostEpoch === startRequest.hostEpoch && inspectPayload.imageDigest === startRequest.imageDigest &&
        inspectPayload.requesterUserId === startRequest.requesterUserId &&
        inspectPayload.requesterUserId === setupOwner.requesterUserId);
      const desired = stopOperation?.desiredState && typeof stopOperation.desiredState === "object"
        ? stopOperation.desiredState as Record<string, unknown> : {};
      if (!stopOperation || stopOperation.status !== "SUCCEEDED" || stopOperation.requestedByType !== "user" ||
          stopOperation.requestedById !== actor.userId || desired.sandboxBindingId !== setupOwner.bindingId ||
          desired.generation !== setupOwner.generation || desired.claimKey !== setupOwner.claimKey ||
          desired.policySnapshotId !== setupOwner.policySnapshotId || desired.executionManifestId !== setupOwner.manifestId ||
          desired.executionManifestHash !== setupOwner.manifestHash || desired.policyHash !== setupOwner.policyHash ||
          stoppedBinding?.status !== "stopped" || stoppedCell?.status !== "STOPPED" || remainingPolicies.length !== 0 ||
          stopPayload?.action !== "stop" || !stopOriginalStartOwnerMatches ||
          stopResult?.action !== "stop" || stopResult.stopped !== true || !stopCommand[0]?.completedAt || !inspectPayload ||
          inspectPayload.action !== "inspect" || !inspectOriginalStartOwnerMatches ||
          inspectResult?.action !== "inspect" || inspectResult.state !== "stopped" ||
          inspectResult.generation !== setupOwner.generation || inspectResult.imageDigest !== setupOwner.imageDigest ||
          inspectResult.policyHash !== setupOwner.policyHash || !inspectCommand?.completedAt ||
          inspectCommand.createdAt < stopCommand[0]!.completedAt)
        throw new Error("scheduler_unlaunched_native_setup_admission_stop_receipt_invalid");
      const [currentLease] = await db.select().from(environmentLeases).where(and(
        eq(environmentLeases.companyId, companyId), eq(environmentLeases.id, leaseId),
        eq(environmentLeases.heartbeatRunId, expectedRunId), eq(environmentLeases.environmentId, environment.id))).limit(1);
      if (!currentLease || currentLease.cleanupStatus !== "success" || !currentLease.releasedAt)
        throw new Error("scheduler_unlaunched_native_cleanup_lease_not_settled");
  };

  const assertClosedRun = async (leaseId: string) => {
      if (!nativeRunnerClosureWitness) {
        await assertProvenNotLaunchedRun(leaseId);
        return;
      }
      if (!expectedRunId || !expectedTaskRoot || activeHostExecStreams !== 0 || activeModelRequests !== 0 ||
          attachedSessionProviders.size !== 0 || !nativeRunnerClosureWitness ||
          nativeRunnerClosureWitness.runId !== expectedRunId || nativeRunnerClosureWitness.leaseId !== leaseId ||
          !["stop_observed", "gone_verified"].includes(nativeRunnerClosureWitness.phase) || !nativeRunnerClosureWitness.stopReceiptMatched ||
          !nativeRunnerClosureWitness.identityMatched || !nativeRunnerClosureWitness.runPidStartedAtMatched ||
          !nativeRunnerClosureWitness.pid || !nativeRunnerClosureWitness.processGroupId || !nativeRunnerClosureWitness.processSessionId) {
        if (process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1") {
          console.info("native_previous_host_closure_facts", JSON.stringify({
            ...safeNativeRunnerClosureObservation(),
            runMatches: nativeRunnerClosureWitness.runId === expectedRunId,
            leaseMatches: nativeRunnerClosureWitness.leaseId === leaseId,
            activeHostExecStreams, activeModelRequests,
            attachedSessionProviderCount: attachedSessionProviders.size,
            pidPresent: Boolean(nativeRunnerClosureWitness.pid),
            processGroupPresent: Boolean(nativeRunnerClosureWitness.processGroupId),
            processSessionPresent: Boolean(nativeRunnerClosureWitness.processSessionId),
          }));
        }
        throw new Error("scheduler_previous_host_not_closed");
      }
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.id, expectedRunId))).limit(1);
      const [lease] = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
        eq(environmentLeases.id, leaseId), eq(environmentLeases.heartbeatRunId, expectedRunId),
        eq(environmentLeases.environmentId, environment.id))).limit(1);
      const leaseOutcomeMatches = nativeConformanceMode
        ? lease?.status === (run?.status === "cancelled" && lease?.leasePolicy !== "reuse_by_environment" ? "expired" : "released") && !lease.failureReason
        : lease?.leasePolicy === "reuse_by_environment"
          ? lease.status === "released" && !lease.failureReason
          : lease?.status === "expired" && lease.failureReason === "paperclip_runner_destroy_after_turn";
      if (!run || !["succeeded", "failed", "cancelled"].includes(run.status) || run.nativeProcessCleanupPending ||
          !lease || !leaseOutcomeMatches || lease.cleanupStatus !== "success" || !lease.releasedAt)
        throw new Error("scheduler_previous_run_not_settled");
      await verifyNativeCleanupRuntimeState(db, { companyId, runId: expectedRunId, leaseId }, lease.metadata?.remoteExecutionTermination);
      const witness = nativeRunnerClosureWitness;
      const deadlineMs = Date.now() + 2_000;
      const sourceRoot = join(expectedTaskRoot, ".paperclip-runtime", "paperclip-runner", "sessions", witness.sessionDigest);
      const upperRoot = fixtureOverlayPath(sourceRoot);
      const groups = nativeGroupSessionLiveCounts(witness.processGroupId!, witness.processSessionId!, deadlineMs);
      const handles = await observeNativeSessionHandles(sourceRoot, upperRoot, deadlineMs);
      if (!nativeProcessGone(witness.pid!, deadlineMs) || groups?.groupLive !== 0 || groups.sessionLive !== 0 ||
          !handles.complete || handles.holders !== 0 || activeHostExecStreams !== 0)
        throw new Error("scheduler_previous_run_process_closure_unverified");
  };

  if (nativeConformanceMode) {
    // Establish one operator-owned physical boundary before the provider
    // conformance Run exists. The hidden Run can only narrow this immutable
    // namespace boundary; its internal Sandbox owner supplies the exact
    // manifest, model-broker-only policy, and live-run admission later.
    preparationStage = "prequalify_conformance_namespace";
    const boundaryPolicy = policyFixture();
    boundaryPolicy.riskClass = "C3";
    boundaryPolicy.requiredControls = [...conversationRequiredControls];
    boundaryPolicy.filesystem.readPaths = [...new Set([workspaceBoundaryRoot,
      "/.openshell/runtime/openshell-sandbox", ...runtimeBrokerBinaryReadPaths])].sort();
    boundaryPolicy.filesystem.writePaths = [workspaceBoundaryRoot];
    boundaryPolicy.process.allowedBinaries = [];
    boundaryPolicy.process.allowedSyscalls = [];
    boundaryPolicy.network.destinations = [];
    // Qualify the broker with its setup-only canary and an empty connection
    // allowlist. The actual conformance policy narrows this to credentials:none.
    boundaryPolicy.credentials = { mode: "brokered", bindings: [] };
    const [retained] = await db.select().from(runtimeSandboxBindings).where(and(
      eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.runtimeCellId, cell.id),
      eq(runtimeSandboxBindings.cellGeneration, cell.generation.toString()))).limit(1);
    if (retained) {
      if (!["ready", "running", "stopped"].includes(retained.status) || retained.backend !== "openshell" ||
          retained.createdByUserId !== baseQualificationActor.userId || retained.boundaryPolicyHash !== nativeSha256(boundaryPolicy) ||
          retained.boundaryPolicy.credentials.mode !== "brokered" || retained.boundaryPolicy.credentials.bindings.length !== 0 ||
          !retained.capabilitySnapshot || !retained.qualificationRunId)
        throw new Error("conversation_software_host_conformance_namespace_changed");
      binding = retained;
      const [report] = await db.select({ status: sandboxQualificationRuns.status, suiteVersion: sandboxQualificationRuns.suiteVersion,
        evidenceKind: sandboxQualificationRuns.evidenceKind, results: sandboxQualificationRuns.results,
        exceptions: sandboxQualificationRuns.exceptions }).from(sandboxQualificationRuns).where(and(
          eq(sandboxQualificationRuns.companyId, companyId), eq(sandboxQualificationRuns.bindingId, retained.id),
          eq(sandboxQualificationRuns.id, retained.qualificationRunId))).limit(1);
      if (!report || report.status !== "passed" || report.evidenceKind !== "protected_host_report")
        throw new Error("conversation_software_host_conformance_qualification_changed");
      qualificationEvidence = { bindingStatus: retained.status, reportStatus: report.status, suiteVersion: report.suiteVersion,
        evidenceKind: report.evidenceKind, results: Array.isArray(report.results) ? report.results : [],
        exceptions: Array.isArray(report.exceptions) ? report.exceptions : [], hostCapabilityObservations,
        softwareProbeObservations, credentialProbeResponses: qualificationToolResponses.map(({caseId,status,reasonCode,replayDenied}) =>
          ({caseId,status,reasonCode,replayDenied:replayDenied ?? null})), hostFailureCodes: [] };
    } else {
      binding = await service.create(baseQualificationActor, companyId, { runtimeCellId: cell.id,
        expectedCellGeneration: cell.generation.toString(), backend: "openshell", profile: "development", boundaryPolicy });
    }
    identity.bindingId = binding.id;
    identity.sandboxRef = binding.sandboxRef ?? `aw-v7-${binding.id}`;
    await db.update(runtimeCells).set({ providerBindingId }).where(eq(runtimeCells.id, cell.id));
    await initializeSessionHostEngine();
    if (!retained) {
      preparationStage = "qualify_conformance_namespace";
      await qualifyHost(baseQualificationActor);
    }
    if (!["ready", "running", "stopped"].includes(binding.status) || binding.boundaryPolicy.credentials.mode !== "brokered" ||
        binding.boundaryPolicy.credentials.bindings.length !== 0)
      throw new Error("conversation_software_host_conformance_namespace_not_qualified");
    // The fixture's setup Human qualifies the physical boundary above. The
    // hidden conformance Run is executed as its ordinary Human owner, who is
    // deliberately absent from this Sandbox service's configured-operator
    // list. Only the exact private bootstrap method can admit that Run.
    sandboxOperatorUserIds.splice(0, sandboxOperatorUserIds.length);
  }

  return {
    prepareNativeOpenCodeConformanceRun: (currentActor: AuthorizationActor,
      bootstrap: Parameters<typeof service.prepareNativeOpenCodeConformanceRun>[1]) =>
      driveHost(service.prepareNativeOpenCodeConformanceRun(currentActor, bootstrap)),
    configuredSandboxOperatorUserIds: () => [...sandboxOperatorUserIds],
    leaseExpiryForRun: (runStartedAt: Date, callerDeadlineAt: Date) => {
      const runStartedAtMs = runStartedAt instanceof Date ? runStartedAt.getTime() : Number.NaN;
      const callerDeadlineAtMs = callerDeadlineAt instanceof Date ? callerDeadlineAt.getTime() : Number.NaN;
      const wallClockSeconds = policyFixture().resources.wallClockSeconds;
      if (!Number.isFinite(runStartedAtMs) || !Number.isFinite(callerDeadlineAtMs) ||
          !Number.isSafeInteger(wallClockSeconds) || wallClockSeconds < 1)
        throw new Error("conversation_software_host_lease_deadline_invalid");
      const expiryAtMs = Math.min(callerDeadlineAtMs, runStartedAtMs + wallClockSeconds * 1000);
      if (!Number.isFinite(expiryAtMs) || expiryAtMs <= Date.now())
        throw new Error("conversation_software_host_lease_deadline_expired");
      return new Date(expiryAtMs);
    },
    writeWorkspaceCopybackFixtureFile: async (scope: { runId: string; leaseId: string; workspaceId: string }) => {
      if (scope.runId !== expectedRunId || scope.leaseId !== expectedLeaseIdForRun || !expectedTaskRoot || !sessionOverlayUpperDir)
        throw new Error("conversation_workspace_copyback_fixture_owner_mismatch");
      const [run] = await db.select({ status: heartbeatRuns.status, profile: heartbeatRuns.runnerProfileJson })
        .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, scope.runId))).limit(1);
      const [lease] = await db.select({ status: environmentLeases.status, runId: environmentLeases.heartbeatRunId,
        remoteCwd: sql<string>`${environmentLeases.metadata}->>'remoteCwd'` }).from(environmentLeases)
        .where(and(eq(environmentLeases.companyId, companyId), eq(environmentLeases.id, scope.leaseId))).limit(1);
      const profile = run?.profile && typeof run.profile === "object" ? run.profile as Record<string, any> : {};
      const execution = profile.nativeExecutionInput && typeof profile.nativeExecutionInput === "object"
        ? profile.nativeExecutionInput as Record<string, any> : {};
      if (run?.status !== "running" || lease?.status !== "active" || lease.runId !== scope.runId ||
          lease.remoteCwd !== expectedTaskRoot || execution.binding?.runId !== scope.runId ||
          execution.binding?.executionWorkspaceId !== scope.workspaceId || execution.workspace?.cwd !== expectedTaskRoot)
        throw new Error("conversation_workspace_copyback_fixture_current_owner_changed");
      // This is test-only file I/O through the software Host's exact run/lease
      // mapping. It does not execute a command or grant the model new tools.
      const upperRoot = fixtureOverlayPath(expectedTaskRoot);
      ensureRealDirectoryTree(upperRoot);
      const upperDirectory = fixtureOverlayPath(posix.join(expectedTaskRoot, ".copyback-fault"));
      ensureRealDirectoryTree(upperDirectory);
      const outputPath = join(upperDirectory, "output.txt");
      try { lstatSync(outputPath); throw new Error("conversation_workspace_copyback_fixture_output_exists"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      writeFileSync(outputPath, "fixture filesystem output\n", { flag: "wx", mode: 0o600 });
    },
    sandboxExec: runtime.executeSandboxTask,
    executeManagedSandboxTask: executeSandboxTask,
    stopSandboxRunLease,
    proveImageDataRetirement: async () => {
      if (nativeRunnerClosureWitness) {
        await assertClosedRun(nativeRunnerClosureWitness.leaseId);
        return;
      }
      if (!expectedRunId) throw new Error("image_native_closure_unknown");
      const leases = await db.select({ id: environmentLeases.id }).from(environmentLeases).where(and(
        eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, expectedRunId),
        eq(environmentLeases.environmentId, environment.id))).limit(2);
      if (leases.length !== 1) throw new Error("image_native_unlaunched_lease_owner_unknown");
      await assertClosedRun(leases[0]!.id);
    },
    assertSerialSuccessorReady: async (leaseId: string) => {
      await assertClosedRun(leaseId);
      if (input.observeModelOriginDenials) {
        if (!observedModelChannel) throw new Error("serial_model_negative_original_channel_missing");
        let denied = false;
        try { await observedModelChannel.authorization(); } catch { denied = true; }
        if (!denied) throw new Error("serial_model_retired_channel_was_authorized");
        modelOriginDenialFacts.retiredChannelDenied = true;
      }
    },

    eraseRemoteNativeRuntimeAsset: (
      locator: Parameters<typeof runtime.eraseRemoteNativeRuntimeAsset>[0],
      input: Parameters<typeof runtime.eraseRemoteNativeRuntimeAsset>[1],
    ) => driveHost(runtime.eraseRemoteNativeRuntimeAsset(locator, input)),
    environmentRuntime,
    beforeNativeExecution,
    modelRequest: async (body: unknown, signal?: AbortSignal) => {
      modelProviderRequestCount++;
      const { runId, claims } = await verifiedModelProvider();
      const work = (): ReturnType<ReturnType<typeof workerModelGateway>["callManagedMessages"]> =>
        (input.gateway as any).callManagedMessages(claims, body, signal ?? new AbortController().signal);
      activeModelRequests++;
      try { return input.withVerifiedModelRun ? await input.withVerifiedModelRun(runId, work) : await work(); }
      finally { activeModelRequests--; }
    },
    attestModelProxyClient: async (client: Socket) => {
      if (!modelOrigin) {
        console.info("serial_model_attestation_failure_projection", JSON.stringify({ modelOriginPresent: false, attestationResult: false }));
        return null;
      }
      const original = modelOrigin;
      const observed = await attestNativeModelClient(client, original);
      if (!observed) console.info("serial_model_attestation_failure_projection", JSON.stringify({ modelOriginPresent: true, attestationResult: false }));
      if (observed && input.observeModelOriginDenials && !observedModelChannel) {
        try {
          const wrongNonce = await attestNativeModelClient(client, { ...original, nonce: "invalid-fixed-negative-nonce" });
          if (wrongNonce) { wrongNonce.close(); throw new Error("serial_model_wrong_nonce_was_authorized"); }
          modelOriginDenialFacts.wrongNonceDenied = true;
          const wrongImage = await attestNativeModelClient(client, { ...original,
            currentProvider: async () => ({ ...await original.currentProvider(), imageSha256: "0".repeat(64) }) });
          if (wrongImage) { wrongImage.close(); throw new Error("serial_model_wrong_image_was_authorized"); }
          modelOriginDenialFacts.wrongImageDenied = true;
          observedModelChannel = observed;
        } catch (error) { observed.close(); throw error; }
      }
      return observed;
    },
    modelRequestAuthenticated: async (body: unknown, signal: AbortSignal, authorization: string | undefined) => {
      modelProviderRequestCount++;
      const provider = await verifiedModelProvider();
      const authenticated = authenticateSerialModelRequest(authorization, { companyId, agentId,
        runId: provider.runId, capabilityToken: provider.token,
        ...(nativeConformanceMode ? { providerConformance: true as const } : {}) });
      // Forward the incoming verified claims. The stored attachment is only
      // an equality/currentness check, never a replacement caller capability.
      const work = (): ReturnType<ReturnType<typeof workerModelGateway>["callManagedMessages"]> =>
        input.gateway.callManagedMessages(authenticated.claims, body, signal);
      activeModelRequests++;
      try { return input.withVerifiedModelRun ? await input.withVerifiedModelRun(provider.runId, work) : await work(); }
      finally { activeModelRequests--; }
    },
    facts: () => {
      if(process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1")console.info("conversation_software_host_preparation",JSON.stringify({phase:preparationStage,
        expectedRunBound:Boolean(expectedRunId),bindingPresent:Boolean(binding),execCount:execFacts.length,
        executables:[...new Set(execFacts.map(fact=>fact.executable.split("/").at(-1)))],lastExecs:execFacts.slice(-6),credentialProbes:qualificationToolResponses,
        hostSessionErrorFacts:execFacts.flatMap(fact=>fact.hostSessionErrorDetails?[fact.hostSessionErrorDetails]:[]).slice(-8),
        hostRelayPreflightFacts:relayPreflightFacts.slice(-8),
        nativeSessionHandleScanFailures: structuredClone(nativeSessionHandleScanFailures),
        nativeRunnerClosureWitness:safeNativeRunnerClosureObservation(),
        softwareProbeCount:softwareProbeObservations.length,qualificationEvidence,failures:sandboxExecutionFailures}));
      const sandboxStageCounts = execFacts.reduce<Record<string, { calls: number; nonzeroExits: number; timeouts: number }>>((counts, fact) => {
        const stage = fact.nativePreparationPurpose ?? "unclassified";
        const count = counts[stage] ?? { calls: 0, nonzeroExits: 0, timeouts: 0 };
        count.calls++;
        if (fact.exitCode !== null && fact.exitCode !== 0) count.nonzeroExits++;
        if (fact.timedOut) count.timeouts++;
        counts[stage] = count;
        return counts;
      }, {});
      return { mode: "controlled_signed_host_relay", hostId: host.id, cellId: cell.id,
      bindingId:binding?.id ?? null,qualificationEvidence,qualificationToolResponses,softwareProbeObservations, environmentId: environment.id, relayAuthenticated: relayHost.readyState === WebSocket.OPEN,
      providerAttestedLeaseExpiresAt: acquiredLeaseExpiresAt,
      positiveModelProbeNotQualified: typeof input.controlledNativeSessionBackendFactory === "function",
      modelOriginDenialFacts: { ...modelOriginDenialFacts },
      preAdmissionObservation,
      modelBrokerSessionReceipts: [...modelBrokerSessionReceipts],
      nativeSessionBackingObservations: [...nativeSessionBackingObservations],
      nativeRunnerClosureWitness: safeNativeRunnerClosureObservation(),
      nativeSessionHandleScanFailures: structuredClone(nativeSessionHandleScanFailures),
      nativeSessionBackingTransfers: [...nativeSessionBackingByKey.values()].map(value => ({
        sessionDigest: value.sessionDigest, taskRootMatches: value.taskRoot === expectedTaskRoot,
        rootIdentityWitnessed: value.witnessMatched,
        fileCount: value.fileCount, byteCount: value.byteCount, witnessMatched: value.witnessMatched,
      })),
      attachedModelBrokerProviderCount: [...attachedSessionProviders].filter(name => name.startsWith("awms-")).length,
      hostHeartbeatCount,
      hostHeartbeatFailed,
      hostCliOperations: [...hostCliOperations],
      postgresLockSnapshots,
      hostAction:safeDriveHostObservation(),
      relayCommandOwners: [...relayCommandOwnerByRequestId.entries()]
        .map(([requestId, owner]) => ({ requestId, owner })).slice(-256),
      sandboxExecutionChecks,
      sandboxExecutionFailures,
      sandboxStageCounts,
      nativeConformanceStartTupleObservations: [...nativeConformanceStartTupleObservations],
      softwareOnlyPolicyProofObservations: [...softwareOnlyPolicyProofObservations],
      execCount: execFacts.length, exactPrivateCwdCount: execFacts.filter(fact => fact.cwdExact).length,
      managedModelCredentialCount: execFacts.filter(fact => fact.modelCredentialPresent).length,
      execFacts,
      hostSessionErrorFacts: execFacts.flatMap(fact => fact.hostSessionErrorDetails ? [fact.hostSessionErrorDetails] : []).slice(-8),
      assignedMcpEnvironmentAbsentCount: execFacts.filter(fact => fact.assignedMcpEnvironmentAbsent).length,
      preparationStage,negativeControls:negativeAdmissionControls,
      negativeNativeSessionStartControls,
      nativeSessionStartCredentialNegativeControls,
      executableNames: [...new Set(execFacts.map(fact => fact.executable.split("/").pop() ?? ""))] };
    },
    close: async () => { clearInterval(hostHeartbeatTimer); if (postgresLockProbeTimer) clearInterval(postgresLockProbeTimer);
      if (postgresLockProbeInFlight) await new Promise(resolve => setTimeout(resolve, 20));
      if (hostHeartbeatInFlight) await hostHeartbeatInFlight;
      relayHost.close(); await new Promise<void>(resolve => relayServer.close(() => resolve())); await runtime.relay.stop();
      if (originalDockerHttpRequest) http.request = originalDockerHttpRequest;
      if (previousHostName === undefined) delete process.env.HOSTNAME; else process.env.HOSTNAME = previousHostName;
      },
  };
}
