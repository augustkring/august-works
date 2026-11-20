import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentExecutionManifests, environmentLeases, heartbeatRuns, issues, orchestrationPlans,
  orchestrationWorkerAttempts } from "@paperclipai/db";
import type { RuntimeSandboxExecRelayRequest } from "@paperclipai/shared";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { NATIVE_OPENCODE_CONFORMANCE_SYSTEM } from "../orchestration/native-opencode-conformance-source.js";
import { currentConformanceNativeWorkspaceRoot, exactNativeRuntimeAssetErasureProbeCommand } from "../runtime/control.js";
import { nativeSha256 } from "./canonical.js";
import { NATIVE_RUNNER_TRUST_BUNDLE_PREPARATION_PURPOSE } from "./native-runner-trust-bundle.js";
import { REMOTE_PROVIDER_PACK_ARTIFACT_PATHS, REMOTE_PROVIDER_PACK_PINS, REMOTE_PROVIDER_PACK_PROFILE_DIGESTS,
  REMOTE_PROVIDER_PACK_SCHEMA } from "./native-artifact-preparation.js";
import { createNativeOpenCodeConformanceProbeBackend, sha256DirectoryTree } from "./native-session-executor.js";
import { REMOTE_NATIVE_ERASER_ENV, REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_SCRIPT } from "./remote-runner-identity.js";

// Only the receipts this test cannot build without a live Sandbox Host are
// stubbed: the server-created workspace root receipt, the server-verified
// workspace sync check and the current Sandbox authority. The source authority
// producer, its transaction and the erasure-probe command are the real code.
const stubs = vi.hoisted(() => ({ authorityHash: "c".repeat(64), reference: null as Record<string, unknown> | null }));
vi.mock("../execution-sandbox/sandbox-service.js", async importOriginal => ({
  ...await importOriginal<typeof import("../execution-sandbox/sandbox-service.js")>(),
  executionSandboxService: () => ({ assertTaskExecutionContext: async () => ({ authorityHash: stubs.authorityHash }) }),
}));
vi.mock("./native-workspace-sync.js", async importOriginal => ({
  ...await importOriginal<typeof import("./native-workspace-sync.js")>(),
  readNativeWorkspaceSyncReference: () => stubs.reference,
  assertNativeWorkspaceSyncServerVerifiedNone: async () => true,
  assertNativeOpenCodeConformanceWorkspaceRootReceipt: async () => true,
}));
vi.mock("./current-wake-comments.js", async importOriginal => ({
  ...await importOriginal<typeof import("./current-wake-comments.js")>(),
  resolveCurrentWakeCommentsBinding: async () => null,
}));
vi.mock("../native-direct-input.js", async importOriginal => ({
  ...await importOriginal<typeof import("../native-direct-input.js")>(),
  captureNativeBlockedHumanInteraction: async () => null,
}));
vi.mock("./management-analytical-tools.js", async importOriginal => ({
  ...await importOriginal<typeof import("./management-analytical-tools.js")>(),
  nativeManagementToolsAvailable: async () => false,
}));

type Row = Record<string, unknown>;

/** Table-keyed stand-in for the Drizzle client: reads return copies of the
 * seeded rows, updates merge into them, so later reads see earlier writes. */
function fakeDb(tables: Map<unknown, Row[]>) {
  const chain = (read: () => Row[]) => {
    const query: Record<string, unknown> = {};
    for (const method of ["where", "for", "limit", "orderBy", "innerJoin", "leftJoin", "returning"])
      query[method] = () => query;
    query.then = (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve().then(read).then(resolve, reject);
    return query;
  };
  const db: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => chain(() => structuredClone(tables.get(table) ?? [])) }),
    update: (table: unknown) => ({ set: (values: Row) => chain(() => {
      for (const row of tables.get(table) ?? []) Object.assign(row, structuredClone(values));
      return [];
    }) }),
    // The conformance check's company advisory keys (D5f). This stand-in has
    // no locks; run-task-lock-order.test.ts covers their order on Postgres.
    execute: async () => [],
    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  return db;
}

