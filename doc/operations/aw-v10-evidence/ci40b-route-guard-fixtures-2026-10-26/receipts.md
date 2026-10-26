# CI40b route fixture verification

Source worktree: `/workspace/blentera-v10`; run date 2026-10-26. Both Vitest runs acquired `/workspace/v10-preparation/v10-pg-tests.lock`, snapshot 54 source files, and preserve raw log, numeric exit, and source-pin JSON.

The six-file run (`ci40b-focused-route-vitest-v3`) exited 1 with 45/49 tests passing. All five suites other than `issue-activity-events-routes` passed. Four receipt/snapshot assertions exposed that its mock echoed route-only `privacyActor` and `privateWorkAdmission` control values into the returned issue. The service fixture was corrected to omit these controls from its simulated persisted row. The targeted issue activity rerun (`ci40b-activity-receipt-vitest-v1`) exited 0 with 11/11 tests passing. Composed focused coverage is 49/49 across:

- `environment-selection-route-guards.test.ts`
- `issue-assigned-backlog-contract-routes.test.ts`
- `project-workspace-managed-sandbox-routes.test.ts`
- `artifact-review-document-routes.test.ts`
- `issue-activity-events-routes.test.ts`
- `document-annotation-routes.test.ts`

The route unit fixtures stub the exact analytical-context and native document Source authorization boundaries because these tests use fake DBs. Explicit privacy/Source-denial controls assert no protected action occurs. Separate PG integration suites continue to cover underlying authorization policy.
