import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSandboxExecRelayRequest } from "@paperclipai/shared";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { nativeRuntimeContextFixture } from "../native-runtime/runtime-context.test-fixture.js";
import { exactNativeHarnessStateCommand, exactNativeRuntimeAssetErasureCommand, exactNativeRunnerMonitorStatusCommand,
  exactNativeSessionFilesystemFenceCommand, nativeRelayClaimFailureStatus } from "./control.js";
import { createRemoteRunnerProcessLauncher, remoteRunnerPathExists, stageRemoteRunnerDirectory, syncRemoteRunnerDirectoryOut } from "../native-runtime/native-session-executor.js";
import { REMOTE_NATIVE_SESSION_FENCE_ACQUIRE_SCRIPT, REMOTE_NATIVE_SESSION_FENCE_RELEASE_SCRIPT,
  REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT, REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
  REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT } from "../native-runtime/remote-runner-identity.js";
import { createRemoteRuntimeAssetLocator } from "../native-runtime/runtime-asset-retention.js";

describe("Native harness-state relay command owner", () => {
  let fixtureRoot: string | null = null;
  afterEach(async () => {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = null;
  });

  it.skipIf(process.platform !== "linux")("treats an exited runner generation as stopped but rejects a live PID mismatch", async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "native-runner-identity-status-"));
    const identityPath = join(fixtureRoot, "runner-process.identity");
    const nonce = randomUUID();
    const runnerInstanceId = randomUUID();
    const runCheck = (pid: number, mode?: string) => spawnSync("sh", ["-c", REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT,
      "paperclip-runner-monitor", identityPath, nonce, runnerInstanceId, String(pid), ...(mode ? [mode] : [])],
    { encoding: "utf8" });
    const fingerprint = async (pid: number) => {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const end = stat.lastIndexOf(") ");
      const ticks = stat.slice(end + 2).trim().split(/\s+/)[19];
      const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      if (end < 0 || !/^\d+$/.test(ticks ?? "") || !/^[-a-f0-9]+$/i.test(bootId))
        throw new Error("test_process_fingerprint_unavailable");
      return `linux:${bootId}:${ticks}`;
    };
    const liveRunner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", "--runner-id", runnerInstanceId],
      { stdio: "ignore" });
    const unrelatedLiveProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const exitingProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const parent = spawn("python3", ["-c",
      "import os,time; pid=os.fork(); os._exit(0) if pid == 0 else None; print(pid, flush=True); time.sleep(30)"],
    { stdio: ["ignore", "pipe", "ignore"] });
    const stop = (child: ReturnType<typeof spawn>) => new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
    try {
      const parentOutput = parent.stdout;
      if (!liveRunner.pid || !unrelatedLiveProcess.pid || !exitingProcess.pid || !parentOutput)
        throw new Error("test_process_start_failed");
      const startedAt = new Date().toISOString();
      const liveFingerprint = await fingerprint(liveRunner.pid);
      await writeFile(identityPath,
        `${nonce}\n${liveRunner.pid}\n${startedAt}\n${runnerInstanceId}\n${liveFingerprint}\n`);
      expect(runCheck(liveRunner.pid).status).toBe(0);
      expect(runCheck(liveRunner.pid, "require-fingerprint").status).toBe(0);
      await writeFile(identityPath,
        `${nonce}\n${liveRunner.pid}\n${startedAt}\n${runnerInstanceId}\n\n`);
      expect(runCheck(liveRunner.pid, "require-fingerprint").status).toBe(4);
      await writeFile(identityPath,
        `${nonce}\n${liveRunner.pid}\n${startedAt}\n${runnerInstanceId}\n${liveFingerprint}\n`);
      await writeFile(identityPath,
        `${randomUUID()}\n${liveRunner.pid}\n${startedAt}\n${runnerInstanceId}\n${liveFingerprint}\n`);
      expect(runCheck(liveRunner.pid).status).toBe(4);
      await writeFile(identityPath,
        `${nonce}\n${unrelatedLiveProcess.pid}\n${startedAt}\n${runnerInstanceId}\n${await fingerprint(unrelatedLiveProcess.pid)}\n`);
      expect(runCheck(unrelatedLiveProcess.pid).status).toBe(4);
      await writeFile(identityPath,
        `${nonce}\n${liveRunner.pid}\n${startedAt}\n${runnerInstanceId}\nlinux:deadbeef:1\n`);
      expect(runCheck(liveRunner.pid).status).toBe(3);
      await writeFile(identityPath,
        `${nonce}\n${liveRunner.pid}\n${startedAt}\n${runnerInstanceId}\n${liveFingerprint}\n`);
      const cleanup = spawnSync("sh", ["-c", REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
        "paperclip-runner-identity-failure-cleanup", identityPath, nonce, runnerInstanceId,
        REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT], { encoding: "utf8", timeout: 10_000 });
      expect(cleanup.status).toBe(0);
      await expect(access(identityPath)).rejects.toThrow();

      const exitingPid = exitingProcess.pid;
      const exitingFingerprint = await fingerprint(exitingPid);
      exitingProcess.kill("SIGTERM");
      await new Promise<void>(resolve => exitingProcess.once("exit", () => resolve()));
      await writeFile(identityPath,
        `${nonce}\n${exitingPid}\n${startedAt}\n${runnerInstanceId}\n${exitingFingerprint}\n`);
      expect(runCheck(exitingPid).status).toBe(3);

      const zombiePid = Number(await new Promise<string>((resolve, reject) => {
        let buffer = "";
        parent.once("error", reject);
        parentOutput.on("data", chunk => {
          buffer += chunk.toString();
          const newline = buffer.indexOf("\n");
          if (newline >= 0) resolve(buffer.slice(0, newline));
        });
      }));
      expect(Number.isSafeInteger(zombiePid) && zombiePid > 0).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 25));
      await writeFile(identityPath, `${nonce}\n${zombiePid}\n${new Date().toISOString()}\n${runnerInstanceId}\n\n`);
      expect(runCheck(zombiePid).status).toBe(3);

    } finally {
      await Promise.all([liveRunner, unrelatedLiveProcess, exitingProcess, parent].map(stop));
    }
  });

  it("accepts helper-generated state probes and restore archives only at this session's roots", async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "native-harness-state-owner-"));
    const companyId = randomUUID();
    const runId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const sessionId = randomUUID();
    const taskRoot = join(fixtureRoot, "task");
    const sessionRoot = posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions",
      createHash("sha256").update(sessionId).digest("hex"));
    const runnerRoot = posix.join(sessionRoot, "runner");
    const execution = parseNativeExecutionInput({
      schema: "paperclip.native-execution-input.v4", executionMode: "default", planningContext: null,
      binding: { companyId, runId, issueId, agentId, executionWorkspaceId: runId },
      task: { identifier: "STATE-1", title: "State staging", description: null, prompt: "Resume the session.", workMode: "standard" },
      workspace: { cwd: taskRoot, repoUrl: null, repoRef: null, branchName: null },
      session: { normalizedSessionId: sessionId, driverKind: "opencode_server", protocolVersion: 1,
        lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
      provider: { kind: "opencode", model: "openai/gpt-5", permissionMode: "allow" },
      completionContract: { id: "contract", sha256: "a".repeat(64), schemaVersion: "paperclip.completion-contract.v1",
        contract: { revision: "1", objective: "Resume the session.", criteria: [{ id: "objective", requirement: "Resume safely." }] } },
      interactionResponses: [], credentialBindings: [], runtimeContext: nativeRuntimeContextFixture(),
    });
    const sourceRoot = join(fixtureRoot, "state");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(sourceRoot, "runner-state.json"), "{}\n");
    const archiveBase64 = execFileSync("tar", ["-czf", "-", "-C", sourceRoot, "."], { encoding: "buffer" }).toString("base64");
    const execute = vi.fn(async (commandInput: { command: string; args?: string[]; stdin?: string }) =>
      ({ exitCode: 0, timedOut: false,
        stdout: commandInput.args?.[1]?.includes("| base64") ? archiveBase64 : "", stderr: "" }));
    const runner = { execute, syncIn: vi.fn(async () => ({ operations: [] })) } as any;
    const target = { kind: "remote", transport: "sandbox", remoteCwd: taskRoot } as any;

    await remoteRunnerPathExists({ runner, path: posix.join(runnerRoot, "runner-state.json"), kind: "file", nativeHarnessState: true });
    await stageRemoteRunnerDirectory({ target, runner, sourcePath: sourceRoot, targetPath: runnerRoot,
      mode: 0o700, nativePreparationPurpose: "native_harness_state" });
    await syncRemoteRunnerDirectoryOut({ runner: { execute } as any, sourcePath: runnerRoot,
      targetPath: join(fixtureRoot, "backup", "runner"), mode: 0o700, nativeHarnessState: true });
    const requests = execute.mock.calls.map(([commandInput]) => ({
      argv: [commandInput.command, ...(commandInput.args ?? [])], cwd: taskRoot,
      stdinBase64: Buffer.from(commandInput.stdin ?? "", "utf8").toString("base64"), env: {},
    } as unknown as RuntimeSandboxExecRelayRequest));
    for (const request of requests) expect(exactNativeHarnessStateCommand({ request, taskRoot, execution, runId })).toBe(true);
    expect(requests.some(request => request.argv[2] === `tar -czf - -C '${runnerRoot}' . | base64`)).toBe(true);
    const probe = requests[0]!;
    expect(exactNativeHarnessStateCommand({ request: { ...probe, argv: ["sh", "-c", `test -f '${posix.join(sessionRoot, "other", "runner-state.json")}'`] }, taskRoot, execution, runId })).toBe(false);
    expect(exactNativeHarnessStateCommand({ request: probe, taskRoot, execution: parseNativeExecutionInput({
      ...execution, session: { ...execution.session, normalizedSessionId: randomUUID() },
    }), runId })).toBe(false);
    expect(exactNativeHarnessStateCommand({ request: { ...probe, cwd: posix.join(taskRoot, "other") }, taskRoot, execution, runId })).toBe(false);

    const runnerInstanceId = randomUUID();
    let launchNonce = "";
    let monitorAttempts = 0;
    const launcherCommands: Array<{ command: string; args?: string[]; stdin?: string }> = [];
    const launcherRunner = { execute: vi.fn(async (commandInput: { command: string; args?: string[]; stdin?: string }) => {
      launcherCommands.push(commandInput);
      const args = commandInput.args ?? [];
      const label = args[2];
      if (label === "paperclip-runner-launch") {
        launchNonce = args[4] ?? "";
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      }
      if (label === "paperclip-runner-process-identity")
        return { exitCode: 0, timedOut: false,
          stdout: `${launchNonce}\n4321\n2026-10-28T00:00:00.000Z\n${runnerInstanceId}\n`, stderr: "" };
      if (label === "paperclip-runner-monitor") {
        monitorAttempts++;
        if (monitorAttempts === 1) throw new Error("runner_process_status_unavailable");
        return { exitCode: 3, timedOut: false, stdout: "", stderr: "" };
      }
      if (label === "paperclip-runner-diagnostics")
        return { exitCode: 1, timedOut: false, stdout: "", stderr: "" };
      return { exitCode: 1, timedOut: false, stdout: "", stderr: "" };
    }) };
    const launcher = createRemoteRunnerProcessLauncher({
      target, runner: launcherRunner as any, nativeHarnessState: true,
      remoteBinary: posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "bin", "paperclip-runnerd"),
      processIdentityPath: posix.join(runnerRoot, "runner-process.identity"), stateDirectory: runnerRoot,
      diagnosticsDirectory: posix.join(sessionRoot, "diagnostics"), runnerInstanceId,
    });
    const handle = launcher({ command: "/controller/paperclip-runnerd", args: ["--runner-id", runnerInstanceId],
      cwd: "/controller", environment: {} });
    await handle.completion;
    expect(handle.child.kill("SIGTERM")).toBe(true);
    await vi.waitFor(() => expect(launcherCommands.some(commandInput =>
      commandInput.args?.[2] === "paperclip-runner-signal")).toBe(true));
    expect(monitorAttempts).toBe(2);
    const monitor = launcherCommands.find(commandInput => commandInput.args?.[2] === "paperclip-runner-monitor")!;
    const monitorRequest = { argv: [monitor.command, ...(monitor.args ?? [])], cwd: taskRoot,
      stdinBase64: "", env: {} } as unknown as RuntimeSandboxExecRelayRequest;
    expect(exactNativeHarnessStateCommand({ request: monitorRequest, taskRoot, execution, runId })).toBe(true);
    expect(exactNativeRunnerMonitorStatusCommand({ request: monitorRequest, taskRoot, execution, runId })).toBe(true);
    expect(nativeRelayClaimFailureStatus("CLAIMED", exactNativeRunnerMonitorStatusCommand({
      request: monitorRequest, taskRoot, execution, runId,
    }))).toBe("FAILED");

    const signal = launcherCommands.find(commandInput => commandInput.args?.[2] === "paperclip-runner-signal")!;
    const signalRequest = { argv: [signal.command, ...(signal.args ?? [])], cwd: taskRoot,
      stdinBase64: "", env: {} } as unknown as RuntimeSandboxExecRelayRequest;
    expect(exactNativeHarnessStateCommand({ request: signalRequest, taskRoot, execution, runId })).toBe(true);
    expect(exactNativeHarnessStateCommand({ request: { ...signalRequest,
      argv: [...signalRequest.argv.slice(0, 2), `${signalRequest.argv[2]}; true`, ...signalRequest.argv.slice(3)] },
      taskRoot, execution, runId })).toBe(false);
    expect(exactNativeHarnessStateCommand({ request: { ...signalRequest,
      argv: [...signalRequest.argv.slice(0, 2), signalRequest.argv[2]!.replace("kill -TERM", "kill -HUP"),
        ...signalRequest.argv.slice(3)] }, taskRoot, execution, runId })).toBe(false);
    expect(exactNativeHarnessStateCommand({ request: { ...signalRequest,
      argv: [...signalRequest.argv.slice(0, 4), posix.join(taskRoot, "other", "runner-process.identity"),
        ...signalRequest.argv.slice(5)] }, taskRoot, execution, runId })).toBe(false);
    expect(exactNativeHarnessStateCommand({ request: { ...signalRequest,
      argv: [...signalRequest.argv.slice(0, 7), "0"] }, taskRoot, execution, runId })).toBe(false);
    expect(exactNativeHarnessStateCommand({ request: { ...signalRequest, cwd: posix.join(taskRoot, "other") },
      taskRoot, execution, runId })).toBe(false);
    expect(exactNativeHarnessStateCommand({ request: { ...signalRequest, stdinBase64: Buffer.from("write").toString("base64") },
      taskRoot, execution, runId })).toBe(false);
    expect(exactNativeHarnessStateCommand({ request: { ...signalRequest,
      env: { PAPERCLIP_SANDBOX_BROKER_TOKEN: "test-only" } }, taskRoot, execution, runId })).toBe(false);
    expect(exactNativeHarnessStateCommand({ request: { ...signalRequest,
      modelBrokerCredential: { capabilityToken: "test-only" } as any }, taskRoot, execution, runId })).toBe(false);
    expect(exactNativeHarnessStateCommand({ request: { ...signalRequest,
      brokerCredential: { capabilityToken: "test-only" } as any }, taskRoot, execution, runId })).toBe(false);
    expect(nativeRelayClaimFailureStatus("CLAIMED",
      exactNativeRunnerMonitorStatusCommand({ request: signalRequest, taskRoot, execution, runId }))).toBe("CLAIMED");
    const cleanupRequest = { argv: ["sh", "-c", REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
      "paperclip-runner-identity-failure-cleanup", posix.join(runnerRoot, "runner-process.identity"),
      randomUUID(), runnerInstanceId, REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT], cwd: taskRoot,
      stdinBase64: "", env: {} } as unknown as RuntimeSandboxExecRelayRequest;
    expect(exactNativeHarnessStateCommand({ request: cleanupRequest, taskRoot, execution, runId })).toBe(true);
    expect(nativeRelayClaimFailureStatus("CLAIMED",
      exactNativeRunnerMonitorStatusCommand({ request: cleanupRequest, taskRoot, execution, runId }))).toBe("CLAIMED");
    expect(exactNativeHarnessStateCommand({ request: { ...cleanupRequest,
      argv: [...cleanupRequest.argv.slice(0, 4), posix.join(taskRoot, "other", "runner-process.identity"),
        ...cleanupRequest.argv.slice(5)] }, taskRoot, execution, runId })).toBe(false);
    expect(exactNativeHarnessStateCommand({ request: { ...cleanupRequest,
      argv: [...cleanupRequest.argv.slice(0, 7), "sh -c true"] }, taskRoot, execution, runId })).toBe(false);

    // The exception is limited to this exact read-only command shape. A
    // startup request or state write remains an ordinary uncertain effect.
    const launch = launcherCommands.find(commandInput => commandInput.args?.[2] === "paperclip-runner-launch")!;
    const launchRequest = { argv: [launch.command, ...(launch.args ?? [])], cwd: taskRoot,
      stdinBase64: "", env: {} } as unknown as RuntimeSandboxExecRelayRequest;
    const startupIsMonitor = exactNativeRunnerMonitorStatusCommand({ request: launchRequest, taskRoot, execution, runId });
    expect(startupIsMonitor).toBe(false);
    expect(nativeRelayClaimFailureStatus("CLAIMED", startupIsMonitor)).toBe("CLAIMED");
    const restoreRequest = requests.find(request => request.argv[2]?.startsWith("umask 077; mkdir -p"))!;
    expect(exactNativeHarnessStateCommand({ request: restoreRequest, taskRoot, execution, runId })).toBe(true);
    const restoreIsMonitor = exactNativeRunnerMonitorStatusCommand({ request: restoreRequest, taskRoot, execution, runId });
    expect(restoreIsMonitor).toBe(false);
    expect(nativeRelayClaimFailureStatus("CLAIMED", restoreIsMonitor)).toBe("CLAIMED");
    expect(nativeRelayClaimFailureStatus("PENDING", false)).toBe("FAILED");
    expect(exactNativeRunnerMonitorStatusCommand({ request: { ...monitorRequest,
      argv: [...monitorRequest.argv, "extra"] }, taskRoot, execution, runId })).toBe(false);
    expect(exactNativeRunnerMonitorStatusCommand({ request: { ...monitorRequest,
      argv: ["sh", "-c", `${monitorRequest.argv[2]}; true`, ...monitorRequest.argv.slice(3)] }, taskRoot, execution, runId })).toBe(false);
    expect(exactNativeRunnerMonitorStatusCommand({ request: { ...monitorRequest,
      argv: [...monitorRequest.argv.slice(0, 4), posix.join(taskRoot, "other", "runner-process.identity"), ...monitorRequest.argv.slice(5)] }, taskRoot, execution, runId })).toBe(false);
    expect(exactNativeRunnerMonitorStatusCommand({ request: { ...monitorRequest, stdinBase64: Buffer.from("write").toString("base64") }, taskRoot, execution, runId })).toBe(false);

    let stillAuthorized = true;
    let revokedMonitorAttempts = 0;
    let launchCount = 0;
    const revokedRunner = { execute: vi.fn(async (commandInput: { command: string; args?: string[] }) => {
      const label = commandInput.args?.[2];
      if (label === "paperclip-runner-launch") {
        launchCount++;
        launchNonce = commandInput.args?.[4] ?? "";
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      }
      if (label === "paperclip-runner-process-identity")
        return { exitCode: 0, timedOut: false, stdout: `${launchNonce}\n4321\n2026-10-28T00:00:00.000Z\n${runnerInstanceId}\nlinux:abc-123:456\n`, stderr: "" };
      if (label === "paperclip-runner-monitor") {
        revokedMonitorAttempts++;
        if (!stillAuthorized) throw new Error("Current active native Task run is required");
        stillAuthorized = false;
        throw new Error("runner_process_status_unavailable");
      }
      return { exitCode: 1, timedOut: false, stdout: "", stderr: "" };
    }) };
    const revokedLauncher = createRemoteRunnerProcessLauncher({
      target, runner: revokedRunner as any, nativeHarnessState: true,
      remoteBinary: posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "bin", "paperclip-runnerd"),
      processIdentityPath: posix.join(runnerRoot, "runner-process.identity"), stateDirectory: runnerRoot,
      diagnosticsDirectory: posix.join(sessionRoot, "diagnostics"), runnerInstanceId,
    });
    await expect(revokedLauncher({ command: "/controller/paperclip-runnerd", args: ["--runner-id", runnerInstanceId],
      cwd: "/controller", environment: {} }).completion).rejects.toThrow("Current active native Task run is required");
    expect(revokedMonitorAttempts).toBe(2);
    expect(launchCount).toBe(1);

    let unavailableMonitorAttempts = 0;
    let unavailableLaunchCount = 0;
    const unavailableRunner = { execute: vi.fn(async (commandInput: { args?: string[] }) => {
      const label = commandInput.args?.[2];
      if (label === "paperclip-runner-launch") {
        unavailableLaunchCount++;
        launchNonce = commandInput.args?.[4] ?? "";
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      }
      if (label === "paperclip-runner-process-identity")
        return { exitCode: 0, timedOut: false,
          stdout: `${launchNonce}\n4321\n2026-10-28T00:00:00.000Z\n${runnerInstanceId}\nlinux:abc-123:456\n`, stderr: "" };
      if (label === "paperclip-runner-monitor") {
        unavailableMonitorAttempts++;
        throw new Error("runner_process_status_unavailable");
      }
      return { exitCode: 1, timedOut: false, stdout: "", stderr: "" };
    }) };
    const unavailableLauncher = createRemoteRunnerProcessLauncher({
      target, runner: unavailableRunner as any, nativeHarnessState: true,
      remoteBinary: posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "bin", "paperclip-runnerd"),
      processIdentityPath: posix.join(runnerRoot, "runner-process.identity"), stateDirectory: runnerRoot,
      diagnosticsDirectory: posix.join(sessionRoot, "diagnostics"), runnerInstanceId,
    });
    await expect(unavailableLauncher({ command: "/controller/paperclip-runnerd", args: ["--runner-id", runnerInstanceId],
      cwd: "/controller", environment: {} }).completion).rejects.toThrow("runner_process_status_unavailable");
    expect(unavailableMonitorAttempts).toBe(4); // Initial observation plus at most three status retries.
    expect(unavailableLaunchCount).toBe(1); // Unknown status never restarts the process.
  });

  it("authorizes only the exact session fence and serializes its real lock outside the removable session root", async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "native-session-filesystem-fence-"));
    const taskRoot = join(fixtureRoot, "task");
    const companyId = randomUUID();
    const runId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const sessionId = randomUUID();
    const digest = createHash("sha256").update(sessionId).digest("hex");
    const execution = parseNativeExecutionInput({
      schema: "paperclip.native-execution-input.v4", executionMode: "default", planningContext: null,
      binding: { companyId, runId, issueId, agentId, executionWorkspaceId: runId },
      task: { identifier: "FENCE-1", title: "Fence session writes", description: null, prompt: "Keep session writes serialized.", workMode: "standard" },
      workspace: { cwd: taskRoot, repoUrl: null, repoRef: null, branchName: null },
      session: { normalizedSessionId: sessionId, driverKind: "opencode_server", protocolVersion: 1,
        lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
      provider: { kind: "opencode", model: "openai/gpt-5", permissionMode: "allow" },
      completionContract: { id: "contract", sha256: "a".repeat(64), schemaVersion: "paperclip.completion-contract.v1",
        contract: { revision: "1", objective: "Fence session writes.", criteria: [{ id: "objective", requirement: "Keep it serialized." }] } },
      interactionResponses: [], credentialBindings: [], runtimeContext: nativeRuntimeContextFixture(),
    });
    const nonce = randomUUID();
    const request = (script: string, label: string) => ({
      argv: ["sh", "-c", script, label, taskRoot, digest, nonce], cwd: taskRoot, stdinBase64: "", env: {},
    } as unknown as RuntimeSandboxExecRelayRequest);
    const acquire = request(REMOTE_NATIVE_SESSION_FENCE_ACQUIRE_SCRIPT, "paperclip-native-session-fence-acquire");
    expect(exactNativeSessionFilesystemFenceCommand({ request: acquire, taskRoot, execution })).toBe(true);
    expect(exactNativeHarnessStateCommand({ request: acquire, taskRoot, execution, runId })).toBe(true);
    expect(exactNativeSessionFilesystemFenceCommand({ request: { ...acquire,
      argv: [...acquire.argv.slice(0, 3), "paperclip-native-session-fence-release", ...acquire.argv.slice(4)] }, taskRoot, execution })).toBe(false);
    expect(exactNativeSessionFilesystemFenceCommand({ request: { ...acquire,
      argv: [...acquire.argv.slice(0, 5), `${"0".repeat(64)}`, ...acquire.argv.slice(6)] }, taskRoot, execution })).toBe(false);
    expect(exactNativeSessionFilesystemFenceCommand({ request: { ...acquire, cwd: join(taskRoot, "other") }, taskRoot, execution })).toBe(false);
    expect(exactNativeSessionFilesystemFenceCommand({ request: { ...acquire, env: { PATH: "/tmp" } }, taskRoot, execution })).toBe(false);
    expect(exactNativeSessionFilesystemFenceCommand({ request: { ...acquire,
      modelBrokerCredential: { capabilityToken: "test-only" } as any }, taskRoot, execution })).toBe(false);

    const sessionsRoot = join(taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions");
    const sessionRoot = join(sessionsRoot, digest);
    const lockPath = join(sessionsRoot, `.${digest}.lock`);
    const neighborRoot = join(sessionsRoot, "f".repeat(64));
    await mkdir(sessionRoot, { recursive: true, mode: 0o700 });
    await mkdir(neighborRoot, { recursive: true, mode: 0o700 });
    const run = (script: string, label: string, runNonce = nonce) => spawnSync("sh", ["-c", script,
      label, taskRoot, digest, runNonce], { encoding: "utf8" });
    expect(run(REMOTE_NATIVE_SESSION_FENCE_ACQUIRE_SCRIPT, "paperclip-native-session-fence-acquire").status).toBe(0);
    const lockStat = await stat(lockPath);
    expect(lockStat.isDirectory()).toBe(true);
    expect(lockStat.mode & 0o777).toBe(0o700);
    const ownerPath = join(lockPath, "owner");
    expect((await stat(ownerPath)).mode & 0o777).toBe(0o600);
    expect(run(REMOTE_NATIVE_SESSION_FENCE_ACQUIRE_SCRIPT, "paperclip-native-session-fence-acquire").status).not.toBe(0);
    expect(run(REMOTE_NATIVE_SESSION_FENCE_RELEASE_SCRIPT, "paperclip-native-session-fence-release", randomUUID()).status).not.toBe(0);
    expect(await access(lockPath).then(() => true, () => false)).toBe(true);
    expect(run(REMOTE_NATIVE_SESSION_FENCE_RELEASE_SCRIPT, "paperclip-native-session-fence-release").status).toBe(0);
    expect(await access(lockPath).then(() => true, () => false)).toBe(false);
    await expect(access(sessionRoot)).resolves.toBeUndefined();
    await expect(access(neighborRoot)).resolves.toBeUndefined();
    const outsideLockTarget = join(fixtureRoot, "outside-lock-target");
    await mkdir(outsideLockTarget, { mode: 0o700 });
    await symlink(outsideLockTarget, lockPath);
    expect(run(REMOTE_NATIVE_SESSION_FENCE_ACQUIRE_SCRIPT, "paperclip-native-session-fence-acquire").status).not.toBe(0);
    expect((await stat(outsideLockTarget)).isDirectory()).toBe(true);
    expect(await access(join(outsideLockTarget, "owner")).then(() => true, () => false)).toBe(false);
  });

  it("authorizes only the fixed remote erasure command for the locator's exact session path", () => {
    const remoteCwd = "/workspace/private-task";
    const locator = createRemoteRuntimeAssetLocator({ companyId: randomUUID(), runId: randomUUID(),
      environmentId: randomUUID(), environmentLeaseId: randomUUID(), provider: "sandbox-fixture",
      providerLeaseId: "lease-fixture", runnerInstanceId: randomUUID(), normalizedSessionId: randomUUID(), remoteCwd });
    const argv = ["sh", "-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT, "paperclip-native-asset-erasure",
      remoteCwd, locator.normalizedSessionIdDigest, locator.runId, locator.runnerInstanceId,
      locator.environmentLeaseId, locator.providerLeaseId, locator.normalizedSessionIdDigest,
      REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT, REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT];
    const request = { argv, cwd: remoteCwd, stdinBase64: "", env: {} } as unknown as RuntimeSandboxExecRelayRequest;
    expect(exactNativeRuntimeAssetErasureCommand({ request, locator, remoteCwd })).toBe(true);
    expect(exactNativeRuntimeAssetErasureCommand({ request: { ...request,
      argv: [...argv.slice(0, 4), "/workspace/outside", ...argv.slice(5)] }, locator, remoteCwd })).toBe(false);
    expect(exactNativeRuntimeAssetErasureCommand({ request: { ...request,
      argv: [...argv.slice(0, 5), "f".repeat(64), ...argv.slice(6)] }, locator, remoteCwd })).toBe(false);
    expect(exactNativeRuntimeAssetErasureCommand({ request: { ...request, cwd: `${remoteCwd}/other` }, locator, remoteCwd })).toBe(false);
    expect(exactNativeRuntimeAssetErasureCommand({ request: { ...request, stdinBase64: "eA==" }, locator, remoteCwd })).toBe(false);
    expect(exactNativeRuntimeAssetErasureCommand({ request: { ...request, env: { PATH: "/tmp" } }, locator, remoteCwd })).toBe(false);
    expect(exactNativeRuntimeAssetErasureCommand({ request: { ...request,
      brokerCredential: { capabilityToken: "test-only" } as any }, locator, remoteCwd })).toBe(false);
    expect(exactNativeRuntimeAssetErasureCommand({ request: { ...request,
      modelBrokerCredential: { capabilityToken: "test-only" } as any }, locator, remoteCwd })).toBe(false);
  });
});
