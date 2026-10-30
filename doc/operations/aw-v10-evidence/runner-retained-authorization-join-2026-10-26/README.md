# Retained runner authorization interruption

The completed-terminal-ACK case now passes: one executed, eighteen filtered. Its interruption check waits for the original authorization callback to start before aborting or advancing its existing deadline, then verifies the callback remains owned until joined. An early validation rejection is propagated rather than hanging the start barrier. Production authority checks are unchanged.

Earlier local r4/r5 failures are retained. Container PID 1 does not reap orphaned fixture processes, so r6 runs under a Linux child-subreaper wrapper; genuine absent-process checks remain strict. The preserved fake Codex fixture binary was restored only after its source hash matched the current fixture source; this is controlled fixture evidence, not a newly built production artifact. The subsequent fresh full-file r7 run passes all nineteen cases, with zero skips and exit 0. Its separate source pins are retained.
