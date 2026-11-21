import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mapPath = "doc/operations/v10-security-fast-path.json";

export function validateSecurityFastPath(map, exists = (path) => existsSync(resolve(root, path))) {
  const errors = [];
  if (map?.schemaVersion !== 1 || map?.requirement !== "V10-013" || !Array.isArray(map.regressions)) {
    return ["Invalid V10 security fast-path map shape"];
  }
  const ids = new Set();
  const protectedPaths = new Set();
  for (const row of map.regressions) {
    if (!row.id || ids.has(row.id)) errors.push(`Missing or duplicate regression ID: ${row.id ?? "<unknown>"}`);
    ids.add(row.id);
    if (!row.canonicalOwner || !row.ownerDisposition) errors.push(`${row.id}: owner/disposition must be explicit, including unknown`);
    if (!Array.isArray(row.protectedPaths) || row.protectedPaths.length === 0) errors.push(`${row.id}: no protected source paths`);
    if (!Array.isArray(row.selectors) || row.selectors.length === 0) errors.push(`${row.id}: no regression selector`);
    if (!Array.isArray(row.triggers) || row.triggers.length === 0) errors.push(`${row.id}: no change trigger`);
    if (row.ciJob !== map?.ciOwner?.jobId || row.ciWorkflow !== map?.ciOwner?.workflow) errors.push(`${row.id}: selector is not bound to the declared CI owner`);
    for (const path of [...(row.protectedPaths ?? []), ...(row.selectors ?? [])]) {
      if (!exists(path)) errors.push(`${row.id}: missing mapped path ${path}`);
    }
    for (const path of row.protectedPaths ?? []) protectedPaths.add(path);
  }
  const fallbackPrefixes = new Set();
  for (const fallback of map.sourceFallbacks ?? []) {
    if (!fallback.prefix || fallbackPrefixes.has(fallback.prefix)) errors.push(`Missing or duplicate security source fallback: ${fallback.prefix ?? "<unknown>"}`);
    fallbackPrefixes.add(fallback.prefix);
    if (!fallback.canonicalOwner || !fallback.ownerDisposition) errors.push(`${fallback.prefix}: fallback owner/disposition must be explicit`);
    if (!fallback.trigger) errors.push(`${fallback.prefix}: no change-impact trigger`);
    if (!Array.isArray(fallback.selectors) || fallback.selectors.length === 0) errors.push(`${fallback.prefix}: no conservative fallback selector`);
    for (const selector of fallback.selectors ?? []) if (!exists(selector)) errors.push(`${fallback.prefix}: missing fallback selector ${selector}`);
  }
  if (!protectedPaths.has("server/src/services/authorization.ts") ||
      !protectedPaths.has("server/src/services/memory/memory-privacy.ts") ||
      !protectedPaths.has("server/src/services/workflows/workflow-executor.ts")) {
    errors.push("Security fast path is missing a core authorization, privacy, or workflow-recovery protected path");
  }
  for (const prefix of map.sensitiveSourcePrefixes ?? []) {
    if (!fallbackPrefixes.has(prefix) && !protectedPaths.has(prefix)) errors.push(`Sensitive source prefix has no exact or fallback selector: ${prefix}`);
  }
  if (!map.ciOwner?.jobId || !map.ciOwner?.workflow || !exists(map.ciOwner.workflow)) {
    errors.push("Security regression CI owner does not resolve to an existing workflow/job");
  }
  if (!map.sourceAssurance || !exists(map.sourceAssurance) || !/^[a-f0-9]{64}$/.test(map.sourceAssuranceSha256 ?? "")) {
    errors.push("V9 assurance input must have an explicit source path and SHA-256 pin");
  } else {
    const actual = createHash("sha256").update(readFileSync(resolve(root, map.sourceAssurance))).digest("hex");
    if (actual !== map.sourceAssuranceSha256) errors.push("V9 assurance map source changed; review the source delta before refreshing the pin");
  }
  return errors;
}

export function selectSecurityFastPath(map, changedFiles) {
  const changed = new Set(changedFiles.map((path) => path.replaceAll("\\", "/")));
  const protectedPaths = new Set(map.regressions.flatMap((row) => row.protectedPaths));
  const fallbackFor = (path) => map.sourceFallbacks?.find((fallback) => path.startsWith(fallback.prefix));
  const unmappedSensitive = [...changed].filter((path) =>
    map.sensitiveSourcePrefixes.some((prefix) => path === prefix || (prefix.endsWith("/") && path.startsWith(prefix))) &&
    !protectedPaths.has(path) && !fallbackFor(path));
  if (unmappedSensitive.length) throw new Error(`Unmapped security-sensitive source change(s): ${unmappedSensitive.join(", ")}`);
  const exact = map.regressions
    .filter((row) => row.protectedPaths.some((path) => changed.has(path)))
    .flatMap((row) => row.selectors);
  const fallback = [...changed]
    .filter((path) => !protectedPaths.has(path))
    .flatMap((path) => fallbackFor(path)?.selectors ?? []);
  return [...new Set([...exact, ...fallback])].sort();
}

function main() {
  const args = process.argv.slice(2);
  const changedFiles = [];
  let selectionRequested = false;
  let selectAll = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--changed-file") { selectionRequested = true; changedFiles.push(args[++i] ?? ""); }
    else if (args[i] === "--base") {
      selectionRequested = true;
      const base = args[++i] ?? "";
      if (!base) throw new Error("--base requires a commit SHA");
      changedFiles.push(...execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\n").filter(Boolean));
    }
    else if (args[i] === "--all") { selectionRequested = true; selectAll = true; }
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  const map = JSON.parse(readFileSync(resolve(root, mapPath), "utf8"));
  const errors = validateSecurityFastPath(map);
  if (errors.length) throw new Error(errors.join("\n"));
  if (selectionRequested) {
    const selectors = selectAll
      ? [...new Set(map.regressions.flatMap((row) => row.selectors))].sort()
      : selectSecurityFastPath(map, changedFiles);
    if (selectors.length) process.stdout.write(`${selectors.join("\n")}\n`);
  } else {
    process.stdout.write(`Validated ${map.regressions.length} security regression groups; ${map.regressions.reduce((n, row) => n + row.protectedPaths.length, 0)} protected path mappings.\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
