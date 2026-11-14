# Focused restore and feedback-image regression receipts

These receipts are for two previously failing integration cases, run against the dependency-qualified current-source mirror under the shared PostgreSQL lock.

- `support-case-storage.integration.test.ts` — `applies the coverage migration before quarantine when an older restore has no coverage table`: **1 passed**. The fixture rolls back from the actual current migration journal schema (`drizzle`) and rewinds migrations 0561/0562 before calling the existing restore-quarantine owner.
- `v9-feedback-images.integration.test.ts` — `blocks company object erasure on a native hold and waits for exact protected-image cleanup before company completion`: **1 passed**. It retains the held-content stop, confirms the queued exact object deletion using local filesystem storage, and then confirms company deletion completes. No billing provider call is made because the fixture has no subscription.

The full source-pin manifest identifies the snapshot. `source.patch.gz` is limited to the two edited test files; `support-test.log.gz` and `feedback-test.log.gz` contain direct Vitest output; the receipt check found no bearer-token patterns.
