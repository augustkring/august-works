# Authenticated Native chat regressions attempt 045

Fresh pinned-source run of the remaining feature-flag, Stop/recovery, and sidebar session cases in `agent-chat-sessions.spec.ts`, using system Chromium. The selected test names were listed before launch, the same-snapshot native failure-log privacy regression passed, and all existing assertions/timeouts were retained. `--max-failures=0` bounds this diagnostic pair after its first actual failure; no skipped test is described as passing.

Numeric exit and full log are `test-exit.txt` and `playwright.log`; source hashes and browser traces/provider events are retained alongside them.
