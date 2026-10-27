# Attempt 125: concurrent first-send event consumer progress

The selected concurrent first-send Playwright case ran on fresh pins including the PostgreSQL-verified 0553 migration and failed the existing 60-second idle predicate. The first run reached `run.result.proposed`, then succeeded and finalized. The second run remained `running` at native phase `observed`, without a result proposal, terminal run event, finalization, or workspace operation.

The env-gated runner progress watcher confirmed both `consumeTurn` loops continued receiving and committing events: the first reached `run.result.proposed` by 20 seconds; the second reached `item.started` sequence 17 by 25 seconds. The provider trace shows two completed-turn emissions across two processes, one process alive at failure capture; that process count alone does not identify which run retained it. The failure-only PostgreSQL snapshot again showed short waits on the `business-event-privacy` advisory key, with a current holder querying `issues`, not a sustained deadlock.

This is a failed diagnostic run, not a pass. Raw log, source pins, preflight/list receipts, numeric exits, and synthetic provider events are retained.
