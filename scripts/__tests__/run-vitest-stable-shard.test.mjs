import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  defaultSuiteWeight,
  loadShardDurations,
  partitionGeneralServerSuites,
} from "../general-server-shard.mjs";

import { assertSelectedTests, partitionTestLines } from "../test-line-shard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repoRoot, "scripts", "run-vitest-stable.mjs");
const durationsManifest = path.join(repoRoot, "scripts", "general-server-shard-durations.json");
const serializedDurationsManifest = path.join(
  repoRoot,
  "scripts",
  "serialized-shard-durations.json",
);

// Membership of general-server-without-chat depends on GITHUB_WORKFLOW (see
// prWorkflowName in run-vitest-stable.mjs), so strip the ambient value and
// make every test pin the caller it mirrors explicitly — these tests
// themselves run inside a workflow on CI.
function workflowEnv(envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  if (!("GITHUB_WORKFLOW" in envOverrides)) {
    delete env.GITHUB_WORKFLOW;
  }
  return env;
}

function dryRun(args, envOverrides = {}) {
  const result = spawnSync(process.execPath, [script, ...args, "--dry-run"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: workflowEnv(envOverrides),
  });
  return result;
}

function dryRunJson(args, envOverrides = {}) {
  const result = dryRun(args, envOverrides);
  assert.equal(result.status, 0, `expected success for ${args.join(" ")}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const SHARD_COUNT = 12;
const SERIALIZED_SHARD_COUNT = 9;


test("the serialized shards form a complete, non-overlapping partition", () => {
  const shards = Array.from({ length: SERIALIZED_SHARD_COUNT }, (_, index) =>
    dryRunJson(["--mode", "serialized", "--shard-index", String(index), "--shard-count", String(SERIALIZED_SHARD_COUNT)]),
  );

  const total = shards[0].serializedSuiteCount;
  const selected = shards.flatMap((shard) => shard.selectedSerializedSuites);
  assert.equal(selected.length, total, "every serialized suite must be selected exactly once");
  assert.equal(new Set(selected).size, total, "serialized shards must not overlap");
});

test("the general-server shards form a complete, non-overlapping partition", () => {
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", String(index), "--shard-count", String(SHARD_COUNT)]),
  );

  const total = shards[0].generalServerSuiteCount;
  assert.ok(total > 0, "expected a non-empty general-server suite set");

  const seen = new Set();
  let selectedTotal = 0;
  for (const shard of shards) {
    assert.equal(shard.generalServerSuiteCount, total, "suite count must be stable across shards");
    for (const file of shard.selectedGeneralServerSuites) {
      assert.ok(!seen.has(file), `suite assigned to more than one shard: ${file}`);
      seen.add(file);
      selectedTotal += 1;
    }
  }

  // Every suite runs exactly once: union covers the whole set with no overlap.
  assert.equal(selectedTotal, total, "every suite must be selected exactly once");
  assert.equal(seen.size, total, "union of shards must cover the whole suite set");
});

test("only the shard selecting the built-server restart suite prepares the runtime bundle", { skip: process.platform === "win32" }, () => {
  const restartSuite = "server/src/__tests__/scheduled-work-server-restart.integration.test.ts";
  const selectedShard = Array.from({ length: SHARD_COUNT }, (_, index) => ({
    index,
    files: dryRunJson([
      "--mode", "general", "--group", "general-server",
      "--shard-index", String(index), "--shard-count", String(SHARD_COUNT),
    ]).selectedGeneralServerSuites,
  })).find((shard) => shard.files.includes(restartSuite));
  assert.ok(selectedShard, "the restart integration suite must belong to one general-server shard");
  const unrelatedShard = Array.from({ length: SHARD_COUNT }, (_, index) => ({
    index,
    files: dryRunJson([
      "--mode", "general", "--group", "general-server",
      "--shard-index", String(index), "--shard-count", String(SHARD_COUNT),
    ]).selectedGeneralServerSuites,
  })).find((shard) => !shard.files.includes(restartSuite));
  assert.ok(unrelatedShard, "another shard must not select the restart integration suite");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "vitest-build-preflight-"));
  const fakeBin = path.join(tempRoot, "bin");
  const capturedCommands = path.join(tempRoot, "commands.jsonl");
  mkdirSync(fakeBin);
  const fakePnpm = path.join(fakeBin, "pnpm");
  writeFileSync(fakePnpm, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.PNPM_CAPTURE, JSON.stringify(process.argv.slice(2)) + '\\n');
`);
  chmodSync(fakePnpm, 0o755);
  const runShard = (index) => spawnSync(process.execPath, [script,
    "--mode", "general", "--group", "general-server",
    "--shard-index", String(index), "--shard-count", String(SHARD_COUNT),
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: workflowEnv({
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      PNPM_CAPTURE: capturedCommands,
    }),
  });
  try {
    const targetRun = runShard(selectedShard.index);
    assert.equal(targetRun.status, 0, targetRun.stderr);
    const targetCommands = readFileSync(capturedCommands, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(targetCommands.slice(0, 2), [
      ["--filter", "@paperclipai/server", "build"],
      ["--filter", "@paperclipai/server", "build:runtime"],
    ]);
    assert.ok(targetCommands[2].includes("vitest"), "the selected shard must launch Vitest after preparation");

    rmSync(capturedCommands, { force: true });
    const unrelatedRun = runShard(unrelatedShard.index);
    assert.equal(unrelatedRun.status, 0, unrelatedRun.stderr);
    const unrelatedCommands = readFileSync(capturedCommands, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(unrelatedCommands.length, 1, "an unrelated shard should launch Vitest without either build");
    assert.ok(unrelatedCommands[0].includes("vitest"));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a route/authz suite never leaks into the general-server shards", () => {
  const shard = dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", "0", "--shard-count", SHARD_COUNT.toString()]);
  for (const file of shard.selectedGeneralServerSuites) {
    assert.ok(
      !/[^/]*(?:route|routes|authz)[^/]*\.test\.ts$/.test(file),
      `route/authz suite must stay in the serialized lane, not general-server: ${file}`,
    );
  }
});

test("shard flags are rejected for the workspaces-b group", () => {
  const result = dryRun(["--mode", "general", "--group", "general-workspaces-b", "--shard-index", "0", "--shard-count", "3"]);
  assert.notEqual(result.status, 0, "workspaces-b must not accept shard flags");
});

test("workspaces-a shards map to Vitest native --shard slices over a stable project list", () => {
  const shards = [0, 1].map((index) =>
    dryRunJson([
      "--mode", "general", "--group", "general-workspaces-a",
      "--shard-index", String(index), "--shard-count", "2",
    ]),
  );

  assert.deepEqual(
    shards.map((shard) => shard.workspacesVitestShard),
    ["1/2", "2/2"],
    "each matrix job must pass its own --shard slice to vitest",
  );
  // Vitest's --shard partitions each project's file list deterministically, so
  // an identical project list across jobs is what guarantees complete,
  // non-overlapping coverage of the lane.
  assert.deepEqual(shards[0].workspaceProjects, shards[1].workspaceProjects);
  assert.ok(shards[0].workspaceProjects.length > 0, "workspaces-a must run at least one project");

  const unsharded = dryRunJson(["--mode", "general", "--group", "general-workspaces-a"]);
  assert.deepEqual(
    unsharded.workspaceProjects,
    shards[0].workspaceProjects,
    "sharding must not change which projects the lane covers",
  );
  assert.equal(unsharded.workspacesVitestShard, null);
});

test("workspace groups cover every declared root project exactly once for every caller", () => {
  // Read the deliberately static declaration without importing Vitest or its config graph.
  const config = readFileSync(path.join(repoRoot, "vitest.config.ts"), "utf8");
  const declaration = /projects:\s*\[([\s\S]*?)\]/.exec(config)?.[1];
  assert.ok(declaration, "expected the root project declaration");
  const literals = [...declaration.matchAll(/"([^"\n]+)"/g)];
  assert.equal(declaration.replace(/"[^"\n]+"/g, "").replace(/[\s,]/g, ""), "",
    "project declarations must stay explicit or this coverage check must be updated");
  const declared = literals.map(([, directory]) =>
    JSON.parse(readFileSync(path.join(repoRoot, directory, "package.json"), "utf8")).name);
  assert.equal(new Set(declared).size, declared.length, "root project names must be unique");
  const serverName = JSON.parse(readFileSync(path.join(repoRoot, "server", "package.json"), "utf8")).name;
  assert.ok(declared.includes(serverName), "the server must remain a root project");
  for (const caller of [undefined, "PR", "Release", "Cloud"]) {
    const env = caller === undefined ? {} : { GITHUB_WORKFLOW: caller };
    const selected = [serverName, ...["general-workspaces-a", "general-workspaces-b"].flatMap(group =>
      dryRunJson(["--mode", "general", "--group", group], env).workspaceProjects)];
    assert.equal(new Set(selected).size, selected.length, `workspace groups must not overlap for ${caller ?? "local"}`);
    assert.deepEqual(selected.sort(), [...declared].sort(), `all root projects must run for ${caller ?? "local"}`);
  }
});

test("duration-aware partition balances skewed weights better than round-robin", () => {
  // Round-robin puts all three heavy suites on shard 0 (indexes 0, 3, 6).
  const files = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  const durations = { a: 30000, d: 30000, g: 30000, b: 100, c: 100, e: 100, f: 100, h: 100, i: 100 };

  const shards = partitionGeneralServerSuites(files, 3, durations);
  const totals = shards.map((shard) => shard.totalWeight);
  const maxTotal = Math.max(...totals);
  const minTotal = Math.min(...totals);
  assert.ok(
    maxTotal - minTotal <= 200,
    `expected near-even shard weights, got ${totals.join(", ")}`,
  );
  assert.equal(
    shards.flatMap((shard) => shard.files).sort().join(","),
    files.join(","),
    "partition must cover every file exactly once",
  );
});

test("the partition is deterministic for identical inputs", () => {
  const files = Array.from({ length: 50 }, (_, index) => `suite-${index}.test.ts`);
  const durations = Object.fromEntries(files.map((file, index) => [file, (index * 37) % 5000]));

  const first = partitionGeneralServerSuites(files, 3, durations);
  const second = partitionGeneralServerSuites(files, 3, durations);
  assert.deepEqual(first, second, "same inputs must always produce the same partition");
});

test("suites missing from the manifest get the median weight", () => {
  assert.equal(defaultSuiteWeight({ a: 100, b: 300, c: 900 }), 300);
  assert.equal(defaultSuiteWeight({ a: 100, b: 300, c: 500, d: 900 }), 400);
  assert.equal(defaultSuiteWeight({}), 1000, "empty manifest falls back to a fixed weight");
});

test("a missing or malformed manifest degrades to uniform weights", () => {
  assert.deepEqual(loadShardDurations(path.join(repoRoot, "scripts", "no-such-manifest.json")), {});

  const files = ["a", "b", "c", "d"];
  const shards = partitionGeneralServerSuites(files, 2, {});
  assert.equal(shards[0].files.length + shards[1].files.length, files.length);
  assert.equal(Math.abs(shards[0].files.length - shards[1].files.length), 0);
});

test("the checked-in manifest loads and covers most of the current suite set", () => {
  const durations = loadShardDurations(durationsManifest);
  assert.ok(Object.keys(durations).length > 0, "manifest must parse to a non-empty duration map");

  const shard = dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", "0", "--shard-count", "1"]);
  const currentFiles = shard.selectedGeneralServerSuites;
  const known = currentFiles.filter((file) => durations[file] !== undefined).length;
  assert.ok(
    known / currentFiles.length >= 0.5,
    `manifest is stale: only ${known} of ${currentFiles.length} suites have recorded durations — regenerate it from a recent PR run (see the manifest's $comment)`,
  );
});

test("the chat integration suite keeps a measured duration for duration-aware fallbacks", () => {
  // The PR and release matrices both run the chat suite in dedicated
  // line-sharded lanes, but the plain general-server group (local full runs)
  // still weighs it into the LPT partition; a median-fallback weight there
  // would silently overload whichever shard receives it.
  const chatSuite = "server/src/__tests__/chat-channels.integration.test.ts";
  const durations = loadShardDurations(durationsManifest);
  assert.ok(
    Number.isFinite(durations[chatSuite]),
    "the full chat cohort must have a measured duration, not the median fallback",
  );
});

test("the checked-in serialized manifest loads and covers most of the current suite set", () => {
  const durations = loadShardDurations(serializedDurationsManifest);
  assert.ok(Object.keys(durations).length > 0, "manifest must parse to a non-empty duration map");

  const shard = dryRunJson(["--mode", "serialized", "--shard-index", "0", "--shard-count", "1"]);
  const currentFiles = shard.selectedSerializedSuites;
  const known = currentFiles.filter((file) => durations[file] !== undefined).length;
  assert.ok(
    known / currentFiles.length >= 0.5,
    `manifest is stale: only ${known} of ${currentFiles.length} suites have recorded durations — regenerate it from a recent PR run (see the manifest's $comment)`,
  );
});

test("the real serialized shard partition is duration-balanced", () => {
  const durations = loadShardDurations(serializedDurationsManifest);
  const fallback = defaultSuiteWeight(durations);
  const shards = Array.from({ length: SERIALIZED_SHARD_COUNT }, (_, index) =>
    dryRunJson(["--mode", "serialized", "--shard-index", String(index), "--shard-count", String(SERIALIZED_SHARD_COUNT)]),
  );

  const totals = shards.map((shard) =>
    shard.selectedSerializedSuites.reduce((sum, file) => sum + (durations[file] ?? fallback), 0),
  );
  const maxTotal = Math.max(...totals);
  const minTotal = Math.min(...totals);
  // LPT keeps the spread within the heaviest single suite; use that as the bound.
  const heaviest = Math.max(...Object.values(durations));
  assert.ok(
    maxTotal - minTotal <= heaviest,
    `serialized shard weight spread ${maxTotal - minTotal}ms exceeds heaviest suite ${heaviest}ms: ${totals.join(", ")}`,
  );
});

test("the real shard partition is duration-balanced", () => {
  // Mirrors the PR matrix: general-server-without-chat across SHARD_COUNT
  // runners, with the chat suite carried by the dedicated general-chat lanes
  // and the native-runner suite by the Rust-cached PR vitest lane.
  const durations = loadShardDurations(durationsManifest);
  const fallback = defaultSuiteWeight(durations);
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    dryRunJson(
      ["--mode", "general", "--group", "general-server-without-chat", "--shard-index", String(index), "--shard-count", String(SHARD_COUNT)],
      { GITHUB_WORKFLOW: "PR" },
    ),
  );

  const totals = shards.map((shard) =>
    shard.selectedGeneralServerSuites.reduce((sum, file) => sum + (durations[file] ?? fallback), 0),
  );
  const maxTotal = Math.max(...totals);
  const minTotal = Math.min(...totals);
  // LPT keeps the spread within the heaviest single suite; use that as the
  // bound. The chat and native-runner suites run in their own lanes, so
  // exclude them here.
  const chat = "server/src/__tests__/chat-channels.integration.test.ts";
  const nativeRunner =
    "server/src/services/native-runtime/native-codex-runner.integration.test.ts";
  const heaviest = Math.max(
    ...Object.entries(durations)
      .filter(([file]) => file !== chat && file !== nativeRunner)
      .map(([, ms]) => ms),
  );
  assert.ok(
    maxTotal - minTotal <= heaviest,
    `shard weight spread ${maxTotal - minTotal}ms exceeds heaviest suite ${heaviest}ms: ${totals.join(", ")}`,
  );
});


const chatSuitePath = "server/src/__tests__/chat-channels.integration.test.ts";
const nativeRunnerSuitePath =
  "server/src/services/native-runtime/native-codex-runner.integration.test.ts";

const managedNativeSuitePaths = [
  "server/src/__tests__/heartbeat-comment-wake-batching-managed-positive.integration.test.ts",
  "server/src/__tests__/heartbeat-managed-chat-dispatch-boundaries.integration.test.ts",
  "server/src/__tests__/heartbeat-managed-chat-workspace-root.integration.test.ts",
  "server/src/__tests__/heartbeat-managed-native-interaction-retry.integration.test.ts",
  "server/src/__tests__/heartbeat-managed-native-selection-fence.integration.test.ts",
  "server/src/__tests__/heartbeat-managed-project-workspace.integration.test.ts",
  "server/src/__tests__/heartbeat-managed-scheduler.integration.test.ts",
  "server/src/__tests__/heartbeat-managed-serial-scheduler.integration.test.ts",
  "server/src/__tests__/helpers/managed-native-model-transport.test.ts",
  "server/src/__tests__/managed-worker-sandbox-lifecycle.integration.test.ts",
  "server/src/__tests__/native-memory-task-transaction-reuse.integration.test.ts",
  "server/src/__tests__/native-opencode-managed-session-resumption.integration.test.ts",
  "server/src/__tests__/native-payload-temporal-sources.integration.test.ts",
  "server/src/__tests__/v7-model-reservations.integration.test.ts",
  "server/src/services/native-runtime/heartbeat-managed-native-comment-handoff.integration.test.ts",
  "server/src/services/native-runtime/native-model-session-controller.integration.test.ts",
  "server/src/services/native-runtime/native-opencode-conversation-task-erasure.integration.test.ts",
  "server/src/services/native-runtime/native-opencode-managed-browser-governed-handoffs.integration.test.ts",
  "server/src/services/native-runtime/native-opencode-managed-browser-history-workflows.integration.test.ts",
  "server/src/services/native-runtime/native-opencode-managed-browser-repository.integration.test.ts",
  "server/src/services/native-runtime/native-opencode-managed-browser-sidebar-tool.integration.test.ts",
  "server/src/services/native-runtime/native-opencode-managed-browser-source-invalid.integration.test.ts",
  "server/src/services/native-runtime/native-opencode-managed-browser.integration.test.ts",
  "server/src/services/native-runtime/native-opencode-managed-conversation-frame.integration.test.ts",
  "server/src/services/native-runtime/native-opencode-managed-progress-conversation.integration.test.ts",
  "server/src/services/native-runtime/native-opencode-managed-project-create-wait.integration.test.ts",
  "server/src/services/native-runtime/native-opencode-managed-project-create.integration.test.ts",
  "server/src/services/native-runtime/native-opencode-managed-source.integration.test.ts"
];
const MANAGED_NATIVE_SHARD_COUNT = managedNativeSuitePaths.length;

// Mirrors pr-trusted.yml (12 shards, called by pr.yml so GITHUB_WORKFLOW is
// "PR"): the chat suite runs in its dedicated lanes and the cargo-dependent
// native-runner suite in the Rust-cached final Verify Paperclip Runner vitest
// shard, so together the three cover the full server group exactly.
test("PR server, managed Native, chat and Rust lanes form a complete non-overlapping cover", () => {
  const prEnv = { GITHUB_WORKFLOW: "PR" };
  const full = dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", "0", "--shard-count", "1"], prEnv);
  const shards = Array.from({ length: 12 }, (_, index) => dryRunJson([
    "--mode", "general", "--group", "general-server-without-chat",
    "--shard-index", String(index), "--shard-count", "12",
  ], prEnv));
  const files = shards.flatMap((shard) => shard.selectedGeneralServerSuites);
  assert.ok(!files.includes(chatSuitePath));
  assert.ok(!files.includes(nativeRunnerSuitePath));
  const managed = Array.from({ length: MANAGED_NATIVE_SHARD_COUNT }, (_, index) => dryRunJson([
    "--mode", "general", "--group", "general-server-managed-native",
    "--shard-index", String(index), "--shard-count", String(MANAGED_NATIVE_SHARD_COUNT),
  ], prEnv));
  const managedFiles = managed.flatMap(shard => shard.selectedGeneralServerSuites);
  assert.deepEqual(managedFiles.slice().sort(), managedNativeSuitePaths);
  assert.ok(managed.every(shard => shard.selectedGeneralServerSuites.length === 1),
    "every managed Native job must select exactly one whole file");
  assert.ok(managedFiles.every(file => !files.includes(file)), "managed files must not run in plain PR server shards");
  assert.deepEqual([...files, ...managedFiles, chatSuitePath, nativeRunnerSuitePath].sort(), full.selectedGeneralServerSuites.sort());
  assert.equal(new Set([...files, ...managedFiles]).size, files.length + managedFiles.length);
  assert.equal(new Set(files).size, files.length);
  const defaultRun = dryRunJson([], prEnv);
  assert.ok(defaultRun.generalServerSuiteCount === full.generalServerSuiteCount);
});

// Mirrors release-verify.yml (10 shards, called by the Release and Cloud
// readiness workflows) and local runs: no Rust-cached vitest lane exists
// there, so the native-runner suite must stay in the server shards.
for (const [caller, envOverrides] of [["Release", { GITHUB_WORKFLOW: "Release" }], ["Cloud", { GITHUB_WORKFLOW: "Cloud" }], ["renamed PR", { GITHUB_WORKFLOW: "PR renamed" }], ["no ambient workflow", {}]]) {
  test(`10 without-chat shards under ${caller} keep the native-runner suite and cover the server group with chat alone`, () => {
    const full = dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", "0", "--shard-count", "1"], envOverrides);
    const shards = Array.from({ length: 10 }, (_, index) => dryRunJson([
      "--mode", "general", "--group", "general-server-without-chat",
      "--shard-index", String(index), "--shard-count", "10",
    ], envOverrides));
    const files = shards.flatMap((shard) => shard.selectedGeneralServerSuites);
    assert.ok(!files.includes(chatSuitePath));
    assert.ok(files.includes(nativeRunnerSuitePath));
    assert.ok(managedNativeSuitePaths.every(file => files.includes(file)), "non-PR callers retain all managed Native files");
    assert.deepEqual([...files, chatSuitePath].sort(), full.selectedGeneralServerSuites.sort());
    assert.equal(new Set(files).size, files.length);
  });
}

test("the native-runner lane runs exactly the cargo-dependent vertical-slice suite", () => {
  const lane = dryRunJson(["--mode", "general", "--group", "general-server-native-runner"]);
  assert.deepEqual(lane.selectedGeneralServerSuites, [
    "server/src/services/native-runtime/native-codex-runner.integration.test.ts",
  ]);
});

test("shard flags are rejected for the native-runner group", () => {
  const result = dryRun(["--mode", "general", "--group", "general-server-native-runner", "--shard-index", "0", "--shard-count", "2"]);
  assert.notEqual(result.status, 0, "the native-runner lane is a single suite and must not accept shard flags");
});

// The PR-side exclusion above is safe only while the wiring it assumes holds:
// pr.yml (the caller whose name reusable pr-trusted.yml jobs see as
// GITHUB_WORKFLOW) is named PR, the sharded vitest lanes partition cleanly
// with exactly one final shard, and that lane's package script routes through
// the wrapper that runs the native-runner group.
test("the PR workflow wiring for the native-runner lane holds", () => {
  const prWorkflow = readFileSync(path.join(repoRoot, ".github/workflows/pr.yml"), "utf8");
  assert.match(prWorkflow, /^name: PR$/m,
    "renaming pr.yml silently moves the native-runner suite back into the uncached server shards");

  const trustedWorkflow = readFileSync(path.join(repoRoot, ".github/workflows/pr-trusted.yml"), "utf8");
  const lanes = [...trustedWorkflow.matchAll(/command: test:typescript:vitest --shard=(\d+)\/(\d+)/g)]
    .map((match) => [Number(match[1]), Number(match[2])]);
  assert.ok(lanes.length > 0, "expected sharded test:typescript:vitest lanes in pr-trusted.yml");
  assert.equal(new Set(lanes.map(([, count]) => count)).size, 1, "vitest lanes must agree on the shard count");
  const shardCount = lanes[0][1];
  assert.deepEqual(
    lanes.map(([index]) => index).sort((left, right) => left - right),
    Array.from({ length: shardCount }, (_, index) => index + 1),
    "vitest lanes must cover every shard exactly once",
  );
  assert.equal(lanes.filter(([index, count]) => index === count).length, 1,
    "exactly one final vitest shard carries the native-runner group");

  const runnerPackage = JSON.parse(
    readFileSync(path.join(repoRoot, "packages/paperclip-runner/package.json"), "utf8"),
  );
  assert.equal(runnerPackage.scripts["test:typescript:vitest"], "node ./scripts/run-pr-vitest-lane.mjs");
});

const laneWrapper = path.join(repoRoot, "packages/paperclip-runner/scripts/run-pr-vitest-lane.mjs");

function wrapperPlan(args, envOverrides = {}) {
  const result = spawnSync(process.execPath, [laneWrapper, ...args, "--dry-run"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: workflowEnv(envOverrides),
  });
  assert.equal(result.status, 0, `expected wrapper dry run to succeed for ${args.join(" ")}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

test("the PR vitest lane wrapper runs the native-runner group exactly on the final PR shard", () => {
  for (const [args, envOverrides, expected] of [
    [["--shard=1/2"], { GITHUB_WORKFLOW: "PR" }, false],
    [["--shard=2/2"], { GITHUB_WORKFLOW: "PR" }, true],
    [[], { GITHUB_WORKFLOW: "PR" }, true],
    [["--shard=2/2"], { GITHUB_WORKFLOW: "Release" }, false],
    [["--shard=2/2"], {}, false],
    [[], {}, false],
  ]) {
    const plan = wrapperPlan(args, envOverrides);
    assert.equal(plan.runNativeRunnerGroup, expected,
      `args ${JSON.stringify(args)} env ${JSON.stringify(envOverrides)}`);
    const commands = plan.plannedCommands.map((planned) => planned.args.join(" "));
    assert.ok(commands.some((command) => command.startsWith(`exec vitest run${args.length ? ` ${args.join(" ")}` : ""}`)),
      "the wrapper must pass shard flags through to vitest");
    assert.equal(
      commands.some((command) => command.includes("--group general-server-native-runner")),
      expected,
    );
  }

  const malformed = spawnSync(process.execPath, [laneWrapper, "--shard=nonsense", "--dry-run"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: workflowEnv({ GITHUB_WORKFLOW: "PR" }),
  });
  assert.notEqual(malformed.status, 0, "a malformed shard flag must fail rather than guess a lane");
});

const lineShardFile = path.join(repoRoot, "server/src/__tests__/chat-channels.integration.test.ts");
const caseAt = (line, name) => ({ name, file: lineShardFile, projectName: "@paperclipai/server", location: { line, column: 3 } });

test("test-line shards cover nested and parameterized cases exactly once without splitting a source line", () => {
  const cases = [caseAt(10, "suite > nested > first"), caseAt(10, "suite > nested > second"),
    caseAt(20, "same name"), caseAt(30, "same name"), caseAt(40, "last"), caseAt(50, "new case")];
  const shards = partitionTestLines(cases, 3, lineShardFile);
  assert.deepEqual(shards.map((shard) => shard.tests.length), [2, 2, 2]);
  assert.equal(shards.filter((shard) => shard.lines.includes(10)).length, 1);
  assert.equal(shards.find((shard) => shard.lines.includes(10)).tests.length, 2);
  assert.equal(shards.flatMap((shard) => shard.lines).length, 5);
  assert.deepEqual(shards.flatMap((shard) => shard.tests).sort((a, b) => a.location.line - b.location.line), cases);
  assert.deepEqual(partitionTestLines([...cases].reverse(), 3, lineShardFile).map((shard) => shard.lines), shards.map((shard) => shard.lines));
});

test("line-shard collection rejects empty, foreign, or unlocated tests and invalid shard counts", () => {
  const good = caseAt(10, "valid");
  for (const input of [[], null, [{ ...good, file: "/another.test.ts" }], [{ ...good, projectName: "wrong" }],
    [{ ...good, location: undefined }], [{ ...good, location: { line: 0 } }], [{ ...good, name: "" }]]) {
    assert.throws(() => partitionTestLines(input, 1, lineShardFile));
  }
  for (const count of [0, -1, 1.5, Infinity, 2]) assert.throws(() => partitionTestLines([good], count, lineShardFile));
});

test("filtered collection must match the exact assigned case identities, including duplicates", () => {
  const expected = [caseAt(10, "same"), caseAt(10, "same"), caseAt(20, "nested > case")];
  assertSelectedTests(expected, [...expected].reverse(), lineShardFile);
  for (const actual of [expected.slice(1), [...expected, caseAt(30, "extra")],
    [expected[0], expected[1], caseAt(20, "renamed")],
    [expected[0], expected[1], caseAt(21, "nested > case")]]) {
    assert.throws(() => assertSelectedTests(expected, actual, lineShardFile));
  }
});

test("managed Native selection is deterministic and the unsharded named group stays exact", () => {
  const args = ["--mode", "general", "--group", "general-server-managed-native"];
  const full = dryRunJson(args, { GITHUB_WORKFLOW: "PR" });
  assert.deepEqual(full.selectedGeneralServerSuites.slice().sort(), managedNativeSuitePaths);
  for (let index = 0; index < MANAGED_NATIVE_SHARD_COUNT; index++) {
    const shardArgs = [...args, "--shard-index", String(index), "--shard-count", String(MANAGED_NATIVE_SHARD_COUNT)];
    assert.deepEqual(dryRunJson(shardArgs, { GITHUB_WORKFLOW: "PR" }).selectedGeneralServerSuites,
      dryRunJson(shardArgs, { GITHUB_WORKFLOW: "PR" }).selectedGeneralServerSuites);
  }
});

test("the PR managed Native matrix covers every dedicated shard and keeps existing bounds", () => {
  const workflow = readFileSync(path.join(repoRoot, ".github/workflows/pr-trusted.yml"), "utf8");
  const rows = [...workflow.matchAll(/- group: general-server-managed-native\n\s+group_label: managed Native \((\d+)\/(\d+)\)\n\s+shard_index: (\d+)\n\s+shard_count: (\d+)/g)];
  assert.equal(rows.length, MANAGED_NATIVE_SHARD_COUNT);
  assert.deepEqual(rows.map(row => Number(row[3])), Array.from({ length: MANAGED_NATIVE_SHARD_COUNT }, (_, index) => index));
  assert.ok(rows.every(row => Number(row[2]) === MANAGED_NATIVE_SHARD_COUNT && Number(row[4]) === MANAGED_NATIVE_SHARD_COUNT));
  assert.equal((workflow.match(/if: matrix.group == 'general-server-without-chat' \|\| matrix.group == 'general-server-managed-native'/g) ?? []).length, 5,
    "both groups must use the same existing Node, pack, Chrome and sandbox prerequisites");
});

test("the managed Native execution path dispatches only its selected whole file", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "managed-native-dispatch-"));
  const bin = path.join(root, "bin"), captured = path.join(root, "commands.jsonl");
  mkdirSync(bin);
  const pnpm = path.join(bin, "pnpm");
  writeFileSync(pnpm, `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.PNPM_CAPTURE, JSON.stringify(process.argv.slice(2)) + '\\n');
`);
  chmodSync(pnpm, 0o755);
  try {
    for (let index = 0; index < MANAGED_NATIVE_SHARD_COUNT; index++) {
      const args = ["--mode", "general", "--group", "general-server-managed-native",
        "--shard-index", String(index), "--shard-count", String(MANAGED_NATIVE_SHARD_COUNT)];
      const selected = dryRunJson(args, { GITHUB_WORKFLOW: "PR" }).selectedGeneralServerSuites;
      const result = spawnSync(process.execPath, [script, ...args], {
        cwd: repoRoot, encoding: "utf8", env: workflowEnv({ GITHUB_WORKFLOW: "PR",
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, PNPM_CAPTURE: captured,
          PAPERCLIP_VITEST_REPORT_DIR: "" }),
      });
      assert.equal(result.status, 0, result.stderr);
      const commands = readFileSync(captured, "utf8").trim().split("\n").map(line => JSON.parse(line));
      assert.equal(commands.length, 1, "one Vitest invocation, no unrelated build or test command");
      assert.ok(commands[0].includes("vitest"));
      assert.deepEqual(commands[0].filter(value => value.endsWith(".test.ts")), selected);
      rmSync(captured);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AWV4 server jobs share the qualified Native observer installer", () => {
  const workflow = readFileSync(path.join(repoRoot, ".github", "workflows", "aw-v4-verification.yml"), "utf8");
  const helper = readFileSync(path.join(repoRoot, "scripts", "ci-install-managed-native-test-observers.sh"), "utf8");
  const job = (name) => {
    const start = workflow.indexOf(`\n  ${name}:`);
    assert.notEqual(start, -1, `expected ${name} job`);
    const tail = workflow.slice(start + 3);
    const nextJob = tail.search(/\n  [a-zA-Z][\w-]*:/);
    return workflow.slice(start, nextJob === -1 ? undefined : start + 3 + nextJob);
  };
  assert.match(job("tests"), /if: startsWith\(matrix\.partition, 'server-'\)[\s\S]*?run: bash scripts\/ci-install-managed-native-test-observers\.sh/);
  assert.match(job("security-regressions"), /if: contains\(needs\.security-regression-plan\.outputs\.selected_files_json, 'server\/'\)[\s\S]*?run: bash scripts\/ci-install-managed-native-test-observers\.sh/);
  const browserPredicate = /startsWith\("server\/src\/services\/native-runtime\/native-opencode-managed-browser"\) && value\.endsWith\("\.integration\.test\.ts"\)/;
  assert.match(job("tests"), /Select installed Chrome for managed browser fixtures[\s\S]*?selectedGeneralServerSuites[\s\S]*?PAPERCLIP_PLAYWRIGHT_EXECUTABLE/);
  assert.ok(browserPredicate.test(job("tests")), "AWV4 server shards select Chrome for every managed browser cohort");
  assert.match(job("security-regressions"), /Select installed Chrome for managed browser fixtures[\s\S]*?SELECTED_FILES_JSON[\s\S]*?PAPERCLIP_PLAYWRIGHT_EXECUTABLE/);
  assert.ok(browserPredicate.test(job("security-regressions")), "AWV4 security shards select Chrome for every managed browser cohort");

  const sessionQualification = helper.lastIndexOf("scripts/fixtures/native-session-handle-observer-check.mjs");
  const sessionFlag = helper.indexOf("PAPERCLIP_TEST_PRIVILEGED_SESSION_OBSERVER=1");
  const socketQualification = helper.lastIndexOf("scripts/fixtures/native-model-socket-observer-check.mjs");
  const socketFlag = helper.indexOf("PAPERCLIP_TEST_PRIVILEGED_MODEL_SOCKET_OBSERVER=1");
  assert.match(helper, /^set -euo pipefail/m);
  assert.ok(sessionQualification >= 0 && sessionQualification < sessionFlag,
    "the session-observer flag follows its finite qualification control");
  assert.ok(socketQualification >= 0 && socketQualification < socketFlag,
    "the model-socket flag follows its owner-qualification control");
});
