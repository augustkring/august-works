import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const INVENTORY_PATH = "doc/operations/agent-native-tool-alias-compatibility.json";
export const SOURCE_ROOTS = ["server/src", "packages", "cli/src", "ui/src", "scripts", "skills", "skills-releases", "server/src/onboarding-assets"];
export const SCAN_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".md"];
const EXTENSIONS = new Set(SCAN_EXTENSIONS);
export const RUNTIME_INSTRUCTION_SELECTION = [
  "all SKILL.md under skills/ and skills-releases/",
  "all Markdown under skills/blentera-platform/ and skills-releases/blentera-platform/",
  "all Markdown under server/src/onboarding-assets/",
  "all SKILL.md under server/src/ and packages/",
];
function isRuntimeInstruction(relative) {
  if (path.extname(relative) !== ".md") return false;
  const platformDirectory = relative.startsWith("skills/blentera-platform/") || relative.startsWith("skills-releases/blentera-platform/");
  const onboardingMarkdown = relative.startsWith("server/src/onboarding-assets/") && path.extname(relative) === ".md";
  const rootSkill = (relative.startsWith("skills/") || relative.startsWith("skills-releases/")) && path.basename(relative) === "SKILL.md";
  const builtInOrAdapterSkill = (relative.startsWith("server/src/") || relative.startsWith("packages/")) && path.basename(relative) === "SKILL.md";
  return platformDirectory || onboardingMarkdown || rootSkill || builtInOrAdapterSkill;
}
const LIFECYCLE = {
  state: "active_compatibility",
  deprecationAnnounced: false,
  sunsetVersion: null,
  sunsetDate: null,
  retirementApproved: false,
  actualUsage: "not_measured",
  externalConsumerInventory: "unknown",
};

export function validateInventory(inventory, manifestAliases, scanResults, pinnedHashes, latestRelease, actualOperationManifestHash) {
  assert.equal(inventory.contract, "v10-agent-native-tool-alias-compatibility-and-transition");
  assert.equal(inventory.briefBinding?.catalogueLine, 6941, "V10-122 binding changed; review the exact brief clause");
  assert.match(inventory.briefBinding?.transitionClause ?? "", /56\.6 MIG-06/);
  assert.match(inventory.briefBinding?.rawApiFallbackClause ?? "", /not reclassified as raw API fallbacks/);
  assert.equal(inventory.currentTransition?.noAutomaticRetirement, true);
  assert.equal(inventory.currentTransition?.fixedWindow, "none; the binding clause rejects a universal interval.");
  for (const [key, expected] of Object.entries(LIFECYCLE)) {
    assert.equal(inventory.currentTransition?.[key], expected, `transition ${key} requires reviewed evidence and source-gate change`);
  }
  assert.deepEqual(inventory.sourceScan?.roots, SOURCE_ROOTS, "source scan roots must match the checker");
  assert.deepEqual(inventory.sourceScan?.extensions, SCAN_EXTENSIONS, "source scan extensions must match the checker");
  assert.deepEqual(inventory.sourceScan?.runtimeInstructionSelection, RUNTIME_INSTRUCTION_SELECTION, "runtime instruction selection must match the checker");
  assert.deepEqual(inventory.currentPlatformSkillRelease?.metadata, latestRelease, "read-only Skill release metadata is stale against the actual release registry");
  assert.equal(latestRelease?.id, "v3", "this sidecar must pin released Skill v3");
  assert.equal(actualOperationManifestHash, latestRelease?.operationManifestHash, "current operation manifest hash differs from immutable Skill v3 pin");
  assert.equal(inventory.aliases?.length, manifestAliases.length, "alias inventory must exactly cover the source manifest");
  const expected = new Map(manifestAliases.map((row) => [row.alias, row]));
  assert.equal(expected.size, manifestAliases.length, "source manifest has duplicate aliases");
  const seen = new Set();
  for (const row of inventory.aliases) {
    assert.ok(!seen.has(row.alias), `duplicate inventory alias ${row.alias}`);
    seen.add(row.alias);
    const source = expected.get(row.alias);
    assert.ok(source, `inventory alias is absent from source manifest: ${row.alias}`);
    for (const key of ["operationId", "canonicalToolId", "owner", "mode"]) {
      assert.equal(row[key], source[key], `${row.alias} ${key} changed; review before modifying mapping`);
    }
    assert.equal(row.lifecycle, "active_compatibility");
    assert.deepEqual([...row.repositoryConsumerPaths].sort(), [...(scanResults.aliasConsumers.get(row.alias) ?? [])].sort(), `${row.alias} consumer-path inventory is stale`);
  }
  assert.deepEqual([...seen].sort(), [...expected.keys()].sort(), "inventory aliases must exactly match source manifest aliases");
  assert.deepEqual([...inventory.repositoryConsumerPaths].sort(), [...scanResults.allConsumerPaths].sort(), "global literal consumer-path inventory is stale");
  assert.deepEqual([...inventory.runtimeInstructionPaths].sort(), [...scanResults.runtimeInstructionPaths].sort(), "runtime-instruction inventory is stale");
  assert.deepEqual(inventory.sourcePins.map(({ path }) => path).sort(), [...new Set(inventory.sourcePins.map(({ path }) => path))].sort(), "duplicate source pin path");
  for (const pin of inventory.sourcePins) {
    assert.equal(pinnedHashes.get(pin.path), pin.sha256, `source pin stale: ${pin.path}`);
  }
  const requiredPins = new Set([...scanResults.allConsumerPaths, ...scanResults.runtimeInstructionPaths, ...inventory.ownerPaths, ...manifestAliases.map(({ owner }) => owner), "skills-releases/blentera-platform/releases.json"]);
  assert.deepEqual([...inventory.sourcePins.map(({ path }) => path)].sort(), [...requiredPins].sort(), "source pins must cover every consumer, owner and read-only Skill release registry");
}

