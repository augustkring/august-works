# Native chat single-session feature-flag attempt 035

Fresh snapshot, syntax, socket cleanup, and exact one-test listing passed. The selected browser test passed 1/1 in 29.9 seconds using system Chromium and the pinned toolchain. The fake Native turn succeeded through `get_task_context`, `get_task_history`, final item, and `turn.completed`; it did not make a `report_progress` call. The test also verified the feature-flag behavior and retained history.
