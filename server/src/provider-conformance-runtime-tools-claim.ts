/**
 * Compact signed handoff from RuntimeControl to the model gateway. These IDs
 * are lookup keys, not proof: the gateway and RuntimeControl owners re-read
 * the canonical pending request, plan, profile, lease and signed Host start.
 */
export type ProviderConformanceRuntimeToolsBinding = Readonly<{
  qualificationGroupId: string;
  probeId: string;
  probeRunId: string;
  planId: string;
  profileId: string;
  dispatchNonce: string;
  authorityHash: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

export function parseProviderConformanceRuntimeToolsBinding(value: unknown): ProviderConformanceRuntimeToolsBinding | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const binding = value as Record<string, unknown>;
  const fields = ["qualificationGroupId", "probeId", "probeRunId", "planId", "profileId", "dispatchNonce", "authorityHash"];
  if (Object.keys(binding).length !== fields.length || fields.some(field => !Object.hasOwn(binding, field)) ||
      ![binding.qualificationGroupId, binding.probeId, binding.probeRunId, binding.planId,
        binding.profileId, binding.dispatchNonce].every(value => typeof value === "string" && UUID.test(value)) ||
      typeof binding.authorityHash !== "string" || !HASH.test(binding.authorityHash)) return null;
  return binding as unknown as ProviderConformanceRuntimeToolsBinding;
}

/** Conformance credentials are one-dispatch tokens, clipped by RuntimeControl. */
export function providerConformanceTokenExpiry(nowSeconds: number, currentDeadlineSeconds: number): number | null {
  if (!Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(currentDeadlineSeconds)) return null;
  const expiry = Math.min(nowSeconds + 60, currentDeadlineSeconds);
  return expiry > nowSeconds ? expiry : null;
}
