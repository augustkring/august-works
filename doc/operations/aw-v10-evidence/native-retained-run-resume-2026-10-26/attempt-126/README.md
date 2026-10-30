# Attempt 126: correlate concurrent Native provider processes to runs

The selected concurrent first-send Playwright case ran on a fresh source snapshot with the 0553 migration preflight and failed the existing 60-second idle predicate (test exit 1). Provider process parent PIDs were matched to `heartbeat_runs.process_pid` in the failure-only facts.

Run `387dd43a-0095-4357-95f7-5cb313279096` completed successfully and finalized. Run `d79cf097-e220-491d-9afc-f1d62be5de10` remained `running` at native phase `observed` with no result/finalization. Provider PID 1630005, parent PID 1629993, matched the second run's recorded runner PID; it emitted one final item and one `turn_completed` and was alive at capture. Provider PID 1629765, parent PID 1629764, emitted one completed turn and was no longer alive; its first run had already finalized. This resolves the earlier ambiguity about which process remained alive.

The second runtime consumer last reported `item.started` at source sequence 13, stage `append_event`, while the failure-time run record had no `turn.started`, terminal event, result or finalization. No `native_concurrent_chat_append_event_progress` line appeared. The sampled PostgreSQL wait graph showed only short waits (roughly 0.3–0.6 seconds) on `business-event-privacy`, not evidence of a sustained database deadlock. The stuck boundary is unresolved: the run was awaiting completion of the `item.started` append before it could consume later events, but this attempt did not show a prolonged ControlPlanePort transaction or callback stage.

This is a failed diagnostic run, not a pass. Raw test log, exact source pins, preflight/list receipts, numeric exits, and synthetic provider event trace are retained.
