import {
  SPECIALIST_KEYS,
  SPECIALIST_CANDIDATES,
  specialistCompletionContract,
  type SpecialistKey,
  type PackageRelease,
} from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
/** Narrow automatic updates: every execution-relevant field and pin unchanged. */
export function packageChangeIsMaterial(
  before: PackageRelease,
  after: PackageRelease,
) {
  return (
    nativeSha256({
      manifest: before.manifest,
      components: before.components,
    }) !==
    nativeSha256({ manifest: after.manifest, components: after.components })
  );
}
export function packageReleaseBlockers(
  release: PackageRelease,
  now = new Date(),
) {
  const result: string[] = [];
  if (
    new Date(release.releaseEvidence.evaluatedAt) > now ||
    new Date(release.releaseEvidence.expiresAt) <= now
  )
    result.push("Release qualification is expired or dated in the future");
  if (release.releaseEvidence.unresolvedCritical.length)
    result.push("Critical release findings remain unresolved");
  if (release.manifest.audience === "customer") {
    if (SPECIALIST_KEYS.includes(release.packageKey as SpecialistKey)) {
      const key = release.packageKey as SpecialistKey,
        candidate = SPECIALIST_CANDIDATES[key];
      if (
        release.manifest.purpose !== candidate.manifest.purpose ||
        release.manifest.role !== candidate.manifest.role ||
        release.manifest.maximumRisk !== "C1" ||
        release.manifest.actionClasses.some((a) => a !== "internal_draft")
      )
        result.push(
          "This specialist release exceeds its evaluated draft contract",
        );
      for (const type of ["role_pack", "skill", "playbook"] as const)
        if (!release.components.some((c) => c.type === type && c.required))
          result.push(`Specialist release requires a native ${type} component`);
      const suiteHash = nativeSha256(
        candidate.cases.map((c) => ({
          caseKey: c.key,
          contract: specialistCompletionContract(key, c.key),
        })),
      );
      if (
        !release.components.some(
          (c) =>
            c.type === "eval_suite" &&
            c.required &&
            c.contentHash === suiteHash,
        )
      )
        result.push(
          "Specialist release must pin the declared native case-contract suite",
        );
    }
    for (const dimension of [
      "sbom",
      "scan",
      "evaluations",
      "protectedHoldout",
      "customerDemand",
    ] as const)
      if (!release.releaseEvidence[dimension])
        result.push(`Customer release requires separate ${dimension} evidence`);
    if (
      release.manifest.sandboxAssurance === "qualified_managed" &&
      !release.releaseEvidence.sandboxQualification
    )
      result.push("Managed release requires sandbox qualification evidence");
    if (!release.manifest.commercialProductKey)
      result.push(
        "Customer packages require an explicit maintained capability product",
      );
  }
  return result;
}
