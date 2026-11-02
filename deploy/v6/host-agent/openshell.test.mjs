import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile, lstat, link, symlink, stat, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import http from "node:http";
import { PassThrough, Readable, Writable } from "node:stream";
import { archiveStatusProvesAbsence, dockerInspectRunAsMatches, hasExactManagedModelBrokerPolicy, openShellHostEngine, NATIVE_SESSION_UPPER_ERASE_SCRIPT } from "./openshell.mjs";
import { sandboxCapabilitySnapshotSchema, sandboxHostRequestSchema, sandboxHostReplySchema } from "../../../packages/shared/dist/index.js";

const scope = {
  companyId: randomUUID(),
  bindingId: randomUUID(),
  cellId: randomUUID(),
  cellGeneration: "1",
};
scope.sandboxRef = `aw-v7-${scope.bindingId}`;
const input = (action) => ({
  version: 1,
  action,
  scope,
  hostEpoch: 1,
  requesterUserId: "fixture-owner",
  imageDigest: "fixture.invalid/image@sha256:" + "a".repeat(64),
});
const policyDocument = {
  version: 1,
  filesystem_policy: { include_workdir: false, read_only: ["/etc"], read_write: [] },
  landlock: { compatibility: "hard_requirement" },
  process: { run_as_user: "1000", run_as_group: "1000" },
  network_policies: {},
};
const businessPolicyDocument = {
  ...policyDocument,
  filesystem_policy: { ...policyDocument.filesystem_policy, read_write: ["/workspace/project"] },
};
const readOnlyRuntime = { ...policyDocument,
  filesystem_policy: { ...policyDocument.filesystem_policy, read_only: ["/.openshell/runtime"] } };
