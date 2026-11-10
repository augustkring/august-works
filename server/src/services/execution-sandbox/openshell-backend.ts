import type { Db } from "@paperclipai/db";
import { getAssignedMcpGateway } from "../native-runtime/assigned-mcp-tools.js";
import { qualificationProbeFixtureSchema, sandboxCapabilitySnapshotSchema, type SandboxCapabilitySnapshot, type SandboxPolicy, type SandboxPolicyCompilation, type SandboxQualificationProbeFixture } from "@paperclipai/shared";
import { conflict, forbidden } from "../../errors.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import type { ExecutionSandboxBackend, PreparedSandbox, SandboxAdmissionCleanup, SandboxIdentity, SandboxObservation, SandboxProbeCase, SandboxProbeResult, SandboxProvisioningIntent } from "./backend.js";
import { compileSandboxPolicy, type ResolvedSandboxBrokerBinding } from "./policy-compiler.js";
import { projectOpenShellQualificationProbePolicy } from "./openshell-policy.js";
import { projectOpenShellPolicy, type OpenShellPolicyDocument } from "./openshell-policy.js";
import { checkOpenShellBoundary } from "./openshell-prover.js";

/** Implemented by the authenticated native runtime host controller. Request
 * bodies and model output cannot register a bridge or supply qualification. */
export interface OpenShellHostBridge {
  capabilities(scope: SandboxIdentity): Promise<SandboxCapabilitySnapshot | null>;
  prepare(scope: SandboxIdentity, provisioning?: {
    purpose: "qualification" | "admission"; operationKey: string; bindingVersion: number; expiresAt: string; policyHash: string;
    document: OpenShellPolicyDocument;
    resourceLimits: Pick<SandboxPolicy["resources"], "cpuMillis" | "memoryBytes" | "diskBytes" | "pidsLimit">;
    probeFixtureHash?: string; qualificationProbeFixture?: SandboxQualificationProbeFixture;
  }): Promise<PreparedSandbox>;
  inspect(scope: SandboxIdentity & { nativeAdmissionCleanup?: SandboxAdmissionCleanup }): Promise<SandboxObservation>;
  effectivePolicy(scope: SandboxIdentity): Promise<OpenShellPolicyDocument>;
  apply(scope: SandboxIdentity & { document: OpenShellPolicyDocument; policyHash: string; expiresAt: string; idempotencyKey: string;
    resourceLimits: Pick<SandboxPolicy["resources"], "cpuMillis" | "memoryBytes" | "diskBytes" | "pidsLimit">;
    credentialProviderProfile?: { id: string; hash: string; binaries: string[] } }): Promise<{ applied: boolean; policyHash: string | null; requiresRecreate?: boolean }>;
  start(scope: SandboxIdentity & { expiresAt: string; policyHash: string; idempotencyKey: string }): Promise<{ operationId: string }>;
  /** Revocation and native Stop must be independently available. */
  revokeProviders(scope: SandboxIdentity): Promise<void>;
  stop(scope: SandboxIdentity & { idempotencyKey: string; nativeAdmissionCleanup?: SandboxAdmissionCleanup }): Promise<{ operationId: string }>;
  destroy(scope: SandboxIdentity & { idempotencyKey: string }): Promise<{ operationId: string }>;
  probe(scope: SandboxIdentity & { test: SandboxProbeCase }): Promise<SandboxProbeResult>;
}

/** Compose distinct enforced owners; raw Host metadata cannot assert server
 * identity, lifetime or revocation enforcement. No credentials are resolved. */
