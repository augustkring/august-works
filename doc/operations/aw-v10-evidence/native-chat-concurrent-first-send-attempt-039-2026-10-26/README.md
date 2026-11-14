# Native chat concurrent first-send attempt 039 (2026-10-26)

Fresh pinned-source run of the exact concurrent-first-send Playwright case, using authenticated Native chat and system Chromium. The exact test was listed before execution. The run used the env-gated diagnostic that logs bounded PostgreSQL deadlock details without SQL or bind values.

The test exited 1 because the 60-second idle assertion expired while the second Native run still appeared `running`. Both provider turns successfully read task context and history and emitted final items plus `turn_completed`; this run did not report SQLSTATE `40P01` or a deadlock diagnostic. It does not establish a lifecycle-write failure. Attempt 038 separately captured the Task settled after its poll timeout. Keep attempt 034's observed finalization deadlock as separate unresolved evidence.

`test-exit.txt` records the numeric browser exit. `playwright.log`, trace, provider-event log, and source pins preserve the run evidence. Assertions and the 60-second budget were unchanged.
