# Attempt 091: retained-session recovery browser case

The pinned Playwright selector executed one test; snapshot, syntax, socket/database preflights, and exact-one-test listing passed. The first chat send never settled. At the 60-second idle deadline, the task remained `in_progress` / `active`, there were zero agent replies, and one live run remained.

The bounded fake-provider trace recorded 49 `get_task_context` calls in the same turn, each returning `semantic_tool_bridge_failed`; only one `get_task_history` succeeded. This shows the source/recovery assertions were not reached. The default server error logger retained only a generic thrown-error object, so this attempt does not identify the underlying dispatch exception.

Attempt 090 showed the thread-ID nonce still collided after `thread/resume`; this attempt used a process-ID nonce, so the remaining first-send failure is separate from that call-ID collision. A one-shot opt-in diagnostic was added at the semantic authority dispatch boundary after this snapshot for the next attempt.

Raw logs, provider trace, pins, and numeric exits are preserved. `SHA256SUMS` records every archived file.
