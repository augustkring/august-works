import path from "node:path";
import type { SandboxPolicy, SandboxPolicyCompilation, SandboxQualificationProbeFixture } from "@paperclipai/shared";
import { sandboxPolicySchema, sandboxNetworkCallerBinariesSchema } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";

// Authored policy representation verified against OpenShell v0.1.2's
// openshell-policy-schema. Driver limits and credential authority stay outside
// this document and must have their own qualified enforcement mechanism.
export interface OpenShellPolicyDocument {
  version: 1;
  filesystem_policy: { include_workdir: false; read_only: string[]; read_write: string[] };
  landlock: { compatibility: "hard_requirement" };
  process: { run_as_user: string; run_as_group: string };
  network_policies: Record<string, {
    name: string; binaries: Array<{ path: string }>;
    endpoints: Array<{ host: string; port: number; protocol: "rest"; enforcement: "enforce"; rules: Array<{ allow: { method: string; path: string } }> }>;
  }>;
}
function within(path: string, root: string) { return root === "/" || path === root || path.startsWith(root + "/"); }

/** Derives a Task-scoped proof maximum from an already compiled candidate and
 * the unchanged operator maximum. This is only an attenuation: all non-FS
 * proof dimensions remain exactly those of the operator projection. Callers
 * must separately validate the current server-owned workspace receipt. */
