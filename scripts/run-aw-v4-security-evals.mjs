#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, "evals", "aw-v4", "security-gates.json"), "utf8"),
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
    timeout: options.timeout ?? 30 * 60 * 1000,
  });
  if (result.error) {
    console.error(`[aw-v4-security] Failed to start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ["scripts/check-aw-v4-security-eval-coverage.mjs"]);

const tests = [
  ...new Set(
    manifest.gates.flatMap((gate) =>
      Array.isArray(gate.deterministicTests)
        ? gate.deterministicTests.map((evidence) => evidence.file)
        : [],
    ),
  ),
].sort();

if (tests.length === 0) {
  console.error("[aw-v4-security] No deterministic security suites selected.");
  process.exit(1);
}

if (
  process.env.CI === "true" &&
  process.platform === "linux" &&
  (!existsSync("/usr/bin/bwrap") || !existsSync("/usr/bin/prlimit"))
) {
  console.error(
    "[aw-v4-security] Generated-code sandbox prerequisites are unavailable in Linux CI; refusing to skip the sandbox hard gate.",
  );
  process.exit(1);
}

const tempParent = process.platform === "win32" ? os.tmpdir() : "/tmp";
const testRoot = realpathSync(mkdtempSync(path.join(tempParent, "aw-v4-sec-")));
const env = {
  ...process.env,
  CI: process.env.CI ?? "true",
  NODE_ENV: "test",
  PAPERCLIP_HOME: path.join(testRoot, "h"),
  PAPERCLIP_CONFIG: path.join(testRoot, "h", "config.json"),
  PAPERCLIP_INSTANCE_ID: `aw-v4-sec-${process.pid}`,
  TMPDIR: path.join(testRoot, "t"),
};
mkdirSync(env.PAPERCLIP_HOME, { recursive: true });
mkdirSync(env.TMPDIR, { recursive: true });

console.log(`[aw-v4-security] running ${tests.length} deterministic security suites`);

try {
  run(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "--project",
      "@paperclipai/server",
      "--exclude",
      "**/dist/**",
      "--no-file-parallelism",
      "--maxWorkers=1",
      "--pool=forks",
      "--isolate",
      "--allowOnly=false",
      ...tests,
    ],
    { env },
  );
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
