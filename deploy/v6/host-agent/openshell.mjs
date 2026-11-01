import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat, lstat, realpath, writeFile, unlink } from "node:fs/promises";
import { readdir as readDir, readlink } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { isIP } from "node:net";
import { atomicJson } from "./journal.mjs";
import { inspectInstalledBrokerProfiles } from "./broker-profiles.mjs";
import { verifyBrokerProviderProfile } from "./broker-profiles.mjs";

const runFile = promisify(execFile);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const DISK_CHANNEL_MOUNT = "/.openshell/channel";
const DISK_CA_TMPFS_MOUNT = "/run/openshell-supervisor-ca/material";
const MIN_DISK_BYTES = 1_048_576;
const MAX_DISK_BYTES = 1_099_511_627_776;
const QUALIFICATION_CREDENTIAL_ENV = "PAPERCLIP_SANDBOX_QUALIFICATION_TOKEN";
export function archiveStatusProvesAbsence(rootStatus, targetStatus) {
  if (rootStatus !== 200 || ![200, 404].includes(targetStatus))
    throw new Error("sandbox_observation_unavailable");
  return targetStatus === 404;
}
export function dockerInspectRunAsMatches(containerInfo, expectedUser) {
  return typeof expectedUser === "string" && containerInfo?.Config?.User === expectedUser;
}
export const NATIVE_SESSION_UPPER_ERASE_SCRIPT = `
const fs = require("node:fs");
const p = require("node:path");
const C = fs.constants;
const fail = () => process.exit(23);
const taskRoot = process.argv[1];
const digest = process.argv[2];
const mode = process.argv[3];
const expectedDev = process.argv[4];
const expectedIno = process.argv[5];
const expiresAt = Number(process.argv[6]);
const checkDeadline = () => { if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) fail(); };
checkDeadline();
if (typeof taskRoot !== "string" || !taskRoot.startsWith("/") || p.posix.normalize(taskRoot) !== taskRoot ||
    typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest) || !["inspect", "erase"].includes(mode)) fail();
const parts = [...taskRoot.slice(1).split("/"), ".paperclip-runtime", "paperclip-runner", "sessions"];
if (parts.some(v => !v || v === "." || v === ".." || v.includes("\\\\") || v.includes("\\0"))) fail();
function openDir(parent, name) {
  return fs.openSync(p.join("/proc/self/fd", String(parent), name), C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW | C.O_CLOEXEC);
}
function openProofPath(parts) {
  let fd = fs.openSync("/proof", C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW | C.O_CLOEXEC);
  try {
    for (const part of parts) {
      const next = openDir(fd, part);
      fs.closeSync(fd);
      fd = next;
    }
    return fd;
  } catch (e) { fs.closeSync(fd); throw e; }
}
function sameNode(a, b) { return a.dev === b.dev && a.ino === b.ino; }
function safeMounts() {
  const decode = value => value.replace(/\\\\([0-7]{3})/g, (_, n) => String.fromCharCode(parseInt(n, 8)));
  let proofMounts = 0, sessionMounts = 0;
  for (const line of fs.readFileSync("/proc/self/mountinfo", "utf8").split("\\n")) {
    if (!line) continue;
    const point = decode(line.split(" ")[4] || "");
    if (point === "/proof") proofMounts++;
    if (point === "/sessions") sessionMounts++;
    if (point.startsWith("/sessions/") || point === "/sessions/" || point.startsWith("/proof/")) fail();
  }
  if (proofMounts !== 1 || sessionMounts !== (mode === "erase" ? 1 : 0)) fail();
}
let proofRoot, sessionsFd, mountedFd;
try {
  safeMounts();
  try { proofRoot = openProofPath(parts); }
  catch (e) {
    if (mode === "inspect" && e.code === "ENOENT") {
      process.stdout.write(JSON.stringify({ parentPresent: false, present: false }) + "\\n");
      process.exit(0);
    }
    throw e;
  }
  const parent = "/proc/self/fd/" + proofRoot;
  const parentStat = fs.fstatSync(proofRoot);
  if (mode === "inspect") {
    let present = false;
    try {
      const current = fs.lstatSync(p.join(parent, digest));
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== parentStat.dev) fail();
      const currentFd = openDir(proofRoot, digest);
      try { if (!sameNode(current, fs.fstatSync(currentFd))) fail(); } finally { fs.closeSync(currentFd); }
      present = true;
    } catch (e) { if (e.code !== "ENOENT") throw e; }
    process.stdout.write(JSON.stringify({ parentPresent: true, parentDev: String(parentStat.dev), parentIno: String(parentStat.ino), present }) + "\\n");
    process.exit(0);
  }
  if (mode === "erase" && (String(parentStat.dev) !== expectedDev || String(parentStat.ino) !== expectedIno)) fail();
  mountedFd = fs.openSync("/sessions", C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW | C.O_CLOEXEC);
  if (!sameNode(parentStat, fs.fstatSync(mountedFd))) fail();
  let root;
  try { root = fs.lstatSync(p.join(parent, digest)); }
  catch (e) { if (e.code === "ENOENT") { process.stdout.write("already_absent\\n"); process.exit(0); } throw e; }
  if (!root.isDirectory() || root.isSymbolicLink()) fail();
  const rootFd = openDir(proofRoot, digest);
  if (!sameNode(root, fs.fstatSync(rootFd)) || root.dev !== fs.fstatSync(proofRoot).dev) fail();
  let count = 1;
  function removeTree(fd, depth) {
    if (depth > 128) fail();
    const directory = fs.opendirSync("/proc/self/fd/" + fd);
    try {
      let entry;
      while ((entry = directory.readSync()) !== null) {
      const name = entry.name;
      if (++count > 50000) fail();
      checkDeadline();
      if (typeof name !== "string" || !name || name === "." || name === ".." || name.includes("/") || name.includes("\\\\") || name.includes("\\0")) fail();
      const childPath = p.join("/proc/self/fd", String(fd), name);
      const before = fs.lstatSync(childPath);
      if (before.dev !== root.dev) fail();
      if (before.isSymbolicLink()) {
        const check = fs.lstatSync(childPath);
        if (!sameNode(before, check) || !check.isSymbolicLink()) fail();
        fs.unlinkSync(childPath);
      } else if (before.isDirectory()) {
        const childFd = openDir(fd, name);
        try {
          const opened = fs.fstatSync(childFd);
          if (!sameNode(before, opened) || opened.dev !== root.dev) fail();
          fs.chmodSync("/proc/self/fd/" + childFd, (opened.mode & 0o777) | 0o700);
          removeTree(childFd, depth + 1);
          const check = fs.lstatSync(childPath);
          if (!sameNode(opened, check) || !check.isDirectory() || check.isSymbolicLink()) fail();
          fs.rmdirSync(childPath);
        } finally { fs.closeSync(childFd); }
      } else if (before.isFile()) {
        if (before.nlink !== 1) fail();
        const check = fs.lstatSync(childPath);
        if (!sameNode(before, check) || !check.isFile() || check.isSymbolicLink()) fail();
        fs.unlinkSync(childPath);
      } else fail();
      }
    } finally { directory.closeSync(); }
  }
  fs.chmodSync("/proc/self/fd/" + rootFd, (root.mode & 0o777) | 0o700);
  checkDeadline();
  removeTree(rootFd, 0);
  checkDeadline();
  fs.closeSync(rootFd);
  const after = (() => { try { return fs.lstatSync(p.join(parent, digest)); } catch (e) { if (e.code === "ENOENT") return null; throw e; } })();
  if (!after || !sameNode(root, after) || !after.isDirectory() || after.isSymbolicLink()) fail();
  fs.rmdirSync(p.join(parent, digest));
  try { fs.lstatSync(p.join(parent, digest)); fail(); } catch (e) { if (e.code !== "ENOENT") throw e; }
  process.stdout.write("erased\\n");
} catch { fail(); }
finally {
  if (mountedFd !== undefined) fs.closeSync(mountedFd);
  if (proofRoot !== undefined) fs.closeSync(proofRoot);
}
`;
const probeContracts = Object.freeze({
  filesystem_allow: ["filesystemPolicy", "allow"],
  filesystem_deny: ["filesystemPolicy", "deny"],
  filesystem_escape: ["filesystemPolicy", "deny"],
  process_nonprivileged: ["processPrivilegePolicy", "observe"],
  process_privilege_denied: ["processPrivilegePolicy", "deny"],
  syscall_allow: ["syscallPolicy", "allow"],
  syscall_deny: ["syscallPolicy", "deny"],
  network_allow: ["networkDestinationPolicy", "allow"],
  network_host_port_deny: ["networkDestinationPolicy", "deny"],
  network_dns_redirect_deny: ["networkDestinationPolicy", "deny"],
  network_l7_allow: ["networkLayer7Policy", "allow"],
  network_l7_deny: ["networkLayer7Policy", "deny"],
  credential_allow: ["credentialBrokering", "allow"],
  credential_raw_read_deny: ["credentialBrokering", "deny"],
  credential_wrong_destination_deny: ["credentialBrokering", "deny"],
  credential_wrong_binary_deny: ["credentialBrokering", "deny"],
  credential_revoke_deny: ["credentialBrokering", "deny"],
  resource_exhaustion_contained: ["resourceLimits", "deny"],
  force_stop: ["forceStop", "observe"],
});
const managedModelPath = "/runtime-tools/model/v1/messages";
const canonicalValue = value => Array.isArray(value) ? value.map(canonicalValue) :
  value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])])) : value;
const exactObject = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

/** True only when the current OpenShell policy grants the one verified model
 * profile its exact HTTPS POST route through exactly its installed binaries. */
export function hasExactManagedModelBrokerPolicy(document, profile) {
  if (!document || !exactObject(document, ["version", "filesystem_policy", "landlock", "process", "network_policies"]) ||
    document.version !== 1 || !document.network_policies || typeof document.network_policies !== "object" ||
    Array.isArray(document.network_policies) || !profile || typeof profile !== "object" ||
    typeof profile.origin !== "string" || !Array.isArray(profile.binaries) || profile.binaries.length < 1 || profile.binaries.length > 32) return false;
  let origin;
  try { origin = new URL(profile.origin); } catch { return false; }
  if (origin.protocol !== "https:" || origin.origin !== profile.origin || origin.username || origin.password ||
    origin.pathname !== "/" || origin.search || origin.hash ||
    profile.binaries.some(binary => typeof binary !== "string" || !path.posix.isAbsolute(binary) ||
      path.posix.normalize(binary) !== binary || binary === "/" || /[\r\n\0]/.test(binary)) ||
    new Set(profile.binaries).size !== profile.binaries.length ||
    JSON.stringify(profile.binaries) !== JSON.stringify([...profile.binaries].sort())) return false;
  let exactRoutes = 0;
  for (const policy of Object.values(document.network_policies)) {
    if (!policy || typeof policy !== "object" || !Array.isArray(policy.binaries) || !Array.isArray(policy.endpoints)) return false;
    const endpoint = policy.endpoints.find(value => value?.host === origin.hostname && value?.port === Number(origin.port || 443));
    if (!endpoint) continue;
    if (policy.endpoints.length !== 1 || !exactObject(policy, ["name", "binaries", "endpoints"]) ||
      !Array.isArray(endpoint.rules) || endpoint.rules.length !== 1 ||
      !exactObject(endpoint, ["host", "port", "protocol", "enforcement", "rules"]) ||
      endpoint.protocol !== "rest" || endpoint.enforcement !== "enforce" ||
      !exactObject(endpoint.rules[0], ["allow"]) || !exactObject(endpoint.rules[0].allow, ["method", "path"])) return false;
    const allowedPath = endpoint.rules[0].allow.path;
    if (allowedPath === managedModelPath) {
      const selected = policy.binaries.map(binary => binary?.path);
      if (policy.binaries.some(binary => !exactObject(binary, ["path"])) ||
        new Set(selected).size !== selected.length ||
        JSON.stringify(selected) !== JSON.stringify(profile.binaries) ||
        endpoint.rules[0].allow.method !== "POST") return false;
      exactRoutes += 1;
    } else if (endpoint.rules[0].allow.method !== "POST" ||
      !/^\/mcp\/gateways\/[A-Za-z0-9_-]{1,128}$/.test(allowedPath ?? "")) {
      // Permit only the separately authorized exact App gateway paths at this
      // same origin; a broad route must not shadow the model endpoint.
      return false;
    }
  }
  return exactRoutes === 1;
}

const actions = new Set([
  "capabilities",
  "prepare",
  "inspect",
  "effective_policy",
  "apply",
  "start",
  "probe",
  "revoke_providers",
  "stop",
  "erase_native_session",
  "destroy",
]);
/** Private native-host controller. The pinned CLI observes only supported
 * OpenShell controls. It cannot attest the complete AW outer boundary. */
