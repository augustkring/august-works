import { hostVersionMeetsMinimum } from "./catalog.js";
import { runtimeCommercialReason } from "./commercial.js";
import type { NotifyCompany } from "../notifications/notifications.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  and,
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
} from "@paperclipai/shared";
import type { z } from "zod";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
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
import { executionSandboxService } from "../execution-sandbox/sandbox-service.js";
import { getAssignedMcpGateway } from "../native-runtime/assigned-mcp-tools.js";
import { createRunSecretRedactionRegistry } from "../run-secret-redaction.js";
import { REDACTED_EVENT_VALUE } from "../../redaction.js";
import { resolvePaperclipRunnerProviderProfile } from "../native-runtime/provider-profile.js";
import type { workerModelGateway } from "../orchestration/worker-model-gateway.js";
import { verifyRuntimeToolsToken } from "../../runtime-tools-token.js";
import { findNativeChatWorkspaceScope, nativeChatWorkspaceCwd } from "../native-runtime/native-chat-workspace.js";
import { assertNativePayloadSourceSetCurrent, assertNativeTaskSourceOwnerCurrent } from "../native-direct-input.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";

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
function configuredPaperclipEndpointOrigin(raw: string | undefined): string | null {
  raw = raw?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !["", "/", "/api", "/api/"].includes(url.pathname)) return null;
    return `${url.protocol}//${url.host}/`;
  } catch {
    return null;
  }
}

function exactNativeHarnessStateCommand(input: {
  request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest;
  taskRoot: string;
  execution: ReturnType<typeof parseNativeExecutionInput>;
  runId: string;
}): boolean {
  if (input.execution.provider.kind !== "opencode" || input.execution.session.driverKind !== "opencode_server") return false;
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
  const read = (file: string) => matches("sh", "-c", `test -f ${quote(file)} && base64 < ${quote(file)}`);
  const inspect = [
    `test -f ${quote(runnerState)}`,
    `test -d ${quote(filesystemDir)}`,
    `test -f ${quote(providerState)}`,
    `base64 < ${quote(runnerState)}`,
  ].join(" && ");
  const materialize = `umask 077; install -d -m 0700 ${quote(filesystemDir)}`;
  if (input.request.cwd !== input.taskRoot || input.request.stdinBase64 !== "") return false;
  if (read(runnerState) || read(providerState) || matches("sh", "-c", inspect) || matches("sh", "-c", materialize)) return true;
  if (matches("sh", "-c", 'test -f "$1" && test ! -L "$1" && cat -- "$1"',
    "paperclip-runner-process-identity", processIdentity)) return true;
  const identityCheck = 'set -eu; identity_path=$1; expected_nonce=$2; expected_runner_id=$3; expected_pid=$4; test -f "$identity_path" && test ! -L "$identity_path" || exit 3; { IFS= read -r nonce; IFS= read -r pid; IFS= read -r started_at; IFS= read -r runner_id; } < "$identity_path"; test "$nonce" = "$expected_nonce" && test "$runner_id" = "$expected_runner_id" && test "$pid" = "$expected_pid" && test -n "$started_at" || exit 4; kill -0 "$pid" 2>/dev/null || exit 3; if test -r "/proc/$pid/cmdline"; then command_line=$(tr "\\000" "\\n" < "/proc/$pid/cmdline"); printf "%s\\n" "$command_line" | grep -Fqx -- "--runner-id" || exit 4; printf "%s\\n" "$command_line" | grep -Fqx -- "$expected_runner_id" || exit 4; fi';
  if (argv.length === 8 && argv[0] === "sh" && argv[1] === "-c" && argv[2] === identityCheck &&
    argv[3] === "paperclip-runner-monitor" && argv[4] === processIdentity &&
    /^[0-9a-f-]{36}$/i.test(argv[5] ?? "") && /^[0-9a-f-]{36}$/i.test(argv[6] ?? "") &&
    /^[1-9][0-9]{0,9}$/.test(argv[7] ?? "")) return true;
  const diagnostics = 'set -eu; directory=$1; file="$directory/runnerd.stderr.log"; test -d "$directory" && test ! -L "$directory" && test -f "$file" && test ! -L "$file"; tail -c 65536 -- "$file"';
  return matches("sh", "-c", diagnostics, "paperclip-runner-diagnostics", diagnosticsDir);
}

