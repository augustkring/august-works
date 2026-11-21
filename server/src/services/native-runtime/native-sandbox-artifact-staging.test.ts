import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runtimeSandboxExecRelayRequestSchema } from "@paperclipai/shared";
import { stageRemoteRunnerFile } from "./native-session-executor.js";

// Exercise the real producer and shell file reconstruction. No paid provider,
// Host admission, or source authorization is mocked or claimed by this test.
describe("Native Sandbox artifact staging relay bound", () => {
  it("stages a large Worker artifact through frames admitted by the existing nested wire schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-artifact-bound-"));
    try {
      const source = join(root, "build-owned-artifact");
      const target = join(root, ".paperclip-runtime", "paperclip-runner", "bin", "paperclip-runnerd");
      const bytes = Buffer.from(Array.from({ length: 768 * 1024 + 17 }, (_, i) => i % 251));
      await writeFile(source, bytes);
      const frames: Array<ReturnType<typeof runtimeSandboxExecRelayRequestSchema.parse>> = [];
      const syncIn = vi.fn(async () => { throw new Error("unbounded sync must not handle Sandbox artifacts"); });
      const wire = (argv: string[], stdin: string) => ({ requestId: randomUUID(), bindingId: randomUUID(), hostEpoch: 1,
        runId: randomUUID(), attemptId: randomUUID(), attempt: 1, manifestId: randomUUID(), manifestHash: "a".repeat(64),
        policySnapshotId: randomUUID(), policyHash: "b".repeat(64), commandDigest: "c".repeat(64),
        deadlineAt: new Date(Date.now() + 30_000).toISOString(), sandboxRef: "", imageDigest: `fixture.invalid/openshell@sha256:${"d".repeat(64)}`,
        argv, cwd: root, env: {}, stdinBase64: Buffer.from(stdin, "utf8").toString("base64") });
      const runner = { syncIn, execute: async (input: { command: string; args: string[]; stdin?: string; cwd?: string; nativePreparationPurpose?: string }) => {
        expect(input.nativePreparationPurpose).toBe("provider_artifact");
        const request = wire([input.command, ...input.args], input.stdin ?? "");
        request.sandboxRef = `aw-v7-${request.bindingId}`;
        const parsed = runtimeSandboxExecRelayRequestSchema.parse(request);
        expect(parsed.stdinBase64.length).toBeLessThanOrEqual(512 * 1024);
        expect(parsed.argv.every(arg => arg.length <= 8192)).toBe(true);
        const aggregate = Buffer.byteLength(JSON.stringify(parsed.argv)) + Buffer.byteLength(JSON.stringify(parsed.env)) + parsed.stdinBase64.length;
        expect(aggregate).toBeLessThanOrEqual(768 * 1024);
        frames.push(parsed);
        execFileSync(input.command, input.args, { input: input.stdin ?? "", cwd: input.cwd });
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      } };
      await stageRemoteRunnerFile({ target: { kind: "remote", transport: "sandbox", remoteCwd: root, runner } as never,
        runner: runner as never, sourcePath: source, targetPath: target, mode: 0o700, nativePreparationPurpose: "provider_artifact" });
      expect(syncIn).not.toHaveBeenCalled();
      expect(frames).toHaveLength(6);
      expect(Math.max(...frames.map(frame => frame.stdinBase64.length))).toBe(466040);
      const reconstructed = await readFile(target);
      expect(createHash("sha256").update(reconstructed).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
      const formerSingleFrame = { ...frames[1]!, stdinBase64: Buffer.from(bytes.toString("base64"), "utf8").toString("base64") };
      expect(runtimeSandboxExecRelayRequestSchema.safeParse(formerSingleFrame).success).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("preserves the existing SSH sync path unless the caller explicitly requests chunking", async () => {
    const syncIn = vi.fn(async () => ({ operations: [] }));
    const execute = vi.fn();
    await stageRemoteRunnerFile({ target: { kind: "remote", transport: "ssh", remoteCwd: "/remote" } as never,
      runner: { syncIn, execute } as never, sourcePath: "/existing-build-artifact", targetPath: "/remote/runner", mode: 0o700,
      nativePreparationPurpose: "provider_artifact" });
    expect(syncIn).toHaveBeenCalledOnce();expect(execute).not.toHaveBeenCalled();
  });
});
