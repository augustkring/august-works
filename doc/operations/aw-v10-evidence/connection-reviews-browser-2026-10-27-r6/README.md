# Connection review browser evidence — 2026-10-27 r6

This current-source run exercised the four non-restart connection review journeys in the dedicated authenticated Playwright configuration: approve, decline, always-allow, and provider failure. Restart remains covered by the separate restart-controlled configuration/case.

Command ran in `/workspace/v10-dep-qualification` after `source /workspace/v10-preparation/env.sh`, prepending `/workspace/v10-preparation/pinned-bin` to `PATH`, selecting `/usr/bin/chromium` through `PAPERCLIP_PLAYWRIGHT_EXECUTABLE`, and acquiring `/workspace/v10-preparation/v10-pg-tests.lock`. The run took a fresh source snapshot, passed the Oxc syntax check, and ran the stale disposable E2E PostgreSQL socket reaper before Playwright.

Result: 4 passed, 0 failed. Snapshot, syntax, socket cleanup, test and wrapper exit codes are preserved. Test source SHA-256: `02a246e287a2b22ecd1a2c92c53af2a4ba59afd3366d2e0e1ddd7413009b52bb`.

The decline journey deliberately drops the interaction WebSocket event and returns an empty first interaction snapshot. It now waits for the existing 20-second interactions query to reconcile the stale card; it does not reload the page to satisfy the assertion. The UI owner documents live invalidation plus polling/reconnect reconciliation in `doc/connections/TASK-REVIEWS.md`.
