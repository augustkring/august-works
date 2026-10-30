# Authenticated Native chat sidebar regression attempt 055

Fresh pinned-source run of the sidebar discovery test using system Chromium. The selected test was listed before launch, the same-snapshot native failure-log privacy regression passed, and all existing assertions and timeouts were retained. Sidebar interactions and draft assertions reached the separate background-chat idle check, which failed after 60 seconds: the Beta chat remained active with zero agent replies and its Native run still running. The bounded provider trace shows repeated `get_task_context` calls; it records only tool names, status, and limited shape fields, not tool payload text.

The run exited 1. Numeric exit and full log are `test-exit.txt` and `playwright.log`; source hashes and browser traces/provider events are retained alongside them. This is diagnostic failure evidence, not a pass.
