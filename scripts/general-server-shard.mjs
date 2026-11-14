import { readFileSync } from "node:fs";

// Fallback weight (ms) when the duration manifest is missing or empty.
const FALLBACK_SUITE_WEIGHT_MS = 1000;

// Loads the per-suite duration manifest produced from a real PR run (see the
// $comment field in scripts/general-server-shard-durations.json). Returns an
// empty map on any read/parse problem so sharding degrades to uniform weights
// instead of failing the test lane.
export function loadShardDurations(manifestPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return {};
  }

  const durations = parsed?.durations;
  if (!durations || typeof durations !== "object" || Array.isArray(durations)) {
    return {};
  }

  const result = {};
  for (const [file, ms] of Object.entries(durations)) {
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) {
      result[file] = ms;
    }
  }
  return result;
}

// Wall time a shard spends before Vitest starts when it selects a suite that
// needs extra preparation. The manifest records only the time Vitest reports
// per file, so without this the balancer treats that shard as no heavier than
// the others. The built-server restart suite makes run-vitest-stable.mjs run
// `pnpm --filter @paperclipai/server build` and `build:runtime` first, which
// includes a cold release cargo build of the Runner: 298s, 377s and 377s in
// PR runs 43604552172, 43611423219 and 43625233041 (2026-11-14). That shard
// was cancelled at the 20 minute job limit after 52 of 65 files.
export const GENERAL_SERVER_SUITE_PREPARATION_MS = Object.freeze({
  "server/src/__tests__/scheduled-work-server-restart.integration.test.ts": 380_000,
});

// Adds each suite's preparation cost to its measured duration, so the
// partition accounts for the whole time the shard job spends on that suite.
export function withSuitePreparationCost(
  durations,
  preparation = GENERAL_SERVER_SUITE_PREPARATION_MS,
) {
  const fallbackWeight = defaultSuiteWeight(durations);
  const result = { ...durations };
  for (const [file, ms] of Object.entries(preparation)) {
    result[file] = (durations[file] ?? fallbackWeight) + ms;
  }
  return result;
}

// Weight assigned to suites absent from the manifest (new or renamed files).
// The median keeps one unknown suite from skewing a shard the way a mean
// dragged up by a few 30s+ suites would.
export function defaultSuiteWeight(durations) {
  const values = Object.values(durations).sort((a, b) => a - b);
  if (values.length === 0) {
    return FALLBACK_SUITE_WEIGHT_MS;
  }
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

// Deterministic longest-processing-time partition: heaviest suite first, each
// assigned to the currently lightest shard. Ties break by file path and then
// by shard index, so every runner in the matrix computes the identical
// partition from the same checkout — that invariant is what makes the shards
// a complete, non-overlapping cover of the suite set.
export function partitionGeneralServerSuites(files, shardCount, durations = {}) {
  const fallbackWeight = defaultSuiteWeight(durations);
  const weighted = files
    .map((file) => ({ file, weight: durations[file] ?? fallbackWeight }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));

  const shards = Array.from({ length: shardCount }, () => ({ files: [], totalWeight: 0 }));
  for (const { file, weight } of weighted) {
    let target = 0;
    for (let index = 1; index < shards.length; index += 1) {
      if (shards[index].totalWeight < shards[target].totalWeight) {
        target = index;
      }
    }
    shards[target].files.push(file);
    shards[target].totalWeight += weight;
  }

  for (const shard of shards) {
    shard.files.sort((a, b) => a.localeCompare(b));
  }
  return shards;
}

export function selectGeneralServerShard(files, shardIndex, shardCount, durations = {}) {
  return partitionGeneralServerSuites(files, shardCount, durations)[shardIndex].files;
}
