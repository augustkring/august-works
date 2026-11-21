# Authenticated Native chat sidebar regression attempt 056

Fresh pinned-source run of the sidebar discovery test using system Chromium. The selected test was listed before launch, the same-snapshot native failure-log privacy regression passed, and all original assertions and timeouts were retained. The test passed, including the independent background Beta chat reaching idle. Provider tracing records only tool names, statuses, and bounded `get_task_context` envelope/content-item shape metadata; it does not record tool payload text.

The run exited 0. Numeric exit and full log are `test-exit.txt` and `playwright.log`; source hashes and browser traces/provider events are retained alongside them.
