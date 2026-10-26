# Chat publication authorization regression

The removed-wake FIFO notice path now validates the exact removed wake receipt and visible prior queued notice before allowing the soft-deleted source through Slack Board author authorization. Other wake publications retain their previous authorization order, and the linked-author/private-task checks remain active.

`fifo-072` records the isolated regression: 1 passed, 1,050 skipped; snapshot, syntax, test, and final exit codes are all 0.

`focused-073` records the complete focused set: 12 passed, 1,039 skipped; snapshot, syntax, test, and final exit codes are all 0. It covers the removed FIFO notice, composer guards, one-connection publication, attachment idempotency, reaction replay, and large comment publication.

The test logs include expected mocked wake retry warnings. The broad server typecheck r20 passed for the server before the FIFO authorization adjustment; a fresh server typecheck after that adjustment remains outstanding.
