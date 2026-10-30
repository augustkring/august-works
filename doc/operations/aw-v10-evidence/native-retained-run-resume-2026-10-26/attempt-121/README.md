# Attempt 121: concurrent first-send blocker owner

The selected concurrent first-send Playwright case ran on fresh source pins and failed the existing 60-second idle predicate. The first native run completed and finalized; the second remained `running` at native phase `observed`, with no result or workspace operation. Two provider processes emitted two completed turns, and one process remained alive at capture.

The failure-only PostgreSQL snapshot showed three blocked backends on the `business-event-privacy` advisory key. The sampled holder was running a `SELECT` from `context_manifests` (transaction age about 484 ms, query age about 1 ms); waiter transactions were about 100–200 ms old. This is a short contention sample, not evidence of a sustained deadlock. The repeated `model_reservations` reconciliation log carried SQLSTATE 42703 and predates the subsequently created 0553 migration, so it is not attributed to this failure.

This is a failed diagnostic run, not a pass. Raw log, source pins, preflight/list receipts, numeric exits, and synthetic provider events are retained.
