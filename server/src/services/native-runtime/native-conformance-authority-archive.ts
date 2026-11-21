import { createHash } from "node:crypto";
import { NATIVE_OPENCODE_CONFORMANCE_CONTINUATION_KINDS } from "../orchestration/native-opencode-conformance-source.js";

/**
 * Ephemeral, server-owned evidence that one hidden `provider_conformance` Run
 * of a probe that resumes its presence's retained provider session passed
 * every condition of a cold lease handoff (CONF15 A2, decision C; extended to
 * every resuming probe kind by CONF15-P6). The Native session executor records
 * it only after `verifyNativeColdLeaseHandoff` accepted the handoff and the
 * controller moved the prior Run's control-plane identity aside; RuntimeControl
 * reads it to admit exactly one fixed harness-state command: moving the prior
 * Run's suspended remote runner state into its authority-epoch archive.
 *
 * It holds no credential, grant, token or durable authority, is never
 * persisted, and fails closed after a restart or expiry (no entry, no match).
 * The probe kind is bound into the grant: only a resuming kind is recorded or
 * matched, and the executor uses a grant only for its own probe kind.
 */
export type NativeConformanceAuthorityArchiveProbeKind = "resume" | "peer_write" | "isolation_read" | "cancel";

/** CONF15-P6: exactly the probe kinds whose turn resumes the presence's
 * retained provider session (the probe definitions' continuation kinds):
 * `resume`, `isolation_read` and `cancel` continue the primary session and
 * `peer_write` the peer session. `start` and `peer_unseen` open fresh
 * sessions, so no cold handoff precedes them and they never get a grant. */
export function nativeConformanceAuthorityArchiveProbeKind(kind: unknown): kind is NativeConformanceAuthorityArchiveProbeKind {
  return typeof kind === "string" && (NATIVE_OPENCODE_CONFORMANCE_CONTINUATION_KINDS as ReadonlySet<string>).has(kind);
}

export type NativeConformanceAuthorityArchiveGrant = Readonly<{
  companyId: string;
  runId: string;
  probeKind: NativeConformanceAuthorityArchiveProbeKind;
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
  if (!nativeConformanceAuthorityArchiveProbeKind(grant.probeKind) || !/^[0-9a-f]{24}$/.test(grant.archiveKey) ||
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

type NativeColdHandoffPriorIdentity = Readonly<{
  runId: string; environmentLeaseId: string; runnerInstanceId: string; normalizedSessionId: string;
}>;

/** The grant a verified cold lease handoff records for this hidden probe Run,
 * or null when none applies: not the hidden conformance lane, no verified
 * handoff, a probe kind that does not resume a retained session, or a target
 * that is not the Sandbox lease the verified handoff names as current. The
 * archive key is derived from the prior identity the controller itself
 * archived, the way the transport derives its authority-epoch directory; an
 * archived identity that is not exactly the verified prior one throws. */
export function nativeConformanceColdHandoffArchiveGrant(input: {
  providerConformanceProbe: boolean;
  probeKind: string | undefined;
  remoteTarget: Readonly<{ transport: string; leaseId?: string | null; remoteCwd: string }> | null | undefined;
  companyId: string;
  runId: string;
  normalizedSessionId: string;
  handoff: Readonly<{ currentEnvironmentLeaseId: string; evidenceDigest: string;
    priorIdentity: NativeColdHandoffPriorIdentity }> | null;
  readArchivedIdentity: () => Record<string, unknown>;
}): Omit<NativeConformanceAuthorityArchiveGrant, "expiresAtMs"> | null {
  const { handoff, remoteTarget, probeKind } = input;
  if (!input.providerConformanceProbe || !handoff || !nativeConformanceAuthorityArchiveProbeKind(probeKind) ||
    remoteTarget?.transport !== "sandbox" || remoteTarget.leaseId !== handoff.currentEnvironmentLeaseId) return null;
  const archived = input.readArchivedIdentity();
  if (archived.runId !== handoff.priorIdentity.runId ||
    archived.environmentLeaseId !== handoff.priorIdentity.environmentLeaseId ||
    archived.runnerInstanceId !== handoff.priorIdentity.runnerInstanceId ||
    archived.normalizedSessionId !== handoff.priorIdentity.normalizedSessionId)
    throw new Error("native_runner_cold_lease_handoff_unproven");
  return { companyId: input.companyId, runId: input.runId, probeKind,
    normalizedSessionId: input.normalizedSessionId, taskRoot: remoteTarget.remoteCwd,
    environmentLeaseId: handoff.currentEnvironmentLeaseId, priorRunId: handoff.priorIdentity.runId,
    archiveKey: createHash("sha256").update(JSON.stringify(archived)).digest("hex").slice(0, 24),
    evidenceDigest: handoff.evidenceDigest };
}

/** The recorded grant the executor may send its one archive under, or null
 * (no grant: the existing non-conformance route). A grant of another probe
 * kind, archive key or task root never authorizes this archive; it throws. */
export function nativeConformanceAuthorityArchiveGrantForUse(
  grant: NativeConformanceAuthorityArchiveGrant | null,
  use: Readonly<{ probeKind: string | undefined; archiveKey: string; taskRoot: string | undefined }>,
): NativeConformanceAuthorityArchiveGrant | null {
  if (!grant) return null;
  if (grant.probeKind !== use.probeKind || grant.archiveKey !== use.archiveKey || grant.taskRoot !== use.taskRoot)
    throw new Error("native_runner_cold_lease_handoff_unproven");
  return grant;
}