async function filesUnder(root, relative) {
  const absolute = path.join(root, relative);
  const entries = await readdir(absolute, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(root, child));
    else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) found.push(child);
  }
  return found;
}

export async function scanConsumers(root, aliases) {
  const paths = [...new Set((await Promise.all(SOURCE_ROOTS.map((item) => filesUnder(root, item)))).flat())].sort();
  const aliasConsumers = new Map(aliases.map(({ alias }) => [alias, []]));
  const allConsumerPaths = new Set();
  for (const relative of paths) {
    const source = await readFile(path.join(root, relative), "utf8");
    for (const { alias } of aliases) {
      if (source.includes(alias)) {
        aliasConsumers.get(alias).push(relative);
        allConsumerPaths.add(relative);
      }
    }
  }
  const runtimeInstructionPaths = paths.filter(isRuntimeInstruction);
  return { aliasConsumers, allConsumerPaths: [...allConsumerPaths].sort(), runtimeInstructionPaths };
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

export async function loadManifest(root) {
  const require = createRequire(path.join(root, "cli/package.json"));
  require("tsx/esm/api").register();
  const module = await import(pathToFileURL(path.join(root, "server/src/services/agent-native-operation-manifest.ts")));
  return module.AGENT_NATIVE_OPERATION_MANIFEST.flatMap((row) => (row.legacyAliases ?? []).map((alias) => ({
    alias,
    operationId: row.operationId,
    canonicalToolId: row.toolId,
    owner: row.owner,
    mode: row.mode,
  })));
}

export async function loadOperationManifestHash(root) {
  const module = await import(pathToFileURL(path.join(root, "server/src/services/agent-native-operation-manifest.ts")));
  return module.agentNativeOperationManifestHash();
}

export async function check({ root = process.cwd(), inventoryPath = process.env.AGENT_NATIVE_TOOL_ALIAS_INVENTORY ?? path.join(root, INVENTORY_PATH) } = {}) {
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const manifestAliases = await loadManifest(root);
  const scanResults = await scanConsumers(root, manifestAliases);
  const registry = JSON.parse(await readFile(path.join(root, "skills-releases/blentera-platform/releases.json"), "utf8"));
  const latestRelease = registry.at(-1);
  const actualOperationManifestHash = await loadOperationManifestHash(root);
  const pinnedHashes = new Map();
  for (const pin of inventory.sourcePins) pinnedHashes.set(pin.path, await sha256(path.join(root, pin.path)));
  validateInventory(inventory, manifestAliases, scanResults, pinnedHashes, latestRelease, actualOperationManifestHash);
  return { aliasCount: manifestAliases.length, consumerPathCount: scanResults.allConsumerPaths.length, inventoryPath };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.cwd();
  const result = await check({ root });
  console.log(`Agent-native tool alias compatibility: ${result.aliasCount} active aliases, ${result.consumerPathCount} source/test consumer paths; no automatic retirement.`);
}
