import { SANDBOX_CONTROLS, sandboxCapabilitySnapshotSchema, sandboxPolicySchema, type SandboxCapabilitySnapshot, type SandboxPolicy, type SandboxPolicyCompilation } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";

function within(path: string, boundary: string) { return boundary === "/" || path === boundary || path.startsWith(`${boundary.replace(/\/$/, "")}/`); }
function pathsWithin(candidate: string[], boundary: string[]) { return candidate.every(path => boundary.some(root => within(path, root))); }
function subset<T>(candidate: T[], boundary: T[]) { return candidate.every(value => boundary.includes(value)); }

/** This structural subset proof is not a Linux enforcement test or a backend
 * prover. Callers supply current server-derived grants separately from policy. */
export function compileSandboxPolicy(input: { boundary: SandboxPolicy; candidate: SandboxPolicy; capabilities: SandboxCapabilitySnapshot | null; authorizedConnectionGrantHashes: Record<string, string>; sourcePolicyRefs: string[]; now?: Date }): SandboxPolicyCompilation {
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
  for (const binding of candidate.credentials.bindings) {
    if (input.authorizedConnectionGrantHashes[binding.connectionId] !== binding.grantVersionHash) failures.push("credential_grant_not_current");
    if (!boundary.credentials.bindings.some(allowed => allowed.connectionId === binding.connectionId && allowed.grantVersionHash === binding.grantVersionHash && allowed.hostname === binding.hostname && allowed.port === binding.port && allowed.binary === binding.binary && binding.ttlSeconds <= allowed.ttlSeconds && subset(binding.methods, allowed.methods) && pathsWithin(binding.pathPrefixes, allowed.pathPrefixes))) failures.push("credential_binding_expansion");
    if (!candidate.network.destinations.some(allowed => allowed.hostname === binding.hostname && allowed.port === binding.port && subset(binding.methods, allowed.methods) && pathsWithin(binding.pathPrefixes, allowed.pathPrefixes))) failures.push("credential_destination_not_authorized");
  }
  if (candidate.credentials.mode === "none" && candidate.credentials.bindings.length || candidate.credentials.mode === "legacy_injected" && candidate.credentials.bindings.length) failures.push("credential_mode_inconsistent");
  for (const key of ["cpuMillis", "memoryBytes", "diskBytes", "pidsLimit", "wallClockSeconds"] as const) if (candidate.resources[key] > boundary.resources[key]) failures.push(`resource_${key}_expansion`);
  if (!subset(boundary.requiredControls, candidate.requiredControls)) failures.push("required_control_removed");
  const required = new Set(candidate.requiredControls);
  for (const control of ["processPrivilegePolicy", "resourceLimits", "forceStop"] as const) required.add(control);
  // Requested restrictions require an enforcing mechanism even in a lower
  // profile. Compatibility never means silently ignoring part of a policy.
  if (candidate.filesystem.readPaths.length || candidate.filesystem.writePaths.length || candidate.filesystem.deniedPaths.length) required.add("filesystemPolicy");
  required.add("networkDestinationPolicy");
  if (candidate.process.allowedSyscalls.length) required.add("syscallPolicy");
  if (candidate.broadAutonomy || rank[candidate.profile] >= 2) for (const control of ["filesystemPolicy", "syscallPolicy", "networkDestinationPolicy", "credentialBrokering"] as const) required.add(control);
  if (candidate.credentials.mode === "brokered") required.add("credentialBrokering");
  if (candidate.network.destinations.some(d => ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].some(method => !d.methods.includes(method as typeof d.methods[number])) || !d.pathPrefixes.includes("/"))) required.add("networkLayer7Policy");
  if (!caps) unsupported.push("capability_snapshot_missing");
  else {
    if (new Date(caps.expiresAt) <= now || new Date(caps.testedAt) > now) unsupported.push("capability_snapshot_stale");
    if (candidate.profile !== "development" && caps.evidenceKind !== "protected_host_report") unsupported.push("production_boundary_evidence_missing");
    if (rank[candidate.profile] >= 2 && !caps.hostKernelVersion) unsupported.push("host_kernel_qualification_missing");
    for (const control of SANDBOX_CONTROLS) if (required.has(control) && !caps[control]) unsupported.push(control);
    if (required.has("filesystemPolicy") && caps.filesystemEnforcementMode !== "hard_requirement") unsupported.push("filesystem_hard_enforcement_missing");
    if (candidate.credentials.mode === "brokered") for (const dimension of ["company", "presence", "host", "port", "method", "path", "expiry", "revocation"] as const) if (!caps.credentialBindingDimensions.includes(dimension)) unsupported.push(`credential_${dimension}_binding_missing`);
    if (candidate.credentials.bindings.some(binding => binding.binary) && !caps.credentialBindingDimensions.includes("binary")) unsupported.push("credential_binary_binding_missing");
    if (candidate.profile === "high_assurance_managed" && (!caps.policyProverBoundaryCheck || [...required].some(control => !caps.policyProverCoverage.includes(control)))) unsupported.push("backend_boundary_prover_coverage_missing");
  }
  if ((candidate.broadAutonomy || rank[candidate.profile] >= 2) && candidate.credentials.mode === "legacy_injected") failures.push("raw_credential_exposure");
  return { schemaVersion: 1, compilerVersion: "aw-v7.1", boundaryPolicyHash: nativeSha256(boundary), candidatePolicyHash: nativeSha256(candidate), staticPolicyFingerprint: nativeSha256({ filesystem: candidate.filesystem, process: candidate.process, resources: candidate.resources, credentials: candidate.credentials }), proverResult: failures.length ? "fail" : unsupported.length ? "unsupported" : "pass", failedBoundaries: [...new Set(failures)].sort(), unsupportedFeatures: [...new Set(unsupported)].sort(), enforcementProfile: candidate.profile, sourcePolicyRefs: [...new Set(input.sourcePolicyRefs)].sort(), compiledPolicy: candidate };
}
