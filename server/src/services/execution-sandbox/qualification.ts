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
  type SandboxProbeCase,
} from "./backend.js";

export function sandboxQualificationCredentialFixtureValid(fixture: NonNullable<SandboxCapabilitySnapshot["qualificationCredentialFixture"]> | undefined) {
  if (!fixture) return true;
  const { fixtureHash, ...fixtureBase } = fixture;
  let originValid = false;
  try {
    const origin = new URL(fixture.origin);
    originValid = origin.protocol === "https:" && origin.origin === fixture.origin && origin.pathname === "/" &&
      !origin.search && !origin.hash && Number(origin.port || 443) === fixture.port;
  } catch { /* fail closed */ }
  return nativeSha256(fixtureBase) === fixtureHash &&
    nativeSha256({ caseId: "<caseId>", fixtureId: "<fixtureId>", nonce: "<nonce>" }) === fixture.argumentTemplateHash &&
    originValid;
}

/** Positive and negative observations come from a registered backend, never
 * request-body booleans. Unsupported cases cannot earn an assurance control. */
export async function runSandboxQualification(
  backend: ExecutionSandboxBackend,
  identity: SandboxIdentity,
  now = new Date(),
  boundaryPolicyHash = "0".repeat(64),
  requiredControls: readonly string[] = SANDBOX_CONTROLS,
  expectedProvisioning?: {
    bindingVersion: number; sandboxId: string; containerId: string; hostEpoch: number;
    imageDigest: string; provisioningHash: string; policyHash: string; probePolicyHash: string;
    resourceLimits: { cpuMillis: number; memoryBytes: number; diskBytes: number; pidsLimit: number };
  },
  issueCredentialProbe?: (input: {
    test: SandboxProbeCase;
    target: NonNullable<SandboxCapabilitySnapshot["qualificationTarget"]>;
  }) => Promise<{ commandId: string; capabilityToken: string; nonce: string } | null>,
  originalExpiry?: Date,
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
    if (readOriginalExpiry !== undefined && Date.parse(value.expiresAt) > readOriginalExpiry) {
      originalExpiryExceeded = true;
      return null;
    }
    if (
      value.backend !== backend.backend ||
      value.evidenceKind !== backend.evidenceKind ||
      new Date(value.testedAt) > current ||
      new Date(value.expiresAt) <= current ||
      new Date(value.expiresAt) <= new Date(value.testedAt)
    )
      return null;
    if (backend.evidenceKind === "protected_host_report") {
      const target = value.qualificationTarget;
      const credentialFixtureHashValid = sandboxQualificationCredentialFixtureValid(target?.qualificationCredentialFixture);
      const credentialFixtureMatches = nativeSha256(target?.qualificationCredentialFixture ?? null) ===
        nativeSha256(value.qualificationCredentialFixture ?? null);
      if (!target || target.companyId !== identity.companyId || target.bindingId !== identity.bindingId ||
        target.cellId !== identity.cellId || target.cellGeneration !== identity.cellGeneration ||
        target.sandboxRef !== identity.sandboxRef || target.imageDigest !== value.sandboxImageDigest ||
        target.hostKernelVersion !== value.hostKernelVersion || target.phase !== "Ready" ||
        !/^[a-f0-9]{64}$/.test(target.runtimeBinarySha256) || !/^[a-f0-9]{64}$/.test(target.openshellCliSha256) ||
        !/^[a-f0-9]{64}$/.test(target.dockerEngineIdHash) || !/^[a-f0-9]{64}$/.test(target.probeFixtureHash) || !credentialFixtureHashValid || !credentialFixtureMatches ||
        nativeSha256((({ targetHash: _targetHash, ...targetBase }) => targetBase)(target)) !== target.targetHash ||
        (expectedProvisioning && (target.bindingVersion !== expectedProvisioning.bindingVersion ||
          target.sandboxId !== expectedProvisioning.sandboxId || target.containerId !== expectedProvisioning.containerId ||
          target.hostEpoch !== expectedProvisioning.hostEpoch || target.imageDigest !== expectedProvisioning.imageDigest ||
          target.provisioningHash !== expectedProvisioning.provisioningHash || target.policyHash !== expectedProvisioning.policyHash ||
          target.probePolicyHash !== expectedProvisioning.probePolicyHash ||
          nativeSha256(target.resourceLimits) !== nativeSha256(expectedProvisioning.resourceLimits)))) return null;
    }
    return value;
  };
  let originalExpiryExceeded = false;
  const readOriginalExpiry = originalExpiry?.getTime();
  const declared = await readCapabilities();
  const results: Array<{
    caseId: string;
    control: string;
    verdict: "pass" | "fail" | "unsupported";
    observationHash: string | null;
    contractHash: string;
    targetQualificationHash: string | null;
  }> = [];
  const probeCases = sandboxProbeCases(boundaryPolicyHash, requiredControls);
  for (const test of probeCases) {
    if (!declared) {
      results.push({ caseId: test.caseId, control: test.control, verdict: "unsupported", observationHash: null,
        contractHash: test.contractHash, targetQualificationHash: null });
      continue;
    }
    try {
      let probe = test;
      if (test.control === "credentialBrokering" && backend.evidenceKind === "protected_host_report") {
        const target = declared?.qualificationTarget;
        const issued = target?.qualificationCredentialFixture && issueCredentialProbe ? await issueCredentialProbe({ test, target }).catch(() => null) : null;
        if (!issued) {
          results.push({ caseId: test.caseId, control: test.control, verdict: "unsupported", observationHash: null,
            contractHash: test.contractHash, targetQualificationHash: null });
          continue;
        }
        probe = { ...test, qualificationCredentialCapability: issued.capabilityToken, qualificationCommandId: issued.commandId,
          qualificationCredentialNonce: issued.nonce };
      }
      const result = await backend.probeBoundary({ ...identity, test: probe });
      const contractMatches = result.contractHash === test.contractHash;
      const targetMatches = backend.evidenceKind !== "protected_host_report" ||
        (Boolean(declared?.qualificationTarget) && result.targetQualificationHash === declared!.qualificationTarget!.targetHash);
      results.push({
        caseId: test.caseId,
        control: test.control,
        verdict: !contractMatches || !targetMatches ? "unsupported" : result.verdict === "pass" &&
          !result.observationHash?.match(/^[a-f0-9]{64}$/)
            ? "unsupported"
            : result.verdict,
        observationHash: result.observationHash,
        contractHash: test.contractHash,
        targetQualificationHash: result.targetQualificationHash ?? null,
      });
    } catch {
      results.push({
        caseId: test.caseId,
        control: test.control,
        verdict: "unsupported",
        observationHash: null,
        contractHash: test.contractHash,
        targetQualificationHash: null,
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
  if (originalExpiryExceeded) exceptions.push("qualification_original_expiry_exceeded");
  if (backend.evidenceKind === "protected_host_report" && !declared?.qualificationTarget)
    exceptions.push("protected_qualification_target_missing");
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
