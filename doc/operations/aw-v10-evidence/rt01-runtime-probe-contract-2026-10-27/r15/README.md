# RT01 deterministic heartbeat lock-order regression (r15)

Fresh source snapshot, syntax validation, Runner TypeScript emit, and semantic catalog check all exited 0. The selected PostgreSQL integration test passed (1 passed, 12 skipped).

In the successful branch, a heartbeat-shaped transaction held the runtime host row FOR UPDATE, then admission was observed in `pg_stat_activity` waiting specifically on that transaction. The heartbeat transaction updated the host inventory timestamp and cell meter, committed, and admission returned the same host and cell identity. In the fail-closed branch, the host transitioned to a valid but non-admissible `BOOTSTRAPPING` state while admission waited; admission returned 409, the fixture restored READY, and the rest of the signed-host sandbox integration completed. A literal active-cell host rebind remains blocked by the existing database guard, so the negative race tests current host eligibility and the implementation separately rechecks the locked cell's host ID.

The enclosing signed-host fixture finished in 22.02 seconds. One expected cleanup log records a sibling heartbeat setup failure after its run had already been cancelled; the selected regression still passed without unhandled failures.
