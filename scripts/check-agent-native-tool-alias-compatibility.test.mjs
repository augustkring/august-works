import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadManifest, loadOperationManifestHash, scanConsumers, validateInventory } from "./check-agent-native-tool-alias-compatibility.mjs";

const root = process.env.AGENT_NATIVE_TOOL_ALIAS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = process.env.AGENT_NATIVE_TOOL_ALIAS_INVENTORY ?? path.join(root, "doc/operations/agent-native-tool-alias-compatibility.json");
const load = async () => JSON.parse(await readFile(inventoryPath, "utf8"));
const baseContext = (async () => {
  const inventory = await load();
  const manifestAliases = await loadManifest(root);
  const scanResults = await scanConsumers(root, manifestAliases);
  const registry = JSON.parse(await readFile(path.join(root, "skills-releases/blentera-platform/releases.json"), "utf8"));
  const latestRelease = registry.at(-1);
  const actualOperationManifestHash = await loadOperationManifestHash(root);
  const pinnedHashes = new Map(inventory.sourcePins.map(({ path, sha256 }) => [path, sha256]));
  return { inventory, manifestAliases, scanResults, pinnedHashes, latestRelease, actualOperationManifestHash };
})();
const context = async () => {
  const base = await baseContext;
  return {
    inventory: structuredClone(base.inventory),
    manifestAliases: structuredClone(base.manifestAliases),
    scanResults: { aliasConsumers: new Map([...base.scanResults.aliasConsumers].map(([alias, paths]) => [alias, [...paths]])), allConsumerPaths: [...base.scanResults.allConsumerPaths], runtimeInstructionPaths: [...base.scanResults.runtimeInstructionPaths] },
    pinnedHashes: new Map(base.pinnedHashes),
    latestRelease: structuredClone(base.latestRelease),
    actualOperationManifestHash: base.actualOperationManifestHash,
  };
};
const assertValid = ({ inventory, manifestAliases, scanResults, pinnedHashes, latestRelease, actualOperationManifestHash }) => validateInventory(inventory, manifestAliases, scanResults, pinnedHashes, latestRelease, actualOperationManifestHash);

test("current V10-122 inventory pins all aliases active without changing Skill release v3", async () => {
  const ctx = await context();
  assertValid(ctx);
  assert.equal(ctx.inventory.aliases.length, 38);
  assert.equal(ctx.inventory.currentPlatformSkillRelease.metadata.id, "v3");
  assert.ok(ctx.inventory.runtimeInstructionPaths.length > 0);
});

test("fails closed when an alias is removed from either side of the inventory", async () => {
  const ctx = await context();
  ctx.inventory.aliases.pop();
  assert.throws(() => assertValid(ctx), /exactly cover the source manifest/);
  const next = await context();
  next.manifestAliases.pop();
  assert.throws(() => assertValid(next), /exactly cover the source manifest/);
});

test("fails closed when an alias is retargeted or duplicated", async () => {
  let ctx = await context();
  ctx.inventory.aliases[0].canonicalToolId = "blentera.unreviewed.target";
  assert.throws(() => assertValid(ctx), /canonicalToolId changed/);
  ctx = await context();
  ctx.inventory.aliases.push(structuredClone(ctx.inventory.aliases[0]));
  assert.throws(() => assertValid(ctx), /exactly cover the source manifest/);
});

test("fails closed on attempted retirement or unsupported lifecycle promotion", async () => {
  let ctx = await context();
  ctx.inventory.aliases[0].lifecycle = "retired";
  assert.throws(() => assertValid(ctx), /active_compatibility/);
  ctx = await context();
  ctx.inventory.currentTransition.retirementApproved = true;
  assert.throws(() => assertValid(ctx), /transition retirementApproved/);
});

test("fails closed when current source consumers change without inventory review", async () => {
  const ctx = await context();
  ctx.scanResults.allConsumerPaths.push("server/src/unreviewed-alias-consumer.ts");
  assert.throws(() => assertValid(ctx), /global literal consumer-path inventory is stale/);
});

test("source scan declarations and full immutable Skill release v3 metadata match the actual contract", async () => {
  let ctx = await context();
  ctx.inventory.sourceScan.roots = ["server/src"];
  assert.throws(() => assertValid(ctx), /source scan roots must match/);
  ctx = await context();
  ctx.inventory.runtimeInstructionPaths.pop();
  assert.throws(() => assertValid(ctx), /runtime-instruction inventory is stale/);
  ctx = await context();
  ctx.inventory.currentPlatformSkillRelease.metadata.toolCatalogContractHash = "0".repeat(64);
  assert.throws(() => assertValid(ctx), /release metadata is stale/);
  ctx = await context();
  ctx.actualOperationManifestHash = "0".repeat(64);
  assert.throws(() => assertValid(ctx), /current operation manifest hash differs/);
});

test("fails closed when source or alias-owner pins are stale or omitted", async () => {
  let ctx = await context();
  const requiredOwner = ctx.manifestAliases.map(({ owner }) => owner).find((owner) => !ctx.inventory.ownerPaths.includes(owner) && !ctx.inventory.repositoryConsumerPaths.includes(owner));
  assert.ok(requiredOwner, "fixture must include an operation owner outside generic consumer pins");
  ctx.inventory.sourcePins = ctx.inventory.sourcePins.filter(({ path }) => path !== requiredOwner);
  assert.throws(() => assertValid(ctx), /source pins must cover/);
  ctx = await context();
  ctx.pinnedHashes.set(ctx.inventory.sourcePins[0].path, "0".repeat(64));
  assert.throws(() => assertValid(ctx), /source pin stale/);
  ctx = await context();
  ctx.inventory.sourcePins.pop();
  assert.throws(() => assertValid(ctx), /source pins must cover/);
});
