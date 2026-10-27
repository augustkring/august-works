# Attempt 117: terminal Native run late-output authorization

The single selected concurrent first-send Playwright case ran against the pinned qualification snapshot and failed at the 60-second chat-idle predicate. Both first comments were accepted, but the assistant run did not settle in the UI.

The bounded source diagnostics establish the first relevant denial occurred in the heartbeat output callback (`heartbeat.ts:23067`) after the exact run row was already `succeeded`. The current principal check correctly rejected access to that terminal run. The later cancellation and source denials are cascading effects and are not treated as the root cause.

The raw Playwright log, source pins, preflight/list receipts, and numeric exits are retained here. This is a failed diagnostic run, not a pass.
