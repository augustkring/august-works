#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, "evals/aw-v7/pilot-readiness.json"), "utf8"),
);
const groups = ["journey", "faults", "compoundCases", "operatingEvidence"];
function safeReference(value, origin) {
  try {
    const url = new URL(value),
      protectedOrigin = new URL(origin);
    return (
      url.protocol === "https:" &&
      url.origin === protectedOrigin.origin &&
      protectedOrigin.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !protectedOrigin.username &&
      !protectedOrigin.password &&
      !protectedOrigin.search &&
      !protectedOrigin.hash &&
      url.pathname.startsWith("/qualification/")
    );
  } catch {
    return false;
  }
}

/** A read-only evidence-coverage check. It neither attests remote artifacts nor
 * activates products, changes flags, authorizes spending or certifies GA. */
export function evaluateV7PilotReadiness(report, context) {
  const failures = [],
    missing = [];
  const required = groups.flatMap((group) => manifest[group]);
  if (
    !report ||
    report.version !== 1 ||
    report.evidenceKind !== "live_customer_pilot"
  )
    failures.push("live_customer_pilot_evidence_required");
  if (
    report &&
    Object.keys(report).some(
      (key) =>
        ![
          "version",
          "evidenceKind",
          "sourceSha",
          "companyId",
          "evidence",
        ].includes(key),
    )
  )
    failures.push("unexpected_report_fields");
  if (
    report?.sourceSha !== context.sourceSha ||
    !/^[a-f0-9]{40}$/.test(report?.sourceSha ?? "")
  )
    failures.push("current_source_revision_required");
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      report?.companyId ?? "",
    )
  )
    failures.push("native_pilot_company_required");
  if (!context.protectedEvidenceOrigin)
    failures.push("operator_configured_evidence_origin_required");
  const entries = Array.isArray(report?.evidence) ? report.evidence : [];
  const byId = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || !required.includes(entry.id)) {
      failures.push("unknown_evidence_id");
      continue;
    }
    if (byId.has(entry.id)) {
      failures.push(`duplicate_evidence:${entry.id}`);
      continue;
    }
    byId.set(entry.id, entry);
    const allowed = new Set([
      "id",
      "result",
      "evidenceKind",
      "sourceSha",
      "companyId",
      "artifactUri",
      "sha256",
      "testedAt",
      "expiresAt",
    ]);
    if (Object.keys(entry).some((key) => !allowed.has(key)))
      failures.push(`unexpected_evidence_fields:${entry.id}`);
    if (
      entry.result !== "pass" ||
      entry.evidenceKind !== "protected_live_report"
    )
      failures.push(`live_pass_required:${entry.id}`);
    if (
      entry.sourceSha !== context.sourceSha ||
      entry.companyId !== report?.companyId
    )
      failures.push(`scope_or_revision_changed:${entry.id}`);
    if (
      !safeReference(entry.artifactUri, context.protectedEvidenceOrigin) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")
    )
      failures.push(`protected_digest_reference_required:${entry.id}`);
    const tested = Date.parse(entry.testedAt),
      expires = Date.parse(entry.expiresAt);
    if (
      !Number.isFinite(tested) ||
      !Number.isFinite(expires) ||
      tested > context.now.getTime() ||
      expires <= context.now.getTime() ||
      expires <= tested ||
      expires - tested > 30 * 86400000
    )
      failures.push(`current_finite_evidence_required:${entry.id}`);
  }
  for (const id of required) if (!byId.has(id)) missing.push(id);
  const implementationBlockers = manifest.implementationBlockers
    .filter((item) => item.status !== "implemented_and_verified")
    .map((item) => item.id);
  return {
    configurationValid: true,
    readyForOperatorReview:
      !implementationBlockers.length && !failures.length && !missing.length,
    implementationBlockers,
    failures: [...new Set(failures)],
    missingEvidence: missing,
    limitation:
      "Reference validation does not authenticate artifact bytes or establish physical, customer, legal or production qualification.",
  };
}

export function validateV7PilotManifest() {
  if (
    manifest.version !== 1 ||
    groups.some(
      (group) => !Array.isArray(manifest[group]) || !manifest[group].length,
    )
  )
    throw new Error("Invalid V7 qualification manifest");
  const all = groups.flatMap((group) => manifest[group]);
  if (all.length !== new Set(all).size)
    throw new Error("Duplicate V7 acceptance case");
  for (const item of [
    ...manifest.localSuites,
    manifest.sourceLedger,
    ...manifest.implementationBlockers.map((item) => item.source),
  ]) {
    const absolute = path.resolve(repoRoot, item);
    if (!absolute.startsWith(repoRoot + path.sep) || !existsSync(absolute))
      throw new Error("V7 acceptance source is missing");
  }
  return manifest;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    validateV7PilotManifest();
    const argument = (key) => {
      const index = process.argv.indexOf(key);
      return index < 0 ? undefined : process.argv[index + 1];
    };
    const evidenceFile = argument("--evidence");
    const report = evidenceFile
      ? JSON.parse(readFileSync(evidenceFile, "utf8"))
      : null;
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const result = evaluateV7PilotReadiness(report, {
      sourceSha,
      protectedEvidenceOrigin: argument("--protected-evidence-origin"),
      now: new Date(),
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (
      process.argv.includes("--require-ready") &&
      !result.readyForOperatorReview
    )
      process.exitCode = 1;
  } catch {
    process.stderr.write(
      "V7 qualification manifest or evidence could not be validated.\n",
    );
    process.exitCode = 1;
  }
}
