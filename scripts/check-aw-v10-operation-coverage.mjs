import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { validateOperationCoverage } from "./aw-v10-operation-coverage.mjs";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "server/src/services/agent-native-operation-manifest.ts");
const inventoryPath = resolve(root, "doc/operations/agent-native-ui-operation-coverage.json");

function parseManifest(source) {
  const entries = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^  \{$/.test(lines[index])) continue;
    const block = [];
    for (index += 1; index < lines.length && !/^  \},?$/.test(lines[index]); index += 1) block.push(lines[index]);
    const text = block.join("\n");
    const operationId = text.match(/^\s*operationId:\s*"([^"]+)"/m)?.[1];
    if (!operationId) continue;
    entries.push({
      operationId,
      criticality: text.match(/criticality:\s*"([^"]+)"/)?.[1],
      canonicalService: text.match(/canonicalService:\s*"([^"]+)"/)?.[1],
      owner: text.match(/owner:\s*"([^"]+)"/)?.[1],
    });
  }
  return entries;
}

const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const entries = parseManifest(readFileSync(manifestPath, "utf8"));
const failures = validateOperationCoverage({
  manifestEntries: entries,
  inventory,
  exists: (path) => existsSync(resolve(root, path)),
  readSource: (path) => readFileSync(resolve(root, path), "utf8"),
});
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`V10 material operation coverage verified: ${inventory.operations.length} manifest operations classified; ${inventory.uiOnlyActions.length} UI-only actions have explicit owners and exclusions.`);
}
