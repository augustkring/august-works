import { createHash, randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { environmentLeases, heartbeatRuns, memoryJobs, nativeRunFinalizations, runtimeHostCommands, type Db } from "@paperclipai/db";
import { SANDBOX_HOST_COMMAND } from "@paperclipai/shared";
import { nativeSha256 } from "./canonical.js";
const canonicalStopOwner = vi.hoisted(() => ({ receipt: null as unknown }));
vi.mock("../remote-execution-termination.js", () => ({ remoteExecutionHasStopped: async () => true }));
vi.mock("../execution-sandbox/run-lease-cleanup.js", () => ({
  verifyNativeCleanupRuntimeState: async () => canonicalStopOwner.receipt,
}));
import {
  assertRemoteRuntimeAssetErasureReady,
  createRemoteRuntimeAssetLocator,
  isRemoteRuntimeAssetLocator,
  isRemoteRuntimeAssetRemovalReceipt,
  remoteRuntimeAssetErasureLeaseIsCurrent,
  remoteRuntimeAssetLocatorDigest,
  remoteRuntimeAssetPathDigest,
} from "./runtime-asset-retention.js";
import { REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT, REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
  REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_SCRIPT, REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT } from "./remote-runner-identity.js";

function trustedEraserNodePath(): string | null {
  const candidates = [process.env.PAPERCLIP_TEST_ERASER_NODE_PATH, process.execPath,
    "/usr/bin/node", "/usr/local/bin/node", "/bin/node"];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const executable = realpathSync(candidate);
      const file = statSync(executable);
      if (!file.isFile() || file.uid !== 0 || (file.mode & 0o6022) !== 0) continue;
      for (let parent = dirname(executable); ; parent = dirname(parent)) {
        const directory = statSync(parent);
        if (!directory.isDirectory() || directory.uid !== 0 || (directory.mode & 0o6022) !== 0) break;
        if (parent === "/") return executable;
      }
    } catch { /* Try the next fixed candidate. */ }
  }
  return null;
}

const trustedEraserNode = trustedEraserNodePath();
function runEraser(args: string[], options: Parameters<typeof spawnSync>[2] = {}) {
  if (!trustedEraserNode) throw new Error("test_host_root_owned_node_unavailable");
  const env = { ...process.env, ...(options?.env ?? {}),
    PATH: `${dirname(trustedEraserNode)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` };
  return spawnSync("sh", args, { ...options, encoding: "utf8", env });
}

