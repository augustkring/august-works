# Issue route source-authority fixture validation

This archive records the scoped fix for CI failures in `issue-execution-policy-routes.test.ts` and `issue-feedback-routes.test.ts`. Those route tests exercise feedback and execution-policy behavior with a structural DB fake; their canonical source ownership is covered by the analytical-context and privacy integration suites. The fixtures now mock only `canActorReadIssuePrivacy` and `assertAnalyticalContextPayloadAccess`, while leaving the route access service, authorization decisions, and execution-policy logic active.

The final focused run used a fresh qualification snapshot based on `a2a73dda9a27bdb906ff22a502d7dbdb89236aea`. Snapshot and syntax checks exited 0; both test files passed, 23/23. Exact copied file hashes and the full snapshot are in `source-pins.json`.

The diagnostic run documents the original sanitized 500: `db.execute is not a function` from `analytical-context-authority.origins()` while the route attempted source proof unavailable to the fake DB. The earlier combined attempt is retained as a failing intermediate; the final rerun is the passing result.
