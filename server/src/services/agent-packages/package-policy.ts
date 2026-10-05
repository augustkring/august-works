import type { PackageRelease } from "@paperclipai/shared";
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
    for (const dimension of [
      "sbom",
      "scan",
      "evaluations",
      "protectedHoldout",
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
