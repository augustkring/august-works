import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDb } from "@paperclipai/db";
import { resolveDefaultAgentWorkspaceDir, resolvePaperclipInstanceRoot } from "../home-paths.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { withManagedChannelCloseSource } from "./helpers/managed-channel-close-source-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home = "";
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "managed-chat-workspace-root-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  database = await startEmbeddedPostgresTestDatabase("managed-chat-workspace-root-");
  db = createDb(database.connectionString, { maxConnections: 3 });
}, 60_000);
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home) { await makeFixtureTreeWritable(home); await rm(home, { recursive: true, force: true }); }
}, 30_000);

it("dispatches an actual managed external-chat Native run in its isolated task root", async () => {
  const sentinelName = `.legacy-agent-workspace-sentinel-${randomUUID()}`;
  const sentinelBody = `must remain only in the configured agent workspace ${randomUUID()}\n`;
  let legacyCwd = "";
  let expectedTaskRoot = "";
  let expectedCompanyId = "";
  let expectedAgentId = "";
  let expectedIssueId = "";
  let observedRunId: string | undefined;
  let observedIssueId: string | null | undefined;
  let providerWireCalls = 0;

  await withManagedChannelCloseSource({
    db, root: home, opencodeBinary: qualifiedOpenCodeBinary(),
    beforeFirstSourceWake: async ({ companyId, agentId, issueId }) => {
      expectedCompanyId = companyId;
      expectedAgentId = agentId;
      expectedIssueId = issueId;
      legacyCwd = resolveDefaultAgentWorkspaceDir(agentId);
      // Resolve this only after the managed fixture has installed the current
      // instance scope; its instance id can differ from the outer PAPERCLIP_HOME.
      await mkdir(resolvePaperclipInstanceRoot(), { recursive: true });
      const instanceRoot = await realpath(resolvePaperclipInstanceRoot());
      expectedTaskRoot = join(instanceRoot, "chat-workspaces", companyId, agentId, issueId);
      await mkdir(legacyCwd, { recursive: true });
      await writeFile(join(legacyCwd, sentinelName), sentinelBody, { mode: 0o600 });
    },
    observeProviderExecution: ({ execution, runId, issueId, callIndex }) => {
      providerWireCalls += 1;
      if (observedRunId === undefined) {
        observedRunId = runId;
        observedIssueId = issueId;
      }
      expect(runId).toBe(observedRunId);
      expect(issueId).toBe(observedIssueId);
      expect(callIndex).toBe(providerWireCalls);
      expect(execution.binding).toMatchObject({ companyId: expectedCompanyId, agentId: expectedAgentId,
        issueId: expectedIssueId, runId });
      expect(issueId).toBe(expectedIssueId);
      expect(execution.workspace.cwd).toBe(expectedTaskRoot);
      expect(execution.workspace.cwd).not.toBe(legacyCwd);
    },
    drive: async ({ sourceRun, companyId, agentId, issueId, publishClose, providerCalls, sourceProviderCalls }) => {
      expect(sourceRun.id).toBe(observedRunId);
      expect(sourceRun.nativeIssueId).toBe(issueId);
      expect(sourceRun.companyId).toBe(companyId);
      expect(sourceRun.agentId).toBe(agentId);
      expect(sourceRun.runtimeMode).toBe("native");
      expect(sourceRun.nativePhase).toBe("committed");
      // The model-wire observer receives the immutable control-plane input.
      // The real remote runner cwd is projected separately; its persisted
      // preparation mapping must identify the same canonical chat task root.
      const context = sourceRun.contextSnapshot as Record<string, any>;
      expect(context.paperclipWorkspace).toMatchObject({ cwd: expectedTaskRoot, source: "task_session",
        projectId: null, workspaceId: null });
      expect(context.paperclipEnvironment).toMatchObject({ remoteCwd: expectedTaskRoot });
      expect(observedIssueId).toBe(issueId);
      expect(sourceProviderCalls).toBe(providerWireCalls);
      expect(providerCalls()).toBe(sourceProviderCalls);
      expect(providerWireCalls).toBeGreaterThan(0);
      await publishClose();
    },
  });

  expect(observedRunId).toBeTruthy();
  expect(expectedTaskRoot).toBeTruthy();
  expect(await realpath(expectedTaskRoot)).toBe(expectedTaskRoot);
  expect(await readFile(join(legacyCwd, sentinelName), "utf8")).toBe(sentinelBody);
  await expect(access(join(expectedTaskRoot, sentinelName))).rejects.toMatchObject({ code: "ENOENT" });
});
