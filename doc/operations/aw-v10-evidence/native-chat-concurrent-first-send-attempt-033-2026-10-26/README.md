# Native chat concurrent first-send attempt 033

This run used a fresh current-source snapshot; snapshot, syntax, socket cleanup, and exact one-test listing passed. System Chromium and the pinned toolchain were used. The browser test ran once and exited 1.

Both concurrent chat-open POSTs returned 200, and the fake Native provider completed two turns with `final_item_emitted` and `turn_completed_emitted` for each process. The idle wait then timed out at 60 seconds with two agent replies but one live run still marked running; the issue remained `in_progress` and the conversation `active`. Post-failure persisted detail capture showed two succeeded heartbeat details with `nativePhase: committed`, while the concurrent live-run list had still included a running entry. This is evidence of a Native run/session finalization or conversation state-reset issue; it is not a pass.
