# Task privacy prepared plans — 2026-10-28

The current Task reader builds a 193,350-character, 27-parameter query. On a real PostgreSQL ordinary private Task fixture, planning took 55–74 ms versus 6–14 ms execution. Changing transaction-local collapse limits did not consistently improve warm queries.

Explicit postgres-js preparation let PostgreSQL automatically reuse a generic plan after five custom plans. Eight warm, interleaved calls per mode measured:

| Execution | Median | Range |
| --- | ---: | ---: |
| Default `unsafe` | 87.31 ms | 86.24–91.78 ms |
| `unsafe(..., { prepare: true })` | 5.78 ms | 5.27–7.09 ms |

Every call checked current authorization: Alice allowed, Bob denied. Suspending Alice's membership denied immediately with both modes; restoring it allowed again. One prepared statement served different actor parameters. Counters ended at 12 generic / 5 custom plans. No forced plan setting was needed. Timings measure wall time; server counters demonstrate plan reuse, rather than a separate prepared EXPLAIN planning breakdown.

The implementation uses the existing public `db._.session` / `PostgresJsSession.client` seam only for the Task single/batch and original Run ACL id selects. It compiles the existing query and binds its original parameters, preserves the session logger, and leaves database/transaction objects and AsyncLocalStorage identity unchanged. The driver’s existing root `prepare: false` option overrides per-query preparation. There is no authorization-result cache, global driver wrapper, forced planner setting, retry, or DDL preparation.

## Verification

- DB package TypeScript check passed for the final Task + Run implementation (`task-run-privacy-prepared-implementation-r2-20261028`).
- `task-privacy-prepared-plan.integration.test.ts`: 2 passed, exit 0. Both preparation enabled and `DATABASE_PREPARED_STATEMENTS=false` are exercised. Final Task + Run checks cover both server plan counters, Alice/Bob separation, Task batch parity, nested uncommitted membership suspension for both readers, and savepoint rollback restoration. Final suite: 2 passed, exit 0, 24.64 seconds.
- All source snapshots and test/dependency hashes were captured before execution under the existing PostgreSQL lock. Raw output, exit codes, source pins, probe sources, and EXPLAIN JSON are retained here.
- Task-only implementation Native prefix characterization (`temporal-task-exact-acl-r70-20261028`): 1 passed, exit 0, 73.89 seconds. A sealed managed Native Memory output preserves Alice/Bob/revoked-Alice decisions and independent/same-transaction parity. Its source pins match the earlier Task-only prepared DB helper and authorization hashes; it predates the final Run-select preparation. A final-scope Native prefix pass is not claimed. This is a correctness qualification; the duration differs from the earlier fixture run and is not an isolated latency benchmark.
- The ordinary benchmark does not represent a Native temporal prefix. Browser attempt 146 failed case 7 at the unchanged 20-second predicate (1 failed, exit 1); the full eight-case suite was not run. Source access still consumed a median 862.5 ms per event, so Native browser performance remains unqualified.

Native browser evidence: `../native-retained-run-resume-2026-10-26/attempt-146/`. The original Task-only Native browser qualification failed. Diagnostic attempt 147 measured repeated unprepared original Run ACL reads; the final implementation adds preparation at that unchanged Run select. Browser attempt 148 failed the same unchanged 20-second predicate (1 failed, exit 1), despite a modest source-access median reduction to 786 ms. The full eight-case suite was not run. Native browser performance remains unqualified.