export function openShellHostEngine({
  config,
  epoch,
  root = "/var/lib/aw-runtime",
  run = runFile,
  spawnProcess = spawn,
  hostProcRoot = "/proc",
}) {
  const journalFile = path.join(root, "openshell-journal.json");
  let journal = { version: 2, scopes: {}, commands: {}, modelBrokerSessions: {} },
    queue = Promise.resolve();
  const erasureBindings = new Set();
  const activeExecBindings = new Map();
  function serial(work) {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  }
  function validScope(scope) {
    return (
      scope &&
      Object.keys(scope).sort().join(",") ===
        "bindingId,cellGeneration,cellId,companyId,sandboxRef" &&
      [scope.companyId, scope.bindingId, scope.cellId].every(
        (v) => typeof v === "string" && uuid.test(v),
      ) &&
      /^[1-9][0-9]{0,18}$/.test(scope.cellGeneration) &&
      scope.sandboxRef === `aw-v7-${scope.bindingId}`
    );
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
      );
    return value;
  }
  function sameDocument(left, right) {
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  }
  function deterministicUuidFromHash(digest) {
    if (!/^[a-f0-9]{64}$/.test(digest ?? "")) throw new Error("sandbox_scope_changed");
    const bytes = Buffer.from(digest.slice(0, 32), "hex");
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const value = bytes.toString("hex");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }
  function validOpenShellDocument(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "filesystem_policy,landlock,network_policies,process,version" ||
      value.version !== 1) return false;
    const fs = value.filesystem_policy;
    if (!fs || typeof fs !== "object" || Array.isArray(fs) ||
      Object.keys(fs).sort().join(",") !== "include_workdir,read_only,read_write" ||
      fs.include_workdir !== false || !Array.isArray(fs.read_only) || fs.read_only.length > 64 ||
      !Array.isArray(fs.read_write) || fs.read_write.length > 32 ||
      [...fs.read_only, ...fs.read_write].some(item => !canonicalFixturePath(item))) return false;
    const landlock = value.landlock;
    if (!landlock || typeof landlock !== "object" || Array.isArray(landlock) ||
      Object.keys(landlock).sort().join(",") !== "compatibility" ||
      landlock.compatibility !== "hard_requirement") return false;
    const process = value.process;
    if (!process || typeof process !== "object" || Array.isArray(process) ||
      Object.keys(process).sort().join(",") !== "run_as_group,run_as_user" ||
      !/^[1-9][0-9]{0,8}$/.test(process.run_as_user ?? "") ||
      !/^[0-9]{1,9}$/.test(process.run_as_group ?? "")) return false;
    const network = value.network_policies;
    if (!network || typeof network !== "object" || Array.isArray(network) || Object.keys(network).length > 64) return false;
    for (const [key, entry] of Object.entries(network)) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(key) || !entry || typeof entry !== "object" ||
        Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "binaries,endpoints,name" ||
        typeof entry.name !== "string" || entry.name.length > 100 || !Array.isArray(entry.binaries) ||
        entry.binaries.length > 32 || !Array.isArray(entry.endpoints) || entry.endpoints.length > 64) return false;
      if (entry.binaries.some(binary => !binary || typeof binary !== "object" || Array.isArray(binary) ||
        Object.keys(binary).join(",") !== "path" || !canonicalFixturePath(binary.path))) return false;
      for (const endpoint of entry.endpoints) {
        if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint) ||
          Object.keys(endpoint).sort().join(",") !== "enforcement,host,port,protocol,rules" ||
          typeof endpoint.host !== "string" || endpoint.host.length < 1 || endpoint.host.length > 253 ||
          /[\r\n\0]/.test(endpoint.host) || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 ||
          endpoint.protocol !== "rest" || endpoint.enforcement !== "enforce" ||
          !Array.isArray(endpoint.rules) || endpoint.rules.length > 224 ||
          endpoint.rules.some(rule => !rule || typeof rule !== "object" || Array.isArray(rule) ||
            Object.keys(rule).join(",") !== "allow" || !rule.allow || typeof rule.allow !== "object" ||
            Array.isArray(rule.allow) || Object.keys(rule.allow).sort().join(",") !== "method,path" ||
            typeof rule.allow.method !== "string" || rule.allow.method.length > 10 ||
            typeof rule.allow.path !== "string" || rule.allow.path.length > 1100)) return false;
      }
    }
    return true;
  }
  async function privateConfiguration() {
    if (
      !config ||
      !path.isAbsolute(config.executable ?? "") ||
      !/^[a-f0-9]{64}$/.test(config.executableSha256 ?? "") ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(config.gateway ?? "") ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(config.workspace ?? "") ||
      !path.isAbsolute(config.stateHome ?? "")
    )
      throw new Error("sandbox_host_unavailable");
    const executable = await realpath(config.executable),
      stateHome = await realpath(config.stateHome);
    const [binary, home] = await Promise.all([
      stat(executable),
      stat(stateHome),
    ]);
    const privateOwner = (info) =>
      info.uid === (process.getuid?.() ?? 0) && !(info.mode & 0o022);
    if (
      !binary.isFile() ||
      !(binary.mode & 0o100) ||
      binary.size > 100 * 1024 * 1024 ||
      !privateOwner(binary) ||
      !home.isDirectory() ||
      !privateOwner(home) ||
      home.mode & 0o077 ||
      hash(await readFile(executable)) !== config.executableSha256
    )
      throw new Error("sandbox_host_unavailable");
    return {
      executable,
      stateHome,
      env: { HOME: stateHome, PATH: "/usr/bin:/bin", LANG: "C", NO_COLOR: "1" },
    };
  }
  async function cli(args, deadlineAt, json = true, envOverrides = {}, timeoutCapMs = 6000) {
    const privateConfig = await privateConfiguration();
    const remaining = new Date(deadlineAt).getTime() - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0)
      throw new Error("sandbox_host_unavailable");
    const { stdout } = await run(
      privateConfig.executable,
      ["--gateway", config.gateway, "--workspace", config.workspace, ...args],
      {
        env: { ...privateConfig.env, ...envOverrides },
        timeout: Math.min(timeoutCapMs, remaining),
        maxBuffer: 262144,
        windowsHide: true,
        killSignal: "SIGKILL",
      },
    );
    return json ? JSON.parse(stdout) : stdout;
  }
  async function inspectBrokerProviderProfile(request, deadlineAt, model = false, expectedBinaries = null) {
    const broker = model ? request.modelBrokerCredential : request.brokerCredential;
    if (!broker) return null;
    const profile = await cli(["profile", "describe", broker.profileId, "--output", "json"], deadlineAt);
    return verifyBrokerProviderProfile({ profile, profileId: broker.profileId, profileHash: broker.profileHash,
      origin: request.env[model ? "PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN" : "PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN"],
      model, expectedBinaries });
  }
  async function attachBrokerProvider(request, scope, deadlineAt, providerName) {
    const broker = request.brokerCredential;
    if (!broker) return;
    if (Date.parse(broker.expiresAt) <= Date.now() || Date.parse(broker.expiresAt) > Date.parse(deadlineAt))
      throw new Error("exec_timeout");
    const decoded = (() => {
      try { return JSON.parse(Buffer.from(broker.capabilityToken.split(".")[1], "base64url").toString("utf8")); }
      catch { return null; }
    })();
    const capability = decoded?.sandbox_broker;
    if (!decoded || decoded.purpose !== "sandbox_broker" || decoded.aud !== "paperclip-sandbox-broker" ||
      !Array.isArray(capability?.bindings) || capability.bindings.some(binding => !binding ||
        !(binding.binary === null || typeof binding.binary === "string" && binding.binary.startsWith("/"))) ||
      decoded.jti !== request.requestId || capability?.parentRequestId !== request.requestId ||
      capability.bindingId !== request.bindingId || capability.cellId !== scope.cellId ||
      capability.generation !== scope.cellGeneration || capability.hostEpoch !== request.hostEpoch ||
      capability.runId !== request.runId || capability.attemptId !== request.attemptId || capability.attempt !== request.attempt ||
      capability.manifestId !== request.manifestId || capability.manifestHash !== request.manifestHash ||
      capability.policySnapshotId !== request.policySnapshotId || capability.policyHash !== request.policyHash ||
      capability?.endpointOrigin !== request.env.PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN ||
      capability?.brokerSessionId !== request.env.PAPERCLIP_SANDBOX_BROKER_SESSION_ID ||
      Date.parse(capability?.expiresAt ?? "") !== Date.parse(broker.expiresAt) || decoded.exp * 1000 > Date.parse(broker.expiresAt) + 999 ||
      decoded.company_id !== scope.companyId || decoded.run_id !== request.runId || !Number.isFinite(decoded.exp) || decoded.exp * 1000 <= Date.now())
      throw new Error("sandbox_scope_changed");
    const binaries = capability.bindings.map(binding => binding.binary ?? null);
    const expectedBinaries = binaries.some(binary => binary !== null)
      ? (binaries.every(binary => binary !== null) && new Set(binaries).size === 1 ? [binaries[0]] : null)
      : null;
    if (binaries.some(binary => binary !== null) && expectedBinaries === null)
      throw new Error("sandbox_operation_unsupported");
    const { origin } = await inspectBrokerProviderProfile(request, deadlineAt, false, expectedBinaries);
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
      throw new Error("sandbox_operation_unsupported");
    const providerCredentialEnv = "PAPERCLIP_SANDBOX_BROKER_TOKEN";
    const providerEnv = { [providerCredentialEnv]: broker.capabilityToken };
    await cli(["provider", "create", "--name", providerName, "--type", broker.profileId, "--credential", providerCredentialEnv], deadlineAt, false, providerEnv);
    await cli(["provider", "update", providerName, "--credential-expires-at", `${providerCredentialEnv}=${broker.expiresAt}`], deadlineAt, false);
    const waitSeconds = Math.max(1, Math.min(15, Math.floor((Date.parse(deadlineAt) - Date.now()) / 1000)));
    const target = await observed(scope, deadlineAt);
    await cli(["sandbox", "provider", "attach", scope.sandboxRef, providerName, "--expected-sandbox-id", target.id, "--wait", "--timeout", String(waitSeconds), "--output", "json"], deadlineAt, true, {}, 18_000);
    const attached = await cli(["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "16", "--output", "json"], deadlineAt);
    if (!Array.isArray(attached.providers) || !attached.providers.some(value => value?.name === providerName) || attached.next_page_token !== "")
      throw new Error("sandbox_observation_unavailable");
  }
  async function attachModelBrokerProvider(request, scope, deadlineAt, providerName) {
    const broker = request.modelBrokerCredential;
    if (!broker) return;
    if (Date.parse(broker.expiresAt) <= Date.now() || Date.parse(broker.expiresAt) > Date.parse(deadlineAt)) throw new Error("exec_timeout");
    const decoded = (() => { try { return JSON.parse(Buffer.from(broker.capabilityToken.split(".")[1], "base64url").toString("utf8")); } catch { return null; } })();
    const worker = decoded?.scope === "worker_model" && decoded.worker_model && !decoded.conversation_model &&
      decoded.worker_model.executionManifestId === request.manifestId && uuid.test(decoded.worker_model.workerAttemptId ?? "");
    const conversation = decoded?.scope === "conversation_model" && decoded.conversation_model && !decoded.worker_model &&
      uuid.test(decoded.conversation_model.issueId ?? "") && Number.isSafeInteger(decoded.conversation_model.conversationSessionGeneration) &&
      decoded.conversation_model.executionManifestId === request.manifestId && decoded.conversation_model.executionManifestHash === request.manifestHash;
    if (!decoded || (!worker && !conversation) || decoded.company_id !== scope.companyId || decoded.run_id !== request.runId ||
      typeof decoded.sub !== "string" || !decoded.sub || typeof decoded.responsible_user_id !== "string" ||
      !Number.isSafeInteger(decoded.iat) || !Number.isSafeInteger(decoded.exp) || decoded.exp <= decoded.iat ||
      decoded.exp - decoded.iat > 300 || decoded.exp * 1000 <= Date.now() || decoded.exp * 1000 < Date.parse(broker.expiresAt))
      throw new Error("sandbox_scope_changed");
    const { origin } = await inspectBrokerProviderProfile(request, deadlineAt, true);
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("sandbox_operation_unsupported");
    const credentialEnv = "PAPERCLIP_SANDBOX_MODEL_TOKEN";
    await cli(["provider", "create", "--name", providerName, "--type", broker.profileId, "--credential", credentialEnv], deadlineAt, false, { [credentialEnv]: broker.capabilityToken });
    await cli(["provider", "update", providerName, "--credential-expires-at", `${credentialEnv}=${broker.expiresAt}`], deadlineAt, false);
    const waitSeconds = Math.max(1, Math.min(15, Math.floor((Date.parse(deadlineAt) - Date.now()) / 1000)));
    const target = await observed(scope, deadlineAt);
    await cli(["sandbox", "provider", "attach", scope.sandboxRef, providerName, "--expected-sandbox-id", target.id, "--wait", "--timeout", String(waitSeconds), "--output", "json"], deadlineAt, true, {}, 18_000);
    const attached = await cli(["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "16", "--output", "json"], deadlineAt);
    if (!Array.isArray(attached.providers) || !attached.providers.some(value => value?.name === providerName) || attached.next_page_token !== "") throw new Error("sandbox_observation_unavailable");
  }
  function modelBrokerSessionBinding(request, scope) {
    const session = request.modelBrokerSession;
    if (!session || !/^[a-f0-9]{64}$/.test(session.sessionKey ?? "") ||
      !/^[a-f0-9]{64}$/.test(session.nativeSessionIdDigest ?? "") || !uuid.test(session.runnerInstanceId ?? "") ||
      !uuid.test(session.leaseId ?? "") || !Number.isFinite(Date.parse(session.sessionDeadlineAt)) ||
      (session.startBindingDigest !== undefined && !/^[a-f0-9]{64}$/.test(session.startBindingDigest)) ||
      (session.phase !== "start" && session.startBindingDigest !== undefined) ||
      (session.phase === "start" ? session.expectedCapabilityHash !== undefined : !/^[a-f0-9]{64}$/.test(session.expectedCapabilityHash ?? "")))
      throw new Error("sandbox_scope_changed");
    const binding = { companyId: scope.companyId, runId: request.runId, attemptId: request.attemptId,
      attempt: request.attempt, bindingId: request.bindingId, cellId: scope.cellId, generation: scope.cellGeneration,
      hostEpoch: request.hostEpoch, manifestId: request.manifestId, manifestHash: request.manifestHash,
      policySnapshotId: request.policySnapshotId, policyHash: request.policyHash, sessionKey: session.sessionKey,
      nativeSessionIdDigest: session.nativeSessionIdDigest, runnerInstanceId: session.runnerInstanceId,
      leaseId: session.leaseId, sessionDeadlineAt: session.sessionDeadlineAt };
    const expectedKey = hash(JSON.stringify(canonical({ companyId: scope.companyId, runId: request.runId,
      attemptId: request.attemptId, attempt: request.attempt, nativeSessionIdDigest: session.nativeSessionIdDigest,
      runnerInstanceId: session.runnerInstanceId, leaseId: session.leaseId, bindingId: request.bindingId,
      cellId: scope.cellId, generation: scope.cellGeneration, hostEpoch: request.hostEpoch,
      manifestId: request.manifestId, manifestHash: request.manifestHash, policySnapshotId: request.policySnapshotId,
      policyHash: request.policyHash })));
    if (expectedKey !== session.sessionKey || (session.phase !== "stop" && Date.parse(session.sessionDeadlineAt) <= Date.now()))
      throw new Error("sandbox_scope_changed");
    return { descriptor: session, binding };
  }
  function modelBrokerSessionCredential(request, scope, descriptor) {
    const broker = request.modelBrokerCredential;
    if (!broker) return null;
    const decoded = (() => { try { return JSON.parse(Buffer.from(broker.capabilityToken.split(".")[1], "base64url").toString("utf8")); } catch { return null; } })();
    const expiresAt = Date.parse(broker.expiresAt);
    if (!decoded || decoded.company_id !== scope.companyId || decoded.run_id !== request.runId ||
      typeof decoded.sub !== "string" || !decoded.sub || typeof decoded.responsible_user_id !== "string" ||
      !Number.isSafeInteger(decoded.iat) || !Number.isSafeInteger(decoded.exp) || decoded.exp <= decoded.iat ||
      decoded.exp - decoded.iat > 300 || decoded.exp * 1000 <= Date.now() || decoded.exp * 1000 < expiresAt ||
      !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.parse(descriptor.sessionDeadlineAt) ||
      !Number.isSafeInteger(broker.inputTokensUpperBound) || !Number.isSafeInteger(broker.maxOutputTokens)) return null;
    let authority;
    if (decoded.scope === "worker_model" && decoded.worker_model && !decoded.conversation_model) {
      const b = decoded.worker_model;
      if (!uuid.test(b.planId ?? "") || !uuid.test(b.workerId ?? "") || !uuid.test(b.workerAttemptId ?? "") ||
        b.executionManifestId !== request.manifestId || !Number.isSafeInteger(b.expectedPlanVersion) || b.expectedPlanVersion < 1) return null;
      authority = { scope: decoded.scope, sub: decoded.sub, company_id: decoded.company_id, run_id: decoded.run_id,
        responsible_user_id: decoded.responsible_user_id, instance_id: decoded.instance_id, worker_model: b };
    } else if (decoded.scope === "conversation_model" && decoded.conversation_model && !decoded.worker_model) {
      const b = decoded.conversation_model;
      if (!uuid.test(b.issueId ?? "") || !Number.isSafeInteger(b.conversationSessionGeneration) || b.conversationSessionGeneration < 0 ||
        b.executionManifestId !== request.manifestId || b.executionManifestHash !== request.manifestHash) return null;
      authority = { scope: decoded.scope, sub: decoded.sub, company_id: decoded.company_id, run_id: decoded.run_id,
        responsible_user_id: decoded.responsible_user_id, instance_id: decoded.instance_id, conversation_model: b };
    } else return null;
    return { authorityHash: hash(JSON.stringify(canonical(authority))), capabilityHash: hash(broker.capabilityToken),
      profileId: broker.profileId, profileHash: broker.profileHash, expiresAt: broker.expiresAt,
      inputTokensUpperBound: broker.inputTokensUpperBound, maxOutputTokens: broker.maxOutputTokens };
  }
  function observesCredentialExpiry(value, expected) {
    if (!value || typeof value !== "object") return false;
    for (const [key, item] of Object.entries(value)) {
      if (["expiresAt", "expires_at", "credentialExpiresAt", "credential_expires_at"].includes(key) &&
        typeof item === "string" && Date.parse(item) === Date.parse(expected)) return true;
      if (item && typeof item === "object" && observesCredentialExpiry(item, expected)) return true;
    }
    return false;
  }
  function sameModelSession(entry, binding, profile, authorityHash) {
    return entry && sameDocument(entry.binding, binding) && entry.profileId === profile.profileId &&
      entry.profileHash === profile.profileHash && entry.inputTokensUpperBound === profile.inputTokensUpperBound &&
      entry.maxOutputTokens === profile.maxOutputTokens && entry.authorityHash === authorityHash;
  }
  async function modelBrokerSessionTransition(request, scope, deadlineAt, signal) {
    const { descriptor, binding } = modelBrokerSessionBinding(request, scope);
    const sessions = journal.modelBrokerSessions ?? (journal.modelBrokerSessions = {});
    const key = descriptor.sessionKey;
    const providerName = `awms-${key.slice(0, 32)}`;
    if (descriptor.phase === "start") {
      const credential = modelBrokerSessionCredential(request, scope, descriptor);
      if (!credential || sessions[key]) throw new Error("sandbox_scope_changed");
      await inspectBrokerProviderProfile(request, deadlineAt, true);
      await serial(async () => {
        // Stopped/revoked session entries are durable tombstones. Do not let
        // an unbounded sequence of short-lived sessions write a journal that
        // this host will refuse to load on its next restart.
        if (sessions[key] || Object.keys(sessions).length >= 1024) throw new Error("sandbox_scope_changed");
        sessions[key] = { binding, ...(descriptor.startBindingDigest ? { startBindingDigest: descriptor.startBindingDigest } : {}),
          providerName, profileId: credential.profileId, profileHash: credential.profileHash,
          inputTokensUpperBound: credential.inputTokensUpperBound, maxOutputTokens: credential.maxOutputTokens,
          authorityHash: credential.authorityHash, capabilityHash: credential.capabilityHash, expiresAt: credential.expiresAt,
          state: "creating" };
        await atomicJson(journalFile, journal);
      });
      if (signal?.aborted) throw new Error("exec_unknown");
      const env = "PAPERCLIP_SANDBOX_MODEL_TOKEN";
      await cli(["provider", "create", "--name", providerName, "--type", credential.profileId,
        "--credential", env], deadlineAt, false, { [env]: request.modelBrokerCredential.capabilityToken });
      await cli(["provider", "update", providerName, "--credential-expires-at", `${env}=${credential.expiresAt}`], deadlineAt, false);
      if (signal?.aborted) throw new Error("exec_unknown");
      const target = await observed(scope, deadlineAt);
      if (target.phase !== "Ready") throw new Error("sandbox_scope_changed");
      const waitSeconds = Math.max(1, Math.min(15, Math.floor((Date.parse(deadlineAt) - Date.now()) / 1000)));
      await cli(["sandbox", "provider", "attach", scope.sandboxRef, providerName, "--expected-sandbox-id", target.id,
        "--wait", "--timeout", String(waitSeconds), "--output", "json"], deadlineAt, true, {}, 18_000);
      if (signal?.aborted) throw new Error("exec_unknown");
      const attached = await cli(["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "16", "--output", "json"], deadlineAt);
      const listed = await cli(["provider", "list", "--page-size", "128", "--output", "json"], deadlineAt);
      const observedProvider = Array.isArray(listed.providers) ? listed.providers.find(value => value?.name === providerName &&
        (value?.type === credential.profileId || value?.profileId === credential.profileId)) : null;
      if (!Array.isArray(attached.providers) || !attached.providers.some(value => value?.name === providerName) ||
        attached.next_page_token !== "" || listed.next_page_token !== "" || !observedProvider ||
        !observesCredentialExpiry(observedProvider, credential.expiresAt)) throw new Error("sandbox_observation_unavailable");
      await serial(async () => {
        const current = sessions[key];
        if (!current || current.state !== "creating" || !sameModelSession(current, binding, credential, credential.authorityHash))
          throw new Error("sandbox_scope_changed");
        current.state = "active";
        await atomicJson(journalFile, journal);
      });
      return { sessionKey: key, capabilityHash: credential.capabilityHash, expiresAt: credential.expiresAt };
    }
    const entry = sessions[key];
    if (descriptor.phase === "stop") {
      if (!entry) throw new Error("sandbox_scope_changed");
      if (entry.state === "stopped") {
        if (!sameDocument(entry.binding, binding) || descriptor.expectedCapabilityHash !== entry.capabilityHash)
          throw new Error("sandbox_scope_changed");
        return { sessionKey: key, capabilityHash: entry.capabilityHash, expiresAt: entry.expiresAt };
      }
      if (entry.state !== "active" || !sameDocument(entry.binding, binding) || descriptor.expectedCapabilityHash !== entry.capabilityHash)
        throw new Error("sandbox_scope_changed");
      if (signal?.aborted) throw new Error("exec_unknown");
      await serial(async () => { const current = sessions[key];
        if (!current || current.state !== "active" || current.capabilityHash !== descriptor.expectedCapabilityHash ||
          !sameDocument(current.binding, binding)) throw new Error("sandbox_scope_changed");
        current.state = "closing"; await atomicJson(journalFile, journal); });
      if (signal?.aborted) throw new Error("exec_unknown");
      await detachAndDeleteBrokerProvider(scope, deadlineAt, entry.providerName);
      await serial(async () => { const current = sessions[key];
        if (!current || current.state !== "closing" || current.capabilityHash !== descriptor.expectedCapabilityHash)
          throw new Error("sandbox_scope_changed");
        current.state = "stopped"; await atomicJson(journalFile, journal); });
      return { sessionKey: key, capabilityHash: entry.capabilityHash, expiresAt: entry.expiresAt };
    }
    const credential = modelBrokerSessionCredential(request, scope, descriptor);
    if (!entry || entry.state !== "active" || !credential || descriptor.expectedCapabilityHash !== entry.capabilityHash ||
      !sameModelSession(entry, binding, credential, credential.authorityHash) ||
      Date.parse(descriptor.sessionDeadlineAt) !== Date.parse(entry.binding.sessionDeadlineAt))
      throw new Error("sandbox_scope_changed");
    const requestedExpiry = Date.parse(credential.expiresAt);
    const activeExpiry = Date.parse(entry.expiresAt);
    if (requestedExpiry === activeExpiry) {
      await inspectBrokerProviderProfile(request, deadlineAt, true);
      const listed = await cli(["provider", "list", "--page-size", "128", "--output", "json"], deadlineAt);
      const observedProvider = Array.isArray(listed.providers) ? listed.providers.find(value => value?.name === entry.providerName &&
        (value?.type === credential.profileId || value?.profileId === credential.profileId)) : null;
      const attached = await cli(["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "16", "--output", "json"], deadlineAt);
      if (listed.next_page_token !== "" || !observedProvider || !observesCredentialExpiry(observedProvider, entry.expiresAt) ||
        !Array.isArray(attached.providers) || !attached.providers.some(value => value?.name === entry.providerName) ||
        attached.next_page_token !== "") throw new Error("sandbox_observation_unavailable");
      if (signal?.aborted) throw new Error("exec_unknown");
      return await serial(async () => {
        if (signal?.aborted) throw new Error("exec_unknown");
        const current = sessions[key];
        if (!current || current.state !== "active" || current.capabilityHash !== descriptor.expectedCapabilityHash ||
          !sameModelSession(current, binding, credential, credential.authorityHash) || current.expiresAt !== entry.expiresAt)
          throw new Error("sandbox_scope_changed");
        return { sessionKey: key, capabilityHash: current.capabilityHash, expiresAt: current.expiresAt };
      });
    }
    if (requestedExpiry < activeExpiry) throw new Error("sandbox_scope_changed");
    if (activeExpiry - Date.now() > 60_000) {
      // A newly minted JWT can arrive on an ordinary monitor tick long before
      // the current provider expires. Keep the active capability until the
      // bounded refresh window, but still observe the exact provider and its
      // attachment and recheck the journal CAS before acknowledging a no-op.
      await inspectBrokerProviderProfile(request, deadlineAt, true);
      const listed = await cli(["provider", "list", "--page-size", "128", "--output", "json"], deadlineAt);
      const observedProvider = Array.isArray(listed.providers) ? listed.providers.find(value => value?.name === entry.providerName &&
        (value?.type === credential.profileId || value?.profileId === credential.profileId)) : null;
      const attached = await cli(["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "16", "--output", "json"], deadlineAt);
      if (listed.next_page_token !== "" || !observedProvider || !observesCredentialExpiry(observedProvider, entry.expiresAt) ||
        !Array.isArray(attached.providers) || !attached.providers.some(value => value?.name === entry.providerName) ||
        attached.next_page_token !== "") throw new Error("sandbox_observation_unavailable");
      if (signal?.aborted) throw new Error("exec_unknown");
      return await serial(async () => {
        if (signal?.aborted) throw new Error("exec_unknown");
        const current = sessions[key];
        if (!current || current.state !== "active" || current.capabilityHash !== descriptor.expectedCapabilityHash ||
          !sameModelSession(current, binding, credential, credential.authorityHash) || current.expiresAt !== entry.expiresAt)
          throw new Error("sandbox_scope_changed");
        return { sessionKey: key, capabilityHash: current.capabilityHash, expiresAt: current.expiresAt };
      });
    }
    await inspectBrokerProviderProfile(request, deadlineAt, true);
    await serial(async () => { const current = sessions[key];
      if (!current || current.state !== "active" || current.capabilityHash !== descriptor.expectedCapabilityHash ||
        !sameModelSession(current, binding, credential, credential.authorityHash)) throw new Error("sandbox_scope_changed");
      current.state = "updating"; current.nextCapabilityHash = credential.capabilityHash; await atomicJson(journalFile, journal); });
    const env = "PAPERCLIP_SANDBOX_MODEL_TOKEN";
    await cli(["provider", "update", entry.providerName, "--credential", env,
      "--credential-expires-at", `${env}=${credential.expiresAt}`, "--output", "json"], deadlineAt, true,
    { [env]: request.modelBrokerCredential.capabilityToken });
    if (signal?.aborted) throw new Error("exec_unknown");
    const listed = await cli(["provider", "list", "--page-size", "128", "--output", "json"], deadlineAt);
    const observedProvider = Array.isArray(listed.providers) ? listed.providers.find(value => value?.name === entry.providerName &&
      (value?.type === credential.profileId || value?.profileId === credential.profileId)) : null;
    if (listed.next_page_token !== "" || !observedProvider || !observesCredentialExpiry(observedProvider, credential.expiresAt))
      throw new Error("sandbox_observation_unavailable");
    const attached = await cli(["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "16", "--output", "json"], deadlineAt);
    if (!Array.isArray(attached.providers) || !attached.providers.some(value => value?.name === entry.providerName) || attached.next_page_token !== "")
      throw new Error("sandbox_observation_unavailable");
    await serial(async () => { const current = sessions[key];
      if (!current || current.state !== "updating" || current.capabilityHash !== descriptor.expectedCapabilityHash ||
        current.nextCapabilityHash !== credential.capabilityHash || !sameModelSession(current, binding, credential, credential.authorityHash))
        throw new Error("sandbox_scope_changed");
      current.capabilityHash = credential.capabilityHash; current.expiresAt = credential.expiresAt;
      delete current.nextCapabilityHash; current.state = "active"; await atomicJson(journalFile, journal); });
    return { sessionKey: key, capabilityHash: credential.capabilityHash, expiresAt: credential.expiresAt };
  }
  async function detachAndDeleteBrokerProvider(scope, deadlineAt, providerName) {
    const target = await observed(scope, deadlineAt);
    await cli(["sandbox", "provider", "detach", scope.sandboxRef, providerName, "--expected-sandbox-id", target.id, "--wait", "--timeout", "15", "--output", "json"], deadlineAt, true, {}, 18_000);
    const attached = await cli(["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "16", "--output", "json"], deadlineAt);
    if (!Array.isArray(attached.providers) || attached.providers.some(value => value?.name === providerName) || attached.next_page_token !== "")
      throw new Error("sandbox_observation_unavailable");
    await cli(["provider", "delete", providerName], deadlineAt, false);
  }
  async function deleteQuiescedBrokerProviders(scope, deadlineAt, alreadySerialized = false) {
    const persist = work => alreadySerialized ? work() : serial(work);
    const pending = Object.values(journal.commands).flatMap(command => {
      return [command?.brokerProvider, command?.modelBrokerProvider].filter(provider => provider && validScope(provider.scope) && sameDocument(provider.scope, scope) &&
        /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(provider.name ?? "")).map(provider => provider.name);
    });
    const names = [...new Set(pending)].slice(0, 32);
    for (const name of names) await cli(["provider", "delete", name], deadlineAt, false);
    const qualificationProviders = Object.values(journal.commands).flatMap(command =>
      command?.qualificationCredentialProvider ? [command.qualificationCredentialProvider] : [])
      .filter(provider => provider && validScope(provider.scope) && sameDocument(provider.scope, scope) &&
        /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(provider.name ?? "") && uuid.test(provider.sandboxId ?? ""))
      .slice(0, 32);
    for (const provider of qualificationProviders) {
      const current = await observed(scope, deadlineAt);
      if (current.id !== provider.sandboxId) throw new Error("sandbox_scope_changed");
      await cli(["sandbox", "provider", "detach", scope.sandboxRef, provider.name,
        "--expected-sandbox-id", provider.sandboxId, "--wait", "--timeout", "10", "--output", "json"],
      deadlineAt, true, {}, 12_000);
      const attached = await cli(["sandbox", "provider", "list", scope.sandboxRef,
        "--page-size", "16", "--output", "json"], deadlineAt);
      if (!Array.isArray(attached.providers) || attached.providers.some(value => value?.name === provider.name) ||
        attached.next_page_token !== "") throw new Error("sandbox_observation_unavailable");
      await cli(["provider", "delete", provider.name], deadlineAt, false);
    }
    const sessionEntries = Object.entries(journal.modelBrokerSessions ?? {}).filter(([, value]) => value &&
      value.binding?.companyId === scope.companyId && value.binding?.bindingId === scope.bindingId &&
      value.binding?.cellId === scope.cellId && value.binding?.generation === scope.cellGeneration &&
      value.state !== "stopped" && value.state !== "revoked");
    for (const [key, provider] of sessionEntries) {
      if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(provider.providerName ?? ""))
        throw new Error("sandbox_scope_changed");
      const current = await observed(scope, deadlineAt);
      const attached = await cli(["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "16", "--output", "json"], deadlineAt);
      if (!Array.isArray(attached.providers) || attached.next_page_token !== "") throw new Error("sandbox_observation_unavailable");
      if (attached.providers.some(value => value?.name === provider.providerName)) {
        if (!current.id) throw new Error("sandbox_scope_changed");
        await cli(["sandbox", "provider", "detach", scope.sandboxRef, provider.providerName,
          "--expected-sandbox-id", current.id, "--wait", "--timeout", "10", "--output", "json"], deadlineAt, true, {}, 12_000);
        const after = await cli(["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "16", "--output", "json"], deadlineAt);
        if (!Array.isArray(after.providers) || after.providers.some(value => value?.name === provider.providerName) || after.next_page_token !== "")
          throw new Error("sandbox_observation_unavailable");
      }
      await cli(["provider", "delete", provider.providerName], deadlineAt, false);
      await persist(async () => { const entry = journal.modelBrokerSessions?.[key];
        if (entry && sameDocument(entry.binding, provider.binding)) { entry.state = "revoked"; await atomicJson(journalFile, journal); } });
    }
    if (names.length) await persist(async () => {
      for (const command of Object.values(journal.commands)) {
        if (command?.brokerProvider && names.includes(command.brokerProvider.name) && validScope(command.brokerProvider.scope) && sameDocument(command.brokerProvider.scope, scope))
          delete command.brokerProvider;
        if (command?.modelBrokerProvider && names.includes(command.modelBrokerProvider.name) && validScope(command.modelBrokerProvider.scope) && sameDocument(command.modelBrokerProvider.scope, scope))
          delete command.modelBrokerProvider;
      }
      for (const command of Object.values(journal.commands)) {
        if (command?.qualificationCredentialProvider && qualificationProviders.some(provider =>
          provider.name === command.qualificationCredentialProvider.name && sameDocument(provider.scope, scope)))
          delete command.qualificationCredentialProvider;
      }
      await atomicJson(journalFile, journal);
    });
    else if (qualificationProviders.length) await persist(async () => {
      for (const command of Object.values(journal.commands)) {
        if (command?.qualificationCredentialProvider && qualificationProviders.some(provider =>
          provider.name === command.qualificationCredentialProvider.name && sameDocument(provider.scope, scope)))
          delete command.qualificationCredentialProvider;
      }
      await atomicJson(journalFile, journal);
    });
  }
  async function docker(args, deadlineAt, json = true, timeoutCapMs = 6000) {
    const privateConfig = await privateConfiguration();
    const remaining = new Date(deadlineAt).getTime() - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0)
      throw new Error("sandbox_host_unavailable");
    const { stdout } = await run("docker", args, {
      env: {
        ...privateConfig.env,
        PATH: process.env.PATH,
        DOCKER_HOST: "unix:///var/run/docker.sock",
      },
      timeout: Math.min(timeoutCapMs, remaining),
      maxBuffer: 262144,
      windowsHide: true,
      killSignal: "SIGKILL",
    });
    return json ? JSON.parse(stdout) : stdout;
  }
  async function dockerArchiveHead(containerId, targetPath, deadlineAt) {
    if (!/^[a-f0-9]{64}$/.test(containerId ?? "") || typeof targetPath !== "string" ||
      !targetPath.startsWith("/") || path.posix.normalize(targetPath) !== targetPath || /[\r\n\0]/.test(targetPath))
      throw new Error("sandbox_scope_changed");
    const apiVersion = (await docker(["version", "--format", "{{.Server.APIVersion}}"], deadlineAt, false)).trim();
    if (!/^1\.[0-9]{1,3}$/.test(apiVersion)) throw new Error("sandbox_operation_unsupported");
    const query = new URLSearchParams({ path: targetPath });
    const requestPath = `/v${apiVersion}/containers/${containerId}/archive?${query.toString()}`;
    const remaining = Date.parse(deadlineAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("sandbox_host_unavailable");
    return new Promise((resolve, reject) => {
      const req = http.request({ socketPath: "/var/run/docker.sock", method: "HEAD", path: requestPath }, response => {
        response.resume();
        response.once("end", () => {
          const status = response.statusCode;
          if (status === 200 || status === 404) resolve(status);
          else reject(new Error("sandbox_observation_unavailable"));
        });
      });
      const timer = setTimeout(() => req.destroy(new Error("sandbox_host_unavailable")), Math.min(5000, remaining));
      timer.unref?.();
      req.once("error", () => reject(new Error("sandbox_host_unavailable")));
      req.once("close", () => clearTimeout(timer));
      req.end();
    });
  }
  function decodeMountInfoPath(value) {
    return value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
  }
  async function dockerDaemonMountInfo(deadlineAt) {
    const deadline = Date.parse(deadlineAt);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error("sandbox_host_unavailable");
    const hostMountNamespace = await readlink(path.join(hostProcRoot, "1", "ns/mnt")).catch(() => "");
    if (!/^mnt:\[[0-9]+\]$/.test(hostMountNamespace)) throw new Error("sandbox_operation_unsupported");
    const pids = (await readDir(hostProcRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && /^[1-9][0-9]{0,8}$/.test(entry.name)).map(entry => entry.name);
    const matches = [];
    for (const pid of pids) {
      if (Date.now() >= deadline) throw new Error("sandbox_host_unavailable");
      try {
        if ((await readFile(path.join(hostProcRoot, pid, "comm"), "utf8")).trim() !== "dockerd") continue;
        const mountNamespace = await readlink(path.join(hostProcRoot, pid, "ns/mnt"));
        if (!/^mnt:\[[0-9]+\]$/.test(mountNamespace) || mountNamespace !== hostMountNamespace) continue;
        const mountInfo = await readFile(path.join(hostProcRoot, pid, "mountinfo"), "utf8");
        matches.push({ pid, mountNamespace, mountInfo });
      } catch { /* A process may disappear while the bounded /proc scan runs. */ }
    }
    if (matches.length !== 1) throw new Error("sandbox_operation_unsupported");
    return matches[0];
  }
  function mountInfoContainsPath(mountInfo, target) {
    const points = mountInfo.split("\n").flatMap(line => {
      const fields = line.split(" ");
      return fields.length >= 5 ? [decodeMountInfoPath(fields[4])] : [];
    });
    return points.some(point => point === target || point.startsWith(`${target}/`));
  }
  async function assertContainerOverlayOffline(workload, deadlineAt) {
    const dockerRoot = (await docker(["info", "--format", "{{.DockerRootDir}}"], deadlineAt, false)).trim();
    const mergedDir = workload?.GraphDriver?.Data?.MergedDir;
    const upperDir = workload?.GraphDriver?.Data?.UpperDir;
    const upperRelative = typeof dockerRoot === "string" && typeof upperDir === "string"
      ? path.posix.relative(dockerRoot, upperDir) : "";
    const mergedRelative = typeof dockerRoot === "string" && typeof mergedDir === "string"
      ? path.posix.relative(dockerRoot, mergedDir) : "";
    const upperMatch = /^overlay2\/([a-f0-9]{64})\/diff$/.exec(upperRelative);
    const mergedMatch = /^overlay2\/([a-f0-9]{64})\/merged$/.exec(mergedRelative);
    if (workload?.GraphDriver?.Name !== "overlay2" || typeof dockerRoot !== "string" ||
      !path.posix.isAbsolute(dockerRoot) || path.posix.normalize(dockerRoot) !== dockerRoot ||
      typeof upperDir !== "string" || !path.posix.isAbsolute(upperDir) || path.posix.normalize(upperDir) !== upperDir ||
      typeof mergedDir !== "string" || !path.posix.isAbsolute(mergedDir) || path.posix.normalize(mergedDir) !== mergedDir ||
      !upperMatch || !mergedMatch || upperMatch[1] !== mergedMatch[1])
      throw new Error("sandbox_operation_unsupported");
    const daemon = await dockerDaemonMountInfo(deadlineAt);
    if (mountInfoContainsPath(daemon.mountInfo, mergedDir)) throw new Error("sandbox_operation_unsupported");
    return { dockerRoot, upperDir, mergedDir, daemonPid: daemon.pid, daemonMountNamespace: daemon.mountNamespace };
  }
  async function inspectHostAgentImage(deadlineAt) {
    const hostName = "aw-runtime-host";
    const selfId = typeof process.env.HOSTNAME === "string" ? process.env.HOSTNAME.toLowerCase() : "";
    if (!/^[a-f0-9]{12,64}$/.test(selfId)) throw new Error("sandbox_operation_unsupported");
    const rows = await docker(["inspect", hostName], deadlineAt);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("sandbox_operation_unsupported");
    const host = rows[0];
    const imageRef = host.Config?.Image;
    if (!/^[a-f0-9]{64}$/.test(host.Id ?? "") || !host.Id.startsWith(selfId) ||
      host.State?.Running !== true || !/^sha256:[a-f0-9]{64}$/.test(host.Image ?? "") ||
      typeof imageRef !== "string" || !/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(imageRef) ||
      !path.posix.isAbsolute(process.execPath) || path.posix.normalize(process.execPath) !== process.execPath ||
      Number.parseInt(process.versions.node.split(".")[0], 10) !== 24)
      throw new Error("sandbox_operation_unsupported");
    const imageRows = await docker(["image", "inspect", host.Image], deadlineAt);
    if (!Array.isArray(imageRows) || imageRows.length !== 1 || imageRows[0].Id !== host.Image ||
      !Array.isArray(imageRows[0].RepoDigests) || !imageRows[0].RepoDigests.includes(imageRef))
      throw new Error("sandbox_operation_unsupported");
    return { imageId: host.Image, imageRef, nodePath: process.execPath, hostContainerId: host.Id };
  }
  function nativeErasureSessionKey(binding, descriptor, scope) {
    return binding && binding.companyId === scope.companyId && binding.runId === descriptor.runId &&
      binding.runnerInstanceId === descriptor.runnerInstanceId &&
      binding.nativeSessionIdDigest === descriptor.sessionDigest && binding.leaseId === descriptor.leaseId &&
      binding.bindingId === scope.bindingId && binding.cellId === scope.cellId &&
      binding.generation === scope.cellGeneration && binding.hostEpoch === epoch &&
      binding.policyHash === descriptor.policyHash;
  }
  function expectedErasureTarget(request, workload, commandId) {
    const descriptor = request.nativeSessionErasure;
    const scopeEntry = journal.scopes[request.scope.bindingId];
    const creation = scopeEntry?.creation;
    const applied = scopeEntry?.policy;
    const session = journal.modelBrokerSessions?.[descriptor?.sessionKey];
    const taskRoot = descriptor?.taskRoot;
    if (!descriptor || descriptor.schema !== "paperclip.remote-native-session-erasure.v1" ||
      !/^[a-f0-9]{64}$/.test(descriptor.startBindingDigest ?? "") ||
      !/^[a-f0-9]{64}$/.test(descriptor.sessionKey ?? "") || !uuid.test(descriptor.leaseId ?? "") ||
      !/^[a-f0-9]{64}$/.test(descriptor.sessionDigest ?? "") || !/^[a-f0-9]{64}$/.test(descriptor.policyHash ?? "") ||
      !uuid.test(descriptor.runId ?? "") || !uuid.test(descriptor.runnerInstanceId ?? "") ||
      descriptor.cellGeneration !== request.scope.cellGeneration || descriptor.imageDigest !== request.imageDigest ||
      descriptor.dockerEngineIdHash !== journal.scopes[request.scope.bindingId]?.dockerEngineId ||
      descriptor.containerId !== workload.Id || workload.State?.Running !== false ||
      !creation || creation.purpose !== "admission" || creation.sandboxId !== descriptor.sandboxId ||
      creation.containerId !== descriptor.containerId || creation.imageDigest !== descriptor.imageDigest ||
      typeof creation.workdirPath !== "string" || !path.posix.isAbsolute(creation.workdirPath) ||
      path.posix.normalize(creation.workdirPath) !== creation.workdirPath || taskRoot !== creation.workdirPath ||
      workload.Config?.WorkingDir !== creation.workdirPath ||
      workload.Config?.Labels?.["openshell.ai/workspace-root"] !== creation.workdirPath ||
      applied?.policyHash !== descriptor.policyHash || !applied?.document ||
      applied.document.process?.run_as_user === undefined || applied.document.process?.run_as_group === undefined ||
      !session || !["stopped", "revoked"].includes(session.state) ||
      !nativeErasureSessionKey(session.binding, descriptor, request.scope) ||
      session.startBindingDigest !== descriptor.startBindingDigest ||
      (session.erasure && (typeof session.erasure !== "object" ||
        session.erasure.sessionKey !== descriptor.sessionKey ||
        session.erasure.startBindingDigest !== descriptor.startBindingDigest ||
        !uuid.test(session.erasure.commandId ?? "") ||
        (! ["verified", "reconciled"].includes(session.erasure.phase) && session.erasure.commandId !== commandId) ||
        !["claimed", "lower_checked", "helper_create_claimed", "helper_start_claimed", "upper_preflight_complete", "upper_erased", "verified", "reconciled"]
          .includes(session.erasure.phase))))
      throw new Error("sandbox_scope_changed");
    if (Object.entries(journal.modelBrokerSessions ?? {}).some(([key, other]) => key !== descriptor.sessionKey && other &&
      other.binding?.bindingId === request.scope.bindingId && other.binding?.cellId === request.scope.cellId &&
      other.binding?.generation === request.scope.cellGeneration &&
      other.binding?.nativeSessionIdDigest === descriptor.sessionDigest &&
      !["stopped", "revoked"].includes(other.state)))
      throw new Error("sandbox_scope_changed");
    const uidText = applied.document.process.run_as_user;
    const gidText = applied.document.process.run_as_group;
    if (!/^[1-9][0-9]{0,8}$/.test(uidText) || !/^[0-9]{1,9}$/.test(gidText))
      throw new Error("sandbox_operation_unsupported");
    return {
      descriptor,
      session,
      creation,
      applied,
      taskRoot,
      workloadImageId: workload.Image,
      uid: Number(uidText),
      gid: Number(gidText),
      targetPath: path.posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions", descriptor.sessionDigest),
      sessionsPath: path.posix.join(taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions"),
    };
  }
  async function readArchivePresence(containerId, targetPath, deadlineAt) {
    const status = await dockerArchiveHead(containerId, targetPath, deadlineAt);
    if (status !== 200 && status !== 404) throw new Error("sandbox_observation_unavailable");
    return status === 200;
  }
  async function archiveAbsence(containerId, targetPath, deadlineAt) {
    const [rootPresent, targetPresent] = await Promise.all([
      readArchivePresence(containerId, "/", deadlineAt),
      readArchivePresence(containerId, targetPath, deadlineAt),
    ]);
    return archiveStatusProvesAbsence(rootPresent ? 200 : 404, targetPresent ? 200 : 404);
  }
  async function namedErasureHelper(name, deadlineAt) {
    const output = await docker(["ps", "-aq", "--no-trunc", "--filter", `name=^/${name}$`], deadlineAt, false);
    const ids = output.trim().split(/\s+/).filter(Boolean);
    if (ids.length > 1 || ids.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error("sandbox_observation_unavailable");
    if (!ids.length) return null;
    const rows = await docker(["inspect", ids[0]], deadlineAt);
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].Id !== ids[0] || rows[0].Name !== `/${name}` ||
      rows[0].Config?.Labels?.["aw.native_session_erasure"] !== "true" ||
      rows[0].Config?.Labels?.["aw.native_session_erasure_name"] !== name)
      throw new Error("sandbox_scope_changed");
    return rows[0];
  }
  function erasureHelperOutput(containerInfo, expected) {
    const mounts = Array.isArray(containerInfo.Mounts) ? containerInfo.Mounts.map(mount => ({
      source: mount.Source, destination: mount.Destination, rw: mount.RW,
    })).sort((a, b) => a.destination.localeCompare(b.destination)) : [];
    const expectedMounts = expected.mounts.slice().sort((a, b) => a.destination.localeCompare(b.destination));
    if (!["created", "running", "exited"].includes(containerInfo.State?.Status) ||
      containerInfo.Config?.Labels?.["aw.native_session_erasure_name"] !== expected.name ||
      containerInfo.Image !== expected.imageId || containerInfo.Config?.Image !== expected.imageId ||
      containerInfo.Config?.Entrypoint?.length !== 1 || containerInfo.Config.Entrypoint[0] !== expected.nodePath ||
      !Array.isArray(containerInfo.Config?.Cmd) || containerInfo.Config.Cmd.length !== 8 ||
      containerInfo.Config.Cmd[0] !== "-e" || containerInfo.Config.Cmd[1] !== NATIVE_SESSION_UPPER_ERASE_SCRIPT ||
      containerInfo.Config.Cmd[2] !== expected.taskRoot || containerInfo.Config.Cmd[3] !== expected.digest ||
      containerInfo.Config.Cmd[4] !== expected.mode || containerInfo.Config.Cmd[5] !== expected.parentDev ||
      containerInfo.Config.Cmd[6] !== expected.parentIno || containerInfo.Config.Cmd[7] !== String(expected.expiresAt) ||
      containerInfo.HostConfig?.NetworkMode !== "none" || containerInfo.HostConfig?.ReadonlyRootfs !== true ||
      !dockerInspectRunAsMatches(containerInfo, `${expected.uid}:${expected.gid}`) ||
      containerInfo.HostConfig?.Privileged !== false || containerInfo.HostConfig?.CapAdd?.length ||
      containerInfo.HostConfig?.Devices?.length || containerInfo.HostConfig?.PidsLimit !== 16 ||
      containerInfo.HostConfig?.Memory !== 67108864 || containerInfo.HostConfig?.MemorySwap !== 67108864 ||
      containerInfo.HostConfig?.CpuPeriod !== 100000 || containerInfo.HostConfig?.CpuQuota !== 25000 ||
      !Array.isArray(containerInfo.HostConfig?.CapDrop) || !containerInfo.HostConfig.CapDrop.includes("ALL") ||
      !Array.isArray(containerInfo.HostConfig?.SecurityOpt) || !containerInfo.HostConfig.SecurityOpt.includes("no-new-privileges:true") ||
      (containerInfo.HostConfig?.UsernsMode && containerInfo.HostConfig.UsernsMode !== "") ||
      mounts.length !== expectedMounts.length || mounts.some((mount, index) =>
        mount.source !== expectedMounts[index].source || mount.destination !== expectedMounts[index].destination ||
        mount.rw !== expectedMounts[index].rw) ||
      !Array.isArray(containerInfo.Config?.Env) || containerInfo.Config.Env.some(value =>
        typeof value !== "string" || /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|AUTHORIZATION)/i.test(value)))
      throw new Error("sandbox_scope_changed");
  }
  async function reconcileErasureHelperAfterDeadline({ name, info, expected, mode, request, target, upperDir, mergedDir, deadlineAt }) {
    let current = await namedErasureHelper(name, deadlineAt);
    if (!current || current.Id !== info.Id) throw new Error("sandbox_scope_changed");
    erasureHelperOutput(current, expected);
    if (current.State?.Status === "running") {
      try { await docker(["kill", current.Id], deadlineAt, false); }
      catch { /* A lost kill response is resolved by exact inspect below. */ }
      current = (await docker(["inspect", current.Id], deadlineAt))[0];
    }
    if (!current || current.Id !== info.Id || current.State?.Status !== "exited")
      throw new Error("sandbox_observation_unavailable");
    erasureHelperOutput(current, expected);
    if (current.State?.ExitCode === 0) {
      const finishedAt = Date.parse(current.State.FinishedAt ?? "");
      if (mode === "erase" && (!Number.isFinite(finishedAt) || finishedAt > expected.expiresAt))
        throw new Error("sandbox_observation_unavailable");
      return { info: current, reconciled: false };
    }
    if (mode !== "erase") throw new Error("sandbox_observation_unavailable");
    const detail = await observed(request.scope, deadlineAt, {
      sandboxId: target.descriptor.sandboxId, containerId: target.descriptor.containerId,
    });
    const workload = await container(request.scope, detail, request.imageDigest, deadlineAt);
    if (detail.phase !== "Stopped" || detail.id !== target.descriptor.sandboxId ||
      workload.Id !== target.descriptor.containerId || workload.Image !== target.workloadImageId || workload.State?.Running !== false)
      throw new Error("sandbox_observation_unavailable");
    if (!(await archiveAbsence(workload.Id, target.targetPath, deadlineAt)))
      throw new Error("sandbox_observation_unavailable");
    const offline = await assertContainerOverlayOffline(workload, deadlineAt);
    if (offline.upperDir !== upperDir || offline.mergedDir !== mergedDir)
      throw new Error("sandbox_observation_unavailable");
    return { info: current, reconciled: true };
  }
  async function runErasureHelper({ name, hostImage, upperDir, sessionsPath, target, digest, mode, uid, gid,
    parentDev, parentIno, expiresAt, deadlineAt, commandId, request, mergedDir }) {
    let info = await namedErasureHelper(name, deadlineAt);
    if (!info) {
      const cmd = ["-e", NATIVE_SESSION_UPPER_ERASE_SCRIPT, target.taskRoot, digest, mode, parentDev, parentIno, String(expiresAt)];
      const mounts = [`type=bind,src=${upperDir},dst=/proof,readonly`];
      if (mode === "erase") mounts.push(`type=bind,src=${sessionsPath},dst=/sessions`);
      if ([upperDir, sessionsPath].some(value => value.includes(","))) throw new Error("sandbox_operation_unsupported");
      const helperLabels = ["--label", "aw.native_session_erasure=true", "--label", `aw.native_session_erasure_name=${name}`];
      const args = ["create", "--pull=never", "--name", name, ...helperLabels, "--network", "none", "--read-only",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--user", `${uid}:${gid}`,
        "--pids-limit", "16", "--memory", "67108864", "--memory-swap", "67108864",
        "--cpu-period", "100000", "--cpu-quota", "25000", "--mount", mounts[0],
        ...(mounts.length > 1 ? ["--mount", mounts[1]] : []), "--entrypoint", hostImage.nodePath,
        hostImage.imageId, ...cmd];
      const record = journal.commands[commandId];
      const prior = record?.nativeSessionErasure;
      if (!record || prior?.helperName && prior.helperName !== name && prior.phase !== "upper_preflight_complete")
        throw new Error("sandbox_scope_changed");
      await recordNativeErasure(commandId, "helper_create_claimed", { helperName: name,
        ...(prior?.helperName !== name ? { helperId: null } : {}) });
      try { await docker(args, deadlineAt, false); }
      catch { /* The deterministic name is inspected below; never create a second helper. */ }
      info = await namedErasureHelper(name, deadlineAt);
      if (!info) throw new Error("sandbox_observation_unavailable");
    }
    const expectedMounts = [{ source: upperDir, destination: "/proof", rw: false }];
    if (mode === "erase") expectedMounts.push({ source: sessionsPath, destination: "/sessions", rw: true });
    const expected = { name, imageId: hostImage.imageId, nodePath: hostImage.nodePath, taskRoot: target.taskRoot,
      digest, mode, parentDev, parentIno, expiresAt, uid, gid, mounts: expectedMounts };
    erasureHelperOutput(info, expected);
    const record = journal.commands[commandId];
    if (!record?.nativeSessionErasure || record.nativeSessionErasure.helperName !== name)
      throw new Error("sandbox_scope_changed");
    if (!record.nativeSessionErasure.helperId) record.nativeSessionErasure.helperId = info.Id;
    if (record.nativeSessionErasure.helperId !== info.Id) throw new Error("sandbox_scope_changed");
    await recordNativeErasure(commandId, record.nativeSessionErasure.phase, { helperId: info.Id });
    let reconciledAfterDeadline = false;
    try {
      if (info.State?.Status === "created") {
        if (record?.nativeSessionErasure?.helperId !== info.Id) throw new Error("sandbox_scope_changed");
        await recordNativeErasure(commandId, "helper_start_claimed", { helperId: info.Id });
        try { await docker(["start", info.Id], deadlineAt, false); } catch { /* Reconcile from inspect/wait only. */ }
      }
      info = (await docker(["inspect", info.Id], deadlineAt))[0];
      if (!info || info.Config?.Labels?.["aw.native_session_erasure_name"] !== name) throw new Error("sandbox_scope_changed");
      if (info.State?.Status === "running") {
        try { await docker(["wait", info.Id], deadlineAt, false, 15_000); }
        catch { throw new Error("sandbox_host_unavailable"); }
        info = (await docker(["inspect", info.Id], deadlineAt))[0];
      }
    } catch (error) {
      const recoveryDeadlineAt = new Date(Date.now() + 15_000).toISOString();
      try {
        const recovered = await reconcileErasureHelperAfterDeadline({ name, info, expected, mode, request, target, upperDir, mergedDir,
          deadlineAt: recoveryDeadlineAt });
        info = recovered.info;
        reconciledAfterDeadline = recovered.reconciled;
      } catch { throw new Error("sandbox_observation_unavailable"); }
      if (mode !== "erase" || info.State?.ExitCode !== 0)
        throw new Error("sandbox_observation_unavailable");
    }
    if (!info || info.State?.Status !== "exited" || info.State?.ExitCode !== 0)
      throw new Error("sandbox_observation_unavailable");
    erasureHelperOutput(info, expected);
    const stdout = reconciledAfterDeadline ? "already_absent\n" : await docker(["logs", "--tail", "2", info.Id], deadlineAt, false);
    const expectedOutput = mode === "inspect"
      ? /^(?:\{"parentPresent":false,"present":false\}|\{"parentPresent":true,"parentDev":"[0-9]+","parentIno":"[0-9]+","present":(?:true|false)\})\n$/
      : /^(?:erased|already_absent)\n$/;
    if (!expectedOutput.test(stdout)) throw new Error("sandbox_observation_unavailable");
    return { info, stdout };
  }
  async function removeOwnedErasureHelper(info, name, deadlineAt) {
    if (!info || info.Name !== `/${name}` || info.Config?.Labels?.["aw.native_session_erasure"] !== "true" ||
      info.Config?.Labels?.["aw.native_session_erasure_name"] !== name || info.State?.Running !== false)
      throw new Error("sandbox_scope_changed");
    await docker(["rm", "-v", info.Id], deadlineAt, false);
    const remaining = await namedErasureHelper(name, deadlineAt);
    if (remaining) throw new Error("sandbox_observation_unavailable");
  }
  async function reconcileCompletedErasureHelper(name, expectedId, deadlineAt) {
    if (!name || !expectedId) return;
    const info = await namedErasureHelper(name, deadlineAt);
    if (!info) return;
    if (info.Id !== expectedId || info.State?.Status !== "exited" || info.State?.ExitCode !== 0)
      throw new Error("sandbox_observation_unavailable");
    await removeOwnedErasureHelper(info, name, deadlineAt);
  }
  async function lowerImageProbe(target, workload, deadlineAt, commandId) {
    const name = `aw-native-lower-${commandId.replaceAll("-", "").slice(0, 32)}`;
    let info = await namedErasureHelper(name, deadlineAt);
    if (!info) {
      await docker(["create", "--pull=never", "--name", name,
        "--label", "aw.native_session_erasure=true", "--label", `aw.native_session_erasure_name=${name}`,
        "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
        "--user", `${target.uid}:${target.gid}`, "--pids-limit", "1", "--memory", "16777216",
        workload.Image], deadlineAt, false);
      info = await namedErasureHelper(name, deadlineAt);
    }
    if (!info || info.Image !== workload.Image || info.Config?.Image !== workload.Image || info.State?.Running !== false ||
      info.State?.Status !== "created" || info.HostConfig?.NetworkMode !== "none" || info.HostConfig?.ReadonlyRootfs !== true ||
      !Array.isArray(info.HostConfig?.CapDrop) || !info.HostConfig.CapDrop.includes("ALL") ||
      !Array.isArray(info.HostConfig?.SecurityOpt) || !info.HostConfig.SecurityOpt.includes("no-new-privileges:true"))
      throw new Error("sandbox_scope_changed");
    const volumes = info.Config?.Volumes;
    if (volumes && Object.keys(volumes).some(value => typeof value !== "string" || !path.posix.isAbsolute(value) ||
      path.posix.normalize(value) !== value || pathContains(value, target.taskRoot) || pathContains(target.taskRoot, value)))
      throw new Error("sandbox_operation_unsupported");
    const absent = await archiveAbsence(info.Id, target.targetPath, deadlineAt);
    await removeOwnedErasureHelper(info, name, deadlineAt);
    return absent;
  }
  async function recordNativeErasure(commandId, phase, extra = {}) {
    const record = journal.commands[commandId];
    if (!record || (record.nativeSessionErasure?.phase === "verified" && phase !== "verified"))
      throw new Error("sandbox_scope_changed");
    record.nativeSessionErasure = { ...(record.nativeSessionErasure ?? {}), ...extra, phase };
    const sessionKey = record.nativeSessionErasure.sessionKey;
    const session = journal.modelBrokerSessions?.[sessionKey];
    if (!session || !["stopped", "revoked"].includes(session.state) ||
      (! ["verified", "reconciled"].includes(session.erasure?.phase) &&
        session.erasure?.commandId && session.erasure.commandId !== commandId))
      throw new Error("sandbox_scope_changed");
    session.erasure = { ...(session.erasure ?? {}), ...record.nativeSessionErasure, commandId };
    await atomicJson(journalFile, journal);
  }
  function nativeErasureReply(descriptor) {
    return {
      action: "erase_native_session", erased: true, schema: descriptor.schema,
      startBindingDigest: descriptor.startBindingDigest, sessionKey: descriptor.sessionKey, leaseId: descriptor.leaseId,
      sessionDigest: descriptor.sessionDigest, policyHash: descriptor.policyHash, sandboxId: descriptor.sandboxId,
      containerId: descriptor.containerId, imageDigest: descriptor.imageDigest,
      dockerEngineIdHash: descriptor.dockerEngineIdHash, cellGeneration: descriptor.cellGeneration,
      runId: descriptor.runId, runnerInstanceId: descriptor.runnerInstanceId,
      upperLayerAbsent: true, mergedViewAbsent: true, stoppedBefore: true, stoppedAfter: true,
    };
  }
  async function reconcileExpiredNativeErasure(request, commandId, originalDeadlineAt) {
    const descriptor = request.nativeSessionErasure;
    const command = journal.commands[commandId];
    if (!descriptor || !command || !Number.isFinite(Date.parse(originalDeadlineAt)))
      throw new Error("sandbox_scope_changed");
    const recoveryDeadlineAt = new Date(Date.now() + 15000).toISOString();
    const expectedTarget = { sandboxId: descriptor.sandboxId, containerId: descriptor.containerId };
    const detail = await observed(request.scope, recoveryDeadlineAt, expectedTarget);
    const workload = await container(request.scope, detail, request.imageDigest, recoveryDeadlineAt);
    const target = expectedErasureTarget(request, workload, commandId);
    if (detail.phase !== "Stopped" || workload.State?.Running !== false ||
      !dockerDiskMountsMatch(workload, target.applied.document))
      throw new Error("sandbox_observation_unavailable");
    const offline = await assertContainerOverlayOffline(workload, recoveryDeadlineAt);
    const operation = command.nativeSessionErasure;
    let recoveredHelperExitCode = operation?.upperHelperExitCode;
    let recoveredHelperFinishedAt = operation?.upperHelperFinishedAt;
    let recoveredHelperOutput = operation?.upperHelperOutput;
    let recoveredUpperProof = operation?.upperProof;
    if (operation?.helperName) {
      const suffix = commandId.replaceAll("-", "").slice(0, 28);
      const proofName = "aw-native-proof-" + suffix;
      const eraseName = "aw-native-erase-" + suffix;
      const name = operation.helperName;
      if (name !== proofName && name !== eraseName) throw new Error("sandbox_scope_changed");
      const info = await namedErasureHelper(name, recoveryDeadlineAt);
      if (!info && operation.helperId) {
        const byId = await docker(["ps", "-aq", "--no-trunc", "--filter", `id=${operation.helperId}`], recoveryDeadlineAt, false);
        if (byId.trim()) throw new Error("sandbox_scope_changed");
      }
      if (info) {
        if (operation.helperId && info.Id !== operation.helperId) throw new Error("sandbox_scope_changed");
        const hostImage = await inspectHostAgentImage(recoveryDeadlineAt);
        const mode = name === proofName ? "inspect" : "erase";
        const parentDev = mode === "inspect" ? "0" : operation.upperProof?.parentDev;
        const parentIno = mode === "inspect" ? "0" : operation.upperProof?.parentIno;
        if (typeof parentDev !== "string" || typeof parentIno !== "string") throw new Error("sandbox_scope_changed");
        const mounts = [{ source: offline.upperDir, destination: "/proof", rw: false }];
        if (mode === "erase") mounts.push({ source: path.posix.join(offline.upperDir, target.sessionsPath.slice(1)), destination: "/sessions", rw: true });
        const expected = { name, imageId: hostImage.imageId, nodePath: hostImage.nodePath, taskRoot: target.taskRoot,
          digest: descriptor.sessionDigest, mode, parentDev, parentIno, expiresAt: Date.parse(originalDeadlineAt),
          uid: target.uid, gid: target.gid, mounts };
        erasureHelperOutput(info, expected);
        let stopped = info;
        if (info.State?.Status === "running") {
          try { await docker(["kill", info.Id], recoveryDeadlineAt, false); } catch { /* Confirm exact ID below. */ }
          stopped = (await docker(["inspect", info.Id], recoveryDeadlineAt))[0];
        }
        if (!stopped || stopped.Id !== info.Id || stopped.State?.Status === "running")
          throw new Error("sandbox_observation_unavailable");
        erasureHelperOutput(stopped, expected);
        if (name === eraseName && stopped.State?.Status === "exited") {
          recoveredHelperExitCode = stopped.State.ExitCode;
          recoveredHelperFinishedAt = stopped.State.FinishedAt;
          if (stopped.State.ExitCode === 0) {
            recoveredHelperOutput = (await docker(["logs", "--tail", "2", stopped.Id], recoveryDeadlineAt, false)).trim();
            if (!["erased", "already_absent"].includes(recoveredHelperOutput))
              throw new Error("sandbox_observation_unavailable");
            const finishedAt = Date.parse(recoveredHelperFinishedAt ?? "");
            if (Number.isFinite(finishedAt) && finishedAt <= Date.parse(originalDeadlineAt) && recoveredUpperProof)
              recoveredUpperProof = { ...recoveredUpperProof, present: false };
          }
        }
        await removeOwnedErasureHelper(stopped, name, recoveryDeadlineAt);
      }
    }
    const after = await observed(request.scope, recoveryDeadlineAt, expectedTarget);
    const workloadAfter = await container(request.scope, after, request.imageDigest, recoveryDeadlineAt);
    if (after.phase !== "Stopped" || after.id !== descriptor.sandboxId || workloadAfter.Id !== descriptor.containerId ||
      workloadAfter.State?.Running !== false || workloadAfter.Image !== workload.Image)
      throw new Error("sandbox_observation_unavailable");
    if (!(await readArchivePresence(workloadAfter.Id, "/", recoveryDeadlineAt)))
      throw new Error("sandbox_observation_unavailable");
    const targetPresent = await readArchivePresence(workloadAfter.Id, target.targetPath, recoveryDeadlineAt);
    const afterOffline = await assertContainerOverlayOffline(workloadAfter, recoveryDeadlineAt);
    if (offline.upperDir !== afterOffline.upperDir || offline.mergedDir !== afterOffline.mergedDir)
      throw new Error("sandbox_observation_unavailable");
    const oldWalkFinishedInTime = recoveredHelperExitCode === 0 &&
      Number.isFinite(Date.parse(recoveredHelperFinishedAt ?? "")) &&
      Date.parse(recoveredHelperFinishedAt) <= Date.parse(originalDeadlineAt) &&
      ["erased", "already_absent"].includes(recoveredHelperOutput ?? "");
    if (targetPresent === false && operation?.lowerImageAbsent === true && recoveredUpperProof?.present === false &&
      operation.upperDir === afterOffline.upperDir && operation.mergedDir === afterOffline.mergedDir &&
      (operation.phase === "verified" || oldWalkFinishedInTime) &&
      await lowerImageProbe(target, workloadAfter, recoveryDeadlineAt, commandId)) {
      await recordNativeErasure(commandId, "verified", { upperProof: recoveredUpperProof,
        lowerImageAbsent: true, upperDir: afterOffline.upperDir, mergedDir: afterOffline.mergedDir,
        upperHelperExitCode: recoveredHelperExitCode, upperHelperFinishedAt: recoveredHelperFinishedAt,
        upperHelperOutput: recoveredHelperOutput, mergedViewAbsent: true, recoveryObservedAt: new Date().toISOString() });
      return { success: true, reply: nativeErasureReply(descriptor), errorCode: null };
    }
    if (!command.nativeSessionErasure) command.nativeSessionErasure = {
      sessionKey: descriptor.sessionKey, startBindingDigest: descriptor.startBindingDigest,
    };
    await recordNativeErasure(commandId, "reconciled", { helperTerminated: true,
      originalDeadlineAt, reconciledAt: new Date().toISOString(), mergedTargetPresent: targetPresent });
    return { success: false, reply: null, errorCode: "sandbox_observation_unavailable" };
  }
  async function eraseStoppedNativeSession(request, beforeDetail, deadlineAt, commandId) {
    const scope = request.scope;
    const descriptor = request.nativeSessionErasure;
    const scopeEntry = journal.scopes[scope.bindingId];
    if (!scopeEntry?.dockerEngineId || scopeEntry.dockerEngineId !== descriptor.dockerEngineIdHash)
      throw new Error("sandbox_scope_changed");
    const workloadBefore = await container(scope, beforeDetail, request.imageDigest, deadlineAt);
    const target = expectedErasureTarget(request, workloadBefore, commandId);
    const savedErasure = journal.modelBrokerSessions?.[descriptor.sessionKey]?.erasure;
    const operationRecord = journal.commands[commandId];
    if (!operationRecord) throw new Error("sandbox_scope_changed");
    if (!operationRecord.nativeSessionErasure && savedErasure?.commandId === commandId) {
      operationRecord.nativeSessionErasure = { ...savedErasure };
      await atomicJson(journalFile, journal);
    }
    if (beforeDetail.phase !== "Stopped" || workloadBefore.State?.Running !== false ||
      !dockerDiskMountsMatch(workloadBefore, target.applied.document))
      throw new Error("sandbox_operation_unsupported");
    if (!journal.commands[commandId]?.nativeSessionErasure) {
      await recordNativeErasure(commandId, "claimed", {
        sessionKey: descriptor.sessionKey, startBindingDigest: descriptor.startBindingDigest,
      });
    } else if (journal.commands[commandId].nativeSessionErasure.sessionKey !== descriptor.sessionKey) {
      throw new Error("sandbox_scope_changed");
    }
    const originalTarget = { sandboxId: descriptor.sandboxId, containerId: descriptor.containerId };
    const expiresAt = Date.parse(journal.commands[commandId]?.operationDeadlineAt ?? "");
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("sandbox_host_unavailable");
    const hostImage = await inspectHostAgentImage(deadlineAt);
    const lowerAbsent = await lowerImageProbe(target, workloadBefore, deadlineAt, commandId);
    if (!lowerAbsent) throw new Error("sandbox_operation_unsupported");
    if (!(await readArchivePresence(workloadBefore.Id, "/", deadlineAt))) throw new Error("sandbox_observation_unavailable");
    const offlineBefore = await assertContainerOverlayOffline(workloadBefore, deadlineAt);
    await recordNativeErasure(commandId, "lower_checked", { lowerImageAbsent: true,
      upperDir: offlineBefore.upperDir, mergedDir: offlineBefore.mergedDir });
    const prior = journal.commands[commandId]?.nativeSessionErasure;
    const preflightName = `aw-native-proof-${commandId.replaceAll("-", "").slice(0, 28)}`;
    const eraseName = `aw-native-erase-${commandId.replaceAll("-", "").slice(0, 28)}`;
    if (prior?.preflightHelperName) {
      if (prior.preflightHelperName !== preflightName || !/^[a-f0-9]{64}$/.test(prior.preflightHelperId ?? ""))
        throw new Error("sandbox_scope_changed");
      await reconcileCompletedErasureHelper(preflightName, prior.preflightHelperId, deadlineAt);
    }
    if (prior?.upperHelperName && ["upper_erased", "verified"].includes(prior.phase)) {
      if (prior.upperHelperName !== eraseName || !/^[a-f0-9]{64}$/.test(prior.upperHelperId ?? ""))
        throw new Error("sandbox_scope_changed");
      await reconcileCompletedErasureHelper(eraseName, prior.upperHelperId, deadlineAt);
    }
    let upperProof = prior?.upperProof;
    if (upperProof && (typeof upperProof.parentPresent !== "boolean" || typeof upperProof.present !== "boolean" ||
      (upperProof.parentPresent && (!/^[0-9]+$/.test(upperProof.parentDev ?? "") || !/^[0-9]+$/.test(upperProof.parentIno ?? ""))) ||
      (!upperProof.parentPresent && upperProof.present)))
      throw new Error("sandbox_scope_changed");
    if (!upperProof) {
      const preflight = await runErasureHelper({ name: preflightName, hostImage, upperDir: offlineBefore.upperDir,
        sessionsPath: path.posix.join(offlineBefore.upperDir, target.sessionsPath.slice(1)), target, digest: descriptor.sessionDigest,
        mode: "inspect", uid: target.uid, gid: target.gid, parentDev: "0", parentIno: "0", expiresAt, deadlineAt,
        commandId, request, mergedDir: offlineBefore.mergedDir });
      const missingParent = preflight.stdout === "{\"parentPresent\":false,\"present\":false}\n";
      const match = preflight.stdout.match(/^\{"parentPresent":true,"parentDev":"([0-9]+)","parentIno":"([0-9]+)","present":(true|false)\}\n$/);
      if (!match && !missingParent) throw new Error("sandbox_observation_unavailable");
      upperProof = missingParent ? { parentPresent: false, present: false }
        : { parentPresent: true, parentDev: match[1], parentIno: match[2], present: match[3] === "true" };
      await recordNativeErasure(commandId, "upper_preflight_complete", {
        upperProof, preflightHelperName: preflightName, preflightHelperId: preflight.info.Id });
      await removeOwnedErasureHelper(preflight.info, preflightName, deadlineAt);
    }
    if (upperProof.present && !["upper_erased", "verified"].includes(prior?.phase)) {
      const sessionsPath = path.posix.join(offlineBefore.upperDir, target.sessionsPath.slice(1));
      const result = await runErasureHelper({ name: eraseName, hostImage, upperDir: offlineBefore.upperDir, sessionsPath, target,
        digest: descriptor.sessionDigest, mode: "erase", uid: target.uid, gid: target.gid,
        parentDev: upperProof.parentDev, parentIno: upperProof.parentIno, expiresAt, deadlineAt,
        commandId, request, mergedDir: offlineBefore.mergedDir });
      if (result.stdout !== "erased\n" && result.stdout !== "already_absent\n")
        throw new Error("sandbox_observation_unavailable");
      await recordNativeErasure(commandId, "upper_erased", {
        upperProof: { ...upperProof, present: false }, upperHelperName: eraseName, upperHelperId: result.info.Id,
        upperHelperFinishedAt: result.info.State?.FinishedAt ?? null, upperHelperExitCode: result.info.State?.ExitCode,
        upperHelperOutput: result.stdout.trim(),
      });
      await removeOwnedErasureHelper(result.info, eraseName, deadlineAt);
    }
    const afterDetail = await observed(scope, deadlineAt, originalTarget);
    const workloadAfter = await container(scope, afterDetail, request.imageDigest, deadlineAt);
    if (!(await archiveAbsence(workloadAfter.Id, target.targetPath, deadlineAt)))
      throw new Error("sandbox_observation_unavailable");
    const offlineAfter = await assertContainerOverlayOffline(workloadAfter, deadlineAt);
    if (afterDetail.phase !== "Stopped" || afterDetail.id !== descriptor.sandboxId || workloadAfter.Id !== descriptor.containerId ||
      workloadAfter.Image !== workloadBefore.Image || workloadAfter.State?.Running !== false ||
      offlineAfter.upperDir !== offlineBefore.upperDir || offlineAfter.mergedDir !== offlineBefore.mergedDir)
      throw new Error("sandbox_observation_unavailable");
    await recordNativeErasure(commandId, "verified", { upperProof: { ...upperProof, present: false }, mergedViewAbsent: true });
    return nativeErasureReply(descriptor);
  }
  async function observedRuntimeBinarySha256(containerId, deadlineAt) {
    if (!/^[a-f0-9]{64}$/.test(containerId ?? "")) return null;
    const privateConfig = await privateConfiguration();
    const destination = path.join(privateConfig.stateHome, `runtime-binary-${randomUUID()}`);
    try {
      await docker(["cp", `${containerId}:/.openshell/runtime/openshell-sandbox`, destination], deadlineAt, false);
      const [info, resolved] = await Promise.all([lstat(destination), realpath(destination)]);
      if (!info.isFile() || info.isSymbolicLink() || resolved !== destination ||
        info.size < 1 || info.size > 100 * 1024 * 1024) return null;
      return hash(await readFile(destination));
    } catch { return null; }
    finally { await unlink(destination).catch(() => {}); }
  }
  function validResourceLimits(value) {
    return value && Number.isSafeInteger(value.cpuMillis) && value.cpuMillis >= 100 && value.cpuMillis <= 64000 &&
      Number.isSafeInteger(value.memoryBytes) && value.memoryBytes >= 67108864 && value.memoryBytes <= 137438953472 &&
      Number.isSafeInteger(value.diskBytes) && value.diskBytes >= MIN_DISK_BYTES && value.diskBytes <= MAX_DISK_BYTES &&
      Number.isSafeInteger(value.pidsLimit) && value.pidsLimit >= 16 && value.pidsLimit <= 16384;
  }
  function validateProvisioning(request) {
    const value = request?.provisioning;
    const baseKeys = "bindingVersion,document,expiresAt,idleUntilUnixSeconds,operationKey,policyHash,provisioningHash,purpose,requestId,resourceLimits";
    const qualificationKeys = "bindingVersion,document,expiresAt,idleUntilUnixSeconds,operationKey,policyHash,probeFixtureHash,provisioningHash,purpose,qualificationProbeFixture,requestId,resourceLimits";
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== (value.purpose === "qualification" ? qualificationKeys : baseKeys) ||
      !["qualification", "admission"].includes(value.purpose) ||
      !Number.isSafeInteger(value.bindingVersion) || value.bindingVersion < 1 ||
      typeof value.operationKey !== "string" || value.operationKey.length < 1 || value.operationKey.length > 300 ||
      /[\r\n\0]/.test(value.operationKey) || typeof value.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.expiresAt)) || new Date(value.expiresAt).toISOString() !== value.expiresAt ||
      typeof value.requestId !== "string" || !uuid.test(value.requestId) ||
      !Number.isSafeInteger(value.idleUntilUnixSeconds) || value.idleUntilUnixSeconds < 1 ||
      value.idleUntilUnixSeconds !== Math.floor(Date.parse(value.expiresAt) / 1000) ||
      Date.parse(value.expiresAt) - Date.now() > 86_400_000 ||
      !/^[a-f0-9]{64}$/.test(value.policyHash ?? "") || !/^[a-f0-9]{64}$/.test(value.provisioningHash ?? "") ||
      !validResourceLimits(value.resourceLimits) || !validOpenShellDocument(value.document))
      throw new Error("sandbox_scope_changed");
    let configuredProbeFixture = null;
    if (value.purpose === "qualification") {
      const configured = qualificationProbeFixture();
      const expectedDocument = configured && qualificationProbePolicyDocument(configured);
      if (!configured || !expectedDocument || value.probeFixtureHash !== configured.fixtureHash ||
        !sameDocument(value.qualificationProbeFixture, configured) ||
        !sameDocument(value.document, expectedDocument) ||
        value.policyHash !== hash(JSON.stringify(canonical(expectedDocument))))
        throw new Error("sandbox_scope_changed");
      configuredProbeFixture = configured;
    }
    const envelope = {
      scope: { companyId: request.scope.companyId, bindingId: request.scope.bindingId,
        cellId: request.scope.cellId, cellGeneration: request.scope.cellGeneration,
        sandboxRef: request.scope.sandboxRef },
      hostEpoch: epoch,
      imageDigest: request.imageDigest,
      purpose: value.purpose,
      operationKey: value.operationKey,
      bindingVersion: value.bindingVersion,
      expiresAt: value.expiresAt,
      idleUntilUnixSeconds: value.idleUntilUnixSeconds,
      policyHash: value.policyHash,
      document: canonical(value.document),
      resourceLimits: canonical(value.resourceLimits),
      ...(configuredProbeFixture ? { qualificationProbeFixture: canonical(configuredProbeFixture),
        probeFixtureHash: configuredProbeFixture.fixtureHash } : {}),
    };
    const provisioningHash = hash(JSON.stringify(canonical(envelope)));
    if (provisioningHash !== value.provisioningHash || deterministicUuidFromHash(provisioningHash) !== value.requestId)
      throw new Error("sandbox_scope_changed");
    return { envelope, provisioningHash, requestId: deterministicUuidFromHash(provisioningHash),
      expired: Date.parse(value.expiresAt) <= Date.now() };
  }
  function dockerDiskStorageOptionMatches(container, limits) {
    const storageOpt = container?.HostConfig?.StorageOpt;
    return Number.isSafeInteger(limits?.diskBytes) &&
      storageOpt && Object.keys(storageOpt).length === 1 &&
      storageOpt.size === `${limits.diskBytes}B`;
  }
  function pathContains(parent, child) {
    if (typeof parent !== "string" || typeof child !== "string" ||
      !parent.startsWith("/") || !child.startsWith("/")) return false;
    const normalizedParent = path.posix.normalize(parent), normalizedChild = path.posix.normalize(child);
    return normalizedParent === "/" || normalizedChild === normalizedParent ||
      normalizedChild.startsWith(`${normalizedParent}/`);
  }
  function readOnlyPathAllows(document, target) {
    const paths = document?.filesystem_policy?.read_only;
    return Array.isArray(paths) && paths.some(value => pathContains(value, target));
  }
  function filesystemPathAllowed(document, target) {
    const paths = [...(document?.filesystem_policy?.read_only ?? []),
      ...(document?.filesystem_policy?.read_write ?? [])];
    return paths.some(value => pathContains(value, target));
  }
  function canonicalFixturePath(value, allowTraversal = false) {
    return typeof value === "string" && value.length > 0 && value.length <= 512 &&
      value.startsWith("/") && !/[\r\n\0]/.test(value) &&
      value.split("/").every(part => part !== "." && (allowTraversal || part !== "..")) &&
      (allowTraversal || path.posix.normalize(value) === value);
  }
  function filesystemProbeFixture() {
    const value = config?.qualificationFixtures?.filesystem;
    if (!value || Object.keys(value).sort().join(",") !==
      "allowedReadMarker,allowedReadPath,deniedReadMarker,deniedReadPath,escapeOperand,escapeReadMarker,escapeTargetPath,escapeViaRoot,workdirPath" ||
      !canonicalFixturePath(value.allowedReadPath) || !canonicalFixturePath(value.deniedReadPath) ||
      !canonicalFixturePath(value.escapeViaRoot) || !canonicalFixturePath(value.escapeTargetPath) ||
      !canonicalFixturePath(value.workdirPath) ||
      !canonicalFixturePath(value.escapeOperand, true) || !value.escapeOperand.split("/").includes("..") ||
      path.posix.resolve(value.escapeOperand) !== value.escapeTargetPath ||
      !pathContains(value.escapeViaRoot, value.escapeOperand.split("/").slice(0, value.escapeOperand.split("/").indexOf(".." )).join("/")) ||
      !/^[A-Za-z0-9]$/.test(value.allowedReadMarker ?? "") ||
      !/^[A-Za-z0-9]$/.test(value.deniedReadMarker ?? "") ||
      !/^[A-Za-z0-9]$/.test(value.escapeReadMarker ?? "") ||
      value.allowedReadPath === value.deniedReadPath || value.deniedReadPath === value.escapeTargetPath ||
      value.workdirPath === "/" ||
      pathContains(value.workdirPath, value.escapeTargetPath) || pathContains(value.escapeTargetPath, value.workdirPath) ||
      pathContains(value.workdirPath, value.deniedReadPath) || pathContains(value.deniedReadPath, value.workdirPath) ||
      pathContains(value.workdirPath, value.escapeViaRoot) || pathContains(value.escapeViaRoot, value.workdirPath))
      return null;
    return value;
  }
  function noncePolicyPath(item) {
    let target;
    try { target = new URL(item.urlTemplate.replace("{nonce}", "AWQUALIFICATIONNONCE")); }
    catch { return null; }
    const segments = target.pathname.split("/");
    if (item.urlTemplate.split("{nonce}").length !== 2 || target.search || target.hash ||
      segments.filter(value => value === "AWQUALIFICATIONNONCE").length !== 1) return null;
    return segments.map(value => value === "AWQUALIFICATIONNONCE" ? "?".repeat(32) : value).join("/");
  }
  function networkProbeFixture() {
    const value = config?.qualificationFixtures?.network;
    const cases = ["allow", "hostPortDeny", "wrongHostDeny", "redirectDeny", "dnsRedirectDeny", "l7Allow", "l7Deny"];
    if (!value || Object.keys(value).sort().join(",") !== ["version", ...cases].sort().join(",") || value.version !== 1)
      return null;
    for (const key of cases) {
      const item = value[key];
      const expectedKeys = key === "dnsRedirectDeny"
        ? "marker,method,resolveIp,urlTemplate"
        : "marker,method,urlTemplate";
      if (!item || Object.keys(item).sort().join(",") !== expectedKeys ||
        typeof item.urlTemplate !== "string" || item.urlTemplate.length > 1024 ||
        item.urlTemplate.split("{nonce}").length !== 2 ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(item.marker ?? "") ||
        !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(item.method)) return null;
      const rawUrl = item.urlTemplate.replace("{nonce}", "qualification-attempt");
      let url;
      try { url = new URL(rawUrl); } catch { return null; }
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
        url.search || url.hash || url.pathname.includes("..") ||
        !url.pathname.startsWith("/") || !noncePolicyPath(item) || /[%*?\[\]]/.test(url.pathname) ||
        /[\r\n\0]/.test(item.urlTemplate)) return null;
      if (key === "dnsRedirectDeny") {
        const ip = item.resolveIp.toLowerCase();
        if (isIP(ip) === 0 || ip === "::" || ip === "::1" || ip.startsWith("fe80:") ||
          ip.startsWith("ff") || ip.startsWith("127.") || ip.startsWith("169.254.") || ip === "0.0.0.0")
          return null;
      }
    }
    return value;
  }
  function networkEndpoint(document, value, { l7 = false } = {}) {
    let target;
    try { target = new URL(value.urlTemplate.replace("{nonce}", "qualification-attempt")); }
    catch { return null; }
    const host = target.hostname.toLowerCase();
    const port = Number(target.port || 443);
    const policies = document?.network_policies;
    if (!policies || typeof policies !== "object" || Array.isArray(policies)) return null;
    for (const rule of Object.values(policies)) {
      if (!rule || !Array.isArray(rule.binaries) || !rule.binaries.some(binary => binary?.path === "/usr/bin/curl") ||
        !Array.isArray(rule.endpoints)) continue;
      for (const endpoint of rule.endpoints) {
        if (!endpoint || typeof endpoint.host !== "string" || endpoint.host.toLowerCase() !== host) continue;
        const ports = Array.isArray(endpoint.ports) && endpoint.ports.length
          ? endpoint.ports : [endpoint.port || 443];
        if (!ports.includes(port)) continue;
        if (l7 && (endpoint.protocol !== "rest" || endpoint.enforcement !== "enforce")) continue;
        return { host, port, endpoint };
      }
    }
    return null;
  }
  function networkProbeAvailability(document, fixture) {
    if (!fixture) return { destination: false, l7: false };
    const allow = networkEndpoint(document, fixture.allow);
    const l7Allow = networkEndpoint(document, fixture.l7Allow, { l7: true });
    const l7Deny = networkEndpoint(document, fixture.l7Deny, { l7: true });
    const deniedPort = networkEndpoint(document, fixture.hostPortDeny);
    const deniedHost = networkEndpoint(document, fixture.wrongHostDeny);
    const redirect = networkEndpoint(document, fixture.redirectDeny);
    const dnsRedirect = networkEndpoint(document, fixture.dnsRedirectDeny);
    return {
      destination: Boolean(allow && !deniedPort && !deniedHost && redirect && dnsRedirect),
      l7: Boolean(l7Allow && l7Deny),
    };
  }
  async function directCanaryHttp(workload, uid, gid, item, nonce, deadlineAt, options = {}) {
    const command = canaryHttpArgs(item, nonce, { direct: true, ...options });
    try {
      const output = await docker(["exec", "--user", `${uid}:${gid}`, workload.Id, ...command], deadlineAt, false);
      const split = output.lastIndexOf("\n");
      if (split < 0 || !/^\d{3}$/.test(output.slice(split + 1))) return null;
      return { body: output.slice(0, split), status: Number(output.slice(split + 1)) };
    } catch { return null; }
  }
  async function sandboxCanaryHttp(scope, sandboxId, item, nonce, deadlineAt, options = {}) {
    const command = canaryHttpArgs(item, nonce, options);
    return sandboxExec(scope, sandboxId, command, deadlineAt);
  }
  function canaryHttpArgs(item, nonce, { direct = false, resolve = false, follow = false } = {}) {
    const url = item.urlTemplate.replace("{nonce}", nonce);
    const parsed = new URL(url);
    const args = ["/usr/bin/curl", "--silent", "--show-error", "--connect-timeout", "2",
      "--max-time", "3", "--max-filesize", "512", "--output", "-",
      "--write-out", "\\n%{http_code}", "--request", item.method];
    if (direct) args.push("--noproxy", "*");
    if (resolve) args.push("--resolve", `${parsed.hostname}:${parsed.port || 443}:${item.resolveIp}`);
    if (follow) args.push("--location", "--max-redirs", "1");
    args.push("--", url);
    return args;
  }
  function parseCanaryHttp(result) {
    if (!result || result.exitCode !== 0 || typeof result.stdout !== "string") return null;
    const split = result.stdout.lastIndexOf("\n");
    if (split < 0 || !/^\d{3}$/.test(result.stdout.slice(split + 1))) return null;
    return { body: result.stdout.slice(0, split), status: Number(result.stdout.slice(split + 1)) };
  }
  function qualificationFixtureHash() {
    return qualificationProbeFixture()?.fixtureHash ?? null;
  }
  function qualificationCredentialFixture() {
    const value = config?.qualificationFixtures?.credential;
    const keys = "argumentTemplateHash,binaries,fixtureHash,fixtureId,gatewayPublicId,marker,method,origin,port,profileHash,profileId,toolName,version,wrongBinaryPath,wrongToolName";
    if (!value || Object.keys(value).sort().join(",") !== keys || value.version !== 1 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(value.fixtureId ?? "") ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value.profileId ?? "") ||
      !/^[a-f0-9]{64}$/.test(value.profileHash ?? "") ||
      !/^[a-f0-9]{64}$/.test(value.argumentTemplateHash ?? "") ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(value.marker ?? "") || value.method !== "POST" ||
      !Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535 ||
      !Array.isArray(value.binaries) || value.binaries.length !== 1 ||
      value.binaries[0] !== "/usr/bin/curl" || value.wrongBinaryPath !== "/usr/bin/wget" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(value.gatewayPublicId ?? "") ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value.toolName ?? "") ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value.wrongToolName ?? "") ||
      value.toolName === value.wrongToolName) return null;
    let origin;
    try { origin = new URL(value.origin); } catch { return null; }
    if (origin.protocol !== "https:" || origin.origin !== value.origin || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash || Number(origin.port || 443) !== value.port) return null;
    const base = { version: value.version, fixtureId: value.fixtureId, profileId: value.profileId,
      profileHash: value.profileHash, binaries: value.binaries, origin: value.origin, port: value.port,
      method: value.method, gatewayPublicId: value.gatewayPublicId, toolName: value.toolName,
      wrongToolName: value.wrongToolName, wrongBinaryPath: value.wrongBinaryPath,
      argumentTemplateHash: value.argumentTemplateHash, marker: value.marker };
    const fixtureHash = hash(JSON.stringify(canonical(base)));
    return value.fixtureHash === fixtureHash ? { ...base, fixtureHash } : null;
  }
  function qualificationProbeFixture() {
    const filesystem = filesystemProbeFixture(), network = networkProbeFixture();
    const runAsUser = config?.qualificationFixtures?.runAsUser;
    const runAsGroup = config?.qualificationFixtures?.runAsGroup;
    if (!filesystem || !network || !/^[1-9][0-9]{0,8}$/.test(runAsUser ?? "") ||
      !/^[0-9]{1,9}$/.test(runAsGroup ?? "") || runAsGroup === "0") return null;
    const credential = qualificationCredentialFixture();
    const base = { version: 1, runAsUser, runAsGroup, filesystem, network,
      ...(credential ? { credential } : {}) };
    return { ...base, fixtureHash: hash(JSON.stringify(canonical(base))) };
  }
  function qualificationProbePolicyDocument(fixture = qualificationProbeFixture()) {
    if (!fixture || fixture.version !== 1 || fixture.fixtureHash !== hash(JSON.stringify(canonical({
      version: fixture.version, runAsUser: fixture.runAsUser, runAsGroup: fixture.runAsGroup,
      filesystem: fixture.filesystem, network: fixture.network,
      ...(fixture.credential ? { credential: fixture.credential } : {}),
    })))) return null;
    const filesystem = fixture.filesystem;
    const readOnly = ["/.openshell/runtime", "/bin", "/etc", "/usr/bin", "/proc",
      "/proc/self/status", "/proc/sys/net/ipv4/ip_unprivileged_port_start",
      "/proc/sys/kernel/cap_last_cap", "/sys/fs/cgroup", filesystem.allowedReadPath,
      filesystem.escapeViaRoot];
    const endpoints = new Map();
    const addEndpoint = (item, rule) => {
      let target;
      try { target = new URL(item.urlTemplate.replace("{nonce}", "a".repeat(32))); }
      catch { return false; }
      const port = Number(target.port || 443), key = `${target.hostname.toLowerCase()}\0${port}`;
      const entry = endpoints.get(key) ?? { host: target.hostname.toLowerCase(), port,
        protocol: "rest", enforcement: "enforce", rules: [] };
      if (rule && !entry.rules.some(value => sameDocument(value, rule))) entry.rules.push(rule);
      endpoints.set(key, entry);
      return true;
    };
    for (const key of ["allow", "redirectDeny", "dnsRedirectDeny", "l7Allow"]) {
      const item = fixture.network[key], pathValue = noncePolicyPath(item);
      if (!pathValue || !addEndpoint(item, { allow: { method: item.method, path: pathValue } })) return null;
    }
    {
      let deniedL7Url;
      try { deniedL7Url = new URL(fixture.network.l7Deny.urlTemplate.replace("{nonce}", "a".repeat(32))); }
      catch { return null; }
      const port = Number(deniedL7Url.port || 443), key = `${deniedL7Url.hostname.toLowerCase()}\0${port}`;
      const endpoint = endpoints.get(key) ?? { host: deniedL7Url.hostname.toLowerCase(), port,
        protocol: "rest", enforcement: "enforce", rules: [] };
      const method = fixture.network.l7Deny.method === "GET" ? "POST" : "GET";
      const sentinel = { allow: { method, path: "/__aw_qualification_l7_sentinel__" } };
      if (!endpoint.rules.some(value => sameDocument(value, sentinel))) endpoint.rules.push(sentinel);
      endpoints.set(key, endpoint);
    }
    if (fixture.credential) {
      const credential = fixture.credential;
      if (!addEndpoint({ urlTemplate: `${credential.origin.replace(/\/$/, "")}/mcp/gateways/${credential.gatewayPublicId}` },
        { allow: { method: "POST", path: `/mcp/gateways/${credential.gatewayPublicId}` } })) return null;
    }
    const networkPolicies = {};
    const sortedEndpoints = [...endpoints.values()].sort((a, b) =>
      (a.host < b.host ? -1 : a.host > b.host ? 1 : a.port - b.port));
    sortedEndpoints
      .forEach((endpoint, index) => {
        endpoint.rules.sort((a, b) => JSON.stringify(canonical(a.allow)).localeCompare(JSON.stringify(canonical(b.allow))));
        networkPolicies[`aw_probe_${index}`] = { name: `aw_probe_${index}`,
          binaries: [{ path: "/usr/bin/curl" }], endpoints: [endpoint] };
      });
    const canonicalReadOnly = [...new Set(readOnly)].sort();
    if (canonicalReadOnly.some(root => pathContains(root, filesystem.workdirPath) ||
      pathContains(filesystem.workdirPath, root)) ||
      canonicalReadOnly.some(root => pathContains(root, filesystem.deniedReadPath) ||
        pathContains(root, filesystem.escapeTargetPath))) return null;
    return {
      version: 1,
      filesystem_policy: { include_workdir: false, read_only: canonicalReadOnly,
        read_write: [filesystem.workdirPath] },
      landlock: { compatibility: "hard_requirement" },
      process: { run_as_user: fixture.runAsUser, run_as_group: fixture.runAsGroup },
      network_policies: networkPolicies,
    };
  }
  function qualificationCredentialClaim(request, commandId, fixture, provisioning, deadlineAt, targetQualificationHash) {
    const token = request?.probe?.qualificationCredentialCapability;
    const nonce = request?.probe?.qualificationCredentialNonce;
    if (typeof token !== "string" || token.length < 32 || token.length > 8192 ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(nonce ?? "") || !uuid.test(commandId ?? "")) return null;
    let decoded;
    try { decoded = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); }
    catch { return null; }
    const claim = decoded?.qualification_credential;
    const keys = ["argumentTemplateHash", "argumentsHash", "aud", "bindingVersion", "binaries", "caseId",
      "commandId", "connectionId", "containerId", "expiresAt", "fixtureHash", "fixtureId", "gatewayPublicId",
      "grantId", "hostEpoch", "jti", "maxUses", "method", "nonce", "operatorSessionId", "operatorUserId",
      "origin", "path", "profileHash", "profileId", "provisioningHash", "purpose", "requestBodyHash",
      "sandboxId", "scope", "secretVersionHash", "sourceBindingHash", "targetQualificationHash", "toolName", "version"];
    const args = { caseId: request.probe.caseId, fixtureId: fixture.fixtureId, nonce };
    const body = { jsonrpc: "2.0", id: commandId, method: "tools/call",
      params: { name: fixture.toolName, arguments: args } };
    const exactScope = {
      companyId: request.scope.companyId, bindingId: request.scope.bindingId, cellId: request.scope.cellId,
      generation: request.scope.cellGeneration, sandboxRef: request.scope.sandboxRef,
    };
    const expiresAt = Date.parse(claim?.expiresAt ?? "");
    if (!claim || Object.keys(claim).sort().join(",") !== keys.sort().join(",") ||
      decoded.purpose !== "sandbox_qualification_broker" || decoded.aud !== "paperclip-sandbox-qualification" ||
      claim.version !== 1 || claim.purpose !== "qualification_credential_probe" || claim.aud !== "paperclip-sandbox-qualification" ||
      typeof claim.jti !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(claim.jti) || decoded.jti !== claim.jti ||
      !Number.isSafeInteger(decoded.exp) || decoded.exp !== Math.floor(expiresAt / 1000) ||
      !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.parse(deadlineAt) ||
      expiresAt - Date.now() > 60_000 || claim.commandId !== commandId || claim.caseId !== request.probe.caseId ||
      claim.fixtureId !== fixture.fixtureId || claim.fixtureHash !== fixture.fixtureHash ||
      claim.hostEpoch !== epoch || !Number.isSafeInteger(claim.bindingVersion) ||
      claim.bindingVersion !== provisioning.bindingVersion || claim.sandboxId !== provisioning.sandboxId ||
      !/^[a-f0-9]{64}$/.test(claim.containerId ?? "") || claim.containerId !== provisioning.containerId ||
      claim.provisioningHash !== provisioning.provisioningHash ||
      claim.profileId !== fixture.profileId || claim.profileHash !== fixture.profileHash ||
      JSON.stringify(claim.binaries) !== JSON.stringify(fixture.binaries) ||
      claim.gatewayPublicId !== fixture.gatewayPublicId || claim.toolName !== fixture.toolName ||
      claim.argumentTemplateHash !== fixture.argumentTemplateHash ||
      claim.argumentsHash !== hash(JSON.stringify(canonical(args))) ||
      claim.requestBodyHash !== hash(JSON.stringify(canonical(body))) || claim.nonce !== nonce ||
      claim.targetQualificationHash !== targetQualificationHash ||
      claim.origin !== fixture.origin || claim.method !== "POST" ||
      claim.path !== `/mcp/gateways/${fixture.gatewayPublicId}` || claim.maxUses !== 1 ||
      JSON.stringify(canonical(claim.scope)) !== JSON.stringify(canonical(exactScope)) ||
      !uuid.test(claim.connectionId ?? "") || !uuid.test(claim.grantId ?? "") ||
      !/^[a-f0-9]{64}$/.test(claim.secretVersionHash ?? "") ||
      !/^[a-f0-9]{64}$/.test(claim.sourceBindingHash ?? "") ||
      typeof claim.operatorUserId !== "string" || claim.operatorUserId.length < 1 || claim.operatorUserId.length > 200 ||
      typeof claim.operatorSessionId !== "string" || claim.operatorSessionId.length < 1 || claim.operatorSessionId.length > 200)
      return null;
    return { token, nonce, claim, expiresAt, args, body };
  }
  function qualificationCredentialPolicyAvailable(document, fixture) {
    if (!fixture || !document?.network_policies || typeof document.network_policies !== "object") return false;
    const path = `/mcp/gateways/${fixture.gatewayPublicId}`;
    let positive = false;
    for (const rule of Object.values(document.network_policies)) {
      if (!Array.isArray(rule?.binaries) || !Array.isArray(rule?.endpoints)) continue;
      const hasCurl = rule.binaries.some(binary => binary?.path === "/usr/bin/curl");
      const hasWrongBinary = rule.binaries.some(binary => binary?.path === fixture.wrongBinaryPath);
      for (const endpoint of rule.endpoints) {
        if (endpoint?.host !== new URL(fixture.origin).hostname || endpoint?.port !== fixture.port ||
          endpoint.protocol !== "rest" || endpoint.enforcement !== "enforce") continue;
        const permitted = (endpoint.rules ?? []).some(item => item?.allow?.method === "POST" && item.allow.path === path);
        if (permitted && hasCurl && !hasWrongBinary) positive = true;
        // A broad or wrong-binary match makes the profile non-authoritative.
        if (permitted && hasWrongBinary) return false;
      }
    }
    return positive;
  }
  async function inspectQualificationCredentialProfile(fixture, deadlineAt) {
    const profile = await cli(["profile", "describe", fixture.profileId, "--output", "json"], deadlineAt);
    if (!profile || profile.id !== fixture.profileId || hash(JSON.stringify(canonical(profile))) !== fixture.profileHash ||
      !Array.isArray(profile.credentials) || profile.credentials.length !== 1 ||
      !Array.isArray(profile.endpoints) || profile.endpoints.length !== 1 ||
      !Array.isArray(profile.binaries) || profile.binaries.length !== 1 ||
      profile.binaries[0]?.path !== "/usr/bin/curl" || Object.keys(profile.binaries[0] ?? {}).length !== 1)
      throw new Error("sandbox_operation_unsupported");
    const credential = profile.credentials[0];
    if (credential?.auth_style !== "bearer" || credential.header_name?.toLowerCase() !== "authorization" ||
      JSON.stringify(credential.env_vars) !== JSON.stringify([QUALIFICATION_CREDENTIAL_ENV]) ||
      credential.token_grant || credential.refresh)
      throw new Error("sandbox_operation_unsupported");
    const endpoint = profile.endpoints[0];
    const rules = endpoint?.rules;
    if (endpoint?.host !== new URL(fixture.origin).hostname || endpoint?.port !== fixture.port ||
      endpoint.protocol !== "rest" || endpoint.enforcement !== "enforce" ||
      endpoint.allow_uninspected_credentials === true || endpoint.path || !Array.isArray(rules) || rules.length !== 1 ||
      rules[0]?.allow?.method !== "POST" || rules[0]?.allow?.path !== `/mcp/gateways/${fixture.gatewayPublicId}`)
      throw new Error("sandbox_operation_unsupported");
  }
  async function qualificationCredentialProvider(scope, sandboxId, fixture, credential, commandId, deadlineAt, action) {
    const providerName = `awqc-${commandId.replaceAll("-", "")}`;
    const commandRecord = journal.commands[commandId];
    if (!commandRecord || commandRecord.qualificationCredentialProvider)
      throw new Error("sandbox_scope_changed");
    commandRecord.qualificationCredentialProvider = { name: providerName, sandboxId, scope };
    await atomicJson(journalFile, journal);
    let attached = false;
    let completed = false;
    try {
      await cli(["provider", "create", "--name", providerName, "--type", fixture.profileId,
        "--credential", QUALIFICATION_CREDENTIAL_ENV], deadlineAt, false,
      { [QUALIFICATION_CREDENTIAL_ENV]: credential.token });
      await cli(["provider", "update", providerName, "--credential-expires-at",
        `${QUALIFICATION_CREDENTIAL_ENV}=${new Date(credential.expiresAt).toISOString()}`], deadlineAt, false);
      const target = await observed(scope, deadlineAt);
      if (target.id !== sandboxId || target.phase !== "Ready") throw new Error("sandbox_scope_changed");
      const waitSeconds = Math.max(1, Math.min(15, Math.floor((Date.parse(deadlineAt) - Date.now()) / 1000)));
      await cli(["sandbox", "provider", "attach", scope.sandboxRef, providerName,
        "--expected-sandbox-id", sandboxId, "--wait", "--timeout", String(waitSeconds), "--output", "json"],
      deadlineAt, true, {}, 18_000);
      attached = true;
      const providers = await cli(["sandbox", "provider", "list", scope.sandboxRef,
        "--page-size", "16", "--output", "json"], deadlineAt);
      if (!Array.isArray(providers.providers) || !providers.providers.some(value => value?.name === providerName) ||
        providers.next_page_token !== "") throw new Error("sandbox_observation_unavailable");
      const before = await observed(scope, deadlineAt);
      if (before.id !== sandboxId || before.phase !== "Ready") throw new Error("sandbox_scope_changed");
      const result = await action();
      const after = await observed(scope, deadlineAt);
      if (after.id !== sandboxId || after.phase !== "Ready") throw new Error("sandbox_scope_changed");
      completed = true;
      return result;
    } finally {
      let cleaned = !attached;
      if (attached) {
        const current = await observed(scope, deadlineAt).catch(() => null);
        if (current?.id === sandboxId) {
          await cli(["sandbox", "provider", "detach", scope.sandboxRef, providerName,
            "--expected-sandbox-id", sandboxId, "--wait", "--timeout", "10", "--output", "json"],
          deadlineAt, true, {}, 12_000).catch(() => {});
          const providers = await cli(["sandbox", "provider", "list", scope.sandboxRef,
            "--page-size", "16", "--output", "json"], deadlineAt).catch(() => null);
          cleaned = Boolean(providers && Array.isArray(providers.providers) &&
            !providers.providers.some(value => value?.name === providerName) && providers.next_page_token === "");
        }
      }
      await cli(["provider", "delete", providerName], deadlineAt, false).catch(() => {});
      const latest = await observed(scope, deadlineAt).catch(() => null);
      if (latest?.id !== sandboxId || !cleaned) completed = false;
      delete commandRecord.qualificationCredentialProvider;
      await atomicJson(journalFile, journal);
      if (!completed) throw new Error("sandbox_observation_unavailable");
    }
  }
  async function reserveQualificationCredentialUse(commandId, claim) {
    const digest = hash(claim.jti);
    const command = journal.commands[commandId];
    if (!command || command.qualificationCredentialJtiHash || Object.entries(journal.commands).some(([id, value]) =>
      id !== commandId && value?.qualificationCredentialJtiHash === digest))
      throw new Error("sandbox_scope_changed");
    command.qualificationCredentialJtiHash = digest;
    await atomicJson(journalFile, journal);
  }
  async function qualificationCredentialCall(scope, sandboxId, fixture, credential, toolName, deadlineAt) {
    const body = { ...credential.body, params: { ...credential.body.params, name: toolName } };
    const bodyText = JSON.stringify(canonical(body));
    const url = `${fixture.origin.replace(/\/$/, "")}/mcp/gateways/${fixture.gatewayPublicId}`;
    const args = ["/usr/bin/curl", "--silent", "--show-error", "--connect-timeout", "2", "--max-time", "4",
      "--max-filesize", "2048", "--output", "-", "--write-out", "\\n%{http_code}", "--request", "POST",
      "--header", "Content-Type: application/json", "--data-binary", bodyText, "--", url];
    if (args.some(value => value.includes(credential.token))) throw new Error("sandbox_scope_changed");
    const result = await sandboxExec(scope, sandboxId, args, deadlineAt);
    return parseQualificationMcpResponse(result);
  }
  function parseQualificationMcpResponse(result) {
    if (!result || result.exitCode !== 0 || typeof result.stdout !== "string") return null;
    const split = result.stdout.lastIndexOf("\n");
    if (split < 0 || !/^\d{3}$/.test(result.stdout.slice(split + 1))) return null;
    let body;
    try { body = JSON.parse(result.stdout.slice(0, split)); } catch { return null; }
    return { status: Number(result.stdout.slice(split + 1)), body };
  }
  async function dockerCanaryRead(workload, uid, gid, target, marker, deadlineAt) {
    if (!/^[1-9][0-9]{0,8}$/.test(uid ?? "") || !/^[0-9]{1,9}$/.test(gid ?? "") ||
      !/^[A-Za-z0-9]$/.test(marker ?? "")) return null;
    try {
      const prefix = ["exec", "--user", `${uid}:${gid}`, workload.Id];
      const metadata = await docker([...prefix, "/usr/bin/stat", "-c", "%F:%a", target], deadlineAt, false);
      const match = metadata.trim().match(/^regular file:([0-7]{3,4})$/);
      if (!match || (Number.parseInt(match[1], 8) & 0o004) === 0) return null;
      const bytes = await docker([...prefix, "/usr/bin/head", "-c", "1", target], deadlineAt, false);
      return bytes === marker ? { marker, mode: match[1] } : null;
    } catch {
      return null;
    }
  }
  function dockerDiskMountsMatch(container, policyDocument) {
    const mounts = container?.Mounts;
    const labels = container?.Config?.Labels;
    const workdir = labels?.["openshell.ai/workspace-root"];
    if (!Array.isArray(mounts) || mounts.length > 32 ||
      typeof workdir !== "string" || !workdir.startsWith("/") ||
      path.posix.normalize(workdir) !== workdir || !labels) return false;
    const normalizedWorkdir = path.posix.normalize(workdir);
    const expectedChannelName = `openshell-channel-${hash(`${labels["openshell.ai/sandbox-namespace"]}\0${labels["openshell.ai/sandbox-id"]}`).slice(0, 32)}`;
    const hostTmpfs = container?.HostConfig?.Tmpfs;
    const caOption = hostTmpfs?.[DISK_CA_TMPFS_MOUNT];
    if (!hostTmpfs || Object.keys(hostTmpfs).length !== 1 ||
      typeof caOption !== "string" ||
      !/^rw,noexec,nosuid,nodev,size=1m,uid=\d+,gid=\d+,mode=0755$/.test(caOption)) return false;
    let channelCount = 0, caTmpfsCount = 0;
    for (const mount of mounts) {
      if (!mount || typeof mount.Destination !== "string" ||
        !mount.Destination.startsWith("/")) return false;
      const destination = path.posix.normalize(mount.Destination);
      if (pathContains(destination, normalizedWorkdir) || pathContains(normalizedWorkdir, destination)) return false;
      if (mount.RW === false) continue;
      if (destination === DISK_CHANNEL_MOUNT && mount.Type === "volume" &&
        mount.Name === expectedChannelName && mount.Driver === "local" && mount.RW === true) {
        channelCount += 1;
        continue;
      }
      if (destination === DISK_CA_TMPFS_MOUNT && mount.Type === "tmpfs" &&
        mount.RW === true && typeof mount.Mode === "string" &&
        (!mount.Mode || mount.Mode === "rw" || mount.Mode.includes("size=1m"))) {
        caTmpfsCount += 1;
        continue;
      }
      return false;
    }
    if (channelCount !== 1 || caTmpfsCount !== 1) return false;
    const writePaths = policyDocument?.filesystem_policy?.read_write;
    if (!Array.isArray(writePaths)) return false;
    for (const writable of writePaths) {
      if ([DISK_CHANNEL_MOUNT, DISK_CA_TMPFS_MOUNT].some(target =>
        pathContains(writable, target) || pathContains(target, writable))) return false;
    }
    return true;
  }
  function dockerPersistentLogsDisabled(container) {
    const log = container?.HostConfig?.LogConfig;
    return log?.Type === "none" && log.Config &&
      typeof log.Config === "object" && !Array.isArray(log.Config) &&
      Object.keys(log.Config).length === 0;
  }
  async function dockerSupervisorLogsDisabled(scope, sandbox, deadlineAt) {
    const idsOutput = await docker(["ps", "-aq", "--no-trunc",
      "--filter", `label=openshell.ai/sandbox-id=${sandbox.id}`,
      "--filter", "label=openshell.ai/isolation-role=supervisor"], deadlineAt, false);
    const ids = idsOutput.trim().split(/\s+/).filter(Boolean);
    if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0])) return false;
    const values = await docker(["inspect", ids[0]], deadlineAt);
    if (!Array.isArray(values) || values.length !== 1) return false;
    const supervisor = values[0];
    const labels = supervisor.Config?.Labels;
    const namespace = journal.scopes[scope.bindingId]?.namespace;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(namespace ?? "")) return false;
    const expected = {
      "openshell.ai/managed-by": "openshell",
      "openshell.ai/sandbox-id": sandbox.id,
      "openshell.ai/sandbox-name": scope.sandboxRef,
      "openshell.ai/sandbox-namespace": namespace,
      "openshell.ai/isolation-role": "supervisor",
    };
    return supervisor.Id === ids[0] && supervisor.Config?.Image === supervisor.Image &&
      Object.entries(expected).every(([key, value]) => labels?.[key] === value) &&
      dockerPersistentLogsDisabled(supervisor);
  }
  function resourceHostConfigMatches(container, limits, policyDocument) {
    const host = container?.HostConfig;
    // The only writable tmpfs exception is the driver's exact 1 MiB CA
    // mount, accounted by this same policy's Docker memory cgroup limit.
    return validResourceLimits(limits) && host?.NanoCpus === limits.cpuMillis * 1_000_000 &&
      host?.Memory === limits.memoryBytes && host?.MemorySwap === limits.memoryBytes &&
      host?.PidsLimit === limits.pidsLimit && dockerDiskStorageOptionMatches(container, limits) &&
      dockerPersistentLogsDisabled(container) && dockerDiskMountsMatch(container, policyDocument);
  }
  async function dockerDiskQuotaBackendSupported(deadlineAt) {
    const driver = (await docker(["info", "--format", "{{.Driver}}"], deadlineAt, false)).trim();
    if (driver !== "overlay2") return false;
    let status;
    try {
      status = JSON.parse(await docker(["info", "--format", "{{json .DriverStatus}}"], deadlineAt, false));
    } catch { return false; }
    return Array.isArray(status) && status.some(value =>
      Array.isArray(value) && value[0] === "Backing Filesystem" &&
      typeof value[1] === "string" && value[1].toLowerCase() === "xfs");
  }
  function dockerResourceUpdateArgs(containerId, limits) {
    if (!/^[a-f0-9]{64}$/.test(containerId ?? "") || !validResourceLimits(limits))
      throw new Error("sandbox_scope_changed");
    const cpus = (limits.cpuMillis / 1000).toFixed(3).replace(/\.?0+$/, "");
    return ["update", "--cpus", cpus, "--memory", String(limits.memoryBytes), "--memory-swap", String(limits.memoryBytes),
      "--pids-limit", String(limits.pidsLimit), containerId];
  }
  async function applyDockerResourceLimits(scope, sandbox, imageDigest, limits, deadlineAt, expectedContainerId, policyDocument) {
    const before = await container(scope, sandbox, imageDigest, deadlineAt);
    if (before.Id !== expectedContainerId || before.State.Running)
      throw new Error("sandbox_scope_changed");
    await docker(dockerResourceUpdateArgs(before.Id, limits), deadlineAt, false);
    const after = await container(scope, sandbox, imageDigest, deadlineAt);
    if (after.Id !== before.Id || !resourceHostConfigMatches(after, limits, policyDocument))
      throw new Error("sandbox_observation_unavailable");
    return after;
  }
  async function inspectCredentialProviderProfile(expected, deadlineAt) {
    if (!expected || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(expected.id ?? "") ||
      !/^[a-f0-9]{64}$/.test(expected.hash ?? "") || !Array.isArray(expected.binaries) || expected.binaries.length > 32)
      throw new Error("sandbox_operation_unsupported");
    const profile = await cli(["profile", "describe", expected.id, "--output", "json"], deadlineAt);
    if (!profile || profile.id !== expected.id || hash(JSON.stringify(canonical(profile))) !== expected.hash ||
      !Array.isArray(profile.binaries) || profile.binaries.length > 32 ||
      profile.binaries.some(value => !value || Object.keys(value).length !== 1 || typeof value.path !== "string")) {
      throw new Error("sandbox_operation_unsupported");
    }
    const actual = profile.binaries.map(value => value.path).sort();
    const wanted = [...expected.binaries].sort();
    if (new Set(actual).size !== actual.length || new Set(wanted).size !== wanted.length ||
      JSON.stringify(actual) !== JSON.stringify(wanted))
      throw new Error("sandbox_operation_unsupported");
  }
  async function sandboxExec(scope, sandboxId, argv, deadlineAt) {
    const remaining = Date.parse(deadlineAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining < 1500) throw new Error("exec_timeout");
    const privateConfig = await privateConfiguration();
    try {
      const { stdout } = await run(
        privateConfig.executable,
        ["--gateway", config.gateway, "--workspace", config.workspace, "sandbox", "exec", "--name", scope.sandboxRef, "--expected-sandbox-id", sandboxId, "--no-login-shell", "--timeout", String(Math.min(3, Math.floor(remaining / 1000))), "--", ...argv],
        { env: privateConfig.env, timeout: Math.min(4500, remaining), maxBuffer: 8192, windowsHide: true, killSignal: "SIGKILL" },
      );
      return { exitCode: 0, stdout: String(stdout).slice(0, 4096), stderr: "" };
    } catch (error) {
      const status = Number.isInteger(error?.code) ? error.code : Number.isInteger(error?.status) ? error.status : null;
      return { exitCode: status, stdout: String(error?.stdout ?? "").slice(0, 4096),
        stderr: String(error?.stderr ?? "").slice(0, 4096) };
    }
  }
  async function hostCapabilities(request, scope, deadlineAt) {
    const version = await cli(["--version"], deadlineAt, false);
    if (version.trim() !== "openshell 0.1.2") return null;
    const probeFixture = qualificationProbeFixture();
    if (!probeFixture) return null;
    const preflightRecord = journal.scopes[scope.bindingId];
    const preflightProvisioning = preflightRecord?.provisioning;
    const qualificationSample = preflightRecord?.qualification;
    if (!preflightProvisioning ||
      (!qualificationSample?.sampleTarget && (preflightProvisioning.purpose !== "qualification" ||
        preflightProvisioning.state !== "ready" || preflightRecord.sandboxId === null))) {
      const hostKernelVersion = (await docker(["info", "--format", "{{.KernelVersion}}"], deadlineAt, false)).trim();
      if (!hostKernelVersion || hostKernelVersion.length > 200 || /[\r\n\0]/.test(hostKernelVersion)) return null;
      const testedAt = new Date().toISOString();
      return {
        filesystemPolicy: false, processPrivilegePolicy: false, syscallPolicy: false,
        networkDestinationPolicy: false, networkLayer7Policy: false, credentialBrokering: false,
        resourceLimits: false, forceStop: false,
        backend: "openshell", backendVersion: "0.1.2", hostKernelVersion,
        sandboxImageDigest: request.imageDigest,
        qualificationProbeFixture: probeFixture,
        ...(probeFixture.credential ? { qualificationCredentialFixture: probeFixture.credential } : {}),
        filesystemEnforcementMode: "unknown", staticPolicyRequiresRecreate: true,
        dynamicNetworkPolicy: false, policyProverBoundaryCheck: false,
        policyProverCoverage: [], credentialBindingDimensions: [],
        testedAt, expiresAt: new Date(Math.min(Date.now() + 120_000,
          Number.isFinite(Date.parse(preflightProvisioning?.expiresAt ?? ""))
            ? Date.parse(preflightProvisioning.expiresAt) : Date.now() + 120_000)).toISOString(),
        qualificationHash: probeFixture.fixtureHash, evidenceKind: "protected_host_report",
      };
    }
    const detail = await observed(scope, deadlineAt);
    const currentPolicy = await policy(scope, deadlineAt);
    const workload = await container(scope, detail, request.imageDigest, deadlineAt);
    if (!workload || !currentPolicy.policy || !currentPolicy.policy.filesystem_policy || !currentPolicy.policy.landlock || !currentPolicy.policy.process) return null;
    const fs = currentPolicy.policy.filesystem_policy;
    const process = currentPolicy.policy.process;
    const targetRecord = journal.scopes[scope.bindingId];
    const provisioning = targetRecord?.provisioning;
    let creation = targetRecord?.creation;
    if (!creation && provisioning?.purpose === "qualification" && provisioning.state === "ready" &&
      targetRecord.sandboxId === detail.id && targetRecord.containerId === workload.Id &&
      provisioning.imageDigest === request.imageDigest &&
      verifyProvisioningMarkerHash(detail, scope, provisioning.requestId, provisioning.provisioningHash,
        provisioning.operationKeyHash, provisioning.bindingVersion) &&
      sameDocument(currentPolicy.policy, provisioning.envelope?.document) &&
      resourceHostConfigMatches(workload, provisioning.resourceLimits, provisioning.envelope?.document) &&
      await dockerDiskQuotaBackendSupported(deadlineAt) && await dockerSupervisorLogsDisabled(scope, detail, deadlineAt)) {
      creation = {
        purpose: "qualification", imageDigest: request.imageDigest,
        requestId: provisioning.requestId, provisioningHash: provisioning.provisioningHash,
        operationKeyHash: provisioning.operationKeyHash,
        bindingVersion: provisioning.bindingVersion,
        policyHash: provisioning.envelope.policyHash,
        document: canonical(provisioning.envelope.document),
        resourceLimits: canonical(provisioning.resourceLimits),
        expiresAt: provisioning.expiresAt, idleUntilUnixSeconds: provisioning.idleUntilUnixSeconds,
        sandboxId: detail.id, containerId: workload.Id,
        workdirPath: workload.Config?.WorkingDir,
        observedPolicyHash: currentPolicy.hash, policyVersion: currentPolicy.version,
        configRevision: currentPolicy.config_revision,
      };
      targetRecord.creation = creation;
      await atomicJson(journalFile, journal);
    }
    if (!provisioning || !creation || targetRecord.sandboxId !== detail.id || targetRecord.containerId !== workload.Id ||
      creation.sandboxId !== detail.id || creation.containerId !== workload.Id ||
      !verifyProvisioningMarkerHash(detail, scope, creation.requestId, creation.provisioningHash,
        creation.operationKeyHash, creation.bindingVersion)) return null;
    const hostKernelVersion = (await docker(["info", "--format", "{{.KernelVersion}}"], deadlineAt, false)).trim();
    if (!hostKernelVersion || hostKernelVersion.length > 200 || /[\r\n\0]/.test(hostKernelVersion)) return null;
    const runtimeBinarySha256 = await observedRuntimeBinarySha256(workload.Id, deadlineAt);
    const reobserved = await container(scope, detail, request.imageDigest, deadlineAt);
    const dockerEngineIdHash = journal.scopes[scope.bindingId]?.dockerEngineId;
    if (!runtimeBinarySha256 || reobserved.Id !== workload.Id ||
      reobserved.Config?.Labels?.["openshell.ai/workspace-root"] !== workload.Config?.Labels?.["openshell.ai/workspace-root"] ||
      !/^[a-f0-9]{64}$/.test(dockerEngineIdHash ?? "")) return null;
    const credentialFixture = qualificationCredentialFixture();
    const sampleTarget = qualificationSample?.sampleTarget ?? null;
    const sampleProbeFixture = qualificationSample?.probeFixture ??
      (provisioning.purpose === "qualification" ? provisioning.envelope.qualificationProbeFixture : null);
    const currentWorkdir = creation.workdirPath;
    const currentWriteRoots = currentPolicy.policy?.filesystem_policy?.read_write;
    if (!probeFixture || !sampleProbeFixture || !sameDocument(sampleProbeFixture, probeFixture) ||
      (provisioning.purpose === "qualification" && provisioning.envelope.probeFixtureHash !== probeFixture.fixtureHash) ||
      typeof currentWorkdir !== "string" || workload.Config?.Labels?.["openshell.ai/workspace-root"] !== currentWorkdir ||
      workload.Config?.WorkingDir !== currentWorkdir || !Array.isArray(currentWriteRoots) ||
      !currentWriteRoots.some(root => pathContains(root, currentWorkdir))) return null;
    const profileDeadlineAt = new Date(Math.min(
      Date.parse(deadlineAt), Date.parse(provisioning.expiresAt),
      Date.parse(qualificationSample?.expiresAt ?? provisioning.expiresAt),
    )).toISOString();
    const profileSelection = config.runtimeBrokerProfiles === undefined
      ? undefined : structuredClone(config.runtimeBrokerProfiles);
    const installedProfiles = await inspectInstalledBrokerProfiles({
      selection: profileSelection,
      cli: (args, boundedDeadlineAt) => cli(args, boundedDeadlineAt),
      deadlineAt: profileDeadlineAt,
    });
    const profileDetails = {
      ...(installedProfiles.credentialBrokerProviderProfile && profileSelection?.app
        ? { credentialBrokerProviderProfile: { ...installedProfiles.credentialBrokerProviderProfile, origin: profileSelection.app.origin } } : {}),
      ...(installedProfiles.modelBrokerProviderProfile && profileSelection?.model
        ? { modelBrokerProviderProfile: { ...installedProfiles.modelBrokerProviderProfile, origin: profileSelection.model.origin } } : {}),
    };
    let credentialBrokering = false;
    let credentialProfileFresh = !sampleTarget?.qualificationCredentialFixture;
    if (credentialFixture) {
      try {
        await inspectQualificationCredentialProfile(credentialFixture, deadlineAt);
        credentialProfileFresh = true;
        const appCredentialRoute = qualificationCredentialPolicyAvailable(currentPolicy.policy, credentialFixture) &&
          Boolean(profileDetails.credentialBrokerProviderProfile);
        const sampleProvesBrokerMechanism = qualificationSample?.capabilityFacts?.credentialBrokering === true;
        const sampledModelProfile = qualificationSample?.capabilityFacts?.modelBrokerProviderProfile ?? null;
        const currentModelProfile = profileDetails.modelBrokerProviderProfile ?? null;
        const exactModelCredentialRoute = sampleProvesBrokerMechanism &&
          sameDocument(sampledModelProfile, currentModelProfile) &&
          hasExactManagedModelBrokerPolicy(currentPolicy.policy, currentModelProfile);
        credentialBrokering = appCredentialRoute || exactModelCredentialRoute;
      } catch { credentialProfileFresh = false; }
    }
    const targetBase = {
      hostEpoch: epoch,
      companyId: scope.companyId, bindingId: scope.bindingId, cellId: scope.cellId,
      cellGeneration: scope.cellGeneration, sandboxRef: scope.sandboxRef,
      sandboxId: detail.id, containerId: workload.Id, imageDigest: request.imageDigest,
      hostKernelVersion, runtimeBinarySha256, openshellCliSha256: config.executableSha256,
      dockerEngineIdHash, policyHash: creation.policyHash,
      provisioningHash: provisioning.provisioningHash,
      bindingVersion: provisioning.bindingVersion,
      resourceLimits: creation.resourceLimits,
      policyVersion: currentPolicy.version, configRevision: String(currentPolicy.config_revision),
      phase: detail.phase, mechanism: "openshell_create_sandbox_v0.1.2",
      probePolicyHash: currentPolicy.hash,
      probeFixtureHash: sampleTarget?.probeFixtureHash ?? probeFixture.fixtureHash,
      ...((sampleTarget?.qualificationCredentialFixture ?? credentialFixture)
        ? { qualificationCredentialFixture: sampleTarget?.qualificationCredentialFixture ?? credentialFixture } : {}),
    };
    const qualificationTarget = { ...targetBase,
      targetHash: hash(JSON.stringify(canonical(targetBase))) };
    const testedAt = new Date().toISOString();
    const qualificationHash = qualificationTarget.targetHash;
    const qualificationExpiresAt = qualificationSample?.expiresAt;
    // A later signed operation may narrow the lifetime of the original
    // qualification evidence. Never let a capability refresh outlive either
    // the immutable sample or the current provisioning authority.
    const reportExpiryAt = Math.min(
      Date.parse(qualificationExpiresAt ?? provisioning.expiresAt),
      Date.parse(provisioning.expiresAt),
    );
    const reportExpiry = Number.isFinite(reportExpiryAt)
      ? new Date(reportExpiryAt).toISOString() : null;
    const failedCapabilityRefresh = (reasonCode) => {
      if (globalThis.process?.env?.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1" &&
        ["sample_drift", "workload_state_unavailable", "syscall_probe_unavailable", "resource_probe_unavailable"].includes(reasonCode))
        globalThis.process.stderr.write(`${JSON.stringify({ event: "openshell_capability_refresh_failed", reasonCode })}\n`);
      return {
      filesystemPolicy: false, processPrivilegePolicy: false, syscallPolicy: false,
      networkDestinationPolicy: false, networkLayer7Policy: false, credentialBrokering: false,
      resourceLimits: false, forceStop: false,
      backend: "openshell", backendVersion: "0.1.2", hostKernelVersion,
      sandboxImageDigest: request.imageDigest, qualificationProbeFixture: probeFixture,
      filesystemEnforcementMode: "unknown", staticPolicyRequiresRecreate: true,
      dynamicNetworkPolicy: false, policyProverBoundaryCheck: false,
      policyProverCoverage: [], credentialBindingDimensions: [], testedAt,
      expiresAt: reportExpiry ?? provisioning.expiresAt,
      qualificationHash: probeFixture.fixtureHash, evidenceKind: "protected_host_report",
      ...(credentialFixture ? { qualificationCredentialFixture: credentialFixture } : {}),
    };
    };
    if (sampleTarget && (!validQualificationSample(qualificationSample) ||
      sampleTarget.hostEpoch !== epoch || sampleTarget.imageDigest !== request.imageDigest ||
      sampleTarget.hostKernelVersion !== hostKernelVersion || sampleTarget.runtimeBinarySha256 !== runtimeBinarySha256 ||
      sampleTarget.openshellCliSha256 !== config.executableSha256 || sampleTarget.dockerEngineIdHash !== dockerEngineIdHash ||
      sampleTarget.policyVersion !== currentPolicy.version ||
      sampleTarget.probeFixtureHash !== probeFixture.fixtureHash || !qualificationExpiresAt ||
      Date.parse(qualificationExpiresAt) <= Date.now() ||
      (sampleTarget.qualificationCredentialFixture && (!credentialProfileFresh ||
        !sameDocument(sampleTarget.qualificationCredentialFixture, credentialFixture)))))
      return failedCapabilityRefresh("sample_drift");
    const runtimeHelper = "/.openshell/runtime/openshell-sandbox";
    const workloadRunning = detail.phase === "Ready" && workload.State.Running === true;
    const workloadStopped = detail.phase === "Stopped" && workload.State.Running === false;
    if (!workloadRunning && !workloadStopped) return failedCapabilityRefresh("workload_state_unavailable");
    let syscallObserved = false;
    if (readOnlyPathAllows(currentPolicy.policy, runtimeHelper) &&
      !(currentPolicy.policy?.filesystem_policy?.read_write ?? []).some(value =>
        pathContains(value, runtimeHelper) || pathContains(runtimeHelper, value))) {
      if (workloadRunning) {
        const result = await sandboxExec(scope, detail.id, [runtimeHelper, "runtime-seccomp-probe"], deadlineAt);
        if (result.exitCode === 0) {
          try {
            const report = JSON.parse(result.stdout);
            syscallObserved = Object.keys(report).sort().join("\0") ===
              ["denied_errno", "getpid", "memfd_create", "profile", "version"].join("\0") &&
              report.version === 1 && report.profile === "openshell-linux-built-in-seccomp-v1" &&
              report.getpid === "allowed" && report.memfd_create === "denied" && report.denied_errno === "EPERM";
          } catch {}
        }
      } else {
        // A stopped workload cannot execute a new probe. Reuse only the
        // unexpired, exact-creation sample validated above and its identical
        // runtime/kernel/policy mechanism pins.
        syscallObserved = qualificationSample?.capabilityFacts?.syscallPolicy === true;
      }
    }
    // A retained sample can substitute only when the exact stopped target
    // prevents execution and the current policy still exposes the same helper.
    // Any missing fresh observation or policy drift must not be hidden by old
    // sampled facts.
    if (qualificationSample?.capabilityFacts?.syscallPolicy === true &&
      !syscallObserved) return failedCapabilityRefresh("syscall_probe_unavailable");
    const resourceLimits = provisioning.resourceLimits;
    let resourceHostObserved = Boolean(resourceHostConfigMatches(workload, resourceLimits, currentPolicy.policy) &&
      await dockerDiskQuotaBackendSupported(deadlineAt));
    if (resourceHostObserved && workloadRunning) {
      try {
        const uid = process.run_as_user, gid = process.run_as_group;
        const [cpuMax, memoryMax, memorySwap, pidsMax, oomGroup] = await Promise.all([
          docker(["exec", "--user", `${uid}:${gid}`, workload.Id, "/usr/bin/cat", "/sys/fs/cgroup/cpu.max"], deadlineAt, false),
          docker(["exec", "--user", `${uid}:${gid}`, workload.Id, "/usr/bin/cat", "/sys/fs/cgroup/memory.max"], deadlineAt, false),
          docker(["exec", "--user", `${uid}:${gid}`, workload.Id, "/usr/bin/cat", "/sys/fs/cgroup/memory.swap.max"], deadlineAt, false),
          docker(["exec", "--user", `${uid}:${gid}`, workload.Id, "/usr/bin/cat", "/sys/fs/cgroup/pids.max"], deadlineAt, false),
          docker(["exec", "--user", `${uid}:${gid}`, workload.Id, "/usr/bin/cat", "/sys/fs/cgroup/memory.oom.group"], deadlineAt, false),
        ]);
        const [quota, period] = cpuMax.trim().split(/\s+/).map(Number);
        resourceHostObserved = Math.round(quota * 1000 / period) === resourceLimits.cpuMillis &&
          memoryMax.trim() === String(resourceLimits.memoryBytes) &&
          memorySwap.trim() === String(resourceLimits.memoryBytes) &&
          pidsMax.trim() === String(resourceLimits.pidsLimit) && oomGroup.trim() === "0";
      } catch { resourceHostObserved = false; }
    } else if (resourceHostObserved && workloadStopped) {
      // HostConfig, mounts, disk backend and current creation are freshly
      // inspected above; the cgroup behavior itself comes from the original
      // still-valid sample for this exact pinned mechanism.
      resourceHostObserved = qualificationSample?.capabilityFacts?.resourceLimits === true;
    }
    if (qualificationSample && qualificationSample.capabilityFacts?.resourceLimits && !resourceHostObserved)
      return failedCapabilityRefresh("resource_probe_unavailable");
    const capabilityFacts = {
      filesystemPolicy: fs.include_workdir === false && currentPolicy.policy.landlock.compatibility === "hard_requirement",
      processPrivilegePolicy: typeof process.run_as_user === "string" && typeof process.run_as_group === "string" && process.run_as_user !== "0",
      syscallPolicy: syscallObserved,
      networkDestinationPolicy: networkProbeAvailability(currentPolicy.policy, networkProbeFixture()).destination,
      networkLayer7Policy: networkProbeAvailability(currentPolicy.policy, networkProbeFixture()).l7,
      credentialBrokering,
      credentialBindingDimensions: installedProfiles.credentialProfileDimensions,
      ...profileDetails,
      resourceLimits: resourceHostObserved,
      // This is only a declaration that the pinned host can observe a live
      // target and the expected-ID stop/start path; the final control is earned
      // by the separate bounded force_stop transition probe.
      forceStop: detail.phase === "Ready" && workload.State.Running === true,
      filesystemEnforcementMode: currentPolicy.policy.landlock.compatibility === "hard_requirement" ? "hard_requirement" : "unknown",
      dynamicNetworkPolicy: true,
      policyProverBoundaryCheck: false,
      policyProverCoverage: [],
      credentialBindingDimensions: installedProfiles.credentialProfileDimensions,
    };
    const reportFacts = qualificationSample?.capabilityFacts ?? capabilityFacts;
    if (!reportExpiry || !Number.isFinite(Date.parse(reportExpiry)) ||
      Date.parse(reportExpiry) > Date.parse(provisioning.expiresAt) ||
      Date.parse(reportExpiry) <= Date.now()) return null;
    if (!qualificationSample) {
      targetRecord.qualification = {
        sampleTarget: qualificationTarget,
        creation: structuredClone(creation),
        probeFixture,
        expiresAt: reportExpiry,
        capabilityFacts: reportFacts,
      };
      await atomicJson(journalFile, journal);
    }
    return {
      ...reportFacts,
      credentialBrokering: credentialBrokering && reportFacts.credentialBrokering === true,
      credentialBindingDimensions: installedProfiles.credentialProfileDimensions,
      backend: "openshell", backendVersion: "0.1.2", hostKernelVersion,
      sandboxImageDigest: request.imageDigest,
      qualificationProbeFixture: probeFixture,
      staticPolicyRequiresRecreate: true,
      testedAt, expiresAt: reportExpiry,
      qualificationHash, qualificationTarget, evidenceKind: "protected_host_report",
      ...(credentialFixture ? { qualificationCredentialFixture: credentialFixture } : {}),
      ...profileDetails,
    };
  }
  async function probeBoundary(request, deadlineAt, commandId) {
    const probe = request.probe;
    const expected = probeContracts[probe.caseId];
    if (!expected || expected[0] !== probe.control || expected[1] !== probe.expected || !/^[a-f0-9]{64}$/.test(probe.contractHash ?? ""))
      throw new Error("sandbox_scope_changed");
    const detail = await observed(request.scope, deadlineAt);
    const effective = await policy(request.scope, deadlineAt);
    if (detail.phase !== "Ready")
      return { action: "probe", verdict: "unsupported", observationHash: null, contractHash: probe.contractHash };
    const targetRecord = journal.scopes[request.scope.bindingId];
    if (["resource_exhaustion_contained", "force_stop", "credential_allow", "credential_raw_read_deny",
      "credential_wrong_destination_deny", "credential_wrong_binary_deny", "credential_revoke_deny"].includes(probe.caseId) &&
      (!targetRecord?.provisioning || targetRecord.provisioning.purpose !== "qualification" ||
        targetRecord.provisioning.state !== "ready" || targetRecord.sandboxId !== detail.id ||
        !targetRecord.containerId || Date.parse(targetRecord.provisioning.expiresAt) <= Date.now()))
      return { action: "probe", verdict: "unsupported", observationHash: null, contractHash: probe.contractHash };
    if (!["process_nonprivileged", "process_privilege_denied", "filesystem_allow", "filesystem_deny", "filesystem_escape", "syscall_allow", "syscall_deny", "network_allow", "network_host_port_deny", "network_dns_redirect_deny", "network_l7_allow", "network_l7_deny", "network_redirect_deny", "credential_allow", "credential_raw_read_deny", "credential_wrong_destination_deny", "credential_wrong_binary_deny", "credential_revoke_deny", "resource_exhaustion_contained", "force_stop"].includes(probe.caseId))
      return { action: "probe", verdict: "unsupported", observationHash: null, contractHash: probe.contractHash };
    const workload = await container(request.scope, detail, request.imageDigest, deadlineAt);
    if (!targetRecord?.provisioning || targetRecord.provisioning.purpose !== "qualification" ||
      targetRecord.provisioning.state !== "ready" || targetRecord.sandboxId !== detail.id ||
      targetRecord.containerId !== workload.Id || Date.parse(targetRecord.provisioning.expiresAt) <= Date.now())
      return { action: "probe", verdict: "unsupported", observationHash: null, contractHash: probe.contractHash };
    const hostKernelVersion = (await docker(["info", "--format", "{{.KernelVersion}}"], deadlineAt, false)).trim();
    if (!hostKernelVersion || hostKernelVersion.length > 200 || /[\r\n\0]/.test(hostKernelVersion))
      return { action: "probe", verdict: "unsupported", observationHash: null, contractHash: probe.contractHash };
    const runtimeBinarySha256 = await observedRuntimeBinarySha256(workload.Id, deadlineAt);
    const reobserved = await container(request.scope, detail, request.imageDigest, deadlineAt);
    const dockerEngineIdHash = journal.scopes[request.scope.bindingId]?.dockerEngineId;
    if (!runtimeBinarySha256 || reobserved.Id !== workload.Id || !reobserved.State.Running ||
      !/^[a-f0-9]{64}$/.test(dockerEngineIdHash ?? ""))
      return { action: "probe", verdict: "unsupported", observationHash: null, contractHash: probe.contractHash };
    const credentialFixture = qualificationCredentialFixture();
    const probeFixture = qualificationProbeFixture();
    if (!probeFixture || !targetRecord.provisioning.envelope.qualificationProbeFixture ||
      !sameDocument(targetRecord.provisioning.envelope.qualificationProbeFixture, probeFixture) ||
      targetRecord.provisioning.envelope.probeFixtureHash !== probeFixture.fixtureHash ||
      workload.Config?.Labels?.["openshell.ai/workspace-root"] !== probeFixture.filesystem.workdirPath ||
      workload.Config?.WorkingDir !== probeFixture.filesystem.workdirPath ||
      !sameDocument(effective.policy, qualificationProbePolicyDocument(probeFixture)))
      return { action: "probe", verdict: "unsupported", observationHash: null, contractHash: probe.contractHash };
    const targetBase = {
      hostEpoch: epoch,
      companyId: request.scope.companyId, bindingId: request.scope.bindingId, cellId: request.scope.cellId,
      cellGeneration: request.scope.cellGeneration, sandboxRef: request.scope.sandboxRef,
      sandboxId: detail.id, containerId: workload.Id, imageDigest: request.imageDigest,
      hostKernelVersion, runtimeBinarySha256, openshellCliSha256: config.executableSha256,
      dockerEngineIdHash, policyHash: targetRecord.provisioning.envelope.policyHash,
      provisioningHash: targetRecord.provisioning.provisioningHash,
      bindingVersion: targetRecord.provisioning.bindingVersion,
      resourceLimits: targetRecord.provisioning.resourceLimits,
      policyVersion: effective.version, configRevision: String(effective.config_revision),
      phase: detail.phase, mechanism: "openshell_create_sandbox_v0.1.2",
      probePolicyHash: effective.hash, probeFixtureHash: probeFixture.fixtureHash,
      ...(credentialFixture ? { qualificationCredentialFixture: credentialFixture } : {}),
    };
    const targetQualificationHash = hash(JSON.stringify(canonical(targetBase)));
    const probeReply = (verdict, observationHash) => ({ action: "probe", verdict, observationHash,
      contractHash: probe.contractHash, targetQualificationHash });
    if (probe.caseId.startsWith("credential_")) {
      const fixture = credentialFixture;
      const provisioning = { ...targetRecord.provisioning, sandboxId: targetRecord.sandboxId,
        containerId: targetRecord.containerId };
      if (!fixture || !qualificationCredentialPolicyAvailable(effective.policy, fixture)) return probeReply("unsupported", null);
      const credential = qualificationCredentialClaim(request, commandId, fixture, provisioning, deadlineAt,
        targetQualificationHash);
      if (!credential) return probeReply("unsupported", null);
      if (probe.caseId === "credential_wrong_binary_deny") {
        const prior = targetRecord.provisioning.credentialPositiveProof;
        if (!prior || prior.targetQualificationHash !== targetQualificationHash ||
          prior.fixtureHash !== fixture.fixtureHash || prior.sandboxId !== detail.id ||
          prior.containerId !== workload.Id || !Number.isFinite(Date.parse(prior.at)) ||
          Date.now() - Date.parse(prior.at) < 0 || Date.now() - Date.parse(prior.at) > 60_000)
          return probeReply("unsupported", null);
      }
      try { await inspectQualificationCredentialProfile(fixture, deadlineAt); }
      catch { return probeReply("unsupported", null); }
      try { await reserveQualificationCredentialUse(commandId, credential.claim); }
      catch { return probeReply("fail", null); }
      const uid = effective.policy?.process?.run_as_user;
      const gid = effective.policy?.process?.run_as_group;
      if (!/^[1-9][0-9]{0,8}$/.test(uid ?? "") || !/^[0-9]{1,9}$/.test(gid ?? ""))
        return probeReply("unsupported", null);
      // The profile injects the one-use capability into its credential proxy,
      // never into workload environment or argv. Verify the target itself has
      // no copied credential environment before exercising the proxy.
      const configuredEnv = workload.Config?.Env;
      if (!Array.isArray(configuredEnv) || configuredEnv.some(value =>
        typeof value !== "string" || value.startsWith(`${QUALIFICATION_CREDENTIAL_ENV}=`) ||
          value.includes(credential.token))) return probeReply("unsupported", null);
      if (probe.caseId === "credential_raw_read_deny") {
        const helper = "/usr/bin/printenv";
        if (!readOnlyPathAllows(effective.policy, helper) ||
          (effective.policy?.filesystem_policy?.read_write ?? []).some(value =>
            pathContains(value, helper) || pathContains(helper, value))) return probeReply("unsupported", null);
        try {
          const stat = (await docker(["exec", "--user", `${uid}:${gid}`, workload.Id,
            "/usr/bin/stat", "-c", "%F:%a", helper], deadlineAt, false)).trim();
          const match = stat.match(/^regular file:([0-7]{3,4})$/);
          if (!match || (Number.parseInt(match[1], 8) & 0o111) === 0) return probeReply("unsupported", null);
        } catch { return probeReply("unsupported", null); }
        const envProbe = await sandboxExec(request.scope, detail.id, [helper, QUALIFICATION_CREDENTIAL_ENV], deadlineAt);
        if (envProbe.exitCode !== 1 || envProbe.stdout !== "") return probeReply("fail", null);
      }
      const requestResult = await qualificationCredentialProvider(request.scope, detail.id, fixture,
        credential, commandId, deadlineAt, async () => {
          if (probe.caseId === "credential_wrong_binary_deny") {
            try {
              await docker(["exec", "--user", `${uid}:${gid}`, workload.Id, fixture.wrongBinaryPath, "--version"], deadlineAt, false);
            } catch { return { unavailable: true }; }
            const bodyText = JSON.stringify(canonical(credential.body));
            const url = `${fixture.origin.replace(/\/$/, "")}/mcp/gateways/${fixture.gatewayPublicId}`;
            const args = [fixture.wrongBinaryPath, "--server-response", "--timeout=4", "--tries=1", "--post-data", bodyText,
              "--header", "Content-Type: application/json", "--output-document=-", "--content-on-error", "--", url];
            if (args.some(value => value.includes(credential.token))) throw new Error("sandbox_scope_changed");
            return sandboxExec(request.scope, detail.id, args, deadlineAt);
          }
          const toolName = probe.caseId === "credential_wrong_destination_deny" ? fixture.wrongToolName : fixture.toolName;
          return qualificationCredentialCall(request.scope, detail.id, fixture, credential, toolName, deadlineAt);
        });
      if (requestResult?.unavailable) return probeReply("unsupported", null);
      let expected = false, status = null, reasonCode = null, markerMatched = false;
      if (probe.caseId === "credential_wrong_binary_deny") {
        if (requestResult?.exitCode !== 8 || typeof requestResult.stdout !== "string" ||
          !/HTTP\/\d(?:\.\d)? 401(?:\s|\r?$)/m.test(requestResult.stderr ?? "")) return probeReply("unsupported", null);
        try {
          const body = JSON.parse(requestResult.stdout);
          status = 401;
          reasonCode = body?.error?.data?.reasonCode ?? body?.error?.reasonCode ?? null;
          expected = reasonCode === "sandbox_qualification_credential_required";
        } catch { return probeReply("fail", null); }
      } else {
        const parsed = requestResult;
        if (!parsed) return probeReply("unsupported", null);
        status = parsed.status;
        const error = parsed.body?.error;
        reasonCode = error?.data?.reasonCode ?? error?.reasonCode ?? null;
        if (probe.caseId === "credential_allow" || probe.caseId === "credential_raw_read_deny") {
          const marker = parsed.body?.result?.structuredContent?.marker ??
            parsed.body?.structuredContent?.marker ?? parsed.body?.structuredContent?.content?.marker;
          markerMatched = marker === fixture.marker || parsed.body?.result?.content?.some(value =>
            value?.type === "text" && value.text === fixture.marker);
          expected = status === 200 && markerMatched && !JSON.stringify(parsed.body).includes(credential.token);
        } else if (probe.caseId === "credential_wrong_destination_deny") {
          expected = status === 403 && reasonCode === "sandbox_qualification_tool_mismatch";
        } else if (probe.caseId === "credential_revoke_deny") {
          expected = status === 403 && reasonCode === "sandbox_qualification_grant_revoked";
        }
      }
      const observedAfter = await container(request.scope, detail, request.imageDigest, deadlineAt);
      const policyAfter = await policy(request.scope, deadlineAt);
      if (observedAfter.Id !== workload.Id || !observedAfter.State.Running ||
        policyAfter.hash !== effective.hash || policyAfter.version !== effective.version ||
        policyAfter.config_revision !== effective.config_revision || !sameDocument(policyAfter.policy, effective.policy))
        return probeReply("fail", null);
      const observation = hash(JSON.stringify(canonical({ version: 1, caseId: probe.caseId,
        commandId, fixtureHash: fixture.fixtureHash, profileHash: fixture.profileHash,
        targetQualificationHash, nonceHash: hash(credential.nonce), status, reasonCode,
        markerMatched, expected, providerCleaned: true })));
      if (expected && probe.caseId === "credential_allow") {
        targetRecord.provisioning.credentialPositiveProof = {
          targetQualificationHash, fixtureHash: fixture.fixtureHash, sandboxId: detail.id,
          containerId: workload.Id, at: new Date().toISOString(),
        };
        await atomicJson(journalFile, journal);
      }
      return probeReply(expected ? "pass" : "fail", observation);
    }
    if (probe.caseId === "resource_exhaustion_contained") {
      const pidsLimit = workload.HostConfig?.PidsLimit;
      const uid = effective.policy?.process?.run_as_user;
      const gid = effective.policy?.process?.run_as_group;
      const helper = "/.openshell/runtime/openshell-sandbox";
      if (!Number.isSafeInteger(pidsLimit) || pidsLimit < 2 || pidsLimit > 256 ||
        !/^[1-9][0-9]{0,8}$/.test(uid ?? "") || !/^[0-9]{1,9}$/.test(gid ?? "") ||
        !readOnlyPathAllows(effective.policy, helper) ||
        (effective.policy?.filesystem_policy?.read_write ?? []).some(value =>
          pathContains(value, helper) || pathContains(helper, value)))
        return probeReply("unsupported", null);
      try {
        const beforeLimit = (await docker(["exec", "--user", `${uid}:${gid}`, workload.Id,
          "/usr/bin/cat", "/sys/fs/cgroup/pids.max"], deadlineAt, false)).trim();
        if (beforeLimit !== String(pidsLimit)) return probeReply("unsupported", null);
        const before = await container(request.scope, detail, request.imageDigest, deadlineAt);
        if (before.Id !== workload.Id || !before.State.Running) throw new Error("sandbox_scope_changed");
        const result = await sandboxExec(request.scope, detail.id,
          [helper, "runtime-pids-probe", "--limit", String(pidsLimit)], deadlineAt);
        if (result.exitCode === 127 || result.exitCode === 124 || result.exitCode === null)
          return probeReply("unsupported", null);
        const after = await container(request.scope, detail, request.imageDigest, deadlineAt);
        const afterLimit = (await docker(["exec", "--user", `${uid}:${gid}`, workload.Id,
          "/usr/bin/cat", "/sys/fs/cgroup/pids.max"], deadlineAt, false)).trim();
        if (after.Id !== workload.Id || !after.State.Running || afterLimit !== String(pidsLimit))
          return probeReply("fail", null);
        if (result.exitCode !== 0) return probeReply("fail", null);
        let report;
        try { report = JSON.parse(result.stdout); } catch { return probeReply("fail", null); }
        const reportKeys = ["attempted", "baseline", "baseline_restored", "denied_errno", "limit", "reaped", "verdict", "version"];
        if (!report || Object.keys(report).sort().join("\0") !== reportKeys.join("\0") ||
          report.version !== 1 || report.verdict !== "pass" || report.limit !== pidsLimit ||
          report.denied_errno !== "EAGAIN" || report.baseline_restored !== true ||
          !Number.isInteger(report.baseline) || report.baseline < 1 || report.baseline >= pidsLimit ||
          report.attempted !== pidsLimit - report.baseline + 1 ||
          report.reaped !== report.attempted - 1)
          return probeReply("fail", null);
        const observation = { caseId: probe.caseId, contractHash: probe.contractHash,
          sandboxId: detail.id, containerId: workload.Id, imageDigest: request.imageDigest,
          policyHash: effective.hash, policyVersion: effective.version,
          configRevision: effective.config_revision, pidsLimit,
          cgroupLimitMatched: true, boundedChildrenReaped: true,
          excessPidDeniedWithEagain: true, sandboxStayedRunning: true };
        const hostConfig = workload.HostConfig;
        const cpuMillis = hostConfig?.NanoCpus / 1_000_000;
        const memoryBytes = hostConfig?.Memory;
        const diskBytes = Number(String(hostConfig?.StorageOpt?.size ?? "").replace(/B$/, ""));
        if (!Number.isSafeInteger(cpuMillis) || cpuMillis < 1 || cpuMillis > 3000 ||
          !Number.isSafeInteger(memoryBytes) || memoryBytes < 16 * 1024 * 1024 || memoryBytes > 256 * 1024 * 1024 ||
          hostConfig?.MemorySwap !== memoryBytes || !Number.isSafeInteger(diskBytes) ||
          diskBytes < 1024 * 1024 || diskBytes > 32 * 1024 * 1024 ||
          !dockerDiskStorageOptionMatches(workload, { diskBytes }) ||
          !dockerDiskMountsMatch(workload, effective.policy))
          return probeReply("unsupported", hash(JSON.stringify(canonical({ ...observation,
            completeResourceControl: false, missingDimensions: ["cpuMillis", "memoryBytes", "diskBytes"] }))));

        const cpuMax = (await docker(["exec", "--user", `${uid}:${gid}`, workload.Id,
          "/usr/bin/cat", "/sys/fs/cgroup/cpu.max"], deadlineAt, false)).trim().split(/\s+/);
        if (cpuMax.length !== 2 || !/^\d+$/.test(cpuMax[0]) || !/^\d+$/.test(cpuMax[1]))
          return probeReply("unsupported", null);
        const cpuQuota = Number(cpuMax[0]), cpuPeriod = Number(cpuMax[1]);
        if (!Number.isSafeInteger(cpuQuota) || !Number.isSafeInteger(cpuPeriod) || cpuPeriod < 1 ||
          Math.round(cpuQuota * 1000 / cpuPeriod) !== cpuMillis)
          return probeReply("unsupported", null);
        const workers = Math.ceil(cpuMillis / 1000) + 1;
        const cpuResult = await sandboxExec(request.scope, detail.id,
          [helper, "runtime-cpu-probe", "--workers", String(workers), "--millis", "250"], deadlineAt);
        if (cpuResult.exitCode !== 0) return probeReply("unsupported", hash(JSON.stringify(canonical({ ...observation, cpuCgroupMatched: true }))));
        let cpuReport;
        try { cpuReport = JSON.parse(cpuResult.stdout); } catch { return probeReply("fail", null); }
        if (!cpuReport || Object.keys(cpuReport).sort().join("\0") !==
          ["duration_ms", "period_us", "quota_us", "throttled_increased", "verdict", "version", "workers"].join("\0") ||
          cpuReport.version !== 1 || cpuReport.verdict !== "pass" || cpuReport.quota_us !== cpuQuota ||
          cpuReport.period_us !== cpuPeriod || cpuReport.workers !== workers || cpuReport.duration_ms !== 250 ||
          cpuReport.throttled_increased !== true)
          return probeReply("unsupported", hash(JSON.stringify(canonical({ ...observation, cpuCgroupMatched: true }))));

        const memoryWorkdir = workload.Config?.WorkingDir;
        const workspaceRoot = workload.Config?.Labels?.["openshell.ai/workspace-root"];
        const memoryReadWriteRoots = effective.policy?.filesystem_policy?.read_write;
        if (typeof memoryWorkdir !== "string" || memoryWorkdir !== workspaceRoot ||
          !Array.isArray(memoryReadWriteRoots) ||
          !memoryReadWriteRoots.some(value => pathContains(value, memoryWorkdir)))
          return probeReply("unsupported", null);
        const memoryCgroup = async () => {
          const [memoryMax, oomGroup] = await Promise.all([
            docker(["exec", "--user", `${uid}:${gid}`, workload.Id,
              "/usr/bin/cat", "/sys/fs/cgroup/memory.max"], deadlineAt, false),
            docker(["exec", "--user", `${uid}:${gid}`, workload.Id,
              "/usr/bin/cat", "/sys/fs/cgroup/memory.oom.group"], deadlineAt, false),
          ]);
          return { memoryMax: memoryMax.trim(), oomGroup: oomGroup.trim() };
        };
        const memoryBeforeCgroup = await memoryCgroup();
        const memoryBeforeWorkload = await container(request.scope, detail, request.imageDigest, deadlineAt);
        const memoryBeforeRuntimeSha256 = await observedRuntimeBinarySha256(memoryBeforeWorkload.Id, deadlineAt);
        if (memoryBeforeCgroup.memoryMax !== String(memoryBytes) || memoryBeforeCgroup.oomGroup !== "0" ||
          memoryBeforeWorkload.Id !== workload.Id || !memoryBeforeWorkload.State.Running ||
          memoryBeforeRuntimeSha256 !== runtimeBinarySha256)
          return probeReply("unsupported", null);
        // Run only this bounded resource child directly under the validated
        // container identity. `sandbox exec` adds Landlock and correctly
        // prevents writes to /proc/self/oom_score_adj; direct docker exec keeps
        // the same UID, workdir, full container ID, and pinned helper without
        // weakening the workload's filesystem policy.
        const memoryResult = await docker(["exec", "--user", `${uid}:${gid}`, "--workdir", memoryWorkdir,
          workload.Id, helper, "runtime-memory-probe", "--limit-bytes", String(memoryBytes)], deadlineAt, false)
          .then(stdout => ({ stdout, exitCode: 0 }), () => null);
        const memoryAfterWorkload = await container(request.scope, detail, request.imageDigest, deadlineAt);
        const memoryAfterCgroup = await memoryCgroup();
        const memoryAfterRuntimeSha256 = await observedRuntimeBinarySha256(memoryAfterWorkload.Id, deadlineAt);
        if (memoryAfterWorkload.Id !== workload.Id || !memoryAfterWorkload.State.Running ||
          memoryAfterCgroup.memoryMax !== String(memoryBytes) || memoryAfterCgroup.oomGroup !== "0" ||
          memoryAfterRuntimeSha256 !== runtimeBinarySha256)
          return probeReply("fail", null);
        if (!memoryResult || memoryResult.exitCode !== 0) return probeReply("unsupported", hash(JSON.stringify(canonical({
          ...observation, cpuThrottleObserved: true, memoryCgroupMatched: true }))));
        let memoryReport;
        try { memoryReport = JSON.parse(memoryResult.stdout); } catch { return probeReply("fail", null); }
        if (!memoryReport || Object.keys(memoryReport).sort().join("\0") !==
          ["child_reaped", "limit_bytes", "oom_group_disabled", "oom_kill_increased", "verdict", "version"].join("\0") ||
          memoryReport.version !== 1 || memoryReport.verdict !== "pass" ||
          memoryReport.limit_bytes !== memoryBytes || memoryReport.oom_kill_increased !== true ||
          memoryReport.child_reaped !== true || memoryReport.oom_group_disabled !== true)
          return probeReply("unsupported", hash(JSON.stringify(canonical({ ...observation,
            cpuThrottleObserved: true, memoryCgroupMatched: true }))));

        const workdir = workload.Config?.Labels?.["openshell.ai/workspace-root"];
        const writableRoots = effective.policy?.filesystem_policy?.read_write;
        if (typeof workdir !== "string" || !Array.isArray(writableRoots) ||
          !writableRoots.some(value => pathContains(value, workdir)))
          return probeReply("unsupported", null);
        const diskPath = path.posix.join(workdir, `.aw-v7-disk-probe-${randomUUID()}`);
        const diskResult = await sandboxExec(request.scope, detail.id,
          [helper, "runtime-disk-probe", "--limit-bytes", String(diskBytes), "--path", diskPath], deadlineAt);
        if (diskResult.exitCode !== 0) return probeReply("unsupported", hash(JSON.stringify(canonical({
          ...observation, cpuThrottleObserved: true, memoryOomObserved: true }))));
        let diskReport;
        try { diskReport = JSON.parse(diskResult.stdout); } catch { return probeReply("fail", null); }
        if (!diskReport || Object.keys(diskReport).sort().join("\0") !==
          ["limit_bytes", "quota_exhaustion_observed", "temporary_file_removed", "verdict", "version"].join("\0") ||
          diskReport.version !== 1 || diskReport.verdict !== "pass" || diskReport.limit_bytes !== diskBytes ||
          diskReport.quota_exhaustion_observed !== true || diskReport.temporary_file_removed !== true)
          return probeReply("unsupported", hash(JSON.stringify(canonical({ ...observation,
            cpuThrottleObserved: true, memoryOomObserved: true }))));
        const removed = await docker(["exec", "--user", `${uid}:${gid}`, workload.Id,
          "/usr/bin/test", "!", "-e", diskPath], deadlineAt, false);
        const afterDisk = await container(request.scope, detail, request.imageDigest, deadlineAt);
        if (removed !== "" || afterDisk.Id !== workload.Id || !afterDisk.State.Running)
          return probeReply("fail", null);
        return probeReply("pass", hash(JSON.stringify(canonical({ ...observation,
          cpuThrottleObserved: true, memoryOomObserved: true, diskEnospcObserved: true,
          temporaryFileRemoved: true, targetUnchangedAfterAllProbes: true }))));
      } catch {
        return probeReply("unsupported", null);
      }
    }
    if (probe.caseId === "force_stop") {
      if (!workload.State.Running || !dockerPersistentLogsDisabled(workload))
        return probeReply("unsupported", null);
      const initialPolicy = effective;
      try {
        await cli(["sandbox", "stop", request.scope.sandboxRef,
          "--expected-sandbox-id", detail.id], deadlineAt, false);
        const stoppedDetail = await observed(request.scope, deadlineAt);
        const stoppedWorkload = await container(request.scope, stoppedDetail,
          request.imageDigest, deadlineAt);
        if (stoppedDetail.id !== detail.id || stoppedDetail.phase !== "Stopped" ||
          stoppedWorkload.Id !== workload.Id || stoppedWorkload.State.Running)
          throw new Error("sandbox_stop_observation_failed");
        await cli(["sandbox", "start", request.scope.sandboxRef,
          "--expected-sandbox-id", detail.id], deadlineAt, false);
        const restartedDetail = await observed(request.scope, deadlineAt);
        const restartedWorkload = await container(request.scope, restartedDetail,
          request.imageDigest, deadlineAt);
        const restartedPolicy = await policy(request.scope, deadlineAt);
        if (restartedDetail.id !== detail.id || restartedDetail.phase !== "Ready" ||
          restartedWorkload.Id !== workload.Id || !restartedWorkload.State.Running ||
          restartedPolicy.hash !== initialPolicy.hash ||
          restartedPolicy.version !== initialPolicy.version ||
          restartedPolicy.config_revision !== initialPolicy.config_revision ||
          !sameDocument(restartedPolicy.policy, initialPolicy.policy) ||
          !dockerPersistentLogsDisabled(restartedWorkload))
          throw new Error("sandbox_restart_observation_failed");
        const observation = {
          caseId: probe.caseId, contractHash: probe.contractHash,
          sandboxId: detail.id, containerId: workload.Id, imageDigest: request.imageDigest,
          policyHash: initialPolicy.hash, policyVersion: initialPolicy.version,
          configRevision: initialPolicy.config_revision,
          stoppedObserved: true, restartedObserved: true,
          stopAndStartUsedExpectedSandboxId: true,
        };
        return probeReply("pass", hash(JSON.stringify(canonical(observation))));
      } catch {
        // A timed-out stop can have an unknown effect, so inspect the exact
        // UUID even when the CLI did not return. Restart only that same target.
        try {
          const current = await observed(request.scope, deadlineAt);
          if (current.id === detail.id && current.phase === "Stopped")
            await cli(["sandbox", "start", request.scope.sandboxRef,
              "--expected-sandbox-id", detail.id], deadlineAt, false);
        } catch {}
        return probeReply("unsupported", null);
      }
    }
    if (probe.caseId === "syscall_allow" || probe.caseId === "syscall_deny") {
      const helperPath = "/.openshell/runtime/openshell-sandbox";
      if (!readOnlyPathAllows(effective.policy, helperPath) ||
        (effective.policy?.filesystem_policy?.read_write ?? []).some(value =>
          pathContains(value, helperPath) || pathContains(helperPath, value)))
        return probeReply("unsupported", null);
      const result = await sandboxExec(request.scope, detail.id,
        [helperPath, "runtime-seccomp-probe"], deadlineAt);
      if (result.exitCode === 127 || result.exitCode === 124 || result.exitCode === null)
        return probeReply("unsupported", null);
      if (result.exitCode !== 0) return probeReply("fail", null);
      let report;
      try { report = JSON.parse(result.stdout); }
      catch { return probeReply("fail", null); }
      const expectedKeys = ["denied_errno", "getpid", "memfd_create", "profile", "version"];
      if (!report || Object.keys(report).sort().join("\0") !== expectedKeys.join("\0") ||
        report.version !== 1 || report.profile !== "openshell-linux-built-in-seccomp-v1" ||
        report.getpid !== "allowed" || report.memfd_create !== "denied" || report.denied_errno !== "EPERM")
        return probeReply("fail", null);
      const observation = {
        caseId: probe.caseId,
        contractHash: probe.contractHash,
        sandboxId: detail.id,
        containerId: workload.Id,
        imageDigest: request.imageDigest,
        policyHash: effective.hash,
        policyVersion: effective.version,
        configRevision: effective.config_revision,
        profile: report.profile,
        assertion: probe.caseId === "syscall_allow" ? "getpid_allowed" : "memfd_create_denied_eperm",
      };
      return probeReply("pass", hash(JSON.stringify(canonical(observation))));
    }
    let observation;
    if (probe.caseId === "process_nonprivileged") {
      const user = effective.policy?.process?.run_as_user;
      if (!/^[1-9][0-9]{0,8}$/.test(user ?? ""))
        return probeReply("unsupported", null);
      const result = await sandboxExec(request.scope, detail.id, ["/usr/bin/id", "-u"], deadlineAt);
      if (result.exitCode === 127 || result.exitCode === 124 || result.exitCode === null)
        return probeReply("unsupported", null);
      if (result.exitCode !== 0 || result.stdout.trim() !== user)
        return probeReply("fail", null);
      observation = { caseId: probe.caseId, contractHash: probe.contractHash, sandboxId: detail.id, policyHash: effective.hash, policyVersion: effective.version, configRevision: effective.config_revision, observedUid: Number(user) };
    } else if (probe.caseId === "process_privilege_denied") {
      const helper = "/.openshell/runtime/openshell-sandbox";
      if (!readOnlyPathAllows(effective.policy, helper) ||
        (effective.policy?.filesystem_policy?.read_write ?? []).some(value =>
          pathContains(value, helper) || pathContains(helper, value)))
        return probeReply("unsupported", null);
      const result = await sandboxExec(request.scope, detail.id, [helper, "runtime-privilege-probe"], deadlineAt);
      if (result.exitCode === 127 || result.exitCode === 124 || result.exitCode === null)
        return probeReply("unsupported", null);
      if (result.exitCode !== 0) return probeReply("fail", null);
      let report;
      try { report = JSON.parse(result.stdout); } catch { return probeReply("fail", null); }
      const passKeys = ["effective_capabilities_zero", "errno", "setuid_root", "uid_nonroot", "verdict", "version"];
      if (!report || Object.keys(report).sort().join("\0") !== passKeys.join("\0") || report.version !== 1)
        return probeReply("fail", null);
      if (report.verdict === "unsupported") return probeReply("unsupported", null);
      if (report.verdict !== "pass" || report.uid_nonroot !== true ||
        report.effective_capabilities_zero !== true || report.setuid_root !== "denied" || report.errno !== "EPERM")
        return probeReply("fail", null);
      observation = { caseId: probe.caseId, contractHash: probe.contractHash, sandboxId: detail.id,
        containerId: workload.Id, imageDigest: request.imageDigest, policyHash: effective.hash,
        policyVersion: effective.version, configRevision: effective.config_revision,
        assertion: "nonroot_zero_capabilities_setuid0_eperm" };
    } else if (["network_allow", "network_host_port_deny", "network_dns_redirect_deny",
      "network_l7_allow", "network_l7_deny"].includes(probe.caseId)) {
      const fixture = networkProbeFixture();
      if (!fixture) return probeReply("unsupported", null);
      const item = probe.caseId === "network_allow" ? fixture.allow :
        probe.caseId === "network_host_port_deny" ? fixture.hostPortDeny :
        probe.caseId === "network_l7_allow" ? fixture.l7Allow :
        probe.caseId === "network_l7_deny" ? fixture.l7Deny : fixture.dnsRedirectDeny;
      const l7Case = probe.caseId === "network_l7_allow" || probe.caseId === "network_l7_deny";
      const requirePolicyEndpoint = probe.caseId === "network_allow" ||
        probe.caseId === "network_l7_allow" || probe.caseId === "network_l7_deny" ||
        probe.caseId === "network_dns_redirect_deny";
      const expectedEndpoint = probe.caseId === "network_dns_redirect_deny" ? fixture.dnsRedirectDeny : item;
      const selectedEndpoint = networkEndpoint(effective.policy, expectedEndpoint, { l7: l7Case });
      if (requirePolicyEndpoint && !selectedEndpoint) return probeReply("unsupported", null);
      if (probe.caseId === "network_host_port_deny" && networkEndpoint(effective.policy, item))
        return probeReply("unsupported", null);
      if (probe.caseId === "network_host_port_deny" && networkEndpoint(effective.policy, fixture.wrongHostDeny))
        return probeReply("unsupported", null);
      const uid = effective.policy?.process?.run_as_user;
      const gid = effective.policy?.process?.run_as_group;
      if (!/^[1-9][0-9]{0,8}$/.test(uid ?? "") || !/^[0-9]{1,9}$/.test(gid ?? ""))
        return probeReply("unsupported", null);
      const nonce = randomUUID();
      const dnsCase = probe.caseId === "network_dns_redirect_deny";
      const direct = await directCanaryHttp(workload, uid, gid, item, nonce, deadlineAt, {
        resolve: dnsCase,
      });
      if (!direct || direct.status !== 200 || direct.body !== item.marker)
        return probeReply("unsupported", null);
      const before = await container(request.scope, detail, request.imageDigest, deadlineAt);
      if (before.Id !== workload.Id || !before.State.Running) throw new Error("sandbox_scope_changed");
      let redirectAttempt = null;
      if (dnsCase) {
        const redirect = fixture.redirectDeny;
        if (!networkEndpoint(effective.policy, redirect)) return probeReply("unsupported", null);
        const redirectBaseline = await directCanaryHttp(workload, uid, gid, redirect, nonce, deadlineAt, { follow: true });
        if (!redirectBaseline || redirectBaseline.status !== 200 || redirectBaseline.body !== redirect.marker)
          return probeReply("unsupported", null);
        const redirected = await sandboxCanaryHttp(request.scope, detail.id, redirect, nonce, deadlineAt, { follow: true });
        const redirectResponse = parseCanaryHttp(redirected);
        let redirectDenial;
        try { redirectDenial = JSON.parse(redirectResponse?.body ?? ""); } catch {}
        if (!redirectResponse || redirectResponse.status !== 403 || redirectDenial?.error !== "policy_denied")
          return probeReply(redirected.exitCode === 0 ? "fail" : "unsupported", null);
        redirectAttempt = { status: redirectResponse.status, bodyHash: hash(redirectResponse.body) };
      }
      const sandboxResult = await sandboxCanaryHttp(request.scope, detail.id, item, nonce, deadlineAt, {
        resolve: dnsCase, direct: dnsCase,
      });
      const after = await container(request.scope, detail, request.imageDigest, deadlineAt);
      if (after.Id !== workload.Id || !after.State.Running) throw new Error("sandbox_scope_changed");
      if (sandboxResult.exitCode === 127 || sandboxResult.exitCode === 124 || sandboxResult.exitCode === null)
        return probeReply("unsupported", null);
      let assertion;
      let wrongHostAttempt = null;
      if (dnsCase) {
        if (sandboxResult.exitCode === 0 || sandboxResult.stdout.length !== 0)
          return probeReply("fail", null);
        assertion = "redirect_policy_denial_and_pinned_resolve_target_rejected";
      } else {
        const response = parseCanaryHttp(sandboxResult);
        if (!response) return probeReply(sandboxResult.exitCode === 0 ? "fail" : "unsupported", null);
        const shouldAllow = probe.caseId === "network_allow" || probe.caseId === "network_l7_allow";
        if (shouldAllow) {
          if (response.status !== 200 || response.body !== item.marker) return probeReply("fail", null);
          assertion = "fixture_http_response_allowed";
        } else {
          let denial;
          try { denial = JSON.parse(response.body); } catch { return probeReply("fail", null); }
          if (response.status !== 403 || denial?.error !== "policy_denied") return probeReply("fail", null);
          assertion = probe.caseId === "network_l7_deny"
            ? "fresh_l7_policy_denial_response" : "fresh_destination_policy_denial_response";
        }
      }
      if (probe.caseId === "network_host_port_deny") {
        const wrongHost = fixture.wrongHostDeny;
        const wrongHostBaseline = await directCanaryHttp(workload, uid, gid, wrongHost, nonce, deadlineAt);
        if (!wrongHostBaseline || wrongHostBaseline.status !== 200 || wrongHostBaseline.body !== wrongHost.marker)
          return probeReply("unsupported", null);
        const wrongHostResponse = parseCanaryHttp(await sandboxCanaryHttp(request.scope, detail.id,
          wrongHost, nonce, deadlineAt));
        let wrongHostDenial;
        try { wrongHostDenial = JSON.parse(wrongHostResponse?.body ?? ""); } catch {}
        const stillSame = await container(request.scope, detail, request.imageDigest, deadlineAt);
        if (stillSame.Id !== workload.Id || !stillSame.State.Running) throw new Error("sandbox_scope_changed");
        if (!wrongHostResponse || wrongHostResponse.status !== 403 || wrongHostDenial?.error !== "policy_denied")
          return probeReply("fail", null);
        wrongHostAttempt = { status: wrongHostResponse.status, bodyHash: hash(wrongHostResponse.body),
          baselineBodyHash: hash(wrongHostBaseline.body) };
      }
      observation = { caseId: probe.caseId, contractHash: probe.contractHash,
        sandboxId: detail.id, containerId: workload.Id, imageDigest: request.imageDigest,
        policyHash: effective.hash, policyVersion: effective.version,
        configRevision: effective.config_revision, fixtureHash: qualificationFixtureHash(),
        attemptHash: hash(nonce), markerHash: hash(item.marker),
        endpointHash: hash(new URL(item.urlTemplate.replace("{nonce}", nonce)).origin),
        hostBaseline: { status: direct.status, bodyHash: hash(direct.body) },
        assertion, ...(redirectAttempt ? { redirectAttempt } : {}),
        ...(wrongHostAttempt ? { wrongHostAttempt } : {}) };
    } else if (["filesystem_allow", "filesystem_deny", "filesystem_escape"].includes(probe.caseId)) {
      const fixture = filesystemProbeFixture();
      if (!fixture) return probeReply("unsupported", null);
      const target = probe.caseId === "filesystem_allow" ? fixture.allowedReadPath :
        probe.caseId === "filesystem_deny" ? fixture.deniedReadPath : fixture.escapeTargetPath;
      const operand = probe.caseId === "filesystem_escape" ? fixture.escapeOperand : target;
      const expectedAllowed = probe.caseId === "filesystem_allow";
      if (filesystemPathAllowed(effective.policy, target) !== expectedAllowed ||
        (probe.caseId === "filesystem_escape" &&
          (!filesystemPathAllowed(effective.policy, fixture.escapeViaRoot) || filesystemPathAllowed(effective.policy, target))))
        return probeReply("unsupported", null);
      const marker = probe.caseId === "filesystem_allow" ? fixture.allowedReadMarker :
        probe.caseId === "filesystem_deny" ? fixture.deniedReadMarker : fixture.escapeReadMarker;
      const hostRead = await dockerCanaryRead(workload,
        effective.policy?.process?.run_as_user, effective.policy?.process?.run_as_group,
        target, marker, deadlineAt);
      if (!hostRead) return probeReply("unsupported", null);
      const before = await container(request.scope, detail, request.imageDigest, deadlineAt);
      if (before.Id !== workload.Id) throw new Error("sandbox_scope_changed");
      // /usr/bin/test reads metadata only. Docker exec verifies the same exact
      // immutable container and UID can see the canary outside OpenShell's
      // Landlock path; sandbox exec then tests the policy-bound path operand.
      const result = await sandboxExec(request.scope, detail.id, ["/usr/bin/head", "-c", "1", operand], deadlineAt);
      const after = await container(request.scope, detail, request.imageDigest, deadlineAt);
      if (after.Id !== workload.Id) throw new Error("sandbox_scope_changed");
      if (result.exitCode === 127 || result.exitCode === 124 || result.exitCode === null)
        return probeReply("unsupported", null);
      if (expectedAllowed && (result.exitCode !== 0 || result.stdout !== marker)) return probeReply("fail", null);
      if (!expectedAllowed && (result.exitCode !== 1 || result.stdout.length !== 0))
        return probeReply(result.exitCode === 0 ? "fail" : "unsupported", null);
      observation = { caseId: probe.caseId, contractHash: probe.contractHash, sandboxId: detail.id,
        containerId: workload.Id, imageDigest: request.imageDigest, policyHash: effective.hash,
        policyVersion: effective.version, configRevision: effective.config_revision,
        fixtureHash: qualificationFixtureHash(), targetPath: target,
        operandHash: hash(operand), canaryMarkerHash: hash(marker),
        hostCanaryMode: hostRead.mode, hostReadMatchedMarker: true,
        assertion: expectedAllowed ? "allowed_canary_read" : "host_readable_but_boundary_denied" };
    } else {
      // No other v0.1.2 probe is reported as passing without its dedicated
      // runtime assertion (including a policy_denied observation for denies).
      return probeReply("unsupported", null);
    }
    return probeReply("pass", hash(JSON.stringify(canonical(observation))));
  }
  async function observed(scope, deadlineAt, expectedTarget) {
    const detail = await cli(
      ["sandbox", "get", scope.sandboxRef, "--output", "json"],
      deadlineAt,
    );
    const labels = {
      "aw.company_id": scope.companyId,
      "aw.binding_id": scope.bindingId,
      "aw.cell_id": scope.cellId,
      "aw.generation": scope.cellGeneration,
    };
    if (
      typeof detail.id !== "string" ||
      !uuid.test(detail.id) ||
      detail.name !== scope.sandboxRef ||
      detail.workspace !== config.workspace ||
      Object.entries(labels).some(
        ([key, value]) => detail.labels?.[key] !== value,
      )
    )
      throw new Error("sandbox_scope_changed");
    // Cleanup receipts are attenuated to the exact successful start target.
    // Check the Sandbox UUID before journaling an otherwise-unpinned name, so
    // a same-label replacement cannot become the new trusted instance.
    if (expectedTarget && detail.id !== expectedTarget.sandboxId)
      throw new Error("sandbox_scope_changed");
    const pinned = journal.scopes[scope.bindingId];
    if (pinned) {
      if (
        Object.keys(scope).some((key) => pinned.scope[key] !== scope[key]) ||
        pinned.sandboxId !== detail.id
      ) throw new Error("sandbox_scope_changed");
    } else {
      if (Object.keys(journal.scopes).length >= 256)
        throw new Error("sandbox_host_unavailable");
      // The gateway's immutable sandbox ID is distinct from a reusable name.
      // Persist it before the first effect, so restart cannot adopt a replacement.
      journal.scopes[scope.bindingId] = { scope, sandboxId: detail.id };
      await atomicJson(journalFile, journal);
    }
    return detail;
  }
  async function policy(scope, deadlineAt) {
    const result = await cli(
      ["policy", "get", scope.sandboxRef, "--full", "--output", "json"],
      deadlineAt,
    );
    if (
      result.sandbox !== scope.sandboxRef ||
      result.status !== "effective" ||
      !/^[a-f0-9]{64}$/.test(result.hash ?? "") ||
      !Number.isSafeInteger(result.version) ||
      result.version < 0 ||
      !Number.isSafeInteger(result.config_revision) ||
      result.config_revision < 0 ||
      !result.policy
    )
      throw new Error("sandbox_observation_unavailable");
    await observed(scope, deadlineAt);
    return result;
  }
  async function container(scope, sandbox, imageDigest, deadlineAt) {
    const engineId = (await docker(["info", "--format", "{{.ID}}"], deadlineAt, false)).trim();
    if (!engineId || engineId.length > 200 || /[\r\n\0]/.test(engineId))
      throw new Error("sandbox_operation_unsupported");
    const engineIdHash = hash(engineId);
    const enginePin = journal.scopes[scope.bindingId]?.dockerEngineId;
    if (enginePin && enginePin !== engineIdHash)
      throw new Error("sandbox_scope_changed");
    const idsOutput = await docker(
      [
        "ps",
        "-aq",
        "--no-trunc",
        "--filter",
        `label=openshell.ai/sandbox-id=${sandbox.id}`,
        "--filter",
        "label=openshell.ai/isolation-role=sandbox",
      ],
      deadlineAt,
      false,
    );
    const ids = idsOutput.trim().split(/\s+/).filter(Boolean);
    if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0]))
      throw new Error("sandbox_operation_unsupported");
    const values = await docker(["inspect", ids[0]], deadlineAt);
    if (!Array.isArray(values) || values.length !== 1)
      throw new Error("sandbox_observation_unavailable");
    const value = values[0];
    const labels = value.Config?.Labels;
    const expectedLabels = {
      "openshell.ai/managed-by": "openshell",
      "openshell.ai/sandbox-id": sandbox.id,
      "openshell.ai/sandbox-name": scope.sandboxRef,
      "openshell.ai/sandbox-workspace": config.workspace,
      "openshell.ai/isolation-backend": "openshell-sandbox",
      "openshell.ai/isolation-role": "sandbox",
      "aw.company_id": scope.companyId,
      "aw.binding_id": scope.bindingId,
      "aw.cell_id": scope.cellId,
      "aw.generation": scope.cellGeneration,
    };
    if (
      value.Id !== ids[0] ||
      Object.entries(expectedLabels).some(([key, expected]) => labels?.[key] !== expected) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(labels?.["openshell.ai/sandbox-namespace"] ?? "") ||
      typeof value.Config?.Image !== "string" ||
      !(value.Config.Image === imageDigest || value.Config.Image === value.Image) ||
      !/^sha256:[a-f0-9]{64}$/.test(value.Image ?? "") ||
      typeof value.State?.Running !== "boolean"
    )
      throw new Error("sandbox_scope_changed");
    const imageRows = await docker(["image", "inspect", value.Image], deadlineAt);
    if (!Array.isArray(imageRows) || imageRows.length !== 1 || imageRows[0]?.Id !== value.Image ||
      !Array.isArray(imageRows[0]?.RepoDigests) || !imageRows[0].RepoDigests.includes(imageDigest))
      throw new Error("sandbox_scope_changed");
    const pinned = journal.scopes[scope.bindingId];
    if (pinned.containerId && pinned.containerId !== value.Id)
      throw new Error("sandbox_scope_changed");
    if (pinned.imageId && pinned.imageId !== value.Image)
      throw new Error("sandbox_scope_changed");
    if (
      pinned.namespace &&
      pinned.namespace !== labels["openshell.ai/sandbox-namespace"]
    )
      throw new Error("sandbox_scope_changed");
    if (!pinned.containerId || !pinned.dockerEngineId) {
      journal.scopes[scope.bindingId] = {
        ...pinned,
        containerId: value.Id,
        imageId: value.Image,
        namespace: labels["openshell.ai/sandbox-namespace"],
        dockerEngineId: engineIdHash,
      };
      await atomicJson(journalFile, journal);
    }
    return value;
  }
  async function contain(scope, imageDigest, deadlineAt) {
    try {
      await revokeProviders(scope, deadlineAt);
      const target = await observed(scope, deadlineAt);
      await cli(["sandbox", "stop", scope.sandboxRef, "--expected-sandbox-id", target.id], deadlineAt, false);
      const stopped = await observed(scope, deadlineAt);
      const workload = await container(scope, stopped, imageDigest, deadlineAt);
      if (stopped.phase !== "Stopped" || workload.State.Running)
        throw new Error("sandbox_observation_unavailable");
      await deleteQuiescedBrokerProviders(scope, deadlineAt, true);
    } catch {
      throw new Error("sandbox_host_unavailable");
    }
  }
  function staticPolicyMatches(left, right) {
    return (
      sameDocument(left.filesystem_policy, right.filesystem_policy) &&
      sameDocument(left.landlock, right.landlock) &&
      sameDocument(left.process, right.process)
    );
  }
  async function revokeProviders(scope, deadlineAt) {
    const before = await cli(
      ["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "4", "--output", "json"],
      deadlineAt,
    );
    if (!Array.isArray(before.providers) || before.providers.length > 4 || before.next_page_token !== "")
      throw new Error("sandbox_operation_unsupported");
    for (const provider of before.providers) {
      const target = await observed(scope, deadlineAt);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(provider.name ?? ""))
        throw new Error("sandbox_observation_unavailable");
      await cli(
        ["sandbox", "provider", "detach", scope.sandboxRef, provider.name, "--expected-sandbox-id", target.id, "--wait", "--timeout", "2", "--output", "json"],
        deadlineAt,
      );
    }
    const after = await cli(
      ["sandbox", "provider", "list", scope.sandboxRef, "--page-size", "4", "--output", "json"],
      deadlineAt,
    );
    if (!Array.isArray(after.providers) || after.providers.length || after.next_page_token !== "")
      throw new Error("sandbox_observation_unavailable");
    await observed(scope, deadlineAt);
  }
  function samePolicyRevision(result, pinned) {
    return (
      result.hash === pinned.effectivePolicyHash &&
      result.version === pinned.policyVersion &&
      result.config_revision === pinned.configRevision &&
      sameDocument(result.policy, pinned.document)
    );
  }
  function provisioningLabels(scope, requestId, provisioningHash, operationKey, bindingVersion) {
    return {
      "aw.company_id": scope.companyId,
      "aw.binding_id": scope.bindingId,
      "aw.cell_id": scope.cellId,
      "aw.generation": scope.cellGeneration,
      "aw.binding_version": String(bindingVersion),
      "aw.provisioning_request_id": requestId,
      "aw.provisioning_hash": provisioningHash,
      "aw.operation_key_hash": hash(operationKey),
    };
  }
  async function listProvisioningCandidates(scope, deadlineAt) {
    const result = await cli(["sandbox", "list", "--selector", `aw.binding_id=${scope.bindingId}`,
      "--page-size", "10", "--output", "json"], deadlineAt);
    if (!Array.isArray(result.sandboxes) || result.sandboxes.length > 10 || result.next_page_token !== "")
      throw new Error("sandbox_observation_unavailable");
    return result.sandboxes;
  }
  function verifyProvisioningMarker(value, scope, requestId, provisioningHash, operationKey, bindingVersion) {
    return verifyProvisioningMarkerHash(value, scope, requestId, provisioningHash, hash(operationKey), bindingVersion);
  }
  function verifyProvisioningMarkerHash(value, scope, requestId, provisioningHash, operationKeyHash, bindingVersion) {
    const expectedLabels = {
      ...provisioningLabels(scope, requestId, provisioningHash, "", bindingVersion),
      "aw.operation_key_hash": operationKeyHash,
    };
    return value && value.name === scope.sandboxRef && typeof value.id === "string" && uuid.test(value.id) &&
      value.workspace === config.workspace && Object.entries(expectedLabels).every(([key, expected]) =>
        value.labels?.[key] === expected);
  }
  function validQualificationSample(sample) {
    const target = sample?.sampleTarget;
    const creation = sample?.creation;
    if (!target || !creation || creation.purpose !== "qualification" || !sample.probeFixture ||
      !/^[a-f0-9]{64}$/.test(target.targetHash ?? "") ||
      !sameDocument(sample.probeFixture, qualificationProbeFixture()) ||
      target.sandboxId !== creation.sandboxId || target.containerId !== creation.containerId ||
      target.provisioningHash !== creation.provisioningHash || target.bindingVersion !== creation.bindingVersion ||
      target.imageDigest !== creation.imageDigest || target.policyHash !== creation.policyHash ||
      !sameDocument(target.resourceLimits, creation.resourceLimits) ||
      target.probePolicyHash !== creation.observedPolicyHash || target.policyVersion !== creation.policyVersion ||
      target.configRevision !== String(creation.configRevision) ||
      !sameDocument(target.qualificationCredentialFixture ?? null, sample.probeFixture.credential ?? null) ||
      target.probeFixtureHash !== sample.probeFixture.fixtureHash) return false;
    const { targetHash, ...body } = target;
    return hash(JSON.stringify(canonical(body))) === targetHash;
  }
  async function cleanupExpiredProvisioning(request, detail, workload, provisioning, deadlineAt) {
    if (detail.phase !== "Stopped" || workload.State.Running) {
      await cli(["sandbox", "stop", request.scope.sandboxRef,
        "--expected-sandbox-id", detail.id], deadlineAt, false);
      const stopped = await observed(request.scope, deadlineAt);
      const stoppedWorkload = await container(request.scope, stopped, request.imageDigest, deadlineAt);
      if (stopped.id !== detail.id || stopped.phase !== "Stopped" ||
        stoppedWorkload.Id !== workload.Id || stoppedWorkload.State.Running)
        throw new Error("sandbox_observation_unavailable");
    }
    await cli(["sandbox", "delete", request.scope.sandboxRef,
      "--expected-sandbox-id", detail.id], deadlineAt, false);
    const remaining = await listProvisioningCandidates(request.scope, deadlineAt);
    if (remaining.some(value => value.id === detail.id || value.name === request.scope.sandboxRef))
      throw new Error("sandbox_observation_unavailable");
    delete journal.scopes[request.scope.bindingId];
    await atomicJson(journalFile, journal);
    throw new Error("sandbox_scope_changed");
  }
  function provisioningRecord(value, envelope, provisioningHash, requestId, imageDigest) {
    return {
      state: "claimed", envelope, provisioningHash, requestId,
      operationKey: value.operationKey, operationKeyHash: hash(value.operationKey),
      imageDigest, bindingVersion: value.bindingVersion,
      resourceLimits: value.resourceLimits, purpose: value.purpose,
      expiresAt: value.expiresAt, idleUntilUnixSeconds: value.idleUntilUnixSeconds,
      policyHash: value.policyHash, document: canonical(value.document),
    };
  }
  function creationRecord(value, imageDigest, requestId, provisioningHash, sandboxId, containerId, workdirPath) {
    return {
      purpose: value.purpose, imageDigest, requestId, provisioningHash,
      operationKey: value.operationKey, operationKeyHash: hash(value.operationKey),
      bindingVersion: value.bindingVersion, policyHash: value.policyHash,
      document: canonical(value.document), resourceLimits: canonical(value.resourceLimits),
      expiresAt: value.expiresAt, idleUntilUnixSeconds: value.idleUntilUnixSeconds,
      sandboxId, containerId, workdirPath,
    };
  }
  async function exactCreatedWorkload(scope, request, record, deadlineAt) {
    if (!record?.sandboxId || !record.containerId || record.imageDigest !== request.imageDigest)
      throw new Error("sandbox_scope_changed");
    const candidates = await listProvisioningCandidates(scope, deadlineAt);
    if (candidates.length !== 1 || candidates[0].id !== record.sandboxId ||
      !verifyProvisioningMarkerHash(candidates[0], scope, record.requestId,
        record.provisioningHash, record.operationKeyHash, record.bindingVersion))
      throw new Error("sandbox_scope_changed");
    const detail = await observed(scope, deadlineAt);
    if (detail.id !== record.sandboxId ||
      !verifyProvisioningMarkerHash(detail, scope, record.requestId,
        record.provisioningHash, record.operationKeyHash, record.bindingVersion))
      throw new Error("sandbox_scope_changed");
    const workload = await container(scope, detail, record.imageDigest, deadlineAt);
    const currentPolicy = await policy(scope, deadlineAt);
    if (workload.Id !== record.containerId || workload.Config?.WorkingDir !== record.workdirPath ||
      workload.Config?.Labels?.["aw.provisioning_request_id"] !== record.requestId ||
      workload.Config?.Labels?.["aw.provisioning_hash"] !== record.provisioningHash ||
      workload.Config?.Labels?.["aw.operation_key_hash"] !== record.operationKeyHash ||
      workload.Config?.Labels?.["aw.binding_version"] !== String(record.bindingVersion) ||
      !sameDocument(currentPolicy.policy, record.document) ||
      !resourceHostConfigMatches(workload, record.resourceLimits, record.document) ||
      !(await dockerDiskQuotaBackendSupported(deadlineAt)) ||
      !(await dockerSupervisorLogsDisabled(scope, detail, deadlineAt)))
      throw new Error("sandbox_scope_changed");
    return { detail, workload, currentPolicy };
  }
  async function currentControlHealth(request, deadlineAt) {
    const denied = (reasonCode) => {
      if (globalThis.process?.env?.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1" &&
        ["qualification_state_invalid", "creation_state_invalid", "policy_pin_invalid", "workdir_invalid",
          "sample_profile_invalid", "current_target_invalid", "credential_profile_invalid"].includes(reasonCode))
        globalThis.process.stderr.write(`${JSON.stringify({ event: "openshell_current_control_health_denied", reasonCode })}\n`);
      return false;
    };
    const scope = request.scope;
    const entry = journal.scopes[scope.bindingId];
    const sample = entry?.qualification;
    const original = sample?.sampleTarget;
    const creation = entry?.creation;
    if (!entry || entry.transition || !sample || !original || !creation || !validQualificationSample(sample) ||
      !sample.expiresAt || Date.parse(sample.expiresAt) <= Date.now() ||
      Date.parse(creation.expiresAt) <= Date.now() || creation.imageDigest !== request.imageDigest ||
      !sameDocument(entry.scope, scope) || entry.provisioning?.provisioningHash !== creation.provisioningHash ||
      entry.provisioning?.requestId !== creation.requestId ||
      !sameDocument(entry.provisioning.document, creation.document) ||
      !sameDocument(entry.provisioning.resourceLimits, creation.resourceLimits)) return denied("qualification_state_invalid");
    const observed = await exactCreatedWorkload(scope, request, creation, deadlineAt);
    const { detail, workload, currentPolicy } = observed;
    if (!(["Ready", "Stopped"].includes(detail.phase)) ||
      (detail.phase === "Ready" && workload.State.Running !== true) ||
      (detail.phase === "Stopped" && workload.State.Running !== false) ||
      detail.id !== creation.sandboxId || workload.Id !== creation.containerId ||
      !sameDocument(creation.resourceLimits, sample.creation.resourceLimits)) return denied("creation_state_invalid");
    const pinned = entry.policy;
    if (pinned) {
      if (!samePolicyRevision(currentPolicy, pinned) || !sameDocument(currentPolicy.policy, pinned.document) ||
        !resourceHostConfigMatches(workload, pinned.resourceLimits, pinned.document)) return denied("policy_pin_invalid");
    } else if (!sameDocument(currentPolicy.policy, creation.document) ||
      currentPolicy.hash !== creation.observedPolicyHash ||
      !resourceHostConfigMatches(workload, creation.resourceLimits, creation.document)) return denied("policy_pin_invalid");
    const workdir = creation.workdirPath;
    const writeRoots = currentPolicy.policy?.filesystem_policy?.read_write;
    if (typeof workdir !== "string" || workload.Config?.WorkingDir !== workdir ||
      workload.Config?.Labels?.["openshell.ai/workspace-root"] !== workdir || !Array.isArray(writeRoots) ||
      !writeRoots.some(root => pathContains(root, workdir))) return denied("workdir_invalid");
    const targetFacts = original;
    const profileDeadlineAt = new Date(Math.min(
      Date.parse(deadlineAt), Date.parse(creation.expiresAt), Date.parse(sample.expiresAt),
      Date.parse(entry.provisioning.expiresAt),
    )).toISOString();
    const profileSelection = config.runtimeBrokerProfiles === undefined
      ? undefined : structuredClone(config.runtimeBrokerProfiles);
    const installedProfiles = await inspectInstalledBrokerProfiles({
      selection: profileSelection,
      cli: (args, boundedDeadlineAt) => cli(args, boundedDeadlineAt),
      deadlineAt: profileDeadlineAt,
    });
    const profileDetails = {
      ...(installedProfiles.credentialBrokerProviderProfile && profileSelection?.app
        ? { credentialBrokerProviderProfile: { ...installedProfiles.credentialBrokerProviderProfile, origin: profileSelection.app.origin } } : {}),
      ...(installedProfiles.modelBrokerProviderProfile && profileSelection?.model
        ? { modelBrokerProviderProfile: { ...installedProfiles.modelBrokerProviderProfile, origin: profileSelection.model.origin } } : {}),
    };
    const facts = sample.capabilityFacts;
    if (!facts || !["filesystemPolicy", "processPrivilegePolicy", "syscallPolicy", "networkDestinationPolicy",
      "networkLayer7Policy", "credentialBrokering", "resourceLimits", "forceStop"].every(key => facts[key] === true) ||
      !sameDocument(facts.credentialBrokerProviderProfile ?? null, profileDetails.credentialBrokerProviderProfile ?? null) ||
      !sameDocument(facts.modelBrokerProviderProfile ?? null, profileDetails.modelBrokerProviderProfile ?? null) ||
      !sameDocument(facts.credentialBindingDimensions ?? [], installedProfiles.credentialProfileDimensions ?? [])) return denied("sample_profile_invalid");
    const kernel = (await docker(["info", "--format", "{{.KernelVersion}}"], deadlineAt, false)).trim();
    const runtimeHash = await observedRuntimeBinarySha256(workload.Id, deadlineAt);
    const engineHash = journal.scopes[scope.bindingId]?.dockerEngineId;
    if (targetFacts.hostEpoch !== epoch || targetFacts.companyId !== scope.companyId ||
      targetFacts.bindingId !== scope.bindingId || targetFacts.cellId !== scope.cellId ||
      targetFacts.cellGeneration !== scope.cellGeneration || targetFacts.sandboxRef !== scope.sandboxRef ||
      targetFacts.imageDigest !== request.imageDigest || targetFacts.hostKernelVersion !== kernel ||
      targetFacts.runtimeBinarySha256 !== runtimeHash || targetFacts.openshellCliSha256 !== config.executableSha256 ||
      targetFacts.dockerEngineIdHash !== engineHash || targetFacts.policyVersion !== currentPolicy.version ||
      !sameDocument(targetFacts.resourceLimits, creation.resourceLimits) ||
      targetFacts.probeFixtureHash !== sample.probeFixture.fixtureHash ||
      !targetFacts.qualificationCredentialFixture ||
      !sameDocument(targetFacts.qualificationCredentialFixture, qualificationCredentialFixture())) return denied("current_target_invalid");
    try { await inspectQualificationCredentialProfile(targetFacts.qualificationCredentialFixture, deadlineAt); }
    catch { return denied("credential_profile_invalid"); }
    return true;
  }
  function preparedReply(request, entry, provisioningHash, value, requiresRecreate = false) {
    return {
      action: "prepare", backendVersion: "0.1.2", imageDigest: request.imageDigest,
      hostEpoch: epoch,
      provisioningHash, bindingVersion: value.bindingVersion, policyHash: value.policyHash,
      probePolicyHash: requiresRecreate
        ? hash(JSON.stringify(canonical(value.document)))
        : (entry.provisioning?.observedPolicyHash ?? hash(JSON.stringify(canonical(value.document)))),
      resourceLimits: value.resourceLimits,
      ...(requiresRecreate ? { requiresRecreate: true } : {
        sandboxId: entry.sandboxId, containerId: entry.containerId,
      }),
    };
  }
  async function retireQualificationTarget(request, entry, requested, deadlineAt) {
    const creation = entry.creation;
    const sample = entry.qualification;
    const resuming = entry.transition?.phase === "retire-qualification" &&
      entry.transition.requestId === requested.requestId &&
      entry.transition.provisioningHash === requested.provisioningHash &&
      sameDocument(entry.transition.currentIntent, requested) &&
      entry.transition.fromSandboxId === creation?.sandboxId &&
      entry.transition.fromCreationHash === creation?.provisioningHash;
    if (!creation || creation.purpose !== "qualification" || !validQualificationSample(sample) ||
      !sameDocument(creation, sample.creation) ||
      !sample.expiresAt || Date.parse(sample.expiresAt) <= Date.now() ||
      Date.parse(requested.expiresAt) > Date.parse(sample.expiresAt) ||
      requested.idleUntilUnixSeconds > creation.idleUntilUnixSeconds ||
      creation.sandboxId !== entry.sandboxId || creation.containerId !== entry.containerId)
      throw new Error("sandbox_scope_changed");
    if (creation.imageDigest !== request.imageDigest ||
      Object.keys(creation.resourceLimits).some(key => request.provisioning.resourceLimits[key] > creation.resourceLimits[key]))
      throw new Error("sandbox_scope_changed");
    entry.transition = {
      phase: "retire-qualification", fromSandboxId: creation.sandboxId,
      fromContainerId: creation.containerId, fromCreationHash: creation.provisioningHash,
      requestId: requested.requestId, provisioningHash: requested.provisioningHash,
      currentIntent: structuredClone(requested),
    };
    await atomicJson(journalFile, journal);
    const candidates = await listProvisioningCandidates(request.scope, deadlineAt);
    if (!candidates.length && !resuming) throw new Error("sandbox_scope_changed");
    if (candidates.length) {
      if (candidates.length !== 1 || candidates[0].id !== creation.sandboxId ||
        !verifyProvisioningMarkerHash(candidates[0], request.scope, creation.requestId,
          creation.provisioningHash, creation.operationKeyHash, creation.bindingVersion))
        throw new Error("sandbox_scope_changed");
      const { detail, workload, currentPolicy } = await exactCreatedWorkload(request.scope, request, creation, deadlineAt);
      if (detail.phase !== "Stopped" || workload.State.Running ||
        !sameDocument(currentPolicy.policy, creation.document) ||
        !resourceHostConfigMatches(workload, creation.resourceLimits, creation.document)) {
        await cli(["sandbox", "stop", request.scope.sandboxRef,
          "--expected-sandbox-id", creation.sandboxId], deadlineAt, false);
        const stopped = await exactCreatedWorkload(request.scope, request, creation, deadlineAt);
        if (stopped.detail.id !== creation.sandboxId || stopped.detail.phase !== "Stopped" || stopped.workload.State.Running)
          throw new Error("sandbox_observation_unavailable");
      }
      await cli(["sandbox", "delete", request.scope.sandboxRef,
        "--expected-sandbox-id", creation.sandboxId], deadlineAt, false);
    }
    const remaining = await listProvisioningCandidates(request.scope, deadlineAt);
    if (remaining.some(value => value.id === creation.sandboxId || value.name === request.scope.sandboxRef))
      throw new Error("sandbox_observation_unavailable");
    entry.sandboxId = null;
    entry.containerId = null;
    entry.creation = null;
    entry.provisioning = requested;
    entry.transition = { ...entry.transition, phase: "create-admission" };
    await atomicJson(journalFile, journal);
  }
  async function prepareProvisionedSandbox(request, deadlineAt) {
    const scope = request.scope;
    const { envelope, provisioningHash, requestId, expired } = validateProvisioning(request);
    const value = request.provisioning;
    let entry = journal.scopes[scope.bindingId];
    if (expired && value.purpose === "admission") throw new Error("sandbox_scope_changed");
    const requested = provisioningRecord(value, envelope, provisioningHash, requestId, request.imageDigest);
    if (!entry) {
      if (expired || value.idleUntilUnixSeconds <= Math.floor(Date.now() / 1000) + 1 || value.purpose !== "qualification")
        throw new Error("sandbox_scope_changed");
      entry = journal.scopes[scope.bindingId] = {
        scope, sandboxId: null, containerId: null, provisioning: requested,
      };
      await atomicJson(journalFile, journal);
    } else if (!sameDocument(entry.scope, scope) || !entry.provisioning) {
      throw new Error("sandbox_scope_changed");
    }
    if (entry.transition && (entry.transition.requestId !== requestId ||
      entry.transition.provisioningHash !== provisioningHash))
      throw new Error("sandbox_scope_changed");
    const sameCurrentIntent = entry.provisioning.provisioningHash === provisioningHash &&
      entry.provisioning.requestId === requestId &&
      sameDocument(entry.provisioning.envelope, envelope);
    if (value.purpose === "admission" && entry.creation?.purpose === "admission" &&
      sameCurrentIntent) {
      const current = await exactCreatedWorkload(scope, request, entry.creation, deadlineAt);
      if (current.detail.phase !== "Stopped" || current.workload.State.Running)
        throw new Error("sandbox_scope_changed");
      return preparedReply(request, entry, provisioningHash, value);
    }
    if (!sameCurrentIntent) {
      if (value.purpose !== "admission" || expired ||
        value.idleUntilUnixSeconds <= Math.floor(Date.now() / 1000) + 1)
        throw new Error("sandbox_scope_changed");
      if (entry.creation?.purpose === "qualification") {
        if (entry.provisioning.purpose !== "qualification") throw new Error("sandbox_scope_changed");
        await retireQualificationTarget(request, entry, requested, deadlineAt);
      } else if (entry.creation?.purpose === "admission") {
        const creation = entry.creation;
        const samePhysicalEnvelope = creation.imageDigest === request.imageDigest &&
          sameDocument(creation.document, value.document) &&
          sameDocument(creation.resourceLimits, value.resourceLimits) &&
          value.expiresAt <= creation.expiresAt &&
          value.idleUntilUnixSeconds <= creation.idleUntilUnixSeconds;
        if (!samePhysicalEnvelope) return preparedReply(request, entry, provisioningHash, value, true);
        const current = await exactCreatedWorkload(scope, request, creation, deadlineAt);
        if (current.detail.id !== entry.sandboxId || current.workload.Id !== entry.containerId ||
          current.detail.phase !== "Stopped" || current.workload.State.Running)
          throw new Error("sandbox_scope_changed");
        entry.provisioning = requested;
        entry.provisioning.state = "stopped";
        entry.provisioning.observedPolicyHash = current.currentPolicy.hash;
        entry.transition = null;
        await atomicJson(journalFile, journal);
        return preparedReply(request, entry, provisioningHash, value);
      } else {
        throw new Error("sandbox_scope_changed");
      }
    }
    if (!entry.provisioning || entry.provisioning.provisioningHash !== provisioningHash ||
      entry.provisioning.requestId !== requestId || !sameDocument(entry.provisioning.envelope, envelope))
      throw new Error("sandbox_scope_changed");
    if (!entry.creation && value.purpose === "admission" && entry.transition?.phase !== "create-admission")
      throw new Error("sandbox_scope_changed");
    const creation = entry.creation;
    if (creation && (creation.provisioningHash !== provisioningHash || creation.requestId !== requestId ||
      !sameDocument(creation.document, value.document)))
      throw new Error("sandbox_scope_changed");
    const labels = provisioningLabels(scope, requestId, provisioningHash, value.operationKey, value.bindingVersion);
    let candidates = await listProvisioningCandidates(scope, deadlineAt);
    if (candidates.length > 1 || candidates.some(candidate => !verifyProvisioningMarker(
      candidate, scope, requestId, provisioningHash, value.operationKey, value.bindingVersion)))
      throw new Error("sandbox_scope_changed");
    let candidate = candidates[0] ?? null;
    if (entry.sandboxId && (!candidate || candidate.id !== entry.sandboxId))
      throw new Error("sandbox_scope_changed");
    if (candidate && entry.sandboxId && candidate.id !== entry.sandboxId)
      throw new Error("sandbox_scope_changed");
    if (!candidate && expired) throw new Error("sandbox_scope_changed");

    if (!candidate) {
      const privateConfig = await privateConfiguration();
      const filename = path.join(privateConfig.stateHome, `provisioning-policy-${randomUUID()}.json`);
      const driverConfig = JSON.stringify({ docker: {
        disk_limit_bytes: String(value.resourceLimits.diskBytes),
        pids_limit: String(value.resourceLimits.pidsLimit),
      } });
      const labelsArgs = Object.entries(labels).flatMap(([key, label]) => ["--label", `${key}=${label}`]);
      const cpu = `${value.resourceLimits.cpuMillis}m`;
      const idle = ["/.openshell/runtime/openshell-sandbox", "runtime-idle-until",
        "--unix-seconds", String(value.idleUntilUnixSeconds)];
      try {
        await writeFile(filename, JSON.stringify(canonical(value.document)), { flag: "wx", mode: 0o600 });
        try {
          await cli(["sandbox", "create", "--request-id", requestId,
            "--no-auto-providers", "--name", scope.sandboxRef,
            "--from", request.imageDigest,
            "--driver-config-json", driverConfig,
            "--cpu", cpu,
            "--memory", String(value.resourceLimits.memoryBytes),
            "--policy", filename,
            ...labelsArgs,
            "--detach", "--output", "json", "--", ...idle], deadlineAt);
        } catch {
          // Resolve an unknown create outcome only through this journaled request marker.
        }
        candidates = await listProvisioningCandidates(scope, deadlineAt);
        if (candidates.length !== 1 || !verifyProvisioningMarker(candidates[0], scope,
          requestId, provisioningHash, value.operationKey, value.bindingVersion))
          throw new Error("sandbox_observation_unavailable");
        candidate = candidates[0];
      } finally {
        await unlink(filename).catch(() => {});
      }
    }
    if (!candidate || !verifyProvisioningMarker(candidate, scope, requestId,
      provisioningHash, value.operationKey, value.bindingVersion))
      throw new Error("sandbox_scope_changed");

    if (entry.sandboxId && entry.sandboxId !== candidate.id)
      throw new Error("sandbox_scope_changed");
    entry.sandboxId = candidate.id;
    entry.provisioning = { ...entry.provisioning, state: "observed", sandboxId: candidate.id };
    await atomicJson(journalFile, journal);
    const detail = await observed(scope, deadlineAt);
    if (detail.id !== candidate.id || !verifyProvisioningMarker(detail, scope, requestId,
      provisioningHash, value.operationKey, value.bindingVersion))
      throw new Error("sandbox_scope_changed");
    const workload = await container(scope, detail, request.imageDigest, deadlineAt);
    const currentPolicy = await policy(scope, deadlineAt);
    const qualificationWorkdir = value.purpose === "qualification"
      ? value.qualificationProbeFixture.filesystem.workdirPath : null;
    const currentWorkdir = workload.Config?.WorkingDir;
    const allowedWorkdirs = value.document?.filesystem_policy?.read_write;
    if (typeof currentWorkdir !== "string" || !Array.isArray(allowedWorkdirs) ||
      !allowedWorkdirs.some(root => pathContains(root, currentWorkdir)) ||
      workload.Config?.Labels?.["openshell.ai/workspace-root"] !== currentWorkdir ||
      workload.Config?.Labels?.["aw.provisioning_request_id"] !== requestId ||
      workload.Config?.Labels?.["aw.provisioning_hash"] !== provisioningHash ||
      workload.Config?.Labels?.["aw.operation_key_hash"] !== hash(value.operationKey) ||
      workload.Config?.Labels?.["aw.binding_version"] !== String(value.bindingVersion) ||
      (qualificationWorkdir && currentWorkdir !== qualificationWorkdir) ||
      !sameDocument(currentPolicy.policy, value.document) ||
      !(await dockerDiskQuotaBackendSupported(deadlineAt)) ||
      !resourceHostConfigMatches(workload, value.resourceLimits, value.document) ||
      !(await dockerSupervisorLogsDisabled(scope, detail, deadlineAt)))
      throw new Error("sandbox_observation_unavailable");
    if (expired) return cleanupExpiredProvisioning(request, detail, workload, value, deadlineAt);
    if (value.purpose === "admission") {
      if (detail.phase === "Ready" && workload.State.Running) {
        await cli(["sandbox", "stop", scope.sandboxRef,
          "--expected-sandbox-id", detail.id], deadlineAt, false);
        const stopped = await observed(scope, deadlineAt);
        const stoppedWorkload = await container(scope, stopped, request.imageDigest, deadlineAt);
        if (stopped.id !== detail.id || stopped.phase !== "Stopped" ||
          stoppedWorkload.Id !== workload.Id || stoppedWorkload.State.Running ||
          !resourceHostConfigMatches(stoppedWorkload, value.resourceLimits, value.document))
          throw new Error("sandbox_observation_unavailable");
      } else if (detail.phase !== "Stopped" || workload.State.Running) {
        throw new Error("sandbox_observation_unavailable");
      }
    } else if (detail.phase !== "Ready" || !workload.State.Running) {
      throw new Error("sandbox_observation_unavailable");
    }
    // Live observations may pin the Docker engine by replacing the scope row
    // in the journal. Refresh the reference before recording the immutable
    // creation receipt so the final ready/stopped state is not written to a
    // stale object.
    entry = journal.scopes[scope.bindingId];
    if (!entry || entry.sandboxId !== detail.id ||
      entry.provisioning?.requestId !== requestId ||
      entry.provisioning?.provisioningHash !== provisioningHash)
      throw new Error("sandbox_scope_changed");
    entry.containerId = workload.Id;
    entry.creation = creationRecord(value, request.imageDigest, requestId, provisioningHash, detail.id, workload.Id,
      workload.Config?.WorkingDir);
    entry.creation.observedPolicyHash = currentPolicy.hash;
    entry.creation.policyVersion = currentPolicy.version;
    entry.creation.configRevision = currentPolicy.config_revision;
    entry.provisioning = { ...entry.provisioning,
      state: value.purpose === "qualification" ? "ready" : "stopped",
      containerId: workload.Id, observedPolicyHash: currentPolicy.hash,
      policyVersion: currentPolicy.version, configRevision: currentPolicy.config_revision };
    if (entry.transition?.requestId === requestId) entry.transition = null;
    await atomicJson(journalFile, journal);
    return preparedReply(request, entry, provisioningHash, value);
  }
  async function executeAction(request, deadlineAt, commandId) {
    const scope = request.scope;
    const pendingSessionErasure = Object.values(journal.modelBrokerSessions ?? {}).some(session => session?.binding?.bindingId === scope.bindingId &&
      session.erasure && session.erasure.phase !== "verified");
    if (pendingSessionErasure && request.action !== "erase_native_session")
      throw new Error("sandbox_observation_unavailable");
    const sourceExpiry = request.action === "apply"
      ? request.admission?.expiresAt
      : request.action === "start"
        ? request.start?.expiresAt
        : null;
    if (sourceExpiry !== null && sourceExpiry !== undefined &&
      (!Number.isFinite(Date.parse(sourceExpiry)) ||
        Date.parse(sourceExpiry) <= Date.now() ||
        Date.parse(deadlineAt) > Date.parse(sourceExpiry))) {
      throw new Error("sandbox_scope_changed");
    }
    // Capabilities come from live CLI, gateway, policy and container
    // observations. Probes execute inside that observed sandbox; unavailable
    // runtimes never inherit a fixture or request-body success.
    if (!config && request.action === "capabilities") return { action: "capabilities", capabilities: null };
    if (!config && request.action === "probe") return { action: "probe", verdict: "unsupported", observationHash: null, contractHash: request.probe.contractHash };
    if (!config) throw new Error("sandbox_host_unavailable");
    const version = await cli(["--version"], deadlineAt, false);
    if (version.trim() !== "openshell 0.1.2") throw new Error("sandbox_host_unavailable");
    if (request.action === "capabilities") {
      try { return { action: "capabilities", capabilities: await hostCapabilities(request, scope, deadlineAt) }; }
      catch { return { action: "capabilities", capabilities: null }; }
    }
    if (request.action === "probe") return probeBoundary(request, deadlineAt, commandId);
    if (request.action === "prepare" && request.provisioning)
      return prepareProvisionedSandbox(request, deadlineAt);
    const detail = await observed(scope, deadlineAt, request.expectedTarget);
    if (request.action === "erase_native_session") {
      if ((activeExecBindings.get(scope.bindingId) ?? 0) !== 0 || erasureBindings.has(scope.bindingId))
        throw new Error("sandbox_observation_unavailable");
      erasureBindings.add(scope.bindingId);
      try { return await eraseStoppedNativeSession(request, detail, deadlineAt, commandId); }
      finally { erasureBindings.delete(scope.bindingId); }
    }
    if (request.action === "inspect") {
      try {
        const workload = await container(scope, detail, request.imageDigest, deadlineAt);
        if (request.expectedTarget &&
          (detail.id !== request.expectedTarget.sandboxId || workload.Id !== request.expectedTarget.containerId))
          throw new Error("sandbox_scope_changed");
        let policyHash = null;
        const pinnedPolicy = journal.scopes[scope.bindingId]?.policy;
        if (pinnedPolicy) {
          const currentPolicy = await policy(scope, deadlineAt);
          if (samePolicyRevision(currentPolicy, pinnedPolicy) &&
            await dockerDiskQuotaBackendSupported(deadlineAt) &&
            resourceHostConfigMatches(workload, pinnedPolicy.resourceLimits, pinnedPolicy.document))
            policyHash = pinnedPolicy.policyHash;
        }
        const state = detail.phase === "Error" ? "failed" :
          detail.phase === "Stopped" && !workload.State.Running ? "stopped" :
          detail.phase === "Ready" && workload.State.Running ? "running" : "unknown";
        let controlsHealthy = false;
        if (state !== "unknown" && state !== "failed") {
          try {
            controlsHealthy = await currentControlHealth(request, deadlineAt);
            if (!controlsHealthy && globalThis.process?.env?.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1")
              globalThis.process.stderr.write(`${JSON.stringify({ event: "openshell_current_control_health_false_without_exception" })}\n`);
          } catch (error) {
            const rawCode = error && typeof error === "object" && "message" in error ? error.message : null;
            const reasonCode = ["sandbox_scope_changed", "sandbox_observation_unavailable", "sandbox_operation_unsupported",
              "sandbox_host_unavailable", "exec_timeout"].includes(rawCode) ? rawCode : "unclassified_exception";
            const stack = error && typeof error === "object" && "stack" in error && typeof error.stack === "string"
              ? error.stack.split("\n") : [];
            const sourceFrames = stack.flatMap(line => {
              const match = line.match(/^\s*at\s+(?:(.*?)\s+\()?((?:file:\/\/\/)?[^()]*\/openshell\.mjs):(\d+):(\d+)\)?\s*$/);
              return match ? [{ functionName: (match[1] || "anonymous").slice(0, 100), sourceFile: "openshell.mjs", line: Number(match[3]) }] : [];
            }).slice(0, 8);
            if (globalThis.process?.env?.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1")
              globalThis.process.stderr.write(`${JSON.stringify({ event: "openshell_current_control_health_exception", reasonCode, sourceFrames })}\n`);
          }
        }
        return {
          action: "inspect",
          state,
          ...(request.expectedTarget ? { sandboxId: detail.id, containerId: workload.Id } : {}),
          policyHash,
          imageDigest: request.imageDigest,
          generation: scope.cellGeneration,
          controlsHealthy,
        };
      } catch (error) {
        if (request.expectedTarget) throw error;
        return {
          action: "inspect",
          state: "unknown",
          policyHash: null,
          imageDigest: null,
          generation: scope.cellGeneration,
          controlsHealthy: false,
        };
      }
    }
    if (request.action === "prepare") {
      // Preparation is verification of a controller-pinned, pre-provisioned
      // sandbox. OpenShell v0.1.2's `sandbox get` does not expose the image,
      // so bind this receipt to the actual Docker daemon/container observation
      // rather than echoing the requested image digest. This action never
      // creates or adopts a sandbox and cannot qualify the physical controls.
      if (detail.phase !== "Stopped")
        throw new Error("sandbox_operation_unsupported");
      const workload = await container(scope, detail, request.imageDigest, deadlineAt);
      if (workload.State.Running)
        throw new Error("sandbox_operation_unsupported");
      return {
        action: "prepare",
        backendVersion: "0.1.2",
        imageDigest: request.imageDigest,
      };
    }
    if (request.action === "effective_policy") {
      const current = await policy(scope, deadlineAt);
      return { action: "effective_policy", document: current.policy };
    }
    if (request.action === "apply") {
      const admission = request.admission;
      if (!admission || Date.parse(admission.expiresAt) <= Date.now()) throw new Error("sandbox_scope_changed");
      const workload = await container(scope, detail, request.imageDigest, deadlineAt);
      if (detail.phase !== "Stopped" || workload.State.Running)
        throw new Error("sandbox_operation_unsupported");
      if (!validResourceLimits(admission.resourceLimits)) throw new Error("sandbox_scope_changed");
      if (admission.credentialProviderProfile) await inspectCredentialProviderProfile(admission.credentialProviderProfile, deadlineAt);
      await revokeProviders(scope, deadlineAt);
      const before = await policy(scope, deadlineAt);
      if (!staticPolicyMatches(before.policy, admission.document))
        return {
          action: "apply",
          applied: false,
          policyHash: null,
          requiresRecreate: true,
          effectivePolicyHash: before.hash,
        };
      if (!(await dockerDiskQuotaBackendSupported(deadlineAt)) ||
        !dockerDiskStorageOptionMatches(workload, admission.resourceLimits) ||
        !dockerPersistentLogsDisabled(workload) ||
        !(await dockerSupervisorLogsDisabled(scope, detail, deadlineAt)))
        return {
          action: "apply",
          applied: false,
          policyHash: null,
          requiresRecreate: true,
          effectivePolicyHash: before.hash,
        };
      if (!dockerDiskMountsMatch(workload, admission.document))
        throw new Error("sandbox_operation_unsupported");
      const boundedWorkload = await applyDockerResourceLimits(scope, detail, request.imageDigest,
        admission.resourceLimits, deadlineAt, workload.Id, admission.document);
      if (!resourceHostConfigMatches(boundedWorkload, admission.resourceLimits, admission.document))
        throw new Error("sandbox_observation_unavailable");
      const privateConfig = await privateConfiguration();
      const filename = path.join(privateConfig.stateHome, `policy-${randomUUID()}.json`);
      try {
        await writeFile(filename, JSON.stringify(admission.document), {
          flag: "wx",
          mode: 0o600,
        });
        const remaining = Math.floor(
          (new Date(deadlineAt).getTime() - Date.now()) / 1000,
        );
        if (remaining < 1) throw new Error("sandbox_host_unavailable");
        await cli(
          [
            "policy",
            "set",
            scope.sandboxRef,
            "--policy",
            filename,
            "--wait",
            "--timeout",
            String(Math.min(6, remaining)),
            "--expected-sandbox-id",
            detail.id,
          ],
          deadlineAt,
          false,
        );
      } catch (error) {
        let committed = false;
        try {
          committed = sameDocument(
            (await policy(scope, deadlineAt)).policy,
            admission.document,
          );
        } catch {}
        if (!committed) await contain(scope, request.imageDigest, deadlineAt);
        if (committed) {
          const observedPolicy = await policy(scope, deadlineAt);
          journal.scopes[scope.bindingId] = {
            ...journal.scopes[scope.bindingId],
            policy: {
              policyHash: admission.policyHash,
              effectivePolicyHash: observedPolicy.hash,
              policyVersion: observedPolicy.version,
              configRevision: observedPolicy.config_revision,
              document: observedPolicy.policy,
              resourceLimits: admission.resourceLimits,
              ...(admission.credentialProviderProfile ? { credentialProviderProfile: admission.credentialProviderProfile } : {}),
              appliedAt: new Date().toISOString(),
            },
          };
          await atomicJson(journalFile, journal);
          return {
            action: "apply",
            applied: true,
            policyHash: admission.policyHash,
            requiresRecreate: false,
            effectivePolicyHash: observedPolicy.hash,
          };
        }
        if ([
          "sandbox_host_unavailable",
          "sandbox_scope_changed",
          "sandbox_operation_unsupported",
          "sandbox_observation_unavailable",
        ].includes(error?.message)) throw error;
        throw new Error("sandbox_observation_unavailable");
      } finally {
        await unlink(filename).catch(() => {});
      }
      const after = await policy(scope, deadlineAt);
      if (!sameDocument(after.policy, admission.document)) {
        await contain(scope, request.imageDigest, deadlineAt);
        throw new Error("sandbox_observation_unavailable");
      }
      journal.scopes[scope.bindingId] = {
        ...journal.scopes[scope.bindingId],
        policy: {
          policyHash: admission.policyHash,
          effectivePolicyHash: after.hash,
          policyVersion: after.version,
          configRevision: after.config_revision,
          document: after.policy,
          resourceLimits: admission.resourceLimits,
          ...(admission.credentialProviderProfile ? { credentialProviderProfile: admission.credentialProviderProfile } : {}),
          appliedAt: new Date().toISOString(),
        },
      };
      await atomicJson(journalFile, journal);
      return {
        action: "apply",
        applied: true,
        policyHash: admission.policyHash,
        requiresRecreate: false,
        effectivePolicyHash: after.hash,
      };
    }
    if (request.action === "start") {
      const start = request.start;
      if (
        !start ||
        new Date(start.expiresAt) <= new Date() ||
        !/^[a-f0-9]{64}$/.test(start.policyHash)
      )
        throw new Error("sandbox_scope_changed");
      const pinnedPolicy = journal.scopes[scope.bindingId]?.policy;
      if (!pinnedPolicy || pinnedPolicy.policyHash !== start.policyHash)
        throw new Error("sandbox_scope_changed");
      await revokeProviders(scope, deadlineAt);
      const beforePolicy = await policy(scope, deadlineAt);
      if (!samePolicyRevision(beforePolicy, pinnedPolicy))
        throw new Error("sandbox_scope_changed");
      const beforeWorkload = await container(
        scope,
        detail,
        request.imageDigest,
        deadlineAt,
      );
      if (!(await dockerDiskQuotaBackendSupported(deadlineAt)))
        throw new Error("sandbox_operation_unsupported");
      if (detail.phase === "Ready" && beforeWorkload.State.Running) {
        if (!resourceHostConfigMatches(beforeWorkload, pinnedPolicy.resourceLimits, pinnedPolicy.document))
          throw new Error("sandbox_observation_unavailable");
        return {
          action: "start",
          started: true,
          operationId: hash(start.idempotencyKey),
          sandboxId: detail.id,
          containerId: beforeWorkload.Id,
          imageDigest: request.imageDigest,
          policyHash: start.policyHash,
          effectivePolicyHash: beforePolicy.hash,
        };
      }
      if (detail.phase !== "Stopped" || beforeWorkload.State.Running ||
        !resourceHostConfigMatches(beforeWorkload, pinnedPolicy.resourceLimits, pinnedPolicy.document))
        throw new Error("sandbox_operation_unsupported");
      try {
        await cli(["sandbox", "start", scope.sandboxRef, "--expected-sandbox-id", detail.id], deadlineAt, false);
      } catch {
        // A lost CLI response is resolved from independent gateway and Docker
        // observations below; it is never treated as success by itself.
      }
      const afterDetail = await observed(scope, deadlineAt);
      const afterPolicy = await policy(scope, deadlineAt);
      const afterWorkload = await container(
        scope,
        afterDetail,
        request.imageDigest,
        deadlineAt,
      );
      if (
        afterDetail.phase !== "Ready" ||
        !afterWorkload.State.Running ||
        !resourceHostConfigMatches(afterWorkload, pinnedPolicy.resourceLimits, pinnedPolicy.document) ||
        !(await dockerSupervisorLogsDisabled(scope, afterDetail, deadlineAt)) ||
        !samePolicyRevision(afterPolicy, pinnedPolicy)
      ) {
        await contain(scope, request.imageDigest, deadlineAt);
        throw new Error("sandbox_observation_unavailable");
      }
      return {
        action: "start",
        started: true,
        operationId: hash(start.idempotencyKey),
        sandboxId: afterDetail.id,
        containerId: afterWorkload.Id,
        imageDigest: request.imageDigest,
        policyHash: start.policyHash,
        effectivePolicyHash: afterPolicy.hash,
      };
    }
    if (request.action === "stop") {
      let targetContainerId;
      if (request.expectedTarget) {
        const workload = await container(scope, detail, request.imageDigest, deadlineAt);
        if (detail.id !== request.expectedTarget.sandboxId || workload.Id !== request.expectedTarget.containerId)
          throw new Error("sandbox_scope_changed");
        targetContainerId = workload.Id;
      }
      await cli(["sandbox", "stop", scope.sandboxRef, "--expected-sandbox-id", detail.id], deadlineAt, false);
      const stopped = await observed(scope, deadlineAt, request.expectedTarget);
      if (stopped.phase !== "Stopped")
        throw new Error("sandbox_observation_unavailable");
      if (request.expectedTarget) {
        const workload = await container(scope, stopped, request.imageDigest, deadlineAt);
        if (stopped.id !== request.expectedTarget.sandboxId || workload.Id !== targetContainerId ||
          workload.Id !== request.expectedTarget.containerId)
          throw new Error("sandbox_scope_changed");
        return { action: "stop", stopped: true, sandboxId: stopped.id, containerId: workload.Id };
      }
      return { action: "stop", stopped: true };
    }
    if (request.action === "destroy") {
      await cli(["sandbox", "delete", scope.sandboxRef, "--expected-sandbox-id", detail.id], deadlineAt, false);
      const remaining = await cli(
        [
          "sandbox",
          "list",
          "--selector",
          `aw.binding_id=${scope.bindingId}`,
          "--page-size",
          "10",
          "--output",
          "json",
        ],
        deadlineAt,
      );
      if (
        !Array.isArray(remaining.sandboxes) ||
        remaining.sandboxes.length > 10 ||
        remaining.next_page_token !== "" ||
        remaining.sandboxes.some((value) =>
          value.name === scope.sandboxRef || value.id === detail.id,
        )
      )
        throw new Error("sandbox_observation_unavailable");
      delete journal.scopes[scope.bindingId];
      await atomicJson(journalFile, journal);
      return { action: "destroy", destroyed: true };
    }
    if (request.action === "revoke_providers") {
      const providers = await cli(
        [
          "sandbox",
          "provider",
          "list",
          scope.sandboxRef,
          "--page-size",
          "4",
          "--output",
          "json",
        ],
        deadlineAt,
      );
      if (
        !Array.isArray(providers.providers) ||
        providers.providers.length > 4 ||
        providers.next_page_token !== ""
      )
        throw new Error("sandbox_operation_unsupported");
      for (const provider of providers.providers) {
        const target = await observed(scope, deadlineAt);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(provider.name))
          throw new Error("sandbox_observation_unavailable");
        await cli(
          [
            "sandbox",
            "provider",
            "detach",
            scope.sandboxRef,
            provider.name,
            "--expected-sandbox-id",
            target.id,
            "--wait",
            "--timeout",
            "2",
            "--output",
            "json",
          ],
          deadlineAt,
        );
      }
      const after = await cli(
        [
          "sandbox",
          "provider",
          "list",
          scope.sandboxRef,
          "--page-size",
          "4",
          "--output",
          "json",
        ],
        deadlineAt,
      );
      if (
        !Array.isArray(after.providers) ||
        after.providers.length ||
        after.next_page_token !== ""
      )
        throw new Error("sandbox_observation_unavailable");
      await observed(scope, deadlineAt);
      // The command-level provider sweep also retires the session journal
      // tombstones. Otherwise an interrupted credential update can leave an
      // `updating` session that appears live after its attached provider was
      // removed.
      await deleteQuiescedBrokerProviders(scope, deadlineAt, true);
      return { action: "revoke_providers", revoked: true };
    }
    // CLI sandbox detail does not expose an observed immutable image digest.
    // Configured image/labels therefore cannot earn a preparation receipt.
    throw new Error("sandbox_operation_unsupported");
  }
  async function executeStreamInternal(input, onOutput, signal) {
    const request = input?.request;
    const requestKeys = ["requestId", "bindingId", "hostEpoch", "runId", "attemptId", "attempt", "manifestId", "manifestHash", "policySnapshotId", "policyHash", "commandDigest", "deadlineAt", "sandboxRef", "imageDigest", "argv", "cwd", "env", "stdinBase64"];
    const requestVariants = [];
    for (const broker of [false, true]) for (const model of [false, true]) for (const session of [false, true])
      requestVariants.push([...requestKeys, ...(broker ? ["brokerCredential"] : []), ...(model ? ["modelBrokerCredential"] : []),
        ...(session ? ["modelBrokerSession"] : [])]);
    if (!input || !validScope(input.scope) || !request ||
      !requestVariants.some(keys => Object.keys(request).sort().join(",") === keys.slice().sort().join(",")) ||
      !uuid.test(request.requestId) || request.bindingId !== input.scope.bindingId ||
      request.hostEpoch !== epoch || !uuid.test(request.runId) ||
      (request.attemptId !== null && !uuid.test(request.attemptId)) ||
      !Number.isSafeInteger(request.attempt) || request.attempt < 1 ||
      !uuid.test(request.manifestId) || !/^[a-f0-9]{64}$/.test(request.manifestHash) ||
      !uuid.test(request.policySnapshotId) || !/^[a-f0-9]{64}$/.test(request.policyHash) ||
      !/^[a-f0-9]{64}$/.test(request.commandDigest) ||
      request.sandboxRef !== input.scope.sandboxRef ||
      !/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/i.test(request.imageDigest) ||
      !Array.isArray(request.argv) || request.argv.length < 1 || request.argv.length > 64 ||
      request.argv.some(value => typeof value !== "string" || !value.length || value.length > 8192) ||
      typeof request.cwd !== "string" || !path.isAbsolute(request.cwd) ||
      !request.env || typeof request.env !== "object" || Array.isArray(request.env) || Object.keys(request.env).length > 64 ||
      Object.entries(request.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof value !== "string" || value.length > 8192 ||
        (/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY|AUTHORIZATION)/i.test(key) &&
          !(request.modelBrokerCredential && (
            (key === "PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND" && value === String(request.modelBrokerCredential.inputTokensUpperBound)) ||
            (key === "PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS" && value === String(request.modelBrokerCredential.maxOutputTokens))
          )))) ||
      (request.brokerCredential !== undefined && (!request.brokerCredential || typeof request.brokerCredential.capabilityToken !== "string" || request.brokerCredential.capabilityToken.length > 16_384 ||
        typeof request.brokerCredential.profileId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(request.brokerCredential.profileId) ||
        typeof request.brokerCredential.profileHash !== "string" || !/^[a-f0-9]{64}$/.test(request.brokerCredential.profileHash) ||
        typeof request.brokerCredential.expiresAt !== "string" || !Number.isFinite(Date.parse(request.brokerCredential.expiresAt)))) ||
      (!!request.brokerCredential !== (typeof request.env.PAPERCLIP_SANDBOX_BROKER_ENDPOINT_ORIGIN === "string" && typeof request.env.PAPERCLIP_SANDBOX_BROKER_SESSION_ID === "string")) ||
      (request.modelBrokerCredential !== undefined && (!request.modelBrokerCredential || typeof request.modelBrokerCredential.capabilityToken !== "string" || request.modelBrokerCredential.capabilityToken.length > 16_384 ||
        typeof request.modelBrokerCredential.profileId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(request.modelBrokerCredential.profileId) ||
        typeof request.modelBrokerCredential.profileHash !== "string" || !/^[a-f0-9]{64}$/.test(request.modelBrokerCredential.profileHash) ||
        typeof request.modelBrokerCredential.expiresAt !== "string" || !Number.isFinite(Date.parse(request.modelBrokerCredential.expiresAt)) ||
        !Number.isSafeInteger(request.modelBrokerCredential.inputTokensUpperBound) || request.modelBrokerCredential.inputTokensUpperBound < 1 || request.modelBrokerCredential.inputTokensUpperBound > 2_000_000 ||
        !Number.isSafeInteger(request.modelBrokerCredential.maxOutputTokens) || request.modelBrokerCredential.maxOutputTokens < 256 || request.modelBrokerCredential.maxOutputTokens > 8192)) ||
      (!!request.modelBrokerCredential !== (typeof request.env.PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN === "string")) ||
      (request.modelBrokerCredential && (request.env.PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND !== String(request.modelBrokerCredential.inputTokensUpperBound) ||
        request.env.PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS !== String(request.modelBrokerCredential.maxOutputTokens))) ||
      (request.modelBrokerSession !== undefined && (!request.modelBrokerSession ||
        ![
          "leaseId,nativeSessionIdDigest,phase,runnerInstanceId,sessionDeadlineAt,sessionKey",
          "leaseId,nativeSessionIdDigest,phase,runnerInstanceId,sessionDeadlineAt,sessionKey,startBindingDigest",
          "expectedCapabilityHash,leaseId,nativeSessionIdDigest,phase,runnerInstanceId,sessionDeadlineAt,sessionKey",
        ].includes(Object.keys(request.modelBrokerSession).sort().join(",")) ||
        (request.modelBrokerSession.phase !== "start" && request.modelBrokerSession.startBindingDigest !== undefined) ||
        (request.modelBrokerSession.startBindingDigest !== undefined && !/^[a-f0-9]{64}$/.test(request.modelBrokerSession.startBindingDigest)) ||
        !["start", "refresh", "stop"].includes(request.modelBrokerSession.phase))) ||
      typeof request.stdinBase64 !== "string" || request.stdinBase64.length > 512 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.stdinBase64) ||
      typeof input.capabilityToken !== "string" || input.capabilityToken.length > 16384 ||
      typeof onOutput !== "function") throw new Error("sandbox_scope_changed");
    const deadlineAt = request.deadlineAt;
    if (!Number.isFinite(Date.parse(deadlineAt)) || Date.parse(deadlineAt) <= Date.now()) throw new Error("sandbox_host_unavailable");
    const commandDigest = hash(JSON.stringify(canonical({ argv: request.argv, cwd: request.cwd, env: request.env,
      stdinHash: hash(Buffer.from(request.stdinBase64, "base64")), timeoutDeadline: deadlineAt,
      brokerCapabilityHash: request.brokerCredential ? hash(request.brokerCredential.capabilityToken) : null,
      brokerProviderProfile: request.brokerCredential ? { id: request.brokerCredential.profileId, hash: request.brokerCredential.profileHash } : null,
      modelBrokerCapabilityHash: request.modelBrokerCredential ? hash(request.modelBrokerCredential.capabilityToken) : null,
      modelBrokerProviderProfile: request.modelBrokerCredential ? { id: request.modelBrokerCredential.profileId, hash: request.modelBrokerCredential.profileHash } : null,
      modelBrokerSession: request.modelBrokerSession ?? null,
    })));
    if (commandDigest !== request.commandDigest) throw new Error("sandbox_scope_changed");
    const detail = await observed(input.scope, deadlineAt);
    const pinnedPolicy = journal.scopes[input.scope.bindingId]?.policy;
    const effectivePolicy = await policy(input.scope, deadlineAt);
    const workload = await container(input.scope, detail, request.imageDigest, deadlineAt);
    if (!pinnedPolicy || pinnedPolicy.policyHash !== request.policyHash || !samePolicyRevision(effectivePolicy, pinnedPolicy) ||
      detail.phase !== "Ready" || !workload.State.Running) throw new Error("sandbox_operation_unsupported");
    if (signal?.aborted) throw new Error("exec_unknown");
    if (Date.parse(deadlineAt) <= Date.now()) throw new Error("exec_timeout");

    const requestHash = hash(JSON.stringify(canonical({ request: { ...request, stdinBase64: undefined }, stdinHash: hash(Buffer.from(request.stdinBase64, "base64")), scope: input.scope })));
    const privateConfig = await privateConfiguration();
    if (signal?.aborted) throw new Error("exec_unknown");
    if (Date.parse(deadlineAt) <= Date.now()) throw new Error("exec_timeout");
    await serial(async () => {
      const existing = journal.commands[request.requestId];
      if (existing) {
        if (existing.requestHash !== requestHash) throw new Error("sandbox_scope_changed");
        throw new Error("exec_unknown");
      }
      if (Object.keys(journal.commands).length >= 10256) throw new Error("sandbox_host_unavailable");
      journal.commands[request.requestId] = { requestHash, result: null, kind: "exec", state: "claimed",
        ...(request.brokerCredential ? { brokerProvider: {
          name: `awbr-${request.requestId.replaceAll("-", "")}`,
          expiresAt: request.brokerCredential.expiresAt,
          scope: input.scope,
        } } : {}),
        ...(request.modelBrokerCredential ? { modelBrokerProvider: {
          name: `awmb-${request.requestId.replaceAll("-", "")}`,
          expiresAt: request.modelBrokerCredential.expiresAt,
          scope: input.scope,
        } } : {}),
      };
      await atomicJson(journalFile, journal);
    });
    if (signal?.aborted) throw new Error("exec_unknown");
    if (Date.parse(deadlineAt) <= Date.now()) throw new Error("exec_timeout");
    const brokerProviderName = request.brokerCredential ? `awbr-${request.requestId.replaceAll("-", "")}` : null;
    const modelBrokerProviderName = request.modelBrokerCredential && !request.modelBrokerSession
      ? `awmb-${request.requestId.replaceAll("-", "")}` : null;
    if (brokerProviderName) await attachBrokerProvider(request, input.scope, deadlineAt, brokerProviderName);
    if (modelBrokerProviderName) await attachModelBrokerProvider(request, input.scope, deadlineAt, modelBrokerProviderName);
    const modelBrokerSessionReceipt = request.modelBrokerSession
      ? await modelBrokerSessionTransition(request, input.scope, deadlineAt, signal) : undefined;
    const cliArgs = ["--gateway", config.gateway, "--workspace", config.workspace, "sandbox", "exec", "--name", input.scope.sandboxRef,
      "--expected-sandbox-id", detail.id, "--workdir", request.cwd];
    for (const key of Object.keys(request.env).sort()) cliArgs.push("--env", `${key}=${request.env[key]}`);
    cliArgs.push("--", ...request.argv);
    const remaining = Math.max(1, Math.min(60_000, Date.parse(deadlineAt) - Date.now()));
    if (signal?.aborted) throw new Error("exec_unknown");
    if (Date.parse(deadlineAt) <= Date.now()) throw new Error("exec_timeout");
    const child = spawnProcess(privateConfig.executable, cliArgs, {
      cwd: privateConfig.stateHome,
      env: privateConfig.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    let timedOut = false, outputBytes = 0, settled = false;
    const terminate = () => { if (!settled) child.kill("SIGKILL"); };
    const onAbort = () => terminate();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; terminate(); }, remaining);
    timeout.unref?.();
    const forward = async (stream, source) => {
      for await (const chunk of source) {
        outputBytes += chunk.length;
        if (outputBytes > 64 * 1024 * 1024) { terminate(); throw new Error("exec_rejected"); }
        await onOutput(stream, Buffer.from(chunk));
      }
    };
    const readOutput = Promise.all([forward("stdout", child.stdout), forward("stderr", child.stderr)]);
    child.stdin.end(Buffer.from(request.stdinBase64, "base64"));
    let exitCode;
    try {
      const exited = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signalName) => resolve({ code, signalName }));
      });
      const result = await exited;
      await readOutput;
      settled = true;
      exitCode = Number.isInteger(result.code) ? result.code : (timedOut ? 124 : 1);
    } catch (error) {
      terminate();
      await Promise.allSettled([readOutput]);
      throw error;
    } finally {
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
    if (timedOut) throw new Error("exec_unknown");
    if (brokerProviderName) await detachAndDeleteBrokerProvider(input.scope, deadlineAt, brokerProviderName);
    if (modelBrokerProviderName) await detachAndDeleteBrokerProvider(input.scope, deadlineAt, modelBrokerProviderName);
    await serial(async () => {
      journal.commands[request.requestId] = { requestHash, result: { exitCode, timedOut }, kind: "exec", state: "completed",
        ...(modelBrokerSessionReceipt ? { modelBrokerSessionReceipt } : {}) };
      await atomicJson(journalFile, journal);
    });
    return { exitCode, timedOut, ...(modelBrokerSessionReceipt ? { modelBrokerSessionReceipt } : {}) };
  }
  async function executeStream(input, onOutput, signal) {
    const bindingId = input?.scope?.bindingId;
    if (typeof bindingId !== "string" || erasureBindings.has(bindingId) ||
      Object.values(journal.modelBrokerSessions ?? {}).some(session => session?.binding?.bindingId === bindingId &&
        session.erasure && session.erasure.phase !== "verified")) throw new Error("exec_unknown");
    activeExecBindings.set(bindingId, (activeExecBindings.get(bindingId) ?? 0) + 1);
    try {
      try { return await executeStreamInternal(input, onOutput, signal); }
      catch (error) {
        const requestDeadlineAt = input?.request?.deadlineAt;
        const requestDeadline = typeof requestDeadlineAt === "string" ? Date.parse(requestDeadlineAt) : Number.NaN;
        const reasonCode = error && typeof error === "object" && "message" in error ? error.message : null;
        if (!signal?.aborted && reasonCode === "sandbox_host_unavailable" && Number.isFinite(requestDeadline) &&
          requestDeadline <= Date.now()) throw new Error("exec_timeout");
        throw error;
      }
    } finally {
      const remaining = (activeExecBindings.get(bindingId) ?? 1) - 1;
      if (remaining > 0) activeExecBindings.set(bindingId, remaining);
      else activeExecBindings.delete(bindingId);
    }
  }
  return {
    async initialize() {
      try {
        journal = JSON.parse(await readFile(journalFile, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new Error("sandbox_host_unavailable");
      }
      if (journal.version === 1 && journal.scopes && !Array.isArray(journal.scopes)) {
        // Old observations never recorded an immutable gateway ID. Keep them
        // fenced instead of silently adopting whichever instance now owns a name.
        journal = {
          ...journal,
          version: 2,
          scopes: Object.fromEntries(Object.entries(journal.scopes).map(
            ([id, scope]) => [id, { scope, sandboxId: null }],
          )),
        };
      }
      if (journal.version === 2 && journal.modelBrokerSessions === undefined) journal.modelBrokerSessions = {};
      if (
        journal.version !== 2 ||
        !journal.scopes ||
        !journal.commands ||
        !journal.modelBrokerSessions ||
        Array.isArray(journal.scopes) ||
        Array.isArray(journal.commands) ||
        Array.isArray(journal.modelBrokerSessions) ||
        Object.keys(journal.scopes).length > 256 ||
        Object.entries(journal.scopes).some(([id, v]) =>
          !v || !validScope(v.scope) || id !== v.scope.bindingId ||
          (v.sandboxId !== null && !uuid.test(v.sandboxId ?? "")),
        ) ||
        Object.keys(journal.commands).length > 10256 || Object.keys(journal.modelBrokerSessions).length > 1024
      )
        throw new Error("sandbox_host_unavailable");
    },
    execute(id, request, deadlineAt) {
      return serial(async () => {
        if (
          !uuid.test(id) ||
          !validScope(request?.scope) ||
          request.version !== 1 ||
          request.hostEpoch !== epoch ||
          !actions.has(request.action) ||
          !/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(
            request.imageDigest ?? "",
          ) ||
          (!request.cleanupAttestation && request.action !== "erase_native_session" && (typeof request.requesterUserId !== "string" ||
            request.requesterUserId.length < 1 || request.requesterUserId.length > 200)) ||
          !Number.isFinite(new Date(deadlineAt).getTime()) ||
          new Date(deadlineAt) <= new Date()
        )
          throw new Error("sandbox_scope_changed");
        if (
          (request.action === "probe") !== Boolean(request.probe) ||
          (request.action === "apply") !== Boolean(request.admission) ||
          (request.action === "start") !== Boolean(request.start) ||
          (request.action === "erase_native_session") !== Boolean(request.nativeSessionErasure) ||
          (request.action === "erase_native_session" && (request.cleanupAttestation !== undefined ||
            request.expectedTarget !== undefined || request.probe !== undefined || request.admission !== undefined ||
            request.start !== undefined || request.provisioning !== undefined || request.requesterUserId !== undefined ||
            Object.keys(request.nativeSessionErasure ?? {}).sort().join(",") !==
              "cellGeneration,containerId,dockerEngineIdHash,imageDigest,leaseId,policyHash,runId,runnerInstanceId,sandboxId,schema,sessionDigest,sessionKey,startBindingDigest,taskRoot" ||
            request.nativeSessionErasure.schema !== "paperclip.remote-native-session-erasure.v1" ||
            typeof request.nativeSessionErasure.taskRoot !== "string" || !path.posix.isAbsolute(request.nativeSessionErasure.taskRoot) ||
            path.posix.normalize(request.nativeSessionErasure.taskRoot) !== request.nativeSessionErasure.taskRoot)) ||
          (request.provisioning !== undefined && request.action !== "prepare") ||
          (request.action === "prepare" && request.provisioning !== undefined && !request.provisioning) ||
          (request.expectedTarget !== undefined && (!request.expectedTarget ||
            !["stop", "inspect"].includes(request.action) ||
            Object.keys(request.expectedTarget).sort().join(",") !== "containerId,sandboxId" ||
            !uuid.test(request.expectedTarget.sandboxId ?? "") ||
            !/^[a-f0-9]{64}$/.test(request.expectedTarget.containerId ?? ""))) ||
          (Boolean(request.cleanupAttestation) &&
            (!['capabilities', 'probe'].includes(request.action) ||
              request.requesterUserId !== undefined ||
              request.probe?.qualificationCredentialCapability !== undefined ||
              request.probe?.qualificationCommandId !== undefined || request.probe?.qualificationCredentialNonce !== undefined ||
              (request.action === "probe" && (!probeContracts[request.probe?.caseId] ||
                ["credentialBrokering","networkDestinationPolicy","networkLayer7Policy"].includes(probeContracts[request.probe.caseId][0]))) ||
              Object.keys(request.cleanupAttestation).length !== 11 ||
              Object.keys(request.cleanupAttestation).some(key => ![
                "version", "purpose", "executionProfile", "executionProfileHash", "jobId", "jobKey", "attemptNumber", "executionOwnerId",
                "locatorDigest", "companyPurgeOperationId", "startBindingDigest",
              ].includes(key)) ||
              request.cleanupAttestation.version !== 2 ||
              request.cleanupAttestation.purpose !== "native_runtime_asset_erasure" ||
              request.cleanupAttestation.executionProfile !== "fixed_local_eraser_v1" ||
              !/^[a-f0-9]{64}$/.test(request.cleanupAttestation.executionProfileHash ?? "") ||
              !uuid.test(request.cleanupAttestation.jobId ?? "") ||
              typeof request.cleanupAttestation.jobKey !== "string" ||
              request.cleanupAttestation.jobKey.length < 1 || request.cleanupAttestation.jobKey.length > 300 ||
              !Number.isSafeInteger(request.cleanupAttestation.attemptNumber) ||
              request.cleanupAttestation.attemptNumber < 1 ||
              typeof request.cleanupAttestation.executionOwnerId !== "string" ||
              request.cleanupAttestation.executionOwnerId.length < 1 ||
              request.cleanupAttestation.executionOwnerId.length > 300 ||
              !/^[a-f0-9]{64}$/.test(request.cleanupAttestation.locatorDigest ?? "") ||
              !(request.cleanupAttestation.companyPurgeOperationId === null ||
                uuid.test(request.cleanupAttestation.companyPurgeOperationId ?? "")) ||
              !/^[a-f0-9]{64}$/.test(request.cleanupAttestation.startBindingDigest ?? ""))) ||
          Object.keys(request).some(
            (key) =>
              ![
                "version",
                "scope",
                "action",
                "hostEpoch",
                "imageDigest",
                "requesterUserId",
                "probe",
                "admission",
                "start",
                "provisioning",
                "cleanupAttestation",
                "expectedTarget",
                "nativeSessionErasure",
                "claimToken",
              ].includes(key),
          )
        )
          throw new Error("sandbox_scope_changed");
        const { claimToken: _, ...immutable } = request;
        const requestHash = hash(JSON.stringify(immutable));
        const existing = journal.commands[id];
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new Error("sandbox_scope_changed");
          if (request.action === "erase_native_session") {
            const originalDeadline = Date.parse(existing.operationDeadlineAt ?? "");
            if (!Number.isFinite(originalDeadline)) throw new Error("sandbox_scope_changed");
            deadlineAt = new Date(Math.min(originalDeadline, Date.parse(deadlineAt))).toISOString();
            if (originalDeadline <= Date.now()) {
              if (existing.result?.success === true) return existing.result;
              let reconciled;
              try { reconciled = await reconcileExpiredNativeErasure(request, id, existing.operationDeadlineAt); }
              catch (error) {
                reconciled = { success: false, reply: null, errorCode: ["sandbox_scope_changed",
                  "sandbox_operation_unsupported", "sandbox_observation_unavailable", "sandbox_host_unavailable"]
                  .includes(error?.message) ? error.message : "sandbox_observation_unavailable" };
              }
              journal.commands[id] = { ...existing, result: reconciled };
              await atomicJson(journalFile, journal);
              return reconciled;
            }
          }
          // Generic claimed operations stay ambiguous. The fixed Native erase
          // action is the sole exception: it reconciles its durable helper ID
          // and never launches a second helper after a start may have landed.
          if (request.action === "erase_native_session" && existing.result === null) {
            let resumed;
            try {
              resumed = { success: true, reply: await executeAction(request, deadlineAt, id), errorCode: null };
            } catch (error) {
              resumed = { success: false, reply: null, errorCode: ["sandbox_host_unavailable", "sandbox_scope_changed",
                "sandbox_operation_unsupported", "sandbox_observation_unavailable"].includes(error?.message)
                ? error.message : "sandbox_host_unavailable" };
            }
            journal.commands[id] = { ...existing, requestHash, result: resumed };
            await atomicJson(journalFile, journal);
            return resumed;
          }
          if (request.action === "erase_native_session" && existing.result?.success === false &&
            ["sandbox_observation_unavailable", "sandbox_host_unavailable"].includes(existing.result.errorCode)) {
            let resumed;
            try { resumed = { success: true, reply: await executeAction(request, deadlineAt, id), errorCode: null }; }
            catch (error) {
              resumed = { success: false, reply: null, errorCode: ["sandbox_host_unavailable", "sandbox_scope_changed",
                "sandbox_operation_unsupported", "sandbox_observation_unavailable"].includes(error?.message)
                ? error.message : "sandbox_host_unavailable" };
            }
            journal.commands[id] = { ...existing, requestHash, result: resumed };
            await atomicJson(journalFile, journal);
            return resumed;
          }
          return existing.result ?? {
            success: false,
            reply: null,
            errorCode: "sandbox_observation_unavailable",
          };
        }
        if (
          Object.keys(journal.commands).length >=
          (["stop", "destroy", "revoke_providers", "erase_native_session"].includes(request.action)
            ? 10256
            : 10000)
        )
          throw new Error("sandbox_host_unavailable");
        journal.commands[id] = { requestHash, result: null,
          ...(request.action === "erase_native_session" ? { operationDeadlineAt: deadlineAt } : {}) };
        await atomicJson(journalFile, journal);
        let result;
        try {
          result = {
            success: true,
            reply: await executeAction(request, deadlineAt, id),
            errorCode: null,
          };
        } catch (error) {
          result = {
            success: false,
            reply: null,
            errorCode: [
              "sandbox_host_unavailable",
              "sandbox_scope_changed",
              "sandbox_operation_unsupported",
              "sandbox_observation_unavailable",
            ].includes(error.message)
              ? error.message
              : "sandbox_host_unavailable",
          };
        }
        journal.commands[id] = { ...journal.commands[id], requestHash, result };
        await atomicJson(journalFile, journal);
        return result;
      });
    },
    executeStream,
    acknowledge(id) {
      return serial(async () => {
        delete journal.commands[id];
        await atomicJson(journalFile, journal);
      });
    },
    fenceAll() {
      return serial(async () => {
        let incomplete = false;
        for (const { scope } of Object.values(journal.scopes)) {
          try {
            const deadlineAt = new Date(Date.now() + 15000).toISOString();
            const detail = await observed(scope, deadlineAt);
            await cli(["sandbox", "stop", scope.sandboxRef, "--expected-sandbox-id", detail.id], deadlineAt, false);
            if ((await observed(scope, deadlineAt)).phase !== "Stopped")
              incomplete = true;
          } catch {
            incomplete = true;
          }
        }
        if (incomplete) throw new Error("sandbox_host_unavailable");
      });
    },
  };
}
