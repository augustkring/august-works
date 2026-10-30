# Manual Routine source authority regression r7, 2026-10-26

The original routine source owner admits only the current session Human who owns both the current manual Routine and its exact `manual` run. It checks the immutable run revision and reauthorizes the union of current and revision-bound Project/parent Task references in the same native source scope. Plugin-managed sources remain on their stricter binding path.

Fresh snapshot copied and verified 319 source files; Vite/Oxc syntax preflight passed 285/285. Full `server/src/__tests__/routines-e2e.test.ts` passed 11/11. Controls exercise the actual API-created manual run: current owner allowed; foreign Human, sessionless actor, and unbacked board key denied. Local-implicit access is tested by explicitly entering the private `withReadRoutineSources` capability and asserting 403 before the callback, preserving the separate legacy public-baseline query. An actual due scheduled run is also denied by the private manual-only capability.

Runner: from `/workspace/v10-dep-qualification/server`, `timeout 240s node /workspace/v10-dep-qualification/node_modules/vitest/vitest.mjs run src/__tests__/routines-e2e.test.ts --maxWorkers=1 --no-file-parallelism`, under `/workspace/v10-preparation/v10-pg-tests.lock`. Snapshot/parser logs, numeric test exit, full output, and source pins are preserved alongside this note.
