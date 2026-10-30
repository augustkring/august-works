# Attempt 090: retained-session recovery browser case

The pinned Playwright selector executed exactly one recovery test. Snapshot, syntax, socket/database preflights, and the exact-one-test listing passed. The test failed after 60 seconds in `idle()` for the second message: the issue was `blocked`, conversation `active`, one agent reply was present, and no live run remained.

The runner diagnostic was a conflicting duplicate settled `semantic_tool.result`. The fake fixture’s first correction included the resumed thread ID in its tool-call ID, but `thread/resume` preserves that ID across provider-process restarts, so it still collided with RunnerD’s retained receipt. The next fixture correction uses `process.pid` directly. This attempt did not reach source-loss or retained-run closure assertions.

Raw logs, pins, and exits are preserved. `SHA256SUMS` records every archived file.
