import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSandboxExecRelayRequest } from "@paperclipai/shared";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { nativeRuntimeContextFixture } from "../native-runtime/runtime-context.test-fixture.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { stageRemoteRunnerDirectory, stageRemoteRunnerFile } from "../native-runtime/native-session-executor.js";
import { exactNativeRuntimeContextPreparationOwner } from "./control.js";

describe("Native runtime-context preparation owner", () => {
  let fixtureRoot: string | null = null;
  afterEach(async () => {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = null;
  });

  it("accepts only actual server-staged commands for the current Run/manifest and no credentials", async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "native-runtime-context-owner-"));
    const companyId = randomUUID();
    const runId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const responsibleUserId = randomUUID();
    const sessionId = randomUUID();
    const taskRoot = join(fixtureRoot, "task");
    const sessionRoot = posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions",
      createHash("sha256").update(sessionId).digest("hex"));
    const filesystemRoot = posix.join(sessionRoot, "filesystem");
    const executionInput = {
      schema: "paperclip.native-execution-input.v4",
      executionMode: "default",
      planningContext: null,
      binding: { companyId, runId, issueId, agentId, executionWorkspaceId: runId },
      task: { identifier: "CTX-1", title: "Context staging", description: null, prompt: "Read the pinned task.", workMode: "standard" },
      workspace: { cwd: taskRoot, repoUrl: null, repoRef: null, branchName: null },
      session: { normalizedSessionId: sessionId, driverKind: "opencode_server", protocolVersion: 1,
        lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
      provider: { kind: "opencode", model: "openai/gpt-5", permissionMode: "allow" },
      completionContract: { id: "contract", sha256: "a".repeat(64), schemaVersion: "paperclip.completion-contract.v1",
        contract: { revision: "1", objective: "Read the pinned task.", criteria: [{ id: "objective", requirement: "Complete the task." }] } },
      interactionResponses: [], credentialBindings: [], runtimeContext: nativeRuntimeContextFixture(),
    };
    const execution = parseNativeExecutionInput(executionInput);
    if (!("runtimeContext" in execution)) throw new Error("runtime_context_execution_input_required");
    const execute = vi.fn(async (_commandInput: { command: string; args?: string[]; stdin?: string }) =>
      ({ exitCode: 0, timedOut: false, stdout: "", stderr: "" }));
    const syncIn = vi.fn(async () => ({ operations: [] }));
    const runner = { execute, syncIn } as any;
    const target = { kind: "remote", transport: "sandbox", remoteCwd: taskRoot } as any;
    const bundleRoot = join(fixtureRoot, "instructions");
    await mkdir(bundleRoot, { recursive: true });
    await writeFile(join(bundleRoot, "AGENTS.md"), "Pinned instructions\n");
    const runtimeContextFile = join(fixtureRoot, "runtime-context.json");
    await writeFile(runtimeContextFile, JSON.stringify(execution.runtimeContext));

    await stageRemoteRunnerDirectory({ target, runner, sourcePath: bundleRoot,
      targetPath: posix.join(filesystemRoot, "context", "instructions"), mode: 0o555,
      nativePreparationPurpose: "native_runtime_context_prepare" });
    await stageRemoteRunnerFile({ target, runner, sourcePath: runtimeContextFile,
      targetPath: posix.join(filesystemRoot, "runtime-context.json"), mode: 0o600,
      nativePreparationPurpose: "native_runtime_context_prepare" });
    expect(syncIn).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(2);

    const requests = execute.mock.calls.map(([commandInput]) => ({
      argv: [commandInput.command, ...(commandInput.args ?? [])],
      cwd: taskRoot,
      stdinBase64: Buffer.from(commandInput.stdin ?? "", "utf8").toString("base64"),
      env: {},
    } as unknown as RuntimeSandboxExecRelayRequest));
    const ownerInput = (request: RuntimeSandboxExecRelayRequest, overrides: Record<string, unknown> = {}) => ({
      request, taskRoot, execution, companyId, runId, agentId, responsibleUserId,
      manifest: { runId, agentId, responsibleUserId },
      nativeExecutionInput: executionInput,
      sourceAuthority: { version: 1, executionInputHash: nativeSha256(executionInput) },
      credentialMode: "none", credentialBindingCount: 0,
      ...overrides,
    });
    for (const request of requests) expect(exactNativeRuntimeContextPreparationOwner(ownerInput(request))).toBe(true);
    expect(exactNativeRuntimeContextPreparationOwner(ownerInput({ ...requests[0]!, argv: ["sh", "-c",
      requests[0]!.argv[2]!.replace("/context/instructions", "/context/untrusted")] }))).toBe(false);
    expect(exactNativeRuntimeContextPreparationOwner(ownerInput(requests[0]!, { runId: randomUUID() }))).toBe(false);
    expect(exactNativeRuntimeContextPreparationOwner(ownerInput(requests[0]!, {
      manifest: { runId: randomUUID(), agentId, responsibleUserId },
    }))).toBe(false);
    expect(exactNativeRuntimeContextPreparationOwner(ownerInput(requests[0]!, {
      sourceAuthority: { version: 1, executionInputHash: "f".repeat(64) },
    }))).toBe(false);
    expect(exactNativeRuntimeContextPreparationOwner(ownerInput({ ...requests[0]!,
      modelBrokerCredential: {} as never }))).toBe(false);
    expect(exactNativeRuntimeContextPreparationOwner(ownerInput({ ...requests[0]!,
      env: { PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: "https://broker.invalid" } }))).toBe(false);
  });
});
