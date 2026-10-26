# Human Memory source qualification

The owner constructor only qualifies direct Human Memory with exact, current canonical Task evidence when the Task has its original protocol-1 manual-root snapshot with a valid digest/body hash and an empty source graph. It binds the Task body input and captured source provenance to the inserted Memory row. Nonempty or unsupported Task graphs remain protocol 0; this evidence does not claim qualification for every source family.

`focused5.log` and `focused5.exit` record the dependency-qualified PostgreSQL run (exit 0; 3 targeted tests passed, 6 skipped). The checks cover a private Task → Human Memory → Native Context witness, denial to another current Human, exact Task-plus-Context tuples and missing/forged tuple rejection, plus missing/invalidated Task snapshots, an expired persisted session with the original actor retained, and a foreign-company source.

`source-snapshot5.json` identifies every source file copied into `/workspace/v10-dep-qualification` for the three-test run. `revoke-focused1.log` and `.exit` record the follow-up revoke-owner run (exit 0; 1 passed, 8 skipped) after moving the evidence read inside the authorized transaction. `source-snapshot6.json` pins that final source copy.
