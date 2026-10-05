import { sandboxCapabilitySnapshotSchema, type SandboxCapabilitySnapshot, type SandboxPolicy } from "@paperclipai/shared";
import { conflict, forbidden } from "../../errors.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import type { ExecutionSandboxBackend, PreparedSandbox, SandboxIdentity, SandboxObservation, SandboxProbeCase, SandboxProbeResult } from "./backend.js";
import { compileSandboxPolicy } from "./policy-compiler.js";
import { projectOpenShellPolicy, type OpenShellPolicyDocument } from "./openshell-policy.js";
import { checkOpenShellBoundary } from "./openshell-prover.js";

/** Implemented by the authenticated native runtime host controller. Request
 * bodies and model output cannot register a bridge or supply qualification. */
export interface OpenShellHostBridge {
  capabilities(scope: SandboxIdentity): Promise<SandboxCapabilitySnapshot | null>;
  prepare(scope: SandboxIdentity): Promise<PreparedSandbox>;
  inspect(scope: SandboxIdentity): Promise<SandboxObservation>;
  effectivePolicy(scope: SandboxIdentity): Promise<OpenShellPolicyDocument>;
  apply(scope: SandboxIdentity & { document: OpenShellPolicyDocument; policyHash: string }): Promise<{ applied: boolean; policyHash: string | null }>;
  start(scope: SandboxIdentity & { expiresAt: string; policyHash: string; idempotencyKey: string }): Promise<{ operationId: string }>;
  /** Revocation and native Stop must be independently available. */
  revokeProviders(scope: SandboxIdentity): Promise<void>;
  stop(scope: SandboxIdentity & { idempotencyKey: string }): Promise<{ operationId: string }>;
  destroy(scope: SandboxIdentity & { idempotencyKey: string }): Promise<{ operationId: string }>;
  probe(scope: SandboxIdentity & { test: SandboxProbeCase }): Promise<SandboxProbeResult>;
}

