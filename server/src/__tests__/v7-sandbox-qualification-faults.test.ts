import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SANDBOX_CONTROLS,
  type SandboxCapabilitySnapshot,
} from "@paperclipai/shared";
import type { ExecutionSandboxBackend } from "../services/execution-sandbox/backend.js";
import { runSandboxQualification } from "../services/execution-sandbox/qualification.js";

const now = new Date("2026-10-05T12:00:00Z");
const identity = {
  companyId: "fixture-company",
  bindingId: "fixture-binding",
  cellId: "fixture-cell",
  cellGeneration: "1",
  sandboxRef: "fixture-only",
};
function fixture() {
  let elapsed = 0,
    probes = 0;
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const snapshot: SandboxCapabilitySnapshot = {
    filesystemPolicy: true,
    processPrivilegePolicy: true,
    syscallPolicy: true,
    networkDestinationPolicy: true,
    networkLayer7Policy: true,
    credentialBrokering: true,
    resourceLimits: true,
    forceStop: true,
    backend: "openshell",
    backendVersion: "0.1.2",
    hostKernelVersion: "fixture-only",
    sandboxImageDigest: `fixture.invalid/sandbox@sha256:${"a".repeat(64)}`,
    filesystemEnforcementMode: "hard_requirement",
    staticPolicyRequiresRecreate: true,
    dynamicNetworkPolicy: true,
    policyProverBoundaryCheck: true,
    policyProverCoverage: [...SANDBOX_CONTROLS],
    credentialBindingDimensions: [
      "company",
      "presence",
      "host",
      "port",
      "method",
      "path",
      "binary",
      "expiry",
      "revocation",
    ],
    testedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60000).toISOString(),
    qualificationHash: "a".repeat(64),
    evidenceKind: "local_fixture",
  };
  const backend = {
    backend: "openshell",
    evidenceKind: "local_fixture",
    capabilities: async () => structuredClone(snapshot),
    probeBoundary: async () => {
      probes++;
      return { verdict: "pass", observationHash: "b".repeat(64) };
    },
  } as ExecutionSandboxBackend;
  return {
    backend,
    snapshot,
    advance: (ms: number) => {
      elapsed += ms;
    },
    probes: () => probes,
  };
}
afterEach(() => vi.restoreAllMocks());
describe("sandbox qualification under compound host/probe faults (local fixtures)", () => {
  it("keeps the original expiry despite all eighteen passing observations", async () => {
    const f = fixture();
    const report = await runSandboxQualification(f.backend, identity, now);
    expect(report.status).toBe("passed");
    expect(f.probes()).toBe(18);
    expect(report.capabilities?.expiresAt).toBe(f.snapshot.expiresAt);
    expect(report.capabilities?.evidenceKind).toBe("local_fixture");
  });
  it("rejects expiry during a passing sequence instead of renewing it", async () => {
    const f = fixture(),
      probe = f.backend.probeBoundary;
    f.backend.probeBoundary = async (input) => {
      f.advance(5000);
      return probe(input);
    };
    const report = await runSandboxQualification(f.backend, identity, now);
    expect(report.status).toBe("inconclusive");
    expect(report.capabilities).toBeNull();
    expect(report.exceptions).toContain(
      "capability_snapshot_changed_or_expired",
    );
  });
  it.each(["image", "kernel", "credential epoch", "control"])(
    "rejects a changed %s halfway through passing observations",
    async (fault) => {
      const f = fixture(),
        probe = f.backend.probeBoundary;
      f.backend.probeBoundary = async (input) => {
        const result = await probe(input);
        if (f.probes() === 9) {
          if (fault === "image")
            f.snapshot.sandboxImageDigest = `fixture.invalid/sandbox@sha256:${"c".repeat(64)}`;
          if (fault === "kernel")
            f.snapshot.hostKernelVersion = "changed-kernel";
          if (fault === "credential epoch")
            f.snapshot.qualificationHash = "c".repeat(64);
          if (fault === "control") f.snapshot.forceStop = false;
        }
        return result;
      };
      const report = await runSandboxQualification(f.backend, identity, now);
      expect(report.status).toBe("inconclusive");
      expect(report.capabilities).toBeNull();
    },
  );
  it("refuses claimed provenance promotion and an undeclared required control", async () => {
    const f = fixture();
    f.snapshot.evidenceKind = "protected_host_report";
    expect(
      (await runSandboxQualification(f.backend, identity, now)).capabilities,
    ).toBeNull();
    f.snapshot.evidenceKind = "local_fixture";
    f.snapshot.credentialBrokering = false;
    const report = await runSandboxQualification(f.backend, identity, now);
    expect(report.status).toBe("inconclusive");
    expect(report.exceptions).toContain("credentialBrokering:not_declared");
  });
  it("retains a definite failure even when host attestation is lost afterwards", async () => {
    const f = fixture();
    f.backend.probeBoundary = async () => {
      f.advance(5000);
      return { verdict: "fail", observationHash: "b".repeat(64) };
    };
    const report = await runSandboxQualification(f.backend, identity, now);
    expect(report.status).toBe("failed");
    expect(report.capabilities).toBeNull();
    expect(report.exceptions).toContain("force_stop:fail");
  });
});
