# Continuity security qualification, 28 October 2026

The focused current-source PostgreSQL HTTP route test passed: a recent passkey-authenticated Human with the live `users:manage_permissions` grant suspended the last owner, the committed run was cancelled, the company default Human was cleared, and owner recovery was recorded. The test also checks local implicit access, expected-session mismatch and stale-auth denial. See `pg-route-r5/` for exact runner, source-pin, syntax and test receipts.

The focused V10-128 scoped tool-context PostgreSQL tests passed: same-company discovery and invocation carry validated current Run/Task/Project context, while guest tool invocations retain null home Run/Task IDs. The fixture records the Task-bound profile and verifies an issue-scoped block on list and invoke. See `pg-task-context-r6/`; `scopefix.diff` contains the exact two implementation/test files for root staging.

The Company Access UI and API client tests passed: 36 tests across two files. The UI typecheck and token gates passed. See `ui-r5/` and `types-token/` for receipts.

The focused server TypeScript check was terminated by SIGKILL with no diagnostic output. Server typecheck remains unverified under the current resource contention.

These are source and test receipts; they do not qualify a hosted ingress, provider or customer environment.
