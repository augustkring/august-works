# RT01 host/cell race regression r17

The locked current-source snapshot, syntax scan, Runner TS emit, and semantic catalog check all exited 0. Vitest's completed report records the selected `admits a qualified native Task through the HTTP route` PostgreSQL integration test passed, with 12 sibling tests skipped. That selected case runs the deterministic heartbeat-host-lock versus task-admission race and the fail-closed host-change branch.

The detached wrapper was killed by execution-context cleanup after Vitest wrote its complete success report but before the shell wrote `targeted-test.exit` and `exit`; those markers are intentionally absent. This was caused by launching it with `nohup ... &` under the managed exec context, which cleans up orphaned processes; cgroup memory counters are not attributed as the cause. The log itself retains the full Vitest completion summary. This attempt does not include the subsequent C0 full-five run.
