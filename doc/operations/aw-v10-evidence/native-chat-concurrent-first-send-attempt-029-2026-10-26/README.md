# Native chat concurrent first-send attempt 029

This focused Playwright run used a fresh current-source snapshot; snapshot, syntax, socket cleanup, and exact one-test listing passed. The browser test ran once and exited 1.

The exact owner-shell admission now permits one first Human comment (201), but the concurrent chat-open call fails with 500 because its `FOR SHARE NOWAIT` shell check collides with the first comment transaction’s issue-row lock. That prevents the second comment from being posted. The first Native run starts; its `get_task_context` calls fail, then the executor reports `Native task source access is unavailable` (`analytical_source_access_lost`) and the run is cancelled. A `native_finalization_missing` reconciliation warning follows. The provider event trace contains no `final_item_emitted` or `turn_completed_emitted` entries, so finalization has not been validated.
