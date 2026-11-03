# Attempt 122: concurrent first-send stage and blocker sample

The selected concurrent first-send Playwright case ran on fresh pins that include migration 0553 and failed the existing 60-second idle predicate. The first run succeeded and finalized. The second stayed `running` at native phase `observed`, without a proposed result, finalization, or workspace operation. The provider trace contains two completed-turn events across two processes, with one process still alive at failure capture.

The failure-only PostgreSQL sample showed three blocked backends on the `business-event-privacy` advisory key. The holder's current statement was a `SELECT` from `heartbeat_runs` (transaction age about 295 ms; query age about 3 ms); waiters were about 84–128 ms into their transactions. This remains a short contention sample rather than proof of a sustained deadlock. The newly added `consumeTurn` and `onLog` stage watchdogs produced no records; the server startup marker did not yet include the concurrent-chat flag, so the server-side flag receipt remains unverified. A startup boolean was added for the next attempt.

This is a failed diagnostic run, not a pass. Raw log, source pins, preflight/list receipts, numeric exits, and synthetic provider events are retained.
