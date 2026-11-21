# Native chat concurrent first-send E2E attempt 008

This is a truthful record of the focused `agent-chat-sessions.spec.ts` run on 2026-10-26. The fresh source pin snapshot and Playwright list gate are preserved with the raw test log (gzip) and the fixture's content-safe provider event trace.

The list gate found 8 tests. With `--max-failures=1`, one test passed, the concurrent first-send/retry case failed, and six tests did not run. The failure was `idle()` timing out after 60 seconds: the issue remained `in_progress` / conversation `active`, with 2 agent replies and one live run in `running` state. The provider trace records successful task-context, task-history, and progress tool calls for both fake app-server processes. This attempt is not a passing sessions suite.
