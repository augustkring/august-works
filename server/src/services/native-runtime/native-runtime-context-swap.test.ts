import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeSandboxExecRelayRequest } from "@paperclipai/shared";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { nativeSha256 } from "./canonical.js";
import { nativeRuntimeContextFixture } from "./runtime-context.test-fixture.js";
import {
  nativeRuntimeAssetCopyMatchesDigest,
  nativeRuntimeContextStagingPath,
  stageRemoteRuntimeContextDirectoryBySwap,
} from "./native-session-executor.js";
import { exactNativeRuntimeContextPreparationOwner, exactNativeRuntimeContextSwapCommand } from "../runtime/control.js";
import { REMOTE_RUNTIME_CONTEXT_READBACK_SCRIPT, REMOTE_RUNTIME_CONTEXT_SWAP_SCRIPT } from "./remote-runner-identity.js";

type Command = { command: string; args?: string[]; stdin?: string; cwd?: string; nativePreparationPurpose?: string };

/** Canonical `paperclip.runtime-asset-manifest.v1` bundle digest. */
function bundleDigest(files: Record<string, { content: string; mode: number }>): string {
  const manifest = Object.entries(files)
    .map(([path, file]) => ({ path, sha256: createHash("sha256").update(file.content).digest("hex"),
      mode: file.mode & 0o555, size: Buffer.byteLength(file.content) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

async function writeBundle(root: string, files: Record<string, { content: string; mode: number }>) {
  await mkdir(root, { recursive: true });
  for (const [path, file] of Object.entries(files)) {
    await mkdir(join(root, posix.dirname(path)), { recursive: true });
    await writeFile(join(root, path), file.content);
    await chmod(join(root, path), file.mode);
  }
}

async function makeWritable(root: string): Promise<void> {
  spawnSync("chmod", ["-R", "u+w", root]);
}

describe("Worker runtime-context per-Run staging and verified swap (CONF15 W)", () => {
  let fixtureRoot: string | null = null;
  afterEach(async () => {
    if (fixtureRoot) {
      await makeWritable(fixtureRoot);
      await rm(fixtureRoot, { recursive: true, force: true });
    }
    fixtureRoot = null;
  });

  async function setup() {
    fixtureRoot = await mkdtemp(join(tmpdir(), "native-runtime-context-swap-"));
    const taskRoot = join(fixtureRoot, "task");
    const sessionId = randomUUID();
    const filesystemRoot = posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions",
      createHash("sha256").update(sessionId).digest("hex"), "filesystem");
    await mkdir(filesystemRoot, { recursive: true });
    const targetPath = posix.join(filesystemRoot, "context", "instructions");
    const commands: Command[] = [];
    const runner = {
      execute: async (command: Command) => {
        commands.push(command);
        const result = spawnSync(command.command, command.args ?? [], { cwd: command.cwd ?? taskRoot,
          input: command.stdin, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        return { exitCode: result.status ?? 1, timedOut: false, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
      },
    } as any;
    const target = { kind: "remote", transport: "sandbox", remoteCwd: taskRoot } as any;
    const run1Files = { "AGENTS.md": { content: "Run 1 instructions\n", mode: 0o444 },
      "docs/guide.md": { content: "Run 1 guide\n", mode: 0o444 } };
    const run2Files = { "AGENTS.md": { content: "Run 2 instructions\n", mode: 0o444 } };
    const run1Source = join(fixtureRoot, "run1-source");
    const run2Source = join(fixtureRoot, "run2-source");
    await writeBundle(run1Source, run1Files);
    await writeBundle(run2Source, run2Files);
    const stage = (input: { sourcePath: string; runId: string; priorBundleDigest: () => Promise<string | null>; targetPath?: string }) =>
      stageRemoteRuntimeContextDirectoryBySwap({ target, runner, filesystemRoot, sourcePath: input.sourcePath,
        targetPath: input.targetPath ?? targetPath, runId: input.runId, priorBundleDigest: input.priorBundleDigest });
    const run1Id = randomUUID();
    return { taskRoot, sessionId, filesystemRoot, targetPath, commands, runner, target, run1Files, run2Files,
      run1Source, run2Source, stage, run1Id };
  }

  it("installs into an absent target, then replaces only the verified prior Run content", async () => {
    const f = await setup();
    // Run 1: nothing there yet; no prior digest is consulted.
    await f.stage({ sourcePath: f.run1Source, runId: f.run1Id, priorBundleDigest: async () => { throw new Error("not consulted"); } });
    expect(await readFile(join(f.targetPath, "AGENTS.md"), "utf8")).toBe("Run 1 instructions\n");
    expect(nativeRuntimeAssetCopyMatchesDigest(f.targetPath, bundleDigest(f.run1Files))).toBe(true);
    expect((await readdir(posix.dirname(f.targetPath))).sort()).toEqual(["instructions"]);
    // Run 2 replaces Run 1's read-only folder with its own fresh content.
    const run2Id = randomUUID();
    await f.stage({ sourcePath: f.run2Source, runId: run2Id, priorBundleDigest: async () => bundleDigest(f.run1Files) });
    expect(await readFile(join(f.targetPath, "AGENTS.md"), "utf8")).toBe("Run 2 instructions\n");
    expect(await lstat(join(f.targetPath, "docs")).then(() => true, () => false)).toBe(false);
    expect(nativeRuntimeAssetCopyMatchesDigest(f.targetPath, bundleDigest(f.run2Files))).toBe(true);
    expect((await readdir(posix.dirname(f.targetPath))).sort()).toEqual(["instructions"]);
    // Every command the helper produced is the Worker owner's exact command.
    const execution = parseNativeExecutionInput({
      schema: "paperclip.native-execution-input.v4", executionMode: "default", planningContext: null,
      binding: { companyId: randomUUID(), runId: run2Id, issueId: randomUUID(), agentId: randomUUID(), executionWorkspaceId: run2Id },
      task: { identifier: "CTX-2", title: "Context swap", description: null, prompt: "Resume.", workMode: "standard" },
      workspace: { cwd: f.taskRoot, repoUrl: null, repoRef: null, branchName: null },
      session: { normalizedSessionId: f.sessionId, driverKind: "opencode_server", protocolVersion: 1,
        lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
      provider: { kind: "opencode", model: "openai/gpt-5", permissionMode: "allow" },
      completionContract: { id: "contract", sha256: "a".repeat(64), schemaVersion: "paperclip.completion-contract.v1",
        contract: { revision: "1", objective: "Resume.", criteria: [{ id: "objective", requirement: "Resume safely." }] } },
      interactionResponses: [], credentialBindings: [], runtimeContext: nativeRuntimeContextFixture(),
    });
    const run2Commands = f.commands.slice(f.commands.findIndex(command =>
      command.args?.some(arg => arg.includes(`.staging-${run2Id}`))) - 1);
    expect(run2Commands.map(command => command.args?.[2] ?? "stage"))
      .toEqual(["paperclip-runtime-context-readback", "stage", "paperclip-runtime-context-swap"]);
    const requests = run2Commands.map(command => ({ argv: [command.command, ...(command.args ?? [])], cwd: f.taskRoot,
      stdinBase64: Buffer.from(command.stdin ?? "", "utf8").toString("base64"), env: {} } as unknown as RuntimeSandboxExecRelayRequest));
    expect(run2Commands.every(command => command.nativePreparationPurpose === "native_runtime_context_prepare")).toBe(true);
    const owner = (request: RuntimeSandboxExecRelayRequest, overrides: Record<string, unknown> = {}) =>
      exactNativeRuntimeContextPreparationOwner({ request, taskRoot: f.taskRoot, execution,
        companyId: execution.binding.companyId, runId: run2Id, agentId: execution.binding.agentId,
        responsibleUserId: "user", manifest: { runId: run2Id, agentId: execution.binding.agentId, responsibleUserId: "user" },
        nativeExecutionInput: { fixture: true }, sourceAuthority: { version: 1, executionInputHash: nativeSha256({ fixture: true }) },
        credentialMode: "none", credentialBindingCount: 0, workerStagedSwap: true, ...overrides });
    for (const request of requests) {
      expect(exactNativeRuntimeContextSwapCommand({ request, taskRoot: f.taskRoot, execution, runId: run2Id })).toBe(true);
      expect(owner(request)).toBe(true);
      // The conversation lane and other Runs never admit these commands.
      expect(owner(request, { workerStagedSwap: undefined })).toBe(false);
      expect(exactNativeRuntimeContextSwapCommand({ request, taskRoot: f.taskRoot, execution, runId: randomUUID() })).toBe(false);
      expect(exactNativeRuntimeContextSwapCommand({ request: { ...request, cwd: `${f.taskRoot}/other` },
        taskRoot: f.taskRoot, execution, runId: run2Id })).toBe(false);
    }
    const [readback, stageRequest, swap] = requests as [RuntimeSandboxExecRelayRequest, RuntimeSandboxExecRelayRequest, RuntimeSandboxExecRelayRequest];
    const check = (request: RuntimeSandboxExecRelayRequest) =>
      exactNativeRuntimeContextSwapCommand({ request, taskRoot: f.taskRoot, execution, runId: run2Id });
    // Staging only into this Run's sibling of a fixed target.
    expect(check({ ...stageRequest, argv: ["sh", "-c", stageRequest.argv[2]!.replaceAll(`.staging-${run2Id}`, `.staging-${f.run1Id}`)] })).toBe(false);
    expect(check({ ...stageRequest, argv: ["sh", "-c", stageRequest.argv[2]!.replaceAll(".instructions.staging", ".other.staging")] })).toBe(false);
    // Read-back and swap: fixed scripts, fixed root, fixed targets, no stdin or env.
    expect(check({ ...readback, argv: [...readback.argv.slice(0, 5), posix.join(f.filesystemRoot, "context", "other")] })).toBe(false);
    expect(check({ ...readback, argv: [...readback.argv.slice(0, 4), posix.join(f.filesystemRoot, "other"), readback.argv[5]!] })).toBe(false);
    expect(check({ ...readback, stdinBase64: "eA==" })).toBe(false);
    expect(check({ ...readback, env: { PATH: "/tmp" } })).toBe(false);
    expect(check({ ...readback, argv: [...readback.argv.slice(0, 2), `${readback.argv[2]}; true`, ...readback.argv.slice(3)] })).toBe(false);
    expect(check({ ...swap, argv: [...swap.argv.slice(0, 7), "force"] })).toBe(false);
    expect(check({ ...swap, argv: [...swap.argv.slice(0, 6), nativeRuntimeContextStagingPath(f.targetPath, f.run1Id), swap.argv[7]!] })).toBe(false);
    expect(check({ ...swap, argv: [...swap.argv.slice(0, 5), posix.join(f.filesystemRoot, "context", "skills", "0-abc"), ...swap.argv.slice(6)] })).toBe(false);
    expect(check({ ...swap, argv: [...swap.argv, "extra"] })).toBe(false);
    const unlisted = posix.join(f.filesystemRoot, "context", "other");
    expect(check({ ...swap, argv: [...swap.argv.slice(0, 5), unlisted,
      nativeRuntimeContextStagingPath(unlisted, run2Id), swap.argv[7]!] })).toBe(false);
    expect(check({ ...swap, stdinBase64: "eA==" })).toBe(false);
    expect(check({ ...swap, env: { PATH: "/tmp" } })).toBe(false);
    expect(owner({ ...swap, modelBrokerCredential: {} as never })).toBe(false);
    expect(owner({ ...swap, brokerCredential: {} as never })).toBe(false);
  });

  it("refuses unknown, modified, extended or foreign prior content and an unverified prior Run, leaving it in place", async () => {
    const f = await setup();
    await f.stage({ sourcePath: f.run1Source, runId: f.run1Id, priorBundleDigest: async () => null });
    const before = await readFile(join(f.targetPath, "AGENTS.md"), "utf8");
    const run2 = () => randomUUID();
    // Unknown: the prior Run recorded no bundle for this target.
    await expect(f.stage({ sourcePath: f.run2Source, runId: run2(), priorBundleDigest: async () => null }))
      .rejects.toThrow("native_runtime_context_replace_prior_content_unknown");
    // Foreign: content from another bundle than the prior Run recorded.
    await expect(f.stage({ sourcePath: f.run2Source, runId: run2(), priorBundleDigest: async () => bundleDigest(f.run2Files) }))
      .rejects.toThrow("native_runtime_context_replace_prior_content_modified");
    // The prior Run cannot be verified.
    await expect(f.stage({ sourcePath: f.run2Source, runId: run2(),
      priorBundleDigest: async () => { throw new Error("native_runtime_context_replace_prior_run_unverified"); } }))
      .rejects.toThrow("native_runtime_context_replace_prior_run_unverified");
    expect(await readFile(join(f.targetPath, "AGENTS.md"), "utf8")).toBe(before);
    // Modified: one changed byte, an added file, an added empty directory.
    await makeWritable(f.targetPath);
    await writeFile(join(f.targetPath, "AGENTS.md"), "Run 1 instructionz\n");
    await expect(f.stage({ sourcePath: f.run2Source, runId: run2(), priorBundleDigest: async () => bundleDigest(f.run1Files) }))
      .rejects.toThrow("native_runtime_context_replace_prior_content_modified");
    await writeFile(join(f.targetPath, "AGENTS.md"), before);
    await writeFile(join(f.targetPath, "extra.md"), "planted\n");
    await expect(f.stage({ sourcePath: f.run2Source, runId: run2(), priorBundleDigest: async () => bundleDigest(f.run1Files) }))
      .rejects.toThrow("native_runtime_context_replace_prior_content_modified");
    await rm(join(f.targetPath, "extra.md"));
    await mkdir(join(f.targetPath, "planted-directory"));
    await expect(f.stage({ sourcePath: f.run2Source, runId: run2(), priorBundleDigest: async () => bundleDigest(f.run1Files) }))
      .rejects.toThrow("native_runtime_context_replace_prior_content_modified");
    await rm(join(f.targetPath, "planted-directory"), { recursive: true });
    expect(nativeRuntimeAssetCopyMatchesDigest(f.targetPath, bundleDigest(f.run1Files))).toBe(true);
    expect(await readFile(join(f.targetPath, "AGENTS.md"), "utf8")).toBe(before);
  });

  it("refuses symlinks and escapes on the target path, inside the target, or outside the session filesystem root", async () => {
    const f = await setup();
    const outside = join(fixtureRoot!, "outside");
    await writeBundle(outside, f.run1Files);
    const digest = async () => bundleDigest(f.run1Files);
    // The target itself is a symlink to matching content elsewhere.
    await mkdir(posix.dirname(f.targetPath), { recursive: true });
    await symlink(outside, f.targetPath);
    await expect(f.stage({ sourcePath: f.run2Source, runId: randomUUID(), priorBundleDigest: digest }))
      .rejects.toThrow("native_runtime_context_replace_unsafe_content");
    await rm(f.targetPath);
    // A parent directory on the path is a symlink (escape out of the session root).
    await rm(posix.dirname(f.targetPath), { recursive: true, force: true });
    const outsideContext = join(fixtureRoot!, "outside-context");
    await mkdir(outsideContext, { recursive: true });
    await symlink(outsideContext, posix.dirname(f.targetPath));
    await expect(f.stage({ sourcePath: f.run2Source, runId: randomUUID(), priorBundleDigest: digest }))
      .rejects.toThrow("native_runtime_context_replace_unsafe_content");
    // Nothing was staged through the symlinked parent.
    expect(await readdir(outsideContext)).toEqual([]);
    await rm(posix.dirname(f.targetPath));
    // A symlink inside an otherwise matching prior folder.
    await f.stage({ sourcePath: f.run1Source, runId: f.run1Id, priorBundleDigest: async () => null });
    await makeWritable(f.targetPath);
    await symlink("/etc/passwd", join(f.targetPath, "docs", "link.md"));
    await expect(f.stage({ sourcePath: f.run2Source, runId: randomUUID(), priorBundleDigest: digest }))
      .rejects.toThrow("native_runtime_context_replace_unsafe_content");
    expect(await lstat(join(f.targetPath, "docs", "link.md")).then(stat => stat.isSymbolicLink())).toBe(true);
    // A target outside the session filesystem root is refused before any command.
    const before = f.commands.length;
    await expect(f.stage({ sourcePath: f.run2Source, runId: randomUUID(), priorBundleDigest: digest,
      targetPath: posix.join(f.taskRoot, "elsewhere", "instructions") }))
      .rejects.toThrow("native_runtime_context_replace_unsafe_content");
    expect(f.commands.length).toBe(before);
    // The copy verifier itself refuses a symlinked root.
    expect(nativeRuntimeAssetCopyMatchesDigest(join(fixtureRoot!, "no-such-root"), bundleDigest(f.run1Files))).toBe(false);
    const linkedRoot = join(fixtureRoot!, "linked-root");
    await symlink(outside, linkedRoot);
    expect(nativeRuntimeAssetCopyMatchesDigest(linkedRoot, bundleDigest(f.run1Files))).toBe(false);
    expect(nativeRuntimeAssetCopyMatchesDigest(outside, bundleDigest(f.run1Files))).toBe(true);
  });

  it("keeps the remote read-back and swap scripts fail-closed on their own", async () => {
    const f = await setup();
    const context = posix.dirname(f.targetPath);
    const staging = nativeRuntimeContextStagingPath(f.targetPath, randomUUID());
    const swap = (target: string, from: string, mode: string) => spawnSync("sh", ["-c", REMOTE_RUNTIME_CONTEXT_SWAP_SCRIPT,
      "paperclip-runtime-context-swap", f.filesystemRoot, target, from, mode], { encoding: "utf8" }).status;
    const readback = (target: string) => spawnSync("sh", ["-c", REMOTE_RUNTIME_CONTEXT_READBACK_SCRIPT,
      "paperclip-runtime-context-readback", f.filesystemRoot, target], { encoding: "utf8" }).status;
    expect(readback(f.targetPath)).toBe(3);
    expect(readback(posix.join(f.taskRoot, "outside"))).toBe(4);
    await writeBundle(staging, f.run2Files);
    // Wrong expected state: absent over an existing folder, replace over nothing.
    expect(swap(f.targetPath, staging, "replace")).toBe(3);
    await writeBundle(f.targetPath, f.run1Files);
    expect(swap(f.targetPath, staging, "absent")).toBe(3);
    expect(swap(f.targetPath, staging, "force")).toBe(4);
    // Outside the root, or a staging folder that is not the target's sibling.
    expect(swap(posix.join(f.taskRoot, "outside"), staging, "replace")).toBe(4);
    const elsewhere = posix.join(f.filesystemRoot, "elsewhere", posix.basename(staging));
    await writeBundle(elsewhere, f.run2Files);
    expect(swap(f.targetPath, elsewhere, "replace")).toBe(4);
    // A symlinked staging folder, a symlink inside the target or staging folder.
    const linkedStaging = nativeRuntimeContextStagingPath(f.targetPath, randomUUID());
    await symlink(elsewhere, linkedStaging);
    expect(swap(f.targetPath, linkedStaging, "replace")).toBe(4);
    await symlink("/etc/passwd", join(f.targetPath, "link.md"));
    expect(readback(f.targetPath)).toBe(4);
    expect(swap(f.targetPath, staging, "replace")).toBe(4);
    await rm(join(f.targetPath, "link.md"));
    await symlink("/etc/passwd", join(staging, "link.md"));
    expect(swap(f.targetPath, staging, "replace")).toBe(4);
    await rm(join(staging, "link.md"));
    expect(await readFile(join(f.targetPath, "AGENTS.md"), "utf8")).toBe("Run 1 instructions\n");
    // A symlinked parent on the shared path (escape out of the session root).
    const movedContext = join(fixtureRoot!, "moved-context");
    await makeWritable(context);
    spawnSync("mv", [context, movedContext]);
    await symlink(movedContext, context);
    expect(readback(f.targetPath)).toBe(4);
    expect(swap(f.targetPath, staging, "replace")).toBe(4);
    await rm(context);
    spawnSync("mv", [movedContext, context]);
    // The verified case swaps in place.
    expect(readback(f.targetPath)).toBe(0);
    expect(swap(f.targetPath, staging, "replace")).toBe(0);
    expect(await readFile(join(f.targetPath, "AGENTS.md"), "utf8")).toBe("Run 2 instructions\n");
    expect((await readdir(context)).filter(name => name.startsWith(".instructions.staging-")).sort())
      .toEqual([posix.basename(linkedStaging)]);
  });
});