export function openShellBackend(options: {
  identity: SandboxIdentity; boundary: SandboxPolicy; bridge: OpenShellHostBridge;
  evidenceKind?: SandboxCapabilitySnapshot["evidenceKind"];
  prover: { executable: string; executableSha256: string };
}): ExecutionSandboxBackend {
  const { bridge, identity } = options;
  function scope(input: SandboxIdentity) {
    if (nativeSha256(input) !== nativeSha256(identity)) throw forbidden("OpenShell bridge belongs to another immutable runtime scope");
  }
  // Extra operation arguments are deliberately excluded from the scope hash.
  function scoped(input: SandboxIdentity) { scope({ companyId: input.companyId, bindingId: input.bindingId, cellId: input.cellId, cellGeneration: input.cellGeneration, sandboxRef: input.sandboxRef }); }
  async function capabilities() {
    const raw = await bridge.capabilities(identity); if (!raw) return null;
    const snapshot = sandboxCapabilitySnapshotSchema.parse(raw);
    if (snapshot.evidenceKind !== (options.evidenceKind ?? "local_fixture") || snapshot.backend !== "openshell" || snapshot.backendVersion !== "0.1.2" || new Date(snapshot.expiresAt) <= new Date() || new Date(snapshot.testedAt) > new Date()) return null;
    return snapshot;
  }
  async function observed(input: SandboxIdentity) {
    scoped(input); const result = await bridge.inspect(identity), caps = await capabilities();
    if (!caps || result.generation !== identity.cellGeneration || result.imageDigest !== caps.sandboxImageDigest) throw conflict("OpenShell image, generation or qualification changed");
    return result;
  }
  async function boundaryProof() {
    const boundary = projectOpenShellPolicy(options.boundary);
    if (boundary.unsupportedFeatures.length) throw conflict("OpenShell alone cannot enforce the configured maximum boundary", { code: "sandbox_projection_unsupported", unsupportedFeatures: boundary.unsupportedFeatures });
    const effective = await bridge.effectivePolicy(identity);
    const proof = await checkOpenShellBoundary({ ...options.prover, candidate: effective, boundary: boundary.document });
    if (proof.result !== "within_boundary" || ["filesystem", "network_l4", "network_rest", "process", "landlock"].some(domain => !proof.coveredDomains.includes(domain))) throw conflict("OpenShell effective policy did not earn a complete boundary proof", { code: "sandbox_boundary_unproven", result: proof.result, reasonCode: proof.reasonCode });
    return proof;
  }
  async function contain(policyHash: string) {
    let revocationFailed = false;
    try { await bridge.revokeProviders(identity); } catch { revocationFailed = true; }
    const stop = await bridge.stop({ ...identity, idempotencyKey: `v7-sandbox-boundary:${identity.bindingId}:${identity.cellGeneration}:${policyHash}` });
    if (revocationFailed) throw conflict("Boundary closed; provider revocation requires reconciliation", { code: "sandbox_revocation_pending", operationId: stop.operationId });
  }
  return {
    backend: "openshell",
    // This adapter never promotes locally supplied fixture observations.
    evidenceKind: options.evidenceKind ?? "local_fixture",
    capabilities,
    prepareSandbox: async input => {
      scoped(input); const prepared = await bridge.prepare(identity), caps = await capabilities();
      if (!caps || prepared.companyId !== identity.companyId || prepared.cellId !== identity.cellId || prepared.bindingId !== identity.bindingId || prepared.cellGeneration !== identity.cellGeneration || prepared.sandboxRef !== identity.sandboxRef || prepared.imageDigest !== caps.sandboxImageDigest || prepared.backendVersion !== caps.backendVersion) throw conflict("OpenShell preparation does not match the qualified native runtime");
      return prepared;
    },
    applyPolicy: async input => {
      scoped(input);
      if (input.policy.proverResult !== "pass" || input.policy.boundaryPolicyHash !== nativeSha256(options.boundary)) throw conflict("An unchanged authoritative boundary and passing compilation are required");
      const currentCaps = await capabilities();
      const freshCompilation = compileSandboxPolicy({ boundary: options.boundary, candidate: input.policy.compiledPolicy, capabilities: currentCaps, authorizedConnectionGrantHashes: {}, sourcePolicyRefs: input.policy.sourcePolicyRefs });
      if (freshCompilation.proverResult !== "pass") throw conflict("OpenShell enforcement qualification changed", { code: "sandbox_current_controls_required" });
      const projection = projectOpenShellPolicy(input.policy.compiledPolicy);
      if (projection.unsupportedFeatures.length) return { applied: false, requiresRecreate: false, observedPolicyHash: null, unsupportedFeatures: projection.unsupportedFeatures };
      const current = await observed(input);
      if (input.currentStaticFingerprint && input.currentStaticFingerprint !== input.policy.staticPolicyFingerprint) return { applied: false, requiresRecreate: true, observedPolicyHash: null, unsupportedFeatures: [] };
      if (current.state === "running") throw conflict("Stop the workload before its first policy application");
      const boundary = projectOpenShellPolicy(options.boundary);
      if (boundary.unsupportedFeatures.length) return { applied: false, requiresRecreate: false, observedPolicyHash: null, unsupportedFeatures: boundary.unsupportedFeatures };
      const requestedProof = await checkOpenShellBoundary({ ...options.prover, candidate: projection.document, boundary: boundary.document });
      if (requestedProof.result !== "within_boundary") return { applied: false, requiresRecreate: false, observedPolicyHash: null, unsupportedFeatures: [`boundary:${requestedProof.result}`] };
      const policyHash = nativeSha256(input.policy), receipt = await bridge.apply({ ...identity, document: projection.document, policyHash });
      if (!receipt.applied || receipt.policyHash !== policyHash) throw conflict("OpenShell did not observe the exact requested policy");
      try {
        await boundaryProof();
        const after = await observed(input);
        if (!after.controlsHealthy || after.policyHash !== policyHash) throw conflict("OpenShell policy application has not been physically observed");
      } catch (error) { await contain(policyHash); throw error; }
      return { applied: true, requiresRecreate: false, observedPolicyHash: policyHash, unsupportedFeatures: [] };
    },
    startWorkload: async input => {
      scoped(input);
      if (input.policy.proverResult !== "pass" || input.policy.boundaryPolicyHash !== nativeSha256(options.boundary) || !Number.isFinite(Date.parse(input.expiresAt)) || new Date(input.expiresAt) <= new Date()) throw forbidden("Current policy and original unexpired execution deadline are required");
      const currentCaps = await capabilities();
      const freshCompilation = compileSandboxPolicy({ boundary: options.boundary, candidate: input.policy.compiledPolicy, capabilities: currentCaps, authorizedConnectionGrantHashes: {}, sourcePolicyRefs: input.policy.sourcePolicyRefs });
      if (freshCompilation.proverResult !== "pass") throw conflict("OpenShell enforcement qualification changed", { code: "sandbox_current_controls_required" });
      const projection = projectOpenShellPolicy(input.policy.compiledPolicy);
      if (projection.unsupportedFeatures.length) throw forbidden("OpenShell cannot enforce every requested control");
      const current = await observed(input), policyHash = nativeSha256(input.policy);
      if (!current.controlsHealthy || current.policyHash !== policyHash || !["ready", "stopped"].includes(current.state)) throw conflict("Current observed policy is required before workload admission");
      try { await boundaryProof(); } catch (error) { await contain(policyHash); throw error; }
      return bridge.start({ ...identity, expiresAt: input.expiresAt, policyHash, idempotencyKey: input.idempotencyKey });
    },
    inspectWorkload: observed,
    stopWorkload: async input => {
      scoped(input); let revocationFailed = false;
      try { await bridge.revokeProviders(identity); } catch { revocationFailed = true; }
      const result = await bridge.stop({ ...identity, idempotencyKey: input.idempotencyKey });
      if (revocationFailed) throw conflict("Native Stop requested; provider revocation requires reconciliation", { code: "sandbox_revocation_pending", operationId: result.operationId });
      return result;
    },
    destroySandbox: async input => {
      scoped(input); let revocationFailed = false;
      try { await bridge.revokeProviders(identity); } catch { revocationFailed = true; }
      const result = await bridge.destroy({ ...identity, idempotencyKey: input.idempotencyKey });
      if (revocationFailed) throw conflict("Native destruction requested; provider revocation requires reconciliation", { code: "sandbox_revocation_pending", operationId: result.operationId });
      return result;
    },
    probeBoundary: async input => { scoped(input); return bridge.probe({ ...identity, test: input.test }); },
  };
}
