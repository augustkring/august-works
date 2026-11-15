/**
 * Ephemeral, server-owned evidence that one hidden `provider_conformance` Run
 * of the `resume` probe passed every condition of a cold lease handoff (CONF15
 * A2, decision C). The Native session executor records it only after
 * `verifyNativeColdLeaseHandoff` accepted the handoff and the controller moved
 * the prior Run's control-plane identity aside; RuntimeControl reads it to
 * admit exactly one fixed harness-state command: moving the prior Run's
 * suspended remote runner state into its authority-epoch archive.
 *
 * It holds no credential, grant, token or durable authority, is never
 * persisted, and fails closed after a restart or expiry (no entry, no match).
 */
export type NativeConformanceAuthorityArchiveGrant = Readonly<{
  companyId: string;
  runId: string;
  probeKind: "resume";
  normalizedSessionId: string;
  taskRoot: string;
  environmentLeaseId: string;
  priorRunId: string;
  archiveKey: string;
  evidenceDigest: string;
  expiresAtMs: number;
}>;

const GRANT_TTL_MS = 10 * 60_000;
const grants = new Map<string, NativeConformanceAuthorityArchiveGrant>();
const grantKey = (companyId: string, runId: string) => `${companyId}\u0000${runId}`;

export function recordNativeConformanceAuthorityArchiveGrant(
  grant: Omit<NativeConformanceAuthorityArchiveGrant, "expiresAtMs">,
  nowMs = Date.now(),
): NativeConformanceAuthorityArchiveGrant {
  if (grant.probeKind !== "resume" || !/^[0-9a-f]{24}$/.test(grant.archiveKey) ||
    !/^[a-f0-9]{64}$/.test(grant.evidenceDigest) || grant.priorRunId === grant.runId ||
    !grant.companyId || !grant.runId || !grant.normalizedSessionId || !grant.taskRoot.startsWith("/") ||
    !grant.environmentLeaseId)
    throw new Error("native_runner_cold_lease_handoff_unproven");
  const recorded = Object.freeze({ ...grant, expiresAtMs: nowMs + GRANT_TTL_MS });
  grants.set(grantKey(grant.companyId, grant.runId), recorded);
  return recorded;
}

export function readNativeConformanceAuthorityArchiveGrant(
  companyId: string,
  runId: string,
  nowMs = Date.now(),
): NativeConformanceAuthorityArchiveGrant | null {
  const key = grantKey(companyId, runId);
  const grant = grants.get(key) ?? null;
  if (grant && grant.expiresAtMs <= nowMs) {
    grants.delete(key);
    return null;
  }
  return grant;
}

export function revokeNativeConformanceAuthorityArchiveGrant(companyId: string, runId: string): void {
  grants.delete(grantKey(companyId, runId));
}