async function providerPack(root: string) {
  const files: Record<string, string> = {
    [REMOTE_PROVIDER_PACK_ARTIFACT_PATHS.nodeCommand]: "fixture node\n",
    [REMOTE_PROVIDER_PACK_ARTIFACT_PATHS.productionLock]: "lockfileVersion: '9.0'\n",
    [REMOTE_PROVIDER_PACK_ARTIFACT_PATHS.opencodeCommand]: "#!/bin/sh\n",
    [REMOTE_PROVIDER_PACK_ARTIFACT_PATHS.opencodeExecutable]: "fixture opencode\n",
    [REMOTE_PROVIDER_PACK_ARTIFACT_PATHS.opencodeProxy]: "module.exports = 'proxy';\n",
    [REMOTE_PROVIDER_PACK_ARTIFACT_PATHS.acpxSidecar]: "module.exports = 'sidecar';\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, posix.dirname(path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const artifact = (key: keyof typeof REMOTE_PROVIDER_PACK_ARTIFACT_PATHS) =>
    ({ path: REMOTE_PROVIDER_PACK_ARTIFACT_PATHS[key], sha256: digest(files[REMOTE_PROVIDER_PACK_ARTIFACT_PATHS[key]]!) });
  const payload = {
    pins: REMOTE_PROVIDER_PACK_PINS, acpxProfileDigests: REMOTE_PROVIDER_PACK_PROFILE_DIGESTS,
    target: { platform: "linux", architecture: "x64" }, runnerSourceRevision: "1".repeat(40),
    distDigest: sha256DirectoryTree(join(root, "dist")), bridgeDigest: "",
    artifacts: { nodeCommand: artifact("nodeCommand"), productionLock: artifact("productionLock"),
      opencodeCommand: artifact("opencodeCommand"), opencodeExecutable: artifact("opencodeExecutable"),
      opencodeProxy: artifact("opencodeProxy"), acpxSidecar: artifact("acpxSidecar") },
  };
  payload.bridgeDigest = `sha256:${createHash("sha256").update(payload.artifacts.opencodeProxy.sha256).update("\n")
    .update(payload.artifacts.acpxSidecar.sha256).update("\n").update(payload.distDigest).digest("hex")}`;
  const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object" ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}` : JSON.stringify(value) ?? "null";
  await writeFile(join(root, "provider-pack.json"), JSON.stringify({ schema: REMOTE_PROVIDER_PACK_SCHEMA,
    digest: `sha256:${createHash("sha256").update(canonical(payload)).digest("hex")}`, payload }));
}

describe("provider-conformance source authority before the erasure probe (CONF2)", () => {
  let fixtureRoot: string;
  const previousEnvironment = { ...process.env };
  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "native-conformance-source-"));
    process.env.PAPERCLIP_RUNNER_STATE_DIR = join(fixtureRoot, "runner-state");
    process.env.PAPERCLIP_HOME = join(fixtureRoot, "home");
  });
  afterEach(async () => {
    process.env = { ...previousEnvironment };
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  async function fixture() {
    const ids = { company: randomUUID(), agent: randomUUID(), task: randomUUID(), run: randomUUID(), plan: randomUUID(),
      user: randomUUID(), workspace: randomUUID(), lease: randomUUID(), environment: randomUUID(), group: randomUUID(),
      probe: randomUUID(), profile: randomUUID(), session: randomUUID(), runner: randomUUID() };
    const taskRoot = `/sandbox/aw-conformance/${ids.group}/${ids.task}`;
    const providerLeaseId = `fixture-sandbox-${ids.lease}`;
    const execution = parseNativeExecutionInput({ schema: "paperclip.native-execution-input.v2",
      binding: { companyId: ids.company, runId: ids.run, issueId: ids.task, agentId: ids.agent, executionWorkspaceId: ids.workspace },
      task: { identifier: ids.task, title: "Synthetic provider qualification", description: null,
        prompt: "Server-controlled synthetic provider conformance. No company context or platform tools are provided.", workMode: "standard" },
      workspace: { cwd: taskRoot, repoUrl: null, repoRef: null, branchName: null },
      session: { normalizedSessionId: ids.session, driverKind: "opencode_server", protocolVersion: 1,
        lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
      provider: { kind: "opencode", model: "anthropic/fixture-model" },
      completionContract: { id: randomUUID(), sha256: "a".repeat(64), schemaVersion: "paperclip.completion-contract.v1",
        contract: { revision: "1", objective: "Probe.", criteria: [{ id: "objective", requirement: "Answer." }] } },
      interactionResponses: [], credentialBindings: [], executionMode: "default", planningContext: null });
    stubs.reference = { workspaceRepositoryMode: "server_verified_none", state: "prepared", workspaceId: ids.workspace,
      leaseId: ids.lease, providerLeaseId, remoteCwd: taskRoot, descriptorSha256: "d".repeat(64), baselineSha256: "e".repeat(64) };
    const workspaceProof = { schema: "paperclip.native-opencode-conformance-workspace/v1", groupId: ids.group,
      companyId: ids.company, agentId: ids.agent, workspaceId: ids.workspace, taskId: ids.task, taskRoot, localCwd: taskRoot,
      remoteCwd: taskRoot, creationReceipt: "f".repeat(64), createdEmpty: true, leaseId: ids.lease, providerLeaseId,
      authorityHash: stubs.authorityHash, descriptorSha256: "d".repeat(64), baselineSha256: "e".repeat(64),
      workspaceRepositoryMode: "server_verified_none" };
    const run: Row = { id: ids.run, companyId: ids.company, agentId: ids.agent, status: "running", runtimeMode: "native",
      scopeKind: "issue", nativeIssueId: ids.task, issueId: ids.task, responsibleUserId: ids.user,
      triggerDetail: "provider_conformance", nativeSessionId: ids.session, runnerInstanceId: ids.runner,
      driverKind: "opencode_server", completionContractId: execution.completionContract.id,
      completionContractSha256: execution.completionContract.sha256,
      contextSnapshot: { providerConformanceGroupId: ids.group, providerConformancePlanId: ids.plan,
        nativeOpenCodeConformanceProbeId: ids.probe, nativeOpenCodeConformanceProfileId: ids.profile,
        containsCompanyContext: false, platformToolsGranted: false },
      runnerProfileJson: { nativeExecutionInput: execution, nativeOpenCodeConformanceWorkspace: workspaceProof,
        nativeWorkspaceSync: { reference: "stubbed" } } };
    const task: Row = { id: ids.task, companyId: ids.company, title: execution.task.title, description: execution.task.description,
      hiddenAt: new Date(), harnessKind: "provider_conformance", status: "in_progress", assigneeAgentId: ids.agent,
      executionRunId: ids.run, responsibleUserId: ids.user, conversationAgentId: null, conversationUserId: null,
      conversationState: null, projectId: null, parentId: null };
    const plan: Row = { id: ids.plan, companyId: ids.company, issueId: ids.task, status: "paused", createdBy: ids.user,
      executionPrincipal: { type: "user", userId: ids.user }, mode: "single_worker", actionClass: "internal_draft",
      riskClass: "C0", budgets: { maxToolActions: 0, maxRetries: 0, maxWallClockSeconds: 600 }, toolActionsUsed: 0 };
    const manifest: Row = { id: randomUUID(), companyId: ids.company, runId: ids.run, agentId: ids.agent, hash: "b".repeat(64),
      manifest: { capabilities: [], responsibleUserId: ids.user } };
    const lease: Row = { id: ids.lease, companyId: ids.company, heartbeatRunId: ids.run, status: "active",
      expiresAt: new Date(Date.now() + 3_600_000), provider: "fixture-sandbox", providerLeaseId,
      environmentId: ids.environment, metadata: { remoteCwd: taskRoot } };
    const tables = new Map<unknown, Row[]>([[heartbeatRuns, [run]], [issues, [task]], [orchestrationPlans, [plan]],
      [agentExecutionManifests, [manifest]], [environmentLeases, [lease]], [orchestrationWorkerAttempts, []]]);
    const packRoot = join(fixtureRoot, "provider-pack");
    await providerPack(packRoot);
    const runnerBinary = join(fixtureRoot, "paperclip-runnerd");
    await writeFile(runnerBinary, "fixture runnerd bytes\n");
    await chmod(runnerBinary, 0o755);
    const commands: Array<{ args: string[]; cwd?: string; env?: Record<string, string>; stdin?: string;
      nativePreparationPurpose?: string; profileAtCommand: Row }> = [];
    const target = { kind: "remote", transport: "sandbox", providerKey: "fixture-sandbox", environmentId: ids.environment,
      leaseId: ids.lease, remoteCwd: taskRoot, runner: { execute: async (command: { command: string; args?: string[];
        cwd?: string; env?: Record<string, string>; stdin?: string; nativePreparationPurpose?: string }) => {
        commands.push({ args: [command.command, ...(command.args ?? [])], cwd: command.cwd, env: command.env,
          stdin: command.stdin, nativePreparationPurpose: command.nativePreparationPurpose,
          profileAtCommand: structuredClone(run.runnerProfileJson as Row) });
        // Stop the backend at its first Sandbox command; the receipt is what matters.
        return { exitCode: 1, signal: null, timedOut: false, stdout: "", stderr: "" };
      } } } as const;
    const create = () => createNativeOpenCodeConformanceProbeBackend({ db: fakeDb(tables) as never, execution,
      runnerInstanceId: ids.runner, runnerExecutionTarget: target as never, durableEnvironmentLeaseId: ids.lease,
      runnerEnvironment: { PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: "https://broker.test.invalid",
        ANTHROPIC_API_KEY: "paperclip-managed-model-broker" },
      runnerRemoteProviderPackPath: packRoot, runnerRemoteBinaryPath: runnerBinary });
    // RuntimeControl's view of the same Run, Task, plan, lease and policy.
    const source = (profile: Row, overrides: { taskRoot?: string; leaseRoot?: string } = {}) => ({
      providerConformanceBootstrap: true, qualificationGroupId: ids.group, authorityHash: stubs.authorityHash, attempt: null,
      conformancePlan: plan, manifest: { runId: ids.run, agentId: ids.agent, manifest: manifest.manifest },
      run: { ...run, runnerProfileJson: { ...profile, nativeOpenCodeConformanceWorkspace: { ...workspaceProof,
        ...(overrides.taskRoot ? { taskRoot: overrides.taskRoot } : {}) } } },
      source: { task }, lease: { id: ids.lease, providerLeaseId, metadata: { remoteCwd: overrides.leaseRoot ?? taskRoot } },
      policy: { compilation: { compiledPolicy: { filesystem: { readPaths: [taskRoot], writePaths: [taskRoot] } } } },
    }) as never;
    const initialProfile = structuredClone(run.runnerProfileJson as Row);
    return { ids, taskRoot, execution, initialProfile, commands, create, source };
  }

  it("persists the conformance source authority before its first Sandbox command, the erasure probe", async () => {
    const { ids, taskRoot, execution, commands, create, source } = await fixture();
    await expect(create()).rejects.toThrow("Managed OpenCode provider data erasure is not qualified for remote runner storage");
    expect(commands).toHaveLength(1);
    const [probe] = commands;
    expect(probe!.nativePreparationPurpose).toBe("native_provider_data_erasure_probe");
    const request = { argv: probe!.args, cwd: probe!.cwd, env: probe!.env ?? {},
      stdinBase64: Buffer.from(probe!.stdin ?? "").toString("base64") } as RuntimeSandboxExecRelayRequest;
    expect(exactNativeRuntimeAssetErasureProbeCommand({ request, taskRoot, runId: ids.run,
      sessionDigest: createHash("sha256").update(ids.session).digest("hex") })).toBe(true);

    // Before the fix the conformance branch skipped this producer, so the probe
    // went out with no authority and RuntimeControl answered 409.
    const authority = probe!.profileAtCommand.nativeOpenCodeSourceAuthority as Row | undefined;
    expect(authority).toBeDefined();
    expect(authority).toMatchObject({ version: 1, executionInputHash: nativeSha256(execution), toolSchemas: [],
      toolSchemasHash: nativeSha256([]), systemInstructionsHash: nativeSha256(NATIVE_OPENCODE_CONFORMANCE_SYSTEM),
      authorizedPromptHashes: [], promptSourceBindings: [], attachmentStageHash: null });
    expect(authority).not.toHaveProperty("workspaceMetadataSource");
    expect(authority!.artifactAuthority).toMatchObject({ installedPackRoot: "/opt/paperclip-runner/provider-pack",
      runnerSha256: createHash("sha256").update("fixture runnerd bytes\n").digest("hex"),
      providerPackManifest: expect.objectContaining({ schema: REMOTE_PROVIDER_PACK_SCHEMA }) });
    // The run-bound erasure locator is also durable before the probe.
    expect(probe!.profileAtCommand.nativeRemoteRuntimeAssetLocator).toMatchObject({ runId: ids.run,
      environmentLeaseId: ids.lease });

    // RuntimeControl admits the erasure probe and the later preparation
    // purposes against exactly this persisted profile.
    for (const purpose of ["native_provider_data_erasure_probe", "provider_artifact", "native_harness_state", "native_session_start",
      NATIVE_RUNNER_TRUST_BUNDLE_PREPARATION_PURPOSE])
      await expect(currentConformanceNativeWorkspaceRoot(source(probe!.profileAtCommand), purpose)).resolves.toBe(taskRoot);
  });

  it("keeps the RuntimeControl guard: no authority, another Run's input, tools or another root are refused", async () => {
    const { ids, taskRoot, execution, initialProfile, create, source, commands } = await fixture();
    await expect(create()).rejects.toThrow("Managed OpenCode provider data erasure is not qualified");
    const profile = commands[0]!.profileAtCommand;
    const authority = profile.nativeOpenCodeSourceAuthority as Row;
    const refused = /current hidden conformance Run, group workspace receipt, lease, or exact filesystem policy changed/;
    const withAuthority = (value: unknown) => ({ ...profile, nativeOpenCodeSourceAuthority: value });
    // Initial workspace preparation still needs no source authority.
    const initial = initialProfile;
    await expect(currentConformanceNativeWorkspaceRoot(source(initial), "native_workspace_prepare")).resolves.toBe(taskRoot);
    // Every other purpose stays bound to the persisted authority.
    await expect(currentConformanceNativeWorkspaceRoot(source(initial), "native_provider_data_erasure_probe")).rejects.toThrow(refused);
    const otherRunInput = { ...execution, binding: { ...execution.binding, runId: randomUUID() } };
    await expect(currentConformanceNativeWorkspaceRoot(source(withAuthority({ ...authority,
      executionInputHash: nativeSha256(otherRunInput) })), "native_provider_data_erasure_probe")).rejects.toThrow(refused);
    await expect(currentConformanceNativeWorkspaceRoot(source(withAuthority({ ...authority,
      toolSchemas: [{ name: "write_document" }] })), "native_provider_data_erasure_probe")).rejects.toThrow(refused);
    await expect(currentConformanceNativeWorkspaceRoot(source(withAuthority({ ...authority, version: 2 })),
      "native_provider_data_erasure_probe")).rejects.toThrow(refused);
    await expect(currentConformanceNativeWorkspaceRoot(source(withAuthority({ ...authority, artifactAuthority: undefined })),
      "provider_artifact")).rejects.toThrow(refused);
    const peerRoot = `/sandbox/aw-conformance/${ids.group}/${randomUUID()}`;
    await expect(currentConformanceNativeWorkspaceRoot(source(profile, { taskRoot: peerRoot }),
      "native_provider_data_erasure_probe")).rejects.toThrow(refused);
    await expect(currentConformanceNativeWorkspaceRoot(source(profile, { leaseRoot: peerRoot }),
      "native_provider_data_erasure_probe")).rejects.toThrow(refused);
    // CONF4b: the runner trust-bundle copy is bound to the same persisted
    // authority, root and lease, and has no owner outside the conformance Run.
    await expect(currentConformanceNativeWorkspaceRoot(source(initial), NATIVE_RUNNER_TRUST_BUNDLE_PREPARATION_PURPOSE)).rejects.toThrow(refused);
    await expect(currentConformanceNativeWorkspaceRoot(source(profile, { taskRoot: peerRoot }),
      NATIVE_RUNNER_TRUST_BUNDLE_PREPARATION_PURPOSE)).rejects.toThrow(refused);
    await expect(currentConformanceNativeWorkspaceRoot({ ...(source(profile) as object), providerConformanceBootstrap: false } as never,
      NATIVE_RUNNER_TRUST_BUNDLE_PREPARATION_PURPOSE)).resolves.toBeNull();
    // A Worker-shaped purpose is not a conformance preparation owner.
    await expect(currentConformanceNativeWorkspaceRoot(source(profile), "native_runtime_context_prepare")).resolves.toBeNull();
  });

  it("matches only the exact credentialless erasure probe for this Run, root and session", async () => {
    const { ids, taskRoot } = await fixture();
    const sessionDigest = createHash("sha256").update(ids.session).digest("hex");
    const argv = ["/bin/sh", "-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_SCRIPT, "paperclip-native-asset-erasure-probe",
      taskRoot, sessionDigest, ids.run, randomUUID()];
    const base = { argv, cwd: taskRoot, stdinBase64: "", env: { ...REMOTE_NATIVE_ERASER_ENV } } as unknown as RuntimeSandboxExecRelayRequest;
    const accepts = (request: Partial<RuntimeSandboxExecRelayRequest> & Record<string, unknown>, root = taskRoot, runId = ids.run) =>
      exactNativeRuntimeAssetErasureProbeCommand({ request: { ...base, ...request } as RuntimeSandboxExecRelayRequest,
        taskRoot: root, runId, sessionDigest });
    const replace = (index: number, value: string) => argv.map((entry, at) => at === index ? value : entry);
    expect(accepts({})).toBe(true);
    // Another Run, root or session.
    expect(accepts({}, taskRoot, randomUUID())).toBe(false);
    expect(accepts({ argv: replace(6, randomUUID()) })).toBe(false);
    const peerRoot = posix.join(posix.dirname(taskRoot), randomUUID());
    expect(accepts({}, peerRoot)).toBe(false);
    expect(accepts({ argv: replace(4, peerRoot), cwd: peerRoot })).toBe(false);
    expect(accepts({ cwd: peerRoot })).toBe(false);
    expect(accepts({ argv: replace(5, "0".repeat(64)) })).toBe(false);
    // Other argv: shell, script, label, nonce shape, extra argument.
    expect(accepts({ argv: replace(0, "sh") })).toBe(false);
    expect(accepts({ argv: replace(2, `${REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_SCRIPT}\ncurl https://attacker.invalid`) })).toBe(false);
    expect(accepts({ argv: replace(3, "paperclip-native-asset-erasure") })).toBe(false);
    expect(accepts({ argv: replace(7, "$(id)") })).toBe(false);
    expect(accepts({ argv: [...argv, "extra"] })).toBe(false);
    // Environment variables: anything beyond the fixed eraser environment.
    expect(accepts({ env: {} })).toBe(false);
    expect(accepts({ env: { ...REMOTE_NATIVE_ERASER_ENV, ANTHROPIC_API_KEY: "paperclip-managed-model-broker" } })).toBe(false);
    expect(accepts({ env: { ...REMOTE_NATIVE_ERASER_ENV, PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: "https://broker.invalid" } })).toBe(false);
    expect(accepts({ env: { ...REMOTE_NATIVE_ERASER_ENV, LD_PRELOAD: "/tmp/x.so" } })).toBe(false);
    // Stdin and credentials.
    expect(accepts({ stdinBase64: Buffer.from("rm -rf /").toString("base64") })).toBe(false);
    const credential = { capabilityToken: "fixture-capability", profileId: randomUUID(), profileHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60_000).toISOString() };
    expect(accepts({ brokerCredential: credential })).toBe(false);
    expect(accepts({ modelBrokerCredential: { ...credential, inputTokensUpperBound: 1, maxOutputTokens: 1 } })).toBe(false);
  });
});
