import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = "doc/operations/v10-safe-change-graph.source.json";
const outputPath = "doc/operations/v10-safe-change-graph.json";

export function buildGraph(manifest, read = (path) => readFileSync(resolve(root, path))) {
  for (const change of manifest.changes) {
    for (const pin of [change.preservedHistoricalMigration].filter(Boolean)) {
      const actual = createHash("sha256").update(read(pin.path)).digest("hex");
      if (actual !== pin.sha256 || !/^[a-f0-9]{40}$/.test(pin.commitSha ?? "")) {
        throw new Error(`${change.changeId}: source-before/history pin mismatch for ${pin.path}`);
      }
    }
    if (change.sourceBefore && (!/^[a-f0-9]{40}$/.test(change.sourceBefore.commitSha ?? "") ||
        !/^[a-f0-9]{64}$/.test(change.sourceBefore.sha256 ?? ""))) {
      throw new Error(`${change.changeId}: invalid source-before pin for ${change.sourceBefore.path}`);
    }
  }
  const changes = manifest.changes.map((change) => ({
    ...change,
    sources: change.sourcePaths.map((path) => ({
      path,
      sha256: createHash("sha256").update(read(path)).digest("hex"),
    })),
  }));
  const migrationPaths = new Map(changes.flatMap((change) => change.dependencies.map((id) => [
    `packages/db/src/migrations/${id}`,
    id,
  ])));
  const sourceNodes = changes.flatMap((change) => change.sources)
    .filter((source) => !migrationPaths.has(source.path))
    .map((source) => ({ id: `source:${source.path}`, kind: "current_source_owner", ...source }));
  const migrationNodes = [...migrationPaths].map(([path, id]) => ({
    id,
    kind: "existing_migration_dependency",
    path,
    sha256: createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex"),
    qualification: "historical_sql_source_only",
  }));
  const ownerEdges = changes.flatMap((change) => change.sources
    .filter((source) => !migrationPaths.has(source.path))
    .map((source) => ({
      from: change.changeId,
      to: `source:${source.path}`,
      relation: "implemented_or_operated_by_current_source_owner",
    })));
  const migrationEdges = changes.flatMap((change) => change.dependencies.map((dependency, index) => ({
    from: index === 0 ? change.changeId : change.dependencies[index - 1],
    to: dependency,
    relation: index === 0 ? "migration_phase_source" : "journal_order_dependency",
  })));
  const recoveryOwner = changes.flatMap((change) => change.sourcePaths)
    .find((path) => path === "server/src/services/company-import-jobs.ts");
  if (recoveryOwner && migrationNodes.length > 1) migrationEdges.push({
    from: migrationNodes.at(-1).id,
    to: `source:${recoveryOwner}`,
    relation: "indexed_runtime_recovery_owner",
  });
  return {
    schemaVersion: 1,
    requirement: manifest.requirement,
    status: "scoped-source-transition-graph; not final V10 matrix",
    scope: manifest.scope,
    sourceIdentity: { commitSha: null, identityKind: "sha256_of_each_listed_source_file", releaseQualification: "not_claimed" },
    sourceManifest: manifestPath,
    qualificationBoundary: "File hashes identify the inspected working-tree bytes. They are not commit IDs, immutable release artifacts, external approval, or proof of performance/hosted behavior.",
    nodes: [
      ...changes.map(({ dependencies, changeId, ...node }) => ({ id: changeId, ...node, kind: "safe_change_record", dependencyIds: dependencies })),
      ...migrationNodes,
      ...sourceNodes,
    ],
    edges: [...migrationEdges, ...ownerEdges],
  };
}

const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), "utf8"));
const rendered = `${JSON.stringify(buildGraph(manifest), null, 2)}\n`;
const check = process.argv.includes("--check");
if (check) {
  const current = readFileSync(resolve(root, outputPath), "utf8");
  if (current !== rendered) throw new Error(`${outputPath} is stale; regenerate from its source manifest and current source paths.`);
} else {
  mkdirSync(dirname(resolve(root, outputPath)), { recursive: true });
  writeFileSync(resolve(root, outputPath), rendered, "utf8");
}
