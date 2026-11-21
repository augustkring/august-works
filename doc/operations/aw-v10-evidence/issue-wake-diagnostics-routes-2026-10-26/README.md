# Issue wake diagnostics route qualification

Full Vitest file passed: 8 tests, 0 failures. This run used the qualified dependency worktree and a source snapshot captured under the shared PostgreSQL flock.

The test fixture uses persisted Human users, sessions, active memberships and canonical Human-created Projects. The cross-company case first verifies a successful same-company Human read, then uses a distinct Human/session for Company B and verifies the foreign issue returns the uniform 404. Agent diagnostics runs bind to the current Human as `onBehalfOfUserId` and each run's `responsibleUserId`.

Command, run from `/workspace/v10-dep-qualification/server` after sourcing `/workspace/v10-preparation/env.sh`, under `/workspace/v10-preparation/v10-pg-tests.lock`:

```sh
../node_modules/.bin/vitest run src/__tests__/issue-wake-diagnostics-routes.test.ts --maxWorkers=1
```

Source snapshot reports head `69b774c17497db81bbce15d08eec41531f9fbac2`, qualification base `886014cae5a7d6ed5a9ab99d62613ec7646308cb`, and test SHA-256 `e8e4cb16861233a9d9662f0c1e2439a2be656cf7143dd7ec3dabfd8842c1e426`. Snapshot, raw compressed test log and exit codes are included. An earlier failed attempt is retained only in `/workspace/v10-preparation`; it is not part of this successful evidence.
