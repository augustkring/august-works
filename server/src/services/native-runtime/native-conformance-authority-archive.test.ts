import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NATIVE_OPENCODE_CONFORMANCE_CONTINUATION_KINDS } from "../orchestration/native-opencode-conformance-source.js";
import {
  nativeConformanceAuthorityArchiveGrantForUse,
  nativeConformanceAuthorityArchiveProbeKind,
  nativeConformanceColdHandoffArchiveGrant,
  readNativeConformanceAuthorityArchiveGrant,
  recordNativeConformanceAuthorityArchiveGrant,
  revokeNativeConformanceAuthorityArchiveGrant,
} from "./native-conformance-authority-archive.js";

// CONF15-P6. Decision C's cold-handoff authority-archive grant, extended from
// the `resume` probe to every probe kind that resumes a retained provider
// session after a verified cold lease handoff, under the same conditions: a
// verified handoff, a server-recorded in-memory grant bound to the exact Run,
// probe kind, session, lease and archive key, and RuntimeControl's exact
// matcher (covered in `runtime/native-harness-state-owner.test.ts`).

const RESUMING = ["resume", "peer_write", "isolation_read", "cancel"] as const;
const FRESH = ["start", "peer_unseen"] as const;

const companyId = randomUUID();
const runId = randomUUID();
const priorRunId = randomUUID();
const sessionId = randomUUID();
const runnerInstanceId = randomUUID();
const priorLeaseId = randomUUID();
const currentLeaseId = randomUUID();
const taskRoot = "/workspace/conformance-task";
const priorIdentity = { runId: priorRunId, environmentLeaseId: priorLeaseId, runnerInstanceId, normalizedSessionId: sessionId };
const archivedIdentity = { ...priorIdentity, extra: "controller-recorded" };
const handoff = { currentEnvironmentLeaseId: currentLeaseId, evidenceDigest: "e".repeat(64), priorIdentity };
const remoteTarget = { kind: "remote", transport: "sandbox", leaseId: currentLeaseId, remoteCwd: taskRoot };
const archiveKey = createHash("sha256").update(JSON.stringify(archivedIdentity)).digest("hex").slice(0, 24);

type GrantInput = Parameters<typeof nativeConformanceColdHandoffArchiveGrant>[0];
const handoffGrant = (overrides: Partial<GrantInput> = {}) => nativeConformanceColdHandoffArchiveGrant({
  providerConformanceProbe: true, probeKind: "peer_write", remoteTarget, companyId, runId,
  normalizedSessionId: sessionId, handoff, readArchivedIdentity: () => archivedIdentity, ...overrides,
});

