import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentExecutionManifests, environmentLeases, heartbeatRuns, issues, orchestrationPlans,
  orchestrationWorkerAttempts } from "@paperclipai/db";
import type { RuntimeSandboxExecRelayRequest } from "@paperclipai/shared";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { setupRunnerPrpWebSocketServer } from "../../realtime/runner-prp-ws.js";
import { nativeOpenCodeConformanceBackendFactory } from "../native-opencode-conformance.js";
import { exactNativeConformanceRunnerTrustBundleCommand, exactNativeProviderArtifactChunkCommand } from "../runtime/control.js";
import { buildRemoteRunnerFileStageScript, NATIVE_RUNNER_TRUST_BUNDLE_PREPARATION_PURPOSE, nativeRemoteRunnerTrustBundlePath,
  readConfiguredNativeRunnerTrustBundle } from "./native-runner-trust-bundle.js";
import { exactNativeManagedArtifactCommand, NATIVE_FIXED_ARTIFACT_CHECKSUM_SCRIPT,
  NATIVE_SELECTED_PROVIDER_PACK_DISCOVERY_SCRIPT, nativeProviderPackLinkCommand,
  nativeProviderPackVerificationArgs, REMOTE_PROVIDER_PACK_ARTIFACT_PATHS, REMOTE_PROVIDER_PACK_PINS,
  REMOTE_PROVIDER_PACK_PROFILE_DIGESTS, REMOTE_PROVIDER_PACK_SCHEMA } from "./native-artifact-preparation.js";
import { sha256DirectoryTree, stageRemoteRunnerTrustBundle } from "./native-session-executor.js";
import { REMOTE_NATIVE_ERASER_ENV } from "./remote-runner-identity.js";
import { nativeRunnerOperatorSettings } from "./runner-operator-settings.js";

