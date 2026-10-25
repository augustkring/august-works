import { SANDBOX_CONTROLS, sandboxCapabilitySnapshotSchema, sandboxPolicySchema, type SandboxCapabilitySnapshot, type SandboxPolicy, type SandboxPolicyCompilation } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";

function within(path: string, boundary: string) { return boundary === "/" || path === boundary || path.startsWith(`${boundary.replace(/\/$/, "")}/`); }
function pathsWithin(candidate: string[], boundary: string[]) { return candidate.every(path => boundary.some(root => within(path, root))); }
function subset<T>(candidate: T[], boundary: T[]) { return candidate.every(value => boundary.includes(value)); }

/** This structural subset proof is not a Linux enforcement test or a backend
 * prover. Callers supply current server-derived grants separately from policy. */
export type ResolvedSandboxBrokerBinding = {
  connectionId: string; grantVersionHash: string; gatewayPublicId: string; endpointPath: string;
  allowedTools: string[]; destination: { hostname: string; port: number; method: "POST"; path: string };
};
export function compileSandboxPolicy(input: { boundary: SandboxPolicy; candidate: SandboxPolicy; capabilities: SandboxCapabilitySnapshot | null; authorizedConnectionGrantHashes: Record<string, string>; credentialBrokerOrigin?: string | null; credentialBrokerBindings?: ResolvedSandboxBrokerBinding[]; sourcePolicyRefs: string[]; now?: Date }): SandboxPolicyCompilation {
  const boundary = sandboxPolicySchema.parse(input.boundary), candidate = sandboxPolicySchema.parse(input.candidate), failures: string[] = [], unsupported: string[] = [];
  const caps = input.capabilities ? sandboxCapabilitySnapshotSchema.parse(input.capabilities) : null, now = input.now ?? new Date();
  if (candidate.riskClass === "C4") failures.push("domain_overlay_not_qualified");
  const rank = { development: 0, compatibility: 1, standard_managed: 2, high_assurance_managed: 3 };
  if (rank[candidate.profile] < rank[boundary.profile]) failures.push("assurance_downgrade");
  if (candidate.broadAutonomy && !boundary.broadAutonomy) failures.push("autonomy_expansion");
  if (Number(candidate.riskClass.slice(1)) > Number(boundary.riskClass.slice(1))) failures.push("risk_expansion");
  if (!pathsWithin(candidate.filesystem.readPaths, boundary.filesystem.readPaths)) failures.push("filesystem_read_expansion");
  if (!pathsWithin(candidate.filesystem.writePaths, boundary.filesystem.writePaths)) failures.push("filesystem_write_expansion");
  if (!boundary.filesystem.deniedPaths.every(path => candidate.filesystem.deniedPaths.some(deny => within(path, deny)))) failures.push("filesystem_deny_removed");
  if (candidate.process.uid !== boundary.process.uid || !subset(candidate.process.allowedBinaries, boundary.process.allowedBinaries) || !subset(candidate.process.allowedSyscalls, boundary.process.allowedSyscalls)) failures.push("process_expansion");
  for (const destination of candidate.network.destinations) {
    if (!boundary.network.destinations.some(allowed => allowed.hostname === destination.hostname && allowed.port === destination.port && subset(destination.methods, allowed.methods) && pathsWithin(destination.pathPrefixes, allowed.pathPrefixes))) failures.push("network_expansion");
  }
  if (candidate.credentials.mode !== "none" && candidate.credentials.mode !== boundary.credentials.mode) failures.push("credential_mode_change");
  const resolvedBrokerBindings = input.credentialBrokerBindings ?? [];
  for (const binding of candidate.credentials.bindings) {
    if (input.authorizedConnectionGrantHashes[binding.connectionId] !== binding.grantVersionHash) failures.push("credential_grant_not_current");
    if (!boundary.credentials.bindings.some(allowed => allowed.connectionId === binding.connectionId && allowed.grantVersionHash === binding.grantVersionHash && allowed.hostname === binding.hostname && allowed.port === binding.port && allowed.binary === binding.binary && binding.ttlSeconds <= allowed.ttlSeconds && subset(binding.methods, allowed.methods) && pathsWithin(binding.pathPrefixes, allowed.pathPrefixes))) failures.push("credential_binding_expansion");
    if (candidate.network.destinations.some(destination => destination.hostname === binding.hostname && destination.port === binding.port)) failures.push("credential_provider_direct_egress");
  }
  if (candidate.credentials.mode === "none" && candidate.credentials.bindings.length || candidate.credentials.mode === "legacy_injected" && candidate.credentials.bindings.length) failures.push("credential_mode_inconsistent");
  let compiledPolicy = candidate;
  let modelBrokerEndpoint: SandboxPolicyCompilation["modelBrokerEndpoint"];
  if (candidate.credentials.mode === "brokered") {
    if (candidate.credentials.bindings.length === 0) failures.push("credential_broker_binding_missing");
    let origin: URL | null = null;
    try {
      origin = new URL(input.credentialBrokerOrigin ?? "");
      if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") origin = null;
    } catch { origin = null; }
    if (!origin) unsupported.push("credential_broker_origin_unavailable");
    if (resolvedBrokerBindings.length !== candidate.credentials.bindings.length ||
      candidate.credentials.bindings.some(binding => !resolvedBrokerBindings.some(resolved =>
        resolved.connectionId === binding.connectionId && resolved.grantVersionHash === binding.grantVersionHash &&
        resolved.destination.hostname === binding.hostname && resolved.destination.port === binding.port &&
        binding.methods.includes("POST") && pathsWithin([resolved.destination.path], binding.pathPrefixes)))) {
      failures.push("credential_broker_binding_resolution_mismatch");
    }
    if (candidate.credentials.bindings.some(binding => binding.binary !== null)) unsupported.push("credential_binary_binding_not_enforced");
    const endpoints: NonNullable<typeof input.credentialBrokerBindings> = [];
    for (const resolved of resolvedBrokerBindings) {
      const expectedPath = `/mcp/gateways/${resolved.gatewayPublicId}`;
      if (resolved.endpointPath !== expectedPath || !/^[a-zA-Z0-9_-]{1,128}$/.test(resolved.gatewayPublicId) ||
        resolved.allowedTools.length === 0 || resolved.destination.method !== "POST") {
        failures.push("credential_broker_route_invalid");
        continue;
      }
      if (!origin) continue;
      const port = origin.port ? Number(origin.port) : 443;
      if (resolved.destination.hostname === origin.hostname && resolved.destination.port === port) failures.push("credential_broker_provider_origin_collision");
      if (candidate.network.destinations.some(destination => destination.hostname === origin!.hostname && destination.port === port)) {
        failures.push("credential_broker_egress_broadened");
      }
      endpoints.push(resolved);
    }
    if (origin && endpoints.length === resolvedBrokerBindings.length) {
      const brokerDestinations = endpoints.map(binding => ({
        hostname: origin!.hostname, port: origin!.port ? Number(origin!.port) : 443,
        methods: ["POST"] as SandboxPolicy["network"]["destinations"][number]["methods"],
        pathPrefixes: [binding.endpointPath],
      }));
      compiledPolicy = {
        ...candidate,
        network: {
          ...candidate.network,
          destinations: [...candidate.network.destinations, ...brokerDestinations],
        },
      };
    }
  } else if (resolvedBrokerBindings.length > 0) {
    failures.push("credential_broker_bindings_without_brokered_mode");
  }
  if (caps?.modelBrokerProviderProfile) {
    let origin: URL | null = null;
    try {
      origin = new URL(input.credentialBrokerOrigin ?? "");
      if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") origin = null;
    } catch { origin = null; }
    if (!origin) unsupported.push("managed_model_broker_origin_unavailable");
    if (caps.backend !== "openshell") unsupported.push("managed_model_broker_requires_openshell");
    const candidateModelDestinations = origin ? candidate.network.destinations.filter(destination => destination.hostname === origin!.hostname && destination.port === Number(origin!.port || 443)) : [];
    const exactModelDestination = candidateModelDestinations.length === 1 && candidateModelDestinations[0]!.methods.length === 1 &&
      candidateModelDestinations[0]!.methods[0] === "POST" && candidateModelDestinations[0]!.pathPrefixes.length === 1 &&
      candidateModelDestinations[0]!.pathPrefixes[0] === "/runtime-tools/model/v1/messages";
    if (candidateModelDestinations.length && !exactModelDestination) failures.push("managed_model_broker_egress_broadened");
    if (candidate.network.destinations.some(destination => destination.hostname === "anthropic.com" || destination.hostname.endsWith(".anthropic.com")))
      failures.push("managed_model_provider_direct_egress");
    if (origin && !exactModelDestination) {
      modelBrokerEndpoint = { hostname: origin.hostname, port: Number(origin.port || 443), path: "/runtime-tools/model/v1/messages" };
      compiledPolicy = {
        ...compiledPolicy,
        network: { ...compiledPolicy.network, destinations: [...compiledPolicy.network.destinations, {
          hostname: modelBrokerEndpoint.hostname, port: modelBrokerEndpoint.port,
          methods: ["POST"], pathPrefixes: [modelBrokerEndpoint.path],
        }] },
      };
    }
  }
  for (const key of ["cpuMillis", "memoryBytes", "diskBytes", "pidsLimit", "wallClockSeconds"] as const) if (candidate.resources[key] > boundary.resources[key]) failures.push(`resource_${key}_expansion`);
  if (!subset(boundary.requiredControls, candidate.requiredControls)) failures.push("required_control_removed");
  const required = new Set(compiledPolicy.requiredControls);
  for (const control of ["processPrivilegePolicy", "resourceLimits", "forceStop"] as const) required.add(control);
  // Requested restrictions require an enforcing mechanism even in a lower
  // profile. Compatibility never means silently ignoring part of a policy.
  if (candidate.filesystem.readPaths.length || candidate.filesystem.writePaths.length || candidate.filesystem.deniedPaths.length) required.add("filesystemPolicy");
  required.add("networkDestinationPolicy");
  if (candidate.process.allowedSyscalls.length) required.add("syscallPolicy");
  if (candidate.broadAutonomy || rank[candidate.profile] >= 2) for (const control of ["filesystemPolicy", "syscallPolicy", "networkDestinationPolicy", "credentialBrokering"] as const) required.add(control);
  if (compiledPolicy.credentials.mode === "brokered" || modelBrokerEndpoint) required.add("credentialBrokering");
  if (compiledPolicy.network.destinations.some(d => ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].some(method => !d.methods.includes(method as typeof d.methods[number])) || !d.pathPrefixes.includes("/"))) required.add("networkLayer7Policy");
  if (!caps) unsupported.push("capability_snapshot_missing");
  else {
    if (new Date(caps.expiresAt) <= now || new Date(caps.testedAt) > now) unsupported.push("capability_snapshot_stale");
    if (candidate.profile !== "development" && caps.evidenceKind !== "protected_host_report") unsupported.push("production_boundary_evidence_missing");
    if (rank[candidate.profile] >= 2 && !caps.hostKernelVersion) unsupported.push("host_kernel_qualification_missing");
    for (const control of SANDBOX_CONTROLS) if (required.has(control) && !caps[control]) unsupported.push(control);
    if (required.has("filesystemPolicy") && caps.filesystemEnforcementMode !== "hard_requirement") unsupported.push("filesystem_hard_enforcement_missing");
    if (compiledPolicy.credentials.mode === "brokered") for (const dimension of ["company", "presence", "host", "port", "method", "path", "expiry", "revocation"] as const) if (!caps.credentialBindingDimensions.includes(dimension)) unsupported.push(`credential_${dimension}_binding_missing`);
    if (compiledPolicy.credentials.mode === "brokered" && !caps.credentialBrokerProviderProfile) unsupported.push("credential_broker_provider_profile_unqualified");
    if (modelBrokerEndpoint && !caps.modelBrokerProviderProfile) unsupported.push("managed_model_broker_provider_profile_unqualified");
    if (compiledPolicy.credentials.bindings.some(binding => binding.binary !== null) && !caps.credentialBindingDimensions.includes("binary")) unsupported.push("credential_binary_binding_missing");
    if (candidate.profile === "high_assurance_managed" && (!caps.policyProverBoundaryCheck || [...required].some(control => !caps.policyProverCoverage.includes(control)))) unsupported.push("backend_boundary_prover_coverage_missing");
  }
  if ((compiledPolicy.broadAutonomy || rank[compiledPolicy.profile] >= 2) && compiledPolicy.credentials.mode === "legacy_injected") failures.push("raw_credential_exposure");
  const sourcePolicyRefs = [...new Set([...input.sourcePolicyRefs, ...(caps?.modelBrokerProviderProfile && modelBrokerEndpoint ? [
    `managed-model-broker-origin:https://${modelBrokerEndpoint.hostname}:${modelBrokerEndpoint.port}`,
    `managed-model-broker-profile:${caps.modelBrokerProviderProfile.id}:${caps.modelBrokerProviderProfile.hash}`,
  ] : [])])].sort();
  const candidatePolicyHash = nativeSha256(compiledPolicy);
  return { schemaVersion: 1, compilerVersion: "aw-v7.2", boundaryPolicyHash: nativeSha256(boundary), candidatePolicyHash, staticPolicyFingerprint: nativeSha256({ filesystem: compiledPolicy.filesystem, process: compiledPolicy.process, resources: compiledPolicy.resources, credentials: compiledPolicy.credentials, brokerEgress: compiledPolicy.network.destinations, modelBrokerProfile: modelBrokerEndpoint ? caps?.modelBrokerProviderProfile : null }), proverResult: failures.length ? "fail" : unsupported.length ? "unsupported" : "pass", failedBoundaries: [...new Set(failures)].sort(), unsupportedFeatures: [...new Set(unsupported)].sort(), enforcementProfile: compiledPolicy.profile, sourcePolicyRefs, compiledPolicy, ...(modelBrokerEndpoint ? { modelBrokerEndpoint } : {}) };
}
