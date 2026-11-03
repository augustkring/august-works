# Authenticated Native chat sessions attempt 043

Fresh pinned-source run of `tests/e2e/agent-chat-sessions.spec.ts` with system Chromium. The exact file was listed before execution, the same-snapshot privacy regression passed, and all original assertions and timeouts were retained.

The run reached four passing tests, then exposed two failures: metric recovery setup was rejected because it used the synthetic `local-board` owner instead of a current Human principal; the feature-flag case did not settle after the chat became blocked. The next Stop/recovery test was interrupted and one test did not run when the exact Playwright process was stopped after these failures. This is partial evidence, not a full-file pass. Numeric exit 130 and full output are preserved in `test-exit.txt` and `playwright.log`; source hashes are in `source-pins.json`, with traces/provider events in `playwright-output/`.
