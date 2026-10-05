import type { SandboxCapabilitySnapshot, SandboxPolicyCompilation } from "@paperclipai/shared";

export interface SandboxIdentity { companyId: string; bindingId: string; cellId: string; cellGeneration: string; sandboxRef: string }
export interface PreparedSandbox extends SandboxIdentity { backendVersion: string; imageDigest: string }
export interface PolicyApplyResult { applied: boolean; requiresRecreate: boolean; observedPolicyHash: string | null; unsupportedFeatures: string[] }
export interface SandboxObservation { state: "ready" | "running" | "stopped" | "failed" | "unknown"; policyHash: string | null; imageDigest: string | null; generation: string; controlsHealthy: boolean }
export interface SandboxProbeCase { caseId: string; control: string; expected: "allow" | "deny" | "observe" }
export interface SandboxProbeResult { verdict: "pass" | "fail" | "unsupported"; observationHash: string | null }

/** A backend adapter cannot grant company permission. Every call receives a
 * controller-pinned identity and an already-authorized policy projection. */
export interface ExecutionSandboxBackend {
  readonly backend: SandboxCapabilitySnapshot["backend"];
  readonly evidenceKind: SandboxCapabilitySnapshot["evidenceKind"];
  /** null means no target-environment qualification; never invent a snapshot. */
  capabilities(): Promise<SandboxCapabilitySnapshot | null>;
  prepareSandbox(input: SandboxIdentity): Promise<PreparedSandbox>;
  applyPolicy(input: SandboxIdentity & { policy: SandboxPolicyCompilation; currentStaticFingerprint: string | null }): Promise<PolicyApplyResult>;
  startWorkload(input: SandboxIdentity & { policy: SandboxPolicyCompilation; expiresAt: string; idempotencyKey: string }): Promise<{ operationId: string }>;
  inspectWorkload(input: SandboxIdentity): Promise<SandboxObservation>;
  stopWorkload(input: SandboxIdentity & { idempotencyKey: string }): Promise<{ operationId: string }>;
  destroySandbox(input: SandboxIdentity & { idempotencyKey: string }): Promise<{ operationId: string }>;
  probeBoundary(input: SandboxIdentity & { test: SandboxProbeCase }): Promise<SandboxProbeResult>;
}

export const SANDBOX_PROBE_CASES: SandboxProbeCase[] = [
  { caseId: "filesystem_allow", control: "filesystemPolicy", expected: "allow" }, { caseId: "filesystem_deny", control: "filesystemPolicy", expected: "deny" }, { caseId: "filesystem_escape", control: "filesystemPolicy", expected: "deny" },
  { caseId: "process_nonprivileged", control: "processPrivilegePolicy", expected: "observe" }, { caseId: "process_privilege_denied", control: "processPrivilegePolicy", expected: "deny" },
  { caseId: "syscall_allow", control: "syscallPolicy", expected: "allow" }, { caseId: "syscall_deny", control: "syscallPolicy", expected: "deny" },
  { caseId: "network_allow", control: "networkDestinationPolicy", expected: "allow" }, { caseId: "network_host_port_deny", control: "networkDestinationPolicy", expected: "deny" }, { caseId: "network_dns_redirect_deny", control: "networkDestinationPolicy", expected: "deny" },
  { caseId: "network_l7_allow", control: "networkLayer7Policy", expected: "allow" }, { caseId: "network_l7_deny", control: "networkLayer7Policy", expected: "deny" },
  { caseId: "credential_allow", control: "credentialBrokering", expected: "allow" }, { caseId: "credential_raw_read_deny", control: "credentialBrokering", expected: "deny" }, { caseId: "credential_wrong_destination_deny", control: "credentialBrokering", expected: "deny" }, { caseId: "credential_revoke_deny", control: "credentialBrokering", expected: "deny" },
  { caseId: "resource_exhaustion_contained", control: "resourceLimits", expected: "deny" }, { caseId: "force_stop", control: "forceStop", expected: "observe" },
];
