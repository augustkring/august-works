# UP13 fresh-server-build test preflight — 2026-10-26

The scheduled-work server restart test launches `server/dist-runtime/index.mjs`, so a fresh checkout must build the ordinary server first and then run its existing `build:runtime` script. `scripts/run-vitest-stable.mjs` now carries the selected server test file list into each Vitest invocation and runs those two original pnpm scripts only when that list contains `scheduled-work-server-restart.integration.test.ts`. Sharded and unsharded general-server selections are both explicit in the runner. Other server shards and the dedicated chat, native-runner, serialized, and non-server invocations remain build-free.

The UP13 test comment now documents that `pnpm test:run` owns build preparation and that direct Vitest use must perform the same two builds first. The test continues to spawn the actual emitted `index.mjs`; no fixture scheduler or alternate process was introduced.

## Verification

- `node --test scripts/__tests__/run-vitest-stable-shard.test.mjs`: exit 0, 25/25 passing. The new runner-wiring case locates the actual general-server shard containing the UP13 file, injects a temporary `pnpm` recorder, verifies `server build` then `build:runtime` before Vitest, and verifies a shard without UP13 launches only Vitest. Output/exit: `runner-wiring.log` and `.exit`.
- `git diff --check`: exit 0.
- A locked qualification source sync completed before attempting the original server build. The build stopped at TypeScript errors in concurrent Context/Memory owner files before runtime bundling or UP13 could run. Exact diagnostics and output are in `server-build.log`; numeric exit is `build-and-test.exit` (2). This task made no changes to those source-owner files and makes no claim that UP13 currently passes. Re-run original server build, runtime bundle, and UP13 after those owner fixes land.

## Successful qualification rerun

After the Context/Memory compile owners fixed the diagnostics, a second locked source sync/build succeeded: original `@paperclipai/server build`, then original `build:runtime` (2,231 inputs, 130 chunks), then `scheduled-work-server-restart.integration.test.ts` passed 1/1. The test launched the actual qualified `server/dist-runtime/index.mjs` three times, gracefully closed each process, recovered its deadline effect, and reported `duplicateOccurrences: 0`, `providerInvocations: 0`. The emitted evidence includes the exact bundle fingerprint and four source hashes in `up13-vitest-retry.log`; qualification source pins are in `source-pins-retry.json`. Per-step numeric exit files each contain 0. The first compile-failing attempt remains preserved separately.
