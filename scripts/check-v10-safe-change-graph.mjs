import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const generator = resolve(root, "scripts/generate-v10-safe-change-graph.mjs");
const result = spawnSync(process.execPath, [generator, "--check"], { cwd: root, encoding: "utf8" });
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "V10 Safe Change graph is stale.\n");
  process.exit(result.status ?? 1);
}
const graph = JSON.parse(readFileSync(resolve(root, "doc/operations/v10-safe-change-graph.json"), "utf8"));
if (graph.schemaVersion !== 2 || graph.requirement !== "V10-004") {
  throw new Error("V10 Safe Change graph must be a schema-2 source inventory");
}
if (!/^[a-f0-9]{40}$/.test(graph.sourceIdentity?.baseCommitSha ?? "")) {
  throw new Error("V10 Safe Change graph must declare an exact source base commit.");
}
const ids = new Set(graph.nodes.map((node) => node.id));
if (ids.size !== graph.nodes.length) throw new Error("V10 Safe Change graph has duplicate node IDs.");
for (const edge of graph.edges) {
  if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error(`V10 Safe Change graph has a dangling edge: ${edge.from} -> ${edge.to}`);
}
for (const source of graph.nodes.flatMap((node) => node.sources ?? []).concat(graph.nodes.filter((node) => node.sha256))) {
  if (!/^[a-f0-9]{64}$/.test(source.sha256 ?? "")) throw new Error(`V10 Safe Change graph has an invalid source hash: ${source.path ?? source.id}`);
}
for (const node of graph.nodes.filter((entry) => entry.kind === "safe_change_record")) {
  for (const pin of [node.sourceBefore, node.preservedHistoricalMigration].filter(Boolean)) {
    if (!/^[a-f0-9]{40}$/.test(pin.commitSha ?? "") || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? "")) {
      throw new Error(`Safe Change ${node.id} has an invalid source-before/history pin.`);
    }
  }
  const pinByPath = new Map((node.sourceBeforePins ?? []).map((pin) => [pin.path, pin]));
  for (const path of [...(node.sourcePaths ?? []), ...(node.deletedSourcePaths ?? [])]) {
    const pin = pinByPath.get(path);
    if (!pin || !/^[a-f0-9]{40}$/.test(pin.baseCommitSha ?? "")) {
      throw new Error(`Safe Change ${node.id} is missing a base comparison for ${path}.`);
    }
    if (pin.baseCommitSha !== graph.sourceIdentity.baseCommitSha) {
      throw new Error(`Safe Change ${node.id} has a base comparison outside the declared source base for ${path}.`);
    }
    if (pin.status === "present_at_base") {
      if (!/^[a-f0-9]{64}$/.test(pin.sha256 ?? "")) throw new Error(`Safe Change ${node.id} has an invalid prior hash for ${path}.`);
    } else if (pin.status === "absent_at_base") {
      if (pin.sha256 !== null || (node.deletedSourcePaths ?? []).includes(path)) {
        throw new Error(`Safe Change ${node.id} has an invalid absent-at-base claim for ${path}.`);
      }
    } else {
      throw new Error(`Safe Change ${node.id} has an unknown base state for ${path}.`);
    }
  }
  for (const path of node.changedSourcePaths ?? []) {
    if (!(node.sourcePaths ?? []).includes(path) && !(node.deletedSourcePaths ?? []).includes(path)) {
      throw new Error(`Safe Change ${node.id} leaves a changed path unpinned: ${path}`);
    }
  }
}

const requirements = graph.requirementsCrosswalk ?? [];
const requirementIds = new Set(requirements.map((row) => row.workId));
if (requirements.length !== 169 || requirementIds.size !== 169 ||
    Array.from({ length: 169 }, (_, index) => `V10-${String(index + 1).padStart(3, "0")}`)
      .some((workId) => !requirementIds.has(workId))) {
  throw new Error("V10 Safe Change graph must preserve all 169 brief work IDs without upgrading their status.");
}
const hotspotRecords = graph.nodes.filter((node) => node.kind === "safe_change_record" && node.recordKind === "production_hotspot_owner_group");
if (hotspotRecords.length !== 25) throw new Error(`Expected the 25 registered production hotspots, found ${hotspotRecords.length}.`);
const changedPaths = new Set(graph.nodes.filter((node) => node.kind === "safe_change_record").flatMap((node) => node.changedSourcePaths ?? []));
const deletedPaths = new Set(graph.nodes.filter((node) => node.kind === "safe_change_record").flatMap((node) => node.deletedSourcePaths ?? []));
if (changedPaths.size !== graph.sourceInventoryBoundary.sourceDeltaPathCount ||
    deletedPaths.size !== graph.sourceInventoryBoundary.deletedSourcePathCount) {
  throw new Error("Safe Change source inventory counts do not match the pinned current/deleted paths.");
}

const migrations = graph.nodes.filter((node) => node.kind === "journaled_migration_source").sort((a, b) => a.journalPosition - b.journalPosition);
if (migrations.length !== graph.migrationJournal.entryCount || migrations.length < 2) {
  throw new Error("Safe Change graph does not contain the complete current migration journal source list.");
}
for (let index = 1; index < migrations.length; index += 1) {
  if (!graph.edges.some((edge) => edge.from === migrations[index - 1].id && edge.to === migrations[index].id && edge.relation === "drizzle_journal_order_only")) {
    throw new Error(`Migration graph lost journal adjacency ${migrations[index - 1].id} -> ${migrations[index].id}.`);
  }
}
if (!graph.edges.some((edge) => edge.from === "0554_company_import_fenced_effects" && edge.to === "0555_company_membership_permission_initialization" && edge.relation === "drizzle_journal_order_only") ||
    !graph.edges.some((edge) => edge.from === "0555_company_membership_permission_initialization" && edge.to === "0556_customer_operation_expired_lease_recovery" && edge.relation === "drizzle_journal_order_only")) {
  throw new Error("Safe Change migration graph lost the 0554 -> 0555 -> 0556 order.");
}
process.stdout.write(`V10 Safe Change graph matches ${changedPaths.size} source deltas, ${requirements.length} V10 crosswalk rows, 25 hotspots and ${migrations.length} ordered migrations.\n`);
