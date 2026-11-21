import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = "doc/operations/v10-safe-change-graph.source.json";
const outputPath = "doc/operations/v10-safe-change-graph.json";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function buildGraph(
  manifest,
  read = (path) => readFileSync(resolve(root, path)),
  exists = (path) => existsSync(resolve(root, path)),
) {
  const baseCommitSha = manifest.sourceBase?.commitSha;
  if (!/^[a-f0-9]{40}$/.test(baseCommitSha ?? "")) {
    throw new Error("Safe Change inventory must declare an exact 40-character source base commit.");
  }
  const beforeByPath = new Map();
  for (const change of manifest.changes) {
    for (const pin of [change.preservedHistoricalMigration].filter(Boolean)) {
      const actual = sha256(read(pin.path));
      if (actual !== pin.sha256 || !/^[a-f0-9]{40}$/.test(pin.commitSha ?? "")) {
        throw new Error(`${change.changeId}: source-before/history pin mismatch for ${pin.path}`);
      }
    }
    if (change.sourceBefore && (!/^[a-f0-9]{40}$/.test(change.sourceBefore.commitSha ?? "") ||
        !/^[a-f0-9]{64}$/.test(change.sourceBefore.sha256 ?? ""))) {
      throw new Error(`${change.changeId}: invalid source-before pin for ${change.sourceBefore.path}`);
    }
    if (!Array.isArray(change.sourcePaths)) throw new Error(`${change.changeId}: sourcePaths must be an array`);
    const deleted = new Set(change.deletedSourcePaths ?? []);
    for (const path of change.sourcePaths) {
      if (!exists(path)) throw new Error(`${change.changeId}: current source path is missing: ${path}`);
      if (deleted.has(path)) throw new Error(`${change.changeId}: path is both current and deleted: ${path}`);
    }
    for (const path of deleted) {
      if (exists(path)) throw new Error(`${change.changeId}: deleted source unexpectedly exists in current source: ${path}`);
    }
    const pins = new Map((change.sourceBeforePins ?? []).map((pin) => [pin.path, pin]));
    for (const path of [...change.sourcePaths, ...deleted]) {
      const pin = pins.get(path);
      if (!pin || !/^[a-f0-9]{40}$/.test(pin.baseCommitSha ?? "")) {
        throw new Error(`${change.changeId}: missing exact base comparison for ${path}`);
      }
      if (pin.baseCommitSha !== baseCommitSha) {
        throw new Error(`${change.changeId}: base comparison for ${path} does not match the declared source base.`);
      }
      if (pin.status === "present_at_base") {
        if (!/^[a-f0-9]{64}$/.test(pin.sha256 ?? "")) throw new Error(`${change.changeId}: invalid present-at-base hash for ${path}`);
      } else if (pin.status === "absent_at_base") {
        if (pin.sha256 !== null || deleted.has(path)) throw new Error(`${change.changeId}: invalid absent-at-base declaration for ${path}`);
      } else {
        throw new Error(`${change.changeId}: unknown base source state for ${path}`);
      }
      const prior = beforeByPath.get(path);
      if (prior && JSON.stringify(prior) !== JSON.stringify(pin)) throw new Error(`Conflicting source-before pins for ${path}`);
      beforeByPath.set(path, pin);
    }
  }
  if (!Array.isArray(manifest.sourceInputs) || manifest.sourceInputs.length === 0) {
    throw new Error("Safe Change inventory must pin its binding brief, requirement register and hotspot source inputs");
  }
  const inputs = manifest.sourceInputs.map((input) => {
    const bytes = read(input.path);
    return { id: `input:${input.path}`, kind: "safe_change_source_input", ...input, sha256: sha256(bytes) };
  });
  const crosswalk = manifest.requirementsCrosswalk;
  const expectedRequirements = new Set(Array.from({ length: 169 }, (_, index) => `V10-${String(index + 1).padStart(3, "0")}`));
  if (!Array.isArray(crosswalk) || crosswalk.length !== expectedRequirements.size ||
      new Set(crosswalk.map((row) => row.workId)).size !== expectedRequirements.size ||
      crosswalk.some((row) => !expectedRequirements.has(row.workId))) {
    throw new Error("V10-004 source crosswalk must preserve every unique brief work ID V10-001 through V10-169");
  }
  const changeIds = new Set(manifest.changes.map((change) => change.changeId));
  if (changeIds.size !== manifest.changes.length) throw new Error("Safe Change inventory has duplicate change IDs");
  for (const row of crosswalk) {
    if (!Array.isArray(row.safeChangeIds) || row.safeChangeIds.some((id) => !changeIds.has(id))) {
      throw new Error(`${row.workId}: source crosswalk points to an unknown Safe Change record`);
    }
  }

  const changes = manifest.changes.map((change) => ({
    ...change,
    sources: change.sourcePaths.map((path) => ({
      path,
      sha256: sha256(read(path)),
    })),
  }));
  const sourceOwners = new Map();
  for (const change of changes) {
    for (const source of change.sources) {
      const prior = sourceOwners.get(source.path) ?? { ...source, changeIds: [] };
      if (prior.sha256 !== source.sha256) throw new Error(`Current source changed during graph generation: ${source.path}`);
      prior.changeIds.push(change.changeId);
      sourceOwners.set(source.path, prior);
    }
  }
  const migrationJournalPath = "packages/db/src/migrations/meta/_journal.json";
  const journal = JSON.parse(read(migrationJournalPath));
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) throw new Error("Migration journal has no ordered entries");
  const migrationNodes = journal.entries.map((entry, position) => {
    const path = `packages/db/src/migrations/${entry.tag}.sql`;
    const bytes = read(path);
    return {
      id: entry.tag,
      kind: "journaled_migration_source",
      path,
      sha256: sha256(bytes),
      journalPosition: position,
      journalIndex: entry.idx,
      createdAt: entry.when,
      qualification: "journal_order_and_current_sql_hash_only",
    };
  });
  const migrationIds = new Set(migrationNodes.map((node) => node.id));
  const migrationEdges = journal.entries.slice(1).map((entry, index) => ({
    from: journal.entries[index].tag,
    to: entry.tag,
    relation: "drizzle_journal_order_only",
  }));
  const migrationNodesByPath = new Map(migrationNodes.map((node) => [node.path, node.id]));
  const sourceNodes = [...sourceOwners.values()]
    .filter((source) => !migrationNodesByPath.has(source.path))
    .map((source) => ({
      id: `source:${source.path}`,
      kind: "current_source_owner",
      ...source,
      sourceBeforePin: beforeByPath.get(source.path) ?? null,
    }));
  const deletedPaths = new Map();
  for (const change of changes) {
    for (const path of change.deletedSourcePaths ?? []) {
      const prior = deletedPaths.get(path) ?? { path, sourceBeforePin: beforeByPath.get(path), changeIds: [] };
      prior.changeIds.push(change.changeId);
      deletedPaths.set(path, prior);
    }
  }
  const deletedNodes = [...deletedPaths.values()].map((source) => ({
    id: `deleted:${source.path}`,
    kind: "deleted_source_delta",
    ...source,
  }));
  const deletedPathSet = new Set(deletedPaths.keys());
  const ownerEdges = changes.flatMap((change) => change.sources
    .filter((source) => !migrationNodesByPath.has(source.path))
    .map((source) => ({
      from: change.changeId,
      to: `source:${source.path}`,
      relation: "implemented_or_operated_by_current_source_owner",
    })));
  const deletionEdges = changes.flatMap((change) => (change.deletedSourcePaths ?? []).map((path) => ({
    from: change.changeId,
    to: `deleted:${path}`,
    relation: "records_source_deletion_without_claiming_rollback",
  })));
  const dependencyEdges = changes.flatMap((change) => (change.dependencyPaths ?? []).map((path) => {
    const migrationId = migrationNodesByPath.get(path);
    const wasDeleted = deletedPathSet.has(path);
    return {
      from: change.changeId,
      to: migrationId ?? (wasDeleted ? `deleted:${path}` : `source:${path}`),
      relation: migrationId ? "declared_migration_dependency" : wasDeleted
        ? "registered_source_dependency_was_deleted"
        : "registered_source_dependency",
    };
  }));
  const changeMigrationEdges = changes.flatMap((change) => (Array.isArray(change.dependencies) ? change.dependencies : []).map((dependency) => {
    const migrationId = dependency.replace(/\.sql$/, "");
    if (!migrationIds.has(migrationId)) throw new Error(`${change.changeId}: migration dependency is absent from current journal: ${dependency}`);
    return { from: change.changeId, to: migrationId, relation: "references_migration_phase_source" };
  }));
  const requirementNodes = crosswalk.map((row) => ({ id: row.workId, kind: "v10_requirement_crosswalk", ...row }));
  const requirementEdges = crosswalk.flatMap((row) => row.safeChangeIds.map((changeId) => ({
    from: changeId,
    to: row.workId,
    relation: "source_link_only_not_requirement_closure",
  })));
  const scopeNode = {
    id: "inventory:V10-004",
    kind: "safe_change_inventory_scope",
    sourceBase: manifest.sourceBase,
    sourceInventoryBoundary: manifest.sourceInventoryBoundary,
    sourceAfterGeneration: manifest.sourceAfterGeneration,
  };
  const inputEdges = inputs.map((input) => ({ from: scopeNode.id, to: input.id, relation: "binds_inventory_input" }));
  const scopeEdges = changes.map((change) => ({ from: scopeNode.id, to: change.changeId, relation: "groups_current_source_delta" }));
  return {
    schemaVersion: 2,
    requirement: manifest.requirement,
    status: "candidate-branch-source-inventory; not final V10 matrix or release qualification",
    scope: manifest.scope,
    sourceIdentity: {
      commitSha: null,
      identityKind: "sha256_of_each_listed_current_source_and_input_file",
      baseCommitSha,
      releaseQualification: "not_claimed",
    },
    sourceManifest: manifestPath,
    sourceInventoryBoundary: manifest.sourceInventoryBoundary,
    qualificationBoundary: "Source hashes identify current candidate bytes and exact base comparisons. Requirement edges are source links, not closure. The inventory does not prove full behavior review, compatibility, rollback, Human approval, provider/hosted behavior, or release acceptance. Unknown owners and external facts remain open.",
    migrationJournal: {
      path: migrationJournalPath,
      sha256: sha256(read(migrationJournalPath)),
      entryCount: migrationNodes.length,
      qualification: "journal order and current SQL source hashes only; not migration phase, mixed-version safety, rollback, or operator approval",
    },
    sourceInputs: inputs,
    requirementsCrosswalk: requirementNodes,
    nodes: [
      scopeNode,
      ...changes.map(({ dependencies, changeId, ...node }) => ({
        id: changeId, ...node, kind: "safe_change_record",
        dependencyIds: Array.isArray(dependencies) ? dependencies : [],
        ...(typeof dependencies === "string" ? { dependencies } : {}),
      })),
      ...requirementNodes,
      ...migrationNodes,
      ...deletedNodes,
      ...sourceNodes,
      ...inputs,
    ],
    edges: [...scopeEdges, ...inputEdges, ...requirementEdges, ...migrationEdges, ...ownerEdges, ...deletionEdges, ...dependencyEdges, ...changeMigrationEdges],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
}
