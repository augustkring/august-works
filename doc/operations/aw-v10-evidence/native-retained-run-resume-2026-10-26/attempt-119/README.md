# Attempt 119: concurrent first-send lifecycle facts

The selected concurrent first-send Playwright case ran on fresh source pins and failed its 60-second idle predicate. The late-terminal output path did not produce a heartbeat execution failure or terminalize the second run.

Failure-only fixture facts show the first Native run reached `committed`, persisted an accepted native result, and completed workspace finalization. The second run remained `running` at native phase `observed`, had no native result or committed finalization, no workspace operation, and heartbeat event counts only through `turn.accepted`. The fake provider trace recorded two completed turns in two provider processes; one process was still alive when sampled. PostgreSQL aggregates reported seven active backends waiting on advisory locks and seven blocked backends. These facts localize a separate wait before the second run's result proposal; they do not authorize a source-policy change.

The raw test log, source pins, preflight/list receipts, numeric exits, and synthetic provider-event trace are retained. This is a failed diagnostic run, not a pass.
