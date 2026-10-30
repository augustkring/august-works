# Attempt 123: concurrent first-send stage watchdog

The selected concurrent first-send Playwright case ran on fresh pins including migration 0553 and failed the existing 60-second idle predicate. The first run succeeded and finalized. The second remained `running` at native phase `observed`, without a result proposal, finalization, or workspace operation. Both fake provider processes emitted `turn_completed`; one process remained alive at failure capture.

The failure-only database sample showed three waiters on the `business-event-privacy` advisory key, with several short-lived transactions queued behind a current holder. This does not establish a sustained deadlock. The server startup diagnostic confirmed the concurrent-chat probe flag was enabled, but neither the runner `consumeTurn` stage timer nor the heartbeat `onLog` timer emitted a pending-stage line. The current stuck await therefore remains unlocalized; the next attempt switches the runner probe to direct stderr output.

This is a failed diagnostic run, not a pass. Raw log, source pins, preflight/list receipts, numeric exits, and synthetic provider events are retained.
