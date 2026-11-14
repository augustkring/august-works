import { nativeSha256 } from "../native-runtime/canonical.js";

const ROUTING_KEYS = [
  "provider", "model", "modelId", "modelName", "modelProfileId", "workerModelProfileId", "acpxAgent",
  "providerProfileRef", "providerBindingId", "transport", "baseUrl", "endpoint", "maxOutputTokens",
];
const MANAGED_MODEL_PROFILE_KEYS = ["modelProfileId", "workerModelProfileId"];

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Treat the whole adapter configuration as model routing state once it contains
 * a routing selector. Only route selectors are hashed: environment credentials,
 * working directories, setup repairs and unrelated adapter state remain owned by
 * their existing update/rollback paths. */
export function hasModelRoutingSnapshot(snapshot: unknown): boolean {
  const value = record(snapshot);
  const config = record(value.adapterConfig);
  const runtime = record(value.runtimeConfig);
  const managedProfile = MANAGED_MODEL_PROFILE_KEYS.some(key => Object.prototype.hasOwnProperty.call(config, key) ||
    Object.prototype.hasOwnProperty.call(runtime, key));
  return managedProfile || value.adapterType === "paperclip_runner" && config.provider === "aw_text_only" && typeof config.model === "string";
}

export function modelRoutingSnapshotHash(snapshot: unknown): string | null {
  if (!hasModelRoutingSnapshot(snapshot)) return null;
  const value = record(snapshot), config = record(value.adapterConfig), runtime = record(value.runtimeConfig);
  const selected = (source: Record<string, unknown>) => Object.fromEntries(ROUTING_KEYS
    .filter(key => Object.prototype.hasOwnProperty.call(source, key)).map(key => [key, source[key]]));
  return nativeSha256({ adapterType: value.adapterType ?? null, adapterRouting: selected(config),
    runtimeRouting: { ...selected(runtime), ...(Object.prototype.hasOwnProperty.call(runtime, "aiConnection") ? { aiConnection: runtime.aiConnection } : {}) } });
}

export function modelRoutingRollbackWouldChange(current: unknown, target: unknown): boolean {
  const currentHash = modelRoutingSnapshotHash(current);
  const targetHash = modelRoutingSnapshotHash(target);
  return currentHash !== targetHash;
}

export function modelQualificationProfileHash(profile: unknown): string {
  const { lifecycle: _lifecycle, ...qualification } = record(profile);
  return nativeSha256(qualification);
}

export function modelLifecycleHash(profile: unknown): string {
  return nativeSha256(record(profile).lifecycle ?? null);
}

export function compareModelMigrationBehavior(priorContent: unknown, candidateContent: unknown): { compatible: boolean; behaviorHash: string } {
  const normalize = (value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const { runtimeCandidateId: _candidateSelector, ...behavior } = value as Record<string, unknown>;
    return behavior;
  };
  const prior = normalize(priorContent), candidate = normalize(candidateContent);
  const behaviorHash = nativeSha256(candidate);
  return { compatible: nativeSha256(prior) === behaviorHash, behaviorHash };
}
