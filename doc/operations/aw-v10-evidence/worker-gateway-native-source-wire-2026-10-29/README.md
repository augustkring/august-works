# Native Worker Model Gateway Source Wire Checkpoint

The final pinned server integration run passed 67/67 tests in 207.88 seconds. The frozen source hashes and wrapper receipts identify the tested source snapshot. Earlier failed r8 and diagnostic attempts are retained for chronology; the final run is `worker-gateway-final67-r2`.

The active-run fix accepts only `observed` or `running` Native finalization phases while requiring the heartbeat run itself to remain `running` and its finalization lease to remain live according to PostgreSQL `clock_timestamp()`. Actual scheduler rows are initially `observed`, so the previous `running`-only filter rejected dispatch before the provider call.

The hunk manifest separates this agent's predicate/test changes from the concurrent root and temporal source-binding changes. Tests use the existing controlled provider fixture and actual Native heartbeat/service path.

Source-pin maps are compressed without changing their raw bytes; `source-pins-compression.json` records both hashes. The phase diagnostic is retained separately and does not qualify the final source.
