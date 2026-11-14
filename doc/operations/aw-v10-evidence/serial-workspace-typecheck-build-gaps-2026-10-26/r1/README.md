# Serialized workspace typecheck/build-gap baseline

The reviewed serial runner completed all **45** package typecheck entries from qualification CWD, with **32 passing and 13 failing**. Source snapshot, generated Help check, workspace inventory, shared/SDK/eval-kernel emits, Runner contract checks, migration numbering/safety, runtime asset verification, and the UI build-mode check passed. Runner vendor emit stopped on the same `native-mcp.ts` type error as the Runner package check.

This is a captured baseline, not current-source validation. Its source head was `94c3663541b14c6ee6e1cb19d748ac57ab54beab`, before the subsequent History `native-mcp.ts` fix, Root authorization diagnostic fix, and Binary `native-direct-input.ts` fix. The affected current-source failures were:

- `packages/paperclip-runner/src/drivers/native-mcp.ts:42`: three `string | undefined` assignments. History fixed this after the snapshot.
- `server/src/services/authorization.ts:684–696`: diagnostic union typing and undefined `caller`. Root fixed the current caller scope after the snapshot.
- `server/src/services/native-direct-input.ts:3321`: invalid `runId` and `receipt` references. Binary fixed the source after the snapshot.

The remaining non-source failures were excluded packages with dependencies absent from the qualification workspace links: eight sandbox provider manifests could not resolve `@types/node`; the orchestration example could not resolve `@paperclipai/plugin-sdk` and React; and the excluded Cloudflare bridge template could not resolve `@cloudflare/workers-types`. The required `@cloudflare/workers-types` package was absent from the qualification `.pnpm` store and the lockfile has no importer for the excluded template. No install or ensure hook ran. Existing exact sandbox/example links can be materialized from the main workspace graph with a receipt; the bridge-template dependency cannot be qualified without adding/fetching a package.

The run used pinned pnpm `9.15.4`, Node `v24.19.0`, and TypeScript `7.0.2`. It held `/workspace/v10-preparation/v10-pg-tests.lock`; total elapsed time was about 5 minutes 34 seconds. The source pins, inventory, per-package logs, exits, runner metadata, and exact results are archived in this directory.
