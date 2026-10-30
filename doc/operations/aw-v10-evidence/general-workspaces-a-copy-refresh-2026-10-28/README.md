# GeneralTests workspaces-a (1/2) triage — 2026-10-28

GitHub job `122769634991` in `augustkring/august-works` had successful setup/dependency-install steps and a failed `Run grouped general test suites` step. The job-logs connector returned `Transport closed` on repeated requests; direct GitHub API download was blocked by the workspace network tunnel. The job-steps connector succeeded. No GitHub raw log is represented here.

The first local run used the exact CI command for `general-workspaces-a`, shard `1/2`. Its full raw stdout and exit are preserved as `generaltests-workspaces-a-1-attempt-1.log` and `.exit`. It ran 413 UI test files: 407 passed, 6 failed, with 13 failing tests and 3,821 passing tests. Twelve failures were stale customer-facing expectations: they asserted Paperclip labels while the current product identity is Blentera, or asserted the removed “Enterprise view” upsell where the page now explains the missing permission. The technical `Paperclip` MCP client configuration key remains unchanged. The thirteenth failure is in `AppDetail.test.tsx`, which expects a `Credential expiry:` label absent from the current lifecycle UI. That file is owned by the Trust/Apps UI work and was referred to that owner; it is not modified here.

The five copy-expectation test files were updated without changing production behavior or dropping assertions. Audit permission tests now assert the current administrator-permission explanation and verify it is absent after falling back to the basic activity feed. The full shard was not rerun. Only the five affected files were rerun under `/workspace/v10-preparation/v10-pg-tests.lock` with the pinned pnpm executable; all 5 files and 88 tests passed (`attempt-2-tests.log`, `attempt-2-tests.exit`).

`source-sha256-after-run.txt` records hashes after the first broad run; `attempt-2-source-pins-pretest.txt` records hashes inside the shared lock immediately before the focused rerun; `source-pins-after-tests.txt` records the current files after the focused run. No pre-run source snapshot was captured for the first run, so no pre-run digest is claimed. The initial broad-run artifacts include a post-run hash list for relevant current source and test files, not a contemporaneous snapshot.

Commands:

- CI shard: `/workspace/v10-preparation/pinned-bin/pnpm test:run:general -- --group 'general-workspaces-a' --shard-index 0 --shard-count 2`
- Focused rerun: `/workspace/v10-preparation/pinned-bin/pnpm exec vitest run --project @paperclipai/ui ui/src/components/new-agent/AgentProviderConnection.test.tsx ui/src/pages/audit/AuditFeed.test.tsx ui/src/pages/apps/gateways/ConnectClientDialog.test.tsx ui/src/pages/apps/chat/ChatEndpointDetail.activity.test.ts ui/src/pages/apps/chat/SlackSetupPrompt.test.tsx`
