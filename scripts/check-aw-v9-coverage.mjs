import { readFileSync, existsSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute } from "node:path";
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "doc/experience/v9/coverage.json"), "utf8"),
);
const release = process.argv.includes("--release");
const failures = [];
const inside = (path) => {
  if (typeof path !== "string" || !path) return false;
  const candidate = resolve(root, path),
    part = relative(root, candidate);
  if (part.startsWith("..") || isAbsolute(part) || !existsSync(candidate))
    return false;
  const real = relative(root, realpathSync(candidate));
  return !real.startsWith("..") && !isAbsolute(real);
};
const readiness = JSON.parse(
  readFileSync(resolve(root, "evals/aw-v9/readiness.json"), "utf8"),
);
const identity = readiness.releaseIdentity;
if (
  release &&
  (!readiness.sourceComplete ||
    !identity ||
    !/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(identity.artifactSha ?? "") ||
    !/^[a-f0-9]{40}$/.test(identity.sourceSha ?? "") ||
    !/^[a-f0-9]{64}$/.test(identity.configSha256 ?? "") ||
    !identity.schemaVersion)
)
  failures.push(
    "Release requires complete source and an exact source/artifact/config/schema identity",
  );
const brief = manifest.screens[0]?.specification?.path;
if (
  !inside(brief) ||
  createHash("sha256")
    .update(readFileSync(resolve(root, brief)))
    .digest("hex") !== manifest.briefSha256
)
  failures.push("Whole build brief hash does not match the pinned corpus");
const ids = new Set();
for (const screen of manifest.screens) {
  if (ids.has(screen.screenId)) failures.push(`Duplicate ${screen.screenId}`);
  ids.add(screen.screenId);
  if (!screen.owner || !/^C[0-4]$/.test(screen.criticality))
    failures.push(`Missing owner/criticality: ${screen.screenId}`);
  if (
    !["pending", "in_progress", "implemented"].includes(
      screen.implementationStatus,
    )
  )
    failures.push(`Unknown implementation status: ${screen.screenId}`);
  const spec = screen.specification;
  if (!inside(spec?.path)) {
    failures.push(`Missing or external specification: ${screen.screenId}`);
    continue;
  }
  const lines = readFileSync(resolve(root, spec.path), "utf8").split(/\r?\n/);
  if (
    !Number.isInteger(spec.startLine) ||
    !Number.isInteger(spec.endLine) ||
    spec.startLine < 1 ||
    spec.endLine < spec.startLine ||
    spec.endLine > lines.length
  )
    failures.push(`Invalid specification range: ${screen.screenId}`);
  const hash = createHash("sha256")
    .update(lines.slice(spec.startLine - 1, spec.endLine).join("\n"))
    .digest("hex");
  if (hash !== spec.sha256)
    failures.push(`Specification drift: ${screen.screenId}`);
  if (screen.implementationStatus === "implemented" || release) {
    if (!inside(screen.contractPath))
      failures.push(`Missing resolved Screen Contract: ${screen.screenId}`);
    if (
      !screen.componentPaths.length ||
      screen.componentPaths.some((p) => !inside(p))
    )
      failures.push(`Missing implementation mapping: ${screen.screenId}`);
    if (release && screen.implementationStatus !== "implemented")
      failures.push(`Incomplete launch surface: ${screen.screenId}`);
    for (const kind of release
      ? ["functional", "accessibility", "securityPrivacy", "usability"]
      : []) {
      const valid = screen.evidenceRefs.some((e) => {
        if (
          e.kind !== kind ||
          e.status !== "passed" ||
          !/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(e.artifactSha ?? "") ||
          !e.path ||
          !inside(e.path) ||
          e.artifactSha !== identity?.artifactSha
        )
          return false;
        if (!/^[a-f0-9]{64}$/.test(e.artifactSha256 ?? "")) return false;
        const actual = createHash("sha256")
          .update(readFileSync(resolve(root, e.path)))
          .digest("hex");
        return actual === e.artifactSha256;
      });
      if (!valid)
        failures.push(
          `Missing verified exact-artifact ${kind} evidence: ${screen.screenId}`,
        );
    }
  }
}
for (const [prefix, count] of [
  ["ONB", 12],
  ["HIRE", 7],
  ["CUSTOM", 13],
]) {
  for (let n = 1; n <= count; n++) {
    const id = `${prefix}-${String(n).padStart(2, "0")}`;
    if (!ids.has(id)) failures.push(`Missing mandatory ${id}`);
  }
}
for (const id of [
  "SHELL",
  "HOME",
  "NEEDS-YOU",
  "WORK",
  "APPS",
  "COMPANY",
  "HELP-RECOVERY",
  "FEEDBACK",
  "MY-FEEDBACK",
  "APPROVAL-CARD",
  "ORCHESTRATION",
  "WORKFLOW",
  "AGENT-MONITOR",
  "AGENT-CHANGE",
  "AGENT-RETIRE",
]) {
  if (!ids.has(id)) failures.push(`Missing launch surface ${id}`);
}
const pending = manifest.screens.filter(
  (s) => s.implementationStatus !== "implemented",
).length;
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `V9 source coverage verified: ${ids.size} surfaces, ${pending} pending implementation/evidence. ${release ? "Release coverage passed." : "This is not release acceptance."}`,
  );
