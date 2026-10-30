# Manual Routine source authority regression, 2026-10-26

The Routine source owner now admits only a current session Human who owns both the current manual Routine and its exact `manual` run. It checks the immutable revision and reauthorizes the union of current and revision-bound Project/parent Task references in the same native source scope. Plugin-managed sources remain on their stricter binding path.

Fresh snapshot copied and verified 319 source files; Vite/Oxc syntax preflight passed 285/285. Full `server/src/__tests__/routines-e2e.test.ts` passed 11/11. The test includes a positive current Human manual-run read, denials for a foreign Human, a sessionless actor, an unbacked board key, and a real scheduled run source.

Runner: from `/workspace/v10-dep-qualification/server`, `timeout 240s node /workspace/v10-dep-qualification/node_modules/vitest/vitest.mjs run src/__tests__/routines-e2e.test.ts --maxWorkers=1 --no-file-parallelism`, under `/workspace/v10-preparation/v10-pg-tests.lock`. Snapshot and parser logs, numeric test exit, full test output, and source pins are preserved alongside this note.
