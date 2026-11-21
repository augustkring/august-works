# Native chat Plan resume evidence

These receipts cover the authenticated Native agent-chat Plan test, `Plan denies project mutations; Plan can draft and revise without execution`. Each attempt records a fresh source snapshot, a one-test Playwright list, and a numeric exit. The Playwright traces are kept in the preparation workspace because they contain browser-session material; the provider event trace in attempt 006 contains only tool names, work mode, and success/error classification.

Attempt 005 (exit 1) passed its snapshot, syntax, and one-test list checks. The first Plan-mode reply completed, but the second message could not resume the Codex thread. Its attached run record reports `native_runner_process_exited`; the bounded runner log identifies `codex_history_incomplete: unavailable thread status`. The test fixture's `thread/read` response omitted Codex's required `thread.status.type`.

Attempt 006 adds `thread.status.type: "idle"` to that fake Codex response. Snapshot, syntax, and selector checks passed; the same Plan test passed (1 passed). The provider event trace confirms the forbidden project request is answered without a project mutation, then both draft and revision turns complete through `write_document` and `paperclip_finish`.

The full 24-test chat lane is not qualified by these receipts. Its attempt 007 stopped at the first test because the production guard correctly returned `Private projects are not available` for an ordinary Codex fake's unqualified Project creation. No admission guard or expected outcome was changed.
