import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRemoteRuntimeAssetLocator,
  isRemoteRuntimeAssetLocator,
  isRemoteRuntimeAssetRemovalReceipt,
  remoteRuntimeAssetErasureLeaseIsCurrent,
  remoteRuntimeAssetLocatorDigest,
  remoteRuntimeAssetPathDigest,
} from "./runtime-asset-retention.js";
import { REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT, REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
  REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_SCRIPT, REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT } from "./remote-runner-identity.js";

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
    expect(remoteRuntimeAssetErasureLeaseIsCurrent({ ...expiredEphemeral, expiresAt: null }, now, true)).toBe(true);
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

  it("releases its owned session fence after each successful physical-erasure probe", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-erasure-probe-fence-"));
    const taskRoot = join(root, "task");
    const digest = createHash("sha256").update(randomUUID()).digest("hex");
    const runId = randomUUID();
    const sessionsRoot = join(taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions");
    const fencePath = join(sessionsRoot, `.${digest}.lock`);
    try {
      await mkdir(taskRoot, { recursive: true, mode: 0o700 });
      const runProbe = () => spawnSync("sh", ["-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_SCRIPT,
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
      const wrongLease = spawnSync("sh", commandArgs(randomUUID()), { encoding: "utf8", timeout: 10_000 });
      expect(wrongLease.status).not.toBe(0);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(true);
      const wrongDigest = spawnSync("sh", commandArgs(environmentLeaseId, "0".repeat(64)),
        { encoding: "utf8", timeout: 10_000 });
      expect(wrongDigest.status).not.toBe(0);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(true);
      const fencePath = join(sessionsRoot, `.${digest}.lock`);
      await mkdir(fencePath, { mode: 0o700 });
      const staleSiblingLock = spawnSync("sh", commandArgs(environmentLeaseId), { encoding: "utf8", timeout: 10_000 });
      expect(staleSiblingLock.status).not.toBe(0);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(true);
      await rm(fencePath, { recursive: true });
      const outsideLockTarget = join(root, "outside-lock-target");
      await mkdir(outsideLockTarget, { mode: 0o700 });
      await symlink(outsideLockTarget, fencePath);
      const symlinkLock = spawnSync("sh", commandArgs(environmentLeaseId), { encoding: "utf8", timeout: 10_000 });
      expect(symlinkLock.status).not.toBe(0);
      expect(await access(join(outsideLockTarget, "owner")).then(() => true, () => false)).toBe(false);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(true);
      await rm(fencePath);
      const validIdentity = await readFile(identityPath, "utf8");
      await writeFile(identityPath, validIdentity.replace(`${nonce}\n`, "invalid/nonce\n"), { mode: 0o600 });
      const invalidNonce = spawnSync("sh", commandArgs(environmentLeaseId), { encoding: "utf8", timeout: 10_000 });
      expect(invalidNonce.status).not.toBe(0);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(true);
      await writeFile(identityPath, validIdentity.replace(`${fingerprint}\n`, "linux:deadbeef:1\n"), { mode: 0o600 });
      const reusedPid = spawnSync("sh", commandArgs(environmentLeaseId), { encoding: "utf8", timeout: 10_000 });
      expect(reusedPid.status).not.toBe(0);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      expect(processIsAlive(runner.pid)).toBe(true);
      const wrongGeneration = spawnSync("sh", ["-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT,
        "paperclip-native-runtime-asset-erasure", taskRoot, digest, runId, runnerInstanceId, environmentLeaseId,
        providerLeaseId, digest, String(runner.pid + 1), startedAt, REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
        REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT], { encoding: "utf8", timeout: 10_000 });
      expect(wrongGeneration.status).not.toBe(0);
      expect(processIsAlive(runner.pid)).toBe(true);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      const wrongStartedAt = spawnSync("sh", ["-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT,
        "paperclip-native-runtime-asset-erasure", taskRoot, digest, runId, runnerInstanceId, environmentLeaseId,
        providerLeaseId, digest, String(runner.pid), new Date(Date.parse(startedAt) + 1).toISOString(),
        REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT, REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT],
      { encoding: "utf8", timeout: 10_000 });
      expect(wrongStartedAt.status).not.toBe(0);
      expect(processIsAlive(runner.pid)).toBe(true);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(true);
      await writeFile(identityPath, validIdentity, { mode: 0o600 });

      const erased = spawnSync("sh", commandArgs(environmentLeaseId), { encoding: "utf8", timeout: 15_000 });
      const failedGroup = spawnSync("ps", ["-o", "pid=,ppid=,sid=,pgid=,stat=,args=", "-g", String(runner.pid)],
        { encoding: "utf8" }).stdout;
      expect(erased.status, JSON.stringify({ stderr: erased.stderr, stdout: erased.stdout,
        runnerExitCode: runner.exitCode, runnerSignal: runner.signalCode, failedGroup })).toBe(0);
      expect(erased.stdout.trim().split("\n")).toHaveLength(7);
      expect(await access(sessionRoot).then(() => true, () => false)).toBe(false);
      expect(await readFile(join(neighborRoot, "keep.txt"), "utf8")).toBe("neighbor remains\n");
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
      const deadErasure = spawnSync("sh", ["-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT,
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
      await rm(root, { recursive: true, force: true });
    }
  });
});
