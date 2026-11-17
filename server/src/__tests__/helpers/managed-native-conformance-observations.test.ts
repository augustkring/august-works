import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { collectRetainedConformanceObservations, type NativeConformanceRetainedObservations } from "./managed-native-conformance-observations.js";

// Pure fixture collector unit. No database row, Host, lease or source authority
// is created; each fake Host only records what a real per-probe Host records.
function fakeProbeHost() {
  const records: NativeConformanceRetainedObservations = {
    nativeConformanceStartTupleObservations: [], softwareOnlyPolicyProofObservations: [], execFacts: [],
  };
  let closed = false;
  return {
    get closed() { return closed; },
    start(runId: string) {
      const tuple = { qualificationGroupId: randomUUID(), planId: randomUUID(), profileId: randomUUID(),
        probeId: randomUUID(), dispatchNonce: randomUUID(), authorityHash: "a".repeat(64) };
      records.nativeConformanceStartTupleObservations.push({ runId, tuple });
      records.softwareOnlyPolicyProofObservations.push({ stage: "requested", wrongMaximumRejected: true });
      records.execFacts.push({ providerPackImageProbe: true, exitCode: 0 });
      return tuple;
    },
    // Like the real Host: close ends the relay, not the recorded evidence.
    close() { closed = true; },
    conformanceObservations: () => records,
  };
}

describe("managed native conformance observation collector", () => {
  it("keeps every start tuple of retired per-probe Hosts across both presences", () => {
    const primaryRuns = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const peerRuns = [randomUUID(), randomUUID()];
    const owner = (runIds: string[]) => {
      // The prequalified Host is adopted by the first Run, so it is retained
      // twice by identity and must be read once.
      const hosts = runIds.map(() => fakeProbeHost());
      const retained = [hosts[0]!, ...hosts];
      const expected = runIds.map((runId, index) => ({ runId, tuple: hosts[index]!.start(runId) }));
      // Serial admission closes each predecessor before the successor Host.
      for (const host of hosts.slice(0, -1)) host.close();
      return { expected, hosts, scheduler: { conformanceObservations: () => collectRetainedConformanceObservations(retained) } };
    };
    const primary = owner(primaryRuns), peer = owner(peerRuns);
    peer.hosts.at(-1)!.close();
    const collected = collectRetainedConformanceObservations([primary.scheduler, peer.scheduler]);
    expect(collected.nativeConformanceStartTupleObservations).toHaveLength(6);
    expect(collected.nativeConformanceStartTupleObservations).toEqual([...primary.expected, ...peer.expected]);
    expect(collected.nativeConformanceStartTupleObservations.map(row => row.runId).sort())
      .toEqual([...primaryRuns, ...peerRuns].sort());
    expect(collected.softwareOnlyPolicyProofObservations).toHaveLength(6);
    expect(collected.execFacts).toHaveLength(6);
    expect([...primary.hosts, ...peer.hosts].filter(host => !host.closed)).toHaveLength(1);
  });

  it("copies rows and leaves a duplicated or missing start visible to exact counts", () => {
    const duplicated = fakeProbeHost();
    const runId = randomUUID();
    duplicated.start(runId); duplicated.start(runId);
    const silent = fakeProbeHost();
    const collected = collectRetainedConformanceObservations([duplicated, silent, null, undefined, {}]);
    expect(collected.nativeConformanceStartTupleObservations.map(row => row.runId)).toEqual([runId, runId]);
    collected.nativeConformanceStartTupleObservations[0]!.tuple.dispatchNonce = "mutated";
    expect(duplicated.conformanceObservations().nativeConformanceStartTupleObservations[0]!.tuple.dispatchNonce)
      .not.toBe("mutated");
    expect(collectRetainedConformanceObservations([])).toEqual({
      nativeConformanceStartTupleObservations: [], softwareOnlyPolicyProofObservations: [], execFacts: [],
    });
  });
});
