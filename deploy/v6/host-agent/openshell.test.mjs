import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { openShellHostEngine } from "./openshell.mjs";

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
function hostProvisioning(purpose = "qualification", options = {}) {
  const qualificationFixtures = options.qualificationFixtures
    ? { ...defaultQualificationFixtures, ...options.qualificationFixtures,
      filesystem: { ...defaultQualificationFixtures.filesystem, ...(options.qualificationFixtures.filesystem ?? {}) },
      network: { ...defaultQualificationFixtures.network, ...(options.qualificationFixtures.network ?? {}) } }
    : defaultQualificationFixtures;
  const probeFixture = purpose === "qualification" ? testProbeFixture(qualificationFixtures) : null;
  const document = purpose === "qualification" ? testProbeDocument(probeFixture) : (options.document ?? policyDocument);
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
  return request;
}
function qualificationCredentialFixture() {
  const value = { version: 1, fixtureId: "qualification-canary-v1", profileId: "aw-qualification-canary",
    profileHash: "", binaries: ["/usr/bin/curl"], wrongBinaryPath: "/usr/bin/wget",
    origin: "https://gateway.example.test", port: 443, method: "POST", gatewayPublicId: "gateway-fixture-1",
    toolName: "aw_qualification_canary", wrongToolName: "aw_wrong_destination_canary",
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
        if (args[0] === "cp") {
          assert.equal(args[1], `${containerId}:/.openshell/runtime/openshell-sandbox`);
          await writeFile(args[2], runtimeBinaryBytes, { mode: 0o600 });
          return { stdout: "fixture runtime copy\n" };
        }
        if (args[0] === "exec") {
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
          const supervisor = args.includes("label=openshell.ai/isolation-role=supervisor");
          return { stdout: physical ? `${supervisor ? supervisorContainerId : containerId}\n` : "" };
        }
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
                RepoDigests: [containerImageDigest],
                Config: {
                  Image: imageId,
                  WorkingDir: "/workspace/project",
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
          assert.equal(updateTarget, originalContainerId, "Docker resource updates must target the full pinned container ID");
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
      if (command[0] === "profile" && command[1] === "describe")
        return { stdout: JSON.stringify(hooks.qualificationCredentialProfile ?? hooks.modelBrokerProfile ?? hooks.brokerProfile ?? {}) };
      if (command[0] === "provider" && command[1] === "create") {
        const expectedToken = hooks.qualificationCapabilityToken ?? hooks.brokerToken;
        assert.ok(!args.some(value => String(value).includes(expectedToken ?? "__never__")));
        assert.equal(options.env.PAPERCLIP_SANDBOX_QUALIFICATION_TOKEN ?? options.env.PAPERCLIP_SANDBOX_BROKER_TOKEN ?? options.env.PAPERCLIP_SANDBOX_MODEL_TOKEN,
          expectedToken, `provider env keys: ${Object.keys(options.env).join(",")}`);
        return { stdout: "provider created" };
      }
      if (command[0] === "provider" && command[1] === "update") return { stdout: "provider updated" };
      if (command[0] === "provider" && command[1] === "delete") return { stdout: "provider deleted" };
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
          stdout: JSON.stringify({ providers: attached, next_page_token: "" }),
        };
      if (command[1] === "provider" && command[2] === "detach") {
        requireExpectedSandboxId(command);
        attached = [];
        return { stdout: "{}" };
      }
      throw new Error("fixture-unexpected-command");
    };
    const engine = openShellHostEngine({ config, epoch: 1, root, run, spawnProcess: hooks.spawnProcess });
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
      clearSandboxIdentity: () => { sandboxId = undefined; },
      enablePhysical: () => { physical = true; },
      setPhase: (value) => { phase = value; running = value === "Ready"; },
      setWrongContainerLabels: () => { wrongContainerLabels = true; },
      setContainerImageDigest: (value) => { containerImageDigest = value; },
      resourceConfig: () => ({ ...resourceConfig }),
      setResourceConfig: value => { resourceConfig = { ...value }; },
      replaceContainerBeforeUpdate: () => { containerId = "f".repeat(64); },
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
    endpointOrigin: "https://paperclip.example.test/",
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
  }))).digest("hex");
  return { request, token };
}
function modelBrokerExecRequest() {
  const request = execRequest();
  const expiresAt = new Date(Math.min(Date.parse(request.deadlineAt), Date.now() + 30000)).toISOString();
  const claims = { scope: "worker_model", company_id: scope.companyId, run_id: request.runId, sub: randomUUID(),
    exp: Math.floor(Date.parse(expiresAt) / 1000) + 1, worker_model: { workerAttemptId: randomUUID(), executionManifestId: request.manifestId } };
  const token = `fixture.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
  request.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN = "https://paperclip.example.test/";
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
  }))).digest("hex");
  return { request, token };
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

  for (const hooks of [
    { phase: "Stopped", physical: true, containerImageDigest: "fixture.invalid/other@sha256:" + "c".repeat(64) },
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

test("protected preflight exposes only the exact host-owned fixture and makes no control claim", async () =>
  fixture(async ({ engine }) => {
    const result = await engine.execute(randomUUID(), input("capabilities"), deadline());
    assert.equal(result.success, true, JSON.stringify(result));
    const capabilities = result.reply.capabilities;
    const fixture = capabilities.qualificationProbeFixture;
    assert.equal(fixture.fixtureHash, capabilities.qualificationHash);
    assert.equal(capabilities.qualificationTarget, undefined);
    for (const key of ["filesystemPolicy", "processPrivilegePolicy", "syscallPolicy", "networkDestinationPolicy",
      "networkLayer7Policy", "credentialBrokering", "resourceLimits", "forceStop"])
      assert.equal(capabilities[key], false, `${key} is not earned by preflight`);
  }));

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
    toolName: "aw_qualification_canary", wrongToolName: "aw_wrong_destination_canary",
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
  const hooks = { physical: true, running: true, qualificationFixtures: { credential: metadata },
    qualificationCredentialProfile: profile, effectivePolicy: document,
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
      version: 1, jobId: randomUUID(), jobKey: `runtime-asset-erasure:v1:${randomUUID()}`,
      attemptNumber: 1, executionOwnerId: "retention-worker", locatorDigest: "a".repeat(64),
      companyPurgeOperationId: null, startBindingDigest: "b".repeat(64),
    };
    const cleanupCapabilities = input("capabilities");
    delete cleanupCapabilities.requesterUserId;
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
      modelBrokerCapabilityHash: null, modelBrokerProviderProfile: null }))).digest("hex");
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
    }))).digest("hex");
    await assert.rejects(() => engine.executeStream({
      scope: scopeInput, request: forged, capabilityToken: "fixture-token",
    }, () => {}), /sandbox_scope_changed/);
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
