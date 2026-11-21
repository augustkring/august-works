import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRemoteFileChunkReadCommand, buildRemoteFileSizeCommand, buildRemoteRemovePathCommand,
  prepareCommandManagedRuntime } from "@paperclipai/adapter-utils/command-managed-runtime";
import { buildWorkspaceRestoreTarCommand, serverVerifiedWorkspaceRestoreExclude } from "@paperclipai/adapter-utils/sandbox-managed-runtime";
import type { RuntimeSandboxExecRelayRequest } from "@paperclipai/shared";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { nativeWorkspaceSyncInternals, prepareNativeWorkspaceSync } from "../native-runtime/native-workspace-sync.js";
import { exactNativeConformanceWorkspaceRestoreCommand, exactNativeWorkspacePrepareCommand } from "./control.js";

type RecordedCommand = { command: string; args?: string[]; cwd?: string; stdin?: string; nativePreparationPurpose?: string };

/** Runs each sandbox command for real against a local stand-in for the
 * sandbox task root, so the restore produces and reads an actual archive. */
function localSandboxRunner(recorded: RecordedCommand[]) {
  return {
    execute: async (input: RecordedCommand & { timeoutMs?: number }) => {
      recorded.push({ command: input.command, args: input.args, cwd: input.cwd, stdin: input.stdin,
        nativePreparationPurpose: input.nativePreparationPurpose });
      const result = spawnSync(input.command, input.args ?? [], { cwd: input.cwd, input: input.stdin ?? "",
        encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return { exitCode: result.status, signal: null, timedOut: false, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
  };
}

function relayRequest(command: RecordedCommand, taskRoot: string): RuntimeSandboxExecRelayRequest {
  return { argv: [command.command, ...(command.args ?? [])], cwd: command.cwd ?? taskRoot,
    stdinBase64: Buffer.from(command.stdin ?? "", "utf8").toString("base64"), env: {} } as RuntimeSandboxExecRelayRequest;
}

describe("provider-conformance workspace restore owner", () => {
  let fixtureRoot: string | null = null;
  afterEach(async () => {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = null;
  });

  async function fixture() {
    fixtureRoot = await mkdtemp(join(tmpdir(), "native-conformance-restore-"));
    const hostRoot = join(fixtureRoot, "host");
    const taskRoot = join(fixtureRoot, "sandbox", "task");
    const seedRoot = join(fixtureRoot, "seed");
    await Promise.all([mkdir(hostRoot, { recursive: true }), mkdir(taskRoot, { recursive: true }), mkdir(seedRoot, { recursive: true })]);
    const runId = randomUUID();
    const execution = parseNativeExecutionInput({ schema: "paperclip.native-execution-input.v2",
      binding: { companyId: randomUUID(), runId, issueId: randomUUID(), agentId: randomUUID(), executionWorkspaceId: randomUUID() },
      task: { identifier: "CONF-1", title: "Synthetic provider qualification", description: null,
        prompt: "Server-controlled synthetic provider conformance.", workMode: "standard" },
      workspace: { cwd: taskRoot, repoUrl: null, repoRef: null, branchName: null },
      session: { normalizedSessionId: randomUUID(), driverKind: "opencode_server", protocolVersion: 1,
        lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
      provider: { kind: "opencode", model: "anthropic/fixture-model" },
      completionContract: { id: randomUUID(), sha256: "a".repeat(64), schemaVersion: "paperclip.completion-contract.v1",
        contract: { revision: "1", objective: "Probe.", criteria: [{ id: "objective", requirement: "Answer." }] } },
      interactionResponses: [], credentialBindings: [], executionMode: "default", planningContext: null });
    const recorded: RecordedCommand[] = [];
    const target = { kind: "remote", transport: "sandbox", remoteCwd: taskRoot, shellCommand: "sh",
      leaseId: randomUUID(), providerKey: "fixture", timeoutMs: 30_000, runner: localSandboxRunner(recorded) } as const;
    const prepare = (retainForRestore: boolean) => nativeWorkspaceSyncInternals.prepareRuntime({ runId, target: target as never,
      workspaceLocalDir: hostRoot, mode: "host_current", workspaceRepositoryMode: "server_verified_none",
      nativeWorkspacePreparation: true, ...(retainForRestore ? { nativeWorkspaceRestorePreparation: true } : {}),
      durableSeed: { workspaceArchivePath: join(seedRoot, "workspace.tar"), gitArchivePath: join(seedRoot, "git.tar") } });
    return { hostRoot, taskRoot, execution, recorded, target, prepare };
  }

  it("restores through the exact credentialless conformance owner instead of the one-turn model lane", async () => {
    const { hostRoot, taskRoot, execution, recorded, prepare } = await fixture();
    const prepared = await prepare(true);
    const inbound = recorded.splice(0);
    expect(inbound.length).toBeGreaterThan(0);
    for (const command of inbound) {
      expect(command.nativePreparationPurpose).toBe("native_workspace_prepare");
      expect(exactNativeWorkspacePrepareCommand({ request: relayRequest(command, taskRoot), taskRoot, execution })).toBe(true);
    }

    // The probe writes into the sandbox; settle must bring it back.
    await writeFile(join(taskRoot, "probe-output.txt"), "AW_PROBE_MARKER\n");
    await mkdir(join(taskRoot, ".paperclip-runtime", "paperclip-runner"), { recursive: true });
    await writeFile(join(taskRoot, ".paperclip-runtime", "paperclip-runner", "runtime-secret"), "never exported\n");
    await prepared.restoreWorkspace();
    expect(await readFile(join(hostRoot, "probe-output.txt"), "utf8")).toBe("AW_PROBE_MARKER\n");
    await expect(readFile(join(hostRoot, ".paperclip-runtime", "paperclip-runner", "runtime-secret"), "utf8")).rejects.toThrow();

    const restore = recorded.splice(0);
    const archive = posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "workspace-download.tar");
    expect(restore.map(command => command.args?.[1])).toEqual([
      buildWorkspaceRestoreTarCommand({ workspaceRemoteDir: taskRoot, archivePath: archive, exclude: serverVerifiedWorkspaceRestoreExclude() }),
      buildRemoteFileSizeCommand(archive),
      buildRemoteFileChunkReadCommand(archive, 0),
      buildRemoteRemovePathCommand(archive),
    ]);
    for (const command of restore) {
      // Before the fix the purpose was cleared here, so RuntimeControl sent the
      // restore down the model-broker lane and refused it after the probe turn.
      expect(command.nativePreparationPurpose).toBe("native_workspace_prepare");
      const request = relayRequest(command, taskRoot);
      expect(exactNativeConformanceWorkspaceRestoreCommand({ request, taskRoot, execution })).toBe(true);
      // The shared Worker/conversation matcher is not widened.
      expect(exactNativeWorkspacePrepareCommand({ request, taskRoot, execution })).toBe(false);
    }
  });

  it("keeps clearing the preparation purpose for other workspace owners", async () => {
    const { taskRoot, recorded, prepare } = await fixture();
    const prepared = await prepare(false);
    recorded.splice(0);
    await writeFile(join(taskRoot, "output.txt"), "x\n");
    await prepared.restoreWorkspace();
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.every(command => command.nativePreparationPurpose === undefined)).toBe(true);
  });

  it("rejects restore commands outside the exact conformance root, archive, input and credential scope", async () => {
    const { taskRoot, execution } = await fixture();
    const archive = posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "workspace-download.tar");
    const tar = buildWorkspaceRestoreTarCommand({ workspaceRemoteDir: taskRoot, archivePath: archive, exclude: serverVerifiedWorkspaceRestoreExclude() });
    const base = { argv: ["sh", "-c", tar], cwd: taskRoot, stdinBase64: "", env: {} } as unknown as RuntimeSandboxExecRelayRequest;
    const accepts = (request: Partial<RuntimeSandboxExecRelayRequest>, root = taskRoot, input = execution) =>
      exactNativeConformanceWorkspaceRestoreCommand({ request: { ...base, ...request } as RuntimeSandboxExecRelayRequest, taskRoot: root, execution: input });
    const script = (value: string) => ({ argv: ["sh", "-c", value] });
    expect(accepts({})).toBe(true);
    expect(accepts(script(buildRemoteFileChunkReadCommand(archive, 1023)))).toBe(true);

    const sibling = posix.join(posix.dirname(taskRoot), "peer-task");
    const siblingArchive = posix.join(sibling, ".paperclip-runtime", "paperclip-runner", "workspace-download.tar");
    // Another task root, even with a matching request, is not this owner.
    expect(accepts({}, sibling)).toBe(false);
    expect(accepts({ cwd: sibling })).toBe(false);
    expect(accepts(script(buildWorkspaceRestoreTarCommand({ workspaceRemoteDir: sibling, archivePath: siblingArchive,
      exclude: serverVerifiedWorkspaceRestoreExclude() })))).toBe(false);
    // Exporting the runtime root, or archiving to another path, is refused.
    expect(accepts(script(buildWorkspaceRestoreTarCommand({ workspaceRemoteDir: taskRoot, archivePath: archive,
      exclude: serverVerifiedWorkspaceRestoreExclude().filter(entry => entry !== ".paperclip-runtime") })))).toBe(false);
    expect(accepts(script(buildWorkspaceRestoreTarCommand({ workspaceRemoteDir: taskRoot, archivePath: `${archive}.other`,
      exclude: serverVerifiedWorkspaceRestoreExclude() })))).toBe(false);
    // Reads and removals are limited to the fixed archive and bounded chunks.
    expect(accepts(script(buildRemoteFileChunkReadCommand("/etc/shadow", 0)))).toBe(false);
    expect(accepts(script(buildRemoteFileChunkReadCommand(posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "runtime-secret"), 0)))).toBe(false);
    expect(accepts(script(buildRemoteFileSizeCommand(siblingArchive)))).toBe(false);
    expect(accepts(script(buildRemoteFileChunkReadCommand(archive, 1024)))).toBe(false);
    expect(accepts(script(buildRemoteFileChunkReadCommand(archive, 0).replace(" skip=0 ", " skip=00 ")))).toBe(false);
    expect(accepts(script(buildRemoteRemovePathCommand(taskRoot)))).toBe(false);
    expect(accepts(script(`${buildRemoteRemovePathCommand(archive)}; curl https://attacker.invalid`))).toBe(false);
    expect(accepts(script("printf attacker"))).toBe(false);
    // No stdin, environment, other shell form or other provider.
    expect(accepts({ stdinBase64: Buffer.from("x").toString("base64") })).toBe(false);
    expect(accepts({ env: { PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: "https://broker.invalid" } })).toBe(false);
    expect(accepts({ argv: ["bash", "-c", tar] })).toBe(false);
    expect(accepts({ argv: ["sh", "-c", tar, "extra"] })).toBe(false);
    expect(accepts({}, taskRoot, { ...execution, provider: { ...execution.provider, kind: "codex" } } as never)).toBe(false);
    expect(accepts({}, taskRoot, { ...execution, workspace: { ...execution.workspace, cwd: sibling } })).toBe(false);
  });

  it("refuses restore-time preparation outside the server-verified conformance owner", async () => {
    const { hostRoot, taskRoot, target } = await fixture();
    await expect(prepareCommandManagedRuntime({ runner: target.runner as never,
      spec: { remoteCwd: taskRoot, shellCommand: "sh", leaseId: target.leaseId, providerKey: "fixture", timeoutMs: 30_000 },
      adapterKey: "paperclip-runner", workspaceLocalDir: hostRoot, workspaceRemoteDir: taskRoot,
      workspaceRepositoryMode: "discover", nativeWorkspacePreparation: true, nativeWorkspaceRestorePreparation: true }))
      .rejects.toThrow("native_workspace_restore_scope_invalid");
    await expect(prepareCommandManagedRuntime({ runner: target.runner as never,
      spec: { remoteCwd: taskRoot, shellCommand: "sh", leaseId: target.leaseId, providerKey: "fixture", timeoutMs: 30_000 },
      adapterKey: "paperclip-runner", workspaceLocalDir: hostRoot, workspaceRemoteDir: taskRoot,
      workspaceRepositoryMode: "server_verified_none", nativeWorkspaceRestorePreparation: true }))
      .rejects.toThrow("native_workspace_restore_scope_invalid");
    // The workspace-sync owner also requires the clean-adoption conformance contract.
    await expect(prepareNativeWorkspaceSync({ db: {} as never, runId: randomUUID(), companyId: randomUUID(),
      workspaceId: randomUUID(), workspaceLocalDir: hostRoot, target: target as never, lease: {} as never,
      workspaceRepositoryMode: "server_verified_none", nativeWorkspacePreparation: true,
      nativeWorkspaceRestorePreparation: true })).rejects.toThrow("native_workspace_restore_scope_invalid");
  });
});
