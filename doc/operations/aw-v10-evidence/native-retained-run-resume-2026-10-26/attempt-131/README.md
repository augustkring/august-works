# Retained concurrent Native chat suite, attempt 131

Attempt 131 ran the complete 8-case `tests/e2e/agent-chat-sessions.spec.ts` suite with one Chromium worker and a 600-second cap. The source snapshot copied 609 files; the pinned Vitest/Oxc syntax parser checked 524 and passed. Playwright listed all 8 required cases.

The run exited 1 with all 8 cases failing during shared setup, before any Native chat journey executed. Every attempt to create the test company failed with SQLSTATE `42703` (undefined column). The service schema referenced `company_memberships.permissions_initialized_at`, but no migration adding that column was present in this snapshot. This run provides no concurrency or privacy-path result; rerun after migration 0555 is installed.
