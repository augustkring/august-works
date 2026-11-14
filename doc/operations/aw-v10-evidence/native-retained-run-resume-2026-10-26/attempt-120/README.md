# Attempt 120: concurrent first-send blocker chain

The selected concurrent first-send Playwright case ran on fresh source pins and failed the 60-second idle predicate. The late-terminal output callback still did not produce the earlier execution failure/cancellation cascade.

Failure-only DB lifecycle facts show the first run committed its accepted result and workspace finalization. The second remained `running` at native phase `observed`, without a result or finalization result ID. Its provider emitted two completed-turn events in two processes, one of which remained alive at capture. The live PostgreSQL blocker snapshot showed four active lock waits and a chain of three exclusive waiters on the same advisory key. The blocker was `idle in transaction` (about 0.95 seconds into its transaction at capture); no SQL text or bind values were logged. The exact finite application owner of the key remains to be mapped.

This is a failed diagnostic run, not a pass. Raw log, source pins, preflight/list receipts, numeric exits, and synthetic provider events are retained.
