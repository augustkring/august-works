# RT01 deterministic heartbeat ordering test attempt (r11)

Fresh source snapshot, syntax validation, Runner emit, and semantic catalog check all exited 0. The targeted PostgreSQL fixture reached the deterministic race: its first branch observed admission blocked by the heartbeat transaction's host-row lock, then the heartbeat updated the cell and committed; admission completed successfully. This verifies the intended host-before-cell order under a real PostgreSQL lock wait.

The second, fail-closed branch did not complete: its fixture tried the invalid `runtime_hosts.status = 'FENCED'` value and PostgreSQL rejected it against `runtime_hosts_status_ck`. The attempt therefore exits 1 and is not a passing targeted suite. r12 changes the fixture to a supported degraded host state and retests both branches.
