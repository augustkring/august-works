# Native conversation owner-shell heartbeat route check

This focused PostgreSQL integration test exercises the original authenticated route from conversation shell creation through the first Human comment to the configured heartbeat owner. It verifies foreign-Human and parent-linked-shell denials leave no comment and do not wake an agent; the valid owner comment seals the protocol-1 Task source and sends the exact comment wake to the injected heartbeat.

The first executed snapshot (r2) reached the allowed comment but failed only because the test expected a `wakeReason` field absent from the actual context. The corrected r3 run passed: 1 test passed, 37 filtered. Each run’s source pins, snapshot record, test log, and exit records are preserved here and checksummed in `SHA256SUMS`.

This proves the authenticated shell/comment route and configured wake-owner seam. It does not prove the subsequent managed OpenCode process, RuntimeControl credential mint, provider wire dispatch, or Project result capture.