export function deriveNativeConformanceProofMaximum(input: {
  operatorMaximum: OpenShellPolicyDocument;
  candidate: OpenShellPolicyDocument;
  taskRoot: string;
  modelBinaries: readonly string[];
}): OpenShellPolicyDocument | null {
  const { operatorMaximum, candidate, taskRoot } = input;
  if (typeof taskRoot !== "string" || !path.posix.isAbsolute(taskRoot) || path.posix.normalize(taskRoot) !== taskRoot ||
      taskRoot === "/" || taskRoot === "/workspace" || taskRoot.split("/").some(part => part === "." || part === "..")) return null;
  const modelBinaries = [...new Set(input.modelBinaries)].sort();
  if (!modelBinaries.length || modelBinaries.some(binary => typeof binary !== "string" || !path.posix.isAbsolute(binary) ||
      path.posix.normalize(binary) !== binary || binary === "/" || binary.split("/").some(part => part === "." || part === ".."))) return null;
  const expectedReads = [...new Set([taskRoot, "/.openshell/runtime/openshell-sandbox", ...modelBinaries])].sort();
  const candidateReads = candidate.filesystem_policy.read_only;
  const candidateWrites = candidate.filesystem_policy.read_write;
  if (candidate.filesystem_policy.include_workdir !== false ||
      nativeSha256(candidateReads) !== nativeSha256(expectedReads) ||
      nativeSha256(candidateWrites) !== nativeSha256([taskRoot])) return null;
  const parentReads = [...operatorMaximum.filesystem_policy.read_only, ...operatorMaximum.filesystem_policy.read_write];
  if (candidateReads.some(value => !parentReads.some(root => within(value, root))) ||
      candidateWrites.some(value => !operatorMaximum.filesystem_policy.read_write.some(root => within(value, root)))) return null;
  return { ...operatorMaximum, filesystem_policy: { ...operatorMaximum.filesystem_policy,
    read_only: [...candidateReads], read_write: [...candidateWrites] } };
}
export function projectOpenShellPolicy(raw: SandboxPolicy, modelBrokerEndpoint?: SandboxPolicyCompilation["modelBrokerEndpoint"], credentialBrokerEndpoints: SandboxPolicyCompilation["credentialBrokerEndpoints"] = []) {
  const policy = sandboxPolicySchema.parse(raw), unsupported: string[] = [];
  const modelRoute = modelBrokerEndpoint?.path === "/runtime-tools/model/v1/messages" &&
    Number.isInteger(modelBrokerEndpoint.port) && modelBrokerEndpoint.port > 0 && modelBrokerEndpoint.port <= 65535 &&
    /^[a-z0-9.-]+$/.test(modelBrokerEndpoint.hostname);
  if (modelBrokerEndpoint && !modelRoute) unsupported.push("managed_model_broker_route_invalid");
  if (policy.profile === "high_assurance_managed") unsupported.push("high_assurance_complete_prover_coverage_unavailable");
  // Landlock supports positive allowlists, not holes below an allowed parent.
  if (policy.filesystem.deniedPaths.some(deny => [...policy.filesystem.readPaths, ...policy.filesystem.writePaths].some(root => within(deny, root)))) unsupported.push("filesystem_deny_exception_not_representable");
  // OpenShell's binary selectors authorize NETWORK callers. They do not
  // implement a general process-execution or custom syscall allowlist.
  if (policy.process.allowedBinaries.length) unsupported.push("process_binary_allowlist_requires_outer_enforcement");
  if (policy.process.allowedSyscalls.length) unsupported.push("custom_syscall_allowlist_requires_outer_enforcement");
  if (policy.credentials.mode === "legacy_injected") unsupported.push("raw_credential_exposure");
  if (policy.credentials.mode === "brokered" && !policy.credentials.bindings.length) unsupported.push("credential_broker_binding_missing");
  if (policy.credentials.mode === "none" && policy.credentials.bindings.length) unsupported.push("credential_mode_inconsistent");

  const document: OpenShellPolicyDocument = {
    version: 1, filesystem_policy: { include_workdir: false, read_only: [...policy.filesystem.readPaths].sort(), read_write: [...policy.filesystem.writePaths].sort() },
    landlock: { compatibility: "hard_requirement" }, process: { run_as_user: String(policy.process.uid), run_as_group: String(policy.process.uid) }, network_policies: {},
  };
  const destinations = [...policy.network.destinations];
  if (modelRoute && !destinations.some(destination => destination.hostname === modelBrokerEndpoint.hostname && destination.port === modelBrokerEndpoint.port && destination.methods.length === 1 && destination.methods[0] === "POST" && destination.pathPrefixes.length === 1 && destination.pathPrefixes[0] === modelBrokerEndpoint.path))
    destinations.push({ hostname: modelBrokerEndpoint.hostname, port: modelBrokerEndpoint.port, methods: ["POST"], pathPrefixes: [modelBrokerEndpoint.path] });
  const appEndpoints = credentialBrokerEndpoints.filter(endpoint =>
    /^[a-z0-9.-]+$/.test(endpoint.hostname) && Number.isInteger(endpoint.port) && endpoint.port > 0 && endpoint.port <= 65535 &&
    /^\/mcp\/gateways\/[A-Za-z0-9_-]{1,128}$/.test(endpoint.path) &&
    sandboxNetworkCallerBinariesSchema.safeParse([endpoint.binary]).success && policy.credentials.mode === "brokered" &&
    policy.credentials.bindings.some(binding => binding.connectionId === endpoint.connectionId && binding.binary === endpoint.binary));
  if (appEndpoints.length !== credentialBrokerEndpoints.length) unsupported.push("credential_broker_caller_route_invalid");
  for (const endpoint of appEndpoints) {
    if (!destinations.some(destination => destination.hostname === endpoint.hostname && destination.port === endpoint.port &&
      destination.methods.length === 1 && destination.methods[0] === "POST" && destination.pathPrefixes.length === 1 && destination.pathPrefixes[0] === endpoint.path))
      destinations.push({ hostname: endpoint.hostname, port: endpoint.port, methods: ["POST"], pathPrefixes: [endpoint.path] });
  }
  destinations.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  destinations.forEach((destination, index) => {
    const exactModelRoute = Boolean(modelRoute && destination.hostname === modelBrokerEndpoint!.hostname &&
      destination.port === modelBrokerEndpoint!.port && destination.methods.length === 1 && destination.methods[0] === "POST" &&
      destination.pathPrefixes.length === 1 && destination.pathPrefixes[0] === modelBrokerEndpoint!.path);
    const exactAppRoutes = appEndpoints.filter(endpoint => destination.hostname === endpoint.hostname && destination.port === endpoint.port &&
      destination.methods.length === 1 && destination.methods[0] === "POST" && destination.pathPrefixes.length === 1 && destination.pathPrefixes[0] === endpoint.path);
    const binaries = exactModelRoute ? modelBrokerEndpoint?.binaries : [...new Set(exactAppRoutes.map(endpoint => endpoint.binary))].sort();
    if (!sandboxNetworkCallerBinariesSchema.safeParse(binaries).success) {
      unsupported.push("network_calling_binary_missing");
      return;
    }
    const rules = destination.methods.flatMap(method => destination.pathPrefixes.map(path => ({ allow: { method, path } })));
    document.network_policies[`aw_${index}`] = { name: `aw_${index}`, binaries: binaries!.map(path => ({ path })),
      endpoints: [{ host: destination.hostname, port: destination.port, protocol: "rest", enforcement: "enforce", rules }] };
  });
  return { document, documentHash: nativeSha256(document), unsupportedFeatures: unsupported };
}

/** Build the one-purpose, initial CreateSandbox policy used only for the
 * bounded qualification probes. Every permission comes from the protected
 * operator-owned fixture; no user execution policy or request endpoint is
 * accepted here. */