describe("conformance cold-handoff authority-archive grant (CONF15-P6)", () => {
  it("admits exactly the probe kinds that resume a retained provider session", () => {
    expect([...NATIVE_OPENCODE_CONFORMANCE_CONTINUATION_KINDS].sort()).toEqual([...RESUMING].sort());
    for (const kind of RESUMING) expect(nativeConformanceAuthorityArchiveProbeKind(kind)).toBe(true);
    for (const kind of [...FRESH, "Resume", "", undefined, null, 1]) expect(nativeConformanceAuthorityArchiveProbeKind(kind)).toBe(false);
  });

  it("records a grant after a verified handoff for every resuming probe kind, bound to that kind", () => {
    for (const probeKind of RESUMING) {
      expect(handoffGrant({ probeKind })).toEqual({ companyId, runId, probeKind, normalizedSessionId: sessionId, taskRoot,
        environmentLeaseId: currentLeaseId, priorRunId, archiveKey, evidenceDigest: "e".repeat(64) });
      const recorded = recordNativeConformanceAuthorityArchiveGrant(handoffGrant({ probeKind })!);
      try {
        expect(readNativeConformanceAuthorityArchiveGrant(companyId, runId)).toEqual(recorded);
        expect(recorded.probeKind).toBe(probeKind);
      } finally {
        revokeNativeConformanceAuthorityArchiveGrant(companyId, runId);
      }
    }
  });

  it("records no grant for a kind that does not resume, and refuses to record one", () => {
    let read = 0;
    for (const probeKind of [...FRESH, undefined]) {
      expect(handoffGrant({ probeKind, readArchivedIdentity: () => { read += 1; return archivedIdentity; } })).toBeNull();
    }
    expect(read).toBe(0);
    for (const probeKind of FRESH) {
      expect(() => recordNativeConformanceAuthorityArchiveGrant({ ...handoffGrant()!, probeKind: probeKind as "resume" }))
        .toThrow("native_runner_cold_lease_handoff_unproven");
    }
    expect(readNativeConformanceAuthorityArchiveGrant(companyId, runId)).toBeNull();
  });

  it("records no grant without a verified handoff, outside the hidden probe lane, or off its current Sandbox lease", () => {
    expect(handoffGrant({ handoff: null })).toBeNull();
    expect(handoffGrant({ handoff: null, remoteTarget: { ...remoteTarget, leaseId: undefined } })).toBeNull();
    expect(handoffGrant({ providerConformanceProbe: false })).toBeNull();
    expect(handoffGrant({ remoteTarget: null })).toBeNull();
    expect(handoffGrant({ remoteTarget: { ...remoteTarget, transport: "ssh" } })).toBeNull();
    expect(handoffGrant({ remoteTarget: { ...remoteTarget, leaseId: priorLeaseId } })).toBeNull();
    expect(handoffGrant({ remoteTarget: { ...remoteTarget, leaseId: null } })).toBeNull();
  });

  it("refuses an archived identity of the wrong session, Run, lease or runner", () => {
    for (const changed of [{ normalizedSessionId: randomUUID() }, { runId: randomUUID() }, { runId: runId },
      { environmentLeaseId: currentLeaseId }, { runnerInstanceId: randomUUID() }]) {
      expect(() => handoffGrant({ readArchivedIdentity: () => ({ ...archivedIdentity, ...changed }) }))
        .toThrow("native_runner_cold_lease_handoff_unproven");
    }
    expect(() => handoffGrant({ readArchivedIdentity: () => ({}) })).toThrow("native_runner_cold_lease_handoff_unproven");
    // A grant of the wrong session or for the prior Run is never recorded.
    expect(() => recordNativeConformanceAuthorityArchiveGrant({ ...handoffGrant()!, normalizedSessionId: "" }))
      .toThrow("native_runner_cold_lease_handoff_unproven");
    expect(() => recordNativeConformanceAuthorityArchiveGrant({ ...handoffGrant()!, priorRunId: runId }))
      .toThrow("native_runner_cold_lease_handoff_unproven");
  });

  it("lets the executor send its archive only under a grant of its own probe kind, key and task root", () => {
    const recorded = recordNativeConformanceAuthorityArchiveGrant(handoffGrant({ probeKind: "isolation_read" })!);
    try {
      const use = { probeKind: "isolation_read", archiveKey, taskRoot };
      expect(nativeConformanceAuthorityArchiveGrantForUse(recorded, use)).toBe(recorded);
      expect(nativeConformanceAuthorityArchiveGrantForUse(null, use)).toBeNull();
      // A grant for one probe kind never authorizes another.
      for (const probeKind of [...RESUMING.filter(kind => kind !== "isolation_read"), ...FRESH, undefined])
        expect(() => nativeConformanceAuthorityArchiveGrantForUse(recorded, { ...use, probeKind }))
          .toThrow("native_runner_cold_lease_handoff_unproven");
      expect(() => nativeConformanceAuthorityArchiveGrantForUse(recorded, { ...use, archiveKey: "f".repeat(24) }))
        .toThrow("native_runner_cold_lease_handoff_unproven");
      expect(() => nativeConformanceAuthorityArchiveGrantForUse(recorded, { ...use, taskRoot: "/workspace/other" }))
        .toThrow("native_runner_cold_lease_handoff_unproven");
      expect(() => nativeConformanceAuthorityArchiveGrantForUse(recorded, { ...use, taskRoot: undefined }))
        .toThrow("native_runner_cold_lease_handoff_unproven");
      // A grant is keyed by its own hidden Run; another probe Run reads none.
      expect(readNativeConformanceAuthorityArchiveGrant(companyId, randomUUID())).toBeNull();
      expect(readNativeConformanceAuthorityArchiveGrant(randomUUID(), runId)).toBeNull();
    } finally {
      revokeNativeConformanceAuthorityArchiveGrant(companyId, runId);
    }
  });
});
