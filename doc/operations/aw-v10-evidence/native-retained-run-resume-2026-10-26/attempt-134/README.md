# Retained concurrent Native chat, selected case attempt 134

Attempt 134 ran the one selected concurrent first-send case from `tests/e2e/agent-chat-sessions.spec.ts` against pinned Chromium after the operation-local shared-read routing and canonical-event stdout mirror removal. Snapshot, syntax, and exact-one-test list guards passed.

The unchanged 60-second completion predicate failed. The first run succeeded in about 41 seconds after 20 PRP events plus accepted/terminal events. The resumed run remained active after the 60-second wait. It committed 13 PRP events; at the final sample, `item.started` seq 13 had completed its append at about 22 seconds, then the consumer spent the remaining interval in `event_iterator_next`, waiting for a provider event. Per-event source access took 0.49–1.28 seconds; callback work took 0.45–1.18 seconds; run-event writes took 8–16 ms. Removing the duplicate structured stdout projection did not remove source traversal or the provider event gap.

The run's source snapshot was current and correctly bound to its issue/task owner, with exactly one comment input and no policy IDs. No blocked PostgreSQL backends were reported in the terminal evidence. The failure is not evidence that the privacy or event-write deadline should change.

After confirming attempt 134 had exited and no matching E2E server remained, stale processes were inspected: Runnerd PID 1677536 had PPID 1 and was bound to the failed resumed run `54b59e19-48d3-4c5f-b07b-59ac69f65d2b`; fixture PID 1677548 was its child; PID 1677555 was absent. Sent SIGTERM to PID 1677536. Both remaining entries became zombies adopted by PID 1, so neither is still executing. No unrelated process or test data was touched.
