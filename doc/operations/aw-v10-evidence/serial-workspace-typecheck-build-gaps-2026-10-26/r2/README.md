# Current workspace typecheck/build-gap run

This run used the actual pinned pnpm workspace inventory: **35 workspace package manifests, 35 checks executed**. It finished with **33 passing checks and 2 failures**. Both failures came from the same one remaining Server diagnostic error at `authorization.ts:684`, captured before the follow-up fix: `actorSource` could be `undefined` in the diagnostic row union. The Server package check and the `paperclipai` CLI package check both reached that shared source error. Root then fixed it with `actor.source ?? "unknown"` in diagnostic-only fields.

The other 33 package checks passed. Source snapshot and syntax checks, generated Help freshness, shared/SDK/eval-kernel emits, Runner vendor emit, migration numbering and safety checks, and Server runtime asset verification also passed. The earlier Runner type narrowing and Native `runId`/`receipt` errors were absent.

The run captured source head `94c3663541b14c6ee6e1cb19d748ac57ab54beab`, 309 copied files, Node `v24.19.0`, TypeScript `7.0.2`, and pinned pnpm `9.15.4`. It held `/workspace/v10-preparation/v10-pg-tests.lock` and ran no installs or ensure hooks. The Cloudflare bridge-template and untouched standalone Cloudflare sandbox packages were excluded from this workspace-only run; the bridge template is unchanged from the reviewed base and its `@cloudflare/workers-types` dependency is absent from the frozen lock graph.

The exact source pins, 35-entry inventory, package logs/results, and all prerequisite/runtime check logs are archived in this directory.