function exactNativeSessionLaunchCommand(input: {
  request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest;
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
  const childScript = 'set -eu; identity_path=$1; identity_nonce=$2; runner_instance_id=$3; diagnostics_directory=$4; shift 4; umask 077; test ! -L "$diagnostics_directory"; if test -e "$diagnostics_directory"; then test -d "$diagnostics_directory"; else mkdir -p -- "$diagnostics_directory"; fi; chmod 0700 "$diagnostics_directory"; started_at=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ"); pid=$$; process_fingerprint=""; if process_fingerprint=$(node -e \'const fs=require("node:fs");try{const stat=fs.readFileSync("/proc/"+process.argv[1]+"/stat","utf8");const end=stat.lastIndexOf(") ");const ticks=stat.slice(end+2).trim().split(/\\s+/)[19];const boot=fs.readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim();if(end<0||!/^\\d+$/.test(ticks||"")||!/^[-a-fA-F0-9]+$/.test(boot))process.exit(4);process.stdout.write("linux:"+boot+":"+ticks)}catch{process.exit(4)}\' "$pid"); then :; else process_fingerprint=""; fi; identity_tmp="${identity_path}.tmp.$$"; printf "%s\\n%s\\n%s\\n%s\\n%s\\n" "$identity_nonce" "$$" "$started_at" "$runner_instance_id" "$process_fingerprint" > "$identity_tmp"; chmod 0600 "$identity_tmp"; mv -f -- "$identity_tmp" "$identity_path"; exec "$@"';
  const argv = input.request.argv;
  return input.request.cwd === input.taskRoot && input.request.stdinBase64 === "" && argv.length >= 10 &&
    argv[0] === "sh" && argv[1] === "-c" && argv[2] === childLaunch && argv[3] === "paperclip-runner-launch" &&
    argv[4] === processIdentity && /^[0-9a-f-]{36}$/i.test(argv[5] ?? "") && /^[0-9a-f-]{36}$/i.test(argv[6] ?? "") &&
    argv[7] === childScript && argv[8] === diagnosticsDir && argv[9] === runnerBinary;
}

function exactNativeWorkspacePrepareCommand(input: {
  request: import("@paperclipai/shared").RuntimeSandboxExecRelayRequest;
  taskRoot: string;
  execution: ReturnType<typeof parseNativeExecutionInput>;
}): boolean {
  if (input.execution.provider.kind !== "opencode" || input.execution.session.driverKind !== "opencode_server" ||
    input.request.cwd !== input.taskRoot) return false;
  const runtimeRoot = path.posix.join(input.taskRoot, ".paperclip-runtime", "paperclip-runner");
  const archive = path.posix.join(runtimeRoot, "workspace-upload.tar");
  const tempPrefix = `${archive}.paperclip-upload.`;
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const { argv, stdinBase64 } = input.request;
  if (argv.length !== 3 || argv[0] !== "sh" || argv[1] !== "-c") return false;
  const script = argv[2];
  const matchesTemp = (value: string | undefined): string | null => {
    if (!value) return null;
    if (!value.startsWith(tempPrefix)) return null;
    const suffix = value.slice(tempPrefix.length);
    return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(suffix) ? value : null;
  };
  const emptyInput = stdinBase64 === "";
  const initMatch = /^mkdir -p '([^']+)' && rm -f '([^']+)' && : > '([^']+)'$/.exec(script);
  const appendMatch = /^base64 -d >> '([^']+)'$/.exec(script);
  const commitMatch = /^mv -f '([^']+)' '([^']+)'$/.exec(script);
  const removeMatch = /^rm -rf '([^']+)'$/.exec(script);
  const tempPath = matchesTemp(initMatch?.[2] ?? appendMatch?.[1] ?? commitMatch?.[1] ?? removeMatch?.[1]);
  if (tempPath && (tempPath.includes("'") || tempPath.includes("\n"))) return false;
  const init = tempPath && `mkdir -p ${quote(runtimeRoot)} && rm -f ${quote(tempPath)} && : > ${quote(tempPath)}`;
  const append = tempPath && `base64 -d >> ${quote(tempPath)}`;
  const commit = tempPath && `mv -f ${quote(tempPath)} ${quote(archive)}`;
  const tempCleanup = tempPath && `rm -rf ${quote(tempPath)}`;
  const extract = `mkdir -p ${quote(input.taskRoot)} && find ${quote(input.taskRoot)} -mindepth 1 -maxdepth 1 ! -name '.paperclip-runtime' ! -name '.paperclip-upload-*' -exec rm -rf -- {} + && tar -xf ${quote(archive)} -C ${quote(input.taskRoot)} && rm -f ${quote(archive)}`;
  const validChunk = stdinBase64.length > 0 && stdinBase64.length <= 6 * 1024 * 1024 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(stdinBase64) && Buffer.from(stdinBase64, "base64").toString("base64") === stdinBase64 &&
    (() => {
      const chunk = Buffer.from(stdinBase64, "base64").toString("utf8");
      return chunk.length <= 4 * 1024 * 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(chunk) &&
        Buffer.from(chunk, "base64").toString("base64") === chunk && Buffer.from(chunk, "base64").length <= 3 * 1024 * 1024;
    })();
  if (((!!tempPath && (script === init || script === commit || script === tempCleanup)) || script === extract) && emptyInput)
    return true;
  if (append && script === append && validChunk) return true;
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
  }) {
    const now = input.now ?? new Date();
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
    if (!cell || !binding || String(binding.status) !== (input.action === "start" ? "admitting" : "stopping") || String(binding.cell_generation) !== input.generation || !command)
      throw conflict("Signed sandbox workload receipt is no longer current");
    const payload = command.payload as Record<string, any>;
    const reply = command.safeResult as Record<string, any> | null;
    if (payload.action !== input.action || payload.scope?.bindingId !== input.bindingId || payload.scope?.companyId !== input.companyId || payload.scope?.cellId !== input.cellId || payload.scope?.cellGeneration !== input.generation || reply?.action !== input.action || (input.action === "start" ? reply.started !== true || reply.policyHash !== input.policyHash : reply.stopped !== true))
      throw conflict("Signed sandbox workload receipt does not match the requested state transition");
    if (input.action === "start" && (cell.status !== "STOPPED" || payload.start?.policyHash !== input.policyHash || payload.start?.idempotencyKey !== `v7-sandbox-start:${input.bindingId}:${input.generation}:${input.policySnapshotId}`))
      throw conflict("Sandbox Start receipt is not bound to the current stopped-cell admission");
    const [claim] = await tx.select({ id: activityLog.id }).from(activityLog).where(and(
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
    const operationId = randomUUID();
    const requestHash = input.action === "stop" && input.idempotencyKey
      ? sha256(JSON.stringify({ cellId: input.cellId, action: "stop", idempotencyKey: input.idempotencyKey }))
      : sha256(JSON.stringify({ sandboxBindingId: input.bindingId, generation: input.generation, hostCommandId: input.hostCommandId, claimKey: input.claimKey, policySnapshotId: input.policySnapshotId, action: input.action }));
    const [operation] = await tx.insert(runtimeOperations).values({
      id: operationId, companyId: input.companyId, runtimeCellId: input.cellId,
      operationType: input.action, status: "SUCCEEDED", requestedByType: "user", requestedById: input.userId,
      idempotencyKey: input.idempotencyKey ?? `sandbox-${input.action}:${input.bindingId}:${input.generation}:${input.hostCommandId}`,
      requestHash,
      desiredState: { sandboxAdmission: true, sandboxBindingId: input.bindingId, generation: input.generation, sandboxHostCommandId: input.hostCommandId, claimKey: input.claimKey, policySnapshotId: input.policySnapshotId, executionManifestId: input.executionManifestId, executionManifestHash: input.executionManifestHash, policyHash: input.policyHash },
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
      companyId: input.companyId, actorType: "user", actorId: input.userId,
      action: input.action === "start" ? "runtime.sandbox_workload_started" : "runtime.sandbox_workload_stopped",
      entityType: "runtime_cell", entityId: input.cellId,
      details: { operationId: operation.id, sandboxBindingId: input.bindingId, sandboxHostCommandId: input.hostCommandId, generation: input.generation },
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
        expected.commandDigest !== request.commandDigest || expected.deadlineAt !== request.deadlineAt)
        throw forbidden("Sandbox execution claim is missing, expired, or already consumed");
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
      const credentials = source.policy.compilation.compiledPolicy.credentials;
      const brokerCredential = request.brokerCredential;
      const nativePreparationPurpose = expected.nativePreparationPurpose;
      if (nativePreparationPurpose !== undefined && nativePreparationPurpose !== "provider_artifact" &&
        nativePreparationPurpose !== "native_session_start" && nativePreparationPurpose !== "native_harness_state" &&
        nativePreparationPurpose !== "native_workspace_prepare")
        throw forbidden("Sandbox preparation purpose is unsupported");
      const providerArtifactPreparation = nativePreparationPurpose === "provider_artifact";
      const nativeSessionStart = nativePreparationPurpose === "native_session_start";
      const nativeHarnessState = nativePreparationPurpose === "native_harness_state";
      const nativeWorkspacePrepare = nativePreparationPurpose === "native_workspace_prepare";
      let nativeSessionStartValid = false;
      let nativeHarnessStateValid = false;
      if (providerArtifactPreparation) {
        const task = source.source.task;
        const taskSnapshot = nativePayloadSourceSnapshotSchema.safeParse(task.payloadSourceSnapshot);
        const [taskOwnerVersion] = await tx.select({ sourceVersion: sql<string>`extract(epoch from ${issues.updatedAt})::text` })
          .from(issues).where(and(eq(issues.companyId, claims.company_id), eq(issues.id, task.id))).limit(1);
        const contextSnapshot = source.run.contextSnapshot && typeof source.run.contextSnapshot === "object" &&
          !Array.isArray(source.run.contextSnapshot) ? source.run.contextSnapshot as Record<string, unknown> : {};
        const generation = typeof contextSnapshot.conversationSessionGeneration === "number"
          ? contextSnapshot.conversationSessionGeneration : null;
        const workspaceScope = generation !== null ? await findNativeChatWorkspaceScope(db, {
          adapterType: source.source.agent.adapterType, environmentDriver: "sandbox", companyId: claims.company_id,
          agentId: source.run.agentId!, issueId: task.id, runId: source.run.id,
          responsibleUserId: source.run.responsibleUserId, conversationSessionGeneration: generation,
        }) : null;
        const expectedTaskRoot = workspaceScope?.projectId === null ? nativeChatWorkspaceCwd(workspaceScope, null, false) : null;
        const filesystem = source.policy.compilation.compiledPolicy.filesystem;
        const readRoots = Array.isArray(filesystem?.readPaths) ? filesystem.readPaths : [];
        const writeRoots = Array.isArray(filesystem?.writePaths) ? filesystem.writePaths : [];
        const noCredentialEnvironment = !Object.keys(request.env ?? {}).some(key => [
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
      if (nativeSessionStart || nativeHarnessState || nativeWorkspacePrepare) {
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
        const workspaceScope = generation !== null ? await findNativeChatWorkspaceScope(db, {
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
        const exactCurrentComment = snapshotComment?.success && snapshotComment.data.kind === "comment" &&
          snapshotComment.data.issueId === task.id && commentId === snapshotComment.data.commentId &&
          contextSnapshot.wakeCommentId === commentId && markdownMap.version === 1 &&
          typeof markdownMap.renderedMarkdownDigest === "string" && /^[a-f0-9]{64}$/.test(markdownMap.renderedMarkdownDigest) &&
          renderedMarkdownLength !== null && execution !== null &&
          execution.task.prompt.length >= renderedMarkdownLength &&
          sha256(execution.task.prompt.slice(-renderedMarkdownLength)) === markdownMap.renderedMarkdownDigest &&
          markdownReferences.some(reference => reference.kind === "task" && reference.id === task.id) &&
          markdownReferences.some(reference => reference.kind === "comment" && reference.id === commentId);
        const exactWorkspace = expectedTaskRoot !== null && path.resolve(request.cwd) === expectedTaskRoot &&
          readRoots.some(root => typeof root === "string" && path.resolve(root) === expectedTaskRoot) &&
          writeRoots.some(root => typeof root === "string" && path.resolve(root) === expectedTaskRoot);
        const exactTrustedCommand = nativeSessionStart
          ? execution !== null && expectedTaskRoot !== null && exactNativeSessionLaunchCommand({
            request, taskRoot: expectedTaskRoot, execution,
          })
          : nativeWorkspacePrepare
            ? execution !== null && expectedTaskRoot !== null && exactNativeWorkspacePrepareCommand({
              request, taskRoot: expectedTaskRoot, execution,
            })
            : execution !== null && expectedTaskRoot !== null &&
            exactNativeHarnessStateCommand({ request, taskRoot: expectedTaskRoot, execution, runId: source.run.id });
        const exactCredentialShape = nativeSessionStart
          ? request.modelBrokerCredential !== undefined
          : request.modelBrokerCredential === undefined && Object.keys(request.env).every(key => ![
            "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PAPERCLIP_SANDBOX_BROKER_TOKEN",
            "PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN", "PAPERCLIP_SANDBOX_BROKER_SESSION_ID",
            "PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN", "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND",
            "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS",
          ].includes(key));
        if (resolvePaperclipRunnerProviderProfile(source.source.agent.adapterConfig)?.provider !== "opencode" ||
          !exactNativeInput || !exactHumanTask || !exactCurrentComment || !exactWorkspace || !exactTrustedCommand || !exactCredentialShape ||
          !taskSnapshot.success || taskSnapshot.data.owner.kind !== "issue" || taskSnapshot.data.owner.companyId !== claims.company_id ||
          taskSnapshot.data.owner.id !== task.id || task.payloadSourceProtocolVersion !== 1 || task.payloadSourceSnapshotInvalidated ||
          !taskOwnerVersion?.sourceVersion || credentials.mode !== "none" || credentials.bindings.length !== 0 ||
          request.brokerCredential !== undefined)
          throw forbidden("Native pre-receipt command is outside the current conversation Run, input, Human and workspace scope");
        await assertNativeTaskSourceOwnerCurrent(tx, { companyId: claims.company_id,
          actor: { type: "board", source: "session", userId: claims.responsible_user_id },
          source: { kind: "task", issueId: task.id, sourceVersion: taskOwnerVersion.sourceVersion,
            contentHash: taskSnapshot.data.owner.contentHash } });
        nativeSessionStartValid = nativeSessionStart;
        nativeHarnessStateValid = nativeHarnessState;
      }
      if (!providerArtifactPreparation && !nativeHarnessState && !nativeWorkspacePrepare && credentials.mode === "brokered") {
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
      } else if (!providerArtifactPreparation && !nativeHarnessState && !nativeWorkspacePrepare && (credentials.mode !== "none" || credentials.bindings.length ||
        brokerCredential !== undefined)) {
        throw forbidden("Sandbox execution contains an unauthorized broker capability");
      }
      const modelCredential = request.modelBrokerCredential;
      const modelClaims = modelCredential ? verifyRuntimeToolsToken(modelCredential.capabilityToken, "worker_model") : null;
      const conversationModelClaims = modelCredential
        ? verifyRuntimeToolsToken(modelCredential.capabilityToken, "conversation_model") : null;
      const modelBinding = modelClaims?.worker_model;
      const conversationBinding = conversationModelClaims?.conversation_model;
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
      if (providerArtifactPreparation) {
        // The server-stored preparation purpose is the only path that may run
        // a Native artifact command without either credential family.
        if (modelCredential !== undefined) throw forbidden("Provider-artifact preparation cannot receive a model credential");
      } else if (nativeHarnessState || nativeWorkspacePrepare) {
        if (modelCredential !== undefined || credentials.mode !== "none" || credentials.bindings.length !== 0 || brokerCredential !== undefined)
          throw forbidden("Native harness state commands cannot receive workload credentials");
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
          Date.parse(modelCredential.expiresAt) <= Date.parse(request.deadlineAt);
        const workerCredentialValid = !!modelCredential && !!modelClaims?.worker_model && !!modelBinding &&
          modelClaims.company_id === claims.company_id && modelClaims.sub === source.run.agentId &&
          modelClaims.run_id === source.run.id && modelClaims.responsible_user_id === source.run.responsibleUserId &&
          modelClaims.exp * 1000 >= Date.now() && Date.parse(modelCredential.expiresAt) <= modelClaims.exp * 1000 &&
          !!modelAttempt && !!modelPlan && modelPlan.issueId === source.run.nativeIssueId;
        let conversationCredentialValid = false;
        let conversationCredentialChecks: Record<string, boolean> | null = null;
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
          if (Object.values(conversationCredentialChecks).every(Boolean) && (receiptData || nativeSessionStartValid)) {
            conversationCredentialValid = conversationModelClaims.exp * 1000 > Date.now() &&
              Date.parse(modelCredential.expiresAt) > Date.now() && Date.parse(request.deadlineAt) > Date.now();
          }
        }
        if (!modelCredential || !source.capability.modelBrokerProviderProfile || !exactProfileAndEnvironment ||
          !inputAndExpiryValid || (!workerCredentialValid && !conversationCredentialValid)) {
          const failedChecks = [
            ...(!modelCredential ? ["credential_absent"] : []),
            ...(!source.capability.modelBrokerProviderProfile ? ["provider_profile_absent"] : []),
            ...(!exactProfileAndEnvironment ? ["profile_or_origin_mismatch"] : []),
            ...(!inputAndExpiryValid ? ["bounds_or_expiry_invalid"] : []),
            ...(!workerCredentialValid && !conversationCredentialValid
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
    nativePreparationPurpose?: "provider_artifact" | "native_session_start" | "native_harness_state" | "native_workspace_prepare";
    signal?: AbortSignal;
    onOutput?: (stream: "stdout" | "stderr", chunk: string) => void | Promise<void>;
  }): Promise<{ exitCode: number | null; signal: null; timedOut: boolean; stdout: string; stderr: string } | null> {
    if (!input.runId) return null;
    const command = input.command, argv = [command, ...(input.args ?? [])];
    const cwd = input.cwd;
    const requestedNativePreparationPurpose = input.nativePreparationPurpose;
    if (requestedNativePreparationPurpose !== undefined && requestedNativePreparationPurpose !== "provider_artifact" &&
      requestedNativePreparationPurpose !== "native_session_start" && requestedNativePreparationPurpose !== "native_harness_state" &&
      requestedNativePreparationPurpose !== "native_workspace_prepare")
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
    const conversationTask = initialSource.source.task;
    const hasConversationIdentity = conversationTask.conversationAgentId !== null || conversationTask.conversationUserId !== null;
    // The shared remote artifact helpers also serve ordinary Worker runs. Only
    // a route-created conversation Task can use this pre-receipt setup lane;
    // Workers retain their existing typed model/MCP credential path.
    if (requestedNativePreparationPurpose === "native_session_start" && !hasConversationIdentity)
      throw conflict("Native session start requires an authenticated conversation Task");
    if (requestedNativePreparationPurpose === "native_harness_state" && !hasConversationIdentity)
      throw conflict("Native harness state requires an authenticated conversation Task");
    if (requestedNativePreparationPurpose === "native_workspace_prepare" && !hasConversationIdentity)
      throw conflict("Native workspace preparation requires an authenticated conversation Task");
    const nativePreparationPurpose = requestedNativePreparationPurpose && hasConversationIdentity
      ? requestedNativePreparationPurpose : undefined;
    const providerArtifactPreparation = nativePreparationPurpose === "provider_artifact";
    const nativeSessionStart = nativePreparationPurpose === "native_session_start";
    const nativeHarnessState = nativePreparationPurpose === "native_harness_state";
    const nativeWorkspacePrepare = nativePreparationPurpose === "native_workspace_prepare";
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
      const filesystem = initialSource.policy.compilation.compiledPolicy.filesystem;
      const readRoots = Array.isArray(filesystem?.readPaths) ? filesystem.readPaths : [];
      const writeRoots = Array.isArray(filesystem?.writePaths) ? filesystem.writePaths : [];
      if (!expectedTaskRoot || path.resolve(cwd) !== expectedTaskRoot ||
        !readRoots.some(root => typeof root === "string" && path.resolve(root) === expectedTaskRoot) ||
        !writeRoots.some(root => typeof root === "string" && path.resolve(root) === expectedTaskRoot))
        throw conflict("Sandbox conversation execution requires the exact private Task workspace in its current read/write policy");
    }
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
    if (providerArtifactPreparation || nativeSessionStart || nativeHarnessState || nativeWorkspacePrepare) {
      const task = initialSource.source.task;
      const contextSnapshot = initialSource.run.contextSnapshot && typeof initialSource.run.contextSnapshot === "object"
        ? initialSource.run.contextSnapshot as Record<string, unknown> : {};
      if (runnerProfile?.provider !== "opencode" || task.conversationAgentId !== initialSource.run.agentId ||
        task.conversationUserId !== initialSource.run.responsibleUserId || task.conversationState !== "active" ||
        task.conversationRetiredAt !== null || task.executionRunId !== initialSource.run.id ||
        !["in_review", "in_progress"].includes(task.status) || initialSource.run.runtimeMode !== "native" ||
        initialSource.run.scopeKind !== "issue" || initialSource.run.nativeIssueId !== task.id ||
        contextSnapshot.conversationSessionGeneration !== task.conversationSessionGeneration ||
        initialSource.manifest.runId !== initialSource.run.id || initialSource.manifest.agentId !== initialSource.run.agentId ||
        initialSource.manifest.manifest.responsibleUserId !== initialSource.run.responsibleUserId)
        throw conflict("Provider artifact preparation requires the current Native conversation Run and manifest");
      if ((providerArtifactPreparation || nativeHarnessState || nativeWorkspacePrepare) &&
        (credentials.mode !== "none" || credentials.bindings.length !== 0 || managedModelPlaceholder))
        throw conflict("Provider artifact preparation cannot receive workload credentials");
    }
    if (runnerProfile?.provider === "opencode" && (!nativePreparationPurpose || nativeSessionStart)) {
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
      // A conversation token is only a capability to reach the local broker.
      // The gateway still requires the persisted initial Native input receipt,
      // current source ACLs, and the current Human before it reserves or sends.
      const minted = hasConversationIdentity
        ? await options.workerModels.issueForConversationRun(mintInput)
        : await options.workerModels.issueForRun(mintInput);
      const expiresAt = new Date(Math.min(Date.parse(minted.expiresAt), deadlineAt.getTime(), initialSource.lease.expiresAt!.getTime()));
      if (expiresAt <= now) throw conflict("Managed model broker capability expired before sandbox dispatch");
      modelBrokerCredential = { capabilityToken: minted.token, profileId: profile.id, profileHash: profile.hash,
        expiresAt: expiresAt.toISOString(), inputTokensUpperBound: minted.inputTokensUpperBound,
        maxOutputTokens: minted.maxOutputTokens };
      await createRunSecretRedactionRegistry(db).register(input.companyId, initialSource.run.id, minted.token);
      env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN = managedModelBrokerOrigin;
      env.PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND = String(minted.inputTokensUpperBound);
      env.PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS = String(minted.maxOutputTokens);
    }
    if (managedModelPlaceholder && (!modelBrokerCredential || nativeHarnessState || nativeWorkspacePrepare))
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
    const commandDigest = nativeSha256({ argv, cwd, env, stdinHash: sha256(stdinBytes), timeoutDeadline: deadlineAt.toISOString(),
      brokerCapabilityHash: brokerCapabilityToken ? sha256(brokerCapabilityToken) : null,
      brokerProviderProfile: brokerProviderProfile ? { id: brokerProviderProfile.id, hash: brokerProviderProfile.hash } : null,
      modelBrokerCapabilityHash: modelBrokerCredential ? sha256(modelBrokerCredential.capabilityToken) : null,
      modelBrokerProviderProfile: modelBrokerCredential ? { id: modelBrokerCredential.profileId, hash: modelBrokerCredential.profileHash } : null,
      nativePreparationPurpose: nativePreparationPurpose ?? null });
    const attempt = initialSource.attempt?.attempt ?? Math.max(1, initialSource.run.continuationAttempt + 1);
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
      const desiredState = {
        kind: "sandbox_exec_v1", requestId, bindingId: source.sandboxBinding.id,
        cellId: source.cell.id, generation: source.cell.generation.toString(), hostId: source.host.id,
        hostEpoch: source.host.credentialVersion, runId: source.run.id, attemptId: source.attempt?.id ?? null,
        attempt, leaseId: source.lease.id, manifestId: source.manifest.id, manifestHash: source.manifest.hash,
        policySnapshotId: source.policy.id, policyHash: source.policy.policyHash,
        commandDigest, deadlineAt: deadlineAt.toISOString(),
        ...(nativePreparationPurpose ? { nativePreparationPurpose } : {}),
      };
      const [claim] = await tx.insert(runtimeHostCommands).values({
        runtimeHostId: source.host.id, companyId: input.companyId, runtimeCellId: source.cell.id,
        cellGeneration: source.cell.generation, commandType: "sandbox_exec",
        idempotencyKey: requestId, payload: desiredState,
        deadlineAt, notBefore: now,
      }).returning();
      if (!claim) throw conflict("Sandbox execution claim could not be persisted");
      return { source, claim, requestId, commandDigest, attempt, deadlineAt, argv, cwd, env, stdinBytes,
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
          status: "SUCCEEDED", completedAt: new Date(), safeResult: { exitCode: result.exitCode, timedOut: result.timedOut },
        }).where(and(eq(runtimeHostCommands.id, claim.id), eq(runtimeHostCommands.status, "CLAIMED"))).returning({ id: runtimeHostCommands.id });
        return completed ?? null;
      });
      if (!returned) throw conflict("Sandbox execution claim was fenced before result delivery");
      return { exitCode: result.exitCode, signal: null, timedOut: result.timedOut, stdout: redacted.stdout, stderr: redacted.stderr };
    } catch (error) {
      const code = error instanceof Error && ["exec_timeout", "exec_unknown", "runtime_unavailable", "policy_changed", "exec_rejected"].includes(error.message)
        ? error.message : "exec_unknown";
      await db.update(runtimeHostCommands).set({ status: "FAILED", completedAt: new Date(), errorCode: code })
        .where(and(eq(runtimeHostCommands.id, claim.id), eq(runtimeHostCommands.status, "PENDING")));
      await db.update(runtimeHostCommands).set({ errorCode: code })
        .where(and(eq(runtimeHostCommands.id, claim.id), eq(runtimeHostCommands.status, "CLAIMED")));
      throw error;
    }
  }
  return {
    auth,
    backups,
    relay,
    getCell,
    executeSandboxTask,
    authorizeSandboxBrokerCapability,
    create,
    request,
    assertSandboxStartAdmission,
    recordSandboxWorkloadState,
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