export function composeOpenShellBrokerCapabilities(snapshot: SandboxCapabilitySnapshot, options: {
  credentialBrokerDatabase?: Db; credentialBrokerOrigin?: string | null;
  resolveCredentialBrokerBindings?: (policy: SandboxPolicyCompilation) => Promise<{ authorizedConnectionGrantHashes: Record<string,string>; bindings: ResolvedSandboxBrokerBinding[] }>;
}): SandboxCapabilitySnapshot {
  const hostDimensions = [...new Set(snapshot.credentialBindingDimensions.filter(dimension =>
    ["host","port","method","path","binary"].includes(dimension)))];
  const result = { ...snapshot, credentialBindingDimensions: hostDimensions };
  let origin: string | null=null;
  try { const url=new URL(options.credentialBrokerOrigin ?? "");
    if(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/") origin=url.origin;
  } catch { /* Incomplete current server configuration. */ }
  // Older snapshots without observed origins cannot authorize either profile.
  if(snapshot.evidenceKind !== "protected_host_report" || !origin || result.credentialBrokerProviderProfile?.origin !== origin) delete result.credentialBrokerProviderProfile;
  if(snapshot.evidenceKind !== "protected_host_report" || !origin || result.modelBrokerProviderProfile?.origin !== origin) delete result.modelBrokerProviderProfile;
  if(snapshot.evidenceKind !== "protected_host_report" || !result.credentialBrokerProviderProfile ||
      !["host","port","method","path"].every(dimension => hostDimensions.includes(dimension as typeof hostDimensions[number])) ||
      !options.credentialBrokerDatabase || typeof options.resolveCredentialBrokerBindings !== "function" || !origin) return result;
  try {
    const gateway=getAssignedMcpGateway(options.credentialBrokerDatabase);
    const enforcement=gateway.describeSandboxBrokerEnforcement(origin);
    if(enforcement?.protocol === "sandbox_exec_v1" && enforcement.origin === origin)
      result.credentialBindingDimensions=[...hostDimensions,...enforcement.dimensions];
  } catch { /* Missing canonical registered owner remains unsupported. */ }
  return result;
}

export function openShellBackend(options: {
  identity: SandboxIdentity; boundary: SandboxPolicy; bridge: OpenShellHostBridge;
  evidenceKind?: SandboxCapabilitySnapshot["evidenceKind"];
  prover: { executable: string; executableSha256: string };
  credentialBrokerOrigin?: string | null;
  credentialBrokerDatabase?: Db;
  resolveCredentialBrokerBindings?: (policy: SandboxPolicyCompilation) => Promise<{ authorizedConnectionGrantHashes: Record<string, string>; bindings: ResolvedSandboxBrokerBinding[] }>;
}): ExecutionSandboxBackend {
  const { bridge, identity } = options;
  let preparedEvidence: PreparedSandbox | null = null;
  function scope(input: SandboxIdentity) {
    if (nativeSha256(input) !== nativeSha256(identity)) throw forbidden("OpenShell bridge belongs to another immutable runtime scope");
  }
  // Extra operation arguments are deliberately excluded from the scope hash.
  function scoped(input: SandboxIdentity) { scope({ companyId: input.companyId, bindingId: input.bindingId, cellId: input.cellId, cellGeneration: input.cellGeneration, sandboxRef: input.sandboxRef }); }
  async function capabilities() {
    const raw = await bridge.capabilities(identity); if (!raw) return null;
    const parsed = sandboxCapabilitySnapshotSchema.safeParse(raw);
    if (!parsed.success) return null;
    const snapshot = parsed.data;
    if (snapshot.evidenceKind !== (options.evidenceKind ?? "local_fixture") || snapshot.backend !== "openshell" || snapshot.backendVersion !== "0.1.2" || new Date(snapshot.expiresAt) <= new Date() || new Date(snapshot.testedAt) > new Date()) return null;
    return composeOpenShellBrokerCapabilities(snapshot, options);
  }
  async function observed(input: SandboxIdentity & { nativeAdmissionCleanup?: SandboxAdmissionCleanup }) {
    scoped(input); const result = await bridge.inspect({ ...identity,
      ...(input.nativeAdmissionCleanup ? { nativeAdmissionCleanup: input.nativeAdmissionCleanup } : {}) });
    // Revocation/source withdrawal cannot block inspection of the exact
    // original admission during mandatory Stop containment. The retained
    // prepare receipt pins its image; the Host command validates live
    // epoch, generation and image before returning this observation.
    const caps = input.nativeAdmissionCleanup ? null : await capabilities();
    const expectedImage = caps?.sandboxImageDigest ?? preparedEvidence?.imageDigest;
    if (!expectedImage || result.generation !== identity.cellGeneration || result.imageDigest !== expectedImage) throw conflict("OpenShell image, generation or qualification changed");
    return result;
  }
  async function provisioning(input: SandboxProvisioningIntent) {
    if (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now())
      throw forbidden("An original unexpired provisioning deadline is required");
    let document: OpenShellPolicyDocument, policyHash: string, resourceLimits: Pick<SandboxPolicy["resources"], "cpuMillis" | "memoryBytes" | "diskBytes" | "pidsLimit">;
    let qualificationProbeFixture: SandboxQualificationProbeFixture | undefined;
    if (input.purpose === "qualification") {
      if (input.policy) throw forbidden("Qualification setup cannot accept an execution policy");
      const preflight = await capabilities();
      if (!preflight?.qualificationProbeFixture) throw forbidden("Protected qualification probe fixture is unavailable");
      qualificationProbeFixture = qualificationProbeFixtureSchema.parse(preflight.qualificationProbeFixture);
      const { fixtureHash, ...fixtureBody } = qualificationProbeFixture;
      if (nativeSha256(fixtureBody) !== fixtureHash ||
          qualificationProbeFixture.runAsUser !== String(options.boundary.process.uid) ||
          qualificationProbeFixture.runAsGroup !== String(options.boundary.process.uid))
        throw forbidden("Protected qualification fixture or process identity does not match the current controller boundary");
      const projected = projectOpenShellQualificationProbePolicy(qualificationProbeFixture);
      if (projected.unsupportedFeatures.length || !projected.document || !projected.documentHash)
        throw forbidden("OpenShell cannot represent the protected qualification fixture policy");
      document = projected.document;
      policyHash = projected.documentHash;
      resourceLimits = {
        cpuMillis: options.boundary.resources.cpuMillis,
        memoryBytes: options.boundary.resources.memoryBytes,
        diskBytes: options.boundary.resources.diskBytes,
        pidsLimit: options.boundary.resources.pidsLimit,
      };
    } else {
      const compilation = input.policy;
      if (!compilation || compilation.proverResult !== "pass" || compilation.boundaryPolicyHash !== nativeSha256(options.boundary))
        throw forbidden("Admission provisioning requires the exact passing controller compilation");
      const projected = projectOpenShellPolicy(compilation.compiledPolicy, compilation.modelBrokerEndpoint, compilation.credentialBrokerEndpoints);
      if (projected.unsupportedFeatures.length) throw forbidden("OpenShell cannot enforce the compiled admission policy");
      document = projected.document;
      policyHash = nativeSha256(compilation);
      resourceLimits = {
        cpuMillis: compilation.compiledPolicy.resources.cpuMillis,
        memoryBytes: compilation.compiledPolicy.resources.memoryBytes,
        diskBytes: compilation.compiledPolicy.resources.diskBytes,
        pidsLimit: compilation.compiledPolicy.resources.pidsLimit,
      };
    }
    return { purpose: input.purpose, operationKey: input.operationKey, bindingVersion: input.bindingVersion, expiresAt: input.expiresAt, policyHash, document, resourceLimits,
      ...(qualificationProbeFixture ? { probeFixtureHash: qualificationProbeFixture.fixtureHash, qualificationProbeFixture } : {}) };
  }
  async function boundaryProof(candidate: OpenShellPolicyDocument, modelBrokerEndpoint?: SandboxPolicyCompilation["modelBrokerEndpoint"], credentialBrokerEndpoints?: SandboxPolicyCompilation["credentialBrokerEndpoints"]) {
    const boundary = projectOpenShellPolicy(options.boundary, modelBrokerEndpoint, credentialBrokerEndpoints);
    if (boundary.unsupportedFeatures.length) throw conflict("OpenShell alone cannot enforce the configured maximum boundary", { code: "sandbox_projection_unsupported", unsupportedFeatures: boundary.unsupportedFeatures });
    const effective = await bridge.effectivePolicy(identity);
    const proof = await checkOpenShellBoundary({ ...options.prover, candidate: effective, boundary: boundary.document });
    if (proof.result !== "within_boundary" || ["filesystem", "network_l4", "network_rest", "process", "landlock"].some(domain => !proof.coveredDomains.includes(domain))) throw conflict("OpenShell effective policy did not earn a complete boundary proof", { code: "sandbox_boundary_unproven", result: proof.result, reasonCode: proof.reasonCode });
    const runProof = await checkOpenShellBoundary({ ...options.prover, candidate: effective, boundary: candidate });
    if (runProof.result !== "within_boundary" || ["filesystem", "network_l4", "network_rest", "process", "landlock"].some(domain => !runProof.coveredDomains.includes(domain))) throw conflict("Provider composition widened the run's requested authority", { code: "sandbox_candidate_unproven", result: runProof.result, reasonCode: runProof.reasonCode });
    return { boundary: proof, candidate: runProof };
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
    prepareSandbox: async (input, intent) => {
      scoped(input); const intentValue = intent ? await provisioning(intent) : undefined;
      const rawPrepared = await bridge.prepare(identity, intentValue), caps = await capabilities();
      const prepared = rawPrepared;
      if (prepared.requiresRecreate) return prepared;
      const scopeMatches = prepared.companyId === identity.companyId && prepared.cellId === identity.cellId && prepared.bindingId === identity.bindingId && prepared.cellGeneration === identity.cellGeneration && prepared.sandboxRef === identity.sandboxRef;
      if (!scopeMatches || (caps && prepared.imageDigest !== caps.sandboxImageDigest) ||
        (caps && prepared.backendVersion !== caps.backendVersion) ||
        (!caps && !(intent?.purpose === "qualification" && prepared.sandboxId && prepared.containerId && prepared.provisioningHash)))
        throw conflict("OpenShell preparation does not match the qualified native runtime");
      if (intentValue?.purpose === "qualification") {
        const target = caps?.qualificationTarget;
        const targetHashValid = target ? nativeSha256((({ targetHash: _targetHash, ...base }) => base)(target)) === target.targetHash : false;
        const exactReceipt = Boolean(target && intentValue.probeFixtureHash &&
          target.companyId === identity.companyId && target.bindingId === identity.bindingId &&
          target.cellId === identity.cellId && target.cellGeneration === identity.cellGeneration &&
          target.sandboxRef === identity.sandboxRef && target.phase === "Ready" &&
          target.bindingVersion === intentValue.bindingVersion && target.sandboxId === prepared.sandboxId &&
          target.containerId === prepared.containerId && target.hostEpoch === prepared.hostEpoch &&
          target.imageDigest === prepared.imageDigest && target.provisioningHash === prepared.provisioningHash &&
          target.policyHash === intentValue.policyHash && target.probePolicyHash === nativeSha256(intentValue.document) &&
          target.probeFixtureHash === intentValue.probeFixtureHash &&
          nativeSha256(target.resourceLimits) === nativeSha256(intentValue.resourceLimits) &&
          prepared.bindingVersion === intentValue.bindingVersion && prepared.policyHash === intentValue.policyHash &&
          prepared.probePolicyHash === nativeSha256(intentValue.document) &&
          nativeSha256(prepared.resourceLimits ?? null) === nativeSha256(intentValue.resourceLimits) && targetHashValid);
        if (!exactReceipt) throw conflict("OpenShell qualification preparation lacks an exact protected target receipt", { code: "sandbox_qualification_target_mismatch" });
      }
      preparedEvidence = prepared;
      return prepared;
    },
    applyPolicy: async input => {
      scoped(input);
      if (!Number.isFinite(Date.parse(input.expiresAt)) || new Date(input.expiresAt) <= new Date()) throw forbidden("Original unexpired execution deadline is required before policy application");
      if (input.policy.proverResult !== "pass" || input.policy.boundaryPolicyHash !== nativeSha256(options.boundary)) throw conflict("An unchanged authoritative boundary and passing compilation are required");
      const currentCaps = await capabilities();
      const broker = input.policy.compiledPolicy.credentials.mode === "brokered" ? await options.resolveCredentialBrokerBindings?.(input.policy) : undefined;
      const freshCompilation = compileSandboxPolicy({ boundary: options.boundary, candidate: input.policy.compiledPolicy, capabilities: currentCaps, authorizedConnectionGrantHashes: broker?.authorizedConnectionGrantHashes ?? {}, credentialBrokerOrigin: options.credentialBrokerOrigin, credentialBrokerBindings: broker?.bindings, sourcePolicyRefs: input.policy.sourcePolicyRefs });
      if (freshCompilation.proverResult !== "pass" || nativeSha256(freshCompilation.modelBrokerEndpoint ?? null) !== nativeSha256(input.policy.modelBrokerEndpoint ?? null) || nativeSha256(freshCompilation.credentialBrokerEndpoints ?? null) !== nativeSha256(input.policy.credentialBrokerEndpoints ?? null) || freshCompilation.staticPolicyFingerprint !== input.policy.staticPolicyFingerprint) throw conflict("OpenShell enforcement qualification changed", { code: "sandbox_current_controls_required" });
      const projection = projectOpenShellPolicy(input.policy.compiledPolicy, input.policy.modelBrokerEndpoint, input.policy.credentialBrokerEndpoints);
      if (projection.unsupportedFeatures.length) return { applied: false, requiresRecreate: false, observedPolicyHash: null, unsupportedFeatures: projection.unsupportedFeatures };
      const current = await observed(input);
      if (input.currentStaticFingerprint && input.currentStaticFingerprint !== input.policy.staticPolicyFingerprint) return { applied: false, requiresRecreate: true, observedPolicyHash: null, unsupportedFeatures: [] };
      if (current.state === "running") throw conflict("Stop the workload before its first policy application");
      const boundary = projectOpenShellPolicy(options.boundary, input.policy.modelBrokerEndpoint, input.policy.credentialBrokerEndpoints);
      if (boundary.unsupportedFeatures.length) return { applied: false, requiresRecreate: false, observedPolicyHash: null, unsupportedFeatures: boundary.unsupportedFeatures };
      const requestedProof = await checkOpenShellBoundary({ ...options.prover, candidate: projection.document, boundary: boundary.document });
      if (requestedProof.result !== "within_boundary") return { applied: false, requiresRecreate: false, observedPolicyHash: null, unsupportedFeatures: [`boundary:${requestedProof.result}`] };
      const policyHash = nativeSha256(input.policy);
      const brokerBinaries = broker?.bindings.map(binding => binding.binary) ?? [];
      const exactCredentialBinary = brokerBinaries.length > 0 && brokerBinaries.every(binary => binary !== null) &&
        new Set(brokerBinaries).size === 1;
      const credentialProviderProfile = exactCredentialBinary && currentCaps?.credentialBrokerProviderProfile
        ? { id: currentCaps.credentialBrokerProviderProfile.id, hash: currentCaps.credentialBrokerProviderProfile.hash,
            binaries: [...(currentCaps.credentialBrokerProviderProfile.binaries ?? [])] }
        : undefined;
      const receipt = await bridge.apply({ ...identity, document: projection.document, policyHash, expiresAt: input.expiresAt,
        idempotencyKey: input.idempotencyKey,
        resourceLimits: { cpuMillis: input.policy.compiledPolicy.resources.cpuMillis,
          memoryBytes: input.policy.compiledPolicy.resources.memoryBytes,
          diskBytes: input.policy.compiledPolicy.resources.diskBytes,
          pidsLimit: input.policy.compiledPolicy.resources.pidsLimit },
        ...(credentialProviderProfile ? { credentialProviderProfile } : {}) });
      if (receipt.requiresRecreate) return { applied: false, requiresRecreate: true, observedPolicyHash: null, unsupportedFeatures: [] };
      if (!receipt.applied || receipt.policyHash !== policyHash) throw conflict("OpenShell did not observe the exact requested policy");
      try {
        await boundaryProof(projection.document, input.policy.modelBrokerEndpoint, input.policy.credentialBrokerEndpoints);
        const after = await observed(input);
        if (!after.controlsHealthy || after.policyHash !== policyHash) throw conflict("OpenShell policy application has not been physically observed");
      } catch (error) { await contain(policyHash); throw error; }
      return { applied: true, requiresRecreate: false, observedPolicyHash: policyHash, unsupportedFeatures: [] };
    },
    startWorkload: async input => {
      scoped(input);
      if (input.policy.proverResult !== "pass" || input.policy.boundaryPolicyHash !== nativeSha256(options.boundary) || !Number.isFinite(Date.parse(input.expiresAt)) || new Date(input.expiresAt) <= new Date()) throw forbidden("Current policy and original unexpired execution deadline are required");
      const currentCaps = await capabilities();
      const broker = input.policy.compiledPolicy.credentials.mode === "brokered" ? await options.resolveCredentialBrokerBindings?.(input.policy) : undefined;
      const freshCompilation = compileSandboxPolicy({ boundary: options.boundary, candidate: input.policy.compiledPolicy, capabilities: currentCaps, authorizedConnectionGrantHashes: broker?.authorizedConnectionGrantHashes ?? {}, credentialBrokerOrigin: options.credentialBrokerOrigin, credentialBrokerBindings: broker?.bindings, sourcePolicyRefs: input.policy.sourcePolicyRefs });
      if (freshCompilation.proverResult !== "pass" || nativeSha256(freshCompilation.modelBrokerEndpoint ?? null) !== nativeSha256(input.policy.modelBrokerEndpoint ?? null) || nativeSha256(freshCompilation.credentialBrokerEndpoints ?? null) !== nativeSha256(input.policy.credentialBrokerEndpoints ?? null) || freshCompilation.staticPolicyFingerprint !== input.policy.staticPolicyFingerprint) throw conflict("OpenShell enforcement qualification changed", { code: "sandbox_current_controls_required" });
      const projection = projectOpenShellPolicy(input.policy.compiledPolicy, input.policy.modelBrokerEndpoint, input.policy.credentialBrokerEndpoints);
      if (projection.unsupportedFeatures.length) throw forbidden("OpenShell cannot enforce every requested control");
      const current = await observed(input), policyHash = nativeSha256(input.policy);
      if (!current.controlsHealthy || current.policyHash !== policyHash || !["ready", "stopped", "running"].includes(current.state)) throw conflict("Current observed policy is required before workload admission");
      try { await boundaryProof(projection.document, input.policy.modelBrokerEndpoint, input.policy.credentialBrokerEndpoints); } catch (error) { await contain(policyHash); throw error; }
      return bridge.start({ ...identity, expiresAt: input.expiresAt, policyHash, idempotencyKey: input.idempotencyKey });
    },
    inspectWorkload: observed,
    stopWorkload: async input => {
      scoped(input); let revocationFailed = false;
      try { await bridge.revokeProviders(identity); } catch { revocationFailed = true; }
      const result = await bridge.stop({ ...identity, idempotencyKey: input.idempotencyKey,
        ...(input.nativeAdmissionCleanup ? { nativeAdmissionCleanup: input.nativeAdmissionCleanup } : {}) });
      if (revocationFailed && !input.nativeAdmissionCleanup) throw conflict("Native Stop requested; provider revocation requires reconciliation", { code: "sandbox_revocation_pending", operationId: result.operationId });
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
