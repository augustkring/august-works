import { exactNativeManagedArtifactCommand } from "../native-runtime/native-artifact-preparation.js";
import { readNativeReviewAssignmentContext } from "../native-runtime/native-review-participant.js";
import { NATIVE_ATTACHMENT_CLEANUP_PREPARATION_PURPOSE, NATIVE_ATTACHMENT_STAGE_PREPARATION_PURPOSE, parseNativeRemoteAttachmentStageCommand } from "../native-runtime/native-attachment-remote-stage.js";
import { captureNativeRemoteAttachmentReadbackOwner, captureNativeRemoteAttachmentStageOwner } from "../native-runtime/native-attachment-remote-stage-owner.js";
import { NATIVE_GIT_CONTEXT_PROBE_SCRIPT } from "@paperclipai/adapter-utils/execution-target";
import { buildWorkspaceTarExtractCommand, buildRemoveDeletedPathsCommand } from "@paperclipai/adapter-utils/sandbox-managed-runtime";
import { hostVersionMeetsMinimum } from "./catalog.js";
import { runtimeCommercialReason } from "./commercial.js";
import type { NotifyCompany } from "../notifications/notifications.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  activityLog,
  companySecrets,
  agentExecutionManifests,
  agentExecutionAuthorizations,
  agentProviderBindings,
  agentPresenceRuntimeBindings,
  agents,
  billingAccounts,
  runtimeCapacityProfiles,
  runtimeCells,
  runtimeSandboxBindings,
  runtimePolicySnapshots,
  sandboxQualificationRuns,
  heartbeatRuns,
  issues,
  environmentLeases,
  orchestrationWorkerAttempts,
  orchestrationPlans,
  runtimeHostCommands,
  runtimeHosts,
  runtimeOperations,
  memoryJobs,
  runtimeOperationAttempts,
  runtimeBackups,
  runtimeVersionCatalog,
  type Db,
} from "@paperclipai/db";
import {
  SANDBOX_HOST_COMMAND,
  nativeRunInputSourceReceiptSchema,
  runtimeModelProviderSchema,
  runtimeCellCreateSchema,
  runtimeCommandResultSchema,
  runtimeHeartbeatSchema,
  runtimeOperationSchema,
  nativePayloadSourceSnapshotSchema,
  nativePayloadSourceInputSchema,
  sandboxCapabilitySnapshotSchema,
  runtimeModelBrokerSessionReceiptSchema,
} from "@paperclipai/shared";
import type { z } from "zod";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { HttpError, conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { entitlementService } from "../billing/entitlements.js";
import { usageService } from "../billing/usage.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization } from "../v5-authorization.js";
import { agentService } from "../agents.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { secretService } from "../secrets.js";
import { equalDigest, randomToken, sha256 } from "../saas/crypto.js";
import { runtimeBackupService } from "./backups.js";
import { runtimeGatewayRelay } from "./gateway-relay.js";
import { runtimeHostAuth } from "./host-auth.js";
import { createSandboxBrokerJwt, createSandboxExecJwt, verifySandboxBrokerJwt, verifySandboxExecJwt, type SandboxBrokerCapabilityClaim } from "../../agent-auth-jwt.js";
import { assertAgentRunWriteAllowed, agentRunWritesRevoked } from "../../agent-run-cancellation.js";
import { assertV7Authorization } from "../v7-authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { executionSandboxService, sandboxCapabilityFacts } from "../execution-sandbox/sandbox-service.js";
import { getAssignedMcpGateway } from "../native-runtime/assigned-mcp-tools.js";
import { createRunSecretRedactionRegistry } from "../run-secret-redaction.js";
import { REDACTED_EVENT_VALUE } from "../../redaction.js";
import { resolvePaperclipRunnerProviderProfile } from "../native-runtime/provider-profile.js";
import type { workerModelGateway } from "../orchestration/worker-model-gateway.js";
import { verifyRuntimeToolsToken } from "../../runtime-tools-token.js";
import { findNativeChatWorkspaceScope, nativeChatWorkspaceCwd } from "../native-runtime/native-chat-workspace.js";
import { assertNativePayloadSourceSetCurrent, assertNativeTaskSourceOwnerCurrent, assertNativeWorkspaceMetadataSourcesCurrent } from "../native-direct-input.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { REMOTE_NATIVE_ERASER_ENV, nativeRuntimeErasureEnvironmentExact, nativeRuntimeErasurePolicyIsolated, REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROFILE_HASH, REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT, REMOTE_RUNNER_CHILD_LAUNCH_SCRIPT,
  REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_SCRIPT, REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
  REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT, REMOTE_NATIVE_SESSION_FENCE_ACQUIRE_SCRIPT,
  REMOTE_NATIVE_SESSION_FENCE_RELEASE_SCRIPT } from "../native-runtime/remote-runner-identity.js";
import { sandboxProbeCases, nativeRuntimeCleanupProbeCases } from "../execution-sandbox/backend.js";
import { SANDBOX_CONTROLS, NATIVE_RUNTIME_CLEANUP_PURPOSE, NATIVE_RUNTIME_CLEANUP_PROFILE } from "@paperclipai/shared";
import { nativeSandboxHostTransport, type RemoteRuntimeCleanupAttestation } from "../execution-sandbox/native-host-bridge.js";
import { readRunLeaseCleanup, verifyRunLeaseCleanupReceipt, verifyNativeCleanupRuntimeState } from "../execution-sandbox/run-lease-cleanup.js";
import { isNativeBootstrapPrelaunchCleanupCandidate, readNativeBootstrapPrelaunchCleanup, verifyNativeBootstrapPrelaunchStopReceipt, type NativeBootstrapPrelaunchCleanupOwner } from "../execution-sandbox/native-prelaunch-cleanup.js";
import {
  assertRemoteRuntimeAssetErasureReady,
  assertRemoteRuntimeAssetErasureClaimCurrent,
  isRemoteRuntimeAssetLocator,
  isRemoteRuntimeAssetRemovalReceipt,
  readRemoteRuntimeAssetLocator,
  readRemoteNativeSessionStartBinding,
  remoteRuntimeAssetLocatorDigest,
  type RemoteRuntimeAssetLocator,
  type RemoteRuntimeAssetRemovalReceipt,
} from "../native-runtime/runtime-asset-retention.js";
import { REMOTE_ASSET_ERASURE_ERRORS } from "../native-runtime/runtime-asset-erasure-errors.js";

type IssuedWorkerModelCredential = Awaited<
  ReturnType<ReturnType<typeof workerModelGateway>["issueForRun"]>
>;

const ACTIVE_OPERATIONS = [
  "REQUESTED",
  "RUNNING",
  "WAITING_FOR_CAPACITY",
  "NEEDS_RECONCILIATION",
];
const CELL_ACTION_STATUS: Record<string, string> = {
  provision: "PROVISIONING",
  start: "STARTING",
  stop: "STOPPING",
  delete: "DELETING",
  backup: "BACKING_UP",
  restore: "RECOVERING",
  upgrade: "UPGRADING",
  migrate: "MIGRATING",
  rotate_gateway: "CONFIGURING",
};
// Ephemeral provenance for the exact live enforcing closure. This holds no
// grant, policy, token or durable authority and cannot bless wrapped callbacks.
const sandboxBrokerAuthorityOwners = new WeakMap<Function, Readonly<{protocol:"sandbox_exec_v1";origin:string}>>();
export function readSandboxBrokerAuthorityEnforcement(authority: unknown): Readonly<{protocol:"sandbox_exec_v1";origin:string}> | null {
  return typeof authority === "function" ? sandboxBrokerAuthorityOwners.get(authority) ?? null : null;
}
function configuredPaperclipEndpointOrigin(raw: string | undefined): string | null {
  if(typeof raw !== "string") return null;
  raw = raw.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !["", "/", "/api", "/api/"].includes(url.pathname)) return null;
    return `${url.protocol}//${url.host}/`;
  } catch {
    return null;
  }
}

export function exactNativeHarnessStateCommand(input: {
  request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest;
  taskRoot: string;
  execution: ReturnType<typeof parseNativeExecutionInput>;
  runId: string;
}): boolean {
  if (input.execution.provider.kind !== "opencode" || input.execution.session.driverKind !== "opencode_server") return false;
  const forbiddenCredentialEnvironment = new Set([
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PAPERCLIP_SANDBOX_BROKER_TOKEN",
    "PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN", "PAPERCLIP_SANDBOX_BROKER_SESSION_ID",
    "PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN", "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND",
    "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS",
  ]);
  if (input.request.modelBrokerCredential !== undefined || input.request.brokerCredential !== undefined ||
    Object.keys(input.request.env ?? {}).some(key => forbiddenCredentialEnvironment.has(key))) return false;
  const runtimeRoot = path.posix.join(input.taskRoot, ".paperclip-runtime", "paperclip-runner");
  const sessionId = input.execution.session.normalizedSessionId ?? `session-${input.runId}`;
  const sessionRoot = path.posix.join(runtimeRoot, "sessions", sha256(sessionId));
  const runnerDir = path.posix.join(sessionRoot, "runner");
  const filesystemDir = path.posix.join(sessionRoot, "filesystem", "opencode");
  const runnerState = path.posix.join(runnerDir, "runner-state.json");
  const providerState = path.posix.join(runnerDir, "codex-provider-state.json");
  const processIdentity = path.posix.join(runnerDir, "runner-process.identity");
  const diagnosticsDir = path.posix.join(sessionRoot, "diagnostics");
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const { argv } = input.request;
  const matches = (...expected: string[]) => argv.length === expected.length && expected.every((value, index) => argv[index] === value);
  if (exactNativeSessionFilesystemFenceCommand({
    request: input.request, taskRoot: input.taskRoot, execution: input.execution,
  })) return true;
  const read = (file: string) => matches("sh", "-c", `test -f ${quote(file)} && base64 < ${quote(file)}`);
  const inspect = [
    `test -f ${quote(runnerState)}`,
    `test -d ${quote(filesystemDir)}`,
    `test -f ${quote(providerState)}`,
    `base64 < ${quote(runnerState)}`,
  ].join(" && ");
  const materialize = `umask 077; install -d -m 0700 ${quote(filesystemDir)}`;
  if (input.request.cwd !== input.taskRoot) return false;
  if (input.request.stdinBase64 === "" && (read(runnerState) || read(providerState) || matches("sh", "-c", inspect) ||
    matches("sh", "-c", materialize) || matches("sh", "-c", `test -f ${quote(runnerState)}`) ||
    matches("sh", "-c", `test -d ${quote(runnerDir)}`) || matches("sh", "-c", `test -d ${quote(filesystemDir)}`))) return true;
  if (input.request.stdinBase64 === "" && matches("sh", "-c", 'test -f "$1" && test ! -L "$1" && cat -- "$1"',
    "paperclip-runner-process-identity", processIdentity)) return true;
  if (exactNativeRunnerMonitorStatusCommand(input)) return true;
  if (exactNativeRunnerSignalCommand(input)) return true;
  if (input.request.stdinBase64 === "" && argv.length === 8 && argv[0] === "sh" && argv[1] === "-c" &&
    argv[2] === REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT && argv[3] === "paperclip-runner-identity-failure-cleanup" &&
    argv[4] === processIdentity && /^[0-9a-f-]{36}$/i.test(argv[5] ?? "") &&
    /^[0-9a-f-]{36}$/i.test(argv[6] ?? "") && argv[7] === REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT) return true;
  const diagnostics = 'set -eu; directory=$1; file="$directory/runnerd.stderr.log"; test -d "$directory" && test ! -L "$directory" && test -f "$file" && test ! -L "$file"; tail -c 65536 -- "$file"';
  if (input.request.stdinBase64 === "" && matches("sh", "-c", diagnostics, "paperclip-runner-diagnostics", diagnosticsDir)) return true;
  const persistenceRoots = [runnerDir, filesystemDir];
  if (persistenceRoots.some(directory => matches("sh", "-c", `tar -czf - -C ${quote(directory)} . | base64`)))
    return input.request.stdinBase64 === "";
  const archiveIsBoundedBase64 = input.request.stdinBase64.length > 0 && input.request.stdinBase64.length <= 512 * 1024 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.request.stdinBase64) &&
    Buffer.from(input.request.stdinBase64, "base64").toString("base64") === input.request.stdinBase64;
  return persistenceRoots.some(directory => matches("sh", "-c",
    `umask 077; mkdir -p ${quote(directory)} && base64 -d | tar -xzf - -C ${quote(directory)} && chmod 700 ${quote(directory)}`)) &&
    archiveIsBoundedBase64;
}

export function exactNativeSessionFilesystemFenceCommand(input: {
  request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest;
  taskRoot: string;
  execution: ReturnType<typeof parseNativeExecutionInput>;
}): boolean {
  if (input.execution.provider.kind !== "opencode" || input.execution.session.driverKind !== "opencode_server" ||
    input.request.cwd !== input.taskRoot || input.request.stdinBase64 !== "" ||
    input.request.modelBrokerCredential !== undefined || input.request.brokerCredential !== undefined ||
    Object.keys(input.request.env ?? {}).length !== 0) return false;
  const sessionId = input.execution.session.normalizedSessionId ?? `session-${input.execution.binding.runId}`;
  const digest = sha256(sessionId);
  const { argv } = input.request;
  if (argv.length !== 7 || argv[0] !== "sh" || argv[1] !== "-c" || argv[4] !== input.taskRoot || argv[5] !== digest ||
    !/^[0-9a-f-]{36}$/i.test(argv[6] ?? "")) return false;
  return (argv[2] === REMOTE_NATIVE_SESSION_FENCE_ACQUIRE_SCRIPT && argv[3] === "paperclip-native-session-fence-acquire") ||
    (argv[2] === REMOTE_NATIVE_SESSION_FENCE_RELEASE_SCRIPT && argv[3] === "paperclip-native-session-fence-release");
}

/** Only the RuntimeControl erasure owner may issue this fixed command. The
 * signed relay cannot turn caller-provided paths into a remote delete. */
export function exactNativeRuntimeAssetErasureCommand(input: {
  request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest;
  locator: RemoteRuntimeAssetLocator;
  remoteCwd: string;
  expectedProcessPid: number;
  expectedProcessStartedAt: string;
}): boolean {
  const { request, locator, remoteCwd, expectedProcessPid, expectedProcessStartedAt } = input;
  const argv = request.argv;
  const expected = ["/bin/sh", "-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT,
    "paperclip-native-asset-erasure", remoteCwd, locator.normalizedSessionIdDigest,
    locator.runId, locator.runnerInstanceId, locator.environmentLeaseId, locator.providerLeaseId,
    locator.normalizedSessionIdDigest, String(expectedProcessPid), expectedProcessStartedAt,
    REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
    REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT];
  return request.cwd === remoteCwd && request.stdinBase64 === "" && nativeRuntimeErasureEnvironmentExact(request.env) &&
    argv.length === expected.length && expected.every((value, index) => argv[index] === value) &&
    request.brokerCredential === undefined && request.modelBrokerCredential === undefined;
}

export function exactNativeRuntimeAssetErasureProbeCommand(input: {
  request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest;
  taskRoot: string;
  runId: string;
  sessionDigest: string;
}): boolean {
  const { request } = input;
  const argv = request.argv;
  const expectedPrefix = ["/bin/sh", "-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_SCRIPT,
    "paperclip-native-asset-erasure-probe", input.taskRoot, input.sessionDigest, input.runId];
  return request.cwd === input.taskRoot && request.stdinBase64 === "" &&
    argv.length === expectedPrefix.length + 1 && expectedPrefix.every((value, index) => argv[index] === value) &&
    /^[a-f0-9-]{36}$/i.test(argv.at(-1) ?? "") && request.brokerCredential === undefined &&
    request.modelBrokerCredential === undefined && nativeRuntimeErasureEnvironmentExact(request.env);
}

export function exactNativeRunnerMonitorStatusCommand(input: {
  request: Pick<import("@paperclipai/shared").RuntimeSandboxExecRelayRequest, "argv" | "cwd" | "stdinBase64">;
  taskRoot: string;
  execution: ReturnType<typeof parseNativeExecutionInput>;
  runId: string;
}): boolean {
  if (input.execution.provider.kind !== "opencode" || input.execution.session.driverKind !== "opencode_server" ||
    input.request.cwd !== input.taskRoot || input.request.stdinBase64 !== "") return false;
  const sessionId = input.execution.session.normalizedSessionId ?? `session-${input.runId}`;
  const processIdentity = path.posix.join(input.taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions",
    sha256(sessionId), "runner", "runner-process.identity");
  const { argv } = input.request;
  return argv.length === 8 && argv[0] === "sh" && argv[1] === "-c" && argv[2] === REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT &&
    argv[3] === "paperclip-runner-monitor" && argv[4] === processIdentity &&
    /^[0-9a-f-]{36}$/i.test(argv[5] ?? "") && /^[0-9a-f-]{36}$/i.test(argv[6] ?? "") &&
    /^[1-9][0-9]{0,9}$/.test(argv[7] ?? "");
}

/** Exact server-generated signal for a runner process recorded by this
 * session. The identity check binds the nonce, runner id, and PID immediately
 * before signalling; only signals emitted by the launcher are accepted.
 */
function exactNativeRunnerSignalCommand(input: {
  request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest;
  taskRoot: string;
  execution: ReturnType<typeof parseNativeExecutionInput>;
  runId: string;
}): boolean {
  if (input.execution.provider.kind !== "opencode" || input.execution.session.driverKind !== "opencode_server" ||
    input.request.cwd !== input.taskRoot || input.request.stdinBase64 !== "") return false;
  const sessionId = input.execution.session.normalizedSessionId ?? `session-${input.runId}`;
  const processIdentity = path.posix.join(input.taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions",
    sha256(sessionId), "runner", "runner-process.identity");
  const { argv } = input.request;
  if (argv.length !== 9 || argv[0] !== "sh" || argv[1] !== "-c" || argv[3] !== "paperclip-runner-signal" ||
    argv[4] !== processIdentity || !/^[0-9a-f-]{36}$/i.test(argv[5] ?? "") ||
    !/^[0-9a-f-]{36}$/i.test(argv[6] ?? "") || !/^[1-9][0-9]{0,9}$/.test(argv[7] ?? "") ||
    argv[8] !== "require-fingerprint") return false;
  return ["INT", "TERM", "KILL"].some(signal => argv[2] ===
    `${REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT}; kill -${signal} "$expected_pid"`);
}

/** A CLAIMED exec is terminal only when its entire command is the read-only monitor. */
export function nativeRelayClaimFailureStatus(
  initialStatus: "PENDING" | "CLAIMED",
  exactNativeRunnerMonitorStatus: boolean,
): "FAILED" | "CLAIMED" {
  return initialStatus === "PENDING" || (initialStatus === "CLAIMED" && exactNativeRunnerMonitorStatus)
    ? "FAILED"
    : "CLAIMED";
}

function exactNativeSessionLaunchCommand(input: {
  request: Pick<import("@paperclipai/shared").RuntimeSandboxExecRelayRequest, "argv" | "cwd" | "stdinBase64">;
  taskRoot: string;
  execution: ReturnType<typeof parseNativeExecutionInput>;
}): boolean {
  if (input.execution.provider.kind !== "opencode" || input.execution.session.driverKind !== "opencode_server") return false;
  const runtimeRoot = path.posix.join(input.taskRoot, ".paperclip-runtime", "paperclip-runner");
  const sessionId = input.execution.session.normalizedSessionId ?? `session-${input.execution.binding.runId}`;
  const sessionRoot = path.posix.join(runtimeRoot, "sessions", sha256(sessionId));
  const processIdentity = path.posix.join(sessionRoot, "runner", "runner-process.identity");
  const diagnosticsDir = path.posix.join(sessionRoot, "diagnostics");
  const runnerBinary = path.posix.join(runtimeRoot, "bin", "paperclip-runnerd");
  const childLaunch = 'set -eu; identity_path=$1; identity_nonce=$2; runner_instance_id=$3; child_script=$4; shift 4; umask 077; identity_dir=$(dirname -- "$identity_path"); mkdir -p -- "$identity_dir"; if command -v setsid >/dev/null 2>&1; then nohup setsid sh -c "$child_script" paperclip-runner-child "$identity_path" "$identity_nonce" "$runner_instance_id" "$@" </dev/null >/dev/null 2>&1 & else nohup sh -c "$child_script" paperclip-runner-child "$identity_path" "$identity_nonce" "$runner_instance_id" "$@" </dev/null >/dev/null 2>&1 & fi';
  const childScript = REMOTE_RUNNER_CHILD_LAUNCH_SCRIPT;
  const argv = input.request.argv;
  return input.request.cwd === input.taskRoot && input.request.stdinBase64 === "" && argv.length >= 10 &&
    argv[0] === "sh" && argv[1] === "-c" && argv[2] === childLaunch && argv[3] === "paperclip-runner-launch" &&
    argv[4] === processIdentity && /^[0-9a-f-]{36}$/i.test(argv[5] ?? "") && /^[0-9a-f-]{36}$/i.test(argv[6] ?? "") &&
    argv[7] === childScript && argv[8] === diagnosticsDir && argv[9] === runnerBinary;
}

function exactNativeRuntimeContextPrepareCommand(input: {
  request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest;
  taskRoot: string;
  execution: ReturnType<typeof parseNativeExecutionInput>;
}): boolean {
  if (exactNativeSessionFilesystemFenceCommand(input)) return true;
  const context = "runtimeContext" in input.execution ? input.execution.runtimeContext : null;
  if (!context || input.execution.provider.kind !== "opencode" || input.execution.session.driverKind !== "opencode_server" ||
    input.request.cwd !== input.taskRoot || input.request.stdinBase64 === "") return false;
  const runtimeRoot = path.posix.join(input.taskRoot, ".paperclip-runtime", "paperclip-runner");
  const sessionId = input.execution.session.normalizedSessionId ?? `session-${input.execution.binding.runId}`;
  const filesystemRoot = path.posix.join(runtimeRoot, "sessions", sha256(sessionId), "filesystem");
  const runtimeContextFile = path.posix.join(filesystemRoot, "runtime-context.json");
  const targets = [
    path.posix.join(filesystemRoot, "context", "instructions"),
    ...context.skills.map((skill, index) => path.posix.join(
      filesystemRoot, "context", "skills", `${index}-${skill.bundle.digest.slice(0, 12)}`,
    )),
  ];
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const argv = input.request.argv;
  if (argv.length !== 3 || argv[0] !== "sh" || argv[1] !== "-c") return false;
  if (targets.some(target => argv[2] ===
    `umask 077; mkdir -p ${quote(target)} && base64 -d | tar -xzf - -C ${quote(target)} && chmod 555 ${quote(target)}`)) return true;
  const fileDirectory = path.posix.dirname(runtimeContextFile);
  const stageRuntimeContextFile = `umask 077; mkdir -p ${quote(fileDirectory)} && base64 -d > ${quote(runtimeContextFile)} && chmod 600 ${quote(runtimeContextFile)}`;
  const fileBytesAreBoundedBase64 = input.request.stdinBase64.length <= 512 * 1024 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.request.stdinBase64) &&
    Buffer.from(input.request.stdinBase64, "base64").toString("base64") === input.request.stdinBase64;
  return argv[2] === stageRuntimeContextFile && fileBytesAreBoundedBase64;
}

/** Pure owner predicate for server-staged runtime context. RuntimeControl still
 * checks the current Human/task source in its transaction; this closes the
 * additional immutable Run/manifest/profile, exact target, and no-credential
 * binding so it can be exercised with commands produced by the staging helper. */
export function exactNativeRuntimeContextPreparationOwner(input: {
  request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest;
  taskRoot: string;
  execution: ReturnType<typeof parseNativeExecutionInput>;
  companyId: string;
  runId: string;
  agentId: string;
  responsibleUserId: string;
  manifest: { runId: string; agentId: string; responsibleUserId: string };
  nativeExecutionInput: unknown;
  sourceAuthority: unknown;
  credentialMode: string;
  credentialBindingCount: number;
}): boolean {
  const authority = input.sourceAuthority && typeof input.sourceAuthority === "object" && !Array.isArray(input.sourceAuthority)
    ? input.sourceAuthority as Record<string, unknown> : {};
  const env = input.request.env ?? {};
  const forbiddenEnvironmentKeys = [
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PAPERCLIP_SANDBOX_BROKER_TOKEN",
    "PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN", "PAPERCLIP_SANDBOX_BROKER_SESSION_ID",
    "PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN", "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND",
    "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS",
  ];
  return input.execution.provider.kind === "opencode" && input.execution.session.driverKind === "opencode_server" &&
    input.execution.binding.companyId === input.companyId && input.execution.binding.runId === input.runId &&
    input.execution.binding.agentId === input.agentId && input.manifest.runId === input.runId &&
    input.manifest.agentId === input.agentId && input.manifest.responsibleUserId === input.responsibleUserId &&
    authority.version === 1 && authority.executionInputHash === nativeSha256(input.nativeExecutionInput) &&
    input.credentialMode === "none" && input.credentialBindingCount === 0 &&
    input.request.modelBrokerCredential === undefined && input.request.brokerCredential === undefined &&
    !Object.keys(env).some(key => forbiddenEnvironmentKeys.includes(key)) &&
    exactNativeRuntimeContextPrepareCommand({ request: input.request, taskRoot: input.taskRoot, execution: input.execution });
}

/** Decode only the canonical single-quoted words emitted by shellQuote.
 * No shell evaluation, interpolation, options or unquoted text are accepted. */
function quotedNativeWorkspacePaths(text: string): string[] | null {
  const values: string[] = []; let at = 0;
  while (at < text.length) {
    if (text[at] !== "'") return null;
    at++; let value = "", closed = false;
    while (at <= text.length) {
      const next = text.indexOf("'", at); if (next < 0) return null;
      value += text.slice(at, next);
      if (text.slice(next, next + 4) === "'\\''") { value += "'"; at = next + 4; continue; }
      at = next + 1; closed = true; break;
    }
    if (!closed || !value || value.includes("\0") || value.includes("\\") || path.posix.isAbsolute(value) ||
      path.posix.normalize(value) !== value || value === "." || value.startsWith("../") ||
      value === ".paperclip-runtime" || value.startsWith(".paperclip-runtime/")) return null;
    values.push(value); if (values.length > 512) return null;
    if (at === text.length) break;
    if (text[at++] !== " ") return null;
  }
  return values.length ? values : null;
}

