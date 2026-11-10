import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";
import { nativeSha256 } from "./canonical.js";
import { assertNativeOpenCodeConformanceWorkspaceRootReceipt } from "./native-workspace-sync.js";

describe("Native OpenCode conformance workspace receipt", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("binds the retained empty-root receipt to one group, presence, and hidden Task", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "native-opencode-workspace-test-"));
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "conformance-test");
    try {
      const groupId = randomUUID(), companyId = randomUUID(), agentId = randomUUID(), taskId = randomUUID();
      const instanceRoot = resolvePaperclipInstanceRoot();
      const taskRoot = path.join(instanceRoot, "chat-workspaces", companyId, agentId, taskId);
      const proofRoot = path.join(instanceRoot, "chat-workspace-proofs");
      await mkdir(taskRoot, { recursive: true, mode: 0o700 });
      await mkdir(proofRoot, { recursive: true, mode: 0o700 });
      const stat = await lstat(taskRoot);
      const workspaceId = randomUUID();
      const receipt = { schema: "paperclip.native-opencode-conformance-workspace/v1", groupId,
        companyId, agentId, taskId, taskRoot, workspaceId, cwd: taskRoot, dev: stat.dev, ino: stat.ino };
      const key = createHash("sha256").update(`${groupId}\0${companyId}\0${agentId}\0${taskId}`).digest("hex");
      await writeFile(path.join(proofRoot, `${key}.json`), `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: "wx" });
      const proof = { groupId, companyId, agentId, taskId, taskRoot, workspaceId, cwd: taskRoot,
        creationReceipt: nativeSha256(receipt) };
      expect(await assertNativeOpenCodeConformanceWorkspaceRootReceipt(proof)).toBe(true);
      expect(await assertNativeOpenCodeConformanceWorkspaceRootReceipt({ ...proof, agentId: randomUUID() })).toBe(false);
      expect(await assertNativeOpenCodeConformanceWorkspaceRootReceipt({ ...proof, cwd: path.join(taskRoot, "peer") })).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
