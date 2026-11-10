# Complete Native Text draft-controller coverage — 2026-11-10

All 32 current cases in `heartbeat-dependency-draft-controller.integration.test.ts` pass against source checkpoint `30d7827b7a2c84c6a7f25ff9e0cdb7809ddf7237`, in two disjoint 16-case cohorts. Each cohort records 16 passes and 16 unselected cases. Exact observed passing names match the intended cohort; together they cover all 32 unique cases without overlap or deletion.

The earlier all-at-once r328 stopped at its 360-second resource deadline after 23 passing cases. R329 completes the first 16 in 220.449 seconds; r330 completes the other 16 in 141.822 seconds. Both retain the same resource caps, stable source/input pins, zero OOM and clean owned PostgreSQL/runtime closure.

The cases exercise the installed Native Text controller, real PostgreSQL owners and controlled model transport, including source capture, Human review/continuation, comment ownership, concurrency, branch finalization, exact C0 admission, membership withdrawal, cancellation, concurrent Stop and durable Stop-intent failure. They do not qualify legacy OS-process/post-signal semantics, the separate channel retry matrix, external providers, physical production enforcement or release/operator/Human acceptance. Historical requirement and migration statuses remain unchanged.
