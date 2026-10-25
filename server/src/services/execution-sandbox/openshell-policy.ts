import type { SandboxPolicy } from "@paperclipai/shared";
import { sandboxPolicySchema } from "@paperclipai/shared";
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
export function projectOpenShellPolicy(raw: SandboxPolicy) {
  const policy = sandboxPolicySchema.parse(raw), unsupported: string[] = [];
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
  if (policy.network.destinations.length && !policy.process.allowedBinaries.length) unsupported.push("network_calling_binary_missing");
  const document: OpenShellPolicyDocument = {
    version: 1, filesystem_policy: { include_workdir: false, read_only: [...policy.filesystem.readPaths].sort(), read_write: [...policy.filesystem.writePaths].sort() },
    landlock: { compatibility: "hard_requirement" }, process: { run_as_user: String(policy.process.uid), run_as_group: String(policy.process.uid) }, network_policies: {},
  };
  policy.network.destinations.forEach((destination, index) => {
    const rules = destination.methods.flatMap(method => destination.pathPrefixes.flatMap(path => {
      const exactBrokerGatewayRoute = policy.credentials.mode === "brokered" && /^\/mcp\/gateways\/[A-Za-z0-9_-]{1,128}$/.test(path);
      return path === "/" ? [{ allow: { method, path: "/**" } }]
        : exactBrokerGatewayRoute ? [{ allow: { method, path } }]
          : [{ allow: { method, path } }, { allow: { method, path: `${path}/**` } }];
    }));
    document.network_policies[`aw_${index}`] = { name: `aw_${index}`, binaries: policy.process.allowedBinaries.map(path => ({ path })), endpoints: [{ host: destination.hostname, port: destination.port, protocol: "rest", enforcement: "enforce", rules }] };
  });
  return { document, documentHash: nativeSha256(document), unsupportedFeatures: unsupported };
}
