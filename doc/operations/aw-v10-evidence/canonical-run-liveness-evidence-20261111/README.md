# Canonical run-liveness evidence — R87, 11 November 2026

Live heartbeat classification and historical Activity backfill now share the exact company/issue/run/agent-owned dispatched-tool receipt query. Protocol event rows, environment leases and Tool Gateway admission/audit bookkeeping do not establish task progress. Denied or pre-dispatch failures are excluded; actually started unknown/failed/in-flight effects remain evidence so an uncertain dispatch is not automatically replayed as no work. Only exact built-in finish/block reports are excluded; actual connected tools retain their receipts. Aggregate timestamps use the database column decoder.

The Activity projection includes agentId before invoking this owner. No authorization, Source, budget, physical Stop or final-completion checks are weakened.

## Verification

- R567: 22 selected tests pass across canonical receipt ownership and pure run-liveness classification. The PostgreSQL case distinguishes exact scope, denied/preflight requests, built-in reports, real suffix-named tools, unknown dispatched effects and timestamps. This invocation precedes the Activity projection correction.
- R568: server typecheck failed because the Activity projection omitted agentId. It is retained privately as a failure, corrected before R569; no passing evidence is claimed for it.
- R569: server typecheck and build pass on the corrected production bytes; exact hashes and mtimes remain unchanged and temporary source protection is restored.
- R570: all 9 Activity service PostgreSQL tests pass, including paired protocol/audit-only versus dispatched-receipt backfill. Normal cleanup leaves no owned PostgreSQL/runtime process.
- R571: final server typecheck/build results and exact input pins are attached separately. Production and component-test bytes match R569/R570; only the new managed scheduler test polling/assertions changed afterward.

## Managed test candidates and limits

Three genuine managed OpenCode scheduler cases preserve plan-only bounded continuation, existing historical review ownership and saved-plan progress. They wait for persisted classification, assigned continuation Run and terminal child progress; the incomplete-finalization status wake must coalesce onto the active source before the later liveness child. These cases are partial counterparts of legacy stranded-run tests, not replacements for failed-run reconciliation or issue_disposition_repair.

A fourth real dispatch-boundary case holds the exact issue row through an independent PostgreSQL connection, observes original NOWAIT retry SQLSTATE55P03, publishes close while held, releases and checks cancellation without a new provider call. The original three cases remain.

These new managed cases have not passed actual SDK/Host execution. R86 CI exposes an earlier strict chat-workspace selector denial before provider dispatch; its exact cause remains open. A separate later Host scope-read omission is being repaired independently. No legacy positive is retired or reclassified as a denial success. Full current-head tests/CI, startup interruption, external providers, physical Host, restore/operator and representative Human acceptance remain open. No requirement or phase status is promoted. PR42 remains draft and unmerged.
