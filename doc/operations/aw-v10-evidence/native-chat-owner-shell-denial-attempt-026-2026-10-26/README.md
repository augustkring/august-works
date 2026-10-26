# Native chat owner-shell rerun 026

This is a failed focused Playwright run against a fresh current-source snapshot. Snapshot and syntax checks passed; the exact case listing found one test; the browser test ran once and exited 1.

The prior authorization SQL operator error was fixed before this run. The owner-shell helper used the revised `authorizationService(...).decide` permission decision. The browser still failed before Native provider work: first `POST /api/issues/:id/comments` received 404 (`{"error":"Issue not found"}`), the concurrent response waiter timed out, and a subsequent chat retry received 404. No provider trace was produced, so Native finalization remains untested.
