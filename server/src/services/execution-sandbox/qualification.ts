import {
  SANDBOX_CONTROLS,
  sandboxCapabilitySnapshotSchema,
  type SandboxCapabilitySnapshot,
} from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import {
  sandboxProbeCases,
  type ExecutionSandboxBackend,
  type SandboxIdentity,
} from "./backend.js";

/** Positive and negative observations come from a registered backend, never
 * request-body booleans. Unsupported cases cannot earn an assurance control. */
export async function runSandboxQualification(
  backend: ExecutionSandboxBackend,
  identity: SandboxIdentity,
  now = new Date(),
  boundaryPolicyHash = "0".repeat(64),
  requiredControls: readonly string[] = SANDBOX_CONTROLS,
) {
  const started = performance.now();
  const clock = () => new Date(now.getTime() + performance.now() - started);
  const readCapabilities = async () => {
    const parsed = sandboxCapabilitySnapshotSchema.safeParse(
      await backend.capabilities(),
    );
    if (!parsed.success) return null;
    const value = parsed.data,
      current = clock();
    if (
      value.backend !== backend.backend ||
      value.evidenceKind !== backend.evidenceKind ||
      new Date(value.testedAt) > current ||
      new Date(value.expiresAt) <= current ||
      new Date(value.expiresAt) <= new Date(value.testedAt)
    )
      return null;
    return value;
  };
  const declared = await readCapabilities();
  const results: Array<{
    caseId: string;
    control: string;
    verdict: "pass" | "fail" | "unsupported";
    observationHash: string | null;
    contractHash: string;
  }> = [];
  const probeCases = sandboxProbeCases(boundaryPolicyHash, requiredControls);
  for (const test of probeCases) {
    try {
      const result = await backend.probeBoundary({ ...identity, test });
      const contractMatches = result.contractHash === test.contractHash;
      results.push({
        caseId: test.caseId,
        control: test.control,
        verdict: !contractMatches ? "unsupported" : result.verdict === "pass" &&
          !result.observationHash?.match(/^[a-f0-9]{64}$/)
            ? "unsupported"
            : result.verdict,
        observationHash: result.observationHash,
        contractHash: test.contractHash,
      });
    } catch {
      results.push({
        caseId: test.caseId,
        control: test.control,
        verdict: "unsupported",
        observationHash: null,
        contractHash: test.contractHash,
      });
    }
  }
  // A long probe sequence must not renew an expired host attestation or adopt
  // another image/kernel/credential epoch halfway through qualification.
  const current = await readCapabilities(),
    completedAt = clock();
  const unchanged = Boolean(
    declared && current && new Date(declared.expiresAt) > completedAt &&
      new Date(current.expiresAt) > completedAt &&
      // Reports can refresh observation timestamps without changing their
      // target evidence. Keep the original expiry and compare every other field.
      nativeSha256({ ...declared, testedAt: null, expiresAt: null }) ===
        nativeSha256({ ...current, testedAt: null, expiresAt: null }),
  );
  const exceptions = results
    .filter((r) => r.verdict !== "pass")
    .map((r) => `${r.caseId}:${r.verdict}`);
  if (!unchanged) exceptions.push("capability_snapshot_changed_or_expired");
  if (declared)
  for (const control of requiredControls)
      if (!declared[control as keyof SandboxCapabilitySnapshot]) exceptions.push(`${control}:not_declared`);
  const status = results.some((r) => r.verdict === "fail")
    ? "failed"
    : !unchanged || exceptions.length
      ? "inconclusive"
      : "passed";
  const reportHash = nativeSha256({
    suiteVersion: "aw-v7-boundary-2",
    boundaryPolicyHash,
    identity,
    backend: backend.backend,
    backendVersion: declared?.backendVersion ?? null,
    kernel: declared?.hostKernelVersion ?? null,
    image: declared?.sandboxImageDigest ?? null,
    evidenceKind: backend.evidenceKind,
    declared,
    current,
    status,
    exceptions,
    results,
  });
  const capabilities: SandboxCapabilitySnapshot | null =
    unchanged && declared && current
      ? {
          ...declared,
          testedAt: completedAt.toISOString(),
          expiresAt: new Date(
            Math.min(
              new Date(declared.expiresAt).getTime(),
              new Date(current.expiresAt).getTime(),
              completedAt.getTime() + 86_400_000,
            ),
          ).toISOString(),
          qualificationHash: reportHash,
        }
      : null;
  if (capabilities && declared)
    for (const control of SANDBOX_CONTROLS)
      capabilities[control] =
        declared[control] &&
        probeCases.filter(r => r.control === control).length > 0 &&
        results
          .filter((r) => r.control === control)
          .every((r) => r.verdict === "pass");
  return {
    suiteVersion: "aw-v7-boundary-2",
    status: status as "passed" | "failed" | "inconclusive",
    capabilities,
    results,
    exceptions,
    reportHash,
  };
}