// CONF3a and CONF3b. The hidden conformance probe built its runnerd backend
// without the server's direct runner URL and CA bundle, so a Sandbox without
// provider ingress had no runner transport (runner_transport_ineligible). Once
// it had one, the executor ran the preinstalled provider-pack check without the
// fixed eraser environment that RuntimeControl's managed-artifact matcher
// requires, so RuntimeControl refused it and conformance refused to upload a
// pack. The vendor session/transport constructors are replaced only so the
// test can call the backend's control-plane registration directly; the
// conformance backend owner, the executor's preparation and the RuntimeControl
// matchers are the real code.
const state = vi.hoisted(() => ({
  createBackend: vi.fn((_execution: unknown, _options: Record<string, unknown>) => ({ kind: "conformance-test" })),
  createTransport: vi.fn((_options: Record<string, unknown>) => ({ transport: {} })),
  authorityHash: "c".repeat(64),
  reference: null as Record<string, unknown> | null,
  persistProcess: vi.fn(async (_db: unknown, runId: string, _meta: Record<string, unknown>) => ({ id: runId }) as unknown),
}));
// CONF13: the Worker lane's process-identity owner, observed at its boundary.
vi.mock("../heartbeat.js", async importOriginal => ({
  ...await importOriginal<typeof import("../heartbeat.js")>(),
  persistHeartbeatRunProcessMetadata: state.persistProcess,
}));
vi.mock("../../vendor/paperclip-runner/index.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../vendor/paperclip-runner/index.js")>(),
  createNativeSessionBackend: state.createBackend,
  createRunnerdCodexTransport: state.createTransport,
}));
// A full stub: the conformance and RuntimeControl modules in this graph import
// the Sandbox owner circularly, so a partial mock built from the original can
// hand the executor the unmocked owner.
vi.mock("../execution-sandbox/sandbox-service.js", () => ({
  executionSandboxService: () => ({ assertTaskExecutionContext: async () => ({ authorityHash: state.authorityHash }) }),
  sandboxCapabilityFacts: () => ({}),
}));
vi.mock("./native-workspace-sync.js", async importOriginal => ({
  ...await importOriginal<typeof import("./native-workspace-sync.js")>(),
  readNativeWorkspaceSyncReference: () => state.reference,
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
type SandboxCommand = { command: string; args?: string[]; cwd?: string; env?: Record<string, string>; stdin?: string;
  nativePreparationPurpose?: string };

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
    // A projection maps each selected column back to its row key.
    select: (projection?: Record<string, unknown>) => ({ from: (table: unknown) => chain(() => {
      const rows = structuredClone(tables.get(table) ?? []);
      if (!projection) return rows;
      const keyOf = (column: unknown) => Object.entries(table as Record<string, unknown>).find(([, value]) => value === column)?.[0];
      return rows.map(row => Object.fromEntries(Object.entries(projection).map(([alias, column]) => [alias, row[keyOf(column) ?? alias]])));
    }) }),
    update: (table: unknown) => ({ set: (values: Row) => chain(() => {
      for (const row of tables.get(table) ?? []) Object.assign(row, structuredClone(values));
      return [];
    }) }),
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
  const manifest = { schema: REMOTE_PROVIDER_PACK_SCHEMA,
    digest: `sha256:${createHash("sha256").update(canonical(payload)).digest("hex")}`, payload };
  await writeFile(join(root, "provider-pack.json"), JSON.stringify(manifest));
  return { manifest, nodeSha: payload.artifacts.nodeCommand.sha256.slice("sha256:".length) };
}

const relayRequest = (command: SandboxCommand): RuntimeSandboxExecRelayRequest => ({
  argv: [command.command, ...(command.args ?? [])], cwd: command.cwd ?? "", env: command.env ?? {},
  stdinBase64: Buffer.from(command.stdin ?? "", "utf8").toString("base64"),
}) as RuntimeSandboxExecRelayRequest;

describe("provider-conformance runner transport and preinstalled provider pack (CONF3a, CONF3b)", () => {
  let fixtureRoot: string;
  const previousEnvironment = { ...process.env };
  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "native-conformance-transport-"));
    process.env.PAPERCLIP_RUNNER_STATE_DIR = join(fixtureRoot, "runner-state");
    process.env.PAPERCLIP_HOME = join(fixtureRoot, "home");
    state.createBackend.mockClear();
    state.createTransport.mockClear();
    state.persistProcess.mockClear();
    setupRunnerPrpWebSocketServer(createHttpServer(), { apiUrl: "http://127.0.0.1:3100" });
  });
  afterEach(async () => {
    process.env = { ...previousEnvironment };
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  async function fixture(options: { ingress?: boolean } = {}) {
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
    state.reference = { workspaceRepositoryMode: "server_verified_none", state: "prepared", workspaceId: ids.workspace,
      leaseId: ids.lease, providerLeaseId, remoteCwd: taskRoot, descriptorSha256: "d".repeat(64), baselineSha256: "e".repeat(64) };
    const workspaceProof = { schema: "paperclip.native-opencode-conformance-workspace/v1", groupId: ids.group,
      companyId: ids.company, agentId: ids.agent, workspaceId: ids.workspace, taskId: ids.task, taskRoot, localCwd: taskRoot,
      remoteCwd: taskRoot, creationReceipt: "f".repeat(64), createdEmpty: true, leaseId: ids.lease, providerLeaseId,
      authorityHash: state.authorityHash, descriptorSha256: "d".repeat(64), baselineSha256: "e".repeat(64),
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
    const manifestRow: Row = { id: randomUUID(), companyId: ids.company, runId: ids.run, agentId: ids.agent, hash: "b".repeat(64),
      manifest: { capabilities: [], responsibleUserId: ids.user } };
    const lease: Row = { id: ids.lease, companyId: ids.company, heartbeatRunId: ids.run, status: "active",
      expiresAt: new Date(Date.now() + 3_600_000), provider: "fixture-sandbox", providerLeaseId,
      environmentId: ids.environment, metadata: { remoteCwd: taskRoot } };
    const tables = new Map<unknown, Row[]>([[heartbeatRuns, [run]], [issues, [task]], [orchestrationPlans, [plan]],
      [agentExecutionManifests, [manifestRow]], [environmentLeases, [lease]], [orchestrationWorkerAttempts, []]]);
    const packRoot = join(fixtureRoot, "provider-pack");
    const { manifest, nodeSha } = await providerPack(packRoot);
    const runnerBytes = "fixture runnerd bytes\n";
    const runnerBinary = join(fixtureRoot, "paperclip-runnerd");
    await writeFile(runnerBinary, runnerBytes, { mode: 0o755 });
    const caBundle = join(fixtureRoot, "runner-ca.pem");
    await writeFile(caBundle, "fixture CA\n");
    const runnerSha = createHash("sha256").update(runnerBytes).digest("hex");
    const runtimeRoot = posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner");
    const remoteBinary = posix.join(runtimeRoot, "bin", "paperclip-runnerd");
    const installedPack = "/opt/paperclip-runner/provider-pack";
    const stagedPack = posix.join(runtimeRoot, "provider-pack");

    // The Sandbox: every provider-artifact command first passes the same
    // RuntimeControl matchers the conformance lane applies (control.ts), or it
    // is refused as RuntimeControl refuses it.
    const commands: SandboxCommand[] = [];
    const refusals: SandboxCommand[] = [];
    const ok = (stdout = "") => ({ exitCode: 0, signal: null, timedOut: false, stdout, stderr: "" });
    const absent = () => ({ exitCode: 1, signal: null, timedOut: false, stdout: "", stderr: "" });
    const execute = async (command: SandboxCommand) => {
      commands.push(structuredClone(command));
      // CONF4b: the runner trust-bundle copy. RuntimeControl's conformance
      // lane admits it only with its credentialless purpose and the exact
      // command; a purpose-less copy goes to model-credential issuance, which
      // the hidden probe Run refuses outside its one initial provider turn.
      const writesTrustBundle = command.args?.[1]?.includes("runner-ca-bundle.pem") === true;
      if (command.nativePreparationPurpose === NATIVE_RUNNER_TRUST_BUNDLE_PREPARATION_PURPOSE || writesTrustBundle) {
        const request = relayRequest({ ...command, cwd: command.cwd ?? taskRoot });
        const credentialFree = !Object.keys(request.env ?? {}).some(key => key.startsWith("PAPERCLIP_MANAGED_MODEL_") ||
          ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PAPERCLIP_SANDBOX_BROKER_TOKEN"].includes(key));
        if (command.nativePreparationPurpose !== NATIVE_RUNNER_TRUST_BUNDLE_PREPARATION_PURPOSE || !credentialFree ||
            !exactNativeConformanceRunnerTrustBundleCommand({ request, taskRoot, execution,
              trustBundle: readConfiguredNativeRunnerTrustBundle({ PAPERCLIP_RUNNER_CA_BUNDLE_PATH: caBundle }) })) {
          refusals.push(structuredClone(command));
          throw new Error("A conformance RuntimeTools capability is limited to one initial provider turn per hidden Run");
        }
        return ok();
      }
      if (command.nativePreparationPurpose === "provider_artifact") {
        const profile = run.runnerProfileJson as Row;
        const authority = (profile.nativeOpenCodeSourceAuthority as Row | undefined)?.artifactAuthority;
        const request = relayRequest(command);
        const credentialFree = !Object.keys(request.env ?? {}).some(key => key.startsWith("PAPERCLIP_MANAGED_MODEL_") ||
          ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PAPERCLIP_SANDBOX_BROKER_TOKEN"].includes(key));
        if (!credentialFree || !(exactNativeProviderArtifactChunkCommand({ request, taskRoot }) ||
            exactNativeManagedArtifactCommand({ request, taskRoot, authority }))) {
          refusals.push(structuredClone(command));
          throw new Error("Conformance preparation requires the exact current group workspace, credential scope, and Native command");
        }
      }
      const argv = [command.command, ...(command.args ?? [])];
      if (command.nativePreparationPurpose === "native_provider_data_erasure_probe") return ok("qualified\n");
      // A fresh probe session has no retained harness state.
      if (command.nativePreparationPurpose === "native_harness_state" && command.args?.[1]?.includes("runner-state.json"))
        return absent();
      if (command.nativePreparationPurpose === "native_session_start") return absent();
      if (argv[0] === "/bin/sh" && argv[2] === NATIVE_FIXED_ARTIFACT_CHECKSUM_SCRIPT) {
        if (argv[4] === remoteBinary) return ok(`${runnerSha}  ${argv[4]}\n`);
        if (argv[4] === posix.join(installedPack, REMOTE_PROVIDER_PACK_ARTIFACT_PATHS.nodeCommand)) return ok(`${nodeSha}  ${argv[4]}\n`);
        return absent();
      }
      if (argv[0] === remoteBinary && argv[1] === "--build-metadata") return ok(JSON.stringify({
        schema: "paperclip-runner/runnerd-build-metadata/v1", binaryName: "paperclip-runnerd",
        packageName: "@paperclipai/paperclip-runner", binaryContractVersion: 2,
        durableSessionCapabilities: ["unlimited_runtime", "connection_lease_renewal"], prpTransportModes: ["dial_wss"] }));
      if (argv[0] === "sh" && argv[2] === NATIVE_SELECTED_PROVIDER_PACK_DISCOVERY_SCRIPT) return ok(`${installedPack}\n`);
      if (argv[1] === "--version") return ok(`${REMOTE_PROVIDER_PACK_PINS.opencode}\n`);
      return ok();
    };
    const target = { kind: "remote", transport: "sandbox", providerKey: "fixture-sandbox", environmentId: ids.environment,
      leaseId: ids.lease, remoteCwd: taskRoot, effectiveCapabilities: { runnerWebSocketIngress: options.ingress === true },
      runner: { execute } } as const;
    const runnerEnvironment = { PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: "https://broker.test.invalid",
      ANTHROPIC_API_KEY: "paperclip-managed-model-broker" };
    const serverEnvironment = { PAPERCLIP_RUNNER_PUBLIC_URL: "wss://runner.conformance.test",
      PAPERCLIP_RUNNER_CA_BUNDLE_PATH: caBundle, PAPERCLIP_RUNNER_REMOTE_BINARY_PATH: runnerBinary,
      PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH: packRoot };
    const createBackend = (environment: Record<string, string | undefined> = serverEnvironment,
      sandboxEnvironment: Record<string, string> = runnerEnvironment, extra: Record<string, unknown> = {}) =>
      nativeOpenCodeConformanceBackendFactory({ db: fakeDb(tables) as never, execution, runnerInstanceId: ids.runner,
        runnerExecutionTarget: target as never, durableEnvironmentLeaseId: ids.lease,
        runnerEnvironment: sandboxEnvironment, ...extra }, environment)();
    /** Build the backend and run its control-plane registration: transport
     * selection, runnerd staging and the provider pack. */
    const register = async (...args: Parameters<typeof createBackend>) => {
      await createBackend(...args);
      const backendOptions = state.createBackend.mock.calls.at(-1)![1] as { codexTransportFactory: () => unknown };
      backendOptions.codexTransportFactory();
      const transport = state.createTransport.mock.calls.at(-1)![0] as {
        controlPlaneRegistration: (authority: unknown) => Promise<{ connection: Record<string, unknown>; release: () => unknown }>;
      };
      return transport.controlPlaneRegistration({});
    };
    /** Launch runnerd through the backend's remote launcher after registration,
     * which stages the launch assets (the runner trust bundle among them). */
    const launch = () => {
      const transport = state.createTransport.mock.calls.at(-1)![0] as {
        runnerProcessLauncher: (spec: { command: string; args: readonly string[]; cwd: string;
          environment: NodeJS.ProcessEnv }) => { completion: Promise<unknown> };
      };
      const handle = transport.runnerProcessLauncher({ command: remoteBinary, args: [], cwd: taskRoot, environment: {} });
      return handle.completion.then(() => undefined, (error: unknown) => error);
    };
    return { ids, taskRoot, execution, manifest, installedPack, stagedPack, commands, refusals, register, launch,
      serverEnvironment, runnerEnvironment, caBundle, createBackend };
  }

  it("stages the runner trust bundle through its credentialless conformance purpose (CONF4b)", async () => {
    const { taskRoot, execution, commands, refusals, register, launch, caBundle } = await fixture();
    const registration = await register();
    try {
      // The fake Sandbox fails the launch command itself; the launch assets
      // (the trust bundle among them) are staged before it.
      expect(String(await launch())).not.toContain("one initial provider turn");
      const target = nativeRemoteRunnerTrustBundlePath(taskRoot);
      expect(registration.connection.caBundlePath).toBe(target);
      // Before the fix the copy carried no purpose, so RuntimeControl sent it to
      // model-credential issuance and the probe Run refused it.
      expect(refusals).toEqual([]);
      const copies = commands.filter(command => command.args?.[1]?.includes("runner-ca-bundle.pem"));
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({ command: "sh", nativePreparationPurpose: NATIVE_RUNNER_TRUST_BUNDLE_PREPARATION_PURPOSE });
      expect(copies[0]!.args).toEqual(["-c", buildRemoteRunnerFileStageScript(target, 0o600)]);
      expect(copies[0]!.env).toBeUndefined();
      expect(Buffer.from(copies[0]!.stdin ?? "", "base64").toString("utf8")).toBe("fixture CA\n");
      expect(exactNativeConformanceRunnerTrustBundleCommand({ request: relayRequest({ ...copies[0]!, cwd: taskRoot }), taskRoot,
        execution, trustBundle: readConfiguredNativeRunnerTrustBundle({ PAPERCLIP_RUNNER_CA_BUNDLE_PATH: caBundle }) })).toBe(true);
    } finally {
      await registration.release();
    }
  });

  it("refuses runner trust-bundle copies outside the exact path, bundle, input and credential scope (CONF4b)", async () => {
    const { taskRoot, execution, caBundle } = await fixture();
    const bundle = readConfiguredNativeRunnerTrustBundle({ PAPERCLIP_RUNNER_CA_BUNDLE_PATH: caBundle });
    expect(bundle?.toString("utf8")).toBe("fixture CA\n");
    const target = nativeRemoteRunnerTrustBundlePath(taskRoot);
    const exact = { command: "sh", args: ["-c", buildRemoteRunnerFileStageScript(target, 0o600)], cwd: taskRoot,
      stdin: bundle!.toString("base64") };
    const check = (command: SandboxCommand, options: { trustBundle?: Buffer | null; root?: string } = {}) =>
      exactNativeConformanceRunnerTrustBundleCommand({ request: relayRequest(command), taskRoot: options.root ?? taskRoot,
        execution, trustBundle: options.trustBundle === undefined ? bundle : options.trustBundle });
    expect(check(exact)).toBe(true);
    // Another bundle, an extra byte, raw (single-encoded) or empty stdin.
    expect(check({ ...exact, stdin: Buffer.from("attacker CA\n").toString("base64") })).toBe(false);
    expect(check({ ...exact, stdin: Buffer.from("fixture CA\n\n").toString("base64") })).toBe(false);
    expect(check({ ...exact, stdin: "" })).toBe(false);
    expect(relayRequest({ ...exact, stdin: undefined }).stdinBase64).toBe("");
    // No configured bundle, or one over the bound.
    expect(check(exact, { trustBundle: null })).toBe(false);
    expect(check(exact, { trustBundle: Buffer.alloc(0) })).toBe(false);
    expect(check(exact, { trustBundle: Buffer.alloc(2 * 1024 * 1024 + 1) })).toBe(false);
    // Another target path, mode, shell, extra argument or cwd.
    const otherTarget = posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "bin", "paperclip-runnerd");
    expect(check({ ...exact, args: ["-c", buildRemoteRunnerFileStageScript(otherTarget, 0o600)] })).toBe(false);
    expect(check({ ...exact, args: ["-c", buildRemoteRunnerFileStageScript("/etc/ssl/certs/ca-certificates.crt", 0o600)] })).toBe(false);
    expect(check({ ...exact, args: ["-c", buildRemoteRunnerFileStageScript(target, 0o644)] })).toBe(false);
    expect(check({ ...exact, args: ["-c", `${buildRemoteRunnerFileStageScript(target, 0o600)}; id`] })).toBe(false);
    expect(check({ ...exact, command: "bash" })).toBe(false);
    expect(check({ ...exact, args: [...exact.args, "extra"] })).toBe(false);
    expect(check({ ...exact, cwd: `${taskRoot}/sub` })).toBe(false);
    // Any environment, including the managed-model sentinel and broker origin.
    expect(check({ ...exact, env: { ANTHROPIC_API_KEY: "paperclip-managed-model-broker" } })).toBe(false);
    expect(check({ ...exact, env: { PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: "https://broker.test.invalid" } })).toBe(false);
    expect(check({ ...exact, env: { SSL_CERT_FILE: target } })).toBe(false);
    // Another task root than the probe's server-verified workspace.
    const otherRoot = `${taskRoot}-other`;
    expect(check({ ...exact, cwd: otherRoot, args: ["-c", buildRemoteRunnerFileStageScript(nativeRemoteRunnerTrustBundlePath(otherRoot), 0o600)] },
      { root: otherRoot })).toBe(false);
  });

  it("keeps Worker and conversation trust-bundle copies on their existing lane and binds the copy to its fixed path", async () => {
    const { taskRoot, caBundle } = await fixture();
    const recorded: SandboxCommand[] = [];
    const target = { kind: "remote", transport: "sandbox", providerKey: "fixture-sandbox", leaseId: randomUUID(), remoteCwd: taskRoot,
      runner: { execute: async (command: SandboxCommand) => { recorded.push(structuredClone(command));
        return { exitCode: 0, signal: null, timedOut: false, stdout: "", stderr: "" }; } } } as never;
    const path = nativeRemoteRunnerTrustBundlePath(taskRoot);
    await stageRemoteRunnerTrustBundle({ target, runner: (target as { runner: never }).runner, sourcePath: caBundle,
      targetPath: path, providerConformanceProbe: false });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.nativePreparationPurpose).toBeUndefined();
    await expect(stageRemoteRunnerTrustBundle({ target, runner: (target as { runner: never }).runner, sourcePath: caBundle,
      targetPath: posix.join(taskRoot, "runner-ca-bundle.pem"), providerConformanceProbe: true }))
      .rejects.toThrow(/runner trust bundle target changed/);
    expect(recorded).toHaveLength(1);
  });

  it("dials the server's runner URL with its CA bundle and adopts the preinstalled pack RuntimeControl admits", async () => {
    const { ids, taskRoot, manifest, installedPack, stagedPack, commands, refusals, register } = await fixture();
    const registration = await register();
    try {
      // CONF3a: before the fix the backend had no runner URL and stopped with
      // runner_transport_ineligible before staging anything.
      expect(registration.connection).toMatchObject({ mode: "connect",
        caBundlePath: posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "bin", "runner-ca-bundle.pem") });
      expect(String(registration.connection.connectUrl)).toMatch(new RegExp(`^wss://runner\\.conformance\\.test/.*${ids.run}`));
      // CONF3b: before the fix the pack check went out with no environment,
      // RuntimeControl refused it and conformance refused to upload a pack.
      expect(refusals).toEqual([]);
      const verification = commands.filter(command => command.command === posix.join(installedPack,
        REMOTE_PROVIDER_PACK_ARTIFACT_PATHS.nodeCommand));
      expect(verification).toHaveLength(1);
      expect(verification[0]!.args).toEqual(nativeProviderPackVerificationArgs(installedPack, manifest));
      expect(verification[0]!.env).toEqual({ ...REMOTE_NATIVE_ERASER_ENV });
      expect(commands.some(command => command.args?.[1] === nativeProviderPackLinkCommand(installedPack, stagedPack))).toBe(true);
      // Nothing was uploaded in place of the preinstalled pack.
      expect(commands.some(command => command.args?.[1] === `rm -rf '${stagedPack}'`)).toBe(false);
    } finally {
      await registration.release();
    }
  });

  it("fails closed without a server runner URL; the Sandbox environment cannot supply one and ingress is not granted", async () => {
    // Each case is a fresh probe Run: a refused registration keeps its runner state.
    const missing = await fixture();
    const { PAPERCLIP_RUNNER_PUBLIC_URL: _url, ...withoutUrl } = missing.serverEnvironment;
    await expect(missing.register(withoutUrl, { ...missing.runnerEnvironment,
      PAPERCLIP_RUNNER_PUBLIC_URL: "wss://attacker.invalid" })).rejects.toThrow(/runner_transport_ineligible/);
    expect(missing.commands.filter(command => command.nativePreparationPurpose === "provider_artifact")).toEqual([]);
    const userinfo = await fixture();
    await expect(userinfo.register({ ...userinfo.serverEnvironment,
      PAPERCLIP_RUNNER_PUBLIC_URL: "wss://user:secret@runner.conformance.test" })).rejects.toThrow(/runner_direct_wss_failed/);
    const caBundle = await fixture();
    await expect(caBundle.register({ ...caBundle.serverEnvironment, PAPERCLIP_RUNNER_CA_BUNDLE_PATH: "/nonexistent/runner-ca.pem" }))
      .rejects.toThrow(/runner_direct_wss_failed: configured runner CA bundle is unavailable/);
    const ingress = await fixture({ ingress: true });
    await expect(ingress.register()).rejects.toThrow(/runner_ingress_unavailable/);
    for (const refused of [missing, userinfo, caBundle, ingress])
      expect(refused.commands.filter(command => command.nativePreparationPurpose === "provider_artifact")).toEqual([]);
  });

  it("admits the pack check only with exactly the eraser environment, the exact pack root and manifest", async () => {
    const { taskRoot, manifest, installedPack, stagedPack, register } = await fixture();
    const registration = await register();
    await registration.release();
    const authority = { runnerSha256: "0".repeat(64), installedPackRoot: installedPack, providerPackManifest: manifest };
    const node = (root: string) => posix.join(root, REMOTE_PROVIDER_PACK_ARTIFACT_PATHS.nodeCommand);
    const check = (env: Record<string, string> | undefined, root = installedPack, packManifest: unknown = manifest) =>
      exactNativeManagedArtifactCommand({ taskRoot, authority, request: { argv: [node(root),
        ...nativeProviderPackVerificationArgs(root, packManifest)], cwd: taskRoot, stdinBase64: "", ...(env ? { env } : {}) } });
    expect(check({ ...REMOTE_NATIVE_ERASER_ENV })).toBe(true);
    expect(check({ ...REMOTE_NATIVE_ERASER_ENV }, stagedPack)).toBe(true);
    // The pre-fix request, and every other environment.
    expect(check(undefined)).toBe(false);
    expect(check({})).toBe(false);
    const { LD_PRELOAD: _preload, ...missing } = REMOTE_NATIVE_ERASER_ENV;
    expect(check(missing)).toBe(false);
    expect(check({ ...REMOTE_NATIVE_ERASER_ENV, NODE_OPTIONS: "--require=/sandbox/untrusted.cjs" })).toBe(false);
    expect(check({ ...REMOTE_NATIVE_ERASER_ENV, ANTHROPIC_API_KEY: "paperclip-managed-model-broker" })).toBe(false);
    expect(check({ ...REMOTE_NATIVE_ERASER_ENV, PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: "https://broker.test.invalid" })).toBe(false);
    // Another pack root or manifest.
    expect(check({ ...REMOTE_NATIVE_ERASER_ENV }, "/tmp/other-provider-pack")).toBe(false);
    expect(check({ ...REMOTE_NATIVE_ERASER_ENV }, installedPack, { ...manifest, digest: `sha256:${"9".repeat(64)}` })).toBe(false);
  });

  // CONF13. The probe backend had no onSpawn, so the hidden Run kept a null
  // processPid/processStartedAt although its remote runner was launched and
  // monitored. Worker dispatch records it through persistHeartbeatRunProcessMetadata.
  const spawnedBackendOnSpawn = () => (state.createBackend.mock.calls.at(-1)![1] as {
    onSpawn?: (meta: Record<string, unknown>) => Promise<void> }).onSpawn;
  const remoteMarker = (runner: string) => ({ pid: 4242, processGroupId: null,
    startedAt: new Date(1_700_000_000_000).toISOString(), identitySource: "remote_marker", remoteRunnerInstanceId: runner });

  it("records the probe runner's remote process identity through the Worker lane's owner (CONF13)", async () => {
    const { ids, createBackend } = await fixture();
    await createBackend();
    const onSpawn = spawnedBackendOnSpawn();
    expect(typeof onSpawn).toBe("function");
    await onSpawn!(remoteMarker(ids.runner));
    expect(state.persistProcess).toHaveBeenCalledTimes(1);
    expect(state.persistProcess.mock.calls[0]![1]).toBe(ids.run);
    expect(state.persistProcess.mock.calls[0]![2]).toEqual(remoteMarker(ids.runner));
  });

  it("refuses a probe runner identity that is not this backend's exact remote marker (CONF13)", async () => {
    const { ids, createBackend } = await fixture();
    await createBackend();
    const onSpawn = spawnedBackendOnSpawn()!;
    const { identitySource: _source, remoteRunnerInstanceId: _runner, ...local } = remoteMarker(ids.runner);
    await expect(onSpawn(local)).rejects.toMatchObject({ status: 403 });
    await expect(onSpawn(remoteMarker(randomUUID()))).rejects.toMatchObject({ status: 403 });
    await expect(onSpawn({ ...remoteMarker(ids.runner), identitySource: "local" })).rejects.toMatchObject({ status: 403 });
    expect(state.persistProcess).not.toHaveBeenCalled();
    // The owner's own refusal, or a vanished Run, is never treated as recorded.
    state.persistProcess.mockResolvedValueOnce(null);
    await expect(onSpawn(remoteMarker(ids.runner))).rejects.toMatchObject({ status: 403 });
    state.persistProcess.mockRejectedValueOnce(new Error("Remote process marker does not match a current Native remote run binding"));
    await expect(onSpawn(remoteMarker(ids.runner))).rejects.toThrow("Remote process marker does not match");
  });

  it("keeps the process-identity recorder when a caller supplies its own onSpawn (CONF13)", async () => {
    const { ids, createBackend, serverEnvironment, runnerEnvironment } = await fixture();
    const callerOnSpawn = vi.fn(async () => undefined);
    await createBackend(serverEnvironment, runnerEnvironment, { onSpawn: callerOnSpawn });
    const onSpawn = spawnedBackendOnSpawn()!;
    expect(onSpawn).not.toBe(callerOnSpawn);
    await onSpawn(remoteMarker(ids.runner));
    expect(callerOnSpawn).not.toHaveBeenCalled();
    expect(state.persistProcess).toHaveBeenCalledTimes(1);
  });

  it("reads runner operator settings only from the given server environment", () => {
    expect(nativeRunnerOperatorSettings({ PAPERCLIP_RUNNER_PUBLIC_URL: "  wss://runner.test  ",
      PAPERCLIP_RUNNER_CA_BUNDLE_PATH: "   ", PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH: "/opt/pack",
      PAPERCLIP_PUBLIC_URL: "https://ignored.test" })).toEqual({ runnerPublicUrl: "wss://runner.test", runnerCaBundlePath: null,
      runnerRemoteBinaryPath: null, runnerRemoteCodexPath: null, runnerRemoteCodexNpmSpec: null,
      runnerRemoteProviderPackPath: "/opt/pack" });
    expect(Object.isFrozen(nativeRunnerOperatorSettings({}))).toBe(true);
  });
});
