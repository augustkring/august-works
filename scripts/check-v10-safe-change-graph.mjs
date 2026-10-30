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
}
if (!graph.edges.some((edge) => edge.from === "0554_company_import_fenced_effects.sql" && edge.to === "0556_customer_operation_expired_lease_recovery.sql")) {
  throw new Error("V10 Safe Change graph lost the 0554 -> 0556 migration order dependency.");
}
process.stdout.write("V10 Safe Change graph matches its source manifest and current scoped source bytes.\n");