const policyHash = "b".repeat(64);
const resourceLimits = { cpuMillis: 1500, memoryBytes: 536870912, diskBytes: 1073741824, pidsLimit: 128 };
const defaultQualificationFixtures = {
  runAsUser: "1000", runAsGroup: "1000",
  filesystem: { allowedReadPath: "/etc/os-release", allowedReadMarker: "a",
    deniedReadPath: "/opt/aw-denied-canary", deniedReadMarker: "d", escapeViaRoot: "/etc",
    escapeOperand: "/etc/../opt/aw-escape-canary", escapeTargetPath: "/opt/aw-escape-canary",
    escapeReadMarker: "e", workdirPath: "/workspace/project" },
  network: { version: 1,
    allow: { urlTemplate: "https://canary.example.test/allow/{nonce}", method: "GET", marker: "canary-ok" },
    hostPortDeny: { urlTemplate: "https://canary.example.test:444/port-deny/{nonce}", method: "GET", marker: "canary-ok" },
    wrongHostDeny: { urlTemplate: "https://wrong-canary.example.test/host-deny/{nonce}", method: "GET", marker: "canary-ok" },
    redirectDeny: { urlTemplate: "https://canary.example.test/redirect/{nonce}", method: "GET", marker: "canary-ok" },
    dnsRedirectDeny: { urlTemplate: "https://canary.example.test/dns-redirect/{nonce}", method: "GET",
      resolveIp: "203.0.113.8", marker: "canary-ok" },
    l7Allow: { urlTemplate: "https://canary.example.test/l7-allow/{nonce}", method: "GET", marker: "canary-ok" },
    l7Deny: { urlTemplate: "https://canary.example.test/l7-deny/{nonce}", method: "POST", marker: "canary-ok" } },
};
function testProbeFixture(config = defaultQualificationFixtures) {
  const base = { version: 1, runAsUser: config.runAsUser, runAsGroup: config.runAsGroup,
    filesystem: structuredClone(config.filesystem), network: structuredClone(config.network),
    ...(config.credential ? { credential: structuredClone(config.credential) } : {}) };
  return { ...base, fixtureHash: createHash("sha256").update(JSON.stringify(canonical(base))).digest("hex") };
}
function testProbeDocument(fixture = testProbeFixture()) {
  const fs = fixture.filesystem;
  const readOnly = [...new Set(["/.openshell/runtime", "/bin", "/etc", "/usr/bin", "/proc",
    "/proc/self/status", "/proc/sys/net/ipv4/ip_unprivileged_port_start", "/proc/sys/kernel/cap_last_cap",
    "/sys/fs/cgroup", fs.allowedReadPath, fs.escapeViaRoot])].sort();
  const endpoints = new Map();
  const addEndpoint = (item, method = item.method, pathValue = null) => {
    const url = new URL(item.urlTemplate.replace("{nonce}", "AWQUALIFICATIONNONCE"));
    const path = pathValue ?? url.pathname.split("/").map(segment => segment === "AWQUALIFICATIONNONCE" ? "?".repeat(32) : segment).join("/");
    const port = Number(url.port || 443), key = `${url.hostname.toLowerCase()}\0${port}`;
    const endpoint = endpoints.get(key) ?? { host: url.hostname.toLowerCase(), port,
      protocol: "rest", enforcement: "enforce", rules: [] };
    const rule = { allow: { method, path } };
    if (!endpoint.rules.some(value => JSON.stringify(canonical(value)) === JSON.stringify(canonical(rule)))) endpoint.rules.push(rule);
    endpoints.set(key, endpoint);
  };
  for (const key of ["allow", "redirectDeny", "dnsRedirectDeny", "l7Allow"]) {
    const item = fixture.network[key];
    addEndpoint(item);
  }
  const deny = fixture.network.l7Deny;
  addEndpoint(deny, deny.method === "GET" ? "POST" : "GET", "/__aw_qualification_l7_sentinel__");
  if (fixture.credential) addEndpoint({ urlTemplate: `${fixture.credential.origin.replace(/\/$/, "")}/mcp/gateways/${fixture.credential.gatewayPublicId}`, method: "POST" },
    "POST", `/mcp/gateways/${fixture.credential.gatewayPublicId}`);
  const networkPolicies = {};
  [...endpoints.values()].sort((a, b) => a.host < b.host ? -1 : a.host > b.host ? 1 : a.port - b.port)
    .forEach((endpoint, index) => {
      endpoint.rules.sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
      networkPolicies[`aw_probe_${index}`] = { name: `aw_probe_${index}`, binaries: [{ path: "/usr/bin/curl" }], endpoints: [endpoint] };
    });
  return { version: 1,
    filesystem_policy: { include_workdir: false, read_only: readOnly, read_write: [fs.workdirPath] },
    landlock: { compatibility: "hard_requirement" },
    process: { run_as_user: fixture.runAsUser, run_as_group: fixture.runAsGroup }, network_policies: networkPolicies };
}
const hostAdmission = (idempotencyKey, document = policyDocument, credentialProviderProfile) => ({
  policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey, document,
  resourceLimits, ...(credentialProviderProfile ? { credentialProviderProfile } : {}),
});
function deterministicProvisioningRequestId(digest) {
  const bytes = Buffer.from(digest.slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function hostProvisioning(purpose = "qualification", options = {}) {
  const qualificationFixtures = options.qualificationFixtures
    ? { ...defaultQualificationFixtures, ...options.qualificationFixtures,
      filesystem: { ...defaultQualificationFixtures.filesystem, ...(options.qualificationFixtures.filesystem ?? {}) },
      network: { ...defaultQualificationFixtures.network, ...(options.qualificationFixtures.network ?? {}) } }
    : defaultQualificationFixtures;
  const probeFixture = purpose === "qualification" ? testProbeFixture(qualificationFixtures) : null;
  const document = purpose === "qualification" ? testProbeDocument(probeFixture) : (options.document ?? businessPolicyDocument);
  const value = {
    purpose,
    operationKey: options.operationKey ?? `fixture-${purpose}-operation`,
    bindingVersion: options.bindingVersion ?? 1,
    expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
    policyHash: purpose === "qualification"
      ? createHash("sha256").update(JSON.stringify(canonical(document))).digest("hex") : "c".repeat(64),
    document,
    resourceLimits: options.resourceLimits ?? { cpuMillis: 1000, memoryBytes: 64 * 1024 * 1024,
      diskBytes: 32 * 1024 * 1024, pidsLimit: 16 },
    ...(probeFixture ? { qualificationProbeFixture: probeFixture, probeFixtureHash: probeFixture.fixtureHash } : {}),
  };
  value.idleUntilUnixSeconds = Math.floor(Date.parse(value.expiresAt) / 1000);
  const envelope = { scope: { companyId: scope.companyId, bindingId: scope.bindingId,
    cellId: scope.cellId, cellGeneration: scope.cellGeneration, sandboxRef: scope.sandboxRef },
    hostEpoch: 1, imageDigest: input("prepare").imageDigest, ...value };
  value.provisioningHash = createHash("sha256").update(JSON.stringify(canonical(envelope))).digest("hex");
  value.requestId = deterministicProvisioningRequestId(value.provisioningHash);
  return { ...input("prepare"), provisioning: value };
}
async function prepareProvisioned(engine, request) {
  const result = await engine.execute(randomUUID(), request, deadline());
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.reply.action, "prepare");
  assert.equal(result.reply.provisioningHash, request.provisioning.provisioningHash);
  assert.ok(result.reply.sandboxId && result.reply.containerId,
    "provisioning must return an exact host-created target receipt");
  return result;
}
function resealProvisioning(request) {
  const value = request.provisioning;
  delete value.provisioningHash;
  const envelope = { scope: { companyId: scope.companyId, bindingId: scope.bindingId,
    cellId: scope.cellId, cellGeneration: scope.cellGeneration, sandboxRef: scope.sandboxRef },
    hostEpoch: 1, imageDigest: input("prepare").imageDigest,
    purpose: value.purpose, operationKey: value.operationKey, bindingVersion: value.bindingVersion,
    expiresAt: value.expiresAt, idleUntilUnixSeconds: value.idleUntilUnixSeconds,
    policyHash: value.policyHash, document: canonical(value.document), resourceLimits: canonical(value.resourceLimits),
    ...(value.purpose === "qualification" ? { qualificationProbeFixture: canonical(value.qualificationProbeFixture),
      probeFixtureHash: value.probeFixtureHash } : {}) };
  value.provisioningHash = createHash("sha256").update(JSON.stringify(canonical(envelope))).digest("hex");
  value.requestId = deterministicProvisioningRequestId(value.provisioningHash);
  return request;
}
function qualificationCredentialFixture() {
  const value = { version: 1, fixtureId: "qualification-canary-v1", profileId: "aw-qualification-canary",
    profileHash: "", binaries: ["/usr/bin/curl"], wrongBinaryPath: "/usr/bin/wget",
    origin: "https://gateway.example.test", port: 443, method: "POST", gatewayPublicId: "gateway-fixture-1",
    toolName: "mcp.qualification-canary-1234abcd:read-canary", wrongToolName: "aw_wrong_destination_canary",
    marker: "qualification-marker" };
  value.argumentTemplateHash = createHash("sha256").update(JSON.stringify(canonical({
    caseId: "<caseId>", fixtureId: "<fixtureId>", nonce: "<nonce>",
  }))).digest("hex");
  const base = { ...value };
  delete base.profileHash;
  // The profile hash is computed from the exact immutable profile below.
  const profile = qualificationCredentialProfile(value);
  value.profileHash = createHash("sha256").update(JSON.stringify(canonical(profile))).digest("hex");
  value.fixtureHash = createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
  return { metadata: value, profile };
}
function qualificationCredentialProfile(fixture) {
  return { id: fixture.profileId,
    credentials: [{ name: "qualification_token", env_vars: ["PAPERCLIP_SANDBOX_QUALIFICATION_TOKEN"],
      required: true, auth_style: "bearer", header_name: "Authorization" }],
    endpoints: [{ host: new URL(fixture.origin).hostname, port: fixture.port, protocol: "rest",
      enforcement: "enforce", allow_uninspected_credentials: false, path: "",
      rules: [{ allow: { method: "POST", path: `/mcp/gateways/${fixture.gatewayPublicId}` } }] }],
    binaries: [{ path: "/usr/bin/curl" }] };
}
function installedRuntimeProfiles(origin = "https://gateway.example.test") {
  const parsed = new URL(origin);
  const app = { id: "paperclip-runtime-app",
    credentials: [{ name: "app_token", env_vars: ["PAPERCLIP_SANDBOX_BROKER_TOKEN"], required: true,
      auth_style: "bearer", header_name: "Authorization" }],
    endpoints: [{ host: parsed.hostname, port: Number(parsed.port || 443), protocol: "rest", enforcement: "enforce", path: "",
      rules: [{ allow: { method: "POST", path: "/mcp/gateways/*" } }] }],
    binaries: [{ path: "/usr/bin/curl" }] };
  const model = { id: "paperclip-runtime-model",
    credentials: [{ name: "model_token", env_vars: ["PAPERCLIP_SANDBOX_MODEL_TOKEN"], required: true,
      auth_style: "bearer", header_name: "Authorization" }],
    endpoints: [{ host: parsed.hostname, port: Number(parsed.port || 443), protocol: "rest", enforcement: "enforce", path: "",
      rules: [{ allow: { method: "POST", path: "/runtime-tools/model/v1/messages" } }] }],
    binaries: [{ path: "/usr/bin/node" }] };
  const hashProfile = profile => createHash("sha256").update(JSON.stringify(canonical(profile))).digest("hex");
  return {
    app, model,
    selection: {
      app: { id: app.id, hash: hashProfile(app), origin, binaries: ["/usr/bin/curl"] },
      model: { id: model.id, hash: hashProfile(model), origin, binaries: ["/usr/bin/node"] },
    },
    installed: { [app.id]: app, [model.id]: model },
  };
}
function runtimeProfileSelection(profile, model = false) {
  if (!profile || typeof profile.id !== "string" || !Array.isArray(profile.endpoints) || profile.endpoints.length !== 1 ||
    !Array.isArray(profile.binaries)) return null;
  const endpoint = profile.endpoints[0];
  if (typeof endpoint.host !== "string" || !Number.isSafeInteger(endpoint.port)) return null;
  const origin = `https://${endpoint.host}${endpoint.port === 443 ? "" : `:${endpoint.port}`}`;
  const hash = createHash("sha256").update(JSON.stringify(canonical(profile))).digest("hex");
  return { id: profile.id, hash, origin, binaries: profile.binaries.map(binary => binary.path) };
}
function qualificationCredentialPolicy(fixture) {
  return { ...policyDocument, filesystem_policy: { ...policyDocument.filesystem_policy,
    read_only: ["/etc", "/usr/bin"] }, network_policies: { qualification: { name: "qualification-canary",
    binaries: [{ path: "/usr/bin/curl" }], endpoints: [{ host: new URL(fixture.origin).hostname,
      port: fixture.port, protocol: "rest", enforcement: "enforce",
      rules: [{ allow: { method: "POST", path: `/mcp/gateways/${fixture.gatewayPublicId}` } }] }] } } };
}
function qualificationCredentialToken({ commandId, request, fixture, provisioning, sandboxId, containerId, tokenCase,
  targetQualificationHash }) {
  const nonce = randomUUID().replaceAll("-", "");
  const args = { caseId: tokenCase, fixtureId: fixture.fixtureId, nonce };
  const body = { jsonrpc: "2.0", id: commandId, method: "tools/call",
    params: { name: fixture.toolName, arguments: args } };
  const expiresAt = new Date(Math.min(Date.parse(deadline()), Date.now() + 20_000)).toISOString();
  const jti = randomUUID().replaceAll("-", "");
  const claim = { version: 1, purpose: "qualification_credential_probe", aud: "paperclip-sandbox-qualification",
    jti, commandId, caseId: tokenCase, fixtureId: fixture.fixtureId, fixtureHash: fixture.fixtureHash,
    hostEpoch: 1, scope: { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId,
      generation: scope.cellGeneration, sandboxRef: scope.sandboxRef }, bindingVersion: 1, sandboxId, containerId,
    provisioningHash: provisioning.provisioningHash, profileId: fixture.profileId, profileHash: fixture.profileHash,
    binaries: fixture.binaries, gatewayPublicId: fixture.gatewayPublicId, toolName: fixture.toolName,
    argumentTemplateHash: fixture.argumentTemplateHash,
    argumentsHash: createHash("sha256").update(JSON.stringify(canonical(args))).digest("hex"),
    requestBodyHash: createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex"),
    nonce, origin: fixture.origin, method: "POST", path: `/mcp/gateways/${fixture.gatewayPublicId}`,
    connectionId: randomUUID(), grantId: randomUUID(), secretVersionHash: "d".repeat(64),
    sourceBindingHash: "e".repeat(64), targetQualificationHash,
    operatorUserId: "fixture-operator", operatorSessionId: "fixture-session", expiresAt, maxUses: 1 };
  const encoded = Buffer.from(JSON.stringify({ purpose: "sandbox_qualification_broker",
    aud: "paperclip-sandbox-qualification", jti, exp: Math.floor(Date.parse(expiresAt) / 1000),
    qualification_credential: claim })).toString("base64url");
  const token = `eyJhbGciOiJub25lIn0.${encoded}.fixture-signature`;
  return { token, nonce };
}
const deadline = () => new Date(Date.now() + 20000).toISOString();
async function fixture(work, hooks = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aw-v7-host-cli-"));
  try {
    const executable = path.join(root, "fixture-cli"),
      stateHome = path.join(root, "private-cli-state");
    await writeFile(executable, "fixture-only-cli", { mode: 0o700 });
    await mkdir(stateHome, { mode: 0o700 });
    const installedProfiles = { ...(hooks.installedProfiles ?? {}) };
    for (const profile of [hooks.qualificationCredentialProfile, hooks.brokerProfile, hooks.modelBrokerProfile])
      if (profile?.id) installedProfiles[profile.id] = profile;
    const inferredRuntimeProfiles = {};
    const appSelection = runtimeProfileSelection(hooks.brokerProfile, false);
    const modelSelection = runtimeProfileSelection(hooks.modelBrokerProfile, true);
    if (appSelection) inferredRuntimeProfiles.app = appSelection;
    if (modelSelection) inferredRuntimeProfiles.model = modelSelection;
    const runtimeBrokerProfiles = hooks.runtimeBrokerProfiles ??
      (Object.keys(inferredRuntimeProfiles).length ? inferredRuntimeProfiles : undefined);
    const config = {
      executable,
      executableSha256: createHash("sha256")
        .update("fixture-only-cli")
        .digest("hex"),
      stateHome,
      gateway: "fixture-gateway",
      workspace: "fixture-company",
      ...(!hooks.omitQualificationFixtures ? { qualificationFixtures: {
        ...defaultQualificationFixtures,
        ...(hooks.qualificationFixtures ?? {}),
        filesystem: { ...defaultQualificationFixtures.filesystem, ...(hooks.qualificationFixtures?.filesystem ?? {}) },
        network: { ...defaultQualificationFixtures.network, ...(hooks.qualificationFixtures?.network ?? {}) },
      } } : {}),
      ...(runtimeBrokerProfiles ? { runtimeBrokerProfiles } : {}),
    };
    const calls = [];
    let runtimeBinaryBytes = hooks.runtimeBinaryBytes ?? "fixture openshell sandbox runtime binary",
      sandboxId = randomUUID(),
      phase = hooks.phase ?? "Ready",
      wrongScope = false,
      extraLabels = {},
      listedSandboxes = [],
      resourceConfig = { NanoCpus: hooks.resourceConfig?.NanoCpus ?? 0,
      Memory: hooks.resourceConfig?.Memory ?? 0, MemorySwap: hooks.resourceConfig?.MemorySwap ?? 0,
        PidsLimit: hooks.resourceConfig?.PidsLimit ?? hooks.pidsLimit ?? 0,
        LogConfig: { Type: "none", Config: {} },
        StorageOpt: hooks.resourceConfig?.StorageOpt ?? hooks.storageOpt ?? { size: `${resourceLimits.diskBytes}B` },
        Tmpfs: { "/run/openshell-supervisor-ca/material": "rw,noexec,nosuid,nodev,size=1m,uid=1000,gid=1000,mode=0755" } },
      attached = [{ name: "fixture-provider" }],
      physical = hooks.physical ?? false,
      running = hooks.running ?? false,
      effectivePolicy = structuredClone(hooks.effectivePolicy ?? policyDocument),
      configRevision = 1,
      wrongContainerLabels = hooks.wrongContainerLabels ?? false,
      containerImageDigest = hooks.containerImageDigest ?? input("inspect").imageDigest;
    let containerId = "d".repeat(64);
    const providerRecords = new Map();
    const originalContainerId = containerId,
      supervisorContainerId = "c".repeat(64),
      imageId = "sha256:" + "e".repeat(64);
    let createCount = 0, failDeleteAfterEffect = false, failStopAfterEffect = false, loseNextCreateResponse = false;
    const requireExpectedSandboxId = command => {
      const index = command.indexOf("--expected-sandbox-id");
      if (index < 0 || command[index + 1] !== sandboxId)
        throw new Error("fixture-expected-sandbox-id-mismatch");
    };
    const run = async (file, args, options) => {
      calls.push({ file, args, options });
      await hooks.beforeCommand?.(file, args);
      assert.equal(options.env.HOME, stateHome);
      assert.equal(options.env.OPENSHELL_GATEWAY_INSECURE, undefined);
      assert.ok(options.timeout <= 18000);
      if (file === "docker") {
        assert.equal(options.env.PATH, process.env.PATH);
        assert.equal(options.env.DOCKER_HOST, "unix:///var/run/docker.sock");
        if (hooks.dockerCommand) {
          const intercepted = await hooks.dockerCommand({ args, options, state: {
            sandboxId: () => sandboxId, containerId: () => containerId, phase: () => phase, running: () => running,
            effectivePolicy: () => structuredClone(effectivePolicy), resourceConfig: () => structuredClone(resourceConfig),
            scope, config, originalContainerId, supervisorContainerId, imageId,
          } });
          if (intercepted?.handled === true) return intercepted.value ?? { stdout: "" };
        }
        if (args[0] === "cp") {
          assert.equal(args[1], `${containerId}:/.openshell/runtime/openshell-sandbox`);
          await writeFile(args[2], runtimeBinaryBytes, { mode: 0o600 });
          return { stdout: "fixture runtime copy\n" };
        }
        if (args[0] === "exec") {
          if (!running && hooks.denyExecWhenStopped)
            throw new Error("fixture-stopped-workload-cannot-exec");
          assert.equal(args[1], "--user");
          assert.equal(args[2], "1000:1000");
          if (args[3] === "--workdir") {
            assert.equal(args[4], "/workspace/project");
            assert.equal(args[5], containerId);
            assert.equal(args[6], "/.openshell/runtime/openshell-sandbox");
            assert.equal(args[7], "runtime-memory-probe");
            assert.equal(args[8], "--limit-bytes");
            assert.equal(args[9], String(hooks.memoryMax ?? 67108864));
            return { stdout: hooks.probeOutputs?.["runtime-memory-probe"] ?? "" };
          }
          assert.equal(args[3], containerId);
          if (hooks.canaryReadable === false)
            throw Object.assign(new Error("fixture-canary-absent"), { code: 1 });
          if (args[4] === "/usr/bin/stat") return { stdout: hooks.canaryStat ?? "regular file:755\n" };
          if (args[4] === "/usr/bin/head") return { stdout: hooks.canaryHostMarker ?? "x" };
          if (args[4] === "/usr/bin/curl")
            return { stdout: hooks.networkHostOutput ?? "canary-ok\n200" };
          if (args[4] === "/usr/bin/wget") return { stdout: hooks.wgetVersion ?? "GNU Wget 1.21.4\n" };
          if (args[4] === "/usr/bin/cat" && args[5] === "/sys/fs/cgroup/pids.max")
            return { stdout: `${hooks.pidsLimit ?? 8}\n` };
          if (args[4] === "/usr/bin/cat" && args[5] === "/sys/fs/cgroup/cpu.max")
            return { stdout: `${hooks.cpuMax ?? "100000 100000"}\n` };
          if (args[4] === "/usr/bin/cat" && args[5] === "/sys/fs/cgroup/memory.max")
            return { stdout: `${hooks.memoryMax ?? 67108864}\n` };
          if (args[4] === "/usr/bin/cat" && args[5] === "/sys/fs/cgroup/memory.swap.max")
            return { stdout: `${hooks.memorySwap ?? hooks.memoryMax ?? 67108864}\n` };
          if (args[4] === "/usr/bin/cat" && args[5] === "/sys/fs/cgroup/memory.oom.group")
            return { stdout: `${hooks.memoryOomGroup ?? "0"}\n` };
          if (args[4] === "/usr/bin/test" && args[5] === "!") return { stdout: "" };
          throw new Error("unexpected-host-canary-command");
        }
        if (args[0] === "info") {
          if (args[2] === "{{.Driver}}") return { stdout: `${hooks.storageDriver ?? "overlay2"}\n` };
          if (args[2] === "{{json .DriverStatus}}")
            return { stdout: JSON.stringify(hooks.driverStatus ?? [["Backing Filesystem", "xfs"]]) };
          return { stdout: "openshell-docker-engine-1\n" };
        }
        if (args[0] === "ps") {
          assert.ok(args.includes("--no-trunc"), "full container IDs are required for pinned target checks");
          const supervisor = args.includes("label=openshell.ai/isolation-role=supervisor");
          return { stdout: physical ? `${supervisor ? supervisorContainerId : containerId}\n` : "" };
        }
        if (args[0] === "image" && args[1] === "inspect")
          return { stdout: JSON.stringify([{ Id: args[2], RepoDigests: hooks.imageRepoDigests ?? [containerImageDigest] }]) };
        if (args[0] === "inspect" && args[1] === supervisorContainerId)
          return { stdout: JSON.stringify([{
            Id: supervisorContainerId, Image: imageId,
            Config: { Image: imageId, Labels: {
              "openshell.ai/managed-by": "openshell",
              "openshell.ai/sandbox-id": sandboxId,
              "openshell.ai/sandbox-name": scope.sandboxRef,
              "openshell.ai/sandbox-namespace": "default",
              "openshell.ai/isolation-role": "supervisor",
            } },
            HostConfig: { LogConfig: hooks.supervisorLogConfig ?? { Type: "none", Config: {} } },
          }]) };
        if (args[0] === "inspect")
          return {
            stdout: JSON.stringify([
              {
                Id: containerId,
                Image: imageId,
                Config: {
                  Image: hooks.containerConfigImage ?? containerImageDigest,
                  WorkingDir: "/workspace/project",
                  ...(hooks.erasureDocker ? { User: "1000:1000" } : {}),
                  Env: hooks.containerEnv ?? [],
                  Labels: {
                    "openshell.ai/managed-by": "openshell",
                    "openshell.ai/sandbox-id": sandboxId,
                    "openshell.ai/sandbox-name": scope.sandboxRef,
                    "openshell.ai/sandbox-namespace": "default",
                    "openshell.ai/sandbox-workspace": config.workspace,
                    "openshell.ai/workspace-root": "/workspace/project",
                    "openshell.ai/isolation-backend": "openshell-sandbox",
                    "openshell.ai/isolation-role": "sandbox",
                    "aw.company_id": wrongContainerLabels ? randomUUID() : scope.companyId,
                    "aw.binding_id": scope.bindingId,
                    "aw.cell_id": scope.cellId,
                    "aw.generation": "1",
                    ...extraLabels,
                  },
                },
                ...(hooks.erasureDocker ? { GraphDriver: { Name: "overlay2", Data: {
                  UpperDir: hooks.erasureDocker.upperDir, MergedDir: hooks.erasureDocker.mergedDir,
                } } } : {}),
                HostConfig: { ...resourceConfig,
                  LogConfig: hooks.logConfig ?? resourceConfig.LogConfig,
                  StorageOpt: hooks.storageOpt ?? resourceConfig.StorageOpt,
                  Tmpfs: hooks.tmpfs ?? resourceConfig.Tmpfs },
                Mounts: hooks.mounts ?? [
                  { Type: "volume", Name: `openshell-channel-${createHash("sha256").update(`default\0${sandboxId}`).digest("hex").slice(0, 32)}`,
                    Driver: "local", Destination: "/.openshell/channel", RW: true },
                  { Type: "tmpfs", Destination: "/run/openshell-supervisor-ca/material", Mode: "rw,noexec,nosuid,nodev,size=1m,uid=1000,gid=1000,mode=0755", RW: true },
                  ...(hooks.extraMounts ?? []),
                ],
                State: { Running: running },
              },
            ]),
          };
        if (args[0] === "update") {
          const updateTarget = args.at(-1);
          assert.equal(updateTarget, containerId, "Docker resource updates must target the full currently observed container ID");
          if (updateTarget !== containerId) throw new Error("fixture-container-replaced");
          const option = name => args[args.indexOf(name) + 1];
          resourceConfig = { ...resourceConfig, NanoCpus: Math.round(Number(option("--cpus")) * 1e9), Memory: Number(option("--memory")),
            MemorySwap: Number(option("--memory-swap")), PidsLimit: Number(option("--pids-limit")) };
          return { stdout: "fixture update" };
        }
        throw new Error("fixture-unexpected-docker-command");
      }
      assert.equal(options.env.PATH, "/usr/bin:/bin");
      const command = args.slice(4);
      if (command[0] === "profile" && command[1] === "describe") {
        const installed = installedProfiles[command[2]];
        return { stdout: JSON.stringify(installed ?? hooks.qualificationCredentialProfile ?? hooks.modelBrokerProfile ?? hooks.brokerProfile ?? {}) };
      }
      if (command[0] === "provider" && command[1] === "create") {
        const expectedToken = hooks.qualificationCapabilityToken ?? hooks.brokerToken;
        assert.ok(!args.some(value => String(value).includes(expectedToken ?? "__never__")));
        assert.equal(options.env.PAPERCLIP_SANDBOX_QUALIFICATION_TOKEN ?? options.env.PAPERCLIP_SANDBOX_BROKER_TOKEN ?? options.env.PAPERCLIP_SANDBOX_MODEL_TOKEN,
          expectedToken, `provider env keys: ${Object.keys(options.env).join(",")}`);
        const option = name => command[command.indexOf(name) + 1];
        providerRecords.set(option("--name"), { name: option("--name"), type: option("--type") });
        return { stdout: "provider created" };
      }
      if (command[0] === "provider" && command[1] === "update") {
        const provider = providerRecords.get(command[2]);
        const expiryArg = command[command.indexOf("--credential-expires-at") + 1];
        if (provider && typeof expiryArg === "string") provider.credential_expires_at = expiryArg.slice(expiryArg.indexOf("=") + 1);
        return { stdout: JSON.stringify(provider ?? { updated: true }) };
      }
      if (command[0] === "provider" && command[1] === "delete") { providerRecords.delete(command[2]); return { stdout: "provider deleted" }; }
      if (command[0] === "provider" && command[1] === "list")
        return { stdout: JSON.stringify({ providers: [...providerRecords.values()].filter(provider =>
          !(hooks.hideModelSessionProviderFromObservation && provider.type === modelBrokerProfile.id)), next_page_token: "" }) };
      if (command[0] === "sandbox" && command[1] === "provider" && command[2] === "attach") {
        requireExpectedSandboxId(command);
        attached.push({ name: command[4] });
        return { stdout: JSON.stringify({ provider: command[4] }) };
      }
      if (command[0] === "sandbox" && command[1] === "provider" && command[2] === "detach") {
        requireExpectedSandboxId(command);
        attached = attached.filter(value => value.name !== command[4]);
        return { stdout: "{}" };
      }
      if (command[0] === "--version") return { stdout: "openshell 0.1.2\n" };
      if (command[0] === "sandbox" && command[1] === "exec") {
        requireExpectedSandboxId(command);
        if (!running && hooks.denyExecWhenStopped)
          throw new Error("fixture-stopped-workload-cannot-exec");
        if (hooks.probeExitCode !== undefined && hooks.probeExitCode !== 0)
          throw Object.assign(new Error("fixture-sandbox-exec-failed"), { code: hooks.probeExitCode });
        const helperCommand = command.slice(command.indexOf("--") + 1);
        if (helperCommand[0] === "/usr/bin/printenv" && helperCommand[1] === "PAPERCLIP_SANDBOX_QUALIFICATION_TOKEN") {
          if (hooks.credentialEnvLeak) return { stdout: `${hooks.qualificationCapabilityToken}\n` };
          throw Object.assign(new Error("fixture-variable-not-set"), { code: 1, stdout: "", stderr: "" });
        }
        if (helperCommand[0] === "/usr/bin/wget") {
          throw Object.assign(new Error("fixture-credential-required"), { code: 8,
            stdout: hooks.credentialWrongBinaryBody ?? JSON.stringify({ error: { data: { reasonCode: "sandbox_qualification_credential_required" } } }),
            stderr: hooks.credentialWrongBinaryStderr ?? "  HTTP/1.1 401 Unauthorized\n" });
        }
        if (helperCommand[0] === "/usr/bin/curl") {
          if (helperCommand.includes("--noproxy"))
            throw Object.assign(new Error("fixture-direct-egress-blocked"), { code: hooks.networkDirectExitCode ?? 7 });
          const url = new URL(helperCommand.at(-1));
          const key = url.pathname.split("/").filter(Boolean).at(-2);
          const output = hooks.qualificationMcpOutput ?? hooks.networkSandboxResponses?.[key] ?? hooks.networkSandboxOutput ?? "canary-ok\n200";
          return { stdout: output };
        }
        if (hooks.probeOutputs?.[helperCommand[1]])
          return { stdout: hooks.probeOutputs[helperCommand[1]] };
        return { stdout: hooks.probeStdout ?? "" };
      }
      if (command[0] === "sandbox" && command[1] === "get")
        return {
          stdout: JSON.stringify({
            id: sandboxId,
            name: scope.sandboxRef,
            workspace: config.workspace,
            phase,
            labels: {
              "aw.company_id": wrongScope ? randomUUID() : scope.companyId,
              "aw.binding_id": scope.bindingId,
              "aw.cell_id": scope.cellId,
              "aw.generation": "1",
              ...extraLabels,
            },
          }),
        };
      if (command[0] === "sandbox" && command[1] === "create") {
        const option = name => command[command.indexOf(name) + 1];
        assert.equal(option("--no-auto-providers"), "--name");
        assert.ok(option("--request-id"));
        sandboxId = randomUUID();
        createCount += 1;
        containerId = createCount === 1 ? originalContainerId : createHash("sha256").update(`fixture-container-${createCount}`).digest("hex");
        phase = "Ready";
        running = true;
        const image = option("--from");
        containerImageDigest = image;
        const cpuText = option("--cpu");
        resourceConfig = { ...resourceConfig,
          NanoCpus: Math.round(Number(cpuText.slice(0, -1)) * 1_000_000),
          Memory: Number(option("--memory")), MemorySwap: Number(option("--memory")),
        };
        const driver = JSON.parse(option("--driver-config-json")).docker;
        resourceConfig.PidsLimit = hooks.createPidsOverride ?? Number(driver.pids_limit);
        resourceConfig.StorageOpt = { size: `${driver.disk_limit_bytes}B` };
        const policyPath = option("--policy");
        effectivePolicy = JSON.parse(await readFile(policyPath, "utf8"));
        extraLabels = {};
        for (let index = 0; index < command.length; index += 1) {
          if (command[index] === "--label") {
            const [key, ...parts] = command[index + 1].split("=");
            extraLabels[key] = parts.join("=");
          }
        }
        const name = option("--name");
        listedSandboxes = [{ id: sandboxId, name, workspace: config.workspace,
          labels: { "aw.company_id": scope.companyId, "aw.binding_id": scope.bindingId,
            "aw.cell_id": scope.cellId, "aw.generation": scope.cellGeneration, ...extraLabels } }];
        if (hooks.createResponseLost || loseNextCreateResponse) {
          loseNextCreateResponse = false;
          throw new Error("fixture-create-response-lost");
        }
        return { stdout: JSON.stringify(listedSandboxes[0]) };
      }
      if (command[0] === "sandbox" && command[1] === "stop") {
        requireExpectedSandboxId(command);
        phase = "Stopped";
        running = false;
        if (failStopAfterEffect) {
          failStopAfterEffect = false;
          throw new Error("fixture-stop-response-lost");
        }
        return { stdout: "Stopped" };
      }
      if (command[0] === "sandbox" && command[1] === "start") {
        requireExpectedSandboxId(command);
        phase = "Ready";
        running = true;
        return { stdout: "Started" };
      }
      if (command[0] === "sandbox" && command[1] === "delete") {
        requireExpectedSandboxId(command);
        listedSandboxes = [];
        sandboxId = undefined;
        if (failDeleteAfterEffect) {
          failDeleteAfterEffect = false;
          throw new Error("fixture-delete-response-lost");
        }
        return { stdout: "Deleted" };
      }
      if (command[0] === "sandbox" && command[1] === "list")
        return { stdout: JSON.stringify({ sandboxes: listedSandboxes, next_page_token: "" }) };
      if (command[0] === "policy" && command[1] === "get")
        return {
          stdout: JSON.stringify({
            sandbox: scope.sandboxRef,
            status: "effective",
            version: 1,
            config_revision: configRevision,
            hash: createHash("sha256").update(JSON.stringify(effectivePolicy)).digest("hex"),
            policy: effectivePolicy,
          }),
        };
      if (command[0] === "policy" && command[1] === "set") {
        requireExpectedSandboxId(command);
        assert.equal(command[2], scope.sandboxRef);
        assert.equal(command[3], "--policy");
        assert.ok((await readFile(command[4], "utf8")).length > 0);
        effectivePolicy = JSON.parse(await readFile(command[4], "utf8"));
        return { stdout: "Policy updated" };
      }
      if (command[1] === "provider" && command[2] === "list")
        return {
          stdout: JSON.stringify({ providers: hooks.hideModelSessionAttachment
            ? attached.filter(value => !String(value.name).startsWith("awms-")) : attached, next_page_token: "" }),
        };
      if (command[1] === "provider" && command[2] === "detach") {
        requireExpectedSandboxId(command);
        attached = [];
        return { stdout: "{}" };
      }
      throw new Error("fixture-unexpected-command");
    };
    const engine = openShellHostEngine({ config, epoch: 1, root, run, spawnProcess: hooks.spawnProcess, hostProcRoot: hooks.hostProcRoot });
    if (hooks.initialJournal) await writeFile(path.join(root, "openshell-journal.json"), JSON.stringify(hooks.initialJournal), { mode: 0o600 });
    await engine.initialize();
    await work({
      engine,
      config,
      calls,
      root,
      run,
      effectivePolicy: () => structuredClone(effectivePolicy),
      replaceSandbox: () => { sandboxId = randomUUID(); },
      sandboxId: () => sandboxId,
      containerId: () => containerId,
      loseNextCreateResponse: () => { loseNextCreateResponse = true; },
      failDeleteAfterEffect: () => { failDeleteAfterEffect = true; },
      failStopAfterEffect: () => { failStopAfterEffect = true; },
      setRuntimeBinaryBytes: value => { runtimeBinaryBytes = value; },
      setEffectivePolicy: value => { effectivePolicy = structuredClone(value); configRevision += 1; },
      clearSandboxIdentity: () => { sandboxId = undefined; },
      enablePhysical: () => { physical = true; },
      setPhase: (value) => { phase = value; running = value === "Ready"; },
      setWrongContainerLabels: () => { wrongContainerLabels = true; },
      setContainerImageDigest: (value) => { containerImageDigest = value; },
      resourceConfig: () => ({ ...resourceConfig }),
      setResourceConfig: value => { resourceConfig = { ...value }; },
      setProbeOutputs: value => { hooks.probeOutputs = { ...value }; },
      replaceContainerBeforeUpdate: () => { containerId = "f".repeat(64); },
      replaceContainer: () => { containerId = createHash("sha256").update(`fixture-container-replacement-${randomUUID()}`).digest("hex"); },
      changePolicyRevision: () => { configRevision += 1; },
      swapScope: () => {
        wrongScope = true;
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function execRequest(deadlineAt = deadline(), stdinBase64 = "") {
  const argv = ["node", "-e", "process.stdout.write('fixture')"];
  const cwd = "/workspace", env = {};
  const commandDigest = createHash("sha256").update(JSON.stringify(canonical({
    argv, cwd, env,
    stdinHash: createHash("sha256").update(Buffer.from(stdinBase64, "base64")).digest("hex"),
    timeoutDeadline: deadlineAt,
    brokerCapabilityHash: null,
    brokerProviderProfile: null,
    modelBrokerCapabilityHash: null,
    modelBrokerProviderProfile: null,
    modelBrokerSession: null,
  }))).digest("hex");
  return {
    requestId: randomUUID(), bindingId: scope.bindingId, hostEpoch: 1,
    runId: randomUUID(), attemptId: randomUUID(), attempt: 1,
    manifestId: randomUUID(), manifestHash: "c".repeat(64),
    policySnapshotId: randomUUID(), policyHash, commandDigest, deadlineAt,
    sandboxRef: scope.sandboxRef, imageDigest: input("inspect").imageDigest,
    argv, cwd, env, stdinBase64,
  };
}
const brokerProfile = {
  id: "paperclip-broker",
  credentials: [{ name: "broker_token", env_vars: ["PAPERCLIP_SANDBOX_BROKER_TOKEN"], required: true, auth_style: "bearer", header_name: "Authorization" }],
  endpoints: [{ host: "paperclip.example.test", port: 443, protocol: "rest", enforcement: "enforce", path: "", rules: [{ allow: { method: "POST", path: "/mcp/gateways/*" } }] }],
  binaries: [{ path: "/usr/bin/node" }],
};
const modelBrokerProfile = {
  id: "paperclip-model-broker",
  credentials: [{ name: "model_token", env_vars: ["PAPERCLIP_SANDBOX_MODEL_TOKEN"], required: true, auth_style: "bearer", header_name: "Authorization" }],
  endpoints: [{ host: "paperclip.example.test", port: 443, protocol: "rest", enforcement: "enforce", path: "", rules: [{ allow: { method: "POST", path: "/runtime-tools/model/v1/messages" } }] }],
  binaries: [{ path: "/usr/bin/node" }],
};
function brokerExecRequest() {
  const request = execRequest();
  const expiresAt = new Date(Math.min(Date.parse(request.deadlineAt), Date.now() + 30000)).toISOString();
  const claim = {
    parentRequestId: request.requestId,
    bindingId: request.bindingId,
    cellId: scope.cellId,
    generation: scope.cellGeneration,
    hostId: randomUUID(),
    hostEpoch: request.hostEpoch,
    runId: request.runId,
    attemptId: request.attemptId,
    attempt: request.attempt,
    manifestId: request.manifestId,
    manifestHash: request.manifestHash,
    policySnapshotId: request.policySnapshotId,
    policyHash: request.policyHash,
    brokerSessionId: request.requestId,
    endpointOrigin: "https://paperclip.example.test",
    bindings: [{ binary: "/usr/bin/node" }],
    expiresAt,
  };
  const claims = {
    purpose: "sandbox_broker",
    aud: "paperclip-sandbox-broker",
    jti: request.requestId,
    company_id: scope.companyId,
    run_id: request.runId,
    exp: Math.floor(Date.parse(expiresAt) / 1000),
    sandbox_broker: claim,
  };
  const token = `fixture.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
  request.env.PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN = claim.endpointOrigin;
  request.env.PAPERCLIP_SANDBOX_BROKER_SESSION_ID = request.requestId;
  request.brokerCredential = { capabilityToken: token, profileId: brokerProfile.id,
    profileHash: createHash("sha256").update(JSON.stringify(canonical(brokerProfile))).digest("hex"), expiresAt };
  const argv = request.argv, cwd = request.cwd, env = request.env;
  request.commandDigest = createHash("sha256").update(JSON.stringify(canonical({ argv, cwd, env,
    stdinHash: createHash("sha256").update(Buffer.from(request.stdinBase64, "base64")).digest("hex"),
    timeoutDeadline: request.deadlineAt,
    brokerCapabilityHash: createHash("sha256").update(token).digest("hex"),
    brokerProviderProfile: { id: request.brokerCredential.profileId, hash: request.brokerCredential.profileHash },
    modelBrokerCapabilityHash: null,
    modelBrokerProviderProfile: null,
    modelBrokerSession: null,
  }))).digest("hex");
  return { request, token };
}
function modelBrokerExecRequest() {
  const request = execRequest();
  const expiresAt = new Date(Math.min(Date.parse(request.deadlineAt), Date.now() + 30000)).toISOString();
  const claims = { scope: "worker_model", company_id: scope.companyId, run_id: request.runId, sub: randomUUID(),
    responsible_user_id: randomUUID(), instance_id: randomUUID(), iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.parse(expiresAt) / 1000) + 1,
    worker_model: { planId: randomUUID(), workerId: randomUUID(), workerAttemptId: randomUUID(),
      executionManifestId: request.manifestId, expectedPlanVersion: 1 } };
  const token = `fixture.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
  request.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN = "https://paperclip.example.test";
  request.env.PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND = "100000";
  request.env.PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS = "1024";
  request.modelBrokerCredential = { capabilityToken: token, profileId: modelBrokerProfile.id,
    profileHash: createHash("sha256").update(JSON.stringify(canonical(modelBrokerProfile))).digest("hex"), expiresAt,
    inputTokensUpperBound: 100000, maxOutputTokens: 1024 };
  request.commandDigest = createHash("sha256").update(JSON.stringify(canonical({ argv: request.argv, cwd: request.cwd, env: request.env,
    stdinHash: createHash("sha256").update(Buffer.from(request.stdinBase64, "base64")).digest("hex"), timeoutDeadline: request.deadlineAt,
    brokerCapabilityHash: null, brokerProviderProfile: null,
    modelBrokerCapabilityHash: createHash("sha256").update(token).digest("hex"),
    modelBrokerProviderProfile: { id: request.modelBrokerCredential.profileId, hash: request.modelBrokerCredential.profileHash },
    modelBrokerSession: null,
  }))).digest("hex");
  return { request, token };
}
function modelBrokerSessionExecRequest(family, phase, prior = null, tokenTtlSeconds = 300, startBindingDigest = null) {
  const request = execRequest();
  if (prior) for (const key of ["bindingId", "hostEpoch", "runId", "attemptId", "attempt", "manifestId", "manifestHash", "policySnapshotId", "policyHash"])
    request[key] = prior.request[key];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ceilingAt = prior?.sessionDeadlineAt ?? new Date((nowSeconds + 900) * 1000).toISOString();
  const tokenExpiresAt = new Date((nowSeconds + tokenTtlSeconds) * 1000).toISOString();
  const expiresAt = new Date(Math.min(Date.parse(tokenExpiresAt), Date.parse(ceilingAt))).toISOString();
  const baseClaims = { scope: family, company_id: scope.companyId, run_id: request.runId,
    sub: prior?.claims.sub ?? randomUUID(), responsible_user_id: prior?.claims.responsible_user_id ?? randomUUID(),
    instance_id: prior?.claims.instance_id ?? randomUUID(), iat: nowSeconds, exp: Math.floor(Date.parse(tokenExpiresAt) / 1000) };
  const claims = family === "worker_model"
    ? { ...baseClaims, worker_model: prior?.claims.worker_model ?? { planId: randomUUID(), workerId: randomUUID(),
      workerAttemptId: randomUUID(), executionManifestId: request.manifestId, expectedPlanVersion: 7 } }
    : { ...baseClaims, conversation_model: prior?.claims.conversation_model ?? { issueId: randomUUID(),
      conversationSessionGeneration: 4, executionManifestId: request.manifestId, executionManifestHash: request.manifestHash } };
  const token = `fixture.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
  request.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN = "https://paperclip.example.test";
  request.env.PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND = "100000";
  request.env.PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS = "1024";
  const credential = { capabilityToken: token, profileId: modelBrokerProfile.id,
    profileHash: createHash("sha256").update(JSON.stringify(canonical(modelBrokerProfile))).digest("hex"), expiresAt,
    inputTokensUpperBound: 100000, maxOutputTokens: 1024 };
  if (phase !== "stop") request.modelBrokerCredential = credential;
  else for (const key of ["PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN", "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND", "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS"])
    delete request.env[key];
  const nativeSessionIdDigest = createHash("sha256").update(`native-session-${prior?.request.runId ?? request.runId}`).digest("hex");
  const sessionFields = { nativeSessionIdDigest, runnerInstanceId: prior?.session.runnerInstanceId ?? randomUUID(),
    leaseId: prior?.session.leaseId ?? randomUUID(), sessionDeadlineAt: ceilingAt };
  const sessionKey = createHash("sha256").update(JSON.stringify(canonical({ companyId: scope.companyId, runId: request.runId,
    attemptId: request.attemptId, attempt: request.attempt,
    nativeSessionIdDigest: sessionFields.nativeSessionIdDigest, runnerInstanceId: sessionFields.runnerInstanceId,
    leaseId: sessionFields.leaseId, bindingId: request.bindingId,
    cellId: scope.cellId, generation: scope.cellGeneration, hostEpoch: request.hostEpoch,
    manifestId: request.manifestId, manifestHash: request.manifestHash, policySnapshotId: request.policySnapshotId,
    policyHash: request.policyHash }))).digest("hex");
  request.modelBrokerSession = { phase, sessionKey, ...sessionFields,
    ...(phase === "start" && startBindingDigest ? { startBindingDigest } : {}),
    ...(phase === "start" ? {} : { expectedCapabilityHash: prior.expectedCapabilityHash }) };
  request.commandDigest = createHash("sha256").update(JSON.stringify(canonical({ argv: request.argv, cwd: request.cwd, env: request.env,
    stdinHash: createHash("sha256").update(Buffer.from(request.stdinBase64, "base64")).digest("hex"), timeoutDeadline: request.deadlineAt,
    brokerCapabilityHash: null, brokerProviderProfile: null,
    modelBrokerCapabilityHash: request.modelBrokerCredential ? createHash("sha256").update(token).digest("hex") : null,
    modelBrokerProviderProfile: request.modelBrokerCredential ? { id: credential.profileId, hash: credential.profileHash } : null,
    modelBrokerSession: request.modelBrokerSession }))).digest("hex");
  return { request, token, claims, session: request.modelBrokerSession, sessionDeadlineAt: ceilingAt,
    expectedCapabilityHash: createHash("sha256").update(token).digest("hex") };
}
test("the force-stop probe uses UUID-bound stop and restart with observed same target", async () =>
  fixture(async ({ engine, calls, sandboxId, root }) => {
    const prepared = await prepareProvisioned(engine, hostProvisioning());
    const saved = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(saved.scopes[scope.bindingId].provisioning.state, "ready", JSON.stringify(saved.scopes[scope.bindingId]));
    assert.equal(saved.scopes[scope.bindingId].sandboxId, prepared.reply.sandboxId);
    assert.equal(saved.scopes[scope.bindingId].provisioning.containerId, prepared.reply.containerId);
    const capabilities = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.deepEqual(
      capabilities.reply?.capabilities?.forceStop,
      true,
      JSON.stringify(capabilities),
    );
    const forcedStopProbe = await engine.execute(randomUUID(), {
      ...input("probe"),
      probe: {
        caseId: "force_stop",
        control: "forceStop",
        expected: "observe",
        contractHash: "a".repeat(64),
      },
    }, deadline());
    assert.equal(forcedStopProbe.reply.verdict, "pass", JSON.stringify({ result: forcedStopProbe, calls: calls.map(call => call.args) }));
    assert.match(forcedStopProbe.reply.observationHash, /^[a-f0-9]{64}$/);
    const transitions = calls.filter(({ args }) => args.includes("sandbox") &&
      (args.includes("stop") || args.includes("start")));
    assert.deepEqual(transitions.map(({ args }) => args[args.indexOf("sandbox") + 1]), ["stop", "start"]);
    assert.ok(transitions.every(({ args }) =>
      args[args.indexOf("--expected-sandbox-id") + 1] === sandboxId()));
  }, { physical: true, running: true }));

test("resource containment requires bounded PID exhaustion and cleanup in the observed cgroup", async () => {
  const report = JSON.stringify({ version: 1, verdict: "pass", limit: 16, baseline: 4,
    attempted: 13, denied_errno: "EAGAIN", reaped: 12, baseline_restored: true });
  await fixture(async ({ engine, calls, sandboxId, root }) => {
    await prepareProvisioned(engine, hostProvisioning("qualification", { document: readOnlyRuntime }));
    const result = await engine.execute(randomUUID(), { ...input("probe"), probe: {
      caseId: "resource_exhaustion_contained", control: "resourceLimits",
      expected: "deny", contractHash: "f".repeat(64),
    } }, deadline());
    assert.equal(result.reply.verdict, "unsupported", JSON.stringify(result));
    assert.match(result.reply.observationHash, /^[a-f0-9]{64}$/);
    const exec = calls.find(({ args }) => args.includes("runtime-pids-probe"));
    assert.ok(exec);
    assert.equal(exec.args[exec.args.indexOf("--expected-sandbox-id") + 1], sandboxId());
    assert.deepEqual(exec.args.slice(-4), ["/.openshell/runtime/openshell-sandbox", "runtime-pids-probe", "--limit", "16"]);
    assert.equal(calls.filter(({ file, args }) => file === "docker" && args[0] === "exec" &&
      args.includes("/sys/fs/cgroup/pids.max")).length, 2);
  }, { physical: true, running: true, effectivePolicy: readOnlyRuntime,
    probeStdout: report, pidsLimit: 16 });

  await fixture(async ({ engine, calls }) => {
    const rejected = await engine.execute(randomUUID(),
      hostProvisioning("qualification", { document: readOnlyRuntime }), deadline());
    assert.equal(rejected.success, false, JSON.stringify(rejected));
    assert.equal(rejected.errorCode, "sandbox_observation_unavailable");
    assert.equal(calls.some(({ args }) => args.includes("runtime-pids-probe")), false,
      "a host-created PIDs limit mismatch is rejected before any containment probe runs");
  }, { physical: true, running: true, effectivePolicy: readOnlyRuntime,
    probeStdout: report, pidsLimit: 16, createPidsOverride: 7 });
});

test("resource control only passes after exact CPU, memory, PID, disk, and cleanup observations", async () => {
  const policy = { ...policyDocument, filesystem_policy: {
    include_workdir: false, read_only: ["/.openshell/runtime"], read_write: ["/workspace/project"],
  } };
  const probeOutputs = {
    "runtime-pids-probe": JSON.stringify({ version: 1, verdict: "pass", limit: 16,
      baseline: 4, attempted: 13, denied_errno: "EAGAIN", reaped: 12, baseline_restored: true }),
    "runtime-cpu-probe": JSON.stringify({ version: 1, verdict: "pass", quota_us: 100000,
      period_us: 100000, workers: 2, duration_ms: 250, throttled_increased: true }),
    "runtime-memory-probe": JSON.stringify({ version: 1, verdict: "pass", limit_bytes: 67108864,
      oom_kill_increased: true, child_reaped: true, oom_group_disabled: true }),
    "runtime-disk-probe": JSON.stringify({ version: 1, verdict: "pass", limit_bytes: 33554432,
      quota_exhaustion_observed: true, temporary_file_removed: true }),
  };
  await fixture(async ({ engine, calls, sandboxId }) => {
    await prepareProvisioned(engine, hostProvisioning("qualification", { document: policy }));
    const result = await engine.execute(randomUUID(), { ...input("probe"), probe: {
      caseId: "resource_exhaustion_contained", control: "resourceLimits",
      expected: "deny", contractHash: "d".repeat(64),
    } }, deadline());
    assert.equal(result.reply.verdict, "pass", JSON.stringify(result));
    assert.match(result.reply.observationHash, /^[a-f0-9]{64}$/);
    for (const helper of Object.keys(probeOutputs)) {
      const command = calls.find(({ args }) => args.includes(helper));
      assert.ok(command, `${helper} executed`);
      if (helper === "runtime-memory-probe") {
        assert.equal(command.file, "docker");
        assert.equal(command.args[1], "--user");
        assert.equal(command.args[2], "1000:1000");
        assert.equal(command.args[3], "--workdir");
        assert.equal(command.args[5], "d".repeat(64));
        assert.equal(command.args[7], helper);
        assert.equal(command.args[9], "67108864");
        assert.equal(calls.some(({ file, args }) => file !== "docker" && args.includes(helper)), false);
      } else {
        assert.equal(command.args[command.args.indexOf("--expected-sandbox-id") + 1], sandboxId());
      }
    }
    assert.ok(calls.some(({ file, args }) => file === "docker" && args.includes("/sys/fs/cgroup/cpu.max")));
    assert.ok(calls.some(({ file, args }) => file === "docker" && args.includes("/sys/fs/cgroup/memory.max")));
    assert.ok(calls.some(({ file, args }) => file === "docker" && args.includes("/sys/fs/cgroup/memory.oom.group")));
    assert.ok(calls.some(({ file, args }) => file === "docker" && args.includes("/usr/bin/test")));
  }, { physical: true, running: true, effectivePolicy: policy, pidsLimit: 16,
    cpuMax: "100000 100000", memoryMax: 67108864,
    probeOutputs, resourceConfig: { NanoCpus: 1000000000, Memory: 67108864,
      MemorySwap: 67108864, PidsLimit: 16, StorageOpt: { size: "33554432B" } } });
});
test("policy-bound process probe executes the pinned OpenShell command and hashes only its assertion", async () =>
  fixture(async ({ engine, calls, sandboxId }) => {
    await prepareProvisioned(engine, hostProvisioning());
    const capabilityReply = await engine.execute(randomUUID(), input("capabilities"), deadline());
    const reply = await engine.execute(randomUUID(), {
      ...input("probe"),
      probe: { caseId: "process_nonprivileged", control: "processPrivilegePolicy", expected: "observe", contractHash: "c".repeat(64) },
    }, deadline());
    assert.equal(reply.reply.verdict, "pass");
    assert.match(reply.reply.observationHash, /^[a-f0-9]{64}$/);
    assert.equal(reply.reply.targetQualificationHash, capabilityReply.reply.capabilities.qualificationHash);
    const execCall = calls.find(({ file, args }) => file !== "docker" && args.includes("exec") && args.includes("/usr/bin/id"));
    assert.ok(execCall);
    assert.ok(execCall.args.includes("--no-login-shell"));
    assert.equal(execCall.args[execCall.args.indexOf("--expected-sandbox-id") + 1], sandboxId());
    assert.ok(execCall.args.includes("--timeout"));
    assert.deepEqual(execCall.args.slice(-3), ["--", "/usr/bin/id", "-u"]);
    assert.equal(JSON.stringify(reply).includes("1000"), false);
  }, { physical: true, running: true, probeStdout: "1000\n" }));
test("privilege-denial probe requires the installed runtime helper and exact root-reacquisition evidence", async () => {
  const report = JSON.stringify({ version: 1, verdict: "pass", uid_nonroot: true,
    effective_capabilities_zero: true, setuid_root: "denied", errno: "EPERM" });
  await fixture(async ({ engine, calls, sandboxId }) => {
    await prepareProvisioned(engine, hostProvisioning("qualification", { document: readOnlyRuntime }));
    const capabilityReply = await engine.execute(randomUUID(), input("capabilities"), deadline());
    const result = await engine.execute(randomUUID(), { ...input("probe"), probe: {
      caseId: "process_privilege_denied", control: "processPrivilegePolicy", expected: "deny", contractHash: "8".repeat(64),
    } }, deadline());
    assert.equal(result.reply.verdict, "pass");
    assert.equal(result.reply.targetQualificationHash, capabilityReply.reply.capabilities.qualificationHash);
    const command = calls.find(({ args }) => args.includes("runtime-privilege-probe"));
    assert.ok(command);
    assert.equal(command.args[command.args.indexOf("--expected-sandbox-id") + 1], sandboxId());
    assert.ok(command.args.includes("/.openshell/runtime/openshell-sandbox"));
  }, { physical: true, running: true, probeStdout: report, effectivePolicy: readOnlyRuntime });
  await fixture(async ({ engine }) => {
    await prepareProvisioned(engine, hostProvisioning("qualification", { document: readOnlyRuntime }));
    const result = await engine.execute(randomUUID(), { ...input("probe"), probe: {
      caseId: "process_privilege_denied", control: "processPrivilegePolicy", expected: "deny", contractHash: "9".repeat(64),
    } }, deadline());
    assert.equal(result.reply.verdict, "fail");
  }, { physical: true, running: true, probeStdout: JSON.stringify({ version: 1, verdict: "fail",
    uid_nonroot: false, effective_capabilities_zero: false }), effectivePolicy: readOnlyRuntime });
});

test("network and L7 probes bind current operator canaries to actual bounded HTTP responses", async () => {
  const marker = "canary-ok";
  const networkFixtures = { network: {
    version: 1,
    allow: { urlTemplate: "https://canary.example.test/allow/{nonce}", method: "GET", marker },
    hostPortDeny: { urlTemplate: "https://canary.example.test:444/port-deny/{nonce}", method: "GET", marker },
    wrongHostDeny: { urlTemplate: "https://wrong-canary.example.test/host-deny/{nonce}", method: "GET", marker },
    redirectDeny: { urlTemplate: "https://canary.example.test/redirect/{nonce}", method: "GET", marker },
    dnsRedirectDeny: { urlTemplate: "https://canary.example.test/dns-redirect/{nonce}", method: "GET",
      resolveIp: "203.0.113.8", marker },
    l7Allow: { urlTemplate: "https://canary.example.test/l7-allow/{nonce}", method: "GET", marker },
    l7Deny: { urlTemplate: "https://canary.example.test/l7-deny/{nonce}", method: "POST", marker },
  } };
  const networkPolicy = { ...policyDocument, network_policies: { canary: {
    name: "aw-v7-qualification-canary", binaries: [{ path: "/usr/bin/curl" }], endpoints: [
      { host: "canary.example.test", port: 443, protocol: "rest", enforcement: "enforce", rules: [
        { allow: { method: "GET", path: "/allow/**" } },
        { allow: { method: "GET", path: "/redirect/**" } },
        { allow: { method: "GET", path: "/dns-redirect/**" } },
        { allow: { method: "GET", path: "/l7-allow/**" } },
      ] },
    ],
  } } };
  const denied = '{"error":"policy_denied"}\n403';
  await fixture(async ({ engine, calls }) => {
    await prepareProvisioned(engine, hostProvisioning("qualification", { document: networkPolicy, qualificationFixtures: networkFixtures }));
    const capability = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(capability.reply.capabilities.networkDestinationPolicy, true);
    assert.equal(capability.reply.capabilities.networkLayer7Policy, true);
    for (const [caseId, control, expected] of [
      ["network_allow", "networkDestinationPolicy", "allow"],
      ["network_host_port_deny", "networkDestinationPolicy", "deny"],
      ["network_dns_redirect_deny", "networkDestinationPolicy", "deny"],
      ["network_l7_allow", "networkLayer7Policy", "allow"],
      ["network_l7_deny", "networkLayer7Policy", "deny"],
    ]) {
      const result = await engine.execute(randomUUID(), { ...input("probe"), probe: {
        caseId, control, expected, contractHash: "b".repeat(64),
      } }, deadline());
      assert.equal(result.reply.verdict, "pass", `${caseId}: ${JSON.stringify(result)}`);
      assert.match(result.reply.observationHash, /^[a-f0-9]{64}$/);
      assert.equal(result.reply.targetQualificationHash, capability.reply.capabilities.qualificationHash);
    }
    const requests = calls.filter(({ file, args }) => file === "docker" && args[0] === "exec" && args[4] === "/usr/bin/curl");
    assert.ok(requests.length >= 7, "each canary response is proven from the same Docker workload first");
    assert.ok(requests.every(({ args }) => args[3] === "d".repeat(64)));
  }, { physical: true, running: true, qualificationFixtures: networkFixtures,
    effectivePolicy: networkPolicy, networkSandboxResponses: {
      "port-deny": denied, "host-deny": denied, redirect: denied, "l7-deny": denied,
    } });

  await fixture(async ({ engine, calls }) => {
    const rejected = await engine.execute(randomUUID(), hostProvisioning(), deadline());
    assert.equal(rejected.success, false, JSON.stringify(rejected));
    assert.equal(rejected.errorCode, "sandbox_scope_changed");
    assert.equal(calls.some(({ args }) => args.includes("runtime-network-probe")), false,
      "qualification fixture drift is rejected before a probe can use missing host metadata");
  }, { physical: true, running: true, omitQualificationFixtures: true });
});

test("filesystem probes use distinct configured rootfs canaries and exact-container DAC observations", async () => {
  const fixtureConfig = { filesystem: { allowedReadPath: "/etc/os-release", allowedReadMarker: "a",
    deniedReadPath: "/opt/aw-denied-canary", deniedReadMarker: "d", escapeViaRoot: "/etc",
    escapeOperand: "/etc/../opt/aw-escape-canary", escapeTargetPath: "/opt/aw-escape-canary", escapeReadMarker: "e" } };
  const cases = [
    { caseId: "filesystem_allow", control: "filesystemPolicy", expected: "allow", operand: "/etc/os-release", exitCode: 0, marker: "a" },
    { caseId: "filesystem_deny", control: "filesystemPolicy", expected: "deny", operand: "/opt/aw-denied-canary", exitCode: 1, marker: "d" },
    { caseId: "filesystem_escape", control: "filesystemPolicy", expected: "deny", operand: "/etc/../opt/aw-escape-canary", exitCode: 1, marker: "e" },
  ];
  for (const item of cases) {
    await fixture(async ({ engine, calls, sandboxId }) => {
      await prepareProvisioned(engine, hostProvisioning());
      const caps = await engine.execute(randomUUID(), input("capabilities"), deadline());
      const result = await engine.execute(randomUUID(), { ...input("probe"), probe: {
        caseId: item.caseId, control: item.control, expected: item.expected, contractHash: "7".repeat(64),
      } }, deadline());
      assert.equal(result.reply.verdict, "pass", JSON.stringify(result));
      assert.equal(result.reply.targetQualificationHash, caps.reply.capabilities.qualificationHash);
      const dockerCheck = calls.find(({ file, args }) => file === "docker" && args[0] === "exec");
      assert.ok(dockerCheck);
      assert.equal(dockerCheck.args[3], "d".repeat(64));
      const sandboxCheck = calls.find(({ file, args }) => file !== "docker" && args.includes("exec") && args.includes(item.operand));
      assert.ok(sandboxCheck);
      assert.equal(sandboxCheck.args[sandboxCheck.args.indexOf("--expected-sandbox-id") + 1], sandboxId());
    }, { physical: true, running: true, qualificationFixtures: fixtureConfig, probeExitCode: item.exitCode,
      probeStdout: item.exitCode === 0 ? item.marker : "", canaryHostMarker: item.marker });
  }
  await fixture(async ({ engine }) => {
    await prepareProvisioned(engine, hostProvisioning());
    const result = await engine.execute(randomUUID(), { ...input("probe"), probe: {
      caseId: "filesystem_deny", control: "filesystemPolicy", expected: "deny", contractHash: "6".repeat(64),
    } }, deadline());
    assert.equal(result.reply.verdict, "unsupported");
  }, { physical: true, running: true, qualificationFixtures: fixtureConfig, canaryReadable: false, probeExitCode: 1 });
  await fixture(async ({ engine }) => {
    await prepareProvisioned(engine, hostProvisioning());
    const result = await engine.execute(randomUUID(), { ...input("probe"), probe: {
      caseId: "filesystem_deny", control: "filesystemPolicy", expected: "deny", contractHash: "5".repeat(64),
    } }, deadline());
    assert.equal(result.reply.verdict, "unsupported");
  }, { physical: true, running: true, qualificationFixtures: fixtureConfig, canaryStat: "regular file:440\n", probeExitCode: 1 });
});

test("a probe cannot attest a same-name replacement after observing the original sandbox UUID", async () => {
  let replaceDuringProbe = () => {};
  const hooks = {
    physical: true,
    running: true,
    probeStdout: "1000\n",
    beforeCommand(_file, args) {
      const command = args.slice(4);
      if (command[0] === "sandbox" && command[1] === "exec") replaceDuringProbe();
    },
  };
  await fixture(async ({ engine, calls, replaceSandbox, sandboxId }) => {
    replaceDuringProbe = replaceSandbox;
    await prepareProvisioned(engine, hostProvisioning());
    const expectedId = sandboxId();
    const reply = await engine.execute(randomUUID(), {
      ...input("probe"),
      probe: { caseId: "process_nonprivileged", control: "processPrivilegePolicy", expected: "observe", contractHash: "d".repeat(64) },
    }, deadline());
    assert.equal(reply.reply.verdict, "unsupported");
    assert.equal(sandboxId() === expectedId, false);
    const execCall = calls.find(({ args }) => args.includes("exec"));
    assert.ok(execCall);
    assert.equal(execCall.args[execCall.args.indexOf("--expected-sandbox-id") + 1], expectedId);
  }, hooks);
});
test("syscall probe parses only the pinned runtime's built-in allow and deny report", async () => {
  const report = JSON.stringify({ version: 1, profile: "openshell-linux-built-in-seccomp-v1",
    getpid: "allowed", memfd_create: "denied", denied_errno: "EPERM" });
  await fixture(async ({ engine, calls, sandboxId }) => {
    await prepareProvisioned(engine, hostProvisioning("qualification", { document: readOnlyRuntime }));
    for (const [caseId, expected] of [
      ["syscall_allow", "allow"],
      ["syscall_deny", "deny"],
    ]) {
      const reply = await engine.execute(randomUUID(), {
        ...input("probe"),
        probe: { caseId, control: "syscallPolicy", expected, contractHash: "e".repeat(64) },
      }, deadline());
      assert.equal(reply.reply.verdict, "pass");
      assert.match(reply.reply.observationHash, /^[a-f0-9]{64}$/);
      const execCall = calls.filter(({ args }) => args.includes("exec")).at(-1);
      assert.ok(execCall);
      assert.equal(execCall.args[execCall.args.indexOf("--expected-sandbox-id") + 1], sandboxId());
      assert.deepEqual(execCall.args.slice(-3), ["--", "/.openshell/runtime/openshell-sandbox", "runtime-seccomp-probe"]);
    }
  }, { physical: true, running: true, probeStdout: report, effectivePolicy: readOnlyRuntime });
  for (const probeStdout of ["not-json", JSON.stringify({ ...JSON.parse(report), denied_errno: "EACCES" })]) {
    await fixture(async ({ engine }) => {
      await prepareProvisioned(engine, hostProvisioning("qualification", { document: readOnlyRuntime }));
      const reply = await engine.execute(randomUUID(), {
        ...input("probe"),
        probe: { caseId: "syscall_deny", control: "syscallPolicy", expected: "deny", contractHash: "f".repeat(64) },
      }, deadline());
      assert.equal(reply.reply.verdict, "fail");
    }, { physical: true, running: true, probeStdout, effectivePolicy: readOnlyRuntime });
  }
  await fixture(async ({ engine, calls }) => {
    const reply = await engine.execute(randomUUID(), {
      ...input("probe"),
      probe: { caseId: "syscall_allow", control: "syscallPolicy", expected: "allow", contractHash: "1".repeat(64) },
    }, deadline());
    assert.equal(reply.reply.verdict, "unsupported");
    assert.equal(calls.some(({ args }) => args.includes("exec")), false);
  }, { physical: true, running: true });
});
test("observed metadata cannot substitute for image or complete control enforcement", async () =>
  fixture(async ({ engine }) => {
    const receipt = await engine.execute(
      randomUUID(),
      input("inspect"),
      deadline(),
    );
    assert.deepEqual(receipt.reply, {
      action: "inspect",
      state: "unknown",
      policyHash: null,
      imageDigest: null,
      generation: "1",
      controlsHealthy: false,
    });
    const preparation = await engine.execute(
      randomUUID(),
      input("prepare"),
      deadline(),
    );
    assert.equal(preparation.success, false);
  }));
test("inspect and capabilities reuse only exact unexpired qualification evidence for a stopped business target", async () => {
  const credentialFixture = qualificationCredentialFixture().metadata;
  const credentialProfile = qualificationCredentialProfile(credentialFixture);
  const runtimeProfiles = installedRuntimeProfiles();
  const runtimeSeccompReport = JSON.stringify({ version: 1, profile: "openshell-linux-built-in-seccomp-v1",
    getpid: "allowed", memfd_create: "denied", denied_errno: "EPERM" });
  await fixture(async ({ engine, calls, setResourceConfig, setProbeOutputs, resourceConfig }) => {
    const qualification = hostProvisioning("qualification", { expiresAt: new Date(Date.now() + 600_000).toISOString(),
      qualificationFixtures: { credential: credentialFixture } });
    await prepareProvisioned(engine, qualification);
    const sampled = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(sampled.success, true, JSON.stringify(sampled));
    assert.ok(sampled.reply.capabilities.qualificationTarget);
    const initial = await engine.execute(randomUUID(), input("inspect"), deadline());
    assert.equal(initial.success, true);
    assert.equal(initial.reply.state, "running");
    assert.equal(initial.reply.controlsHealthy, true);

    await engine.execute(randomUUID(), input("stop"), deadline());
    const stopped = await engine.execute(randomUUID(), input("inspect"), deadline());
    assert.equal(stopped.reply.state, "stopped");
    assert.equal(stopped.reply.controlsHealthy, true, "stopped qualification uses fresh container/config observations without restarting it");

    const admission = hostProvisioning("admission", { expiresAt: new Date(Date.now() + 300_000).toISOString(),
      document: qualification.provisioning.document, resourceLimits: qualification.provisioning.resourceLimits });
    await prepareProvisioned(engine, admission);
    const applied = await engine.execute(randomUUID(), { ...input("apply"), admission: {
      policyHash: admission.provisioning.policyHash, expiresAt: admission.provisioning.expiresAt,
      idempotencyKey: "fixture-health-apply", document: admission.provisioning.document,
      resourceLimits: admission.provisioning.resourceLimits,
    } }, deadline());
    assert.equal(applied.success, true, JSON.stringify(applied));
    await engine.execute(randomUUID(), input("stop"), deadline());
    const callsBeforeStoppedCapabilities = calls.length;
    const stoppedCapabilities = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(stoppedCapabilities.success, true, JSON.stringify(stoppedCapabilities));
    assert.equal(stoppedCapabilities.reply.capabilities.syscallPolicy, true,
      "the exact current stopped creation reuses the original sampled seccomp mechanism instead of executing into a stopped workload");
    assert.equal(stoppedCapabilities.reply.capabilities.resourceLimits, true,
      "fresh current Docker HostConfig plus the exact unexpired sample proves stopped-target resource support");
    assert.equal(stoppedCapabilities.reply.capabilities.expiresAt, admission.provisioning.expiresAt,
      "a shorter signed admission ceiling attenuates the report without rewriting the original sample expiry");
    assert.equal(calls.slice(callsBeforeStoppedCapabilities).some(({ file, args }) =>
      (file === "docker" && args[0] === "exec") || (file !== "docker" && args.includes("exec"))), false,
      "stopped capability refresh performs no in-container exec");
    const afterApply = await engine.execute(randomUUID(), input("inspect"), deadline());
    assert.equal(afterApply.reply.controlsHealthy, true, "apply config_revision changes while exact current policy remains pinned");

    const started = await engine.execute(randomUUID(), { ...input("start"), start: {
      policyHash: admission.provisioning.policyHash, expiresAt: admission.provisioning.expiresAt,
      idempotencyKey: "fixture-stopped-capability-start",
    } }, deadline());
    assert.equal(started.success, true, JSON.stringify(started));
    setProbeOutputs({ "runtime-seccomp-probe": "{}" });
    const failedFreshProbe = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(failedFreshProbe.success, true, JSON.stringify(failedFreshProbe));
    assert.equal(failedFreshProbe.reply.capabilities.syscallPolicy, false,
      "a running target cannot inherit a passing sampled syscall fact when its fresh probe fails");

    const changed = { ...resourceConfig(), Memory: resourceConfig().Memory + 1024 };
    setResourceConfig(changed);
    const driftedCapabilities = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(driftedCapabilities.reply.capabilities.resourceLimits, false,
      "stopped reuse fails closed when the current container resource config drifts from its exact creation");
    const drifted = await engine.execute(randomUUID(), input("inspect"), deadline());
    assert.equal(drifted.reply.controlsHealthy, false, "resource drift fails closed against the original immutable sample");
  }, { physical: true, running: true, denyExecWhenStopped: true, qualificationCredentialProfile: credentialProfile,
    qualificationFixtures: { credential: credentialFixture },
    runtimeBrokerProfiles: runtimeProfiles.selection, installedProfiles: runtimeProfiles.installed,
    resourceConfig: { NanoCpus: 1_000_000_000, Memory: 67108864, MemorySwap: 67108864,
      PidsLimit: 16, StorageOpt: { size: "33554432B" } }, cpuMax: "100000 100000", pidsLimit: 16,
    probeOutputs: { "runtime-seccomp-probe": runtimeSeccompReport } });

  await fixture(async ({ engine, replaceContainerBeforeUpdate }) => {
    const qualification = hostProvisioning("qualification", { qualificationFixtures: { credential: credentialFixture } });
    await prepareProvisioned(engine, qualification);
    await engine.execute(randomUUID(), input("capabilities"), deadline());
    replaceContainerBeforeUpdate();
    const mismatched = await engine.execute(randomUUID(), input("inspect"), deadline());
    assert.equal(mismatched.reply.controlsHealthy, false, "a changed container ID cannot inherit the qualification sample");
  }, { physical: true, running: true, qualificationCredentialProfile: credentialProfile,
    qualificationFixtures: { credential: credentialFixture },
    runtimeBrokerProfiles: runtimeProfiles.selection, installedProfiles: runtimeProfiles.installed,
    resourceConfig: { NanoCpus: 1_000_000_000, Memory: 67108864, MemorySwap: 67108864,
      PidsLimit: 16, StorageOpt: { size: "33554432B" } }, cpuMax: "100000 100000", pidsLimit: 16,
    probeOutputs: { "runtime-seccomp-probe": runtimeSeccompReport } });
});

test("protected capabilities report only freshly inspected installed App and model profiles and preserve the original qualification expiry", async () => {
  const qualification = qualificationCredentialFixture();
  const runtimeProfiles = installedRuntimeProfiles();
  const { app: appProfile, model: modelProfile, selection: runtimeBrokerProfiles } = runtimeProfiles;
  const origin = runtimeBrokerProfiles.app.origin;
  await fixture(async ({ engine }) => {
    const expiry = new Date(Date.now() + 600_000).toISOString();
    const request = hostProvisioning("qualification", { expiresAt: expiry,
      qualificationFixtures: { credential: qualification.metadata } });
    await prepareProvisioned(engine, request);
    const sampled = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(sampled.success, true, JSON.stringify(sampled));
    const capabilities = sampled.reply.capabilities;
    assert.equal(capabilities.expiresAt, request.provisioning.expiresAt,
      "a verified sample keeps the already-authorized immutable provisioning deadline, without a new 120-second cap");
    assert.deepEqual(capabilities.credentialBrokerProviderProfile,
      { id: appProfile.id, hash: runtimeBrokerProfiles.app.hash, origin, binaries: ["/usr/bin/curl"] });
    assert.deepEqual(capabilities.modelBrokerProviderProfile,
      { id: modelProfile.id, hash: runtimeBrokerProfiles.model.hash, origin, binaries: ["/usr/bin/node"] });
    assert.deepEqual(capabilities.credentialBindingDimensions, ["host", "port", "method", "path", "binary"]);
    for (const unsupported of ["company", "presence", "expiry", "revocation"])
      assert.equal(capabilities.credentialBindingDimensions.includes(unsupported), false,
        `${unsupported} remains owned by the qualified server protocol, not profile metadata`);
  }, { physical: true, running: true, qualificationCredentialProfile: qualification.profile,
    qualificationFixtures: { credential: qualification.metadata },
    runtimeBrokerProfiles, installedProfiles: runtimeProfiles.installed,
    resourceConfig: { NanoCpus: 1_000_000_000, Memory: 67108864, MemorySwap: 67108864,
      PidsLimit: 16, StorageOpt: { size: "33554432B" } }, cpuMax: "100000 100000", pidsLimit: 16,
    probeOutputs: { "runtime-seccomp-probe": JSON.stringify({ version: 1, profile: "openshell-linux-built-in-seccomp-v1",
      getpid: "allowed", memfd_create: "denied", denied_errno: "EPERM" }) } });
});

test("stopped capability reuse fails closed when the current policy makes the sampled runtime helper writable", async () => {
  const credentialFixture = qualificationCredentialFixture().metadata;
  const credentialProfile = qualificationCredentialProfile(credentialFixture);
  const runtimeSeccompReport = JSON.stringify({ version: 1, profile: "openshell-linux-built-in-seccomp-v1",
    getpid: "allowed", memfd_create: "denied", denied_errno: "EPERM" });
  await fixture(async ({ engine, setEffectivePolicy }) => {
    const qualification = hostProvisioning("qualification", { qualificationFixtures: { credential: credentialFixture } });
    await prepareProvisioned(engine, qualification);
    const sampled = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(sampled.reply.capabilities.syscallPolicy, true);
    await engine.execute(randomUUID(), input("stop"), deadline());
    setEffectivePolicy({ ...policyDocument, filesystem_policy: {
      ...policyDocument.filesystem_policy,
      read_write: [...policyDocument.filesystem_policy.read_write, "/.openshell/runtime/openshell-sandbox"],
    } });
    const drifted = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.ok(drifted.reply.capabilities === null || drifted.reply.capabilities.syscallPolicy === false,
      "the stopped sample cannot mask a current policy that makes its runtime helper writable");
  }, { physical: true, running: true, qualificationCredentialProfile: credentialProfile,
    qualificationFixtures: { credential: credentialFixture },
    resourceConfig: { NanoCpus: 1_000_000_000, Memory: 67108864, MemorySwap: 67108864,
      PidsLimit: 16, StorageOpt: { size: "33554432B" } }, cpuMax: "100000 100000", pidsLimit: 16,
    probeOutputs: { "runtime-seccomp-probe": runtimeSeccompReport } });
});

test("inspect fails closed when a freshly inspected installed App or model profile drifts from qualification", async () => {
  const qualification = qualificationCredentialFixture();
  const selected = installedRuntimeProfiles();
  const alternate = installedRuntimeProfiles("https://alternate-gateway.example.test");
  alternate.app.id = "paperclip-runtime-app-alternate";
  alternate.model.id = "paperclip-runtime-model-alternate";
  alternate.selection = { app: runtimeProfileSelection(alternate.app), model: runtimeProfileSelection(alternate.model, true) };
  alternate.installed = { [alternate.app.id]: alternate.app, [alternate.model.id]: alternate.model };
  const binaryDriftApp = structuredClone(selected.app);
  binaryDriftApp.id = "paperclip-runtime-app-binary-drift";
  binaryDriftApp.binaries = [{ path: "/usr/bin/base64" }];
  const binaryDriftModel = structuredClone(selected.model);
  binaryDriftModel.id = "paperclip-runtime-model-binary-drift";
  binaryDriftModel.binaries = [{ path: "/usr/bin/base64" }];
  await fixture(async ({ engine, config }) => {
    const request = hostProvisioning("qualification", { qualificationFixtures: { credential: qualification.metadata } });
    await prepareProvisioned(engine, request);
    const sampled = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(sampled.success, true, JSON.stringify(sampled));
    const healthy = await engine.execute(randomUUID(), input("inspect"), deadline());
    assert.equal(healthy.reply.controlsHealthy, true);

    config.runtimeBrokerProfiles.app = alternate.selection.app;
    const changedApp = await engine.execute(randomUUID(), input("inspect"), deadline());
    assert.equal(changedApp.reply.controlsHealthy, false, "an installed App profile with another identity or origin cannot inherit the sample");

    config.runtimeBrokerProfiles.app = selected.selection.app;
    config.runtimeBrokerProfiles.model = alternate.selection.model;
    const changedModel = await engine.execute(randomUUID(), input("inspect"), deadline());
    assert.equal(changedModel.reply.controlsHealthy, false, "an installed model profile with another identity or origin cannot inherit the sample");

    config.runtimeBrokerProfiles.app = runtimeProfileSelection(binaryDriftApp);
    const changedAppBinary = await engine.execute(randomUUID(), input("inspect"), deadline());
    assert.equal(changedAppBinary.reply.controlsHealthy, false, "a newly valid App profile with another network caller cannot inherit the sample");

    config.runtimeBrokerProfiles.app = selected.selection.app;
    config.runtimeBrokerProfiles.model = runtimeProfileSelection(binaryDriftModel, true);
    const changedModelBinary = await engine.execute(randomUUID(), input("inspect"), deadline());
    assert.equal(changedModelBinary.reply.controlsHealthy, false, "a newly valid model profile with another network caller cannot inherit the sample");

    config.runtimeBrokerProfiles.model = selected.selection.model;
    delete config.runtimeBrokerProfiles.model;
    const missingModel = await engine.execute(randomUUID(), input("inspect"), deadline());
    assert.equal(missingModel.reply.controlsHealthy, false, "removing a sampled model profile invalidates current mechanism health");
  }, { physical: true, running: true, qualificationCredentialProfile: qualification.profile,
    qualificationFixtures: { credential: qualification.metadata }, runtimeBrokerProfiles: structuredClone(selected.selection),
    installedProfiles: { ...selected.installed, ...alternate.installed,
      [binaryDriftApp.id]: binaryDriftApp, [binaryDriftModel.id]: binaryDriftModel },
    resourceConfig: { NanoCpus: 1_000_000_000, Memory: 67108864, MemorySwap: 67108864,
      PidsLimit: 16, StorageOpt: { size: "33554432B" } }, cpuMax: "100000 100000", pidsLimit: 16,
    probeOutputs: { "runtime-seccomp-probe": JSON.stringify({ version: 1, profile: "openshell-linux-built-in-seccomp-v1",
      getpid: "allowed", memfd_create: "denied", denied_errno: "EPERM" }) } });
});

test("prepare returns only an observed exact stopped sandbox image and rejects drift", async () => {
  await fixture(async ({ engine, calls }) => {
    const receipt = await engine.execute(randomUUID(), input("prepare"), deadline());
    assert.equal(receipt.success, true);
    assert.deepEqual(receipt.reply, {
      action: "prepare",
      backendVersion: "0.1.2",
      imageDigest: input("prepare").imageDigest,
    });
    assert.ok(calls.some(call => call.args[0] === "info"));
    assert.ok(calls.some(call => call.args[0] === "ps"));
    assert.ok(calls.some(call => call.args[0] === "inspect"));
    assert.ok(calls.some(call => call.args[4] === "sandbox" && call.args[5] === "get"));
    assert.ok(!calls.some(call => call.args[4] === "sandbox" && ["create", "start", "stop"].includes(call.args[5])));
  }, { phase: "Stopped", physical: true });

  await fixture(async ({ engine }) => {
    const receipt = await engine.execute(randomUUID(), input("prepare"), deadline());
    assert.equal(receipt.success, true, "Docker may report the immutable image ID as Config.Image");
  }, { phase: "Stopped", physical: true, containerConfigImage: "sha256:" + "e".repeat(64) });

  for (const hooks of [
    { phase: "Stopped", physical: true, containerImageDigest: "fixture.invalid/other@sha256:" + "c".repeat(64) },
    { phase: "Stopped", physical: true, containerConfigImage: "fixture.invalid/image:mutable" },
    { phase: "Stopped", physical: true, imageRepoDigests: [] },
    { phase: "Stopped", physical: true, wrongContainerLabels: true },
    { phase: "Ready", physical: true },
    { phase: "Stopped", physical: true, running: true },
  ]) {
    await fixture(async ({ engine }) => {
      const receipt = await engine.execute(randomUUID(), input("prepare"), deadline());
      assert.equal(receipt.success, false);
      assert.equal(receipt.reply, null);
    }, hooks);
  }
});

test("provisioning requires the exact deterministic requestId from the signed shared wire", async () => {
  for (const mutate of [
    value => { delete value.requestId; },
    value => { value.requestId = randomUUID(); },
  ]) {
    await fixture(async ({ engine, calls }) => {
      const request = hostProvisioning("qualification");
      mutate(request.provisioning);
      const result = await engine.execute(randomUUID(), request, deadline());
      assert.equal(result.success, false);
      assert.equal(result.reply, null);
      assert.equal(result.errorCode, "sandbox_scope_changed");
      assert.equal(calls.some(({ args }) => args.includes("sandbox") && args.includes("create")), false);
    }, { physical: true });
  }
});

test("provisioning journals the full deterministic envelope, creates exact idle targets, and pins IDs", async () => {
  await fixture(async ({ engine, calls, root, sandboxId }) => {
    const request = hostProvisioning("qualification");
    const result = await prepareProvisioned(engine, request);
    assert.deepEqual(Object.keys(result.reply).sort(),
      ["action", "backendVersion", "bindingVersion", "containerId", "hostEpoch", "imageDigest",
        "policyHash", "probePolicyHash", "provisioningHash", "resourceLimits", "sandboxId"].sort());
    const target = sandboxId();
    assert.equal(result.reply.sandboxId, target);
    assert.equal(result.reply.hostEpoch, 1);
    assert.equal(result.reply.provisioningHash, request.provisioning.provisioningHash);
    assert.equal(result.reply.bindingVersion, request.provisioning.bindingVersion);
    assert.equal(result.reply.policyHash, request.provisioning.policyHash);
    assert.deepEqual(result.reply.resourceLimits, request.provisioning.resourceLimits);
    const create = calls.find(({ args }) => args.includes("create"));
    assert.ok(create);
    assert.ok(create.args.includes("--no-auto-providers"));
    const bytes = Buffer.from(request.provisioning.provisioningHash.slice(0, 32), "hex");
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    const expectedRequestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    assert.equal(create.args[create.args.indexOf("--request-id") + 1], expectedRequestId);
    assert.ok(create.args.includes("1000m"));
    assert.ok(create.args.includes(String(request.provisioning.resourceLimits.memoryBytes)));
    assert.equal(JSON.parse(create.args[create.args.indexOf("--driver-config-json") + 1]).docker.pids_limit,
      String(request.provisioning.resourceLimits.pidsLimit));
    assert.ok(create.args.includes("runtime-idle-until"));
    assert.ok(!calls.some(({ args }) => args.includes("sandbox") && args.includes("stop")));
    const saved = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(saved.scopes[scope.bindingId].sandboxId, target);
    assert.equal(saved.scopes[scope.bindingId].provisioning.containerId, result.reply.containerId);
    assert.equal(saved.scopes[scope.bindingId].provisioning.provisioningHash, request.provisioning.provisioningHash);
    const replay = await engine.execute(randomUUID(), request, deadline());
    assert.equal(replay.reply.sandboxId, target);
    assert.equal(calls.filter(({ args }) => args.includes("create")).length, 1);
  }, { physical: true, createResponseLost: true });

  await fixture(async ({ engine, calls, sandboxId }) => {
    const qualification = hostProvisioning("qualification");
    await prepareProvisioned(engine, qualification);
    const sampled = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.ok(sampled.reply.capabilities.qualificationTarget);
    const qualificationId = sandboxId();
    await engine.execute(randomUUID(), input("stop"), deadline());
    await prepareProvisioned(engine, hostProvisioning("admission", {
      expiresAt: qualification.provisioning.expiresAt,
    }));
    const businessId = sandboxId();
    assert.notEqual(businessId, qualificationId, "admission creates a fresh business UUID");
    const stops = calls.filter(({ args }) => args.includes("sandbox") && args.includes("stop"));
    assert.equal(stops.length, 2, "qualification sample and new business target are each observed stopped");
    assert.deepEqual(stops.map(({ args }) => args[args.indexOf("--expected-sandbox-id") + 1]),
      [qualificationId, businessId], "every stop is pinned to its exact lifecycle UUID");
  }, { physical: true });
});

test("qualification promotion retires only its inert UUID and later admission reuses exact stopped business data", async () => {
  await fixture(async ({ engine, config, calls, root, run, sandboxId, containerId }) => {
    const qualification = hostProvisioning("qualification");
    const qualified = await prepareProvisioned(engine, qualification);
    const qualificationId = sandboxId();
    const sampleCaps = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(sampleCaps.success, true, JSON.stringify(sampleCaps));
    const sampleTarget = sampleCaps.reply.capabilities.qualificationTarget;
    assert.equal(sampleTarget.sandboxId, qualificationId);
    assert.equal(sampleTarget.containerId, containerId());
    await engine.execute(randomUUID(), input("stop"), deadline());

    const overDeadline = hostProvisioning("admission", { expiresAt: new Date(
      Date.parse(qualification.provisioning.expiresAt) + 30_000).toISOString() });
    const rejectedExtension = await engine.execute(randomUUID(), overDeadline, deadline());
    assert.equal(rejectedExtension.success, false, "admission cannot renew the original qualification deadline");
    assert.equal(sandboxId(), qualificationId);
    assert.equal(calls.filter(({ args }) => args.includes("sandbox") && args.includes("delete")).length, 0);

    const admission = hostProvisioning("admission", { expiresAt: qualification.provisioning.expiresAt });
    const promoted = await prepareProvisioned(engine, admission);
    const businessId = sandboxId();
    assert.notEqual(businessId, qualificationId);
    const deletes = calls.filter(({ args }) => args.includes("sandbox") && args.includes("delete"));
    assert.equal(deletes.length, 1);
    assert.equal(deletes[0].args[deletes[0].args.indexOf("--expected-sandbox-id") + 1], qualificationId);
    assert.equal((await engine.execute(randomUUID(), input("capabilities"), deadline())).reply.capabilities.qualificationTarget.sandboxId,
      businessId, "the capability response describes the active target, not the retired qualification UUID");

    const saved = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    const creation = saved.scopes[scope.bindingId].creation;
    assert.equal(creation.sandboxId, businessId);
    assert.equal(creation.provisioningHash, admission.provisioning.provisioningHash);
    const createCount = calls.filter(({ args }) => args.includes("sandbox") && args.includes("create")).length;
    const second = hostProvisioning("admission", {
      bindingVersion: 2, operationKey: "fixture-admission-recovery",
      expiresAt: creation.expiresAt,
    });
    const reauthorized = await prepareProvisioned(engine, second);
    assert.equal(reauthorized.reply.sandboxId, businessId);
    assert.equal(reauthorized.reply.bindingVersion, 2);
    assert.equal(reauthorized.reply.provisioningHash, second.provisioning.provisioningHash);
    assert.equal(calls.filter(({ args }) => args.includes("sandbox") && args.includes("create")).length, createCount);
    assert.equal(calls.filter(({ args }) => args.includes("sandbox") && args.includes("delete")).length, 1);

    const incompatible = hostProvisioning("admission", {
      bindingVersion: 3, operationKey: "fixture-incompatible-policy",
      expiresAt: creation.expiresAt,
      document: { ...policyDocument, process: { run_as_user: "1001", run_as_group: "1001" } },
    });
    const mismatch = await engine.execute(randomUUID(), incompatible, deadline());
    assert.equal(mismatch.success, true, JSON.stringify(mismatch));
    assert.equal(mismatch.reply.requiresRecreate, true);
    assert.equal(sandboxId(), businessId);
    assert.equal(calls.filter(({ args }) => args.includes("sandbox") && args.includes("create")).length, createCount);
    assert.equal(calls.filter(({ args }) => args.includes("sandbox") && args.includes("delete")).length, 1,
      "incompatible policy is reported without deleting customer workspace data");
  }, { physical: true });
});

test("qualification-to-admission promotion resumes from its persisted exact-UUID transition after delete uncertainty", async () => {
  await fixture(async ({ engine, config, root, run, failDeleteAfterEffect }) => {
    const qualification = hostProvisioning("qualification");
    await prepareProvisioned(engine, qualification);
    await engine.execute(randomUUID(), input("capabilities"), deadline());
    await engine.execute(randomUUID(), input("stop"), deadline());
    const admission = hostProvisioning("admission", { expiresAt: qualification.provisioning.expiresAt });
    failDeleteAfterEffect();
    const interrupted = await engine.execute(randomUUID(), admission, deadline());
    assert.equal(interrupted.success, false);
    const during = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(during.scopes[scope.bindingId].transition.phase, "retire-qualification");
    assert.equal(during.scopes[scope.bindingId].transition.currentIntent.provisioningHash,
      admission.provisioning.provisioningHash);
    assert.equal(during.scopes[scope.bindingId].transition.currentIntent.envelope.purpose, "admission");
    const wrongRetry = hostProvisioning("admission", { operationKey: "different-authorized-intent" });
    assert.equal((await engine.execute(randomUUID(), wrongRetry, deadline())).success, false,
      "a different intent cannot take over the persisted transition");
    const restarted = openShellHostEngine({ config, epoch: 1, root, run });
    await restarted.initialize();
    const resumed = await prepareProvisioned(restarted, admission);
    const after = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(after.scopes[scope.bindingId].qualification.sampleTarget.sandboxId,
      during.scopes[scope.bindingId].qualification.sampleTarget.sandboxId);
    assert.equal(after.scopes[scope.bindingId].creation.purpose, "admission");
    assert.equal(after.scopes[scope.bindingId].transition, null);
    assert.equal((await restarted.execute(randomUUID(), admission, deadline())).reply.sandboxId,
      resumed.reply.sandboxId, "request replay observes the same immutable created UUID");
  }, { physical: true });
});

test("admission prepare retries an exact business UUID after stop effect with lost reply", async () => {
  await fixture(async ({ engine, config, root, run, failStopAfterEffect, calls, containerId }) => {
    const qualification = hostProvisioning("qualification");
    await prepareProvisioned(engine, qualification);
    await engine.execute(randomUUID(), input("capabilities"), deadline());
    await engine.execute(randomUUID(), input("stop"), deadline());
    const admission = hostProvisioning("admission", { expiresAt: qualification.provisioning.expiresAt });
    failStopAfterEffect();
    const interrupted = await engine.execute(randomUUID(), admission, deadline());
    assert.equal(interrupted.success, false);
    const journal = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    const createdId = journal.scopes[scope.bindingId].sandboxId;
    const createdContainerId = containerId();
    assert.equal(journal.scopes[scope.bindingId].creation, null,
      "the active immutable creation receipt is written only after stopped state is observed");
    const restarted = openShellHostEngine({ config, epoch: 1, root, run });
    await restarted.initialize();
    const resumed = await prepareProvisioned(restarted, admission);
    assert.equal(resumed.reply.sandboxId, createdId);
    assert.equal(resumed.reply.containerId, createdContainerId);
    assert.equal(calls.filter(({ args }) => args.includes("sandbox") && args.includes("create")).length, 2,
      "retry finalizes the existing exact container instead of creating another workspace");
    const after = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(after.scopes[scope.bindingId].creation.sandboxId, createdId);
    assert.equal(after.scopes[scope.bindingId].creation.purpose, "admission");
  }, { physical: true });
});

test("a changed runtime binary invalidates the retained qualification sample without renewing its expiry", async () => {
  await fixture(async ({ engine, setRuntimeBinaryBytes }) => {
    const qualification = hostProvisioning("qualification");
    const prepared = await prepareProvisioned(engine, qualification);
    const qualified = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(qualified.success, true, JSON.stringify(qualified));
    const originalExpiry = qualified.reply.capabilities.expiresAt;
    assert.ok(qualified.reply.capabilities.qualificationTarget);
    await engine.execute(randomUUID(), input("stop"), deadline());
    const promoted = await prepareProvisioned(engine, hostProvisioning("admission", {
      expiresAt: qualification.provisioning.expiresAt,
    }));
    const activeCaps = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(activeCaps.reply.capabilities.qualificationTarget.sandboxId, promoted.reply.sandboxId);
    assert.equal(activeCaps.reply.capabilities.expiresAt, originalExpiry);
    setRuntimeBinaryBytes("changed runtime binary");
    const drifted = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(drifted.success, true, JSON.stringify(drifted));
    for (const control of ["filesystemPolicy", "processPrivilegePolicy", "syscallPolicy",
      "networkDestinationPolicy", "networkLayer7Policy", "credentialBrokering", "resourceLimits", "forceStop"])
      assert.equal(drifted.reply.capabilities[control], false, `${control} closes on host mechanism drift`);
    assert.equal(drifted.reply.capabilities.qualificationTarget, undefined);
    assert.equal(drifted.reply.capabilities.qualificationTarget, undefined);
    assert.equal(drifted.reply.capabilities.expiresAt, originalExpiry,
      "a fresh observation cannot renew the original qualification deadline");
  }, { physical: true });
});

test("host-created qualification policy matches the shared server golden vector", async () => {
  const golden = JSON.parse(await readFile(new URL(
    "../../../server/src/__tests__/fixtures/openshell-qualification-policy-golden.json", import.meta.url), "utf8"));
  await fixture(async ({ engine, effectivePolicy }) => {
    const result = await prepareProvisioned(engine, hostProvisioning("qualification", {
      qualificationFixtures: golden.fixture,
    }));
    assert.deepEqual(effectivePolicy(), golden.document);
    assert.equal(createHash("sha256").update(JSON.stringify(canonical(golden.document))).digest("hex"),
      "502ff3c7a9d182bb9a9806d2fa0a11fe902472aae32877169ffbdeea51023788");
  }, { physical: true, qualificationFixtures: golden.fixture });
});

test("provisioning rejects envelope tampering before any create effect", async () =>
  fixture(async ({ engine, calls }) => {
    const request = hostProvisioning();
    request.provisioning.resourceLimits.memoryBytes += 1;
    const result = await engine.execute(randomUUID(), request, deadline());
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
    assert.equal(calls.some(({ args }) => args.includes("create")), false);
  }));

test("protected preflight reports the observed engine kernel and exact credential fixture without earning controls", async () => {
  const credentialFixture = qualificationCredentialFixture().metadata;
  await fixture(async ({ engine }) => {
    const result = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(result.success, true, JSON.stringify(result));
    const capabilities = result.reply.capabilities;
    const fixture = capabilities.qualificationProbeFixture;
    assert.equal(fixture.fixtureHash, capabilities.qualificationHash);
    assert.equal(capabilities.hostKernelVersion, "openshell-docker-engine-1");
    assert.deepEqual(capabilities.qualificationCredentialFixture, fixture.credential);
    assert.equal(capabilities.qualificationTarget, undefined);
    assert.deepEqual(sandboxCapabilitySnapshotSchema.parse(capabilities), capabilities,
      "the actual shared server contract accepts the Host-owned targetless preflight report");
    for (const key of ["filesystemPolicy", "processPrivilegePolicy", "syscallPolicy", "networkDestinationPolicy",
      "networkLayer7Policy", "credentialBrokering", "resourceLimits", "forceStop"])
      assert.equal(capabilities[key], false, `${key} is not earned by preflight`);
  }, { qualificationFixtures: { credential: credentialFixture } });
});

test("qualification create rejects a substituted fixture even when its envelope hash is recomputed", async () =>
  fixture(async ({ engine, calls }) => {
    const request = hostProvisioning();
    request.provisioning.qualificationProbeFixture.filesystem.workdirPath = "/workspace/replacement";
    request.provisioning.qualificationProbeFixture.fixtureHash = createHash("sha256")
      .update(JSON.stringify(canonical(Object.fromEntries(Object.entries(request.provisioning.qualificationProbeFixture)
        .filter(([key]) => key !== "fixtureHash"))))).digest("hex");
    request.provisioning.probeFixtureHash = request.provisioning.qualificationProbeFixture.fixtureHash;
    resealProvisioning(request);
    const result = await engine.execute(randomUUID(), request, deadline());
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
    assert.equal(calls.some(({ args }) => args.includes("create")), false);
  }));

test("qualification fixture rejects a nonce placeholder embedded inside a path segment", async () => {
  const fixtures = structuredClone(defaultQualificationFixtures);
  fixtures.network.allow.urlTemplate = "https://canary.example.test/prefix-{nonce}";
  await fixture(async ({ engine, calls }) => {
    const result = await engine.execute(randomUUID(), hostProvisioning("qualification", {
      qualificationFixtures: fixtures,
    }), deadline());
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
    assert.equal(calls.some(({ args }) => args.includes("create")), false);
  }, { qualificationFixtures: fixtures });
});

test("protected host target hashes the complete validated synthetic credential fixture metadata", async () => {
  const metadata = { version: 1, fixtureId: "fixture-credential-v1", profileId: "aw-v7-canary",
    profileHash: "a".repeat(64), binaries: ["/usr/bin/curl"], wrongBinaryPath: "/usr/bin/wget",
    origin: "https://canary.example.test", port: 443, method: "POST", gatewayPublicId: "gateway-fixture-1",
    toolName: "mcp.qualification-canary-1234abcd:read-canary", wrongToolName: "aw_wrong_destination_canary",
    marker: "credential-canary-marker" };
  metadata.argumentTemplateHash = createHash("sha256").update(JSON.stringify(canonical({
    caseId: "<caseId>", fixtureId: "<fixtureId>", nonce: "<nonce>",
  }))).digest("hex");
  metadata.fixtureHash = createHash("sha256").update(JSON.stringify(canonical(metadata))).digest("hex");
  await fixture(async ({ engine, calls }) => {
    const prepared = await prepareProvisioned(engine, hostProvisioning("qualification", {
      qualificationFixtures: { ...defaultQualificationFixtures, credential: metadata },
    }));
    const result = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.deepEqual(result.reply.capabilities.qualificationCredentialFixture, metadata);
    const target = { ...result.reply.capabilities.qualificationTarget };
    const targetHash = target.targetHash;
    delete target.targetHash;
    assert.equal(createHash("sha256").update(JSON.stringify(canonical(target))).digest("hex"), targetHash);
    assert.equal(result.reply.capabilities.qualificationHash, targetHash);
    assert.equal(target.runtimeBinarySha256,
      createHash("sha256").update("fixture openshell sandbox runtime binary").digest("hex"));
    assert.equal(target.openshellCliSha256,
      createHash("sha256").update("fixture-only-cli").digest("hex"));
    assert.equal(target.dockerEngineIdHash,
      createHash("sha256").update("openshell-docker-engine-1").digest("hex"));
    assert.equal(result.reply.capabilities.credentialBrokering, false,
      "a valid fixture description alone is not evidence that a broker secret was issued or used");
  }, { physical: true, running: true, qualificationFixtures: { credential: metadata } });
});

test("qualification credentials stay in the expected-ID provider proxy and exact ToolGateway probe", async () => {
  const { metadata, profile } = qualificationCredentialFixture();
  const document = qualificationCredentialPolicy(metadata);
  const markerBody = JSON.stringify({ result: { structuredContent: { marker: metadata.marker } } });
  const runtimeProfiles = installedRuntimeProfiles();
  const hooks = { physical: true, running: true, qualificationFixtures: { credential: metadata },
    qualificationCredentialProfile: profile, runtimeBrokerProfiles: runtimeProfiles.selection,
    installedProfiles: runtimeProfiles.installed, effectivePolicy: document,
    qualificationMcpOutput: `${markerBody}\n200` };
  await fixture(async ({ engine, calls, sandboxId, root }) => {
    const provision = hostProvisioning("qualification", { document,
      qualificationFixtures: { ...defaultQualificationFixtures, credential: metadata } });
    const prepared = await engine.execute(randomUUID(), provision, deadline());
    assert.equal(prepared.success, true, JSON.stringify(prepared));
    const capabilities = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(capabilities.reply.capabilities.credentialBrokering, true, JSON.stringify(capabilities));
    const targetQualificationHash = capabilities.reply.capabilities.qualificationTarget.targetHash;
    const commandId = randomUUID();
    const { token, nonce } = qualificationCredentialToken({ commandId, request: input("probe"),
      fixture: metadata, provisioning: provision.provisioning, sandboxId: sandboxId(),
      containerId: "d".repeat(64), tokenCase: "credential_allow", targetQualificationHash });
    hooks.qualificationCapabilityToken = token;
    const result = await engine.execute(commandId, { ...input("probe"), probe: {
      caseId: "credential_allow", control: "credentialBrokering", expected: "allow",
      contractHash: "2".repeat(64), qualificationCredentialCapability: token,
      qualificationCredentialNonce: nonce,
    } }, deadline());
    assert.equal(result.reply.verdict, "pass", JSON.stringify(result));
    assert.match(result.reply.observationHash, /^[a-f0-9]{64}$/);
    const create = calls.find(call => call.args.slice(4).includes("provider") && call.args.slice(4).includes("create"));
    assert.ok(create);
    assert.equal(create.options.env.PAPERCLIP_SANDBOX_QUALIFICATION_TOKEN, token);
    assert.ok(!create.args.some(value => String(value).includes(token)));
    const cliExec = calls.find(call => call.args.slice(4).includes("sandbox") &&
      call.args.slice(4).includes("exec") && call.args.at(-1) === "https://gateway.example.test/mcp/gateways/gateway-fixture-1");
    assert.ok(cliExec);
    assert.ok(!cliExec.args.some(value => String(value).includes(token)));
    assert.ok(calls.some(call => call.args.slice(4).includes("provider") && call.args.slice(4).includes("detach") &&
      call.args[call.args.indexOf("--expected-sandbox-id") + 1] === sandboxId()));
    assert.ok(calls.some(call => call.args.slice(4).includes("provider") && call.args.slice(4).includes("delete")));
    const journal = await readFile(path.join(root, "openshell-journal.json"), "utf8");
    assert.ok(!journal.includes(token), "one-use credential material must not persist in the host journal");
  }, hooks);
});

test("credential raw-read and wrong-destination probes require exact bounded denials", async () => {
  const { metadata, profile } = qualificationCredentialFixture();
  const document = qualificationCredentialPolicy(metadata);
  const response = reasonCode => `${JSON.stringify({ error: { data: { reasonCode } } })}\n403`;
  const hooks = { physical: true, running: true, qualificationFixtures: { credential: metadata },
    qualificationCredentialProfile: profile, effectivePolicy: document };
  await fixture(async ({ engine, sandboxId, calls }) => {
    const provision = hostProvisioning("qualification", { document,
      qualificationFixtures: { ...defaultQualificationFixtures, credential: metadata } });
    await prepareProvisioned(engine, provision);
    const capabilities = await engine.execute(randomUUID(), input("capabilities"), deadline());
    const targetQualificationHash = capabilities.reply.capabilities.qualificationTarget.targetHash;
    for (const [caseId, reasonCode] of [["credential_raw_read_deny", null],
      ["credential_wrong_destination_deny", "sandbox_qualification_tool_mismatch"]]) {
      const commandId = randomUUID();
      const { token, nonce } = qualificationCredentialToken({ commandId, request: input("probe"), fixture: metadata,
        provisioning: provision.provisioning, sandboxId: sandboxId(), containerId: "d".repeat(64), tokenCase: caseId,
        targetQualificationHash });
      hooks.qualificationCapabilityToken = token;
      hooks.qualificationMcpOutput = caseId === "credential_raw_read_deny"
        ? `${JSON.stringify({ result: { structuredContent: { marker: metadata.marker } } })}\n200`
        : response(reasonCode);
      const result = await engine.execute(commandId, { ...input("probe"), probe: {
        caseId, control: "credentialBrokering", expected: "deny", contractHash: "3".repeat(64),
        qualificationCredentialCapability: token, qualificationCredentialNonce: nonce,
      } }, deadline());
      assert.equal(result.reply.verdict, "pass", JSON.stringify(result));
      assert.match(result.reply.observationHash, /^[a-f0-9]{64}$/);
      if (caseId === "credential_raw_read_deny") {
        const execCalls = calls.filter(call => call.args.slice(4).includes("sandbox") &&
          call.args.slice(4).includes("exec"));
        assert.ok(execCalls.length >= 2);
        assert.ok(execCalls.every(call => !call.args.some(value => String(value).includes(token))),
          "the capability must not appear in any workload argv");
      }
    }
  }, hooks);
});

test("wrong-binary credential denial requires a prior live positive call and exact 401 reason", async () => {
  const { metadata, profile } = qualificationCredentialFixture();
  const document = qualificationCredentialPolicy(metadata);
  const hooks = { physical: true, running: true, qualificationFixtures: { credential: metadata },
    qualificationCredentialProfile: profile, effectivePolicy: document,
    qualificationMcpOutput: `${JSON.stringify({ result: { structuredContent: { marker: metadata.marker } } })}\n200` };
  await fixture(async ({ engine, sandboxId }) => {
    const provision = hostProvisioning("qualification", { document,
      qualificationFixtures: { ...defaultQualificationFixtures, credential: metadata } });
    await prepareProvisioned(engine, provision);
    const capabilities = await engine.execute(randomUUID(), input("capabilities"), deadline());
    const targetQualificationHash = capabilities.reply.capabilities.qualificationTarget.targetHash;
    const invoke = async caseId => {
      const commandId = randomUUID();
      const { token, nonce } = qualificationCredentialToken({ commandId, request: input("probe"), fixture: metadata,
        provisioning: provision.provisioning, sandboxId: sandboxId(), containerId: "d".repeat(64), tokenCase: caseId,
        targetQualificationHash });
      hooks.qualificationCapabilityToken = token;
      return engine.execute(commandId, { ...input("probe"), probe: {
        caseId, control: "credentialBrokering", expected: caseId === "credential_allow" ? "allow" : "deny",
        contractHash: "4".repeat(64), qualificationCredentialCapability: token,
        qualificationCredentialNonce: nonce,
      } }, deadline());
    };
    assert.equal((await invoke("credential_allow")).reply.verdict, "pass");
    assert.equal((await invoke("credential_wrong_binary_deny")).reply.verdict, "pass");
  }, hooks);
});

test("revoked credential claims require the exact post-revocation denial", async () => {
  const { metadata, profile } = qualificationCredentialFixture();
  const document = qualificationCredentialPolicy(metadata);
  const hooks = { physical: true, running: true, qualificationFixtures: { credential: metadata },
    qualificationCredentialProfile: profile, effectivePolicy: document,
    qualificationMcpOutput: `${JSON.stringify({ error: { data: { reasonCode: "sandbox_qualification_grant_revoked" } } })}\n403` };
  await fixture(async ({ engine, sandboxId }) => {
    const provision = hostProvisioning("qualification", { document,
      qualificationFixtures: { ...defaultQualificationFixtures, credential: metadata } });
    await prepareProvisioned(engine, provision);
    const capabilities = await engine.execute(randomUUID(), input("capabilities"), deadline());
    const targetQualificationHash = capabilities.reply.capabilities.qualificationTarget.targetHash;
    const commandId = randomUUID();
    const { token, nonce } = qualificationCredentialToken({ commandId, request: input("probe"), fixture: metadata,
      provisioning: provision.provisioning, sandboxId: sandboxId(), containerId: "d".repeat(64),
      tokenCase: "credential_revoke_deny", targetQualificationHash });
    hooks.qualificationCapabilityToken = token;
    const result = await engine.execute(commandId, { ...input("probe"), probe: {
      caseId: "credential_revoke_deny", control: "credentialBrokering", expected: "deny",
      contractHash: "5".repeat(64), qualificationCredentialCapability: token,
      qualificationCredentialNonce: nonce,
    } }, deadline());
    assert.equal(result.reply.verdict, "pass", JSON.stringify(result));
  }, hooks);
});

test("wrong-binary credential probe is unsupported until this exact target has a fresh positive proof", async () => {
  const { metadata, profile } = qualificationCredentialFixture();
  const document = qualificationCredentialPolicy(metadata);
  const hooks = { physical: true, running: true, qualificationFixtures: { credential: metadata },
    qualificationCredentialProfile: profile, effectivePolicy: document };
  await fixture(async ({ engine, sandboxId, calls }) => {
    const provision = hostProvisioning("qualification", { document,
      qualificationFixtures: { ...defaultQualificationFixtures, credential: metadata } });
    await prepareProvisioned(engine, provision);
    const capabilities = await engine.execute(randomUUID(), input("capabilities"), deadline());
    const targetQualificationHash = capabilities.reply.capabilities.qualificationTarget.targetHash;
    const commandId = randomUUID();
    const { token, nonce } = qualificationCredentialToken({ commandId, request: input("probe"), fixture: metadata,
      provisioning: provision.provisioning, sandboxId: sandboxId(), containerId: "d".repeat(64),
      tokenCase: "credential_wrong_binary_deny", targetQualificationHash });
    hooks.qualificationCapabilityToken = token;
    const result = await engine.execute(commandId, { ...input("probe"), probe: {
      caseId: "credential_wrong_binary_deny", control: "credentialBrokering", expected: "deny",
      contractHash: "6".repeat(64), qualificationCredentialCapability: token,
      qualificationCredentialNonce: nonce,
    } }, deadline());
    assert.equal(result.reply.verdict, "unsupported", JSON.stringify(result));
    assert.equal(calls.some(call => call.args.at(-1) === "https://gateway.example.test/mcp/gateways/gateway-fixture-1"), false);
  }, hooks);
});

test("host rejects malformed cleanup attestations and never accepts them for execution actions", async () =>
  fixture(async ({ engine }) => {
    const cleanupAttestation = {
      version: 2, purpose: "native_runtime_asset_erasure", executionProfile: "fixed_local_eraser_v1", executionProfileHash:"c".repeat(64),
      jobId: randomUUID(), jobKey: `runtime-asset-erasure:v1:${randomUUID()}`,
      attemptNumber: 1, executionOwnerId: "retention-worker", locatorDigest: "a".repeat(64),
      companyPurgeOperationId: null, startBindingDigest: "b".repeat(64),
    };
    const cleanupCapabilities = input("capabilities");
    delete cleanupCapabilities.requesterUserId;
    const observed = await engine.execute(randomUUID(), { ...cleanupCapabilities, cleanupAttestation }, deadline());
    assert.equal(observed.reply.action, "capabilities");
    for (const changed of [{version:1},{purpose:"workload_admission"},{executionProfile:"general_shell"},{executionProfileHash:"bad"}])
      await assert.rejects(engine.execute(randomUUID(), { ...cleanupCapabilities,
        cleanupAttestation:{...cleanupAttestation,...changed} }, deadline()), /sandbox_scope_changed/);
    const cleanupProbe=input("probe");delete cleanupProbe.requesterUserId;
    for(const caseId of ["credential_allow","network_allow"])await assert.rejects(engine.execute(randomUUID(),{
      ...cleanupProbe,probe:{caseId,control:caseId === "credential_allow" ? "credentialBrokering":"networkDestinationPolicy",
        expected:"allow",contractHash:"c".repeat(64)},cleanupAttestation},deadline()),/sandbox_scope_changed/);
    const cleanupStart = input("start");
    delete cleanupStart.requesterUserId;
    await assert.rejects(engine.execute(randomUUID(), {
      ...cleanupCapabilities,
      cleanupAttestation: { ...cleanupAttestation, unexpected: true },
    }, deadline()));
    await assert.rejects(engine.execute(randomUUID(), {
      ...cleanupStart, start: {
        policyHash, expiresAt: deadline(), idempotencyKey: randomUUID(),
      }, cleanupAttestation,
    }, deadline()));
    await assert.rejects(engine.execute(randomUUID(), {
      ...cleanupCapabilities,
      cleanupAttestation: { ...cleanupAttestation, locatorDigest: "bad" },
    }, deadline()));
    await assert.rejects(engine.execute(randomUUID(), {
      ...input("capabilities"), requesterUserId: "fixture-owner", cleanupAttestation,
    }, deadline()), /sandbox_scope_changed/);
  }));
test("Stop checks immutable scope, targets one sandbox and persists a restart receipt", async () =>
  fixture(async ({ engine, config, calls, root, run }) => {
    const id = randomUUID(),
      receipt = await engine.execute(id, input("stop"), deadline());
    assert.equal(receipt.reply.stopped, true);
    const count = calls.length,
      restarted = openShellHostEngine({ config, epoch: 1, root, run });
    await restarted.initialize();
    assert.deepEqual(
      await restarted.execute(id, input("stop"), deadline()),
      receipt,
    );
    assert.equal(calls.length, count);
    assert.ok(
      calls.every(
        ({ args }) =>
          !args.includes("--all") && !args.includes("--gateway-insecure"),
      ),
    );
    await assert.rejects(
      restarted.execute(
        id,
        { ...input("stop"), scope: { ...scope, cellGeneration: "2" } },
        deadline(),
      ),
      /sandbox_scope_changed/,
    );
  }));
test("cleanup Stop and inspect require the original exact Sandbox and Docker target before effects", async () => {
  const startBusiness = async ({ engine, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    const applied = await engine.execute(randomUUID(),
      { ...input("apply"), admission: hostAdmission("cleanup-target-apply", policyDocument) }, deadline());
    assert.equal(applied.success, true, JSON.stringify(applied));
    const started = await engine.execute(randomUUID(), { ...input("start"), start: {
      policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "cleanup-target-start",
    } }, deadline());
    assert.equal(started.success, true, JSON.stringify(started));
    return { sandboxId: started.reply.sandboxId, containerId: started.reply.containerId };
  };
  await fixture(async context => {
    const target = await startBusiness(context);
    const stopped = await context.engine.execute(randomUUID(), { ...input("stop"), expectedTarget: target }, deadline());
    assert.equal(stopped.success, true, JSON.stringify(stopped));
    assert.deepEqual({ sandboxId: stopped.reply.sandboxId, containerId: stopped.reply.containerId }, target);
    assert.equal(context.calls.filter(call => call.args[4] === "sandbox" && call.args[5] === "stop").length, 1);
  }, { physical: true, running: true });

  // Even if the host journal has been lost, a replacement carrying the same
  // scope labels must not be stopped on a cleanup command attenuated to the
  // original successful start receipt.
  await fixture(async context => {
    const target = await startBusiness(context);
    await writeFile(path.join(context.root, "openshell-journal.json"), JSON.stringify({ version: 2, scopes: {}, commands: {} }), { mode: 0o600 });
    context.replaceSandbox();
    const before = context.calls.filter(call => call.args[4] === "sandbox" && call.args[5] === "stop").length;
    const result = await context.engine.execute(randomUUID(), { ...input("stop"), expectedTarget: target }, deadline());
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
    assert.equal(context.calls.filter(call => call.args[4] === "sandbox" && call.args[5] === "stop").length, before);
  }, { physical: true, running: true });

  // A reused Sandbox UUID with a different Docker container is also rejected
  // before the destructive CLI action.
  await fixture(async context => {
    const target = await startBusiness(context);
    await writeFile(path.join(context.root, "openshell-journal.json"), JSON.stringify({ version: 2, scopes: {}, commands: {} }), { mode: 0o600 });
    context.replaceContainer();
    const before = context.calls.filter(call => call.args[4] === "sandbox" && call.args[5] === "stop").length;
    const result = await context.engine.execute(randomUUID(), { ...input("stop"), expectedTarget: target }, deadline());
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
    assert.equal(context.calls.filter(call => call.args[4] === "sandbox" && call.args[5] === "stop").length, before);
  }, { physical: true, running: true });

  await fixture(async context => {
    const target = await startBusiness(context);
    context.replaceSandbox();
    const result = await context.engine.execute(randomUUID(), { ...input("inspect"), expectedTarget: target }, deadline());
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
  }, { physical: true, running: true });

  await fixture(async context => {
    const target = await startBusiness(context);
    context.replaceContainer();
    const result = await context.engine.execute(randomUUID(), { ...input("inspect"), expectedTarget: target }, deadline());
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
  }, { physical: true, running: true });

  await fixture(async context => {
    const callsBefore = context.calls.length;
    await assert.rejects(context.engine.execute(randomUUID(), { ...input("capabilities"), expectedTarget: {
      sandboxId: randomUUID(), containerId: "a".repeat(64),
    } }, deadline()), /sandbox_scope_changed/);
    assert.equal(context.calls.length, callsBefore, "expectedTarget is not a general request authority");
  });
});
test("foreign labels and host epochs cannot run Stop", async () =>
  fixture(async ({ engine, calls, swapScope }) => {
    swapScope();
    assert.equal(
      (await engine.execute(randomUUID(), input("stop"), deadline())).errorCode,
      "sandbox_scope_changed",
    );
    assert.ok(calls.every(({ args }) => !args.includes("stop")));
    await assert.rejects(
      engine.execute(
        randomUUID(),
        { ...input("stop"), hostEpoch: 2 },
        deadline(),
      ),
      /sandbox_scope_changed/,
    );
  }));
test("binary change and public CLI state close the command without leaking subprocess errors", async () =>
  fixture(async ({ engine, config }) => {
    await writeFile(config.executable, "changed");
    assert.equal(
      (await engine.execute(randomUUID(), input("stop"), deadline())).errorCode,
      "sandbox_host_unavailable",
    );
    await writeFile(config.executable, "fixture-only-cli");
    await chmod(config.stateHome, 0o755);
    assert.equal(
      (await engine.execute(randomUUID(), input("stop"), deadline())).errorCode,
      "sandbox_host_unavailable",
    );
  }));
test("provider revocation uses exact private names and unreachable fencing rechecks ownership", async () =>
  fixture(async ({ engine, calls, swapScope }) => {
    assert.equal(
      (
        await engine.execute(
          randomUUID(),
          input("revoke_providers"),
          deadline(),
        )
      ).reply.revoked,
      true,
    );
    assert.ok(
      calls.some(
        ({ args }) =>
          args.includes("detach") &&
          args.includes("fixture-provider") &&
          args.includes("--wait"),
      ),
    );
    swapScope();
    await assert.rejects(engine.fenceAll(), /sandbox_host_unavailable/);
  }));

test("reused names and identical labels cannot replace a pinned instance after restart", async () =>
  fixture(async ({ engine, config, root, run, calls, replaceSandbox }) => {
    assert.equal((await engine.execute(randomUUID(), input("inspect"), deadline())).success, true);
    const pinned = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(pinned.version, 2);
    assert.ok(pinned.scopes[scope.bindingId].sandboxId);
    replaceSandbox();
    const restarted = openShellHostEngine({ config, epoch: 1, root, run });
    await restarted.initialize();
    for (const action of ["stop", "destroy", "revoke_providers"]) {
      assert.equal((await restarted.execute(randomUUID(), input(action), deadline())).errorCode,
        "sandbox_scope_changed");
    }
    await assert.rejects(restarted.fenceAll(), /sandbox_host_unavailable/);
    assert.ok(calls.every(({ args }) => !args.includes("stop") && !args.includes("delete") && !args.includes("detach")));
    assert.deepEqual(JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8")).scopes,
      pinned.scopes);
  }));
test("absent gateway identity cannot be learned from labels", async () =>
  fixture(async ({ engine, calls, clearSandboxIdentity }) => {
    clearSandboxIdentity();
    assert.equal((await engine.execute(randomUUID(), input("stop"), deadline())).errorCode,
      "sandbox_scope_changed");
    assert.ok(calls.every(({ args }) => !args.includes("stop")));
  }));
test("legacy unpinned observations stay fenced during journal migration", async () =>
  fixture(async ({ config, root, run, calls }) => {
    await writeFile(path.join(root, "openshell-journal.json"), JSON.stringify({
      version: 1, scopes: { [scope.bindingId]: scope }, commands: {},
    }));
    const restarted = openShellHostEngine({ config, epoch: 1, root, run });
    await restarted.initialize();
    assert.equal((await restarted.execute(randomUUID(), input("stop"), deadline())).errorCode,
      "sandbox_scope_changed");
    await assert.rejects(restarted.fenceAll(), /sandbox_host_unavailable/);
    assert.ok(calls.every(({ args }) => !args.includes("stop")));
  }));

test("apply and start use pinned OpenShell policy APIs plus exact Docker identity observations", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase, sandboxId }) => {
    enablePhysical();
    setPhase("Stopped");
    const applied = await engine.execute(
      randomUUID(),
      { ...input("apply"), admission: hostAdmission("policy-test", policyDocument) },
      deadline(),
    );
    assert.equal(applied.reply.action, "apply");
    assert.equal(applied.reply.applied, true);
    assert.equal(applied.reply.policyHash, policyHash);
    assert.equal(applied.reply.requiresRecreate, false);
    assert.ok(calls.some(({ args }) => args.includes("policy") && args.includes("set")));
    const expectedSandboxId = sandboxId();
    const policySet = calls.find(({ args }) => args.slice(4).includes("set"));
    assert.equal(policySet.args[policySet.args.indexOf("--expected-sandbox-id") + 1], expectedSandboxId);
    const started = await engine.execute(
      randomUUID(),
      {
        ...input("start"),
        start: {
          policyHash,
          expiresAt: new Date(Date.now() + 50000).toISOString(),
          idempotencyKey: "native-start-1",
        },
      },
      deadline(),
    );
    assert.equal(started.reply.action, "start");
    assert.equal(started.reply.started, true);
    assert.equal(started.reply.containerId, "d".repeat(64));
    assert.equal(started.reply.imageDigest, input("inspect").imageDigest);
    assert.equal(started.reply.policyHash, policyHash);
    assert.ok(calls.some(({ args }) => args.includes("sandbox") && args.includes("start")));
    const startCall = calls.find(({ args }) => args.slice(4).includes("start"));
    assert.equal(startCall.args[startCall.args.indexOf("--expected-sandbox-id") + 1], expectedSandboxId);
  }));

test("expected sandbox IDs guard policy, start, stop, and delete CLI mutations", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase, sandboxId }) => {
    enablePhysical();
    setPhase("Stopped");
    const applied = await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("expected-id-policy") }, deadline());
    assert.equal(applied.reply.applied, true);
    const expectedSandboxId = sandboxId();
    await engine.execute(randomUUID(), {
      ...input("start"),
      start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "expected-id-start" },
    }, deadline());
    await engine.execute(randomUUID(), input("stop"), deadline());
    const destroyed = await engine.execute(randomUUID(), input("destroy"), deadline());
    assert.equal(destroyed.reply.destroyed, true);
    for (const verb of ["set", "start", "stop", "delete"]) {
      const call = calls.find(({ args }) => args.slice(4).includes(verb) &&
        (verb === "set" ? args.slice(4, 6).join(" ") === "policy set" : args.slice(4, 6).join(" ") === `sandbox ${verb === "delete" ? "delete" : verb}`));
      assert.ok(call, `missing ${verb} call`);
      assert.equal(call.args[call.args.indexOf("--expected-sandbox-id") + 1], expectedSandboxId, `${verb} must use the observed UUID precondition`);
    }
  }));

test("a same-name sandbox replacement is rejected by the observed-ID start precondition", async () => {
  let replaceBeforeStart;
  await fixture(async ({ engine, calls, enablePhysical, setPhase, sandboxId, replaceSandbox }) => {
    enablePhysical();
    setPhase("Stopped");
    await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("expected-id-race") }, deadline());
    const observedSandboxId = sandboxId();
    replaceBeforeStart = replaceSandbox;
    const started = await engine.execute(randomUUID(), {
      ...input("start"),
      start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "expected-id-race-start" },
    }, deadline());
    assert.equal(started.success, false);
    assert.equal(started.errorCode, "sandbox_scope_changed");
    const startCall = calls.find(({ args }) => args.slice(4, 6).join(" ") === "sandbox start");
    assert.ok(startCall);
    assert.equal(startCall.args[startCall.args.indexOf("--expected-sandbox-id") + 1], observedSandboxId);
  }, { beforeCommand(_file, args) {
    if (args.slice(4, 6).join(" ") === "sandbox start" && replaceBeforeStart) {
      const replace = replaceBeforeStart; replaceBeforeStart = null; replace();
    }
  } });
});

test("resource limits flow through a typed admission and are applied and observed on the pinned Docker ID", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase, resourceConfig, root }) => {
    enablePhysical();
    setPhase("Stopped");
    const result = await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("resource-bounds") }, deadline());
    assert.ok(result.reply, JSON.stringify(result));
    assert.equal(result.reply.action, "apply");
    assert.equal(result.reply.applied, true);
    assert.deepEqual(resourceConfig(), { NanoCpus: 1500000000, Memory: 536870912, MemorySwap: 536870912, PidsLimit: 128,
      LogConfig: { Type: "none", Config: {} },
      StorageOpt: { size: "1073741824B" },
      Tmpfs: { "/run/openshell-supervisor-ca/material": "rw,noexec,nosuid,nodev,size=1m,uid=1000,gid=1000,mode=0755" } });
    const update = calls.find(call => call.args[0] === "update");
    assert.ok(update);
    assert.equal(update.args.at(-1), "d".repeat(64));
    const journal = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.deepEqual(journal.scopes[scope.bindingId].policy.resourceLimits, resourceLimits);
    assert.ok(calls.some(call => call.args[0] === "inspect" && call.args[1] === "d".repeat(64)));
  }));

test("requires persistent Docker logs to be disabled before resource admission", async () => {
  await fixture(async ({ engine, calls, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    const result = await engine.execute(randomUUID(), {
      ...input("apply"), admission: hostAdmission("docker-logs-disabled"),
    }, deadline());
    assert.equal(result.reply.applied, true);
  });
  await fixture(async ({ engine, calls, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    const result = await engine.execute(randomUUID(), {
      ...input("apply"), admission: hostAdmission("docker-logs-persistent"),
    }, deadline());
    assert.equal(result.reply.applied, false);
    assert.equal(result.reply.requiresRecreate, true);
    assert.equal(calls.some(call => call.args[0] === "update"), false);
  }, { logConfig: { Type: "json-file", Config: {} } });
  await fixture(async ({ engine, calls, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    const result = await engine.execute(randomUUID(), {
      ...input("apply"), admission: hostAdmission("supervisor-docker-logs-persistent"),
    }, deadline());
    assert.equal(result.reply.applied, false);
    assert.equal(result.reply.requiresRecreate, true);
    assert.equal(calls.some(call => call.args[0] === "update"), false);
  }, { supervisorLogConfig: { Type: "json-file", Config: {} } });
});

test("requires the exact create-time disk quota and overlay2 XFS backend before policy application", async () => {
  await fixture(async ({ engine, calls, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    const result = await engine.execute(randomUUID(), {
      ...input("apply"), admission: hostAdmission("disk-quota-match"),
    }, deadline());
    assert.equal(result.reply.applied, true);
    assert.ok(calls.some(({ args }) => args[0] === "info" && args[2] === "{{.Driver}}"));
    assert.ok(calls.some(({ args }) => args[0] === "info" && args[2] === "{{json .DriverStatus}}"));
  });
  await fixture(async ({ engine, calls, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    const result = await engine.execute(randomUUID(), {
      ...input("apply"), admission: hostAdmission("disk-quota-mismatch"),
    }, deadline());
    assert.equal(result.reply.applied, false);
    assert.equal(result.reply.requiresRecreate, true);
    assert.equal(calls.some(({ args }) => args[0] === "update"), false);
  }, { storageOpt: { size: "2147483648B" } });
  await fixture(async ({ engine, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    const result = await engine.execute(randomUUID(), {
      ...input("apply"), admission: hostAdmission("disk-quota-unsupported-backend"),
    }, deadline());
    assert.equal(result.reply.applied, false);
    assert.equal(result.reply.requiresRecreate, true);
  }, { storageDriver: "btrfs" });
});

test("rejects writable mounts outside the size-limited rootfs and mounts that replace its workspace", async () => {
  for (const mount of [
    { Type: "volume", Name: "external", Driver: "local", Destination: "/data", RW: true },
    { Type: "volume", Name: "external", Driver: "local", Destination: "/workspace", RW: false },
  ]) {
    await fixture(async ({ engine, enablePhysical, setPhase }) => {
      enablePhysical();
      setPhase("Stopped");
      const result = await engine.execute(randomUUID(), {
        ...input("apply"), admission: hostAdmission("disk-mount-topology"),
      }, deadline());
      assert.equal(result.success, false);
      assert.equal(result.errorCode, "sandbox_operation_unsupported");
    }, { extraMounts: [mount] });
  }
});

test("resource HostConfig drift blocks restart before the name-scoped OpenShell start call", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase, setResourceConfig }) => {
    enablePhysical();
    setPhase("Stopped");
    const applied = await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("resource-drift") }, deadline());
    assert.equal(applied.success, true);
    setResourceConfig({ NanoCpus: 250000000, Memory: 134217728, MemorySwap: 134217728, PidsLimit: 32 });
    calls.length = 0;
    const started = await engine.execute(randomUUID(), {
      ...input("start"),
      start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "resource-drift-start" },
    }, deadline());
    assert.equal(started.success, false);
    assert.equal(started.errorCode, "sandbox_operation_unsupported");
    assert.equal(calls.some(call => call.args.includes("sandbox") && call.args.includes("start")), false);
  }));

test("a same-name replacement between Docker observation and resource update never receives the update", async () => {
  let replaceContainer;
  await fixture(async ({ engine, calls, enablePhysical, setPhase, replaceContainerBeforeUpdate }) => {
    enablePhysical();
    setPhase("Stopped");
    replaceContainer = replaceContainerBeforeUpdate;
    const result = await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("resource-replacement") }, deadline());
    assert.notEqual(result.success, true);
    const update = calls.find(call => call.args[0] === "update");
    assert.ok(update);
    assert.equal(update.args.at(-1), "d".repeat(64));
    assert.notEqual(update.args.at(-1), "f".repeat(64));
  }, { beforeCommand(file, args) { if (file === "docker" && args[0] === "update") replaceContainer?.(); } });
});

test("a broker profile with the exact authorized binary survives profile inspection", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    const profileHash = createHash("sha256").update(JSON.stringify(canonical(brokerProfile))).digest("hex");
    const result = await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("exact-binary-profile", policyDocument,
      { id: brokerProfile.id, hash: profileHash, binaries: ["/usr/bin/node"] }) }, deadline());
    assert.equal(result.success, true, JSON.stringify({ errorCode: result.errorCode, calls: calls.map(call => call.args) }));
    assert.equal(result.reply.applied, true);
    assert.ok(calls.some(call => call.args.slice(4).join(" ").includes("profile describe paperclip-broker")));
  }, { brokerProfile }));

test("broker binary profile must exactly equal the authorized compiled executable set", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    const profileHash = createHash("sha256").update(JSON.stringify(canonical(brokerProfile))).digest("hex");
    const result = await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("wrong-binary-profile", policyDocument,
      { id: brokerProfile.id, hash: profileHash, binaries: ["/usr/bin/other"] }) }, deadline());
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_operation_unsupported");
    assert.equal(calls.some(call => call.args[0] === "update"), false);
  }, { brokerProfile }));

test("expired source policy deadlines fail before any host or CLI observation", async () =>
  fixture(async ({ engine, calls }) => {
    const expiredApply = await engine.execute(
      randomUUID(),
      { ...input("apply"), admission: { ...hostAdmission("expired-apply"), expiresAt: new Date(0).toISOString() } },
      deadline(),
    );
    assert.equal(expiredApply.errorCode, "sandbox_scope_changed");
    const startBeforeItsSourceDeadline = await engine.execute(
      randomUUID(),
      { ...input("start"), start: { policyHash, expiresAt: new Date(Date.now() + 1000).toISOString(), idempotencyKey: "late-start", } },
      deadline(),
    );
    assert.equal(startBeforeItsSourceDeadline.errorCode, "sandbox_scope_changed");
    assert.equal(calls.length, 0);
  }));

test("a persisted unknown command intent is never replayed after host restart", async () =>
  fixture(async ({ engine, calls, root }) => {
    await engine.execute(randomUUID(), input("inspect"), deadline());
    const commandId = randomUUID();
    const request = {
      ...input("apply"),
      admission: hostAdmission("unknown-after-restart"),
    };
    const journalPath = path.join(root, "openshell-journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    journal.commands[commandId] = {
      requestHash: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
      result: null,
    };
    await writeFile(journalPath, JSON.stringify(journal), { mode: 0o600 });
    await engine.initialize();
    calls.length = 0;
    const retry = await engine.execute(commandId, request, deadline());
    assert.equal(retry.errorCode, "sandbox_observation_unavailable");
    assert.equal(calls.length, 0);
  }));

test("static policy changes require sandbox recreation before any policy mutation", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    const candidate = structuredClone(policyDocument);
    candidate.process.run_as_user = "1001";
    const result = await engine.execute(
      randomUUID(),
      { ...input("apply"), admission: hostAdmission("static-change", candidate) },
      deadline(),
    );
    assert.equal(result.reply.applied, false);
    assert.equal(result.reply.requiresRecreate, true);
    assert.equal(calls.some(({ args }) => args.includes("policy") && args.includes("set")), false);
  }));

test("foreign Docker labels block policy mutation before any effect", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase, setWrongContainerLabels }) => {
    enablePhysical();
    setPhase("Stopped");
    setWrongContainerLabels();
    const result = await engine.execute(
      randomUUID(),
      { ...input("apply"), admission: hostAdmission("foreign-label", policyDocument) },
      deadline(),
    );
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
    assert.equal(calls.some(({ args }) => args.includes("policy") && args.includes("set")), false);
  }));

test("an image repository digest mismatch blocks policy mutation before any effect", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase, setContainerImageDigest }) => {
    enablePhysical();
    setPhase("Stopped");
    setContainerImageDigest("fixture.invalid/other@sha256:" + "f".repeat(64));
    const result = await engine.execute(
      randomUUID(),
      { ...input("apply"), admission: hostAdmission("wrong-image", policyDocument) },
      deadline(),
    );
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
    assert.equal(calls.some(({ args }) => args.includes("policy") && args.includes("set")), false);
  }));

test("a changed OpenShell policy revision blocks workload start", async () =>
  fixture(async ({ engine, calls, enablePhysical, setPhase, changePolicyRevision }) => {
    enablePhysical();
    setPhase("Stopped");
    const applied = await engine.execute(
      randomUUID(),
      { ...input("apply"), admission: hostAdmission("revision-test", policyDocument) },
      deadline(),
    );
    assert.equal(applied.reply.applied, true);
    changePolicyRevision();
    const result = await engine.execute(
      randomUUID(),
      {
        ...input("start"),
        start: {
          policyHash,
          expiresAt: new Date(Date.now() + 50000).toISOString(),
          idempotencyKey: "stale-policy-start",
        },
      },
      deadline(),
    );
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "sandbox_scope_changed");
    assert.equal(calls.some(({ args }) => args.includes("sandbox") && args.includes("start")), false);
  }));

test("physical inspection never promotes host observations to qualification", async () =>
  fixture(async ({ engine, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Ready");
    assert.deepEqual(
      (await engine.execute(randomUUID(), input("inspect"), deadline())).reply,
      {
        action: "inspect",
        state: "running",
        policyHash: null,
        imageDigest: input("inspect").imageDigest,
        generation: "1",
        controlsHealthy: false,
      },
    );
  }));

test("sandbox exec streams through pinned CLI argv without shell and journals no output or replay", async () => {
  let spawnCount = 0, stdinReceived = "", expectedSandboxId;
  const hooks = {
    spawnProcess(file, args, options) {
      spawnCount++;
      assert.ok(path.isAbsolute(file));
      assert.equal(options.shell, false);
      assert.deepEqual(options.stdio, ["pipe", "pipe", "pipe"]);
      const command = args.slice(4), execIndex = command.indexOf("exec");
      assert.ok(execIndex >= 0);
      assert.equal(command[execIndex + 2], scope.sandboxRef);
      assert.equal(command[command.indexOf("--expected-sandbox-id") + 1], expectedSandboxId);
      assert.ok(command.includes("--workdir"));
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdin.on("data", chunk => { stdinReceived += chunk.toString("utf8"); });
      child.stdout = Readable.from([Buffer.from("fixture stdout")]);
      child.stderr = Readable.from([Buffer.from("fixture stderr")]);
      child.kill = () => true;
      setImmediate(() => child.emit("close", 0, null));
      return child;
    },
  };
  await fixture(async ({ engine, enablePhysical, setPhase, root, sandboxId }) => {
    enablePhysical();
    setPhase("Stopped");
    expectedSandboxId = sandboxId();
    await engine.execute(randomUUID(), {
      ...input("apply"),
      admission: hostAdmission("exec-stream-policy", policyDocument),
    }, deadline());
    await engine.execute(randomUUID(), {
      ...input("start"),
      start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "exec-stream-start" },
    }, deadline());
    const request = execRequest(deadline(), Buffer.from("fixture stdin").toString("base64"));
    const outputs = [];
    const scopeInput = { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId, cellGeneration: "1", sandboxRef: scope.sandboxRef };
    const result = await engine.executeStream({ scope: scopeInput, request, capabilityToken: "fixture-token" }, (stream, chunk) => outputs.push([stream, chunk.toString("utf8")]));
    assert.deepEqual(result, { exitCode: 0, timedOut: false });
    assert.deepEqual(outputs, [["stdout", "fixture stdout"], ["stderr", "fixture stderr"]]);
    assert.equal(stdinReceived, "fixture stdin");
    const journal = await readFile(path.join(root, "openshell-journal.json"), "utf8");
    assert.equal(journal.includes("fixture stdout"), false);
    assert.equal(journal.includes("fixture stderr"), false);
    await assert.rejects(engine.executeStream({ scope: scopeInput, request, capabilityToken: "fixture-token" }, () => {}), /exec_unknown/);
    assert.equal(spawnCount, 1);
  }, hooks);
});

test("sandbox exec stdin EPIPE is controlled unknown and never completes or replays its journal claim", async () => {
  let spawnCount = 0, killCount = 0;
  const hooks = {
    spawnProcess() {
      spawnCount++;
      const child = new EventEmitter();
      child.stdin = new Writable({ write(_chunk, _encoding, done) {
        done(Object.assign(new Error("fixture closed stdin"), { code: "EPIPE" }));
      } });
      child.stdout = Readable.from([]); child.stderr = Readable.from([]);
      child.kill = () => { killCount++; setImmediate(() => child.emit("close", 0, null)); return true; };
      return child;
    },
  };
  await fixture(async ({ engine, enablePhysical, setPhase, root }) => {
    enablePhysical(); setPhase("Stopped");
    await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("stdin-epipe-policy", policyDocument) }, deadline());
    await engine.execute(randomUUID(), { ...input("start"), start: { policyHash,
      expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "stdin-epipe-start" } }, deadline());
    const request = execRequest(deadline(), Buffer.from("input that was not accepted").toString("base64"));
    const scopeInput = { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId,
      cellGeneration: "1", sandboxRef: scope.sandboxRef };
    await assert.rejects(engine.executeStream({ scope: scopeInput, request, capabilityToken: "fixture-token" }, () => {}), /exec_unknown/);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(killCount > 0);
    const journal = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(journal.commands[request.requestId].state, "claimed");
    assert.equal(journal.commands[request.requestId].result, null);
    await assert.rejects(engine.executeStream({ scope: scopeInput, request, capabilityToken: "fixture-token" }, () => {}), /exec_unknown/);
    assert.equal(spawnCount, 1);
  }, hooks);
});

test("sandbox exec empty stdin sends no bytes and only tolerates an expected closed-pipe race", async () => {
  for (const errorCode of ["EPIPE", "EIO"]) {
    let writeCount = 0, killCount = 0, childClosedBeforeFinalError = false;
    const hooks = {
      spawnProcess() {
        const child = new EventEmitter();
        child.stdin = new Writable({
          write(_chunk, _encoding, done) { writeCount++; done(); },
          final(done) {
            setImmediate(() => {
              child.emit("close", 0, null);
              childClosedBeforeFinalError = true;
              setTimeout(() => done(Object.assign(new Error("fixture closed empty stdin"), { code: errorCode })), 5);
            });
          },
        });
        child.stdin.once("error", () => setImmediate(() => child.emit("close", 0, null)));
        child.stdout = Readable.from([Buffer.from("known empty-input result")]); child.stderr = Readable.from([]);
        child.kill = () => { killCount++; setImmediate(() => child.emit("close", 0, null)); return true; };
        return child;
      },
    };
    await fixture(async ({ engine, enablePhysical, setPhase, root }) => {
      enablePhysical(); setPhase("Stopped");
      await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission(`empty-stdin-${errorCode}`, policyDocument) }, deadline());
      await engine.execute(randomUUID(), { ...input("start"), start: { policyHash,
        expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: `empty-stdin-${errorCode}` } }, deadline());
      const request = execRequest();
      const scopeInput = { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId,
        cellGeneration: "1", sandboxRef: scope.sandboxRef };
      const execution = engine.executeStream({ scope: scopeInput, request, capabilityToken: "fixture-token" }, () => {});
      if (errorCode === "EPIPE") assert.deepEqual(await execution, { exitCode: 0, timedOut: false });
      else await assert.rejects(execution, /exec_unknown/);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(childClosedBeforeFinalError, true, "known child close must not race a delayed stdin failure into success");
      assert.equal(writeCount, 0, "an empty request closes stdin without issuing a zero-byte write");
      assert.equal(killCount > 0, errorCode !== "EPIPE");
      const journal = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
      assert.equal(journal.commands[request.requestId].state, errorCode === "EPIPE" ? "completed" : "claimed");
      if (errorCode !== "EPIPE") assert.equal(journal.commands[request.requestId].result, null);
    }, hooks);
  }
});

test("sandbox broker capability enters through an expiring native provider, never CLI argv or workload env", async () => {
  let spawnedArgs = null, providerEnvSeen = false;
  const hooks = {
    brokerProfile,
    spawnProcess(_file, args, options) {
      spawnedArgs = args;
      assert.equal(options.shell, false);
      assert.equal(options.env.PAPERCLIP_SANDBOX_BROKER_TOKEN, undefined);
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = Readable.from([Buffer.from("brokered output")]);
      child.stderr = Readable.from([]);
      child.kill = () => true;
      setImmediate(() => child.emit("close", 0, null));
      return child;
    },
    beforeCommand(_file, args) {
      if (args.includes("PAPERCLIP_SANDBOX_BROKER_TOKEN")) providerEnvSeen = true;
    },
  };
  await fixture(async ({ engine, enablePhysical, setPhase, calls, sandboxId }) => {
    enablePhysical();
    setPhase("Stopped");
    await engine.execute(randomUUID(), {
      ...input("apply"),
      admission: hostAdmission("broker-stream-policy", policyDocument),
    }, deadline());
    await engine.execute(randomUUID(), {
      ...input("start"),
      start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "broker-stream-start" },
    }, deadline());
    const { request, token } = brokerExecRequest();
    hooks.brokerToken = token;
    const outputs = [];
    const scopeInput = { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId, cellGeneration: "1", sandboxRef: scope.sandboxRef };
    const result = await engine.executeStream({ scope: scopeInput, request, capabilityToken: "fixture-token" }, (stream, chunk) => outputs.push([stream, chunk.toString("utf8")]));
    assert.deepEqual(result, { exitCode: 0, timedOut: false });
    assert.deepEqual(outputs, [["stdout", "brokered output"]]);
    assert.equal(providerEnvSeen, true);
    assert.ok(calls.some(call => call.args.slice(4).join(" ").includes("provider create")));
    assert.ok(calls.some(call => call.args.slice(4).join(" ").includes("credential-expires-at")));
    const providerAttaches = calls.filter(call => call.args.slice(4).join(" ").includes("provider attach"));
    const providerDetaches = calls.filter(call => call.args.slice(4).join(" ").includes("provider detach"));
    assert.ok(providerAttaches.length > 0);
    assert.ok(providerDetaches.length > 0);
    for (const call of [...providerAttaches, ...providerDetaches])
      assert.equal(call.args[call.args.indexOf("--expected-sandbox-id") + 1], sandboxId());
    assert.ok(calls.some(call => call.args.slice(4).join(" ").includes("provider delete")));
    assert.equal(calls.some(call => call.args.some(value => String(value).includes(token))), false);
    assert.equal(spawnedArgs.some(value => String(value).includes(token)), false);
    assert.equal(spawnedArgs.some(value => String(value).startsWith("PAPERCLIP_SANDBOX_BROKER_TOKEN=")), false);
  }, hooks);
});

test("a broker provider cannot be attached to a same-name replacement sandbox", async () => {
  let replaceBeforeAttach = () => {}, spawned = 0;
  const hooks = {
    brokerProfile,
    spawnProcess() { spawned += 1; throw new Error("replacement sandbox must not receive broker workload"); },
    beforeCommand(_file, args) {
      const command = args.slice(4);
      if (command[0] === "sandbox" && command[1] === "provider" && command[2] === "attach") replaceBeforeAttach();
    },
  };
  await fixture(async ({ engine, enablePhysical, setPhase, calls, replaceSandbox, sandboxId }) => {
    replaceBeforeAttach = replaceSandbox;
    enablePhysical();
    setPhase("Stopped");
    await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("broker-replacement-policy") }, deadline());
    await engine.execute(randomUUID(), { ...input("start"), start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "broker-replacement-start" } }, deadline());
    const expectedId = sandboxId();
    const { request, token } = brokerExecRequest();
    hooks.brokerToken = token;
    const scopeInput = { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId, cellGeneration: "1", sandboxRef: scope.sandboxRef };
    await assert.rejects(engine.executeStream({ scope: scopeInput, request, capabilityToken: "fixture-token" }, () => {}));
    assert.notEqual(sandboxId(), expectedId);
    assert.equal(spawned, 0);
    const attach = calls.find(call => call.args.slice(4).join(" ").includes("provider attach"));
    assert.ok(attach);
    assert.equal(attach.args[attach.args.indexOf("--expected-sandbox-id") + 1], expectedId);
  }, hooks);
});

test("broker use rejects a profile whose signed executable binding differs even when profile hash is current", async () => {
  let spawned = 0;
  const changedProfile = { ...brokerProfile, binaries: [{ path: "/usr/bin/python" }] };
  const hooks = { brokerProfile: changedProfile, spawnProcess() { spawned += 1; throw new Error("should-not-spawn"); } };
  await fixture(async ({ engine, enablePhysical, setPhase, calls }) => {
    enablePhysical(); setPhase("Stopped");
    await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("binary-token-policy") }, deadline());
    await engine.execute(randomUUID(), { ...input("start"), start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "binary-token-start" } }, deadline());
    const { request, token } = brokerExecRequest();
    hooks.brokerToken = token;
    request.brokerCredential.profileHash = createHash("sha256").update(JSON.stringify(canonical(changedProfile))).digest("hex");
    request.commandDigest = createHash("sha256").update(JSON.stringify(canonical({ argv: request.argv, cwd: request.cwd, env: request.env,
      stdinHash: createHash("sha256").update(Buffer.from(request.stdinBase64, "base64")).digest("hex"), timeoutDeadline: request.deadlineAt,
      brokerCapabilityHash: createHash("sha256").update(token).digest("hex"),
      brokerProviderProfile: { id: request.brokerCredential.profileId, hash: request.brokerCredential.profileHash },
      modelBrokerCapabilityHash: null, modelBrokerProviderProfile: null, modelBrokerSession: null }))).digest("hex");
    const scopeInput = { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId, cellGeneration: "1", sandboxRef: scope.sandboxRef };
    await assert.rejects(engine.executeStream({ scope: scopeInput, request, capabilityToken: "fixture-token" }, () => {}), /sandbox_operation_unsupported/);
    assert.equal(spawned, 0);
    assert.equal(calls.some(call => call.args.slice(4).join(" ").includes("provider create")), false);
  }, hooks);
});

test("managed model capability uses its exact Messages route profile and stays out of workload env and argv", async () => {
  let spawnedArgs = null;
  const hooks = {
    modelBrokerProfile,
    spawnProcess(_file, args, options) {
      spawnedArgs = args;
      assert.equal(options.env.PAPERCLIP_SANDBOX_MODEL_TOKEN, undefined);
      const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = Readable.from([]); child.stderr = Readable.from([]);
      child.kill = () => true; setImmediate(() => child.emit("close", 0, null)); return child;
    },
  };
  await fixture(async ({ engine, enablePhysical, setPhase, calls }) => {
    enablePhysical(); setPhase("Stopped");
    await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("model-policy", policyDocument) }, deadline());
    await engine.execute(randomUUID(), { ...input("start"), start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "model-start" } }, deadline());
    const { request, token } = modelBrokerExecRequest(); hooks.brokerToken = token;
    const scopeInput = { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId, cellGeneration: "1", sandboxRef: scope.sandboxRef };
    assert.deepEqual(await engine.executeStream({ scope: scopeInput, request, capabilityToken: "fixture-token" }, () => {}), { exitCode: 0, timedOut: false });
    assert.ok(calls.some(call => call.args.slice(4).join(" ").includes("provider create")));
    assert.ok(calls.some(call => call.args.slice(4).join(" ").includes("paperclip-model-broker")));
    assert.equal(calls.some(call => call.args.some(value => String(value).includes(token))), false);
    assert.equal(spawnedArgs.some(value => String(value).includes(token)), false);
    assert.equal(spawnedArgs.some(value => String(value).startsWith("PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN=")), true);
    assert.equal(spawnedArgs.some(value => String(value) === "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND=100000"), true);
    assert.equal(spawnedArgs.some(value => String(value) === "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS=1024"), true);
    assert.equal(spawnedArgs.some(value => String(value).startsWith("PAPERCLIP_SANDBOX_MODEL_TOKEN=")), false);
    const forged = structuredClone(request);
    forged.env.PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND = "100001";
    forged.commandDigest = createHash("sha256").update(JSON.stringify(canonical({
      argv: forged.argv, cwd: forged.cwd, env: forged.env,
      stdinHash: createHash("sha256").update(Buffer.from(forged.stdinBase64, "base64")).digest("hex"),
      timeoutDeadline: forged.deadlineAt,
      brokerCapabilityHash: null, brokerProviderProfile: null,
      modelBrokerCapabilityHash: createHash("sha256").update(token).digest("hex"),
      modelBrokerProviderProfile: { id: forged.modelBrokerCredential.profileId, hash: forged.modelBrokerCredential.profileHash },
      modelBrokerSession: null,
    }))).digest("hex");
    await assert.rejects(() => engine.executeStream({
      scope: scopeInput, request: forged, capabilityToken: "fixture-token",
    }, () => {}), /sandbox_scope_changed/);
  }, hooks);
});

test("managed Native model provider survives more than one JWT lifetime and refreshes the same worker session provider", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const hooks = {
    modelBrokerProfile,
    spawnProcess(_file, _args, options) {
      assert.equal(options.env.PAPERCLIP_SANDBOX_MODEL_TOKEN, undefined);
      const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = Readable.from([]); child.stderr = Readable.from([]);
      child.kill = () => true; setImmediate(() => child.emit("close", 0, null)); return child;
    },
  };
  await fixture(async ({ engine, enablePhysical, setPhase, calls, root }) => {
    enablePhysical(); setPhase("Stopped");
    await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("model-session-policy", policyDocument) }, deadline());
    await engine.execute(randomUUID(), { ...input("start"), start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "model-session-start" } }, deadline());
    const scopeInput = { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId, cellGeneration: "1", sandboxRef: scope.sandboxRef };
    const first = modelBrokerSessionExecRequest("worker_model", "start"); hooks.brokerToken = first.token;
    const started = await engine.executeStream({ scope: scopeInput, request: first.request, capabilityToken: "fixture-token" }, () => {});
    assert.ok(Date.parse(started.modelBrokerSessionReceipt.expiresAt) > Date.parse(first.request.deadlineAt), "credential lifetime is independent of the short launch command");
    const startedJournal = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    const startedEntry = startedJournal.modelBrokerSessions[first.session.sessionKey];
    assert.equal(startedEntry.binding.sessionDeadlineAt, first.session.sessionDeadlineAt);
    assert.equal(startedEntry.binding.runnerInstanceId, first.session.runnerInstanceId);
    assert.equal(startedEntry.providerName, `awms-${first.session.sessionKey.slice(0, 32)}`);
    assert.equal(startedEntry.profileHash, first.request.modelBrokerCredential.profileHash);
    assert.equal(startedEntry.capabilityHash, started.modelBrokerSessionReceipt.capabilityHash);
    assert.equal(startedEntry.expiresAt, started.modelBrokerSessionReceipt.expiresAt);
    assert.equal(startedEntry.state, "active");
    assert.equal(JSON.stringify(startedEntry).includes(first.token), false);
    const providerName = `awms-${first.session.sessionKey.slice(0, 32)}`;
    const updatesBeforeSameSecond = calls.filter(call => call.args.slice(4).join(" ").includes(`provider update ${providerName}`)).length;
    const sameSecondCallIndex = calls.length;
    const sameSecond = modelBrokerSessionExecRequest("worker_model", "refresh",
      { ...first, expectedCapabilityHash: started.modelBrokerSessionReceipt.capabilityHash }); hooks.brokerToken = sameSecond.token;
    const sameSecondReceipt = await engine.executeStream({ scope: scopeInput, request: sameSecond.request, capabilityToken: "fixture-token" }, () => {});
    assert.deepEqual(sameSecondReceipt.modelBrokerSessionReceipt, started.modelBrokerSessionReceipt);
    assert.equal(calls.filter(call => call.args.slice(4).join(" ").includes(`provider update ${providerName}`)).length, updatesBeforeSameSecond,
      "same-expiry refresh observes and retains the active provider without mutating it");
    const sameSecondCalls = calls.slice(sameSecondCallIndex).map(call => call.args.slice(4).join(" "));
    assert.ok(sameSecondCalls.some(command => command.includes("provider list --page-size 128") && command.includes("--output json")));
    assert.ok(sameSecondCalls.some(command => command.includes(`sandbox provider list ${scope.sandboxRef}`)));
    assert.ok(calls.some(call => call.args.slice(4).join(" ").includes(`provider attach ${scope.sandboxRef} ${providerName}`)));
    assert.equal(calls.some(call => call.args.slice(4).join(" ").includes(`provider detach ${scope.sandboxRef} ${providerName}`)), false);

    const priorStart = { ...first, expectedCapabilityHash: started.modelBrokerSessionReceipt.capabilityHash };
    t.mock.timers.setTime(Date.now() + 250_000);
    const refresh = modelBrokerSessionExecRequest("worker_model", "refresh", priorStart); hooks.brokerToken = refresh.token;
    const refreshed = await engine.executeStream({ scope: scopeInput, request: refresh.request, capabilityToken: "fixture-token" }, () => {});
    assert.notEqual(refreshed.modelBrokerSessionReceipt.capabilityHash, started.modelBrokerSessionReceipt.capabilityHash);
    assert.equal(refreshed.modelBrokerSessionReceipt.sessionKey, started.modelBrokerSessionReceipt.sessionKey);
    assert.ok(calls.some(call => call.args.slice(4).join(" ").includes(`provider update ${providerName}`) &&
      call.options.env.PAPERCLIP_SANDBOX_MODEL_TOKEN === refresh.token));
    assert.equal(calls.filter(call => call.args.slice(4).join(" ").includes("provider create --name")).length, 1);
    t.mock.timers.setTime(Date.now() + 51_000);
    const stillRunning = modelBrokerSessionExecRequest("worker_model", "refresh",
      { ...refresh, expectedCapabilityHash: refreshed.modelBrokerSessionReceipt.capabilityHash });
    const callsBeforeStillRunning = calls.length;
    const afterOriginalTtl = await engine.executeStream({ scope: scopeInput, request: stillRunning.request, capabilityToken: "fixture-token" }, () => {});
    const earlyRefreshCalls = calls.slice(callsBeforeStillRunning).map(call => call.args.slice(4).join(" "));
    assert.ok(earlyRefreshCalls.some(command => command.includes("provider list --page-size 128") && command.includes("--output json")),
      "early refresh keeps the prior credential only after observing the existing provider");
    assert.ok(earlyRefreshCalls.some(command => command.includes(`sandbox provider list ${scope.sandboxRef}`)),
      "early refresh confirms the provider remains attached to the exact sandbox");
    assert.equal(earlyRefreshCalls.some(command => command.includes(`provider update ${providerName}`)), false,
      "early refresh does not replace the still-valid provider");
    assert.equal(afterOriginalTtl.modelBrokerSessionReceipt.capabilityHash, refreshed.modelBrokerSessionReceipt.capabilityHash,
      "the provider session remains active after the original 300 second JWT lifetime");
    assert.equal(calls.filter(call => call.args.slice(4).join(" ").includes(`provider update ${providerName}`) && call.args.includes("--credential")).length, 1);
    const journal = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(journal.modelBrokerSessions[refresh.session.sessionKey].capabilityHash, refreshed.modelBrokerSessionReceipt.capabilityHash);
    assert.equal(JSON.stringify(journal.modelBrokerSessions[refresh.session.sessionKey]).includes(refresh.token), false);
    t.mock.timers.setTime(Date.now() + 499_000);
    const lastRefresh = modelBrokerSessionExecRequest("worker_model", "refresh",
      { ...refresh, expectedCapabilityHash: refreshed.modelBrokerSessionReceipt.capabilityHash });
    const atOriginalCeiling = await engine.executeStream({ scope: scopeInput, request: lastRefresh.request, capabilityToken: "fixture-token" }, () => {});
    assert.equal(atOriginalCeiling.modelBrokerSessionReceipt.expiresAt, first.session.sessionDeadlineAt,
      "a fresh JWT cannot extend the immutable original Native session ceiling");
    t.mock.timers.setTime(Date.parse(first.session.sessionDeadlineAt));
    const expiredRefresh = modelBrokerSessionExecRequest("worker_model", "refresh",
      { ...lastRefresh, expectedCapabilityHash: atOriginalCeiling.modelBrokerSessionReceipt.capabilityHash });
    await assert.rejects(engine.executeStream({ scope: scopeInput, request: expiredRefresh.request,
      capabilityToken: "fixture-token" }, () => {}), /sandbox_scope_changed/);
  }, hooks);
});

test("original Native start binding digest is journaled outside refresh/stop binding equality", async () => {
  const digest = "e".repeat(64);
  const hooks = {
    modelBrokerProfile,
    spawnProcess(_file, _args, options) {
      assert.equal(options.env.PAPERCLIP_SANDBOX_MODEL_TOKEN, undefined);
      const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = Readable.from([]); child.stderr = Readable.from([]);
      child.kill = () => true; setImmediate(() => child.emit("close", 0, null)); return child;
    },
  };
  await fixture(async ({ engine, enablePhysical, setPhase, root }) => {
    enablePhysical(); setPhase("Stopped");
    await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("start-binding-digest-policy", policyDocument) }, deadline());
    await engine.execute(randomUUID(), { ...input("start"), start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "start-binding-digest-start" } }, deadline());
    const scopeInput = { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId, cellGeneration: "1", sandboxRef: scope.sandboxRef };
    const first = modelBrokerSessionExecRequest("worker_model", "start", null, 300, digest);
    hooks.brokerToken = first.token;
    const started = await engine.executeStream({ scope: scopeInput, request: first.request, capabilityToken: "fixture-token" }, () => {});
    assert.equal(started.exitCode, 0);
    const saved = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    const entry = saved.modelBrokerSessions[first.session.sessionKey];
    assert.equal(entry.startBindingDigest, digest);
    assert.equal(entry.binding.startBindingDigest, undefined);
    assert.equal(JSON.stringify(entry).includes(first.token), false);
    const refresh = modelBrokerSessionExecRequest("worker_model", "refresh", {
      ...first, expectedCapabilityHash: started.modelBrokerSessionReceipt.capabilityHash,
    });
    assert.equal(refresh.request.modelBrokerSession.startBindingDigest, undefined);
  }, hooks);
});

test("managed Native session journal rejects a 1025th retained session and remains restartable", async () => {
  const hooks = {
    modelBrokerProfile,
    initialJournal: { version: 2, scopes: {}, commands: {}, modelBrokerSessions: Object.fromEntries(
      Array.from({ length: 1024 }, (_, index) => [`retained-${index}`, { state: "stopped" }]),
    ) },
    spawnProcess() {
      throw new Error("session capacity must be checked before spawning workload");
    },
  };
  await fixture(async ({ engine, enablePhysical, setPhase, calls, root, config, run }) => {
    enablePhysical(); setPhase("Stopped");
    await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("model-session-capacity", policyDocument) }, deadline());
    await engine.execute(randomUUID(), { ...input("start"), start: { policyHash,
      expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "model-session-capacity-start" } }, deadline());
    const { request, token } = modelBrokerSessionExecRequest("worker_model", "start");
    hooks.brokerToken = token;
    await assert.rejects(engine.executeStream({
      scope: { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId,
        cellGeneration: "1", sandboxRef: scope.sandboxRef },
      request, capabilityToken: "fixture-token",
    }, () => {}), /sandbox_scope_changed/);
    assert.equal(calls.some(call => call.args.slice(4).join(" ").includes("provider create --name awms-")), false);
    const saved = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(Object.keys(saved.modelBrokerSessions).length, 1024);
    const restarted = openShellHostEngine({ config, epoch: 1, root, run, spawnProcess: hooks.spawnProcess });
    await restarted.initialize();
  }, hooks);
});

test("managed Native early refresh rejects a detached provider instead of returning its cached receipt", async () => {
  let spawnCount = 0;
  const hooks = {
    modelBrokerProfile,
    spawnProcess() {
      spawnCount += 1;
      if (spawnCount > 1) throw new Error("a failed provider observation must prevent workload spawn");
      const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = Readable.from([]);
      child.stderr = Readable.from([]); child.kill = () => true; setImmediate(() => child.emit("close", 0, null)); return child;
    },
  };
  await fixture(async ({ engine, enablePhysical, setPhase, root, calls }) => {
    enablePhysical(); setPhase("Stopped");
    await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("model-session-detached", policyDocument) }, deadline());
    await engine.execute(randomUUID(), { ...input("start"), start: { policyHash,
      expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "model-session-detached-start" } }, deadline());
    const scopeInput = { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId,
      cellGeneration: "1", sandboxRef: scope.sandboxRef };
    const first = modelBrokerSessionExecRequest("worker_model", "start"); hooks.brokerToken = first.token;
    const started = await engine.executeStream({ scope: scopeInput, request: first.request, capabilityToken: "fixture-token" }, () => {});
    const providerName = `awms-${first.session.sessionKey.slice(0, 32)}`;
    const updateCountBeforeRefresh = calls.filter(call => call.args.slice(4).join(" ").includes(`provider update ${providerName}`)).length;
    hooks.hideModelSessionAttachment = true;
    const refresh = modelBrokerSessionExecRequest("worker_model", "refresh",
      { ...first, expectedCapabilityHash: started.modelBrokerSessionReceipt.capabilityHash }); hooks.brokerToken = refresh.token;
    await assert.rejects(engine.executeStream({ scope: scopeInput, request: refresh.request,
      capabilityToken: "fixture-token" }, () => {}), /sandbox_observation_unavailable/);
    assert.equal(spawnCount, 1);
    const saved = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(saved.modelBrokerSessions[first.session.sessionKey].state, "active");
    assert.equal(saved.modelBrokerSessions[first.session.sessionKey].capabilityHash, started.modelBrokerSessionReceipt.capabilityHash);
    assert.equal(calls.filter(call => call.args.slice(4).join(" ").includes(`provider update ${providerName}`)).length,
      updateCountBeforeRefresh);
  }, hooks);
});

test("managed Native conversation provider survives more than one JWT lifetime and fences cross-family refresh, missing state, and terminal resurrection", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const hooks = {
    modelBrokerProfile,
    spawnProcess(_file, _args, options) {
      assert.equal(options.env.PAPERCLIP_SANDBOX_MODEL_TOKEN, undefined);
      const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = Readable.from([]); child.stderr = Readable.from([]);
      child.kill = () => true; setImmediate(() => child.emit("close", 0, null)); return child;
    },
  };
  await fixture(async ({ engine, enablePhysical, setPhase, calls, root }) => {
    enablePhysical(); setPhase("Stopped");
    await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("conversation-session-policy", policyDocument) }, deadline());
    await engine.execute(randomUUID(), { ...input("start"), start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "conversation-session-start" } }, deadline());
    const scopeInput = { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId, cellGeneration: "1", sandboxRef: scope.sandboxRef };
    const first = modelBrokerSessionExecRequest("conversation_model", "start"); hooks.brokerToken = first.token;
    const started = await engine.executeStream({ scope: scopeInput, request: first.request, capabilityToken: "fixture-token" }, () => {});
    const priorStart = { ...first, expectedCapabilityHash: started.modelBrokerSessionReceipt.capabilityHash };
    const crossed = modelBrokerSessionExecRequest("worker_model", "refresh", priorStart); hooks.brokerToken = crossed.token;
    await assert.rejects(engine.executeStream({ scope: scopeInput, request: crossed.request, capabilityToken: "fixture-token" }, () => {}), /sandbox_scope_changed/);
    assert.equal(calls.some(call => call.args.slice(4).join(" ").includes(`provider update awms-${first.session.sessionKey.slice(0, 32)}`) &&
      call.args.includes("--credential")), false);

    t.mock.timers.setTime(Date.now() + 250_000);
    const refresh = modelBrokerSessionExecRequest("conversation_model", "refresh", priorStart); hooks.brokerToken = refresh.token;
    const refreshed = await engine.executeStream({ scope: scopeInput, request: refresh.request, capabilityToken: "fixture-token" }, () => {});
    t.mock.timers.setTime(Date.now() + 51_000);
    const afterOriginalTtlRequest = modelBrokerSessionExecRequest("conversation_model", "refresh",
      { ...refresh, expectedCapabilityHash: refreshed.modelBrokerSessionReceipt.capabilityHash });
    const afterOriginalTtl = await engine.executeStream({ scope: scopeInput, request: afterOriginalTtlRequest.request, capabilityToken: "fixture-token" }, () => {});
    assert.equal(afterOriginalTtl.modelBrokerSessionReceipt.capabilityHash, refreshed.modelBrokerSessionReceipt.capabilityHash,
      "conversation model provider remains live beyond the original 300 second JWT lifetime");
    const priorRefresh = { ...refresh, expectedCapabilityHash: afterOriginalTtl.modelBrokerSessionReceipt.capabilityHash };
    const providerName = `awms-${first.session.sessionKey.slice(0, 32)}`;
    t.mock.timers.setTime(Date.parse(first.session.sessionDeadlineAt) - 351_000);
    const beforeCeiling = modelBrokerSessionExecRequest("conversation_model", "refresh", priorRefresh); hooks.brokerToken = beforeCeiling.token;
    const nearFirst = await engine.executeStream({ scope: scopeInput, request: beforeCeiling.request, capabilityToken: "fixture-token" }, () => {});
    assert.ok(Date.parse(nearFirst.modelBrokerSessionReceipt.expiresAt) < Date.parse(first.session.sessionDeadlineAt));
    t.mock.timers.setTime(Date.parse(first.session.sessionDeadlineAt) - 100_000);
    const atCeiling = modelBrokerSessionExecRequest("conversation_model", "refresh",
      { ...beforeCeiling, expectedCapabilityHash: nearFirst.modelBrokerSessionReceipt.capabilityHash }); hooks.brokerToken = atCeiling.token;
    const ceilingRefresh = await engine.executeStream({ scope: scopeInput, request: atCeiling.request, capabilityToken: "fixture-token" }, () => {});
    assert.equal(ceilingRefresh.modelBrokerSessionReceipt.expiresAt, first.session.sessionDeadlineAt);
    const ceilingUpdateCount = calls.filter(call => call.args.slice(4).join(" ").includes(`provider update ${providerName}`)).length;
    const sameCeilingCallIndex = calls.length;
    t.mock.timers.setTime(Date.parse(first.session.sessionDeadlineAt) - 1_000);
    const sameCeiling = modelBrokerSessionExecRequest("conversation_model", "refresh",
      { ...atCeiling, expectedCapabilityHash: ceilingRefresh.modelBrokerSessionReceipt.capabilityHash }); hooks.brokerToken = sameCeiling.token;
    const sameCeilingReceipt = await engine.executeStream({ scope: scopeInput, request: sameCeiling.request, capabilityToken: "fixture-token" }, () => {});
    assert.deepEqual(sameCeilingReceipt.modelBrokerSessionReceipt, ceilingRefresh.modelBrokerSessionReceipt,
      "a same-expiry refresh near the immutable deadline leaves the observed provider valid until that deadline");
    assert.equal(calls.filter(call => call.args.slice(4).join(" ").includes(`provider update ${providerName}`)).length, ceilingUpdateCount,
      "same-expiry ceiling refresh does not update or delete the provider");
    const sameCeilingCalls = calls.slice(sameCeilingCallIndex).map(call => call.args.slice(4).join(" "));
    assert.ok(sameCeilingCalls.some(command => command.includes("provider list --page-size 128") && command.includes("--output json")));
    assert.ok(sameCeilingCalls.some(command => command.includes(`sandbox provider list ${scope.sandboxRef}`)));
    const priorCeiling = { ...atCeiling, expectedCapabilityHash: ceilingRefresh.modelBrokerSessionReceipt.capabilityHash };
    const stop = modelBrokerSessionExecRequest("conversation_model", "stop", priorCeiling);
    const stopped = await engine.executeStream({ scope: scopeInput, request: stop.request, capabilityToken: "fixture-token" }, () => {});
    assert.equal(stopped.modelBrokerSessionReceipt.capabilityHash, ceilingRefresh.modelBrokerSessionReceipt.capabilityHash);
    assert.equal(calls.some(call => call.args.slice(4).join(" ").includes(`provider detach ${scope.sandboxRef} ${providerName}`)), true);
    const duplicateStop = modelBrokerSessionExecRequest("conversation_model", "stop", priorCeiling);
    await engine.executeStream({ scope: scopeInput, request: duplicateStop.request, capabilityToken: "fixture-token" }, () => {});
    const createCountBeforeResurrection = calls.filter(call => call.args.slice(4).join(" ").includes("provider create --name")).length;
    const resurrection = modelBrokerSessionExecRequest("conversation_model", "refresh", priorCeiling);
    await assert.rejects(engine.executeStream({ scope: scopeInput, request: resurrection.request, capabilityToken: "fixture-token" }, () => {}), /sandbox_scope_changed/);
    assert.equal(calls.filter(call => call.args.slice(4).join(" ").includes("provider create --name")).length, createCountBeforeResurrection);
    const saved = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    delete saved.modelBrokerSessions[first.session.sessionKey];
    await writeFile(path.join(root, "openshell-journal.json"), JSON.stringify(saved));
    await engine.initialize();
    const orphanRefresh = modelBrokerSessionExecRequest("conversation_model", "refresh", priorCeiling);
    await assert.rejects(engine.executeStream({ scope: scopeInput, request: orphanRefresh.request, capabilityToken: "fixture-token" }, () => {}), /sandbox_scope_changed/);
    assert.equal(calls.filter(call => call.args.slice(4).join(" ").includes("provider create --name")).length, createCountBeforeResurrection);
  }, hooks);
});

test("an aborted managed model provider refresh remains unknown and can only be removed by scoped revocation", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const controller = new AbortController();
  let abortOnRefresh = false;
  let refreshUpdateSeen = false;
  let forbidExecSpawn = false;
  const hooks = {
    modelBrokerProfile,
    beforeCommand(_file, args) {
      const command = args.slice(4);
      if (abortOnRefresh && command[0] === "provider" && command[1] === "update" && command.includes("--credential-expires-at")) {
        refreshUpdateSeen = true;
        controller.abort();
      }
    },
    spawnProcess(_file, _args, options) {
      if (forbidExecSpawn) throw new Error("aborted refresh must not launch a command");
      assert.equal(options.env.PAPERCLIP_SANDBOX_MODEL_TOKEN, undefined);
      const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = Readable.from([]); child.stderr = Readable.from([]);
      child.kill = () => true; setImmediate(() => child.emit("close", 0, null)); return child;
    },
  };
  await fixture(async ({ engine, enablePhysical, setPhase, root, calls }) => {
    enablePhysical(); setPhase("Stopped");
    await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("model-session-abort-policy", policyDocument) }, deadline());
    await engine.execute(randomUUID(), { ...input("start"), start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "model-session-abort-start" } }, deadline());
    const scopeInput = { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId, cellGeneration: "1", sandboxRef: scope.sandboxRef };
    const first = modelBrokerSessionExecRequest("worker_model", "start"); hooks.brokerToken = first.token;
    const started = await engine.executeStream({ scope: scopeInput, request: first.request, capabilityToken: "fixture-token" }, () => {});
    t.mock.timers.setTime(Date.now() + 250_000);
    abortOnRefresh = true;
    forbidExecSpawn = true;
    const refresh = modelBrokerSessionExecRequest("worker_model", "refresh",
      { ...first, expectedCapabilityHash: started.modelBrokerSessionReceipt.capabilityHash }); hooks.brokerToken = refresh.token;
    await assert.rejects(engine.executeStream({ scope: scopeInput, request: refresh.request, capabilityToken: "fixture-token" }, () => {}, controller.signal), /exec_unknown/);
    assert.equal(refreshUpdateSeen, true, "the abort is injected during the credential update, after its effect may have occurred");
    const journal = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(journal.modelBrokerSessions[first.session.sessionKey].state, "updating");
    assert.equal(JSON.stringify(journal.modelBrokerSessions[first.session.sessionKey]).includes(refresh.token), false);
    assert.ok(calls.some(call => call.args.slice(4).join(" ").includes(`provider update awms-${first.session.sessionKey.slice(0, 32)}`)));
    await engine.execute(randomUUID(), input("revoke_providers"), deadline());
    const revoked = JSON.parse(await readFile(path.join(root, "openshell-journal.json"), "utf8"));
    assert.equal(revoked.modelBrokerSessions[first.session.sessionKey].state, "revoked");
    assert.equal(calls.some(call => call.args.slice(4).join(" ").includes(`provider detach ${scope.sandboxRef} awms-${first.session.sessionKey.slice(0, 32)}`)), true);
  }, hooks);
});

test("sandbox exec preflight cancellation and deadline expiry never spawn the CLI", async () => {
  let holdInspect = false, enteredInspect = () => {}, releaseInspect = () => {}, inspectRelease = Promise.resolve();
  let spawnCount = 0;
  const hooks = {
    async beforeCommand(file, args) {
      if (holdInspect && file === "docker" && args[0] === "inspect") {
        holdInspect = false;
        enteredInspect();
        await inspectRelease;
      }
    },
    spawnProcess() { spawnCount++; throw new Error("must-not-spawn"); },
  };
  const holdNextInspection = () => {
    const inspectEntered = new Promise(resolve => { enteredInspect = resolve; });
    inspectRelease = new Promise(resolve => { releaseInspect = resolve; });
    holdInspect = true;
    return inspectEntered;
  };
  await fixture(async ({ engine, enablePhysical, setPhase }) => {
    enablePhysical();
    setPhase("Stopped");
    await engine.execute(randomUUID(), {
      ...input("apply"),
      admission: hostAdmission("exec-preflight-policy", policyDocument),
    }, deadline());
    await engine.execute(randomUUID(), {
      ...input("start"),
      start: { policyHash, expiresAt: new Date(Date.now() + 50000).toISOString(), idempotencyKey: "exec-preflight-start" },
    }, deadline());

    const abortedInspection = holdNextInspection();
    const controller = new AbortController();
    const abortedRequest = engine.executeStream({
      scope: { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId, cellGeneration: "1", sandboxRef: scope.sandboxRef },
      request: execRequest(), capabilityToken: "fixture-token",
    }, () => {}, controller.signal);
    await abortedInspection;
    controller.abort();
    releaseInspect();
    await assert.rejects(abortedRequest, /exec_unknown/);
    assert.equal(spawnCount, 0);

    const expiredInspection = holdNextInspection();
    const expiredDeadline = new Date(Date.now() + 1000).toISOString();
    const expiredRequest = engine.executeStream({
      scope: { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId, cellGeneration: "1", sandboxRef: scope.sandboxRef },
      request: execRequest(expiredDeadline), capabilityToken: "fixture-token",
    }, () => {});
    await expiredInspection;
    await new Promise(resolve => setTimeout(resolve, 1100));
    releaseInspect();
    await assert.rejects(expiredRequest, /exec_timeout/);
    assert.equal(spawnCount, 0);
  }, hooks);
});


test("model broker mechanism requires one exact current model route and its verified immutable caller vector", () => {
  const runtime = installedRuntimeProfiles();
  const profile = { ...runtime.model, origin: runtime.selection.model.origin,
    binaries: runtime.selection.model.binaries };
  const origin = new URL(profile.origin);
  const modelEndpoint = { host: origin.hostname, port: Number(origin.port || 443), protocol: "rest", enforcement: "enforce",
    rules: [{ allow: { method: "POST", path: "/runtime-tools/model/v1/messages" } }] };
  const exactModelPolicy = { name: "aw_model", binaries: profile.binaries.map(path => ({ path })), endpoints: [modelEndpoint] };
  const document = { ...policyDocument, network_policies: { aw_model: exactModelPolicy } };
  assert.equal(hasExactManagedModelBrokerPolicy(document, profile), true,
    "the exact inspected model profile can support credentialBrokering after its Q canary route is revoked");

  const wrongPath = structuredClone(document);
  wrongPath.network_policies.aw_model.endpoints[0].rules[0].allow.path = "/runtime-tools/model/v1/other";
  assert.equal(hasExactManagedModelBrokerPolicy(wrongPath, profile), false);
  const wrongBinary = structuredClone(document);
  wrongBinary.network_policies.aw_model.binaries = [{ path: "/usr/bin/curl" }];
  assert.equal(hasExactManagedModelBrokerPolicy(wrongBinary, profile), false,
    "a different network caller cannot inherit the installed model profile's route");
  const broadRoute = structuredClone(document);
  broadRoute.network_policies.aw_model.endpoints[0].rules[0].allow.path = "/";
  assert.equal(hasExactManagedModelBrokerPolicy(broadRoute, profile), false);
  const duplicate = structuredClone(document);
  duplicate.network_policies.aw_model_copy = structuredClone(duplicate.network_policies.aw_model);
  assert.equal(hasExactManagedModelBrokerPolicy(duplicate, profile), false);
  assert.equal(hasExactManagedModelBrokerPolicy(document, { ...profile, origin: "http://gateway.example.test" }), false);
});

test("model-only business policy retains credentialBrokering only through its current exact model profile", async () => {
  const qualification = qualificationCredentialFixture();
  const runtime = installedRuntimeProfiles();
  const origin = new URL(runtime.selection.model.origin);
  const modelDocument = { ...policyDocument,
    filesystem_policy: { ...policyDocument.filesystem_policy,
      read_only: [...new Set([...policyDocument.filesystem_policy.read_only, "/.openshell/runtime/openshell-sandbox"])],
      read_write: [defaultQualificationFixtures.filesystem.workdirPath] },
    network_policies: { model: {
    name: "model", binaries: runtime.model.binaries.map(value => ({ path: value.path })),
    endpoints: [{ host: origin.hostname, port: Number(origin.port || 443), protocol: "rest", enforcement: "enforce",
      rules: [{ allow: { method: "POST", path: "/runtime-tools/model/v1/messages" } }] }],
  } } };
  await fixture(async ({ engine, setEffectivePolicy }) => {
    const initial = hostProvisioning("qualification", { expiresAt: new Date(Date.now() + 600_000).toISOString(),
      qualificationFixtures: { credential: qualification.metadata } });
    await prepareProvisioned(engine, initial);
    const qualified = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(qualified.success, true, JSON.stringify(qualified));
    assert.equal(qualified.reply.capabilities.credentialBrokering, true);
    await engine.execute(randomUUID(), input("stop"), deadline());

    const admission = hostProvisioning("admission", { document: modelDocument,
      expiresAt: new Date(Date.now() + 300_000).toISOString() });
    await prepareProvisioned(engine, admission);
    const applied = await engine.execute(randomUUID(), { ...input("apply"), admission: {
      policyHash: admission.provisioning.policyHash, expiresAt: admission.provisioning.expiresAt,
      idempotencyKey: "fixture-model-only-apply", document: modelDocument,
      resourceLimits: admission.provisioning.resourceLimits,
    } }, deadline());
    assert.equal(applied.success, true, JSON.stringify(applied));
    const current = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(current.success, true, JSON.stringify(current));
    assert.equal(current.reply.capabilities.credentialBrokering, true,
      "model-only admission must not depend on reusing the revoked qualification App route");

    const drifted = structuredClone(modelDocument);
    drifted.network_policies.model.endpoints[0].rules[0].allow.path = "/runtime-tools/model/v1/other";
    setEffectivePolicy(drifted);
    const afterDrift = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(afterDrift.reply.capabilities?.credentialBrokering ?? false, false,
      "a different current model route cannot inherit the sampled mechanism");
  }, { physical: true, running: true, qualificationCredentialProfile: qualification.profile,
    qualificationFixtures: { credential: qualification.metadata }, runtimeBrokerProfiles: runtime.selection,
    installedProfiles: runtime.installed,
    resourceConfig: { NanoCpus: 1_000_000_000, Memory: 67108864, MemorySwap: 67108864,
      PidsLimit: 16, StorageOpt: { size: "33554432B" } }, cpuMax: "100000 100000", pidsLimit: 16,
    probeOutputs: { "runtime-seccomp-probe": JSON.stringify({ version: 1, profile: "openshell-linux-built-in-seccomp-v1",
      getpid: "allowed", memfd_create: "denied", denied_errno: "EPERM" }) } });
});

test("stopped Native erasure DTO is one-purpose, strict, and echoes both absence proofs", () => {
  const { requesterUserId: _requester, ...base } = input("erase_native_session");
  const nativeSessionErasure = {
    schema: "paperclip.remote-native-session-erasure.v1",
    startBindingDigest: "1".repeat(64), sessionKey: "2".repeat(64), leaseId: randomUUID(),
    taskRoot: "/workspace/task", sessionDigest: "3".repeat(64), policyHash: "4".repeat(64),
    sandboxId: randomUUID(), containerId: "a".repeat(64), imageDigest: base.imageDigest,
    dockerEngineIdHash: "5".repeat(64), cellGeneration: "1", runId: randomUUID(), runnerInstanceId: randomUUID(),
  };
  const valid = { ...base, nativeSessionErasure };
  assert.equal(sandboxHostRequestSchema.safeParse(valid).success, true);
  assert.equal(sandboxHostRequestSchema.safeParse({ ...valid, nativeSessionErasure: { ...nativeSessionErasure,
    hostPath: "/var/lib/docker/overlay2" } }).success, false);
  assert.equal(sandboxHostRequestSchema.safeParse({ ...valid, requesterUserId: "human" }).success, false,
    "cleanup identity is server-owned and must not borrow a Human actor field");
  assert.equal(sandboxHostRequestSchema.safeParse({ ...valid, action: "stop" }).success, false);
  const reply = { action: "erase_native_session", erased: true, schema: nativeSessionErasure.schema,
    startBindingDigest: nativeSessionErasure.startBindingDigest, sessionKey: nativeSessionErasure.sessionKey,
    leaseId: nativeSessionErasure.leaseId, sessionDigest: nativeSessionErasure.sessionDigest,
    policyHash: nativeSessionErasure.policyHash, sandboxId: nativeSessionErasure.sandboxId,
    containerId: nativeSessionErasure.containerId, imageDigest: nativeSessionErasure.imageDigest,
    dockerEngineIdHash: nativeSessionErasure.dockerEngineIdHash, cellGeneration: nativeSessionErasure.cellGeneration,
    runId: nativeSessionErasure.runId, runnerInstanceId: nativeSessionErasure.runnerInstanceId,
    upperLayerAbsent: true, mergedViewAbsent: true, stoppedBefore: true, stoppedAfter: true };
  assert.equal(sandboxHostReplySchema.safeParse(reply).success, true);
  assert.equal(sandboxHostReplySchema.safeParse({ ...reply, mergedViewAbsent: false }).success, false);
});

test("Docker archive absence requires a live root control and Docker inspect uses Config.User", () => {
  assert.equal(archiveStatusProvesAbsence(200, 404), true, "live archive root plus missing exact session proves absence");
  assert.equal(archiveStatusProvesAbsence(200, 200), false, "an existing target is not absent");
  assert.throws(() => archiveStatusProvesAbsence(404, 404), /sandbox_observation_unavailable/,
    "a missing container root is not a path-absence proof");
  assert.throws(() => archiveStatusProvesAbsence(200, 500), /sandbox_observation_unavailable/,
    "unsupported archive responses fail closed");
  assert.equal(dockerInspectRunAsMatches({ Config: { User: "1000:1000" }, HostConfig: { User: "0:0" } }, "1000:1000"), true);
  assert.equal(dockerInspectRunAsMatches({ HostConfig: { User: "1000:1000" } }, "1000:1000"), false,
    "Docker reports the effective container user in Config.User");
});

test("fixed stopped-session eraser uses nofollow traversal and refuses identity drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aw-native-session-erase-"));
  try {
    const proofDir = path.join(root, "proof");
    const taskRoot = "/workspace/task";
    const sessions = path.join(proofDir, taskRoot.slice(1), ".paperclip-runtime", "paperclip-runner", "sessions");
    const mountinfo = path.join(root, "mountinfo");
    await mkdir(sessions, { recursive: true });
    await writeFile(mountinfo, `36 25 0:32 / ${proofDir} rw - bind /fixture rw\n37 25 0:33 / /sessions rw - bind /fixture rw\n`);
    let script = NATIVE_SESSION_UPPER_ERASE_SCRIPT
      .replaceAll('"/proof/"', JSON.stringify(`${proofDir}/`))
      .replaceAll('"/proof"', JSON.stringify(proofDir))
      .replaceAll('"/proc/self/mountinfo"', JSON.stringify(mountinfo))
      .replace('fs.openSync("/sessions", C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW | C.O_CLOEXEC)',
        'fs.openSync("/proc/self/fd/" + String(proofRoot), C.O_RDONLY | C.O_DIRECTORY | C.O_CLOEXEC)');
    const digest = "d".repeat(64);
    const run = async (parentStat, expected = digest, expiresAt = Date.now() + 30_000) => spawnSync(process.execPath,
      ["-e", script, taskRoot, expected, "erase", String(parentStat.dev), String(parentStat.ino), String(expiresAt)], { encoding: "utf8" });
    const target = path.join(sessions, digest);
    await mkdir(path.join(target, "nested"), { recursive: true });
    await writeFile(path.join(target, "nested", "state"), "private");
    const outside = path.join(root, "outside");
    await writeFile(outside, "must survive");
    await symlink(outside, path.join(target, "nested", "link"));
    const parentStat = await stat(sessions);
    const expired = await run(parentStat, digest, Date.now() - 1);
    assert.notEqual(expired.status, 0, "the helper itself enforces the signed absolute expiry");
    assert.equal(await readFile(path.join(target, "nested", "state"), "utf8"), "private");
    const erased = await run(parentStat);
    assert.equal(erased.status, 0, erased.stderr);
    await assert.rejects(lstat(target));
    assert.equal(await readFile(outside, "utf8"), "must survive");

    await mkdir(target);
    const protectedFile = path.join(target, "state");
    await writeFile(protectedFile, "keep");
    const wrongIdentity = await run({ dev: parentStat.dev, ino: String(Number(parentStat.ino) + 1) });
    assert.notEqual(wrongIdentity.status, 0);
    assert.equal(await readFile(protectedFile, "utf8"), "keep");

    await rm(target, { recursive: true, force: true });
    await symlink(outside, target);
    const symlinkTarget = await run(parentStat);
    assert.notEqual(symlinkTarget.status, 0);
    assert.equal(await readFile(outside, "utf8"), "must survive");

    await rm(target, { recursive: true, force: true });
    await mkdir(target);
    for (const name of ["entry-a", "entry-b", "entry-c"])
      await writeFile(path.join(target, name), "bounded entry");
    const cappedScript = script.replace("if (++count > 50000) fail();", "if (++count > 2) fail();");
    const capped = spawnSync(process.execPath,
      ["-e", cappedScript, taskRoot, digest, "erase", String(parentStat.dev), String(parentStat.ino), String(Date.now() + 30_000)],
      { encoding: "utf8" });
    assert.notEqual(capped.status, 0, "the same per-entry counter fails closed at a small test threshold");
    assert.equal((await readdir(target)).length, 2,
      "the threshold counts regular-file directory entries, not only recursive directories");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("erase_native_session action runs the pinned helper against one stopped Docker target and rejects unknown-session replay", async () => {
  const hostRoot = await mkdtemp(path.join(os.tmpdir(), "aw-native-erasure-action-"));
  const dockerRoot = path.join(hostRoot, "docker"), layerId = "f".repeat(64);
  const upperDir = path.join(dockerRoot, "overlay2", layerId, "diff");
  const mergedDir = path.join(dockerRoot, "overlay2", layerId, "merged");
  const taskRoot = "/workspace/project", startBindingDigest = "a".repeat(64);
  const first = modelBrokerSessionExecRequest("worker_model", "start", null, 300, startBindingDigest);
  const sessionDigest = first.session.nativeSessionIdDigest;
  const sessionsPath = path.join(upperDir, taskRoot.slice(1), ".paperclip-runtime", "paperclip-runner", "sessions");
  const targetPath = path.join(sessionsPath, sessionDigest), neighborPath = path.join(sessionsPath, "neighbor-session");
  const hostProcRoot = path.join(hostRoot, "proc"), namespace = "mnt:[4026531840]";
  const hostContainerId = "b".repeat(64), hostImageId = "sha256:" + "9".repeat(64);
  const hostImageRef = "fixture.invalid/aw-runtime-host@sha256:" + "8".repeat(64);
  const helpersByName = new Map(), helpersById = new Map(), archiveCalls = [], dockerCommandTrace = [];
  const previousHostname = process.env.HOSTNAME;
  const originalHttpRequest = http.request;
  process.env.HOSTNAME = hostContainerId.slice(0, 12);
  const procMountInfo = "36 25 0:32 / / rw - overlay overlay rw\n";
  try {
    await mkdir(upperDir, { recursive: true });
    await mkdir(mergedDir, { recursive: true });
    await mkdir(path.join(targetPath, "nested"), { recursive: true });
    await writeFile(path.join(targetPath, "nested", "session-state"), "erase this session");
    await mkdir(neighborPath, { recursive: true });
    await writeFile(path.join(neighborPath, "keep"), "neighbor survives");
    await mkdir(path.join(hostProcRoot, "1", "ns"), { recursive: true });
    await mkdir(path.join(hostProcRoot, "100", "ns"), { recursive: true });
    await mkdir(path.join(hostProcRoot, "101", "ns"), { recursive: true });
    await symlink(namespace, path.join(hostProcRoot, "1", "ns", "mnt"));
    await symlink(namespace, path.join(hostProcRoot, "100", "ns", "mnt"));
    await symlink("mnt:[4026531999]", path.join(hostProcRoot, "101", "ns", "mnt"));
    await writeFile(path.join(hostProcRoot, "100", "comm"), "dockerd\n");
    await writeFile(path.join(hostProcRoot, "101", "comm"), "dockerd\n");
    await writeFile(path.join(hostProcRoot, "1", "mountinfo"), procMountInfo);
    await writeFile(path.join(hostProcRoot, "100", "mountinfo"), procMountInfo);
    await writeFile(path.join(hostProcRoot, "101", "mountinfo"), "37 25 0:32 / / rw - overlay other rw\n");

    const targetImageId = "sha256:" + "e".repeat(64);
    const targetImageDigest = input("prepare").imageDigest;
    const erasureDocker = { upperDir, mergedDir };
    const hooks = {
      erasureDocker, hostProcRoot, modelBrokerProfile, physical: true, phase: "Stopped", running: false,
      resourceConfig: { NanoCpus: 1_500_000_000, Memory: 536_870_912, MemorySwap: 536_870_912,
        PidsLimit: 128, StorageOpt: { size: "1073741824B" } },
      spawnProcess(_file, _args, options) {
        assert.equal(options.env.PAPERCLIP_SANDBOX_MODEL_TOKEN, undefined);
        const child = new EventEmitter();
        child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
        child.stdout = Readable.from([]); child.stderr = Readable.from([]);
        child.kill = () => true;
        child.stdin.on("finish", () => setImmediate(() => child.emit("close", 0, null)));
        return child;
      },
      dockerCommand: async ({ args, state }) => {
        dockerCommandTrace.push(`${args[0] ?? ""}/${args[1] ?? ""}`);
        if (args[0] === "version" && args[2] === "{{.Server.APIVersion}}")
          return { handled: true, value: { stdout: "1.45\n" } };
        if (args[0] === "info" && args[2] === "{{.DockerRootDir}}")
          return { handled: true, value: { stdout: `${dockerRoot}\n` } };
        if (args[0] === "info" && args[2] === "{{.ID}}")
          return { handled: true, value: { stdout: "fixture-docker-engine\n" } };
        if (args[0] === "image" && args[1] === "inspect" && args[2] === hostImageId)
          return { handled: true, value: { stdout: JSON.stringify([{ Id: hostImageId, RepoDigests: [hostImageRef] }]) } };
        if (args[0] === "inspect" && args[1] === "aw-runtime-host")
          return { handled: true, value: { stdout: JSON.stringify([{ Id: hostContainerId, Image: hostImageId,
            Config: { Image: hostImageRef }, State: { Running: true } }]) } };
        if (args[0] === "image" && args[1] === "inspect" && args[2] === targetImageId)
          return { handled: true, value: { stdout: JSON.stringify([{ Id: targetImageId, RepoDigests: [targetImageDigest] }]) } };
        if (args[0] === "ps" && args.some(value => String(value).startsWith("name=^/"))) {
          const filter = args.find(value => String(value).startsWith("name=^/"));
          const name = String(filter).slice("name=^/".length).replace(/\$$/, "");
          const helper = helpersByName.get(name);
          return { handled: true, value: { stdout: helper ? `${helper.Id}\n` : "" } };
        }
        if (args[0] === "inspect" && helpersById.has(args[1]))
          return { handled: true, value: { stdout: JSON.stringify([helpersById.get(args[1])]) } };
        if (args[0] === "create" && args.includes("--name")) {
          const name = args[args.indexOf("--name") + 1];
          if (!name.startsWith("aw-native-lower-") && !name.startsWith("aw-native-proof-") && !name.startsWith("aw-native-erase-"))
            return { handled: false };
          const id = createHash("sha256").update(`native-erasure-helper:${name}`).digest("hex");
          const imagePosition = args.indexOf("--entrypoint") >= 0 ? args.indexOf("--entrypoint") + 2 : args.length - 1;
          const image = args[imagePosition];
          const mounts = [];
          for (let i = 0; i < args.length; i++) if (args[i] === "--mount") {
            const options = Object.fromEntries(args[i + 1].split(",").map(piece => {
              const at = piece.indexOf("="); return at < 0 ? [piece, true] : [piece.slice(0, at), piece.slice(at + 1)];
            }));
            mounts.push({ Type: options.type, Source: options.src, Destination: options.dst, RW: options.readonly !== true });
          }
          const cmd = args[imagePosition + 1] ? args.slice(imagePosition + 1) : [];
          const option = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
          const config = { Image: image, User: option("--user"), Env: [], Labels: { "aw.native_session_erasure": "true", "aw.native_session_erasure_name": name },
            ...(args.includes("--entrypoint") ? { Entrypoint: [args[args.indexOf("--entrypoint") + 1] ] } : {}), Cmd: cmd };
          const info = { Id: id, Name: `/${name}`, Image: image, Config: config, Mounts: mounts,
            HostConfig: { NetworkMode: option("--network"), ReadonlyRootfs: args.includes("--read-only"),
              Privileged: false, CapAdd: [], CapDrop: args.includes("--cap-drop") ? [option("--cap-drop")] : [],
              SecurityOpt: args.includes("--security-opt") ? [option("--security-opt")] : [],
              PidsLimit: Number(option("--pids-limit") ?? 1), Memory: Number(option("--memory") ?? 16_777_216),
              MemorySwap: Number(option("--memory-swap") ?? 16_777_216), CpuPeriod: Number(option("--cpu-period") ?? 100_000),
              CpuQuota: Number(option("--cpu-quota") ?? 25_000), UsernsMode: "" },
            State: { Status: "created", Running: false, ExitCode: null } };
          helpersByName.set(name, info); helpersById.set(id, info);
          return { handled: true, value: { stdout: `${id}\n` } };
        }
        if (args[0] === "start" && helpersById.has(args[1])) {
          const info = helpersById.get(args[1]);
          info.State = { Status: "running", Running: true, ExitCode: null };
          if (info.Config.Cmd[0] === "-e") {
            const proof = info.Mounts.find(value => value.Destination === "/proof")?.Source;
            const sessionMount = info.Mounts.find(value => value.Destination === "/sessions")?.Source;
            const helperName = info.Config.Labels["aw.native_session_erasure_name"];
            const fakeMountInfo = path.join(hostRoot, `${helperName}.mountinfo`);
            const mountRows = ["36 25 0:32 / /proof rw - bind fixture rw"];
            if (sessionMount) mountRows.push("37 25 0:33 / /sessions rw - bind fixture rw");
            await writeFile(fakeMountInfo, `${mountRows.join("\n")}\n`);
            let script = info.Config.Cmd[1]
              .replace('fs.openSync("/proof",', `fs.openSync(${JSON.stringify(proof)},`)
              .replace('fs.openSync("/sessions",', `fs.openSync(${JSON.stringify(sessionMount ?? path.join(hostRoot, "unused-sessions"))},`)
              .replace('fs.readFileSync("/proc/self/mountinfo",', `fs.readFileSync(${JSON.stringify(fakeMountInfo)},`);
            const result = spawnSync(process.execPath, ["-e", script, ...info.Config.Cmd.slice(2)], { encoding: "utf8", timeout: 10_000 });
            info.stdout = result.stdout ?? "";
            info.stderr = result.stderr ?? "";
            info.State = { Status: "exited", Running: false, ExitCode: result.status ?? 1, FinishedAt: new Date().toISOString() };
          } else {
            info.State = { Status: "created", Running: false, ExitCode: null };
          }
          return { handled: true, value: { stdout: "" } };
        }
        if (args[0] === "wait" && helpersById.has(args[1]))
          return { handled: true, value: { stdout: `${helpersById.get(args[1]).State.ExitCode ?? 0}\n` } };
        if (args[0] === "logs" && helpersById.has(args.at(-1)))
          return { handled: true, value: { stdout: helpersById.get(args.at(-1)).stdout ?? "" } };
        if (args[0] === "rm" && helpersById.has(args.at(-1))) {
          const info = helpersById.get(args.at(-1)); helpersById.delete(info.Id); helpersByName.delete(info.Name.slice(1));
          return { handled: true, value: { stdout: "" } };
        }
        if (args[0] === "kill" && helpersById.has(args[1])) {
          const info = helpersById.get(args[1]);
          info.State = { Status: "exited", Running: false, ExitCode: 137, FinishedAt: new Date().toISOString() };
          return { handled: true, value: { stdout: "" } };
        }
        return { handled: false };
      },
    };
    http.request = (options, callback) => {
      const request = new EventEmitter();
      request.end = () => { void (async () => {
        const url = new URL(options.path, "http://docker");
        const segments = url.pathname.split("/");
        const containerId = segments[3];
        const archivePath = url.searchParams.get("path");
        archiveCalls.push({ containerId, archivePath });
        let statusCode = segments.length === 5 && /^v1\.[0-9]+$/.test(segments[1]) &&
          segments[2] === "containers" && segments[4] === "archive" ? 200 : 404;
        if (statusCode === 200 && archivePath !== "/" && containerId === "d".repeat(64)) {
          try { await lstat(path.join(upperDir, archivePath.slice(1))); }
          catch (error) { if (error.code === "ENOENT") statusCode = 404; else throw error; }
        } else if (statusCode === 200 && archivePath !== "/") statusCode = 404;
        const response = new PassThrough(); response.statusCode = statusCode;
        callback(response); response.end(); request.emit("close");
      })(); };
      request.destroy = error => { if (error) request.emit("error", error); request.emit("close"); };
      return request;
    };

    await fixture(async ({ engine, root, enablePhysical, setPhase, sandboxId, containerId }) => {
      enablePhysical(); setPhase("Stopped");
      const applied = await engine.execute(randomUUID(), { ...input("apply"), admission: hostAdmission("erasure-action-policy", policyDocument) }, deadline());
      assert.equal(applied.success, true, JSON.stringify(applied));
      const startedWorkload = await engine.execute(randomUUID(), { ...input("start"), start: {
        policyHash, expiresAt: new Date(Date.now() + 50_000).toISOString(), idempotencyKey: "erasure-action-start" } }, deadline());
      assert.equal(startedWorkload.success, true, JSON.stringify(startedWorkload));
      hooks.brokerToken = first.token;
      const startReceipt = await engine.executeStream({
        scope: { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId,
          cellGeneration: scope.cellGeneration, sandboxRef: scope.sandboxRef },
        request: first.request, capabilityToken: "fixture-token",
      }, () => {});
      assert.ok(startReceipt.modelBrokerSessionReceipt?.capabilityHash);
      const stopSession = modelBrokerSessionExecRequest("worker_model", "stop", {
        ...first, expectedCapabilityHash: startReceipt.modelBrokerSessionReceipt.capabilityHash,
      });
      const stopReceipt = await engine.executeStream({
        scope: { companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId,
          cellGeneration: scope.cellGeneration, sandboxRef: scope.sandboxRef },
        request: stopSession.request, capabilityToken: "fixture-token",
      }, () => {});
      assert.equal(stopReceipt.exitCode, 0);
      const stopped = await engine.execute(randomUUID(), input("stop"), deadline());
      assert.equal(stopped.success, true, JSON.stringify(stopped));

      const journalFile = path.join(root, "openshell-journal.json");
      const journal = JSON.parse(await readFile(journalFile, "utf8"));
      const scopeEntry = journal.scopes[scope.bindingId];
      assert.equal(scopeEntry.sandboxId, sandboxId());
      assert.equal(scopeEntry.containerId, containerId());
      assert.ok(scopeEntry.policy?.policyHash);
      // Model actual prior server-owned admission/workload creation metadata in
      // this isolated Host-action fixture; the session itself above was created
      // and stopped through the real engine lifecycle.
      const creation = hostProvisioning("admission", { document: policyDocument }).provisioning;
      scopeEntry.creation = {
        purpose: "admission", imageDigest: input("prepare").imageDigest,
        requestId: creation.requestId, provisioningHash: creation.provisioningHash,
        operationKey: creation.operationKey, operationKeyHash: createHash("sha256").update(creation.operationKey).digest("hex"),
        bindingVersion: creation.bindingVersion, policyHash: scopeEntry.policy.policyHash,
        document: canonical(policyDocument), resourceLimits: canonical(resourceLimits),
        expiresAt: creation.expiresAt, idleUntilUnixSeconds: creation.idleUntilUnixSeconds,
        sandboxId: sandboxId(), containerId: containerId(), workdirPath: taskRoot,
      };
      await writeFile(journalFile, JSON.stringify(journal), { mode: 0o600 });
      await engine.initialize(); // reload the durable admission fixture as a real host process restart

      const descriptor = {
        schema: "paperclip.remote-native-session-erasure.v1", startBindingDigest, sessionKey: first.session.sessionKey,
        leaseId: first.session.leaseId, taskRoot, sessionDigest,
        policyHash: first.request.policyHash, sandboxId: sandboxId(), containerId: containerId(),
        imageDigest: first.request && input("prepare").imageDigest,
        dockerEngineIdHash: createHash("sha256").update("fixture-docker-engine").digest("hex"),
        cellGeneration: scope.cellGeneration, runId: first.request.runId, runnerInstanceId: first.session.runnerInstanceId,
      };
      const { requesterUserId: _requester, ...eraseBase } = input("erase_native_session");
      const erasureRequest = { ...eraseBase, nativeSessionErasure: descriptor };
      const eraseCommandId = randomUUID();
      const erased = await engine.execute(eraseCommandId, erasureRequest, deadline());
      const actionJournal = JSON.parse(await readFile(journalFile, "utf8"));
      const actionRecord = actionJournal.commands[eraseCommandId]?.nativeSessionErasure;
      const helperStateFacts = [...helpersById.values()].map(info => ({
        role: info.Config?.Labels?.["aw.native_session_erasure_name"]?.startsWith("aw-native-proof-") ? "proof" : "erase",
        status: info.State?.Status ?? null, exitCode: Number.isInteger(info.State?.ExitCode) ? info.State.ExitCode : null,
        outputClass: info.stdout === "erased\n" ? "erased" :
          info.stdout === "already_absent\n" ? "already_absent" :
          typeof info.stdout === "string" && info.stdout.startsWith("{\"parentPresent\":") ? "proof_json" :
          typeof info.stdout === "string" ? "other" : null,
      }));
      assert.equal(erased.success, true, JSON.stringify({ erased, phase: actionRecord?.phase ?? null,
        helperNamePresent: Boolean(actionRecord?.helperName), helperIdPresent: Boolean(actionRecord?.helperId),
        lowerImageAbsent: actionRecord?.lowerImageAbsent === true, upperProofPresent: Boolean(actionRecord?.upperProof),
        upperHelperExitCode: actionRecord?.upperHelperExitCode ?? null,
        helperStateFacts, dockerCommandTrace }));
      assert.deepEqual(erased.reply, {
        action: "erase_native_session", erased: true, schema: descriptor.schema,
        startBindingDigest, sessionKey: descriptor.sessionKey, leaseId: descriptor.leaseId,
        sessionDigest, policyHash: descriptor.policyHash, sandboxId: descriptor.sandboxId,
        containerId: descriptor.containerId, imageDigest: descriptor.imageDigest,
        dockerEngineIdHash: descriptor.dockerEngineIdHash, cellGeneration: descriptor.cellGeneration,
        runId: descriptor.runId, runnerInstanceId: descriptor.runnerInstanceId,
        upperLayerAbsent: true, mergedViewAbsent: true, stoppedBefore: true, stoppedAfter: true,
      });
      await assert.rejects(lstat(targetPath), { code: "ENOENT" });
      assert.equal(await readFile(path.join(neighborPath, "keep"), "utf8"), "neighbor survives");
      assert.ok(archiveCalls.some(value => value.containerId === descriptor.containerId && value.archivePath === "/"),
        "the Docker archive root control must be observed on the exact original container");
      assert.ok(archiveCalls.some(value => value.containerId === descriptor.containerId && value.archivePath === targetPath.replace(upperDir, "")),
        "the original merged view must report the exact session path absent after deletion");
      assert.equal([...helpersByName.keys()].length, 0, "all one-use helper containers are removed after verified completion");

      const expiredCommandId = randomUUID();
      const expiredJournal = JSON.parse(await readFile(journalFile, "utf8"));
      const expiredOperation = {
        sessionKey: descriptor.sessionKey, startBindingDigest, commandId: expiredCommandId,
        phase: "helper_start_claimed", lowerImageAbsent: true,
        upperProof: { parentPresent: true, parentDev: "1", parentIno: "1", present: false },
      };
      expiredJournal.commands[expiredCommandId] = {
        requestHash: createHash("sha256").update(JSON.stringify(erasureRequest)).digest("hex"),
        result: null, operationDeadlineAt: new Date(Date.now() - 5_000).toISOString(),
        nativeSessionErasure: expiredOperation,
      };
      expiredJournal.modelBrokerSessions[descriptor.sessionKey].erasure = expiredOperation;
      await writeFile(journalFile, JSON.stringify(expiredJournal), { mode: 0o600 });
      await engine.initialize(); // recover an expired claimed command after a host restart
      const beforeExpired = archiveCalls.length, helperCountBeforeExpired = helpersByName.size;
      const expiredReplay = await engine.execute(expiredCommandId, erasureRequest, deadline());
      const afterExpiredJournal = JSON.parse(await readFile(journalFile, "utf8"));
      assert.equal(expiredReplay.success, false);
      assert.equal(expiredReplay.errorCode, "sandbox_observation_unavailable");
      assert.equal(afterExpiredJournal.commands[expiredCommandId]?.nativeSessionErasure?.phase, "reconciled");
      assert.ok(archiveCalls.length > beforeExpired, "expired restart may inspect the exact target but must not infer completion");
      assert.equal(helpersByName.size, helperCountBeforeExpired, "expired ambiguous work must not start another erasure helper");

      const beforeUnknown = archiveCalls.length;
      const unknown = { ...descriptor, sessionKey: "f".repeat(64), startBindingDigest: "9".repeat(64) };
      const denied = await engine.execute(randomUUID(), { ...erasureRequest, nativeSessionErasure: unknown }, deadline());
      assert.equal(denied.success, false);
      assert.equal(denied.errorCode, "sandbox_scope_changed");
      assert.equal(archiveCalls.length, beforeUnknown, "unknown session authority must be denied before another Docker archive/helper operation");
    }, hooks);
  } finally {
    http.request = originalHttpRequest;
    if (previousHostname === undefined) delete process.env.HOSTNAME; else process.env.HOSTNAME = previousHostname;
    await rm(hostRoot, { recursive: true, force: true });
  }
});
