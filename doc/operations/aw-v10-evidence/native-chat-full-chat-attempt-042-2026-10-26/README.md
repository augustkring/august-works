# Native chat full two-file attempt 042 (2026-10-26)

Fresh pinned-source run of the authenticated Native chat sessions and projects Playwright files with system Chromium. The exact two files listed 24 tests; the bounded deadlock-log privacy regression passed on the same pinned snapshot.

The run was stopped after its first real failure to preserve time for cause review. `agent-chat-projects.spec.ts` expected a private project from the legacy fake Native provider, which returned the intentional `Private projects are not available` denial because this provider path is not qualified to create private Projects. The first test failed; a second test was interrupted, and 22 did not run. No production guard or expected outcome was changed. `test-exit.txt` records the Playwright exit (130); traces and provider events are retained.
