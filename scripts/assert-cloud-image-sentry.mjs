#!/usr/bin/env node
// Prove two things about the target image's server directory, in order:
//
// 1. The tsx loader still resolves for workers loading workspace TypeScript.
//    The server production command itself starts the bundle with plain Node.
// 2. The installed `@sentry/node` package resolves, the same way the
//    server's own peer-version gate does
//    (server/src/peer-version-check.ts). Then print its version.
//
// Exit non-zero, with a clear message on standard error, when either check
// fails. Print only the version string on standard output on success.
//
// Mount this file at a path inside the target image's server directory and
// run it there with `node`, so module resolution walks the same
// `node_modules` tree the running server itself resolves from:
//
//   docker run --rm \
//     -v "$PWD/scripts/assert-cloud-image-sentry.mjs:/app/server/.ci-sentry-probe.mjs:ro" \
//     --entrypoint node <image> /app/server/.ci-sentry-probe.mjs
import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = dirname(fileURLToPath(import.meta.url));

// Workers still use this loader. Follow symlinks to detect a cloud-stage
// package copy that shadows the pnpm store link.
const tsxLoaderPath = join(serverDir, "node_modules", "tsx", "dist", "loader.mjs");
try {
  realpathSync(tsxLoaderPath);
} catch (error) {
  console.error(
    `could not resolve ${tsxLoaderPath}: workers loading workspace TypeScript require this loader (${error.message})`,
  );
  process.exit(1);
}

// Proves the ECMAScript import path resolves. `require.resolve` below
// checks the CommonJS path; the server needs both to succeed.
await import("@sentry/node");

const require = createRequire(import.meta.url);
let dir = dirname(require.resolve("@sentry/node"));
for (;;) {
  const candidate = join(dir, "package.json");
  if (existsSync(candidate)) {
    const parsed = JSON.parse(readFileSync(candidate, "utf8"));
    if (parsed.name === "@sentry/node") {
      process.stdout.write(parsed.version);
      process.exit(0);
    }
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}
console.error("could not resolve the installed @sentry/node package");
process.exit(1);