export function exactNativeWorkspacePrepareCommand(input: {
  request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest;
  taskRoot: string;
  execution: ReturnType<typeof parseNativeExecutionInput>;
  expectedProviderLeaseId?: string;
}): boolean {
  if (input.execution.provider.kind !== "opencode" || input.execution.session.driverKind !== "opencode_server" ||
    input.request.cwd !== input.taskRoot) return false;
  const { argv, stdinBase64 } = input.request;
  const emptyInput = stdinBase64 === "";
  if (emptyInput && argv.length === 5 && argv[0] === "sh" && argv[1] === "-c" &&
    argv[2] === NATIVE_GIT_CONTEXT_PROBE_SCRIPT && argv[3] === "paperclip-git-context" && argv[4] === "managed") return true;
  if (argv.length !== 3 || argv[0] !== "sh" || argv[1] !== "-c") return false;
  const script = argv[2];
  const runtimeRoot = path.posix.join(input.taskRoot, ".paperclip-runtime", "paperclip-runner");
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const stamp = path.posix.join(runtimeRoot, "workspace-sync-v1.json");
  if (emptyInput && script === `test -f ${quote(stamp)} && cat ${quote(stamp)}`) return true;
  const stampWritePrefix = `umask 077; mkdir -p ${quote(runtimeRoot)} && printf %s `;
  const stampWriteSuffix = ` | base64 -d > ${quote(`${stamp}.tmp`)} && mv ${quote(`${stamp}.tmp`)} ${quote(stamp)}`;
  if (emptyInput && script.startsWith(stampWritePrefix) && script.endsWith(stampWriteSuffix)) {
    const encodedToken = script.slice(stampWritePrefix.length, -stampWriteSuffix.length);
    const encoded = encodedToken.startsWith("'") && encodedToken.endsWith("'") ? encodedToken.slice(1, -1) : "";
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && Buffer.from(encoded, "base64").toString("base64") === encoded) {
      try {
        const body = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Record<string, unknown>;
        if (body.schema === "paperclip.native-workspace-stamp/v1" &&
            body.workspaceId === input.execution.binding.executionWorkspaceId && body.remoteCwd === input.taskRoot &&
            body.finalizedRunId === input.execution.binding.runId && typeof body.providerLeaseId === "string" &&
            input.expectedProviderLeaseId !== undefined && body.providerLeaseId === input.expectedProviderLeaseId &&
            Object.keys(input.request.env ?? {}).length === 0 &&
            typeof body.hostSha256 === "string" && /^[a-f0-9]{64}$/.test(body.hostSha256)) return true;
      } catch { /* malformed remote stamp is not a trusted workspace operation */ }
    }
  }
  const validChunk = stdinBase64.length > 0 && stdinBase64.length <= 6 * 1024 * 1024 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(stdinBase64) && Buffer.from(stdinBase64, "base64").toString("base64") === stdinBase64 &&
    (() => {
      const chunk = Buffer.from(stdinBase64, "base64").toString("utf8");
      return chunk.length <= 4 * 1024 * 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(chunk) &&
        Buffer.from(chunk, "base64").toString("base64") === chunk && Buffer.from(chunk, "base64").length <= 3 * 1024 * 1024;
    })();
  for (const name of ["workspace-upload.tar", "git-workspace-upload.tar"]) {
    const archive = path.posix.join(runtimeRoot, name);
    const suffix = /\.paperclip-upload\.([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/i.exec(script)?.[1];
    const tempPath = suffix ? `${archive}.paperclip-upload.${suffix}` : null;
    if (tempPath) {
      const init = `mkdir -p ${quote(runtimeRoot)} && rm -f ${quote(tempPath)} && : > ${quote(tempPath)}`;
      const append = `base64 -d >> ${quote(tempPath)}`;
      const commit = `mv -f ${quote(tempPath)} ${quote(archive)}`;
      const cleanup = `rm -rf ${quote(tempPath)}`;
      if (emptyInput && [init, commit, cleanup].includes(script)) return true;
      if (validChunk && script === append) return true;
    }
    if (emptyInput && script === buildWorkspaceTarExtractCommand({ workspaceRemoteDir: input.taskRoot,
      remoteTar: archive, wipeExceptNames: [".paperclip-runtime"] })) return true;
    if (emptyInput && name === "workspace-upload.tar" && script === buildWorkspaceTarExtractCommand({
      workspaceRemoteDir: input.taskRoot, remoteTar: archive, wipeExceptNames: null })) return true;
  }
  // Git-overlay deletion is still confined to canonical relative workspace
  // names and never touches the retained runtime/source-authority directory.
  const deletionPrefix = `cd ${quote(input.taskRoot)} && rm -rf -- `;
  if (emptyInput && script.startsWith(deletionPrefix)) {
    const paths = quotedNativeWorkspacePaths(script.slice(deletionPrefix.length));
    return paths !== null && script === buildRemoveDeletedPathsCommand({ remoteDir: input.taskRoot, deletedPaths: paths });
  }
  return false;
}

function exactNativeProviderArtifactChunkCommand(input: {
  request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest;
  taskRoot: string;
}): boolean {
  if (input.request.cwd !== input.taskRoot || input.request.argv.length !== 3 ||
    input.request.argv[0] !== "sh" || input.request.argv[1] !== "-c") return false;
  const runtimeRoot = path.posix.join(input.taskRoot, ".paperclip-runtime", "paperclip-runner");
  const target = path.posix.join(runtimeRoot, "bin", "paperclip-runnerd");
  const script = input.request.argv[2]!;
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const suffix = `${target}.paperclip-upload.`;
  const at = script.indexOf(suffix);
  if (at < 0) return false;
  const remainder = script.slice(at + suffix.length);
  const match = /^([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/i.exec(remainder);
  if (!match) return false;
  const temp = `${suffix}${match[1]}`;
  if (!script.includes(quote(temp))) return false;
  const parent = path.posix.dirname(target);
  const init = `umask 077; mkdir -p ${quote(parent)} && rm -f ${quote(temp)} && : > ${quote(temp)}`;
  const fileCommit = `chmod 700 ${quote(temp)} && mv -f ${quote(temp)} ${quote(target)}`;
  const { stdinBase64, argv } = input.request;
  if (argv[2] === init || argv[2] === fileCommit)
    return stdinBase64 === "";
  if (stdinBase64.length === 0 || stdinBase64.length > 512 * 1024 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(stdinBase64) ||
    Buffer.from(stdinBase64, "base64").toString("base64") !== stdinBase64) return false;
  const inner = Buffer.from(stdinBase64, "base64").toString("utf8");
  if (inner.length === 0 || inner.length > 350_000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(inner) ||
    Buffer.from(inner, "base64").toString("base64") !== inner) return false;
  const chunkLength = Buffer.from(inner, "base64").length;
  if (chunkLength === 0 || chunkLength > 256 * 1024) return false;
  const append = `current=$(wc -c < ${quote(temp)}); test "$current" -le 67108864 && test $((current + ${chunkLength})) -le 67108864 && base64 -d >> ${quote(temp)}`;
  return argv[2] === append;
}
// This is lexical admission against the current signed policy, not a remote
// filesystem observation. The sandbox retains physical symlink enforcement.
function sandboxExecutionCwdAllowed(cwd: string, filesystem: { readPaths?: unknown; writePaths?: unknown } | undefined): boolean {
  if (!path.posix.isAbsolute(cwd) || !Array.isArray(filesystem?.readPaths) || !Array.isArray(filesystem?.writePaths)) return false;
  const requested = path.posix.normalize(cwd);
  const roots = [
    ...(Array.isArray(filesystem?.readPaths) ? filesystem.readPaths : []),
    ...(Array.isArray(filesystem?.writePaths) ? filesystem.writePaths : []),
  ];
  return roots.some(root => {
    if (typeof root !== "string" || !path.posix.isAbsolute(root)) return false;
    const relative = path.posix.relative(path.posix.normalize(root), requested);
    return relative === "" || (relative !== ".." && !relative.startsWith("../") && !path.posix.isAbsolute(relative));
  });
}

type CurrentSandboxTaskSource = NonNullable<Awaited<ReturnType<ReturnType<typeof executionSandboxService>["assertTaskExecutionContext"]>>>;
const WORKER_NATIVE_PREPARATION_PURPOSES = new Set(["provider_artifact", "native_harness_state", "native_workspace_prepare", "native_runtime_context_prepare", "native_provider_data_erasure_probe", NATIVE_ATTACHMENT_STAGE_PREPARATION_PURPOSE, NATIVE_ATTACHMENT_CLEANUP_PREPARATION_PURPOSE]);
const CONFORMANCE_NATIVE_PREPARATION_PURPOSES = new Set(["provider_artifact", "native_harness_state", "native_workspace_prepare", "native_session_start", "native_provider_data_erasure_probe"]);

async function currentWorkerNativePreparationRoot(tx: Db, source: CurrentSandboxTaskSource,
  purpose: string | undefined): Promise<string | null> {
  if (!purpose || !WORKER_NATIVE_PREPARATION_PURPOSES.has(purpose)) return null;
  const { run, manifest } = source, task = source.source.task;
  if (task.conversationAgentId !== null || task.conversationUserId !== null) return null;
  const profile = run.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
    ? run.runnerProfileJson as Record<string, unknown> : {};
  const authority = profile.nativeOpenCodeSourceAuthority && typeof profile.nativeOpenCodeSourceAuthority === "object" &&
    !Array.isArray(profile.nativeOpenCodeSourceAuthority) ? profile.nativeOpenCodeSourceAuthority as Record<string, unknown> : {};
  let execution: ReturnType<typeof parseNativeExecutionInput>;
  try { execution = parseNativeExecutionInput(profile.nativeExecutionInput); }
  catch { throw conflict("Worker preparation requires its immutable Native input"); }
  const workspace = nativePayloadSourceInputSchema.safeParse(authority.workspaceMetadataSource);
  const capturedTask = profile.nativeBootstrapTaskSource && typeof profile.nativeBootstrapTaskSource === "object" &&
    !Array.isArray(profile.nativeBootstrapTaskSource) ? profile.nativeBootstrapTaskSource as Record<string, unknown> : {};
  const taskSource = nativePayloadSourceInputSchema.safeParse(capturedTask.input);
  const root = path.resolve(execution.workspace.cwd), remoteCwd = source.lease.metadata?.remoteCwd;
  const filesystem = source.policy.compilation.compiledPolicy.filesystem;
  const readRoots = Array.isArray(filesystem?.readPaths) ? filesystem.readPaths : [];
  const writeRoots = Array.isArray(filesystem?.writePaths) ? filesystem.writePaths : [];
  const artifacts = authority.artifactAuthority && typeof authority.artifactAuthority === "object" &&
    !Array.isArray(authority.artifactAuthority) ? authority.artifactAuthority as Record<string, unknown> : {};
  const installedPack = artifacts.installedPackRoot;
  if (!nativeRuntimeErasurePolicyIsolated(source.policy.compilation.compiledPolicy) ||
    typeof installedPack !== "string" || !path.posix.isAbsolute(installedPack) || installedPack === "/" ||
    path.posix.normalize(installedPack) !== installedPack || installedPack.includes("\0") ||
    writeRoots.some(value => typeof value === "string" && (installedPack === path.resolve(value) ||
      installedPack.startsWith(path.resolve(value).replace(/\/$/, "") + "/") ||
      path.resolve(value).startsWith(installedPack + "/") ||
      ["/bin/sh", "/usr/bin/sha256sum", "/bin/sha256sum"].some(binary =>
        binary === path.resolve(value) || binary.startsWith(path.resolve(value).replace(/\/$/, "") + "/")))))
    throw conflict("Worker installed provider pack must be outside all tenant writable policy roots");
  if (run.status !== "running" || run.runtimeMode !== "native" || run.scopeKind !== "issue" ||
    !run.agentId || !run.responsibleUserId || run.nativeIssueId !== task.id || task.hiddenAt ||
    ["done", "cancelled"].includes(task.status) || task.assigneeAgentId !== run.agentId || task.executionRunId !== run.id ||
    manifest.runId !== run.id || manifest.agentId !== run.agentId || manifest.manifest.responsibleUserId !== run.responsibleUserId ||
    execution.provider.kind !== "opencode" || execution.session.driverKind !== "opencode_server" ||
    execution.binding.companyId !== run.companyId || execution.binding.runId !== run.id || execution.binding.issueId !== task.id ||
    execution.binding.agentId !== run.agentId || execution.session.normalizedSessionId !== run.nativeSessionId ||
    execution.completionContract.id !== run.completionContractId || execution.completionContract.sha256 !== run.completionContractSha256 ||
    authority.version !== 1 || authority.executionInputHash !== nativeSha256(profile.nativeExecutionInput) ||
    resolvePaperclipRunnerProviderProfile(source.source.agent.adapterConfig)?.provider !== "opencode" ||
    !workspace.success || workspace.data.kind !== "workspace_metadata" || workspace.data.runId !== run.id ||
    workspace.data.executionWorkspaceId !== execution.binding.executionWorkspaceId ||
    !taskSource.success || taskSource.data.kind !== "task" || taskSource.data.issueId !== task.id ||
    typeof remoteCwd !== "string" || path.resolve(remoteCwd) !== root ||
    !readRoots.some(value => typeof value === "string" && path.resolve(value) === root) ||
    !writeRoots.some(value => typeof value === "string" && path.resolve(value) === root))
    throw conflict("Worker preparation source, Human, manifest, workspace or lease changed");
  await assertNativeTaskSourceOwnerCurrent(tx, { companyId: run.companyId,
    actor: { type: "board", source: "session", userId: run.responsibleUserId }, source: taskSource.data });
  await assertNativeWorkspaceMetadataSourcesCurrent(tx, run.companyId, [workspace.data]);
  return root;
}

async function currentConformanceNativeWorkspaceRoot(source: CurrentSandboxTaskSource, purpose: string | undefined): Promise<string | null> {
  if (!purpose || !CONFORMANCE_NATIVE_PREPARATION_PURPOSES.has(purpose) || !source.providerConformanceBootstrap) return null;
  const { run, manifest } = source, task = source.source.task;
  const profile = run.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
    ? run.runnerProfileJson as Record<string, unknown> : {};
  const proof = profile.nativeOpenCodeConformanceWorkspace && typeof profile.nativeOpenCodeConformanceWorkspace === "object" &&
    !Array.isArray(profile.nativeOpenCodeConformanceWorkspace) ? profile.nativeOpenCodeConformanceWorkspace as Record<string, unknown> : {};
  let execution: ReturnType<typeof parseNativeExecutionInput>;
  try { execution = parseNativeExecutionInput(profile.nativeExecutionInput); }
  catch { throw conflict("Conformance workspace preparation requires its immutable Native input"); }
  const groupId = source.qualificationGroupId, plan = source.conformancePlan;
  const root = path.resolve(execution.workspace.cwd), leaseRoot = source.lease.metadata?.remoteCwd;
  const taskRoot = typeof proof.taskRoot === "string" ? path.resolve(proof.taskRoot) : "";
  const sourceAuthority = profile.nativeOpenCodeSourceAuthority && typeof profile.nativeOpenCodeSourceAuthority === "object" &&
    !Array.isArray(profile.nativeOpenCodeSourceAuthority) ? profile.nativeOpenCodeSourceAuthority as Record<string, unknown> : {};
  const filesystem = source.policy.compilation.compiledPolicy.filesystem;
  const readRoots = Array.isArray(filesystem?.readPaths) ? filesystem.readPaths : [];
  const writeRoots = Array.isArray(filesystem?.writePaths) ? filesystem.writePaths : [];
  if (!groupId || !plan || plan.status !== "paused" || plan.issueId !== task.id || plan.createdBy !== run.responsibleUserId ||
      run.status !== "running" || run.triggerDetail !== "provider_conformance" || run.runtimeMode !== "native" ||
      !run.responsibleUserId || task.hiddenAt === null || task.harnessKind !== "provider_conformance" || task.status !== "in_progress" ||
      task.responsibleUserId !== run.responsibleUserId || task.executionRunId !== run.id ||
      task.assigneeAgentId !== run.agentId || task.conversationAgentId !== null || task.conversationUserId !== null ||
      task.projectId !== null || task.parentId !== null || manifest.runId !== run.id || manifest.agentId !== run.agentId ||
      manifest.manifest.responsibleUserId !== run.responsibleUserId || manifest.manifest.capabilities.length !== 0 ||
      plan.actionClass !== "internal_draft" || plan.mode !== "single_worker" || plan.executionPrincipal?.type !== "user" ||
      plan.executionPrincipal.userId !== run.responsibleUserId || plan.riskClass !== "C0" || plan.budgets.maxToolActions !== 0 ||
      plan.budgets.maxRetries !== 0 || plan.toolActionsUsed !== 0 || source.attempt ||
      execution.binding.companyId !== run.companyId || execution.binding.runId !== run.id || execution.binding.agentId !== run.agentId ||
      execution.binding.issueId !== task.id || execution.binding.executionWorkspaceId !== proof.workspaceId ||
      execution.provider.kind !== "opencode" || execution.session.driverKind !== "opencode_server" ||
      proof.schema !== "paperclip.native-opencode-conformance-workspace/v1" || proof.groupId !== groupId ||
      proof.companyId !== run.companyId || proof.agentId !== run.agentId || proof.taskId !== task.id || proof.taskRoot !== taskRoot ||
      proof.localCwd !== root || proof.remoteCwd !== root || root !== taskRoot ||
      typeof proof.workspaceId !== "string" || typeof proof.creationReceipt !== "string" || !/^[a-f0-9]{64}$/.test(proof.creationReceipt) ||
      typeof proof.leaseId !== "string" || proof.leaseId !== source.lease.id ||
      typeof proof.providerLeaseId !== "string" || proof.providerLeaseId !== source.lease.providerLeaseId ||
      proof.authorityHash !== source.authorityHash || typeof leaseRoot !== "string" || path.resolve(leaseRoot) !== root ||
      !readRoots.some(value => typeof value === "string" && path.resolve(value) === root) ||
      !writeRoots.some(value => typeof value === "string" && path.resolve(value) === root) ||
      (purpose !== "native_workspace_prepare" && (sourceAuthority.version !== 1 ||
        sourceAuthority.executionInputHash !== nativeSha256(profile.nativeExecutionInput) ||
        !Array.isArray(sourceAuthority.toolSchemas) || sourceAuthority.toolSchemas.length !== 0)) ||
      (purpose === "provider_artifact" && (!sourceAuthority.artifactAuthority || typeof sourceAuthority.artifactAuthority !== "object")) ||
      (purpose !== "native_workspace_prepare" && (typeof proof.descriptorSha256 !== "string" || !/^[a-f0-9]{64}$/.test(proof.descriptorSha256) ||
        typeof proof.baselineSha256 !== "string" || !/^[a-f0-9]{64}$/.test(proof.baselineSha256) ||
        proof.workspaceRepositoryMode !== "server_verified_none")))
    throw conflict("The current hidden conformance Run, group workspace receipt, lease, or exact filesystem policy changed");
  return root;
}

export function runtimeControlService(
  db: Db,
  config: SaasPlatformConfig,
  notify?: NotifyCompany,
  options: { credentialBrokerOrigin?: string; workerModels?: ReturnType<typeof workerModelGateway> } = {},
) {
  const credentialBrokerOrigin = configuredPaperclipEndpointOrigin(options.credentialBrokerOrigin);
  const managedModelBrokerOrigin = credentialBrokerOrigin ? new URL(credentialBrokerOrigin).origin : null;
  const auth = runtimeHostAuth(db);
  const backups = runtimeBackupService(db, config);
  const relay = runtimeGatewayRelay({
    authenticateHost: (proof, raw) =>
      auth.authenticate(proof, "WS", "/api/internal/runtime/relay", raw),
    async hostCurrent(host) {
      const [current] = await db
        .select({ id: runtimeHosts.id })
        .from(runtimeHosts)
        .where(
          and(
            eq(runtimeHosts.id, host.id),
            eq(runtimeHosts.credentialVersion, host.credentialVersion),
            isNull(runtimeHosts.credentialRevokedAt),
            isNull(runtimeHosts.fencedAt),
            isNull(runtimeHosts.retiredAt),
            inArray(runtimeHosts.status, ["READY", "DRAINING"]),
            gt(
              runtimeHosts.lastHeartbeatAt,
              new Date(Date.now() - config.runtime.suspectSeconds * 1000),
            ),
          ),
        )
        .limit(1);
      return !!current;
    },
    async cellCurrent(cellId, scope) {
      const [cell] = await db
        .select({ id: runtimeCells.id })
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, cellId),
            eq(runtimeCells.companyId, scope.companyId),
            eq(runtimeCells.runtimeHostId, scope.runtimeHostId),
            eq(runtimeCells.generation, BigInt(scope.generation)),
            eq(runtimeCells.status, "HEALTHY"),
            isNull(runtimeCells.suspendedReason),
            isNull(runtimeCells.deletedAt),
          ),
        )
        .limit(1);
      return !!cell;
    },
    async authorizeCell(cellId, generation, token) {
      const [cell] = await db
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, cellId),
            eq(runtimeCells.generation, BigInt(generation)),
            eq(runtimeCells.status, "HEALTHY"),
            isNull(runtimeCells.suspendedReason),
            isNull(runtimeCells.deletedAt),
          ),
        )
        .limit(1);
      if (!cell?.runtimeHostId || !cell.gatewaySecretRef)
        throw forbidden("Runtime unavailable");
      const expected = await secretService(db).resolveSecretValue(
        cell.companyId,
        cell.gatewaySecretRef,
        "latest",
        {
          accessContext: {
            consumerType: "system",
            consumerId: cell.id,
            actorType: "system",
            actorId: "runtime-relay",
          },
        },
      );
      if (!equalDigest(sha256(token), sha256(expected)))
        throw forbidden("Runtime credential unavailable");
      return {
        runtimeHostId: cell.runtimeHostId,
        companyId: cell.companyId,
        generation: cell.generation.toString(),
      };
    },
    authorizeExec: (input) => authorizeSandboxExec(input),
  });
  type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
  async function meter(
    tx: Tx,
    cell: typeof runtimeCells.$inferSelect,
    now: Date,
    _diskBytes?: bigint,
  ) {
    if (!cell.activeSince || !cell.meteredThrough || now <= cell.meteredThrough)
      return;
    const end = new Date(
      Math.min(
        now.getTime(),
        cell.meteredThrough.getTime() +
          config.runtime.unreachableSeconds * 1000,
      ),
    );
    const sourceEventId =
      cell.generation.toString() +
      ":" +
      cell.meteredThrough.toISOString() +
      ":" +
      end.toISOString();
    const common = {
      companyId: cell.companyId,
      resourceType: "runtime_cell",
      resourceId: cell.id,
      periodStart: cell.meteredThrough,
      periodEnd: end,
      sourceEventId,
    };
    const elapsed = BigInt(end.getTime() - cell.meteredThrough.getTime());
    await usageService(db).record(
      {
        ...common,
        meterKey:
          cell.isolationMode === "dedicated_vm"
            ? "runtime.dedicated_vm_millisecond"
            : cell.isolationMode === "dedicated_agent_gateway"
              ? "runtime.dedicated_gateway_millisecond"
              : "runtime.shared_millisecond",
        quantity: elapsed,
      },
      tx,
    );
    // Gateway state, logs and safety backups are internal overhead, not customer application-storage charges.
  }
  async function getCell(companyId: string, cellId: string) {
    const [cell] = await db
      .select()
      .from(runtimeCells)
      .where(
        and(eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, cellId)),
      )
      .limit(1);
    if (!cell) throw notFound("Runtime cell not found");
    return cell;
  }
  async function assertStartAdmission(tx: Tx, cell: typeof runtimeCells.$inferSelect, now: Date) {
    await entitlementService(tx as unknown as Db).require(cell.companyId, "hosted_runtime.provision");
    const reason = await runtimeCommercialReason(tx, cell, now);
    if (reason)
      throw forbidden("Runtime commercial capacity is unavailable", { code: "RUNTIME_PLAN_LIMIT" });
    if (cell.status !== "STOPPED" || cell.deletedAt)
      throw conflict("Runtime state does not allow this operation");
  }
  async function assertSandboxStartAdmission(tx: Db, input: { actor: AuthorizationActor; companyId: string; cellId: string; userId: string; now?: Date }) {
    const now = input.now ?? new Date();
    await assertV5Authorization(tx, input.actor, input.companyId, "runtime:manage");
    const [initial] = await tx.select().from(runtimeCells).where(and(
      eq(runtimeCells.companyId, input.companyId), eq(runtimeCells.id, input.cellId), isNull(runtimeCells.deletedAt),
    )).limit(1);
    if (!initial) throw notFound("Runtime cell not found");
    await tx.select({ id: billingAccounts.id }).from(billingAccounts).where(eq(billingAccounts.id, initial.billingAccountId)).for("update");
    const [cell] = await tx.select().from(runtimeCells).where(and(
      eq(runtimeCells.companyId, input.companyId), eq(runtimeCells.id, input.cellId),
    )).for("update");
    if (!cell) throw notFound("Runtime cell not found");
    const [busy] = await tx.select({ id: runtimeOperations.id }).from(runtimeOperations).where(and(
      eq(runtimeOperations.runtimeCellId, input.cellId), inArray(runtimeOperations.status, ACTIVE_OPERATIONS),
    )).limit(1);
    if (busy) throw conflict("Runtime operation already active");
    await assertStartAdmission(tx as unknown as Tx, cell, now);
    if (cell.runtimeHostId) {
      const [host] = await tx.select().from(runtimeHosts).where(eq(runtimeHosts.id, cell.runtimeHostId)).limit(1);
      if (!host || host.fencedAt || host.credentialRevokedAt || host.retiredAt || !["READY", "DRAINING"].includes(host.status) || !host.lastHeartbeatAt || host.lastHeartbeatAt.getTime() <= now.getTime() - config.runtime.suspectSeconds * 1000)
        throw conflict("Runtime host is unavailable for sandbox admission");
    }
    return cell;
  }
  async function recordSandboxWorkloadState(tx: Db, input: {
    action: "start" | "stop"; companyId: string; cellId: string; bindingId: string; generation: string;
    hostCommandId: string; claimKey: string; policySnapshotId: string; executionManifestId: string;
    executionManifestHash: string; policyHash: string; userId: string; idempotencyKey?: string; now?: Date;
    nativeCleanup?: { companyId: string; runId: string; leaseId: string; receipt: unknown; originalRequesterUserId: string };
    nativePrelaunchCleanup?: { companyId: string; runId: string; leaseId: string; receipt: unknown; owner: NativeBootstrapPrelaunchCleanupOwner };
  }) {
    const now = input.now ?? new Date();
    const cleanup = input.nativeCleanup;
    const prelaunchCleanup = input.nativePrelaunchCleanup;
    if (cleanup && prelaunchCleanup) throw conflict("Native cleanup receipt kinds are mutually exclusive");
    const physical = cleanup ? await verifyRunLeaseCleanupReceipt(tx, cleanup, cleanup.receipt) : null;
    const prelaunchPhysical = prelaunchCleanup ? await verifyNativeBootstrapPrelaunchStopReceipt(tx, prelaunchCleanup,
      prelaunchCleanup.receipt) : null;
    if (cleanup && (input.action !== "stop" || cleanup.companyId !== input.companyId ||
      cleanup.originalRequesterUserId !== input.userId || physical?.sandboxStop.stopCommandId !== input.hostCommandId))
      throw conflict("Native cleanup state requires the exact original signed Stop");
    if (cleanup) {
      const owner = await readRunLeaseCleanup(tx, cleanup);
      if (owner.scope.cellId !== input.cellId || owner.scope.bindingId !== input.bindingId ||
        owner.scope.cellGeneration !== input.generation || owner.claimKey !== input.claimKey ||
        owner.session.policySnapshotId !== input.policySnapshotId || owner.session.manifestId !== input.executionManifestId ||
        owner.session.manifestHash !== input.executionManifestHash || owner.session.policyHash !== input.policyHash ||
        owner.startRequest.requesterUserId !== cleanup.originalRequesterUserId)
        throw conflict("Native cleanup state lost its original admission scope");
    }
    if (prelaunchCleanup) {
      if (input.action !== "stop" || prelaunchCleanup.companyId !== input.companyId ||
          prelaunchCleanup.owner.requesterUserId !== input.userId ||
          prelaunchPhysical?.prelaunchStop.stopCommandId !== input.hostCommandId)
        throw conflict("Native prelaunch cleanup state requires its exact signed Stop");
      const owner = await readNativeBootstrapPrelaunchCleanup(tx, prelaunchCleanup, prelaunchCleanup.owner);
      if (owner.owner.cellId !== input.cellId || owner.owner.bindingId !== input.bindingId ||
          owner.owner.generation !== input.generation || owner.owner.claimKey !== input.claimKey ||
          owner.owner.policySnapshotId !== input.policySnapshotId || owner.owner.manifestId !== input.executionManifestId ||
          owner.owner.manifestHash !== input.executionManifestHash || owner.owner.policyHash !== input.policyHash)
        throw conflict("Native prelaunch cleanup state lost its original admission scope");
    }
    const [cell] = await tx.select().from(runtimeCells).where(and(
      eq(runtimeCells.companyId, input.companyId), eq(runtimeCells.id, input.cellId),
      eq(runtimeCells.generation, BigInt(input.generation)), isNull(runtimeCells.deletedAt),
    )).for("update");
    const [binding] = await tx.execute(sql`select id,status,cell_generation from runtime_sandbox_bindings where company_id=${input.companyId}::uuid and id=${input.bindingId}::uuid and runtime_cell_id=${input.cellId}::uuid for update`);
    const [command] = await tx.select().from(runtimeHostCommands).where(and(
      eq(runtimeHostCommands.id, input.hostCommandId), eq(runtimeHostCommands.companyId, input.companyId),
      eq(runtimeHostCommands.runtimeCellId, input.cellId), eq(runtimeHostCommands.cellGeneration, BigInt(input.generation)),
      eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND), eq(runtimeHostCommands.status, "SUCCEEDED"),
    )).limit(1).for("share");
    if (!cell || !binding || !((cleanup || prelaunchCleanup) ? ["admitting", "running", "stopping", "quarantined", "stopped"].includes(String(binding.status)) : String(binding.status) === (input.action === "start" ? "admitting" : "stopping")) || String(binding.cell_generation) !== input.generation || !command)
      throw conflict("Signed sandbox workload receipt is no longer current");
    const payload = command.payload as Record<string, any>;
    const reply = command.safeResult as Record<string, any> | null;
    if (payload.action !== input.action || payload.scope?.bindingId !== input.bindingId || payload.scope?.companyId !== input.companyId || payload.scope?.cellId !== input.cellId || payload.scope?.cellGeneration !== input.generation || reply?.action !== input.action || (input.action === "start" ? reply.started !== true || reply.policyHash !== input.policyHash : reply.stopped !== true))
      throw conflict("Signed sandbox workload receipt does not match the requested state transition");
    if (input.action === "start" && (cell.status !== "STOPPED" || payload.start?.policyHash !== input.policyHash))
      throw conflict("Sandbox Start receipt is not bound to the current stopped-cell admission");
    const [claim] = await tx.select({ id: activityLog.id, details: activityLog.details }).from(activityLog).where(and(
      eq(activityLog.companyId, input.companyId), eq(activityLog.entityType, "runtime_sandbox"),
      eq(activityLog.entityId, input.bindingId), eq(activityLog.action, "sandbox.admission_claimed"),
      sql`${activityLog.details}->>'claimKey' = ${input.claimKey}`,
      sql`${activityLog.details}->>'policySnapshotId' = ${input.policySnapshotId}`,
      sql`${activityLog.details}->>'generation' = ${input.generation}`,
      sql`${activityLog.details}->>'executionManifestId' = ${input.executionManifestId}`,
      sql`${activityLog.details}->>'executionManifestHash' = ${input.executionManifestHash}`,
      sql`${activityLog.details}->>'policyHash' = ${input.policyHash}`,
    )).limit(1);
    if (!claim) throw conflict("Sandbox workload receipt has no exact native admission claim");
    const claimDetails = claim.details as Record<string, unknown>;
    const claimVersion = Number(claimDetails.claimVersion);
    const expectedVersion = Number(claimDetails.expectedVersion);
    if (input.action === "start" && (!Number.isSafeInteger(claimVersion) ||
      !Number.isSafeInteger(expectedVersion) || claimVersion !== expectedVersion + 1 ||
      payload.start?.idempotencyKey !== `v7-sandbox-start:${input.bindingId}:${input.generation}:${claimVersion}:${input.policySnapshotId}`))
      throw conflict("Sandbox Start receipt is not bound to the current admission epoch");
    if ((cleanup || prelaunchCleanup) && !["HEALTHY", "STOPPED"].includes(cell.status))
      throw conflict("Native cleanup cannot settle an ambiguous runtime meter state");
    const operationId = randomUUID();
    const requestHash = input.action === "stop" && input.idempotencyKey
      ? sha256(JSON.stringify({ cellId: input.cellId, action: "stop", idempotencyKey: input.idempotencyKey }))
      : sha256(JSON.stringify({ sandboxBindingId: input.bindingId, generation: input.generation, hostCommandId: input.hostCommandId, claimKey: input.claimKey, policySnapshotId: input.policySnapshotId, action: input.action }));
    const [operation] = await tx.insert(runtimeOperations).values({
      id: operationId, companyId: input.companyId, runtimeCellId: input.cellId,
      operationType: input.action, status: "SUCCEEDED", requestedByType: cleanup || prelaunchCleanup ? "system" : "user", requestedById: cleanup ? "native-run-cleanup" : prelaunchCleanup ? "native-bootstrap-cleanup" : input.userId,
      idempotencyKey: input.idempotencyKey ?? `sandbox-${input.action}:${input.bindingId}:${input.generation}:${input.hostCommandId}`,
      requestHash,
      desiredState: { sandboxAdmission: true, sandboxBindingId: input.bindingId, generation: input.generation, sandboxHostCommandId: input.hostCommandId, claimKey: input.claimKey, policySnapshotId: input.policySnapshotId, executionManifestId: input.executionManifestId, executionManifestHash: input.executionManifestHash, policyHash: input.policyHash,
        ...(cleanup ? { nativeCleanup: { companyId: cleanup.companyId, runId: cleanup.runId, leaseId: cleanup.leaseId, physicalReceiptDigest: nativeSha256(physical), originalRequesterUserId: cleanup.originalRequesterUserId } } : {}),
        ...(prelaunchCleanup ? { nativeBootstrapPrelaunchCleanup: { companyId: prelaunchCleanup.companyId,
          runId: prelaunchCleanup.runId, leaseId: prelaunchCleanup.leaseId, ownerDigest: nativeSha256(prelaunchCleanup.owner),
          physicalReceiptDigest: nativeSha256(prelaunchPhysical), physicalReceipt: prelaunchPhysical,
          stopCommandId: prelaunchPhysical!.prelaunchStop.stopCommandId,
          inspectCommandId: prelaunchPhysical!.prelaunchStop.inspectCommandId } } : {}) },
      deadlineAt: now, completedAt: now,
    }).returning();
    if (!operation) throw conflict("Runtime workload operation receipt could not be recorded");
    if (input.action === "start") {
      await tx.update(runtimeCells).set({ status: "HEALTHY", activeSince: now, meteredThrough: now, suspendedReason: null, lastErrorCode: null, updatedAt: now }).where(eq(runtimeCells.id, input.cellId));
    } else if (cell.status === "HEALTHY") {
      await meter(tx as unknown as Tx, cell, now);
      await tx.update(runtimeCells).set({ status: "STOPPED", activeSince: null, meteredThrough: now, lastErrorCode: null, updatedAt: now }).where(eq(runtimeCells.id, input.cellId));
    }
    if (input.action === "stop") {
      await tx.update(runtimeHostCommands).set({
        status: "CANCELED", errorCode: "sandbox_exec_quiesced_by_stop", completedAt: now,
      }).where(and(
        eq(runtimeHostCommands.companyId, input.companyId),
        eq(runtimeHostCommands.runtimeCellId, input.cellId),
        eq(runtimeHostCommands.cellGeneration, BigInt(input.generation)),
        eq(runtimeHostCommands.commandType, "sandbox_exec"),
        inArray(runtimeHostCommands.status, ["PENDING", "CLAIMED"]),
      ));
    }
    await tx.insert(activityLog).values({
      companyId: input.companyId, actorType: cleanup ? "system" : "user", actorId: cleanup ? "native-run-cleanup" : input.userId,
      action: input.action === "start" ? "runtime.sandbox_workload_started" : "runtime.sandbox_workload_stopped",
      entityType: "runtime_cell", entityId: input.cellId,
      details: { operationId: operation.id, sandboxBindingId: input.bindingId, sandboxHostCommandId: input.hostCommandId, generation: input.generation, ...(cleanup ? { originalRequesterUserId: cleanup.originalRequesterUserId } : {}) },
    });
    return operation!;
  }
  async function create(
    companyId: string,
    userId: string,
    input: z.infer<typeof runtimeCellCreateSchema>,
    now = new Date(),
    canaryOperatorId?: string,
  ) {
    await entitlementService(db).require(companyId, "platform.access");
    const state = await entitlementService(db).require(
      companyId,
      "hosted_runtime.provision",
    );
    if (canaryOperatorId && !config.operatorUserIds.includes(canaryOperatorId))
      throw forbidden("Internal canary operator required");
    const requestHash = sha256(
      JSON.stringify(canaryOperatorId ? { ...input, canaryOperatorId } : input),
    );
    return db.transaction(async (tx) => {
      await tx
        .select({ id: billingAccounts.id })
        .from(billingAccounts)
        .where(eq(billingAccounts.id, state.billingAccountId))
        .for("update");
      const [replay] = await tx
        .select()
        .from(runtimeOperations)
        .where(
          and(
            eq(runtimeOperations.companyId, companyId),
            eq(runtimeOperations.operationType, "provision"),
            eq(runtimeOperations.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw conflict("Idempotency key has a different request");
        return {
          cell: await getCell(companyId, replay.runtimeCellId),
          operation: replay,
        };
      }
      const current = await entitlementService(db).require(
        companyId,
        "hosted_runtime.provision",
      );
      const key =
        input.isolationMode === "dedicated_vm"
          ? "hosted_runtime.dedicated_vm.max_cells"
          : input.isolationMode === "dedicated_agent_gateway"
            ? "hosted_runtime.dedicated_gateway.max_cells"
            : "hosted_runtime.standard.max_cells";
      const occupied = await tx
        .select({ id: runtimeCells.id })
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.billingAccountId, current.billingAccountId),
            eq(runtimeCells.isolationMode, input.isolationMode),
            isNull(runtimeCells.deletedAt),
          ),
        );
      if (BigInt(occupied.length) >= BigInt(String(current.entitlements[key])))
        throw forbidden("Runtime plan capacity exceeded", {
          code: "RUNTIME_PLAN_LIMIT",
        });
      const [capacity] = await tx
        .select()
        .from(runtimeCapacityProfiles)
        .where(
          and(
            eq(runtimeCapacityProfiles.key, input.capacityProfile),
            eq(runtimeCapacityProfiles.qualified, true),
          ),
        )
        .limit(1);
      if (!capacity?.benchmarkEvidence)
        throw unprocessable("Runtime capacity profile is not qualified");
      const products =
        input.isolationMode === "company_cell"
          ? ["runtime_standard", "runtime_performance"]
          : input.isolationMode === "dedicated_vm"
            ? ["runtime_dedicated_vm"]
            : ["runtime_dedicated_gateway"];
      if (!products.includes(capacity.commercialProductKey))
        throw forbidden(
          "Capacity does not match the selected runtime product",
          { code: "RUNTIME_PRODUCT_MISMATCH" },
        );
      if (capacity.commercialProductKey === "runtime_performance") {
        const performance = await tx
          .select({ id: runtimeCells.id })
          .from(runtimeCells)
          .innerJoin(
            runtimeCapacityProfiles,
            eq(runtimeCapacityProfiles.key, runtimeCells.capacityProfile),
          )
          .where(
            and(
              eq(runtimeCells.billingAccountId, current.billingAccountId),
              eq(
                runtimeCapacityProfiles.commercialProductKey,
                "runtime_performance",
              ),
              isNull(runtimeCells.deletedAt),
            ),
          );
        if (
          BigInt(performance.length) >=
          BigInt(
            String(
              current.entitlements["hosted_runtime.performance.max_cells"],
            ),
          )
        )
          throw forbidden("Performance runtime capacity requires its add-on", {
            code: "RUNTIME_PLAN_LIMIT",
          });
      }
      const [version] = await tx
        .select()
        .from(runtimeVersionCatalog)
        .where(
          and(
            eq(runtimeVersionCatalog.imageDigest, input.imageDigest),
            inArray(
              runtimeVersionCatalog.status,
              canaryOperatorId ? ["canary", "approved"] : ["approved"],
            ),
          ),
        )
        .limit(1);
      if (
        !version ||
        (!canaryOperatorId &&
          (!version.approvedAt || !version.approvedByUserId))
      )
        throw unprocessable("Runtime version is not approved");
      if (input.dedicatedAgentId) {
        const [agent] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(
            and(
              eq(agents.id, input.dedicatedAgentId),
              eq(agents.companyId, companyId),
              ne(agents.status, "terminated"),
            ),
          )
          .limit(1);
        if (!agent) throw notFound("Agent not found");
      }
      const id = randomUUID();
      const secret = await secretService(tx).create(
        companyId,
        {
          name: "Runtime Gateway " + id,
          provider: "local_encrypted",
          value: randomToken(),
          description: "Managed runtime Gateway authentication",
        },
        { userId },
      );
      const [cell] = await tx
        .insert(runtimeCells)
        .values({
          id,
          companyId,
          billingAccountId: current.billingAccountId,
          isolationMode: input.isolationMode,
          capacityProfile: capacity.key,
          desiredImageDigest: version.imageDigest,
          dedicatedAgentId: input.dedicatedAgentId,
          gatewaySecretRef: secret.id,
          stateStorageRef: "cell:" + id,
        })
        .returning();
      const [operation] = await tx
        .insert(runtimeOperations)
        .values({
          companyId,
          runtimeCellId: id,
          operationType: "provision",
          requestedByType: "user",
          requestedById: userId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          desiredState: {
            imageDigest: input.imageDigest,
            ...(canaryOperatorId ? { canaryOperatorId } : {}),
          },
          deadlineAt: new Date(now.getTime() + 900000),
        })
        .returning();
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "runtime.provision_requested",
          entityType: "runtime_cell",
          entityId: id,
          details: {
            operationId: operation!.id,
            isolationMode: input.isolationMode,
          },
        });
      return { cell: cell!, operation: operation! };
    });
  }
  async function request(
    companyId: string,
    cellId: string,
    userId: string,
    input: z.infer<typeof runtimeOperationSchema>,
    now = new Date(),
    systemActor?: "backup-scheduler" | "sandbox-guardian",
    expectedGeneration?: string,
  ) {
    if (systemActor === "sandbox-guardian" && (input.action !== "stop" || !expectedGeneration || !/^[1-9][0-9]{0,18}$/.test(expectedGeneration))) throw forbidden("Sandbox safety recovery only requests generation-bound native Stop");
    if (["upgrade", "migrate", "restore"].includes(input.action))
      await entitlementService(db).require(
        companyId,
        "hosted_runtime.provision",
      );
    const requestHash = sha256(JSON.stringify({ cellId, ...input, ...(systemActor ? { systemActor } : {}), ...(expectedGeneration ? { expectedGeneration } : {}) }));
    return db.transaction(async (tx) => {
      const initial = await getCell(companyId, cellId);
      await tx
        .select({ id: billingAccounts.id })
        .from(billingAccounts)
        .where(eq(billingAccounts.id, initial.billingAccountId))
        .for("update");
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, cellId),
            eq(runtimeCells.companyId, companyId),
          ),
        )
        .for("update");
      if (!cell) throw notFound("Runtime cell not found");
      if (expectedGeneration && cell.generation.toString() !== expectedGeneration) throw conflict("Runtime generation changed before the safety operation");
      const [replay] = await tx
        .select()
        .from(runtimeOperations)
        .where(
          and(
            eq(runtimeOperations.companyId, companyId),
            eq(runtimeOperations.operationType, input.action),
            eq(runtimeOperations.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw conflict("Idempotency key has a different request");
        return replay;
      }
      if (cell.deletedAt) throw conflict("Runtime cell was deleted");
      const [busy] = await tx
        .select({ id: runtimeOperations.id })
        .from(runtimeOperations)
        .where(
          and(
            eq(runtimeOperations.runtimeCellId, cellId),
            inArray(runtimeOperations.status, ACTIVE_OPERATIONS),
          ),
        )
        .limit(1);
      if (busy) throw conflict("Runtime operation already active");
      if (input.action === "stop" && cell.status === "STOPPED") {
        const [receipt] = await tx.select().from(activityLog).where(and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.entityType, "runtime_sandbox"),
          eq(activityLog.action, "sandbox.workload_stopped"),
          sql`${activityLog.details}->>'cellId' = ${cellId}`,
          sql`${activityLog.details}->>'idempotencyKey' = ${input.idempotencyKey}`,
          sql`${activityLog.details}->>'stopConfirmed' = 'true'`,
        )).orderBy(sql`${activityLog.createdAt} desc, ${activityLog.id} desc`).limit(1);
        if (receipt) {
          const details = receipt.details as Record<string, unknown>;
          const [completed] = await tx.insert(runtimeOperations).values({
            companyId, runtimeCellId: cellId, operationType: "stop", status: "SUCCEEDED",
            requestedByType: systemActor ? "system" : "user", requestedById: systemActor ?? userId,
            idempotencyKey: input.idempotencyKey, requestHash,
            desiredState: { sandboxBindingId: receipt.entityId, sandboxHostOperationId: details.operationId, workloadStopped: true },
            deadlineAt: now, completedAt: now,
          }).returning();
          await tx.insert(activityLog).values({
            companyId, actorType: systemActor ? "system" : "user", actorId: systemActor ?? userId,
            action: "runtime.sandbox_stop_completed", entityType: "runtime_cell", entityId: cellId,
            details: { operationId: completed!.id, sandboxBindingId: receipt.entityId, sandboxHostOperationId: details.operationId },
          });
          return completed!;
        }
      }
      if (input.action === "start") {
        await assertStartAdmission(tx as unknown as Tx, cell, now);
        await tx.update(runtimeCells).set({ suspendedReason: null, updatedAt: now }).where(eq(runtimeCells.id, cell.id));
      } else if (["upgrade", "restore", "migrate"].includes(input.action)) {
        const reason = await runtimeCommercialReason(tx, cell, now);
        if (reason)
          throw forbidden("Runtime commercial capacity is unavailable", {
            code: "RUNTIME_PLAN_LIMIT",
          });
      }
      if (
        (input.action === "start" && cell.status !== "STOPPED") ||
        (input.action === "stop" &&
          !["HEALTHY", "DEGRADED", "FAILED"].includes(cell.status))
      )
        throw conflict("Runtime state does not allow this operation");
      if (
        ["backup", "upgrade", "rotate_gateway"].includes(input.action) &&
        cell.status !== "STOPPED"
      )
        throw conflict("Stop the runtime before changing its state or image");
      if (input.action === "upgrade") {
        if (!input.imageDigest)
          throw unprocessable("Approved target image required");
        const [target] = await tx
          .select()
          .from(runtimeVersionCatalog)
          .where(
            and(
              eq(runtimeVersionCatalog.imageDigest, input.imageDigest),
              eq(runtimeVersionCatalog.status, "approved"),
            ),
          )
          .limit(1);
        const [source] = await tx
          .select()
          .from(runtimeVersionCatalog)
          .where(
            eq(
              runtimeVersionCatalog.imageDigest,
              cell.activeImageDigest ?? cell.desiredImageDigest,
            ),
          )
          .limit(1);
        if (!target || !source || target.stateFormat !== source.stateFormat)
          throw unprocessable(
            "State format changes require a qualified backup and restore migration",
          );
      }
      const [initialProvision] = await tx
        .select({ desired: runtimeOperations.desiredState })
        .from(runtimeOperations)
        .where(
          and(
            eq(runtimeOperations.runtimeCellId, cell.id),
            eq(runtimeOperations.operationType, "provision"),
          ),
        )
        .limit(1);
      const canaryOperatorId =
        typeof initialProvision?.desired.canaryOperatorId === "string" &&
        config.operatorUserIds?.includes(
          initialProvision.desired.canaryOperatorId,
        ) &&
        initialProvision.desired.imageDigest === cell.desiredImageDigest
          ? initialProvision.desired.canaryOperatorId
          : undefined;
      const transactionDb = tx as unknown as Db;
      let backupId = input.backupId;
      if (input.action === "backup")
        backupId = (await backups.prepare(transactionDb, cell, userId, now)).id;
      if (input.action === "upgrade") {
        if (!backupId)
          throw unprocessable("A verified backup is required before upgrading");
        const backup = await backups.get(companyId, backupId, tx);
        if (
          backup.runtimeCellId !== cell.id ||
          backup.generation !== cell.generation ||
          backup.status !== "VERIFIED" ||
          backup.imageDigest !==
            (cell.activeImageDigest ?? cell.desiredImageDigest)
        )
          throw unprocessable(
            "Verified backup does not describe this runtime generation",
          );
      }
      let sourceGeneration: string | undefined;
      if (["restore", "migrate"].includes(input.action)) {
        if (!backupId) throw unprocessable("A verified backup is required");
        const backup = await backups.get(companyId, backupId, tx);
        if (backup.runtimeCellId !== cell.id || backup.status !== "VERIFIED")
          throw unprocessable("Verified company-scoped backup required");
        const [sourceHost] = cell.runtimeHostId
          ? await tx
              .select()
              .from(runtimeHosts)
              .where(eq(runtimeHosts.id, cell.runtimeHostId))
              .limit(1)
          : [];
        if (
          !sourceHost ||
          (cell.status !== "STOPPED" && !sourceHost.fencedAt) ||
          (input.action === "migrate" && !sourceHost.fencedAt)
        )
          throw conflict(
            "Source runtime must be stopped; moving hosts requires confirmed provider fencing",
          );
        const [version] = await tx
          .select()
          .from(runtimeVersionCatalog)
          .where(
            and(
              eq(runtimeVersionCatalog.imageDigest, backup.imageDigest),
              inArray(
                runtimeVersionCatalog.status,
                canaryOperatorId ? ["canary", "approved"] : ["approved"],
              ),
            ),
          )
          .limit(1);
        if (!version || version.stateFormat !== backup.stateFormat)
          throw unprocessable(
            "Restore image and state format must remain approved",
          );
        sourceGeneration = cell.generation.toString();
        if (!cell.gatewaySecretRef)
          throw conflict("Gateway credential unavailable");
        await secretService(tx).rotate(
          cell.gatewaySecretRef,
          { value: randomToken() },
          { userId },
        );
        await tx
          .update(runtimeCells)
          .set({
            generation: sql`${runtimeCells.generation}+1`,
            desiredImageDigest: backup.imageDigest,
            activeImageDigest: null,
            activeSince: null,
            meteredThrough: null,
            modelSecretRef: null,
            modelSecretVersion: null,
            ...(sourceHost.fencedAt ? { runtimeHostId: null } : {}),
            updatedAt: now,
          })
          .where(eq(runtimeCells.id, cell.id));
      }
      if (input.action === "rotate_gateway") {
        if (!cell.gatewaySecretRef)
          throw conflict("Gateway credential unavailable");
        await secretService(tx).rotate(
          cell.gatewaySecretRef,
          { value: randomToken() },
          { userId },
        );
      }
      const [operation] = await tx
        .insert(runtimeOperations)
        .values({
          companyId,
          runtimeCellId: cellId,
          operationType: input.action,
          requestedByType: systemActor ? "system" : "user",
          requestedById: systemActor ?? userId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          desiredState: {
            ...(expectedGeneration ? { expectedCellGeneration: expectedGeneration } : {}),
            ...(canaryOperatorId ? { canaryOperatorId } : {}),
            ...(input.imageDigest ? { imageDigest: input.imageDigest } : {}),
            ...(backupId ? { backupId } : {}),
            ...(sourceGeneration ? { sourceGeneration } : {}),
          },
          deadlineAt: new Date(
            now.getTime() +
              (["backup", "restore", "migrate"].includes(input.action)
                ? 3600000
                : 900000),
          ),
        })
        .returning();
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: systemActor ? "system" : "user",
          actorId: systemActor ?? userId,
          action: "runtime." + input.action + "_requested",
          entityType: "runtime_cell",
          entityId: cellId,
          details: { operationId: operation!.id, ...(systemActor === "backup-scheduler" ? { approvedByUserId: userId, scheduled: true } : {}), ...(systemActor === "sandbox-guardian" ? { safetyRecovery: true, expectedCellGeneration: expectedGeneration } : {}) },
        });
      return operation!;
    });
  }
  async function dispatchOne(now = new Date(), admitNew = true) {
    return db.transaction(async (tx) => {
      const [operation] = await tx
        .select()
        .from(runtimeOperations)
        .where(
          and(
            inArray(runtimeOperations.status, [
              "REQUESTED",
              "WAITING_FOR_CAPACITY",
            ]),
            lte(runtimeOperations.notBefore, now),
            ...(admitNew
              ? []
              : [
                  inArray(runtimeOperations.operationType, [
                    "stop",
                    "delete",
                    "backup",
                    "rotate_gateway",
                  ]),
                ]),
          ),
        )
        .orderBy(runtimeOperations.createdAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!operation) return false;
      if (operation.deadlineAt <= now || operation.attemptCount >= 3) {
        await tx
          .update(runtimeOperations)
          .set({
            status: "FAILED",
            errorCode: "operation_deadline",
            completedAt: now,
          })
          .where(eq(runtimeOperations.id, operation.id));
        await tx
          .update(runtimeCells)
          .set({ lastErrorCode: "operation_deadline", updatedAt: now })
          .where(eq(runtimeCells.id, operation.runtimeCellId));
        return true;
      }
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(eq(runtimeCells.id, operation.runtimeCellId))
        .for("update")
        .limit(1);
      if (!cell || cell.deletedAt) throw conflict("Runtime unavailable");
      if (typeof operation.desiredState.expectedCellGeneration === "string" && operation.desiredState.expectedCellGeneration !== cell.generation.toString()) {
        await tx.update(runtimeOperations).set({ status: "CANCELED", errorCode: "stale_generation", completedAt: now, updatedAt: now }).where(eq(runtimeOperations.id, operation.id));
        return true;
      }
      if (
        ["provision", "start", "upgrade", "restore", "migrate"].includes(
          operation.operationType,
        )
      ) {
        const state = await entitlementService(tx as unknown as Db).resolve(
          cell.companyId,
          now,
        );
        if (
          cell.suspendedReason ||
          state.entitlements["platform.access"] !== true ||
          state.entitlements["hosted_runtime.provision"] !== true
        ) {
          await tx
            .update(runtimeOperations)
            .set({
              status: "CANCELED",
              errorCode: "commercial_admission_closed",
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(runtimeOperations.id, operation.id));
          if (!cell.runtimeHostId)
            await tx
              .update(runtimeCells)
              .set({
                status: "FAILED",
                lastErrorCode: "commercial_admission_closed",
                updatedAt: now,
              })
              .where(eq(runtimeCells.id, cell.id));
          return true;
        }
      }
      const [profile] = await tx
        .select()
        .from(runtimeCapacityProfiles)
        .where(eq(runtimeCapacityProfiles.key, cell.capacityProfile))
        .limit(1);
      if (
        !profile ||
        (!profile.qualified &&
          !["stop", "delete", "backup", "rotate_gateway"].includes(
            operation.operationType,
          ))
      )
        throw conflict("Runtime profile unavailable");
      let requiredHostVersion: string | undefined;
      if (
        !["stop", "delete", "backup", "rotate_gateway"].includes(
          operation.operationType,
        )
      ) {
        const canary =
          typeof operation.desiredState.canaryOperatorId === "string" &&
          config.operatorUserIds?.includes(
            operation.desiredState.canaryOperatorId,
          );
        const [version] = await tx
          .select({
            id: runtimeVersionCatalog.imageDigest,
            minimum: runtimeVersionCatalog.hostAgentMinimumVersion,
          })
          .from(runtimeVersionCatalog)
          .where(
            and(
              eq(
                runtimeVersionCatalog.imageDigest,
                String(
                  operation.desiredState.imageDigest ?? cell.desiredImageDigest,
                ),
              ),
              inArray(
                runtimeVersionCatalog.status,
                canary ? ["canary", "approved"] : ["approved"],
              ),
            ),
          )
          .limit(1);
        if (!version) {
          await tx
            .update(runtimeOperations)
            .set({
              status: "FAILED",
              errorCode: "runtime_version_not_approved",
              completedAt: now,
            })
            .where(eq(runtimeOperations.id, operation.id));
          return true;
        }
        requiredHostVersion = version.minimum;
      }
      let host = cell.runtimeHostId
        ? (
            await tx
              .select()
              .from(runtimeHosts)
              .where(eq(runtimeHosts.id, cell.runtimeHostId))
              .for("update")
          )[0]
        : undefined;
      if (!host) {
        [host] = await tx
          .select()
          .from(runtimeHosts)
          .where(
            and(
              eq(runtimeHosts.environment, config.environment),
              eq(runtimeHosts.region, config.runtime.region),
              eq(runtimeHosts.status, "READY"),
              isNull(runtimeHosts.fencedAt),
              isNull(runtimeHosts.credentialRevokedAt),
              isNull(runtimeHosts.drainRequestedAt),
              gt(
                runtimeHosts.lastHeartbeatAt,
                new Date(now.getTime() - config.runtime.suspectSeconds * 1000),
              ),
              cell.isolationMode === "dedicated_vm"
                ? and(
                    eq(runtimeHosts.dedicatedCompanyId, cell.companyId),
                    eq(runtimeHosts.cpuReservedMillis, 0),
                  )
                : isNull(runtimeHosts.dedicatedCompanyId),
              sql`${runtimeHosts.cpuTotalMillis}-${runtimeHosts.cpuReservedMillis} >= ${profile.cpuMillis}`,
              sql`${runtimeHosts.memoryTotalBytes}-${runtimeHosts.memoryReservedBytes} >= ${profile.memoryBytes.toString()}::bigint`,
              sql`${runtimeHosts.diskTotalBytes}-${runtimeHosts.diskReservedBytes} >= ${profile.diskBytes.toString()}::bigint`,
            ),
          )
          .orderBy(runtimeHosts.createdAt)
          .limit(1)
          .for("update", { skipLocked: true });
        if (host) {
          await tx
            .update(runtimeHosts)
            .set({
              cpuReservedMillis: sql`${runtimeHosts.cpuReservedMillis}+${profile.cpuMillis}`,
              memoryReservedBytes: sql`${runtimeHosts.memoryReservedBytes}+${profile.memoryBytes.toString()}::bigint`,
              diskReservedBytes: sql`${runtimeHosts.diskReservedBytes}+${profile.diskBytes.toString()}::bigint`,
            })
            .where(eq(runtimeHosts.id, host.id));
          await tx
            .update(runtimeCells)
            .set({ runtimeHostId: host.id })
            .where(eq(runtimeCells.id, cell.id));
        }
      }
      if (
        !host ||
        !(["stop", "delete", "backup", "rotate_gateway"].includes(
          operation.operationType,
        )
          ? ["READY", "DRAINING", "DEGRADED"].includes(host.status)
          : host.status === "READY") ||
        host.fencedAt ||
        host.credentialRevokedAt
      ) {
        await tx
          .update(runtimeOperations)
          .set({
            status: "WAITING_FOR_CAPACITY",
            notBefore: new Date(now.getTime() + 10000),
          })
          .where(eq(runtimeOperations.id, operation.id));
        await tx
          .update(runtimeCells)
          .set({ status: "WAITING_FOR_CAPACITY" })
          .where(eq(runtimeCells.id, cell.id));
        return true;
      }
      if (
        requiredHostVersion &&
        !hostVersionMeetsMinimum(host.hostAgentVersion, requiredHostVersion)
      ) {
        await tx
          .update(runtimeOperations)
          .set({
            status: "WAITING_FOR_CAPACITY",
            notBefore: new Date(now.getTime() + 30000),
            errorCode: "host_agent_upgrade_required",
          })
          .where(eq(runtimeOperations.id, operation.id));
        await tx
          .update(runtimeCells)
          .set({
            status: "WAITING_FOR_CAPACITY",
            lastErrorCode: "host_agent_upgrade_required",
            updatedAt: now,
          })
          .where(eq(runtimeCells.id, cell.id));
        return true;
      }
      const [command] = await tx
        .insert(runtimeHostCommands)
        .values({
          runtimeHostId: host.id,
          companyId: cell.companyId,
          runtimeCellId: cell.id,
          operationId: operation.id,
          cellGeneration: cell.generation,
          commandType: operation.operationType,
          idempotencyKey: operation.id + ":" + cell.generation.toString(),
          payload: {
            ...(cell.modelProvider &&
            cell.modelId &&
            cell.modelSecretRef &&
            cell.modelSecretVersion
              ? {
                  modelProvider: {
                    provider: cell.modelProvider,
                    modelId: cell.modelId,
                    secretId: cell.modelSecretRef,
                    version: cell.modelSecretVersion,
                  },
                }
              : {}),
            cellId: cell.id,
            companyId: cell.companyId,
            generation: cell.generation.toString(),
            imageDigest:
              operation.desiredState.imageDigest ?? cell.desiredImageDigest,
            isolationMode: cell.isolationMode,
            capacity: {
              cpuMillis: profile.cpuMillis,
              memoryBytes: profile.memoryBytes.toString(),
              diskBytes: profile.diskBytes.toString(),
              pidsLimit: profile.pidsLimit,
            },
            ...operation.desiredState,
          },
          deadlineAt: operation.deadlineAt,
        })
        .returning();
      await tx
        .insert(runtimeOperationAttempts)
        .values({
          operationId: operation.id,
          attemptNumber: operation.attemptCount + 1,
          runtimeHostId: host.id,
          commandId: command!.id,
          status: "dispatched",
        });
      await tx
        .update(runtimeOperations)
        .set({
          status: "RUNNING",
          attemptCount: sql`${runtimeOperations.attemptCount}+1`,
          version: sql`${runtimeOperations.version}+1`,
          updatedAt: now,
        })
        .where(eq(runtimeOperations.id, operation.id));
      await tx
        .update(runtimeCells)
        .set({
          status: CELL_ACTION_STATUS[operation.operationType] ?? "CONFIGURING",
          ...(typeof operation.desiredState.imageDigest === "string"
            ? { desiredImageDigest: operation.desiredState.imageDigest }
            : {}),
          updatedAt: now,
        })
        .where(eq(runtimeCells.id, cell.id));
      return true;
    });
  }
  async function claim(hostId: string, now = new Date(), admitNew = true) {
    const claimed = await db.transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(runtimeHosts)
        .where(
          and(
            eq(runtimeHosts.id, hostId),
            isNull(runtimeHosts.credentialRevokedAt),
            isNull(runtimeHosts.fencedAt),
          ),
        )
        .for("update");
      if (!host || !["READY", "DRAINING"].includes(host.status))
        throw forbidden("Host cannot claim commands");
      const [command] = await tx
        .select()
        .from(runtimeHostCommands)
        .where(
          and(
            eq(runtimeHostCommands.runtimeHostId, hostId),
            inArray(runtimeHostCommands.commandType, ["provision", "start", "upgrade", "stop", "delete", "backup", "restore", "migrate", "rotate_gateway"]),
            ...(admitNew
              ? []
              : [
                  inArray(runtimeHostCommands.commandType, [
                    "stop",
                    "delete",
                    "backup",
                    "rotate_gateway",
                  ]),
                ]),
            or(
              eq(runtimeHostCommands.status, "PENDING"),
              and(
                eq(runtimeHostCommands.status, "CLAIMED"),
                lte(runtimeHostCommands.leaseUntil, now),
              ),
            ),
            gt(runtimeHostCommands.deadlineAt, now),
            lt(runtimeHostCommands.attempt, 3),
            lte(runtimeHostCommands.notBefore, now),
          ),
        )
        .orderBy(runtimeHostCommands.createdAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!command) return null;
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, command.runtimeCellId!),
            eq(runtimeCells.companyId, command.companyId!),
            eq(runtimeCells.runtimeHostId, hostId),
            eq(runtimeCells.generation, command.cellGeneration!),
          ),
        )
        .limit(1);
      if (!cell || cell.deletedAt) {
        await tx
          .update(runtimeHostCommands)
          .set({ status: "CANCELED", errorCode: "stale_generation" })
          .where(eq(runtimeHostCommands.id, command.id));
        return null;
      }
      if (
        ["provision", "start", "upgrade", "restore", "migrate"].includes(
          command.commandType,
        )
      ) {
        const [operation] = await tx
          .select({ desired: runtimeOperations.desiredState })
          .from(runtimeOperations)
          .where(eq(runtimeOperations.id, command.operationId!))
          .limit(1);
        const canary =
          typeof operation?.desired.canaryOperatorId === "string" &&
          config.operatorUserIds?.includes(operation.desired.canaryOperatorId);
        const [version] = await tx
          .select({ minimum: runtimeVersionCatalog.hostAgentMinimumVersion })
          .from(runtimeVersionCatalog)
          .where(
            and(
              eq(
                runtimeVersionCatalog.imageDigest,
                String(command.payload.imageDigest),
              ),
              inArray(
                runtimeVersionCatalog.status,
                canary ? ["canary", "approved"] : ["approved"],
              ),
            ),
          )
          .limit(1);
        if (
          !version ||
          !hostVersionMeetsMinimum(host.hostAgentVersion, version.minimum)
        ) {
          const unknown = command.attempt > 0;
          await tx
            .update(runtimeHostCommands)
            .set({
              status: unknown ? "EXPIRED" : "CANCELED",
              errorCode: "runtime_version_admission_closed",
            })
            .where(eq(runtimeHostCommands.id, command.id));
          await tx
            .update(runtimeOperations)
            .set({
              status: unknown ? "NEEDS_RECONCILIATION" : "FAILED",
              errorCode: "runtime_version_admission_closed",
              updatedAt: now,
              ...(!unknown ? { completedAt: now } : {}),
            })
            .where(eq(runtimeOperations.id, command.operationId!));
          return null;
        }
        const state = await entitlementService(tx as unknown as Db).resolve(
          cell.companyId,
          now,
        );
        if (
          cell.suspendedReason ||
          state.entitlements["platform.access"] !== true ||
          state.entitlements["hosted_runtime.provision"] !== true
        ) {
          const unknown = command.attempt > 0;
          await tx
            .update(runtimeHostCommands)
            .set({
              status: unknown ? "EXPIRED" : "CANCELED",
              errorCode: "commercial_admission_closed",
            })
            .where(eq(runtimeHostCommands.id, command.id));
          await tx
            .update(runtimeOperations)
            .set({
              status: unknown ? "NEEDS_RECONCILIATION" : "CANCELED",
              errorCode: "commercial_admission_closed",
              updatedAt: now,
              ...(!unknown ? { completedAt: now } : {}),
            })
            .where(eq(runtimeOperations.id, command.operationId!));
          await tx
            .update(runtimeCells)
            .set({
              status: unknown ? "DEGRADED" : "FAILED",
              lastErrorCode: "commercial_admission_closed",
              updatedAt: now,
            })
            .where(eq(runtimeCells.id, cell.id));
          return null;
        }
      }
      const token = randomToken();
      await tx
        .update(runtimeHostCommands)
        .set({
          status: "CLAIMED",
          claimTokenHash: sha256(token),
          attempt: sql`${runtimeHostCommands.attempt}+1`,
          leaseUntil: new Date(
            Math.min(command.deadlineAt.getTime(), now.getTime() + 120000),
          ),
        })
        .where(eq(runtimeHostCommands.id, command.id));
      return { host, cell, command, token };
    });
    if (!claimed) return null;
    if (!claimed.cell.gatewaySecretRef)
      throw conflict("Runtime credential unavailable");
    const gatewayToken = await secretService(db).resolveSecretValue(
      claimed.cell.companyId,
      claimed.cell.gatewaySecretRef,
      "latest",
      {
        accessContext: {
          consumerType: "system",
          consumerId: claimed.cell.id,
          actorType: "system",
          actorId: "runtime-host:" + hostId,
        },
      },
    );
    const backupAction = ["backup", "restore", "migrate"].includes(
      claimed.command.commandType,
    );
    const backup = backupAction
      ? await backups.command(
          claimed.cell.companyId,
          claimed.cell.id,
          String(claimed.command.payload.backupId),
          hostId,
          claimed.command.commandType === "backup" ? "backup" : "restore",
          String(
            (claimed.command.payload.capacity as { diskBytes: string })
              .diskBytes,
          ),
        )
      : undefined;
    const modelRef = claimed.command.payload.modelProvider as
      | { provider: string; modelId: string; secretId: string; version: number }
      | undefined;
    const modelProvider =
      modelRef &&
      ["provision", "start", "upgrade", "rotate_gateway"].includes(
        claimed.command.commandType,
      )
        ? {
            provider: modelRef.provider,
            modelId: modelRef.modelId,
            apiKey: await secretService(db).resolveSecretValue(
              claimed.cell.companyId,
              modelRef.secretId,
              modelRef.version,
              {
                accessContext: {
                  consumerType: "system",
                  consumerId: claimed.cell.id,
                  actorType: "system",
                  actorId: "runtime-host:" + hostId,
                },
              },
            ),
          }
        : undefined;
    return {
      id: claimed.command.id,
      type: claimed.command.commandType,
      deadlineAt: claimed.command.deadlineAt,
      envelope: auth.protectCommand(claimed.host, claimed.command.id, {
        ...claimed.command.payload,
        claimToken: claimed.token,
        gatewayToken,
        ...(modelProvider ? { modelProvider } : {}),
        ...(backup ? { backup } : {}),
      }),
    };
  }
  async function renew(
    hostId: string,
    commandId: string,
    raw: unknown,
    now = new Date(),
  ) {
    const input = runtimeCommandResultSchema
      .pick({ claimToken: true, generation: true })
      .parse(raw);
    return db.transaction(async (tx) => {
      const [command] = await tx
        .select()
        .from(runtimeHostCommands)
        .where(
          and(
            eq(runtimeHostCommands.id, commandId),
            eq(runtimeHostCommands.runtimeHostId, hostId),
          ),
        )
        .for("update");
      if (
        !command ||
        command.status !== "CLAIMED" ||
        !command.claimTokenHash ||
        !equalDigest(command.claimTokenHash, sha256(input.claimToken)) ||
        command.cellGeneration !== BigInt(input.generation) ||
        !command.leaseUntil ||
        command.leaseUntil <= now ||
        command.deadlineAt <= now
      )
        throw conflict("Command claim is no longer current");
      const [cell] = await tx
        .select({ id: runtimeCells.id })
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, command.runtimeCellId!),
            eq(runtimeCells.runtimeHostId, hostId),
            eq(runtimeCells.generation, command.cellGeneration),
          ),
        )
        .limit(1);
      if (!cell) throw conflict("Stale runtime ownership");
      await tx
        .update(runtimeHostCommands)
        .set({
          leaseUntil: new Date(
            Math.min(command.deadlineAt.getTime(), now.getTime() + 120000),
          ),
        })
        .where(eq(runtimeHostCommands.id, command.id));
      return { renewed: true };
    });
  }
  async function complete(
    hostId: string,
    commandId: string,
    raw: unknown,
    now = new Date(),
    recovering = false,
  ) {
    const input = runtimeCommandResultSchema.parse(raw);
    return db.transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(runtimeHosts)
        .where(
          and(
            eq(runtimeHosts.id, hostId),
            isNull(runtimeHosts.credentialRevokedAt),
            isNull(runtimeHosts.fencedAt),
          ),
        )
        .for("update");
      if (!host) throw forbidden("Host credential unavailable");
      const [command] = await tx
        .select()
        .from(runtimeHostCommands)
        .where(
          and(
            eq(runtimeHostCommands.id, commandId),
            eq(runtimeHostCommands.runtimeHostId, hostId),
          ),
        )
        .for("update");
      if (
        !command ||
        (!recovering &&
          (!command.claimTokenHash ||
            !equalDigest(command.claimTokenHash, sha256(input.claimToken))))
      )
        throw forbidden("Invalid command claim");
      if (["SUCCEEDED", "FAILED"].includes(command.status))
        return { duplicate: true };
      if (
        !recovering &&
        (command.status !== "CLAIMED" ||
          !command.leaseUntil ||
          command.leaseUntil <= now ||
          command.deadlineAt <= now)
      )
        throw conflict("Command lease expired");
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, command.runtimeCellId!),
            eq(runtimeCells.companyId, command.companyId!),
            eq(runtimeCells.runtimeHostId, hostId),
            eq(runtimeCells.generation, BigInt(input.generation)),
          ),
        )
        .for("update");
      if (!cell || command.cellGeneration !== cell.generation)
        throw conflict("Stale runtime generation");
      const [operation] = await tx
        .select()
        .from(runtimeOperations)
        .where(eq(runtimeOperations.id, command.operationId!))
        .for("update");
      if (
        !operation ||
        operation.status !== (recovering ? "NEEDS_RECONCILIATION" : "RUNNING")
      )
        throw conflict("Operation is no longer active");
      const healthy = ["provision", "start", "upgrade"].includes(
        command.commandType,
      );
      if (
        input.success &&
        healthy &&
        (input.state !== "healthy" ||
          !input.evidence.gatewayHandshake ||
          !input.evidence.volumeMounted ||
          input.evidence.imageDigest !== command.payload.imageDigest)
      )
        throw unprocessable("Functional Gateway health evidence required");
      if (
        (input.success &&
          ["stop", "rotate_gateway"].includes(command.commandType) &&
          input.state !== "stopped") ||
        (input.success &&
          command.commandType === "delete" &&
          input.state !== "deleted")
      )
        throw unprocessable("Command state evidence mismatch");
      if (input.success && command.commandType === "backup") {
        if (
          input.state !== "backed_up" ||
          !input.evidence.backupSha256 ||
          !input.evidence.backupBytes ||
          !input.evidence.stateFormat
        )
          throw unprocessable("Backup integrity evidence required");
        const backup = await backups.get(
          cell.companyId,
          String(command.payload.backupId),
          tx,
        );
        const bytes = BigInt(input.evidence.backupBytes),
          maximum =
            BigInt(
              (command.payload.capacity as { diskBytes: string }).diskBytes,
            ) + 100000000n;
        if (
          backup.runtimeCellId !== cell.id ||
          backup.generation !== cell.generation ||
          backup.stateFormat !== input.evidence.stateFormat ||
          bytes < 32n ||
          bytes > maximum
        )
          throw unprocessable("Backup evidence scope or size mismatch");
        await tx
          .update(runtimeBackups)
          .set({
            status: "AVAILABLE",
            ciphertextSha256: input.evidence.backupSha256,
            byteSize: bytes,
            manifest: {
              format: "aw-state-archive-v1",
              companyId: cell.companyId,
              cellId: cell.id,
              generation: cell.generation.toString(),
              imageDigest: backup.imageDigest,
              stateFormat: backup.stateFormat,
            },
          })
          .where(eq(runtimeBackups.id, backup.id));
      }
      if (
        input.success &&
        ["restore", "migrate"].includes(command.commandType) &&
        (input.state !== "restored" ||
          !input.evidence.quarantined ||
          !input.evidence.credentialsRemoved)
      )
        throw unprocessable("Offline quarantine restore evidence required");
      if (
        !input.success &&
        command.commandType === "backup" &&
        typeof command.payload.backupId === "string"
      )
        await tx
          .update(runtimeBackups)
          .set({ status: "FAILED" })
          .where(
            and(
              eq(runtimeBackups.id, command.payload.backupId),
              eq(runtimeBackups.companyId, cell.companyId),
              eq(runtimeBackups.status, "REQUESTED"),
            ),
          );
      const status = input.success
        ? command.commandType === "delete"
          ? "DELETED"
          : command.commandType === "stop"
            ? "STOPPED"
            : healthy
              ? "HEALTHY"
              : "STOPPED"
        : "FAILED";
      if (["STOPPED", "DELETED", "FAILED"].includes(status))
        await meter(tx, cell, now);
      await tx
        .update(runtimeHostCommands)
        .set({
          status: input.success ? "SUCCEEDED" : "FAILED",
          safeResult: input.evidence,
          errorCode: input.errorCode ?? null,
          completedAt: now,
        })
        .where(eq(runtimeHostCommands.id, command.id));
      await tx
        .update(runtimeOperations)
        .set({
          status: input.success ? "SUCCEEDED" : "FAILED",
          errorCode: input.errorCode ?? null,
          completedAt: now,
          version: sql`${runtimeOperations.version}+1`,
          updatedAt: now,
        })
        .where(eq(runtimeOperations.id, operation.id));
      await tx
        .update(runtimeOperationAttempts)
        .set({
          status: input.success ? "succeeded" : "failed",
          completedAt: now,
          errorCode: input.errorCode ?? null,
        })
        .where(eq(runtimeOperationAttempts.commandId, command.id));
      await tx
        .update(runtimeCells)
        .set({
          status,
          lastErrorCode: input.errorCode ?? null,
          updatedAt: now,
          ...(healthy && input.success
            ? {
                activeImageDigest: input.evidence.imageDigest,
                activeSince: now,
                meteredThrough: now,
                lastHealthyAt: now,
              }
            : {}),
          ...(status === "DELETED" ? { deletedAt: now } : {}),
          ...(command.commandType === "backup" && input.success
            ? { lastBackupAt: now }
            : {}),
          ...(["STOPPED", "DELETED"].includes(status)
            ? { activeSince: null }
            : {}),
        })
        .where(eq(runtimeCells.id, cell.id));
      if (status === "DELETED") {
        const [profile] = await tx
          .select()
          .from(runtimeCapacityProfiles)
          .where(eq(runtimeCapacityProfiles.key, cell.capacityProfile))
          .limit(1);
        if (profile)
          await tx
            .update(runtimeHosts)
            .set({
              cpuReservedMillis: sql`${runtimeHosts.cpuReservedMillis}-${profile.cpuMillis}`,
              memoryReservedBytes: sql`${runtimeHosts.memoryReservedBytes}-${profile.memoryBytes.toString()}::bigint`,
              diskReservedBytes: sql`${runtimeHosts.diskReservedBytes}-${profile.diskBytes.toString()}::bigint`,
            })
            .where(eq(runtimeHosts.id, hostId));
      }
      await tx
        .insert(activityLog)
        .values({
          companyId: cell.companyId,
          actorType: "system",
          actorId: "runtime-host:" + hostId,
          action:
            "runtime.operation_" + (input.success ? "succeeded" : "failed"),
          entityType: "runtime_cell",
          entityId: cell.id,
          details: { operationId: operation.id, generation: input.generation },
        });
      if (notify && !input.success)
        await notify(
          cell.companyId,
          "runtime",
          "A managed runtime needs attention",
          "company/settings/runtime",
          operation.id + ":failed",
          tx,
        );
      return { duplicate: false };
    });
  }
  async function recoveryCommands(hostId: string) {
    return db
      .select({
        id: runtimeHostCommands.id,
        generation: runtimeHostCommands.cellGeneration,
      })
      .from(runtimeHostCommands)
      .innerJoin(
        runtimeOperations,
        eq(runtimeOperations.id, runtimeHostCommands.operationId),
      )
      .where(
        and(
          eq(runtimeHostCommands.runtimeHostId, hostId),
          eq(runtimeOperations.status, "NEEDS_RECONCILIATION"),
          inArray(runtimeHostCommands.status, ["CLAIMED", "EXPIRED"]),
        ),
      )
      .orderBy(runtimeHostCommands.createdAt)
      .limit(20)
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          generation: row.generation!.toString(),
        })),
      );
  }
  async function recordRecovery(
    hostId: string,
    commandId: string,
    raw: unknown,
    now = new Date(),
  ) {
    // This path accepts only a read-only replay of the host's fsynced terminal receipt; it never reissues work.
    if (!raw || typeof raw !== "object" || "claimToken" in raw)
      throw unprocessable("Invalid recovery receipt");
    return complete(
      hostId,
      commandId,
      { ...raw, claimToken: randomToken() },
      now,
      true,
    );
  }
  async function reconcileCommands(now = new Date()) {
    const candidates = await db
      .select({
        id: runtimeHostCommands.id,
        hostId: runtimeHostCommands.runtimeHostId,
      })
      .from(runtimeHostCommands)
      .innerJoin(
        runtimeOperations,
        eq(runtimeOperations.id, runtimeHostCommands.operationId),
      )
      .where(
        and(
          inArray(runtimeOperations.status, [
            "RUNNING",
            "NEEDS_RECONCILIATION",
          ]),
          inArray(runtimeHostCommands.status, [
            "CLAIMED",
            "PENDING",
            "EXPIRED",
          ]),
          or(
            lte(runtimeHostCommands.deadlineAt, now),
            and(
              sql`${runtimeHostCommands.attempt} >= 3`,
              lte(runtimeHostCommands.leaseUntil, now),
            ),
          ),
        ),
      )
      .orderBy(runtimeHostCommands.createdAt)
      .limit(20);
    for (const candidate of candidates)
      await db.transaction(async (tx) => {
        const [host] = await tx
          .select()
          .from(runtimeHosts)
          .where(eq(runtimeHosts.id, candidate.hostId))
          .for("update");
        const [command] = await tx
          .select()
          .from(runtimeHostCommands)
          .where(eq(runtimeHostCommands.id, candidate.id))
          .for("update");
        if (
          !host ||
          !command ||
          !["CLAIMED", "PENDING", "EXPIRED"].includes(command.status)
        )
          return;
        const [cell] = await tx
          .select()
          .from(runtimeCells)
          .where(eq(runtimeCells.id, command.runtimeCellId!))
          .for("update");
        const [operation] = await tx
          .select()
          .from(runtimeOperations)
          .where(eq(runtimeOperations.id, command.operationId!))
          .for("update");
        if (
          !cell ||
          !operation ||
          !["RUNNING", "NEEDS_RECONCILIATION"].includes(operation.status)
        )
          return;
        if (host.fencedAt) {
          await meter(tx, cell, host.fencedAt);
          await tx
            .update(runtimeOperations)
            .set({
              status: "FAILED",
              errorCode: "host_fenced_recovery_required",
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(runtimeOperations.id, operation.id));
          await tx
            .update(runtimeHostCommands)
            .set({
              status: "EXPIRED",
              errorCode: "host_fenced",
              completedAt: now,
            })
            .where(eq(runtimeHostCommands.id, command.id));
          await tx
            .update(runtimeCells)
            .set({
              status: "DEGRADED",
              activeSince: null,
              lastErrorCode: "host_fenced_recovery_required",
              updatedAt: now,
            })
            .where(eq(runtimeCells.id, cell.id));
          return;
        }
        if (operation.status === "NEEDS_RECONCILIATION") return;
        await tx
          .update(runtimeOperations)
          .set({
            status: "NEEDS_RECONCILIATION",
            errorCode: "command_outcome_unknown",
            updatedAt: now,
          })
          .where(eq(runtimeOperations.id, operation.id));
        await tx
          .update(runtimeHostCommands)
          .set({ status: "EXPIRED", errorCode: "command_outcome_unknown" })
          .where(eq(runtimeHostCommands.id, command.id));
        await tx
          .update(runtimeCells)
          .set({
            status: "DEGRADED",
            lastErrorCode: "command_outcome_unknown",
            updatedAt: now,
          })
          .where(eq(runtimeCells.id, cell.id));
        if (notify)
          await notify(
            cell.companyId,
            "runtime",
            "A runtime operation is being reconciled",
            "company/settings/runtime",
            operation.id + ":unknown",
            tx,
          );
      });
    return candidates.length;
  }
  async function heartbeat(hostId: string, raw: unknown, now = new Date()) {
    const input = runtimeHeartbeatSchema.parse(raw);
    return db.transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, hostId))
        .for("update");
      if (!host || host.fencedAt || host.credentialRevokedAt)
        throw forbidden("Host unavailable");
      const cells = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.runtimeHostId, hostId),
            isNull(runtimeCells.deletedAt),
          ),
        )
        .for("update");
      const seen = new Set<string>();
      for (const sample of input.cells) {
        if (seen.has(sample.cellId))
          throw unprocessable("Duplicate inventory cell");
        seen.add(sample.cellId);
        const cell = cells.find(
          (c) =>
            c.id === sample.cellId &&
            c.companyId === sample.companyId &&
            c.generation === BigInt(sample.generation),
        );
        if (
          !cell ||
          (sample.imageDigest !== cell.activeImageDigest &&
            sample.imageDigest !== cell.desiredImageDigest)
        )
          throw forbidden("Inventory scope mismatch");
      }
      const missing = cells.some(
        (cell) => cell.status === "HEALTHY" && !seen.has(cell.id),
      );
      await tx
        .update(runtimeHosts)
        .set({
          hostAgentVersion: input.agentVersion,
          lastHeartbeatAt: now,
          lastInventory: input,
          status: missing
            ? "DEGRADED"
            : host.drainRequestedAt
              ? "DRAINING"
              : "READY",
          updatedAt: now,
        })
        .where(eq(runtimeHosts.id, hostId));
      for (const cell of cells) {
        const sample = input.cells.find((s) => s.cellId === cell.id);
        if (cell.status === "HEALTHY") {
          await meter(
            tx,
            cell,
            now,
            sample ? BigInt(sample.diskBytes) : undefined,
          );
          await tx
            .update(runtimeCells)
            .set({
              meteredThrough: now,
              ...(sample?.status === "healthy"
                ? { lastHealthyAt: now }
                : { status: "DEGRADED", lastErrorCode: "gateway_unhealthy" }),
            })
            .where(eq(runtimeCells.id, cell.id));
        }
      }
      return { accepted: true };
    });
  }
  async function configureModel(
    companyId: string,
    cellId: string,
    userId: string,
    raw: unknown,
  ) {
    const input = runtimeModelProviderSchema.parse(raw);
    await entitlementService(db).require(companyId, "platform.access");
    return db.transaction(async (tx) => {
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, cellId),
            eq(runtimeCells.companyId, companyId),
          ),
        )
        .for("update");
      if (
        !cell ||
        cell.deletedAt ||
        !["REQUESTED", "WAITING_FOR_CAPACITY", "STOPPED"].includes(cell.status)
      )
        throw conflict("Stop the runtime before changing model credentials");
      const [busy] = await tx
        .select()
        .from(runtimeOperations)
        .where(
          and(
            eq(runtimeOperations.runtimeCellId, cellId),
            inArray(runtimeOperations.status, ACTIVE_OPERATIONS),
          ),
        )
        .limit(1);
      if (
        busy &&
        !(
          busy.operationType === "provision" &&
          busy.attemptCount === 0 &&
          ["REQUESTED", "WAITING_FOR_CAPACITY"].includes(busy.status)
        )
      )
        throw conflict("A runtime operation is already active");
      const [secret] = await tx
        .select()
        .from(companySecrets)
        .where(
          and(
            eq(companySecrets.id, input.secretId),
            eq(companySecrets.companyId, companyId),
          ),
        )
        .for("share")
        .limit(1);
      if (!secret || (secret.ownerUserId && secret.ownerUserId !== userId))
        throw forbidden("Model credential is unavailable");
      await tx
        .update(runtimeCells)
        .set({
          modelProvider: input.provider,
          modelId: input.modelId,
          modelSecretRef: input.secretId,
          modelSecretVersion: secret.latestVersion,
          updatedAt: new Date(),
        })
        .where(eq(runtimeCells.id, cellId));
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "runtime.model_provider_configured",
          entityType: "runtime_cell",
          entityId: cellId,
          details: {
            provider: input.provider,
            modelId: input.modelId,
            secretId: input.secretId,
            secretVersion: secret.latestVersion,
          },
        });
      return {
        configured: true,
        provider: input.provider,
        modelId: input.modelId,
      };
    });
  }
  async function bind(
    companyId: string,
    cellId: string,
    agentId: string,
    actor: AuthorizationActor,
  ) {
    await assertV5Authorization(
      db,
      { ...actor, ignoreInstanceAdmin: true },
      companyId,
      "agents:configure",
      { type: "agent", companyId, agentId },
    );
    return db.transaction(async (tx) => {
      const transactionDb = tx as unknown as Db;
      const [cell] = await tx
        .select()
        .from(runtimeCells)
        .where(
          and(
            eq(runtimeCells.id, cellId),
            eq(runtimeCells.companyId, companyId),
          ),
        )
        .for("update");
      if (
        !cell ||
        cell.deletedAt ||
        cell.status !== "HEALTHY" ||
        cell.suspendedReason ||
        !cell.gatewaySecretRef
      )
        throw conflict("A healthy runtime is required");
      if (cell.dedicatedAgentId && cell.dedicatedAgentId !== agentId)
        throw forbidden("Dedicated runtime belongs to another agent");
      const [agent] = await tx
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
        .for("update");
      if (!agent || !["idle", "error", "paused"].includes(agent.status))
        throw conflict("An idle agent is required for attachment");
      const expectedUrl =
        "ws://127.0.0.1:" +
        (config.runtime.relayPort ?? 3102) +
        "/cells/" +
        cell.id +
        "/" +
        cell.generation.toString();
      if (cell.providerBindingId) {
        const attached = await agentProviderBindingService(
          transactionDb,
        ).getForPresence(actor, companyId, agentId);
        if (attached?.provider.id !== cell.providerBindingId)
          throw conflict("Runtime is already attached to another presence");
        if (agent.adapterConfig.url === expectedUrl) return attached;
        await tx
          .update(agentProviderBindings)
          .set({ status: "revoked", updatedAt: new Date() })
          .where(eq(agentProviderBindings.id, cell.providerBindingId));
        await tx
          .update(agentPresenceRuntimeBindings)
          .set({
            status: "revoked",
            qualifiedConfigurationHash: null,
            conformanceSnapshotHash: null,
            updatedAt: new Date(),
          })
          .where(
            eq(
              agentPresenceRuntimeBindings.providerBindingId,
              cell.providerBindingId,
            ),
          );
      }
      const secret = {
        type: "secret_ref",
        secretId: cell.gatewaySecretRef,
        version: "latest",
      };
      await agentService(transactionDb).update(agentId, {
        adapterType: "openclaw_gateway",
        adapterConfig: {
          url: expectedUrl,
          authToken: secret,
          headers: { "x-aw-relay-token": secret },
          agentId: "main",
        },
      });
      const bindings = agentProviderBindingService(transactionDb);
      const binding = await bindings.create(actor, companyId, agentId, {
        providerType: "openclaw",
        providerEndpointRef: null,
        providerAgentRef: "main",
        isolationMode: "isolated_per_presence",
      });
      const presence = await bindings.attach(actor, companyId, agentId, {
        providerBindingId: binding.id,
        providerProfileRef:
          "aw:cell:" + cell.id + ":generation:" + cell.generation.toString(),
      });
      await tx
        .update(runtimeCells)
        .set({ providerBindingId: binding.id, updatedAt: new Date() })
        .where(eq(runtimeCells.id, cell.id));
      await tx
        .insert(activityLog)
        .values({
          companyId,
          actorType: "user",
          actorId: actor.userId!,
          action: "runtime.provider_attached",
          entityType: "runtime_cell",
          entityId: cell.id,
          details: {
            agentId,
            bindingId: binding.id,
            conformanceRequired: true,
          },
        });
      return { provider: binding, runtime: presence };
    });
  }
  async function cancelUnplacedForDeletion(
    companyId: string,
    userId: string,
    now = new Date(),
  ) {
    return db.transaction(async (tx) => {
      const operations = await tx
        .select()
        .from(runtimeOperations)
        .where(
          and(
            eq(runtimeOperations.companyId, companyId),
            inArray(runtimeOperations.status, [
              "REQUESTED",
              "WAITING_FOR_CAPACITY",
            ]),
            eq(runtimeOperations.operationType, "provision"),
          ),
        )
        .for("update", { skipLocked: true });
      for (const operation of operations) {
        const [cell] = await tx
          .select()
          .from(runtimeCells)
          .where(
            and(
              eq(runtimeCells.id, operation.runtimeCellId),
              isNull(runtimeCells.runtimeHostId),
              isNull(runtimeCells.deletedAt),
            ),
          )
          .for("update");
        if (!cell) continue;
        const [command] = await tx
          .select({ id: runtimeHostCommands.id })
          .from(runtimeHostCommands)
          .where(eq(runtimeHostCommands.runtimeCellId, cell.id))
          .limit(1);
        if (command) continue;
        await tx
          .update(runtimeOperations)
          .set({
            status: "CANCELED",
            completedAt: now,
            errorCode: "company_deletion",
          })
          .where(eq(runtimeOperations.id, operation.id));
        await tx
          .update(runtimeCells)
          .set({
            status: "DELETED",
            deletedAt: now,
            updatedAt: now,
            lastErrorCode: null,
          })
          .where(eq(runtimeCells.id, cell.id));
        await tx
          .insert(activityLog)
          .values({
            companyId,
            actorType: "user",
            actorId: userId,
            action: "runtime.unplaced_erased",
            entityType: "runtime_cell",
            entityId: cell.id,
            details: { operationId: operation.id, neverDispatched: true },
          });
      }
    });
  }
  async function list(companyId: string) {
    return db
      .select()
      .from(runtimeCells)
      .where(eq(runtimeCells.companyId, companyId))
      .orderBy(runtimeCells.createdAt);
  }
  function readCleanupAttestation(value: unknown): RemoteRuntimeCleanupAttestation | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    const keys = ["schema", "purpose", "executionProfile", "executionProfileHash", "jobId", "jobKey", "attemptNumber", "executionOwnerId", "locatorDigest",
      "companyPurgeOperationId", "startBindingDigest", "capabilityCommandId", "capabilities", "probes",
      "completedAt", "expiresAt"];
    if (Object.keys(candidate).length !== keys.length || keys.some(key => !Object.hasOwn(candidate, key)) ||
      candidate.schema !== "paperclip.remote-runtime-cleanup-attestation.v2" ||
      candidate.purpose !== NATIVE_RUNTIME_CLEANUP_PURPOSE || candidate.executionProfile !== NATIVE_RUNTIME_CLEANUP_PROFILE ||
      candidate.executionProfileHash !== REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROFILE_HASH ||
      typeof candidate.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(candidate.jobId) ||
      typeof candidate.jobKey !== "string" || !candidate.jobKey ||
      !Number.isSafeInteger(candidate.attemptNumber) || (candidate.attemptNumber as number) < 1 ||
      typeof candidate.executionOwnerId !== "string" || !candidate.executionOwnerId ||
      !/^[a-f0-9]{64}$/.test(String(candidate.locatorDigest)) ||
      !(candidate.companyPurgeOperationId === null ||
        (typeof candidate.companyPurgeOperationId === "string" && /^[0-9a-f-]{36}$/i.test(candidate.companyPurgeOperationId))) ||
      !/^[a-f0-9]{64}$/.test(String(candidate.startBindingDigest)) ||
      typeof candidate.capabilityCommandId !== "string" || !candidate.capabilityCommandId ||
      !Array.isArray(candidate.probes) ||
      ![candidate.completedAt, candidate.expiresAt].every(date => typeof date === "string" && Number.isFinite(Date.parse(date))))
      return null;
    if (!sandboxCapabilitySnapshotSchema.safeParse(candidate.capabilities).success || candidate.probes.some(probe => {
      if (!probe || typeof probe !== "object" || Array.isArray(probe)) return true;
      const row = probe as Record<string, unknown>;
      return typeof row.commandId !== "string" || typeof row.caseId !== "string" ||
        typeof row.control !== "string" || !/^[a-f0-9]{64}$/.test(String(row.contractHash)) ||
        row.verdict !== "pass" || !/^[a-f0-9]{64}$/.test(String(row.observationHash)) ||
        !/^[a-f0-9]{64}$/.test(String(row.targetQualificationHash));
    })) return null;
    return candidate as unknown as RemoteRuntimeCleanupAttestation;
  }
  async function remoteRuntimeAssetDispatchContext(locator: RemoteRuntimeAssetLocator, companyPurgeOperationId?: string,
    cleanup?: { refreshing: true; attestation?: RemoteRuntimeCleanupAttestation }) {
    await assertRemoteRuntimeAssetErasureReady(db, locator, companyPurgeOperationId);
    const startBinding = await readRemoteNativeSessionStartBinding(db, locator);
    if (!startBinding) throw conflict("Managed remote OpenCode erasure lacks its exact signed session-start authority", {
      code: REMOTE_ASSET_ERASURE_ERRORS.target, failedChecks: ["signed_session_start_missing"],
    });
    const [run] = await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, locator.companyId), eq(heartbeatRuns.id, locator.runId),
    ));
    const [lease] = await db.select().from(environmentLeases).where(and(
      eq(environmentLeases.companyId, locator.companyId), eq(environmentLeases.id, locator.environmentLeaseId),
      eq(environmentLeases.heartbeatRunId, locator.runId),
    ));
    const metadata = lease?.metadata && typeof lease.metadata === "object" && !Array.isArray(lease.metadata)
      ? lease.metadata as Record<string, unknown> : {};
    const remoteCwd = typeof metadata.remoteCwd === "string" ? metadata.remoteCwd.trim() : "";
    const profile = run?.runnerProfileJson && typeof run.runnerProfileJson === "object" && !Array.isArray(run.runnerProfileJson)
      ? run.runnerProfileJson as Record<string, unknown> : {};
    let execution: ReturnType<typeof parseNativeExecutionInput> | null = null;
    try { execution = parseNativeExecutionInput(profile.nativeExecutionInput); } catch { /* fail closed below */ }
    if (!run || !lease || !remoteCwd || sha256(remoteCwd) !== locator.remoteCwdDigest ||
      lease.environmentId !== locator.environmentId ||
      lease.provider !== locator.provider || lease.providerLeaseId !== locator.providerLeaseId ||
      startBinding.runnerInstanceId !== locator.runnerInstanceId ||
      startBinding.environmentLeaseId !== locator.environmentLeaseId || startBinding.provider !== locator.provider ||
      startBinding.providerLeaseId !== locator.providerLeaseId ||
      startBinding.normalizedSessionIdDigest !== locator.normalizedSessionIdDigest ||
      !execution || execution.provider.kind !== "opencode" || execution.session.driverKind !== "opencode_server" ||
      execution.binding.runId !== locator.runId || !execution.session.normalizedSessionId ||
      sha256(execution.session.normalizedSessionId) !== locator.normalizedSessionIdDigest)
      throw conflict("Managed remote OpenCode data erasure target no longer matches its current lease");
    if (cleanup?.attestation) {
      const attestation = readCleanupAttestation(cleanup.attestation);
      const [job] = attestation ? await db.select().from(memoryJobs).where(and(
        eq(memoryJobs.companyId, locator.companyId), eq(memoryJobs.id, attestation.jobId),
        eq(memoryJobs.jobKey, attestation.jobKey), eq(memoryJobs.attemptNumber, attestation.attemptNumber),
        eq(memoryJobs.executionOwnerId, attestation.executionOwnerId), eq(memoryJobs.status, "running"),
        gt(memoryJobs.leaseExpiresAt, new Date()),
      )).limit(1) : [];
      const jobSource = job?.sourceRefJson && typeof job.sourceRefJson === "object" && !Array.isArray(job.sourceRefJson)
        ? job.sourceRefJson as Record<string, unknown> : {};
      if (!attestation || !job || job.operationType !== "retention" || jobSource.kind !== "runtime_asset_erasure" ||
        jobSource.runId !== locator.runId || (jobSource.companyPurgeOperationId ?? null) !== (companyPurgeOperationId ?? null) ||
        !isRemoteRuntimeAssetLocator(jobSource.remoteAssetLocator, locator) ||
        remoteRuntimeAssetLocatorDigest(jobSource.remoteAssetLocator as RemoteRuntimeAssetLocator) !== attestation.locatorDigest ||
        attestation.locatorDigest !== remoteRuntimeAssetLocatorDigest(locator) ||
        attestation.companyPurgeOperationId !== (companyPurgeOperationId ?? null) ||
        attestation.startBindingDigest !== nativeSha256(startBinding))
        throw conflict("Managed remote OpenCode cleanup attestation lost its exact current MemoryJob claim");
      cleanup = { ...cleanup, attestation };
    }
    const cellRef = { 1: startBinding.cellId, 2: startBinding.cellGeneration };
    const [cell] = await db.select().from(runtimeCells).where(and(
      eq(runtimeCells.companyId, locator.companyId), eq(runtimeCells.id, cellRef[1]!),
      eq(runtimeCells.generation, BigInt(cellRef[2]!)), eq(runtimeCells.status, "HEALTHY"),
      isNull(runtimeCells.deletedAt), isNull(runtimeCells.suspendedReason),
    ));
    const [host] = cell?.runtimeHostId ? await db.select().from(runtimeHosts).where(and(
      eq(runtimeHosts.id, cell.runtimeHostId), eq(runtimeHosts.id, startBinding.hostId),
      eq(runtimeHosts.credentialVersion, startBinding.hostEpoch), isNull(runtimeHosts.fencedAt), isNull(runtimeHosts.credentialRevokedAt),
      isNull(runtimeHosts.retiredAt), inArray(runtimeHosts.status, ["READY", "DRAINING"]),
      gt(runtimeHosts.lastHeartbeatAt, new Date(Date.now() - config.runtime.suspectSeconds * 1000)),
    )) : [];
    const imageDigest = cell?.activeImageDigest ?? cell?.desiredImageDigest;
    const [software] = imageDigest ? await db.select({ minimum: runtimeVersionCatalog.hostAgentMinimumVersion })
      .from(runtimeVersionCatalog).where(and(eq(runtimeVersionCatalog.imageDigest, imageDigest),
        eq(runtimeVersionCatalog.status, "approved"))) : [];
    const [binding] = cell ? await db.select().from(runtimeSandboxBindings).where(and(
      eq(runtimeSandboxBindings.companyId, locator.companyId), eq(runtimeSandboxBindings.id, startBinding.bindingId),
      eq(runtimeSandboxBindings.runtimeCellId, cell.id),
      eq(runtimeSandboxBindings.cellGeneration, cellRef[2]!), eq(runtimeSandboxBindings.status, "running"),
    )) : [];
    const [manifest] = run.agentId ? await db.select().from(agentExecutionManifests).where(and(
      eq(agentExecutionManifests.companyId, locator.companyId), eq(agentExecutionManifests.id, startBinding.manifestId),
      eq(agentExecutionManifests.runId, locator.runId),
      eq(agentExecutionManifests.agentId, run.agentId),
    )) : [];
    const [agent] = run.agentId ? await db.select().from(agents).where(and(
      eq(agents.companyId, locator.companyId), eq(agents.id, run.agentId),
    )) : [];
    const [authorization] = manifest ? await db.select().from(agentExecutionAuthorizations).where(and(
      eq(agentExecutionAuthorizations.companyId, locator.companyId),
      eq(agentExecutionAuthorizations.manifestId, manifest.id),
    )) : [];
    const capability = binding?.capabilitySnapshot ? sandboxCapabilitySnapshotSchema.safeParse(binding.capabilitySnapshot) : null;
    const [qualification] = binding?.qualificationRunId ? await db.select().from(sandboxQualificationRuns).where(and(
      eq(sandboxQualificationRuns.companyId, locator.companyId), eq(sandboxQualificationRuns.bindingId, binding.id),
      eq(sandboxQualificationRuns.id, binding.qualificationRunId), eq(sandboxQualificationRuns.status, "passed"),
    )) : [];
    const [policy] = binding && manifest ? await db.select().from(runtimePolicySnapshots).where(and(
      eq(runtimePolicySnapshots.companyId, locator.companyId), eq(runtimePolicySnapshots.id, startBinding.policySnapshotId),
      eq(runtimePolicySnapshots.bindingId, binding.id), eq(runtimePolicySnapshots.executionManifestId, manifest.id),
      eq(runtimePolicySnapshots.status, "qualified"),
    )) : [];
    const expectedImageDigest = cell?.activeImageDigest ?? cell?.desiredImageDigest;
    const probeCases = binding ? sandboxProbeCases(binding.boundaryPolicyHash, binding.boundaryPolicy.requiredControls) : [];
    const qualificationMatches = Boolean(qualification && binding && capability?.success &&
      qualification.evidenceKind === "protected_host_report" &&
      qualification.reportHash === capability.data.qualificationHash && qualification.results.length === probeCases.length &&
      !probeCases.some(test => {
        const matches = qualification.results.filter(result => result.caseId === test.caseId);
        return matches.length !== 1 || matches[0]?.control !== test.control || matches[0]?.contractHash !== test.contractHash ||
          matches[0]?.verdict !== "pass" || !/^[a-f0-9]{64}$/.test(matches[0]?.observationHash ?? "");
      }));
    const targetChecks: Array<[string, boolean]> = [
      ["signed_start_binding_current", Boolean(startBinding.hostId && startBinding.cellId && startBinding.bindingId &&
        startBinding.manifestId && startBinding.policySnapshotId)],
      ["start_manifest_hash_matches", Boolean(manifest && manifest.hash === startBinding.manifestHash)],
      ["start_policy_hash_matches", Boolean(policy && policy.policyHash === startBinding.policyHash)],
      ["cell_current", Boolean(cell)],
      ["host_current", Boolean(host)],
      ["binding_running", Boolean(binding?.backend === "openshell" && binding.status === "running")],
      ["manifest_current", Boolean(manifest)],
      ["agent_present", Boolean(agent)],
      ["capability_snapshot_valid", Boolean(capability?.success && capability.data.evidenceKind === "protected_host_report")],
      ["capability_unexpired", Boolean(capability?.success && (cleanup?.refreshing === true ||
        capability.data.expiresAt > new Date().toISOString()))],
      ["image_matches", Boolean(capability?.success && capability.data.sandboxImageDigest === expectedImageDigest)],
      ["host_agent_version", Boolean(software && host && hostVersionMeetsMinimum(host.hostAgentVersion, software.minimum))],
      ["qualification_matches", qualificationMatches],
      // Policy expiry closes new execution. Erasure uses the exact immutable
      // policy named by the successful signed start claim and a new short-lived
      // cleanup capability, while the protected host capability itself must
      // still be current below.
      // These hashes come from separate authorities: the manifest authorization
      // records agent-runtime-fabric policy, while the runtime policy hashes the
      // current sandbox source authority. Require both rows and the exact
      // manifest linkage, but do not compare unlike hash domains during cleanup.
      ["execution_authorization_present", Boolean(authorization)],
      ["policy_manifest_matches", Boolean(policy && manifest && policy.sourcePolicyRefs.includes(`manifest:${manifest.id}:${manifest.hash}`))],
      ["policy_capability_matches", Boolean(policy && binding && policy.capabilitySnapshotHash === binding.capabilitySnapshotHash)],
      ["fixed_local_eraser_policy_isolated", Boolean(policy && nativeRuntimeErasurePolicyIsolated(policy.compilation.compiledPolicy))],
    ];
    if (targetChecks.some(([, passes]) => !passes) || !cell || !host || !binding || !manifest || !agent || !policy ||
      !capability?.success)
      throw conflict("Managed remote OpenCode data erasure is not qualified for the current signed sandbox target", {
        code: REMOTE_ASSET_ERASURE_ERRORS.target,
        failedChecks: targetChecks.filter(([, passes]) => !passes).map(([name]) => name),
      });
    let cleanupAuthorityDeadlineAt = new Date(Date.now() + 60_000);
    if (cleanup?.attestation) {
      const attestation = cleanup.attestation;
      const expectedCases = nativeRuntimeCleanupProbeCases(binding.boundaryPolicyHash, binding.boundaryPolicy.requiredControls);
      if (attestation.schema !== "paperclip.remote-runtime-cleanup-attestation.v2" ||
        attestation.purpose !== NATIVE_RUNTIME_CLEANUP_PURPOSE || attestation.executionProfile !== NATIVE_RUNTIME_CLEANUP_PROFILE ||
        attestation.executionProfileHash !== REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROFILE_HASH ||
        nativeSha256(sandboxCapabilityFacts(attestation.capabilities)) !== nativeSha256(sandboxCapabilityFacts(capability.data)) ||
        attestation.locatorDigest !== remoteRuntimeAssetLocatorDigest(locator) ||
        attestation.companyPurgeOperationId !== (companyPurgeOperationId ?? null) ||
        attestation.startBindingDigest !== nativeSha256(startBinding) ||
        attestation.attemptNumber < 1 || !attestation.executionOwnerId ||
        !Number.isFinite(Date.parse(attestation.completedAt)) || !Number.isFinite(Date.parse(attestation.expiresAt)) ||
        Date.parse(attestation.expiresAt) > Math.min(Date.parse(attestation.capabilities.expiresAt),
          Date.parse(attestation.completedAt) + 60_000) || Date.parse(attestation.expiresAt) <= Date.now() ||
        attestation.capabilityCommandId.length < 1 ||
        attestation.probes.length !== expectedCases.length || expectedCases.some((test, index) => {
          const probe = attestation.probes[index];
          return !probe || probe.caseId !== test.caseId || probe.control !== test.control ||
            probe.contractHash !== test.contractHash || probe.verdict !== "pass" ||
            !/^[a-f0-9]{64}$/.test(probe.observationHash) ||
            probe.targetQualificationHash !== attestation.capabilities.qualificationHash || !probe.commandId;
        }) || attestation.capabilities.evidenceKind !== "protected_host_report" ||
        attestation.capabilities.backend !== "openshell" || attestation.capabilities.sandboxImageDigest !== expectedImageDigest ||
        Date.parse(attestation.capabilities.testedAt) > Date.now() ||
        Date.parse(attestation.capabilities.expiresAt) <= Date.now() ||
        SANDBOX_CONTROLS.some(control =>
          !attestation.capabilities[control as keyof typeof attestation.capabilities]))
        throw conflict("Managed remote OpenCode erasure lacks a fresh complete signed host attestation", {
          code: REMOTE_ASSET_ERASURE_ERRORS.target, failedChecks: ["cleanup_attestation_invalid"],
        });
      const commandIds = [attestation.capabilityCommandId, ...attestation.probes.map(probe => probe.commandId)];
      const commandRows = await db.select().from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, locator.companyId), inArray(runtimeHostCommands.id, commandIds),
        eq(runtimeHostCommands.runtimeHostId, host.id), eq(runtimeHostCommands.runtimeCellId, cell.id),
        eq(runtimeHostCommands.cellGeneration, cell.generation), eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
        eq(runtimeHostCommands.status, "SUCCEEDED"),
      ));
      if (commandRows.length !== commandIds.length)
        throw conflict("Managed remote OpenCode erasure host attestation command receipts are incomplete", {
          code: REMOTE_ASSET_ERASURE_ERRORS.target, failedChecks: ["cleanup_attestation_receipts_missing"],
        });
      const cleanupProof = { version: 2, purpose: NATIVE_RUNTIME_CLEANUP_PURPOSE, executionProfile: NATIVE_RUNTIME_CLEANUP_PROFILE,
        executionProfileHash: REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROFILE_HASH, jobId: attestation.jobId, jobKey: attestation.jobKey,
        attemptNumber: attestation.attemptNumber, executionOwnerId: attestation.executionOwnerId,
        locatorDigest: attestation.locatorDigest, companyPurgeOperationId: attestation.companyPurgeOperationId,
        startBindingDigest: attestation.startBindingDigest };
      const byId = new Map(commandRows.map(row => [row.id, row]));
      const capabilityRow = byId.get(attestation.capabilityCommandId);
      const capabilityRequest = capabilityRow?.payload && typeof capabilityRow.payload === "object" && !Array.isArray(capabilityRow.payload)
        ? capabilityRow.payload as Record<string, unknown> : {};
      const capabilityResult = capabilityRow?.safeResult && typeof capabilityRow.safeResult === "object" && !Array.isArray(capabilityRow.safeResult)
        ? capabilityRow.safeResult as Record<string, unknown> : {};
      if (!capabilityRow || capabilityRequest.action !== "capabilities" ||
        capabilityRequest.requesterUserId !== undefined ||
        capabilityRequest.hostEpoch !== startBinding.hostEpoch || capabilityRequest.imageDigest !== expectedImageDigest ||
        nativeSha256(capabilityRequest.cleanupAttestation ?? null) !== nativeSha256(cleanupProof) ||
        nativeSha256(capabilityRequest.scope ?? null) !== nativeSha256({ companyId: locator.companyId,
          bindingId: binding.id, cellId: cell.id, cellGeneration: cell.generation.toString(),
          sandboxRef: binding.sandboxRef ?? `aw-v7-${binding.id}` }) ||
        nativeSha256(capabilityResult.capabilities ?? null) !== nativeSha256(attestation.capabilities))
        throw conflict("Managed remote OpenCode erasure protected report receipt changed", {
          code: REMOTE_ASSET_ERASURE_ERRORS.target, failedChecks: ["cleanup_capability_receipt_invalid"],
        });
      for (const test of expectedCases) {
        const probe = attestation.probes.find(candidate => candidate.caseId === test.caseId);
        const row = probe ? byId.get(probe.commandId) : null;
        const request = row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
          ? row.payload as Record<string, unknown> : {};
        const result = row?.safeResult && typeof row.safeResult === "object" && !Array.isArray(row.safeResult)
          ? row.safeResult as Record<string, unknown> : {};
        if (!probe || !row || request.action !== "probe" || request.requesterUserId !== undefined ||
          request.hostEpoch !== startBinding.hostEpoch || request.imageDigest !== expectedImageDigest ||
          nativeSha256(request.scope ?? null) !== nativeSha256({ companyId: locator.companyId,
            bindingId: binding.id, cellId: cell.id, cellGeneration: cell.generation.toString(),
            sandboxRef: binding.sandboxRef ?? `aw-v7-${binding.id}` }) ||
          nativeSha256(request.cleanupAttestation ?? null) !== nativeSha256(cleanupProof) ||
          nativeSha256(request.probe ?? null) !== nativeSha256(test) || result.action !== "probe" ||
          result.verdict !== "pass" || result.contractHash !== test.contractHash ||
          result.observationHash !== probe.observationHash ||
          result.targetQualificationHash !== attestation.capabilities.qualificationHash ||
          probe.targetQualificationHash !== attestation.capabilities.qualificationHash)
          throw conflict("Managed remote OpenCode erasure fixed probe receipt changed", {
            code: REMOTE_ASSET_ERASURE_ERRORS.target, failedChecks: ["cleanup_probe_receipt_invalid"],
          });
      }
      cleanupAuthorityDeadlineAt = new Date(attestation.expiresAt);
    }
    return { run, lease, remoteCwd, cell, host, binding, manifest, agent, policy,
      startBinding, cleanupAuthorityDeadlineAt };
  }
  async function stopSandboxRunLeaseForCleanup(input: { companyId: string; runId: string; leaseId: string }) {
    if (await isNativeBootstrapPrelaunchCleanupCandidate(db, input)) {
      // Claim the exact binding generation under the cell/binding locks before
      // the Host can receive Stop. A concurrent admission now sees stopping.
      const sandbox = executionSandboxService(db, { recordRuntimeWorkloadState: recordSandboxWorkloadState });
      await sandbox.claimNativeBootstrapPrelaunchStop(input);
      const physical = await nativeSandboxHostTransport(db).stopNativeBootstrapPrelaunchLease(input);
      return await sandbox.recordNativeBootstrapPrelaunchStop(input, physical);
    }
    const physical = await nativeSandboxHostTransport(db).stopRunLeaseForCleanup(input);
    return await executionSandboxService(db, { recordRuntimeWorkloadState: recordSandboxWorkloadState })
      .recordNativeCleanupStop(input, physical);
  }
  async function eraseStoppedNativeRuntimeAsset(locator: RemoteRuntimeAssetLocator,
    input: { jobId: string; jobKey: string; jobAttemptNumber: number; executionOwnerId: string; companyPurgeOperationId?: string }): Promise<RemoteRuntimeAssetRemovalReceipt> {
    const claimed = await assertRemoteRuntimeAssetErasureClaimCurrent(db, locator, input.companyPurgeOperationId);
    if (claimed.id !== input.jobId || claimed.jobKey !== input.jobKey || claimed.attemptNumber !== input.jobAttemptNumber ||
      claimed.executionOwnerId !== input.executionOwnerId)
      throw conflict("Stopped Native erasure does not own its current job");
    // A due privacy job may terminate an expired business lease. This invokes
    // the existing release owner; it never renews execution or substitutes a Human.
    const [initialLease] = await db.select().from(environmentLeases).where(and(
      eq(environmentLeases.companyId, locator.companyId), eq(environmentLeases.id, locator.environmentLeaseId),
      eq(environmentLeases.heartbeatRunId, locator.runId)));
    if (!initialLease) throw conflict("Stopped Native erasure lease unavailable");
    if (initialLease.status === "active") {
      const { environmentRuntimeService } = await import("../environment-runtime.js");
      let releaseFailed = false;
      await environmentRuntimeService(db, { executeSandboxTask, stopSandboxRunLease: stopSandboxRunLeaseForCleanup })
        .releaseRunLeases(locator.runId, "released", () => { releaseFailed = true; });
      if (releaseFailed) throw conflict("Stopped Native erasure could not settle its exact provider release");
    }
    const ready = await assertRemoteRuntimeAssetErasureReady(db, locator, input.companyPurgeOperationId);
    // A prior worker may have completed the physical erase and checkpointed its
    // exact receipt before losing its job lease. Readiness verifies that ledger
    // proof against this current claim and Stop; never repeat the remote effect.
    if (ready.removalReceipt?.stopProof.schema === "paperclip.native-sandbox-workload-stop.v1")
      return ready.removalReceipt;
    const owner = await readRunLeaseCleanup(db, { companyId: locator.companyId, runId: locator.runId,
      leaseId: locator.environmentLeaseId });
    const combined = await verifyNativeCleanupRuntimeState(db, owner.proof, owner.lease.metadata?.remoteExecutionTermination);
    const taskRoot = typeof owner.lease.metadata?.remoteCwd === "string" ? owner.lease.metadata.remoteCwd.trim() : "";
    const capability = sandboxCapabilitySnapshotSchema.safeParse(owner.binding.capabilitySnapshot);
    const target = capability.success ? capability.data.qualificationTarget : undefined;
    const [policy] = await db.select().from(runtimePolicySnapshots).where(and(
      eq(runtimePolicySnapshots.companyId, locator.companyId), eq(runtimePolicySnapshots.id, owner.session.policySnapshotId),
      eq(runtimePolicySnapshots.bindingId, owner.scope.bindingId)));
    const launches = await db.select({ payload: runtimeHostCommands.payload }).from(runtimeHostCommands).where(and(
      eq(runtimeHostCommands.companyId, locator.companyId), eq(runtimeHostCommands.commandType, "sandbox_exec"),
      eq(runtimeHostCommands.status, "SUCCEEDED"), eq(runtimeHostCommands.runtimeHostId, owner.session.hostId),
      eq(runtimeHostCommands.runtimeCellId, owner.session.cellId),
      eq(runtimeHostCommands.cellGeneration, BigInt(owner.session.cellGeneration)),
      sql`${runtimeHostCommands.payload}->>'runId' = ${locator.runId}`,
      sql`${runtimeHostCommands.payload}->>'leaseId' = ${locator.environmentLeaseId}`,
      sql`${runtimeHostCommands.payload}->>'nativePreparationPurpose' = 'native_session_start'`));
    const sessions = launches.flatMap(row => {
      const payload = row.payload as Record<string, unknown>;
      const session = payload.modelBrokerSession as Record<string, unknown> | undefined;
      return nativeSha256(payload.remoteNativeSessionStartBinding ?? null) === nativeSha256(owner.session) &&
        session?.phase === "start" && session.startBindingDigest === owner.proof.startBindingDigest &&
        typeof session.sessionKey === "string" && /^[a-f0-9]{64}$/.test(session.sessionKey) ? [session] : [];
    });
    if (sessions.length !== 1 || !target || !policy || !taskRoot || sha256(taskRoot) !== locator.remoteCwdDigest ||
      policy.policyHash !== owner.session.policyHash || policy.capabilitySnapshotHash !== owner.binding.capabilitySnapshotHash)
      throw conflict("Stopped Native erasure lacks its exact original Host session tombstone");
    const descriptor = { schema: "paperclip.remote-native-session-erasure.v1" as const,
      startBindingDigest: owner.proof.startBindingDigest, sessionKey: sessions[0]!.sessionKey as string,
      leaseId: locator.environmentLeaseId, taskRoot, sessionDigest: locator.normalizedSessionIdDigest,
      policyHash: owner.session.policyHash, sandboxId: owner.proof.sandboxId, containerId: owner.proof.containerId,
      imageDigest: owner.imageDigest, dockerEngineIdHash: target.dockerEngineIdHash,
      cellGeneration: owner.session.cellGeneration, runId: locator.runId, runnerInstanceId: locator.runnerInstanceId,
      ...(owner.attachmentStageReceipts.length ? { attachmentStageNonces: owner.attachmentStageReceipts
        .map(receipt => receipt.stageNonce).sort() } : {}) };
    const result = await nativeSandboxHostTransport(db).eraseStoppedNativeSession({ locator, ...input, descriptor });
    const receipt: RemoteRuntimeAssetRemovalReceipt = {
      schema: "paperclip.remote-runtime-asset-removal.v1", locatorDigest: remoteRuntimeAssetLocatorDigest(locator),
      commandRequestId: result.command.id, purpose: "native_provider_data_erasure",
      target: { hostId: owner.session.hostId, cellId: owner.session.cellId,
        cellGeneration: owner.session.cellGeneration, bindingId: owner.session.bindingId },
      relativePath: locator.relativePath, pathDigest: locator.pathDigest,
      stopProof: { schema: "paperclip.native-sandbox-workload-stop.v1", runId: locator.runId,
        normalizedSessionIdDigest: locator.normalizedSessionIdDigest, runnerInstanceId: locator.runnerInstanceId,
        environmentLeaseId: locator.environmentLeaseId, providerLeaseId: locator.providerLeaseId,
        startCommandId: combined.sandboxStop.startCommandId, stopCommandId: combined.sandboxStop.stopCommandId,
        inspectCommandId: combined.sandboxStop.inspectCommandId, runtimeOperationId: combined.sandboxStop.runtimeOperationId,
        startBindingDigest: combined.sandboxStop.startBindingDigest, sandboxId: combined.sandboxStop.sandboxId,
        containerId: combined.sandboxStop.containerId, receiptDigest: nativeSha256(combined), stoppedAt: combined.confirmedAt },
      stopProofBeforeDelete: true, exitCode: 0, timedOut: false, postDeleteAbsent: true };
    await db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      const currentJob = await assertRemoteRuntimeAssetErasureClaimCurrent(tx, locator, input.companyPurgeOperationId);
      await assertRemoteRuntimeAssetErasureReady(tx, locator, input.companyPurgeOperationId);
      const current = await readRunLeaseCleanup(tx, owner.proof);
      const currentStop = await verifyNativeCleanupRuntimeState(tx, owner.proof, current.lease.metadata?.remoteExecutionTermination);
      if (currentJob.id !== claimed.id || currentJob.attemptNumber !== claimed.attemptNumber ||
        currentJob.executionOwnerId !== claimed.executionOwnerId || nativeSha256(currentStop) !== nativeSha256(combined))
        throw conflict("Stopped Native erasure changed before receipt checkpoint");
      const [saved] = await tx.update(memoryJobs).set({ resultJson: {
        ...(currentJob.resultJson ?? {}), remoteRuntimeAssetRemovalReceipt: receipt } }).where(and(
        eq(memoryJobs.companyId, locator.companyId), eq(memoryJobs.id, currentJob.id), eq(memoryJobs.status, "running"),
        eq(memoryJobs.attemptNumber, claimed.attemptNumber), eq(memoryJobs.executionOwnerId, claimed.executionOwnerId!),
        gt(memoryJobs.leaseExpiresAt, new Date()))).returning({ id: memoryJobs.id });
      if (!saved) throw conflict("Stopped Native erasure job claim expired before checkpoint");
    });
    return receipt;
  }
  async function eraseRemoteNativeRuntimeAsset(
    locator: RemoteRuntimeAssetLocator,
    input: { jobId: string; jobKey: string; jobAttemptNumber: number; executionOwnerId: string; companyPurgeOperationId?: string },
  ): Promise<RemoteRuntimeAssetRemovalReceipt> {
    if (!isRemoteRuntimeAssetLocator(locator) || !/^[0-9a-f-]{36}$/i.test(input.jobId) ||
      input.jobKey !== `runtime-asset-erasure:v1:${locator.runId}`)
      throw conflict("Managed remote OpenCode erasure locator or MemoryJob identity is invalid", {
        code: REMOTE_ASSET_ERASURE_ERRORS.locator,
      });
    const expectedClaim = await assertRemoteRuntimeAssetErasureClaimCurrent(db, locator, input.companyPurgeOperationId);
    if (expectedClaim.id !== input.jobId || expectedClaim.jobKey !== input.jobKey ||
      expectedClaim.attemptNumber !== input.jobAttemptNumber || expectedClaim.executionOwnerId !== input.executionOwnerId)
      throw conflict("Remote Native erasure caller no longer owns its exact job attempt");
    const [selectedLease] = await db.select({ provider: environmentLeases.provider, status: environmentLeases.status, expiresAt: environmentLeases.expiresAt }).from(environmentLeases).where(and(
      eq(environmentLeases.companyId, locator.companyId), eq(environmentLeases.id, locator.environmentLeaseId),
      eq(environmentLeases.heartbeatRunId, locator.runId)));
    const selectedStart = selectedLease ? await readRemoteNativeSessionStartBinding(db, locator) : null;
    const [selectedBinding] = selectedStart ? await db.select({ backend: runtimeSandboxBindings.backend,
      status: runtimeSandboxBindings.status }).from(runtimeSandboxBindings).where(and(
      eq(runtimeSandboxBindings.companyId, locator.companyId), eq(runtimeSandboxBindings.id, selectedStart.bindingId))) : [];
    if (selectedBinding?.backend === "openshell" && (selectedBinding.status === "stopped" || selectedLease?.status !== "active" ||
      (selectedLease?.expiresAt !== null && selectedLease?.expiresAt !== undefined && selectedLease.expiresAt <= new Date())))
      return eraseStoppedNativeRuntimeAsset(locator, input);
    await remoteRuntimeAssetDispatchContext(locator, input.companyPurgeOperationId, { refreshing: true });
    const cleanupAttestation = await nativeSandboxHostTransport(db).refreshRemoteRuntimeCleanupAttestation({
      locator, jobId: input.jobId, jobKey: input.jobKey, companyPurgeOperationId: input.companyPurgeOperationId,
    });
    const source = await remoteRuntimeAssetDispatchContext(locator, input.companyPurgeOperationId,
      { refreshing: true, attestation: cleanupAttestation });
    const locatorDigest = remoteRuntimeAssetLocatorDigest(locator);
    let expectedProcessPid = source.run.processPid;
    let expectedProcessStartedAt = source.run.processStartedAt?.toISOString() ?? null;
    if (expectedProcessPid === null || expectedProcessStartedAt === null) {
      const completedCommands = await db.select({ payload: runtimeHostCommands.payload,
        safeResult: runtimeHostCommands.safeResult }).from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, locator.companyId), eq(runtimeHostCommands.commandType, "sandbox_exec"),
        eq(runtimeHostCommands.status, "SUCCEEDED"),
        sql`${runtimeHostCommands.payload}->>'nativePreparationPurpose' = 'native_provider_data_erasure'`,
        sql`${runtimeHostCommands.payload}->'remoteRuntimeAssetErasure'->>'locatorDigest' = ${locatorDigest}`,
      )).orderBy(desc(runtimeHostCommands.completedAt));
      const priorReceipt = completedCommands.map(command => {
        const payload = command.payload && typeof command.payload === "object" && !Array.isArray(command.payload)
          ? command.payload as Record<string, unknown> : {};
        const erasure = payload.remoteRuntimeAssetErasure && typeof payload.remoteRuntimeAssetErasure === "object" &&
          !Array.isArray(payload.remoteRuntimeAssetErasure) ? payload.remoteRuntimeAssetErasure as Record<string, unknown> : {};
        const result = command.safeResult && typeof command.safeResult === "object" && !Array.isArray(command.safeResult)
          ? command.safeResult as Record<string, unknown> : {};
        const receipt = result.remoteRuntimeAssetRemovalReceipt;
        if (erasure.jobKey !== input.jobKey || (erasure.companyPurgeOperationId ?? null) !== (input.companyPurgeOperationId ?? null) ||
          typeof erasure.expectedProcessPid !== "number" || !Number.isSafeInteger(erasure.expectedProcessPid) ||
          typeof erasure.expectedProcessStartedAt !== "string" || !isRemoteRuntimeAssetRemovalReceipt(receipt, locator) || receipt.stopProof.schema !== "paperclip.native-remote-process-stop.v1" ||
          receipt.commandRequestId !== payload.requestId || receipt.stopProof.pid !== erasure.expectedProcessPid ||
          receipt.stopProof.startedAt !== erasure.expectedProcessStartedAt) return null;
        return { pid: erasure.expectedProcessPid, startedAt: erasure.expectedProcessStartedAt };
      }).find(candidate => candidate !== null);
      if (!priorReceipt) throw conflict("Completed remote OpenCode erasure has no recoverable process generation");
      expectedProcessPid = priorReceipt.pid;
      expectedProcessStartedAt = priorReceipt.startedAt;
    }
    if (expectedProcessPid === null || !Number.isSafeInteger(expectedProcessPid) || expectedProcessPid <= 1 ||
      expectedProcessStartedAt === null || Number.isNaN(Date.parse(expectedProcessStartedAt)))
      throw conflict("Managed remote OpenCode erasure has no exact persisted process generation");
    const requestId = randomUUID();
    const deadlineAt = new Date(Math.min(Date.now() + 60_000, source.cleanupAuthorityDeadlineAt.getTime()));
    if (deadlineAt <= new Date()) throw conflict("Managed remote OpenCode erasure lease expired before dispatch", {
      code: REMOTE_ASSET_ERASURE_ERRORS.relay, upstreamStatus: null,
    });
    const command = ["/bin/sh", "-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT,
      "paperclip-native-asset-erasure", source.remoteCwd, locator.normalizedSessionIdDigest,
      locator.runId, locator.runnerInstanceId, locator.environmentLeaseId, locator.providerLeaseId,
      locator.normalizedSessionIdDigest, String(expectedProcessPid), expectedProcessStartedAt,
      REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
      REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT];
    const env: Record<string, string> = { ...REMOTE_NATIVE_ERASER_ENV };
    const commandDigest = nativeSha256({ argv: command, cwd: source.remoteCwd, env, stdinHash: sha256(""),
      timeoutDeadline: deadlineAt.toISOString(), brokerCapabilityHash: null, brokerProviderProfile: null,
      modelBrokerCapabilityHash: null, modelBrokerProviderProfile: null, modelBrokerSession: null });
    const attempt = Math.max(1, source.run.continuationAttempt + 1);
    const idempotencyKey = `managed-native-asset-erasure:v1:${nativeSha256({ companyId: locator.companyId,
      jobKey: input.jobKey, locatorDigest, purpose: "native_provider_data_erasure",
      companyPurgeOperationId: input.companyPurgeOperationId ?? null })}`;
    const desiredState = {
      kind: "sandbox_exec_v1", requestId, bindingId: source.binding.id,
      cellId: source.cell.id, generation: source.cell.generation.toString(), hostId: source.host.id,
      hostEpoch: source.host.credentialVersion, runId: source.run.id, attemptId: null,
      attempt, leaseId: source.lease.id, manifestId: source.manifest.id, manifestHash: source.manifest.hash,
      policySnapshotId: source.policy.id, policyHash: source.policy.policyHash,
      commandDigest, deadlineAt: deadlineAt.toISOString(), nativePreparationPurpose: "native_provider_data_erasure",
      remoteRuntimeAssetErasure: {
        locator, locatorDigest, jobId: input.jobId, jobKey: input.jobKey,
        purpose: "native_provider_data_erasure", formatVersion: 1, idempotencyKey,
        expectedProcessPid,
        expectedProcessStartedAt,
        cleanupAttestation,
        ...(input.companyPurgeOperationId ? { companyPurgeOperationId: input.companyPurgeOperationId } : {}),
      },
    };
    const admission = await db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      await lockAnalyticalCompany(tx, locator.companyId);
      await lockMemoryPrivacy(tx, locator.companyId);
      const [job] = await tx.select().from(memoryJobs).where(and(
        eq(memoryJobs.companyId, locator.companyId), eq(memoryJobs.id, input.jobId),
        eq(memoryJobs.jobKey, input.jobKey), eq(memoryJobs.status, "running"),
        gt(memoryJobs.leaseExpiresAt, new Date()),
      )).for("update");
      const jobSource = job?.sourceRefJson && typeof job.sourceRefJson === "object" && !Array.isArray(job.sourceRefJson)
        ? job.sourceRefJson as Record<string, unknown> : {};
      if (!job || job.operationType !== "retention" || jobSource.kind !== "runtime_asset_erasure" ||
        jobSource.runId !== locator.runId || jobSource.companyPurgeOperationId !== input.companyPurgeOperationId ||
        !isRemoteRuntimeAssetLocator(jobSource.remoteAssetLocator, { companyId: locator.companyId, runId: locator.runId }) ||
        remoteRuntimeAssetLocatorDigest(jobSource.remoteAssetLocator as RemoteRuntimeAssetLocator) !== locatorDigest)
        throw conflict("Remote Native asset erasure requires the exact currently claimed MemoryJob");
      await assertRemoteRuntimeAssetErasureReady(tx, locator, input.companyPurgeOperationId);
      const current = await remoteRuntimeAssetDispatchContext(locator, input.companyPurgeOperationId,
        { refreshing: true, attestation: cleanupAttestation });
      if (current.host.id !== source.host.id || current.host.credentialVersion !== source.host.credentialVersion ||
        current.cell.id !== source.cell.id || current.cell.generation !== source.cell.generation ||
        current.binding.id !== source.binding.id || current.policy.id !== source.policy.id ||
        current.lease.id !== source.lease.id)
        throw conflict("Managed remote OpenCode erasure target changed before claim admission");
      const prior = await tx.select().from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, locator.companyId),
        eq(runtimeHostCommands.commandType, "sandbox_exec"),
        sql`${runtimeHostCommands.payload}->>'nativePreparationPurpose' = 'native_provider_data_erasure'`,
      )).for("update");
      const related = prior.filter(command => {
        const payload = command.payload && typeof command.payload === "object" && !Array.isArray(command.payload)
          ? command.payload as Record<string, unknown> : {};
        const erasure = payload.remoteRuntimeAssetErasure && typeof payload.remoteRuntimeAssetErasure === "object" &&
          !Array.isArray(payload.remoteRuntimeAssetErasure) ? payload.remoteRuntimeAssetErasure as Record<string, unknown> : {};
        return erasure.jobKey === input.jobKey || erasure.locatorDigest === locatorDigest;
      });
      if (related.length > 0) {
        const completed = related.find(command => {
          const payload = command.payload && typeof command.payload === "object" && !Array.isArray(command.payload)
            ? command.payload as Record<string, unknown> : {};
          const erasure = payload.remoteRuntimeAssetErasure && typeof payload.remoteRuntimeAssetErasure === "object" &&
            !Array.isArray(payload.remoteRuntimeAssetErasure) ? payload.remoteRuntimeAssetErasure as Record<string, unknown> : {};
          return erasure.idempotencyKey === idempotencyKey && command.status === "SUCCEEDED";
        });
        if (completed) {
          const safeResult = completed.safeResult && typeof completed.safeResult === "object" && !Array.isArray(completed.safeResult)
            ? completed.safeResult as Record<string, unknown> : {};
          const receipt = safeResult.remoteRuntimeAssetRemovalReceipt;
          const resultBinding = safeResult.remoteRuntimeAssetErasure && typeof safeResult.remoteRuntimeAssetErasure === "object" &&
            !Array.isArray(safeResult.remoteRuntimeAssetErasure)
            ? safeResult.remoteRuntimeAssetErasure as Record<string, unknown> : {};
          const completedPayload = completed.payload && typeof completed.payload === "object" && !Array.isArray(completed.payload)
            ? completed.payload as Record<string, unknown> : {};
          const completedErasure = completedPayload.remoteRuntimeAssetErasure && typeof completedPayload.remoteRuntimeAssetErasure === "object" &&
            !Array.isArray(completedPayload.remoteRuntimeAssetErasure)
            ? completedPayload.remoteRuntimeAssetErasure as Record<string, unknown> : {};
      if (!isRemoteRuntimeAssetRemovalReceipt(receipt, locator) || receipt.stopProof.schema !== "paperclip.native-remote-process-stop.v1" || receipt.commandRequestId !== completedPayload.requestId ||
            completedErasure.expectedProcessPid !== receipt.stopProof.pid ||
            completedErasure.expectedProcessStartedAt !== receipt.stopProof.startedAt ||
            resultBinding.locatorDigest !== locatorDigest || resultBinding.jobKey !== input.jobKey ||
            resultBinding.companyPurgeOperationId !== (input.companyPurgeOperationId ?? null) || resultBinding.formatVersion !== 1 ||
            receipt.target.hostId !== current.host.id || receipt.target.cellId !== current.cell.id ||
            receipt.target.cellGeneration !== current.cell.generation.toString() || receipt.target.bindingId !== current.binding.id)
            throw conflict("Completed remote OpenCode erasure has no recoverable exact receipt", {
              code: REMOTE_ASSET_ERASURE_ERRORS.reconciliation,
            });
          const [currentRun] = await tx.select().from(heartbeatRuns).where(and(
            eq(heartbeatRuns.companyId, locator.companyId), eq(heartbeatRuns.id, locator.runId),
          )).for("update");
          if (!currentRun || currentRun.runnerInstanceId !== locator.runnerInstanceId ||
            (currentRun.processPid !== null && (currentRun.processPid !== receipt.stopProof.pid ||
              currentRun.processStartedAt?.toISOString() !== receipt.stopProof.startedAt)) ||
            (currentRun.processPid === null && currentRun.processStartedAt !== null))
            throw conflict("Completed remote OpenCode erasure receipt belongs to a different process generation", {
              code: REMOTE_ASSET_ERASURE_ERRORS.stop,
            });
          if (currentRun.processPid !== null) {
            const [cleared] = await tx.update(heartbeatRuns).set({ processPid: null, processGroupId: null,
              processStartedAt: null, updatedAt: new Date() })
              .where(and(eq(heartbeatRuns.companyId, locator.companyId), eq(heartbeatRuns.id, locator.runId),
                eq(heartbeatRuns.runnerInstanceId, locator.runnerInstanceId), eq(heartbeatRuns.processPid, receipt.stopProof.pid),
                eq(heartbeatRuns.processStartedAt, new Date(receipt.stopProof.startedAt)))).returning({ id: heartbeatRuns.id });
            if (!cleared) throw conflict("Completed remote OpenCode receipt could not clear its exact process generation", {
              code: REMOTE_ASSET_ERASURE_ERRORS.stop,
            });
          }
          return { claim: null, receipt };
        }
        throw conflict("A prior remote OpenCode erasure command requires reconciliation", {
          code: REMOTE_ASSET_ERASURE_ERRORS.reconciliation,
        });
      }
      const [claim] = await tx.insert(runtimeHostCommands).values({
        runtimeHostId: source.host.id, companyId: locator.companyId, runtimeCellId: source.cell.id,
        cellGeneration: source.cell.generation, commandType: "sandbox_exec", idempotencyKey: requestId,
        payload: desiredState, deadlineAt, notBefore: new Date(),
      }).returning();
      return { claim: claim ?? null, receipt: null };
    });
    if (admission.receipt) return admission.receipt;
    const claim = admission.claim;
    if (!claim) throw conflict("Managed remote OpenCode erasure command could not be persisted", {
      code: REMOTE_ASSET_ERASURE_ERRORS.reconciliation,
    });
    const request = {
      requestId, bindingId: source.binding.id, hostEpoch: source.host.credentialVersion,
      runId: source.run.id, attemptId: null, attempt,
      manifestId: source.manifest.id, manifestHash: source.manifest.hash,
      policySnapshotId: source.policy.id, policyHash: source.policy.policyHash,
      commandDigest, deadlineAt: deadlineAt.toISOString(),
      sandboxRef: source.binding.sandboxRef ?? `aw-v7-${source.binding.id}`,
      imageDigest: source.cell.activeImageDigest ?? source.cell.desiredImageDigest,
      argv: command, cwd: source.remoteCwd, env, stdinBase64: "",
    };
    const capabilityToken = createSandboxExecJwt({
      agentId: source.run.agentId!, companyId: locator.companyId, adapterType: source.agent.adapterType,
      runId: source.run.id, responsibleUserId: source.run.responsibleUserId,
      claim: { requestId, bindingId: source.binding.id, cellId: source.cell.id,
        generation: source.cell.generation.toString(), hostId: source.host.id,
        hostEpoch: source.host.credentialVersion, runId: source.run.id, attemptId: null, attempt,
        manifestId: source.manifest.id, manifestHash: source.manifest.hash,
        policySnapshotId: source.policy.id, policyHash: source.policy.policyHash,
        commandDigest, deadlineAt: deadlineAt.toISOString() },
      parentExpiresAt: deadlineAt, nativeLeaseExpiresAt: deadlineAt,
    });
    if (!capabilityToken) {
      await db.update(runtimeHostCommands).set({ status: "FAILED", errorCode: "exec_capability_unavailable", completedAt: new Date() })
        .where(and(eq(runtimeHostCommands.id, claim.id), eq(runtimeHostCommands.status, "PENDING")));
      throw conflict("Managed remote OpenCode erasure capability could not be issued", {
        code: REMOTE_ASSET_ERASURE_ERRORS.relay, upstreamStatus: null,
      });
    }
    const output: Buffer[] = [];
    let outputSize = 0;
    try {
      let result: { exitCode: number; timedOut: boolean };
      try {
        result = await relay.executeOpenShell({ cellId: source.cell.id,
          generation: source.cell.generation.toString(), request, capabilityToken,
          onOutput: async (stream, chunk) => {
            if (stream !== "stdout") return;
            outputSize += chunk.length;
            if (outputSize > 4096) throw conflict("Managed remote OpenCode erasure receipt exceeded its bound", {
              code: REMOTE_ASSET_ERASURE_ERRORS.result,
            });
            output.push(chunk);
          },
        });
      } catch (error) {
        const upstreamStatus = error && typeof error === "object" && "status" in error &&
          typeof error.status === "number" && [400, 401, 403, 404, 409, 429, 500, 502, 503, 504].includes(error.status)
          ? error.status : null;
        const details = { code: REMOTE_ASSET_ERASURE_ERRORS.relay, upstreamStatus };
        if (error instanceof HttpError) throw new HttpError(error.status, "Managed remote OpenCode erasure relay failed", details);
        throw conflict("Managed remote OpenCode erasure relay failed", details);
      }
      const lines = Buffer.concat(output).toString("utf8").trimEnd().split("\n");
      const [rawPid, startedAt, processIdentityDigest, processStartFingerprintDigest, stoppedAt] = lines;
      const pid = Number(rawPid);
      const resultFacts = {
        exitCode: Number.isSafeInteger(result.exitCode) && result.exitCode >= -1 && result.exitCode <= 255 ? result.exitCode : null,
        timedOut: result.timedOut === true,
        stdoutBytes: outputSize,
        stdoutLineCount: lines.length,
        runIdMatches: lines.length === 7 && lines[5] === locator.runId,
        providerLeaseIdMatches: lines.length === 7 && lines[6] === locator.providerLeaseId,
        pidMatches: Number.isSafeInteger(pid) && pid > 1 && pid === expectedProcessPid,
        startedAtMatches: Boolean(startedAt && startedAt === expectedProcessStartedAt && !Number.isNaN(Date.parse(startedAt))),
        stoppedAtValid: Boolean(stoppedAt && !Number.isNaN(Date.parse(stoppedAt))),
        processIdentityDigestValid: /^[a-f0-9]{64}$/.test(processIdentityDigest ?? ""),
        processStartFingerprintDigestValid: /^[a-f0-9]{64}$/.test(processStartFingerprintDigest ?? ""),
      };
      if (result.exitCode !== 0 || result.timedOut || lines.length !== 7 || !resultFacts.runIdMatches ||
        !resultFacts.providerLeaseIdMatches || !resultFacts.pidMatches || !resultFacts.startedAtMatches ||
        !resultFacts.stoppedAtValid || !resultFacts.processIdentityDigestValid || !resultFacts.processStartFingerprintDigestValid)
        throw conflict("Managed remote OpenCode erasure did not return an exact stop and absence proof", {
          code: REMOTE_ASSET_ERASURE_ERRORS.result, ...resultFacts,
        });
      const finalSource = await remoteRuntimeAssetDispatchContext(locator, input.companyPurgeOperationId,
        { refreshing: true, attestation: cleanupAttestation });
      if (finalSource.host.id !== source.host.id || finalSource.host.credentialVersion !== source.host.credentialVersion ||
        finalSource.cell.id !== source.cell.id || finalSource.cell.generation !== source.cell.generation ||
        finalSource.binding.id !== source.binding.id || finalSource.lease.id !== source.lease.id)
        throw conflict("Managed remote OpenCode erasure target changed before receipt persistence", {
          code: REMOTE_ASSET_ERASURE_ERRORS.target, failedChecks: ["target_changed_before_receipt"],
        });
      const receipt: RemoteRuntimeAssetRemovalReceipt = {
        schema: "paperclip.remote-runtime-asset-removal.v1",
        locatorDigest: remoteRuntimeAssetLocatorDigest(locator), commandRequestId: requestId,
        purpose: "native_provider_data_erasure",
        target: { hostId: source.host.id, cellId: source.cell.id,
          cellGeneration: source.cell.generation.toString(), bindingId: source.binding.id },
        relativePath: locator.relativePath, pathDigest: locator.pathDigest,
        stopProof: { schema: "paperclip.native-remote-process-stop.v1", runId: locator.runId,
          normalizedSessionIdDigest: locator.normalizedSessionIdDigest,
          runnerInstanceId: locator.runnerInstanceId, environmentLeaseId: locator.environmentLeaseId,
          providerLeaseId: locator.providerLeaseId, pid, startedAt,
          processIdentityDigest: processIdentityDigest!, processStartFingerprintDigest: processStartFingerprintDigest!, stoppedAt },
        stopProofBeforeDelete: true, exitCode: 0, timedOut: false, postDeleteAbsent: true,
      };
      await db.transaction(async transaction => {
        const tx = transaction as unknown as Db;
        await lockAnalyticalCompany(tx, locator.companyId);
        await lockMemoryPrivacy(tx, locator.companyId);
        const [currentJob] = await tx.select().from(memoryJobs).where(and(
          eq(memoryJobs.companyId, locator.companyId), eq(memoryJobs.id, input.jobId),
          eq(memoryJobs.jobKey, input.jobKey), eq(memoryJobs.status, "running"),
          gt(memoryJobs.leaseExpiresAt, new Date()),
        )).for("update");
        const currentJobSource = currentJob?.sourceRefJson && typeof currentJob.sourceRefJson === "object" &&
          !Array.isArray(currentJob.sourceRefJson) ? currentJob.sourceRefJson as Record<string, unknown> : {};
        if (!currentJob || currentJob.operationType !== "retention" || currentJobSource.kind !== "runtime_asset_erasure" ||
          currentJob.attemptNumber !== cleanupAttestation.attemptNumber ||
          currentJob.executionOwnerId !== cleanupAttestation.executionOwnerId ||
          currentJobSource.runId !== locator.runId || currentJobSource.companyPurgeOperationId !== input.companyPurgeOperationId ||
          !isRemoteRuntimeAssetLocator(currentJobSource.remoteAssetLocator, { companyId: locator.companyId, runId: locator.runId }) ||
          remoteRuntimeAssetLocatorDigest(currentJobSource.remoteAssetLocator as RemoteRuntimeAssetLocator) !== locatorDigest)
          throw conflict("Remote Native asset erasure lost its current MemoryJob before receipt commit");
        const [currentRun] = await tx.select().from(heartbeatRuns).where(and(
          eq(heartbeatRuns.companyId, locator.companyId), eq(heartbeatRuns.id, locator.runId),
        )).for("update");
        const [currentLocator] = currentRun ? [await readRemoteRuntimeAssetLocator(tx, currentRun)] : [];
        if (!currentRun || !currentLocator || remoteRuntimeAssetLocatorDigest(currentLocator) !== locatorDigest ||
          currentRun.runnerInstanceId !== locator.runnerInstanceId ||
          currentRun.processPid !== pid || currentRun.processStartedAt?.toISOString() !== startedAt ||
          currentRun.processGroupId !== null || currentRun.controllerLeaseExpiresAt !== null ||
          !["succeeded", "interrupted", "failed", "cancelled", "timed_out"].includes(currentRun.status))
          throw conflict("Managed remote OpenCode process generation changed before stop receipt commit");
        const [completed] = await tx.update(runtimeHostCommands).set({ status: "SUCCEEDED", completedAt: new Date(),
          safeResult: { exitCode: 0, timedOut: false, postDeleteAbsent: true,
            remoteRuntimeAssetRemovalReceipt: receipt,
            remoteRuntimeAssetErasure: { locatorDigest, jobKey: input.jobKey,
              companyPurgeOperationId: input.companyPurgeOperationId ?? null, formatVersion: 1,
              cleanupAttestation } } }).where(and(
          eq(runtimeHostCommands.id, claim.id), eq(runtimeHostCommands.status, "CLAIMED"),
        )).returning({ id: runtimeHostCommands.id });
        if (!completed) throw conflict("Managed remote OpenCode erasure command was fenced");
        const [cleared] = await tx.update(heartbeatRuns).set({ processPid: null, processGroupId: null,
          processStartedAt: null, updatedAt: new Date() })
          .where(and(eq(heartbeatRuns.companyId, locator.companyId), eq(heartbeatRuns.id, locator.runId),
            eq(heartbeatRuns.runnerInstanceId, locator.runnerInstanceId), eq(heartbeatRuns.processPid, pid),
            eq(heartbeatRuns.processStartedAt, new Date(startedAt)))).returning({ id: heartbeatRuns.id });
        if (!cleared) throw conflict("Managed remote OpenCode process stop receipt could not clear its exact generation");
      });
      return receipt;
    } catch (error) {
      await db.update(runtimeHostCommands).set({ status: "EXPIRED", errorCode: "remote_asset_erasure_unknown", completedAt: new Date() })
        .where(and(eq(runtimeHostCommands.id, claim.id), inArray(runtimeHostCommands.status, ["PENDING", "CLAIMED"])));
      throw error;
    }
  }
  async function authorizeSandboxExec(input: { cellId: string; generation: string; request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest; capabilityToken: string }) {
    const claims = verifySandboxExecJwt(input.capabilityToken);
    const capability = claims?.sandbox_exec, request = input.request, now = new Date();
    if (!claims || !capability || claims.sub === "" || claims.company_id === "" ||
      capability.requestId !== request.requestId || capability.bindingId !== request.bindingId ||
      capability.cellId !== input.cellId || capability.generation !== input.generation ||
      capability.hostEpoch !== request.hostEpoch || capability.runId !== request.runId ||
      capability.attemptId !== request.attemptId || capability.attempt !== request.attempt ||
      capability.manifestId !== request.manifestId || capability.manifestHash !== request.manifestHash ||
      capability.policySnapshotId !== request.policySnapshotId || capability.policyHash !== request.policyHash ||
      capability.commandDigest !== request.commandDigest || capability.deadlineAt !== request.deadlineAt ||
      claims.run_id !== request.runId || claims.jti !== request.requestId)
      throw forbidden("Sandbox execution capability scope mismatch");
    return db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      // Source readers and erasers share these company-scoped advisory locks.
      // Acquire them before pinning the host command / Run rows, then perform
      // the final exact source-owner check below in this same transaction.
      await lockAnalyticalCompany(tx, claims.company_id);
      await lockMemoryPrivacy(tx, claims.company_id);
      const [operation] = await tx.select().from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, claims.company_id), eq(runtimeHostCommands.runtimeCellId, input.cellId),
        eq(runtimeHostCommands.cellGeneration, BigInt(input.generation)),
        eq(runtimeHostCommands.commandType, "sandbox_exec"), eq(runtimeHostCommands.status, "PENDING"),
        eq(runtimeHostCommands.attempt, 0), gt(runtimeHostCommands.deadlineAt, now),
        eq(runtimeHostCommands.idempotencyKey, request.requestId),
      )).for("update");
      const expected = operation?.payload as Record<string, unknown> | undefined;
      if (!operation || expected?.bindingId !== request.bindingId || expected.generation !== input.generation ||
        expected.hostId !== capability.hostId || expected.hostEpoch !== request.hostEpoch ||
        expected.runId !== request.runId || expected.attemptId !== request.attemptId || expected.attempt !== request.attempt ||
        expected.manifestId !== request.manifestId || expected.manifestHash !== request.manifestHash ||
        expected.policySnapshotId !== request.policySnapshotId || expected.policyHash !== request.policyHash ||
        expected.commandDigest !== request.commandDigest || expected.deadlineAt !== request.deadlineAt ||
        nativeSha256(expected.modelBrokerSession ?? null) !== nativeSha256(request.modelBrokerSession ?? null))
        throw forbidden("Sandbox execution claim is missing, expired, or already consumed");
      if (expected.nativePreparationPurpose === "native_provider_data_erasure") {
        const rawErasure = expected.remoteRuntimeAssetErasure && typeof expected.remoteRuntimeAssetErasure === "object" &&
          !Array.isArray(expected.remoteRuntimeAssetErasure) ? expected.remoteRuntimeAssetErasure as Record<string, unknown> : null;
        const locator = rawErasure?.locator;
        const companyPurgeOperationId = typeof rawErasure?.companyPurgeOperationId === "string"
          ? rawErasure.companyPurgeOperationId : undefined;
        const cleanupAttestation = readCleanupAttestation(rawErasure?.cleanupAttestation);
        if (!rawErasure || !isRemoteRuntimeAssetLocator(locator, { companyId: claims.company_id, runId: request.runId }) ||
          rawErasure?.locatorDigest !== remoteRuntimeAssetLocatorDigest(locator as RemoteRuntimeAssetLocator) ||
          locator.environmentLeaseId !== expected.leaseId || locator.runId !== request.runId ||
          locator.companyId !== claims.company_id || !cleanupAttestation ||
          rawErasure.jobId !== cleanupAttestation.jobId || rawErasure.jobKey !== cleanupAttestation.jobKey ||
          cleanupAttestation.companyPurgeOperationId !== (companyPurgeOperationId ?? null))
          throw forbidden("Sandbox remote asset erasure authority is malformed");
        const [claimedJob] = await tx.select().from(memoryJobs).where(and(
          eq(memoryJobs.companyId, claims.company_id), eq(memoryJobs.id, cleanupAttestation.jobId),
          eq(memoryJobs.jobKey, cleanupAttestation.jobKey), eq(memoryJobs.attemptNumber, cleanupAttestation.attemptNumber),
          eq(memoryJobs.executionOwnerId, cleanupAttestation.executionOwnerId), eq(memoryJobs.status, "running"),
          gt(memoryJobs.leaseExpiresAt, now),
        )).limit(1).for("share");
        const claimedJobSource = claimedJob?.sourceRefJson && typeof claimedJob.sourceRefJson === "object" &&
          !Array.isArray(claimedJob.sourceRefJson) ? claimedJob.sourceRefJson as Record<string, unknown> : {};
        if (!claimedJob || claimedJob.operationType !== "retention" || claimedJobSource.kind !== "runtime_asset_erasure" ||
          claimedJobSource.runId !== request.runId ||
          (claimedJobSource.companyPurgeOperationId ?? null) !== (companyPurgeOperationId ?? null) ||
          !isRemoteRuntimeAssetLocator(claimedJobSource.remoteAssetLocator, locator as RemoteRuntimeAssetLocator))
          throw forbidden("Sandbox remote asset erasure MemoryJob claim changed before host dispatch");
        await assertRemoteRuntimeAssetErasureReady(tx, locator as RemoteRuntimeAssetLocator, companyPurgeOperationId);
        const current = await remoteRuntimeAssetDispatchContext(locator as RemoteRuntimeAssetLocator, companyPurgeOperationId,
          { refreshing: true, attestation: cleanupAttestation });
        const [agent] = current.run.agentId ? await tx.select().from(agents).where(and(
          eq(agents.companyId, claims.company_id), eq(agents.id, current.run.agentId),
        )) : [];
        if (!agent || claims.sub !== current.run.agentId || claims.responsible_user_id !== current.run.responsibleUserId ||
          claims.adapter_type !== agent.adapterType || current.binding.id !== request.bindingId ||
          current.cell.id !== input.cellId || current.cell.generation.toString() !== input.generation ||
          current.host.id !== capability.hostId || current.host.credentialVersion !== request.hostEpoch ||
          current.manifest.id !== request.manifestId || current.manifest.hash !== request.manifestHash ||
          current.policy.id !== request.policySnapshotId || current.policy.policyHash !== request.policyHash ||
          expected.hostId !== current.host.id || expected.hostEpoch !== request.hostEpoch ||
          expected.manifestId !== current.manifest.id || expected.manifestHash !== current.manifest.hash ||
          expected.policySnapshotId !== current.policy.id || expected.policyHash !== current.policy.policyHash ||
          rawErasure.expectedProcessPid !== current.run.processPid ||
          rawErasure.expectedProcessStartedAt !== current.run.processStartedAt?.toISOString() ||
          !exactNativeRuntimeAssetErasureCommand({ request, locator: locator as RemoteRuntimeAssetLocator,
            remoteCwd: current.remoteCwd, expectedProcessPid: current.run.processPid ?? -1,
            expectedProcessStartedAt: current.run.processStartedAt?.toISOString() ?? "" }))
          throw forbidden("Sandbox remote asset erasure target changed before dispatch");
        const [consumed] = await tx.update(runtimeHostCommands).set({ status: "CLAIMED", attempt: 1 }).where(and(
          eq(runtimeHostCommands.id, operation.id), eq(runtimeHostCommands.status, "PENDING"),
          eq(runtimeHostCommands.attempt, 0),
        )).returning({ id: runtimeHostCommands.id });
        if (!consumed) throw forbidden("Sandbox remote asset erasure capability was already consumed");
        return { runtimeHostId: current.host.id, companyId: claims.company_id,
          generation: current.cell.generation.toString() };
      }
      const source = await executionSandboxService(tx, { runtimeSuspectSeconds: config.runtime.suspectSeconds }).assertTaskExecutionContext(tx, {
        companyId: claims.company_id, runId: request.runId, leaseId: String(expected.leaseId), now,
      });
      if (!source || source.run.agentId !== claims.sub || source.source.agent.adapterType !== claims.adapter_type || source.run.responsibleUserId !== claims.responsible_user_id ||
        source.sandboxBinding.id !== request.bindingId || source.cell.id !== input.cellId ||
        source.cell.generation.toString() !== input.generation || source.host.id !== capability.hostId ||
        source.host.credentialVersion !== request.hostEpoch || source.manifest.id !== request.manifestId ||
        source.manifest.hash !== request.manifestHash || source.policy.id !== request.policySnapshotId ||
        source.policy.policyHash !== request.policyHash || source.deadlineAt.toISOString() < request.deadlineAt)
        throw forbidden("Sandbox execution source changed before host dispatch");
      if (!sandboxExecutionCwdAllowed(request.cwd, source.policy.compilation.compiledPolicy.filesystem))
        throw forbidden("Sandbox execution workspace is outside its current filesystem policy", { code: "sandbox_execution_cwd_outside_policy" });
      const sessionDescriptor = request.modelBrokerSession;
      if (sessionDescriptor) {
        const profile = source.run.runnerProfileJson && typeof source.run.runnerProfileJson === "object" &&
          !Array.isArray(source.run.runnerProfileJson) ? source.run.runnerProfileJson as Record<string, unknown> : {};
        let sessionExecution: ReturnType<typeof parseNativeExecutionInput> | null = null;
        try { sessionExecution = parseNativeExecutionInput(profile.nativeExecutionInput); } catch { /* invalid below */ }
        const nativeSessionId = source.run.nativeSessionId;
        const runnerInstanceId = source.run.runnerInstanceId;
        const sessionKey = nativeSha256({ companyId: claims.company_id, runId: source.run.id,
          attemptId: source.attempt?.id ?? null, attempt: request.attempt,
          nativeSessionIdDigest: sha256(nativeSessionId ?? ""), runnerInstanceId,
          leaseId: source.lease.id, bindingId: source.sandboxBinding.id, cellId: source.cell.id,
          generation: source.cell.generation.toString(), hostEpoch: source.host.credentialVersion,
          manifestId: source.manifest.id, manifestHash: source.manifest.hash,
          policySnapshotId: source.policy.id, policyHash: source.policy.policyHash });
        const currentCeiling = new Date(Math.min(source.deadlineAt.getTime(),
          (source.run.executionControlDeadlineAt ?? source.deadlineAt).getTime(), source.lease.expiresAt?.getTime() ?? 0));
        const exactRunSession = source.run.status === "running" && source.run.runtimeMode === "native" && nativeSessionId &&
          runnerInstanceId && sessionExecution?.provider.kind === "opencode" && sessionExecution.session.driverKind === "opencode_server" &&
          sessionExecution.session.normalizedSessionId === nativeSessionId && sessionExecution.binding.companyId === claims.company_id &&
          sessionExecution.binding.runId === source.run.id && sessionExecution.binding.agentId === source.run.agentId &&
          resolvePaperclipRunnerProviderProfile(source.source.agent.adapterConfig)?.provider === "opencode" &&
          sessionDescriptor.sessionKey === sessionKey && sessionDescriptor.nativeSessionIdDigest === sha256(nativeSessionId) &&
          sessionDescriptor.runnerInstanceId === runnerInstanceId && sessionDescriptor.leaseId === source.lease.id;
        let originalSession: Record<string, unknown> | null = null;
        if (exactRunSession && sessionDescriptor.phase !== "start") {
          const [start] = await tx.select({ payload: runtimeHostCommands.payload }).from(runtimeHostCommands).where(and(
            eq(runtimeHostCommands.companyId, claims.company_id), eq(runtimeHostCommands.runtimeCellId, source.cell.id),
            eq(runtimeHostCommands.cellGeneration, source.cell.generation), eq(runtimeHostCommands.commandType, "sandbox_exec"),
            eq(runtimeHostCommands.status, "SUCCEEDED"),
            sql`${runtimeHostCommands.payload}->'modelBrokerSession'->>'sessionKey' = ${sessionDescriptor.sessionKey}`,
            sql`${runtimeHostCommands.payload}->'modelBrokerSession'->>'phase' = 'start'`)).orderBy(runtimeHostCommands.createdAt).limit(1).for("update");
          const payload = start?.payload && typeof start.payload === "object" && !Array.isArray(start.payload)
            ? start.payload as Record<string, unknown> : null;
          originalSession = payload?.modelBrokerSession && typeof payload.modelBrokerSession === "object" &&
            !Array.isArray(payload.modelBrokerSession) ? payload.modelBrokerSession as Record<string, unknown> : null;
        }
        const descriptorShape = exactRunSession && (sessionDescriptor.phase === "start"
          ? sessionDescriptor.sessionDeadlineAt === currentCeiling.toISOString() && sessionDescriptor.expectedCapabilityHash === undefined
          : originalSession?.sessionDeadlineAt === sessionDescriptor.sessionDeadlineAt &&
            Date.parse(sessionDescriptor.sessionDeadlineAt) <= currentCeiling.getTime());
        const leaseMetadata = source.lease.metadata && typeof source.lease.metadata === "object" && !Array.isArray(source.lease.metadata)
          ? source.lease.metadata as Record<string, unknown> : {};
        const sessionCwd = typeof leaseMetadata.remoteCwd === "string" ? leaseMetadata.remoteCwd.trim() : "";
        const exactSessionCommand = sessionExecution && (sessionDescriptor.phase === "start"
          ? !!sessionCwd && path.resolve(request.cwd) === path.resolve(sessionCwd) &&
            exactNativeSessionLaunchCommand({ request, taskRoot: sessionCwd, execution: sessionExecution })
          : !!sessionCwd && path.resolve(request.cwd) === path.resolve(sessionCwd) &&
            exactNativeRunnerMonitorStatusCommand({ request, taskRoot: sessionCwd, execution: sessionExecution, runId: source.run.id }));
        if (!descriptorShape || !exactSessionCommand ||
          (sessionDescriptor.phase !== "start" && !/^[a-f0-9]{64}$/.test(sessionDescriptor.expectedCapabilityHash ?? "")))
          throw forbidden("Managed model provider session is outside its exact current Native runner lifecycle");
        if (sessionDescriptor.phase === "start") {
          const [prior] = await tx.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands).where(and(
            eq(runtimeHostCommands.companyId, claims.company_id), eq(runtimeHostCommands.runtimeCellId, source.cell.id),
            eq(runtimeHostCommands.cellGeneration, source.cell.generation), eq(runtimeHostCommands.commandType, "sandbox_exec"),
            sql`${runtimeHostCommands.payload}->'modelBrokerSession'->>'sessionKey' = ${sessionDescriptor.sessionKey}`,
            sql`${runtimeHostCommands.payload}->>'requestId' IS DISTINCT FROM ${claims.jti}`)).limit(1).for("update");
          if (prior) throw forbidden("Managed model provider session start cannot be replayed");
        } else {
          const [latest] = await tx.select({ safeResult: runtimeHostCommands.safeResult, payload: runtimeHostCommands.payload })
            .from(runtimeHostCommands).where(and(eq(runtimeHostCommands.companyId, claims.company_id),
              eq(runtimeHostCommands.runtimeCellId, source.cell.id), eq(runtimeHostCommands.cellGeneration, source.cell.generation),
              eq(runtimeHostCommands.commandType, "sandbox_exec"), eq(runtimeHostCommands.status, "SUCCEEDED"),
              sql`${runtimeHostCommands.payload}->'modelBrokerSession'->>'sessionKey' = ${sessionDescriptor.sessionKey}`))
            .orderBy(desc(runtimeHostCommands.createdAt)).limit(1).for("update");
          const safe = latest?.safeResult && typeof latest.safeResult === "object" && !Array.isArray(latest.safeResult)
            ? latest.safeResult as Record<string, unknown> : null;
          const receipt = runtimeModelBrokerSessionReceiptSchema.safeParse(safe?.modelBrokerSessionReceipt);
          const latestPayload = latest?.payload && typeof latest.payload === "object" && !Array.isArray(latest.payload)
            ? latest.payload as Record<string, unknown> : null;
          const latestSession = latestPayload?.modelBrokerSession && typeof latestPayload.modelBrokerSession === "object" &&
            !Array.isArray(latestPayload.modelBrokerSession) ? latestPayload.modelBrokerSession as Record<string, unknown> : null;
          if (!receipt.success || receipt.data.capabilityHash !== sessionDescriptor.expectedCapabilityHash ||
            latestSession?.phase === "stop" || !latestSession || latestSession.sessionDeadlineAt !== sessionDescriptor.sessionDeadlineAt)
            throw forbidden("Managed model provider session receipt changed before refresh or stop");
        }
      }
      const credentials = source.policy.compilation.compiledPolicy.credentials;
      const brokerCredential = request.brokerCredential;
      const nativePreparationPurpose = expected.nativePreparationPurpose;
      if (nativePreparationPurpose !== undefined && nativePreparationPurpose !== "provider_artifact" &&
        nativePreparationPurpose !== "native_session_start" && nativePreparationPurpose !== "native_harness_state" &&
        nativePreparationPurpose !== "native_workspace_prepare" &&
        nativePreparationPurpose !== "native_runtime_context_prepare" &&
        nativePreparationPurpose !== "native_provider_data_erasure_probe" &&
        nativePreparationPurpose !== NATIVE_ATTACHMENT_STAGE_PREPARATION_PURPOSE &&
        nativePreparationPurpose !== NATIVE_ATTACHMENT_CLEANUP_PREPARATION_PURPOSE)
        throw forbidden("Sandbox preparation purpose is unsupported");
      const providerArtifactPreparation = nativePreparationPurpose === "provider_artifact";
      const nativeSessionStart = nativePreparationPurpose === "native_session_start";
      const nativeHarnessState = nativePreparationPurpose === "native_harness_state";
      const nativeWorkspacePrepare = nativePreparationPurpose === "native_workspace_prepare";
      const nativeRuntimeContextPrepare = nativePreparationPurpose === "native_runtime_context_prepare";
      const nativeRuntimeAssetErasureProbe = nativePreparationPurpose === "native_provider_data_erasure_probe";
      const nativeAttachmentStage = nativePreparationPurpose === NATIVE_ATTACHMENT_STAGE_PREPARATION_PURPOSE;
      const nativeAttachmentCleanup = nativePreparationPurpose === NATIVE_ATTACHMENT_CLEANUP_PREPARATION_PURPOSE;
      const sessionModelRefresh = nativeHarnessState && request.modelBrokerSession?.phase === "refresh" &&
        request.modelBrokerCredential !== undefined;
      let nativeSessionStartValid = false;
      let nativeHarnessStateValid = false;
      const workerPreparationRoot = source.providerConformanceBootstrap ? null :
        await currentWorkerNativePreparationRoot(tx, source, nativePreparationPurpose);
      const conformanceWorkspaceRoot = await currentConformanceNativeWorkspaceRoot(source, nativePreparationPurpose);
      if (conformanceWorkspaceRoot !== null) {
        const profile = source.run.runnerProfileJson as Record<string, unknown>;
        const execution = parseNativeExecutionInput(profile.nativeExecutionInput);
        const sourceAuthority = profile.nativeOpenCodeSourceAuthority && typeof profile.nativeOpenCodeSourceAuthority === "object" &&
          !Array.isArray(profile.nativeOpenCodeSourceAuthority) ? profile.nativeOpenCodeSourceAuthority as Record<string, unknown> : {};
        const forbiddenEnvironmentKeys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN",
          "GITHUB_ENTERPRISE_TOKEN", "PAPERCLIP_GITHUB_BROKER_TOKEN", "PAPERCLIP_GITHUB_BROKER_URL", "PAPERCLIP_SANDBOX_BROKER_TOKEN",
          "PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN", "PAPERCLIP_SANDBOX_BROKER_SESSION_ID"];
        const managedModelEnvironmentKeys = Object.keys(request.env ?? {}).filter(key => key.startsWith("PAPERCLIP_MANAGED_MODEL_"));
        const allowedManagedModelEnvironmentKeys = new Set(["PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN",
          "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND", "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS"]);
        const noManagedModelEnvironment = managedModelEnvironmentKeys.length === 0;
        const onlyExactManagedModelEnvironment = managedModelEnvironmentKeys.every(key => allowedManagedModelEnvironmentKeys.has(key));
        const noWorkloadCredential = credentials.mode === "none" && credentials.bindings.length === 0 &&
          request.brokerCredential === undefined && !Object.keys(request.env ?? {}).some(key => forbiddenEnvironmentKeys.includes(key));
        const exactWorkspace = nativeWorkspacePrepare && request.modelBrokerCredential === undefined &&
          request.modelBrokerSession === undefined && noWorkloadCredential && noManagedModelEnvironment &&
          exactNativeWorkspacePrepareCommand({ request, taskRoot: conformanceWorkspaceRoot, execution,
            expectedProviderLeaseId: source.lease.providerLeaseId ?? undefined });
        const exactArtifact = providerArtifactPreparation && request.modelBrokerCredential === undefined &&
          request.modelBrokerSession === undefined && noWorkloadCredential && noManagedModelEnvironment &&
          (exactNativeProviderArtifactChunkCommand({ request, taskRoot: conformanceWorkspaceRoot }) ||
            exactNativeManagedArtifactCommand({ request, taskRoot: conformanceWorkspaceRoot,
              authority: sourceAuthority.artifactAuthority }));
        const sessionId = execution.session.normalizedSessionId ?? `session-${source.run.id}`;
        const sessionDigest = sha256(sessionId);
        const exactErasureProbe = nativeRuntimeAssetErasureProbe && request.modelBrokerCredential === undefined &&
          request.modelBrokerSession === undefined && credentials.mode === "none" && credentials.bindings.length === 0 &&
          request.brokerCredential === undefined && exactNativeRuntimeAssetErasureProbeCommand({ request,
            taskRoot: conformanceWorkspaceRoot, runId: source.run.id, sessionDigest });
        const exactHarness = nativeHarnessState && (request.modelBrokerSession === undefined || request.modelBrokerSession.phase === "stop") &&
          noWorkloadCredential && noManagedModelEnvironment && request.modelBrokerCredential === undefined &&
          exactNativeHarnessStateCommand({ request, taskRoot: conformanceWorkspaceRoot, execution, runId: source.run.id });
        let exactRemoteStartBinding = false;
        if (nativeSessionStart) {
          const locator = await readRemoteRuntimeAssetLocator(tx, source.run);
          const saved = expected.remoteNativeSessionStartBinding && typeof expected.remoteNativeSessionStartBinding === "object" &&
            !Array.isArray(expected.remoteNativeSessionStartBinding) ? expected.remoteNativeSessionStartBinding as Record<string, unknown> : null;
          if (locator && locator.environmentLeaseId === source.lease.id && locator.environmentId === source.lease.environmentId &&
              locator.provider === source.lease.provider && locator.providerLeaseId === source.lease.providerLeaseId &&
              locator.runnerInstanceId === source.run.runnerInstanceId) {
            const currentBinding = {
              schema: "paperclip.remote-native-session-start-binding.v1",
              locatorDigest: remoteRuntimeAssetLocatorDigest(locator), runnerInstanceId: locator.runnerInstanceId,
              environmentLeaseId: locator.environmentLeaseId, provider: locator.provider, providerLeaseId: locator.providerLeaseId,
              normalizedSessionIdDigest: locator.normalizedSessionIdDigest, hostId: source.host.id,
              hostEpoch: source.host.credentialVersion, cellId: source.cell.id, cellGeneration: source.cell.generation.toString(),
              bindingId: source.sandboxBinding.id, manifestId: source.manifest.id, manifestHash: source.manifest.hash,
              policySnapshotId: source.policy.id, policyHash: source.policy.policyHash,
            };
            exactRemoteStartBinding = !!saved && nativeSha256(saved) === nativeSha256(currentBinding);
          }
        }
        const exactSessionStart = nativeSessionStart && noWorkloadCredential && request.modelBrokerSession?.phase === "start" &&
          onlyExactManagedModelEnvironment &&
          request.modelBrokerCredential !== undefined && request.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN === managedModelBrokerOrigin &&
          Number.isSafeInteger(request.modelBrokerCredential.inputTokensUpperBound) &&
          Number.isSafeInteger(request.modelBrokerCredential.maxOutputTokens) &&
          request.env.PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND === String(request.modelBrokerCredential.inputTokensUpperBound) &&
          request.env.PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS === String(request.modelBrokerCredential.maxOutputTokens) &&
          exactRemoteStartBinding && exactNativeSessionLaunchCommand({ request, taskRoot: conformanceWorkspaceRoot, execution });
        if (!exactWorkspace && !exactArtifact && !exactErasureProbe && !exactHarness && !exactSessionStart)
          throw forbidden("Conformance preparation requires the exact current group workspace, credential scope, and Native command");
        if (exactSessionStart) nativeSessionStartValid = true;
        if (exactHarness) nativeHarnessStateValid = true;
      } else if (workerPreparationRoot !== null) {
        const profile = source.run.runnerProfileJson as Record<string, unknown>;
        const execution = parseNativeExecutionInput(profile.nativeExecutionInput);
        const noCredentialEnvironment = !Object.keys(request.env ?? {}).some(key => ["ANTHROPIC_API_KEY", "OPENAI_API_KEY",
          "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN",
          "PAPERCLIP_GITHUB_BROKER_TOKEN", "PAPERCLIP_GITHUB_BROKER_URL",
          "PAPERCLIP_SANDBOX_BROKER_TOKEN", "PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN", "PAPERCLIP_SANDBOX_BROKER_SESSION_ID",
          "PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN", "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND",
          "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS"].includes(key));
        const attachmentOperation = nativeAttachmentStage || nativeAttachmentCleanup
          ? parseNativeRemoteAttachmentStageCommand(request, workerPreparationRoot) : null;
        let attachmentOwner: Awaited<ReturnType<typeof captureNativeRemoteAttachmentStageOwner>> | null = null;
        if (attachmentOperation?.phase === "readback") {
          attachmentOwner = await captureNativeRemoteAttachmentReadbackOwner(tx as unknown as Db, {
            companyId: source.run.companyId, issueId: source.source.task.id, runId: source.run.id,
            agentId: source.run.agentId!, taskRoot: workerPreparationRoot, leaseId: source.lease.id,
            operation: attachmentOperation,
          });
        } else if (attachmentOperation) {
          attachmentOwner = await captureNativeRemoteAttachmentStageOwner(tx as unknown as Db, { companyId: source.run.companyId,
            issueId: source.source.task.id, runId: source.run.id, agentId: source.run.agentId!,
            taskRoot: workerPreparationRoot, leaseId: source.lease.id,
            requirePersistedStageIntent: attachmentOperation.phase !== "cleanup", operation: attachmentOperation });
        }
        const exactCommand = nativeAttachmentStage || nativeAttachmentCleanup
          ? !!attachmentOperation && !!attachmentOwner &&
            ((nativeAttachmentCleanup && attachmentOperation.phase === "cleanup") ||
              (nativeAttachmentStage && attachmentOperation.phase !== "cleanup"))
          : nativeWorkspacePrepare
          ? exactNativeWorkspacePrepareCommand({ request, taskRoot: workerPreparationRoot, execution,
            expectedProviderLeaseId: source.lease.providerLeaseId ?? undefined })
          : nativeRuntimeContextPrepare
            ? exactNativeRuntimeContextPreparationOwner({ request, taskRoot: workerPreparationRoot, execution,
              companyId: source.run.companyId, runId: source.run.id, agentId: source.run.agentId!,
              responsibleUserId: source.run.responsibleUserId!, manifest: { runId: source.manifest.runId,
                agentId: source.manifest.agentId, responsibleUserId: source.run.responsibleUserId! },
              nativeExecutionInput: profile.nativeExecutionInput, sourceAuthority: profile.nativeOpenCodeSourceAuthority,
              credentialMode: credentials.mode, credentialBindingCount: credentials.bindings.length })
            : nativeHarnessState
              ? exactNativeHarnessStateCommand({ request, taskRoot: workerPreparationRoot, execution, runId: source.run.id })
            : nativeRuntimeAssetErasureProbe
              ? exactNativeRuntimeAssetErasureProbeCommand({ request, taskRoot: workerPreparationRoot,
                runId: source.run.id, sessionDigest: sha256(execution.session.normalizedSessionId ?? "") })
              : exactNativeProviderArtifactChunkCommand({ request, taskRoot: workerPreparationRoot }) ||
                exactNativeManagedArtifactCommand({ request, taskRoot: workerPreparationRoot,
                  authority: (profile.nativeOpenCodeSourceAuthority as Record<string, unknown>).artifactAuthority });
        if (!exactCommand || !noCredentialEnvironment || credentials.mode !== "none" || credentials.bindings.length !== 0 ||
          request.brokerCredential !== undefined || request.modelBrokerCredential !== undefined || request.cwd !== workerPreparationRoot)
          throw forbidden("Worker preparation requires its exact credentialless staged command");
      } else if (providerArtifactPreparation) {
        const task = source.source.task;
        const taskSnapshot = nativePayloadSourceSnapshotSchema.safeParse(task.payloadSourceSnapshot);
        const [taskOwnerVersion] = await tx.select({ sourceVersion: sql<string>`extract(epoch from ${issues.updatedAt})::text` })
          .from(issues).where(and(eq(issues.companyId, claims.company_id), eq(issues.id, task.id))).limit(1);
        const contextSnapshot = source.run.contextSnapshot && typeof source.run.contextSnapshot === "object" &&
          !Array.isArray(source.run.contextSnapshot) ? source.run.contextSnapshot as Record<string, unknown> : {};
        const generation = typeof contextSnapshot.conversationSessionGeneration === "number"
          ? contextSnapshot.conversationSessionGeneration : null;
        const workspaceScope = generation !== null ? await findNativeChatWorkspaceScope(tx, {
          adapterType: source.source.agent.adapterType, environmentDriver: "sandbox", companyId: claims.company_id,
          agentId: source.run.agentId!, issueId: task.id, runId: source.run.id,
          responsibleUserId: source.run.responsibleUserId, conversationSessionGeneration: generation,
        }) : null;
        const expectedTaskRoot = workspaceScope?.projectId === null ? nativeChatWorkspaceCwd(workspaceScope, null, false) : null;
        const filesystem = source.policy.compilation.compiledPolicy.filesystem;
        const readRoots = Array.isArray(filesystem?.readPaths) ? filesystem.readPaths : [];
        const writeRoots = Array.isArray(filesystem?.writePaths) ? filesystem.writePaths : [];
        const noCredentialEnvironment = sessionModelRefresh
          ? Object.keys(request.env ?? {}).every(key => ["PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN",
            "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND", "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS"].includes(key)) &&
            request.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN === managedModelBrokerOrigin &&
            request.env.PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND === String(request.modelBrokerCredential?.inputTokensUpperBound) &&
            request.env.PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS === String(request.modelBrokerCredential?.maxOutputTokens)
          : !Object.keys(request.env ?? {}).some(key => [
          "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PAPERCLIP_SANDBOX_BROKER_TOKEN",
          "PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN", "PAPERCLIP_SANDBOX_BROKER_SESSION_ID",
          "PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN", "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND",
          "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS",
        ].includes(key));
        const exactConversation = task.conversationAgentId === source.run.agentId &&
          task.conversationUserId === source.run.responsibleUserId && task.assigneeAgentId === source.run.agentId &&
          task.conversationState === "active" && task.conversationRetiredAt === null &&
          task.executionRunId === source.run.id && task.conversationSessionGeneration === generation && generation !== null &&
          ["in_review", "in_progress"].includes(task.status) && source.run.status === "running" &&
          source.run.runtimeMode === "native" && source.run.scopeKind === "issue" && source.run.nativeIssueId === task.id &&
          source.run.contextSnapshot?.conversationSessionGeneration === generation && source.manifest.runId === source.run.id &&
          source.manifest.agentId === source.run.agentId && source.manifest.manifest.responsibleUserId === source.run.responsibleUserId;
        if (resolvePaperclipRunnerProviderProfile(source.source.agent.adapterConfig)?.provider !== "opencode" ||
          !exactConversation || !taskSnapshot.success || taskSnapshot.data.owner.kind !== "issue" ||
          taskSnapshot.data.owner.companyId !== claims.company_id || taskSnapshot.data.owner.id !== task.id ||
          task.payloadSourceProtocolVersion !== 1 || task.payloadSourceSnapshotInvalidated ||
          !taskOwnerVersion?.sourceVersion || !expectedTaskRoot ||
          path.resolve(request.cwd) !== expectedTaskRoot ||
          !readRoots.some(root => typeof root === "string" && path.resolve(root) === expectedTaskRoot) ||
          !writeRoots.some(root => typeof root === "string" && path.resolve(root) === expectedTaskRoot) ||
          credentials.mode !== "none" || credentials.bindings.length !== 0 || brokerCredential !== undefined ||
          request.modelBrokerCredential !== undefined || !noCredentialEnvironment)
          throw forbidden("Sandbox provider-artifact preparation is outside the exact current conversation Task scope");
        await assertNativeTaskSourceOwnerCurrent(tx, { companyId: claims.company_id,
          actor: { type: "board", source: "session", userId: claims.responsible_user_id },
          source: { kind: "task", issueId: task.id, sourceVersion: taskOwnerVersion.sourceVersion,
            contentHash: taskSnapshot.data.owner.contentHash } });
        const shellScript = request.argv[0] === "sh" && request.argv[1] === "-c" ? request.argv[2] ?? "" : "";
        if ((request.stdinBase64.length > 0 || shellScript.includes(".paperclip-upload.")) &&
          !exactNativeProviderArtifactChunkCommand({ request, taskRoot: expectedTaskRoot }))
          throw forbidden("Provider artifact relay chunk is outside its exact private Task target");
      }
      const workerNativeSessionStart = nativeSessionStart && !source.providerConformanceBootstrap &&
        source.source.task.conversationAgentId === null && source.source.task.conversationUserId === null;
      const workerModelSessionRefresh = !nativePreparationPurpose && request.modelBrokerSession?.phase === "refresh" &&
        source.source.task.conversationAgentId === null && source.source.task.conversationUserId === null;
      if (workerModelSessionRefresh) {
        const profile = source.run.runnerProfileJson && typeof source.run.runnerProfileJson === "object" &&
          !Array.isArray(source.run.runnerProfileJson) ? source.run.runnerProfileJson as Record<string, unknown> : {};
        let execution: ReturnType<typeof parseNativeExecutionInput> | null = null;
        try { execution = parseNativeExecutionInput(profile.nativeExecutionInput); } catch { execution = null; }
        const taskRoot = execution?.workspace.cwd;
        if (source.run.status !== "running" || source.run.runtimeMode !== "native" || !source.run.agentId ||
          !source.run.responsibleUserId || !source.run.nativeSessionId || !source.run.runnerInstanceId ||
          !source.attempt || source.attempt.runId !== source.run.id || source.attempt.status !== "running" ||
          !execution || execution.provider.kind !== "opencode" || execution.session.driverKind !== "opencode_server" ||
          execution.session.normalizedSessionId !== source.run.nativeSessionId || execution.binding.companyId !== claims.company_id ||
          execution.binding.runId !== source.run.id || execution.binding.agentId !== source.run.agentId ||
          !taskRoot || request.cwd !== taskRoot || !exactNativeRunnerMonitorStatusCommand({ request, taskRoot, execution,
            runId: source.run.id }) || !request.modelBrokerCredential)
          throw forbidden("Native worker session refresh is outside the exact active runner status probe");
      }
      if (workerNativeSessionStart) {
        const task = source.source.task;
        const profile = source.run.runnerProfileJson && typeof source.run.runnerProfileJson === "object" &&
          !Array.isArray(source.run.runnerProfileJson) ? source.run.runnerProfileJson as Record<string, unknown> : {};
        let execution: ReturnType<typeof parseNativeExecutionInput> | null = null;
        try { execution = parseNativeExecutionInput(profile.nativeExecutionInput); } catch { execution = null; }
        const taskRoot = execution?.workspace.cwd;
        const filesystem = source.policy.compilation.compiledPolicy.filesystem;
        const readRoots = Array.isArray(filesystem?.readPaths) ? filesystem.readPaths : [];
        const writeRoots = Array.isArray(filesystem?.writePaths) ? filesystem.writePaths : [];
        const exactWorkerRun = source.run.status === "running" && source.run.runtimeMode === "native" &&
          source.run.agentId && source.run.responsibleUserId && source.run.nativeIssueId === task.id &&
          source.run.runnerInstanceId && source.run.nativeSessionId && source.attempt?.runId === source.run.id &&
          source.attempt.status === "running" && source.manifest.runId === source.run.id &&
          source.manifest.agentId === source.run.agentId &&
          source.manifest.manifest.responsibleUserId === source.run.responsibleUserId &&
          source.run.scopeKind === "issue" && task.assigneeAgentId === source.run.agentId;
        if (!exactWorkerRun || !execution || execution.provider.kind !== "opencode" ||
          execution.session.driverKind !== "opencode_server" || execution.session.normalizedSessionId !== source.run.nativeSessionId ||
          execution.binding.companyId !== claims.company_id || execution.binding.runId !== source.run.id ||
          execution.binding.agentId !== source.run.agentId || execution.binding.issueId !== task.id ||
          !taskRoot || !path.isAbsolute(taskRoot) || request.cwd !== taskRoot ||
          !readRoots.some(root => typeof root === "string" && path.resolve(root) === path.resolve(taskRoot)) ||
          !writeRoots.some(root => typeof root === "string" && path.resolve(root) === path.resolve(taskRoot)) ||
          request.modelBrokerSession?.phase !== "start" || !request.modelBrokerCredential ||
          !exactNativeSessionLaunchCommand({ request, taskRoot, execution }))
          throw forbidden("Native worker session start is outside the exact current run, attempt, manifest and launch command");
      } else if (!workerPreparationRoot && !conformanceWorkspaceRoot &&
        (nativeSessionStart || nativeHarnessState || nativeWorkspacePrepare || nativeRuntimeContextPrepare || nativeRuntimeAssetErasureProbe)) {
        const task = source.source.task;
        const taskSnapshot = nativePayloadSourceSnapshotSchema.safeParse(task.payloadSourceSnapshot);
        const [taskOwnerVersion] = await tx.select({ sourceVersion: sql<string>`extract(epoch from ${issues.updatedAt})::text` })
          .from(issues).where(and(eq(issues.companyId, claims.company_id), eq(issues.id, task.id))).limit(1);
        const profile = source.run.runnerProfileJson && typeof source.run.runnerProfileJson === "object" &&
          !Array.isArray(source.run.runnerProfileJson) ? source.run.runnerProfileJson as Record<string, unknown> : {};
        let execution: ReturnType<typeof parseNativeExecutionInput> | null = null;
        try { execution = parseNativeExecutionInput(profile.nativeExecutionInput); } catch { execution = null; }
        const bootstrapComments = profile.nativeBootstrapWakeCommentSources &&
          typeof profile.nativeBootstrapWakeCommentSources === "object" && !Array.isArray(profile.nativeBootstrapWakeCommentSources)
          ? profile.nativeBootstrapWakeCommentSources as Record<string, unknown> : {};
        const requestComment = bootstrapComments.request && typeof bootstrapComments.request === "object" && !Array.isArray(bootstrapComments.request)
          ? bootstrapComments.request as Record<string, unknown> : {};
        const capturedComment = nativePayloadSourceInputSchema.safeParse(requestComment.input);
        const markdownMap = profile.nativeBootstrapTaskMarkdownSourceMap && typeof profile.nativeBootstrapTaskMarkdownSourceMap === "object" &&
          !Array.isArray(profile.nativeBootstrapTaskMarkdownSourceMap) ? profile.nativeBootstrapTaskMarkdownSourceMap as Record<string, unknown> : {};
        const markdownReferences = Array.isArray(markdownMap.references)
          ? markdownMap.references.filter((value): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)) : [];
        const contextSnapshot = source.run.contextSnapshot && typeof source.run.contextSnapshot === "object" &&
          !Array.isArray(source.run.contextSnapshot) ? source.run.contextSnapshot as Record<string, unknown> : {};
        const generation = typeof contextSnapshot.conversationSessionGeneration === "number"
          ? contextSnapshot.conversationSessionGeneration : null;
        const workspaceScope = generation !== null ? await findNativeChatWorkspaceScope(tx, {
          adapterType: source.source.agent.adapterType, environmentDriver: "sandbox", companyId: claims.company_id,
          agentId: source.run.agentId!, issueId: task.id, runId: source.run.id,
          responsibleUserId: source.run.responsibleUserId, conversationSessionGeneration: generation,
        }) : null;
        const expectedTaskRoot = workspaceScope?.projectId === null ? nativeChatWorkspaceCwd(workspaceScope, null, false) : null;
        const filesystem = source.policy.compilation.compiledPolicy.filesystem;
        const readRoots = Array.isArray(filesystem?.readPaths) ? filesystem.readPaths : [];
        const writeRoots = Array.isArray(filesystem?.writePaths) ? filesystem.writePaths : [];
        const snapshotComment = taskSnapshot.success && taskSnapshot.data.inputs.length === 1
          ? nativePayloadSourceInputSchema.safeParse(taskSnapshot.data.inputs[0]) : null;
        const commentId = capturedComment?.success && capturedComment.data.kind === "comment"
          ? capturedComment.data.commentId : null;
        const renderedMarkdownLength = typeof markdownMap.renderedMarkdownLength === "number" &&
          Number.isSafeInteger(markdownMap.renderedMarkdownLength) && markdownMap.renderedMarkdownLength > 0 &&
          markdownMap.renderedMarkdownLength <= 1_000_000 ? markdownMap.renderedMarkdownLength : null;
        const exactNativeInput = execution !== null && execution.binding.companyId === claims.company_id &&
          execution.binding.runId === source.run.id && execution.binding.issueId === task.id &&
          execution.binding.agentId === source.run.agentId && execution.session.driverKind === "opencode_server" &&
          execution.session.normalizedSessionId === source.run.nativeSessionId &&
          execution.completionContract.id === source.run.completionContractId &&
          execution.completionContract.sha256 === source.run.completionContractSha256 &&
          execution.provider.kind === "opencode" && execution.workspace.cwd === expectedTaskRoot &&
          typeof execution.task.prompt === "string" && execution.task.prompt.length > 0;
        const exactHumanTask = task.conversationAgentId === source.run.agentId &&
          task.conversationUserId === source.run.responsibleUserId && task.assigneeAgentId === source.run.agentId &&
          task.conversationState === "active" && task.conversationRetiredAt === null &&
          task.executionRunId === source.run.id && task.conversationSessionGeneration === generation && generation !== null &&
          ["in_review", "in_progress"].includes(task.status) && source.run.status === "running" &&
          source.run.runtimeMode === "native" && source.run.scopeKind === "issue" && source.run.nativeIssueId === task.id &&
          contextSnapshot.conversationSessionGeneration === generation && source.manifest.runId === source.run.id &&
          source.manifest.agentId === source.run.agentId && source.manifest.manifest.responsibleUserId === source.run.responsibleUserId;
        const currentCommentFacets = {
          taskSnapshotSingleInput: taskSnapshot.success && taskSnapshot.data.inputs.length === 1,
          snapshotInputComment: snapshotComment?.success === true && snapshotComment.data.kind === "comment",
          snapshotInputIssueBound: snapshotComment?.success === true && snapshotComment.data.kind === "comment" &&
            snapshotComment.data.issueId === task.id,
          requestInputComment: capturedComment?.success === true && capturedComment.data.kind === "comment",
          requestInputIssueBound: capturedComment?.success === true && capturedComment.data.kind === "comment" &&
            capturedComment.data.issueId === task.id,
          snapshotAndRequestCommentMatch: snapshotComment?.success === true && snapshotComment.data.kind === "comment" &&
            commentId === snapshotComment.data.commentId,
          wakeCommentIdMatches: commentId !== null && contextSnapshot.wakeCommentId === commentId,
          markdownMapVersion: markdownMap.version === 1,
          markdownDigestValid: typeof markdownMap.renderedMarkdownDigest === "string" &&
            /^[a-f0-9]{64}$/.test(markdownMap.renderedMarkdownDigest),
          markdownLengthValid: renderedMarkdownLength !== null,
          executionPromptAvailable: execution !== null,
          promptContainsMarkdownLength: execution !== null && renderedMarkdownLength !== null &&
            execution.task.prompt.length >= renderedMarkdownLength,
          promptMarkdownSuffixMatches: execution !== null && renderedMarkdownLength !== null &&
            typeof markdownMap.renderedMarkdownDigest === "string" && /^[a-f0-9]{64}$/.test(markdownMap.renderedMarkdownDigest) &&
            execution.task.prompt.length >= renderedMarkdownLength &&
            sha256(execution.task.prompt.slice(-renderedMarkdownLength)) === markdownMap.renderedMarkdownDigest,
          taskReferencePresent: markdownReferences.some(reference => reference.kind === "task" && reference.id === task.id),
          commentReferencePresent: commentId !== null && markdownReferences.some(reference => reference.kind === "comment" && reference.id === commentId),
        };
        const exactCurrentComment = Object.values(currentCommentFacets).every(Boolean);
        const exactWorkspace = expectedTaskRoot !== null && path.resolve(request.cwd) === expectedTaskRoot &&
          readRoots.some(root => typeof root === "string" && path.resolve(root) === expectedTaskRoot) &&
          writeRoots.some(root => typeof root === "string" && path.resolve(root) === expectedTaskRoot);
        const runtimeContextSourceAuthority = profile.nativeOpenCodeSourceAuthority &&
          typeof profile.nativeOpenCodeSourceAuthority === "object" && !Array.isArray(profile.nativeOpenCodeSourceAuthority)
          ? profile.nativeOpenCodeSourceAuthority as Record<string, unknown> : {};
        const exactRuntimeContextSource = nativeRuntimeContextPrepare && execution !== null &&
          runtimeContextSourceAuthority.version === 1 &&
          runtimeContextSourceAuthority.executionInputHash === nativeSha256(profile.nativeExecutionInput);
        const exactRuntimeContextTarget = nativeRuntimeContextPrepare && execution !== null && expectedTaskRoot !== null &&
          exactNativeRuntimeContextPrepareCommand({ request, taskRoot: expectedTaskRoot, execution });
        const runtimeContextManifestOwner = source.manifest.manifest.responsibleUserId;
        const exactRuntimeContextOwner = nativeRuntimeContextPrepare && execution !== null && expectedTaskRoot !== null &&
          typeof runtimeContextManifestOwner === "string" && runtimeContextManifestOwner === source.run.responsibleUserId &&
          exactNativeRuntimeContextPreparationOwner({
            request, taskRoot: expectedTaskRoot, execution, companyId: claims.company_id,
            runId: source.run.id, agentId: source.run.agentId!, responsibleUserId: source.run.responsibleUserId!,
            manifest: { runId: source.manifest.runId, agentId: source.manifest.agentId,
              responsibleUserId: runtimeContextManifestOwner },
            nativeExecutionInput: profile.nativeExecutionInput, sourceAuthority: runtimeContextSourceAuthority,
            credentialMode: credentials.mode, credentialBindingCount: credentials.bindings.length,
          });
        const exactErasureProbe = nativeRuntimeAssetErasureProbe && expectedTaskRoot !== null &&
          exactNativeRuntimeAssetErasureProbeCommand({ request, taskRoot: expectedTaskRoot,
            runId: source.run.id, sessionDigest: sha256(execution?.session.normalizedSessionId ?? "") });
        let exactRemoteSessionStartBinding = true;
        if (nativeSessionStart) {
          const locator = await readRemoteRuntimeAssetLocator(tx, source.run);
          const saved = expected.remoteNativeSessionStartBinding &&
            typeof expected.remoteNativeSessionStartBinding === "object" &&
            !Array.isArray(expected.remoteNativeSessionStartBinding)
            ? expected.remoteNativeSessionStartBinding as Record<string, unknown> : null;
          if (!locator) {
            exactRemoteSessionStartBinding = saved === null;
          } else {
            exactRemoteSessionStartBinding = Boolean(saved &&
              saved.schema === "paperclip.remote-native-session-start-binding.v1" &&
              saved.locatorDigest === remoteRuntimeAssetLocatorDigest(locator) &&
              saved.runnerInstanceId === locator.runnerInstanceId && saved.runnerInstanceId === source.run.runnerInstanceId &&
              saved.environmentLeaseId === locator.environmentLeaseId && saved.environmentLeaseId === source.lease.id &&
              saved.provider === locator.provider && saved.provider === source.lease.provider &&
              saved.providerLeaseId === locator.providerLeaseId && saved.providerLeaseId === source.lease.providerLeaseId &&
              saved.normalizedSessionIdDigest === locator.normalizedSessionIdDigest &&
              saved.hostId === source.host.id && saved.hostEpoch === source.host.credentialVersion &&
              saved.cellId === source.cell.id && saved.cellGeneration === source.cell.generation.toString() &&
              saved.bindingId === source.sandboxBinding.id && saved.manifestId === source.manifest.id &&
              saved.manifestHash === source.manifest.hash && saved.policySnapshotId === source.policy.id &&
              saved.policyHash === source.policy.policyHash);
          }
        }
        const exactTrustedCommand = nativeSessionStart
          ? exactRemoteSessionStartBinding && execution !== null && expectedTaskRoot !== null && exactNativeSessionLaunchCommand({
            request, taskRoot: expectedTaskRoot, execution,
          })
          : nativeWorkspacePrepare
            ? execution !== null && expectedTaskRoot !== null && exactNativeWorkspacePrepareCommand({
              request, taskRoot: expectedTaskRoot, execution,
              expectedProviderLeaseId: source.lease.providerLeaseId ?? undefined,
            })
            : nativeRuntimeContextPrepare
              ? exactRuntimeContextOwner
              : nativeRuntimeAssetErasureProbe
                ? exactErasureProbe
              : execution !== null && expectedTaskRoot !== null &&
              (sessionModelRefresh
                ? exactNativeRunnerMonitorStatusCommand({ request, taskRoot: expectedTaskRoot, execution, runId: source.run.id })
                : exactNativeHarnessStateCommand({ request, taskRoot: expectedTaskRoot, execution, runId: source.run.id }));
        const exactCredentialShape = nativeSessionStart
          ? request.modelBrokerCredential !== undefined
          : sessionModelRefresh ? request.modelBrokerCredential !== undefined
            : request.modelBrokerCredential === undefined && Object.keys(request.env).every(key => ![
            "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PAPERCLIP_SANDBOX_BROKER_TOKEN",
            "PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN", "PAPERCLIP_SANDBOX_BROKER_SESSION_ID",
            "PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN", "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND",
            "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS",
          ].includes(key));
        const exactRuntimeProvider = resolvePaperclipRunnerProviderProfile(source.source.agent.adapterConfig)?.provider === "opencode";
        const exactTaskSource = taskSnapshot.success && taskSnapshot.data.owner.kind === "issue" &&
          taskSnapshot.data.owner.companyId === claims.company_id && taskSnapshot.data.owner.id === task.id &&
          task.payloadSourceProtocolVersion === 1 && !task.payloadSourceSnapshotInvalidated && Boolean(taskOwnerVersion?.sourceVersion);
        const exactNoWorkloadCredentials = credentials.mode === "none" && credentials.bindings.length === 0 &&
          request.brokerCredential === undefined;
        if (!exactRuntimeProvider || !exactNativeInput || !exactHumanTask || !exactCurrentComment || !exactWorkspace ||
          !exactTrustedCommand || !exactCredentialShape || !exactTaskSource || !exactNoWorkloadCredentials) {
          const failedChecks = [
            ...(!exactRuntimeProvider ? ["provider"] : []),
            ...(!exactNativeInput ? ["execution_input"] : []),
            ...(!exactHumanTask ? ["human_run_manifest"] : []),
            ...(!exactCurrentComment ? ["comment_source"] : []),
            ...(process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1"
              ? Object.entries(currentCommentFacets).filter(([, valid]) => !valid)
                .map(([facet]) => `comment_source_${facet}`) : []),
            ...(!exactWorkspace ? ["workspace_roots"] : []),
            ...(!exactTrustedCommand ? ["trusted_command"] : []),
            ...(nativeRuntimeContextPrepare && !exactRuntimeContextSource ? ["runtime_context_source_authority"] : []),
            ...(nativeRuntimeContextPrepare && !exactRuntimeContextTarget ? ["runtime_context_target"] : []),
            ...(!exactCredentialShape ? ["credential_shape"] : []),
            ...(!exactTaskSource ? ["task_source_owner"] : []),
            ...(!exactNoWorkloadCredentials ? ["workload_credentials"] : []),
          ];
          throw forbidden(`Native pre-receipt command is outside the current conversation Run, input, Human and workspace scope${
            process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1" ? `:${failedChecks.join(",")}` : ""
          }`);
        }
        await assertNativeTaskSourceOwnerCurrent(tx, { companyId: claims.company_id,
          actor: { type: "board", source: "session", userId: claims.responsible_user_id },
          source: { kind: "task", issueId: task.id, sourceVersion: taskOwnerVersion.sourceVersion,
            contentHash: taskSnapshot.data.owner.contentHash } });
        nativeSessionStartValid = nativeSessionStart;
        nativeHarnessStateValid = nativeHarnessState;
      }
      if (!providerArtifactPreparation && !nativeHarnessState && !nativeWorkspacePrepare && !nativeRuntimeContextPrepare &&
        !nativeRuntimeAssetErasureProbe && credentials.mode === "brokered") {
        const brokerClaims = brokerCredential ? verifySandboxBrokerJwt(brokerCredential.capabilityToken) : null;
        const brokerCapability = brokerClaims?.sandbox_broker;
        const endpointOrigin = credentialBrokerOrigin;
        if (!brokerCredential || !brokerClaims || !brokerCapability || !endpointOrigin || brokerClaims.sub !== claims.sub ||
          brokerClaims.company_id !== claims.company_id || brokerClaims.run_id !== request.runId ||
          brokerClaims.responsible_user_id !== claims.responsible_user_id || brokerCapability.parentRequestId !== request.requestId ||
          brokerCapability.bindingId !== request.bindingId || brokerCapability.cellId !== input.cellId ||
          brokerCapability.generation !== input.generation || brokerCapability.hostId !== capability.hostId ||
          brokerCapability.hostEpoch !== request.hostEpoch || brokerCapability.runId !== request.runId ||
          brokerCapability.attemptId !== request.attemptId || brokerCapability.attempt !== request.attempt ||
          brokerCapability.manifestId !== request.manifestId || brokerCapability.manifestHash !== request.manifestHash ||
          brokerCapability.policySnapshotId !== request.policySnapshotId || brokerCapability.policyHash !== request.policyHash ||
          brokerCapability.endpointOrigin !== endpointOrigin || Date.parse(brokerCapability.expiresAt) > Date.parse(request.deadlineAt) ||
          brokerClaims.exp > claims.exp || brokerClaims.exp * 1000 > Date.parse(brokerCapability.expiresAt) + 999 ||
          Date.parse(brokerCredential.expiresAt) !== Date.parse(brokerCapability.expiresAt) ||
          brokerCredential.profileId !== source.capability.credentialBrokerProviderProfile?.id ||
          brokerCredential.profileHash !== source.capability.credentialBrokerProviderProfile?.hash ||
          request.env.PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN !== endpointOrigin ||
          request.env.PAPERCLIP_SANDBOX_BROKER_SESSION_ID !== brokerCapability.brokerSessionId)
          throw forbidden("Sandbox broker capability is not bound to this exact parent execution");
        const resolved = await getAssignedMcpGateway(db, tx).resolveSandboxCredentialBrokerBindings({
          companyId: claims.company_id, agentId: source.run.agentId!, runId: source.run.id,
          responsibleUserId: source.run.responsibleUserId!, presenceId: source.source.runtime.id,
          bindings: credentials.bindings,
        });
        if (resolved.bindings.length !== brokerCapability.bindings.length ||
          nativeSha256(resolved.bindings) !== nativeSha256(brokerCapability.bindings) ||
          credentials.bindings.some(binding => resolved.authorizedConnectionGrantHashes[binding.connectionId] !== binding.grantVersionHash))
          throw forbidden("Current assigned ToolGateway grants changed before sandbox dispatch");
      } else if (!providerArtifactPreparation && !nativeHarnessState && !nativeWorkspacePrepare && !nativeRuntimeContextPrepare &&
        !nativeRuntimeAssetErasureProbe && (credentials.mode !== "none" || credentials.bindings.length ||
        brokerCredential !== undefined)) {
        throw forbidden("Sandbox execution contains an unauthorized broker capability");
      }
      const modelCredential = request.modelBrokerCredential;
      const modelClaims = modelCredential ? verifyRuntimeToolsToken(modelCredential.capabilityToken, "worker_model") : null;
      const reviewModelClaims = modelCredential
        ? verifyRuntimeToolsToken(modelCredential.capabilityToken, "review_model") : null;
      const conversationModelClaims = modelCredential
        ? verifyRuntimeToolsToken(modelCredential.capabilityToken, "conversation_model") : null;
      const conformanceModelClaims = modelCredential
        ? verifyRuntimeToolsToken(modelCredential.capabilityToken, "provider_conformance") : null;
      const modelBinding = modelClaims?.worker_model;
      const conversationBinding = conversationModelClaims?.conversation_model;
      const reviewBinding = reviewModelClaims?.review_model;
      const [modelAttempt] = modelBinding ? await tx.select().from(orchestrationWorkerAttempts).where(and(
        eq(orchestrationWorkerAttempts.companyId, claims.company_id),
        eq(orchestrationWorkerAttempts.id, modelBinding.workerAttemptId),
        eq(orchestrationWorkerAttempts.planId, modelBinding.planId),
        eq(orchestrationWorkerAttempts.workerId, modelBinding.workerId),
        eq(orchestrationWorkerAttempts.agentId, source.run.agentId!),
        eq(orchestrationWorkerAttempts.runId, source.run.id),
        eq(orchestrationWorkerAttempts.executionManifestId, source.manifest.id),
        eq(orchestrationWorkerAttempts.status, "running"),
      )).limit(1) : [];
      const [modelPlan] = modelBinding ? await tx.select().from(orchestrationPlans).where(and(
        eq(orchestrationPlans.companyId, claims.company_id),
        eq(orchestrationPlans.id, modelBinding.planId),
        eq(orchestrationPlans.version, modelBinding.expectedPlanVersion),
        eq(orchestrationPlans.status, "running"),
      )).limit(1) : [];
      const nativeProvider = source.source.agent.adapterType === "paperclip_runner"
        ? resolvePaperclipRunnerProviderProfile(source.source.agent.adapterConfig)
        : null;
      const nativeHarnessModelRefresh = nativeHarnessState && request.modelBrokerSession?.phase === "refresh";
      const modelSessionStop = request.modelBrokerSession?.phase === "stop";
      if (providerArtifactPreparation) {
        // The server-stored preparation purpose is the only path that may run
        // a Native artifact command without either credential family.
        if (modelCredential !== undefined) throw forbidden("Provider-artifact preparation cannot receive a model credential");
      } else if ((nativeHarnessState && !nativeHarnessModelRefresh) || nativeWorkspacePrepare || nativeRuntimeContextPrepare ||
        nativeRuntimeAssetErasureProbe || nativeAttachmentStage || nativeAttachmentCleanup) {
        if (modelCredential !== undefined || credentials.mode !== "none" || credentials.bindings.length !== 0 || brokerCredential !== undefined)
          throw forbidden("Credentialless Native preparation commands cannot receive workload credentials");
      } else if (modelSessionStop) {
        if (modelCredential !== undefined || brokerCredential !== undefined ||
          Object.keys(request.env).some(key => ["ANTHROPIC_API_KEY", "OPENAI_API_KEY",
            "PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN", "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND",
            "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS", "PAPERCLIP_SANDBOX_BROKER_TOKEN"].includes(key)))
          throw forbidden("Stopped managed model session cleanup cannot carry credentials");
      } else if (nativeProvider?.provider === "opencode") {
        const exactProfileAndEnvironment = !!modelCredential && !!source.capability.modelBrokerProviderProfile &&
          modelCredential.profileId === source.capability.modelBrokerProviderProfile.id &&
          modelCredential.profileHash === source.capability.modelBrokerProviderProfile.hash &&
          request.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN === managedModelBrokerOrigin &&
          !!managedModelBrokerOrigin;
        const inputAndExpiryValid = !!modelCredential && !!source.capability.modelBrokerProviderProfile &&
          Number.isSafeInteger(modelCredential.inputTokensUpperBound) && modelCredential.inputTokensUpperBound >= 1 &&
          modelCredential.inputTokensUpperBound <= 2_000_000 &&
          Number.isSafeInteger(modelCredential.maxOutputTokens) && modelCredential.maxOutputTokens >= 256 &&
          modelCredential.maxOutputTokens <= 8192 &&
          request.env.PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND === String(modelCredential.inputTokensUpperBound) &&
          request.env.PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS === String(modelCredential.maxOutputTokens) &&
          Date.parse(modelCredential.expiresAt) > Date.now() &&
          Date.parse(modelCredential.expiresAt) <= Date.parse(request.modelBrokerSession?.sessionDeadlineAt ?? request.deadlineAt);
        const workerCredentialValid = !!modelCredential && !!modelClaims?.worker_model && !conversationModelClaims?.conversation_model && !reviewModelClaims?.review_model && !!modelBinding &&
          modelClaims.company_id === claims.company_id && modelClaims.sub === source.run.agentId &&
          modelClaims.run_id === source.run.id && modelClaims.responsible_user_id === source.run.responsibleUserId &&
          modelClaims.exp * 1000 >= Date.now() && Date.parse(modelCredential.expiresAt) <= modelClaims.exp * 1000 &&
          !!modelAttempt && !!modelPlan && modelPlan.issueId === source.run.nativeIssueId;
        let reviewCredentialValid = false;
        if (reviewBinding && modelCredential && source.run.responsibleUserId && source.run.agentId) {
          const current = await options.workerModels?.issueForReviewRun({ companyId: claims.company_id,
            agentId: source.run.agentId, runId: source.run.id, responsibleUserId: source.run.responsibleUserId });
          const currentClaims = current ? verifyRuntimeToolsToken(current.token, "review_model") : null;
          reviewCredentialValid = !!currentClaims?.review_model && !!source.capability.modelBrokerProviderProfile &&
            exactProfileAndEnvironment && inputAndExpiryValid && reviewModelClaims?.company_id === claims.company_id &&
            reviewModelClaims.sub === source.run.agentId && reviewModelClaims.run_id === source.run.id &&
            reviewModelClaims.responsible_user_id === source.run.responsibleUserId && reviewModelClaims.exp * 1000 >= Date.now() &&
            Date.parse(modelCredential.expiresAt) <= reviewModelClaims.exp * 1000 && reviewBinding.reviewerAgentId === source.run.agentId &&
            reviewBinding.reviewerRunId === source.run.id && reviewBinding.issueId === source.run.nativeIssueId &&
            reviewBinding.executionManifestId === source.manifest.id &&
            nativeSha256(reviewBinding) === nativeSha256(currentClaims.review_model);
        }
        let conversationCredentialValid = false;
        let conversationCredentialChecks: Record<string, boolean> | null = null;
        const conformanceContext = source.run.contextSnapshot && typeof source.run.contextSnapshot === "object" &&
          !Array.isArray(source.run.contextSnapshot) ? source.run.contextSnapshot as Record<string, unknown> : {};
        const conformanceDispatch = conformanceContext.nativeOpenCodeConformanceDispatch &&
          typeof conformanceContext.nativeOpenCodeConformanceDispatch === "object" &&
          !Array.isArray(conformanceContext.nativeOpenCodeConformanceDispatch)
          ? conformanceContext.nativeOpenCodeConformanceDispatch as Record<string, unknown> : {};
        const conformanceClaim = conformanceModelClaims?.provider_conformance;
        const conformanceCredentialValid = Boolean(source.providerConformanceBootstrap && nativeSessionStartValid &&
          request.modelBrokerSession?.phase === "start" && modelCredential && conformanceModelClaims?.scope === "provider_conformance" &&
          !modelClaims && !conversationModelClaims && conformanceClaim && source.qualificationGroupId && source.conformancePlan &&
          conformanceContext.providerConformanceGroupId === source.qualificationGroupId &&
          conformanceContext.providerConformancePlanId === source.conformancePlan.id &&
          conformanceContext.nativeOpenCodeConformanceProbeId === conformanceClaim.probeId &&
          conformanceContext.nativeOpenCodeConformanceProfileId === conformanceClaim.profileId &&
          conformanceContext.nativeOpenCodeConformanceDispatch !== undefined &&
          conformanceClaim.qualificationGroupId === source.qualificationGroupId &&
          conformanceClaim.probeRunId === source.run.id && conformanceClaim.planId === source.conformancePlan.id &&
          conformanceClaim.profileId === source.capability.modelBrokerProviderProfile?.id &&
          conformanceClaim.probeId === conformanceDispatch.probeId &&
          conformanceClaim.dispatchNonce === conformanceDispatch.dispatchNonce &&
          conformanceClaim.authorityHash === conformanceDispatch.authorityHash &&
          conformanceDispatch.qualificationGroupId === source.qualificationGroupId &&
          conformanceDispatch.planId === source.conformancePlan.id &&
          conformanceDispatch.profileId === source.capability.modelBrokerProviderProfile?.id &&
          conformanceModelClaims.company_id === claims.company_id && conformanceModelClaims.sub === source.run.agentId &&
          conformanceModelClaims.run_id === source.run.id &&
          conformanceModelClaims.responsible_user_id === source.run.responsibleUserId &&
          conformanceModelClaims.exp * 1000 >= Date.now() &&
          Date.parse(modelCredential.expiresAt) <= conformanceModelClaims.exp * 1000 && inputAndExpiryValid);
        if (conversationModelClaims?.conversation_model && conversationBinding && modelCredential &&
          source.capability.modelBrokerProviderProfile && exactProfileAndEnvironment && inputAndExpiryValid) {
          const task = source.source.task;
          const profile = source.run.runnerProfileJson && typeof source.run.runnerProfileJson === "object" &&
            !Array.isArray(source.run.runnerProfileJson) ? source.run.runnerProfileJson as Record<string, unknown> : {};
          const receipt = nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
          const receiptData = receipt.success ? receipt.data : null;
          const receiptBody = receiptData ? (({ digest: _digest, ...body }) => body)(receiptData) : null;
          const [receiptDigest] = receiptBody ? await tx.execute<{ digest: string }>(sql`
            select encode(sha256(convert_to((${JSON.stringify(receiptBody)}::jsonb)::text,'UTF8')),'hex') as digest
          `) : [];
          conversationCredentialChecks = {
            receiptDigestOrSessionStartOwner: nativeSessionStartValid || nativeHarnessStateValid || Boolean(receiptData && receiptBody && receiptDigest?.digest === receiptData.digest),
            receiptBindingOrSessionStartOwner: nativeSessionStartValid || nativeHarnessStateValid || Boolean(receiptData && receiptData.binding.companyId === claims.company_id &&
              receiptData.binding.runId === source.run.id && receiptData.binding.agentId === source.run.agentId &&
              receiptData.binding.responsibleUserId === source.run.responsibleUserId &&
              receiptData.binding.issueId === task.id && source.run.nativeInputSourceProtocolVersion === 1),
            tokenIdentity: conversationModelClaims.scope === "conversation_model" &&
              conversationModelClaims.company_id === claims.company_id && conversationModelClaims.sub === source.run.agentId &&
              conversationModelClaims.run_id === source.run.id &&
              conversationModelClaims.responsible_user_id === source.run.responsibleUserId &&
              conversationModelClaims.exp * 1000 >= Date.now() &&
              Date.parse(modelCredential.expiresAt) <= conversationModelClaims.exp * 1000,
            tokenBinding: conversationBinding.issueId === task.id &&
              conversationBinding.conversationSessionGeneration === task.conversationSessionGeneration &&
              conversationBinding.executionManifestId === source.manifest.id &&
              conversationBinding.executionManifestHash === source.manifest.hash,
            runBinding: source.run.status === "running" && source.run.runtimeMode === "native" &&
              source.run.scopeKind === "issue" && source.run.nativeIssueId === task.id &&
              source.run.responsibleUserId === task.conversationUserId &&
              source.run.contextSnapshot?.conversationSessionGeneration === task.conversationSessionGeneration,
            conversationOwner: task.conversationAgentId === source.run.agentId &&
              task.conversationUserId === source.run.responsibleUserId && task.assigneeAgentId === source.run.agentId &&
              task.conversationState === "active" && task.conversationRetiredAt === null &&
              task.executionRunId === source.run.id && ["in_review", "in_progress"].includes(task.status),
            manifestBinding: source.manifest.runId === source.run.id && source.manifest.agentId === source.run.agentId &&
              source.manifest.hash === conversationBinding.executionManifestHash &&
              source.manifest.manifest.responsibleUserId === source.run.responsibleUserId,
          };
          if (Object.values(conversationCredentialChecks).every(Boolean) && receiptData) {
            await assertNativePayloadSourceSetCurrent(tx, { companyId: claims.company_id, issueId: task.id,
              runId: source.run.id, actor: { type: "board", source: "session", userId: claims.responsible_user_id },
              policy: receiptData.bootstrap.policy, inputs: receiptData.bootstrap.inputs });
          }
          if (Object.values(conversationCredentialChecks).every(Boolean) && (receiptData || nativeSessionStartValid || nativeHarnessStateValid)) {
            conversationCredentialValid = conversationModelClaims.exp * 1000 > Date.now() &&
              Date.parse(modelCredential.expiresAt) > Date.now() && Date.parse(request.deadlineAt) > Date.now();
          }
        }
        if (!modelCredential || !source.capability.modelBrokerProviderProfile || !exactProfileAndEnvironment ||
          !inputAndExpiryValid || (!workerCredentialValid && !reviewCredentialValid && !conversationCredentialValid && !conformanceCredentialValid)) {
          const failedChecks = [
            ...(!modelCredential ? ["credential_absent"] : []),
            ...(!source.capability.modelBrokerProviderProfile ? ["provider_profile_absent"] : []),
            ...(!exactProfileAndEnvironment ? ["profile_or_origin_mismatch"] : []),
            ...(!inputAndExpiryValid ? ["bounds_or_expiry_invalid"] : []),
            ...(!workerCredentialValid && !reviewCredentialValid && !conversationCredentialValid && !conformanceCredentialValid
              ? (conversationCredentialChecks
                  ? Object.entries(conversationCredentialChecks).filter(([, valid]) => !valid).map(([name]) => name)
                  : ["conversation_claim_or_binding_missing"])
              : []),
            ...(conversationCredentialChecks && Object.values(conversationCredentialChecks).every(Boolean) && !conversationCredentialValid
              ? ["credential_expired_before_admission"] : []),
            ...(process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1"
              ? [
                  `preparation_${nativePreparationPurpose ?? "none"}`,
                  `session_start_owner_${nativeSessionStartValid}`,
                  `harness_state_owner_${nativeHarnessStateValid}`,
                  `source_protocol_v1_${source.run.nativeInputSourceProtocolVersion === 1}`,
                  `receipt_schema_${nativeRunInputSourceReceiptSchema.safeParse(
                    source.run.runnerProfileJson && typeof source.run.runnerProfileJson === "object" &&
                      !Array.isArray(source.run.runnerProfileJson)
                      ? (source.run.runnerProfileJson as Record<string, unknown>).nativeInputSourceReceipt
                      : undefined,
                  ).success}`,
                ]
              : []),
          ];
          throw forbidden(`Managed OpenCode model broker capability is missing or outside its exact run scope${
            process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1"
              ? `:${failedChecks.join(",") || "unclassified"}` : ""
          }`);
        }
      } else if (modelCredential !== undefined) {
        throw forbidden("Sandbox execution contains an unauthorized managed model capability");
      }
      const [consumed] = await tx.update(runtimeHostCommands).set({ status: "CLAIMED", attempt: 1 }).where(and(
        eq(runtimeHostCommands.id, operation.id), eq(runtimeHostCommands.status, "PENDING"), eq(runtimeHostCommands.attempt, 0),
      )).returning({ id: runtimeHostCommands.id });
      if (!consumed) throw forbidden("Sandbox execution capability was already consumed");
      return { runtimeHostId: source.host.id, companyId: claims.company_id, generation: input.generation };
    });
  }
  async function authorizeSandboxBrokerCapability(input: { capabilityToken: string; gatewayPublicId: string }): Promise<SandboxBrokerCapabilityClaim> {
    const claims = verifySandboxBrokerJwt(input.capabilityToken);
    const capability = claims?.sandbox_broker;
    const now = new Date();
    if (!claims || !capability || !credentialBrokerOrigin || claims.exp * 1000 <= now.getTime() ||
      claims.sub === "" || claims.company_id === "" || claims.jti !== capability.parentRequestId ||
      capability.endpointOrigin !== credentialBrokerOrigin ||
      !capability.bindings.some(binding => binding.gatewayPublicId === input.gatewayPublicId))
      throw forbidden("Sandbox broker capability is invalid or outside its gateway scope");
    await db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      const [operation] = await tx.select().from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, claims.company_id),
        eq(runtimeHostCommands.idempotencyKey, capability.parentRequestId),
        eq(runtimeHostCommands.commandType, "sandbox_exec"),
        eq(runtimeHostCommands.status, "CLAIMED"),
        eq(runtimeHostCommands.runtimeCellId, capability.cellId),
        eq(runtimeHostCommands.cellGeneration, BigInt(capability.generation)),
        gt(runtimeHostCommands.deadlineAt, now),
      )).for("share");
      const payload = operation?.payload as Record<string, unknown> | undefined;
      if (!operation || payload?.kind !== "sandbox_exec_v1" || payload.requestId !== capability.parentRequestId ||
        payload.bindingId !== capability.bindingId || payload.generation !== capability.generation ||
        payload.hostId !== capability.hostId || payload.hostEpoch !== capability.hostEpoch ||
        payload.runId !== capability.runId || payload.attemptId !== capability.attemptId || payload.attempt !== capability.attempt ||
        payload.manifestId !== capability.manifestId || payload.manifestHash !== capability.manifestHash ||
        payload.policySnapshotId !== capability.policySnapshotId || payload.policyHash !== capability.policyHash ||
        typeof payload.leaseId !== "string") throw forbidden("Sandbox broker parent execution is no longer active");
      const source = await executionSandboxService(tx, { runtimeSuspectSeconds: config.runtime.suspectSeconds }).assertTaskExecutionContext(tx, {
        companyId: claims.company_id, runId: capability.runId, leaseId: payload.leaseId, now,
      });
      if (!source || source.run.agentId !== claims.sub || source.run.responsibleUserId !== claims.responsible_user_id ||
        source.source.agent.adapterType !== claims.adapter_type || source.sandboxBinding.id !== capability.bindingId ||
        source.cell.id !== capability.cellId || source.cell.generation.toString() !== capability.generation ||
        source.host.id !== capability.hostId || source.host.credentialVersion !== capability.hostEpoch ||
        source.manifest.id !== capability.manifestId || source.manifest.hash !== capability.manifestHash ||
        source.policy.id !== capability.policySnapshotId || source.policy.policyHash !== capability.policyHash ||
        source.policy.compilation.compiledPolicy.credentials.mode !== "brokered")
        throw forbidden("Sandbox broker source authority changed");
      const credentials = source.policy.compilation.compiledPolicy.credentials;
      if (credentials.bindings.length === 0) throw forbidden("Sandbox broker policy has no current bindings");
      const minimumBindingTtl = Math.min(...credentials.bindings.map(binding => binding.ttlSeconds));
      if (!Number.isFinite(minimumBindingTtl) || claims.exp > claims.iat + minimumBindingTtl)
        throw forbidden("Sandbox broker capability exceeded its compiled binding TTL");
      const resolved = await getAssignedMcpGateway(db, tx).resolveSandboxCredentialBrokerBindings({
        companyId: claims.company_id, agentId: source.run.agentId!, runId: source.run.id,
        responsibleUserId: source.run.responsibleUserId!, presenceId: source.source.runtime.id,
        bindings: credentials.bindings,
      });
      if (resolved.bindings.length !== capability.bindings.length || nativeSha256(resolved.bindings) !== nativeSha256(capability.bindings) ||
        credentials.bindings.some(item => resolved.authorizedConnectionGrantHashes[item.connectionId] !== item.grantVersionHash))
        throw forbidden("Sandbox broker grants changed during execution");
    });
    return capability;
  }
  async function executeSandboxTask(input: {
    companyId: string;
    runId: string | null;
    leaseId: string;
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdin?: string;
    timeoutMs?: number;
    nativePreparationPurpose?: "provider_artifact" | "native_session_start" | "native_harness_state" | "native_workspace_prepare" | "native_runtime_context_prepare" | "native_provider_data_erasure_probe" | "native_attachment_stage" | "native_attachment_cleanup";
    modelBrokerSessionPhase?: "start" | "refresh" | "stop";
    signal?: AbortSignal;
    onOutput?: (stream: "stdout" | "stderr", chunk: string) => void | Promise<void>;
  }): Promise<{ exitCode: number | null; signal: null; timedOut: boolean; stdout: string; stderr: string;
    modelBrokerSessionReceipt?: import("@paperclipai/shared").RuntimeModelBrokerSessionReceipt } | null> {
    if (!input.runId) return null;
    const command = input.command, argv = [command, ...(input.args ?? [])];
    const cwd = input.cwd;
    const requestedNativePreparationPurpose = input.nativePreparationPurpose;
    const modelBrokerSessionPhase = input.modelBrokerSessionPhase;
    if (requestedNativePreparationPurpose !== undefined && requestedNativePreparationPurpose !== "provider_artifact" &&
      requestedNativePreparationPurpose !== "native_session_start" && requestedNativePreparationPurpose !== "native_harness_state" &&
      requestedNativePreparationPurpose !== "native_workspace_prepare" &&
      requestedNativePreparationPurpose !== "native_runtime_context_prepare" &&
      requestedNativePreparationPurpose !== "native_provider_data_erasure_probe" &&
      requestedNativePreparationPurpose !== NATIVE_ATTACHMENT_STAGE_PREPARATION_PURPOSE &&
      requestedNativePreparationPurpose !== NATIVE_ATTACHMENT_CLEANUP_PREPARATION_PURPOSE)
      throw conflict("Sandbox preparation purpose is unsupported");
    if (!cwd || !cwd.startsWith("/")) throw conflict("Sandbox execution requires an absolute workspace path");
    const env = { ...(input.env ?? {}) };
    // OpenCode uses this fixed non-secret sentinel to select its managed-model
    // profile. It is never sent as an environment key over the host relay;
    // the separately minted modelBrokerCredential is the typed authority the
    // host uses to install the sentinel in the child process environment.
    const managedModelPlaceholder = env.ANTHROPIC_API_KEY === "paperclip-managed-model-broker";
    if (Object.hasOwn(env, "ANTHROPIC_API_KEY")) {
      if (!managedModelPlaceholder) throw conflict("Raw model credentials are not supported in sandbox environment");
      delete env.ANTHROPIC_API_KEY;
    }
    for (const reserved of ["PAPERCLIP_SANDBOX_BROKER_TOKEN", "PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN", "PAPERCLIP_SANDBOX_BROKER_SESSION_ID", "PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN", "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND", "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS"])
      if (Object.hasOwn(env, reserved)) throw conflict("Sandbox broker variables are server-owned");
    const stdinBytes = Buffer.from(input.stdin ?? "", "utf8");
    const requestId = randomUUID();
    const now = new Date();
    const initialSource = await db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      return await executionSandboxService(tx, { runtimeSuspectSeconds: config.runtime.suspectSeconds }).assertTaskExecutionContext(tx, {
        companyId: input.companyId, runId: input.runId!, leaseId: input.leaseId, now,
      });
    });
    if (!initialSource) return null;
    if (!sandboxExecutionCwdAllowed(cwd, initialSource.policy.compilation.compiledPolicy.filesystem))
      throw forbidden("Sandbox execution workspace is outside its current filesystem policy", { code: "sandbox_execution_cwd_outside_policy" });
    const attempt = initialSource.attempt?.attempt ?? Math.max(1, initialSource.run.continuationAttempt + 1);
    const conversationTask = initialSource.source.task;
    const hasConversationIdentity = conversationTask.conversationAgentId !== null || conversationTask.conversationUserId !== null;
    let conversationTaskRoot: string | null = null;
    let conversationExecution: ReturnType<typeof parseNativeExecutionInput> | null = null;
    const runProfile = initialSource.run.runnerProfileJson && typeof initialSource.run.runnerProfileJson === "object" &&
      !Array.isArray(initialSource.run.runnerProfileJson) ? initialSource.run.runnerProfileJson as Record<string, unknown> : {};
    try { conversationExecution = parseNativeExecutionInput(runProfile.nativeExecutionInput); } catch { /* monitor ownership fails closed */ }
    const workerPreparationRoot = !hasConversationIdentity && !initialSource.providerConformanceBootstrap && requestedNativePreparationPurpose &&
      WORKER_NATIVE_PREPARATION_PURPOSES.has(requestedNativePreparationPurpose)
      ? await db.transaction(tx => currentWorkerNativePreparationRoot(tx as unknown as Db, initialSource, requestedNativePreparationPurpose)) : null;
    const conformanceWorkspaceRoot = await currentConformanceNativeWorkspaceRoot(initialSource, requestedNativePreparationPurpose);
    // Workspace/context staging has a separate exact immutable Worker owner.
    // Other shared helpers retain their existing conversation or typed Worker
    // credential paths; this lane never grants arbitrary artifact execution.
    if (requestedNativePreparationPurpose === "native_harness_state" && !hasConversationIdentity && !workerPreparationRoot && !conformanceWorkspaceRoot)
      throw conflict("Native harness state requires an authenticated conversation Task");
    if (requestedNativePreparationPurpose === "native_workspace_prepare" && !hasConversationIdentity && !workerPreparationRoot && !conformanceWorkspaceRoot)
      throw conflict("Native workspace preparation requires an authenticated conversation Task");
    if (requestedNativePreparationPurpose === "native_runtime_context_prepare" && !hasConversationIdentity && !workerPreparationRoot)
      throw conflict("Native runtime-context preparation requires an authenticated conversation Task");
    if (requestedNativePreparationPurpose === "native_provider_data_erasure_probe" && !hasConversationIdentity && !workerPreparationRoot && !conformanceWorkspaceRoot)
      throw conflict("Native remote erasure storage probe requires an authenticated conversation Task");
    const nativePreparationPurpose = requestedNativePreparationPurpose &&
      (hasConversationIdentity || workerPreparationRoot !== null || conformanceWorkspaceRoot !== null || requestedNativePreparationPurpose === "native_session_start")
      ? requestedNativePreparationPurpose : undefined;
    const workerModelSessionRefresh = modelBrokerSessionPhase === "refresh" && !hasConversationIdentity &&
      requestedNativePreparationPurpose === undefined;
    if (workerModelSessionRefresh) {
      const execution = conversationExecution;
      const taskRoot = execution?.workspace.cwd;
      if (!execution || execution.provider.kind !== "opencode" || execution.session.driverKind !== "opencode_server" ||
        execution.session.normalizedSessionId !== initialSource.run.nativeSessionId ||
        execution.binding.companyId !== input.companyId || execution.binding.runId !== initialSource.run.id ||
        execution.binding.agentId !== initialSource.run.agentId || !taskRoot || !path.isAbsolute(taskRoot) ||
        !exactNativeRunnerMonitorStatusCommand({ request: { argv, cwd, stdinBase64: stdinBytes.toString("base64") },
          taskRoot, execution, runId: initialSource.run.id }))
        throw conflict("Native worker model-session refresh must use the exact current runner status probe");
    }
    const providerArtifactPreparation = nativePreparationPurpose === "provider_artifact";
    const nativeSessionStart = nativePreparationPurpose === "native_session_start";
    const nativeHarnessState = nativePreparationPurpose === "native_harness_state";
    const nativeWorkspacePrepare = nativePreparationPurpose === "native_workspace_prepare";
    const nativeRuntimeContextPrepare = nativePreparationPurpose === "native_runtime_context_prepare";
    const nativeRuntimeAssetErasureProbe = nativePreparationPurpose === "native_provider_data_erasure_probe";
    if (modelBrokerSessionPhase !== undefined && modelBrokerSessionPhase !== "start" &&
      modelBrokerSessionPhase !== "refresh" && modelBrokerSessionPhase !== "stop")
      throw conflict("Managed model session lifecycle phase is unsupported");
    let modelBrokerSession: {
      phase: "start" | "refresh" | "stop";
      sessionKey: string;
      nativeSessionIdDigest: string;
      runnerInstanceId: string;
      leaseId: string;
      sessionDeadlineAt: string;
      expectedCapabilityHash?: string;
      startBindingDigest?: string;
    } | undefined;
    if (modelBrokerSessionPhase) {
      const execution = conversationExecution;
      const nativeSessionId = initialSource.run.nativeSessionId;
      const runnerInstanceId = initialSource.run.runnerInstanceId;
      const sessionLeaseExpiresAt = initialSource.lease.expiresAt;
      const sessionIdentityValid = initialSource.run.status === "running" && initialSource.run.runtimeMode === "native" &&
        initialSource.run.agentId && initialSource.run.responsibleUserId && nativeSessionId && runnerInstanceId &&
        execution?.provider.kind === "opencode" && execution.session.driverKind === "opencode_server" &&
        execution.binding.companyId === input.companyId && execution.binding.runId === initialSource.run.id &&
        execution.binding.agentId === initialSource.run.agentId && execution.session.normalizedSessionId === nativeSessionId &&
        resolvePaperclipRunnerProviderProfile(initialSource.source.agent.adapterConfig)?.provider === "opencode" &&
        initialSource.sandboxBinding.backend === "openshell" && sessionLeaseExpiresAt !== null;
      if (!sessionIdentityValid) throw conflict("Managed model session is not bound to the current Native OpenCode Run and sandbox lease");
      const nativeSessionIdDigest = sha256(nativeSessionId);
      const sessionKey = nativeSha256({ companyId: input.companyId, runId: initialSource.run.id,
        attemptId: initialSource.attempt?.id ?? null, attempt, nativeSessionIdDigest, runnerInstanceId,
        leaseId: initialSource.lease.id, bindingId: initialSource.sandboxBinding.id, cellId: initialSource.cell.id,
        generation: initialSource.cell.generation.toString(),
        hostEpoch: initialSource.host.credentialVersion, manifestId: initialSource.manifest.id,
        manifestHash: initialSource.manifest.hash, policySnapshotId: initialSource.policy.id,
        policyHash: initialSource.policy.policyHash });
      const [startRecord] = modelBrokerSessionPhase === "start" ? [] : await db.select({ payload: runtimeHostCommands.payload })
        .from(runtimeHostCommands).where(and(eq(runtimeHostCommands.companyId, input.companyId),
          eq(runtimeHostCommands.runtimeCellId, initialSource.cell.id),
          eq(runtimeHostCommands.cellGeneration, initialSource.cell.generation),
          eq(runtimeHostCommands.commandType, "sandbox_exec"),
          eq(runtimeHostCommands.status, "SUCCEEDED"),
          sql`${runtimeHostCommands.payload}->'modelBrokerSession'->>'sessionKey' = ${sessionKey}`,
          sql`${runtimeHostCommands.payload}->'modelBrokerSession'->>'phase' = 'start'`))
        .orderBy(runtimeHostCommands.createdAt).limit(1);
      const startPayload = startRecord?.payload && typeof startRecord.payload === "object" && !Array.isArray(startRecord.payload)
        ? startRecord.payload as Record<string, unknown> : null;
      const priorSession = startPayload?.modelBrokerSession && typeof startPayload.modelBrokerSession === "object" &&
        !Array.isArray(startPayload.modelBrokerSession) ? startPayload.modelBrokerSession as Record<string, unknown> : null;
      const sessionCeilingAt = modelBrokerSessionPhase === "start"
        ? new Date(Math.min(initialSource.deadlineAt.getTime(),
          (initialSource.run.executionControlDeadlineAt ?? initialSource.deadlineAt).getTime(), sessionLeaseExpiresAt!.getTime()))
        : priorSession && typeof priorSession.sessionDeadlineAt === "string" && Number.isFinite(Date.parse(priorSession.sessionDeadlineAt))
          ? new Date(priorSession.sessionDeadlineAt) : null;
      if (!sessionCeilingAt || sessionCeilingAt <= now || (modelBrokerSessionPhase !== "start" &&
        (!priorSession || priorSession.sessionKey !== sessionKey || priorSession.nativeSessionIdDigest !== nativeSessionIdDigest ||
         priorSession.runnerInstanceId !== runnerInstanceId || priorSession.leaseId !== initialSource.lease.id ||
         Date.parse(sessionCeilingAt.toISOString()) > sessionLeaseExpiresAt!.getTime() ||
         sessionCeilingAt.getTime() > (initialSource.run.executionControlDeadlineAt ?? initialSource.deadlineAt).getTime())))
        throw conflict("Managed model session has no exact active start record or its original ceiling expired");
      let expectedCapabilityHash: string | undefined;
      if (modelBrokerSessionPhase !== "start") {
        const [latest] = await db.select({ safeResult: runtimeHostCommands.safeResult }).from(runtimeHostCommands)
          .where(and(eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.runtimeCellId, initialSource.cell.id),
            eq(runtimeHostCommands.cellGeneration, initialSource.cell.generation), eq(runtimeHostCommands.commandType, "sandbox_exec"),
            eq(runtimeHostCommands.status, "SUCCEEDED"),
            sql`${runtimeHostCommands.payload}->'modelBrokerSession'->>'sessionKey' = ${sessionKey}`))
          .orderBy(desc(runtimeHostCommands.createdAt)).limit(1);
        const result = latest?.safeResult && typeof latest.safeResult === "object" && !Array.isArray(latest.safeResult)
          ? latest.safeResult as Record<string, unknown> : null;
        const receipt = runtimeModelBrokerSessionReceiptSchema.safeParse(result?.modelBrokerSessionReceipt);
        if (!receipt.success || receipt.data.sessionKey !== sessionKey || Date.parse(receipt.data.expiresAt) <= now.getTime())
          throw conflict("Managed model session has no current observed provider receipt");
        expectedCapabilityHash = receipt.data.capabilityHash;
      }
      modelBrokerSession = { phase: modelBrokerSessionPhase, sessionKey, nativeSessionIdDigest,
        runnerInstanceId, leaseId: initialSource.lease.id, sessionDeadlineAt: sessionCeilingAt.toISOString(),
        ...(expectedCapabilityHash ? { expectedCapabilityHash } : {}) };
    }
    if (conversationTask.conversationAgentId !== null || conversationTask.conversationUserId !== null) {
      const contextSnapshot = initialSource.run.contextSnapshot &&
        typeof initialSource.run.contextSnapshot === "object"
        ? initialSource.run.contextSnapshot as Record<string, unknown>
        : {};
      const conversationSessionGeneration =
        typeof contextSnapshot.conversationSessionGeneration === "number"
          ? contextSnapshot.conversationSessionGeneration
          : null;
      const workspaceScope = await findNativeChatWorkspaceScope(db, {
        adapterType: initialSource.source.agent.adapterType,
        environmentDriver: "sandbox",
        companyId: input.companyId,
        agentId: initialSource.run.agentId!,
        issueId: conversationTask.id,
        runId: initialSource.run.id,
        responsibleUserId: initialSource.run.responsibleUserId,
        conversationSessionGeneration,
      });
      const expectedTaskRoot = workspaceScope && workspaceScope.projectId === null
        ? nativeChatWorkspaceCwd(workspaceScope, null, false)
        : null;
      conversationTaskRoot = expectedTaskRoot;
      const filesystem = initialSource.policy.compilation.compiledPolicy.filesystem;
      const readRoots = Array.isArray(filesystem?.readPaths) ? filesystem.readPaths : [];
      const writeRoots = Array.isArray(filesystem?.writePaths) ? filesystem.writePaths : [];
      if (!expectedTaskRoot || path.resolve(cwd) !== expectedTaskRoot ||
        !readRoots.some(root => typeof root === "string" && path.resolve(root) === expectedTaskRoot) ||
        !writeRoots.some(root => typeof root === "string" && path.resolve(root) === expectedTaskRoot))
        throw conflict("Sandbox conversation execution requires the exact private Task workspace in its current read/write policy");
    }
    const exactNativeRunnerMonitorStatus = nativeHarnessState && conversationTaskRoot && conversationExecution
      ? exactNativeRunnerMonitorStatusCommand({
        request: { argv, cwd, stdinBase64: stdinBytes.toString("base64") },
        taskRoot: conversationTaskRoot, execution: conversationExecution, runId: initialSource.run.id,
      }) : false;
    const deadlineAt = new Date(Math.min(
      initialSource.deadlineAt.getTime(),
      input.timeoutMs && input.timeoutMs > 0 ? now.getTime() + input.timeoutMs : Number.POSITIVE_INFINITY,
    ));
    if (deadlineAt <= now) throw conflict("Task execution deadline expired");
    const credentials = initialSource.policy.compilation.compiledPolicy.credentials;
    let brokerCapability: SandboxBrokerCapabilityClaim | null = null;
    let brokerCapabilityToken: string | null = null;
    let brokerProviderProfile: { id: string; hash: string } | null = null;
    let modelBrokerCredential: Pick<IssuedWorkerModelCredential,
      "expiresAt" | "inputTokensUpperBound" | "maxOutputTokens"> & {
        capabilityToken: string; profileId: string; profileHash: string;
      } | null = null;
    const runnerProfile = initialSource.source.agent.adapterType === "paperclip_runner"
      ? resolvePaperclipRunnerProviderProfile(initialSource.source.agent.adapterConfig)
      : null;
    if (nativeSessionStart && !hasConversationIdentity) {
      const execution = conversationExecution;
      const taskRoot = execution?.workspace.cwd;
      const filesystem = initialSource.policy.compilation.compiledPolicy.filesystem;
      const readRoots = Array.isArray(filesystem?.readPaths) ? filesystem.readPaths : [];
      const writeRoots = Array.isArray(filesystem?.writePaths) ? filesystem.writePaths : [];
      if ((initialSource.providerConformanceBootstrap && (!conformanceWorkspaceRoot ||
          path.resolve(conformanceWorkspaceRoot) !== path.resolve(taskRoot ?? ""))) ||
        runnerProfile?.provider !== "opencode" || initialSource.run.status !== "running" ||
        initialSource.run.runtimeMode !== "native" || !initialSource.run.agentId || !initialSource.run.responsibleUserId ||
        !initialSource.run.nativeSessionId || !initialSource.run.runnerInstanceId ||
        (!initialSource.providerConformanceBootstrap && !initialSource.attempt) ||
        (initialSource.attempt && (initialSource.attempt.runId !== initialSource.run.id || initialSource.attempt.status !== "running")) ||
        initialSource.manifest.runId !== initialSource.run.id || initialSource.manifest.agentId !== initialSource.run.agentId ||
        initialSource.manifest.manifest.responsibleUserId !== initialSource.run.responsibleUserId ||
        (initialSource.providerConformanceBootstrap && initialSource.manifest.manifest.capabilities.length !== 0) ||
        (initialSource.providerConformanceBootstrap && (credentials.mode !== "none" || credentials.bindings.length !== 0)) ||
        !execution || execution.provider.kind !== "opencode" || execution.session.driverKind !== "opencode_server" ||
        execution.session.normalizedSessionId !== initialSource.run.nativeSessionId || execution.binding.companyId !== input.companyId ||
        execution.binding.runId !== initialSource.run.id || execution.binding.agentId !== initialSource.run.agentId ||
        !taskRoot || !path.isAbsolute(taskRoot) || path.resolve(cwd) !== path.resolve(taskRoot) ||
        !readRoots.some(root => typeof root === "string" && path.resolve(root) === path.resolve(taskRoot)) ||
        !writeRoots.some(root => typeof root === "string" && path.resolve(root) === path.resolve(taskRoot)) ||
        modelBrokerSessionPhase !== "start" || managedModelPlaceholder ||
        Object.keys(env).some(key => ["PAPERCLIP_SANDBOX_BROKER_TOKEN", "PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN",
          "PAPERCLIP_SANDBOX_BROKER_SESSION_ID"].includes(key)) ||
        !exactNativeSessionLaunchCommand({ request: { argv, cwd, stdinBase64: stdinBytes.toString("base64") }, taskRoot, execution }))
        throw conflict("Native worker model-session start is outside its current signed launch and source scope");
    } else if (!initialSource.providerConformanceBootstrap &&
      (providerArtifactPreparation || nativeSessionStart || nativeHarnessState || nativeWorkspacePrepare || nativeRuntimeContextPrepare || nativeRuntimeAssetErasureProbe)) {
      const task = initialSource.source.task;
      const contextSnapshot = initialSource.run.contextSnapshot && typeof initialSource.run.contextSnapshot === "object"
        ? initialSource.run.contextSnapshot as Record<string, unknown> : {};
      if (!workerPreparationRoot && (runnerProfile?.provider !== "opencode" || task.conversationAgentId !== initialSource.run.agentId ||
        task.conversationUserId !== initialSource.run.responsibleUserId || task.conversationState !== "active" ||
        task.conversationRetiredAt !== null || task.executionRunId !== initialSource.run.id ||
        !["in_review", "in_progress"].includes(task.status) || initialSource.run.runtimeMode !== "native" ||
        initialSource.run.scopeKind !== "issue" || initialSource.run.nativeIssueId !== task.id ||
        contextSnapshot.conversationSessionGeneration !== task.conversationSessionGeneration ||
        initialSource.manifest.runId !== initialSource.run.id || initialSource.manifest.agentId !== initialSource.run.agentId ||
        initialSource.manifest.manifest.responsibleUserId !== initialSource.run.responsibleUserId))
        throw conflict("Provider artifact preparation requires the current Native conversation Run and manifest");
      if ((providerArtifactPreparation || nativeHarnessState || nativeWorkspacePrepare || nativeRuntimeContextPrepare || nativeRuntimeAssetErasureProbe) &&
        (credentials.mode !== "none" || credentials.bindings.length !== 0 || managedModelPlaceholder))
        throw conflict("Provider artifact preparation cannot receive workload credentials");
    }
    if (runnerProfile?.provider === "opencode" && modelBrokerSessionPhase !== "stop" &&
      (!nativePreparationPurpose || nativeSessionStart || (nativeHarnessState && modelBrokerSessionPhase === "refresh"))) {
      const profile = initialSource.capability.modelBrokerProviderProfile;
      if (!options.workerModels || !profile || !credentialBrokerOrigin || !managedModelBrokerOrigin)
        throw conflict("Qualified managed model broker is unavailable");
      const conversationTask = initialSource.source.task;
      const hasConversationIdentity = conversationTask.conversationAgentId !== null || conversationTask.conversationUserId !== null;
      if (hasConversationIdentity && (conversationTask.conversationAgentId !== initialSource.run.agentId ||
        conversationTask.conversationUserId !== initialSource.run.responsibleUserId ||
        conversationTask.conversationState !== "active" || conversationTask.conversationRetiredAt !== null ||
        conversationTask.conversationSessionGeneration < 0 || conversationTask.executionRunId !== initialSource.run.id ||
        !["in_review", "in_progress"].includes(conversationTask.status) || initialSource.run.scopeKind !== "issue" ||
        initialSource.run.nativeIssueId !== conversationTask.id ||
        initialSource.run.contextSnapshot?.conversationSessionGeneration !== conversationTask.conversationSessionGeneration ||
        initialSource.manifest.runId !== initialSource.run.id || initialSource.manifest.agentId !== initialSource.run.agentId ||
        initialSource.manifest.manifest.responsibleUserId !== initialSource.run.responsibleUserId))
        throw conflict("Current Native conversation Human, generation, Run and manifest are required");
      const mintInput = { companyId: input.companyId, agentId: initialSource.run.agentId!,
        runId: initialSource.run.id, responsibleUserId: initialSource.run.responsibleUserId! };
      const conformanceProbeId = initialSource.providerConformanceBootstrap
        ? initialSource.run.contextSnapshot?.nativeOpenCodeConformanceProbeId : null;
      // A conversation token is only a capability to reach the local broker.
      // The gateway still requires the persisted initial Native input receipt,
      // current source ACLs, and the current Human before it reserves or sends.
      let minted: { token: string; expiresAt: string; inputTokensUpperBound: number; maxOutputTokens: number };
      if (initialSource.providerConformanceBootstrap) {
        if (typeof conformanceProbeId !== "string")
          throw conflict("The server-created OpenCode probe id is missing");
        if (modelBrokerSessionPhase !== "start")
          throw conflict("A conformance RuntimeTools capability is limited to one initial provider turn per hidden Run");
        const issued = await options.workerModels.issueForNativeOpenCodeConformanceRun({ ...mintInput,
          qualificationGroupId: initialSource.qualificationGroupId!, planId: initialSource.conformancePlan!.id,
          probeId: conformanceProbeId! });
        minted = issued;
        const tuple = { qualificationGroupId: issued.qualificationGroupId, planId: initialSource.conformancePlan!.id,
          profileId: issued.profileId, probeId: issued.probeId, dispatchNonce: issued.dispatchNonce,
          authorityHash: issued.authorityHash };
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (tuple.qualificationGroupId !== initialSource.qualificationGroupId || tuple.planId !== initialSource.conformancePlan!.id ||
            !uuid.test(tuple.profileId) || !uuid.test(tuple.probeId) || !uuid.test(tuple.dispatchNonce) ||
            !/^[a-f0-9]{64}$/.test(tuple.authorityHash))
          throw conflict("The conformance issuer returned an invalid server-owned dispatch tuple");
        await db.transaction(async transaction => {
          const tx = transaction as unknown as Db;
          const [current] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
            eq(heartbeatRuns.id, initialSource.run.id), eq(heartbeatRuns.agentId, initialSource.run.agentId!))).for("update").limit(1);
          const context = current?.contextSnapshot && typeof current.contextSnapshot === "object" && !Array.isArray(current.contextSnapshot)
            ? current.contextSnapshot as Record<string, unknown> : null;
          if (!current || !context || current.status !== "running" || current.responsibleUserId !== initialSource.run.responsibleUserId ||
              current.triggerDetail !== "provider_conformance" || context.providerConformanceGroupId !== tuple.qualificationGroupId ||
              context.providerConformancePlanId !== tuple.planId || context.nativeOpenCodeConformanceProbeId !== tuple.probeId ||
              context.nativeOpenCodeConformanceProfileId !== tuple.profileId || context.nativeOpenCodeConformanceDispatch !== undefined)
            throw conflict("The current probe Run cannot accept a second or changed conformance dispatch tuple");
          await tx.update(heartbeatRuns).set({ contextSnapshot: { ...context, nativeOpenCodeConformanceDispatch: tuple }, updatedAt: new Date() })
            .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, current.id), eq(heartbeatRuns.status, "running")));
        });
      } else {
        const nativeReview = readNativeReviewAssignmentContext(initialSource.run.contextSnapshot);
        minted = nativeReview && !initialSource.attempt
          ? await options.workerModels.issueForReviewRun(mintInput)
          : hasConversationIdentity && !initialSource.attempt
            ? await options.workerModels.issueForConversationRun(mintInput)
            : await options.workerModels.issueForRun(mintInput);
      }
      const credentialCeiling = modelBrokerSession ? Date.parse(modelBrokerSession.sessionDeadlineAt) : deadlineAt.getTime();
      const expiresAt = new Date(Math.min(Date.parse(minted.expiresAt), credentialCeiling, initialSource.lease.expiresAt!.getTime()));
      if (expiresAt <= now) throw conflict("Managed model broker capability expired before sandbox dispatch");
      modelBrokerCredential = { capabilityToken: minted.token, profileId: profile.id, profileHash: profile.hash,
        expiresAt: expiresAt.toISOString(), inputTokensUpperBound: minted.inputTokensUpperBound,
        maxOutputTokens: minted.maxOutputTokens };
      await createRunSecretRedactionRegistry(db).register(input.companyId, initialSource.run.id, minted.token);
      env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN = managedModelBrokerOrigin;
      env.PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND = String(minted.inputTokensUpperBound);
      env.PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS = String(minted.maxOutputTokens);
    }
    if (managedModelPlaceholder && (!modelBrokerCredential || nativeHarnessState || nativeWorkspacePrepare ||
      nativeRuntimeContextPrepare || nativeRuntimeAssetErasureProbe))
      throw conflict("Managed model sentinel requires its current typed broker credential");
    if (credentials.mode === "brokered" && !nativePreparationPurpose) {
      if (credentials.bindings.length === 0) throw conflict("Brokered sandbox policy has no current credential bindings");
      brokerProviderProfile = initialSource.capability.credentialBrokerProviderProfile ?? null;
      if (!brokerProviderProfile) throw conflict("Qualified OpenShell broker provider profile is unavailable");
      const endpointOrigin = credentialBrokerOrigin;
      if (!endpointOrigin) throw conflict("Configured Paperclip MCP endpoint is unavailable for brokered credentials");
      const broker = await getAssignedMcpGateway(db).resolveSandboxCredentialBrokerBindings({
        companyId: input.companyId,
        agentId: initialSource.run.agentId!,
        runId: initialSource.run.id,
        responsibleUserId: initialSource.run.responsibleUserId!,
        presenceId: initialSource.source.runtime.id,
        bindings: credentials.bindings,
      });
      if (Object.entries(broker.authorizedConnectionGrantHashes).some(([id, hash]) => credentials.bindings.find(binding => binding.connectionId === id)?.grantVersionHash !== hash) ||
        broker.bindings.length !== credentials.bindings.length || broker.bindings.some(binding => !credentials.bindings.some(compiled => compiled.connectionId === binding.connectionId && compiled.grantVersionHash === binding.grantVersionHash)))
        throw conflict("Current assigned ToolGateway grants do not match the compiled broker policy");
      const brokerExpiresAt = new Date(Math.min(
        Date.now() + 60_000,
        Date.now() + Math.min(...credentials.bindings.map(binding => binding.ttlSeconds)) * 1000,
        deadlineAt.getTime(),
        initialSource.lease.expiresAt!.getTime(),
        (initialSource.run.executionControlDeadlineAt ?? initialSource.deadlineAt).getTime(),
      ));
      brokerCapability = {
        parentRequestId: requestId,
        bindingId: initialSource.sandboxBinding.id,
        cellId: initialSource.cell.id,
        generation: initialSource.cell.generation.toString(),
        hostId: initialSource.host.id,
        hostEpoch: initialSource.host.credentialVersion,
        runId: initialSource.run.id,
        attemptId: initialSource.attempt?.id ?? null,
        attempt: initialSource.attempt?.attempt ?? Math.max(1, initialSource.run.continuationAttempt + 1),
        manifestId: initialSource.manifest.id,
        manifestHash: initialSource.manifest.hash,
        policySnapshotId: initialSource.policy.id,
        policyHash: initialSource.policy.policyHash,
        brokerSessionId: requestId,
        endpointOrigin,
        bindings: broker.bindings,
        expiresAt: brokerExpiresAt.toISOString(),
      };
      const brokerToken = createSandboxBrokerJwt({
        agentId: initialSource.run.agentId!, companyId: input.companyId,
        adapterType: initialSource.source.agent.adapterType,
        runId: initialSource.run.id, responsibleUserId: initialSource.run.responsibleUserId,
        claim: brokerCapability,
        parentExpiresAt: initialSource.run.executionControlDeadlineAt ?? initialSource.deadlineAt,
        nativeLeaseExpiresAt: initialSource.lease.expiresAt!, execDeadlineAt: deadlineAt,
      });
      if (!brokerToken) throw conflict("Short-lived ToolGateway broker capability could not be issued");
      // A workload can print its environment. Register the attenuated token in
      // the existing per-run redaction owner before it reaches the host, and
      // only deliver buffered, redacted output to the adapter/UI.
      await createRunSecretRedactionRegistry(db).register(input.companyId, initialSource.run.id, brokerToken);
      brokerCapabilityToken = brokerToken;
      env.PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN = endpointOrigin;
      env.PAPERCLIP_SANDBOX_BROKER_SESSION_ID = requestId;
    } else if (credentials.mode !== "none" || credentials.bindings.length) {
      throw conflict("Raw or inconsistent credential policy cannot execute in a managed sandbox");
    }
    let remoteNativeSessionStartBinding: Record<string, unknown> | undefined;
    if (nativeSessionStart) {
      const locator = await readRemoteRuntimeAssetLocator(db, initialSource.run);
      if (locator) {
        if (locator.environmentLeaseId !== initialSource.lease.id ||
          locator.environmentId !== initialSource.lease.environmentId || locator.provider !== initialSource.lease.provider ||
          locator.providerLeaseId !== initialSource.lease.providerLeaseId ||
          locator.runnerInstanceId !== initialSource.run.runnerInstanceId)
          throw conflict("Native session start locator changed before signed command admission");
        remoteNativeSessionStartBinding = {
          schema: "paperclip.remote-native-session-start-binding.v1",
          locatorDigest: remoteRuntimeAssetLocatorDigest(locator),
          runnerInstanceId: locator.runnerInstanceId,
          environmentLeaseId: locator.environmentLeaseId,
          provider: locator.provider,
          providerLeaseId: locator.providerLeaseId,
          normalizedSessionIdDigest: locator.normalizedSessionIdDigest,
          hostId: initialSource.host.id,
          hostEpoch: initialSource.host.credentialVersion,
          cellId: initialSource.cell.id,
          cellGeneration: initialSource.cell.generation.toString(),
          bindingId: initialSource.sandboxBinding.id,
          manifestId: initialSource.manifest.id,
          manifestHash: initialSource.manifest.hash,
          policySnapshotId: initialSource.policy.id,
          policyHash: initialSource.policy.policyHash,
        };
      }
    }
    if (modelBrokerSession?.phase === "start" && nativeSessionStart) {
      if (!remoteNativeSessionStartBinding)
        throw conflict("Managed Native session Start has no exact original retained start binding");
      // Bind the original server-owned object, not the session-key domain or
      // any caller-supplied field. The descriptor is included in commandDigest.
      modelBrokerSession.startBindingDigest = nativeSha256(remoteNativeSessionStartBinding);
    }
    const commandDigest = nativeSha256({ argv, cwd, env, stdinHash: sha256(stdinBytes), timeoutDeadline: deadlineAt.toISOString(),
      brokerCapabilityHash: brokerCapabilityToken ? sha256(brokerCapabilityToken) : null,
      brokerProviderProfile: brokerProviderProfile ? { id: brokerProviderProfile.id, hash: brokerProviderProfile.hash } : null,
      modelBrokerCapabilityHash: modelBrokerCredential ? sha256(modelBrokerCredential.capabilityToken) : null,
      modelBrokerProviderProfile: modelBrokerCredential ? { id: modelBrokerCredential.profileId, hash: modelBrokerCredential.profileHash } : null,
      modelBrokerSession: modelBrokerSession ?? null });
    const prepared = await db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      const source = await executionSandboxService(tx, { runtimeSuspectSeconds: config.runtime.suspectSeconds }).assertTaskExecutionContext(tx, {
        companyId: input.companyId, runId: input.runId!, leaseId: input.leaseId, now: new Date(),
      });
      if (!source || source.run.id !== initialSource.run.id || source.source.record.hash !== initialSource.source.record.hash ||
        source.sandboxBinding.id !== initialSource.sandboxBinding.id || source.cell.generation !== initialSource.cell.generation ||
        source.policy.id !== initialSource.policy.id || source.policy.policyHash !== initialSource.policy.policyHash ||
        source.deadlineAt < deadlineAt) throw conflict("Sandbox execution source changed before claim admission");
      const [unresolvedExec] = await tx.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.companyId, input.companyId),
        eq(runtimeHostCommands.runtimeCellId, source.cell.id),
        eq(runtimeHostCommands.cellGeneration, source.cell.generation),
        eq(runtimeHostCommands.commandType, "sandbox_exec"),
        inArray(runtimeHostCommands.status, ["PENDING", "CLAIMED"]),
        sql`${runtimeHostCommands.payload}->>'runId' = ${source.run.id}`,
        sql`${runtimeHostCommands.payload}->>'attempt' = ${String(attempt)}`,
      )).for("update");
      if (unresolvedExec) throw conflict("A previous sandbox execution on this Task attempt has an unknown outcome");
      if (modelBrokerSession) {
        const matchingSessionCommands = await tx.select({ safeResult: runtimeHostCommands.safeResult,
          payload: runtimeHostCommands.payload }).from(runtimeHostCommands).where(and(
          eq(runtimeHostCommands.companyId, input.companyId), eq(runtimeHostCommands.runtimeCellId, source.cell.id),
          eq(runtimeHostCommands.cellGeneration, source.cell.generation), eq(runtimeHostCommands.commandType, "sandbox_exec"),
          sql`${runtimeHostCommands.payload}->'modelBrokerSession'->>'sessionKey' = ${modelBrokerSession.sessionKey}`,
          ...(modelBrokerSession.phase === "start" ? [] : [eq(runtimeHostCommands.status, "SUCCEEDED")]),
        )).orderBy(desc(runtimeHostCommands.createdAt)).limit(1).for("update");
        const prior = matchingSessionCommands[0];
        if (modelBrokerSession.phase === "start") {
          if (prior) throw conflict("Managed model provider session already has a start command");
        } else {
          const safe = prior?.safeResult && typeof prior.safeResult === "object" && !Array.isArray(prior.safeResult)
            ? prior.safeResult as Record<string, unknown> : null;
          const receipt = runtimeModelBrokerSessionReceiptSchema.safeParse(safe?.modelBrokerSessionReceipt);
          const priorPayload = prior?.payload && typeof prior.payload === "object" && !Array.isArray(prior.payload)
            ? prior.payload as Record<string, unknown> : null;
          const priorSession = priorPayload?.modelBrokerSession && typeof priorPayload.modelBrokerSession === "object" &&
            !Array.isArray(priorPayload.modelBrokerSession) ? priorPayload.modelBrokerSession as Record<string, unknown> : null;
          if (!receipt.success || receipt.data.sessionKey !== modelBrokerSession.sessionKey ||
            receipt.data.capabilityHash !== modelBrokerSession.expectedCapabilityHash || !priorSession ||
            priorSession.sessionDeadlineAt !== modelBrokerSession.sessionDeadlineAt ||
            (modelBrokerSession.phase === "refresh" && priorSession.phase === "stop") ||
            (modelBrokerSession.phase === "stop" && priorSession.phase !== "stop" && priorSession.phase !== "refresh" && priorSession.phase !== "start"))
            throw conflict("Managed model session changed before its provider transition claim");
        }
      }
      let currentRemoteNativeSessionStartBinding: Record<string, unknown> | undefined;
      if (nativeSessionStart) {
        const locator = await readRemoteRuntimeAssetLocator(tx, source.run);
        if (locator && locator.environmentLeaseId === source.lease.id &&
          locator.environmentId === source.lease.environmentId && locator.provider === source.lease.provider &&
          locator.providerLeaseId === source.lease.providerLeaseId &&
          locator.runnerInstanceId === source.run.runnerInstanceId) {
          currentRemoteNativeSessionStartBinding = {
            schema: "paperclip.remote-native-session-start-binding.v1",
            locatorDigest: remoteRuntimeAssetLocatorDigest(locator),
            runnerInstanceId: locator.runnerInstanceId,
            environmentLeaseId: locator.environmentLeaseId,
            provider: locator.provider,
            providerLeaseId: locator.providerLeaseId,
            normalizedSessionIdDigest: locator.normalizedSessionIdDigest,
            hostId: source.host.id,
            hostEpoch: source.host.credentialVersion,
            cellId: source.cell.id,
            cellGeneration: source.cell.generation.toString(),
            bindingId: source.sandboxBinding.id,
            manifestId: source.manifest.id,
            manifestHash: source.manifest.hash,
            policySnapshotId: source.policy.id,
            policyHash: source.policy.policyHash,
          };
        }
      }
      if (nativeSha256(currentRemoteNativeSessionStartBinding ?? null) !==
        nativeSha256(remoteNativeSessionStartBinding ?? null))
        throw conflict("Native session start locator or target changed before signed claim persistence");
      const desiredState = {
        kind: "sandbox_exec_v1", requestId, bindingId: source.sandboxBinding.id,
        cellId: source.cell.id, generation: source.cell.generation.toString(), hostId: source.host.id,
        hostEpoch: source.host.credentialVersion, runId: source.run.id, attemptId: source.attempt?.id ?? null,
        attempt, leaseId: source.lease.id, manifestId: source.manifest.id, manifestHash: source.manifest.hash,
        policySnapshotId: source.policy.id, policyHash: source.policy.policyHash,
        commandDigest, deadlineAt: deadlineAt.toISOString(),
        ...(nativePreparationPurpose ? { nativePreparationPurpose } : {}),
        ...(modelBrokerSession ? { modelBrokerSession } : {}),
        ...(currentRemoteNativeSessionStartBinding ? { remoteNativeSessionStartBinding: currentRemoteNativeSessionStartBinding } : {}),
      };
      const [claim] = await tx.insert(runtimeHostCommands).values({
        runtimeHostId: source.host.id, companyId: input.companyId, runtimeCellId: source.cell.id,
        cellGeneration: source.cell.generation, commandType: "sandbox_exec",
        idempotencyKey: requestId, payload: desiredState,
        deadlineAt, notBefore: now,
      }).returning();
      if (!claim) throw conflict("Sandbox execution claim could not be persisted");
      return { source, claim, requestId, commandDigest, attempt, deadlineAt, argv, cwd, env, stdinBytes,
        exactNativeRunnerMonitorStatus,
        ...(brokerCapabilityToken && brokerProviderProfile && brokerCapability ? { brokerCredential: {
          capabilityToken: brokerCapabilityToken, profileId: brokerProviderProfile.id,
          profileHash: brokerProviderProfile.hash, expiresAt: brokerCapability.expiresAt,
        } } : {}),
        ...(modelBrokerCredential ? { modelBrokerCredential } : {}),
      };
    });
    if (!prepared) return null;
    const source = prepared.source;
    const claim = prepared.claim;
    const request = {
      requestId: prepared.requestId,
      bindingId: source.sandboxBinding.id,
      hostEpoch: source.host.credentialVersion,
      runId: source.run.id,
      attemptId: source.attempt?.id ?? null,
      attempt,
      manifestId: source.manifest.id,
      manifestHash: source.manifest.hash,
      policySnapshotId: source.policy.id,
      policyHash: source.policy.policyHash,
      commandDigest,
      deadlineAt: deadlineAt.toISOString(),
      sandboxRef: source.sandboxBinding.sandboxRef ?? `aw-v7-${source.sandboxBinding.id}`,
      imageDigest: source.cell.activeImageDigest ?? source.cell.desiredImageDigest,
      argv: prepared.argv,
      cwd: prepared.cwd,
      env: prepared.env,
      ...(brokerCapabilityToken && brokerProviderProfile && brokerCapability ? { brokerCredential: {
        capabilityToken: brokerCapabilityToken, profileId: brokerProviderProfile.id,
        profileHash: brokerProviderProfile.hash, expiresAt: brokerCapability.expiresAt,
      } } : {}),
      ...(modelBrokerCredential ? { modelBrokerCredential } : {}),
      ...(modelBrokerSession ? { modelBrokerSession } : {}),
      stdinBase64: prepared.stdinBytes.toString("base64"),
    };
    const capabilityToken = createSandboxExecJwt({
      agentId: source.run.agentId!, companyId: input.companyId, adapterType: source.source.agent.adapterType,
      runId: source.run.id, responsibleUserId: source.run.responsibleUserId,
      claim: {
        requestId: prepared.requestId, bindingId: source.sandboxBinding.id, cellId: source.cell.id,
        generation: source.cell.generation.toString(), hostId: source.host.id, hostEpoch: source.host.credentialVersion,
        runId: source.run.id, attemptId: source.attempt?.id ?? null, attempt,
        manifestId: source.manifest.id, manifestHash: source.manifest.hash, policySnapshotId: source.policy.id,
        policyHash: source.policy.policyHash, commandDigest, deadlineAt: deadlineAt.toISOString(),
      },
      parentExpiresAt: source.run.executionControlDeadlineAt ?? source.deadlineAt,
      nativeLeaseExpiresAt: source.lease.expiresAt!,
    });
    if (!capabilityToken) {
      await db.update(runtimeHostCommands).set({ status: "FAILED", errorCode: "exec_capability_unavailable", completedAt: new Date() })
        .where(and(eq(runtimeHostCommands.id, claim.id), eq(runtimeHostCommands.status, "PENDING")));
      throw conflict("Short-lived sandbox execution capability could not be issued");
    }
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let outputBytes = 0;
    const brokerTokenForRedaction = prepared.brokerCredential?.capabilityToken ?? null;
    const modelBrokerTokenForRedaction = prepared.modelBrokerCredential?.capabilityToken ?? null;
    const outputTail: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };
    const assertCurrentOutputAuthority = async () => db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      const current = await executionSandboxService(tx, { runtimeSuspectSeconds: config.runtime.suspectSeconds }).assertTaskExecutionContext(tx, {
        companyId: input.companyId, runId: source.run.id, leaseId: source.lease.id, now: new Date(),
      });
      const [claimStillActive] = await tx.select({ id: runtimeHostCommands.id }).from(runtimeHostCommands).where(and(
        eq(runtimeHostCommands.id, claim.id), eq(runtimeHostCommands.status, "CLAIMED"), gt(runtimeHostCommands.deadlineAt, new Date()),
      )).limit(1);
      if (!claimStillActive || !current || current.run.agentId !== source.run.agentId ||
        current.run.responsibleUserId !== source.run.responsibleUserId || current.sandboxBinding.id !== source.sandboxBinding.id ||
        current.cell.id !== source.cell.id || current.cell.generation !== source.cell.generation || current.host.id !== source.host.id ||
        current.host.credentialVersion !== source.host.credentialVersion || current.manifest.id !== source.manifest.id ||
        current.manifest.hash !== source.manifest.hash || current.policy.id !== source.policy.id ||
        current.policy.policyHash !== source.policy.policyHash || current.deadlineAt < new Date())
        throw conflict("Sandbox execution authority changed before output delivery");
      if (brokerCapability) {
        const credentials = current.policy.compilation.compiledPolicy.credentials;
        if (credentials.mode !== "brokered" || credentials.bindings.length === 0)
          throw conflict("Sandbox broker policy changed before output delivery");
        const resolved = await getAssignedMcpGateway(db, tx).resolveSandboxCredentialBrokerBindings({
          companyId: input.companyId, agentId: current.run.agentId!, runId: current.run.id,
          responsibleUserId: current.run.responsibleUserId!, presenceId: current.source.runtime.id,
          bindings: credentials.bindings,
        });
        if (resolved.bindings.length !== brokerCapability.bindings.length || nativeSha256(resolved.bindings) !== nativeSha256(brokerCapability.bindings) ||
          credentials.bindings.some(binding => resolved.authorizedConnectionGrantHashes[binding.connectionId] !== binding.grantVersionHash))
          throw conflict("Sandbox broker grants changed before output delivery");
      }
    });
    const deliverOutput = async (stream: "stdout" | "stderr", chunk: string, final = false) => {
      if (!input.onOutput) return;
      const redactionTokens = [brokerTokenForRedaction, modelBrokerTokenForRedaction].filter((value): value is string => Boolean(value));
      if (!redactionTokens.length) {
        if (chunk) await input.onOutput(stream, chunk);
        return;
      }
      const combined = outputTail[stream] + chunk;
      let safeEnd = final ? combined.length : Math.max(0, combined.length - Math.max(...redactionTokens.map(token => token.length)) + 1);
      if (!final) for (const token of redactionTokens) {
        let found = combined.indexOf(token);
        while (found >= 0 && found < safeEnd) {
          if (found + token.length > safeEnd) safeEnd = found;
          found = combined.indexOf(token, found + token.length);
        }
      }
      const safe = redactionTokens.reduce((text, token) => text.split(token).join(REDACTED_EVENT_VALUE), combined.slice(0, safeEnd));
      outputTail[stream] = combined.slice(safeEnd);
      if (safe) await input.onOutput(stream, safe);
    };
    try {
      const result = await relay.executeOpenShell({
        cellId: source.cell.id,
        generation: source.cell.generation.toString(),
        request,
        capabilityToken,
        signal: input.signal,
        onOutput: async (stream, chunk) => {
          await assertCurrentOutputAuthority();
          outputBytes += chunk.length;
          if (outputBytes > 64 * 1024 * 1024) throw conflict("Sandbox output exceeded its bounded stream limit");
          (stream === "stdout" ? stdout : stderr).push(chunk);
          await deliverOutput(stream, chunk.toString("utf8"));
        },
      });
      let modelBrokerSessionReceipt: import("@paperclipai/shared").RuntimeModelBrokerSessionReceipt | undefined;
      if (modelBrokerSession) {
        const receipt = runtimeModelBrokerSessionReceiptSchema.safeParse(result.modelBrokerSessionReceipt);
        const latestHash = modelBrokerSession.phase === "start" ? sha256(modelBrokerCredential?.capabilityToken ?? "") :
          modelBrokerSession.expectedCapabilityHash;
        const nextHash = modelBrokerCredential ? sha256(modelBrokerCredential.capabilityToken) : null;
        if (!receipt.success || receipt.data.sessionKey !== modelBrokerSession.sessionKey ||
          (modelBrokerSession.phase === "start" && receipt.data.capabilityHash !== nextHash) ||
          (modelBrokerSession.phase === "refresh" && receipt.data.capabilityHash !== latestHash && receipt.data.capabilityHash !== nextHash) ||
          (modelBrokerSession.phase === "stop" && receipt.data.capabilityHash !== latestHash) ||
          Date.parse(receipt.data.expiresAt) > Date.parse(modelBrokerSession.sessionDeadlineAt) ||
          (modelBrokerSession.phase !== "stop" && Date.parse(receipt.data.expiresAt) <= Date.now()))
          throw conflict("Managed model provider session receipt did not match its signed transition");
        modelBrokerSessionReceipt = receipt.data;
      }
      await deliverOutput("stdout", "", true);
      await deliverOutput("stderr", "", true);
      const redacted = await createRunSecretRedactionRegistry(db).redactForRun(input.companyId, source.run.id, {
        stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"),
      });
      const returned = await db.transaction(async transaction => {
        const tx = transaction as unknown as Db;
        const current = await executionSandboxService(tx, { runtimeSuspectSeconds: config.runtime.suspectSeconds }).assertTaskExecutionContext(tx, {
          companyId: input.companyId, runId: source.run.id, leaseId: source.lease.id, now: new Date(),
        });
        if (!current || current.run.agentId !== source.run.agentId || current.sandboxBinding.id !== source.sandboxBinding.id ||
          current.cell.id !== source.cell.id || current.cell.generation !== source.cell.generation || current.host.id !== source.host.id ||
          current.manifest.id !== source.manifest.id || current.manifest.hash !== source.manifest.hash ||
          current.policy.id !== source.policy.id || current.policy.policyHash !== source.policy.policyHash ||
          current.deadlineAt < new Date()) throw conflict("Sandbox execution authority changed before result delivery");
        const [completed] = await tx.update(runtimeHostCommands).set({
          status: "SUCCEEDED", completedAt: new Date(), safeResult: { exitCode: result.exitCode, timedOut: result.timedOut,
            ...(modelBrokerSessionReceipt ? { modelBrokerSessionReceipt } : {}) },
        }).where(and(eq(runtimeHostCommands.id, claim.id), eq(runtimeHostCommands.status, "CLAIMED"))).returning({ id: runtimeHostCommands.id });
        return completed ?? null;
      });
      if (!returned) throw conflict("Sandbox execution claim was fenced before result delivery");
      return { exitCode: result.exitCode, signal: null, timedOut: result.timedOut, stdout: redacted.stdout, stderr: redacted.stderr,
        ...(modelBrokerSessionReceipt ? { modelBrokerSessionReceipt } : {}) };
    } catch (error) {
      const code = error instanceof Error && ["exec_timeout", "exec_unknown", "runtime_unavailable", "policy_changed", "exec_rejected"].includes(error.message)
        ? error.message : "exec_unknown";
      await db.update(runtimeHostCommands).set({ status: "FAILED", completedAt: new Date(), errorCode: code })
        .where(and(eq(runtimeHostCommands.id, claim.id), eq(runtimeHostCommands.status, "PENDING")));
      if (nativeRelayClaimFailureStatus("CLAIMED", prepared.exactNativeRunnerMonitorStatus) === "FAILED") {
        await db.update(runtimeHostCommands).set({ status: "FAILED", completedAt: new Date(), errorCode: code })
          .where(and(eq(runtimeHostCommands.id, claim.id), eq(runtimeHostCommands.status, "CLAIMED")));
        throw new Error("runner_process_status_unavailable", { cause: error });
      }
      await db.update(runtimeHostCommands).set({ errorCode: code })
        .where(and(eq(runtimeHostCommands.id, claim.id), eq(runtimeHostCommands.status, "CLAIMED")));
      throw error;
    }
  }
  // A broken broker setting must not disable non-paid control/Stop. Only an
  // explicit canonical HTTPS origin can earn an enforcement-owner brand.
  try {
    const raw=options.credentialBrokerOrigin;
    const origin=new URL(raw ?? "");
    if(origin.protocol === "https:" && !origin.username && !origin.password && !origin.search && !origin.hash &&
        origin.pathname === "/" && (raw === origin.origin || raw === `${origin.origin}/`) &&
        credentialBrokerOrigin === `${origin.origin}/`) {
      sandboxBrokerAuthorityOwners.set(authorizeSandboxBrokerCapability,Object.freeze({
        protocol:"sandbox_exec_v1",origin:origin.origin,
      }));
    }
  } catch { /* Invalid or unknown broker settings earn no authority metadata. */ }
  return {
    auth,
    backups,
    relay,
    getCell,
    executeSandboxTask,
    eraseRemoteNativeRuntimeAsset,
    authorizeSandboxBrokerCapability,
    create,
    request,
    assertSandboxStartAdmission,
    recordSandboxWorkloadState,
    stopSandboxRunLeaseForCleanup,
    dispatchOne,
    claim,
    renew,
    complete,
    heartbeat,
    recoveryCommands,
    recordRecovery,
    reconcileCommands,
    configureModel,
    bind,
    cancelUnplacedForDeletion,
    list,
  };
}
