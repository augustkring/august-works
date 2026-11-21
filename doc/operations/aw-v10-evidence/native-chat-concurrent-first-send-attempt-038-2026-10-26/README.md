# Native chat concurrent first-send attempt 038

Fresh-source authenticated Native chat run with system Chromium. The exact selected test was listed (1 test, 1 file), the source/syntax/socket/database preflights passed, and the bounded deadlock diagnostic was enabled. Both concurrent Human messages were accepted; both Native turns retrieved context/history successfully, emitted final items and `turn.completed`, and reached terminal `succeeded` states. No PostgreSQL deadlock diagnostic was recorded.

The test still exited 1 because the 60-second idle poll expired just before its final poll could observe the already-written `in_review`/`waiting` state. The final captured issue row had no active `executionRunId`. `playwright.log`, provider events, trace and source pins preserve the exact attempt. This is a failed timing assertion, not a passing chat test.