describe("remote Native runtime asset erasure binding", () => {
  it("requires the exact signed session-start binding for retired-lease cleanup", () => {
    const now = new Date("2026-10-28T12:00:00.000Z");
    const futureExpiry = new Date(now.getTime() + 60_000);
    const releasedAt = new Date(now.getTime() - 1_000);
    const expiredEphemeral = { provider: "sandbox-fixture", status: "expired", leasePolicy: "ephemeral",
      releasedAt, cleanupStatus: "success", expiresAt: futureExpiry };
    expect(remoteRuntimeAssetErasureLeaseIsCurrent(expiredEphemeral, now)).toBe(false);
    expect(remoteRuntimeAssetErasureLeaseIsCurrent(expiredEphemeral, now, true)).toBe(true);
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, cleanupStatus: "failed" }, now, true)).toBe(false);
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, status: "failed" }, now, true)).toBe(false);
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, status: "released" }, now, true)).toBe(false);
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, releasedAt: null }, now, true)).toBe(false);
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, leasePolicy: "reuse_by_environment" }, now, true)).toBe(false);
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, expiresAt: null }, now, true)).toBe(false);
    // A recorded expired TTL can enter cleanup-attestation refresh only; the
    // actual RuntimeControl dispatch additionally requires fresh host proof.
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, expiresAt: now }, now, true)).toBe(true);
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, provider: "local" }, now, true)).toBe(false);
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, provider: null }, now, true)).toBe(false);
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, status: "active", releasedAt: null,
      cleanupStatus: null }, now)).toBe(true);
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, status: "pending_cleanup", releasedAt: null,
      cleanupStatus: "pending" }, now)).toBe(true);
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, status: "active", releasedAt }, now)).toBe(false);
  });

  function fixture() {
    const locator = createRemoteRuntimeAssetLocator({
      companyId: randomUUID(),
      runId: randomUUID(),
      environmentId: randomUUID(),
      environmentLeaseId: randomUUID(),
      provider: "sandbox-fixture",
      providerLeaseId: "lease-fixture-1",
      runnerInstanceId: randomUUID(),
      normalizedSessionId: randomUUID(),
      remoteCwd: "/workspace/safe-fixture",
    });
    const receipt = {
      schema: "paperclip.remote-runtime-asset-removal.v1" as const,
      locatorDigest: remoteRuntimeAssetLocatorDigest(locator),
      commandRequestId: randomUUID(),
      purpose: "native_provider_data_erasure" as const,
      target: { hostId: randomUUID(), cellId: randomUUID(), cellGeneration: "7", bindingId: randomUUID() },
      relativePath: locator.relativePath,
      pathDigest: locator.pathDigest,
      stopProof: {
        schema: "paperclip.native-remote-process-stop.v1" as const,
        runId: locator.runId,
        normalizedSessionIdDigest: locator.normalizedSessionIdDigest,
        runnerInstanceId: locator.runnerInstanceId,
        environmentLeaseId: locator.environmentLeaseId,
        providerLeaseId: locator.providerLeaseId,
        pid: 12345,
        startedAt: "2026-10-28T12:00:00.000Z",
        processIdentityDigest: "a".repeat(64),
        processStartFingerprintDigest: "b".repeat(64),
        stoppedAt: "2026-10-28T12:01:00.000Z",
      },
      stopProofBeforeDelete: true as const,
      exitCode: 0 as const,
      timedOut: false as const,
      postDeleteAbsent: true as const,
    };
    return { locator, receipt };
  }

  it("pins the exact canonical shared-session path and detects lease mutation", () => {
    const { locator } = fixture();
    expect(locator.relativePath).toBe(`sessions/${locator.normalizedSessionIdDigest}`);
    expect(locator.pathDigest).toBe(remoteRuntimeAssetPathDigest(locator.relativePath));
    expect(isRemoteRuntimeAssetLocator(locator, locator)).toBe(true);
    expect(isRemoteRuntimeAssetLocator({ ...locator, relativePath: "sessions/../other" }, locator)).toBe(false);
    const replacement = { ...locator, providerLeaseId: "replacement-lease" };
    expect(isRemoteRuntimeAssetLocator(replacement, locator)).toBe(true);
    expect(remoteRuntimeAssetLocatorDigest(replacement)).not.toBe(remoteRuntimeAssetLocatorDigest(locator));
    expect(isRemoteRuntimeAssetLocator({ ...locator, arbitraryPath: "/tmp/other" }, locator)).toBe(false);
  });

  it("accepts only a locator-bound process-stop, exact-target, post-delete receipt", () => {
    const { locator, receipt } = fixture();
    expect(isRemoteRuntimeAssetRemovalReceipt(receipt, locator)).toBe(true);
    expect(isRemoteRuntimeAssetRemovalReceipt({ ...receipt, relativePath: "sessions/neighbor" }, locator)).toBe(false);
    expect(isRemoteRuntimeAssetRemovalReceipt({ ...receipt, stopProofBeforeDelete: false }, locator)).toBe(false);
    expect(isRemoteRuntimeAssetRemovalReceipt({ ...receipt,
      stopProof: { ...receipt.stopProof, providerLeaseId: "replacement-lease" } }, locator)).toBe(false);
    expect(isRemoteRuntimeAssetRemovalReceipt({ ...receipt,
      target: { ...receipt.target, cellGeneration: "0" } }, locator)).toBe(false);
  });

  it("accepts the closed Sandbox workload Stop proof without inventing a process identity", () => {
    const {locator,receipt}=fixture();
    const stopProof={schema:"paperclip.native-sandbox-workload-stop.v1",runId:locator.runId,
      normalizedSessionIdDigest:locator.normalizedSessionIdDigest,runnerInstanceId:locator.runnerInstanceId,
      environmentLeaseId:locator.environmentLeaseId,providerLeaseId:locator.providerLeaseId,
      startCommandId:randomUUID(),stopCommandId:randomUUID(),inspectCommandId:randomUUID(),runtimeOperationId:randomUUID(),
      startBindingDigest:"c".repeat(64),sandboxId:randomUUID(),containerId:"d".repeat(64),
      receiptDigest:"e".repeat(64),stoppedAt:"2026-10-28T12:01:00.000Z"};
    expect(isRemoteRuntimeAssetRemovalReceipt({...receipt,stopProof},locator)).toBe(true);
    for(const key of ["startCommandId","stopCommandId","inspectCommandId","runtimeOperationId","startBindingDigest",
      "sandboxId","containerId","receiptDigest","stoppedAt"]){
      const missing:Record<string,unknown>={...stopProof};delete missing[key];
      expect(isRemoteRuntimeAssetRemovalReceipt({...receipt,stopProof:missing},locator),key).toBe(false);
    }
    expect(isRemoteRuntimeAssetRemovalReceipt({...receipt,stopProof:{...stopProof,environmentLeaseId:randomUUID()}},locator)).toBe(false);
    expect(isRemoteRuntimeAssetRemovalReceipt({...receipt,stopProof:{...stopProof,normalizedSessionIdDigest:"f".repeat(64)}},locator)).toBe(false);
    expect(isRemoteRuntimeAssetRemovalReceipt({...receipt,stopProof:{...stopProof,pid:12345}},locator)).toBe(false);
    expect(isRemoteRuntimeAssetRemovalReceipt({...receipt,stopProof:{...stopProof,runtimeOperationId:"unverified"}},locator)).toBe(false);
    // Shape parsing alone is not ledger qualification; readiness still joins
    // the current canonical Stop and actual Host erasure command/checkpoint.
  });

  it("releases its owned session fence after each successful physical-erasure probe", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-erasure-probe-fence-"));
    const taskRoot = join(root, "task");
    const digest = createHash("sha256").update(randomUUID()).digest("hex");
    const runId = randomUUID();
    const sessionsRoot = join(taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions");
    const fencePath = join(sessionsRoot, `.${digest}.lock`);
    try {
      await mkdir(taskRoot, { recursive: true, mode: 0o700 });
      const runProbe = () => runEraser(["-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_SCRIPT,
        "paperclip-native-asset-erasure-probe", taskRoot, digest, runId, randomUUID()],
      { encoding: "utf8", timeout: 10_000 });
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = runProbe();
        expect(result.status, JSON.stringify({ stderr: result.stderr, stdout: result.stdout })).toBe(0);
        expect(result.stdout.trim()).toBe("qualified");
        expect(await access(fencePath).then(() => true, () => false)).toBe(false);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "linux")("stops only the recorded runner generation before removing its exact session tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-runtime-physical-erasure-"));
    const taskRoot = join(root, "task");
    const companyId = randomUUID();
    const runId = randomUUID();
    const environmentId = randomUUID();
    const environmentLeaseId = randomUUID();
    const providerLeaseId = randomUUID();
    const runnerInstanceId = randomUUID();
    const normalizedSessionId = randomUUID();
    const digest = createHash("sha256").update(normalizedSessionId).digest("hex");
    const sessionRoot = join(taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions", digest);
    const runnerRoot = join(sessionRoot, "runner");
    const sessionsRoot = join(taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions");
    const neighborRoot = join(sessionsRoot, "f".repeat(64));
    const statePath = join(runnerRoot, "runner-state.json");
    const identityPath = join(runnerRoot, "runner-process.identity");
    const nonce = randomUUID();
    const processIsAlive = (pid: number) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    };
    const runner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", "--runner-id", runnerInstanceId],
      { detached: true, stdio: "ignore" });
    try {
      if (!runner.pid) throw new Error("test_runner_pid_unavailable");
      await mkdir(runnerRoot, { recursive: true, mode: 0o700 });
      await mkdir(neighborRoot, { recursive: true, mode: 0o700 });
      await writeFile(join(neighborRoot, "keep.txt"), "neighbor remains\n", { mode: 0o600 });
      const outsideRoot = join(root, "outside-session-target");
      await mkdir(outsideRoot, { mode: 0o700 });
      await writeFile(join(outsideRoot, "keep.txt"), "outside remains\n", { mode: 0o600 });
      const skillRoot = join(sessionRoot, "filesystem", "context", "skills");
      const skillDirectory = join(skillRoot, "0-immutable-skill");
      const referencesDirectory = join(skillDirectory, "references");
      await mkdir(referencesDirectory, { recursive: true, mode: 0o700 });
      await writeFile(join(skillDirectory, "SKILL.md"), "immutable skill\n", { mode: 0o444 });
      await writeFile(join(referencesDirectory, "guide.md"), "immutable reference\n", { mode: 0o444 });
      await symlink(outsideRoot, join(skillRoot, "outside-link"));
      await chmod(referencesDirectory, 0o555);
      await chmod(skillDirectory, 0o555);
      await chmod(skillRoot, 0o555);
      const statText = await readFile(`/proc/${runner.pid}/stat`, "utf8");
      const statEnd = statText.lastIndexOf(") ");
      const processTicks = statText.slice(statEnd + 2).trim().split(/\s+/)[19];
      const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      if (statEnd < 0 || !/^\d+$/.test(processTicks ?? "") || !/^[-a-f0-9]+$/i.test(bootId))
        throw new Error("test_runner_fingerprint_unavailable");
      const fingerprint = `linux:${bootId}:${processTicks}`;
      const startedAt = new Date().toISOString();
      await writeFile(statePath, JSON.stringify({ runId, runnerInstanceId, environmentLeaseId, normalizedSessionId }) + "\n",
        { mode: 0o600 });
      await writeFile(identityPath, `${nonce}\n${runner.pid}\n${startedAt}\n${runnerInstanceId}\n${fingerprint}\n`,
        { mode: 0o600 });

      const commandArgs = (leaseId: string, expectedDigest = digest) => ["-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT,
        "paperclip-native-runtime-asset-erasure", taskRoot, digest, runId, runnerInstanceId, leaseId, providerLeaseId,
        expectedDigest, String(runner.pid), startedAt, REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
        REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT];
      const wrongLease = runEraser(commandArgs(randomUUID()), { encoding: "utf8", timeout: 10_000 });
      expect(wrongLease.status).not.toBe(0);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(true);
      const wrongDigest = runEraser(commandArgs(environmentLeaseId, "0".repeat(64)),
        { encoding: "utf8", timeout: 10_000 });
      expect(wrongDigest.status).not.toBe(0);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(true);
      const fencePath = join(sessionsRoot, `.${digest}.lock`);
      await mkdir(fencePath, { mode: 0o700 });
      const staleSiblingLock = runEraser(commandArgs(environmentLeaseId), { encoding: "utf8", timeout: 10_000 });
      expect(staleSiblingLock.status).not.toBe(0);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(true);
      await rm(fencePath, { recursive: true });
      const outsideLockTarget = join(root, "outside-lock-target");
      await mkdir(outsideLockTarget, { mode: 0o700 });
      await symlink(outsideLockTarget, fencePath);
      const symlinkLock = runEraser(commandArgs(environmentLeaseId), { encoding: "utf8", timeout: 10_000 });
      expect(symlinkLock.status).not.toBe(0);
      expect(await access(join(outsideLockTarget, "owner")).then(() => true, () => false)).toBe(false);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(true);
      await rm(fencePath);
      const validIdentity = await readFile(identityPath, "utf8");
      await writeFile(identityPath, validIdentity.replace(`${nonce}\n`, "invalid/nonce\n"), { mode: 0o600 });
      const invalidNonce = runEraser(commandArgs(environmentLeaseId), { encoding: "utf8", timeout: 10_000 });
      expect(invalidNonce.status).not.toBe(0);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(true);
      await writeFile(identityPath, validIdentity.replace(`${fingerprint}\n`, "linux:deadbeef:1\n"), { mode: 0o600 });
      const reusedPid = runEraser(commandArgs(environmentLeaseId), { encoding: "utf8", timeout: 10_000 });
      expect(reusedPid.status).not.toBe(0);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(true);
      const wrongGeneration = runEraser(["-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT,
        "paperclip-native-runtime-asset-erasure", taskRoot, digest, runId, runnerInstanceId, environmentLeaseId,
        providerLeaseId, digest, String(runner.pid + 1), startedAt, REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
        REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT], { encoding: "utf8", timeout: 10_000 });
      expect(wrongGeneration.status).not.toBe(0);
      expect(processIsAlive(runner.pid)).toBe(true);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      const wrongStartedAt = runEraser(["-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT,
        "paperclip-native-runtime-asset-erasure", taskRoot, digest, runId, runnerInstanceId, environmentLeaseId,
        providerLeaseId, digest, String(runner.pid), new Date(Date.parse(startedAt) + 1).toISOString(),
        REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT, REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT],
      { encoding: "utf8", timeout: 10_000 });
      expect(wrongStartedAt.status).not.toBe(0);
      expect(processIsAlive(runner.pid)).toBe(true);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      await writeFile(identityPath, validIdentity, { mode: 0o600 });

      const erased = runEraser(commandArgs(environmentLeaseId), { encoding: "utf8", timeout: 15_000 });
      const failedGroup = spawnSync("ps", ["-o", "pid=,ppid=,sid=,pgid=,stat=,args=", "-g", String(runner.pid)],
        { encoding: "utf8" }).stdout;
      expect(erased.status, JSON.stringify({ stderr: erased.stderr, stdout: erased.stdout,
        runnerExitCode: runner.exitCode, runnerSignal: runner.signalCode, failedGroup })).toBe(0);
      expect(erased.stdout.trim().split("\n")).toHaveLength(7);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(false);
      expect(await readFile(join(neighborRoot, "keep.txt"), "utf8")).toBe("neighbor remains\n");
      expect(await readFile(join(outsideRoot, "keep.txt"), "utf8")).toBe("outside remains\n");
      expect((await stat(outsideRoot)).mode & 0o777).toBe(0o700);
      expect((await stat(sessionsRoot)).isDirectory()).toBe(true);
      expect(await access(join(sessionsRoot, `.${digest}.lock`)).then(() => true, () => false)).toBe(false);
      if (runner.exitCode === null && runner.signalCode === null) {
        await Promise.race([new Promise<void>(resolve => runner.once("exit", () => resolve())),
          new Promise<void>(resolve => setTimeout(resolve, 2_000))]);
      }
      expect(runner.exitCode !== null || runner.signalCode !== null).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(false);

      const deadRunner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"],
        { detached: true, stdio: "ignore" });
      if (!deadRunner.pid) throw new Error("test_dead_runner_pid_unavailable");
      const deadRunnerExit = new Promise<void>(resolve => deadRunner.once("exit", () => resolve()));
      const deadStat = await readFile(`/proc/${deadRunner.pid}/stat`, "utf8");
      const deadStatEnd = deadStat.lastIndexOf(") ");
      const deadProcessTicks = deadStat.slice(deadStatEnd + 2).trim().split(/\s+/)[19];
      if (deadStatEnd < 0 || !/^\d+$/.test(deadProcessTicks ?? ""))
        throw new Error("test_dead_runner_fingerprint_unavailable");
      deadRunner.kill("SIGKILL");
      await deadRunnerExit;
      expect(processIsAlive(deadRunner.pid)).toBe(false);
      const deadSessionId = randomUUID();
      const deadDigest = createHash("sha256").update(deadSessionId).digest("hex");
      const deadSessionRoot = join(sessionsRoot, deadDigest);
      const deadRunnerRoot = join(deadSessionRoot, "runner");
      const deadNonce = randomUUID();
      const deadStartedAt = new Date().toISOString();
      const deadFingerprint = `linux:${bootId}:${deadProcessTicks}`;
      await mkdir(deadRunnerRoot, { recursive: true, mode: 0o700 });
      await writeFile(join(deadRunnerRoot, "runner-state.json"), JSON.stringify({ runId, runnerInstanceId,
        environmentLeaseId, normalizedSessionId: deadSessionId }) + "\n", { mode: 0o600 });
      await writeFile(join(deadRunnerRoot, "runner-process.identity"),
        `${deadNonce}\n${deadRunner.pid}\n${deadStartedAt}\n${runnerInstanceId}\n${deadFingerprint}\n`, { mode: 0o600 });
      const deadErasure = runEraser(["-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT,
        "paperclip-native-runtime-asset-erasure", taskRoot, deadDigest, runId, runnerInstanceId, environmentLeaseId,
        providerLeaseId, deadDigest, String(deadRunner.pid), deadStartedAt, REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
        REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT], { encoding: "utf8", timeout: 10_000 });
      expect(deadErasure.status, JSON.stringify({ stderr: deadErasure.stderr, stdout: deadErasure.stdout })).toBe(0);
      expect(deadErasure.stdout.trim().split("\n")).toHaveLength(7);
      expect(await access(deadSessionRoot).then(() => true, () => false)).toBe(false);
      expect(await readFile(join(neighborRoot, "keep.txt"), "utf8")).toBe("neighbor remains\n");
    } finally {
      if (runner.exitCode === null && runner.signalCode === null) {
        try { process.kill(-runner.pid!, "SIGKILL"); } catch { /* runner already stopped */ }
      }
      for (const directory of [join(sessionRoot, "filesystem", "context", "skills"),
        join(sessionRoot, "filesystem", "context", "skills", "0-immutable-skill"),
        join(sessionRoot, "filesystem", "context", "skills", "0-immutable-skill", "references")])
        await chmod(directory, 0o700).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  // Exercise the real claim/ledger/descriptor reader through public readiness.
  // The B verifier boundary supplies its actual normalized proof shape (as in
  // the R175 PG readback), which deliberately has no policyHash. This fixture
  // does not qualify signatures or replace the signed Stop integration lane.
  function replayFixture(variant: "valid" | "wrong_policy" | "wrong_start" | "missing_start" = "valid") {
    const sessionId = randomUUID(), cwd = "/workspace/replay";
    const locator = createRemoteRuntimeAssetLocator({ companyId: randomUUID(), runId: randomUUID(),
      environmentId: randomUUID(), environmentLeaseId: randomUUID(), provider: "sandbox-fixture",
      providerLeaseId: "fixture-lease", runnerInstanceId: randomUUID(), normalizedSessionId: sessionId, remoteCwd: cwd });
    const scope = { companyId: locator.companyId, bindingId: randomUUID(), cellId: randomUUID(),
      cellGeneration: "7", sandboxRef: "" };
    scope.sandboxRef = `aw-v7-${scope.bindingId}`;
    const hostId = randomUUID(), policyHash = "a".repeat(64), imageDigest = `fixture/image@sha256:${"b".repeat(64)}`;
    const originalStart = { schema: "paperclip.remote-native-session-start-binding.v1",
      locatorDigest: remoteRuntimeAssetLocatorDigest(locator), runnerInstanceId: locator.runnerInstanceId,
      environmentLeaseId: locator.environmentLeaseId, provider: locator.provider, providerLeaseId: locator.providerLeaseId,
      normalizedSessionIdDigest: locator.normalizedSessionIdDigest, hostId, hostEpoch: 1, cellId: scope.cellId,
      cellGeneration: scope.cellGeneration, bindingId: scope.bindingId, manifestId: randomUUID(),
      manifestHash: "c".repeat(64), policySnapshotId: randomUUID(), policyHash };
    const requestId = randomUUID();
    const startRow = { runtimeHostId: hostId, runtimeCellId: scope.cellId, cellGeneration: 7n,
      idempotencyKey: requestId, completedAt: new Date(), safeResult: { exitCode: 0, timedOut: false },
      payload: { remoteNativeSessionStartBinding: originalStart, hostId, cellId: scope.cellId,
        generation: scope.cellGeneration, bindingId: scope.bindingId, manifestId: originalStart.manifestId,
        manifestHash: originalStart.manifestHash, policySnapshotId: originalStart.policySnapshotId,
        policyHash: variant === "wrong_start" ? "f".repeat(64) : policyHash, hostEpoch: 1,
        requestId, runId: locator.runId, leaseId: locator.environmentLeaseId } };
    const combinedStop = { schema: "paperclip.remote-termination.v1", companyId: locator.companyId,
      runId: locator.runId, leaseId: locator.environmentLeaseId, provider: locator.provider,
      providerLeaseId: locator.providerLeaseId, state: "stopped", confirmedAt: "2026-11-02T00:01:00.000Z",
      sandboxStop: { runId: locator.runId, leaseId: locator.environmentLeaseId,
        startCommandId: randomUUID(), startBindingDigest: "d".repeat(64), sandboxId: randomUUID(),
        containerId: "e".repeat(64), intent: { eventId: randomUUID(), seq: "1", createdAt: "2026-11-02T00:00:00.000Z" },
        ...scope, hostId, hostEpoch: 1, imageDigest, stopCommandId: randomUUID(), inspectCommandId: randomUUID(),
        runtimeOperationId: randomUUID() } };
    canonicalStopOwner.receipt = combinedStop;
    const stop = combinedStop.sandboxStop;
    const descriptor = { schema: "paperclip.remote-native-session-erasure.v1", startBindingDigest: stop.startBindingDigest,
      sessionKey: "f".repeat(64), leaseId: locator.environmentLeaseId, taskRoot: cwd,
      sessionDigest: locator.normalizedSessionIdDigest, policyHash: variant === "wrong_policy" ? "f".repeat(64) : policyHash,
      sandboxId: stop.sandboxId, containerId: stop.containerId, imageDigest, dockerEngineIdHash: "a".repeat(64),
      cellGeneration: scope.cellGeneration, runId: locator.runId, runnerInstanceId: locator.runnerInstanceId };
    const receipt = { schema: "paperclip.remote-runtime-asset-removal.v1", locatorDigest: remoteRuntimeAssetLocatorDigest(locator),
      commandRequestId: randomUUID(), purpose: "native_provider_data_erasure",
      target: { hostId, cellId: scope.cellId, cellGeneration: scope.cellGeneration, bindingId: scope.bindingId },
      relativePath: locator.relativePath, pathDigest: locator.pathDigest,
      stopProof: { schema: "paperclip.native-sandbox-workload-stop.v1", runId: locator.runId,
        normalizedSessionIdDigest: locator.normalizedSessionIdDigest, runnerInstanceId: locator.runnerInstanceId,
        environmentLeaseId: locator.environmentLeaseId, providerLeaseId: locator.providerLeaseId,
        startCommandId: stop.startCommandId, stopCommandId: stop.stopCommandId, inspectCommandId: stop.inspectCommandId,
        runtimeOperationId: stop.runtimeOperationId, startBindingDigest: stop.startBindingDigest,
        sandboxId: stop.sandboxId, containerId: stop.containerId, receiptDigest: nativeSha256(combinedStop), stoppedAt: combinedStop.confirmedAt },
      stopProofBeforeDelete: true, exitCode: 0, timedOut: false, postDeleteAbsent: true };
    const jobKey = `runtime-asset-erasure:v1:${locator.runId}`;
    const sourceRefJson = { kind: "runtime_asset_erasure", runId: locator.runId, legacyDigests: [], remoteAssetLocator: locator };
    const historical = { id: randomUUID(), jobKey, operationType: "retention", attemptNumber: 1,
      status: "failed", sourceRefJson, executionOwnerId: null, resultJson: { remoteRuntimeAssetRemovalReceipt: receipt } };
    const current = { id: randomUUID(), jobKey, operationType: "retention", attemptNumber: 2, status: "running",
      sourceRefJson, startedAt: new Date(), finishedAt: null, executionOwnerId: "current-worker",
      leaseExpiresAt: new Date(Date.now() + 60_000), resultJson: null };
    const { taskRoot: _taskRoot, ...replyDescriptor } = descriptor;
    const command = { id: receipt.commandRequestId, completedAt: new Date(), runtimeHostId: hostId,
      runtimeCellId: scope.cellId, cellGeneration: 7n, status: "SUCCEEDED", commandType: SANDBOX_HOST_COMMAND,
      payload: { version: 1, scope, action: "erase_native_session", hostEpoch: 1, imageDigest, nativeSessionErasure: descriptor,
        __stoppedNativeErasure: { locatorDigest: receipt.locatorDigest, jobId: historical.id, jobKey,
          jobAttemptNumber: 1, executionOwnerId: "original-worker", companyPurgeOperationId: null,
          stopReceiptDigest: receipt.stopProof.receiptDigest, descriptorDigest: nativeSha256(descriptor) } },
      safeResult: { ...replyDescriptor, action: "erase_native_session", erased: true,
        upperLayerAbsent: true, mergedViewAbsent: true, stoppedBefore: true, stoppedAfter: true } };
    const run = { id: locator.runId, companyId: locator.companyId, runtimeMode: "native", driverKind: "opencode_server",
      status: "succeeded", finishedAt: new Date(), processGroupId: null, controllerLeaseExpiresAt: null,
      processPid: 12345, processStartedAt: new Date(), runnerInstanceId: locator.runnerInstanceId,
      nativeSessionId: sessionId, nativeProcessCleanupPending: false, runnerProfileJson: { nativeRemoteRuntimeAssetLocator: locator } };
    const lease = { id: locator.environmentLeaseId, environmentId: locator.environmentId, heartbeatRunId: locator.runId,
      provider: locator.provider, providerLeaseId: locator.providerLeaseId, status: "expired", leasePolicy: "ephemeral",
      releasedAt: new Date(), cleanupStatus: "success", expiresAt: new Date(Date.now() - 1000),
      metadata: { remoteCwd: cwd, remoteExecutionTermination: combinedStop } };
    let startReads = 0;
    function query(rows: unknown[]) {
      const chain = { where: (_condition: unknown) => chain, orderBy: (_order: unknown) => chain,
        limit: (limit: number) => Promise.resolve(rows.slice(0, limit)),
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
      return chain;
    }
    const db = { select: (fields?: Record<string, unknown>) => ({ from: (table: unknown) => {
      if (table === runtimeHostCommands) {
        if (fields && Object.hasOwn(fields, "runtimeHostId")) { startReads++; return query(variant === "missing_start" ? [] : [startRow]); }
        return query(fields ? [] : [command]);
      }
      if (table === heartbeatRuns) return query([run]);
      if (table === environmentLeases) return query([lease]);
      if (table === memoryJobs) return query([current, historical]);
      if (table === nativeRunFinalizations) return query([{ phase: "committed", leaseOwner: null, leaseExpiresAt: null }]);
      return query([]);
    } }), execute: async () => [{ erased: true }] } as unknown as Db;
    return { db, locator, receipt, current, combinedStop, startReads: () => startReads };
  }

  it("reuses a failed-attempt checkpoint with canonical Stop lacking policyHash and the exact signed START policy", async () => {
    const f = replayFixture();
    expect(Object.hasOwn(f.combinedStop.sandboxStop, "policyHash")).toBe(false);
    const ready = await assertRemoteRuntimeAssetErasureReady(f.db, f.locator);
    expect(ready.job.id).toBe(f.current.id);
    expect(ready.removalReceipt).toEqual(f.receipt);
    // One original-start read for the claim, one for the whole receipt lookup,
    // not one read per current/historical job row.
    expect(f.startReads()).toBe(2);
  });
  it("refuses a descriptor policy that differs from its exact signed START", async () => {
    const f = replayFixture("wrong_policy");
    expect((await assertRemoteRuntimeAssetErasureReady(f.db, f.locator)).removalReceipt).toBeNull();
  });
  it.each(["wrong_start", "missing_start"] as const)("refuses missing or inconsistent signed START evidence (%s)", async variant => {
    const f = replayFixture(variant);
    await expect(assertRemoteRuntimeAssetErasureReady(f.db, f.locator))
      .rejects.toMatchObject({ status: 409, details: { code: "native_asset_erasure_target_unqualified" } });
  });

});
