# Plugin-managed routine source admission

Run r7 is an observed failure, not a green qualification. Source snapshot and syntax preflight both exited 0; the focused test failed at the unchanged 30-second test timeout, and `afterEach` then timed out while deleting a Routine still held by the in-flight source transaction.

The test’s current Human, manual Routine, exact plugin resource binding, revision, and `plugin_operation` template checks all passed. The managed Project existed and was open, but `sourceProvenanceQualified` was false, so the scoped admission path correctly declined it. PostgreSQL samples show the generic recursive `routine_run` privacy query active with no wait event. Its transaction then blocked the cleanup DELETE on a transaction ID; this is slow closure execution with cleanup fallout, not an external lock holder. The bounded source-caller stack is retained in the test log, and `pg_blocking_pids` plus bounded query prefixes are retained in `pg-activity.jsonl`.

The next fixture revision uses `createCanonicalHumanProject` with the current session actor and a real empty-source owner snapshot, then resolves the existing project through the plugin-managed binding service. The r7 source pins identify the exact dirty-tree file hashes used for this diagnostic run.
