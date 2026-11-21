# Agent Platform Gateway replay evidence, 2026-10-28

`source-pins.json` was captured while holding `/workspace/v10-preparation/v10-pg-tests.lock`, then every changed source file passed the repository snapshot syntax checker. The focused server run passed the `Task progress replay routed` case (1 passed, 59 skipped).

The regression completes a first-party Task comment, then adds an argument-conditioned block for that exact comment and verifies the identical replay is denied without creating another comment. The replay branch now passes the original validated arguments to current policy evaluation and consumes current rate limits before re-entering the canonical semantic owner. The existing run, represented Human, Skill admission, task ACL, and operation-owner checks remain active. Unsupported first-party replay classes continue to fail closed.

After the Gateway test, the nested extension manifest gained the required `engines.node` value. `node-version-policy.log` records the passing repository check, and `extension-manifest.sha256` records the final manifest. The nested extension directory is not a pnpm workspace importer and has no child lockfile; `typebox` is a pinned direct dependency and `openclaw` is a peer. No lockfile generation or install was run.

OpenClaw vendor runtime conformance remains unqualified. The bridge boundary unit and selected delivery tests are archived in sibling `r1`; they do not replace the pinned-runtime integration lane.
