# Native chat concurrent first-send attempt 034

This fresh-source one-test run listed the exact selected case and launched system Chromium. It exited 1 before invoking the fake Native provider. Both owner comments were accepted, but native run setup failed on a PostgreSQL deadlock while inserting an `observed` row into `native_run_finalizations` (`executeRun`, heartbeat.ts:23992). The server recorded two failed runs, then moved the issue to `blocked`; no agent replies were produced. This attempt does not validate the optimized reply path or the 033 timeout hypothesis.