export function projectOpenShellQualificationProbePolicy(fixture: SandboxQualificationProbeFixture) {
  const fs = fixture.filesystem;
  const readOnly = [...new Set([
    "/.openshell/runtime", "/bin", "/etc", "/usr/bin", "/proc",
    "/proc/self/status", "/proc/sys/net/ipv4/ip_unprivileged_port_start",
    "/proc/sys/kernel/cap_last_cap", "/sys/fs/cgroup",
    fs.allowedReadPath, fs.escapeViaRoot,
  ])].sort();
  const readWrite = [fs.workdirPath];
  const withinRoot = (target: string, root: string) => root === "/" || target === root || target.startsWith(`${root}/`);
  const forbiddenFixtureTarget = [fs.deniedReadPath, fs.escapeTargetPath].some(target =>
    [...readOnly, ...readWrite].some(root => withinRoot(target, root)));
  const workdirOverlap = [...readOnly].some(root => withinRoot(root, fs.workdirPath) || withinRoot(fs.workdirPath, root));
  if (path.posix.resolve(fs.escapeOperand) !== fs.escapeTargetPath ||
      forbiddenFixtureTarget || workdirOverlap || fixture.runAsUser === "0" || fixture.runAsGroup === "0")
    return { document: null, documentHash: null, unsupportedFeatures: ["qualification_fixture_paths_or_identity_overlap"] as string[] };

  const byDestination = new Map<string, { host: string; port: number; rules: Array<{ allow: { method: string; path: string } }> }>();
  const addEndpoint = (rawUrl: string, method: string, nonceTemplate: boolean, includeRule = true) => {
    let url: URL;
    let path: string;
    try {
      if (nonceTemplate) {
        if (rawUrl.split("{nonce}").length !== 2) return false;
        const nonce = "a".repeat(32);
        url = new URL(rawUrl.replace("{nonce}", nonce));
        if (url.pathname.split("/").filter(segment => segment === nonce).length !== 1) return false;
        path = url.pathname.split("/").map(segment => segment === nonce ? "?".repeat(32) : segment).join("/");
      } else {
        url = new URL(rawUrl);
        path = url.pathname;
      }
    } catch { return false; }
    // OpenShell REST paths are globs. Operator fixtures are literals except
    // for the single controlled nonce segment; reject any other glob or URL
    // encoding syntax rather than silently widening a probe rule.
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash ||
        /[%*?\[\]]/.test(url.pathname) ||
        !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) || !path.startsWith("/")) return false;
    const host = url.hostname.toLowerCase(), port = Number(url.port || 443), key = `${host}:${port}`;
    const value = byDestination.get(key) ?? { host, port, rules: [] };
    const rule = { allow: { method, path } };
    if (includeRule && !value.rules.some(existing => JSON.stringify(existing) === JSON.stringify(rule))) value.rules.push(rule);
    byDestination.set(key, value);
    return true;
  };
  if (!addEndpoint(fixture.network.allow.urlTemplate, fixture.network.allow.method, true) ||
      !addEndpoint(fixture.network.redirectDeny.urlTemplate, fixture.network.redirectDeny.method, true) ||
      !addEndpoint(fixture.network.dnsRedirectDeny.urlTemplate, fixture.network.dnsRedirectDeny.method, true) ||
      !addEndpoint(fixture.network.l7Allow.urlTemplate, fixture.network.l7Allow.method, true) ||
      !addEndpoint(fixture.network.l7Deny.urlTemplate, fixture.network.l7Deny.method, true, false))
    return { document: null, documentHash: null, unsupportedFeatures: ["qualification_network_template_invalid"] as string[] };
  {
    let deniedL7Url: URL;
    try { deniedL7Url = new URL(fixture.network.l7Deny.urlTemplate.replace("{nonce}", "a".repeat(32))); }
    catch { return { document: null, documentHash: null, unsupportedFeatures: ["qualification_l7_sentinel_invalid"] as string[] }; }
    const deniedL7Port = Number(deniedL7Url.port || 443), key = `${deniedL7Url.hostname.toLowerCase()}:${deniedL7Port}`;
    const endpoint = byDestination.get(key) ?? { host: deniedL7Url.hostname.toLowerCase(), port: deniedL7Port, rules: [] };
    const sentinelMethod = fixture.network.l7Deny.method === "GET" ? "POST" : "GET";
    const sentinelRule = { allow: { method: sentinelMethod, path: "/__aw_qualification_l7_sentinel__" } };
    if (!endpoint.rules.some(existing => JSON.stringify(existing) === JSON.stringify(sentinelRule))) endpoint.rules.push(sentinelRule);
    byDestination.set(key, endpoint);
  }
  if (fixture.credential) {
    const credentialUrl = new URL(fixture.credential.origin);
    if (!addEndpoint(`${credentialUrl.origin}/mcp/gateways/${fixture.credential.gatewayPublicId}`,
      fixture.credential.method, false))
      return { document: null, documentHash: null, unsupportedFeatures: ["qualification_credential_endpoint_invalid"] as string[] };
  }
  const network_policies: OpenShellPolicyDocument["network_policies"] = {};
  [...byDestination.values()].sort((a, b) => a.host < b.host ? -1 : a.host > b.host ? 1 : a.port - b.port).forEach((destination, index) => {
    const policyName = `aw_probe_${index}`;
    network_policies[policyName] = { name: policyName, binaries: [{ path: "/usr/bin/curl" }], endpoints: [{
      host: destination.host, port: destination.port, protocol: "rest", enforcement: "enforce",
      rules: destination.rules.sort((a, b) => JSON.stringify(a.allow).localeCompare(JSON.stringify(b.allow))),
    }] };
  });
  const document: OpenShellPolicyDocument = {
    version: 1,
    filesystem_policy: { include_workdir: false, read_only: readOnly, read_write: readWrite },
    landlock: { compatibility: "hard_requirement" },
    process: { run_as_user: fixture.runAsUser, run_as_group: fixture.runAsGroup },
    network_policies,
  };
  return { document, documentHash: nativeSha256(document), unsupportedFeatures: [] as string[] };
}
