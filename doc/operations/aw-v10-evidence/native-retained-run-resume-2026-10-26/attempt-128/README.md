# Attempt 128: instrument the retained concurrent first-send case

The exact selected Playwright case ran from source snapshot `c397c4282a60ed4709cd3fa4b579bab8e8701235` with ControlPlanePort append-stage and consumer diagnostics enabled. The existing 60-second idle assertion failed (test exit 1).

Run `4a1ced10-579c-442a-8299-4cdb4a69acf4` succeeded and finalized. The second same-session run, `0daef445-3650-4a52-90f1-c60ee4a603e0`, was still running at the failure-only capture; its latest durable run event was `item.started` sequence 13, with no result or finalization. Its provider process (PID 1635398, parent runner PID 1635386) was alive and had emitted one final item and one `turn_completed`. After the test timed out and cancelled it, the run later emitted `run.result.proposed`, `turn.completed`, `run.result.accepted`, and `run.terminal`.

The consumer was not stalled on the durable event append: at 20 seconds it had committed through sequence 13, and by 25 seconds through sequence 18. Port instrumentation recorded entry and schema validation for each append, with no append progress timer, so no individual transaction or callback remained pending for five seconds. Both runner turns eventually emitted their final items and `turn_completed`. The failure-time database sample showed four short waits on the `business-event-privacy` advisory key (query ages 16–478ms; transaction ages 22–479ms), with a `heartbeat_runs` select as blocker; this is not evidence of a sustained deadlock.

A source denial occurred while checking a run already in `succeeded` status; the existing terminal-run recheck accepted it as a late output callback. More denials followed test cancellation. The test's 60-second deadline began before the second same-session turn had completed; this evidence does not support extending that timeout or changing privacy authorization.

The full test log contains event counts/timings, the failure-time run/checkpoint/PG-wait facts, and exact pins. This is diagnostic evidence, not a pass.
