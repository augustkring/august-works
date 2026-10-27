# Attempt 118: late output and concurrent second run

The selected concurrent first-send Playwright case ran on a fresh source snapshot and failed its 60-second idle predicate. One Native run was `succeeded`, while a second same-session run remained `running`; their stored input receipts, generation, checkpoint identity, intent/dispatch counts, and result-capture counts were consistent.

The terminal source-access denials still appear in the log because the authorization check itself correctly denies reads of a terminal run. Unlike attempt 117, this attempt did not produce a heartbeat execution failure or cancellation after those denials, consistent with the new late-chunk drop. The remaining live run and timeout are unresolved and require separate diagnosis. This is not a pass.
