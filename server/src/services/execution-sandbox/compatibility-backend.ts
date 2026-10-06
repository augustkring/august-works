import { conflict, forbidden } from "../../errors.js";
import type { ExecutionSandboxBackend, SandboxIdentity } from "./backend.js";

/** Reuses V6 lifecycle operations. Its capability description deliberately
 * excludes fine-grained controls that the existing cell container does not
 * implement. A command acknowledgement is not boundary qualification. */
export function existingCellContainerBackend(port: {
  inspect(identity: SandboxIdentity): Promise<{ generation: string; imageDigest: string; state: "ready" | "running" | "stopped" | "failed" | "unknown"; backendVersion: string }>;
  stop(identity: SandboxIdentity, idempotencyKey: string): Promise<{ operationId: string }>;
  destroy(identity: SandboxIdentity, idempotencyKey: string): Promise<{ operationId: string }>;
}): ExecutionSandboxBackend {
  async function inspect(identity: SandboxIdentity) { const result = await port.inspect(identity); if (result.generation !== identity.cellGeneration) throw conflict("Native cell generation changed"); return result; }
  return {
    backend: "existing_cell_container", evidenceKind: "local_fixture",
    capabilities: async () => null,
    prepareSandbox: async identity => { const result = await inspect(identity); return { ...identity, backendVersion: result.backendVersion, imageDigest: result.imageDigest }; },
    applyPolicy: async input => {
      await inspect(input);
      return { applied: false, requiresRecreate: Boolean(input.currentStaticFingerprint && input.currentStaticFingerprint !== input.policy.staticPolicyFingerprint), observedPolicyHash: null, unsupportedFeatures: ["fine_grained_policy_not_supported_by_v6_cell"] };
    },
    startWorkload: async () => { throw forbidden("This backend cannot enforce the requested V7 sandbox policy; use qualified enforcement before starting"); },
    inspectWorkload: async identity => { const result = await inspect(identity); return { state: result.state, policyHash: null, imageDigest: result.imageDigest, generation: result.generation, controlsHealthy: false }; },
    stopWorkload: async input => { await inspect(input); return port.stop(input, input.idempotencyKey); },
    destroySandbox: async input => { await inspect(input); return port.destroy(input, input.idempotencyKey); },
    probeBoundary: async () => ({ verdict: "unsupported", observationHash: null }),
  };
}
